/**
 * Graph — Migration Adapter
 *
 * Implements the GraphDiscoveryAdapter interface from the
 * knowledge-graph extension, allowing the migration engine to
 * feed discovered infrastructure into the knowledge graph.
 */

import type { NormalizedVM, NormalizedBucket, NormalizedSecurityRule, MigrationJob } from "../types.js";

// =============================================================================
// Graph Node/Edge Types (matching knowledge-graph adapter contract)
// =============================================================================

export interface GraphNodeInput {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  provider: string;
}

export interface GraphEdgeInput {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface DiscoveryResult {
  provider: string;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  errors: string[];
  durationMs: number;
}

// =============================================================================
// Migration Discovery Adapter
// =============================================================================

/**
 * Converts migration resources into knowledge-graph nodes and edges.
 */
export class MigrationGraphAdapter {
  readonly provider = "cloud-migration";
  readonly displayName = "Cloud Migration Discovery";

  /**
   * Supported resource types for graph discovery.
   */
  supportedResourceTypes(): string[] {
    return ["vm", "bucket", "security-group", "migration-job", "migration-step"];
  }

  /**
   * Check if incremental sync is supported.
   */
  supportsIncrementalSync(): boolean {
    return false;
  }

  /**
   * Health check.
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    return { healthy: true, message: "Migration adapter ready" };
  }

  /**
   * Discover all migration resources and produce graph nodes/edges.
   */
  discover(params: {
    vms: NormalizedVM[];
    buckets: NormalizedBucket[];
    securityRules: NormalizedSecurityRule[];
    jobs: MigrationJob[];
  }): DiscoveryResult {
    const startTime = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: string[] = [];

    try {
      // VMs → nodes
      for (const vm of params.vms) {
        nodes.push({
          id: `migration:vm:${vm.id}`,
          type: "compute-instance",
          label: vm.name,
          properties: {
            provider: vm.provider,
            region: vm.region,
            cpuCores: vm.cpuCores,
            memoryGB: vm.memoryGB,
            osType: vm.osType,
            architecture: vm.architecture,
            totalDiskGB: vm.disks.reduce((sum, d) => sum + d.sizeGB, 0),
          },
          provider: vm.provider,
        });

        // VM → disk edges
        for (const disk of vm.disks) {
          nodes.push({
            id: `migration:disk:${disk.id}`,
            type: "block-storage",
            label: `${vm.name}-disk-${disk.id}`,
            properties: {
              sizeGB: disk.sizeGB,
              type: disk.type,
              encrypted: disk.encrypted,
            },
            provider: vm.provider,
          });

          edges.push({
            source: `migration:vm:${vm.id}`,
            target: `migration:disk:${disk.id}`,
            type: "attached-to",
            properties: {},
          });
        }

        // VM → subnet edges
        for (const nic of vm.networkInterfaces) {
          if (nic.subnetId) {
            edges.push({
              source: `migration:vm:${vm.id}`,
              target: `migration:subnet:${nic.subnetId}`,
              type: "connected-to",
              properties: { privateIp: nic.privateIp },
            });
          }

          for (const sgId of nic.securityGroupIds) {
            edges.push({
              source: `migration:vm:${vm.id}`,
              target: `migration:sg:${sgId}`,
              type: "secured-by",
              properties: {},
            });
          }
        }
      }

      // Buckets → nodes
      for (const bucket of params.buckets) {
        nodes.push({
          id: `migration:bucket:${bucket.id}`,
          type: "object-storage",
          label: bucket.name,
          properties: {
            provider: bucket.provider,
            region: bucket.region,
            encryption: bucket.encryption,
            totalSizeBytes: bucket.totalSizeBytes,
            objectCount: bucket.objectCount,
            versioning: bucket.versioning,
          },
          provider: bucket.provider,
        });
      }

      // Security rules → nodes
      for (const rule of params.securityRules) {
        nodes.push({
          id: `migration:sg:${rule.id}`,
          type: "security-group",
          label: rule.name,
          properties: {
            direction: rule.direction,
            action: rule.action,
            protocol: rule.protocol,
            priority: rule.priority,
          },
          provider: "unknown",
        });
      }

      // Migration jobs → nodes
      for (const job of params.jobs) {
        nodes.push({
          id: `migration:job:${job.id}`,
          type: "migration-job",
          label: `Migration: ${job.source.provider} → ${job.target.provider}`,
          properties: {
            phase: job.phase,
            sourceProvider: job.source.provider,
            targetProvider: job.target.provider,
            createdAt: job.createdAt,
          },
          provider: "cloud-migration",
        });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    return {
      provider: this.provider,
      nodes,
      edges,
      errors,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Singleton adapter instance.
 */
let _adapter: MigrationGraphAdapter | null = null;

export function getMigrationGraphAdapter(): MigrationGraphAdapter {
  if (!_adapter) {
    _adapter = new MigrationGraphAdapter();
  }
  return _adapter;
}
