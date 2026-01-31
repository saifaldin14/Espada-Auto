/**
 * AWS Context Manager
 *
 * Manages AWS region and account context switching with:
 * - Profile-based context switching
 * - Region validation and discovery
 * - Account information caching
 * - Cross-account role assumption
 */

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { EC2Client, DescribeRegionsCommand } from "@aws-sdk/client-ec2";
import { IAMClient, ListAccountAliasesCommand } from "@aws-sdk/client-iam";
import { OrganizationsClient, DescribeAccountCommand, DescribeOrganizationCommand } from "@aws-sdk/client-organizations";
import type { AWSCredentialsManager } from "../credentials/manager.js";
import type {
  AWSContext,
  AWSAccountInfo,
  AWSRegionInfo,
  ContextSwitchOptions,
  AWSCredentials,
} from "../types.js";

// =============================================================================
// Constants
// =============================================================================

const GLOBAL_SERVICES_REGIONS: Record<string, string> = {
  iam: "us-east-1",
  organizations: "us-east-1",
  route53: "us-east-1",
  cloudfront: "us-east-1",
  waf: "us-east-1",
  shield: "us-east-1",
};

const AWS_PARTITIONS: Record<string, { regions: RegExp; dnsSuffix: string }> = {
  aws: { regions: /^(us|eu|ap|sa|ca|me|af)-/, dnsSuffix: "amazonaws.com" },
  "aws-cn": { regions: /^cn-/, dnsSuffix: "amazonaws.com.cn" },
  "aws-us-gov": { regions: /^us-gov-/, dnsSuffix: "amazonaws.com" },
};

// =============================================================================
// Context Manager
// =============================================================================

export class AWSContextManager {
  private credentialsManager: AWSCredentialsManager;
  private currentContext: AWSContext | null = null;
  private accountCache: Map<string, AWSAccountInfo> = new Map();
  private regionCache: Map<string, AWSRegionInfo[]> = new Map();
  private contextHistory: AWSContext[] = [];
  private maxHistorySize = 10;

  constructor(credentialsManager: AWSCredentialsManager) {
    this.credentialsManager = credentialsManager;
  }

  /**
   * Initialize context with default profile
   */
  async initialize(defaultRegion?: string): Promise<AWSContext> {
    const result = await this.credentialsManager.getCredentials();
    
    const context: AWSContext = {
      profile: result.profile,
      region: result.region ?? defaultRegion ?? "us-east-1",
      accountId: result.accountId,
      partition: this.getPartition(result.region ?? defaultRegion ?? "us-east-1"),
    };

    // Get additional account info
    if (result.accountId) {
      const accountInfo = await this.getAccountInfo(result.credentials, result.accountId);
      if (accountInfo) {
        context.accountAlias = accountInfo.accountAlias;
      }
    }

    // Get caller identity
    const identity = await this.getCallerIdentity(result.credentials, context.region);
    if (identity) {
      context.userId = identity.userId;
      context.arn = identity.arn;
    }

    this.currentContext = context;
    return context;
  }

  /**
   * Get current context
   */
  getContext(): AWSContext | null {
    return this.currentContext;
  }

  /**
   * Switch to a different profile
   */
  async switchProfile(
    profile: string,
    options: ContextSwitchOptions = {},
  ): Promise<AWSContext> {
    const { validateAccess = true, refreshCredentials = true } = options;

    // Save current context to history
    if (this.currentContext) {
      this.pushToHistory(this.currentContext);
    }

    // Invalidate credentials cache if requested
    if (refreshCredentials) {
      this.credentialsManager.invalidateCache(profile);
    }

    // Get credentials for new profile
    const result = await this.credentialsManager.getCredentials(profile);
    
    // Validate access if requested
    if (validateAccess) {
      const valid = await this.credentialsManager.validateCredentials(result.credentials);
      if (!valid) {
        throw new Error(`Invalid credentials for profile "${profile}"`);
      }
    }

    const context: AWSContext = {
      profile,
      region: result.region ?? this.currentContext?.region ?? "us-east-1",
      accountId: result.accountId,
      partition: this.getPartition(result.region ?? "us-east-1"),
    };

    // Get account info
    if (result.accountId) {
      const accountInfo = await this.getAccountInfo(result.credentials, result.accountId);
      if (accountInfo) {
        context.accountAlias = accountInfo.accountAlias;
      }
    }

    // Get caller identity
    const identity = await this.getCallerIdentity(result.credentials, context.region);
    if (identity) {
      context.userId = identity.userId;
      context.arn = identity.arn;
    }

    this.currentContext = context;
    return context;
  }

  /**
   * Switch to a different region
   */
  async switchRegion(
    region: string,
    options: ContextSwitchOptions = {},
  ): Promise<AWSContext> {
    const { validateAccess = true } = options;

    if (!this.currentContext) {
      throw new Error("No current context. Call initialize() first.");
    }

    // Validate region exists
    const regions = await this.getAvailableRegions();
    const regionInfo = regions.find((r) => r.regionName === region);
    if (!regionInfo) {
      throw new Error(`Invalid region: ${region}`);
    }
    if (!regionInfo.available) {
      throw new Error(`Region ${region} is not available (opt-in required)`);
    }

    // Save current context to history
    this.pushToHistory(this.currentContext);

    // Update context
    const newContext: AWSContext = {
      ...this.currentContext,
      region,
      partition: this.getPartition(region),
    };

    // Validate access if requested
    if (validateAccess) {
      const result = await this.credentialsManager.getCredentials(
        newContext.profile,
        region,
      );
      const valid = await this.credentialsManager.validateCredentials(result.credentials);
      if (!valid) {
        throw new Error(`Cannot access region "${region}" with current credentials`);
      }
    }

    this.currentContext = newContext;
    return newContext;
  }

  /**
   * Switch to a different account via role assumption
   */
  async switchAccount(
    accountId: string,
    roleArn: string,
    options: {
      sessionName?: string;
      externalId?: string;
      mfaSerial?: string;
      mfaCode?: string;
      region?: string;
    } = {},
  ): Promise<AWSContext> {
    if (!this.currentContext) {
      throw new Error("No current context. Call initialize() first.");
    }

    // Save current context to history
    this.pushToHistory(this.currentContext);

    // Assume role
    const assumedCredentials = await this.credentialsManager.assumeRole(roleArn, {
      sessionName: options.sessionName,
      externalId: options.externalId,
      mfaSerial: options.mfaSerial,
      mfaCode: options.mfaCode,
      region: options.region ?? this.currentContext.region,
    });

    // Build new context
    const region = options.region ?? this.currentContext.region;
    const newContext: AWSContext = {
      profile: this.currentContext.profile,
      region,
      accountId,
      partition: this.getPartition(region),
    };

    // Get account info
    const accountInfo = await this.getAccountInfo(assumedCredentials, accountId);
    if (accountInfo) {
      newContext.accountAlias = accountInfo.accountAlias;
    }

    // Get caller identity
    const identity = await this.getCallerIdentity(assumedCredentials, region);
    if (identity) {
      newContext.userId = identity.userId;
      newContext.arn = identity.arn;
    }

    this.currentContext = newContext;
    return newContext;
  }

  /**
   * Go back to previous context
   */
  async switchToPrevious(): Promise<AWSContext | null> {
    const previous = this.contextHistory.pop();
    if (!previous) {
      return null;
    }

    this.currentContext = previous;
    return previous;
  }

  /**
   * Get context history
   */
  getHistory(): AWSContext[] {
    return [...this.contextHistory];
  }

  /**
   * Get available regions
   */
  async getAvailableRegions(forceRefresh = false): Promise<AWSRegionInfo[]> {
    const cacheKey = this.currentContext?.profile ?? "default";
    
    if (!forceRefresh && this.regionCache.has(cacheKey)) {
      return this.regionCache.get(cacheKey)!;
    }

    const result = await this.credentialsManager.getCredentials();
    const client = new EC2Client({
      region: this.currentContext?.region ?? "us-east-1",
      credentials: {
        accessKeyId: result.credentials.accessKeyId,
        secretAccessKey: result.credentials.secretAccessKey,
        sessionToken: result.credentials.sessionToken,
      },
    });

    try {
      const response = await client.send(new DescribeRegionsCommand({
        AllRegions: true,
      }));

      const regions: AWSRegionInfo[] = (response.Regions ?? []).map((r) => ({
        regionName: r.RegionName!,
        endpoint: r.Endpoint!,
        optInStatus: r.OptInStatus as AWSRegionInfo["optInStatus"],
        available: r.OptInStatus !== "not-opted-in",
      }));

      this.regionCache.set(cacheKey, regions);
      return regions;
    } catch {
      // Return common regions as fallback
      return [
        { regionName: "us-east-1", endpoint: "ec2.us-east-1.amazonaws.com", available: true },
        { regionName: "us-east-2", endpoint: "ec2.us-east-2.amazonaws.com", available: true },
        { regionName: "us-west-1", endpoint: "ec2.us-west-1.amazonaws.com", available: true },
        { regionName: "us-west-2", endpoint: "ec2.us-west-2.amazonaws.com", available: true },
        { regionName: "eu-west-1", endpoint: "ec2.eu-west-1.amazonaws.com", available: true },
        { regionName: "eu-central-1", endpoint: "ec2.eu-central-1.amazonaws.com", available: true },
        { regionName: "ap-northeast-1", endpoint: "ec2.ap-northeast-1.amazonaws.com", available: true },
        { regionName: "ap-southeast-1", endpoint: "ec2.ap-southeast-1.amazonaws.com", available: true },
      ];
    }
  }

  /**
   * Get account information
   */
  async getAccountInfo(
    credentials: AWSCredentials,
    accountId: string,
  ): Promise<AWSAccountInfo | null> {
    // Check cache
    if (this.accountCache.has(accountId)) {
      return this.accountCache.get(accountId)!;
    }

    const info: AWSAccountInfo = { accountId };

    // Try to get account alias from IAM
    try {
      const iamClient = new IAMClient({
        region: "us-east-1",
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const aliasResponse = await iamClient.send(new ListAccountAliasesCommand({}));
      if (aliasResponse.AccountAliases && aliasResponse.AccountAliases.length > 0) {
        info.accountAlias = aliasResponse.AccountAliases[0];
      }
    } catch {
      // IAM access not available
    }

    // Try to get organization info
    try {
      const orgClient = new OrganizationsClient({
        region: "us-east-1",
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const orgResponse = await orgClient.send(new DescribeOrganizationCommand({}));
      if (orgResponse.Organization) {
        info.organizationId = orgResponse.Organization.Id;
      }

      const accountResponse = await orgClient.send(
        new DescribeAccountCommand({ AccountId: accountId }),
      );
      if (accountResponse.Account) {
        info.accountName = accountResponse.Account.Name;
        info.accountEmail = accountResponse.Account.Email;
        info.status = accountResponse.Account.Status as AWSAccountInfo["status"];
      }
    } catch {
      // Organizations access not available
    }

    this.accountCache.set(accountId, info);
    return info;
  }

  /**
   * Get caller identity
   */
  private async getCallerIdentity(
    credentials: AWSCredentials,
    region: string,
  ): Promise<{ userId?: string; arn?: string } | null> {
    try {
      const client = new STSClient({
        region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const response = await client.send(new GetCallerIdentityCommand({}));
      return {
        userId: response.UserId,
        arn: response.Arn,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the AWS partition for a region
   */
  private getPartition(region: string): AWSContext["partition"] {
    for (const [partition, config] of Object.entries(AWS_PARTITIONS)) {
      if (config.regions.test(region)) {
        return partition as AWSContext["partition"];
      }
    }
    return "aws";
  }

  /**
   * Push context to history
   */
  private pushToHistory(context: AWSContext): void {
    this.contextHistory.push({ ...context });
    
    // Trim history if too large
    while (this.contextHistory.length > this.maxHistorySize) {
      this.contextHistory.shift();
    }
  }

  /**
   * Get region for a global service
   */
  getGlobalServiceRegion(service: string): string {
    return GLOBAL_SERVICES_REGIONS[service.toLowerCase()] ?? "us-east-1";
  }

  /**
   * Check if a service is global
   */
  isGlobalService(service: string): boolean {
    return service.toLowerCase() in GLOBAL_SERVICES_REGIONS;
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.accountCache.clear();
    this.regionCache.clear();
  }

  /**
   * Destroy the context manager
   */
  destroy(): void {
    this.clearCaches();
    this.contextHistory = [];
    this.currentContext = null;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AWS context manager
 */
export function createContextManager(
  credentialsManager: AWSCredentialsManager,
): AWSContextManager {
  return new AWSContextManager(credentialsManager);
}
