/**
 * Tests for post-deploy verification.
 */

import { describe, it, expect } from "vitest";
import { verify, formatReport } from "./verifier.js";
import type { OrchestrationResult, StepExecutionResult } from "../orchestration/types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeStep(overrides?: Partial<StepExecutionResult>): StepExecutionResult {
  return {
    stepId: "step-1" as any,
    stepName: "Test Step",
    stepType: "create-resource-group",
    status: "succeeded",
    durationMs: 100,
    outputs: { resourceGroupName: "rg-test" },
    ...overrides,
  };
}

function makeResult(overrides?: Partial<OrchestrationResult>): OrchestrationResult {
  return {
    planId: "plan-1",
    planName: "Test Plan",
    status: "succeeded",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    totalDurationMs: 5000,
    steps: [makeStep()],
    outputs: {},
    errors: [],
    ...overrides,
  };
}

// =============================================================================
// verify — orchestration-level checks
// =============================================================================

describe("verify — orchestration status", () => {
  it("returns healthy for succeeded orchestration", () => {
    const result = makeResult();
    const report = verify(result);

    expect(report.status).toBe("healthy");
    expect(report.healthScore).toBeGreaterThanOrEqual(0.9);
    expect(report.checks.some((c) => c.name === "Orchestration completed successfully" && c.status === "pass")).toBe(true);
  });

  it("returns unhealthy for failed orchestration", () => {
    const result = makeResult({ status: "failed", errors: ["Something went wrong"] });
    const report = verify(result);

    expect(report.status).not.toBe("healthy");
    expect(report.checks.some((c) => c.status === "fail")).toBe(true);
  });

  it("includes error messages in failed check", () => {
    const result = makeResult({ status: "failed", errors: ["Quota exceeded"] });
    const report = verify(result);

    const failCheck = report.checks.find((c) => c.name === "Orchestration completed successfully");
    expect(failCheck).toBeDefined();
    expect(failCheck!.message).toContain("Quota exceeded");
  });
});

// =============================================================================
// verify — step-level checks
// =============================================================================

describe("verify — step completion", () => {
  it("marks succeeded steps as pass", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "rg" as any, stepName: "Create RG", stepType: "create-resource-group", status: "succeeded" }),
      ],
    });
    const report = verify(result);
    const stepCheck = report.checks.find((c) => c.stepId === "rg" && c.status === "pass");
    expect(stepCheck).toBeDefined();
  });

  it("marks failed steps as fail with remediation", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "rg" as any, stepName: "Create RG", status: "failed", error: "Resource already exists" }),
      ],
    });
    const report = verify(result);

    const failCheck = report.checks.find((c) => c.stepId === "rg" && c.status === "fail");
    expect(failCheck).toBeDefined();
    expect(failCheck!.remediation).toContain("already exists");
  });

  it("marks skipped steps as skip", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "optional" as any, stepName: "Optional Step", status: "skipped" }),
      ],
    });
    const report = verify(result);

    const skipCheck = report.checks.find((c) => c.stepId === "optional" && c.status === "skip");
    expect(skipCheck).toBeDefined();
  });

  it("marks rolled-back steps as warn", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "rolled" as any, stepName: "Rolled Step", status: "rolled-back" }),
      ],
    });
    const report = verify(result);

    const warnCheck = report.checks.find((c) => c.stepId === "rolled" && c.status === "warn");
    expect(warnCheck).toBeDefined();
  });

  it("provides quota remediation for quota errors", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "s1" as any, status: "failed", error: "quota limit exceeded" }),
      ],
    });
    const report = verify(result);

    const failCheck = report.checks.find((c) => c.stepId === "s1" && c.status === "fail");
    expect(failCheck!.remediation).toContain("quota");
  });
});

// =============================================================================
// verify — resource output checks
// =============================================================================

describe("verify — resource outputs", () => {
  it("passes when all expected outputs are present", () => {
    const result = makeResult({
      steps: [
        makeStep({
          stepId: "storage" as any,
          stepType: "create-storage-account",
          stepName: "Create Storage",
          outputs: { accountName: "st123", connectionString: "DefaultEndpoint=..." },
        }),
      ],
    });
    const report = verify(result);

    const outputCheck = report.checks.find((c) => c.name.includes("outputs") && c.stepId === "storage");
    expect(outputCheck).toBeDefined();
    expect(outputCheck!.status).toBe("pass");
  });

  it("warns when expected outputs are missing", () => {
    const result = makeResult({
      steps: [
        makeStep({
          stepId: "storage" as any,
          stepType: "create-storage-account",
          stepName: "Create Storage",
          outputs: { accountName: "st123" },
        }),
      ],
    });
    const report = verify(result);

    const outputCheck = report.checks.find((c) => c.name.includes("outputs") && c.stepId === "storage");
    expect(outputCheck).toBeDefined();
    expect(outputCheck!.status).toBe("warn");
    expect(outputCheck!.message).toContain("connectionString");
  });
});

// =============================================================================
// verify — cross-cutting concerns
// =============================================================================

describe("verify — cross-cutting concerns", () => {
  it("warns about missing monitoring for compute resources", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepType: "create-resource-group" }),
        makeStep({ stepId: "webapp" as any, stepType: "create-web-app", stepName: "Create Web App" }),
      ],
    });
    const report = verify(result);

    const monitorCheck = report.checks.find((c) => c.name === "Monitoring coverage");
    expect(monitorCheck).toBeDefined();
    expect(monitorCheck!.status).toBe("warn");
  });

  it("passes monitoring check when App Insights is present", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepType: "create-resource-group" }),
        makeStep({ stepId: "webapp" as any, stepType: "create-web-app", stepName: "Create Web App" }),
        makeStep({ stepId: "insights" as any, stepType: "create-app-insights", stepName: "Create App Insights" }),
      ],
    });
    const report = verify(result);

    const monitorCheck = report.checks.find((c) => c.name === "Monitoring coverage");
    expect(monitorCheck).toBeDefined();
    expect(monitorCheck!.status).toBe("pass");
  });

  it("warns about missing Key Vault when database is present", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepType: "create-resource-group" }),
        makeStep({ stepId: "sql" as any, stepType: "create-sql-server", stepName: "Create SQL Server" }),
      ],
    });
    const report = verify(result);

    const secretCheck = report.checks.find((c) => c.name === "Secret management");
    expect(secretCheck).toBeDefined();
    expect(secretCheck!.status).toBe("warn");
  });

  it("warns about deployment duration over 10 minutes", () => {
    const result = makeResult({ totalDurationMs: 700_000 });
    const report = verify(result);

    const durationCheck = report.checks.find((c) => c.name === "Deployment duration");
    expect(durationCheck).toBeDefined();
    expect(durationCheck!.status).toBe("warn");
  });
});

// =============================================================================
// verify — connectivity checks
// =============================================================================

describe("verify — connectivity", () => {
  it("generates endpoint checks for web apps", () => {
    const result = makeResult({
      steps: [
        makeStep({
          stepId: "webapp" as any,
          stepType: "create-web-app",
          stepName: "Create Web App",
          outputs: { hostName: "app-test.azurewebsites.net", defaultUrl: "https://app-test.azurewebsites.net" },
        }),
      ],
    });
    const report = verify(result);

    const endpointCheck = report.checks.find((c) => c.name.includes("Endpoint reachable"));
    expect(endpointCheck).toBeDefined();
    expect(endpointCheck!.status).toBe("pass");
    expect(endpointCheck!.message).toContain("azurewebsites.net");
  });

  it("generates connectivity checks for container apps", () => {
    const result = makeResult({
      steps: [
        makeStep({
          stepId: "ca" as any,
          stepType: "create-container-app",
          stepName: "Create Container App",
          outputs: { fqdn: "ca-test.azurecontainerapps.io" },
        }),
      ],
    });
    const report = verify(result);

    const caCheck = report.checks.find((c) => c.name.includes("Container App reachable"));
    expect(caCheck).toBeDefined();
    expect(caCheck!.status).toBe("pass");
  });

  it("skips connectivity checks when skipProbes is true", () => {
    const result = makeResult({
      steps: [
        makeStep({
          stepId: "webapp" as any,
          stepType: "create-web-app",
          stepName: "Create Web App",
          outputs: { defaultUrl: "https://app-test.azurewebsites.net" },
        }),
      ],
    });
    const report = verify(result, { skipProbes: true });

    const endpointCheck = report.checks.find((c) => c.name.includes("Endpoint reachable"));
    expect(endpointCheck).toBeUndefined();
  });
});

// =============================================================================
// verify — step filter
// =============================================================================

describe("verify — step filter", () => {
  it("only verifies specified steps", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "rg" as any, stepName: "Create RG", stepType: "create-resource-group" }),
        makeStep({ stepId: "webapp" as any, stepName: "Create Web App", stepType: "create-web-app" }),
        makeStep({ stepId: "sql" as any, stepName: "Create SQL", stepType: "create-sql-server" }),
      ],
    });
    const report = verify(result, { stepFilter: ["rg"] });

    const stepChecks = report.checks.filter((c) => c.stepId);
    const stepIds = new Set(stepChecks.map((c) => c.stepId));
    expect(stepIds.has("rg")).toBe(true);
    expect(stepIds.has("webapp")).toBe(false);
    expect(stepIds.has("sql")).toBe(false);
  });
});

// =============================================================================
// verify — summary & score
// =============================================================================

describe("verify — summary and scoring", () => {
  it("computes correct health score", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "s1" as any, stepType: "create-resource-group", status: "succeeded" }),
        makeStep({ stepId: "s2" as any, stepType: "create-web-app", status: "succeeded", outputs: { hostName: "h", defaultUrl: "u" } }),
        makeStep({ stepId: "s3" as any, stepType: "create-app-insights", status: "succeeded", outputs: { connectionString: "cs", instrumentationKey: "ik" } }),
      ],
    });
    const report = verify(result);

    expect(report.healthScore).toBeGreaterThan(0);
    expect(report.healthScore).toBeLessThanOrEqual(1);
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.passed).toBeGreaterThan(0);
  });

  it("records verification timestamp and duration", () => {
    const report = verify(makeResult());

    expect(report.verifiedAt).toBeDefined();
    expect(new Date(report.verifiedAt).getTime()).not.toBeNaN();
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("generates a verdict string", () => {
    const report = verify(makeResult());
    expect(typeof report.verdict).toBe("string");
    expect(report.verdict.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// formatReport
// =============================================================================

describe("formatReport", () => {
  it("produces markdown output", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepType: "create-resource-group", status: "succeeded" }),
        makeStep({ stepId: "fail" as any, stepName: "Bad Step", stepType: "create-web-app", status: "failed", error: "oops" }),
      ],
    });
    const report = verify(result);
    const md = formatReport(report);

    expect(md).toContain("## Verification Report");
    expect(md).toContain("**Status:**");
    expect(md).toContain("**Checks:**");
    expect(md).toContain("Failed Checks");
  });

  it("includes remediation hints in formatted output", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "s1" as any, status: "failed", error: "already exists" }),
      ],
    });
    const report = verify(result);
    const md = formatReport(report);

    expect(md).toContain("_Remediation:_");
  });

  it("shows all-pass report correctly", () => {
    const report = verify(makeResult());
    const md = formatReport(report);

    expect(md).toContain("Passed Checks");
    expect(md).not.toContain("Failed Checks");
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("verify — edge cases", () => {
  it("handles empty steps array", () => {
    const result = makeResult({ steps: [] });
    const report = verify(result);

    expect(report.checks.length).toBeGreaterThan(0); // at least orchestration check
    expect(report.status).toBe("healthy");
  });

  it("handles mixed success/failure steps", () => {
    const result = makeResult({
      steps: [
        makeStep({ stepId: "s1" as any, status: "succeeded" }),
        makeStep({ stepId: "s2" as any, status: "failed", error: "err" }),
        makeStep({ stepId: "s3" as any, status: "skipped" }),
      ],
    });
    const report = verify(result);

    expect(report.summary.passed).toBeGreaterThan(0);
    expect(report.summary.failed).toBeGreaterThan(0);
    expect(report.summary.skipped).toBeGreaterThan(0);
  });
});
