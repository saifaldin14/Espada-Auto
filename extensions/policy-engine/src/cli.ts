/**
 * Policy Engine — CLI Commands
 *
 * Commands: policy list, add, remove, test, evaluate, scan, library, library-import
 */

import type { Command } from "commander";
import type { PolicyStorage, ResourceInput } from "./types.js";
import { PolicyEvaluationEngine } from "./engine.js";
import { createPolicyFromInput } from "./storage.js";
import { getLibraryPolicies, getLibraryPolicy, getLibraryCategories } from "./library.js";
import { buildResourcePolicyInput } from "./integration.js";

export type CliContext = {
  program: Command;
  config: unknown;
  workspaceDir?: string;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

export function createPolicyCli(storage: PolicyStorage) {
  return (ctx: CliContext) => {
    const policy = ctx.program.command("policy").description("Policy-as-Code engine — evaluate and manage infrastructure policies");

    // ── policy list ─────────────────────────────────────────────
    policy
      .command("list")
      .description("List all policies")
      .option("-t, --type <type>", "Filter by type")
      .option("-s, --severity <severity>", "Filter by severity")
      .option("--enabled", "Show only enabled")
      .option("--disabled", "Show only disabled")
      .option("--json", "Output as JSON")
      .action(async (opts: { type?: string; severity?: string; enabled?: boolean; disabled?: boolean; json?: boolean }) => {
        const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
        const policies = await storage.list({ type: opts.type, severity: opts.severity, enabled });

        if (opts.json) {
          console.log(JSON.stringify(policies, null, 2));
          return;
        }

        if (policies.length === 0) {
          console.log("No policies found. Use 'policy library' to browse built-in templates.");
          return;
        }

        console.log(`\nPolicies (${policies.length}):\n`);
        for (const p of policies) {
          const status = p.enabled ? "✓" : "✗";
          const sevBadge = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢", info: "🔵" }[p.severity] ?? "⚪";
          console.log(`  ${status} ${p.name} [${p.id}]`);
          console.log(`    ${sevBadge} ${p.severity} | type: ${p.type} | rules: ${p.rules.length}`);
          if (p.labels.length > 0) console.log(`    labels: ${p.labels.join(", ")}`);
          console.log();
        }
      });

    // ── policy add ──────────────────────────────────────────────
    policy
      .command("add")
      .description("Add a policy from a JSON file")
      .argument("<file>", "Path to policy JSON file")
      .action(async (file: string) => {
        const fs = await import("node:fs");
        const content = fs.readFileSync(file, "utf-8");
        const input = JSON.parse(content);
        const p = createPolicyFromInput(input);
        await storage.save(p);
        console.log(`Policy "${p.name}" saved with ID: ${p.id}`);
      });

    // ── policy remove ───────────────────────────────────────────
    policy
      .command("remove")
      .description("Remove a policy by ID")
      .argument("<id>", "Policy ID")
      .action(async (id: string) => {
        const deleted = await storage.delete(id);
        if (deleted) console.log(`Policy ${id} removed.`);
        else console.log(`Policy ${id} not found.`);
      });

    // ── policy show ─────────────────────────────────────────────
    policy
      .command("show")
      .description("Show a policy by ID")
      .argument("<id>", "Policy ID")
      .action(async (id: string) => {
        const p = await storage.getById(id);
        if (!p) {
          console.log(`Policy ${id} not found.`);
          return;
        }
        console.log(JSON.stringify(p, null, 2));
      });

    // ── policy test ─────────────────────────────────────────────
    policy
      .command("test")
      .description("Test a policy against sample input JSON")
      .argument("<policyId>", "Policy ID to test")
      .argument("<inputFile>", "Path to evaluation input JSON")
      .action(async (policyId: string, inputFile: string) => {
        const p = await storage.getById(policyId);
        if (!p) {
          console.error(`Policy ${policyId} not found.`);
          process.exitCode = 1;
          return;
        }

        const fs = await import("node:fs");
        const evalInput = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
        const engine = new PolicyEvaluationEngine();
        const result = engine.evaluate(p, evalInput);

        console.log(`\nPolicy: ${p.name}`);
        console.log(`Result: ${result.allowed ? "ALLOWED ✓" : "DENIED ✗"}`);
        if (result.denials.length > 0) {
          console.log(`\nDenials:`);
          result.denials.forEach((d) => console.log(`  ✗ ${d}`));
        }
        if (result.warnings.length > 0) {
          console.log(`\nWarnings:`);
          result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
        }
        if (result.approvalRequired) console.log("\n🔒 Approval required");
        console.log(`\nRules evaluated: ${result.evaluatedRules.length}`);
        console.log(`Duration: ${result.durationMs}ms`);
      });

    // ── policy evaluate ─────────────────────────────────────────
    policy
      .command("evaluate")
      .description("Evaluate a resource against all policies")
      .requiredOption("--id <resourceId>", "Resource ID")
      .requiredOption("--type <resourceType>", "Resource type")
      .requiredOption("--provider <provider>", "Cloud provider")
      .option("--region <region>", "Region")
      .option("--env <environment>", "Environment name")
      .option("--tag <tags...>", "Tags as key=value pairs")
      .option("--json", "Output as JSON")
      .action(
        async (opts: {
          id: string;
          type: string;
          provider: string;
          region?: string;
          env?: string;
          tag?: string[];
          json?: boolean;
        }) => {
          const tags: Record<string, string> = {};
          for (const t of opts.tag ?? []) {
            const [k, ...v] = t.split("=");
            tags[k] = v.join("=");
          }

          const policies = await storage.list({ enabled: true });
          const engine = new PolicyEvaluationEngine();
          const input = buildResourcePolicyInput({
            id: opts.id,
            type: opts.type,
            provider: opts.provider,
            region: opts.region,
            tags,
            environment: opts.env,
          });

          const result = engine.evaluateAll(policies, input);

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          console.log(`\nEvaluation: ${result.allowed ? "ALLOWED ✓" : "DENIED ✗"}`);
          console.log(`Policies: ${result.passedPolicies}/${result.totalPolicies} passed`);
          if (result.denials.length > 0) result.denials.forEach((d) => console.log(`  ✗ ${d}`));
          if (result.warnings.length > 0) result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
          if (result.approvalRequired) console.log("🔒 Approval required");
        },
      );

    // ── policy scan ─────────────────────────────────────────────
    policy
      .command("scan")
      .description("Scan resources from JSON file against all policies")
      .argument("<file>", "Path to resources JSON file")
      .option("--severity <severity>", "Minimum severity filter")
      .option("--json", "Output as JSON")
      .action(async (file: string, opts: { severity?: string; json?: boolean }) => {
        const fs = await import("node:fs");
        const resources: ResourceInput[] = JSON.parse(fs.readFileSync(file, "utf-8"));
        const policies = await storage.list({ enabled: true });
        const engine = new PolicyEvaluationEngine();

        let violations = engine.scanResources(policies, resources);

        if (opts.severity) {
          const order = { low: 0, medium: 1, high: 2, critical: 3 };
          const min = order[opts.severity as keyof typeof order] ?? 0;
          violations = violations.filter((v) => (order[v.severity as keyof typeof order] ?? 0) >= min);
        }

        if (opts.json) {
          console.log(JSON.stringify(violations, null, 2));
          return;
        }

        if (violations.length === 0) {
          console.log("✓ No policy violations found.");
          return;
        }

        console.log(`\n${violations.length} violation(s) found:\n`);
        for (const v of violations) {
          const badge = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢", info: "🔵" }[v.severity] ?? "⚪";
          console.log(`  ${badge} [${v.severity}] ${v.policyName}`);
          console.log(`    Resource: ${v.resourceType} (${v.resourceId})`);
          console.log(`    ${v.message}`);
          console.log();
        }
      });

    // ── policy library ──────────────────────────────────────────
    policy
      .command("library")
      .description("Browse built-in policy templates")
      .option("--category <category>", "Filter by category")
      .option("--json", "Output as JSON")
      .action(async (opts: { category?: string; json?: boolean }) => {
        let templates = getLibraryPolicies();
        if (opts.category) templates = templates.filter((t) => t.category === opts.category);

        if (opts.json) {
          console.log(JSON.stringify(templates, null, 2));
          return;
        }

        const categories = getLibraryCategories();
        console.log(`\nPolicy Library (${templates.length} templates, categories: ${categories.join(", ")})\n`);
        for (const t of templates) {
          console.log(`  📋 ${t.name} [${t.id}]`);
          console.log(`    ${t.description}`);
          console.log(`    category: ${t.category} | rules: ${t.template.rules.length}`);
          console.log();
        }
      });

    // ── policy library-import ───────────────────────────────────
    policy
      .command("library-import")
      .description("Import a policy from the built-in library")
      .argument("<templateId>", "Library template ID")
      .option("--id <customId>", "Override policy ID")
      .action(async (templateId: string, opts: { id?: string }) => {
        const template = getLibraryPolicy(templateId);
        if (!template) {
          console.error(`Template "${templateId}" not found. Use 'policy library' to list available templates.`);
          process.exitCode = 1;
          return;
        }

        const input = { ...template.template };
        if (opts.id) input.id = opts.id;
        const p = createPolicyFromInput(input);
        await storage.save(p);
        console.log(`Imported "${p.name}" with ID: ${p.id}`);
      });
  };
}
