/**
 * AWS Guardrails & Approval Workflows Types
 *
 * Comprehensive type definitions for production safety controls,
 * approval workflows, audit logging, and rate limiting.
 */

// =============================================================================
// CORE TYPES
// =============================================================================

/**
 * Result type for guardrails operations
 */
export interface GuardrailsOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  warnings?: string[];
}

/**
 * Environment classification
 */
export type Environment = 'production' | 'staging' | 'development' | 'sandbox' | 'unknown';

/**
 * Action severity levels
 */
export type ActionSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Action types for classification
 */
export type ActionType = 
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'terminate'
  | 'stop'
  | 'start'
  | 'reboot'
  | 'modify'
  | 'scale'
  | 'deploy';

/**
 * Day of week for scheduling
 */
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

// =============================================================================
// APPROVAL WORKFLOW TYPES
// =============================================================================

/**
 * Approval status
 */
export type ApprovalStatus = 
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/**
 * Approver definition
 */
export interface Approver {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Email address */
  email: string;
  /** Notification channel */
  channel?: 'email' | 'slack' | 'teams' | 'pagerduty';
  /** Slack/Teams channel or user ID */
  channelId?: string;
  /** Approval weight (for weighted approvals) */
  weight?: number;
}

/**
 * Approval request
 */
export interface ApprovalRequest {
  /** Operation details */
  operation?: Record<string, unknown>;
  /** Required approvers list */
  requiredApprovers?: Approver[];
  /** Requester details */
  requester?: { id: string; name: string; email?: string };
  /** Urgency level */
  urgency?: 'low' | 'medium' | 'high' | 'critical';
  /** Unique request ID */
  id: string;
  /** User who initiated the request */
  requesterId: string;
  /** Requester display name */
  requesterName: string;
  /** Action being requested */
  action: ActionType;
  /** Service (ec2, rds, lambda, etc.) */
  service: string;
  /** Resource identifiers */
  resourceIds: string[];
  /** Resource details */
  resourceDetails?: Record<string, unknown>;
  /** Environment */
  environment: Environment;
  /** Current status */
  status: ApprovalStatus;
  /** Reason for the request */
  reason?: string;
  /** Impact assessment */
  impactAssessment?: ImpactAssessment;
  /** Approvers */
  approvers: Approver[];
  /** Responses received */
  responses: ApprovalResponse[];
  /** Number of approvals required */
  requiredApprovals: number;
  /** Created timestamp */
  createdAt: Date;
  /** Updated timestamp */
  updatedAt: Date;
  /** Expires at */
  expiresAt: Date;
  /** Timeout in minutes */
  timeoutMinutes: number;
  /** Dry run results if applicable */
  dryRunResults?: DryRunResult;
  /** Associated ticket */
  ticketInfo?: TicketInfo;
}

/**
 * Approval response from an approver
 */
export interface ApprovalResponse {
  /** Whether the request was approved */
  approved?: boolean;
  /** When the response was given */
  respondedAt?: Date;
  /** Approver ID */
  approverId: string;
  /** Approver name */
  approverName: string;
  /** Decision */
  decision: 'approved' | 'rejected';
  /** Reason for decision */
  reason?: string;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Impact assessment for an action
 */
export interface ImpactAssessment {
  /** List of affected resources */
  affectedResources?: AffectedResource[];
  /** Downstream dependencies */
  downstreamDependencies?: ResourceDependency[];
  /** Mitigation suggestions */
  mitigationSuggestions?: string[];
  /** Blast radius */
  blastRadius?: 'low' | 'medium' | 'high' | 'critical';
  /** Whether the operation is reversible */
  reversible?: boolean;
  /** Estimated recovery time */
  estimatedRecoveryTime?: string;
  /** Severity level */
  severity: ActionSeverity;
  /** Number of resources affected */
  affectedResourceCount: number;
  /** Affected resource types */
  affectedResourceTypes: string[];
  /** Potential downtime */
  estimatedDowntime?: string;
  /** Cost impact */
  costImpact?: {
    type: 'increase' | 'decrease' | 'none';
    estimatedAmount?: number;
    currency?: string;
  };
  /** Dependencies that might be affected */
  dependencies?: ResourceDependency[];
  /** Rollback possible */
  rollbackPossible: boolean;
  /** Risk factors */
  riskFactors: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Resource dependency
 */
export interface ResourceDependency {
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: string;
  /** Dependency type */
  dependencyType: 'hard' | 'soft';
  /** Impact if resource is removed */
  impact: string;
}

// =============================================================================
// DRY RUN TYPES
// =============================================================================

/**
 * Dry run result
 */
export interface DryRunResult {
  /** Validation errors found */
  validationErrors?: string[];
  /** Would succeed */
  wouldSucceed: boolean;
  /** Resources that would be affected */
  affectedResources: AffectedResource[];
  /** Errors that would occur */
  potentialErrors: string[];
  /** Warnings */
  warnings: string[];
  /** Changes that would be made */
  plannedChanges: PlannedChange[];
  /** Estimated duration */
  estimatedDuration?: string;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Affected resource in dry run
 */
export interface AffectedResource {
  /** Resource type (alias) */
  type?: string;
  /** Resource ID (alias) */
  id?: string;
  /** Impact level */
  impactLevel?: 'low' | 'medium' | 'high' | 'critical';
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: string;
  /** Resource name */
  resourceName?: string;
  /** Current state */
  currentState: string;
  /** Proposed state after action */
  proposedState: string;
  /** Environment */
  environment?: Environment;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Planned change from dry run
 */
export interface PlannedChange {
  /** Resource type */
  resourceType?: string;
  /** Description of change */
  description?: string;
  /** Whether the change is reversible */
  reversible?: boolean;
  /** Resource ID */
  resourceId: string;
  /** Change type */
  changeType: 'create' | 'update' | 'delete' | 'replace';
  /** Attribute being changed */
  attribute?: string;
  /** Current value */
  currentValue?: unknown;
  /** New value */
  newValue?: unknown;
  /** Is destructive */
  isDestructive: boolean;
  /** Is reversible */
  isReversible: boolean;
}

// =============================================================================
// ENVIRONMENT PROTECTION TYPES
// =============================================================================

/**
 * Environment protection configuration
 */
export interface EnvironmentProtection {
  /** Environment name */
  environment: Environment;
  /** Is this environment protected */
  isProtected: boolean;
  /** Protection level */
  protectionLevel: 'full' | 'partial' | 'none';
  /** Actions that require approval */
  approvalRequiredActions: ActionType[];
  /** Actions that are completely blocked */
  blockedActions: ActionType[];
  /** Allowed time windows */
  allowedTimeWindows?: TimeWindow[];
  /** Required tags for resources */
  requiredTags?: RequiredTag[];
  /** Approvers for this environment */
  approvers?: Approver[];
  /** Minimum approvals required */
  minApprovals?: number;
}

/**
 * Time window for allowed operations
 */
export interface TimeWindow {
  /** Days of week */
  days: DayOfWeek[];
  /** Start hour (0-23) */
  startHour: number;
  /** End hour (0-23) */
  endHour: number;
  /** Timezone */
  timezone: string;
}

/**
 * Required tag specification
 */
export interface RequiredTag {
  /** Tag key */
  key: string;
  /** Allowed values (empty means any value) */
  allowedValues?: string[];
  /** Is this tag required */
  required: boolean;
}

// =============================================================================
// AUDIT LOGGING TYPES
// =============================================================================

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** Unique log ID */
  id: string;
  /** Timestamp */
  timestamp: Date;
  /** User who performed the action */
  userId: string;
  /** User display name */
  userName: string;
  /** Session ID */
  sessionId?: string;
  /** Action performed */
  action: ActionType;
  /** Service */
  service: string;
  /** Resource IDs */
  resourceIds: string[];
  /** Environment */
  environment: Environment;
  /** AWS region */
  region: string;
  /** AWS account ID */
  accountId?: string;
  /** Action outcome */
  outcome: 'success' | 'failure' | 'blocked' | 'pending_approval';
  /** Error message if failed */
  errorMessage?: string;
  /** Block reason if blocked */
  blockReason?: string;
  /** Approval request ID if pending */
  approvalRequestId?: string;
  /** Dry run mode */
  dryRun: boolean;
  /** Request parameters (sanitized) */
  requestParams?: Record<string, unknown>;
  /** Response summary */
  responseSummary?: Record<string, unknown>;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Source IP (if available) */
  sourceIp?: string;
  /** User agent */
  userAgent?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Audit log query options
 */
export interface AuditLogQueryOptions {
  /** Start time */
  startTime?: Date;
  /** End time */
  endTime?: Date;
  /** User ID filter */
  userId?: string;
  /** Action filter */
  actions?: ActionType[];
  /** Service filter */
  services?: string[];
  /** Outcome filter */
  outcomes?: ('success' | 'failure' | 'blocked' | 'pending_approval')[];
  /** Environment filter */
  environments?: Environment[];
  /** Resource ID filter */
  resourceId?: string;
  /** Maximum results */
  maxResults?: number;
  /** Pagination token */
  nextToken?: string;
}

/**
 * Audit log query result
 */
export interface AuditLogQueryResult {
  /** Total length of results */
  length?: number;
  /** Slice method for pagination */
  slice?: (start: number, end: number) => AuditLogEntry[];
  /** Log entries */
  entries: AuditLogEntry[];
  /** Total count */
  totalCount: number;
  /** Next token for pagination */
  nextToken?: string;
}

/**
 * Audit log summary statistics
 */
export interface AuditLogSummary {
  /** Total operations count */
  totalOperations?: number;
  /** Successful operations count */
  successfulOperations?: number;
  /** Failed operations count */
  failedOperations?: number;
  /** Blocked operations count */
  blockedOperations?: number;
  /** Time period */
  period: {
    start: Date;
    end: Date;
  };
  /** Total actions */
  totalActions: number;
  /** Successful actions */
  successfulActions: number;
  /** Failed actions */
  failedActions: number;
  /** Blocked actions */
  blockedActions: number;
  /** Pending approvals */
  pendingApprovals: number;
  /** By service */
  byService: Record<string, number>;
  /** By action type */
  byAction: Record<string, number>;
  /** By environment */
  byEnvironment: Record<string, number>;
  /** By user */
  byUser: Record<string, number>;
  /** Top resources */
  topResources: Array<{ resourceId: string; count: number }>;
}

// =============================================================================
// RATE LIMITING TYPES
// =============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Success flag */
  success?: boolean;
  /** Error message */
  error?: string;
  /** Additional data */
  data?: unknown;
  /** Maximum resources per single operation */
  maxResourcesPerOperation: number;
  /** Maximum operations per minute */
  maxOperationsPerMinute: number;
  /** Maximum operations per hour */
  maxOperationsPerHour: number;
  /** Maximum destructive operations per day */
  maxDestructiveOperationsPerDay: number;
  /** Cooldown after bulk operation (seconds) */
  bulkOperationCooldownSeconds: number;
  /** Resource thresholds for confirmation */
  confirmationThreshold: number;
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  /** Success flag */
  success?: boolean;
  /** Error message */
  error?: string;
  /** Additional data */
  data?: unknown;
  /** Current operations this minute */
  operationsThisMinute: number;
  /** Current operations this hour */
  operationsThisHour: number;
  /** Destructive operations today */
  destructiveOperationsToday: number;
  /** Is rate limited */
  isRateLimited: boolean;
  /** Rate limit reason */
  rateLimitReason?: string;
  /** Reset time for current limit */
  resetAt?: Date;
  /** Remaining operations this minute */
  remainingThisMinute: number;
  /** Remaining operations this hour */
  remainingThisHour: number;
}

// =============================================================================
// SAFETY CHECK TYPES
// =============================================================================

/**
 * Safety check configuration
 */
export interface SafetyCheckConfig {
  /** Enable production confirmation */
  confirmProductionChanges: boolean;
  /** Create backup before delete */
  createBackupBeforeDelete: boolean;
  /** Check dependencies before delete */
  checkDependenciesBeforeDelete: boolean;
  /** Prevent changes outside window */
  preventChangesOutsideWindow: boolean;
  /** Required approval for protected environments */
  requireApprovalForProtectedEnvs: boolean;
  /** Dry run by default for destructive operations */
  dryRunByDefault: boolean;
  /** Block operations on tagged resources */
  blockOnProtectedTags: string[];
}

/**
 * Safety check result
 */
export interface SafetyCheckResult {
  /** Map function for iteration */
  map?: <T>(fn: (c: SafetyCheck) => T) => T[];
  /** Filter function for iteration */
  filter?: (fn: (c: SafetyCheck) => boolean) => SafetyCheck[];
  /** All checks passed */
  passed: boolean;
  /** Individual check results */
  checks: SafetyCheck[];
  /** Overall risk level */
  riskLevel: ActionSeverity;
  /** Blocking issues */
  blockingIssues: string[];
  /** Warnings */
  warnings: string[];
  /** Required confirmations */
  requiredConfirmations: string[];
  /** Approval required */
  approvalRequired: boolean;
  /** Dry run recommended */
  dryRunRecommended: boolean;
}

/**
 * Individual safety check
 */
export interface SafetyCheck {
  /** Check name */
  name: string;
  /** Check description */
  description: string;
  /** Passed */
  passed: boolean;
  /** Severity if failed */
  severity: ActionSeverity;
  /** Message */
  message: string;
  /** Is blocking */
  isBlocking: boolean;
}

// =============================================================================
// TICKETING INTEGRATION TYPES
// =============================================================================

/**
 * Ticketing system type
 */
export type TicketingSystem = 'jira' | 'servicenow' | 'pagerduty' | 'github' | 'linear';

/**
 * Ticket info
 */
export interface TicketInfo {
  /** Ticketing system */
  system: TicketingSystem;
  /** Ticket ID/number */
  ticketId: string;
  /** Ticket URL */
  ticketUrl: string;
  /** Ticket status */
  status: string;
  /** Created at */
  createdAt: Date;
}

/**
 * Ticketing integration config
 */
export interface TicketingIntegrationConfig {
  /** System type */
  system: TicketingSystem;
  /** Is enabled */
  enabled: boolean;
  /** API endpoint */
  endpoint?: string;
  /** Project/instance key */
  projectKey?: string;
  /** Auto-create tickets for approvals */
  autoCreateTickets: boolean;
  /** Required fields for ticket creation */
  requiredFields: string[];
  /** Default field values */
  defaultValues?: Record<string, string>;
}

// =============================================================================
// CHANGE REQUEST TYPES
// =============================================================================

/**
 * Change request
 */
export interface ChangeRequest {
  /** Requester details */
  requester?: { id: string; name: string; email?: string };
  /** Scheduled time */
  scheduledTime?: Date;
  /** Planned changes */
  plannedChanges?: PlannedChange[];
  /** Affected resources */
  affectedResources?: AffectedResource[];
  /** Estimated duration in minutes */
  estimatedDurationMinutes?: string;
  /** Unique ID */
  id: string;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Change type */
  changeType: 'standard' | 'normal' | 'emergency';
  /** Priority */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Requested by */
  requestedBy: string;
  /** Assigned to */
  assignedTo?: string;
  /** Status */
  status: 'draft' | 'pending_review' | 'approved' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
  /** Planned actions */
  plannedActions: PlannedAction[];
  /** Impact assessment */
  impactAssessment: ImpactAssessment;
  /** Rollback plan */
  rollbackPlan?: string;
  /** Test plan */
  testPlan?: string;
  /** Scheduled start */
  scheduledStart?: Date;
  /** Scheduled end */
  scheduledEnd?: Date;
  /** Actual start */
  actualStart?: Date;
  /** Actual end */
  actualEnd?: Date;
  /** Approval request */
  approvalRequest?: ApprovalRequest;
  /** Created at */
  createdAt: Date;
  /** Updated at */
  updatedAt: Date;
  /** Notes */
  notes?: string;
}

/**
 * Planned action in a change request
 */
export interface PlannedAction {
  /** Order/sequence */
  order: number;
  /** Action description */
  description: string;
  /** Service */
  service: string;
  /** Action type */
  actionType: ActionType;
  /** Target resources */
  targetResources: string[];
  /** Parameters */
  parameters?: Record<string, unknown>;
  /** Expected outcome */
  expectedOutcome: string;
  /** Validation steps */
  validationSteps?: string[];
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Guardrails manager configuration
 */
export interface GuardrailsManagerConfig {
  /** Dry run by default for destructive operations */
  dryRunByDefault?: boolean;
  /** Require approval for destructive operations */
  requireApprovalForDestructive?: boolean;
  /** Audit all operations */
  auditAllOperations?: boolean;
  /** Default approval timeout in hours */
  defaultApprovalTimeoutHours?: number;
  /** Maximum blast radius allowed */
  maxBlastRadius?: 'low' | 'medium' | 'high' | 'critical';
  /** Default region */
  defaultRegion?: string;
  /** Environment detection tag key */
  environmentTagKey?: string;
  /** Default environment if not tagged */
  defaultEnvironment?: Environment;
  /** Rate limit config */
  rateLimits?: Partial<RateLimitConfig>;
  /** Safety check config */
  safetyChecks?: Partial<SafetyCheckConfig>;
  /** Environment protections */
  environmentProtections?: EnvironmentProtection[];
  /** Default approvers */
  defaultApprovers?: Approver[];
  /** Default approval timeout (minutes) */
  defaultApprovalTimeout?: number;
  /** Ticketing integration */
  ticketingIntegration?: TicketingIntegrationConfig;
  /** Audit log storage */
  auditLogStorage?: 'memory' | 'dynamodb' | 's3' | 'cloudwatch';
  /** Audit log retention days */
  auditLogRetentionDays?: number;
}

// =============================================================================
// ACTION CLASSIFICATION
// =============================================================================

/**
 * Action classification for guardrails
 */
export interface ActionClassification {
  /** Category of action */
  category?: 'compute' | 'storage' | 'database' | 'network' | 'security' | 'other';
  /** Action type */
  action: ActionType;
  /** Service */
  service: string;
  /** Severity */
  severity: ActionSeverity;
  /** Is destructive */
  isDestructive: boolean;
  /** Is reversible */
  isReversible: boolean;
  /** Requires approval in protected envs */
  requiresApproval: boolean;
  /** Requires dry run */
  requiresDryRun: boolean;
  /** Can affect multiple resources */
  canAffectMultiple: boolean;
}

/**
 * Default action classifications
 */
export const DEFAULT_ACTION_CLASSIFICATIONS: ActionClassification[] = [
  // Critical - Destructive and irreversible
  {
      action: 'terminate', service: '*', severity: 'critical', isDestructive: true, isReversible: false, requiresApproval: true, requiresDryRun: true, canAffectMultiple: true,
      category: undefined
  },
  {
      action: 'delete', service: '*', severity: 'critical', isDestructive: true, isReversible: false, requiresApproval: true, requiresDryRun: true, canAffectMultiple: true,
      category: undefined
  },
  
  // High - Significant changes
  {
      action: 'modify', service: '*', severity: 'high', isDestructive: false, isReversible: true, requiresApproval: true, requiresDryRun: true, canAffectMultiple: true,
      category: undefined
  },
  {
      action: 'stop', service: '*', severity: 'high', isDestructive: false, isReversible: true, requiresApproval: true, requiresDryRun: false, canAffectMultiple: true,
      category: undefined
  },
  {
      action: 'reboot', service: '*', severity: 'high', isDestructive: false, isReversible: true, requiresApproval: true, requiresDryRun: false, canAffectMultiple: true,
      category: undefined
  },
  {
      action: 'scale', service: '*', severity: 'high', isDestructive: false, isReversible: true, requiresApproval: true, requiresDryRun: true, canAffectMultiple: false,
      category: undefined
  },
  {
      action: 'deploy', service: '*', severity: 'high', isDestructive: false, isReversible: true, requiresApproval: true, requiresDryRun: true, canAffectMultiple: false,
      category: undefined
  },
  
  // Medium - Standard operations
  {
      action: 'update', service: '*', severity: 'medium', isDestructive: false, isReversible: true, requiresApproval: false, requiresDryRun: true, canAffectMultiple: true,
      category: undefined
  },
  {
      action: 'create', service: '*', severity: 'medium', isDestructive: false, isReversible: true, requiresApproval: false, requiresDryRun: false, canAffectMultiple: false,
      category: undefined
  },
  {
      action: 'start', service: '*', severity: 'medium', isDestructive: false, isReversible: true, requiresApproval: false, requiresDryRun: false, canAffectMultiple: true,
      category: undefined
  },
  
  // Low - Read operations
  {
      action: 'read', service: '*', severity: 'low', isDestructive: false, isReversible: true, requiresApproval: false, requiresDryRun: false, canAffectMultiple: false,
      category: undefined
  },
];

// =============================================================================
// BACKUP TYPES
// =============================================================================

/**
 * Pre-operation backup
 */
export interface PreOperationBackup {
  /** Operation that triggered the backup */
  operation?: string;
  /** Backup ID */
  id: string;
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: string;
  /** Backup type (snapshot, export, etc.) */
  backupType: 'snapshot' | 'export' | 'ami' | 'configuration';
  /** Backup reference (snapshot ID, S3 path, etc.) */
  backupReference: string;
  /** Created at */
  createdAt: Date;
  /** Expires at */
  expiresAt?: Date;
  /** Operation that triggered backup */
  triggeringOperation: string;
  /** Can restore */
  canRestore: boolean;
  /** Restore instructions */
  restoreInstructions?: string;
}

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

/**
 * Notification channel config
 */
export interface NotificationChannelConfig {
  /** Channel type */
  type: 'email' | 'slack' | 'teams' | 'sns' | 'webhook';
  /** Is enabled */
  enabled: boolean;
  /** Endpoint (email, URL, ARN) */
  endpoint: string;
  /** Events to notify */
  events: NotificationEvent[];
}

/**
 * Notification events
 */
export type NotificationEvent = 
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'approval_expired'
  | 'action_blocked'
  | 'rate_limit_exceeded'
  | 'high_risk_action'
  | 'safety_check_failed';

/**
 * Notification payload
 */
export interface NotificationPayload {
  /** Event type */
  event: NotificationEvent;
  /** Timestamp */
  timestamp: Date;
  /** Title */
  title: string;
  /** Message */
  message: string;
  /** Severity */
  severity: ActionSeverity;
  /** Additional data */
  data?: Record<string, unknown>;
  /** Action URL */
  actionUrl?: string;
}

// =============================================================================
// POLICY TYPES
// =============================================================================

/**
 * Guardrails policy
 */
export interface GuardrailsPolicy {
  success: unknown;
  error: unknown;
  data: unknown;
  /** Policy ID */
  id: string;
  /** Policy name */
  name: string;
  /** Description */
  description: string;
  /** Is enabled */
  enabled: boolean;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Conditions for policy to apply */
  conditions: PolicyCondition[];
  /** Actions to take */
  actions: PolicyAction[];
  /** Created at */
  createdAt: Date;
  /** Updated at */
  updatedAt: Date;
}

/**
 * Policy condition
 */
export interface PolicyCondition {
  /** Condition type */
  type: 'environment' | 'service' | 'action' | 'tag' | 'time' | 'user' | 'resource_count';
  /** Operator */
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in';
  /** Value to compare */
  value: string | string[] | number;
}

/**
 * Policy action
 */
export interface PolicyAction {
  /** Action type */
  type: 'require_approval' | 'block' | 'warn' | 'audit' | 'notify' | 'require_dry_run' | 'rate_limit';
  /** Action parameters */
  params?: Record<string, unknown>;
}

// =============================================================================
// OPERATION CONTEXT
// =============================================================================

/**
 * Operation context for guardrails evaluation
 */
export interface OperationContext {
  /** User performing the operation */
  userId: string;
  /** User name */
  userName: string;
  /** Session ID */
  sessionId?: string;
  /** Action being performed */
  action: ActionType;
  /** Service */
  service: string;
  /** Resource IDs */
  resourceIds: string[];
  /** Resource type */
  resourceType: string;
  /** Environment (if known) */
  environment?: Environment;
  /** Resource tags */
  resourceTags?: Record<string, string>;
  /** AWS region */
  region: string;
  /** AWS account ID */
  accountId?: string;
  /** Request parameters */
  requestParams?: Record<string, unknown>;
  /** Is dry run */
  isDryRun?: boolean;
  /** Has user confirmation */
  hasConfirmation?: boolean;
  /** Approval request ID */
  approvalRequestId?: string;
}

/**
 * Guardrails evaluation result
 */
export interface GuardrailsEvaluationResult {
  /** Required approvers for this operation */
  requiredApprovers?: Approver[];
  /** Whether operation is blocked by policy */
  blockedByPolicy?: boolean;
  /** List of blocking policy names */
  blockingPolicies?: string[];
  /** Whether a change request is required */
  requiresChangeRequest?: boolean;
  /** Whether a backup is required */
  requiresBackup?: boolean;
  /** Whether within allowed hours */
  withinAllowedHours?: boolean;
  /** Whether rate limited (alias) */
  rateLimited?: boolean;
  /** Risk level of the operation */
  riskLevel?: ActionSeverity;
  /** Action is allowed */
  allowed: boolean;
  /** Requires confirmation */
  requiresConfirmation: boolean;
  /** Requires approval */
  requiresApproval: boolean;
  /** Requires dry run first */
  requiresDryRun: boolean;
  /** Is rate limited */
  isRateLimited: boolean;
  /** Block reasons */
  blockReasons: string[];
  /** Warnings */
  warnings: string[];
  /** Applied policies */
  appliedPolicies: string[];
  /** Safety check result */
  safetyCheckResult: SafetyCheckResult;
  /** Impact assessment */
  impactAssessment?: ImpactAssessment;
  /** Suggested actions */
  suggestedActions: string[];
}
