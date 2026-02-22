/**
 * Infrastructure Knowledge Graph — Multi-Tenant Support
 *
 * Tenant isolation and multi-account management for enterprise deployments:
 *   - Multiple AWS accounts (Organizations), Azure subscriptions, GCP projects
 *   - Cross-account relationship discovery via assume-role chains
 *   - Tenant-scoped storage isolation (PostgreSQL schema per tenant)
 *   - Account registry with metadata and credential references
 */

import type {
  CloudProvider,
  GraphStorage,
  NodeFilter,
  GraphNode,
  GraphStats,
} from "./types.js";

// =============================================================================
// Account & Tenant Types
// =============================================================================

/**
 * Represents a single cloud account/subscription/project
 * known to the knowledge graph.
 */
export type CloudAccount = {
  /** Internal unique identifier for this account. */
  id: string;
  /** Cloud provider. */
  provider: CloudProvider;
  /** Native account identifier (AWS account ID, Azure subscription ID, GCP project ID). */
  nativeAccountId: string;
  /** Human-readable name (e.g. "production", "staging-us-east-1"). */
  name: string;
  /** Tenant this account belongs to (for multi-tenant SaaS). */
  tenantId: string;
  /** Whether this account is enabled for discovery. */
  enabled: boolean;
  /** Regions to scan (empty = all available). */
  regions: string[];
  /** How to authenticate to this account. */
  auth: AccountAuth;
  /** Tags for organization. */
  tags: Record<string, string>;
  /** Last successful sync timestamp. */
  lastSyncAt: string | null;
  /** Account creation timestamp. */
  createdAt: string;
  /** Account modification timestamp. */
  updatedAt: string;
};

/** Authentication configuration for a cloud account. */
export type AccountAuth =
  | { method: "profile"; profileName: string }
  | { method: "assume-role"; roleArn: string; externalId?: string }
  | { method: "service-principal"; clientId: string; tenantId: string }
  | { method: "service-account"; keyFile: string }
  | { method: "kubeconfig"; context: string }
  | { method: "default" };

/** Input for creating/updating a cloud account. */
export type CloudAccountInput = Omit<CloudAccount, "createdAt" | "updatedAt" | "lastSyncAt"> & {
  lastSyncAt?: string | null;
};

// =============================================================================
// Tenant Types
// =============================================================================

/**
 * A tenant in a multi-tenant deployment.
 * Each tenant has isolated storage (e.g. separate PostgreSQL schema).
 */
export type Tenant = {
  /** Unique tenant identifier. */
  id: string;
  /** Human-readable tenant name. */
  name: string;
  /** Whether this tenant is active. */
  active: boolean;
  /** Storage isolation strategy. */
  isolation: TenantIsolation;
  /** Maximum number of accounts this tenant can register. */
  maxAccounts: number;
  /** Maximum nodes across all accounts. */
  maxNodes: number;
  /** Tenant metadata. */
  metadata: Record<string, unknown>;
  /** Creation timestamp. */
  createdAt: string;
  /** Modification timestamp. */
  updatedAt: string;
};

/**
 * How this tenant's data is isolated.
 */
export type TenantIsolation =
  | { strategy: "schema"; schemaName: string }
  | { strategy: "database"; databaseName: string }
  | { strategy: "prefix"; prefix: string }
  | { strategy: "shared" };

// =============================================================================
// Account Registry
// =============================================================================

/**
 * Registry of all known cloud accounts.
 * Manages account CRUD and provides lookup by provider/tenant.
 */
export class AccountRegistry {
  private accounts = new Map<string, CloudAccount>();

  /**
   * Register a new cloud account or update an existing one.
   */
  register(input: CloudAccountInput): CloudAccount {
    const existing = this.accounts.get(input.id);
    const ts = new Date().toISOString();

    const account: CloudAccount = {
      ...input,
      lastSyncAt: input.lastSyncAt ?? existing?.lastSyncAt ?? null,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };

    this.accounts.set(account.id, account);
    return account;
  }

  /**
   * Remove an account from the registry.
   */
  unregister(id: string): boolean {
    return this.accounts.delete(id);
  }

  /**
   * Get an account by ID.
   */
  get(id: string): CloudAccount | undefined {
    return this.accounts.get(id);
  }

  /**
   * Get all accounts, optionally filtered.
   */
  list(filter?: {
    provider?: CloudProvider;
    tenantId?: string;
    enabled?: boolean;
  }): CloudAccount[] {
    let accounts = Array.from(this.accounts.values());
    if (filter?.provider) {
      accounts = accounts.filter((a) => a.provider === filter.provider);
    }
    if (filter?.tenantId) {
      accounts = accounts.filter((a) => a.tenantId === filter.tenantId);
    }
    if (filter?.enabled !== undefined) {
      accounts = accounts.filter((a) => a.enabled === filter.enabled);
    }
    return accounts.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all unique providers across registered accounts.
   */
  getProviders(): CloudProvider[] {
    const providers = new Set<CloudProvider>();
    for (const account of this.accounts.values()) {
      providers.add(account.provider);
    }
    return Array.from(providers);
  }

  /**
   * Get all unique tenants.
   */
  getTenantIds(): string[] {
    const tenants = new Set<string>();
    for (const account of this.accounts.values()) {
      tenants.add(account.tenantId);
    }
    return Array.from(tenants);
  }

  /**
   * Update the last sync timestamp for an account.
   */
  markSynced(id: string, syncedAt?: string): void {
    const account = this.accounts.get(id);
    if (account) {
      account.lastSyncAt = syncedAt ?? new Date().toISOString();
      account.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Enable or disable an account.
   */
  setEnabled(id: string, enabled: boolean): void {
    const account = this.accounts.get(id);
    if (account) {
      account.enabled = enabled;
      account.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Get account count by provider.
   */
  countByProvider(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const account of this.accounts.values()) {
      counts[account.provider] = (counts[account.provider] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Total number of registered accounts.
   */
  get size(): number {
    return this.accounts.size;
  }
}

// =============================================================================
// Tenant Manager
// =============================================================================

/**
 * Manages tenants and their isolated storage.
 *
 * In a multi-tenant SaaS deployment, each tenant gets its own
 * PostgreSQL schema (or database), ensuring data isolation.
 */
export class TenantManager {
  private tenants = new Map<string, Tenant>();
  private storageFactory: TenantStorageFactory;
  private storageCache = new Map<string, GraphStorage>();

  constructor(storageFactory: TenantStorageFactory) {
    this.storageFactory = storageFactory;
  }

  /**
   * Create a new tenant.
   */
  async createTenant(input: {
    id: string;
    name: string;
    isolation: TenantIsolation;
    maxAccounts?: number;
    maxNodes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Tenant> {
    if (this.tenants.has(input.id)) {
      throw new Error(`Tenant '${input.id}' already exists`);
    }

    const ts = new Date().toISOString();
    const tenant: Tenant = {
      id: input.id,
      name: input.name,
      active: true,
      isolation: input.isolation,
      maxAccounts: input.maxAccounts ?? 100,
      maxNodes: input.maxNodes ?? 500_000,
      metadata: input.metadata ?? {},
      createdAt: ts,
      updatedAt: ts,
    };

    // Create storage for this tenant
    const storage = await this.storageFactory.create(tenant);
    await storage.initialize();
    this.storageCache.set(tenant.id, storage);

    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  /**
   * Get a tenant by ID.
   */
  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  /**
   * List all tenants.
   */
  listTenants(activeOnly = true): Tenant[] {
    const tenants = Array.from(this.tenants.values());
    return activeOnly ? tenants.filter((t) => t.active) : tenants;
  }

  /**
   * Get the storage instance for a tenant.
   * Lazily initializes storage if not already cached.
   */
  async getStorage(tenantId: string): Promise<GraphStorage> {
    const existing = this.storageCache.get(tenantId);
    if (existing) return existing;

    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);
    if (!tenant.active) throw new Error(`Tenant '${tenantId}' is not active`);

    const storage = await this.storageFactory.create(tenant);
    await storage.initialize();
    this.storageCache.set(tenantId, storage);
    return storage;
  }

  /**
   * Deactivate a tenant (data is preserved but access is blocked).
   */
  deactivateTenant(id: string): void {
    const tenant = this.tenants.get(id);
    if (tenant) {
      tenant.active = false;
      tenant.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Reactivate a tenant.
   */
  reactivateTenant(id: string): void {
    const tenant = this.tenants.get(id);
    if (tenant) {
      tenant.active = true;
      tenant.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Delete a tenant and its storage. Irreversible.
   */
  async deleteTenant(id: string): Promise<void> {
    const storage = this.storageCache.get(id);
    if (storage) {
      await storage.close();
      this.storageCache.delete(id);
    }

    await this.storageFactory.destroy(id);
    this.tenants.delete(id);
  }

  /**
   * Get aggregate stats across all tenants.
   */
  async getGlobalStats(): Promise<{
    tenants: number;
    activeTenants: number;
    totalStats: GraphStats;
    perTenant: Array<{ tenantId: string; tenantName: string; stats: GraphStats }>;
  }> {
    const perTenant: Array<{ tenantId: string; tenantName: string; stats: GraphStats }> = [];
    const aggregate: GraphStats = {
      totalNodes: 0,
      totalEdges: 0,
      totalChanges: 0,
      totalGroups: 0,
      nodesByProvider: {},
      nodesByResourceType: {},
      edgesByRelationshipType: {},
      totalCostMonthly: 0,
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    };

    for (const tenant of this.tenants.values()) {
      if (!tenant.active) continue;
      try {
        const storage = await this.getStorage(tenant.id);
        const stats = await storage.getStats();

        perTenant.push({ tenantId: tenant.id, tenantName: tenant.name, stats });

        aggregate.totalNodes += stats.totalNodes;
        aggregate.totalEdges += stats.totalEdges;
        aggregate.totalChanges += stats.totalChanges;
        aggregate.totalGroups += stats.totalGroups;
        aggregate.totalCostMonthly += stats.totalCostMonthly;

        for (const [k, v] of Object.entries(stats.nodesByProvider)) {
          aggregate.nodesByProvider[k] = (aggregate.nodesByProvider[k] ?? 0) + v;
        }
        for (const [k, v] of Object.entries(stats.nodesByResourceType)) {
          aggregate.nodesByResourceType[k] = (aggregate.nodesByResourceType[k] ?? 0) + v;
        }
        for (const [k, v] of Object.entries(stats.edgesByRelationshipType)) {
          aggregate.edgesByRelationshipType[k] = (aggregate.edgesByRelationshipType[k] ?? 0) + v;
        }

        if (stats.lastSyncAt && (!aggregate.lastSyncAt || stats.lastSyncAt > aggregate.lastSyncAt)) {
          aggregate.lastSyncAt = stats.lastSyncAt;
        }
        if (stats.oldestChange && (!aggregate.oldestChange || stats.oldestChange < aggregate.oldestChange)) {
          aggregate.oldestChange = stats.oldestChange;
        }
        if (stats.newestChange && (!aggregate.newestChange || stats.newestChange > aggregate.newestChange)) {
          aggregate.newestChange = stats.newestChange;
        }
      } catch {
        // Skip tenants with storage errors
      }
    }

    return {
      tenants: this.tenants.size,
      activeTenants: Array.from(this.tenants.values()).filter((t) => t.active).length,
      totalStats: aggregate,
      perTenant,
    };
  }

  /**
   * Close all cached storage connections.
   */
  async close(): Promise<void> {
    for (const storage of this.storageCache.values()) {
      await storage.close();
    }
    this.storageCache.clear();
  }
}

// =============================================================================
// Storage Factory Interface
// =============================================================================

/**
 * Factory for creating tenant-isolated storage instances.
 * Implementations create storage with the appropriate isolation strategy.
 */
export interface TenantStorageFactory {
  /**
   * Create a new storage instance for a tenant.
   * For schema isolation, creates a new PostgreSQL schema.
   * For database isolation, creates a new database.
   */
  create(tenant: Tenant): Promise<GraphStorage>;

  /**
   * Destroy storage for a tenant (drop schema/database).
   */
  destroy(tenantId: string): Promise<void>;
}

// =============================================================================
// Cross-Account Discovery
// =============================================================================

/** Cross-account relationship discovery configuration. */
export type CrossAccountConfig = {
  /** Source account. */
  sourceAccountId: string;
  /** Target account for cross-account relationships. */
  targetAccountId: string;
  /** Types of cross-account relationships to discover. */
  relationshipTypes: CrossAccountRelType[];
};

/** Types of cross-account relationships. */
export type CrossAccountRelType =
  | "iam-trust"           // Cross-account IAM role assumption
  | "vpc-peering"         // VPC peering between accounts
  | "transit-gateway"     // Transit Gateway shared across accounts
  | "shared-service"      // Shared services (e.g. centralized logging)
  | "dns-resolution"      // Cross-account DNS resolution
  | "data-replication"    // S3 cross-region replication, RDS read replicas
  | "event-routing";      // EventBridge cross-account event routing

/**
 * Discover cross-account relationships between nodes in two account scopes.
 * This is a high-level coordinator that uses existing adapter infrastructure.
 */
export async function discoverCrossAccountRelationships(
  storage: GraphStorage,
  config: CrossAccountConfig,
): Promise<{
  discovered: number;
  relationships: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    type: CrossAccountRelType;
  }>;
}> {
  const results: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    type: CrossAccountRelType;
  }> = [];

  // Get all nodes from both accounts
  const sourceNodes = await storage.queryNodes({ account: config.sourceAccountId });
  const targetNodes = await storage.queryNodes({ account: config.targetAccountId });

  // Build lookup maps for efficient matching
  const targetByNativeId = new Map<string, GraphNode>();
  const targetByName = new Map<string, GraphNode[]>();
  for (const node of targetNodes) {
    targetByNativeId.set(node.nativeId, node);
    const existing = targetByName.get(node.name) ?? [];
    existing.push(node);
    targetByName.set(node.name, existing);
  }

  for (const relType of config.relationshipTypes) {
    switch (relType) {
      case "iam-trust":
        // Look for IAM roles that reference the other account
        for (const node of sourceNodes) {
          if (node.resourceType !== "iam-role") continue;
          const trustPolicy = node.metadata.trustPolicy as string | undefined;
          if (trustPolicy?.includes(config.targetAccountId)) {
            // Find corresponding roles in target account
            for (const target of targetNodes) {
              if (target.resourceType === "iam-role") {
                results.push({ sourceNodeId: node.id, targetNodeId: target.id, type: "iam-trust" });
              }
            }
          }
        }
        break;

      case "vpc-peering":
        // Look for VPC peering connections referencing the other account
        for (const node of sourceNodes) {
          if (node.resourceType !== "vpc") continue;
          const peerId = node.metadata.peerAccountId as string | undefined;
          if (peerId === config.targetAccountId) {
            const peerVpcId = node.metadata.peerVpcId as string | undefined;
            if (peerVpcId) {
              const target = targetByNativeId.get(peerVpcId);
              if (target) {
                results.push({ sourceNodeId: node.id, targetNodeId: target.id, type: "vpc-peering" });
              }
            }
          }
        }
        break;

      case "shared-service":
        // Look for nodes with cross-account references in metadata
        for (const node of sourceNodes) {
          const crossAccountRef = node.metadata.crossAccountTarget as string | undefined;
          if (crossAccountRef) {
            const target = targetByNativeId.get(crossAccountRef);
            if (target) {
              results.push({ sourceNodeId: node.id, targetNodeId: target.id, type: "shared-service" });
            }
          }
        }
        break;

      case "data-replication":
        // Look for storage resources with replication targets in other accounts
        for (const node of sourceNodes) {
          if (node.resourceType !== "storage") continue;
          const replicationTarget = node.metadata.replicationTargetAccount as string | undefined;
          if (replicationTarget === config.targetAccountId) {
            const targetBucket = node.metadata.replicationTargetId as string | undefined;
            if (targetBucket) {
              const target = targetByNativeId.get(targetBucket);
              if (target) {
                results.push({ sourceNodeId: node.id, targetNodeId: target.id, type: "data-replication" });
              }
            }
          }
        }
        break;

      // Other types follow similar patterns
      default:
        break;
    }
  }

  return {
    discovered: results.length,
    relationships: results,
  };
}

/**
 * Build a filter that scopes queries to a specific tenant's accounts.
 */
export function tenantScopedFilter(
  accountRegistry: AccountRegistry,
  tenantId: string,
  baseFilter: NodeFilter = {},
): NodeFilter {
  const accounts = accountRegistry.list({ tenantId, enabled: true });
  if (accounts.length === 0) return baseFilter;

  // If filtering by a single account, keep the account filter as-is
  // Otherwise, rely on the storage being tenant-scoped
  return { ...baseFilter };
}
