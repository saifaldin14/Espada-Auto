export { AdapterRegistry } from "./types.js";
export type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

export { AwsDiscoveryAdapter, buildAwsNodeId, resolveFieldPath, extractResourceId } from "./aws.js";
export type { AwsAdapterConfig, AwsClientFactory, AwsClient, AwsRelationshipRule, AwsServiceMapping } from "./aws.js";
export { AWS_RELATIONSHIP_RULES, AWS_SERVICE_MAPPINGS } from "./aws.js";

export { AzureDiscoveryAdapter, buildAzureNodeId } from "./azure.js";
export type { AzureAdapterConfig, AzureResourceGraphClient, AzureQueryResult } from "./azure.js";
export { AZURE_RESOURCE_MAPPINGS, AZURE_RELATIONSHIP_RULES } from "./azure.js";

export { GcpDiscoveryAdapter, buildGcpNodeId } from "./gcp.js";
export type { GcpAdapterConfig, GcpClientFactory, GcpAssetClient } from "./gcp.js";
export { GCP_RESOURCE_MAPPINGS, GCP_RELATIONSHIP_RULES } from "./gcp.js";

export { TerraformDiscoveryAdapter, parseTerraformState, TERRAFORM_TYPE_MAP, ATTRIBUTE_RELATIONSHIP_RULES } from "./terraform.js";
export type { TerraformAdapterConfig } from "./terraform.js";

export { discoverCrossCloudRelationships, getCrossCloudSummary, CROSS_CLOUD_RULES } from "./cross-cloud.js";
export type { CrossCloudMatch, CrossCloudResult, CrossCloudRule } from "./cross-cloud.js";

export { KubernetesDiscoveryAdapter, buildK8sNodeId, extractK8sRelationships, extractCrossCloudEdges, detectHelmReleases, CROSS_CLOUD_ANNOTATIONS } from "./kubernetes.js";
export type { K8sAdapterConfig, K8sClient, K8sRawResource, K8sRelationshipRule, CrossCloudAnnotation, HelmRelease } from "./kubernetes.js";
