#!/usr/bin/env npx tsx
/**
 * Live AWS Discovery Script
 *
 * Runs the Espada knowledge-graph engine against a real AWS account,
 * discovers all infrastructure resources, builds the graph, and
 * prints a full inventory report.
 *
 * Usage: npx tsx scripts/live-aws-discovery.ts
 */

import { GraphEngine } from "../extensions/knowledge-graph/src/core/engine.js";
import { InMemoryGraphStorage } from "../extensions/knowledge-graph/src/storage/index.js";
import { AwsDiscoveryAdapter } from "../extensions/knowledge-graph/src/adapters/aws.js";
import { findOrphans, findCriticalNodes, findClusters } from "../extensions/knowledge-graph/src/core/queries.js";
import type { GraphNode } from "../extensions/knowledge-graph/src/types.js";

// ─── Configuration ───────────────────────────────────────────────────────────
const AWS_ACCOUNT_ID = "187093629249";
const AWS_REGIONS = ["us-east-1"];
const ENABLE_COST_EXPLORER = true;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function banner(text: string) {
  const line = "═".repeat(70);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) { console.log("  (none)"); return; }
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)));
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join(" │ ");
  const sep = widths.map((w) => "─".repeat(w)).join("─┼─");
  console.log(`  ${header}`);
  console.log(`  ${sep}`);
  for (const row of rows) {
    const line = keys.map((k, i) => String(row[k] ?? "").padEnd(widths[i]!)).join(" │ ");
    console.log(`  ${line}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();

  banner("ESPADA — Live AWS Infrastructure Discovery");
  console.log(`  Account:  ${AWS_ACCOUNT_ID}`);
  console.log(`  Regions:  ${AWS_REGIONS.join(", ")}`);
  console.log(`  Time:     ${new Date().toISOString()}`);

  // 1. Create the AWS adapter (live — no mock clientFactory)
  console.log("\n  [1/4] Creating AWS adapter (live credentials)...");
  const awsAdapter = new AwsDiscoveryAdapter({
    accountId: AWS_ACCOUNT_ID,
    regions: AWS_REGIONS,
    enableCostExplorer: ENABLE_COST_EXPLORER,
  });

  // 2. Create the graph engine with in-memory storage
  console.log("  [2/4] Initializing knowledge-graph engine...");
  const storage = new InMemoryGraphStorage();
  await storage.initialize();

  const engine = new GraphEngine({
    storage,
    config: {
      enableDriftDetection: true,
      pruneOrphanedEdges: true,
    },
  });
  engine.registerAdapter(awsAdapter);

  // 3. Run full discovery sync
  console.log("  [3/4] Running full discovery sync...\n");
  const syncRecords = await engine.sync({
    discoverOptions: {
      regions: AWS_REGIONS,
    },
  });

  for (const rec of syncRecords) {
    banner(`Sync Result — ${rec.provider.toUpperCase()}`);
    console.log(`  Status:           ${rec.status}`);
    console.log(`  Duration:         ${rec.durationMs ?? 0}ms`);
    console.log(`  Nodes discovered: ${rec.nodesDiscovered}`);
    console.log(`  Nodes created:    ${rec.nodesCreated}`);
    console.log(`  Nodes updated:    ${rec.nodesUpdated}`);
    console.log(`  Nodes disappeared:${rec.nodesDisappeared}`);
    console.log(`  Edges discovered: ${rec.edgesDiscovered}`);
    console.log(`  Edges created:    ${rec.edgesCreated}`);
    console.log(`  Edges removed:    ${rec.edgesRemoved}`);
    console.log(`  Changes recorded: ${rec.changesRecorded}`);
    if (rec.errors.length > 0) {
      console.log(`  Errors (${rec.errors.length}):`);
      for (const err of rec.errors.slice(0, 20)) {
        console.log(`    ⚠ ${err}`);
      }
      if (rec.errors.length > 20) console.log(`    ... and ${rec.errors.length - 20} more`);
    }
  }

  // 4. Query and display results
  console.log("  [4/4] Analyzing graph...\n");
  const stats = await engine.getStats();

  banner("Graph Statistics");
  console.log(`  Total nodes:   ${stats.totalNodes}`);
  console.log(`  Total edges:   ${stats.totalEdges}`);
  console.log(`  Total changes: ${stats.totalChanges}`);
  console.log(`  Providers:     ${Object.keys(stats.nodesByProvider).join(", ") || "N/A"}`);  
  console.log(`  Monthly cost:  $${stats.totalCostMonthly.toFixed(2)}`);  
  if (Object.keys(stats.nodesByProvider).length > 0) {
    console.log(`  Nodes by provider:`);
    for (const [p, count] of Object.entries(stats.nodesByProvider)) {
      console.log(`    ${p}: ${count}`);
    }
  }

  // ── Resource Inventory by Type ──
  banner("Resource Inventory by Type");
  const allNodes = await storage.queryNodes({});
  const byType = new Map<string, GraphNode[]>();
  for (const node of allNodes) {
    const list = byType.get(node.resourceType) ?? [];
    list.push(node);
    byType.set(node.resourceType, list);
  }
  const typeRows = [...byType.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([type, nodes]) => ({
      Type: type,
      Count: nodes.length,
      "Monthly Cost": `$${nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0).toFixed(2)}`,
    }));
  table(typeRows);

  // ── Resource Inventory by Region ──
  banner("Resource Inventory by Region");
  const byRegion = new Map<string, number>();
  for (const node of allNodes) {
    byRegion.set(node.region, (byRegion.get(node.region) ?? 0) + 1);
  }
  const regionRows = [...byRegion.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([region, count]) => ({ Region: region, Resources: count }));
  table(regionRows);

  // ── Resource Inventory by Status ──
  banner("Resource Status Summary");
  const byStatus = new Map<string, number>();
  for (const node of allNodes) {
    byStatus.set(node.status, (byStatus.get(node.status) ?? 0) + 1);
  }
  const statusRows = [...byStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ Status: status, Count: count }));
  table(statusRows);

  // ── Detailed Resource List ──
  banner("All Discovered Resources");
  const detailRows = allNodes
    .sort((a, b) => a.resourceType.localeCompare(b.resourceType))
    .map((n) => ({
      Name: n.name.slice(0, 40),
      Type: n.resourceType,
      Region: n.region,
      Status: n.status,
      Cost: n.costMonthly != null ? `$${n.costMonthly.toFixed(2)}` : "—",
      Owner: n.owner ?? "—",
    }));
  table(detailRows);

  // ── Relationships ──
  banner("Relationship Summary");
  const allEdges = await storage.queryEdges({});
  const byRelType = new Map<string, number>();
  for (const edge of allEdges) {
    const rt = edge.relationshipType;
    byRelType.set(rt, (byRelType.get(rt) ?? 0) + 1);
  }
  const relRows = [...byRelType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ Relationship: type, Count: count }));
  table(relRows);

  // ── Top 10 Most Connected Resources ──
  banner("Top 10 Most Connected Resources (Critical Nodes)");
  const edgeCounts = new Map<string, number>();
  for (const edge of allEdges) {
    edgeCounts.set(edge.sourceNodeId, (edgeCounts.get(edge.sourceNodeId) ?? 0) + 1);
    edgeCounts.set(edge.targetNodeId, (edgeCounts.get(edge.targetNodeId) ?? 0) + 1);
  }
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const topConnected = [...edgeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => {
      const node = nodeMap.get(id);
      return {
        Name: node?.name.slice(0, 35) ?? id.slice(0, 35),
        Type: node?.resourceType ?? "?",
        Connections: count,
      };
    });
  table(topConnected);

  // ── Cost Summary ──
  banner("Cost Summary");
  const totalCost = allNodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);
  console.log(`  Total estimated monthly cost: $${totalCost.toFixed(2)}`);
  const costByType = [...byType.entries()]
    .map(([type, nodes]) => ({
      type,
      cost: nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0),
    }))
    .filter((r) => r.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  if (costByType.length > 0) {
    console.log("\n  Cost breakdown by resource type:");
    table(costByType.map((r) => ({
      Type: r.type,
      "Monthly Cost": `$${r.cost.toFixed(2)}`,
      "% of Total": totalCost > 0 ? `${((r.cost / totalCost) * 100).toFixed(1)}%` : "—",
    })));
  }

  // ── Graph Analysis ──
  banner("Graph Analysis");

  // Orphans (resources with no connections)
  const orphans = await findOrphans(storage);
  console.log(`  Orphaned resources (no connections): ${orphans.length}`);
  if (orphans.length > 0) {
    for (const orphan of orphans.slice(0, 5)) {
      console.log(`    - ${orphan.name} (${orphan.resourceType})`);
    }
    if (orphans.length > 5) console.log(`    ... and ${orphans.length - 5} more`);
  }

  // Clusters
  const clusterResult = await findClusters(storage);
  console.log(`  Resource clusters: ${clusterResult.totalClusters}`);
  for (const cluster of clusterResult.clusters.slice(0, 5)) {
    console.log(`    - Cluster (${cluster.length} nodes): ${cluster.slice(0, 3).map((id) => nodeMap.get(id)?.name ?? id).join(", ")}${cluster.length > 3 ? "..." : ""}`);
  }
  if (clusterResult.isolatedNodes.length > 0) {
    console.log(`  Isolated nodes: ${clusterResult.isolatedNodes.length}`);
  }

  // Critical nodes (high degree + reachability)
  if (allNodes.length > 0) {
    const criticals = await findCriticalNodes(storage, undefined, 5);
    if (criticals.length > 0) {
      console.log(`\n  Critical nodes (highest degree × reachability):`);
      table(criticals.map((c) => ({
        Name: c.node.name.slice(0, 35),
        Type: c.node.resourceType,
        Degree: c.degree,
        "In/Out": `${c.inDegree}/${c.outDegree}`,
        Reachability: `${(c.reachabilityRatio * 100).toFixed(1)}%`,
      })));
    }
  }

  // ── Final Summary ──
  banner("Discovery Complete");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  Total time:    ${elapsed}s`);
  console.log(`  Resources:     ${allNodes.length}`);
  console.log(`  Relationships: ${allEdges.length}`);
  console.log(`  Monthly cost:  $${totalCost.toFixed(2)}`);
  console.log(`  Regions:       ${AWS_REGIONS.join(", ")}`);
  console.log(`  Account:       ${AWS_ACCOUNT_ID}`);
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
