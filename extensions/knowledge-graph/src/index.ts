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
  PaginationOptions,
  PaginatedResult,
  CloudProvider,
  GraphResourceType,
  GraphRelationshipType,
  GraphNodeStatus,
  TraversalDirection,
} from "./types.js";

// Engine
export { GraphEngine } from "./core/engine.js";
export type { GraphEngineConfig } from "./core/engine.js";

// Storage
export { InMemoryGraphStorage } from "./storage/index.js";
export { SQLiteGraphStorage } from "./storage/index.js";
export { SQLiteTemporalStorage } from "./storage/index.js";
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
} from "./core/queries.js";
export type { PathResult, CriticalNode, ClusterResult } from "./core/queries.js";

// Export
export { exportTopology } from "./reporting/export.js";
export type { ExportFormat, ExportResult, ExportOptions } from "./reporting/export.js";

// Terraform adapter
export { TerraformDiscoveryAdapter, parseTerraformState, TERRAFORM_TYPE_MAP } from "./adapters/index.js";
export type { TerraformAdapterConfig } from "./adapters/index.js";

// Report generator
export { generateScanReport } from "./reporting/report.js";
export type { ReportFormat, ScanReport, ReportFindings, ReportOptions } from "./reporting/report.js";

// Infra CLI
export { registerInfraCli } from "./cli/infra-cli.js";
export type { InfraCliContext } from "./cli/infra-cli.js";

// Tools & CLI (for direct use / testing)
export { registerGraphTools, registerTemporalTools, registerIQLTools, registerP2Tools } from "./tools/tools.js";
export { registerPolicyScanTool } from "./tools/policy-scan-tool.js";
export { registerGraphCli } from "./cli/cli.js";

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
} from "./core/temporal.js";
export type {
  GraphSnapshot,
  NodeVersion,
  EdgeVersion,
  SnapshotDiff,
  SnapshotRetentionConfig,
  TemporalGraphStorage,
} from "./core/temporal.js";

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
} from "./core/sync.js";
export type {
  BatchOptions,
  DiscoveryPage,
  PaginatedDiscoveryConfig,
  IncrementalSyncResult,
} from "./core/sync.js";

// Query cache
export { LRUCache, QueryCache } from "./core/cache.js";
export type { QueryCacheConfig } from "./core/cache.js";

// Multi-tenant
export {
  AccountRegistry,
  TenantManager,
  discoverCrossAccountRelationships,
  tenantScopedFilter,
} from "./core/tenant.js";
export type {
  CloudAccount,
  CloudAccountInput,
  AccountAuth,
  Tenant,
  TenantIsolation,
  TenantStorageFactory,
  CrossAccountConfig,
  CrossAccountRelType,
} from "./core/tenant.js";

// Monitoring
export {
  InfraMonitor,
  BUILTIN_ALERT_RULES,
  SCHEDULE_PRESETS,
  orphanAlertRule,
  spofAlertRule,
  costAnomalyAlertRule,
  unauthorizedChangeAlertRule,
  disappearedAlertRule,
  getTimelineSummary,
  getGraphDiff,
  getCostTrend,
  defaultMonitorConfig,
  CloudTrailEventSource,
  AzureActivityLogEventSource,
  GcpAuditLogEventSource,
} from "./monitoring/monitoring.js";
export type {
  MonitorConfig,
  MonitorSchedule,
  AlertRule,
  AlertInstance,
  AlertSeverity,
  AlertCategory,
  AlertDestination,
  AlertDestinationType,
  AlertEvaluationContext,
  EventSourceAdapter,
  EventSourceType,
  EventSourceConfig,
  CloudEvent,
  SyncCycleResult,
  MonitorStatus,
  TimelineSummary,
  GraphDiff,
  CostTrendPoint,
} from "./monitoring/monitoring.js";

// Monitoring Mock Mode (testing/demos)
export {
  MockEventSourceAdapter,
  MockAlertCollector,
  mockCloudEvent,
  generateEventBatch,
  createMockMonitor,
  orphanScenario,
  spofScenario,
  costSpikeScenario,
  driftScenario,
  disappearanceScenario,
  multiCloudScenario,
  ALL_SCENARIOS,
} from "./monitoring/monitoring-mock.js";
export type {
  MockEventGeneratorConfig,
  MockScenario,
  MockMonitorOptions,
  MockMonitorResult,
} from "./monitoring/monitoring-mock.js";

// Compliance framework mapping (P2.17)
export {
  evaluateFramework,
  runComplianceAssessment,
  formatComplianceMarkdown,
  COMPLIANCE_CONTROLS,
  SUPPORTED_FRAMEWORKS,
  getFrameworkControls,
} from "./analysis/compliance.js";
export type {
  ComplianceFramework,
  ComplianceControl,
  ControlResult,
  ComplianceSummary,
  ComplianceReport,
} from "./analysis/compliance.js";

// Resource recommendation engine (P2.18)
export {
  generateRecommendations,
  formatRecommendationsMarkdown,
} from "./analysis/recommendations.js";
export type {
  RecommendationCategory,
  RecommendationPriority,
  Recommendation,
  RecommendationReport,
} from "./analysis/recommendations.js";

// Agent action modeling (P2.19)
export {
  registerAgent,
  recordAgentAction,
  getAgents,
  getAgentResources,
  detectAgentConflicts,
  getAgentActivity,
  generateAgentReport,
  formatAgentReportMarkdown,
  buildAgentNodeId,
} from "./analysis/agent-model.js";
export type {
  AgentNode,
  AgentAction,
  AgentActionType,
  AgentConflict,
  AgentActivitySummary,
  AgentReport,
} from "./analysis/agent-model.js";

// Natural language → IQL translation (P2.20)
export {
  translateNLToIQL,
  getAvailableResourceTypes,
  getAvailableProviders,
  getExampleQueries,
} from "./analysis/nl-translator.js";
export type { NLTranslationResult } from "./analysis/nl-translator.js";

// Drift auto-remediation (P2.21)
export {
  generateRemediationPlan,
  formatRemediationMarkdown,
} from "./analysis/remediation.js";
export type {
  IaCFormat,
  RemediationPatch,
  DriftedField,
  RemediationPlan,
} from "./analysis/remediation.js";

// Supply chain graph (P2.22)
export {
  parseCycloneDX,
  parseSPDX,
  parseSBOM,
  ingestContainerImage,
  linkImageToInfra,
  findImagesByCVE,
  getImageVulnerabilities,
  generateSupplyChainReport,
  formatSupplyChainMarkdown,
  buildImageNodeId,
  buildPackageNodeId,
  buildCVENodeId,
} from "./analysis/supply-chain.js";
export type {
  SBOMFormat,
  SBOMPackage,
  CVEReference,
  ContainerImage,
  SupplyChainReport,
} from "./analysis/supply-chain.js";

// Graph visualization (P2.16)
export {
  exportVisualization,
  DEFAULT_COLORS,
} from "./analysis/visualization.js";
export type {
  VisualizationFormat,
  VisualizationOptions,
  VisualizationResult,
  LayoutStrategy,
  CytoscapeNode,
  CytoscapeEdge,
  D3Node,
  D3Link,
} from "./analysis/visualization.js";
