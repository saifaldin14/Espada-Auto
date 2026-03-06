/**
 * Monitoring Step — Migrate Log Groups
 *
 * Migrates CloudWatch Log Groups to target provider equivalents
 * (Azure Monitor Log Analytics / GCP Cloud Logging).
 * Handles:
 *   - Log group creation with retention configuration
 *   - Subscription filter migration
 *   - Metric filter migration
 *   - Tag migration
 *
 * Note: Historical logs are NOT transferred — only configuration is migrated.
 * Subscription filter destinations need re-mapping; metric filter syntax
 * differs between providers.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateLogGroupsHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-log-groups] Migrating log groups → ${targetProvider}`);

    const logGroups = (params.logGroups ?? []) as Array<{
      id: string;
      name: string;
      retentionDays: number;
      storedSizeBytes: number;
      kmsKeyId?: string;
      subscriptionFilters: Array<Record<string, unknown>>;
      metricFilters: Array<Record<string, unknown>>;
      tags?: Record<string, string>;
    }>;
    const migratedLogGroups: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      retentionDays: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          monitoring?: {
            createLogGroup: (lg: unknown) => Promise<{ id: string; arn?: string }>;
            createSubscriptionFilters: (logGroupId: string, filters: unknown[]) => Promise<void>;
            createMetricFilters: (logGroupId: string, filters: unknown[]) => Promise<void>;
            deleteLogGroup: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const lg of logGroups) {
      const name = String(lg.name ?? "");

      if (lg.subscriptionFilters.length > 0) {
        warnings.push(
          `Log group "${name}": Subscription filter destinations need re-mapping for ${targetProvider}`,
        );
      }

      if (lg.metricFilters.length > 0) {
        warnings.push(
          `Log group "${name}": Metric filter syntax differs between providers — manual review required`,
        );
      }

      if (lg.storedSizeBytes > 0) {
        warnings.push(
          `Log group "${name}": Historical log data (${lg.storedSizeBytes} bytes) will NOT be transferred`,
        );
      }

      if (targetAdapter?.monitoring) {
        const result = await targetAdapter.monitoring.createLogGroup({
          name,
          retentionDays: lg.retentionDays,
          kmsKeyId: lg.kmsKeyId,
          tags: lg.tags,
        });

        if (lg.subscriptionFilters.length > 0) {
          await targetAdapter.monitoring.createSubscriptionFilters(result.id, lg.subscriptionFilters);
        }

        if (lg.metricFilters.length > 0) {
          await targetAdapter.monitoring.createMetricFilters(result.id, lg.metricFilters);
        }

        migratedLogGroups.push({
          sourceId: lg.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          retentionDays: lg.retentionDays,
        });
      } else {
        migratedLogGroups.push({
          sourceId: lg.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          retentionDays: lg.retentionDays,
        });
      }
    }

    log.info(`[migrate-log-groups] Migrated ${migratedLogGroups.length} log groups`);

    return {
      migratedLogGroups,
      logGroupsCount: migratedLogGroups.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedLogGroups = (outputs.migratedLogGroups ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-log-groups] Rolling back ${migratedLogGroups.length} log groups`);

    const targetAdapter = ctx.targetCredentials as
      | { monitoring?: { deleteLogGroup: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.monitoring) {
      for (const lg of migratedLogGroups) {
        await targetAdapter.monitoring.deleteLogGroup(lg.targetId);
      }
    }

    log.info("[migrate-log-groups] Rollback complete");
  },
};
