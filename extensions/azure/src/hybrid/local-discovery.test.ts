/**
 * Tests for Azure Local / HCI Discovery Adapter.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AzureLocalDiscoveryAdapter } from "./local-discovery.js";
import type { AzureHybridManager } from "./manager.js";
import type { AzureStackHCICluster } from "./types.js";

// -- Mock Manager --

function createMockManager(): AzureHybridManager {
  return {
    listArcServers: vi.fn().mockResolvedValue([]),
    getArcServer: vi.fn().mockResolvedValue(null),
    listArcServerExtensions: vi.fn().mockResolvedValue([]),
    listArcKubernetesClusters: vi.fn().mockResolvedValue([]),
    getArcKubernetesCluster: vi.fn().mockResolvedValue(null),
    listHCIClusters: vi.fn().mockResolvedValue([]),
    getHCICluster: vi.fn().mockResolvedValue(null),
    listCustomLocations: vi.fn().mockResolvedValue([]),
    getCustomLocation: vi.fn().mockResolvedValue(null),
    discoverAll: vi.fn().mockResolvedValue({
      arcServers: [],
      arcClusters: [],
      hciClusters: [],
      customLocations: [],
      subscriptionId: "sub-1",
      discoveredAt: new Date().toISOString(),
    }),
  } as unknown as AzureHybridManager;
}

// -- Factories --

function makeHCICluster(overrides: Partial<AzureStackHCICluster> = {}): AzureStackHCICluster {
  return {
    id: "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.AzureStackHCI/clusters/hci-1",
    name: "hci-prod-cluster",
    type: "Microsoft.AzureStackHCI/clusters",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    location: "westus2",
    tags: { env: "production" },
    status: "Connected",
    cloudId: "cloud-id-1",
    trialDaysRemaining: 0,
    nodeCount: 4,
    clusterVersion: "23H2",
    serviceEndpoint: "https://hci.westus2.azurestack.net",
    lastSyncTimestamp: "2026-01-15T10:00:00Z",
    registrationTimestamp: "2025-06-01T00:00:00Z",
    ...overrides,
  } as AzureStackHCICluster;
}

describe("AzureLocalDiscoveryAdapter", () => {
  let manager: AzureHybridManager;
  let adapter: AzureLocalDiscoveryAdapter;

  beforeEach(() => {
    manager = createMockManager();
    adapter = new AzureLocalDiscoveryAdapter(manager, "sub-1");
  });

  describe("discoverSites", () => {
    it("maps HCI clusters to datacenter sites", async () => {
      const hci = makeHCICluster();
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const sites = await adapter.discoverSites();

      expect(sites).toHaveLength(1);
      expect(sites[0]!.name).toBe("hci-prod-cluster");
      expect(sites[0]!.provider).toBe("azure");
      expect(sites[0]!.type).toBe("datacenter");
      expect(sites[0]!.parentCloudRegion).toBe("westus2");
      expect(sites[0]!.status).toBe("connected");
      expect(sites[0]!.capabilities).toContain("compute");
      expect(sites[0]!.capabilities).toContain("disconnected-ops");
    });

    it("includes node count in resource count", async () => {
      const hci = makeHCICluster({ nodeCount: 3 });
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.resourceCount).toBe(3);
    });

    it("detects disconnected HCI clusters", async () => {
      const hci = makeHCICluster({ status: "Disconnected" });
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.status).toBe("disconnected");
    });
  });

  describe("discoverFleet", () => {
    it("maps HCI clusters to fleet clusters (AKS-HCI)", async () => {
      vi.mocked(manager.listHCIClusters).mockResolvedValue([makeHCICluster()]);

      const fleet = await adapter.discoverFleet();

      expect(fleet).toHaveLength(1);
      expect(fleet[0]!.name).toContain("AKS on hci-prod-cluster");
      expect(fleet[0]!.provider).toBe("azure");
      expect(fleet[0]!.kubernetesVersion).toBe("23H2");
      expect(fleet[0]!.status).toBe("healthy");
      expect(fleet[0]!.connectivity).toBe("connected");
    });

    it("maps disconnected HCI to offline fleet status", async () => {
      const hci = makeHCICluster({ status: "Disconnected" });
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const fleet = await adapter.discoverFleet();

      expect(fleet[0]!.status).toBe("offline");
      expect(fleet[0]!.connectivity).toBe("disconnected");
    });

    it("skips HCI clusters without clusterVersion", async () => {
      const hci = makeHCICluster({ clusterVersion: undefined });
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const fleet = await adapter.discoverFleet();

      expect(fleet).toHaveLength(0);
    });
  });

  describe("discoverConnections", () => {
    it("creates connections for HCI clusters with service endpoints", async () => {
      vi.mocked(manager.listHCIClusters).mockResolvedValue([makeHCICluster()]);

      const connections = await adapter.discoverConnections();

      expect(connections).toHaveLength(1);
      expect(connections[0]!.type).toBe("internet");
      expect(connections[0]!.status).toBe("connected");
    });

    it("skips HCI clusters without service endpoints", async () => {
      const hci = makeHCICluster({ serviceEndpoint: undefined });
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const connections = await adapter.discoverConnections();

      expect(connections).toHaveLength(0);
    });
  });

  describe("discoverHybridResources", () => {
    it("creates graph nodes for HCI clusters", async () => {
      vi.mocked(manager.listHCIClusters).mockResolvedValue([makeHCICluster()]);

      const nodes = await adapter.discoverHybridResources();

      expect(nodes).toHaveLength(1);
      const hciNode = nodes[0]!;
      expect(hciNode.resourceType).toBe("hci-cluster");
      expect(hciNode.name).toBe("hci-prod-cluster");
      expect(hciNode.status).toBe("running");
    });

    it("sets correct node IDs following KG convention", async () => {
      vi.mocked(manager.listHCIClusters).mockResolvedValue([makeHCICluster()]);

      const nodes = await adapter.discoverHybridResources();
      const hciNode = nodes[0]!;

      expect(hciNode.id).toContain("azure::");
      expect(hciNode.id).toContain("westus2");
      expect(hciNode.id).toContain("hci-cluster");
    });

    it("maps HCI status to node status", async () => {
      vi.mocked(manager.listHCIClusters).mockResolvedValue([
        makeHCICluster({ status: "Connected" }),
        makeHCICluster({ id: "hci-2", name: "hci-2", status: "Disconnected" }),
      ]);

      const nodes = await adapter.discoverHybridResources();

      expect(nodes[0]!.status).toBe("running");
      expect(nodes[1]!.status).toBe("error");
    });
  });

  describe("healthCheck", () => {
    it("returns true when API responds", async () => {
      vi.mocked(manager.listHCIClusters).mockResolvedValue([]);
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false on API failure", async () => {
      vi.mocked(manager.listHCIClusters).mockRejectedValue(new Error("API error"));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("capability inference", () => {
    it("adds ai-inference for large HCI clusters (4+ nodes)", async () => {
      const hci = makeHCICluster({ nodeCount: 4 });
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.capabilities).toContain("ai-inference");
    });

    it("omits ai-inference for small HCI clusters", async () => {
      const hci = makeHCICluster({ nodeCount: 2 });
      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.capabilities).not.toContain("ai-inference");
    });
  });
});
