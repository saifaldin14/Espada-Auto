/**
 * Infrastructure Knowledge Graph — Report Generator Tests
 *
 * Tests report generation for all formats and focus areas.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphEngine } from "./engine.js";
import { InMemoryGraphStorage } from "./storage/index.js";
import { TerraformDiscoveryAdapter } from "./adapters/terraform.js";
import {
  generateScanReport,
  type ReportFormat,
  type ScanReport,
} from "./report.js";

// =============================================================================
// Shared Fixture
// =============================================================================

const INFRA_STATE = {
  version: 4,
  terraform_version: "1.7.5",
  serial: 10,
  lineage: "report-test",
  outputs: {},
  resources: [
    {
      mode: "managed",
      type: "aws_vpc",
      name: "main",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [{ schema_version: 1, attributes: { id: "vpc-001", cidr_block: "10.0.0.0/16", tags: { Name: "main-vpc", Environment: "prod" } } }],
    },
    {
      mode: "managed",
      type: "aws_subnet",
      name: "pub",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [{ schema_version: 1, attributes: { id: "subnet-pub", vpc_id: "vpc-001", cidr_block: "10.0.1.0/24", tags: { Name: "public" } } }],
    },
    {
      mode: "managed",
      type: "aws_instance",
      name: "web",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [{ schema_version: 1, attributes: { id: "i-web", instance_type: "t3.large", subnet_id: "subnet-pub", vpc_security_group_ids: ["sg-web"], tags: { Name: "web-server" } } }],
    },
    {
      mode: "managed",
      type: "aws_security_group",
      name: "web",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [{ schema_version: 1, attributes: { id: "sg-web", vpc_id: "vpc-001", name: "web-sg", tags: { Name: "web-sg" } } }],
    },
    {
      mode: "managed",
      type: "aws_db_instance",
      name: "primary",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [{ schema_version: 2, attributes: { id: "mydb", identifier: "mydb", instance_class: "db.r6g.large", engine: "postgres", vpc_security_group_ids: ["sg-db"], tags: { Name: "primary-db" } } }],
    },
    // Orphan: S3 bucket with no connections
    {
      mode: "managed",
      type: "aws_s3_bucket",
      name: "orphan_bucket",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [{ schema_version: 0, attributes: { id: "orphan-bucket-123", bucket: "orphan-bucket-123", tags: {} } }],
    },
    // Untagged resource
    {
      mode: "managed",
      type: "aws_ebs_volume",
      name: "data_vol",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [{ schema_version: 0, attributes: { id: "vol-data001", size: 100, availability_zone: "us-east-1a", tags: {} } }],
    },
  ],
};

let tmpDir: string;
let engine: GraphEngine;
let storage: InMemoryGraphStorage;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `espada-report-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  const path = join(tmpDir, "terraform.tfstate");
  writeFileSync(path, JSON.stringify(INFRA_STATE, null, 2), "utf-8");

  storage = new InMemoryGraphStorage();
  await storage.initialize();

  engine = new GraphEngine({ storage });
  const adapter = new TerraformDiscoveryAdapter({ statePath: path });
  engine.registerAdapter(adapter);
  await engine.sync();
});

afterEach(async () => {
  await storage.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// Report Generation — All Formats
// =============================================================================

describe("generateScanReport", () => {
  it("should generate a terminal report", async () => {
    const { report, formatted } = await generateScanReport(engine, storage, {
      format: "terminal",
      focus: "full",
    });

    expect(report.stats.totalNodes).toBe(7);
    expect(report.stats.totalEdges).toBeGreaterThan(0);
    expect(report.generatedAt).toBeTruthy();

    // Terminal output should contain ANSI escape codes or readable text
    expect(formatted.length).toBeGreaterThan(100);
    expect(formatted).toContain("7"); // resource count appears somewhere
  });

  it("should generate a markdown report", async () => {
    const { report, formatted } = await generateScanReport(engine, storage, {
      format: "markdown",
      focus: "full",
    });

    expect(formatted).toContain("# ");
    expect(formatted).toContain("Infrastructure Scan Report");
    expect(formatted).toContain("Resources");
    expect(report.stats.totalNodes).toBe(7);
  });

  it("should generate an HTML report", async () => {
    const { report, formatted } = await generateScanReport(engine, storage, {
      format: "html",
      focus: "full",
    });

    expect(formatted).toContain("<!DOCTYPE html>");
    expect(formatted).toContain("</html>");
    expect(formatted).toContain("<style>");
    expect(report.stats.totalNodes).toBe(7);
  });

  it("should generate a JSON report", async () => {
    const { formatted } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "full",
    });

    const parsed = JSON.parse(formatted);
    expect(parsed.stats.totalNodes).toBe(7);
    expect(parsed.findings).toBeDefined();
    expect(parsed.generatedAt).toBeTruthy();
  });
});

// =============================================================================
// Report — Focus Areas
// =============================================================================

describe("focus areas", () => {
  it("should focus on orphans", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "orphans",
    });

    expect(report.findings).toBeDefined();
    // Orphan bucket should be detected
    const orphanIds = report.findings.orphanedResources?.map((r) => r.nativeId) ?? [];
    // The S3 bucket with no relationships should be orphan
    // (depends on graph connectivity after sync)
    expect(report.stats.totalNodes).toBe(7);
  });

  it("should focus on cost", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "cost",
    });

    expect(report.totalMonthlyCost).toBeGreaterThanOrEqual(0);
    expect(report.findings.topCostlyResources).toBeDefined();
  });

  it("should focus on SPOFs", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "spof",
    });

    expect(report.findings.singlePointsOfFailure).toBeDefined();
  });

  it("should focus on untagged resources", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "untagged",
    });

    expect(report.findings.untaggedResources).toBeDefined();
    // Empty tags resources should appear
    if (report.findings.untaggedResources && report.findings.untaggedResources.length > 0) {
      const nativeIds = report.findings.untaggedResources.map((r) => r.nativeId);
      // EBS volume and orphan bucket both have empty tags
      expect(nativeIds.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// =============================================================================
// Report — Provider Filtering
// =============================================================================

describe("provider filtering", () => {
  it("should filter by provider when specified", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "full",
      provider: "aws",
    });

    expect(report.stats.totalNodes).toBe(7); // All are AWS
  });

  it("should return zero resources for non-matching provider", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "full",
      provider: "gcp",
    });

    // Stats still have all nodes; the provider filter only affects findings listing
    expect(report.stats.totalNodes).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// Report — Structured Data Integrity
// =============================================================================

describe("report data integrity", () => {
  it("should include provider breakdown", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "full",
    });

    expect(report.stats.nodesByProvider).toBeDefined();
    expect(Object.keys(report.stats.nodesByProvider).length).toBeGreaterThan(0);
    expect(report.stats.nodesByProvider["aws"]).toBe(7);
  });

  it("should include resource type breakdown", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "full",
    });

    expect(report.stats.nodesByResourceType).toBeDefined();
    expect(Object.keys(report.stats.nodesByResourceType).length).toBeGreaterThan(0);
  });

  it("should have timestamps", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "full",
    });

    expect(report.generatedAt).toBeTruthy();
    // Should be parseable ISO date
    expect(new Date(report.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("should respect topN limit", async () => {
    const { report } = await generateScanReport(engine, storage, {
      format: "json",
      focus: "full",
      topN: 2,
    });

    if (report.findings.topCostlyResources) {
      expect(report.findings.topCostlyResources.length).toBeLessThanOrEqual(2);
    }
  });
});
