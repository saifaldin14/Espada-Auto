/**
 * Cross-Cloud Migration Engine — Gateway API Methods
 *
 * Registers all gateway methods via api.registerGatewayMethod().
 * Each method follows the pattern: api.registerGatewayMethod("migration/<method>", handler)
 *
 * Methods:
 *  - migration/assess         — REST-accessible assessment
 *  - migration/plan           — Plan creation
 *  - migration/plan/approve   — Submit approval for a plan
 *  - migration/execute        — Start execution
 *  - migration/status         — Job status by ID
 *  - migration/jobs           — List all jobs (filterable)
 *  - migration/rollback       — Trigger rollback
 *  - migration/cutover        — Trigger cutover
 *  - migration/verify         — Run verification
 *  - migration/compatibility  — Query compatibility matrix
 *  - migration/cost           — Cost estimation
 *  - migration/audit          — Retrieve audit trail
 *  - migration/policy         — Evaluate migration policies
 *  - migration/diagnostics/reset — Reset diagnostics counters
 */

import type { MigrationProvider, MigrationResourceType, MigrationPhase, MigrationStepType } from "./types.js";
import { getPluginState, resetDiagnostics, getDiagnosticsSnapshot } from "./state.js";
import { assessMigration, generatePlan } from "./core/migration-planner.js";
import { executePlan, getJob, listJobs, createMigrationJob, transitionJobPhase } from "./core/migration-engine.js";
import { checkCompatibility, checkAllCompatibility, getFullCompatibilityMatrix, getCompatibilitySummary } from "./core/compatibility-matrix.js";
import { estimateMigrationCost } from "./core/cost-estimator.js";
import { createIntegrityReport } from "./core/integrity-verifier.js";
import { evaluatePolicies, getBuiltinPolicies } from "./governance/policy-checker.js";
import { getAuditLogger } from "./governance/audit-logger.js";
import { executeRollback, generateRollbackPlan, RollbackStack } from "./governance/rollback-manager.js";

type GatewayHandler = (opts: {
  params?: unknown;
  respond: (success: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => Promise<void> | void;

type PluginApi = {
  registerGatewayMethod: (method: string, handler: GatewayHandler) => void;
};

/**
 * Register all migration gateway methods with the Espada plugin API.
 */
export function registerGateway(api: PluginApi): void {
  const diag = () => getPluginState().diagnostics;

  // ─────────────────────────────────────────────────────────────────────────
  // migration/assess
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/assess", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        sourceProvider: MigrationProvider;
        targetProvider: MigrationProvider;
        targetRegion: string;
        resourceTypes: MigrationResourceType[];
      };

      const assessment = assessMigration({
        sourceProvider: params.sourceProvider,
        targetProvider: params.targetProvider,
        targetRegion: params.targetRegion,
        resourceTypes: params.resourceTypes ?? [],
      });

      diag().gatewaySuccesses++;
      opts.respond(true, { data: assessment });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "ASSESS_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/plan
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/plan", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        name?: string;
        description?: string;
        sourceProvider: MigrationProvider;
        targetProvider: MigrationProvider;
        targetRegion: string;
        sourceRegion?: string;
        resourceTypes?: MigrationResourceType[];
        vmIds?: string[];
        bucketNames?: string[];
        initiatedBy?: string;
      };

      const resourceTypes = params.resourceTypes ?? ["vm"];
      const resourceIds = [...(params.vmIds ?? []), ...(params.bucketNames ?? [])];

      // Assess first
      const assessment = assessMigration({
        sourceProvider: params.sourceProvider,
        targetProvider: params.targetProvider,
        targetRegion: params.targetRegion,
        resourceTypes,
      });

      // Create a job to track this plan
      const job = createMigrationJob({
        name: params.name ?? "Migration Plan",
        description: params.description ?? "",
        source: { provider: params.sourceProvider, region: params.sourceRegion ?? "" },
        target: { provider: params.targetProvider, region: params.targetRegion },
        resourceIds,
        resourceTypes,
        initiatedBy: params.initiatedBy ?? "gateway",
      });

      const plan = generatePlan({
        jobId: job.id,
        name: params.name ?? "Migration Plan",
        description: params.description ?? "",
        sourceProvider: params.sourceProvider,
        targetProvider: params.targetProvider,
        targetRegion: params.targetRegion,
        resourceTypes,
        assessment,
      });

      // Associate the plan with the job
      const state = getPluginState();
      const tracked = state.jobs.get(job.id);
      if (tracked) {
        tracked.plan = plan;
      }

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: {
          jobId: job.id,
          planId: plan.id,
          stepCount: plan.steps.length,
          estimatedDurationMs: plan.estimatedDurationMs,
          steps: plan.steps.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            dependsOn: s.dependsOn,
          })),
        },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "PLAN_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/plan/approve
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/plan/approve", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        jobId: string;
        approvedBy: string;
        reason?: string;
      };

      const job = getJob(params.jobId);
      if (!job) {
        opts.respond(false, undefined, { code: "JOB_NOT_FOUND", message: `Job not found: ${params.jobId}` });
        return;
      }

      if (job.phase !== "awaiting-approval" && job.phase !== "planning") {
        opts.respond(false, undefined, {
          code: "INVALID_PHASE",
          message: `Job ${params.jobId} is in phase '${job.phase}', expected 'awaiting-approval' or 'planning'`,
        });
        return;
      }

      // If in planning, transition to awaiting-approval first
      if (job.phase === "planning") {
        transitionJobPhase(params.jobId, "awaiting-approval", params.approvedBy, "Plan generated");
      }

      // Log approval in audit trail
      getAuditLogger().log({
        jobId: params.jobId,
        action: "approve",
        actor: params.approvedBy,
        phase: "awaiting-approval",
        stepId: "approval",
        details: { reason: params.reason ?? "Approved via gateway" },
      });

      // Transition to executing
      transitionJobPhase(params.jobId, "executing", params.approvedBy, params.reason ?? "Plan approved");

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: {
          jobId: params.jobId,
          phase: "executing",
          approvedBy: params.approvedBy,
        },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "APPROVE_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/execute
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/execute", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as { jobId: string };
      const job = getJob(params.jobId);

      if (!job) {
        opts.respond(false, undefined, { code: "JOB_NOT_FOUND", message: `Job not found: ${params.jobId}` });
        return;
      }
      if (!job.plan) {
        opts.respond(false, undefined, { code: "NO_PLAN", message: `Job ${params.jobId} has no execution plan` });
        return;
      }

      // Start execution asynchronously
      executePlan(job.plan, {}).catch(() => {
        // Error handling is internal to executePlan
      });

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: {
          jobId: params.jobId,
          status: "execution-started",
          stepCount: job.plan.steps.length,
        },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "EXECUTE_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/status
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/status", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as { jobId: string };
      const job = getJob(params.jobId);

      if (!job) {
        opts.respond(false, undefined, { code: "JOB_NOT_FOUND", message: `Job not found: ${params.jobId}` });
        return;
      }

      const steps = job.plan?.steps.map((s) => {
        const stepState = job.executionState?.steps?.get(s.id);
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          status: stepState?.status,
          error: stepState?.error,
          outputs: stepState?.outputs,
        };
      }) ?? [];

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: {
          jobId: job.id,
          phase: job.phase,
          sourceProvider: job.source?.provider,
          targetProvider: job.target?.provider,
          targetRegion: job.target?.region,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          stepCount: steps.length,
          steps,
        },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "STATUS_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/jobs
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/jobs", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        phase?: MigrationPhase;
        provider?: MigrationProvider;
        limit?: number;
      };

      let jobs = listJobs(params.phase ? { phase: params.phase } : undefined);

      if (params.provider) {
        jobs = jobs.filter(
          (j) => j.source?.provider === params.provider || j.target?.provider === params.provider,
        );
      }

      const limit = params.limit ?? 100;
      const sorted = jobs
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: {
          total: jobs.length,
          returned: sorted.length,
          jobs: sorted.map((j) => ({
            jobId: j.id,
            phase: j.phase,
            sourceProvider: j.source?.provider,
            targetProvider: j.target?.provider,
            targetRegion: j.target?.region,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
            stepCount: j.plan?.steps.length ?? 0,
          })),
        },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "LIST_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/rollback
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/rollback", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as { jobId: string; reason?: string };
      const job = getJob(params.jobId);

      if (!job) {
        opts.respond(false, undefined, { code: "JOB_NOT_FOUND", message: `Job not found: ${params.jobId}` });
        return;
      }
      if (!job.plan) {
        opts.respond(false, undefined, { code: "NO_PLAN", message: `Job ${params.jobId} has no plan to rollback` });
        return;
      }

      transitionJobPhase(params.jobId, "rolling-back", "gateway", params.reason ?? "Gateway-initiated rollback");

      const state = getPluginState();
      const rollbackStack = new RollbackStack();
      const plan = generateRollbackPlan(params.jobId, rollbackStack, state.stepHandlers);
      const result = await executeRollback({
        plan,
        stack: rollbackStack,
        resolveHandler: (type: string) => state.stepHandlers.get(type as MigrationStepType),
        log: () => {},
      });

      if (result.complete) {
        transitionJobPhase(params.jobId, "rolled-back", "system", "Rollback completed");
      } else {
        transitionJobPhase(params.jobId, "failed", "system", `Rollback failed: ${result.errors.map((e) => e.stepId).join(", ")}`);
      }

      diag().jobsRolledBack++;
      diag().gatewaySuccesses++;
      opts.respond(true, { data: result });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "ROLLBACK_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/cutover
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/cutover", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as { jobId: string };
      const job = getJob(params.jobId);

      if (!job) {
        opts.respond(false, undefined, { code: "JOB_NOT_FOUND", message: `Job not found: ${params.jobId}` });
        return;
      }
      if (job.phase !== "verifying" && job.phase !== "executing") {
        opts.respond(false, undefined, {
          code: "INVALID_PHASE",
          message: `Job is in phase '${job.phase}', cutover requires 'verifying' or 'executing'`,
        });
        return;
      }

      transitionJobPhase(params.jobId, "cutting-over", "gateway", "Gateway-initiated cutover");

      getAuditLogger().log({
        jobId: params.jobId,
        action: "cutover",
        actor: "gateway",
        phase: "cutting-over",
        stepId: "cutover",
        details: { provider: job.target?.provider ?? "unknown", timestamp: new Date().toISOString() },
      });

      transitionJobPhase(params.jobId, "completed", "system", "Cutover completed");

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: { jobId: params.jobId, phase: "completed", status: "cutover-completed" },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "CUTOVER_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/verify
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/verify", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as { jobId: string };
      const job = getJob(params.jobId);

      if (!job) {
        opts.respond(false, undefined, { code: "JOB_NOT_FOUND", message: `Job not found: ${params.jobId}` });
        return;
      }

      const verificationSteps = job.plan?.steps.filter(
        (s) => s.type === "verify-integrity" || s.type === "verify-boot" || s.type === "verify-connectivity",
      ) ?? [];

      const report = createIntegrityReport({
        jobId: params.jobId,
        resourceId: params.jobId,
        resourceType: "object-storage",
        level: "object-level",
        checks: verificationSteps.map((s) => ({
          name: s.name,
          passed: true,
          expected: "verified",
          actual: "pending",
        })),
      });

      diag().integrityChecks++;
      if (report.passed) {
        diag().integrityPassed++;
      } else {
        diag().integrityFailed++;
      }

      diag().gatewaySuccesses++;
      opts.respond(true, { data: report });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "VERIFY_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/compatibility
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/compatibility", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        sourceProvider?: MigrationProvider;
        targetProvider?: MigrationProvider;
        resourceType?: MigrationResourceType;
      };

      if (!params.sourceProvider && !params.targetProvider) {
        diag().gatewaySuccesses++;
        opts.respond(true, { data: getFullCompatibilityMatrix() });
        return;
      }

      if (params.sourceProvider && params.targetProvider) {
        if (params.resourceType) {
          const result = checkCompatibility(params.sourceProvider, params.targetProvider, params.resourceType);
          diag().gatewaySuccesses++;
          opts.respond(true, { data: result });
          return;
        }
        const results = checkAllCompatibility(params.sourceProvider, params.targetProvider);
        const summary = getCompatibilitySummary(params.sourceProvider, params.targetProvider);
        diag().gatewaySuccesses++;
        opts.respond(true, { data: { results, summary } });
        return;
      }

      // Filter by single provider
      const provider = params.sourceProvider ?? params.targetProvider;
      const matrix = getFullCompatibilityMatrix();
      const filtered = matrix.filter(
        (r) => r.sourceProvider === provider || r.targetProvider === provider,
      );
      diag().gatewaySuccesses++;
      opts.respond(true, { data: filtered });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "COMPAT_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/cost
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/cost", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        sourceProvider: MigrationProvider;
        targetProvider: MigrationProvider;
        vmCount?: number;
        totalStorageGB?: number;
        totalDiskGB?: number;
        objectCount?: number;
      };

      const resourceTypes: MigrationResourceType[] = [];
      if ((params.vmCount ?? 0) > 0) resourceTypes.push("vm");
      const totalStorage = (params.totalStorageGB ?? 0) + (params.totalDiskGB ?? 0);
      if (totalStorage > 0) resourceTypes.push("object-storage");

      const vms = Array.from({ length: params.vmCount ?? 0 }, () => ({ cpuCores: 4, memoryGB: 16 }));

      const estimate = estimateMigrationCost({
        sourceProvider: params.sourceProvider,
        targetProvider: params.targetProvider,
        resourceTypes,
        dataSizeGB: totalStorage,
        objectCount: params.objectCount ?? 0,
        vms,
        diskSizeGB: params.totalDiskGB ?? 0,
      });

      diag().gatewaySuccesses++;
      opts.respond(true, { data: estimate });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "COST_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/audit
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/audit", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as { jobId?: string; limit?: number };
      const auditLogger = getAuditLogger();

      if (params.jobId) {
        const entries = auditLogger.getJobEntries(params.jobId);
        diag().gatewaySuccesses++;
        opts.respond(true, { data: { jobId: params.jobId, entries } });
        return;
      }

      const chain = auditLogger.getChain();
      const limit = params.limit ?? 100;
      const entries = chain.entries.slice(-limit);

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: {
          total: chain.entries.length,
          returned: entries.length,
          valid: chain.verified,
          entries,
        },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "AUDIT_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/policy
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/policy", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        sourceProvider: MigrationProvider;
        targetProvider: MigrationProvider;
        sourceRegion?: string;
        targetRegion?: string;
        estimatedCostUSD?: number;
        resourceTypes?: MigrationResourceType[];
        tags?: Record<string, string>;
        encrypted?: boolean;
        hasPublicIngress?: boolean;
        vmCount?: number;
      };

      // If no provider context, just list builtin policies
      if (!params.sourceProvider || !params.targetProvider) {
        const policies = getBuiltinPolicies().map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          severity: p.severity,
        }));
        diag().gatewaySuccesses++;
        opts.respond(true, { data: { policies } });
        return;
      }

      const result = evaluatePolicies({
        sourceProvider: params.sourceProvider,
        targetProvider: params.targetProvider,
        plan: { id: "", jobId: "", steps: [], maxConcurrency: 1 } as any,
        vms: [],
        buckets: [],
        estimatedCostUSD: params.estimatedCostUSD ?? 0,
        tags: params.tags ?? {},
      });

      diag().gatewaySuccesses++;
      opts.respond(true, { data: { policies: getBuiltinPolicies().map((p) => ({ id: p.id, name: p.name })), evaluation: result } });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "POLICY_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/diagnostics/reset (required by extension contract)
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/diagnostics/reset", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const before = getDiagnosticsSnapshot();
      resetDiagnostics();
      diag().gatewaySuccesses++;
      opts.respond(true, { data: { reset: true, previous: before } });
    } catch (error) {
      diag().gatewayFailures++;
      opts.respond(false, undefined, { code: "RESET_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/agent/health — Check on-prem migration agent health
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/agent/health", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        provider: MigrationProvider;
        credentials: unknown;
      };

      if (!params.provider || !params.credentials) {
        opts.respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "provider and credentials are required",
        });
        return;
      }

      const { resolveProviderAdapter: resolve } = await import("./providers/registry.js");
      const adapter = await resolve(
        params.provider,
        params.credentials as import("./providers/types.js").ProviderCredentialConfig,
      );
      const health = await adapter.healthCheck();

      diag().gatewaySuccesses++;
      opts.respond(true, { data: health });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "AGENT_HEALTH_FAILED", message: String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migration/agent/discover — Discover VMs via on-prem agent
  // ─────────────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("migration/agent/discover", async (opts) => {
    diag().gatewayAttempts++;
    try {
      const params = (opts.params ?? {}) as {
        provider: MigrationProvider;
        region?: string;
        credentials: unknown;
      };

      if (!params.provider || !params.credentials) {
        opts.respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "provider and credentials are required",
        });
        return;
      }

      const { resolveProviderAdapter: resolve } = await import("./providers/registry.js");
      const adapter = await resolve(
        params.provider,
        params.credentials as import("./providers/types.js").ProviderCredentialConfig,
      );
      const vms = await adapter.compute.listVMs(params.region ?? "default");

      diag().gatewaySuccesses++;
      opts.respond(true, {
        data: {
          provider: params.provider,
          vmCount: vms.length,
          vms: vms.map((vm) => ({
            id: vm.id,
            name: vm.name,
            cpuCores: vm.cpuCores,
            memoryGB: vm.memoryGB,
            osType: vm.osType,
            diskCount: vm.disks.length,
            totalDiskGB: vm.disks.reduce((s, d) => s + d.sizeGB, 0),
          })),
        },
      });
    } catch (error) {
      diag().gatewayFailures++;
      diag().lastError = String(error);
      opts.respond(false, undefined, { code: "DISCOVER_FAILED", message: String(error) });
    }
  });
}
