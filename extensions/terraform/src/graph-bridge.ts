/**
 * Terraform → Knowledge Graph Bridge
 *
 * Converts parsed Terraform state into Knowledge Graph nodes and edges,
 * enabling the KG to track Terraform-managed resources with full lineage.
 *
 * Direction: Terraform → KG (the reverse of codify-tools.ts which goes KG → Terraform).
 */

import type {
  ParsedResource,
  CloudProvider,
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphStorage,
} from "./types.js";

// ── Terraform type → KG resource type mapping ──────────────────────────────────

const TF_TYPE_MAP: Record<string, GraphResourceType> = {
  // AWS compute
  aws_instance: "compute",
  aws_launch_template: "compute",
  aws_autoscaling_group: "compute",
  aws_spot_instance_request: "compute",
  // AWS containers
  aws_ecs_cluster: "cluster",
  aws_ecs_service: "container",
  aws_ecs_task_definition: "container",
  aws_eks_cluster: "cluster",
  aws_eks_node_group: "cluster",
  // AWS serverless
  aws_lambda_function: "serverless-function",
  aws_lambda_layer_version: "serverless-function",
  // AWS storage
  aws_s3_bucket: "storage",
  aws_s3_bucket_policy: "storage",
  aws_ebs_volume: "storage",
  aws_efs_file_system: "storage",
  // AWS database
  aws_db_instance: "database",
  aws_rds_cluster: "database",
  aws_dynamodb_table: "database",
  aws_elasticache_cluster: "cache",
  aws_elasticache_replication_group: "cache",
  // AWS network
  aws_vpc: "vpc",
  aws_subnet: "subnet",
  aws_security_group: "security-group",
  aws_internet_gateway: "network",
  aws_nat_gateway: "nat-gateway",
  aws_route_table: "network",
  aws_route53_zone: "dns",
  aws_route53_record: "dns",
  aws_lb: "load-balancer",
  aws_alb: "load-balancer",
  aws_elb: "load-balancer",
  aws_lb_target_group: "load-balancer",
  aws_cloudfront_distribution: "cdn",
  aws_api_gateway_rest_api: "api-gateway",
  aws_apigatewayv2_api: "api-gateway",
  // AWS IAM
  aws_iam_role: "iam-role",
  aws_iam_policy: "policy",
  aws_iam_user: "identity",
  // AWS messaging
  aws_sqs_queue: "queue",
  aws_sns_topic: "topic",
  aws_kinesis_stream: "stream",
  // AWS secrets
  aws_secretsmanager_secret: "secret",
  aws_ssm_parameter: "secret",
  aws_kms_key: "secret",
  aws_acm_certificate: "certificate",

  // Azure compute
  azurerm_virtual_machine: "compute",
  azurerm_linux_virtual_machine: "compute",
  azurerm_windows_virtual_machine: "compute",
  azurerm_virtual_machine_scale_set: "compute",
  // Azure containers
  azurerm_kubernetes_cluster: "cluster",
  azurerm_container_group: "container",
  azurerm_container_registry: "container",
  // Azure serverless
  azurerm_function_app: "serverless-function",
  azurerm_linux_function_app: "serverless-function",
  // Azure storage
  azurerm_storage_account: "storage",
  azurerm_storage_container: "storage",
  azurerm_managed_disk: "storage",
  // Azure database
  azurerm_mssql_server: "database",
  azurerm_mssql_database: "database",
  azurerm_postgresql_server: "database",
  azurerm_postgresql_flexible_server: "database",
  azurerm_cosmosdb_account: "database",
  azurerm_redis_cache: "cache",
  // Azure network
  azurerm_virtual_network: "vpc",
  azurerm_subnet: "subnet",
  azurerm_network_security_group: "security-group",
  azurerm_public_ip: "network",
  azurerm_lb: "load-balancer",
  azurerm_application_gateway: "load-balancer",
  azurerm_dns_zone: "dns",
  azurerm_cdn_profile: "cdn",
  azurerm_api_management: "api-gateway",
  // Azure identity
  azurerm_key_vault: "secret",
  azurerm_key_vault_secret: "secret",

  // GCP compute
  google_compute_instance: "compute",
  google_compute_instance_group: "compute",
  google_compute_instance_template: "compute",
  // GCP containers
  google_container_cluster: "cluster",
  google_container_node_pool: "cluster",
  // GCP serverless
  google_cloudfunctions_function: "serverless-function",
  google_cloudfunctions2_function: "serverless-function",
  google_cloud_run_service: "serverless-function",
  // GCP storage
  google_storage_bucket: "storage",
  google_compute_disk: "storage",
  // GCP database
  google_sql_database_instance: "database",
  google_spanner_instance: "database",
  google_redis_instance: "cache",
  google_bigtable_instance: "database",
  // GCP network
  google_compute_network: "vpc",
  google_compute_subnetwork: "subnet",
  google_compute_firewall: "security-group",
  google_compute_forwarding_rule: "load-balancer",
  google_compute_global_forwarding_rule: "load-balancer",
  google_dns_managed_zone: "dns",
  google_compute_backend_service: "load-balancer",
  // GCP messaging
  google_pubsub_topic: "topic",
  google_pubsub_subscription: "queue",
  // GCP secrets
  google_secret_manager_secret: "secret",
  google_kms_crypto_key: "secret",
};

/** Map a short provider name to a CloudProvider enum value. */
function mapProvider(providerShort: string): CloudProvider {
  switch (providerShort) {
    case "aws": return "aws";
    case "azurerm":
    case "azure": return "azure";
    case "google":
    case "gcp": return "gcp";
    case "kubernetes": return "kubernetes";
    default: return "custom";
  }
}

/** Map a Terraform resource type to a GraphResourceType. */
export function tfResourceTypeToGraphType(tfType: string): GraphResourceType {
  return TF_TYPE_MAP[tfType] ?? "custom";
}

/**
 * Build a deterministic KG node ID from a Terraform parsed resource.
 *
 * Format: `{provider}:{account}:{region}:{resourceType}:{address}`
 * If account/region are unavailable, defaults are used.
 */
function buildNodeId(resource: ParsedResource, provider: CloudProvider, resourceType: GraphResourceType): string {
  const account = (resource.attributes.account_id as string)
    ?? (resource.attributes.subscription_id as string)
    ?? (resource.attributes.project as string)
    ?? "default";
  const region = (resource.attributes.region as string)
    ?? (resource.attributes.location as string)
    ?? (resource.attributes.zone as string)
    ?? "global";

  return `${provider}:${account}:${region}:${resourceType}:${resource.address}`;
}

/** Extract a human-readable name from resource attributes. */
function extractName(resource: ParsedResource): string {
  const tags = resource.attributes.tags as Record<string, string> | undefined;
  return tags?.Name
    ?? (resource.attributes.name as string)
    ?? (resource.attributes.display_name as string)
    ?? resource.name;
}

/** Extract region from resource attributes. */
function extractRegion(resource: ParsedResource): string {
  return (resource.attributes.region as string)
    ?? (resource.attributes.location as string)
    ?? (resource.attributes.availability_zone as string)
    ?? (resource.attributes.zone as string)
    ?? "global";
}

/** Extract account from resource attributes. */
function extractAccount(resource: ParsedResource): string {
  return (resource.attributes.account_id as string)
    ?? (resource.attributes.subscription_id as string)
    ?? (resource.attributes.project as string)
    ?? (resource.attributes.project_id as string)
    ?? "default";
}

/** Extract tags from resource attributes. */
function extractTags(resource: ParsedResource): Record<string, string> {
  const rawTags = resource.attributes.tags;
  if (rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)) {
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawTags)) {
      tags[k] = String(v);
    }
    return tags;
  }
  return {};
}

/** Estimate status from resource attributes. */
function inferStatus(resource: ParsedResource): "running" | "stopped" | "unknown" {
  const status = resource.attributes.status as string | undefined;
  const state = resource.attributes.state as string | undefined;
  const raw = status ?? state;
  if (!raw) return "running"; // Terraform state implies the resource exists

  const lower = raw.toLowerCase();
  if (lower === "running" || lower === "available" || lower === "active" || lower === "in-use") return "running";
  if (lower === "stopped" || lower === "deallocated" || lower === "terminated") return "stopped";
  return "unknown";
}

// ── Conversion Functions ────────────────────────────────────────────────────────

/**
 * Convert an array of ParsedResources into Knowledge Graph node inputs.
 *
 * Nodes are tagged with `managedBy: "terraform"` and `tfAddress` in metadata
 * per roadmap spec.
 */
export function stateToGraphNodes(resources: ParsedResource[]): GraphNodeInput[] {
  return resources
    .filter((r) => r.mode === "managed") // skip data sources
    .map((resource) => {
      const provider = mapProvider(resource.providerShort);
      const resourceType = tfResourceTypeToGraphType(resource.type);
      const id = buildNodeId(resource, provider, resourceType);

      const node: GraphNodeInput = {
        id,
        provider,
        resourceType,
        nativeId: (resource.attributes.arn as string)
          ?? (resource.attributes.id as string)
          ?? (resource.attributes.self_link as string)
          ?? resource.address,
        name: extractName(resource),
        region: extractRegion(resource),
        account: extractAccount(resource),
        status: inferStatus(resource),
        tags: extractTags(resource),
        metadata: {
          managedBy: "terraform",
          tfAddress: resource.address,
          tfType: resource.type,
          tfProvider: resource.provider,
          ...pickMetadata(resource),
        },
        costMonthly: null,
        owner: null,
        createdAt: null,
      };

      return node;
    });
}

/** Pick relevant metadata fields from resource attributes (excluding large/noise fields). */
function pickMetadata(resource: ParsedResource): Record<string, unknown> {
  const skip = new Set([
    "id", "arn", "self_link", "tags", "tags_all",
    "account_id", "subscription_id", "project", "project_id",
    "region", "location", "zone", "availability_zone",
    "name", "display_name", "status", "state",
  ]);

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource.attributes)) {
    if (skip.has(key)) continue;
    // Skip large nested objects (keep simple values and short arrays)
    if (typeof value === "object" && value !== null && !Array.isArray(value)) continue;
    if (Array.isArray(value) && value.length > 10) continue;
    meta[key] = value;
  }
  return meta;
}

/**
 * Convert dependency relationships from ParsedResources into Knowledge Graph edges.
 *
 * Each dependency becomes a "depends-on" edge with discoveredVia "iac-parse".
 */
export function dependenciesToGraphEdges(resources: ParsedResource[]): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = [];
  const managedResources = resources.filter((r) => r.mode === "managed");

  // Build lookup from address → node ID
  const addressToNodeId = new Map<string, string>();
  for (const resource of managedResources) {
    const provider = mapProvider(resource.providerShort);
    const resourceType = tfResourceTypeToGraphType(resource.type);
    const nodeId = buildNodeId(resource, provider, resourceType);
    addressToNodeId.set(resource.address, nodeId);
  }

  for (const resource of managedResources) {
    const provider = mapProvider(resource.providerShort);
    const resourceType = tfResourceTypeToGraphType(resource.type);
    const sourceNodeId = buildNodeId(resource, provider, resourceType);

    for (const dep of resource.dependencies) {
      const targetNodeId = addressToNodeId.get(dep);
      if (!targetNodeId) continue; // skip references to data sources or unknown resources

      edges.push({
        id: `edge:${sourceNodeId}->depends-on->${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        relationshipType: "depends-on",
        confidence: 1.0, // config-derived — highest confidence
        discoveredVia: "iac-parse",
        metadata: {
          tfSourceAddress: resource.address,
          tfTargetAddress: dep,
        },
      });
    }
  }

  return edges;
}

/**
 * Sync parsed Terraform state into the Knowledge Graph.
 *
 * Upserts all managed resources as nodes and their dependencies as edges.
 * Returns counts of synced nodes and edges.
 */
export async function syncStateToGraph(
  storage: GraphStorage,
  resources: ParsedResource[],
): Promise<{ nodesUpserted: number; edgesUpserted: number }> {
  const nodes = stateToGraphNodes(resources);
  const edges = dependenciesToGraphEdges(resources);

  if (nodes.length > 0) await storage.upsertNodes(nodes);
  if (edges.length > 0) await storage.upsertEdges(edges);

  return { nodesUpserted: nodes.length, edgesUpserted: edges.length };
}

/**
 * Compare Knowledge Graph state with current Terraform state.
 *
 * Returns resources that exist in TF but not in KG (new), in KG but not TF
 * (removed), and resources in both (shared).
 */
export async function diffGraphVsState(
  storage: GraphStorage,
  resources: ParsedResource[],
): Promise<{
  newInTerraform: ParsedResource[];
  removedFromTerraform: string[];
  shared: string[];
}> {
  const tfNodes = stateToGraphNodes(resources);
  const tfNodeIds = new Set(tfNodes.map((n) => n.id));

  // Query KG for all Terraform-managed nodes
  const kgNodes = await storage.queryNodes({});
  const tfManagedKgNodes = kgNodes.filter(
    (n) => (n.metadata as Record<string, unknown>).managedBy === "terraform",
  );

  const kgNodeIds = new Set(tfManagedKgNodes.map((n) => n.id));

  const newInTerraform: ParsedResource[] = [];
  const shared: string[] = [];

  for (const resource of resources.filter((r) => r.mode === "managed")) {
    const provider = mapProvider(resource.providerShort);
    const resourceType = tfResourceTypeToGraphType(resource.type);
    const nodeId = buildNodeId(resource, provider, resourceType);

    if (kgNodeIds.has(nodeId)) {
      shared.push(nodeId);
    } else {
      newInTerraform.push(resource);
    }
  }

  const removedFromTerraform = tfManagedKgNodes
    .filter((n) => !tfNodeIds.has(n.id))
    .map((n) => n.id);

  return { newInTerraform, removedFromTerraform, shared };
}
