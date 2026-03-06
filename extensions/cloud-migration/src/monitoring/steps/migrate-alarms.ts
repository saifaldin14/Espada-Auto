/**
 * Monitoring Step — Migrate Alarms
 *
 * Migrates CloudWatch Alarms to target provider equivalents
 * (Azure Monitor Alerts / GCP Monitoring Alerting Policies).
 * Handles:
 *   - Alarm creation with metric configuration
 *   - Threshold and comparison operator mapping
 *   - Evaluation period configuration
 *   - Dimension mapping
 *   - Tag migration
 *
 * Note: Metric namespaces differ between providers (AWS/EC2 → azure.compute);
 * action targets (SNS ARNs) need re-mapping; composite alarms not supported.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Metric namespace translation map. */
const NAMESPACE_MAP: Record<string, Record<string, string>> = {
  azure: {
    "AWS/EC2": "azure.compute",
    "AWS/RDS": "azure.sql",
    "AWS/ELB": "azure.network",
    "AWS/S3": "azure.storage",
    "AWS/Lambda": "azure.functions",
  },
  gcp: {
    "AWS/EC2": "compute.googleapis.com",
    "AWS/RDS": "cloudsql.googleapis.com",
    "AWS/ELB": "loadbalancing.googleapis.com",
    "AWS/S3": "storage.googleapis.com",
    "AWS/Lambda": "cloudfunctions.googleapis.com",
  },
};

function translateNamespace(namespace: string, targetProvider: string): string {
  const map = NAMESPACE_MAP[targetProvider];
  if (!map) return namespace;
  return map[namespace] ?? namespace;
}

export const migrateAlarmsHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-alarms] Migrating alarms → ${targetProvider}`);

    const alarms = (params.alarms ?? []) as Array<{
      id: string;
      name: string;
      metricName: string;
      namespace: string;
      statistic: string;
      threshold: number;
      comparisonOperator: string;
      evaluationPeriods: number;
      periodSec: number;
      actions: string[];
      dimensions: Record<string, string>;
      tags?: Record<string, string>;
    }>;
    const migratedAlarms: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      sourceNamespace: string;
      targetNamespace: string;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { monitoring?: { createAlarm: (alarm: unknown) => Promise<{ id: string; arn?: string }>; deleteAlarm: (id: string) => Promise<void> } }
      | undefined;

    for (const alarm of alarms) {
      const name = String(alarm.name ?? "");
      const sourceNamespace = String(alarm.namespace ?? "");
      const targetNamespace = translateNamespace(sourceNamespace, targetProvider);

      if (alarm.actions.length > 0 && targetProvider !== "aws") {
        warnings.push(
          `Alarm "${name}": Action targets (SNS ARNs) need re-mapping for ${targetProvider}`,
        );
      }

      if (sourceNamespace !== targetNamespace) {
        warnings.push(
          `Alarm "${name}": Metric namespace translated from "${sourceNamespace}" → "${targetNamespace}"`,
        );
      }

      if (targetAdapter?.monitoring) {
        const result = await targetAdapter.monitoring.createAlarm({
          name,
          metricName: alarm.metricName,
          namespace: targetNamespace,
          statistic: alarm.statistic,
          threshold: alarm.threshold,
          comparisonOperator: alarm.comparisonOperator,
          evaluationPeriods: alarm.evaluationPeriods,
          periodSec: alarm.periodSec,
          actions: alarm.actions,
          dimensions: alarm.dimensions,
          tags: alarm.tags,
        });
        migratedAlarms.push({
          sourceId: alarm.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          sourceNamespace,
          targetNamespace,
        });
      } else {
        migratedAlarms.push({
          sourceId: alarm.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          sourceNamespace,
          targetNamespace,
        });
      }
    }

    log.info(`[migrate-alarms] Migrated ${migratedAlarms.length} alarms`);

    return {
      migratedAlarms,
      alarmsCount: migratedAlarms.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedAlarms = (outputs.migratedAlarms ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-alarms] Rolling back ${migratedAlarms.length} alarms`);

    const targetAdapter = ctx.targetCredentials as
      | { monitoring?: { deleteAlarm: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.monitoring) {
      for (const alarm of migratedAlarms) {
        await targetAdapter.monitoring.deleteAlarm(alarm.targetId);
      }
    }

    log.info("[migrate-alarms] Rollback complete");
  },
};
