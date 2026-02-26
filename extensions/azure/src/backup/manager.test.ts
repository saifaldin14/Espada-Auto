/**
 * Azure Backup Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureBackupManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockVaults = {
  listBySubscriptionId: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
};

const mockBackupPolicies = { list: vi.fn() };
const mockBackupProtectedItems = { list: vi.fn() };
const mockBackupJobs = { list: vi.fn() };
const mockBackups = { trigger: vi.fn() };
const mockProtectionPolicies = {
  createOrUpdate: vi.fn(),
  beginDeleteAndWait: vi.fn(),
};

vi.mock("@azure/arm-recoveryservices", () => ({
  RecoveryServicesClient: vi.fn().mockImplementation(function() { return {
    vaults: mockVaults,
  }; }),
}));

vi.mock("@azure/arm-recoveryservicesbackup", () => ({
  RecoveryServicesBackupClient: vi.fn().mockImplementation(function() { return {
    backupPolicies: mockBackupPolicies,
    backupProtectedItems: mockBackupProtectedItems,
    backupJobs: mockBackupJobs,
    backups: mockBackups,
    protectionPolicies: mockProtectionPolicies,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureBackupManager", () => {
  let mgr: AzureBackupManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureBackupManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listVaults", () => {
    it("lists all vaults", async () => {
      mockVaults.listBySubscriptionId.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.RecoveryServices/vaults/vault-1", name: "vault-1", location: "eastus", properties: { provisioningState: "Succeeded" }, sku: { name: "Standard" }, tags: {} },
      ]));
      const vaults = await mgr.listVaults();
      expect(vaults).toHaveLength(1);
      expect(vaults[0].name).toBe("vault-1");
    });

    it("filters by resource group", async () => {
      mockVaults.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listVaults("rg-1");
      expect(mockVaults.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getVault", () => {
    it("returns vault details", async () => {
      mockVaults.get.mockResolvedValue({
        id: "id", name: "vault-1", location: "eastus", properties: { provisioningState: "Succeeded" }, sku: { name: "Standard" },
      });
      const vault = await mgr.getVault("rg-1", "vault-1");
      expect(vault.name).toBe("vault-1");
    });
  });

  describe("listBackupPolicies", () => {
    it("lists backup policies", async () => {
      mockBackupPolicies.list.mockReturnValue(asyncIter([
        { id: "bp-id", name: "DailyPolicy", properties: { backupManagementType: "AzureIaasVM", schedulePolicy: {}, retentionPolicy: {} } },
      ]));
      const policies = await mgr.listBackupPolicies("rg-1", "vault-1");
      expect(policies).toHaveLength(1);
      expect(policies[0].name).toBe("DailyPolicy");
    });
  });

  describe("listBackupItems", () => {
    it("lists protected items", async () => {
      mockBackupProtectedItems.list.mockReturnValue(asyncIter([
        { id: "bi-id", name: "vm-backup", properties: { friendlyName: "my-vm", protectionStatus: "Healthy", protectionState: "Protected", lastBackupTime: new Date() } },
      ]));
      const items = await mgr.listBackupItems("rg-1", "vault-1");
      expect(items).toHaveLength(1);
    });
  });

  describe("listBackupJobs", () => {
    it("lists backup jobs", async () => {
      mockBackupJobs.list.mockReturnValue(asyncIter([
        { id: "bj-id", name: "job-1", properties: { operation: "Backup", status: "Completed", startTime: new Date(), endTime: new Date(), entityFriendlyName: "my-vm" } },
      ]));
      const jobs = await mgr.listBackupJobs("rg-1", "vault-1");
      expect(jobs).toHaveLength(1);
    });
  });

  describe("triggerBackup", () => {
    it("triggers an on-demand backup", async () => {
      mockBackups.trigger.mockResolvedValue(undefined);
      await expect(
        mgr.triggerBackup("rg-1", "vault-1", "Azure", "vm-container", "vm-item")
      ).resolves.toBeUndefined();
      expect(mockBackups.trigger).toHaveBeenCalled();
    });
  });

  describe("createBackupPolicy", () => {
    it("creates a backup policy", async () => {
      mockProtectionPolicies.createOrUpdate.mockResolvedValue({
        id: "bp-id", name: "NewPolicy",
        properties: { backupManagementType: "AzureIaasVM" },
      });
      const policy = await mgr.createBackupPolicy("rg-1", "vault-1", "NewPolicy", {
        backupManagementType: "AzureIaasVM",
        objectType: "AzureIaaSVMProtectionPolicy",
      });
      expect(policy.name).toBe("NewPolicy");
    });
  });

  describe("deleteBackupPolicy", () => {
    it("deletes a backup policy", async () => {
      mockProtectionPolicies.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteBackupPolicy("rg-1", "vault-1", "OldPolicy")).resolves.toBeUndefined();
    });
  });
});
