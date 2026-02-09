/**
 * AWS SDK Client Pool Manager
 *
 * Provides efficient management of AWS SDK clients with:
 * - Connection pooling per service/region
 * - Automatic client lifecycle management
 * - Credential refresh integration
 * - Memory-efficient cleanup
 */

import { EC2Client } from "@aws-sdk/client-ec2";
import { S3Client } from "@aws-sdk/client-s3";
import { IAMClient } from "@aws-sdk/client-iam";
import { STSClient } from "@aws-sdk/client-sts";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { RDSClient } from "@aws-sdk/client-rds";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { EKSClient } from "@aws-sdk/client-eks";
import { ECRClient } from "@aws-sdk/client-ecr";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SSMClient } from "@aws-sdk/client-ssm";
import { KMSClient } from "@aws-sdk/client-kms";
import { Route53Client } from "@aws-sdk/client-route-53";
import { ElastiCacheClient } from "@aws-sdk/client-elasticache";
import { OrganizationsClient } from "@aws-sdk/client-organizations";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import type { AWSCredentials, AWSServiceName, ClientPoolConfig, ClientPoolEntry, ClientPoolStats } from "../types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_CLIENTS_PER_SERVICE = 5;
const DEFAULT_MAX_TOTAL_CLIENTS = 50;
const DEFAULT_CLIENT_TTL = 3600000; // 1 hour
const DEFAULT_CLEANUP_INTERVAL = 300000; // 5 minutes

// =============================================================================
// Client Factory Map
// =============================================================================

type ClientConstructor = new (config: {
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}) => unknown;

const CLIENT_FACTORIES: Partial<Record<AWSServiceName, ClientConstructor>> = {
  ec2: EC2Client,
  s3: S3Client,
  iam: IAMClient,
  sts: STSClient,
  lambda: LambdaClient,
  dynamodb: DynamoDBClient,
  rds: RDSClient,
  cloudformation: CloudFormationClient,
  cloudwatch: CloudWatchClient,
  cloudtrail: CloudTrailClient,
  sns: SNSClient,
  sqs: SQSClient,
  ecs: ECSClient,
  eks: EKSClient,
  ecr: ECRClient,
  secretsmanager: SecretsManagerClient,
  ssm: SSMClient,
  kms: KMSClient,
  route53: Route53Client,
  elasticache: ElastiCacheClient,
  organizations: OrganizationsClient,
  resourcegroupstaggingapi: ResourceGroupsTaggingAPIClient,
};

// =============================================================================
// Client Pool Manager
// =============================================================================

export class AWSClientPoolManager {
  private config: Required<ClientPoolConfig>;
  private clients: Map<string, ClientPoolEntry> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private stats: {
    evictedClients: number;
    cacheHits: number;
    cacheMisses: number;
  } = {
    evictedClients: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(config: ClientPoolConfig = {}) {
    this.config = {
      maxClientsPerService: config.maxClientsPerService ?? DEFAULT_MAX_CLIENTS_PER_SERVICE,
      maxTotalClients: config.maxTotalClients ?? DEFAULT_MAX_TOTAL_CLIENTS,
      clientTTL: config.clientTTL ?? DEFAULT_CLIENT_TTL,
      cleanupInterval: config.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
      preloadServices: config.preloadServices ?? [],
      defaultRegion: config.defaultRegion ?? "us-east-1",
    };
  }

  /**
   * Initialize the client pool
   */
  async initialize(credentials: AWSCredentials): Promise<void> {
    // Start cleanup timer
    this.startCleanupTimer();

    // Preload services if configured
    for (const service of this.config.preloadServices) {
      await this.getClient(service, this.config.defaultRegion, credentials);
    }
  }

  /**
   * Get or create a client for a service
   */
  async getClient<T = unknown>(
    service: AWSServiceName,
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<T> {
    const key = this.getClientKey(service, region, profile);

    // Check cache
    const cached = this.clients.get(key);
    if (cached && this.isClientValid(cached)) {
      cached.lastUsedAt = new Date();
      cached.useCount++;
      this.stats.cacheHits++;
      return cached.client as T;
    }

    this.stats.cacheMisses++;

    // Evict if at capacity
    if (this.clients.size >= this.config.maxTotalClients) {
      await this.evictLeastRecentlyUsed();
    }

    // Check per-service limit
    const serviceClients = this.getClientsForService(service);
    if (serviceClients.length >= this.config.maxClientsPerService) {
      await this.evictOldestForService(service);
    }

    // Create new client
    const client = await this.createClient(service, region, credentials);
    
    const entry: ClientPoolEntry = {
      service,
      region,
      profile,
      client,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      useCount: 1,
    };

    this.clients.set(key, entry);
    return client as T;
  }

  /**
   * Create a new SDK client
   */
  private async createClient(
    service: AWSServiceName,
    region: string,
    credentials: AWSCredentials,
  ): Promise<unknown> {
    const ClientClass = CLIENT_FACTORIES[service];
    
    if (!ClientClass) {
      throw new Error(`Unsupported service: ${service}. Consider adding it to CLIENT_FACTORIES.`);
    }

    return new ClientClass({
      region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * Get EC2 client
   */
  async getEC2Client(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<EC2Client> {
    return this.getClient<EC2Client>("ec2", region, credentials, profile);
  }

  /**
   * Get IAM client
   */
  async getIAMClient(
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<IAMClient> {
    // IAM is a global service, always use us-east-1
    return this.getClient<IAMClient>("iam", "us-east-1", credentials, profile);
  }

  /**
   * Get STS client
   */
  async getSTSClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<STSClient> {
    return this.getClient<STSClient>("sts", region, credentials, profile);
  }

  /**
   * Get CloudTrail client
   */
  async getCloudTrailClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<CloudTrailClient> {
    return this.getClient<CloudTrailClient>("cloudtrail", region, credentials, profile);
  }

  /**
   * Get Organizations client
   */
  async getOrganizationsClient(
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<OrganizationsClient> {
    // Organizations is a global service, always use us-east-1
    return this.getClient<OrganizationsClient>("organizations", "us-east-1", credentials, profile);
  }

  /**
   * Get Resource Groups Tagging API client
   */
  async getTaggingClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<ResourceGroupsTaggingAPIClient> {
    return this.getClient<ResourceGroupsTaggingAPIClient>(
      "resourcegroupstaggingapi",
      region,
      credentials,
      profile,
    );
  }

  /**
   * Get S3 client
   */
  async getS3Client(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<S3Client> {
    return this.getClient<S3Client>("s3", region, credentials, profile);
  }

  /**
   * Get Lambda client
   */
  async getLambdaClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<LambdaClient> {
    return this.getClient<LambdaClient>("lambda", region, credentials, profile);
  }

  /**
   * Get DynamoDB client
   */
  async getDynamoDBClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<DynamoDBClient> {
    return this.getClient<DynamoDBClient>("dynamodb", region, credentials, profile);
  }

  /**
   * Get RDS client
   */
  async getRDSClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<RDSClient> {
    return this.getClient<RDSClient>("rds", region, credentials, profile);
  }

  /**
   * Get CloudFormation client
   */
  async getCloudFormationClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<CloudFormationClient> {
    return this.getClient<CloudFormationClient>("cloudformation", region, credentials, profile);
  }

  /**
   * Get CloudWatch client
   */
  async getCloudWatchClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<CloudWatchClient> {
    return this.getClient<CloudWatchClient>("cloudwatch", region, credentials, profile);
  }

  /**
   * Get SNS client
   */
  async getSNSClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<SNSClient> {
    return this.getClient<SNSClient>("sns", region, credentials, profile);
  }

  /**
   * Get SQS client
   */
  async getSQSClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<SQSClient> {
    return this.getClient<SQSClient>("sqs", region, credentials, profile);
  }

  /**
   * Get ECS client
   */
  async getECSClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<ECSClient> {
    return this.getClient<ECSClient>("ecs", region, credentials, profile);
  }

  /**
   * Get EKS client
   */
  async getEKSClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<EKSClient> {
    return this.getClient<EKSClient>("eks", region, credentials, profile);
  }

  /**
   * Get ECR client
   */
  async getECRClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<ECRClient> {
    return this.getClient<ECRClient>("ecr", region, credentials, profile);
  }

  /**
   * Get Secrets Manager client
   */
  async getSecretsManagerClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<SecretsManagerClient> {
    return this.getClient<SecretsManagerClient>("secretsmanager", region, credentials, profile);
  }

  /**
   * Get SSM (Systems Manager) client
   */
  async getSSMClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<SSMClient> {
    return this.getClient<SSMClient>("ssm", region, credentials, profile);
  }

  /**
   * Get KMS client
   */
  async getKMSClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<KMSClient> {
    return this.getClient<KMSClient>("kms", region, credentials, profile);
  }

  /**
   * Get Route53 client
   */
  async getRoute53Client(
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<Route53Client> {
    // Route53 is a global service, always use us-east-1
    return this.getClient<Route53Client>("route53", "us-east-1", credentials, profile);
  }

  /**
   * Get ElastiCache client
   */
  async getElastiCacheClient(
    region: string,
    credentials: AWSCredentials,
    profile?: string,
  ): Promise<ElastiCacheClient> {
    return this.getClient<ElastiCacheClient>("elasticache", region, credentials, profile);
  }

  /**
   * Release a client back to the pool
   */
  releaseClient(service: AWSServiceName, region: string, profile?: string): void {
    const key = this.getClientKey(service, region, profile);
    const entry = this.clients.get(key);
    if (entry) {
      entry.lastUsedAt = new Date();
    }
  }

  /**
   * Invalidate a specific client
   */
  invalidateClient(service: AWSServiceName, region: string, profile?: string): void {
    const key = this.getClientKey(service, region, profile);
    this.clients.delete(key);
  }

  /**
   * Invalidate all clients for a profile
   */
  invalidateProfile(profile: string): void {
    for (const [key, entry] of this.clients.entries()) {
      if (entry.profile === profile) {
        this.clients.delete(key);
      }
    }
  }

  /**
   * Invalidate all clients for a region
   */
  invalidateRegion(region: string): void {
    for (const [key, entry] of this.clients.entries()) {
      if (entry.region === region) {
        this.clients.delete(key);
      }
    }
  }

  /**
   * Clear all clients
   */
  clearAll(): void {
    this.clients.clear();
  }

  /**
   * Get pool statistics
   */
  getStats(): ClientPoolStats {
    const clientsByService: Record<string, number> = {};
    const clientsByRegion: Record<string, number> = {};
    let activeClients = 0;
    let idleClients = 0;

    const now = Date.now();
    const idleThreshold = 60000; // 1 minute

    for (const entry of this.clients.values()) {
      // Count by service
      clientsByService[entry.service] = (clientsByService[entry.service] ?? 0) + 1;

      // Count by region
      clientsByRegion[entry.region] = (clientsByRegion[entry.region] ?? 0) + 1;

      // Count active vs idle
      const idleTime = now - entry.lastUsedAt.getTime();
      if (idleTime < idleThreshold) {
        activeClients++;
      } else {
        idleClients++;
      }
    }

    return {
      totalClients: this.clients.size,
      clientsByService,
      clientsByRegion,
      activeClients,
      idleClients,
      evictedClients: this.stats.evictedClients,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
    };
  }

  /**
   * Generate cache key for a client
   */
  private getClientKey(service: AWSServiceName, region: string, profile?: string): string {
    return `${service}:${region}:${profile ?? "default"}`;
  }

  /**
   * Check if a cached client is still valid
   */
  private isClientValid(entry: ClientPoolEntry): boolean {
    const age = Date.now() - entry.createdAt.getTime();
    return age < this.config.clientTTL;
  }

  /**
   * Get all clients for a specific service
   */
  private getClientsForService(service: AWSServiceName): ClientPoolEntry[] {
    return Array.from(this.clients.values()).filter((e) => e.service === service);
  }

  /**
   * Evict the least recently used client
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.clients.entries()) {
      if (entry.lastUsedAt.getTime() < lruTime) {
        lruTime = entry.lastUsedAt.getTime();
        lruKey = key;
      }
    }

    if (lruKey) {
      this.clients.delete(lruKey);
      this.stats.evictedClients++;
    }
  }

  /**
   * Evict the oldest client for a service
   */
  private async evictOldestForService(service: AWSServiceName): Promise<void> {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.clients.entries()) {
      if (entry.service === service && entry.createdAt.getTime() < oldestTime) {
        oldestTime = entry.createdAt.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.clients.delete(oldestKey);
      this.stats.evictedClients++;
    }
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredClients();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up expired clients
   */
  private cleanupExpiredClients(): void {
    const now = Date.now();

    for (const [key, entry] of this.clients.entries()) {
      const age = now - entry.createdAt.getTime();
      if (age >= this.config.clientTTL) {
        this.clients.delete(key);
        this.stats.evictedClients++;
      }
    }
  }

  /**
   * Stop the cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Destroy the client pool
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.clearAll();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AWS client pool manager
 */
export function createClientPool(config?: ClientPoolConfig): AWSClientPoolManager {
  return new AWSClientPoolManager(config);
}
