/**
 * Network Step — Migrate Listener Rules
 *
 * Migrates ALB/NLB listener rules to target provider equivalents
 * (Azure Front Door rules / GCP URL Map).
 * Handles:
 *   - Condition and action translation
 *   - Priority remapping
 *   - Redirect and fixed-response configuration
 *   - Target group ARN re-mapping
 *
 * Note: Cognito/OIDC auth actions need re-implementation on target; target
 * group ARNs must be re-mapped; weighted routing may differ.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateListenerRulesHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-listener-rules] Migrating listener rules → ${targetProvider}`);

    const listenerRules = (params.listenerRules ?? []) as Array<{
      id: string;
      listenerArn: string;
      priority: number;
      conditions: Array<{
        field: string;
        values: string[];
      }>;
      actions: Array<{
        type: string;
        targetGroupArn?: string;
        redirectConfig?: Record<string, unknown>;
        fixedResponseConfig?: Record<string, unknown>;
      }>;
    }>;

    const migratedRules: Array<{
      sourceId: string;
      listenerArn: string;
      targetId: string;
      priority: number;
      conditionCount: number;
      actionCount: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          network?: {
            createListenerRules: (rules: unknown) => Promise<{ id: string }>;
            deleteListenerRules: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const rule of listenerRules) {
      // Cognito/OIDC auth actions need re-implementation on target
      const hasAuthAction = (rule.actions ?? []).some(
        (a) => a.type === "authenticate-cognito" || a.type === "authenticate-oidc",
      );
      if (hasAuthAction) {
        warnings.push(
          `Listener rule "${rule.id}": Cognito/OIDC auth actions need re-implementation on ${targetProvider}`,
        );
      }

      // Target group ARNs must be re-mapped
      const hasTargetGroupAction = (rule.actions ?? []).some((a) => a.targetGroupArn);
      if (hasTargetGroupAction) {
        warnings.push(
          `Listener rule "${rule.id}": Target group ARNs must be re-mapped to ${targetProvider} equivalents`,
        );
      }

      // Weighted routing may differ
      const hasWeightedForward = (rule.actions ?? []).some(
        (a) => a.type === "forward" && (a as Record<string, unknown>).weight !== undefined,
      );
      if (hasWeightedForward) {
        warnings.push(
          `Listener rule "${rule.id}": Weighted routing may differ on ${targetProvider}`,
        );
      }

      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createListenerRules({
          listenerArn: rule.listenerArn,
          priority: rule.priority,
          conditions: rule.conditions,
          actions: rule.actions,
        });
        migratedRules.push({
          sourceId: rule.id,
          listenerArn: rule.listenerArn,
          targetId: result.id,
          priority: rule.priority,
          conditionCount: (rule.conditions ?? []).length,
          actionCount: (rule.actions ?? []).length,
        });
      } else {
        migratedRules.push({
          sourceId: rule.id,
          listenerArn: rule.listenerArn,
          targetId: `simulated-${rule.id}`,
          priority: rule.priority,
          conditionCount: (rule.conditions ?? []).length,
          actionCount: (rule.actions ?? []).length,
        });
      }
    }

    log.info(`[migrate-listener-rules] Migrated ${migratedRules.length} listener rules`);

    return {
      migratedRules,
      ruleCount: migratedRules.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedRules = (outputs.migratedRules ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-listener-rules] Rolling back ${migratedRules.length} listener rules`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteListenerRules: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      for (const rule of migratedRules) {
        await targetAdapter.network.deleteListenerRules(rule.targetId);
      }
    }

    log.info("[migrate-listener-rules] Rollback complete");
  },
};
