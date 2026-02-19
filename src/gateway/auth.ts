import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { GatewayAuthConfig, GatewayTailscaleMode } from "../config/config.js";
import { readTailscaleWhoisIdentity, type TailscaleWhoisIdentity } from "../infra/tailscale.js";
import { isTrustedProxyAddress, parseForwardedForClientIp, resolveGatewayClientIp } from "./net.js";
import type { SSOUser } from "./sso/types.js";
import type { SessionManager } from "./sso/session-store.js";
import { decodeSessionToken } from "./sso/session-store.js";
import type { GatewayRBACManager } from "./rbac/manager.js";

export type ResolvedGatewayAuthMode = "token" | "password" | "oidc";

export type ResolvedGatewayAuth = {
  mode: ResolvedGatewayAuthMode;
  token?: string;
  password?: string;
  allowTailscale: boolean;
  /** Whether SSO is configured (OIDC/SAML). */
  ssoEnabled: boolean;
  /** Allow token/password fallback when SSO is enabled. */
  ssoAllowFallback: boolean;
};

export type GatewayAuthResult = {
  ok: boolean;
  method?: "token" | "password" | "tailscale" | "device-token" | "sso";
  user?: string;
  reason?: string;
  /** Resolved SSO user identity (present when method=sso). */
  ssoUser?: SSOUser;
  /** SSO session ID (present when method=sso). */
  ssoSessionId?: string;
  /** Resolved RBAC roles (present when SSO or RBAC is active). */
  roles?: string[];
};

type ConnectAuth = {
  token?: string;
  password?: string;
};

type TailscaleUser = {
  login: string;
  name: string;
  profilePic?: string;
};

type TailscaleWhoisLookup = (ip: string) => Promise<TailscaleWhoisIdentity | null>;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip === "::1") return true;
  if (ip.startsWith("::ffff:127.")) return true;
  return false;
}

function getHostName(hostHeader?: string): string {
  const host = (hostHeader ?? "").trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end !== -1) return host.slice(1, end);
  }
  const [name] = host.split(":");
  return name ?? "";
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveTailscaleClientIp(req?: IncomingMessage): string | undefined {
  if (!req) return undefined;
  const forwardedFor = headerValue(req.headers?.["x-forwarded-for"]);
  return forwardedFor ? parseForwardedForClientIp(forwardedFor) : undefined;
}

function resolveRequestClientIp(
  req?: IncomingMessage,
  trustedProxies?: string[],
): string | undefined {
  if (!req) return undefined;
  return resolveGatewayClientIp({
    remoteAddr: req.socket?.remoteAddress ?? "",
    forwardedFor: headerValue(req.headers?.["x-forwarded-for"]),
    realIp: headerValue(req.headers?.["x-real-ip"]),
    trustedProxies,
  });
}

export function isLocalDirectRequest(req?: IncomingMessage, trustedProxies?: string[]): boolean {
  if (!req) return false;
  const clientIp = resolveRequestClientIp(req, trustedProxies) ?? "";
  if (!isLoopbackAddress(clientIp)) return false;

  const host = getHostName(req.headers?.host);
  const hostIsLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const hostIsTailscaleServe = host.endsWith(".ts.net");

  const hasForwarded = Boolean(
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-real-ip"] ||
    req.headers?.["x-forwarded-host"],
  );

  const remoteIsTrustedProxy = isTrustedProxyAddress(req.socket?.remoteAddress, trustedProxies);
  return (hostIsLocal || hostIsTailscaleServe) && (!hasForwarded || remoteIsTrustedProxy);
}

function getTailscaleUser(req?: IncomingMessage): TailscaleUser | null {
  if (!req) return null;
  const login = req.headers["tailscale-user-login"];
  if (typeof login !== "string" || !login.trim()) return null;
  const nameRaw = req.headers["tailscale-user-name"];
  const profilePic = req.headers["tailscale-user-profile-pic"];
  const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : login.trim();
  return {
    login: login.trim(),
    name,
    profilePic: typeof profilePic === "string" && profilePic.trim() ? profilePic.trim() : undefined,
  };
}

function hasTailscaleProxyHeaders(req?: IncomingMessage): boolean {
  if (!req) return false;
  return Boolean(
    req.headers["x-forwarded-for"] &&
    req.headers["x-forwarded-proto"] &&
    req.headers["x-forwarded-host"],
  );
}

function isTailscaleProxyRequest(req?: IncomingMessage): boolean {
  if (!req) return false;
  return isLoopbackAddress(req.socket?.remoteAddress) && hasTailscaleProxyHeaders(req);
}

async function resolveVerifiedTailscaleUser(params: {
  req?: IncomingMessage;
  tailscaleWhois: TailscaleWhoisLookup;
}): Promise<{ ok: true; user: TailscaleUser } | { ok: false; reason: string }> {
  const { req, tailscaleWhois } = params;
  const tailscaleUser = getTailscaleUser(req);
  if (!tailscaleUser) {
    return { ok: false, reason: "tailscale_user_missing" };
  }
  if (!isTailscaleProxyRequest(req)) {
    return { ok: false, reason: "tailscale_proxy_missing" };
  }
  const clientIp = resolveTailscaleClientIp(req);
  if (!clientIp) {
    return { ok: false, reason: "tailscale_whois_failed" };
  }
  const whois = await tailscaleWhois(clientIp);
  if (!whois?.login) {
    return { ok: false, reason: "tailscale_whois_failed" };
  }
  if (normalizeLogin(whois.login) !== normalizeLogin(tailscaleUser.login)) {
    return { ok: false, reason: "tailscale_user_mismatch" };
  }
  return {
    ok: true,
    user: {
      login: whois.login,
      name: whois.name ?? tailscaleUser.name,
      profilePic: tailscaleUser.profilePic,
    },
  };
}

export function resolveGatewayAuth(params: {
  authConfig?: GatewayAuthConfig | null;
  env?: NodeJS.ProcessEnv;
  tailscaleMode?: GatewayTailscaleMode;
}): ResolvedGatewayAuth {
  const authConfig = params.authConfig ?? {};
  const env = params.env ?? process.env;
  const token = authConfig.token ?? env.ESPADA_GATEWAY_TOKEN ?? undefined;
  const password = authConfig.password ?? env.ESPADA_GATEWAY_PASSWORD ?? undefined;
  const ssoConfig = authConfig.sso;
  const ssoEnabled = Boolean(
    ssoConfig?.issuerUrl && ssoConfig?.clientId && ssoConfig?.clientSecret,
  );
  const mode: ResolvedGatewayAuth["mode"] =
    authConfig.mode ?? (ssoEnabled ? "oidc" : password ? "password" : "token");
  const allowTailscale =
    authConfig.allowTailscale ?? (params.tailscaleMode === "serve" && mode !== "password");
  return {
    mode,
    token,
    password,
    allowTailscale,
    ssoEnabled,
    ssoAllowFallback: ssoConfig?.allowFallback ?? true,
  };
}

export function assertGatewayAuthConfigured(auth: ResolvedGatewayAuth): void {
  if (auth.mode === "token" && !auth.token) {
    if (auth.allowTailscale) return;
    throw new Error(
      "gateway auth mode is token, but no token was configured (set gateway.auth.token or ESPADA_GATEWAY_TOKEN)",
    );
  }
  if (auth.mode === "password" && !auth.password) {
    throw new Error("gateway auth mode is password, but no password was configured");
  }
}

export async function authorizeGatewayConnect(params: {
  auth: ResolvedGatewayAuth;
  connectAuth?: ConnectAuth | null;
  req?: IncomingMessage;
  trustedProxies?: string[];
  tailscaleWhois?: TailscaleWhoisLookup;
  sessionManager?: SessionManager | null;
  rbacManager?: GatewayRBACManager | null;
}): Promise<GatewayAuthResult> {
  const { auth, connectAuth, req, trustedProxies } = params;
  const tailscaleWhois = params.tailscaleWhois ?? readTailscaleWhoisIdentity;
  const localDirect = isLocalDirectRequest(req, trustedProxies);

  if (auth.allowTailscale && !localDirect) {
    const tailscaleCheck = await resolveVerifiedTailscaleUser({
      req,
      tailscaleWhois,
    });
    if (tailscaleCheck.ok) {
      return {
        ok: true,
        method: "tailscale",
        user: tailscaleCheck.user.login,
      };
    }
  }

  // ── SSO/OIDC session token validation ──────────────────────────────────
  // Clients present SSO session tokens via the connect auth token field.
  // When auth mode is "oidc" this is the primary path; when mode is
  // token/password with SSO enabled, it's tried first as an early check.
  if (auth.ssoEnabled && connectAuth?.token && params.sessionManager) {
    const ssoResult = await validateSSOSessionToken({
      token: connectAuth.token,
      sessionManager: params.sessionManager,
      rbacManager: params.rbacManager ?? null,
    });
    if (ssoResult) return ssoResult;
  }

  // When mode is OIDC and SSO token didn't match, fall back only if allowed
  if (auth.mode === "oidc" && !auth.ssoAllowFallback) {
    return { ok: false, reason: "sso_required" };
  }

  if (auth.mode === "token" || (auth.mode === "oidc" && auth.ssoAllowFallback)) {
    if (auth.token && connectAuth?.token) {
      if (safeEqual(connectAuth.token, auth.token)) {
        return { ok: true, method: "token" };
      }
    }
    if (auth.mode === "token") {
      if (!auth.token) return { ok: false, reason: "token_missing_config" };
      if (!connectAuth?.token) return { ok: false, reason: "token_missing" };
      return { ok: false, reason: "token_mismatch" };
    }
  }

  if (auth.mode === "password" || (auth.mode === "oidc" && auth.ssoAllowFallback)) {
    const password = connectAuth?.password;
    if (auth.password && password) {
      if (safeEqual(password, auth.password)) {
        return { ok: true, method: "password" };
      }
    }
    if (auth.mode === "password") {
      if (!auth.password) return { ok: false, reason: "password_missing_config" };
      if (!password) return { ok: false, reason: "password_missing" };
      return { ok: false, reason: "password_mismatch" };
    }
  }

  return { ok: false, reason: "unauthorized" };
}

// ── SSO token validation ─────────────────────────────────────────────────

async function validateSSOSessionToken(params: {
  token: string;
  sessionManager: SessionManager;
  rbacManager: GatewayRBACManager | null;
}): Promise<GatewayAuthResult | null> {
  const decoded = decodeSessionToken(params.token);
  if (!decoded) return null; // Not an SSO token — let other methods try
  if (decoded.expired) {
    return { ok: false, reason: "sso_session_expired" };
  }

  const session = await params.sessionManager.getSession(decoded.sessionId);
  if (!session) {
    return { ok: false, reason: "sso_session_not_found" };
  }

  // Resolve RBAC roles: use session roles + any additional assigned roles
  let roles = session.roles;
  if (params.rbacManager) {
    const assignedRoles = await params.rbacManager.getUserRoles(session.userId);
    const allRoles = new Set([...roles, ...assignedRoles.map((r) => r.id)]);
    roles = [...allRoles];
  }

  const ssoUser: SSOUser = {
    id: session.userId,
    email: session.email,
    name: session.name,
    roles,
    groups: session.idpGroups,
    mfaVerified: false,
    lastLogin: session.lastActivityAt,
    provider: session.provider,
  };

  // Update last activity
  await params.sessionManager.touchSession(decoded.sessionId).catch(() => {});

  return {
    ok: true,
    method: "sso",
    user: session.email,
    ssoUser,
    ssoSessionId: session.id,
    roles,
  };
}
