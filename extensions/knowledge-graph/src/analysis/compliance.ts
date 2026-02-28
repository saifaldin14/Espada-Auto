/**
 * Infrastructure Knowledge Graph — Compliance Framework Mapping (P2.17)
 *
 * Maps graph resources to compliance framework controls (SOC2, HIPAA,
 * PCI-DSS, ISO 27001, CIS Benchmarks). Evaluates compliance posture
 * across the entire infrastructure graph.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphResourceType,
  CloudProvider,
  NodeFilter,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** Supported compliance frameworks. */
export type ComplianceFramework =
  | "soc2"
  | "hipaa"
  | "pci-dss"
  | "iso-27001"
  | "cis"
  | "nist-800-53";

/** Compliance control status for a specific resource. */
export type ControlStatus = "pass" | "fail" | "warning" | "not-applicable";

/** A single compliance control definition. */
export type ComplianceControl = {
  /** Control ID (e.g. "CC6.1", "164.312(a)(1)"). */
  id: string;
  /** Framework this control belongs to. */
  framework: ComplianceFramework;
  /** Section/category within the framework. */
  section: string;
  /** Short title. */
  title: string;
  /** Description of what is required. */
  description: string;
  /** Severity if violated. */
  severity: "critical" | "high" | "medium" | "low";
  /** Which resource types this control applies to. */
  applicableResourceTypes: GraphResourceType[];
  /** Evaluation function: given a node and its edges/neighbors, return status + reason. */
  evaluate: (ctx: ControlEvaluationContext) => ControlStatus;
  /** Human-readable reason for the evaluation result. */
  reason: (ctx: ControlEvaluationContext, status: ControlStatus) => string;
};

/** Context passed to control evaluation functions. */
export type ControlEvaluationContext = {
  node: GraphNode;
  /** Tags on the node. */
  tags: Record<string, string>;
  /** Metadata on the node. */
  metadata: Record<string, unknown>;
  /** Nodes connected to this node (neighbors). */
  neighbors: GraphNode[];
  /** Whether the node has edges of specific relationship types. */
  hasEdge: (relType: string) => boolean;
  /** Edge relationship types connected to this node. */
  edgeTypes: string[];
};

/** Result of evaluating one control on one resource. */
export type ControlResult = {
  controlId: string;
  framework: ComplianceFramework;
  section: string;
  title: string;
  severity: ComplianceControl["severity"];
  status: ControlStatus;
  reason: string;
  nodeId: string;
  nodeName: string;
  resourceType: GraphResourceType;
  provider: CloudProvider;
};

/** Summary of compliance posture for a framework. */
export type ComplianceSummary = {
  framework: ComplianceFramework;
  totalControls: number;
  passed: number;
  failed: number;
  warnings: number;
  notApplicable: number;
  /** Score as percentage of applicable controls that pass. */
  score: number;
  /** Failing controls grouped by severity. */
  failureBySeverity: Record<string, number>;
  /** Results for all evaluated controls. */
  results: ControlResult[];
};

/** Full compliance report across all requested frameworks. */
export type ComplianceReport = {
  generatedAt: string;
  frameworks: ComplianceSummary[];
  totalResources: number;
  /** Resources with at least one critical/high failure. */
  criticalResources: Array<{
    nodeId: string;
    nodeName: string;
    resourceType: GraphResourceType;
    provider: CloudProvider;
    failures: number;
  }>;
};

// =============================================================================
// Control Definitions
// =============================================================================

/**
 * Helper: check if a node has encryption enabled (common across frameworks).
 */
function hasEncryption(ctx: ControlEvaluationContext): boolean {
  const m = ctx.metadata;
  return (
    ctx.hasEdge("encrypts-with") ||
    m.encrypted === true ||
    m.encryptionEnabled === true ||
    m.storageEncrypted === true ||
    m.kmsKeyId != null ||
    m.sseAlgorithm != null ||
    ctx.tags["Encryption"] === "true"
  );
}

/** Check if a node is in a private subnet / VPC. */
function isNetworkIsolated(ctx: ControlEvaluationContext): boolean {
  const hasPublicExposure =
    ctx.metadata.publicIp != null ||
    ctx.metadata.publiclyAccessible === true;
  return (
    ctx.hasEdge("runs-in") ||
    ctx.hasEdge("secured-by") ||
    !hasPublicExposure
  );
}

/** Check if a node has logging enabled. */
function hasLogging(ctx: ControlEvaluationContext): boolean {
  return (
    ctx.hasEdge("logs-to") ||
    ctx.metadata.loggingEnabled === true ||
    ctx.metadata.auditLogging === true
  );
}

/** Check if a node has backup configured. */
function hasBackup(ctx: ControlEvaluationContext): boolean {
  return (
    ctx.hasEdge("backs-up") ||
    ctx.hasEdge("backed-by") ||
    ctx.metadata.backupEnabled === true ||
    ctx.metadata.backupRetentionPeriod != null
  );
}

/** Check if a node has monitoring. */
function hasMonitoring(ctx: ControlEvaluationContext): boolean {
  return ctx.hasEdge("monitors") || ctx.hasEdge("monitored-by");
}

/** Check if required tags are present. */
function hasRequiredTags(
  ctx: ControlEvaluationContext,
  required: string[],
): boolean {
  return required.every(
    (t) => ctx.tags[t] != null && ctx.tags[t]!.trim() !== "",
  );
}

/** Check if a node has access control (IAM/security groups). */
function hasAccessControl(ctx: ControlEvaluationContext): boolean {
  return (
    ctx.hasEdge("secured-by") ||
    ctx.hasEdge("authenticated-by") ||
    ctx.metadata.iamRole != null ||
    ctx.metadata.securityGroups != null
  );
}

/** Check if multi-AZ/multi-region is configured. */
function hasHighAvailability(ctx: ControlEvaluationContext): boolean {
  return (
    ctx.metadata.multiAz === true ||
    ctx.metadata.availabilityZones != null ||
    ctx.metadata.replicaCount != null
  );
}

/** Check if versioning is enabled (for storage/state). */
function hasVersioning(ctx: ControlEvaluationContext): boolean {
  return (
    ctx.metadata.versioningEnabled === true ||
    ctx.metadata.versioning === "Enabled"
  );
}

/** Check if a resource has MFA or strong auth. */
function hasStrongAuth(ctx: ControlEvaluationContext): boolean {
  return (
    ctx.metadata.mfaEnabled === true ||
    ctx.metadata.mfaDelete === true ||
    ctx.hasEdge("authenticated-by")
  );
}

// -- SOC2 Controls --------------------------------------------------------

const SOC2_CONTROLS: ComplianceControl[] = [
  {
    id: "CC6.1",
    framework: "soc2",
    section: "Logical and Physical Access",
    title: "Encryption at rest",
    description:
      "Data storage resources must have encryption at rest enabled.",
    severity: "critical",
    applicableResourceTypes: [
      "storage",
      "database",
      "cache",
      "queue",
      "stream",
    ],
    evaluate: (ctx) => (hasEncryption(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Encryption at rest is enabled"
        : "No encryption at rest detected",
  },
  {
    id: "CC6.6",
    framework: "soc2",
    section: "Logical and Physical Access",
    title: "Network isolation",
    description:
      "Compute and database resources must not be publicly accessible.",
    severity: "high",
    applicableResourceTypes: ["compute", "database", "cache", "container"],
    evaluate: (ctx) => (isNetworkIsolated(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Resource is network-isolated"
        : "Resource may be publicly accessible",
  },
  {
    id: "CC7.2",
    framework: "soc2",
    section: "System Operations",
    title: "Monitoring enabled",
    description:
      "Critical resources must have monitoring and alerting configured.",
    severity: "medium",
    applicableResourceTypes: [
      "compute",
      "database",
      "load-balancer",
      "cluster",
    ],
    evaluate: (ctx) => (hasMonitoring(ctx) ? "pass" : "warning"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Monitoring is configured"
        : "No monitoring relationship detected",
  },
  {
    id: "CC8.1",
    framework: "soc2",
    section: "Change Management",
    title: "Resource tagging",
    description:
      "All resources must have Environment and Owner tags for change tracking.",
    severity: "medium",
    applicableResourceTypes: [
      "compute",
      "storage",
      "database",
      "function",
      "cluster",
    ],
    evaluate: (ctx) =>
      hasRequiredTags(ctx, ["Environment", "Owner"]) ? "pass" : "fail",
    reason: (_ctx, s) =>
      s === "pass"
        ? "Required tags (Environment, Owner) present"
        : "Missing required tags: Environment and/or Owner",
  },
  {
    id: "CC9.1",
    framework: "soc2",
    section: "Risk Mitigation",
    title: "Backup and recovery",
    description: "Database and storage resources must have backups configured.",
    severity: "high",
    applicableResourceTypes: ["database", "storage"],
    evaluate: (ctx) => (hasBackup(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Backup is configured"
        : "No backup configuration detected",
  },
];

// -- HIPAA Controls -------------------------------------------------------

const HIPAA_CONTROLS: ComplianceControl[] = [
  {
    id: "164.312(a)(1)",
    framework: "hipaa",
    section: "Access Control",
    title: "Unique user identification",
    description:
      "Resources must be secured by IAM roles or security groups.",
    severity: "critical",
    applicableResourceTypes: [
      "compute",
      "database",
      "storage",
      "function",
      "container",
    ],
    evaluate: (ctx) =>
      ctx.hasEdge("secured-by") || ctx.hasEdge("authenticated-by")
        ? "pass"
        : "fail",
    reason: (_ctx, s) =>
      s === "pass"
        ? "Resource is secured by IAM/security group"
        : "No access control relationship detected",
  },
  {
    id: "164.312(a)(2)(iv)",
    framework: "hipaa",
    section: "Access Control",
    title: "Encryption and decryption",
    description:
      "ePHI must be encrypted at rest and in transit.",
    severity: "critical",
    applicableResourceTypes: ["storage", "database", "cache", "queue"],
    evaluate: (ctx) => (hasEncryption(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Encryption is enabled"
        : "No encryption detected — ePHI at risk",
  },
  {
    id: "164.312(b)",
    framework: "hipaa",
    section: "Audit Controls",
    title: "Audit logging",
    description:
      "Systems containing ePHI must have audit logging enabled.",
    severity: "high",
    applicableResourceTypes: [
      "compute",
      "database",
      "storage",
      "function",
      "api-gateway",
    ],
    evaluate: (ctx) => (hasLogging(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Audit logging is enabled"
        : "No audit logging detected",
  },
  {
    id: "164.308(a)(7)",
    framework: "hipaa",
    section: "Contingency Plan",
    title: "Data backup plan",
    description:
      "ePHI database and storage must have backup and recovery configured.",
    severity: "high",
    applicableResourceTypes: ["database", "storage"],
    evaluate: (ctx) => (hasBackup(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Backup plan is in place"
        : "No backup configuration detected",
  },
];

// -- PCI-DSS Controls -----------------------------------------------------

const PCI_DSS_CONTROLS: ComplianceControl[] = [
  {
    id: "PCI-1.3",
    framework: "pci-dss",
    section: "Firewall Configuration",
    title: "Network segmentation",
    description:
      "Cardholder data environments must be network-segmented from public networks.",
    severity: "critical",
    applicableResourceTypes: [
      "compute",
      "database",
      "container",
      "cluster",
    ],
    evaluate: (ctx) => (isNetworkIsolated(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Resource is network-isolated from public access"
        : "Resource may be publicly accessible — violates CDE segmentation",
  },
  {
    id: "PCI-3.4",
    framework: "pci-dss",
    section: "Protect Stored Data",
    title: "Encryption of stored cardholder data",
    description:
      "PANs must be rendered unreadable via encryption, truncation, or hashing.",
    severity: "critical",
    applicableResourceTypes: ["storage", "database", "cache"],
    evaluate: (ctx) => (hasEncryption(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Data encryption at rest is enabled"
        : "No encryption — stored cardholder data may be readable",
  },
  {
    id: "PCI-10.2",
    framework: "pci-dss",
    section: "Track and Monitor",
    title: "Audit trail",
    description:
      "Systems must log all access to cardholder data environments.",
    severity: "high",
    applicableResourceTypes: [
      "compute",
      "database",
      "storage",
      "api-gateway",
    ],
    evaluate: (ctx) => (hasLogging(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Audit logging is enabled"
        : "No audit logging — violates PCI monitoring requirements",
  },
  {
    id: "PCI-6.5",
    framework: "pci-dss",
    section: "Secure Development",
    title: "Security group configuration",
    description:
      "Applications must be protected by security groups or WAFs.",
    severity: "high",
    applicableResourceTypes: [
      "compute",
      "load-balancer",
      "api-gateway",
      "function",
    ],
    evaluate: (ctx) =>
      ctx.hasEdge("secured-by") ? "pass" : "warning",
    reason: (_ctx, s) =>
      s === "pass"
        ? "Protected by security group or WAF"
        : "No explicit security group relationship detected",
  },
];

// -- ISO 27001 Controls ---------------------------------------------------

const ISO_27001_CONTROLS: ComplianceControl[] = [
  {
    id: "A.8.24",
    framework: "iso-27001",
    section: "Cryptography",
    title: "Use of cryptography",
    description:
      "Information must be protected using cryptographic controls.",
    severity: "high",
    applicableResourceTypes: ["storage", "database", "cache", "queue", "stream"],
    evaluate: (ctx) => (hasEncryption(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Cryptographic controls are applied"
        : "No cryptographic controls detected",
  },
  {
    id: "A.8.9",
    framework: "iso-27001",
    section: "Operations Security",
    title: "Configuration management",
    description:
      "Resources must be tagged with Environment, Owner, and Project for configuration management.",
    severity: "medium",
    applicableResourceTypes: [
      "compute",
      "storage",
      "database",
      "function",
      "cluster",
      "container",
    ],
    evaluate: (ctx) =>
      hasRequiredTags(ctx, ["Environment", "Owner"]) ? "pass" : "fail",
    reason: (_ctx, s) =>
      s === "pass"
        ? "Configuration management tags present"
        : "Missing required configuration tags",
  },
  {
    id: "A.8.15",
    framework: "iso-27001",
    section: "Operations Security",
    title: "Logging and monitoring",
    description:
      "Activities must be logged and monitored.",
    severity: "high",
    applicableResourceTypes: [
      "compute",
      "database",
      "load-balancer",
      "api-gateway",
      "cluster",
    ],
    evaluate: (ctx) =>
      hasLogging(ctx) || hasMonitoring(ctx) ? "pass" : "fail",
    reason: (_ctx, s) =>
      s === "pass"
        ? "Logging and monitoring are enabled"
        : "No logging or monitoring detected",
  },
  {
    id: "A.8.13",
    framework: "iso-27001",
    section: "Operations Security",
    title: "Information backup",
    description:
      "Backup copies of information must be maintained and tested.",
    severity: "high",
    applicableResourceTypes: ["database", "storage"],
    evaluate: (ctx) => (hasBackup(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Backup policy is configured"
        : "No backup configuration detected",
  },
];

// -- CIS Benchmarks -------------------------------------------------------

const CIS_CONTROLS: ComplianceControl[] = [
  {
    id: "CIS-1.1",
    framework: "cis",
    section: "Identity and Access Management",
    title: "Avoid root account usage",
    description:
      "IAM roles should be used instead of root credentials. Root account must have MFA.",
    severity: "critical",
    applicableResourceTypes: ["iam-role", "identity"],
    evaluate: (ctx) => {
      if (ctx.node.name.toLowerCase().includes("root")) return "fail";
      return hasStrongAuth(ctx) ? "pass" : "warning";
    },
    reason: (_ctx, s) =>
      s === "pass"
        ? "IAM role with MFA/strong auth"
        : s === "fail"
          ? "Root account detected — use IAM roles instead"
          : "No MFA or strong auth detected on IAM role",
  },
  {
    id: "CIS-1.4",
    framework: "cis",
    section: "Identity and Access Management",
    title: "IAM access keys rotated",
    description:
      "IAM access keys should be rotated within 90 days.",
    severity: "high",
    applicableResourceTypes: ["iam-role", "identity"],
    evaluate: (ctx) => {
      const lastRotated = ctx.metadata.accessKeyLastRotated;
      if (!lastRotated) return "warning";
      const age = Date.now() - new Date(String(lastRotated)).getTime();
      return age < 90 * 86400000 ? "pass" : "fail";
    },
    reason: (_ctx, s) =>
      s === "pass"
        ? "Access keys rotated within 90 days"
        : s === "fail"
          ? "Access keys not rotated within 90 days"
          : "Access key rotation status unknown",
  },
  {
    id: "CIS-2.1",
    framework: "cis",
    section: "Storage",
    title: "S3 bucket encryption",
    description:
      "All storage buckets must have server-side encryption enabled.",
    severity: "critical",
    applicableResourceTypes: ["storage"],
    evaluate: (ctx) => (hasEncryption(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Server-side encryption is enabled"
        : "No server-side encryption detected on storage bucket",
  },
  {
    id: "CIS-2.2",
    framework: "cis",
    section: "Storage",
    title: "S3 bucket versioning",
    description:
      "Storage buckets should have versioning enabled for data protection.",
    severity: "medium",
    applicableResourceTypes: ["storage"],
    evaluate: (ctx) => (hasVersioning(ctx) ? "pass" : "warning"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Versioning is enabled"
        : "Versioning not enabled — risk of data loss",
  },
  {
    id: "CIS-3.1",
    framework: "cis",
    section: "Logging",
    title: "CloudTrail / audit logging enabled",
    description:
      "CloudTrail or equivalent audit logging must be enabled for all regions.",
    severity: "critical",
    applicableResourceTypes: [
      "compute", "database", "storage", "function",
      "api-gateway", "cluster", "container",
    ],
    evaluate: (ctx) => (hasLogging(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Audit logging is enabled"
        : "No audit logging detected — violates CIS logging requirements",
  },
  {
    id: "CIS-3.5",
    framework: "cis",
    section: "Logging",
    title: "Log file encryption",
    description:
      "Log storage must be encrypted at rest.",
    severity: "high",
    applicableResourceTypes: ["storage"],
    evaluate: (ctx) => {
      // If this storage is a log destination, check encryption
      const isLogDest = ctx.edgeTypes.includes("logs-to") || ctx.node.name.toLowerCase().includes("log");
      if (!isLogDest) return "not-applicable";
      return hasEncryption(ctx) ? "pass" : "fail";
    },
    reason: (_ctx, s) =>
      s === "pass"
        ? "Log storage is encrypted"
        : s === "not-applicable"
          ? "Not a log storage destination"
          : "Log storage is not encrypted at rest",
  },
  {
    id: "CIS-4.1",
    framework: "cis",
    section: "Monitoring",
    title: "Monitoring for unauthorized API calls",
    description:
      "Critical infrastructure must have monitoring configured.",
    severity: "high",
    applicableResourceTypes: [
      "compute", "database", "load-balancer",
      "cluster", "api-gateway",
    ],
    evaluate: (ctx) => (hasMonitoring(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Monitoring is configured"
        : "No monitoring detected — unauthorized access may go unnoticed",
  },
  {
    id: "CIS-4.3",
    framework: "cis",
    section: "Networking",
    title: "Security group — no unrestricted ingress",
    description:
      "Security groups must not allow unrestricted ingress (0.0.0.0/0 on sensitive ports).",
    severity: "critical",
    applicableResourceTypes: ["security-group"],
    evaluate: (ctx) => {
      const rules = ctx.metadata.ingressRules;
      if (!Array.isArray(rules)) return "warning";
      const hasOpen = rules.some((r: Record<string, unknown>) =>
        String(r.cidr ?? "").includes("0.0.0.0/0") &&
        (Number(r.port) === 22 || Number(r.port) === 3389 || Number(r.port) === 0));
      return hasOpen ? "fail" : "pass";
    },
    reason: (_ctx, s) =>
      s === "pass"
        ? "No unrestricted ingress on sensitive ports"
        : s === "fail"
          ? "Unrestricted ingress (0.0.0.0/0) on SSH/RDP/all-ports detected"
          : "Could not evaluate security group rules",
  },
  {
    id: "CIS-5.1",
    framework: "cis",
    section: "Networking",
    title: "VPC flow logging",
    description:
      "VPC flow logs must be enabled for network monitoring.",
    severity: "high",
    applicableResourceTypes: ["vpc"],
    evaluate: (ctx) =>
      ctx.metadata.flowLogsEnabled === true || hasLogging(ctx) ? "pass" : "fail",
    reason: (_ctx, s) =>
      s === "pass"
        ? "VPC flow logging is enabled"
        : "VPC flow logging is not enabled",
  },
  {
    id: "CIS-5.4",
    framework: "cis",
    section: "Networking",
    title: "Default security group restricts all traffic",
    description:
      "The default security group in every VPC should restrict all inbound and outbound traffic.",
    severity: "medium",
    applicableResourceTypes: ["security-group"],
    evaluate: (ctx) => {
      if (!ctx.node.name.toLowerCase().includes("default")) return "not-applicable";
      const rules = ctx.metadata.ingressRules;
      if (!Array.isArray(rules) || rules.length === 0) return "pass";
      return "fail";
    },
    reason: (_ctx, s) =>
      s === "pass"
        ? "Default security group has no permissive rules"
        : s === "not-applicable"
          ? "Not the default security group"
          : "Default security group has permissive rules — should restrict all traffic",
  },
];

// -- NIST 800-53 Controls -------------------------------------------------

const NIST_800_53_CONTROLS: ComplianceControl[] = [
  {
    id: "AC-2",
    framework: "nist-800-53",
    section: "Access Control",
    title: "Account management",
    description:
      "The organization manages information system accounts, including establishing, activating, modifying, reviewing, disabling, and removing accounts.",
    severity: "high",
    applicableResourceTypes: ["iam-role", "identity", "compute", "database"],
    evaluate: (ctx) => (hasAccessControl(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Account management controls are present"
        : "No IAM/access control relationship detected",
  },
  {
    id: "AC-6",
    framework: "nist-800-53",
    section: "Access Control",
    title: "Least privilege",
    description:
      "The information system enforces least privilege, allowing only authorized accesses necessary for users.",
    severity: "critical",
    applicableResourceTypes: ["iam-role", "identity"],
    evaluate: (ctx) => {
      // Flag wildcard policies or admin-level roles
      const policy = String(ctx.metadata.policyDocument ?? "");
      if (policy.includes("*") && policy.includes("Action")) return "fail";
      return ctx.hasEdge("secured-by") ? "pass" : "warning";
    },
    reason: (_ctx, s) =>
      s === "pass"
        ? "Least privilege appears enforced"
        : s === "fail"
          ? "Wildcard (*) permissions detected — violates least privilege"
          : "Could not verify least privilege enforcement",
  },
  {
    id: "AU-2",
    framework: "nist-800-53",
    section: "Audit and Accountability",
    title: "Audit events",
    description:
      "The information system must generate audit records for defined events.",
    severity: "high",
    applicableResourceTypes: [
      "compute", "database", "storage", "function",
      "api-gateway", "cluster",
    ],
    evaluate: (ctx) => (hasLogging(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Audit logging is enabled"
        : "No audit logging detected",
  },
  {
    id: "AU-6",
    framework: "nist-800-53",
    section: "Audit and Accountability",
    title: "Audit review, analysis, and reporting",
    description:
      "The organization reviews and analyzes audit records for indications of inappropriate activity.",
    severity: "medium",
    applicableResourceTypes: ["compute", "database", "cluster"],
    evaluate: (ctx) => (hasMonitoring(ctx) ? "pass" : "warning"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Audit monitoring and review configured"
        : "No audit review/monitoring relationship detected",
  },
  {
    id: "CP-9",
    framework: "nist-800-53",
    section: "Contingency Planning",
    title: "Information system backup",
    description:
      "The organization conducts backups of user-level and system-level information.",
    severity: "high",
    applicableResourceTypes: ["database", "storage"],
    evaluate: (ctx) => (hasBackup(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Backup is configured"
        : "No backup configuration detected",
  },
  {
    id: "CP-10",
    framework: "nist-800-53",
    section: "Contingency Planning",
    title: "Information system recovery and reconstitution",
    description:
      "The organization provides for the recovery and reconstitution of the system to a known state after disruption.",
    severity: "high",
    applicableResourceTypes: ["database", "compute", "cluster"],
    evaluate: (ctx) => (hasHighAvailability(ctx) || hasBackup(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Recovery capabilities configured (HA/backup)"
        : "No recovery/reconstitution capability detected",
  },
  {
    id: "IA-2",
    framework: "nist-800-53",
    section: "Identification and Authentication",
    title: "User identification and authentication",
    description:
      "The information system uniquely identifies and authenticates users.",
    severity: "critical",
    applicableResourceTypes: ["compute", "database", "function", "container", "api-gateway"],
    evaluate: (ctx) => (hasAccessControl(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Authentication controls are in place"
        : "No authentication mechanism detected",
  },
  {
    id: "SC-7",
    framework: "nist-800-53",
    section: "System and Communications Protection",
    title: "Boundary protection",
    description:
      "The information system monitors and controls communications at external boundaries and key internal boundaries.",
    severity: "critical",
    applicableResourceTypes: ["compute", "database", "container", "cluster"],
    evaluate: (ctx) => (isNetworkIsolated(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Network boundary protection is in place"
        : "Resource may be exposed without boundary protection",
  },
  {
    id: "SC-28",
    framework: "nist-800-53",
    section: "System and Communications Protection",
    title: "Protection of information at rest",
    description:
      "The information system protects the confidentiality and integrity of information at rest.",
    severity: "critical",
    applicableResourceTypes: ["storage", "database", "cache", "queue", "stream"],
    evaluate: (ctx) => (hasEncryption(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "Data at rest is encrypted"
        : "No encryption at rest — data confidentiality at risk",
  },
  {
    id: "SI-4",
    framework: "nist-800-53",
    section: "System and Information Integrity",
    title: "Information system monitoring",
    description:
      "The organization monitors the information system to detect attacks, unauthorized connections, and anomalies.",
    severity: "high",
    applicableResourceTypes: [
      "compute", "database", "load-balancer",
      "cluster", "api-gateway",
    ],
    evaluate: (ctx) => (hasMonitoring(ctx) || hasLogging(ctx) ? "pass" : "fail"),
    reason: (_ctx, s) =>
      s === "pass"
        ? "System monitoring is configured"
        : "No system monitoring detected",
  },
];

// =============================================================================
// Framework Registry
// =============================================================================

/** All built-in compliance controls. */
export const COMPLIANCE_CONTROLS: ComplianceControl[] = [
  ...SOC2_CONTROLS,
  ...HIPAA_CONTROLS,
  ...PCI_DSS_CONTROLS,
  ...ISO_27001_CONTROLS,
  ...CIS_CONTROLS,
  ...NIST_800_53_CONTROLS,
];

/** Get controls for a specific framework. */
export function getFrameworkControls(
  framework: ComplianceFramework,
): ComplianceControl[] {
  return COMPLIANCE_CONTROLS.filter((c) => c.framework === framework);
}

/** All supported frameworks. */
export const SUPPORTED_FRAMEWORKS: ComplianceFramework[] = [
  "soc2",
  "hipaa",
  "pci-dss",
  "iso-27001",
  "cis",
  "nist-800-53",
];

// =============================================================================
// Compliance Evaluation Engine
// =============================================================================

/**
 * Build the evaluation context for a node.
 */
async function buildControlContext(
  node: GraphNode,
  storage: GraphStorage,
): Promise<ControlEvaluationContext> {
  const edges = await storage.getEdgesForNode(node.id, "both");
  const edgeTypes = [...new Set(edges.map((e) => e.relationshipType))];
  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.sourceNodeId !== node.id) neighborIds.add(e.sourceNodeId);
    if (e.targetNodeId !== node.id) neighborIds.add(e.targetNodeId);
  }
  const neighbors: GraphNode[] = [];
  for (const nid of neighborIds) {
    const n = await storage.getNode(nid);
    if (n) neighbors.push(n);
  }

  return {
    node,
    tags: node.tags,
    metadata: node.metadata,
    neighbors,
    hasEdge: (relType: string) => (edgeTypes as string[]).includes(relType),
    edgeTypes,
  };
}

/**
 * Evaluate a single framework against all applicable resources.
 */
export async function evaluateFramework(
  framework: ComplianceFramework,
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<ComplianceSummary> {
  const controls = getFrameworkControls(framework);
  const nodes = await storage.queryNodes(filter ?? {});
  const results: ControlResult[] = [];

  for (const control of controls) {
    const applicable = nodes.filter((n) =>
      control.applicableResourceTypes.includes(n.resourceType),
    );
    if (applicable.length === 0) {
      // Control has no applicable resources in the graph
      results.push({
        controlId: control.id,
        framework: control.framework,
        section: control.section,
        title: control.title,
        severity: control.severity,
        status: "not-applicable",
        reason: "No applicable resources in the graph",
        nodeId: "",
        nodeName: "",
        resourceType: "custom",
        provider: "custom",
      });
      continue;
    }

    for (const node of applicable) {
      try {
        const ctx = await buildControlContext(node, storage);
        const status = control.evaluate(ctx);
        results.push({
          controlId: control.id,
          framework: control.framework,
          section: control.section,
          title: control.title,
          severity: control.severity,
          status,
          reason: control.reason(ctx, status),
          nodeId: node.id,
          nodeName: node.name,
          resourceType: node.resourceType,
          provider: node.provider,
        });
      } catch (err) {
        // Don't let one control evaluation failure abort the entire assessment
        results.push({
          controlId: control.id,
          framework: control.framework,
          section: control.section,
          title: control.title,
          severity: control.severity,
          status: "fail",
          reason: `Evaluation error: ${err instanceof Error ? err.message : String(err)}`,
          nodeId: node.id,
          nodeName: node.name,
          resourceType: node.resourceType,
          provider: node.provider,
        });
      }
    }
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warnings = results.filter((r) => r.status === "warning").length;
  const notApplicable = results.filter(
    (r) => r.status === "not-applicable",
  ).length;
  const applicableCount = results.length - notApplicable;
  const score = applicableCount > 0 ? (passed / applicableCount) * 100 : 100;

  const failureBySeverity: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fail") {
      failureBySeverity[r.severity] =
        (failureBySeverity[r.severity] ?? 0) + 1;
    }
  }

  return {
    framework,
    totalControls: results.length,
    passed,
    failed,
    warnings,
    notApplicable,
    score: Math.round(score * 10) / 10,
    failureBySeverity,
    results,
  };
}

/**
 * Run a full compliance assessment across multiple frameworks.
 */
export async function runComplianceAssessment(
  frameworks: ComplianceFramework[],
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<ComplianceReport> {
  const summaries: ComplianceSummary[] = [];
  for (const fw of frameworks) {
    summaries.push(await evaluateFramework(fw, storage, filter));
  }

  // Identify critical resources (nodes with critical/high failures)
  const resourceFailures = new Map<
    string,
    {
      nodeId: string;
      nodeName: string;
      resourceType: GraphResourceType;
      provider: CloudProvider;
      failures: number;
    }
  >();
  for (const summary of summaries) {
    for (const result of summary.results) {
      if (
        result.status === "fail" &&
        (result.severity === "critical" || result.severity === "high")
      ) {
        const existing = resourceFailures.get(result.nodeId);
        if (existing) {
          existing.failures++;
        } else {
          resourceFailures.set(result.nodeId, {
            nodeId: result.nodeId,
            nodeName: result.nodeName,
            resourceType: result.resourceType,
            provider: result.provider,
            failures: 1,
          });
        }
      }
    }
  }

  const nodes = await storage.queryNodes(filter ?? {});

  return {
    generatedAt: new Date().toISOString(),
    frameworks: summaries,
    totalResources: nodes.length,
    criticalResources: [...resourceFailures.values()].sort(
      (a, b) => b.failures - a.failures,
    ),
  };
}

/**
 * Format a compliance summary as a markdown table.
 */
export function formatComplianceMarkdown(report: ComplianceReport): string {
  const lines: string[] = [
    "# Compliance Assessment Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Total resources scanned: ${report.totalResources}`,
    "",
  ];

  for (const fw of report.frameworks) {
    lines.push(
      `## ${fw.framework.toUpperCase()} — Score: ${fw.score}%`,
      "",
      `| Metric | Count |`,
      `|--------|-------|`,
      `| Passed | ${fw.passed} |`,
      `| Failed | ${fw.failed} |`,
      `| Warnings | ${fw.warnings} |`,
      `| N/A | ${fw.notApplicable} |`,
      "",
    );

    const failures = fw.results.filter((r) => r.status === "fail");
    if (failures.length > 0) {
      lines.push(
        "### Failures",
        "",
        "| Control | Severity | Resource | Reason |",
        "|---------|----------|----------|--------|",
        ...failures.map(
          (f) =>
            `| ${f.controlId}: ${f.title} | ${f.severity} | ${f.nodeName} (${f.resourceType}) | ${f.reason} |`,
        ),
        "",
      );
    }
  }

  if (report.criticalResources.length > 0) {
    lines.push(
      "## Critical Resources",
      "",
      "| Resource | Type | Provider | Failures |",
      "|----------|------|----------|----------|",
      ...report.criticalResources.map(
        (r) =>
          `| ${r.nodeName} | ${r.resourceType} | ${r.provider} | ${r.failures} |`,
      ),
    );
  }

  return lines.join("\n");
}
