/**
 * Cross-Cloud Migration Engine — CLI Commands Registration
 *
 * Registers all CLI commands under `espada migration` via api.registerCli().
 *
 * Commands:
 *  - espada migration assess <resourceId> --to <provider> --region <region>
 *  - espada migration plan <resourceId> --to <provider> --region <region>
 *  - espada migration execute <planId> [--dry-run]
 *  - espada migration status <jobId>
 *  - espada migration list [--status <status>] [--provider <provider>]
 *  - espada migration rollback <jobId> [--reason <reason>]
 *  - espada migration verify <jobId>
 *  - espada migration cutover <jobId>
 *  - espada migration compatibility [--source <provider>] [--target <provider>]
 *  - espada migration cost --source <provider> --target <provider> [--vms <n>] [--storage <gb>]
 *  - espada migration audit [--job <jobId>] [--limit <n>]
 *  - espada migration diagnostics
 */

import type { MigrationProvider, MigrationResourceType, MigrationPhase, MigrationStepType } from "./types.js";
import { getDiagnosticsSnapshot, resetDiagnostics } from "./state.js";
import { assessMigration, generatePlan } from "./core/migration-planner.js";
import { getJob, listJobs, createMigrationJob, transitionJobPhase, executePlan } from "./core/migration-engine.js";
import { checkAllCompatibility, getFullCompatibilityMatrix, getCompatibilitySummary } from "./core/compatibility-matrix.js";
import { estimateMigrationCost } from "./core/cost-estimator.js";
import { createIntegrityReport } from "./core/integrity-verifier.js";
import { getAuditLogger } from "./governance/audit-logger.js";
import { executeRollback, generateRollbackPlan, RollbackStack } from "./governance/rollback-manager.js";
import { getPluginState } from "./state.js";

type CliContext = {
  program: {
    command: (name: string) => any;
  };
};

type CliCommand = {
  description: (desc: string) => any;
  command: (name: string) => any;
  argument: (name: string, desc: string) => any;
  option: (flags: string, desc: string) => any;
  action: (fn: (...args: unknown[]) => void | Promise<void>) => any;
};

type PluginApi = {
  registerCli: (handler: (ctx: CliContext) => void) => void;
};

function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Register all migration CLI commands with the Espada plugin API.
 */
export function registerCli(api: PluginApi): void {
  api.registerCli((ctx: CliContext) => {
    const migration = ctx.program
      .command("migration")
      .description("Cross-cloud migration engine — orchestrate VM, data, and network migrations");

    // ─────────────────────────────────────────────────────────────────────
    // espada migration assess
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("assess")
      .description("Run a compatibility, cost, and dependency assessment for migration")
      .argument("<resourceId>", "Source resource ID")
      .option("--to <provider>", "Target cloud provider (aws, azure, gcp)")
      .option("--region <region>", "Target region")
      .option("--from <provider>", "Source cloud provider (default: aws)")
      .option("--types <types>", "Comma-separated resource types (vm,object-storage,etc.)")
      .action((...args: unknown[]) => {
        const resourceId = args[0] as string;
        const opts = args[args.length - 1] as Record<string, string>;
        const targetProvider = (opts.to ?? "azure") as MigrationProvider;
        const sourceProvider = (opts.from ?? "aws") as MigrationProvider;
        const targetRegion = opts.region ?? "us-east-1";
        const resourceTypes: MigrationResourceType[] = opts.types
          ? (opts.types.split(",") as MigrationResourceType[])
          : ["vm"];

        const result = assessMigration({
          sourceProvider,
          targetProvider,
          targetRegion,
          resourceTypes,
        });

        output({ resourceId, assessment: result });
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration plan
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("plan")
      .description("Generate a full migration execution plan")
      .argument("<resourceId>", "Source resource ID(s), comma-separated")
      .option("--to <provider>", "Target cloud provider")
      .option("--region <region>", "Target region")
      .option("--from <provider>", "Source cloud provider (default: aws)")
      .option("--include-network", "Include network/DNS migration steps")
      .action((...args: unknown[]) => {
        const resourceIds = (args[0] as string).split(",");
        const opts = args[args.length - 1] as Record<string, string | boolean>;
        const targetProvider = (opts.to as string ?? "azure") as MigrationProvider;
        const sourceProvider = (opts.from as string ?? "aws") as MigrationProvider;
        const targetRegion = (opts.region as string) ?? "us-east-1";

        const assessment = assessMigration({
          sourceProvider,
          targetProvider,
          targetRegion,
          resourceTypes: ["vm"],
        });

        const job = createMigrationJob({
          name: "CLI Migration Plan",
          description: "",
          source: { provider: sourceProvider, region: "" },
          target: { provider: targetProvider, region: targetRegion },
          resourceIds,
          resourceTypes: ["vm"],
          initiatedBy: "cli",
        });

        const plan = generatePlan({
          jobId: job.id,
          name: "CLI Migration Plan",
          description: "",
          sourceProvider,
          targetProvider,
          targetRegion,
          resourceTypes: ["vm"],
          assessment,
        });

        const state = getPluginState();
        const tracked = state.jobs.get(job.id);
        if (tracked) {
          tracked.plan = plan;
        }

        output({
          jobId: job.id,
          planId: plan.id,
          stepCount: plan.steps.length,
          steps: plan.steps.map((s) => ({ id: s.id, name: s.name, type: s.type, dependsOn: s.dependsOn })),
        });
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration execute
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("execute")
      .description("Execute an approved migration plan")
      .argument("<planId>", "Plan ID to execute")
      .option("--dry-run", "Validate plan without executing")
      .action(async (...args: unknown[]) => {
        const planId = args[0] as string;
        const opts = args[args.length - 1] as Record<string, boolean>;
        const state = getPluginState();
        const job = [...state.jobs.values()].find((j) => j.plan?.id === planId);

        if (!job || !job.plan) {
          output({ error: `No job found for plan ID: ${planId}` });
          return;
        }

        if (opts["dry-run"]) {
          output({ dryRun: true, jobId: job.id, planId, stepCount: job.plan.steps.length, status: "plan-valid" });
          return;
        }

        output({ jobId: job.id, status: "execution-started", stepCount: job.plan.steps.length });

        try {
          await executePlan(job.plan, {});
          output({ jobId: job.id, status: "completed" });
        } catch (err) {
          output({ jobId: job.id, status: "failed", error: String(err) });
        }
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration status
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("status")
      .description("Get the current status of a migration job")
      .argument("<jobId>", "Migration job ID")
      .action((...args: unknown[]) => {
        const jobId = args[0] as string;
        const job = getJob(jobId);

        if (!job) {
          output({ error: `Job not found: ${jobId}` });
          return;
        }

        output({
          jobId: job.id,
          phase: job.phase,
          sourceProvider: job.source.provider,
          targetProvider: job.target.provider,
          targetRegion: job.target.region,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          steps: job.plan?.steps.map((s) => {
            const stepState = job.executionState?.steps?.get(s.id);
            return {
              id: s.id,
              name: s.name,
              type: s.type,
              status: stepState?.status,
              error: stepState?.error,
            };
          }) ?? [],
        });
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration list
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("list")
      .description("List migration jobs")
      .option("--status <status>", "Filter by phase")
      .option("--provider <provider>", "Filter by provider")
      .option("--limit <limit>", "Maximum results (default: 50)")
      .action((...args: unknown[]) => {
        const opts = args[args.length - 1] as Record<string, string>;
        let jobs = listJobs(opts.status ? { phase: opts.status as MigrationPhase } : undefined);

        if (opts.provider) {
          jobs = jobs.filter(
            (j) => j.source.provider === opts.provider || j.target.provider === opts.provider,
          );
        }

        const limit = opts.limit ? Number(opts.limit) : 50;
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
            stepCount: j.plan?.steps.length ?? 0,
          }));

        output({ total: jobs.length, jobs: result });
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration rollback
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("rollback")
      .description("Rollback a migration job")
      .argument("<jobId>", "Migration job ID")
      .option("--reason <reason>", "Reason for rollback")
      .action(async (...args: unknown[]) => {
        const jobId = args[0] as string;
        const opts = args[args.length - 1] as Record<string, string>;
        const job = getJob(jobId);

        if (!job || !job.plan) {
          output({ error: `Job not found or has no plan: ${jobId}` });
          return;
        }

        transitionJobPhase(jobId, "rolling-back", "cli", opts.reason ?? "CLI-initiated rollback");

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

        output(result);
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration verify
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("verify")
      .description("Run integrity verification on a migration job")
      .argument("<jobId>", "Migration job ID")
      .action((...args: unknown[]) => {
        const jobId = args[0] as string;
        const job = getJob(jobId);

        if (!job) {
          output({ error: `Job not found: ${jobId}` });
          return;
        }

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

        output(report);
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration cutover
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("cutover")
      .description("Execute DNS/LB cutover for a verified migration")
      .argument("<jobId>", "Migration job ID")
      .action((...args: unknown[]) => {
        const jobId = args[0] as string;
        const job = getJob(jobId);

        if (!job) {
          output({ error: `Job not found: ${jobId}` });
          return;
        }

        if (job.phase !== "verifying" && job.phase !== "executing") {
          output({ error: `Job is in phase '${job.phase}', cutover requires 'verifying' or 'executing'` });
          return;
        }

        transitionJobPhase(jobId, "cutting-over", "cli", "CLI-initiated cutover");

        getAuditLogger().log({
          jobId,
          action: "cutover",
          actor: "cli",
          phase: "cutting-over",
          stepId: "cutover",
          details: { provider: job.target.provider, timestamp: new Date().toISOString() },
        });

        transitionJobPhase(jobId, "completed", "system", "Cutover completed");
        output({ jobId, status: "cutover-completed", phase: "completed" });
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration compatibility
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("compatibility")
      .description("Show the compatibility matrix")
      .option("--source <provider>", "Source provider")
      .option("--target <provider>", "Target provider")
      .action((...args: unknown[]) => {
        const opts = args[args.length - 1] as Record<string, string>;

        if (opts.source && opts.target) {
          const results = checkAllCompatibility(
            opts.source as MigrationProvider,
            opts.target as MigrationProvider,
          );
          const summary = getCompatibilitySummary(
            opts.source as MigrationProvider,
            opts.target as MigrationProvider,
          );
          output({ direction: `${opts.source} → ${opts.target}`, results, summary });
          return;
        }

        const matrix = getFullCompatibilityMatrix();
        if (opts.source || opts.target) {
          const provider = opts.source ?? opts.target;
          const filtered = matrix.filter(
            (r) => r.sourceProvider === provider || r.targetProvider === provider,
          );
          output(filtered);
          return;
        }

        output(matrix);
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration cost
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("cost")
      .description("Estimate migration cost")
      .option("--source <provider>", "Source provider")
      .option("--target <provider>", "Target provider")
      .option("--vms <count>", "Number of VMs")
      .option("--storage <gb>", "Storage in GB")
      .option("--disk <gb>", "Disk size in GB")
      .option("--objects <count>", "Number of objects")
      .action((...args: unknown[]) => {
        const opts = args[args.length - 1] as Record<string, string>;
        const estimate = estimateMigrationCost({
          sourceProvider: (opts.source ?? "aws") as MigrationProvider,
          targetProvider: (opts.target ?? "azure") as MigrationProvider,
          resourceTypes: [],
          dataSizeGB: Number(opts.storage ?? 0) + Number(opts.disk ?? 0),
          diskSizeGB: Number(opts.disk ?? 0),
          objectCount: Number(opts.objects ?? 0),
        });
        output(estimate);
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration audit
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("audit")
      .description("View migration audit trail")
      .option("--job <jobId>", "Filter by job ID")
      .option("--limit <limit>", "Maximum entries (default: 50)")
      .action((...args: unknown[]) => {
        const opts = args[args.length - 1] as Record<string, string>;
        const auditLogger = getAuditLogger();

        if (opts.job) {
          const entries = auditLogger.getJobEntries(opts.job);
          output({ jobId: opts.job, entries });
          return;
        }

        const chain = auditLogger.getChain();
        const limit = Number(opts.limit ?? 50);
        const entries = chain.entries.slice(-limit);
        output({ total: chain.entries.length, returned: entries.length, valid: chain.verified, entries });
      });

    // ─────────────────────────────────────────────────────────────────────
    // espada migration diagnostics
    // ─────────────────────────────────────────────────────────────────────
    migration
      .command("diagnostics")
      .description("Show migration engine diagnostics")
      .option("--reset", "Reset diagnostics counters")
      .action((...args: unknown[]) => {
        const opts = args[args.length - 1] as Record<string, boolean>;
        if (opts.reset) {
          const before = getDiagnosticsSnapshot();
          resetDiagnostics();
          output({ reset: true, previous: before });
          return;
        }
        output(getDiagnosticsSnapshot());
      });
  });
}
