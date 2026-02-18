/**
 * Blueprint CLI commands.
 */

import type { Command } from "commander";

export function registerBlueprintCli(program: Command): void {
  const bp = program.command("blueprint").description("Infrastructure blueprint catalog");

  bp.command("list")
    .description("List available blueprints")
    .option("--category <cat>", "Filter by category")
    .option("--provider <p>", "Filter by cloud provider")
    .option("--tag <tag>", "Filter by tag")
    .action(async (opts: { category?: string; provider?: string; tag?: string }) => {
      const { builtInBlueprints, filterBlueprints } = await import("./library.js");
      const results = filterBlueprints(builtInBlueprints, opts);
      if (results.length === 0) {
        console.log("No blueprints match the filter.");
        return;
      }
      for (const bp of results) {
        console.log(
          `  ${bp.id.padEnd(35)} ${bp.name.padEnd(40)} $${bp.estimatedCostRange[0]}–$${bp.estimatedCostRange[1]}/mo`,
        );
      }
    });

  bp.command("show")
    .description("Show blueprint details")
    .argument("<id>", "Blueprint ID")
    .action(async (id: string) => {
      const { getBlueprintById } = await import("./library.js");
      const blueprint = getBlueprintById(id);
      if (!blueprint) {
        console.log(`Blueprint "${id}" not found.`);
        return;
      }
      console.log(`\n${blueprint.name} (${blueprint.id})`);
      console.log(`  ${blueprint.description}`);
      console.log(`  Category:  ${blueprint.category}`);
      console.log(`  Providers: ${blueprint.providers.join(", ")}`);
      console.log(`  Cost:      $${blueprint.estimatedCostRange[0]}–$${blueprint.estimatedCostRange[1]}/mo`);
      console.log(`  Tags:      ${blueprint.tags.join(", ")}`);
      console.log("\n  Parameters:");
      for (const p of blueprint.parameters) {
        const req = p.required ? "(required)" : `(default: ${p.default ?? "none"})`;
        console.log(`    ${p.id}: ${p.name} [${p.type}] ${req}`);
      }
      console.log("\n  Resources:");
      for (const r of blueprint.resources) {
        console.log(`    ${r.type} "${r.name}" (${r.provider})`);
      }
    });

  bp.command("preview")
    .description("Preview a blueprint without deploying")
    .argument("<id>", "Blueprint ID")
    .option("--params <kv...>", "Parameters as key=value pairs")
    .action(async (id: string, opts: { params?: string[] }) => {
      const { getBlueprintById } = await import("./library.js");
      const { preview } = await import("./engine.js");
      const blueprint = getBlueprintById(id);
      if (!blueprint) {
        console.log(`Blueprint "${id}" not found.`);
        return;
      }
      const params = parseKeyValue(opts.params ?? []);
      const result = preview(blueprint, params);

      if (result.validationErrors.length > 0) {
        console.log("\nValidation errors:");
        for (const e of result.validationErrors) {
          console.log(`  ❌ ${e.parameterId}: ${e.message}`);
        }
      }

      console.log("\nResources:");
      for (const r of result.resources) {
        console.log(`  ${r.type} "${r.name}" (${r.provider})`);
      }
      console.log(
        `\nEstimated cost: $${result.estimatedCostRange[0]}–$${result.estimatedCostRange[1]}/mo`,
      );
    });

  bp.command("deploy")
    .description("Deploy a blueprint")
    .argument("<id>", "Blueprint ID")
    .requiredOption("--name <name>", "Instance name")
    .option("--params <kv...>", "Parameters as key=value pairs")
    .action(async (id: string, opts: { name: string; params?: string[] }) => {
      const { getBlueprintById } = await import("./library.js");
      const { validateParameters, InstanceStore } = await import("./engine.js");
      const blueprint = getBlueprintById(id);
      if (!blueprint) {
        console.log(`Blueprint "${id}" not found.`);
        return;
      }
      const params = parseKeyValue(opts.params ?? []);
      const errors = validateParameters(blueprint, params);
      if (errors.length > 0) {
        console.log("Validation failed:");
        for (const e of errors) console.log(`  ❌ ${e.parameterId}: ${e.message}`);
        return;
      }
      const store = new InstanceStore();
      const inst = store.create(blueprint, opts.name, params);
      store.updateStatus(inst.id, "active");
      console.log(`Deployed "${opts.name}" → ${inst.id} (active)`);
    });

  bp.command("instances")
    .description("List deployed instances")
    .action(async () => {
      console.log("No deployed instances (use deploy command to create one).");
    });

  bp.command("destroy")
    .description("Tear down a deployed blueprint instance")
    .argument("<instance-id>", "Instance ID")
    .action(async (instanceId: string) => {
      console.log(`Destroying instance ${instanceId}...`);
    });

  bp.command("create")
    .description("Scaffold a custom blueprint YAML")
    .action(async () => {
      console.log("Use ~/.espada/blueprints/ directory for custom blueprints (YAML format).");
    });
}

function parseKeyValue(pairs: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx);
    const val = pair.slice(eqIdx + 1);
    // Try to parse as number/boolean
    if (val === "true") result[key] = true;
    else if (val === "false") result[key] = false;
    else if (/^\d+(\.\d+)?$/.test(val)) result[key] = parseFloat(val);
    else result[key] = val;
  }
  return result;
}
