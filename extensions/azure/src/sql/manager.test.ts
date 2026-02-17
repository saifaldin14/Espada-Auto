/**
 * Azure SQL Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureSQLManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockServers = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
};

const mockDatabases = {
  listByServer: vi.fn(),
  get: vi.fn(),
};

const mockElasticPools = { listByServer: vi.fn() };

const mockFirewallRules = {
  listByServer: vi.fn(),
  createOrUpdate: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@azure/arm-sql", () => ({
  SqlManagementClient: vi.fn().mockImplementation(() => ({
    servers: mockServers,
    databases: mockDatabases,
    elasticPools: mockElasticPools,
    firewallRules: mockFirewallRules,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureSQLManager", () => {
  let mgr: AzureSQLManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureSQLManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  // ---------- Servers ----------

  describe("listServers", () => {
    it("lists all servers", async () => {
      mockServers.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Sql/servers/sql-1", name: "sql-1", location: "eastus", properties: { fullyQualifiedDomainName: "sql-1.database.windows.net", administratorLogin: "admin", version: "12.0", state: "Ready" }, tags: {} },
      ]));
      const servers = await mgr.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("sql-1");
    });

    it("filters by resource group", async () => {
      mockServers.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listServers("rg-1");
      expect(mockServers.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getServer", () => {
    it("returns server", async () => {
      mockServers.get.mockResolvedValue({ name: "sql-1", location: "eastus", id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Sql/servers/sql-1", properties: {} });
      const server = await mgr.getServer("rg-1", "sql-1");
      expect(server).not.toBeNull();
      expect(server!.name).toBe("sql-1");
    });

    it("returns null on 404", async () => {
      mockServers.get.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getServer("rg-1", "gone")).toBeNull();
    });
  });

  // ---------- Databases ----------

  describe("listDatabases", () => {
    it("lists databases for a server", async () => {
      mockDatabases.listByServer.mockReturnValue(asyncIter([
        { id: "db-id", name: "db-1", location: "eastus", properties: { status: "Online", collation: "SQL_Latin1_General_CP1_CI_AS", maxSizeBytes: 268435456000, sku: { name: "S0", tier: "Standard" } } },
      ]));
      const dbs = await mgr.listDatabases("rg-1", "sql-1");
      expect(dbs).toHaveLength(1);
      expect(dbs[0].name).toBe("db-1");
    });
  });

  describe("getDatabase", () => {
    it("returns null on 404", async () => {
      mockDatabases.get.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getDatabase("rg-1", "sql-1", "nope")).toBeNull();
    });
  });

  // ---------- Elastic Pools ----------

  describe("listElasticPools", () => {
    it("lists elastic pools", async () => {
      mockElasticPools.listByServer.mockReturnValue(asyncIter([
        { id: "ep-id", name: "pool-1", location: "eastus", properties: { state: "Ready", maxSizeBytes: 53687091200 }, sku: { name: "GP_Gen5", tier: "GeneralPurpose", capacity: 2 } },
      ]));
      const pools = await mgr.listElasticPools("rg-1", "sql-1");
      expect(pools).toHaveLength(1);
      expect(pools[0].name).toBe("pool-1");
    });
  });

  // ---------- Firewall Rules ----------

  describe("listFirewallRules", () => {
    it("lists rules", async () => {
      mockFirewallRules.listByServer.mockReturnValue(asyncIter([
        { id: "fw-id", name: "AllowAll", properties: { startIpAddress: "0.0.0.0", endIpAddress: "255.255.255.255" } },
      ]));
      const rules = await mgr.listFirewallRules("rg-1", "sql-1");
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe("AllowAll");
    });
  });

  describe("createFirewallRule", () => {
    it("creates a rule", async () => {
      mockFirewallRules.createOrUpdate.mockResolvedValue({ id: "fw-id", name: "office", properties: { startIpAddress: "10.0.0.1", endIpAddress: "10.0.0.1" } });
      const rule = await mgr.createFirewallRule("rg-1", "sql-1", "office", "10.0.0.1", "10.0.0.1");
      expect(rule.name).toBe("office");
    });
  });

  describe("deleteFirewallRule", () => {
    it("deletes a rule", async () => {
      mockFirewallRules.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteFirewallRule("rg-1", "sql-1", "old")).resolves.toBeUndefined();
    });
  });
});
