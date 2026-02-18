/**
 * Built-in cross-provider blueprint library.
 */

import type { Blueprint, CloudProvider } from "./types.js";

/**
 * Three-Tier Web App — compute + load balancer + database.
 */
function threeTierWebApp(provider: "aws" | "azure" | "gcp"): Blueprint {
  const providerConfigs: Record<string, { resources: Blueprint["resources"] }> = {
    aws: {
      resources: [
        {
          type: "aws_lb",
          name: "${{ inputs.name }}-alb",
          provider: "aws",
          config: { load_balancer_type: "application", internal: false },
        },
        {
          type: "aws_instance",
          name: "${{ inputs.name }}-web",
          provider: "aws",
          config: {
            ami: "${{ inputs.ami }}",
            instance_type: "${{ inputs.instance_type }}",
            subnet_id: "${{ inputs.subnet_id }}",
          },
        },
        {
          type: "aws_db_instance",
          name: "${{ inputs.name }}-db",
          provider: "aws",
          config: {
            engine: "${{ inputs.db_engine }}",
            instance_class: "db.t3.medium",
            allocated_storage: 20,
            multi_az: true,
          },
        },
      ],
    },
    azure: {
      resources: [
        {
          type: "azurerm_application_gateway",
          name: "${{ inputs.name }}-appgw",
          provider: "azure",
          config: { sku_name: "Standard_v2", sku_tier: "Standard_v2" },
        },
        {
          type: "azurerm_linux_virtual_machine",
          name: "${{ inputs.name }}-vm",
          provider: "azure",
          config: { size: "${{ inputs.vm_size }}", admin_username: "adminuser" },
        },
        {
          type: "azurerm_mssql_server",
          name: "${{ inputs.name }}-sql",
          provider: "azure",
          config: { version: "12.0", administrator_login: "sqladmin" },
        },
      ],
    },
    gcp: {
      resources: [
        {
          type: "google_compute_forwarding_rule",
          name: "${{ inputs.name }}-lb",
          provider: "gcp",
          config: { load_balancing_scheme: "EXTERNAL" },
        },
        {
          type: "google_compute_instance",
          name: "${{ inputs.name }}-vm",
          provider: "gcp",
          config: { machine_type: "${{ inputs.machine_type }}", zone: "${{ inputs.zone }}" },
        },
        {
          type: "google_sql_database_instance",
          name: "${{ inputs.name }}-db",
          provider: "gcp",
          config: { database_version: "POSTGRES_14", tier: "db-f1-micro" },
        },
      ],
    },
  };

  return {
    id: `three-tier-web-app-${provider}`,
    name: `Three-Tier Web App (${provider.toUpperCase()})`,
    description: "Classic web application with load balancer, compute, and managed database",
    version: "1.0.0",
    category: "web-app",
    providers: [provider],
    parameters: [
      { id: "name", name: "Application Name", type: "string", required: true, validation: { minLength: 3, maxLength: 50 } },
      { id: "region", name: "Region", type: "string", required: true },
    ],
    resources: providerConfigs[provider]!.resources,
    dependencies: [],
    policies: [],
    estimatedCostRange: [80, 400],
    tags: ["web", "three-tier", provider],
  };
}

/**
 * Serverless API — functions + API gateway + data store.
 */
function serverlessApi(provider: "aws" | "azure" | "gcp"): Blueprint {
  const configs: Record<string, Blueprint["resources"]> = {
    aws: [
      { type: "aws_lambda_function", name: "${{ inputs.name }}-fn", provider: "aws", config: { runtime: "${{ inputs.runtime }}", memory_size: 256, timeout: 30 } },
      { type: "aws_apigatewayv2_api", name: "${{ inputs.name }}-api", provider: "aws", config: { protocol_type: "HTTP" } },
      { type: "aws_dynamodb_table", name: "${{ inputs.name }}-table", provider: "aws", config: { billing_mode: "PAY_PER_REQUEST", hash_key: "id" } },
    ],
    azure: [
      { type: "azurerm_function_app", name: "${{ inputs.name }}-func", provider: "azure", config: { os_type: "Linux" } },
      { type: "azurerm_api_management", name: "${{ inputs.name }}-apim", provider: "azure", config: { sku_name: "Consumption_0" } },
      { type: "azurerm_cosmosdb_account", name: "${{ inputs.name }}-cosmos", provider: "azure", config: { offer_type: "Standard", kind: "GlobalDocumentDB" } },
    ],
    gcp: [
      { type: "google_cloudfunctions_function", name: "${{ inputs.name }}-fn", provider: "gcp", config: { runtime: "${{ inputs.runtime }}", available_memory_mb: 256 } },
      { type: "google_api_gateway_api", name: "${{ inputs.name }}-api", provider: "gcp", config: {} },
      { type: "google_firestore_database", name: "${{ inputs.name }}-db", provider: "gcp", config: { type: "FIRESTORE_NATIVE" } },
    ],
  };

  return {
    id: `serverless-api-${provider}`,
    name: `Serverless API (${provider.toUpperCase()})`,
    description: "API with serverless functions, API gateway, and NoSQL data store",
    version: "1.0.0",
    category: "serverless",
    providers: [provider],
    parameters: [
      { id: "name", name: "Service Name", type: "string", required: true },
      { id: "runtime", name: "Runtime", type: "select", required: true, options: ["nodejs18.x", "python3.11", "go1.x"] },
    ],
    resources: configs[provider]!,
    dependencies: [],
    policies: [],
    estimatedCostRange: [5, 100],
    tags: ["serverless", "api", provider],
  };
}

/**
 * Container Cluster — managed K8s + container registry.
 */
function containerCluster(provider: "aws" | "azure" | "gcp"): Blueprint {
  const configs: Record<string, Blueprint["resources"]> = {
    aws: [
      { type: "aws_eks_cluster", name: "${{ inputs.name }}-eks", provider: "aws", config: { version: "1.28" } },
      { type: "aws_ecr_repository", name: "${{ inputs.name }}-ecr", provider: "aws", config: { image_tag_mutability: "IMMUTABLE" } },
    ],
    azure: [
      { type: "azurerm_kubernetes_cluster", name: "${{ inputs.name }}-aks", provider: "azure", config: { dns_prefix: "${{ inputs.name }}", default_node_pool: { vm_size: "Standard_D2s_v3", node_count: 2 } } },
      { type: "azurerm_container_registry", name: "${{ inputs.name }}acr", provider: "azure", config: { sku: "Standard" } },
    ],
    gcp: [
      { type: "google_container_cluster", name: "${{ inputs.name }}-gke", provider: "gcp", config: { initial_node_count: 2 } },
      { type: "google_artifact_registry_repository", name: "${{ inputs.name }}-repo", provider: "gcp", config: { format: "DOCKER" } },
    ],
  };

  return {
    id: `container-cluster-${provider}`,
    name: `Container Cluster (${provider.toUpperCase()})`,
    description: "Managed Kubernetes cluster with container registry",
    version: "1.0.0",
    category: "container",
    providers: [provider],
    parameters: [
      { id: "name", name: "Cluster Name", type: "string", required: true },
      { id: "node_count", name: "Node Count", type: "number", required: false, default: 2, validation: { min: 1, max: 20 } },
    ],
    resources: configs[provider]!,
    dependencies: [],
    policies: [],
    estimatedCostRange: [150, 800],
    tags: ["kubernetes", "container", provider],
  };
}

/**
 * Static Website + CDN.
 */
function staticSite(provider: "aws" | "azure" | "gcp"): Blueprint {
  const configs: Record<string, Blueprint["resources"]> = {
    aws: [
      { type: "aws_s3_bucket", name: "${{ inputs.name }}-site", provider: "aws", config: { website: { index_document: "index.html" } } },
      { type: "aws_cloudfront_distribution", name: "${{ inputs.name }}-cdn", provider: "aws", config: { enabled: true, default_root_object: "index.html" } },
    ],
    azure: [
      { type: "azurerm_storage_account", name: "${{ inputs.name }}sa", provider: "azure", config: { account_tier: "Standard", account_replication_type: "LRS", static_website: { index_document: "index.html" } } },
      { type: "azurerm_cdn_profile", name: "${{ inputs.name }}-cdn", provider: "azure", config: { sku: "Standard_Microsoft" } },
    ],
    gcp: [
      { type: "google_storage_bucket", name: "${{ inputs.name }}-site", provider: "gcp", config: { website: { main_page_suffix: "index.html" } } },
      { type: "google_compute_backend_bucket", name: "${{ inputs.name }}-cdn", provider: "gcp", config: { enable_cdn: true } },
    ],
  };

  return {
    id: `static-site-${provider}`,
    name: `Static Website + CDN (${provider.toUpperCase()})`,
    description: "Static website hosting with CDN distribution",
    version: "1.0.0",
    category: "static-site",
    providers: [provider],
    parameters: [
      { id: "name", name: "Site Name", type: "string", required: true },
      { id: "domain", name: "Custom Domain", type: "string", required: false },
    ],
    resources: configs[provider]!,
    dependencies: [],
    policies: [],
    estimatedCostRange: [1, 30],
    tags: ["static", "cdn", "website", provider],
  };
}

/**
 * Data Pipeline — streaming + processing + storage.
 */
function dataPipeline(provider: "aws" | "azure" | "gcp"): Blueprint {
  const configs: Record<string, Blueprint["resources"]> = {
    aws: [
      { type: "aws_kinesis_stream", name: "${{ inputs.name }}-stream", provider: "aws", config: { shard_count: 1 } },
      { type: "aws_lambda_function", name: "${{ inputs.name }}-processor", provider: "aws", config: { runtime: "python3.11", memory_size: 512 } },
      { type: "aws_s3_bucket", name: "${{ inputs.name }}-output", provider: "aws", config: { versioning: { enabled: true } } },
    ],
    azure: [
      { type: "azurerm_eventgrid_topic", name: "${{ inputs.name }}-events", provider: "azure", config: {} },
      { type: "azurerm_function_app", name: "${{ inputs.name }}-processor", provider: "azure", config: { os_type: "Linux" } },
      { type: "azurerm_storage_account", name: "${{ inputs.name }}out", provider: "azure", config: { account_tier: "Standard", account_replication_type: "LRS" } },
    ],
    gcp: [
      { type: "google_pubsub_topic", name: "${{ inputs.name }}-topic", provider: "gcp", config: {} },
      { type: "google_cloudfunctions_function", name: "${{ inputs.name }}-processor", provider: "gcp", config: { runtime: "python311", available_memory_mb: 512 } },
      { type: "google_storage_bucket", name: "${{ inputs.name }}-output", provider: "gcp", config: { versioning: { enabled: true } } },
    ],
  };

  return {
    id: `data-pipeline-${provider}`,
    name: `Data Pipeline (${provider.toUpperCase()})`,
    description: "Event streaming + processing + object storage pipeline",
    version: "1.0.0",
    category: "data",
    providers: [provider],
    parameters: [
      { id: "name", name: "Pipeline Name", type: "string", required: true },
    ],
    resources: configs[provider]!,
    dependencies: [],
    policies: [],
    estimatedCostRange: [20, 200],
    tags: ["data", "pipeline", "streaming", provider],
  };
}

// ---------------------------------------------------------------------------
// Public catalog
// ---------------------------------------------------------------------------

const providers: Array<"aws" | "azure" | "gcp"> = ["aws", "azure", "gcp"];

export const builtInBlueprints: Blueprint[] = [
  ...providers.map(threeTierWebApp),
  ...providers.map(serverlessApi),
  ...providers.map(containerCluster),
  ...providers.map(staticSite),
  ...providers.map(dataPipeline),
];

/**
 * Get a blueprint by ID.
 */
export function getBlueprintById(
  id: string,
  catalog: Blueprint[] = builtInBlueprints,
): Blueprint | null {
  return catalog.find((b) => b.id === id) ?? null;
}

/**
 * Filter blueprints by category and/or provider.
 */
export function filterBlueprints(
  catalog: Blueprint[],
  opts: { category?: string; provider?: string; tag?: string },
): Blueprint[] {
  let results = catalog;
  if (opts.category) {
    results = results.filter((b) => b.category === opts.category);
  }
  if (opts.provider) {
    results = results.filter((b) => b.providers.includes(opts.provider as CloudProvider));
  }
  if (opts.tag) {
    results = results.filter((b) => b.tags.includes(opts.tag!));
  }
  return results;
}
