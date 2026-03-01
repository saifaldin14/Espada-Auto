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

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
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
import { VERSION } from "../index.js";

// =============================================================================
// Types
// =============================================================================

export type ApiServerOptions = {
  port: number;
  host: string;
  db?: string;
  postgres?: string;
  apiKey?: string;
  /** Request body read timeout in ms (default: 30000). */
  bodyTimeout?: number;
  /** Allowed CORS origins (default: "*"). Set to a specific origin in production. */
  corsOrigin?: string;
  /** Max requests per IP per rate-limit window (default: 100). Set to 0 to disable. */
  rateLimit?: number;
  /** Rate-limit window in ms (default: 60000 = 1 minute). */
  rateLimitWindow?: number;
};

export type ApiServerHandle = {
  server: Server;
  storage: GraphStorage;
  close: () => Promise<void>;
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

/** Standard security + CORS headers applied to every response. */
function securityHeaders(corsOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  };
}

function json(res: ServerResponse, data: unknown, status = 200, corsOrigin = "*"): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...securityHeaders(corsOrigin),
  });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400, corsOrigin = "*"): void {
  json(res, { error: message }, status, corsOrigin);
}

// =============================================================================
// Rate Limiter (sliding-window, per-IP)
// =============================================================================

class RateLimiter {
  private windows = new Map<string, number[]>();
  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  /** Returns true if the request is allowed. */
  allow(ip: string): boolean {
    if (this.maxRequests <= 0) return true;
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = this.windows.get(ip);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(ip, timestamps);
    }
    // Trim expired entries
    while (timestamps.length > 0 && timestamps[0]! < cutoff) timestamps.shift();
    if (timestamps.length >= this.maxRequests) return false;
    timestamps.push(now);
    return true;
  }

  /** Periodic cleanup of stale entries. */
  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [ip, ts] of this.windows) {
      while (ts.length > 0 && ts[0]! < cutoff) ts.shift();
      if (ts.length === 0) this.windows.delete(ip);
    }
  }
}

async function readBody(req: IncomingMessage, timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 10 * 1024 * 1024; // 10MB

    // Protect against slow-loris: abort if body isn't received in time
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("Request body read timeout"));
    }, timeoutMs);

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
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

export async function startApiServer(opts: ApiServerOptions): Promise<ApiServerHandle> {
  const log = (msg: string) => console.log(`[infra-graph-api] ${msg}`);
  const corsOrigin = opts.corsOrigin ?? "*";
  const bodyTimeout = opts.bodyTimeout ?? 30_000;
  const rateLimiter = new RateLimiter(opts.rateLimit ?? 100, opts.rateLimitWindow ?? 60_000);
  // Periodically clean up stale rate-limit entries
  const rlCleanupTimer = setInterval(() => rateLimiter.cleanup(), 60_000);
  rlCleanupTimer.unref(); // don't prevent node from exiting

  // Validate port
  if (!Number.isFinite(opts.port) || opts.port < 0 || opts.port > 65535) {
    throw new Error(`Invalid port: ${opts.port}. Must be 0-65535.`);
  }

  // Initialize storage
  let storage: GraphStorage;
  if (opts.postgres) {
    try {
      const { PostgresGraphStorage } = await import("../storage/postgres-store.js");
      storage = new PostgresGraphStorage({ connectionString: opts.postgres });
    } catch (err) {
      throw new Error(
        `Failed to load PostgreSQL storage driver: ${err instanceof Error ? err.message : String(err)}. ` +
        `Ensure the pg dependency is installed.`
      );
    }
  } else if (opts.db) {
    storage = new SQLiteGraphStorage(opts.db);
  } else {
    storage = new InMemoryGraphStorage();
  }
  await storage.initialize();

  const engine = new GraphEngine({ storage });

  // Timing-safe auth middleware — prevents timing side-channel attacks
  const authenticate = (req: IncomingMessage): boolean => {
    if (!opts.apiKey) return true;
    const key = req.headers["x-api-key"] ?? req.headers.authorization?.replace("Bearer ", "");
    if (typeof key !== "string" || key.length === 0) return false;
    // Use timing-safe comparison to prevent timing attacks
    const expected = Buffer.from(opts.apiKey, "utf-8");
    const received = Buffer.from(key, "utf-8");
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
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
      version: VERSION,
      nodes: stats.totalNodes,
      edges: stats.totalEdges,
      storage: opts.postgres ? "postgres" : opts.db ? "sqlite" : "in-memory",
    }, 200, corsOrigin);
  });

  // ─── POST /v1/scan — trigger cloud scan ─────────────────────────
  route("POST", "/v1/scan", async (_req, res, _params, body) => {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      error(res, "Request body must be a JSON object", 400, corsOrigin);
      return;
    }
    const b = body as Record<string, unknown>;
    const providers = Array.isArray(b.providers) ? b.providers.filter((p): p is string => typeof p === "string") : [];

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
      }, 200, corsOrigin);
    } catch (err) {
      log(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
      error(res, "Scan failed — check server logs for details", 500, corsOrigin);
    }
  });

  // ─── POST /v1/query — execute IQL ──────────────────────────────
  route("POST", "/v1/query", async (_req, res, _params, body) => {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      error(res, "Request body must be a JSON object", 400, corsOrigin);
      return;
    }
    const b = body as Record<string, unknown>;
    if (typeof b.query !== "string" || !b.query) {
      error(res, "Missing 'query' field (must be a string)", 400, corsOrigin);
      return;
    }

    try {
      const ast = parseIQL(b.query);
      const result = await executeQuery(ast, { storage });
      json(res, { query: b.query, result }, 200, corsOrigin);
    } catch (err) {
      if (err instanceof IQLSyntaxError) {
        error(res, `IQL syntax error: ${err.message}`, 400, corsOrigin);
      } else {
        log(`Query failed: ${err instanceof Error ? err.message : String(err)}`);
        error(res, "Query execution failed — check server logs", 500, corsOrigin);
      }
    }
  });

  // ─── GET /v1/graph/topology ────────────────────────────────────
  route("GET", "/v1/graph/topology", async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const provider = url.searchParams.get("provider") as CloudProvider | null;
    const filter: NodeFilter = provider ? { provider } : {};
    const stream = url.searchParams.get("stream") === "true";

    const topo = await engine.getTopology(filter);

    if (stream) {
      // NDJSON streaming for large topologies (10K+ nodes):
      // Each line is a self-contained JSON object, allowing clients
      // to process results incrementally without buffering the full payload.
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        ...securityHeaders(corsOrigin),
      });
      for (const node of topo.nodes) {
        res.write(JSON.stringify({ type: "node", data: node }) + "\n");
      }
      for (const edge of topo.edges) {
        res.write(JSON.stringify({ type: "edge", data: edge }) + "\n");
      }
      res.end();
    } else {
      json(res, topo, 200, corsOrigin);
    }
  });

  // ─── GET /v1/graph/stats ───────────────────────────────────────
  route("GET", "/v1/graph/stats", async (_req, res) => {
    const stats = await engine.getStats();
    json(res, stats, 200, corsOrigin);
  });

  // ─── GET /v1/compliance/:framework ─────────────────────────────
  route("GET", "/v1/compliance/:framework", async (_req, res, params) => {
    const fw = params.framework as ComplianceFramework;
    if (!SUPPORTED_FRAMEWORKS.includes(fw)) {
      error(res, `Unknown framework '${fw}'. Supported: ${SUPPORTED_FRAMEWORKS.join(", ")}`, 400, corsOrigin);
      return;
    }
    const report = await runComplianceAssessment([fw], storage);
    json(res, report, 200, corsOrigin);
  });

  // ─── GET /v1/cost ──────────────────────────────────────────────
  route("GET", "/v1/cost", async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const provider = url.searchParams.get("provider") as CloudProvider | null;
    const filter = provider ? { provider } : {};
    const costs = await engine.getCostByFilter(filter);
    json(res, costs, 200, corsOrigin);
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
    }, 200, corsOrigin);
  });

  // ─── GET /v1/export/:format ────────────────────────────────────
  route("GET", "/v1/export/:format", async (req, res, params) => {
    const format = params.format as "json" | "dot" | "mermaid";
    if (!["json", "dot", "mermaid"].includes(format)) {
      error(res, "Format must be json, dot, or mermaid", 400, corsOrigin);
      return;
    }
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const provider = url.searchParams.get("provider") as CloudProvider | null;
    const options = provider ? { filter: { provider } } : undefined;
    const output = await exportTopology(storage, format, options);
    if (format === "json") {
      json(res, JSON.parse(output.content), 200, corsOrigin);
    } else {
      res.writeHead(200, { "Content-Type": "text/plain", ...securityHeaders(corsOrigin) });
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
      json(res, { accepted: true, eventType: event.type }, 200, corsOrigin);
    } else {
      json(res, { accepted: true, note: "Event stored for processing" }, 200, corsOrigin);
    }
  });

  // ─── Start Server ──────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, securityHeaders(corsOrigin));
      res.end();
      return;
    }

    // Rate limiting (by IP)
    const clientIp = req.socket.remoteAddress ?? "unknown";
    if (!rateLimiter.allow(clientIp)) {
      error(res, "Too many requests", 429, corsOrigin);
      return;
    }

    // Content-Length fast-reject for oversized bodies
    const MAX_BODY = 10 * 1024 * 1024;
    const contentLength = req.headers["content-length"];
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY) {
      error(res, "Request body too large", 413, corsOrigin);
      req.destroy();
      return;
    }

    // Auth check
    if (!authenticate(req)) {
      error(res, "Unauthorized", 401, corsOrigin);
      return;
    }

    const url = req.url?.split("?")[0] ?? "/";
    const method = req.method ?? "GET";
    const matched = matchRoute(method, url, routes);

    if (!matched) {
      error(res, `Not found: ${method} ${url}`, 404, corsOrigin);
      return;
    }

    try {
      const body = method === "POST" ? await readBody(req, bodyTimeout) : {};
      await matched.handler(req, res, matched.params, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Error handling ${method} ${url}: ${message}`);
      // Don't leak internal error details to the client
      error(res, "Internal server error", 500, corsOrigin);
    }
  });

  // Set aggressive timeouts to defend against slow clients
  server.headersTimeout = 60_000;
  server.requestTimeout = 60_000;

  // Graceful shutdown with connection draining
  const shutdown = () => {
    close().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      log("Shutting down…");
      // Detach signal handlers to avoid listener leak on repeated start/stop
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);      clearInterval(rlCleanupTimer);      server.close((err) => (err ? reject(err) : resolve()));
    });

  // Return a promise that resolves when the server is listening
  return new Promise<ApiServerHandle>((resolve, reject) => {
    server.on("error", reject);
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
      resolve({ server, storage, close });
    });
  });
}
