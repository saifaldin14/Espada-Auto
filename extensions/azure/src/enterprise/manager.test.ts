/**
 * Azure Enterprise Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureEnterpriseManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock SDKs
// ---------------------------------------------------------------------------

const mockManagementGroups = {
  list: vi.fn(),
  get: vi.fn(),
};

vi.mock("@azure/arm-managementgroups", () => ({
  ManagementGroupsAPI: vi.fn().mockImplementation(() => ({
    managementGroups: mockManagementGroups,
  })),
}));

const mockTenants = {
  list: vi.fn(),
};

const mockSubscriptions = {
  list: vi.fn(),
};

vi.mock("@azure/arm-subscriptions", () => ({
  SubscriptionClient: vi.fn().mockImplementation(() => ({
    tenants: mockTenants,
    subscriptions: mockSubscriptions,
  })),
}));

const mockArmResources = {
  list: vi.fn(),
};

vi.mock("@azure/arm-resources", () => ({
  ResourceManagementClient: vi.fn().mockImplementation(() => ({
    resources: mockArmResources,
  })),
}));

const mockBillingAccounts = {
  list: vi.fn(),
};

vi.mock("@azure/arm-billing", () => ({
  BillingManagementClient: vi.fn().mockImplementation(() => ({
    billingAccounts: mockBillingAccounts,
  })),
}));

const mockCredential = { getToken: vi.fn().mockResolvedValue({ token: "t", expiresOnTimestamp: Date.now() + 3600000 }) };
const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: mockCredential, method: "default" }),
  getSubscriptionId: () => "sub-1",
  getTenantId: () => undefined,
  clearCache: vi.fn(),
} as unknown as AzureCredentialsManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureEnterpriseManager", () => {
  let mgr: AzureEnterpriseManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureEnterpriseManager(mockCredentialsManager, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  // -------------------------------------------------------------------------
  // listManagementGroups
  // -------------------------------------------------------------------------
  describe("listManagementGroups", () => {
    it("lists management groups", async () => {
      mockManagementGroups.list.mockReturnValue(asyncIter([
        { id: "/mg1", name: "mg1", displayName: "Root Group", type: "Microsoft.Management/managementGroups" },
        { id: "/mg2", name: "mg2", displayName: "Dev Group", type: "Microsoft.Management/managementGroups" },
      ]));

      const result = await mgr.listManagementGroups();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("mg1");
      expect(result[0].displayName).toBe("Root Group");
      expect(result[1].name).toBe("mg2");
    });

    it("handles nullish properties", async () => {
      mockManagementGroups.list.mockReturnValue(asyncIter([
        { id: null, name: null, displayName: null, type: null },
      ]));

      const result = await mgr.listManagementGroups();
      expect(result[0].id).toBe("");
      expect(result[0].name).toBe("");
      expect(result[0].displayName).toBe("");
      expect(result[0].type).toBe("Microsoft.Management/managementGroups");
    });

    it("returns empty array when no groups", async () => {
      mockManagementGroups.list.mockReturnValue(asyncIter([]));
      const result = await mgr.listManagementGroups();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getManagementGroup
  // -------------------------------------------------------------------------
  describe("getManagementGroup", () => {
    it("gets a management group with children", async () => {
      mockManagementGroups.get.mockResolvedValue({
        id: "/mg1",
        name: "mg1",
        displayName: "Root",
        type: "Microsoft.Management/managementGroups",
        children: [
          { id: "/mg1/mg2", name: "mg2", displayName: "Child", type: "Microsoft.Management/managementGroups" },
        ],
      });

      const result = await mgr.getManagementGroup("mg1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("mg1");
      expect(result!.children).toHaveLength(1);
      expect(result!.children![0].name).toBe("mg2");
      expect(mockManagementGroups.get).toHaveBeenCalledWith("mg1", { expand: "children" });
    });

    it("returns null when group is falsy", async () => {
      mockManagementGroups.get.mockResolvedValue(null);
      const result = await mgr.getManagementGroup("nonexistent");
      expect(result).toBeNull();
    });

    it("handles group with no children array", async () => {
      mockManagementGroups.get.mockResolvedValue({
        id: "/mg1",
        name: "mg1",
        displayName: "Leaf",
        type: "Microsoft.Management/managementGroups",
      });

      const result = await mgr.getManagementGroup("mg1");
      expect(result!.children).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // listTenants
  // -------------------------------------------------------------------------
  describe("listTenants", () => {
    it("lists accessible tenants", async () => {
      mockTenants.list.mockReturnValue(asyncIter([
        { tenantId: "t1", displayName: "Contoso", defaultDomain: "contoso.onmicrosoft.com", tenantType: "AAD" },
        { tenantId: "t2", displayName: "Fabrikam" },
      ]));

      const result = await mgr.listTenants();
      expect(result).toHaveLength(2);
      expect(result[0].tenantId).toBe("t1");
      expect(result[0].defaultDomain).toBe("contoso.onmicrosoft.com");
      expect(result[1].tenantId).toBe("t2");
      expect(result[1].defaultDomain).toBeUndefined();
    });

    it("handles nullish tenant fields", async () => {
      mockTenants.list.mockReturnValue(asyncIter([
        { tenantId: null, displayName: null, defaultDomain: null, tenantType: null },
      ]));

      const result = await mgr.listTenants();
      expect(result[0].tenantId).toBe("");
      expect(result[0].displayName).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // listSubscriptionsForTenant
  // -------------------------------------------------------------------------
  describe("listSubscriptionsForTenant", () => {
    it("lists subscriptions for a specific tenant", async () => {
      mockSubscriptions.list.mockReturnValue(asyncIter([
        { subscriptionId: "sub-1", displayName: "Dev", state: "Enabled", tenantId: "t1" },
        { subscriptionId: "sub-2", displayName: "Prod", state: "Enabled", tenantId: "t2" },
      ]));

      const result = await mgr.listSubscriptionsForTenant("t1");
      expect(result).toHaveLength(1);
      expect(result[0].subscriptionId).toBe("sub-1");
      expect(result[0].tenantId).toBe("t1");
    });

    it("returns all subscriptions when tenantId matches", async () => {
      mockSubscriptions.list.mockReturnValue(asyncIter([
        { subscriptionId: "sub-1", displayName: "A", state: "Enabled", tenantId: "t1" },
        { subscriptionId: "sub-2", displayName: "B", state: "Enabled", tenantId: "t1" },
      ]));

      const result = await mgr.listSubscriptionsForTenant("t1");
      expect(result).toHaveLength(2);
    });

    it("handles nullish subscription fields", async () => {
      mockSubscriptions.list.mockReturnValue(asyncIter([
        { subscriptionId: null, displayName: null, state: null, tenantId: "t1" },
      ]));

      const result = await mgr.listSubscriptionsForTenant("t1");
      expect(result[0].subscriptionId).toBe("");
      expect(result[0].state).toBe("Unknown");
    });
  });

  // -------------------------------------------------------------------------
  // listLighthouseDelegations
  // -------------------------------------------------------------------------
  describe("listLighthouseDelegations", () => {
    it("lists lighthouse delegation resources", async () => {
      mockArmResources.list.mockReturnValue(asyncIter([
        { id: "/delegations/d1", provisioningState: "Succeeded" },
      ]));

      const result = await mgr.listLighthouseDelegations();
      expect(result).toHaveLength(1);
      expect(result[0].delegationId).toBe("/delegations/d1");
      expect(result[0].managedSubscriptionId).toBe("sub-1");
      expect(result[0].status).toBe("Succeeded");
    });

    it("returns empty array when no delegations", async () => {
      mockArmResources.list.mockReturnValue(asyncIter([]));
      const result = await mgr.listLighthouseDelegations();
      expect(result).toEqual([]);
    });

    it("handles resource with nullish id", async () => {
      mockArmResources.list.mockReturnValue(asyncIter([
        { id: null },
      ]));

      const result = await mgr.listLighthouseDelegations();
      expect(result[0].delegationId).toBe("");
      expect(result[0].status).toBe("Unknown");
    });
  });

  // -------------------------------------------------------------------------
  // getEnrollmentInfo
  // -------------------------------------------------------------------------
  describe("getEnrollmentInfo", () => {
    it("returns first billing account as enrollment info", async () => {
      mockBillingAccounts.list.mockReturnValue(asyncIter([
        { name: "ENR-001", id: "/billingAccounts/ba1" },
      ]));

      const result = await mgr.getEnrollmentInfo();
      expect(result).not.toBeNull();
      expect(result!.enrollmentNumber).toBe("ENR-001");
      expect(result!.billingAccountId).toBe("/billingAccounts/ba1");
    });

    it("returns null when no billing accounts", async () => {
      mockBillingAccounts.list.mockReturnValue(asyncIter([]));
      const result = await mgr.getEnrollmentInfo();
      expect(result).toBeNull();
    });

    it("handles nullish billing account fields", async () => {
      mockBillingAccounts.list.mockReturnValue(asyncIter([
        { name: null, id: null },
      ]));

      const result = await mgr.getEnrollmentInfo();
      expect(result!.enrollmentNumber).toBe("");
      expect(result!.billingAccountId).toBe("");
    });
  });
});
