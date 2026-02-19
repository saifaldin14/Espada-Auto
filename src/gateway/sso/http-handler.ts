/**
 * Enterprise SSO — HTTP Request Handler
 *
 * Handles the browser-based OIDC authorization code flow:
 *   GET /auth/sso/init     → redirect to IdP
 *   GET /auth/sso/callback → exchange code, create session, redirect back
 *   GET /auth/sso/status   → return current SSO config status (JSON)
 *   POST /auth/sso/logout  → end SSO session
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { OIDCProvider } from "./oidc-provider.js";
import type { SessionManager } from "./session-store.js";
import { createSessionToken } from "./session-store.js";
import type { GatewayRBACManager } from "../rbac/manager.js";
import type { SSOConfig } from "./types.js";

// Pending OIDC auth states (state → { nonce, createdAt })
const pendingStates = new Map<string, { nonce: string; createdAt: number }>();

// Clean up expired states (older than 10 minutes)
const STATE_TTL_MS = 10 * 60 * 1000;

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

/**
 * Create an HTTP request handler for SSO endpoints.
 * Returns a handler that returns true if it handled the request, false otherwise.
 */
export function createSSOHttpHandler(opts: {
  oidcProvider: OIDCProvider;
  sessionManager: SessionManager;
  rbacManager: GatewayRBACManager;
  ssoConfig: SSOConfig;
  gatewayBaseUrl: string;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { oidcProvider, sessionManager, rbacManager, ssoConfig, gatewayBaseUrl } = opts;

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", gatewayBaseUrl);
    const pathname = url.pathname;

    // ── GET /auth/sso/init ────────────────────────────────────────────
    if (pathname === "/auth/sso/init" && req.method === "GET") {
      pruneExpiredStates();
      const state = randomUUID();
      const nonce = randomUUID();
      pendingStates.set(state, { nonce, createdAt: Date.now() });

      try {
        const authUrl = await oidcProvider.getAuthorizationUrl(state, nonce);
        res.statusCode = 302;
        res.setHeader("Location", authUrl);
        res.end();
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: `SSO init failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return true;
    }

    // ── GET /auth/sso/callback ────────────────────────────────────────
    if (pathname === "/auth/sso/callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      if (error) {
        sendHtml(
          res,
          400,
          `<html><body><h2>SSO Error</h2><p>${error}: ${errorDescription ?? "unknown error"}</p></body></html>`,
        );
        return true;
      }

      if (!code || !state) {
        sendJson(res, 400, { ok: false, error: "Missing code or state parameter" });
        return true;
      }

      const pending = pendingStates.get(state);
      if (!pending) {
        sendJson(res, 400, { ok: false, error: "Invalid or expired state parameter" });
        return true;
      }
      pendingStates.delete(state);

      try {
        // Exchange authorization code for tokens
        const tokenResponse = await oidcProvider.exchangeCode(code);

        // Create session from tokens
        const clientIp = req.socket?.remoteAddress;
        const userAgent = req.headers["user-agent"];
        const { session, user } = oidcProvider.createSessionFromTokens(tokenResponse, {
          clientIp,
          userAgent,
        });

        // Resolve RBAC roles from IdP groups
        const idpRoles = rbacManager.resolveRolesFromGroups(user.groups, ssoConfig.roleMapping);

        // Merge mapped roles into session
        session.roles = idpRoles;

        // Auto-assign roles in RBAC storage
        for (const roleId of idpRoles) {
          try {
            await rbacManager.assignRole(user.id, user.email, roleId, "sso-auto");
          } catch {
            // Role may already be assigned — ignore
          }
        }

        // Save session and get token
        const { token } = await sessionManager.createSession(session);

        // Return HTML that stores the token and redirects to the control UI
        sendHtml(
          res,
          200,
          `<!DOCTYPE html>
<html>
<head><title>SSO Login Successful</title></head>
<body>
<h2>Login Successful</h2>
<p>Welcome, ${escapeHtml(user.name)} (${escapeHtml(user.email)})</p>
<p>Roles: ${escapeHtml(idpRoles.join(", "))}</p>
<p>You can close this window and use the session token to connect.</p>
<script>
  // Store session token for clients that read from localStorage
  try {
    localStorage.setItem("espada-sso-token", ${JSON.stringify(token)});
    localStorage.setItem("espada-sso-user", ${JSON.stringify(JSON.stringify({ id: user.id, email: user.email, name: user.name, roles: idpRoles }))});
  } catch(e) {}
  // Auto-redirect to control UI after 2 seconds
  setTimeout(function() { window.location.href = "/"; }, 2000);
</script>
</body>
</html>`,
        );
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: `SSO callback failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return true;
    }

    // ── GET /auth/sso/status ──────────────────────────────────────────
    if (pathname === "/auth/sso/status" && req.method === "GET") {
      const summary = await sessionManager.getSummary();
      sendJson(res, 200, {
        ok: true,
        ssoEnabled: true,
        provider: ssoConfig.provider,
        issuer: ssoConfig.issuerUrl,
        activeSessions: summary.activeSessions,
        users: summary.users,
      });
      return true;
    }

    // ── POST /auth/sso/logout ─────────────────────────────────────────
    if (pathname === "/auth/sso/logout" && req.method === "POST") {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        sendJson(res, 400, { ok: false, error: "Missing Bearer token" });
        return true;
      }

      const session = await sessionManager.validateToken(token);
      if (!session) {
        sendJson(res, 401, { ok: false, error: "Invalid or expired session" });
        return true;
      }

      await sessionManager.endSession(session.id);

      // Try to get IdP logout URL
      const logoutUrl = await oidcProvider.getLogoutUrl().catch(() => null);

      sendJson(res, 200, {
        ok: true,
        message: "Session ended",
        idpLogoutUrl: logoutUrl,
      });
      return true;
    }

    return false;
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
