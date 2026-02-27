/**
 * Infrastructure Knowledge Graph — CLI Commands
 *
 * Registers `espada graph` CLI subcommands for interacting with the
 * knowledge graph from the terminal.
 */

import type { Command } from "commander";
import type { GraphEngine } from "../core/engine.js";
import type { GraphStorage, CloudProvider } from "../types.js";
import {
  shortestPath,
  findOrphans,
  findSinglePointsOfFailure,
  findCriticalNodes,
  findClusters,
} from "../core/queries.js";
import { exportTopology, type ExportFormat } from "../reporting/export.js";

// =============================================================================
// Types
// =============================================================================

export type CliContext = {
  program: Command;
  config: unknown;
  workspaceDir?: string;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

// =============================================================================
// Helpers
// =============================================================================

/** Simple table formatter for terminal output. */
function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const formatRow = (cells: string[]) =>
    cells.map((c, i) => ` ${(c ?? "").padEnd(widths[i]!)} `).join("│");

  return [formatRow(headers), sep, ...rows.map(formatRow)].join("\n");
}

/** Format cost with dollar sign. */
function fmtCost(cost: number | null | undefined): string {
  return cost != null ? `$${cost.toFixed(2)}` : "—";
}

// =============================================================================
// CLI Registration
// =============================================================================

/**
 * Register `espada graph` CLI commands.
 */
export function registerGraphCli(
  ctx: CliContext,
  engine: GraphEngine,
  storage: GraphStorage,
): void {
  const graph = ctx.program
    .command("graph")
    .description("Infrastructure knowledge graph commands");

  // ---------------------------------------------------------------------------
  // graph status
  // ---------------------------------------------------------------------------
  graph
    .command("status")
    .description("Show graph statistics and health")
    .action(async () => {
      const stats = await engine.getStats();

      console.log("\n📊 Infrastructure Knowledge Graph\n");
      console.log(
        table(
          ["Metric", "Value"],
          [
            ["Nodes", String(stats.totalNodes)],
            ["Edges", String(stats.totalEdges)],
            ["Changes", String(stats.totalChanges)],
            ["Groups", String(stats.totalGroups)],
            ["Monthly Cost", fmtCost(stats.totalCostMonthly)],
            ["Last Sync", stats.lastSyncAt ?? "never"],
          ],
        ),
      );

      if (Object.keys(stats.nodesByProvider).length > 0) {
        console.log("\nBy Provider:");
        console.log(
          table(
            ["Provider", "Nodes"],
            Object.entries(stats.nodesByProvider)
              .sort(([, a], [, b]) => b - a)
              .map(([p, c]) => [p, String(c)]),
          ),
        );
      }

      if (Object.keys(stats.nodesByResourceType).length > 0) {
        console.log("\nBy Resource Type:");
        console.log(
          table(
            ["Type", "Count"],
            Object.entries(stats.nodesByResourceType)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 15)
              .map(([t, c]) => [t, String(c)]),
          ),
        );
      }
    });

  // ---------------------------------------------------------------------------
  // graph sync
  // ---------------------------------------------------------------------------
  graph
    .command("sync")
    .description("Run full infrastructure discovery sync")
    .option("--provider <provider>", "Sync only a specific provider")
    .action(async (opts: { provider?: string }) => {
      console.log("Starting infrastructure sync...\n");

      const results = await engine.sync(
        opts.provider
          ? { providers: [opts.provider as CloudProvider] }
          : undefined,
      );

      // Aggregate across all provider sync records
      const totals = results.reduce(
        (acc, r) => ({
          nodesDiscovered: acc.nodesDiscovered + r.nodesDiscovered,
          nodesCreated: acc.nodesCreated + r.nodesCreated,
          nodesUpdated: acc.nodesUpdated + r.nodesUpdated,
          edgesDiscovered: acc.edgesDiscovered + r.edgesDiscovered,
          edgesCreated: acc.edgesCreated + r.edgesCreated,
          durationMs: acc.durationMs + (r.durationMs ?? 0),
        }),
        { nodesDiscovered: 0, nodesCreated: 0, nodesUpdated: 0, edgesDiscovered: 0, edgesCreated: 0, durationMs: 0 },
      );

      console.log(
        table(
          ["Metric", "Count"],
          [
            ["Nodes Discovered", String(totals.nodesDiscovered)],
            ["Nodes Created", String(totals.nodesCreated)],
            ["Nodes Updated", String(totals.nodesUpdated)],
            ["Edges Discovered", String(totals.edgesDiscovered)],
            ["Edges Created", String(totals.edgesCreated)],
            ["Duration", `${totals.durationMs}ms`],
          ],
        ),
      );
    });

  // ---------------------------------------------------------------------------
  // graph blast <resource>
  // ---------------------------------------------------------------------------
  graph
    .command("blast")
    .description("Show blast radius for a resource")
    .argument("<resourceId>", "Resource node ID")
    .option("-d, --depth <n>", "Max traversal depth", "3")
    .action(async (resourceId: string, opts: { depth: string }) => {
      const depth = Math.min(parseInt(opts.depth, 10), 8);
      const result = await engine.getBlastRadius(resourceId, depth);
      const nodes = [...result.nodes.values()];

      console.log(`\nBlast Radius: ${resourceId}`);
      console.log(`Affected: ${nodes.length} resources | Cost at risk: ${fmtCost(result.totalCostMonthly)}/mo\n`);

      if (nodes.length > 0) {
        console.log(
          table(
            ["Resource", "Type", "Provider", "Hop", "Cost/mo"],
            nodes.map((n) => {
              const hop = [...result.hops.entries()].find(([, ids]) => ids.includes(n.id))?.[0] ?? "?";
              return [n.name, n.resourceType, n.provider, String(hop), fmtCost(n.costMonthly)];
            }),
          ),
        );
      }
    });

  // ---------------------------------------------------------------------------
  // graph deps <resource>
  // ---------------------------------------------------------------------------
  graph
    .command("deps")
    .description("Show dependency chain for a resource")
    .argument("<resourceId>", "Resource node ID")
    .option("-d, --direction <dir>", "upstream, downstream, or both", "upstream")
    .option("--depth <n>", "Max traversal depth", "3")
    .action(async (resourceId: string, opts: { direction: string; depth: string }) => {
      const direction = opts.direction as "upstream" | "downstream" | "both";
      const depth = parseInt(opts.depth, 10);

      const result = await engine.getDependencyChain(resourceId, direction, depth);
      const nodes = [...result.nodes.values()];

      console.log(`\n${direction} dependencies of ${resourceId}: ${nodes.length} resources\n`);

      if (nodes.length > 0) {
        console.log(
          table(
            ["Resource", "Type", "Provider", "Region"],
            nodes.map((n) => [n.name, n.resourceType, n.provider, n.region]),
          ),
        );

        console.log("\nEdges:");
        for (const e of result.edges) {
          console.log(`  ${e.sourceNodeId} --[${e.relationshipType}]--> ${e.targetNodeId}`);
        }
      }
    });

  // ---------------------------------------------------------------------------
  // graph orphans
  // ---------------------------------------------------------------------------
  graph
    .command("orphans")
    .description("List unconnected resources (cleanup candidates)")
    .action(async () => {
      const orphans = await findOrphans(storage);

      if (orphans.length === 0) {
        console.log("\nNo orphaned resources found.");
        return;
      }

      const totalCost = orphans.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);
      console.log(`\n${orphans.length} orphaned resources (potential savings: ${fmtCost(totalCost)}/mo)\n`);

      console.log(
        table(
          ["Resource", "Type", "Provider", "Region", "Status", "Cost/mo"],
          orphans.map((n) => [n.name, n.resourceType, n.provider, n.region, n.status, fmtCost(n.costMonthly)]),
        ),
      );
    });

  // ---------------------------------------------------------------------------
  // graph spofs
  // ---------------------------------------------------------------------------
  graph
    .command("spofs")
    .description("Find single points of failure")
    .action(async () => {
      const spofs = await findSinglePointsOfFailure(storage);

      if (spofs.length === 0) {
        console.log("\nNo single points of failure detected.");
        return;
      }

      console.log(`\n${spofs.length} single points of failure:\n`);

      const enriched = spofs.map((node) => [
        node.name,
        node.resourceType,
        node.provider,
        node.region,
      ]);

      console.log(table(["Resource", "Type", "Provider", "Region"], enriched));
    });

  // ---------------------------------------------------------------------------
  // graph cost
  // ---------------------------------------------------------------------------
  graph
    .command("cost")
    .description("Cost attribution breakdown")
    .option("--group <groupId>", "Group ID for aggregate cost")
    .option("--provider <provider>", "Filter by provider")
    .option("--top <n>", "Show top N resources", "20")
    .action(async (opts: { group?: string; provider?: string; top: string }) => {
      let cost;
      if (opts.group) {
        cost = await engine.getGroupCost(opts.group);
      } else if (opts.provider) {
        cost = await engine.getCostByFilter(
          { provider: opts.provider as CloudProvider },
          `Provider: ${opts.provider}`,
        );
      } else {
        cost = await engine.getCostByFilter({}, "All Infrastructure");
      }

      const topN = parseInt(opts.top, 10);

      console.log(`\nCost: ${cost.label} — Total: ${fmtCost(cost.totalMonthly)}/mo\n`);

      if (Object.keys(cost.byResourceType).length > 0) {
        console.log("By Resource Type:");
        console.log(
          table(
            ["Type", "Cost/mo"],
            Object.entries(cost.byResourceType)
              .sort(([, a], [, b]) => b - a)
              .map(([t, c]) => [t, fmtCost(c)]),
          ),
        );
      }

      if (cost.nodes.length > 0) {
        console.log(`\nTop ${Math.min(topN, cost.nodes.length)} resources:`);
        console.log(
          table(
            ["Resource", "Type", "Cost/mo"],
            cost.nodes
              .sort((a, b) => b.costMonthly - a.costMonthly)
              .slice(0, topN)
              .map((n) => [n.name, n.resourceType, fmtCost(n.costMonthly)]),
          ),
        );
      }
    });

  // ---------------------------------------------------------------------------
  // graph drift
  // ---------------------------------------------------------------------------
  graph
    .command("drift")
    .description("Detect configuration drift")
    .option("--provider <provider>", "Filter to a specific provider")
    .action(async (opts: { provider?: string }) => {
      const drift = await engine.detectDrift(opts.provider as CloudProvider | undefined);

      console.log(`\nDrift Report (scanned: ${drift.scannedAt})\n`);
      console.log(`  Drifted:      ${drift.driftedNodes.length}`);
      console.log(`  Disappeared:  ${drift.disappearedNodes.length}`);
      console.log(`  New:          ${drift.newNodes.length}`);

      if (drift.driftedNodes.length > 0) {
        console.log("\nDrifted Resources:");
        for (const { node, changes } of drift.driftedNodes) {
          console.log(`  ${node.name} (${node.resourceType}):`);
          for (const c of changes) {
            console.log(`    ${c.field}: ${c.previousValue} → ${c.newValue}`);
          }
        }
      }

      if (drift.disappearedNodes.length > 0) {
        console.log("\nDisappeared:");
        console.log(
          table(
            ["Resource", "Type", "Provider"],
            drift.disappearedNodes.map((n) => [n.name, n.resourceType, n.provider]),
          ),
        );
      }
    });

  // ---------------------------------------------------------------------------
  // graph path <from> <to>
  // ---------------------------------------------------------------------------
  graph
    .command("path")
    .description("Find shortest path between two resources")
    .argument("<from>", "Source resource ID")
    .argument("<to>", "Target resource ID")
    .action(async (from: string, to: string) => {
      const result = await shortestPath(storage, from, to);

      if (!result) {
        console.log(`\nNo path found between ${from} and ${to}.`);
        return;
      }

      console.log(`\nShortest path (${result.hops} hops):\n`);

      for (let i = 0; i < result.path.length; i++) {
        const node = await storage.getNode(result.path[i]!);
        const name = node?.name ?? result.path[i]!;
        console.log(`  ${i === 0 ? "📍" : i === result.path.length - 1 ? "🎯" : "  "} ${name}`);

        if (i < result.edges.length) {
          console.log(`     ↓ [${result.edges[i]!.relationshipType}]`);
        }
      }
    });

  // ---------------------------------------------------------------------------
  // graph clusters
  // ---------------------------------------------------------------------------
  graph
    .command("clusters")
    .description("Find connected resource clusters")
    .action(async () => {
      const result = await findClusters(storage);

      console.log(`\n${result.clusters.length} connected cluster(s):\n`);

      for (let i = 0; i < result.clusters.length; i++) {
        const cluster = result.clusters[i]!;
        console.log(`Cluster ${i + 1}: ${cluster.length} nodes`);

        // Show first few members
        const preview = cluster.slice(0, 5);
        const enriched = await Promise.all(
          preview.map(async (id) => {
            const node = await storage.getNode(id);
            return node ? `${node.name} (${node.resourceType})` : id;
          }),
        );

        for (const desc of enriched) {
          console.log(`  - ${desc}`);
        }
        if (cluster.length > 5) {
          console.log(`  ... and ${cluster.length - 5} more`);
        }
        console.log();
      }

      if (result.isolatedNodes.length > 0) {
        console.log(`${result.isolatedNodes.length} isolated node(s)`);
      }
    });

  // ---------------------------------------------------------------------------
  // graph critical
  // ---------------------------------------------------------------------------
  graph
    .command("critical")
    .description("Find critical nodes (high fan-in/fan-out)")
    .option("--top <n>", "Show top N critical nodes", "10")
    .action(async (opts: { top: string }) => {
      const topN = parseInt(opts.top, 10);
      const critical = await findCriticalNodes(storage, undefined, topN);

      if (critical.length === 0) {
        console.log("\nNo critical nodes found.");
        return;
      }

      console.log(`\nTop ${critical.length} Critical Nodes:\n`);
      console.log(
        table(
          ["Resource", "Type", "In-Degree", "Out-Degree", "Reachability"],
          critical.map((c) => [
            c.node.name,
            c.node.resourceType,
            String(c.inDegree),
            String(c.outDegree),
            c.reachabilityRatio.toFixed(2),
          ]),
        ),
      );
    });

  // ---------------------------------------------------------------------------
  // graph export
  // ---------------------------------------------------------------------------
  graph
    .command("export")
    .description("Export topology as JSON, DOT, or Mermaid")
    .option("-f, --format <format>", "Export format: json, dot, mermaid", "json")
    .option("--provider <provider>", "Filter by provider")
    .option("--no-cost", "Exclude cost data")
    .action(async (opts: { format: string; provider?: string; cost: boolean }) => {
      const format = opts.format as ExportFormat;
      const filter = opts.provider
        ? { provider: opts.provider as CloudProvider }
        : {};

      const result = await exportTopology(storage, format, {
        filter,
        includeCost: opts.cost,
      });

      console.log(result.content);
      console.error(`\nExported ${result.nodeCount} nodes, ${result.edgeCount} edges (${format})`);
    });

  // ---------------------------------------------------------------------------
  // graph timeline <resource>
  // ---------------------------------------------------------------------------
  graph
    .command("timeline")
    .description("Show change timeline for a resource")
    .argument("<resourceId>", "Resource node ID")
    .option("--limit <n>", "Max changes to show", "20")
    .action(async (resourceId: string, opts: { limit: string }) => {
      const limit = parseInt(opts.limit, 10);
      const changes = await engine.getTimeline(resourceId, limit);

      if (changes.length === 0) {
        console.log(`\nNo changes recorded for ${resourceId}.`);
        return;
      }

      const node = await storage.getNode(resourceId);
      console.log(`\nTimeline: ${node?.name ?? resourceId} (${changes.length} changes)\n`);

      console.log(
        table(
          ["Time", "Change", "Field", "Previous", "New"],
          changes.map((c) => [
            c.detectedAt,
            c.changeType,
            c.field ?? "—",
            c.previousValue ?? "—",
            c.newValue ?? "—",
          ]),
        ),
      );
    });
}
