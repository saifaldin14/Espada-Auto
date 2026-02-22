/**
 * Tests for Cross-Cloud Relationship Discovery
 */
import { describe, it, expect } from "vitest";
import {
  discoverCrossCloudRelationships,
  getCrossCloudSummary,
  CROSS_CLOUD_RULES,
} from "./cross-cloud.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import type { GraphNodeInput, GraphEdgeInput } from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeNode(overrides: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id: overrides.id ?? "node-1",
    provider: overrides.provider ?? "aws",
    resourceType: overrides.resourceType ?? "compute",
    nativeId: overrides.nativeId ?? "arn:aws:ec2:us-east-1:123:instance/i-1",
    name: overrides.name ?? "test-resource",
    region: overrides.region ?? "us-east-1",
    account: overrides.account ?? "123",
    status: overrides.status ?? "running",
    tags: overrides.tags ?? {},
    metadata: overrides.metadata ?? {},
    costMonthly: overrides.costMonthly ?? null,
    owner: overrides.owner ?? null,
    createdAt: overrides.createdAt ?? null,
  };
}

async function createStorageWithNodes(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[] = [],
): Promise<InMemoryGraphStorage> {
  const storage = new InMemoryGraphStorage();
  await storage.initialize();
  for (const node of nodes) {
    await storage.upsertNode(node);
  }
  for (const edge of edges) {
    await storage.upsertEdge(edge);
  }
  return storage;
}

// =============================================================================
// Tests
// =============================================================================

describe("discoverCrossCloudRelationships", () => {
  it("should return empty when only one provider exists", async () => {
    const storage = await createStorageWithNodes([
      makeNode({ id: "aws-1", provider: "aws" }),
      makeNode({ id: "aws-2", provider: "aws" }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    expect(result.edges).toHaveLength(0);
    expect(result.matches).toHaveLength(0);
  });

  it("should return empty when no relationships match", async () => {
    const storage = await createStorageWithNodes([
      makeNode({ id: "aws-1", provider: "aws", resourceType: "compute", name: "vm-1" }),
      makeNode({ id: "azure-1", provider: "azure", resourceType: "compute", name: "vm-2" }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    expect(result.edges).toHaveLength(0);
  });

  it("should detect VPN peering by naming convention", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-vpc-1",
        provider: "aws",
        resourceType: "vpc",
        name: "aws-to-azure-vpc",
        tags: { peering: "azure" },
        metadata: {},
      }),
      makeNode({
        id: "azure-vnet-1",
        provider: "azure",
        resourceType: "vpc",
        name: "azure-to-aws-vnet",
        tags: { peering: "aws" },
        metadata: {},
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    const peerEdge = result.edges.find((e) => e.relationshipType === "peers-with");
    expect(peerEdge).toBeDefined();
    expect(peerEdge!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("should detect VPN peering by CIDR overlap", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-vpc-1",
        provider: "aws",
        resourceType: "vpc",
        name: "vpc-1",
        metadata: { cidrBlock: "10.0.0.0/16" },
      }),
      makeNode({
        id: "gcp-net-1",
        provider: "gcp",
        resourceType: "vpc",
        name: "network-1",
        metadata: { cidrBlock: "10.0.1.0/24" },
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    const peerEdge = result.edges.find((e) => e.relationshipType === "peers-with");
    expect(peerEdge).toBeDefined();
    expect(peerEdge!.confidence).toBe(0.5);
    expect(peerEdge!.metadata["crossCloud"]).toBe(true);
  });

  it("should detect shared DNS", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-dns-1",
        provider: "aws",
        resourceType: "dns",
        name: "app.example.com",
        nativeId: "zone-1",
        metadata: { records: ["api-gateway.azure.com"] },
      }),
      makeNode({
        id: "azure-lb-1",
        provider: "azure",
        resourceType: "load-balancer",
        name: "api-gateway",
        nativeId: "api-gateway.azure.com",
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    const dnsEdge = result.edges.find((e) => e.relationshipType === "resolves-to");
    expect(dnsEdge).toBeDefined();
  });

  it("should detect federated identity", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-role-1",
        provider: "aws",
        resourceType: "iam-role",
        name: "gcp-federated-role",
        metadata: {
          trustPolicy: JSON.stringify({
            Statement: [{
              Principal: { Federated: "accounts.google.com" },
            }],
          }),
        },
      }),
      makeNode({
        id: "gcp-sa-1",
        provider: "gcp",
        resourceType: "identity",
        name: "aws-access-sa",
        metadata: {
          workloadIdentityPool: "projects/123/locations/global/workloadIdentityPools/aws-pool",
        },
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    const authEdge = result.edges.find((e) => e.relationshipType === "authenticated-by");
    expect(authEdge).toBeDefined();
    expect(authEdge!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("should detect cross-cloud AI workloads with matching model names", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-sagemaker-1",
        provider: "aws",
        resourceType: "custom",
        name: "llm-training",
        metadata: { aiWorkload: true, modelName: "gpt-custom-v2" },
      }),
      makeNode({
        id: "gcp-vertex-1",
        provider: "gcp",
        resourceType: "custom",
        name: "llm-serving",
        metadata: { aiWorkload: true, modelName: "gpt-custom-v2" },
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    const aiEdge = result.edges.find((e) => e.relationshipType === "depends-on");
    expect(aiEdge).toBeDefined();
    expect(aiEdge!.confidence).toBe(0.8);
  });

  it("should detect cross-cloud AI workloads with same owner", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-ai-1",
        provider: "aws",
        resourceType: "custom",
        name: "training-pipeline",
        metadata: { aiWorkload: true },
        owner: "ml-team",
      }),
      makeNode({
        id: "azure-ai-1",
        provider: "azure",
        resourceType: "custom",
        name: "inference-endpoint",
        metadata: { aiWorkload: true },
        owner: "ml-team",
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    const aiEdge = result.edges.find((e) => e.relationshipType === "depends-on");
    expect(aiEdge).toBeDefined();
    expect(aiEdge!.confidence).toBe(0.5);
  });

  it("should detect shared storage references", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-s3-1",
        provider: "aws",
        resourceType: "storage",
        name: "data-lake",
        nativeId: "arn:aws:s3:::data-lake",
      }),
      makeNode({
        id: "gcp-vm-1",
        provider: "gcp",
        resourceType: "compute",
        name: "etl-worker",
        metadata: { dataSource: "s3://data-lake/raw/" },
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    const storageEdge = result.edges.find((e) => e.relationshipType === "reads-from");
    expect(storageEdge).toBeDefined();
    expect(storageEdge!.sourceNodeId).toBe("gcp-vm-1");
    expect(storageEdge!.targetNodeId).toBe("aws-s3-1");
  });

  it("should deduplicate symmetric relationships", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-vpc-1",
        provider: "aws",
        resourceType: "vpc",
        name: "vpc-azure",
        tags: { peer: "azure" },
      }),
      makeNode({
        id: "azure-vnet-1",
        provider: "azure",
        resourceType: "vpc",
        name: "vnet-aws",
        tags: { peer: "aws" },
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    const peeringEdges = result.edges.filter((e) => e.relationshipType === "peers-with");
    // Should have exactly 1, not 2 (A→B and B→A)
    expect(peeringEdges.length).toBe(1);
  });

  it("should handle three-cloud scenario", async () => {
    const storage = await createStorageWithNodes([
      makeNode({
        id: "aws-vpc-1",
        provider: "aws",
        resourceType: "vpc",
        name: "aws-network",
        tags: { peering: "azure,gcp" },
      }),
      makeNode({
        id: "azure-vnet-1",
        provider: "azure",
        resourceType: "vpc",
        name: "azure-network",
        tags: { peering: "aws" },
      }),
      makeNode({
        id: "gcp-net-1",
        provider: "gcp",
        resourceType: "vpc",
        name: "gcp-network",
        tags: { peering: "aws" },
      }),
    ]);

    const result = await discoverCrossCloudRelationships(storage);
    // Should find both AWS↔Azure and AWS↔GCP relationships
    expect(result.edges.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getCrossCloudSummary", () => {
  it("should return summary of cross-cloud edges", async () => {
    const nodes: GraphNodeInput[] = [
      makeNode({ id: "aws-1", provider: "aws", resourceType: "vpc", name: "vpc-1" }),
      makeNode({ id: "azure-1", provider: "azure", resourceType: "vpc", name: "vnet-1" }),
    ];
    const edges: GraphEdgeInput[] = [
      {
        id: "cross-1",
        sourceNodeId: "aws-1",
        targetNodeId: "azure-1",
        relationshipType: "peers-with",
        confidence: 0.8,
        discoveredVia: "config-scan",
        metadata: { crossCloud: true },
      },
    ];
    const storage = await createStorageWithNodes(nodes, edges);

    const summary = await getCrossCloudSummary(storage);
    expect(summary.totalCrossCloudEdges).toBe(1);
    expect(summary.byRelationship["peers-with"]).toBe(1);
    expect(summary.byProviderPair["aws↔azure"]).toBe(1);
  });

  it("should count AI workload connections", async () => {
    const nodes: GraphNodeInput[] = [
      makeNode({
        id: "aws-ai-1",
        provider: "aws",
        resourceType: "custom",
        metadata: { aiWorkload: true },
      }),
      makeNode({
        id: "gcp-ai-1",
        provider: "gcp",
        resourceType: "custom",
        metadata: { aiWorkload: true },
      }),
    ];
    const edges: GraphEdgeInput[] = [
      {
        id: "cross-ai-1",
        sourceNodeId: "aws-ai-1",
        targetNodeId: "gcp-ai-1",
        relationshipType: "depends-on",
        confidence: 0.8,
        discoveredVia: "config-scan",
        metadata: {},
      },
    ];
    const storage = await createStorageWithNodes(nodes, edges);

    const summary = await getCrossCloudSummary(storage);
    expect(summary.aiWorkloadConnections).toBe(1);
  });

  it("should not count same-provider edges", async () => {
    const nodes: GraphNodeInput[] = [
      makeNode({ id: "aws-1", provider: "aws" }),
      makeNode({ id: "aws-2", provider: "aws" }),
    ];
    const edges: GraphEdgeInput[] = [
      {
        id: "same-cloud",
        sourceNodeId: "aws-1",
        targetNodeId: "aws-2",
        relationshipType: "runs-in",
        confidence: 1.0,
        discoveredVia: "api-field",
        metadata: {},
      },
    ];
    const storage = await createStorageWithNodes(nodes, edges);

    const summary = await getCrossCloudSummary(storage);
    expect(summary.totalCrossCloudEdges).toBe(0);
  });
});

describe("CROSS_CLOUD_RULES", () => {
  it("should have 5 built-in rules", () => {
    expect(CROSS_CLOUD_RULES).toHaveLength(5);
  });

  it("should cover all cloud pairs", () => {
    const allPairs = new Set<string>();
    for (const rule of CROSS_CLOUD_RULES) {
      for (const [a, b] of rule.providerPairs) {
        allPairs.add(`${a}-${b}`);
      }
    }
    expect(allPairs.has("aws-azure")).toBe(true);
    expect(allPairs.has("aws-gcp")).toBe(true);
    expect(allPairs.has("azure-gcp")).toBe(true);
  });
});
