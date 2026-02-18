/**
 * Enterprise RBAC — Manager
 *
 * Central RBAC manager that handles role definitions, role assignments,
 * and permission checks. Integrates with both SSO (IdP groups → roles)
 * and local auth (manual role assignment).
 *
 * Replaces the infrastructure extension's in-memory RBAC with a
 * persistent, gateway-level system.
 */

import type {
  Permission,
  RoleDefinition,
  RoleAssignment,
  RBACStorage,
  PermissionCheckResult,
} from "./types.js";
import { BUILT_IN_ROLES } from "./types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// In-Memory RBAC Storage (dev/test)
// =============================================================================

export class InMemoryRBACStorage implements RBACStorage {
  private roles = new Map<string, RoleDefinition>();
  private assignments: RoleAssignment[] = [];

  async initialize(): Promise<void> {
    for (const role of BUILT_IN_ROLES) {
      this.roles.set(role.id, { ...role });
    }
  }

  async getRoles(): Promise<RoleDefinition[]> {
    return [...this.roles.values()];
  }

  async getRole(roleId: string): Promise<RoleDefinition | null> {
    return this.roles.get(roleId) ?? null;
  }

  async saveRole(role: RoleDefinition): Promise<void> {
    this.roles.set(role.id, { ...role });
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const role = this.roles.get(roleId);
    if (!role || role.builtIn) return false;
    this.roles.delete(roleId);
    return true;
  }

  async getAssignments(): Promise<RoleAssignment[]> {
    return [...this.assignments];
  }

  async getUserAssignments(userId: string): Promise<RoleAssignment[]> {
    return this.assignments.filter((a) => a.userId === userId);
  }

  async assignRole(assignment: RoleAssignment): Promise<void> {
    // Remove existing assignment for same user+role if present
    this.assignments = this.assignments.filter(
      (a) => !(a.userId === assignment.userId && a.roleId === assignment.roleId),
    );
    this.assignments.push({ ...assignment });
  }

  async removeAssignment(userId: string, roleId: string): Promise<boolean> {
    const before = this.assignments.length;
    this.assignments = this.assignments.filter(
      (a) => !(a.userId === userId && a.roleId === roleId),
    );
    return this.assignments.length < before;
  }
}

// =============================================================================
// File-Based RBAC Storage (production)
// =============================================================================

type RBACFileData = {
  customRoles: RoleDefinition[];
  assignments: RoleAssignment[];
};

/**
 * Persists roles and assignments to `~/.espada/rbac.json`.
 * Built-in roles are always loaded from code; only custom roles are persisted.
 */
export class FileRBACStorage implements RBACStorage {
  private filePath: string;
  private customRoles = new Map<string, RoleDefinition>();
  private assignments: RoleAssignment[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const raw = readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as RBACFileData;

      for (const role of data.customRoles ?? []) {
        this.customRoles.set(role.id, role);
      }

      // Filter out expired assignments
      const now = new Date();
      this.assignments = (data.assignments ?? []).filter(
        (a) => !a.expiresAt || new Date(a.expiresAt) > now,
      );
    } catch {
      // If file is corrupt, start fresh
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data: RBACFileData = {
      customRoles: [...this.customRoles.values()],
      assignments: this.assignments,
    };

    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async getRoles(): Promise<RoleDefinition[]> {
    return [...BUILT_IN_ROLES, ...this.customRoles.values()];
  }

  async getRole(roleId: string): Promise<RoleDefinition | null> {
    const builtIn = BUILT_IN_ROLES.find((r) => r.id === roleId);
    if (builtIn) return builtIn;
    return this.customRoles.get(roleId) ?? null;
  }

  async saveRole(role: RoleDefinition): Promise<void> {
    if (role.builtIn) return; // Cannot modify built-in roles
    this.customRoles.set(role.id, { ...role });
    this.persist();
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const builtIn = BUILT_IN_ROLES.find((r) => r.id === roleId);
    if (builtIn) return false;

    const deleted = this.customRoles.delete(roleId);
    if (deleted) {
      // Remove assignments for deleted role
      this.assignments = this.assignments.filter((a) => a.roleId !== roleId);
      this.persist();
    }
    return deleted;
  }

  async getAssignments(): Promise<RoleAssignment[]> {
    return [...this.assignments];
  }

  async getUserAssignments(userId: string): Promise<RoleAssignment[]> {
    return this.assignments.filter((a) => a.userId === userId);
  }

  async assignRole(assignment: RoleAssignment): Promise<void> {
    this.assignments = this.assignments.filter(
      (a) => !(a.userId === assignment.userId && a.roleId === assignment.roleId),
    );
    this.assignments.push({ ...assignment });
    this.persist();
  }

  async removeAssignment(userId: string, roleId: string): Promise<boolean> {
    const before = this.assignments.length;
    this.assignments = this.assignments.filter(
      (a) => !(a.userId === userId && a.roleId === roleId),
    );
    if (this.assignments.length < before) {
      this.persist();
      return true;
    }
    return false;
  }
}

// =============================================================================
// Gateway RBAC Manager
// =============================================================================

/**
 * Central RBAC manager for the gateway.
 *
 * Resolves permissions for users based on their assigned roles (from
 * manual assignment or SSO group mapping). Supports both built-in
 * and custom roles with fine-grained permissions.
 */
export class GatewayRBACManager {
  private storage: RBACStorage;

  constructor(storage: RBACStorage) {
    this.storage = storage;
  }

  /** Initialize storage and seed built-in roles. */
  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  // ---------------------------------------------------------------------------
  // Role Management
  // ---------------------------------------------------------------------------

  /** List all available roles (built-in + custom). */
  async listRoles(): Promise<RoleDefinition[]> {
    return this.storage.getRoles();
  }

  /** Get a role by ID. */
  async getRole(roleId: string): Promise<RoleDefinition | null> {
    return this.storage.getRole(roleId);
  }

  /** Create a custom role. */
  async createRole(role: Omit<RoleDefinition, "builtIn">): Promise<RoleDefinition> {
    const existing = await this.storage.getRole(role.id);
    if (existing) {
      throw new Error(`Role "${role.id}" already exists`);
    }

    const newRole: RoleDefinition = { ...role, builtIn: false };
    await this.storage.saveRole(newRole);
    return newRole;
  }

  /** Delete a custom role. */
  async deleteRole(roleId: string): Promise<boolean> {
    return this.storage.deleteRole(roleId);
  }

  // ---------------------------------------------------------------------------
  // Role Assignment
  // ---------------------------------------------------------------------------

  /** Assign a role to a user. */
  async assignRole(
    userId: string,
    userEmail: string,
    roleId: string,
    assignedBy: string,
    expiresAt?: string,
  ): Promise<RoleAssignment> {
    const role = await this.storage.getRole(roleId);
    if (!role) {
      throw new Error(`Role "${roleId}" not found`);
    }

    const assignment: RoleAssignment = {
      userId,
      userEmail,
      roleId,
      assignedAt: new Date().toISOString(),
      assignedBy,
      expiresAt: expiresAt ?? null,
    };

    await this.storage.assignRole(assignment);
    return assignment;
  }

  /** Remove a role from a user. */
  async removeRole(userId: string, roleId: string): Promise<boolean> {
    return this.storage.removeAssignment(userId, roleId);
  }

  /** Get all role assignments for a user. */
  async getUserRoles(userId: string): Promise<RoleDefinition[]> {
    const assignments = await this.storage.getUserAssignments(userId);
    const now = new Date();

    // Filter out expired assignments
    const validAssignments = assignments.filter((a) => !a.expiresAt || new Date(a.expiresAt) > now);

    const roles: RoleDefinition[] = [];
    for (const assignment of validAssignments) {
      const role = await this.storage.getRole(assignment.roleId);
      if (role) roles.push(role);
    }

    return roles;
  }

  /** List all role assignments. */
  async listAssignments(): Promise<RoleAssignment[]> {
    return this.storage.getAssignments();
  }

  // ---------------------------------------------------------------------------
  // Permission Checking
  // ---------------------------------------------------------------------------

  /**
   * Check if a user has a specific permission.
   * Resolves the user's roles and checks if any role grants the permission.
   */
  async checkPermission(userId: string, permission: Permission): Promise<PermissionCheckResult> {
    const roles = await this.getUserRoles(userId);

    if (roles.length === 0) {
      return {
        allowed: false,
        grantedBy: [],
        reason: "No roles assigned to user",
      };
    }

    const grantedBy: string[] = [];

    for (const role of roles) {
      // Admin role bypasses all checks
      if (role.permissions.includes("operator.admin")) {
        return { allowed: true, grantedBy: [role.id] };
      }

      if (role.permissions.includes(permission)) {
        grantedBy.push(role.id);
      }
    }

    if (grantedBy.length > 0) {
      return { allowed: true, grantedBy };
    }

    return {
      allowed: false,
      grantedBy: [],
      reason: `None of the user's roles (${roles.map((r) => r.id).join(", ")}) grant "${permission}"`,
    };
  }

  /**
   * Check if a user has ANY of the specified permissions.
   */
  async checkAnyPermission(
    userId: string,
    permissions: Permission[],
  ): Promise<PermissionCheckResult> {
    for (const perm of permissions) {
      const result = await this.checkPermission(userId, perm);
      if (result.allowed) return result;
    }

    return {
      allowed: false,
      grantedBy: [],
      reason: `No matching permissions found for: ${permissions.join(", ")}`,
    };
  }

  /**
   * Check if a user has ALL of the specified permissions.
   */
  async checkAllPermissions(
    userId: string,
    permissions: Permission[],
  ): Promise<PermissionCheckResult> {
    const grantedBy = new Set<string>();
    const missing: string[] = [];

    for (const perm of permissions) {
      const result = await this.checkPermission(userId, perm);
      if (!result.allowed) {
        missing.push(perm);
      } else {
        for (const role of result.grantedBy) grantedBy.add(role);
      }
    }

    if (missing.length > 0) {
      return {
        allowed: false,
        grantedBy: [],
        reason: `Missing permissions: ${missing.join(", ")}`,
      };
    }

    return { allowed: true, grantedBy: [...grantedBy] };
  }

  /**
   * Resolve all permissions for a user (union of all role permissions).
   * Returns the effective permission set.
   */
  async resolvePermissions(userId: string): Promise<Permission[]> {
    const roles = await this.getUserRoles(userId);
    const permissions = new Set<Permission>();

    for (const role of roles) {
      for (const perm of role.permissions) {
        permissions.add(perm);
      }
    }

    return [...permissions];
  }

  /**
   * Resolve roles from SSO/IdP groups using the role mapping.
   * Used during SSO login to automatically assign roles.
   */
  resolveRolesFromGroups(idpGroups: string[], roleMapping: Record<string, string>): string[] {
    const roles = new Set<string>();

    for (const group of idpGroups) {
      const mapped = roleMapping[group];
      if (mapped) roles.add(mapped);
    }

    // Default to viewer if no mapping matched
    if (roles.size === 0) {
      roles.add("viewer");
    }

    return [...roles];
  }

  /**
   * Get a summary of all users and their roles (for admin display).
   */
  async getUserSummary(): Promise<
    Array<{
      userId: string;
      userEmail: string;
      roles: string[];
      permissions: number;
    }>
  > {
    const assignments = await this.storage.getAssignments();
    const userMap = new Map<string, { email: string; roleIds: Set<string> }>();

    for (const assignment of assignments) {
      const existing = userMap.get(assignment.userId);
      if (existing) {
        existing.roleIds.add(assignment.roleId);
      } else {
        userMap.set(assignment.userId, {
          email: assignment.userEmail,
          roleIds: new Set([assignment.roleId]),
        });
      }
    }

    const summary: Array<{
      userId: string;
      userEmail: string;
      roles: string[];
      permissions: number;
    }> = [];

    for (const [userId, info] of userMap) {
      const perms = new Set<Permission>();
      for (const roleId of info.roleIds) {
        const role = await this.storage.getRole(roleId);
        if (role) {
          for (const p of role.permissions) perms.add(p);
        }
      }

      summary.push({
        userId,
        userEmail: info.email,
        roles: [...info.roleIds],
        permissions: perms.size,
      });
    }

    return summary;
  }
}
