/**
 * Tests for Azure Arc Discovery Adapter
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureArcDiscoveryAdapter } from "./arc-discovery.js";
import type { AzureHybridManager } from "./manager.js";
import type {
  AzureArcKubernetesCluster,
  AzureStackHCICluster,
  AzureCustomLocation,
} from "./types.js";

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
      subscriptionId: "sub-123",
      discoveredAt: new Date().toISOString(),
    }),
  } as unknown as AzureHybridManager;
}

describe("AzureArcDiscoveryAdapter", () => {
  let manager: AzureHybridManager;
  let adapter: AzureArcDiscoveryAdapter;

  beforeEach(() => {
    manager = createMockManager();
    adapter = new AzureArcDiscoveryAdapter(manager);
  });

  describe("discoverSites", () => {
    it("maps HCI clusters to edge sites", async () => {
      const hci: AzureStackHCICluster = {
        id: "/subscriptions/sub-123/resourceGroups/rg/providers/Microsoft.AzureStackHCI/clusters/hci-01",
        name: "hci-01",
        type: "Microsoft.AzureStackHCI/clusters",
        location: "eastus",
        resourceGroup: "rg",
        subscriptionId: "sub-123",
        status: "Connected",
        nodeCount: 4,
        trialDaysRemaining: 0,
        clusterVersion: "23H2",
      };

      vi.mocked(manager.listHCIClusters).mockResolvedValue([hci]);

      const sites = await adapter.discoverSites();

      expect(sites).toHaveLength(1);
      expect(sites[0].provider).toBe("azure-arc");
      expect(sites[0].type).toBe("datacenter");
      expect(sites[0].status).toBe("connected");
      expect(sites[0].capabilities).toContain("disconnected-ops");
      expect(sites[0].resourceCount).toBe(4);
    });

    it("maps custom locations to edge sites", async () => {
      const customLoc: AzureCustomLocation = {
        id: "/subscriptions/sub-123/resourceGroups/rg/providers/Microsoft.ExtendedLocation/customLocations/loc-01",
        name: "loc-01",
        type: "Microsoft.ExtendedLocation/customLocations",
        location: "westus",
        resourceGroup: "rg",
        subscriptionId: "sub-123",
        hostResourceId: "/subscriptions/sub-123/resourceGroups/rg/providers/Microsoft.Kubernetes/connectedClusters/cluster-01",
        hostType: "Kubernetes",
        provisioningState: "Succeeded",
        displayName: "Factory Floor",
        clusterExtensionIds: ["ext-1", "ext-2"],
      };

      vi.mocked(manager.listCustomLocations).mockResolvedValue([customLoc]);

      const sites = await adapter.discoverSites();

      expect(sites).toHaveLength(1);
      expect(sites[0].name).toBe("Factory Floor");
      expect(sites[0].type).toBe("edge-site");
      expect(sites[0].status).toBe("connected");
      expect(sites[0].resourceCount).toBe(2);
    });

    it("deduplicates HCI and custom location sites", async () => {
      const sharedId = "shared-id";

      vi.mocked(manager.listHCIClusters).mockResolvedValue([{
        id: sharedId,
        name: "hci",
        type: "Microsoft.AzureStackHCI/clusters",
        location: "eastus",
        resourceGroup: "rg",
        subscriptionId: "sub-123",
        status: "Connected",
        nodeCount: 2,
        trialDaysRemaining: 0,
      }]);

      vi.mocked(manager.listCustomLocations).mockResolvedValue([{
        id: sharedId,
        name: "custom-loc",
        type: "Microsoft.ExtendedLocation/customLocations",
        location: "eastus",
        resourceGroup: "rg",
        subscriptionId: "sub-123",
        hostResourceId: "host-1",
        hostType: "Kubernetes",
        provisioningState: "Succeeded",
      }]);

      const sites = await adapter.discoverSites();
      expect(sites).toHaveLength(1);
    });

    it("maps disconnected HCI to disconnected status", async () => {
      vi.mocked(manager.listHCIClusters).mockResolvedValue([{
        id: "hci-dc",
        name: "hci-dc",
        type: "Microsoft.AzureStackHCI/clusters",
        location: "eastus",
        resourceGroup: "rg",
        subscriptionId: "sub-123",
        status: "Disconnected",
        nodeCount: 1,
        trialDaysRemaining: 0,
      }]);

      const sites = await adapter.discoverSites();
      expect(sites[0].status).toBe("disconnected");
    });
  });

  describe("discoverFleet", () => {
    it("maps Arc K8s clusters to fleet clusters", async () => {
      const arcCluster: AzureArcKubernetesCluster = {
        id: "/subscriptions/sub-123/resourceGroups/rg/providers/Microsoft.Kubernetes/connectedClusters/cluster-01",
        name: "cluster-01",
        type: "Microsoft.Kubernetes/connectedClusters",
        location: "eastus",
        resourceGroup: "rg",
        subscriptionId: "sub-123",
        distribution: "k3s",
        kubernetesVersion: "1.28.4",
        totalNodeCount: 3,
        totalCoreCount: 12,
        agentVersion: "1.14.0",
        connectivityStatus: "Connected",
        lastConnectivityTime: "2024-01-01T12:00:00Z",
        infrastructure: "generic",
        provisioningState: "Succeeded",
      };

      vi.mocked(manager.listArcKubernetesClusters).mockResolvedValue([arcCluster]);

      const clusters = await adapter.discoverFleet();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].provider).toBe("azure-arc");
      expect(clusters[0].kubernetesVersion).toBe("1.28.4");
      expect(clusters[0].nodeCount).toBe(3);
      expect(clusters[0].status).toBe("healthy");
      expect(clusters[0].connectivity).toBe("connected");
    });

    it("maps offline cluster status correctly", async () => {
      vi.mocked(manager.listArcKubernetesClusters).mockResolvedValue([{
        id: "c1",
        name: "c1",
        type: "Microsoft.Kubernetes/connectedClusters",
        location: "eastus",
        resourceGroup: "rg",
        subscriptionId: "sub-123",
        distribution: "k3s",
        kubernetesVersion: "1.28.0",
        totalNodeCount: 1,
        totalCoreCount: 4,
        agentVersion: "1.14.0",
        connectivityStatus: "Offline",
        infrastructure: "generic",
        provisioningState: "Succeeded",
      }]);

      const clusters = await adapter.discoverFleet();
      expect(clusters[0].status).toBe("offline");
      expect(clusters[0].connectivity).toBe("disconnected");
    });
  });

  describe("discoverConnections", () => {
    it("returns empty (no connection topology from Arc)", async () => {
      const connections = await adapter.discoverConnections();
      expect(connections).toEqual([]);
    });
  });

  describe("healthCheck", () => {
    it("returns true when listArcServers succeeds", async () => {
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false when listArcServers fails", async () => {
      vi.mocked(manager.listArcServers).mockRejectedValue(new Error("auth"));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("discoverAll", () => {
    it("combines all resource types via manager", async () => {
      vi.mocked(manager.discoverAll).mockResolvedValue({
        arcServers: [],
        arcClusters: [],
        hciClusters: [],
        customLocations: [],
        subscriptionId: "sub-123",
        discoveredAt: "2024-01-15T12:00:00Z",
      });

      const result = await adapter.discoverAll();

      expect(result.subscriptionId).toBe("sub-123");
      expect(result.discoveredAt).toBeTruthy();
      expect(result.arcServers).toEqual([]);
      expect(result.arcClusters).toEqual([]);
      expect(result.hciClusters).toEqual([]);
      expect(result.localDevices).toEqual([]);
    });
  });
});