/**
 * HCL generator — converts graph node metadata into Terraform resource blocks.
 */

export type CloudProvider = "aws" | "azure" | "gcp";

export interface HCLResource {
  address: string; // e.g. "aws_instance.web_server"
  type: string; // e.g. "aws_instance"
  name: string; // e.g. "web_server"
  attributes: Record<string, unknown>;
  provider: CloudProvider;
}

export interface HCLOutput {
  name: string;
  value: string;
  description: string;
}

export interface HCLVariable {
  name: string;
  type: string;
  description: string;
  default?: unknown;
}

export interface HCLGenerationResult {
  resources: HCLResource[];
  providerBlocks: string[];
  variableBlocks: string[];
  outputBlocks: string[];
  importCommands: string[];
  hclContent: string;
}

/** Graph node shape (minimal) for codification. */
export interface CodifyNode {
  id: string;
  name: string;
  provider: CloudProvider;
  resourceType: string;
  nativeId: string;
  region: string;
  account: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
}

/** Resource type to Terraform type mapping. */
const RESOURCE_TYPE_MAP: Record<string, Record<CloudProvider, string>> = {
  "compute": {
    aws: "aws_instance",
    azure: "azurerm_linux_virtual_machine",
    gcp: "google_compute_instance",
  },
  "database": {
    aws: "aws_db_instance",
    azure: "azurerm_postgresql_server",
    gcp: "google_sql_database_instance",
  },
  "storage": {
    aws: "aws_s3_bucket",
    azure: "azurerm_storage_account",
    gcp: "google_storage_bucket",
  },
  "load-balancer": {
    aws: "aws_lb",
    azure: "azurerm_lb",
    gcp: "google_compute_forwarding_rule",
  },
  "serverless-function": {
    aws: "aws_lambda_function",
    azure: "azurerm_function_app",
    gcp: "google_cloudfunctions_function",
  },
  "function": {
    aws: "aws_lambda_function",
    azure: "azurerm_function_app",
    gcp: "google_cloudfunctions_function",
  },
  "vpc": {
    aws: "aws_vpc",
    azure: "azurerm_virtual_network",
    gcp: "google_compute_network",
  },
  "subnet": {
    aws: "aws_subnet",
    azure: "azurerm_subnet",
    gcp: "google_compute_subnetwork",
  },
  "security-group": {
    aws: "aws_security_group",
    azure: "azurerm_network_security_group",
    gcp: "google_compute_firewall",
  },
  "cdn": {
    aws: "aws_cloudfront_distribution",
    azure: "azurerm_cdn_profile",
    gcp: "google_compute_backend_bucket",
  },
  "dns": {
    aws: "aws_route53_zone",
    azure: "azurerm_dns_zone",
    gcp: "google_dns_managed_zone",
  },
  "cache": {
    aws: "aws_elasticache_cluster",
    azure: "azurerm_redis_cache",
    gcp: "google_redis_instance",
  },
  "queue": {
    aws: "aws_sqs_queue",
    azure: "azurerm_servicebus_queue",
    gcp: "google_pubsub_topic",
  },
  "container": {
    aws: "aws_ecs_service",
    azure: "azurerm_container_group",
    gcp: "google_cloud_run_service",
  },
  "cluster": {
    aws: "aws_eks_cluster",
    azure: "azurerm_kubernetes_cluster",
    gcp: "google_container_cluster",
  },
};

/**
 * Resolve the Terraform resource type for a graph resource type + provider.
 */
export function resolveTerraformType(
  resourceType: string,
  provider: CloudProvider,
): string | null {
  return RESOURCE_TYPE_MAP[resourceType]?.[provider] ?? null;
}

/**
 * Sanitize a name for use as a Terraform resource name.
 */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

/**
 * Extract key attributes from node metadata for a given resource type.
 */
export function extractAttributes(
  node: CodifyNode,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  // Common metadata keys that map to Terraform attributes
  const meta = node.metadata;
  const keysToInclude = [
    "instance_type", "machine_type", "vm_size",
    "engine", "engine_version", "database_version",
    "runtime", "memory_size", "handler",
    "ami", "image_id",
    "allocated_storage", "storage_type",
    "multi_az", "publicly_accessible",
    "cidr_block", "address_prefix",
    "sku", "tier",
    "versioning", "encryption",
  ];

  for (const key of keysToInclude) {
    if (meta[key] != null) {
      attrs[key] = meta[key];
    }
  }

  // Add tags
  if (Object.keys(node.tags).length > 0) {
    attrs["tags"] = node.tags;
  }

  return attrs;
}

/**
 * Generate an HCL resource block from a codify node.
 */
export function generateResourceBlock(node: CodifyNode): HCLResource | null {
  const tfType = resolveTerraformType(node.resourceType, node.provider);
  if (!tfType) return null;

  const name = sanitizeName(node.name);
  const attributes = extractAttributes(node);

  return {
    address: `${tfType}.${name}`,
    type: tfType,
    name,
    attributes,
    provider: node.provider,
  };
}

/**
 * Generate provider block HCL.
 */
export function generateProviderBlock(provider: CloudProvider, region: string): string {
  switch (provider) {
    case "aws":
      return `provider "aws" {\n  region = "${region}"\n}`;
    case "azure":
      return `provider "azurerm" {\n  features {}\n}`;
    case "gcp":
      return `provider "google" {\n  region = "${region}"\n}`;
  }
}

/**
 * Generate a terraform import command.
 */
export function generateImportCommand(resource: HCLResource, nativeId: string): string {
  return `terraform import ${resource.address} ${nativeId}`;
}

/**
 * Generate import block (Terraform 1.5+ syntax).
 */
export function generateImportBlock(resource: HCLResource, nativeId: string): string {
  return `import {\n  to = ${resource.address}\n  id = "${nativeId}"\n}`;
}

/**
 * Generate variable block for parameterizable values.
 */
export function generateVariableBlock(variable: HCLVariable): string {
  const lines = [`variable "${variable.name}" {`];
  lines.push(`  type        = ${variable.type}`);
  lines.push(`  description = "${variable.description}"`);
  if (variable.default != null) {
    lines.push(`  default     = ${formatValue(variable.default)}`);
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * Generate output block.
 */
export function generateOutputBlock(output: HCLOutput): string {
  return `output "${output.name}" {\n  value       = ${output.value}\n  description = "${output.description}"\n}`;
}

/**
 * Format a value for HCL output.
 */
export function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const inner = entries.map(([k, v]) => `    ${k} = ${formatValue(v)}`).join("\n");
    return `{\n${inner}\n  }`;
  }
  return "null";
}

/**
 * Generate full HCL content from multiple nodes.
 */
export function codifyNodes(nodes: CodifyNode[]): HCLGenerationResult {
  const resources: HCLResource[] = [];
  const providerSet = new Map<string, string>(); // provider:region → block
  const importCommands: string[] = [];
  const importBlocks: string[] = [];

  for (const node of nodes) {
    const resource = generateResourceBlock(node);
    if (!resource) continue;

    resources.push(resource);
    const providerKey = `${node.provider}:${node.region}`;
    if (!providerSet.has(providerKey)) {
      providerSet.set(providerKey, generateProviderBlock(node.provider, node.region));
    }
    importCommands.push(generateImportCommand(resource, node.nativeId));
    importBlocks.push(generateImportBlock(resource, node.nativeId));
  }

  // Build HCL content
  const hclParts: string[] = [
    "# Generated by Espada IaC Codify",
    `# ${new Date().toISOString()}`,
    "",
    ...providerSet.values(),
    "",
  ];

  for (const r of resources) {
    hclParts.push(`resource "${r.type}" "${r.name}" {`);
    for (const [k, v] of Object.entries(r.attributes)) {
      hclParts.push(`  ${k} = ${formatValue(v)}`);
    }
    hclParts.push("}");
    hclParts.push("");
  }

  // Add imports
  if (importBlocks.length > 0) {
    hclParts.push("# Import blocks (Terraform 1.5+)");
    hclParts.push(...importBlocks);
  }

  // Common outputs
  const outputBlocks: string[] = [];
  for (const r of resources) {
    outputBlocks.push(
      generateOutputBlock({
        name: `${r.name}_id`,
        value: `${r.type}.${r.name}.id`,
        description: `ID of ${r.name}`,
      }),
    );
  }

  // Variables
  const variableBlocks: string[] = [];
  const regions = [...new Set(nodes.map((n) => n.region))];
  if (regions.length > 0) {
    variableBlocks.push(
      generateVariableBlock({
        name: "region",
        type: "string",
        description: "AWS/GCP region or Azure location",
        default: regions[0],
      }),
    );
  }

  return {
    resources,
    providerBlocks: [...providerSet.values()],
    variableBlocks,
    outputBlocks,
    importCommands,
    hclContent: hclParts.join("\n"),
  };
}
