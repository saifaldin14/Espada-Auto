/**
 * AWS Adapter — Module Index
 *
 * Re-exports all public symbols from the decomposed AWS adapter modules.
 *
 * Module structure:
 *   types.ts        — Type definitions (AwsAdapterConfig, AwsClient, result types, etc.)
 *   constants.ts    — Static data (relationship rules, service mappings, cost tables)
 *   utils.ts        — Utility functions (field resolution, ID extraction, node matching)
 *   context.ts      — Shared AwsAdapterContext interface for domain module delegation
 *   compute.ts      — EC2 deeper discovery (ASGs, LBs, Target Groups)
 *   database.ts     — ElastiCache + RDS deeper discovery
 *   organization.ts — AWS Organization structure (accounts, OUs, SCPs)
 *   backup.ts       — AWS Backup vaults, plans, protected resources
 *   automation.ts   — EventBridge rules + Step Functions
 *   cicd.ts         — CodePipeline, CodeBuild, CodeDeploy
 *   cognito.ts      — User Pools, Identity Pools, App Clients
 *   enrichment.ts   — Post-discovery enrichment (tags, events, observability, compliance)
 *   cost.ts         — Cost Explorer enrichment, forecasting, optimization
 *   security.ts     — Security posture, GuardDuty, CloudTrail changes
 */

// Context
export type { AwsAdapterContext } from "./context.js";

// Types
export type {
  AwsRelationshipRule,
  AwsServiceMapping,
  AwsAdapterConfig,
  AwsManagerOverrides,
  AwsClientFactory,
  AwsClient,
  AwsForecastResult,
  AwsOptimizationResult,
  AwsUnusedResourcesResult,
  AwsChangeEvent,
  AwsIncrementalChanges,
  AwsSecurityPosture,
} from "./types.js";

// Constants
export {
  AWS_RELATIONSHIP_RULES,
  AWS_SERVICE_MAPPINGS,
  EC2_COSTS,
  RDS_COSTS,
  ELASTICACHE_COSTS_AWS,
  STORAGE_COSTS,
  AWS_SERVICE_TO_RESOURCE_TYPE,
  DEFAULT_REGIONS,
  AWS_SERVICE_TO_POOL_NAME,
  AWS_SDK_PACKAGES,
  GPU_INSTANCE_REGEX,
  AI_SERVICE_PREFIXES,
} from "./constants.js";

// Utilities
export {
  resolveFieldPathRaw,
  resolveFieldPath,
  extractResourceId,
  findNodeByArnOrId,
  reverseRelationship,
  buildAwsNodeId,
} from "./utils.js";

// Domain Modules
export { discoverEC2Deeper } from "./compute.js";
export { discoverElastiCache, discoverRDSDeeper } from "./database.js";
export { discoverOrganization } from "./organization.js";
export { discoverBackupResources } from "./backup.js";
export { discoverAutomation } from "./automation.js";
export { discoverCICD } from "./cicd.js";
export { discoverCognito } from "./cognito.js";
export {
  enrichWithTags,
  enrichWithEventSources,
  enrichWithObservability,
  enrichWithDeeperDiscovery,
  enrichWithCompliance,
} from "./enrichment.js";
export {
  enrichWithCostExplorer,
  forecastCosts,
  getOptimizationRecommendations,
  findUnusedResources,
} from "./cost.js";
export {
  getIncrementalChanges,
  getSecurityPosture,
  enrichWithSecurity,
} from "./security.js";
