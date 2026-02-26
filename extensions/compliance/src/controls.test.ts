/**
 * Compliance Controls — Detailed Framework Tests
 *
 * Tests individual control evaluation logic across HIPAA, PCI-DSS, NIST, GDPR
 * frameworks, severity scoring, and cross-framework resource scanning.
 */

import { describe, expect, it } from "vitest";
import type { ControlEvalNode } from "./types.js";
import { FRAMEWORKS, getFramework } from "./controls.js";
import { evaluate, evaluateControl, evaluateFramework } from "./evaluator.js";

// ---------------------------------------------------------------------------
// Test nodes — each designed for specific framework control paths
// ---------------------------------------------------------------------------
const hipaaDatabase: ControlEvalNode = {
  id: "db-hipaa-1",
  name: "patient-records-db",
  provider: "aws",
  resourceType: "database",
  region: "us-east-1",
  tags: { env: "prod", data_classification: "phi" },
  metadata: {
    encrypted: true,
    ssl_enabled: true,
    logging_enabled: true,
    access_control: true,
    backup_enabled: true,
  },
};

const noTlsDatabase: ControlEvalNode = {
  id: "db-notls",
  name: "legacy-db",
  provider: "aws",
  resourceType: "database",
  region: "us-east-1",
  tags: {},
  metadata: { encrypted: true, logging_enabled: false },
};

const pciNetwork: ControlEvalNode = {
  id: "vpc-pci-1",
  name: "cardholder-vpc",
  provider: "aws",
  resourceType: "vpc",
  region: "us-east-1",
  tags: {},
  metadata: { segmented: true, network_policy: "strict" },
};

const unsegmentedNetwork: ControlEvalNode = {
  id: "vpc-open",
  name: "flat-network",
  provider: "aws",
  resourceType: "vpc",
  region: "us-east-1",
  tags: {},
  metadata: {},
};

const loadBalancerWithWaf: ControlEvalNode = {
  id: "lb-waf-1",
  name: "prod-alb",
  provider: "aws",
  resourceType: "load-balancer",
  region: "us-east-1",
  tags: {},
  metadata: { waf_enabled: true, logging_enabled: true },
};

const loadBalancerNoWaf: ControlEvalNode = {
  id: "lb-nowaf",
  name: "staging-alb",
  provider: "aws",
  resourceType: "load-balancer",
  region: "us-west-2",
  tags: {},
  metadata: { logging_enabled: true },
};

const monitoredCluster: ControlEvalNode = {
  id: "k8s-1",
  name: "prod-cluster",
  provider: "aws",
  resourceType: "cluster",
  region: "us-east-1",
  tags: { owner: "platform-team", environment: "production" },
  metadata: {
    monitoring_enabled: true,
    incident_response_plan: true,
    backup_enabled: true,
    encrypted: true,
  },
};

const unmonitoredCompute: ControlEvalNode = {
  id: "ec2-unmon",
  name: "orphan-server",
  provider: "aws",
  resourceType: "compute",
  region: "eu-west-1",
  tags: {},
  metadata: {},
};

const gdprRestrictedStorage: ControlEvalNode = {
  id: "s3-gdpr-1",
  name: "eu-user-data",
  provider: "aws",
  resourceType: "storage",
  region: "eu-west-1",
  tags: { data_classification: "personal" },
  metadata: {
    encrypted: true,
    approved_regions: ["eu-west-1", "eu-central-1"],
    retention_days: 365,
  },
};

const gdprWrongRegion: ControlEvalNode = {
  id: "s3-gdpr-bad",
  name: "misplaced-data",
  provider: "aws",
  resourceType: "storage",
  region: "us-east-1",
  tags: {},
  metadata: {
    encrypted: false,
    approved_regions: ["eu-west-1", "eu-central-1"],
  },
};

// ---------------------------------------------------------------------------
// HIPAA-specific controls
// ---------------------------------------------------------------------------
describe("HIPAA controls", () => {
  const hipaa = getFramework("hipaa")!;

  it("passes encryption-in-transit when ssl_enabled", () => {
    const ctrl = hipaa.controls.find((c) => c.title === "Encryption in transit")!;
    const violations = evaluateControl(ctrl, [hipaaDatabase]);
    expect(violations).toHaveLength(0);
  });

  it("fails encryption-in-transit when ssl missing", () => {
    const ctrl = hipaa.controls.find((c) => c.title === "Encryption in transit")!;
    const violations = evaluateControl(ctrl, [noTlsDatabase]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("critical");
  });

  it("passes access controls check with access_control metadata", () => {
    const ctrl = hipaa.controls.find((c) => c.title === "Access controls")!;
    const violations = evaluateControl(ctrl, [hipaaDatabase]);
    expect(violations).toHaveLength(0);
  });

  it("fully compliant HIPAA resource scores 100", () => {
    const result = evaluate("hipaa", [hipaaDatabase]);
    expect(result.score).toBe(100);
    expect(result.failedControls).toBe(0);
  });

  it("non-compliant resource fails multiple HIPAA controls", () => {
    const result = evaluate("hipaa", [noTlsDatabase]);
    expect(result.failedControls).toBeGreaterThan(0);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PCI-DSS-specific controls
// ---------------------------------------------------------------------------
describe("PCI-DSS controls", () => {
  const pci = getFramework("pci-dss")!;

  it("passes network segmentation for segmented VPC", () => {
    const ctrl = pci.controls.find((c) => c.title === "Network segmentation")!;
    const violations = evaluateControl(ctrl, [pciNetwork]);
    expect(violations).toHaveLength(0);
  });

  it("fails network segmentation for flat network", () => {
    const ctrl = pci.controls.find((c) => c.title === "Network segmentation")!;
    const violations = evaluateControl(ctrl, [unsegmentedNetwork]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("critical");
  });

  it("passes WAF check when waf_enabled", () => {
    const ctrl = pci.controls.find((c) => c.title === "Web application firewall")!;
    const violations = evaluateControl(ctrl, [loadBalancerWithWaf]);
    expect(violations).toHaveLength(0);
  });

  it("fails WAF check when waf missing", () => {
    const ctrl = pci.controls.find((c) => c.title === "Web application firewall")!;
    const violations = evaluateControl(ctrl, [loadBalancerNoWaf]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("high");
  });

  it("scanning mixed PCI resources produces expected violations", () => {
    const result = evaluate("pci-dss", [pciNetwork, unsegmentedNetwork, loadBalancerWithWaf, loadBalancerNoWaf]);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
    expect(result.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// NIST 800-53 controls
// ---------------------------------------------------------------------------
describe("NIST 800-53 controls", () => {
  const nist = getFramework("nist-800-53")!;

  it("passes system monitoring when monitoring_enabled", () => {
    const ctrl = nist.controls.find((c) => c.title === "System monitoring")!;
    const violations = evaluateControl(ctrl, [monitoredCluster]);
    expect(violations).toHaveLength(0);
  });

  it("fails system monitoring for unmonitored compute", () => {
    const ctrl = nist.controls.find((c) => c.title === "System monitoring")!;
    const violations = evaluateControl(ctrl, [unmonitoredCompute]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("medium");
  });

  it("passes incident response plan check", () => {
    const ctrl = nist.controls.find((c) => c.title === "Incident response plan")!;
    const violations = evaluateControl(ctrl, [monitoredCluster]);
    expect(violations).toHaveLength(0);
  });

  it("fails incident response plan for untagged compute", () => {
    const ctrl = nist.controls.find((c) => c.title === "Incident response plan")!;
    const violations = evaluateControl(ctrl, [unmonitoredCompute]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("high");
  });

  it("passes required tags when owner and environment present", () => {
    const ctrl = nist.controls.find((c) => c.title === "Required tags present")!;
    const violations = evaluateControl(ctrl, [monitoredCluster]);
    expect(violations).toHaveLength(0);
  });

  it("fails required tags when tags missing", () => {
    const ctrl = nist.controls.find((c) => c.title === "Required tags present")!;
    const violations = evaluateControl(ctrl, [unmonitoredCompute]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// GDPR region and data governance controls
// ---------------------------------------------------------------------------
describe("GDPR controls — data residency and classification", () => {
  it("passes data residency when resource in approved region", () => {
    const result = evaluate("gdpr", [gdprRestrictedStorage]);
    const residencyViolation = result.violations.find((v) => v.controlTitle.includes("Data residency"));
    expect(residencyViolation).toBeUndefined();
  });

  it("fails data residency when resource in wrong region", () => {
    const result = evaluate("gdpr", [gdprWrongRegion]);
    const residencyViolation = result.violations.find((v) => v.controlTitle.includes("Data residency"));
    expect(residencyViolation).toBeDefined();
    expect(residencyViolation!.severity).toBe("critical");
  });

  it("passes retention policy when retention_days set", () => {
    const result = evaluate("gdpr", [gdprRestrictedStorage]);
    const retentionViolation = result.violations.find((v) => v.controlTitle.includes("Retention policy"));
    expect(retentionViolation).toBeUndefined();
  });

  it("fails retention policy when no retention metadata", () => {
    const result = evaluate("gdpr", [gdprWrongRegion]);
    const retentionViolation = result.violations.find((v) => v.controlTitle.includes("Retention policy"));
    expect(retentionViolation).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Severity scoring / bySeverity aggregation
// ---------------------------------------------------------------------------
describe("severity scoring", () => {
  it("bySeverity counts open violations correctly", () => {
    const result = evaluate("pci-dss", [unsegmentedNetwork, loadBalancerNoWaf]);
    expect(result.bySeverity.critical).toBeGreaterThanOrEqual(1);
    expect(result.bySeverity.high).toBeGreaterThanOrEqual(0);
    const totalSeverity = Object.values(result.bySeverity).reduce((a, b) => a + b, 0);
    expect(totalSeverity).toBeGreaterThan(0);
  });

  it("byCategory tracks pass/fail per category", () => {
    const result = evaluate("nist-800-53", [unmonitoredCompute]);
    const cats = Object.keys(result.byCategory);
    expect(cats.length).toBeGreaterThan(0);
    for (const cat of cats) {
      const entry = result.byCategory[cat];
      expect(entry.total).toBeGreaterThan(0);
      expect(entry.passed + entry.failed).toBe(entry.total);
    }
  });

  it("score reflects waived controls as passing", async () => {
    const { InMemoryWaiverStore, createWaiver } = await import("./waivers.js");
    const store = new InMemoryWaiverStore();
    const nist = getFramework("nist-800-53")!;
    // Waive all monitoring/IR controls for unmonitored compute
    for (const ctrl of nist.controls) {
      store.add(createWaiver({ controlId: ctrl.id, resourceId: "ec2-unmon", reason: "test", approvedBy: "admin" }));
    }
    const result = evaluate("nist-800-53", [unmonitoredCompute], store);
    expect(result.score).toBe(100);
    expect(result.waivedControls).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-framework resource scanning
// ---------------------------------------------------------------------------
describe("cross-framework scanning", () => {
  const allFrameworks = ["soc2", "cis", "hipaa", "pci-dss", "gdpr", "nist-800-53"] as const;

  it("same resource evaluated across all 6 frameworks", () => {
    for (const fwId of allFrameworks) {
      const result = evaluate(fwId, [noTlsDatabase]);
      expect(result.framework).toBe(fwId);
      expect(result.totalControls).toBeGreaterThan(0);
    }
  });

  it("fully compliant resource passes most frameworks", () => {
    const highScoreCount = allFrameworks.filter((fwId) => {
      const result = evaluate(fwId, [hipaaDatabase]);
      return result.score >= 80;
    }).length;
    expect(highScoreCount).toBeGreaterThanOrEqual(4);
  });

  it("each framework has unique control IDs", () => {
    for (const fw of FRAMEWORKS) {
      const ids = fw.controls.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });
});
