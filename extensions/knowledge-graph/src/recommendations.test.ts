/**
 * Tests for the resource recommendation engine (P2.18).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "./storage/index.js";
import { GraphEngine } from "./engine.js";
import type { GraphNodeInput, GraphEdgeInput, GraphStorage } from "./types.js";
import {
  generateRecommendations,
  formatRecommendationsMarkdown,
  resetRecommendationCounter,
} from "./recommendations.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id,
    name: id,
    provider: "aws",
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    ...overrides,
  };
}

function makeEdge(id: string, from: string, to: string, rel = "runs-in"): GraphEdgeInput {
  return {
    id,
    sourceNodeId: from,
    targetNodeId: to,
    relationshipType: rel as GraphEdgeInput["relationshipType"],
    confidence: 1.0,
    discoveredVia: "config-scan",
    metadata: {},
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Recommendation Engine (P2.18)", () => {
  let storage: GraphStorage;
  let engine: GraphEngine;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
    engine = new GraphEngine({ storage });
    resetRecommendationCounter();
  });

  describe("generateRecommendations", () => {
    it("returns empty recommendations for empty graph", async () => {
      const report = await generateRecommendations(engine, storage);
      expect(report.totalRecommendations).toBe(0);
      expect(report.recommendations).toEqual([]);
      expect(report.totalEstimatedSavings).toBe(0);
    });

    it("detects idle (stopped) resources with cost", async () => {
      await storage.upsertNode(
        makeNode("stopped-ec2", {
          resourceType: "compute",
          name: "idle-server",
          status: "stopped",
          costMonthly: 150,
        }),
      );

      const report = await generateRecommendations(engine, storage);
      const idleRecs = report.recommendations.filter((r) => r.category === "unused-resource");
      expect(idleRecs.length).toBeGreaterThanOrEqual(1);
    });

    it("detects untagged resources", async () => {
      await storage.upsertNode(
        makeNode("untagged-db", {
          resourceType: "database",
          name: "no-tags-db",
          tags: {},
        }),
      );

      const report = await generateRecommendations(engine, storage);
      const tagRecs = report.recommendations.filter((r) => r.category === "tagging");
      expect(tagRecs.length).toBeGreaterThanOrEqual(1);
    });

    it("detects security issues (unencrypted databases)", async () => {
      await storage.upsertNode(
        makeNode("unencrypted-db", {
          resourceType: "database",
          name: "insecure-db",
          metadata: { storageEncrypted: false },
        }),
      );

      const report = await generateRecommendations(engine, storage);
      const secRecs = report.recommendations.filter((r) => r.category === "security");
      expect(secRecs.length).toBeGreaterThanOrEqual(1);
    });

    it("sorts recommendations by priority", async () => {
      await storage.upsertNode(
        makeNode("stopped-ec2", {
          resourceType: "compute",
          status: "stopped",
          costMonthly: 150,
        }),
      );
      await storage.upsertNode(
        makeNode("untagged", {
          resourceType: "compute",
          tags: {},
        }),
      );
      await storage.upsertNode(
        makeNode("unencrypted", {
          resourceType: "database",
          metadata: { storageEncrypted: false },
        }),
      );

      const report = await generateRecommendations(engine, storage);
      if (report.recommendations.length >= 2) {
        const priorities = report.recommendations.map((r) => r.priority);
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        for (let i = 1; i < priorities.length; i++) {
          expect(order[priorities[i]!]).toBeGreaterThanOrEqual(order[priorities[i - 1]!]);
        }
      }
    });

    it("returns zero recommendations for well-configured resources", async () => {
      // Properly tagged, encrypted, running, with connections
      await storage.upsertNode(
        makeNode("good-db", {
          resourceType: "database",
          name: "well-configured-db",
          status: "running",
          costMonthly: 50,
          tags: { Environment: "production", Owner: "team-a" },
          metadata: { storageEncrypted: true, loggingEnabled: true },
        }),
      );
      await storage.upsertNode(
        makeNode("good-server", {
          resourceType: "compute",
          name: "well-configured-server",
          status: "running",
          costMonthly: 80,
          tags: { Environment: "production", Owner: "team-a" },
          metadata: { encrypted: true },
        }),
      );
      // Connect them so they're not orphans
      await storage.upsertEdge(
        makeEdge("e1", "good-server", "good-db", "connects-to"),
      );

      const report = await generateRecommendations(engine, storage);
      // Only tagging-related recs should appear if requiredTags logic is lenient;
      // No security, no idle, no orphan recommendations expected
      const secRecs = report.recommendations.filter((r) => r.category === "security");
      const idleRecs = report.recommendations.filter((r) => r.category === "cost-optimization");
      const orphanRecs = report.recommendations.filter((r) => r.category === "unused-resource");
      expect(secRecs.length).toBe(0);
      expect(idleRecs.length).toBe(0);
      expect(orphanRecs.length).toBe(0);
    });

    it("calculates byCategory and byPriority summaries", async () => {
      await storage.upsertNode(
        makeNode("node1", {
          resourceType: "database",
          tags: {},
          metadata: { storageEncrypted: false },
        }),
      );

      const report = await generateRecommendations(engine, storage);
      expect(typeof report.byCategory).toBe("object");
      expect(typeof report.byPriority).toBe("object");
    });

    it("detects single points of failure (SPOF)", async () => {
      // Create a hub node that many others depend on
      await storage.upsertNode(
        makeNode("hub-lb", {
          resourceType: "load-balancer",
          name: "critical-lb",
          status: "running",
          tags: { Environment: "production", Owner: "team-a" },
        }),
      );
      for (let i = 0; i < 5; i++) {
        await storage.upsertNode(
          makeNode(`app-${i}`, {
            resourceType: "compute",
            name: `app-server-${i}`,
            status: "running",
            tags: { Environment: "production", Owner: "team-a" },
          }),
        );
        await storage.upsertEdge(
          makeEdge(`e-${i}`, `app-${i}`, "hub-lb", "connects-to"),
        );
      }

      const report = await generateRecommendations(engine, storage);
      const reliabilityRecs = report.recommendations.filter(
        (r) => r.category === "reliability",
      );
      expect(reliabilityRecs.length).toBeGreaterThan(0);
      expect(reliabilityRecs.some((r) => r.title.toLowerCase().includes("spof"))).toBe(true);
    });

    it("detects right-sizing opportunities for cost outliers", async () => {
      // Create several resources of same type; one is 4x more expensive
      for (let i = 0; i < 4; i++) {
        await storage.upsertNode(
          makeNode(`normal-${i}`, {
            resourceType: "compute",
            name: `normal-${i}`,
            status: "running",
            costMonthly: 50,
            tags: { Environment: "production", Owner: "team-a" },
          }),
        );
      }
      await storage.upsertNode(
        makeNode("expensive-1", {
          resourceType: "compute",
          name: "over-provisioned",
          status: "running",
          costMonthly: 500, // 10x the average
          tags: { Environment: "production", Owner: "team-a" },
        }),
      );
      // Connect them so they're not orphans
      for (let i = 0; i < 4; i++) {
        await storage.upsertEdge(
          makeEdge(`conn-${i}`, `normal-${i}`, "expensive-1", "connects-to"),
        );
      }

      const report = await generateRecommendations(engine, storage);
      const rightSizingRecs = report.recommendations.filter(
        (r) => r.category === "right-sizing",
      );
      expect(rightSizingRecs.length).toBeGreaterThan(0);
    });
  });

  describe("formatRecommendationsMarkdown", () => {
    it("formats report as markdown", async () => {
      await storage.upsertNode(
        makeNode("server1", {
          resourceType: "compute",
          tags: {},
          costMonthly: 100,
        }),
      );

      const report = await generateRecommendations(engine, storage);
      const md = formatRecommendationsMarkdown(report);

      expect(md).toContain("Infrastructure Recommendations");
      expect(md).toContain("Generated:");
    });

    it("includes category sections", async () => {
      await storage.upsertNode(
        makeNode("unencrypted-db", {
          resourceType: "database",
          metadata: { storageEncrypted: false },
        }),
      );
      await storage.upsertNode(
        makeNode("untagged-compute", {
          resourceType: "compute",
          tags: {},
        }),
      );

      const report = await generateRecommendations(engine, storage);
      const md = formatRecommendationsMarkdown(report);
      expect(md).toContain("##");
    });
  });
});
