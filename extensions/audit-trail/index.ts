/**
 * Persistent Audit Trail — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { AuditLogger } from "./src/logger.js";
import { SQLiteAuditStorage } from "./src/sqlite-store.js";
import { InMemoryAuditStorage } from "./src/memory-store.js";
import { registerAuditTools } from "./src/tools.js";
import { registerAuditCli } from "./src/cli.js";
import type { AuditConfig, AuditStorage } from "./src/types.js";
import { DEFAULT_AUDIT_CONFIG } from "./src/types.js";

export { AuditLogger } from "./src/logger.js";
export { SQLiteAuditStorage } from "./src/sqlite-store.js";
export { InMemoryAuditStorage } from "./src/memory-store.js";
export type { AuditEvent, AuditEventType, AuditQuery, AuditSummary, AuditStorage } from "./src/types.js";

type AuditTrailPluginConfig = {
  storage?: { type?: "sqlite" | "memory"; path?: string };
  retentionDays?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
};

function createStorage(config: AuditTrailPluginConfig, resolvePath: (p: string) => string): AuditStorage {
  const storageType = config.storage?.type ?? "sqlite";
  if (storageType === "memory") return new InMemoryAuditStorage();
  const dbPath = resolvePath(config.storage?.path ?? "~/.espada/audit.db");
  return new SQLiteAuditStorage(dbPath);
}

export default {
  id: "audit-trail",
  name: "Persistent Audit Trail",
  description: "Enterprise-grade audit logging with persistent SQLite storage, buffered writes, and queryable history",
  version: "1.0.0",

  async register(api: EspadaPluginApi) {
    const config = (api.pluginConfig ?? {}) as AuditTrailPluginConfig;

    const storage = createStorage(config, api.resolvePath);
    await storage.initialize();

    const auditConfig: Partial<AuditConfig> = {
      ...DEFAULT_AUDIT_CONFIG,
      retentionDays: config.retentionDays ?? DEFAULT_AUDIT_CONFIG.retentionDays,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_AUDIT_CONFIG.flushIntervalMs,
      maxBufferSize: config.maxBufferSize ?? DEFAULT_AUDIT_CONFIG.maxBufferSize,
    };

    const logger = new AuditLogger(storage, auditConfig);

    // Register tools and CLI
    registerAuditTools(api, logger);
    api.registerCli((ctx) => registerAuditCli(ctx, logger), { commands: ["audit"] });

    // Register gateway methods
    api.registerGatewayMethod("audit/query", async ({ params, respond }) => {
      const events = logger.query(params as Parameters<typeof logger.query>[0]);
      respond(true, { events, count: events.length });
    });

    api.registerGatewayMethod("audit/timeline", async ({ params, respond }) => {
      const { resourceId, limit } = params as { resourceId: string; limit?: number };
      const timeline = logger.getTimeline(resourceId, limit);
      respond(true, timeline);
    });

    api.registerGatewayMethod("audit/summary", async ({ params, respond }) => {
      const { startDate, endDate } = params as { startDate: string; endDate: string };
      const summary = logger.getSummary(startDate, endDate);
      respond(true, summary);
    });

    api.registerGatewayMethod("audit/export", async ({ params, respond }) => {
      const { format, ...filter } = params as { format?: string } & Parameters<typeof logger.query>[0];
      const output = format === "csv" ? logger.exportCSV(filter) : logger.exportEvents(filter);
      respond(true, { format: format ?? "json", data: output });
    });

    // Register as a service so other extensions can access the logger
    api.registerService({
      id: "audit-trail",
      start() {
        logger.start();
      },
      stop() {
        logger.close();
      },
    });

    // Expose logger instance for other extensions via service registry
    api.logger.info("Audit trail initialized");
  },
};
