/**
 * Incident Manager
 *
 * Stateless functions that operate on collections of UnifiedIncident to
 * produce summaries, correlations, timelines, and prioritised triage views.
 */

import type {
  IncidentCorrelationGroup,
  IncidentFilter,
  IncidentSeverity,
  IncidentStatus,
  IncidentSummary,
  IncidentTimeline,
  TimelineEntry,
  UnifiedIncident,
} from "./types.js";

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Apply an IncidentFilter to an array of incidents and return the matching
 * subset.  Every filter field is optional – omitted fields are not applied.
 */
export function filterIncidents(
  incidents: UnifiedIncident[],
  filter: IncidentFilter,
): UnifiedIncident[] {
  let result = incidents;

  if (filter.clouds?.length) {
    const set = new Set(filter.clouds);
    result = result.filter((i) => set.has(i.cloud));
  }

  if (filter.sources?.length) {
    const set = new Set(filter.sources);
    result = result.filter((i) => set.has(i.source));
  }

  if (filter.severities?.length) {
    const set = new Set(filter.severities);
    result = result.filter((i) => set.has(i.severity));
  }

  if (filter.statuses?.length) {
    const set = new Set(filter.statuses);
    result = result.filter((i) => set.has(i.status));
  }

  if (filter.startedAfter) {
    const ts = new Date(filter.startedAfter).getTime();
    result = result.filter((i) => new Date(i.startedAt).getTime() >= ts);
  }

  if (filter.startedBefore) {
    const ts = new Date(filter.startedBefore).getTime();
    result = result.filter((i) => new Date(i.startedAt).getTime() <= ts);
  }

  if (filter.resource) {
    const term = filter.resource.toLowerCase();
    result = result.filter((i) => i.resource.toLowerCase().includes(term));
  }

  if (filter.search) {
    const term = filter.search.toLowerCase();
    result = result.filter(
      (i) =>
        i.title.toLowerCase().includes(term) ||
        i.description.toLowerCase().includes(term) ||
        i.resource.toLowerCase().includes(term),
    );
  }

  if (filter.tags) {
    const entries = Object.entries(filter.tags);
    result = result.filter((i) =>
      entries.every(([k, v]) => i.tags[k] === v),
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Aggregate / Summary
// ---------------------------------------------------------------------------

function countBy<K extends string | number>(
  items: UnifiedIncident[],
  key: (item: UnifiedIncident) => K,
): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

/**
 * Produce an IncidentSummary (dashboard-style aggregate metrics) from a
 * collection of incidents.
 */
export function aggregateIncidents(incidents: UnifiedIncident[]): IncidentSummary {
  const byStatus = countBy(incidents, (i) => i.status) as Record<IncidentStatus, number>;
  const bySeverity = countBy(incidents, (i) => i.severity) as Record<IncidentSeverity, number>;
  const byCloud = countBy(incidents, (i) => i.cloud) as Record<string, number>;
  const bySource = countBy(incidents, (i) => i.source) as Record<string, number>;

  // MTTR — mean time to resolve (only for resolved incidents)
  const resolved = incidents.filter((i) => i.status === "resolved" && i.resolvedAt);
  let mttr: number | null = null;
  if (resolved.length > 0) {
    const totalMs = resolved.reduce((sum, i) => {
      const start = new Date(i.startedAt).getTime();
      const end = new Date(i.resolvedAt!).getTime();
      return sum + Math.max(0, end - start);
    }, 0);
    mttr = totalMs / resolved.length;
  }

  // Top resources
  const resourceCounts = new Map<string, number>();
  for (const i of incidents) {
    resourceCounts.set(i.resource, (resourceCounts.get(i.resource) || 0) + 1);
  }
  const topResources = [...resourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([resource, count]) => ({ resource, count }));

  // Latest incident timestamp
  let latestIncidentAt: string | null = null;
  for (const i of incidents) {
    if (!latestIncidentAt || i.updatedAt > latestIncidentAt) {
      latestIncidentAt = i.updatedAt;
    }
  }

  return {
    total: incidents.length,
    byStatus,
    bySeverity,
    byCloud,
    bySource,
    mttr,
    topResources,
    latestIncidentAt,
  };
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

const TEMPORAL_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Group incidents that are likely related.
 *
 * Correlation strategies:
 *  1. **Temporal proximity** — incidents that start within 5 minutes of each
 *     other.
 *  2. **Shared resource** — incidents affecting the same resource string.
 *  3. **Shared region** — incidents in the same region within the temporal
 *     window.
 *  4. **Cross-cloud resource** — same resource string across different clouds.
 */
export function correlateIncidents(incidents: UnifiedIncident[]): IncidentCorrelationGroup[] {
  if (incidents.length < 2) return [];

  const groups: IncidentCorrelationGroup[] = [];
  const usedPairs = new Set<string>();

  // Sort by time
  const sorted = [...incidents].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  // 1. Shared resource (strongest signal)
  const byResource = new Map<string, UnifiedIncident[]>();
  for (const inc of sorted) {
    const key = inc.resource.toLowerCase();
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key)!.push(inc);
  }
  for (const [resource, incs] of byResource) {
    if (incs.length < 2) continue;

    // Check for cross-cloud
    const clouds = new Set(incs.map((i) => i.cloud));
    const reason = clouds.size > 1 ? "cross-cloud-resource" as const : "shared-resource" as const;
    const confidence = clouds.size > 1 ? 0.9 : 0.8;

    const pairKey = incs.map((i) => i.id).sort().join("|");
    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);

    groups.push({
      correlationId: `res:${resource}`,
      reason,
      confidence,
      incidentIds: incs.map((i) => i.id),
      summary: `${incs.length} incidents sharing resource "${resource}" across ${clouds.size} cloud(s)`,
    });
  }

  // 2. Temporal proximity (within the same region)
  for (let i = 0; i < sorted.length; i++) {
    const cluster: UnifiedIncident[] = [sorted[i]];
    const tA = new Date(sorted[i].startedAt).getTime();

    for (let j = i + 1; j < sorted.length; j++) {
      const tB = new Date(sorted[j].startedAt).getTime();
      if (tB - tA > TEMPORAL_WINDOW_MS) break;
      if (sorted[j].region === sorted[i].region) {
        cluster.push(sorted[j]);
      }
    }

    if (cluster.length >= 2) {
      const ids = cluster.map((c) => c.id).sort();
      const pairKey = ids.join("|");
      if (usedPairs.has(pairKey)) continue;
      usedPairs.add(pairKey);

      groups.push({
        correlationId: `temporal:${sorted[i].region}:${tA}`,
        reason: "temporal-proximity",
        confidence: 0.6,
        incidentIds: ids,
        summary: `${cluster.length} incidents in region "${sorted[i].region}" within 5 minutes`,
      });
    }
  }

  // 3. Region-wide + mixed cloud → cascade
  const byRegion = new Map<string, UnifiedIncident[]>();
  for (const inc of sorted) {
    if (!byRegion.has(inc.region)) byRegion.set(inc.region, []);
    byRegion.get(inc.region)!.push(inc);
  }
  for (const [region, incs] of byRegion) {
    if (incs.length < 3) continue;
    const clouds = new Set(incs.map((i) => i.cloud));
    if (clouds.size < 2) continue;

    const ids = incs.map((i) => i.id).sort();
    const pairKey = ids.join("|");
    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);

    groups.push({
      correlationId: `cascade:${region}`,
      reason: "cascade",
      confidence: 0.7,
      incidentIds: ids,
      summary: `Potential cascade: ${incs.length} incidents across ${clouds.size} clouds in region "${region}"`,
    });
  }

  return groups.sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * Build a chronological timeline of incident state changes.
 */
export function buildTimeline(incidents: UnifiedIncident[]): IncidentTimeline {
  const entries: TimelineEntry[] = [];

  for (const inc of incidents) {
    entries.push({
      timestamp: inc.startedAt,
      type: "fired",
      incidentId: inc.id,
      label: `[${inc.cloud.toUpperCase()}] ${inc.title}`,
    });

    if (inc.status === "acknowledged") {
      entries.push({
        timestamp: inc.updatedAt,
        type: "acknowledged",
        incidentId: inc.id,
        label: `Acknowledged: ${inc.title}`,
      });
    }

    if (inc.status === "resolved" && inc.resolvedAt) {
      entries.push({
        timestamp: inc.resolvedAt,
        type: "resolved",
        incidentId: inc.id,
        label: `Resolved: ${inc.title}`,
      });
    }
  }

  // Sort chronologically
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let startTime: string | null = null;
  let endTime: string | null = null;
  if (entries.length > 0) {
    startTime = entries[0].timestamp;
    endTime = entries[entries.length - 1].timestamp;
  }

  return {
    entries,
    startTime,
    endTime,
    incidentCount: incidents.length,
  };
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/**
 * Sort incidents by priority for triage.  Priority order:
 *  1. Severity ascending (1 = critical first)
 *  2. Status: firing > acknowledged > suppressed > resolved
 *  3. Most recent first
 */
export function triageIncidents(incidents: UnifiedIncident[]): UnifiedIncident[] {
  const statusOrder: Record<IncidentStatus, number> = {
    firing: 0,
    acknowledged: 1,
    suppressed: 2,
    resolved: 3,
  };

  return [...incidents].sort((a, b) => {
    // Severity ascending (lower = more critical)
    if (a.severity !== b.severity) return a.severity - b.severity;
    // Status priority
    const sa = statusOrder[a.status];
    const sb = statusOrder[b.status];
    if (sa !== sb) return sa - sb;
    // Most recent first
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });
}
