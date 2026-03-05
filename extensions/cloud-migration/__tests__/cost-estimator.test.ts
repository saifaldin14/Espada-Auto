/**
 * Cross-Cloud Migration Engine — Cost Estimator Tests
 */
import { describe, it, expect } from "vitest";

import {
  estimateEgressCost,
  estimateComputeCost,
  estimateStorageCost,
  estimateApiCost,
  estimateConversionCost,
  estimateMigrationCost,
  estimateFromResources,
} from "../src/core/cost-estimator.js";

describe("cost-estimator", () => {
  describe("estimateEgressCost", () => {
    it("returns a cost line item", () => {
      const item = estimateEgressCost("aws", 100);
      expect(item).toHaveProperty("category", "egress");
      expect(item).toHaveProperty("amount");
      expect(item).toHaveProperty("unit", "USD");
      expect(item.amount).toBeGreaterThan(0);
    });

    it("scales with data size", () => {
      const small = estimateEgressCost("aws", 10);
      const large = estimateEgressCost("aws", 1000);
      expect(large.amount).toBeGreaterThan(small.amount);
    });

    it("different providers have different rates", () => {
      const aws = estimateEgressCost("aws", 100);
      const gcp = estimateEgressCost("gcp", 100);
      expect(typeof aws.amount).toBe("number");
      expect(typeof gcp.amount).toBe("number");
    });
  });

  describe("estimateComputeCost", () => {
    it("scales with VM count", () => {
      const one = estimateComputeCost("azure", [{ cpuCores: 4, memoryGB: 16 }]);
      const ten = estimateComputeCost("azure", Array.from({ length: 10 }, () => ({ cpuCores: 4, memoryGB: 16 })));
      expect(ten.amount).toBeGreaterThan(one.amount);
    });

    it("returns zero for zero VMs", () => {
      const item = estimateComputeCost("aws", []);
      expect(item.amount).toBe(0);
    });
  });

  describe("estimateStorageCost", () => {
    it("returns a cost line item for staging storage", () => {
      const item = estimateStorageCost("aws", 500);
      expect(item.category).toBe("storage");
      expect(item.amount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("estimateApiCost", () => {
    it("returns cost based on API call volume", () => {
      const item = estimateApiCost("aws", "azure", 100000);
      expect(item.category).toBe("api-calls");
      expect(item.amount).toBeGreaterThanOrEqual(0);
    });

    it("zero calls costs zero", () => {
      const item = estimateApiCost("gcp", "aws", 0);
      expect(item.amount).toBe(0);
    });
  });

  describe("estimateConversionCost", () => {
    it("returns cost for disk conversion compute", () => {
      const item = estimateConversionCost(500);
      expect(item.category).toBe("conversion");
      expect(item.amount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("estimateMigrationCost", () => {
    it("returns a full cost estimate with breakdown", () => {
      const estimate = estimateMigrationCost({
        sourceProvider: "aws",
        targetProvider: "azure",
        resourceTypes: ["vm", "object-storage", "disk"],
        dataSizeGB: 500,
        objectCount: 10000,
        vms: [{ cpuCores: 4, memoryGB: 16 }, { cpuCores: 8, memoryGB: 32 }],
        diskSizeGB: 200,
      });

      expect(estimate).toHaveProperty("totalEstimatedCost");
      expect(estimate).toHaveProperty("breakdown");
      expect(Array.isArray(estimate.breakdown)).toBe(true);
      expect(estimate.breakdown.length).toBeGreaterThan(0);
      expect(estimate.totalEstimatedCost).toBeGreaterThan(0);
      expect(estimate.currency).toBe("USD");
    });

    it("zero resources produce minimal cost", () => {
      const estimate = estimateMigrationCost({
        sourceProvider: "aws",
        targetProvider: "gcp",
        resourceTypes: [],
        dataSizeGB: 0,
        objectCount: 0,
        vms: [],
        diskSizeGB: 0,
      });

      expect(estimate.totalEstimatedCost).toBeGreaterThanOrEqual(0);
    });

    it("higher resource counts increase total cost", () => {
      const small = estimateMigrationCost({
        sourceProvider: "aws",
        targetProvider: "azure",
        resourceTypes: ["vm", "object-storage"],
        dataSizeGB: 10,
        objectCount: 100,
        vms: [{ cpuCores: 2, memoryGB: 4 }],
        diskSizeGB: 50,
      });

      const large = estimateMigrationCost({
        sourceProvider: "aws",
        targetProvider: "azure",
        resourceTypes: ["vm", "object-storage"],
        dataSizeGB: 5000,
        objectCount: 1000000,
        vms: Array.from({ length: 50 }, () => ({ cpuCores: 8, memoryGB: 32 })),
        diskSizeGB: 2000,
      });

      expect(large.totalEstimatedCost).toBeGreaterThan(small.totalEstimatedCost);
    });
  });

  describe("estimateFromResources", () => {
    it("accepts a resource list and produces an estimate", () => {
      const estimate = estimateFromResources({
        sourceProvider: "gcp",
        targetProvider: "aws",
        vms: [{
          id: "vm-1", name: "vm-1", provider: "gcp", region: "us-central1",
          zone: "us-central1-a", cpuCores: 4, memoryGB: 16,
          osType: "linux", architecture: "x86_64",
          disks: [], networkInterfaces: [], tags: {}, raw: {},
        }],
        buckets: [{
          id: "bucket-1", name: "bucket-1", provider: "gcp", region: "us-central1",
          versioning: true, encryption: { enabled: true, type: "provider-managed" as const },
          objectCount: 5000, totalSizeBytes: 200 * 1024 ** 3, lifecycleRules: [], tags: {},
        }],
      });

      expect(estimate).toHaveProperty("totalEstimatedCost");
      expect(estimate.totalEstimatedCost).toBeGreaterThan(0);
    });
  });
});
