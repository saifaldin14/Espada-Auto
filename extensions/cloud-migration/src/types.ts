/**
 * Cross-Cloud Migration Engine — Core Type System
 *
 * All domain types for the migration engine, modeled after:
 * - LifecyclePhase/LifecycleIncident from incident-lifecycle
 * - ExecutionPlan/PlanStep/StepHandler from Azure orchestration
 * - CloudProvider from hybrid-cloud
 * - InfrastructureResourceType from infrastructure framework
 */

// =============================================================================
// Provider & Resource Types
// =============================================================================

/** Supported migration providers. */
export type MigrationProvider =
  | "aws"
  | "azure"
  | "gcp"
  | "on-premises"
  | "vmware"
  | "nutanix";

/** Resource types the migration engine can handle. */
export type MigrationResourceType =
  | "vm"
  | "disk"
  | "object-storage"
  | "database"
  | "dns"
  | "security-rules"
  | "load-balancer";

/** A specific migration direction. */
export type MigrationDirection = {
  source: MigrationProvider;
  target: MigrationProvider;
};

// =============================================================================
// Migration Phase State Machine
// =============================================================================

/**
 * State machine phases for a migration job.
 *
 * ```
 * created → assessing → planning → awaiting-approval → executing → verifying → cutting-over → completed
 *                                                          │                        │
 *                                                     rolling-back            rolled-back
 *                                                          │
 *                                                        failed
 * ```
 */
export type MigrationPhase =
  | "created"
  | "assessing"
  | "planning"
  | "awaiting-approval"
  | "executing"
  | "verifying"
  | "cutting-over"
  | "completed"
  | "rolling-back"
  | "rolled-back"
  | "failed";

/** Valid transitions: phase → allowed next phases. */
export const MIGRATION_PHASE_TRANSITIONS: Record<MigrationPhase, MigrationPhase[]> = {
  created: ["assessing"],
  assessing: ["planning", "failed"],
  planning: ["awaiting-approval", "failed"],
  "awaiting-approval": ["executing", "failed"],
  executing: ["verifying", "rolling-back", "failed"],
  verifying: ["cutting-over", "rolling-back", "failed"],
  "cutting-over": ["completed", "rolling-back", "failed"],
  completed: [],
  "rolling-back": ["rolled-back", "failed"],
  "rolled-back": [],
  failed: [],
};

/** Priority ordering for phase — lower = earlier in lifecycle. */
export const MIGRATION_PHASE_ORDER: Record<MigrationPhase, number> = {
  created: 0,
  assessing: 1,
  planning: 2,
  "awaiting-approval": 3,
  executing: 4,
  verifying: 5,
  "cutting-over": 6,
  completed: 7,
  "rolling-back": 8,
  "rolled-back": 9,
  failed: 10,
};

// =============================================================================
// Normalized Resource Types (Provider-Agnostic)
// =============================================================================

/** Provider-agnostic VM representation. */
export type NormalizedVM = {
  id: string;
  name: string;
  provider: MigrationProvider;
  region: string;
  zone?: string;
  cpuCores: number;
  memoryGB: number;
  osType: "linux" | "windows" | "unknown";
  osDistro?: string;
  architecture: "x86_64" | "arm64";
  disks: NormalizedDisk[];
  networkInterfaces: NormalizedNetworkInterface[];
  tags: Record<string, string>;
  /** Original provider-specific data for reference. */
  raw?: Record<string, unknown>;
};

/** Provider-agnostic disk/volume representation. */
export type NormalizedDisk = {
  id: string;
  name: string;
  sizeGB: number;
  type: "ssd" | "hdd" | "nvme" | "standard";
  iops?: number;
  throughputMBps?: number;
  encrypted: boolean;
  isBootDisk: boolean;
  devicePath?: string;
  snapshotId?: string;
};

/** Provider-agnostic network interface. */
export type NormalizedNetworkInterface = {
  id: string;
  privateIp: string;
  publicIp?: string;
  subnetId?: string;
  securityGroupIds: string[];
  macAddress?: string;
};

/** Provider-agnostic object storage bucket. */
export type NormalizedBucket = {
  id: string;
  name: string;
  provider: MigrationProvider;
  region: string;
  objectCount: number;
  totalSizeBytes: number;
  versioning: boolean;
  encryption: BucketEncryption;
  lifecycleRules: LifecycleRule[];
  tags: Record<string, string>;
  raw?: Record<string, unknown>;
};

export type BucketEncryption = {
  enabled: boolean;
  type: "provider-managed" | "customer-managed" | "none";
  keyId?: string;
};

export type LifecycleRule = {
  id: string;
  prefix: string;
  enabled: boolean;
  transitions: Array<{ days: number; storageClass: string }>;
  expiration?: { days: number };
};

/** Provider-agnostic object within a bucket. */
export type NormalizedObject = {
  key: string;
  sizeBytes: number;
  lastModified: string;
  etag?: string;
  sha256?: string;
  storageClass: string;
  contentType?: string;
  metadata: Record<string, string>;
};

/** Provider-agnostic security/firewall rule. */
export type NormalizedSecurityRule = {
  id: string;
  name: string;
  direction: "inbound" | "outbound";
  action: "allow" | "deny";
  protocol: "tcp" | "udp" | "icmp" | "*";
  portRange: { from: number; to: number };
  source: SecurityEndpoint;
  destination: SecurityEndpoint;
  priority: number;
  description?: string;
};

export type SecurityEndpoint = {
  type: "cidr" | "security-group" | "tag" | "service-tag" | "any";
  value: string;
};

/** Provider-agnostic DNS record. */
export type NormalizedDNSRecord = {
  name: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "PTR";
  ttl: number;
  values: string[];
  weight?: number;
  healthCheckId?: string;
};

// =============================================================================
// Transfer Types
// =============================================================================

/** Manifest tracking individual object transfer status. */
export type TransferManifest = {
  jobId: string;
  sourceBucket: string;
  targetBucket: string;
  objects: TransferObjectEntry[];
  startedAt: string;
  completedAt?: string;
  totalBytes: number;
  transferredBytes: number;
};

export type TransferObjectEntry = {
  key: string;
  sizeBytes: number;
  sourceChecksum: string;
  targetChecksum?: string;
  status: "pending" | "transferring" | "verifying" | "completed" | "failed";
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

// =============================================================================
// Image Format Types
// =============================================================================

/** Supported disk image formats. */
export type ImageFormat = "raw" | "vhd" | "vhdx" | "vmdk" | "qcow2" | "ami";

/** Image conversion request. */
export type ImageConversion = {
  sourceFormat: ImageFormat;
  targetFormat: ImageFormat;
  sourcePath: string;
  targetPath: string;
  sourceChecksum?: string;
};

/** Image format conversion matrix — source → target format for each cloud. */
export const IMAGE_FORMAT_MATRIX: Record<string, { intermediate: ImageFormat; targets: Record<string, ImageFormat> }> = {
  aws: { intermediate: "raw", targets: { azure: "vhd", gcp: "raw", "on-premises": "vmdk" } },
  azure: { intermediate: "raw", targets: { aws: "raw", gcp: "raw", "on-premises": "vmdk" } },
  gcp: { intermediate: "raw", targets: { aws: "raw", azure: "vhd", "on-premises": "vmdk" } },
  "on-premises": { intermediate: "raw", targets: { aws: "raw", azure: "vhd", gcp: "raw" } },
};

// =============================================================================
// Compatibility Types
// =============================================================================

/** Result of checking migration compatibility for a resource type between providers. */
export type CompatibilityResult = {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  resourceType: MigrationResourceType;
  compatible: boolean;
  warnings: CompatibilityWarning[];
  blockers: CompatibilityBlocker[];
  workarounds: CompatibilityWorkaround[];
};

export type CompatibilityWarning = {
  code: string;
  message: string;
  severity: "low" | "medium" | "high";
  affectedFeatures?: string[];
};

export type CompatibilityBlocker = {
  code: string;
  message: string;
  reason: string;
};

export type CompatibilityWorkaround = {
  code: string;
  message: string;
  steps: string[];
  automatable: boolean;
};

// =============================================================================
// Integrity Types
// =============================================================================

/** Per-resource integrity verification report. */
export type IntegrityReport = {
  jobId: string;
  resourceId: string;
  resourceType: MigrationResourceType;
  level: IntegrityLevel;
  passed: boolean;
  checks: IntegrityCheck[];
  checkedAt: string;
  durationMs: number;
};

export type IntegrityLevel = "object-level" | "volume-level" | "schema-level";

export type IntegrityCheck = {
  name: string;
  passed: boolean;
  expected: string | number;
  actual: string | number;
  details?: string;
};

// =============================================================================
// Cost Estimation Types
// =============================================================================

/** Cost estimate for a migration. */
export type MigrationCostEstimate = {
  jobId?: string;
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  egressCost: CostLineItem;
  transferCost: CostLineItem;
  targetInfraCost: CostLineItem;
  conversionCost: CostLineItem;
  totalEstimatedCost: number;
  currency: string;
  breakdown: CostLineItem[];
  estimatedDurationHours: number;
  confidenceLevel: "low" | "medium" | "high";
};

export type CostLineItem = {
  category: string;
  description: string;
  amount: number;
  unit: string;
  quantity: number;
};

// =============================================================================
// Migration Step Types (extends Azure Orchestration patterns)
// =============================================================================

/** Output reference using ${stepId}.outputs.${name} pattern from Azure orchestration. */
export type StepOutputRef = `${string}.outputs.${string}`;

/** A single step in the migration execution plan. */
export type MigrationStep = {
  id: string;
  type: MigrationStepType;
  name: string;
  description: string;
  params: Record<string, unknown | StepOutputRef>;
  dependsOn: string[];
  condition?: MigrationStepCondition;
  timeoutMs: number;
  pipeline: "compute" | "data" | "network" | "governance";
  resourceType: MigrationResourceType;
  requiresRollback: boolean;
  tags?: Record<string, string>;
};

/** All supported step types. */
export type MigrationStepType =
  // Compute pipeline
  | "snapshot-source"
  | "export-image"
  | "transfer-image"
  | "convert-image"
  | "import-image"
  | "remediate-boot"
  | "provision-vm"
  | "verify-boot"
  // Data pipeline
  | "inventory-source"
  | "create-target"
  | "transfer-objects"
  | "verify-integrity"
  | "sync-metadata"
  // Database
  | "export-database"
  | "transfer-database"
  | "import-database"
  | "verify-schema"
  // Network pipeline
  | "map-network"
  | "create-security-rules"
  | "migrate-dns"
  | "verify-connectivity"
  // Cross-cutting
  | "cutover"
  | "approval-gate"
  | "decommission-source";

export type MigrationStepCondition = {
  stepId: string;
  check: "succeeded" | "failed" | "output-equals" | "output-truthy";
  outputName?: string;
  expectedValue?: unknown;
};

// =============================================================================
// Execution Plan
// =============================================================================

/** Top-level migration execution plan — a DAG of MigrationSteps. */
export type MigrationExecutionPlan = {
  id: string;
  name: string;
  description: string;
  jobId: string;
  steps: MigrationStep[];
  globalParams: Record<string, unknown>;
  createdAt: string;
  estimatedDurationMs: number;
  estimatedCost: MigrationCostEstimate;
  riskAssessment: RiskAssessment;
};

export type RiskAssessment = {
  overallRisk: "low" | "medium" | "high" | "critical";
  factors: RiskFactor[];
};

export type RiskFactor = {
  category: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  mitigation?: string;
};

// =============================================================================
// Step Execution State
// =============================================================================

export type MigrationStepStatus =
  | "pending"
  | "waiting"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rolled-back";

export type MigrationStepExecutionState = {
  stepId: string;
  status: MigrationStepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  outputs: Record<string, unknown>;
  error?: string;
  rollbackError?: string;
  retryCount: number;
};

export type MigrationExecutionState = {
  planId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "rolling-back" | "rolled-back" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  totalDurationMs?: number;
  steps: Map<string, MigrationStepExecutionState>;
  resolvedOutputs: Map<string, unknown>;
};

// =============================================================================
// Step Handler Contract (matches Azure Orchestration exactly)
// =============================================================================

export type MigrationStepLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type MigrationStepContext = {
  params: Record<string, unknown>;
  globalParams: Record<string, unknown>;
  tags: Record<string, string>;
  log: MigrationStepLogger;
  signal?: AbortSignal;
  /** Source provider credentials accessor. */
  sourceCredentials?: unknown;
  /** Target provider credentials accessor. */
  targetCredentials?: unknown;
};

export type MigrationStepExecuteFn = (ctx: MigrationStepContext) => Promise<Record<string, unknown>>;
export type MigrationStepRollbackFn = (ctx: MigrationStepContext, outputs: Record<string, unknown>) => Promise<void>;

/**
 * Step handler contract — compatible with Azure Orchestrator's StepHandler.
 * Every mutating step MUST have a rollback handler.
 */
export type MigrationStepHandler = {
  execute: MigrationStepExecuteFn;
  rollback?: MigrationStepRollbackFn;
};

// =============================================================================
// Migration Job (top-level record)
// =============================================================================

/** Top-level migration job record — follows LifecycleIncident pattern from incident-lifecycle. */
export type MigrationJob = {
  id: string;
  name: string;
  description: string;
  phase: MigrationPhase;
  phaseHistory: MigrationPhaseTransition[];
  source: MigrationEndpoint;
  target: MigrationEndpoint;
  resourceIds: string[];
  resourceTypes: MigrationResourceType[];
  plan?: MigrationExecutionPlan;
  executionState?: MigrationExecutionState;
  integrityReports: IntegrityReport[];
  costEstimate?: MigrationCostEstimate;
  compatibilityResults: CompatibilityResult[];
  auditTrail: MigrationAuditEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  initiatedBy: string;
  metadata: Record<string, unknown>;
};

export type MigrationEndpoint = {
  provider: MigrationProvider;
  region: string;
  accountId?: string;
  projectId?: string;
  subscriptionId?: string;
};

export type MigrationPhaseTransition = {
  from: MigrationPhase | "init";
  to: MigrationPhase;
  timestamp: string;
  triggeredBy: string;
  reason: string;
  durationMs?: number;
};

// =============================================================================
// Audit Types
// =============================================================================

/** Structured, cryptographically chained audit entry. */
export type MigrationAuditEntry = {
  timestamp: string;
  jobId: string;
  stepId: string;
  action: MigrationAuditAction;
  actor: string;
  provider: MigrationProvider;
  resourceId: string;
  outcome: "success" | "failure" | "skipped";
  details: Record<string, unknown>;
  integrityHash: string;
};

export type MigrationAuditAction =
  | "plan"
  | "approve"
  | "execute"
  | "verify"
  | "rollback"
  | "cutover"
  | "decommission";

// =============================================================================
// Orchestration Events
// =============================================================================

export type MigrationEventType =
  | "job:created"
  | "job:phase-change"
  | "plan:generated"
  | "plan:approved"
  | "plan:rejected"
  | "execution:start"
  | "execution:complete"
  | "execution:failed"
  | "execution:cancelled"
  | "step:start"
  | "step:complete"
  | "step:failed"
  | "step:skipped"
  | "step:rollback-start"
  | "step:rollback-complete"
  | "step:rollback-failed"
  | "step:retry"
  | "verification:start"
  | "verification:passed"
  | "verification:failed"
  | "cutover:start"
  | "cutover:complete"
  | "cutover:failed";

export type MigrationEvent = {
  type: MigrationEventType;
  jobId: string;
  planId?: string;
  stepId?: string;
  stepName?: string;
  timestamp: string;
  message: string;
  error?: string;
  outputs?: Record<string, unknown>;
  progress?: { completed: number; total: number; percentage: number };
};

export type MigrationEventListener = (event: MigrationEvent) => void;

// =============================================================================
// Orchestration Result
// =============================================================================

export type MigrationOrchestrationResult = {
  planId: string;
  planName: string;
  jobId: string;
  status: MigrationExecutionState["status"];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  steps: MigrationStepExecutionResult[];
  outputs: Record<string, unknown>;
  errors: string[];
  integrityReports: IntegrityReport[];
};

export type MigrationStepExecutionResult = {
  stepId: string;
  stepName: string;
  stepType: MigrationStepType;
  status: MigrationStepStatus;
  durationMs: number;
  outputs: Record<string, unknown>;
  error?: string;
  rollbackError?: string;
};

// =============================================================================
// Orchestration Options
// =============================================================================

export type MigrationOrchestrationOptions = {
  dryRun?: boolean;
  maxConcurrency?: number;
  failFast?: boolean;
  autoRollback?: boolean;
  timeoutMs?: number;
  stepTimeoutMs?: number;
  maxRetries?: number;
  globalTags?: Record<string, string>;
  signal?: AbortSignal;
};

// =============================================================================
// Network Translation Types
// =============================================================================

export type TranslationReport = {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  translatedRules: NormalizedSecurityRule[];
  warnings: TranslationWarning[];
  untranslatable: UntranslatableRule[];
  semanticDiff: SemanticDiff;
};

export type TranslationWarning = {
  ruleId: string;
  message: string;
  approximation: string;
};

export type UntranslatableRule = {
  originalRule: NormalizedSecurityRule;
  reason: string;
  suggestedAction: string;
};

export type SemanticDiff = {
  addedAccess: string[];
  removedAccess: string[];
  modifiedAccess: string[];
  summary: string;
};

// =============================================================================
// Database Migration Types
// =============================================================================

export type DatabaseType = "postgresql" | "mysql";

export type DatabaseMigrationConfig = {
  sourceType: DatabaseType;
  sourceHost: string;
  sourcePort: number;
  sourceDatabase: string;
  targetHost: string;
  targetPort: number;
  targetDatabase: string;
  useCDC: boolean;
  maxLagMs?: number;
};

export type SchemaComparison = {
  tablesMatched: number;
  tablesMissing: string[];
  tablesExtra: string[];
  rowCountDiffs: Array<{ table: string; sourceCount: number; targetCount: number }>;
  schemaDiffs: Array<{ table: string; diff: string }>;
  passed: boolean;
};

// =============================================================================
// On-Premises Types
// =============================================================================

export type OnPremPlatform = "vmware" | "kvm" | "hyper-v" | "nutanix";

export type OnPremCredentials = {
  platform: OnPremPlatform;
  host: string;
  port: number;
  username: string;
  /** Credentials are resolved at runtime, never stored in plain text. */
  authType: "password" | "ssh-key" | "certificate";
};

export type OnPremDiscoveryResult = {
  platform: OnPremPlatform;
  vms: NormalizedVM[];
  datastores: Array<{ name: string; capacityGB: number; freeGB: number }>;
  networks: Array<{ name: string; vlanId?: number; cidr?: string }>;
};

// =============================================================================
// Plugin State
// =============================================================================

/**
 * Shared plugin state accessible across the extension.
 * Follows PluginState pattern from cloud extensions.
 */
export type CloudMigrationPluginState = {
  jobs: Map<string, MigrationJob>;
  activeJobCount: number;
  diagnostics: MigrationDiagnostics;
  stepHandlers: Map<MigrationStepType, MigrationStepHandler>;
  eventListeners: Set<MigrationEventListener>;
};

export type MigrationDiagnostics = {
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsRolledBack: number;
  stepsExecuted: number;
  stepsSucceeded: number;
  stepsFailed: number;
  integrityChecks: number;
  integrityPassed: number;
  integrityFailed: number;
  totalBytesTransferred: number;
  gatewayAttempts: number;
  gatewaySuccesses: number;
  gatewayFailures: number;
  lastError: string | null;
};

/** Factory for creating a fresh diagnostics object. */
export function createEmptyDiagnostics(): MigrationDiagnostics {
  return {
    jobsCreated: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    jobsRolledBack: 0,
    stepsExecuted: 0,
    stepsSucceeded: 0,
    stepsFailed: 0,
    integrityChecks: 0,
    integrityPassed: 0,
    integrityFailed: 0,
    totalBytesTransferred: 0,
    gatewayAttempts: 0,
    gatewaySuccesses: 0,
    gatewayFailures: 0,
    lastError: null,
  };
}

/** Factory for creating initial plugin state. */
export function createInitialPluginState(): CloudMigrationPluginState {
  return {
    jobs: new Map(),
    activeJobCount: 0,
    diagnostics: createEmptyDiagnostics(),
    stepHandlers: new Map(),
    eventListeners: new Set(),
  };
}

/**
 * Validate a phase transition. Returns true if the transition is allowed.
 */
export function isValidPhaseTransition(from: MigrationPhase, to: MigrationPhase): boolean {
  return MIGRATION_PHASE_TRANSITIONS[from]?.includes(to) ?? false;
}
