/**
 * @espada/terraform — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { SQLiteTerraformStorage, InMemoryTerraformStorage } from "./src/storage.js";
import { createTerraformTools } from "./src/tools.js";
import { createTerraformCliTools } from "./src/cli-tools.js";
import { createTerraformCli } from "./src/cli.js";
import type { TerraformStorage } from "./src/types.js";
import { tfInit, tfPlan, tfApply, tfDestroy, tfStateList, tfStatePull, tfVersion, isTerraformInstalled } from "./src/cli-wrapper.js";

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

    for (const tool of createTerraformCliTools()) {
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

    // CLI wrapper gateway methods — execute real terraform commands
    api.registerGatewayMethod("terraform/exec-init", async ({ params, respond }) => {
      const p = params as { cwd: string; upgrade?: boolean };
      const ok = await isTerraformInstalled();
      if (!ok.installed) { respond(false, { error: "terraform not found in PATH" }); return; }
      respond(true, await tfInit({ cwd: p.cwd }, { upgrade: p.upgrade }));
    });

    api.registerGatewayMethod("terraform/exec-plan", async ({ params, respond }) => {
      const p = params as { cwd: string; destroy?: boolean; target?: string[] };
      respond(true, await tfPlan({ cwd: p.cwd }, { destroy: p.destroy, target: p.target }));
    });

    api.registerGatewayMethod("terraform/exec-apply", async ({ params, respond }) => {
      const p = params as { cwd: string; autoApprove?: boolean; target?: string[] };
      respond(true, await tfApply({ cwd: p.cwd }, { autoApprove: p.autoApprove ?? true, target: p.target }));
    });

    api.registerGatewayMethod("terraform/exec-destroy", async ({ params, respond }) => {
      const p = params as { cwd: string; autoApprove?: boolean };
      respond(true, await tfDestroy({ cwd: p.cwd }, { autoApprove: p.autoApprove ?? true }));
    });

    api.registerGatewayMethod("terraform/exec-state-list", async ({ params, respond }) => {
      const p = params as { cwd: string };
      respond(true, await tfStateList({ cwd: p.cwd }));
    });

    api.registerGatewayMethod("terraform/exec-state-pull", async ({ params, respond }) => {
      const p = params as { cwd: string };
      respond(true, await tfStatePull({ cwd: p.cwd }));
    });

    api.registerGatewayMethod("terraform/exec-version", async ({ respond }) => {
      respond(true, await tfVersion({ cwd: "." }));
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
