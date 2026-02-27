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
  /** Terraform import blocks (if generateImports was set). */
  importBlocks?: ImportBlock[];
  /** Warnings about cross-resource dependencies. */
  dependencyWarnings?: DependencyWarning[];
};

/** Edge representing a dependency between two resources. */
export type DependencyEdge = {
  sourceId: string;
  targetId: string;
  relationship: string;
};

/** Warning about cross-resource dependency conflicts. */
export type DependencyWarning = {
  sourceResource: string;
  targetResource: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: string;
  warning: string;
};

/** Options for advanced remediation plan generation. */
export type RemediationOptions = {
  /** Graph edges for dependency-aware ordering. */
  edges?: DependencyEdge[];
  /** Generate Terraform import blocks for state management. */
  generateImports?: boolean;
  /** Wrap patches in module blocks. */
  moduleAware?: boolean;
  /** Module name prefix (defaults to mod_<resource_name>). */
  moduleName?: string;
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
 * Optionally accepts graph edges for dependency-aware ordering.
 */
export function generateRemediationPlan(
  driftResult: DriftResult,
  format: IaCFormat = "terraform",
  options?: RemediationOptions,
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
        ? options?.moduleAware
          ? generateModuleAwarePatch(node, fields, options.moduleName)
          : generateTerraformPatch(node, fields)
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

  // Sort patches by dependency order if edges are provided
  const edges = options?.edges ?? [];
  const orderedPatches = edges.length > 0
    ? orderByDependency(patches, edges)
    : patches;

  // Classify patches by risk
  const autoRemediable = orderedPatches.filter((p) => p.risk === "low");
  const manualReview = orderedPatches.filter(
    (p) => p.risk === "medium" || p.risk === "high",
  );

  // Generate import blocks if requested
  const importBlocks = options?.generateImports
    ? generateImportBlocks(patches, format)
    : undefined;

  // Detect cross-resource dependency warnings
  const dependencyWarnings = edges.length > 0
    ? detectDependencyWarnings(patches, edges)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    format,
    totalDriftedResources: driftResult.driftedNodes.length,
    totalPatches: orderedPatches.length,
    autoRemediable,
    manualReview,
    unremeditable,
    importBlocks,
    dependencyWarnings,
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

  if (plan.dependencyWarnings && plan.dependencyWarnings.length > 0) {
    lines.push(
      "## Dependency Warnings",
      "",
      ...plan.dependencyWarnings.map((w) => `- **${w.sourceResource}** → **${w.targetResource}**: ${w.warning}`),
      "",
    );
  }

  if (plan.importBlocks && plan.importBlocks.length > 0) {
    lines.push(
      "## Import Blocks",
      "",
      "Run these before applying patches to import existing resources into state:",
      "",
      "```hcl",
      ...plan.importBlocks.map((b) => b.block),
      "```",
      "",
    );
  }

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

// =============================================================================
// Dependency-Aware Ordering
// =============================================================================

/**
 * Sort patches based on edge dependencies so that upstream resources
 * are patched before downstream resources.
 * Uses topological sort; cycles fall back to original order.
 */
function orderByDependency(
  patches: RemediationPatch[],
  edges: DependencyEdge[],
): RemediationPatch[] {
  if (patches.length <= 1) return patches;

  const patchById = new Map(patches.map((p) => [p.nodeId, p]));
  const patchIds = new Set(patches.map((p) => p.nodeId));

  // Build adjacency list (only for nodes in the patch set)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of patchIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    if (patchIds.has(edge.sourceId) && patchIds.has(edge.targetId)) {
      adj.get(edge.sourceId)!.push(edge.targetId);
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
    }
  }

  // Kahn's algorithm — topological sort
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // If cycle detected (sorted.length < patchIds.size), fall back to original order
  if (sorted.length < patchIds.size) {
    return patches;
  }

  return sorted
    .map((id) => patchById.get(id))
    .filter((p): p is RemediationPatch => p != null);
}

// =============================================================================
// Dependency Warning Detection
// =============================================================================

/**
 * Detect patches that affect resources which depend on each other.
 * Warns when a downstream resource may break if the upstream patch
 * changes a field the downstream depends on.
 */
function detectDependencyWarnings(
  patches: RemediationPatch[],
  edges: DependencyEdge[],
): DependencyWarning[] {
  const warnings: DependencyWarning[] = [];
  const patchIds = new Set(patches.map((p) => p.nodeId));
  const patchMap = new Map(patches.map((p) => [p.nodeId, p]));

  // Cross-reference fields: if source and target are both being patched,
  // and the source is changing a field that could affect the target
  const sensitiveFields = new Set([
    "status", "region", "name",
    "metadata.publiclyAccessible", "metadata.encrypted",
    "metadata.vpcId", "metadata.subnetId", "metadata.securityGroupId",
  ]);

  for (const edge of edges) {
    if (patchIds.has(edge.sourceId) && patchIds.has(edge.targetId)) {
      const sourcePatch = patchMap.get(edge.sourceId)!;
      const targetPatch = patchMap.get(edge.targetId)!;

      const sensitiveChanges = sourcePatch.driftedFields.filter(
        (f) => sensitiveFields.has(f.field),
      );

      if (sensitiveChanges.length > 0) {
        warnings.push({
          sourceResource: sourcePatch.resourceName,
          targetResource: targetPatch.resourceName,
          sourceNodeId: edge.sourceId,
          targetNodeId: edge.targetId,
          relationship: edge.relationship,
          warning: `Changing ${sensitiveChanges.map((f) => f.field).join(", ")} on ${sourcePatch.resourceName} may affect dependent resource ${targetPatch.resourceName}. Review carefully.`,
        });
      }
    }
  }

  return warnings;
}

// =============================================================================
// Module-Aware Terraform Patches
// =============================================================================

/**
 * Generate a Terraform patch wrapped in a module block.
 * Useful when the resource is managed through a Terraform module.
 */
function generateModuleAwarePatch(
  node: GraphNode,
  fields: DriftedField[],
  moduleName?: string,
): string {
  const tfType = getTerraformResourceType(node.resourceType, node.provider);
  if (!tfType) return "";

  const tfName = sanitizeTfName(node.name);
  const modName = moduleName ?? `mod_${sanitizeTfName(node.name)}`;
  const innerPatch = generateTerraformPatch(node, fields);
  if (!innerPatch) return "";

  const lines: string[] = [
    `# Module-aware remediation for ${node.name}`,
    `# If this resource is managed via a Terraform module, adjust the`,
    `# module source and variables below to match your module structure.`,
    `module "${modName}" {`,
    `  source = "./modules/${node.resourceType}"`,
    "",
    `  # Pass drifted values as module variables:`,
  ];

  for (const field of fields) {
    if (field.expectedValue == null) continue;
    const varName = field.field.replace("metadata.", "").replace(/\./g, "_");
    lines.push(`  ${varName} = ${formatTerraformValue(field.expectedValue)}`);
  }

  lines.push("}");
  lines.push("");
  lines.push("# Alternatively, patch the resource directly:");
  lines.push(innerPatch);

  return lines.join("\n");
}

// =============================================================================
// Import Block Generation
// =============================================================================

/** An import block for bringing existing resources into Terraform state. */
export type ImportBlock = {
  nodeId: string;
  resourceName: string;
  block: string;
};

/**
 * Generate Terraform import blocks for resources in the remediation plan.
 * These should be run before applying patches to avoid "resource already exists" errors.
 */
function generateImportBlocks(
  patches: RemediationPatch[],
  format: IaCFormat,
): ImportBlock[] {
  if (format !== "terraform") return [];

  return patches
    .map((patch) => {
      const tfType = getTerraformResourceType(patch.resourceType, patch.provider);
      if (!tfType) return null;

      const tfName = sanitizeTfName(patch.resourceName);
      // Use the node's nativeId or fall back to nodeId for the import identifier
      const importId = patch.nodeId;

      return {
        nodeId: patch.nodeId,
        resourceName: patch.resourceName,
        block: [
          `import {`,
          `  to = ${tfType}.${tfName}`,
          `  id = "${importId}"`,
          `}`,
        ].join("\n"),
      };
    })
    .filter((b): b is ImportBlock => b != null);
}
