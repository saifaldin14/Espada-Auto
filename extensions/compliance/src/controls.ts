/**
 * Compliance — Built-in Controls per Framework
 *
 * Each framework provides a set of controls that evaluate graph node
 * metadata/tags/config to determine compliance status.
 */

import type { ComplianceControl, ComplianceFramework, ControlSeverity, ResourceType, ControlEvalNode, FrameworkId } from "./types.js";

// ---------------------------------------------------------------------------
// Helper — tag presence / metadata field check
// ---------------------------------------------------------------------------
function hasTag(node: ControlEvalNode, key: string): boolean {
  return key in (node.tags ?? {});
}

function metaBool(node: ControlEvalNode, key: string): boolean {
  return node.metadata?.[key] === true || node.metadata?.[key] === "true";
}

function metaExists(node: ControlEvalNode, key: string): boolean {
  return node.metadata?.[key] !== undefined && node.metadata?.[key] !== null;
}

// ---------------------------------------------------------------------------
// Reusable control factories
// ---------------------------------------------------------------------------
function encryptionAtRest(id: string, framework: string): ComplianceControl {
  return {
    id: `${framework}-${id}`,
    title: "Encryption at rest",
    description: "Resources must have encryption enabled at rest.",
    category: "Data Protection",
    severity: "high" as ControlSeverity,
    applicableResourceTypes: ["storage", "database", "cache", "queue"] as ResourceType[],
    evaluate: (node) => metaBool(node, "encrypted") || metaBool(node, "encryption_enabled") || metaBool(node, "kms_key_id"),
    remediation: "Enable encryption at rest using a KMS key or platform-managed encryption.",
    references: [],
  };
}

function accessLogging(id: string, framework: string): ComplianceControl {
  return {
    id: `${framework}-${id}`,
    title: "Access logging enabled",
    description: "Resources must have access logging enabled for audit purposes.",
    category: "Logging & Monitoring",
    severity: "medium" as ControlSeverity,
    applicableResourceTypes: ["storage", "database", "compute", "load-balancer", "gateway"] as ResourceType[],
    evaluate: (node) => metaBool(node, "logging_enabled") || metaBool(node, "access_logging"),
    remediation: "Enable access logging on the resource.",
    references: [],
  };
}

function publicAccessBlocked(id: string, framework: string): ComplianceControl {
  return {
    id: `${framework}-${id}`,
    title: "No public access",
    description: "Resources must not be publicly accessible unless explicitly required.",
    category: "Access Control",
    severity: "critical" as ControlSeverity,
    applicableResourceTypes: ["storage", "database", "compute", "cache", "queue", "cluster"] as ResourceType[],
    evaluate: (node) => !metaBool(node, "public_access") && !metaBool(node, "publicly_accessible"),
    remediation: "Disable public access and restrict to private networks.",
    references: [],
  };
}

function backupEnabled(id: string, framework: string): ComplianceControl {
  return {
    id: `${framework}-${id}`,
    title: "Backup enabled",
    description: "Critical resources must have automated backups configured.",
    category: "Data Protection",
    severity: "high" as ControlSeverity,
    applicableResourceTypes: ["database", "storage", "compute"] as ResourceType[],
    evaluate: (node) => metaBool(node, "backup_enabled") || metaExists(node, "backup_retention"),
    remediation: "Enable automated backups with an appropriate retention policy.",
    references: [],
  };
}

function taggingRequired(id: string, framework: string, requiredTags: string[]): ComplianceControl {
  return {
    id: `${framework}-${id}`,
    title: "Required tags present",
    description: `Resources must have required tags: ${requiredTags.join(", ")}`,
    category: "Configuration Management",
    severity: "low" as ControlSeverity,
    applicableResourceTypes: ["compute", "storage", "database", "cache", "queue", "cluster", "function", "serverless-function", "network", "vpc", "subnet", "load-balancer"] as ResourceType[],
    evaluate: (node) => requiredTags.every((t) => hasTag(node, t)),
    remediation: `Add missing tags: ${requiredTags.join(", ")}`,
    references: [],
  };
}

// ---------------------------------------------------------------------------
// SOC2 — Trust Services Criteria
// ---------------------------------------------------------------------------
const soc2Controls: ComplianceControl[] = [
  encryptionAtRest("CC6.1", "soc2"),
  accessLogging("CC7.2", "soc2"),
  backupEnabled("A1.2", "soc2"),
  publicAccessBlocked("CC6.6", "soc2"),
  {
    id: "soc2-CC6.3",
    title: "Change tracking enabled",
    description: "Infrastructure changes must be tracked for audit.",
    category: "Change Management",
    severity: "medium",
    applicableResourceTypes: ["compute", "database", "storage", "cluster"],
    evaluate: (node) => metaBool(node, "change_tracking") || metaBool(node, "versioning_enabled"),
    remediation: "Enable change tracking or versioning on the resource.",
    references: [],
  },
  {
    id: "soc2-CC6.2",
    title: "MFA / strong auth",
    description: "Identity resources must enforce multi-factor authentication.",
    category: "Access Control",
    severity: "critical",
    applicableResourceTypes: ["identity"],
    evaluate: (node) => metaBool(node, "mfa_enabled"),
    remediation: "Enable MFA on identity/IAM resources.",
    references: [],
  },
];

// ---------------------------------------------------------------------------
// CIS Benchmarks
// ---------------------------------------------------------------------------
const cisControls: ComplianceControl[] = [
  publicAccessBlocked("2.1.1", "cis"),
  encryptionAtRest("2.1.2", "cis"),
  {
    id: "cis-1.4",
    title: "Key rotation configured",
    description: "Encryption keys must be rotated periodically.",
    category: "Key Management",
    severity: "medium",
    applicableResourceTypes: ["secret", "database", "storage"],
    evaluate: (node) => metaBool(node, "key_rotation") || metaExists(node, "rotation_period"),
    remediation: "Enable automatic key rotation (90-day or less cycle).",
    references: [],
  },
  {
    id: "cis-4.1",
    title: "Unused resources removed",
    description: "Resources with 'stopped' or 'unused' status should be reviewed or terminated.",
    category: "Asset Management",
    severity: "low",
    applicableResourceTypes: ["compute", "database", "cache", "cluster"],
    evaluate: (node) => node.status !== "stopped" && node.status !== "unused",
    remediation: "Terminate or decommission unused resources.",
    references: [],
  },
  {
    id: "cis-5.1",
    title: "Default VPC not used",
    description: "Resources should not use the default VPC.",
    category: "Network Security",
    severity: "medium",
    applicableResourceTypes: ["vpc", "subnet", "compute"],
    evaluate: (node) => !metaBool(node, "is_default"),
    remediation: "Migrate resources from the default VPC to a custom VPC.",
    references: [],
  },
  accessLogging("3.1", "cis"),
];

// ---------------------------------------------------------------------------
// HIPAA
// ---------------------------------------------------------------------------
const hipaaControls: ComplianceControl[] = [
  encryptionAtRest("164.312-a1", "hipaa"),
  {
    id: "hipaa-164.312-e1",
    title: "Encryption in transit",
    description: "PHI must be encrypted in transit.",
    category: "Data Protection",
    severity: "critical",
    applicableResourceTypes: ["database", "storage", "compute", "load-balancer", "gateway", "cache"],
    evaluate: (node) => metaBool(node, "ssl_enabled") || metaBool(node, "tls_enabled") || metaBool(node, "encryption_in_transit"),
    remediation: "Enable TLS/SSL for all data in transit.",
    references: [],
  },
  accessLogging("164.312-b", "hipaa"),
  {
    id: "hipaa-164.312-d",
    title: "Access controls",
    description: "Access to PHI must be restricted to authorized personnel.",
    category: "Access Control",
    severity: "critical",
    applicableResourceTypes: ["database", "storage", "compute"],
    evaluate: (node) => metaBool(node, "access_control") || !metaBool(node, "public_access"),
    remediation: "Implement role-based access controls for PHI resources.",
    references: [],
  },
  backupEnabled("164.308-a7", "hipaa"),
];

// ---------------------------------------------------------------------------
// PCI-DSS
// ---------------------------------------------------------------------------
const pciControls: ComplianceControl[] = [
  {
    id: "pci-1.3",
    title: "Network segmentation",
    description: "Cardholder data environment must be segmented from other networks.",
    category: "Network Security",
    severity: "critical",
    applicableResourceTypes: ["vpc", "subnet", "network", "firewall", "security-group"],
    evaluate: (node) => metaBool(node, "segmented") || metaExists(node, "network_policy"),
    remediation: "Implement network segmentation for cardholder data environment.",
    references: [],
  },
  encryptionAtRest("3.4", "pci"),
  {
    id: "pci-8.3",
    title: "MFA for remote access",
    description: "Multi-factor authentication required for all remote access.",
    category: "Access Control",
    severity: "critical",
    applicableResourceTypes: ["identity", "gateway", "compute"],
    evaluate: (node) => metaBool(node, "mfa_enabled") || metaBool(node, "mfa_required"),
    remediation: "Enable MFA for remote access to cardholder data.",
    references: [],
  },
  accessLogging("10.2", "pci"),
  {
    id: "pci-6.6",
    title: "Web application firewall",
    description: "Public-facing web applications must be protected by a WAF.",
    category: "Application Security",
    severity: "high",
    applicableResourceTypes: ["load-balancer", "gateway", "cdn"],
    evaluate: (node) => metaBool(node, "waf_enabled"),
    remediation: "Deploy a Web Application Firewall in front of public-facing apps.",
    references: [],
  },
];

// ---------------------------------------------------------------------------
// GDPR
// ---------------------------------------------------------------------------
const gdprControls: ComplianceControl[] = [
  {
    id: "gdpr-art32-a",
    title: "Data residency compliance",
    description: "Personal data must be stored in approved regions.",
    category: "Data Residency",
    severity: "critical",
    applicableResourceTypes: ["database", "storage", "compute", "cache", "queue"],
    evaluate: (node) => {
      const approved = node.metadata?.approved_regions as string[] | undefined;
      if (!approved || !Array.isArray(approved)) return true; // no restriction defined = assumed OK
      return approved.includes(node.region);
    },
    remediation: "Move data to an approved region per data residency policy.",
    references: [],
  },
  {
    id: "gdpr-art30",
    title: "Data classification tags",
    description: "Resources containing personal data must be tagged with data classification.",
    category: "Data Governance",
    severity: "high",
    applicableResourceTypes: ["database", "storage", "queue"],
    evaluate: (node) => hasTag(node, "data_classification") || hasTag(node, "data-classification"),
    remediation: "Add a data_classification tag (e.g., personal, sensitive, public).",
    references: [],
  },
  encryptionAtRest("art32-b", "gdpr"),
  {
    id: "gdpr-art17",
    title: "Retention policy defined",
    description: "Data retention period must be defined for right-to-erasure compliance.",
    category: "Data Governance",
    severity: "medium",
    applicableResourceTypes: ["database", "storage", "queue"],
    evaluate: (node) => metaExists(node, "retention_days") || metaExists(node, "retention_policy"),
    remediation: "Define a data retention policy for the resource.",
    references: [],
  },
];

// ---------------------------------------------------------------------------
// NIST 800-53
// ---------------------------------------------------------------------------
const nistControls: ComplianceControl[] = [
  publicAccessBlocked("AC-3", "nist"),
  encryptionAtRest("SC-28", "nist"),
  accessLogging("AU-2", "nist"),
  backupEnabled("CP-9", "nist"),
  taggingRequired("CM-8", "nist", ["owner", "environment"]),
  {
    id: "nist-SI-4",
    title: "System monitoring",
    description: "Systems must have active monitoring.",
    category: "Monitoring",
    severity: "medium",
    applicableResourceTypes: ["compute", "database", "cluster", "load-balancer"],
    evaluate: (node) => metaBool(node, "monitoring_enabled") || metaExists(node, "monitoring_agent"),
    remediation: "Enable system monitoring and alerting.",
    references: [],
  },
  {
    id: "nist-IR-4",
    title: "Incident response plan",
    description: "Critical systems must have an incident response plan.",
    category: "Incident Response",
    severity: "high",
    applicableResourceTypes: ["compute", "database", "cluster"],
    evaluate: (node) => metaBool(node, "incident_response_plan") || hasTag(node, "ir-plan"),
    remediation: "Document and tag the resource with an incident response plan.",
    references: [],
  },
];

// ---------------------------------------------------------------------------
// Framework Registry
// ---------------------------------------------------------------------------
export const FRAMEWORKS: ComplianceFramework[] = [
  {
    id: "soc2",
    name: "SOC 2 Type II",
    version: "2017",
    description: "Trust Services Criteria for security, availability, processing integrity, confidentiality, and privacy.",
    controls: soc2Controls,
    categories: [...new Set(soc2Controls.map((c) => c.category))],
  },
  {
    id: "cis",
    name: "CIS Benchmarks",
    version: "3.0",
    description: "Center for Internet Security cloud benchmarks for security best practices.",
    controls: cisControls,
    categories: [...new Set(cisControls.map((c) => c.category))],
  },
  {
    id: "hipaa",
    name: "HIPAA",
    version: "2013",
    description: "Health Insurance Portability and Accountability Act — Technical Safeguards.",
    controls: hipaaControls,
    categories: [...new Set(hipaaControls.map((c) => c.category))],
  },
  {
    id: "pci-dss",
    name: "PCI-DSS",
    version: "4.0",
    description: "Payment Card Industry Data Security Standard.",
    controls: pciControls,
    categories: [...new Set(pciControls.map((c) => c.category))],
  },
  {
    id: "gdpr",
    name: "GDPR",
    version: "2018",
    description: "EU General Data Protection Regulation — technical compliance requirements.",
    controls: gdprControls,
    categories: [...new Set(gdprControls.map((c) => c.category))],
  },
  {
    id: "nist-800-53",
    name: "NIST 800-53",
    version: "Rev. 5",
    description: "Security and Privacy Controls for Information Systems and Organizations.",
    controls: nistControls,
    categories: [...new Set(nistControls.map((c) => c.category))],
  },
];

export function getFramework(id: FrameworkId): ComplianceFramework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}
