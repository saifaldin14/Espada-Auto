/**
 * Advisor — Recommendation Engine
 *
 * Converts ProjectAnalysis findings into prioritized, actionable GCP
 * recommendations with severity, impact, and remediation guidance.
 * Supports filtering, status management, and aggregate statistics.
 */

import { randomUUID } from "node:crypto";
import type {
  GcpRecommendation,
  RecommendationCategory,
  RecommendationSeverity,
  RecommendationStatus,
  AdvisorConfig,
  ProjectAnalysis,
  ProjectFinding,
} from "./types.js";

// =============================================================================
// Severity ordering (lower index = more severe)
// =============================================================================

const SEVERITY_ORDER: RecommendationSeverity[] = ["critical", "high", "medium", "low", "info"];

function meetsThreshold(severity: RecommendationSeverity, threshold: RecommendationSeverity): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold);
}

// =============================================================================
// Finding → severity mapping heuristics
// =============================================================================

/** Derive severity from a finding based on its category and content. */
function deriveSeverity(finding: ProjectFinding): RecommendationSeverity {
  const lower = `${finding.issue} ${finding.recommendation}`.toLowerCase();

  // Critical: public exposure, no audit logs, overly permissive access
  if (lower.includes("0.0.0.0/0") || lower.includes("allusers") || lower.includes("public access")) {
    return "critical";
  }
  // High: key rotation, primitive roles, missing encryption
  if (lower.includes("key") && lower.includes("rotation")) return "high";
  if (lower.includes("primitive role") || lower.includes("owner/editor")) return "high";
  if (lower.includes("cmek") || lower.includes("encryption")) return "high";
  if (lower.includes("audit log")) return "high";

  // Medium: cost savings, lifecycle, autoscaler
  if (finding.category === "cost") return "medium";
  if (lower.includes("lifecycle") || lower.includes("versioning")) return "medium";

  // Low: labels, operational suggestions
  if (lower.includes("label") || finding.category === "operational-excellence") return "low";

  return "info";
}

/** Derive an impact statement for display. */
function deriveImpact(finding: ProjectFinding): string {
  switch (finding.category) {
    case "cost":
      return "Potential cost overrun from suboptimal resource configuration or idle resources";
    case "security":
      return "Increased risk of unauthorized access, data exposure, or compliance violations";
    case "performance":
      return "Degraded application performance or higher latency for end users";
    case "reliability":
      return "Increased risk of downtime or data loss during failures";
    case "operational-excellence":
      return "Reduced observability, tracking, or operational efficiency";
  }
}

/** Map a finding resource string to a GCP resource type. */
function deriveResourceType(resource: string): string {
  // Already in API format
  if (resource.includes(".googleapis.com/")) return resource;
  return resource;
}

/** Estimate potential savings for cost findings. */
function estimateSavings(finding: ProjectFinding): GcpRecommendation["estimatedSavings"] | undefined {
  if (finding.category !== "cost") return undefined;

  const lower = finding.issue.toLowerCase();
  if (lower.includes("committed use")) {
    return { amount: 840, currency: "USD", period: "monthly" };
  }
  if (lower.includes("instance schedule") || lower.includes("24/7")) {
    return { amount: 320, currency: "USD", period: "monthly" };
  }
  if (lower.includes("storage class") || lower.includes("lifecycle")) {
    return { amount: 45, currency: "USD", period: "monthly" };
  }
  if (lower.includes("static external ip") || lower.includes("unattached")) {
    return { amount: 7.3, currency: "USD", period: "monthly" };
  }
  if (lower.includes("n1") || lower.includes("machine type")) {
    return { amount: 210, currency: "USD", period: "monthly" };
  }
  if (lower.includes("bigquery")) {
    return { amount: 1200, currency: "USD", period: "monthly" };
  }
  if (lower.includes("autoscaler") || lower.includes("auto-provisioning")) {
    return { amount: 500, currency: "USD", period: "monthly" };
  }
  return undefined;
}

// =============================================================================
// GcpRecommendationEngine
// =============================================================================

export class GcpRecommendationEngine {
  private readonly recommendations: Map<string, GcpRecommendation> = new Map();
  private readonly config: AdvisorConfig;

  constructor(config: AdvisorConfig) {
    this.config = config;
  }

  /**
   * Convert project analysis findings into prioritized recommendations.
   * Applies enabled-category and severity-threshold filters from config.
   */
  async generateRecommendations(analysis: ProjectAnalysis): Promise<GcpRecommendation[]> {
    const threshold = this.config.severityThreshold ?? "info";
    const enabledCategories = this.config.enabledCategories
      ? new Set(this.config.enabledCategories)
      : null;

    const generated: GcpRecommendation[] = [];

    for (const finding of analysis.findings) {
      // Category filter
      if (enabledCategories && !enabledCategories.has(finding.category)) continue;

      const severity = deriveSeverity(finding);

      // Severity threshold filter
      if (!meetsThreshold(severity, threshold)) continue;

      const rec: GcpRecommendation = {
        id: randomUUID(),
        category: finding.category,
        severity,
        status: "active",
        title: finding.issue,
        description: `[${analysis.projectId}] ${finding.issue}`,
        impact: deriveImpact(finding),
        resourceType: deriveResourceType(finding.resource),
        remediation: finding.recommendation,
        estimatedSavings: estimateSavings(finding),
        createdAt: new Date().toISOString(),
      };

      this.recommendations.set(rec.id, rec);
      generated.push(rec);
    }

    // Sort by severity (most severe first)
    generated.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

    return generated;
  }

  /**
   * List recommendations with optional category/severity/status filters.
   */
  listRecommendations(filters?: {
    category?: RecommendationCategory;
    severity?: RecommendationSeverity;
    status?: RecommendationStatus;
  }): GcpRecommendation[] {
    let results = [...this.recommendations.values()];

    if (filters?.category) {
      results = results.filter((r) => r.category === filters.category);
    }
    if (filters?.severity) {
      results = results.filter((r) => r.severity === filters.severity);
    }
    if (filters?.status) {
      results = results.filter((r) => r.status === filters.status);
    }

    return results.sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
  }

  /** Get a single recommendation by ID. */
  getRecommendation(id: string): GcpRecommendation | undefined {
    return this.recommendations.get(id);
  }

  /** Dismiss a recommendation with an optional reason stored in metadata. */
  dismissRecommendation(id: string, reason?: string): boolean {
    const rec = this.recommendations.get(id);
    if (!rec || rec.status === "dismissed") return false;
    rec.status = "dismissed";
    if (reason) {
      rec.metadata = { ...rec.metadata, dismissReason: reason, dismissedAt: new Date().toISOString() };
    }
    return true;
  }

  /** Mark a recommendation as resolved. */
  resolveRecommendation(id: string): boolean {
    const rec = this.recommendations.get(id);
    if (!rec || rec.status === "resolved") return false;
    rec.status = "resolved";
    rec.metadata = { ...rec.metadata, resolvedAt: new Date().toISOString() };
    return true;
  }

  /** Return aggregate stats about current recommendations. */
  getStats(): {
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const rec of this.recommendations.values()) {
      byCategory[rec.category] = (byCategory[rec.category] ?? 0) + 1;
      bySeverity[rec.severity] = (bySeverity[rec.severity] ?? 0) + 1;
    }

    return { total: this.recommendations.size, byCategory, bySeverity };
  }

  /** Clear all stored recommendations. */
  clearRecommendations(): void {
    this.recommendations.clear();
  }
}

// =============================================================================
// Factory
// =============================================================================

/** Create a new GcpRecommendationEngine with the given config. */
export function createRecommendationEngine(config: AdvisorConfig): GcpRecommendationEngine {
  return new GcpRecommendationEngine(config);
}
