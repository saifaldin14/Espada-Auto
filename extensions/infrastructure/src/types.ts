/**
 * Infrastructure Extension Framework - Core Types
 *
 * This module defines the fundamental types and interfaces for the
 * infrastructure extension framework, including provider interfaces,
 * configuration schemas, and lifecycle management types.
 */

import type { z } from "zod";

// =============================================================================
// Infrastructure Provider Types
// =============================================================================

/**
 * Supported infrastructure provider categories
 */
export type InfrastructureProviderCategory =
  | "cloud"
  | "container"
  | "kubernetes"
  | "serverless"
  | "database"
  | "storage"
  | "network"
  | "security"
  | "monitoring"
  | "ci-cd"
  | "custom";

/**
 * Provider lifecycle states
 */
export type ProviderLifecycleState =
  | "uninitialized"
  | "initializing"
  | "ready"
  | "active"
  | "suspending"
  | "suspended"
  | "terminating"
  | "terminated"
  | "error";

/**
 * Provider health status
 */
export type ProviderHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

/**
 * Provider capability flags
 */
export type InfrastructureCapability =
  | "provision"
  | "deprovision"
  | "scale"
  | "monitor"
  | "backup"
  | "restore"
  | "migrate"
  | "audit"
  | "cost-analysis"
  | "security-scan"
  | "dry-run"
  | "rollback"
  | "snapshot"
  | "replicate";

/**
 * Resource types that providers can manage
 */
export type InfrastructureResourceType =
  | "compute"
  | "storage"
  | "network"
  | "database"
  | "cache"
  | "queue"
  | "function"
  | "container"
  | "cluster"
  | "load-balancer"
  | "dns"
  | "certificate"
  | "secret"
  | "policy"
  | "identity"
  | "custom";

/**
 * Resource state representation
 */
export type ResourceState = {
  id: string;
  type: InfrastructureResourceType;
  name: string;
  provider: string;
  region?: string;
  status: "pending" | "creating" | "running" | "updating" | "deleting" | "deleted" | "error";
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
  tags?: Record<string, string>;
};

/**
 * Provider authentication methods
 */
export type ProviderAuthMethod =
  | "api-key"
  | "oauth2"
  | "service-account"
  | "iam-role"
  | "certificate"
  | "token"
  | "custom";

/**
 * Provider authentication configuration
 */
export type ProviderAuthConfig = {
  method: ProviderAuthMethod;
  credentials?: Record<string, string>;
  profile?: string;
  region?: string;
  endpoint?: string;
  timeout?: number;
};

/**
 * Provider metadata
 */
export type InfrastructureProviderMeta = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  category: InfrastructureProviderCategory;
  capabilities: InfrastructureCapability[];
  supportedResources: InfrastructureResourceType[];
  authMethods: ProviderAuthMethod[];
  documentation?: string;
  homepage?: string;
  icon?: string;
};

// =============================================================================
// Command Types
// =============================================================================

/**
 * Infrastructure command categories
 */
export type InfrastructureCommandCategory =
  | "provision"
  | "manage"
  | "monitor"
  | "security"
  | "cost"
  | "utility";

/**
 * Command parameter types
 */
export type CommandParameterType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "file"
  | "secret"
  | "resource-ref";

/**
 * Command parameter definition
 */
export type CommandParameter = {
  name: string;
  type: CommandParameterType;
  description: string;
  required: boolean;
  default?: unknown;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    enum?: unknown[];
    custom?: (value: unknown) => boolean;
  };
  sensitive?: boolean;
};

/**
 * Command execution context
 */
export type CommandExecutionContext = {
  sessionId: string;
  userId?: string;
  providerId: string;
  dryRun: boolean;
  timeout: number;
  environment: Record<string, string>;
  workingDirectory?: string;
  variables: Record<string, unknown>;
};

/**
 * Command execution result
 */
export type CommandExecutionResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    recoverable: boolean;
  };
  duration: number;
  logs: CommandLog[];
  resourcesAffected: string[];
  rollbackAvailable: boolean;
};

/**
 * Command log entry
 */
export type CommandLog = {
  timestamp: Date;
  level: "trace" | "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
};

/**
 * Infrastructure command definition
 */
export type InfrastructureCommand = {
  id: string;
  name: string;
  description: string;
  category: InfrastructureCommandCategory;
  parameters: CommandParameter[];
  requiredCapabilities: InfrastructureCapability[];
  supportsDryRun: boolean;
  dangerous: boolean;
  examples: Array<{
    description: string;
    parameters: Record<string, unknown>;
  }>;
};

// =============================================================================
// Session Types
// =============================================================================

/**
 * Session state
 */
export type SessionState = {
  id: string;
  providerId: string;
  userId?: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  state: "active" | "idle" | "expired" | "terminated";
  context: SessionContext;
  history: SessionHistoryEntry[];
};

/**
 * Session context
 */
export type SessionContext = {
  provider: InfrastructureProviderMeta;
  auth: ProviderAuthConfig;
  resources: Map<string, ResourceState>;
  variables: Map<string, unknown>;
  pendingOperations: PendingOperation[];
};

/**
 * Pending operation tracking
 */
export type PendingOperation = {
  id: string;
  commandId: string;
  startedAt: Date;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  message?: string;
};

/**
 * Session history entry
 */
export type SessionHistoryEntry = {
  timestamp: Date;
  type: "command" | "event" | "error" | "state-change";
  data: Record<string, unknown>;
};

// =============================================================================
// Configuration Schema Types
// =============================================================================

/**
 * Infrastructure configuration schema
 */
export type InfrastructureConfigSchema = {
  providers: ProviderConfigEntry[];
  defaultProvider?: string;
  sessionConfig: SessionConfig;
  commandConfig: CommandConfig;
  loggingConfig: LoggingConfig;
  securityConfig: SecurityConfig;
};

/**
 * Provider configuration entry
 */
export type ProviderConfigEntry = {
  id: string;
  enabled: boolean;
  auth: ProviderAuthConfig;
  settings: Record<string, unknown>;
  resourceDefaults?: Record<InfrastructureResourceType, Record<string, unknown>>;
};

/**
 * Session configuration
 */
export type SessionConfig = {
  timeout: number;
  maxConcurrent: number;
  persistState: boolean;
  stateDirectory?: string;
  cleanupInterval: number;
};

/**
 * Command configuration
 */
export type CommandConfig = {
  validation: {
    strict: boolean;
    allowDryRun: boolean;
    requireConfirmation: boolean;
    dangerousCommandsRequireExplicit: boolean;
  };
  execution: {
    defaultTimeout: number;
    maxRetries: number;
    retryDelay: number;
    parallelLimit: number;
  };
  history: {
    enabled: boolean;
    maxEntries: number;
    retentionDays: number;
  };
};

/**
 * Logging configuration
 */
export type LoggingConfig = {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  includeTimestamps: boolean;
  includeMetadata: boolean;
  destinations: LogDestination[];
  redactPatterns: string[];
};

/**
 * Log destination configuration
 */
export type LogDestination = {
  type: "console" | "file" | "remote";
  config: Record<string, unknown>;
  filter?: {
    minLevel?: string;
    includeProviders?: string[];
    excludeProviders?: string[];
  };
};

/**
 * Security configuration
 */
export type SecurityConfig = {
  encryption: {
    enabled: boolean;
    algorithm: string;
    keyRotationDays: number;
  };
  audit: {
    enabled: boolean;
    logAllCommands: boolean;
    logSensitiveData: boolean;
  };
  access: {
    allowedUsers?: string[];
    allowedGroups?: string[];
    requireMfa: boolean;
  };
};

// =============================================================================
// Event Types
// =============================================================================

/**
 * Infrastructure event types
 */
export type InfrastructureEventType =
  | "provider:registered"
  | "provider:initialized"
  | "provider:ready"
  | "provider:error"
  | "provider:terminated"
  | "session:created"
  | "session:activated"
  | "session:expired"
  | "session:terminated"
  | "command:started"
  | "command:completed"
  | "command:failed"
  | "command:cancelled"
  | "resource:created"
  | "resource:updated"
  | "resource:deleted"
  | "resource:error"
  | "health:check"
  | "config:changed";

/**
 * Infrastructure event
 */
export type InfrastructureEvent<T = unknown> = {
  id: string;
  type: InfrastructureEventType;
  timestamp: Date;
  source: string;
  data: T;
  metadata?: Record<string, unknown>;
};

/**
 * Event handler type
 */
export type InfrastructureEventHandler<T = unknown> = (
  event: InfrastructureEvent<T>,
) => void | Promise<void>;

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Validation result
 */
export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

/**
 * Validation error
 */
export type ValidationError = {
  code: string;
  path: string[];
  message: string;
  value?: unknown;
};

/**
 * Validation warning
 */
export type ValidationWarning = {
  code: string;
  path: string[];
  message: string;
  suggestion?: string;
};

// =============================================================================
// Plugin Discovery Types
// =============================================================================

/**
 * Infrastructure plugin manifest
 */
export type InfrastructurePluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  providers: InfrastructureProviderMeta[];
  commands: InfrastructureCommand[];
  configSchema?: z.ZodSchema;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/**
 * Plugin discovery result
 */
export type PluginDiscoveryResult = {
  plugins: DiscoveredPlugin[];
  errors: PluginDiscoveryError[];
};

/**
 * Discovered plugin
 */
export type DiscoveredPlugin = {
  manifest: InfrastructurePluginManifest;
  path: string;
  source: "bundled" | "installed" | "local" | "remote";
  loadedAt: Date;
};

/**
 * Plugin discovery error
 */
export type PluginDiscoveryError = {
  path: string;
  error: string;
  recoverable: boolean;
};

// =============================================================================
// Lifecycle Types
// =============================================================================

/**
 * Lifecycle hook names
 */
export type LifecycleHookName =
  | "beforeInit"
  | "afterInit"
  | "beforeStart"
  | "afterStart"
  | "beforeStop"
  | "afterStop"
  | "beforeDestroy"
  | "afterDestroy"
  | "onError"
  | "onHealthCheck";

/**
 * Lifecycle hook handler
 */
export type LifecycleHookHandler = (context: LifecycleContext) => void | Promise<void>;

/**
 * Lifecycle context
 */
export type LifecycleContext = {
  providerId: string;
  state: ProviderLifecycleState;
  previousState?: ProviderLifecycleState;
  error?: Error;
  metadata: Record<string, unknown>;
};

/**
 * Lifecycle hook registration
 */
export type LifecycleHookRegistration = {
  hook: LifecycleHookName;
  handler: LifecycleHookHandler;
  priority: number;
  once: boolean;
};
