/**
 * Hybrid/Edge Infrastructure Extension
 *
 * Provides unified topology discovery across Azure Arc, Azure Local,
 * AWS Outposts, GKE Enterprise fleets, and Google Distributed Cloud.
 *
 * Registers:
 * - 4 agent tools (hybrid_topology, hybrid_sites, hybrid_fleet, hybrid_blast_radius)
 * - `espada hybrid` CLI subcommand (status, sites, fleet, topology, sync, blast-radius, assess)
 * - 3 gateway RPC methods
 * - Background sync service
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { HybridDiscoveryCoordinator } from "./src/discovery-coordinator.js";
import { CrossBoundaryAnalyzer } from "./src/cross-boundary-analysis.js";
import { registerHybridTools } from "./src/tools.js";
import { registerHybridCli } from "./src/cli.js";

// Re-export public API for programmatic use by other extensions
export { HybridDiscoveryCoordinator } from "./src/discovery-coordinator.js";
export { CrossBoundaryAnalyzer } from "./src/cross-boundary-analysis.js";
export {
  createEdgeSiteNode,
  createFleetNode,
  createClusterNode,
  createHybridEdge,
} from "./src/graph-model.js";
export { registerHybridTools } from "./src/tools.js";
export { registerHybridCli } from "./src/cli.js";

export type {
  HybridSite,
  HybridSiteCapability,
  FleetCluster,
  HybridTopology,
  HybridConnection,
  HybridDiscoveryAdapter,
} from "./src/types.js";

// =============================================================================
// Plugin Configuration
// =============================================================================

type HybridCloudPluginConfig = {
  syncIntervalMinutes?: number;
  enabledProviders?: string[];
};

const DEFAULT_CONFIG: Required<HybridCloudPluginConfig> = {
  syncIntervalMinutes: 30,
  enabledProviders: ["azure-arc", "aws-outposts", "gke-fleet"],
};

// =============================================================================
// Plugin Definition
// =============================================================================

export default {
  id: "hybrid-cloud",
  name: "Hybrid/Edge Infrastructure",
  description:
    "Unified topology discovery across Azure Arc, Azure Local, AWS Outposts, " +
    "GKE Enterprise fleets, and Google Distributed Cloud",
  version: "1.0.0",

  async register(api: EspadaPluginApi) {
    const config = (api.pluginConfig ?? {}) as HybridCloudPluginConfig;
    const mergedConfig = {
      syncIntervalMinutes: config.syncIntervalMinutes ?? DEFAULT_CONFIG.syncIntervalMinutes,
      enabledProviders: config.enabledProviders ?? DEFAULT_CONFIG.enabledProviders,
    };

    // -- Initialize coordinator + analyzer -----------------------------------
    const coordinator = new HybridDiscoveryCoordinator();
    const analyzer = new CrossBoundaryAnalyzer({
      // Provide a stub graph query target — the real graph engine is injected
      // at runtime when the knowledge-graph extension is also loaded.
      queryNodes: async () => [],
      getEdgesForNode: async () => [],
      getNeighbors: async () => ({ nodes: [], edges: [] }),
    });

    api.logger.info(
      `Hybrid-cloud initialized (providers: ${mergedConfig.enabledProviders.join(", ")}, ` +
      `sync: every ${mergedConfig.syncIntervalMinutes}m)`,
    );

    // -- Register agent tools -------------------------------------------------
    registerHybridTools(api, coordinator, analyzer);

    // -- Register CLI commands ------------------------------------------------
    api.registerCli(
      (ctx) => registerHybridCli(ctx, coordinator, analyzer),
      { commands: ["hybrid"] },
    );

    // -- Register background sync service ------------------------------------
    api.registerService({
      id: "hybrid-cloud-sync",
      async start(ctx) {
        const syncMs = mergedConfig.syncIntervalMinutes * 60 * 1000;

        const timer = setInterval(async () => {
          try {
            const topology = await coordinator.discoverAll();
            ctx.logger.info(
              `Hybrid sync: ${topology.edgeSites.length} sites, ` +
              `${topology.fleetClusters.length} clusters, ` +
              `${topology.connections.length} connections`,
            );
          } catch (err) {
            ctx.logger.error(`Hybrid sync failed: ${err}`);
          }
        }, syncMs);

        (ctx as Record<string, unknown>)._syncTimer = timer;
      },

      async stop(ctx) {
        const c = ctx as Record<string, unknown>;
        if (c._syncTimer) clearInterval(c._syncTimer as ReturnType<typeof setInterval>);
      },
    });

    // -- Register gateway methods for RPC queries ----------------------------
    api.registerGatewayMethod("hybrid/topology", async ({ respond }) => {
      try {
        const topology = await coordinator.discoverAll();
        respond(true, {
          cloudRegions: topology.cloudRegions.length,
          edgeSites: topology.edgeSites.length,
          fleetClusters: topology.fleetClusters.length,
          connections: topology.connections.length,
          summary: topology.summary,
        });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("hybrid/sites", async ({ params, respond }) => {
      try {
        let sites = await coordinator.discoverEdgeSites();
        const { provider, status } = (params ?? {}) as {
          provider?: string;
          status?: string;
        };
        if (provider) sites = sites.filter((s) => s.provider === provider);
        if (status) sites = sites.filter((s) => s.status === status);
        respond(true, { count: sites.length, sites });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("hybrid/fleet", async ({ params, respond }) => {
      try {
        let clusters = await coordinator.discoverFleet();
        const { provider, fleetId } = (params ?? {}) as {
          provider?: string;
          fleetId?: string;
        };
        if (provider) clusters = clusters.filter((c) => c.provider === provider);
        if (fleetId) clusters = clusters.filter((c) => c.fleetId === fleetId);
        respond(true, { count: clusters.length, clusters });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });
  },
};
