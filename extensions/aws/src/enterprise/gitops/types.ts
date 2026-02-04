/**
 * GitOps Integration Types
 *
 * Defines types for Git-based infrastructure management including:
 * - Repository connections (GitHub, GitLab, Bitbucket)
 * - Webhook handling
 * - PR-based infrastructure changes
 * - Drift detection
 * - Plan comments
 */

// =============================================================================
// Git Provider Types
// =============================================================================

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'codecommit' | 'azure_devops';

export interface GitRepository {
  id: string;
  tenantId: string;
  workspaceId: string;
  
  // Provider info
  provider: GitProvider;
  providerRepoId: string;
  
  // Repository details
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  url: string;
  cloneUrl: string;
  
  // IaC configuration
  iacPath: string; // Path to IaC files (e.g., "terraform/", "infrastructure/")
  iacFormat: 'terraform' | 'cloudformation' | 'cdk' | 'pulumi' | 'opentofu';
  
  // Authentication
  credentials: GitCredentials;
  
  // Webhook
  webhookId?: string;
  webhookSecret?: string;
  webhookUrl?: string;
  
  // Settings
  settings: GitRepoSettings;
  
  // Status
  status: 'active' | 'disconnected' | 'error';
  lastSyncAt?: string;
  lastError?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface GitCredentials {
  type: 'token' | 'app' | 'oauth' | 'ssh';
  
  // Token auth
  accessToken?: string; // Encrypted
  
  // GitHub App auth
  appId?: string;
  installationId?: string;
  privateKey?: string; // Encrypted
  
  // OAuth
  refreshToken?: string; // Encrypted
  expiresAt?: string;
  
  // SSH
  sshKeyId?: string;
}

export interface GitRepoSettings {
  // Auto-plan triggers
  autoPlanOnPR: boolean;
  autoPlanBranches: string[]; // e.g., ['main', 'develop', 'release/*']
  
  // Auto-apply settings
  autoApplyEnabled: boolean;
  autoApplyBranches: string[]; // e.g., ['main']
  requireApprovalForAutoApply: boolean;
  
  // PR comment settings
  commentOnPlan: boolean;
  commentOnApply: boolean;
  collapseLargePlans: boolean;
  planCommentThreshold: number; // Collapse if changes > threshold
  
  // Drift detection
  driftDetectionEnabled: boolean;
  driftDetectionSchedule: string; // Cron expression
  driftAutoCreatePR: boolean;
  
  // Branch protection
  protectedEnvironments: Record<string, string[]>; // env -> allowed branches
  
  // Workspace mapping
  workspaceMappings: WorkspaceMapping[];
  
  // Labels
  planLabelPrefix: string;
  applyLabelPrefix: string;
}

export interface WorkspaceMapping {
  path: string; // Path in repo (e.g., "terraform/prod")
  environment: string; // Target environment
  awsAccountId?: string;
  awsRegion?: string;
  variables?: Record<string, string>;
}

// =============================================================================
// Webhook Types
// =============================================================================

export interface WebhookEvent {
  id: string;
  tenantId: string;
  repositoryId: string;
  
  // Event info
  provider: GitProvider;
  eventType: WebhookEventType;
  deliveryId: string;
  
  // Payload
  payload: WebhookPayload;
  headers: Record<string, string>;
  signature?: string;
  
  // Processing
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
  processedAt?: string;
  error?: string;
  
  // Actions taken
  actions: WebhookAction[];
  
  // Metadata
  receivedAt: string;
}

export type WebhookEventType =
  | 'push'
  | 'pull_request'
  | 'pull_request_review'
  | 'issue_comment'
  | 'check_run'
  | 'check_suite'
  | 'deployment'
  | 'deployment_status'
  | 'ping';

export interface WebhookPayload {
  // Common fields
  action?: string;
  sender?: {
    id: string;
    login: string;
    avatarUrl?: string;
  };
  repository?: {
    id: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  };
  
  // Push event
  ref?: string;
  before?: string;
  after?: string;
  commits?: Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  
  // PR event
  pullRequest?: PullRequestInfo;
  
  // Comment event
  comment?: {
    id: string;
    body: string;
    user: { id: string; login: string };
    createdAt: string;
  };
  
  // Check event
  checkRun?: {
    id: string;
    name: string;
    status: string;
    conclusion?: string;
  };
}

export interface PullRequestInfo {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  
  // Branches
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  
  // Author
  author: {
    id: string;
    login: string;
    avatarUrl?: string;
  };
  
  // URLs
  htmlUrl: string;
  diffUrl: string;
  
  // Labels
  labels: string[];
  
  // Reviewers
  requestedReviewers: string[];
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  closedAt?: string;
}

export interface WebhookAction {
  type: 'plan' | 'apply' | 'comment' | 'label' | 'check' | 'notification';
  status: 'pending' | 'running' | 'completed' | 'failed';
  details?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// =============================================================================
// Plan Types
// =============================================================================

export interface InfrastructurePlan {
  id: string;
  tenantId: string;
  workspaceId: string;
  repositoryId: string;
  
  // Trigger info
  triggerType: 'pr' | 'push' | 'manual' | 'drift' | 'schedule';
  triggeredBy: string;
  
  // Git context
  pullRequestId?: string;
  pullRequestNumber?: number;
  commitSha: string;
  branch: string;
  baseBranch?: string;
  
  // Plan details
  iacPath: string;
  environment: string;
  
  // Status
  status: PlanStatus;
  startedAt?: string;
  completedAt?: string;
  
  // Results
  output?: PlanOutput;
  
  // Approval
  requiresApproval: boolean;
  approvalRequestId?: string;
  approvedBy?: string;
  approvedAt?: string;
  
  // Related apply
  applyId?: string;
  
  // Comment tracking
  commentId?: string;
  commentUrl?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

export type PlanStatus =
  | 'pending'
  | 'planning'
  | 'planned'
  | 'plan_failed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'apply_failed'
  | 'cancelled';

export interface PlanOutput {
  // Summary
  hasChanges: boolean;
  changesCount: {
    add: number;
    change: number;
    destroy: number;
    import: number;
  };
  
  // Resources
  resources: PlannedResource[];
  
  // Cost estimation
  costEstimate?: CostEstimate;
  
  // Policy checks
  policyResults?: PolicyCheckResult[];
  
  // Raw output
  planFile?: string; // Path to plan file
  planJson?: string; // JSON representation
  humanReadable: string; // Human-readable plan output
  
  // Logs
  logs: string;
  errorLogs?: string;
}

export interface PlannedResource {
  address: string;
  type: string;
  name: string;
  action: 'create' | 'update' | 'delete' | 'replace' | 'read' | 'no-op';
  
  // Change details
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  changedAttributes?: string[];
  
  // Sensitivity
  hasSensitiveChanges: boolean;
  
  // Dependencies
  dependencies?: string[];
}

export interface CostEstimate {
  currency: string;
  
  // Monthly estimates
  monthlyCostBefore: number;
  monthlyCostAfter: number;
  monthlyDelta: number;
  
  // Resource breakdown
  resourceCosts: Array<{
    address: string;
    type: string;
    monthlyCost: number;
    hourlyCost?: number;
  }>;
  
  // Provider
  provider: 'infracost' | 'aws' | 'custom';
  estimatedAt: string;
}

export interface PolicyCheckResult {
  policyName: string;
  policyType: 'opa' | 'sentinel' | 'checkov' | 'custom';
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  resource?: string;
  remediation?: string;
}

// =============================================================================
// Drift Detection Types
// =============================================================================

export interface DriftDetectionRun {
  id: string;
  tenantId: string;
  workspaceId: string;
  repositoryId: string;
  
  // Configuration
  environment: string;
  iacPath: string;
  
  // Trigger
  triggerType: 'scheduled' | 'manual' | 'webhook';
  triggeredBy?: string;
  
  // Status
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  
  // Results
  hasDrift: boolean;
  driftedResources: DriftedResource[];
  
  // Actions
  pullRequestCreated?: boolean;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  
  // Metadata
  createdAt: string;
}

export interface DriftedResource {
  address: string;
  type: string;
  name: string;
  
  // Drift details
  driftType: 'modified' | 'deleted' | 'unmanaged';
  
  // Changes
  expectedState?: Record<string, unknown>;
  actualState?: Record<string, unknown>;
  changedAttributes: Array<{
    path: string;
    expected: unknown;
    actual: unknown;
  }>;
  
  // Remediation
  remediationAction?: 'import' | 'update' | 'delete' | 'ignore';
}

// =============================================================================
// PR Comment Types
// =============================================================================

export interface PlanComment {
  id: string;
  planId: string;
  repositoryId: string;
  
  // PR info
  pullRequestNumber: number;
  
  // Comment
  commentId: string;
  commentUrl: string;
  
  // Content
  title: string;
  summary: string;
  details: string;
  
  // Status
  status: 'created' | 'updated' | 'deleted';
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// ArgoCD/Flux Compatibility Types
// =============================================================================

export interface GitOpsApplication {
  id: string;
  tenantId: string;
  workspaceId: string;
  
  // Application info
  name: string;
  namespace?: string;
  
  // Source
  repositoryId: string;
  path: string;
  targetRevision: string; // branch, tag, or commit
  
  // Destination
  environment: string;
  cluster?: string;
  
  // Sync policy
  syncPolicy: SyncPolicy;
  
  // Health
  healthStatus: 'healthy' | 'degraded' | 'progressing' | 'suspended' | 'missing' | 'unknown';
  syncStatus: 'synced' | 'out_of_sync' | 'unknown';
  
  // Last sync
  lastSyncedAt?: string;
  lastSyncedRevision?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

export interface SyncPolicy {
  automated: boolean;
  
  // Auto-sync settings
  prune: boolean; // Delete resources not in git
  selfHeal: boolean; // Revert manual changes
  
  // Sync options
  applyOutOfSyncOnly: boolean;
  
  // Retry
  retryLimit: number;
  retryBackoff: {
    duration: string;
    factor: number;
    maxDuration: string;
  };
  
  // Sync windows
  syncWindows?: SyncWindow[];
}

export interface SyncWindow {
  kind: 'allow' | 'deny';
  schedule: string; // Cron expression
  duration: string; // e.g., "1h", "30m"
  applications?: string[];
  namespaces?: string[];
  clusters?: string[];
  manualSync?: boolean;
}

// =============================================================================
// Result Types
// =============================================================================

export interface GitOpsResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}
