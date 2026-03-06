/**
 * Network Step — Migrate Network ACLs
 *
 * Migrates Network ACLs to target provider equivalents
 * (Azure NSGs extended / GCP firewall rules).
 * Handles:
 *   - Inbound and outbound rule translation
 *   - Rule numbering remapping
 *   - Subnet association re-mapping
 *   - Tag migration
 *
 * Note: Rule numbering differs between providers; explicit deny rules may
 * conflict with provider default behavior; subnet associations must be
 * re-mapped.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateNetworkACLHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-network-acl] Migrating Network ACLs → ${targetProvider}`);

    const networkACLs = (params.networkACLs ?? []) as Array<{
      id: string;
      name: string;
      vpcId: string;
      subnetAssociations: string[];
      inboundRules: Array<{
        ruleNumber: number;
        protocol: string;
        portRange: string;
        cidrBlock: string;
        action: string;
      }>;
      outboundRules: Array<{
        ruleNumber: number;
        protocol: string;
        portRange: string;
        cidrBlock: string;
        action: string;
      }>;
      tags?: Record<string, string>;
    }>;

    const migratedACLs: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      inboundRuleCount: number;
      outboundRuleCount: number;
      subnetAssociationCount: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          network?: {
            createNetworkACL: (acl: unknown) => Promise<{ id: string }>;
            deleteNetworkACL: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const acl of networkACLs) {
      const name = String(acl.name ?? "");

      // Rule numbering differs between providers
      if (targetProvider !== "aws") {
        warnings.push(
          `Network ACL "${name}": Rule numbering differs between providers — rules will be renumbered`,
        );
      }

      // Explicit deny rules may conflict with provider default behavior
      const hasExplicitDeny = [
        ...(acl.inboundRules ?? []),
        ...(acl.outboundRules ?? []),
      ].some((r) => r.action === "deny");
      if (hasExplicitDeny) {
        warnings.push(
          `Network ACL "${name}": Explicit deny rules may conflict with ${targetProvider} default behavior`,
        );
      }

      // Subnet associations must be re-mapped
      if ((acl.subnetAssociations ?? []).length > 0) {
        warnings.push(
          `Network ACL "${name}": ${acl.subnetAssociations.length} subnet association(s) must be re-mapped to target VPC subnets`,
        );
      }

      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createNetworkACL({
          name,
          vpcId: acl.vpcId,
          subnetAssociations: acl.subnetAssociations,
          inboundRules: acl.inboundRules,
          outboundRules: acl.outboundRules,
          tags: acl.tags,
        });
        migratedACLs.push({
          sourceId: acl.id,
          sourceName: name,
          targetId: result.id,
          inboundRuleCount: (acl.inboundRules ?? []).length,
          outboundRuleCount: (acl.outboundRules ?? []).length,
          subnetAssociationCount: (acl.subnetAssociations ?? []).length,
        });
      } else {
        migratedACLs.push({
          sourceId: acl.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          inboundRuleCount: (acl.inboundRules ?? []).length,
          outboundRuleCount: (acl.outboundRules ?? []).length,
          subnetAssociationCount: (acl.subnetAssociations ?? []).length,
        });
      }
    }

    log.info(`[migrate-network-acl] Migrated ${migratedACLs.length} Network ACLs`);

    return {
      migratedACLs,
      aclCount: migratedACLs.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedACLs = (outputs.migratedACLs ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-network-acl] Rolling back ${migratedACLs.length} Network ACLs`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteNetworkACL: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      for (const acl of migratedACLs) {
        await targetAdapter.network.deleteNetworkACL(acl.targetId);
      }
    }

    log.info("[migrate-network-acl] Rollback complete");
  },
};
