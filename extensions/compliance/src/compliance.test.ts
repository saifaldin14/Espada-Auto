/**
 * Compliance Mapping — Tests
 * Target: 30+ tests covering evaluation, reporting, waivers, controls, filtering.
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { ControlEvalNode, ComplianceViolation, ComplianceReport } from "./types.js";
import { FRAMEWORKS, getFramework } from "./controls.js";
import { evaluate, evaluateControl } from "./evaluator.js";
import { generateReport, exportMarkdown, compareReports, filterViolations, scoreToGrade } from "./reporter.js";
import { InMemoryWaiverStore, createWaiver } from "./waivers.js";

// ---------------------------------------------------------------------------
// Test nodes
// ---------------------------------------------------------------------------
const encryptedDb: ControlEvalNode = {
  id: "db-1",
  name: "prod-db",
  provider: "aws",
  resourceType: "database",
  region: "us-east-1",
  tags: { env: "prod", owner: "team-a", data_classification: "sensitive", "data-classification": "sensitive", environment: "production" },
  metadata: {
    encrypted: true,
    logging_enabled: true,
    backup_enabled: true,
    ssl_enabled: true,
    access_control: true,
    monitoring_enabled: true,
    retention_days: 30,
    change_tracking: true,
    incident_response_plan: true,
  },
};

const unprotectedStorage: ControlEvalNode = {
  id: "s3-1",
  name: "public-bucket",
  provider: "aws",
  resourceType: "storage",
  region: "us-east-1",
  tags: {},
  metadata: {
    public_access: true,
    encrypted: false,
  },
};

const basicCompute: ControlEvalNode = {
  id: "ec2-1",
  name: "web-server",
  provider: "aws",
  resourceType: "compute",
  region: "us-east-1",
  tags: { env: "dev" },
  metadata: {
    instance_type: "t3.micro",
  },
};

const stoppedResource: ControlEvalNode = {
  id: "ec2-2",
  name: "old-server",
  provider: "aws",
  resourceType: "compute",
  region: "us-east-1",
  tags: {},
  metadata: {},
  status: "stopped",
};

const identityNode: ControlEvalNode = {
  id: "iam-1",
  name: "admin-user",
  provider: "aws",
  resourceType: "identity",
  region: "global",
  tags: {},
  metadata: { mfa_enabled: false },
};

// ---------------------------------------------------------------------------
// Framework Registry
// ---------------------------------------------------------------------------
describe("FRAMEWORKS", () => {
  it("has 6 frameworks", () => {
    expect(FRAMEWORKS).toHaveLength(6);
  });

  it("each framework has controls", () => {
    for (const fw of FRAMEWORKS) {
      expect(fw.controls.length).toBeGreaterThan(0);
    }
  });

  it("getFramework returns by ID", () => {
    expect(getFramework("soc2")?.name).toBe("SOC 2 Type II");
    expect(getFramework("hipaa")?.name).toBe("HIPAA");
  });

  it("getFramework returns undefined for unknown ID", () => {
    expect(getFramework("unknown" as never)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Control Evaluation
// ---------------------------------------------------------------------------
describe("evaluateControl", () => {
  it("passes encryption check for encrypted node", () => {
    const control = getFramework("soc2")!.controls.find((c) => c.title === "Encryption at rest")!;
    const violations = evaluateControl(control, [encryptedDb]);
    expect(violations).toHaveLength(0);
  });

  it("fails encryption check for unencrypted node", () => {
    const control = getFramework("soc2")!.controls.find((c) => c.title === "Encryption at rest")!;
    const violations = evaluateControl(control, [unprotectedStorage]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("high");
  });

  it("detects public access violation", () => {
    const control = getFramework("soc2")!.controls.find((c) => c.title === "No public access")!;
    const violations = evaluateControl(control, [unprotectedStorage]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("critical");
  });

  it("skips non-applicable resource types", () => {
    const control = getFramework("soc2")!.controls.find((c) => c.title === "MFA / strong auth")!;
    // compute is not in applicableResourceTypes for MFA
    const violations = evaluateControl(control, [basicCompute]);
    expect(violations).toHaveLength(0);
  });

  it("detects MFA violation on identity", () => {
    const control = getFramework("soc2")!.controls.find((c) => c.title === "MFA / strong auth")!;
    const violations = evaluateControl(control, [identityNode]);
    expect(violations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Full Evaluation
// ---------------------------------------------------------------------------
describe("evaluate", () => {
  it("returns 100% for fully compliant node", () => {
    const result = evaluate("soc2", [encryptedDb]);
    expect(result.score).toBe(100);
    expect(result.failedControls).toBe(0);
  });

  it("returns score < 100 for non-compliant node", () => {
    const result = evaluate("soc2", [unprotectedStorage]);
    expect(result.score).toBeLessThan(100);
    expect(result.failedControls).toBeGreaterThan(0);
  });

  it("handles mixed nodes", () => {
    const result = evaluate("soc2", [encryptedDb, unprotectedStorage]);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("throws for unknown framework", () => {
    expect(() => evaluate("fake" as never, [])).toThrow("Unknown framework");
  });

  it("returns 100 for empty node list", () => {
    const result = evaluate("soc2", []);
    expect(result.score).toBe(100);
    expect(result.notApplicable).toBe(result.totalControls);
  });

  it("populates byCategory", () => {
    const result = evaluate("soc2", [encryptedDb, unprotectedStorage]);
    expect(Object.keys(result.byCategory).length).toBeGreaterThan(0);
  });

  it("works for CIS framework", () => {
    const result = evaluate("cis", [basicCompute, stoppedResource]);
    expect(result.framework).toBe("cis");
    expect(result.totalControls).toBeGreaterThan(0);
  });

  it("works for HIPAA framework", () => {
    const result = evaluate("hipaa", [encryptedDb]);
    expect(result.framework).toBe("hipaa");
  });

  it("works for PCI-DSS framework", () => {
    const result = evaluate("pci-dss", [encryptedDb]);
    expect(result.framework).toBe("pci-dss");
  });

  it("works for GDPR framework", () => {
    const result = evaluate("gdpr", [encryptedDb]);
    expect(result.framework).toBe("gdpr");
  });

  it("works for NIST 800-53 framework", () => {
    const result = evaluate("nist-800-53", [encryptedDb]);
    expect(result.framework).toBe("nist-800-53");
  });
});

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------
describe("InMemoryWaiverStore", () => {
  let store: InMemoryWaiverStore;

  beforeEach(() => {
    store = new InMemoryWaiverStore();
  });

  it("adds and retrieves waiver", () => {
    const w = createWaiver({ controlId: "soc2-CC6.1", resourceId: "s3-1", reason: "exception", approvedBy: "admin" });
    store.add(w);
    expect(store.get(w.id)).toEqual(w);
  });

  it("lists all waivers", () => {
    store.add(createWaiver({ controlId: "c1", resourceId: "r1", reason: "test", approvedBy: "a" }));
    store.add(createWaiver({ controlId: "c2", resourceId: "r2", reason: "test", approvedBy: "a" }));
    expect(store.list()).toHaveLength(2);
  });

  it("removes waiver", () => {
    const w = createWaiver({ controlId: "c1", resourceId: "r1", reason: "test", approvedBy: "a" });
    store.add(w);
    expect(store.remove(w.id)).toBe(true);
    expect(store.get(w.id)).toBeUndefined();
  });

  it("returns false for removing nonexistent waiver", () => {
    expect(store.remove("nope")).toBe(false);
  });

  it("isWaived returns true for active waiver", () => {
    const w = createWaiver({ controlId: "c1", resourceId: "r1", reason: "test", approvedBy: "a", expiresInDays: 30 });
    store.add(w);
    expect(store.isWaived("c1", "r1")).toBe(true);
  });

  it("isWaived returns false for expired waiver", () => {
    const w = createWaiver({ controlId: "c1", resourceId: "r1", reason: "test", approvedBy: "a" });
    w.expiresAt = "2000-01-01T00:00:00.000Z"; // expired
    store.add(w);
    expect(store.isWaived("c1", "r1")).toBe(false);
  });

  it("replaces waiver for same control+resource", () => {
    const w1 = createWaiver({ controlId: "c1", resourceId: "r1", reason: "first", approvedBy: "a" });
    const w2 = createWaiver({ controlId: "c1", resourceId: "r1", reason: "second", approvedBy: "b" });
    store.add(w1);
    store.add(w2);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].reason).toBe("second");
  });
});

describe("evaluate with waivers", () => {
  it("marks violations as waived", () => {
    const store = new InMemoryWaiverStore();
    // Waive the encryption-at-rest control for unprotected storage
    const encControl = getFramework("soc2")!.controls.find((c) => c.title === "Encryption at rest")!;
    store.add(createWaiver({ controlId: encControl.id, resourceId: "s3-1", reason: "exception", approvedBy: "admin" }));

    const result = evaluate("soc2", [unprotectedStorage], store);
    const encViolation = result.violations.find((v) => v.controlId === encControl.id);
    expect(encViolation?.status).toBe("waived");
  });
});

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------
describe("generateReport", () => {
  it("creates report with all fields", () => {
    const result = evaluate("soc2", [encryptedDb, unprotectedStorage]);
    const report = generateReport(result, "prod environment");
    expect(report.framework).toBe("soc2");
    expect(report.scope).toBe("prod environment");
    expect(report.score).toBeDefined();
    expect(report.violations).toBeDefined();
    expect(report.byCategory).toBeDefined();
  });
});

describe("exportMarkdown", () => {
  it("generates markdown with headers", () => {
    const result = evaluate("soc2", [encryptedDb, unprotectedStorage]);
    const report = generateReport(result);
    const md = exportMarkdown(report);
    expect(md).toContain("# Compliance Report");
    expect(md).toContain("SOC 2 Type II");
    expect(md).toContain("## Summary");
  });

  it("includes violations section when violations exist", () => {
    const result = evaluate("soc2", [unprotectedStorage]);
    const report = generateReport(result);
    const md = exportMarkdown(report);
    expect(md).toContain("## Violations");
    expect(md).toContain("Remediation");
  });
});

describe("scoreToGrade", () => {
  it("A for 90+", () => expect(scoreToGrade(95)).toBe("A"));
  it("B for 80-89", () => expect(scoreToGrade(85)).toBe("B"));
  it("C for 70-79", () => expect(scoreToGrade(75)).toBe("C"));
  it("D for 60-69", () => expect(scoreToGrade(65)).toBe("D"));
  it("F for <60", () => expect(scoreToGrade(50)).toBe("F"));
});

describe("compareReports", () => {
  it("generates trend from reports", () => {
    const r1: ComplianceReport = {
      framework: "soc2",
      frameworkVersion: "2017",
      generatedAt: "2024-01-01",
      scope: "all",
      score: 80,
      totalControls: 6,
      passedControls: 4,
      failedControls: 2,
      waivedControls: 0,
      notApplicable: 0,
      violations: [{ status: "open" } as ComplianceViolation, { status: "open" } as ComplianceViolation],
      byCategory: {},
      bySeverity: { critical: 0, high: 1, medium: 1, low: 0, info: 0 },
    };
    const r2 = { ...r1, generatedAt: "2024-02-01", score: 90, violations: [{ status: "open" } as ComplianceViolation] };

    const trend = compareReports([r1, r2]);
    expect(trend).toHaveLength(2);
    expect(trend[0].score).toBe(80);
    expect(trend[1].score).toBe(90);
    expect(trend[0].violations).toBe(2);
    expect(trend[1].violations).toBe(1);
  });
});

describe("filterViolations", () => {
  const violations: ComplianceViolation[] = [
    { controlId: "c1", status: "open", severity: "critical", resourceType: "database" } as ComplianceViolation,
    { controlId: "c2", status: "waived", severity: "high", resourceType: "storage" } as ComplianceViolation,
    { controlId: "c3", status: "open", severity: "low", resourceType: "compute" } as ComplianceViolation,
  ];

  it("filters by status", () => {
    expect(filterViolations(violations, { status: "open" })).toHaveLength(2);
  });

  it("filters by severity", () => {
    expect(filterViolations(violations, { severity: "critical" })).toHaveLength(1);
  });

  it("filters by resourceType", () => {
    expect(filterViolations(violations, { resourceType: "storage" })).toHaveLength(1);
  });

  it("returns all without filter", () => {
    expect(filterViolations(violations)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// CIS-specific controls
// ---------------------------------------------------------------------------
describe("CIS controls", () => {
  it("detects stopped/unused resources", () => {
    const result = evaluate("cis", [stoppedResource]);
    const unusedViolation = result.violations.find((v) => v.controlTitle.includes("Unused resources"));
    expect(unusedViolation).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GDPR-specific controls
// ---------------------------------------------------------------------------
describe("GDPR controls", () => {
  it("passes data classification when tag present", () => {
    const result = evaluate("gdpr", [encryptedDb]);
    const dcViolation = result.violations.find((v) => v.controlTitle.includes("Data classification"));
    expect(dcViolation).toBeUndefined();
  });

  it("fails data classification when tag missing", () => {
    const node: ControlEvalNode = {
      id: "db-x",
      name: "untagged-db",
      provider: "aws",
      resourceType: "database",
      region: "us-east-1",
      tags: {},
      metadata: { encrypted: true },
    };
    const result = evaluate("gdpr", [node]);
    const dcViolation = result.violations.find((v) => v.controlTitle.includes("Data classification"));
    expect(dcViolation).toBeDefined();
  });
});
