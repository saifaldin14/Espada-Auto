/**
 * Azure Backup (Recovery Services) — Type Definitions
 */

export type RecoveryServicesVault = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku?: string;
  provisioningState?: string;
  privateEndpointConnections?: string[];
};

export type BackupPolicy = {
  id: string;
  name: string;
  vaultName: string;
  backupManagementType?: string;
  schedulePolicy?: Record<string, unknown>;
  retentionPolicy?: Record<string, unknown>;
};

export type BackupItem = {
  id: string;
  name: string;
  vaultName: string;
  sourceResourceId?: string;
  workloadType?: string;
  protectionStatus?: string;
  protectionState?: string;
  lastBackupTime?: string;
  policyId?: string;
};

export type BackupJob = {
  id: string;
  name: string;
  vaultName: string;
  operation?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  entityFriendlyName?: string;
  backupManagementType?: string;
  duration?: string;
};

export type RestorePoint = {
  id: string;
  name: string;
  recoveryPointTime?: string;
  recoveryPointType?: string;
  sourceResourceId?: string;
};
