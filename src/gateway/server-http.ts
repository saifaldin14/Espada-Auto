import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import { handleA2uiHttpRequest } from "../canvas-host/a2ui.js";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import { loadConfig } from "../config/config.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import { handleControlUiAvatarRequest, handleControlUiHttpRequest } from "./control-ui.js";
import {
  extractHookToken,
  getHookChannelError,
  type HookMessageChannel,
  type HooksConfigResolved,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBody,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { applyHookMappings } from "./hooks-mapping.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";
import { resolveGatewayClientIp } from "./net.js";
import type { GatewayRBACManager } from "./rbac/manager.js";
import type { SessionManager } from "./sso/session-store.js";
import type { RateLimitStore, RateLimitConfig } from "./state/index.js";
import type { AuditLogPipeline } from "./audit/index.js";
import type { VersionedRouter } from "./api-version/index.js";
import type { EnterpriseRuntime } from "./enterprise/index.js";
import { createEnterpriseAdminHandler } from "./server-enterprise-admin.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: {
    message: string;
    name: string;
    wakeMode: "now" | "next-heartbeat";
    sessionKey: string;
    deliver: boolean;
    channel: HookMessageChannel;
    to?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    allowUnsafeExternalContent?: boolean;
  }) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

const RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.ESPADA_GATEWAY_RATE_LIMIT_WINDOW_MS ?? "60000",
  10,
);
const RATE_LIMIT_MAX = Number.parseInt(process.env.ESPADA_GATEWAY_RATE_LIMIT_MAX ?? "240", 10);
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

/**
 * Optional pluggable rate-limit store. When set, the gateway uses this
 * persistent (e.g. SQLite-backed) store instead of the module-level Map.
 */
let _rateLimitStore: RateLimitStore | null = null;

export function setGatewayRateLimitStore(store: RateLimitStore): void {
  _rateLimitStore = store;
}

function isSensitiveRateLimitedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/sso/") ||
    pathname.startsWith("/v1/") ||
    pathname.startsWith("/tools/invoke")
  );
}

function applyHttpRateLimit(params: {
  req: IncomingMessage;
  pathname: string;
  trustedProxies: string[];
}): boolean {
  if (RATE_LIMIT_MAX <= 0 || !isSensitiveRateLimitedPath(params.pathname)) {
    return true;
  }
  const remoteAddr = params.req.socket?.remoteAddress ?? "";
  const clientIp =
    resolveGatewayClientIp({
      remoteAddr,
      forwardedFor: Array.isArray(params.req.headers["x-forwarded-for"])
        ? params.req.headers["x-forwarded-for"][0]
        : params.req.headers["x-forwarded-for"],
      realIp: Array.isArray(params.req.headers["x-real-ip"])
        ? params.req.headers["x-real-ip"][0]
        : params.req.headers["x-real-ip"],
      trustedProxies: params.trustedProxies,
    }) ?? remoteAddr;
  const key = `${clientIp}:${params.pathname}`;

  // Use pluggable store if available
  if (_rateLimitStore) {
    const cfg: RateLimitConfig = { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX };
    return _rateLimitStore.check(key, cfg);
  }

  // Fallback to in-memory Map
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);
  if (!existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  existing.count += 1;
  return existing.count <= RATE_LIMIT_MAX;
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, bindHost, port, logHooks, dispatchAgentHook, dispatchWakeHook } = opts;
  return async (req, res) => {
    const hooksConfig = getHooksConfig();
    if (!hooksConfig) return false;
    const url = new URL(req.url ?? "/", `http://${bindHost}:${port}`);
    const basePath = hooksConfig.basePath;
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    const { token, fromQuery } = extractHookToken(req, url, {
      allowQueryToken: hooksConfig.allowQueryToken,
    });
    if (!token || token !== hooksConfig.token) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return true;
    }
    if (fromQuery) {
      logHooks.warn(
        "Hook token provided via query parameter is deprecated for security reasons. " +
          "Tokens in URLs appear in logs, browser history, and referrer headers. " +
          "Use Authorization: Bearer <token> or X-Espada-Token header instead.",
      );
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    const subPath = url.pathname.slice(basePath.length).replace(/^\/+/, "");
    if (!subPath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }

    const body = await readJsonBody(req, hooksConfig.maxBodyBytes);
    if (!body.ok) {
      const status = body.error === "payload too large" ? 413 : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }

    const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
    const headers = normalizeHookHeaders(req);

    if (subPath === "wake") {
      const normalized = normalizeWakePayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      dispatchWakeHook(normalized.value);
      sendJson(res, 200, { ok: true, mode: normalized.value.mode });
      return true;
    }

    if (subPath === "agent") {
      const normalized = normalizeAgentPayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      const runId = dispatchAgentHook(normalized.value);
      sendJson(res, 202, { ok: true, runId });
      return true;
    }

    if (hooksConfig.mappings.length > 0) {
      try {
        const mapped = await applyHookMappings(hooksConfig.mappings, {
          payload: payload as Record<string, unknown>,
          headers,
          url,
          path: subPath,
        });
        if (mapped) {
          if (!mapped.ok) {
            sendJson(res, 400, { ok: false, error: mapped.error });
            return true;
          }
          if (mapped.action === null) {
            res.statusCode = 204;
            res.end();
            return true;
          }
          if (mapped.action.kind === "wake") {
            dispatchWakeHook({
              text: mapped.action.text,
              mode: mapped.action.mode,
            });
            sendJson(res, 200, { ok: true, mode: mapped.action.mode });
            return true;
          }
          const channel = resolveHookChannel(mapped.action.channel);
          if (!channel) {
            sendJson(res, 400, { ok: false, error: getHookChannelError() });
            return true;
          }
          const runId = dispatchAgentHook({
            message: mapped.action.message,
            name: mapped.action.name ?? "Hook",
            wakeMode: mapped.action.wakeMode,
            sessionKey: mapped.action.sessionKey ?? "",
            deliver: resolveHookDeliver(mapped.action.deliver),
            channel,
            to: mapped.action.to,
            model: mapped.action.model,
            thinking: mapped.action.thinking,
            timeoutSeconds: mapped.action.timeoutSeconds,
            allowUnsafeExternalContent: mapped.action.allowUnsafeExternalContent,
          });
          sendJson(res, 202, { ok: true, runId });
          return true;
        }
      } catch (err) {
        logHooks.warn(`hook mapping failed: ${String(err)}`);
        sendJson(res, 500, { ok: false, error: "hook mapping failed" });
        return true;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  };
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: HooksRequestHandler;
  handleSSORequest?: HooksRequestHandler;
  resolvedAuth: import("./auth.js").ResolvedGatewayAuth;
  sessionManager?: SessionManager | null;
  rbacManager?: GatewayRBACManager | null;
  tlsOptions?: TlsOptions;
  audit?: AuditLogPipeline | null;
  versionedRouter?: VersionedRouter | null;
  enterprise?: EnterpriseRuntime | null;
}): HttpServer {
  const {
    canvasHost,
    controlUiEnabled,
    controlUiBasePath,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    handleHooksRequest,
    handlePluginRequest,
    handleSSORequest,
    resolvedAuth,
    sessionManager,
    rbacManager,
  } = opts;
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  const { audit, versionedRouter } = opts;
  const handleEnterpriseAdmin = createEnterpriseAdminHandler(opts.enterprise ?? null, {
    auth: resolvedAuth,
    sessionManager,
    rbacManager,
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") return;

    const requestStartMs = Date.now();

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const parsedUrl = new URL(req.url ?? "/", "http://localhost");

      if (!applyHttpRateLimit({ req, pathname: parsedUrl.pathname, trustedProxies })) {
        audit?.record({
          action: "api.rate_limited",
          outcome: "denied",
          severity: "warn",
          actor: {
            type: "user",
            id: "unknown",
            ip: req.socket?.remoteAddress,
          },
          resource: { type: "http", id: parsedUrl.pathname },
          context: { method: req.method, url: req.url },
        });
        sendJson(res, 429, {
          ok: false,
          error: "Rate limit exceeded",
        });
        return;
      }

      if (await handleHooksRequest(req, res)) return;
      if (handleSSORequest && (await handleSSORequest(req, res))) return;

      // Enterprise admin endpoints: /health, /ready, /admin/* (Phase 2)
      if (await handleEnterpriseAdmin(req, res)) return;

      // Enterprise versioned API router (Gap #7)
      if (versionedRouter && (await versionedRouter.handleRequest(req, res))) return;
      if (
        await handleToolsInvokeHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
          sessionManager,
          rbacManager,
        })
      )
        return;
      if (await handleSlackHttpRequest(req, res)) return;
      if (handlePluginRequest && (await handlePluginRequest(req, res))) return;
      if (openResponsesEnabled) {
        if (
          await handleOpenResponsesHttpRequest(req, res, {
            auth: resolvedAuth,
            config: openResponsesConfig,
            trustedProxies,
            sessionManager,
            rbacManager,
          })
        )
          return;
      }
      if (openAiChatCompletionsEnabled) {
        if (
          await handleOpenAiHttpRequest(req, res, {
            auth: resolvedAuth,
            trustedProxies,
            sessionManager,
            rbacManager,
          })
        )
          return;
      }
      if (canvasHost) {
        if (await handleA2uiHttpRequest(req, res)) return;
        if (await canvasHost.handleHttpRequest(req, res)) return;
      }
      if (controlUiEnabled) {
        if (
          handleControlUiAvatarRequest(req, res, {
            basePath: controlUiBasePath,
            resolveAvatar: (agentId) => resolveAgentAvatar(configSnapshot, agentId),
          })
        )
          return;
        if (
          handleControlUiHttpRequest(req, res, {
            basePath: controlUiBasePath,
            config: configSnapshot,
          })
        )
          return;
      }

      // Audit successful request (if not handled above)
      audit?.record({
        action: "api.request",
        outcome: "success",
        severity: "info",
        actor: {
          type: "user",
          id: "unknown",
          ip: req.socket?.remoteAddress,
        },
        resource: { type: "http", id: parsedUrl.pathname },
        context: {
          method: req.method,
          url: req.url,
          status: 404,
          durationMs: Date.now() - requestStartMs,
        },
      });

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch (err) {
      audit?.record({
        action: "api.request",
        outcome: "error",
        severity: "error",
        actor: {
          type: "user",
          id: "unknown",
          ip: req.socket?.remoteAddress,
        },
        resource: { type: "http", id: req.url ?? "/" },
        context: {
          method: req.method,
          url: req.url,
          status: 500,
          error: String(err),
          durationMs: Date.now() - requestStartMs,
        },
      });
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
}) {
  const { httpServer, wss, canvasHost } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    if (canvasHost?.handleUpgrade(req, socket, head)) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
}
