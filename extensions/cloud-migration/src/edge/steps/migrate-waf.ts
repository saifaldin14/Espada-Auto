/**
 * WAF Rule Migration Step Handler
 *
 * Migrates Web Application Firewall rules:
 *   AWS WAF → Azure WAF Policy / Cloud Armor
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateWAFHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const wafRules = (params.wafRules ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-waf] Migrating ${wafRules.length} WAF rule set(s) to ${targetProvider}`);

    const created: Array<{ sourceId: string; sourceName: string; targetId: string; rulesCount: number }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { cdn?: { createWAFRule: (r: unknown) => Promise<{ id: string }> } }
      | undefined;

    for (const waf of wafRules) {
      const name = String(waf.name ?? "");
      const rules = (waf.rules ?? []) as Array<Record<string, unknown>>;

      if (targetAdapter?.cdn) {
        const result = await targetAdapter.cdn.createWAFRule({
          name,
          rules: rules.map((r) => translateWAFRule(r, targetProvider)),
          scope: waf.scope ?? "regional",
        });
        created.push({ sourceId: String(waf.id), sourceName: name, targetId: result.id, rulesCount: rules.length });
      } else {
        created.push({ sourceId: String(waf.id), sourceName: name, targetId: `simulated-waf-${name}`, rulesCount: rules.length });
      }

      // AWS-specific rule groups need translation
      for (const r of rules) {
        const condition = String(r.condition ?? "");
        if (condition.includes("AWSManagedRules")) {
          warnings.push(`WAF "${name}": AWS Managed Rule "${condition}" has no direct ${targetProvider} equivalent; mapped to closest match`);
        }
      }
    }

    log.info(`[migrate-waf] Created ${created.length} WAF rule sets`);
    return { createdWAFRules: created, wafRulesCreated: created.length, warnings };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const created = (outputs.createdWAFRules ?? []) as Array<{ targetId: string }>;
    log.info(`[migrate-waf] Rolling back ${created.length} WAF rule sets`);
    const targetAdapter = ctx.targetCredentials as
      | { cdn?: { deleteWAFRule: (id: string) => Promise<void> } }
      | undefined;
    if (targetAdapter?.cdn) {
      for (const w of created) await targetAdapter.cdn.deleteWAFRule(w.targetId);
    }
  },
};

function translateWAFRule(rule: Record<string, unknown>, targetProvider: string): Record<string, unknown> {
  const WAF_CONDITION_MAP: Record<string, Record<string, string>> = {
    azure: {
      "AWSManagedRulesCommonRuleSet": "OWASP_3.2",
      "AWSManagedRulesSQLiRuleSet": "SQLInjection",
      "AWSManagedRulesKnownBadInputsRuleSet": "KnownBadBots",
    },
    gcp: {
      "AWSManagedRulesCommonRuleSet": "owasp-crs-v030301",
      "AWSManagedRulesSQLiRuleSet": "sqli-v33-stable",
      "AWSManagedRulesKnownBadInputsRuleSet": "cve-canary",
    },
  };

  const condition = String(rule.condition ?? "");
  const mapped = WAF_CONDITION_MAP[targetProvider]?.[condition] ?? condition;
  return { ...rule, condition: mapped };
}
