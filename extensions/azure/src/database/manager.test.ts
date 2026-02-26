import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureDatabaseManager } from "./manager.js";

/** Helper to create an async iterable from an array. */
function asyncIter<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const i of items) yield i;
    },
  };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureDatabaseManager", () => {
  let manager: AzureDatabaseManager;

  const mockMySqlServers = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  const mockMySqlDatabases = {
    listByServer: vi.fn(),
  };

  const mockMySqlFirewallRules = {
    listByServer: vi.fn(),
  };

  const mockPgServers = {
    listBySubscription: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  const mockPgDatabases = {
    listByServer: vi.fn(),
  };

  const mockPgFirewallRules = {
    listByServer: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureDatabaseManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getMySqlClient").mockResolvedValue({
      servers: mockMySqlServers,
      databases: mockMySqlDatabases,
      firewallRules: mockMySqlFirewallRules,
    });

    vi.spyOn(manager as any, "getPgClient").mockResolvedValue({
      servers: mockPgServers,
      databases: mockPgDatabases,
      firewallRules: mockPgFirewallRules,
    });
  });

  // ---------------------------------------------------------------------------
  // MySQL Servers
  // ---------------------------------------------------------------------------

  describe("listMySqlServers", () => {
    it("lists all MySQL servers across the subscription", async () => {
      mockMySqlServers.list.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DBforMySQL/flexibleServers/mysql1", name: "mysql1", location: "eastus" },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.DBforMySQL/flexibleServers/mysql2", name: "mysql2", location: "westus" },
        ]),
      );

      const result = await manager.listMySqlServers();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("mysql1");
      expect(result[1].name).toBe("mysql2");
      expect(mockMySqlServers.list).toHaveBeenCalled();
    });

    it("filters by resource group when provided", async () => {
      mockMySqlServers.listByResourceGroup.mockReturnValue(
        asyncIter([{ id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DBforMySQL/flexibleServers/mysql1", name: "mysql1", location: "eastus" }]),
      );

      const result = await manager.listMySqlServers("rg1");
      expect(result).toHaveLength(1);
      expect(mockMySqlServers.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getMySqlServer", () => {
    it("returns a MySQL server by name", async () => {
      mockMySqlServers.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DBforMySQL/flexibleServers/mysql1",
        name: "mysql1",
        location: "eastus",
        state: "Ready",
        version: "8.0.21",
      });

      const result = await manager.getMySqlServer("rg1", "mysql1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("mysql1");
      expect(result!.state).toBe("Ready");
    });

    it("returns null for 404", async () => {
      mockMySqlServers.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getMySqlServer("rg1", "nonexistent");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockMySqlServers.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getMySqlServer("rg1", "mysql1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteMySqlServer", () => {
    it("deletes a MySQL server", async () => {
      mockMySqlServers.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteMySqlServer("rg1", "mysql1")).resolves.toBeUndefined();
      expect(mockMySqlServers.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "mysql1");
    });
  });

  // ---------------------------------------------------------------------------
  // MySQL Databases
  // ---------------------------------------------------------------------------

  describe("listMySqlDatabases", () => {
    it("lists databases in a MySQL server", async () => {
      mockMySqlDatabases.listByServer.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/mysql1/databases/db1", name: "db1", charset: "utf8mb4", collation: "utf8mb4_general_ci" },
          { id: "/sub/rg/mysql1/databases/db2", name: "db2", charset: "utf8", collation: "utf8_general_ci" },
        ]),
      );

      const result = await manager.listMySqlDatabases("rg1", "mysql1");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("db1");
      expect(result[0].charset).toBe("utf8mb4");
      expect(mockMySqlDatabases.listByServer).toHaveBeenCalledWith("rg1", "mysql1");
    });
  });

  // ---------------------------------------------------------------------------
  // MySQL Firewall Rules
  // ---------------------------------------------------------------------------

  describe("listMySqlFirewallRules", () => {
    it("lists firewall rules for a MySQL server", async () => {
      mockMySqlFirewallRules.listByServer.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/mysql1/firewallRules/rule1", name: "rule1", startIpAddress: "10.0.0.1", endIpAddress: "10.0.0.255" },
        ]),
      );

      const result = await manager.listMySqlFirewallRules("rg1", "mysql1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("rule1");
      expect(result[0].startIpAddress).toBe("10.0.0.1");
    });
  });

  // ---------------------------------------------------------------------------
  // PostgreSQL Servers
  // ---------------------------------------------------------------------------

  describe("listPgServers", () => {
    it("lists all PostgreSQL servers across the subscription", async () => {
      mockPgServers.listBySubscription.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg1", name: "pg1", location: "eastus" },
        ]),
      );

      const result = await manager.listPgServers();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("pg1");
      expect(mockPgServers.listBySubscription).toHaveBeenCalled();
    });

    it("filters by resource group when provided", async () => {
      mockPgServers.listByResourceGroup.mockReturnValue(
        asyncIter([{ id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg1", name: "pg1", location: "eastus" }]),
      );

      const result = await manager.listPgServers("rg1");
      expect(result).toHaveLength(1);
      expect(mockPgServers.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getPgServer", () => {
    it("returns a PostgreSQL server by name", async () => {
      mockPgServers.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg1",
        name: "pg1",
        location: "eastus",
        state: "Ready",
        version: "15",
      });

      const result = await manager.getPgServer("rg1", "pg1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("pg1");
      expect(result!.state).toBe("Ready");
    });

    it("returns null for 404", async () => {
      mockPgServers.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getPgServer("rg1", "nonexistent");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockPgServers.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getPgServer("rg1", "pg1")).rejects.toThrow("Server error");
    });
  });

  describe("deletePgServer", () => {
    it("deletes a PostgreSQL server", async () => {
      mockPgServers.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deletePgServer("rg1", "pg1")).resolves.toBeUndefined();
      expect(mockPgServers.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "pg1");
    });
  });

  // ---------------------------------------------------------------------------
  // PostgreSQL Databases
  // ---------------------------------------------------------------------------

  describe("listPgDatabases", () => {
    it("lists databases in a PostgreSQL server", async () => {
      mockPgDatabases.listByServer.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/pg1/databases/db1", name: "db1", charset: "UTF8", collation: "en_US.utf8" },
        ]),
      );

      const result = await manager.listPgDatabases("rg1", "pg1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("db1");
      expect(result[0].charset).toBe("UTF8");
      expect(mockPgDatabases.listByServer).toHaveBeenCalledWith("rg1", "pg1");
    });
  });

  // ---------------------------------------------------------------------------
  // PostgreSQL Firewall Rules
  // ---------------------------------------------------------------------------

  describe("listPgFirewallRules", () => {
    it("lists firewall rules for a PostgreSQL server", async () => {
      mockPgFirewallRules.listByServer.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/pg1/firewallRules/rule1", name: "rule1", startIpAddress: "10.0.0.1", endIpAddress: "10.0.0.255" },
        ]),
      );

      const result = await manager.listPgFirewallRules("rg1", "pg1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("rule1");
      expect(result[0].startIpAddress).toBe("10.0.0.1");
    });
  });
});
