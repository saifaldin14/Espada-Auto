/**
 * Enterprise Auth — Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAuthStorage } from "./storage.js";
import { RbacEngine, generateApiKey, hashApiKey, generateSessionId } from "./rbac.js";
import type { User, Role, Permission } from "./types.js";
import { BUILT_IN_ROLES } from "./types.js";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    roles: ["viewer"],
    mfaEnabled: false,
    disabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── RBAC Engine ──────────────────────────────────────────────────

describe("RbacEngine", () => {
  let storage: InMemoryAuthStorage;
  let rbac: RbacEngine;

  beforeEach(async () => {
    storage = new InMemoryAuthStorage();
    await storage.initialize();
    rbac = new RbacEngine(storage);
    await rbac.initializeBuiltInRoles();
  });

  it("initializes built-in roles", async () => {
    const roles = await storage.listRoles();
    expect(roles.length).toBe(BUILT_IN_ROLES.length);
  });

  it("grants permissions from assigned role", async () => {
    const user = makeUser({ roles: ["viewer"] });
    const result = await rbac.authorize(user, "infra.read");
    expect(result.allowed).toBe(true);
  });

  it("denies permissions not in role", async () => {
    const user = makeUser({ roles: ["viewer"] });
    const result = await rbac.authorize(user, "terraform.apply");
    expect(result.allowed).toBe(false);
    expect(result.missingPermissions).toContain("terraform.apply");
  });

  it("denies disabled users", async () => {
    const user = makeUser({ roles: ["admin"], disabled: true });
    const result = await rbac.authorize(user, "infra.read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("disabled");
  });

  it("combines permissions from multiple roles", async () => {
    const user = makeUser({ roles: ["viewer", "operator"] });
    const result = await rbac.authorize(user, "terraform.plan");
    expect(result.allowed).toBe(true);
  });

  it("checks multiple permissions at once", async () => {
    const user = makeUser({ roles: ["operator"] });
    const result = await rbac.authorize(user, ["terraform.plan", "terraform.apply"]);
    expect(result.allowed).toBe(true);
  });

  it("fails when any permission is missing", async () => {
    const user = makeUser({ roles: ["viewer"] });
    const result = await rbac.authorize(user, ["infra.read", "terraform.destroy"]);
    expect(result.allowed).toBe(false);
    expect(result.missingPermissions).toContain("terraform.destroy");
  });

  it("authorizeAny allows if any permission matches", async () => {
    const user = makeUser({ roles: ["viewer"] });
    const result = await rbac.authorizeAny(user, ["terraform.apply", "infra.read"]);
    expect(result.allowed).toBe(true);
  });

  it("authorizeAny denies if no permission matches", async () => {
    const user = makeUser({ roles: ["viewer"] });
    const result = await rbac.authorizeAny(user, ["terraform.apply", "terraform.destroy"]);
    expect(result.allowed).toBe(false);
  });

  it("getUserPermissions returns all permissions", async () => {
    const user = makeUser({ roles: ["admin"] });
    const perms = await rbac.getUserPermissions(user);
    expect(perms.size).toBeGreaterThan(10);
    expect(perms.has("gateway.admin")).toBe(true);
  });

  it("admin has all permissions", async () => {
    const user = makeUser({ roles: ["admin"] });
    const perms = await rbac.getUserPermissions(user);
    expect(perms.has("infra.read")).toBe(true);
    expect(perms.has("infra.admin")).toBe(true);
    expect(perms.has("terraform.destroy")).toBe(true);
    expect(perms.has("user.admin")).toBe(true);
  });

  it("security role has policy and audit permissions", async () => {
    const user = makeUser({ roles: ["security"] });
    const perms = await rbac.getUserPermissions(user);
    expect(perms.has("policy.write")).toBe(true);
    expect(perms.has("audit.export")).toBe(true);
    expect(perms.has("terraform.apply")).toBe(false);
  });
});

// ── Storage ──────────────────────────────────────────────────────

describe("InMemoryAuthStorage", () => {
  let storage: InMemoryAuthStorage;

  beforeEach(async () => {
    storage = new InMemoryAuthStorage();
    await storage.initialize();
  });

  it("saves and retrieves a user", async () => {
    const user = makeUser();
    await storage.saveUser(user);
    const retrieved = await storage.getUser("user-1");
    expect(retrieved?.email).toBe("test@example.com");
  });

  it("finds user by email", async () => {
    await storage.saveUser(makeUser());
    const user = await storage.getUserByEmail("test@example.com");
    expect(user?.id).toBe("user-1");
  });

  it("finds user by external ID", async () => {
    await storage.saveUser(makeUser({ ssoProviderId: "okta", externalId: "ext-123" }));
    const user = await storage.getUserByExternalId("okta", "ext-123");
    expect(user?.id).toBe("user-1");
  });

  it("filters users by role", async () => {
    await storage.saveUser(makeUser({ id: "u1", roles: ["admin"] }));
    await storage.saveUser(makeUser({ id: "u2", email: "b@b.com", roles: ["viewer"] }));
    const admins = await storage.listUsers({ role: "admin" });
    expect(admins).toHaveLength(1);
    expect(admins[0].id).toBe("u1");
  });

  it("deletes a user", async () => {
    await storage.saveUser(makeUser());
    const deleted = await storage.deleteUser("user-1");
    expect(deleted).toBe(true);
    expect(await storage.getUser("user-1")).toBeNull();
  });

  it("manages sessions", async () => {
    const session = {
      id: "sess-1",
      userId: "user-1",
      tokenHash: "abc123",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    await storage.saveSession(session);
    const retrieved = await storage.getSession("sess-1");
    expect(retrieved?.userId).toBe("user-1");
  });

  it("prunes expired sessions", async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    await storage.saveSession({
      id: "s1", userId: "u1", tokenHash: "h1",
      expiresAt: pastDate, createdAt: pastDate, lastActiveAt: pastDate,
    });
    await storage.saveSession({
      id: "s2", userId: "u1", tokenHash: "h2",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
    });
    const pruned = await storage.pruneExpiredSessions();
    expect(pruned).toBe(1);
  });

  it("deletes user sessions", async () => {
    const now = new Date().toISOString();
    await storage.saveSession({ id: "s1", userId: "u1", tokenHash: "h1", expiresAt: now, createdAt: now, lastActiveAt: now });
    await storage.saveSession({ id: "s2", userId: "u1", tokenHash: "h2", expiresAt: now, createdAt: now, lastActiveAt: now });
    const count = await storage.deleteUserSessions("u1");
    expect(count).toBe(2);
  });

  it("manages API keys", async () => {
    const apiKey = {
      id: "key-1",
      name: "Test Key",
      keyHash: "hash123",
      keyPrefix: "esp_abcd",
      userId: "user-1",
      permissions: ["infra.read" as Permission],
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    await storage.saveApiKey(apiKey);
    const retrieved = await storage.getApiKey("key-1");
    expect(retrieved?.name).toBe("Test Key");
    const byHash = await storage.getApiKeyByHash("hash123");
    expect(byHash?.id).toBe("key-1");
  });

  it("lists API keys by user", async () => {
    const now = new Date().toISOString();
    await storage.saveApiKey({ id: "k1", name: "Key 1", keyHash: "h1", keyPrefix: "p1", userId: "u1", permissions: [], disabled: false, createdAt: now });
    await storage.saveApiKey({ id: "k2", name: "Key 2", keyHash: "h2", keyPrefix: "p2", userId: "u2", permissions: [], disabled: false, createdAt: now });
    const keys = await storage.listApiKeys("u1");
    expect(keys).toHaveLength(1);
  });

  it("manages OIDC providers", async () => {
    const now = new Date().toISOString();
    const provider = {
      id: "okta",
      name: "Okta",
      issuerUrl: "https://example.okta.com",
      clientId: "client-id",
      clientSecret: "secret",
      scopes: ["openid", "profile"],
      callbackUrl: "http://localhost:3000/callback",
      roleMappings: [{ claim: "groups", value: "admins", role: "admin" }],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    await storage.saveOidcProvider(provider);
    const retrieved = await storage.getOidcProvider("okta");
    expect(retrieved?.name).toBe("Okta");
    expect(retrieved?.roleMappings).toHaveLength(1);
  });

  it("custom roles work with RBAC", async () => {
    const rbac = new RbacEngine(storage);
    const now = new Date().toISOString();
    const customRole: Role = {
      id: "devops",
      name: "DevOps",
      description: "DevOps team role",
      permissions: ["infra.read", "infra.write", "terraform.plan", "terraform.apply"],
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    await storage.saveRole(customRole);
    const user = makeUser({ roles: ["devops"] });
    const result = await rbac.authorize(user, "terraform.apply");
    expect(result.allowed).toBe(true);
  });
});

// ── Crypto Helpers ───────────────────────────────────────────────

describe("Crypto Helpers", () => {
  it("generateApiKey returns key, prefix, and hash", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key.startsWith("esp_")).toBe(true);
    expect(prefix.length).toBe(12);
    expect(hash.length).toBe(64); // SHA-256 hex
  });

  it("hashApiKey is deterministic", () => {
    const h1 = hashApiKey("test-key");
    const h2 = hashApiKey("test-key");
    expect(h1).toBe(h2);
  });

  it("different keys produce different hashes", () => {
    const h1 = hashApiKey("key-1");
    const h2 = hashApiKey("key-2");
    expect(h1).not.toBe(h2);
  });

  it("generateSessionId produces unique IDs", () => {
    const s1 = generateSessionId();
    const s2 = generateSessionId();
    expect(s1).not.toBe(s2);
    expect(s1.length).toBeGreaterThan(10);
  });
});

// ── Built-in Roles ───────────────────────────────────────────────

describe("Built-in Roles", () => {
  it("has expected built-in roles", () => {
    const ids = BUILT_IN_ROLES.map((r) => r.id);
    expect(ids).toContain("viewer");
    expect(ids).toContain("operator");
    expect(ids).toContain("admin");
    expect(ids).toContain("security");
  });

  it("viewer has read-only permissions", () => {
    const viewer = BUILT_IN_ROLES.find((r) => r.id === "viewer")!;
    expect(viewer.permissions.every((p) => p.includes("read"))).toBe(true);
  });

  it("admin has all permissions", () => {
    const admin = BUILT_IN_ROLES.find((r) => r.id === "admin")!;
    expect(admin.permissions.length).toBeGreaterThan(20);
    expect(admin.permissions).toContain("gateway.admin");
  });

  it("all built-in roles are marked as builtIn", () => {
    for (const role of BUILT_IN_ROLES) {
      expect(role.builtIn).toBe(true);
    }
  });
});
