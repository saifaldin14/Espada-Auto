/**
 * AWS Adapter — Module Index
 *
 * Re-exports all public symbols from the decomposed AWS adapter modules.
 * This maintains backward compatibility: consumers can import from
 * `./adapters/aws/index.js` (or `./adapters/aws.js` via the original file)
 * and get the same public API.
 *
 * Module structure:
 *   types.ts      — Type definitions (AwsAdapterConfig, AwsClient, result types, etc.)
 *   constants.ts  — Static data (relationship rules, service mappings, cost tables)
 *   utils.ts      — Utility functions (field resolution, ID extraction, node matching)
 *
 * The main AwsDiscoveryAdapter class remains in the original aws.ts file
 * until the full decomposition of its methods into separate domain modules
 * is complete.
 */

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
