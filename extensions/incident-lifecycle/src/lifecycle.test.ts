// ─── Incident Lifecycle Tests ──────────────────────────────────────────
//
// Comprehensive tests for the full lifecycle:
//   state machine · classification · triage ·
//   remediation · rollback · post-mortem · tools
// ───────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";

import {
  createLifecycleIncident,
  classifyIncident,
  triageIncident,
  transitionPhase,
  filterLifecycles,
  buildDashboard,
  sortByPriority,
  resetIdCounter,
} from "./state-machine.js";

import {
  planRemediation,
  executeRemediation,
  simulateRemediation,
  detectStrategy,
  resetPlanCounter,
} from "./remediation.js";

import {
  planRollback,
  executeRollback,
  detectRollbackStrategy,
  resetRollbackCounter,
} from "./rollback.js";

import {
  generatePostMortem,
  closeLifecycle,
  reconstructTimeline,
  analyzeRootCause,
  assessImpact,
  reviewRemediation,
  generateActionItems,
  resetPmCounter,
  resetActionCounter,
} from "./post-mortem.js";

import { createLifecycleTools, clearStore, getStore } from "./tools.js";

import type {
  LifecycleIncident,
  CreateLifecycleInput,
  IncidentSnapshot,
} from "./types.js";
import { PHASE_TRANSITIONS, PHASE_ORDER } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeSnapshot(overrides: Partial<IncidentSnapshot> = {}): IncidentSnapshot {
  return {
    id: "inc-001",
    cloud: "aws",
    source: "cloudwatch-alarm",
    title: "High CPU usage on prod-api",
    description: "CPU utilization exceeded 90% threshold",
    severity: 2,
    status: "firing",
    resource: "arn:aws:ec2:us-east-1:123456789012:instance/i-abc123",
    region: "us-east-1",
    startedAt: "2026-01-15T10:00:00Z",
    tags: { env: "production", team: "platform" },
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateLifecycleInput> = {}): CreateLifecycleInput {
  return {
    incidentId: "inc-001",
    incident: makeSnapshot(),
    initiatedBy: "operator",
    ...overrides,
  };
}

/** Run through lifecycle until a target phase. */
function advanceTo(
  targetPhase: string,
  snapshot?: Partial<IncidentSnapshot>,
): LifecycleIncident {
  let lc = createLifecycleIncident(makeInput({ incident: makeSnapshot(snapshot) }));

  if (targetPhase === "detected") return lc;

  const clsResult = classifyIncident(lc, "system");
  if (!clsResult.success) throw new Error(clsResult.error);
  lc = clsResult.incident;
  if (targetPhase === "classified") return lc;

  const triResult = triageIncident(lc, { triggeredBy: "system", assignee: "sre-team" });
  if (!triResult.success) throw new Error(triResult.error);
  lc = triResult.incident;
  if (targetPhase === "triaged") return lc;

  const remResult = planRemediation(lc, {
    lifecycleId: lc.id,
    triggeredBy: "system",
  });
  if (!remResult.success) throw new Error(remResult.error);
  lc = remResult.incident;
  if (targetPhase === "remediating") return lc;

  if (targetPhase === "rolling-back") {
    const rbResult = planRollback(lc, {
      lifecycleId: lc.id,
      reason: "remediation failed",
      triggeredBy: "system",
    });
    if (!rbResult.success) throw new Error(rbResult.error);
    return rbResult.incident;
  }

  throw new Error(`Unknown target phase: ${targetPhase}`);
}

/* ================================================================== */
/*  STATE MACHINE                                                      */
/* ================================================================== */

describe("State Machine", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("createLifecycleIncident", () => {
    it("creates incident in detected phase", () => {
      const lc = createLifecycleIncident(makeInput());
      expect(lc.phase).toBe("detected");
      expect(lc.incidentId).toBe("inc-001");
      expect(lc.initiatedBy).toBe("operator");
      expect(lc.phaseHistory).toHaveLength(1);
      expect(lc.phaseHistory[0].from).toBe("init");
      expect(lc.phaseHistory[0].to).toBe("detected");
    });

    it("preserves incident snapshot", () => {
      const lc = createLifecycleIncident(makeInput());
      expect(lc.incident.cloud).toBe("aws");
      expect(lc.incident.severity).toBe(2);
      expect(lc.incident.resource).toContain("arn:aws");
    });

    it("initializes all fields to null", () => {
      const lc = createLifecycleIncident(makeInput());
      expect(lc.classification).toBeNull();
      expect(lc.triage).toBeNull();
      expect(lc.remediation).toBeNull();
      expect(lc.rollback).toBeNull();
      expect(lc.postMortem).toBeNull();
    });

    it("stores correlation group ID", () => {
      const lc = createLifecycleIncident(
        makeInput({ correlationGroupId: "corr-123" }),
      );
      expect(lc.correlationGroupId).toBe("corr-123");
    });
  });

  describe("transitionPhase", () => {
    it("allows valid transitions", () => {
      const lc = createLifecycleIncident(makeInput());
      const result = transitionPhase(lc, "classified", "system", "test");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.phase).toBe("classified");
        expect(result.incident.phaseHistory).toHaveLength(2);
      }
    });

    it("rejects invalid transitions", () => {
      const lc = createLifecycleIncident(makeInput());
      const result = transitionPhase(lc, "remediating", "system", "test");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Invalid transition");
        expect(result.error).toContain("detected");
        expect(result.error).toContain("remediating");
      }
    });

    it("records duration between transitions", () => {
      const lc = createLifecycleIncident(makeInput());
      const result = transitionPhase(lc, "classified", "system", "test");
      expect(result.success).toBe(true);
      if (result.success) {
        const transition = result.incident.phaseHistory[1];
        expect(transition.durationMs).toBeDefined();
        expect(typeof transition.durationMs).toBe("number");
      }
    });

    it("does not allow transitions from closed", () => {
      const phases: Array<keyof typeof PHASE_TRANSITIONS> = [
        "detected", "classified", "triaged", "remediating", "rolling-back", "post-mortem",
      ];
      for (const phase of phases) {
        const lc = createLifecycleIncident(makeInput());
        const closedLc = { ...lc, phase: "closed" as const };
        const result = transitionPhase(closedLc, phase, "system", "test");
        expect(result.success).toBe(false);
      }
    });
  });

  describe("PHASE_ORDER", () => {
    it("has correct ordering", () => {
      expect(PHASE_ORDER["detected"]).toBeLessThan(PHASE_ORDER["classified"]);
      expect(PHASE_ORDER["classified"]).toBeLessThan(PHASE_ORDER["triaged"]);
      expect(PHASE_ORDER["triaged"]).toBeLessThan(PHASE_ORDER["remediating"]);
      expect(PHASE_ORDER["remediating"]).toBeLessThan(PHASE_ORDER["rolling-back"]);
      expect(PHASE_ORDER["rolling-back"]).toBeLessThan(PHASE_ORDER["post-mortem"]);
      expect(PHASE_ORDER["post-mortem"]).toBeLessThan(PHASE_ORDER["closed"]);
    });
  });

  describe("PHASE_TRANSITIONS", () => {
    it("triaged can go to remediating or closed", () => {
      expect(PHASE_TRANSITIONS["triaged"]).toContain("remediating");
      expect(PHASE_TRANSITIONS["triaged"]).toContain("closed");
    });

    it("remediating can go to rolling-back or post-mortem", () => {
      expect(PHASE_TRANSITIONS["remediating"]).toContain("rolling-back");
      expect(PHASE_TRANSITIONS["remediating"]).toContain("post-mortem");
    });

    it("rolling-back always goes to post-mortem", () => {
      expect(PHASE_TRANSITIONS["rolling-back"]).toEqual(["post-mortem"]);
    });
  });
});

/* ================================================================== */
/*  CLASSIFICATION                                                     */
/* ================================================================== */

describe("Classification", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("classifies incident and transitions to classified", () => {
    const lc = createLifecycleIncident(makeInput());
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.phase).toBe("classified");
      expect(result.incident.classification).not.toBeNull();
    }
  });

  it("rejects classification from wrong phase", () => {
    const lc = advanceTo("classified");
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(false);
  });

  it("detects security breach category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Unauthorized access detected",
          description: "Security breach on production server",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("security-breach");
    }
  });

  it("detects configuration drift category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Configuration drift detected",
          description: "S3 bucket encryption was modified",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("configuration-drift");
    }
  });

  it("detects cost anomaly category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Cost anomaly alert",
          description: "Billing spike detected in EC2 spending",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("cost-anomaly");
    }
  });

  it("detects availability loss category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Service unavailable",
          description: "API returning 503 errors",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("availability-loss");
    }
  });

  it("detects deployment failure category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Deployment rollout failed",
          description: "CI/CD pipeline failed during release",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("deployment-failure");
    }
  });

  it("detects scaling issue category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Pod throttled — capacity limit reached",
          description: "Kubernetes pod is being throttled",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("scaling-issue");
    }
  });

  it("detects network issue category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "DNS resolution failure",
          description: "VPC subnet connectivity problems",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("network-issue");
    }
  });

  it("adjusts severity up for security breaches", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Security breach",
          severity: 3,
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.adjustedSeverity).toBeLessThan(3);
    }
  });

  it("adjusts severity for production resources", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "High latency",
          severity: 4,
          resource: "arn:aws:ec2:us-east-1:123:instance/prod-api-server",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.adjustedSeverity).toBeLessThan(4);
    }
  });

  it("extracts AWS service from ARN", () => {
    const lc = createLifecycleIncident(makeInput());
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.affectedServices).toContain("aws:ec2");
    }
  });

  it("estimates blast radius", () => {
    const lc = createLifecycleIncident(makeInput());
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect([
        "single-resource", "service", "region", "multi-region", "global",
      ]).toContain(result.incident.classification!.blastRadius);
    }
  });

  it("suggests remediation approach", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Configuration drift detected",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.suggestedApproach).toBe("auto-remediate");
    }
  });

  it("detects infrastructure failure category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Server crash",
          description: "Instance panic — unexpected kernel failure",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("infrastructure-failure");
    }
  });

  it("detects performance degradation category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "High latency on API",
          description: "P99 latency spiking, response times slow",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("performance-degradation");
    }
  });

  it("falls back to unknown category", () => {
    const lc = createLifecycleIncident(
      makeInput({
        incident: makeSnapshot({
          title: "Something odd happened",
          description: "Nobody really knows",
        }),
      }),
    );
    const result = classifyIncident(lc, "system");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.classification!.category).toBe("unknown");
    }
  });
});

/* ================================================================== */
/*  TRIAGE                                                             */
/* ================================================================== */

describe("Triage", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("triages classified incident", () => {
    const lc = advanceTo("classified");
    const result = triageIncident(lc, { triggeredBy: "system", assignee: "sre-team" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.phase).toBe("triaged");
      expect(result.incident.triage).not.toBeNull();
      expect(result.incident.triage!.assignee).toBe("sre-team");
    }
  });

  it("rejects triage from wrong phase", () => {
    const lc = createLifecycleIncident(makeInput());
    const result = triageIncident(lc, { triggeredBy: "system" });
    expect(result.success).toBe(false);
  });

  it("sets priority based on severity", () => {
    const lc = advanceTo("classified");
    const result = triageIncident(lc, { triggeredBy: "system" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.triage!.priority).toBeGreaterThanOrEqual(1);
      expect(result.incident.triage!.priority).toBeLessThanOrEqual(5);
    }
  });

  it("determines escalation for critical severity", () => {
    const lc = advanceTo("classified", { severity: 1 });
    const result = triageIncident(lc, { triggeredBy: "system" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.triage!.escalation).toBe("management");
    }
  });

  it("determines escalation for security breaches", () => {
    const lc = advanceTo("classified", {
      title: "Security breach detected",
      severity: 3,
    });
    const result = triageIncident(lc, { triggeredBy: "system" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.triage!.escalation).toBe("management");
    }
  });

  it("estimates remediation time", () => {
    const lc = advanceTo("classified");
    const result = triageIncident(lc, { triggeredBy: "system" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.triage!.estimatedTimeMinutes).toBeGreaterThan(0);
    }
  });

  it("stores related incident IDs", () => {
    const lc = advanceTo("classified");
    const result = triageIncident(lc, {
      triggeredBy: "system",
      relatedIncidentIds: ["inc-002", "inc-003"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.triage!.relatedIncidentIds).toEqual(["inc-002", "inc-003"]);
    }
  });

  it("builds prerequisites for wide blast radius", () => {
    const lc = advanceTo("classified", {
      title: "VPC network outage",
      resource: "arn:aws:ec2:us-east-1:123:vpc/vpc-123",
      region: "us-east-1",
    });
    const result = triageIncident(lc, { triggeredBy: "system" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.triage!.prerequisites.length).toBeGreaterThan(0);
    }
  });

  it("defaults assignee to unassigned", () => {
    const lc = advanceTo("classified");
    const result = triageIncident(lc, { triggeredBy: "system" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.incident.triage!.assignee).toBe("unassigned");
    }
  });
});

/* ================================================================== */
/*  REMEDIATION DISPATCHER                                             */
/* ================================================================== */

describe("Remediation", () => {
  beforeEach(() => {
    resetIdCounter();
    resetPlanCounter();
  });

  describe("detectStrategy", () => {
    it("suggests aws-reconciliation for AWS config drift", () => {
      const lc = advanceTo("classified", {
        title: "Configuration drift detected",
        cloud: "aws",
      });
      expect(detectStrategy(lc)).toBe("aws-reconciliation");
    });

    it("suggests k8s-rollout-restart for K8s availability loss", () => {
      const lc = advanceTo("classified", {
        title: "Service unavailable",
        description: "API is down and returning 503 errors",
        cloud: "kubernetes",
      });
      expect(detectStrategy(lc)).toBe("k8s-rollout-restart");
    });

    it("suggests helm-rollback for K8s deployment failure", () => {
      const lc = advanceTo("classified", {
        title: "Deployment rollout failed",
        description: "Helm release failed during rollout",
        cloud: "kubernetes",
      });
      expect(detectStrategy(lc)).toBe("helm-rollback");
    });

    it("suggests azure-slot-swap for Azure deployment failure", () => {
      const lc = advanceTo("classified", {
        title: "Deployment failed",
        description: "Azure deployment pipeline failed during release",
        cloud: "azure",
      });
      expect(detectStrategy(lc)).toBe("azure-slot-swap");
    });

    it("suggests k8s-scale for K8s scaling issue", () => {
      const lc = advanceTo("classified", {
        title: "Pod throttled",
        cloud: "kubernetes",
      });
      expect(detectStrategy(lc)).toBe("k8s-scale");
    });

    it("suggests manual for unknown categories", () => {
      const lc = advanceTo("classified", {
        title: "Something happened",
        description: "No matching keywords",
      });
      expect(detectStrategy(lc)).toBe("manual");
    });
  });

  describe("planRemediation", () => {
    it("creates remediation plan from triaged phase", () => {
      const lc = advanceTo("triaged");
      const result = planRemediation(lc, { lifecycleId: lc.id, triggeredBy: "system" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.phase).toBe("remediating");
        expect(result.incident.remediation).not.toBeNull();
        expect(result.incident.remediation!.steps.length).toBeGreaterThan(0);
      }
    });

    it("rejects remediation from wrong phase", () => {
      const lc = advanceTo("classified");
      const result = planRemediation(lc, { lifecycleId: lc.id, triggeredBy: "system" });
      expect(result.success).toBe(false);
    });

    it("uses detected strategy when none specified", () => {
      const lc = advanceTo("triaged");
      const result = planRemediation(lc, { lifecycleId: lc.id, triggeredBy: "system" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.strategy).toBeDefined();
      }
    });

    it("accepts strategy override", () => {
      const lc = advanceTo("triaged");
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "terraform-apply",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.strategy).toBe("terraform-apply");
      }
    });

    it("generates AWS reconciliation steps", () => {
      const lc = advanceTo("triaged", { title: "Configuration drift", cloud: "aws" });
      const result = planRemediation(lc, { lifecycleId: lc.id, triggeredBy: "system" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.steps.length).toBe(4);
        expect(result.incident.remediation!.steps[0].description).toContain("state");
      }
    });

    it("generates K8s rollout restart steps", () => {
      const lc = advanceTo("triaged", {
        title: "Service down",
        cloud: "kubernetes",
      });
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "k8s-rollout-restart",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.steps.length).toBe(3);
      }
    });

    it("generates Helm rollback steps", () => {
      const lc = advanceTo("triaged", { cloud: "kubernetes" });
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "helm-rollback",
        parameters: { release: "my-app", namespace: "prod" },
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.steps.length).toBe(3);
        expect(result.incident.remediation!.steps[1].parameters.release).toBe("my-app");
      }
    });

    it("generates Azure slot swap steps", () => {
      const lc = advanceTo("triaged", { cloud: "azure" });
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "azure-slot-swap",
        parameters: { appName: "my-webapp", resourceGroup: "rg-prod" },
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.steps.length).toBe(3);
      }
    });

    it("generates Terraform apply steps", () => {
      const lc = advanceTo("triaged");
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "terraform-apply",
        parameters: { cwd: "/infra" },
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.steps.length).toBe(3);
        expect(result.incident.remediation!.steps[0].parameters.action).toBe("plan");
      }
    });

    it("generates K8s scale steps", () => {
      const lc = advanceTo("triaged", { cloud: "kubernetes" });
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "k8s-scale",
        parameters: { replicas: 5, namespace: "prod" },
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.strategy).toBe("k8s-scale");
        expect(result.incident.remediation!.steps.length).toBe(3);
      }
    });

    it("generates Azure traffic shift steps", () => {
      const lc = advanceTo("triaged", { cloud: "azure" });
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "azure-traffic-shift",
        parameters: { appName: "my-webapp", resourceGroup: "rg-prod" },
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.strategy).toBe("azure-traffic-shift");
        expect(result.incident.remediation!.steps.length).toBe(2);
      }
    });

    it("generates custom runbook steps", () => {
      const lc = advanceTo("triaged");
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "custom-runbook",
        parameters: { steps: ["step-a", "step-b", "step-c"] },
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.strategy).toBe("custom-runbook");
        expect(result.incident.remediation!.steps.length).toBeGreaterThan(0);
      }
    });

    it("generates manual steps", () => {
      const lc = advanceTo("triaged");
      const result = planRemediation(lc, {
        lifecycleId: lc.id,
        strategy: "manual",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.remediation!.strategy).toBe("manual");
        expect(result.incident.remediation!.steps.length).toBe(2);
      }
    });
  });

  describe("executeRemediation", () => {
    it("executes steps sequentially — all succeed", async () => {
      const lc = advanceTo("remediating");
      const result = await executeRemediation(lc, async () => ({
        success: true,
        output: "done",
      }));
      expect(result.success).toBe(true);
      expect(result.incident.remediation!.status).toBe("completed");
      expect(
        result.incident.remediation!.steps.every((s) => s.status === "completed"),
      ).toBe(true);
    });

    it("stops on first failure", async () => {
      const lc = advanceTo("remediating");
      let callCount = 0;
      const result = await executeRemediation(lc, async () => {
        callCount++;
        if (callCount === 2) return { success: false, error: "boom" };
        return { success: true };
      });
      expect(result.success).toBe(false);
      expect(result.failedStep).toBeDefined();
      expect(result.incident.remediation!.status).toBe("failed");
    });

    it("handles executor exceptions", async () => {
      const lc = advanceTo("remediating");
      const result = await executeRemediation(lc, async () => {
        throw new Error("network error");
      });
      expect(result.success).toBe(false);
      expect(result.incident.remediation!.steps[0].error).toBe("network error");
    });

    it("tracks duration", async () => {
      const lc = advanceTo("remediating");
      const result = await executeRemediation(lc, async () => ({
        success: true,
      }));
      expect(result.incident.remediation!.durationMs).toBeDefined();
      expect(result.incident.remediation!.durationMs!).toBeGreaterThanOrEqual(0);
    });
  });

  describe("simulateRemediation", () => {
    it("marks all steps as completed with dry-run output", () => {
      const lc = advanceTo("remediating");
      const result = simulateRemediation(lc);
      expect(result.success).toBe(true);
      for (const step of result.incident.remediation!.steps) {
        expect(step.status).toBe("completed");
        expect(step.output).toContain("[DRY-RUN]");
      }
    });
  });
});

/* ================================================================== */
/*  ROLLBACK DISPATCHER                                                */
/* ================================================================== */

describe("Rollback", () => {
  beforeEach(() => {
    resetIdCounter();
    resetPlanCounter();
    resetRollbackCounter();
  });

  describe("detectRollbackStrategy", () => {
    it("maps aws-reconciliation → restore-snapshot", () => {
      const lc = advanceTo("remediating", { title: "Configuration drift", cloud: "aws" });
      expect(detectRollbackStrategy(lc)).toBe("restore-snapshot");
    });

    it("maps k8s-rollout-restart → k8s-rollout-undo", () => {
      const lc = advanceTo("remediating", { title: "Service down", cloud: "kubernetes" });
      // Force strategy
      lc.remediation = { ...lc.remediation!, strategy: "k8s-rollout-restart" };
      expect(detectRollbackStrategy(lc)).toBe("k8s-rollout-undo");
    });

    it("maps helm-rollback → helm-rollback", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, strategy: "helm-rollback" };
      expect(detectRollbackStrategy(lc)).toBe("helm-rollback");
    });

    it("maps azure-slot-swap → azure-slot-swap-back", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, strategy: "azure-slot-swap" };
      expect(detectRollbackStrategy(lc)).toBe("azure-slot-swap-back");
    });

    it("maps terraform-apply → terraform-revert", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, strategy: "terraform-apply" };
      expect(detectRollbackStrategy(lc)).toBe("terraform-revert");
    });

    it("defaults to manual when no remediation", () => {
      const lc = createLifecycleIncident(makeInput());
      expect(detectRollbackStrategy(lc)).toBe("manual");
    });
  });

  describe("planRollback", () => {
    it("creates rollback plan from remediating phase", () => {
      const lc = advanceTo("remediating");
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "remediation failed",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.phase).toBe("rolling-back");
        expect(result.incident.rollback).not.toBeNull();
        expect(result.incident.rollback!.steps.length).toBeGreaterThan(0);
        expect(result.incident.rollback!.reason).toBe("remediation failed");
      }
    });

    it("rejects rollback from wrong phase", () => {
      const lc = advanceTo("triaged");
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "test",
        triggeredBy: "system",
      });
      expect(result.success).toBe(false);
    });

    it("accepts strategy override", () => {
      const lc = advanceTo("remediating");
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "manual rollback",
        strategy: "manual",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("manual");
      }
    });

    it("generates K8s rollout undo steps", () => {
      const lc = advanceTo("remediating", { cloud: "kubernetes", title: "Service down" });
      lc.remediation = { ...lc.remediation!, strategy: "k8s-rollout-restart" };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "restart failed",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("k8s-rollout-undo");
        expect(result.incident.rollback!.steps.length).toBe(3);
      }
    });

    it("generates Azure swap-back steps", () => {
      const lc = advanceTo("remediating", { cloud: "azure" });
      lc.remediation = { ...lc.remediation!, strategy: "azure-slot-swap" };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "swap failed",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("azure-slot-swap-back");
        expect(result.incident.rollback!.steps.length).toBe(2);
      }
    });

    it("generates restore-snapshot steps", () => {
      const lc = advanceTo("remediating", { cloud: "aws" });
      lc.remediation = { ...lc.remediation!, strategy: "aws-reconciliation" };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "reconciliation failed",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("restore-snapshot");
        expect(result.incident.rollback!.steps.length).toBe(3);
        expect(result.incident.rollback!.steps[0].description).toContain("snapshot");
      }
    });

    it("generates reverse-remediation steps from completed remediation", () => {
      const lc = advanceTo("remediating", { cloud: "kubernetes" });
      lc.remediation = {
        ...lc.remediation!,
        strategy: "k8s-scale",
        steps: [
          { stepNumber: 1, strategy: "k8s-scale", description: "Scale replicas to 5", parameters: {}, status: "completed", canRetry: true, retryCount: 0, maxRetries: 3 },
          { stepNumber: 2, strategy: "k8s-scale", description: "Check pods running", parameters: {}, status: "completed", canRetry: true, retryCount: 0, maxRetries: 3 },
        ],
      };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "scale failed",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("reverse-remediation");
        expect(result.incident.rollback!.steps.length).toBe(2);
        expect(result.incident.rollback!.steps[0].description).toContain("Reverse");
      }
    });

    it("generates manual-review fallback when no completed remediation steps exist", () => {
      const lc = advanceTo("remediating", { cloud: "kubernetes" });
      lc.remediation = {
        ...lc.remediation!,
        strategy: "k8s-scale",
        steps: [
          { stepNumber: 1, strategy: "k8s-scale", description: "Scale replicas", parameters: {}, status: "pending", canRetry: true, retryCount: 0, maxRetries: 3 },
        ],
      };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "nothing to reverse",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("reverse-remediation");
        expect(result.incident.rollback!.steps.length).toBe(1);
        expect(result.incident.rollback!.steps[0].description).toContain("Manual review required");
      }
    });

    it("generates helm-rollback steps", () => {
      const lc = advanceTo("remediating", { cloud: "kubernetes" });
      lc.remediation = { ...lc.remediation!, strategy: "helm-rollback" };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "helm upgrade failed",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("helm-rollback");
        expect(result.incident.rollback!.steps.length).toBe(3);
        expect(result.incident.rollback!.steps[1].description).toContain("Roll back Helm");
      }
    });

    it("generates terraform-revert steps", () => {
      const lc = advanceTo("remediating", { cloud: "aws" });
      lc.remediation = { ...lc.remediation!, strategy: "terraform-apply" };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "terraform apply broke infra",
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("terraform-revert");
        expect(result.incident.rollback!.steps.length).toBe(3);
        expect(result.incident.rollback!.steps[2].description).toContain("terraform apply");
      }
    });

    it("generates manual rollback steps", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, strategy: "manual" };
      const result = planRollback(lc, {
        lifecycleId: lc.id,
        reason: "need human intervention",
        triggeredBy: "operator",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.rollback!.strategy).toBe("manual");
        expect(result.incident.rollback!.steps.length).toBe(2);
        expect(result.incident.rollback!.steps[1].description).toContain("Verify system");
      }
    });
  });

  describe("executeRollback", () => {
    it("executes all steps successfully", async () => {
      const lc = advanceTo("rolling-back");
      const result = await executeRollback(lc, async () => ({
        success: true,
        output: "rolled back",
      }));
      expect(result.success).toBe(true);
      expect(result.incident.rollback!.status).toBe("completed");
      expect(result.incident.rollback!.stateRestored).toBe(true);
    });

    it("marks failed on step failure", async () => {
      const lc = advanceTo("rolling-back");
      const result = await executeRollback(lc, async () => ({
        success: false,
        error: "rollback step failed",
      }));
      expect(result.success).toBe(false);
      expect(result.incident.rollback!.status).toBe("failed");
      expect(result.incident.rollback!.stateRestored).toBe(false);
    });

    it("tracks duration", async () => {
      const lc = advanceTo("rolling-back");
      const result = await executeRollback(lc, async () => ({
        success: true,
      }));
      expect(result.incident.rollback!.durationMs).toBeDefined();
    });
  });
});

/* ================================================================== */
/*  POST-MORTEM ENGINE                                                 */
/* ================================================================== */

describe("Post-Mortem", () => {
  beforeEach(() => {
    resetIdCounter();
    resetPlanCounter();
    resetRollbackCounter();
    resetPmCounter();
    resetActionCounter();
  });

  describe("reconstructTimeline", () => {
    it("includes phase transitions", () => {
      const lc = advanceTo("remediating");
      const timeline = reconstructTimeline(lc);
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline.some((e) => e.event.includes("Phase transition"))).toBe(true);
    });

    it("includes classification event", () => {
      const lc = advanceTo("remediating");
      const timeline = reconstructTimeline(lc);
      expect(timeline.some((e) => e.event.includes("Classified as"))).toBe(true);
    });

    it("includes triage event", () => {
      const lc = advanceTo("remediating");
      const timeline = reconstructTimeline(lc);
      expect(timeline.some((e) => e.event.includes("Triaged"))).toBe(true);
    });

    it("includes remediation steps", () => {
      const lc = advanceTo("remediating");
      const sim = simulateRemediation(lc);
      const timeline = reconstructTimeline(sim.incident);
      expect(
        timeline.some((e) => e.event.includes("Remediation started")),
      ).toBe(true);
    });

    it("includes rollback steps", () => {
      const lc = advanceTo("rolling-back");
      const timeline = reconstructTimeline(lc);
      expect(
        timeline.some((e) => e.event.includes("Rollback started")),
      ).toBe(true);
    });

    it("sorts entries chronologically", () => {
      const lc = advanceTo("remediating");
      const timeline = reconstructTimeline(lc);
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i].timestamp >= timeline[i - 1].timestamp).toBe(true);
      }
    });
  });

  describe("analyzeRootCause", () => {
    it("produces root cause summary", () => {
      const lc = advanceTo("remediating");
      const rca = analyzeRootCause(lc);
      expect(rca.summary).toBeTruthy();
      expect(rca.category).toBeDefined();
      expect(typeof rca.confidence).toBe("number");
    });

    it("notes failed remediation as contributing factor", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, status: "failed" };
      lc.remediation.steps = [
        { ...lc.remediation.steps[0], status: "failed", error: "timeout" },
      ];
      const rca = analyzeRootCause(lc);
      expect(
        rca.contributingFactors.some((f) => f.includes("Remediation failed")),
      ).toBe(true);
    });

    it("notes rollback as contributing factor", () => {
      const lc = advanceTo("rolling-back");
      const rca = analyzeRootCause(lc);
      expect(
        rca.contributingFactors.some((f) => f.includes("Rollback")),
      ).toBe(true);
    });
  });

  describe("assessImpact", () => {
    it("includes affected services and regions", () => {
      const lc = advanceTo("remediating");
      const impact = assessImpact(lc);
      expect(impact.affectedServices.length).toBeGreaterThan(0);
      expect(impact.affectedRegions).toContain("us-east-1");
      expect(impact.affectedClouds).toContain("aws");
    });

    it("detects SLA breach for high severity", () => {
      const lc = advanceTo("remediating", { severity: 1 });
      const impact = assessImpact(lc);
      expect(impact.slaBreached).toBe(true);
    });

    it("no SLA breach for low severity", () => {
      const lc = advanceTo("remediating", { severity: 5 });
      const impact = assessImpact(lc);
      expect(impact.slaBreached).toBe(false);
    });
  });

  describe("reviewRemediation", () => {
    it("reports attempted and successful remediation", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, status: "completed" };
      const review = reviewRemediation(lc);
      expect(review.attempted).toBe(true);
      expect(review.successful).toBe(true);
      expect(review.rollbackNeeded).toBe(false);
    });

    it("reports failed remediation with improvements", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, status: "failed" };
      const review = reviewRemediation(lc);
      expect(review.attempted).toBe(true);
      expect(review.successful).toBe(false);
      expect(review.improvements.length).toBeGreaterThan(0);
    });

    it("reports rollback was needed", () => {
      const lc = advanceTo("rolling-back");
      const review = reviewRemediation(lc);
      expect(review.rollbackNeeded).toBe(true);
    });

    it("suggests auto-execution improvement when manual", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, autoExecuted: false };
      const review = reviewRemediation(lc);
      expect(
        review.improvements.some((i) => i.includes("manual execution")),
      ).toBe(true);
    });
  });

  describe("generateActionItems", () => {
    it("always generates documentation action item", () => {
      const lc = advanceTo("remediating");
      const items = generateActionItems(lc);
      expect(items.some((i) => i.category === "documentation")).toBe(true);
    });

    it("generates action item for failed remediation", () => {
      const lc = advanceTo("remediating");
      lc.remediation = { ...lc.remediation!, status: "failed" };
      const items = generateActionItems(lc);
      expect(items.some((i) => i.title.includes("Fix remediation"))).toBe(true);
    });

    it("generates action item for rollback", () => {
      const lc = advanceTo("rolling-back");
      const items = generateActionItems(lc);
      expect(items.some((i) => i.title.includes("pre-deployment"))).toBe(true);
    });

    it("includes additional action items", () => {
      const lc = advanceTo("remediating");
      const items = generateActionItems(lc, [
        {
          title: "Custom action",
          description: "Do something special",
          priority: "medium",
          assignee: "team",
          dueDate: "2026-02-01",
          category: "tooling",
        },
      ]);
      expect(items.some((i) => i.title === "Custom action")).toBe(true);
    });

    it("generates blast radius action for wide impact", () => {
      const lc = advanceTo("remediating", {
        resource: "arn:aws:ec2:us-east-1:123:vpc/vpc-region-wide",
        region: "global",
      });
      const items = generateActionItems(lc);
      expect(
        items.some((i) => i.title.includes("blast radius")),
      ).toBe(true);
    });
  });

  describe("generatePostMortem", () => {
    it("generates from remediating phase", () => {
      const lc = advanceTo("remediating");
      const sim = simulateRemediation(lc);
      const result = generatePostMortem(sim.incident, {
        lifecycleId: sim.incident.id,
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.phase).toBe("post-mortem");
        expect(result.incident.postMortem).not.toBeNull();
        expect(result.incident.postMortem!.timeline.length).toBeGreaterThan(0);
        expect(result.incident.postMortem!.rootCause.summary).toBeTruthy();
        expect(result.incident.postMortem!.actionItems.length).toBeGreaterThan(0);
      }
    });

    it("generates from rolling-back phase", () => {
      const lc = advanceTo("rolling-back");
      const result = generatePostMortem(lc, {
        lifecycleId: lc.id,
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.phase).toBe("post-mortem");
        expect(result.incident.postMortem!.remediationReview.rollbackNeeded).toBe(true);
      }
    });

    it("rejects from wrong phase", () => {
      const lc = advanceTo("triaged");
      const result = generatePostMortem(lc, {
        lifecycleId: lc.id,
        triggeredBy: "system",
      });
      expect(result.success).toBe(false);
    });

    it("includes lessons learned", () => {
      const lc = advanceTo("remediating");
      const result = generatePostMortem(lc, {
        lifecycleId: lc.id,
        lessonsLearned: ["Need better monitoring", "Runbook was outdated"],
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.postMortem!.lessonsLearned).toContain("Need better monitoring");
      }
    });

    it("calculates MTTR", () => {
      const lc = advanceTo("remediating");
      const result = generatePostMortem(lc, {
        lifecycleId: lc.id,
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.postMortem!.mttrMs).toBeGreaterThanOrEqual(0);
        expect(result.incident.postMortem!.totalDurationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("marks as not reviewed by default", () => {
      const lc = advanceTo("remediating");
      const result = generatePostMortem(lc, {
        lifecycleId: lc.id,
        triggeredBy: "system",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.postMortem!.reviewed).toBe(false);
      }
    });
  });

  describe("closeLifecycle", () => {
    it("closes from post-mortem phase", () => {
      const lc = advanceTo("remediating");
      const pm = generatePostMortem(lc, { lifecycleId: lc.id, triggeredBy: "system" });
      expect(pm.success).toBe(true);
      if (!pm.success) return;

      const result = closeLifecycle(pm.incident, { triggeredBy: "operator" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.phase).toBe("closed");
      }
    });

    it("closes from triaged phase (no remediation needed)", () => {
      const lc = advanceTo("triaged");
      const result = closeLifecycle(lc, {
        triggeredBy: "operator",
        reason: "False alarm",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.incident.phase).toBe("closed");
      }
    });

    it("rejects close from other phases", () => {
      const lc = advanceTo("classified");
      const result = closeLifecycle(lc, { triggeredBy: "operator" });
      expect(result.success).toBe(false);
    });
  });
});

/* ================================================================== */
/*  FILTER & DASHBOARD                                                 */
/* ================================================================== */

describe("Filter & Dashboard", () => {
  beforeEach(() => {
    resetIdCounter();
    resetPlanCounter();
    resetRollbackCounter();
    resetPmCounter();
    resetActionCounter();
  });

  it("filters by phase", () => {
    const incidents = [
      advanceTo("detected"),
      advanceTo("classified"),
      advanceTo("triaged"),
    ];
    const filtered = filterLifecycles(incidents, { phases: ["detected"] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].phase).toBe("detected");
  });

  it("filters by cloud", () => {
    const incidents = [
      advanceTo("detected", { cloud: "aws" }),
      advanceTo("detected", { cloud: "azure" }),
    ];
    const filtered = filterLifecycles(incidents, { clouds: ["aws"] });
    expect(filtered).toHaveLength(1);
  });

  it("filters by severity", () => {
    const incidents = [
      advanceTo("detected", { severity: 1 }),
      advanceTo("detected", { severity: 3 }),
      advanceTo("detected", { severity: 5 }),
    ];
    const filtered = filterLifecycles(incidents, { severities: [1, 2] });
    expect(filtered).toHaveLength(1);
  });

  it("filters by assignee", () => {
    const lc1 = advanceTo("triaged");
    lc1.triage = { ...lc1.triage!, assignee: "alice" };
    const lc2 = advanceTo("triaged");
    lc2.triage = { ...lc2.triage!, assignee: "bob" };

    const filtered = filterLifecycles([lc1, lc2], { assignee: "alice" });
    expect(filtered).toHaveLength(1);
  });

  it("builds dashboard with correct counts", () => {
    const incidents = [
      advanceTo("detected"),
      advanceTo("classified"),
      advanceTo("triaged"),
    ];
    const dashboard = buildDashboard(incidents);
    expect(dashboard.total).toBe(3);
    expect(dashboard.byPhase["detected"]).toBe(1);
    expect(dashboard.byPhase["classified"]).toBe(1);
    expect(dashboard.byPhase["triaged"]).toBe(1);
    expect(dashboard.activeIncidents).toBe(3);
  });

  it("calculates remediation success rate", () => {
    const lc1 = advanceTo("remediating");
    lc1.remediation = { ...lc1.remediation!, status: "completed" };
    const lc2 = advanceTo("remediating");
    lc2.remediation = { ...lc2.remediation!, status: "failed" };

    const dashboard = buildDashboard([lc1, lc2]);
    expect(dashboard.remediationSuccessRate).toBe(50);
  });

  it("sorts by priority — active first, then severity", () => {
    const lc1 = advanceTo("detected", { severity: 5 });
    const lc2 = advanceTo("detected", { severity: 1 });
    const lc3 = advanceTo("detected", { severity: 3 });

    const sorted = sortByPriority([lc1, lc2, lc3]);
    expect(sorted[0].incident.severity).toBe(1);
    expect(sorted[1].incident.severity).toBe(3);
    expect(sorted[2].incident.severity).toBe(5);
  });

  it("returns null for avgMttrMs when no post-mortems", () => {
    const dashboard = buildDashboard([advanceTo("detected")]);
    expect(dashboard.avgMttrMs).toBeNull();
  });
});

/* ================================================================== */
/*  FULL LIFECYCLE FLOW                                                */
/* ================================================================== */

describe("Full Lifecycle Flow", () => {
  beforeEach(() => {
    resetIdCounter();
    resetPlanCounter();
    resetRollbackCounter();
    resetPmCounter();
    resetActionCounter();
  });

  it("happy path: detect → classify → triage → remediate → post-mortem → close", () => {
    // 1. Create
    let lc = createLifecycleIncident(makeInput());
    expect(lc.phase).toBe("detected");

    // 2. Classify
    let result = classifyIncident(lc, "operator");
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("classified");

    // 3. Triage
    result = triageIncident(lc, { triggeredBy: "operator", assignee: "sre" });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("triaged");

    // 4. Remediate
    result = planRemediation(lc, { lifecycleId: lc.id, triggeredBy: "operator" });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("remediating");

    // Simulate execution
    const sim = simulateRemediation(lc);
    lc = sim.incident;
    expect(lc.remediation!.status).toBe("completed");

    // 5. Post-mortem
    result = generatePostMortem(lc, {
      lifecycleId: lc.id,
      lessonsLearned: ["Use auto-scaling"],
      triggeredBy: "operator",
    });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("post-mortem");
    expect(lc.postMortem).not.toBeNull();

    // 6. Close
    result = closeLifecycle(lc, { triggeredBy: "operator" });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("closed");
    expect(lc.phaseHistory).toHaveLength(6); // detected→classified→triaged→remediating→post-mortem→closed
  });

  it("failure path: detect → classify → triage → remediate (fail) → rollback → post-mortem → close", async () => {
    let lc = createLifecycleIncident(makeInput());

    let result = classifyIncident(lc, "system");
    lc = (result as any).incident;

    result = triageIncident(lc, { triggeredBy: "system" });
    lc = (result as any).incident;

    result = planRemediation(lc, { lifecycleId: lc.id, triggeredBy: "system" });
    lc = (result as any).incident;

    // Execute remediation — fails on step 2
    let callCount = 0;
    const execResult = await executeRemediation(lc, async () => {
      callCount++;
      if (callCount >= 2) return { success: false, error: "API timeout" };
      return { success: true };
    });
    expect(execResult.success).toBe(false);
    lc = execResult.incident;

    // Rollback
    result = planRollback(lc, {
      lifecycleId: lc.id,
      reason: "Remediation failed at step 2",
      triggeredBy: "system",
    });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("rolling-back");

    // Execute rollback — succeeds
    const rbResult = await executeRollback(lc, async () => ({
      success: true,
      output: "rolled back",
    }));
    expect(rbResult.success).toBe(true);
    lc = rbResult.incident;

    // Post-mortem
    result = generatePostMortem(lc, {
      lifecycleId: lc.id,
      lessonsLearned: ["Add retry logic to API calls"],
      triggeredBy: "system",
    });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.postMortem!.remediationReview.rollbackNeeded).toBe(true);
    expect(lc.postMortem!.remediationReview.successful).toBe(false);

    // Close
    result = closeLifecycle(lc, { triggeredBy: "system" });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("closed");
  });

  it("shortcut path: detect → classify → triage → close (false alarm)", () => {
    let lc = createLifecycleIncident(makeInput());
    let result = classifyIncident(lc, "system");
    lc = (result as any).incident;
    result = triageIncident(lc, { triggeredBy: "system" });
    lc = (result as any).incident;
    result = closeLifecycle(lc, { triggeredBy: "operator", reason: "False alarm" });
    expect(result.success).toBe(true);
    lc = (result as any).incident;
    expect(lc.phase).toBe("closed");
  });
});

/* ================================================================== */
/*  AGENT TOOLS                                                        */
/* ================================================================== */

describe("Agent Tools", () => {
  beforeEach(() => {
    resetIdCounter();
    resetPlanCounter();
    resetRollbackCounter();
    resetPmCounter();
    resetActionCounter();
    clearStore();
  });

  function findTool(name: string): {
    name: string;
    execute: (input: any) => Promise<any>;
  } {
    const tools = createLifecycleTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool as { name: string; execute: (input: any) => Promise<any> };
  }

  it("lifecycle_create creates lifecycle", async () => {
    const tool = findTool("lifecycle_create");
    const result = await tool.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "operator",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.lifecycleId).toBeTruthy();
    expect(data.phase).toBe("detected");
    expect(getStore().size).toBe(1);
  });

  it("lifecycle_classify classifies incident", async () => {
    const create = findTool("lifecycle_create");
    const res = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res.content[0].text);

    const classify = findTool("lifecycle_classify");
    const result = await classify.execute({ lifecycleId });
    const data = JSON.parse(result.content[0].text);
    expect(data.phase).toBe("classified");
    expect(data.classification.category).toBeDefined();
  });

  it("lifecycle_triage triages incident", async () => {
    const create = findTool("lifecycle_create");
    const res1 = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res1.content[0].text);

    await findTool("lifecycle_classify").execute({ lifecycleId });

    const triage = findTool("lifecycle_triage");
    const result = await triage.execute({ lifecycleId, assignee: "alice" });
    const data = JSON.parse(result.content[0].text);
    expect(data.phase).toBe("triaged");
    expect(data.triage.assignee).toBe("alice");
  });

  it("lifecycle_remediate plans remediation with dry-run default", async () => {
    const create = findTool("lifecycle_create");
    const res1 = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res1.content[0].text);

    await findTool("lifecycle_classify").execute({ lifecycleId });
    await findTool("lifecycle_triage").execute({ lifecycleId });

    const remTool = findTool("lifecycle_remediate");
    const result = await remTool.execute({ lifecycleId });
    const data = JSON.parse(result.content[0].text);
    expect(data.dryRun).toBe(true);
    expect(data.remediation.status).toBe("completed"); // simulated
    expect(data.remediation.steps.length).toBeGreaterThan(0);
  });

  it("lifecycle_rollback plans rollback", async () => {
    const create = findTool("lifecycle_create");
    const res1 = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res1.content[0].text);

    await findTool("lifecycle_classify").execute({ lifecycleId });
    await findTool("lifecycle_triage").execute({ lifecycleId });
    await findTool("lifecycle_remediate").execute({ lifecycleId, dryRun: false });

    const rbTool = findTool("lifecycle_rollback");
    const result = await rbTool.execute({
      lifecycleId,
      reason: "remediation caused issues",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.phase).toBe("rolling-back");
    expect(data.rollback.steps.length).toBeGreaterThan(0);
  });

  it("lifecycle_postmortem generates report", async () => {
    const create = findTool("lifecycle_create");
    const res1 = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res1.content[0].text);

    await findTool("lifecycle_classify").execute({ lifecycleId });
    await findTool("lifecycle_triage").execute({ lifecycleId });
    await findTool("lifecycle_remediate").execute({ lifecycleId, dryRun: false });

    const pmTool = findTool("lifecycle_postmortem");
    const result = await pmTool.execute({
      lifecycleId,
      lessonsLearned: ["Better testing needed"],
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.phase).toBe("post-mortem");
    expect(data.postMortem.actionItemCount).toBeGreaterThan(0);
    expect(data.postMortem.rootCause.summary).toBeTruthy();
  });

  it("lifecycle_close closes after post-mortem", async () => {
    const create = findTool("lifecycle_create");
    const res1 = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res1.content[0].text);

    await findTool("lifecycle_classify").execute({ lifecycleId });
    await findTool("lifecycle_triage").execute({ lifecycleId });
    await findTool("lifecycle_remediate").execute({ lifecycleId, dryRun: false });
    await findTool("lifecycle_postmortem").execute({ lifecycleId });

    const closeTool = findTool("lifecycle_close");
    const result = await closeTool.execute({ lifecycleId, reason: "All done" });
    const data = JSON.parse(result.content[0].text);
    expect(data.phase).toBe("closed");
  });

  it("lifecycle_dashboard shows aggregated stats", async () => {
    const create = findTool("lifecycle_create");
    await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    await create.execute({
      incident: JSON.stringify(makeSnapshot({ cloud: "azure", severity: 1 })),
      initiatedBy: "op",
    });

    const dashTool = findTool("lifecycle_dashboard");
    const result = await dashTool.execute({});
    const data = JSON.parse(result.content[0].text);
    expect(data.dashboard.total).toBe(2);
    expect(data.dashboard.activeIncidents).toBe(2);
    expect(data.incidents).toHaveLength(2);
  });

  it("returns error for unknown lifecycle ID", async () => {
    const tool = findTool("lifecycle_classify");
    const result = await tool.execute({ lifecycleId: "nonexistent" });
    expect(result.content[0].text).toContain("Error");
  });

  it("returns error for invalid JSON input", async () => {
    const tool = findTool("lifecycle_create");
    const result = await tool.execute({
      incident: "not-json",
      initiatedBy: "op",
    });
    expect(result.content[0].text).toContain("Error");
  });

  it("rejects invalid remediation strategy", async () => {
    const create = findTool("lifecycle_create");
    const res1 = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res1.content[0].text);

    await findTool("lifecycle_classify").execute({ lifecycleId });
    await findTool("lifecycle_triage").execute({ lifecycleId });

    const remTool = findTool("lifecycle_remediate");
    const result = await remTool.execute({ lifecycleId, strategy: "bogus-strategy" });
    expect(result.content[0].text).toContain("Invalid remediation strategy");
  });

  it("rejects invalid rollback strategy", async () => {
    const create = findTool("lifecycle_create");
    const res1 = await create.execute({
      incident: JSON.stringify(makeSnapshot()),
      initiatedBy: "op",
    });
    const { lifecycleId } = JSON.parse(res1.content[0].text);

    await findTool("lifecycle_classify").execute({ lifecycleId });
    await findTool("lifecycle_triage").execute({ lifecycleId });
    await findTool("lifecycle_remediate").execute({ lifecycleId, dryRun: false });

    const rbTool = findTool("lifecycle_rollback");
    const result = await rbTool.execute({
      lifecycleId,
      reason: "test",
      strategy: "not-a-real-strategy",
    });
    expect(result.content[0].text).toContain("Invalid rollback strategy");
  });

  it("exposes 8 tools", () => {
    const tools = createLifecycleTools();
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name);
    expect(names).toContain("lifecycle_create");
    expect(names).toContain("lifecycle_classify");
    expect(names).toContain("lifecycle_triage");
    expect(names).toContain("lifecycle_remediate");
    expect(names).toContain("lifecycle_rollback");
    expect(names).toContain("lifecycle_postmortem");
    expect(names).toContain("lifecycle_close");
    expect(names).toContain("lifecycle_dashboard");
  });
});
