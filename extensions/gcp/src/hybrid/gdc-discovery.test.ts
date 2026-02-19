/**
 * Tests for GDC Discovery Adapter
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GDCDiscoveryAdapter } from "./gdc-discovery.js";
import type { GDCZone, GDCNode } from "./types.js";

describe("GDCDiscoveryAdapter", () => {
  let adapter: GDCDiscoveryAdapter;

  beforeEach(() => {
    adapter = new GDCDiscoveryAdapter("my-project");
  });

  describe("discoverSites", () => {
    it("maps GDC zones to edge sites", async () => {
      const zone: GDCZone = {
        name: "projects/my-project/locations/us-central1/zones/zone-1",
        displayName: "Central Datacenter",
        state: "ACTIVE",
        createTime: "2024-01-01T00:00:00Z",
        labels: { env: "prod" },
      };

      const node: GDCNode = {
        name: "node-1",
        nodeId: "n1",
        zone: "projects/my-project/locations/us-central1/zones/zone-1",
        machineType: "n2-standard-8",
        state: "RUNNING",
        createTime: "2024-01-01T00:00:00Z",
      };

      vi.spyOn(adapter, "listGDCZones").mockResolvedValue([zone]);
      vi.spyOn(adapter, "listGDCNodes").mockResolvedValue([node]);

      const sites = await adapter.discoverSites();

      expect(sites).toHaveLength(1);
      expect(sites[0].provider).toBe("gdc");
      expect(sites[0].name).toBe("Central Datacenter");
      expect(sites[0].type).toBe("datacenter");
      expect(sites[0].status).toBe("connected");
      expect(sites[0].capabilities).toContain("disconnected-ops");
      expect(sites[0].resourceCount).toBe(1);
    });

    it("identifies GPU capabilities from machine types", async () => {
      vi.spyOn(adapter, "listGDCZones").mockResolvedValue([{
        name: "projects/p/locations/l/zones/z1",
        state: "ACTIVE",
        createTime: "2024-01-01T00:00:00Z",
      }]);

      vi.spyOn(adapter, "listGDCNodes").mockResolvedValue([{
        name: "gpu-node",
        nodeId: "gn1",
        zone: "projects/p/locations/l/zones/z1",
        machineType: "a2-highgpu-1g",
        state: "RUNNING",
        createTime: "2024-01-01T00:00:00Z",
      }]);

      const sites = await adapter.discoverSites();
      expect(sites[0].capabilities).toContain("gpu");
      expect(sites[0].capabilities).toContain("ai-inference");
    });

    it("maps creating zone to intermittent status", async () => {
      vi.spyOn(adapter, "listGDCZones").mockResolvedValue([{
        name: "projects/p/locations/l/zones/z1",
        state: "CREATING",
        createTime: "2024-01-01T00:00:00Z",
      }]);
      vi.spyOn(adapter, "listGDCNodes").mockResolvedValue([]);

      const sites = await adapter.discoverSites();
      expect(sites[0].status).toBe("intermittent");
    });

    it("maps deleting zone to disconnected", async () => {
      vi.spyOn(adapter, "listGDCZones").mockResolvedValue([{
        name: "projects/p/locations/l/zones/z1",
        state: "DELETING",
        createTime: "2024-01-01T00:00:00Z",
      }]);
      vi.spyOn(adapter, "listGDCNodes").mockResolvedValue([]);

      const sites = await adapter.discoverSites();
      expect(sites[0].status).toBe("disconnected");
    });
  });

  describe("discoverFleet", () => {
    it("groups nodes by zone as pseudo-fleets", async () => {
      const nodes: GDCNode[] = [
        { name: "n1", nodeId: "n1", zone: "projects/p/locations/l/zones/z1", machineType: "n2-standard-4", state: "RUNNING", createTime: "2024-01-01T00:00:00Z" },
        { name: "n2", nodeId: "n2", zone: "projects/p/locations/l/zones/z1", machineType: "n2-standard-4", state: "RUNNING", createTime: "2024-01-01T00:00:00Z" },
        { name: "n3", nodeId: "n3", zone: "projects/p/locations/l/zones/z2", machineType: "n2-standard-8", state: "RUNNING", createTime: "2024-01-01T00:00:00Z" },
      ];

      vi.spyOn(adapter, "listGDCNodes").mockResolvedValue(nodes);

      const clusters = await adapter.discoverFleet();

      expect(clusters).toHaveLength(2);
      const z1 = clusters.find((c) => c.id.includes("z1"));
      expect(z1?.nodeCount).toBe(2);
      expect(z1?.status).toBe("healthy");
      expect(z1?.connectivity).toBe("disconnected"); // GDC is air-gapped
    });

    it("detects degraded status when nodes have errors", async () => {
      vi.spyOn(adapter, "listGDCNodes").mockResolvedValue([
        { name: "n1", nodeId: "n1", zone: "z1", machineType: "m1", state: "RUNNING", createTime: "2024-01-01T00:00:00Z" },
        { name: "n2", nodeId: "n2", zone: "z1", machineType: "m1", state: "ERROR", createTime: "2024-01-01T00:00:00Z" },
      ]);

      const clusters = await adapter.discoverFleet();
      expect(clusters[0].status).toBe("degraded");
    });

    it("detects offline status for empty zones", async () => {
      vi.spyOn(adapter, "listGDCNodes").mockResolvedValue([]);

      const clusters = await adapter.discoverFleet();
      expect(clusters).toHaveLength(0);
    });
  });

  describe("discoverConnections", () => {
    it("returns empty (GDC is air-gapped)", async () => {
      const connections = await adapter.discoverConnections();
      expect(connections).toEqual([]);
    });
  });

  describe("healthCheck", () => {
    it("returns true when API succeeds", async () => {
      vi.spyOn(adapter, "listGDCZones").mockResolvedValue([]);
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false on failure", async () => {
      vi.spyOn(adapter, "listGDCZones").mockRejectedValue(new Error("denied"));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });
});
