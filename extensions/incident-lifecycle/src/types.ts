// ─── Structured Incident Lifecycle Types ───────────────────────────────
//
// State machine: detected → classified → triaged → remediating → rolling-back → post-mortem → closed
// Composes: incident-view (detect/classify/triage), AWS reconciliation (remediate),
//           infrastructure rollback (rollback), and a new post-mortem engine.
// ────────────────────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/*  Re-export core incident types so consumers can use a single import */
/* ------------------------------------------------------------------ */

export type CloudProvider = "aws" | "azure" | "gcp" | "kubernetes";

export type IncidentSeverity = 1 | 2 | 3 | 4 | 5; // 1 = critical … 5 = informational

export type IncidentSource =
  | "cloudwatch-alarm"
  | "cloudwatch-insight"
  | "azure-metric-alert"
  | "azure-activity-log"
  | "gcp-alert-policy"
  | "gcp-uptime-check"
  | "k8s-event"
  | "custom";

/* ------------------------------------------------------------------ */
/*  Lifecycle state machine                                            */
/* ------------------------------------------------------------------ */

/** Ordered lifecycle phases. Each phase must be completed before the next. */
export type LifecyclePhase =
  | "detected"
  | "classified"
  | "triaged"
  | "remediating"
  | "rolling-back"
  | "post-mortem"
  | "closed";

/** Valid transitions: phase → allowed next phases. */
export const PHASE_TRANSITIONS: Record<LifecyclePhase, LifecyclePhase[]> = {
  detected: ["classified"],
  classified: ["triaged"],
  triaged: ["remediating", "closed"],             // can close without remediation
  remediating: ["rolling-back", "post-mortem"],   // success → post-mortem, failure → rollback
  "rolling-back": ["post-mortem"],                // after rollback always do post-mortem
  "post-mortem": ["closed"],
  closed: [],                                     // terminal
};

/** Priority ordering for phase — lower = earlier in lifecycle. */
export const PHASE_ORDER: Record<LifecyclePhase, number> = {
  detected: 0,
  classified: 1,
  triaged: 2,
  remediating: 3,
  "rolling-back": 4,
  "post-mortem": 5,
  closed: 6,
};

/* ------------------------------------------------------------------ */
/*  Lifecycle incident — wraps UnifiedIncident + lifecycle state       */
/* ------------------------------------------------------------------ */

export type LifecycleIncident = {
  /** Unique lifecycle tracking ID. */
  id: string;
  /** Reference to the original UnifiedIncident.id from incident-view. */
  incidentId: string;
  /** Current lifecycle phase. */
  phase: LifecyclePhase;
  /** Full phase history with timestamps. */
  phaseHistory: PhaseTransition[];
  /** Original incident data snapshot. */
  incident: IncidentSnapshot;
  /** Classification result (populated in "classified" phase). */
  classification: IncidentClassification | null;
  /** Triage result (populated in "triaged" phase). */
  triage: TriageResult | null;
  /** Remediation tracking (populated in "remediating" phase). */
  remediation: RemediationRecord | null;
  /** Rollback tracking (populated in "rolling-back" phase). */
  rollback: RollbackRecord | null;
  /** Post-mortem report (populated in "post-mortem" phase). */
  postMortem: PostMortemReport | null;
  /** ISO-8601 timestamp when lifecycle tracking started. */
  createdAt: string;
  /** ISO-8601 timestamp of last update. */
  updatedAt: string;
  /** User or system that initiated the lifecycle. */
  initiatedBy: string;
  /** Optional correlation group ID from incident-view. */
  correlationGroupId?: string;
  /** Arbitrary metadata. */
  metadata: Record<string, unknown>;
};

/* ------------------------------------------------------------------ */
/*  Phase transition record                                            */
/* ------------------------------------------------------------------ */

export type PhaseTransition = {
  from: LifecyclePhase | "init";
  to: LifecyclePhase;
  timestamp: string; // ISO-8601
  triggeredBy: string;
  reason: string;
  durationMs?: number; // time spent in the "from" phase
};

/* ------------------------------------------------------------------ */
/*  Incident snapshot (from incident-view UnifiedIncident)             */
/* ------------------------------------------------------------------ */

export type IncidentSnapshot = {
  id: string;
  cloud: CloudProvider;
  source: IncidentSource;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: string;
  resource: string;
  region: string;
  startedAt: string;
  tags: Record<string, string>;
};

/* ------------------------------------------------------------------ */
/*  Classification                                                     */
/* ------------------------------------------------------------------ */

export type IncidentCategory =
  | "infrastructure-failure"
  | "configuration-drift"
  | "security-breach"
  | "performance-degradation"
  | "cost-anomaly"
  | "availability-loss"
  | "network-issue"
  | "scaling-issue"
  | "deployment-failure"
  | "unknown";

export type IncidentClassification = {
  category: IncidentCategory;
  severity: IncidentSeverity;
  /** Adjusted severity (may differ from original after classification). */
  adjustedSeverity: IncidentSeverity;
  /** Whether this is likely a symptom of a wider issue. */
  isSymptom: boolean;
  /** Confidence of the classification (0–1). */
  confidence: number;
  /** Free-text reasoning for the classification. */
  reasoning: string;
  /** Suggested remediation approach. */
  suggestedApproach: RemediationApproach;
  /** Auto-detected from incident data. */
  affectedServices: string[];
  /** Estimated blast radius. */
  blastRadius: "single-resource" | "service" | "region" | "multi-region" | "global";
  classifiedAt: string;
};

export type RemediationApproach =
  | "auto-remediate"
  | "manual-remediate"
  | "rollback"
  | "scale"
  | "restart"
  | "failover"
  | "investigate"
  | "no-action";

/* ------------------------------------------------------------------ */
/*  Triage                                                             */
/* ------------------------------------------------------------------ */

export type TriageResult = {
  /** Priority rank (1 = highest). */
  priority: number;
  /** Assigned team/owner. */
  assignee: string;
  /** Whether auto-remediation is recommended. */
  autoRemediationRecommended: boolean;
  /** Estimated time to remediate in minutes. */
  estimatedTimeMinutes: number;
  /** Dependencies that should be checked first. */
  prerequisites: string[];
  /** Related incidents that should be reviewed together. */
  relatedIncidentIds: string[];
  /** Escalation level. */
  escalation: "none" | "team-lead" | "on-call" | "management" | "executive";
  triagedAt: string;
};

/* ------------------------------------------------------------------ */
/*  Remediation                                                        */
/* ------------------------------------------------------------------ */

export type RemediationStrategy =
  | "aws-reconciliation"
  | "k8s-rollout-restart"
  | "k8s-scale"
  | "helm-rollback"
  | "azure-slot-swap"
  | "azure-traffic-shift"
  | "terraform-apply"
  | "custom-runbook"
  | "manual";

export type RemediationStep = {
  stepNumber: number;
  strategy: RemediationStrategy;
  description: string;
  parameters: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  canRetry: boolean;
  retryCount: number;
  maxRetries: number;
};

export type RemediationRecord = {
  planId: string;
  strategy: RemediationStrategy;
  steps: RemediationStep[];
  status: "planned" | "executing" | "completed" | "failed" | "aborted";
  startedAt: string;
  completedAt?: string;
  /** Whether the remediation was executed automatically. */
  autoExecuted: boolean;
  /** Pre-remediation state snapshot for potential rollback. */
  preRemediationSnapshot: Record<string, unknown>;
  /** Approval info if required. */
  approvedBy?: string;
  approvedAt?: string;
  /** Total remediation duration in ms. */
  durationMs?: number;
};

/* ------------------------------------------------------------------ */
/*  Rollback                                                           */
/* ------------------------------------------------------------------ */

export type RollbackStrategy =
  | "restore-snapshot"
  | "reverse-remediation"
  | "helm-rollback"
  | "k8s-rollout-undo"
  | "azure-slot-swap-back"
  | "terraform-revert"
  | "manual";

export type RollbackStep = {
  stepNumber: number;
  strategy: RollbackStrategy;
  description: string;
  parameters: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  canRetry: boolean;
};

export type RollbackRecord = {
  planId: string;
  strategy: RollbackStrategy;
  steps: RollbackStep[];
  status: "planned" | "executing" | "completed" | "failed";
  reason: string;
  startedAt: string;
  completedAt?: string;
  /** Whether the original pre-remediation state was restored. */
  stateRestored: boolean;
  durationMs?: number;
};

/* ------------------------------------------------------------------ */
/*  Post-Mortem                                                        */
/* ------------------------------------------------------------------ */

export type PostMortemReport = {
  id: string;
  lifecycleId: string;
  /** Reconstructed timeline of all events. */
  timeline: PostMortemTimelineEntry[];
  /** Root cause analysis. */
  rootCause: RootCauseAnalysis;
  /** Impact assessment. */
  impact: ImpactAssessment;
  /** Remediation effectiveness. */
  remediationReview: RemediationReview;
  /** Action items to prevent recurrence. */
  actionItems: ActionItem[];
  /** Lessons learned. */
  lessonsLearned: string[];
  /** Total incident duration from detection to close. */
  totalDurationMs: number;
  /** MTTR from detection to remediation completion. */
  mttrMs: number;
  generatedAt: string;
  /** Whether this post-mortem has been reviewed by a human. */
  reviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type PostMortemTimelineEntry = {
  timestamp: string;
  phase: LifecyclePhase | "init";
  event: string;
  details: string;
  actor: string; // "system" | user id
};

export type RootCauseAnalysis = {
  /** Primary root cause category. */
  category: IncidentCategory;
  /** Human-readable root cause summary. */
  summary: string;
  /** Contributing factors. */
  contributingFactors: string[];
  /** Was this a known issue? */
  knownIssue: boolean;
  /** Confidence in the root cause analysis (0–1). */
  confidence: number;
};

export type ImpactAssessment = {
  /** Services affected. */
  affectedServices: string[];
  /** Regions affected. */
  affectedRegions: string[];
  /** Cloud providers affected. */
  affectedClouds: CloudProvider[];
  /** Blast radius. */
  blastRadius: "single-resource" | "service" | "region" | "multi-region" | "global";
  /** Estimated number of affected users (0 if unknown). */
  estimatedAffectedUsers: number;
  /** Whether data loss occurred. */
  dataLoss: boolean;
  /** Estimated financial impact in USD (0 if unknown). */
  estimatedCostUsd: number;
  /** SLA breached? */
  slaBreached: boolean;
};

export type RemediationReview = {
  /** Was remediation attempted? */
  attempted: boolean;
  /** Was remediation successful? */
  successful: boolean;
  /** Was rollback needed? */
  rollbackNeeded: boolean;
  /** Was rollback successful? */
  rollbackSuccessful: boolean | null;
  /** Strategy used. */
  strategyUsed: RemediationStrategy | null;
  /** Time from triage to remediation start in ms. */
  timeToRemediateMs: number;
  /** What could be improved. */
  improvements: string[];
};

export type ActionItem = {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  assignee: string;
  dueDate: string;
  status: "open" | "in-progress" | "completed";
  category: "prevention" | "detection" | "response" | "documentation" | "tooling";
};

/* ------------------------------------------------------------------ */
/*  Lifecycle manager input types                                      */
/* ------------------------------------------------------------------ */

export type CreateLifecycleInput = {
  incidentId: string;
  incident: IncidentSnapshot;
  initiatedBy: string;
  correlationGroupId?: string;
  metadata?: Record<string, unknown>;
};

/** Input for classifying a lifecycle incident (used by gateway methods). */
export type ClassifyInput = {
  lifecycleId: string;
  triggeredBy?: string;
};

/** Input for triaging a lifecycle incident (used by gateway methods). */
export type TriageInput = {
  lifecycleId: string;
  assignee?: string;
  relatedIncidentIds?: string[];
  triggeredBy?: string;
};

export type RemediateInput = {
  lifecycleId: string;
  strategy?: RemediationStrategy;
  parameters?: Record<string, unknown>;
  autoExecute?: boolean;
  triggeredBy?: string;
};

export type RollbackInput = {
  lifecycleId: string;
  reason: string;
  strategy?: RollbackStrategy;
  triggeredBy?: string;
};

export type PostMortemInput = {
  lifecycleId: string;
  lessonsLearned?: string[];
  additionalActionItems?: Omit<ActionItem, "id" | "status">[];
  triggeredBy?: string;
};

/** Input for closing a lifecycle incident (used by gateway methods). */
export type CloseInput = {
  lifecycleId: string;
  reason?: string;
  triggeredBy?: string;
};

export type LifecycleFilter = {
  phases?: LifecyclePhase[];
  clouds?: CloudProvider[];
  severities?: IncidentSeverity[];
  initiatedAfter?: string;
  initiatedBefore?: string;
  assignee?: string;
};

export type LifecycleDashboard = {
  total: number;
  byPhase: Record<LifecyclePhase, number>;
  bySeverity: Record<number, number>;
  byCloud: Record<string, number>;
  avgMttrMs: number | null;
  activeIncidents: number;
  remediationSuccessRate: number | null;
  rollbackRate: number | null;
  oldestActiveAt: string | null;
};
