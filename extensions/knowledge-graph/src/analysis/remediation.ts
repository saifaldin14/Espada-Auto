/**
 * Infrastructure Knowledge Graph — Drift Auto-Remediation (P2.21)
 *
 * Generates IaC patches (Terraform HCL or CloudFormation YAML) from
 * drift detection results. Takes the desired state (from graph) and
 * the drifted state (from rediscovery) and produces corrective patches.
 */

import type {
  GraphNode,
  GraphResourceType,
  CloudProvider,
  DriftResult,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** Supported IaC output formats. */
export type IaCFormat = "terraform" | "cloudformation";

/** A single remediation patch for one drifted resource. */
export type RemediationPatch = {
  /** Target resource node ID. */
  nodeId: string;
  /** Resource name. */
  resourceName: string;
  /** Resource type. */
  resourceType: GraphResourceType;
  /** Provider. */
  provider: CloudProvider;
  /** Changes being remediated. */
  driftedFields: DriftedField[];
  /** Generated IaC patch. */
  patch: string;
  /** Format of the patch. */
  format: IaCFormat;
  /** Risk level of applying this patch. */
  risk: "low" | "medium" | "high";
  /** Human-readable summary. */
  summary: string;
};

/** A single drifted field with before/after values. */
export type DriftedField = {
  field: string;
  expectedValue: string | null;
  actualValue: string | null;
};

/** Full remediation plan for all drifted resources. */
export type RemediationPlan = {
  generatedAt: string;
  format: IaCFormat;
  totalDriftedResources: number;
  totalPatches: number;
  /** Patches that can be safely auto-applied. */
  autoRemediable: RemediationPatch[];
  /** Patches that require manual review. */
  manualReview: RemediationPatch[];
  /** Resources that cannot be remediated via IaC. */
  unremeditable: Array<{
    nodeId: string;
    resourceName: string;
    reason: string;
  }>;
};

// =============================================================================
// Resource Type → Terraform Mapping
// =============================================================================

const TERRAFORM_RESOURCE_MAP: Record<string, string> = {
  compute: "aws_instance",
  database: "aws_db_instance",
  storage: "aws_s3_bucket",
  "load-balancer": "aws_lb",
  "security-group": "aws_security_group",
  vpc: "aws_vpc",
  subnet: "aws_subnet",
  "iam-role": "aws_iam_role",
  function: "aws_lambda_function",
  "api-gateway": "aws_api_gateway_rest_api",
  cache: "aws_elasticache_cluster",
  queue: "aws_sqs_queue",
  topic: "aws_sns_topic",
  dns: "aws_route53_record",
  certificate: "aws_acm_certificate",
  cdn: "aws_cloudfront_distribution",
  "nat-gateway": "aws_nat_gateway",
  "route-table": "aws_route_table",
  "internet-gateway": "aws_internet_gateway",
  "vpc-endpoint": "aws_vpc_endpoint",
  secret: "aws_secretsmanager_secret",
  stream: "aws_kinesis_stream",
};

const AZURE_TERRAFORM_MAP: Record<string, string> = {
  compute: "azurerm_virtual_machine",
  database: "azurerm_mssql_database",
  storage: "azurerm_storage_account",
  "load-balancer": "azurerm_lb",
  vpc: "azurerm_virtual_network",
  subnet: "azurerm_subnet",
  function: "azurerm_function_app",
  cache: "azurerm_redis_cache",
  queue: "azurerm_servicebus_queue",
  cluster: "azurerm_kubernetes_cluster",
};

const GCP_TERRAFORM_MAP: Record<string, string> = {
  compute: "google_compute_instance",
  database: "google_sql_database_instance",
  storage: "google_storage_bucket",
  "load-balancer": "google_compute_forwarding_rule",
  vpc: "google_compute_network",
  subnet: "google_compute_subnetwork",
  function: "google_cloudfunctions_function",
  cluster: "google_container_cluster",
  queue: "google_pubsub_topic",
};

/** Map field names to Terraform attribute names (null = not a Terraform attribute). */
const FIELD_TO_TERRAFORM: Record<string, string | null> = {
  status: "status",
  name: "name",
  region: "region",
  "metadata.instanceType": "instance_type",
  "metadata.engine": "engine",
  "metadata.engineVersion": "engine_version",
  "metadata.storageEncrypted": "storage_encrypted",
  "metadata.multiAz": "multi_az",
  "metadata.publiclyAccessible": "publicly_accessible",
  "metadata.versioningEnabled": "versioning.enabled",
  "metadata.loggingEnabled": "logging.enabled",
  "metadata.encryptionEnabled": "encryption_configuration.kms_key_name",
  costMonthly: null,
  "tags.Environment": 'tags.Environment',
  "tags.Owner": 'tags.Owner',
};

// =============================================================================
// Patch Generation
// =============================================================================

/**
 * Get the Terraform resource type for a given graph resource.
 */
function getTerraformResourceType(
  resourceType: GraphResourceType,
  provider: CloudProvider,
): string | null {
  if (provider === "azure")
    return AZURE_TERRAFORM_MAP[resourceType] ?? null;
  if (provider === "gcp") return GCP_TERRAFORM_MAP[resourceType] ?? null;
  return TERRAFORM_RESOURCE_MAP[resourceType] ?? null;
}

/**
 * Sanitize a resource name for use as a Terraform resource name.
 */
function sanitizeTfName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^[0-9]/, "_$&")
    .toLowerCase();
}

/**
 * Generate a Terraform HCL patch for a drifted resource.
 */
function generateTerraformPatch(
  node: GraphNode,
  fields: DriftedField[],
): string {
  const tfType = getTerraformResourceType(node.resourceType, node.provider);
  if (!tfType) return "";

  const tfName = sanitizeTfName(node.name);
  const lines: string[] = [
    `# Remediation patch for ${node.name} (${node.resourceType})`,
    `# Drifted fields: ${fields.map((f) => f.field).join(", ")}`,
    `resource "${tfType}" "${tfName}" {`,
  ];

  // Generate field assignments
  const tagUpdates: Record<string, string> = {};

  for (const field of fields) {
    if (field.expectedValue == null) continue;

    // Handle tag fields
    if (field.field.startsWith("tags.")) {
      const tagKey = field.field.replace("tags.", "");
      tagUpdates[tagKey] = field.expectedValue;
      continue;
    }

    const tfAttr = FIELD_TO_TERRAFORM[field.field];
    if (tfAttr === null) continue; // Not a Terraform attribute
    const attrName = tfAttr ?? field.field.replace("metadata.", "");

    // Format the value
    const value = formatTerraformValue(field.expectedValue);
    lines.push(`  ${attrName} = ${value}`);
  }

  // Add tags block if any tag changes
  if (Object.keys(tagUpdates).length > 0) {
    lines.push("  tags = {");
    for (const [key, value] of Object.entries(tagUpdates)) {
      lines.push(`    ${key} = "${escapeHcl(value)}"`);
    }
    lines.push("  }");
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Generate a CloudFormation YAML patch for a drifted resource.
 */
function generateCloudFormationPatch(
  node: GraphNode,
  fields: DriftedField[],
): string {
  const lines: string[] = [
    `# Remediation patch for ${node.name} (${node.resourceType})`,
    `# Drifted fields: ${fields.map((f) => f.field).join(", ")}`,
    `${sanitizeTfName(node.name)}:`,
    `  Type: AWS::${cloudFormationType(node.resourceType)}`,
    `  Properties:`,
  ];

  const tagUpdates: Record<string, string> = {};

  for (const field of fields) {
    if (field.expectedValue == null) continue;

    if (field.field.startsWith("tags.")) {
      const tagKey = field.field.replace("tags.", "");
      tagUpdates[tagKey] = field.expectedValue;
      continue;
    }

    const cfnAttr = fieldToCloudFormation(field.field);
    if (cfnAttr) {
      lines.push(`    ${cfnAttr}: ${formatYamlValue(field.expectedValue)}`);
    }
  }

  if (Object.keys(tagUpdates).length > 0) {
    lines.push("    Tags:");
    for (const [key, value] of Object.entries(tagUpdates)) {
      lines.push(`      - Key: ${formatYamlValue(key)}`);
      lines.push(`        Value: ${formatYamlValue(value)}`);
    }
  }

  return lines.join("\n");
}

/** Map resource type → CloudFormation type suffix. */
function cloudFormationType(resourceType: GraphResourceType): string {
  const map: Record<string, string> = {
    compute: "EC2::Instance",
    database: "RDS::DBInstance",
    storage: "S3::Bucket",
    "load-balancer": "ElasticLoadBalancingV2::LoadBalancer",
    "security-group": "EC2::SecurityGroup",
    vpc: "EC2::VPC",
    subnet: "EC2::Subnet",
    "iam-role": "IAM::Role",
    function: "Lambda::Function",
    cache: "ElastiCache::CacheCluster",
    queue: "SQS::Queue",
    topic: "SNS::Topic",
  };
  return map[resourceType] ?? "CustomResource";
}

/** Map field → CloudFormation property name. */
function fieldToCloudFormation(field: string): string | null {
  const map: Record<string, string> = {
    "metadata.instanceType": "InstanceType",
    "metadata.engine": "Engine",
    "metadata.engineVersion": "EngineVersion",
    "metadata.storageEncrypted": "StorageEncrypted",
    "metadata.multiAz": "MultiAZ",
    "metadata.publiclyAccessible": "PubliclyAccessible",
    name: "Name",
    region: "AvailabilityZone",
  };
  return map[field] ?? null;
}

/** Format a value for Terraform HCL. */
function formatTerraformValue(value: string): string {
  if (value === "true" || value === "false") return value;
  if (/^\d+(\.\d+)?$/.test(value)) return value;
  return `"${escapeHcl(value)}"`;
}

/** Format a value for CloudFormation YAML (safely quoted). */
function formatYamlValue(value: string): string {
  if (value === "true" || value === "false") return value;
  if (/^\d+(\.\d+)?$/.test(value)) return value;
  // Always quote strings; escape backslashes, double quotes, and YAML-special prefixes
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/** Escape a string for HCL (prevents Terraform interpolation injection). */
function escapeHcl(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\$\{/g, "$$$${")
    .replace(/%\{/g, "%%{"); // Escape ${ → $${ and %{ → %%{ (HCL interpolation)
}

// =============================================================================
// Risk Assessment
// =============================================================================

/**
 * Assess the risk level of applying a remediation patch.
 */
function assessPatchRisk(
  node: GraphNode,
  fields: DriftedField[],
): "low" | "medium" | "high" {
  // High risk: status changes, deletions, production environment
  const envTag = node.tags.Environment ?? node.tags.environment ?? "";
  const isProduction =
    envTag === "production" || envTag === "prod";

  const hasStatusChange = fields.some((f) => f.field === "status");
  const hasSecurityChange = fields.some(
    (f) =>
      f.field.includes("security") ||
      f.field.includes("publiclyAccessible") ||
      f.field.includes("encrypted"),
  );

  if (hasStatusChange || (isProduction && hasSecurityChange)) return "high";
  if (isProduction || hasSecurityChange) return "medium";
  return "low";
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Generate a remediation plan from drift detection results.
 */
export function generateRemediationPlan(
  driftResult: DriftResult,
  format: IaCFormat = "terraform",
): RemediationPlan {
  const patches: RemediationPatch[] = [];
  const unremeditable: RemediationPlan["unremeditable"] = [];

  for (const { node, changes } of driftResult.driftedNodes) {
    const fields: DriftedField[] = changes
      .filter(
        (c) =>
          c.changeType === "node-drifted" || c.changeType === "node-updated",
      )
      .map((c) => ({
        field: c.field ?? "unknown",
        expectedValue: c.previousValue,
        actualValue: c.newValue,
      }))
      .filter((f) => f.field !== "unknown");

    if (fields.length === 0) {
      unremeditable.push({
        nodeId: node.id,
        resourceName: node.name,
        reason: "No specific field changes detected",
      });
      continue;
    }

    // Check if we can generate a patch for this resource type
    const canGenerate =
      format === "terraform"
        ? getTerraformResourceType(node.resourceType, node.provider) != null
        : node.provider === "aws"; // CloudFormation is AWS-only

    if (!canGenerate) {
      unremeditable.push({
        nodeId: node.id,
        resourceName: node.name,
        reason: `No ${format} mapping for ${node.provider}:${node.resourceType}`,
      });
      continue;
    }

    const patchContent =
      format === "terraform"
        ? generateTerraformPatch(node, fields)
        : generateCloudFormationPatch(node, fields);

    if (!patchContent) {
      unremeditable.push({
        nodeId: node.id,
        resourceName: node.name,
        reason: "No remediable fields in drift",
      });
      continue;
    }

    const risk = assessPatchRisk(node, fields);
    const summary = `${node.name} (${node.resourceType}): ${fields.map((f) => `${f.field} drifted from ${f.expectedValue ?? "null"} → ${f.actualValue ?? "null"}`).join("; ")}`;

    patches.push({
      nodeId: node.id,
      resourceName: node.name,
      resourceType: node.resourceType,
      provider: node.provider,
      driftedFields: fields,
      patch: patchContent,
      format,
      risk,
      summary,
    });
  }

  // Handle disappeared nodes
  for (const node of driftResult.disappearedNodes) {
    unremeditable.push({
      nodeId: node.id,
      resourceName: node.name,
      reason: "Resource disappeared — manual intervention required",
    });
  }

  // Classify patches by risk
  const autoRemediable = patches.filter((p) => p.risk === "low");
  const manualReview = patches.filter(
    (p) => p.risk === "medium" || p.risk === "high",
  );

  return {
    generatedAt: new Date().toISOString(),
    format,
    totalDriftedResources: driftResult.driftedNodes.length,
    totalPatches: patches.length,
    autoRemediable,
    manualReview,
    unremeditable,
  };
}

/**
 * Format a remediation plan as a markdown report.
 */
export function formatRemediationMarkdown(plan: RemediationPlan): string {
  const lines: string[] = [
    "# Drift Remediation Plan",
    "",
    `Generated: ${plan.generatedAt}`,
    `Format: ${plan.format}`,
    `Drifted resources: ${plan.totalDriftedResources}`,
    `Remediable patches: ${plan.totalPatches}`,
    "",
  ];

  if (plan.autoRemediable.length > 0) {
    lines.push(
      "## Auto-Remediable (Low Risk)",
      "",
      ...plan.autoRemediable.flatMap((p) => [
        `### ${p.resourceName}`,
        "",
        p.summary,
        "",
        "```" + (p.format === "terraform" ? "hcl" : "yaml"),
        p.patch,
        "```",
        "",
      ]),
    );
  }

  if (plan.manualReview.length > 0) {
    lines.push(
      "## Requires Manual Review",
      "",
      ...plan.manualReview.flatMap((p) => [
        `### [${p.risk.toUpperCase()} RISK] ${p.resourceName}`,
        "",
        p.summary,
        "",
        "```" + (p.format === "terraform" ? "hcl" : "yaml"),
        p.patch,
        "```",
        "",
      ]),
    );
  }

  if (plan.unremeditable.length > 0) {
    lines.push(
      "## Cannot Be Auto-Remediated",
      "",
      "| Resource | Reason |",
      "|----------|--------|",
      ...plan.unremeditable.map(
        (u) => `| ${u.resourceName} | ${u.reason} |`,
      ),
    );
  }

  return lines.join("\n");
}
