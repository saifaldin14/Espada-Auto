/**
 * Azure VM Manager
 *
 * Manages Azure Virtual Machines via @azure/arm-compute.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  VMInstance,
  VMCreateOptions,
  VMListOptions,
  VMOperationResult,
  VMSize,
  VMPowerState,
} from "./types.js";

// =============================================================================
// AzureVMManager
// =============================================================================

export class AzureVMManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private defaultRegion: string;
  private retryOptions: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    defaultRegion?: string,
    retryOptions?: AzureRetryOptions,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.defaultRegion = defaultRegion ?? "eastus";
    this.retryOptions = retryOptions ?? {};
  }

  private async getComputeClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { ComputeManagementClient } = await import("@azure/arm-compute");
    return new ComputeManagementClient(credential, this.subscriptionId);
  }

  /**
   * List virtual machines.
   */
  async listVMs(options?: VMListOptions): Promise<VMInstance[]> {
    const client = await this.getComputeClient();

    return withAzureRetry(async () => {
      const vms: VMInstance[] = [];

      const iterator = options?.resourceGroup
        ? client.virtualMachines.list(options.resourceGroup)
        : client.virtualMachines.listAll();

      for await (const vm of iterator) {
        const instance = this.mapToVMInstance(vm);

        // Apply filters
        if (options?.location && instance.location !== options.location) continue;
        if (options?.powerState && instance.powerState !== options.powerState) continue;

        vms.push(instance);
      }

      return vms;
    }, this.retryOptions);
  }

  /**
   * Get a specific VM by name.
   */
  async getVM(resourceGroup: string, vmName: string): Promise<VMInstance | null> {
    const client = await this.getComputeClient();

    return withAzureRetry(async () => {
      try {
        const vm = await client.virtualMachines.get(resourceGroup, vmName, {
          expand: "instanceView",
        });
        return this.mapToVMInstance(vm);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /**
   * Start a VM.
   */
  async startVM(resourceGroup: string, vmName: string): Promise<VMOperationResult> {
    const client = await this.getComputeClient();

    return withAzureRetry(async () => {
      try {
        await client.virtualMachines.beginStartAndWait(resourceGroup, vmName);
        return { success: true, vmName, operation: "start", message: `VM ${vmName} started` };
      } catch (error) {
        return {
          success: false,
          vmName,
          operation: "start",
          error: (error as Error).message,
        };
      }
    }, this.retryOptions);
  }

  /**
   * Stop (deallocate) a VM.
   */
  async stopVM(resourceGroup: string, vmName: string): Promise<VMOperationResult> {
    const client = await this.getComputeClient();

    return withAzureRetry(async () => {
      try {
        await client.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);
        return { success: true, vmName, operation: "stop", message: `VM ${vmName} deallocated` };
      } catch (error) {
        return {
          success: false,
          vmName,
          operation: "stop",
          error: (error as Error).message,
        };
      }
    }, this.retryOptions);
  }

  /**
   * Restart a VM.
   */
  async restartVM(resourceGroup: string, vmName: string): Promise<VMOperationResult> {
    const client = await this.getComputeClient();

    return withAzureRetry(async () => {
      try {
        await client.virtualMachines.beginRestartAndWait(resourceGroup, vmName);
        return { success: true, vmName, operation: "restart", message: `VM ${vmName} restarted` };
      } catch (error) {
        return {
          success: false,
          vmName,
          operation: "restart",
          error: (error as Error).message,
        };
      }
    }, this.retryOptions);
  }

  /**
   * Delete a VM.
   */
  async deleteVM(resourceGroup: string, vmName: string): Promise<VMOperationResult> {
    const client = await this.getComputeClient();

    return withAzureRetry(async () => {
      try {
        await client.virtualMachines.beginDeleteAndWait(resourceGroup, vmName);
        return { success: true, vmName, operation: "delete", message: `VM ${vmName} deleted` };
      } catch (error) {
        return {
          success: false,
          vmName,
          operation: "delete",
          error: (error as Error).message,
        };
      }
    }, this.retryOptions);
  }

  /**
   * List available VM sizes in a region.
   */
  async listVMSizes(location?: string): Promise<VMSize[]> {
    const client = await this.getComputeClient();
    const region = location ?? this.defaultRegion;

    return withAzureRetry(async () => {
      const sizes: VMSize[] = [];
      for await (const size of client.virtualMachineSizes.list(region)) {
        sizes.push({
          name: size.name ?? "",
          numberOfCores: size.numberOfCores ?? 0,
          memoryInMB: size.memoryInMB ?? 0,
          maxDataDiskCount: size.maxDataDiskCount ?? 0,
          osDiskSizeInMB: size.osDiskSizeInMB ?? 0,
          resourceDiskSizeInMB: size.resourceDiskSizeInMB ?? 0,
        });
      }
      return sizes;
    }, this.retryOptions);
  }

  /**
   * Get the instance view (power state, status) of a VM.
   */
  async getVMStatus(resourceGroup: string, vmName: string): Promise<VMPowerState> {
    const client = await this.getComputeClient();

    return withAzureRetry(async () => {
      const iv = await client.virtualMachines.instanceView(resourceGroup, vmName);
      const powerStatus = iv.statuses?.find((s) => s.code?.startsWith("PowerState/"));
      return this.parsePowerState(powerStatus?.code);
    }, this.retryOptions);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private mapToVMInstance(vm: unknown): VMInstance {
    const v = vm as Record<string, any>;
    const hardwareProfile = v.hardwareProfile ?? {};
    const storageProfile = v.storageProfile ?? {};
    const osProfile = v.osProfile ?? {};
    const networkProfile = v.networkProfile ?? {};
    const imageRef = storageProfile.imageReference ?? {};
    const osDisk = storageProfile.osDisk ?? {};

    const nics = (networkProfile.networkInterfaces ?? []).map(
      (n: Record<string, string>) => n.id ?? "",
    );

    const instanceView = v.instanceView as Record<string, any> | undefined;
    const powerStatus = instanceView?.statuses?.find(
      (s: Record<string, string>) => s.code?.startsWith("PowerState/"),
    );

    return {
      id: v.id ?? "",
      name: v.name ?? "",
      resourceGroup: this.extractResourceGroup(v.id ?? ""),
      location: v.location ?? "",
      vmSize: hardwareProfile.vmSize ?? "",
      powerState: this.parsePowerState(powerStatus?.code),
      provisioningState: v.provisioningState ?? "",
      osType: osDisk.osType ?? "Linux",
      osDiskSizeGB: osDisk.diskSizeGB,
      adminUsername: osProfile.adminUsername,
      computerName: osProfile.computerName,
      tags: v.tags,
      networkInterfaces: nics,
      imageReference: imageRef.publisher
        ? {
            publisher: imageRef.publisher,
            offer: imageRef.offer,
            sku: imageRef.sku,
            version: imageRef.version,
          }
        : undefined,
      availabilityZone: v.zones?.[0],
    };
  }

  private parsePowerState(code?: string): VMPowerState {
    if (!code) return "unknown";
    const state = code.replace("PowerState/", "").toLowerCase();
    const map: Record<string, VMPowerState> = {
      running: "running",
      deallocated: "deallocated",
      stopped: "stopped",
      starting: "starting",
      deallocating: "deallocating",
    };
    return map[state] ?? "unknown";
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createVMManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  defaultRegion?: string,
  retryOptions?: AzureRetryOptions,
): AzureVMManager {
  return new AzureVMManager(credentialsManager, subscriptionId, defaultRegion, retryOptions);
}
