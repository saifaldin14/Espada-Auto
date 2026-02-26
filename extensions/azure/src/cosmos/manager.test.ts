/**
 * Azure Cosmos DB Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureCosmosDBManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockDatabaseAccounts = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
  beginCreateOrUpdateAndWait: vi.fn(),
  beginDeleteAndWait: vi.fn(),
  listKeys: vi.fn(),
};

const mockSqlResources = {
  listSqlDatabases: vi.fn(),
  beginCreateUpdateSqlDatabaseAndWait: vi.fn(),
  beginDeleteSqlDatabaseAndWait: vi.fn(),
  listSqlContainers: vi.fn(),
  beginCreateUpdateSqlContainerAndWait: vi.fn(),
  beginDeleteSqlContainerAndWait: vi.fn(),
  beginUpdateSqlDatabaseThroughputAndWait: vi.fn(),
  beginUpdateSqlContainerThroughputAndWait: vi.fn(),
};

vi.mock("@azure/arm-cosmosdb", () => ({
  CosmosDBManagementClient: vi.fn().mockImplementation(function() { return {
    databaseAccounts: mockDatabaseAccounts,
    sqlResources: mockSqlResources,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

const retryOptions = { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 };

describe("AzureCosmosDBManager", () => {
  let mgr: AzureCosmosDBManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureCosmosDBManager(mockCreds, "sub-1", retryOptions);
  });

  describe("listAccounts", () => {
    it("returns all accounts", async () => {
      mockDatabaseAccounts.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.DocumentDB/databaseAccounts/acc-1", name: "acc-1", location: "eastus", kind: "GlobalDocumentDB", provisioningState: "Succeeded" },
      ]));
      const accounts = await mgr.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("acc-1");
      expect(accounts[0].resourceGroup).toBe("rg-1");
    });

    it("returns accounts by resource group", async () => {
      mockDatabaseAccounts.listByResourceGroup.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.DocumentDB/databaseAccounts/acc-1", name: "acc-1", location: "eastus" },
      ]));
      const accounts = await mgr.listAccounts("rg-1");
      expect(accounts).toHaveLength(1);
      expect(mockDatabaseAccounts.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getAccount", () => {
    it("returns an account", async () => {
      mockDatabaseAccounts.get.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.DocumentDB/databaseAccounts/acc-1",
        name: "acc-1", location: "eastus", kind: "GlobalDocumentDB",
      });
      const account = await mgr.getAccount("rg-1", "acc-1");
      expect(account?.name).toBe("acc-1");
    });

    it("returns null for 404", async () => {
      mockDatabaseAccounts.get.mockRejectedValue({ statusCode: 404 });
      const account = await mgr.getAccount("rg-1", "missing");
      expect(account).toBeNull();
    });
  });

  describe("createAccount", () => {
    it("creates a Cosmos DB account", async () => {
      mockDatabaseAccounts.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.DocumentDB/databaseAccounts/new-acc",
        name: "new-acc", location: "eastus", kind: "GlobalDocumentDB",
        provisioningState: "Succeeded",
      });
      const account = await mgr.createAccount({
        name: "new-acc", resourceGroup: "rg-1", location: "eastus",
      });
      expect(account.name).toBe("new-acc");
      expect(mockDatabaseAccounts.beginCreateOrUpdateAndWait).toHaveBeenCalled();
    });
  });

  describe("deleteAccount", () => {
    it("deletes a Cosmos DB account", async () => {
      mockDatabaseAccounts.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteAccount("rg-1", "acc-1")).resolves.toBeUndefined();
    });
  });

  describe("listKeys", () => {
    it("returns account keys", async () => {
      mockDatabaseAccounts.listKeys.mockResolvedValue({
        primaryMasterKey: "pk", secondaryMasterKey: "sk",
        primaryReadonlyMasterKey: "prk", secondaryReadonlyMasterKey: "srk",
      });
      const keys = await mgr.listKeys("rg-1", "acc-1");
      expect(keys.primaryMasterKey).toBe("pk");
      expect(keys.secondaryMasterKey).toBe("sk");
    });
  });

  describe("listDatabases", () => {
    it("returns SQL databases", async () => {
      mockSqlResources.listSqlDatabases.mockReturnValue(asyncIter([
        { id: "db-id", name: "mydb" },
      ]));
      const dbs = await mgr.listDatabases("rg-1", "acc-1");
      expect(dbs).toHaveLength(1);
      expect(dbs[0].name).toBe("mydb");
    });
  });

  describe("createDatabase", () => {
    it("creates a SQL database", async () => {
      mockSqlResources.beginCreateUpdateSqlDatabaseAndWait.mockResolvedValue({
        id: "db-id", name: "newdb",
      });
      const db = await mgr.createDatabase("rg-1", "acc-1", "newdb", 400);
      expect(db.name).toBe("newdb");
      expect(db.throughput).toBe(400);
    });
  });

  describe("deleteDatabase", () => {
    it("deletes a SQL database", async () => {
      mockSqlResources.beginDeleteSqlDatabaseAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteDatabase("rg-1", "acc-1", "olddb")).resolves.toBeUndefined();
    });
  });

  describe("listContainers", () => {
    it("returns SQL containers", async () => {
      mockSqlResources.listSqlContainers.mockReturnValue(asyncIter([
        { id: "c-id", name: "mycontainer", resource: { partitionKey: { paths: ["/id"], kind: "Hash" }, defaultTtl: 3600 } },
      ]));
      const containers = await mgr.listContainers("rg-1", "acc-1", "mydb");
      expect(containers).toHaveLength(1);
      expect(containers[0].partitionKey?.paths).toEqual(["/id"]);
    });
  });

  describe("createContainer", () => {
    it("creates a SQL container", async () => {
      mockSqlResources.beginCreateUpdateSqlContainerAndWait.mockResolvedValue({
        id: "c-id", name: "newc",
        resource: { partitionKey: { paths: ["/pk"], kind: "Hash" } },
      });
      const c = await mgr.createContainer("rg-1", "acc-1", "mydb", "newc", "/pk");
      expect(c.name).toBe("newc");
    });
  });

  describe("deleteContainer", () => {
    it("deletes a SQL container", async () => {
      mockSqlResources.beginDeleteSqlContainerAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteContainer("rg-1", "acc-1", "mydb", "oldc")).resolves.toBeUndefined();
    });
  });

  describe("updateDatabaseThroughput", () => {
    it("updates database throughput", async () => {
      mockSqlResources.beginUpdateSqlDatabaseThroughputAndWait.mockResolvedValue(undefined);
      await expect(mgr.updateDatabaseThroughput("rg-1", "acc-1", "mydb", 800)).resolves.toBeUndefined();
    });
  });

  describe("updateContainerThroughput", () => {
    it("updates container throughput", async () => {
      mockSqlResources.beginUpdateSqlContainerThroughputAndWait.mockResolvedValue(undefined);
      await expect(mgr.updateContainerThroughput("rg-1", "acc-1", "mydb", "myc", 1000)).resolves.toBeUndefined();
    });
  });
});
