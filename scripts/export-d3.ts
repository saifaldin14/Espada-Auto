/**
 * Run Espada's native exportVisualization to produce D3 force-graph JSON
 * and optionally build a self-contained interactive HTML visualization.
 *
 * Usage:
 *   npx tsx scripts/export-d3.ts [--db <path>] [--layout <strategy>] [--html <output.html>] [--enterprise]
 *
 * Without --html: prints D3 JSON to stdout.
 * With --html:    embeds JSON into the D3 viz template and writes an HTML file.
 * With --enterprise: uses the enterprise-grade template with drill-down, WebGL canvas,
 *                    filtering, multi-view dashboard, semantic zoom, and edge bundling.
 */
import { SQLiteGraphStorage } from "../extensions/knowledge-graph/src/storage/index.js";
import { exportVisualization } from "../extensions/knowledge-graph/src/analysis/visualization.js";
import { resolve, dirname } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
function hasFlag(name: string): boolean {
  return args.includes(name);
}

const dbPath = resolve(flag("--db", resolve(process.env.HOME!, ".espada/knowledge-graph.db")));
const layout = flag("--layout", "force-directed") as
  | "force-directed"
  | "hierarchical"
  | "circular"
  | "grid"
  | "concentric";
const htmlOut = hasFlag("--html") ? resolve(flag("--html", "/tmp/espada-infra-d3.html")) : null;
const enterprise = hasFlag("--enterprise");

const storage = new SQLiteGraphStorage(dbPath);
await storage.initialize();

const result = await exportVisualization(storage, "d3-force", {
  layout,
  includeMetadata: true,
  includeCost: true,
  groupByProvider: true,
});

if (htmlOut) {
  const templateFile = enterprise ? "d3-viz-enterprise.html" : "d3-viz-template.html";
  const template = readFileSync(resolve(__dirname, templateFile), "utf-8");
  const html = template.replace("GRAPH_DATA_PLACEHOLDER", result.content);
  writeFileSync(htmlOut, html, "utf-8");
  const mode = enterprise ? "enterprise" : "standard";
  console.error(`✓ Written ${mode} D3 visualization to ${htmlOut}`);
  console.error(`  ${result.nodeCount} nodes, ${result.edgeCount} edges (layout: ${layout})`);
} else {
  console.log(result.content);
  console.error(
    `\n✓ Exported ${result.nodeCount} nodes, ${result.edgeCount} edges (d3-force, layout: ${layout})`,
  );
}

await storage.close();
