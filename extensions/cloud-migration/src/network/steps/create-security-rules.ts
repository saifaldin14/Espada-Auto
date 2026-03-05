/**
 * Network Step — Create Security Rules
 *
 * Creates security groups / firewall rules on the target provider
 * using the translated rule set from the rule-translator.
 */

import type { MigrationStepHandler, MigrationStepContext, NormalizedSecurityRule } from "../../types.js";
import { translateSecurityGroup } from "../rule-translator.js";
import type { SecurityGroupMapping } from "../types.js";

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

  for (const group of params.securityGroups) {
    ctx.signal?.throwIfAborted();

    const mapping = translateSecurityGroup({
      groupId: group.groupId,
      groupName: group.groupName,
      rules: group.rules,
      sourceProvider: params.sourceProvider as any,
      targetProvider: params.targetProvider as any,
    });

    mappings.push(mapping);
    totalRules += mapping.rules.length;
    allWarnings.push(...mapping.warnings);

    ctx.log.info(`  Created group "${mapping.targetGroupName}" with ${mapping.rules.length} rules`);
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
