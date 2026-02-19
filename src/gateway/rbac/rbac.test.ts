/**
 * RBAC — Unit Tests
 *
 * Tests for role definitions, role assignments, permission checking,
 * file-based storage, and SSO group mapping.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GatewayRBACManager, InMemoryRBACStorage, FileRBACStorage } from "./manager.js";
import { BUILT_IN_ROLES } from "./types.js";
import type { Permission, RoleDefinition, RoleAssignment } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

async function createManager(): Promise<GatewayRBACManager> {
  const storage = new InMemoryRBACStorage();
  const manager = new GatewayRBACManager(storage);
  await manager.initialize();
  return manager;
}

function makeAssignment(overrides?: Partial<RoleAssignment>): RoleAssignment {
  return {
    userId: "user-1",
    userEmail: "user@example.com",
    roleId: "developer",
    assignedAt: new Date().toISOString(),
    assignedBy: "admin-1",
    expiresAt: null,
    ...overrides,
  };
}

// =============================================================================
// Built-in Roles
// =============================================================================

describe("Built-in Roles", () => {
  it("should define 5 built-in roles", () => {
    expect(BUILT_IN_ROLES).toHaveLength(5);
  });

  it("should include admin, operator, developer, viewer, auditor", () => {
    const ids = BUILT_IN_ROLES.map((r) => r.id);
    expect(ids).toContain("admin");
    expect(ids).toContain("operator");
    expect(ids).toContain("developer");
    expect(ids).toContain("viewer");
    expect(ids).toContain("auditor");
  });

  it("should mark all built-in roles as builtIn", () => {
    for (const role of BUILT_IN_ROLES) {
      expect(role.builtIn).toBe(true);
    }
  });

  it("admin should have operator.admin permission", () => {
    const admin = BUILT_IN_ROLES.find((r) => r.id === "admin")!;
    expect(admin.permissions).toContain("operator.admin");
  });

  it("developer should have environment restrictions", () => {
    const dev = BUILT_IN_ROLES.find((r) => r.id === "developer")!;
    expect(dev.environments).toEqual(["development", "staging"]);
  });

  it("viewer should have read-only permissions", () => {
    const viewer = BUILT_IN_ROLES.find((r) => r.id === "viewer")!;
    const writePerms = viewer.permissions.filter(
      (p) => p.includes(".write") || p.includes(".manage") || p.includes(".apply"),
    );
    expect(writePerms).toHaveLength(0);
  });

  it("auditor should have audit.export permission", () => {
    const auditor = BUILT_IN_ROLES.find((r) => r.id === "auditor")!;
    expect(auditor.permissions).toContain("audit.export");
  });
});

// =============================================================================
// InMemoryRBACStorage
// =============================================================================

describe("InMemoryRBACStorage", () => {
  let storage: InMemoryRBACStorage;

  beforeEach(async () => {
    storage = new InMemoryRBACStorage();
    await storage.initialize();
  });

  it("should initialize with built-in roles", async () => {
    const roles = await storage.getRoles();
    expect(roles.length).toBeGreaterThanOrEqual(5);
  });

  it("should get a built-in role by ID", async () => {
    const role = await storage.getRole("admin");
    expect(role).not.toBeNull();
    expect(role!.name).toBe("Administrator");
  });

  it("should return null for unknown role", async () => {
    const role = await storage.getRole("nonexistent");
    expect(role).toBeNull();
  });

  it("should save a custom role", async () => {
    const custom: RoleDefinition = {
      id: "custom-sre",
      name: "Custom SRE",
      description: "A custom SRE role",
      permissions: ["operator.read", "operator.write", "terraform.plan"],
      builtIn: false,
    };
    await storage.saveRole(custom);
    const retrieved = await storage.getRole("custom-sre");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("Custom SRE");
  });

  it("should not delete built-in roles", async () => {
    const deleted = await storage.deleteRole("admin");
    expect(deleted).toBe(false);
    const role = await storage.getRole("admin");
    expect(role).not.toBeNull();
  });

  it("should delete custom roles", async () => {
    await storage.saveRole({
      id: "temp",
      name: "Temp",
      description: "temp",
      permissions: ["operator.read"],
      builtIn: false,
    });
    const deleted = await storage.deleteRole("temp");
    expect(deleted).toBe(true);
    const role = await storage.getRole("temp");
    expect(role).toBeNull();
  });

  it("should assign and retrieve role assignments", async () => {
    const assignment = makeAssignment();
    await storage.assignRole(assignment);
    const assignments = await storage.getAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0].userId).toBe("user-1");
  });

  it("should get user-specific assignments", async () => {
    await storage.assignRole(makeAssignment({ userId: "a", roleId: "admin" }));
    await storage.assignRole(makeAssignment({ userId: "b", roleId: "viewer" }));
    await storage.assignRole(makeAssignment({ userId: "a", roleId: "developer" }));

    const assignmentsA = await storage.getUserAssignments("a");
    expect(assignmentsA).toHaveLength(2);

    const assignmentsB = await storage.getUserAssignments("b");
    expect(assignmentsB).toHaveLength(1);
  });

  it("should replace duplicate user+role assignment", async () => {
    await storage.assignRole(makeAssignment({ userId: "u1", roleId: "admin" }));
    await storage.assignRole(makeAssignment({ userId: "u1", roleId: "admin" }));

    const assignments = await storage.getUserAssignments("u1");
    expect(assignments).toHaveLength(1);
  });

  it("should remove assignments", async () => {
    await storage.assignRole(makeAssignment({ userId: "u1", roleId: "admin" }));
    const removed = await storage.removeAssignment("u1", "admin");
    expect(removed).toBe(true);

    const remaining = await storage.getUserAssignments("u1");
    expect(remaining).toHaveLength(0);
  });

  it("should return false when removing non-existent assignment", async () => {
    const removed = await storage.removeAssignment("nobody", "admin");
    expect(removed).toBe(false);
  });
});

// =============================================================================
// GatewayRBACManager — Role Management
// =============================================================================

describe("GatewayRBACManager — Roles", () => {
  let manager: GatewayRBACManager;

  beforeEach(async () => {
    manager = await createManager();
  });

  it("should list all built-in roles", async () => {
    const roles = await manager.listRoles();
    expect(roles.length).toBeGreaterThanOrEqual(5);
  });

  it("should get a role by ID", async () => {
    const role = await manager.getRole("operator");
    expect(role).not.toBeNull();
    expect(role!.id).toBe("operator");
  });

  it("should create a custom role", async () => {
    const role = await manager.createRole({
      id: "security-lead",
      name: "Security Lead",
      description: "Security team lead with audit + compliance",
      permissions: ["audit.read", "audit.export", "compliance.read", "compliance.scan"],
    });
    expect(role.id).toBe("security-lead");
    expect(role.builtIn).toBe(false);
  });

  it("should throw when creating duplicate role", async () => {
    await manager.createRole({
      id: "unique",
      name: "Unique",
      description: "unique",
      permissions: ["operator.read"],
    });
    await expect(
      manager.createRole({
        id: "unique",
        name: "Unique 2",
        description: "unique 2",
        permissions: ["operator.read"],
      }),
    ).rejects.toThrow('Role "unique" already exists');
  });

  it("should delete a custom role", async () => {
    await manager.createRole({
      id: "to-delete",
      name: "ToDelete",
      description: "will be deleted",
      permissions: [],
    });
    const deleted = await manager.deleteRole("to-delete");
    expect(deleted).toBe(true);
  });

  it("should not delete built-in roles", async () => {
    const deleted = await manager.deleteRole("admin");
    expect(deleted).toBe(false);
  });
});

// =============================================================================
// GatewayRBACManager — Assignment
// =============================================================================

describe("GatewayRBACManager — Assignments", () => {
  let manager: GatewayRBACManager;

  beforeEach(async () => {
    manager = await createManager();
  });

  it("should assign a role to a user", async () => {
    const assignment = await manager.assignRole(
      "user-1",
      "user@example.com",
      "developer",
      "admin-1",
    );
    expect(assignment.userId).toBe("user-1");
    expect(assignment.roleId).toBe("developer");
  });

  it("should throw when assigning non-existent role", async () => {
    await expect(
      manager.assignRole("user-1", "user@example.com", "nonexistent", "admin-1"),
    ).rejects.toThrow('Role "nonexistent" not found');
  });

  it("should remove a role from a user", async () => {
    await manager.assignRole("user-1", "user@example.com", "developer", "admin-1");
    const removed = await manager.removeRole("user-1", "developer");
    expect(removed).toBe(true);
  });

  it("should get user roles", async () => {
    await manager.assignRole("user-1", "user@example.com", "developer", "admin-1");
    await manager.assignRole("user-1", "user@example.com", "viewer", "admin-1");

    const roles = await manager.getUserRoles("user-1");
    expect(roles).toHaveLength(2);
    const ids = roles.map((r) => r.id);
    expect(ids).toContain("developer");
    expect(ids).toContain("viewer");
  });

  it("should filter expired assignments", async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    await manager.assignRole("user-1", "user@example.com", "admin", "admin-1", past);

    const roles = await manager.getUserRoles("user-1");
    expect(roles).toHaveLength(0);
  });

  it("should keep non-expired assignments", async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    await manager.assignRole("user-1", "user@example.com", "admin", "admin-1", future);

    const roles = await manager.getUserRoles("user-1");
    expect(roles).toHaveLength(1);
  });

  it("should list all assignments", async () => {
    await manager.assignRole("a", "a@test.com", "admin", "root");
    await manager.assignRole("b", "b@test.com", "developer", "root");

    const all = await manager.listAssignments();
    expect(all).toHaveLength(2);
  });
});

// =============================================================================
// GatewayRBACManager — Permission Checking
// =============================================================================

describe("GatewayRBACManager — Permissions", () => {
  let manager: GatewayRBACManager;

  beforeEach(async () => {
    manager = await createManager();
  });

  it("should deny when user has no roles", async () => {
    const result = await manager.checkPermission("unknown", "operator.read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No roles assigned");
  });

  it("should grant admin full access via operator.admin", async () => {
    await manager.assignRole("admin-user", "admin@test.com", "admin", "root");
    const result = await manager.checkPermission("admin-user", "terraform.apply");
    expect(result.allowed).toBe(true);
    expect(result.grantedBy).toContain("admin");
  });

  it("should grant matching permissions", async () => {
    await manager.assignRole("dev", "dev@test.com", "developer", "admin");
    const result = await manager.checkPermission("dev", "terraform.plan");
    expect(result.allowed).toBe(true);
  });

  it("should deny non-matching permissions", async () => {
    await manager.assignRole("dev", "dev@test.com", "developer", "admin");
    const result = await manager.checkPermission("dev", "terraform.apply");
    expect(result.allowed).toBe(false);
  });

  it("should check any permission (OR)", async () => {
    await manager.assignRole("dev", "dev@test.com", "developer", "admin");
    const result = await manager.checkAnyPermission("dev", ["terraform.apply", "terraform.plan"]);
    expect(result.allowed).toBe(true);
  });

  it("should fail any permission if none match", async () => {
    await manager.assignRole("viewer", "v@test.com", "viewer", "admin");
    const result = await manager.checkAnyPermission("viewer", ["terraform.apply", "config.write"]);
    expect(result.allowed).toBe(false);
  });

  it("should check all permissions (AND)", async () => {
    await manager.assignRole("op", "op@test.com", "operator", "admin");
    const result = await manager.checkAllPermissions("op", [
      "terraform.plan",
      "terraform.apply",
      "graph.read",
    ]);
    expect(result.allowed).toBe(true);
  });

  it("should fail all permissions if any missing", async () => {
    await manager.assignRole("dev", "dev@test.com", "developer", "admin");
    const result = await manager.checkAllPermissions("dev", [
      "terraform.plan",
      "terraform.apply", // developer lacks this
    ]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("terraform.apply");
  });

  it("should resolve all permissions for a user", async () => {
    await manager.assignRole("user", "u@test.com", "developer", "admin");
    const perms = await manager.resolvePermissions("user");
    expect(perms).toContain("operator.read");
    expect(perms).toContain("terraform.plan");
    expect(perms).not.toContain("terraform.apply");
  });

  it("should union permissions from multiple roles", async () => {
    await manager.assignRole("user", "u@test.com", "developer", "admin");
    await manager.assignRole("user", "u@test.com", "auditor", "admin");

    const perms = await manager.resolvePermissions("user");
    expect(perms).toContain("audit.export"); // from auditor
    expect(perms).toContain("terraform.plan"); // from developer
  });
});

// =============================================================================
// GatewayRBACManager — SSO Group Mapping
// =============================================================================

describe("GatewayRBACManager — Group Mapping", () => {
  let manager: GatewayRBACManager;

  beforeEach(async () => {
    manager = await createManager();
  });

  it("should map IdP groups to Espada roles", () => {
    const mapping: Record<string, string> = {
      Engineering: "developer",
      SRE: "operator",
      Platform: "admin",
    };

    const roles = manager.resolveRolesFromGroups(["Engineering", "SRE"], mapping);
    expect(roles).toContain("developer");
    expect(roles).toContain("operator");
    expect(roles).not.toContain("admin");
  });

  it("should default to viewer if no groups match", () => {
    const roles = manager.resolveRolesFromGroups(["UnknownGroup"], { Engineering: "developer" });
    expect(roles).toEqual(["viewer"]);
  });

  it("should deduplicate roles from multiple groups", () => {
    const mapping: Record<string, string> = {
      TeamA: "developer",
      TeamB: "developer",
    };
    const roles = manager.resolveRolesFromGroups(["TeamA", "TeamB"], mapping);
    expect(roles).toEqual(["developer"]);
  });

  it("should handle empty group list", () => {
    const roles = manager.resolveRolesFromGroups([], { Engineering: "developer" });
    expect(roles).toEqual(["viewer"]);
  });
});

// =============================================================================
// GatewayRBACManager — User Summary
// =============================================================================

describe("GatewayRBACManager — User Summary", () => {
  let manager: GatewayRBACManager;

  beforeEach(async () => {
    manager = await createManager();
  });

  it("should return empty summary with no assignments", async () => {
    const summary = await manager.getUserSummary();
    expect(summary).toHaveLength(0);
  });

  it("should summarize users with roles and permission counts", async () => {
    await manager.assignRole("u1", "u1@test.com", "admin", "root");
    await manager.assignRole("u2", "u2@test.com", "viewer", "root");

    const summary = await manager.getUserSummary();
    expect(summary).toHaveLength(2);

    const adminUser = summary.find((s) => s.userId === "u1")!;
    expect(adminUser.roles).toContain("admin");
    expect(adminUser.permissions).toBeGreaterThan(0);

    const viewerUser = summary.find((s) => s.userId === "u2")!;
    expect(viewerUser.roles).toContain("viewer");
    expect(viewerUser.permissions).toBeLessThan(adminUser.permissions);
  });

  it("should aggregate multiple roles per user", async () => {
    await manager.assignRole("u1", "u1@test.com", "developer", "root");
    await manager.assignRole("u1", "u1@test.com", "auditor", "root");

    const summary = await manager.getUserSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].roles).toHaveLength(2);
  });
});
