/**
 * Team Collaboration Types
 *
 * Defines types for team collaboration features including:
 * - Workspaces & Projects
 * - Approval Workflows
 * - Comments & Discussions
 * - Mentions & Notifications
 * - Shared Templates Library
 */

// =============================================================================
// Workspace Types
// =============================================================================

export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  
  // Ownership
  ownerId: string;
  ownerType: 'user' | 'team';
  
  // Settings
  settings: WorkspaceSettings;
  
  // Visibility
  visibility: 'private' | 'internal' | 'public';
  
  // Status
  archived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface WorkspaceSettings {
  // Default environment for deployments
  defaultEnvironment?: string;
  
  // Require approvals for all deployments
  requireApprovals: boolean;
  
  // Auto-archive inactive projects after N days (0 = never)
  autoArchiveDays: number;
  
  // Allowed regions for resources
  allowedRegions?: string[];
  
  // Cost budget (monthly)
  monthlyBudget?: number;
  
  // Notification preferences
  notifications: WorkspaceNotificationSettings;
  
  // Integration settings
  integrations: WorkspaceIntegrations;
}

export interface WorkspaceNotificationSettings {
  deploymentStarted: boolean;
  deploymentCompleted: boolean;
  deploymentFailed: boolean;
  approvalRequired: boolean;
  approvalCompleted: boolean;
  commentAdded: boolean;
  memberJoined: boolean;
  budgetAlert: boolean;
}

export interface WorkspaceIntegrations {
  slack?: SlackIntegration;
  teams?: TeamsIntegration;
  webhook?: WebhookIntegration;
}

export interface SlackIntegration {
  enabled: boolean;
  workspaceId: string;
  channelId: string;
  channelName: string;
  botToken: string; // Encrypted
  webhookUrl?: string;
  notifyOn: NotificationTrigger[];
}

export interface TeamsIntegration {
  enabled: boolean;
  tenantId: string;
  teamId: string;
  channelId: string;
  channelName: string;
  webhookUrl: string;
  notifyOn: NotificationTrigger[];
}

export interface WebhookIntegration {
  enabled: boolean;
  url: string;
  secret: string; // For signature verification
  notifyOn: NotificationTrigger[];
}

export type NotificationTrigger =
  | 'deployment.started'
  | 'deployment.completed'
  | 'deployment.failed'
  | 'approval.required'
  | 'approval.approved'
  | 'approval.rejected'
  | 'comment.created'
  | 'mention'
  | 'budget.warning'
  | 'budget.exceeded';

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  addedAt: string;
  addedBy: string;
  
  // Notification preferences (override workspace defaults)
  notificationOverrides?: Partial<WorkspaceNotificationSettings>;
}

export type WorkspaceRole = 'owner' | 'admin' | 'maintainer' | 'developer' | 'viewer';

// =============================================================================
// Project Types
// =============================================================================

export interface Project {
  id: string;
  workspaceId: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  
  // Repository connection
  repository?: RepositoryConnection;
  
  // Environment configurations
  environments: ProjectEnvironment[];
  
  // Default settings
  settings: ProjectSettings;
  
  // Tags for organization
  tags: string[];
  
  // Status
  status: 'active' | 'paused' | 'archived';
  archivedAt?: string;
  archivedBy?: string;
  
  // Stats
  deploymentCount: number;
  lastDeploymentAt?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface RepositoryConnection {
  provider: 'github' | 'gitlab' | 'bitbucket' | 'codecommit';
  url: string;
  branch: string;
  path?: string; // Subdirectory for monorepos
  
  // Auto-deploy settings
  autoDeploy: boolean;
  autoDeployBranches?: string[]; // e.g., ['main', 'release/*']
  
  // Webhook ID for this connection
  webhookId?: string;
}

export interface ProjectEnvironment {
  id: string;
  name: string; // e.g., 'development', 'staging', 'production'
  slug: string;
  
  // AWS target
  awsAccountId?: string;
  awsRegion: string;
  
  // Approval requirements
  requiresApproval: boolean;
  requiredApprovers: number;
  approverGroups?: string[]; // Team IDs that can approve
  
  // Protection rules
  protectionRules: EnvironmentProtectionRule[];
  
  // Variables and secrets
  variables: EnvironmentVariable[];
  
  // Lock status
  locked: boolean;
  lockedBy?: string;
  lockedAt?: string;
  lockReason?: string;
}

export interface EnvironmentProtectionRule {
  type: 'schedule' | 'branch' | 'tag' | 'manual';
  config: Record<string, unknown>;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  sensitive: boolean; // If true, value is encrypted
  scope: 'build' | 'runtime' | 'both';
}

export interface ProjectSettings {
  // Default IaC format
  iacFormat: 'terraform' | 'cloudformation' | 'cdk' | 'pulumi';
  
  // Auto-plan on PR
  autoPlanOnPR: boolean;
  
  // Require plan before apply
  requirePlanBeforeApply: boolean;
  
  // Cost estimation
  enableCostEstimation: boolean;
  costThresholdWarning?: number;
  costThresholdBlock?: number;
  
  // Drift detection
  enableDriftDetection: boolean;
  driftDetectionSchedule?: string; // Cron expression
  
  // Notifications
  notifyOnDrift: boolean;
}

// =============================================================================
// Approval Workflow Types
// =============================================================================

export interface ApprovalWorkflow {
  id: string;
  tenantId: string;
  workspaceId: string;
  projectId?: string;
  name: string;
  description?: string;
  
  // Workflow definition
  stages: ApprovalStage[];
  
  // Trigger conditions
  triggers: ApprovalTrigger[];
  
  // Status
  enabled: boolean;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ApprovalStage {
  id: string;
  name: string;
  order: number;
  
  // Who can approve
  approvers: ApproverDefinition[];
  
  // How many approvals needed
  requiredApprovals: number;
  
  // Timeout
  timeoutHours: number;
  timeoutAction: 'reject' | 'escalate' | 'auto-approve';
  escalateTo?: string[]; // User/team IDs
  
  // Conditions to skip this stage
  skipConditions?: ApprovalCondition[];
}

export interface ApproverDefinition {
  type: 'user' | 'team' | 'role' | 'codeowner';
  id?: string; // User or team ID
  role?: WorkspaceRole;
}

export interface ApprovalTrigger {
  type: 'environment' | 'cost' | 'resource_type' | 'change_count' | 'schedule';
  condition: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'matches';
  value: string | number;
}

export interface ApprovalCondition {
  type: 'environment' | 'user_role' | 'time_of_day' | 'change_type';
  operator: 'equals' | 'not_equals' | 'in' | 'not_in';
  value: string | string[];
}

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  workspaceId: string;
  projectId: string;
  workflowId: string;
  
  // What's being approved
  targetType: 'deployment' | 'plan' | 'change_request';
  targetId: string;
  targetName: string;
  
  // Request details
  title: string;
  description?: string;
  changes: ApprovalChangesSummary;
  
  // Requestor
  requestedBy: string;
  requestedAt: string;
  
  // Current state
  status: ApprovalRequestStatus;
  currentStageId: string;
  
  // Stage approvals
  stageApprovals: StageApproval[];
  
  // Resolution
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: 'approved' | 'rejected' | 'cancelled' | 'expired';
  resolutionNote?: string;
  
  // Metadata
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export type ApprovalRequestStatus = 
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export interface ApprovalChangesSummary {
  resourcesAdded: number;
  resourcesModified: number;
  resourcesDeleted: number;
  estimatedCostChange?: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedEnvironments: string[];
  highlights: string[]; // Key changes to highlight
}

export interface StageApproval {
  stageId: string;
  stageName: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  approvals: IndividualApproval[];
  requiredApprovals: number;
  startedAt?: string;
  completedAt?: string;
}

export interface IndividualApproval {
  userId: string;
  userName: string;
  decision: 'approved' | 'rejected' | 'pending';
  comment?: string;
  decidedAt?: string;
}

// =============================================================================
// Comment & Discussion Types
// =============================================================================

export interface Comment {
  id: string;
  tenantId: string;
  
  // What the comment is on
  targetType: CommentTargetType;
  targetId: string;
  
  // Thread support
  parentId?: string; // For replies
  threadId: string; // Root comment ID or self if root
  
  // Content
  content: string;
  contentFormat: 'markdown' | 'plain';
  
  // Mentions
  mentions: Mention[];
  
  // Attachments
  attachments: CommentAttachment[];
  
  // Reactions
  reactions: CommentReaction[];
  
  // Author
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  
  // Status
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  
  // Edit history
  edited: boolean;
  editedAt?: string;
  editHistory?: CommentEdit[];
  
  // Deletion
  deleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

export type CommentTargetType = 
  | 'workspace'
  | 'project'
  | 'deployment'
  | 'plan'
  | 'approval_request'
  | 'template'
  | 'resource';

export interface Mention {
  type: 'user' | 'team' | 'all';
  id?: string;
  name: string;
  startIndex: number;
  endIndex: number;
}

export interface CommentAttachment {
  id: string;
  type: 'image' | 'file' | 'link' | 'code';
  name: string;
  url?: string;
  content?: string;
  mimeType?: string;
  size?: number;
}

export interface CommentReaction {
  emoji: string;
  users: string[]; // User IDs
  count: number;
}

export interface CommentEdit {
  content: string;
  editedAt: string;
  editedBy: string;
}

export interface Discussion {
  id: string;
  tenantId: string;
  workspaceId: string;
  projectId?: string;
  
  // Discussion details
  title: string;
  category: DiscussionCategory;
  
  // Root comment
  rootCommentId: string;
  
  // Stats
  commentCount: number;
  participantCount: number;
  lastActivityAt: string;
  
  // Status
  status: 'open' | 'closed' | 'locked';
  closedAt?: string;
  closedBy?: string;
  closeReason?: string;
  
  // Pinned
  pinned: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
  
  // Labels
  labels: string[];
  
  // Metadata
  createdAt: string;
  createdBy: string;
}

export type DiscussionCategory = 
  | 'general'
  | 'question'
  | 'announcement'
  | 'idea'
  | 'issue'
  | 'rfc'; // Request for comments

// =============================================================================
// Notification Types
// =============================================================================

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  
  // Notification content
  type: NotificationType;
  title: string;
  body: string;
  
  // Related entity
  targetType?: string;
  targetId?: string;
  targetUrl?: string;
  
  // Actor (who triggered the notification)
  actorId?: string;
  actorName?: string;
  actorAvatar?: string;
  
  // Status
  read: boolean;
  readAt?: string;
  
  // Delivery
  channels: NotificationChannel[];
  deliveredVia: NotificationChannel[];
  
  // Metadata
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export type NotificationType =
  | 'mention'
  | 'comment'
  | 'reply'
  | 'approval_request'
  | 'approval_decision'
  | 'deployment_started'
  | 'deployment_completed'
  | 'deployment_failed'
  | 'member_added'
  | 'member_removed'
  | 'role_changed'
  | 'budget_alert'
  | 'drift_detected'
  | 'security_alert';

export type NotificationChannel = 'in_app' | 'email' | 'slack' | 'teams' | 'webhook';

export interface NotificationPreferences {
  userId: string;
  tenantId: string;
  
  // Global settings
  enabled: boolean;
  quietHoursStart?: string; // HH:mm
  quietHoursEnd?: string;
  timezone: string;
  
  // Channel preferences
  channels: {
    inApp: boolean;
    email: boolean;
    slack: boolean;
    teams: boolean;
  };
  
  // Per-type preferences
  typePreferences: Record<NotificationType, {
    enabled: boolean;
    channels: NotificationChannel[];
  }>;
  
  // Workspace-specific overrides
  workspaceOverrides: Record<string, Partial<NotificationPreferences>>;
}

// =============================================================================
// Shared Templates Library Types
// =============================================================================

export interface SharedTemplate {
  id: string;
  tenantId: string;
  
  // Template info
  name: string;
  slug: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  
  // Version info
  version: string;
  versions: TemplateVersion[];
  
  // Content
  type: 'infrastructure' | 'workflow' | 'policy' | 'approval';
  content: TemplateContent;
  
  // Parameters
  parameters: TemplateParameter[];
  
  // Usage stats
  usageCount: number;
  lastUsedAt?: string;
  
  // Sharing
  visibility: 'private' | 'workspace' | 'organization' | 'public';
  sharedWith: TemplateShare[];
  
  // Ratings
  rating: number;
  ratingCount: number;
  
  // Ownership
  ownerId: string;
  ownerType: 'user' | 'team' | 'organization';
  
  // Status
  status: 'draft' | 'published' | 'deprecated' | 'archived';
  publishedAt?: string;
  deprecatedAt?: string;
  deprecationMessage?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type TemplateCategory =
  | 'compute'
  | 'networking'
  | 'storage'
  | 'database'
  | 'security'
  | 'monitoring'
  | 'cicd'
  | 'serverless'
  | 'containers'
  | 'ml'
  | 'analytics'
  | 'other';

export interface TemplateVersion {
  version: string;
  changelog: string;
  content: TemplateContent;
  createdAt: string;
  createdBy: string;
  deprecated?: boolean;
}

export interface TemplateContent {
  format: 'terraform' | 'cloudformation' | 'cdk' | 'pulumi' | 'json' | 'yaml';
  source: string;
  
  // Optional rendered preview
  preview?: string;
  
  // Required providers/modules
  dependencies?: TemplateDependency[];
}

export interface TemplateDependency {
  type: 'provider' | 'module' | 'package';
  name: string;
  version?: string;
  source?: string;
}

export interface TemplateParameter {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'list' | 'map' | 'object';
  required: boolean;
  default?: unknown;
  validation?: ParameterValidation;
  options?: unknown[]; // For enums
  sensitive?: boolean;
}

export interface ParameterValidation {
  pattern?: string; // Regex
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  allowedValues?: unknown[];
}

export interface TemplateShare {
  type: 'user' | 'team' | 'workspace';
  id: string;
  permission: 'view' | 'use' | 'edit';
  sharedAt: string;
  sharedBy: string;
}

export interface TemplateRating {
  id: string;
  templateId: string;
  userId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  review?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateUsage {
  id: string;
  templateId: string;
  templateVersion: string;
  userId: string;
  workspaceId: string;
  projectId?: string;
  usedAt: string;
  parameters: Record<string, unknown>;
  outcome: 'success' | 'failure';
}

// =============================================================================
// Activity Feed Types
// =============================================================================

export interface ActivityEvent {
  id: string;
  tenantId: string;
  workspaceId?: string;
  projectId?: string;
  
  // Event info
  type: ActivityEventType;
  action: string;
  description: string;
  
  // Actor
  actorId: string;
  actorName: string;
  actorAvatar?: string;
  actorType: 'user' | 'system' | 'integration';
  
  // Target
  targetType: string;
  targetId: string;
  targetName: string;
  targetUrl?: string;
  
  // Additional context
  context?: Record<string, unknown>;
  
  // Related entities
  relatedEntities?: RelatedEntity[];
  
  // Metadata
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
}

export type ActivityEventType =
  | 'workspace'
  | 'project'
  | 'deployment'
  | 'approval'
  | 'comment'
  | 'member'
  | 'template'
  | 'integration'
  | 'security';

export interface RelatedEntity {
  type: string;
  id: string;
  name: string;
}

// =============================================================================
// Service Configuration
// =============================================================================

export interface CollaborationServiceConfig {
  // Storage backend
  storageType: 'dynamodb' | 'postgres' | 'memory';
  
  // Notification settings
  notifications: {
    batchIntervalMs: number;
    maxBatchSize: number;
    retryAttempts: number;
  };
  
  // Comment settings
  comments: {
    maxLength: number;
    maxAttachments: number;
    maxAttachmentSize: number; // bytes
    allowedMimeTypes: string[];
  };
  
  // Template settings
  templates: {
    maxVersions: number;
    maxSize: number; // bytes
  };
  
  // Rate limits
  rateLimits: {
    commentsPerMinute: number;
    notificationsPerMinute: number;
    approvalsPerMinute: number;
  };
  
  // Integrations
  slack?: {
    clientId: string;
    clientSecret: string;
    signingSecret: string;
  };
  
  teams?: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
  };
}

// =============================================================================
// Operation Results
// =============================================================================

export interface CollaborationResult<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}
