/**
 * Run Espada's native exportTopology (Mermaid format)
 * from the live-scanned knowledge graph SQLite database.
 */
import { SQLiteGraphStorage } from "../extensions/knowledge-graph/src/storage/index.js";
import { exportTopology } from "../extensions/knowledge-graph/src/reporting/export.js";
import { resolve } from "node:path";

const dbPath = resolve(process.env.HOME!, ".espada/knowledge-graph.db");
const storage = new SQLiteGraphStorage(dbPath);
await storage.initialize();

const result = await exportTopology(storage, "mermaid", {
  includeCost: true,
  includeMetadata: true,
});

console.log(result.content);
console.error(
  `\n✓ Exported ${result.nodeCount} nodes, ${result.edgeCount} edges (native mermaid)`,
);

await storage.close();
