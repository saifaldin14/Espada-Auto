/**
 * Terraform — CLI Commands
 */

import type { Command } from "commander";
import type { TerraformStorage } from "./types.js";
import { parseState, parsePlan, getResourceTypes, getProviderDistribution, buildDependencyGraph } from "./parser.js";
import { createWorkspaceFromInput } from "./storage.js";
import type { CodifyNode } from "./hcl-generator.js";
import { codifyNodes } from "./hcl-generator.js";
import { filterNodes, codifySubgraph, planImportOrder, generateOrderedImports } from "./codify.js";
import * as fs from "node:fs";

export function createTerraformCli(storage: TerraformStorage, ctx?: { graphNodes?: CodifyNode[]; graphEdges?: Array<{ sourceId: string; targetId: string; relationshipType?: string }> }) {
  return (program: Command) => {
    const tf = program.command("terraform").description("Terraform state management and drift detection");

    // ── tf parse ────────────────────────────────────────────────
    tf.command("parse")
      .description("Parse a Terraform state file and show resources")
      .argument("<file>", "Path to terraform.tfstate")
      .option("--json", "Output as JSON")
      .action(async (file: string, opts: { json?: boolean }) => {
        const raw = fs.readFileSync(file, "utf-8");
        const resources = parseState(raw);
        const types = getResourceTypes(resources);
        const providers = getProviderDistribution(resources);

        if (opts.json) {
          console.log(JSON.stringify({ resources, types, providers }, null, 2));
          return;
        }

        console.log(`\nTerraform State: ${file}`);
        console.log(`  Resources: ${resources.length} (${resources.filter((r) => r.mode === "managed").length} managed)`);
        console.log(`  Types: ${types.join(", ")}`);
        console.log(`  Providers: ${Object.entries(providers).map(([k, v]) => `${k}(${v})`).join(", ")}`);
        console.log(`\nResources:`);
        for (const r of resources) {
          console.log(`  ${r.mode === "managed" ? "📦" : "📖"} ${r.address} [${r.providerShort}]`);
          if (r.dependencies.length > 0) console.log(`    deps: ${r.dependencies.join(", ")}`);
        }
      });

    // ── tf plan ─────────────────────────────────────────────────
    tf.command("plan-summary")
      .description("Analyze a Terraform plan JSON")
      .argument("<file>", "Path to plan JSON (from terraform show -json)")
      .option("--json", "Output as JSON")
      .action(async (file: string, opts: { json?: boolean }) => {
        const raw = fs.readFileSync(file, "utf-8");
        const summary = parsePlan(raw);

        if (opts.json) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }

        console.log(`\nPlan Summary:`);
        console.log(`  Creates: ${summary.creates}`);
        console.log(`  Updates: ${summary.updates}`);
        console.log(`  Deletes: ${summary.deletes}`);
        console.log(`  No-ops: ${summary.noOps}`);
        if (summary.hasDestructiveChanges) console.log(`  ⚠ Contains destructive changes!`);
        console.log(`\nAffected resources:`);
        for (const addr of summary.affectedAddresses) {
          console.log(`  - ${addr}`);
        }
      });

    // ── tf deps ─────────────────────────────────────────────────
    tf.command("deps")
      .description("Show dependency graph for state resources")
      .argument("<file>", "Path to terraform.tfstate")
      .action(async (file: string) => {
        const resources = parseState(fs.readFileSync(file, "utf-8"));
        const edges = buildDependencyGraph(resources);
        console.log(`\nDependency Graph (${edges.length} edges):\n`);
        for (const e of edges) {
          console.log(`  ${e.from} → ${e.to}`);
        }
      });

    // ── tf workspaces ───────────────────────────────────────────
    const ws = tf.command("workspace").description("Manage Terraform workspaces");

    ws.command("list")
      .description("List registered workspaces")
      .action(async () => {
        const workspaces = await storage.listWorkspaces();
        if (workspaces.length === 0) { console.log("No workspaces registered."); return; }
        for (const w of workspaces) {
          console.log(`  📂 ${w.name} [${w.id}] — ${w.backend} | ${w.environment} | ${w.resourceCount} resources`);
        }
      });

    ws.command("add")
      .description("Register a workspace")
      .requiredOption("--name <name>", "Workspace name")
      .requiredOption("--state <path>", "State file path")
      .option("--backend <backend>", "Backend type", "local")
      .option("--env <environment>", "Environment", "default")
      .action(async (opts: { name: string; state: string; backend: string; env: string }) => {
        const workspace = createWorkspaceFromInput({
          name: opts.name,
          statePath: opts.state,
          backend: opts.backend,
          environment: opts.env,
        });
        await storage.saveWorkspace(workspace);
        console.log(`Workspace "${workspace.name}" registered with ID: ${workspace.id}`);
      });

    ws.command("remove")
      .description("Remove a workspace")
      .argument("<id>", "Workspace ID")
      .action(async (id: string) => {
        const deleted = await storage.deleteWorkspace(id);
        console.log(deleted ? `Workspace ${id} removed.` : `Workspace ${id} not found.`);
      });

    // ── tf lock ──────────────────────────────────────────────────
    tf.command("lock-status")
      .description("Check state lock status")
      .argument("<stateId>", "State/workspace ID")
      .action(async (stateId: string) => {
        const lock = await storage.getLock(stateId);
        if (lock) {
          console.log(`🔒 Locked by ${lock.lockedBy} at ${lock.lockedAt}`);
          console.log(`   Operation: ${lock.operation}`);
          if (lock.info) console.log(`   Info: ${lock.info}`);
        } else {
          console.log("🔓 Not locked.");
        }
      });

    // ── tf drift-history ─────────────────────────────────────────
    tf.command("drift-history")
      .description("Show drift detection history")
      .argument("<stateId>", "State/workspace ID")
      .option("--limit <n>", "Max results", "5")
      .action(async (stateId: string, opts: { limit: string }) => {
        const history = await storage.getDriftHistory(stateId, parseInt(opts.limit));
        if (history.length === 0) { console.log("No drift history."); return; }
        for (const r of history) {
          console.log(`\n  ${r.detectedAt} — ${r.summary.totalDrifted} drifted / ${r.totalResources} resources`);
        }
      });

    // ── tf codify ────────────────────────────────────────────────
    tf.command("codify")
      .description("Generate Terraform HCL from knowledge-graph nodes")
      .option("--provider <provider>", "Filter by cloud provider")
      .option("--type <resourceType>", "Filter by resource type")
      .option("--region <region>", "Filter by region")
      .option("--tag <tag>", "Filter by tag key")
      .option("--resource <id>", "Root resource ID (subgraph mode)")
      .option("--depth <n>", "Hop depth for subgraph mode", "1")
      .option("--out <file>", "Write HCL to file")
      .action(async (opts: { provider?: string; type?: string; region?: string; tag?: string; resource?: string; depth?: string; out?: string }) => {
        const nodes: CodifyNode[] = ctx?.graphNodes ?? [];
        const edges = ctx?.graphEdges ?? [];
        if (nodes.length === 0) { console.log("No graph nodes available. Populate the knowledge graph first."); return; }

        let result;
        if (opts.resource) {
          result = codifySubgraph(nodes, edges, opts.resource, parseInt(opts.depth ?? "1"));
        } else {
          const filtered = filterNodes(nodes, { provider: opts.provider, resourceType: opts.type, region: opts.region, tag: opts.tag });
          if (filtered.length === 0) { console.log("No nodes match the provided filters."); return; }
          result = codifyNodes(filtered);
        }

        const output = [
          ...result.providerBlocks,
          "",
          result.hclContent,
        ].join("\n");

        if (opts.out) {
          fs.writeFileSync(opts.out, output, "utf-8");
          console.log(`HCL written to ${opts.out} (${result.resources.length} resources)`);
        } else {
          console.log(output);
        }
        console.log(`\n${result.resources.length} resources codified. ${result.importCommands.length} import commands available.`);
      });

    // ── tf import-plan ───────────────────────────────────────────
    tf.command("import-plan")
      .description("Generate terraform import commands in dependency order")
      .option("--provider <provider>", "Filter by cloud provider")
      .option("--type <resourceType>", "Filter by resource type")
      .option("--region <region>", "Filter by region")
      .option("--out <file>", "Write import script to file")
      .action(async (opts: { provider?: string; type?: string; region?: string; out?: string }) => {
        const nodes: CodifyNode[] = ctx?.graphNodes ?? [];
        const edges = ctx?.graphEdges ?? [];
        if (nodes.length === 0) { console.log("No graph nodes available."); return; }

        const filtered = filterNodes(nodes, { provider: opts.provider, resourceType: opts.type, region: opts.region });
        if (filtered.length === 0) { console.log("No nodes match the provided filters."); return; }

        const ordered = planImportOrder(filtered, edges);
        const cmds = generateOrderedImports(ordered, edges);

        const output = [
          "#!/usr/bin/env bash",
          "# Terraform import plan — dependency-ordered",
          `# Generated: ${new Date().toISOString()}`,
          `# Resources: ${cmds.length}`,
          "",
          ...cmds.map((cmd, i) => `# Step ${i + 1}\n${cmd}`),
        ].join("\n");

        if (opts.out) {
          fs.writeFileSync(opts.out, output, "utf-8");
          console.log(`Import plan written to ${opts.out} (${cmds.length} commands)`);
        } else {
          console.log(output);
        }
      });
  };
}
