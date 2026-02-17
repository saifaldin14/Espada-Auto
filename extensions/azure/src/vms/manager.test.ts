/**
 * Azure VM Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureVMManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an async iterable from an array (mimics Azure SDK paging). */
function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

/** Builds a mock VM object matching the Azure SDK shape. */
function makeSdkVM(overrides: Record<string, unknown> = {}) {
  return {
    id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-1",
    name: "vm-1",
    location: "eastus",
    provisioningState: "Succeeded",
    hardwareProfile: { vmSize: "Standard_DS2_v2" },
    storageProfile: {
      imageReference: { publisher: "Canonical", offer: "UbuntuServer", sku: "18.04-LTS", version: "latest" },
      osDisk: { osType: "Linux", diskSizeGB: 30 },
    },
    osProfile: { adminUsername: "azureuser", computerName: "vm-1" },
    networkProfile: { networkInterfaces: [{ id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/networkInterfaces/nic-1" }] },
    tags: { env: "test" },
    zones: ["1"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Azure SDK
// ---------------------------------------------------------------------------

const mockVMs = {
  listAll: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  beginStartAndWait: vi.fn(),
  beginDeallocateAndWait: vi.fn(),
  beginRestartAndWait: vi.fn(),
  beginDeleteAndWait: vi.fn(),
  instanceView: vi.fn(),
};

const mockSizes = { list: vi.fn() };

vi.mock("@azure/arm-compute", () => ({
  ComputeManagementClient: vi.fn().mockImplementation(() => ({
    virtualMachines: mockVMs,
    virtualMachineSizes: mockSizes,
  })),
}));

// ---------------------------------------------------------------------------
// Mock credentials
// ---------------------------------------------------------------------------

const mockCredential = { getToken: vi.fn().mockResolvedValue({ token: "t", expiresOnTimestamp: Date.now() + 3600000 }) };
const mockCredentialsManager: AzureCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: mockCredential, method: "default" }),
  getSubscriptionId: () => "sub-1",
  getTenantId: () => undefined,
  clearCache: vi.fn(),
} as unknown as AzureCredentialsManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureVMManager", () => {
  let mgr: AzureVMManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureVMManager(mockCredentialsManager, "sub-1", "eastus", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  // --- listVMs ---
  describe("listVMs", () => {
    it("lists all VMs when no resource group given", async () => {
      mockVMs.listAll.mockReturnValue(asyncIter([makeSdkVM()]));
      const vms = await mgr.listVMs();
      expect(vms).toHaveLength(1);
      expect(vms[0].name).toBe("vm-1");
      expect(vms[0].vmSize).toBe("Standard_DS2_v2");
      expect(vms[0].location).toBe("eastus");
      expect(vms[0].resourceGroup).toBe("rg-1");
      expect(vms[0].osType).toBe("Linux");
      expect(mockVMs.listAll).toHaveBeenCalled();
    });

    it("lists VMs in a specific resource group", async () => {
      mockVMs.list.mockReturnValue(asyncIter([makeSdkVM()]));
      const vms = await mgr.listVMs({ resourceGroup: "rg-1" });
      expect(vms).toHaveLength(1);
      expect(mockVMs.list).toHaveBeenCalledWith("rg-1");
    });

    it("returns empty array when no VMs exist", async () => {
      mockVMs.listAll.mockReturnValue(asyncIter([]));
      const vms = await mgr.listVMs();
      expect(vms).toEqual([]);
    });

    it("filters by location", async () => {
      mockVMs.listAll.mockReturnValue(asyncIter([makeSdkVM({ location: "westus" }), makeSdkVM({ location: "eastus" })]));
      const vms = await mgr.listVMs({ location: "eastus" });
      expect(vms).toHaveLength(1);
      expect(vms[0].location).toBe("eastus");
    });

    it("filters by power state", async () => {
      const runningVM = makeSdkVM({ instanceView: { statuses: [{ code: "PowerState/running" }] } });
      const stoppedVM = makeSdkVM({ instanceView: { statuses: [{ code: "PowerState/deallocated" }] } });
      mockVMs.listAll.mockReturnValue(asyncIter([runningVM, stoppedVM]));
      const vms = await mgr.listVMs({ powerState: "running" });
      expect(vms).toHaveLength(1);
      expect(vms[0].powerState).toBe("running");
    });
  });

  // --- getVM ---
  describe("getVM", () => {
    it("returns VM when found", async () => {
      mockVMs.get.mockResolvedValue(makeSdkVM());
      const vm = await mgr.getVM("rg-1", "vm-1");
      expect(vm).not.toBeNull();
      expect(vm!.name).toBe("vm-1");
      expect(mockVMs.get).toHaveBeenCalledWith("rg-1", "vm-1", { expand: "instanceView" });
    });

    it("returns null when VM not found (404)", async () => {
      mockVMs.get.mockRejectedValue({ statusCode: 404 });
      const vm = await mgr.getVM("rg-1", "nonexistent");
      expect(vm).toBeNull();
    });

    it("throws on non-404 errors", async () => {
      mockVMs.get.mockRejectedValue({ statusCode: 500, message: "Internal" });
      await expect(mgr.getVM("rg-1", "vm-1")).rejects.toEqual({ statusCode: 500, message: "Internal" });
    });
  });

  // --- startVM ---
  describe("startVM", () => {
    it("returns success result on start", async () => {
      mockVMs.beginStartAndWait.mockResolvedValue(undefined);
      const result = await mgr.startVM("rg-1", "vm-1");
      expect(result.success).toBe(true);
      expect(result.operation).toBe("start");
      expect(result.vmName).toBe("vm-1");
    });

    it("returns failure result on error", async () => {
      mockVMs.beginStartAndWait.mockRejectedValue(new Error("Quota exceeded"));
      const result = await mgr.startVM("rg-1", "vm-1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Quota exceeded");
    });
  });

  // --- stopVM ---
  describe("stopVM", () => {
    it("deallocates the VM", async () => {
      mockVMs.beginDeallocateAndWait.mockResolvedValue(undefined);
      const result = await mgr.stopVM("rg-1", "vm-1");
      expect(result.success).toBe(true);
      expect(result.operation).toBe("stop");
    });
  });

  // --- restartVM ---
  describe("restartVM", () => {
    it("restarts the VM", async () => {
      mockVMs.beginRestartAndWait.mockResolvedValue(undefined);
      const result = await mgr.restartVM("rg-1", "vm-1");
      expect(result.success).toBe(true);
      expect(result.operation).toBe("restart");
    });
  });

  // --- deleteVM ---
  describe("deleteVM", () => {
    it("deletes the VM", async () => {
      mockVMs.beginDeleteAndWait.mockResolvedValue(undefined);
      const result = await mgr.deleteVM("rg-1", "vm-1");
      expect(result.success).toBe(true);
      expect(result.operation).toBe("delete");
    });
  });

  // --- listVMSizes ---
  describe("listVMSizes", () => {
    it("returns available sizes for the default region", async () => {
      mockSizes.list.mockReturnValue(asyncIter([
        { name: "Standard_DS2_v2", numberOfCores: 2, memoryInMB: 7168, maxDataDiskCount: 8, osDiskSizeInMB: 1047552, resourceDiskSizeInMB: 14336 },
      ]));
      const sizes = await mgr.listVMSizes();
      expect(sizes).toHaveLength(1);
      expect(sizes[0].name).toBe("Standard_DS2_v2");
      expect(sizes[0].numberOfCores).toBe(2);
      expect(mockSizes.list).toHaveBeenCalledWith("eastus");
    });

    it("uses provided location", async () => {
      mockSizes.list.mockReturnValue(asyncIter([]));
      await mgr.listVMSizes("westus2");
      expect(mockSizes.list).toHaveBeenCalledWith("westus2");
    });
  });

  // --- getVMStatus ---
  describe("getVMStatus", () => {
    it("returns running state", async () => {
      mockVMs.instanceView.mockResolvedValue({ statuses: [{ code: "ProvisioningState/succeeded" }, { code: "PowerState/running" }] });
      const state = await mgr.getVMStatus("rg-1", "vm-1");
      expect(state).toBe("running");
    });

    it("returns unknown when no PowerState status", async () => {
      mockVMs.instanceView.mockResolvedValue({ statuses: [{ code: "ProvisioningState/succeeded" }] });
      const state = await mgr.getVMStatus("rg-1", "vm-1");
      expect(state).toBe("unknown");
    });

    it("returns deallocated state", async () => {
      mockVMs.instanceView.mockResolvedValue({ statuses: [{ code: "PowerState/deallocated" }] });
      const state = await mgr.getVMStatus("rg-1", "vm-1");
      expect(state).toBe("deallocated");
    });
  });

  // --- mapToVMInstance edge cases ---
  describe("mapToVMInstance (via listVMs)", () => {
    it("handles VM with missing optional fields", async () => {
      mockVMs.listAll.mockReturnValue(asyncIter([{ id: "", name: "bare-vm", location: "westus" }]));
      const vms = await mgr.listVMs();
      expect(vms[0].name).toBe("bare-vm");
      expect(vms[0].vmSize).toBe("");
      expect(vms[0].powerState).toBe("unknown");
      expect(vms[0].networkInterfaces).toEqual([]);
    });

    it("extracts image reference when present", async () => {
      mockVMs.listAll.mockReturnValue(asyncIter([makeSdkVM()]));
      const vms = await mgr.listVMs();
      expect(vms[0].imageReference).toEqual({ publisher: "Canonical", offer: "UbuntuServer", sku: "18.04-LTS", version: "latest" });
    });

    it("captures tags", async () => {
      mockVMs.listAll.mockReturnValue(asyncIter([makeSdkVM()]));
      const vms = await mgr.listVMs();
      expect(vms[0].tags).toEqual({ env: "test" });
    });

    it("captures availability zone", async () => {
      mockVMs.listAll.mockReturnValue(asyncIter([makeSdkVM()]));
      const vms = await mgr.listVMs();
      expect(vms[0].availabilityZone).toBe("1");
    });
  });
});
