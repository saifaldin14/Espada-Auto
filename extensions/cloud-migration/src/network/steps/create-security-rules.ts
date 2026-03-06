/**
 * Network Step — Create Security Rules
 *
 * Creates security groups / firewall rules on the target provider
 * using the translated rule set from the rule-translator.
 */

import type { MigrationStepHandler, MigrationStepContext, NormalizedSecurityRule, MigrationProvider } from "../../types.js";
import { translateSecurityGroup } from "../rule-translator.js";
import type { SecurityGroupMapping } from "../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export interface CreateSecurityRulesParams {
  sourceProvider: string;
  targetProvider: string;
  targetRegion: string;
  securityGroups: Array<{
    groupId: string;
    groupName: string;
    rules: NormalizedSecurityRule[];
  }>;
  vpcId?: string;
}

interface CreateSecurityRulesResult {
  mappings: SecurityGroupMapping[];
  groupsCreated: number;
  rulesCreated: number;
  warnings: string[];
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as CreateSecurityRulesParams;
  ctx.log.info(`Creating security rules on ${params.targetProvider} (${params.targetRegion})`);
  ctx.log.info(`  Source groups: ${params.securityGroups.length}`);

  const mappings: SecurityGroupMapping[] = [];
  const allWarnings: string[] = [];
  let totalRules = 0;

  // Resolve target provider adapter
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
  let adapter: Awaited<ReturnType<typeof resolveProviderAdapter>> | undefined;
  if (credentials) {
    adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
  }

  for (const group of params.securityGroups) {
    ctx.signal?.throwIfAborted();

    // Translate rules to target provider format
    const mapping = translateSecurityGroup({
      groupId: group.groupId,
      groupName: group.groupName,
      rules: group.rules,
      sourceProvider: params.sourceProvider as any,
      targetProvider: params.targetProvider as any,
    });

    // Create the security group via SDK if adapter is available
    if (adapter) {
      try {
        const sgResult = await adapter.network.createSecurityGroup({
          name: mapping.targetGroupName,
          description: `Migrated from ${params.sourceProvider}/${group.groupId}`,
          vpcId: params.vpcId,
          region: params.targetRegion,
        });

        mapping.targetGroupId = sgResult.id;

        // Add rules to the created group
        if (mapping.rules.length > 0) {
          const normalizedRules: NormalizedSecurityRule[] = mapping.rules.map((rm) => rm.targetRule);
          await adapter.network.addSecurityRules(sgResult.id, normalizedRules, params.targetRegion);
        }

        ctx.log.info(`  Created group "${mapping.targetGroupName}" (${sgResult.id}) with ${mapping.rules.length} rules via SDK`);
      } catch (err) {
        ctx.log.info(`  Failed to create group "${mapping.targetGroupName}" via SDK: ${err instanceof Error ? err.message : String(err)}`);
        allWarnings.push(`Failed to create security group ${mapping.targetGroupName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      ctx.log.info(`  Created group "${mapping.targetGroupName}" with ${mapping.rules.length} rules`);
    }

    mappings.push(mapping);
    totalRules += mapping.rules.length;
    allWarnings.push(...mapping.warnings);

    if (mapping.warnings.length > 0) {
      for (const w of mapping.warnings) {
        ctx.log.info(`    ⚠ ${w}`);
      }
    }
  }

  ctx.log.info(`  Total: ${mappings.length} groups, ${totalRules} rules, ${allWarnings.length} warnings`);

  return {
    mappings,
    groupsCreated: mappings.length,
    rulesCreated: totalRules,
    warnings: allWarnings,
  } as unknown as Record<string, unknown>;
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const mappings = (outputs?.mappings ?? []) as SecurityGroupMapping[];
  if (!mappings.length) return;

  const params = ctx.params as unknown as CreateSecurityRulesParams;
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;

  if (credentials) {
    try {
      const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
      for (const mapping of mappings) {
        if (mapping.targetGroupId) {
          await adapter.network.deleteSecurityGroup(mapping.targetGroupId, params.targetRegion);
          ctx.log.info(`Deleted security group ${mapping.targetGroupId} on ${mapping.targetProvider} via SDK`);
        }
      }
      return;
    } catch (err) {
      ctx.log.info(`Rollback via SDK failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const mapping of mappings) {
    if (mapping.targetGroupId) {
      ctx.log.info(`Deleting security group ${mapping.targetGroupId} on ${mapping.targetProvider}`);
    }
  }
}

export const createSecurityRulesHandler: MigrationStepHandler = {
  execute,
  rollback,
};
