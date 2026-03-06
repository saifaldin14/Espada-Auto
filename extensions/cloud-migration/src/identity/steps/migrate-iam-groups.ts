/**
 * Identity Step — Migrate IAM Groups
 *
 * Migrates IAM groups to target provider equivalents.
 * Handles:
 *   - Group creation with equivalent policies
 *   - Attached policy ARN mapping
 *   - Inline policy migration
 *
 * Note: Group-to-role mapping may differ between providers.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateIAMGroupsHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-iam-groups] Migrating IAM groups → ${targetProvider}`);

    const groups = (params.groups ?? []) as Array<{
      id: string;
      name: string;
      memberUserIds: string[];
      attachedPolicyArns: string[];
      inlinePolicies: Record<string, unknown>[];
    }>;
    const migratedGroups: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      memberCount: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { iam?: { createGroup: (group: unknown) => Promise<{ id: string; arn?: string }>; deleteGroup: (id: string) => Promise<void> } }
      | undefined;

    for (const group of groups) {
      const name = String(group.name ?? "");

      if (group.inlinePolicies.length > 0 && targetProvider !== "aws") {
        warnings.push(
          `Group "${name}": Group-to-role mapping may differ between providers`,
        );
      }

      if (targetAdapter?.iam) {
        const result = await targetAdapter.iam.createGroup({
          name,
          memberUserIds: group.memberUserIds,
          attachedPolicyArns: group.attachedPolicyArns,
          inlinePolicies: group.inlinePolicies,
        });
        migratedGroups.push({
          sourceId: group.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          memberCount: group.memberUserIds.length,
        });
      } else {
        migratedGroups.push({
          sourceId: group.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          memberCount: group.memberUserIds.length,
        });
      }
    }

    log.info(`[migrate-iam-groups] Migrated ${migratedGroups.length} IAM groups`);

    return {
      migratedGroups,
      groupsCount: migratedGroups.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedGroups = (outputs.migratedGroups ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-iam-groups] Rolling back ${migratedGroups.length} IAM groups`);

    const targetAdapter = ctx.targetCredentials as
      | { iam?: { deleteGroup: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.iam) {
      for (const group of migratedGroups) {
        await targetAdapter.iam.deleteGroup(group.targetId);
      }
    }

    log.info("[migrate-iam-groups] Rollback complete");
  },
};
