/**
 * @espada/terraform — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { SQLiteTerraformStorage, InMemoryTerraformStorage } from "./src/storage.js";
import { createTerraformTools } from "./src/tools.js";
import { createTerraformCli } from "./src/cli.js";
import type { TerraformStorage } from "./src/types.js";

export default {
  id: "terraform",
  name: "Terraform State Management",
  register(api: EspadaPluginApi) {
    const useMemory = process.env.NODE_ENV === "test" || process.env.ESPADA_TEST === "1";
    let storage: TerraformStorage;

    if (useMemory) {
      storage = new InMemoryTerraformStorage();
    } else {
      const dbPath = api.resolvePath("terraform.db");
      storage = new SQLiteTerraformStorage(dbPath);
    }

    for (const tool of createTerraformTools(storage)) {
      api.registerTool(tool as any);
    }

    api.registerCli((ctx) => createTerraformCli(storage)(ctx.program), { commands: ["terraform"] });

    api.registerGatewayMethod("terraform/workspaces", async ({ respond }) => {
      respond(true, await storage.listWorkspaces());
    });

    api.registerGatewayMethod("terraform/lock", async ({ params, respond }) => {
      const p = params as { stateId: string };
      respond(true, await storage.getLock(p.stateId));
    });

    api.registerGatewayMethod("terraform/drift-history", async ({ params, respond }) => {
      const p = params as { stateId: string; limit?: number };
      respond(true, await storage.getDriftHistory(p.stateId, p.limit));
    });

    api.registerService({
      id: "terraform",
      start: async () => {
        await storage.initialize();
        api.logger?.info("[terraform] Storage initialized");
      },
      stop: async () => {
        await storage.close();
      },
    });
  },
};
