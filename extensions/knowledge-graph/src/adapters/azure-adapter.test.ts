/**
 * Tests for Azure Discovery Adapter
 */
import { describe, it, expect, vi } from "vitest";
import {
  AzureDiscoveryAdapter,
  buildAzureNodeId,
  AZURE_RESOURCE_MAPPINGS,
  AZURE_RELATIONSHIP_RULES,
} from "./azure.js";
import type {
  AzureResourceGraphClient,
  AzureQueryResult,
  AzureResourceRecord,
} from "./azure.js";
import type { GraphNodeInput, GraphEdgeInput } from "../types.js";

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(
  records: AzureResourceRecord[],
): AzureResourceGraphClient {
  return {
    query: vi.fn(async (): Promise<AzureQueryResult> => ({
      data: records,
      totalRecords: records.length,
    })),
    dispose: vi.fn(),
  };
}

function azureRecord(overrides: Partial<AzureResourceRecord>): AzureResourceRecord {
  return {
    id: "/subscriptions/sub-1/resourceGroups/rg-main/providers/Microsoft.Compute/virtualMachines/vm-1",
    name: "vm-1",
    type: "microsoft.compute/virtualmachines",
    location: "eastus",
    resourceGroup: "rg-main",
    subscriptionId: "sub-1",
    tags: null,
    properties: {},
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("AzureDiscoveryAdapter", () => {
  it("should return correct provider and display name", () => {
    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient([]),
    });
    expect(adapter.provider).toBe("azure");
    expect(adapter.displayName).toBe("Microsoft Azure");
  });

  it("should report supported resource types", () => {
    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient([]),
    });
    const types = adapter.supportedResourceTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("compute");
    expect(types).toContain("database");
    expect(types).toContain("storage");
  });

  it("should discover compute resources", async () => {
    const records: AzureResourceRecord[] = [
      azureRecord({
        type: "microsoft.compute/virtualmachines",
        name: "web-server-1",
        location: "eastus",
        properties: {
          provisioningState: "Succeeded",
          hardwareProfile: { vmSize: "Standard_D4s_v3" },
        },
        tags: { env: "production" },
      }),
    ];

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.resourceType).toBe("compute");
    expect(result.nodes[0]!.name).toBe("web-server-1");
    expect(result.nodes[0]!.region).toBe("eastus");
    expect(result.nodes[0]!.tags).toEqual({ env: "production" });
    expect(result.nodes[0]!.provider).toBe("azure");
    expect(result.errors).toHaveLength(0);
  });

  it("should discover database resources", async () => {
    const records: AzureResourceRecord[] = [
      azureRecord({
        id: "/subscriptions/sub-1/resourceGroups/rg-main/providers/Microsoft.Sql/servers/sql-server-1/databases/db-main",
        type: "microsoft.sql/servers/databases",
        name: "db-main",
        properties: {
          status: "Online",
        },
        sku: { name: "S1", tier: "Standard" },
      }),
    ];

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.resourceType).toBe("database");
    expect(result.nodes[0]!.status).toBe("running");
  });

  it("should discover storage resources", async () => {
    const records: AzureResourceRecord[] = [
      azureRecord({
        id: "/subscriptions/sub-1/resourceGroups/rg-main/providers/Microsoft.Storage/storageAccounts/mystorageaccount",
        type: "microsoft.storage/storageaccounts",
        name: "mystorageaccount",
        properties: {
          provisioningState: "Succeeded",
          primaryEndpoints: { blob: "https://mystorageaccount.blob.core.windows.net/" },
          networkAcls: { defaultAction: "Allow" },
        },
        sku: { name: "Standard_LRS" },
      }),
    ];

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.resourceType).toBe("storage");
    expect(result.nodes[0]!.metadata["publicAccess"]).toBe(true);
  });

  it("should detect AI workloads (Azure OpenAI)", async () => {
    const records: AzureResourceRecord[] = [
      azureRecord({
        id: "/subscriptions/sub-1/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/openai-svc",
        type: "microsoft.cognitiveservices/accounts",
        name: "openai-svc",
        properties: {
          provisioningState: "Succeeded",
          kind: "OpenAI",
        },
      }),
    ];

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0]!;
    expect(node.metadata["isAiWorkload"]).toBe(true);
  });

  it("should detect GPU VMs (N-series)", async () => {
    const records: AzureResourceRecord[] = [
      azureRecord({
        type: "microsoft.compute/virtualmachines",
        name: "gpu-trainer",
        properties: {
          provisioningState: "Succeeded",
          hardwareProfile: { vmSize: "Standard_NC24s_v3" },
        },
      }),
    ];

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover();
    expect(result.nodes[0]!.metadata["isGpuInstance"]).toBe(true);
  });

  it("should discover relationships between resources", async () => {
    const nicId = "/subscriptions/sub-1/resourceGroups/rg-main/providers/Microsoft.Network/networkInterfaces/nic-1";
    const subnetId = "/subscriptions/sub-1/resourceGroups/rg-main/providers/Microsoft.Network/virtualNetworks/vnet-1/subnets/subnet-1";

    const records: AzureResourceRecord[] = [
      azureRecord({
        type: "microsoft.compute/virtualmachines",
        name: "vm-1",
        properties: {
          provisioningState: "Succeeded",
          networkProfile: {
            networkInterfaces: [{ id: nicId }],
          },
        },
      }),
      azureRecord({
        id: nicId,
        type: "microsoft.network/networkinterfaces",
        name: "nic-1",
        properties: {
          provisioningState: "Succeeded",
          ipConfigurations: [
            { properties: { subnet: { id: subnetId } } },
          ],
        },
      }),
      azureRecord({
        id: subnetId,
        type: "microsoft.network/virtualnetworks/subnets",
        name: "subnet-1",
        properties: {
          provisioningState: "Succeeded",
          addressPrefix: "10.0.1.0/24",
        },
      }),
    ];

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover();
    expect(result.nodes.length).toBe(3);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  it("should apply tag filters", async () => {
    const records: AzureResourceRecord[] = [
      azureRecord({ name: "vm-prod", tags: { env: "production" } }),
      azureRecord({
        id: "/subscriptions/sub-1/resourceGroups/rg-main/providers/Microsoft.Compute/virtualMachines/vm-dev",
        name: "vm-dev",
        tags: { env: "development" },
      }),
    ];

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover({ tags: { env: "production" } });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.name).toBe("vm-prod");
  });

  it("should apply limit option", async () => {
    const records: AzureResourceRecord[] = Array.from({ length: 10 }, (_, i) =>
      azureRecord({
        id: `/subscriptions/sub-1/resourceGroups/rg-main/providers/Microsoft.Compute/virtualMachines/vm-${i}`,
        name: `vm-${i}`,
      }),
    );

    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient(records),
    });

    const result = await adapter.discover({ limit: 3 });
    expect(result.nodes).toHaveLength(3);
  });

  it("should perform health check with client factory", async () => {
    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient([
        azureRecord({ type: "microsoft.compute/virtualmachines" }),
      ]),
    });

    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(true);
  });

  it("should not support incremental sync", () => {
    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient([]),
    });
    expect(adapter.supportsIncrementalSync()).toBe(false);
  });

  it("should handle empty results gracefully", async () => {
    const adapter = new AzureDiscoveryAdapter({
      subscriptionId: "sub-1",
      clientFactory: () => createMockClient([]),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.provider).toBe("azure");
  });
});

describe("buildAzureNodeId", () => {
  it("should produce deterministic IDs", () => {
    const id1 = buildAzureNodeId("sub-1", "compute", "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1");
    const id2 = buildAzureNodeId("sub-1", "compute", "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1");
    expect(id1).toBe(id2);
  });

  it("should contain provider and resource type", () => {
    const id = buildAzureNodeId("sub-1", "storage", "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1");
    expect(id).toMatch(/^azure:/);
    expect(id).toContain("storage");
  });
});

describe("AZURE_RESOURCE_MAPPINGS", () => {
  it("should have mappings for common Azure types", () => {
    const types = AZURE_RESOURCE_MAPPINGS.map((m) => m.azureType);
    expect(types).toContain("microsoft.compute/virtualmachines");
    expect(types).toContain("microsoft.sql/servers/databases");
    expect(types).toContain("microsoft.storage/storageaccounts");
    expect(types).toContain("microsoft.network/virtualnetworks");
    expect(types).toContain("microsoft.containerservice/managedclusters");
  });

  it("should mark AI workloads correctly", () => {
    const aiMappings = AZURE_RESOURCE_MAPPINGS.filter((m) => m.isAiWorkload);
    expect(aiMappings.length).toBeGreaterThan(0);
    const aiTypes = aiMappings.map((m) => m.azureType);
    expect(aiTypes).toContain("microsoft.cognitiveservices/accounts");
    expect(aiTypes).toContain("microsoft.machinelearningservices/workspaces");
  });
});

describe("AZURE_RELATIONSHIP_RULES", () => {
  it("should define rules for VMs, NICs, and subnets", () => {
    const ruleSourceTypes = AZURE_RELATIONSHIP_RULES.map((r) => r.sourceType);
    expect(ruleSourceTypes).toContain("microsoft.compute/virtualmachines");
    expect(ruleSourceTypes).toContain("microsoft.network/networkinterfaces");
  });
});
