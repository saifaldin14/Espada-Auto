/**
 * GCP Compliance Manager
 *
 * Aggregates compliance data and presents compliance reports for GCP projects.
 * Uses mock/built-in framework data — no external GCP SDK required.
 */

import type { GcpRetryOptions } from "../types.js";

// =============================================================================
// Types
// =============================================================================

export type GcpComplianceFramework = {
  id: string;
  name: string;
  version: string;
  controls: number;
  description: string;
};

export type GcpComplianceStatus = {
  framework: string;
  overallScore: number;
  passed: number;
  failed: number;
  notApplicable: number;
  lastAssessed: string;
};

export type GcpComplianceViolation = {
  controlId: string;
  controlName: string;
  severity: string;
  resource?: string;
  remediation: string;
};

export type GcpComplianceReport = {
  framework: string;
  generatedAt: string;
  status: GcpComplianceStatus;
  violations: GcpComplianceViolation[];
  recommendations: string[];
};

// =============================================================================
// Built-in frameworks (mock data)
// =============================================================================

const BUILTIN_FRAMEWORKS: GcpComplianceFramework[] = [
  { id: "cis-gcp-1.3", name: "CIS GCP Benchmark", version: "1.3", controls: 87, description: "CIS Google Cloud Platform Foundation Benchmark v1.3" },
  { id: "soc2-type2", name: "SOC 2 Type II", version: "2.0", controls: 64, description: "Service Organization Control 2 Type II" },
  { id: "iso-27001", name: "ISO 27001", version: "2022", controls: 114, description: "ISO/IEC 27001:2022 Information Security Management" },
  { id: "pci-dss-4.0", name: "PCI-DSS", version: "4.0", controls: 78, description: "Payment Card Industry Data Security Standard v4.0" },
  { id: "hipaa", name: "HIPAA", version: "1.0", controls: 45, description: "Health Insurance Portability and Accountability Act" },
  { id: "nist-800-53", name: "NIST 800-53", version: "5", controls: 200, description: "NIST Special Publication 800-53 Revision 5" },
];

/** Deterministic mock violations per framework for reproducible reports. */
const MOCK_VIOLATIONS: Record<string, GcpComplianceViolation[]> = {
  "cis-gcp-1.3": [
    { controlId: "CIS-2.1", controlName: "Ensure Cloud Audit Logging is configured", severity: "high", resource: "projects/*/auditConfigs", remediation: "Enable Data Access audit logs for all services in IAM & Admin → Audit Logs." },
    { controlId: "CIS-3.6", controlName: "Ensure SSH access is restricted from the internet", severity: "critical", resource: "compute.googleapis.com/Firewall", remediation: "Remove firewall rules that allow SSH (port 22) from 0.0.0.0/0." },
  ],
  "soc2-type2": [
    { controlId: "CC6.1", controlName: "Logical and Physical Access Controls", severity: "medium", remediation: "Review IAM policies and enforce least-privilege access across all projects." },
  ],
  "iso-27001": [
    { controlId: "A.9.2.3", controlName: "Management of privileged access rights", severity: "high", remediation: "Audit and rotate service account keys; prefer Workload Identity Federation." },
  ],
  "pci-dss-4.0": [
    { controlId: "PCI-1.3.1", controlName: "Restrict inbound traffic to the CDE", severity: "critical", resource: "compute.googleapis.com/Firewall", remediation: "Configure VPC firewall rules to restrict inbound traffic to cardholder data environments." },
  ],
  "hipaa": [
    { controlId: "HIPAA-164.312(a)", controlName: "Access Control", severity: "high", remediation: "Ensure all PHI-containing buckets have uniform bucket-level access and IAM conditions." },
  ],
  "nist-800-53": [
    { controlId: "AC-2", controlName: "Account Management", severity: "medium", remediation: "Implement automated account provisioning and review processes with Cloud Identity." },
    { controlId: "AU-6", controlName: "Audit Review, Analysis, and Reporting", severity: "medium", remediation: "Enable Cloud Audit Logs export to a SIEM via Pub/Sub or BigQuery sink." },
  ],
};

// =============================================================================
// Manager
// =============================================================================

export class GcpComplianceManager {
  private credentialsManager: unknown;
  private projectId: string;
  private retryOptions?: GcpRetryOptions;

  constructor(credentialsManager: unknown, projectId: string, retryOptions?: GcpRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.projectId = projectId;
    this.retryOptions = retryOptions;
  }

  listFrameworks(): GcpComplianceFramework[] {
    return [...BUILTIN_FRAMEWORKS];
  }

  async getComplianceStatus(
    framework: string,
    opts?: { project?: string },
  ): Promise<GcpComplianceStatus> {
    const fw = BUILTIN_FRAMEWORKS.find((f) => f.id === framework || f.name === framework);
    if (!fw) throw new Error(`Unknown compliance framework: ${framework}`);

    const violations = MOCK_VIOLATIONS[fw.id] ?? [];
    const failed = violations.length;
    const notApplicable = Math.floor(fw.controls * 0.05);
    const passed = fw.controls - failed - notApplicable;

    return {
      framework: fw.name,
      overallScore: Math.round((passed / fw.controls) * 100),
      passed,
      failed,
      notApplicable,
      lastAssessed: new Date().toISOString(),
    };
  }

  async listViolations(
    framework: string,
    opts?: { severity?: string },
  ): Promise<GcpComplianceViolation[]> {
    const fw = BUILTIN_FRAMEWORKS.find((f) => f.id === framework || f.name === framework);
    if (!fw) throw new Error(`Unknown compliance framework: ${framework}`);

    let violations = MOCK_VIOLATIONS[fw.id] ?? [];
    if (opts?.severity) {
      violations = violations.filter((v) => v.severity === opts.severity);
    }
    return violations;
  }

  async generateReport(
    framework: string,
    opts?: { format?: "summary" | "detailed" },
  ): Promise<GcpComplianceReport> {
    const [status, violations] = await Promise.all([
      this.getComplianceStatus(framework),
      this.listViolations(framework),
    ]);

    const recommendations: string[] = [];
    if (violations.some((v) => v.severity === "critical")) {
      recommendations.push("Address all critical violations immediately to reduce risk exposure.");
    }
    if (violations.some((v) => v.severity === "high")) {
      recommendations.push("Schedule remediation of high-severity findings within 30 days.");
    }
    if (status.overallScore < 80) {
      recommendations.push("Overall compliance score is below 80% — consider a dedicated remediation sprint.");
    }
    recommendations.push(
      "Enable Security Command Center Premium for continuous compliance monitoring.",
    );

    return {
      framework: status.framework,
      generatedAt: new Date().toISOString(),
      status,
      violations: opts?.format === "summary" ? [] : violations,
      recommendations,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createComplianceManager(
  credentialsManager: unknown,
  projectId: string,
  retryOptions?: GcpRetryOptions,
): GcpComplianceManager {
  return new GcpComplianceManager(credentialsManager, projectId, retryOptions);
}
