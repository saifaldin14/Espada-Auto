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

// Tools & CLI (for direct use / testing)
export { registerGraphTools } from "./tools.js";
export { registerGraphCli } from "./cli.js";
