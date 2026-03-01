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

  // ===========================================================================
  // CIS Benchmark Controls
  // ===========================================================================

  describe("CIS framework controls", () => {
    it("registers CIS as a supported framework", () => {
      expect(SUPPORTED_FRAMEWORKS).toContain("cis");
    });

    it("has 10 CIS controls", () => {
      const cisControls = getFrameworkControls("cis");
      expect(cisControls.length).toBe(10);
      expect(cisControls.every(c => c.framework === "cis")).toBe(true);
    });

    it("has unique CIS control IDs", () => {
      const cisControls = getFrameworkControls("cis");
      const ids = cisControls.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("evaluates CIS on empty graph", async () => {
      const result = await evaluateFramework("cis", storage);
      expect(result.framework).toBe("cis");
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("detects root account usage (CIS-1.1)", async () => {
      // CIS-1.1 applies to iam-role/identity; fails when name contains 'root'
      await storage.upsertNode(
        makeNode("root-role", {
          resourceType: "iam-role",
          name: "root-admin",
          metadata: { mfaEnabled: false },
        }),
      );

      const result = await evaluateFramework("cis", storage);
      const rootFail = result.results.find(
        r => r.controlId === "CIS-1.1" && r.status === "fail",
      );
      expect(rootFail).toBeDefined();
    });

    it("passes CIS-1.1 when IAM role has MFA", async () => {
      // Non-root name + MFA enabled => pass via hasStrongAuth
      await storage.upsertNode(
        makeNode("admin-role", {
          resourceType: "iam-role",
          name: "admin-role",
          metadata: { mfaEnabled: true },
        }),
      );

      const result = await evaluateFramework("cis", storage);
      const mfaPass = result.results.find(
        r => r.controlId === "CIS-1.1" && r.nodeId === "admin-role",
      );
      expect(mfaPass?.status).toBe("pass");
    });

    it("detects unencrypted storage (CIS-2.1)", async () => {
      await storage.upsertNode(
        makeNode("s3-bad", {
          resourceType: "storage",
          metadata: { encrypted: false },
        }),
      );

      const result = await evaluateFramework("cis", storage);
      const encFail = result.results.find(
        r => r.controlId === "CIS-2.1" && r.status === "fail",
      );
      expect(encFail).toBeDefined();
    });

    it("detects missing logging (CIS-3.1)", async () => {
      // CIS-3.1 applies to compute/database/storage/function/api-gateway/cluster/container
      await storage.upsertNode(
        makeNode("server-no-logging", {
          resourceType: "compute",
          metadata: { loggingEnabled: false },
        }),
      );

      const result = await evaluateFramework("cis", storage);
      const logFail = result.results.find(
        r => r.controlId === "CIS-3.1" && r.status === "fail",
      );
      expect(logFail).toBeDefined();
    });

    it("detects default security group with permissive rules (CIS-5.4)", async () => {
      // CIS-5.4: default SG should block all traffic; fails when ingressRules exist
      await storage.upsertNode(
        makeNode("default-sg", {
          resourceType: "security-group",
          name: "default",
          metadata: {
            ingressRules: [{ cidr: "0.0.0.0/0", port: 22 }],
          },
        }),
      );

      const result = await evaluateFramework("cis", storage);
      const sgFail = result.results.find(
        r => r.controlId === "CIS-5.4" && r.status === "fail",
      );
      expect(sgFail).toBeDefined();
    });

    it("runs CIS via runComplianceAssessment", async () => {
      const report = await runComplianceAssessment(["cis"], storage);
      expect(report.frameworks.length).toBe(1);
      expect(report.frameworks[0].framework).toBe("cis");
      expect(typeof report.frameworks[0].score).toBe("number");
    });
  });

  // ===========================================================================
  // NIST 800-53 Controls
  // ===========================================================================

  describe("NIST 800-53 framework controls", () => {
    it("registers nist-800-53 as a supported framework", () => {
      expect(SUPPORTED_FRAMEWORKS).toContain("nist-800-53");
    });

    it("has 10 NIST 800-53 controls", () => {
      const nistControls = getFrameworkControls("nist-800-53");
      expect(nistControls.length).toBe(10);
      expect(nistControls.every(c => c.framework === "nist-800-53")).toBe(true);
    });

    it("has unique NIST control IDs", () => {
      const nistControls = getFrameworkControls("nist-800-53");
      const ids = nistControls.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("evaluates NIST on empty graph", async () => {
      const result = await evaluateFramework("nist-800-53", storage);
      expect(result.framework).toBe("nist-800-53");
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("detects missing authentication (IA-2)", async () => {
      // IA-2 applies to compute/database/function/container/api-gateway
      // It checks hasAccessControl: secured-by edge, authenticated-by edge, iamRole, or securityGroups
      await storage.upsertNode(
        makeNode("server-no-auth", {
          resourceType: "compute",
          metadata: { /* no iamRole, no securityGroups */ },
        }),
      );

      const result = await evaluateFramework("nist-800-53", storage);
      const authFail = result.results.find(
        r => r.controlId === "IA-2" && r.status === "fail",
      );
      expect(authFail).toBeDefined();
    });

    it("detects overly permissive policies (AC-6)", async () => {
      await storage.upsertNode(
        makeNode("role-1", {
          resourceType: "iam-role",
          metadata: { policyDocument: '{"Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}' },
        }),
      );

      const result = await evaluateFramework("nist-800-53", storage);
      const acFail = result.results.find(
        r => r.controlId === "AC-6" && r.status === "fail",
      );
      expect(acFail).toBeDefined();
    });

    it("detects missing encryption at rest (SC-28)", async () => {
      await storage.upsertNode(
        makeNode("db-nist", {
          resourceType: "database",
          metadata: { storageEncrypted: false },
        }),
      );

      const result = await evaluateFramework("nist-800-53", storage);
      const fail = result.results.find(
        r => r.controlId === "SC-28" && r.status === "fail",
      );
      expect(fail).toBeDefined();
    });

    it("detects open network access (SC-7)", async () => {
      // SC-7 applies to compute/database/container/cluster
      // isNetworkIsolated fails when publiclyAccessible is true and no secured-by/runs-in edges
      await storage.upsertNode(
        makeNode("server-nist", {
          resourceType: "compute",
          metadata: {
            publiclyAccessible: true,
          },
        }),
      );

      const result = await evaluateFramework("nist-800-53", storage);
      const fail = result.results.find(
        r => r.controlId === "SC-7" && r.status === "fail",
      );
      expect(fail).toBeDefined();
    });

    it("runs NIST via runComplianceAssessment", async () => {
      const report = await runComplianceAssessment(["nist-800-53"], storage);
      expect(report.frameworks.length).toBe(1);
      expect(report.frameworks[0].framework).toBe("nist-800-53");
      expect(typeof report.frameworks[0].score).toBe("number");
    });
  });

  // ===========================================================================
  // Multi-framework assessment (including CIS + NIST)
  // ===========================================================================

  describe("multi-framework assessment with CIS and NIST", () => {
    it("evaluates CIS and NIST together", async () => {
      await storage.upsertNode(
        makeNode("db-multi", {
          resourceType: "database",
          metadata: { storageEncrypted: false },
        }),
      );

      const report = await runComplianceAssessment(["cis", "nist-800-53"], storage);
      expect(report.frameworks.length).toBe(2);
      const fws = report.frameworks.map(f => f.framework);
      expect(fws).toContain("cis");
      expect(fws).toContain("nist-800-53");
    });
  });
});
