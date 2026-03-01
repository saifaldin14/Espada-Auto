import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createAlertingTools } from "./src/tools.js";

export default {
  id: "alerting-integration",
  name: "Alerting Integration",
  register(api: EspadaPluginApi) {
    // Register all 8 alerting agent tools
    for (const tool of createAlertingTools()) {
      api.registerTool(tool as any);
    }

    // ── Gateway methods ──────────────────────────────────────────

    api.registerGatewayMethod(
      "alerting/ingest",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { parseWebhook } = await import("./src/parsers.js");
          const { resolveRoutes, shouldSuppress } = await import("./src/router.js");
          const { dispatchToChannels } = await import("./src/dispatcher.js");
          const {
            getAlertStore,
            getRouteStore,
            getChannelStore,
            getDispatchStore,
            getSender,
          } = await import("./src/tools.js");

          const result = parseWebhook({
            body: params.body,
            provider: params.provider,
          });
          if (!result.success) {
            respond(false, { error: result.error });
            return;
          }

          const alert = result.alert;

          // Deduplication — same provider + externalId → return existing
          const dedupKey = `${alert.provider}:${alert.externalId}`;
          for (const existing of getAlertStore().values()) {
            if (`${existing.provider}:${existing.externalId}` === dedupKey) {
              respond(true, {
                alertId: existing.id,
                duplicate: true,
                dispatches: 0,
              });
              return;
            }
          }

          getAlertStore().set(alert.id, alert);

          if (shouldSuppress(alert)) {
            respond(true, { alertId: alert.id, suppressed: true, dispatches: [] });
            return;
          }

          const rules = Array.from(getRouteStore().values());
          const matches = resolveRoutes(alert, rules, getChannelStore());

          const dispatches = [];
          for (const match of matches) {
            const records = await dispatchToChannels(
              alert,
              match.channels,
              match.rule.id,
              getSender(),
              match.rule.template,
            );
            dispatches.push(...records);
          }
          getDispatchStore().push(...dispatches);

          respond(true, {
            alertId: alert.id,
            provider: alert.provider,
            severity: alert.severity,
            dispatches: dispatches.length,
          });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );

    api.registerGatewayMethod(
      "alerting/routes",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { getRouteStore } = await import("./src/tools.js");
          const rules = Array.from(getRouteStore().values()).sort(
            (a, b) => a.priority - b.priority,
          );
          respond(true, { routes: rules, total: rules.length });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );

    api.registerGatewayMethod(
      "alerting/dashboard",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { buildDashboard } = await import("./src/router.js");
          const {
            getAlertStore,
            getRouteStore,
            getChannelStore,
            getDispatchStore,
          } = await import("./src/tools.js");

          const alerts = Array.from(getAlertStore().values());
          const rules = Array.from(getRouteStore().values());
          const channels = Array.from(getChannelStore().values());
          const dashboard = buildDashboard(alerts, getDispatchStore(), rules, channels);
          respond(true, { dashboard });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );

    api.registerGatewayMethod(
      "alerting/alerts",
      async ({ params, respond }: { params: any; respond: (ok: boolean, data: any) => void }) => {
        try {
          const { filterAlerts } = await import("./src/router.js");
          const { getAlertStore } = await import("./src/tools.js");
          const all = Array.from(getAlertStore().values());
          const filtered = filterAlerts(all, params.filter ?? {});
          respond(true, { alerts: filtered, total: filtered.length });
        } catch (e: any) {
          respond(false, { error: e.message });
        }
      },
    );
  },
};
