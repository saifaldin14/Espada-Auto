/**
 * Infrastructure Knowledge Graph — RBAC Tests (P3.23)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import type {
  GraphStorage,
  GraphNodeInput,
  GraphEdgeInput,
  CloudProvider,
} from "../types.js";
import {
  RBACGraphStorage,
  AccessDeniedError,
  getEffectivePermissions,
  getRolePermissions,
  isNodeInScope,
  mergeFilterWithScope,
  createRBACPolicy,
  resolvePrincipal,
  withRBAC,
  formatRBACPolicyMarkdown,
  DEFAULT_RBAC_POLICY,
} from "./rbac.js";
import type {
  RBACRole,
  AccessScope,
  RBACPermissions,
  RBACPrincipal,
  RBACPolicy,
} from "./rbac.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id,
    name: id,
    provider: "aws",
    account: "111111",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: id,
    status: "running",
    tags: { env: "production" },
    metadata: {},
    costMonthly: 100,
    owner: null,
    createdAt: null,
    ...overrides,
  };
}

function makeEdge(src: string, tgt: string): GraphEdgeInput {
  return {
    id: `${src}:connects-to:${tgt}`,
    sourceNodeId: src,
    targetNodeId: tgt,
    relationshipType: "connects-to",
    confidence: 1.0,
    discoveredVia: "api-list",
    metadata: {},
  };
}

function makePrincipal(
  id: string,
  role: RBACRole,
  scope: AccessScope = {},
  overrides?: Partial<RBACPrincipal>,
): RBACPrincipal {
  return { id, name: `Principal ${id}`, role, scope, ...overrides };
}

async function seedStorage(storage: GraphStorage): Promise<void> {
  const nodes: GraphNodeInput[] = [
    makeNode("aws:us-east-1:compute:web-1", { provider: "aws", region: "us-east-1", account: "111111", resourceType: "compute" }),
    makeNode("aws:us-east-1:database:db-1", { provider: "aws", region: "us-east-1", account: "111111", resourceType: "database" }),
    makeNode("azure:eu-west-1:compute:vm-1", { provider: "azure", region: "eu-west-1", account: "222222", resourceType: "compute" }),
    makeNode("gcp:us-west-2:storage:bucket-1", { provider: "gcp", region: "us-west-2", account: "333333", resourceType: "storage", tags: { env: "staging" } }),
  ];
  const edges: GraphEdgeInput[] = [
    makeEdge("aws:us-east-1:compute:web-1", "aws:us-east-1:database:db-1"),
    makeEdge("azure:eu-west-1:compute:vm-1", "gcp:us-west-2:storage:bucket-1"),
  ];
  await storage.upsertNodes(nodes);
  await storage.upsertEdges(edges);
}

// =============================================================================
// Tests — Role Permissions
// =============================================================================

describe("getRolePermissions", () => {
  it("viewer has read but no write/cost/export", () => {
    const p = getRolePermissions("viewer");
    expect(p.read).toBe(true);
    expect(p.write).toBe(false);
    expect(p.readCost).toBe(false);
    expect(p.readChanges).toBe(false);
    expect(p.export).toBe(false);
    expect(p.traverse).toBe(true);
    expect(p.readStats).toBe(true);
  });

  it("operator has read + cost + changes + export", () => {
    const p = getRolePermissions("operator");
    expect(p.read).toBe(true);
    expect(p.write).toBe(false);
    expect(p.readCost).toBe(true);
    expect(p.readChanges).toBe(true);
    expect(p.export).toBe(true);
  });

  it("admin has all except superadmin-only flags", () => {
    const p = getRolePermissions("admin");
    expect(p.write).toBe(true);
    expect(p.manageGroups).toBe(true);
    expect(p.manageSync).toBe(true);
  });

  it("superadmin has everything", () => {
    const p = getRolePermissions("superadmin");
    for (const val of Object.values(p)) {
      expect(val).toBe(true);
    }
  });

  it("returns a copy (does not mutate internals)", () => {
    const a = getRolePermissions("viewer");
    const b = getRolePermissions("viewer");
    a.write = true;
    expect(b.write).toBe(false);
  });
});

// =============================================================================
// Tests — Effective Permissions (with overrides)
// =============================================================================

describe("getEffectivePermissions", () => {
  it("applies permission overrides on top of role defaults", () => {
    const principal = makePrincipal("u1", "viewer", {}, {
      permissionOverrides: { readCost: true, export: true },
    });
    const p = getEffectivePermissions(principal);
    expect(p.read).toBe(true);
    expect(p.readCost).toBe(true); // overridden
    expect(p.export).toBe(true); // overridden
    expect(p.write).toBe(false); // not overridden
  });

  it("returns role defaults when no overrides", () => {
    const principal = makePrincipal("u2", "admin");
    const p = getEffectivePermissions(principal);
    expect(p).toEqual(getRolePermissions("admin"));
  });
});

// =============================================================================
// Tests — Scope Checking
// =============================================================================

describe("isNodeInScope", () => {
  const awsNode = {
    id: "n1", name: "n1", provider: "aws" as const, account: "111111",
    region: "us-east-1", resourceType: "compute" as const, nativeId: "n1",
    status: "running" as const, tags: { env: "production" }, metadata: {},
    costMonthly: null, owner: null, createdAt: "", updatedAt: "", lastSeenAt: "",
  };

  it("empty scope matches everything", () => {
    expect(isNodeInScope(awsNode, {})).toBe(true);
  });

  it("filters by provider", () => {
    expect(isNodeInScope(awsNode, { providers: ["aws"] })).toBe(true);
    expect(isNodeInScope(awsNode, { providers: ["azure"] })).toBe(false);
  });

  it("filters by account", () => {
    expect(isNodeInScope(awsNode, { accounts: ["111111"] })).toBe(true);
    expect(isNodeInScope(awsNode, { accounts: ["999999"] })).toBe(false);
  });

  it("filters by region", () => {
    expect(isNodeInScope(awsNode, { regions: ["us-east-1"] })).toBe(true);
    expect(isNodeInScope(awsNode, { regions: ["eu-west-1"] })).toBe(false);
  });

  it("filters by resource type", () => {
    expect(isNodeInScope(awsNode, { resourceTypes: ["compute"] })).toBe(true);
    expect(isNodeInScope(awsNode, { resourceTypes: ["database"] })).toBe(false);
  });

  it("filters by required tags", () => {
    expect(isNodeInScope(awsNode, { requiredTags: { env: "production" } })).toBe(true);
    expect(isNodeInScope(awsNode, { requiredTags: { env: "staging" } })).toBe(false);
  });

  it("all scope dimensions must match (AND logic)", () => {
    expect(isNodeInScope(awsNode, {
      providers: ["aws"],
      regions: ["eu-west-1"], // mismatch
    })).toBe(false);
  });
});

// =============================================================================
// Tests — mergeFilterWithScope
// =============================================================================

describe("mergeFilterWithScope", () => {
  it("applies single-valued scope as pre-filter", () => {
    const merged = mergeFilterWithScope({}, { providers: ["aws"] });
    expect(merged.provider).toBe("aws");
  });

  it("does not override existing filter provider", () => {
    const merged = mergeFilterWithScope(
      { provider: "aws" },
      { providers: ["aws", "azure"] },
    );
    expect(merged.provider).toBe("aws");
  });

  it("returns impossible filter when filter provider is out of scope", () => {
    const merged = mergeFilterWithScope(
      { provider: "gcp" },
      { providers: ["aws"] },
    );
    // Should produce a filter that matches nothing
    expect(merged.namePattern).toBe("__rbac_no_match__");
  });

  it("merges required tags into filter", () => {
    const merged = mergeFilterWithScope(
      { tags: { team: "infra" } },
      { requiredTags: { env: "production" } },
    );
    expect(merged.tags).toEqual({ team: "infra", env: "production" });
  });

  it("applies account and region from single-valued scope", () => {
    const merged = mergeFilterWithScope(
      {},
      { accounts: ["111111"], regions: ["us-east-1"] },
    );
    expect(merged.account).toBe("111111");
    expect(merged.region).toBe("us-east-1");
  });
});

// =============================================================================
// Tests — RBACGraphStorage
// =============================================================================

describe("RBACGraphStorage", () => {
  let inner: InMemoryGraphStorage;
  let policy: RBACPolicy;

  beforeEach(async () => {
    inner = new InMemoryGraphStorage();
    await inner.initialize();
    await seedStorage(inner);
    policy = createRBACPolicy([], { auditLog: true });
  });

  // -- Permission Enforcement --------------------------------------------------

  describe("permission enforcement", () => {
    it("viewer can read nodes", async () => {
      const principal = makePrincipal("viewer1", "viewer");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const nodes = await rbac.queryNodes({});
      expect(nodes.length).toBeGreaterThan(0);
    });

    it("viewer cannot write nodes", async () => {
      const principal = makePrincipal("viewer1", "viewer");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await expect(
        rbac.upsertNode(makeNode("new-node")),
      ).rejects.toThrow(AccessDeniedError);
    });

    it("viewer cannot read changes", async () => {
      const principal = makePrincipal("viewer1", "viewer");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await expect(rbac.getChanges({})).rejects.toThrow(AccessDeniedError);
    });

    it("operator can read changes and cost", async () => {
      const principal = makePrincipal("op1", "operator");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const changes = await rbac.getChanges({});
      expect(changes).toBeInstanceOf(Array);
    });

    it("operator cannot write nodes", async () => {
      const principal = makePrincipal("op1", "operator");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await expect(
        rbac.upsertNode(makeNode("denied-node")),
      ).rejects.toThrow(AccessDeniedError);
    });

    it("admin can write nodes", async () => {
      const principal = makePrincipal("admin1", "admin");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await rbac.upsertNode(makeNode("admin-node"));
      const stored = await rbac.getNode("admin-node");
      expect(stored).not.toBeNull();
    });

    it("admin can manage groups", async () => {
      const principal = makePrincipal("admin1", "admin");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await rbac.upsertGroup({
        id: "g1",
        name: "test group",
        description: "",
        groupType: "application",
        memberNodeIds: [],
        tags: {},
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const group = await rbac.getGroup("g1");
      expect(group).not.toBeNull();
    });

    it("viewer cannot manage groups", async () => {
      const principal = makePrincipal("viewer1", "viewer");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await expect(
        rbac.upsertGroup({
          id: "g2", name: "denied", description: "", groupType: "application",
          memberNodeIds: [], tags: {}, metadata: {},
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow(AccessDeniedError);
    });
  });

  // -- Scope Filtering ---------------------------------------------------------

  describe("scope filtering", () => {
    it("filters nodes by provider scope", async () => {
      const principal = makePrincipal("aws-only", "admin", { providers: ["aws"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const nodes = await rbac.queryNodes({});
      expect(nodes.every((n) => n.provider === "aws")).toBe(true);
      expect(nodes.length).toBe(2); // web-1, db-1
    });

    it("filters nodes by region scope", async () => {
      const principal = makePrincipal("us-east", "admin", { regions: ["us-east-1"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const nodes = await rbac.queryNodes({});
      expect(nodes.every((n) => n.region === "us-east-1")).toBe(true);
      expect(nodes.length).toBe(2);
    });

    it("returns null for out-of-scope getNode", async () => {
      const principal = makePrincipal("aws-only", "admin", { providers: ["aws"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const node = await rbac.getNode("azure:eu-west-1:compute:vm-1");
      expect(node).toBeNull();
    });

    it("filters edges by scope", async () => {
      const principal = makePrincipal("aws-only", "admin", { providers: ["aws"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const edges = await rbac.queryEdges({});
      // Should only see the AWS-internal edge (web-1 → db-1)
      expect(edges.length).toBe(1);
      expect(edges[0]!.sourceNodeId).toBe("aws:us-east-1:compute:web-1");
    });

    it("filters by required tags", async () => {
      const principal = makePrincipal("prod-only", "admin", {
        requiredTags: { env: "production" },
      });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const nodes = await rbac.queryNodes({});
      // gcp bucket has env: staging, should be excluded
      expect(nodes.every((n) => n.tags.env === "production")).toBe(true);
    });

    it("empty scope shows all nodes", async () => {
      const principal = makePrincipal("all-access", "admin", {});
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const nodes = await rbac.queryNodes({});
      expect(nodes.length).toBe(4);
    });
  });

  // -- Audit Log ---------------------------------------------------------------

  describe("audit log", () => {
    it("records granted access decisions", async () => {
      const principal = makePrincipal("audited", "admin");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await rbac.queryNodes({});
      const log = rbac.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log.some((d) => d.granted)).toBe(true);
      expect(log[0]!.principalId).toBe("audited");
    });

    it("records denied access decisions", async () => {
      const principal = makePrincipal("denied-user", "viewer");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      try { await rbac.upsertNode(makeNode("x")); } catch { /* expected */ }
      const log = rbac.getAuditLog();
      expect(log.some((d) => !d.granted)).toBe(true);
    });

    it("records filtered node counts when scope removes nodes", async () => {
      // Use a multi-provider scope so mergeFilterWithScope can't pre-apply it
      // (pre-apply only works for single-provider scopes). The filterNodes
      // step will then catch non-matching nodes and record filteredCount.
      const principal = makePrincipal("multi", "admin", {
        providers: ["aws", "azure"], // gcp is excluded
      });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      await rbac.queryNodes({});
      const log = rbac.getAuditLog();
      // gcp node should be filtered out → filteredCount > 0
      const filtered = log.find((d) => d.filteredCount && d.filteredCount > 0);
      expect(filtered).toBeDefined();
      expect(filtered!.filteredCount).toBe(1); // the gcp node
    });

    it("audit log is disabled when policy.auditLog=false", async () => {
      const noAuditPolicy = createRBACPolicy([], { auditLog: false });
      const principal = makePrincipal("silent", "admin");
      const rbac = new RBACGraphStorage(inner, principal, noAuditPolicy);
      await rbac.queryNodes({});
      expect(rbac.getAuditLog().length).toBe(0);
    });
  });

  // -- Edge filtering (cross-scope) -------------------------------------------

  describe("edge filtering", () => {
    it("excludes edges where one endpoint is out of scope", async () => {
      const principal = makePrincipal("azure-only", "admin", { providers: ["azure"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const edges = await rbac.queryEdges({});
      // The azure→gcp edge should be excluded because gcp is out of scope
      expect(edges.length).toBe(0);
    });

    it("getEdge returns null for out-of-scope edge", async () => {
      const principal = makePrincipal("aws-only", "admin", { providers: ["aws"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const edge = await rbac.getEdge("azure:eu-west-1:compute:vm-1:connects-to:gcp:us-west-2:storage:bucket-1");
      expect(edge).toBeNull();
    });
  });

  // -- Paginated queries -------------------------------------------------------

  describe("paginated queries", () => {
    it("queryNodesPaginated filters by scope", async () => {
      const principal = makePrincipal("aws-only", "admin", { providers: ["aws"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const result = await rbac.queryNodesPaginated({});
      expect(result.items.length).toBe(2);
      expect(result.totalCount).toBe(2);
    });
  });

  // -- Traversal permission -------------------------------------------------------

  describe("traversal permission", () => {
    it("viewer can traverse (granted by default)", async () => {
      const principal = makePrincipal("v1", "viewer");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const result = await rbac.getNeighbors("aws:us-east-1:compute:web-1", 1, "both");
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  // -- Stats filtering ---------------------------------------------------------

  describe("stats", () => {
    it("scoped principal gets filtered stats", async () => {
      const principal = makePrincipal("aws-only", "admin", { providers: ["aws"] });
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const stats = await rbac.getStats();
      expect(stats.totalNodes).toBe(2);
    });

    it("superadmin gets unfiltered stats", async () => {
      const principal = makePrincipal("super", "superadmin");
      const rbac = new RBACGraphStorage(inner, principal, policy);
      const stats = await rbac.getStats();
      expect(stats.totalNodes).toBe(4);
    });
  });
});

// =============================================================================
// Tests — Policy Management
// =============================================================================

describe("createRBACPolicy", () => {
  it("creates an enabled policy with defaults", () => {
    const policy = createRBACPolicy([]);
    expect(policy.enabled).toBe(true);
    expect(policy.defaultRole).toBe("viewer");
    expect(policy.auditLog).toBe(true);
  });

  it("respects custom options", () => {
    const policy = createRBACPolicy(
      [makePrincipal("u1", "admin")],
      { defaultRole: "operator", auditLog: false },
    );
    expect(policy.defaultRole).toBe("operator");
    expect(policy.auditLog).toBe(false);
    expect(policy.principals.length).toBe(1);
  });
});

describe("resolvePrincipal", () => {
  it("returns registered principal if found", () => {
    const policy = createRBACPolicy([
      makePrincipal("u1", "admin", { providers: ["aws"] }),
    ]);
    const resolved = resolvePrincipal(policy, "u1");
    expect(resolved.role).toBe("admin");
    expect(resolved.scope.providers).toEqual(["aws"]);
  });

  it("returns anonymous principal with default role if not found", () => {
    const policy = createRBACPolicy([], { defaultRole: "viewer" });
    const resolved = resolvePrincipal(policy, "unknown-user");
    expect(resolved.role).toBe("viewer");
    expect(resolved.name).toBe("Unknown");
    expect(resolved.scope).toEqual({});
  });
});

describe("withRBAC", () => {
  it("returns unwrapped storage when RBAC is disabled", async () => {
    const storage = new InMemoryGraphStorage();
    const wrapped = withRBAC(storage, DEFAULT_RBAC_POLICY, "any-user");
    // Should be the same object (no wrapping)
    expect(wrapped).toBe(storage);
  });

  it("returns RBACGraphStorage when RBAC is enabled", async () => {
    const storage = new InMemoryGraphStorage();
    const policy = createRBACPolicy([]);
    const wrapped = withRBAC(storage, policy, "user1");
    expect(wrapped).toBeInstanceOf(RBACGraphStorage);
  });
});

describe("formatRBACPolicyMarkdown", () => {
  it("produces markdown with role table", () => {
    const policy = createRBACPolicy([
      makePrincipal("u1", "admin", { providers: ["aws"] }),
    ]);
    const md = formatRBACPolicyMarkdown(policy);
    expect(md).toContain("# RBAC Policy Summary");
    expect(md).toContain("| admin |");
    expect(md).toContain("| viewer |");
    expect(md).toContain("u1");
  });
});

describe("AccessDeniedError", () => {
  it("has correct name and properties", () => {
    const err = new AccessDeniedError("user1", "upsertNode", "Missing permission: write");
    expect(err.name).toBe("AccessDeniedError");
    expect(err.principalId).toBe("user1");
    expect(err.operation).toBe("upsertNode");
    expect(err.reason).toBe("Missing permission: write");
    expect(err.message).toContain("user1");
    expect(err.message).toContain("write");
  });
});
