/**
 * @espada/kubernetes — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createK8sTools } from "./src/tools.js";
import { createHelmTools } from "./src/helm-tools.js";
import { createK8sCli } from "./src/cli.js";
import { validateK8sResourceName } from "../cloud-utils/input-validation.js";

// ── Enterprise Diagnostics ──────────────────────────────────────────────
type K8sDiagnostics = {
  gatewayAttempts: number;
  gatewaySuccesses: number;
  gatewayFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
};

const diag: K8sDiagnostics = {
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
  id: "kubernetes",
  name: "Kubernetes Management",
  register(api: EspadaPluginApi) {
    for (const tool of createK8sTools()) {
      api.registerTool(tool as any);
    }
    for (const tool of createHelmTools()) {
      api.registerTool(tool as any);
    }

    api.registerCli((ctx) => createK8sCli()(ctx), { commands: ["k8s"] });

    api.registerGatewayMethod("k8s/resources", async ({ params, respond }) => {
      const { kubectlGet } = await import("./src/cli-wrapper.js");
      const { parseManifestJson, parseResources } = await import("./src/manifest-parser.js");
      const p = params as { resource: string; namespace?: string };
      if (p.namespace) {
        const nsCheck = validateK8sResourceName(p.namespace, "namespace");
        if (!nsCheck.valid) { trackFailure(new Error(nsCheck.reason)); respond(false, { error: nsCheck.reason }); return; }
      }
      try {
        const json = await kubectlGet(p.resource, { namespace: p.namespace });
        const manifest = parseManifestJson(json);
        const parsed = parseResources(manifest.resources);
        trackSuccess();
        respond(true, { count: parsed.length, resources: parsed });
      } catch (err) {
        trackFailure(err);
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("k8s/namespaces", async ({ respond }) => {
      const { kubectlGetNamespaces } = await import("./src/cli-wrapper.js");
      const { parseManifestJson, parseResources } = await import("./src/manifest-parser.js");
      try {
        const json = await kubectlGetNamespaces();
        const manifest = parseManifestJson(json);
        const parsed = parseResources(manifest.resources);
        trackSuccess();
        respond(true, parsed.map((r) => ({ name: r.name, labels: r.labels })));
      } catch (err) {
        trackFailure(err);
        respond(false, { error: String(err) });
      }
    });

    // ── Enterprise diagnostics gateways ──
    api.registerGatewayMethod("k8s/status", async ({ respond }) => {
      respond(true, {
        status: diag.gatewayFailures === 0 || diag.lastSuccessAt
          ? "operational"
          : "degraded",
        ...diag,
      });
    });

    api.registerGatewayMethod("k8s/diagnostics/reset", async ({ respond }) => {
      diag.gatewayAttempts = 0;
      diag.gatewaySuccesses = 0;
      diag.gatewayFailures = 0;
      diag.lastError = null;
      diag.lastErrorAt = null;
      diag.lastSuccessAt = null;
      respond(true, { reset: true });
    });

    api.registerService({
      id: "kubernetes",
      start: async () => {
        api.logger?.info("[kubernetes] Plugin loaded");
      },
      stop: async () => {},
    });
  },
};
