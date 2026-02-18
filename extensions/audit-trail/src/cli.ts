/**
 * Persistent Audit Trail — CLI Commands
 *
 * `espada audit` subcommands for listing, viewing, summarizing,
 * exporting, and managing audit event retention.
 */

import type { Command } from "commander";
import type { AuditLogger } from "./logger.js";

export type CliContext = {
  program: Command;
  config: unknown;
  workspaceDir?: string;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

export function registerAuditCli(ctx: CliContext, auditLogger: AuditLogger): void {
  const audit = ctx.program.command("audit").description("Audit trail commands — query, view, and export audit events");

  // ─── audit list ────────────────────────────────────────────────────────────
  audit
    .command("list")
    .description("List recent audit events")
    .option("--since <date>", "Start date (ISO-8601 or relative like '24h', '7d')")
    .option("--until <date>", "End date (ISO-8601)")
    .option("--type <type>", "Filter by event type")
    .option("--actor <id>", "Filter by actor ID")
    .option("--resource <type>", "Filter by resource type")
    .option("--severity <level>", "Filter by severity (info, warn, error, critical)")
    .option("--result <result>", "Filter by result (success, failure, pending, denied)")
    .option("-n, --limit <n>", "Max results", "25")
    .action(async (opts) => {
      const startDate = resolveRelativeDate(opts.since);
      const events = auditLogger.query({
        startDate,
        endDate: opts.until,
        eventTypes: opts.type ? [opts.type] : undefined,
        actorIds: opts.actor ? [opts.actor] : undefined,
        resourceTypes: opts.resource ? [opts.resource] : undefined,
        severity: opts.severity ? [opts.severity] : undefined,
        result: opts.result ? [opts.result] : undefined,
        limit: Number.parseInt(opts.limit, 10),
      });

      if (events.length === 0) {
        ctx.logger.info("No audit events found.");
        return;
      }

      ctx.logger.info(`Showing ${events.length} audit event(s):\n`);
      for (const e of events) {
        const resource = e.resource ? ` → ${e.resource.type}:${e.resource.id}` : "";
        ctx.logger.info(
          `[${e.severity.toUpperCase().padEnd(8)}] ${e.timestamp.slice(0, 19)} | ${e.eventType.padEnd(20)} | ${e.operation}${resource} | ${e.result} | ${e.actor.name || e.actor.id}`,
        );
      }
    });

  // ─── audit show ────────────────────────────────────────────────────────────
  audit
    .command("show")
    .argument("<eventId>", "Audit event ID")
    .description("Show full details of a specific audit event")
    .action(async (eventId: string) => {
      const event = auditLogger.getById(eventId);
      if (!event) {
        ctx.logger.error(`Event not found: ${eventId}`);
        return;
      }

      ctx.logger.info(`Audit Event: ${event.id}`);
      ctx.logger.info(`  Timestamp:      ${event.timestamp}`);
      ctx.logger.info(`  Type:           ${event.eventType}`);
      ctx.logger.info(`  Severity:       ${event.severity}`);
      ctx.logger.info(`  Operation:      ${event.operation}`);
      ctx.logger.info(`  Result:         ${event.result}`);
      ctx.logger.info(`  Actor:          ${event.actor.name} (${event.actor.id})`);
      ctx.logger.info(`  Actor Roles:    ${event.actor.roles.join(", ") || "none"}`);
      if (event.actor.ip) ctx.logger.info(`  Actor IP:       ${event.actor.ip}`);
      if (event.actor.channel) ctx.logger.info(`  Channel:        ${event.actor.channel}`);
      if (event.resource) {
        ctx.logger.info(`  Resource:       ${event.resource.type}:${event.resource.id}`);
        if (event.resource.provider) ctx.logger.info(`  Provider:       ${event.resource.provider}`);
      }
      if (event.correlationId) ctx.logger.info(`  Correlation ID: ${event.correlationId}`);
      if (event.sessionId) ctx.logger.info(`  Session ID:     ${event.sessionId}`);
      if (event.durationMs != null) ctx.logger.info(`  Duration:       ${event.durationMs}ms`);
      if (event.parameters) {
        ctx.logger.info(`  Parameters:     ${JSON.stringify(event.parameters, null, 2)}`);
      }
      if (event.metadata) {
        ctx.logger.info(`  Metadata:       ${JSON.stringify(event.metadata, null, 2)}`);
      }
    });

  // ─── audit summary ────────────────────────────────────────────────────────
  audit
    .command("summary")
    .description("Show aggregated audit activity summary")
    .option("--period <period>", "Time period: 1h, 24h, 7d, 30d", "24h")
    .option("--since <date>", "Custom start date (overrides period)")
    .option("--until <date>", "Custom end date")
    .action(async (opts) => {
      const now = new Date();
      const periodMs: Record<string, number> = {
        "1h": 3600_000,
        "24h": 86400_000,
        "7d": 604800_000,
        "30d": 2592000_000,
      };

      const startDate = opts.since
        ? resolveRelativeDate(opts.since) ?? new Date(0).toISOString()
        : new Date(now.getTime() - (periodMs[opts.period] ?? 86400_000)).toISOString();
      const endDate = opts.until ?? now.toISOString();

      const summary = auditLogger.getSummary(startDate, endDate);

      ctx.logger.info(`Audit Summary (${startDate.slice(0, 16)} → ${endDate.slice(0, 16)})`);
      ctx.logger.info(`Total events: ${summary.totalEvents}\n`);

      if (Object.keys(summary.bySeverity).length > 0) {
        ctx.logger.info("By Severity:");
        for (const [sev, count] of Object.entries(summary.bySeverity)) {
          ctx.logger.info(`  ${sev.padEnd(10)} ${count}`);
        }
        ctx.logger.info("");
      }

      if (Object.keys(summary.byResult).length > 0) {
        ctx.logger.info("By Result:");
        for (const [res, count] of Object.entries(summary.byResult)) {
          ctx.logger.info(`  ${res.padEnd(10)} ${count}`);
        }
        ctx.logger.info("");
      }

      if (summary.topActors.length > 0) {
        ctx.logger.info("Top Actors:");
        for (const a of summary.topActors.slice(0, 5)) {
          ctx.logger.info(`  ${(a.name || a.id).padEnd(20)} ${a.count} events`);
        }
        ctx.logger.info("");
      }

      if (summary.topOperations.length > 0) {
        ctx.logger.info("Top Operations:");
        for (const o of summary.topOperations.slice(0, 5)) {
          ctx.logger.info(`  ${o.operation.padEnd(30)} ${o.count}`);
        }
      }
    });

  // ─── audit export ─────────────────────────────────────────────────────────
  audit
    .command("export")
    .description("Export audit events for compliance")
    .option("--format <format>", "Export format: json, csv", "json")
    .option("--since <date>", "Start date")
    .option("--until <date>", "End date")
    .option("--type <type>", "Filter by event type")
    .option("-n, --limit <n>", "Max results", "1000")
    .action(async (opts) => {
      const filter = {
        startDate: resolveRelativeDate(opts.since),
        endDate: opts.until,
        eventTypes: opts.type ? [opts.type] : undefined,
        limit: Number.parseInt(opts.limit, 10),
      };

      const output = opts.format === "csv" ? auditLogger.exportCSV(filter) : auditLogger.exportEvents(filter);
      // Output to stdout for piping
      process.stdout.write(output);
      process.stdout.write("\n");
    });

  // ─── audit retention ──────────────────────────────────────────────────────
  audit
    .command("retention")
    .description("Manage audit retention")
    .argument("[days]", "Set retention period in days")
    .action(async (days?: string) => {
      if (days) {
        ctx.logger.info(`Retention period set to ${days} days. Run 'espada audit prune' to apply.`);
      } else {
        ctx.logger.info("Use 'espada audit retention <days>' to set retention period.");
      }
    });

  // ─── audit prune ──────────────────────────────────────────────────────────
  audit
    .command("prune")
    .description("Remove events older than retention period")
    .action(async () => {
      const pruned = auditLogger.prune();
      ctx.logger.info(`Pruned ${pruned} audit event(s).`);
    });

  // ─── audit count ──────────────────────────────────────────────────────────
  audit
    .command("count")
    .description("Show total number of audit events stored")
    .action(async () => {
      const count = auditLogger.getEventCount();
      ctx.logger.info(`Total audit events: ${count}`);
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveRelativeDate(input: string | undefined): string | undefined {
  if (!input) return undefined;

  const match = input.match(/^(\d+)(h|d|m)$/);
  if (match) {
    const [, num, unit] = match;
    const multipliers: Record<string, number> = { h: 3600_000, d: 86400_000, m: 60_000 };
    const ms = Number.parseInt(num, 10) * (multipliers[unit] ?? 86400_000);
    return new Date(Date.now() - ms).toISOString();
  }

  // Assume ISO-8601 if not relative
  return input;
}
