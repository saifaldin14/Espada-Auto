import { describe, expect, it } from "vitest";

import { authorizeGatewayConnect, resolveGatewayAuth } from "./auth.js";
import { InMemorySessionStore } from "./sso/session-store.js";
import { SessionManager, createSessionToken } from "./sso/session-store.js";
import { InMemoryRBACStorage, GatewayRBACManager } from "./rbac/manager.js";
import type { SSOSession } from "./sso/types.js";

function makeSession(overrides: Partial<SSOSession> = {}): SSOSession {
  const now = new Date();
  return {
    id: "sess-1",
    userId: "user-1",
    email: "alice@example.com",
    name: "Alice",
    roles: ["admin"],
    idpGroups: ["engineering"],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    refreshToken: undefined,
    provider: "oidc",
    clientIp: "127.0.0.1",
    userAgent: "test",
    lastActivityAt: now.toISOString(),
    ...overrides,
  };
}

describe("gateway auth — SSO/OIDC", () => {
  it("resolveGatewayAuth detects SSO mode when issuer/client/secret set", () => {
    const resolved = resolveGatewayAuth({
      authConfig: {
        sso: {
          issuerUrl: "https://idp.example.com",
          clientId: "my-client",
          clientSecret: "my-secret",
        },
      },
    });
    expect(resolved.mode).toBe("oidc");
    expect(resolved.ssoEnabled).toBe(true);
    expect(resolved.ssoAllowFallback).toBe(true);
  });

  it("resolveGatewayAuth defaults to token mode without SSO config", () => {
    const resolved = resolveGatewayAuth({
      authConfig: { token: "abc" },
    });
    expect(resolved.mode).toBe("token");
    expect(resolved.ssoEnabled).toBe(false);
  });

  it("resolveGatewayAuth respects explicit mode override", () => {
    const resolved = resolveGatewayAuth({
      authConfig: {
        mode: "password",
        password: "pass",
        sso: {
          issuerUrl: "https://idp.example.com",
          clientId: "c",
          clientSecret: "s",
        },
      },
    });
    expect(resolved.mode).toBe("password");
    expect(resolved.ssoEnabled).toBe(true);
  });

  it("accepts valid SSO session token", async () => {
    const store = new InMemorySessionStore();
    const sessionManager = new SessionManager(store);
    const session = makeSession();
    await store.save(session);
    const token = createSessionToken(session);

    const res = await authorizeGatewayConnect({
      auth: {
        mode: "oidc",
        ssoEnabled: true,
        ssoAllowFallback: false,
        allowTailscale: false,
      },
      connectAuth: { token },
      sessionManager,
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe("sso");
    expect(res.user).toBe("alice@example.com");
    expect(res.ssoUser?.id).toBe("user-1");
    expect(res.ssoSessionId).toBe("sess-1");
    expect(res.roles).toContain("admin");
  });

  it("rejects expired SSO session token", async () => {
    const store = new InMemorySessionStore();
    const sessionManager = new SessionManager(store);
    const session = makeSession({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await store.save(session);
    const token = createSessionToken(session);

    const res = await authorizeGatewayConnect({
      auth: {
        mode: "oidc",
        ssoEnabled: true,
        ssoAllowFallback: false,
        allowTailscale: false,
      },
      connectAuth: { token },
      sessionManager,
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("sso_session_expired");
  });

  it("rejects SSO token for deleted session", async () => {
    const store = new InMemorySessionStore();
    const sessionManager = new SessionManager(store);
    const session = makeSession();
    // Don't save it — simulate session not found
    const token = createSessionToken(session);

    const res = await authorizeGatewayConnect({
      auth: {
        mode: "oidc",
        ssoEnabled: true,
        ssoAllowFallback: false,
        allowTailscale: false,
      },
      connectAuth: { token },
      sessionManager,
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("sso_session_not_found");
  });

  it("requires SSO when oidc mode with no fallback", async () => {
    const res = await authorizeGatewayConnect({
      auth: {
        mode: "oidc",
        ssoEnabled: true,
        ssoAllowFallback: false,
        allowTailscale: false,
      },
      connectAuth: { token: "regular-token" },
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("sso_required");
  });

  it("allows token fallback when oidc + ssoAllowFallback", async () => {
    const res = await authorizeGatewayConnect({
      auth: {
        mode: "oidc",
        token: "secret",
        ssoEnabled: true,
        ssoAllowFallback: true,
        allowTailscale: false,
      },
      connectAuth: { token: "secret" },
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe("token");
  });

  it("allows password fallback when oidc + ssoAllowFallback", async () => {
    const res = await authorizeGatewayConnect({
      auth: {
        mode: "oidc",
        password: "pass123",
        ssoEnabled: true,
        ssoAllowFallback: true,
        allowTailscale: false,
      },
      connectAuth: { password: "pass123" },
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe("password");
  });

  it("merges RBAC assigned roles with session roles", async () => {
    const store = new InMemorySessionStore();
    const sessionManager = new SessionManager(store);
    const rbacStorage = new InMemoryRBACStorage();
    const rbacManager = new GatewayRBACManager(rbacStorage);
    await rbacManager.initialize();

    const session = makeSession({ roles: ["viewer"] });
    await store.save(session);
    const token = createSessionToken(session);

    // Assign an additional role via RBAC
    await rbacManager.assignRole("user-1", "alice@example.com", "admin", "test");

    const res = await authorizeGatewayConnect({
      auth: {
        mode: "oidc",
        ssoEnabled: true,
        ssoAllowFallback: false,
        allowTailscale: false,
      },
      connectAuth: { token },
      sessionManager,
      rbacManager,
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe("sso");
    expect(res.roles).toContain("viewer");
    expect(res.roles).toContain("admin");
  });
});
