import { loadConfig } from "../src/config/config.ts";
import { normalizePluginsConfig } from "../src/plugins/config-state.ts";
import { discoverEspadaPlugins } from "../src/plugins/discovery.ts";
import { loadPluginManifestRegistry } from "../src/plugins/manifest-registry.ts";
import { resolveEnableState } from "../src/plugins/config-state.ts";

const config = loadConfig();
console.log("Config loaded OK. Plugin entries:", Object.keys(config.plugins?.entries || {}));

const normalized = normalizePluginsConfig(config.plugins);
console.log("LoadPaths:", normalized.loadPaths);
console.log("Entries:", Object.keys(normalized.entries));

const discovery = discoverEspadaPlugins({ extraPaths: normalized.loadPaths });
console.log("\nTotal candidates:", discovery.candidates.length);

const kgCandidates = discovery.candidates.filter(
  (c) => c.idHint.includes("knowledge") || c.source.includes("knowledge"),
);
console.log("Knowledge-graph candidates:", kgCandidates.length);
for (const c of kgCandidates) {
  console.log("  -", c.idHint, c.origin, c.source);
}

console.log("\nDiagnostics:", discovery.diagnostics.length);
for (const d of discovery.diagnostics) {
  console.log("  -", d.level, d.message);
}

const manifestRegistry = loadPluginManifestRegistry({
  config,
  candidates: discovery.candidates,
  diagnostics: [...discovery.diagnostics],
});
console.log("\nManifest registry plugins:", manifestRegistry.plugins.length);
for (const p of manifestRegistry.plugins) {
  if (p.id === "knowledge-graph" || p.id.includes("knowledge")) {
    console.log("  KG manifest:", p.id, "configSchema:", !!p.configSchema);
  }
}

// Check enable state for knowledge-graph
const kgManifest = manifestRegistry.plugins.find((p) => p.id === "knowledge-graph");
if (kgManifest) {
  const kgCandidate = discovery.candidates.find(
    (c) => c.source.includes("knowledge-graph"),
  );
  if (kgCandidate) {
    const enableState = resolveEnableState("knowledge-graph", kgCandidate.origin, normalized);
    console.log("\nKnowledge-graph enable state:", enableState);
  }
}

// Try to actually load plugins
import { loadEspadaPlugins } from "../src/plugins/loader.ts";
import { createSubsystemLogger } from "../src/logging/subsystem.ts";

const log = createSubsystemLogger("plugins");
const logger = {
  info: (msg: string) => console.log("[INFO]", msg),
  warn: (msg: string) => console.log("[WARN]", msg),
  error: (msg: string) => console.log("[ERROR]", msg),
  debug: (msg: string) => console.log("[DEBUG]", msg),
};

console.log("\n--- Loading Plugins ---");
const registry = loadEspadaPlugins({ config, logger, cache: false });
console.log("Loaded plugins:", registry.plugins.length);
for (const p of registry.plugins) {
  if (p.id === "knowledge-graph") {
    console.log("  KG plugin:", p.id, "status:", p.status, "error:", p.error);
    console.log("  KG cliCommands:", p.cliCommands);
    console.log("  KG toolNames:", p.toolNames);
    console.log("  KG services:", p.services);
  }
}
console.log("CLI registrars:", registry.cliRegistrars.length);
for (const r of registry.cliRegistrars) {
  console.log("  -", r.pluginId, "commands:", r.commands);
}
