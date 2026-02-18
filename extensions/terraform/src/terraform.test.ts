import { describe, expect, it, beforeEach } from "vitest";
import {
  parseState,
  parsePlan,
  detectDrift,
  buildDriftResult,
  buildDependencyGraph,
  getResourceTypes,
  getProviderDistribution,
} from "./parser.js";
import { InMemoryTerraformStorage, createWorkspaceFromInput } from "./storage.js";
import type {
  TerraformState,
  TerraformPlan,
  ParsedResource,
  TerraformStorage,
  StateLock,
  DriftResult,
} from "./types.js";

/* ---------- helpers ---------- */

function makeTfState(overrides: Partial<TerraformState> = {}): TerraformState {
  return {
    version: 4,
    terraform_version: "1.6.0",
    serial: 1,
    lineage: "abc-123",
    outputs: {},
    resources: [],
    ...overrides,
  };
}

function makeTfPlan(overrides: Partial<TerraformPlan> = {}): TerraformPlan {
  return {
    format_version: "1.2",
    terraform_version: "1.6.0",
    resource_changes: [],
    output_changes: {},
    ...overrides,
  };
}

/* ================================================================
   parseState
   ================================================================ */

describe("parseState", () => {
  it("returns empty array for state with no resources", () => {
    const result = parseState(makeTfState());
    expect(result).toEqual([]);
  });

  it("parses a single resource with one instance", () => {
    const state = makeTfState({
      resources: [
        {
          mode: "managed",
          type: "aws_s3_bucket",
          name: "logs",
          provider: "registry.terraform.io/hashicorp/aws",
          instances: [
            {
              schema_version: 0,
              attributes: {
                id: "my-logs-bucket",
                bucket: "my-logs-bucket",
                acl: "private",
                tags: { env: "prod" },
              },
              sensitive_attributes: [],
            },
          ],
        },
      ],
    });

    const resources = parseState(state);
    expect(resources).toHaveLength(1);
    expect(resources[0]!.type).toBe("aws_s3_bucket");
    expect(resources[0]!.name).toBe("logs");
    expect(resources[0]!.providerShort).toBe("aws");
    expect(resources[0]!.attributes.id).toBe("my-logs-bucket");
    expect(resources[0]!.attributes.tags).toEqual({ env: "prod" });
  });

  it("parses multiple resources from different providers", () => {
    const state = makeTfState({
      resources: [
        {
          mode: "managed",
          type: "aws_instance",
          name: "web",
          provider: "registry.terraform.io/hashicorp/aws",
          instances: [{ schema_version: 0, attributes: { id: "i-123" }, sensitive_attributes: [] }],
        },
        {
          mode: "managed",
          type: "azurerm_resource_group",
          name: "rg",
          provider: "registry.terraform.io/hashicorp/azurerm",
          instances: [{ schema_version: 0, attributes: { id: "/sub/rg1" }, sensitive_attributes: [] }],
        },
      ],
    });

    const resources = parseState(state);
    expect(resources).toHaveLength(2);
    expect(resources[0]!.providerShort).toBe("aws");
    expect(resources[1]!.providerShort).toBe("azurerm");
  });

  it("handles multi-instance (count/for_each)", () => {
    const state = makeTfState({
      resources: [
        {
          mode: "managed",
          type: "aws_subnet",
          name: "private",
          provider: "registry.terraform.io/hashicorp/aws",
          instances: [
            { schema_version: 0, attributes: { id: "sub-a" }, sensitive_attributes: [] },
            { schema_version: 0, attributes: { id: "sub-b" }, sensitive_attributes: [] },
          ],
        },
      ],
    });

    const resources = parseState(state);
    expect(resources).toHaveLength(2);
    expect(resources[0]!.address).toBe("aws_subnet.private[0]");
    expect(resources[1]!.address).toBe("aws_subnet.private[1]");
  });

  it("parses resources with correct address", () => {
    const state = makeTfState({
      resources: [
        {
          mode: "managed",
          type: "aws_vpc",
          name: "main",
          provider: "registry.terraform.io/hashicorp/aws",
          instances: [{ schema_version: 0, attributes: { id: "vpc-1" }, sensitive_attributes: [] }],
        },
      ],
    });

    const resources = parseState(state);
    expect(resources).toHaveLength(1);
    expect(resources[0]!.address).toBe("aws_vpc.main");
    expect(resources[0]!.type).toBe("aws_vpc");
  });

  it("classifies data sources via mode", () => {
    const state = makeTfState({
      resources: [
        {
          mode: "data",
          type: "aws_ami",
          name: "latest",
          provider: "registry.terraform.io/hashicorp/aws",
          instances: [{ schema_version: 0, attributes: { id: "ami-abc" }, sensitive_attributes: [] }],
        },
      ],
    });

    const resources = parseState(state);
    expect(resources[0]!.mode).toBe("data");
  });
});

/* ================================================================
   parsePlan
   ================================================================ */

describe("parsePlan", () => {
  it("returns zeroed summary for empty plan", () => {
    const summary = parsePlan(makeTfPlan());
    expect(summary.totalChanges).toBe(0);
    expect(summary.creates).toBe(0);
    expect(summary.updates).toBe(0);
    expect(summary.deletes).toBe(0);
    expect(summary.noOps).toBe(0);
  });

  it("counts create actions", () => {
    const plan = makeTfPlan({
      resource_changes: [
        {
          address: "aws_s3_bucket.new",
          mode: "managed",
          type: "aws_s3_bucket",
          name: "new",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: { actions: ["create"], before: null, after: { id: "b" }, after_unknown: {} },
        },
      ],
    });

    const summary = parsePlan(plan);
    expect(summary.creates).toBe(1);
    expect(summary.totalChanges).toBe(1);
  });

  it("counts update actions", () => {
    const plan = makeTfPlan({
      resource_changes: [
        {
          address: "aws_s3_bucket.existing",
          mode: "managed",
          type: "aws_s3_bucket",
          name: "existing",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: { actions: ["update"], before: { id: "b" }, after: { id: "b" }, after_unknown: {} },
        },
      ],
    });

    const summary = parsePlan(plan);
    expect(summary.updates).toBe(1);
  });

  it("counts delete actions", () => {
    const plan = makeTfPlan({
      resource_changes: [
        {
          address: "aws_instance.old",
          mode: "managed",
          type: "aws_instance",
          name: "old",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: { actions: ["delete"], before: { id: "i" }, after: null, after_unknown: {} },
        },
      ],
    });

    const summary = parsePlan(plan);
    expect(summary.deletes).toBe(1);
  });

  it("counts replace (delete+create) as both a create and delete", () => {
    const plan = makeTfPlan({
      resource_changes: [
        {
          address: "aws_instance.replaced",
          mode: "managed",
          type: "aws_instance",
          name: "replaced",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: { actions: ["delete", "create"], before: { id: "i" }, after: { id: "i2" }, after_unknown: {} },
        },
      ],
    });

    const summary = parsePlan(plan);
    // parsePlan counts replace as both a create + delete
    expect(summary.creates).toBe(1);
    expect(summary.deletes).toBe(1);
    expect(summary.totalChanges).toBe(2);
    expect(summary.hasDestructiveChanges).toBe(true);
  });

  it("reports affected addresses", () => {
    const plan = makeTfPlan({
      resource_changes: [
        {
          address: "aws_s3_bucket.a",
          mode: "managed",
          type: "aws_s3_bucket",
          name: "a",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: { actions: ["create"], before: null, after: {}, after_unknown: {} },
        },
        {
          address: "aws_iam_role.b",
          mode: "managed",
          type: "aws_iam_role",
          name: "b",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: { actions: ["create"], before: null, after: {}, after_unknown: {} },
        },
      ],
    });

    const summary = parsePlan(plan);
    expect(summary.affectedAddresses).toContain("aws_s3_bucket.a");
    expect(summary.affectedAddresses).toContain("aws_iam_role.b");
    expect(summary.byType["aws_s3_bucket"]).toBeDefined();
    expect(summary.byType["aws_iam_role"]).toBeDefined();
  });
});

/* ================================================================
   detectDrift
   ================================================================ */

describe("detectDrift", () => {
  it("returns empty diff for identical attributes", () => {
    const desired: Record<string, unknown> = { id: "x", tags: { env: "prod" } };
    const actual: Record<string, unknown> = { id: "x", tags: { env: "prod" } };
    const fields = detectDrift(desired, actual);
    expect(fields).toHaveLength(0);
  });

  it("detects changed string field", () => {
    const desired = { acl: "private" };
    const actual = { acl: "public-read" };
    const fields = detectDrift(desired, actual);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.path).toBe("acl");
    expect(fields[0]!.expectedValue).toBe("private");
    expect(fields[0]!.actualValue).toBe("public-read");
  });

  it("detects changed numeric field", () => {
    const fields = detectDrift({ port: 443 }, { port: 80 });
    expect(fields).toHaveLength(1);
    expect(fields[0]!.path).toBe("port");
  });

  it("detects missing field in actual", () => {
    const fields = detectDrift({ encryption: true }, {});
    expect(fields).toHaveLength(1);
    expect(fields[0]!.path).toBe("encryption");
    expect(fields[0]!.actualValue).toBeUndefined();
  });

  it("detects extra field in actual", () => {
    const fields = detectDrift({}, { rogue: "value" });
    expect(fields).toHaveLength(1);
    expect(fields[0]!.path).toBe("rogue");
    expect(fields[0]!.expectedValue).toBeUndefined();
  });

  it("detects nested object changes with dot-path", () => {
    const desired = { config: { nested: { value: "a" } } };
    const actual = { config: { nested: { value: "b" } } };
    const fields = detectDrift(desired, actual);
    expect(fields.some((f) => f.path.includes("config") && f.expectedValue === "a")).toBe(true);
  });

  it("detects array length changes", () => {
    const desired = { cidrs: ["10.0.0.0/16"] };
    const actual = { cidrs: ["10.0.0.0/16", "10.1.0.0/16"] };
    const fields = detectDrift(desired, actual);
    expect(fields.length).toBeGreaterThan(0);
  });
});

/* ================================================================
   buildDriftResult
   ================================================================ */

describe("buildDriftResult", () => {
  it("builds a DriftResult from parsed resources and live state", () => {
    const desired: ParsedResource[] = [
      {
        type: "aws_s3_bucket",
        name: "logs",
        provider: "registry.terraform.io/hashicorp/aws",
        providerShort: "aws",
        mode: "managed",
        address: "aws_s3_bucket.logs",
        attributes: { id: "bucket-1", acl: "private" },
        dependencies: [],
      },
    ];
    const live = new Map<string, Record<string, unknown>>([
      ["aws_s3_bucket.logs", { id: "bucket-1", acl: "public-read" }],
    ]);

    const result = buildDriftResult("state-1", desired, live);
    expect(result.stateId).toBe("state-1");
    expect(result.driftedResources).toHaveLength(1);
    expect(result.driftedResources[0]!.address).toBe("aws_s3_bucket.logs");
    expect(result.totalResources).toBe(1);
    expect(result.summary.totalDrifted).toBe(1);
  });

  it("reports zero drift for identical resources", () => {
    const resources: ParsedResource[] = [
      {
        type: "aws_vpc",
        name: "main",
        provider: "registry.terraform.io/hashicorp/aws",
        providerShort: "aws",
        mode: "managed",
        address: "aws_vpc.main",
        attributes: { id: "vpc-1", cidr_block: "10.0.0.0/16" },
        dependencies: [],
      },
    ];
    const live = new Map<string, Record<string, unknown>>([
      ["aws_vpc.main", { id: "vpc-1", cidr_block: "10.0.0.0/16" }],
    ]);

    const result = buildDriftResult("s1", resources, live);
    expect(result.summary.totalDrifted).toBe(0);
    expect(result.driftedResources).toHaveLength(0);
  });
});

/* ================================================================
   buildDependencyGraph
   ================================================================ */

describe("buildDependencyGraph", () => {
  it("builds graph with depends_on edges", () => {
    const resources: ParsedResource[] = [
      {
        type: "aws_subnet",
        name: "sub",
        provider: "registry.terraform.io/hashicorp/aws",
        providerShort: "aws",
        mode: "managed",
        address: "aws_subnet.sub",
        attributes: { id: "sub-a", vpc_id: "vpc-1" },
        dependencies: ["aws_vpc.main"],
      },
      {
        type: "aws_vpc",
        name: "main",
        provider: "registry.terraform.io/hashicorp/aws",
        providerShort: "aws",
        mode: "managed",
        address: "aws_vpc.main",
        attributes: { id: "vpc-1" },
        dependencies: [],
      },
    ];

    const graph = buildDependencyGraph(resources);
    expect(graph).toHaveLength(1);
    expect(graph[0]).toEqual({ from: "aws_subnet.sub", to: "aws_vpc.main" });
  });

  it("returns empty graph for no resources", () => {
    const graph = buildDependencyGraph([]);
    expect(graph).toHaveLength(0);
  });
});

/* ================================================================
   getResourceTypes / getProviderDistribution
   ================================================================ */

describe("util helpers", () => {
  const resources: ParsedResource[] = [
    { type: "aws_s3_bucket", name: "a", provider: "registry.terraform.io/hashicorp/aws", providerShort: "aws", mode: "managed", address: "aws_s3_bucket.a", attributes: {}, dependencies: [] },
    { type: "aws_instance", name: "b", provider: "registry.terraform.io/hashicorp/aws", providerShort: "aws", mode: "managed", address: "aws_instance.b", attributes: {}, dependencies: [] },
    { type: "azurerm_resource_group", name: "c", provider: "registry.terraform.io/hashicorp/azurerm", providerShort: "azurerm", mode: "managed", address: "azurerm_resource_group.c", attributes: {}, dependencies: [] },
  ];

  it("getResourceTypes returns unique types", () => {
    const types = getResourceTypes(resources);
    expect(types).toEqual(["aws_s3_bucket", "aws_instance", "azurerm_resource_group"]);
  });

  it("getProviderDistribution counts per provider", () => {
    const dist = getProviderDistribution(resources);
    expect(dist.aws).toBe(2);
    expect(dist.azurerm).toBe(1);
  });
});

/* ================================================================
   InMemoryTerraformStorage
   ================================================================ */

describe("InMemoryTerraformStorage", () => {
  let storage: TerraformStorage;

  beforeEach(async () => {
    storage = new InMemoryTerraformStorage();
    await storage.initialize();
  });

  /* --- workspaces --- */

  it("creates and lists workspaces", async () => {
    const ws = createWorkspaceFromInput({ id: "w1", name: "prod", statePath: "s3://tf/prod", backend: "s3", environment: "production" });
    await storage.saveWorkspace(ws);
    const list = await storage.listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("prod");
  });

  it("retrieves workspace by id", async () => {
    const ws = createWorkspaceFromInput({ id: "w2", name: "staging", statePath: "/state", backend: "local", environment: "staging" });
    await storage.saveWorkspace(ws);
    const found = await storage.getWorkspace("w2");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("staging");
  });

  it("deletes workspace", async () => {
    const ws = createWorkspaceFromInput({ id: "w3", name: "dev", statePath: "/dev", backend: "local", environment: "development" });
    await storage.saveWorkspace(ws);
    await storage.deleteWorkspace("w3");
    const found = await storage.getWorkspace("w3");
    expect(found).toBeNull();
  });

  it("returns null for non-existent workspace", async () => {
    const ws = await storage.getWorkspace("nonexistent");
    expect(ws).toBeNull();
  });

  /* --- drift history --- */

  it("stores and retrieves drift results", async () => {
    const drift: DriftResult = {
      stateId: "s1",
      detectedAt: new Date().toISOString(),
      totalResources: 5,
      driftedResources: [],
      errorResources: [],
      summary: { totalDrifted: 0, totalErrors: 0, totalClean: 5, byProvider: {}, byType: {} },
    };
    await storage.saveDriftResult(drift);
    const history = await storage.getDriftHistory("s1");
    expect(history).toHaveLength(1);
    expect(history[0]!.totalResources).toBe(5);
  });

  it("limits drift history results", async () => {
    for (let i = 0; i < 5; i++) {
      const drift: DriftResult = {
        stateId: "s2",
        detectedAt: new Date(Date.now() + i * 1000).toISOString(),
        totalResources: i,
        driftedResources: [],
        errorResources: [],
        summary: { totalDrifted: 0, totalErrors: 0, totalClean: i, byProvider: {}, byType: {} },
      };
      await storage.saveDriftResult(drift);
    }
    const history = await storage.getDriftHistory("s2", 3);
    expect(history).toHaveLength(3);
  });

  /* --- state locking --- */

  it("acquires and releases a lock", async () => {
    const lock: StateLock = { id: "lock-1", stateId: "s1", operation: "applying", lockedBy: "user-1", lockedAt: new Date().toISOString() };
    const acquired = await storage.acquireLock(lock);
    expect(acquired).toBe(true);

    const current = await storage.getLock("s1");
    expect(current).not.toBeNull();
    expect(current!.lockedBy).toBe("user-1");

    await storage.releaseLock("s1", "lock-1");
    const after = await storage.getLock("s1");
    expect(after).toBeNull();
  });

  it("prevents double-locking", async () => {
    const lock1: StateLock = { id: "lock-1", stateId: "s1", operation: "plan", lockedBy: "user-1", lockedAt: new Date().toISOString() };
    const lock2: StateLock = { id: "lock-2", stateId: "s1", operation: "apply", lockedBy: "user-2", lockedAt: new Date().toISOString() };
    await storage.acquireLock(lock1);
    const second = await storage.acquireLock(lock2);
    expect(second).toBe(false);
  });

  it("returns null for lock on unlocked state", async () => {
    const lock = await storage.getLock("no-lock");
    expect(lock).toBeNull();
  });
});

/* ================================================================
   createWorkspaceFromInput
   ================================================================ */

describe("createWorkspaceFromInput", () => {
  it("populates defaults", () => {
    const ws = createWorkspaceFromInput({
      name: "test-ws",
      statePath: "s3://bucket/state",
      backend: "s3",
    });
    expect(ws.id).toBeTruthy();
    expect(ws.name).toBe("test-ws");
    expect(ws.createdAt).toBeTruthy();
    expect(ws.updatedAt).toBeTruthy();
  });

  it("preserves explicit fields", () => {
    const ws = createWorkspaceFromInput({
      name: "ws",
      statePath: "https://sa.blob.core.windows.net/state",
      backend: "azurerm",
      environment: "production",
    });
    expect(ws.environment).toBe("production");
    expect(ws.backend).toBe("azurerm");
  });
});
