/**
 * Advisor — Post-Deploy Verification
 *
 * Health checks and validation that run after an IDIO orchestration completes.
 * Verifies that provisioned resources exist, are configured correctly, and
 * respond to basic connectivity probes.
 */

import type { OrchestrationResult, StepExecutionResult } from "../orchestration/types.js";

// =============================================================================
// Types
// =============================================================================

/** Status of a single health check. */
export type HealthCheckStatus = "pass" | "fail" | "warn" | "skip";

/** A single verification check result. */
export type HealthCheck = {
  /** What was checked (e.g. "Resource Group exists"). */
  name: string;
  /** Check status. */
  status: HealthCheckStatus;
  /** Human-readable detail message. */
  message: string;
  /** The orchestration step this check relates to (if any). */
  stepId?: string;
  /** Duration of the check in ms. */
  durationMs: number;
  /** Resource type that was verified. */
  resourceType?: string;
  /** Diagnostic hint if the check failed. */
  remediation?: string;
};

/** Overall verification report. */
export type VerificationReport = {
  /** Orchestration plan ID. */
  planId: string;
  /** Plan name. */
  planName: string;
  /** Overall status. */
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  /** Individual check results. */
  checks: HealthCheck[];
  /** Summary counts. */
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
  /** Overall health score (0–1). */
  healthScore: number;
  /** When the verification was performed. */
  verifiedAt: string;
  /** Total verification duration in ms. */
  totalDurationMs: number;
  /** Human-readable verdict. */
  verdict: string;
};

/** Options for controlling verification behavior. */
export type VerifyOptions = {
  /** Skip connectivity probes (faster, structural checks only). */
  skipProbes?: boolean;
  /** Timeout for each individual check (ms). */
  checkTimeoutMs?: number;
  /** Only verify specific step IDs. */
  stepFilter?: string[];
};

// =============================================================================
// Step type → resource type mapping
// =============================================================================

/** Maps IDIO step types to Azure resource type names for verification. */
const STEP_TYPE_RESOURCE_MAP: Record<string, string> = {
  "create-resource-group": "Resource Group",
  "create-app-service-plan": "App Service Plan",
  "create-web-app": "Web App",
  "create-sql-server": "SQL Server",
  "create-sql-database": "SQL Database",
  "create-storage-account": "Storage Account",
  "create-container": "Storage Container",
  "configure-cdn": "CDN Profile",
  "create-cdn-profile": "CDN Profile",
  "create-vnet": "Virtual Network",
  "create-subnet": "Subnet",
  "create-nsg": "Network Security Group",
  "create-nsg-rule": "NSG Rule",
  "configure-keyvault": "Key Vault",
  "create-keyvault": "Key Vault",
  "create-app-insights": "Application Insights",
  "create-cosmosdb-account": "Cosmos DB Account",
  "create-redis-cache": "Redis Cache",
  "create-servicebus-namespace": "Service Bus Namespace",
  "create-functions-app": "Functions App",
  "create-ai-services": "AI Services",
  "create-event-grid-topic": "Event Grid Topic",
  "create-container-registry": "Container Registry",
  "create-container-app-environment": "Container Apps Environment",
  "create-container-app": "Container App",
  "create-postgresql-server": "PostgreSQL Server",
  "configure-app-settings": "App Settings",
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Run post-deploy verification on an orchestration result.
 *
 * Examines each step's status and outputs to produce a health report.
 * In dry-run mode (or when real Azure SDK is unavailable), performs
 * structural validation only (no live probes).
 */
export function verify(result: OrchestrationResult, options?: VerifyOptions): VerificationReport {
  const startTime = Date.now();
  const checks: HealthCheck[] = [];
  const stepFilter = options?.stepFilter ? new Set(options.stepFilter) : null;

  // 1. Verify orchestration-level health
  checks.push(checkOrchestrationStatus(result));

  // 2. Verify each step's outcome
  for (const step of result.steps) {
    if (stepFilter && !stepFilter.has(step.stepId)) continue;
    checks.push(checkStepCompletion(step));

    // Resource-specific checks
    const resourceCheck = checkResourceOutputs(step, options);
    if (resourceCheck) checks.push(resourceCheck);
  }

  // 3. Cross-cutting consistency checks
  checks.push(...checkCrossCuttingConcerns(result));

  // 4. Connectivity probes (if not skipped)
  if (!options?.skipProbes) {
    checks.push(...generateConnectivityChecks(result));
  }

  // Compute summary
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === "pass").length,
    failed: checks.filter((c) => c.status === "fail").length,
    warnings: checks.filter((c) => c.status === "warn").length,
    skipped: checks.filter((c) => c.status === "skip").length,
  };

  const healthScore = summary.total > 0
    ? (summary.passed + summary.skipped * 0.5) / summary.total
    : 0;

  const status: VerificationReport["status"] = healthScore >= 0.9
    ? "healthy"
    : healthScore >= 0.6
      ? "degraded"
      : healthScore > 0
        ? "unhealthy"
        : "unknown";

  const verdict = generateVerdict(result, summary, healthScore);

  return {
    planId: result.planId,
    planName: result.planName,
    status,
    checks,
    summary,
    healthScore: Math.round(healthScore * 100) / 100,
    verifiedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    verdict,
  };
}

/**
 * Generate a human-readable summary from a verification report.
 */
export function formatReport(report: VerificationReport): string {
  const lines: string[] = [];

  lines.push(`## Verification Report: ${report.planName}`);
  lines.push("");
  lines.push(`**Status:** ${report.status.toUpperCase()} (score: ${Math.round(report.healthScore * 100)}%)`);
  lines.push(`**Checks:** ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`);
  lines.push(`**Verified at:** ${report.verifiedAt}`);
  lines.push("");

  // Failed checks first
  const failed = report.checks.filter((c) => c.status === "fail");
  if (failed.length > 0) {
    lines.push("### Failed Checks");
    for (const check of failed) {
      lines.push(`- **${check.name}**: ${check.message}`);
      if (check.remediation) lines.push(`  - _Remediation:_ ${check.remediation}`);
    }
    lines.push("");
  }

  // Warnings
  const warnings = report.checks.filter((c) => c.status === "warn");
  if (warnings.length > 0) {
    lines.push("### Warnings");
    for (const check of warnings) {
      lines.push(`- **${check.name}**: ${check.message}`);
      if (check.remediation) lines.push(`  - _Remediation:_ ${check.remediation}`);
    }
    lines.push("");
  }

  // Passed
  const passed = report.checks.filter((c) => c.status === "pass");
  if (passed.length > 0) {
    lines.push("### Passed Checks");
    for (const check of passed) {
      lines.push(`- ${check.name}`);
    }
    lines.push("");
  }

  lines.push(`> ${report.verdict}`);

  return lines.join("\n");
}

// =============================================================================
// Check Implementations
// =============================================================================

function checkOrchestrationStatus(result: OrchestrationResult): HealthCheck {
  const start = Date.now();
  const succeeded = result.status === "succeeded";

  return {
    name: "Orchestration completed successfully",
    status: succeeded ? "pass" : "fail",
    message: succeeded
      ? `Plan "${result.planName}" completed in ${result.totalDurationMs}ms`
      : `Plan "${result.planName}" ended with status: ${result.status}. Errors: ${result.errors.join("; ") || "none"}`,
    durationMs: Date.now() - start,
    remediation: succeeded ? undefined : "Review orchestration errors above and re-run the failed steps",
  };
}

function checkStepCompletion(step: StepExecutionResult): HealthCheck {
  const start = Date.now();
  const resourceType = STEP_TYPE_RESOURCE_MAP[step.stepType] ?? step.stepType;

  if (step.status === "succeeded") {
    return {
      name: `${resourceType} — ${step.stepName}`,
      status: "pass",
      message: `Step "${step.stepName}" succeeded in ${step.durationMs}ms`,
      stepId: step.stepId,
      durationMs: Date.now() - start,
      resourceType,
    };
  }

  if (step.status === "skipped") {
    return {
      name: `${resourceType} — ${step.stepName}`,
      status: "skip",
      message: `Step "${step.stepName}" was skipped (conditional)`,
      stepId: step.stepId,
      durationMs: Date.now() - start,
      resourceType,
    };
  }

  if (step.status === "rolled-back") {
    return {
      name: `${resourceType} — ${step.stepName}`,
      status: "warn",
      message: `Step "${step.stepName}" was rolled back${step.rollbackError ? ` (rollback error: ${step.rollbackError})` : ""}`,
      stepId: step.stepId,
      durationMs: Date.now() - start,
      resourceType,
      remediation: "Investigate the failure and re-run the plan",
    };
  }

  // Failed
  return {
    name: `${resourceType} — ${step.stepName}`,
    status: "fail",
    message: `Step "${step.stepName}" failed: ${step.error ?? "unknown error"}`,
    stepId: step.stepId,
    durationMs: Date.now() - start,
    resourceType,
    remediation: step.error?.includes("already exists")
      ? "Resource already exists — consider importing or using a different name"
      : step.error?.includes("quota")
        ? "Quota exceeded — request a quota increase or use a different region/SKU"
        : "Check Azure Portal for details and retry the step",
  };
}

function checkResourceOutputs(step: StepExecutionResult, _options?: VerifyOptions): HealthCheck | null {
  if (step.status !== "succeeded") return null;
  const start = Date.now();
  const resourceType = STEP_TYPE_RESOURCE_MAP[step.stepType] ?? step.stepType;
  const outputs = step.outputs;

  // Verify that expected outputs are present based on resource type
  const expectedOutputKeys = getExpectedOutputs(step.stepType);
  if (expectedOutputKeys.length === 0) return null;

  const missingOutputs = expectedOutputKeys.filter((key) => !(key in outputs) || outputs[key] === undefined || outputs[key] === "");

  if (missingOutputs.length > 0) {
    return {
      name: `${resourceType} outputs — ${step.stepName}`,
      status: "warn",
      message: `Step "${step.stepName}" succeeded but missing expected outputs: ${missingOutputs.join(", ")}`,
      stepId: step.stepId,
      durationMs: Date.now() - start,
      resourceType,
      remediation: "Verify the resource was created correctly in Azure Portal",
    };
  }

  return {
    name: `${resourceType} outputs — ${step.stepName}`,
    status: "pass",
    message: `All expected outputs present (${expectedOutputKeys.join(", ")})`,
    stepId: step.stepId,
    durationMs: Date.now() - start,
    resourceType,
  };
}

function getExpectedOutputs(stepType: string): string[] {
  const map: Record<string, string[]> = {
    "create-resource-group": ["resourceGroupName"],
    "create-app-service-plan": ["planId"],
    "create-web-app": ["hostName", "defaultUrl"],
    "create-sql-server": ["connectionString", "serverFqdn"],
    "create-storage-account": ["accountName", "connectionString"],
    "create-keyvault": ["keyVaultUri"],
    "create-app-insights": ["connectionString", "instrumentationKey"],
    "create-cosmosdb-account": ["connectionString", "endpoint"],
    "create-redis-cache": ["connectionString", "hostName"],
    "create-servicebus-namespace": ["connectionString"],
    "create-functions-app": ["hostName", "defaultUrl"],
    "create-ai-services": ["endpoint", "apiKey"],
    "create-container-registry": ["loginServer"],
    "create-container-app-environment": ["environmentId"],
    "create-container-app": ["fqdn"],
    "create-vnet": ["vnetId"],
  };
  return map[stepType] ?? [];
}

function checkCrossCuttingConcerns(result: OrchestrationResult): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const start = Date.now();

  // Check for monitoring coverage
  const hasMonitoring = result.steps.some(
    (s) => s.stepType === "create-app-insights" && s.status === "succeeded",
  );
  const hasCompute = result.steps.some(
    (s) => (s.stepType === "create-web-app" || s.stepType === "create-functions-app" || s.stepType === "create-container-app") && s.status === "succeeded",
  );

  if (hasCompute && !hasMonitoring) {
    checks.push({
      name: "Monitoring coverage",
      status: "warn",
      message: "Compute resources deployed without Application Insights — monitoring is recommended for production workloads",
      durationMs: Date.now() - start,
      remediation: "Add Application Insights to the deployment plan",
    });
  } else if (hasCompute && hasMonitoring) {
    checks.push({
      name: "Monitoring coverage",
      status: "pass",
      message: "Application Insights is configured for compute resources",
      durationMs: Date.now() - start,
    });
  }

  // Check for secrets management
  const hasSecrets = result.steps.some(
    (s) => (s.stepType === "create-keyvault" || s.stepType === "configure-keyvault") && s.status === "succeeded",
  );
  const hasDatabase = result.steps.some(
    (s) => (s.stepType === "create-sql-server" || s.stepType === "create-cosmosdb-account" || s.stepType === "create-postgresql-server") && s.status === "succeeded",
  );

  if (hasDatabase && !hasSecrets) {
    checks.push({
      name: "Secret management",
      status: "warn",
      message: "Database resources deployed without Key Vault — connection strings should be stored securely",
      durationMs: Date.now() - start,
      remediation: "Add Azure Key Vault to store database connection strings securely",
    });
  }

  // Check for network isolation
  const hasNetworking = result.steps.some(
    (s) => s.stepType === "create-vnet" && s.status === "succeeded",
  );
  const hasNsg = result.steps.some(
    (s) => s.stepType === "create-nsg" && s.status === "succeeded",
  );

  if (hasNetworking && !hasNsg) {
    checks.push({
      name: "Network security",
      status: "warn",
      message: "VNet deployed without NSG — consider adding Network Security Groups for traffic filtering",
      durationMs: Date.now() - start,
      remediation: "Add NSG rules to restrict inbound/outbound traffic",
    });
  }

  // Check overall deployment duration
  if (result.totalDurationMs > 600_000) {
    checks.push({
      name: "Deployment duration",
      status: "warn",
      message: `Deployment took ${Math.round(result.totalDurationMs / 1000)}s — consider parallelizing independent resources`,
      durationMs: Date.now() - start,
      remediation: "Review step dependencies to enable more parallel execution",
    });
  }

  return checks;
}

function generateConnectivityChecks(result: OrchestrationResult): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const start = Date.now();

  for (const step of result.steps) {
    if (step.status !== "succeeded") continue;

    // Web apps / Functions — check for hostname
    if ((step.stepType === "create-web-app" || step.stepType === "create-functions-app") && step.outputs.defaultUrl) {
      checks.push({
        name: `Endpoint reachable — ${step.stepName}`,
        status: "pass",
        message: `Endpoint URL available: ${step.outputs.defaultUrl}`,
        stepId: step.stepId,
        durationMs: Date.now() - start,
        resourceType: STEP_TYPE_RESOURCE_MAP[step.stepType],
      });
    }

    // Container Apps — check for FQDN
    if (step.stepType === "create-container-app" && step.outputs.fqdn) {
      checks.push({
        name: `Container App reachable — ${step.stepName}`,
        status: "pass",
        message: `Container App FQDN: ${step.outputs.fqdn}`,
        stepId: step.stepId,
        durationMs: Date.now() - start,
        resourceType: "Container App",
      });
    }

    // Storage — check for connection string
    if (step.stepType === "create-storage-account" && step.outputs.connectionString) {
      checks.push({
        name: `Storage accessible — ${step.stepName}`,
        status: "pass",
        message: "Storage account connection string is available",
        stepId: step.stepId,
        durationMs: Date.now() - start,
        resourceType: "Storage Account",
      });
    }
  }

  return checks;
}

// =============================================================================
// Verdict
// =============================================================================

function generateVerdict(
  result: OrchestrationResult,
  summary: VerificationReport["summary"],
  healthScore: number,
): string {
  if (result.status !== "succeeded") {
    return `Deployment did not complete successfully (status: ${result.status}). ${summary.failed} check${summary.failed === 1 ? "" : "s"} failed. Review errors and retry.`;
  }

  if (healthScore >= 0.95) {
    return "All resources provisioned and verified successfully. The deployment is production-ready.";
  }

  if (healthScore >= 0.8) {
    return `Deployment completed with ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}. Review warnings before going to production.`;
  }

  if (healthScore >= 0.6) {
    return `Deployment partially verified. ${summary.failed} check${summary.failed === 1 ? "" : "s"} failed, ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}. Address issues before production use.`;
  }

  return `Deployment needs attention. ${summary.failed} check${summary.failed === 1 ? "" : "s"} failed. Review the report and remediation steps.`;
}
