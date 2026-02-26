/**
 * Azure CosmosDB Manager — Unit Tests
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
  listSqlContainers: vi.fn(),
  getSqlDatabaseThroughput: vi.fn(),
  beginCreateUpdateSqlDatabaseAndWait: vi.fn(),
  beginDeleteSqlDatabaseAndWait: vi.fn(),
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

describe("AzureCosmosDBManager", () => {
  let mgr: AzureCosmosDBManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureCosmosDBManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listAccounts", () => {
    it("lists all accounts", async () => {
      mockDatabaseAccounts.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-1", name: "cosmos-1", location: "eastus", properties: { documentEndpoint: "https://cosmos-1.documents.azure.com:443/", databaseAccountOfferType: "Standard", consistencyPolicy: { defaultConsistencyLevel: "Session" }, provisioningState: "Succeeded" }, tags: {}, kind: "GlobalDocumentDB" },
      ]));
      const accounts = await mgr.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("cosmos-1");
    });

    it("filters by resource group", async () => {
      mockDatabaseAccounts.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listAccounts("rg-1");
      expect(mockDatabaseAccounts.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getAccount", () => {
    it("returns account", async () => {
      mockDatabaseAccounts.get.mockResolvedValue({
        id: "id", name: "cosmos-1", location: "eastus",
        properties: { documentEndpoint: "https://cosmos-1.documents.azure.com:443/", provisioningState: "Succeeded" },
      });
      const account = await mgr.getAccount("rg-1", "cosmos-1");
      expect(account).not.toBeNull();
      expect(account!.name).toBe("cosmos-1");
    });

    it("returns null on 404", async () => {
      mockDatabaseAccounts.get.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getAccount("rg-1", "gone")).toBeNull();
    });
  });

  describe("listDatabases", () => {
    it("lists SQL databases", async () => {
      mockSqlResources.listSqlDatabases.mockReturnValue(asyncIter([
        { id: "db-id", name: "my-db", properties: { resource: { id: "my-db" } } },
      ]));
      const dbs = await mgr.listDatabases("rg-1", "cosmos-1");
      expect(dbs).toHaveLength(1);
      expect(dbs[0].name).toBe("my-db");
    });
  });

  describe("listContainers", () => {
    it("lists SQL containers", async () => {
      mockSqlResources.listSqlContainers.mockReturnValue(asyncIter([
        { id: "c-id", name: "container-1", properties: { resource: { id: "container-1", partitionKey: { paths: ["/pk"] } } } },
      ]));
      const containers = await mgr.listContainers("rg-1", "cosmos-1", "my-db");
      expect(containers).toHaveLength(1);
      expect(containers[0].name).toBe("container-1");
    });
  });

  describe("getThroughput", () => {
    it("returns throughput settings", async () => {
      mockSqlResources.getSqlDatabaseThroughput.mockResolvedValue({
        properties: { resource: { throughput: 400, autoscaleSettings: { maxThroughput: 4000 } } },
      });
      const tp = await mgr.getThroughput("rg-1", "cosmos-1", "my-db");
      expect(tp).not.toBeNull();
    });

    it("returns null on 404", async () => {
      mockSqlResources.getSqlDatabaseThroughput.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getThroughput("rg-1", "cosmos-1", "no-db")).toBeNull();
    });
  });

  describe("createAccount", () => {
    it("creates a new account", async () => {
      mockDatabaseAccounts.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.DocumentDB/databaseAccounts/new-cosmos",
        name: "new-cosmos", location: "eastus", provisioningState: "Succeeded",
      });
      const account = await mgr.createAccount({ name: "new-cosmos", resourceGroup: "rg-1", location: "eastus" });
      expect(account.name).toBe("new-cosmos");
      expect(mockDatabaseAccounts.beginCreateOrUpdateAndWait).toHaveBeenCalledWith("rg-1", "new-cosmos", expect.any(Object));
    });
  });

  describe("deleteAccount", () => {
    it("deletes an account", async () => {
      mockDatabaseAccounts.beginDeleteAndWait.mockResolvedValue(undefined);
      await mgr.deleteAccount("rg-1", "cosmos-1");
      expect(mockDatabaseAccounts.beginDeleteAndWait).toHaveBeenCalledWith("rg-1", "cosmos-1");
    });
  });

  describe("listKeys", () => {
    it("lists account keys", async () => {
      mockDatabaseAccounts.listKeys.mockResolvedValue({
        primaryMasterKey: "pk", secondaryMasterKey: "sk",
        primaryReadonlyMasterKey: "prk", secondaryReadonlyMasterKey: "srk",
      });
      const keys = await mgr.listKeys("rg-1", "cosmos-1");
      expect(keys.primaryMasterKey).toBe("pk");
    });
  });

  describe("createDatabase", () => {
    it("creates a SQL database", async () => {
      mockSqlResources.beginCreateUpdateSqlDatabaseAndWait.mockResolvedValue({
        id: "db-id", name: "new-db",
      });
      const db = await mgr.createDatabase("rg-1", "cosmos-1", "new-db");
      expect(db.name).toBe("new-db");
    });
  });

  describe("deleteDatabase", () => {
    it("deletes a SQL database", async () => {
      mockSqlResources.beginDeleteSqlDatabaseAndWait.mockResolvedValue(undefined);
      await mgr.deleteDatabase("rg-1", "cosmos-1", "my-db");
      expect(mockSqlResources.beginDeleteSqlDatabaseAndWait).toHaveBeenCalledWith("rg-1", "cosmos-1", "my-db");
    });
  });

  describe("createContainer", () => {
    it("creates a SQL container", async () => {
      mockSqlResources.beginCreateUpdateSqlContainerAndWait.mockResolvedValue({
        id: "c-id", name: "new-container",
      });
      const container = await mgr.createContainer("rg-1", "cosmos-1", "my-db", "new-container", "/pk");
      expect(container.name).toBe("new-container");
    });
  });

  describe("deleteContainer", () => {
    it("deletes a SQL container", async () => {
      mockSqlResources.beginDeleteSqlContainerAndWait.mockResolvedValue(undefined);
      await mgr.deleteContainer("rg-1", "cosmos-1", "my-db", "my-container");
      expect(mockSqlResources.beginDeleteSqlContainerAndWait).toHaveBeenCalledWith("rg-1", "cosmos-1", "my-db", "my-container");
    });
  });

  describe("updateDatabaseThroughput", () => {
    it("updates database throughput", async () => {
      mockSqlResources.beginUpdateSqlDatabaseThroughputAndWait.mockResolvedValue(undefined);
      await mgr.updateDatabaseThroughput("rg-1", "cosmos-1", "my-db", 800);
      expect(mockSqlResources.beginUpdateSqlDatabaseThroughputAndWait).toHaveBeenCalled();
    });
  });

  describe("updateContainerThroughput", () => {
    it("updates container throughput", async () => {
      mockSqlResources.beginUpdateSqlContainerThroughputAndWait.mockResolvedValue(undefined);
      await mgr.updateContainerThroughput("rg-1", "cosmos-1", "my-db", "my-container", 1200);
      expect(mockSqlResources.beginUpdateSqlContainerThroughputAndWait).toHaveBeenCalled();
    });
  });
});
