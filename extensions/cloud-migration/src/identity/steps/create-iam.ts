/**
 * IAM Creation Step Handler
 *
 * Creates equivalent IAM roles and policies on the target provider.
 * Uses resolveProviderAdapter() → adapter.iam.createRole() / createPolicy()
 * Handles cross-provider IAM translation:
 *   AWS IAM → Azure AD Roles / GCP IAM Bindings
 *   Azure AD → AWS IAM Roles / GCP IAM Bindings
 *   GCP IAM → AWS IAM Roles / Azure AD Roles
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import type { NormalizedIAMRole, NormalizedIAMPolicy } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

/**
 * IAM policy translation map — maps common AWS managed policy patterns
 * to equivalent target provider policies.
 */
const IAM_POLICY_MAP: Record<string, Record<string, string>> = {
  azure: {
    AdministratorAccess: "Owner",
    ReadOnlyAccess: "Reader",
    PowerUserAccess: "Contributor",
    AmazonS3FullAccess: "Storage Blob Data Contributor",
    AmazonS3ReadOnlyAccess: "Storage Blob Data Reader",
    AmazonEC2FullAccess: "Virtual Machine Contributor",
    AmazonRDSFullAccess: "SQL DB Contributor",
    AmazonVPCFullAccess: "Network Contributor",
    AmazonDynamoDBFullAccess: "Cosmos DB Operator",
  },
  gcp: {
    AdministratorAccess: "roles/owner",
    ReadOnlyAccess: "roles/viewer",
    PowerUserAccess: "roles/editor",
    AmazonS3FullAccess: "roles/storage.admin",
    AmazonS3ReadOnlyAccess: "roles/storage.objectViewer",
    AmazonEC2FullAccess: "roles/compute.admin",
    AmazonRDSFullAccess: "roles/cloudsql.admin",
    AmazonVPCFullAccess: "roles/compute.networkAdmin",
    AmazonDynamoDBFullAccess: "roles/datastore.owner",
  },
  "on-premises": {
    AdministratorAccess: "admin",
    ReadOnlyAccess: "read-only",
    PowerUserAccess: "power-user",
  },
};

export const createIAMHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const roles = (params.roles ?? []) as Array<Record<string, unknown>>;
    const policies = (params.policies ?? []) as Array<Record<string, unknown>>;

    log.info(`[create-iam] Creating ${roles.length} roles and ${policies.length} policies on ${targetProvider}`);

    const createdRoles: Array<{ sourceId: string; sourceName: string; targetId: string; targetName: string; arn?: string }> = [];
    const createdPolicies: Array<{ sourceId: string; sourceName: string; targetId: string; targetName: string; arn?: string }> = [];
    const warnings: string[] = [];

    const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
    const adapter = credentials
      ? await resolveProviderAdapter(targetProvider as MigrationProvider, credentials)
      : undefined;

    for (const role of roles) {
      const roleName = String(role.name ?? "");
      const translatedName = translateRoleName(roleName, targetProvider);

      if (adapter) {
        const normalizedRole: NormalizedIAMRole = {
          id: String(role.id ?? ""),
          name: translatedName,
          provider: targetProvider,
          description: String(role.description ?? `Migrated from ${role.provider ?? "source"}`),
          trustPolicy: (role.trustPolicy ?? undefined) as Record<string, unknown> | undefined,
          inlinePolicies: (role.inlinePolicies ?? []) as NormalizedIAMPolicy[],
          attachedPolicyArns: (role.attachedPolicyArns ?? []) as string[],
          tags: (role.tags ?? {}) as Record<string, string>,
        };
        const result = await adapter.iam.createRole(normalizedRole);
        createdRoles.push({
          sourceId: String(role.id),
          sourceName: roleName,
          targetId: result.id,
          targetName: translatedName,
          arn: result.arn,
        });
      } else {
        createdRoles.push({
          sourceId: String(role.id),
          sourceName: roleName,
          targetId: `simulated-${translatedName}`,
          targetName: translatedName,
        });
      }
    }

    for (const policy of policies) {
      const policyName = String(policy.name ?? "");
      const mapping = IAM_POLICY_MAP[targetProvider];
      const targetName = mapping?.[policyName] ?? policyName;

      if (policyName !== targetName) {
        log.info(`[create-iam] Mapped policy "${policyName}" → "${targetName}" for ${targetProvider}`);
      } else {
        warnings.push(`No direct mapping for policy "${policyName}"; creating custom equivalent`);
      }

      if (adapter) {
        const normalizedPolicy: NormalizedIAMPolicy = {
          id: String(policy.id ?? ""),
          name: targetName,
          provider: targetProvider,
          description: String(policy.description ?? `Migrated from ${policy.provider ?? "source"}`),
          document: (policy.document ?? {}) as Record<string, unknown>,
          isManaged: Boolean(policy.isManaged),
          attachedTo: (policy.attachedTo ?? []) as string[],
          tags: (policy.tags ?? {}) as Record<string, string>,
        };
        const result = await adapter.iam.createPolicy(normalizedPolicy);
        createdPolicies.push({
          sourceId: String(policy.id),
          sourceName: policyName,
          targetId: result.id,
          targetName,
          arn: result.arn,
        });
      } else {
        createdPolicies.push({
          sourceId: String(policy.id),
          sourceName: policyName,
          targetId: `simulated-${targetName}`,
          targetName,
        });
      }
    }

    log.info(`[create-iam] Created ${createdRoles.length} roles, ${createdPolicies.length} policies on ${targetProvider}`);

    return {
      createdRoles,
      createdPolicies,
      rolesCreated: createdRoles.length,
      policiesCreated: createdPolicies.length,
      warnings,
      targetProvider,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const targetProvider = (outputs.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const createdRoles = (outputs.createdRoles ?? []) as Array<{ targetId: string; targetName: string }>;
    const createdPolicies = (outputs.createdPolicies ?? []) as Array<{ targetId: string; targetName: string }>;

    log.info(`[create-iam] Rolling back ${createdRoles.length} roles, ${createdPolicies.length} policies`);

    const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
    if (credentials) {
      const adapter = await resolveProviderAdapter(targetProvider as MigrationProvider, credentials);
      for (const policy of createdPolicies) {
        await adapter.iam.deletePolicy(policy.targetId).catch(() => {});
      }
      for (const role of createdRoles) {
        await adapter.iam.deleteRole(role.targetId).catch(() => {});
      }
    }

    log.info("[create-iam] Rollback complete");
  },
};

function translateRoleName(name: string, targetProvider: string): string {
  switch (targetProvider) {
    case "azure":
      return name.replace(/_/g, " ");
    case "gcp":
      return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    default:
      return name;
  }
}
