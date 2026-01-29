/**
 * AWS RDS Types
 * Comprehensive type definitions for RDS operations
 */

// ============================================================================
// Core RDS Types
// ============================================================================

export interface RDSClientConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export interface RDSOperationResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

// ============================================================================
// RDS Instance Types
// ============================================================================

export interface RDSInstance {
  dbInstanceIdentifier: string;
  dbInstanceClass: string;
  engine: string;
  engineVersion: string;
  status: string;
  endpoint?: {
    address: string;
    port: number;
    hostedZoneId?: string;
  };
  allocatedStorage: number;
  storageType: string;
  storageEncrypted: boolean;
  kmsKeyId?: string;
  multiAZ: boolean;
  availabilityZone?: string;
  secondaryAvailabilityZone?: string;
  publiclyAccessible: boolean;
  autoMinorVersionUpgrade: boolean;
  masterUsername: string;
  dbName?: string;
  vpcSecurityGroups: Array<{
    vpcSecurityGroupId: string;
    status: string;
  }>;
  dbSubnetGroup?: {
    dbSubnetGroupName: string;
    dbSubnetGroupDescription: string;
    vpcId: string;
    subnetGroupStatus: string;
  };
  dbParameterGroups: Array<{
    dbParameterGroupName: string;
    parameterApplyStatus: string;
  }>;
  backupRetentionPeriod: number;
  preferredBackupWindow?: string;
  preferredMaintenanceWindow?: string;
  latestRestorableTime?: Date;
  iops?: number;
  storageThroughput?: number;
  licenseModel?: string;
  readReplicaSourceDBInstanceIdentifier?: string;
  readReplicaDBInstanceIdentifiers: string[];
  replicaMode?: string;
  performanceInsightsEnabled: boolean;
  performanceInsightsKMSKeyId?: string;
  performanceInsightsRetentionPeriod?: number;
  enhancedMonitoringResourceArn?: string;
  monitoringInterval?: number;
  monitoringRoleArn?: string;
  deletionProtection: boolean;
  dbInstanceArn: string;
  tags: Record<string, string>;
  instanceCreateTime?: Date;
  caCertificateIdentifier?: string;
  copyTagsToSnapshot: boolean;
  iamDatabaseAuthenticationEnabled: boolean;
  maxAllocatedStorage?: number;
  networkType?: string;
}

export interface RDSCreateInstanceOptions {
  dbInstanceIdentifier: string;
  dbInstanceClass: string;
  engine: RDSEngine;
  engineVersion?: string;
  masterUsername: string;
  masterUserPassword: string;
  dbName?: string;
  allocatedStorage: number;
  storageType?: 'gp2' | 'gp3' | 'io1' | 'io2' | 'standard';
  iops?: number;
  storageThroughput?: number;
  storageEncrypted?: boolean;
  kmsKeyId?: string;
  multiAZ?: boolean;
  availabilityZone?: string;
  dbSubnetGroupName?: string;
  vpcSecurityGroupIds?: string[];
  dbParameterGroupName?: string;
  optionGroupName?: string;
  backupRetentionPeriod?: number;
  preferredBackupWindow?: string;
  preferredMaintenanceWindow?: string;
  port?: number;
  publiclyAccessible?: boolean;
  autoMinorVersionUpgrade?: boolean;
  licenseModel?: string;
  enablePerformanceInsights?: boolean;
  performanceInsightsKMSKeyId?: string;
  performanceInsightsRetentionPeriod?: number;
  monitoringInterval?: number;
  monitoringRoleArn?: string;
  enableIAMDatabaseAuthentication?: boolean;
  deletionProtection?: boolean;
  copyTagsToSnapshot?: boolean;
  maxAllocatedStorage?: number;
  networkType?: 'IPV4' | 'DUAL';
  tags?: Record<string, string>;
  region?: string;
}

export interface RDSModifyInstanceOptions {
  dbInstanceIdentifier: string;
  dbInstanceClass?: string;
  allocatedStorage?: number;
  storageType?: 'gp2' | 'gp3' | 'io1' | 'io2' | 'standard';
  iops?: number;
  storageThroughput?: number;
  masterUserPassword?: string;
  dbParameterGroupName?: string;
  backupRetentionPeriod?: number;
  preferredBackupWindow?: string;
  preferredMaintenanceWindow?: string;
  multiAZ?: boolean;
  engineVersion?: string;
  autoMinorVersionUpgrade?: boolean;
  publiclyAccessible?: boolean;
  vpcSecurityGroupIds?: string[];
  dbSubnetGroupName?: string;
  monitoringInterval?: number;
  monitoringRoleArn?: string;
  enablePerformanceInsights?: boolean;
  performanceInsightsKMSKeyId?: string;
  performanceInsightsRetentionPeriod?: number;
  enableIAMDatabaseAuthentication?: boolean;
  deletionProtection?: boolean;
  copyTagsToSnapshot?: boolean;
  maxAllocatedStorage?: number;
  applyImmediately?: boolean;
  region?: string;
}

export type RDSEngine =
  | 'mysql'
  | 'mariadb'
  | 'postgres'
  | 'oracle-ee'
  | 'oracle-se2'
  | 'oracle-se2-cdb'
  | 'sqlserver-ee'
  | 'sqlserver-se'
  | 'sqlserver-ex'
  | 'sqlserver-web'
  | 'aurora-mysql'
  | 'aurora-postgresql';

// ============================================================================
// RDS Snapshot Types
// ============================================================================

export interface RDSSnapshot {
  dbSnapshotIdentifier: string;
  dbInstanceIdentifier: string;
  snapshotCreateTime?: Date;
  engine: string;
  engineVersion: string;
  status: string;
  allocatedStorage: number;
  storageType: string;
  availabilityZone?: string;
  vpcId?: string;
  instanceCreateTime?: Date;
  masterUsername: string;
  port: number;
  snapshotType: string;
  iops?: number;
  optionGroupName?: string;
  percentProgress: number;
  sourceRegion?: string;
  sourceDBSnapshotIdentifier?: string;
  encrypted: boolean;
  kmsKeyId?: string;
  dbSnapshotArn: string;
  timezone?: string;
  iamDatabaseAuthenticationEnabled: boolean;
  processorFeatures: Array<{
    name: string;
    value: string;
  }>;
  dbiResourceId?: string;
  tags: Record<string, string>;
  originalSnapshotCreateTime?: Date;
  snapshotDatabaseTime?: Date;
  snapshotTarget?: string;
  storageThroughput?: number;
}

export interface RDSCreateSnapshotOptions {
  dbSnapshotIdentifier: string;
  dbInstanceIdentifier: string;
  tags?: Record<string, string>;
  region?: string;
}

export interface RDSRestoreFromSnapshotOptions {
  dbInstanceIdentifier: string;
  dbSnapshotIdentifier: string;
  dbInstanceClass?: string;
  port?: number;
  availabilityZone?: string;
  dbSubnetGroupName?: string;
  multiAZ?: boolean;
  publiclyAccessible?: boolean;
  autoMinorVersionUpgrade?: boolean;
  licenseModel?: string;
  dbName?: string;
  engine?: string;
  iops?: number;
  optionGroupName?: string;
  storageType?: 'gp2' | 'gp3' | 'io1' | 'io2' | 'standard';
  storageThroughput?: number;
  vpcSecurityGroupIds?: string[];
  dbParameterGroupName?: string;
  deletionProtection?: boolean;
  enableIAMDatabaseAuthentication?: boolean;
  enablePerformanceInsights?: boolean;
  performanceInsightsKMSKeyId?: string;
  performanceInsightsRetentionPeriod?: number;
  copyTagsToSnapshot?: boolean;
  tags?: Record<string, string>;
  region?: string;
}

export interface RDSCopySnapshotOptions {
  sourceDBSnapshotIdentifier: string;
  targetDBSnapshotIdentifier: string;
  kmsKeyId?: string;
  copyTags?: boolean;
  optionGroupName?: string;
  tags?: Record<string, string>;
  sourceRegion?: string;
  region?: string;
}

// ============================================================================
// RDS Parameter Group Types
// ============================================================================

export interface RDSParameterGroup {
  dbParameterGroupName: string;
  dbParameterGroupFamily: string;
  description: string;
  dbParameterGroupArn: string;
  tags: Record<string, string>;
}

export interface RDSParameter {
  parameterName: string;
  parameterValue?: string;
  description?: string;
  source?: string;
  applyType?: string;
  dataType?: string;
  allowedValues?: string;
  isModifiable: boolean;
  minimumEngineVersion?: string;
  applyMethod?: 'immediate' | 'pending-reboot';
  supportedEngineModes: string[];
}

export interface RDSCreateParameterGroupOptions {
  dbParameterGroupName: string;
  dbParameterGroupFamily: string;
  description: string;
  tags?: Record<string, string>;
  region?: string;
}

export interface RDSModifyParameterGroupOptions {
  dbParameterGroupName: string;
  parameters: Array<{
    parameterName: string;
    parameterValue: string;
    applyMethod?: 'immediate' | 'pending-reboot';
  }>;
  region?: string;
}

// ============================================================================
// RDS Subnet Group Types
// ============================================================================

export interface RDSSubnetGroup {
  dbSubnetGroupName: string;
  dbSubnetGroupDescription: string;
  vpcId: string;
  subnetGroupStatus: string;
  subnets: Array<{
    subnetIdentifier: string;
    subnetAvailabilityZone: {
      name: string;
    };
    subnetOutpost?: {
      arn: string;
    };
    subnetStatus: string;
  }>;
  dbSubnetGroupArn: string;
  supportedNetworkTypes: string[];
  tags: Record<string, string>;
}

export interface RDSCreateSubnetGroupOptions {
  dbSubnetGroupName: string;
  dbSubnetGroupDescription: string;
  subnetIds: string[];
  tags?: Record<string, string>;
  region?: string;
}

export interface RDSModifySubnetGroupOptions {
  dbSubnetGroupName: string;
  dbSubnetGroupDescription?: string;
  subnetIds: string[];
  region?: string;
}

// ============================================================================
// RDS Performance Monitoring Types
// ============================================================================

export interface RDSPerformanceMetrics {
  dbInstanceIdentifier: string;
  timestamp: Date;
  metrics: {
    cpuUtilization?: number;
    freeableMemory?: number;
    freeStorageSpace?: number;
    readIOPS?: number;
    writeIOPS?: number;
    readLatency?: number;
    writeLatency?: number;
    readThroughput?: number;
    writeThroughput?: number;
    networkReceiveThroughput?: number;
    networkTransmitThroughput?: number;
    databaseConnections?: number;
    swapUsage?: number;
    diskQueueDepth?: number;
    burstBalance?: number;
    cpuCreditUsage?: number;
    cpuCreditBalance?: number;
    ebsBytesBalance?: number;
    ebsIOBalance?: number;
  };
}

export interface RDSPerformanceInsightsMetrics {
  dbInstanceIdentifier: string;
  startTime: Date;
  endTime: Date;
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
}

export interface RDSGetMetricsOptions {
  dbInstanceIdentifier: string;
  metricNames?: string[];
  startTime: Date;
  endTime: Date;
  period?: number;
  statistics?: Array<'Average' | 'Sum' | 'Minimum' | 'Maximum' | 'SampleCount'>;
  region?: string;
}

export interface RDSEnhancedMonitoringOptions {
  dbInstanceIdentifier: string;
  monitoringInterval: 0 | 1 | 5 | 10 | 15 | 30 | 60;
  monitoringRoleArn?: string;
  region?: string;
}

// ============================================================================
// RDS Read Replica Types
// ============================================================================

export interface RDSCreateReadReplicaOptions {
  dbInstanceIdentifier: string;
  sourceDBInstanceIdentifier: string;
  dbInstanceClass?: string;
  availabilityZone?: string;
  port?: number;
  multiAZ?: boolean;
  autoMinorVersionUpgrade?: boolean;
  iops?: number;
  optionGroupName?: string;
  dbParameterGroupName?: string;
  publiclyAccessible?: boolean;
  storageType?: 'gp2' | 'gp3' | 'io1' | 'io2' | 'standard';
  storageThroughput?: number;
  copyTagsToSnapshot?: boolean;
  monitoringInterval?: number;
  monitoringRoleArn?: string;
  kmsKeyId?: string;
  enablePerformanceInsights?: boolean;
  performanceInsightsKMSKeyId?: string;
  performanceInsightsRetentionPeriod?: number;
  enableIAMDatabaseAuthentication?: boolean;
  deletionProtection?: boolean;
  dbSubnetGroupName?: string;
  vpcSecurityGroupIds?: string[];
  maxAllocatedStorage?: number;
  replicaMode?: 'open-read-only' | 'mounted';
  networkType?: 'IPV4' | 'DUAL';
  tags?: Record<string, string>;
  sourceRegion?: string;
  region?: string;
}

export interface RDSPromoteReadReplicaOptions {
  dbInstanceIdentifier: string;
  backupRetentionPeriod?: number;
  preferredBackupWindow?: string;
  region?: string;
}

// ============================================================================
// RDS Multi-AZ and Failover Types
// ============================================================================

export interface RDSFailoverOptions {
  dbInstanceIdentifier: string;
  targetDBInstanceIdentifier?: string;
  region?: string;
}

export interface RDSRebootOptions {
  dbInstanceIdentifier: string;
  forceFailover?: boolean;
  region?: string;
}

// ============================================================================
// RDS Backup and Maintenance Types
// ============================================================================

export interface RDSBackupConfiguration {
  dbInstanceIdentifier: string;
  backupRetentionPeriod: number;
  preferredBackupWindow: string;
  copyTagsToSnapshot: boolean;
  deleteAutomatedBackups?: boolean;
}

export interface RDSMaintenanceConfiguration {
  dbInstanceIdentifier: string;
  preferredMaintenanceWindow: string;
  autoMinorVersionUpgrade: boolean;
}

export interface RDSSetBackupConfigOptions {
  dbInstanceIdentifier: string;
  backupRetentionPeriod: number;
  preferredBackupWindow?: string;
  copyTagsToSnapshot?: boolean;
  applyImmediately?: boolean;
  region?: string;
}

export interface RDSSetMaintenanceConfigOptions {
  dbInstanceIdentifier: string;
  preferredMaintenanceWindow: string;
  autoMinorVersionUpgrade?: boolean;
  applyImmediately?: boolean;
  region?: string;
}

// ============================================================================
// RDS Event Types
// ============================================================================

export interface RDSEvent {
  sourceIdentifier?: string;
  sourceType?: string;
  message?: string;
  eventCategories: string[];
  date?: Date;
  sourceArn?: string;
}

export interface RDSEventSubscription {
  customerAwsId?: string;
  custSubscriptionId?: string;
  snsTopicArn?: string;
  status?: string;
  subscriptionCreationTime?: string;
  sourceType?: string;
  sourceIdsList: string[];
  eventCategoriesList: string[];
  enabled: boolean;
  eventSubscriptionArn?: string;
}

export interface RDSListEventsOptions {
  sourceIdentifier?: string;
  sourceType?: 'db-instance' | 'db-parameter-group' | 'db-security-group' | 'db-snapshot' | 'db-cluster' | 'db-cluster-snapshot';
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  eventCategories?: string[];
  filters?: Array<{
    name: string;
    values: string[];
  }>;
  maxRecords?: number;
  region?: string;
}

// ============================================================================
// RDS Option Group Types
// ============================================================================

export interface RDSOptionGroup {
  optionGroupName: string;
  optionGroupDescription: string;
  engineName: string;
  majorEngineVersion: string;
  options: Array<{
    optionName: string;
    optionDescription: string;
    persistent: boolean;
    permanent: boolean;
    port?: number;
    optionVersion?: string;
    optionSettings: Array<{
      name: string;
      value: string;
      defaultValue?: string;
      description?: string;
      applyType?: string;
      dataType?: string;
      allowedValues?: string;
      isModifiable: boolean;
      isCollection: boolean;
    }>;
    dbSecurityGroupMemberships: Array<{
      dbSecurityGroupName: string;
      status: string;
    }>;
    vpcSecurityGroupMemberships: Array<{
      vpcSecurityGroupId: string;
      status: string;
    }>;
  }>;
  allowsVpcAndNonVpcInstanceMemberships: boolean;
  vpcId?: string;
  optionGroupArn: string;
  sourceOptionGroup?: string;
  sourceAccountId?: string;
  copyTimestamp?: Date;
  tags: Record<string, string>;
}

// ============================================================================
// RDS Automated Backup Types
// ============================================================================

export interface RDSAutomatedBackup {
  dbInstanceArn?: string;
  dbiResourceId?: string;
  region?: string;
  dbInstanceIdentifier?: string;
  restoreWindow?: {
    earliestTime?: Date;
    latestTime?: Date;
  };
  allocatedStorage: number;
  status?: string;
  port: number;
  availabilityZone?: string;
  vpcId?: string;
  instanceCreateTime?: Date;
  masterUsername?: string;
  engine?: string;
  engineVersion?: string;
  licenseModel?: string;
  iops?: number;
  optionGroupName?: string;
  encrypted: boolean;
  storageType?: string;
  kmsKeyId?: string;
  timezone?: string;
  iamDatabaseAuthenticationEnabled: boolean;
  backupRetentionPeriod?: number;
  dbInstanceAutomatedBackupsArn?: string;
  dbInstanceAutomatedBackupsReplications: Array<{
    dbInstanceAutomatedBackupsArn?: string;
  }>;
  backupTarget?: string;
  storageThroughput?: number;
}

// ============================================================================
// RDS Point-in-Time Recovery Types
// ============================================================================

export interface RDSRestoreToPointInTimeOptions {
  sourceDBInstanceIdentifier?: string;
  targetDBInstanceIdentifier: string;
  restoreTime?: Date;
  useLatestRestorableTime?: boolean;
  dbInstanceClass?: string;
  port?: number;
  availabilityZone?: string;
  dbSubnetGroupName?: string;
  multiAZ?: boolean;
  publiclyAccessible?: boolean;
  autoMinorVersionUpgrade?: boolean;
  licenseModel?: string;
  dbName?: string;
  engine?: string;
  iops?: number;
  optionGroupName?: string;
  storageType?: 'gp2' | 'gp3' | 'io1' | 'io2' | 'standard';
  storageThroughput?: number;
  vpcSecurityGroupIds?: string[];
  dbParameterGroupName?: string;
  deletionProtection?: boolean;
  enableIAMDatabaseAuthentication?: boolean;
  enablePerformanceInsights?: boolean;
  performanceInsightsKMSKeyId?: string;
  performanceInsightsRetentionPeriod?: number;
  copyTagsToSnapshot?: boolean;
  sourceDBInstanceAutomatedBackupsArn?: string;
  sourceDbiResourceId?: string;
  maxAllocatedStorage?: number;
  networkType?: 'IPV4' | 'DUAL';
  tags?: Record<string, string>;
  region?: string;
}

// ============================================================================
// RDS Log Types
// ============================================================================

export interface RDSLogFile {
  logFileName: string;
  lastWritten?: number;
  size: number;
}

export interface RDSDownloadLogOptions {
  dbInstanceIdentifier: string;
  logFileName: string;
  marker?: string;
  numberOfLines?: number;
  region?: string;
}
