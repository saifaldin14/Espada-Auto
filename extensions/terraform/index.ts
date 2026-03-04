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

// ── Enterprise Diagnostics ──────────────────────────────────────────────
type TerraformDiagnostics = {
  gatewayAttempts: number;
  gatewaySuccesses: number;
  gatewayFailures: number;
  execAttempts: number;
  execSuccesses: number;
  execFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  lastExecOperation: string | null;
};

const diag: TerraformDiagnostics = {
  gatewayAttempts: 0,
  gatewaySuccesses: 0,
  gatewayFailures: 0,
  execAttempts: 0,
  execSuccesses: 0,
  execFailures: 0,
  lastError: null,
  lastErrorAt: null,
  lastSuccessAt: null,
  lastExecOperation: null,
};

function trackSuccess(isExec = false): void {
  diag.gatewayAttempts++;
  diag.gatewaySuccesses++;
  diag.lastSuccessAt = new Date().toISOString();
  if (isExec) { diag.execAttempts++; diag.execSuccesses++; }
}

function trackFailure(err: unknown, isExec = false): void {
  diag.gatewayAttempts++;
  diag.gatewayFailures++;
  diag.lastError = String(err);
  diag.lastErrorAt = new Date().toISOString();
  if (isExec) { diag.execAttempts++; diag.execFailures++; }
}
// ─────────────────────────────────────────────────────────────────────────

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
      try {
        const result = await storage.listWorkspaces();
        trackSuccess();
        respond(true, result);
      } catch (err) {
        trackFailure(err);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/lock", async ({ params, respond }) => {
      const p = params as { stateId: string };
      try {
        const result = await storage.getLock(p.stateId);
        trackSuccess();
        respond(true, result);
      } catch (err) {
        trackFailure(err);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/drift-history", async ({ params, respond }) => {
      const p = params as { stateId: string; limit?: number };
      try {
        const result = await storage.getDriftHistory(p.stateId, p.limit);
        trackSuccess();
        respond(true, result);
      } catch (err) {
        trackFailure(err);
        respond(false, { error: String(err) });
      }
    });

    // CLI wrapper gateway methods — execute real terraform commands
    api.registerGatewayMethod("terraform/exec-init", async ({ params, respond }) => {
      diag.lastExecOperation = "init";
      try {
        const p = params as { cwd: string; upgrade?: boolean };
        const ok = await isTerraformInstalled();
        if (!ok.installed) { trackFailure(new Error("terraform not found in PATH"), true); respond(false, { error: "terraform not found in PATH" }); return; }
        const result = await tfInit({ cwd: p.cwd }, { upgrade: p.upgrade });
        trackSuccess(true);
        respond(true, result);
      } catch (err) {
        trackFailure(err, true);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/exec-plan", async ({ params, respond }) => {
      diag.lastExecOperation = "plan";
      try {
        const p = params as { cwd: string; destroy?: boolean; target?: string[] };
        const result = await tfPlan({ cwd: p.cwd }, { destroy: p.destroy, target: p.target });
        trackSuccess(true);
        respond(true, result);
      } catch (err) {
        trackFailure(err, true);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/exec-apply", async ({ params, respond }) => {
      diag.lastExecOperation = "apply";
      try {
        const p = params as { cwd: string; autoApprove?: boolean; target?: string[] };
        const result = await tfApply({ cwd: p.cwd }, { autoApprove: p.autoApprove ?? true, target: p.target });
        trackSuccess(true);
        respond(true, result);
      } catch (err) {
        trackFailure(err, true);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/exec-destroy", async ({ params, respond }) => {
      diag.lastExecOperation = "destroy";
      try {
        const p = params as { cwd: string; autoApprove?: boolean };
        const result = await tfDestroy({ cwd: p.cwd }, { autoApprove: p.autoApprove ?? true });
        trackSuccess(true);
        respond(true, result);
      } catch (err) {
        trackFailure(err, true);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/exec-state-list", async ({ params, respond }) => {
      diag.lastExecOperation = "state-list";
      try {
        const p = params as { cwd: string };
        const result = await tfStateList({ cwd: p.cwd });
        trackSuccess(true);
        respond(true, result);
      } catch (err) {
        trackFailure(err, true);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/exec-state-pull", async ({ params, respond }) => {
      diag.lastExecOperation = "state-pull";
      try {
        const p = params as { cwd: string };
        const result = await tfStatePull({ cwd: p.cwd });
        trackSuccess(true);
        respond(true, result);
      } catch (err) {
        trackFailure(err, true);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("terraform/exec-version", async ({ respond }) => {
      diag.lastExecOperation = "version";
      try {
        const result = await tfVersion({ cwd: "." });
        trackSuccess(true);
        respond(true, result);
      } catch (err) {
        trackFailure(err, true);
        respond(false, { error: String(err) });
      }
    });

    // ── Enterprise diagnostics gateways ──
    api.registerGatewayMethod("terraform/status", async ({ respond }) => {
      respond(true, {
        status: diag.gatewayFailures === 0 || diag.lastSuccessAt
          ? "operational"
          : "degraded",
        ...diag,
      });
    });

    api.registerGatewayMethod("terraform/diagnostics/reset", async ({ respond }) => {
      diag.gatewayAttempts = 0;
      diag.gatewaySuccesses = 0;
      diag.gatewayFailures = 0;
      diag.execAttempts = 0;
      diag.execSuccesses = 0;
      diag.execFailures = 0;
      diag.lastError = null;
      diag.lastErrorAt = null;
      diag.lastSuccessAt = null;
      diag.lastExecOperation = null;
      respond(true, { reset: true });
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
