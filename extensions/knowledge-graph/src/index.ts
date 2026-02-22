/**
 * Infrastructure Knowledge Graph — Main Entry Point
 *
 * Re-exports the public API for use by other extensions and the plugin system.
 */

// Core types
export type {
  GraphNode,
  GraphNodeInput,
  GraphEdge,
  GraphEdgeInput,
  GraphChange,
  GraphGroup,
  GraphGroupMember,
  GraphStorage,
  GraphStats,
  SyncRecord,
  SubgraphResult,
  DriftResult,
  CostAttribution,
  NodeFilter,
  EdgeFilter,
  ChangeFilter,
  CloudProvider,
  GraphResourceType,
  GraphRelationshipType,
  GraphNodeStatus,
  TraversalDirection,
} from "./types.js";

// Engine
export { GraphEngine } from "./engine.js";
export type { GraphEngineConfig } from "./engine.js";

// Storage
export { InMemoryGraphStorage } from "./storage/index.js";
export { SQLiteGraphStorage } from "./storage/index.js";
export { PostgresGraphStorage } from "./storage/index.js";
export type { PostgresConfig } from "./storage/index.js";

// Adapters
export { AdapterRegistry } from "./adapters/index.js";
export type { GraphDiscoveryAdapter, DiscoverOptions, DiscoveryResult, DiscoveryError } from "./adapters/index.js";
export { AwsDiscoveryAdapter, buildAwsNodeId } from "./adapters/index.js";
export type { AwsAdapterConfig } from "./adapters/index.js";

// Queries
export {
  shortestPath,
  findOrphans,
  findCriticalNodes,
  findSinglePointsOfFailure,
  findClusters,
} from "./queries.js";
export type { PathResult, CriticalNode, ClusterResult } from "./queries.js";

// Export
export { exportTopology } from "./export.js";
export type { ExportFormat, ExportResult, ExportOptions } from "./export.js";

// Terraform adapter
export { TerraformDiscoveryAdapter, parseTerraformState, TERRAFORM_TYPE_MAP } from "./adapters/index.js";
export type { TerraformAdapterConfig } from "./adapters/index.js";

// Report generator
export { generateScanReport } from "./report.js";
export type { ReportFormat, ScanReport, ReportFindings, ReportOptions } from "./report.js";

// Infra CLI
export { registerInfraCli } from "./infra-cli.js";
export type { InfraCliContext } from "./infra-cli.js";

// Tools & CLI (for direct use / testing)
export { registerGraphTools, registerTemporalTools, registerIQLTools } from "./tools.js";
export { registerPolicyScanTool } from "./policy-scan-tool.js";
export { registerGraphCli } from "./cli.js";

// Kubernetes adapter
export { KubernetesDiscoveryAdapter, buildK8sNodeId, extractK8sRelationships, extractCrossCloudEdges, detectHelmReleases } from "./adapters/index.js";
export type { K8sAdapterConfig, K8sClient, K8sRawResource, HelmRelease } from "./adapters/index.js";

// Temporal Knowledge Graph
export {
  InMemoryTemporalStorage,
  takeSnapshot,
  getTopologyAt,
  getNodeHistory,
  diffSnapshots,
  diffTimestamps,
  getEvolutionSummary,
  syncWithSnapshot,
  DEFAULT_RETENTION,
} from "./temporal.js";
export type {
  GraphSnapshot,
  NodeVersion,
  EdgeVersion,
  SnapshotDiff,
  SnapshotRetentionConfig,
  TemporalGraphStorage,
} from "./temporal.js";

// Infrastructure Query Language (IQL)
export { parseIQL, executeQuery, IQLLexer, IQLParser, IQLSyntaxError } from "./iql/index.js";
export type {
  IQLQuery,
  FindQuery,
  SummarizeQuery,
  FindTarget,
  Condition,
  FieldCondition,
  FunctionCondition,
  ComparisonOp,
  IQLValue,
  IQLResult,
  IQLFindResult,
  IQLSummarizeResult,
  IQLDiffResult,
  IQLPathResult,
  IQLExecutorOptions,
} from "./iql/index.js";

// Sync performance
export {
  computeNodeHash,
  diffNodeFields,
  processBatched,
  processPooled,
  paginatedDiscover,
  collectPaginated,
  NodeHashCache,
  incrementalSync,
} from "./sync.js";
export type {
  BatchOptions,
  DiscoveryPage,
  PaginatedDiscoveryConfig,
  IncrementalSyncResult,
} from "./sync.js";

// Query cache
export { LRUCache, QueryCache } from "./cache.js";
export type { QueryCacheConfig } from "./cache.js";

// Multi-tenant
export {
  AccountRegistry,
  TenantManager,
  discoverCrossAccountRelationships,
  tenantScopedFilter,
} from "./tenant.js";
export type {
  CloudAccount,
  CloudAccountInput,
  AccountAuth,
  Tenant,
  TenantIsolation,
  TenantStorageFactory,
  CrossAccountConfig,
  CrossAccountRelType,
} from "./tenant.js";
