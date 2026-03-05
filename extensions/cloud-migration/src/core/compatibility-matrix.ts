/**
 * Cross-Cloud Migration Engine — Compatibility Matrix
 *
 * Source × Target × ResourceType compatibility rules for all 12 migration directions.
 * Returns { compatible, warnings[], blockers[], workarounds[] } for each combination.
 */

import type {
  MigrationProvider,
  MigrationResourceType,
  CompatibilityResult,
  CompatibilityWarning,
  CompatibilityBlocker,
  CompatibilityWorkaround,
} from "../types.js";

// =============================================================================
// Compatibility Rule Definitions
// =============================================================================

type CompatibilityRuleDef = {
  compatible: boolean;
  warnings?: CompatibilityWarning[];
  blockers?: CompatibilityBlocker[];
  workarounds?: CompatibilityWorkaround[];
};

/**
 * Lookup key: `${source}:${target}:${resourceType}`
 * Rules for all 12 directions × 7 resource types = 84 entries.
 */
const RULES = new Map<string, CompatibilityRuleDef>();

function ruleKey(source: MigrationProvider, target: MigrationProvider, rt: MigrationResourceType): string {
  return `${source}:${target}:${rt}`;
}

function defineRule(
  source: MigrationProvider,
  target: MigrationProvider,
  rt: MigrationResourceType,
  rule: CompatibilityRuleDef,
): void {
  RULES.set(ruleKey(source, target, rt), rule);
}

// =============================================================================
// AWS ↔ Azure
// =============================================================================

defineRule("aws", "azure", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Hyper-V drivers (hv_vmbus, hv_storvsc, hv_netvsc) required for Azure", severity: "medium", affectedFeatures: ["boot", "networking"] },
    { code: "VM_SIZE_APPROX", message: "VM size mapping is approximate; review target VM size after conversion", severity: "low" },
  ],
});

defineRule("azure", "aws", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "AWS ENA/NVMe drivers required; Hyper-V agents will be removed", severity: "medium", affectedFeatures: ["boot", "networking"] },
    { code: "VM_SIZE_APPROX", message: "VM size mapping is approximate; review target instance type", severity: "low" },
  ],
});

defineRule("aws", "azure", "disk", {
  compatible: true,
  warnings: [
    { code: "DISK_FORMAT", message: "RAW → VHD conversion required", severity: "low" },
  ],
});

defineRule("azure", "aws", "disk", {
  compatible: true,
  warnings: [
    { code: "DISK_FORMAT", message: "VHD → RAW conversion required", severity: "low" },
  ],
});

defineRule("aws", "azure", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "S3 ACL/Bucket Policy → Azure RBAC: semantic mismatch possible", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "KMS keys do not transfer; target encryption must be configured separately", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("azure", "aws", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "Azure RBAC → S3 ACL: semantic mismatch possible", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "Azure CMK does not transfer; configure SSE-KMS on target", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("aws", "azure", "database", {
  compatible: true,
  warnings: [
    { code: "DB_PARAM_REVIEW", message: "Review PostgreSQL/MySQL parameters after migration (extensions, collation)", severity: "medium" },
  ],
});

defineRule("azure", "aws", "database", {
  compatible: true,
  warnings: [
    { code: "DB_PARAM_REVIEW", message: "Review database parameters after migration", severity: "medium" },
  ],
});

defineRule("aws", "azure", "dns", { compatible: true });
defineRule("azure", "aws", "dns", { compatible: true });

defineRule("aws", "azure", "security-rules", {
  compatible: true,
  warnings: [
    { code: "SG_STATEFUL", message: "Both AWS SG and Azure NSG are stateful; direct mapping supported", severity: "low" },
  ],
});

defineRule("azure", "aws", "security-rules", {
  compatible: true,
  warnings: [
    { code: "ASG_EXPAND", message: "Azure Application Security Groups have no AWS equivalent; expanded to CIDR ranges", severity: "high", affectedFeatures: ["security-groups"] },
  ],
});

defineRule("aws", "azure", "load-balancer", {
  compatible: true,
  warnings: [
    { code: "LB_FEATURE_DIFF", message: "AWS ALB features may not map 1:1 to Azure Application Gateway", severity: "medium" },
  ],
});

defineRule("azure", "aws", "load-balancer", {
  compatible: true,
  warnings: [
    { code: "LB_FEATURE_DIFF", message: "Azure LB/App Gateway features may not map 1:1 to AWS ALB/NLB", severity: "medium" },
  ],
});

// =============================================================================
// AWS ↔ GCP
// =============================================================================

defineRule("aws", "gcp", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Google guest agent and virtio drivers required for GCP", severity: "medium", affectedFeatures: ["boot", "networking"] },
    { code: "VM_SIZE_APPROX", message: "Machine type mapping is approximate", severity: "low" },
  ],
});

defineRule("gcp", "aws", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "AWS ENA/NVMe drivers required; GCP agents will be removed", severity: "medium", affectedFeatures: ["boot", "networking"] },
  ],
});

defineRule("aws", "gcp", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "RAW format used for transfer", severity: "low" }] });
defineRule("gcp", "aws", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "RAW format used for transfer", severity: "low" }] });

defineRule("aws", "gcp", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "S3 ACL → GCS IAM: semantic differences", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "KMS keys do not transfer", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("gcp", "aws", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "GCS IAM → S3 ACL: semantic differences", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "CMEK does not transfer", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("aws", "gcp", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review database parameters after migration", severity: "medium" }] });
defineRule("gcp", "aws", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review database parameters after migration", severity: "medium" }] });

defineRule("aws", "gcp", "dns", { compatible: true });
defineRule("gcp", "aws", "dns", { compatible: true });

defineRule("aws", "gcp", "security-rules", {
  compatible: true,
  warnings: [
    { code: "SG_TO_FIREWALL", message: "AWS Security Groups use SG references; GCP Firewall uses network tags — requires mapping", severity: "high", affectedFeatures: ["security-groups"] },
  ],
});

defineRule("gcp", "aws", "security-rules", {
  compatible: true,
  warnings: [
    { code: "TAGS_TO_SG", message: "GCP network tags have no direct AWS equivalent; mapped to SG membership", severity: "high", affectedFeatures: ["security-groups"] },
  ],
});

defineRule("aws", "gcp", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "AWS ALB → GCP HTTPS LB: feature parity varies", severity: "medium" }] });
defineRule("gcp", "aws", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "GCP HTTPS LB → AWS ALB: feature parity varies", severity: "medium" }] });

// =============================================================================
// Azure ↔ GCP
// =============================================================================

defineRule("azure", "gcp", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Google guest agent required; Hyper-V agents will be removed", severity: "medium" },
  ],
});

defineRule("gcp", "azure", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Hyper-V drivers required; GCP agents will be removed", severity: "medium" },
  ],
});

defineRule("azure", "gcp", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "VHD → RAW conversion", severity: "low" }] });
defineRule("gcp", "azure", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "RAW → VHD conversion", severity: "low" }] });

defineRule("azure", "gcp", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "Azure RBAC → GCS IAM", severity: "medium" },
    { code: "ENCRYPTION_REKEY", message: "CMK keys do not transfer", severity: "medium" },
  ],
});

defineRule("gcp", "azure", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "GCS IAM → Azure RBAC", severity: "medium" },
    { code: "ENCRYPTION_REKEY", message: "CMEK does not transfer", severity: "medium" },
  ],
});

defineRule("azure", "gcp", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review parameters after migration", severity: "medium" }] });
defineRule("gcp", "azure", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review parameters after migration", severity: "medium" }] });

defineRule("azure", "gcp", "dns", { compatible: true });
defineRule("gcp", "azure", "dns", { compatible: true });

defineRule("azure", "gcp", "security-rules", {
  compatible: true,
  warnings: [
    { code: "ASG_NO_EQUIV", message: "Azure ASGs expanded to CIDR for GCP; GCP uses network tags", severity: "high" },
  ],
});

defineRule("gcp", "azure", "security-rules", {
  compatible: true,
  warnings: [
    { code: "TAGS_NO_EQUIV", message: "GCP network tags mapped to NSG rules; may lose tag semantics", severity: "high" },
  ],
});

defineRule("azure", "gcp", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "Feature parity varies between LB types", severity: "medium" }] });
defineRule("gcp", "azure", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "Feature parity varies between LB types", severity: "medium" }] });

// =============================================================================
// Cloud ↔ On-Premises
// =============================================================================

const ON_PREM_PROVIDERS: MigrationProvider[] = ["on-premises", "vmware", "nutanix"];
const CLOUD_PROVIDERS: MigrationProvider[] = ["aws", "azure", "gcp"];

for (const onPrem of ON_PREM_PROVIDERS) {
  for (const cloud of CLOUD_PROVIDERS) {
    defineRule(onPrem, cloud, "vm", {
      compatible: true,
      warnings: [
        { code: "AGENT_REQUIRED", message: "On-prem migration agent required for VM export", severity: "high" },
        { code: "VM_DRIVER_SWAP", message: `Cloud-specific drivers required for ${cloud}`, severity: "medium" },
      ],
    });

    defineRule(cloud, onPrem, "vm", {
      compatible: true,
      warnings: [
        { code: "HYPERVISOR_TOOLS", message: "Hypervisor-specific tools required for on-prem target", severity: "high" },
      ],
    });

    defineRule(onPrem, cloud, "disk", { compatible: true, warnings: [{ code: "FORMAT_CONVERT", message: "Disk format conversion required", severity: "low" }] });
    defineRule(cloud, onPrem, "disk", { compatible: true, warnings: [{ code: "FORMAT_CONVERT", message: "Disk format conversion required", severity: "low" }] });

    defineRule(onPrem, cloud, "object-storage", {
      compatible: true,
      warnings: [
        { code: "TRANSFER_BANDWIDTH", message: "Transfer speed limited by on-prem network bandwidth", severity: "medium" },
      ],
    });

    defineRule(cloud, onPrem, "object-storage", {
      compatible: true,
      warnings: [
        { code: "TRANSFER_BANDWIDTH", message: "Transfer speed limited by on-prem network bandwidth", severity: "medium" },
        { code: "STORAGE_INFRA", message: "On-prem object storage (MinIO/Ceph) must be pre-provisioned", severity: "high" },
      ],
    });

    defineRule(onPrem, cloud, "database", { compatible: true });
    defineRule(cloud, onPrem, "database", { compatible: true });
    defineRule(onPrem, cloud, "dns", { compatible: true });
    defineRule(cloud, onPrem, "dns", { compatible: true });
    defineRule(onPrem, cloud, "security-rules", {
      compatible: true,
      warnings: [{ code: "RULE_FORMAT", message: "On-prem firewall rules require manual translation review", severity: "high" }],
    });
    defineRule(cloud, onPrem, "security-rules", {
      compatible: true,
      warnings: [{ code: "RULE_FORMAT", message: "Cloud rules need on-prem firewall format translation", severity: "high" }],
    });
    defineRule(onPrem, cloud, "load-balancer", {
      compatible: true,
      warnings: [{ code: "LB_REIMPL", message: "On-prem LB config must be re-implemented in cloud-native LB", severity: "high" }],
    });
    defineRule(cloud, onPrem, "load-balancer", {
      compatible: true,
      warnings: [{ code: "LB_REIMPL", message: "Cloud LB config must be re-implemented for on-prem (HAProxy/Nginx/F5)", severity: "high" }],
    });
  }
}

// On-prem ↔ On-prem (same provider = not a real migration, block it)
for (const a of ON_PREM_PROVIDERS) {
  for (const b of ON_PREM_PROVIDERS) {
    if (a === b) continue;
    const RESOURCE_TYPES: MigrationResourceType[] = ["vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer"];
    for (const rt of RESOURCE_TYPES) {
      defineRule(a, b, rt, {
        compatible: true,
        warnings: [{ code: "ONPREM_TO_ONPREM", message: `${a} → ${b} migration: verify hypervisor compatibility`, severity: "medium" }],
      });
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check migration compatibility for a specific resource type between two providers.
 */
export function checkCompatibility(
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
  resourceType: MigrationResourceType,
): CompatibilityResult {
  if (sourceProvider === targetProvider) {
    return {
      sourceProvider,
      targetProvider,
      resourceType,
      compatible: false,
      warnings: [],
      blockers: [{ code: "SAME_PROVIDER", message: "Source and target are the same provider", reason: "Migration between identical providers is a no-op" }],
      workarounds: [],
    };
  }

  const key = ruleKey(sourceProvider, targetProvider, resourceType);
  const rule = RULES.get(key);

  if (!rule) {
    return {
      sourceProvider,
      targetProvider,
      resourceType,
      compatible: false,
      warnings: [],
      blockers: [{ code: "UNSUPPORTED_PATH", message: `No migration rule defined for ${sourceProvider} → ${targetProvider} (${resourceType})`, reason: "Migration path not yet implemented" }],
      workarounds: [],
    };
  }

  return {
    sourceProvider,
    targetProvider,
    resourceType,
    compatible: rule.compatible,
    warnings: rule.warnings ?? [],
    blockers: rule.blockers ?? [],
    workarounds: rule.workarounds ?? [],
  };
}

/**
 * Check compatibility for all resource types between two providers.
 */
export function checkAllCompatibility(
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
): CompatibilityResult[] {
  const resourceTypes: MigrationResourceType[] = [
    "vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer",
  ];
  return resourceTypes.map((rt) => checkCompatibility(sourceProvider, targetProvider, rt));
}

/**
 * Get the full compatibility matrix for all provider pairs.
 */
export function getFullCompatibilityMatrix(): CompatibilityResult[] {
  const providers: MigrationProvider[] = ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"];
  const results: CompatibilityResult[] = [];

  for (const source of providers) {
    for (const target of providers) {
      if (source === target) continue;
      results.push(...checkAllCompatibility(source, target));
    }
  }

  return results;
}

/**
 * Get summary of compatibility for a migration direction.
 */
export function getCompatibilitySummary(
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
): {
  direction: string;
  allCompatible: boolean;
  totalWarnings: number;
  totalBlockers: number;
  results: CompatibilityResult[];
} {
  const results = checkAllCompatibility(sourceProvider, targetProvider);
  return {
    direction: `${sourceProvider} → ${targetProvider}`,
    allCompatible: results.every((r) => r.compatible),
    totalWarnings: results.reduce((sum, r) => sum + r.warnings.length, 0),
    totalBlockers: results.reduce((sum, r) => sum + r.blockers.length, 0),
    results,
  };
}
