/**
 * Disaster Recovery Analysis extension.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { drTools } from "./src/tools.js";
import { registerDRCli } from "./src/cli.js";

export default {
  id: "dr-analysis",
  name: "Disaster Recovery Analysis",
  register(api: EspadaPluginApi) {
    for (const tool of drTools) {
      api.registerTool(tool as any);
    }

    api.registerCli((ctx) => registerDRCli(ctx.program), {
      commands: ["dr"],
    });

    api.registerGatewayMethod(
      "dr/analysis",
      async ({ params, respond }) => {
        const { provider, region } = params as { provider?: string; region?: string };
        // In production, pull from Knowledge Graph
        respond(true, {
          message: "Connect Knowledge Graph for live DR analysis",
          filters: { provider, region },
        });
      },
    );

    api.registerService({
      id: "dr-analysis",
      start: async () => {
        api.logger?.info("DR Analysis service started");
      },
      stop: async () => {
        api.logger?.info("DR Analysis service stopped");
      },
    });
  },
};
