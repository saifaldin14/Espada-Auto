/**
 * Enterprise RBAC — Types
 *
 * Role-Based Access Control types for the gateway. Defines roles,
 * permissions, scopes, and role assignments. Designed to unify the
 * existing infrastructure extension RBAC with gateway-level auth.
 */

// =============================================================================
// Permissions & Scopes
// =============================================================================

/**
 * Fine-grained permissions for gateway operations.
 * Organized by domain: operator, policy, audit, graph, terraform, compliance.
 */
export type Permission =
  // Core operator permissions (aligned with existing scopes)
  | "operator.admin"
  | "operator.read"
  | "operator.write"
  | "operator.approvals"
  | "operator.pairing"
  // Policy management
  | "policy.read"
  | "policy.write"
  | "policy.manage"
  | "policy.evaluate"
  // Audit trail
  | "audit.read"
  | "audit.export"
  // Knowledge graph
  | "graph.read"
  | "graph.write"
  | "graph.admin"
  // Terraform / IaC
  | "terraform.plan"
  | "terraform.apply"
  | "terraform.state"
  | "terraform.import"
  // Compliance
  | "compliance.read"
  | "compliance.scan"
  | "compliance.manage"
  | "compliance.waiver"
  // Blueprints
  | "blueprints.read"
  | "blueprints.deploy"
  | "blueprints.manage"
  // VCS
  | "vcs.read"
  | "vcs.write"
  | "vcs.manage"
  // Cost governance
  | "cost.read"
  | "cost.manage"
  // Config
  | "config.read"
  | "config.write";

// =============================================================================
// Roles
// =============================================================================

/** Built-in role identifiers. */
export type BuiltInRole = "admin" | "operator" | "developer" | "viewer" | "auditor";

/**
 * A role definition with its associated permissions.
 */
export type RoleDefinition = {
  /** Unique role identifier. */
  id: string;

  /** Human-readable role name. */
  name: string;

  /** Role description. */
  description: string;

  /** Permissions granted by this role. */
  permissions: Permission[];

  /** Whether this is a built-in role (cannot be deleted). */
  builtIn: boolean;

  /** Environment restrictions (null = all environments). */
  environments?: string[] | null;
};

/**
 * A role assignment linking a user to a role.
 */
export type RoleAssignment = {
  /** User identifier (SSO user ID or local user ID). */
  userId: string;

  /** User email (for display). */
  userEmail: string;

  /** Assigned role ID. */
  roleId: string;

  /** When this assignment was created. */
  assignedAt: string;

  /** Who assigned this role. */
  assignedBy: string;

  /** Optional expiry (ISO-8601). Null = permanent. */
  expiresAt: string | null;
};

// =============================================================================
// RBAC Storage
// =============================================================================

/**
 * Storage interface for RBAC data (roles and assignments).
 */
export interface RBACStorage {
  /** Get all role definitions. */
  getRoles(): Promise<RoleDefinition[]>;

  /** Get a role by ID. */
  getRole(roleId: string): Promise<RoleDefinition | null>;

  /** Save a role definition (create or update). */
  saveRole(role: RoleDefinition): Promise<void>;

  /** Delete a role (fails for built-in roles). */
  deleteRole(roleId: string): Promise<boolean>;

  /** Get all role assignments. */
  getAssignments(): Promise<RoleAssignment[]>;

  /** Get role assignments for a specific user. */
  getUserAssignments(userId: string): Promise<RoleAssignment[]>;

  /** Assign a role to a user. */
  assignRole(assignment: RoleAssignment): Promise<void>;

  /** Remove a role assignment. */
  removeAssignment(userId: string, roleId: string): Promise<boolean>;

  /** Initialize storage (create tables, seed defaults). */
  initialize(): Promise<void>;
}

// =============================================================================
// RBAC Check Result
// =============================================================================

/**
 * Result of a permission check.
 */
export type PermissionCheckResult = {
  /** Whether the permission is granted. */
  allowed: boolean;

  /** Which role(s) grant this permission (empty if denied). */
  grantedBy: string[];

  /** Reason for denial (if denied). */
  reason?: string;
};

// =============================================================================
// Built-in Role Definitions
// =============================================================================

/** Default built-in roles with their permission sets. */
export const BUILT_IN_ROLES: RoleDefinition[] = [
  {
    id: "admin",
    name: "Administrator",
    description: "Full access to all gateway operations, configuration, and user management",
    permissions: [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "policy.read",
      "policy.write",
      "policy.manage",
      "policy.evaluate",
      "audit.read",
      "audit.export",
      "graph.read",
      "graph.write",
      "graph.admin",
      "terraform.plan",
      "terraform.apply",
      "terraform.state",
      "terraform.import",
      "compliance.read",
      "compliance.scan",
      "compliance.manage",
      "compliance.waiver",
      "blueprints.read",
      "blueprints.deploy",
      "blueprints.manage",
      "vcs.read",
      "vcs.write",
      "vcs.manage",
      "cost.read",
      "cost.manage",
      "config.read",
      "config.write",
    ],
    builtIn: true,
  },
  {
    id: "operator",
    name: "Operator",
    description:
      "Read, write, approve operations, and manage policies. Cannot manage users or config",
    permissions: [
      "operator.read",
      "operator.write",
      "operator.approvals",
      "policy.read",
      "policy.write",
      "policy.evaluate",
      "audit.read",
      "graph.read",
      "graph.write",
      "terraform.plan",
      "terraform.apply",
      "terraform.state",
      "compliance.read",
      "compliance.scan",
      "blueprints.read",
      "blueprints.deploy",
      "vcs.read",
      "vcs.write",
      "cost.read",
      "config.read",
    ],
    builtIn: true,
  },
  {
    id: "developer",
    name: "Developer",
    description: "Read and write access to non-production environments. Can plan but not apply",
    permissions: [
      "operator.read",
      "operator.write",
      "policy.read",
      "policy.evaluate",
      "audit.read",
      "graph.read",
      "terraform.plan",
      "terraform.state",
      "compliance.read",
      "blueprints.read",
      "vcs.read",
      "vcs.write",
      "cost.read",
    ],
    builtIn: true,
    environments: ["development", "staging"],
  },
  {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to all resources and audit trail",
    permissions: [
      "operator.read",
      "policy.read",
      "audit.read",
      "graph.read",
      "terraform.state",
      "compliance.read",
      "blueprints.read",
      "vcs.read",
      "cost.read",
      "config.read",
    ],
    builtIn: true,
  },
  {
    id: "auditor",
    name: "Auditor",
    description: "Read access plus audit trail export and compliance scanning capabilities",
    permissions: [
      "operator.read",
      "policy.read",
      "audit.read",
      "audit.export",
      "graph.read",
      "terraform.state",
      "compliance.read",
      "compliance.scan",
      "cost.read",
    ],
    builtIn: true,
  },
];
