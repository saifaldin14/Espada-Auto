/**
 * Incident Normalizers
 *
 * Pure functions that convert cloud-specific alert/alarm structures into
 * the unified UnifiedIncident model.  Each normalizer accepts a plain
 * JSON object (the raw cloud payload) and returns a UnifiedIncident.
 *
 * The normalizers are intentionally *dependency-free* — they do not import
 * from the cloud extensions.  They rely only on well-known JSON field names
 * that match the cloud SDKs / CLI output.
 */

import type {
  CloudProvider,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  UnifiedIncident,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return String(value);
}

function str(value: unknown, fallback = ""): string {
  return value != null ? String(value) : fallback;
}

function makeId(cloud: CloudProvider, source: IncidentSource, nativeId: string): string {
  return `${cloud}:${source}:${nativeId}`;
}

// ---------------------------------------------------------------------------
// AWS CloudWatch Alarm
// ---------------------------------------------------------------------------

/**
 * Normalise an AWS CloudWatch alarm (as returned by DescribeAlarms /
 * the ObservabilityManager.listAlarms result shape).
 *
 * Expected fields on `raw`:
 *   alarmName, alarmArn, alarmDescription, stateValue, stateReason,
 *   stateUpdatedTimestamp, metricName, namespace, dimensions, actionsEnabled
 */
export function normalizeAwsAlarm(raw: Record<string, unknown>): UnifiedIncident {
  const state = str(raw.stateValue, "INSUFFICIENT_DATA");
  let severity: IncidentSeverity;
  let status: IncidentStatus;

  switch (state) {
    case "ALARM":
      severity = 2;
      status = "firing";
      break;
    case "OK":
      severity = 5;
      status = "resolved";
      break;
    default: // INSUFFICIENT_DATA
      severity = 3;
      status = "firing";
  }

  const alarmName = str(raw.alarmName);
  const alarmArn = str(raw.alarmArn, alarmName);
  const updatedAt = toIso(raw.stateUpdatedTimestamp);

  // Extract region from ARN: arn:aws:cloudwatch:<region>:...
  let region = "unknown";
  if (typeof raw.alarmArn === "string") {
    const parts = raw.alarmArn.split(":");
    if (parts.length >= 4) region = parts[3];
  }

  // Build resource from namespace + dimensions
  const ns = str(raw.namespace);
  const dims = Array.isArray(raw.dimensions)
    ? (raw.dimensions as { name?: string; value?: string }[])
        .map((d) => `${d.name ?? ""}=${d.value ?? ""}`)
        .join(", ")
    : "";
  const resource = dims ? `${ns} (${dims})` : ns || alarmArn;

  return {
    id: makeId("aws", "cloudwatch-alarm", alarmArn),
    cloud: "aws",
    source: "cloudwatch-alarm",
    nativeId: alarmArn,
    title: alarmName,
    description: str(raw.alarmDescription || raw.stateReason, `CloudWatch alarm ${alarmName} is ${state}`),
    severity,
    status,
    resource,
    region,
    startedAt: updatedAt,
    updatedAt,
    resolvedAt: state === "OK" ? updatedAt : undefined,
    tags: {},
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// AWS X-Ray Insight
// ---------------------------------------------------------------------------

/**
 * Normalise an AWS X-Ray insight summary.
 *
 * Expected fields on `raw`:
 *   insightId, groupName, state, summary, startTime, endTime,
 *   rootCauseServiceId, clientRequestImpactStatistics
 */
export function normalizeAwsInsight(raw: Record<string, unknown>): UnifiedIncident {
  const state = str(raw.state, "ACTIVE");
  const status: IncidentStatus = state === "CLOSED" ? "resolved" : "firing";
  const severity: IncidentSeverity = status === "firing" ? 2 : 5;

  const insightId = str(raw.insightId);
  const rootCause = raw.rootCauseServiceId as Record<string, unknown> | undefined;
  const serviceName = str(rootCause?.name, "unknown-service");

  const startedAt = toIso(raw.startTime);
  const endedAt = raw.endTime ? toIso(raw.endTime) : undefined;

  return {
    id: makeId("aws", "cloudwatch-insight", insightId),
    cloud: "aws",
    source: "cloudwatch-insight",
    nativeId: insightId,
    title: `X-Ray Insight: ${serviceName}`,
    description: str(raw.summary, `X-Ray insight for ${serviceName}`),
    severity,
    status,
    resource: serviceName,
    region: "global",
    startedAt,
    updatedAt: endedAt ?? startedAt,
    resolvedAt: status === "resolved" ? endedAt : undefined,
    tags: {},
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// Azure Metric Alert
// ---------------------------------------------------------------------------

/**
 * Normalise an Azure Monitor metric alert rule.
 *
 * Expected fields on `raw`:
 *   id, name, description, severity (0-4), enabled, scopes,
 *   location, resourceGroup
 */
export function normalizeAzureAlert(raw: Record<string, unknown>): UnifiedIncident {
  // Azure severity: 0=Critical, 1=Error, 2=Warning, 3=Info, 4=Verbose
  const azSev = typeof raw.severity === "number" ? raw.severity : 3;
  const severityMap: Record<number, IncidentSeverity> = {
    0: 1,
    1: 2,
    2: 3,
    3: 4,
    4: 5,
  };
  const severity = severityMap[azSev as number] ?? 3;

  const enabled = raw.enabled !== false;
  const status: IncidentStatus = enabled ? "firing" : "suppressed";

  const name = str(raw.name);
  const resourceId = str(raw.id);
  const scopes = Array.isArray(raw.scopes) ? (raw.scopes as string[]) : [];
  const primaryScope = scopes[0] ?? resourceId;

  // Extract region
  const location = str(raw.location, "global");

  const now = new Date().toISOString();

  return {
    id: makeId("azure", "azure-metric-alert", resourceId),
    cloud: "azure",
    source: "azure-metric-alert",
    nativeId: resourceId,
    title: name,
    description: str(raw.description, `Azure metric alert: ${name}`),
    severity,
    status,
    resource: primaryScope,
    region: location,
    startedAt: now,
    updatedAt: now,
    tags: (raw.tags ?? {}) as Record<string, string>,
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// Azure Activity Log Alert
// ---------------------------------------------------------------------------

/**
 * Normalise an Azure Activity Log entry treated as an incident.
 *
 * Expected fields on `raw`:
 *   operationName, status, level, resourceId, eventTimestamp,
 *   caller, description
 */
export function normalizeAzureActivityLog(raw: Record<string, unknown>): UnifiedIncident {
  const level = str(raw.level, "Informational");
  const levelSeverityMap: Record<string, IncidentSeverity> = {
    Critical: 1,
    Error: 2,
    Warning: 3,
    Informational: 4,
  };
  const severity = levelSeverityMap[level] ?? 4;

  const opStatus = str(raw.status, "");
  const status: IncidentStatus =
    opStatus.toLowerCase().includes("succeeded") ? "resolved" : "firing";

  const resourceId = str(raw.resourceId);
  const timestamp = toIso(raw.eventTimestamp);

  return {
    id: makeId("azure", "azure-activity-log", `${resourceId}:${timestamp}`),
    cloud: "azure",
    source: "azure-activity-log",
    nativeId: resourceId,
    title: str(raw.operationName, "Azure Activity"),
    description: str(raw.description, `Activity: ${str(raw.operationName)}`),
    severity,
    status,
    resource: resourceId,
    region: "global",
    startedAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: status === "resolved" ? timestamp : undefined,
    tags: {},
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// GCP Alert Policy
// ---------------------------------------------------------------------------

/**
 * Normalise a GCP Cloud Monitoring alert policy.
 *
 * Expected fields on `raw`:
 *   name, displayName, enabled, conditions, combiner,
 *   notificationChannels, createdAt
 */
export function normalizeGcpAlertPolicy(raw: Record<string, unknown>): UnifiedIncident {
  const enabled = raw.enabled !== false;
  const status: IncidentStatus = enabled ? "firing" : "suppressed";

  // GCP alert policies don't have native severity; infer from condition count
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  const severity: IncidentSeverity = conditions.length > 2 ? 2 : conditions.length > 0 ? 3 : 4;

  const name = str(raw.name);
  const displayName = str(raw.displayName, name);
  const createdAt = toIso(raw.createdAt);

  // Extract project from resource name: projects/<project>/alertPolicies/<id>
  let region = "global";
  const nameParts = name.split("/");
  const projectIdx = nameParts.indexOf("projects");
  if (projectIdx >= 0 && nameParts.length > projectIdx + 1) {
    region = `project:${nameParts[projectIdx + 1]}`;
  }

  return {
    id: makeId("gcp", "gcp-alert-policy", name),
    cloud: "gcp",
    source: "gcp-alert-policy",
    nativeId: name,
    title: displayName,
    description: `GCP alert policy: ${displayName} (${conditions.length} condition(s), combiner: ${str(raw.combiner, "OR")})`,
    severity,
    status,
    resource: name,
    region,
    startedAt: createdAt,
    updatedAt: createdAt,
    tags: {},
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// GCP Uptime Check
// ---------------------------------------------------------------------------

/**
 * Normalise a GCP uptime check configuration as an incident source.
 *
 * Expected fields on `raw`:
 *   name, displayName, monitoredResource, httpCheck, period, timeout
 */
export function normalizeGcpUptimeCheck(raw: Record<string, unknown>): UnifiedIncident {
  const name = str(raw.name);
  const displayName = str(raw.displayName, name);
  const now = new Date().toISOString();

  return {
    id: makeId("gcp", "gcp-uptime-check", name),
    cloud: "gcp",
    source: "gcp-uptime-check",
    nativeId: name,
    title: `Uptime Check: ${displayName}`,
    description: `GCP uptime check: ${displayName} (period: ${str(raw.period, "60s")}, timeout: ${str(raw.timeout, "10s")})`,
    severity: 3,
    status: "firing",
    resource: name,
    region: "global",
    startedAt: now,
    updatedAt: now,
    tags: {},
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// Kubernetes Event
// ---------------------------------------------------------------------------

/**
 * Normalise a Kubernetes event (e.g. from `kubectl get events -o json`).
 *
 * Expected fields on `raw`:
 *   reason, message, type, involvedObject, firstTimestamp, lastTimestamp,
 *   count, metadata
 */
export function normalizeK8sEvent(raw: Record<string, unknown>): UnifiedIncident {
  const eventType = str(raw.type, "Normal");
  const severity: IncidentSeverity = eventType === "Warning" ? 3 : 5;
  const status: IncidentStatus = eventType === "Warning" ? "firing" : "resolved";

  const involved = (raw.involvedObject ?? {}) as Record<string, unknown>;
  const resource = `${str(involved.kind)}/${str(involved.name)}`;
  const ns = str(involved.namespace, "default");
  const reason = str(raw.reason, "Unknown");
  const message = str(raw.message, "");
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  const uid = str(metadata.uid, `${resource}:${reason}`);

  const startedAt = toIso(raw.firstTimestamp || (metadata as Record<string, unknown>).creationTimestamp);
  const updatedAt = toIso(raw.lastTimestamp || raw.firstTimestamp);

  return {
    id: makeId("kubernetes", "k8s-event", uid),
    cloud: "kubernetes",
    source: "k8s-event",
    nativeId: uid,
    title: `${reason}: ${resource}`,
    description: message || `K8s event ${reason} on ${resource}`,
    severity,
    status,
    resource: `${ns}/${resource}`,
    region: "cluster",
    startedAt,
    updatedAt,
    tags: {},
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// Generic / Custom
// ---------------------------------------------------------------------------

/**
 * Normalise a generic incident record.
 *
 * Expected fields on `raw`:
 *   id, title, description, severity, status, resource, region,
 *   startedAt, updatedAt, resolvedAt, tags
 */
export function normalizeCustom(
  cloud: CloudProvider,
  raw: Record<string, unknown>,
): UnifiedIncident {
  const now = new Date().toISOString();
  const nativeId = str(raw.id, `custom-${Date.now()}`);

  return {
    id: makeId(cloud, "custom", nativeId),
    cloud,
    source: "custom",
    nativeId,
    title: str(raw.title, "Custom incident"),
    description: str(raw.description, ""),
    severity: (typeof raw.severity === "number" && raw.severity >= 1 && raw.severity <= 5
      ? raw.severity
      : 3) as IncidentSeverity,
    status: (["firing", "acknowledged", "resolved", "suppressed"].includes(str(raw.status))
      ? str(raw.status)
      : "firing") as IncidentStatus,
    resource: str(raw.resource, "unknown"),
    region: str(raw.region, "unknown"),
    startedAt: str(raw.startedAt, now),
    updatedAt: str(raw.updatedAt, now),
    resolvedAt: raw.resolvedAt ? str(raw.resolvedAt) : undefined,
    tags: (raw.tags ?? {}) as Record<string, string>,
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const SOURCE_NORMALIZERS: Record<string, (raw: Record<string, unknown>) => UnifiedIncident> = {
  "cloudwatch-alarm": normalizeAwsAlarm,
  "cloudwatch-insight": normalizeAwsInsight,
  "azure-metric-alert": normalizeAzureAlert,
  "azure-activity-log": normalizeAzureActivityLog,
  "gcp-alert-policy": normalizeGcpAlertPolicy,
  "gcp-uptime-check": normalizeGcpUptimeCheck,
  "k8s-event": normalizeK8sEvent,
};

/**
 * Normalise a single raw item given its cloud and source.
 */
export function normalizeOne(
  cloud: CloudProvider,
  source: IncidentSource,
  raw: Record<string, unknown>,
): UnifiedIncident {
  const fn = SOURCE_NORMALIZERS[source];
  if (fn) return fn(raw);
  return normalizeCustom(cloud, raw);
}

/**
 * Batch-normalise an array of raw items for a given cloud/source pair.
 */
export function normalizeBatch(
  cloud: CloudProvider,
  source: IncidentSource,
  items: Record<string, unknown>[],
): UnifiedIncident[] {
  return items.map((item) => normalizeOne(cloud, source, item));
}
