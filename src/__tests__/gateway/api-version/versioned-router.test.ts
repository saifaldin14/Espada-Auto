/**
 * Comprehensive QA Tests — VersionedRouter
 *
 * Enterprise-grade test suite covering:
 * - Version lifecycle: add, deprecate, sunset
 * - Route registration: single method, multi-method, path params
 * - Request handling: URL-prefix extraction, Accept-Version header, default fallback
 * - Sunset → 410 Gone
 * - Deprecation headers: Deprecation, Sunset, Link
 * - Version-restricted routes
 * - OpenAPI spec generation
 * - Built-in endpoints (spec, versions)
 * - pathToRegExp: param extraction, regex escaping (LOW #32)
 * - Handler error → 500
 */

import { describe, it, expect, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { VersionedRouter } from "../../../gateway/api-version/versioned-router.js";
import type { ApiVersion, RouteParams } from "../../../gateway/api-version/versioned-router.js";

// ── Mock HTTP ────────────────────────────────────────────────────────────────

function mockReq(method: string, url: string, headers?: Record<string, string>): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      req.headers[k.toLowerCase()] = v;
    }
  }
  return req;
}

function mockRes(): ServerResponse & {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
} {
  const socket = new Socket();
  const res = new ServerResponse(new IncomingMessage(socket)) as ServerResponse & {
    _status: number;
    _headers: Record<string, string>;
    _body: string;
  };
  res._status = 200;
  res._headers = {};
  res._body = "";

  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: string | number | readonly string[]) => {
    res._headers[name.toLowerCase()] = String(value);
    return origSetHeader(name, value);
  };

  const origEnd = res.end.bind(res);
  (res as any).end = (data?: string | Buffer) => {
    if (data) res._body = String(data);
    origEnd(data);
  };

  Object.defineProperty(res, "statusCode", {
    get() {
      return res._status;
    },
    set(v: number) {
      res._status = v;
    },
  });

  return res;
}

function v1Active(): ApiVersion {
  return { version: "v1", major: 1, status: "active", releasedAt: "2024-01-01T00:00:00Z" };
}

function v2Active(): ApiVersion {
  return { version: "v2", major: 2, status: "active", releasedAt: "2024-06-01T00:00:00Z" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VersionedRouter
// ═══════════════════════════════════════════════════════════════════════════════

describe("VersionedRouter", () => {
  // =========================================================================
  // Version lifecycle
  // =========================================================================

  describe("version management", () => {
    it("registers versions", () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.addVersion(v2Active());

      const versions = router.getVersions();
      expect(versions).toHaveLength(2);
      expect(versions.map((v) => v.version)).toEqual(["v1", "v2"]);
    });

    it("deprecates a version with sunset date", () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      router.deprecateVersion("v1", "2025-12-31T00:00:00Z");

      const [v] = router.getVersions();
      expect(v.status).toBe("deprecated");
      expect(v.deprecatedAt).toBeTruthy();
      expect(v.sunsetAt).toBe("2025-12-31T00:00:00Z");
    });

    it("sunsets a version", () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      router.sunsetVersion("v1");

      const [v] = router.getVersions();
      expect(v.status).toBe("sunset");
    });
  });

  // =========================================================================
  // Route registration
  // =========================================================================

  describe("route registration", () => {
    it("registers routes via convenience methods", () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      const handler = vi.fn(() => true);
      router.get("/tools", handler);
      router.post("/tools", handler);
      router.put("/tools/:id", handler);
      router.patch("/tools/:id", handler);
      router.delete("/tools/:id", handler);

      // Verify by making requests
      // (routes array is private, so we test via handleRequest)
    });
  });

  // =========================================================================
  // Request handling
  // =========================================================================

  describe("handleRequest()", () => {
    it("dispatches to handler for URL-prefix versioned route", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      let capturedParams: RouteParams | null = null;
      router.get("/tools", (_req, res, params) => {
        capturedParams = params;
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return true;
      });

      const req = mockReq("GET", "/v1/tools");
      const res = mockRes();
      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      expect(capturedParams).not.toBeNull();
      expect(capturedParams!.version).toBe("v1");
      expect(capturedParams!.path).toBe("/tools");
    });

    it("extracts path parameters", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      let capturedParams: RouteParams | null = null;
      router.get("/tools/:toolId/runs/:runId", (_req, res, params) => {
        capturedParams = params;
        res.statusCode = 200;
        res.end("ok");
        return true;
      });

      const req = mockReq("GET", "/v1/tools/my-tool/runs/run-123");
      const res = mockRes();
      await router.handleRequest(req, res);

      expect(capturedParams!.params.toolId).toBe("my-tool");
      expect(capturedParams!.params.runId).toBe("run-123");
    });

    it("uses Accept-Version header when URL has no version prefix", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      const handler = vi.fn((_req: any, res: any) => {
        res.statusCode = 200;
        res.end("ok");
        return true;
      });
      router.get("/tools", handler);

      const req = mockReq("GET", "/tools", { "Accept-Version": "v1" });
      const res = mockRes();
      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    it("returns false for unmatched routes (pass-through)", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.get(
        "/tools",
        vi.fn(() => true),
      );

      const req = mockReq("GET", "/v1/unknown");
      const res = mockRes();
      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(false);
    });

    it("returns false for non-versioned URLs", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.get(
        "/tools",
        vi.fn(() => true),
      );

      const req = mockReq("GET", "/health");
      const res = mockRes();
      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(false);
    });

    it("sets X-Api-Version header on matched routes", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.get("/tools", (_req, res) => {
        res.statusCode = 200;
        res.end("ok");
        return true;
      });

      const req = mockReq("GET", "/v1/tools");
      const res = mockRes();
      await router.handleRequest(req, res);

      expect(res._headers["x-api-version"]).toBe("v1");
    });
  });

  // =========================================================================
  // Sunset handling
  // =========================================================================

  describe("sunset versions", () => {
    it("returns 410 Gone for sunset versions", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.addVersion(v2Active());
      router.sunsetVersion("v1");

      router.get(
        "/tools",
        vi.fn(() => true),
      );

      const req = mockReq("GET", "/v1/tools");
      const res = mockRes();
      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      expect(res._status).toBe(410);

      const body = JSON.parse(res._body);
      expect(body.error).toBe("Gone");
      expect(body.availableVersions).toContain("v2");
    });
  });

  // =========================================================================
  // Deprecation headers
  // =========================================================================

  describe("deprecation headers", () => {
    it("adds Deprecation, Sunset, and Link headers for deprecated versions", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.addVersion(v2Active());
      router.deprecateVersion("v1", "2025-12-31T00:00:00Z");

      router.get("/tools", (_req, res) => {
        res.statusCode = 200;
        res.end("ok");
        return true;
      });

      const req = mockReq("GET", "/v1/tools");
      const res = mockRes();
      await router.handleRequest(req, res);

      expect(res._headers["deprecation"]).toBeTruthy();
      expect(res._headers["sunset"]).toBe("2025-12-31T00:00:00Z");
      expect(res._headers["link"]).toContain("successor-version");
    });
  });

  // =========================================================================
  // Version-restricted routes
  // =========================================================================

  describe("version-restricted routes", () => {
    it("only matches routes registered for specific versions", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.addVersion(v2Active());

      const handler = vi.fn((_req: any, res: any) => {
        res.statusCode = 200;
        res.end("ok");
        return true;
      });

      router.route({
        method: "GET",
        path: "/new-feature",
        handler,
        versions: ["v2"],
      });

      // v2 should match
      const req2 = mockReq("GET", "/v2/new-feature");
      const res2 = mockRes();
      expect(await router.handleRequest(req2, res2)).toBe(true);

      // v1 should NOT match
      const req1 = mockReq("GET", "/v1/new-feature");
      const res1 = mockRes();
      expect(await router.handleRequest(req1, res1)).toBe(false);
    });
  });

  // =========================================================================
  // Handler errors → 500
  // =========================================================================

  describe("error handling", () => {
    it("returns 500 when handler throws", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.get("/crash", () => {
        throw new Error("boom");
      });

      const req = mockReq("GET", "/v1/crash");
      const res = mockRes();
      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      expect(res._status).toBe(500);
    });
  });

  // =========================================================================
  // OpenAPI spec generation
  // =========================================================================

  describe("generateOpenApiSpec()", () => {
    it("generates valid OpenAPI 3.0 spec", () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.get("/tools", vi.fn(), { description: "List tools", tags: ["tools"] });
      router.post("/tools/:toolId/invoke", vi.fn(), { description: "Invoke tool" });

      const spec = router.generateOpenApiSpec("v1", {
        title: "Test API",
        serverUrl: "http://localhost:8080/v1",
      });

      expect(spec.openapi).toBe("3.0.3");
      expect(spec.info.title).toBe("Test API");
      expect(spec.info.version).toBe("v1");

      // Paths should use {param} notation
      const paths = Object.keys(spec.paths);
      expect(paths).toContain("/v1/tools");
      expect(paths).toContain("/v1/tools/{toolId}/invoke");

      // Tool invoke path should have param definition
      const invokePath = spec.paths["/v1/tools/{toolId}/invoke"] as Record<string, any>;
      expect(invokePath.post.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "toolId", in: "path", required: true }),
        ]),
      );
    });

    it("filters routes by version", () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.addVersion(v2Active());

      router.route({ method: "GET", path: "/old", handler: vi.fn(), versions: ["v1"] });
      router.route({ method: "GET", path: "/new", handler: vi.fn(), versions: ["v2"] });

      const v1Spec = router.generateOpenApiSpec("v1");
      expect(Object.keys(v1Spec.paths)).toContain("/v1/old");
      expect(Object.keys(v1Spec.paths)).not.toContain("/v1/new");

      const v2Spec = router.generateOpenApiSpec("v2");
      expect(Object.keys(v2Spec.paths)).toContain("/v2/new");
      expect(Object.keys(v2Spec.paths)).not.toContain("/v2/old");
    });
  });

  // =========================================================================
  // Built-in endpoints
  // =========================================================================

  describe("built-in endpoints", () => {
    it("registerVersionsEndpoint() serves version list", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.addVersion(v2Active());
      router.registerVersionsEndpoint();

      const req = mockReq("GET", "/v1/versions");
      const res = mockRes();
      await router.handleRequest(req, res);

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.versions).toHaveLength(2);
      expect(body.default).toBe("v1");
    });

    it("registerSpecEndpoint() serves OpenAPI JSON", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());
      router.registerSpecEndpoint({ title: "My API" });

      const req = mockReq("GET", "/v1/openapi.json");
      const res = mockRes();
      await router.handleRequest(req, res);

      expect(res._status).toBe(200);
      const spec = JSON.parse(res._body);
      expect(spec.openapi).toBe("3.0.3");
      expect(spec.info.title).toBe("My API");
    });
  });

  // =========================================================================
  // pathToRegExp edge cases (production hardening LOW #32)
  // =========================================================================

  describe("path matching edge cases", () => {
    it("handles paths with dots (regex metachar escaping)", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      const handler = vi.fn((_req: any, res: any) => {
        res.statusCode = 200;
        res.end("ok");
        return true;
      });
      router.get("/openapi.json", handler);

      const req = mockReq("GET", "/v1/openapi.json");
      const res = mockRes();
      expect(await router.handleRequest(req, res)).toBe(true);
    });

    it("handles multiple path parameters", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      let params: Record<string, string> = {};
      router.get("/orgs/:orgId/teams/:teamId/members/:memberId", (_req, res, rp) => {
        params = rp.params;
        res.statusCode = 200;
        res.end("ok");
        return true;
      });

      const req = mockReq("GET", "/v1/orgs/acme/teams/platform/members/user-1");
      const res = mockRes();
      await router.handleRequest(req, res);

      expect(params.orgId).toBe("acme");
      expect(params.teamId).toBe("platform");
      expect(params.memberId).toBe("user-1");
    });

    it("multi-method route matches all specified methods", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      const handler = vi.fn((_req: any, res: any) => {
        res.statusCode = 200;
        res.end("ok");
        return true;
      });

      router.route({ method: ["GET", "POST"], path: "/data", handler });

      const reqGet = mockReq("GET", "/v1/data");
      expect(await router.handleRequest(reqGet, mockRes())).toBe(true);

      const reqPost = mockReq("POST", "/v1/data");
      expect(await router.handleRequest(reqPost, mockRes())).toBe(true);

      // PUT should not match
      const reqPut = mockReq("PUT", "/v1/data");
      expect(await router.handleRequest(reqPut, mockRes())).toBe(false);
    });

    it("provides query params via RouteParams", async () => {
      const router = new VersionedRouter();
      router.addVersion(v1Active());

      let capturedQuery: URLSearchParams | null = null;
      router.get("/search", (_req, res, params) => {
        capturedQuery = params.query;
        res.statusCode = 200;
        res.end("ok");
        return true;
      });

      const req = mockReq("GET", "/v1/search?q=hello&limit=10");
      const res = mockRes();
      await router.handleRequest(req, res);

      expect(capturedQuery!.get("q")).toBe("hello");
      expect(capturedQuery!.get("limit")).toBe("10");
    });
  });

  // =========================================================================
  // Default version fallback
  // =========================================================================

  describe("default version fallback", () => {
    it("uses default version when path matches registered route without version prefix", async () => {
      const router = new VersionedRouter({ defaultVersion: "v1" });
      router.addVersion(v1Active());

      const handler = vi.fn((_req: any, res: any) => {
        res.statusCode = 200;
        res.end("ok");
        return true;
      });
      router.get("/tools", handler);

      // Path without version prefix but matching a registered route
      const req = mockReq("GET", "/tools");
      const res = mockRes();
      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      expect(handler).toHaveBeenCalled();
    });
  });
});
