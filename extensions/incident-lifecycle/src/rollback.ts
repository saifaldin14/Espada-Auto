// ─── Rollback Dispatcher ───────────────────────────────────────────────
//
// Plans and executes rollback when remediation fails.
// Uses pre-remediation snapshots and reverse-remediation strategies.
// ───────────────────────────────────────────────────────────────────────

import type {
  LifecycleIncident,
  RollbackRecord,
  RollbackStep,
  RollbackStrategy,
  RollbackInput,
  RemediationStrategy,
} from "./types.js";
import { transitionPhase } from "./state-machine.js";
import type { TransitionResult } from "./state-machine.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let _rollbackCounter = 0;

function generateRollbackId(): string {
  _rollbackCounter += 1;
  return `rb-${Date.now()}-${_rollbackCounter}`;
}

export function resetRollbackCounter(): void {
  _rollbackCounter = 0;
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Strategy detection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Map remediation strategy → rollback strategy.
 */
export function detectRollbackStrategy(
  incident: LifecycleIncident,
): RollbackStrategy {
  const remStrategy = incident.remediation?.strategy;

  const mapping: Record<RemediationStrategy, RollbackStrategy> = {
    "aws-reconciliation": "restore-snapshot",
    "k8s-rollout-restart": "k8s-rollout-undo",
    "k8s-scale": "reverse-remediation",
    "helm-rollback": "helm-rollback",
    "azure-slot-swap": "azure-slot-swap-back",
    "azure-traffic-shift": "reverse-remediation",
    "terraform-apply": "terraform-revert",
    "custom-runbook": "manual",
    manual: "manual",
  };

  return remStrategy ? (mapping[remStrategy] ?? "manual") : "manual";
}

/* ------------------------------------------------------------------ */
/*  Rollback step builders                                             */
/* ------------------------------------------------------------------ */

function buildRollbackSteps(
  strategy: RollbackStrategy,
  incident: LifecycleIncident,
): RollbackStep[] {
  switch (strategy) {
    case "restore-snapshot":
      return buildRestoreSnapshotSteps(incident);
    case "reverse-remediation":
      return buildReverseRemediationSteps(incident);
    case "helm-rollback":
      return buildHelmRollbackSteps(incident);
    case "k8s-rollout-undo":
      return buildK8sRolloutUndoSteps(incident);
    case "azure-slot-swap-back":
      return buildAzureSwapBackSteps(incident);
    case "terraform-revert":
      return buildTerraformRevertSteps(incident);
    case "manual":
      return buildManualRollbackSteps(incident);
    default:
      return buildManualRollbackSteps(incident);
  }
}

function buildRestoreSnapshotSteps(
  incident: LifecycleIncident,
): RollbackStep[] {
  return [
    {
      stepNumber: 1,
      strategy: "restore-snapshot",
      description: "Retrieve pre-remediation state snapshot",
      parameters: {
        action: "get-snapshot",
        resource: incident.incident.resource,
        snapshotData: incident.remediation?.preRemediationSnapshot ?? {},
      },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 2,
      strategy: "restore-snapshot",
      description: "Restore resource to pre-remediation state",
      parameters: {
        action: "restore",
        resource: incident.incident.resource,
        region: incident.incident.region,
        cloud: incident.incident.cloud,
      },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 3,
      strategy: "restore-snapshot",
      description: "Verify resource state matches snapshot",
      parameters: {
        action: "verify-restore",
        resource: incident.incident.resource,
      },
      status: "pending",
      canRetry: true,
    },
  ];
}

function buildReverseRemediationSteps(
  incident: LifecycleIncident,
): RollbackStep[] {
  const remSteps = incident.remediation?.steps ?? [];
  const completedSteps = remSteps.filter((s) => s.status === "completed");

  if (completedSteps.length === 0) {
    // Return a single manual fallback step when no completed steps can be reversed
    return [
      {
        stepNumber: 1,
        strategy: "reverse-remediation" as RollbackStrategy,
        description:
          "Manual review required: no completed remediation steps found to reverse. " +
          "Investigate current resource state and revert manually.",
        parameters: {
          action: "manual-review",
          reason: "no_completed_steps",
          resource: incident.incident.resource,
        },
        status: "pending" as const,
        canRetry: false,
      },
    ];
  }

  // Reverse the completed steps
  return completedSteps
    .reverse()
    .map((step, i) => ({
      stepNumber: i + 1,
      strategy: "reverse-remediation" as RollbackStrategy,
      description: `Reverse: ${step.description}`,
      parameters: {
        action: "reverse",
        originalStep: step.stepNumber,
        originalParameters: step.parameters,
      },
      status: "pending" as const,
      canRetry: true,
    }));
}

function buildHelmRollbackSteps(
  incident: LifecycleIncident,
): RollbackStep[] {
  const params = incident.remediation?.steps?.[0]?.parameters ?? {};
  const release = (params.release as string) ?? incident.incident.resource;
  const namespace = (params.namespace as string) ?? "default";

  return [
    {
      stepNumber: 1,
      strategy: "helm-rollback",
      description: `Get Helm release history for ${release}`,
      parameters: { action: "helm-history", release, namespace },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 2,
      strategy: "helm-rollback",
      description: `Roll back Helm release ${release} to previous revision`,
      parameters: { action: "helm-rollback", release, namespace },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 3,
      strategy: "helm-rollback",
      description: `Verify Helm release ${release} status`,
      parameters: { action: "helm-status", release, namespace },
      status: "pending",
      canRetry: true,
    },
  ];
}

function buildK8sRolloutUndoSteps(
  incident: LifecycleIncident,
): RollbackStep[] {
  const params = incident.remediation?.steps?.[0]?.parameters ?? {};
  const resource = (params.resource as string) ?? incident.incident.resource;
  const namespace = (params.namespace as string) ?? "default";

  return [
    {
      stepNumber: 1,
      strategy: "k8s-rollout-undo",
      description: `Check rollout history for ${resource}`,
      parameters: { action: "rollout-history", resource, namespace },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 2,
      strategy: "k8s-rollout-undo",
      description: `Undo rollout for ${resource}`,
      parameters: { action: "rollout-undo", resource, namespace },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 3,
      strategy: "k8s-rollout-undo",
      description: `Verify rollout status for ${resource}`,
      parameters: { action: "rollout-status", resource, namespace },
      status: "pending",
      canRetry: true,
    },
  ];
}

function buildAzureSwapBackSteps(
  incident: LifecycleIncident,
): RollbackStep[] {
  const params = incident.remediation?.steps?.[0]?.parameters ?? {};
  const appName = (params.appName as string) ?? incident.incident.resource;
  const resourceGroup = (params.resourceGroup as string) ?? "";

  return [
    {
      stepNumber: 1,
      strategy: "azure-slot-swap-back",
      description: `Swap back: production → staging for ${appName}`,
      parameters: {
        action: "swap-slots",
        appName,
        resourceGroup,
        sourceSlot: "production",
        targetSlot: "staging",
      },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 2,
      strategy: "azure-slot-swap-back",
      description: `Verify ${appName} production slot is healthy`,
      parameters: {
        action: "health-check",
        appName,
        resourceGroup,
        slot: "production",
      },
      status: "pending",
      canRetry: true,
    },
  ];
}

function buildTerraformRevertSteps(
  incident: LifecycleIncident,
): RollbackStep[] {
  const params = incident.remediation?.steps?.[0]?.parameters ?? {};
  const cwd = (params.cwd as string) ?? "";

  return [
    {
      stepNumber: 1,
      strategy: "terraform-revert",
      description: "Run terraform plan to assess current state",
      parameters: { action: "plan", cwd },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 2,
      strategy: "terraform-revert",
      description: "Revert to previous terraform state",
      parameters: { action: "state-revert", cwd },
      status: "pending",
      canRetry: true,
    },
    {
      stepNumber: 3,
      strategy: "terraform-revert",
      description: "Apply reverted state via terraform apply",
      parameters: { action: "apply", cwd, confirm: "yes" },
      status: "pending",
      canRetry: true,
    },
  ];
}

function buildManualRollbackSteps(
  incident: LifecycleIncident,
): RollbackStep[] {
  return [
    {
      stepNumber: 1,
      strategy: "manual",
      description: `Manually roll back changes for "${incident.incident.title}"`,
      parameters: {
        resource: incident.incident.resource,
        cloud: incident.incident.cloud,
        region: incident.incident.region,
      },
      status: "pending",
      canRetry: false,
    },
    {
      stepNumber: 2,
      strategy: "manual",
      description: "Verify system is in a stable state after rollback",
      parameters: {},
      status: "pending",
      canRetry: false,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Create rollback plan                                               */
/* ------------------------------------------------------------------ */

/**
 * Create a rollback plan and transition the incident to "rolling-back".
 */
export function planRollback(
  incident: LifecycleIncident,
  input: RollbackInput,
): TransitionResult {
  if (incident.phase !== "remediating") {
    return {
      success: false,
      error: `Cannot rollback: incident is in "${incident.phase}" phase, expected "remediating"`,
    };
  }

  const strategy = input.strategy ?? detectRollbackStrategy(incident);
  const steps = buildRollbackSteps(strategy, incident);

  if (steps.length === 0) {
    return {
      success: false,
      error: `No rollback steps generated for strategy "${strategy}"`,
    };
  }

  const record: RollbackRecord = {
    planId: generateRollbackId(),
    strategy,
    steps,
    status: "planned",
    reason: input.reason,
    startedAt: now(),
    stateRestored: false,
  };

  const result = transitionPhase(
    incident,
    "rolling-back",
    input.triggeredBy ?? "system",
    `Rollback initiated: ${strategy} — reason: ${input.reason}`,
  );

  if (!result.success) return result;

  return {
    success: true,
    incident: {
      ...result.incident,
      rollback: record,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Execute rollback steps                                             */
/* ------------------------------------------------------------------ */

export type RollbackStepExecutor = (
  step: RollbackStep,
) => Promise<{ success: boolean; output?: string; error?: string }>;

/**
 * Execute rollback steps sequentially.
 */
export async function executeRollback(
  incident: LifecycleIncident,
  executor: RollbackStepExecutor,
): Promise<{ success: boolean; incident: LifecycleIncident; failedStep?: number }> {
  if (!incident.rollback || incident.phase !== "rolling-back") {
    return { success: false, incident };
  }

  const rollback: RollbackRecord = {
    ...incident.rollback,
    status: "executing",
  };
  const steps = [...rollback.steps];

  let failed = false;
  let failedStepNum: number | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = { ...steps[i], status: "executing" as const, startedAt: now() };
    steps[i] = step;

    try {
      const result = await executor(step);
      if (result.success) {
        steps[i] = { ...step, status: "completed", completedAt: now(), output: result.output };
      } else {
        steps[i] = { ...step, status: "failed", completedAt: now(), error: result.error };
        failed = true;
        failedStepNum = step.stepNumber;
        break;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      steps[i] = { ...step, status: "failed", completedAt: now(), error: message };
      failed = true;
      failedStepNum = step.stepNumber;
      break;
    }
  }

  const completedAt = now();
  const durationMs =
    new Date(completedAt).getTime() - new Date(rollback.startedAt).getTime();

  const updatedRollback: RollbackRecord = {
    ...rollback,
    steps,
    status: failed ? "failed" : "completed",
    stateRestored: !failed,
    completedAt,
    durationMs,
  };

  return {
    success: !failed,
    incident: {
      ...incident,
      rollback: updatedRollback,
      updatedAt: now(),
    },
    failedStep: failedStepNum,
  };
}
