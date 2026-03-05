/**
 * Admin OpenAPI 3.1 Specification
 *
 * Programmatic description of all /admin/* and /health|/ready endpoints
 * exposed by the enterprise admin handler.
 *
 * GET /admin/openapi.json  → returns the spec
 * GET /admin/routes        → returns a summary of all registered routes
 *
 */

// ── Route descriptor ─────────────────────────────────────────────────────────

export interface AdminRoute {
  method: string;
  path: string;
  summary: string;
  tags: string[];
  auth: "none" | "rbac";
}

/** All enterprise admin routes, kept in sync with server-enterprise-admin.ts */
export const ADMIN_ROUTES: AdminRoute[] = [
  // ── Health / Ready ──
  {
    method: "GET",
    path: "/health",
    summary: "Health check (cluster-aware if available)",
    tags: ["Observability"],
    auth: "none",
  },
  {
    method: "GET",
    path: "/ready",
    summary: "Readiness check (persistent state aware)",
    tags: ["Observability"],
    auth: "none",
  },

  // ── Cluster ──
  {
    method: "GET",
    path: "/admin/cluster/instances",
    summary: "List cluster instances",
    tags: ["Cluster"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/cluster/leader",
    summary: "Get current cluster leader",
    tags: ["Cluster"],
    auth: "rbac",
  },

  // ── Disaster Recovery ──
  {
    method: "POST",
    path: "/admin/backup",
    summary: "Create a DR backup",
    tags: ["DR"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/backups",
    summary: "List all DR backups",
    tags: ["DR"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/backup/{id}",
    summary: "Get a specific backup by ID",
    tags: ["DR"],
    auth: "rbac",
  },
  {
    method: "POST",
    path: "/admin/backup/{id}/verify",
    summary: "Verify integrity of a backup",
    tags: ["DR"],
    auth: "rbac",
  },
  {
    method: "POST",
    path: "/admin/restore",
    summary: "Restore from a backup",
    tags: ["DR"],
    auth: "rbac",
  },
  {
    method: "POST",
    path: "/admin/backup/schedule",
    summary: "Start DR backup schedule",
    tags: ["DR"],
    auth: "rbac",
  },
  {
    method: "DELETE",
    path: "/admin/backup/schedule",
    summary: "Stop DR backup schedule",
    tags: ["DR"],
    auth: "rbac",
  },

  // ── Secrets ──
  {
    method: "GET",
    path: "/admin/secrets",
    summary: "List all secret keys (values redacted)",
    tags: ["Secrets"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/secrets/{key}",
    summary: "Get a secret by key (value redacted)",
    tags: ["Secrets"],
    auth: "rbac",
  },
  {
    method: "PUT",
    path: "/admin/secrets/{key}",
    summary: "Set or update a secret",
    tags: ["Secrets"],
    auth: "rbac",
  },
  {
    method: "DELETE",
    path: "/admin/secrets/{key}",
    summary: "Delete a secret by key",
    tags: ["Secrets"],
    auth: "rbac",
  },

  // ── Drift Detection ──
  {
    method: "POST",
    path: "/admin/drift/scan",
    summary: "Trigger a drift scan",
    tags: ["Drift"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/drift/results",
    summary: "Get latest drift scan results",
    tags: ["Drift"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/drift/stats",
    summary: "Get drift scan statistics",
    tags: ["Drift"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/drift/policies",
    summary: "List drift remediation policies",
    tags: ["Drift"],
    auth: "rbac",
  },
  {
    method: "POST",
    path: "/admin/drift/policies",
    summary: "Add a drift remediation policy",
    tags: ["Drift"],
    auth: "rbac",
  },
  {
    method: "DELETE",
    path: "/admin/drift/policies/{id}",
    summary: "Delete a drift policy by ID",
    tags: ["Drift"],
    auth: "rbac",
  },

  // ── Service Mesh ──
  {
    method: "GET",
    path: "/admin/mesh/services",
    summary: "List all mesh services",
    tags: ["Mesh"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/mesh/dashboard",
    summary: "Get mesh observability dashboard",
    tags: ["Mesh"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/mesh/canary",
    summary: "Get active canary deployments",
    tags: ["Mesh"],
    auth: "rbac",
  },

  // ── Meta ──
  {
    method: "GET",
    path: "/admin/openapi.json",
    summary: "OpenAPI 3.1 specification",
    tags: ["Meta"],
    auth: "rbac",
  },
  {
    method: "GET",
    path: "/admin/routes",
    summary: "List all admin routes",
    tags: ["Meta"],
    auth: "rbac",
  },
];

// ── OpenAPI 3.1 Spec Builder ─────────────────────────────────────────────────

function buildPathItem(route: AdminRoute): Record<string, unknown> {
  const method = route.method.toLowerCase();
  const operation: Record<string, unknown> = {
    summary: route.summary,
    tags: route.tags,
    operationId: operationId(route),
    responses: {
      "200": {
        description: "Successful response",
        content: { "application/json": { schema: { type: "object" } } },
      },
    },
  };

  if (route.auth === "rbac") {
    operation.security = [{ BearerAuth: [] }];
  }

  // Path parameters
  const params = extractPathParams(route.path);
  if (params.length > 0) {
    operation.parameters = params.map((p) => ({
      name: p,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
  }

  // Query parameters for listing endpoints
  if (method === "get" && (route.path.includes("services") || route.path.includes("instances"))) {
    operation.parameters = [
      ...((operation.parameters as unknown[]) || []),
      {
        name: "namespace",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filter by namespace",
      },
    ];
  }

  // Request body for POST/PUT
  if (method === "post" || method === "put") {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    };
  }

  // Error responses
  const responses = operation.responses as Record<string, unknown>;
  if (route.auth === "rbac") {
    responses["401"] = { description: "Authentication required" };
    responses["403"] = { description: "Insufficient permissions" };
  }
  responses["404"] = { description: "Module not enabled or resource not found" };
  responses["500"] = { description: "Internal server error" };

  return { [method]: operation };
}

function extractPathParams(path: string): string[] {
  const matches = path.match(/\{(\w+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

function operationId(route: AdminRoute): string {
  const parts = route.path
    .replace(/^\/admin\//, "")
    .replace(/^\//, "")
    .replace(/\{[^}]+\}/g, "ById")
    .replace(/\.[^/]+$/, "") // strip file extensions (e.g. .json)
    .split("/")
    .filter(Boolean);
  const prefix = route.method.toLowerCase();
  return prefix + parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

/**
 * Build a complete OpenAPI 3.1 spec object for all admin endpoints.
 */
export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of ADMIN_ROUTES) {
    const key = route.path;
    if (!paths[key]) paths[key] = {};
    Object.assign(paths[key], buildPathItem(route));
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Espada Enterprise Admin API",
      version: "1.0.0",
      description: "Admin endpoints for the Espada gateway enterprise modules",
    },
    servers: [{ url: "/", description: "Current gateway instance" }],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Gateway API token or SSO session token",
        },
      },
    },
    tags: [
      { name: "Observability", description: "Health and readiness checks" },
      { name: "Cluster", description: "Multi-instance cluster management" },
      { name: "DR", description: "Disaster recovery backups & restores" },
      { name: "Secrets", description: "Secrets management" },
      { name: "Drift", description: "Configuration drift detection" },
      { name: "Mesh", description: "Service mesh observability" },
      { name: "Meta", description: "API documentation & introspection" },
    ],
  };
}

/**
 * Build a minimal route summary (for /admin/routes endpoint).
 */
export function buildRouteSummary(): { total: number; routes: AdminRoute[] } {
  return { total: ADMIN_ROUTES.length, routes: ADMIN_ROUTES };
}
