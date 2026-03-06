/**
 * IAM Extraction Step Handler
 *
 * Extracts IAM roles, policies, and their relationships from the source provider.
 * Maps AWS IAM roles/policies → normalized format for cross-provider translation.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const extractIAMHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;

    log.info(`[extract-iam] Extracting IAM roles and policies from ${sourceProvider}`);

    // In production, this calls sourceAdapter.iam.listRoles() + listPolicies()
    // For now, we simulate discovery and normalization
    const roles: Array<{
      id: string;
      name: string;
      provider: string;
      description: string;
      attachedPolicyCount: number;
      inlinePolicyCount: number;
      trustPolicy: Record<string, unknown>;
    }> = [];

    const policies: Array<{
      id: string;
      name: string;
      provider: string;
      isManaged: boolean;
      documentHash: string;
    }> = [];

    // Discover roles from source provider adapter (when available)
    const sourceCredentials = ctx.sourceCredentials as
      | { iam?: { listRoles: () => Promise<unknown[]>; listPolicies: () => Promise<unknown[]> } }
      | undefined;

    if (sourceCredentials?.iam) {
      const rawRoles = await sourceCredentials.iam.listRoles();
      for (const r of rawRoles) {
        const role = r as Record<string, unknown>;
        roles.push({
          id: String(role.id ?? role.roleId ?? ""),
          name: String(role.name ?? role.roleName ?? ""),
          provider: sourceProvider,
          description: String(role.description ?? ""),
          attachedPolicyCount: Array.isArray(role.attachedPolicies) ? role.attachedPolicies.length : 0,
          inlinePolicyCount: Array.isArray(role.inlinePolicies) ? role.inlinePolicies.length : 0,
          trustPolicy: (role.trustPolicy ?? {}) as Record<string, unknown>,
        });
      }
      const rawPolicies = await sourceCredentials.iam.listPolicies();
      for (const p of rawPolicies) {
        const policy = p as Record<string, unknown>;
        policies.push({
          id: String(policy.id ?? policy.policyId ?? ""),
          name: String(policy.name ?? policy.policyName ?? ""),
          provider: sourceProvider,
          isManaged: Boolean(policy.isManaged ?? policy.arn),
          documentHash: String(policy.documentHash ?? ""),
        });
      }
    }

    log.info(`[extract-iam] Discovered ${roles.length} roles, ${policies.length} policies from ${sourceProvider}`);

    return {
      roles,
      policies,
      rolesCount: roles.length,
      policiesCount: policies.length,
      sourceProvider,
    };
  },
};
