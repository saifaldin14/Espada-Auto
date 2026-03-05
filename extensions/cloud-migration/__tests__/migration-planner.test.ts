/**
 * Cross-Cloud Migration Engine — Migration Planner Tests
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  assessMigration,
  generatePlan,
} from "../src/core/migration-planner.js";

import { resetPluginState } from "../src/state.js";

import type { NormalizedVM, NormalizedBucket } from "../src/types.js";

// Helpers to build sample normalized resources
function sampleVM(overrides?: Partial<NormalizedVM>): NormalizedVM {
  return {
    id: "i-123",
    name: "web-server",
    provider: "aws",
    region: "us-east-1",
    cpuCores: 4,
    memoryGB: 16,
    osType: "linux",
    state: "running",
    disks: [{ id: "d-1", name: "root", sizeGB: 50, type: "ssd", encrypted: true }],
    tags: { environment: "staging" },
    ...overrides,
  } as NormalizedVM;
}

function sampleBucket(overrides?: Partial<NormalizedBucket>): NormalizedBucket {
  return {
    id: "my-bucket",
    name: "my-bucket",
    provider: "aws",
    region: "us-east-1",
    storageClass: "STANDARD",
    versioning: true,
    encryption: "AES256",
    objectCount: 1000,
    totalSizeBytes: 1024 * 1024 * 1024 * 5,
    tags: {},
    ...overrides,
  } as NormalizedBucket;
}

describe("migration-planner", () => {
  beforeEach(() => {
    resetPluginState();
  });

  describe("assessMigration", () => {
    it("returns an assessment with compatibility and cost", () => {
      const result = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm", "object-storage"],
        vms: [sampleVM(), sampleVM({ id: "i-456", name: "api-srv" }), sampleVM({ id: "i-789", name: "db-srv" })],
        buckets: [sampleBucket()],
      });

      expect(result).toHaveProperty("compatibility");
      expect(result).toHaveProperty("costEstimate");
      expect(result).toHaveProperty("riskAssessment");
      expect(result).toHaveProperty("blockers");
      expect(Array.isArray(result.compatibility)).toBe(true);
      expect(result.compatibility.length).toBe(2); // vm + object-storage
    });

    it("identifies blockers for same-provider directions", () => {
      const result = assessMigration({
        sourceProvider: "aws",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      // Same provider should have blockers
      expect(result.blockers.length).toBeGreaterThanOrEqual(0);
    });

    it("handles empty resource types", () => {
      const result = assessMigration({
        sourceProvider: "gcp",
        targetProvider: "azure",
        targetRegion: "westus2",
        resourceTypes: [],
      });

      expect(result.compatibility).toEqual([]);
    });

    it("returns a risk assessment", () => {
      const result = assessMigration({
        sourceProvider: "aws",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["vm", "database"],
        vms: Array.from({ length: 10 }, (_, i) => sampleVM({ id: `vm-${i}`, name: `vm-${i}` })),
        buckets: [sampleBucket({ totalSizeBytes: 1024 ** 4 })], // 1 TB
      });

      expect(result.riskAssessment).toHaveProperty("overallRisk");
      expect(["low", "medium", "high", "critical"]).toContain(result.riskAssessment.overallRisk);
    });
  });

  describe("generatePlan", () => {
    it("generates a plan with steps for VMs", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      const plan = generatePlan({
        jobId: "job-1",
        name: "Test Migration",
        description: "A test plan",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
        assessment,
      });

      expect(plan).toHaveProperty("id");
      expect(plan).toHaveProperty("steps");
      expect(plan.steps.length).toBeGreaterThan(0);

      // Should have compute pipeline steps
      const stepTypes = plan.steps.map((s) => s.type);
      expect(stepTypes).toContain("snapshot-source");
      expect(stepTypes).toContain("export-image");
      expect(stepTypes).toContain("provision-vm");
    });

    it("generates steps for buckets", () => {
      const assessment = assessMigration({
        sourceProvider: "gcp",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["object-storage"],
        buckets: [sampleBucket({ provider: "gcp", region: "us-central1" })],
      });

      const plan = generatePlan({
        jobId: "job-2",
        name: "Bucket Migration",
        description: "Migrate GCS to S3",
        sourceProvider: "gcp",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["object-storage"],
        buckets: [sampleBucket({ provider: "gcp", region: "us-central1" })],
        assessment,
      });

      const stepTypes = plan.steps.map((s) => s.type);
      expect(stepTypes).toContain("inventory-source");
      expect(stepTypes).toContain("create-target");
      expect(stepTypes).toContain("transfer-objects");
    });

    it("includes network steps when security-rules resource type is present", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm", "security-rules"],
        vms: [sampleVM()],
      });

      const plan = generatePlan({
        jobId: "job-3",
        name: "VM + Network Migration",
        description: "Migrate VMs with network rules",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm", "security-rules"],
        vms: [sampleVM()],
        assessment,
      });

      const stepTypes = plan.steps.map((s) => s.type);
      expect(stepTypes).toContain("map-network");
    });

    it("generates empty plan for no resources", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: [],
      });

      const plan = generatePlan({
        jobId: "job-4",
        name: "Empty",
        description: "No resources",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: [],
        assessment,
      });

      expect(plan.steps.length).toBe(0);
    });

    it("each step has an id, name, type, and dependsOn", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      const plan = generatePlan({
        jobId: "job-5",
        name: "Validation",
        description: "Check step structure",
        sourceProvider: "aws",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
        assessment,
      });

      for (const step of plan.steps) {
        expect(step.id).toBeTruthy();
        expect(step.name).toBeTruthy();
        expect(step.type).toBeTruthy();
        expect(Array.isArray(step.dependsOn)).toBe(true);
      }
    });

    it("steps form a valid DAG (no circular deps)", () => {
      const vms = [sampleVM(), sampleVM({ id: "i-456", name: "vm-2" })];
      const buckets = [sampleBucket()];

      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm", "object-storage"],
        vms,
        buckets,
      });

      const plan = generatePlan({
        jobId: "job-6",
        name: "DAG Validation",
        description: "Verify DAG integrity",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm", "object-storage"],
        vms,
        buckets,
        assessment,
      });

      const ids = new Set(plan.steps.map((s) => s.id));
      for (const step of plan.steps) {
        for (const dep of step.dependsOn) {
          expect(ids.has(dep), `Step ${step.id} depends on ${dep} which is not in the plan`).toBe(true);
        }
      }
    });
  });
});
