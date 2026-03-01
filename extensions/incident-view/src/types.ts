/**
 * Cross-Cloud Unified Incident Types
 *
 * A cloud-agnostic incident model that normalises AWS CloudWatch alarms,
 * Azure Monitor alerts, GCP Cloud Monitoring alert policies, and
 * Kubernetes events into a single schema.
 */

// =============================================================================
// Cloud Provider
// =============================================================================

/** Supported cloud providers for incident ingestion. */
export type CloudProvider = "aws" | "azure" | "gcp" | "kubernetes";

/** Sub-source within a cloud provider. */
export type IncidentSource =
  | "cloudwatch-alarm"
  | "cloudwatch-insight"
  | "azure-metric-alert"
  | "azure-activity-log"
  | "gcp-alert-policy"
  | "gcp-uptime-check"
  | "k8s-event"
  | "custom";

// =============================================================================
// Severity & Status
// =============================================================================

/**
 * Normalised severity levels (1 = critical, 5 = informational).
 *
 * Mapping from cloud-native severities:
 *   AWS  : ALARM → 1–2, INSUFFICIENT_DATA → 3, OK → 5
 *   Azure: Sev0 → 1, Sev1 → 2, Sev2 → 3, Sev3 → 4, Sev4 → 5
 *   GCP  : Derived from condition threshold / policy configuration
 */
export type IncidentSeverity = 1 | 2 | 3 | 4 | 5;

/** Normalised incident status. */
export type IncidentStatus =
  | "firing"       // Active / currently triggered
  | "acknowledged" // Seen by an operator, not yet resolved
  | "resolved"     // Alert condition cleared
  | "suppressed";  // Silenced / maintenance-window

// =============================================================================
// Unified Incident
// =============================================================================

/** A single normalised incident record. */
export type UnifiedIncident = {
  /** Deterministic ID: `<cloud>:<source>:<nativeId>`. */
  id: string;
  /** Originating cloud provider. */
  cloud: CloudProvider;
  /** Sub-source within the provider. */
  source: IncidentSource;
  /** Original resource identifier in the cloud (ARN, resource-id, etc.). */
  nativeId: string;
  /** Human-readable title. */
  title: string;
  /** Longer explanation of the incident. */
  description: string;
  /** Normalised severity (1 = critical). */
  severity: IncidentSeverity;
  /** Current status. */
  status: IncidentStatus;
  /** Affected resource identifier (ARN, Azure resource ID, GCP name). */
  resource: string;
  /** Cloud region or "global". */
  region: string;
  /** ISO-8601 timestamp when the incident started. */
  startedAt: string;
  /** ISO-8601 timestamp of the last state change. */
  updatedAt: string;
  /** ISO-8601 timestamp when the incident resolved (if resolved). */
  resolvedAt?: string;
  /** Tags / labels from the source system. */
  tags: Record<string, string>;
  /** Original cloud-specific payload for drill-down. */
  rawData: Record<string, unknown>;
};

// =============================================================================
// Raw Ingestion Input
// =============================================================================

/** Shape accepted by the normaliser for batch ingestion. */
export type RawIncidentInput = {
  cloud: CloudProvider;
  source: IncidentSource;
  /** Array of cloud-native alert/alarm objects (JSON-serialisable). */
  items: Record<string, unknown>[];
};

// =============================================================================
// Filters
// =============================================================================

/** Filter options for querying the unified incident list. */
export type IncidentFilter = {
  clouds?: CloudProvider[];
  sources?: IncidentSource[];
  severities?: IncidentSeverity[];
  statuses?: IncidentStatus[];
  /** Only incidents started after this ISO-8601 timestamp. */
  startedAfter?: string;
  /** Only incidents started before this ISO-8601 timestamp. */
  startedBefore?: string;
  /** Free-text search across title and description. */
  search?: string;
  /** Resource ID substring match. */
  resource?: string;
  /** Tag key=value pairs (all must match). */
  tags?: Record<string, string>;
};

// =============================================================================
// Summary / Dashboard
// =============================================================================

/** Aggregated incident metrics for a dashboard view. */
export type IncidentSummary = {
  /** Total incident count. */
  total: number;
  /** Breakdown by status. */
  byStatus: Record<IncidentStatus, number>;
  /** Breakdown by severity. */
  bySeverity: Record<IncidentSeverity, number>;
  /** Breakdown by cloud provider. */
  byCloud: Record<string, number>;
  /** Breakdown by source. */
  bySource: Record<string, number>;
  /** Mean time from firing to resolution (ms), or null if none resolved. */
  mttr: number | null;
  /** Top 10 most-affected resources. */
  topResources: { resource: string; count: number }[];
  /** ISO-8601 timestamp of the most recent incident. */
  latestIncidentAt: string | null;
};

// =============================================================================
// Correlation
// =============================================================================

/** A group of incidents believed to be related. */
export type IncidentCorrelationGroup = {
  /** Auto-generated correlation ID. */
  correlationId: string;
  /** Why these incidents were grouped. */
  reason: CorrelationReason;
  /** Confidence score 0–1. */
  confidence: number;
  /** Incident IDs in this group. */
  incidentIds: string[];
  /** Summary string for display. */
  summary: string;
};

export type CorrelationReason =
  | "temporal-proximity"   // Fired within a short window
  | "shared-resource"      // Same underlying resource
  | "shared-region"        // Same region, overlapping time
  | "cross-cloud-resource" // Same logical service across clouds
  | "cascade";             // One likely caused another

// =============================================================================
// Timeline
// =============================================================================

/** An entry in the chronological incident timeline. */
export type TimelineEntry = {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Type of timeline event. */
  type: "fired" | "acknowledged" | "resolved" | "updated";
  /** Incident ID. */
  incidentId: string;
  /** Short label for display. */
  label: string;
};

/** Full timeline result. */
export type IncidentTimeline = {
  /** Ordered entries (oldest first). */
  entries: TimelineEntry[];
  /** Time span covered. */
  startTime: string | null;
  endTime: string | null;
  /** Number of unique incidents in the timeline. */
  incidentCount: number;
};
