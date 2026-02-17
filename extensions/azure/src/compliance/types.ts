/**
 * Azure Compliance — Type Definitions
 */

export type ComplianceSeverity = "critical" | "high" | "medium" | "low" | "informational";

export type ComplianceFramework = {
  id: string;
  name: string;
  description: string;
  version: string;
  controls: number;
  category?: string;
};

export type ComplianceViolation = {
  id: string;
  resourceId: string;
  resourceType: string;
  resourceGroup: string;
  framework: string;
  control: string;
  severity: ComplianceSeverity;
  message: string;
  remediation?: string;
  timestamp: string;
};

export type ComplianceStatus = {
  framework: string;
  totalControls: number;
  compliantControls: number;
  nonCompliantControls: number;
  percentage: number;
  lastEvaluated: string;
};

export type ComplianceReport = {
  id: string;
  generatedAt: string;
  subscription: string;
  frameworks: ComplianceStatus[];
  violations: ComplianceViolation[];
  summary: { total: number; compliant: number; nonCompliant: number; percentage: number };
};
