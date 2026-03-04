/**
 * @espada/pulumi — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createPulumiTools } from "./src/tools.js";
import { createPulumiCli } from "./src/cli.js";

// ── Enterprise Diagnostics ──────────────────────────────────────────────
type PulumiDiagnostics = {
  gatewayAttempts: number;
  gatewaySuccesses: number;
  gatewayFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
};

const diag: PulumiDiagnostics = {
  gatewayAttempts: 0,
  gatewaySuccesses: 0,
  gatewayFailures: 0,
  lastError: null,
  lastErrorAt: null,
  lastSuccessAt: null,
};

function trackSuccess(): void {
  diag.gatewayAttempts++;
  diag.gatewaySuccesses++;
  diag.lastSuccessAt = new Date().toISOString();
}

function trackFailure(err: unknown): void {
  diag.gatewayAttempts++;
  diag.gatewayFailures++;
  diag.lastError = String(err);
  diag.lastErrorAt = new Date().toISOString();
}
// ─────────────────────────────────────────────────────────────────────────

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
        trackSuccess();
        respond(true, stacks);
      } catch (err) {
        trackFailure(err);
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
        trackSuccess();
        respond(true, { resourceCount: resources.length, providers, resources });
      } catch (err) {
        trackFailure(err);
        respond(false, { error: String(err) });
      }
    });

    // ── Enterprise diagnostics gateways ──
    api.registerGatewayMethod("pulumi/status", async ({ respond }) => {
      respond(true, {
        status: diag.gatewayFailures === 0 || diag.lastSuccessAt
          ? "operational"
          : "degraded",
        ...diag,
      });
    });

    api.registerGatewayMethod("pulumi/diagnostics/reset", async ({ respond }) => {
      diag.gatewayAttempts = 0;
      diag.gatewaySuccesses = 0;
      diag.gatewayFailures = 0;
      diag.lastError = null;
      diag.lastErrorAt = null;
      diag.lastSuccessAt = null;
      respond(true, { reset: true });
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
