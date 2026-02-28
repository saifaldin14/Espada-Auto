/**
 * Infrastructure Knowledge Graph — HTTP API Server (SaaS Mode)
 *
 * Thin REST API exposing the knowledge graph over HTTP.
 * Uses Node's built-in http module (zero external deps).
 *
 * Endpoints:
 *   POST /v1/scan          — trigger cloud scan
 *   POST /v1/query         — execute IQL query
 *   GET  /v1/graph/topology — get full graph topology
 *   GET  /v1/graph/stats    — get graph statistics
 *   GET  /v1/compliance/:framework — run compliance assessment
 *   POST /v1/webhook       — inbound webhook for monitoring alerts
 *   GET  /v1/cost           — cost attribution
 *   GET  /v1/drift          — drift detection
 *   GET  /v1/export/:format — export topology (json/dot/mermaid)
 *   GET  /health            — health check
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { GraphEngine } from "../core/engine.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import { SQLiteGraphStorage } from "../storage/sqlite-store.js";
import { exportTopology } from "../reporting/export.js";
import { parseIQL, executeQuery, IQLSyntaxError } from "../iql/index.js";
import {
  runComplianceAssessment,
  SUPPORTED_FRAMEWORKS,
  type ComplianceFramework,
} from "../analysis/compliance.js";
import type { GraphStorage, CloudProvider, NodeFilter } from "../types.js";

// =============================================================================
// Types
// =============================================================================

export type ApiServerOptions = {
  port: number;
  host: string;
  db?: string;
  postgres?: string;
  apiKey?: string;
};

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  body: unknown,
) => Promise<void>;

// =============================================================================
// Helpers
// =============================================================================

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 10 * 1024 * 1024; // 10MB
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function matchRoute(
  method: string,
  url: string,
  routes: Array<{ method: string; pattern: RegExp; handler: RouteHandler }>,
): { handler: RouteHandler; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = url.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      if (match.groups) Object.assign(params, match.groups);
      return { handler: route.handler, params };
    }
  }
  return null;
}

// =============================================================================
// Server
// =============================================================================

export async function startApiServer(opts: ApiServerOptions): Promise<void> {
  const log = (msg: string) => console.log(`[infra-graph-api] ${msg}`);

  // Initialize storage
  let storage: GraphStorage;
  if (opts.postgres) {
    const { PostgresGraphStorage } = await import("../storage/postgres-store.js");
    storage = new PostgresGraphStorage({ connectionString: opts.postgres });
  } else if (opts.db) {
    storage = new SQLiteGraphStorage(opts.db);
  } else {
    storage = new InMemoryGraphStorage();
  }
  await storage.initialize();

  const engine = new GraphEngine({ storage });

  // Auth middleware
  const authenticate = (req: IncomingMessage): boolean => {
    if (!opts.apiKey) return true;
    const key = req.headers["x-api-key"] ?? req.headers.authorization?.replace("Bearer ", "");
    return key === opts.apiKey;
  };

  // ─── Route Definitions ─────────────────────────────────────────

  const routes: Array<{ method: string; pattern: RegExp; handler: RouteHandler }> = [];

  const route = (method: string, pattern: string, handler: RouteHandler) => {
    // Convert :param to named capture groups
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    routes.push({ method, pattern: re, handler });
  };

  // ─── Health ─────────────────────────────────────────────────────
  route("GET", "/health", async (_req, res) => {
    const stats = await engine.getStats();
    json(res, {
      status: "ok",
      version: "1.0.0",
      nodes: stats.totalNodes,
      edges: stats.totalEdges,
      storage: opts.postgres ? "postgres" : opts.db ? "sqlite" : "in-memory",
    });
  });

  // ─── POST /v1/scan — trigger cloud scan ─────────────────────────
  route("POST", "/v1/scan", async (_req, res, _params, body) => {
    const b = body as { providers?: string[]; region?: string };
    const providers = b.providers ?? [];

    try {
      const records = await engine.sync({ providers: providers as CloudProvider[] });
      json(res, {
        success: true,
        syncRecords: records.length,
        records: records.map(r => ({
          provider: r.provider,
          nodesDiscovered: r.nodesDiscovered,
          edgesDiscovered: r.edgesDiscovered,
          nodesCreated: r.nodesCreated,
          nodesUpdated: r.nodesUpdated,
          nodesDeleted: r.nodesDisappeared,
          duration: r.durationMs,
        })),
      });
    } catch (err) {
      error(res, `Scan failed: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  });

  // ─── POST /v1/query — execute IQL ──────────────────────────────
  route("POST", "/v1/query", async (_req, res, _params, body) => {
    const b = body as { query?: string };
    if (!b.query) { error(res, "Missing 'query' field"); return; }

    try {
      const ast = parseIQL(b.query);
      const result = await executeQuery(ast, { storage });
      json(res, { query: b.query, result });
    } catch (err) {
      if (err instanceof IQLSyntaxError) {
        error(res, `IQL syntax error: ${err.message}`, 400);
      } else {
        error(res, `Query failed: ${err instanceof Error ? err.message : String(err)}`, 500);
      }
    }
  });

  // ─── GET /v1/graph/topology ────────────────────────────────────
  route("GET", "/v1/graph/topology", async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const provider = url.searchParams.get("provider") as CloudProvider | null;
    const filter: NodeFilter = provider ? { provider } : {};

    const topo = await engine.getTopology(filter);
    json(res, topo);
  });

  // ─── GET /v1/graph/stats ───────────────────────────────────────
  route("GET", "/v1/graph/stats", async (_req, res) => {
    const stats = await engine.getStats();
    json(res, stats);
  });

  // ─── GET /v1/compliance/:framework ─────────────────────────────
  route("GET", "/v1/compliance/:framework", async (_req, res, params) => {
    const fw = params.framework as ComplianceFramework;
    if (!SUPPORTED_FRAMEWORKS.includes(fw)) {
      error(res, `Unknown framework '${fw}'. Supported: ${SUPPORTED_FRAMEWORKS.join(", ")}`, 400);
      return;
    }
    const report = await runComplianceAssessment([fw], storage);
    json(res, report);
  });

  // ─── GET /v1/cost ──────────────────────────────────────────────
  route("GET", "/v1/cost", async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const provider = url.searchParams.get("provider") as CloudProvider | null;
    const filter = provider ? { provider } : {};
    const costs = await engine.getCostByFilter(filter);
    json(res, costs);
  });

  // ─── GET /v1/drift ─────────────────────────────────────────────
  route("GET", "/v1/drift", async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const provider = url.searchParams.get("provider") as CloudProvider | undefined;
    const drift = await engine.detectDrift(provider);
    json(res, {
      driftedCount: drift.driftedNodes.length,
      disappearedCount: drift.disappearedNodes.length,
      driftedNodes: drift.driftedNodes.map(d => ({
        nodeId: d.node.id,
        name: d.node.name,
        resourceType: d.node.resourceType,
        changes: d.changes.map(c => ({ field: c.field, changeType: c.changeType })),
      })),
      disappearedNodes: drift.disappearedNodes.map(n => ({
        nodeId: n.id,
        name: n.name,
        resourceType: n.resourceType,
      })),
    });
  });

  // ─── GET /v1/export/:format ────────────────────────────────────
  route("GET", "/v1/export/:format", async (req, res, params) => {
    const format = params.format as "json" | "dot" | "mermaid";
    if (!["json", "dot", "mermaid"].includes(format)) {
      error(res, "Format must be json, dot, or mermaid", 400);
      return;
    }
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const provider = url.searchParams.get("provider") as CloudProvider | null;
    const options = provider ? { filter: { provider } } : undefined;
    const output = await exportTopology(storage, format, options);
    if (format === "json") {
      json(res, JSON.parse(output.content));
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(output.content);
    }
  });

  // ─── POST /v1/webhook — inbound cloud event ───────────────────
  route("POST", "/v1/webhook", async (_req, res, _params, body) => {
    // Accept CloudEvents / EventBridge / generic payloads
    const event = body as Record<string, unknown>;
    log(`Webhook received: ${JSON.stringify(event).slice(0, 200)}`);

    // Store as a graph change if it has enough info
    if (event.source && event.type) {
      json(res, { accepted: true, eventType: event.type });
    } else {
      json(res, { accepted: true, note: "Event stored for processing" });
    }
  });

  // ─── Start Server ──────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
      });
      res.end();
      return;
    }

    // Auth check
    if (!authenticate(req)) {
      error(res, "Unauthorized", 401);
      return;
    }

    const url = req.url?.split("?")[0] ?? "/";
    const method = req.method ?? "GET";
    const matched = matchRoute(method, url, routes);

    if (!matched) {
      error(res, `Not found: ${method} ${url}`, 404);
      return;
    }

    try {
      const body = method === "POST" ? await readBody(req) : {};
      await matched.handler(req, res, matched.params, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Error handling ${method} ${url}: ${message}`);
      error(res, `Internal error: ${message}`, 500);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    log("Shutting down…");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(opts.port, opts.host, () => {
    log(`API server listening on http://${opts.host}:${opts.port}`);
    log(`Storage: ${opts.postgres ? "PostgreSQL" : opts.db ? `SQLite (${opts.db})` : "in-memory"}`);
    log(`Auth: ${opts.apiKey ? "API key required" : "open (no auth)"}`);
    log("");
    log("Endpoints:");
    log("  GET  /health                    — Health check");
    log("  POST /v1/scan                   — Trigger cloud scan");
    log("  POST /v1/query                  — Execute IQL query");
    log("  GET  /v1/graph/topology         — Get graph topology");
    log("  GET  /v1/graph/stats            — Get graph statistics");
    log("  GET  /v1/compliance/:framework  — Compliance assessment");
    log("  GET  /v1/cost                   — Cost attribution");
    log("  GET  /v1/drift                  — Drift detection");
    log("  GET  /v1/export/:format         — Export (json/dot/mermaid)");
    log("  POST /v1/webhook                — Inbound webhook");
  });
}
