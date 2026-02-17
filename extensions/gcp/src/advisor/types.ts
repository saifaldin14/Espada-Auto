/**
 * Advisor — Type Definitions
 *
 * Types for the GCP project analyzer, recommendation engine, interactive
 * prompter, and post-recommendation verifier.
 */

// =============================================================================
// Recommendation Enums
// =============================================================================

/** Category of a GCP recommendation. */
export type RecommendationCategory =
  | "cost"
  | "security"
  | "performance"
  | "reliability"
  | "operational-excellence";

/** Severity level of a recommendation. */
export type RecommendationSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

/** Current status of a recommendation. */
export type RecommendationStatus =
  | "active"
  | "dismissed"
  | "resolved"
  | "in-progress";

// =============================================================================
// Core Recommendation
// =============================================================================

/** A single GCP recommendation produced by the advisor engine. */
export type GcpRecommendation = {
  /** Unique identifier for the recommendation. */
  id: string;
  /** Recommendation category. */
  category: RecommendationCategory;
  /** Severity of the issue. */
  severity: RecommendationSeverity;
  /** Current lifecycle status. */
  status: RecommendationStatus;
  /** Short title describing the recommendation. */
  title: string;
  /** Detailed description of the issue. */
  description: string;
  /** Impact statement if this is not addressed. */
  impact: string;
  /** GCP resource type (e.g. "compute.googleapis.com/Instance"). */
  resourceType: string;
  /** Specific resource identifier (e.g. project/zone/instance name). */
  resourceId?: string;
  /** Steps to remediate the issue. */
  remediation?: string;
  /** Estimated cost savings if applicable. */
  estimatedSavings?: { amount: number; currency: string; period: string };
  /** Arbitrary metadata attached to the recommendation. */
  metadata?: Record<string, unknown>;
  /** ISO timestamp when the recommendation was created. */
  createdAt: string;
};

// =============================================================================
// Project Analysis
// =============================================================================

/** Result of analyzing a GCP project for advisor findings. */
export type ProjectAnalysis = {
  /** GCP project ID that was analyzed. */
  projectId: string;
  /** ISO timestamp of the analysis. */
  analyzedAt: string;
  /** Count of resources discovered per service type. */
  resourceCounts: Record<string, number>;
  /** GCP regions where resources were found. */
  regions: string[];
  /** Estimated monthly spend (USD). */
  estimatedMonthlyCost?: number;
  /** Overall compliance status summary. */
  complianceStatus?: string;
  /** Individual findings from the analysis. */
  findings: ProjectFinding[];
};

/** A single finding from the project analysis phase. */
export type ProjectFinding = {
  /** Which advisor category this finding belongs to. */
  category: RecommendationCategory;
  /** The GCP resource or service affected. */
  resource: string;
  /** Description of the issue found. */
  issue: string;
  /** What to do about it. */
  recommendation: string;
};

// =============================================================================
// Advisor Configuration
// =============================================================================

/** Configuration for the advisor engine. */
export type AdvisorConfig = {
  /** GCP project ID to analyze. */
  projectId: string;
  /** Which categories to include (default: all). */
  enabledCategories?: RecommendationCategory[];
  /** Minimum severity to report (default: info). */
  severityThreshold?: RecommendationSeverity;
  /** Whether to run analysis automatically on engine creation. */
  autoAnalyze?: boolean;
};

// =============================================================================
// Verification
// =============================================================================

/** Result of verifying whether a recommendation has been addressed. */
export type VerificationResult = {
  /** The recommendation that was verified. */
  recommendationId: string;
  /** Whether the recommendation has been addressed. */
  verified: boolean;
  /** Human-readable verification message. */
  message: string;
  /** ISO timestamp when the verification was performed. */
  checkedAt: string;
  /** Additional diagnostic details. */
  details?: Record<string, unknown>;
};

// =============================================================================
// Interactive Prompter
// =============================================================================

/** A single question posed during an interactive advisor session. */
export type PrompterQuestion = {
  /** Unique ID for the question. */
  id: string;
  /** The question text. */
  question: string;
  /** Input type expected from the user. */
  type: "select" | "text" | "confirm" | "multiselect";
  /** Available choices for select/multiselect types. */
  choices?: string[];
  /** Default answer value. */
  defaultValue?: unknown;
};

/** An interactive advisor session that collects answers and produces recommendations. */
export type PrompterSession = {
  /** Unique session ID. */
  id: string;
  /** The recommendation category being explored. */
  category: RecommendationCategory;
  /** Questions for this session. */
  questions: PrompterQuestion[];
  /** Answers collected so far, keyed by question ID. */
  answers: Record<string, unknown>;
  /** Recommendations generated from the answers. */
  recommendations: GcpRecommendation[];
  /** ISO timestamp when the session was completed. */
  completedAt?: string;
};
