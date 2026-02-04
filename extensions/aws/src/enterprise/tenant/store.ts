/**
 * Tenant Store
 * 
 * DynamoDB-backed storage for multi-tenant data with isolation support.
 * Handles tenant CRUD, member management, and audit logging.
 */

import { randomUUID } from 'node:crypto';
import { 
  DynamoDBClient, 
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
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
  Tenant,
  TenantStatus,
  TenantTier,
  TenantMember,
  TenantInvitation,
  TenantTeam,
  TenantProject,
  TenantAuditLog,
  TenantEvent,
  TenantServiceConfig,
  UsageRecord,
  UsageSummary,
  MemberRole,
} from './types.js';
import { TIER_QUOTAS, TIER_FEATURES } from './types.js';

// =============================================================================
// Store Configuration
// =============================================================================

export interface TenantStoreConfig {
  region?: string;
  tablePrefix?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  autoCreateTables?: boolean;
}

interface StoreResult<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

// =============================================================================
// Tenant Store Implementation
// =============================================================================

export class TenantStore {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private config: Required<TenantStoreConfig>;
  private initialized = false;

  // Table names
  private readonly tenantsTable: string;
  private readonly membersTable: string;
  private readonly invitationsTable: string;
  private readonly teamsTable: string;
  private readonly projectsTable: string;
  private readonly auditLogsTable: string;
  private readonly eventsTable: string;
  private readonly usageTable: string;

  constructor(config: TenantStoreConfig = {}) {
    this.config = {
      region: config.region ?? 'us-east-1',
      tablePrefix: config.tablePrefix ?? 'idio-enterprise',
      credentials: config.credentials ?? undefined as any,
      autoCreateTables: config.autoCreateTables ?? true,
    };

    this.client = new DynamoDBClient({
      region: this.config.region,
      credentials: this.config.credentials,
    });

    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: true,
      },
    });

    // Initialize table names
    const prefix = this.config.tablePrefix;
    this.tenantsTable = `${prefix}-tenants`;
    this.membersTable = `${prefix}-members`;
    this.invitationsTable = `${prefix}-invitations`;
    this.teamsTable = `${prefix}-teams`;
    this.projectsTable = `${prefix}-projects`;
    this.auditLogsTable = `${prefix}-audit-logs`;
    this.eventsTable = `${prefix}-events`;
    this.usageTable = `${prefix}-usage`;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async initialize(): Promise<StoreResult> {
    if (this.initialized) {
      return { success: true, message: 'Already initialized' };
    }

    try {
      if (this.config.autoCreateTables) {
        await this.createTablesIfNotExist();
      }
      this.initialized = true;
      return { success: true, message: 'Tenant store initialized' };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to initialize tenant store',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private async createTablesIfNotExist(): Promise<void> {
    const tables = [
      {
        name: this.tenantsTable,
        keySchema: [{ AttributeName: 'id', KeyType: 'HASH' as const }],
        attributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' as const },
          { AttributeName: 'slug', AttributeType: 'S' as const },
          { AttributeName: 'status', AttributeType: 'S' as const },
        ],
        globalSecondaryIndexes: [
          {
            IndexName: 'slug-index',
            KeySchema: [{ AttributeName: 'slug', KeyType: 'HASH' as const }],
            Projection: { ProjectionType: 'ALL' as const },
          },
          {
            IndexName: 'status-index',
            KeySchema: [{ AttributeName: 'status', KeyType: 'HASH' as const }],
            Projection: { ProjectionType: 'ALL' as const },
          },
        ],
      },
      {
        name: this.membersTable,
        keySchema: [
          { AttributeName: 'tenantId', KeyType: 'HASH' as const },
          { AttributeName: 'userId', KeyType: 'RANGE' as const },
        ],
        attributeDefinitions: [
          { AttributeName: 'tenantId', AttributeType: 'S' as const },
          { AttributeName: 'userId', AttributeType: 'S' as const },
          { AttributeName: 'email', AttributeType: 'S' as const },
        ],
        globalSecondaryIndexes: [
          {
            IndexName: 'email-index',
            KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' as const }],
            Projection: { ProjectionType: 'ALL' as const },
          },
          {
            IndexName: 'user-index',
            KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' as const }],
            Projection: { ProjectionType: 'ALL' as const },
          },
        ],
      },
      {
        name: this.invitationsTable,
        keySchema: [
          { AttributeName: 'tenantId', KeyType: 'HASH' as const },
          { AttributeName: 'id', KeyType: 'RANGE' as const },
        ],
        attributeDefinitions: [
          { AttributeName: 'tenantId', AttributeType: 'S' as const },
          { AttributeName: 'id', AttributeType: 'S' as const },
          { AttributeName: 'email', AttributeType: 'S' as const },
        ],
        globalSecondaryIndexes: [
          {
            IndexName: 'email-index',
            KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' as const }],
            Projection: { ProjectionType: 'ALL' as const },
          },
        ],
      },
      {
        name: this.teamsTable,
        keySchema: [
          { AttributeName: 'tenantId', KeyType: 'HASH' as const },
          { AttributeName: 'id', KeyType: 'RANGE' as const },
        ],
        attributeDefinitions: [
          { AttributeName: 'tenantId', AttributeType: 'S' as const },
          { AttributeName: 'id', AttributeType: 'S' as const },
        ],
      },
      {
        name: this.projectsTable,
        keySchema: [
          { AttributeName: 'tenantId', KeyType: 'HASH' as const },
          { AttributeName: 'id', KeyType: 'RANGE' as const },
        ],
        attributeDefinitions: [
          { AttributeName: 'tenantId', AttributeType: 'S' as const },
          { AttributeName: 'id', AttributeType: 'S' as const },
          { AttributeName: 'teamId', AttributeType: 'S' as const },
        ],
        globalSecondaryIndexes: [
          {
            IndexName: 'team-index',
            KeySchema: [
              { AttributeName: 'tenantId', KeyType: 'HASH' as const },
              { AttributeName: 'teamId', KeyType: 'RANGE' as const },
            ],
            Projection: { ProjectionType: 'ALL' as const },
          },
        ],
      },
      {
        name: this.auditLogsTable,
        keySchema: [
          { AttributeName: 'tenantId', KeyType: 'HASH' as const },
          { AttributeName: 'id', KeyType: 'RANGE' as const },
        ],
        attributeDefinitions: [
          { AttributeName: 'tenantId', AttributeType: 'S' as const },
          { AttributeName: 'id', AttributeType: 'S' as const },
          { AttributeName: 'timestamp', AttributeType: 'S' as const },
        ],
        globalSecondaryIndexes: [
          {
            IndexName: 'timestamp-index',
            KeySchema: [
              { AttributeName: 'tenantId', KeyType: 'HASH' as const },
              { AttributeName: 'timestamp', KeyType: 'RANGE' as const },
            ],
            Projection: { ProjectionType: 'ALL' as const },
          },
        ],
      },
      {
        name: this.usageTable,
        keySchema: [
          { AttributeName: 'tenantId', KeyType: 'HASH' as const },
          { AttributeName: 'id', KeyType: 'RANGE' as const },
        ],
        attributeDefinitions: [
          { AttributeName: 'tenantId', AttributeType: 'S' as const },
          { AttributeName: 'id', AttributeType: 'S' as const },
          { AttributeName: 'billingPeriod', AttributeType: 'S' as const },
        ],
        globalSecondaryIndexes: [
          {
            IndexName: 'billing-period-index',
            KeySchema: [
              { AttributeName: 'tenantId', KeyType: 'HASH' as const },
              { AttributeName: 'billingPeriod', KeyType: 'RANGE' as const },
            ],
            Projection: { ProjectionType: 'ALL' as const },
          },
        ],
      },
    ];

    for (const table of tables) {
      await this.createTableIfNotExists(table);
    }
  }

  private async createTableIfNotExists(tableConfig: {
    name: string;
    keySchema: { AttributeName: string; KeyType: 'HASH' | 'RANGE' }[];
    attributeDefinitions: { AttributeName: string; AttributeType: 'S' | 'N' | 'B' }[];
    globalSecondaryIndexes?: {
      IndexName: string;
      KeySchema: { AttributeName: string; KeyType: 'HASH' | 'RANGE' }[];
      Projection: { ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE' };
    }[];
  }): Promise<void> {
    try {
      await this.client.send(new DescribeTableCommand({ TableName: tableConfig.name }));
      // Table exists
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        // Create table
        const gsiConfig = tableConfig.globalSecondaryIndexes?.map(gsi => ({
          ...gsi,
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        }));

        await this.client.send(new CreateTableCommand({
          TableName: tableConfig.name,
          KeySchema: tableConfig.keySchema,
          AttributeDefinitions: tableConfig.attributeDefinitions,
          GlobalSecondaryIndexes: gsiConfig,
          BillingMode: 'PAY_PER_REQUEST',
        }));
      } else {
        throw error;
      }
    }
  }

  // ===========================================================================
  // Tenant CRUD Operations
  // ===========================================================================

  async createTenant(input: {
    name: string;
    slug: string;
    email: string;
    tier?: TenantTier;
    organization?: string;
    primaryRegion?: string;
  }): Promise<StoreResult<Tenant>> {
    try {
      const tier = input.tier ?? 'free';
      const now = new Date().toISOString();

      const tenant: Tenant = {
        id: `tenant_${randomUUID()}`,
        name: input.name,
        slug: input.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        status: tier === 'free' ? 'active' : 'trial',
        tier,
        isolationLevel: tier === 'enterprise' ? 'dedicated' : 'shared',
        email: input.email,
        organization: input.organization,
        primaryRegion: input.primaryRegion ?? 'us-east-1',
        enabledRegions: [input.primaryRegion ?? 'us-east-1'],
        quotas: TIER_QUOTAS[tier],
        features: TIER_FEATURES[tier],
        config: {
          defaultRegion: input.primaryRegion ?? 'us-east-1',
          defaultEnvironment: 'development',
          requiredTags: ['Environment', 'Project'],
          defaultTags: { ManagedBy: 'IDIO' },
          allowedComplianceFrameworks: ['none'],
          costAlertThreshold: 80,
          autoRemediationEnabled: false,
          approvalRequirements: {
            production: true,
            costAbove: 1000,
            highRisk: true,
          },
          sessionTimeoutMinutes: 480,
          mfaRequired: tier === 'enterprise',
        },
        billing: {
          billingEmail: input.email,
          hasPaymentMethod: false,
          currency: 'USD',
          trialEndDate: tier !== 'free' 
            ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
            : undefined,
        },
        metadata: {
          source: 'signup',
        },
        createdAt: now,
        updatedAt: now,
      };

      await this.docClient.send(new PutCommand({
        TableName: this.tenantsTable,
        Item: tenant,
        ConditionExpression: 'attribute_not_exists(id)',
      }));

      return { success: true, data: tenant };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create tenant',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getTenant(tenantId: string): Promise<StoreResult<Tenant>> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tenantsTable,
        Key: { id: tenantId },
      }));

      if (!result.Item) {
        return { success: false, message: 'Tenant not found' };
      }

      return { success: true, data: result.Item as Tenant };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get tenant',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getTenantBySlug(slug: string): Promise<StoreResult<Tenant>> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tenantsTable,
        IndexName: 'slug-index',
        KeyConditionExpression: 'slug = :slug',
        ExpressionAttributeValues: { ':slug': slug.toLowerCase() },
        Limit: 1,
      }));

      if (!result.Items || result.Items.length === 0) {
        return { success: false, message: 'Tenant not found' };
      }

      return { success: true, data: result.Items[0] as Tenant };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get tenant by slug',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async updateTenant(
    tenantId: string,
    updates: Partial<Omit<Tenant, 'id' | 'createdAt'>>,
  ): Promise<StoreResult<Tenant>> {
    try {
      const updateExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined && key !== 'id' && key !== 'createdAt') {
          updateExpressions.push(`#${key} = :${key}`);
          expressionAttributeNames[`#${key}`] = key;
          expressionAttributeValues[`:${key}`] = value;
        }
      }

      // Always update updatedAt
      updateExpressions.push('#updatedAt = :updatedAt');
      expressionAttributeNames['#updatedAt'] = 'updatedAt';
      expressionAttributeValues[':updatedAt'] = new Date().toISOString();

      const result = await this.docClient.send(new UpdateCommand({
        TableName: this.tenantsTable,
        Key: { id: tenantId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      }));

      return { success: true, data: result.Attributes as Tenant };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update tenant',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async updateTenantStatus(
    tenantId: string,
    status: TenantStatus,
  ): Promise<StoreResult<Tenant>> {
    return this.updateTenant(tenantId, { status });
  }

  async upgradeTenant(
    tenantId: string,
    newTier: TenantTier,
  ): Promise<StoreResult<Tenant>> {
    return this.updateTenant(tenantId, {
      tier: newTier,
      quotas: TIER_QUOTAS[newTier],
      features: TIER_FEATURES[newTier],
      isolationLevel: newTier === 'enterprise' ? 'dedicated' : 'shared',
    });
  }

  async deleteTenant(tenantId: string, hard = false): Promise<StoreResult> {
    try {
      if (hard) {
        // Hard delete - remove from database
        await this.docClient.send(new DeleteCommand({
          TableName: this.tenantsTable,
          Key: { id: tenantId },
        }));
      } else {
        // Soft delete - mark as deleted
        await this.updateTenant(tenantId, {
          status: 'deleted',
          deletedAt: new Date().toISOString(),
        });
      }

      return { success: true, message: 'Tenant deleted' };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to delete tenant',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async listTenants(options: {
    status?: TenantStatus;
    tier?: TenantTier;
    limit?: number;
    lastKey?: Record<string, unknown>;
  } = {}): Promise<StoreResult<{ tenants: Tenant[]; lastKey?: Record<string, unknown> }>> {
    try {
      let result;

      if (options.status) {
        result = await this.docClient.send(new QueryCommand({
          TableName: this.tenantsTable,
          IndexName: 'status-index',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': options.status },
          Limit: options.limit ?? 50,
          ExclusiveStartKey: options.lastKey,
        }));
      } else {
        result = await this.docClient.send(new ScanCommand({
          TableName: this.tenantsTable,
          Limit: options.limit ?? 50,
          ExclusiveStartKey: options.lastKey,
        }));
      }

      let tenants = (result.Items ?? []) as Tenant[];

      if (options.tier) {
        tenants = tenants.filter(t => t.tier === options.tier);
      }

      return {
        success: true,
        data: {
          tenants,
          lastKey: result.LastEvaluatedKey,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list tenants',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Member Operations
  // ===========================================================================

  async addMember(input: {
    tenantId: string;
    userId: string;
    email: string;
    name: string;
    role: MemberRole;
    invitedBy?: string;
  }): Promise<StoreResult<TenantMember>> {
    try {
      const now = new Date().toISOString();

      const member: TenantMember = {
        tenantId: input.tenantId,
        userId: input.userId,
        email: input.email,
        name: input.name,
        role: input.role,
        status: 'active',
        invitedBy: input.invitedBy,
        joinedAt: now,
        lastActiveAt: now,
        mfaEnabled: false,
        ssoLinked: false,
      };

      await this.docClient.send(new PutCommand({
        TableName: this.membersTable,
        Item: member,
      }));

      return { success: true, data: member };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to add member',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getMember(tenantId: string, userId: string): Promise<StoreResult<TenantMember>> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.membersTable,
        Key: { tenantId, userId },
      }));

      if (!result.Item) {
        return { success: false, message: 'Member not found' };
      }

      return { success: true, data: result.Item as TenantMember };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get member',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getMemberByEmail(email: string): Promise<StoreResult<TenantMember[]>> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.membersTable,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': email.toLowerCase() },
      }));

      return { success: true, data: (result.Items ?? []) as TenantMember[] };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get member by email',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async listMembers(tenantId: string): Promise<StoreResult<TenantMember[]>> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.membersTable,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: { ':tenantId': tenantId },
      }));

      return { success: true, data: (result.Items ?? []) as TenantMember[] };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list members',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async updateMember(
    tenantId: string,
    userId: string,
    updates: Partial<Omit<TenantMember, 'tenantId' | 'userId'>>,
  ): Promise<StoreResult<TenantMember>> {
    try {
      const updateExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          updateExpressions.push(`#${key} = :${key}`);
          expressionAttributeNames[`#${key}`] = key;
          expressionAttributeValues[`:${key}`] = value;
        }
      }

      if (updateExpressions.length === 0) {
        return this.getMember(tenantId, userId);
      }

      const result = await this.docClient.send(new UpdateCommand({
        TableName: this.membersTable,
        Key: { tenantId, userId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      }));

      return { success: true, data: result.Attributes as TenantMember };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update member',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async removeMember(tenantId: string, userId: string): Promise<StoreResult> {
    try {
      await this.docClient.send(new DeleteCommand({
        TableName: this.membersTable,
        Key: { tenantId, userId },
      }));

      return { success: true, message: 'Member removed' };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to remove member',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getUserTenants(userId: string): Promise<StoreResult<TenantMember[]>> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.membersTable,
        IndexName: 'user-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
      }));

      return { success: true, data: (result.Items ?? []) as TenantMember[] };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get user tenants',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Invitation Operations
  // ===========================================================================

  async createInvitation(input: {
    tenantId: string;
    email: string;
    role: MemberRole;
    invitedBy: string;
    teams?: string[];
    expiresInHours?: number;
  }): Promise<StoreResult<TenantInvitation & { token: string }>> {
    try {
      const token = randomUUID();
      const tokenHash = await this.hashToken(token);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (input.expiresInHours ?? 72) * 60 * 60 * 1000);

      const invitation: TenantInvitation = {
        id: `inv_${randomUUID()}`,
        tenantId: input.tenantId,
        email: input.email.toLowerCase(),
        role: input.role,
        teams: input.teams,
        tokenHash,
        invitedBy: input.invitedBy,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
        status: 'pending',
      };

      await this.docClient.send(new PutCommand({
        TableName: this.invitationsTable,
        Item: invitation,
      }));

      return { success: true, data: { ...invitation, token } };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create invitation',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getInvitation(tenantId: string, invitationId: string): Promise<StoreResult<TenantInvitation>> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.invitationsTable,
        Key: { tenantId, id: invitationId },
      }));

      if (!result.Item) {
        return { success: false, message: 'Invitation not found' };
      }

      return { success: true, data: result.Item as TenantInvitation };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get invitation',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async acceptInvitation(
    tenantId: string,
    invitationId: string,
    token: string,
    userId: string,
    userName: string,
  ): Promise<StoreResult<TenantMember>> {
    try {
      // Get invitation
      const invResult = await this.getInvitation(tenantId, invitationId);
      if (!invResult.success || !invResult.data) {
        return { success: false, message: 'Invitation not found' };
      }

      const invitation = invResult.data;

      // Verify token
      const tokenHash = await this.hashToken(token);
      if (tokenHash !== invitation.tokenHash) {
        return { success: false, message: 'Invalid invitation token' };
      }

      // Check expiration
      if (new Date(invitation.expiresAt) < new Date()) {
        return { success: false, message: 'Invitation has expired' };
      }

      // Check status
      if (invitation.status !== 'pending') {
        return { success: false, message: `Invitation is ${invitation.status}` };
      }

      // Add member
      const memberResult = await this.addMember({
        tenantId,
        userId,
        email: invitation.email,
        name: userName,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
      });

      if (!memberResult.success) {
        return memberResult;
      }

      // Update invitation status
      await this.docClient.send(new UpdateCommand({
        TableName: this.invitationsTable,
        Key: { tenantId, id: invitationId },
        UpdateExpression: 'SET #status = :status, acceptedAt = :acceptedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'accepted',
          ':acceptedAt': new Date().toISOString(),
        },
      }));

      return memberResult;
    } catch (error) {
      return {
        success: false,
        message: 'Failed to accept invitation',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Team Operations
  // ===========================================================================

  async createTeam(input: {
    tenantId: string;
    name: string;
    description?: string;
    members?: string[];
    leads?: string[];
    allowedEnvironments?: string[];
    costCenter?: string;
  }): Promise<StoreResult<TenantTeam>> {
    try {
      const now = new Date().toISOString();

      const team: TenantTeam = {
        id: `team_${randomUUID()}`,
        tenantId: input.tenantId,
        name: input.name,
        description: input.description,
        members: input.members ?? [],
        leads: input.leads ?? [],
        allowedEnvironments: input.allowedEnvironments ?? ['development', 'staging'],
        costCenter: input.costCenter,
        createdAt: now,
        updatedAt: now,
      };

      await this.docClient.send(new PutCommand({
        TableName: this.teamsTable,
        Item: team,
      }));

      return { success: true, data: team };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create team',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getTeam(tenantId: string, teamId: string): Promise<StoreResult<TenantTeam>> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.teamsTable,
        Key: { tenantId, id: teamId },
      }));

      if (!result.Item) {
        return { success: false, message: 'Team not found' };
      }

      return { success: true, data: result.Item as TenantTeam };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get team',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async listTeams(tenantId: string): Promise<StoreResult<TenantTeam[]>> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.teamsTable,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: { ':tenantId': tenantId },
      }));

      return { success: true, data: (result.Items ?? []) as TenantTeam[] };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list teams',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Usage Tracking
  // ===========================================================================

  async recordUsage(input: {
    tenantId: string;
    type: string;
    quantity: number;
    unit: string;
    userId?: string;
    projectId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<StoreResult<UsageRecord>> {
    try {
      const now = new Date();
      const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const record: UsageRecord = {
        id: `usage_${randomUUID()}`,
        tenantId: input.tenantId,
        userId: input.userId,
        projectId: input.projectId,
        type: input.type as any,
        quantity: input.quantity,
        unit: input.unit,
        timestamp: now.toISOString(),
        billingPeriod,
        metadata: input.metadata,
      };

      await this.docClient.send(new PutCommand({
        TableName: this.usageTable,
        Item: record,
      }));

      return { success: true, data: record };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to record usage',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getUsageSummary(
    tenantId: string,
    billingPeriod: string,
  ): Promise<StoreResult<UsageSummary>> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.usageTable,
        IndexName: 'billing-period-index',
        KeyConditionExpression: 'tenantId = :tenantId AND billingPeriod = :billingPeriod',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':billingPeriod': billingPeriod,
        },
      }));

      const records = (result.Items ?? []) as UsageRecord[];
      const usage: Record<string, number> = {};
      const costs: Record<string, number> = {};

      for (const record of records) {
        usage[record.type] = (usage[record.type] ?? 0) + record.quantity;
        // Cost calculation would be based on pricing tiers
        costs[record.type] = 0; // Placeholder
      }

      const summary: UsageSummary = {
        tenantId,
        billingPeriod,
        usage: usage as any,
        costs: costs as any,
        totalCost: Object.values(costs).reduce((a, b) => a + b, 0),
        quotaUsage: {},
        generatedAt: new Date().toISOString(),
      };

      return { success: true, data: summary };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get usage summary',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Audit Logging
  // ===========================================================================

  async logAuditEvent(input: {
    tenantId: string;
    userId: string;
    userEmail: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    request?: TenantAuditLog['request'];
    changes?: TenantAuditLog['changes'];
    result: 'success' | 'failure' | 'denied';
    errorMessage?: string;
  }): Promise<StoreResult<TenantAuditLog>> {
    try {
      const now = new Date();
      
      // Get tenant to determine retention period
      const tenantResult = await this.getTenant(input.tenantId);
      const retentionDays = tenantResult.data?.quotas.auditLogRetentionDays ?? 30;
      const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

      const log: TenantAuditLog = {
        id: `audit_${randomUUID()}`,
        tenantId: input.tenantId,
        userId: input.userId,
        userEmail: input.userEmail,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        request: input.request,
        changes: input.changes,
        result: input.result,
        errorMessage: input.errorMessage,
        timestamp: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      await this.docClient.send(new PutCommand({
        TableName: this.auditLogsTable,
        Item: log,
      }));

      return { success: true, data: log };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to log audit event',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async queryAuditLogs(
    tenantId: string,
    options: {
      startTime?: string;
      endTime?: string;
      userId?: string;
      action?: string;
      resourceType?: string;
      limit?: number;
    } = {},
  ): Promise<StoreResult<TenantAuditLog[]>> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.auditLogsTable,
        IndexName: 'timestamp-index',
        KeyConditionExpression: 'tenantId = :tenantId' +
          (options.startTime ? ' AND #timestamp >= :startTime' : ''),
        FilterExpression: [
          options.userId ? 'userId = :userId' : null,
          options.action ? '#action = :action' : null,
          options.resourceType ? 'resourceType = :resourceType' : null,
          options.endTime ? '#timestamp <= :endTime' : null,
        ].filter(Boolean).join(' AND ') || undefined,
        ExpressionAttributeNames: {
          ...(options.startTime || options.endTime ? { '#timestamp': 'timestamp' } : {}),
          ...(options.action ? { '#action': 'action' } : {}),
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ...(options.startTime ? { ':startTime': options.startTime } : {}),
          ...(options.endTime ? { ':endTime': options.endTime } : {}),
          ...(options.userId ? { ':userId': options.userId } : {}),
          ...(options.action ? { ':action': options.action } : {}),
          ...(options.resourceType ? { ':resourceType': options.resourceType } : {}),
        },
        Limit: options.limit ?? 100,
        ScanIndexForward: false, // Newest first
      }));

      return { success: true, data: (result.Items ?? []) as TenantAuditLog[] };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to query audit logs',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createTenantStore(config?: TenantStoreConfig): TenantStore {
  return new TenantStore(config);
}
