/**
 * Tests for GCP Discovery Adapter
 */
import { describe, it, expect, vi } from "vitest";
import {
  GcpDiscoveryAdapter,
  buildGcpNodeId,
  GCP_RESOURCE_MAPPINGS,
  GCP_RELATIONSHIP_RULES,
} from "./gcp.js";
import type {
  GcpAssetClient,
  GcpAssetRecord,
} from "./gcp.js";

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockGcpClient(
  assets: GcpAssetRecord[],
): GcpAssetClient {
  return {
    listAssets: vi.fn(async (): Promise<GcpAssetRecord[]> => assets),
    dispose: vi.fn(),
  };
}

function gcpAsset(overrides: Partial<GcpAssetRecord>): GcpAssetRecord {
  return {
    name: "//compute.googleapis.com/projects/my-project/zones/us-central1-a/instances/vm-1",
    assetType: "compute.googleapis.com/Instance",
    resource: {
      data: { name: "vm-1", status: "RUNNING" },
      location: "us-central1-a",
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("GcpDiscoveryAdapter", () => {
  it("should return correct provider and display name", () => {
    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient([]),
    });
    expect(adapter.provider).toBe("gcp");
    expect(adapter.displayName).toBe("Google Cloud Platform");
  });

  it("should report supported resource types", () => {
    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient([]),
    });
    const types = adapter.supportedResourceTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("compute");
    expect(types).toContain("database");
    expect(types).toContain("storage");
    expect(types).toContain("cluster");
  });

  it("should discover compute instances", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        resource: {
          data: {
            name: "web-server",
            status: "RUNNING",
            machineType: "zones/us-central1-a/machineTypes/e2-standard-4",
            labels: { env: "production" },
          },
          location: "us-central1-a",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.resourceType).toBe("compute");
    expect(result.nodes[0]!.name).toBe("web-server");
    expect(result.nodes[0]!.provider).toBe("gcp");
    expect(result.nodes[0]!.tags).toEqual({ env: "production" });
    expect(result.nodes[0]!.metadata["machineType"]).toBe("e2-standard-4");
    expect(result.errors).toHaveLength(0);
  });

  it("should discover GKE clusters", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: "//container.googleapis.com/projects/my-project/locations/us-central1/clusters/gke-prod",
        assetType: "container.googleapis.com/Cluster",
        resource: {
          data: {
            name: "gke-prod",
            status: "RUNNING",
            currentMasterVersion: "1.28.3",
            nodePools: [
              { name: "default-pool", initialNodeCount: 3, config: { machineType: "e2-standard-4" } },
            ],
          },
          location: "us-central1",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.resourceType).toBe("cluster");
    expect(result.nodes[0]!.metadata["masterVersion"]).toBe("1.28.3");
    expect(result.nodes[0]!.metadata["nodePoolCount"]).toBe(1);
  });

  it("should discover storage buckets", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: "//storage.googleapis.com/projects/_/buckets/my-data-bucket",
        assetType: "storage.googleapis.com/Bucket",
        resource: {
          data: {
            name: "my-data-bucket",
            storageClass: "STANDARD",
            iamConfiguration: {
              uniformBucketLevelAccess: { enabled: true },
            },
            labels: { team: "data-eng" },
          },
          location: "us-central1",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.resourceType).toBe("storage");
    expect(result.nodes[0]!.metadata["storageClass"]).toBe("STANDARD");
  });

  it("should detect AI workloads (Vertex AI)", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: "//aiplatform.googleapis.com/projects/my-project/locations/us-central1/endpoints/ep-1",
        assetType: "aiplatform.googleapis.com/Endpoint",
        resource: {
          data: {
            displayName: "llm-endpoint",
            deployedModels: [
              { model: "projects/my-project/locations/us-central1/models/model-1" },
            ],
          },
          location: "us-central1",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.metadata["aiWorkload"]).toBe(true);
    expect(result.nodes[0]!.metadata["deployedModelCount"]).toBe(1);
  });

  it("should detect GPU instances (A2/A3 series)", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        resource: {
          data: {
            name: "gpu-trainer",
            status: "RUNNING",
            machineType: "zones/us-central1-a/machineTypes/a2-highgpu-1g",
          },
          location: "us-central1-a",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes[0]!.metadata["isGpuInstance"]).toBe(true);
    expect(result.nodes[0]!.metadata["aiWorkload"]).toBe(true);
  });

  it("should detect TPU nodes as AI workloads", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: "//tpu.googleapis.com/projects/my-project/locations/us-central1-a/nodes/tpu-1",
        assetType: "tpu.googleapis.com/Node",
        resource: {
          data: {
            name: "tpu-1",
            state: "READY",
            acceleratorType: "v4-8",
          },
          location: "us-central1-a",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes[0]!.metadata["aiWorkload"]).toBe(true);
    expect(result.nodes[0]!.metadata["tpuType"]).toBe("v4-8");
  });

  it("should discover Pub/Sub subscription → topic relationships", async () => {
    const topicName = "//pubsub.googleapis.com/projects/my-project/topics/events";
    const subName = "//pubsub.googleapis.com/projects/my-project/subscriptions/events-sub";

    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: topicName,
        assetType: "pubsub.googleapis.com/Topic",
        resource: { data: { name: "events" }, location: "global" },
      }),
      gcpAsset({
        name: subName,
        assetType: "pubsub.googleapis.com/Subscription",
        resource: {
          data: {
            name: "events-sub",
            topic: topicName,
          },
          location: "global",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(2);
    // Should find subscription → topic relationship
    const subToTopic = result.edges.find(
      (e) => e.relationshipType === "subscribes-to",
    );
    expect(subToTopic).toBeDefined();
  });

  it("should apply tag filters via labels", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: "//compute.googleapis.com/projects/p/zones/z/instances/vm-prod",
        resource: {
          data: { name: "vm-prod", status: "RUNNING", labels: { env: "production" } },
          location: "us-central1-a",
        },
      }),
      gcpAsset({
        name: "//compute.googleapis.com/projects/p/zones/z/instances/vm-dev",
        resource: {
          data: { name: "vm-dev", status: "RUNNING", labels: { env: "development" } },
          location: "us-central1-a",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover({ tags: { env: "production" } });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.tags["env"]).toBe("production");
  });

  it("should apply limit option", async () => {
    const assets: GcpAssetRecord[] = Array.from({ length: 10 }, (_, i) =>
      gcpAsset({
        name: `//compute.googleapis.com/projects/p/zones/z/instances/vm-${i}`,
        resource: {
          data: { name: `vm-${i}`, status: "RUNNING" },
          location: "us-central1-a",
        },
      }),
    );

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover({ limit: 5 });
    expect(result.nodes).toHaveLength(5);
  });

  it("should infer status correctly", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: "//compute.googleapis.com/projects/p/zones/z/instances/vm-running",
        resource: { data: { name: "vm-running", status: "RUNNING" }, location: "us-central1-a" },
      }),
      gcpAsset({
        name: "//compute.googleapis.com/projects/p/zones/z/instances/vm-stopped",
        resource: { data: { name: "vm-stopped", status: "TERMINATED" }, location: "us-central1-a" },
      }),
      gcpAsset({
        name: "//compute.googleapis.com/projects/p/zones/z/instances/vm-staging",
        resource: { data: { name: "vm-staging", status: "STAGING" }, location: "us-central1-a" },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    const byName = new Map(result.nodes.map((n) => [n.name, n]));
    expect(byName.get("vm-running")!.status).toBe("running");
    expect(byName.get("vm-stopped")!.status).toBe("stopped");
    expect(byName.get("vm-staging")!.status).toBe("creating");
  });

  it("should perform health check with client factory", async () => {
    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient([gcpAsset({})]),
    });

    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(true);
  });

  it("should not support incremental sync", () => {
    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient([]),
    });
    expect(adapter.supportsIncrementalSync()).toBe(false);
  });

  it("should handle empty results gracefully", async () => {
    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient([]),
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.provider).toBe("gcp");
  });

  it("should extract region from zone in resource name", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        name: "//compute.googleapis.com/projects/p/zones/europe-west1-b/instances/vm-eu",
        resource: { data: { name: "vm-eu", status: "RUNNING" } },
        // No resource.location — should parse from name
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes[0]!.region).toBe("europe-west1");
  });

  it("should estimate VM costs", async () => {
    const assets: GcpAssetRecord[] = [
      gcpAsset({
        resource: {
          data: {
            name: "cost-vm",
            status: "RUNNING",
            machineType: "zones/us-central1-a/machineTypes/e2-standard-4",
          },
          location: "us-central1-a",
        },
      }),
    ];

    const adapter = new GcpDiscoveryAdapter({
      projectId: "my-project",
      clientFactory: () => createMockGcpClient(assets),
    });

    const result = await adapter.discover();
    expect(result.nodes[0]!.costMonthly).toBeGreaterThan(0);
  });
});

describe("buildGcpNodeId", () => {
  it("should produce deterministic IDs", () => {
    const id1 = buildGcpNodeId("my-project", "compute", "//compute.googleapis.com/projects/p/zones/z/instances/vm-1");
    const id2 = buildGcpNodeId("my-project", "compute", "//compute.googleapis.com/projects/p/zones/z/instances/vm-1");
    expect(id1).toBe(id2);
  });

  it("should contain provider prefix", () => {
    const id = buildGcpNodeId("my-project", "storage", "//storage.googleapis.com/projects/_/buckets/b1");
    expect(id).toMatch(/^gcp:/);
  });
});

describe("GCP_RESOURCE_MAPPINGS", () => {
  it("should have mappings for common GCP types", () => {
    const types = GCP_RESOURCE_MAPPINGS.map((m) => m.gcpType);
    expect(types).toContain("compute.googleapis.com/Instance");
    expect(types).toContain("container.googleapis.com/Cluster");
    expect(types).toContain("storage.googleapis.com/Bucket");
    expect(types).toContain("sqladmin.googleapis.com/Instance");
    expect(types).toContain("pubsub.googleapis.com/Topic");
  });

  it("should mark Vertex AI types as AI workloads", () => {
    const aiMappings = GCP_RESOURCE_MAPPINGS.filter((m) => m.isAiWorkload);
    expect(aiMappings.length).toBeGreaterThan(0);
    const aiTypes = aiMappings.map((m) => m.gcpType);
    expect(aiTypes).toContain("aiplatform.googleapis.com/Endpoint");
    expect(aiTypes).toContain("tpu.googleapis.com/Node");
  });
});

describe("GCP_RELATIONSHIP_RULES", () => {
  it("should define network and service account relationships", () => {
    const ruleSourceTypes = GCP_RELATIONSHIP_RULES.map((r) => r.sourceType);
    expect(ruleSourceTypes).toContain("compute.googleapis.com/Instance");
    expect(ruleSourceTypes).toContain("pubsub.googleapis.com/Subscription");
    expect(ruleSourceTypes).toContain("container.googleapis.com/Cluster");
  });
});
