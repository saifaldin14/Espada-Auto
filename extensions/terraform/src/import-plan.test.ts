/**
 * Terraform Import Planner — Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { CodifyNode } from "./hcl-generator.js";
import {
  generateImportBlocks,
  renderImportBlocksHCL,
  generateImportScript,
  createImportPlan,
  renderImportPlan,
  initImportResult,
  updateImportStatus,
  importSummary,
  type ImportBlock,
  type ImportPlan,
  type ImportPlanEntry,
} from "./import-plan.js";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<CodifyNode> & { id: string; name: string; nativeId: string }): CodifyNode {
  return {
    provider: "aws",
    resourceType: "compute",
    region: "us-east-1",
    account: "123456789",
    tags: {},
    metadata: {},
    ...overrides,
  };
}

type Edge = { sourceId: string; targetId: string; relationshipType?: string };

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("generateImportBlocks", () => {
  it("generates import blocks from nodes", () => {
    const nodes = [
      makeNode({ id: "n1", name: "web", nativeId: "i-abc123" }),
    ];

    const blocks = generateImportBlocks(nodes, []);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0]!.id).toBe("i-abc123");
    expect(blocks[0]!.to).toContain("web");
  });

  it("filters out nodes without nativeId", () => {
    const nodes = [
      makeNode({ id: "n1", name: "web", nativeId: "i-abc" }),
      makeNode({ id: "n2", name: "empty", nativeId: "" }),
    ];

    const blocks = generateImportBlocks(nodes, []);
    const ids = blocks.map((b) => b.id);
    expect(ids).toContain("i-abc");
    expect(ids).not.toContain("");
  });

  it("sets provider for non-AWS resources", () => {
    const nodes = [
      makeNode({ id: "n1", name: "vm", nativeId: "vm-123", provider: "gcp" }),
    ];

    const blocks = generateImportBlocks(nodes, []);
    expect(blocks[0]!.provider).toBe("gcp");
  });

  it("omits provider for AWS resources", () => {
    const nodes = [
      makeNode({ id: "n1", name: "instance", nativeId: "i-abc" }),
    ];

    const blocks = generateImportBlocks(nodes, []);
    expect(blocks[0]!.provider).toBeUndefined();
  });

  it("applies filter when provided", () => {
    const nodes = [
      makeNode({ id: "n1", name: "prod-web", nativeId: "i-1", provider: "aws" }),
      makeNode({ id: "n2", name: "dev-db", nativeId: "i-2", provider: "gcp" }),
    ];

    const blocks = generateImportBlocks(nodes, [], { provider: "aws" });
    const ids = blocks.map((b) => b.id);
    expect(ids).toContain("i-1");
    expect(ids).not.toContain("i-2");
  });
});

describe("renderImportBlocksHCL", () => {
  it("renders empty block list", () => {
    const hcl = renderImportBlocksHCL([]);
    expect(hcl).toContain("# Terraform Import Blocks");
    expect(hcl).toContain("# Resources: 0");
    expect(hcl).not.toContain("import {");
  });

  it("renders single import block", () => {
    const blocks: ImportBlock[] = [
      { to: "aws_instance.web", id: "i-abc123" },
    ];

    const hcl = renderImportBlocksHCL(blocks);
    expect(hcl).toContain("import {");
    expect(hcl).toContain("  to = aws_instance.web");
    expect(hcl).toContain('  id = "i-abc123"');
    expect(hcl).toContain("}");
    expect(hcl).toContain("# Resources: 1");
  });

  it("includes provider when specified", () => {
    const blocks: ImportBlock[] = [
      { to: "google_compute_instance.vm", id: "vm-123", provider: "gcp" },
    ];

    const hcl = renderImportBlocksHCL(blocks);
    expect(hcl).toContain("  provider = gcp");
  });

  it("renders multiple blocks in order", () => {
    const blocks: ImportBlock[] = [
      { to: "aws_vpc.main", id: "vpc-abc" },
      { to: "aws_subnet.pub", id: "subnet-123" },
      { to: "aws_instance.web", id: "i-xyz" },
    ];

    const hcl = renderImportBlocksHCL(blocks);
    expect(hcl).toContain("# Resources: 3");

    const vpcIdx = hcl.indexOf("aws_vpc.main");
    const subnetIdx = hcl.indexOf("aws_subnet.pub");
    const instanceIdx = hcl.indexOf("aws_instance.web");
    expect(vpcIdx).toBeLessThan(subnetIdx);
    expect(subnetIdx).toBeLessThan(instanceIdx);
  });

  it("includes generated timestamp", () => {
    const hcl = renderImportBlocksHCL([]);
    expect(hcl).toMatch(/# Generated: \d{4}-\d{2}-\d{2}T/);
  });
});

describe("generateImportScript", () => {
  it("generates a bash script header", () => {
    const script = generateImportScript([], []);
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("DRY_RUN=");
    expect(script).toContain("run_import()");
  });

  it("includes resource count in header", () => {
    const nodes = [
      makeNode({ id: "n1", name: "web", nativeId: "i-abc" }),
      makeNode({ id: "n2", name: "db", nativeId: "i-def", resourceType: "database" }),
    ];

    const script = generateImportScript(nodes, []);
    expect(script).toContain("# Resources: 2");
  });

  it("includes dry-run support", () => {
    const script = generateImportScript([], []);
    expect(script).toContain("--dry-run");
  });

  it("generates run_import calls for each node", () => {
    const nodes = [
      makeNode({ id: "n1", name: "web", nativeId: "i-abc" }),
    ];

    const script = generateImportScript(nodes, []);
    expect(script).toContain("run_import");
    expect(script).toContain("Import complete:");
  });

  it("applies filter", () => {
    const nodes = [
      makeNode({ id: "n1", name: "prod", nativeId: "i-1", provider: "aws" }),
      makeNode({ id: "n2", name: "dev", nativeId: "i-2", provider: "gcp" }),
    ];

    const script = generateImportScript(nodes, [], { provider: "aws" });
    expect(script).toContain("# Resources: 1");
  });
});

describe("createImportPlan", () => {
  it("creates a plan with default mode (hcl-import)", () => {
    const nodes = [
      makeNode({ id: "n1", name: "web", nativeId: "i-abc" }),
    ];

    const plan = createImportPlan(nodes, []);
    expect(plan.mode).toBe("hcl-import");
    expect(plan.totalResources).toBe(1);
    expect(plan.imports).toHaveLength(1);
    expect(plan.imports[0]!.nativeId).toBe("i-abc");
    expect(plan.imports[0]!.order).toBe(0);
    expect(plan.generatedAt).toBeTruthy();
  });

  it("creates a cli-import plan", () => {
    const nodes = [
      makeNode({ id: "n1", name: "web", nativeId: "i-abc" }),
    ];

    const plan = createImportPlan(nodes, [], { mode: "cli-import" });
    expect(plan.mode).toBe("cli-import");
  });

  it("includes dependency information", () => {
    const nodes = [
      makeNode({ id: "vpc", name: "main-vpc", nativeId: "vpc-abc", resourceType: "vpc" }),
      makeNode({ id: "subnet", name: "pub-subnet", nativeId: "subnet-123", resourceType: "subnet" }),
    ];
    const edges: Edge[] = [
      { sourceId: "subnet", targetId: "vpc", relationshipType: "depends-on" },
    ];

    const plan = createImportPlan(nodes, edges);
    const subnetEntry = plan.imports.find((e) => e.nativeId === "subnet-123");
    expect(subnetEntry?.dependsOn.length).toBeGreaterThanOrEqual(0);
  });

  it("applies filter to plan", () => {
    const nodes = [
      makeNode({ id: "n1", name: "a", nativeId: "i-1", provider: "aws" }),
      makeNode({ id: "n2", name: "b", nativeId: "i-2", provider: "gcp" }),
    ];

    const plan = createImportPlan(nodes, [], { filter: { provider: "aws" } });
    expect(plan.totalResources).toBe(1);
    expect(plan.filter).toEqual({ provider: "aws" });
  });

  it("orders entries sequentially", () => {
    const nodes = [
      makeNode({ id: "n1", name: "a", nativeId: "i-1" }),
      makeNode({ id: "n2", name: "b", nativeId: "i-2" }),
      makeNode({ id: "n3", name: "c", nativeId: "i-3" }),
    ];

    const plan = createImportPlan(nodes, []);
    const orders = plan.imports.map((e) => e.order);
    expect(orders).toEqual([0, 1, 2]);
  });
});

describe("renderImportPlan", () => {
  const makePlan = (mode: "hcl-import" | "cli-import", entries: ImportPlanEntry[]): ImportPlan => ({
    mode,
    imports: entries,
    totalResources: entries.length,
    generatedAt: "2024-01-01T00:00:00.000Z",
  });

  const entry = (i: number): ImportPlanEntry => ({
    address: `aws_instance.server_${i}`,
    nativeId: `i-${i}`,
    resourceType: "compute",
    provider: "aws",
    order: i,
    dependsOn: [],
  });

  it("renders HCL import blocks in hcl-import mode", () => {
    const plan = makePlan("hcl-import", [entry(0), entry(1)]);
    const output = renderImportPlan(plan);
    expect(output).toContain("import {");
    expect(output).toContain("  to = aws_instance.server_0");
    expect(output).toContain('  id = "i-0"');
  });

  it("renders terraform import commands in cli-import mode", () => {
    const plan = makePlan("cli-import", [entry(0)]);
    const output = renderImportPlan(plan);
    expect(output).toContain("#!/usr/bin/env bash");
    expect(output).toContain("terraform import");
    expect(output).toContain("aws_instance.server_0");
  });

  it("includes dependency comments in cli mode", () => {
    const entryWithDeps: ImportPlanEntry = {
      address: "aws_subnet.pub",
      nativeId: "subnet-123",
      resourceType: "subnet",
      provider: "aws",
      order: 1,
      dependsOn: ["aws_vpc.main"],
    };

    const plan = makePlan("cli-import", [entry(0), entryWithDeps]);
    const output = renderImportPlan(plan);
    expect(output).toContain("# Depends on: aws_vpc.main");
  });

  it("includes step numbers in cli mode", () => {
    const plan = makePlan("cli-import", [entry(0), entry(1)]);
    const output = renderImportPlan(plan);
    expect(output).toContain("# Step 1:");
    expect(output).toContain("# Step 2:");
  });

  it("omits provider for AWS in hcl mode", () => {
    const plan = makePlan("hcl-import", [entry(0)]);
    const output = renderImportPlan(plan);
    expect(output).not.toContain("  provider =");
  });

  it("includes provider for non-AWS in hcl mode", () => {
    const gcpEntry: ImportPlanEntry = {
      address: "google_compute_instance.vm",
      nativeId: "vm-123",
      resourceType: "compute",
      provider: "gcp",
      order: 0,
      dependsOn: [],
    };

    const plan = makePlan("hcl-import", [gcpEntry]);
    const output = renderImportPlan(plan);
    expect(output).toContain("  provider = gcp");
  });
});

describe("initImportResult", () => {
  it("initializes all entries as pending", () => {
    const plan: ImportPlan = {
      mode: "hcl-import",
      imports: [
        { address: "aws_instance.a", nativeId: "i-1", resourceType: "compute", provider: "aws", order: 0, dependsOn: [] },
        { address: "aws_instance.b", nativeId: "i-2", resourceType: "compute", provider: "aws", order: 1, dependsOn: [] },
      ],
      totalResources: 2,
      generatedAt: "2024-01-01T00:00:00.000Z",
    };

    const result = initImportResult(plan);
    expect(result.statuses).toHaveLength(2);
    expect(result.statuses.every((s) => s.status === "pending")).toBe(true);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.skippedCount).toBe(0);
  });

  it("preserves plan reference", () => {
    const plan: ImportPlan = {
      mode: "cli-import",
      imports: [],
      totalResources: 0,
      generatedAt: "2024-01-01T00:00:00.000Z",
    };

    const result = initImportResult(plan);
    expect(result.plan).toBe(plan);
  });
});

describe("updateImportStatus", () => {
  let plan: ImportPlan;

  beforeEach(() => {
    plan = {
      mode: "hcl-import",
      imports: [
        { address: "aws_instance.web", nativeId: "i-1", resourceType: "compute", provider: "aws", order: 0, dependsOn: [] },
        { address: "aws_s3_bucket.data", nativeId: "bucket-x", resourceType: "storage", provider: "aws", order: 1, dependsOn: [] },
        { address: "aws_db_instance.db", nativeId: "db-42", resourceType: "database", provider: "aws", order: 2, dependsOn: [] },
      ],
      totalResources: 3,
      generatedAt: "2024-01-01T00:00:00.000Z",
    };
  });

  it("marks an entry as imported", () => {
    const result = initImportResult(plan);
    updateImportStatus(result, "aws_instance.web", "imported");

    expect(result.statuses[0]!.status).toBe("imported");
    expect(result.statuses[0]!.importedAt).toBeTruthy();
    expect(result.successCount).toBe(1);
  });

  it("marks an entry as failed with error", () => {
    const result = initImportResult(plan);
    updateImportStatus(result, "aws_s3_bucket.data", "failed", "bucket not found");

    expect(result.statuses[1]!.status).toBe("failed");
    expect(result.statuses[1]!.error).toBe("bucket not found");
    expect(result.failureCount).toBe(1);
  });

  it("marks an entry as skipped", () => {
    const result = initImportResult(plan);
    updateImportStatus(result, "aws_db_instance.db", "skipped");

    expect(result.skippedCount).toBe(1);
  });

  it("recalculates counts after multiple updates", () => {
    const result = initImportResult(plan);
    updateImportStatus(result, "aws_instance.web", "imported");
    updateImportStatus(result, "aws_s3_bucket.data", "failed", "error");
    updateImportStatus(result, "aws_db_instance.db", "skipped");

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it("ignores unknown address", () => {
    const result = initImportResult(plan);
    updateImportStatus(result, "nonexistent.resource", "imported");

    expect(result.successCount).toBe(0);
    expect(result.statuses.every((s) => s.status === "pending")).toBe(true);
  });

  it("allows status transitions", () => {
    const result = initImportResult(plan);
    updateImportStatus(result, "aws_instance.web", "importing");
    expect(result.statuses[0]!.status).toBe("importing");

    updateImportStatus(result, "aws_instance.web", "imported");
    expect(result.statuses[0]!.status).toBe("imported");
    expect(result.successCount).toBe(1);
  });
});

describe("importSummary", () => {
  it("shows all-pending summary", () => {
    const plan: ImportPlan = {
      mode: "hcl-import",
      imports: [
        { address: "aws_instance.web", nativeId: "i-1", resourceType: "compute", provider: "aws", order: 0, dependsOn: [] },
        { address: "aws_instance.api", nativeId: "i-2", resourceType: "compute", provider: "aws", order: 1, dependsOn: [] },
      ],
      totalResources: 2,
      generatedAt: "2024-01-01T00:00:00.000Z",
    };

    const result = initImportResult(plan);
    const summary = importSummary(result);
    expect(summary).toContain("Import Progress: 0/2");
    expect(summary).toContain("Pending:  2");
  });

  it("shows completed summary", () => {
    const plan: ImportPlan = {
      mode: "hcl-import",
      imports: [
        { address: "aws_instance.web", nativeId: "i-1", resourceType: "compute", provider: "aws", order: 0, dependsOn: [] },
      ],
      totalResources: 1,
      generatedAt: "2024-01-01T00:00:00.000Z",
    };

    const result = initImportResult(plan);
    updateImportStatus(result, "aws_instance.web", "imported");

    const summary = importSummary(result);
    expect(summary).toContain("Import Progress: 1/1");
    expect(summary).toContain("Imported: 1");
    expect(summary).toContain("Pending:  0");
  });

  it("shows failure details", () => {
    const plan: ImportPlan = {
      mode: "hcl-import",
      imports: [
        { address: "aws_instance.web", nativeId: "i-1", resourceType: "compute", provider: "aws", order: 0, dependsOn: [] },
        { address: "aws_s3_bucket.data", nativeId: "b-1", resourceType: "storage", provider: "aws", order: 1, dependsOn: [] },
      ],
      totalResources: 2,
      generatedAt: "2024-01-01T00:00:00.000Z",
    };

    const result = initImportResult(plan);
    updateImportStatus(result, "aws_instance.web", "imported");
    updateImportStatus(result, "aws_s3_bucket.data", "failed", "Access denied");

    const summary = importSummary(result);
    expect(summary).toContain("Failures:");
    expect(summary).toContain("aws_s3_bucket.data: Access denied");
  });

  it("shows mixed status summary", () => {
    const plan: ImportPlan = {
      mode: "hcl-import",
      imports: [
        { address: "a", nativeId: "1", resourceType: "compute", provider: "aws", order: 0, dependsOn: [] },
        { address: "b", nativeId: "2", resourceType: "compute", provider: "aws", order: 1, dependsOn: [] },
        { address: "c", nativeId: "3", resourceType: "compute", provider: "aws", order: 2, dependsOn: [] },
        { address: "d", nativeId: "4", resourceType: "compute", provider: "aws", order: 3, dependsOn: [] },
      ],
      totalResources: 4,
      generatedAt: "2024-01-01T00:00:00.000Z",
    };

    const result = initImportResult(plan);
    updateImportStatus(result, "a", "imported");
    updateImportStatus(result, "b", "failed", "Error");
    updateImportStatus(result, "c", "skipped");

    const summary = importSummary(result);
    expect(summary).toContain("Import Progress: 3/4");
    expect(summary).toContain("Imported: 1");
    expect(summary).toContain("Failed:   1");
    expect(summary).toContain("Skipped:  1");
    expect(summary).toContain("Pending:  1");
  });
});
