/**
 * Enterprise Auth — Type Definitions
 *
 * OIDC SSO, RBAC roles/permissions, JWT sessions, MFA, API keys.
 */

// ── OIDC / SSO ──────────────────────────────────────────────────

export interface OidcProviderConfig {
  id: string;
  name: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  callbackUrl: string;
  /** Map OIDC claims to Espada roles */
  roleMappings: OidcRoleMapping[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OidcRoleMapping {
  /** OIDC claim name (e.g., "groups", "roles") */
  claim: string;
  /** Value to match in the claim */
  value: string;
  /** Espada role to assign */
  role: string;
}

export interface OidcProviderInput {
  id?: string;
  name: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  callbackUrl: string;
  roleMappings?: OidcRoleMapping[];
  enabled?: boolean;
}

// ── Roles & Permissions ─────────────────────────────────────────

export type Permission =
  | "infra.read"
  | "infra.write"
  | "infra.delete"
  | "infra.admin"
  | "policy.read"
  | "policy.write"
  | "policy.evaluate"
  | "audit.read"
  | "audit.export"
  | "terraform.plan"
  | "terraform.apply"
  | "terraform.destroy"
  | "cost.read"
  | "cost.approve"
  | "vcs.read"
  | "vcs.write"
  | "blueprint.read"
  | "blueprint.deploy"
  | "user.read"
  | "user.write"
  | "user.admin"
  | "role.read"
  | "role.write"
  | "apikey.create"
  | "apikey.revoke"
  | "gateway.admin";

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  /** Whether this role is built-in (cannot be deleted) */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInput {
  id?: string;
  name: string;
  description?: string;
  permissions: Permission[];
}

/** Built-in roles */
export const BUILT_IN_ROLES: Omit<Role, "createdAt" | "updatedAt">[] = [
  {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to infrastructure, policies, and audits",
    permissions: ["infra.read", "policy.read", "audit.read", "cost.read", "vcs.read", "blueprint.read", "user.read", "role.read"],
    builtIn: true,
  },
  {
    id: "operator",
    name: "Operator",
    description: "Day-to-day infrastructure operations",
    permissions: [
      "infra.read",
      "infra.write",
      "policy.read",
      "policy.evaluate",
      "audit.read",
      "terraform.plan",
      "terraform.apply",
      "cost.read",
      "vcs.read",
      "vcs.write",
      "blueprint.read",
      "blueprint.deploy",
      "user.read",
      "role.read",
    ],
    builtIn: true,
  },
  {
    id: "admin",
    name: "Admin",
    description: "Full access to all operations",
    permissions: [
      "infra.read",
      "infra.write",
      "infra.delete",
      "infra.admin",
      "policy.read",
      "policy.write",
      "policy.evaluate",
      "audit.read",
      "audit.export",
      "terraform.plan",
      "terraform.apply",
      "terraform.destroy",
      "cost.read",
      "cost.approve",
      "vcs.read",
      "vcs.write",
      "blueprint.read",
      "blueprint.deploy",
      "user.read",
      "user.write",
      "user.admin",
      "role.read",
      "role.write",
      "apikey.create",
      "apikey.revoke",
      "gateway.admin",
    ],
    builtIn: true,
  },
  {
    id: "security",
    name: "Security",
    description: "Security-focused role for policy and compliance management",
    permissions: [
      "infra.read",
      "policy.read",
      "policy.write",
      "policy.evaluate",
      "audit.read",
      "audit.export",
      "cost.read",
      "user.read",
      "role.read",
    ],
    builtIn: true,
  },
];

// ── Users ───────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
  /** SSO provider ID if authenticated via OIDC */
  ssoProviderId?: string;
  /** External subject ID from OIDC */
  externalId?: string;
  /** Whether MFA is enabled */
  mfaEnabled: boolean;
  /** TOTP secret (encrypted at rest) */
  mfaSecret?: string;
  lastLoginAt?: string;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserInput {
  id?: string;
  email: string;
  name: string;
  roles?: string[];
  ssoProviderId?: string;
  externalId?: string;
}

// ── Sessions ────────────────────────────────────────────────────

export interface Session {
  id: string;
  userId: string;
  /** JWT token (signed, not stored — only ID is persisted) */
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastActiveAt: string;
  ipAddress?: string;
  userAgent?: string;
}

// ── API Keys ────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  /** Hash of the API key (key itself is only shown once) */
  keyHash: string;
  /** Prefix for display (first 8 chars) */
  keyPrefix: string;
  userId: string;
  permissions: Permission[];
  expiresAt?: string;
  lastUsedAt?: string;
  disabled: boolean;
  createdAt: string;
}

export interface ApiKeyInput {
  name: string;
  userId: string;
  permissions: Permission[];
  expiresInDays?: number;
}

// ── Storage ─────────────────────────────────────────────────────

export interface AuthStorage {
  initialize(): Promise<void>;
  // Roles
  saveRole(role: Role): Promise<void>;
  getRole(id: string): Promise<Role | null>;
  listRoles(): Promise<Role[]>;
  deleteRole(id: string): Promise<boolean>;
  // Users
  saveUser(user: User): Promise<void>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByExternalId(providerId: string, externalId: string): Promise<User | null>;
  listUsers(filters?: { role?: string; disabled?: boolean }): Promise<User[]>;
  deleteUser(id: string): Promise<boolean>;
  // Sessions
  saveSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  deleteSession(id: string): Promise<boolean>;
  deleteUserSessions(userId: string): Promise<number>;
  pruneExpiredSessions(): Promise<number>;
  // API Keys
  saveApiKey(apiKey: ApiKey): Promise<void>;
  getApiKey(id: string): Promise<ApiKey | null>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | null>;
  listApiKeys(userId: string): Promise<ApiKey[]>;
  deleteApiKey(id: string): Promise<boolean>;
  // OIDC
  saveOidcProvider(config: OidcProviderConfig): Promise<void>;
  getOidcProvider(id: string): Promise<OidcProviderConfig | null>;
  listOidcProviders(): Promise<OidcProviderConfig[]>;
  deleteOidcProvider(id: string): Promise<boolean>;

  close(): Promise<void>;
}

// ── Authorization Result ────────────────────────────────────────

export interface AuthorizationResult {
  allowed: boolean;
  reason: string;
  missingPermissions: Permission[];
  matchedRole?: string;
}
