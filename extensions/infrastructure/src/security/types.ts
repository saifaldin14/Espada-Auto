/**
 * Infrastructure Security Types
 */

export type RiskLevel = "critical" | "high" | "medium" | "low" | "minimal";
export type Environment = "development" | "staging" | "production" | "disaster-recovery";
export type OperationCategory = "create" | "update" | "delete" | "scale" | "migrate" | "backup" | "restore" | "security" | "network" | "access" | "cost" | "audit";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled" | "escalated";
export type AuditSeverity = "info" | "warning" | "critical";

export type AuditEventType =
  | "operation_requested" | "operation_approved" | "operation_rejected"
  | "operation_started" | "operation_completed" | "operation_failed" | "operation_rolled_back"
  | "permission_granted" | "permission_denied" | "break_glass_activated" | "break_glass_deactivated"
  | "role_assigned" | "role_revoked" | "policy_changed" | "escalation_triggered"
  | "time_window_override" | "access_denied" | "command_executed" | "command_failed"
  | "session_started" | "session_ended";

export type InfrastructurePermission =
  | "infra:read" | "infra:create" | "infra:update" | "infra:delete" | "infra:scale"
  | "infra:migrate" | "infra:backup" | "infra:restore" | "infra:security" | "infra:network"
  | "infra:access" | "infra:audit" | "infra:approve" | "infra:admin" | "infra:break-glass";

export type EscalationPolicy = {
  enabled: boolean;
  timeoutMinutes: number;
  escalateToRole: string;
  notifyOnEscalation: boolean;
  maxEscalations: number;
};

export type ApprovalDecision = {
  approverId: string;
  approverName: string;
  decision: "approved" | "rejected";
  reason?: string;
  timestamp: Date;
  conditions?: ApprovalCondition[];
};

export type ApprovalCondition = {
  type: "time-window" | "parameter-override" | "monitoring-required" | "rollback-plan" | "custom";
  description: string;
  parameters?: Record<string, unknown>;
};

export type ApprovalChainStep = {
  stepNumber: number;
  approverRole: string;
  approverIds?: string[];
  requiredApprovals: number;
  approvals: ApprovalDecision[];
  status: ApprovalStatus;
  deadline?: Date;
  escalationPolicy?: EscalationPolicy;
};

export type ApprovalRequest = {
  id: string;
  operationId: string;
  commandId: string;
  commandName: string;
  parameters: Record<string, unknown>;
  environment: Environment;
  riskLevel: RiskLevel;
  riskScore: number;
  requesterId: string;
  requesterName: string;
  requesterRoles: string[];
  reason: string;
  status: ApprovalStatus;
  approvalChain: ApprovalChainStep[];
  currentStep: number;
  createdAt: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
};

export type ApprovalChain = {
  id: string;
  name: string;
  environment: Environment;
  riskLevel: RiskLevel;
  steps: ApprovalChainStep[];
  expirationMinutes: number;
  escalationPolicy?: EscalationPolicy;
};

export type RoleConstraints = {
  maxOperationsPerHour?: number;
  maxCostPerOperation?: number;
  allowedTimeWindows?: TimeWindow[];
  requiredApprovalForRiskAbove?: RiskLevel;
  excludedOperations?: string[];
};

export type RoleConstraint = RoleConstraints;

export type PermissionScope = {
  environment?: Environment;
  resourceIds?: string[];
  resourcePatterns?: string[];
  operationCategories?: OperationCategory[];
};

export type InfrastructureRole = {
  id: string;
  name: string;
  description: string;
  permissions: InfrastructurePermission[];
  environmentAccess: Environment[];
  resourcePatterns: string[];
  maxRiskLevel: RiskLevel;
  requiresMfa: boolean;
  sessionTimeout: number;
  constraints?: RoleConstraints;
};

export type InfrastructureUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  groups: string[];
  mfaEnabled: boolean;
  lastActivity?: Date;
  metadata?: Record<string, unknown>;
};

export type PermissionCheck = {
  allowed: boolean;
  reason?: string;
  requiredPermissions?: InfrastructurePermission[];
  missingPermissions?: InfrastructurePermission[];
  constraints?: RoleConstraints;
  requiresApproval?: boolean;
  approvalLevel?: RiskLevel;
};

export type PermissionCheckResult = PermissionCheck & {
  requiredPermissions: InfrastructurePermission[];
  missingPermissions: InfrastructurePermission[];
  requiresApproval: boolean;
};

export type TimeWindowSchedule = {
  type: "recurring" | "one-time" | "blackout";
  timezone: string;
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  startDate?: Date;
  endDate?: Date;
  exceptions?: TimeWindowException[];
};

export type TimeWindowException = { date: Date; type: "allow" | "deny"; reason: string; };

export type TimeWindow = {
  id: string;
  name: string;
  description: string;
  schedule: TimeWindowSchedule;
  environments: Environment[];
  operationCategories?: OperationCategory[];
  riskLevels?: RiskLevel[];
  enabled: boolean;
};

export type TimeWindowCheckResult = {
  allowed: boolean;
  currentWindow?: TimeWindow;
  nextAllowedWindow?: { window: TimeWindow; startsAt: Date; };
  reason?: string;
};

export type AuditLogEntry = {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  severity: AuditSeverity;
  actorId: string;
  actorName?: string;
  actorRoles?: string[];
  actorIp?: string;
  operationId?: string;
  commandId?: string;
  commandName?: string;
  environment?: Environment;
  resourceIds?: string[];
  parameters?: Record<string, unknown>;
  result?: "success" | "failure" | "pending";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  parentEventId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
};

export type AuditLogQuery = {
  startDate?: Date;
  endDate?: Date;
  eventTypes?: AuditEventType[];
  actorIds?: string[];
  operationIds?: string[];
  environments?: Environment[];
  severities?: AuditSeverity[];
  results?: ("success" | "failure" | "pending")[];
  sessionId?: string;
  limit?: number;
  offset?: number;
  orderBy?: "timestamp" | "severity";
  orderDirection?: "asc" | "desc";
};

export type AuditLogResult = { entries: AuditLogEntry[]; total: number; hasMore: boolean; };

export type RiskFactor = { name: string; weight: number; score: number; description: string; };

export type RiskMitigation = { type: string; description: string; applied: boolean; scoreReduction: number; };

export type RiskAssessment = {
  commandId: string;
  environment: Environment;
  overallScore: number;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  mitigations: RiskMitigation[];
  requiresApproval: boolean;
  approvalLevel: RiskLevel;
  warnings: string[];
  recommendations: string[];
};

export type RollbackStep = {
  stepNumber: number;
  description: string;
  command: string;
  parameters: Record<string, unknown>;
  resourceIds: string[];
  timeout: number;
  status: "pending" | "executing" | "completed" | "failed" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  canRetry: boolean;
  retryCount?: number;
  output?: unknown;
};

export type RollbackPlan = {
  id: string;
  operationId: string;
  commandId: string;
  commandName?: string;
  environment: Environment;
  createdBy?: string;
  createdAt: Date;
  expiresAt: Date;
  status: "available" | "executing" | "completed" | "failed" | "expired";
  steps: RollbackStep[];
  preRollbackState: Record<string, unknown>;
  estimatedDuration: number;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  metadata?: Record<string, unknown>;
};

export type RollbackExecution = {
  planId: string;
  operationId: string;
  executedBy: string;
  startedAt: Date;
  completedAt?: Date;
  status: "executing" | "completed" | "failed" | "aborted";
  completedSteps: number;
  totalSteps: number;
  errors: RollbackError[];
};

export type RollbackError = { stepNumber: number; error: string; recoverable: boolean; suggestion?: string; };

export type StateSnapshot = {
  id: string;
  planId: string;
  capturedAt: Date;
  resourceId: string;
  resourceType: string;
  state: Record<string, unknown>;
};

export type BreakGlassSession = {
  id: string;
  userId: string;
  userName?: string;
  environment: Environment;
  policyId: string;
  status: "active" | "expired" | "revoked" | "pending";
  reason: { code: string; justification: string; incidentTicket?: string; };
  scope: { resources?: string[]; operations?: string[]; commands?: string[]; };
  activatedAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  revokedBy?: string;
  revokeReason?: string;
  operationsPerformed: { type: string; resource: string; timestamp: Date; details?: Record<string, unknown>; }[];
  extensions?: { timestamp: Date; additionalMinutes: number; justification: string; approvedBy: string; }[];
  postMortemRequired: boolean;
  postMortemCompleted?: boolean;
  postMortemUrl?: string;
  grantedPermissions?: InfrastructurePermission[];
  auditTrail?: string[];
  approvedBy?: string;
  metadata?: Record<string, unknown>;
};

export type BreakGlassReason = {
  code: string;
  name: string;
  description: string;
  requiresIncidentTicket: boolean;
  allowedEnvironments: Environment[];
  maxDuration: number;
};

export type BreakGlassPolicy = {
  id: string;
  name: string;
  description: string;
  environment: Environment;
  allowedRoles: string[];
  requiredApprovers: number;
  maxDurationMinutes: number;
  requiresJustification: boolean;
  requiresIncidentTicket: boolean;
  autoNotify: string[];
  enabled: boolean;
  postMortemRequired?: boolean;
};

export type BreakGlassActivation = { sessionId: string; userId: string; environment: Environment; activatedAt: Date; expiresAt: Date; permissions: InfrastructurePermission[]; };
