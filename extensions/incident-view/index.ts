/**
 * @espada/incident-view — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createIncidentTools } from "./src/tools.js";

export default {
  id: "incident-view",
  name: "Cross-Cloud Unified Incident View",
  register(api: EspadaPluginApi) {
    for (const tool of createIncidentTools()) {
      api.registerTool(tool as any);
    }

    api.registerGatewayMethod("incident/normalize", async ({ params, respond }: any) => {
      try {
        const { normalizeBatch } = await import("./src/normalizers.js");
        const { cloud, source, items } = params as {
          cloud: string;
          source: string;
          items: Record<string, unknown>[];
        };
        const incidents = normalizeBatch(cloud as any, source as any, items);
        respond(true, { count: incidents.length, incidents });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("incident/summary", async ({ params, respond }: any) => {
      try {
        const { aggregateIncidents } = await import("./src/manager.js");
        const { incidents } = params as { incidents: any[] };
        const summary = aggregateIncidents(incidents);
        respond(true, summary);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("incident/correlate", async ({ params, respond }: any) => {
      try {
        const { correlateIncidents } = await import("./src/manager.js");
        const { incidents } = params as { incidents: any[] };
        const groups = correlateIncidents(incidents);
        respond(true, { groupCount: groups.length, groups });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });
  },
};
