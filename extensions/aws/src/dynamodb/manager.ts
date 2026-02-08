/**
 * DynamoDB Manager - NoSQL Database Operations
 * 
 * Comprehensive DynamoDB table and item management with:
 * - Table lifecycle (create, update, delete, describe)
 * - Capacity management (on-demand, provisioned, auto-scaling)
 * - Global tables for multi-region
 * - Backup and restore (PITR, on-demand)
 * - Streams and triggers
 * - GSI/LSI management
 */

import { withAWSRetry, type AWSRetryOptions } from '../retry.js';

import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  UpdateTableCommand,
  ListTablesCommand,
  UpdateTimeToLiveCommand,
  DescribeTimeToLiveCommand,
  CreateBackupCommand,
  DeleteBackupCommand,
  ListBackupsCommand,
  RestoreTableFromBackupCommand,
  DescribeContinuousBackupsCommand,
  UpdateContinuousBackupsCommand,
  CreateGlobalTableCommand,
  DescribeGlobalTableCommand,
  UpdateGlobalTableCommand,
  ListGlobalTablesCommand,
  DescribeTableReplicaAutoScalingCommand,
  UpdateTableReplicaAutoScalingCommand,
  TagResourceCommand,
  UntagResourceCommand,
  ListTagsOfResourceCommand,
  DescribeKinesisStreamingDestinationCommand,
  EnableKinesisStreamingDestinationCommand,
  DisableKinesisStreamingDestinationCommand,
  ExportTableToPointInTimeCommand,
  DescribeExportCommand,
  ListExportsCommand,
  ImportTableCommand,
  DescribeImportCommand,
  ListImportsCommand,
  type TableDescription,
  type GlobalSecondaryIndex,
  type LocalSecondaryIndex,
  type AttributeDefinition,
  type KeySchemaElement,
  type ProvisionedThroughput,
  type StreamSpecification,
  type SSESpecification,
  type Tag,
  type BillingMode,
  type GlobalSecondaryIndexUpdate,
  type ReplicaUpdate,
  type BackupSummary,
  type GlobalTableDescription,
  type ExportDescription,
  type ImportSummary,
} from '@aws-sdk/client-dynamodb';

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactGetCommand,
  TransactWriteCommand,
  type GetCommandInput,
  type PutCommandInput,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';

import {
  ApplicationAutoScalingClient,
  RegisterScalableTargetCommand,
  PutScalingPolicyCommand,
  DescribeScalableTargetsCommand,
  DescribeScalingPoliciesCommand,
  DeleteScalingPolicyCommand,
  DeregisterScalableTargetCommand,
} from '@aws-sdk/client-application-auto-scaling';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface DynamoDBManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
  defaultTags?: Record<string, string>;
}

export interface TableConfig {
  tableName: string;
  partitionKey: KeyAttribute;
  sortKey?: KeyAttribute;
  billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
  provisionedThroughput?: {
    readCapacityUnits: number;
    writeCapacityUnits: number;
  };
  globalSecondaryIndexes?: GSIConfig[];
  localSecondaryIndexes?: LSIConfig[];
  streamEnabled?: boolean;
  streamViewType?: 'KEYS_ONLY' | 'NEW_IMAGE' | 'OLD_IMAGE' | 'NEW_AND_OLD_IMAGES';
  encryption?: {
    enabled: boolean;
    kmsKeyId?: string;
  };
  ttlAttribute?: string;
  pointInTimeRecovery?: boolean;
  deletionProtection?: boolean;
  tags?: Record<string, string>;
  tableClass?: 'STANDARD' | 'STANDARD_INFREQUENT_ACCESS';
}

export interface KeyAttribute {
  name: string;
  type: 'S' | 'N' | 'B'; // String, Number, Binary
}

export interface GSIConfig {
  indexName: string;
  partitionKey: KeyAttribute;
  sortKey?: KeyAttribute;
  projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
  nonKeyAttributes?: string[];
  provisionedThroughput?: {
    readCapacityUnits: number;
    writeCapacityUnits: number;
  };
}

export interface LSIConfig {
  indexName: string;
  sortKey: KeyAttribute;
  projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
  nonKeyAttributes?: string[];
}

export interface AutoScalingConfig {
  tableName: string;
  minReadCapacity: number;
  maxReadCapacity: number;
  minWriteCapacity: number;
  maxWriteCapacity: number;
  targetReadUtilization?: number; // Default 70%
  targetWriteUtilization?: number; // Default 70%
  scaleInCooldown?: number; // Seconds
  scaleOutCooldown?: number; // Seconds
  gsiAutoScaling?: {
    indexName: string;
    minReadCapacity: number;
    maxReadCapacity: number;
    minWriteCapacity: number;
    maxWriteCapacity: number;
  }[];
}

export interface GlobalTableConfig {
  tableName: string;
  replicaRegions: string[];
}

export interface BackupConfig {
  tableName: string;
  backupName: string;
}

export interface RestoreConfig {
  targetTableName: string;
  backupArn: string;
  billingModeOverride?: 'PAY_PER_REQUEST' | 'PROVISIONED';
  globalSecondaryIndexOverride?: GSIConfig[];
  localSecondaryIndexOverride?: LSIConfig[];
  sseSpecificationOverride?: {
    enabled: boolean;
    kmsKeyId?: string;
  };
}

export interface ExportConfig {
  tableName: string;
  s3Bucket: string;
  s3Prefix?: string;
  exportFormat?: 'DYNAMODB_JSON' | 'ION';
  exportTime?: Date;
  s3SseAlgorithm?: 'AES256' | 'KMS';
  s3SseKmsKeyId?: string;
}

export interface ImportConfig {
  tableName: string;
  s3Bucket: string;
  s3KeyPrefix?: string;
  inputFormat: 'DYNAMODB_JSON' | 'ION' | 'CSV';
  inputCompressionType?: 'GZIP' | 'ZSTD' | 'NONE';
  tableCreationParameters: {
    partitionKey: KeyAttribute;
    sortKey?: KeyAttribute;
    billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
    provisionedThroughput?: {
      readCapacityUnits: number;
      writeCapacityUnits: number;
    };
    globalSecondaryIndexes?: GSIConfig[];
    sseSpecification?: {
      enabled: boolean;
      kmsKeyId?: string;
    };
  };
}

export interface QueryOptions {
  indexName?: string;
  keyConditionExpression: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
  filterExpression?: string;
  projectionExpression?: string;
  scanIndexForward?: boolean;
  limit?: number;
  consistentRead?: boolean;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface ScanOptions {
  indexName?: string;
  filterExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
  projectionExpression?: string;
  limit?: number;
  consistentRead?: boolean;
  exclusiveStartKey?: Record<string, unknown>;
  segment?: number;
  totalSegments?: number;
}

export interface TableMetrics {
  tableName: string;
  itemCount: number;
  tableSizeBytes: number;
  billingMode: string;
  provisionedReadCapacity?: number;
  provisionedWriteCapacity?: number;
  gsiCount: number;
  lsiCount: number;
  streamEnabled: boolean;
  ttlEnabled: boolean;
  pitrEnabled: boolean;
  encryptionType: string;
  tableClass: string;
  createdAt: Date;
  lastUpdatedAt?: Date;
  tableStatus: string;
  globalTableRegions?: string[];
}

export interface DynamoDBOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  consumedCapacity?: {
    tableName: string;
    capacityUnits: number;
    readCapacityUnits?: number;
    writeCapacityUnits?: number;
  };
}

// ============================================================================
// DynamoDB Manager Implementation
// ============================================================================

export class DynamoDBManager {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private autoScalingClient: ApplicationAutoScalingClient;
  private config: DynamoDBManagerConfig;
  private retryOptions: AWSRetryOptions;

  constructor(config: DynamoDBManagerConfig = {}, retryOptions: AWSRetryOptions = {}) {
    this.config = config;
    this.retryOptions = retryOptions;
    
    this.client = new DynamoDBClient({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });

    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        convertEmptyValues: false,
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });

    this.autoScalingClient = new ApplicationAutoScalingClient({
      region: config.region,
      credentials: config.credentials,
    });
  }

  // --------------------------------------------------------------------------
  // Retry Helper
  // --------------------------------------------------------------------------

  private async withRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return withAWSRetry(fn, {
      ...this.retryOptions,
      label: label || this.retryOptions.label,
    });
  }

  // ==========================================================================
  // Table Operations
  // ==========================================================================

  /**
   * Create a new DynamoDB table
   */
  async createTable(config: TableConfig): Promise<DynamoDBOperationResult<TableDescription>> {
    try {
      const attributeDefinitions: AttributeDefinition[] = [
        { AttributeName: config.partitionKey.name, AttributeType: config.partitionKey.type },
      ];

      const keySchema: KeySchemaElement[] = [
        { AttributeName: config.partitionKey.name, KeyType: 'HASH' },
      ];

      if (config.sortKey) {
        attributeDefinitions.push({
          AttributeName: config.sortKey.name,
          AttributeType: config.sortKey.type,
        });
        keySchema.push({ AttributeName: config.sortKey.name, KeyType: 'RANGE' });
      }

      // Add GSI attribute definitions
      if (config.globalSecondaryIndexes) {
        for (const gsi of config.globalSecondaryIndexes) {
          if (!attributeDefinitions.find(a => a.AttributeName === gsi.partitionKey.name)) {
            attributeDefinitions.push({
              AttributeName: gsi.partitionKey.name,
              AttributeType: gsi.partitionKey.type,
            });
          }
          if (gsi.sortKey && !attributeDefinitions.find(a => a.AttributeName === gsi.sortKey!.name)) {
            attributeDefinitions.push({
              AttributeName: gsi.sortKey.name,
              AttributeType: gsi.sortKey.type,
            });
          }
        }
      }

      // Add LSI attribute definitions
      if (config.localSecondaryIndexes) {
        for (const lsi of config.localSecondaryIndexes) {
          if (!attributeDefinitions.find(a => a.AttributeName === lsi.sortKey.name)) {
            attributeDefinitions.push({
              AttributeName: lsi.sortKey.name,
              AttributeType: lsi.sortKey.type,
            });
          }
        }
      }

      const globalSecondaryIndexes: GlobalSecondaryIndex[] | undefined = config.globalSecondaryIndexes?.map(gsi => ({
        IndexName: gsi.indexName,
        KeySchema: [
          { AttributeName: gsi.partitionKey.name, KeyType: 'HASH' as const },
          ...(gsi.sortKey ? [{ AttributeName: gsi.sortKey.name, KeyType: 'RANGE' as const }] : []),
        ],
        Projection: {
          ProjectionType: gsi.projectionType,
          NonKeyAttributes: gsi.projectionType === 'INCLUDE' ? gsi.nonKeyAttributes : undefined,
        },
        ProvisionedThroughput: config.billingMode === 'PROVISIONED' && gsi.provisionedThroughput ? {
          ReadCapacityUnits: gsi.provisionedThroughput.readCapacityUnits,
          WriteCapacityUnits: gsi.provisionedThroughput.writeCapacityUnits,
        } : undefined,
      }));

      const localSecondaryIndexes: LocalSecondaryIndex[] | undefined = config.localSecondaryIndexes?.map(lsi => ({
        IndexName: lsi.indexName,
        KeySchema: [
          { AttributeName: config.partitionKey.name, KeyType: 'HASH' as const },
          { AttributeName: lsi.sortKey.name, KeyType: 'RANGE' as const },
        ],
        Projection: {
          ProjectionType: lsi.projectionType,
          NonKeyAttributes: lsi.projectionType === 'INCLUDE' ? lsi.nonKeyAttributes : undefined,
        },
      }));

      const streamSpecification: StreamSpecification | undefined = config.streamEnabled ? {
        StreamEnabled: true,
        StreamViewType: config.streamViewType ?? 'NEW_AND_OLD_IMAGES',
      } : undefined;

      const sseSpecification: SSESpecification | undefined = config.encryption?.enabled ? {
        Enabled: true,
        SSEType: config.encryption.kmsKeyId ? 'KMS' : 'AES256',
        KMSMasterKeyId: config.encryption.kmsKeyId,
      } : undefined;

      const tags: Tag[] = Object.entries({ ...this.config.defaultTags, ...config.tags }).map(
        ([Key, Value]) => ({ Key, Value })
      );

      const response = await this.withRetry(
        () => this.client.send(new CreateTableCommand({
          TableName: config.tableName,
          AttributeDefinitions: attributeDefinitions,
          KeySchema: keySchema,
          BillingMode: config.billingMode ?? 'PAY_PER_REQUEST',
          ProvisionedThroughput: config.billingMode === 'PROVISIONED' ? {
            ReadCapacityUnits: config.provisionedThroughput?.readCapacityUnits ?? 5,
            WriteCapacityUnits: config.provisionedThroughput?.writeCapacityUnits ?? 5,
          } : undefined,
          GlobalSecondaryIndexes: globalSecondaryIndexes?.length ? globalSecondaryIndexes : undefined,
          LocalSecondaryIndexes: localSecondaryIndexes?.length ? localSecondaryIndexes : undefined,
          StreamSpecification: streamSpecification,
          SSESpecification: sseSpecification,
          Tags: tags.length ? tags : undefined,
          TableClass: config.tableClass,
          DeletionProtectionEnabled: config.deletionProtection,
        })),
        'CreateTable'
      );

      // Enable TTL if specified
      if (config.ttlAttribute) {
        await this.enableTTL(config.tableName, config.ttlAttribute);
      }

      // Enable PITR if specified
      if (config.pointInTimeRecovery) {
        await this.enablePointInTimeRecovery(config.tableName);
      }

      return {
        success: true,
        data: response.TableDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a DynamoDB table
   */
  async deleteTable(tableName: string): Promise<DynamoDBOperationResult<TableDescription>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new DeleteTableCommand({
          TableName: tableName,
        })),
        'DeleteTable'
      );

      return {
        success: true,
        data: response.TableDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Describe a DynamoDB table
   */
  async describeTable(tableName: string): Promise<DynamoDBOperationResult<TableMetrics>> {
    try {
      const [tableResponse, ttlResponse, pitrResponse] = await Promise.all([
        this.withRetry(() => this.client.send(new DescribeTableCommand({ TableName: tableName })), 'DescribeTable'),
        this.withRetry(() => this.client.send(new DescribeTimeToLiveCommand({ TableName: tableName })), 'DescribeTimeToLive'),
        this.withRetry(() => this.client.send(new DescribeContinuousBackupsCommand({ TableName: tableName })), 'DescribeContinuousBackups'),
      ]);

      const table = tableResponse.Table!;
      
      const metrics: TableMetrics = {
        tableName: table.TableName!,
        itemCount: table.ItemCount ?? 0,
        tableSizeBytes: table.TableSizeBytes ?? 0,
        billingMode: table.BillingModeSummary?.BillingMode ?? 'PROVISIONED',
        provisionedReadCapacity: table.ProvisionedThroughput?.ReadCapacityUnits,
        provisionedWriteCapacity: table.ProvisionedThroughput?.WriteCapacityUnits,
        gsiCount: table.GlobalSecondaryIndexes?.length ?? 0,
        lsiCount: table.LocalSecondaryIndexes?.length ?? 0,
        streamEnabled: table.StreamSpecification?.StreamEnabled ?? false,
        ttlEnabled: ttlResponse.TimeToLiveDescription?.TimeToLiveStatus === 'ENABLED',
        pitrEnabled: pitrResponse.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === 'ENABLED',
        encryptionType: table.SSEDescription?.SSEType ?? 'DEFAULT',
        tableClass: table.TableClassSummary?.TableClass ?? 'STANDARD',
        createdAt: table.CreationDateTime!,
        lastUpdatedAt: table.TableId ? new Date() : undefined,
        tableStatus: table.TableStatus ?? 'UNKNOWN',
        globalTableRegions: table.Replicas?.map(r => r.RegionName!),
      };

      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all DynamoDB tables
   */
  async listTables(limit?: number): Promise<DynamoDBOperationResult<string[]>> {
    try {
      const tables: string[] = [];
      let exclusiveStartTableName: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListTablesCommand({
            ExclusiveStartTableName: exclusiveStartTableName,
            Limit: limit ? Math.min(limit - tables.length, 100) : 100,
          })),
          'ListTables'
        );

        tables.push(...(response.TableNames ?? []));
        exclusiveStartTableName = response.LastEvaluatedTableName;

        if (limit && tables.length >= limit) break;
      } while (exclusiveStartTableName);

      return {
        success: true,
        data: tables,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update table settings (billing mode, throughput, etc.)
   */
  async updateTable(
    tableName: string,
    updates: {
      billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
      provisionedThroughput?: { readCapacityUnits: number; writeCapacityUnits: number };
      gsiUpdates?: GlobalSecondaryIndexUpdate[];
      streamSpecification?: StreamSpecification;
      deletionProtection?: boolean;
      tableClass?: 'STANDARD' | 'STANDARD_INFREQUENT_ACCESS';
    }
  ): Promise<DynamoDBOperationResult<TableDescription>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new UpdateTableCommand({
          TableName: tableName,
          BillingMode: updates.billingMode,
          ProvisionedThroughput: updates.provisionedThroughput ? {
            ReadCapacityUnits: updates.provisionedThroughput.readCapacityUnits,
            WriteCapacityUnits: updates.provisionedThroughput.writeCapacityUnits,
          } : undefined,
          GlobalSecondaryIndexUpdates: updates.gsiUpdates,
          StreamSpecification: updates.streamSpecification,
          DeletionProtectionEnabled: updates.deletionProtection,
          TableClass: updates.tableClass,
        })),
        'UpdateTable'
      );

      return {
        success: true,
        data: response.TableDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // TTL Operations
  // ==========================================================================

  /**
   * Enable TTL on a table
   */
  async enableTTL(tableName: string, attributeName: string): Promise<DynamoDBOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new UpdateTimeToLiveCommand({
          TableName: tableName,
          TimeToLiveSpecification: {
            Enabled: true,
            AttributeName: attributeName,
          },
        })),
        'UpdateTimeToLive'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disable TTL on a table
   */
  async disableTTL(tableName: string, attributeName: string): Promise<DynamoDBOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new UpdateTimeToLiveCommand({
          TableName: tableName,
          TimeToLiveSpecification: {
            Enabled: false,
            AttributeName: attributeName,
          },
        })),
        'UpdateTimeToLive'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Backup Operations
  // ==========================================================================

  /**
   * Enable Point-in-Time Recovery
   */
  async enablePointInTimeRecovery(tableName: string): Promise<DynamoDBOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new UpdateContinuousBackupsCommand({
          TableName: tableName,
          PointInTimeRecoverySpecification: {
            PointInTimeRecoveryEnabled: true,
          },
        })),
        'UpdateContinuousBackups'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create an on-demand backup
   */
  async createBackup(config: BackupConfig): Promise<DynamoDBOperationResult<{ backupArn: string }>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new CreateBackupCommand({
          TableName: config.tableName,
          BackupName: config.backupName,
        })),
        'CreateBackup'
      );

      return {
        success: true,
        data: { backupArn: response.BackupDetails!.BackupArn! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupArn: string): Promise<DynamoDBOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new DeleteBackupCommand({
          BackupArn: backupArn,
        })),
        'DeleteBackup'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List backups for a table
   */
  async listBackups(tableName?: string): Promise<DynamoDBOperationResult<BackupSummary[]>> {
    try {
      const backups: BackupSummary[] = [];
      let exclusiveStartBackupArn: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListBackupsCommand({
            TableName: tableName,
            ExclusiveStartBackupArn: exclusiveStartBackupArn,
          })),
          'ListBackups'
        );

        backups.push(...(response.BackupSummaries ?? []));
        exclusiveStartBackupArn = response.LastEvaluatedBackupArn;
      } while (exclusiveStartBackupArn);

      return {
        success: true,
        data: backups,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Restore a table from backup
   */
  async restoreFromBackup(config: RestoreConfig): Promise<DynamoDBOperationResult<TableDescription>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new RestoreTableFromBackupCommand({
          TargetTableName: config.targetTableName,
          BackupArn: config.backupArn,
          BillingModeOverride: config.billingModeOverride,
          GlobalSecondaryIndexOverride: config.globalSecondaryIndexOverride?.map(gsi => ({
            IndexName: gsi.indexName,
            KeySchema: [
              { AttributeName: gsi.partitionKey.name, KeyType: 'HASH' as const },
              ...(gsi.sortKey ? [{ AttributeName: gsi.sortKey.name, KeyType: 'RANGE' as const }] : []),
            ],
            Projection: {
              ProjectionType: gsi.projectionType,
              NonKeyAttributes: gsi.projectionType === 'INCLUDE' ? gsi.nonKeyAttributes : undefined,
            },
            ProvisionedThroughput: gsi.provisionedThroughput ? {
              ReadCapacityUnits: gsi.provisionedThroughput.readCapacityUnits,
              WriteCapacityUnits: gsi.provisionedThroughput.writeCapacityUnits,
            } : undefined,
          })),
          SSESpecificationOverride: config.sseSpecificationOverride ? {
            Enabled: config.sseSpecificationOverride.enabled,
            SSEType: config.sseSpecificationOverride.kmsKeyId ? 'KMS' : 'AES256',
            KMSMasterKeyId: config.sseSpecificationOverride.kmsKeyId,
          } : undefined,
        })),
        'RestoreTableFromBackup'
      );

      return {
        success: true,
        data: response.TableDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Global Tables
  // ==========================================================================

  /**
   * Create a global table (multi-region)
   */
  async createGlobalTable(config: GlobalTableConfig): Promise<DynamoDBOperationResult<GlobalTableDescription>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new CreateGlobalTableCommand({
          GlobalTableName: config.tableName,
          ReplicationGroup: config.replicaRegions.map(region => ({
            RegionName: region,
          })),
        })),
        'CreateGlobalTable'
      );

      return {
        success: true,
        data: response.GlobalTableDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add or remove replicas from a global table
   */
  async updateGlobalTable(
    tableName: string,
    replicaUpdates: ReplicaUpdate[]
  ): Promise<DynamoDBOperationResult<GlobalTableDescription>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new UpdateGlobalTableCommand({
          GlobalTableName: tableName,
          ReplicaUpdates: replicaUpdates,
        })),
        'UpdateGlobalTable'
      );

      return {
        success: true,
        data: response.GlobalTableDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all global tables
   */
  async listGlobalTables(): Promise<DynamoDBOperationResult<GlobalTableDescription[]>> {
    try {
      const globalTables: GlobalTableDescription[] = [];
      let exclusiveStartGlobalTableName: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListGlobalTablesCommand({
            ExclusiveStartGlobalTableName: exclusiveStartGlobalTableName,
          })),
          'ListGlobalTables'
        );

        // Fetch details for each global table
        for (const gt of response.GlobalTables ?? []) {
          const details = await this.withRetry(
            () => this.client.send(new DescribeGlobalTableCommand({
              GlobalTableName: gt.GlobalTableName,
            })),
            'DescribeGlobalTable'
          );
          if (details.GlobalTableDescription) {
            globalTables.push(details.GlobalTableDescription);
          }
        }

        exclusiveStartGlobalTableName = response.LastEvaluatedGlobalTableName;
      } while (exclusiveStartGlobalTableName);

      return {
        success: true,
        data: globalTables,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Auto Scaling
  // ==========================================================================

  /**
   * Configure auto scaling for a table
   */
  async configureAutoScaling(config: AutoScalingConfig): Promise<DynamoDBOperationResult<void>> {
    try {
      const resourceId = `table/${config.tableName}`;

      // Register read capacity target
      await this.autoScalingClient.send(new RegisterScalableTargetCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
        MinCapacity: config.minReadCapacity,
        MaxCapacity: config.maxReadCapacity,
      }));

      // Register write capacity target
      await this.autoScalingClient.send(new RegisterScalableTargetCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
        MinCapacity: config.minWriteCapacity,
        MaxCapacity: config.maxWriteCapacity,
      }));

      // Create read scaling policy
      await this.autoScalingClient.send(new PutScalingPolicyCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
        PolicyName: `${config.tableName}-read-scaling-policy`,
        PolicyType: 'TargetTrackingScaling',
        TargetTrackingScalingPolicyConfiguration: {
          TargetValue: config.targetReadUtilization ?? 70,
          PredefinedMetricSpecification: {
            PredefinedMetricType: 'DynamoDBReadCapacityUtilization',
          },
          ScaleInCooldown: config.scaleInCooldown ?? 60,
          ScaleOutCooldown: config.scaleOutCooldown ?? 60,
        },
      }));

      // Create write scaling policy
      await this.autoScalingClient.send(new PutScalingPolicyCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
        PolicyName: `${config.tableName}-write-scaling-policy`,
        PolicyType: 'TargetTrackingScaling',
        TargetTrackingScalingPolicyConfiguration: {
          TargetValue: config.targetWriteUtilization ?? 70,
          PredefinedMetricSpecification: {
            PredefinedMetricType: 'DynamoDBWriteCapacityUtilization',
          },
          ScaleInCooldown: config.scaleInCooldown ?? 60,
          ScaleOutCooldown: config.scaleOutCooldown ?? 60,
        },
      }));

      // Configure GSI auto scaling if specified
      if (config.gsiAutoScaling) {
        for (const gsi of config.gsiAutoScaling) {
          const gsiResourceId = `table/${config.tableName}/index/${gsi.indexName}`;

          await this.autoScalingClient.send(new RegisterScalableTargetCommand({
            ServiceNamespace: 'dynamodb',
            ResourceId: gsiResourceId,
            ScalableDimension: 'dynamodb:index:ReadCapacityUnits',
            MinCapacity: gsi.minReadCapacity,
            MaxCapacity: gsi.maxReadCapacity,
          }));

          await this.autoScalingClient.send(new RegisterScalableTargetCommand({
            ServiceNamespace: 'dynamodb',
            ResourceId: gsiResourceId,
            ScalableDimension: 'dynamodb:index:WriteCapacityUnits',
            MinCapacity: gsi.minWriteCapacity,
            MaxCapacity: gsi.maxWriteCapacity,
          }));

          await this.autoScalingClient.send(new PutScalingPolicyCommand({
            ServiceNamespace: 'dynamodb',
            ResourceId: gsiResourceId,
            ScalableDimension: 'dynamodb:index:ReadCapacityUnits',
            PolicyName: `${config.tableName}-${gsi.indexName}-read-scaling-policy`,
            PolicyType: 'TargetTrackingScaling',
            TargetTrackingScalingPolicyConfiguration: {
              TargetValue: config.targetReadUtilization ?? 70,
              PredefinedMetricSpecification: {
                PredefinedMetricType: 'DynamoDBReadCapacityUtilization',
              },
              ScaleInCooldown: config.scaleInCooldown ?? 60,
              ScaleOutCooldown: config.scaleOutCooldown ?? 60,
            },
          }));

          await this.autoScalingClient.send(new PutScalingPolicyCommand({
            ServiceNamespace: 'dynamodb',
            ResourceId: gsiResourceId,
            ScalableDimension: 'dynamodb:index:WriteCapacityUnits',
            PolicyName: `${config.tableName}-${gsi.indexName}-write-scaling-policy`,
            PolicyType: 'TargetTrackingScaling',
            TargetTrackingScalingPolicyConfiguration: {
              TargetValue: config.targetWriteUtilization ?? 70,
              PredefinedMetricSpecification: {
                PredefinedMetricType: 'DynamoDBWriteCapacityUtilization',
              },
              ScaleInCooldown: config.scaleInCooldown ?? 60,
              ScaleOutCooldown: config.scaleOutCooldown ?? 60,
            },
          }));
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Remove auto scaling configuration
   */
  async removeAutoScaling(tableName: string): Promise<DynamoDBOperationResult<void>> {
    try {
      const resourceId = `table/${tableName}`;

      // Delete scaling policies
      await this.autoScalingClient.send(new DeleteScalingPolicyCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
        PolicyName: `${tableName}-read-scaling-policy`,
      })).catch(() => {}); // Ignore if doesn't exist

      await this.autoScalingClient.send(new DeleteScalingPolicyCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
        PolicyName: `${tableName}-write-scaling-policy`,
      })).catch(() => {});

      // Deregister scalable targets
      await this.autoScalingClient.send(new DeregisterScalableTargetCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
      })).catch(() => {});

      await this.autoScalingClient.send(new DeregisterScalableTargetCommand({
        ServiceNamespace: 'dynamodb',
        ResourceId: resourceId,
        ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
      })).catch(() => {});

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Kinesis Streaming
  // ==========================================================================

  /**
   * Enable Kinesis streaming for a table
   */
  async enableKinesisStreaming(
    tableName: string,
    streamArn: string
  ): Promise<DynamoDBOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new EnableKinesisStreamingDestinationCommand({
          TableName: tableName,
          StreamArn: streamArn,
        })),
        'EnableKinesisStreamingDestination'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disable Kinesis streaming for a table
   */
  async disableKinesisStreaming(
    tableName: string,
    streamArn: string
  ): Promise<DynamoDBOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new DisableKinesisStreamingDestinationCommand({
          TableName: tableName,
          StreamArn: streamArn,
        })),
        'DisableKinesisStreamingDestination'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Export/Import Operations
  // ==========================================================================

  /**
   * Export table to S3
   */
  async exportToS3(config: ExportConfig): Promise<DynamoDBOperationResult<ExportDescription>> {
    try {
      // Get table ARN
      const tableResponse = await this.withRetry(
        () => this.client.send(new DescribeTableCommand({
          TableName: config.tableName,
        })),
        'DescribeTable'
      );

      const response = await this.withRetry(
        () => this.client.send(new ExportTableToPointInTimeCommand({
          TableArn: tableResponse.Table!.TableArn,
          S3Bucket: config.s3Bucket,
          S3Prefix: config.s3Prefix,
          ExportFormat: config.exportFormat ?? 'DYNAMODB_JSON',
          ExportTime: config.exportTime,
          S3SseAlgorithm: config.s3SseAlgorithm,
          S3SseKmsKeyId: config.s3SseKmsKeyId,
        })),
        'ExportTableToPointInTime'
      );

      return {
        success: true,
        data: response.ExportDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Import table from S3
   */
  async importFromS3(config: ImportConfig): Promise<DynamoDBOperationResult<ImportSummary>> {
    try {
      const attributeDefinitions: AttributeDefinition[] = [
        {
          AttributeName: config.tableCreationParameters.partitionKey.name,
          AttributeType: config.tableCreationParameters.partitionKey.type,
        },
      ];

      const keySchema: KeySchemaElement[] = [
        { AttributeName: config.tableCreationParameters.partitionKey.name, KeyType: 'HASH' },
      ];

      if (config.tableCreationParameters.sortKey) {
        attributeDefinitions.push({
          AttributeName: config.tableCreationParameters.sortKey.name,
          AttributeType: config.tableCreationParameters.sortKey.type,
        });
        keySchema.push({
          AttributeName: config.tableCreationParameters.sortKey.name,
          KeyType: 'RANGE',
        });
      }

      const response = await this.withRetry(
        () => this.client.send(new ImportTableCommand({
          S3BucketSource: {
            S3Bucket: config.s3Bucket,
            S3KeyPrefix: config.s3KeyPrefix,
          },
          InputFormat: config.inputFormat,
          InputCompressionType: config.inputCompressionType,
          TableCreationParameters: {
            TableName: config.tableName,
            AttributeDefinitions: attributeDefinitions,
            KeySchema: keySchema,
            BillingMode: config.tableCreationParameters.billingMode ?? 'PAY_PER_REQUEST',
            ProvisionedThroughput: config.tableCreationParameters.provisionedThroughput ? {
              ReadCapacityUnits: config.tableCreationParameters.provisionedThroughput.readCapacityUnits,
              WriteCapacityUnits: config.tableCreationParameters.provisionedThroughput.writeCapacityUnits,
            } : undefined,
            SSESpecification: config.tableCreationParameters.sseSpecification ? {
              Enabled: config.tableCreationParameters.sseSpecification.enabled,
              SSEType: config.tableCreationParameters.sseSpecification.kmsKeyId ? 'KMS' : 'AES256',
              KMSMasterKeyId: config.tableCreationParameters.sseSpecification.kmsKeyId,
            } : undefined,
          },
        })),
        'ImportTable'
      );

      return {
        success: true,
        data: response.ImportTableDescription,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Item Operations (Document Client)
  // ==========================================================================

  /**
   * Get a single item
   */
  async getItem<T = Record<string, unknown>>(
    tableName: string,
    key: Record<string, unknown>,
    options?: {
      consistentRead?: boolean;
      projectionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
    }
  ): Promise<DynamoDBOperationResult<T | undefined>> {
    try {
      const response = await this.withRetry(
        () => this.docClient.send(new GetCommand({
          TableName: tableName,
          Key: key,
          ConsistentRead: options?.consistentRead,
          ProjectionExpression: options?.projectionExpression,
          ExpressionAttributeNames: options?.expressionAttributeNames,
        })),
        'Get'
      );

      return {
        success: true,
        data: response.Item as T | undefined,
        consumedCapacity: response.ConsumedCapacity ? {
          tableName: response.ConsumedCapacity.TableName!,
          capacityUnits: response.ConsumedCapacity.CapacityUnits ?? 0,
          readCapacityUnits: response.ConsumedCapacity.ReadCapacityUnits,
          writeCapacityUnits: response.ConsumedCapacity.WriteCapacityUnits,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Put (create or replace) an item
   */
  async putItem(
    tableName: string,
    item: Record<string, unknown>,
    options?: {
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
      returnValues?: 'NONE' | 'ALL_OLD';
    }
  ): Promise<DynamoDBOperationResult<Record<string, unknown> | undefined>> {
    try {
      const response = await this.withRetry(
        () => this.docClient.send(new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: options?.conditionExpression,
          ExpressionAttributeNames: options?.expressionAttributeNames,
          ExpressionAttributeValues: options?.expressionAttributeValues,
          ReturnValues: options?.returnValues,
        })),
        'Put'
      );

      return {
        success: true,
        data: response.Attributes,
        consumedCapacity: response.ConsumedCapacity ? {
          tableName: response.ConsumedCapacity.TableName!,
          capacityUnits: response.ConsumedCapacity.CapacityUnits ?? 0,
          readCapacityUnits: response.ConsumedCapacity.ReadCapacityUnits,
          writeCapacityUnits: response.ConsumedCapacity.WriteCapacityUnits,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update an item
   */
  async updateItem(
    tableName: string,
    key: Record<string, unknown>,
    options: {
      updateExpression: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
      conditionExpression?: string;
      returnValues?: 'NONE' | 'ALL_OLD' | 'UPDATED_OLD' | 'ALL_NEW' | 'UPDATED_NEW';
    }
  ): Promise<DynamoDBOperationResult<Record<string, unknown> | undefined>> {
    try {
      const response = await this.withRetry(
        () => this.docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression: options.updateExpression,
          ExpressionAttributeNames: options.expressionAttributeNames,
          ExpressionAttributeValues: options.expressionAttributeValues,
          ConditionExpression: options.conditionExpression,
          ReturnValues: options.returnValues ?? 'ALL_NEW',
        })),
        'Update'
      );

      return {
        success: true,
        data: response.Attributes,
        consumedCapacity: response.ConsumedCapacity ? {
          tableName: response.ConsumedCapacity.TableName!,
          capacityUnits: response.ConsumedCapacity.CapacityUnits ?? 0,
          readCapacityUnits: response.ConsumedCapacity.ReadCapacityUnits,
          writeCapacityUnits: response.ConsumedCapacity.WriteCapacityUnits,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an item
   */
  async deleteItem(
    tableName: string,
    key: Record<string, unknown>,
    options?: {
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
      returnValues?: 'NONE' | 'ALL_OLD';
    }
  ): Promise<DynamoDBOperationResult<Record<string, unknown> | undefined>> {
    try {
      const response = await this.withRetry(
        () => this.docClient.send(new DeleteCommand({
          TableName: tableName,
          Key: key,
          ConditionExpression: options?.conditionExpression,
          ExpressionAttributeNames: options?.expressionAttributeNames,
          ExpressionAttributeValues: options?.expressionAttributeValues,
          ReturnValues: options?.returnValues,
        })),
        'Delete'
      );

      return {
        success: true,
        data: response.Attributes,
        consumedCapacity: response.ConsumedCapacity ? {
          tableName: response.ConsumedCapacity.TableName!,
          capacityUnits: response.ConsumedCapacity.CapacityUnits ?? 0,
          readCapacityUnits: response.ConsumedCapacity.ReadCapacityUnits,
          writeCapacityUnits: response.ConsumedCapacity.WriteCapacityUnits,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Query items
   */
  async query<T = Record<string, unknown>>(
    tableName: string,
    options: QueryOptions
  ): Promise<DynamoDBOperationResult<{ items: T[]; lastEvaluatedKey?: Record<string, unknown>; count: number }>> {
    try {
      const response = await this.withRetry(
        () => this.docClient.send(new QueryCommand({
          TableName: tableName,
          IndexName: options.indexName,
          KeyConditionExpression: options.keyConditionExpression,
          ExpressionAttributeNames: options.expressionAttributeNames,
          ExpressionAttributeValues: options.expressionAttributeValues,
          FilterExpression: options.filterExpression,
          ProjectionExpression: options.projectionExpression,
          ScanIndexForward: options.scanIndexForward,
          Limit: options.limit,
          ConsistentRead: options.consistentRead,
          ExclusiveStartKey: options.exclusiveStartKey,
        })),
        'Query'
      );

      return {
        success: true,
        data: {
          items: (response.Items ?? []) as T[],
          lastEvaluatedKey: response.LastEvaluatedKey,
          count: response.Count ?? 0,
        },
        consumedCapacity: response.ConsumedCapacity ? {
          tableName: response.ConsumedCapacity.TableName!,
          capacityUnits: response.ConsumedCapacity.CapacityUnits ?? 0,
          readCapacityUnits: response.ConsumedCapacity.ReadCapacityUnits,
          writeCapacityUnits: response.ConsumedCapacity.WriteCapacityUnits,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Scan items
   */
  async scan<T = Record<string, unknown>>(
    tableName: string,
    options?: ScanOptions
  ): Promise<DynamoDBOperationResult<{ items: T[]; lastEvaluatedKey?: Record<string, unknown>; count: number }>> {
    try {
      const response = await this.withRetry(
        () => this.docClient.send(new ScanCommand({
          TableName: tableName,
          IndexName: options?.indexName,
          FilterExpression: options?.filterExpression,
          ExpressionAttributeNames: options?.expressionAttributeNames,
          ExpressionAttributeValues: options?.expressionAttributeValues,
          ProjectionExpression: options?.projectionExpression,
          Limit: options?.limit,
          ConsistentRead: options?.consistentRead,
          ExclusiveStartKey: options?.exclusiveStartKey,
          Segment: options?.segment,
          TotalSegments: options?.totalSegments,
        })),
        'Scan'
      );

      return {
        success: true,
        data: {
          items: (response.Items ?? []) as T[],
          lastEvaluatedKey: response.LastEvaluatedKey,
          count: response.Count ?? 0,
        },
        consumedCapacity: response.ConsumedCapacity ? {
          tableName: response.ConsumedCapacity.TableName!,
          capacityUnits: response.ConsumedCapacity.CapacityUnits ?? 0,
          readCapacityUnits: response.ConsumedCapacity.ReadCapacityUnits,
          writeCapacityUnits: response.ConsumedCapacity.WriteCapacityUnits,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Batch get items (up to 100 items)
   */
  async batchGetItems<T = Record<string, unknown>>(
    requests: { tableName: string; keys: Record<string, unknown>[] }[]
  ): Promise<DynamoDBOperationResult<Record<string, T[]>>> {
    try {
      const requestItems: Record<string, { Keys: Record<string, unknown>[] }> = {};
      
      for (const request of requests) {
        requestItems[request.tableName] = { Keys: request.keys };
      }

      const response = await this.withRetry(
        () => this.docClient.send(new BatchGetCommand({
          RequestItems: requestItems,
        })),
        'BatchGet'
      );

      return {
        success: true,
        data: (response.Responses ?? {}) as Record<string, T[]>,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Batch write items (up to 25 items)
   */
  async batchWriteItems(
    requests: {
      tableName: string;
      operations: (
        | { type: 'put'; item: Record<string, unknown> }
        | { type: 'delete'; key: Record<string, unknown> }
      )[];
    }[]
  ): Promise<DynamoDBOperationResult<{ unprocessedItems: Record<string, unknown[]> }>> {
    try {
      const requestItems: Record<string, { PutRequest?: { Item: Record<string, unknown> }; DeleteRequest?: { Key: Record<string, unknown> } }[]> = {};
      
      for (const request of requests) {
        requestItems[request.tableName] = request.operations.map(op => {
          if (op.type === 'put') {
            return { PutRequest: { Item: op.item } };
          } else {
            return { DeleteRequest: { Key: op.key } };
          }
        });
      }

      const response = await this.withRetry(
        () => this.docClient.send(new BatchWriteCommand({
          RequestItems: requestItems,
        })),
        'BatchWrite'
      );

      return {
        success: true,
        data: {
          unprocessedItems: response.UnprocessedItems ?? {},
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
   * Transaction get items (up to 100 items)
   */
  async transactGetItems<T = Record<string, unknown>>(
    requests: { tableName: string; key: Record<string, unknown>; projectionExpression?: string }[]
  ): Promise<DynamoDBOperationResult<(T | undefined)[]>> {
    try {
      const response = await this.withRetry(
        () => this.docClient.send(new TransactGetCommand({
          TransactItems: requests.map(req => ({
            Get: {
              TableName: req.tableName,
              Key: req.key,
              ProjectionExpression: req.projectionExpression,
            },
          })),
        })),
        'TransactGet'
      );

      return {
        success: true,
        data: (response.Responses ?? []).map(r => r.Item as T | undefined),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Transaction write items (up to 100 items)
   */
  async transactWriteItems(
    operations: (
      | {
          type: 'put';
          tableName: string;
          item: Record<string, unknown>;
          conditionExpression?: string;
          expressionAttributeNames?: Record<string, string>;
          expressionAttributeValues?: Record<string, unknown>;
        }
      | {
          type: 'update';
          tableName: string;
          key: Record<string, unknown>;
          updateExpression: string;
          conditionExpression?: string;
          expressionAttributeNames?: Record<string, string>;
          expressionAttributeValues?: Record<string, unknown>;
        }
      | {
          type: 'delete';
          tableName: string;
          key: Record<string, unknown>;
          conditionExpression?: string;
          expressionAttributeNames?: Record<string, string>;
          expressionAttributeValues?: Record<string, unknown>;
        }
      | {
          type: 'conditionCheck';
          tableName: string;
          key: Record<string, unknown>;
          conditionExpression: string;
          expressionAttributeNames?: Record<string, string>;
          expressionAttributeValues?: Record<string, unknown>;
        }
    )[],
    clientRequestToken?: string
  ): Promise<DynamoDBOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.docClient.send(new TransactWriteCommand({
          TransactItems: operations.map(op => {
            switch (op.type) {
              case 'put':
                return {
                  Put: {
                    TableName: op.tableName,
                    Item: op.item,
                    ConditionExpression: op.conditionExpression,
                    ExpressionAttributeNames: op.expressionAttributeNames,
                    ExpressionAttributeValues: op.expressionAttributeValues,
                  },
                };
              case 'update':
                return {
                  Update: {
                    TableName: op.tableName,
                    Key: op.key,
                    UpdateExpression: op.updateExpression,
                    ConditionExpression: op.conditionExpression,
                    ExpressionAttributeNames: op.expressionAttributeNames,
                    ExpressionAttributeValues: op.expressionAttributeValues,
                  },
                };
              case 'delete':
                return {
                  Delete: {
                    TableName: op.tableName,
                    Key: op.key,
                    ConditionExpression: op.conditionExpression,
                    ExpressionAttributeNames: op.expressionAttributeNames,
                    ExpressionAttributeValues: op.expressionAttributeValues,
                  },
                };
              case 'conditionCheck':
                return {
                  ConditionCheck: {
                    TableName: op.tableName,
                    Key: op.key,
                    ConditionExpression: op.conditionExpression,
                    ExpressionAttributeNames: op.expressionAttributeNames,
                    ExpressionAttributeValues: op.expressionAttributeValues,
                  },
                };
            }
          }),
          ClientRequestToken: clientRequestToken,
        })),
        'TransactWrite'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Tagging Operations
  // ==========================================================================

  /**
   * Add tags to a table
   */
  async tagTable(tableName: string, tags: Record<string, string>): Promise<DynamoDBOperationResult<void>> {
    try {
      const tableResponse = await this.withRetry(
        () => this.client.send(new DescribeTableCommand({
          TableName: tableName,
        })),
        'DescribeTable'
      );

      await this.withRetry(
        () => this.client.send(new TagResourceCommand({
          ResourceArn: tableResponse.Table!.TableArn,
          Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
        })),
        'TagResource'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Remove tags from a table
   */
  async untagTable(tableName: string, tagKeys: string[]): Promise<DynamoDBOperationResult<void>> {
    try {
      const tableResponse = await this.withRetry(
        () => this.client.send(new DescribeTableCommand({
          TableName: tableName,
        })),
        'DescribeTable'
      );

      await this.withRetry(
        () => this.client.send(new UntagResourceCommand({
          ResourceArn: tableResponse.Table!.TableArn,
          TagKeys: tagKeys,
        })),
        'UntagResource'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List tags for a table
   */
  async listTableTags(tableName: string): Promise<DynamoDBOperationResult<Record<string, string>>> {
    try {
      const tableResponse = await this.withRetry(
        () => this.client.send(new DescribeTableCommand({
          TableName: tableName,
        })),
        'DescribeTable'
      );

      const tagsResponse = await this.withRetry(
        () => this.client.send(new ListTagsOfResourceCommand({
          ResourceArn: tableResponse.Table!.TableArn,
        })),
        'ListTagsOfResource'
      );

      const tags: Record<string, string> = {};
      for (const tag of tagsResponse.Tags ?? []) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }

      return {
        success: true,
        data: tags,
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

  /**
   * Wait for table to become active
   */
  async waitForTableActive(tableName: string, timeoutMs: number = 300000): Promise<DynamoDBOperationResult<void>> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const result = await this.describeTable(tableName);
      
      if (!result.success) {
        return { success: false, error: result.error };
      }
      
      if (result.data?.tableStatus === 'ACTIVE') {
        return { success: true };
      }
      
      // Wait 5 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    return {
      success: false,
      error: `Timeout waiting for table ${tableName} to become active`,
    };
  }

  /**
   * Get estimated table cost (per month)
   */
  async estimateTableCost(tableName: string): Promise<DynamoDBOperationResult<{
    storageCostUsd: number;
    readCostUsd: number;
    writeCostUsd: number;
    totalCostUsd: number;
  }>> {
    try {
      const tableResult = await this.describeTable(tableName);
      
      if (!tableResult.success || !tableResult.data) {
        return { success: false, error: tableResult.error ?? 'Failed to describe table' };
      }

      const table = tableResult.data;
      
      // Storage cost: $0.25 per GB-month
      const storageCostUsd = (table.tableSizeBytes / (1024 * 1024 * 1024)) * 0.25;
      
      let readCostUsd = 0;
      let writeCostUsd = 0;
      
      if (table.billingMode === 'PROVISIONED') {
        // Provisioned: $0.00065 per RCU-hour, $0.00065 per WCU-hour
        const hoursPerMonth = 730;
        readCostUsd = (table.provisionedReadCapacity ?? 0) * 0.00065 * hoursPerMonth;
        writeCostUsd = (table.provisionedWriteCapacity ?? 0) * 0.00065 * hoursPerMonth;
      }
      // On-demand pricing would require actual usage data from CloudWatch

      return {
        success: true,
        data: {
          storageCostUsd,
          readCostUsd,
          writeCostUsd,
          totalCostUsd: storageCostUsd + readCostUsd + writeCostUsd,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createDynamoDBManager(config?: DynamoDBManagerConfig): DynamoDBManager {
  return new DynamoDBManager(config);
}

// ============================================================================
// Tool Definitions for Agent Integration
// ============================================================================

export const dynamoDBToolDefinitions = {
  dynamodb_create_table: {
    name: 'dynamodb_create_table',
    description: 'Create a new DynamoDB table with specified schema, indexes, and settings',
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Name of the table to create' },
        partitionKey: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['S', 'N', 'B'] },
          },
          required: ['name', 'type'],
        },
        sortKey: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['S', 'N', 'B'] },
          },
        },
        billingMode: { type: 'string', enum: ['PAY_PER_REQUEST', 'PROVISIONED'] },
        encryption: { type: 'boolean', description: 'Enable encryption at rest' },
        pointInTimeRecovery: { type: 'boolean', description: 'Enable PITR backups' },
        deletionProtection: { type: 'boolean', description: 'Prevent accidental deletion' },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['tableName', 'partitionKey'],
    },
  },
  dynamodb_describe_table: {
    name: 'dynamodb_describe_table',
    description: 'Get detailed information about a DynamoDB table',
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Name of the table to describe' },
      },
      required: ['tableName'],
    },
  },
  dynamodb_list_tables: {
    name: 'dynamodb_list_tables',
    description: 'List all DynamoDB tables in the account',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of tables to return' },
      },
    },
  },
  dynamodb_query: {
    name: 'dynamodb_query',
    description: 'Query items from a DynamoDB table using key conditions',
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Name of the table to query' },
        keyConditionExpression: { type: 'string', description: 'Key condition expression (e.g., "pk = :pk")' },
        expressionAttributeValues: { type: 'object', description: 'Values for expression placeholders' },
        limit: { type: 'number', description: 'Maximum number of items to return' },
        indexName: { type: 'string', description: 'Name of secondary index to query' },
      },
      required: ['tableName', 'keyConditionExpression'],
    },
  },
  dynamodb_put_item: {
    name: 'dynamodb_put_item',
    description: 'Put (create or replace) an item in a DynamoDB table',
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Name of the table' },
        item: { type: 'object', description: 'The item to put' },
      },
      required: ['tableName', 'item'],
    },
  },
  dynamodb_delete_item: {
    name: 'dynamodb_delete_item',
    description: 'Delete an item from a DynamoDB table',
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Name of the table' },
        key: { type: 'object', description: 'The key of the item to delete' },
      },
      required: ['tableName', 'key'],
    },
  },
  dynamodb_create_backup: {
    name: 'dynamodb_create_backup',
    description: 'Create an on-demand backup of a DynamoDB table',
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Name of the table to backup' },
        backupName: { type: 'string', description: 'Name for the backup' },
      },
      required: ['tableName', 'backupName'],
    },
  },
  dynamodb_configure_autoscaling: {
    name: 'dynamodb_configure_autoscaling',
    description: 'Configure auto scaling for a provisioned capacity DynamoDB table',
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Name of the table' },
        minReadCapacity: { type: 'number', description: 'Minimum read capacity units' },
        maxReadCapacity: { type: 'number', description: 'Maximum read capacity units' },
        minWriteCapacity: { type: 'number', description: 'Minimum write capacity units' },
        maxWriteCapacity: { type: 'number', description: 'Maximum write capacity units' },
        targetUtilization: { type: 'number', description: 'Target utilization percentage (default 70)' },
      },
      required: ['tableName', 'minReadCapacity', 'maxReadCapacity', 'minWriteCapacity', 'maxWriteCapacity'],
    },
  },
};
