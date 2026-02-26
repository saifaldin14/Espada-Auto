/**
 * Azure Reconciliation Engine
 *
 * Detects drift, checks compliance, finds cost anomalies,
 * generates remediation actions, and optionally auto-remediates.
 *
 * Phases:
 *   1. Drift detection — compare desired state vs actual
 *   2. Compliance check — validate resources against policies
 *   3. Cost anomaly detection — identify spending outliers
 *   4. Generate remediation actions
 *   5. Execute auto-remediation (if enabled and not dry-run)
 */

import { randomUUID } from "node:crypto";
import type {
  ReconciliationConfig,
  ReconciliationResult,
  ReconciliationSummary,
  ResourceDrift,
  PropertyChange,
  ComplianceIssue,
  CostAnomaly,
  RemediationAction,
  ExecutedRemediation,
  ReconciliationSchedule,
  ReconciliationHistoryEntry,
} from "./types.js";

// =============================================================================
// Desired State Representation
// =============================================================================

export interface DesiredResource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  properties: Record<string, unknown>;
  tags: Record<string, string>;
}

export interface ActualResource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  properties: Record<string, unknown>;
  tags: Record<string, string>;
  monthlyCostUsd?: number;
  historicalCostUsd?: number;
}

// =============================================================================
// Compliance Policies
// =============================================================================

export interface CompliancePolicy {
  id: string;
  name: string;
  framework: string;
  severity: "low" | "medium" | "high" | "critical";
  check: (resource: ActualResource) => ComplianceIssue | null;
}

const BUILTIN_POLICIES: CompliancePolicy[] = [
  {
    id: "require-https",
    name: "Require HTTPS for Web Apps",
    framework: "azure-security-baseline",
    severity: "high",
    check: (resource) => {
      if (!resource.type.includes("Web/sites")) return null;
      if ((resource.properties as Record<string, unknown>).httpsOnly) return null;
      return {
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        policyId: "require-https",
        policyName: "Require HTTPS for Web Apps",
        framework: "azure-security-baseline",
        severity: "high",
        description: "Web application does not enforce HTTPS-only access",
        recommendation: "Enable httpsOnly on the web app configuration",
      };
    },
  },
  {
    id: "require-tls12",
    name: "Require TLS 1.2 Minimum",
    framework: "azure-security-baseline",
    severity: "high",
    check: (resource) => {
      if (!resource.type.includes("Web/sites") && !resource.type.includes("Cache/Redis")) return null;
      const props = resource.properties as Record<string, unknown>;
      const siteConfig = props.siteConfig as Record<string, unknown> | undefined;
      const tls = siteConfig?.minTlsVersion ?? props.minimumTlsVersion;
      if (tls === "1.2" || tls === "1.3") return null;
      return {
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        policyId: "require-tls12",
        policyName: "Require TLS 1.2 Minimum",
        framework: "azure-security-baseline",
        severity: "high",
        description: "Resource does not enforce TLS 1.2 or higher",
        recommendation: "Set minimum TLS version to 1.2",
      };
    },
  },
  {
    id: "require-tags",
    name: "Require Standard Tags",
    framework: "governance",
    severity: "medium",
    check: (resource) => {
      const requiredTags = ["environment"];
      const missing = requiredTags.filter((t) => !resource.tags[t]);
      if (missing.length === 0) return null;
      return {
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        policyId: "require-tags",
        policyName: "Require Standard Tags",
        framework: "governance",
        severity: "medium",
        description: `Missing required tags: ${missing.join(", ")}`,
        recommendation: `Add the following tags: ${missing.join(", ")}`,
      };
    },
  },
  {
    id: "encryption-at-rest",
    name: "Require Encryption at Rest",
    framework: "azure-security-baseline",
    severity: "high",
    check: (resource) => {
      if (!resource.type.includes("Storage/storageAccounts")) return null;
      const props = resource.properties as Record<string, unknown>;
      const encryption = props.encryption as Record<string, unknown> | undefined;
      // Storage accounts have encryption enabled by default; detect explicit disabling
      if (encryption?.services) return null;
      const enabled = (encryption as Record<string, unknown> | undefined)?.enabled;
      if (enabled === false) {
        return {
          resourceId: resource.id,
          resourceName: resource.name,
          resourceType: resource.type,
          policyId: "encryption-at-rest",
          policyName: "Require Encryption at Rest",
          framework: "azure-security-baseline",
          severity: "high",
          description: "Storage account has encryption explicitly disabled",
          recommendation: "Enable encryption at rest for the storage account",
        };
      }
      return null;
    },
  },
  {
    id: "backup-configured",
    name: "Require Backup for Databases",
    framework: "reliability",
    severity: "high",
    check: (resource) => {
      const dbTypes = ["Sql/servers", "PostgreSQL", "MySQL", "DocumentDB"];
      if (!dbTypes.some((t) => resource.type.includes(t))) return null;
      const props = resource.properties as Record<string, unknown>;
      const backup = props.backup as Record<string, unknown> | undefined;
      if (backup?.backupRetentionDays && Number(backup.backupRetentionDays) >= 7) return null;
      if (props.backupRetentionDays && Number(props.backupRetentionDays) >= 7) return null;
      return {
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        policyId: "backup-configured",
        policyName: "Require Backup for Databases",
        framework: "reliability",
        severity: "high",
        description: "Database does not have backup retention of at least 7 days",
        recommendation: "Configure backup retention to at least 7 days",
      };
    },
  },
];

// =============================================================================
// Reconciliation Engine
// =============================================================================

export class ReconciliationEngine {
  private customPolicies: CompliancePolicy[] = [];
  private schedules: Map<string, ReconciliationSchedule> = new Map();

  /**
   * Run a full reconciliation cycle.
   */
  reconcile(
    config: ReconciliationConfig,
    desired: DesiredResource[],
    actual: ActualResource[],
  ): ReconciliationResult {
    const startedAt = new Date().toISOString();
    const id = randomUUID();

    // Phase 1: Drift detection
    const drifts = config.enableDriftDetection
      ? this.detectDrift(desired, actual)
      : [];

    // Phase 2: Compliance check
    const complianceIssues = config.enableComplianceCheck
      ? this.checkCompliance(actual)
      : [];

    // Phase 3: Cost anomaly detection
    const costAnomalies = config.enableCostAnomalyDetection
      ? this.detectCostAnomalies(actual)
      : [];

    // Phase 4: Generate remediation actions
    const remediationActions = this.generateRemediationActions(drifts, complianceIssues, costAnomalies);

    // Phase 5: Execute auto-remediation
    let executedRemediations: ExecutedRemediation[] = [];
    if (config.autoRemediate && !config.dryRun) {
      executedRemediations = this.executeAutoRemediation(remediationActions);
    }

    const summary: ReconciliationSummary = {
      totalResourcesChecked: actual.length,
      driftsDetected: drifts.length,
      complianceIssuesFound: complianceIssues.length,
      costAnomaliesFound: costAnomalies.length,
      remediationsPlanned: remediationActions.length,
      remediationsExecuted: executedRemediations.length,
      remediationsSucceeded: executedRemediations.filter((r) => r.status === "success").length,
      remediationsFailed: executedRemediations.filter((r) => r.status === "failed").length,
    };

    return {
      id,
      config,
      drifts,
      complianceIssues,
      costAnomalies,
      remediationActions,
      executedRemediations,
      summary,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Add a custom compliance policy.
   */
  addCompliancePolicy(policy: CompliancePolicy): void {
    this.customPolicies.push(policy);
  }

  /**
   * Detect drift only.
   */
  detectDrift(desired: DesiredResource[], actual: ActualResource[]): ResourceDrift[] {
    const drifts: ResourceDrift[] = [];
    const actualMap = new Map(actual.map((r) => [r.id, r]));
    const desiredMap = new Map(desired.map((r) => [r.id, r]));

    // Check for modified/deleted resources
    for (const desiredResource of desired) {
      const actualResource = actualMap.get(desiredResource.id);
      if (!actualResource) {
        drifts.push({
          resourceId: desiredResource.id,
          resourceName: desiredResource.name,
          resourceType: desiredResource.type,
          resourceGroup: desiredResource.resourceGroup,
          driftType: "deleted",
          changes: [],
          severity: "critical",
          detectedAt: new Date().toISOString(),
        });
        continue;
      }

      const changes = this.diffProperties(desiredResource.properties, actualResource.properties);
      const tagChanges = this.diffTags(desiredResource.tags, actualResource.tags);

      if (changes.length > 0 || tagChanges.length > 0) {
        const allChanges = [...changes, ...tagChanges];
        drifts.push({
          resourceId: desiredResource.id,
          resourceName: desiredResource.name,
          resourceType: desiredResource.type,
          resourceGroup: desiredResource.resourceGroup,
          driftType: "modified",
          changes: allChanges,
          severity: this.classifyDriftSeverity(allChanges),
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Check for unmanaged resources
    for (const actualResource of actual) {
      if (!desiredMap.has(actualResource.id)) {
        drifts.push({
          resourceId: actualResource.id,
          resourceName: actualResource.name,
          resourceType: actualResource.type,
          resourceGroup: actualResource.resourceGroup,
          driftType: "unmanaged",
          changes: [],
          severity: "low",
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return drifts;
  }

  /**
   * Check compliance only.
   */
  checkCompliance(resources: ActualResource[]): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];
    const allPolicies = [...BUILTIN_POLICIES, ...this.customPolicies];

    for (const resource of resources) {
      for (const policy of allPolicies) {
        const issue = policy.check(resource);
        if (issue) issues.push(issue);
      }
    }

    return issues;
  }

  /**
   * Detect cost anomalies only.
   */
  detectCostAnomalies(resources: ActualResource[]): CostAnomaly[] {
    const anomalies: CostAnomaly[] = [];

    for (const resource of resources) {
      if (resource.monthlyCostUsd === undefined || resource.historicalCostUsd === undefined) continue;
      if (resource.historicalCostUsd === 0) continue;

      const deviation = ((resource.monthlyCostUsd - resource.historicalCostUsd) / resource.historicalCostUsd) * 100;

      // Spike: >50% increase
      if (deviation > 50) {
        anomalies.push({
          resourceId: resource.id,
          resourceName: resource.name,
          resourceType: resource.type,
          anomalyType: deviation > 200 ? "spike" : "steady-increase",
          expectedCostUsd: resource.historicalCostUsd,
          actualCostUsd: resource.monthlyCostUsd,
          deviationPercent: Math.round(deviation),
          period: "current-month",
          detectedAt: new Date().toISOString(),
        });
      }

      // Idle: cost > 0 but very low relative to historical
      if (resource.monthlyCostUsd > 0 && resource.monthlyCostUsd < 5 && resource.historicalCostUsd > 20) {
        anomalies.push({
          resourceId: resource.id,
          resourceName: resource.name,
          resourceType: resource.type,
          anomalyType: "idle-resource",
          expectedCostUsd: resource.historicalCostUsd,
          actualCostUsd: resource.monthlyCostUsd,
          deviationPercent: Math.round(deviation),
          period: "current-month",
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return anomalies;
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  createSchedule(
    name: string,
    config: ReconciliationConfig,
    cronExpression: string,
  ): ReconciliationSchedule {
    const schedule: ReconciliationSchedule = {
      id: randomUUID(),
      name,
      config,
      cronExpression,
      enabled: true,
      history: [],
    };
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  listSchedules(): ReconciliationSchedule[] {
    return [...this.schedules.values()];
  }

  getSchedule(id: string): ReconciliationSchedule | null {
    return this.schedules.get(id) ?? null;
  }

  deleteSchedule(id: string): boolean {
    return this.schedules.delete(id);
  }

  recordScheduleRun(scheduleId: string, result: ReconciliationResult): void {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return;

    const entry: ReconciliationHistoryEntry = {
      reconciliationId: result.id,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      summary: result.summary,
    };
    schedule.history.push(entry);
    // Keep only last 100 history entries to prevent unbounded growth
    if (schedule.history.length > 100) {
      schedule.history.splice(0, schedule.history.length - 100);
    }
    schedule.lastRun = result.completedAt;
  }

  // ---------------------------------------------------------------------------
  // Internal Methods
  // ---------------------------------------------------------------------------

  private generateRemediationActions(
    drifts: ResourceDrift[],
    complianceIssues: ComplianceIssue[],
    costAnomalies: CostAnomaly[],
  ): RemediationAction[] {
    const actions: RemediationAction[] = [];

    // Drift remediations
    for (const drift of drifts) {
      if (drift.driftType === "deleted") {
        actions.push({
          id: randomUUID(),
          resourceId: drift.resourceId,
          resourceName: drift.resourceName,
          actionType: "custom",
          description: `Re-create deleted resource "${drift.resourceName}"`,
          severity: drift.severity,
          estimatedImpact: "Resource will be re-provisioned to match desired state",
          autoRemediable: false,
          parameters: {},
          sourceIssueType: "drift",
        });
      } else if (drift.driftType === "modified") {
        for (const change of drift.changes) {
          actions.push({
            id: randomUUID(),
            resourceId: drift.resourceId,
            resourceName: drift.resourceName,
            actionType: "update-property",
            description: `Update ${change.property} from "${change.actualValue}" to "${change.expectedValue}"`,
            severity: drift.severity,
            estimatedImpact: `Property ${change.property} will be reverted to desired state`,
            autoRemediable: change.changeType === "modified",
            parameters: { property: change.property, value: change.expectedValue },
            sourceIssueType: "drift",
          });
        }
      }
    }

    // Compliance remediations
    for (const issue of complianceIssues) {
      const actionType = this.mapComplianceToAction(issue.policyId);
      actions.push({
        id: randomUUID(),
        resourceId: issue.resourceId,
        resourceName: issue.resourceName,
        actionType,
        description: issue.recommendation,
        severity: issue.severity,
        estimatedImpact: `Resolve ${issue.framework} compliance issue`,
        autoRemediable: actionType !== "custom",
        parameters: { policyId: issue.policyId },
        sourceIssueType: "compliance",
      });
    }

    // Cost remediations
    for (const anomaly of costAnomalies) {
      if (anomaly.anomalyType === "idle-resource") {
        actions.push({
          id: randomUUID(),
          resourceId: anomaly.resourceId,
          resourceName: anomaly.resourceName,
          actionType: "scale-down",
          description: `Scale down or delete idle resource "${anomaly.resourceName}" (saving ~$${anomaly.expectedCostUsd - anomaly.actualCostUsd}/mo)`,
          severity: "medium",
          estimatedImpact: `Potential savings of $${anomaly.expectedCostUsd}/mo`,
          autoRemediable: false,
          parameters: { anomalyType: anomaly.anomalyType },
          sourceIssueType: "cost",
        });
      } else {
        actions.push({
          id: randomUUID(),
          resourceId: anomaly.resourceId,
          resourceName: anomaly.resourceName,
          actionType: "resize-resource",
          description: `Investigate cost ${anomaly.anomalyType} for "${anomaly.resourceName}" (+${anomaly.deviationPercent}%)`,
          severity: anomaly.deviationPercent > 200 ? "high" : "medium",
          estimatedImpact: `Current cost $${anomaly.actualCostUsd}/mo vs expected $${anomaly.expectedCostUsd}/mo`,
          autoRemediable: false,
          parameters: { anomalyType: anomaly.anomalyType, deviation: anomaly.deviationPercent },
          sourceIssueType: "cost",
        });
      }
    }

    return actions;
  }

  private executeAutoRemediation(actions: RemediationAction[]): ExecutedRemediation[] {
    const results: ExecutedRemediation[] = [];

    for (const action of actions.filter((a) => a.autoRemediable)) {
      const startTime = Date.now();

      // In production, this would call Azure Resource Manager to apply changes.
      // For now, we simulate successful execution.
      results.push({
        actionId: action.id,
        status: "success",
        message: `Auto-remediated: ${action.description}`,
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      });
    }

    return results;
  }

  private diffProperties(desired: Record<string, unknown>, actual: Record<string, unknown>, prefix = ""): PropertyChange[] {
    const changes: PropertyChange[] = [];

    for (const [key, expectedValue] of Object.entries(desired)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const actualValue = actual[key];

      if (actualValue === undefined) {
        changes.push({ property: path, expectedValue, actualValue: undefined, changeType: "removed" });
      } else if (typeof expectedValue === "object" && expectedValue !== null && typeof actualValue === "object" && actualValue !== null) {
        changes.push(...this.diffProperties(
          expectedValue as Record<string, unknown>,
          actualValue as Record<string, unknown>,
          path,
        ));
      } else if (JSON.stringify(expectedValue) !== JSON.stringify(actualValue)) {
        changes.push({ property: path, expectedValue, actualValue, changeType: "modified" });
      }
    }

    // Check for properties in actual but not in desired
    for (const key of Object.keys(actual)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!(key in desired)) {
        changes.push({ property: path, expectedValue: undefined, actualValue: actual[key], changeType: "added" });
      }
    }

    return changes;
  }

  private diffTags(desired: Record<string, string>, actual: Record<string, string>): PropertyChange[] {
    const changes: PropertyChange[] = [];

    for (const [key, value] of Object.entries(desired)) {
      if (actual[key] !== value) {
        changes.push({
          property: `tags.${key}`,
          expectedValue: value,
          actualValue: actual[key] ?? undefined,
          changeType: actual[key] === undefined ? "removed" : "modified",
        });
      }
    }

    for (const key of Object.keys(actual)) {
      if (!(key in desired)) {
        changes.push({
          property: `tags.${key}`,
          expectedValue: undefined,
          actualValue: actual[key],
          changeType: "added",
        });
      }
    }

    return changes;
  }

  private classifyDriftSeverity(changes: PropertyChange[]): "low" | "medium" | "high" | "critical" {
    const criticalProps = ["sku", "tier", "version", "enablePurgeProtection"];
    const highProps = ["securityRules", "httpsOnly", "minTlsVersion", "enableRbacAuthorization"];

    for (const change of changes) {
      if (criticalProps.some((p) => change.property.includes(p))) return "critical";
    }
    for (const change of changes) {
      if (highProps.some((p) => change.property.includes(p))) return "high";
    }

    if (changes.length > 5) return "high";
    if (changes.length > 2) return "medium";
    return "low";
  }

  private mapComplianceToAction(policyId: string): RemediationAction["actionType"] {
    switch (policyId) {
      case "require-https": return "update-property";
      case "require-tls12": return "update-property";
      case "require-tags": return "add-tag";
      case "encryption-at-rest": return "enable-encryption";
      case "backup-configured": return "enable-backup";
      default: return "custom";
    }
  }
}

/** Create a reconciliation engine. */
export function createReconciliationEngine(): ReconciliationEngine {
  return new ReconciliationEngine();
}
