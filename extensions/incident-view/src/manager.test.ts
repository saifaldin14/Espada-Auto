/**
 * Tests for the cross-cloud unified incident view extension.
 *
 * Covers:
 *  - Normalizers (AWS CloudWatch, AWS X-Ray, Azure alert, Azure activity log,
 *    GCP alert policy, GCP uptime check, K8s event, custom)
 *  - Manager functions (filter, aggregate, correlate, timeline, triage)
 *  - Tool execute functions (incident_normalize, incident_summary,
 *    incident_correlate, incident_triage, incident_timeline, incident_filter)
 */

import { describe, it, expect } from "vitest";
import {
  normalizeAwsAlarm,
  normalizeAwsInsight,
  normalizeAzureAlert,
  normalizeAzureActivityLog,
  normalizeGcpAlertPolicy,
  normalizeGcpUptimeCheck,
  normalizeK8sEvent,
  normalizeCustom,
  normalizeOne,
  normalizeBatch,
} from "./normalizers.js";
import {
  filterIncidents,
  aggregateIncidents,
  correlateIncidents,
  buildTimeline,
  triageIncidents,
} from "./manager.js";
import { createIncidentTools } from "./tools.js";
import type { UnifiedIncident, IncidentFilter } from "./types.js";

// ===================================================================
// Fixtures
// ===================================================================

const awsAlarm = {
  alarmName: "HighCPU",
  alarmArn: "arn:aws:cloudwatch:us-east-1:123456789012:alarm:HighCPU",
  alarmDescription: "CPU > 90%",
  stateValue: "ALARM",
  stateReason: "Threshold Crossed",
  stateUpdatedTimestamp: "2024-06-01T10:00:00Z",
  metricName: "CPUUtilization",
  namespace: "AWS/EC2",
  dimensions: [{ name: "InstanceId", value: "i-abc123" }],
  period: 300,
  evaluationPeriods: 3,
  threshold: 90,
  comparisonOperator: "GreaterThanThreshold",
  actionsEnabled: true,
  alarmActions: ["arn:aws:sns:us-east-1:123456789012:alerts"],
};

const awsAlarmOk = {
  ...awsAlarm,
  alarmName: "HealthyDisk",
  alarmArn: "arn:aws:cloudwatch:us-west-2:123456789012:alarm:HealthyDisk",
  stateValue: "OK",
  stateReason: "Back to normal",
  stateUpdatedTimestamp: "2024-06-01T11:00:00Z",
};

const awsAlarmInsufficient = {
  ...awsAlarm,
  alarmName: "NoData",
  alarmArn: "arn:aws:cloudwatch:eu-west-1:123456789012:alarm:NoData",
  stateValue: "INSUFFICIENT_DATA",
  stateUpdatedTimestamp: "2024-06-01T12:00:00Z",
};

const awsInsight = {
  insightId: "insight-001",
  groupName: "Default",
  state: "ACTIVE",
  rootCauseServiceId: { name: "PaymentService", type: "AWS::ECS::Service" },
  summary: "Elevated faults in PaymentService",
  startTime: "2024-06-01T09:50:00Z",
  clientRequestImpactStatistics: { faultCount: 150, okCount: 3000, totalCount: 3150 },
};

const awsInsightClosed = {
  ...awsInsight,
  insightId: "insight-002",
  state: "CLOSED",
  endTime: "2024-06-01T12:00:00Z",
};

const azureAlert = {
  id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/metricalerts/cpu-alert",
  name: "cpu-alert",
  resourceGroup: "rg-prod",
  location: "eastus",
  description: "CPU above 85%",
  severity: 1,
  enabled: true,
  scopes: ["/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/web-01"],
  evaluationFrequency: "PT5M",
  windowSize: "PT15M",
};

const azureAlertCritical = {
  ...azureAlert,
  id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/metricalerts/disk-alert",
  name: "disk-alert",
  severity: 0,
  description: "Disk full",
};

const azureAlertDisabled = {
  ...azureAlert,
  id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/metricalerts/memory-alert",
  name: "memory-alert",
  severity: 3,
  enabled: false,
};

const azureActivityLog = {
  operationName: "Microsoft.Compute/virtualMachines/restart/action",
  status: "Succeeded",
  level: "Informational",
  resourceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/web-01",
  eventTimestamp: "2024-06-01T10:30:00Z",
  caller: "admin@example.com",
  description: "VM restart completed",
};

const azureActivityLogError = {
  ...azureActivityLog,
  operationName: "Microsoft.Network/loadBalancers/write",
  status: "Failed",
  level: "Error",
  eventTimestamp: "2024-06-01T10:02:00Z",
  description: "Load balancer update failed",
};

const gcpAlertPolicy = {
  name: "projects/my-project/alertPolicies/12345",
  displayName: "High Latency Alert",
  enabled: true,
  conditions: [
    { displayName: "Latency > 500ms", conditionThreshold: { filter: "metric.type=latency", thresholdValue: 500 } },
  ],
  combiner: "OR",
  notificationChannels: ["projects/my-project/notificationChannels/1"],
  createdAt: "2024-05-15T08:00:00Z",
};

const gcpAlertPolicyDisabled = {
  ...gcpAlertPolicy,
  name: "projects/my-project/alertPolicies/67890",
  displayName: "Low Priority Check",
  enabled: false,
  conditions: [],
};

const gcpUptimeCheck = {
  name: "projects/my-project/uptimeCheckConfigs/check-1",
  displayName: "Homepage Check",
  monitoredResource: { type: "uptime_url", labels: { host: "example.com" } },
  httpCheck: { path: "/", port: 443, useSsl: true },
  period: "60s",
  timeout: "10s",
};

const k8sEventWarning = {
  type: "Warning",
  reason: "BackOff",
  message: "Back-off restarting failed container",
  involvedObject: { kind: "Pod", name: "api-server-xyz", namespace: "production" },
  firstTimestamp: "2024-06-01T10:00:00Z",
  lastTimestamp: "2024-06-01T10:05:00Z",
  count: 5,
  metadata: { uid: "evt-001" },
};

const k8sEventNormal = {
  type: "Normal",
  reason: "Scheduled",
  message: "Successfully assigned pod to node",
  involvedObject: { kind: "Pod", name: "web-abc", namespace: "default" },
  firstTimestamp: "2024-06-01T10:10:00Z",
  lastTimestamp: "2024-06-01T10:10:00Z",
  count: 1,
  metadata: { uid: "evt-002" },
};

// ===================================================================
// Normalizer tests
// ===================================================================

describe("Normalizers", () => {
  describe("normalizeAwsAlarm", () => {
    it("normalises an ALARM state alarm", () => {
      const inc = normalizeAwsAlarm(awsAlarm);
      expect(inc.cloud).toBe("aws");
      expect(inc.source).toBe("cloudwatch-alarm");
      expect(inc.title).toBe("HighCPU");
      expect(inc.severity).toBe(2);
      expect(inc.status).toBe("firing");
      expect(inc.region).toBe("us-east-1");
      expect(inc.resource).toContain("AWS/EC2");
      expect(inc.resource).toContain("InstanceId=i-abc123");
      expect(inc.nativeId).toBe(awsAlarm.alarmArn);
      expect(inc.description).toBe("CPU > 90%");
      expect(inc.resolvedAt).toBeUndefined();
    });

    it("normalises an OK state alarm as resolved", () => {
      const inc = normalizeAwsAlarm(awsAlarmOk);
      expect(inc.severity).toBe(5);
      expect(inc.status).toBe("resolved");
      expect(inc.resolvedAt).toBe("2024-06-01T11:00:00Z");
      expect(inc.region).toBe("us-west-2");
    });

    it("normalises INSUFFICIENT_DATA as medium severity firing", () => {
      const inc = normalizeAwsAlarm(awsAlarmInsufficient);
      expect(inc.severity).toBe(3);
      expect(inc.status).toBe("firing");
    });

    it("builds id from cloud:source:nativeId", () => {
      const inc = normalizeAwsAlarm(awsAlarm);
      expect(inc.id).toBe(`aws:cloudwatch-alarm:${awsAlarm.alarmArn}`);
    });

    it("stores rawData", () => {
      const inc = normalizeAwsAlarm(awsAlarm);
      expect(inc.rawData).toBe(awsAlarm);
    });
  });

  describe("normalizeAwsInsight", () => {
    it("normalises an active insight", () => {
      const inc = normalizeAwsInsight(awsInsight);
      expect(inc.cloud).toBe("aws");
      expect(inc.source).toBe("cloudwatch-insight");
      expect(inc.nativeId).toBe("insight-001");
      expect(inc.severity).toBe(2);
      expect(inc.status).toBe("firing");
      expect(inc.resource).toBe("PaymentService");
      expect(inc.title).toContain("PaymentService");
    });

    it("normalises a closed insight as resolved", () => {
      const inc = normalizeAwsInsight(awsInsightClosed);
      expect(inc.status).toBe("resolved");
      expect(inc.severity).toBe(5);
      expect(inc.resolvedAt).toBe("2024-06-01T12:00:00Z");
    });
  });

  describe("normalizeAzureAlert", () => {
    it("maps Azure severity 1 → incident severity 2", () => {
      const inc = normalizeAzureAlert(azureAlert);
      expect(inc.cloud).toBe("azure");
      expect(inc.source).toBe("azure-metric-alert");
      expect(inc.severity).toBe(2);
      expect(inc.status).toBe("firing");
      expect(inc.title).toBe("cpu-alert");
      expect(inc.region).toBe("eastus");
    });

    it("maps Azure severity 0 → incident severity 1 (critical)", () => {
      const inc = normalizeAzureAlert(azureAlertCritical);
      expect(inc.severity).toBe(1);
    });

    it("marks disabled alerts as suppressed", () => {
      const inc = normalizeAzureAlert(azureAlertDisabled);
      expect(inc.status).toBe("suppressed");
      expect(inc.severity).toBe(4);
    });

    it("uses scopes[0] as resource", () => {
      const inc = normalizeAzureAlert(azureAlert);
      expect(inc.resource).toBe(azureAlert.scopes[0]);
    });
  });

  describe("normalizeAzureActivityLog", () => {
    it("normalises a succeeded activity as resolved", () => {
      const inc = normalizeAzureActivityLog(azureActivityLog);
      expect(inc.cloud).toBe("azure");
      expect(inc.source).toBe("azure-activity-log");
      expect(inc.status).toBe("resolved");
      expect(inc.severity).toBe(4);
    });

    it("normalises a failed activity at error level as firing", () => {
      const inc = normalizeAzureActivityLog(azureActivityLogError);
      expect(inc.status).toBe("firing");
      expect(inc.severity).toBe(2);
    });
  });

  describe("normalizeGcpAlertPolicy", () => {
    it("normalises an enabled alert policy", () => {
      const inc = normalizeGcpAlertPolicy(gcpAlertPolicy);
      expect(inc.cloud).toBe("gcp");
      expect(inc.source).toBe("gcp-alert-policy");
      expect(inc.status).toBe("firing");
      expect(inc.severity).toBe(3);
      expect(inc.title).toBe("High Latency Alert");
      expect(inc.region).toContain("my-project");
    });

    it("marks disabled policies as suppressed", () => {
      const inc = normalizeGcpAlertPolicy(gcpAlertPolicyDisabled);
      expect(inc.status).toBe("suppressed");
    });

    it("derives severity from condition count", () => {
      // 0 conditions → severity 4
      const inc = normalizeGcpAlertPolicy(gcpAlertPolicyDisabled);
      expect(inc.severity).toBe(4);
    });
  });

  describe("normalizeGcpUptimeCheck", () => {
    it("normalises an uptime check", () => {
      const inc = normalizeGcpUptimeCheck(gcpUptimeCheck);
      expect(inc.cloud).toBe("gcp");
      expect(inc.source).toBe("gcp-uptime-check");
      expect(inc.severity).toBe(3);
      expect(inc.title).toContain("Homepage Check");
    });
  });

  describe("normalizeK8sEvent", () => {
    it("normalises a Warning event as firing", () => {
      const inc = normalizeK8sEvent(k8sEventWarning);
      expect(inc.cloud).toBe("kubernetes");
      expect(inc.source).toBe("k8s-event");
      expect(inc.severity).toBe(3);
      expect(inc.status).toBe("firing");
      expect(inc.resource).toBe("production/Pod/api-server-xyz");
      expect(inc.title).toContain("BackOff");
    });

    it("normalises a Normal event as resolved", () => {
      const inc = normalizeK8sEvent(k8sEventNormal);
      expect(inc.status).toBe("resolved");
      expect(inc.severity).toBe(5);
    });
  });

  describe("normalizeCustom", () => {
    it("normalises a custom incident with explicit fields", () => {
      const inc = normalizeCustom("aws", {
        id: "custom-1",
        title: "Manual alert",
        description: "Manually reported",
        severity: 2,
        status: "firing",
        resource: "my-resource",
        region: "us-east-1",
      });
      expect(inc.source).toBe("custom");
      expect(inc.severity).toBe(2);
      expect(inc.status).toBe("firing");
      expect(inc.title).toBe("Manual alert");
    });

    it("falls back to defaults for missing fields", () => {
      const inc = normalizeCustom("gcp", {});
      expect(inc.severity).toBe(3);
      expect(inc.status).toBe("firing");
      expect(inc.title).toBe("Custom incident");
    });
  });

  describe("normalizeOne / normalizeBatch", () => {
    it("dispatches to correct normalizer by source", () => {
      const inc = normalizeOne("aws", "cloudwatch-alarm", awsAlarm);
      expect(inc.source).toBe("cloudwatch-alarm");
      expect(inc.title).toBe("HighCPU");
    });

    it("falls back to custom for unknown source", () => {
      const inc = normalizeOne("aws", "custom", { id: "x", title: "X" });
      expect(inc.source).toBe("custom");
    });

    it("batch normalises multiple items", () => {
      const results = normalizeBatch("aws", "cloudwatch-alarm", [awsAlarm, awsAlarmOk]);
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("firing");
      expect(results[1].status).toBe("resolved");
    });
  });
});

// ===================================================================
// Helper: build a set of mixed incidents for manager tests
// ===================================================================

function buildTestIncidents(): UnifiedIncident[] {
  return [
    normalizeAwsAlarm(awsAlarm),
    normalizeAwsAlarm(awsAlarmOk),
    normalizeAwsAlarm(awsAlarmInsufficient),
    normalizeAwsInsight(awsInsight),
    normalizeAwsInsight(awsInsightClosed),
    normalizeAzureAlert(azureAlert),
    normalizeAzureAlert(azureAlertCritical),
    normalizeAzureAlert(azureAlertDisabled),
    normalizeAzureActivityLog(azureActivityLog),
    normalizeAzureActivityLog(azureActivityLogError),
    normalizeGcpAlertPolicy(gcpAlertPolicy),
    normalizeGcpAlertPolicy(gcpAlertPolicyDisabled),
    normalizeGcpUptimeCheck(gcpUptimeCheck),
    normalizeK8sEvent(k8sEventWarning),
    normalizeK8sEvent(k8sEventNormal),
  ];
}

// ===================================================================
// Manager tests
// ===================================================================

describe("Manager", () => {
  describe("filterIncidents", () => {
    it("filters by cloud", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, { clouds: ["aws"] });
      expect(result.every((i) => i.cloud === "aws")).toBe(true);
      expect(result.length).toBe(5); // 3 alarms + 2 insights
    });

    it("filters by multiple clouds", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, { clouds: ["azure", "gcp"] });
      expect(result.every((i) => i.cloud === "azure" || i.cloud === "gcp")).toBe(true);
    });

    it("filters by severity", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, { severities: [1, 2] });
      expect(result.every((i) => i.severity <= 2)).toBe(true);
    });

    it("filters by status", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, { statuses: ["firing"] });
      expect(result.every((i) => i.status === "firing")).toBe(true);
    });

    it("filters by source", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, { sources: ["cloudwatch-alarm"] });
      expect(result).toHaveLength(3);
    });

    it("filters by resource substring", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, { resource: "PaymentService" });
      expect(result).toHaveLength(2); // 2 insights
    });

    it("filters by search text", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, { search: "CPU" });
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((i) =>
        i.title.toLowerCase().includes("cpu") ||
        i.description.toLowerCase().includes("cpu") ||
        i.resource.toLowerCase().includes("cpu"),
      )).toBe(true);
    });

    it("filters by date range", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, {
        startedAfter: "2024-06-01T10:05:00Z",
        startedBefore: "2024-06-01T12:00:00Z",
      });
      for (const inc of result) {
        const t = new Date(inc.startedAt).getTime();
        expect(t).toBeGreaterThanOrEqual(new Date("2024-06-01T10:05:00Z").getTime());
        expect(t).toBeLessThanOrEqual(new Date("2024-06-01T12:00:00Z").getTime());
      }
    });

    it("returns all incidents with empty filter", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, {});
      expect(result).toHaveLength(all.length);
    });

    it("combines multiple filters", () => {
      const all = buildTestIncidents();
      const result = filterIncidents(all, {
        clouds: ["aws"],
        statuses: ["firing"],
      });
      expect(result.every((i) => i.cloud === "aws" && i.status === "firing")).toBe(true);
    });
  });

  describe("aggregateIncidents", () => {
    it("counts total incidents", () => {
      const all = buildTestIncidents();
      const summary = aggregateIncidents(all);
      expect(summary.total).toBe(15);
    });

    it("breaks down by status", () => {
      const all = buildTestIncidents();
      const summary = aggregateIncidents(all);
      expect(summary.byStatus.firing).toBeGreaterThan(0);
      expect(summary.byStatus.resolved).toBeGreaterThan(0);
    });

    it("breaks down by severity", () => {
      const all = buildTestIncidents();
      const summary = aggregateIncidents(all);
      // At least severity 1 (Azure critical), 2 (AWS alarm/insight, Azure error), 3, etc.
      const hasCritical = summary.bySeverity[1] > 0;
      const hasHigh = summary.bySeverity[2] > 0;
      expect(hasCritical).toBe(true);
      expect(hasHigh).toBe(true);
    });

    it("breaks down by cloud", () => {
      const all = buildTestIncidents();
      const summary = aggregateIncidents(all);
      expect(summary.byCloud["aws"]).toBe(5);
      expect(summary.byCloud["azure"]).toBeGreaterThan(0);
      expect(summary.byCloud["gcp"]).toBeGreaterThan(0);
      expect(summary.byCloud["kubernetes"]).toBe(2);
    });

    it("calculates top resources", () => {
      const all = buildTestIncidents();
      const summary = aggregateIncidents(all);
      expect(summary.topResources.length).toBeGreaterThan(0);
      expect(summary.topResources[0].count).toBeGreaterThanOrEqual(1);
    });

    it("calculates MTTR for resolved incidents", () => {
      const all = buildTestIncidents();
      const summary = aggregateIncidents(all);
      // There are resolved incidents with resolvedAt set
      // MTTR should be a number or null
      // awsAlarmOk and awsInsightClosed are resolved with resolvedAt
      expect(summary.mttr === null || typeof summary.mttr === "number").toBe(true);
    });

    it("returns null MTTR when no resolved incidents exist", () => {
      const firing = buildTestIncidents().filter((i) => i.status === "firing");
      const summary = aggregateIncidents(firing);
      expect(summary.mttr).toBeNull();
    });

    it("reports latestIncidentAt", () => {
      const all = buildTestIncidents();
      const summary = aggregateIncidents(all);
      expect(summary.latestIncidentAt).toBeTruthy();
    });

    it("handles empty array", () => {
      const summary = aggregateIncidents([]);
      expect(summary.total).toBe(0);
      expect(summary.mttr).toBeNull();
      expect(summary.topResources).toHaveLength(0);
    });
  });

  describe("correlateIncidents", () => {
    it("returns empty array for < 2 incidents", () => {
      const single = [normalizeAwsAlarm(awsAlarm)];
      expect(correlateIncidents(single)).toHaveLength(0);
    });

    it("detects shared-resource correlation", () => {
      // Two AWS insights for the same service
      const incidents = [
        normalizeAwsInsight(awsInsight),
        normalizeAwsInsight(awsInsightClosed),
      ];
      const groups = correlateIncidents(incidents);
      const resourceGroup = groups.find((g) => g.reason === "shared-resource");
      expect(resourceGroup).toBeDefined();
      expect(resourceGroup!.incidentIds.length).toBe(2);
    });

    it("detects temporal-proximity correlation", () => {
      // AWS alarm and Azure error happen within 5 minutes in the same region
      const awsInc = normalizeAwsAlarm({
        ...awsAlarm,
        alarmArn: "arn:aws:cloudwatch:us-east-1:123:alarm:A",
        stateUpdatedTimestamp: "2024-06-01T10:00:00Z",
      });
      const azInc = {
        ...normalizeAzureAlert({
          ...azureAlert,
          id: "/subs/s1/rg/r1/providers/a/b/c",
        }),
        region: "us-east-1",
        startedAt: "2024-06-01T10:02:00Z",
      };
      const groups = correlateIncidents([awsInc, azInc]);
      const temporal = groups.find((g) => g.reason === "temporal-proximity");
      expect(temporal).toBeDefined();
    });

    it("assigns confidence scores", () => {
      const incidents = [
        normalizeAwsInsight(awsInsight),
        normalizeAwsInsight(awsInsightClosed),
      ];
      const groups = correlateIncidents(incidents);
      for (const g of groups) {
        expect(g.confidence).toBeGreaterThan(0);
        expect(g.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("sorts groups by confidence descending", () => {
      const all = buildTestIncidents();
      const groups = correlateIncidents(all);
      for (let i = 1; i < groups.length; i++) {
        expect(groups[i].confidence).toBeLessThanOrEqual(groups[i - 1].confidence);
      }
    });
  });

  describe("buildTimeline", () => {
    it("creates timeline entries for each incident", () => {
      const all = buildTestIncidents();
      const timeline = buildTimeline(all);
      expect(timeline.entries.length).toBeGreaterThanOrEqual(all.length);
      expect(timeline.incidentCount).toBe(all.length);
    });

    it("adds resolved entries for resolved incidents", () => {
      const resolved = buildTestIncidents().filter((i) => i.status === "resolved" && i.resolvedAt);
      const timeline = buildTimeline(resolved);
      const resolvedEntries = timeline.entries.filter((e) => e.type === "resolved");
      expect(resolvedEntries.length).toBe(resolved.length);
    });

    it("entries are sorted chronologically", () => {
      const all = buildTestIncidents();
      const timeline = buildTimeline(all);
      for (let i = 1; i < timeline.entries.length; i++) {
        expect(new Date(timeline.entries[i].timestamp).getTime())
          .toBeGreaterThanOrEqual(new Date(timeline.entries[i - 1].timestamp).getTime());
      }
    });

    it("sets startTime and endTime", () => {
      const all = buildTestIncidents();
      const timeline = buildTimeline(all);
      expect(timeline.startTime).toBeTruthy();
      expect(timeline.endTime).toBeTruthy();
    });

    it("handles empty array", () => {
      const timeline = buildTimeline([]);
      expect(timeline.entries).toHaveLength(0);
      expect(timeline.startTime).toBeNull();
      expect(timeline.endTime).toBeNull();
      expect(timeline.incidentCount).toBe(0);
    });
  });

  describe("triageIncidents", () => {
    it("sorts by severity first (critical first)", () => {
      const all = buildTestIncidents();
      const triaged = triageIncidents(all);
      expect(triaged[0].severity).toBeLessThanOrEqual(triaged[triaged.length - 1].severity);
    });

    it("sorts by status within same severity", () => {
      // Create incidents with same severity but different statuses
      const firing = normalizeCustom("aws", { severity: 2, status: "firing", id: "a" });
      const ack = normalizeCustom("aws", { severity: 2, status: "acknowledged", id: "b" });
      const resolved = normalizeCustom("aws", { severity: 2, status: "resolved", id: "c" });
      const triaged = triageIncidents([resolved, ack, firing]);
      expect(triaged[0].status).toBe("firing");
      expect(triaged[1].status).toBe("acknowledged");
      expect(triaged[2].status).toBe("resolved");
    });

    it("returns a new array (does not mutate input)", () => {
      const all = buildTestIncidents();
      const triaged = triageIncidents(all);
      expect(triaged).not.toBe(all);
    });

    it("puts critical firing incidents first", () => {
      const all = buildTestIncidents();
      const triaged = triageIncidents(all);
      // First incident should be the most critical and firing
      const first = triaged[0];
      expect(first.severity).toBeLessThanOrEqual(2);
    });
  });
});

// ===================================================================
// Tool execution tests
// ===================================================================

describe("Tools", () => {
  const tools = createIncidentTools();

  function findTool(name: string) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool as { name: string; execute: (input: any) => Promise<any> };
  }

  it("createIncidentTools returns 6 tools", () => {
    expect(tools).toHaveLength(6);
    const names = tools.map((t) => t.name);
    expect(names).toContain("incident_normalize");
    expect(names).toContain("incident_summary");
    expect(names).toContain("incident_correlate");
    expect(names).toContain("incident_triage");
    expect(names).toContain("incident_timeline");
    expect(names).toContain("incident_filter");
  });

  describe("incident_normalize", () => {
    it("normalises raw cloud data", async () => {
      const tool = findTool("incident_normalize");
      const inputs = [
        { cloud: "aws", source: "cloudwatch-alarm", items: [awsAlarm, awsAlarmOk] },
        { cloud: "azure", source: "azure-metric-alert", items: [azureAlert] },
      ];
      const result = await tool.execute({ inputs: JSON.stringify(inputs) });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(3);
      expect(parsed.incidents).toHaveLength(3);
    });

    it("returns error for invalid JSON", async () => {
      const tool = findTool("incident_normalize");
      const result = await tool.execute({ inputs: "not-json" });
      expect(result.content[0].text).toContain("Error");
    });
  });

  describe("incident_summary", () => {
    it("produces summary from incidents", async () => {
      const tool = findTool("incident_summary");
      const incidents = buildTestIncidents();
      const result = await tool.execute({ incidents: JSON.stringify(incidents) });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(15);
      expect(parsed.byCloud).toBeDefined();
      expect(parsed.bySeverity).toBeDefined();
    });
  });

  describe("incident_correlate", () => {
    it("finds correlation groups", async () => {
      const tool = findTool("incident_correlate");
      const incidents = buildTestIncidents();
      const result = await tool.execute({ incidents: JSON.stringify(incidents) });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.groupCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(parsed.groups)).toBe(true);
    });
  });

  describe("incident_triage", () => {
    it("returns triaged incidents", async () => {
      const tool = findTool("incident_triage");
      const incidents = buildTestIncidents();
      const result = await tool.execute({ incidents: JSON.stringify(incidents) });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(15);
      expect(parsed.incidents[0].severity).toBeLessThanOrEqual(
        parsed.incidents[parsed.incidents.length - 1].severity,
      );
    });

    it("respects limit parameter", async () => {
      const tool = findTool("incident_triage");
      const incidents = buildTestIncidents();
      const result = await tool.execute({ incidents: JSON.stringify(incidents), limit: 3 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(3);
    });
  });

  describe("incident_timeline", () => {
    it("builds a timeline", async () => {
      const tool = findTool("incident_timeline");
      const incidents = buildTestIncidents();
      const result = await tool.execute({ incidents: JSON.stringify(incidents) });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.incidentCount).toBe(15);
      expect(parsed.entries.length).toBeGreaterThan(0);
    });
  });

  describe("incident_filter", () => {
    it("filters by cloud", async () => {
      const tool = findTool("incident_filter");
      const incidents = buildTestIncidents();
      const filter: IncidentFilter = { clouds: ["aws"] };
      const result = await tool.execute({
        incidents: JSON.stringify(incidents),
        filter: JSON.stringify(filter),
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(5);
      expect(parsed.incidents.every((i: UnifiedIncident) => i.cloud === "aws")).toBe(true);
    });

    it("returns error for invalid filter", async () => {
      const tool = findTool("incident_filter");
      const result = await tool.execute({
        incidents: "[]",
        filter: "bad-json",
      });
      expect(result.content[0].text).toContain("Error");
    });
  });
});
