/**
 * API Versioning — Versioned Route Dispatch & Deprecation Management
 *
 * Adds structured API versioning to the gateway HTTP layer:
 *
 * - URL-prefix versioning: /v1/..., /v2/...
 * - Header-based version negotiation (Accept-Version)
 * - Version lifecycle management (active, deprecated, sunset)
 * - Deprecation headers (Deprecation, Sunset, Link)
 * - Backward-compatible route registration
 * - OpenAPI spec generation per version
 *
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// =============================================================================
// Types
// =============================================================================

export type VersionStatus = "active" | "deprecated" | "sunset";

export interface ApiVersion {
  /** Version identifier, e.g. "v1", "v2" */
  version: string;

  /** Numeric major version */
  major: number;

  /** Status */
  status: VersionStatus;

  /** ISO date when this version was released */
  releasedAt: string;

  /** ISO date when this version was deprecated (if applicable) */
  deprecatedAt?: string;

  /** ISO date when this version will be/was removed */
  sunsetAt?: string;

  /** Description of changes in this version */
  changelog?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type VersionedHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
) => Promise<boolean> | boolean;

export interface RouteParams {
  /** Extracted path parameters */
  params: Record<string, string>;

  /** Matched version */
  version: string;

  /** Original path without version prefix */
  path: string;

  /** Query string parsed */
  query: URLSearchParams;
}

export interface RouteDefinition {
  /** HTTP method */
  method: HttpMethod | HttpMethod[];

  /** Path pattern (without version prefix), e.g. "/tools/:toolId/invoke" */
  path: string;

  /** Handler function */
  handler: VersionedHandler;

  /** Description for documentation */
  description?: string;

  /** Supported versions (e.g. ["v1", "v2"]). If omitted, all active versions. */
  versions?: string[];

  /** Tags for OpenAPI grouping */
  tags?: string[];

  /** Whether authentication is required (default: true) */
  auth?: boolean;

  /** Required RBAC permission */
  permission?: string;
}

export interface OpenApiRoute {
  method: string;
  path: string;
  description?: string;
  tags?: string[];
  auth: boolean;
  permission?: string;
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
}

// =============================================================================
// VersionedRouter
// =============================================================================

/**
 * Versioned API router that intercepts HTTP requests and dispatches
 * to the appropriate version handler.
 *
 * Integrates with the existing gateway HTTP chain by acting as a
 * handler that returns `true` if it matched a versioned route.
 */
export class VersionedRouter {
  private versions = new Map<string, ApiVersion>();
  private routes: Array<{
    methods: Set<HttpMethod>;
    pathPattern: RegExp;
    pathTemplate: string;
    paramNames: string[];
    handler: VersionedHandler;
    versions: Set<string> | null; // null = all
    definition: RouteDefinition;
  }> = [];
  private defaultVersion: string;

  constructor(options?: { defaultVersion?: string }) {
    this.defaultVersion = options?.defaultVersion ?? "v1";
  }

  // ===========================================================================
  // Version Management
  // ===========================================================================

  /**
   * Register an API version.
   */
  addVersion(version: ApiVersion): void {
    this.versions.set(version.version, version);
  }

  /**
   * Deprecate an API version with a sunset date.
   */
  deprecateVersion(version: string, sunsetAt: string): void {
    const v = this.versions.get(version);
    if (v) {
      v.status = "deprecated";
      v.deprecatedAt = new Date().toISOString();
      v.sunsetAt = sunsetAt;
    }
  }

  /**
   * Sunset (remove) an API version.
   */
  sunsetVersion(version: string): void {
    const v = this.versions.get(version);
    if (v) {
      v.status = "sunset";
    }
  }

  /**
   * Get all registered versions.
   */
  getVersions(): ApiVersion[] {
    return Array.from(this.versions.values());
  }

  // ===========================================================================
  // Route Registration
  // ===========================================================================

  /**
   * Register a versioned route.
   */
  route(definition: RouteDefinition): void {
    const methods = Array.isArray(definition.method)
      ? new Set(definition.method)
      : new Set([definition.method]);

    const { pattern, paramNames } = pathToRegExp(definition.path);

    this.routes.push({
      methods,
      pathPattern: pattern,
      pathTemplate: definition.path,
      paramNames,
      handler: definition.handler,
      versions: definition.versions ? new Set(definition.versions) : null,
      definition,
    });
  }

  /** Convenience methods */
  get(path: string, handler: VersionedHandler, opts?: Partial<RouteDefinition>): void {
    this.route({ method: "GET", path, handler, ...opts });
  }

  post(path: string, handler: VersionedHandler, opts?: Partial<RouteDefinition>): void {
    this.route({ method: "POST", path, handler, ...opts });
  }

  put(path: string, handler: VersionedHandler, opts?: Partial<RouteDefinition>): void {
    this.route({ method: "PUT", path, handler, ...opts });
  }

  patch(path: string, handler: VersionedHandler, opts?: Partial<RouteDefinition>): void {
    this.route({ method: "PATCH", path, handler, ...opts });
  }

  delete(path: string, handler: VersionedHandler, opts?: Partial<RouteDefinition>): void {
    this.route({ method: "DELETE", path, handler, ...opts });
  }

  // ===========================================================================
  // Request Handling
  // ===========================================================================

  /**
   * Handle an incoming HTTP request. Returns `true` if a versioned
   * route matched and handled the request; `false` to pass through
   * to the next handler in the gateway chain.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const parsedUrl = new URL(req.url ?? "/", "http://localhost");
    const pathname = parsedUrl.pathname;
    const method = (req.method ?? "GET").toUpperCase() as HttpMethod;

    // Extract version from URL prefix or Accept-Version header
    const { version, path } = this.extractVersion(pathname, req);

    if (!version) {
      // Not a versioned route
      return false;
    }

    const versionInfo = this.versions.get(version);

    // Check if version is sunset
    if (versionInfo?.status === "sunset") {
      sendJson(res, 410, {
        error: "Gone",
        message: `API version ${version} has been removed. Please migrate to a newer version.`,
        availableVersions: this.getActiveVersions().map((v) => v.version),
      });
      return true;
    }

    // Find matching route
    for (const route of this.routes) {
      if (!route.methods.has(method)) continue;
      if (route.versions && !route.versions.has(version)) continue;

      const match = route.pathPattern.exec(path);
      if (!match) continue;

      // Extract params
      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = match[i + 1] ?? "";
      }

      // Add deprecation headers if applicable
      if (versionInfo?.status === "deprecated") {
        this.addDeprecationHeaders(res, versionInfo);
      }

      // Add version header
      res.setHeader("X-Api-Version", version);

      try {
        const handled = await route.handler(req, res, {
          params,
          version,
          path,
          query: parsedUrl.searchParams,
        });
        return handled;
      } catch {
        sendJson(res, 500, { error: "Internal Server Error" });
        return true;
      }
    }

    // Version matched but no route
    return false;
  }

  private extractVersion(
    pathname: string,
    req: IncomingMessage,
  ): { version: string | null; path: string } {
    // 1. URL prefix: /v1/tools/... → version="v1", path="/tools/..."
    const prefixMatch = pathname.match(/^\/(v\d+)(\/.*)?$/);
    if (prefixMatch) {
      const version = prefixMatch[1];
      const path = prefixMatch[2] || "/";
      return { version, path };
    }

    // 2. Accept-Version header: Accept-Version: v1
    const headerVersion = req.headers["accept-version"] as string | undefined;
    if (headerVersion && this.versions.has(headerVersion)) {
      return { version: headerVersion, path: pathname };
    }

    // 3. If path matches a registered route, use default version
    for (const route of this.routes) {
      const match = route.pathPattern.exec(pathname);
      if (match) {
        return { version: this.defaultVersion, path: pathname };
      }
    }

    return { version: null, path: pathname };
  }

  private addDeprecationHeaders(res: ServerResponse, version: ApiVersion): void {
    if (version.deprecatedAt) {
      res.setHeader("Deprecation", version.deprecatedAt);
    }
    if (version.sunsetAt) {
      res.setHeader("Sunset", version.sunsetAt);
    }

    const activeVersions = this.getActiveVersions();
    if (activeVersions.length > 0) {
      const latest = activeVersions[activeVersions.length - 1];
      res.setHeader("Link", `</${latest.version}/>; rel="successor-version"`);
    }
  }

  private getActiveVersions(): ApiVersion[] {
    return Array.from(this.versions.values()).filter((v) => v.status === "active");
  }

  // ===========================================================================
  // OpenAPI Spec Generation
  // ===========================================================================

  /**
   * Generate an OpenAPI 3.0 spec for a specific version.
   */
  generateOpenApiSpec(
    version: string,
    options?: {
      title?: string;
      description?: string;
      serverUrl?: string;
    },
  ): OpenApiSpec {
    const versionInfo = this.versions.get(version);

    const paths: Record<string, Record<string, unknown>> = {};

    for (const route of this.routes) {
      if (route.versions && !route.versions.has(version)) continue;

      const fullPath = `/${version}${route.pathTemplate}`;
      // Convert :param to {param} for OpenAPI
      const openApiPath = fullPath.replace(/:([a-zA-Z_]+)/g, "{$1}");

      if (!paths[openApiPath]) {
        paths[openApiPath] = {};
      }

      for (const method of route.methods) {
        const lowerMethod = method.toLowerCase();
        const paramDefs = route.paramNames.map((name) => ({
          name,
          in: "path",
          required: true,
          schema: { type: "string" },
        }));

        paths[openApiPath][lowerMethod] = {
          summary: route.definition.description ?? "",
          tags: route.definition.tags ?? [],
          parameters: paramDefs.length > 0 ? paramDefs : undefined,
          security: route.definition.auth !== false ? [{ bearerAuth: [] }] : undefined,
          responses: {
            "200": { description: "Success" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not Found" },
            "429": { description: "Rate Limited" },
          },
        };
      }
    }

    return {
      openapi: "3.0.3",
      info: {
        title: options?.title ?? "Espada Gateway API",
        version: versionInfo?.version ?? version,
        description:
          options?.description ??
          `Espada Gateway API ${version}${versionInfo?.status === "deprecated" ? " (DEPRECATED)" : ""}`,
      },
      servers: [
        {
          url: options?.serverUrl ?? `http://localhost:18789/${version}`,
          description: "Gateway server",
        },
      ],
      paths,
    };
  }

  /**
   * Built-in route that serves the OpenAPI spec as JSON.
   */
  registerSpecEndpoint(options?: { title?: string; serverUrl?: string }): void {
    this.route({
      method: "GET",
      path: "/openapi.json",
      description: "OpenAPI specification for this API version",
      tags: ["meta"],
      auth: false,
      handler: (_req, res, routeParams) => {
        const spec = this.generateOpenApiSpec(routeParams.version, {
          title: options?.title,
          serverUrl: options?.serverUrl,
        });
        sendJson(res, 200, spec);
        return true;
      },
    });
  }

  /**
   * Built-in route that lists available API versions.
   */
  registerVersionsEndpoint(): void {
    this.route({
      method: "GET",
      path: "/versions",
      description: "List available API versions",
      tags: ["meta"],
      auth: false,
      handler: (_req, res) => {
        sendJson(res, 200, {
          versions: this.getVersions(),
          default: this.defaultVersion,
        });
        return true;
      },
    });
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert a path pattern like "/tools/:toolId/invoke" into a RegExp
 * and extract parameter names.
 */
function pathToRegExp(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];

  // Extract params first, then escape the remaining regex metacharacters
  const withParams = path.replace(/:([a-zA-Z_]+)/g, (_match, name: string) => {
    paramNames.push(name);
    return "__PARAM__";
  });

  const escaped = withParams.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  const regexStr = escaped.replace(/__PARAM__/g, "([^/]+)");

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
