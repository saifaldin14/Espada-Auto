/**
 * Cross-Cloud Migration Engine — Migration Planner
 *
 * Assessment → ExecutionPlan generation.
 * Queries Knowledge Graph for dependencies, checks compatibility matrix,
 * estimates costs, and produces a DAG of MigrationSteps.
 */

import { randomUUID } from "node:crypto";

import type {
  MigrationProvider,
  MigrationResourceType,
  MigrationExecutionPlan,
  MigrationStep,
  MigrationStepType,
  MigrationCostEstimate,
  CompatibilityResult,
  RiskAssessment,
  RiskFactor,
  NormalizedVM,
  NormalizedBucket,
  NormalizedSecurityRule,
  NormalizedDNSRecord,
} from "../types.js";
import { checkCompatibility, checkAllCompatibility } from "./compatibility-matrix.js";
import { estimateMigrationCost } from "./cost-estimator.js";

// =============================================================================
// Assessment Result
// =============================================================================

export type MigrationAssessment = {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  targetRegion: string;
  resourceSummary: ResourceSummary;
  compatibility: CompatibilityResult[];
  costEstimate: MigrationCostEstimate;
  riskAssessment: RiskAssessment;
  dependencies: DependencyInfo[];
  feasible: boolean;
  blockers: string[];
};

export type ResourceSummary = {
  vms: number;
  disks: number;
  buckets: number;
  databases: number;
  securityRules: number;
  dnsRecords: number;
  totalDataGB: number;
};

export type DependencyInfo = {
  resourceId: string;
  resourceType: MigrationResourceType;
  dependsOn: Array<{ id: string; type: MigrationResourceType; relationship: string }>;
};

// =============================================================================
// Assessment
// =============================================================================

/**
 * Run a migration assessment — compatibility, cost, risk, and dependency analysis.
 */
export function assessMigration(params: {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  targetRegion: string;
  resourceTypes: MigrationResourceType[];
  vms?: NormalizedVM[];
  buckets?: NormalizedBucket[];
  securityRules?: NormalizedSecurityRule[];
  dnsRecords?: NormalizedDNSRecord[];
  dependencies?: DependencyInfo[];
}): MigrationAssessment {
  const {
    sourceProvider,
    targetProvider,
    targetRegion,
    resourceTypes,
    vms = [],
    buckets = [],
    securityRules = [],
    dnsRecords = [],
    dependencies = [],
  } = params;

  // Check compatibility for all requested resource types
  const compatibility = resourceTypes.map((rt) =>
    checkCompatibility(sourceProvider, targetProvider, rt),
  );

  // Resource summary
  const totalDiskGB = vms.reduce(
    (sum, vm) => sum + vm.disks.reduce((s, d) => s + d.sizeGB, 0),
    0,
  );
  const totalBucketGB = buckets.reduce((sum, b) => sum + b.totalSizeBytes / (1024 ** 3), 0);
  const totalDataGB = totalDiskGB + totalBucketGB;

  const resourceSummary: ResourceSummary = {
    vms: vms.length,
    disks: vms.reduce((sum, vm) => sum + vm.disks.length, 0),
    buckets: buckets.length,
    databases: resourceTypes.filter((rt) => rt === "database").length,
    securityRules: securityRules.length,
    dnsRecords: dnsRecords.length,
    totalDataGB,
  };

  // Cost estimate
  const objectCount = buckets.reduce((sum, b) => sum + b.objectCount, 0);
  const costEstimate = estimateMigrationCost({
    sourceProvider,
    targetProvider,
    resourceTypes,
    dataSizeGB: totalDataGB,
    objectCount,
    vms: vms.map((vm) => ({ cpuCores: vm.cpuCores, memoryGB: vm.memoryGB })),
    diskSizeGB: totalDiskGB,
  });

  // Risk assessment
  const riskAssessment = assessRisk({
    sourceProvider,
    targetProvider,
    compatibility,
    totalDataGB,
    vmCount: vms.length,
    hasDatabases: resourceTypes.includes("database"),
  });

  // Blockers
  const blockers: string[] = [];
  for (const cr of compatibility) {
    for (const b of cr.blockers) {
      blockers.push(`${cr.resourceType}: ${b.message}`);
    }
  }

  return {
    sourceProvider,
    targetProvider,
    targetRegion,
    resourceSummary,
    compatibility,
    costEstimate,
    riskAssessment,
    dependencies,
    feasible: blockers.length === 0,
    blockers,
  };
}

// =============================================================================
// Risk Assessment
// =============================================================================

function assessRisk(params: {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  compatibility: CompatibilityResult[];
  totalDataGB: number;
  vmCount: number;
  hasDatabases: boolean;
}): RiskAssessment {
  const factors: RiskFactor[] = [];

  // Data volume risk
  if (params.totalDataGB > 10_000) {
    factors.push({
      category: "data-volume",
      description: `Large data volume (${params.totalDataGB.toFixed(0)} GB) — transfer may take hours`,
      severity: "high",
      mitigation: "Use parallel transfer with resume support; run during maintenance window",
    });
  } else if (params.totalDataGB > 1_000) {
    factors.push({
      category: "data-volume",
      description: `Moderate data volume (${params.totalDataGB.toFixed(0)} GB)`,
      severity: "medium",
      mitigation: "Enable transfer resume and integrity verification",
    });
  }

  // VM count risk
  if (params.vmCount > 50) {
    factors.push({
      category: "vm-count",
      description: `Large VM fleet (${params.vmCount} VMs) — migration will be staged`,
      severity: "high",
      mitigation: "Stage migration in batches; verify each batch before proceeding",
    });
  }

  // Database risk
  if (params.hasDatabases) {
    factors.push({
      category: "database",
      description: "Database migration involves potential for data loss/corruption",
      severity: "high",
      mitigation: "Use schema + row count + sample verification; consider CDC for near-zero downtime",
    });
  }

  // Compatibility warnings
  const totalWarnings = params.compatibility.reduce((sum, c) => sum + c.warnings.length, 0);
  if (totalWarnings > 10) {
    factors.push({
      category: "compatibility",
      description: `${totalWarnings} compatibility warnings across resource types`,
      severity: "medium",
      mitigation: "Review all warnings before proceeding; some may require manual intervention",
    });
  }

  // Cross-provider complexity
  const isOnPrem = [params.sourceProvider, params.targetProvider].some(
    (p) => p === "on-premises" || p === "vmware" || p === "nutanix",
  );
  if (isOnPrem) {
    factors.push({
      category: "on-prem",
      description: "On-premises migration involves agent deployment and network configuration",
      severity: "high",
      mitigation: "Ensure migration agent is deployed; verify network connectivity to staging area",
    });
  }

  // Determine overall risk
  let overallRisk: RiskAssessment["overallRisk"] = "low";
  if (factors.some((f) => f.severity === "critical")) overallRisk = "critical";
  else if (factors.filter((f) => f.severity === "high").length >= 2) overallRisk = "high";
  else if (factors.some((f) => f.severity === "high")) overallRisk = "medium";
  else if (factors.some((f) => f.severity === "medium")) overallRisk = "medium";

  return { overallRisk, factors };
}

// =============================================================================
// Plan Generation
// =============================================================================

/**
 * Generate a full migration ExecutionPlan from an assessment.
 */
export function generatePlan(params: {
  jobId: string;
  name: string;
  description: string;
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  targetRegion: string;
  resourceTypes: MigrationResourceType[];
  vms?: NormalizedVM[];
  buckets?: NormalizedBucket[];
  securityRules?: NormalizedSecurityRule[];
  dnsRecords?: NormalizedDNSRecord[];
  assessment: MigrationAssessment;
}): MigrationExecutionPlan {
  const {
    jobId,
    name,
    description,
    sourceProvider,
    targetProvider,
    targetRegion,
    resourceTypes,
    vms = [],
    buckets = [],
    securityRules = [],
    dnsRecords = [],
    assessment,
  } = params;

  const steps: MigrationStep[] = [];
  const globalParams: Record<string, unknown> = {
    sourceProvider,
    targetProvider,
    targetRegion,
    jobId,
  };

  // Generate steps for each resource type
  if (resourceTypes.includes("security-rules") || resourceTypes.includes("vm")) {
    steps.push(...generateNetworkSteps(sourceProvider, targetProvider, securityRules));
  }

  if (resourceTypes.includes("object-storage")) {
    for (const bucket of buckets) {
      steps.push(...generateDataSteps(bucket, sourceProvider, targetProvider));
    }
  }

  if (resourceTypes.includes("vm")) {
    for (const vm of vms) {
      steps.push(...generateComputeSteps(vm, sourceProvider, targetProvider));
    }
  }

  if (resourceTypes.includes("dns")) {
    steps.push(...generateDNSSteps(dnsRecords, sourceProvider, targetProvider));
  }

  // Add cutover step (depends on all verify steps)
  const verifyStepIds = steps.filter((s) =>
    s.type === "verify-boot" || s.type === "verify-integrity" || s.type === "verify-connectivity",
  ).map((s) => s.id);

  if (verifyStepIds.length > 0) {
    steps.push({
      id: `cutover-${randomUUID().slice(0, 8)}`,
      type: "cutover",
      name: "Final cutover",
      description: "DNS/LB switch and source decommission preparation",
      params: { verifyStepIds },
      dependsOn: verifyStepIds,
      timeoutMs: 300_000,
      pipeline: "network",
      resourceType: "dns",
      requiresRollback: true,
    });
  }

  // Estimated duration
  const estimatedDurationMs = steps.reduce((sum, s) => sum + s.timeoutMs, 0);

  return {
    id: randomUUID(),
    name,
    description,
    jobId,
    steps,
    globalParams,
    createdAt: new Date().toISOString(),
    estimatedDurationMs,
    estimatedCost: assessment.costEstimate,
    riskAssessment: assessment.riskAssessment,
  };
}

// =============================================================================
// Step Generators
// =============================================================================

function generateComputeSteps(
  vm: NormalizedVM,
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const prefix = `vm-${vm.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
  const steps: MigrationStep[] = [];

  const snapshotId = `${prefix}-snapshot`;
  steps.push({
    id: snapshotId,
    type: "snapshot-source",
    name: `Snapshot VM ${vm.name}`,
    description: `Create snapshot of source VM ${vm.name} on ${source}`,
    params: { vmId: vm.id, vmName: vm.name, provider: source },
    dependsOn: [],
    timeoutMs: 600_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const exportId = `${prefix}-export`;
  steps.push({
    id: exportId,
    type: "export-image",
    name: `Export image for ${vm.name}`,
    description: `Export VM image to staging bucket`,
    params: { snapshotId: `${snapshotId}.outputs.snapshotId`, provider: source },
    dependsOn: [snapshotId],
    timeoutMs: 1_200_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const transferId = `${prefix}-transfer`;
  steps.push({
    id: transferId,
    type: "transfer-image",
    name: `Transfer image for ${vm.name}`,
    description: `Transfer image from ${source} to ${target} staging`,
    params: {
      exportPath: `${exportId}.outputs.exportPath`,
      sourceProvider: source,
      targetProvider: target,
    },
    dependsOn: [exportId],
    timeoutMs: 1_800_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const convertId = `${prefix}-convert`;
  steps.push({
    id: convertId,
    type: "convert-image",
    name: `Convert image for ${vm.name}`,
    description: `Convert image format for ${target}`,
    params: {
      imagePath: `${transferId}.outputs.targetPath`,
      sourceFormat: "raw",
      targetProvider: target,
    },
    dependsOn: [transferId],
    timeoutMs: 1_200_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const importId = `${prefix}-import`;
  steps.push({
    id: importId,
    type: "import-image",
    name: `Import image for ${vm.name}`,
    description: `Import image as ${target} disk`,
    params: {
      convertedPath: `${convertId}.outputs.convertedPath`,
      targetProvider: target,
    },
    dependsOn: [convertId],
    timeoutMs: 900_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const remediateId = `${prefix}-remediate`;
  steps.push({
    id: remediateId,
    type: "remediate-boot",
    name: `Remediate boot for ${vm.name}`,
    description: `Inject cloud-specific drivers and agents for ${target}`,
    params: {
      diskId: `${importId}.outputs.diskId`,
      targetProvider: target,
      osType: vm.osType,
    },
    dependsOn: [importId],
    timeoutMs: 600_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: false, // Idempotent
  });

  const provisionId = `${prefix}-provision`;
  steps.push({
    id: provisionId,
    type: "provision-vm",
    name: `Provision VM ${vm.name} on ${target}`,
    description: `Create target VM from imported image`,
    params: {
      diskId: `${remediateId}.outputs.diskId`,
      vmSpec: {
        name: vm.name,
        cpuCores: vm.cpuCores,
        memoryGB: vm.memoryGB,
        osType: vm.osType,
        tags: vm.tags,
      },
      targetProvider: target,
    },
    dependsOn: [remediateId],
    timeoutMs: 600_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const verifyId = `${prefix}-verify`;
  steps.push({
    id: verifyId,
    type: "verify-boot",
    name: `Verify boot for ${vm.name}`,
    description: `Health-check the target VM (SSH/RDP, cloud-init completion)`,
    params: {
      vmId: `${provisionId}.outputs.vmId`,
      targetProvider: target,
    },
    dependsOn: [provisionId],
    timeoutMs: 300_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: false, // Read-only
  });

  return steps;
}

function generateDataSteps(
  bucket: NormalizedBucket,
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const prefix = `data-${bucket.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
  const steps: MigrationStep[] = [];

  const inventoryId = `${prefix}-inventory`;
  steps.push({
    id: inventoryId,
    type: "inventory-source",
    name: `Inventory ${bucket.name}`,
    description: `Enumerate all objects in source bucket ${bucket.name}`,
    params: { bucketName: bucket.name, provider: source },
    dependsOn: [],
    timeoutMs: 600_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: false, // Read-only
  });

  const createId = `${prefix}-create`;
  steps.push({
    id: createId,
    type: "create-target",
    name: `Create target for ${bucket.name}`,
    description: `Create target bucket/container on ${target}`,
    params: {
      bucketName: bucket.name,
      region: bucket.region,
      targetProvider: target,
      versioning: bucket.versioning,
    },
    dependsOn: [inventoryId],
    timeoutMs: 120_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: true,
  });

  const transferId = `${prefix}-transfer`;
  steps.push({
    id: transferId,
    type: "transfer-objects",
    name: `Transfer objects for ${bucket.name}`,
    description: `Parallel chunked transfer of ${bucket.objectCount} objects`,
    params: {
      sourceBucket: bucket.name,
      targetBucket: `${createId}.outputs.targetBucketName`,
      sourceProvider: source,
      targetProvider: target,
      objectCount: bucket.objectCount,
    },
    dependsOn: [createId],
    timeoutMs: 7_200_000, // 2 hours max for large transfers
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: true,
  });

  const verifyId = `${prefix}-verify`;
  steps.push({
    id: verifyId,
    type: "verify-integrity",
    name: `Verify integrity for ${bucket.name}`,
    description: `SHA-256 per-object verification`,
    params: {
      sourceBucket: bucket.name,
      targetBucket: `${createId}.outputs.targetBucketName`,
      sourceProvider: source,
      targetProvider: target,
    },
    dependsOn: [transferId],
    timeoutMs: 600_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: false, // Read-only
  });

  const metadataId = `${prefix}-metadata`;
  steps.push({
    id: metadataId,
    type: "sync-metadata",
    name: `Sync metadata for ${bucket.name}`,
    description: `Sync ACLs, lifecycle rules, tags, encryption config`,
    params: {
      targetBucket: `${createId}.outputs.targetBucketName`,
      targetProvider: target,
      lifecycle: bucket.lifecycleRules,
      tags: bucket.tags,
      encryption: bucket.encryption,
    },
    dependsOn: [verifyId],
    timeoutMs: 120_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: true,
  });

  return steps;
}

function generateNetworkSteps(
  source: MigrationProvider,
  target: MigrationProvider,
  securityRules: NormalizedSecurityRule[],
): MigrationStep[] {
  const prefix = "network";
  const steps: MigrationStep[] = [];

  const mapId = `${prefix}-map`;
  steps.push({
    id: mapId,
    type: "map-network",
    name: "Map network topology",
    description: `Discover network topology at source (${source})`,
    params: { provider: source },
    dependsOn: [],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "security-rules",
    requiresRollback: false,
  });

  const createRulesId = `${prefix}-rules`;
  steps.push({
    id: createRulesId,
    type: "create-security-rules",
    name: "Create security rules at target",
    description: `Translate and create ${securityRules.length} security rules on ${target}`,
    params: {
      sourceRules: securityRules,
      sourceProvider: source,
      targetProvider: target,
      networkTopology: `${mapId}.outputs.topology`,
    },
    dependsOn: [mapId],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "security-rules",
    requiresRollback: true,
  });

  const verifyId = `${prefix}-verify`;
  steps.push({
    id: verifyId,
    type: "verify-connectivity",
    name: "Verify connectivity",
    description: "Post-migration connectivity test",
    params: {
      targetProvider: target,
      rulesCreated: `${createRulesId}.outputs.ruleIds`,
    },
    dependsOn: [createRulesId],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "security-rules",
    requiresRollback: false,
  });

  return steps;
}

function generateDNSSteps(
  dnsRecords: NormalizedDNSRecord[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  if (dnsRecords.length === 0) return [];

  const prefix = "dns";
  const steps: MigrationStep[] = [];

  const migrateId = `${prefix}-migrate`;
  steps.push({
    id: migrateId,
    type: "migrate-dns",
    name: "Migrate DNS records",
    description: `Migrate ${dnsRecords.length} DNS records from ${source} to ${target}`,
    params: {
      records: dnsRecords,
      sourceProvider: source,
      targetProvider: target,
    },
    dependsOn: [],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "dns",
    requiresRollback: true,
  });

  return steps;
}
