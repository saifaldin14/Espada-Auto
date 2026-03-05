/**
 * Cross-Cloud Migration Engine — Compatibility Matrix Tests
 */
import { describe, it, expect } from "vitest";

import {
  checkCompatibility,
  checkAllCompatibility,
  getFullCompatibilityMatrix,
  getCompatibilitySummary,
} from "../src/core/compatibility-matrix.js";

import type { MigrationProvider, MigrationResourceType } from "../src/types.js";

describe("compatibility-matrix", () => {
  const PROVIDERS: MigrationProvider[] = ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"];
  const RESOURCE_TYPES: MigrationResourceType[] = [
    "vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer",
  ];

  describe("checkCompatibility", () => {
    it("returns a CompatibilityResult for aws → azure VM", () => {
      const r = checkCompatibility("aws", "azure", "vm");
      expect(r).toHaveProperty("compatible");
      expect(r).toHaveProperty("sourceProvider", "aws");
      expect(r).toHaveProperty("targetProvider", "azure");
      expect(r).toHaveProperty("resourceType", "vm");
      expect(typeof r.compatible).toBe("boolean");
    });

    it("returns a result for every valid provider pair and resource type", () => {
      for (const src of PROVIDERS) {
        for (const tgt of PROVIDERS) {
          if (src === tgt) continue;
          for (const rt of RESOURCE_TYPES) {
            const r = checkCompatibility(src, tgt, rt);
            expect(r.sourceProvider).toBe(src);
            expect(r.targetProvider).toBe(tgt);
            expect(r.resourceType).toBe(rt);
          }
        }
      }
    });

    it("includes warnings for partial compatibility", () => {
      // Security rules between providers typically have warnings
      const r = checkCompatibility("aws", "gcp", "security-rules");
      expect(r).toHaveProperty("warnings");
      expect(Array.isArray(r.warnings)).toBe(true);
    });

    it("marks same-provider as not-compatible", () => {
      const r = checkCompatibility("aws", "aws", "vm");
      expect(r.compatible).toBe(false);
    });
  });

  describe("checkAllCompatibility", () => {
    it("returns results for all resource types for a direction", () => {
      const results = checkAllCompatibility("aws", "azure");
      expect(results.length).toBe(RESOURCE_TYPES.length);
      for (const rt of RESOURCE_TYPES) {
        expect(results.some((r) => r.resourceType === rt)).toBe(true);
      }
    });

    it("each result has the correct direction", () => {
      const results = checkAllCompatibility("gcp", "aws");
      for (const r of results) {
        expect(r.sourceProvider).toBe("gcp");
        expect(r.targetProvider).toBe("aws");
      }
    });
  });

  describe("getFullCompatibilityMatrix", () => {
    it("returns entries for all provider pairs (excluding same-provider)", () => {
      const matrix = getFullCompatibilityMatrix();
      expect(matrix.length).toBeGreaterThan(0);
      // At minimum, should cover major cloud pairs × resource types
      const awsToAzure = matrix.filter(
        (r) => r.sourceProvider === "aws" && r.targetProvider === "azure",
      );
      expect(awsToAzure.length).toBe(RESOURCE_TYPES.length);
    });

    it("does not include same-provider entries", () => {
      const matrix = getFullCompatibilityMatrix();
      const sameProvider = matrix.filter((r) => r.sourceProvider === r.targetProvider);
      expect(sameProvider.length).toBe(0);
    });
  });

  describe("getCompatibilitySummary", () => {
    it("returns a summary with allCompatible, totalWarnings, totalBlockers", () => {
      const summary = getCompatibilitySummary("aws", "azure");
      expect(summary).toHaveProperty("direction");
      expect(summary).toHaveProperty("allCompatible");
      expect(summary).toHaveProperty("totalWarnings");
      expect(summary).toHaveProperty("totalBlockers");
      expect(typeof summary.allCompatible).toBe("boolean");
      expect(typeof summary.totalWarnings).toBe("number");
      expect(typeof summary.totalBlockers).toBe("number");
      expect(summary.results.length).toBe(RESOURCE_TYPES.length);
    });

    it("aws → azure has mostly compatible entries", () => {
      const summary = getCompatibilitySummary("aws", "azure");
      const compatible = summary.results.filter((r) => r.compatible).length;
      const incompatible = summary.results.filter((r) => !r.compatible).length;
      expect(compatible).toBeGreaterThanOrEqual(incompatible);
    });
  });
});
