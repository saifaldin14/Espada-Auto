// ─── Incident Lifecycle Agent Tools ────────────────────────────────────
//
// 8 agent tools for the structured incident lifecycle:
// 1. lifecycle_create     — Create a new lifecycle tracking instance
// 2. lifecycle_classify   — Classify an incident (detect → classified)
// 3. lifecycle_triage     — Triage an incident (classified → triaged)
// 4. lifecycle_remediate  — Plan remediation (triaged → remediating)
// 5. lifecycle_rollback   — Plan rollback (remediating → rolling-back)
// 6. lifecycle_postmortem — Generate post-mortem report
// 7. lifecycle_close      — Close an incident
// 8. lifecycle_dashboard  — View dashboard / filter lifecycle incidents
// ───────────────────────────────────────────────────────────────────────

import { Type } from "@sinclair/typebox";
import type { LifecycleIncident, LifecycleFilter, LifecyclePhase, RemediationStrategy, RollbackStrategy } from "./types.js";

import {
  createLifecycleIncident,
  classifyIncident,
  triageIncident,
  filterLifecycles,
  buildDashboard,
  sortByPriority,
} from "./state-machine.js";

import {
  planRemediation,
  simulateRemediation,
  detectStrategy,
} from "./remediation.js";

import { planRollback, detectRollbackStrategy } from "./rollback.js";

import { generatePostMortem, closeLifecycle } from "./post-mortem.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

function parseJson<T>(raw: string, label: string): { data?: T; error?: string } {
  try {
    return { data: JSON.parse(raw) as T };
  } catch {
    return { error: `Invalid JSON for ${label}: ${raw.slice(0, 200)}` };
  }
}

/* ------------------------------------------------------------------ */
/*  In-memory store (production would use a persistence layer)         */
/* ------------------------------------------------------------------ */

const lifecycleStore = new Map<string, LifecycleIncident>();

export function getStore(): Map<string, LifecycleIncident> {
  return lifecycleStore;
}

export function clearStore(): void {
  lifecycleStore.clear();
}

/* ------------------------------------------------------------------ */
/*  Tool definitions                                                   */
/* ------------------------------------------------------------------ */

const lifecycleCreateTool = {
  name: "lifecycle_create",
  description:
    "Create a new incident lifecycle tracking instance. " +
    "Takes a snapshot of the incident and starts the lifecycle at the 'detected' phase. " +
    "Input: JSON string with incident data (id, cloud, source, title, description, " +
    "severity, status, resource, region, startedAt, tags) and initiatedBy.",
  inputSchema: Type.Object({
    incident: Type.String({
      description:
        "JSON string — incident snapshot object with fields: id, cloud, source, " +
        "title, description, severity, status, resource, region, startedAt, tags",
    }),
    initiatedBy: Type.String({ description: "User or system initiating the lifecycle" }),
    correlationGroupId: Type.Optional(
      Type.String({ description: "Optional correlation group ID from incident-view" }),
    ),
  }),
  execute: async (input: {
    incident: string;
    initiatedBy: string;
    correlationGroupId?: string;
  }) => {
    const parsed = parseJson<LifecycleIncident["incident"]>(input.incident, "incident");
    if (parsed.error) return err(parsed.error);

    const lc = createLifecycleIncident({
      incidentId: parsed.data!.id,
      incident: parsed.data!,
      initiatedBy: input.initiatedBy,
      correlationGroupId: input.correlationGroupId,
    });

    lifecycleStore.set(lc.id, lc);

    return ok({
      lifecycleId: lc.id,
      phase: lc.phase,
      incidentId: lc.incidentId,
      message: "Lifecycle created — incident is in 'detected' phase",
    });
  },
};

const lifecycleClassifyTool = {
  name: "lifecycle_classify",
  description:
    "Classify a detected incident: auto-detects category, adjusts severity, " +
    "estimates blast radius, and suggests remediation approach. " +
    "Transitions: detected → classified.",
  inputSchema: Type.Object({
    lifecycleId: Type.String({ description: "Lifecycle tracking ID" }),
    triggeredBy: Type.Optional(
      Type.String({ description: "User or system triggering classification (default: 'system')" }),
    ),
  }),
  execute: async (input: { lifecycleId: string; triggeredBy?: string }) => {
    const lc = lifecycleStore.get(input.lifecycleId);
    if (!lc) return err(`Lifecycle not found: ${input.lifecycleId}`);

    const result = classifyIncident(lc, input.triggeredBy ?? "system");
    if (!result.success) return err(result.error);

    lifecycleStore.set(result.incident.id, result.incident);

    return ok({
      lifecycleId: result.incident.id,
      phase: result.incident.phase,
      classification: result.incident.classification,
    });
  },
};

const lifecycleTriageTool = {
  name: "lifecycle_triage",
  description:
    "Triage a classified incident: assign priority, owner, escalation level, " +
    "and estimate remediation time. Transitions: classified → triaged.",
  inputSchema: Type.Object({
    lifecycleId: Type.String({ description: "Lifecycle tracking ID" }),
    assignee: Type.Optional(
      Type.String({ description: "Team or person to assign (default: 'unassigned')" }),
    ),
    relatedIncidentIds: Type.Optional(
      Type.Array(Type.String(), { description: "Related incident IDs to review together" }),
    ),
    triggeredBy: Type.Optional(
      Type.String({ description: "User or system triggering triage (default: 'system')" }),
    ),
  }),
  execute: async (input: {
    lifecycleId: string;
    assignee?: string;
    relatedIncidentIds?: string[];
    triggeredBy?: string;
  }) => {
    const lc = lifecycleStore.get(input.lifecycleId);
    if (!lc) return err(`Lifecycle not found: ${input.lifecycleId}`);

    const result = triageIncident(lc, {
      assignee: input.assignee,
      relatedIncidentIds: input.relatedIncidentIds,
      triggeredBy: input.triggeredBy ?? "system",
    });
    if (!result.success) return err(result.error);

    lifecycleStore.set(result.incident.id, result.incident);

    return ok({
      lifecycleId: result.incident.id,
      phase: result.incident.phase,
      triage: result.incident.triage,
    });
  },
};

const lifecycleRemediateTool = {
  name: "lifecycle_remediate",
  description:
    "Plan remediation for a triaged incident. Auto-detects the best strategy " +
    "(aws-reconciliation, k8s-rollout-restart, k8s-scale, helm-rollback, " +
    "azure-slot-swap, terraform-apply, etc.) or accepts an override. " +
    "Set dryRun=true to simulate without executing. " +
    "Transitions: triaged → remediating.",
  inputSchema: Type.Object({
    lifecycleId: Type.String({ description: "Lifecycle tracking ID" }),
    strategy: Type.Optional(
      Type.String({
        description:
          "Override remediation strategy. Options: aws-reconciliation, " +
          "k8s-rollout-restart, k8s-scale, helm-rollback, azure-slot-swap, " +
          "azure-traffic-shift, terraform-apply, custom-runbook, manual",
      }),
    ),
    parameters: Type.Optional(
      Type.String({
        description:
          "JSON string — strategy-specific parameters (e.g. namespace, release, replicas)",
      }),
    ),
    dryRun: Type.Optional(
      Type.Boolean({ description: "Simulate remediation without executing (default: true)" }),
    ),
    triggeredBy: Type.Optional(
      Type.String({ description: "User or system triggering remediation" }),
    ),
  }),
  execute: async (input: {
    lifecycleId: string;
    strategy?: string;
    parameters?: string;
    dryRun?: boolean;
    triggeredBy?: string;
  }) => {
    const lc = lifecycleStore.get(input.lifecycleId);
    if (!lc) return err(`Lifecycle not found: ${input.lifecycleId}`);

    let params: Record<string, unknown> = {};
    if (input.parameters) {
      const parsed = parseJson<Record<string, unknown>>(input.parameters, "parameters");
      if (parsed.error) return err(parsed.error);
      params = parsed.data!;
    }

    const validRemStrategies = new Set([
      "aws-reconciliation", "k8s-rollout-restart", "k8s-scale", "helm-rollback",
      "azure-slot-swap", "azure-traffic-shift", "terraform-apply", "custom-runbook", "manual",
    ]);
    if (input.strategy && !validRemStrategies.has(input.strategy)) {
      return err(`Invalid remediation strategy: ${input.strategy}. Valid: ${[...validRemStrategies].join(", ")}`);
    }

    const result = planRemediation(lc, {
      lifecycleId: input.lifecycleId,
      strategy: input.strategy as RemediationStrategy | undefined,
      parameters: params,
      autoExecute: false,
      triggeredBy: input.triggeredBy,
    });
    if (!result.success) return err(result.error);

    let finalIncident = result.incident;

    // Dry-run by default
    const isDryRun = input.dryRun !== false;
    if (isDryRun && finalIncident.remediation) {
      const sim = simulateRemediation(finalIncident);
      finalIncident = sim.incident;
    }

    lifecycleStore.set(finalIncident.id, finalIncident);

    return ok({
      lifecycleId: finalIncident.id,
      phase: finalIncident.phase,
      dryRun: isDryRun,
      remediation: {
        planId: finalIncident.remediation?.planId,
        strategy: finalIncident.remediation?.strategy,
        steps: finalIncident.remediation?.steps.map((s) => ({
          step: s.stepNumber,
          description: s.description,
          status: s.status,
          output: s.output,
        })),
        status: finalIncident.remediation?.status,
      },
      detectedStrategy: detectStrategy(lc),
    });
  },
};

const lifecycleRollbackTool = {
  name: "lifecycle_rollback",
  description:
    "Plan rollback for a failed remediation. Auto-detects the reverse strategy " +
    "or accepts an override. Transitions: remediating → rolling-back.",
  inputSchema: Type.Object({
    lifecycleId: Type.String({ description: "Lifecycle tracking ID" }),
    reason: Type.String({ description: "Reason for rollback" }),
    strategy: Type.Optional(
      Type.String({
        description:
          "Override rollback strategy. Options: restore-snapshot, " +
          "reverse-remediation, helm-rollback, k8s-rollout-undo, " +
          "azure-slot-swap-back, terraform-revert, manual",
      }),
    ),
    triggeredBy: Type.Optional(
      Type.String({ description: "User or system triggering rollback" }),
    ),
  }),
  execute: async (input: {
    lifecycleId: string;
    reason: string;
    strategy?: string;
    triggeredBy?: string;
  }) => {
    const lc = lifecycleStore.get(input.lifecycleId);
    if (!lc) return err(`Lifecycle not found: ${input.lifecycleId}`);

    const validRbStrategies = new Set([
      "restore-snapshot", "reverse-remediation", "helm-rollback",
      "k8s-rollout-undo", "azure-slot-swap-back", "terraform-revert", "manual",
    ]);
    if (input.strategy && !validRbStrategies.has(input.strategy)) {
      return err(`Invalid rollback strategy: ${input.strategy}. Valid: ${[...validRbStrategies].join(", ")}`);
    }

    const result = planRollback(lc, {
      lifecycleId: input.lifecycleId,
      reason: input.reason,
      strategy: input.strategy as RollbackStrategy | undefined,
      triggeredBy: input.triggeredBy,
    });
    if (!result.success) return err(result.error);

    lifecycleStore.set(result.incident.id, result.incident);

    return ok({
      lifecycleId: result.incident.id,
      phase: result.incident.phase,
      rollback: {
        planId: result.incident.rollback?.planId,
        strategy: result.incident.rollback?.strategy,
        steps: result.incident.rollback?.steps.map((s) => ({
          step: s.stepNumber,
          description: s.description,
          status: s.status,
        })),
        reason: result.incident.rollback?.reason,
      },
      detectedStrategy: detectRollbackStrategy(lc),
    });
  },
};

const lifecyclePostMortemTool = {
  name: "lifecycle_postmortem",
  description:
    "Generate a comprehensive post-mortem report: timeline reconstruction, " +
    "root cause analysis, impact assessment, remediation review, and action items. " +
    "Transitions: remediating/rolling-back → post-mortem.",
  inputSchema: Type.Object({
    lifecycleId: Type.String({ description: "Lifecycle tracking ID" }),
    lessonsLearned: Type.Optional(
      Type.Array(Type.String(), { description: "Lessons learned from this incident" }),
    ),
    additionalActionItems: Type.Optional(
      Type.String({
        description:
          "JSON string — array of additional action items " +
          "(each: {title, description, priority, assignee, dueDate, category})",
      }),
    ),
    triggeredBy: Type.Optional(
      Type.String({ description: "User or system triggering post-mortem generation" }),
    ),
  }),
  execute: async (input: {
    lifecycleId: string;
    lessonsLearned?: string[];
    additionalActionItems?: string;
    triggeredBy?: string;
  }) => {
    const lc = lifecycleStore.get(input.lifecycleId);
    if (!lc) return err(`Lifecycle not found: ${input.lifecycleId}`);

    let additionalItems: any[] = [];
    if (input.additionalActionItems) {
      const parsed = parseJson<any[]>(input.additionalActionItems, "additionalActionItems");
      if (parsed.error) return err(parsed.error);
      additionalItems = parsed.data!;
    }

    const result = generatePostMortem(lc, {
      lifecycleId: input.lifecycleId,
      lessonsLearned: input.lessonsLearned,
      additionalActionItems: additionalItems,
      triggeredBy: input.triggeredBy,
    });
    if (!result.success) return err(result.error);

    lifecycleStore.set(result.incident.id, result.incident);

    const pm = result.incident.postMortem!;
    return ok({
      lifecycleId: result.incident.id,
      phase: result.incident.phase,
      postMortem: {
        id: pm.id,
        rootCause: pm.rootCause,
        impact: pm.impact,
        remediationReview: pm.remediationReview,
        actionItemCount: pm.actionItems.length,
        actionItems: pm.actionItems,
        lessonsLearned: pm.lessonsLearned,
        timelineEntries: pm.timeline.length,
        totalDurationMs: pm.totalDurationMs,
        mttrMs: pm.mttrMs,
      },
    });
  },
};

const lifecycleCloseTool = {
  name: "lifecycle_close",
  description:
    "Close an incident lifecycle after post-mortem is complete " +
    "(or from triaged if no remediation is needed). " +
    "Transitions: post-mortem/triaged → closed.",
  inputSchema: Type.Object({
    lifecycleId: Type.String({ description: "Lifecycle tracking ID" }),
    reason: Type.Optional(
      Type.String({ description: "Reason for closing" }),
    ),
    triggeredBy: Type.Optional(
      Type.String({ description: "User or system closing the lifecycle" }),
    ),
  }),
  execute: async (input: {
    lifecycleId: string;
    reason?: string;
    triggeredBy?: string;
  }) => {
    const lc = lifecycleStore.get(input.lifecycleId);
    if (!lc) return err(`Lifecycle not found: ${input.lifecycleId}`);

    const result = closeLifecycle(lc, {
      triggeredBy: input.triggeredBy ?? "system",
      reason: input.reason,
    });
    if (!result.success) return err(result.error);

    lifecycleStore.set(result.incident.id, result.incident);

    return ok({
      lifecycleId: result.incident.id,
      phase: result.incident.phase,
      phaseCount: result.incident.phaseHistory.length,
      totalPhases: result.incident.phaseHistory.map((p) => `${p.from} → ${p.to}`),
      message: "Incident lifecycle closed",
    });
  },
};

const lifecycleDashboardTool = {
  name: "lifecycle_dashboard",
  description:
    "View the incident lifecycle dashboard: aggregate stats, " +
    "filter by phase/cloud/severity, sort by priority. " +
    "Returns active incidents, MTTR, remediation success rate, rollback rate.",
  inputSchema: Type.Object({
    filter: Type.Optional(
      Type.String({
        description:
          "JSON string — filter object with optional fields: phases, clouds, " +
          "severities, initiatedAfter, initiatedBefore, assignee",
      }),
    ),
    sortByPriority: Type.Optional(
      Type.Boolean({ description: "Sort results by operational priority (default: true)" }),
    ),
  }),
  execute: async (input: { filter?: string; sortByPriority?: boolean }) => {
    let filter: LifecycleFilter = {};
    if (input.filter) {
      const parsed = parseJson<LifecycleFilter>(input.filter, "filter");
      if (parsed.error) return err(parsed.error);
      filter = parsed.data!;
    }

    const all = Array.from(lifecycleStore.values());
    const filtered = filterLifecycles(all, filter);
    const sorted =
      input.sortByPriority !== false ? sortByPriority(filtered) : filtered;
    const dashboard = buildDashboard(filtered);

    return ok({
      dashboard,
      incidents: sorted.map((lc) => ({
        lifecycleId: lc.id,
        incidentId: lc.incidentId,
        phase: lc.phase,
        severity: lc.classification?.adjustedSeverity ?? lc.incident.severity,
        cloud: lc.incident.cloud,
        title: lc.incident.title,
        assignee: lc.triage?.assignee,
        createdAt: lc.createdAt,
        updatedAt: lc.updatedAt,
      })),
    });
  },
};

/* ------------------------------------------------------------------ */
/*  Export factory                                                     */
/* ------------------------------------------------------------------ */

export function createLifecycleTools() {
  return [
    lifecycleCreateTool,
    lifecycleClassifyTool,
    lifecycleTriageTool,
    lifecycleRemediateTool,
    lifecycleRollbackTool,
    lifecyclePostMortemTool,
    lifecycleCloseTool,
    lifecycleDashboardTool,
  ];
}
