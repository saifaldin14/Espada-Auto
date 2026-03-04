/**
 * GCP Reconciliation Manager
 *
 * Detects configuration drift by comparing actual GCP resource state
 * against desired/expected state definitions. Provides diff reports
 * and optional remediation suggestions.
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type DriftSeverity = "critical" | "high" | "medium" | "low" | "info";

export type DriftStatus = "in-sync" | "drifted" | "missing" | "extra" | "unknown";

export type PropertyDiff = {
  path: string;
  expected: unknown;
  actual: unknown;
  severity: DriftSeverity;
  message: string;
};

export type ResourceDriftReport = {
  resourceName: string;
  resourceType: string;
  status: DriftStatus;
  diffs: PropertyDiff[];
  lastChecked: string;
  lastSynced?: string;
};

export type DesiredState = {
  resourceName: string;
  resourceType: string;
  properties: Record<string, unknown>;
  labels?: Record<string, string>;
  metadata?: Record<string, string>;
};

export type ReconciliationReport = {
  projectId: string;
  timestamp: string;
  totalResources: number;
  inSync: number;
  drifted: number;
  missing: number;
  extra: number;
  resources: ResourceDriftReport[];
};

export type ReconciliationPolicy = {
  name: string;
  autoRemediate: boolean;
  severityThreshold: DriftSeverity;
  ignorePaths: string[];
  schedule?: string;
};

export type RemediationAction = {
  resourceName: string;
  resourceType: string;
  action: "update" | "create" | "delete" | "manual";
  description: string;
  risk: DriftSeverity;
  payload?: Record<string, unknown>;
};

// =============================================================================
// Helpers
// =============================================================================

const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function deepDiff(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  prefix: string,
  ignorePaths: Set<string>,
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];

  for (const [key, expVal] of Object.entries(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (ignorePaths.has(path)) continue;

    const actVal = actual[key];

    if (actVal === undefined) {
      diffs.push({
        path,
        expected: expVal,
        actual: undefined,
        severity: "high",
        message: `Property "${path}" is missing from actual state`,
      });
      continue;
    }

    if (
      typeof expVal === "object" &&
      expVal !== null &&
      !Array.isArray(expVal) &&
      typeof actVal === "object" &&
      actVal !== null &&
      !Array.isArray(actVal)
    ) {
      diffs.push(
        ...deepDiff(
          expVal as Record<string, unknown>,
          actVal as Record<string, unknown>,
          path,
          ignorePaths,
        ),
      );
      continue;
    }

    if (JSON.stringify(expVal) !== JSON.stringify(actVal)) {
      diffs.push({
        path,
        expected: expVal,
        actual: actVal,
        severity: classifySeverity(path),
        message: `Property "${path}" differs: expected ${JSON.stringify(expVal)}, got ${JSON.stringify(actVal)}`,
      });
    }
  }

  return diffs;
}

function classifySeverity(path: string): DriftSeverity {
  const critical = ["encryption", "iamPolicy", "firewallRules", "auth", "tls", "ssl"];
  const high = ["machineType", "diskSize", "nodeCount", "replicas", "scaling"];
  const medium = ["labels", "tags", "description", "metadata"];

  const lower = path.toLowerCase();
  if (critical.some((k) => lower.includes(k))) return "critical";
  if (high.some((k) => lower.includes(k))) return "high";
  if (medium.some((k) => lower.includes(k))) return "low";
  return "medium";
}

// =============================================================================
// Manager
// =============================================================================

export class GcpReconciliationManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;
  private desiredStates: Map<string, DesiredState> = new Map();
  private policies: Map<string, ReconciliationPolicy> = new Map();
  private history: ReconciliationReport[] = [];

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "reconciliation",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Desired state management
  // ---------------------------------------------------------------------------

  registerDesiredState(states: DesiredState[]): void {
    for (const s of states) {
      this.desiredStates.set(s.resourceName, s);
    }
  }

  removeDesiredState(resourceName: string): boolean {
    return this.desiredStates.delete(resourceName);
  }

  listDesiredStates(): DesiredState[] {
    return Array.from(this.desiredStates.values());
  }

  // ---------------------------------------------------------------------------
  // Policy management
  // ---------------------------------------------------------------------------

  setPolicy(policy: ReconciliationPolicy): void {
    this.policies.set(policy.name, policy);
  }

  getPolicy(name: string): ReconciliationPolicy | undefined {
    return this.policies.get(name);
  }

  // ---------------------------------------------------------------------------
  // Drift detection
  // ---------------------------------------------------------------------------

  async checkDrift(resourceName?: string): Promise<ReconciliationReport> {
    const targets = resourceName
      ? [this.desiredStates.get(resourceName)].filter(Boolean) as DesiredState[]
      : Array.from(this.desiredStates.values());

    const resources: ResourceDriftReport[] = [];
    const policy = this.policies.values().next().value as ReconciliationPolicy | undefined;
    const ignorePaths = new Set(policy?.ignorePaths ?? []);

    for (const desired of targets) {
      try {
        const actual = await this.fetchActualState(desired);
        if (!actual) {
          resources.push({
            resourceName: desired.resourceName,
            resourceType: desired.resourceType,
            status: "missing",
            diffs: [{
              path: "",
              expected: desired.properties,
              actual: undefined,
              severity: "critical",
              message: `Resource "${desired.resourceName}" not found in GCP`,
            }],
            lastChecked: new Date().toISOString(),
          });
          continue;
        }

        const diffs = deepDiff(desired.properties, actual, "", ignorePaths);

        if (desired.labels && Object.keys(desired.labels).length > 0) {
          const actualLabels = (actual.labels ?? {}) as Record<string, string>;
          for (const [k, v] of Object.entries(desired.labels)) {
            if (actualLabels[k] !== v) {
              diffs.push({
                path: `labels.${k}`,
                expected: v,
                actual: actualLabels[k],
                severity: "low",
                message: `Label "${k}" differs`,
              });
            }
          }
        }

        resources.push({
          resourceName: desired.resourceName,
          resourceType: desired.resourceType,
          status: diffs.length === 0 ? "in-sync" : "drifted",
          diffs,
          lastChecked: new Date().toISOString(),
          lastSynced: diffs.length === 0 ? new Date().toISOString() : undefined,
        });
      } catch (err) {
        resources.push({
          resourceName: desired.resourceName,
          resourceType: desired.resourceType,
          status: "unknown",
          diffs: [{
            path: "",
            expected: desired.properties,
            actual: undefined,
            severity: "medium",
            message: `Failed to check resource: ${err instanceof Error ? err.message : String(err)}`,
          }],
          lastChecked: new Date().toISOString(),
        });
      }
    }

    const report: ReconciliationReport = {
      projectId: this.projectId,
      timestamp: new Date().toISOString(),
      totalResources: resources.length,
      inSync: resources.filter((r) => r.status === "in-sync").length,
      drifted: resources.filter((r) => r.status === "drifted").length,
      missing: resources.filter((r) => r.status === "missing").length,
      extra: 0,
      resources,
    };

    this.history.push(report);
    if (this.history.length > 100) this.history = this.history.slice(-100);

    return report;
  }

  // ---------------------------------------------------------------------------
  // Remediation
  // ---------------------------------------------------------------------------

  suggestRemediation(report: ReconciliationReport): RemediationAction[] {
    const actions: RemediationAction[] = [];
    const policy = this.policies.values().next().value as ReconciliationPolicy | undefined;
    const threshold = SEVERITY_ORDER[policy?.severityThreshold ?? "medium"];

    for (const resource of report.resources) {
      if (resource.status === "in-sync") continue;

      const significantDiffs = resource.diffs.filter(
        (d) => SEVERITY_ORDER[d.severity] <= threshold,
      );
      if (significantDiffs.length === 0) continue;

      if (resource.status === "missing") {
        const desired = this.desiredStates.get(resource.resourceName);
        actions.push({
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          action: "create",
          description: `Create missing resource "${resource.resourceName}"`,
          risk: "high",
          payload: desired?.properties,
        });
      } else if (resource.status === "drifted") {
        const hasCritical = significantDiffs.some((d) => d.severity === "critical");
        actions.push({
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          action: hasCritical ? "manual" : "update",
          description: hasCritical
            ? `Manual review required for "${resource.resourceName}" — ${significantDiffs.length} critical/high drift(s)`
            : `Update ${significantDiffs.length} drifted property(ies) on "${resource.resourceName}"`,
          risk: hasCritical ? "critical" : "medium",
          payload: Object.fromEntries(significantDiffs.map((d) => [d.path, d.expected])),
        });
      } else if (resource.status === "extra") {
        actions.push({
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          action: "delete",
          description: `Remove extra resource "${resource.resourceName}" not in desired state`,
          risk: "high",
        });
      }
    }

    return actions.sort((a, b) => SEVERITY_ORDER[a.risk] - SEVERITY_ORDER[b.risk]);
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  getHistory(limit?: number): ReconciliationReport[] {
    const n = limit ?? 10;
    return this.history.slice(-n);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchActualState(desired: DesiredState): Promise<Record<string, unknown> | null> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const apiUrl = this.resolveApiUrl(desired.resourceType, desired.resourceName);
      if (!apiUrl) return null;

      try {
        return await gcpRequest<Record<string, unknown>>(apiUrl, token);
      } catch {
        return null;
      }
    }, this.retryOptions);
  }

  private resolveApiUrl(resourceType: string, resourceName: string): string | null {
    const typeMap: Record<string, string> = {
      "compute.googleapis.com/Instance": `https://compute.googleapis.com/compute/v1/${resourceName}`,
      "compute.googleapis.com/Disk": `https://compute.googleapis.com/compute/v1/${resourceName}`,
      "compute.googleapis.com/Network": `https://compute.googleapis.com/compute/v1/${resourceName}`,
      "storage.googleapis.com/Bucket": `https://storage.googleapis.com/storage/v1/b/${resourceName.split("/").pop()}`,
      "sqladmin.googleapis.com/Instance": `https://sqladmin.googleapis.com/v1beta4/${resourceName}`,
      "container.googleapis.com/Cluster": `https://container.googleapis.com/v1/${resourceName}`,
      "run.googleapis.com/Service": `https://run.googleapis.com/v2/${resourceName}`,
      "cloudfunctions.googleapis.com/Function": `https://cloudfunctions.googleapis.com/v2/${resourceName}`,
    };

    return typeMap[resourceType] ?? null;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createReconciliationManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpReconciliationManager {
  return new GcpReconciliationManager(projectId, getAccessToken, retryOptions);
}
