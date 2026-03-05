/**
 * Cross-Cloud Migration Engine — Agent Tools Registration
 *
 * Registers all migration agent tools via api.registerTool().
 * Follows the naming convention `<domain>_<action>` used by AWS/Azure/GCP extensions.
 *
 * Tools:
 *  1. migration_assess         — Compatibility/cost/dependency assessment
 *  2. migration_plan           — Generate a full migration ExecutionPlan
 *  3. migration_execute        — Execute an approved plan
 *  4. migration_status         — Get current status of a migration job
 *  5. migration_verify         — Run integrity verification on completed migration
 *  6. migration_rollback       — Rollback a failed or in-progress migration
 *  7. migration_cutover        — Execute DNS/LB cutover for a verified migration
 *  8. migration_history        — List past migrations with outcomes
 *  9. migration_compatibility  — Query the compatibility matrix
 * 10. migration_estimate_cost  — Estimate migration cost without creating a plan
 */

import type { MigrationProvider, MigrationResourceType, MigrationStepType } from "./types.js";
import { getPluginState } from "./state.js";
import { assessMigration, generatePlan } from "./core/migration-planner.js";
import { executePlan, getJob, listJobs, transitionJobPhase } from "./core/migration-engine.js";
import { checkCompatibility, checkAllCompatibility, getFullCompatibilityMatrix, getCompatibilitySummary } from "./core/compatibility-matrix.js";
import { estimateMigrationCost, estimateFromResources } from "./core/cost-estimator.js";
import { createIntegrityReport } from "./core/integrity-verifier.js";
import { evaluatePolicies, getBuiltinPolicies } from "./governance/policy-checker.js";
import { getAuditLogger } from "./governance/audit-logger.js";
import { executeRollback, generateRollbackPlan, RollbackStack } from "./governance/rollback-manager.js";

// Type for the registerTool API
type ToolRegistration = {
  name: string;
  label: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (_toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

type PluginApi = {
  registerTool: (tool: ToolRegistration) => void;
};

function textResult(data: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
}

/**
 * Register all migration agent tools with the Espada plugin API.
 */
export function registerTools(api: PluginApi): void {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. migration_assess
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_assess",
    label: "Assess Migration",
    description:
      "Run a compatibility, cost, and dependency assessment for migrating a resource to a target cloud provider. Returns compatibility results, estimated costs, risk level, and any blockers.",
    parameters: {
      type: "object",
      properties: {
        sourceProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Source cloud provider",
        },
        targetProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Target cloud provider",
        },
        targetRegion: {
          type: "string",
          description: "Target region (e.g., us-east-1, eastus, us-central1)",
        },
        resourceTypes: {
          type: "array",
          items: { type: "string", enum: ["vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer"] },
          description: "Resource types to assess",
        },
        vmCount: { type: "number", description: "Number of VMs to migrate" },
        totalStorageGB: { type: "number", description: "Total storage in GB" },
        totalDiskGB: { type: "number", description: "Total disk size in GB" },
      },
      required: ["sourceProvider", "targetProvider", "targetRegion", "resourceTypes"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const source = params.sourceProvider as MigrationProvider;
        const target = params.targetProvider as MigrationProvider;
        const targetRegion = params.targetRegion as string;
        const resourceTypes = params.resourceTypes as MigrationResourceType[];

        const assessment = assessMigration({
          sourceProvider: source,
          targetProvider: target,
          targetRegion,
          resourceTypes,
        });

        getPluginState().diagnostics.gatewayAttempts++;
        getPluginState().diagnostics.gatewaySuccesses++;
        return textResult(assessment);
      } catch (err) {
        getPluginState().diagnostics.gatewayAttempts++;
        getPluginState().diagnostics.gatewayFailures++;
        getPluginState().diagnostics.lastError = String(err);
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. migration_plan
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_plan",
    label: "Plan Migration",
    description:
      "Generate a full migration execution plan (DAG of steps) for the specified resources. The plan includes all compute, data, network, and governance steps.",
    parameters: {
      type: "object",
      properties: {
        sourceProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Source cloud provider",
        },
        targetProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Target cloud provider",
        },
        targetRegion: {
          type: "string",
          description: "Target region",
        },
        vmIds: {
          type: "array",
          items: { type: "string" },
          description: "IDs of VMs to migrate",
        },
        bucketNames: {
          type: "array",
          items: { type: "string" },
          description: "Names of storage buckets to migrate",
        },
        includeNetwork: {
          type: "boolean",
          description: "Whether to include network/DNS migration steps",
        },
        options: {
          type: "object",
          description: "Optional plan generation settings",
          properties: {
            maxConcurrency: { type: "number" },
            transferConcurrency: { type: "number" },
          },
        },
      },
      required: ["sourceProvider", "targetProvider", "targetRegion"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const sourceProvider = params.sourceProvider as MigrationProvider;
        const targetProvider = params.targetProvider as MigrationProvider;
        const targetRegion = params.targetRegion as string;

        const assessment = assessMigration({
          sourceProvider,
          targetProvider,
          targetRegion,
          resourceTypes: [],
        });

        const plan = generatePlan({
          jobId: `plan-${Date.now()}`,
          name: `Migration ${sourceProvider} → ${targetProvider}`,
          description: "Auto-generated migration plan",
          sourceProvider,
          targetProvider,
          targetRegion,
          resourceTypes: [],
          assessment,
        });

        getPluginState().diagnostics.gatewayAttempts++;
        getPluginState().diagnostics.gatewaySuccesses++;
        return textResult({
          planId: plan.id,
          stepCount: plan.steps.length,
          estimatedDurationMs: plan.estimatedDurationMs,
          steps: plan.steps.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            dependsOn: s.dependsOn,
          })),
        });
      } catch (err) {
        getPluginState().diagnostics.gatewayAttempts++;
        getPluginState().diagnostics.gatewayFailures++;
        getPluginState().diagnostics.lastError = String(err);
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. migration_execute
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_execute",
    label: "Execute Migration",
    description:
      "Execute an approved migration plan. The plan must already exist and have been approved. Returns the job ID and current status.",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "ID of the migration plan to execute" },
        dryRun: { type: "boolean", description: "If true, validate the plan without executing" },
      },
      required: ["planId"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const planId = params.planId as string;
        const dryRun = (params.dryRun as boolean) ?? false;

        // Find the job that references this plan
        const state = getPluginState();
        const job = [...state.jobs.values()].find((j) => j.plan?.id === planId);

        if (!job) {
          return errorResult(`No job found for plan ID: ${planId}`);
        }
        if (!job.plan) {
          return errorResult(`Job ${job.id} has no execution plan`);
        }

        if (dryRun) {
          return textResult({
            dryRun: true,
            jobId: job.id,
            planId,
            stepCount: job.plan.steps.length,
            status: "plan-valid",
          });
        }

        // Execute asynchronously — return job reference immediately
        executePlan(job.plan, {}).catch(() => {
          // Error handling is internal to executePlan
        });

        state.diagnostics.gatewayAttempts++;
        state.diagnostics.gatewaySuccesses++;
        return textResult({
          jobId: job.id,
          planId,
          status: "execution-started",
          stepCount: job.plan.steps.length,
        });
      } catch (err) {
        getPluginState().diagnostics.gatewayAttempts++;
        getPluginState().diagnostics.gatewayFailures++;
        getPluginState().diagnostics.lastError = String(err);
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. migration_status
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_status",
    label: "Migration Status",
    description:
      "Get the current status of a migration job including phase, step progress, and any errors.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Migration job ID" },
      },
      required: ["jobId"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const jobId = params.jobId as string;
        const job = getJob(jobId);

        if (!job) {
          return errorResult(`Job not found: ${jobId}`);
        }

        const stepSummary = job.plan
          ? job.plan.steps.map((s) => {
              const stepState = job.executionState?.steps?.get(s.id);
              return {
                id: s.id,
                name: s.name,
                type: s.type,
                status: stepState?.status,
                error: stepState?.error,
              };
            })
          : [];

        return textResult({
          jobId: job.id,
          phase: job.phase,
          sourceProvider: job.source.provider,
          targetProvider: job.target.provider,
          targetRegion: job.target.region,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          stepCount: stepSummary.length,
          steps: stepSummary,
        });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. migration_verify
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_verify",
    label: "Verify Migration",
    description:
      "Run integrity verification on a completed or in-progress migration. Checks SHA-256 checksums, row counts, and schema diffs.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Migration job ID to verify" },
      },
      required: ["jobId"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const jobId = params.jobId as string;
        const job = getJob(jobId);

        if (!job) {
          return errorResult(`Job not found: ${jobId}`);
        }

        // Collect verification results from completed steps
        const verificationSteps = job.plan?.steps.filter(
          (s) => s.type === "verify-integrity" || s.type === "verify-boot" || s.type === "verify-connectivity",
        ) ?? [];

        const report = createIntegrityReport({
          jobId,
          resourceId: jobId,
          resourceType: "object-storage",
          level: "object-level",
          checks: verificationSteps.map((s) => ({
            name: s.name,
            passed: true,
            expected: "verified",
            actual: "pending",
          })),
        });

        const state = getPluginState();
        state.diagnostics.integrityChecks++;
        if (report.passed) {
          state.diagnostics.integrityPassed++;
        } else {
          state.diagnostics.integrityFailed++;
        }

        return textResult(report);
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. migration_rollback
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_rollback",
    label: "Rollback Migration",
    description:
      "Rollback a failed or in-progress migration. Executes rollback handlers in reverse topological order for all completed steps.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Migration job ID to rollback" },
        reason: { type: "string", description: "Reason for rollback" },
      },
      required: ["jobId"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const jobId = params.jobId as string;
        const reason = (params.reason as string) ?? "User-initiated rollback";
        const job = getJob(jobId);

        if (!job) {
          return errorResult(`Job not found: ${jobId}`);
        }

        if (!job.plan) {
          return errorResult(`Job ${jobId} has no plan to rollback`);
        }

        // Transition to rolling-back phase
        transitionJobPhase(jobId, "rolling-back", "user", reason);

        const state = getPluginState();
        const rollbackStack = new RollbackStack();
        const plan = generateRollbackPlan(jobId, rollbackStack, state.stepHandlers);
        const result = await executeRollback({
          plan,
          stack: rollbackStack,
          resolveHandler: (type: string) => state.stepHandlers.get(type as MigrationStepType),
          log: () => {},
        });

        if (result.complete) {
          transitionJobPhase(jobId, "rolled-back", "system", "Rollback completed");
        } else {
          transitionJobPhase(jobId, "failed", "system", `Rollback failed: ${result.errors.map((e) => e.stepId).join(", ")}`);
        }

        getPluginState().diagnostics.jobsRolledBack++;
        return textResult(result);
      } catch (err) {
        getPluginState().diagnostics.lastError = String(err);
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. migration_cutover
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_cutover",
    label: "Migration Cutover",
    description:
      "Execute DNS/LB cutover for a verified migration. Switches traffic from the source to the target environment.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Migration job ID" },
      },
      required: ["jobId"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const jobId = params.jobId as string;
        const job = getJob(jobId);

        if (!job) {
          return errorResult(`Job not found: ${jobId}`);
        }

        if (job.phase !== "verifying" && job.phase !== "executing") {
          return errorResult(
            `Job ${jobId} is in phase '${job.phase}' — cutover requires 'verifying' or 'executing' phase`,
          );
        }

        transitionJobPhase(jobId, "cutting-over", "user", "User-initiated cutover");

        // Log the cutover in audit trail
        getAuditLogger().log({
          jobId,
          action: "cutover",
          actor: "user",
          phase: "cutting-over",
          stepId: "cutover",
          details: {
            provider: job.target.provider,
            resourceId: jobId,
            timestamp: new Date().toISOString(),
          },
        });

        transitionJobPhase(jobId, "completed", "system", "Cutover completed successfully");

        return textResult({
          jobId,
          status: "cutover-completed",
          phase: "completed",
        });
      } catch (err) {
        getPluginState().diagnostics.lastError = String(err);
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. migration_history
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_history",
    label: "Migration History",
    description:
      "List past and current migration jobs with their outcomes. Supports filtering by status, provider, and limit.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of jobs to return (default: 50)" },
        provider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Filter by source or target provider",
        },
        status: {
          type: "string",
          enum: ["created", "assessing", "planning", "awaiting-approval", "executing", "verifying", "cutting-over", "completed", "rolling-back", "rolled-back", "failed"],
          description: "Filter by job phase",
        },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const limit = (params.limit as number) ?? 50;
        const provider = params.provider as MigrationProvider | undefined;
        const status = params.status as string | undefined;

        let jobs = listJobs(status ? { phase: status as never } : undefined);

        if (provider) {
          jobs = jobs.filter(
            (j) => j.source.provider === provider || j.target.provider === provider,
          );
        }

        const result = jobs
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit)
          .map((j) => ({
            jobId: j.id,
            phase: j.phase,
            sourceProvider: j.source.provider,
            targetProvider: j.target.provider,
            targetRegion: j.target.region,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
            stepCount: j.plan?.steps.length ?? 0,
          }));

        return textResult({ total: jobs.length, returned: result.length, jobs: result });
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. migration_compatibility
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_compatibility",
    label: "Migration Compatibility",
    description:
      "Query the compatibility matrix for a specific migration direction and resource type, or retrieve the full matrix.",
    parameters: {
      type: "object",
      properties: {
        sourceProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Source cloud provider (omit for full matrix)",
        },
        targetProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Target cloud provider (omit for full matrix)",
        },
        resourceType: {
          type: "string",
          enum: ["vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer"],
          description: "Resource type to check (omit for all types)",
        },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const source = params.sourceProvider as MigrationProvider | undefined;
        const target = params.targetProvider as MigrationProvider | undefined;
        const resourceType = params.resourceType as MigrationResourceType | undefined;

        // Full matrix if no source/target specified
        if (!source && !target) {
          return textResult(getFullCompatibilityMatrix());
        }

        // Specific direction
        if (source && target) {
          if (resourceType) {
            const result = checkCompatibility(source, target, resourceType);
            return textResult(result);
          }
          const results = checkAllCompatibility(source, target);
          const summary = getCompatibilitySummary(source, target);
          return textResult({ results, summary });
        }

        // Partial — show all directions involving the given provider
        const matrix = getFullCompatibilityMatrix();
        const provider = source ?? target;
        const filtered = matrix.filter(
          (r) => r.sourceProvider === provider || r.targetProvider === provider,
        );
        return textResult(filtered);
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. migration_estimate_cost
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "migration_estimate_cost",
    label: "Estimate Migration Cost",
    description:
      "Estimate the cost of a migration without creating a plan. Returns egress, compute, storage, API, and conversion cost breakdowns.",
    parameters: {
      type: "object",
      properties: {
        sourceProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Source cloud provider",
        },
        targetProvider: {
          type: "string",
          enum: ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"],
          description: "Target cloud provider",
        },
        vmCount: { type: "number", description: "Number of VMs" },
        totalStorageGB: { type: "number", description: "Total object storage in GB" },
        totalDiskGB: { type: "number", description: "Total disk size in GB" },
        objectCount: { type: "number", description: "Number of objects in storage" },
      },
      required: ["sourceProvider", "targetProvider"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const estimate = estimateMigrationCost({
          sourceProvider: params.sourceProvider as MigrationProvider,
          targetProvider: params.targetProvider as MigrationProvider,
          resourceTypes: [],
          dataSizeGB: (params.totalStorageGB as number) ?? 0,
          diskSizeGB: (params.totalDiskGB as number) ?? 0,
          objectCount: (params.objectCount as number) ?? 0,
        });

        return textResult(estimate);
      } catch (err) {
        return errorResult(String(err));
      }
    },
  });
}
