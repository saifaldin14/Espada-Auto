/**
 * Blueprints & Templates extension — infrastructure blueprint catalog.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { blueprintTools } from "./src/tools.js";
import { registerBlueprintCli } from "./src/cli.js";
import { InstanceStore } from "./src/engine.js";

export default {
  id: "blueprints",
  name: "Blueprints & Templates",
  register(api: EspadaPluginApi) {
    const instanceStore = new InstanceStore();

    // Register tools with instance store context
    for (const tool of blueprintTools) {
      const originalExecute = tool.execute;
      api.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: (input: Record<string, unknown>) =>
          (originalExecute as Function)(input, { instanceStore }),
      } as any);
    }

    // CLI
    api.registerCli((ctx) => registerBlueprintCli(ctx.program), {
      commands: ["blueprint"],
    });

    // Gateway methods
    api.registerGatewayMethod("blueprints/catalog", async ({ params, respond }) => {
      const { builtInBlueprints, filterBlueprints } = await import("./src/library.js");
      const { category, provider, tag } = params as Record<string, string>;
      const results = filterBlueprints(builtInBlueprints, { category, provider, tag });
      respond(true, { blueprints: results });
    });

    api.registerGatewayMethod("blueprints/instances", async ({ respond }) => {
      respond(true, { instances: instanceStore.list() });
    });

    // Service lifecycle
    api.registerService({
      id: "blueprints",
      start: async () => {
        api.logger?.info("Blueprints service started");
      },
      stop: async () => {
        api.logger?.info("Blueprints service stopped");
      },
    });
  },
};
