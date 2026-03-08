/**
 * Standalone launcher for the KG API server.
 * Usage: npx tsx extensions/knowledge-graph/serve.ts [--port 8080] [--db ./infra-graph.db]
 */
import { startApiServer } from "./src/api/server.js";

const args = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const port = Number(getArg("port", "8080"));
const host = getArg("host", "127.0.0.1");
const dbPath = getArg("db", "./infra-graph.db");

console.log(`Starting KG API server on http://${host}:${port} (db: ${dbPath})`);

startApiServer({ port, host, db: dbPath })
  .then(() => console.log("Server is running. Press Ctrl+C to stop."))
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
