/**
 * Enterprise SSO/RBAC — Tests
 *
 * Unit tests for OIDC provider, session store, RBAC manager,
 * and the SSO/RBAC agent tools.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { OIDCProvider, OIDCError } from "./oidc-provider.js";
import {
  InMemorySessionStore,
  SessionManager,
  createSessionToken,
  decodeSessionToken,
} from "./session-store.js";
import { GatewayRBACManager, InMemoryRBACStorage } from "../rbac/manager.js";
import { BUILT_IN_ROLES } from "../rbac/types.js";
import type { SSOConfig, SSOSession } from "./types.js";
import type { Permission } from "../rbac/types.js";
import { createSSOTools } from "./tools.js";

// =============================================================================
// Test Helpers
// =============================================================================

function makeSSOConfig(overrides?: Partial<SSOConfig>): SSOConfig {
  return {
    provider: "oidc",
    issuerUrl: "https://idp.example.com",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    callbackUrl: "https://gateway.example.com/auth/callback",
    scopes: ["openid", "profile", "email"],
    roleMapping: {
      Engineering: "developer",
      SRE: "operator",
      Platform: "admin",
      Security: "auditor",
    },
    allowFallback: true,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SSOSession>): SSOSession {
  const now = new Date();
  return {
    id: `session-${Date.now()}`,
    userId: "user-1",
    email: "user@example.com",
    name: "Test User",
    roles: ["developer"],
    idpGroups: ["Engineering"],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
    provider: "oidc",
    lastActivityAt: now.toISOString(),
    ...overrides,
  };
}

function makeExpiredSession(): SSOSession {
  const past = new Date(Date.now() - 86400_000);
  return makeSession({
    id: "expired-session",
    issuedAt: past.toISOString(),
    expiresAt: new Date(past.getTime() + 3600_000).toISOString(),
    lastActivityAt: past.toISOString(),
  });
}

// =============================================================================
// OIDC Provider Tests
// =============================================================================

describe("OIDCProvider", () => {
  it("should construct with config", () => {
    const config = makeSSOConfig();
    const provider = new OIDCProvider(config);
    expect(provider.getIssuerUrl()).toBe("https://idp.example.com");
  });

  describe("decodeIdToken", () => {
    it("should decode a valid 3-part JWT", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      const payload = {
        iss: "https://idp.example.com",
        sub: "user-123",
        aud: "test-client-id",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: "user@example.com",
        name: "Test User",
        groups: ["Engineering", "Platform"],
      };

      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
        "base64url",
      );
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const idToken = `${header}.${payloadB64}.fake-signature`;

      const claims = provider.decodeIdToken(idToken);
      expect(claims.sub).toBe("user-123");
      expect(claims.email).toBe("user@example.com");
      expect(claims.name).toBe("Test User");
      expect(claims.groups).toEqual(["Engineering", "Platform"]);
    });

    it("should reject token with wrong issuer", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      const payload = {
        iss: "https://evil.example.com",
        sub: "user-123",
        aud: "test-client-id",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const idToken = `${header}.${payloadB64}.sig`;

      expect(() => provider.decodeIdToken(idToken)).toThrow(OIDCError);
      expect(() => provider.decodeIdToken(idToken)).toThrow("issuer mismatch");
    });

    it("should reject token with wrong audience", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      const payload = {
        iss: "https://idp.example.com",
        sub: "user-123",
        aud: "wrong-client-id",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const idToken = `${header}.${payloadB64}.sig`;

      expect(() => provider.decodeIdToken(idToken)).toThrow("audience mismatch");
    });

    it("should reject expired token", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      const payload = {
        iss: "https://idp.example.com",
        sub: "user-123",
        aud: "test-client-id",
        exp: Math.floor(Date.now() / 1000) - 120, // expired 2 min ago
        iat: Math.floor(Date.now() / 1000) - 7200,
      };

      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const idToken = `${header}.${payloadB64}.sig`;

      expect(() => provider.decodeIdToken(idToken)).toThrow("expired");
    });

    it("should reject malformed token", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      expect(() => provider.decodeIdToken("not-a-jwt")).toThrow("expected 3 JWT parts");
      expect(() => provider.decodeIdToken("a.b")).toThrow("expected 3 JWT parts");
    });
  });

  describe("resolveUser", () => {
    it("should map IdP groups to Espada roles", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      const claims = {
        iss: "https://idp.example.com",
        sub: "user-123",
        aud: "test-client-id",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: "engineer@company.com",
        name: "Engineer",
        groups: ["Engineering", "SRE"],
      };

      const user = provider.resolveUser(claims);
      expect(user.id).toBe("user-123");
      expect(user.email).toBe("engineer@company.com");
      expect(user.roles).toContain("developer");
      expect(user.roles).toContain("operator");
      expect(user.groups).toEqual(["Engineering", "SRE"]);
    });

    it("should default to viewer when no groups match", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      const claims = {
        iss: "https://idp.example.com",
        sub: "user-456",
        aud: "test-client-id",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: "guest@company.com",
        groups: ["UnknownGroup"],
      };

      const user = provider.resolveUser(claims);
      expect(user.roles).toEqual(["viewer"]);
    });

    it("should handle missing groups claim", () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      const claims = {
        iss: "https://idp.example.com",
        sub: "user-789",
        aud: "test-client-id",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: "nogroups@company.com",
      };

      const user = provider.resolveUser(claims);
      expect(user.roles).toEqual(["viewer"]);
    });
  });

  describe("getAuthorizationUrl", () => {
    it("should build proper authorization URL", async () => {
      const config = makeSSOConfig();
      const provider = new OIDCProvider(config);

      // Mock discovery
      (provider as any).discoveryDoc = {
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        userinfo_endpoint: "https://idp.example.com/userinfo",
        jwks_uri: "https://idp.example.com/.well-known/jwks.json",
        scopes_supported: ["openid", "profile", "email"],
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
      };
      (provider as any).discoveryFetchedAt = Date.now();

      const url = await provider.getAuthorizationUrl("state-123", "nonce-456");
      expect(url).toContain("https://idp.example.com/authorize");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("state=state-123");
      expect(url).toContain("nonce=nonce-456");
      expect(url).toContain("scope=openid+profile+email");
    });
  });
});

// =============================================================================
// Session Store Tests
// =============================================================================

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it("should save and retrieve a session", async () => {
    const session = makeSession({ id: "s1" });
    await store.save(session);

    const retrieved = await store.get("s1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.userId).toBe("user-1");
    expect(retrieved!.email).toBe("user@example.com");
  });

  it("should return null for non-existent session", async () => {
    const result = await store.get("non-existent");
    expect(result).toBeNull();
  });

  it("should auto-expire sessions on get", async () => {
    const expired = makeExpiredSession();
    await store.save(expired);

    const result = await store.get(expired.id);
    expect(result).toBeNull();
  });

  it("should delete a session", async () => {
    const session = makeSession({ id: "s2" });
    await store.save(session);
    await store.delete("s2");

    const result = await store.get("s2");
    expect(result).toBeNull();
  });

  it("should list active sessions", async () => {
    await store.save(makeSession({ id: "s1", userId: "u1" }));
    await store.save(makeSession({ id: "s2", userId: "u2" }));
    await store.save(makeExpiredSession());

    const active = await store.listActive();
    expect(active.length).toBe(2);
  });

  it("should get user sessions", async () => {
    await store.save(makeSession({ id: "s1", userId: "u1" }));
    await store.save(makeSession({ id: "s2", userId: "u1" }));
    await store.save(makeSession({ id: "s3", userId: "u2" }));

    const userSessions = await store.getUserSessions("u1");
    expect(userSessions.length).toBe(2);
  });

  it("should delete all user sessions", async () => {
    await store.save(makeSession({ id: "s1", userId: "u1" }));
    await store.save(makeSession({ id: "s2", userId: "u1" }));
    await store.save(makeSession({ id: "s3", userId: "u2" }));

    await store.deleteUserSessions("u1");

    const remaining = await store.listActive();
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.userId).toBe("u2");
  });

  it("should prune expired sessions", async () => {
    await store.save(makeSession({ id: "s1" }));
    await store.save(makeExpiredSession());

    const pruned = await store.prune();
    expect(pruned).toBe(1);

    const remaining = await store.listActive();
    expect(remaining.length).toBe(1);
  });
});

// =============================================================================
// Session Token Tests
// =============================================================================

describe("Session Tokens", () => {
  it("should create and decode a session token", () => {
    const session = makeSession({ id: "test-sid", userId: "user-abc" });
    const token = createSessionToken(session);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = decodeSessionToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sessionId).toBe("test-sid");
    expect(decoded!.userId).toBe("user-abc");
    expect(decoded!.expired).toBe(false);
  });

  it("should detect expired tokens", () => {
    const expired = makeExpiredSession();
    const token = createSessionToken(expired);

    const decoded = decodeSessionToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.expired).toBe(true);
  });

  it("should return null for malformed tokens", () => {
    expect(decodeSessionToken("not-valid")).toBeNull();
    expect(decodeSessionToken("")).toBeNull();
  });
});

// =============================================================================
// Session Manager Tests
// =============================================================================

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(new InMemorySessionStore());
  });

  it("should create and validate a session", async () => {
    const session = makeSession({ id: "sm-1" });
    const { token } = await manager.createSession(session);

    const validated = await manager.validateToken(token);
    expect(validated).not.toBeNull();
    expect(validated!.id).toBe("sm-1");
  });

  it("should reject expired session tokens", async () => {
    const expired = makeExpiredSession();
    const token = createSessionToken(expired);

    const validated = await manager.validateToken(token);
    expect(validated).toBeNull();
  });

  it("should end a session", async () => {
    const session = makeSession({ id: "sm-2" });
    const { token } = await manager.createSession(session);

    await manager.endSession("sm-2");

    const validated = await manager.validateToken(token);
    expect(validated).toBeNull();
  });

  it("should provide session summary", async () => {
    await manager.createSession(makeSession({ id: "s1", userId: "u1", email: "u1@ex.com" }));
    await manager.createSession(makeSession({ id: "s2", userId: "u1", email: "u1@ex.com" }));
    await manager.createSession(makeSession({ id: "s3", userId: "u2", email: "u2@ex.com" }));

    const summary = await manager.getSummary();
    expect(summary.activeSessions).toBe(3);
    expect(summary.users.length).toBe(2);
    expect(summary.users.find((u) => u.userId === "u1")?.sessionCount).toBe(2);
  });
});

// =============================================================================
// RBAC Manager Tests
// =============================================================================

describe("GatewayRBACManager", () => {
  let rbac: GatewayRBACManager;

  beforeEach(async () => {
    const storage = new InMemoryRBACStorage();
    rbac = new GatewayRBACManager(storage);
    await rbac.initialize();
  });

  describe("Role Management", () => {
    it("should list built-in roles", async () => {
      const roles = await rbac.listRoles();
      expect(roles.length).toBe(BUILT_IN_ROLES.length);
      expect(roles.map((r) => r.id)).toContain("admin");
      expect(roles.map((r) => r.id)).toContain("operator");
      expect(roles.map((r) => r.id)).toContain("developer");
      expect(roles.map((r) => r.id)).toContain("viewer");
      expect(roles.map((r) => r.id)).toContain("auditor");
    });

    it("should get a role by ID", async () => {
      const admin = await rbac.getRole("admin");
      expect(admin).not.toBeNull();
      expect(admin!.name).toBe("Administrator");
      expect(admin!.builtIn).toBe(true);
      expect(admin!.permissions).toContain("operator.admin");
    });

    it("should return null for non-existent role", async () => {
      const result = await rbac.getRole("nonexistent");
      expect(result).toBeNull();
    });

    it("should create a custom role", async () => {
      const custom = await rbac.createRole({
        id: "security-lead",
        name: "Security Lead",
        description: "Security team lead role",
        permissions: [
          "policy.read",
          "policy.write",
          "compliance.scan",
          "audit.read",
          "audit.export",
        ],
      });

      expect(custom.builtIn).toBe(false);
      expect(custom.permissions.length).toBe(5);

      const retrieved = await rbac.getRole("security-lead");
      expect(retrieved).not.toBeNull();
    });

    it("should reject duplicate role creation", async () => {
      await expect(
        rbac.createRole({
          id: "admin",
          name: "Duplicate Admin",
          description: "Should fail",
          permissions: [],
        }),
      ).rejects.toThrow("already exists");
    });

    it("should delete custom roles but not built-in", async () => {
      await rbac.createRole({
        id: "temp-role",
        name: "Temporary",
        description: "Temp",
        permissions: ["operator.read"],
      });

      expect(await rbac.deleteRole("temp-role")).toBe(true);
      expect(await rbac.getRole("temp-role")).toBeNull();

      // Built-in roles cannot be deleted
      expect(await rbac.deleteRole("admin")).toBe(false);
    });
  });

  describe("Role Assignment", () => {
    it("should assign and retrieve roles", async () => {
      await rbac.assignRole("user-1", "user1@example.com", "developer", "admin");

      const roles = await rbac.getUserRoles("user-1");
      expect(roles.length).toBe(1);
      expect(roles[0]!.id).toBe("developer");
    });

    it("should assign multiple roles", async () => {
      await rbac.assignRole("user-1", "user1@example.com", "developer", "admin");
      await rbac.assignRole("user-1", "user1@example.com", "auditor", "admin");

      const roles = await rbac.getUserRoles("user-1");
      expect(roles.length).toBe(2);
      expect(roles.map((r) => r.id)).toContain("developer");
      expect(roles.map((r) => r.id)).toContain("auditor");
    });

    it("should reject assignment of non-existent role", async () => {
      await expect(
        rbac.assignRole("user-1", "user1@example.com", "nonexistent", "admin"),
      ).rejects.toThrow("not found");
    });

    it("should remove a role assignment", async () => {
      await rbac.assignRole("user-1", "user1@example.com", "developer", "admin");
      expect(await rbac.removeRole("user-1", "developer")).toBe(true);

      const roles = await rbac.getUserRoles("user-1");
      expect(roles.length).toBe(0);
    });

    it("should list all assignments", async () => {
      await rbac.assignRole("u1", "u1@ex.com", "admin", "system");
      await rbac.assignRole("u2", "u2@ex.com", "developer", "system");

      const assignments = await rbac.listAssignments();
      expect(assignments.length).toBe(2);
    });
  });

  describe("Permission Checking", () => {
    it("should allow admin all permissions", async () => {
      await rbac.assignRole("admin-user", "admin@ex.com", "admin", "system");

      const result = await rbac.checkPermission("admin-user", "terraform.apply");
      expect(result.allowed).toBe(true);
      expect(result.grantedBy).toContain("admin");
    });

    it("should deny unassigned permissions", async () => {
      await rbac.assignRole("viewer-user", "viewer@ex.com", "viewer", "system");

      const result = await rbac.checkPermission("viewer-user", "terraform.apply");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("should allow operator terraform.apply", async () => {
      await rbac.assignRole("op-user", "op@ex.com", "operator", "system");

      const result = await rbac.checkPermission("op-user", "terraform.apply");
      expect(result.allowed).toBe(true);
    });

    it("should deny developer terraform.apply", async () => {
      await rbac.assignRole("dev-user", "dev@ex.com", "developer", "system");

      const result = await rbac.checkPermission("dev-user", "terraform.apply");
      expect(result.allowed).toBe(false);
    });

    it("should deny users with no roles", async () => {
      const result = await rbac.checkPermission("unknown-user", "operator.read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No roles assigned");
    });

    it("should check any permission", async () => {
      await rbac.assignRole("dev-user", "dev@ex.com", "developer", "system");

      const result = await rbac.checkAnyPermission("dev-user", [
        "terraform.apply",
        "terraform.plan",
      ]);
      expect(result.allowed).toBe(true); // developer has terraform.plan
    });

    it("should check all permissions", async () => {
      await rbac.assignRole("dev-user", "dev@ex.com", "developer", "system");

      const result = await rbac.checkAllPermissions("dev-user", [
        "terraform.plan",
        "terraform.apply",
      ]);
      expect(result.allowed).toBe(false); // developer lacks terraform.apply
    });
  });

  describe("Permission Resolution", () => {
    it("should resolve all permissions for a user", async () => {
      await rbac.assignRole("user-1", "u@ex.com", "developer", "system");

      const perms = await rbac.resolvePermissions("user-1");
      expect(perms).toContain("operator.read");
      expect(perms).toContain("terraform.plan");
      expect(perms).not.toContain("terraform.apply");
    });

    it("should union permissions from multiple roles", async () => {
      await rbac.assignRole("user-1", "u@ex.com", "developer", "system");
      await rbac.assignRole("user-1", "u@ex.com", "auditor", "system");

      const perms = await rbac.resolvePermissions("user-1");
      expect(perms).toContain("audit.export"); // from auditor
      expect(perms).toContain("terraform.plan"); // from developer
    });
  });

  describe("Group to Role Mapping", () => {
    it("should map IdP groups to roles", () => {
      const mapping = {
        Engineering: "developer",
        SRE: "operator",
        Platform: "admin",
      };

      const roles = rbac.resolveRolesFromGroups(["Engineering", "SRE"], mapping);
      expect(roles).toContain("developer");
      expect(roles).toContain("operator");
    });

    it("should default to viewer for unmatched groups", () => {
      const mapping = { Marketing: "viewer" };
      const roles = rbac.resolveRolesFromGroups(["Unknown"], mapping);
      expect(roles).toEqual(["viewer"]);
    });
  });

  describe("User Summary", () => {
    it("should return user summary with permission counts", async () => {
      await rbac.assignRole("u1", "u1@ex.com", "admin", "system");
      await rbac.assignRole("u2", "u2@ex.com", "developer", "system");

      const summary = await rbac.getUserSummary();
      expect(summary.length).toBe(2);

      const admin = summary.find((u) => u.userId === "u1");
      expect(admin).toBeDefined();
      expect(admin!.roles).toContain("admin");
      expect(admin!.permissions).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// SSO Tools Tests
// =============================================================================

describe("SSO/RBAC Agent Tools", () => {
  let rbac: GatewayRBACManager;
  let sessionManager: SessionManager;
  let tools: ReturnType<typeof createSSOTools>;

  beforeEach(async () => {
    const rbacStorage = new InMemoryRBACStorage();
    rbac = new GatewayRBACManager(rbacStorage);
    await rbac.initialize();

    sessionManager = new SessionManager(new InMemorySessionStore());
    tools = createSSOTools(rbac, sessionManager);
  });

  it("should create 4 tools", () => {
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name)).toEqual([
      "rbac_check_permission",
      "rbac_list_roles",
      "rbac_user_permissions",
      "sso_sessions",
    ]);
  });

  it("rbac_check_permission should check user permission", async () => {
    await rbac.assignRole("user-1", "u1@ex.com", "operator", "system");

    const tool = tools.find((t) => t.name === "rbac_check_permission")!;
    const result = await tool.execute("call-1", {
      userId: "user-1",
      permission: "terraform.apply",
    });

    expect(result.content[0]!.text).toContain("ALLOWED");
    expect(result.details?.allowed).toBe(true);
  });

  it("rbac_list_roles should list all roles", async () => {
    const tool = tools.find((t) => t.name === "rbac_list_roles")!;
    const result = await tool.execute("call-2", {});

    expect(result.content[0]!.text).toContain("admin");
    expect(result.content[0]!.text).toContain("operator");
    expect(result.content[0]!.text).toContain("developer");
  });

  it("rbac_user_permissions should show user permissions", async () => {
    await rbac.assignRole("user-1", "u1@ex.com", "developer", "system");

    const tool = tools.find((t) => t.name === "rbac_user_permissions")!;
    const result = await tool.execute("call-3", { userId: "user-1" });

    expect(result.content[0]!.text).toContain("developer");
    expect(result.details?.permissionCount).toBeGreaterThan(0);
  });

  it("sso_sessions should list sessions", async () => {
    const session = makeSession({ id: "test-session" });
    await sessionManager.createSession(session);

    const tool = tools.find((t) => t.name === "sso_sessions")!;
    const result = await tool.execute("call-4", {});

    expect(result.content[0]!.text).toContain("1");
    expect(result.details?.activeSessions).toBe(1);
  });
});
