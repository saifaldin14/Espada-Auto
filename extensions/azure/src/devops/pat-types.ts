/**
 * Azure DevOps PAT Management — Type Definitions
 *
 * Covers personal access token storage, validation, scoping,
 * and lifecycle management.
 */

// =============================================================================
// PAT Scopes — Azure DevOps permission scopes
// =============================================================================

/** Well-known Azure DevOps PAT scopes. */
export type DevOpsPATScope =
  | "vso.agentpools"
  | "vso.agentpools_manage"
  | "vso.analytics"
  | "vso.auditlog"
  | "vso.build"
  | "vso.build_execute"
  | "vso.code"
  | "vso.code_write"
  | "vso.code_manage"
  | "vso.code_full"
  | "vso.code_status"
  | "vso.dashboards"
  | "vso.dashboards_manage"
  | "vso.entitlements"
  | "vso.extension"
  | "vso.extension_manage"
  | "vso.graph"
  | "vso.graph_manage"
  | "vso.identity"
  | "vso.identity_manage"
  | "vso.loadtest"
  | "vso.loadtest_write"
  | "vso.machinegroup_manage"
  | "vso.memberentitlementmanagement"
  | "vso.memberentitlementmanagement_write"
  | "vso.notification"
  | "vso.notification_manage"
  | "vso.packaging"
  | "vso.packaging_write"
  | "vso.packaging_manage"
  | "vso.pipelineresources_use"
  | "vso.pipelineresources_manage"
  | "vso.profile"
  | "vso.profile_write"
  | "vso.project"
  | "vso.project_write"
  | "vso.project_manage"
  | "vso.release"
  | "vso.release_execute"
  | "vso.release_manage"
  | "vso.securefiles_read"
  | "vso.securefiles_write"
  | "vso.securefiles_manage"
  | "vso.security_manage"
  | "vso.serviceendpoint"
  | "vso.serviceendpoint_query"
  | "vso.serviceendpoint_manage"
  | "vso.symbols"
  | "vso.symbols_write"
  | "vso.symbols_manage"
  | "vso.taskgroups_read"
  | "vso.taskgroups_write"
  | "vso.taskgroups_manage"
  | "vso.test"
  | "vso.test_write"
  | "vso.tokenadministration"
  | "vso.tokens"
  | "vso.variablegroups_read"
  | "vso.variablegroups_write"
  | "vso.variablegroups_manage"
  | "vso.wiki"
  | "vso.wiki_write"
  | "vso.work"
  | "vso.work_write"
  | "vso.work_full"
  | string; // Allow custom/future scopes

// =============================================================================
// PAT Storage & Metadata
// =============================================================================

/** How the PAT token value is stored. */
export type PATStorageBackend = "file" | "keychain" | "keyvault";

/** Stored PAT record (token value encrypted at rest). */
export type StoredPAT = {
  /** Unique identifier for this PAT entry (UUID v4). */
  id: string;
  /** Human-readable label for the PAT. */
  label: string;
  /** Azure DevOps organization the PAT is scoped to. */
  organization: string;
  /** Scopes the PAT was created with ("full" for full-access). */
  scopes: DevOpsPATScope[] | "full";
  /** Base64-encoded encrypted token bytes (AES-256-GCM). */
  encryptedToken: string;
  /** Base64-encoded AES initialization vector. */
  iv: string;
  /** Base64-encoded GCM authentication tag. */
  authTag: string;
  /** ISO-8601 date when the PAT was created / stored. */
  createdAt: string;
  /** ISO-8601 date when the PAT expires (if known). */
  expiresAt?: string;
  /** Whether this PAT has been validated against the DevOps API. */
  validated: boolean;
  /** Last ISO-8601 date the PAT was used successfully. */
  lastUsedAt?: string;
  /** Storage backend for this entry. */
  backend: PATStorageBackend;
  /** Azure Key Vault URI if backend is "keyvault". */
  keyVaultSecretUri?: string;
};

/** Decrypted PAT ready for API use. */
export type DecryptedPAT = {
  id: string;
  label: string;
  organization: string;
  scopes: DevOpsPATScope[] | "full";
  token: string;
  expiresAt?: string;
  validated: boolean;
  lastUsedAt?: string;
};

/** Summary of a PAT (no sensitive data). */
export type PATSummary = {
  id: string;
  label: string;
  organization: string;
  scopes: DevOpsPATScope[] | "full";
  createdAt: string;
  expiresAt?: string;
  validated: boolean;
  lastUsedAt?: string;
  backend: PATStorageBackend;
  status: PATStatus;
};

/** Computed PAT health status. */
export type PATStatus =
  | "active"         // Valid and not near expiry
  | "expiring-soon"  // Expires within 7 days
  | "expired"        // Past expiration date
  | "unvalidated"    // Never validated against API
  | "revoked";       // Validation failed — token rejected by API

// =============================================================================
// PAT Validation
// =============================================================================

/** Result from validating a PAT against the DevOps API. */
export type PATValidationResult = {
  valid: boolean;
  /** User display name the PAT authenticates as. */
  displayName?: string;
  /** Email address associated with the PAT. */
  emailAddress?: string;
  /** Scope categories confirmed by the API. */
  authorizedScopes?: string[];
  /** Error message if validation failed. */
  error?: string;
  /** HTTP status returned by the DevOps API. */
  httpStatus?: number;
};

// =============================================================================
// PAT Manager Options
// =============================================================================

/** Configuration for the PAT manager. */
export type PATManagerOptions = {
  /** Directory for encrypted PAT storage. Defaults to `~/.espada/azure/pats`. */
  storageDir?: string;
  /** Encryption key (32 bytes hex). Derived from machine ID if not set. */
  encryptionKey?: string;
  /** Default organization for new PATs. */
  defaultOrganization?: string;
  /** Number of days before expiry to warn. Default: 7. */
  expiryWarningDays?: number;
  /** Azure Key Vault URL for enterprise PAT storage (optional). */
  keyVaultUrl?: string;
};

/** Event emitted by the PAT manager. */
export type PATEvent = {
  type: "pat-stored" | "pat-deleted" | "pat-validated" | "pat-expired" | "pat-rotated";
  patId: string;
  label: string;
  organization: string;
  timestamp: string;
  details?: Record<string, unknown>;
};

/** Listener for PAT lifecycle events. */
export type PATEventListener = (event: PATEvent) => void;
