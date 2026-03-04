/**
 * GCP Backup & DR Manager
 *
 * Manages backup plans, backup vaults, and recovery operations using the
 * GCP Backup and DR REST API (backupdr.googleapis.com).
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type BackupPlanState = "STATE_UNSPECIFIED" | "CREATING" | "ACTIVE" | "DELETING" | "INACTIVE";

export type BackupRuleSchedule = {
  /** Cron expression for backup frequency */
  cronExpression: string;
  /** Timezone for the schedule (e.g. "America/New_York") */
  timezone?: string;
};

export type BackupRetention = {
  /** Minimum enforced retention in days */
  minRetentionDays: number;
  /** Maximum retention in days before auto-deletion */
  maxRetentionDays?: number;
};

export type BackupRule = {
  ruleId: string;
  schedule: BackupRuleSchedule;
  retention: BackupRetention;
  /** Target backup vault for this rule */
  backupVaultId?: string;
};

export type BackupPlan = {
  name: string;
  description: string;
  state: BackupPlanState;
  resourceType: string;
  rules: BackupRule[];
  labels: Record<string, string>;
  createTime: string;
  updateTime: string;
  backupVault: string;
};

export type CreateBackupPlanOptions = {
  location: string;
  backupPlanId: string;
  description?: string;
  resourceType: string;
  rules: BackupRule[];
  backupVault: string;
  labels?: Record<string, string>;
};

export type BackupVaultState = "STATE_UNSPECIFIED" | "CREATING" | "ACTIVE" | "DELETING";

export type BackupVault = {
  name: string;
  description: string;
  state: BackupVaultState;
  createTime: string;
  updateTime: string;
  labels: Record<string, string>;
  backupMinimumEnforcedRetentionDuration: string;
  deletable: boolean;
  backupCount: number;
  totalSizeBytes: string;
};

export type CreateBackupVaultOptions = {
  location: string;
  backupVaultId: string;
  description?: string;
  minimumRetentionDays?: number;
  labels?: Record<string, string>;
};

export type BackupState = "STATE_UNSPECIFIED" | "CREATING" | "ACTIVE" | "DELETING" | "ERROR";

export type Backup = {
  name: string;
  description: string;
  state: BackupState;
  createTime: string;
  updateTime: string;
  expireTime: string;
  consistencyTime: string;
  resourceSizeBytes: string;
  backupType: string;
  resourceType: string;
  labels: Record<string, string>;
};

export type RestoreOptions = {
  location: string;
  backupVault: string;
  backupId: string;
  targetResourceName?: string;
  targetProject?: string;
};

export type BackupJobState = "STATE_UNSPECIFIED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type BackupJob = {
  name: string;
  state: BackupJobState;
  backupPlan: string;
  resource: string;
  createTime: string;
  updateTime: string;
  completeTime?: string;
  errorMessage?: string;
};

export type BackupComplianceStatus = {
  resourceId: string;
  resourceType: string;
  lastBackupTime?: string;
  nextScheduledTime?: string;
  compliant: boolean;
  issues: string[];
};

// =============================================================================
// Manager
// =============================================================================

const BASE = "https://backupdr.googleapis.com/v1";

export class GcpBackupManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "backup",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Backup Plans
  // ---------------------------------------------------------------------------

  async listBackupPlans(location: string): Promise<BackupPlan[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${location}/backupPlans`;
      const items = await gcpList<Record<string, unknown>>(url, token, "backupPlans");
      return items.map((p) => this.mapBackupPlan(p));
    }, this.retryOptions);
  }

  async getBackupPlan(location: string, planId: string): Promise<BackupPlan> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${location}/backupPlans/${planId}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapBackupPlan(raw);
    }, this.retryOptions);
  }

  async createBackupPlan(opts: CreateBackupPlanOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${opts.location}/backupPlans?backupPlanId=${encodeURIComponent(opts.backupPlanId)}`;
      const body = {
        description: opts.description ?? "",
        resourceType: opts.resourceType,
        backupRules: opts.rules.map((r) => ({
          ruleId: r.ruleId,
          backupRetentionDays: r.retention.minRetentionDays,
          standardSchedule: {
            recurrenceType: "CUSTOM",
            cronExpression: r.schedule.cronExpression,
            timeZone: r.schedule.timezone ?? "UTC",
          },
          backupVault: opts.backupVault,
        })),
        backupVault: opts.backupVault,
        labels: opts.labels ?? {},
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteBackupPlan(location: string, planId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${location}/backupPlans/${planId}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Backup Vaults
  // ---------------------------------------------------------------------------

  async listBackupVaults(location: string): Promise<BackupVault[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${location}/backupVaults`;
      const items = await gcpList<Record<string, unknown>>(url, token, "backupVaults");
      return items.map((v) => this.mapBackupVault(v));
    }, this.retryOptions);
  }

  async createBackupVault(opts: CreateBackupVaultOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${opts.location}/backupVaults?backupVaultId=${encodeURIComponent(opts.backupVaultId)}`;
      const body = {
        description: opts.description ?? "",
        backupMinimumEnforcedRetentionDuration: `${(opts.minimumRetentionDays ?? 1) * 86400}s`,
        labels: opts.labels ?? {},
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteBackupVault(location: string, vaultId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${location}/backupVaults/${vaultId}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Backups
  // ---------------------------------------------------------------------------

  async listBackups(location: string, backupVault: string): Promise<Backup[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${location}/backupVaults/${backupVault}/dataSources/-/backups`;
      const items = await gcpList<Record<string, unknown>>(url, token, "backups");
      return items.map((b) => this.mapBackup(b));
    }, this.retryOptions);
  }

  async restoreBackup(opts: RestoreOptions): Promise<GcpOperationResult> {
    if (!opts.location?.trim()) throw new Error("restoreBackup: 'location' is required");
    if (!opts.backupVault?.trim()) throw new Error("restoreBackup: 'backupVault' is required");
    if (!opts.backupId?.trim()) throw new Error("restoreBackup: 'backupId' is required");

    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${opts.location}/backupVaults/${opts.backupVault}/dataSources/-/backups/${opts.backupId}:restore`;
      const body = {
        targetProject: opts.targetProject ?? `projects/${this.projectId}`,
        targetResourceName: opts.targetResourceName,
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Jobs & Compliance
  // ---------------------------------------------------------------------------

  async listBackupJobs(location: string): Promise<BackupJob[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BASE}/projects/${this.projectId}/locations/${location}/backupPlanAssociations/-/backupJobs`;
      const items = await gcpList<Record<string, unknown>>(url, token, "backupJobs");
      return items.map((j) => this.mapBackupJob(j));
    }, this.retryOptions);
  }

  async checkBackupCompliance(location: string): Promise<BackupComplianceStatus[]> {
    const plans = await this.listBackupPlans(location);
    const jobs = await this.listBackupJobs(location);

    const jobsByPlan = new Map<string, BackupJob[]>();
    for (const job of jobs) {
      const existing = jobsByPlan.get(job.backupPlan) ?? [];
      existing.push(job);
      jobsByPlan.set(job.backupPlan, existing);
    }

    return plans.map((plan) => {
      const planJobs = jobsByPlan.get(plan.name) ?? [];
      const lastSuccessful = planJobs
        .filter((j) => j.state === "SUCCEEDED")
        .sort((a, b) => (b.completeTime ?? "").localeCompare(a.completeTime ?? ""))[0];

      const issues: string[] = [];
      if (!lastSuccessful) issues.push("No successful backups found");
      if (plan.state !== "ACTIVE") issues.push(`Backup plan is ${plan.state}`);

      const failedRecent = planJobs.filter((j) => j.state === "FAILED").slice(0, 3);
      for (const f of failedRecent) {
        issues.push(`Recent failure: ${f.errorMessage ?? "unknown error"}`);
      }

      return {
        resourceId: plan.name,
        resourceType: plan.resourceType,
        lastBackupTime: lastSuccessful?.completeTime,
        compliant: issues.length === 0,
        issues,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapBackupPlan(raw: Record<string, unknown>): BackupPlan {
    const rules = Array.isArray(raw.backupRules)
      ? (raw.backupRules as Array<Record<string, unknown>>).map((r) => ({
          ruleId: String(r.ruleId ?? ""),
          schedule: {
            cronExpression: String((r.standardSchedule as Record<string, unknown>)?.cronExpression ?? ""),
            timezone: ((r.standardSchedule as Record<string, unknown>)?.timeZone as string) ?? undefined,
          },
          retention: {
            minRetentionDays: Number(r.backupRetentionDays ?? 0),
          },
          backupVaultId: r.backupVault ? String(r.backupVault) : undefined,
        }))
      : [];

    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      state: (raw.state as BackupPlanState) ?? "STATE_UNSPECIFIED",
      resourceType: String(raw.resourceType ?? ""),
      rules,
      labels: (raw.labels as Record<string, string>) ?? {},
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      backupVault: String(raw.backupVault ?? ""),
    };
  }

  private mapBackupVault(raw: Record<string, unknown>): BackupVault {
    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      state: (raw.state as BackupVaultState) ?? "STATE_UNSPECIFIED",
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      labels: (raw.labels as Record<string, string>) ?? {},
      backupMinimumEnforcedRetentionDuration: String(raw.backupMinimumEnforcedRetentionDuration ?? ""),
      deletable: Boolean(raw.deletable),
      backupCount: Number(raw.backupCount ?? 0),
      totalSizeBytes: String(raw.totalSizeBytes ?? "0"),
    };
  }

  private mapBackup(raw: Record<string, unknown>): Backup {
    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      state: (raw.state as BackupState) ?? "STATE_UNSPECIFIED",
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      expireTime: String(raw.expireTime ?? ""),
      consistencyTime: String(raw.consistencyTime ?? ""),
      resourceSizeBytes: String(raw.resourceSizeBytes ?? "0"),
      backupType: String(raw.backupType ?? ""),
      resourceType: String(raw.resourceType ?? ""),
      labels: (raw.labels as Record<string, string>) ?? {},
    };
  }

  private mapBackupJob(raw: Record<string, unknown>): BackupJob {
    return {
      name: String(raw.name ?? ""),
      state: (raw.state as BackupJobState) ?? "STATE_UNSPECIFIED",
      backupPlan: String(raw.backupPlan ?? ""),
      resource: String(raw.resource ?? ""),
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      completeTime: raw.completeTime ? String(raw.completeTime) : undefined,
      errorMessage: raw.error ? String((raw.error as Record<string, unknown>).message ?? "") : undefined,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createBackupManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpBackupManager {
  return new GcpBackupManager(projectId, getAccessToken, retryOptions);
}
