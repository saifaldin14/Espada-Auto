/**
 * Disaster Recovery Analysis extension.
 *
 * Wires to the Knowledge Graph plugin for live topology data.
 * Falls back to placeholder messages when KG is unavailable.
 *
 * Integration: The KG plugin (or any external caller) can push data via
 * the exported `setGraphData()` from `./src/tools.js`, or the bridge
 * can be constructed by passing a `fetchTopology` callback.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { drTools } from "./src/tools.js";
import { registerDRCli } from "./src/cli.js";
import { KnowledgeGraphBridge } from "./src/kg-bridge.js";

// Re-export bridge for programmatic use
export { KnowledgeGraphBridge } from "./src/kg-bridge.js";
export { kgNodesToDR, kgEdgesToDR } from "./src/kg-bridge.js";
export { setGraphData } from "./src/tools.js";

export default {
  id: "dr-analysis",
  name: "Disaster Recovery Analysis",
  register(api: EspadaPluginApi) {
    // Bridge is created lazily — populated when the service starts or when
    // an external caller pushes data via `setGraphData()`.
    let bridge: KnowledgeGraphBridge | null = null;

    // -- Register agent tools -------------------------------------------------
    for (const tool of drTools) {
      api.registerTool(tool as any);
    }

    // -- Register CLI commands (pass bridge getter for live data) -------------
    api.registerCli(
      (ctx) => registerDRCli(ctx.program, bridge),
      { commands: ["dr"] },
    );

    // -- Gateway method — live DR analysis via KG topology --------------------
    api.registerGatewayMethod(
      "dr/analysis",
      async ({ params, respond }) => {
        const { provider, region } = params as { provider?: string; region?: string };

        if (!bridge) {
          respond(true, {
            status: "no_kg",
            message: "Knowledge Graph data not loaded. Ensure the knowledge-graph plugin is active.",
            filters: { provider, region },
          });
          return;
        }

        try {
          const syncResult = await bridge.sync({ provider, region });
          const analysis = bridge.analyzePosture();

          if (!analysis) {
            respond(true, {
              status: "no_data",
              message: "Knowledge Graph has no infrastructure nodes matching filters.",
              filters: { provider, region },
              sync: syncResult,
            });
            return;
          }

          respond(true, {
            status: "ok",
            grade: analysis.grade,
            score: analysis.overallScore,
            singleRegionRisks: analysis.singleRegionRisks,
            unprotectedCount: analysis.unprotectedCriticalResources.length,
            recommendations: analysis.recommendations,
            recoveryTimeEstimates: analysis.recoveryTimeEstimates,
            sync: syncResult,
          });
        } catch (err) {
          respond(false, {
            status: "error",
            message: `DR analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
    );

    // -- Background service: periodic KG sync ---------------------------------
    api.registerService({
      id: "dr-analysis",
      start: async (ctx) => {
        api.logger.info("DR Analysis service started");

        // Try to resolve the KG engine from the plugin registry at service
        // start time (all plugins are registered by this point). The registry
        // exposes loaded plugins on `api.runtime` indirectly — we check for a
        // shared `knowledgeGraphEngine` on the runtime as a lightweight seam.
        const kgEngine = (api.runtime as Record<string, any>).knowledgeGraphEngine;
        if (kgEngine?.getTopology) {
          bridge = new KnowledgeGraphBridge(
            (filter) => kgEngine.getTopology(filter),
          );
          api.logger.info("DR Analysis wired to Knowledge Graph engine");
        } else {
          api.logger.debug?.("Knowledge Graph engine not found — DR running standalone");
          return;
        }

        // Initial sync from KG
        try {
          const result = await bridge.sync();
          ctx.logger.info(
            `DR initial KG sync: ${result.nodeCount} nodes, ${result.edgeCount} edges (${result.filteredOut} non-cloud filtered)`,
          );
        } catch (err) {
          ctx.logger.warn(`DR initial KG sync failed: ${err}`);
        }

        // Periodic re-sync every 30 minutes
        const syncTimer = setInterval(async () => {
          try {
            const result = await bridge!.sync();
            ctx.logger.info(
              `DR periodic sync: ${result.nodeCount} nodes, ${result.edgeCount} edges`,
            );
          } catch (err) {
            ctx.logger.warn(`DR periodic sync failed: ${err}`);
          }
        }, 30 * 60 * 1000);

        (ctx as Record<string, unknown>)._drSyncTimer = syncTimer;
      },
      stop: async (ctx) => {
        const c = ctx as Record<string, unknown>;
        if (c._drSyncTimer) clearInterval(c._drSyncTimer as ReturnType<typeof setInterval>);
        api.logger.info("DR Analysis service stopped");
      },
    });
  },
};
