// ─── Lifecycle State Machine ───────────────────────────────────────────
//
// Manages the lifecycle of an incident through all phases:
// detected → classified → triaged → remediating → rolling-back → post-mortem → closed
//
// Stateless functions — persistence is the caller's responsibility.
// ───────────────────────────────────────────────────────────────────────

import type {
  LifecycleIncident,
  LifecyclePhase,
  PhaseTransition,
  CreateLifecycleInput,
  LifecycleFilter,
  LifecycleDashboard,
  IncidentClassification,
  IncidentSeverity,
  TriageResult,
  RemediationRecord,
  RollbackRecord,
  PostMortemReport,
} from "./types.js";
import { PHASE_TRANSITIONS, PHASE_ORDER } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let _idCounter = 0;
function generateId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now()}-${_idCounter}`;
}

/** Reset the ID counter (for testing). */
export function resetIdCounter(): void {
  _idCounter = 0;
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Create a new lifecycle incident                                    */
/* ------------------------------------------------------------------ */

export function createLifecycleIncident(
  input: CreateLifecycleInput,
): LifecycleIncident {
  const ts = now();
  const id = generateId("lc");
  return {
    id,
    incidentId: input.incidentId,
    phase: "detected",
    phaseHistory: [
      {
        from: "init",
        to: "detected",
        timestamp: ts,
        triggeredBy: input.initiatedBy,
        reason: "Incident lifecycle initiated",
      },
    ],
    incident: { ...input.incident },
    classification: null,
    triage: null,
    remediation: null,
    rollback: null,
    postMortem: null,
    createdAt: ts,
    updatedAt: ts,
    initiatedBy: input.initiatedBy,
    correlationGroupId: input.correlationGroupId,
    metadata: input.metadata ?? {},
  };
}

/* ------------------------------------------------------------------ */
/*  Phase transition                                                   */
/* ------------------------------------------------------------------ */

export type TransitionError = {
  success: false;
  error: string;
};

export type TransitionSuccess = {
  success: true;
  incident: LifecycleIncident;
};

export type TransitionResult = TransitionError | TransitionSuccess;

/**
 * Attempt to transition a lifecycle incident to a new phase.
 * Returns a new object (immutable pattern) or an error.
 */
export function transitionPhase(
  incident: LifecycleIncident,
  toPhase: LifecyclePhase,
  triggeredBy: string,
  reason: string,
): TransitionResult {
  const allowed = PHASE_TRANSITIONS[incident.phase];
  if (!allowed.includes(toPhase)) {
    return {
      success: false,
      error: `Invalid transition: "${incident.phase}" → "${toPhase}". Allowed: [${allowed.join(", ")}]`,
    };
  }

  const ts = now();
  const lastTransition = incident.phaseHistory[incident.phaseHistory.length - 1];
  const durationMs = lastTransition
    ? new Date(ts).getTime() - new Date(lastTransition.timestamp).getTime()
    : undefined;

  const transition: PhaseTransition = {
    from: incident.phase,
    to: toPhase,
    timestamp: ts,
    triggeredBy,
    reason,
    durationMs,
  };

  return {
    success: true,
    incident: {
      ...incident,
      phase: toPhase,
      phaseHistory: [...incident.phaseHistory, transition],
      updatedAt: ts,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Classify                                                           */
/* ------------------------------------------------------------------ */

/**
 * Classify an incident based on its data.
 * Auto-detects category, adjusts severity, estimates blast radius.
 */
export function classifyIncident(
  incident: LifecycleIncident,
  triggeredBy: string,
): TransitionResult {
  if (incident.phase !== "detected") {
    return {
      success: false,
      error: `Cannot classify: incident is in "${incident.phase}" phase, expected "detected"`,
    };
  }

  const classification = buildClassification(incident);

  const result = transitionPhase(
    incident,
    "classified",
    triggeredBy,
    `Classified as ${classification.category} (severity ${classification.adjustedSeverity})`,
  );

  if (!result.success) return result;

  return {
    success: true,
    incident: {
      ...result.incident,
      classification,
    },
  };
}

function buildClassification(
  lc: LifecycleIncident,
): IncidentClassification {
  const inc = lc.incident;
  const category = detectCategory(inc);
  const adjustedSeverity = adjustSeverity(inc.severity, category, inc);
  const blastRadius = estimateBlastRadius(inc);
  const approach = suggestApproach(category, adjustedSeverity);

  return {
    category,
    severity: inc.severity,
    adjustedSeverity,
    isSymptom: false,
    confidence: 0.75,
    reasoning: `Auto-classified as "${category}" based on source "${inc.source}" and resource "${inc.resource}"`,
    suggestedApproach: approach,
    affectedServices: extractServices(inc),
    blastRadius,
    classifiedAt: now(),
  };
}

function detectCategory(
  inc: LifecycleIncident["incident"],
): IncidentClassification["category"] {
  const title = inc.title.toLowerCase();
  const desc = inc.description.toLowerCase();
  const combined = `${title} ${desc}`;

  if (/security|breach|unauthorized|intrusion|vulnerability/.test(combined)) {
    return "security-breach";
  }
  if (/drift|configuration.?change|unexpected.?modif/.test(combined)) {
    return "configuration-drift";
  }
  if (/cost|billing|spend|budget|anomal/.test(combined)) {
    return "cost-anomaly";
  }
  if (/latency|slow|timeout|performance|cpu|memory/.test(combined)) {
    return "performance-degradation";
  }
  if (/down|unavailable|unreachable|outage|5[0-9]{2}/.test(combined)) {
    return "availability-loss";
  }
  if (/network|dns|routing|connectivity|vpc|subnet/.test(combined)) {
    return "network-issue";
  }
  if (/scale|capacity|limit|quota|throttl/.test(combined)) {
    return "scaling-issue";
  }
  if (/deploy|release|rollout|pipeline|ci.?cd/.test(combined)) {
    return "deployment-failure";
  }
  if (/fail|crash|error|exception|panic/.test(combined)) {
    return "infrastructure-failure";
  }
  return "unknown";
}

function adjustSeverity(
  original: IncidentSeverity,
  category: IncidentClassification["category"],
  inc: LifecycleIncident["incident"],
): IncidentClassification["adjustedSeverity"] {
  let sev = original;

  // Security breaches bump up by 1
  if (category === "security-breach" && sev > 1) sev -= 1;

  // Production resources bump up by 1
  const resource = inc.resource.toLowerCase();
  if (/prod|production/.test(resource) && sev > 1) sev -= 1;

  // Availability loss in production is always at least severity 2
  if (category === "availability-loss" && /prod/.test(resource) && sev > 2) {
    sev = 2;
  }

  return Math.max(1, Math.min(5, sev)) as IncidentClassification["adjustedSeverity"];
}

function estimateBlastRadius(
  inc: LifecycleIncident["incident"],
): IncidentClassification["blastRadius"] {
  const resource = inc.resource.toLowerCase();
  if (/global|multi.?region/.test(resource)) return "global";
  if (/region|vpc|network/.test(resource)) return "region";
  if (/service|cluster|namespace/.test(resource)) return "service";
  if (inc.region === "global" || inc.region === "multi-region") return "multi-region";
  return "single-resource";
}

function suggestApproach(
  category: IncidentClassification["category"],
  severity: number,
): IncidentClassification["suggestedApproach"] {
  switch (category) {
    case "configuration-drift":
      return "auto-remediate";
    case "deployment-failure":
      return "rollback";
    case "scaling-issue":
      return "scale";
    case "availability-loss":
      return severity <= 2 ? "restart" : "investigate";
    case "security-breach":
      return "manual-remediate";
    case "cost-anomaly":
      return "investigate";
    case "network-issue":
      return "investigate";
    case "performance-degradation":
      return severity <= 2 ? "scale" : "investigate";
    case "infrastructure-failure":
      return severity <= 2 ? "auto-remediate" : "investigate";
    default:
      return "investigate";
  }
}

function extractServices(inc: LifecycleIncident["incident"]): string[] {
  const services: string[] = [];
  const resource = inc.resource;

  // Extract AWS service from ARN
  const arnMatch = resource.match(/arn:aws:([^:]+)/);
  if (arnMatch) services.push(`aws:${arnMatch[1]}`);

  // Extract Azure service from resource ID
  const azureMatch = resource.match(/providers\/Microsoft\.([^/]+)/i);
  if (azureMatch) services.push(`azure:${azureMatch[1]}`);

  // Extract K8s resource kind
  if (inc.cloud === "kubernetes") {
    const k8sMatch = resource.match(/^([^/]+)\//);
    if (k8sMatch) services.push(`k8s:${k8sMatch[1]}`);
  }

  if (services.length === 0) services.push(resource);
  return services;
}

/* ------------------------------------------------------------------ */
/*  Triage                                                             */
/* ------------------------------------------------------------------ */

/**
 * Triage a classified incident: assign priority, owner, escalation.
 */
export function triageIncident(
  incident: LifecycleIncident,
  options: {
    assignee?: string;
    relatedIncidentIds?: string[];
    triggeredBy: string;
  },
): TransitionResult {
  if (incident.phase !== "classified") {
    return {
      success: false,
      error: `Cannot triage: incident is in "${incident.phase}" phase, expected "classified"`,
    };
  }

  if (!incident.classification) {
    return {
      success: false,
      error: "Cannot triage: no classification data available",
    };
  }

  const triage = buildTriage(incident, options);

  const result = transitionPhase(
    incident,
    "triaged",
    options.triggeredBy,
    `Triaged: priority ${triage.priority}, assigned to ${triage.assignee}, escalation: ${triage.escalation}`,
  );

  if (!result.success) return result;

  return {
    success: true,
    incident: {
      ...result.incident,
      triage,
    },
  };
}

function buildTriage(
  lc: LifecycleIncident,
  options: { assignee?: string; relatedIncidentIds?: string[] },
): TriageResult {
  const cls = lc.classification!;

  // Priority is adjusted severity (1 = highest)
  const priority = cls.adjustedSeverity;

  // Estimate time to remediate based on category
  const estimatedTimeMinutes = estimateRemediationTime(cls.category, cls.blastRadius);

  // Determine escalation level
  const escalation = determineEscalation(cls.adjustedSeverity, cls.category);

  // Determine if auto-remediation is appropriate
  const autoRemediationRecommended =
    cls.suggestedApproach === "auto-remediate" &&
    cls.adjustedSeverity >= 3 && // don't auto-remediate critical/high without review
    cls.blastRadius === "single-resource";

  return {
    priority,
    assignee: options.assignee ?? "unassigned",
    autoRemediationRecommended,
    estimatedTimeMinutes,
    prerequisites: buildPrerequisites(cls),
    relatedIncidentIds: options.relatedIncidentIds ?? [],
    escalation,
    triagedAt: now(),
  };
}

function estimateRemediationTime(
  category: IncidentClassification["category"],
  blastRadius: IncidentClassification["blastRadius"],
): number {
  const baseTimes: Record<string, number> = {
    "configuration-drift": 15,
    "scaling-issue": 10,
    "deployment-failure": 30,
    "availability-loss": 20,
    "performance-degradation": 30,
    "infrastructure-failure": 45,
    "network-issue": 30,
    "security-breach": 60,
    "cost-anomaly": 120,
    unknown: 60,
  };

  const multipliers: Record<string, number> = {
    "single-resource": 1,
    service: 1.5,
    region: 2,
    "multi-region": 3,
    global: 4,
  };

  return Math.round(
    (baseTimes[category] ?? 60) * (multipliers[blastRadius] ?? 1),
  );
}

function determineEscalation(
  severity: number,
  category: IncidentClassification["category"],
): TriageResult["escalation"] {
  if (severity === 1 || category === "security-breach") return "management";
  if (severity === 2) return "on-call";
  if (severity === 3) return "team-lead";
  return "none";
}

function buildPrerequisites(cls: IncidentClassification): string[] {
  const prereqs: string[] = [];
  if (cls.category === "configuration-drift") {
    prereqs.push("Capture current state snapshot before remediation");
  }
  if (cls.blastRadius !== "single-resource") {
    prereqs.push("Verify blast radius — check related resources");
  }
  if (cls.adjustedSeverity <= 2) {
    prereqs.push("Notify on-call engineer before proceeding");
  }
  if (cls.category === "security-breach") {
    prereqs.push("Isolate affected resources before remediation");
  }
  return prereqs;
}

/* ------------------------------------------------------------------ */
/*  Filter & dashboard                                                 */
/* ------------------------------------------------------------------ */

/**
 * Filter lifecycle incidents by multiple criteria.
 */
export function filterLifecycles(
  incidents: LifecycleIncident[],
  filter: LifecycleFilter,
): LifecycleIncident[] {
  return incidents.filter((lc) => {
    if (filter.phases && !filter.phases.includes(lc.phase)) return false;
    if (filter.clouds && !filter.clouds.includes(lc.incident.cloud)) return false;
    if (filter.severities && !filter.severities.includes(lc.incident.severity)) return false;
    if (filter.assignee && lc.triage?.assignee !== filter.assignee) return false;
    if (
      filter.initiatedAfter &&
      new Date(lc.createdAt) < new Date(filter.initiatedAfter)
    )
      return false;
    if (
      filter.initiatedBefore &&
      new Date(lc.createdAt) > new Date(filter.initiatedBefore)
    )
      return false;
    return true;
  });
}

/**
 * Generate a dashboard summary from lifecycle incidents.
 */
export function buildDashboard(
  incidents: LifecycleIncident[],
): LifecycleDashboard {
  const byPhase: Record<string, number> = {
    detected: 0,
    classified: 0,
    triaged: 0,
    remediating: 0,
    "rolling-back": 0,
    "post-mortem": 0,
    closed: 0,
  };
  const bySeverity: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byCloud: Record<string, number> = {};

  let mttrTotal = 0;
  let mttrCount = 0;
  let remediationAttempts = 0;
  let remediationSuccesses = 0;
  let rollbackCount = 0;
  let oldestActiveAt: string | null = null;
  let activeIncidents = 0;

  for (const lc of incidents) {
    byPhase[lc.phase] = (byPhase[lc.phase] ?? 0) + 1;
    bySeverity[lc.incident.severity] = (bySeverity[lc.incident.severity] ?? 0) + 1;
    byCloud[lc.incident.cloud] = (byCloud[lc.incident.cloud] ?? 0) + 1;

    if (lc.phase !== "closed") {
      activeIncidents += 1;
      if (!oldestActiveAt || lc.createdAt < oldestActiveAt) {
        oldestActiveAt = lc.createdAt;
      }
    }

    if (lc.postMortem) {
      mttrTotal += lc.postMortem.mttrMs;
      mttrCount += 1;
    }

    if (lc.remediation) {
      remediationAttempts += 1;
      if (lc.remediation.status === "completed") remediationSuccesses += 1;
    }

    if (lc.rollback) rollbackCount += 1;
  }

  return {
    total: incidents.length,
    byPhase: byPhase as Record<LifecyclePhase, number>,
    bySeverity,
    byCloud,
    avgMttrMs: mttrCount > 0 ? Math.round(mttrTotal / mttrCount) : null,
    activeIncidents,
    remediationSuccessRate:
      remediationAttempts > 0
        ? Math.round((remediationSuccesses / remediationAttempts) * 100)
        : null,
    rollbackRate:
      remediationAttempts > 0
        ? Math.round((rollbackCount / remediationAttempts) * 100)
        : null,
    oldestActiveAt,
  };
}

/**
 * Sort lifecycle incidents for operational priority.
 * Active incidents first, then by severity, then by phase order.
 */
export function sortByPriority(
  incidents: LifecycleIncident[],
): LifecycleIncident[] {
  return [...incidents].sort((a, b) => {
    // Active before closed
    const aActive = a.phase !== "closed" ? 0 : 1;
    const bActive = b.phase !== "closed" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;

    // By severity (lower = more critical)
    const aSev = a.classification?.adjustedSeverity ?? a.incident.severity;
    const bSev = b.classification?.adjustedSeverity ?? b.incident.severity;
    if (aSev !== bSev) return aSev - bSev;

    // By phase order (earlier in lifecycle = needs more attention)
    const aOrder = PHASE_ORDER[a.phase];
    const bOrder = PHASE_ORDER[b.phase];
    if (aOrder !== bOrder) return aOrder - bOrder;

    // By creation time (oldest first)
    return a.createdAt.localeCompare(b.createdAt);
  });
}
