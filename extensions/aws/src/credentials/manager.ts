/**
 * AWS Credentials Manager
 *
 * Provides unified credential management supporting:
 * - Environment variables
 * - AWS profile files
 * - SSO authentication
 * - Instance metadata (EC2/ECS)
 * - Web identity tokens
 * - Assumed roles with MFA
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseIni } from "ini";
import {
  fromEnv,
  fromIni,
  fromSSO,
  fromInstanceMetadata,
  fromContainerMetadata,
  fromTokenFile,
} from "@aws-sdk/credential-providers";
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types";
import type {
  AWSCredentials,
  AWSCredentialSource,
  AWSProfile,
  AWSSSOSession,
  CredentialsManagerOptions,
  CredentialResolutionResult,
} from "../types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CREDENTIALS_FILE = join(homedir(), ".aws", "credentials");
const DEFAULT_CONFIG_FILE = join(homedir(), ".aws", "config");
const DEFAULT_CACHE_TTL = 3600000; // 1 hour
const DEFAULT_REFRESH_THRESHOLD = 300000; // 5 minutes

// =============================================================================
// Credential Cache
// =============================================================================

type CachedCredential = {
  credentials: AWSCredentials;
  profile?: string;
  region: string;
  accountId?: string;
  resolvedAt: Date;
  expiresAt?: Date;
};

class CredentialCache {
  private cache = new Map<string, CachedCredential>();
  private ttl: number;

  constructor(ttl: number = DEFAULT_CACHE_TTL) {
    this.ttl = ttl;
  }

  private getCacheKey(profile?: string, region?: string): string {
    return `${profile ?? "default"}:${region ?? "default"}`;
  }

  get(profile?: string, region?: string): CachedCredential | null {
    const key = this.getCacheKey(profile, region);
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    // Check if expired
    const now = new Date();
    if (cached.expiresAt && cached.expiresAt <= now) {
      this.cache.delete(key);
      return null;
    }
    
    // Check if cache TTL exceeded
    const age = now.getTime() - cached.resolvedAt.getTime();
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return cached;
  }

  set(entry: CachedCredential, profile?: string, region?: string): void {
    const key = this.getCacheKey(profile, region);
    this.cache.set(key, entry);
  }

  invalidate(profile?: string, region?: string): void {
    if (profile === undefined && region === undefined) {
      this.cache.clear();
    } else {
      const key = this.getCacheKey(profile, region);
      this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

// =============================================================================
// AWS Credentials Manager
// =============================================================================

export class AWSCredentialsManager {
  private options: Required<CredentialsManagerOptions>;
  private cache: CredentialCache;
  private profiles: Map<string, AWSProfile> = new Map();
  private ssoSessions: Map<string, AWSSSOSession> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: CredentialsManagerOptions = {}) {
    this.options = {
      defaultProfile: options.defaultProfile ?? process.env.AWS_PROFILE ?? "default",
      defaultRegion: options.defaultRegion ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
      credentialsFile: options.credentialsFile ?? DEFAULT_CREDENTIALS_FILE,
      configFile: options.configFile ?? DEFAULT_CONFIG_FILE,
      cacheCredentials: options.cacheCredentials ?? true,
      cacheTTL: options.cacheTTL ?? DEFAULT_CACHE_TTL,
      autoRefresh: options.autoRefresh ?? true,
      refreshThreshold: options.refreshThreshold ?? DEFAULT_REFRESH_THRESHOLD,
    };
    
    this.cache = new CredentialCache(this.options.cacheTTL);
  }

  /**
   * Initialize the credentials manager by loading profiles
   */
  async initialize(): Promise<void> {
    await this.loadProfiles();
  }

  /**
   * Load AWS profiles from config files
   */
  private async loadProfiles(): Promise<void> {
    this.profiles.clear();
    this.ssoSessions.clear();

    // Load credentials file
    try {
      const credentialsContent = await readFile(this.options.credentialsFile, "utf-8");
      const credentials = parseIni(credentialsContent);
      
      for (const [name, values] of Object.entries(credentials)) {
        if (typeof values === "object" && values !== null) {
          const existing = this.profiles.get(name) ?? { name };
          this.profiles.set(name, {
            ...existing,
            ...(values as Record<string, string>),
          });
        }
      }
    } catch {
      // Credentials file doesn't exist or is unreadable
    }

    // Load config file
    try {
      const configContent = await readFile(this.options.configFile, "utf-8");
      const config = parseIni(configContent);
      
      for (const [section, values] of Object.entries(config)) {
        if (typeof values !== "object" || values === null) continue;
        
        // Handle SSO sessions
        if (section.startsWith("sso-session ")) {
          const sessionName = section.replace("sso-session ", "");
          const v = values as Record<string, string>;
          this.ssoSessions.set(sessionName, {
            name: sessionName,
            startUrl: v.sso_start_url ?? "",
            region: v.sso_region ?? this.options.defaultRegion,
            registrationScopes: v.sso_registration_scopes?.split(","),
          });
          continue;
        }
        
        // Handle profiles
        const profileName = section.startsWith("profile ")
          ? section.replace("profile ", "")
          : section;
        
        const existing = this.profiles.get(profileName) ?? { name: profileName };
        const v = values as Record<string, string>;
        
        this.profiles.set(profileName, {
          ...existing,
          name: profileName,
          region: v.region ?? existing.region,
          output: v.output ?? existing.output,
          roleArn: v.role_arn ?? existing.roleArn,
          sourceProfile: v.source_profile ?? existing.sourceProfile,
          mfaSerial: v.mfa_serial ?? existing.mfaSerial,
          ssoStartUrl: v.sso_start_url ?? existing.ssoStartUrl,
          ssoRegion: v.sso_region ?? existing.ssoRegion,
          ssoAccountId: v.sso_account_id ?? existing.ssoAccountId,
          ssoRoleName: v.sso_role_name ?? existing.ssoRoleName,
          externalId: v.external_id ?? existing.externalId,
          durationSeconds: v.duration_seconds 
            ? parseInt(v.duration_seconds, 10) 
            : existing.durationSeconds,
        });
      }
    } catch {
      // Config file doesn't exist or is unreadable
    }
  }

  /**
   * Get credentials for a profile
   */
  async getCredentials(
    profile?: string,
    region?: string,
  ): Promise<CredentialResolutionResult> {
    const targetProfile = profile ?? this.options.defaultProfile;
    const targetRegion = region ?? this.options.defaultRegion;

    // Check cache first
    if (this.options.cacheCredentials) {
      const cached = this.cache.get(targetProfile, targetRegion);
      if (cached) {
        return cached;
      }
    }

    // Resolve credentials
    const result = await this.resolveCredentials(targetProfile, targetRegion);

    // Cache the result
    if (this.options.cacheCredentials) {
      this.cache.set(result, targetProfile, targetRegion);
      
      // Set up auto-refresh if enabled
      if (this.options.autoRefresh && result.expiresAt) {
        this.scheduleRefresh(targetProfile, targetRegion, result.expiresAt);
      }
    }

    return result;
  }

  /**
   * Resolve credentials based on profile configuration
   */
  private async resolveCredentials(
    profile: string,
    region: string,
  ): Promise<CredentialResolutionResult> {
    const profileConfig = this.profiles.get(profile);
    
    // Try different credential sources in order
    const sources: Array<{
      source: AWSCredentialSource;
      provider: () => AwsCredentialIdentityProvider;
      condition: () => boolean;
    }> = [
      {
        source: "environment",
        provider: () => fromEnv(),
        condition: () => !!process.env.AWS_ACCESS_KEY_ID,
      },
      {
        source: "sso",
        provider: () => fromSSO({
          profile,
        }),
        condition: () => !!profileConfig?.ssoStartUrl || !!profileConfig?.ssoAccountId,
      },
      {
        source: "assumed-role",
        provider: () => fromIni({
          profile,
          mfaCodeProvider: this.mfaCodeProvider.bind(this),
        }),
        condition: () => !!profileConfig?.roleArn,
      },
      {
        source: "profile",
        provider: () => fromIni({ profile }),
        condition: () => this.profiles.has(profile),
      },
      {
        source: "instance-metadata",
        provider: () => fromInstanceMetadata(),
        condition: () => this.isEC2Instance(),
      },
      {
        source: "container-credentials",
        provider: () => fromContainerMetadata(),
        condition: () => !!process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
      },
      {
        source: "web-identity",
        provider: () => fromTokenFile({
          roleArn: process.env.AWS_ROLE_ARN,
          webIdentityTokenFile: process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
        }),
        condition: () => !!process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
      },
    ];

    let lastError: Error | null = null;
    
    for (const { source, provider, condition } of sources) {
      if (!condition()) continue;
      
      try {
        const credentialProvider = provider();
        const credentials = await credentialProvider();
        
        const awsCredentials = this.toAWSCredentials(credentials, source);
        const accountId = await this.getAccountId(awsCredentials, region);
        
        return {
          credentials: awsCredentials,
          profile,
          region: profileConfig?.region ?? region,
          accountId,
          resolvedAt: new Date(),
          expiresAt: awsCredentials.expiration,
        };
      } catch (error) {
        lastError = error as Error;
        continue;
      }
    }

    throw new Error(
      `Failed to resolve credentials for profile "${profile}": ${lastError?.message ?? "No credential source available"}`,
    );
  }

  /**
   * Convert SDK credentials to our format
   */
  private toAWSCredentials(
    credentials: AwsCredentialIdentity,
    source: AWSCredentialSource,
  ): AWSCredentials {
    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration,
      source,
    };
  }

  /**
   * Get AWS account ID from credentials
   */
  private async getAccountId(
    credentials: AWSCredentials,
    region: string,
  ): Promise<string | undefined> {
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
      return response.Account;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if running on EC2 instance
   */
  private isEC2Instance(): boolean {
    // Check for instance metadata service environment
    return (
      process.env.AWS_EC2_METADATA_DISABLED !== "true" &&
      (process.platform === "linux" || process.platform === "darwin")
    );
  }

  /**
   * MFA code provider for assumed roles
   */
  private async mfaCodeProvider(_serial: string): Promise<string> {
    // In a real implementation, this would prompt the user for MFA code
    // For now, we throw an error indicating MFA is required
    throw new Error(
      "MFA authentication required. Please provide MFA code through the CLI or environment.",
    );
  }

  /**
   * Schedule credential refresh before expiration
   */
  private scheduleRefresh(
    profile: string,
    region: string,
    expiresAt: Date,
  ): void {
    const key = `${profile}:${region}`;
    
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Calculate refresh time
    const refreshTime = expiresAt.getTime() - this.options.refreshThreshold;
    const delay = Math.max(0, refreshTime - Date.now());

    // Schedule refresh
    const timer = setTimeout(async () => {
      try {
        this.cache.invalidate(profile, region);
        await this.getCredentials(profile, region);
      } catch {
        // Refresh failed, will be retried on next access
      }
    }, delay);

    this.refreshTimers.set(key, timer);
  }

  /**
   * Assume a role with optional MFA
   */
  async assumeRole(
    roleArn: string,
    options: {
      sessionName?: string;
      duration?: number;
      externalId?: string;
      mfaSerial?: string;
      mfaCode?: string;
      sourceCredentials?: AWSCredentials;
      region?: string;
    } = {},
  ): Promise<AWSCredentials> {
    const region = options.region ?? this.options.defaultRegion;
    const sourceCredentials = options.sourceCredentials
      ?? (await this.getCredentials()).credentials;

    const client = new STSClient({
      region,
      credentials: {
        accessKeyId: sourceCredentials.accessKeyId,
        secretAccessKey: sourceCredentials.secretAccessKey,
        sessionToken: sourceCredentials.sessionToken,
      },
    });

    const command = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: options.sessionName ?? `espada-session-${Date.now()}`,
      DurationSeconds: options.duration ?? 3600,
      ExternalId: options.externalId,
      SerialNumber: options.mfaSerial,
      TokenCode: options.mfaCode,
    });

    const response = await client.send(command);
    
    if (!response.Credentials) {
      throw new Error("Failed to assume role: No credentials returned");
    }

    return {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken,
      expiration: response.Credentials.Expiration,
      source: "assumed-role",
    };
  }

  /**
   * Get all configured profiles
   */
  getProfiles(): AWSProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get a specific profile configuration
   */
  getProfile(name: string): AWSProfile | undefined {
    return this.profiles.get(name);
  }

  /**
   * Get all SSO sessions
   */
  getSSOSessions(): AWSSSOSession[] {
    return Array.from(this.ssoSessions.values());
  }

  /**
   * Validate credentials are still valid
   */
  async validateCredentials(credentials: AWSCredentials): Promise<boolean> {
    try {
      const client = new STSClient({
        region: this.options.defaultRegion,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });
      
      await client.send(new GetCallerIdentityCommand({}));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate cached credentials
   */
  invalidateCache(profile?: string, region?: string): void {
    this.cache.invalidate(profile, region);
  }

  /**
   * Clear all cached credentials
   */
  clearCache(): void {
    this.cache.clear();
    
    // Clear all refresh timers
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
  }

  /**
   * List all available profiles
   */
  listProfiles(): string[] {
    return Array.from(this.profiles.keys());
  }

  /**
   * List all available SSO sessions
   */
  listSSOSessions(): string[] {
    return Array.from(this.ssoSessions.keys());
  }

  /**
   * Destroy the credentials manager
   */
  destroy(): void {
    this.clearCache();
    this.profiles.clear();
    this.ssoSessions.clear();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AWS credentials manager
 */
export function createCredentialsManager(
  options?: CredentialsManagerOptions,
): AWSCredentialsManager {
  return new AWSCredentialsManager(options);
}
