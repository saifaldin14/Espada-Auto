/**
 * Infrastructure Knowledge Graph — Plugin Entry Point
 *
 * Espada plugin that provides a persistent, queryable topology graph
 * of cloud infrastructure. Registers CLI commands, agent tools, and
 * a background sync service.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { GraphEngine } from "./src/core/engine.js";
import { InMemoryGraphStorage } from "./src/storage/index.js";
import { SQLiteGraphStorage } from "./src/storage/index.js";
import { registerGraphTools, registerGovernanceTools } from "./src/tools/tools.js";
import { registerIntegrationTools } from "./src/tools/integration-tools.js";
import { registerGraphCli } from "./src/cli/cli.js";
import { registerInfraCli } from "./src/cli/infra-cli.js";
import { ChangeGovernor } from "./src/core/governance.js";
import type { GraphStorage, CloudProvider } from "./src/types.js";
import {
  IntegrationManager,
  type ExternalExtensions,
} from "./src/integrations/index.js";

// Re-export public API for programmatic use by other extensions
export { GraphEngine } from "./src/core/engine.js";
export { InMemoryGraphStorage, SQLiteGraphStorage } from "./src/storage/index.js";
export { AdapterRegistry, AwsDiscoveryAdapter } from "./src/adapters/index.js";
export { exportTopology } from "./src/reporting/export.js";
export { ChangeGovernor, calculateRiskScore } from "./src/core/governance.js";
export type { ChangeRequest, RiskAssessment} from "./src/core/governance.js";
export { IntegrationManager } from "./src/integrations/index.js";
export type { IntegrationContext, ExtensionAvailability } from "./src/integrations/index.js";

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

  register(api: EspadaPluginApi) {
    const config = (api.pluginConfig ?? {}) as KnowledgeGraphPluginConfig;
    const mergedConfig = {
      storage: { ...DEFAULT_CONFIG.storage, ...config.storage },
      sync: { ...DEFAULT_CONFIG.sync, ...config.sync },
      adapters: config.adapters ?? DEFAULT_CONFIG.adapters,
    };

    // -- Register CLI commands (synchronous — must happen before any await) ----
    // The infra CLI creates its own storage per-invocation, so it doesn't need
    // the plugin-level engine/storage.
    api.registerCli(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- commander@14 (SDK) vs @12 (local) structural compat
      (ctx) => registerInfraCli({ program: ctx.program as any, logger: ctx.logger, workspaceDir: ctx.workspaceDir }),
      { commands: ["infra"] },
    );

    // -- Initialize storage & engine (deferred to avoid async register) --------
    const storage = createStorage(mergedConfig, api.resolvePath);
    const engine = new GraphEngine({
      storage,
      config: {
        maxTraversalDepth: 8,
        enableDriftDetection: mergedConfig.sync.enableDriftDetection,
      },
    });

    // Defer async initialization — storage.initialize() will be called when
    // the graph CLI or tools are first used, and by the background sync service.
    const initPromise = storage.initialize().then(() => {
      api.logger.info(
        `Knowledge graph initialized (storage: ${mergedConfig.storage.type}, adapters: ${mergedConfig.adapters.join(", ")})`,
      );
    }).catch((err: unknown) => {
      api.logger.error(`Knowledge graph storage init failed: ${err}`);
    });

    // -- Resolve sibling extension interfaces --------------------------------
    const ext: ExternalExtensions = {};

    // Probe each sibling extension. We use try/catch because getService
    // may throw or not exist if the extension is not installed.
    const svc = (api as Record<string, unknown>).getService as
      | ((extId: string, name: string) => unknown)
      | undefined;

    if (typeof svc === "function") {
      try { ext.authEngine = svc("enterprise-auth", "RbacEngine") as typeof ext.authEngine; } catch { /* not available */ }
      try { ext.auditLogger = svc("audit-trail", "AuditLogger") as typeof ext.auditLogger; } catch { /* not available */ }
      try { ext.complianceEvaluator = svc("compliance", "ComplianceEvaluator") as typeof ext.complianceEvaluator; } catch { /* not available */ }
      try { ext.waiverStore = svc("compliance", "WaiverStore") as typeof ext.waiverStore; } catch { /* not available */ }
      try { ext.policyEngine = svc("policy-engine", "PolicyEvaluationEngine") as typeof ext.policyEngine; } catch { /* not available */ }
      try { ext.budgetManager = svc("cost-governance", "BudgetManager") as typeof ext.budgetManager; } catch { /* not available */ }
      try { ext.terraformBridge = svc("terraform", "GraphBridge") as typeof ext.terraformBridge; } catch { /* not available */ }
      try { ext.alertIngestor = svc("alerting-integration", "AlertIngestor") as typeof ext.alertIngestor; } catch { /* not available */ }
    }

    // -- Initialize integration manager ----------------------------------------
    const integrations = new IntegrationManager({
      engine,
      storage,
      logger: api.logger,
      extensions: ext,
    });

    // -- Register agent tools -------------------------------------------------
    registerGraphTools(api, engine, storage);
    registerIntegrationTools(api, integrations);

    // -- Initialize governance layer -------------------------------------------
    const governor = new ChangeGovernor(engine, storage);
    registerGovernanceTools(api, governor, storage);

    // -- Register graph CLI (needs engine + storage) --------------------------
    api.registerCli(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- commander@14 (SDK) vs @12 (local) structural compat
      (ctx) => registerGraphCli({ ...ctx, program: ctx.program as any }, engine, storage),
      { commands: ["graph"] },
    );

    // -- Register background sync service -------------------------------------
    api.registerService({
      id: "knowledge-graph-sync",
      async start(ctx) {
        // Ensure storage is ready before starting sync
        await initPromise;
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
              const driftResult = await integrations.detectDriftAndAlert();
              if (driftResult.driftedCount > 0 || driftResult.disappearedCount > 0) {
                ctx.logger.warn(
                  `Drift detected: ${driftResult.driftedCount} drifted, ${driftResult.disappearedCount} disappeared` +
                  (driftResult.alertsSent > 0 ? ` (${driftResult.alertsSent} alerts sent)` : ""),
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

    // -- Integration gateway methods ------------------------------------------

    api.registerGatewayMethod("knowledge-graph/integrations", async ({ respond }) => {
      respond(true, {
        available: integrations.available,
        summary: integrations.availableSummary,
      });
    });

    api.registerGatewayMethod("knowledge-graph/compliance", async ({ params, respond }) => {
      const { framework } = (params ?? {}) as { framework?: string };
      if (framework) {
        const result = await integrations.compliance.evaluate(framework as any);
        respond(true, result);
      } else {
        const results = await integrations.compliance.evaluateAll();
        respond(true, results);
      }
    });

    api.registerGatewayMethod("knowledge-graph/policy-check", async ({ params, respond }) => {
      const { nodeId } = params as { nodeId: string };
      const result = await integrations.policy.evaluateNode(nodeId);
      respond(true, result);
    });

    api.registerGatewayMethod("knowledge-graph/cost-summary", async ({ respond }) => {
      const summary = await integrations.cost.getCostSummary();
      respond(true, summary);
    });
  },
};
