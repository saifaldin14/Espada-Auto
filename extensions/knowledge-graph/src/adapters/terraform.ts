/**
 * Infrastructure Knowledge Graph — Terraform State Adapter
 *
 * Parses Terraform state files (v4 JSON format) and maps resources
 * and their relationships into the universal graph model.
 *
 * This is the fastest path to a populated knowledge graph — no cloud
 * credentials required, just a `terraform.tfstate` file.
 */

import { readFile } from "node:fs/promises";
import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphRelationshipType,
  CloudProvider,
} from "../types.js";
import type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

// =============================================================================
// Terraform State v4 Schema Types
// =============================================================================

/** Top-level Terraform state file structure. */
export type TerraformState = {
  version: number;
  terraform_version: string;
  serial: number;
  lineage: string;
  outputs?: Record<string, TerraformOutput>;
  resources: TerraformResource[];
};

export type TerraformOutput = {
  value: unknown;
  type: unknown;
  sensitive?: boolean;
};

export type TerraformResource = {
  module?: string;
  mode: "managed" | "data";
  type: string;
  name: string;
  provider: string;
  depends_on?: string[];
  instances: TerraformInstance[];
};

export type TerraformInstance = {
  schema_version: number;
  attributes: Record<string, unknown>;
  attributes_flat?: Record<string, string>;
  sensitive_attributes?: string[];
  private?: string;
  dependencies?: string[];
  create_before_destroy?: boolean;
  index_key?: string | number;
};

// =============================================================================
// Resource Type Mapping: Terraform → Graph
// =============================================================================

/**
 * Maps Terraform resource types to graph resource types.
 * Any resource type not in this map gets classified as "custom".
 */
export const TERRAFORM_TYPE_MAP: Record<string, { graphType: GraphResourceType; provider: CloudProvider }> = {
  // --- AWS ---
  aws_instance: { graphType: "compute", provider: "aws" },
  aws_launch_template: { graphType: "compute", provider: "aws" },
  aws_autoscaling_group: { graphType: "compute", provider: "aws" },
  aws_spot_instance_request: { graphType: "compute", provider: "aws" },
  aws_vpc: { graphType: "vpc", provider: "aws" },
  aws_subnet: { graphType: "subnet", provider: "aws" },
  aws_security_group: { graphType: "security-group", provider: "aws" },
  aws_security_group_rule: { graphType: "security-group", provider: "aws" },
  aws_network_interface: { graphType: "network", provider: "aws" },
  aws_eip: { graphType: "network", provider: "aws" },
  aws_internet_gateway: { graphType: "network", provider: "aws" },
  aws_nat_gateway: { graphType: "nat-gateway", provider: "aws" },
  aws_route_table: { graphType: "network", provider: "aws" },
  aws_route_table_association: { graphType: "network", provider: "aws" },
  aws_vpn_gateway: { graphType: "network", provider: "aws" },
  aws_customer_gateway: { graphType: "network", provider: "aws" },
  aws_vpc_peering_connection: { graphType: "network", provider: "aws" },
  aws_db_instance: { graphType: "database", provider: "aws" },
  aws_db_cluster: { graphType: "database", provider: "aws" },
  aws_rds_cluster: { graphType: "database", provider: "aws" },
  aws_rds_cluster_instance: { graphType: "database", provider: "aws" },
  aws_dynamodb_table: { graphType: "database", provider: "aws" },
  aws_elasticache_cluster: { graphType: "cache", provider: "aws" },
  aws_elasticache_replication_group: { graphType: "cache", provider: "aws" },
  aws_s3_bucket: { graphType: "storage", provider: "aws" },
  aws_s3_bucket_policy: { graphType: "policy", provider: "aws" },
  aws_ebs_volume: { graphType: "storage", provider: "aws" },
  aws_efs_file_system: { graphType: "storage", provider: "aws" },
  aws_lambda_function: { graphType: "serverless-function", provider: "aws" },
  aws_lambda_event_source_mapping: { graphType: "serverless-function", provider: "aws" },
  aws_lambda_permission: { graphType: "policy", provider: "aws" },
  aws_ecs_cluster: { graphType: "cluster", provider: "aws" },
  aws_ecs_service: { graphType: "container", provider: "aws" },
  aws_ecs_task_definition: { graphType: "container", provider: "aws" },
  aws_eks_cluster: { graphType: "cluster", provider: "aws" },
  aws_eks_node_group: { graphType: "compute", provider: "aws" },
  aws_lb: { graphType: "load-balancer", provider: "aws" },
  aws_alb: { graphType: "load-balancer", provider: "aws" },
  aws_lb_target_group: { graphType: "load-balancer", provider: "aws" },
  aws_lb_listener: { graphType: "load-balancer", provider: "aws" },
  aws_sqs_queue: { graphType: "queue", provider: "aws" },
  aws_sns_topic: { graphType: "topic", provider: "aws" },
  aws_sns_topic_subscription: { graphType: "topic", provider: "aws" },
  aws_api_gateway_rest_api: { graphType: "api-gateway", provider: "aws" },
  aws_apigatewayv2_api: { graphType: "api-gateway", provider: "aws" },
  aws_cloudfront_distribution: { graphType: "cdn", provider: "aws" },
  aws_route53_zone: { graphType: "dns", provider: "aws" },
  aws_route53_record: { graphType: "dns", provider: "aws" },
  aws_acm_certificate: { graphType: "certificate", provider: "aws" },
  aws_iam_role: { graphType: "iam-role", provider: "aws" },
  aws_iam_policy: { graphType: "policy", provider: "aws" },
  aws_iam_role_policy_attachment: { graphType: "policy", provider: "aws" },
  aws_iam_instance_profile: { graphType: "iam-role", provider: "aws" },
  aws_iam_user: { graphType: "identity", provider: "aws" },
  aws_secretsmanager_secret: { graphType: "secret", provider: "aws" },
  aws_kms_key: { graphType: "secret", provider: "aws" },
  aws_kinesis_stream: { graphType: "stream", provider: "aws" },
  aws_sagemaker_endpoint: { graphType: "compute", provider: "aws" },
  aws_sagemaker_notebook_instance: { graphType: "compute", provider: "aws" },

  // --- Azure ---
  azurerm_virtual_machine: { graphType: "compute", provider: "azure" },
  azurerm_linux_virtual_machine: { graphType: "compute", provider: "azure" },
  azurerm_windows_virtual_machine: { graphType: "compute", provider: "azure" },
  azurerm_virtual_network: { graphType: "vpc", provider: "azure" },
  azurerm_subnet: { graphType: "subnet", provider: "azure" },
  azurerm_network_security_group: { graphType: "security-group", provider: "azure" },
  azurerm_network_interface: { graphType: "network", provider: "azure" },
  azurerm_public_ip: { graphType: "network", provider: "azure" },
  azurerm_lb: { graphType: "load-balancer", provider: "azure" },
  azurerm_application_gateway: { graphType: "load-balancer", provider: "azure" },
  azurerm_storage_account: { graphType: "storage", provider: "azure" },
  azurerm_storage_container: { graphType: "storage", provider: "azure" },
  azurerm_managed_disk: { graphType: "storage", provider: "azure" },
  azurerm_mssql_server: { graphType: "database", provider: "azure" },
  azurerm_mssql_database: { graphType: "database", provider: "azure" },
  azurerm_cosmosdb_account: { graphType: "database", provider: "azure" },
  azurerm_postgresql_server: { graphType: "database", provider: "azure" },
  azurerm_postgresql_flexible_server: { graphType: "database", provider: "azure" },
  azurerm_redis_cache: { graphType: "cache", provider: "azure" },
  azurerm_function_app: { graphType: "serverless-function", provider: "azure" },
  azurerm_linux_function_app: { graphType: "serverless-function", provider: "azure" },
  azurerm_kubernetes_cluster: { graphType: "cluster", provider: "azure" },
  azurerm_container_group: { graphType: "container", provider: "azure" },
  azurerm_container_registry: { graphType: "container", provider: "azure" },
  azurerm_dns_zone: { graphType: "dns", provider: "azure" },
  azurerm_key_vault: { graphType: "secret", provider: "azure" },
  azurerm_cognitive_account: { graphType: "compute", provider: "azure" },

  // --- GCP ---
  google_compute_instance: { graphType: "compute", provider: "gcp" },
  google_compute_network: { graphType: "vpc", provider: "gcp" },
  google_compute_subnetwork: { graphType: "subnet", provider: "gcp" },
  google_compute_firewall: { graphType: "security-group", provider: "gcp" },
  google_compute_address: { graphType: "network", provider: "gcp" },
  google_compute_forwarding_rule: { graphType: "load-balancer", provider: "gcp" },
  google_storage_bucket: { graphType: "storage", provider: "gcp" },
  google_sql_database_instance: { graphType: "database", provider: "gcp" },
  google_redis_instance: { graphType: "cache", provider: "gcp" },
  google_cloudfunctions_function: { graphType: "serverless-function", provider: "gcp" },
  google_cloudfunctions2_function: { graphType: "serverless-function", provider: "gcp" },
  google_container_cluster: { graphType: "cluster", provider: "gcp" },
  google_container_node_pool: { graphType: "compute", provider: "gcp" },
  google_pubsub_topic: { graphType: "topic", provider: "gcp" },
  google_pubsub_subscription: { graphType: "topic", provider: "gcp" },
  google_dns_managed_zone: { graphType: "dns", provider: "gcp" },
  google_kms_key_ring: { graphType: "secret", provider: "gcp" },
  google_secret_manager_secret: { graphType: "secret", provider: "gcp" },

  // --- Kubernetes ---
  kubernetes_namespace: { graphType: "network", provider: "kubernetes" },
  kubernetes_deployment: { graphType: "container", provider: "kubernetes" },
  kubernetes_service: { graphType: "load-balancer", provider: "kubernetes" },
  kubernetes_ingress: { graphType: "load-balancer", provider: "kubernetes" },
  kubernetes_config_map: { graphType: "secret", provider: "kubernetes" },
  kubernetes_secret: { graphType: "secret", provider: "kubernetes" },
  kubernetes_persistent_volume_claim: { graphType: "storage", provider: "kubernetes" },
  kubernetes_stateful_set: { graphType: "container", provider: "kubernetes" },
};

// =============================================================================
// Attribute-Based Relationship Extraction Rules
// =============================================================================

/**
 * Rules for extracting relationships from Terraform resource attributes.
 * These map attribute names to the target resource type and relationship.
 */
type TerraformRelationshipRule = {
  /** Attribute name in the Terraform resource. */
  attribute: string;
  /** Relationship type for the edge. */
  relationship: GraphRelationshipType;
  /** Whether the attribute holds an array of references. */
  isArray: boolean;
};

/**
 * Common attribute names that indicate relationships between resources.
 * These patterns work across AWS, Azure, and GCP.
 */
export const ATTRIBUTE_RELATIONSHIP_RULES: TerraformRelationshipRule[] = [
  // Network containment
  { attribute: "vpc_id", relationship: "runs-in", isArray: false },
  { attribute: "subnet_id", relationship: "runs-in", isArray: false },
  { attribute: "subnet_ids", relationship: "runs-in", isArray: true },
  { attribute: "network_interface_ids", relationship: "attached-to", isArray: true },

  // Security
  { attribute: "security_groups", relationship: "secured-by", isArray: true },
  { attribute: "security_group_ids", relationship: "secured-by", isArray: true },
  { attribute: "vpc_security_group_ids", relationship: "secured-by", isArray: true },
  { attribute: "security_group_id", relationship: "secured-by", isArray: false },
  { attribute: "network_security_group_id", relationship: "secured-by", isArray: false },

  // IAM / Identity
  { attribute: "role", relationship: "uses", isArray: false },
  { attribute: "role_arn", relationship: "uses", isArray: false },
  { attribute: "execution_role_arn", relationship: "uses", isArray: false },
  { attribute: "task_role_arn", relationship: "uses", isArray: false },
  { attribute: "iam_instance_profile", relationship: "uses", isArray: false },
  { attribute: "service_account_name", relationship: "uses", isArray: false },

  // Load balancing
  { attribute: "target_group_arn", relationship: "routes-to", isArray: false },
  { attribute: "target_group_arns", relationship: "routes-to", isArray: true },
  { attribute: "load_balancer_arn", relationship: "receives-from", isArray: false },

  // Database / Storage
  { attribute: "db_subnet_group_name", relationship: "runs-in", isArray: false },
  { attribute: "kms_key_id", relationship: "encrypts-with", isArray: false },
  { attribute: "kms_key_arn", relationship: "encrypts-with", isArray: false },
  { attribute: "bucket", relationship: "stores-in", isArray: false },
  { attribute: "s3_bucket", relationship: "stores-in", isArray: false },

  // Container / Cluster
  { attribute: "cluster_id", relationship: "member-of", isArray: false },
  { attribute: "cluster_name", relationship: "member-of", isArray: false },
  { attribute: "cluster_arn", relationship: "member-of", isArray: false },
  { attribute: "task_definition", relationship: "uses", isArray: false },

  // Messaging
  { attribute: "topic_arn", relationship: "publishes-to", isArray: false },
  { attribute: "dead_letter_config", relationship: "publishes-to", isArray: false },
  { attribute: "event_source_arn", relationship: "triggered-by", isArray: false },

  // DNS / CDN
  { attribute: "zone_id", relationship: "member-of", isArray: false },
  { attribute: "hosted_zone_id", relationship: "member-of", isArray: false },
  { attribute: "certificate_arn", relationship: "uses", isArray: false },

  // Azure specific
  { attribute: "resource_group_name", relationship: "member-of", isArray: false },
  { attribute: "virtual_network_name", relationship: "runs-in", isArray: false },

  // GCP specific
  { attribute: "network", relationship: "runs-in", isArray: false },
  { attribute: "subnetwork", relationship: "runs-in", isArray: false },
];

// =============================================================================
// AWS Cost Estimation (Static Lookup)
// =============================================================================

/**
 * Estimated monthly costs for common AWS instance types (us-east-1 pricing).
 * These are rough estimates for the scan report — not billing-accurate.
 */
const AWS_INSTANCE_COSTS: Record<string, number> = {
  // General Purpose
  "t3.micro": 7.59, "t3.small": 15.18, "t3.medium": 30.37, "t3.large": 60.74, "t3.xlarge": 121.47,
  "t3a.micro": 6.86, "t3a.small": 13.72, "t3a.medium": 27.45, "t3a.large": 54.90,
  "m5.large": 70.08, "m5.xlarge": 140.16, "m5.2xlarge": 280.32, "m5.4xlarge": 560.64,
  "m6i.large": 69.35, "m6i.xlarge": 138.70, "m6i.2xlarge": 277.40, "m6i.4xlarge": 554.80,
  "m7i.large": 72.82, "m7i.xlarge": 145.64, "m7i.2xlarge": 291.28,

  // Compute Optimized
  "c5.large": 62.05, "c5.xlarge": 124.10, "c5.2xlarge": 248.20,
  "c6i.large": 61.32, "c6i.xlarge": 122.64, "c6i.2xlarge": 245.28,

  // Memory Optimized
  "r5.large": 91.98, "r5.xlarge": 183.96, "r5.2xlarge": 367.92,
  "r6i.large": 91.25, "r6i.xlarge": 182.50, "r6i.2xlarge": 365.00,

  // GPU Instances (AI workloads)
  "p4d.24xlarge": 23689.44,
  "p5.48xlarge": 70560.00,
  "g5.xlarge": 766.44, "g5.2xlarge": 876.00, "g5.4xlarge": 1168.08, "g5.12xlarge": 4088.88,
  "g5.48xlarge": 11785.92,
  "inf2.xlarge": 546.72, "inf2.8xlarge": 1433.52, "inf2.24xlarge": 4584.48, "inf2.48xlarge": 9168.96,
  "trn1.2xlarge": 965.81, "trn1.32xlarge": 15453.00,
};

/**
 * Estimated monthly costs for common RDS instance types.
 */
const RDS_INSTANCE_COSTS: Record<string, number> = {
  "db.t3.micro": 11.68, "db.t3.small": 23.36, "db.t3.medium": 46.72, "db.t3.large": 93.44,
  "db.r5.large": 124.10, "db.r5.xlarge": 248.20, "db.r5.2xlarge": 496.40,
  "db.r6g.large": 118.26, "db.r6g.xlarge": 236.52, "db.r6g.2xlarge": 473.04,
  "db.m5.large": 94.17, "db.m5.xlarge": 188.34, "db.m5.2xlarge": 376.68,
};

/**
 * Estimated monthly costs for common ElastiCache node types.
 */
const ELASTICACHE_COSTS: Record<string, number> = {
  "cache.t3.micro": 9.50, "cache.t3.small": 19.00, "cache.t3.medium": 38.00,
  "cache.r5.large": 120.72, "cache.r5.xlarge": 241.44, "cache.r5.2xlarge": 482.88,
  "cache.m5.large": 109.50, "cache.m5.xlarge": 219.00,
};

// =============================================================================
// Terraform Adapter Configuration
// =============================================================================

export type TerraformAdapterConfig = {
  /** Path to the terraform.tfstate file. */
  statePath: string;
  /** Override provider detection (for mixed-provider states). */
  defaultProvider?: CloudProvider;
  /** Override account/subscription/project ID if not detectable. */
  defaultAccount?: string;
  /** Override region if not detectable. */
  defaultRegion?: string;
};

// =============================================================================
// Terraform Discovery Adapter
// =============================================================================

export class TerraformDiscoveryAdapter implements GraphDiscoveryAdapter {
  readonly provider: CloudProvider = "custom"; // Terraform spans multiple providers
  readonly displayName = "Terraform State";

  private config: TerraformAdapterConfig;
  private state: TerraformState | null = null;

  constructor(config: TerraformAdapterConfig) {
    this.config = config;
  }

  supportedResourceTypes(): GraphResourceType[] {
    return [...new Set(Object.values(TERRAFORM_TYPE_MAP).map((m) => m.graphType))];
  }

  /**
   * Parse and discover all resources from the Terraform state file.
   */
  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startMs = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: DiscoveryError[] = [];

    try {
      this.state = await this.parseStateFile();
    } catch (err) {
      return {
        provider: this.config.defaultProvider ?? "custom",
        nodes: [],
        edges: [],
        errors: [{ resourceType: "custom", message: `Failed to parse state file: ${err instanceof Error ? err.message : String(err)}` }],
        durationMs: Date.now() - startMs,
      };
    }

    // Build a lookup from Terraform address → node ID for relationship resolution
    const addressToNodeId = new Map<string, string>();

    // Phase 1: Create nodes from all resources
    for (const resource of this.state.resources) {
      // Skip data sources — they're read-only references, not managed resources
      if (resource.mode === "data") continue;

      // Apply resource type filter
      const typeInfo = TERRAFORM_TYPE_MAP[resource.type];
      if (options?.resourceTypes && typeInfo && !options.resourceTypes.includes(typeInfo.graphType)) {
        continue;
      }

      for (const instance of resource.instances) {
        try {
          const node = this.buildNode(resource, instance);
          if (!node) continue;

          // Apply tag filter
          if (options?.tags) {
            const match = Object.entries(options.tags).every(
              ([k, v]) => node.tags[k] === v,
            );
            if (!match) continue;
          }

          nodes.push(node);

          // Build address for cross-referencing
          const addr = this.buildTerraformAddress(resource, instance);
          addressToNodeId.set(addr, node.id);
        } catch (err) {
          errors.push({
            resourceType: typeInfo?.graphType ?? resource.type,
            message: `Failed to process ${resource.type}.${resource.name}: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    // Phase 2: Extract relationships
    for (const resource of this.state.resources) {
      if (resource.mode === "data") continue;

      for (const instance of resource.instances) {
        const addr = this.buildTerraformAddress(resource, instance);
        const sourceNodeId = addressToNodeId.get(addr);
        if (!sourceNodeId) continue;

        try {
          const resourceEdges = this.extractRelationships(
            sourceNodeId,
            resource,
            instance,
            nodes,
            addressToNodeId,
          );
          edges.push(...resourceEdges);
        } catch (err) {
          errors.push({
            resourceType: TERRAFORM_TYPE_MAP[resource.type]?.graphType ?? resource.type,
            message: `Failed to extract relationships for ${addr}: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    // Phase 3: Extract explicit depends_on relationships
    for (const resource of this.state.resources) {
      if (resource.mode === "data") continue;

      for (const instance of resource.instances) {
        // Collect dependency references from both instance.dependencies and resource.depends_on
        const deps: string[] = [
          ...(instance.dependencies ?? []),
          ...(resource.depends_on ?? []),
        ];
        if (deps.length === 0) continue;

        const addr = this.buildTerraformAddress(resource, instance);
        const sourceNodeId = addressToNodeId.get(addr);
        if (!sourceNodeId) continue;

        for (const dep of deps) {
          // deps are in form "module.x.resource_type.name" or "resource_type.name"
          const targetNodeId = this.resolveDepAddress(dep, addressToNodeId);
          if (!targetNodeId || targetNodeId === sourceNodeId) continue;

          const edgeId = `${sourceNodeId}--depends-on--${targetNodeId}`;
          // Avoid duplicate edges
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId,
              targetNodeId,
              relationshipType: "depends-on",
              confidence: 1.0, // Explicit depends_on is absolute
              discoveredVia: "iac-parse",
              metadata: { source: "depends_on" },
            });
          }
        }
      }
    }

    // Phase 4: Extract terraform_remote_state cross-state dependencies
    for (const resource of this.state.resources) {
      if (resource.mode !== "data" || resource.type !== "terraform_remote_state") continue;

      for (const instance of resource.instances) {
        const attrs = instance.attributes;
        if (!attrs) continue;

        let outputs = attrs["outputs"] as Record<string, unknown> | null;
        if (!outputs || typeof outputs !== "object") continue;

        // Unwrap Terraform's {value: {...}} wrapper if present
        if ("value" in outputs && typeof outputs["value"] === "object" && outputs["value"] !== null) {
          outputs = outputs["value"] as Record<string, unknown>;
        }

        // Extract referenced IDs from remote state outputs and link them
        // to local resources that reference them via data source attributes
        const remoteStateName = resource.name;
        const remoteBackend = (attrs["backend"] as string) ?? "unknown";
        const remoteWorkspace = (attrs["workspace"] as string) ?? null;

        // Build a map of output values that look like resource IDs
        for (const [outputName, outputValue] of Object.entries(outputs)) {
          if (typeof outputValue !== "string" || outputValue.length === 0) continue;

          // Check if any local node references this remote output value
          for (const node of nodes) {
            const nodeAttrs = this.getResourceAttrs(node.nativeId);
            if (!nodeAttrs) continue;

            // Deep-scan attributes for references to this remote state output
            if (this.attributeReferences(nodeAttrs, outputValue)) {
              // Find the node ID for this local resource
              const localNodeId = node.id;

              // Create a cross-state dependency edge
              // The target is the remote resource identified by the output value
              const targetNodeId = this.resolveReference(outputValue, new Map(nodes.map((n) => [n.nativeId, n.id])));

              if (targetNodeId && targetNodeId !== localNodeId) {
                const edgeId = `${localNodeId}--depends-on--${targetNodeId}`;
                if (!edges.some((e) => e.id === edgeId)) {
                  edges.push({
                    id: edgeId,
                    sourceNodeId: localNodeId,
                    targetNodeId,
                    relationshipType: "depends-on",
                    confidence: 0.85,
                    discoveredVia: "iac-parse",
                    metadata: {
                      source: "terraform_remote_state",
                      remoteName: remoteStateName,
                      remoteBackend,
                      remoteWorkspace,
                      outputName,
                    },
                  });
                }
              }
            }
          }

          // Also create placeholder nodes for remote outputs that are resource IDs
          // but don't match any local nodes (cross-state references)
          const isResourceId = /^(arn:|vpc-|subnet-|sg-|i-|vol-|igw-|nat-|lb-|eni-|\/subscriptions\/)/.test(outputValue);
          if (isResourceId) {
            const existingNode = nodes.find((n) => n.nativeId === outputValue);
            if (!existingNode) {
              // Infer provider and type from the ID pattern
              const remoteProvider = this.inferProviderFromId(outputValue);
              const remoteResourceType = this.inferResourceTypeFromId(outputValue);

              const remoteNodeId = `${remoteProvider}:remote:unknown:${remoteResourceType}:${outputValue}`;
              nodes.push({
                id: remoteNodeId,
                provider: remoteProvider,
                resourceType: remoteResourceType,
                nativeId: outputValue,
                name: `remote:${remoteStateName}.${outputName}`,
                region: "unknown",
                account: "remote",
                status: "unknown",
                tags: {},
                metadata: {
                  terraformType: "terraform_remote_state",
                  remoteStateName,
                  remoteBackend,
                  remoteWorkspace,
                  outputName,
                  isRemoteReference: true,
                  placeholder: true,
                },
                costMonthly: null,
                owner: null,
                createdAt: null,
              });

              // Link any local nodes that reference this remote ID
              for (const localNode of nodes) {
                if (localNode.id === remoteNodeId) continue;
                const localAttrs = this.getResourceAttrs(localNode.nativeId);
                if (localAttrs && this.attributeReferences(localAttrs, outputValue)) {
                  const edgeId = `${localNode.id}--depends-on--${remoteNodeId}`;
                  if (!edges.some((e) => e.id === edgeId)) {
                    edges.push({
                      id: edgeId,
                      sourceNodeId: localNode.id,
                      targetNodeId: remoteNodeId,
                      relationshipType: "depends-on",
                      confidence: 0.85,
                      discoveredVia: "iac-parse",
                      metadata: {
                        source: "terraform_remote_state",
                        remoteName: remoteStateName,
                        outputName,
                      },
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Apply limit if specified
    const limitedNodes = options?.limit ? nodes.slice(0, options.limit) : nodes;

    // Determine the primary provider from the resources
    const primaryProvider = this.detectPrimaryProvider(nodes);

    return {
      provider: primaryProvider,
      nodes: limitedNodes,
      edges,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  supportsIncrementalSync(): boolean {
    return false; // State files are point-in-time snapshots
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.parseStateFile();
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Parsing
  // ===========================================================================

  private async parseStateFile(): Promise<TerraformState> {
    const raw = await readFile(this.config.statePath, "utf-8");
    const state = JSON.parse(raw) as TerraformState;

    if (state.version !== 4) {
      throw new Error(
        `Unsupported Terraform state version: ${state.version} (expected 4)`,
      );
    }

    if (!Array.isArray(state.resources)) {
      throw new Error("Invalid Terraform state: missing resources array");
    }

    return state;
  }

  // ===========================================================================
  // Node Construction
  // ===========================================================================

  private buildNode(resource: TerraformResource, instance: TerraformInstance): GraphNodeInput | null {
    const attrs = instance.attributes;
    if (!attrs) return null;

    const typeInfo = TERRAFORM_TYPE_MAP[resource.type];
    const graphType = typeInfo?.graphType ?? "custom";
    const provider = typeInfo?.provider ?? this.config.defaultProvider ?? this.detectProviderFromType(resource.type);

    // Extract identifying info
    const nativeId = this.extractNativeId(resource, instance);
    const name = this.extractName(resource, instance);
    const region = this.extractRegion(attrs, provider);
    const account = this.extractAccount(attrs, resource.provider);
    const tags = this.extractTags(attrs);
    const status = this.inferStatus(attrs);
    const costMonthly = this.estimateCost(resource.type, attrs);

    const nodeId = `${provider}:${account}:${region}:${graphType}:${nativeId}`;

    return {
      id: nodeId,
      provider,
      resourceType: graphType,
      nativeId,
      name,
      region,
      account,
      status,
      tags,
      metadata: {
        terraformType: resource.type,
        terraformName: resource.name,
        terraformModule: resource.module,
        terraformProvider: resource.provider,
        ...this.extractRelevantMetadata(resource.type, attrs),
      },
      costMonthly,
      owner: tags["Owner"] ?? tags["owner"] ?? tags["team"] ?? tags["Team"] ?? null,
      createdAt: (attrs["create_date"] as string) ??
        (attrs["creation_date"] as string) ??
        (attrs["created_at"] as string) ??
        null,
    };
  }

  private extractNativeId(resource: TerraformResource, instance: TerraformInstance): string {
    const attrs = instance.attributes;

    // Try common ID fields in order of preference
    const idFields = ["arn", "id", "self_link", "name"];
    for (const field of idFields) {
      const value = attrs[field];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }

    // Fallback: construct from resource address
    const indexSuffix = instance.index_key != null ? `[${instance.index_key}]` : "";
    return `${resource.type}.${resource.name}${indexSuffix}`;
  }

  private extractName(resource: TerraformResource, instance: TerraformInstance): string {
    const attrs = instance.attributes;
    const tags = attrs["tags"] as Record<string, string> | null;

    // Try tags first, then name attributes, then resource name
    return (
      tags?.["Name"] ??
      tags?.["name"] ??
      (attrs["name"] as string) ??
      (attrs["function_name"] as string) ??
      (attrs["db_name"] as string) ??
      (attrs["cluster_name"] as string) ??
      (attrs["bucket"] as string) ??
      (attrs["domain_name"] as string) ??
      `${resource.type}.${resource.name}`
    );
  }

  private extractRegion(attrs: Record<string, unknown>, _provider: CloudProvider): string {
    // Try to extract from attributes
    if (typeof attrs["region"] === "string") return attrs["region"];
    if (typeof attrs["location"] === "string") return attrs["location"]; // Azure

    // Extract from ARN if available
    const arn = attrs["arn"] as string;
    if (arn?.startsWith("arn:")) {
      const parts = arn.split(":");
      if (parts[3] && parts[3].length > 0) return parts[3];
    }

    // Extract from availability_zone
    const az = attrs["availability_zone"] as string;
    if (az) {
      // us-east-1a → us-east-1
      return az.replace(/[a-z]$/, "");
    }

    return this.config.defaultRegion ?? "unknown";
  }

  private extractAccount(attrs: Record<string, unknown>, providerStr: string): string {
    // Try to extract from ARN
    const arn = attrs["arn"] as string;
    if (arn?.startsWith("arn:")) {
      const parts = arn.split(":");
      if (parts[4] && parts[4].length > 0) return parts[4];
    }

    // Azure: extract subscription from ID
    const azureId = attrs["id"] as string;
    if (azureId?.startsWith("/subscriptions/")) {
      const parts = azureId.split("/");
      if (parts[2]) return parts[2];
    }

    // GCP: project from self_link or project attribute
    if (typeof attrs["project"] === "string") return attrs["project"];

    // Extract from provider config string
    // e.g. 'provider["registry.terraform.io/hashicorp/aws"]'
    if (providerStr.includes("aws")) {
      const ownerIdField = attrs["owner_id"] as string;
      if (ownerIdField) return ownerIdField;
    }

    return this.config.defaultAccount ?? "unknown";
  }

  private extractTags(attrs: Record<string, unknown>): Record<string, string> {
    // Terraform stores tags as a flat object
    const tags = attrs["tags"] ?? attrs["tags_all"];
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
        if (typeof v === "string") result[k] = v;
      }
      return result;
    }

    // GCP uses labels instead of tags
    const labels = attrs["labels"];
    if (labels && typeof labels === "object" && !Array.isArray(labels)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(labels as Record<string, unknown>)) {
        if (typeof v === "string") result[k] = v;
      }
      return result;
    }

    return {};
  }

  private inferStatus(attrs: Record<string, unknown>): GraphNodeInput["status"] {
    const state = attrs["status"] ?? attrs["state"] ?? attrs["instance_state"];
    if (typeof state === "string") {
      const s = state.toLowerCase();
      if (s === "running" || s === "available" || s === "active" || s === "in-service" || s === "ready") return "running";
      if (s === "stopped" || s === "shutdown") return "stopped";
      if (s === "pending" || s === "provisioning" || s === "starting") return "pending";
      if (s === "creating") return "creating";
      if (s === "deleting" || s === "terminating" || s === "shutting-down") return "deleting";
      if (s === "terminated" || s === "deleted") return "deleted";
      if (s === "error" || s === "failed") return "error";
    }

    // If it exists in the state file, it's presumably running
    return "running";
  }

  // ===========================================================================
  // Cost Estimation
  // ===========================================================================

  private estimateCost(terraformType: string, attrs: Record<string, unknown>): number | null {
    // EC2 instances
    if (terraformType === "aws_instance" || terraformType === "aws_spot_instance_request") {
      const instanceType = attrs["instance_type"] as string;
      return instanceType ? (AWS_INSTANCE_COSTS[instanceType] ?? null) : null;
    }

    // RDS instances
    if (terraformType === "aws_db_instance" || terraformType === "aws_rds_cluster_instance") {
      const instanceClass = attrs["instance_class"] as string;
      return instanceClass ? (RDS_INSTANCE_COSTS[instanceClass] ?? null) : null;
    }

    // ElastiCache
    if (terraformType === "aws_elasticache_cluster" || terraformType === "aws_elasticache_replication_group") {
      const nodeType = attrs["node_type"] as string;
      return nodeType ? (ELASTICACHE_COSTS[nodeType] ?? null) : null;
    }

    // EKS node groups — estimate from instance types
    if (terraformType === "aws_eks_node_group") {
      const instanceTypes = attrs["instance_types"] as string[];
      if (instanceTypes?.[0]) {
        const desiredSize = (attrs["scaling_config"] as Record<string, unknown>)?.["desired_size"] as number ?? 1;
        const perInstance = AWS_INSTANCE_COSTS[instanceTypes[0]] ?? null;
        return perInstance ? perInstance * desiredSize : null;
      }
      return null;
    }

    // NAT Gateway (fixed rate)
    if (terraformType === "aws_nat_gateway") return 32.40;

    // EBS volumes
    if (terraformType === "aws_ebs_volume") {
      const size = attrs["size"] as number;
      const volumeType = attrs["type"] as string ?? "gp3";
      if (size) {
        const ratePerGb: Record<string, number> = { gp2: 0.10, gp3: 0.08, io1: 0.125, io2: 0.125, st1: 0.045, sc1: 0.015 };
        return size * (ratePerGb[volumeType] ?? 0.08);
      }
      return null;
    }

    // ELB / ALB
    if (terraformType === "aws_lb" || terraformType === "aws_alb") {
      return 16.20; // Base ALB cost ~$0.0225/hour
    }

    // SageMaker endpoints
    if (terraformType === "aws_sagemaker_endpoint") {
      return 300; // Rough estimate — varies wildly
    }

    // Lambda / Serverless — usage-based, can't estimate from state
    if (terraformType === "aws_lambda_function") return null;

    // S3 / DynamoDB — usage-based
    if (terraformType === "aws_s3_bucket" || terraformType === "aws_dynamodb_table") return null;

    return null;
  }

  // ===========================================================================
  // Metadata Extraction
  // ===========================================================================

  private extractRelevantMetadata(terraformType: string, attrs: Record<string, unknown>): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    if (terraformType === "aws_instance") {
      if (attrs["instance_type"]) meta["instanceType"] = attrs["instance_type"];
      if (attrs["ami"]) meta["ami"] = attrs["ami"];
      if (attrs["availability_zone"]) meta["availabilityZone"] = attrs["availability_zone"];
      if (attrs["public_ip"]) meta["publicIp"] = attrs["public_ip"];
      if (attrs["private_ip"]) meta["privateIp"] = attrs["private_ip"];

      // Flag GPU instances
      const instanceType = attrs["instance_type"] as string ?? "";
      if (/^(p[3-5]|g[4-6]|inf[12]|trn1|dl[12])/.test(instanceType)) {
        meta["isGpuInstance"] = true;
        meta["aiWorkload"] = true;
      }
    }

    if (terraformType === "aws_db_instance" || terraformType === "aws_rds_cluster_instance") {
      if (attrs["instance_class"]) meta["instanceClass"] = attrs["instance_class"];
      if (attrs["engine"]) meta["engine"] = attrs["engine"];
      if (attrs["engine_version"]) meta["engineVersion"] = attrs["engine_version"];
      if (attrs["multi_az"]) meta["multiAz"] = attrs["multi_az"];
      if (attrs["allocated_storage"]) meta["allocatedStorage"] = attrs["allocated_storage"];
    }

    if (terraformType === "aws_lambda_function") {
      if (attrs["runtime"]) meta["runtime"] = attrs["runtime"];
      if (attrs["memory_size"]) meta["memorySize"] = attrs["memory_size"];
      if (attrs["timeout"]) meta["timeout"] = attrs["timeout"];
      if (attrs["handler"]) meta["handler"] = attrs["handler"];
    }

    if (terraformType === "aws_eks_cluster" || terraformType === "aws_ecs_cluster") {
      if (attrs["version"]) meta["version"] = attrs["version"];
      if (attrs["platform_version"]) meta["platformVersion"] = attrs["platform_version"];
    }

    if (terraformType === "aws_s3_bucket") {
      if (attrs["versioning"]) meta["versioning"] = attrs["versioning"];
      if (attrs["server_side_encryption_configuration"]) meta["encrypted"] = true;
    }

    if (terraformType === "aws_sagemaker_endpoint" || terraformType === "aws_sagemaker_notebook_instance") {
      meta["aiWorkload"] = true;
      if (attrs["instance_type"]) meta["instanceType"] = attrs["instance_type"];
    }

    return meta;
  }

  // ===========================================================================
  // Relationship Extraction
  // ===========================================================================

  private extractRelationships(
    sourceNodeId: string,
    _resource: TerraformResource,
    instance: TerraformInstance,
    allNodes: GraphNodeInput[],
    _addressToNodeId: Map<string, string>,
  ): GraphEdgeInput[] {
    const edges: GraphEdgeInput[] = [];
    const attrs = instance.attributes;
    if (!attrs) return edges;

    // Build lookups for resolving attribute values to node IDs
    const nativeIdToNodeId = new Map<string, string>();
    for (const node of allNodes) {
      nativeIdToNodeId.set(node.nativeId, node.id);
      // Also index by common ID substrings (e.g. "vpc-abc123" from full ARN)
      if (node.nativeId.includes("/")) {
        const shortId = node.nativeId.split("/").pop()!;
        nativeIdToNodeId.set(shortId, node.id);
      }
      // Index by name for name-based references
      nativeIdToNodeId.set(node.name, node.id);
    }

    for (const rule of ATTRIBUTE_RELATIONSHIP_RULES) {
      const value = attrs[rule.attribute];
      if (value == null) continue;

      const values = rule.isArray && Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
        : typeof value === "string" && value.length > 0
          ? [value]
          : [];

      for (const ref of values) {
        const targetNodeId = this.resolveReference(ref, nativeIdToNodeId);
        if (!targetNodeId || targetNodeId === sourceNodeId) continue;

        const edgeId = `${sourceNodeId}--${rule.relationship}--${targetNodeId}`;
        if (!edges.some((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            sourceNodeId,
            targetNodeId,
            relationshipType: rule.relationship,
            confidence: 0.9,
            discoveredVia: "iac-parse",
            metadata: { attribute: rule.attribute, rawValue: ref },
          });
        }
      }
    }

    return edges;
  }

  /**
   * Resolve a Terraform attribute value to a graph node ID.
   * Handles ARNs, direct IDs, and name-based references.
   */
  private resolveReference(ref: string, nativeIdToNodeId: Map<string, string>): string | null {
    // Direct match
    if (nativeIdToNodeId.has(ref)) return nativeIdToNodeId.get(ref)!;

    // Try extracting resource ID from ARN
    if (ref.startsWith("arn:")) {
      const parts = ref.split(":");
      const resource = parts.slice(5).join(":");
      const slashIdx = resource.indexOf("/");
      const shortId = slashIdx >= 0 ? resource.slice(slashIdx + 1) : resource;
      if (nativeIdToNodeId.has(shortId)) return nativeIdToNodeId.get(shortId)!;
      if (nativeIdToNodeId.has(ref)) return nativeIdToNodeId.get(ref)!;
    }

    // Azure resource ID
    if (ref.startsWith("/subscriptions/")) {
      if (nativeIdToNodeId.has(ref)) return nativeIdToNodeId.get(ref)!;
    }

    // Try matching just the ID part (e.g. "sg-abc123" from a full reference)
    for (const [nativeId, nodeId] of nativeIdToNodeId) {
      if (nativeId.endsWith(ref) || ref.endsWith(nativeId)) return nodeId;
    }

    return null;
  }

  /**
   * Resolve a Terraform dependency address to a node ID.
   */
  private resolveDepAddress(dep: string, addressToNodeId: Map<string, string>): string | null {
    // Direct match
    if (addressToNodeId.has(dep)) return addressToNodeId.get(dep)!;

    // Try without module prefix
    const parts = dep.split(".");
    if (parts.length >= 2) {
      const shortAddr = parts.slice(-2).join(".");
      for (const [addr, nodeId] of addressToNodeId) {
        if (addr.endsWith(shortAddr)) return nodeId;
      }
    }

    return null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private buildTerraformAddress(resource: TerraformResource, instance: TerraformInstance): string {
    const module = resource.module ? `${resource.module}.` : "";
    const index = instance.index_key != null ? `[${JSON.stringify(instance.index_key)}]` : "";
    return `${module}${resource.type}.${resource.name}${index}`;
  }

  private detectProviderFromType(resourceType: string): CloudProvider {
    if (resourceType.startsWith("aws_")) return "aws";
    if (resourceType.startsWith("azurerm_") || resourceType.startsWith("azuread_")) return "azure";
    if (resourceType.startsWith("google_")) return "gcp";
    if (resourceType.startsWith("kubernetes_")) return "kubernetes";
    return this.config.defaultProvider ?? "custom";
  }

  private detectPrimaryProvider(nodes: GraphNodeInput[]): CloudProvider {
    const counts = new Map<CloudProvider, number>();
    for (const node of nodes) {
      counts.set(node.provider, (counts.get(node.provider) ?? 0) + 1);
    }

    let maxProvider: CloudProvider = this.config.defaultProvider ?? "aws";
    let maxCount = 0;
    for (const [provider, count] of counts) {
      if (count > maxCount) {
        maxProvider = provider;
        maxCount = count;
      }
    }

    return maxProvider;
  }

  // ===========================================================================
  // terraform_remote_state helpers
  // ===========================================================================

  /**
   * Get raw Terraform attributes for a node by its native ID.
   * Used for cross-referencing remote state outputs.
   */
  private getResourceAttrs(nativeId: string): Record<string, unknown> | null {
    if (!this.state) return null;
    for (const resource of this.state.resources) {
      if (resource.mode === "data") continue;
      for (const instance of resource.instances) {
        const attrs = instance.attributes;
        if (!attrs) continue;
        const id = attrs["arn"] ?? attrs["id"] ?? attrs["self_link"] ?? attrs["name"];
        if (id === nativeId) return attrs;
      }
    }
    return null;
  }

  /**
   * Check if any attribute value in the object tree references the given value.
   */
  private attributeReferences(attrs: Record<string, unknown>, value: string, depth = 0): boolean {
    // Guard against deeply nested or circular structures
    if (depth > 20) return false;
    for (const v of Object.values(attrs)) {
      if (v === value) return true;
      if (typeof v === "string" && v.includes(value)) return true;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item === value) return true;
          if (typeof item === "string" && item.includes(value)) return true;
          if (item && typeof item === "object") {
            if (this.attributeReferences(item as Record<string, unknown>, value, depth + 1)) return true;
          }
        }
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (this.attributeReferences(v as Record<string, unknown>, value, depth + 1)) return true;
      }
    }
    return false;
  }

  /**
   * Infer cloud provider from a resource ID pattern.
   */
  private inferProviderFromId(id: string): CloudProvider {
    if (id.startsWith("arn:aws:") || /^(vpc-|subnet-|sg-|i-|vol-|igw-|nat-|lb-|eni-)/.test(id)) return "aws";
    if (id.startsWith("/subscriptions/")) return "azure";
    if (id.startsWith("projects/")) return "gcp";
    return "custom";
  }

  /**
   * Infer resource type from a resource ID pattern.
   */
  private inferResourceTypeFromId(id: string): GraphResourceType {
    if (id.startsWith("vpc-")) return "vpc";
    if (id.startsWith("subnet-")) return "subnet";
    if (id.startsWith("sg-")) return "security-group";
    if (id.startsWith("i-")) return "compute";
    if (id.startsWith("vol-")) return "storage";
    if (id.startsWith("igw-") || id.startsWith("nat-")) return "nat-gateway";
    if (id.startsWith("lb-") || id.startsWith("arn:aws:elasticloadbalancing:")) return "load-balancer";
    if (id.startsWith("eni-")) return "network";
    if (id.includes("arn:aws:rds:")) return "database";
    if (id.includes("arn:aws:lambda:")) return "serverless-function";
    if (id.includes("arn:aws:s3:") || id.includes("arn:aws:s3:::")) return "storage";
    if (id.includes("arn:aws:sqs:")) return "queue";
    if (id.includes("arn:aws:sns:")) return "topic";
    if (id.includes("Microsoft.Compute")) return "compute";
    if (id.includes("Microsoft.Network/virtualNetworks")) return "vpc";
    if (id.includes("Microsoft.Sql") || id.includes("Microsoft.DBforPostgreSQL")) return "database";
    return "custom";
  }
}

// =============================================================================
// Convenience: parse state file without full adapter lifecycle
// =============================================================================

/**
 * Quick parse of a Terraform state file into discovery results.
 * Use this for one-shot scans without setting up the full engine.
 */
export async function parseTerraformState(
  statePath: string,
  options?: { defaultProvider?: CloudProvider; defaultAccount?: string; defaultRegion?: string },
): Promise<DiscoveryResult> {
  const adapter = new TerraformDiscoveryAdapter({
    statePath,
    defaultProvider: options?.defaultProvider,
    defaultAccount: options?.defaultAccount,
    defaultRegion: options?.defaultRegion,
  });
  return adapter.discover();
}
