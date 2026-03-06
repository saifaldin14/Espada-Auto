import { describe, expect, it } from "vitest";

import { authorizeGatewayConnect, authorizeGatewayPermission } from "../../gateway/auth.js";

describe("gateway auth", () => {
  it("does not throw when req is missing socket", async () => {
    const res = await authorizeGatewayConnect({
      auth: { mode: "token", token: "secret", allowTailscale: false },
      connectAuth: { token: "secret" },
      // Regression: avoid crashing on req.socket.remoteAddress when callers pass a non-IncomingMessage.
      req: {} as never,
    });
    expect(res.ok).toBe(true);
  });

  it("reports missing and mismatched token reasons", async () => {
    const missing = await authorizeGatewayConnect({
      auth: { mode: "token", token: "secret", allowTailscale: false },
      connectAuth: null,
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe("token_missing");

    const mismatch = await authorizeGatewayConnect({
      auth: { mode: "token", token: "secret", allowTailscale: false },
      connectAuth: { token: "wrong" },
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toBe("token_mismatch");
  });

  it("reports missing token config reason", async () => {
    const res = await authorizeGatewayConnect({
      auth: { mode: "token", allowTailscale: false },
      connectAuth: { token: "anything" },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("token_missing_config");
  });

  it("reports missing and mismatched password reasons", async () => {
    const missing = await authorizeGatewayConnect({
      auth: { mode: "password", password: "secret", allowTailscale: false },
      connectAuth: null,
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe("password_missing");

    const mismatch = await authorizeGatewayConnect({
      auth: { mode: "password", password: "secret", allowTailscale: false },
      connectAuth: { password: "wrong" },
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toBe("password_mismatch");
  });

  it("reports missing password config reason", async () => {
    const res = await authorizeGatewayConnect({
      auth: { mode: "password", allowTailscale: false },
      connectAuth: { password: "secret" },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("password_missing_config");
  });

  it("treats local tailscale serve hostnames as direct", async () => {
    const res = await authorizeGatewayConnect({
      auth: { mode: "token", token: "secret", allowTailscale: true },
      connectAuth: { token: "secret" },
      req: {
        socket: { remoteAddress: "127.0.0.1" },
        headers: { host: "gateway.tailnet-1234.ts.net:443" },
      } as never,
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe("token");
  });

  it("allows tailscale identity to satisfy token mode auth", async () => {
    const res = await authorizeGatewayConnect({
      auth: { mode: "token", token: "secret", allowTailscale: true },
      connectAuth: null,
      tailscaleWhois: async () => ({ login: "peter", name: "Peter" }),
      req: {
        socket: { remoteAddress: "127.0.0.1" },
        headers: {
          host: "gateway.local",
          "x-forwarded-for": "100.64.0.1",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "ai-hub.bone-egret.ts.net",
          "tailscale-user-login": "peter",
          "tailscale-user-name": "Peter",
        },
      } as never,
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe("tailscale");
    expect(res.user).toBe("peter");
  });

  it("allows non-SSO methods through permission gate", async () => {
    const result = await authorizeGatewayPermission({
      authResult: { ok: true, method: "token" },
      permission: "operator.write",
    });
    expect(result.ok).toBe(true);
  });

  it("denies SSO permission checks when RBAC manager is unavailable", async () => {
    const result = await authorizeGatewayPermission({
      authResult: {
        ok: true,
        method: "sso",
        ssoUser: {
          id: "user-1",
          email: "user@example.com",
          name: "User",
          roles: ["viewer"],
          groups: [],
          mfaVerified: false,
          lastLogin: new Date().toISOString(),
          provider: "oidc",
        },
        roles: ["viewer"],
      },
      permission: "operator.write",
      rbacManager: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rbac_unavailable");
  });

  it("uses RBAC manager to allow SSO permission checks", async () => {
    const rbacManager = {
      checkPermission: async () => ({ allowed: true, grantedBy: ["admin"] }),
    };
    const result = await authorizeGatewayPermission({
      authResult: {
        ok: true,
        method: "sso",
        ssoUser: {
          id: "user-2",
          email: "admin@example.com",
          name: "Admin",
          roles: ["admin"],
          groups: [],
          mfaVerified: true,
          lastLogin: new Date().toISOString(),
          provider: "oidc",
        },
        roles: ["admin"],
      },
      permission: "operator.write",
      rbacManager: rbacManager as never,
    });
    expect(result.ok).toBe(true);
  });
});
