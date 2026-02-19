/**
 * Tests for Azure Local / HCI Discovery Adapter.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AzureLocalDiscoveryAdapter,
  type AzureLocalVM,
  type AzureLocalNetwork,
  type AzureLocalStorage,
} from "./local-discovery.js";
import type { AzureStackHCICluster, AzureLocalDevice } from "./types.js";

// ── Factories ───────────────────────────────────────────────────────────────

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

function makeLocalDevice(overrides: Partial<AzureLocalDevice> = {}): AzureLocalDevice {
  return {
    id: "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DataBoxEdge/dataBoxEdgeDevices/edge-1",
    name: "edge-device-1",
    type: "Microsoft.DataBoxEdge/dataBoxEdgeDevices",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    location: "eastus",
    tags: {},
    modelDescription: "Azure Stack Edge Pro 2",
    serialNumber: "ASE-001-2025",
    deviceType: "AzureStackEdge",
    deviceSoftwareVersion: "2.6.2",
    deviceLocalCapacity: 512,
    nodeCount: 1,
    configuredRoleTypes: ["IoT"],
    ...overrides,
  } as AzureLocalDevice;
}

function makeVM(overrides: Partial<AzureLocalVM> = {}): AzureLocalVM {
  return {
    id: "vm-1",
    name: "hci-vm-prod-1",
    resourceGroup: "rg",
    location: "westus2",
    status: "Running",
    hardwareProfile: { vmSize: "Standard_D4s", processors: 4, memoryMB: 16384 },
    osProfile: { computerName: "prod-vm-1", osType: "Linux" },
    hciClusterId: "hci-1",
    tags: { role: "web" },
    ...overrides,
  };
}

function makeNetwork(overrides: Partial<AzureLocalNetwork> = {}): AzureLocalNetwork {
  return {
    id: "net-1",
    name: "hci-vnet-prod",
    resourceGroup: "rg",
    location: "westus2",
    networkType: "transparent",
    subnets: [{ name: "default", addressPrefix: "10.0.0.0/24" }],
    hciClusterId: "hci-1",
    provisioningState: "Succeeded",
    tags: {},
    ...overrides,
  };
}

function makeStorage(overrides: Partial<AzureLocalStorage> = {}): AzureLocalStorage {
  return {
    id: "sc-1",
    name: "hci-storage-prod",
    resourceGroup: "rg",
    location: "westus2",
    path: "/volume/shared",
    provisioningState: "Succeeded",
    sizeGB: 1024,
    hciClusterId: "hci-1",
    tags: {},
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("AzureLocalDiscoveryAdapter", () => {
  let adapter: AzureLocalDiscoveryAdapter;

  beforeEach(() => {
    adapter = new AzureLocalDiscoveryAdapter("sub-1");
  });

  // ── discoverSites ─────────────────────────────────────────────────────

  describe("discoverSites", () => {
    it("maps HCI clusters to datacenter sites", async () => {
      const hci = makeHCICluster();
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([makeVM()]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([]);

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

    it("maps Azure Local devices to edge sites", async () => {
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([makeLocalDevice()]);

      const sites = await adapter.discoverSites();

      expect(sites).toHaveLength(1);
      expect(sites[0]!.name).toBe("edge-device-1");
      expect(sites[0]!.type).toBe("edge-site");
      expect(sites[0]!.parentCloudRegion).toBe("eastus");
    });

    it("deduplicates HCI and device sites by ID", async () => {
      const hci = makeHCICluster({ id: "shared-id" });
      const device = makeLocalDevice({ id: "shared-id" });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([device]);

      const sites = await adapter.discoverSites();

      // Should only have HCI (comes first), device deduped
      expect(sites).toHaveLength(1);
      expect(sites[0]!.type).toBe("datacenter");
    });

    it("includes VM count in resource count", async () => {
      const hci = makeHCICluster({ nodeCount: 3 });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([makeVM(), makeVM({ id: "vm-2", name: "vm-2" })]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([]);

      const sites = await adapter.discoverSites();

      // nodeCount + VMs = 3 + 2 = 5
      expect(sites[0]!.resourceCount).toBe(5);
    });

    it("detects disconnected HCI clusters", async () => {
      const hci = makeHCICluster({ status: "Disconnected" });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.status).toBe("disconnected");
    });

    it("infers GPU capabilities for ASE devices with GPU role", async () => {
      const device = makeLocalDevice({ configuredRoleTypes: ["GPU", "IoT"] });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([device]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.capabilities).toContain("gpu");
      expect(sites[0]!.capabilities).toContain("ai-inference");
    });
  });

  // ── discoverFleet ─────────────────────────────────────────────────────

  describe("discoverFleet", () => {
    it("maps HCI clusters to fleet clusters (AKS-HCI)", async () => {
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([makeHCICluster()]);

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
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);

      const fleet = await adapter.discoverFleet();

      expect(fleet[0]!.status).toBe("offline");
      expect(fleet[0]!.connectivity).toBe("disconnected");
    });

    it("skips HCI clusters without clusterVersion", async () => {
      const hci = makeHCICluster({ clusterVersion: undefined });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);

      const fleet = await adapter.discoverFleet();

      expect(fleet).toHaveLength(0);
    });
  });

  // ── discoverConnections ───────────────────────────────────────────────

  describe("discoverConnections", () => {
    it("creates connections for HCI clusters with service endpoints", async () => {
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([makeHCICluster()]);

      const connections = await adapter.discoverConnections();

      expect(connections).toHaveLength(1);
      expect(connections[0]!.type).toBe("internet");
      expect(connections[0]!.status).toBe("connected");
    });

    it("skips HCI clusters without service endpoints", async () => {
      const hci = makeHCICluster({ serviceEndpoint: undefined });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);

      const connections = await adapter.discoverConnections();

      expect(connections).toHaveLength(0);
    });
  });

  // ── discoverHybridResources ───────────────────────────────────────────

  describe("discoverHybridResources", () => {
    it("creates graph nodes for HCI cluster, VMs, networks, and storage", async () => {
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([makeHCICluster()]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([makeVM()]);
      vi.spyOn(adapter, "listHCINetworks").mockResolvedValue([makeNetwork()]);
      vi.spyOn(adapter, "listHCIStorage").mockResolvedValue([makeStorage()]);

      const nodes = await adapter.discoverHybridResources();

      // 1 HCI cluster + 1 VM + 1 network + 1 storage = 4
      expect(nodes).toHaveLength(4);

      const hciNode = nodes.find((n) => n.resourceType === "hci-cluster");
      expect(hciNode).toBeDefined();
      expect(hciNode!.name).toBe("hci-prod-cluster");
      expect(hciNode!.status).toBe("running");

      const vmNode = nodes.find((n) => n.resourceType === "compute");
      expect(vmNode).toBeDefined();
      expect(vmNode!.name).toBe("hci-vm-prod-1");
      expect(vmNode!.status).toBe("running");

      const netNode = nodes.find((n) => n.resourceType === "network");
      expect(netNode).toBeDefined();
      expect(netNode!.name).toBe("hci-vnet-prod");

      const storageNode = nodes.find((n) => n.resourceType === "storage");
      expect(storageNode).toBeDefined();
      expect(storageNode!.name).toBe("hci-storage-prod");
    });

    it("maps VM statuses correctly", async () => {
      const vms = [
        makeVM({ id: "vm-run", status: "Running" }),
        makeVM({ id: "vm-stop", name: "stopped", status: "Stopped" }),
        makeVM({ id: "vm-fail", name: "failed", status: "Failed" }),
        makeVM({ id: "vm-start", name: "starting", status: "Starting" }),
      ];
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([makeHCICluster()]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue(vms);
      vi.spyOn(adapter, "listHCINetworks").mockResolvedValue([]);
      vi.spyOn(adapter, "listHCIStorage").mockResolvedValue([]);

      const nodes = await adapter.discoverHybridResources();
      const vmNodes = nodes.filter((n) => n.resourceType === "compute");

      expect(vmNodes.find((n) => n.nativeId === "vm-run")!.status).toBe("running");
      expect(vmNodes.find((n) => n.nativeId === "vm-stop")!.status).toBe("stopped");
      expect(vmNodes.find((n) => n.nativeId === "vm-fail")!.status).toBe("error");
      expect(vmNodes.find((n) => n.nativeId === "vm-start")!.status).toBe("pending");
    });

    it("sets correct node IDs following KG convention", async () => {
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([makeHCICluster()]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([]);
      vi.spyOn(adapter, "listHCINetworks").mockResolvedValue([]);
      vi.spyOn(adapter, "listHCIStorage").mockResolvedValue([]);

      const nodes = await adapter.discoverHybridResources();
      const hciNode = nodes[0]!;

      expect(hciNode.id).toContain("azure::");
      expect(hciNode.id).toContain("westus2");
      expect(hciNode.id).toContain("hci-cluster");
    });
  });

  // ── healthCheck ───────────────────────────────────────────────────────

  describe("healthCheck", () => {
    it("returns true when API responds", async () => {
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([]);

      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false on API failure", async () => {
      vi.spyOn(adapter, "listHCIClusters").mockRejectedValue(new Error("API error"));

      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });

  // ── HCI capabilities inference ────────────────────────────────────────

  describe("capability inference", () => {
    it("adds ai-inference for large HCI clusters (4+ nodes)", async () => {
      const hci = makeHCICluster({ nodeCount: 4 });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.capabilities).toContain("ai-inference");
    });

    it("omits ai-inference for small HCI clusters", async () => {
      const hci = makeHCICluster({ nodeCount: 2 });
      vi.spyOn(adapter, "listHCIClusters").mockResolvedValue([hci]);
      vi.spyOn(adapter, "listHCIVirtualMachines").mockResolvedValue([]);
      vi.spyOn(adapter, "listLocalDevices").mockResolvedValue([]);

      const sites = await adapter.discoverSites();

      expect(sites[0]!.capabilities).not.toContain("ai-inference");
    });
  });
});
