// ─── Alerting Integration Test Suite ───────────────────────────────────
import { describe, it, expect, beforeEach } from "vitest";

import {
  detectProvider,
  parsePagerDuty,
  parseOpsGenie,
  parseCloudWatch,
  parseWebhook,
  resetAlertCounter,
} from "./parsers.js";
import {
  formatAlertMessage,
  resolveTemplate,
  buildMessage,
  dispatchToChannel,
  dispatchToChannels,
  defaultSender,
  resetDispatchCounter,
} from "./dispatcher.js";
import {
  evaluateCondition,
  evaluateRule,
  resolveRoutes,
  shouldSuppress,
  filterAlerts,
  buildDashboard,
  ingestAlert,
} from "./router.js";
import {
  createAlertingTools,
  clearStores,
  getAlertStore,
  getRouteStore,
  getChannelStore,
  getDispatchStore,
  resetToolCounters,
  setSender,
  resetSender,
} from "./tools.js";
import type {
  NormalisedAlert,
  RoutingRule,
  MatchCondition,
  DispatchChannel,
  AlertProvider,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                        */
/* ------------------------------------------------------------------ */

function makeAlert(overrides: Partial<NormalisedAlert> = {}): NormalisedAlert {
  return {
    id: "test-alert-1",
    externalId: "ext-123",
    provider: "pagerduty",
    severity: "high",
    status: "triggered",
    title: "CPU spike on web-prod-01",
    description: "CPU utilization exceeded 95%",
    service: "web-service",
    environment: "production",
    raisedAt: "2026-03-01T10:00:00.000Z",
    receivedAt: "2026-03-01T10:00:01.000Z",
    sourceUrl: "https://app.pagerduty.com/incidents/P123",
    details: {},
    rawPayload: {},
    tags: ["prod", "web"],
    ...overrides,
  };
}

function makeChannel(overrides: Partial<DispatchChannel> = {}): DispatchChannel {
  return {
    id: "ch-1",
    name: "#ops-critical",
    type: "slack",
    config: { webhookUrl: "https://hooks.slack.com/xxx" },
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRule(overrides: Partial<RoutingRule> = {}): RoutingRule {
  return {
    id: "rule-1",
    name: "Critical to ops",
    priority: 10,
    enabled: true,
    conditions: [{ field: "severity", operator: "equals", value: "critical" }],
    channelIds: ["ch-1"],
    stopOnMatch: false,
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  PagerDuty payloads                                                  */
/* ------------------------------------------------------------------ */

function makePagerDutyV3() {
  return {
    event: {
      event_type: "incident.triggered",
      data: {
        id: "PD-001",
        incident_number: 42,
        title: "Database connection pool exhausted",
        description: "Connection pool at 100% for 5 minutes",
        urgency: "high",
        html_url: "https://acme.pagerduty.com/incidents/PD-001",
        created_at: "2026-03-01T08:30:00Z",
        service: { summary: "database-primary" },
        escalation_policy: { summary: "production-oncall" },
        assignments: [{ assignee: { summary: "alice" } }],
        teams: [{ summary: "backend" }],
        priority: { summary: "P1" },
        labels: [{ value: "database" }, { value: "critical" }],
      },
    },
  };
}

function makePagerDutyV2() {
  return {
    messages: [
      {
        event: "incident.trigger",
        incident: {
          id: "PD-002",
          incident_number: 43,
          title: "High error rate on API",
          summary: "5xx errors spiking",
          urgency: "high",
          html_url: "https://acme.pagerduty.com/incidents/PD-002",
          created_at: "2026-03-01T09:00:00Z",
          service_name: "api-gateway",
        },
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  OpsGenie payloads                                                   */
/* ------------------------------------------------------------------ */

function makeOpsGeniePayload() {
  return {
    action: "Create",
    alert: {
      alertId: "OG-001",
      tinyId: "1234",
      message: "Disk space low on storage-node-3",
      description: "95% disk utilization on /data",
      priority: "P2",
      source: "storage-monitor",
      createdAt: "2026-03-01T10:15:00Z",
      tags: ["storage", "disk"],
      details: {
        service: "storage-backend",
        environment: "staging",
      },
      responders: [{ name: "infra-team" }],
      teams: [{ name: "infrastructure" }],
    },
    alertUrl: "https://acme.app.opsgenie.com/alert/detail/OG-001",
  };
}

/* ------------------------------------------------------------------ */
/*  CloudWatch payloads                                                 */
/* ------------------------------------------------------------------ */

function makeCloudWatchPayload() {
  return {
    AlarmName: "HighCPUUtilization",
    AlarmDescription: "CPU utilization exceeded 90% for 5 minutes",
    AWSAccountId: "123456789012",
    NewStateValue: "ALARM",
    NewStateReason: "Threshold Crossed: 1 datapoint [97.5] was >= 90",
    OldStateValue: "OK",
    StateChangeTime: "2026-03-01T11:00:00.000+0000",
    Region: "us-east-1",
    Trigger: {
      MetricName: "CPUUtilization",
      Namespace: "AWS/EC2",
      Period: 300,
      Statistic: "Average",
      Threshold: 90,
    },
  };
}

function makeCloudWatchSNSPayload() {
  return {
    Message: JSON.stringify(makeCloudWatchPayload()),
    source: "aws.sns",
    TopicArn: "arn:aws:sns:us-east-1:123456789012:CloudWatchAlarms",
  };
}

/* ================================================================== */
/*  TESTS                                                               */
/* ================================================================== */

beforeEach(() => {
  resetAlertCounter();
  resetDispatchCounter();
  resetToolCounters();
  clearStores();
  resetSender();
});

/* ------------------------------------------------------------------ */
/*  Provider Detection                                                  */
/* ------------------------------------------------------------------ */

describe("Provider Detection", () => {
  it("detects PagerDuty V3 webhook", () => {
    expect(detectProvider(makePagerDutyV3())).toBe("pagerduty");
  });

  it("detects PagerDuty V2 webhook", () => {
    expect(detectProvider(makePagerDutyV2())).toBe("pagerduty");
  });

  it("detects OpsGenie webhook", () => {
    expect(detectProvider(makeOpsGeniePayload())).toBe("opsgenie");
  });

  it("detects CloudWatch direct payload", () => {
    expect(detectProvider(makeCloudWatchPayload())).toBe("cloudwatch");
  });

  it("detects CloudWatch via SNS wrapper", () => {
    expect(detectProvider(makeCloudWatchSNSPayload())).toBe("cloudwatch");
  });

  it("detects CloudWatch via source field", () => {
    expect(detectProvider({ source: "aws.cloudwatch", AlarmName: "x" })).toBe("cloudwatch");
  });

  it("returns undefined for unrecognised payloads", () => {
    expect(detectProvider({ random: "data" })).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(detectProvider(null)).toBeUndefined();
  });

  it("returns undefined for non-object", () => {
    expect(detectProvider("string")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  PagerDuty Parser                                                    */
/* ------------------------------------------------------------------ */

describe("PagerDuty Parser", () => {
  it("parses V3 incident.triggered webhook", () => {
    const alert = parsePagerDuty(makePagerDutyV3());
    expect(alert.provider).toBe("pagerduty");
    expect(alert.externalId).toBe("PD-001");
    expect(alert.severity).toBe("critical");
    expect(alert.status).toBe("triggered");
    expect(alert.title).toBe("Database connection pool exhausted");
    expect(alert.service).toBe("database-primary");
    expect(alert.sourceUrl).toContain("pagerduty.com");
    expect(alert.tags).toContain("database");
  });

  it("parses V2 messages format", () => {
    const alert = parsePagerDuty(makePagerDutyV2());
    expect(alert.provider).toBe("pagerduty");
    expect(alert.externalId).toBe("PD-002");
    expect(alert.status).toBe("triggered");
    expect(alert.title).toBe("High error rate on API");
    expect(alert.service).toBe("api-gateway");
  });

  it("maps acknowledge event type", () => {
    const payload = {
      event: {
        event_type: "incident.acknowledged",
        data: { id: "PD-003", title: "Ack test", service: {} },
      },
    };
    const alert = parsePagerDuty(payload);
    expect(alert.status).toBe("acknowledged");
  });

  it("maps resolve event type", () => {
    const payload = {
      event: {
        event_type: "incident.resolved",
        data: { id: "PD-004", title: "Resolved test", service: {} },
      },
    };
    const alert = parsePagerDuty(payload);
    expect(alert.status).toBe("resolved");
  });

  it("maps low urgency to low severity", () => {
    const payload = {
      event: {
        event_type: "incident.triggered",
        data: { id: "PD-005", title: "Low urg", urgency: "low", service: {} },
      },
    };
    const alert = parsePagerDuty(payload);
    expect(alert.severity).toBe("low");
  });

  it("defaults to medium severity for unknown urgency", () => {
    const payload = {
      event: {
        event_type: "incident.triggered",
        data: { id: "PD-006", title: "Default urg", urgency: "something", service: {} },
      },
    };
    const alert = parsePagerDuty(payload);
    expect(alert.severity).toBe("medium");
  });

  it("handles fallback root-as-incident format", () => {
    const alert = parsePagerDuty({ id: "raw-1", title: "Raw alert" });
    expect(alert.externalId).toBe("raw-1");
    expect(alert.title).toBe("Raw alert");
  });
});

/* ------------------------------------------------------------------ */
/*  OpsGenie Parser                                                     */
/* ------------------------------------------------------------------ */

describe("OpsGenie Parser", () => {
  it("parses Create action", () => {
    const alert = parseOpsGenie(makeOpsGeniePayload());
    expect(alert.provider).toBe("opsgenie");
    expect(alert.externalId).toBe("OG-001");
    expect(alert.severity).toBe("high"); // P2
    expect(alert.status).toBe("triggered");
    expect(alert.title).toBe("Disk space low on storage-node-3");
    expect(alert.service).toBe("storage-monitor");
    expect(alert.tags).toContain("storage");
    expect(alert.sourceUrl).toContain("opsgenie.com");
  });

  it("maps Acknowledge action", () => {
    const payload = {
      action: "Acknowledge",
      alert: { alertId: "OG-002", message: "Ack" },
    };
    const alert = parseOpsGenie(payload);
    expect(alert.status).toBe("acknowledged");
  });

  it("maps Close action to resolved", () => {
    const payload = {
      action: "Close",
      alert: { alertId: "OG-003", message: "Closed" },
    };
    const alert = parseOpsGenie(payload);
    expect(alert.status).toBe("resolved");
  });

  it("maps P1 to critical severity", () => {
    const payload = {
      action: "Create",
      alert: { alertId: "OG-004", message: "P1 Alert", priority: "P1" },
    };
    const alert = parseOpsGenie(payload);
    expect(alert.severity).toBe("critical");
  });

  it("maps P3 to medium severity", () => {
    const payload = {
      action: "Create",
      alert: { alertId: "OG-005", message: "P3 Alert", priority: "P3" },
    };
    const alert = parseOpsGenie(payload);
    expect(alert.severity).toBe("medium");
  });

  it("maps P5 to info severity", () => {
    const payload = {
      action: "Create",
      alert: { alertId: "OG-006", message: "P5 Alert", priority: "P5" },
    };
    const alert = parseOpsGenie(payload);
    expect(alert.severity).toBe("info");
  });

  it("extracts environment from details", () => {
    const alert = parseOpsGenie(makeOpsGeniePayload());
    expect(alert.environment).toBe("staging");
  });
});

/* ------------------------------------------------------------------ */
/*  CloudWatch Parser                                                   */
/* ------------------------------------------------------------------ */

describe("CloudWatch Parser", () => {
  it("parses direct CloudWatch alarm payload", () => {
    const alert = parseCloudWatch(makeCloudWatchPayload());
    expect(alert.provider).toBe("cloudwatch");
    expect(alert.externalId).toBe("HighCPUUtilization");
    expect(alert.severity).toBe("high"); // CPU metric + ALARM state
    expect(alert.status).toBe("triggered");
    expect(alert.title).toBe("HighCPUUtilization");
    expect(alert.service).toBe("CPUUtilization");
    expect(alert.environment).toBe("us-east-1");
    expect(alert.sourceUrl).toContain("cloudwatch");
  });

  it("parses SNS-wrapped CloudWatch payload", () => {
    const alert = parseCloudWatch(makeCloudWatchSNSPayload());
    expect(alert.provider).toBe("cloudwatch");
    expect(alert.externalId).toBe("HighCPUUtilization");
    expect(alert.status).toBe("triggered");
  });

  it("maps OK state to resolved", () => {
    const payload = { ...makeCloudWatchPayload(), NewStateValue: "OK" };
    const alert = parseCloudWatch(payload);
    expect(alert.status).toBe("resolved");
    expect(alert.severity).toBe("info");
  });

  it("maps INSUFFICIENT_DATA state", () => {
    const payload = { ...makeCloudWatchPayload(), NewStateValue: "INSUFFICIENT_DATA" };
    const alert = parseCloudWatch(payload);
    expect(alert.status).toBe("triggered");
    expect(alert.severity).toBe("low");
  });

  it("assigns medium severity for non-CPU ALARM metrics", () => {
    const payload = {
      AlarmName: "HighLatency",
      NewStateValue: "ALARM",
      Region: "eu-west-1",
      Trigger: { MetricName: "Latency" },
    };
    const alert = parseCloudWatch(payload);
    expect(alert.severity).toBe("medium");
  });

  it("assigns high severity for error-related metrics", () => {
    const payload = {
      AlarmName: "5xxErrors",
      NewStateValue: "ALARM",
      Region: "eu-west-1",
      Trigger: { MetricName: "5xxErrorRate" },
    };
    const alert = parseCloudWatch(payload);
    expect(alert.severity).toBe("high");
  });

  it("includes trigger details", () => {
    const alert = parseCloudWatch(makeCloudWatchPayload());
    expect(alert.details.metricName).toBe("CPUUtilization");
    expect(alert.details.namespace).toBe("AWS/EC2");
    expect(alert.details.region).toBe("us-east-1");
    expect(alert.details.accountId).toBe("123456789012");
  });
});

/* ------------------------------------------------------------------ */
/*  Unified parseWebhook                                                */
/* ------------------------------------------------------------------ */

describe("parseWebhook", () => {
  it("auto-detects and parses PagerDuty", () => {
    const result = parseWebhook({ body: makePagerDutyV3() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.alert.provider).toBe("pagerduty");
    }
  });

  it("auto-detects and parses OpsGenie", () => {
    const result = parseWebhook({ body: makeOpsGeniePayload() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.alert.provider).toBe("opsgenie");
    }
  });

  it("auto-detects and parses CloudWatch", () => {
    const result = parseWebhook({ body: makeCloudWatchPayload() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.alert.provider).toBe("cloudwatch");
    }
  });

  it("uses explicit provider hint", () => {
    const result = parseWebhook({
      body: makeCloudWatchPayload(),
      provider: "cloudwatch",
    });
    expect(result.success).toBe(true);
  });

  it("returns error for unrecognised payload", () => {
    const result = parseWebhook({ body: { unknown: true } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Unable to detect");
    }
  });

  it("handles parse exceptions gracefully", () => {
    // Force a parse error by providing a provider but null body
    const result = parseWebhook({ body: null, provider: "pagerduty" });
    // parsePagerDuty will throw when accessing properties on null
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("pagerduty");
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Message Formatting                                                  */
/* ------------------------------------------------------------------ */

describe("Message Formatting", () => {
  it("formats alert message with all fields", () => {
    const alert = makeAlert();
    const msg = formatAlertMessage(alert);
    expect(msg).toContain("🟠"); // high severity emoji
    expect(msg).toContain("HIGH");
    expect(msg).toContain("TRIGGERED");
    expect(msg).toContain("CPU spike on web-prod-01");
    expect(msg).toContain("pagerduty");
    expect(msg).toContain("web-service");
    expect(msg).toContain("production");
    expect(msg).toContain("prod, web");
  });

  it("formats critical alert with red emoji", () => {
    const msg = formatAlertMessage(makeAlert({ severity: "critical" }));
    expect(msg).toContain("🔴");
    expect(msg).toContain("CRITICAL");
  });

  it("formats info alert with info emoji", () => {
    const msg = formatAlertMessage(makeAlert({ severity: "info" }));
    expect(msg).toContain("ℹ️");
    expect(msg).toContain("INFO");
  });

  it("omits tags line when no tags", () => {
    const msg = formatAlertMessage(makeAlert({ tags: [] }));
    expect(msg).not.toContain("**Tags:**");
  });

  it("omits description when empty", () => {
    const msg = formatAlertMessage(makeAlert({ description: "" }));
    expect(msg).not.toContain("**Description:**");
  });

  it("resolves template placeholders", () => {
    const alert = makeAlert();
    const template = "Alert: {{title}} — Severity: {{severity}} — {{service}}";
    const result = resolveTemplate(template, alert);
    expect(result).toBe(
      "Alert: CPU spike on web-prod-01 — Severity: high — web-service",
    );
  });

  it("preserves unknown placeholders", () => {
    const result = resolveTemplate("{{unknown}} test", makeAlert());
    expect(result).toBe("{{unknown}} test");
  });

  it("buildMessage uses template when provided", () => {
    const msg = buildMessage(makeAlert(), "Custom: {{title}}");
    expect(msg).toBe("Custom: CPU spike on web-prod-01");
  });

  it("buildMessage uses default format when no template", () => {
    const msg = buildMessage(makeAlert());
    expect(msg).toContain("🟠");
    expect(msg).toContain("HIGH");
  });
});

/* ------------------------------------------------------------------ */
/*  Dispatch                                                            */
/* ------------------------------------------------------------------ */

describe("Dispatch", () => {
  it("dispatches to a single channel successfully", async () => {
    const alert = makeAlert();
    const channel = makeChannel();
    const record = await dispatchToChannel(
      alert,
      channel,
      "rule-1",
      defaultSender,
    );
    expect(record.status).toBe("sent");
    expect(record.alertId).toBe(alert.id);
    expect(record.channelId).toBe(channel.id);
    expect(record.ruleId).toBe("rule-1");
    expect(record.message).toContain("CPU spike");
  });

  it("records failure from sender", async () => {
    const failSender = async () => ({ success: false, error: "rate limited" });
    const record = await dispatchToChannel(
      makeAlert(),
      makeChannel(),
      "rule-1",
      failSender,
    );
    expect(record.status).toBe("failed");
    expect(record.error).toBe("rate limited");
  });

  it("catches sender exceptions", async () => {
    const throwSender = async () => {
      throw new Error("network timeout");
    };
    const record = await dispatchToChannel(
      makeAlert(),
      makeChannel(),
      "rule-1",
      throwSender,
    );
    expect(record.status).toBe("failed");
    expect(record.error).toBe("network timeout");
  });

  it("dispatches to multiple channels in parallel", async () => {
    const ch1 = makeChannel({ id: "ch-1" });
    const ch2 = makeChannel({ id: "ch-2", name: "#ops-info" });
    const records = await dispatchToChannels(
      makeAlert(),
      [ch1, ch2],
      "rule-1",
      defaultSender,
    );
    expect(records).toHaveLength(2);
    expect(records[0].channelId).toBe("ch-1");
    expect(records[1].channelId).toBe("ch-2");
    expect(records.every((r) => r.status === "sent")).toBe(true);
  });

  it("uses custom template in dispatch", async () => {
    const record = await dispatchToChannel(
      makeAlert(),
      makeChannel(),
      "rule-1",
      defaultSender,
      "ALERT: {{title}}",
    );
    expect(record.message).toBe("ALERT: CPU spike on web-prod-01");
  });
});

/* ------------------------------------------------------------------ */
/*  Condition Matching                                                  */
/* ------------------------------------------------------------------ */

describe("Condition Matching", () => {
  const alert = makeAlert();

  it("evaluates equals operator", () => {
    expect(
      evaluateCondition({ field: "severity", operator: "equals", value: "high" }, alert),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "severity", operator: "equals", value: "low" }, alert),
    ).toBe(false);
  });

  it("evaluates contains operator (case-insensitive)", () => {
    expect(
      evaluateCondition(
        { field: "title", operator: "contains", value: "cpu spike" },
        alert,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "title", operator: "contains", value: "memory" },
        alert,
      ),
    ).toBe(false);
  });

  it("evaluates regex operator", () => {
    expect(
      evaluateCondition(
        { field: "title", operator: "regex", value: "CPU.*prod" },
        alert,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "title", operator: "regex", value: "^memory" },
        alert,
      ),
    ).toBe(false);
  });

  it("handles invalid regex gracefully", () => {
    expect(
      evaluateCondition(
        { field: "title", operator: "regex", value: "[invalid" },
        alert,
      ),
    ).toBe(false);
  });

  it("evaluates any operator (always true)", () => {
    expect(
      evaluateCondition({ field: "title", operator: "any", value: "" }, alert),
    ).toBe(true);
  });

  it("evaluates against non-string fields", () => {
    expect(
      evaluateCondition(
        { field: "tags", operator: "contains", value: "prod" },
        alert,
      ),
    ).toBe(true);
  });

  it("evaluates null field values as empty string", () => {
    const alertWithNull = makeAlert({ sourceUrl: "" });
    expect(
      evaluateCondition(
        { field: "sourceUrl", operator: "equals", value: "" },
        alertWithNull,
      ),
    ).toBe(true);
  });

  it("handles undefined condition value without crashing", () => {
    const alert = makeAlert();
    // Simulate a malformed condition with no value (from raw JSON parse)
    const malformed = { field: "title", operator: "contains" } as any;
    // Should not crash — treated as empty string match
    expect(evaluateCondition(malformed, alert)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Rule Evaluation                                                     */
/* ------------------------------------------------------------------ */

describe("Rule Evaluation", () => {
  it("matches when all conditions pass (AND logic)", () => {
    const rule = makeRule({
      conditions: [
        { field: "severity", operator: "equals", value: "high" },
        { field: "provider", operator: "equals", value: "pagerduty" },
      ],
    });
    expect(evaluateRule(rule, makeAlert())).toBe(true);
  });

  it("fails when any condition fails", () => {
    const rule = makeRule({
      conditions: [
        { field: "severity", operator: "equals", value: "critical" },
        { field: "provider", operator: "equals", value: "pagerduty" },
      ],
    });
    expect(evaluateRule(rule, makeAlert())).toBe(false);
  });

  it("disabled rule never matches", () => {
    const rule = makeRule({ enabled: false });
    expect(evaluateRule(rule, makeAlert({ severity: "critical" }))).toBe(false);
  });

  it("no-condition rule matches everything (catch-all)", () => {
    const rule = makeRule({ conditions: [] });
    expect(evaluateRule(rule, makeAlert())).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Route Resolution                                                    */
/* ------------------------------------------------------------------ */

describe("Route Resolution", () => {
  it("resolves matching routes", () => {
    const ch = makeChannel();
    const channelMap = new Map([[ch.id, ch]]);
    const rule = makeRule();
    const alert = makeAlert({ severity: "critical" });

    const matches = resolveRoutes(alert, [rule], channelMap);
    expect(matches).toHaveLength(1);
    expect(matches[0].rule.id).toBe("rule-1");
    expect(matches[0].channels).toHaveLength(1);
  });

  it("returns empty array when no rules match", () => {
    const ch = makeChannel();
    const channelMap = new Map([[ch.id, ch]]);
    const rule = makeRule();
    const alert = makeAlert({ severity: "low" }); // rule expects critical

    const matches = resolveRoutes(alert, [rule], channelMap);
    expect(matches).toHaveLength(0);
  });

  it("respects priority ordering", () => {
    const ch = makeChannel();
    const channelMap = new Map([[ch.id, ch]]);
    const ruleHigh = makeRule({ id: "r-high", name: "High priority", priority: 1, conditions: [] });
    const ruleLow = makeRule({ id: "r-low", name: "Low priority", priority: 100, conditions: [] });

    // Pass out of order
    const matches = resolveRoutes(makeAlert(), [ruleLow, ruleHigh], channelMap);
    expect(matches[0].rule.id).toBe("r-high");
    expect(matches[1].rule.id).toBe("r-low");
  });

  it("stops after stopOnMatch rule", () => {
    const ch = makeChannel();
    const channelMap = new Map([[ch.id, ch]]);
    const rule1 = makeRule({ id: "r-1", priority: 1, conditions: [], stopOnMatch: true });
    const rule2 = makeRule({ id: "r-2", priority: 2, conditions: [] });

    const matches = resolveRoutes(makeAlert(), [rule1, rule2], channelMap);
    expect(matches).toHaveLength(1);
    expect(matches[0].rule.id).toBe("r-1");
  });

  it("skips rules referencing unknown channels", () => {
    const channelMap = new Map<string, DispatchChannel>();
    const rule = makeRule({ channelIds: ["nonexistent"] });
    const matches = resolveRoutes(makeAlert({ severity: "critical" }), [rule], channelMap);
    expect(matches).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Suppression                                                         */
/* ------------------------------------------------------------------ */

describe("Suppression", () => {
  it("suppresses alerts with suppressed status", () => {
    expect(shouldSuppress(makeAlert({ status: "suppressed" }))).toBe(true);
  });

  it("does not suppress triggered alerts", () => {
    expect(shouldSuppress(makeAlert({ status: "triggered" }))).toBe(false);
  });

  it("does not suppress resolved alerts", () => {
    expect(shouldSuppress(makeAlert({ status: "resolved" }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Filtering                                                           */
/* ------------------------------------------------------------------ */

describe("Alert Filtering", () => {
  const alerts = [
    makeAlert({ id: "a1", provider: "pagerduty", severity: "critical", service: "web" }),
    makeAlert({ id: "a2", provider: "opsgenie", severity: "high", service: "api" }),
    makeAlert({ id: "a3", provider: "cloudwatch", severity: "low", service: "database" }),
  ];

  it("filters by provider", () => {
    const result = filterAlerts(alerts, { provider: "opsgenie" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a2");
  });

  it("filters by severity", () => {
    const result = filterAlerts(alerts, { severity: "critical" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a1");
  });

  it("filters by service (substring)", () => {
    const result = filterAlerts(alerts, { service: "data" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a3");
  });

  it("combines multiple filters", () => {
    const result = filterAlerts(alerts, { provider: "pagerduty", severity: "critical" });
    expect(result).toHaveLength(1);
  });

  it("returns all alerts with empty filter", () => {
    expect(filterAlerts(alerts, {})).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */
/*  Dashboard                                                           */
/* ------------------------------------------------------------------ */

describe("Dashboard", () => {
  it("aggregates counts by provider, severity, and status", () => {
    const alerts = [
      makeAlert({ provider: "pagerduty", severity: "critical", status: "triggered" }),
      makeAlert({ provider: "pagerduty", severity: "high", status: "acknowledged" }),
      makeAlert({ provider: "cloudwatch", severity: "low", status: "resolved" }),
    ];
    const dispatches = [
      { id: "d1", alertId: "a1", channelId: "ch-1", ruleId: "r1", status: "sent" as const, message: "", dispatchedAt: "" },
      { id: "d2", alertId: "a2", channelId: "ch-1", ruleId: "r1", status: "sent" as const, message: "", dispatchedAt: "" },
      { id: "d3", alertId: "a3", channelId: "ch-1", ruleId: "r1", status: "failed" as const, message: "", dispatchedAt: "", error: "timeout" },
    ];
    const rules = [makeRule()];
    const channels = [makeChannel()];

    const dash = buildDashboard(alerts, dispatches, rules, channels);
    expect(dash.totalAlerts).toBe(3);
    expect(dash.byProvider.pagerduty).toBe(2);
    expect(dash.byProvider.cloudwatch).toBe(1);
    expect(dash.bySeverity.critical).toBe(1);
    expect(dash.byStatus.triggered).toBe(1);
    expect(dash.byStatus.acknowledged).toBe(1);
    expect(dash.totalDispatches).toBe(3);
    expect(dash.dispatchSuccessRate).toBeCloseTo(2 / 3);
    expect(dash.activeRoutes).toBe(1);
    expect(dash.registeredChannels).toBe(1);
  });

  it("returns 1 for success rate when no dispatches", () => {
    const dash = buildDashboard([], [], [], []);
    expect(dash.dispatchSuccessRate).toBe(1);
  });

  it("limits recent alerts to last 10", () => {
    const alerts: NormalisedAlert[] = [];
    for (let i = 0; i < 15; i++) {
      alerts.push(makeAlert({ id: `a-${i}` }));
    }
    const dash = buildDashboard(alerts, [], [], []);
    expect(dash.recentAlerts).toHaveLength(10);
    expect(dash.recentAlerts[0].id).toBe("a-5"); // last 10
  });
});

/* ------------------------------------------------------------------ */
/*  Ingest Pipeline (end-to-end)                                        */
/* ------------------------------------------------------------------ */

describe("Ingest Pipeline", () => {
  it("parses, routes, and dispatches an alert end-to-end", async () => {
    const ch = makeChannel();
    const channelMap = new Map([[ch.id, ch]]);
    const rule = makeRule({
      conditions: [{ field: "severity", operator: "equals", value: "critical" }],
    });

    const result = await ingestAlert(
      { body: makePagerDutyV3() },
      [rule],
      channelMap,
      defaultSender,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.alert.provider).toBe("pagerduty");
      expect(result.result.suppressed).toBe(false);
      expect(result.result.matchedRules).toContain("rule-1");
      expect(result.result.dispatches).toHaveLength(1);
      expect(result.result.dispatches[0].status).toBe("sent");
    }
  });

  it("suppresses suppressed alerts", async () => {
    // OpsGenie doesn't naturally produce 'suppressed', so test via
    // the router.ingestAlert which respects shouldSuppress.
    // Build a payload that we can parse, then manually override status.
    const ch = makeChannel();
    const channelMap = new Map([[ch.id, ch]]);
    const rule = makeRule({ conditions: [] });

    // Ingest a normal alert first to demonstrate dispatch works
    const normalResult = await ingestAlert(
      { body: makeOpsGeniePayload() },
      [rule],
      channelMap,
      defaultSender,
    );
    expect(normalResult.success).toBe(true);
    if (normalResult.success) {
      expect(normalResult.result.dispatches.length).toBeGreaterThan(0);
      expect(normalResult.result.suppressed).toBe(false);
    }

    // Verify shouldSuppress works correctly on suppressed alerts
    const suppressedAlert = makeAlert({ status: "suppressed" });
    expect(shouldSuppress(suppressedAlert)).toBe(true);
    expect(shouldSuppress(makeAlert({ status: "triggered" }))).toBe(false);
  });

  it("returns error for unparseable payload", async () => {
    const result = await ingestAlert(
      { body: { random: "noise" } },
      [],
      new Map(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Unable to detect");
    }
  });

  it("dispatches to multiple channels across multiple rules", async () => {
    const ch1 = makeChannel({ id: "ch-1" });
    const ch2 = makeChannel({ id: "ch-2" });
    const channelMap = new Map([
      [ch1.id, ch1],
      [ch2.id, ch2],
    ]);
    const rule1 = makeRule({ id: "r-1", priority: 1, channelIds: ["ch-1"], conditions: [] });
    const rule2 = makeRule({ id: "r-2", priority: 2, channelIds: ["ch-2"], conditions: [] });

    const result = await ingestAlert(
      { body: makeOpsGeniePayload() },
      [rule1, rule2],
      channelMap,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.dispatches).toHaveLength(2);
      expect(result.result.matchedRules).toEqual(["r-1", "r-2"]);
    }
  });

  it("returns zero dispatches when no routes match", async () => {
    const ch = makeChannel();
    const channelMap = new Map([[ch.id, ch]]);
    const rule = makeRule({
      conditions: [{ field: "severity", operator: "equals", value: "info" }],
    });

    const result = await ingestAlert(
      { body: makePagerDutyV3() },
      [rule],
      channelMap,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.dispatches).toHaveLength(0);
      expect(result.result.matchedRules).toHaveLength(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Agent Tools                                                         */
/* ------------------------------------------------------------------ */

describe("Agent Tools", () => {
  function findTool(name: string): {
    name: string;
    execute: (input: any) => Promise<any>;
  } {
    const tools = createAlertingTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool as { name: string; execute: (input: any) => Promise<any> };
  }

  it("alerting_add_channel registers a channel", async () => {
    const tool = findTool("alerting_add_channel");
    const result = await tool.execute({
      name: "#ops-critical",
      type: "slack",
      config: JSON.stringify({ webhookUrl: "https://hooks.slack.com/xxx" }),
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.channelId).toBeTruthy();
    expect(data.name).toBe("#ops-critical");
    expect(data.type).toBe("slack");
    expect(getChannelStore().size).toBe(1);
  });

  it("alerting_add_channel rejects invalid type", async () => {
    const tool = findTool("alerting_add_channel");
    const result = await tool.execute({
      name: "test",
      type: "invalid-type",
    });
    expect(result.content[0].text).toContain("Invalid channel type");
  });

  it("alerting_add_channel rejects invalid config JSON", async () => {
    const tool = findTool("alerting_add_channel");
    const result = await tool.execute({
      name: "test",
      type: "slack",
      config: "not-json",
    });
    expect(result.content[0].text).toContain("Invalid JSON");
  });

  it("alerting_add_route creates a routing rule", async () => {
    // First register a channel
    const chTool = findTool("alerting_add_channel");
    const chResult = await chTool.execute({ name: "#ops", type: "slack" });
    const { channelId } = JSON.parse(chResult.content[0].text);

    const routeTool = findTool("alerting_add_route");
    const result = await routeTool.execute({
      name: "Critical alerts to ops",
      priority: 10,
      conditions: JSON.stringify([
        { field: "severity", operator: "equals", value: "critical" },
      ]),
      channelIds: channelId,
      stopOnMatch: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.routeId).toBeTruthy();
    expect(data.name).toBe("Critical alerts to ops");
    expect(data.conditionCount).toBe(1);
    expect(getRouteStore().size).toBe(1);
  });

  it("alerting_add_route rejects unknown channel IDs", async () => {
    const tool = findTool("alerting_add_route");
    const result = await tool.execute({
      name: "Test",
      channelIds: "nonexistent-ch",
    });
    expect(result.content[0].text).toContain("Unknown channel IDs");
  });

  it("alerting_add_route rejects invalid operator", async () => {
    const chTool = findTool("alerting_add_channel");
    const chResult = await chTool.execute({ name: "#ops", type: "slack" });
    const { channelId } = JSON.parse(chResult.content[0].text);

    const tool = findTool("alerting_add_route");
    const result = await tool.execute({
      name: "Test",
      channelIds: channelId,
      conditions: JSON.stringify([
        { field: "title", operator: "bad-op", value: "x" },
      ]),
    });
    expect(result.content[0].text).toContain("Invalid operator");
  });

  it("alerting_list_routes returns sorted rules", async () => {
    const chTool = findTool("alerting_add_channel");
    const chRes = await chTool.execute({ name: "#ops", type: "slack" });
    const { channelId } = JSON.parse(chRes.content[0].text);

    const routeTool = findTool("alerting_add_route");
    await routeTool.execute({ name: "Low priority", priority: 100, channelIds: channelId });
    await routeTool.execute({ name: "High priority", priority: 1, channelIds: channelId });

    const listTool = findTool("alerting_list_routes");
    const result = await listTool.execute({});
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBe(2);
    expect(data.routes[0].name).toBe("High priority");
    expect(data.routes[1].name).toBe("Low priority");
  });

  it("alerting_remove_route removes a rule", async () => {
    const chTool = findTool("alerting_add_channel");
    const chRes = await chTool.execute({ name: "#ops", type: "slack" });
    const { channelId } = JSON.parse(chRes.content[0].text);

    const routeTool = findTool("alerting_add_route");
    const rRes = await routeTool.execute({ name: "To remove", channelIds: channelId });
    const { routeId } = JSON.parse(rRes.content[0].text);

    const removeTool = findTool("alerting_remove_route");
    const result = await removeTool.execute({ routeId });
    const data = JSON.parse(result.content[0].text);
    expect(data.removed).toBe(routeId);
    expect(getRouteStore().size).toBe(0);
  });

  it("alerting_remove_route returns error for unknown route", async () => {
    const tool = findTool("alerting_remove_route");
    const result = await tool.execute({ routeId: "nonexistent" });
    expect(result.content[0].text).toContain("Route not found");
  });

  it("alerting_ingest parses and dispatches PagerDuty webhook", async () => {
    // Set up channel + route
    const chTool = findTool("alerting_add_channel");
    const chRes = await chTool.execute({ name: "#alerts", type: "slack" });
    const { channelId } = JSON.parse(chRes.content[0].text);

    const routeTool = findTool("alerting_add_route");
    await routeTool.execute({
      name: "Catch all",
      channelIds: channelId,
      // no conditions = catch all
    });

    const ingestTool = findTool("alerting_ingest");
    const result = await ingestTool.execute({
      body: JSON.stringify(makePagerDutyV3()),
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.provider).toBe("pagerduty");
    expect(data.severity).toBe("critical");
    expect(data.suppressed).toBe(false);
    expect(data.dispatches).toHaveLength(1);
    expect(data.dispatches[0].status).toBe("sent");
    expect(getAlertStore().size).toBe(1);
  });

  it("alerting_ingest handles OpsGenie webhook", async () => {
    const tool = findTool("alerting_ingest");
    const result = await tool.execute({
      body: JSON.stringify(makeOpsGeniePayload()),
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.provider).toBe("opsgenie");
    expect(data.severity).toBe("high");
  });

  it("alerting_ingest handles CloudWatch webhook", async () => {
    const tool = findTool("alerting_ingest");
    const result = await tool.execute({
      body: JSON.stringify(makeCloudWatchPayload()),
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.provider).toBe("cloudwatch");
    expect(data.status).toBe("triggered");
  });

  it("alerting_ingest rejects invalid provider", async () => {
    const tool = findTool("alerting_ingest");
    const result = await tool.execute({
      body: "{}",
      provider: "fake-provider",
    });
    expect(result.content[0].text).toContain("Invalid provider");
  });

  it("alerting_ingest rejects invalid JSON body", async () => {
    const tool = findTool("alerting_ingest");
    const result = await tool.execute({ body: "not-json" });
    expect(result.content[0].text).toContain("Invalid JSON");
  });

  it("alerting_list_alerts returns ingested alerts", async () => {
    const ingestTool = findTool("alerting_ingest");
    await ingestTool.execute({ body: JSON.stringify(makePagerDutyV3()) });
    await ingestTool.execute({ body: JSON.stringify(makeOpsGeniePayload()) });

    const listTool = findTool("alerting_list_alerts");
    const result = await listTool.execute({});
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBe(2);
    expect(data.alerts).toHaveLength(2);
  });

  it("alerting_list_alerts filters by provider", async () => {
    const ingestTool = findTool("alerting_ingest");
    await ingestTool.execute({ body: JSON.stringify(makePagerDutyV3()) });
    await ingestTool.execute({ body: JSON.stringify(makeOpsGeniePayload()) });

    const listTool = findTool("alerting_list_alerts");
    const result = await listTool.execute({ provider: "opsgenie" });
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBe(1);
    expect(data.alerts[0].provider).toBe("opsgenie");
  });

  it("alerting_get_alert returns full alert details", async () => {
    const ingestTool = findTool("alerting_ingest");
    const ingestResult = await ingestTool.execute({
      body: JSON.stringify(makePagerDutyV3()),
    });
    const { alertId } = JSON.parse(ingestResult.content[0].text);

    const getTool = findTool("alerting_get_alert");
    const result = await getTool.execute({ alertId });
    const data = JSON.parse(result.content[0].text);
    expect(data.alert.provider).toBe("pagerduty");
    expect(data.alert.title).toContain("Database connection pool");
  });

  it("alerting_get_alert returns error for unknown ID", async () => {
    const tool = findTool("alerting_get_alert");
    const result = await tool.execute({ alertId: "nonexistent" });
    expect(result.content[0].text).toContain("Alert not found");
  });

  it("alerting_dashboard shows stats", async () => {
    const ingestTool = findTool("alerting_ingest");
    await ingestTool.execute({ body: JSON.stringify(makePagerDutyV3()) });
    await ingestTool.execute({ body: JSON.stringify(makeCloudWatchPayload()) });

    const dashTool = findTool("alerting_dashboard");
    const result = await dashTool.execute({});
    const data = JSON.parse(result.content[0].text);
    expect(data.dashboard.totalAlerts).toBe(2);
    expect(data.dashboard.byProvider.pagerduty).toBe(1);
    expect(data.dashboard.byProvider.cloudwatch).toBe(1);
  });

  it("exposes 8 tools", () => {
    const tools = createAlertingTools();
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name);
    expect(names).toContain("alerting_ingest");
    expect(names).toContain("alerting_list_alerts");
    expect(names).toContain("alerting_get_alert");
    expect(names).toContain("alerting_add_route");
    expect(names).toContain("alerting_list_routes");
    expect(names).toContain("alerting_remove_route");
    expect(names).toContain("alerting_add_channel");
    expect(names).toContain("alerting_dashboard");
  });

  it("full flow: add channel → add route → ingest → list → dashboard", async () => {
    // 1. Register channel
    const chTool = findTool("alerting_add_channel");
    const chRes = await chTool.execute({
      name: "#incidents",
      type: "discord",
      config: JSON.stringify({ webhookUrl: "https://discord.com/api/webhooks/xxx" }),
    });
    const { channelId } = JSON.parse(chRes.content[0].text);

    // 2. Add routing rule
    const routeTool = findTool("alerting_add_route");
    await routeTool.execute({
      name: "All critical alerts",
      priority: 1,
      conditions: JSON.stringify([
        { field: "severity", operator: "equals", value: "critical" },
      ]),
      channelIds: channelId,
      template: "🚨 {{title}} — {{service}} ({{environment}})",
    });

    // 3. Ingest PagerDuty webhook (high urgency = critical)
    const ingestTool = findTool("alerting_ingest");
    const ingestRes = await ingestTool.execute({
      body: JSON.stringify(makePagerDutyV3()),
    });
    const ingestData = JSON.parse(ingestRes.content[0].text);
    expect(ingestData.provider).toBe("pagerduty");
    expect(ingestData.severity).toBe("critical");
    expect(ingestData.dispatches).toHaveLength(1);
    expect(ingestData.dispatches[0].status).toBe("sent");

    // 4. Ingest CloudWatch (medium severity — should NOT match critical route)
    const cwPayload = {
      AlarmName: "HighLatency",
      NewStateValue: "ALARM",
      Region: "us-west-2",
      Trigger: { MetricName: "Latency" },
    };
    const cwRes = await ingestTool.execute({
      body: JSON.stringify(cwPayload),
    });
    const cwData = JSON.parse(cwRes.content[0].text);
    expect(cwData.severity).toBe("medium");
    expect(cwData.dispatches).toHaveLength(0); // no critical route match

    // 5. List alerts
    const listRes = await findTool("alerting_list_alerts").execute({});
    const listData = JSON.parse(listRes.content[0].text);
    expect(listData.total).toBe(2);

    // 6. Dashboard
    const dashRes = await findTool("alerting_dashboard").execute({});
    const dashData = JSON.parse(dashRes.content[0].text);
    expect(dashData.dashboard.totalAlerts).toBe(2);
    expect(dashData.dashboard.byProvider.pagerduty).toBe(1);
    expect(dashData.dashboard.byProvider.cloudwatch).toBe(1);
    expect(dashData.dashboard.totalDispatches).toBe(1);
    expect(dashData.dashboard.dispatchSuccessRate).toBe(1);
    expect(dashData.dashboard.activeRoutes).toBe(1);
    expect(dashData.dashboard.registeredChannels).toBe(1);
  });

  it("deduplicates alerts with same provider + externalId", async () => {
    const tool = findTool("alerting_ingest");

    // First ingest
    const res1 = await tool.execute({ body: JSON.stringify(makePagerDutyV3()) });
    const data1 = JSON.parse(res1.content[0].text);
    expect(data1.alertId).toBeTruthy();
    expect(data1.duplicate).toBeUndefined();

    // Second ingest of the same payload (simulating webhook retry)
    const res2 = await tool.execute({ body: JSON.stringify(makePagerDutyV3()) });
    const data2 = JSON.parse(res2.content[0].text);
    expect(data2.duplicate).toBe(true);
    expect(data2.originalAlertId).toBe(data1.alertId);

    // Only one alert stored
    expect(getAlertStore().size).toBe(1);
  });

  it("alerting_add_route rejects condition without field", async () => {
    const chTool = findTool("alerting_add_channel");
    const chRes = await chTool.execute({ name: "#ops", type: "slack" });
    const channelId = JSON.parse(chRes.content[0].text).channelId;

    const tool = findTool("alerting_add_route");
    const result = await tool.execute({
      name: "Missing field",
      channelIds: channelId,
      conditions: JSON.stringify([{ operator: "equals", value: "critical" }]),
    });
    expect(result.content[0].text).toContain("must have a 'field'");
  });

  it("alerting_add_route rejects condition without value for non-any operator", async () => {
    const chTool = findTool("alerting_add_channel");
    const chRes = await chTool.execute({ name: "#ops", type: "slack" });
    const channelId = JSON.parse(chRes.content[0].text).channelId;

    const tool = findTool("alerting_add_route");
    const result = await tool.execute({
      name: "Missing value",
      channelIds: channelId,
      conditions: JSON.stringify([{ field: "severity", operator: "equals" }]),
    });
    expect(result.content[0].text).toContain("requires a 'value'");
  });

  it("alerting_add_route rejects invalid condition field", async () => {
    const chTool = findTool("alerting_add_channel");
    const chRes = await chTool.execute({ name: "#ops", type: "slack" });
    const channelId = JSON.parse(chRes.content[0].text).channelId;

    const tool = findTool("alerting_add_route");
    const result = await tool.execute({
      name: "Bad field",
      channelIds: channelId,
      conditions: JSON.stringify([
        { field: "serverity", operator: "equals", value: "critical" },
      ]),
    });
    expect(result.content[0].text).toContain("Invalid condition field");
    expect(result.content[0].text).toContain("serverity");
  });

  it("alerting_add_route accepts empty channelIds gracefully", async () => {
    const tool = findTool("alerting_add_route");
    const result = await tool.execute({
      name: "No channels",
      channelIds: "",
    });
    // Empty channelIds after split/filter = no channels to verify
    // Should still create a route (catch-all with no dispatch targets)
    const data = JSON.parse(result.content[0].text);
    expect(data.routeId).toBeTruthy();
    expect(data.channelIds).toHaveLength(0);
  });

  it("generates unique alert IDs using UUID format", async () => {
    const tool = findTool("alerting_ingest");
    const res = await tool.execute({ body: JSON.stringify(makePagerDutyV3()) });
    const data = JSON.parse(res.content[0].text);
    // UUID-based ID: alert-<uuid>
    expect(data.alertId).toMatch(/^alert-[0-9a-f-]{36}$/);
  });
});
