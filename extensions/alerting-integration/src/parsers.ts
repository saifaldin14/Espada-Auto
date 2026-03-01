// ─── Webhook Parsers ───────────────────────────────────────────────────
//
// Converts raw PagerDuty, OpsGenie and CloudWatch Alarms webhook
// payloads into a NormalisedAlert.
// ───────────────────────────────────────────────────────────────────────

import type {
  AlertProvider,
  AlertSeverity,
  AlertStatus,
  NormalisedAlert,
  WebhookIngestInput,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  ID generator                                                        */
/* ------------------------------------------------------------------ */

import { randomUUID } from "node:crypto";

function generateAlertId(): string {
  return `alert-${randomUUID()}`;
}

/** @deprecated No-op — IDs now use crypto.randomUUID(). Kept for test compat. */
export function resetAlertCounter(): void {
  /* no-op */
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Provider auto-detection                                             */
/* ------------------------------------------------------------------ */

/**
 * Inspect the raw body to determine which provider sent the webhook.
 * Returns undefined if detection fails — caller should reject.
 */
export function detectProvider(body: unknown): AlertProvider | undefined {
  if (body == null || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;

  // PagerDuty: { "event": { "event_type": "incident.triggered", ... } }
  // or v2 webhook: { "messages": [{ "event": "incident.trigger", ... }] }
  if (obj.event && typeof obj.event === "object") {
    const ev = obj.event as Record<string, unknown>;
    if (typeof ev.event_type === "string" && ev.event_type.startsWith("incident.")) {
      return "pagerduty";
    }
  }
  if (Array.isArray(obj.messages)) {
    const first = obj.messages[0] as Record<string, unknown> | undefined;
    if (first && typeof first.event === "string" && String(first.event).includes("incident.")) {
      return "pagerduty";
    }
  }

  // OpsGenie: { "action": "Create", "alert": { ... } }
  if (typeof obj.action === "string" && obj.alert && typeof obj.alert === "object") {
    return "opsgenie";
  }

  // CloudWatch: { "source": "aws.cloudwatch", ... } or SNS wrapper
  if (obj.source === "aws.cloudwatch" || obj.AlarmName || obj.source === "aws.sns") {
    return "cloudwatch";
  }
  // SNS-wrapped CloudWatch — Message is JSON string with AlarmName
  if (typeof obj.Message === "string") {
    try {
      const inner = JSON.parse(obj.Message as string);
      if (inner.AlarmName) return "cloudwatch";
    } catch {
      // not SNS
    }
  }

  return undefined;
}

/* ------------------------------------------------------------------ */
/*  PagerDuty parser                                                    */
/* ------------------------------------------------------------------ */

function mapPagerDutySeverity(urgency: string | undefined): AlertSeverity {
  switch (urgency?.toLowerCase()) {
    case "high":
      return "critical";
    case "low":
      return "low";
    default:
      return "medium";
  }
}

function mapPagerDutyStatus(eventType: string): AlertStatus {
  if (eventType.includes("trigger")) return "triggered";
  if (eventType.includes("acknowledge")) return "acknowledged";
  if (eventType.includes("resolve")) return "resolved";
  return "triggered";
}

export function parsePagerDuty(body: unknown): NormalisedAlert {
  const obj = body as Record<string, unknown>;
  let incident: Record<string, unknown>;
  let eventType: string;

  // V3 webhook format: { event: { event_type, data: { ... } } }
  if (obj.event && typeof obj.event === "object") {
    const ev = obj.event as Record<string, unknown>;
    eventType = String(ev.event_type ?? "incident.triggered");
    incident = (ev.data as Record<string, unknown>) ?? {};
  }
  // V2 webhook format: { messages: [{ event, incident: { ... } }] }
  else if (Array.isArray(obj.messages) && obj.messages.length > 0) {
    const msg = obj.messages[0] as Record<string, unknown>;
    eventType = String(msg.event ?? "incident.trigger");
    incident = (msg.incident as Record<string, unknown>) ?? {};
  } else {
    // Fallback: treat the root as the incident
    incident = obj;
    eventType = "incident.triggered";
  }

  const service = incident.service as Record<string, unknown> | undefined;
  const urgency = incident.urgency as string | undefined;

  return {
    id: generateAlertId(),
    externalId: String(incident.id ?? incident.incident_number ?? "unknown"),
    provider: "pagerduty",
    severity: mapPagerDutySeverity(urgency),
    status: mapPagerDutyStatus(eventType),
    title: String(incident.title ?? incident.summary ?? "PagerDuty Alert"),
    description: String(incident.description ?? incident.summary ?? ""),
    service: String(service?.summary ?? service?.name ?? incident.service_name ?? "unknown"),
    environment: String((incident.escalation_policy as Record<string, unknown>)?.summary ?? "production"),
    raisedAt: String(incident.created_at ?? now()),
    receivedAt: now(),
    sourceUrl: String(incident.html_url ?? incident.self ?? ""),
    details: {
      incidentNumber: incident.incident_number,
      urgency,
      priority: incident.priority,
      assignments: incident.assignments,
      teams: incident.teams,
    },
    rawPayload: body,
    tags: Array.isArray(incident.labels)
      ? (incident.labels as Array<Record<string, string>>).map((l) => l.value ?? String(l))
      : [],
  };
}

/* ------------------------------------------------------------------ */
/*  OpsGenie parser                                                     */
/* ------------------------------------------------------------------ */

function mapOpsGenieSeverity(priority: string | undefined): AlertSeverity {
  switch (priority?.toUpperCase()) {
    case "P1":
      return "critical";
    case "P2":
      return "high";
    case "P3":
      return "medium";
    case "P4":
      return "low";
    case "P5":
      return "info";
    default:
      return "medium";
  }
}

function mapOpsGenieStatus(action: string): AlertStatus {
  switch (action.toLowerCase()) {
    case "create":
      return "triggered";
    case "acknowledge":
      return "acknowledged";
    case "close":
      return "resolved";
    case "addnote":
    case "addrecipient":
    case "addteam":
    case "addtags":
      return "triggered"; // supplementary events keep the alert triggered
    default:
      return "triggered";
  }
}

export function parseOpsGenie(body: unknown): NormalisedAlert {
  const obj = body as Record<string, unknown>;
  const action = String(obj.action ?? "Create");
  const alert = (obj.alert as Record<string, unknown>) ?? {};

  const tags = Array.isArray(alert.tags) ? (alert.tags as string[]) : [];
  const details = (alert.details as Record<string, unknown>) ?? {};

  return {
    id: generateAlertId(),
    externalId: String(alert.alertId ?? alert.tinyId ?? "unknown"),
    provider: "opsgenie",
    severity: mapOpsGenieSeverity(alert.priority as string | undefined),
    status: mapOpsGenieStatus(action),
    title: String(alert.message ?? "OpsGenie Alert"),
    description: String(alert.description ?? ""),
    service: String(alert.source ?? details.service ?? "unknown"),
    environment: String(details.environment ?? "production"),
    raisedAt: String(alert.createdAt ?? now()),
    receivedAt: now(),
    sourceUrl: String(obj.alertUrl ?? alert.alertUrl ?? ""),
    details: {
      action,
      alias: alert.alias,
      entity: alert.entity,
      priority: alert.priority,
      responders: alert.responders,
      teams: alert.teams,
      ...details,
    },
    rawPayload: body,
    tags,
  };
}

/* ------------------------------------------------------------------ */
/*  CloudWatch Alarms parser                                            */
/* ------------------------------------------------------------------ */

function mapCloudWatchSeverity(
  newState: string | undefined,
  metricName?: string,
): AlertSeverity {
  // No custom severity in CloudWatch; infer from state + metric name
  if (newState === "ALARM") {
    if (metricName && /cpu|memory|error|5xx/i.test(metricName)) return "high";
    return "medium";
  }
  if (newState === "INSUFFICIENT_DATA") return "low";
  return "info"; // OK
}

function mapCloudWatchStatus(newState: string | undefined): AlertStatus {
  switch (newState) {
    case "ALARM":
      return "triggered";
    case "OK":
      return "resolved";
    case "INSUFFICIENT_DATA":
      return "triggered";
    default:
      return "triggered";
  }
}

export function parseCloudWatch(body: unknown): NormalisedAlert {
  let alarm: Record<string, unknown>;

  // Body might be an SNS notification wrapping the CloudWatch alarm JSON
  const rootObj = body as Record<string, unknown>;
  if (typeof rootObj.Message === "string") {
    try {
      alarm = JSON.parse(rootObj.Message as string);
    } catch {
      alarm = rootObj;
    }
  } else {
    alarm = rootObj;
  }

  const newState = String(alarm.NewStateValue ?? alarm.newStateValue ?? "ALARM");
  const metricName = alarm.Trigger
    ? String((alarm.Trigger as Record<string, unknown>).MetricName ?? "")
    : String(alarm.MetricName ?? "");

  const region =
    String(alarm.Region ?? alarm.region ?? "unknown");
  const accountId = String(alarm.AWSAccountId ?? alarm.accountId ?? "");

  return {
    id: generateAlertId(),
    externalId: String(alarm.AlarmName ?? alarm.alarmName ?? "unknown"),
    provider: "cloudwatch",
    severity: mapCloudWatchSeverity(newState, metricName),
    status: mapCloudWatchStatus(newState),
    title: String(alarm.AlarmName ?? alarm.alarmName ?? "CloudWatch Alarm"),
    description: String(
      alarm.AlarmDescription ?? alarm.NewStateReason ?? alarm.newStateReason ?? "",
    ),
    service: metricName || "cloudwatch",
    environment: region,
    raisedAt: String(alarm.StateChangeTime ?? alarm.stateChangeTime ?? now()),
    receivedAt: now(),
    sourceUrl: accountId
      ? `https://console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(String(alarm.AlarmName ?? ""))}`
      : "",
    details: {
      accountId,
      region,
      metricName,
      namespace: alarm.Namespace ?? alarm.namespace ?? (alarm.Trigger ? (alarm.Trigger as Record<string, unknown>).Namespace : undefined),
      newState,
      oldState: alarm.OldStateValue ?? alarm.oldStateValue,
      reason: alarm.NewStateReason ?? alarm.newStateReason,
      trigger: alarm.Trigger ?? alarm.trigger,
    },
    rawPayload: body,
    tags: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Unified ingest entry-point                                          */
/* ------------------------------------------------------------------ */

export type ParseResult =
  | { success: true; alert: NormalisedAlert }
  | { success: false; error: string };

/**
 * Parse a raw webhook body into a NormalisedAlert.
 * Auto-detects the provider if not specified.
 */
export function parseWebhook(input: WebhookIngestInput): ParseResult {
  const provider = input.provider ?? detectProvider(input.body);

  if (!provider) {
    return {
      success: false,
      error:
        "Unable to detect alert provider. Supply provider explicitly or check the webhook payload.",
    };
  }

  try {
    let alert: NormalisedAlert;
    switch (provider) {
      case "pagerduty":
        alert = parsePagerDuty(input.body);
        break;
      case "opsgenie":
        alert = parseOpsGenie(input.body);
        break;
      case "cloudwatch":
        alert = parseCloudWatch(input.body);
        break;
      default:
        return { success: false, error: `Unsupported provider: ${String(provider)}` };
    }
    return { success: true, alert };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse ${provider} webhook: ${message}` };
  }
}
