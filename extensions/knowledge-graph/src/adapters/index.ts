export { AdapterRegistry } from "./types.js";
export type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

export { AwsDiscoveryAdapter, buildAwsNodeId, resolveFieldPath, extractResourceId } from "./aws.js";
export type { AwsAdapterConfig, AwsRelationshipRule, AwsServiceMapping } from "./aws.js";
export { AWS_RELATIONSHIP_RULES, AWS_SERVICE_MAPPINGS } from "./aws.js";
