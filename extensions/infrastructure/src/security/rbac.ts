/**
 * Infrastructure Role-Based Access Control (RBAC)
 */

import type { InfrastructurePermission, InfrastructureRole, InfrastructureUser, PermissionCheck, Environment, RiskLevel } from "./types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

export type RBACConfig = { enableResourceLevelPermissions: boolean; inheritRolePermissions: boolean; maxRolesPerUser: number; defaultRole: string; };
export const defaultRBACConfig: RBACConfig = { enableResourceLevelPermissions: true, inheritRolePermissions: true, maxRolesPerUser: 10, defaultRole: "viewer" };

export interface RBACStorage {
  saveRole(role: InfrastructureRole): Promise<void>;
  getRole(id: string): Promise<InfrastructureRole | null>;
  listRoles(): Promise<InfrastructureRole[]>;
  deleteRole(id: string): Promise<void>;
  saveUser(user: InfrastructureUser): Promise<void>;
  getUser(id: string): Promise<InfrastructureUser | null>;
  listUsers(): Promise<InfrastructureUser[]>;
  deleteUser(id: string): Promise<void>;
}

export class InMemoryRBACStorage implements RBACStorage {
  private roles: Map<string, InfrastructureRole> = new Map();
  private users: Map<string, InfrastructureUser> = new Map();

  async saveRole(role: InfrastructureRole): Promise<void> { this.roles.set(role.id, role); }
  async getRole(id: string): Promise<InfrastructureRole | null> { return this.roles.get(id) ?? null; }
  async listRoles(): Promise<InfrastructureRole[]> { return Array.from(this.roles.values()); }
  async deleteRole(id: string): Promise<void> { this.roles.delete(id); }
  async saveUser(user: InfrastructureUser): Promise<void> { this.users.set(user.id, user); }
  async getUser(id: string): Promise<InfrastructureUser | null> { return this.users.get(id) ?? null; }
  async listUsers(): Promise<InfrastructureUser[]> { return Array.from(this.users.values()); }
  async deleteUser(id: string): Promise<void> { this.users.delete(id); }
}

export const DEFAULT_ROLES: InfrastructureRole[] = [
  {
    id: "admin", name: "Administrator", description: "Full access to all operations",
    permissions: ["infra:read", "infra:create", "infra:update", "infra:delete", "infra:scale", "infra:migrate", "infra:backup", "infra:restore", "infra:security", "infra:network", "infra:access", "infra:audit", "infra:approve", "infra:admin"],
    environmentAccess: ["development", "staging", "production", "disaster-recovery"],
    resourcePatterns: ["*"],
    maxRiskLevel: "critical",
    requiresMfa: true,
    sessionTimeout: 480,
  },
  {
    id: "sre", name: "Site Reliability Engineer", description: "Production access for reliability work",
    permissions: ["infra:read", "infra:update", "infra:scale", "infra:backup", "infra:restore", "infra:network", "infra:audit"],
    environmentAccess: ["production", "staging", "disaster-recovery"],
    resourcePatterns: ["*"],
    maxRiskLevel: "high",
    requiresMfa: true,
    sessionTimeout: 240,
    constraints: { requiredApprovalForRiskAbove: "high" },
  },
  {
    id: "developer", name: "Developer", description: "Development and staging access",
    permissions: ["infra:read", "infra:create", "infra:update", "infra:delete", "infra:scale", "infra:backup"],
    environmentAccess: ["development", "staging"],
    resourcePatterns: ["*-dev-*", "*-staging-*"],
    maxRiskLevel: "medium",
    requiresMfa: false,
    sessionTimeout: 480,
    constraints: { maxOperationsPerHour: 100 },
  },
  {
    id: "viewer", name: "Viewer", description: "Read-only access",
    permissions: ["infra:read", "infra:audit"],
    environmentAccess: ["development", "staging", "production"],
    resourcePatterns: ["*"],
    maxRiskLevel: "minimal",
    requiresMfa: false,
    sessionTimeout: 480,
  },
];

export class InfrastructureRBACManager {
  private config: RBACConfig;
  private storage: RBACStorage;
  private logger: InfrastructureLogger;

  constructor(options: { config?: Partial<RBACConfig>; storage?: RBACStorage; logger: InfrastructureLogger }) {
    this.config = { ...defaultRBACConfig, ...options.config };
    this.storage = options.storage ?? new InMemoryRBACStorage();
    this.logger = options.logger;
  }

  async initialize(): Promise<void> {
    for (const role of DEFAULT_ROLES) await this.storage.saveRole(role);
    this.logger.info("RBAC initialized with default roles");
  }

  async checkPermission(options: { userId: string; permission: InfrastructurePermission; environment: Environment; riskLevel: RiskLevel; resourceId?: string; }): Promise<PermissionCheck> {
    const user = await this.storage.getUser(options.userId);
    if (!user) return { allowed: false, reason: "User not found", missingPermissions: [options.permission] };

    const roles = await this.getUserRoles(user);
    if (roles.length === 0) return { allowed: false, reason: "No roles assigned", missingPermissions: [options.permission] };

    // Check if any role has the permission
    const hasPermission = roles.some(r => r.permissions.includes(options.permission) || r.permissions.includes("infra:admin"));
    if (!hasPermission) return { allowed: false, reason: "Permission not granted", missingPermissions: [options.permission] };

    // Check environment access
    const hasEnvAccess = roles.some(r => r.environmentAccess.includes(options.environment));
    if (!hasEnvAccess) return { allowed: false, reason: `No access to ${options.environment} environment`, missingPermissions: [options.permission] };

    // Check risk level
    const riskLevels: RiskLevel[] = ["minimal", "low", "medium", "high", "critical"];
    const requestedLevel = riskLevels.indexOf(options.riskLevel);
    const maxAllowed = Math.max(...roles.map(r => riskLevels.indexOf(r.maxRiskLevel)));
    if (requestedLevel > maxAllowed) return { allowed: false, reason: `Risk level ${options.riskLevel} exceeds maximum allowed`, missingPermissions: [options.permission] };

    // Check if approval is required
    const requiresApproval = roles.some(r => r.constraints?.requiredApprovalForRiskAbove && riskLevels.indexOf(options.riskLevel) > riskLevels.indexOf(r.constraints.requiredApprovalForRiskAbove));

    return { allowed: true, reason: "Permission granted", requiresApproval, approvalLevel: requiresApproval ? options.riskLevel : undefined };
  }

  async createRole(role: InfrastructureRole): Promise<InfrastructureRole> {
    await this.storage.saveRole(role);
    this.logger.info("Role created", { roleId: role.id });
    return role;
  }

  async updateRole(id: string, updates: Partial<Omit<InfrastructureRole, "id">>): Promise<InfrastructureRole | null> {
    const role = await this.storage.getRole(id);
    if (!role) return null;
    const updated = { ...role, ...updates };
    await this.storage.saveRole(updated);
    return updated;
  }

  async deleteRole(id: string): Promise<boolean> {
    const role = await this.storage.getRole(id);
    if (!role) return false;
    await this.storage.deleteRole(id);
    return true;
  }

  async createUser(user: InfrastructureUser): Promise<InfrastructureUser> {
    if (user.roles.length > this.config.maxRolesPerUser) throw new Error(`Maximum ${this.config.maxRolesPerUser} roles per user`);
    await this.storage.saveUser(user);
    this.logger.info("User created", { userId: user.id });
    return user;
  }

  async updateUser(id: string, updates: Partial<Omit<InfrastructureUser, "id">>): Promise<InfrastructureUser | null> {
    const user = await this.storage.getUser(id);
    if (!user) return null;
    if (updates.roles && updates.roles.length > this.config.maxRolesPerUser) throw new Error(`Maximum ${this.config.maxRolesPerUser} roles per user`);
    const updated = { ...user, ...updates };
    await this.storage.saveUser(updated);
    return updated;
  }

  async assignRole(userId: string, roleId: string): Promise<boolean> {
    const user = await this.storage.getUser(userId);
    const role = await this.storage.getRole(roleId);
    if (!user || !role) return false;
    if (user.roles.includes(roleId)) return true;
    if (user.roles.length >= this.config.maxRolesPerUser) throw new Error(`Maximum ${this.config.maxRolesPerUser} roles per user`);
    user.roles.push(roleId);
    await this.storage.saveUser(user);
    this.logger.info("Role assigned", { userId, roleId });
    return true;
  }

  async removeRole(userId: string, roleId: string): Promise<boolean> {
    const user = await this.storage.getUser(userId);
    if (!user) return false;
    const idx = user.roles.indexOf(roleId);
    if (idx === -1) return true;
    user.roles.splice(idx, 1);
    await this.storage.saveUser(user);
    return true;
  }

  async getRole(id: string): Promise<InfrastructureRole | null> { return this.storage.getRole(id); }
  async listRoles(): Promise<InfrastructureRole[]> { return this.storage.listRoles(); }
  async getUser(id: string): Promise<InfrastructureUser | null> { return this.storage.getUser(id); }
  async listUsers(): Promise<InfrastructureUser[]> { return this.storage.listUsers(); }

  private async getUserRoles(user: InfrastructureUser): Promise<InfrastructureRole[]> {
    const roles: InfrastructureRole[] = [];
    for (const roleId of user.roles) {
      const role = await this.storage.getRole(roleId);
      if (role) roles.push(role);
    }
    return roles;
  }
}

export function createRBACManager(options: { config?: Partial<RBACConfig>; storage?: RBACStorage; logger: InfrastructureLogger }): InfrastructureRBACManager {
  return new InfrastructureRBACManager(options);
}
