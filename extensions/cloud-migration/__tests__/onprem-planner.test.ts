/**
 * Cross-Cloud Migration Engine — On-Prem Migration Planner Tests
 *
 * Verifies that the migration planner correctly generates verify-agent and
 * setup-staging preflight steps for on-prem providers, and wires dependencies.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  assessMigration,
  generatePlan,
} from "../src/core/migration-planner.js";

import { resetPluginState } from "../src/state.js";
import type { NormalizedVM, NormalizedBucket, NormalizedSecurityRule, NormalizedDNSRecord } from "../src/types.js";

// Helpers
function sampleVM(overrides?: Partial<NormalizedVM>): NormalizedVM {
  return {
    id: "vm-001",
    name: "web-server",
    provider: "vmware",
    region: "dc1",
    cpuCores: 4,
    memoryGB: 16,
    osType: "linux",
    architecture: "x86_64",
    disks: [{ id: "d-1", name: "root", sizeGB: 50, type: "ssd", encrypted: false, isBootDisk: true }],
    networkInterfaces: [{ id: "n-1", privateIp: "10.0.1.5", securityGroupIds: [] }],
    tags: { env: "prod" },
    ...overrides,
  } as NormalizedVM;
}

function sampleBucket(overrides?: Partial<NormalizedBucket>): NormalizedBucket {
  return {
    id: "staging-bucket",
    name: "staging-bucket",
    provider: "on-premises",
    region: "dc1",
    versioning: false,
    encryption: { enabled: false, type: "none" },
    objectCount: 500,
    totalSizeBytes: 1024 ** 3 * 2,
    lifecycleRules: [],
    tags: {},
    ...overrides,
  } as NormalizedBucket;
}

function sampleDNSRecord(): NormalizedDNSRecord {
  return {
    name: "app.internal.example.com",
    type: "A",
    ttl: 300,
    values: ["10.0.1.5"],
  };
}

describe("migration-planner — on-prem paths", () => {
  beforeEach(() => {
    resetPluginState();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Assessment
  // ═══════════════════════════════════════════════════════════════════════════

  describe("assessMigration with on-prem providers", () => {
    it("assesses VMware → AWS migration", () => {
      const result = assessMigration({
        sourceProvider: "vmware",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      expect(result.feasible).toBe(true);
      expect(result.sourceProvider).toBe("vmware");
      expect(result.targetProvider).toBe("aws");
      expect(result.riskAssessment).toBeDefined();
    });

    it("assesses Nutanix → Azure migration", () => {
      const result = assessMigration({
        sourceProvider: "nutanix",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm", "object-storage"],
        vms: [sampleVM({ provider: "nutanix" })],
        buckets: [sampleBucket({ provider: "nutanix" })],
      });

      expect(result.feasible).toBe(true);
      expect(result.resourceSummary.vms).toBe(1);
      expect(result.resourceSummary.buckets).toBe(1);
    });

    it("identifies on-prem risk factor", () => {
      const result = assessMigration({
        sourceProvider: "on-premises",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "on-premises" })],
      });

      const onPremRisk = result.riskAssessment.factors.find((f) => f.category === "on-prem");
      expect(onPremRisk).toBeDefined();
      expect(onPremRisk!.severity).toBe("high");
    });

    it("identifies on-prem risk when target is on-prem", () => {
      const result = assessMigration({
        sourceProvider: "aws",
        targetProvider: "vmware",
        targetRegion: "dc1",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "aws" })],
      });

      const onPremRisk = result.riskAssessment.factors.find((f) => f.category === "on-prem");
      expect(onPremRisk).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Plan Generation — Preflight Steps
  // ═══════════════════════════════════════════════════════════════════════════

  describe("generatePlan — on-prem preflight steps", () => {
    it("prepends verify-agent step when source is VMware", () => {
      const assessment = assessMigration({
        sourceProvider: "vmware",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      const plan = generatePlan({
        jobId: "job-vmware-1",
        name: "VMware to AWS",
        description: "Test",
        sourceProvider: "vmware",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
        assessment,
      });

      const stepTypes = plan.steps.map((s) => s.type);
      expect(stepTypes).toContain("verify-agent");
    });

    it("prepends setup-staging step when source is VMware", () => {
      const assessment = assessMigration({
        sourceProvider: "vmware",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      const plan = generatePlan({
        jobId: "job-vmware-2",
        name: "VMware to AWS",
        description: "Test",
        sourceProvider: "vmware",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
        assessment,
      });

      const stepTypes = plan.steps.map((s) => s.type);
      expect(stepTypes).toContain("setup-staging");
    });

    it("prepends verify-agent for Nutanix source", () => {
      const assessment = assessMigration({
        sourceProvider: "nutanix",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "nutanix" })],
      });

      const plan = generatePlan({
        jobId: "job-ntx-1",
        name: "Nutanix to Azure",
        description: "Test",
        sourceProvider: "nutanix",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "nutanix" })],
        assessment,
      });

      const verifySteps = plan.steps.filter((s) => s.type === "verify-agent");
      expect(verifySteps.length).toBeGreaterThanOrEqual(1);
    });

    it("prepends verify-agent for on-premises source", () => {
      const assessment = assessMigration({
        sourceProvider: "on-premises",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "on-premises" })],
      });

      const plan = generatePlan({
        jobId: "job-op-1",
        name: "OnPrem to GCP",
        description: "Test",
        sourceProvider: "on-premises",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "on-premises" })],
        assessment,
      });

      const verifySteps = plan.steps.filter((s) => s.type === "verify-agent");
      expect(verifySteps.length).toBeGreaterThanOrEqual(1);
    });

    it("adds both source and target preflight when both are on-prem", () => {
      const assessment = assessMigration({
        sourceProvider: "vmware",
        targetProvider: "nutanix",
        targetRegion: "us-east-dc2",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      const plan = generatePlan({
        jobId: "job-op-2",
        name: "VMware to Nutanix",
        description: "Test",
        sourceProvider: "vmware",
        targetProvider: "nutanix",
        targetRegion: "us-east-dc2",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
        assessment,
      });

      const verifySteps = plan.steps.filter((s) => s.type === "verify-agent");
      const stagingSteps = plan.steps.filter((s) => s.type === "setup-staging");
      // Should have both source and target verify steps
      expect(verifySteps.length).toBe(2);
      expect(stagingSteps.length).toBe(2);
    });

    it("does NOT add preflight steps for cloud-to-cloud", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "aws" })],
      });

      const plan = generatePlan({
        jobId: "job-cloud-1",
        name: "AWS to Azure",
        description: "Test",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [sampleVM({ provider: "aws" })],
        assessment,
      });

      const stepTypes = plan.steps.map((s) => s.type);
      expect(stepTypes).not.toContain("verify-agent");
      expect(stepTypes).not.toContain("setup-staging");
    });

    it("compute steps depend on preflight steps", () => {
      const assessment = assessMigration({
        sourceProvider: "vmware",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
      });

      const plan = generatePlan({
        jobId: "job-dep-1",
        name: "Deps Test",
        description: "Test",
        sourceProvider: "vmware",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["vm"],
        vms: [sampleVM()],
        assessment,
      });

      const preflightIds = plan.steps
        .filter((s) => s.type === "verify-agent" || s.type === "setup-staging")
        .map((s) => s.id);

      // The first compute step should depend on at least one preflight step
      const snapshotStep = plan.steps.find((s) => s.type === "snapshot-source");
      expect(snapshotStep).toBeDefined();
      const hasPreflightDep = snapshotStep!.dependsOn.some((d) => preflightIds.includes(d));
      expect(hasPreflightDep).toBe(true);
    });

    it("data steps depend on preflight steps for on-prem source", () => {
      const assessment = assessMigration({
        sourceProvider: "on-premises",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["object-storage"],
        buckets: [sampleBucket()],
      });

      const plan = generatePlan({
        jobId: "job-data-dep",
        name: "Data Deps Test",
        description: "Test",
        sourceProvider: "on-premises",
        targetProvider: "aws",
        targetRegion: "us-east-1",
        resourceTypes: ["object-storage"],
        buckets: [sampleBucket()],
        assessment,
      });

      const preflightIds = plan.steps
        .filter((s) => s.type === "verify-agent" || s.type === "setup-staging")
        .map((s) => s.id);

      const inventoryStep = plan.steps.find((s) => s.type === "inventory-source");
      expect(inventoryStep).toBeDefined();
      const hasPreflightDep = inventoryStep!.dependsOn.some((d) => preflightIds.includes(d));
      expect(hasPreflightDep).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Plan Generation — DNS Steps
  // ═══════════════════════════════════════════════════════════════════════════

  describe("generatePlan — DNS steps", () => {
    it("generates DNS migration steps", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["dns"],
        dnsRecords: [sampleDNSRecord()],
      });

      const plan = generatePlan({
        jobId: "job-dns-1",
        name: "DNS Migration",
        description: "Test",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["dns"],
        dnsRecords: [sampleDNSRecord()],
        assessment,
      });

      const stepTypes = plan.steps.map((s) => s.type);
      expect(stepTypes).toContain("migrate-dns");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DAG Integrity for On-Prem Plans
  // ═══════════════════════════════════════════════════════════════════════════

  describe("DAG integrity for on-prem plans", () => {
    it("all dependsOn references point to valid step IDs", () => {
      const assessment = assessMigration({
        sourceProvider: "vmware",
        targetProvider: "nutanix",
        targetRegion: "dc2",
        resourceTypes: ["vm", "object-storage"],
        vms: [sampleVM()],
        buckets: [sampleBucket()],
      });

      const plan = generatePlan({
        jobId: "job-dag-1",
        name: "DAG Test",
        description: "Test",
        sourceProvider: "vmware",
        targetProvider: "nutanix",
        targetRegion: "dc2",
        resourceTypes: ["vm", "object-storage"],
        vms: [sampleVM()],
        buckets: [sampleBucket()],
        assessment,
      });

      const ids = new Set(plan.steps.map((s) => s.id));
      for (const step of plan.steps) {
        for (const dep of step.dependsOn) {
          expect(ids.has(dep), `Step "${step.id}" depends on "${dep}" which doesn't exist`).toBe(true);
        }
      }
    });
  });
});
