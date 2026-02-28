/**
 * Run Espada's native exportVisualization to produce D3 force-graph JSON
 * from the live-scanned knowledge graph SQLite database.
 *
 * Usage: npx tsx scripts/export-d3.ts [--db <path>] [--layout <strategy>]
 */
import { SQLiteGraphStorage } from "../extensions/knowledge-graph/src/storage/index.js";
import { exportVisualization } from "../extensions/knowledge-graph/src/analysis/visualization.js";
import { resolve } from "node:path";

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const dbPath = resolve(flag("--db", resolve(process.env.HOME!, ".espada/knowledge-graph.db")));
const layout = flag("--layout", "force-directed") as
  | "force-directed"
  | "hierarchical"
  | "circular"
  | "grid"
  | "concentric";

const storage = new SQLiteGraphStorage(dbPath);
await storage.initialize();

const result = await exportVisualization(storage, "d3-force", {
  layout,
  includeMetadata: true,
  includeCost: true,
  groupByProvider: true,
});

console.log(result.content);
console.error(
  `\n✓ Exported ${result.nodeCount} nodes, ${result.edgeCount} edges (d3-force, layout: ${layout})`,
);

await storage.close();
