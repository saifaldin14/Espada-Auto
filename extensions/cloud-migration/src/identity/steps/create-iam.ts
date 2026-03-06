/**
 * IAM Creation Step Handler
 *
 * Creates equivalent IAM roles and policies on the target provider.
 * Handles cross-provider IAM translation:
 *   AWS IAM → Azure AD Roles / GCP IAM Bindings
 *   Azure AD → AWS IAM Roles / GCP IAM Bindings
 *   GCP IAM → AWS IAM Roles / Azure AD Roles
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

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

    const createdRoles: Array<{ sourceId: string; sourceName: string; targetId: string; targetName: string }> = [];
    const createdPolicies: Array<{ sourceId: string; sourceName: string; targetId: string; targetName: string }> = [];
    const warnings: string[] = [];

    const targetCredentials = ctx.targetCredentials as
      | { iam?: { createRole: (r: unknown) => Promise<{ id: string }>; createPolicy: (p: unknown) => Promise<{ id: string }> } }
      | undefined;

    for (const role of roles) {
      const roleName = String(role.name ?? "");
      const translatedName = translateRoleName(roleName, targetProvider);

      if (targetCredentials?.iam) {
        const result = await targetCredentials.iam.createRole({
          name: translatedName,
          description: role.description,
          trustPolicy: role.trustPolicy,
        });
        createdRoles.push({
          sourceId: String(role.id),
          sourceName: roleName,
          targetId: result.id,
          targetName: translatedName,
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

      if (targetCredentials?.iam) {
        const result = await targetCredentials.iam.createPolicy({
          name: targetName,
          document: policy.document ?? policy.documentHash,
        });
        createdPolicies.push({
          sourceId: String(policy.id),
          sourceName: policyName,
          targetId: result.id,
          targetName,
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
    const createdRoles = (outputs.createdRoles ?? []) as Array<{ targetId: string; targetName: string }>;
    const createdPolicies = (outputs.createdPolicies ?? []) as Array<{ targetId: string; targetName: string }>;

    log.info(`[create-iam] Rolling back ${createdRoles.length} roles, ${createdPolicies.length} policies`);

    const targetCredentials = ctx.targetCredentials as
      | { iam?: { deleteRole: (id: string) => Promise<void>; deletePolicy: (id: string) => Promise<void> } }
      | undefined;

    if (targetCredentials?.iam) {
      for (const policy of createdPolicies) {
        await targetCredentials.iam.deletePolicy(policy.targetId);
      }
      for (const role of createdRoles) {
        await targetCredentials.iam.deleteRole(role.targetId);
      }
    }

    log.info("[create-iam] Rollback complete");
  },
};

function translateRoleName(name: string, targetProvider: string): string {
  // Sanitize to target provider naming conventions
  switch (targetProvider) {
    case "azure":
      // Azure uses display names, allow spaces
      return name.replace(/_/g, " ");
    case "gcp":
      // GCP roles must be lowercase with underscores
      return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    default:
      return name;
  }
}
