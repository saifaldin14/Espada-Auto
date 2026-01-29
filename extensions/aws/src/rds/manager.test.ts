/**
 * AWS RDS Manager Tests
 * Comprehensive test suite for RDS operations
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { RDSManager, createRDSManager } from './manager.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-rds', () => {
  const mockSend = vi.fn();
  return {
    RDSClient: vi.fn(() => ({ send: mockSend })),
    CreateDBInstanceCommand: vi.fn(),
    DeleteDBInstanceCommand: vi.fn(),
    DescribeDBInstancesCommand: vi.fn(),
    ModifyDBInstanceCommand: vi.fn(),
    RebootDBInstanceCommand: vi.fn(),
    StartDBInstanceCommand: vi.fn(),
    StopDBInstanceCommand: vi.fn(),
    CreateDBSnapshotCommand: vi.fn(),
    DeleteDBSnapshotCommand: vi.fn(),
    DescribeDBSnapshotsCommand: vi.fn(),
    RestoreDBInstanceFromDBSnapshotCommand: vi.fn(),
    CopyDBSnapshotCommand: vi.fn(),
    CreateDBParameterGroupCommand: vi.fn(),
    DeleteDBParameterGroupCommand: vi.fn(),
    DescribeDBParameterGroupsCommand: vi.fn(),
    DescribeDBParametersCommand: vi.fn(),
    ModifyDBParameterGroupCommand: vi.fn(),
    ResetDBParameterGroupCommand: vi.fn(),
    CreateDBSubnetGroupCommand: vi.fn(),
    DeleteDBSubnetGroupCommand: vi.fn(),
    DescribeDBSubnetGroupsCommand: vi.fn(),
    ModifyDBSubnetGroupCommand: vi.fn(),
    CreateDBInstanceReadReplicaCommand: vi.fn(),
    PromoteReadReplicaCommand: vi.fn(),
    DescribeEventsCommand: vi.fn(),
    DescribeEventCategoriesCommand: vi.fn(),
    CreateEventSubscriptionCommand: vi.fn(),
    DeleteEventSubscriptionCommand: vi.fn(),
    DescribeEventSubscriptionsCommand: vi.fn(),
    DescribeDBLogFilesCommand: vi.fn(),
    DownloadDBLogFilePortionCommand: vi.fn(),
    DescribeOrderableDBInstanceOptionsCommand: vi.fn(),
    DescribeDBEngineVersionsCommand: vi.fn(),
    DescribePendingMaintenanceActionsCommand: vi.fn(),
    ApplyPendingMaintenanceActionCommand: vi.fn(),
    RestoreDBInstanceToPointInTimeCommand: vi.fn(),
    DescribeDBInstanceAutomatedBackupsCommand: vi.fn(),
    DeleteDBInstanceAutomatedBackupCommand: vi.fn(),
    StartDBInstanceAutomatedBackupsReplicationCommand: vi.fn(),
    StopDBInstanceAutomatedBackupsReplicationCommand: vi.fn(),
    FailoverDBClusterCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-cloudwatch', () => {
  const mockSend = vi.fn();
  return {
    CloudWatchClient: vi.fn(() => ({ send: mockSend })),
    GetMetricStatisticsCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-pi', () => {
  const mockSend = vi.fn();
  return {
    PIClient: vi.fn(() => ({ send: mockSend })),
    GetResourceMetricsCommand: vi.fn(),
    DescribeDimensionKeysCommand: vi.fn(),
  };
});

// Get mock functions
import { RDSClient } from '@aws-sdk/client-rds';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { PIClient } from '@aws-sdk/client-pi';

describe('RDSManager', () => {
  let manager: RDSManager;
  let mockRDSSend: Mock;
  let mockCloudWatchSend: Mock;
  let mockPISend: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new RDSManager({ region: 'us-east-1' });
    
    // Get mock send functions
    mockRDSSend = vi.fn();
    mockCloudWatchSend = vi.fn();
    mockPISend = vi.fn();
    
    (RDSClient as Mock).mockImplementation(() => ({ send: mockRDSSend }));
    (CloudWatchClient as Mock).mockImplementation(() => ({ send: mockCloudWatchSend }));
    (PIClient as Mock).mockImplementation(() => ({ send: mockPISend }));
  });

  describe('createRDSManager', () => {
    it('should create a manager instance', () => {
      const manager = createRDSManager();
      expect(manager).toBeInstanceOf(RDSManager);
    });

    it('should create a manager with config', () => {
      const manager = createRDSManager({ region: 'eu-west-1' });
      expect(manager).toBeInstanceOf(RDSManager);
    });
  });

  // ==========================================================================
  // 1. RDS Instance Creation and Configuration Tests
  // ==========================================================================

  describe('Instance Operations', () => {
    describe('listInstances', () => {
      it('should list all instances', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'test-db-1',
              DBInstanceClass: 'db.t3.micro',
              Engine: 'mysql',
              EngineVersion: '8.0.32',
              DBInstanceStatus: 'available',
              AllocatedStorage: 20,
              StorageType: 'gp2',
              MultiAZ: false,
              PubliclyAccessible: false,
              MasterUsername: 'admin',
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db-1',
            },
          ],
        });

        const instances = await manager.listInstances();

        expect(instances).toHaveLength(1);
        expect(instances[0].dbInstanceIdentifier).toBe('test-db-1');
        expect(instances[0].engine).toBe('mysql');
      });

      it('should filter instances by identifier', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'specific-db',
              DBInstanceClass: 'db.t3.small',
              Engine: 'postgres',
              EngineVersion: '14.6',
              DBInstanceStatus: 'available',
              AllocatedStorage: 50,
              StorageType: 'gp3',
              MultiAZ: true,
              PubliclyAccessible: false,
              MasterUsername: 'postgres',
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:specific-db',
            },
          ],
        });

        const instances = await manager.listInstances({
          dbInstanceIdentifier: 'specific-db',
        });

        expect(instances).toHaveLength(1);
        expect(instances[0].dbInstanceIdentifier).toBe('specific-db');
      });

      it('should handle pagination', async () => {
        mockRDSSend
          .mockResolvedValueOnce({
            DBInstances: [
              {
                DBInstanceIdentifier: 'db-1',
                DBInstanceClass: 'db.t3.micro',
                Engine: 'mysql',
                DBInstanceStatus: 'available',
                AllocatedStorage: 20,
                DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:db-1',
              },
            ],
            Marker: 'next-page',
          })
          .mockResolvedValueOnce({
            DBInstances: [
              {
                DBInstanceIdentifier: 'db-2',
                DBInstanceClass: 'db.t3.micro',
                Engine: 'mysql',
                DBInstanceStatus: 'available',
                AllocatedStorage: 20,
                DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:db-2',
              },
            ],
          });

        const instances = await manager.listInstances();

        expect(instances).toHaveLength(2);
        expect(mockRDSSend).toHaveBeenCalledTimes(2);
      });
    });

    describe('getInstance', () => {
      it('should get a specific instance', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'my-db',
              DBInstanceClass: 'db.r5.large',
              Engine: 'postgres',
              EngineVersion: '14.6',
              DBInstanceStatus: 'available',
              Endpoint: {
                Address: 'my-db.123456789012.us-east-1.rds.amazonaws.com',
                Port: 5432,
              },
              AllocatedStorage: 100,
              StorageType: 'gp3',
              MultiAZ: true,
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
            },
          ],
        });

        const instance = await manager.getInstance('my-db');

        expect(instance).not.toBeNull();
        expect(instance?.dbInstanceIdentifier).toBe('my-db');
        expect(instance?.endpoint?.address).toBe('my-db.123456789012.us-east-1.rds.amazonaws.com');
      });

      it('should return null for non-existent instance', async () => {
        mockRDSSend.mockResolvedValueOnce({ DBInstances: [] });

        const instance = await manager.getInstance('non-existent');

        expect(instance).toBeNull();
      });
    });

    describe('createInstance', () => {
      it('should create a new instance', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'new-db',
            DBInstanceClass: 'db.t3.medium',
            Engine: 'mysql',
            DBInstanceStatus: 'creating',
            AllocatedStorage: 50,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:new-db',
          },
        });

        const result = await manager.createInstance({
          dbInstanceIdentifier: 'new-db',
          dbInstanceClass: 'db.t3.medium',
          engine: 'mysql',
          masterUsername: 'admin',
          masterUserPassword: 'password123',
          allocatedStorage: 50,
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('new-db');
        expect(result.data).toBeDefined();
      });

      it('should handle creation errors', async () => {
        mockRDSSend.mockRejectedValueOnce(new Error('DBInstanceAlreadyExists'));

        const result = await manager.createInstance({
          dbInstanceIdentifier: 'existing-db',
          dbInstanceClass: 'db.t3.medium',
          engine: 'mysql',
          masterUsername: 'admin',
          masterUserPassword: 'password123',
          allocatedStorage: 50,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('DBInstanceAlreadyExists');
      });
    });

    describe('modifyInstance', () => {
      it('should modify an instance', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            DBInstanceClass: 'db.r5.xlarge',
            Engine: 'postgres',
            DBInstanceStatus: 'modifying',
            AllocatedStorage: 200,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.modifyInstance({
          dbInstanceIdentifier: 'my-db',
          dbInstanceClass: 'db.r5.xlarge',
          allocatedStorage: 200,
          applyImmediately: true,
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('applied');
      });

      it('should schedule modifications when not applying immediately', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            DBInstanceStatus: 'available',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.modifyInstance({
          dbInstanceIdentifier: 'my-db',
          allocatedStorage: 300,
          applyImmediately: false,
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('scheduled');
      });
    });

    describe('deleteInstance', () => {
      it('should delete an instance with final snapshot', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'delete-me',
            DBInstanceStatus: 'deleting',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:delete-me',
          },
        });

        const result = await manager.deleteInstance('delete-me', {
          finalDBSnapshotIdentifier: 'delete-me-final-snapshot',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('deletion initiated');
      });

      it('should delete without final snapshot', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'delete-me',
            DBInstanceStatus: 'deleting',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:delete-me',
          },
        });

        const result = await manager.deleteInstance('delete-me', {
          skipFinalSnapshot: true,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('startInstance', () => {
      it('should start a stopped instance', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'stopped-db',
            DBInstanceStatus: 'starting',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:stopped-db',
          },
        });

        const result = await manager.startInstance('stopped-db');

        expect(result.success).toBe(true);
        expect(result.message).toContain('start initiated');
      });
    });

    describe('stopInstance', () => {
      it('should stop a running instance', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'running-db',
            DBInstanceStatus: 'stopping',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:running-db',
          },
        });

        const result = await manager.stopInstance('running-db');

        expect(result.success).toBe(true);
        expect(result.message).toContain('stop initiated');
      });

      it('should stop with snapshot', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'running-db',
            DBInstanceStatus: 'stopping',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:running-db',
          },
        });

        const result = await manager.stopInstance('running-db', {
          dbSnapshotIdentifier: 'stop-snapshot',
        });

        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // 2. RDS Snapshot Tests
  // ==========================================================================

  describe('Snapshot Operations', () => {
    describe('listSnapshots', () => {
      it('should list snapshots', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSnapshots: [
            {
              DBSnapshotIdentifier: 'snapshot-1',
              DBInstanceIdentifier: 'my-db',
              Engine: 'mysql',
              EngineVersion: '8.0.32',
              Status: 'available',
              AllocatedStorage: 100,
              SnapshotType: 'manual',
              DBSnapshotArn: 'arn:aws:rds:us-east-1:123456789012:snapshot:snapshot-1',
            },
          ],
        });

        const snapshots = await manager.listSnapshots();

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].dbSnapshotIdentifier).toBe('snapshot-1');
      });

      it('should filter snapshots by type', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSnapshots: [
            {
              DBSnapshotIdentifier: 'auto-snapshot',
              DBInstanceIdentifier: 'my-db',
              Engine: 'mysql',
              Status: 'available',
              SnapshotType: 'automated',
              DBSnapshotArn: 'arn:aws:rds:us-east-1:123456789012:snapshot:auto-snapshot',
            },
          ],
        });

        const snapshots = await manager.listSnapshots({
          snapshotType: 'automated',
        });

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].snapshotType).toBe('automated');
      });
    });

    describe('createSnapshot', () => {
      it('should create a manual snapshot', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSnapshot: {
            DBSnapshotIdentifier: 'my-snapshot',
            DBInstanceIdentifier: 'my-db',
            Status: 'creating',
            DBSnapshotArn: 'arn:aws:rds:us-east-1:123456789012:snapshot:my-snapshot',
          },
        });

        const result = await manager.createSnapshot({
          dbSnapshotIdentifier: 'my-snapshot',
          dbInstanceIdentifier: 'my-db',
          tags: { Environment: 'production' },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('my-snapshot');
      });
    });

    describe('deleteSnapshot', () => {
      it('should delete a snapshot', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSnapshot: {
            DBSnapshotIdentifier: 'old-snapshot',
            Status: 'deleted',
            DBSnapshotArn: 'arn:aws:rds:us-east-1:123456789012:snapshot:old-snapshot',
          },
        });

        const result = await manager.deleteSnapshot('old-snapshot');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted');
      });
    });

    describe('restoreFromSnapshot', () => {
      it('should restore from a snapshot', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'restored-db',
            DBInstanceStatus: 'creating',
            Engine: 'mysql',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:restored-db',
          },
        });

        const result = await manager.restoreFromSnapshot({
          dbInstanceIdentifier: 'restored-db',
          dbSnapshotIdentifier: 'my-snapshot',
          dbInstanceClass: 'db.r5.large',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('restore from snapshot');
      });
    });

    describe('copySnapshot', () => {
      it('should copy a snapshot', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSnapshot: {
            DBSnapshotIdentifier: 'copied-snapshot',
            Status: 'creating',
            DBSnapshotArn: 'arn:aws:rds:us-east-1:123456789012:snapshot:copied-snapshot',
          },
        });

        const result = await manager.copySnapshot({
          sourceDBSnapshotIdentifier: 'original-snapshot',
          targetDBSnapshotIdentifier: 'copied-snapshot',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('copy');
      });
    });

    describe('restoreToPointInTime', () => {
      it('should restore to point in time', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'pitr-db',
            DBInstanceStatus: 'creating',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:pitr-db',
          },
        });

        const result = await manager.restoreToPointInTime({
          sourceDBInstanceIdentifier: 'my-db',
          targetDBInstanceIdentifier: 'pitr-db',
          restoreTime: new Date('2024-01-15T10:00:00Z'),
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('point-in-time');
      });

      it('should restore to latest restorable time', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'latest-restore-db',
            DBInstanceStatus: 'creating',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:latest-restore-db',
          },
        });

        const result = await manager.restoreToPointInTime({
          sourceDBInstanceIdentifier: 'my-db',
          targetDBInstanceIdentifier: 'latest-restore-db',
          useLatestRestorableTime: true,
        });

        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // 3. RDS Performance Monitoring Tests
  // ==========================================================================

  describe('Performance Monitoring', () => {
    describe('getInstanceMetrics', () => {
      it('should get CloudWatch metrics', async () => {
        mockCloudWatchSend.mockResolvedValue({
          Datapoints: [
            {
              Timestamp: new Date(),
              Average: 25.5,
            },
          ],
        });

        const metrics = await manager.getInstanceMetrics({
          dbInstanceIdentifier: 'my-db',
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(),
        });

        expect(metrics.dbInstanceIdentifier).toBe('my-db');
        expect(metrics.metrics).toBeDefined();
      });
    });

    describe('enablePerformanceInsights', () => {
      it('should enable Performance Insights', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            PerformanceInsightsEnabled: true,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.enablePerformanceInsights({
          dbInstanceIdentifier: 'my-db',
          performanceInsightsRetentionPeriod: 7,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('disablePerformanceInsights', () => {
      it('should disable Performance Insights', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            PerformanceInsightsEnabled: false,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.disablePerformanceInsights('my-db');

        expect(result.success).toBe(true);
      });
    });

    describe('configureEnhancedMonitoring', () => {
      it('should configure enhanced monitoring', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            MonitoringInterval: 60,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.configureEnhancedMonitoring({
          dbInstanceIdentifier: 'my-db',
          monitoringInterval: 60,
          monitoringRoleArn: 'arn:aws:iam::123456789012:role/rds-monitoring-role',
        });

        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // 4. RDS Parameter Group Tests
  // ==========================================================================

  describe('Parameter Group Operations', () => {
    describe('listParameterGroups', () => {
      it('should list parameter groups', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBParameterGroups: [
            {
              DBParameterGroupName: 'custom-mysql8',
              DBParameterGroupFamily: 'mysql8.0',
              Description: 'Custom MySQL 8.0 parameters',
              DBParameterGroupArn: 'arn:aws:rds:us-east-1:123456789012:pg:custom-mysql8',
            },
          ],
        });

        const groups = await manager.listParameterGroups();

        expect(groups).toHaveLength(1);
        expect(groups[0].dbParameterGroupName).toBe('custom-mysql8');
      });
    });

    describe('getParameters', () => {
      it('should get parameters for a group', async () => {
        mockRDSSend.mockResolvedValueOnce({
          Parameters: [
            {
              ParameterName: 'max_connections',
              ParameterValue: '150',
              IsModifiable: true,
              ApplyType: 'dynamic',
            },
          ],
        });

        const params = await manager.getParameters({
          dbParameterGroupName: 'custom-mysql8',
        });

        expect(params).toHaveLength(1);
        expect(params[0].parameterName).toBe('max_connections');
      });
    });

    describe('createParameterGroup', () => {
      it('should create a parameter group', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBParameterGroup: {
            DBParameterGroupName: 'new-pg',
            DBParameterGroupFamily: 'postgres14',
            Description: 'New parameter group',
            DBParameterGroupArn: 'arn:aws:rds:us-east-1:123456789012:pg:new-pg',
          },
        });

        const result = await manager.createParameterGroup({
          dbParameterGroupName: 'new-pg',
          dbParameterGroupFamily: 'postgres14',
          description: 'New parameter group',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('created');
      });
    });

    describe('modifyParameterGroup', () => {
      it('should modify parameters', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBParameterGroupName: 'custom-pg',
        });

        const result = await manager.modifyParameterGroup({
          dbParameterGroupName: 'custom-pg',
          parameters: [
            {
              parameterName: 'max_connections',
              parameterValue: '200',
              applyMethod: 'immediate',
            },
          ],
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('modified');
      });
    });

    describe('deleteParameterGroup', () => {
      it('should delete a parameter group', async () => {
        mockRDSSend.mockResolvedValueOnce({});

        const result = await manager.deleteParameterGroup('old-pg');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted');
      });
    });

    describe('resetParameterGroup', () => {
      it('should reset all parameters', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBParameterGroupName: 'custom-pg',
        });

        const result = await manager.resetParameterGroup({
          dbParameterGroupName: 'custom-pg',
          resetAllParameters: true,
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('reset');
      });
    });
  });

  // ==========================================================================
  // 5. RDS Subnet Group Tests
  // ==========================================================================

  describe('Subnet Group Operations', () => {
    describe('listSubnetGroups', () => {
      it('should list subnet groups', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSubnetGroups: [
            {
              DBSubnetGroupName: 'my-subnet-group',
              DBSubnetGroupDescription: 'My subnet group',
              VpcId: 'vpc-12345678',
              SubnetGroupStatus: 'Complete',
              Subnets: [
                {
                  SubnetIdentifier: 'subnet-1',
                  SubnetAvailabilityZone: { Name: 'us-east-1a' },
                  SubnetStatus: 'Active',
                },
              ],
              DBSubnetGroupArn: 'arn:aws:rds:us-east-1:123456789012:subgrp:my-subnet-group',
            },
          ],
        });

        const groups = await manager.listSubnetGroups();

        expect(groups).toHaveLength(1);
        expect(groups[0].dbSubnetGroupName).toBe('my-subnet-group');
      });
    });

    describe('createSubnetGroup', () => {
      it('should create a subnet group', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSubnetGroup: {
            DBSubnetGroupName: 'new-subnet-group',
            DBSubnetGroupDescription: 'New subnet group',
            VpcId: 'vpc-12345678',
            SubnetGroupStatus: 'Complete',
            DBSubnetGroupArn: 'arn:aws:rds:us-east-1:123456789012:subgrp:new-subnet-group',
          },
        });

        const result = await manager.createSubnetGroup({
          dbSubnetGroupName: 'new-subnet-group',
          dbSubnetGroupDescription: 'New subnet group',
          subnetIds: ['subnet-1', 'subnet-2'],
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('created');
      });
    });

    describe('modifySubnetGroup', () => {
      it('should modify a subnet group', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBSubnetGroup: {
            DBSubnetGroupName: 'my-subnet-group',
            DBSubnetGroupArn: 'arn:aws:rds:us-east-1:123456789012:subgrp:my-subnet-group',
          },
        });

        const result = await manager.modifySubnetGroup({
          dbSubnetGroupName: 'my-subnet-group',
          subnetIds: ['subnet-1', 'subnet-2', 'subnet-3'],
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('modified');
      });
    });

    describe('deleteSubnetGroup', () => {
      it('should delete a subnet group', async () => {
        mockRDSSend.mockResolvedValueOnce({});

        const result = await manager.deleteSubnetGroup('old-subnet-group');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted');
      });
    });
  });

  // ==========================================================================
  // 6. RDS Backup and Maintenance Tests
  // ==========================================================================

  describe('Backup and Maintenance Operations', () => {
    describe('getBackupConfiguration', () => {
      it('should get backup configuration', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'my-db',
              BackupRetentionPeriod: 7,
              PreferredBackupWindow: '05:00-06:00',
              CopyTagsToSnapshot: true,
              LatestRestorableTime: new Date(),
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
            },
          ],
        });

        const config = await manager.getBackupConfiguration('my-db');

        expect(config).not.toBeNull();
        expect(config?.backupRetentionPeriod).toBe(7);
        expect(config?.preferredBackupWindow).toBe('05:00-06:00');
      });
    });

    describe('setBackupConfiguration', () => {
      it('should set backup configuration', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            BackupRetentionPeriod: 14,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.setBackupConfiguration({
          dbInstanceIdentifier: 'my-db',
          backupRetentionPeriod: 14,
          preferredBackupWindow: '03:00-04:00',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('getMaintenanceConfiguration', () => {
      it('should get maintenance configuration', async () => {
        mockRDSSend
          .mockResolvedValueOnce({
            DBInstances: [
              {
                DBInstanceIdentifier: 'my-db',
                PreferredMaintenanceWindow: 'sun:05:00-sun:06:00',
                AutoMinorVersionUpgrade: true,
                DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
              },
            ],
          })
          .mockResolvedValueOnce({
            PendingMaintenanceActions: [],
          });

        const config = await manager.getMaintenanceConfiguration('my-db');

        expect(config).not.toBeNull();
        expect(config?.preferredMaintenanceWindow).toBe('sun:05:00-sun:06:00');
        expect(config?.autoMinorVersionUpgrade).toBe(true);
      });
    });

    describe('setMaintenanceConfiguration', () => {
      it('should set maintenance configuration', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            PreferredMaintenanceWindow: 'sat:04:00-sat:05:00',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.setMaintenanceConfiguration({
          dbInstanceIdentifier: 'my-db',
          preferredMaintenanceWindow: 'sat:04:00-sat:05:00',
          autoMinorVersionUpgrade: false,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('listAutomatedBackups', () => {
      it('should list automated backups', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstanceAutomatedBackups: [
            {
              DBInstanceIdentifier: 'my-db',
              DbiResourceId: 'db-ABC123',
              Status: 'active',
              AllocatedStorage: 100,
              DBInstanceAutomatedBackupsArn: 'arn:aws:rds:us-east-1:123456789012:auto-backup:ab-123',
            },
          ],
        });

        const backups = await manager.listAutomatedBackups();

        expect(backups).toHaveLength(1);
        expect(backups[0].dbInstanceIdentifier).toBe('my-db');
      });
    });
  });

  // ==========================================================================
  // 7. RDS Read Replica Tests
  // ==========================================================================

  describe('Read Replica Operations', () => {
    describe('createReadReplica', () => {
      it('should create a read replica', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db-replica',
            ReadReplicaSourceDBInstanceIdentifier: 'my-db',
            DBInstanceStatus: 'creating',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db-replica',
          },
        });

        const result = await manager.createReadReplica({
          dbInstanceIdentifier: 'my-db-replica',
          sourceDBInstanceIdentifier: 'my-db',
          dbInstanceClass: 'db.r5.large',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('Read replica');
      });
    });

    describe('promoteReadReplica', () => {
      it('should promote a read replica', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db-replica',
            DBInstanceStatus: 'modifying',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db-replica',
          },
        });

        const result = await manager.promoteReadReplica({
          dbInstanceIdentifier: 'my-db-replica',
          backupRetentionPeriod: 7,
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('promotion');
      });
    });

    describe('listReadReplicas', () => {
      it('should list read replicas', async () => {
        mockRDSSend
          .mockResolvedValueOnce({
            DBInstances: [
              {
                DBInstanceIdentifier: 'my-db',
                ReadReplicaDBInstanceIdentifiers: ['replica-1', 'replica-2'],
                DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
              },
            ],
          })
          .mockResolvedValueOnce({
            DBInstances: [
              {
                DBInstanceIdentifier: 'replica-1',
                ReadReplicaSourceDBInstanceIdentifier: 'my-db',
                DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:replica-1',
              },
            ],
          })
          .mockResolvedValueOnce({
            DBInstances: [
              {
                DBInstanceIdentifier: 'replica-2',
                ReadReplicaSourceDBInstanceIdentifier: 'my-db',
                DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:replica-2',
              },
            ],
          });

        const replicas = await manager.listReadReplicas('my-db');

        expect(replicas).toHaveLength(2);
      });
    });

    describe('getReplicaStatus', () => {
      it('should get replica status', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'replica-1',
              ReadReplicaSourceDBInstanceIdentifier: 'my-db',
              ReplicaMode: 'open-read-only',
              DBInstanceStatus: 'available',
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:replica-1',
            },
          ],
        });

        const status = await manager.getReplicaStatus('replica-1');

        expect(status).not.toBeNull();
        expect(status?.isReplica).toBe(true);
        expect(status?.sourceDBInstanceIdentifier).toBe('my-db');
      });
    });
  });

  // ==========================================================================
  // 8. RDS Multi-AZ Failover Tests
  // ==========================================================================

  describe('Multi-AZ and Failover Operations', () => {
    describe('rebootInstance', () => {
      it('should reboot an instance', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            DBInstanceStatus: 'rebooting',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.rebootInstance({
          dbInstanceIdentifier: 'my-db',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('reboot');
      });

      it('should reboot with failover', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            DBInstanceStatus: 'rebooting',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.rebootInstance({
          dbInstanceIdentifier: 'my-db',
          forceFailover: true,
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('failover');
      });
    });

    describe('forceFailover', () => {
      it('should force failover for Multi-AZ instance', async () => {
        mockRDSSend
          .mockResolvedValueOnce({
            DBInstances: [
              {
                DBInstanceIdentifier: 'multiaz-db',
                MultiAZ: true,
                AvailabilityZone: 'us-east-1a',
                SecondaryAvailabilityZone: 'us-east-1b',
                DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:multiaz-db',
              },
            ],
          })
          .mockResolvedValueOnce({
            DBInstance: {
              DBInstanceIdentifier: 'multiaz-db',
              DBInstanceStatus: 'rebooting',
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:multiaz-db',
            },
          });

        const result = await manager.forceFailover('multiaz-db');

        expect(result.success).toBe(true);
      });

      it('should fail for non-Multi-AZ instance', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'single-az-db',
              MultiAZ: false,
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:single-az-db',
            },
          ],
        });

        const result = await manager.forceFailover('single-az-db');

        expect(result.success).toBe(false);
        expect(result.message).toContain('not a Multi-AZ');
      });
    });

    describe('getMultiAZStatus', () => {
      it('should get Multi-AZ status', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'multiaz-db',
              MultiAZ: true,
              AvailabilityZone: 'us-east-1a',
              SecondaryAvailabilityZone: 'us-east-1b',
              DBInstanceStatus: 'available',
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:multiaz-db',
            },
          ],
        });

        const status = await manager.getMultiAZStatus('multiaz-db');

        expect(status).not.toBeNull();
        expect(status?.multiAZ).toBe(true);
        expect(status?.primaryAvailabilityZone).toBe('us-east-1a');
        expect(status?.secondaryAvailabilityZone).toBe('us-east-1b');
      });
    });

    describe('enableMultiAZ', () => {
      it('should enable Multi-AZ', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            MultiAZ: true,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.enableMultiAZ('my-db', {
          applyImmediately: true,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('disableMultiAZ', () => {
      it('should disable Multi-AZ', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-db',
            MultiAZ: false,
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-db',
          },
        });

        const result = await manager.disableMultiAZ('my-db');

        expect(result.success).toBe(true);
      });
    });

    describe('failoverDBCluster', () => {
      it('should failover a DB cluster', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBCluster: {
            DBClusterIdentifier: 'my-cluster',
            Status: 'failing-over',
          },
        });

        const result = await manager.failoverDBCluster({
          dbInstanceIdentifier: 'my-cluster',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('failover');
      });
    });
  });

  // ==========================================================================
  // Events and Logs Tests
  // ==========================================================================

  describe('Events and Logs', () => {
    describe('listEvents', () => {
      it('should list events', async () => {
        mockRDSSend.mockResolvedValueOnce({
          Events: [
            {
              SourceIdentifier: 'my-db',
              SourceType: 'db-instance',
              Message: 'DB instance restarted',
              EventCategories: ['availability'],
              Date: new Date(),
            },
          ],
        });

        const events = await manager.listEvents({
          sourceIdentifier: 'my-db',
          sourceType: 'db-instance',
        });

        expect(events).toHaveLength(1);
        expect(events[0].message).toContain('restarted');
      });
    });

    describe('getEventCategories', () => {
      it('should get event categories', async () => {
        mockRDSSend.mockResolvedValueOnce({
          EventCategoriesMapList: [
            {
              SourceType: 'db-instance',
              EventCategories: ['availability', 'backup', 'configuration change'],
            },
          ],
        });

        const categories = await manager.getEventCategories({
          sourceType: 'db-instance',
        });

        expect(categories).toHaveLength(1);
        expect(categories[0].eventCategories).toContain('availability');
      });
    });

    describe('createEventSubscription', () => {
      it('should create an event subscription', async () => {
        mockRDSSend.mockResolvedValueOnce({
          EventSubscription: {
            CustSubscriptionId: 'my-subscription',
            SnsTopicArn: 'arn:aws:sns:us-east-1:123456789012:my-topic',
            Status: 'active',
            Enabled: true,
          },
        });

        const result = await manager.createEventSubscription({
          subscriptionName: 'my-subscription',
          snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:my-topic',
          sourceType: 'db-instance',
          eventCategories: ['availability', 'failure'],
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('created');
      });
    });

    describe('listLogFiles', () => {
      it('should list log files', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DescribeDBLogFiles: [
            {
              LogFileName: 'error/mysql-error.log',
              LastWritten: Date.now(),
              Size: 1024,
            },
          ],
        });

        const logs = await manager.listLogFiles({
          dbInstanceIdentifier: 'my-db',
        });

        expect(logs).toHaveLength(1);
        expect(logs[0].logFileName).toContain('error');
      });
    });

    describe('downloadLogFilePortion', () => {
      it('should download log file portion', async () => {
        mockRDSSend.mockResolvedValueOnce({
          LogFileData: '2024-01-15 10:00:00 UTC - Log entry',
          Marker: 'next-marker',
          AdditionalDataPending: true,
        });

        const result = await manager.downloadLogFilePortion({
          dbInstanceIdentifier: 'my-db',
          logFileName: 'error/mysql-error.log',
        });

        expect(result.logFileData).toContain('Log entry');
        expect(result.additionalDataPending).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Engine Version and Orderable Options Tests
  // ==========================================================================

  describe('Engine Versions and Options', () => {
    describe('getEngineVersions', () => {
      it('should get engine versions', async () => {
        mockRDSSend.mockResolvedValueOnce({
          DBEngineVersions: [
            {
              Engine: 'mysql',
              EngineVersion: '8.0.32',
              DBParameterGroupFamily: 'mysql8.0',
              DBEngineVersionDescription: 'MySQL Community Edition',
              SupportsReadReplica: true,
            },
          ],
        });

        const versions = await manager.getEngineVersions({
          engine: 'mysql',
        });

        expect(versions).toHaveLength(1);
        expect(versions[0].engineVersion).toBe('8.0.32');
        expect(versions[0].supportsReadReplica).toBe(true);
      });
    });

    describe('getOrderableInstanceOptions', () => {
      it('should get orderable instance options', async () => {
        mockRDSSend.mockResolvedValueOnce({
          OrderableDBInstanceOptions: [
            {
              Engine: 'mysql',
              EngineVersion: '8.0.32',
              DBInstanceClass: 'db.t3.micro',
              StorageType: 'gp2',
              MultiAZCapable: true,
              ReadReplicaCapable: true,
              SupportsStorageEncryption: true,
              MinStorageSize: 20,
              MaxStorageSize: 16384,
            },
          ],
        });

        const options = await manager.getOrderableInstanceOptions({
          engine: 'mysql',
        });

        expect(options).toHaveLength(1);
        expect(options[0].dbInstanceClass).toBe('db.t3.micro');
        expect(options[0].multiAZCapable).toBe(true);
      });
    });
  });
});
