/**
 * Infrastructure Knowledge Graph — Infrastructure Contracts Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryContractStore } from "./store.js";
import {
  ContractEngine,
  formatContractResultMarkdown,
  formatContractSuiteMarkdown,
} from "./engine.js";
import type {
  InfraContract,
  ContractAssertion,
  ContractGuardrail,
  ContractEvaluationResult,
  ContractEvent,
} from "./types.js";
import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  SubgraphResult,
  GraphStats,
} from "../types.js";
import type { GraphEngine } from "../core/engine.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node-1",
    provider: "aws",
    resourceType: "compute",
    nativeId: "i-abc123",
    name: "web-server-1",
    region: "us-east-1",
    account: "123456789",
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: 100,
    owner: null,
    discoveredAt: "2025-01-01T00:00:00Z",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    lastSeenAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeContract(overrides: Partial<InfraContract> = {}): InfraContract {
  return {
    id: "contract-1",
    name: "payment-service",
    owner: "payments-team",
    description: "Payment service infrastructure contract",
    enabled: true,
    assertions: [],
    dependencies: [],
    guardrails: [],
    tags: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// =============================================================================
// Mock Storage (with in-memory nodes for IQL queries)
// =============================================================================

function mockStorage(nodes: GraphNode[]): GraphStorage {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return {
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    getNode: vi.fn(async (id: string) => nodeMap.get(id) ?? null),
    queryNodes: vi.fn(async () => nodes),
    queryNodesPaginated: vi.fn(async () => ({
      items: nodes,
      totalCount: nodes.length,
      nextCursor: null,
      hasMore: false,
    })),
    getEdgesForNode: vi.fn(async () => []),
    queryEdges: vi.fn(async () => []),
    getNeighbors: vi.fn(async () => ({ nodes: [], edges: [] })),
    getNodeGroups: vi.fn(async () => []),
    getNodeByNativeId: vi.fn(async () => null),
    upsertNode: vi.fn(async () => {}),
    upsertNodes: vi.fn(async () => {}),
    deleteNode: vi.fn(async () => {}),
    markNodesDisappeared: vi.fn(async () => []),
    upsertEdge: vi.fn(async () => {}),
    upsertEdges: vi.fn(async () => {}),
    getEdge: vi.fn(async () => null),
    queryEdgesPaginated: vi.fn(async () => ({
      items: [],
      totalCount: 0,
      nextCursor: null,
      hasMore: false,
    })),
    deleteEdge: vi.fn(async () => {}),
    deleteStaleEdges: vi.fn(async () => 0),
    appendChange: vi.fn(async () => {}),
    appendChanges: vi.fn(async () => {}),
    getChanges: vi.fn(async () => []),
    getChangesPaginated: vi.fn(async () => ({
      items: [],
      totalCount: 0,
      nextCursor: null,
      hasMore: false,
    })),
    getNodeTimeline: vi.fn(async () => []),
    upsertGroup: vi.fn(async () => {}),
    getGroup: vi.fn(async () => null),
    listGroups: vi.fn(async () => []),
    deleteGroup: vi.fn(async () => {}),
    addGroupMember: vi.fn(async () => {}),
    removeGroupMember: vi.fn(async () => {}),
    getGroupMembers: vi.fn(async () => []),
    saveSyncRecord: vi.fn(async () => {}),
    getLastSyncRecord: vi.fn(async () => null),
    listSyncRecords: vi.fn(async () => []),
    getStats: vi.fn(async (): Promise<GraphStats> => ({
      totalNodes: nodes.length,
      totalEdges: 0,
      totalChanges: 0,
      totalGroups: 0,
      nodesByProvider: {},
      nodesByResourceType: {},
      edgesByRelationshipType: {},
      totalCostMonthly: nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0),
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    })),
  } as unknown as GraphStorage;
}

function mockEngine(storage: GraphStorage): GraphEngine {
  return {
    getStorage: () => storage,
    getBlastRadius: vi.fn(async (nodeId: string): Promise<SubgraphResult> => ({
      rootNodeId: nodeId,
      nodes: new Map([[nodeId, makeNode({ id: nodeId })]]),
      edges: [],
      hops: new Map([[0, [nodeId]]]),
      totalCostMonthly: 0,
    })),
    getDependencyChain: vi.fn(async (nodeId: string): Promise<SubgraphResult> => ({
      rootNodeId: nodeId,
      nodes: new Map([[nodeId, makeNode({ id: nodeId })]]),
      edges: [],
      hops: new Map([[0, [nodeId]]]),
      totalCostMonthly: 0,
    })),
    getNodeCost: vi.fn(async () => ({
      label: "test",
      totalMonthly: 500,
      byResourceType: {},
      byProvider: {},
      nodes: [],
    })),
    getStats: vi.fn(async (): Promise<GraphStats> => ({
      totalNodes: 5,
      totalEdges: 2,
      totalChanges: 0,
      totalGroups: 0,
      nodesByProvider: {},
      nodesByResourceType: {},
      edgesByRelationshipType: {},
      totalCostMonthly: 500,
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    })),
  } as unknown as GraphEngine;
}

// =============================================================================
// InMemoryContractStore Tests
// =============================================================================

describe("InMemoryContractStore", () => {
  let store: InMemoryContractStore;

  beforeEach(() => {
    store = new InMemoryContractStore();
  });

  it("upserts and retrieves contracts", () => {
    const contract = makeContract();
    store.upsert(contract);

    const retrieved = store.get("contract-1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe("payment-service");
  });

  it("removes contracts", () => {
    store.upsert(makeContract());
    expect(store.remove("contract-1")).toBe(true);
    expect(store.get("contract-1")).toBeUndefined();
    expect(store.remove("contract-1")).toBe(false);
  });

  it("lists contracts with filter", () => {
    store.upsert(makeContract({ id: "c1", owner: "team-a", enabled: true }));
    store.upsert(makeContract({ id: "c2", owner: "team-b", enabled: true }));
    store.upsert(makeContract({ id: "c3", owner: "team-a", enabled: false }));

    expect(store.list().length).toBe(3);
    expect(store.list({ owner: "team-a" }).length).toBe(2);
    expect(store.list({ enabled: true }).length).toBe(2);
    expect(store.list({ owner: "team-a", enabled: true }).length).toBe(1);
  });

  it("lists by dependency", () => {
    store.upsert(makeContract({ id: "c1", dependencies: ["vpc-1", "rds-1"] }));
    store.upsert(makeContract({ id: "c2", dependencies: ["rds-1"] }));
    store.upsert(makeContract({ id: "c3", dependencies: ["s3-1"] }));

    expect(store.listByDependency("rds-1").length).toBe(2);
    expect(store.listByDependency("vpc-1").length).toBe(1);
    expect(store.listByDependency("nonexistent").length).toBe(0);
  });

  it("lists by owner", () => {
    store.upsert(makeContract({ id: "c1", owner: "team-a" }));
    store.upsert(makeContract({ id: "c2", owner: "team-b" }));

    expect(store.listByOwner("team-a").length).toBe(1);
    expect(store.listByOwner("team-c").length).toBe(0);
  });

  it("filters by tags", () => {
    store.upsert(makeContract({ id: "c1", tags: { env: "production" } }));
    store.upsert(makeContract({ id: "c2", tags: { env: "staging" } }));

    expect(store.list({ tags: { env: "production" } }).length).toBe(1);
  });

  it("reports size and can clear", () => {
    store.upsert(makeContract({ id: "c1" }));
    store.upsert(makeContract({ id: "c2" }));
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
  });
});

// =============================================================================
// ContractEngine Tests
// =============================================================================

describe("ContractEngine", () => {
  describe("dependency evaluation", () => {
    it("passes when all dependencies are healthy", async () => {
      const nodes = [
        makeNode({ id: "rds-1", name: "payment-db", status: "running" }),
        makeNode({ id: "vpc-1", name: "main-vpc", status: "running" }),
      ];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        dependencies: ["rds-1", "vpc-1"],
      });

      const result = await contractEngine.evaluateContract(contract);

      expect(result.dependencies.every((d) => d.status === "healthy")).toBe(true);
      expect(result.summary.healthyDependencies).toBe(2);
      expect(result.summary.missingDependencies).toBe(0);
    });

    it("fails when a dependency is missing", async () => {
      const nodes = [makeNode({ id: "rds-1", name: "payment-db" })];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        dependencies: ["rds-1", "vpc-nonexistent"],
      });

      const result = await contractEngine.evaluateContract(contract);

      expect(result.status).toBe("fail");
      expect(result.summary.missingDependencies).toBe(1);
    });

    it("marks disappeared nodes", async () => {
      const nodes = [
        makeNode({ id: "rds-1", name: "ghost-db", status: "disappeared" }),
      ];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({ dependencies: ["rds-1"] });
      const result = await contractEngine.evaluateContract(contract);

      expect(result.dependencies[0].status).toBe("disappeared");
      expect(result.status).toBe("fail");
    });

    it("reports degraded for stopped/errored nodes", async () => {
      const nodes = [makeNode({ id: "ec2-1", status: "stopped" })];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({ dependencies: ["ec2-1"] });
      const result = await contractEngine.evaluateContract(contract);

      expect(result.dependencies[0].status).toBe("degraded");
      expect(result.status).toBe("degraded");
    });
  });

  describe("assertion evaluation", () => {
    it("passes non-empty assertion when nodes exist", async () => {
      const nodes = [
        makeNode({ id: "ec2-1", name: "server-1", provider: "aws", resourceType: "compute" }),
      ];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        assertions: [
          {
            id: "a1",
            description: "Must have compute resources",
            query: 'FIND resources WHERE provider = "aws"',
            expectation: { type: "non-empty" },
            severity: "critical",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);

      expect(result.assertions[0].status).toBe("pass");
      expect(result.assertions[0].resultCount).toBeGreaterThan(0);
    });

    it("fails empty assertion when no nodes match", async () => {
      // Empty graph
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        assertions: [
          {
            id: "a1",
            description: "Must have resources",
            query: 'FIND resources WHERE provider = "aws"',
            expectation: { type: "non-empty" },
            severity: "high",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);

      expect(result.assertions[0].status).toBe("fail");
      expect(result.status).toBe("fail");
    });

    it("handles empty expectation (no orphans)", async () => {
      // No nodes — empty expectation should pass
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        assertions: [
          {
            id: "a1",
            description: "No orphaned databases",
            query: 'FIND resources WHERE resourceType = "database" AND status = "stopped"',
            expectation: { type: "empty" },
            severity: "medium",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);
      expect(result.assertions[0].status).toBe("pass");
    });

    it("handles count expectation", async () => {
      const nodes = Array.from({ length: 3 }, (_, i) =>
        makeNode({ id: `n-${i}`, name: `server-${i}`, provider: "aws" }),
      );
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        assertions: [
          {
            id: "a1",
            description: "Must have at least 2 servers",
            query: 'FIND resources WHERE provider = "aws"',
            expectation: { type: "count", min: 2 },
            severity: "high",
          },
          {
            id: "a2",
            description: "Must not exceed 5 servers",
            query: 'FIND resources WHERE provider = "aws"',
            expectation: { type: "count", max: 5 },
            severity: "medium",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);

      expect(result.assertions[0].status).toBe("pass"); // 3 >= 2
      expect(result.assertions[1].status).toBe("pass"); // 3 <= 5
    });

    it("handles invalid IQL gracefully", async () => {
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        assertions: [
          {
            id: "a1",
            description: "Bad query",
            query: "INVALID SYNTAX !!!",
            expectation: { type: "non-empty" },
            severity: "low",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);

      expect(result.assertions[0].status).toBe("error");
      expect(result.assertions[0].error).toBeTruthy();
    });
  });

  describe("guardrail evaluation", () => {
    it("evaluates max-monthly-cost guardrail", async () => {
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        guardrails: [
          {
            id: "g1",
            type: "max-monthly-cost",
            description: "Total cost must stay under $1000/mo",
            threshold: 1000,
            severity: "high",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);

      // Mock engine returns totalCostMonthly: 500, so 500 <= 1000 passes
      expect(result.guardrails[0].status).toBe("pass");
      expect(result.guardrails[0].actualValue).toBeLessThanOrEqual(1000);
    });

    it("fails when blast radius exceeds threshold", async () => {
      const nodes = [makeNode({ id: "vpc-1" })];
      const storage = mockStorage(nodes);

      // Engine returns blast radius with many nodes
      const bigBlastEngine = {
        ...mockEngine(storage),
        getBlastRadius: vi.fn(async (): Promise<SubgraphResult> => {
          const blastNodes = new Map<string, GraphNode>();
          for (let i = 0; i < 15; i++) {
            blastNodes.set(`n-${i}`, makeNode({ id: `n-${i}` }));
          }
          return {
            rootNodeId: "vpc-1",
            nodes: blastNodes,
            edges: [],
            hops: new Map([[0, ["vpc-1"]]]),
            totalCostMonthly: 0,
          };
        }),
      } as unknown as GraphEngine;

      const contractEngine = new ContractEngine(bigBlastEngine, storage);

      const contract = makeContract({
        guardrails: [
          {
            id: "g1",
            type: "max-blast-radius",
            description: "VPC blast radius must be < 10",
            nodePattern: "vpc-1",
            threshold: 10,
            severity: "critical",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);

      expect(result.guardrails[0].status).toBe("fail");
      expect(result.guardrails[0].actualValue).toBe(14); // 15 - 1 root
    });

    it("errors when nodePattern is missing for blast radius", async () => {
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        guardrails: [
          {
            id: "g1",
            type: "max-blast-radius",
            description: "No node pattern",
            threshold: 5,
            severity: "high",
          },
        ],
      });

      const result = await contractEngine.evaluateContract(contract);
      expect(result.guardrails[0].status).toBe("error");
      expect(result.guardrails[0].error).toContain("nodePattern");
    });
  });

  describe("suite evaluation", () => {
    it("evaluates all contracts in a store", async () => {
      const nodes = [makeNode({ id: "rds-1", status: "running" })];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const store = new InMemoryContractStore();
      store.upsert(makeContract({ id: "c1", name: "svc-1", dependencies: ["rds-1"] }));
      store.upsert(makeContract({ id: "c2", name: "svc-2", dependencies: ["nonexistent"] }));

      const suite = await contractEngine.evaluateAll(store);

      expect(suite.totalContracts).toBe(2);
      expect(suite.passed).toBe(1); // c1 passes
      expect(suite.failed).toBe(1); // c2 fails (missing dep)
    });

    it("skips disabled contracts", async () => {
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const store = new InMemoryContractStore();
      store.upsert(makeContract({ id: "c1", enabled: false }));

      const suite = await contractEngine.evaluateAll(store);

      // Disabled contracts are filtered out by store.list({enabled:true})
      expect(suite.totalContracts).toBe(0);
    });
  });

  describe("change checking", () => {
    it("finds contracts affected by a node change", async () => {
      const nodes = [makeNode({ id: "rds-1", status: "running" })];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const store = new InMemoryContractStore();
      store.upsert(makeContract({
        id: "c1",
        name: "payment-svc",
        dependencies: ["rds-1", "vpc-1"],
      }));
      store.upsert(makeContract({
        id: "c2",
        name: "analytics-svc",
        dependencies: ["s3-1"],
      }));

      const results = await contractEngine.checkChangeAgainstContracts(store, "rds-1");

      expect(results.length).toBe(1);
      expect(results[0].contractId).toBe("c1");
    });
  });

  describe("events", () => {
    it("emits contract-passed event", async () => {
      const nodes = [makeNode({ id: "rds-1", status: "running" })];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const events: ContractEvent[] = [];
      contractEngine.onEvent((e) => events.push(e));

      const contract = makeContract({ dependencies: ["rds-1"] });
      await contractEngine.evaluateContract(contract);

      expect(events.some((e) => e.type === "contract-passed")).toBe(true);
    });

    it("emits contract-failed and dependency-missing events", async () => {
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const events: ContractEvent[] = [];
      contractEngine.onEvent((e) => events.push(e));

      const contract = makeContract({ dependencies: ["missing-node"] });
      await contractEngine.evaluateContract(contract);

      expect(events.some((e) => e.type === "contract-failed")).toBe(true);
      expect(events.some((e) => e.type === "dependency-missing")).toBe(true);
    });

    it("emits guardrail-exceeded event", async () => {
      const storage = mockStorage([]);
      const engine = {
        ...mockEngine(storage),
        getStats: vi.fn(async () => ({
          totalNodes: 0,
          totalEdges: 0,
          totalChanges: 0,
          totalGroups: 0,
          nodesByProvider: {},
          nodesByResourceType: {},
          edgesByRelationshipType: {},
          totalCostMonthly: 5000, // over threshold
          lastSyncAt: null,
          oldestChange: null,
          newestChange: null,
        })),
      } as unknown as GraphEngine;

      const contractEngine = new ContractEngine(engine, storage);
      const events: ContractEvent[] = [];
      contractEngine.onEvent((e) => events.push(e));

      const contract = makeContract({
        guardrails: [
          {
            id: "g1",
            type: "max-monthly-cost",
            description: "Max $1000/mo",
            threshold: 1000,
            severity: "critical",
          },
        ],
      });

      await contractEngine.evaluateContract(contract);

      expect(events.some((e) => e.type === "guardrail-exceeded")).toBe(true);
    });
  });

  describe("formatting", () => {
    it("produces markdown for a contract result", async () => {
      const nodes = [makeNode({ id: "rds-1", status: "running" })];
      const storage = mockStorage(nodes);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const contract = makeContract({
        name: "payment-service",
        dependencies: ["rds-1", "nonexistent"],
      });

      const result = await contractEngine.evaluateContract(contract);
      const md = formatContractResultMarkdown(result);

      expect(md).toContain("payment-service");
      expect(md).toContain("Summary");
      expect(md).toContain("Missing Dependencies");
    });

    it("produces markdown for a suite result", async () => {
      const storage = mockStorage([]);
      const engine = mockEngine(storage);
      const contractEngine = new ContractEngine(engine, storage);

      const store = new InMemoryContractStore();
      store.upsert(makeContract({ id: "c1", name: "svc-a" }));

      const suite = await contractEngine.evaluateAll(store);
      const md = formatContractSuiteMarkdown(suite);

      expect(md).toContain("Infrastructure Contract Suite Results");
    });
  });
});
