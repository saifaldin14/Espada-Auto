import type {
  GatewayAuthConfig,
  GatewayBindMode,
  GatewayTailscaleConfig,
  loadConfig,
} from "../config/config.js";
import {
  assertGatewayAuthConfigured,
  type ResolvedGatewayAuth,
  resolveGatewayAuth,
} from "./auth.js";
import { normalizeControlUiBasePath } from "./control-ui-shared.js";
import { resolveHooksConfig } from "./hooks.js";
import { join } from "node:path";
import { isLoopbackHost, resolveGatewayBindHost } from "./net.js";
import { OIDCProvider } from "./sso/oidc-provider.js";
import { SessionManager, FileSessionStore } from "./sso/session-store.js";
import type { SSOConfig } from "./sso/types.js";
import { DEFAULT_SSO_CONFIG } from "./sso/types.js";
import { GatewayRBACManager, FileRBACStorage } from "./rbac/manager.js";
import { resolveStateDir } from "../config/paths.js";

export type GatewayRuntimeConfig = {
  bindHost: string;
  controlUiEnabled: boolean;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  controlUiBasePath: string;
  resolvedAuth: ResolvedGatewayAuth;
  authMode: ResolvedGatewayAuth["mode"];
  tailscaleConfig: GatewayTailscaleConfig;
  tailscaleMode: "off" | "serve" | "funnel";
  hooksConfig: ReturnType<typeof resolveHooksConfig>;
  canvasHostEnabled: boolean;
  /** SSO OIDC provider (null when SSO not configured). */
  oidcProvider: OIDCProvider | null;
  /** SSO session manager (null when SSO not configured). */
  sessionManager: SessionManager | null;
  /** RBAC manager (always initialized with built-in roles). */
  rbacManager: GatewayRBACManager;
  /** Resolved SSO config (null when SSO not configured). */
  ssoConfig: SSOConfig | null;
};

export async function resolveGatewayRuntimeConfig(params: {
  cfg: ReturnType<typeof loadConfig>;
  port: number;
  bind?: GatewayBindMode;
  host?: string;
  controlUiEnabled?: boolean;
  openAiChatCompletionsEnabled?: boolean;
  openResponsesEnabled?: boolean;
  auth?: GatewayAuthConfig;
  tailscale?: GatewayTailscaleConfig;
}): Promise<GatewayRuntimeConfig> {
  const bindMode = params.bind ?? params.cfg.gateway?.bind ?? "loopback";
  const customBindHost = params.cfg.gateway?.customBindHost;
  const bindHost = params.host ?? (await resolveGatewayBindHost(bindMode, customBindHost));
  const controlUiEnabled =
    params.controlUiEnabled ?? params.cfg.gateway?.controlUi?.enabled ?? true;
  const openAiChatCompletionsEnabled =
    params.openAiChatCompletionsEnabled ??
    params.cfg.gateway?.http?.endpoints?.chatCompletions?.enabled ??
    false;
  const openResponsesConfig = params.cfg.gateway?.http?.endpoints?.responses;
  const openResponsesEnabled = params.openResponsesEnabled ?? openResponsesConfig?.enabled ?? false;
  const controlUiBasePath = normalizeControlUiBasePath(params.cfg.gateway?.controlUi?.basePath);
  const authBase = params.cfg.gateway?.auth ?? {};
  const authOverrides = params.auth ?? {};
  const authConfig = {
    ...authBase,
    ...authOverrides,
  };
  const tailscaleBase = params.cfg.gateway?.tailscale ?? {};
  const tailscaleOverrides = params.tailscale ?? {};
  const tailscaleConfig = {
    ...tailscaleBase,
    ...tailscaleOverrides,
  };
  const tailscaleMode = tailscaleConfig.mode ?? "off";
  const resolvedAuth = resolveGatewayAuth({
    authConfig,
    env: process.env,
    tailscaleMode,
  });
  const authMode: ResolvedGatewayAuth["mode"] = resolvedAuth.mode;
  const hasToken = typeof resolvedAuth.token === "string" && resolvedAuth.token.trim().length > 0;
  const hasPassword =
    typeof resolvedAuth.password === "string" && resolvedAuth.password.trim().length > 0;
  const hasSharedSecret =
    (authMode === "token" && hasToken) || (authMode === "password" && hasPassword);
  const hooksConfig = resolveHooksConfig(params.cfg);
  const canvasHostEnabled =
    process.env.ESPADA_SKIP_CANVAS_HOST !== "1" && params.cfg.canvasHost?.enabled !== false;

  assertGatewayAuthConfigured(resolvedAuth);
  if (tailscaleMode === "funnel" && authMode !== "password") {
    throw new Error(
      "tailscale funnel requires gateway auth mode=password (set gateway.auth.password or ESPADA_GATEWAY_PASSWORD)",
    );
  }
  if (tailscaleMode !== "off" && !isLoopbackHost(bindHost)) {
    throw new Error("tailscale serve/funnel requires gateway bind=loopback (127.0.0.1)");
  }
  if (!isLoopbackHost(bindHost) && !hasSharedSecret && !resolvedAuth.ssoEnabled) {
    throw new Error(
      `refusing to bind gateway to ${bindHost}:${params.port} without auth (set gateway.auth.token/password, or set ESPADA_GATEWAY_TOKEN/ESPADA_GATEWAY_PASSWORD)`,
    );
  }

  // ── SSO/RBAC initialization ───────────────────────────────────────────
  const stateDir = resolveStateDir();
  const ssoConfigRaw = authConfig.sso;
  let oidcProvider: OIDCProvider | null = null;
  let sessionManager: SessionManager | null = null;
  let ssoConfig: SSOConfig | null = null;

  if (
    resolvedAuth.ssoEnabled &&
    ssoConfigRaw?.issuerUrl &&
    ssoConfigRaw.clientId &&
    ssoConfigRaw.clientSecret
  ) {
    ssoConfig = {
      provider: ssoConfigRaw.provider ?? "oidc",
      issuerUrl: ssoConfigRaw.issuerUrl,
      clientId: ssoConfigRaw.clientId,
      clientSecret: ssoConfigRaw.clientSecret,
      callbackUrl:
        ssoConfigRaw.callbackUrl ?? `http://${bindHost}:${params.port}/auth/sso/callback`,
      scopes: ssoConfigRaw.scopes ?? DEFAULT_SSO_CONFIG.scopes ?? ["openid", "profile", "email"],
      roleMapping: ssoConfigRaw.roleMapping ?? DEFAULT_SSO_CONFIG.roleMapping ?? {},
      allowFallback: ssoConfigRaw.allowFallback ?? DEFAULT_SSO_CONFIG.allowFallback ?? true,
    };
    oidcProvider = new OIDCProvider(ssoConfig);
    sessionManager = new SessionManager(new FileSessionStore(join(stateDir, "sso-sessions.json")));
  }

  // RBAC is always initialized (built-in roles exist even without SSO)
  const rbacStorage = new FileRBACStorage(join(stateDir, "rbac.json"));
  const rbacManager = new GatewayRBACManager(rbacStorage);
  await rbacManager.initialize();

  return {
    bindHost,
    controlUiEnabled,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig: openResponsesConfig
      ? { ...openResponsesConfig, enabled: openResponsesEnabled }
      : undefined,
    controlUiBasePath,
    resolvedAuth,
    authMode,
    tailscaleConfig,
    tailscaleMode,
    hooksConfig,
    canvasHostEnabled,
    oidcProvider,
    sessionManager,
    rbacManager,
    ssoConfig,
  };
}
