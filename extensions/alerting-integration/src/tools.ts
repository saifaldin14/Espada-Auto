// ─── Alerting Integration Agent Tools ──────────────────────────────────
//
// 8 agent tools for alerting integration:
// 1. alerting_ingest       — Ingest a webhook payload (parse + route + dispatch)
// 2. alerting_list_alerts  — List / filter ingested alerts
// 3. alerting_get_alert    — Get a single alert by ID
// 4. alerting_add_route    — Add a routing rule
// 5. alerting_list_routes  — List routing rules
// 6. alerting_remove_route — Remove a routing rule
// 7. alerting_add_channel  — Register a dispatch channel
// 8. alerting_dashboard    — View aggregated dashboard
// ───────────────────────────────────────────────────────────────────────

import { Type } from "@sinclair/typebox";
import type {
  NormalisedAlert,
  RoutingRule,
  MatchCondition,
  DispatchChannel,
  DispatchRecord,
  AlertProvider,
  DispatchChannelType,
  MatchOperator,
} from "./types.js";
import { parseWebhook } from "./parsers.js";
import {
  dispatchToChannels,
  defaultSender,
  type ChannelSender,
} from "./dispatcher.js";
import {
  resolveRoutes,
  shouldSuppress,
  filterAlerts,
  buildDashboard,
} from "./router.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

/* ------------------------------------------------------------------ */
/*  In-memory stores                                                    */
/* ------------------------------------------------------------------ */

const alertStore = new Map<string, NormalisedAlert>();
const routeStore = new Map<string, RoutingRule>();
const channelStore = new Map<string, DispatchChannel>();
const dispatchStore: DispatchRecord[] = [];

export function getAlertStore(): Map<string, NormalisedAlert> {
  return alertStore;
}
export function getRouteStore(): Map<string, RoutingRule> {
  return routeStore;
}
export function getChannelStore(): Map<string, DispatchChannel> {
  return channelStore;
}
export function getDispatchStore(): DispatchRecord[] {
  return dispatchStore;
}

export function clearStores(): void {
  alertStore.clear();
  routeStore.clear();
  channelStore.clear();
  dispatchStore.length = 0;
}

/* ------------------------------------------------------------------ */
/*  Validation helpers                                                  */
/* ------------------------------------------------------------------ */

const validProviders = new Set<string>([
  "pagerduty",
  "opsgenie",
  "cloudwatch",
]);

const validChannelTypes = new Set<string>([
  "slack",
  "discord",
  "msteams",
  "telegram",
  "matrix",
  "webhook",
  "custom",
]);

const validMatchOperators = new Set<string>([
  "equals",
  "contains",
  "regex",
  "any",
]);

const validConditionFields = new Set<string>([
  "id",
  "externalId",
  "provider",
  "severity",
  "status",
  "title",
  "description",
  "service",
  "environment",
  "raisedAt",
  "receivedAt",
  "sourceUrl",
  "tags",
]);

/* ------------------------------------------------------------------ */
/*  ID generators                                                       */
/* ------------------------------------------------------------------ */

import { randomUUID } from "node:crypto";

function generateRouteId(): string {
  return `route-${randomUUID()}`;
}

function generateChannelId(): string {
  return `channel-${randomUUID()}`;
}

/** @deprecated No-op — IDs now use crypto.randomUUID(). Kept for test compat. */
export function resetToolCounters(): void {
  /* no-op */
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Configurable sender (default: defaultSender for simulation)         */
/* ------------------------------------------------------------------ */

let _sender: ChannelSender = defaultSender;

export function setSender(sender: ChannelSender): void {
  _sender = sender;
}

export function getSender(): ChannelSender {
  return _sender;
}

export function resetSender(): void {
  _sender = defaultSender;
}

/* ------------------------------------------------------------------ */
/*  Tool definitions                                                    */
/* ------------------------------------------------------------------ */

const alertingIngestTool = {
  name: "alerting_ingest",
  description:
    "Ingest a raw webhook payload from PagerDuty, OpsGenie, or CloudWatch Alarms. " +
    "Parses the payload into a normalised alert, evaluates routing rules, and " +
    "dispatches messages to matched channels.",
  inputSchema: Type.Object({
    body: Type.String({
      description: "Raw JSON body from the webhook (as a JSON string).",
    }),
    provider: Type.Optional(
      Type.String({
        description:
          'Alert provider hint: "pagerduty", "opsgenie", or "cloudwatch". Auto-detected if omitted.',
      }),
    ),
  }),
  async execute(input: { body: string; provider?: string }) {
    // Validate provider if specified
    if (input.provider && !validProviders.has(input.provider)) {
      return err(
        `Invalid provider: ${input.provider}. Valid: ${[...validProviders].join(", ")}`,
      );
    }

    // Parse JSON body
    let body: unknown;
    try {
      body = JSON.parse(input.body);
    } catch {
      return err("Invalid JSON in body");
    }

    // Parse webhook
    const parseResult = parseWebhook({
      body,
      provider: input.provider as AlertProvider | undefined,
    });
    if (!parseResult.success) {
      return err(parseResult.error);
    }

    const alert = parseResult.alert;

    // Deduplication: if we already have an alert from the same provider
    // with the same external ID, return the existing one instead of
    // creating a duplicate (webhook retry / duplicate delivery).
    const dedupKey = `${alert.provider}:${alert.externalId}`;
    for (const existing of alertStore.values()) {
      if (`${existing.provider}:${existing.externalId}` === dedupKey) {
        return ok({
          alertId: existing.id,
          provider: existing.provider,
          severity: existing.severity,
          status: existing.status,
          title: existing.title,
          duplicate: true,
          originalAlertId: existing.id,
        });
      }
    }

    // Store the alert
    alertStore.set(alert.id, alert);

    // Check suppression
    if (shouldSuppress(alert)) {
      return ok({
        alertId: alert.id,
        provider: alert.provider,
        severity: alert.severity,
        status: alert.status,
        title: alert.title,
        suppressed: true,
        dispatches: [],
      });
    }

    // Resolve routes and dispatch
    const rules = Array.from(routeStore.values());
    const matches = resolveRoutes(alert, rules, channelStore);

    const allDispatches: DispatchRecord[] = [];
    for (const match of matches) {
      const records = await dispatchToChannels(
        alert,
        match.channels,
        match.rule.id,
        _sender,
        match.rule.template,
      );
      allDispatches.push(...records);
    }

    // Store dispatches
    dispatchStore.push(...allDispatches);

    return ok({
      alertId: alert.id,
      provider: alert.provider,
      severity: alert.severity,
      status: alert.status,
      title: alert.title,
      service: alert.service,
      suppressed: false,
      matchedRules: matches.map((m) => m.rule.id),
      dispatches: allDispatches.map((d) => ({
        id: d.id,
        channelId: d.channelId,
        status: d.status,
        error: d.error,
      })),
    });
  },
};

const alertingListAlertsTool = {
  name: "alerting_list_alerts",
  description:
    "List ingested alerts, optionally filtered by provider, severity, status, or service.",
  inputSchema: Type.Object({
    provider: Type.Optional(Type.String({ description: "Filter by provider" })),
    severity: Type.Optional(Type.String({ description: "Filter by severity" })),
    status: Type.Optional(Type.String({ description: "Filter by status" })),
    service: Type.Optional(Type.String({ description: "Filter by service (substring match)" })),
    since: Type.Optional(Type.String({ description: "ISO-8601 timestamp — only alerts after this" })),
  }),
  async execute(input: {
    provider?: string;
    severity?: string;
    status?: string;
    service?: string;
    since?: string;
  }) {
    const all = Array.from(alertStore.values());
    const filtered = filterAlerts(all, {
      provider: input.provider as AlertProvider | undefined,
      severity: input.severity as any,
      status: input.status as any,
      service: input.service,
      since: input.since,
    });

    return ok({
      total: filtered.length,
      alerts: filtered.map((a) => ({
        id: a.id,
        externalId: a.externalId,
        provider: a.provider,
        severity: a.severity,
        status: a.status,
        title: a.title,
        service: a.service,
        raisedAt: a.raisedAt,
      })),
    });
  },
};

const alertingGetAlertTool = {
  name: "alerting_get_alert",
  description: "Get full details of a single alert by its ID.",
  inputSchema: Type.Object({
    alertId: Type.String({ description: "The alert ID to retrieve." }),
  }),
  async execute(input: { alertId: string }) {
    const alert = alertStore.get(input.alertId);
    if (!alert) {
      return err(`Alert not found: ${input.alertId}`);
    }

    // Find related dispatches
    const dispatches = dispatchStore.filter((d) => d.alertId === input.alertId);

    return ok({
      alert: {
        ...alert,
        rawPayload: undefined, // omit raw from tool output
      },
      dispatches: dispatches.map((d) => ({
        id: d.id,
        channelId: d.channelId,
        ruleId: d.ruleId,
        status: d.status,
        dispatchedAt: d.dispatchedAt,
        error: d.error,
      })),
    });
  },
};

const alertingAddRouteTool = {
  name: "alerting_add_route",
  description:
    "Add a routing rule that maps alerts to dispatch channels. " +
    "Conditions use AND logic. Supports equals, contains, regex, and any operators.",
  inputSchema: Type.Object({
    name: Type.String({ description: "Human-readable rule name." }),
    priority: Type.Optional(
      Type.Number({ description: "Priority (lower = evaluated first). Default: 100." }),
    ),
    conditions: Type.Optional(
      Type.String({
        description:
          'JSON array of conditions: [{"field":"severity","operator":"equals","value":"critical"}]. ' +
          "Fields: provider, severity, status, service, title, environment, tags. " +
          "Operators: equals, contains, regex, any.",
      }),
    ),
    channelIds: Type.String({
      description: "Comma-separated channel IDs to dispatch to.",
    }),
    template: Type.Optional(
      Type.String({
        description:
          "Custom message template with {{field}} placeholders (e.g. {{title}}, {{severity}}).",
      }),
    ),
    stopOnMatch: Type.Optional(
      Type.Boolean({ description: "Stop evaluating further rules on match. Default: false." }),
    ),
  }),
  async execute(input: {
    name: string;
    priority?: number;
    conditions?: string;
    channelIds: string;
    template?: string;
    stopOnMatch?: boolean;
  }) {
    // Parse conditions
    let conditions: MatchCondition[] = [];
    if (input.conditions) {
      try {
        const parsed = JSON.parse(input.conditions);
        if (!Array.isArray(parsed)) {
          return err("conditions must be a JSON array");
        }
        for (const cond of parsed) {
          if (!cond.field) {
            return err("Each condition must have a 'field' property");
          }
          if (!cond.operator) {
            return err("Each condition must have an 'operator' property");
          }
          if (cond.operator && !validMatchOperators.has(cond.operator)) {
            return err(
              `Invalid operator: ${cond.operator}. Valid: ${[...validMatchOperators].join(", ")}`,
            );
          }
          if (cond.field && !validConditionFields.has(cond.field)) {
            return err(
              `Invalid condition field: ${cond.field}. Valid: ${[...validConditionFields].join(", ")}`,
            );
          }
          if (cond.operator !== "any" && cond.value == null) {
            return err(
              `Condition on '${cond.field}' with '${cond.operator}' requires a 'value'`,
            );
          }
        }
        conditions = parsed;
      } catch {
        return err("Invalid JSON in conditions");
      }
    }

    // Parse channel IDs
    const channelIds = input.channelIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Verify channels exist
    const missing = channelIds.filter((id) => !channelStore.has(id));
    if (missing.length > 0) {
      return err(`Unknown channel IDs: ${missing.join(", ")}`);
    }

    const rule: RoutingRule = {
      id: generateRouteId(),
      name: input.name,
      priority: input.priority ?? 100,
      enabled: true,
      conditions,
      channelIds,
      template: input.template,
      stopOnMatch: input.stopOnMatch ?? false,
      createdAt: now(),
    };

    routeStore.set(rule.id, rule);

    return ok({
      routeId: rule.id,
      name: rule.name,
      priority: rule.priority,
      conditionCount: conditions.length,
      channelIds,
    });
  },
};

const alertingListRoutesTool = {
  name: "alerting_list_routes",
  description: "List all routing rules, sorted by priority.",
  inputSchema: Type.Object({}),
  async execute() {
    const rules = Array.from(routeStore.values()).sort(
      (a, b) => a.priority - b.priority,
    );

    return ok({
      total: rules.length,
      routes: rules.map((r) => ({
        id: r.id,
        name: r.name,
        priority: r.priority,
        enabled: r.enabled,
        conditionCount: r.conditions.length,
        channelIds: r.channelIds,
        stopOnMatch: r.stopOnMatch,
      })),
    });
  },
};

const alertingRemoveRouteTool = {
  name: "alerting_remove_route",
  description: "Remove a routing rule by ID.",
  inputSchema: Type.Object({
    routeId: Type.String({ description: "The routing rule ID to remove." }),
  }),
  async execute(input: { routeId: string }) {
    if (!routeStore.has(input.routeId)) {
      return err(`Route not found: ${input.routeId}`);
    }
    routeStore.delete(input.routeId);
    return ok({ removed: input.routeId });
  },
};

const alertingAddChannelTool = {
  name: "alerting_add_channel",
  description:
    "Register a dispatch channel that can receive alert messages. " +
    "Supported types: slack, discord, msteams, telegram, matrix, webhook, custom.",
  inputSchema: Type.Object({
    name: Type.String({ description: "Human-readable channel name (e.g. #ops-critical)." }),
    type: Type.String({
      description:
        'Channel type: "slack", "discord", "msteams", "telegram", "matrix", "webhook", or "custom".',
    }),
    config: Type.Optional(
      Type.String({
        description:
          "JSON object with channel-specific config (e.g. webhook URL, chat ID).",
      }),
    ),
  }),
  async execute(input: { name: string; type: string; config?: string }) {
    if (!validChannelTypes.has(input.type)) {
      return err(
        `Invalid channel type: ${input.type}. Valid: ${[...validChannelTypes].join(", ")}`,
      );
    }

    let config: Record<string, unknown> = {};
    if (input.config) {
      try {
        config = JSON.parse(input.config);
      } catch {
        return err("Invalid JSON in config");
      }
    }

    const channel: DispatchChannel = {
      id: generateChannelId(),
      name: input.name,
      type: input.type as DispatchChannelType,
      config,
      createdAt: now(),
    };

    channelStore.set(channel.id, channel);

    return ok({
      channelId: channel.id,
      name: channel.name,
      type: channel.type,
    });
  },
};

const alertingDashboardTool = {
  name: "alerting_dashboard",
  description:
    "View an aggregated dashboard of alert statistics: counts by provider, " +
    "severity, status, dispatch success rate, and recent alerts.",
  inputSchema: Type.Object({}),
  async execute() {
    const alerts = Array.from(alertStore.values());
    const rules = Array.from(routeStore.values());
    const channels = Array.from(channelStore.values());

    const dashboard = buildDashboard(alerts, dispatchStore, rules, channels);

    return ok({ dashboard });
  },
};

/* ------------------------------------------------------------------ */
/*  Export factory                                                      */
/* ------------------------------------------------------------------ */

export function createAlertingTools() {
  return [
    alertingIngestTool,
    alertingListAlertsTool,
    alertingGetAlertTool,
    alertingAddRouteTool,
    alertingListRoutesTool,
    alertingRemoveRouteTool,
    alertingAddChannelTool,
    alertingDashboardTool,
  ];
}
