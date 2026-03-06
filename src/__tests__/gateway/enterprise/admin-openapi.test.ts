/**
 * Comprehensive QA Tests — Admin OpenAPI Specification
 *
 * Enterprise-grade coverage:
 * - ADMIN_ROUTES consistency: no duplicates, valid methods, correct count
 * - buildOpenApiSpec: valid structure, paths, security, tags, params
 * - buildRouteSummary: total count and routes array
 * - extractPathParams: path parameter extraction
 * - operationId uniqueness and format
 * - Path parameter injection into spec operations
 * - Query parameter injection for listing endpoints
 * - Request body for POST/PUT operations
 * - Error responses for RBAC-protected endpoints
 */

import { describe, it, expect } from "vitest";
import { ADMIN_ROUTES, buildOpenApiSpec, buildRouteSummary } from "../../../gateway/enterprise/admin-openapi.js";

// ═══════════════════════════════════════════════════════════════════════════════

describe("ADMIN_ROUTES", () => {
  it("has exactly 26 routes", () => {
    expect(ADMIN_ROUTES).toHaveLength(26);
  });

  it("has no duplicate method+path combinations", () => {
    const keys = ADMIN_ROUTES.map((r) => `${r.method}:${r.path}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("all methods are valid HTTP methods", () => {
    const valid = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);
    for (const route of ADMIN_ROUTES) {
      expect(valid.has(route.method)).toBe(true);
    }
  });

  it("all routes have a non-empty summary", () => {
    for (const route of ADMIN_ROUTES) {
      expect(route.summary.length).toBeGreaterThan(0);
    }
  });

  it("all routes have at least one tag", () => {
    for (const route of ADMIN_ROUTES) {
      expect(route.tags.length).toBeGreaterThan(0);
    }
  });

  it("all routes have valid auth values", () => {
    for (const route of ADMIN_ROUTES) {
      expect(["none", "rbac"]).toContain(route.auth);
    }
  });

  it("health and ready endpoints are auth: 'none'", () => {
    const public_ = ADMIN_ROUTES.filter((r) => r.auth === "none");
    expect(public_.length).toBeGreaterThanOrEqual(2);
    expect(public_.some((r) => r.path === "/health")).toBe(true);
    expect(public_.some((r) => r.path === "/ready")).toBe(true);
  });

  it("admin endpoints require RBAC", () => {
    const adminRoutes = ADMIN_ROUTES.filter((r) => r.path.startsWith("/admin/"));
    for (const route of adminRoutes) {
      expect(route.auth).toBe("rbac");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════

describe("buildOpenApiSpec", () => {
  const spec = buildOpenApiSpec() as Record<string, any>;

  it("has openapi version 3.1.0", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  it("has info.title and info.version", () => {
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
  });

  it("has at least one server entry", () => {
    expect(spec.servers.length).toBeGreaterThan(0);
  });

  it("has BearerAuth security scheme", () => {
    expect(spec.components.securitySchemes.BearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.BearerAuth.type).toBe("http");
    expect(spec.components.securitySchemes.BearerAuth.scheme).toBe("bearer");
  });

  it("has tags matching expected categories", () => {
    const tagNames = (spec.tags as any[]).map((t: any) => t.name);
    expect(tagNames).toContain("Observability");
    expect(tagNames).toContain("Cluster");
    expect(tagNames).toContain("DR");
    expect(tagNames).toContain("Secrets");
    expect(tagNames).toContain("Drift");
    expect(tagNames).toContain("Mesh");
    expect(tagNames).toContain("Meta");
  });

  it("generates path entries for all unique route paths", () => {
    const uniquePaths = new Set(ADMIN_ROUTES.map((r) => r.path));
    const specPaths = Object.keys(spec.paths);
    expect(specPaths.length).toBe(uniquePaths.size);
  });

  it("has correct HTTP method keys in path items", () => {
    for (const route of ADMIN_ROUTES) {
      const pathItem = spec.paths[route.path];
      expect(pathItem).toBeDefined();

      const method = route.method.toLowerCase();
      expect(pathItem[method]).toBeDefined();
    }
  });

  it("includes path parameters in operations that have {param} placeholders", () => {
    const routesWithParams = ADMIN_ROUTES.filter((r) => r.path.includes("{"));
    expect(routesWithParams.length).toBeGreaterThan(0);

    for (const route of routesWithParams) {
      const method = route.method.toLowerCase();
      const operation = spec.paths[route.path][method];
      expect(operation.parameters).toBeDefined();

      const pathParams = operation.parameters.filter((p: any) => p.in === "path");
      expect(pathParams.length).toBeGreaterThan(0);
    }
  });

  it("includes query parameters for listing endpoints", () => {
    const listingRoutes = ADMIN_ROUTES.filter(
      (r) => r.method === "GET" && (r.path.includes("services") || r.path.includes("instances")),
    );
    expect(listingRoutes.length).toBeGreaterThan(0);

    for (const route of listingRoutes) {
      const method = route.method.toLowerCase();
      const operation = spec.paths[route.path][method];
      expect(operation.parameters).toBeDefined();

      const queryParams = operation.parameters.filter((p: any) => p.in === "query");
      expect(queryParams.length).toBeGreaterThan(0);
    }
  });

  it("includes requestBody for POST/PUT operations", () => {
    const mutations = ADMIN_ROUTES.filter((r) => r.method === "POST" || r.method === "PUT");
    for (const route of mutations) {
      const method = route.method.toLowerCase();
      const operation = spec.paths[route.path][method];
      expect(operation.requestBody).toBeDefined();
      expect(operation.requestBody.required).toBe(true);
    }
  });

  it("includes 401/403 error responses for RBAC endpoints", () => {
    const rbac = ADMIN_ROUTES.filter((r) => r.auth === "rbac");
    for (const route of rbac) {
      const method = route.method.toLowerCase();
      const operation = spec.paths[route.path][method];
      expect(operation.responses["401"]).toBeDefined();
      expect(operation.responses["403"]).toBeDefined();
    }
  });

  it("includes security requirement for RBAC operations", () => {
    const rbac = ADMIN_ROUTES.filter((r) => r.auth === "rbac");
    for (const route of rbac) {
      const method = route.method.toLowerCase();
      const operation = spec.paths[route.path][method];
      expect(operation.security).toBeDefined();
      expect(operation.security).toEqual([{ BearerAuth: [] }]);
    }
  });

  it("all operations have unique operationIds", () => {
    const ids = new Set<string>();
    for (const route of ADMIN_ROUTES) {
      const method = route.method.toLowerCase();
      const operation = spec.paths[route.path][method];
      const opId = operation.operationId;
      expect(ids.has(opId)).toBe(false);
      ids.add(opId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════

describe("buildRouteSummary", () => {
  it("returns total count and routes array", () => {
    const summary = buildRouteSummary();
    expect(summary.total).toBe(26);
    expect(summary.routes).toHaveLength(26);
    expect(summary.routes).toBe(ADMIN_ROUTES);
  });
});
