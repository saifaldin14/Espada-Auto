/**
 * Compliance Mapping — Type Definitions
 *
 * 6 frameworks: SOC2, CIS Benchmarks, HIPAA, PCI-DSS, GDPR, NIST 800-53
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------
export type FrameworkId = "soc2" | "cis" | "hipaa" | "pci-dss" | "gdpr" | "nist-800-53";

export type ControlSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ViolationStatus = "open" | "remediated" | "waived" | "accepted";

export type ResourceType =
  | "compute"
  | "storage"
  | "database"
  | "network"
  | "function"
  | "serverless-function"
  | "cache"
  | "queue"
  | "cluster"
  | "container"
  | "cdn"
  | "dns"
  | "load-balancer"
  | "firewall"
  | "gateway"
  | "secret"
  | "identity"
  | "logging"
  | "monitoring"
  | "vpc"
  | "subnet"
  | "security-group";

// ---------------------------------------------------------------------------
// Framework & Controls
// ---------------------------------------------------------------------------
export interface ComplianceFramework {
  id: FrameworkId;
  name: string;
  version: string;
  description: string;
  controls: ComplianceControl[];
  categories: string[];
}

export interface ControlEvalNode {
  id: string;
  name: string;
  provider: string;
  resourceType: string;
  region: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  account?: string;
  status?: string;
}

export interface ComplianceControl {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: ControlSeverity;
  applicableResourceTypes: ResourceType[];
  evaluate: (node: ControlEvalNode) => boolean;
  remediation: string;
  references: string[];
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------
export interface ComplianceViolation {
  controlId: string;
  controlTitle: string;
  framework: FrameworkId;
  resourceNodeId: string;
  resourceName: string;
  resourceType: string;
  severity: ControlSeverity;
  description: string;
  remediation: string;
  status: ViolationStatus;
  detectedAt: string;
  waiverInfo?: ComplianceWaiver;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export interface CategoryScore {
  passed: number;
  failed: number;
  total: number;
}

export interface ComplianceReport {
  framework: FrameworkId;
  frameworkVersion: string;
  generatedAt: string;
  scope: string;
  score: number;
  totalControls: number;
  passedControls: number;
  failedControls: number;
  waivedControls: number;
  notApplicable: number;
  violations: ComplianceViolation[];
  byCategory: Record<string, CategoryScore>;
  bySeverity: Record<ControlSeverity, number>;
  trend?: ComplianceTrend[];
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------
export interface ComplianceWaiver {
  id: string;
  controlId: string;
  resourceId: string;
  reason: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------
export interface ComplianceTrend {
  date: string;
  score: number;
  violations: number;
}
