/**
 * Infrastructure Knowledge Graph — Provider Adapter Interface
 *
 * Each cloud provider implements this interface to normalize its resources
 * and relationships into the universal graph model. The adapter is responsible
 * for calling provider-specific SDKs and emitting normalized nodes/edges.
 */

import type {
  GraphNodeInput,
  GraphEdgeInput,
  CloudProvider,
  GraphResourceType,
} from "../types.js";

// =============================================================================
// Discovery Options
// =============================================================================

/** Options passed to a discovery run. */
export type DiscoverOptions = {
  /** Only discover these resource types (all if omitted). */
  resourceTypes?: GraphResourceType[];
  /** Only discover in these regions (all if omitted). */
  regions?: string[];
  /** Only discover resources matching these tags. */
  tags?: Record<string, string>;
  /** Max resources to discover (for testing / rate-limit safety). */
  limit?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
};

/** Summary of what a discovery run found. */
export type DiscoveryResult = {
  provider: CloudProvider;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  errors: DiscoveryError[];
  durationMs: number;
};

/** A non-fatal error during discovery (e.g. access denied to one region). */
export type DiscoveryError = {
  resourceType: GraphResourceType | string;
  region?: string;
  message: string;
  code?: string;
};

// =============================================================================
// Adapter Interface
// =============================================================================

/**
 * Contract that each cloud provider adapter must implement.
 *
 * Adapters are stateless — they hold credential config but no graph state.
 * The GraphEngine calls adapters during sync and feeds results into storage.
 */
export interface GraphDiscoveryAdapter {
  /** Canonical provider name. */
  readonly provider: CloudProvider;

  /** Human-readable display name. */
  readonly displayName: string;

  /** Resource types this adapter can discover. */
  supportedResourceTypes(): GraphResourceType[];

  /**
   * Discover all resources and their relationships.
   *
   * Returns a complete snapshot: the engine will diff against stored state
   * to detect creates/updates/deletes/drift.
   */
  discover(options?: DiscoverOptions): Promise<DiscoveryResult>;

  /**
   * Whether this adapter supports incremental sync via event streams
   * (e.g. CloudTrail, Azure Activity Log, GCP Audit Log).
   */
  supportsIncrementalSync(): boolean;

  /**
   * Health check — verify credentials and basic connectivity.
   * Returns true if the adapter can reach its provider.
   */
  healthCheck(): Promise<boolean>;
}

// =============================================================================
// Adapter Registry
// =============================================================================

/**
 * Registry of all available adapters, keyed by provider name.
 */
export class AdapterRegistry {
  private adapters = new Map<CloudProvider, GraphDiscoveryAdapter>();

  register(adapter: GraphDiscoveryAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: CloudProvider): GraphDiscoveryAdapter | undefined {
    return this.adapters.get(provider);
  }

  getAll(): GraphDiscoveryAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(provider: CloudProvider): boolean {
    return this.adapters.has(provider);
  }

  providers(): CloudProvider[] {
    return Array.from(this.adapters.keys());
  }
}

export { type GraphDiscoveryAdapter as Adapter, type GraphNodeInput };
