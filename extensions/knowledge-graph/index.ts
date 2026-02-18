/**
 * Infrastructure Knowledge Graph — Plugin Entry Point
 *
 * This is the file referenced by espada.plugin.json.
 * Full plugin wiring (CLI commands, agent tools, scheduled sync)
 * is deferred to Phase 4 — see README.md for implementation guide.
 */

export { GraphEngine } from "./src/engine.js";
export { InMemoryGraphStorage } from "./src/storage/index.js";
export { SQLiteGraphStorage } from "./src/storage/index.js";
export { AdapterRegistry } from "./src/adapters/index.js";
export { AwsDiscoveryAdapter } from "./src/adapters/index.js";
