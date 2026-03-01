// ─── Remediation Dispatcher ────────────────────────────────────────────
//
// Plans and executes remediation steps based on incident classification.
// Composes existing capabilities: AWS reconciliation, K8s rollout restart,
// K8s scale, Helm rollback, Azure slot swap, Terraform apply, etc.
//
// Does NOT directly invoke cloud SDKs — generates structured remediation
// plans that can be executed by the caller, enabling dry-run / approval.
// ───────────────────────────────────────────────────────────────────────

import type {
  LifecycleIncident,
  RemediationRecord,
  RemediationStep,
  RemediationStrategy,
  RemediateInput,
  IncidentClassification,
} from "./types.js";
import { transitionPhase } from "./state-machine.js";
import type { TransitionResult } from "./state-machine.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let _planCounter = 0;

function generatePlanId(): string {
  _planCounter += 1;
  return `rem-${Date.now()}-${_planCounter}`;
}

export function resetPlanCounter(): void {
  _planCounter = 0;
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Strategy detection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Pick the best remediation strategy based on classification and cloud.
 */
export function detectStrategy(
  incident: LifecycleIncident,
): RemediationStrategy {
  const cls = incident.classification;
  const cloud = incident.incident.cloud;

  if (!cls) return "manual";

  // Configuration drift → auto-remediate with cloud-specific tools
  if (cls.category === "configuration-drift") {
    if (cloud === "aws") return "aws-reconciliation";
    return "terraform-apply";
  }

  // Deployment failures → rollback
  if (cls.category === "deployment-failure") {
    if (cloud === "kubernetes") return "helm-rollback";
    if (cloud === "azure") return "azure-slot-swap";
    return "terraform-apply";
  }

  // Scaling issues → scale up
  if (cls.category === "scaling-issue") {
    if (cloud === "kubernetes") return "k8s-scale";
    return "manual";
  }

  // Availability loss → restart
  if (
    cls.category === "availability-loss" ||
    cls.category === "infrastructure-failure"
  ) {
    if (cloud === "kubernetes") return "k8s-rollout-restart";
    if (cloud === "azure") return "azure-slot-swap";
    return "manual";
  }

  // Performance degradation
  if (cls.category === "performance-degradation") {
    if (cloud === "kubernetes") return "k8s-scale";
    return "manual";
  }

  return "manual";
}

/* ------------------------------------------------------------------ */
/*  Remediation plan builders                                          */
/* ------------------------------------------------------------------ */

function buildSteps(
  strategy: RemediationStrategy,
  incident: LifecycleIncident,
  parameters: Record<string, unknown>,
): RemediationStep[] {
  switch (strategy) {
    case "aws-reconciliation":
      return buildAwsReconciliationSteps(incident, parameters);
    case "k8s-rollout-restart":
      return buildK8sRolloutRestartSteps(incident, parameters);
    case "k8s-scale":
      return buildK8sScaleSteps(incident, parameters);
    case "helm-rollback":
      return buildHelmRollbackSteps(incident, parameters);
    case "azure-slot-swap":
      return buildAzureSlotSwapSteps(incident, parameters);
    case "azure-traffic-shift":
      return buildAzureTrafficShiftSteps(incident, parameters);
    case "terraform-apply":
      return buildTerraformApplySteps(incident, parameters);
    case "custom-runbook":
      return buildCustomRunbookSteps(parameters);
    case "manual":
      return buildManualSteps(incident);
    default:
      return buildManualSteps(incident);
  }
}

function buildAwsReconciliationSteps(
  incident: LifecycleIncident,
  params: Record<string, unknown>,
): RemediationStep[] {
  return [
    {
      stepNumber: 1,
      strategy: "aws-reconciliation",
      description: "Capture current resource state for rollback",
      parameters: {
        action: "capture-state",
        resource: incident.incident.resource,
        region: incident.incident.region,
        ...params,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 2,
      strategy: "aws-reconciliation",
      description: "Run drift detection on affected resource",
      parameters: {
        action: "detect-drift",
        resource: incident.incident.resource,
        region: incident.incident.region,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 3,
      strategy: "aws-reconciliation",
      description: "Apply auto-remediation to reconcile drift",
      parameters: {
        action: "reconcile",
        resource: incident.incident.resource,
        region: incident.incident.region,
        autoRemediate: true,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 3,
    },
    {
      stepNumber: 4,
      strategy: "aws-reconciliation",
      description: "Verify remediation — re-run drift detection",
      parameters: {
        action: "verify",
        resource: incident.incident.resource,
        region: incident.incident.region,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
  ];
}

function buildK8sRolloutRestartSteps(
  incident: LifecycleIncident,
  params: Record<string, unknown>,
): RemediationStep[] {
  const resource = params.resource as string ?? incident.incident.resource;
  const namespace = params.namespace as string ?? "default";

  return [
    {
      stepNumber: 1,
      strategy: "k8s-rollout-restart",
      description: `Check rollout status for ${resource}`,
      parameters: {
        action: "rollout-status",
        resource,
        namespace,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 2,
      strategy: "k8s-rollout-restart",
      description: `Perform rolling restart of ${resource}`,
      parameters: {
        action: "rollout-restart",
        resource,
        namespace,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 3,
      strategy: "k8s-rollout-restart",
      description: `Verify rollout completion for ${resource}`,
      parameters: {
        action: "rollout-status",
        resource,
        namespace,
        waitForComplete: true,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 3,
    },
  ];
}

function buildK8sScaleSteps(
  incident: LifecycleIncident,
  params: Record<string, unknown>,
): RemediationStep[] {
  const resource = params.resource as string ?? incident.incident.resource;
  const namespace = params.namespace as string ?? "default";
  const replicas = params.replicas as number ?? 3;

  return [
    {
      stepNumber: 1,
      strategy: "k8s-scale",
      description: `Get current replica count for ${resource}`,
      parameters: {
        action: "get-replicas",
        resource,
        namespace,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 2,
      strategy: "k8s-scale",
      description: `Scale ${resource} to ${replicas} replicas`,
      parameters: {
        action: "scale",
        resource,
        namespace,
        replicas,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 3,
      strategy: "k8s-scale",
      description: `Verify ${resource} has ${replicas} ready replicas`,
      parameters: {
        action: "verify-scale",
        resource,
        namespace,
        expectedReplicas: replicas,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 3,
    },
  ];
}

function buildHelmRollbackSteps(
  incident: LifecycleIncident,
  params: Record<string, unknown>,
): RemediationStep[] {
  const release = params.release as string ?? incident.incident.resource;
  const namespace = params.namespace as string ?? "default";
  const revision = params.revision as number | undefined;

  return [
    {
      stepNumber: 1,
      strategy: "helm-rollback",
      description: `Get release history for ${release}`,
      parameters: {
        action: "helm-history",
        release,
        namespace,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 2,
      strategy: "helm-rollback",
      description: `Roll back ${release} to ${revision ? `revision ${revision}` : "previous revision"}`,
      parameters: {
        action: "helm-rollback",
        release,
        namespace,
        ...(revision !== undefined ? { revision } : {}),
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 3,
      strategy: "helm-rollback",
      description: `Verify release ${release} status after rollback`,
      parameters: {
        action: "helm-status",
        release,
        namespace,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
  ];
}

function buildAzureSlotSwapSteps(
  incident: LifecycleIncident,
  params: Record<string, unknown>,
): RemediationStep[] {
  const appName = params.appName as string ?? incident.incident.resource;
  const resourceGroup = params.resourceGroup as string ?? "";
  const sourceSlot = params.sourceSlot as string ?? "staging";
  const targetSlot = params.targetSlot as string ?? "production";

  return [
    {
      stepNumber: 1,
      strategy: "azure-slot-swap",
      description: `Check health of ${sourceSlot} slot for ${appName}`,
      parameters: {
        action: "health-check",
        appName,
        resourceGroup,
        slot: sourceSlot,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 2,
      strategy: "azure-slot-swap",
      description: `Swap ${sourceSlot} → ${targetSlot} for ${appName}`,
      parameters: {
        action: "swap-slots",
        appName,
        resourceGroup,
        sourceSlot,
        targetSlot,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 1,
    },
    {
      stepNumber: 3,
      strategy: "azure-slot-swap",
      description: `Verify ${appName} ${targetSlot} slot is healthy after swap`,
      parameters: {
        action: "health-check",
        appName,
        resourceGroup,
        slot: targetSlot,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 3,
    },
  ];
}

function buildAzureTrafficShiftSteps(
  incident: LifecycleIncident,
  params: Record<string, unknown>,
): RemediationStep[] {
  const profileName = params.profileName as string ?? "";
  const resourceGroup = params.resourceGroup as string ?? "";
  const endpoint = params.endpoint as string ?? "";
  const weight = params.weight as number ?? 0;

  return [
    {
      stepNumber: 1,
      strategy: "azure-traffic-shift",
      description: `Get current Traffic Manager weights for ${profileName}`,
      parameters: {
        action: "get-weights",
        profileName,
        resourceGroup,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 2,
      strategy: "azure-traffic-shift",
      description: `Shift traffic for endpoint ${endpoint} to weight ${weight}`,
      parameters: {
        action: "update-weight",
        profileName,
        resourceGroup,
        endpoint,
        weight,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
  ];
}

function buildTerraformApplySteps(
  incident: LifecycleIncident,
  params: Record<string, unknown>,
): RemediationStep[] {
  const cwd = params.cwd as string ?? "";
  const varFile = params.varFile as string | undefined;

  return [
    {
      stepNumber: 1,
      strategy: "terraform-apply",
      description: "Run terraform plan to preview changes",
      parameters: {
        action: "plan",
        cwd,
        ...(varFile ? { varFile } : {}),
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
    {
      stepNumber: 2,
      strategy: "terraform-apply",
      description: "Apply terraform changes to remediate drift",
      parameters: {
        action: "apply",
        cwd,
        confirm: "yes",
        ...(varFile ? { varFile } : {}),
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 1,
    },
    {
      stepNumber: 3,
      strategy: "terraform-apply",
      description: "Verify state matches desired configuration",
      parameters: {
        action: "plan",
        cwd,
        expectNoChanges: true,
      },
      status: "pending",
      canRetry: true,
      retryCount: 0,
      maxRetries: 2,
    },
  ];
}

function buildCustomRunbookSteps(
  params: Record<string, unknown>,
): RemediationStep[] {
  const steps = params.steps as Array<{
    description: string;
    parameters: Record<string, unknown>;
  }> ?? [];

  return steps.map((step, i) => ({
    stepNumber: i + 1,
    strategy: "custom-runbook" as RemediationStrategy,
    description: step.description,
    parameters: step.parameters,
    status: "pending" as const,
    canRetry: true,
    retryCount: 0,
    maxRetries: 2,
  }));
}

function buildManualSteps(
  incident: LifecycleIncident,
): RemediationStep[] {
  return [
    {
      stepNumber: 1,
      strategy: "manual",
      description: `Investigate incident "${incident.incident.title}" on ${incident.incident.cloud}`,
      parameters: {
        resource: incident.incident.resource,
        region: incident.incident.region,
        cloud: incident.incident.cloud,
      },
      status: "pending",
      canRetry: false,
      retryCount: 0,
      maxRetries: 0,
    },
    {
      stepNumber: 2,
      strategy: "manual",
      description: "Apply manual remediation and document actions taken",
      parameters: {},
      status: "pending",
      canRetry: false,
      retryCount: 0,
      maxRetries: 0,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Create remediation plan                                            */
/* ------------------------------------------------------------------ */

/**
 * Create a remediation plan and transition the incident to "remediating".
 */
export function planRemediation(
  incident: LifecycleIncident,
  input: RemediateInput,
): TransitionResult {
  if (incident.phase !== "triaged") {
    return {
      success: false,
      error: `Cannot remediate: incident is in "${incident.phase}" phase, expected "triaged"`,
    };
  }

  const strategy = input.strategy ?? detectStrategy(incident);
  const parameters = input.parameters ?? {};
  const steps = buildSteps(strategy, incident, parameters);

  if (steps.length === 0) {
    return {
      success: false,
      error: `No remediation steps generated for strategy "${strategy}"`,
    };
  }

  const record: RemediationRecord = {
    planId: generatePlanId(),
    strategy,
    steps,
    status: "planned",
    startedAt: now(),
    autoExecuted: input.autoExecute ?? false,
    preRemediationSnapshot: {},
  };

  const result = transitionPhase(
    incident,
    "remediating",
    input.triggeredBy ?? "system",
    `Remediation planned: ${strategy} (${steps.length} steps)`,
  );

  if (!result.success) return result;

  return {
    success: true,
    incident: {
      ...result.incident,
      remediation: record,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Execute / simulate remediation steps                               */
/* ------------------------------------------------------------------ */

export type StepExecutor = (
  step: RemediationStep,
) => Promise<{ success: boolean; output?: string; error?: string }>;

/**
 * Execute remediation steps sequentially.
 * The executor callback performs the actual cloud API call.
 * Returns the updated lifecycle incident.
 */
export async function executeRemediation(
  incident: LifecycleIncident,
  executor: StepExecutor,
): Promise<{ success: boolean; incident: LifecycleIncident; failedStep?: number }> {
  if (!incident.remediation || incident.phase !== "remediating") {
    return { success: false, incident };
  }

  const remediation: RemediationRecord = {
    ...incident.remediation,
    status: "executing",
  };
  const steps = [...remediation.steps];

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
    new Date(completedAt).getTime() - new Date(remediation.startedAt).getTime();

  const updatedRemediation: RemediationRecord = {
    ...remediation,
    steps,
    status: failed ? "failed" : "completed",
    completedAt,
    durationMs,
  };

  return {
    success: !failed,
    incident: {
      ...incident,
      remediation: updatedRemediation,
      updatedAt: now(),
    },
    failedStep: failedStepNum,
  };
}

/**
 * Simulate remediation execution (dry-run). All steps succeed instantly.
 */
export function simulateRemediation(
  incident: LifecycleIncident,
): { success: boolean; incident: LifecycleIncident } {
  if (!incident.remediation) {
    return { success: false, incident };
  }

  const steps = incident.remediation.steps.map((step) => ({
    ...step,
    status: "completed" as const,
    startedAt: now(),
    completedAt: now(),
    output: `[DRY-RUN] Step ${step.stepNumber}: ${step.description}`,
  }));

  return {
    success: true,
    incident: {
      ...incident,
      remediation: {
        ...incident.remediation,
        steps,
        status: "completed",
        completedAt: now(),
      },
      updatedAt: now(),
    },
  };
}
