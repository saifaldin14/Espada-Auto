/**
 * Persistent Audit Trail — Agent Tools
 *
 * Three tools for querying, exploring, and summarizing audit events
 * via the conversational agent interface.
 */

import { Type } from "@sinclair/typebox";
import type { EspadaPluginApi } from "espada/plugin-sdk";
import { stringEnum } from "espada/plugin-sdk";
import type { AuditLogger } from "./logger.js";
import type { AuditEventType, AuditSeverity, AuditResult } from "./types.js";

const EVENT_TYPES: AuditEventType[] = [
  "command_executed", "tool_invoked", "policy_evaluated",
  "approval_requested", "approval_granted", "approval_denied",
  "state_changed", "config_changed",
  "auth_login", "auth_logout", "auth_failed",
  "resource_created", "resource_updated", "resource_deleted",
  "drift_detected", "alert_triggered", "break_glass_activated",
  "role_assigned", "role_removed", "policy_created", "policy_deleted",
  "compliance_scanned", "blueprint_deployed", "terraform_plan", "terraform_apply",
];

const SEVERITIES: AuditSeverity[] = ["info", "warn", "error", "critical"];
const RESULTS: AuditResult[] = ["success", "failure", "pending", "denied"];

export function registerAuditTools(api: EspadaPluginApi, logger: AuditLogger): void {
  // ─── audit_query ─────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "audit_query",
      label: "Audit Event Query",
      description:
        "Search audit events by time range, event type, actor, resource, severity, and result. " +
        "Use this to investigate what happened, who did what, and when.",
      parameters: Type.Object({
        startDate: Type.Optional(Type.String({ description: "ISO-8601 start date (e.g. 2025-01-01T00:00:00Z)" })),
        endDate: Type.Optional(Type.String({ description: "ISO-8601 end date" })),
        eventType: Type.Optional(stringEnum(EVENT_TYPES, { description: "Filter by event type" })),
        actorId: Type.Optional(Type.String({ description: "Filter by actor ID" })),
        resourceType: Type.Optional(Type.String({ description: "Filter by resource type" })),
        severity: Type.Optional(stringEnum(SEVERITIES, { description: "Filter by severity level" })),
        result: Type.Optional(stringEnum(RESULTS, { description: "Filter by result" })),
        operation: Type.Optional(Type.String({ description: "Search by operation name (partial match)" })),
        limit: Type.Optional(Type.Number({ description: "Max results to return (default 25)" })),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          startDate?: string;
          endDate?: string;
          eventType?: AuditEventType;
          actorId?: string;
          resourceType?: string;
          severity?: AuditSeverity;
          result?: AuditResult;
          operation?: string;
          limit?: number;
        };

        const events = logger.query({
          startDate: p.startDate,
          endDate: p.endDate,
          eventTypes: p.eventType ? [p.eventType] : undefined,
          actorIds: p.actorId ? [p.actorId] : undefined,
          resourceTypes: p.resourceType ? [p.resourceType] : undefined,
          severity: p.severity ? [p.severity] : undefined,
          result: p.result ? [p.result] : undefined,
          operation: p.operation,
          limit: p.limit ?? 25,
        });

        if (events.length === 0) {
          return { content: [{ type: "text" as const, text: "No audit events found matching the filters." }], details: { count: 0 } };
        }

        const lines: string[] = [`Found ${events.length} audit event(s):\n`];
        for (const e of events) {
          const resource = e.resource ? ` → ${e.resource.type}:${e.resource.id}` : "";
          lines.push(
            `• [${e.severity.toUpperCase()}] ${e.timestamp.slice(0, 19)} | ${e.eventType} | ${e.operation}${resource} | ${e.result} | actor: ${e.actor.name || e.actor.id}`,
          );
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { count: events.length } };
      },
    },
    { names: ["audit_query"] },
  );

  // ─── audit_timeline ──────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "audit_timeline",
      label: "Resource Audit Timeline",
      description:
        "Show the chronological audit trail for a specific resource. " +
        "Answers: what has happened to this resource over time?",
      parameters: Type.Object({
        resourceId: Type.String({ description: "The resource ID to get the timeline for" }),
        limit: Type.Optional(Type.Number({ description: "Max events to return (default 25)" })),
      }),
      async execute(_toolCallId, params) {
        const { resourceId, limit } = params as { resourceId: string; limit?: number };
        const timeline = logger.getTimeline(resourceId, limit ?? 25);

        if (timeline.events.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No audit events found for resource: ${resourceId}` }],
            details: { resourceId, eventCount: 0 },
          };
        }

        const lines: string[] = [
          `Audit timeline for ${timeline.resourceType}: ${resourceId}`,
          `First seen: ${timeline.firstSeen}`,
          `Last seen: ${timeline.lastSeen}`,
          `Events: ${timeline.events.length}\n`,
        ];

        for (const e of timeline.events) {
          const actor = e.actor.name || e.actor.id;
          lines.push(
            `  ${e.timestamp.slice(0, 19)} | ${e.eventType} | ${e.operation} | ${e.result} | by ${actor}`,
          );
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { resourceId, eventCount: timeline.events.length } };
      },
    },
    { names: ["audit_timeline"] },
  );

  // ─── audit_summary ───────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "audit_summary",
      label: "Audit Activity Summary",
      description:
        "Get an aggregated summary of audit activity for a time period. " +
        "Shows event counts by type, severity, result, top actors, and top resources.",
      parameters: Type.Object({
        period: Type.Optional(
          stringEnum(["1h", "24h", "7d", "30d"], {
            description: "Time period for summary (default: 24h)",
          }),
        ),
        startDate: Type.Optional(Type.String({ description: "Custom ISO-8601 start date (overrides period)" })),
        endDate: Type.Optional(Type.String({ description: "Custom ISO-8601 end date (overrides period)" })),
      }),
      async execute(_toolCallId, params) {
        const p = params as { period?: string; startDate?: string; endDate?: string };
        const now = new Date();
        let start: Date;

        if (p.startDate) {
          start = new Date(p.startDate);
        } else {
          const periodMs: Record<string, number> = {
            "1h": 3600_000,
            "24h": 86400_000,
            "7d": 604800_000,
            "30d": 2592000_000,
          };
          start = new Date(now.getTime() - (periodMs[p.period ?? "24h"] ?? 86400_000));
        }

        const endDate = p.endDate ?? now.toISOString();
        const startDate = p.startDate ?? start.toISOString();

        const summary = logger.getSummary(startDate, endDate);

        const lines: string[] = [
          `Audit Summary (${startDate.slice(0, 16)} → ${endDate.slice(0, 16)})`,
          `Total events: ${summary.totalEvents}\n`,
        ];

        // By severity
        if (Object.keys(summary.bySeverity).length > 0) {
          lines.push("By Severity:");
          for (const [sev, count] of Object.entries(summary.bySeverity)) {
            lines.push(`  ${sev}: ${count}`);
          }
          lines.push("");
        }

        // By result
        if (Object.keys(summary.byResult).length > 0) {
          lines.push("By Result:");
          for (const [res, count] of Object.entries(summary.byResult)) {
            lines.push(`  ${res}: ${count}`);
          }
          lines.push("");
        }

        // By type (top 10)
        if (Object.keys(summary.byType).length > 0) {
          lines.push("By Event Type:");
          const sorted = Object.entries(summary.byType).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
          for (const [type, count] of sorted.slice(0, 10)) {
            lines.push(`  ${type}: ${count}`);
          }
          lines.push("");
        }

        // Top actors
        if (summary.topActors.length > 0) {
          lines.push("Top Actors:");
          for (const a of summary.topActors.slice(0, 5)) {
            lines.push(`  ${a.name || a.id}: ${a.count} events`);
          }
          lines.push("");
        }

        // Top resources
        if (summary.topResources.length > 0) {
          lines.push("Top Resources:");
          for (const r of summary.topResources.slice(0, 5)) {
            lines.push(`  ${r.type}:${r.id}: ${r.count} events`);
          }
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { totalEvents: summary.totalEvents } };
      },
    },
    { names: ["audit_summary"] },
  );
}
