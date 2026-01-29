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
import { IAMClient } from "@aws-sdk/client-iam";
import { STSClient } from "@aws-sdk/client-sts";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
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
  iam: IAMClient,
  sts: STSClient,
  cloudtrail: CloudTrailClient,
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
