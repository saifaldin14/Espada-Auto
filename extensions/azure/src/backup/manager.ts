/**
 * Azure Backup Manager (Recovery Services)
 *
 * Manages Recovery Services vaults, backup policies, items, and jobs.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { RecoveryServicesVault, BackupPolicy, BackupItem, BackupJob } from "./types.js";

export class AzureBackupManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions;
  }

  async listVaults(resourceGroup?: string): Promise<RecoveryServicesVault[]> {
    return withAzureRetry(async () => {
      const { RecoveryServicesClient } = await import("@azure/arm-recoveryservices");
      const credential = this.credentialsManager.getCredential();
      const client = new RecoveryServicesClient(credential, this.subscriptionId);
      const results: RecoveryServicesVault[] = [];
      const iter = resourceGroup
        ? client.vaults.listByResourceGroup(resourceGroup)
        : client.vaults.listBySubscriptionId();
      for await (const v of iter) {
        results.push({
          id: v.id ?? "",
          name: v.name ?? "",
          resourceGroup: v.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: v.location ?? "",
          sku: v.sku?.name,
          provisioningState: v.properties?.provisioningState,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getVault(resourceGroup: string, vaultName: string): Promise<RecoveryServicesVault> {
    return withAzureRetry(async () => {
      const { RecoveryServicesClient } = await import("@azure/arm-recoveryservices");
      const credential = this.credentialsManager.getCredential();
      const client = new RecoveryServicesClient(credential, this.subscriptionId);
      const v = await client.vaults.get(resourceGroup, vaultName);
      return {
        id: v.id ?? "",
        name: v.name ?? "",
        resourceGroup,
        location: v.location ?? "",
        sku: v.sku?.name,
        provisioningState: v.properties?.provisioningState,
      };
    }, this.retryOptions);
  }

  async listBackupPolicies(
    resourceGroup: string,
    vaultName: string
  ): Promise<BackupPolicy[]> {
    return withAzureRetry(async () => {
      const { RecoveryServicesBackupClient } = await import("@azure/arm-recoveryservicesbackup");
      const credential = this.credentialsManager.getCredential();
      const client = new RecoveryServicesBackupClient(credential, this.subscriptionId);
      const results: BackupPolicy[] = [];
      for await (const p of client.backupPolicies.list(vaultName, resourceGroup)) {
        results.push({
          id: p.id ?? "",
          name: p.name ?? "",
          vaultName,
          backupManagementType: (p.properties as any)?.backupManagementType,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listBackupItems(
    resourceGroup: string,
    vaultName: string
  ): Promise<BackupItem[]> {
    return withAzureRetry(async () => {
      const { RecoveryServicesBackupClient } = await import("@azure/arm-recoveryservicesbackup");
      const credential = this.credentialsManager.getCredential();
      const client = new RecoveryServicesBackupClient(credential, this.subscriptionId);
      const results: BackupItem[] = [];
      for await (const item of client.backupProtectedItems.list(vaultName, resourceGroup)) {
        const props = item.properties as any;
        results.push({
          id: item.id ?? "",
          name: item.name ?? "",
          vaultName,
          sourceResourceId: props?.sourceResourceId,
          workloadType: props?.workloadType,
          protectionStatus: props?.protectionStatus,
          protectionState: props?.protectionState,
          lastBackupTime: props?.lastBackupTime?.toISOString?.(),
          policyId: props?.policyId,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listBackupJobs(
    resourceGroup: string,
    vaultName: string
  ): Promise<BackupJob[]> {
    return withAzureRetry(async () => {
      const { RecoveryServicesBackupClient } = await import("@azure/arm-recoveryservicesbackup");
      const credential = this.credentialsManager.getCredential();
      const client = new RecoveryServicesBackupClient(credential, this.subscriptionId);
      const results: BackupJob[] = [];
      for await (const job of client.backupJobs.list(vaultName, resourceGroup)) {
        const props = job.properties as any;
        results.push({
          id: job.id ?? "",
          name: job.name ?? "",
          vaultName,
          operation: props?.operation,
          status: props?.status,
          startTime: props?.startTime?.toISOString?.(),
          endTime: props?.endTime?.toISOString?.(),
          entityFriendlyName: props?.entityFriendlyName,
          backupManagementType: props?.backupManagementType,
          duration: props?.duration,
        });
      }
      return results;
    }, this.retryOptions);
  }
}

export function createBackupManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureBackupManager {
  return new AzureBackupManager(credentialsManager, subscriptionId, retryOptions);
}
