/**
 * Tests for the compliance framework module (P2.17).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "../storage/index.js";
import type { GraphNodeInput, GraphEdgeInput, GraphStorage } from "../types.js";
import {
  evaluateFramework,
  runComplianceAssessment,
  formatComplianceMarkdown,
  COMPLIANCE_CONTROLS,
  SUPPORTED_FRAMEWORKS,
  getFrameworkControls,
} from "./compliance.js";

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

describe("Compliance Framework (P2.17)", () => {
  let storage: GraphStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
  });

  describe("COMPLIANCE_CONTROLS", () => {
    it("exports controls for all supported frameworks", () => {
      for (const fw of SUPPORTED_FRAMEWORKS) {
        const controls = getFrameworkControls(fw);
        expect(controls.length).toBeGreaterThan(0);
      }
    });

    it("has unique control IDs per framework", () => {
      for (const fw of SUPPORTED_FRAMEWORKS) {
        const controls = getFrameworkControls(fw);
        const ids = controls.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it("has total controls across all frameworks", () => {
      expect(COMPLIANCE_CONTROLS.length).toBeGreaterThanOrEqual(15);
    });
  });

  describe("evaluateFramework", () => {
    it("evaluates all controls even for empty graph", async () => {
      const result = await evaluateFramework("soc2", storage);
      expect(result.framework).toBe("soc2");
      // Controls exist even with no resources — they just all pass
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("evaluates encryption controls for database resources", async () => {
      await storage.upsertNode(
        makeNode("db1", {
          resourceType: "database",
          name: "my-db",
          metadata: { storageEncrypted: true },
          tags: { Environment: "production" },
        }),
      );

      const result = await evaluateFramework("soc2", storage);
      expect(result.framework).toBe("soc2");
      // Should have results for the database resource
      const dbResults = result.results.filter((r) => r.nodeId === "db1");
      expect(dbResults.length).toBeGreaterThan(0);
    });

    it("detects compliance failures for unencrypted databases", async () => {
      await storage.upsertNode(
        makeNode("bad-db", {
          resourceType: "database",
          name: "unencrypted-db",
          metadata: { storageEncrypted: false },
          tags: {},
        }),
      );

      const result = await evaluateFramework("soc2", storage);
      const failures = result.results.filter(
        (r) => r.status === "fail" && r.nodeId === "bad-db",
      );
      expect(failures.length).toBeGreaterThan(0);
      // Verify failure reason is descriptive
      for (const f of failures) {
        expect(f.reason).toBeTruthy();
        expect(f.severity).toBeTruthy();
      }
    });

    it("calculates score correctly with mixed results", async () => {
      // Encrypted DB should pass encryption controls
      await storage.upsertNode(
        makeNode("good-db", {
          resourceType: "database",
          metadata: { storageEncrypted: true },
          tags: { Environment: "production", Owner: "team-a" },
        }),
      );
      // Unencrypted DB should fail
      await storage.upsertNode(
        makeNode("bad-db", {
          resourceType: "database",
          metadata: { storageEncrypted: false },
          tags: {},
        }),
      );

      const result = await evaluateFramework("soc2", storage);
      // Score should be between 0 and 100
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      // Should not be 100% (one DB is unencrypted and untagged)
      expect(result.score).toBeLessThan(100);
    });

    it("evaluates HIPAA controls", async () => {
      await storage.upsertNode(
        makeNode("db-hipaa", {
          resourceType: "database",
          name: "patient-db",
          metadata: { storageEncrypted: true, loggingEnabled: true },
          tags: { Environment: "production", Owner: "healthcare-team" },
        }),
      );

      const result = await evaluateFramework("hipaa", storage);
      expect(result.framework).toBe("hipaa");
    });

    it("fails network isolation for publicly exposed resources", async () => {
      await storage.upsertNode(
        makeNode("public-server", {
          resourceType: "compute",
          name: "exposed-server",
          metadata: { publicIp: "54.1.2.3", publiclyAccessible: true },
          tags: { Environment: "production", Owner: "team-a" },
        }),
      );

      const result = await evaluateFramework("soc2", storage);
      const networkFails = result.results.filter(
        (r) => r.status === "fail" && r.nodeId === "public-server",
      );
      // Should have at least one network isolation failure
      expect(networkFails.length).toBeGreaterThan(0);
    });

    it("applies node filter", async () => {
      await storage.upsertNode(
        makeNode("aws-db", { resourceType: "database", provider: "aws" }),
      );
      await storage.upsertNode(
        makeNode("gcp-db", { resourceType: "database", provider: "gcp" }),
      );

      const result = await evaluateFramework("soc2", storage, { provider: "aws" });
      // Should only process AWS resources
      for (const r of result.results) {
        expect(r.nodeId).not.toContain("gcp");
      }
    });
  });

  describe("runComplianceAssessment", () => {
    it("runs multiple frameworks at once", async () => {
      await storage.upsertNode(
        makeNode("server1", { resourceType: "compute", name: "web-server" }),
      );

      const report = await runComplianceAssessment(
        ["soc2", "hipaa"],
        storage,
      );

      expect(report.frameworks.length).toBe(2);
      expect(report.generatedAt).toBeTruthy();
    });

    it("generates critical resources list", async () => {
      await storage.upsertNode(
        makeNode("unencrypted-db", {
          resourceType: "database",
          name: "bad-db",
          metadata: { storageEncrypted: false },
        }),
      );

      const report = await runComplianceAssessment(
        ["soc2"],
        storage,
      );
      expect(report.totalResources).toBeGreaterThanOrEqual(1);
    });
  });

  describe("formatComplianceMarkdown", () => {
    it("formats a report as markdown", async () => {
      await storage.upsertNode(
        makeNode("node1", { resourceType: "compute" }),
      );

      const report = await runComplianceAssessment(
        ["soc2"],
        storage,
      );
      const md = formatComplianceMarkdown(report);

      expect(md).toContain("Compliance Assessment Report");
      expect(md).toContain("SOC2");
    });
  });

  describe("getFrameworkControls", () => {
    it("returns controls for soc2", () => {
      const controls = getFrameworkControls("soc2");
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every((c) => c.framework === "soc2")).toBe(true);
    });

    it("returns empty for unknown framework", () => {
      const controls = getFrameworkControls("unknown" as never);
      expect(controls.length).toBe(0);
    });
  });
});
