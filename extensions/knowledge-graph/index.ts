/**
 * Infrastructure Knowledge Graph — Plugin Entry Point
 *
 * Espada plugin that provides a persistent, queryable topology graph
 * of cloud infrastructure. Registers CLI commands, agent tools, and
 * a background sync service.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { GraphEngine } from "./src/engine.js";
import { InMemoryGraphStorage } from "./src/storage/index.js";
import { SQLiteGraphStorage } from "./src/storage/index.js";
import { registerGraphTools, registerGovernanceTools } from "./src/tools.js";
import { registerGraphCli } from "./src/cli.js";
import { registerInfraCli } from "./src/infra-cli.js";
import { ChangeGovernor } from "./src/governance.js";
import type { GraphStorage, CloudProvider } from "./src/types.js";

// Re-export public API for programmatic use by other extensions
export { GraphEngine } from "./src/engine.js";
export { InMemoryGraphStorage, SQLiteGraphStorage } from "./src/storage/index.js";
export { AdapterRegistry, AwsDiscoveryAdapter } from "./src/adapters/index.js";
export { exportTopology } from "./src/export.js";
export { ChangeGovernor, calculateRiskScore } from "./src/governance.js";
export type { ChangeRequest, RiskAssessment} from "./src/governance.js";

// =============================================================================
// Plugin Configuration
// =============================================================================

type KnowledgeGraphPluginConfig = {
  storage?: {
    type?: "sqlite" | "memory";
    path?: string;
  };
  sync?: {
    intervalMinutes?: number;
    fullSyncIntervalHours?: number;
    enableDriftDetection?: boolean;
  };
  adapters?: string[];
};

const DEFAULT_CONFIG: Required<KnowledgeGraphPluginConfig> = {
  storage: {
    type: "sqlite",
    path: "~/.espada/knowledge-graph.db",
  },
  sync: {
    intervalMinutes: 15,
    fullSyncIntervalHours: 6,
    enableDriftDetection: true,
  },
  adapters: ["aws"],
};

// =============================================================================
// Storage Factory
// =============================================================================

function createStorage(config: KnowledgeGraphPluginConfig, resolvePath: (p: string) => string): GraphStorage {
  const storageConfig = { ...DEFAULT_CONFIG.storage, ...config.storage };

  if (storageConfig.type === "memory") {
    return new InMemoryGraphStorage();
  }

  const dbPath = resolvePath(storageConfig.path ?? "~/.espada/knowledge-graph.db");
  return new SQLiteGraphStorage(dbPath);
}

// =============================================================================
// Plugin Definition
// =============================================================================

export default {
  id: "knowledge-graph",
  name: "Infrastructure Knowledge Graph",
  description:
    "Persistent, queryable topology of resources, relationships, costs, and changes across cloud providers",
  version: "1.0.0",

  async register(api: EspadaPluginApi) {
    const config = (api.pluginConfig ?? {}) as KnowledgeGraphPluginConfig;
    const mergedConfig = {
      storage: { ...DEFAULT_CONFIG.storage, ...config.storage },
      sync: { ...DEFAULT_CONFIG.sync, ...config.sync },
      adapters: config.adapters ?? DEFAULT_CONFIG.adapters,
    };

    // -- Initialize storage --------------------------------------------------
    const storage = createStorage(mergedConfig, api.resolvePath);
    await storage.initialize();

    // -- Initialize engine ----------------------------------------------------
    const engine = new GraphEngine({
      storage,
      config: {
        maxTraversalDepth: 8,
        enableDriftDetection: mergedConfig.sync.enableDriftDetection,
      },
    });

    api.logger.info(
      `Knowledge graph initialized (storage: ${mergedConfig.storage.type}, adapters: ${mergedConfig.adapters.join(", ")})`,
    );

    // -- Register agent tools -------------------------------------------------
    registerGraphTools(api, engine, storage);

    // -- Initialize governance layer -------------------------------------------
    const governor = new ChangeGovernor(engine, storage);
    registerGovernanceTools(api, governor, storage);

    // -- Register CLI commands ------------------------------------------------
    api.registerCli(
      (ctx) => registerGraphCli(ctx, engine, storage),
      { commands: ["graph"] },
    );

    api.registerCli(
      (ctx) => registerInfraCli({ program: ctx.program, logger: ctx.logger, workspaceDir: ctx.workspaceDir }),
      { commands: ["infra"] },
    );

    // -- Register background sync service -------------------------------------
    api.registerService({
      id: "knowledge-graph-sync",
      async start(ctx) {
        const syncInterval = (mergedConfig.sync.intervalMinutes ?? 15) * 60 * 1000;
        const fullSyncInterval = (mergedConfig.sync.fullSyncIntervalHours ?? 6) * 60 * 60 * 1000;

        // Light sync (critical resources only) on short interval
        const lightTimer = setInterval(async () => {
          try {
            const results = await engine.sync({
              discoverOptions: {
                resourceTypes: ["compute", "database", "load-balancer", "function", "container"],
              },
            });
            const totals = results.reduce(
              (acc, r) => ({
                nodesDiscovered: acc.nodesDiscovered + r.nodesDiscovered,
                nodesCreated: acc.nodesCreated + r.nodesCreated,
                nodesUpdated: acc.nodesUpdated + r.nodesUpdated,
                durationMs: acc.durationMs + (r.durationMs ?? 0),
              }),
              { nodesDiscovered: 0, nodesCreated: 0, nodesUpdated: 0, durationMs: 0 },
            );
            ctx.logger.info(
              `Light sync: ${totals.nodesDiscovered} discovered, ${totals.nodesCreated} created, ${totals.nodesUpdated} updated (${totals.durationMs}ms)`,
            );
          } catch (err) {
            ctx.logger.error(`Light sync failed: ${err}`);
          }
        }, syncInterval);

        // Full sync on longer interval
        const fullTimer = setInterval(async () => {
          try {
            const results = await engine.sync();
            const totals = results.reduce(
              (acc, r) => ({
                nodesDiscovered: acc.nodesDiscovered + r.nodesDiscovered,
                nodesCreated: acc.nodesCreated + r.nodesCreated,
                durationMs: acc.durationMs + (r.durationMs ?? 0),
              }),
              { nodesDiscovered: 0, nodesCreated: 0, durationMs: 0 },
            );
            ctx.logger.info(
              `Full sync: ${totals.nodesDiscovered} discovered, ${totals.nodesCreated} created (${totals.durationMs}ms)`,
            );

            // Run drift detection after full sync
            if (mergedConfig.sync.enableDriftDetection) {
              const drift = await engine.detectDrift();
              if (drift.driftedNodes.length > 0 || drift.disappearedNodes.length > 0) {
                ctx.logger.warn(
                  `Drift detected: ${drift.driftedNodes.length} drifted, ${drift.disappearedNodes.length} disappeared`,
                );
              }
            }
          } catch (err) {
            ctx.logger.error(`Full sync failed: ${err}`);
          }
        }, fullSyncInterval);

        // Store timer refs for cleanup
        (ctx as Record<string, unknown>)._lightTimer = lightTimer;
        (ctx as Record<string, unknown>)._fullTimer = fullTimer;
      },

      async stop(ctx) {
        const c = ctx as Record<string, unknown>;
        if (c._lightTimer) clearInterval(c._lightTimer as ReturnType<typeof setInterval>);
        if (c._fullTimer) clearInterval(c._fullTimer as ReturnType<typeof setInterval>);
        await storage.close();
      },
    });

    // -- Register gateway methods for RPC queries -----------------------------
    api.registerGatewayMethod("knowledge-graph/stats", async ({ respond }) => {
      const stats = await engine.getStats();
      respond(true, stats);
    });

    api.registerGatewayMethod("knowledge-graph/blast-radius", async ({ params, respond }) => {
      const { resourceId, depth } = params as { resourceId: string; depth?: number };
      const result = await engine.getBlastRadius(resourceId, depth ?? 3);
      respond(true, {
        rootNodeId: result.rootNodeId,
        nodeCount: result.nodes.size,
        totalCostMonthly: result.totalCostMonthly,
        hops: Object.fromEntries([...result.hops.entries()].map(([k, v]) => [k, v.length])),
      });
    });

    api.registerGatewayMethod("knowledge-graph/topology", async ({ params, respond }) => {
      const { provider } = (params ?? {}) as { provider?: CloudProvider };
      const filter = provider ? { provider } : {};
      const topo = await engine.getTopology(filter);
      respond(true, { nodeCount: topo.nodes.length, edgeCount: topo.edges.length });
    });
  },
};
