/**
 * @espada/pulumi — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createPulumiTools } from "./src/tools.js";
import { createPulumiCli } from "./src/cli.js";

export default {
  id: "pulumi",
  name: "Pulumi State Management",
  register(api: EspadaPluginApi) {
    for (const tool of createPulumiTools()) {
      api.registerTool(tool as any);
    }

    api.registerCli((ctx) => createPulumiCli()(ctx), { commands: ["pulumi"] });

    api.registerGatewayMethod("pulumi/stacks", async ({ params, respond }) => {
      const { pulumiStackList } = await import("./src/cli-wrapper.js");
      const p = params as { cwd?: string };
      try {
        const stacks = await pulumiStackList({ cwd: p.cwd });
        respond(true, stacks);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("pulumi/state", async ({ params, respond }) => {
      const { pulumiStackExport } = await import("./src/cli-wrapper.js");
      const { parseState, getProviderDistribution } = await import("./src/state-parser.js");
      const p = params as { stack?: string; cwd?: string };
      try {
        const raw = await pulumiStackExport({ stack: p.stack, cwd: p.cwd });
        const state = JSON.parse(raw);
        const resources = parseState(state);
        const providers = getProviderDistribution(resources);
        respond(true, { resourceCount: resources.length, providers, resources });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerService({
      id: "pulumi",
      start: async () => {
        api.logger?.info("[pulumi] Plugin loaded");
      },
      stop: async () => {},
    });
  },
};
