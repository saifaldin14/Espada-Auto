// ─── Post-Mortem Engine ────────────────────────────────────────────────
//
// Generates comprehensive post-mortem reports from lifecycle data.
// Reconstructs timeline, analyzes root cause, assesses impact,
// reviews remediation effectiveness, and generates action items.
// ───────────────────────────────────────────────────────────────────────

import type {
  LifecycleIncident,
  PostMortemReport,
  PostMortemTimelineEntry,
  RootCauseAnalysis,
  ImpactAssessment,
  RemediationReview,
  ActionItem,
  PostMortemInput,
  LifecyclePhase,
} from "./types.js";
import { transitionPhase } from "./state-machine.js";
import type { TransitionResult } from "./state-machine.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let _pmCounter = 0;

function generatePmId(): string {
  _pmCounter += 1;
  return `pm-${Date.now()}-${_pmCounter}`;
}

export function resetPmCounter(): void {
  _pmCounter = 0;
}

let _actionCounter = 0;

function generateActionId(): string {
  _actionCounter += 1;
  return `action-${Date.now()}-${_actionCounter}`;
}

export function resetActionCounter(): void {
  _actionCounter = 0;
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Timeline reconstruction                                            */
/* ------------------------------------------------------------------ */

/**
 * Reconstruct a chronological timeline from lifecycle phase history,
 * remediation steps, and rollback steps.
 */
export function reconstructTimeline(
  incident: LifecycleIncident,
): PostMortemTimelineEntry[] {
  const entries: PostMortemTimelineEntry[] = [];

  // Phase transitions
  for (const transition of incident.phaseHistory) {
    entries.push({
      timestamp: transition.timestamp,
      phase: transition.from as LifecyclePhase | "init",
      event: `Phase transition: ${transition.from} → ${transition.to}`,
      details: transition.reason,
      actor: transition.triggeredBy,
    });
  }

  // Classification event
  if (incident.classification) {
    entries.push({
      timestamp: incident.classification.classifiedAt,
      phase: "classified",
      event: `Classified as ${incident.classification.category}`,
      details: `Severity: ${incident.classification.adjustedSeverity}, ` +
        `Blast radius: ${incident.classification.blastRadius}, ` +
        `Approach: ${incident.classification.suggestedApproach}`,
      actor: "system",
    });
  }

  // Triage event
  if (incident.triage) {
    entries.push({
      timestamp: incident.triage.triagedAt,
      phase: "triaged",
      event: `Triaged: priority ${incident.triage.priority}`,
      details: `Assigned to: ${incident.triage.assignee}, ` +
        `Escalation: ${incident.triage.escalation}, ` +
        `Auto-remediation: ${incident.triage.autoRemediationRecommended ? "yes" : "no"}`,
      actor: "system",
    });
  }

  // Remediation steps
  if (incident.remediation) {
    entries.push({
      timestamp: incident.remediation.startedAt,
      phase: "remediating",
      event: `Remediation started: ${incident.remediation.strategy}`,
      details: `${incident.remediation.steps.length} steps planned, ` +
        `auto-executed: ${incident.remediation.autoExecuted ? "yes" : "no"}`,
      actor: "system",
    });

    for (const step of incident.remediation.steps) {
      if (step.startedAt) {
        entries.push({
          timestamp: step.startedAt,
          phase: "remediating",
          event: `Step ${step.stepNumber} started: ${step.description}`,
          details: step.status === "failed"
            ? `FAILED: ${step.error ?? "Unknown error"}`
            : step.status === "completed"
              ? `Completed${step.output ? `: ${step.output}` : ""}`
              : `Status: ${step.status}`,
          actor: "system",
        });
      }
    }

    if (incident.remediation.completedAt) {
      entries.push({
        timestamp: incident.remediation.completedAt,
        phase: "remediating",
        event: `Remediation ${incident.remediation.status}`,
        details: incident.remediation.durationMs
          ? `Duration: ${Math.round(incident.remediation.durationMs / 1000)}s`
          : "",
        actor: "system",
      });
    }
  }

  // Rollback steps
  if (incident.rollback) {
    entries.push({
      timestamp: incident.rollback.startedAt,
      phase: "rolling-back",
      event: `Rollback started: ${incident.rollback.strategy}`,
      details: `Reason: ${incident.rollback.reason}`,
      actor: "system",
    });

    for (const step of incident.rollback.steps) {
      if (step.startedAt) {
        entries.push({
          timestamp: step.startedAt,
          phase: "rolling-back",
          event: `Rollback step ${step.stepNumber}: ${step.description}`,
          details: step.status === "failed"
            ? `FAILED: ${step.error ?? "Unknown error"}`
            : step.status === "completed"
              ? `Completed${step.output ? `: ${step.output}` : ""}`
              : `Status: ${step.status}`,
          actor: "system",
        });
      }
    }

    if (incident.rollback.completedAt) {
      entries.push({
        timestamp: incident.rollback.completedAt,
        phase: "rolling-back",
        event: `Rollback ${incident.rollback.status}`,
        details: `State restored: ${incident.rollback.stateRestored ? "yes" : "no"}`,
        actor: "system",
      });
    }
  }

  // Sort chronologically
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return entries;
}

/* ------------------------------------------------------------------ */
/*  Root cause analysis                                                */
/* ------------------------------------------------------------------ */

export function analyzeRootCause(
  incident: LifecycleIncident,
): RootCauseAnalysis {
  const cls = incident.classification;
  const category = cls?.category ?? "unknown";
  const inc = incident.incident;

  const contributingFactors: string[] = [];

  // Derive contributing factors from classification + incident data
  if (cls) {
    if (cls.blastRadius !== "single-resource") {
      contributingFactors.push(
        `Wide blast radius (${cls.blastRadius}) suggests systemic issue`,
      );
    }
    if (cls.isSymptom) {
      contributingFactors.push(
        "This incident may be a symptom of a larger underlying issue",
      );
    }
    if (cls.adjustedSeverity < cls.severity) {
      contributingFactors.push(
        `Severity was escalated from ${cls.severity} to ${cls.adjustedSeverity} due to environmental factors`,
      );
    }
  }

  // Check if remediation failed
  if (incident.remediation?.status === "failed") {
    const failedStep = incident.remediation.steps.find(
      (s) => s.status === "failed",
    );
    if (failedStep) {
      contributingFactors.push(
        `Remediation failed at step ${failedStep.stepNumber}: ${failedStep.error ?? "unknown"}`,
      );
    }
  }

  // Check if rollback was needed
  if (incident.rollback) {
    contributingFactors.push(
      `Rollback was required: ${incident.rollback.reason}`,
    );
  }

  const summary = buildRootCauseSummary(category, inc, cls);

  return {
    category,
    summary,
    contributingFactors,
    knownIssue: false,
    confidence: cls?.confidence ?? 0.5,
  };
}

function buildRootCauseSummary(
  category: string,
  inc: LifecycleIncident["incident"],
  cls: LifecycleIncident["classification"],
): string {
  const resource = inc.resource;
  const cloud = inc.cloud;

  const summaries: Record<string, string> = {
    "configuration-drift": `Configuration drift detected on ${cloud} resource ${resource}. ` +
      `The actual state diverged from the expected configuration.`,
    "infrastructure-failure": `Infrastructure failure on ${cloud} resource ${resource}. ` +
      `The resource experienced a critical failure requiring intervention.`,
    "security-breach": `Security incident detected on ${cloud} resource ${resource}. ` +
      `Unauthorized access or vulnerability exploitation was identified.`,
    "performance-degradation": `Performance degradation detected on ${cloud} resource ${resource}. ` +
      `Response times or throughput fell below acceptable thresholds.`,
    "cost-anomaly": `Cost anomaly detected for ${cloud} resource ${resource}. ` +
      `Spending exceeded expected patterns.`,
    "availability-loss": `Availability loss for ${cloud} resource ${resource}. ` +
      `The resource became unreachable or returned errors.`,
    "network-issue": `Network issue affecting ${cloud} resource ${resource}. ` +
      `Connectivity problems were detected.`,
    "scaling-issue": `Scaling issue on ${cloud} resource ${resource}. ` +
      `The resource could not handle the current load.`,
    "deployment-failure": `Deployment failure on ${cloud} resource ${resource}. ` +
      `A deployment or release did not complete successfully.`,
  };

  return (
    summaries[category] ??
    `Incident on ${cloud} resource ${resource}: ${inc.title}`
  );
}

/* ------------------------------------------------------------------ */
/*  Impact assessment                                                  */
/* ------------------------------------------------------------------ */

export function assessImpact(
  incident: LifecycleIncident,
): ImpactAssessment {
  const cls = incident.classification;
  const inc = incident.incident;

  return {
    affectedServices: cls?.affectedServices ?? [inc.resource],
    affectedRegions: [inc.region],
    affectedClouds: [inc.cloud],
    blastRadius: cls?.blastRadius ?? "single-resource",
    estimatedAffectedUsers: 0, // requires external data
    dataLoss: false,
    estimatedCostUsd: 0, // requires external data
    slaBreached: (cls?.adjustedSeverity ?? inc.severity) <= 2,
  };
}

/* ------------------------------------------------------------------ */
/*  Remediation review                                                 */
/* ------------------------------------------------------------------ */

export function reviewRemediation(
  incident: LifecycleIncident,
): RemediationReview {
  const rem = incident.remediation;
  const rb = incident.rollback;

  const attempted = rem !== null;
  const successful = rem?.status === "completed";
  const rollbackNeeded = rb !== null;
  const rollbackSuccessful = rb ? rb.status === "completed" : null;

  // Time to remediate: from triage to remediation start
  let timeToRemediateMs = 0;
  if (incident.triage && rem) {
    timeToRemediateMs = Math.max(
      0,
      new Date(rem.startedAt).getTime() -
        new Date(incident.triage.triagedAt).getTime(),
    );
  }

  const improvements: string[] = [];

  if (!attempted) {
    improvements.push("No remediation was attempted — consider implementing automated remediation");
  }
  if (attempted && !successful) {
    improvements.push(
      `Remediation strategy "${rem?.strategy}" failed — review strategy selection logic`,
    );
  }
  if (rollbackNeeded) {
    improvements.push(
      "Rollback was needed — improve pre-deployment validation and testing",
    );
  }
  if (timeToRemediateMs > 300_000) {
    // > 5 min
    improvements.push(
      `Time to remediate was ${Math.round(timeToRemediateMs / 60_000)} minutes — ` +
        `consider faster detection and auto-remediation`,
    );
  }
  if (rem && !rem.autoExecuted) {
    improvements.push(
      "Remediation required manual execution — evaluate if auto-execution is safe",
    );
  }

  return {
    attempted,
    successful,
    rollbackNeeded,
    rollbackSuccessful,
    strategyUsed: rem?.strategy ?? null,
    timeToRemediateMs,
    improvements,
  };
}

/* ------------------------------------------------------------------ */
/*  Action items                                                       */
/* ------------------------------------------------------------------ */

export function generateActionItems(
  incident: LifecycleIncident,
  additional: Omit<ActionItem, "id" | "status">[] = [],
): ActionItem[] {
  const items: ActionItem[] = [];
  const cls = incident.classification;
  const rem = incident.remediation;
  const rb = incident.rollback;

  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Always: document the incident
  items.push({
    id: generateActionId(),
    title: "Document root cause and resolution",
    description: `Document the root cause analysis and resolution steps for incident "${incident.incident.title}"`,
    priority: "medium",
    assignee: incident.triage?.assignee ?? "unassigned",
    dueDate,
    status: "open",
    category: "documentation",
  });

  // If classification confidence is low
  if (cls && cls.confidence < 0.7) {
    items.push({
      id: generateActionId(),
      title: "Improve incident classification rules",
      description: `Classification confidence was ${cls.confidence} — ` +
        `review and improve detection rules for "${cls.category}" incidents`,
      priority: "medium",
      assignee: "platform-team",
      dueDate,
      status: "open",
      category: "detection",
    });
  }

  // If remediation failed
  if (rem?.status === "failed") {
    items.push({
      id: generateActionId(),
      title: "Fix remediation strategy",
      description: `Remediation strategy "${rem.strategy}" failed — ` +
        `investigate root cause and fix the remediation workflow`,
      priority: "high",
      assignee: incident.triage?.assignee ?? "platform-team",
      dueDate,
      status: "open",
      category: "response",
    });
  }

  // If rollback was needed
  if (rb) {
    items.push({
      id: generateActionId(),
      title: "Add pre-deployment validation",
      description: "Rollback was required — add validation checks before " +
        "deploying changes to prevent similar issues",
      priority: "high",
      assignee: "platform-team",
      dueDate,
      status: "open",
      category: "prevention",
    });
  }

  // If blast radius was large
  if (
    cls &&
    (cls.blastRadius === "region" ||
      cls.blastRadius === "multi-region" ||
      cls.blastRadius === "global")
  ) {
    items.push({
      id: generateActionId(),
      title: "Implement blast radius containment",
      description: `Incident had ${cls.blastRadius} blast radius — ` +
        `implement resource isolation and circuit breakers`,
      priority: "critical",
      assignee: "platform-team",
      dueDate,
      status: "open",
      category: "prevention",
    });
  }

  // If severity was critical
  if ((cls?.adjustedSeverity ?? incident.incident.severity) === 1) {
    items.push({
      id: generateActionId(),
      title: "Add monitoring and alerting",
      description: "Critical severity incident — ensure monitoring " +
        "and alerting are in place to detect early",
      priority: "high",
      assignee: "platform-team",
      dueDate,
      status: "open",
      category: "detection",
    });
  }

  // If auto-remediation could have been used but wasn't
  if (
    cls?.suggestedApproach === "auto-remediate" &&
    rem &&
    !rem.autoExecuted
  ) {
    items.push({
      id: generateActionId(),
      title: "Enable auto-remediation for this category",
      description: `Auto-remediation was recommended for "${cls.category}" ` +
        `but was not enabled — evaluate if safe to enable`,
      priority: "medium",
      assignee: "platform-team",
      dueDate,
      status: "open",
      category: "tooling",
    });
  }

  // Add user-provided action items
  for (const item of additional) {
    items.push({
      ...item,
      id: generateActionId(),
      status: "open",
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Generate post-mortem                                               */
/* ------------------------------------------------------------------ */

/**
 * Generate a full post-mortem report and transition incident to "post-mortem" phase.
 */
export function generatePostMortem(
  incident: LifecycleIncident,
  input: PostMortemInput,
): TransitionResult {
  // Accept from either "remediating" (success) or "rolling-back" (after rollback)
  if (incident.phase !== "remediating" && incident.phase !== "rolling-back") {
    return {
      success: false,
      error: `Cannot generate post-mortem: incident is in "${incident.phase}" phase, ` +
        `expected "remediating" or "rolling-back"`,
    };
  }

  const timeline = reconstructTimeline(incident);
  const rootCause = analyzeRootCause(incident);
  const impact = assessImpact(incident);
  const remediationReview = reviewRemediation(incident);
  const actionItems = generateActionItems(incident, input.additionalActionItems);

  // Calculate total duration and MTTR
  const createdTime = new Date(incident.createdAt).getTime();
  const nowTime = Date.now();
  const totalDurationMs = nowTime - createdTime;

  // MTTR: time from detection to remediation completion (or now)
  const remCompletedAt = incident.remediation?.completedAt;
  const mttrMs = remCompletedAt
    ? new Date(remCompletedAt).getTime() - createdTime
    : totalDurationMs;

  const report: PostMortemReport = {
    id: generatePmId(),
    lifecycleId: incident.id,
    timeline,
    rootCause,
    impact,
    remediationReview,
    actionItems,
    lessonsLearned: input.lessonsLearned ?? [],
    totalDurationMs,
    mttrMs,
    generatedAt: now(),
    reviewed: false,
  };

  const result = transitionPhase(
    incident,
    "post-mortem",
    input.triggeredBy ?? "system",
    `Post-mortem generated: ${actionItems.length} action items, ` +
      `MTTR: ${Math.round(mttrMs / 1000)}s`,
  );

  if (!result.success) return result;

  return {
    success: true,
    incident: {
      ...result.incident,
      postMortem: report,
    },
  };
}

/**
 * Close a lifecycle incident after post-mortem review.
 */
export function closeLifecycle(
  incident: LifecycleIncident,
  input: { triggeredBy: string; reason?: string },
): TransitionResult {
  if (incident.phase !== "post-mortem") {
    // Also allow closing from triage (no remediation needed)
    if (incident.phase === "triaged") {
      return transitionPhase(
        incident,
        "closed",
        input.triggeredBy,
        input.reason ?? "Closed without remediation",
      );
    }
    return {
      success: false,
      error: `Cannot close: incident is in "${incident.phase}" phase, ` +
        `expected "post-mortem" or "triaged"`,
    };
  }

  return transitionPhase(
    incident,
    "closed",
    input.triggeredBy,
    input.reason ?? "Post-mortem completed — incident closed",
  );
}
