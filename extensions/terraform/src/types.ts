/**
 * Terraform — Type Definitions
 *
 * terraform.tfstate parsing, drift detection, plan evaluation, state management.
 */

// ── Terraform State ─────────────────────────────────────────────

export interface TerraformState {
  version: number;
  terraform_version: string;
  serial: number;
  lineage: string;
  outputs: Record<string, TerraformOutput>;
  resources: TerraformResource[];
}

export interface TerraformOutput {
  value: unknown;
  type: string | string[];
  sensitive?: boolean;
}

export interface TerraformResource {
  mode: "managed" | "data";
  type: string;
  name: string;
  provider: string;
  instances: TerraformInstance[];
}

export interface TerraformInstance {
  schema_version: number;
  attributes: Record<string, unknown>;
  private?: string;
  dependencies?: string[];
  sensitive_attributes?: unknown[];
}

// ── Parsed Resource (normalized) ───────────────────────────────

export interface ParsedResource {
  address: string;
  type: string;
  name: string;
  provider: string;
  providerShort: string;
  mode: "managed" | "data";
  attributes: Record<string, unknown>;
  dependencies: string[];
}

// ── Drift Detection ─────────────────────────────────────────────

export interface DriftResult {
  /** State file path or workspace identifier */
  stateId: string;
  /** When drift detection ran */
  detectedAt: string;
  /** Number of resources checked */
  totalResources: number;
  /** Resources with detected drift */
  driftedResources: DriftedResource[];
  /** Resources that could not be checked */
  errorResources: DriftErrorResource[];
  /** Overall summary */
  summary: DriftSummary;
}

export interface DriftedResource {
  address: string;
  type: string;
  name: string;
  provider: string;
  driftedFields: DriftedField[];
}

export interface DriftedField {
  path: string;
  expectedValue: unknown;
  actualValue: unknown;
}

export interface DriftErrorResource {
  address: string;
  error: string;
}

export interface DriftSummary {
  totalDrifted: number;
  totalErrors: number;
  totalClean: number;
  byProvider: Record<string, number>;
  byType: Record<string, number>;
}

// ── Plan Evaluation ─────────────────────────────────────────────

export interface TerraformPlan {
  format_version: string;
  terraform_version: string;
  resource_changes: ResourceChange[];
  output_changes?: Record<string, OutputChange>;
}

export interface ResourceChange {
  address: string;
  type: string;
  name: string;
  provider_name: string;
  mode: "managed" | "data";
  change: Change;
}

export interface Change {
  actions: ("create" | "read" | "update" | "delete" | "no-op")[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  after_unknown?: Record<string, boolean>;
}

export interface OutputChange {
  actions: string[];
  before: unknown;
  after: unknown;
}

export interface PlanSummary {
  totalChanges: number;
  creates: number;
  updates: number;
  deletes: number;
  noOps: number;
  byType: Record<string, { creates: number; updates: number; deletes: number }>;
  byProvider: Record<string, number>;
  affectedAddresses: string[];
  hasDestructiveChanges: boolean;
}

// ── State Lock ──────────────────────────────────────────────────

export interface StateLock {
  id: string;
  stateId: string;
  operation: string;
  lockedBy: string;
  lockedAt: string;
  info?: string;
}

// ── Workspace Management ────────────────────────────────────────

export interface TerraformWorkspace {
  id: string;
  name: string;
  /** Path to state file or remote state config */
  statePath: string;
  /** Backend type: local, s3, azurerm, gcs, etc. */
  backend: string;
  environment: string;
  lastPlanAt?: string;
  lastApplyAt?: string;
  lastDriftCheckAt?: string;
  resourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInput {
  id?: string;
  name: string;
  statePath: string;
  backend?: string;
  environment?: string;
}

// ── Storage ─────────────────────────────────────────────────────

export interface TerraformStorage {
  initialize(): Promise<void>;
  // Workspaces
  saveWorkspace(workspace: TerraformWorkspace): Promise<void>;
  getWorkspace(id: string): Promise<TerraformWorkspace | null>;
  listWorkspaces(): Promise<TerraformWorkspace[]>;
  deleteWorkspace(id: string): Promise<boolean>;
  // Drift history
  saveDriftResult(result: DriftResult): Promise<void>;
  getDriftHistory(stateId: string, limit?: number): Promise<DriftResult[]>;
  // Locks
  acquireLock(lock: StateLock): Promise<boolean>;
  releaseLock(stateId: string, lockId: string): Promise<boolean>;
  getLock(stateId: string): Promise<StateLock | null>;

  close(): Promise<void>;
}
