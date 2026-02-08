/**
 * AWS RDS Manager
 * Comprehensive RDS operations implementation
 */

import { withAWSRetry, type AWSRetryOptions } from '../retry.js';

import {
  RDSClient,
  CreateDBInstanceCommand,
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  ModifyDBInstanceCommand,
  RebootDBInstanceCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
  CreateDBSnapshotCommand,
  DeleteDBSnapshotCommand,
  DescribeDBSnapshotsCommand,
  RestoreDBInstanceFromDBSnapshotCommand,
  CopyDBSnapshotCommand,
  CreateDBParameterGroupCommand,
  DeleteDBParameterGroupCommand,
  DescribeDBParameterGroupsCommand,
  DescribeDBParametersCommand,
  ModifyDBParameterGroupCommand,
  ResetDBParameterGroupCommand,
  CreateDBSubnetGroupCommand,
  DeleteDBSubnetGroupCommand,
  DescribeDBSubnetGroupsCommand,
  ModifyDBSubnetGroupCommand,
  CreateDBInstanceReadReplicaCommand,
  PromoteReadReplicaCommand,
  DescribeEventsCommand,
  DescribeEventCategoriesCommand,
  CreateEventSubscriptionCommand,
  DeleteEventSubscriptionCommand,
  DescribeEventSubscriptionsCommand,
  DescribeDBLogFilesCommand,
  DownloadDBLogFilePortionCommand,
  DescribeOrderableDBInstanceOptionsCommand,
  DescribeDBEngineVersionsCommand,
  DescribePendingMaintenanceActionsCommand,
  ApplyPendingMaintenanceActionCommand,
  RestoreDBInstanceToPointInTimeCommand,
  DescribeDBInstanceAutomatedBackupsCommand,
  DeleteDBInstanceAutomatedBackupCommand,
  StartDBInstanceAutomatedBackupsReplicationCommand,
  StopDBInstanceAutomatedBackupsReplicationCommand,
  FailoverDBClusterCommand,
  type Tag,
  type DBInstance,
  type DBSnapshot,
  type DBParameterGroup,
  type Parameter,
  type DBSubnetGroup,
  type Event,
  type EventSubscription,
  type DescribeDBLogFilesDetails,
  type DBInstanceAutomatedBackup,
} from '@aws-sdk/client-rds';

import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  type Datapoint,
} from '@aws-sdk/client-cloudwatch';

import {
  PIClient,
  GetResourceMetricsCommand,
  DescribeDimensionKeysCommand,
  type ResponseResourceMetricKey,
  type DataPoint as PIDataPoint,
} from '@aws-sdk/client-pi';

import type {
  RDSClientConfig,
  RDSOperationResult,
  RDSInstance,
  RDSCreateInstanceOptions,
  RDSModifyInstanceOptions,
  RDSSnapshot,
  RDSCreateSnapshotOptions,
  RDSRestoreFromSnapshotOptions,
  RDSCopySnapshotOptions,
  RDSParameterGroup,
  RDSParameter,
  RDSCreateParameterGroupOptions,
  RDSModifyParameterGroupOptions,
  RDSSubnetGroup,
  RDSCreateSubnetGroupOptions,
  RDSModifySubnetGroupOptions,
  RDSPerformanceMetrics,
  RDSGetMetricsOptions,
  RDSEnhancedMonitoringOptions,
  RDSCreateReadReplicaOptions,
  RDSPromoteReadReplicaOptions,
  RDSFailoverOptions,
  RDSRebootOptions,
  RDSSetBackupConfigOptions,
  RDSSetMaintenanceConfigOptions,
  RDSEvent,
  RDSEventSubscription,
  RDSListEventsOptions,
  RDSLogFile,
  RDSDownloadLogOptions,
  RDSRestoreToPointInTimeOptions,
  RDSAutomatedBackup,
} from './types.js';

// ============================================================================
// RDS Manager Class
// ============================================================================

export class RDSManager {
  private config: RDSClientConfig;
  private defaultRegion: string;
  private retryOptions: AWSRetryOptions;

  constructor(config: RDSClientConfig = {}, retryOptions: AWSRetryOptions = {}) {
    this.config = config;
    this.defaultRegion = config.region || process.env.AWS_REGION || 'us-east-1';
    this.retryOptions = retryOptions;
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

  // --------------------------------------------------------------------------
  // Client Factory Methods
  // --------------------------------------------------------------------------

  private getRDSClient(region?: string): RDSClient {
    return new RDSClient({
      region: region || this.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  private getCloudWatchClient(region?: string): CloudWatchClient {
    return new CloudWatchClient({
      region: region || this.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  private getPIClient(region?: string): PIClient {
    return new PIClient({
      region: region || this.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private tagsToRecord(tags?: Tag[]): Record<string, string> {
    if (!tags) return {};
    const record: Record<string, string> = {};
    for (const tag of tags) {
      if (tag.Key && tag.Value) {
        record[tag.Key] = tag.Value;
      }
    }
    return record;
  }

  private recordToTags(record?: Record<string, string>): Tag[] {
    if (!record) return [];
    return Object.entries(record).map(([Key, Value]) => ({ Key, Value }));
  }

  private mapDBInstance(instance: DBInstance): RDSInstance {
    return {
      dbInstanceIdentifier: instance.DBInstanceIdentifier || '',
      dbInstanceClass: instance.DBInstanceClass || '',
      engine: instance.Engine || '',
      engineVersion: instance.EngineVersion || '',
      status: instance.DBInstanceStatus || '',
      endpoint: instance.Endpoint
        ? {
            address: instance.Endpoint.Address || '',
            port: instance.Endpoint.Port || 0,
            hostedZoneId: instance.Endpoint.HostedZoneId,
          }
        : undefined,
      allocatedStorage: instance.AllocatedStorage || 0,
      storageType: instance.StorageType || '',
      storageEncrypted: instance.StorageEncrypted || false,
      kmsKeyId: instance.KmsKeyId,
      multiAZ: instance.MultiAZ || false,
      availabilityZone: instance.AvailabilityZone,
      secondaryAvailabilityZone: instance.SecondaryAvailabilityZone,
      publiclyAccessible: instance.PubliclyAccessible || false,
      autoMinorVersionUpgrade: instance.AutoMinorVersionUpgrade || false,
      masterUsername: instance.MasterUsername || '',
      dbName: instance.DBName,
      vpcSecurityGroups: (instance.VpcSecurityGroups || []).map((sg) => ({
        vpcSecurityGroupId: sg.VpcSecurityGroupId || '',
        status: sg.Status || '',
      })),
      dbSubnetGroup: instance.DBSubnetGroup
        ? {
            dbSubnetGroupName: instance.DBSubnetGroup.DBSubnetGroupName || '',
            dbSubnetGroupDescription: instance.DBSubnetGroup.DBSubnetGroupDescription || '',
            vpcId: instance.DBSubnetGroup.VpcId || '',
            subnetGroupStatus: instance.DBSubnetGroup.SubnetGroupStatus || '',
          }
        : undefined,
      dbParameterGroups: (instance.DBParameterGroups || []).map((pg) => ({
        dbParameterGroupName: pg.DBParameterGroupName || '',
        parameterApplyStatus: pg.ParameterApplyStatus || '',
      })),
      backupRetentionPeriod: instance.BackupRetentionPeriod || 0,
      preferredBackupWindow: instance.PreferredBackupWindow,
      preferredMaintenanceWindow: instance.PreferredMaintenanceWindow,
      latestRestorableTime: instance.LatestRestorableTime,
      iops: instance.Iops,
      storageThroughput: instance.StorageThroughput,
      licenseModel: instance.LicenseModel,
      readReplicaSourceDBInstanceIdentifier: instance.ReadReplicaSourceDBInstanceIdentifier,
      readReplicaDBInstanceIdentifiers: instance.ReadReplicaDBInstanceIdentifiers || [],
      replicaMode: instance.ReplicaMode,
      performanceInsightsEnabled: instance.PerformanceInsightsEnabled || false,
      performanceInsightsKMSKeyId: instance.PerformanceInsightsKMSKeyId,
      performanceInsightsRetentionPeriod: instance.PerformanceInsightsRetentionPeriod,
      enhancedMonitoringResourceArn: instance.EnhancedMonitoringResourceArn,
      monitoringInterval: instance.MonitoringInterval,
      monitoringRoleArn: instance.MonitoringRoleArn,
      deletionProtection: instance.DeletionProtection || false,
      dbInstanceArn: instance.DBInstanceArn || '',
      tags: this.tagsToRecord(instance.TagList),
      instanceCreateTime: instance.InstanceCreateTime,
      caCertificateIdentifier: instance.CACertificateIdentifier,
      copyTagsToSnapshot: instance.CopyTagsToSnapshot || false,
      iamDatabaseAuthenticationEnabled: instance.IAMDatabaseAuthenticationEnabled || false,
      maxAllocatedStorage: instance.MaxAllocatedStorage,
      networkType: instance.NetworkType,
    };
  }

  private mapDBSnapshot(snapshot: DBSnapshot): RDSSnapshot {
    return {
      dbSnapshotIdentifier: snapshot.DBSnapshotIdentifier || '',
      dbInstanceIdentifier: snapshot.DBInstanceIdentifier || '',
      snapshotCreateTime: snapshot.SnapshotCreateTime,
      engine: snapshot.Engine || '',
      engineVersion: snapshot.EngineVersion || '',
      status: snapshot.Status || '',
      allocatedStorage: snapshot.AllocatedStorage || 0,
      storageType: snapshot.StorageType || '',
      availabilityZone: snapshot.AvailabilityZone,
      vpcId: snapshot.VpcId,
      instanceCreateTime: snapshot.InstanceCreateTime,
      masterUsername: snapshot.MasterUsername || '',
      port: snapshot.Port || 0,
      snapshotType: snapshot.SnapshotType || '',
      iops: snapshot.Iops,
      optionGroupName: snapshot.OptionGroupName,
      percentProgress: snapshot.PercentProgress || 0,
      sourceRegion: snapshot.SourceRegion,
      sourceDBSnapshotIdentifier: snapshot.SourceDBSnapshotIdentifier,
      encrypted: snapshot.Encrypted || false,
      kmsKeyId: snapshot.KmsKeyId,
      dbSnapshotArn: snapshot.DBSnapshotArn || '',
      timezone: snapshot.Timezone,
      iamDatabaseAuthenticationEnabled: snapshot.IAMDatabaseAuthenticationEnabled || false,
      processorFeatures: (snapshot.ProcessorFeatures || []).map((pf) => ({
        name: pf.Name || '',
        value: pf.Value || '',
      })),
      dbiResourceId: snapshot.DbiResourceId,
      tags: this.tagsToRecord(snapshot.TagList),
      originalSnapshotCreateTime: snapshot.OriginalSnapshotCreateTime,
      snapshotDatabaseTime: snapshot.SnapshotDatabaseTime,
      snapshotTarget: snapshot.SnapshotTarget,
      storageThroughput: snapshot.StorageThroughput,
    };
  }

  private mapDBParameterGroup(group: DBParameterGroup): RDSParameterGroup {
    return {
      dbParameterGroupName: group.DBParameterGroupName || '',
      dbParameterGroupFamily: group.DBParameterGroupFamily || '',
      description: group.Description || '',
      dbParameterGroupArn: group.DBParameterGroupArn || '',
      tags: {},
    };
  }

  private mapParameter(param: Parameter): RDSParameter {
    return {
      parameterName: param.ParameterName || '',
      parameterValue: param.ParameterValue,
      description: param.Description,
      source: param.Source,
      applyType: param.ApplyType,
      dataType: param.DataType,
      allowedValues: param.AllowedValues,
      isModifiable: param.IsModifiable || false,
      minimumEngineVersion: param.MinimumEngineVersion,
      applyMethod: param.ApplyMethod as 'immediate' | 'pending-reboot' | undefined,
      supportedEngineModes: param.SupportedEngineModes || [],
    };
  }

  private mapDBSubnetGroup(group: DBSubnetGroup): RDSSubnetGroup {
    return {
      dbSubnetGroupName: group.DBSubnetGroupName || '',
      dbSubnetGroupDescription: group.DBSubnetGroupDescription || '',
      vpcId: group.VpcId || '',
      subnetGroupStatus: group.SubnetGroupStatus || '',
      subnets: (group.Subnets || []).map((subnet) => ({
        subnetIdentifier: subnet.SubnetIdentifier || '',
        subnetAvailabilityZone: {
          name: subnet.SubnetAvailabilityZone?.Name || '',
        },
        subnetOutpost: subnet.SubnetOutpost?.Arn
          ? { arn: subnet.SubnetOutpost.Arn }
          : undefined,
        subnetStatus: subnet.SubnetStatus || '',
      })),
      dbSubnetGroupArn: group.DBSubnetGroupArn || '',
      supportedNetworkTypes: group.SupportedNetworkTypes || [],
      tags: {},
    };
  }

  private mapEvent(event: Event): RDSEvent {
    return {
      sourceIdentifier: event.SourceIdentifier,
      sourceType: event.SourceType,
      message: event.Message,
      eventCategories: event.EventCategories || [],
      date: event.Date,
      sourceArn: event.SourceArn,
    };
  }

  private mapEventSubscription(sub: EventSubscription): RDSEventSubscription {
    return {
      customerAwsId: sub.CustomerAwsId,
      custSubscriptionId: sub.CustSubscriptionId,
      snsTopicArn: sub.SnsTopicArn,
      status: sub.Status,
      subscriptionCreationTime: sub.SubscriptionCreationTime,
      sourceType: sub.SourceType,
      sourceIdsList: sub.SourceIdsList || [],
      eventCategoriesList: sub.EventCategoriesList || [],
      enabled: sub.Enabled || false,
      eventSubscriptionArn: sub.EventSubscriptionArn,
    };
  }

  private mapAutomatedBackup(backup: DBInstanceAutomatedBackup): RDSAutomatedBackup {
    return {
      dbInstanceArn: backup.DBInstanceArn,
      dbiResourceId: backup.DbiResourceId,
      region: backup.Region,
      dbInstanceIdentifier: backup.DBInstanceIdentifier,
      restoreWindow: backup.RestoreWindow
        ? {
            earliestTime: backup.RestoreWindow.EarliestTime,
            latestTime: backup.RestoreWindow.LatestTime,
          }
        : undefined,
      allocatedStorage: backup.AllocatedStorage || 0,
      status: backup.Status,
      port: backup.Port || 0,
      availabilityZone: backup.AvailabilityZone,
      vpcId: backup.VpcId,
      instanceCreateTime: backup.InstanceCreateTime,
      masterUsername: backup.MasterUsername,
      engine: backup.Engine,
      engineVersion: backup.EngineVersion,
      licenseModel: backup.LicenseModel,
      iops: backup.Iops,
      optionGroupName: backup.OptionGroupName,
      encrypted: backup.Encrypted || false,
      storageType: backup.StorageType,
      kmsKeyId: backup.KmsKeyId,
      timezone: backup.Timezone,
      iamDatabaseAuthenticationEnabled: backup.IAMDatabaseAuthenticationEnabled || false,
      backupRetentionPeriod: backup.BackupRetentionPeriod,
      dbInstanceAutomatedBackupsArn: backup.DBInstanceAutomatedBackupsArn,
      dbInstanceAutomatedBackupsReplications: (
        backup.DBInstanceAutomatedBackupsReplications || []
      ).map((r) => ({
        dbInstanceAutomatedBackupsArn: r.DBInstanceAutomatedBackupsArn,
      })),
      backupTarget: backup.BackupTarget,
      storageThroughput: backup.StorageThroughput,
    };
  }

  // ==========================================================================
  // 1. RDS Instance Creation and Configuration
  // ==========================================================================

  /**
   * List RDS instances with optional filtering
   */
  async listInstances(options: {
    dbInstanceIdentifier?: string;
    filters?: Array<{ name: string; values: string[] }>;
    maxRecords?: number;
    region?: string;
  } = {}): Promise<RDSInstance[]> {
    const client = this.getRDSClient(options.region);
    const instances: RDSInstance[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBInstancesCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        Filters: options.filters?.map((f) => ({
          Name: f.name,
          Values: f.values,
        })),
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(
        () => client.send(command),
        'DescribeDBInstances'
      );
      
      if (response.DBInstances) {
        for (const instance of response.DBInstances) {
          instances.push(this.mapDBInstance(instance));
        }
      }

      marker = response.Marker;
    } while (marker);

    return instances;
  }

  /**
   * Get a specific RDS instance by identifier
   */
  async getInstance(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<RDSInstance | null> {
    const instances = await this.listInstances({
      dbInstanceIdentifier,
      region,
    });
    return instances.length > 0 ? instances[0] : null;
  }

  /**
   * Create a new RDS instance
   */
  async createInstance(options: RDSCreateInstanceOptions): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new CreateDBInstanceCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        DBInstanceClass: options.dbInstanceClass,
        Engine: options.engine,
        EngineVersion: options.engineVersion,
        MasterUsername: options.masterUsername,
        MasterUserPassword: options.masterUserPassword,
        DBName: options.dbName,
        AllocatedStorage: options.allocatedStorage,
        StorageType: options.storageType,
        Iops: options.iops,
        StorageThroughput: options.storageThroughput,
        StorageEncrypted: options.storageEncrypted,
        KmsKeyId: options.kmsKeyId,
        MultiAZ: options.multiAZ,
        AvailabilityZone: options.availabilityZone,
        DBSubnetGroupName: options.dbSubnetGroupName,
        VpcSecurityGroupIds: options.vpcSecurityGroupIds,
        DBParameterGroupName: options.dbParameterGroupName,
        OptionGroupName: options.optionGroupName,
        BackupRetentionPeriod: options.backupRetentionPeriod,
        PreferredBackupWindow: options.preferredBackupWindow,
        PreferredMaintenanceWindow: options.preferredMaintenanceWindow,
        Port: options.port,
        PubliclyAccessible: options.publiclyAccessible,
        AutoMinorVersionUpgrade: options.autoMinorVersionUpgrade,
        LicenseModel: options.licenseModel,
        EnablePerformanceInsights: options.enablePerformanceInsights,
        PerformanceInsightsKMSKeyId: options.performanceInsightsKMSKeyId,
        PerformanceInsightsRetentionPeriod: options.performanceInsightsRetentionPeriod,
        MonitoringInterval: options.monitoringInterval,
        MonitoringRoleArn: options.monitoringRoleArn,
        EnableIAMDatabaseAuthentication: options.enableIAMDatabaseAuthentication,
        DeletionProtection: options.deletionProtection,
        CopyTagsToSnapshot: options.copyTagsToSnapshot,
        MaxAllocatedStorage: options.maxAllocatedStorage,
        NetworkType: options.networkType,
        Tags: this.recordToTags(options.tags),
      });

      const response = await this.withRetry(
        () => client.send(command),
        'CreateDBInstance'
      );
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${options.dbInstanceIdentifier}' creation initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create RDS instance '${options.dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Modify an existing RDS instance
   */
  async modifyInstance(options: RDSModifyInstanceOptions): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new ModifyDBInstanceCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        DBInstanceClass: options.dbInstanceClass,
        AllocatedStorage: options.allocatedStorage,
        StorageType: options.storageType,
        Iops: options.iops,
        StorageThroughput: options.storageThroughput,
        MasterUserPassword: options.masterUserPassword,
        DBParameterGroupName: options.dbParameterGroupName,
        BackupRetentionPeriod: options.backupRetentionPeriod,
        PreferredBackupWindow: options.preferredBackupWindow,
        PreferredMaintenanceWindow: options.preferredMaintenanceWindow,
        MultiAZ: options.multiAZ,
        EngineVersion: options.engineVersion,
        AutoMinorVersionUpgrade: options.autoMinorVersionUpgrade,
        PubliclyAccessible: options.publiclyAccessible,
        VpcSecurityGroupIds: options.vpcSecurityGroupIds,
        DBSubnetGroupName: options.dbSubnetGroupName,
        MonitoringInterval: options.monitoringInterval,
        MonitoringRoleArn: options.monitoringRoleArn,
        EnablePerformanceInsights: options.enablePerformanceInsights,
        PerformanceInsightsKMSKeyId: options.performanceInsightsKMSKeyId,
        PerformanceInsightsRetentionPeriod: options.performanceInsightsRetentionPeriod,
        EnableIAMDatabaseAuthentication: options.enableIAMDatabaseAuthentication,
        DeletionProtection: options.deletionProtection,
        CopyTagsToSnapshot: options.copyTagsToSnapshot,
        MaxAllocatedStorage: options.maxAllocatedStorage,
        ApplyImmediately: options.applyImmediately ?? false,
      });

      const response = await this.withRetry(
        () => client.send(command),
        'ModifyDBInstance'
      );
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${options.dbInstanceIdentifier}' modification ${options.applyImmediately ? 'applied' : 'scheduled'}`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to modify RDS instance '${options.dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Delete an RDS instance
   */
  async deleteInstance(
    dbInstanceIdentifier: string,
    options: {
      skipFinalSnapshot?: boolean;
      finalDBSnapshotIdentifier?: string;
      deleteAutomatedBackups?: boolean;
      region?: string;
    } = {}
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new DeleteDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceIdentifier,
        SkipFinalSnapshot: options.skipFinalSnapshot ?? false,
        FinalDBSnapshotIdentifier: options.finalDBSnapshotIdentifier,
        DeleteAutomatedBackups: options.deleteAutomatedBackups,
      });

      const response = await this.withRetry(
        () => client.send(command),
        'DeleteDBInstance'
      );
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${dbInstanceIdentifier}' deletion initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete RDS instance '${dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Start a stopped RDS instance
   */
  async startInstance(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(region);

    try {
      const command = new StartDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceIdentifier,
      });

      const response = await this.withRetry(
        () => client.send(command),
        'StartDBInstance'
      );
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${dbInstanceIdentifier}' start initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to start RDS instance '${dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Stop a running RDS instance
   */
  async stopInstance(
    dbInstanceIdentifier: string,
    options: {
      dbSnapshotIdentifier?: string;
      region?: string;
    } = {}
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new StopDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceIdentifier,
        DBSnapshotIdentifier: options.dbSnapshotIdentifier,
      });

      const response = await this.withRetry(
        () => client.send(command),
        'StopDBInstance'
      );
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${dbInstanceIdentifier}' stop initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to stop RDS instance '${dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Get orderable DB instance options (valid instance classes, engines, etc.)
   */
  async getOrderableInstanceOptions(options: {
    engine: string;
    engineVersion?: string;
    dbInstanceClass?: string;
    licenseModel?: string;
    vpc?: boolean;
    maxRecords?: number;
    region?: string;
  }): Promise<Array<{
    engine: string;
    engineVersion: string;
    dbInstanceClass: string;
    storageType: string;
    licenseModel: string;
    availabilityZones: string[];
    multiAZCapable: boolean;
    readReplicaCapable: boolean;
    supportsStorageEncryption: boolean;
    supportsPerformanceInsights: boolean;
    supportsEnhancedMonitoring: boolean;
    supportsIAMDatabaseAuthentication: boolean;
    minStorageSize: number;
    maxStorageSize: number;
    minIopsPerDbInstance: number;
    maxIopsPerDbInstance: number;
  }>> {
    const client = this.getRDSClient(options.region);
    const results: Array<{
      engine: string;
      engineVersion: string;
      dbInstanceClass: string;
      storageType: string;
      licenseModel: string;
      availabilityZones: string[];
      multiAZCapable: boolean;
      readReplicaCapable: boolean;
      supportsStorageEncryption: boolean;
      supportsPerformanceInsights: boolean;
      supportsEnhancedMonitoring: boolean;
      supportsIAMDatabaseAuthentication: boolean;
      minStorageSize: number;
      maxStorageSize: number;
      minIopsPerDbInstance: number;
      maxIopsPerDbInstance: number;
    }> = [];
    let marker: string | undefined;

    do {
      const command = new DescribeOrderableDBInstanceOptionsCommand({
        Engine: options.engine,
        EngineVersion: options.engineVersion,
        DBInstanceClass: options.dbInstanceClass,
        LicenseModel: options.licenseModel,
        Vpc: options.vpc,
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeOrderableDBInstanceOptions');

      if (response.OrderableDBInstanceOptions) {
        for (const opt of response.OrderableDBInstanceOptions) {
          results.push({
            engine: opt.Engine || '',
            engineVersion: opt.EngineVersion || '',
            dbInstanceClass: opt.DBInstanceClass || '',
            storageType: opt.StorageType || '',
            licenseModel: opt.LicenseModel || '',
            availabilityZones: (opt.AvailabilityZones || []).map(
              (az) => az.Name || ''
            ),
            multiAZCapable: opt.MultiAZCapable || false,
            readReplicaCapable: opt.ReadReplicaCapable || false,
            supportsStorageEncryption: opt.SupportsStorageEncryption || false,
            supportsPerformanceInsights: opt.SupportsPerformanceInsights || false,
            supportsEnhancedMonitoring: opt.SupportsEnhancedMonitoring || false,
            supportsIAMDatabaseAuthentication:
              opt.SupportsIAMDatabaseAuthentication || false,
            minStorageSize: opt.MinStorageSize || 0,
            maxStorageSize: opt.MaxStorageSize || 0,
            minIopsPerDbInstance: opt.MinIopsPerDbInstance || 0,
            maxIopsPerDbInstance: opt.MaxIopsPerDbInstance || 0,
          });
        }
      }

      marker = response.Marker;
    } while (marker);

    return results;
  }

  /**
   * Get available DB engine versions
   */
  async getEngineVersions(options: {
    engine?: string;
    engineVersion?: string;
    dbParameterGroupFamily?: string;
    defaultOnly?: boolean;
    maxRecords?: number;
    region?: string;
  } = {}): Promise<Array<{
    engine: string;
    engineVersion: string;
    dbParameterGroupFamily: string;
    description: string;
    supportsLogExportsToCloudwatchLogs: boolean;
    supportsReadReplica: boolean;
    supportedEngineModes: string[];
    validUpgradeTarget: Array<{
      engine: string;
      engineVersion: string;
      description: string;
      autoUpgrade: boolean;
      isMajorVersionUpgrade: boolean;
    }>;
  }>> {
    const client = this.getRDSClient(options.region);
    const results: Array<{
      engine: string;
      engineVersion: string;
      dbParameterGroupFamily: string;
      description: string;
      supportsLogExportsToCloudwatchLogs: boolean;
      supportsReadReplica: boolean;
      supportedEngineModes: string[];
      validUpgradeTarget: Array<{
        engine: string;
        engineVersion: string;
        description: string;
        autoUpgrade: boolean;
        isMajorVersionUpgrade: boolean;
      }>;
    }> = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBEngineVersionsCommand({
        Engine: options.engine,
        EngineVersion: options.engineVersion,
        DBParameterGroupFamily: options.dbParameterGroupFamily,
        DefaultOnly: options.defaultOnly,
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeDBEngineVersions');

      if (response.DBEngineVersions) {
        for (const v of response.DBEngineVersions) {
          results.push({
            engine: v.Engine || '',
            engineVersion: v.EngineVersion || '',
            dbParameterGroupFamily: v.DBParameterGroupFamily || '',
            description: v.DBEngineVersionDescription || '',
            supportsLogExportsToCloudwatchLogs:
              v.SupportsLogExportsToCloudwatchLogs || false,
            supportsReadReplica: v.SupportsReadReplica || false,
            supportedEngineModes: v.SupportedEngineModes || [],
            validUpgradeTarget: (v.ValidUpgradeTarget || []).map((t) => ({
              engine: t.Engine || '',
              engineVersion: t.EngineVersion || '',
              description: t.Description || '',
              autoUpgrade: t.AutoUpgrade || false,
              isMajorVersionUpgrade: t.IsMajorVersionUpgrade || false,
            })),
          });
        }
      }

      marker = response.Marker;
    } while (marker);

    return results;
  }

  // ==========================================================================
  // 2. RDS Snapshot Creation and Restoration
  // ==========================================================================

  /**
   * List RDS snapshots
   */
  async listSnapshots(options: {
    dbInstanceIdentifier?: string;
    dbSnapshotIdentifier?: string;
    snapshotType?: 'automated' | 'manual' | 'shared' | 'public' | 'awsbackup';
    filters?: Array<{ name: string; values: string[] }>;
    includeShared?: boolean;
    includePublic?: boolean;
    maxRecords?: number;
    region?: string;
  } = {}): Promise<RDSSnapshot[]> {
    const client = this.getRDSClient(options.region);
    const snapshots: RDSSnapshot[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBSnapshotsCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        DBSnapshotIdentifier: options.dbSnapshotIdentifier,
        SnapshotType: options.snapshotType,
        Filters: options.filters?.map((f) => ({
          Name: f.name,
          Values: f.values,
        })),
        IncludeShared: options.includeShared,
        IncludePublic: options.includePublic,
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeDBSnapshots');

      if (response.DBSnapshots) {
        for (const snapshot of response.DBSnapshots) {
          snapshots.push(this.mapDBSnapshot(snapshot));
        }
      }

      marker = response.Marker;
    } while (marker);

    return snapshots;
  }

  /**
   * Create a manual snapshot of an RDS instance
   */
  async createSnapshot(options: RDSCreateSnapshotOptions): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new CreateDBSnapshotCommand({
        DBSnapshotIdentifier: options.dbSnapshotIdentifier,
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        Tags: this.recordToTags(options.tags),
      });

      const response = await this.withRetry(() => client.send(command), 'CreateDBSnapshot');
      const snapshot = response.DBSnapshot
        ? this.mapDBSnapshot(response.DBSnapshot)
        : null;

      return {
        success: true,
        message: `Snapshot '${options.dbSnapshotIdentifier}' creation initiated`,
        data: snapshot,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create snapshot '${options.dbSnapshotIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Delete an RDS snapshot
   */
  async deleteSnapshot(
    dbSnapshotIdentifier: string,
    region?: string
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(region);

    try {
      const command = new DeleteDBSnapshotCommand({
        DBSnapshotIdentifier: dbSnapshotIdentifier,
      });

      const response = await this.withRetry(() => client.send(command), 'DeleteDBSnapshot');
      const snapshot = response.DBSnapshot
        ? this.mapDBSnapshot(response.DBSnapshot)
        : null;

      return {
        success: true,
        message: `Snapshot '${dbSnapshotIdentifier}' deleted`,
        data: snapshot,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete snapshot '${dbSnapshotIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Restore an RDS instance from a snapshot
   */
  async restoreFromSnapshot(
    options: RDSRestoreFromSnapshotOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new RestoreDBInstanceFromDBSnapshotCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        DBSnapshotIdentifier: options.dbSnapshotIdentifier,
        DBInstanceClass: options.dbInstanceClass,
        Port: options.port,
        AvailabilityZone: options.availabilityZone,
        DBSubnetGroupName: options.dbSubnetGroupName,
        MultiAZ: options.multiAZ,
        PubliclyAccessible: options.publiclyAccessible,
        AutoMinorVersionUpgrade: options.autoMinorVersionUpgrade,
        LicenseModel: options.licenseModel,
        DBName: options.dbName,
        Engine: options.engine,
        Iops: options.iops,
        OptionGroupName: options.optionGroupName,
        StorageType: options.storageType,
        StorageThroughput: options.storageThroughput,
        VpcSecurityGroupIds: options.vpcSecurityGroupIds,
        DBParameterGroupName: options.dbParameterGroupName,
        DeletionProtection: options.deletionProtection,
        EnableIAMDatabaseAuthentication: options.enableIAMDatabaseAuthentication,
        CopyTagsToSnapshot: options.copyTagsToSnapshot,
        Tags: this.recordToTags(options.tags),
      });

      const response = await this.withRetry(() => client.send(command), 'RestoreDBInstanceFromDBSnapshot');
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${options.dbInstanceIdentifier}' restore from snapshot initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to restore from snapshot '${options.dbSnapshotIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Copy an RDS snapshot (can be cross-region)
   */
  async copySnapshot(options: RDSCopySnapshotOptions): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new CopyDBSnapshotCommand({
        SourceDBSnapshotIdentifier: options.sourceDBSnapshotIdentifier,
        TargetDBSnapshotIdentifier: options.targetDBSnapshotIdentifier,
        KmsKeyId: options.kmsKeyId,
        CopyTags: options.copyTags,
        OptionGroupName: options.optionGroupName,
        Tags: this.recordToTags(options.tags),
        // Note: For cross-region copy, use PreSignedUrl instead of SourceRegion
      });

      const response = await this.withRetry(() => client.send(command), 'CopyDBSnapshot');
      const snapshot = response.DBSnapshot
        ? this.mapDBSnapshot(response.DBSnapshot)
        : null;

      return {
        success: true,
        message: `Snapshot copy '${options.targetDBSnapshotIdentifier}' initiated`,
        data: snapshot,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to copy snapshot to '${options.targetDBSnapshotIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Restore an RDS instance to a specific point in time
   */
  async restoreToPointInTime(
    options: RDSRestoreToPointInTimeOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new RestoreDBInstanceToPointInTimeCommand({
        SourceDBInstanceIdentifier: options.sourceDBInstanceIdentifier,
        TargetDBInstanceIdentifier: options.targetDBInstanceIdentifier,
        RestoreTime: options.restoreTime,
        UseLatestRestorableTime: options.useLatestRestorableTime,
        DBInstanceClass: options.dbInstanceClass,
        Port: options.port,
        AvailabilityZone: options.availabilityZone,
        DBSubnetGroupName: options.dbSubnetGroupName,
        MultiAZ: options.multiAZ,
        PubliclyAccessible: options.publiclyAccessible,
        AutoMinorVersionUpgrade: options.autoMinorVersionUpgrade,
        LicenseModel: options.licenseModel,
        DBName: options.dbName,
        Engine: options.engine,
        Iops: options.iops,
        OptionGroupName: options.optionGroupName,
        StorageType: options.storageType,
        StorageThroughput: options.storageThroughput,
        VpcSecurityGroupIds: options.vpcSecurityGroupIds,
        DBParameterGroupName: options.dbParameterGroupName,
        DeletionProtection: options.deletionProtection,
        EnableIAMDatabaseAuthentication: options.enableIAMDatabaseAuthentication,
        CopyTagsToSnapshot: options.copyTagsToSnapshot,
        SourceDBInstanceAutomatedBackupsArn: options.sourceDBInstanceAutomatedBackupsArn,
        SourceDbiResourceId: options.sourceDbiResourceId,
        MaxAllocatedStorage: options.maxAllocatedStorage,
        NetworkType: options.networkType,
        Tags: this.recordToTags(options.tags),
      });

      const response = await this.withRetry(() => client.send(command), 'RestoreDBInstanceToPointInTime');
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${options.targetDBInstanceIdentifier}' point-in-time restore initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to restore to point in time for '${options.targetDBInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 3. RDS Performance Monitoring
  // ==========================================================================

  /**
   * Get CloudWatch metrics for an RDS instance
   */
  async getInstanceMetrics(options: RDSGetMetricsOptions): Promise<RDSPerformanceMetrics> {
    const client = this.getCloudWatchClient(options.region);
    
    const defaultMetrics = [
      'CPUUtilization',
      'FreeableMemory',
      'FreeStorageSpace',
      'ReadIOPS',
      'WriteIOPS',
      'ReadLatency',
      'WriteLatency',
      'ReadThroughput',
      'WriteThroughput',
      'NetworkReceiveThroughput',
      'NetworkTransmitThroughput',
      'DatabaseConnections',
      'SwapUsage',
      'DiskQueueDepth',
      'BurstBalance',
    ];

    const metricNames = options.metricNames || defaultMetrics;
    const statistics = options.statistics || ['Average'];
    const period = options.period || 300;

    const metrics: RDSPerformanceMetrics = {
      dbInstanceIdentifier: options.dbInstanceIdentifier,
      timestamp: new Date(),
      metrics: {},
    };

    const metricPromises = metricNames.map(async (metricName) => {
      const command = new GetMetricStatisticsCommand({
        Namespace: 'AWS/RDS',
        MetricName: metricName,
        Dimensions: [
          {
            Name: 'DBInstanceIdentifier',
            Value: options.dbInstanceIdentifier,
          },
        ],
        StartTime: options.startTime,
        EndTime: options.endTime,
        Period: period,
        Statistics: statistics,
      });

      try {
        const response = await this.withRetry(() => client.send(command), 'GetMetricStatistics');
        return { metricName, datapoints: response.Datapoints || [] };
      } catch {
        return { metricName, datapoints: [] };
      }
    });

    const results = await Promise.all(metricPromises);

    for (const { metricName, datapoints } of results) {
      if (datapoints.length > 0) {
        const latestDatapoint = datapoints.sort(
          (a: Datapoint, b: Datapoint) =>
            (b.Timestamp?.getTime() || 0) - (a.Timestamp?.getTime() || 0)
        )[0];
        const value = latestDatapoint.Average ?? latestDatapoint.Sum ?? 0;

        const metricKey = metricName.charAt(0).toLowerCase() + metricName.slice(1);
        (metrics.metrics as Record<string, number>)[metricKey] = value;
      }
    }

    return metrics;
  }

  /**
   * Get Performance Insights metrics for an RDS instance
   */
  async getPerformanceInsightsMetrics(options: {
    dbInstanceIdentifier: string;
    serviceType?: 'RDS';
    startTime: Date;
    endTime: Date;
    metricQueries?: Array<{
      metric: string;
      groupBy?: {
        group: string;
        dimensions?: string[];
        limit?: number;
      };
    }>;
    periodInSeconds?: number;
    region?: string;
  }): Promise<{
    alignedStartTime?: Date;
    alignedEndTime?: Date;
    metricList: Array<{
      key: {
        metric: string;
        dimensions?: Record<string, string>;
      };
      dataPoints: Array<{
        timestamp: Date;
        value: number;
      }>;
    }>;
  }> {
    const client = this.getPIClient(options.region);

    // First, we need to get the resource identifier
    const instance = await this.getInstance(
      options.dbInstanceIdentifier,
      options.region
    );
    
    if (!instance) {
      throw new Error(`Instance '${options.dbInstanceIdentifier}' not found`);
    }

    const resourceIdentifier = instance.dbInstanceArn
      .split(':')
      .pop()
      ?.replace('db:', 'db-') || options.dbInstanceIdentifier;

    type MetricQuery = {
      metric: string;
      groupBy?: {
        group: string;
        dimensions?: string[];
        limit?: number;
      };
    };

    const defaultMetricQueries: MetricQuery[] = [
      { metric: 'db.load.avg' },
      { metric: 'db.sampledload.avg' },
    ];

    const metricQueries: MetricQuery[] = options.metricQueries || defaultMetricQueries;

    const command = new GetResourceMetricsCommand({
      ServiceType: options.serviceType || 'RDS',
      Identifier: resourceIdentifier,
      StartTime: options.startTime,
      EndTime: options.endTime,
      PeriodInSeconds: options.periodInSeconds || 60,
      MetricQueries: metricQueries.map((q: MetricQuery) => {
        if (q.groupBy) {
          return {
            Metric: q.metric,
            GroupBy: {
              Group: q.groupBy.group,
              Dimensions: q.groupBy.dimensions,
              Limit: q.groupBy.limit,
            },
          };
        }
        return { Metric: q.metric };
      }),
    });

    const response = await this.withRetry(() => client.send(command), 'GetResourceMetrics');

    return {
      alignedStartTime: response.AlignedStartTime,
      alignedEndTime: response.AlignedEndTime,
      metricList: (response.MetricList || []).map((m) => ({
        key: {
          metric: (m.Key as ResponseResourceMetricKey)?.Metric || '',
          dimensions: (m.Key as ResponseResourceMetricKey)?.Dimensions as Record<string, string> | undefined,
        },
        dataPoints: (m.DataPoints || []).map((dp: PIDataPoint) => ({
          timestamp: dp.Timestamp || new Date(),
          value: dp.Value || 0,
        })),
      })),
    };
  }

  /**
   * Get top wait events from Performance Insights
   */
  async getTopWaitEvents(options: {
    dbInstanceIdentifier: string;
    startTime: Date;
    endTime: Date;
    limit?: number;
    region?: string;
  }): Promise<Array<{
    waitEvent: string;
    waitEventType: string;
    avgDbLoad: number;
  }>> {
    const client = this.getPIClient(options.region);

    const instance = await this.getInstance(
      options.dbInstanceIdentifier,
      options.region
    );
    
    if (!instance) {
      throw new Error(`Instance '${options.dbInstanceIdentifier}' not found`);
    }

    const resourceIdentifier = instance.dbInstanceArn
      .split(':')
      .pop()
      ?.replace('db:', 'db-') || options.dbInstanceIdentifier;

    const command = new DescribeDimensionKeysCommand({
      ServiceType: 'RDS',
      Identifier: resourceIdentifier,
      StartTime: options.startTime,
      EndTime: options.endTime,
      Metric: 'db.load.avg',
      GroupBy: {
        Group: 'db.wait_event',
        Limit: options.limit || 10,
      },
    });

    const response = await this.withRetry(() => client.send(command), 'DescribeDimensionKeys');

    return (response.Keys || []).map((key) => ({
      waitEvent: key.Dimensions?.['db.wait_event'] || '',
      waitEventType: key.Dimensions?.['db.wait_event_type'] || '',
      avgDbLoad: key.Total || 0,
    }));
  }

  /**
   * Configure enhanced monitoring for an RDS instance
   */
  async configureEnhancedMonitoring(
    options: RDSEnhancedMonitoringOptions
  ): Promise<RDSOperationResult> {
    return this.modifyInstance({
      dbInstanceIdentifier: options.dbInstanceIdentifier,
      monitoringInterval: options.monitoringInterval,
      monitoringRoleArn: options.monitoringRoleArn,
      applyImmediately: true,
      region: options.region,
    });
  }

  /**
   * Enable Performance Insights for an RDS instance
   */
  async enablePerformanceInsights(options: {
    dbInstanceIdentifier: string;
    performanceInsightsKMSKeyId?: string;
    performanceInsightsRetentionPeriod?: number;
    region?: string;
  }): Promise<RDSOperationResult> {
    return this.modifyInstance({
      dbInstanceIdentifier: options.dbInstanceIdentifier,
      enablePerformanceInsights: true,
      performanceInsightsKMSKeyId: options.performanceInsightsKMSKeyId,
      performanceInsightsRetentionPeriod:
        options.performanceInsightsRetentionPeriod || 7,
      applyImmediately: true,
      region: options.region,
    });
  }

  /**
   * Disable Performance Insights for an RDS instance
   */
  async disablePerformanceInsights(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<RDSOperationResult> {
    return this.modifyInstance({
      dbInstanceIdentifier,
      enablePerformanceInsights: false,
      applyImmediately: true,
      region,
    });
  }

  // ==========================================================================
  // 4. RDS Parameter Group Management
  // ==========================================================================

  /**
   * List RDS parameter groups
   */
  async listParameterGroups(options: {
    dbParameterGroupName?: string;
    filters?: Array<{ name: string; values: string[] }>;
    maxRecords?: number;
    region?: string;
  } = {}): Promise<RDSParameterGroup[]> {
    const client = this.getRDSClient(options.region);
    const groups: RDSParameterGroup[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBParameterGroupsCommand({
        DBParameterGroupName: options.dbParameterGroupName,
        Filters: options.filters?.map((f) => ({
          Name: f.name,
          Values: f.values,
        })),
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeDBParameterGroups');

      if (response.DBParameterGroups) {
        for (const group of response.DBParameterGroups) {
          groups.push(this.mapDBParameterGroup(group));
        }
      }

      marker = response.Marker;
    } while (marker);

    return groups;
  }

  /**
   * Get parameters for a parameter group
   */
  async getParameters(options: {
    dbParameterGroupName: string;
    source?: 'user' | 'system' | 'engine-default';
    maxRecords?: number;
    region?: string;
  }): Promise<RDSParameter[]> {
    const client = this.getRDSClient(options.region);
    const parameters: RDSParameter[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBParametersCommand({
        DBParameterGroupName: options.dbParameterGroupName,
        Source: options.source,
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeDBParameters');

      if (response.Parameters) {
        for (const param of response.Parameters) {
          parameters.push(this.mapParameter(param));
        }
      }

      marker = response.Marker;
    } while (marker);

    return parameters;
  }

  /**
   * Create a new parameter group
   */
  async createParameterGroup(
    options: RDSCreateParameterGroupOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new CreateDBParameterGroupCommand({
        DBParameterGroupName: options.dbParameterGroupName,
        DBParameterGroupFamily: options.dbParameterGroupFamily,
        Description: options.description,
        Tags: this.recordToTags(options.tags),
      });

      const response = await this.withRetry(() => client.send(command), 'CreateDBParameterGroup');
      const group = response.DBParameterGroup
        ? this.mapDBParameterGroup(response.DBParameterGroup)
        : null;

      return {
        success: true,
        message: `Parameter group '${options.dbParameterGroupName}' created`,
        data: group,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create parameter group '${options.dbParameterGroupName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete a parameter group
   */
  async deleteParameterGroup(
    dbParameterGroupName: string,
    region?: string
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(region);

    try {
      const command = new DeleteDBParameterGroupCommand({
        DBParameterGroupName: dbParameterGroupName,
      });

      await this.withRetry(() => client.send(command), 'DeleteDBParameterGroup');

      return {
        success: true,
        message: `Parameter group '${dbParameterGroupName}' deleted`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete parameter group '${dbParameterGroupName}'`,
        error: message,
      };
    }
  }

  /**
   * Modify parameters in a parameter group
   */
  async modifyParameterGroup(
    options: RDSModifyParameterGroupOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new ModifyDBParameterGroupCommand({
        DBParameterGroupName: options.dbParameterGroupName,
        Parameters: options.parameters.map((p) => ({
          ParameterName: p.parameterName,
          ParameterValue: p.parameterValue,
          ApplyMethod: p.applyMethod || 'immediate',
        })),
      });

      const response = await this.withRetry(() => client.send(command), 'ModifyDBParameterGroup');

      return {
        success: true,
        message: `Parameter group '${options.dbParameterGroupName}' modified`,
        data: {
          dbParameterGroupName: response.DBParameterGroupName,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to modify parameter group '${options.dbParameterGroupName}'`,
        error: message,
      };
    }
  }

  /**
   * Reset parameters in a parameter group to defaults
   */
  async resetParameterGroup(options: {
    dbParameterGroupName: string;
    resetAllParameters?: boolean;
    parameters?: Array<{
      parameterName: string;
      applyMethod?: 'immediate' | 'pending-reboot';
    }>;
    region?: string;
  }): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new ResetDBParameterGroupCommand({
        DBParameterGroupName: options.dbParameterGroupName,
        ResetAllParameters: options.resetAllParameters ?? false,
        Parameters: options.parameters?.map((p) => ({
          ParameterName: p.parameterName,
          ApplyMethod: p.applyMethod || 'immediate',
        })),
      });

      const response = await this.withRetry(() => client.send(command), 'ResetDBParameterGroup');

      return {
        success: true,
        message: `Parameter group '${options.dbParameterGroupName}' reset`,
        data: {
          dbParameterGroupName: response.DBParameterGroupName,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to reset parameter group '${options.dbParameterGroupName}'`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 5. RDS Subnet Group Management
  // ==========================================================================

  /**
   * List RDS subnet groups
   */
  async listSubnetGroups(options: {
    dbSubnetGroupName?: string;
    filters?: Array<{ name: string; values: string[] }>;
    maxRecords?: number;
    region?: string;
  } = {}): Promise<RDSSubnetGroup[]> {
    const client = this.getRDSClient(options.region);
    const groups: RDSSubnetGroup[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBSubnetGroupsCommand({
        DBSubnetGroupName: options.dbSubnetGroupName,
        Filters: options.filters?.map((f) => ({
          Name: f.name,
          Values: f.values,
        })),
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeDBSubnetGroups');

      if (response.DBSubnetGroups) {
        for (const group of response.DBSubnetGroups) {
          groups.push(this.mapDBSubnetGroup(group));
        }
      }

      marker = response.Marker;
    } while (marker);

    return groups;
  }

  /**
   * Create a new subnet group
   */
  async createSubnetGroup(
    options: RDSCreateSubnetGroupOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new CreateDBSubnetGroupCommand({
        DBSubnetGroupName: options.dbSubnetGroupName,
        DBSubnetGroupDescription: options.dbSubnetGroupDescription,
        SubnetIds: options.subnetIds,
        Tags: this.recordToTags(options.tags),
      });

      const response = await this.withRetry(() => client.send(command), 'CreateDBSubnetGroup');
      const group = response.DBSubnetGroup
        ? this.mapDBSubnetGroup(response.DBSubnetGroup)
        : null;

      return {
        success: true,
        message: `Subnet group '${options.dbSubnetGroupName}' created`,
        data: group,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create subnet group '${options.dbSubnetGroupName}'`,
        error: message,
      };
    }
  }

  /**
   * Modify a subnet group
   */
  async modifySubnetGroup(
    options: RDSModifySubnetGroupOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new ModifyDBSubnetGroupCommand({
        DBSubnetGroupName: options.dbSubnetGroupName,
        DBSubnetGroupDescription: options.dbSubnetGroupDescription,
        SubnetIds: options.subnetIds,
      });

      const response = await this.withRetry(() => client.send(command), 'ModifyDBSubnetGroup');
      const group = response.DBSubnetGroup
        ? this.mapDBSubnetGroup(response.DBSubnetGroup)
        : null;

      return {
        success: true,
        message: `Subnet group '${options.dbSubnetGroupName}' modified`,
        data: group,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to modify subnet group '${options.dbSubnetGroupName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete a subnet group
   */
  async deleteSubnetGroup(
    dbSubnetGroupName: string,
    region?: string
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(region);

    try {
      const command = new DeleteDBSubnetGroupCommand({
        DBSubnetGroupName: dbSubnetGroupName,
      });

      await this.withRetry(() => client.send(command), 'DeleteDBSubnetGroup');

      return {
        success: true,
        message: `Subnet group '${dbSubnetGroupName}' deleted`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete subnet group '${dbSubnetGroupName}'`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 6. RDS Backup and Maintenance Window Configuration
  // ==========================================================================

  /**
   * Get backup configuration for an RDS instance
   */
  async getBackupConfiguration(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<{
    dbInstanceIdentifier: string;
    backupRetentionPeriod: number;
    preferredBackupWindow: string;
    copyTagsToSnapshot: boolean;
    latestRestorableTime?: Date;
  } | null> {
    const instance = await this.getInstance(dbInstanceIdentifier, region);
    
    if (!instance) {
      return null;
    }

    return {
      dbInstanceIdentifier: instance.dbInstanceIdentifier,
      backupRetentionPeriod: instance.backupRetentionPeriod,
      preferredBackupWindow: instance.preferredBackupWindow || '',
      copyTagsToSnapshot: instance.copyTagsToSnapshot,
      latestRestorableTime: instance.latestRestorableTime,
    };
  }

  /**
   * Configure backup settings for an RDS instance
   */
  async setBackupConfiguration(
    options: RDSSetBackupConfigOptions
  ): Promise<RDSOperationResult> {
    return this.modifyInstance({
      dbInstanceIdentifier: options.dbInstanceIdentifier,
      backupRetentionPeriod: options.backupRetentionPeriod,
      preferredBackupWindow: options.preferredBackupWindow,
      copyTagsToSnapshot: options.copyTagsToSnapshot,
      applyImmediately: options.applyImmediately ?? false,
      region: options.region,
    });
  }

  /**
   * Get maintenance configuration for an RDS instance
   */
  async getMaintenanceConfiguration(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<{
    dbInstanceIdentifier: string;
    preferredMaintenanceWindow: string;
    autoMinorVersionUpgrade: boolean;
    pendingMaintenanceActions: Array<{
      action: string;
      autoAppliedAfterDate?: Date;
      forcedApplyDate?: Date;
      optInStatus?: string;
      currentApplyDate?: Date;
      description?: string;
    }>;
  } | null> {
    const instance = await this.getInstance(dbInstanceIdentifier, region);
    
    if (!instance) {
      return null;
    }

    // Get pending maintenance actions
    const client = this.getRDSClient(region);
    const maintenanceCommand = new DescribePendingMaintenanceActionsCommand({
      ResourceIdentifier: instance.dbInstanceArn,
    });

    let pendingActions: Array<{
      action: string;
      autoAppliedAfterDate?: Date;
      forcedApplyDate?: Date;
      optInStatus?: string;
      currentApplyDate?: Date;
      description?: string;
    }> = [];

    try {
      const maintenanceResponse = await this.withRetry(() => client.send(maintenanceCommand), 'DescribePendingMaintenanceActions');
      const resourceActions = maintenanceResponse.PendingMaintenanceActions?.[0];
      
      if (resourceActions?.PendingMaintenanceActionDetails) {
        pendingActions = resourceActions.PendingMaintenanceActionDetails.map((a) => ({
          action: a.Action || '',
          autoAppliedAfterDate: a.AutoAppliedAfterDate,
          forcedApplyDate: a.ForcedApplyDate,
          optInStatus: a.OptInStatus,
          currentApplyDate: a.CurrentApplyDate,
          description: a.Description,
        }));
      }
    } catch {
      // Ignore errors fetching maintenance actions
    }

    return {
      dbInstanceIdentifier: instance.dbInstanceIdentifier,
      preferredMaintenanceWindow: instance.preferredMaintenanceWindow || '',
      autoMinorVersionUpgrade: instance.autoMinorVersionUpgrade,
      pendingMaintenanceActions: pendingActions,
    };
  }

  /**
   * Configure maintenance settings for an RDS instance
   */
  async setMaintenanceConfiguration(
    options: RDSSetMaintenanceConfigOptions
  ): Promise<RDSOperationResult> {
    return this.modifyInstance({
      dbInstanceIdentifier: options.dbInstanceIdentifier,
      preferredMaintenanceWindow: options.preferredMaintenanceWindow,
      autoMinorVersionUpgrade: options.autoMinorVersionUpgrade,
      applyImmediately: options.applyImmediately ?? false,
      region: options.region,
    });
  }

  /**
   * Apply pending maintenance action
   */
  async applyPendingMaintenanceAction(options: {
    dbInstanceIdentifier: string;
    applyAction: string;
    optInType: 'immediate' | 'next-maintenance' | 'undo-opt-in';
    region?: string;
  }): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      // Get the instance ARN
      const instance = await this.getInstance(
        options.dbInstanceIdentifier,
        options.region
      );
      
      if (!instance) {
        return {
          success: false,
          message: `Instance '${options.dbInstanceIdentifier}' not found`,
        };
      }

      const command = new ApplyPendingMaintenanceActionCommand({
        ResourceIdentifier: instance.dbInstanceArn,
        ApplyAction: options.applyAction,
        OptInType: options.optInType,
      });

      const response = await this.withRetry(() => client.send(command), 'ApplyPendingMaintenanceAction');

      return {
        success: true,
        message: `Maintenance action '${options.applyAction}' applied`,
        data: response.ResourcePendingMaintenanceActions,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to apply maintenance action '${options.applyAction}'`,
        error: message,
      };
    }
  }

  /**
   * List automated backups
   */
  async listAutomatedBackups(options: {
    dbInstanceIdentifier?: string;
    dbiResourceId?: string;
    maxRecords?: number;
    region?: string;
  } = {}): Promise<RDSAutomatedBackup[]> {
    const client = this.getRDSClient(options.region);
    const backups: RDSAutomatedBackup[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBInstanceAutomatedBackupsCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        DbiResourceId: options.dbiResourceId,
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeDBInstanceAutomatedBackups');

      if (response.DBInstanceAutomatedBackups) {
        for (const backup of response.DBInstanceAutomatedBackups) {
          backups.push(this.mapAutomatedBackup(backup));
        }
      }

      marker = response.Marker;
    } while (marker);

    return backups;
  }

  /**
   * Delete an automated backup
   */
  async deleteAutomatedBackup(
    dbiResourceId: string,
    region?: string
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(region);

    try {
      const command = new DeleteDBInstanceAutomatedBackupCommand({
        DbiResourceId: dbiResourceId,
      });

      const response = await this.withRetry(() => client.send(command), 'DeleteDBInstanceAutomatedBackup');
      const backup = response.DBInstanceAutomatedBackup
        ? this.mapAutomatedBackup(response.DBInstanceAutomatedBackup)
        : null;

      return {
        success: true,
        message: `Automated backup '${dbiResourceId}' deleted`,
        data: backup,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete automated backup '${dbiResourceId}'`,
        error: message,
      };
    }
  }

  /**
   * Start cross-region automated backup replication
   */
  async startAutomatedBackupsReplication(options: {
    sourceDBInstanceArn: string;
    kmsKeyId?: string;
    backupRetentionPeriod?: number;
    region?: string;
  }): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new StartDBInstanceAutomatedBackupsReplicationCommand({
        SourceDBInstanceArn: options.sourceDBInstanceArn,
        KmsKeyId: options.kmsKeyId,
        BackupRetentionPeriod: options.backupRetentionPeriod,
      });

      const response = await this.withRetry(() => client.send(command), 'StartDBInstanceAutomatedBackupsReplication');
      const backup = response.DBInstanceAutomatedBackup
        ? this.mapAutomatedBackup(response.DBInstanceAutomatedBackup)
        : null;

      return {
        success: true,
        message: 'Automated backup replication started',
        data: backup,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Failed to start automated backup replication',
        error: message,
      };
    }
  }

  /**
   * Stop cross-region automated backup replication
   */
  async stopAutomatedBackupsReplication(
    sourceDBInstanceArn: string,
    region?: string
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(region);

    try {
      const command = new StopDBInstanceAutomatedBackupsReplicationCommand({
        SourceDBInstanceArn: sourceDBInstanceArn,
      });

      const response = await this.withRetry(() => client.send(command), 'StopDBInstanceAutomatedBackupsReplication');
      const backup = response.DBInstanceAutomatedBackup
        ? this.mapAutomatedBackup(response.DBInstanceAutomatedBackup)
        : null;

      return {
        success: true,
        message: 'Automated backup replication stopped',
        data: backup,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Failed to stop automated backup replication',
        error: message,
      };
    }
  }

  // ==========================================================================
  // 7. RDS Read Replica Management
  // ==========================================================================

  /**
   * Create a read replica of an RDS instance
   */
  async createReadReplica(
    options: RDSCreateReadReplicaOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new CreateDBInstanceReadReplicaCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        SourceDBInstanceIdentifier: options.sourceDBInstanceIdentifier,
        DBInstanceClass: options.dbInstanceClass,
        AvailabilityZone: options.availabilityZone,
        Port: options.port,
        MultiAZ: options.multiAZ,
        AutoMinorVersionUpgrade: options.autoMinorVersionUpgrade,
        Iops: options.iops,
        OptionGroupName: options.optionGroupName,
        DBParameterGroupName: options.dbParameterGroupName,
        PubliclyAccessible: options.publiclyAccessible,
        StorageType: options.storageType,
        StorageThroughput: options.storageThroughput,
        CopyTagsToSnapshot: options.copyTagsToSnapshot,
        MonitoringInterval: options.monitoringInterval,
        MonitoringRoleArn: options.monitoringRoleArn,
        KmsKeyId: options.kmsKeyId,
        EnablePerformanceInsights: options.enablePerformanceInsights,
        PerformanceInsightsKMSKeyId: options.performanceInsightsKMSKeyId,
        PerformanceInsightsRetentionPeriod: options.performanceInsightsRetentionPeriod,
        EnableIAMDatabaseAuthentication: options.enableIAMDatabaseAuthentication,
        DeletionProtection: options.deletionProtection,
        DBSubnetGroupName: options.dbSubnetGroupName,
        VpcSecurityGroupIds: options.vpcSecurityGroupIds,
        MaxAllocatedStorage: options.maxAllocatedStorage,
        ReplicaMode: options.replicaMode,
        NetworkType: options.networkType,
        Tags: this.recordToTags(options.tags),
        // Note: For cross-region replica, use PreSignedUrl instead of SourceRegion
      });

      const response = await this.withRetry(() => client.send(command), 'CreateDBInstanceReadReplica');
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `Read replica '${options.dbInstanceIdentifier}' creation initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create read replica '${options.dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Promote a read replica to a standalone instance
   */
  async promoteReadReplica(
    options: RDSPromoteReadReplicaOptions
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new PromoteReadReplicaCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        BackupRetentionPeriod: options.backupRetentionPeriod,
        PreferredBackupWindow: options.preferredBackupWindow,
      });

      const response = await this.withRetry(() => client.send(command), 'PromoteReadReplica');
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `Read replica '${options.dbInstanceIdentifier}' promotion initiated`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to promote read replica '${options.dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * List read replicas for an RDS instance
   */
  async listReadReplicas(
    sourceDBInstanceIdentifier: string,
    region?: string
  ): Promise<RDSInstance[]> {
    const sourceInstance = await this.getInstance(
      sourceDBInstanceIdentifier,
      region
    );

    if (!sourceInstance) {
      return [];
    }

    const replicaIds = sourceInstance.readReplicaDBInstanceIdentifiers;
    
    if (replicaIds.length === 0) {
      return [];
    }

    const replicas: RDSInstance[] = [];
    
    for (const replicaId of replicaIds) {
      const replica = await this.getInstance(replicaId, region);
      if (replica) {
        replicas.push(replica);
      }
    }

    return replicas;
  }

  /**
   * Get replication status for a read replica
   */
  async getReplicaStatus(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<{
    dbInstanceIdentifier: string;
    isReplica: boolean;
    sourceDBInstanceIdentifier?: string;
    replicaMode?: string;
    status: string;
    replicaLag?: number;
  } | null> {
    const instance = await this.getInstance(dbInstanceIdentifier, region);

    if (!instance) {
      return null;
    }

    const isReplica = !!instance.readReplicaSourceDBInstanceIdentifier;

    return {
      dbInstanceIdentifier: instance.dbInstanceIdentifier,
      isReplica,
      sourceDBInstanceIdentifier: instance.readReplicaSourceDBInstanceIdentifier,
      replicaMode: instance.replicaMode,
      status: instance.status,
      // Note: Replica lag would require CloudWatch metrics
    };
  }

  // ==========================================================================
  // 8. RDS Multi-AZ Failover Operations
  // ==========================================================================

  /**
   * Reboot an RDS instance with optional failover
   */
  async rebootInstance(options: RDSRebootOptions): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new RebootDBInstanceCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        ForceFailover: options.forceFailover,
      });

      const response = await this.withRetry(() => client.send(command), 'RebootDBInstance');
      const instance = response.DBInstance
        ? this.mapDBInstance(response.DBInstance)
        : null;

      return {
        success: true,
        message: `RDS instance '${options.dbInstanceIdentifier}' reboot initiated${options.forceFailover ? ' with failover' : ''}`,
        data: instance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to reboot RDS instance '${options.dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  /**
   * Force a Multi-AZ failover (reboot with failover)
   */
  async forceFailover(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<RDSOperationResult> {
    // First, verify the instance is Multi-AZ
    const instance = await this.getInstance(dbInstanceIdentifier, region);
    
    if (!instance) {
      return {
        success: false,
        message: `Instance '${dbInstanceIdentifier}' not found`,
      };
    }

    if (!instance.multiAZ) {
      return {
        success: false,
        message: `Instance '${dbInstanceIdentifier}' is not a Multi-AZ deployment`,
      };
    }

    return this.rebootInstance({
      dbInstanceIdentifier,
      forceFailover: true,
      region,
    });
  }

  /**
   * Get Multi-AZ status for an RDS instance
   */
  async getMultiAZStatus(
    dbInstanceIdentifier: string,
    region?: string
  ): Promise<{
    dbInstanceIdentifier: string;
    multiAZ: boolean;
    primaryAvailabilityZone?: string;
    secondaryAvailabilityZone?: string;
    status: string;
  } | null> {
    const instance = await this.getInstance(dbInstanceIdentifier, region);

    if (!instance) {
      return null;
    }

    return {
      dbInstanceIdentifier: instance.dbInstanceIdentifier,
      multiAZ: instance.multiAZ,
      primaryAvailabilityZone: instance.availabilityZone,
      secondaryAvailabilityZone: instance.secondaryAvailabilityZone,
      status: instance.status,
    };
  }

  /**
   * Convert a single-AZ instance to Multi-AZ
   */
  async enableMultiAZ(
    dbInstanceIdentifier: string,
    options: {
      applyImmediately?: boolean;
      region?: string;
    } = {}
  ): Promise<RDSOperationResult> {
    return this.modifyInstance({
      dbInstanceIdentifier,
      multiAZ: true,
      applyImmediately: options.applyImmediately ?? false,
      region: options.region,
    });
  }

  /**
   * Convert a Multi-AZ instance to single-AZ
   */
  async disableMultiAZ(
    dbInstanceIdentifier: string,
    options: {
      applyImmediately?: boolean;
      region?: string;
    } = {}
  ): Promise<RDSOperationResult> {
    return this.modifyInstance({
      dbInstanceIdentifier,
      multiAZ: false,
      applyImmediately: options.applyImmediately ?? false,
      region: options.region,
    });
  }

  /**
   * Failover a DB cluster (for Aurora)
   */
  async failoverDBCluster(options: RDSFailoverOptions): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new FailoverDBClusterCommand({
        DBClusterIdentifier: options.dbInstanceIdentifier,
        TargetDBInstanceIdentifier: options.targetDBInstanceIdentifier,
      });

      const response = await this.withRetry(() => client.send(command), 'FailoverDBCluster');

      return {
        success: true,
        message: `DB cluster '${options.dbInstanceIdentifier}' failover initiated`,
        data: response.DBCluster,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to failover DB cluster '${options.dbInstanceIdentifier}'`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // Events and Logs
  // ==========================================================================

  /**
   * List RDS events
   */
  async listEvents(options: RDSListEventsOptions = {}): Promise<RDSEvent[]> {
    const client = this.getRDSClient(options.region);
    const events: RDSEvent[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeEventsCommand({
        SourceIdentifier: options.sourceIdentifier,
        SourceType: options.sourceType,
        StartTime: options.startTime,
        EndTime: options.endTime,
        Duration: options.duration,
        EventCategories: options.eventCategories,
        Filters: options.filters?.map((f) => ({
          Name: f.name,
          Values: f.values,
        })),
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeEvents');

      if (response.Events) {
        for (const event of response.Events) {
          events.push(this.mapEvent(event));
        }
      }

      marker = response.Marker;
    } while (marker);

    return events;
  }

  /**
   * Get available event categories
   */
  async getEventCategories(options: {
    sourceType?: string;
    region?: string;
  } = {}): Promise<Array<{
    sourceType: string;
    eventCategories: string[];
  }>> {
    const client = this.getRDSClient(options.region);

    const command = new DescribeEventCategoriesCommand({
      SourceType: options.sourceType,
    });

    const response = await this.withRetry(() => client.send(command), 'DescribeEventCategories');

    return (response.EventCategoriesMapList || []).map((m) => ({
      sourceType: m.SourceType || '',
      eventCategories: m.EventCategories || [],
    }));
  }

  /**
   * Create an event subscription
   */
  async createEventSubscription(options: {
    subscriptionName: string;
    snsTopicArn: string;
    sourceType?: string;
    sourceIds?: string[];
    eventCategories?: string[];
    enabled?: boolean;
    tags?: Record<string, string>;
    region?: string;
  }): Promise<RDSOperationResult> {
    const client = this.getRDSClient(options.region);

    try {
      const command = new CreateEventSubscriptionCommand({
        SubscriptionName: options.subscriptionName,
        SnsTopicArn: options.snsTopicArn,
        SourceType: options.sourceType,
        SourceIds: options.sourceIds,
        EventCategories: options.eventCategories,
        Enabled: options.enabled ?? true,
        Tags: this.recordToTags(options.tags),
      });

      const response = await this.withRetry(() => client.send(command), 'CreateEventSubscription');
      const subscription = response.EventSubscription
        ? this.mapEventSubscription(response.EventSubscription)
        : null;

      return {
        success: true,
        message: `Event subscription '${options.subscriptionName}' created`,
        data: subscription,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create event subscription '${options.subscriptionName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete an event subscription
   */
  async deleteEventSubscription(
    subscriptionName: string,
    region?: string
  ): Promise<RDSOperationResult> {
    const client = this.getRDSClient(region);

    try {
      const command = new DeleteEventSubscriptionCommand({
        SubscriptionName: subscriptionName,
      });

      const response = await this.withRetry(() => client.send(command), 'DeleteEventSubscription');
      const subscription = response.EventSubscription
        ? this.mapEventSubscription(response.EventSubscription)
        : null;

      return {
        success: true,
        message: `Event subscription '${subscriptionName}' deleted`,
        data: subscription,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete event subscription '${subscriptionName}'`,
        error: message,
      };
    }
  }

  /**
   * List event subscriptions
   */
  async listEventSubscriptions(options: {
    subscriptionName?: string;
    filters?: Array<{ name: string; values: string[] }>;
    maxRecords?: number;
    region?: string;
  } = {}): Promise<RDSEventSubscription[]> {
    const client = this.getRDSClient(options.region);
    const subscriptions: RDSEventSubscription[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeEventSubscriptionsCommand({
        SubscriptionName: options.subscriptionName,
        Filters: options.filters?.map((f) => ({
          Name: f.name,
          Values: f.values,
        })),
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeEventSubscriptions');

      if (response.EventSubscriptionsList) {
        for (const sub of response.EventSubscriptionsList) {
          subscriptions.push(this.mapEventSubscription(sub));
        }
      }

      marker = response.Marker;
    } while (marker);

    return subscriptions;
  }

  /**
   * List log files for an RDS instance
   */
  async listLogFiles(options: {
    dbInstanceIdentifier: string;
    filenameContains?: string;
    fileLastWritten?: number;
    fileSize?: number;
    maxRecords?: number;
    region?: string;
  }): Promise<RDSLogFile[]> {
    const client = this.getRDSClient(options.region);
    const logFiles: RDSLogFile[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBLogFilesCommand({
        DBInstanceIdentifier: options.dbInstanceIdentifier,
        FilenameContains: options.filenameContains,
        FileLastWritten: options.fileLastWritten,
        FileSize: options.fileSize,
        MaxRecords: options.maxRecords || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeDBLogFiles');

      if (response.DescribeDBLogFiles) {
        for (const file of response.DescribeDBLogFiles) {
          logFiles.push({
            logFileName: (file as DescribeDBLogFilesDetails).LogFileName || '',
            lastWritten: (file as DescribeDBLogFilesDetails).LastWritten,
            size: (file as DescribeDBLogFilesDetails).Size || 0,
          });
        }
      }

      marker = response.Marker;
    } while (marker);

    return logFiles;
  }

  /**
   * Download a portion of a log file
   */
  async downloadLogFilePortion(
    options: RDSDownloadLogOptions
  ): Promise<{
    logFileData: string;
    marker?: string;
    additionalDataPending: boolean;
  }> {
    const client = this.getRDSClient(options.region);

    const command = new DownloadDBLogFilePortionCommand({
      DBInstanceIdentifier: options.dbInstanceIdentifier,
      LogFileName: options.logFileName,
      Marker: options.marker,
      NumberOfLines: options.numberOfLines,
    });

    const response = await this.withRetry(() => client.send(command), 'DownloadDBLogFilePortion');

    return {
      logFileData: response.LogFileData || '',
      marker: response.Marker,
      additionalDataPending: response.AdditionalDataPending || false,
    };
  }
}

// Export singleton factory
export function createRDSManager(config?: RDSClientConfig): RDSManager {
  return new RDSManager(config);
}
