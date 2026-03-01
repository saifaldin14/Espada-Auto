import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createLifecycleTools } from "./src/tools.js";

export default {
  id: "incident-lifecycle",
  name: "Structured Incident Lifecycle",
  register(api: EspadaPluginApi) {
    // Register all 8 lifecycle agent tools
    for (const tool of createLifecycleTools()) {
      api.registerTool(tool as any);
    }

    // ── Gateway methods ──────────────────────────────────────────

    api.registerGatewayMethod(
      "lifecycle/create",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { createLifecycleIncident } = await import("./src/state-machine.js");
          const { getStore } = await import("./src/tools.js");
          const lc = createLifecycleIncident(params);
          getStore().set(lc.id, lc);
          respond(true, { lifecycleId: lc.id, phase: lc.phase });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );

    api.registerGatewayMethod(
      "lifecycle/classify",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { classifyIncident } = await import("./src/state-machine.js");
          const { getStore } = await import("./src/tools.js");
          const store = getStore();
          const lc = store.get(params.lifecycleId);
          if (!lc) { respond(false, { error: "Lifecycle not found" }); return; }
          const result = classifyIncident(lc, params.triggeredBy ?? "system");
          if (!result.success) { respond(false, { error: result.error }); return; }
          store.set(result.incident.id, result.incident);
          respond(true, { classification: result.incident.classification });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );

    api.registerGatewayMethod(
      "lifecycle/dashboard",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { filterLifecycles, buildDashboard } = await import("./src/state-machine.js");
          const { getStore } = await import("./src/tools.js");
          const all = Array.from(getStore().values());
          const filtered = filterLifecycles(all, params.filter ?? {});
          const dashboard = buildDashboard(filtered);
          respond(true, { dashboard, count: filtered.length });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );

    api.registerGatewayMethod(
      "lifecycle/remediate",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { planRemediation } = await import("./src/remediation.js");
          const { getStore } = await import("./src/tools.js");
          const store = getStore();
          const lc = store.get(params.lifecycleId);
          if (!lc) { respond(false, { error: "Lifecycle not found" }); return; }
          const result = planRemediation(lc, params);
          if (!result.success) { respond(false, { error: result.error }); return; }
          store.set(result.incident.id, result.incident);
          respond(true, { remediation: result.incident.remediation });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );

    api.registerGatewayMethod(
      "lifecycle/postmortem",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { generatePostMortem } = await import("./src/post-mortem.js");
          const { getStore } = await import("./src/tools.js");
          const store = getStore();
          const lc = store.get(params.lifecycleId);
          if (!lc) { respond(false, { error: "Lifecycle not found" }); return; }
          const result = generatePostMortem(lc, params);
          if (!result.success) { respond(false, { error: result.error }); return; }
          store.set(result.incident.id, result.incident);
          respond(true, { postMortem: result.incident.postMortem });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );
  },
};
