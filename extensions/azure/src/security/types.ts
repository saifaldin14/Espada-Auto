/**
 * Azure Security (Microsoft Defender for Cloud) — Type Definitions
 */

export type SecuritySeverity = "High" | "Medium" | "Low" | "Informational";

export type SecureScore = {
  id: string;
  displayName: string;
  currentScore: number;
  maxScore: number;
  percentage: number;
  weight: number;
};

export type SecurityAssessment = {
  id: string;
  name: string;
  displayName: string;
  status: string;
  severity: SecuritySeverity;
  resourceId?: string;
  description?: string;
  remediation?: string;
  categories?: string[];
};

export type SecurityAlert = {
  id: string;
  name: string;
  alertDisplayName: string;
  alertType: string;
  severity: SecuritySeverity;
  status: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  description?: string;
  resourceIdentifiers?: Array<{ type: string; azureResourceId?: string }>;
  compromisedEntity?: string;
};

export type SecurityRecommendation = {
  id: string;
  name: string;
  displayName: string;
  severity: SecuritySeverity;
  status: string;
  description?: string;
  remediationDescription?: string;
  categories?: string[];
  threats?: string[];
};

export type ComplianceResult = {
  id: string;
  resourceType: string;
  resourceStatus: string;
  complianceStandard: string;
  complianceControl: string;
};
