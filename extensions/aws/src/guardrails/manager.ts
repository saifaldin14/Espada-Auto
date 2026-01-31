/**
 * AWS Guardrails & Approval Workflows Manager
 *
 * Provides comprehensive production safety controls including:
 * - Approval workflows for destructive operations
 * - Dry-run mode for all mutating operations
 * - Environment protection (dev/staging/prod)
 * - Audit logging for all conversational infrastructure changes
 * - Rate limiting for bulk operations
 * - Safety checks and impact assessments
 */

import { randomUUID } from 'crypto';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeSnapshotsCommand,
  CreateSnapshotCommand,
  DescribeTagsCommand,
} from '@aws-sdk/client-ec2';

import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  CreateDBSnapshotCommand,
  CreateDBClusterSnapshotCommand,
} from '@aws-sdk/client-rds';

import {
  LambdaClient,
  GetFunctionCommand,
  ListVersionsByFunctionCommand,
} from '@aws-sdk/client-lambda';

import {
  S3Client,
  HeadBucketCommand,
  GetBucketTaggingCommand,
  PutBucketVersioningCommand,
} from '@aws-sdk/client-s3';

import {
  SNSClient,
  PublishCommand,
} from '@aws-sdk/client-sns';

import type {
  GuardrailsManagerConfig,
  GuardrailsOperationResult,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalStatus,
  Approver,
  AuditLogEntry,
  AuditLogQueryOptions,
  AuditLogQueryResult,
  AuditLogSummary,
  DryRunResult,
  AffectedResource,
  PlannedChange,
  SafetyCheckResult,
  SafetyCheck,
  SafetyCheckConfig,
  RateLimitConfig,
  RateLimitStatus,
  EnvironmentProtection,
  Environment,
  ActionType,
  ActionSeverity,
  ActionClassification,
  ImpactAssessment,
  ResourceDependency,
  OperationContext,
  GuardrailsEvaluationResult,
  PreOperationBackup,
  ChangeRequest,
  PlannedAction,
  GuardrailsPolicy,
  PolicyCondition,
  NotificationPayload,
  NotificationEvent,
  NotificationChannelConfig,
  TimeWindow,
} from './types.js';

import { DEFAULT_ACTION_CLASSIFICATIONS } from './types.js';

/**
 * Guardrails Manager interface
 */
export interface GuardrailsManager {
  // Approval Workflow
  createApprovalRequest(context: OperationContext, reason?: string): Promise<GuardrailsOperationResult<ApprovalRequest>>;
  getApprovalRequest(requestId: string): Promise<GuardrailsOperationResult<ApprovalRequest>>;
  listApprovalRequests(options?: { status?: ApprovalStatus; userId?: string; maxResults?: number }): Promise<GuardrailsOperationResult<ApprovalRequest[]>>;
  submitApprovalResponse(requestId: string, response: Omit<ApprovalResponse, 'timestamp'>): Promise<GuardrailsOperationResult<ApprovalRequest>>;
  cancelApprovalRequest(requestId: string, reason?: string): Promise<GuardrailsOperationResult<void>>;
  
  // Dry Run
  performDryRun(context: OperationContext): Promise<GuardrailsOperationResult<DryRunResult>>;
  
  // Safety Checks
  runSafetyChecks(context: OperationContext): Promise<GuardrailsOperationResult<SafetyCheckResult>>;
  evaluateGuardrails(context: OperationContext): Promise<GuardrailsOperationResult<GuardrailsEvaluationResult>>;
  
  // Impact Assessment
  assessImpact(context: OperationContext): Promise<GuardrailsOperationResult<ImpactAssessment>>;
  
  // Environment Protection
  getEnvironmentProtection(environment: Environment): EnvironmentProtection | undefined;
  setEnvironmentProtection(protection: EnvironmentProtection): void;
  detectEnvironment(resourceTags: Record<string, string>): Environment;
  isOperationAllowedInTimeWindow(environment: Environment): boolean;
  
  // Audit Logging
  logAction(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<GuardrailsOperationResult<AuditLogEntry>>;
  queryAuditLogs(options: AuditLogQueryOptions): Promise<GuardrailsOperationResult<AuditLogQueryResult>>;
  getAuditLogSummary(startTime: Date, endTime: Date): Promise<GuardrailsOperationResult<AuditLogSummary>>;
  
  // Rate Limiting
  checkRateLimit(userId: string, action: ActionType): RateLimitStatus;
  recordOperation(userId: string, action: ActionType): void;
  getRateLimitConfig(): RateLimitConfig;
  setRateLimitConfig(config: Partial<RateLimitConfig>): void;
  
  // Pre-operation Backups
  createPreOperationBackup(resourceId: string, resourceType: string, operation: string): Promise<GuardrailsOperationResult<PreOperationBackup>>;
  listPreOperationBackups(resourceId?: string): Promise<GuardrailsOperationResult<PreOperationBackup[]>>;
  
  // Change Requests
  createChangeRequest(request: Omit<ChangeRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<GuardrailsOperationResult<ChangeRequest>>;
  getChangeRequest(requestId: string): Promise<GuardrailsOperationResult<ChangeRequest>>;
  updateChangeRequestStatus(requestId: string, status: ChangeRequest['status'], notes?: string): Promise<GuardrailsOperationResult<ChangeRequest>>;
  listChangeRequests(options?: { status?: ChangeRequest['status']; maxResults?: number }): Promise<GuardrailsOperationResult<ChangeRequest[]>>;
  
  // Policies
  addPolicy(policy: Omit<GuardrailsPolicy, 'id' | 'createdAt' | 'updatedAt'>): GuardrailsPolicy;
  getPolicy(policyId: string): GuardrailsPolicy | undefined;
  listPolicies(): GuardrailsPolicy[];
  updatePolicy(policyId: string, updates: Partial<GuardrailsPolicy>): GuardrailsPolicy | undefined;
  removePolicy(policyId: string): boolean;
  
  // Action Classification
  classifyAction(action: ActionType, service: string): ActionClassification;
  
  // Notifications
  sendNotification(payload: NotificationPayload): Promise<GuardrailsOperationResult<void>>;
  configureNotificationChannel(config: NotificationChannelConfig): void;
  
  // Configuration
  getConfig(): GuardrailsManagerConfig;
  updateConfig(config: Partial<GuardrailsManagerConfig>): void;
}

/**
 * Create a Guardrails Manager instance
 */
export function createGuardrailsManager(config: GuardrailsManagerConfig = {}): GuardrailsManager {
  const defaultRegion = config.defaultRegion || 'us-east-1';
  const environmentTagKey = config.environmentTagKey || 'Environment';
  const defaultEnvironment = config.defaultEnvironment || 'unknown';
  
  // In-memory stores (in production, use DynamoDB/S3)
  const approvalRequests = new Map<string, ApprovalRequest>();
  const auditLogs: AuditLogEntry[] = [];
  const preOperationBackups: PreOperationBackup[] = [];
  const changeRequests = new Map<string, ChangeRequest>();
  const policies: GuardrailsPolicy[] = [];
  const notificationChannels: NotificationChannelConfig[] = [];
  
  // Rate limiting tracking
  const operationCounts = new Map<string, { minute: number[]; hour: number[]; day: number[] }>();
  
  // Default configurations
  let rateLimitConfig: RateLimitConfig = {
    maxResourcesPerOperation: 50,
    maxOperationsPerMinute: 30,
    maxOperationsPerHour: 500,
    maxDestructiveOperationsPerDay: 100,
    bulkOperationCooldownSeconds: 60,
    confirmationThreshold: 10,
    ...config.rateLimits,
  };
  
  let safetyCheckConfig: SafetyCheckConfig = {
    confirmProductionChanges: true,
    createBackupBeforeDelete: true,
    checkDependenciesBeforeDelete: true,
    preventChangesOutsideWindow: false,
    requireApprovalForProtectedEnvs: true,
    dryRunByDefault: true,
    blockOnProtectedTags: ['DoNotDelete', 'Protected', 'Critical'],
    ...config.safetyChecks,
  };
  
  // Environment protections
  const environmentProtections = new Map<Environment, EnvironmentProtection>();
  
  // Default protections
  const defaultProtections: EnvironmentProtection[] = config.environmentProtections || [
    {
      environment: 'production',
      isProtected: true,
      protectionLevel: 'full',
      approvalRequiredActions: ['terminate', 'delete', 'modify', 'stop', 'reboot', 'scale'],
      blockedActions: [],
      minApprovals: 2,
    },
    {
      environment: 'staging',
      isProtected: true,
      protectionLevel: 'partial',
      approvalRequiredActions: ['terminate', 'delete'],
      blockedActions: [],
      minApprovals: 1,
    },
    {
      environment: 'development',
      isProtected: false,
      protectionLevel: 'none',
      approvalRequiredActions: [],
      blockedActions: [],
    },
    {
      environment: 'sandbox',
      isProtected: false,
      protectionLevel: 'none',
      approvalRequiredActions: [],
      blockedActions: [],
    },
  ];
  
  for (const protection of defaultProtections) {
    environmentProtections.set(protection.environment, protection);
  }
  
  // Default approvers
  const defaultApprovers: Approver[] = config.defaultApprovers || [];
  const defaultApprovalTimeout = config.defaultApprovalTimeout || 30;
  
  // AWS Clients
  function createEC2Client(region?: string): EC2Client {
    return new EC2Client({ region: region || defaultRegion });
  }
  
  function createRDSClient(region?: string): RDSClient {
    return new RDSClient({ region: region || defaultRegion });
  }
  
  function createLambdaClient(region?: string): LambdaClient {
    return new LambdaClient({ region: region || defaultRegion });
  }
  
  function createS3Client(region?: string): S3Client {
    return new S3Client({ region: region || defaultRegion });
  }
  
  function createSNSClient(region?: string): SNSClient {
    return new SNSClient({ region: region || defaultRegion });
  }
  
  // Helper: Get operation counts for a user
  function getOperationCounts(userId: string): { minute: number[]; hour: number[]; day: number[] } {
    if (!operationCounts.has(userId)) {
      operationCounts.set(userId, { minute: [], hour: [], day: [] });
    }
    return operationCounts.get(userId)!;
  }
  
  // Helper: Clean old timestamps
  function cleanOldTimestamps(counts: { minute: number[]; hour: number[]; day: number[] }): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    counts.minute = counts.minute.filter(t => t > oneMinuteAgo);
    counts.hour = counts.hour.filter(t => t > oneHourAgo);
    counts.day = counts.day.filter(t => t > oneDayAgo);
  }
  
  // Helper: Detect environment from tags
  function detectEnvironmentFromTags(tags: Record<string, string>): Environment {
    const envValue = tags[environmentTagKey]?.toLowerCase();
    if (!envValue) return defaultEnvironment;
    
    if (envValue.includes('prod')) return 'production';
    if (envValue.includes('stag')) return 'staging';
    if (envValue.includes('dev')) return 'development';
    if (envValue.includes('sandbox') || envValue.includes('test')) return 'sandbox';
    
    return defaultEnvironment;
  }
  
  // Helper: Check if current time is within allowed window
  function isWithinTimeWindow(windows: TimeWindow[] | undefined): boolean {
    if (!windows || windows.length === 0) return true;
    
    const now = new Date();
    const currentDay = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] as any;
    const currentHour = now.getHours();
    
    return windows.some(window => {
      if (!window.days.includes(currentDay)) return false;
      return currentHour >= window.startHour && currentHour < window.endHour;
    });
  }
  
  // Helper: Get action classification
  function getActionClassification(action: ActionType, service: string): ActionClassification {
    // Check for service-specific classification first
    const serviceSpecific = DEFAULT_ACTION_CLASSIFICATIONS.find(
      c => c.action === action && c.service === service
    );
    if (serviceSpecific) return serviceSpecific;
    
    // Fall back to wildcard classification
    const wildcard = DEFAULT_ACTION_CLASSIFICATIONS.find(
      c => c.action === action && c.service === '*'
    );
    if (wildcard) return wildcard;
    
    // Default classification
    return {
      action,
      service,
      severity: 'medium',
      isDestructive: false,
      isReversible: true,
      requiresApproval: false,
      requiresDryRun: false,
      canAffectMultiple: false,
    };
  }
  
  // Helper: Evaluate policies
  function evaluatePolicies(context: OperationContext): { matchedPolicies: GuardrailsPolicy[]; actions: Set<string> } {
    const matchedPolicies: GuardrailsPolicy[] = [];
    const actions = new Set<string>();
    
    const enabledPolicies = policies
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    for (const policy of enabledPolicies) {
      let allConditionsMet = true;
      
      for (const condition of policy.conditions) {
        if (!evaluateCondition(condition, context)) {
          allConditionsMet = false;
          break;
        }
      }
      
      if (allConditionsMet) {
        matchedPolicies.push(policy);
        for (const action of policy.actions) {
          actions.add(action.type);
        }
      }
    }
    
    return { matchedPolicies, actions };
  }
  
  // Helper: Evaluate a single policy condition
  function evaluateCondition(condition: PolicyCondition, context: OperationContext): boolean {
    switch (condition.type) {
      case 'environment':
        return evaluateOperator(context.environment || 'unknown', condition.operator, condition.value);
      case 'service':
        return evaluateOperator(context.service, condition.operator, condition.value);
      case 'action':
        return evaluateOperator(context.action, condition.operator, condition.value);
      case 'tag':
        if (!context.resourceTags) return false;
        const tagValue = Object.values(context.resourceTags).find(v => 
          evaluateOperator(v, condition.operator, condition.value)
        );
        return !!tagValue;
      case 'resource_count':
        return evaluateOperator(context.resourceIds.length, condition.operator, condition.value);
      case 'user':
        return evaluateOperator(context.userId, condition.operator, condition.value);
      default:
        return true;
    }
  }
  
  // Helper: Evaluate operator
  function evaluateOperator(actual: string | number, operator: PolicyCondition['operator'], expected: string | string[] | number): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'not_equals':
        return actual !== expected;
      case 'contains':
        return String(actual).includes(String(expected));
      case 'not_contains':
        return !String(actual).includes(String(expected));
      case 'greater_than':
        return Number(actual) > Number(expected);
      case 'less_than':
        return Number(actual) < Number(expected);
      case 'in':
        return Array.isArray(expected) && expected.includes(String(actual));
      case 'not_in':
        return Array.isArray(expected) && !expected.includes(String(actual));
      default:
        return false;
    }
  }
  
  // Helper: Get resource tags from AWS
  async function getResourceTags(resourceId: string, resourceType: string, region: string): Promise<Record<string, string>> {
    try {
      const ec2Client = createEC2Client(region);
      const response = await ec2Client.send(new DescribeTagsCommand({
        Filters: [{ Name: 'resource-id', Values: [resourceId] }],
      }));
      
      const tags: Record<string, string> = {};
      for (const tag of response.Tags || []) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }
      return tags;
    } catch {
      return {};
    }
  }
  
  // Helper: Check resource dependencies
  async function checkDependencies(resourceId: string, resourceType: string, region: string): Promise<ResourceDependency[]> {
    const dependencies: ResourceDependency[] = [];
    
    try {
      if (resourceType === 'ec2:instance' || resourceType.includes('Instance')) {
        // Check for attached volumes
        const ec2Client = createEC2Client(region);
        const instanceResp = await ec2Client.send(new DescribeInstancesCommand({
          InstanceIds: [resourceId],
        }));
        
        const instance = instanceResp.Reservations?.[0]?.Instances?.[0];
        if (instance?.BlockDeviceMappings) {
          for (const bdm of instance.BlockDeviceMappings) {
            if (bdm.Ebs?.VolumeId) {
              dependencies.push({
                resourceId: bdm.Ebs.VolumeId,
                resourceType: 'ec2:volume',
                dependencyType: 'hard',
                impact: 'Volume will be orphaned or deleted depending on DeleteOnTermination setting',
              });
            }
          }
        }
        
        // Check for security groups
        if (instance?.SecurityGroups) {
          for (const sg of instance.SecurityGroups) {
            if (sg.GroupId) {
              dependencies.push({
                resourceId: sg.GroupId,
                resourceType: 'ec2:security-group',
                dependencyType: 'soft',
                impact: 'Security group rules for this instance will become unused',
              });
            }
          }
        }
      }
      
      if (resourceType === 'rds:instance' || resourceType.includes('DBInstance')) {
        const rdsClient = createRDSClient(region);
        const dbResp = await rdsClient.send(new DescribeDBInstancesCommand({
          DBInstanceIdentifier: resourceId,
        }));
        
        const db = dbResp.DBInstances?.[0];
        if (db?.ReadReplicaDBInstanceIdentifiers?.length) {
          for (const replica of db.ReadReplicaDBInstanceIdentifiers) {
            dependencies.push({
              resourceId: replica,
              resourceType: 'rds:instance',
              dependencyType: 'hard',
              impact: 'Read replica will be promoted to standalone or fail',
            });
          }
        }
      }
    } catch {
      // Ignore errors in dependency checking
    }
    
    return dependencies;
  }
  
  return {
    // Approval Workflow
    async createApprovalRequest(context: OperationContext, reason?: string): Promise<GuardrailsOperationResult<ApprovalRequest>> {
      try {
        const classification = getActionClassification(context.action, context.service);
        const environment = context.environment || detectEnvironmentFromTags(context.resourceTags || {});
        const protection = environmentProtections.get(environment);
        
        // Get approvers
        const approvers = protection?.approvers || defaultApprovers;
        if (approvers.length === 0) {
          return {
            success: false,
            message: 'No approvers configured for this environment',
            error: 'no_approvers_configured',
          };
        }
        
        // Perform impact assessment
        const impactResult = await this.assessImpact(context);
        
        // Create dry run results
        const dryRunResult = await this.performDryRun(context);
        
        const request: ApprovalRequest = {
          id: randomUUID(),
          requesterId: context.userId,
          requesterName: context.userName,
          action: context.action,
          service: context.service,
          resourceIds: context.resourceIds,
          resourceDetails: context.requestParams,
          environment,
          status: 'pending',
          reason,
          impactAssessment: impactResult.data,
          approvers,
          responses: [],
          requiredApprovals: protection?.minApprovals || 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + defaultApprovalTimeout * 60 * 1000),
          timeoutMinutes: defaultApprovalTimeout,
          dryRunResults: dryRunResult.data,
        };
        
        approvalRequests.set(request.id, request);
        
        // Send notifications to approvers
        await this.sendNotification({
          event: 'approval_requested',
          timestamp: new Date(),
          title: `Approval Required: ${context.action} on ${context.service}`,
          message: `${context.userName} is requesting to ${context.action} ${context.resourceIds.length} ${context.service} resource(s) in ${environment}. Reason: ${reason || 'Not specified'}`,
          severity: classification.severity,
          data: { requestId: request.id, resourceIds: context.resourceIds },
        });
        
        return {
          success: true,
          data: request,
          message: `Approval request created. Waiting for ${request.requiredApprovals} approval(s). Expires in ${defaultApprovalTimeout} minutes.`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to create approval request',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    
    async getApprovalRequest(requestId: string): Promise<GuardrailsOperationResult<ApprovalRequest>> {
      const request = approvalRequests.get(requestId);
      if (!request) {
        return {
          success: false,
          message: 'Approval request not found',
          error: 'not_found',
        };
      }
      
      // Check for expiration
      if (request.status === 'pending' && new Date() > request.expiresAt) {
        request.status = 'expired';
        request.updatedAt = new Date();
      }
      
      return {
        success: true,
        data: request,
      };
    },
    
    async listApprovalRequests(options?: { status?: ApprovalStatus; userId?: string; maxResults?: number }): Promise<GuardrailsOperationResult<ApprovalRequest[]>> {
      let requests = Array.from(approvalRequests.values());
      
      // Update expired requests
      const now = new Date();
      for (const request of requests) {
        if (request.status === 'pending' && now > request.expiresAt) {
          request.status = 'expired';
          request.updatedAt = now;
        }
      }
      
      // Filter
      if (options?.status) {
        requests = requests.filter(r => r.status === options.status);
      }
      if (options?.userId) {
        requests = requests.filter(r => r.requesterId === options.userId);
      }
      
      // Sort by creation date descending
      requests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      // Limit
      if (options?.maxResults) {
        requests = requests.slice(0, options.maxResults);
      }
      
      return {
        success: true,
        data: requests,
        message: `Found ${requests.length} approval request(s)`,
      };
    },
    
    async submitApprovalResponse(requestId: string, response: Omit<ApprovalResponse, 'timestamp'>): Promise<GuardrailsOperationResult<ApprovalRequest>> {
      const request = approvalRequests.get(requestId);
      if (!request) {
        return {
          success: false,
          message: 'Approval request not found',
          error: 'not_found',
        };
      }
      
      if (request.status !== 'pending') {
        return {
          success: false,
          message: `Approval request is already ${request.status}`,
          error: 'invalid_status',
        };
      }
      
      if (new Date() > request.expiresAt) {
        request.status = 'expired';
        request.updatedAt = new Date();
        return {
          success: false,
          message: 'Approval request has expired',
          error: 'expired',
        };
      }
      
      // Check if approver is valid
      const isValidApprover = request.approvers.some(a => a.id === response.approverId);
      if (!isValidApprover) {
        return {
          success: false,
          message: 'You are not authorized to approve this request',
          error: 'unauthorized',
        };
      }
      
      // Check if already responded
      const existingResponse = request.responses.find(r => r.approverId === response.approverId);
      if (existingResponse) {
        return {
          success: false,
          message: 'You have already responded to this request',
          error: 'already_responded',
        };
      }
      
      // Add response
      request.responses.push({
        ...response,
        timestamp: new Date(),
      });
      request.updatedAt = new Date();
      
      // Check for rejection
      if (response.decision === 'rejected') {
        request.status = 'rejected';
        await this.sendNotification({
          event: 'approval_denied',
          timestamp: new Date(),
          title: `Approval Denied: ${request.action} on ${request.service}`,
          message: `${response.approverName} rejected the request. Reason: ${response.reason || 'Not specified'}`,
          severity: 'high',
          data: { requestId: request.id },
        });
      } else {
        // Check if we have enough approvals
        const approvals = request.responses.filter(r => r.decision === 'approved').length;
        if (approvals >= request.requiredApprovals) {
          request.status = 'approved';
          await this.sendNotification({
            event: 'approval_granted',
            timestamp: new Date(),
            title: `Approval Granted: ${request.action} on ${request.service}`,
            message: `The request has been approved by ${approvals} approver(s).`,
            severity: 'medium',
            data: { requestId: request.id },
          });
        }
      }
      
      return {
        success: true,
        data: request,
        message: `Response recorded. Status: ${request.status}`,
      };
    },
    
    async cancelApprovalRequest(requestId: string, reason?: string): Promise<GuardrailsOperationResult<void>> {
      const request = approvalRequests.get(requestId);
      if (!request) {
        return {
          success: false,
          message: 'Approval request not found',
          error: 'not_found',
        };
      }
      
      if (request.status !== 'pending') {
        return {
          success: false,
          message: `Cannot cancel request with status: ${request.status}`,
          error: 'invalid_status',
        };
      }
      
      request.status = 'cancelled';
      request.updatedAt = new Date();
      
      return {
        success: true,
        message: `Approval request cancelled${reason ? `: ${reason}` : ''}`,
      };
    },
    
    // Dry Run
    async performDryRun(context: OperationContext): Promise<GuardrailsOperationResult<DryRunResult>> {
      try {
        const affectedResources: AffectedResource[] = [];
        const plannedChanges: PlannedChange[] = [];
        const warnings: string[] = [];
        const potentialErrors: string[] = [];
        
        for (const resourceId of context.resourceIds) {
          // Get current resource state
          const tags = await getResourceTags(resourceId, context.resourceType, context.region);
          const environment = detectEnvironmentFromTags(tags);
          
          // Determine proposed state
          let currentState = 'unknown';
          let proposedState = 'unknown';
          
          switch (context.action) {
            case 'terminate':
            case 'delete':
              currentState = 'running';
              proposedState = 'terminated/deleted';
              break;
            case 'stop':
              currentState = 'running';
              proposedState = 'stopped';
              break;
            case 'start':
              currentState = 'stopped';
              proposedState = 'running';
              break;
            case 'modify':
            case 'update':
              currentState = 'current configuration';
              proposedState = 'modified configuration';
              break;
            case 'reboot':
              currentState = 'running';
              proposedState = 'running (rebooted)';
              break;
          }
          
          affectedResources.push({
            resourceId,
            resourceType: context.resourceType,
            currentState,
            proposedState,
            environment,
            tags,
          });
          
          // Create planned change
          const classification = getActionClassification(context.action, context.service);
          plannedChanges.push({
            resourceId,
            changeType: context.action === 'create' ? 'create' : 
                       context.action === 'delete' || context.action === 'terminate' ? 'delete' : 'update',
            isDestructive: classification.isDestructive,
            isReversible: classification.isReversible,
          });
          
          // Check for warnings
          if (environment === 'production' || context.environment === 'production') {
            warnings.push(`Resource ${resourceId} is in production environment`);
          }
          
          if (tags['DoNotDelete'] || tags['Protected']) {
            warnings.push(`Resource ${resourceId} has protection tag`);
          }
          
          // Check dependencies for destructive actions
          if (classification.isDestructive && safetyCheckConfig.checkDependenciesBeforeDelete) {
            const deps = await checkDependencies(resourceId, context.resourceType, context.region);
            if (deps.length > 0) {
              warnings.push(`Resource ${resourceId} has ${deps.length} dependent resource(s)`);
            }
          }
        }
        
        // Check if operation would succeed
        const protection = environmentProtections.get(context.environment || 'unknown');
        if (protection?.blockedActions.includes(context.action)) {
          potentialErrors.push(`Action ${context.action} is blocked in ${context.environment} environment`);
        }
        
        const wouldSucceed = potentialErrors.length === 0;
        
        const result: DryRunResult = {
          wouldSucceed,
          affectedResources,
          potentialErrors,
          warnings,
          plannedChanges,
          estimatedDuration: `${context.resourceIds.length * 5}-${context.resourceIds.length * 15} seconds`,
          timestamp: new Date(),
        };
        
        return {
          success: true,
          data: result,
          message: wouldSucceed 
            ? `Dry run passed. ${affectedResources.length} resource(s) would be affected.`
            : `Dry run failed with ${potentialErrors.length} error(s).`,
          warnings,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to perform dry run',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    
    // Safety Checks
    async runSafetyChecks(context: OperationContext): Promise<GuardrailsOperationResult<SafetyCheckResult>> {
      const checks: SafetyCheck[] = [];
      const blockingIssues: string[] = [];
      const warnings: string[] = [];
      const requiredConfirmations: string[] = [];
      
      const classification = getActionClassification(context.action, context.service);
      const environment = context.environment || detectEnvironmentFromTags(context.resourceTags || {});
      const protection = environmentProtections.get(environment);
      
      // Check 1: Environment protection
      if (protection?.isProtected) {
        const isBlocked = protection.blockedActions.includes(context.action);
        const requiresApproval = protection.approvalRequiredActions.includes(context.action);
        
        checks.push({
          name: 'environment_protection',
          description: 'Check if action is allowed in this environment',
          passed: !isBlocked,
          severity: isBlocked ? 'critical' : requiresApproval ? 'high' : 'low',
          message: isBlocked 
            ? `Action ${context.action} is blocked in ${environment} environment`
            : requiresApproval 
              ? `Action ${context.action} requires approval in ${environment} environment`
              : `Action is allowed in ${environment} environment`,
          isBlocking: isBlocked,
        });
        
        if (isBlocked) {
          blockingIssues.push(`Action ${context.action} is blocked in ${environment} environment`);
        }
      }
      
      // Check 2: Time window
      if (safetyCheckConfig.preventChangesOutsideWindow && protection?.allowedTimeWindows) {
        const inWindow = isWithinTimeWindow(protection.allowedTimeWindows);
        
        checks.push({
          name: 'time_window',
          description: 'Check if current time is within allowed change window',
          passed: inWindow,
          severity: 'high',
          message: inWindow 
            ? 'Within allowed change window'
            : 'Outside allowed change window',
          isBlocking: !inWindow && environment === 'production',
        });
        
        if (!inWindow && environment === 'production') {
          blockingIssues.push('Changes to production are not allowed outside the maintenance window');
        } else if (!inWindow) {
          warnings.push('Outside recommended change window');
        }
      }
      
      // Check 3: Protected tags
      if (context.resourceTags && safetyCheckConfig.blockOnProtectedTags.length > 0) {
        const hasProtectedTag = safetyCheckConfig.blockOnProtectedTags.some(
          tag => context.resourceTags?.[tag] !== undefined
        );
        
        checks.push({
          name: 'protected_tags',
          description: 'Check for protection tags on resources',
          passed: !hasProtectedTag || context.action === 'read',
          severity: 'critical',
          message: hasProtectedTag 
            ? 'Resource has protection tag'
            : 'No protection tags found',
          isBlocking: hasProtectedTag && classification.isDestructive,
        });
        
        if (hasProtectedTag && classification.isDestructive) {
          blockingIssues.push('Cannot perform destructive action on resource with protection tag');
        }
      }
      
      // Check 4: Resource count
      if (context.resourceIds.length > rateLimitConfig.confirmationThreshold) {
        checks.push({
          name: 'bulk_operation',
          description: 'Check if operation affects many resources',
          passed: context.hasConfirmation || false,
          severity: 'medium',
          message: `Operation affects ${context.resourceIds.length} resources (threshold: ${rateLimitConfig.confirmationThreshold})`,
          isBlocking: false,
        });
        
        if (!context.hasConfirmation) {
          requiredConfirmations.push(`This operation will affect ${context.resourceIds.length} resources. Please confirm.`);
        }
      }
      
      // Check 5: Production changes
      if (safetyCheckConfig.confirmProductionChanges && environment === 'production') {
        checks.push({
          name: 'production_confirmation',
          description: 'Require confirmation for production changes',
          passed: context.hasConfirmation || false,
          severity: 'high',
          message: context.hasConfirmation 
            ? 'Production change confirmed'
            : 'Production change requires confirmation',
          isBlocking: false,
        });
        
        if (!context.hasConfirmation) {
          requiredConfirmations.push('This is a production environment. Please confirm the action.');
        }
      }
      
      // Check 6: Dry run for destructive operations
      if (safetyCheckConfig.dryRunByDefault && classification.isDestructive && !context.isDryRun) {
        checks.push({
          name: 'dry_run_recommended',
          description: 'Recommend dry run for destructive operations',
          passed: true, // Not blocking, just a recommendation
          severity: 'medium',
          message: 'Dry run recommended before executing destructive operation',
          isBlocking: false,
        });
        
        warnings.push('Consider running in dry-run mode first to preview changes');
      }
      
      // Check 7: Rate limiting
      const rateStatus = this.checkRateLimit(context.userId, context.action);
      if (rateStatus.isRateLimited) {
        checks.push({
          name: 'rate_limit',
          description: 'Check rate limiting status',
          passed: false,
          severity: 'high',
          message: rateStatus.rateLimitReason || 'Rate limit exceeded',
          isBlocking: true,
        });
        
        blockingIssues.push(rateStatus.rateLimitReason || 'Rate limit exceeded');
      }
      
      // Determine overall result
      const passed = checks.every(c => c.passed || !c.isBlocking);
      const approvalRequired = Boolean(protection?.isProtected && 
        safetyCheckConfig.requireApprovalForProtectedEnvs &&
        protection.approvalRequiredActions.includes(context.action));
      
      // Determine risk level
      let riskLevel: ActionSeverity = 'low';
      if (classification.isDestructive) riskLevel = 'critical';
      else if (environment === 'production') riskLevel = 'high';
      else if (context.resourceIds.length > 10) riskLevel = 'medium';
      
      const result: SafetyCheckResult = {
        passed,
        checks,
        riskLevel,
        blockingIssues,
        warnings,
        requiredConfirmations,
        approvalRequired,
        dryRunRecommended: classification.isDestructive && !context.isDryRun,
      };
      
      return {
        success: true,
        data: result,
        message: passed 
          ? `Safety checks passed${warnings.length > 0 ? ` with ${warnings.length} warning(s)` : ''}`
          : `Safety checks failed: ${blockingIssues.join('; ')}`,
        warnings,
      };
    },
    
    async evaluateGuardrails(context: OperationContext): Promise<GuardrailsOperationResult<GuardrailsEvaluationResult>> {
      try {
        // Run safety checks
        const safetyResult = await this.runSafetyChecks(context);
        if (!safetyResult.success || !safetyResult.data) {
          return {
            success: false,
            message: 'Failed to evaluate safety checks',
            error: safetyResult.error,
          };
        }
        
        // Evaluate policies
        const { matchedPolicies, actions: policyActions } = evaluatePolicies(context);
        
        // Check rate limits
        const rateStatus = this.checkRateLimit(context.userId, context.action);
        
        // Assess impact if needed
        let impactAssessment: ImpactAssessment | undefined;
        const classification = getActionClassification(context.action, context.service);
        if (classification.isDestructive || classification.severity === 'high') {
          const impactResult = await this.assessImpact(context);
          impactAssessment = impactResult.data;
        }
        
        // Compile results
        const blockReasons: string[] = [...safetyResult.data.blockingIssues];
        const warnings: string[] = [...safetyResult.data.warnings];
        const suggestedActions: string[] = [];
        
        // Add policy-based blocks/warnings
        if (policyActions.has('block')) {
          blockReasons.push('Blocked by guardrails policy');
        }
        if (policyActions.has('warn')) {
          warnings.push('Operation flagged by guardrails policy');
        }
        
        // Build suggested actions
        if (safetyResult.data.dryRunRecommended) {
          suggestedActions.push('Run in dry-run mode first to preview changes');
        }
        if (safetyResult.data.approvalRequired) {
          suggestedActions.push('Submit an approval request before proceeding');
        }
        if (safetyResult.data.requiredConfirmations.length > 0) {
          suggestedActions.push('Confirm the operation to proceed');
        }
        
        const result: GuardrailsEvaluationResult = {
          allowed: safetyResult.data.passed && !rateStatus.isRateLimited && !policyActions.has('block'),
          requiresConfirmation: safetyResult.data.requiredConfirmations.length > 0,
          requiresApproval: safetyResult.data.approvalRequired || policyActions.has('require_approval'),
          requiresDryRun: safetyResult.data.dryRunRecommended || policyActions.has('require_dry_run'),
          isRateLimited: rateStatus.isRateLimited,
          blockReasons,
          warnings,
          appliedPolicies: matchedPolicies.map(p => p.name),
          safetyCheckResult: safetyResult.data,
          impactAssessment,
          suggestedActions,
        };
        
        return {
          success: true,
          data: result,
          message: result.allowed 
            ? 'Operation is allowed'
            : `Operation blocked: ${blockReasons.join('; ')}`,
          warnings: result.warnings,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to evaluate guardrails',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    
    // Impact Assessment
    async assessImpact(context: OperationContext): Promise<GuardrailsOperationResult<ImpactAssessment>> {
      try {
        const classification = getActionClassification(context.action, context.service);
        const dependencies: ResourceDependency[] = [];
        const riskFactors: string[] = [];
        const recommendations: string[] = [];
        
        const environment = context.environment || detectEnvironmentFromTags(context.resourceTags || {});
        
        // Gather dependencies
        for (const resourceId of context.resourceIds) {
          const deps = await checkDependencies(resourceId, context.resourceType, context.region);
          dependencies.push(...deps);
        }
        
        // Assess risk factors
        if (environment === 'production') {
          riskFactors.push('Production environment');
        }
        if (context.resourceIds.length > 10) {
          riskFactors.push('Large number of resources affected');
        }
        if (classification.isDestructive) {
          riskFactors.push('Destructive operation');
        }
        if (!classification.isReversible) {
          riskFactors.push('Operation cannot be easily reversed');
        }
        if (dependencies.length > 0) {
          riskFactors.push(`${dependencies.length} dependent resource(s) may be affected`);
        }
        
        // Generate recommendations
        if (classification.isDestructive && safetyCheckConfig.createBackupBeforeDelete) {
          recommendations.push('Create backups before proceeding');
        }
        if (environment === 'production') {
          recommendations.push('Consider testing in staging first');
          recommendations.push('Ensure rollback plan is in place');
        }
        if (context.resourceIds.length > 5) {
          recommendations.push('Consider batching the operation');
        }
        
        // Estimate downtime
        let estimatedDowntime: string | undefined;
        if (context.action === 'stop' || context.action === 'terminate') {
          estimatedDowntime = 'Immediate';
        } else if (context.action === 'reboot') {
          estimatedDowntime = '2-5 minutes per instance';
        } else if (context.action === 'modify') {
          estimatedDowntime = 'May require restart';
        }
        
        const assessment: ImpactAssessment = {
          severity: classification.severity,
          affectedResourceCount: context.resourceIds.length,
          affectedResourceTypes: [context.resourceType],
          estimatedDowntime,
          dependencies,
          rollbackPossible: classification.isReversible,
          riskFactors,
          recommendations,
        };
        
        return {
          success: true,
          data: assessment,
          message: `Impact assessment complete. Severity: ${classification.severity}`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to assess impact',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    
    // Environment Protection
    getEnvironmentProtection(environment: Environment): EnvironmentProtection | undefined {
      return environmentProtections.get(environment);
    },
    
    setEnvironmentProtection(protection: EnvironmentProtection): void {
      environmentProtections.set(protection.environment, protection);
    },
    
    detectEnvironment(resourceTags: Record<string, string>): Environment {
      return detectEnvironmentFromTags(resourceTags);
    },
    
    isOperationAllowedInTimeWindow(environment: Environment): boolean {
      const protection = environmentProtections.get(environment);
      return isWithinTimeWindow(protection?.allowedTimeWindows);
    },
    
    // Audit Logging
    async logAction(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<GuardrailsOperationResult<AuditLogEntry>> {
      const logEntry: AuditLogEntry = {
        ...entry,
        id: randomUUID(),
        timestamp: new Date(),
      };
      
      auditLogs.push(logEntry);
      
      // Trim logs if too many (in production, use proper storage)
      const retentionDays = config.auditLogRetentionDays || 90;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const indexToRemove = auditLogs.findIndex(l => l.timestamp > cutoff);
      if (indexToRemove > 0) {
        auditLogs.splice(0, indexToRemove);
      }
      
      return {
        success: true,
        data: logEntry,
        message: 'Action logged',
      };
    },
    
    async queryAuditLogs(options: AuditLogQueryOptions): Promise<GuardrailsOperationResult<AuditLogQueryResult>> {
      let filteredLogs = [...auditLogs];
      
      // Apply filters
      if (options.startTime) {
        filteredLogs = filteredLogs.filter(l => l.timestamp >= options.startTime!);
      }
      if (options.endTime) {
        filteredLogs = filteredLogs.filter(l => l.timestamp <= options.endTime!);
      }
      if (options.userId) {
        filteredLogs = filteredLogs.filter(l => l.userId === options.userId);
      }
      if (options.actions?.length) {
        filteredLogs = filteredLogs.filter(l => options.actions!.includes(l.action));
      }
      if (options.services?.length) {
        filteredLogs = filteredLogs.filter(l => options.services!.includes(l.service));
      }
      if (options.outcomes?.length) {
        filteredLogs = filteredLogs.filter(l => options.outcomes!.includes(l.outcome));
      }
      if (options.environments?.length) {
        filteredLogs = filteredLogs.filter(l => options.environments!.includes(l.environment));
      }
      if (options.resourceId) {
        filteredLogs = filteredLogs.filter(l => l.resourceIds.includes(options.resourceId!));
      }
      
      // Sort by timestamp descending
      filteredLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      const totalCount = filteredLogs.length;
      
      // Paginate
      if (options.maxResults) {
        filteredLogs = filteredLogs.slice(0, options.maxResults);
      }
      
      return {
        success: true,
        data: {
          entries: filteredLogs,
          totalCount,
        },
        message: `Found ${totalCount} audit log entries`,
      };
    },
    
    async getAuditLogSummary(startTime: Date, endTime: Date): Promise<GuardrailsOperationResult<AuditLogSummary>> {
      const filteredLogs = auditLogs.filter(
        l => l.timestamp >= startTime && l.timestamp <= endTime
      );
      
      const byService: Record<string, number> = {};
      const byAction: Record<string, number> = {};
      const byEnvironment: Record<string, number> = {};
      const byUser: Record<string, number> = {};
      const resourceCounts: Record<string, number> = {};
      
      let successfulActions = 0;
      let failedActions = 0;
      let blockedActions = 0;
      let pendingApprovals = 0;
      
      for (const log of filteredLogs) {
        // Count by outcome
        switch (log.outcome) {
          case 'success':
            successfulActions++;
            break;
          case 'failure':
            failedActions++;
            break;
          case 'blocked':
            blockedActions++;
            break;
          case 'pending_approval':
            pendingApprovals++;
            break;
        }
        
        // Aggregate
        byService[log.service] = (byService[log.service] || 0) + 1;
        byAction[log.action] = (byAction[log.action] || 0) + 1;
        byEnvironment[log.environment] = (byEnvironment[log.environment] || 0) + 1;
        byUser[log.userId] = (byUser[log.userId] || 0) + 1;
        
        for (const resourceId of log.resourceIds) {
          resourceCounts[resourceId] = (resourceCounts[resourceId] || 0) + 1;
        }
      }
      
      // Get top resources
      const topResources = Object.entries(resourceCounts)
        .map(([resourceId, count]) => ({ resourceId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      
      const summary: AuditLogSummary = {
        period: { start: startTime, end: endTime },
        totalActions: filteredLogs.length,
        successfulActions,
        failedActions,
        blockedActions,
        pendingApprovals,
        byService,
        byAction,
        byEnvironment,
        byUser,
        topResources,
      };
      
      return {
        success: true,
        data: summary,
        message: `Audit summary for ${filteredLogs.length} actions`,
      };
    },
    
    // Rate Limiting
    checkRateLimit(userId: string, action: ActionType): RateLimitStatus {
      const counts = getOperationCounts(userId);
      cleanOldTimestamps(counts);
      
      const classification = getActionClassification(action, '*');
      
      // Check limits
      const operationsThisMinute = counts.minute.length;
      const operationsThisHour = counts.hour.length;
      const destructiveToday = classification.isDestructive ? counts.day.length : 0;
      
      let isRateLimited = false;
      let rateLimitReason: string | undefined;
      let resetAt: Date | undefined;
      
      if (operationsThisMinute >= rateLimitConfig.maxOperationsPerMinute) {
        isRateLimited = true;
        rateLimitReason = `Rate limit exceeded: ${operationsThisMinute}/${rateLimitConfig.maxOperationsPerMinute} operations per minute`;
        resetAt = new Date(counts.minute[0] + 60 * 1000);
      } else if (operationsThisHour >= rateLimitConfig.maxOperationsPerHour) {
        isRateLimited = true;
        rateLimitReason = `Rate limit exceeded: ${operationsThisHour}/${rateLimitConfig.maxOperationsPerHour} operations per hour`;
        resetAt = new Date(counts.hour[0] + 60 * 60 * 1000);
      } else if (classification.isDestructive && destructiveToday >= rateLimitConfig.maxDestructiveOperationsPerDay) {
        isRateLimited = true;
        rateLimitReason = `Destructive operation limit exceeded: ${destructiveToday}/${rateLimitConfig.maxDestructiveOperationsPerDay} per day`;
        resetAt = new Date(counts.day[0] + 24 * 60 * 60 * 1000);
      }
      
      return {
        operationsThisMinute,
        operationsThisHour,
        destructiveOperationsToday: destructiveToday,
        isRateLimited,
        rateLimitReason,
        resetAt,
        remainingThisMinute: Math.max(0, rateLimitConfig.maxOperationsPerMinute - operationsThisMinute),
        remainingThisHour: Math.max(0, rateLimitConfig.maxOperationsPerHour - operationsThisHour),
      };
    },
    
    recordOperation(userId: string, action: ActionType): void {
      const counts = getOperationCounts(userId);
      const now = Date.now();
      
      counts.minute.push(now);
      counts.hour.push(now);
      
      const classification = getActionClassification(action, '*');
      if (classification.isDestructive) {
        counts.day.push(now);
      }
    },
    
    getRateLimitConfig(): RateLimitConfig {
      return { ...rateLimitConfig };
    },
    
    setRateLimitConfig(config: Partial<RateLimitConfig>): void {
      rateLimitConfig = { ...rateLimitConfig, ...config };
    },
    
    // Pre-operation Backups
    async createPreOperationBackup(resourceId: string, resourceType: string, operation: string): Promise<GuardrailsOperationResult<PreOperationBackup>> {
      try {
        let backupReference = '';
        let backupType: PreOperationBackup['backupType'] = 'configuration';
        let canRestore = true;
        let restoreInstructions = '';
        
        // Create backup based on resource type
        if (resourceType.includes('ec2') || resourceType.includes('Instance')) {
          // Create EBS snapshot for EC2 instance volumes
          const ec2Client = createEC2Client();
          const instanceResp = await ec2Client.send(new DescribeInstancesCommand({
            InstanceIds: [resourceId],
          }));
          
          const instance = instanceResp.Reservations?.[0]?.Instances?.[0];
          if (instance?.BlockDeviceMappings?.[0]?.Ebs?.VolumeId) {
            const volumeId = instance.BlockDeviceMappings[0].Ebs.VolumeId;
            const snapshotResp = await ec2Client.send(new CreateSnapshotCommand({
              VolumeId: volumeId,
              Description: `Pre-operation backup for ${operation} on ${resourceId}`,
              TagSpecifications: [{
                ResourceType: 'snapshot',
                Tags: [
                  { Key: 'CreatedBy', Value: 'Guardrails' },
                  { Key: 'Operation', Value: operation },
                  { Key: 'SourceResource', Value: resourceId },
                ],
              }],
            }));
            
            backupReference = snapshotResp.SnapshotId || '';
            backupType = 'snapshot';
            restoreInstructions = `Create new volume from snapshot ${backupReference}, then attach to a new instance`;
          }
        } else if (resourceType.includes('rds') || resourceType.includes('DBInstance')) {
          // Create RDS snapshot
          const rdsClient = createRDSClient();
          const snapshotId = `guardrails-${resourceId}-${Date.now()}`.substring(0, 63);
          
          await rdsClient.send(new CreateDBSnapshotCommand({
            DBInstanceIdentifier: resourceId,
            DBSnapshotIdentifier: snapshotId,
            Tags: [
              { Key: 'CreatedBy', Value: 'Guardrails' },
              { Key: 'Operation', Value: operation },
            ],
          }));
          
          backupReference = snapshotId;
          backupType = 'snapshot';
          restoreInstructions = `Restore DB instance from snapshot ${backupReference}`;
        } else {
          // For other resources, store configuration
          backupType = 'configuration';
          backupReference = `config-${resourceId}-${Date.now()}`;
          canRestore = false;
          restoreInstructions = 'Manual restoration required based on stored configuration';
        }
        
        const backup: PreOperationBackup = {
          id: randomUUID(),
          resourceId,
          resourceType,
          backupType,
          backupReference,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          triggeringOperation: operation,
          canRestore,
          restoreInstructions,
        };
        
        preOperationBackups.push(backup);
        
        return {
          success: true,
          data: backup,
          message: `Pre-operation backup created: ${backupReference}`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to create pre-operation backup',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    
    async listPreOperationBackups(resourceId?: string): Promise<GuardrailsOperationResult<PreOperationBackup[]>> {
      let backups = [...preOperationBackups];
      
      if (resourceId) {
        backups = backups.filter(b => b.resourceId === resourceId);
      }
      
      // Sort by creation date descending
      backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      return {
        success: true,
        data: backups,
        message: `Found ${backups.length} backup(s)`,
      };
    },
    
    // Change Requests
    async createChangeRequest(request: Omit<ChangeRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<GuardrailsOperationResult<ChangeRequest>> {
      const changeRequest: ChangeRequest = {
        ...request,
        id: randomUUID(),
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      changeRequests.set(changeRequest.id, changeRequest);
      
      return {
        success: true,
        data: changeRequest,
        message: `Change request created: ${changeRequest.id}`,
      };
    },
    
    async getChangeRequest(requestId: string): Promise<GuardrailsOperationResult<ChangeRequest>> {
      const request = changeRequests.get(requestId);
      if (!request) {
        return {
          success: false,
          message: 'Change request not found',
          error: 'not_found',
        };
      }
      
      return {
        success: true,
        data: request,
      };
    },
    
    async updateChangeRequestStatus(requestId: string, status: ChangeRequest['status'], notes?: string): Promise<GuardrailsOperationResult<ChangeRequest>> {
      const request = changeRequests.get(requestId);
      if (!request) {
        return {
          success: false,
          message: 'Change request not found',
          error: 'not_found',
        };
      }
      
      request.status = status;
      request.updatedAt = new Date();
      if (notes) {
        request.notes = request.notes ? `${request.notes}\n${notes}` : notes;
      }
      
      // Set actual times
      if (status === 'in_progress' && !request.actualStart) {
        request.actualStart = new Date();
      }
      if (status === 'completed' || status === 'failed') {
        request.actualEnd = new Date();
      }
      
      return {
        success: true,
        data: request,
        message: `Change request status updated to ${status}`,
      };
    },
    
    async listChangeRequests(options?: { status?: ChangeRequest['status']; maxResults?: number }): Promise<GuardrailsOperationResult<ChangeRequest[]>> {
      let requests = Array.from(changeRequests.values());
      
      if (options?.status) {
        requests = requests.filter(r => r.status === options.status);
      }
      
      // Sort by creation date descending
      requests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      if (options?.maxResults) {
        requests = requests.slice(0, options.maxResults);
      }
      
      return {
        success: true,
        data: requests,
        message: `Found ${requests.length} change request(s)`,
      };
    },
    
    // Policies
    addPolicy(policy: Omit<GuardrailsPolicy, 'id' | 'createdAt' | 'updatedAt'>): GuardrailsPolicy {
      const newPolicy: GuardrailsPolicy = {
        ...policy,
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      policies.push(newPolicy);
      
      // Re-sort by priority
      policies.sort((a, b) => a.priority - b.priority);
      
      return newPolicy;
    },
    
    getPolicy(policyId: string): GuardrailsPolicy | undefined {
      return policies.find(p => p.id === policyId);
    },
    
    listPolicies(): GuardrailsPolicy[] {
      return [...policies];
    },
    
    updatePolicy(policyId: string, updates: Partial<GuardrailsPolicy>): GuardrailsPolicy | undefined {
      const index = policies.findIndex(p => p.id === policyId);
      if (index === -1) return undefined;
      
      policies[index] = {
        ...policies[index],
        ...updates,
        id: policyId, // Prevent ID change
        updatedAt: new Date(),
      };
      
      // Re-sort if priority changed
      if (updates.priority !== undefined) {
        policies.sort((a, b) => a.priority - b.priority);
      }
      
      return policies[index];
    },
    
    removePolicy(policyId: string): boolean {
      const index = policies.findIndex(p => p.id === policyId);
      if (index === -1) return false;
      
      policies.splice(index, 1);
      return true;
    },
    
    // Action Classification
    classifyAction(action: ActionType, service: string): ActionClassification {
      return getActionClassification(action, service);
    },
    
    // Notifications
    async sendNotification(payload: NotificationPayload): Promise<GuardrailsOperationResult<void>> {
      try {
        const enabledChannels = notificationChannels.filter(
          c => c.enabled && c.events.includes(payload.event)
        );
        
        if (enabledChannels.length === 0) {
          return {
            success: true,
            message: 'No notification channels configured for this event',
          };
        }
        
        const errors: string[] = [];
        
        for (const channel of enabledChannels) {
          try {
            switch (channel.type) {
              case 'sns':
                const snsClient = createSNSClient();
                await snsClient.send(new PublishCommand({
                  TopicArn: channel.endpoint,
                  Subject: payload.title,
                  Message: JSON.stringify({
                    ...payload,
                    timestamp: payload.timestamp.toISOString(),
                  }),
                }));
                break;
              case 'webhook':
                // In production, use fetch to call webhook
                console.log(`[Guardrails] Webhook notification to ${channel.endpoint}:`, payload);
                break;
              case 'slack':
              case 'teams':
              case 'email':
                // These would need additional integrations
                console.log(`[Guardrails] ${channel.type} notification:`, payload);
                break;
            }
          } catch (err) {
            errors.push(`Failed to send to ${channel.type}: ${err}`);
          }
        }
        
        if (errors.length > 0) {
          return {
            success: true,
            message: 'Some notifications failed',
            warnings: errors,
          };
        }
        
        return {
          success: true,
          message: `Notification sent to ${enabledChannels.length} channel(s)`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to send notification',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    
    configureNotificationChannel(channelConfig: NotificationChannelConfig): void {
      const existingIndex = notificationChannels.findIndex(
        c => c.type === channelConfig.type && c.endpoint === channelConfig.endpoint
      );
      
      if (existingIndex >= 0) {
        notificationChannels[existingIndex] = channelConfig;
      } else {
        notificationChannels.push(channelConfig);
      }
    },
    
    // Configuration
    getConfig(): GuardrailsManagerConfig {
      return {
        defaultRegion,
        environmentTagKey,
        defaultEnvironment,
        rateLimits: rateLimitConfig,
        safetyChecks: safetyCheckConfig,
        environmentProtections: Array.from(environmentProtections.values()),
        defaultApprovers,
        defaultApprovalTimeout,
        ticketingIntegration: config.ticketingIntegration,
        auditLogStorage: config.auditLogStorage,
        auditLogRetentionDays: config.auditLogRetentionDays,
      };
    },
    
    updateConfig(newConfig: Partial<GuardrailsManagerConfig>): void {
      if (newConfig.rateLimits) {
        rateLimitConfig = { ...rateLimitConfig, ...newConfig.rateLimits };
      }
      if (newConfig.safetyChecks) {
        safetyCheckConfig = { ...safetyCheckConfig, ...newConfig.safetyChecks };
      }
      if (newConfig.environmentProtections) {
        for (const protection of newConfig.environmentProtections) {
          environmentProtections.set(protection.environment, protection);
        }
      }
    },
  };
}
