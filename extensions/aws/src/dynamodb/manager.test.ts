/**
 * DynamoDB Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBManager, createDynamoDBManager } from './manager.js';

// Mock DynamoDB Client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: mockSend })),
  CreateTableCommand: vi.fn((input) => ({ input, _type: 'CreateTableCommand' })),
  DeleteTableCommand: vi.fn((input) => ({ input, _type: 'DeleteTableCommand' })),
  DescribeTableCommand: vi.fn((input) => ({ input, _type: 'DescribeTableCommand' })),
  UpdateTableCommand: vi.fn((input) => ({ input, _type: 'UpdateTableCommand' })),
  ListTablesCommand: vi.fn((input) => ({ input, _type: 'ListTablesCommand' })),
  UpdateTimeToLiveCommand: vi.fn((input) => ({ input, _type: 'UpdateTimeToLiveCommand' })),
  DescribeTimeToLiveCommand: vi.fn((input) => ({ input, _type: 'DescribeTimeToLiveCommand' })),
  CreateBackupCommand: vi.fn((input) => ({ input, _type: 'CreateBackupCommand' })),
  DeleteBackupCommand: vi.fn((input) => ({ input, _type: 'DeleteBackupCommand' })),
  ListBackupsCommand: vi.fn((input) => ({ input, _type: 'ListBackupsCommand' })),
  RestoreTableFromBackupCommand: vi.fn((input) => ({ input, _type: 'RestoreTableFromBackupCommand' })),
  DescribeContinuousBackupsCommand: vi.fn((input) => ({ input, _type: 'DescribeContinuousBackupsCommand' })),
  UpdateContinuousBackupsCommand: vi.fn((input) => ({ input, _type: 'UpdateContinuousBackupsCommand' })),
  CreateGlobalTableCommand: vi.fn((input) => ({ input, _type: 'CreateGlobalTableCommand' })),
  DescribeGlobalTableCommand: vi.fn((input) => ({ input, _type: 'DescribeGlobalTableCommand' })),
  UpdateGlobalTableCommand: vi.fn((input) => ({ input, _type: 'UpdateGlobalTableCommand' })),
  ListGlobalTablesCommand: vi.fn((input) => ({ input, _type: 'ListGlobalTablesCommand' })),
  DescribeTableReplicaAutoScalingCommand: vi.fn((input) => ({ input, _type: 'DescribeTableReplicaAutoScalingCommand' })),
  UpdateTableReplicaAutoScalingCommand: vi.fn((input) => ({ input, _type: 'UpdateTableReplicaAutoScalingCommand' })),
  TagResourceCommand: vi.fn((input) => ({ input, _type: 'TagResourceCommand' })),
  UntagResourceCommand: vi.fn((input) => ({ input, _type: 'UntagResourceCommand' })),
  ListTagsOfResourceCommand: vi.fn((input) => ({ input, _type: 'ListTagsOfResourceCommand' })),
  DescribeKinesisStreamingDestinationCommand: vi.fn((input) => ({ input, _type: 'DescribeKinesisStreamingDestinationCommand' })),
  EnableKinesisStreamingDestinationCommand: vi.fn((input) => ({ input, _type: 'EnableKinesisStreamingDestinationCommand' })),
  DisableKinesisStreamingDestinationCommand: vi.fn((input) => ({ input, _type: 'DisableKinesisStreamingDestinationCommand' })),
  ExportTableToPointInTimeCommand: vi.fn((input) => ({ input, _type: 'ExportTableToPointInTimeCommand' })),
  DescribeExportCommand: vi.fn((input) => ({ input, _type: 'DescribeExportCommand' })),
  ListExportsCommand: vi.fn((input) => ({ input, _type: 'ListExportsCommand' })),
  ImportTableCommand: vi.fn((input) => ({ input, _type: 'ImportTableCommand' })),
  DescribeImportCommand: vi.fn((input) => ({ input, _type: 'DescribeImportCommand' })),
  ListImportsCommand: vi.fn((input) => ({ input, _type: 'ListImportsCommand' })),
}));

// Mock DynamoDB Document Client
const mockDocSend = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDocSend })),
  },
  GetCommand: vi.fn((input) => ({ input, _type: 'GetCommand' })),
  PutCommand: vi.fn((input) => ({ input, _type: 'PutCommand' })),
  UpdateCommand: vi.fn((input) => ({ input, _type: 'UpdateCommand' })),
  DeleteCommand: vi.fn((input) => ({ input, _type: 'DeleteCommand' })),
  QueryCommand: vi.fn((input) => ({ input, _type: 'QueryCommand' })),
  ScanCommand: vi.fn((input) => ({ input, _type: 'ScanCommand' })),
  BatchGetCommand: vi.fn((input) => ({ input, _type: 'BatchGetCommand' })),
  BatchWriteCommand: vi.fn((input) => ({ input, _type: 'BatchWriteCommand' })),
  TransactGetCommand: vi.fn((input) => ({ input, _type: 'TransactGetCommand' })),
  TransactWriteCommand: vi.fn((input) => ({ input, _type: 'TransactWriteCommand' })),
}));

// Mock Auto Scaling Client
const mockAutoScalingSend = vi.fn();
vi.mock('@aws-sdk/client-application-auto-scaling', () => ({
  ApplicationAutoScalingClient: vi.fn(() => ({ send: mockAutoScalingSend })),
  RegisterScalableTargetCommand: vi.fn((input) => ({ input, _type: 'RegisterScalableTargetCommand' })),
  DeregisterScalableTargetCommand: vi.fn((input) => ({ input, _type: 'DeregisterScalableTargetCommand' })),
  PutScalingPolicyCommand: vi.fn((input) => ({ input, _type: 'PutScalingPolicyCommand' })),
  DeleteScalingPolicyCommand: vi.fn((input) => ({ input, _type: 'DeleteScalingPolicyCommand' })),
  DescribeScalableTargetsCommand: vi.fn((input) => ({ input, _type: 'DescribeScalableTargetsCommand' })),
  DescribeScalingPoliciesCommand: vi.fn((input) => ({ input, _type: 'DescribeScalingPoliciesCommand' })),
}));

describe('DynamoDBManager', () => {
  let manager: DynamoDBManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DynamoDBManager({ region: 'us-east-1' });
  });

  describe('createDynamoDBManager', () => {
    it('should create a DynamoDBManager instance', () => {
      const instance = createDynamoDBManager({ region: 'us-west-2' });
      expect(instance).toBeInstanceOf(DynamoDBManager);
    });

    it('should create with default config', () => {
      const instance = createDynamoDBManager();
      expect(instance).toBeInstanceOf(DynamoDBManager);
    });
  });

  // ===========================================================================
  // Table Operations
  // ===========================================================================

  describe('Table Operations', () => {
    describe('describeTable', () => {
      it('should describe a table successfully', async () => {
        mockSend
          .mockResolvedValueOnce({
            Table: {
              TableName: 'test-table',
              TableStatus: 'ACTIVE',
              KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
              AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
              ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
              TableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-table',
              ItemCount: 100,
              TableSizeBytes: 5000,
              CreationDateTime: new Date(),
            },
          })
          .mockResolvedValueOnce({ TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } })
          .mockResolvedValueOnce({ ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'DISABLED' } } });

        const result = await manager.describeTable('test-table');
        expect(result.success).toBe(true);
        expect(result.data?.tableName).toBe('test-table');
        expect(result.data?.tableStatus).toBe('ACTIVE');
      });

      it('should handle errors gracefully', async () => {
        mockSend.mockRejectedValueOnce(new Error('Table not found'));

        const result = await manager.describeTable('nonexistent');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Table not found');
      });
    });

    describe('createTable', () => {
      it('should create a table successfully', async () => {
        mockSend.mockResolvedValueOnce({
          TableDescription: {
            TableName: 'new-table',
            TableStatus: 'CREATING',
            TableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/new-table',
          },
        });

        const result = await manager.createTable({
          tableName: 'new-table',
          partitionKey: { name: 'id', type: 'S' },
        });
        expect(result.success).toBe(true);
      });

      it('should handle creation failure', async () => {
        mockSend.mockRejectedValueOnce(new Error('Table already exists'));

        const result = await manager.createTable({
          tableName: 'existing-table',
          partitionKey: { name: 'id', type: 'S' },
        });
        expect(result.success).toBe(false);
      });
    });

    describe('deleteTable', () => {
      it('should delete a table successfully', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteTable('test-table');
        expect(result.success).toBe(true);
      });

      it('should handle delete errors', async () => {
        mockSend.mockRejectedValueOnce(new Error('ResourceInUseException'));

        const result = await manager.deleteTable('active-table');
        expect(result.success).toBe(false);
      });
    });

    describe('listTables', () => {
      it('should list tables', async () => {
        mockSend.mockResolvedValueOnce({
          TableNames: ['table-1', 'table-2', 'table-3'],
        });

        const result = await manager.listTables();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(3);
        expect(result.data).toContain('table-1');
      });

      it('should handle empty table list', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] });

        const result = await manager.listTables();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });

    describe('updateTable', () => {
      it('should update table throughput', async () => {
        mockSend.mockResolvedValueOnce({
          TableDescription: { TableName: 'test-table', TableStatus: 'UPDATING' },
        });

        const result = await manager.updateTable('test-table', {
          provisionedThroughput: { readCapacityUnits: 10, writeCapacityUnits: 10 },
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // TTL Operations
  // ===========================================================================

  describe('TTL Operations', () => {
    describe('enableTTL', () => {
      it('should enable TTL on a table', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.enableTTL('test-table', 'expiresAt');
        expect(result.success).toBe(true);
      });
    });

    describe('disableTTL', () => {
      it('should disable TTL on a table', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.disableTTL('test-table', 'expiresAt');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Backup Operations
  // ===========================================================================

  describe('Backup Operations', () => {
    describe('enablePointInTimeRecovery', () => {
      it('should enable PITR', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.enablePointInTimeRecovery('test-table');
        expect(result.success).toBe(true);
      });
    });

    describe('createBackup', () => {
      it('should create a backup', async () => {
        mockSend.mockResolvedValueOnce({
          BackupDetails: {
            BackupArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-table/backup/01234567890',
          },
        });

        const result = await manager.createBackup({
          tableName: 'test-table',
          backupName: 'test-backup',
        });
        expect(result.success).toBe(true);
        expect(result.data?.backupArn).toBeDefined();
      });
    });

    describe('deleteBackup', () => {
      it('should delete a backup', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteBackup('arn:aws:dynamodb:us-east-1:123456789012:table/test-table/backup/01234567890');
        expect(result.success).toBe(true);
      });
    });

    describe('listBackups', () => {
      it('should list backups', async () => {
        mockSend.mockResolvedValueOnce({
          BackupSummaries: [
            { BackupName: 'backup-1', BackupArn: 'arn:1', BackupStatus: 'AVAILABLE' },
            { BackupName: 'backup-2', BackupArn: 'arn:2', BackupStatus: 'AVAILABLE' },
          ],
        });

        const result = await manager.listBackups('test-table');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });
  });

  // ===========================================================================
  // Item Operations (Document Client)
  // ===========================================================================

  describe('Item Operations', () => {
    describe('getItem', () => {
      it('should get an item', async () => {
        mockDocSend.mockResolvedValueOnce({
          Item: { id: '123', name: 'Test Item', createdAt: '2024-01-01' },
        });

        const result = await manager.getItem('test-table', { id: '123' });
        expect(result.success).toBe(true);
        expect(result.data?.id).toBe('123');
      });

      it('should handle missing item', async () => {
        mockDocSend.mockResolvedValueOnce({ Item: undefined });

        const result = await manager.getItem('test-table', { id: 'nonexistent' });
        expect(result.success).toBe(true);
        expect(result.data).toBeUndefined();
      });
    });

    describe('putItem', () => {
      it('should put an item', async () => {
        mockDocSend.mockResolvedValueOnce({});

        const result = await manager.putItem('test-table', { id: '123', name: 'New Item' });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteItem', () => {
      it('should delete an item', async () => {
        mockDocSend.mockResolvedValueOnce({});

        const result = await manager.deleteItem('test-table', { id: '123' });
        expect(result.success).toBe(true);
      });
    });

    describe('query', () => {
      it('should query items', async () => {
        mockDocSend.mockResolvedValueOnce({
          Items: [
            { id: '1', name: 'Item 1' },
            { id: '2', name: 'Item 2' },
          ],
          Count: 2,
          ScannedCount: 2,
        });

        const result = await manager.query('test-table', {
          keyConditionExpression: 'id = :id',
          expressionAttributeValues: { ':id': '1' },
        });
        expect(result.success).toBe(true);
        expect(result.data?.items).toHaveLength(2);
      });
    });

    describe('scan', () => {
      it('should scan items', async () => {
        mockDocSend.mockResolvedValueOnce({
          Items: [
            { id: '1', name: 'Item 1' },
            { id: '2', name: 'Item 2' },
            { id: '3', name: 'Item 3' },
          ],
          Count: 3,
          ScannedCount: 100,
        });

        const result = await manager.scan('test-table');
        expect(result.success).toBe(true);
        expect(result.data?.items).toHaveLength(3);
      });
    });

    describe('batchGetItems', () => {
      it('should batch get items', async () => {
        mockDocSend.mockResolvedValueOnce({
          Responses: {
            'test-table': [
              { id: '1', name: 'Item 1' },
              { id: '2', name: 'Item 2' },
            ],
          },
        });

        const result = await manager.batchGetItems([{ tableName: 'test-table', keys: [{ id: '1' }, { id: '2' }] }]);
        expect(result.success).toBe(true);
        expect(result.data?.['test-table']).toHaveLength(2);
      });
    });
  });

  // ===========================================================================
  // Tagging Operations
  // ===========================================================================

  describe('Tagging Operations', () => {
    describe('tagTable', () => {
      it('should tag a table', async () => {
        // describeTable to get ARN, then tagResource
        mockSend
          .mockResolvedValueOnce({
            Table: { TableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-table' },
          })
          .mockResolvedValueOnce({});

        const result = await manager.tagTable('test-table', { env: 'production' });
        expect(result.success).toBe(true);
      });
    });

    describe('listTableTags', () => {
      it('should list table tags', async () => {
        mockSend
          .mockResolvedValueOnce({
            Table: { TableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-table' },
          })
          .mockResolvedValueOnce({
            Tags: [
              { Key: 'env', Value: 'production' },
              { Key: 'team', Value: 'platform' },
            ],
          });

        const result = await manager.listTableTags('test-table');
        expect(result.success).toBe(true);
        expect(result.data?.env).toBe('production');
      });
    });
  });

  // ===========================================================================
  // Global Table Operations
  // ===========================================================================

  describe('Global Table Operations', () => {
    describe('createGlobalTable', () => {
      it('should create a global table', async () => {
        mockSend.mockResolvedValueOnce({
          GlobalTableDescription: {
            GlobalTableName: 'global-table',
            GlobalTableArn: 'arn:aws:dynamodb::123456789012:global-table/global-table',
            ReplicationGroup: [
              { RegionName: 'us-east-1' },
              { RegionName: 'eu-west-1' },
            ],
          },
        });

        const result = await manager.createGlobalTable({
          tableName: 'global-table',
          replicaRegions: ['us-east-1', 'eu-west-1'],
        });
        expect(result.success).toBe(true);
      });
    });

    describe('listGlobalTables', () => {
      it('should list global tables', async () => {
        mockSend
          .mockResolvedValueOnce({
            GlobalTables: [
              { GlobalTableName: 'global-1', ReplicationGroup: [{ RegionName: 'us-east-1' }] },
            ],
          })
          .mockResolvedValueOnce({
            GlobalTableDescription: {
              GlobalTableName: 'global-1',
              ReplicationGroup: [{ RegionName: 'us-east-1' }],
            },
          });

        const result = await manager.listGlobalTables();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });
  });

  // ===========================================================================
  // Auto Scaling
  // ===========================================================================

  describe('Auto Scaling', () => {
    describe('configureAutoScaling', () => {
      it('should configure auto scaling', async () => {
        mockAutoScalingSend.mockResolvedValue({});

        const result = await manager.configureAutoScaling({
          tableName: 'test-table',
          minReadCapacity: 5,
          maxReadCapacity: 100,
          minWriteCapacity: 5,
          maxWriteCapacity: 100,
          targetReadUtilization: 70,
          targetWriteUtilization: 70,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('removeAutoScaling', () => {
      it('should remove auto scaling', async () => {
        mockAutoScalingSend.mockResolvedValue({});

        const result = await manager.removeAutoScaling('test-table');
        expect(result.success).toBe(true);
      });
    });
  });
});
