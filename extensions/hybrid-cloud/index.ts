/**
 * Hybrid/Edge Infrastructure Extension
 *
 * Provides unified topology discovery across Azure Arc, Azure Local,
 * AWS Outposts, GKE Enterprise fleets, and Google Distributed Cloud.
 */

export { HybridDiscoveryCoordinator } from "./src/discovery-coordinator.js";
export { CrossBoundaryAnalyzer } from "./src/cross-boundary-analysis.js";
export {
  createEdgeSiteNode,
  createFleetNode,
  createClusterNode,
  createHybridEdge,
} from "./src/graph-model.js";

export type {
  HybridSite,
  HybridSiteCapability,
  FleetCluster,
  HybridTopology,
  HybridConnection,
  HybridDiscoveryAdapter,
} from "./src/types.js";
