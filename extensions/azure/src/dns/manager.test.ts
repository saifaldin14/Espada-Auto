/**
 * Azure DNS Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureDNSManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockZones = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
};

const mockRecordSets = {
  listByDnsZone: vi.fn(),
  createOrUpdate: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@azure/arm-dns", () => ({
  DnsManagementClient: vi.fn().mockImplementation(() => ({
    zones: mockZones,
    recordSets: mockRecordSets,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureDNSManager", () => {
  let mgr: AzureDNSManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureDNSManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listZones", () => {
    it("lists all zones", async () => {
      mockZones.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/dnszones/example.com", name: "example.com", location: "global", properties: { numberOfRecordSets: 5, nameServers: ["ns1.azure-dns.com"] }, tags: {} },
      ]));
      const zones = await mgr.listZones();
      expect(zones).toHaveLength(1);
      expect(zones[0].name).toBe("example.com");
    });

    it("filters by resource group", async () => {
      mockZones.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listZones("rg-1");
      expect(mockZones.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });

    it("returns empty array when none exist", async () => {
      mockZones.list.mockReturnValue(asyncIter([]));
      expect(await mgr.listZones()).toEqual([]);
    });
  });

  describe("getZone", () => {
    it("returns zone info", async () => {
      mockZones.get.mockResolvedValue({ name: "example.com", location: "global", id: "z-id", properties: { numberOfRecordSets: 3, nameServers: [] } });
      const zone = await mgr.getZone("rg-1", "example.com");
      expect(zone.name).toBe("example.com");
    });
  });

  describe("listRecordSets", () => {
    it("lists records for a zone", async () => {
      mockRecordSets.listByDnsZone.mockReturnValue(asyncIter([
        { id: "rec-1", name: "www", type: "Microsoft.Network/dnszones/A", properties: { ttl: 300, aRecords: [{ ipv4Address: "1.2.3.4" }] } },
        { id: "rec-2", name: "mail", type: "Microsoft.Network/dnszones/MX", properties: { ttl: 600, mxRecords: [{ preference: 10, exchange: "mail.example.com" }] } },
      ]));
      const records = await mgr.listRecordSets("rg-1", "example.com");
      expect(records).toHaveLength(2);
      expect(records[0].name).toBe("www");
    });
  });

  describe("createRecordSet", () => {
    it("creates a record set", async () => {
      mockRecordSets.createOrUpdate.mockResolvedValue({ id: "rec-id", name: "api", type: "Microsoft.Network/dnszones/A", properties: { ttl: 300 } });
      const rec = await mgr.createRecordSet("rg-1", "example.com", "api", "A", 300, { aRecords: [{ ipv4Address: "5.6.7.8" }] });
      expect(rec.name).toBe("api");
    });
  });

  describe("deleteRecordSet", () => {
    it("deletes a record set", async () => {
      mockRecordSets.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteRecordSet("rg-1", "example.com", "old", "A")).resolves.toBeUndefined();
    });
  });
});
