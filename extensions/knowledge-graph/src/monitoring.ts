/**
 * Infrastructure Knowledge Graph — Continuous Monitoring
 *
 * Provides:
 * - Scheduled sync with configurable intervals
 * - Event-driven updates from cloud audit logs (CloudTrail, Activity Log, Audit Log)
 * - Alerting rules for orphans, SPOFs, cost anomalies, unauthorized changes
 * - Timeline query helpers for historical infrastructure analysis
 */

import type {
  GraphStorage,
  GraphNode,
  GraphChange,
  SyncRecord,
  CloudProvider,
  ChangeFilter,
  GraphStats,
} from "./types.js";
import { GraphEngine } from "./engine.js";

// =============================================================================
// Configuration
// =============================================================================

export type MonitorSchedule = {
  /** Interval in milliseconds between scans. */
  intervalMs: number;
  /** Providers to scan (empty = all registered). */
  providers?: CloudProvider[];
  /** Whether cross-cloud analysis runs after each sync. */
  crossCloud?: boolean;
};

/** Preset intervals for common schedules. */
export const SCHEDULE_PRESETS = {
  "5min": 5 * 60 * 1000,
  "15min": 15 * 60 * 1000,
  "hourly": 60 * 60 * 1000,
  "daily": 24 * 60 * 60 * 1000,
} as const;

export type SchedulePreset = keyof typeof SCHEDULE_PRESETS;

export type MonitorConfig = {
  /** Scheduled sync configuration. */
  schedule: MonitorSchedule;
  /** Alert rules to evaluate after each sync. */
  alertRules: AlertRule[];
  /** Alert dispatch destinations. */
  alertDestinations: AlertDestination[];
  /** Maximum alerts per evaluation cycle (prevent flood). */
  maxAlertsPerCycle: number;
  /** How long to suppress duplicate alerts (ms). */
  alertCooldownMs: number;
  /** Event source configurations. */
  eventSources: EventSourceConfig[];
};

export const defaultMonitorConfig: MonitorConfig = {
  schedule: {
    intervalMs: SCHEDULE_PRESETS.hourly,
    crossCloud: true,
  },
  alertRules: [],
  alertDestinations: [],
  maxAlertsPerCycle: 50,
  alertCooldownMs: 30 * 60 * 1000, // 30 minutes
  eventSources: [],
};

// =============================================================================
// Alert Types
// =============================================================================

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertCategory =
  | "orphan"
  | "spof"
  | "cost-anomaly"
  | "unauthorized-change"
  | "drift"
  | "disappeared"
  | "custom";

/** Configuration for a single alert rule. */
export type AlertRule = {
  /** Unique rule ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description. */
  description: string;
  /** Alert category. */
  category: AlertCategory;
  /** Alert severity. */
  severity: AlertSeverity;
  /** Whether this rule is enabled. */
  enabled: boolean;
  /** The evaluation function. Returns alerts if the condition is met. */
  evaluate: (ctx: AlertEvaluationContext) => Promise<AlertInstance[]>;
};

/** Context provided to alert evaluation functions. */
export type AlertEvaluationContext = {
  engine: GraphEngine;
  storage: GraphStorage;
  syncRecords: SyncRecord[];
  previousStats: GraphStats | null;
  currentStats: GraphStats;
};

/** A triggered alert instance. */
export type AlertInstance = {
  /** Unique alert instance ID. */
  id: string;
  /** Rule that triggered this alert. */
  ruleId: string;
  /** Alert category. */
  category: AlertCategory;
  /** Severity. */
  severity: AlertSeverity;
  /** Human-readable title. */
  title: string;
  /** Detailed message with context. */
  message: string;
  /** Affected node IDs. */
  affectedNodeIds: string[];
  /** Estimated cost impact (monthly, if applicable). */
  costImpact: number | null;
  /** When the alert was generated. */
  triggeredAt: string;
  /** Additional metadata. */
  metadata: Record<string, unknown>;
};

// =============================================================================
// Alert Destinations
// =============================================================================

export type AlertDestinationType = "console" | "webhook" | "callback";

export type AlertDestination = {
  type: AlertDestinationType;
  /** For webhook: URL to POST alerts to. */
  url?: string;
  /** For webhook: custom headers. */
  headers?: Record<string, string>;
  /** For callback: function to invoke. */
  callback?: (alerts: AlertInstance[]) => Promise<void>;
};

// =============================================================================
// Event Sources (Cloud Audit Logs)
// =============================================================================

export type EventSourceType = "cloudtrail" | "azure-activity" | "gcp-audit" | "webhook";

export type EventSourceConfig = {
  /** Source type. */
  type: EventSourceType;
  /** Whether this source is enabled. */
  enabled: boolean;
  /** Polling interval in milliseconds (for pull-based sources). */
  pollIntervalMs?: number;
  /** Provider-specific configuration. */
  config: Record<string, unknown>;
};

/** A normalized cloud event from any provider. */
export type CloudEvent = {
  /** Unique event ID. */
  id: string;
  /** Source provider. */
  provider: CloudProvider;
  /** Event type (e.g. "CreateInstance", "DeleteBucket"). */
  eventType: string;
  /** The resource affected. */
  resourceId: string;
  /** Resource type (best-effort mapping). */
  resourceType: string;
  /** Who performed the action. */
  actor: string;
  /** When the event occurred. */
  timestamp: string;
  /** Read-only event (describe, list) vs. mutation. */
  readOnly: boolean;
  /** Whether the action succeeded. */
  success: boolean;
  /** Raw event data. */
  raw: Record<string, unknown>;
};

// =============================================================================
// Event Source Adapters
// =============================================================================

/**
 * Interface for cloud event source adapters.
 * Implementations poll or receive events from cloud audit logs.
 */
export interface EventSourceAdapter {
  /** Source type. */
  readonly type: EventSourceType;
  /** Provider this source is for. */
  readonly provider: CloudProvider;
  /** Fetch events since a given timestamp. */
  fetchEvents(since: string): Promise<CloudEvent[]>;
  /** Health check. */
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}

// =============================================================================
// CloudTrail Event Source
// =============================================================================

/**
 * AWS CloudTrail event source adapter.
 *
 * Polls CloudTrail's LookupEvents API for recent infrastructure changes.
 * Requires `@aws-sdk/client-cloudtrail` at runtime.
 */
export class CloudTrailEventSource implements EventSourceAdapter {
  readonly type = "cloudtrail" as const;
  readonly provider: CloudProvider = "aws";

  private config: {
    region?: string;
    profile?: string;
    /** Filter to only mutation events (default: true). */
    mutationsOnly?: boolean;
    /** CloudTrail client factory for DI. */
    clientFactory?: (config: Record<string, unknown>) => CloudTrailClient;
  };

  constructor(config: CloudTrailEventSource["config"]) {
    this.config = config;
  }

  async fetchEvents(since: string): Promise<CloudEvent[]> {
    const client = await this.getClient();
    const sinceDate = new Date(since);
    const events: CloudEvent[] = [];

    const response = await client.lookupEvents({
      StartTime: sinceDate,
      EndTime: new Date(),
      MaxResults: 50,
    });

    for (const event of response.Events ?? []) {
      const readOnly = event.ReadOnly === "true";
      if (this.config.mutationsOnly !== false && readOnly) continue;

      const parsed = this.parseCloudTrailEvent(event);
      if (parsed) events.push(parsed);
    }

    return events;
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const client = await this.getClient();
      await client.lookupEvents({ MaxResults: 1 });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseCloudTrailEvent(event: CloudTrailRawEvent): CloudEvent | null {
    if (!event.EventId || !event.EventName) return null;

    return {
      id: event.EventId,
      provider: "aws",
      eventType: event.EventName,
      resourceId: event.Resources?.[0]?.ResourceName ?? "unknown",
      resourceType: event.Resources?.[0]?.ResourceType ?? "unknown",
      actor: event.Username ?? "unknown",
      timestamp: event.EventTime
        ? new Date(event.EventTime).toISOString()
        : new Date().toISOString(),
      readOnly: event.ReadOnly === "true",
      success: !event.ErrorCode,
      raw: event as Record<string, unknown>,
    };
  }

  private async getClient(): Promise<CloudTrailClient> {
    if (this.config.clientFactory) {
      return this.config.clientFactory({
        region: this.config.region,
      });
    }

    const { CloudTrailClient: SdkClient, LookupEventsCommand } = await import("@aws-sdk/client-cloudtrail");
    const sdkClient = new SdkClient({
      region: this.config.region ?? "us-east-1",
    });

    return {
      lookupEvents: async (params) => {
        const command = new LookupEventsCommand(params);
        const response = await sdkClient.send(command);
        return {
          Events: (response.Events as CloudTrailRawEvent[]) ?? undefined,
        };
      },
    };
  }
}

/** Minimal CloudTrail client interface for DI. */
export interface CloudTrailClient {
  lookupEvents(params: {
    StartTime?: Date;
    EndTime?: Date;
    MaxResults?: number;
  }): Promise<{
    Events?: CloudTrailRawEvent[];
  }>;
}

/** Raw CloudTrail event shape. */
export type CloudTrailRawEvent = {
  EventId?: string;
  EventName?: string;
  EventTime?: string | number | Date;
  Username?: string;
  ReadOnly?: string;
  ErrorCode?: string;
  Resources?: Array<{
    ResourceType?: string;
    ResourceName?: string;
  }>;
  [key: string]: unknown;
};

// =============================================================================
// Azure Activity Log Event Source
// =============================================================================

/**
 * Azure Activity Log event source adapter.
 *
 * Uses Azure Monitor Management API to poll activity log events.
 * Requires `@azure/arm-monitor` and `@azure/identity` at runtime.
 */
export class AzureActivityLogEventSource implements EventSourceAdapter {
  readonly type = "azure-activity" as const;
  readonly provider: CloudProvider = "azure";

  private config: {
    subscriptionId: string;
    tenantId?: string;
    /** Activity log client factory for DI. */
    clientFactory?: (config: Record<string, unknown>) => AzureActivityClient;
  };

  constructor(config: AzureActivityLogEventSource["config"]) {
    this.config = config;
  }

  async fetchEvents(since: string): Promise<CloudEvent[]> {
    const client = await this.getClient();
    const events: CloudEvent[] = [];

    const filter = `eventTimestamp ge '${since}'`;
    const rawEvents = await client.listEvents(filter);

    for (const event of rawEvents) {
      const parsed = this.parseActivityEvent(event);
      if (parsed) events.push(parsed);
    }

    return events;
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const client = await this.getClient();
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await client.listEvents(`eventTimestamp ge '${cutoff}'`);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseActivityEvent(event: AzureActivityRawEvent): CloudEvent | null {
    if (!event.eventDataId) return null;

    const isWrite = event.operationName?.value?.includes("write") ?? false;
    const isDelete = event.operationName?.value?.includes("delete") ?? false;

    return {
      id: event.eventDataId,
      provider: "azure",
      eventType: event.operationName?.value ?? "unknown",
      resourceId: event.resourceId ?? "unknown",
      resourceType: event.resourceType?.value ?? "unknown",
      actor: event.caller ?? "unknown",
      timestamp: event.eventTimestamp
        ? new Date(event.eventTimestamp).toISOString()
        : new Date().toISOString(),
      readOnly: !isWrite && !isDelete,
      success: event.status?.value === "Succeeded",
      raw: event as Record<string, unknown>,
    };
  }

  private async getClient(): Promise<AzureActivityClient> {
    if (this.config.clientFactory) {
      return this.config.clientFactory({
        subscriptionId: this.config.subscriptionId,
        tenantId: this.config.tenantId,
      });
    }

    // Dynamic import Azure SDK
    const { DefaultAzureCredential } = await import("@azure/identity");
    // @ts-ignore -- optional peer dependency, resolved at runtime
    const { MonitorManagementClient } = await import("@azure/arm-monitor");

    const credential = new DefaultAzureCredential();
    const monitorClient = new MonitorManagementClient(
      credential,
      this.config.subscriptionId,
    );

    return {
      listEvents: async (filter: string) => {
        const result: AzureActivityRawEvent[] = [];
        for await (const event of monitorClient.activityLogs.list(filter)) {
          result.push(event as AzureActivityRawEvent);
        }
        return result;
      },
    };
  }
}

/** Minimal Azure Activity Log client interface for DI. */
export interface AzureActivityClient {
  listEvents(filter: string): Promise<AzureActivityRawEvent[]>;
}

/** Raw Azure Activity Log event shape. */
export type AzureActivityRawEvent = {
  eventDataId?: string;
  eventTimestamp?: string | Date;
  operationName?: { value?: string };
  resourceId?: string;
  resourceType?: { value?: string };
  caller?: string;
  status?: { value?: string };
  [key: string]: unknown;
};

// =============================================================================
// GCP Audit Log Event Source
// =============================================================================

/**
 * GCP Audit Log event source adapter.
 *
 * Uses Cloud Logging API to query audit log entries.
 * Requires `@google-cloud/logging` at runtime.
 */
export class GcpAuditLogEventSource implements EventSourceAdapter {
  readonly type = "gcp-audit" as const;
  readonly provider: CloudProvider = "gcp";

  private config: {
    projectId: string;
    /** Logging client factory for DI. */
    clientFactory?: (config: Record<string, unknown>) => GcpAuditClient;
  };

  constructor(config: GcpAuditLogEventSource["config"]) {
    this.config = config;
  }

  async fetchEvents(since: string): Promise<CloudEvent[]> {
    const client = await this.getClient();
    const events: CloudEvent[] = [];

    const filter = [
      `logName="projects/${this.config.projectId}/logs/cloudaudit.googleapis.com%2Factivity"`,
      `timestamp>="${since}"`,
    ].join(" AND ");

    const entries = await client.listEntries(filter);

    for (const entry of entries) {
      const parsed = this.parseAuditEntry(entry);
      if (parsed) events.push(parsed);
    }

    return events;
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const client = await this.getClient();
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await client.listEntries(`timestamp>="${cutoff}"`);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseAuditEntry(entry: GcpAuditRawEntry): CloudEvent | null {
    const payload = entry.protoPayload ?? {};
    const methodName = payload.methodName ?? "unknown";

    return {
      id: entry.insertId ?? `gcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      provider: "gcp",
      eventType: methodName,
      resourceId: payload.resourceName ?? entry.resource?.labels?.instance_id ?? "unknown",
      resourceType: entry.resource?.type ?? "unknown",
      actor: payload.authenticationInfo?.principalEmail ?? "unknown",
      timestamp: entry.timestamp
        ? new Date(entry.timestamp).toISOString()
        : new Date().toISOString(),
      readOnly: methodName.startsWith("get") || methodName.startsWith("list"),
      success: payload.status?.code === 0 || !payload.status,
      raw: entry as Record<string, unknown>,
    };
  }

  private async getClient(): Promise<GcpAuditClient> {
    if (this.config.clientFactory) {
      return this.config.clientFactory({
        projectId: this.config.projectId,
      });
    }

    // @ts-ignore -- optional peer dependency, resolved at runtime
    const { Logging } = await import("@google-cloud/logging");
    const logging = new Logging({ projectId: this.config.projectId });

    return {
      listEntries: async (filter: string) => {
        const [entries] = await logging.getEntries({ filter, pageSize: 100 });
        return entries.map((e: { metadata: unknown }) => e.metadata as GcpAuditRawEntry);
      },
    };
  }
}

/** Minimal GCP Audit Log client interface for DI. */
export interface GcpAuditClient {
  listEntries(filter: string): Promise<GcpAuditRawEntry[]>;
}

/** Raw GCP Audit Log entry shape. */
export type GcpAuditRawEntry = {
  insertId?: string;
  timestamp?: string | Date;
  resource?: {
    type?: string;
    labels?: Record<string, string>;
  };
  protoPayload?: {
    methodName?: string;
    resourceName?: string;
    authenticationInfo?: {
      principalEmail?: string;
    };
    status?: {
      code?: number;
      message?: string;
    };
  };
  [key: string]: unknown;
};

// =============================================================================
// Built-in Alert Rules
// =============================================================================

function generateAlertId(): string {
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Alert when new orphaned resources are detected.
 * Orphans = nodes with zero edges (no connections to anything).
 */
export const orphanAlertRule: AlertRule = {
  id: "builtin-orphan",
  name: "Orphaned Resources",
  description: "Alerts when resources have no connections to other infrastructure",
  category: "orphan",
  severity: "warning",
  enabled: true,
  evaluate: async (ctx) => {
    const allNodes = await ctx.storage.queryNodes({
      status: ["running", "unknown"],
    });
    const orphans: GraphNode[] = [];

    for (const node of allNodes) {
      const edges = await ctx.storage.getEdgesForNode(node.id, "both");
      if (edges.length === 0) {
        orphans.push(node);
      }
    }

    if (orphans.length === 0) return [];

    const totalCost = orphans.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

    return [{
      id: generateAlertId(),
      ruleId: "builtin-orphan",
      category: "orphan",
      severity: totalCost > 1000 ? "critical" : "warning",
      title: `${orphans.length} orphaned resource${orphans.length === 1 ? "" : "s"} detected`,
      message: [
        `Found ${orphans.length} resource(s) with no connections.`,
        totalCost > 0 ? `Estimated wasted spend: $${totalCost.toFixed(2)}/mo.` : "",
        `Top orphans: ${orphans.slice(0, 5).map((n) => `${n.name} (${n.provider}/${n.resourceType})`).join(", ")}`,
      ].filter(Boolean).join(" "),
      affectedNodeIds: orphans.map((n) => n.id),
      costImpact: totalCost > 0 ? totalCost : null,
      triggeredAt: new Date().toISOString(),
      metadata: {
        orphanCount: orphans.length,
        byProvider: Object.fromEntries(
          Object.entries(
            orphans.reduce<Record<string, number>>((acc, n) => {
              acc[n.provider] = (acc[n.provider] ?? 0) + 1;
              return acc;
            }, {}),
          ),
        ),
      },
    }];
  },
};

/**
 * Alert when a single point of failure (SPOF) is introduced.
 * Uses articulation point detection (Tarjan's algorithm proxy via critical nodes).
 */
export const spofAlertRule: AlertRule = {
  id: "builtin-spof",
  name: "Single Point of Failure",
  description: "Alerts when a node is a critical bottleneck (high degree + high reachability)",
  category: "spof",
  severity: "critical",
  enabled: true,
  evaluate: async (ctx) => {
    const allNodes = await ctx.storage.queryNodes({
      status: ["running"],
    });
    if (allNodes.length === 0) return [];

    const alerts: AlertInstance[] = [];

    for (const node of allNodes) {
      const outEdges = await ctx.storage.getEdgesForNode(node.id, "downstream");
      const inEdges = await ctx.storage.getEdgesForNode(node.id, "upstream");
      const degree = outEdges.length + inEdges.length;

      // Only flag nodes with high degree as potential SPOFs
      if (degree < 5) continue;

      // BFS to count reachability
      const reachable = new Set<string>();
      const queue = [node.id];
      reachable.add(node.id);
      while (queue.length > 0) {
        const current = queue.shift()!;
        const edges = await ctx.storage.getEdgesForNode(current, "downstream");
        for (const edge of edges) {
          if (!reachable.has(edge.targetNodeId)) {
            reachable.add(edge.targetNodeId);
            queue.push(edge.targetNodeId);
          }
        }
      }

      const reachabilityRatio = reachable.size / allNodes.length;
      if (reachabilityRatio > 0.3) {
        alerts.push({
          id: generateAlertId(),
          ruleId: "builtin-spof",
          category: "spof",
          severity: "critical",
          title: `SPOF detected: ${node.name}`,
          message: [
            `"${node.name}" (${node.provider}/${node.resourceType})`,
            `has ${degree} connections and can reach ${Math.round(reachabilityRatio * 100)}%`,
            `of the infrastructure graph. Its failure could impact`,
            `${reachable.size - 1} downstream resource(s).`,
          ].join(" "),
          affectedNodeIds: [node.id, ...Array.from(reachable)],
          costImpact: null,
          triggeredAt: new Date().toISOString(),
          metadata: { degree, reachabilityRatio, reachableCount: reachable.size },
        });
      }
    }

    return alerts;
  },
};

/**
 * Alert on cost anomalies (> threshold % increase in 24h).
 */
export const costAnomalyAlertRule: AlertRule = {
  id: "builtin-cost-anomaly",
  name: "Cost Anomaly",
  description: "Alerts when total infrastructure cost increases by more than 20% since last sync",
  category: "cost-anomaly",
  severity: "warning",
  enabled: true,
  evaluate: async (ctx) => {
    if (!ctx.previousStats) return [];

    const previousCost = ctx.previousStats.totalCostMonthly;
    const currentCost = ctx.currentStats.totalCostMonthly;

    if (previousCost <= 0) return [];

    const changePercent = ((currentCost - previousCost) / previousCost) * 100;

    if (changePercent <= 20) return [];

    const costDelta = currentCost - previousCost;

    // Find nodes with new or increased costs
    const allNodes = await ctx.storage.queryNodes({});
    const costChanges = allNodes
      .filter((n) => (n.costMonthly ?? 0) > 0)
      .sort((a, b) => (b.costMonthly ?? 0) - (a.costMonthly ?? 0))
      .slice(0, 10);

    return [{
      id: generateAlertId(),
      ruleId: "builtin-cost-anomaly",
      category: "cost-anomaly",
      severity: changePercent > 50 ? "critical" : "warning",
      title: `Cost anomaly: +${changePercent.toFixed(1)}% ($${costDelta.toFixed(2)}/mo)`,
      message: [
        `Infrastructure cost increased from $${previousCost.toFixed(2)}/mo`,
        `to $${currentCost.toFixed(2)}/mo (+${changePercent.toFixed(1)}%).`,
        `Top cost nodes: ${costChanges.slice(0, 3).map((n) => `${n.name} ($${(n.costMonthly ?? 0).toFixed(2)})`).join(", ")}`,
      ].join(" "),
      affectedNodeIds: costChanges.map((n) => n.id),
      costImpact: costDelta,
      triggeredAt: new Date().toISOString(),
      metadata: {
        previousCost,
        currentCost,
        changePercent,
      },
    }];
  },
};

/**
 * Alert on unauthorized changes (no approval record / unknown initiator).
 * Checks recent changes for missing initiator or agent-initiated changes
 * without governance approval.
 */
export const unauthorizedChangeAlertRule: AlertRule = {
  id: "builtin-unauthorized",
  name: "Unauthorized Change",
  description: "Alerts when infrastructure changes have no approval record",
  category: "unauthorized-change",
  severity: "critical",
  enabled: true,
  evaluate: async (ctx) => {
    // Look at changes from the most recent sync
    const lastSync = ctx.syncRecords[0];
    if (!lastSync) return [];

    const recentChanges = await ctx.storage.getChanges({
      since: lastSync.startedAt,
      changeType: ["node-created", "node-updated", "node-deleted"],
    });

    const suspicious = recentChanges.filter((c) => {
      // Agent-initiated changes without a correlation ID (approval) are suspicious
      if (c.initiatorType === "agent" && !c.correlationId) return true;
      // Unknown initiator on mutation changes
      if (!c.initiator && !c.initiatorType) return true;
      return false;
    });

    if (suspicious.length === 0) return [];

    return [{
      id: generateAlertId(),
      ruleId: "builtin-unauthorized",
      category: "unauthorized-change",
      severity: "critical",
      title: `${suspicious.length} unauthorized change${suspicious.length === 1 ? "" : "s"} detected`,
      message: [
        `Found ${suspicious.length} infrastructure change(s) without proper authorization.`,
        `Change types: ${[...new Set(suspicious.map((c) => c.changeType))].join(", ")}.`,
        `Affected resources: ${[...new Set(suspicious.map((c) => c.targetId))].slice(0, 5).join(", ")}`,
      ].join(" "),
      affectedNodeIds: [...new Set(suspicious.map((c) => c.targetId))],
      costImpact: null,
      triggeredAt: new Date().toISOString(),
      metadata: {
        suspiciousChangeCount: suspicious.length,
        changeTypes: [...new Set(suspicious.map((c) => c.changeType))],
        changes: suspicious.slice(0, 10).map((c) => ({
          id: c.id,
          targetId: c.targetId,
          changeType: c.changeType,
          initiator: c.initiator,
          initiatorType: c.initiatorType,
        })),
      },
    }];
  },
};

/**
 * Alert when resources disappear from the cloud provider.
 */
export const disappearedAlertRule: AlertRule = {
  id: "builtin-disappeared",
  name: "Resources Disappeared",
  description: "Alerts when previously tracked resources are no longer found",
  category: "disappeared",
  severity: "warning",
  enabled: true,
  evaluate: async (ctx) => {
    const lastSync = ctx.syncRecords[0];
    if (!lastSync || lastSync.nodesDisappeared === 0) return [];

    const recentChanges = await ctx.storage.getChanges({
      since: lastSync.startedAt,
      changeType: ["node-disappeared"],
    });

    if (recentChanges.length === 0) return [];

    return [{
      id: generateAlertId(),
      ruleId: "builtin-disappeared",
      category: "disappeared",
      severity: recentChanges.length > 5 ? "critical" : "warning",
      title: `${recentChanges.length} resource${recentChanges.length === 1 ? "" : "s"} disappeared`,
      message: [
        `${recentChanges.length} previously tracked resource(s) were not found in the latest scan.`,
        `Resources: ${recentChanges.slice(0, 5).map((c) => c.targetId).join(", ")}`,
        recentChanges.length > 5 ? `(and ${recentChanges.length - 5} more)` : "",
      ].filter(Boolean).join(" "),
      affectedNodeIds: recentChanges.map((c) => c.targetId),
      costImpact: null,
      triggeredAt: new Date().toISOString(),
      metadata: {
        disappearedCount: recentChanges.length,
      },
    }];
  },
};

/** All built-in alert rules. */
export const BUILTIN_ALERT_RULES: AlertRule[] = [
  orphanAlertRule,
  spofAlertRule,
  costAnomalyAlertRule,
  unauthorizedChangeAlertRule,
  disappearedAlertRule,
];

// =============================================================================
// Timeline Query Helpers
// =============================================================================

/**
 * Get a summary of all infrastructure changes within a time range.
 */
export async function getTimelineSummary(
  storage: GraphStorage,
  since: string,
  until?: string,
): Promise<TimelineSummary> {
  const filter: ChangeFilter = { since, until };
  const changes = await storage.getChanges(filter);

  const byType: Record<string, number> = {};
  const byInitiator: Record<string, number> = {};
  const affectedResources = new Set<string>();

  for (const change of changes) {
    byType[change.changeType] = (byType[change.changeType] ?? 0) + 1;
    const initiator = change.initiator ?? "unknown";
    byInitiator[initiator] = (byInitiator[initiator] ?? 0) + 1;
    affectedResources.add(change.targetId);
  }

  return {
    since,
    until: until ?? new Date().toISOString(),
    totalChanges: changes.length,
    byType,
    byInitiator,
    affectedResourceCount: affectedResources.size,
    changes,
  };
}

export type TimelineSummary = {
  since: string;
  until: string;
  totalChanges: number;
  byType: Record<string, number>;
  byInitiator: Record<string, number>;
  affectedResourceCount: number;
  changes: GraphChange[];
};

/**
 * Compare the graph at two points in time (diff).
 * Returns nodes that were created, deleted, or modified between the two timestamps.
 */
export async function getGraphDiff(
  storage: GraphStorage,
  since: string,
  until?: string,
): Promise<GraphDiff> {
  const changes = await storage.getChanges({ since, until });

  const created: string[] = [];
  const deleted: string[] = [];
  const modified = new Map<string, GraphChange[]>();

  for (const change of changes) {
    switch (change.changeType) {
      case "node-created":
        created.push(change.targetId);
        break;
      case "node-deleted":
      case "node-disappeared":
        deleted.push(change.targetId);
        break;
      case "node-updated":
      case "node-drifted":
      case "cost-changed": {
        const existing = modified.get(change.targetId) ?? [];
        existing.push(change);
        modified.set(change.targetId, existing);
        break;
      }
    }
  }

  return {
    since,
    until: until ?? new Date().toISOString(),
    created: [...new Set(created)],
    deleted: [...new Set(deleted)],
    modified: Object.fromEntries(modified),
  };
}

export type GraphDiff = {
  since: string;
  until: string;
  created: string[];
  deleted: string[];
  modified: Record<string, GraphChange[]>;
};

/**
 * Get cost trend data across sync records.
 */
export async function getCostTrend(
  storage: GraphStorage,
  limit = 30,
): Promise<CostTrendPoint[]> {
  const syncRecords = await storage.listSyncRecords(limit);
  const trend: CostTrendPoint[] = [];

  for (const record of syncRecords) {
    if (record.status !== "completed" && record.status !== "partial") continue;

    // Get cost changes from this sync's timeframe
    const costChanges = await storage.getChanges({
      since: record.startedAt,
      until: record.completedAt ?? undefined,
      changeType: ["cost-changed"],
    });

    // Use changes to build cost data points
    if (costChanges.length > 0 || record.nodesDiscovered > 0) {
      trend.push({
        timestamp: record.startedAt,
        syncId: record.id,
        provider: record.provider,
        nodesDiscovered: record.nodesDiscovered,
        costChanges: costChanges.length,
      });
    }
  }

  return trend;
}

export type CostTrendPoint = {
  timestamp: string;
  syncId: string;
  provider: string;
  nodesDiscovered: number;
  costChanges: number;
};

// =============================================================================
// Infrastructure Monitor
// =============================================================================

/**
 * Continuous infrastructure monitor.
 *
 * Manages scheduled sync cycles, event polling, alert evaluation, and dispatch.
 * Designed to run as a long-lived process (e.g. within the Espada gateway).
 */
export class InfraMonitor {
  private engine: GraphEngine;
  private storage: GraphStorage;
  private config: MonitorConfig;
  private eventSources: EventSourceAdapter[];

  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private eventTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastStats: GraphStats | null = null;
  private alertCooldowns: Map<string, number> = new Map();
  private running = false;

  /** Accumulated alerts from the monitor's lifetime (for inspection). */
  readonly alertHistory: AlertInstance[] = [];

  constructor(options: {
    engine: GraphEngine;
    storage: GraphStorage;
    config?: Partial<MonitorConfig>;
    eventSources?: EventSourceAdapter[];
  }) {
    this.engine = options.engine;
    this.storage = options.storage;
    this.config = { ...defaultMonitorConfig, ...options.config };
    this.eventSources = options.eventSources ?? [];

    // Register built-in rules if no custom rules provided
    if (this.config.alertRules.length === 0) {
      this.config.alertRules = [...BUILTIN_ALERT_RULES];
    }
  }

  /** Start the monitoring loop. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Capture initial stats for comparison
    this.lastStats = await this.storage.getStats();

    // Start scheduled sync
    this.syncTimer = setInterval(
      () => void this.runSyncCycle(),
      this.config.schedule.intervalMs,
    );

    // Start event source polling
    for (const source of this.eventSources) {
      const interval = source.type === "cloudtrail" ? 5 * 60 * 1000 : 5 * 60 * 1000;
      const timer = setInterval(
        () => void this.pollEventSource(source),
        interval,
      );
      this.eventTimers.set(source.type, timer);
    }
  }

  /** Stop the monitoring loop. */
  stop(): void {
    this.running = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    for (const [, timer] of this.eventTimers) {
      clearInterval(timer);
    }
    this.eventTimers.clear();
  }

  /** Whether the monitor is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run a single sync cycle: sync → evaluate alerts → dispatch.
   * Can be called manually for testing.
   */
  async runSyncCycle(): Promise<SyncCycleResult> {
    const startMs = Date.now();
    const previousStats = this.lastStats;

    // 1. Run sync
    const syncRecords = await this.engine.sync({
      providers: this.config.schedule.providers,
    });

    // 2. Capture current stats
    const currentStats = await this.storage.getStats();
    this.lastStats = currentStats;

    // 3. Evaluate alert rules
    const alerts = await this.evaluateAlerts({
      engine: this.engine,
      storage: this.storage,
      syncRecords,
      previousStats,
      currentStats,
    });

    // 4. Dispatch alerts
    if (alerts.length > 0) {
      await this.dispatchAlerts(alerts);
    }

    return {
      syncRecords,
      alerts,
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Evaluate all enabled alert rules against the current state.
   */
  async evaluateAlerts(ctx: AlertEvaluationContext): Promise<AlertInstance[]> {
    const allAlerts: AlertInstance[] = [];
    const now = Date.now();

    for (const rule of this.config.alertRules) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastFired = this.alertCooldowns.get(rule.id);
      if (lastFired && now - lastFired < this.config.alertCooldownMs) {
        continue;
      }

      try {
        const ruleAlerts = await rule.evaluate(ctx);
        if (ruleAlerts.length > 0) {
          allAlerts.push(...ruleAlerts);
          this.alertCooldowns.set(rule.id, now);
        }
      } catch {
        // Swallow evaluation errors — one rule failing shouldn't stop others
      }
    }

    // Apply max alerts limit
    const limited = allAlerts.slice(0, this.config.maxAlertsPerCycle);
    this.alertHistory.push(...limited);

    return limited;
  }

  /**
   * Dispatch alerts to all configured destinations.
   */
  async dispatchAlerts(alerts: AlertInstance[]): Promise<void> {
    for (const dest of this.config.alertDestinations) {
      try {
        switch (dest.type) {
          case "console":
            for (const alert of alerts) {
              const prefix = alert.severity === "critical" ? "🚨" : "⚠️";
              console.error(`${prefix} [${alert.category}] ${alert.title}`);
              console.error(`   ${alert.message}`);
            }
            break;

          case "webhook":
            if (dest.url) {
              await fetch(dest.url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...dest.headers,
                },
                body: JSON.stringify({ alerts }),
              });
            }
            break;

          case "callback":
            if (dest.callback) {
              await dest.callback(alerts);
            }
            break;
        }
      } catch {
        // Dispatch errors are non-fatal
      }
    }
  }

  /**
   * Poll an event source for new events and process them.
   */
  async pollEventSource(source: EventSourceAdapter): Promise<CloudEvent[]> {
    try {
      // Get last sync time for this provider
      const lastSync = await this.storage.getLastSyncRecord(source.provider);
      const since = lastSync?.completedAt ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const events = await source.fetchEvents(since);

      // Convert events to graph changes and persist
      for (const event of events) {
        if (event.readOnly) continue;

        const change: GraphChange = {
          id: `event-${event.id}`,
          targetId: event.resourceId,
          changeType: this.mapEventToChangeType(event.eventType),
          field: null,
          previousValue: null,
          newValue: event.eventType,
          detectedAt: event.timestamp,
          detectedVia: "event-stream",
          correlationId: event.id,
          initiator: event.actor,
          initiatorType: "human",
          metadata: {
            eventSource: source.type,
            eventType: event.eventType,
            success: event.success,
          },
        };

        await this.storage.appendChange(change);
      }

      return events;
    } catch {
      return [];
    }
  }

  /**
   * Ingest externally pushed events (e.g. from a WebhookReceiver).
   * Converts events to graph changes and persists them. Skips read-only events.
   */
  async ingestEvents(events: CloudEvent[]): Promise<number> {
    let ingested = 0;
    for (const event of events) {
      if (event.readOnly) continue;

      const change: GraphChange = {
        id: `event-${event.id}`,
        targetId: event.resourceId,
        changeType: this.mapEventToChangeType(event.eventType),
        field: null,
        previousValue: null,
        newValue: event.eventType,
        detectedAt: event.timestamp,
        detectedVia: "event-stream",
        correlationId: event.id,
        initiator: event.actor,
        initiatorType: "human",
        metadata: {
          eventSource: "webhook",
          eventType: event.eventType,
          success: event.success,
        },
      };

      await this.storage.appendChange(change);
      ingested++;
    }
    return ingested;
  }

  /**
   * Map a cloud event type name to a GraphChangeType.
   */
  private mapEventToChangeType(eventType: string): GraphChange["changeType"] {
    const lower = eventType.toLowerCase();
    if (lower.includes("create") || lower.includes("run") || lower.includes("launch")) {
      return "node-created";
    }
    if (lower.includes("delete") || lower.includes("terminate") || lower.includes("remove")) {
      return "node-deleted";
    }
    return "node-updated";
  }

  /**
   * Get the monitor's current status summary.
   */
  getStatus(): MonitorStatus {
    return {
      running: this.running,
      schedule: this.config.schedule,
      activeEventSources: this.eventSources.map((s) => ({
        type: s.type,
        provider: s.provider,
      })),
      alertRulesEnabled: this.config.alertRules.filter((r) => r.enabled).length,
      alertRulesTotal: this.config.alertRules.length,
      alertsTriggered: this.alertHistory.length,
      lastStats: this.lastStats,
    };
  }
}

export type SyncCycleResult = {
  syncRecords: SyncRecord[];
  alerts: AlertInstance[];
  durationMs: number;
  timestamp: string;
};

export type MonitorStatus = {
  running: boolean;
  schedule: MonitorSchedule;
  activeEventSources: Array<{ type: EventSourceType; provider: CloudProvider }>;
  alertRulesEnabled: number;
  alertRulesTotal: number;
  alertsTriggered: number;
  lastStats: GraphStats | null;
};
