/**
 * Tests for the HTTP API server (src/api/server.ts).
 */

import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { startApiServer, type ApiServerHandle } from "./server.js";

// =============================================================================
// Helpers
// =============================================================================

let handle: ApiServerHandle | null = null;

async function startTestServer(
  overrides: { apiKey?: string; port?: number; corsOrigin?: string; rateLimit?: number; rateLimitWindow?: number } = {},
): Promise<ApiServerHandle> {
  handle = await startApiServer({
    port: overrides.port ?? 0, // random free port
    host: "127.0.0.1",
    apiKey: overrides.apiKey,
    corsOrigin: overrides.corsOrigin,
    rateLimit: overrides.rateLimit,
    rateLimitWindow: overrides.rateLimitWindow,
  });
  return handle;
}

function getBaseUrl(h: ApiServerHandle): string {
  const addr = h.server.address();
  if (typeof addr === "string" || !addr) throw new Error("No server address");
  return `http://127.0.0.1:${addr.port}`;
}

async function req(
  baseUrl: string,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  const method = opts.method ?? "GET";
  const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body: bodyStr,
  });

  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return {
    status: res.status,
    body: parsed,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
});

// =============================================================================
// Tests
// =============================================================================

describe("API Server", () => {
  // ─── Startup & Health ─────────────────────────────────────────────

  describe("startup and health", () => {
    it("starts on a random port and returns a server handle", async () => {
      const h = await startTestServer();
      expect(h.server).toBeDefined();
      expect(h.storage).toBeDefined();
      expect(typeof h.close).toBe("function");

      const addr = h.server.address();
      expect(addr).toBeTruthy();
      expect(typeof addr).toBe("object");
    });

    it("GET /health returns status ok", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/health");

      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.version).toBe("1.0.0");
      expect(body.storage).toBe("in-memory");
      expect(typeof body.nodes).toBe("number");
      expect(typeof body.edges).toBe("number");
    });
  });

  // ─── CORS ──────────────────────────────────────────────────────────

  describe("CORS", () => {
    it("responds to OPTIONS with 204 and CORS headers", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const res = await fetch(`${base}/v1/graph/stats`, { method: "OPTIONS" });

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    });

    it("uses custom corsOrigin", async () => {
      const h = await startTestServer({ corsOrigin: "https://example.com" });
      const base = getBaseUrl(h);
      const res = await fetch(`${base}/health`);

      expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
    });
  });

  // ─── Authentication ────────────────────────────────────────────────

  describe("authentication", () => {
    it("rejects requests without API key when key is configured", async () => {
      const h = await startTestServer({ apiKey: "test-secret-key" });
      const base = getBaseUrl(h);
      const r = await req(base, "/health");

      expect(r.status).toBe(401);
    });

    it("accepts requests with correct API key via X-API-Key header", async () => {
      const h = await startTestServer({ apiKey: "test-secret-key" });
      const base = getBaseUrl(h);
      const r = await req(base, "/health", {
        headers: { "X-API-Key": "test-secret-key" },
      });

      expect(r.status).toBe(200);
    });

    it("accepts requests with correct API key via Authorization Bearer", async () => {
      const h = await startTestServer({ apiKey: "test-secret-key" });
      const base = getBaseUrl(h);
      const r = await req(base, "/health", {
        headers: { Authorization: "Bearer test-secret-key" },
      });

      expect(r.status).toBe(200);
    });

    it("rejects requests with wrong API key", async () => {
      const h = await startTestServer({ apiKey: "correct-key" });
      const base = getBaseUrl(h);
      const r = await req(base, "/health", {
        headers: { "X-API-Key": "wrong-key" },
      });

      expect(r.status).toBe(401);
    });

    it("allows all requests when no API key is configured", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/health");
      expect(r.status).toBe(200);
    });
  });

  // ─── 404 Handling ──────────────────────────────────────────────────

  describe("routing", () => {
    it("returns 404 for unknown routes", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/nonexistent");

      expect(r.status).toBe(404);
      expect((r.body as Record<string, unknown>).error).toContain("Not found");
    });
  });

  // ─── Graph Stats ───────────────────────────────────────────────────

  describe("GET /v1/graph/stats", () => {
    it("returns graph statistics", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/graph/stats");

      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(typeof body.totalNodes).toBe("number");
      expect(typeof body.totalEdges).toBe("number");
    });
  });

  // ─── Graph Topology ────────────────────────────────────────────────

  describe("GET /v1/graph/topology", () => {
    it("returns topology", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/graph/topology");

      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body).toBeTruthy();
    });

    it("streams NDJSON when ?stream=true", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const res = await fetch(`${base}/v1/graph/topology?stream=true`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/x-ndjson");
      const text = await res.text();
      // Empty graph produces empty body; each line (if any) must be valid JSON
      if (text.trim()) {
        for (const line of text.trim().split("\n")) {
          const parsed = JSON.parse(line);
          expect(["node", "edge"]).toContain(parsed.type);
          expect(parsed.data).toBeDefined();
        }
      }
    });
  });

  // ─── Query (IQL) ──────────────────────────────────────────────────

  describe("POST /v1/query", () => {
    it("requires query field", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/query", {
        method: "POST",
        body: {},
      });

      expect(r.status).toBe(400);
      expect((r.body as Record<string, unknown>).error).toContain("query");
    });

    it("rejects non-object bodies", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);

      const res = await fetch(`${base}/v1/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("just a string"),
      });

      expect(res.status).toBe(400);
    });

    it("executes a valid IQL query", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/query", {
        method: "POST",
        body: { query: "FIND resources" },
      });

      // Should succeed even on empty graph
      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.query).toBe("FIND resources");
    });
  });

  // ─── Compliance ────────────────────────────────────────────────────

  describe("GET /v1/compliance/:framework", () => {
    it("runs compliance assessment for a valid framework", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/compliance/cis");

      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.frameworks).toBeDefined();
    });

    it("returns 400 for unknown framework", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/compliance/unknown-fw");

      expect(r.status).toBe(400);
      expect((r.body as Record<string, unknown>).error).toContain("Unknown framework");
    });
  });

  // ─── Export ────────────────────────────────────────────────────────

  describe("GET /v1/export/:format", () => {
    it("exports as JSON", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/export/json");

      expect(r.status).toBe(200);
    });

    it("exports as DOT (plain text)", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const res = await fetch(`${base}/v1/export/dot`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
    });

    it("rejects invalid format", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/export/xml");

      expect(r.status).toBe(400);
      expect((r.body as Record<string, unknown>).error).toContain("Format must be");
    });
  });

  // ─── Scan ──────────────────────────────────────────────────────────

  describe("POST /v1/scan", () => {
    it("rejects non-object body", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const res = await fetch(`${base}/v1/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([1, 2, 3]),
      });

      expect(res.status).toBe(400);
    });

    it("accepts a valid scan request (empty graph)", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/scan", {
        method: "POST",
        body: { providers: [] },
      });

      // Returns 200 with empty sync records
      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.success).toBe(true);
    });
  });

  // ─── Webhook ───────────────────────────────────────────────────────

  describe("POST /v1/webhook", () => {
    it("accepts CloudEvents-style payload", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/webhook", {
        method: "POST",
        body: { source: "aws.ec2", type: "instance.changed", data: {} },
      });

      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.accepted).toBe(true);
      expect(body.eventType).toBe("instance.changed");
    });

    it("accepts generic payload", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/webhook", {
        method: "POST",
        body: { foo: "bar" },
      });

      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.accepted).toBe(true);
    });
  });

  // ─── Error containment ─────────────────────────────────────────────

  describe("error handling", () => {
    it("does not leak internal error details", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      // Send invalid JSON to trigger error
      const res = await fetch(`${base}/v1/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json at all",
      });

      // Should get an error but not leak stack traces
      expect(res.status).toBeGreaterThanOrEqual(400);
      const text = await res.text();
      expect(text).not.toContain("node_modules");
      expect(text).not.toContain("at Object");
    });
  });

  // ─── Graceful shutdown ─────────────────────────────────────────────

  describe("shutdown", () => {
    it("close() stops the server and resolves", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);

      // Verify it's running
      const r1 = await req(base, "/health");
      expect(r1.status).toBe(200);

      // Close
      await h.close();
      handle = null; // prevent double-close in afterEach

      // Verify it's stopped (should throw)
      await expect(
        fetch(`${base}/health`).then(r => r.json()),
      ).rejects.toThrow();
    });
  });

  // ─── Port validation ──────────────────────────────────────────────

  describe("port validation", () => {
    it("rejects invalid port", async () => {
      await expect(
        startApiServer({ port: 99999, host: "127.0.0.1" }),
      ).rejects.toThrow(/Invalid port/);
    });

    it("rejects NaN port", async () => {
      await expect(
        startApiServer({ port: NaN, host: "127.0.0.1" }),
      ).rejects.toThrow(/Invalid port/);
    });
  });

  // ─── Security headers ─────────────────────────────────────────────

  describe("security headers", () => {
    it("includes X-Content-Type-Options, X-Frame-Options, Cache-Control", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/health");

      expect(r.status).toBe(200);
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["x-frame-options"]).toBe("DENY");
      expect(r.headers["cache-control"]).toBe("no-store");
    });

    it("includes security headers on error responses", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/nonexistent");

      expect(r.status).toBe(404);
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("includes security headers on text/plain export responses", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const res = await fetch(`${base}/v1/export/dot`);

      expect(res.status).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    });
  });

  // ─── Rate limiting ────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("returns 429 after exceeding the limit", async () => {
      const h = await startTestServer({ rateLimit: 3, rateLimitWindow: 60_000 });
      const base = getBaseUrl(h);

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const r = await req(base, "/health");
        expect(r.status).toBe(200);
      }

      // 4th request should be rate-limited
      const r = await req(base, "/health");
      expect(r.status).toBe(429);
      const body = r.body as Record<string, unknown>;
      expect(body.error).toContain("Too many requests");
    });

    it("allows unlimited requests when rateLimit=0", async () => {
      const h = await startTestServer({ rateLimit: 0 });
      const base = getBaseUrl(h);

      for (let i = 0; i < 10; i++) {
        const r = await req(base, "/health");
        expect(r.status).toBe(200);
      }
    });
  });

  // ─── Cost endpoint ────────────────────────────────────────────────

  describe("GET /v1/cost", () => {
    it("returns cost data on empty graph", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/cost");

      expect(r.status).toBe(200);
    });
  });

  // ─── Drift endpoint ───────────────────────────────────────────────

  describe("GET /v1/drift", () => {
    it("returns drift data on empty graph", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const r = await req(base, "/v1/drift");

      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.driftedCount).toBe(0);
      expect(body.disappearedCount).toBe(0);
    });
  });

  // ─── Mermaid export ───────────────────────────────────────────────

  describe("GET /v1/export/mermaid", () => {
    it("returns mermaid format topology", async () => {
      const h = await startTestServer();
      const base = getBaseUrl(h);
      const res = await fetch(`${base}/v1/export/mermaid`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      // Mermaid output should be a string (may be empty for empty graph)
      expect(typeof text).toBe("string");
    });
  });

  // ─── Content-Length fast-reject ────────────────────────────────────

  describe("body size fast-reject", () => {
    it("rejects requests with Content-Length > 10MB via raw HTTP", async () => {
      const h = await startTestServer();
      const addr = h.server.address();
      if (typeof addr === "string" || !addr) throw new Error("No address");

      // Use raw http to send a mismatched Content-Length without client-side validation
      const result = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: "/v1/scan", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": String(11 * 1024 * 1024) } },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.on("error", reject);
        req.end("{}");
      });

      expect(result).toBe(413);
    });
  });
});
