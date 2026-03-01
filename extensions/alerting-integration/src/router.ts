// ─── Routing Engine ────────────────────────────────────────────────────
//
// Evaluates routing rules against normalised alerts to determine which
// channels should receive dispatch, then orchestrates end-to-end
// ingest → parse → route → dispatch → record.
// ───────────────────────────────────────────────────────────────────────

import type {
  NormalisedAlert,
  RoutingRule,
  MatchCondition,
  DispatchChannel,
  DispatchRecord,
  AlertDashboard,
  AlertFilter,
  AlertProvider,
  AlertSeverity,
  AlertStatus,
  WebhookIngestInput,
} from "./types.js";
import { parseWebhook, type ParseResult } from "./parsers.js";
import {
  dispatchToChannels,
  type ChannelSender,
  defaultSender,
} from "./dispatcher.js";

/* ------------------------------------------------------------------ */
/*  Condition matching                                                  */
/* ------------------------------------------------------------------ */

/**
 * Evaluate a single match condition against a normalised alert.
 */
export function evaluateCondition(
  condition: MatchCondition,
  alert: NormalisedAlert,
): boolean {
  const rawValue = alert[condition.field];
  const fieldValue =
    rawValue == null ? "" : typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
  const condValue = (condition.value as string | undefined) ?? "";

  switch (condition.operator) {
    case "any":
      return true;
    case "equals":
      return fieldValue === condValue;
    case "contains":
      return fieldValue.toLowerCase().includes(condValue.toLowerCase());
    case "regex": {
      try {
        const re = new RegExp(condValue, "i");
        return re.test(fieldValue);
      } catch {
        return false; // invalid regex → no match
      }
    }
    default:
      return false;
  }
}

/**
 * Evaluate all conditions of a rule (AND logic).
 */
export function evaluateRule(
  rule: RoutingRule,
  alert: NormalisedAlert,
): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return true; // no conditions = catch-all
  return rule.conditions.every((cond) => evaluateCondition(cond, alert));
}

/* ------------------------------------------------------------------ */
/*  Route resolution                                                    */
/* ------------------------------------------------------------------ */

export type RouteMatch = {
  rule: RoutingRule;
  channels: DispatchChannel[];
};

/**
 * Resolve which routing rules match a given alert.
 * Rules are sorted by priority (ascending); processing stops if a
 * matched rule has `stopOnMatch === true`.
 */
export function resolveRoutes(
  alert: NormalisedAlert,
  rules: RoutingRule[],
  channelMap: Map<string, DispatchChannel>,
): RouteMatch[] {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const matches: RouteMatch[] = [];

  for (const rule of sorted) {
    if (!evaluateRule(rule, alert)) continue;

    const channels = rule.channelIds
      .map((id) => channelMap.get(id))
      .filter((ch): ch is DispatchChannel => ch != null);

    if (channels.length > 0) {
      matches.push({ rule, channels });
    }

    if (rule.stopOnMatch) break;
  }

  return matches;
}

/* ------------------------------------------------------------------ */
/*  Suppression logic                                                   */
/* ------------------------------------------------------------------ */

/**
 * Determine whether an alert should be suppressed (e.g. resolved alerts
 * don't need to be dispatched unless explicitly routed).
 */
export function shouldSuppress(alert: NormalisedAlert): boolean {
  return alert.status === "suppressed";
}

/* ------------------------------------------------------------------ */
/*  Filtering                                                           */
/* ------------------------------------------------------------------ */

/**
 * Filter a list of alerts by criteria.
 */
export function filterAlerts(
  alerts: NormalisedAlert[],
  filter: AlertFilter,
): NormalisedAlert[] {
  return alerts.filter((a) => {
    if (filter.provider && a.provider !== filter.provider) return false;
    if (filter.severity && a.severity !== filter.severity) return false;
    if (filter.status && a.status !== filter.status) return false;
    if (filter.service && !a.service.toLowerCase().includes(filter.service.toLowerCase()))
      return false;
    if (filter.since && a.receivedAt < filter.since) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  Dashboard builder                                                   */
/* ------------------------------------------------------------------ */

const PROVIDERS: AlertProvider[] = ["pagerduty", "opsgenie", "cloudwatch"];
const SEVERITIES: AlertSeverity[] = ["critical", "high", "medium", "low", "info"];
const STATUSES: AlertStatus[] = ["triggered", "acknowledged", "resolved", "suppressed"];

/**
 * Build an aggregated dashboard from alerts, dispatches, and config.
 */
export function buildDashboard(
  alerts: NormalisedAlert[],
  dispatches: DispatchRecord[],
  rules: RoutingRule[],
  channels: DispatchChannel[],
): AlertDashboard {
  const byProvider = Object.fromEntries(PROVIDERS.map((p) => [p, 0])) as Record<
    AlertProvider,
    number
  >;
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
    AlertSeverity,
    number
  >;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    AlertStatus,
    number
  >;

  for (const a of alerts) {
    byProvider[a.provider] = (byProvider[a.provider] ?? 0) + 1;
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  }

  const sentCount = dispatches.filter((d) => d.status === "sent").length;
  const totalDispatches = dispatches.length;

  return {
    totalAlerts: alerts.length,
    byProvider,
    bySeverity,
    byStatus,
    totalDispatches,
    dispatchSuccessRate: totalDispatches > 0 ? sentCount / totalDispatches : 1,
    recentAlerts: alerts.slice(-10),
    activeRoutes: rules.filter((r) => r.enabled).length,
    registeredChannels: channels.length,
  };
}

/* ------------------------------------------------------------------ */
/*  End-to-end pipeline                                                 */
/* ------------------------------------------------------------------ */

export type IngestResult = {
  alert: NormalisedAlert;
  dispatches: DispatchRecord[];
  matchedRules: string[];
  suppressed: boolean;
};

/**
 * Full ingest pipeline: parse → suppress-check → route → dispatch → record.
 */
export async function ingestAlert(
  input: WebhookIngestInput,
  rules: RoutingRule[],
  channelMap: Map<string, DispatchChannel>,
  sender: ChannelSender = defaultSender,
): Promise<{ success: true; result: IngestResult } | { success: false; error: string }> {
  // 1. Parse
  const parseResult: ParseResult = parseWebhook(input);
  if (!parseResult.success) {
    return { success: false, error: parseResult.error };
  }
  const alert = parseResult.alert;

  // 2. Suppression check
  if (shouldSuppress(alert)) {
    return {
      success: true,
      result: {
        alert,
        dispatches: [],
        matchedRules: [],
        suppressed: true,
      },
    };
  }

  // 3. Route resolution
  const matches = resolveRoutes(alert, rules, channelMap);

  // 4. Dispatch to all matched channels
  const allDispatches: DispatchRecord[] = [];
  const matchedRuleIds: string[] = [];

  for (const match of matches) {
    matchedRuleIds.push(match.rule.id);
    const records = await dispatchToChannels(
      alert,
      match.channels,
      match.rule.id,
      sender,
      match.rule.template,
    );
    allDispatches.push(...records);
  }

  return {
    success: true,
    result: {
      alert,
      dispatches: allDispatches,
      matchedRules: matchedRuleIds,
      suppressed: false,
    },
  };
}
