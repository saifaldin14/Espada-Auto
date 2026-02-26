/**
 * Azure Reconciliation Types
 *
 * Drift detection, compliance checking, cost anomaly detection,
 * and automated remediation types.
 */

// =============================================================================
// Reconciliation configuration and results
// =============================================================================

export interface ReconciliationConfig {
  subscriptionId: string;
  resourceGroups?: string[];
  enableDriftDetection: boolean;
  enableComplianceCheck: boolean;
  enableCostAnomalyDetection: boolean;
  autoRemediate: boolean;
  dryRun: boolean;
}

export interface ReconciliationResult {
  id: string;
  config: ReconciliationConfig;
  drifts: ResourceDrift[];
  complianceIssues: ComplianceIssue[];
  costAnomalies: CostAnomaly[];
  remediationActions: RemediationAction[];
  executedRemediations: ExecutedRemediation[];
  summary: ReconciliationSummary;
  startedAt: string;
  completedAt: string;
}

export interface ReconciliationSummary {
  totalResourcesChecked: number;
  driftsDetected: number;
  complianceIssuesFound: number;
  costAnomaliesFound: number;
  remediationsPlanned: number;
  remediationsExecuted: number;
  remediationsSucceeded: number;
  remediationsFailed: number;
}

// =============================================================================
// Drift Detection
// =============================================================================

export interface ResourceDrift {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  driftType: "modified" | "deleted" | "unmanaged";
  changes: PropertyChange[];
  severity: "low" | "medium" | "high" | "critical";
  detectedAt: string;
}

export interface PropertyChange {
  property: string;
  expectedValue: unknown;
  actualValue: unknown;
  changeType: "modified" | "added" | "removed";
}

// =============================================================================
// Compliance
// =============================================================================

export interface ComplianceIssue {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  policyId: string;
  policyName: string;
  framework: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  recommendation: string;
}

// =============================================================================
// Cost Anomalies
// =============================================================================

export interface CostAnomaly {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  anomalyType: "spike" | "steady-increase" | "unexpected-charge" | "idle-resource";
  expectedCostUsd: number;
  actualCostUsd: number;
  deviationPercent: number;
  period: string;
  detectedAt: string;
}

// =============================================================================
// Remediation
// =============================================================================

export type RemediationActionType =
  | "update-property"
  | "apply-policy"
  | "resize-resource"
  | "delete-resource"
  | "add-tag"
  | "enable-encryption"
  | "enable-backup"
  | "restrict-access"
  | "scale-down"
  | "custom";

export interface RemediationAction {
  id: string;
  resourceId: string;
  resourceName: string;
  actionType: RemediationActionType;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  estimatedImpact: string;
  autoRemediable: boolean;
  parameters: Record<string, unknown>;
  sourceIssueType: "drift" | "compliance" | "cost";
  sourceIssueId?: string;
}

export interface ExecutedRemediation {
  actionId: string;
  status: "success" | "failed" | "skipped";
  message: string;
  executedAt: string;
  duration: number;
}

// =============================================================================
// Scheduled Reconciliation
// =============================================================================

export interface ReconciliationSchedule {
  id: string;
  name: string;
  config: ReconciliationConfig;
  cronExpression: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  history: ReconciliationHistoryEntry[];
}

export interface ReconciliationHistoryEntry {
  reconciliationId: string;
  startedAt: string;
  completedAt: string;
  summary: ReconciliationSummary;
}
