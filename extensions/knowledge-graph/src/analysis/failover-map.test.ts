/**
 * Tests for the failover mapping module.
 *
 * Tests the format function directly and validates type structures.
 * buildRegionProfiles and generateFailoverMap require full GraphStorage mocks.
 */

import { describe, it, expect } from "vitest";
import {
  formatFailoverMapMarkdown,
} from "./failover-map.js";
import type {
  FailoverMap,
  FailoverPair,
  RegionProfile,
  SingleRegionDependency,
  FailoverMapSummary,
  FailoverIssue,
} from "./failover-map.js";

// =============================================================================
// Helpers
// =============================================================================

function makeRegion(region: string, provider: string, count: number, cost: number): RegionProfile {
  return {
    region,
    provider: provider as RegionProfile["provider"],
    resourceCount: count,
    byResourceType: { compute: Math.ceil(count / 2), database: Math.floor(count / 2) },
    totalCostMonthly: cost,
    isFullStack: count >= 3,
    nodeIds: Array.from({ length: count }, (_, i) => `${region}-node-${i}`),
  };
}

function makeFailoverMap(overrides: Partial<FailoverMap> = {}): FailoverMap {
  const primary = makeRegion("us-east-1", "aws", 5, 500);
  const secondary = makeRegion("us-west-2", "aws", 4, 400);

  const pair: FailoverPair = {
    primary,
    secondary,
    crossRegionEdges: [],
    replicationTypes: ["replicates-to"],
    readinessScore: 0.75,
    estimatedRtoMinutes: 15,
    estimatedRpoMinutes: 5,
    issues: [
      {
        severity: "medium",
        category: "capacity",
        description: "Secondary region has fewer resources than primary",
        affectedResources: ["us-west-2-node-4"],
      },
    ],
  };

  const srd: SingleRegionDependency = {
    nodeId: "eu-west-1-node-0",
    nodeName: "eu-cache",
    resourceType: "cache" as SingleRegionDependency["resourceType"],
    region: "eu-west-1",
    provider: "aws" as SingleRegionDependency["provider"],
    costMonthly: 50,
    reason: "No failover pair for eu-west-1",
  };

  return {
    generatedAt: new Date().toISOString(),
    regions: [primary, secondary, makeRegion("eu-west-1", "aws", 1, 50)],
    failoverPairs: [pair],
    singleRegionDependencies: [srd],
    overallReadiness: 0.75,
    summary: {
      totalRegions: 3,
      totalFailoverPairs: 1,
      coveredResources: 9,
      uncoveredResources: 1,
      totalCostAtRisk: 50,
      averageReadiness: 0.75,
      worstRtoMinutes: 15,
      worstRpoMinutes: 5,
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Failover Map", () => {
  describe("formatFailoverMapMarkdown", () => {
    it("renders full failover map as markdown", () => {
      const map = makeFailoverMap();
      const md = formatFailoverMapMarkdown(map);

      expect(md).toContain("Failover");
      expect(md).toContain("us-east-1");
      expect(md).toContain("us-west-2");
      expect(md).toContain("75");
    });

    it("includes single-region dependencies", () => {
      const map = makeFailoverMap();
      const md = formatFailoverMapMarkdown(map);
      expect(md).toContain("eu-west-1");
    });

    it("handles no failover pairs", () => {
      const map = makeFailoverMap({
        failoverPairs: [],
        overallReadiness: 0,
        summary: {
          totalRegions: 1,
          totalFailoverPairs: 0,
          coveredResources: 0,
          uncoveredResources: 5,
          totalCostAtRisk: 500,
          averageReadiness: 0,
          worstRtoMinutes: 0,
          worstRpoMinutes: 0,
        },
      });
      const md = formatFailoverMapMarkdown(map);
      expect(md).toContain("Failover");
    });

    it("includes issues in output", () => {
      const map = makeFailoverMap();
      const md = formatFailoverMapMarkdown(map);
      // Verify issues count appears in the failover pairs table
      expect(md).toContain("1 |");
    });
  });

  describe("type constructions", () => {
    it("constructs a valid RegionProfile", () => {
      const rp = makeRegion("ap-southeast-1", "aws", 3, 300);
      expect(rp.isFullStack).toBe(true);
      expect(rp.nodeIds).toHaveLength(3);
    });

    it("constructs a valid FailoverIssue", () => {
      const issue: FailoverIssue = {
        severity: "critical",
        category: "replication",
        description: "No cross-region replication configured",
        affectedResources: ["db-primary"],
      };
      expect(issue.severity).toBe("critical");
      expect(issue.category).toBe("replication");
    });
  });
});
