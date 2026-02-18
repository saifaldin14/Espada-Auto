/**
 * Enterprise Auth — RBAC Authorization Engine
 *
 * Resolves user permissions from roles, checks authorization,
 * and manages role hierarchies.
 */

import type { User, Role, Permission, AuthorizationResult, AuthStorage } from "./types.js";
import { BUILT_IN_ROLES } from "./types.js";
import { createHash } from "node:crypto";

export class RbacEngine {
  private storage: AuthStorage;
  private roleCache = new Map<string, Role>();

  constructor(storage: AuthStorage) {
    this.storage = storage;
  }

  /** Initialize built-in roles if they don't exist */
  async initializeBuiltInRoles(): Promise<void> {
    const now = new Date().toISOString();
    for (const builtIn of BUILT_IN_ROLES) {
      const existing = await this.storage.getRole(builtIn.id);
      if (!existing) {
        await this.storage.saveRole({ ...builtIn, createdAt: now, updatedAt: now });
      }
    }
    this.roleCache.clear();
  }

  /** Get all permissions for a user by resolving their roles */
  async getUserPermissions(user: User): Promise<Set<Permission>> {
    const permissions = new Set<Permission>();

    for (const roleId of user.roles) {
      const role = await this.getRole(roleId);
      if (role) {
        for (const perm of role.permissions) {
          permissions.add(perm);
        }
      }
    }

    return permissions;
  }

  /** Check if a user has a specific permission */
  async authorize(user: User, required: Permission | Permission[]): Promise<AuthorizationResult> {
    if (user.disabled) {
      return {
        allowed: false,
        reason: "User account is disabled",
        missingPermissions: Array.isArray(required) ? required : [required],
      };
    }

    const permissions = await this.getUserPermissions(user);
    const requiredPerms = Array.isArray(required) ? required : [required];
    const missing: Permission[] = [];

    for (const perm of requiredPerms) {
      if (!permissions.has(perm)) {
        missing.push(perm);
      }
    }

    if (missing.length === 0) {
      // Find which role granted the permission
      const matchedRole = user.roles.find((roleId) => {
        const cached = this.roleCache.get(roleId);
        return cached && requiredPerms.every((p) => cached.permissions.includes(p));
      });

      return {
        allowed: true,
        reason: "Authorized",
        missingPermissions: [],
        matchedRole,
      };
    }

    return {
      allowed: false,
      reason: `Missing permissions: ${missing.join(", ")}`,
      missingPermissions: missing,
    };
  }

  /** Check if a user has ANY of the required permissions */
  async authorizeAny(user: User, required: Permission[]): Promise<AuthorizationResult> {
    if (user.disabled) {
      return { allowed: false, reason: "User account is disabled", missingPermissions: required };
    }

    const permissions = await this.getUserPermissions(user);
    const hasAny = required.some((p) => permissions.has(p));

    if (hasAny) {
      return { allowed: true, reason: "Authorized", missingPermissions: [] };
    }

    return {
      allowed: false,
      reason: `Requires at least one of: ${required.join(", ")}`,
      missingPermissions: required,
    };
  }

  /** Get a role (cached) */
  private async getRole(id: string): Promise<Role | null> {
    if (this.roleCache.has(id)) return this.roleCache.get(id)!;
    const role = await this.storage.getRole(id);
    if (role) this.roleCache.set(id, role);
    return role;
  }

  /** Clear the role cache (call after role updates) */
  clearCache(): void {
    this.roleCache.clear();
  }
}

// ── Hashing helpers ─────────────────────────────────────────────

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = `esp_${Buffer.from(bytes).toString("base64url")}`;
  const prefix = key.slice(0, 12);
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
