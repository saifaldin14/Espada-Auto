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
};

const mockSqlResources = {
  listSqlDatabases: vi.fn(),
  listSqlContainers: vi.fn(),
  getSqlDatabaseThroughput: vi.fn(),
};

vi.mock("@azure/arm-cosmosdb", () => ({
  CosmosDBManagementClient: vi.fn().mockImplementation(() => ({
    databaseAccounts: mockDatabaseAccounts,
    sqlResources: mockSqlResources,
  })),
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
});
