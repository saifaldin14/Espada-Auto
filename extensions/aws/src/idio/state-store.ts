/**
 * IDIO State Store - Persistent Storage for Infrastructure State
 * 
 * DynamoDB-backed state management for:
 * - Infrastructure plans
 * - Execution history
 * - Resource state tracking
 * - Drift detection history
 * - Audit logging
 */

import { randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  DeleteTableCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

import type {
  InfrastructurePlan,
  IntentExecutionResult,
  ProvisionedResource,
  ApplicationIntent,
} from '../intent/types.js';

// ============================================================================
// Types
// ============================================================================

export interface StateStoreConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  tablePrefix?: string;
  /** Auto-create tables if they don't exist */
  autoCreateTables?: boolean;
  /** Enable TTL for automatic cleanup */
  enableTTL?: boolean;
  /** Default TTL in days for historical data */
  defaultTTLDays?: number;
}

export interface StoredPlan {
  planId: string;
  intent: ApplicationIntent;
  plan: InfrastructurePlan;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'rolled-back';
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  executionId?: string;
  ttl?: number;
}

export interface StoredExecution {
  executionId: string;
  planId: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'rolled-back';
  startedAt: string;
  completedAt?: string;
  startedBy?: string;
  resources: ProvisionedResource[];
  errors: string[];
  metrics: {
    totalResources: number;
    successfulResources: number;
    failedResources: number;
    durationSeconds?: number;
    estimatedCostUsd?: number;
    actualCostUsd?: number;
  };
  ttl?: number;
}

export interface StoredResource {
  resourceId: string; // Composite: planId#awsId
  planId: string;
  executionId: string;
  awsId: string;
  type: string;
  name: string;
  region: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastDriftCheck?: string;
  driftStatus?: 'in-sync' | 'drifted' | 'unknown';
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  ttl?: number;
}

export interface StoredDriftRecord {
  driftId: string;
  planId: string;
  resourceId: string;
  detectedAt: string;
  driftType: 'modified' | 'deleted' | 'added';
  expectedState: Record<string, unknown>;
  actualState: Record<string, unknown>;
  remediationAction?: string;
  remediatedAt?: string;
  remediatedBy?: string;
  ttl?: number;
}

export interface StoredAuditLog {
  logId: string;
  timestamp: string;
  action: string;
  entityType: 'plan' | 'execution' | 'resource' | 'drift';
  entityId: string;
  userId?: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  ttl?: number;
}

export interface QueryOptions {
  limit?: number;
  startKey?: Record<string, unknown>;
  sortDescending?: boolean;
  filterExpression?: string;
  filterValues?: Record<string, unknown>;
}

export interface QueryResult<T> {
  items: T[];
  lastKey?: Record<string, unknown>;
  count: number;
}

export interface StateStoreResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Table Definitions
// ============================================================================

const TABLE_DEFINITIONS = {
  plans: {
    keySchema: [
      { AttributeName: 'planId', KeyType: 'HASH' as const },
    ],
    attributeDefinitions: [
      { AttributeName: 'planId', AttributeType: 'S' as const },
      { AttributeName: 'status', AttributeType: 'S' as const },
      { AttributeName: 'createdAt', AttributeType: 'S' as const },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'status-createdAt-index',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' as const },
          { AttributeName: 'createdAt', KeyType: 'RANGE' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
    ],
  },
  executions: {
    keySchema: [
      { AttributeName: 'executionId', KeyType: 'HASH' as const },
    ],
    attributeDefinitions: [
      { AttributeName: 'executionId', AttributeType: 'S' as const },
      { AttributeName: 'planId', AttributeType: 'S' as const },
      { AttributeName: 'startedAt', AttributeType: 'S' as const },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'planId-startedAt-index',
        KeySchema: [
          { AttributeName: 'planId', KeyType: 'HASH' as const },
          { AttributeName: 'startedAt', KeyType: 'RANGE' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
    ],
  },
  resources: {
    keySchema: [
      { AttributeName: 'resourceId', KeyType: 'HASH' as const },
    ],
    attributeDefinitions: [
      { AttributeName: 'resourceId', AttributeType: 'S' as const },
      { AttributeName: 'planId', AttributeType: 'S' as const },
      { AttributeName: 'type', AttributeType: 'S' as const },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'planId-index',
        KeySchema: [
          { AttributeName: 'planId', KeyType: 'HASH' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
      {
        IndexName: 'type-index',
        KeySchema: [
          { AttributeName: 'type', KeyType: 'HASH' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
    ],
  },
  drift: {
    keySchema: [
      { AttributeName: 'driftId', KeyType: 'HASH' as const },
    ],
    attributeDefinitions: [
      { AttributeName: 'driftId', AttributeType: 'S' as const },
      { AttributeName: 'planId', AttributeType: 'S' as const },
      { AttributeName: 'detectedAt', AttributeType: 'S' as const },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'planId-detectedAt-index',
        KeySchema: [
          { AttributeName: 'planId', KeyType: 'HASH' as const },
          { AttributeName: 'detectedAt', KeyType: 'RANGE' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
    ],
  },
  audit: {
    keySchema: [
      { AttributeName: 'logId', KeyType: 'HASH' as const },
    ],
    attributeDefinitions: [
      { AttributeName: 'logId', AttributeType: 'S' as const },
      { AttributeName: 'entityType', AttributeType: 'S' as const },
      { AttributeName: 'timestamp', AttributeType: 'S' as const },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'entityType-timestamp-index',
        KeySchema: [
          { AttributeName: 'entityType', KeyType: 'HASH' as const },
          { AttributeName: 'timestamp', KeyType: 'RANGE' as const },
        ],
        Projection: { ProjectionType: 'ALL' as const },
      },
    ],
  },
};

// ============================================================================
// State Store Implementation
// ============================================================================

export class IDIOStateStore {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private config: Required<StateStoreConfig>;
  private tableNames: Record<string, string>;
  private initialized: boolean = false;

  constructor(config: StateStoreConfig = {}) {
    this.config = {
      region: config.region ?? 'us-east-1',
      credentials: config.credentials as any,
      tablePrefix: config.tablePrefix ?? 'idio',
      autoCreateTables: config.autoCreateTables ?? true,
      enableTTL: config.enableTTL ?? true,
      defaultTTLDays: config.defaultTTLDays ?? 90,
    };

    this.client = new DynamoDBClient({
      region: this.config.region,
      credentials: this.config.credentials,
    });

    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
    });

    this.tableNames = {
      plans: `${this.config.tablePrefix}-plans`,
      executions: `${this.config.tablePrefix}-executions`,
      resources: `${this.config.tablePrefix}-resources`,
      drift: `${this.config.tablePrefix}-drift`,
      audit: `${this.config.tablePrefix}-audit`,
    };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize state store (create tables if needed)
   */
  async initialize(): Promise<StateStoreResult<void>> {
    if (this.initialized) {
      return { success: true };
    }

    try {
      if (this.config.autoCreateTables) {
        await this.ensureTablesExist();
      }

      this.initialized = true;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async ensureTablesExist(): Promise<void> {
    for (const [tableType, definition] of Object.entries(TABLE_DEFINITIONS)) {
      const tableName = this.tableNames[tableType];
      
      try {
        await this.client.send(new DescribeTableCommand({ TableName: tableName }));
      } catch (error: unknown) {
        if (error.name === 'ResourceNotFoundException') {
          await this.createTable(tableName, definition);
        } else {
          throw error;
        }
      }
    }
  }

  private async createTable(
    tableName: string,
    definition: typeof TABLE_DEFINITIONS.plans
  ): Promise<void> {
    await this.client.send(new CreateTableCommand({
      TableName: tableName,
      KeySchema: definition.keySchema,
      AttributeDefinitions: definition.attributeDefinitions,
      // PAY_PER_REQUEST auto-scales; no ProvisionedThroughput on table or GSIs
      GlobalSecondaryIndexes: definition.globalSecondaryIndexes,
      BillingMode: 'PAY_PER_REQUEST',
    }));

    await waitUntilTableExists(
      { client: this.client, maxWaitTime: 120 },
      { TableName: tableName }
    );
  }

  // ==========================================================================
  // Plan Operations
  // ==========================================================================

  /**
   * Save an infrastructure plan
   */
  async savePlan(
    intent: ApplicationIntent,
    plan: InfrastructurePlan,
    userId?: string
  ): Promise<StateStoreResult<StoredPlan>> {
    try {
      const now = new Date().toISOString();
      const storedPlan: StoredPlan = {
        planId: plan.id,
        intent,
        plan,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        ttl: this.calculateTTL(),
      };

      await this.docClient.send(new PutCommand({
        TableName: this.tableNames.plans,
        Item: storedPlan,
      }));

      await this.logAudit('plan_created', 'plan', plan.id, userId, {
        resourceCount: plan.resources.length,
        estimatedCost: plan.estimatedMonthlyCostUsd,
      });

      return { success: true, data: storedPlan };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get a plan by ID
   */
  async getPlan(planId: string): Promise<StateStoreResult<StoredPlan>> {
    try {
      const response = await this.docClient.send(new GetCommand({
        TableName: this.tableNames.plans,
        Key: { planId },
      }));

      if (!response.Item) {
        return { success: false, error: `Plan ${planId} not found` };
      }

      return { success: true, data: response.Item as StoredPlan };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update plan status
   */
  async updatePlanStatus(
    planId: string,
    status: StoredPlan['status'],
    userId?: string,
    executionId?: string
  ): Promise<StateStoreResult<void>> {
    try {
      const updateExpression = ['#status = :status', '#updatedAt = :updatedAt'];
      const expressionNames: Record<string, string> = {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
      };
      const expressionValues: Record<string, unknown> = {
        ':status': status,
        ':updatedAt': new Date().toISOString(),
      };

      if (status === 'approved' && userId) {
        updateExpression.push('#approvedBy = :approvedBy', '#approvedAt = :approvedAt');
        expressionNames['#approvedBy'] = 'approvedBy';
        expressionNames['#approvedAt'] = 'approvedAt';
        expressionValues[':approvedBy'] = userId;
        expressionValues[':approvedAt'] = new Date().toISOString();
      }

      if (executionId) {
        updateExpression.push('#executionId = :executionId');
        expressionNames['#executionId'] = 'executionId';
        expressionValues[':executionId'] = executionId;
      }

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableNames.plans,
        Key: { planId },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
      }));

      await this.logAudit('plan_status_updated', 'plan', planId, userId, { status, executionId });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List plans by status
   */
  async listPlansByStatus(
    status: StoredPlan['status'],
    options?: QueryOptions
  ): Promise<StateStoreResult<QueryResult<StoredPlan>>> {
    try {
      const response = await this.docClient.send(new QueryCommand({
        TableName: this.tableNames.plans,
        IndexName: 'status-createdAt-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
        Limit: options?.limit,
        ExclusiveStartKey: options?.startKey as any,
        ScanIndexForward: !options?.sortDescending,
      }));

      return {
        success: true,
        data: {
          items: (response.Items ?? []) as StoredPlan[],
          lastKey: response.LastEvaluatedKey as Record<string, unknown>,
          count: response.Count ?? 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a plan
   */
  async deletePlan(planId: string, userId?: string): Promise<StateStoreResult<void>> {
    try {
      await this.docClient.send(new DeleteCommand({
        TableName: this.tableNames.plans,
        Key: { planId },
      }));

      await this.logAudit('plan_deleted', 'plan', planId, userId);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Execution Operations
  // ==========================================================================

  /**
   * Save an execution record
   */
  async saveExecution(
    execution: IntentExecutionResult,
    userId?: string
  ): Promise<StateStoreResult<StoredExecution>> {
    try {
      const storedExecution: StoredExecution = {
        executionId: execution.executionId,
        planId: execution.planId,
        status: execution.status as StoredExecution['status'],
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        startedBy: userId,
        resources: execution.provisionedResources,
        errors: execution.errors.map(e => e.message),
        metrics: {
          totalResources: execution.provisionedResources.length,
          successfulResources: execution.provisionedResources.filter(r => r.status !== 'failed').length,
          failedResources: execution.provisionedResources.filter(r => r.status === 'failed').length,
          estimatedCostUsd: execution.actualMonthlyCostUsd,
        },
        ttl: this.calculateTTL(),
      };

      if (execution.completedAt && execution.startedAt) {
        storedExecution.metrics.durationSeconds = 
          (new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000;
      }

      await this.docClient.send(new PutCommand({
        TableName: this.tableNames.executions,
        Item: storedExecution,
      }));

      await this.logAudit('execution_saved', 'execution', execution.executionId, userId, {
        planId: execution.planId,
        status: execution.status,
        resourceCount: execution.provisionedResources.length,
      });

      return { success: true, data: storedExecution };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get an execution by ID
   */
  async getExecution(executionId: string): Promise<StateStoreResult<StoredExecution>> {
    try {
      const response = await this.docClient.send(new GetCommand({
        TableName: this.tableNames.executions,
        Key: { executionId },
      }));

      if (!response.Item) {
        return { success: false, error: `Execution ${executionId} not found` };
      }

      return { success: true, data: response.Item as StoredExecution };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update execution status
   */
  async updateExecutionStatus(
    executionId: string,
    status: StoredExecution['status'],
    completedAt?: string,
    errors?: string[]
  ): Promise<StateStoreResult<void>> {
    try {
      const updateExpression = ['#status = :status'];
      const expressionNames: Record<string, string> = { '#status': 'status' };
      const expressionValues: Record<string, unknown> = { ':status': status };

      if (completedAt) {
        updateExpression.push('#completedAt = :completedAt');
        expressionNames['#completedAt'] = 'completedAt';
        expressionValues[':completedAt'] = completedAt;
      }

      if (errors) {
        updateExpression.push('#errors = :errors');
        expressionNames['#errors'] = 'errors';
        expressionValues[':errors'] = errors;
      }

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableNames.executions,
        Key: { executionId },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List executions for a plan
   */
  async listExecutionsForPlan(
    planId: string,
    options?: QueryOptions
  ): Promise<StateStoreResult<QueryResult<StoredExecution>>> {
    try {
      const response = await this.docClient.send(new QueryCommand({
        TableName: this.tableNames.executions,
        IndexName: 'planId-startedAt-index',
        KeyConditionExpression: '#planId = :planId',
        ExpressionAttributeNames: { '#planId': 'planId' },
        ExpressionAttributeValues: { ':planId': planId },
        Limit: options?.limit,
        ExclusiveStartKey: options?.startKey as any,
        ScanIndexForward: !options?.sortDescending,
      }));

      return {
        success: true,
        data: {
          items: (response.Items ?? []) as StoredExecution[],
          lastKey: response.LastEvaluatedKey as Record<string, unknown>,
          count: response.Count ?? 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Resource Operations
  // ==========================================================================

  /**
   * Save a provisioned resource
   */
  async saveResource(
    resource: ProvisionedResource,
    planId: string,
    executionId: string,
    name: string,
    tags?: Record<string, string>
  ): Promise<StateStoreResult<StoredResource>> {
    try {
      const now = new Date().toISOString();
      const storedResource: StoredResource = {
        resourceId: `${planId}#${resource.awsId}`,
        planId,
        executionId,
        awsId: resource.awsId,
        type: resource.type,
        name,
        region: resource.region,
        status: resource.status,
        createdAt: now,
        updatedAt: now,
        driftStatus: 'unknown',
        tags: tags ?? {},
        metadata: {},
        ttl: this.calculateTTL(),
      };

      await this.docClient.send(new PutCommand({
        TableName: this.tableNames.resources,
        Item: storedResource,
      }));

      return { success: true, data: storedResource };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get resources for a plan
   */
  async getResourcesForPlan(
    planId: string,
    options?: QueryOptions
  ): Promise<StateStoreResult<QueryResult<StoredResource>>> {
    try {
      const response = await this.docClient.send(new QueryCommand({
        TableName: this.tableNames.resources,
        IndexName: 'planId-index',
        KeyConditionExpression: '#planId = :planId',
        ExpressionAttributeNames: { '#planId': 'planId' },
        ExpressionAttributeValues: { ':planId': planId },
        Limit: options?.limit,
        ExclusiveStartKey: options?.startKey as any,
      }));

      return {
        success: true,
        data: {
          items: (response.Items ?? []) as StoredResource[],
          lastKey: response.LastEvaluatedKey as Record<string, unknown>,
          count: response.Count ?? 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update resource drift status
   */
  async updateResourceDriftStatus(
    resourceId: string,
    driftStatus: StoredResource['driftStatus']
  ): Promise<StateStoreResult<void>> {
    try {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableNames.resources,
        Key: { resourceId },
        UpdateExpression: 'SET #driftStatus = :driftStatus, #lastDriftCheck = :lastDriftCheck, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#driftStatus': 'driftStatus',
          '#lastDriftCheck': 'lastDriftCheck',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':driftStatus': driftStatus,
          ':lastDriftCheck': new Date().toISOString(),
          ':updatedAt': new Date().toISOString(),
        },
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Drift Operations
  // ==========================================================================

  /**
   * Save a drift record
   */
  async saveDriftRecord(
    planId: string,
    resourceId: string,
    driftType: StoredDriftRecord['driftType'],
    expectedState: Record<string, unknown>,
    actualState: Record<string, unknown>
  ): Promise<StateStoreResult<StoredDriftRecord>> {
    try {
      const driftRecord: StoredDriftRecord = {
        driftId: randomUUID(),
        planId,
        resourceId,
        detectedAt: new Date().toISOString(),
        driftType,
        expectedState,
        actualState,
        ttl: this.calculateTTL(),
      };

      await this.docClient.send(new PutCommand({
        TableName: this.tableNames.drift,
        Item: driftRecord,
      }));

      await this.logAudit('drift_detected', 'drift', driftRecord.driftId, undefined, {
        planId,
        resourceId,
        driftType,
      });

      return { success: true, data: driftRecord };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get drift records for a plan
   */
  async getDriftRecordsForPlan(
    planId: string,
    options?: QueryOptions
  ): Promise<StateStoreResult<QueryResult<StoredDriftRecord>>> {
    try {
      const response = await this.docClient.send(new QueryCommand({
        TableName: this.tableNames.drift,
        IndexName: 'planId-detectedAt-index',
        KeyConditionExpression: '#planId = :planId',
        ExpressionAttributeNames: { '#planId': 'planId' },
        ExpressionAttributeValues: { ':planId': planId },
        Limit: options?.limit,
        ExclusiveStartKey: options?.startKey as any,
        ScanIndexForward: !options?.sortDescending,
      }));

      return {
        success: true,
        data: {
          items: (response.Items ?? []) as StoredDriftRecord[],
          lastKey: response.LastEvaluatedKey as Record<string, unknown>,
          count: response.Count ?? 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Mark drift as remediated
   */
  async markDriftRemediated(
    driftId: string,
    remediationAction: string,
    userId?: string
  ): Promise<StateStoreResult<void>> {
    try {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableNames.drift,
        Key: { driftId },
        UpdateExpression: 'SET #remediationAction = :remediationAction, #remediatedAt = :remediatedAt, #remediatedBy = :remediatedBy',
        ExpressionAttributeNames: {
          '#remediationAction': 'remediationAction',
          '#remediatedAt': 'remediatedAt',
          '#remediatedBy': 'remediatedBy',
        },
        ExpressionAttributeValues: {
          ':remediationAction': remediationAction,
          ':remediatedAt': new Date().toISOString(),
          ':remediatedBy': userId,
        },
      }));

      await this.logAudit('drift_remediated', 'drift', driftId, userId, { remediationAction });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Audit Operations
  // ==========================================================================

  /**
   * Log an audit entry
   */
  private async logAudit(
    action: string,
    entityType: StoredAuditLog['entityType'],
    entityId: string,
    userId?: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    try {
      const auditLog: StoredAuditLog = {
        logId: randomUUID(),
        timestamp: new Date().toISOString(),
        action,
        entityType,
        entityId,
        userId,
        details: details ?? {},
        ttl: this.calculateTTL(),
      };

      await this.docClient.send(new PutCommand({
        TableName: this.tableNames.audit,
        Item: auditLog,
      }));
    } catch (error) {
      // Don't throw on audit failures
      console.error('Failed to log audit entry:', error);
    }
  }

  /**
   * Get audit logs for an entity
   */
  async getAuditLogs(
    entityType: StoredAuditLog['entityType'],
    options?: QueryOptions
  ): Promise<StateStoreResult<QueryResult<StoredAuditLog>>> {
    try {
      const response = await this.docClient.send(new QueryCommand({
        TableName: this.tableNames.audit,
        IndexName: 'entityType-timestamp-index',
        KeyConditionExpression: '#entityType = :entityType',
        ExpressionAttributeNames: { '#entityType': 'entityType' },
        ExpressionAttributeValues: { ':entityType': entityType },
        Limit: options?.limit,
        ExclusiveStartKey: options?.startKey as any,
        ScanIndexForward: !options?.sortDescending,
      }));

      return {
        success: true,
        data: {
          items: (response.Items ?? []) as StoredAuditLog[],
          lastKey: response.LastEvaluatedKey as Record<string, unknown>,
          count: response.Count ?? 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private calculateTTL(): number {
    if (!this.config.enableTTL) {
      return 0;
    }
    return Math.floor(Date.now() / 1000) + (this.config.defaultTTLDays * 24 * 60 * 60);
  }

  /**
   * Get state store statistics
   */
  async getStatistics(): Promise<StateStoreResult<{
    totalPlans: number;
    totalExecutions: number;
    totalResources: number;
    totalDriftRecords: number;
    plansByStatus: Record<string, number>;
  }>> {
    try {
      // Count plans by status
      const plansByStatus: Record<string, number> = {};
      for (const status of ['pending', 'approved', 'executed', 'failed', 'rolled-back'] as const) {
        const result = await this.listPlansByStatus(status, { limit: 1 });
        if (result.success) {
          plansByStatus[status] = result.data!.count;
        }
      }

      // Get total counts (scan with count only)
      const [plansCount, executionsCount, resourcesCount, driftCount] = await Promise.all([
        this.docClient.send(new ScanCommand({ TableName: this.tableNames.plans, Select: 'COUNT' })),
        this.docClient.send(new ScanCommand({ TableName: this.tableNames.executions, Select: 'COUNT' })),
        this.docClient.send(new ScanCommand({ TableName: this.tableNames.resources, Select: 'COUNT' })),
        this.docClient.send(new ScanCommand({ TableName: this.tableNames.drift, Select: 'COUNT' })),
      ]);

      return {
        success: true,
        data: {
          totalPlans: plansCount.Count ?? 0,
          totalExecutions: executionsCount.Count ?? 0,
          totalResources: resourcesCount.Count ?? 0,
          totalDriftRecords: driftCount.Count ?? 0,
          plansByStatus,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Clean up old data beyond TTL
   */
  async cleanup(olderThanDays: number = 90): Promise<StateStoreResult<{ deletedCount: number }>> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      const cutoffTimestamp = cutoff.toISOString();

      let deletedCount = 0;

      // Clean up old executions
      const oldExecutions = await this.docClient.send(new ScanCommand({
        TableName: this.tableNames.executions,
        FilterExpression: '#startedAt < :cutoff',
        ExpressionAttributeNames: { '#startedAt': 'startedAt' },
        ExpressionAttributeValues: { ':cutoff': cutoffTimestamp },
        ProjectionExpression: 'executionId',
      }));

      if (oldExecutions.Items && oldExecutions.Items.length > 0) {
        const batches = this.chunkArray(oldExecutions.Items, 25);
        for (const batch of batches) {
          await this.docClient.send(new BatchWriteCommand({
            RequestItems: {
              [this.tableNames.executions]: batch.map(item => ({
                DeleteRequest: { Key: { executionId: item.executionId } },
              })),
            },
          }));
          deletedCount += batch.length;
        }
      }

      return { success: true, data: { deletedCount } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createStateStore(config?: StateStoreConfig): IDIOStateStore {
  return new IDIOStateStore(config);
}
