/**
 * Pulumi CLI commands — espada pulumi preview/up/state/drift.
 */

import type { Command } from "commander";

interface PulumiCliContext {
  program: Command;
}

export function createPulumiCli() {
  return (ctx: PulumiCliContext) => {
    const pulumi = ctx.program.command("pulumi").description("Pulumi infrastructure operations");

    pulumi
      .command("preview")
      .description("Run `pulumi preview` and show change summary")
      .option("--stack <name>", "target stack")
      .option("--cwd <path>", "working directory")
      .action(async (opts: { stack?: string; cwd?: string }) => {
        const { pulumiPreview } = await import("./cli-wrapper.js");
        const { parsePreview } = await import("./state-parser.js");
        try {
          const raw = await pulumiPreview({ stack: opts.stack, cwd: opts.cwd });
          const summary = parsePreview(raw);
          console.log(`\nPulumi Preview Summary:`);
          console.log(`  Creates:  ${summary.creates}`);
          console.log(`  Updates:  ${summary.updates}`);
          console.log(`  Deletes:  ${summary.deletes}`);
          console.log(`  Replaces: ${summary.replaces}`);
          console.log(`  Total:    ${summary.totalChanges} changes\n`);

          if (summary.steps.length > 0) {
            console.log("Steps:");
            for (const step of summary.steps) {
              console.log(`  ${step.action.padEnd(8)} ${step.type} (${step.urn})`);
            }
          }
        } catch (err) {
          console.error("Failed to run pulumi preview:", err);
        }
      });

    pulumi
      .command("up")
      .description("Run `pulumi up --yes` and show results")
      .option("--stack <name>", "target stack")
      .option("--cwd <path>", "working directory")
      .action(async (opts: { stack?: string; cwd?: string }) => {
        const { pulumiUp } = await import("./cli-wrapper.js");
        try {
          const raw = await pulumiUp({ stack: opts.stack, cwd: opts.cwd });
          console.log(raw);
        } catch (err) {
          console.error("Failed to run pulumi up:", err);
        }
      });

    pulumi
      .command("state")
      .description("Export and display Pulumi stack state summary")
      .option("--stack <name>", "target stack")
      .option("--cwd <path>", "working directory")
      .action(async (opts: { stack?: string; cwd?: string }) => {
        const { pulumiStackExport } = await import("./cli-wrapper.js");
        const { parseState, getResourceTypes, getProviderDistribution } = await import("./state-parser.js");
        try {
          const raw = await pulumiStackExport({ stack: opts.stack, cwd: opts.cwd });
          const state = JSON.parse(raw);
          const resources = parseState(state);
          const types = getResourceTypes(resources);
          const providers = getProviderDistribution(resources);

          console.log(`\nPulumi State: ${resources.length} resources`);
          console.log(`  Types: ${types.join(", ")}`);
          console.log(`  Providers:`);
          for (const [p, c] of Object.entries(providers)) {
            console.log(`    ${p}: ${c} resources`);
          }
        } catch (err) {
          console.error("Failed to export stack state:", err);
        }
      });

    pulumi
      .command("stacks")
      .description("List Pulumi stacks")
      .option("--cwd <path>", "working directory")
      .action(async (opts: { cwd?: string }) => {
        const { pulumiStackList } = await import("./cli-wrapper.js");
        try {
          const stacks = await pulumiStackList({ cwd: opts.cwd });
          if (stacks.length === 0) {
            console.log("No stacks found.");
            return;
          }
          console.log("\nPulumi Stacks:");
          for (const s of stacks) {
            const marker = s.current ? " *" : "";
            const count = s.resourceCount ? ` (${s.resourceCount} resources)` : "";
            console.log(`  ${s.name}${marker}${count}`);
          }
        } catch (err) {
          console.error("Failed to list stacks:", err);
        }
      });
  };
}
