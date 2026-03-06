/**
 * IAM Extraction Step Handler
 *
 * Extracts IAM roles, policies, and their relationships from the source provider.
 * Uses resolveProviderAdapter() → adapter.iam.listRoles() / listPolicies()
 * to query real cloud provider APIs.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export const extractIAMHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;

    log.info(`[extract-iam] Extracting IAM roles and policies from ${sourceProvider}`);

    const credentials = ctx.sourceCredentials as ProviderCredentialConfig | undefined;
    if (!credentials) {
      log.info("[extract-iam] No source credentials; returning empty inventory");
      return { roles: [], policies: [], rolesCount: 0, policiesCount: 0, sourceProvider };
    }

    const adapter = await resolveProviderAdapter(sourceProvider as MigrationProvider, credentials);

    const rawRoles = await adapter.iam.listRoles();
    const roles = rawRoles.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      description: r.description ?? "",
      attachedPolicyCount: r.attachedPolicyArns.length,
      inlinePolicyCount: r.inlinePolicies.length,
      trustPolicy: r.trustPolicy ?? {},
      tags: r.tags,
      arn: r.arn,
      inlinePolicies: r.inlinePolicies,
      attachedPolicyArns: r.attachedPolicyArns,
    }));

    const rawPolicies = await adapter.iam.listPolicies();
    const policies = rawPolicies.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      isManaged: p.isManaged,
      document: p.document,
      description: p.description,
      arn: p.arn,
      attachedTo: p.attachedTo,
      tags: p.tags,
    }));

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
