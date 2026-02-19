/**
 * Tests for GKE Fleet Discovery Adapter
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GKEFleetDiscoveryAdapter } from "./fleet-discovery.js";
import type {
  GKEFleetMembership,
  GKEOnPremCluster,
  GKEBareMetalCluster,
} from "./types.js";

describe("GKEFleetDiscoveryAdapter", () => {
  let adapter: GKEFleetDiscoveryAdapter;

  beforeEach(() => {
    adapter = new GKEFleetDiscoveryAdapter("my-project");
  });

  describe("discoverSites", () => {
    it("groups on-prem memberships into sites", async () => {
      const membership: GKEFleetMembership = {
        name: "projects/my-project/locations/us-central1/memberships/m-1",
        endpoint: { onPremCluster: { resourceLink: "cluster-link" } },
        state: { code: "READY" },
        createTime: "2024-01-01T00:00:00Z",
        uniqueId: "uid-1",
        infrastructureType: "ON_PREM",
        lastConnectionTime: "2024-01-01T12:00:00Z",
      };

      vi.spyOn(adapter, "listFleetMemberships").mockResolvedValue([membership]);

      const sites = await adapter.discoverSites();

      expect(sites).toHaveLength(1);
      expect(sites[0].provider).toBe("gcp");
      expect(sites[0].type).toBe("datacenter");
      expect(sites[0].status).toBe("connected");
    });

    it("infers intermittent status with mixed membership states", async () => {
      const readyMembership: GKEFleetMembership = {
        name: "projects/my-project/locations/us-central1/memberships/m-1",
        endpoint: { onPremCluster: { resourceLink: "cl-1" } },
        state: { code: "READY" },
        createTime: "2024-01-01T00:00:00Z",
        uniqueId: "uid-1",
        infrastructureType: "ON_PREM",
      };

      const creatingMembership: GKEFleetMembership = {
        name: "projects/my-project/locations/us-central1/memberships/m-2",
        endpoint: { onPremCluster: { resourceLink: "cl-2" } },
        state: { code: "CREATING" },
        createTime: "2024-01-01T00:00:00Z",
        uniqueId: "uid-2",
        infrastructureType: "ON_PREM",
      };

      vi.spyOn(adapter, "listFleetMemberships").mockResolvedValue([
        readyMembership,
        creatingMembership,
      ]);

      const sites = await adapter.discoverSites();
      expect(sites[0].status).toBe("intermittent");
    });

    it("returns empty for cloud-only memberships", async () => {
      const cloudMembership: GKEFleetMembership = {
        name: "projects/my-project/locations/us-central1/memberships/m-1",
        endpoint: { gkeCluster: { resourceLink: "gke-link" } },
        state: { code: "READY" },
        createTime: "2024-01-01T00:00:00Z",
        uniqueId: "uid-1",
      };

      vi.spyOn(adapter, "listFleetMemberships").mockResolvedValue([cloudMembership]);

      const sites = await adapter.discoverSites();
      expect(sites).toHaveLength(0);
    });
  });

  describe("discoverFleet", () => {
    it("maps on-prem VMware clusters", async () => {
      const onPrem: GKEOnPremCluster = {
        name: "projects/my-project/locations/us-central1/vmwareClusters/cluster-1",
        onPremVersion: "1.28.100-gke.1",
        state: "RUNNING",
        createTime: "2024-01-01T00:00:00Z",
        uid: "uid-1",
        controlPlaneNode: { cpus: 4, memory: 8192, replicas: 3 },
        fleet: { membership: "projects/my-project/locations/us-central1/memberships/m-1" },
        localName: "prod-cluster",
      };

      vi.spyOn(adapter, "listFleetMemberships").mockResolvedValue([]);
      vi.spyOn(adapter, "listOnPremClusters").mockResolvedValue([onPrem]);
      vi.spyOn(adapter, "listBareMetalClusters").mockResolvedValue([]);

      const clusters = await adapter.discoverFleet();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].provider).toBe("gcp");
      expect(clusters[0].name).toBe("prod-cluster");
      expect(clusters[0].kubernetesVersion).toBe("1.28.100-gke.1");
      expect(clusters[0].status).toBe("healthy");
      expect(clusters[0].connectivity).toBe("connected");
    });

    it("maps bare-metal clusters", async () => {
      const bareMetal: GKEBareMetalCluster = {
        name: "projects/my-project/locations/us-central1/bareMetalClusters/bm-1",
        bareMetalVersion: "1.28.0",
        state: "RUNNING",
        createTime: "2024-01-01T00:00:00Z",
        uid: "uid-2",
        nodeCount: 5,
        fleet: { membership: "m-1" },
        localName: "bm-cluster",
      };

      vi.spyOn(adapter, "listFleetMemberships").mockResolvedValue([]);
      vi.spyOn(adapter, "listOnPremClusters").mockResolvedValue([]);
      vi.spyOn(adapter, "listBareMetalClusters").mockResolvedValue([bareMetal]);

      const clusters = await adapter.discoverFleet();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].name).toBe("bm-cluster");
      expect(clusters[0].nodeCount).toBe(5);
      expect(clusters[0].status).toBe("healthy");
    });

    it("maps provisioning status correctly", async () => {
      vi.spyOn(adapter, "listFleetMemberships").mockResolvedValue([]);
      vi.spyOn(adapter, "listOnPremClusters").mockResolvedValue([{
        name: "projects/p/locations/l/vmwareClusters/c1",
        onPremVersion: "1.28.0",
        state: "PROVISIONING",
        createTime: "2024-01-01T00:00:00Z",
        uid: "uid",
      }]);
      vi.spyOn(adapter, "listBareMetalClusters").mockResolvedValue([]);

      const clusters = await adapter.discoverFleet();
      expect(clusters[0].status).toBe("provisioning");
    });

    it("includes memberships without a matching cluster", async () => {
      const membership: GKEFleetMembership = {
        name: "projects/p/locations/l/memberships/orphan",
        endpoint: { gkeCluster: { resourceLink: "link" } },
        state: { code: "READY" },
        createTime: "2024-01-01T00:00:00Z",
        uniqueId: "uid",
        lastConnectionTime: "2024-06-01T00:00:00Z",
      };

      vi.spyOn(adapter, "listFleetMemberships").mockResolvedValue([membership]);
      vi.spyOn(adapter, "listOnPremClusters").mockResolvedValue([]);
      vi.spyOn(adapter, "listBareMetalClusters").mockResolvedValue([]);

      const clusters = await adapter.discoverFleet();
      expect(clusters).toHaveLength(1);
      expect(clusters[0].name).toBe("orphan");
      expect(clusters[0].status).toBe("healthy");
      expect(clusters[0].connectivity).toBe("connected");
    });
  });

  describe("discoverConnections", () => {
    it("returns empty (no connection topology)", async () => {
      const connections = await adapter.discoverConnections();
      expect(connections).toEqual([]);
    });
  });

  describe("healthCheck", () => {
    it("returns true when API succeeds", async () => {
      vi.spyOn(adapter, "listFleets").mockResolvedValue([]);
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false on failure", async () => {
      vi.spyOn(adapter, "listFleets").mockRejectedValue(new Error("denied"));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });
});
