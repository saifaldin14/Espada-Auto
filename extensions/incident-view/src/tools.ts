/**
 * Incident-view agent tools.
 *
 * Provides four tools for the LLM agent:
 *  - incident_normalize  — Convert raw cloud alerts into UnifiedIncident[]
 *  - incident_summary    — Aggregate dashboard metrics
 *  - incident_correlate  — Find related incident clusters
 *  - incident_triage     — Prioritised incident list
 */

import { Type } from "@sinclair/typebox";
import { normalizeBatch } from "./normalizers.js";
import {
  aggregateIncidents,
  buildTimeline,
  correlateIncidents,
  filterIncidents,
  triageIncidents,
} from "./manager.js";
import type { RawIncidentInput, UnifiedIncident, IncidentFilter } from "./types.js";

export function createIncidentTools() {
  return [
    incidentNormalizeTool,
    incidentSummaryTool,
    incidentCorrelateTool,
    incidentTriageTool,
    incidentTimelineTool,
    incidentFilterTool,
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

function parseIncidents(json: string): UnifiedIncident[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of incidents");
  return parsed as UnifiedIncident[];
}

// ---------------------------------------------------------------------------
// incident_normalize
// ---------------------------------------------------------------------------

const incidentNormalizeTool = {
  name: "incident_normalize",
  description:
    "Normalize raw cloud alerts/alarms into a unified incident format. " +
    "Accepts an array of { cloud, source, items[] } objects where cloud is " +
    '"aws"|"azure"|"gcp"|"kubernetes" and source is the alert type ' +
    '(e.g. "cloudwatch-alarm", "azure-metric-alert", "gcp-alert-policy", "k8s-event").',
  inputSchema: Type.Object({
    inputs: Type.String({
      description:
        "JSON string — array of { cloud, source, items[] }. Each item is a raw cloud alert object.",
    }),
  }),
  execute: async (input: { inputs: string }) => {
    try {
      const raw: RawIncidentInput[] = JSON.parse(input.inputs);
      if (!Array.isArray(raw)) return err("Expected a JSON array");

      const incidents: UnifiedIncident[] = [];
      for (const batch of raw) {
        const normalized = normalizeBatch(
          batch.cloud,
          batch.source,
          batch.items,
        );
        incidents.push(...normalized);
      }

      return ok({ count: incidents.length, incidents });
    } catch (e) {
      return err(String(e));
    }
  },
};

// ---------------------------------------------------------------------------
// incident_summary
// ---------------------------------------------------------------------------

const incidentSummaryTool = {
  name: "incident_summary",
  description:
    "Produce a dashboard-style summary from a list of unified incidents. " +
    "Returns totals by status, severity, cloud, source, MTTR, and top resources.",
  inputSchema: Type.Object({
    incidents: Type.String({
      description:
        "JSON string — array of UnifiedIncident objects (output of incident_normalize).",
    }),
  }),
  execute: async (input: { incidents: string }) => {
    try {
      const incidents = parseIncidents(input.incidents);
      const summary = aggregateIncidents(incidents);
      return ok(summary);
    } catch (e) {
      return err(String(e));
    }
  },
};

// ---------------------------------------------------------------------------
// incident_correlate
// ---------------------------------------------------------------------------

const incidentCorrelateTool = {
  name: "incident_correlate",
  description:
    "Identify groups of related incidents using temporal proximity, shared " +
    "resources, shared regions, and cross-cloud correlation.",
  inputSchema: Type.Object({
    incidents: Type.String({
      description:
        "JSON string — array of UnifiedIncident objects.",
    }),
  }),
  execute: async (input: { incidents: string }) => {
    try {
      const incidents = parseIncidents(input.incidents);
      const groups = correlateIncidents(incidents);
      return ok({ groupCount: groups.length, groups });
    } catch (e) {
      return err(String(e));
    }
  },
};

// ---------------------------------------------------------------------------
// incident_triage
// ---------------------------------------------------------------------------

const incidentTriageTool = {
  name: "incident_triage",
  description:
    "Return incidents sorted by triage priority: severity (critical first), " +
    "then status (firing > acknowledged > suppressed > resolved), then recency.",
  inputSchema: Type.Object({
    incidents: Type.String({
      description: "JSON string — array of UnifiedIncident objects.",
    }),
    limit: Type.Optional(
      Type.Number({ description: "Maximum number of incidents to return" }),
    ),
  }),
  execute: async (input: { incidents: string; limit?: number }) => {
    try {
      let incidents = parseIncidents(input.incidents);
      incidents = triageIncidents(incidents);
      if (input.limit && input.limit > 0) {
        incidents = incidents.slice(0, input.limit);
      }
      return ok({ count: incidents.length, incidents });
    } catch (e) {
      return err(String(e));
    }
  },
};

// ---------------------------------------------------------------------------
// incident_timeline
// ---------------------------------------------------------------------------

const incidentTimelineTool = {
  name: "incident_timeline",
  description:
    "Build a chronological timeline of incident state changes (fired, acknowledged, resolved).",
  inputSchema: Type.Object({
    incidents: Type.String({
      description: "JSON string — array of UnifiedIncident objects.",
    }),
  }),
  execute: async (input: { incidents: string }) => {
    try {
      const incidents = parseIncidents(input.incidents);
      const timeline = buildTimeline(incidents);
      return ok(timeline);
    } catch (e) {
      return err(String(e));
    }
  },
};

// ---------------------------------------------------------------------------
// incident_filter
// ---------------------------------------------------------------------------

const incidentFilterTool = {
  name: "incident_filter",
  description:
    "Filter a list of unified incidents by cloud, source, severity, status, " +
    "date range, resource, or free-text search.",
  inputSchema: Type.Object({
    incidents: Type.String({
      description: "JSON string — array of UnifiedIncident objects.",
    }),
    filter: Type.String({
      description:
        "JSON string — IncidentFilter object with optional fields: " +
        "clouds, sources, severities, statuses, startedAfter, startedBefore, " +
        "resource, search, tags.",
    }),
  }),
  execute: async (input: { incidents: string; filter: string }) => {
    try {
      const incidents = parseIncidents(input.incidents);
      const filter: IncidentFilter = JSON.parse(input.filter);
      const filtered = filterIncidents(incidents, filter);
      return ok({ count: filtered.length, incidents: filtered });
    } catch (e) {
      return err(String(e));
    }
  },
};
