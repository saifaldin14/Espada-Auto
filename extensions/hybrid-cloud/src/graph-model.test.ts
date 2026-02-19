/**
 * Tests for hybrid-cloud graph-model.ts
 */
import { describe, it, expect } from "vitest";
import {
  createEdgeSiteNode,
  createFleetNode,
  createClusterNode,
  createHybridEdge,
  buildNodeId,
} from "../src/graph-model.js";
import type { HybridSite, FleetCluster } from "../src/types.js";

describe("buildNodeId", () => {
  it("creates deterministic node ID", () => {
    const id = buildNodeId("azure-arc", "server-01", "eastus", "hybrid-machine");
    expect(id).toBe("azure-arc::eastus:hybrid-machine:server-01");
  });

  it("handles special characters in nativeId", () => {
    const id = buildNodeId("gcp", "/projects/my-proj/zones/us-central1-a/instances/vm-1", "us-central1", "compute");
    expect(id).toContain("gcp::");
    expect(id).toContain("us-central1:");
  });
});

describe("createEdgeSiteNode", () => {
  const site: HybridSite = {
    id: "site-factory-01",
    name: "Factory Floor Alpha",
    provider: "azure-arc",
    location: {
      type: "edge-site",
      name: "Factory Alpha",
      provider: "azure-arc",
      region: "eastus",
      coordinates: { latitude: 40.7, longitude: -74.0 },
      address: { city: "New York", state: "NY", country: "US" },
    },
    status: "connected",
    parentCloudRegion: "eastus",
    resourceCount: 12,
    managedClusters: ["cluster-01", "cluster-02"],
    managedMachines: ["machine-01"],
    capabilities: ["compute", "containers", "disconnected-ops"],
    lastSyncAt: "2024-01-01T00:00:00Z",
    metadata: { floor: 2 },
  };

  it("returns a GraphNodeInput with edge-site resourceType", () => {
    const node = createEdgeSiteNode(site);
    expect(node.resourceType).toBe("edge-site");
    expect(node.provider).toBe("azure-arc");
    expect(node.name).toBe("Factory Floor Alpha");
    expect(node.nativeId).toBe("site-factory-01");
    expect(node.region).toBe("eastus");
  });

  it("maps connected status to running", () => {
    const node = createEdgeSiteNode(site);
    expect(node.status).toBe("running");
  });

  it("maps disconnected status to error", () => {
    const disconnectedSite = { ...site, status: "disconnected" as const };
    const node = createEdgeSiteNode(disconnectedSite);
    expect(node.status).toBe("error");
  });

  it("maps degraded status to error", () => {
    const degradedSite = { ...site, status: "degraded" as const };
    const node = createEdgeSiteNode(degradedSite);
    expect(node.status).toBe("error");
  });

  it("maps unknown status to unknown", () => {
    const unknownSite = { ...site, status: "unknown" as const };
    const node = createEdgeSiteNode(unknownSite);
    expect(node.status).toBe("unknown");
  });

  it("includes capabilities in metadata", () => {
    const node = createEdgeSiteNode(site);
    expect(node.metadata.capabilities).toEqual(["compute", "containers", "disconnected-ops"]);
  });

  it("builds a deterministic node ID", () => {
    const node = createEdgeSiteNode(site);
    expect(node.id).toBe("azure-arc::eastus:edge-site:site-factory-01");
  });
});

describe("createFleetNode", () => {
  it("creates fleet node with correct fields", () => {
    const node = createFleetNode({
      id: "fleet-prod",
      name: "Production Fleet",
      provider: "gcp",
      region: "us-central1",
      clusterCount: 5,
      metadata: { environment: "prod" },
    });

    expect(node.resourceType).toBe("fleet");
    expect(node.provider).toBe("gcp");
    expect(node.name).toBe("Production Fleet");
    expect(node.status).toBe("running");
    expect(node.metadata.clusterCount).toBe(5);
    expect(node.metadata.environment).toBe("prod");
  });

  it("builds correct ID format for fleet", () => {
    const node = createFleetNode({
      id: "fleet-01",
      name: "Test",
      provider: "aws",
      region: "us-east-1",
      clusterCount: 2,
    });

    expect(node.id).toBe("aws::us-east-1:fleet:fleet-01");
  });
});

describe("createClusterNode", () => {
  const cluster: FleetCluster = {
    id: "cluster-edge-01",
    name: "Edge Cluster 1",
    provider: "azure-arc",
    fleetId: "fleet-prod",
    location: {
      type: "edge-site",
      name: "Factory Alpha",
      provider: "azure-arc",
      region: "eastus",
    },
    kubernetesVersion: "1.28.4",
    nodeCount: 3,
    status: "running",
    managedBy: "arc",
    connectivity: "connected",
    workloadCount: 15,
    lastHeartbeat: "2024-01-01T12:00:00Z",
  };

  it("creates connected-cluster node", () => {
    const node = createClusterNode(cluster);
    expect(node.resourceType).toBe("connected-cluster");
    expect(node.provider).toBe("azure-arc");
    expect(node.name).toBe("Edge Cluster 1");
  });

  it("maps running status to running", () => {
    const node = createClusterNode(cluster);
    expect(node.status).toBe("running");
  });

  it("maps stopped status to stopped", () => {
    const stoppedCluster = { ...cluster, status: "stopped" as const };
    const node = createClusterNode(stoppedCluster);
    expect(node.status).toBe("stopped");
  });

  it("maps degraded status to error", () => {
    const degradedCluster = { ...cluster, status: "degraded" as const };
    const node = createClusterNode(degradedCluster);
    expect(node.status).toBe("error");
  });

  it("includes kubernetes version in metadata", () => {
    const node = createClusterNode(cluster);
    expect(node.metadata.kubernetesVersion).toBe("1.28.4");
    expect(node.metadata.nodeCount).toBe(3);
  });
});

describe("createHybridEdge", () => {
  it("creates edge with correct relationship type", () => {
    const edge = createHybridEdge("node-a", "node-b", "connected-to");
    expect(edge.sourceNodeId).toBe("node-a");
    expect(edge.targetNodeId).toBe("node-b");
    expect(edge.relationshipType).toBe("connected-to");
    expect(edge.confidence).toBe(1.0);
    expect(edge.discoveredVia).toBe("api-field");
  });

  it("builds deterministic edge ID", () => {
    const edge = createHybridEdge("src", "tgt", "member-of-fleet");
    expect(edge.id).toBe("src--member-of-fleet--tgt");
  });

  it("includes optional metadata", () => {
    const edge = createHybridEdge("a", "b", "deployed-at", { weight: 3 });
    expect(edge.metadata.weight).toBe(3);
  });

  it("defaults metadata to empty object", () => {
    const edge = createHybridEdge("a", "b", "uses");
    expect(edge.metadata).toEqual({});
  });
});
