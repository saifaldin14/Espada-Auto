/**
 * Identity Step — Migrate IAM Users
 *
 * Migrates IAM users to target provider equivalents
 * (Azure AD users / GCP IAM members).
 * Handles:
 *   - User creation with equivalent permissions
 *   - Group membership mapping
 *   - Inline policy migration
 *   - Tag migration
 *
 * Note: API keys cannot be migrated (must be regenerated); MFA devices
 * require user re-enrollment; console passwords are not transferable.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

interface AdvancedIAMAdapter {
  iam?: {
    createUser: (user: unknown) => Promise<{ id: string; arn?: string }>;
    deleteUser: (id: string) => Promise<void>;
    addUserToGroup: (userId: string, groupId: string) => Promise<void>;
  };
}

export const migrateIAMUsersHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-iam-users] Migrating IAM users → ${targetProvider}`);

    const users = (params.users ?? []) as Array<{
      id: string;
      name: string;
      groupIds: string[];
      attachedPolicyArns: string[];
      inlinePolicies: Record<string, unknown>[];
      hasConsoleAccess: boolean;
      hasApiKeys: boolean;
      mfaEnabled: boolean;
      tags?: Record<string, string>;
    }>;
    const migratedUsers: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as AdvancedIAMAdapter | undefined;

    for (const user of users) {
      const name = String(user.name ?? "");

      if (user.hasApiKeys) {
        warnings.push(
          `User "${name}": API keys cannot be migrated — must be regenerated in ${targetProvider}`,
        );
      }
      if (user.mfaEnabled) {
        warnings.push(
          `User "${name}": MFA devices require user re-enrollment in ${targetProvider}`,
        );
      }
      if (user.hasConsoleAccess) {
        warnings.push(
          `User "${name}": Console password is not transferable — user must reset password`,
        );
      }

      if (targetAdapter?.iam) {
        const result = await targetAdapter.iam.createUser({
          name,
          groupIds: user.groupIds,
          attachedPolicyArns: user.attachedPolicyArns,
          inlinePolicies: user.inlinePolicies,
          tags: user.tags,
        });

        for (const groupId of user.groupIds) {
          await targetAdapter.iam.addUserToGroup(result.id, groupId);
        }

        migratedUsers.push({
          sourceId: user.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
        });
      } else {
        migratedUsers.push({
          sourceId: user.id,
          sourceName: name,
          targetId: `simulated-${name}`,
        });
      }
    }

    log.info(`[migrate-iam-users] Migrated ${migratedUsers.length} IAM users`);

    return {
      migratedUsers,
      usersCount: migratedUsers.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedUsers = (outputs.migratedUsers ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-iam-users] Rolling back ${migratedUsers.length} IAM users`);

    const targetAdapter = ctx.targetCredentials as AdvancedIAMAdapter | undefined;

    if (targetAdapter?.iam) {
      for (const user of migratedUsers) {
        await targetAdapter.iam.deleteUser(user.targetId);
      }
    }

    log.info("[migrate-iam-users] Rollback complete");
  },
};
