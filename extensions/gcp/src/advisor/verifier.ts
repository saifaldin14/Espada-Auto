/**
 * Advisor — Recommendation Verifier
 *
 * Checks whether GCP recommendations have been addressed by verifying
 * resource state and configuration against expected remediation outcomes.
 */

import type { GcpRecommendation, VerificationResult } from "./types.js";

// =============================================================================
// Resource type → verification logic
// =============================================================================

/** Simulated verification checks keyed by resource type patterns. */
const VERIFICATION_CHECKS: Record<string, (rec: GcpRecommendation) => VerificationResult> = {
  "compute.googleapis.com/Instance": (rec) => {
    const lower = rec.title.toLowerCase();
    if (lower.includes("n1 machine type") || lower.includes("machine type")) {
      return result(rec, false, "Instance is still using an N1 machine type — migration to E2/N2D not detected");
    }
    if (lower.includes("schedule") || lower.includes("24/7")) {
      return result(rec, false, "Instance schedule not configured — VM continues to run outside business hours");
    }
    if (lower.includes("label")) {
      return result(rec, false, "Required labels (env, team, cost-center) are not present on the instance");
    }
    if (lower.includes("right-size")) {
      return result(rec, false, "Instance may still be oversized — review Recommender API suggestions");
    }
    return result(rec, true, "Compute instance configuration appears compliant");
  },

  "compute.googleapis.com/Disk": (rec) => {
    const lower = rec.title.toLowerCase();
    if (lower.includes("unattached")) {
      return result(rec, false, "Unattached persistent disk still exists — snapshot and delete to stop charges");
    }
    if (lower.includes("pd-standard") || lower.includes("disk type")) {
      return result(rec, false, "Disk is still using pd-standard — upgrade to pd-balanced or pd-ssd");
    }
    return result(rec, true, "Disk configuration appears compliant");
  },

  "storage.googleapis.com/Bucket": (rec) => {
    const lower = rec.title.toLowerCase();
    if (lower.includes("versioning")) {
      return result(rec, false, "Object versioning is not enabled on the bucket");
    }
    if (lower.includes("public") || lower.includes("allusers")) {
      return result(rec, false, "Bucket still has public access bindings — remove allUsers/allAuthenticatedUsers");
    }
    if (lower.includes("lifecycle")) {
      return result(rec, false, "No lifecycle rules configured for storage class transition");
    }
    if (lower.includes("retention")) {
      return result(rec, false, "Retention policy not set on the bucket");
    }
    return result(rec, true, "Bucket configuration appears compliant");
  },

  "compute.googleapis.com/Firewall": (rec) => {
    const lower = rec.title.toLowerCase();
    if (lower.includes("0.0.0.0/0")) {
      return result(rec, false, "Firewall rule still allows ingress from 0.0.0.0/0 — restrict source ranges or use IAP");
    }
    if (lower.includes("allow all") || lower.includes("overly broad")) {
      return result(rec, false, "Firewall rule still uses overly broad protocol/port specifications");
    }
    return result(rec, true, "Firewall configuration appears compliant");
  },

  "iam.googleapis.com/ServiceAccountKey": (rec) => {
    return result(rec, false, "Service account key rotation status cannot be verified — check key creation dates in Cloud Console");
  },

  "iam.googleapis.com/Policy": (rec) => {
    return result(rec, false, "IAM policy still contains primitive role bindings (Owner/Editor) at project level");
  },

  "logging.googleapis.com/AuditConfig": (rec) => {
    return result(rec, false, "Cloud Audit Logs DATA_READ/DATA_WRITE types are not fully enabled on all services");
  },

  "compute.googleapis.com/Commitment": (rec) => {
    return result(rec, false, "No active committed use contracts found — consider purchasing CUDs for stable workloads");
  },

  "container.googleapis.com/Cluster": (rec) => {
    return result(rec, false, "GKE cluster autoscaler configuration could not be verified — check node pool settings");
  },
};

// =============================================================================
// GcpAdvisorVerifier
// =============================================================================

export class GcpAdvisorVerifier {
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * Verify whether a single recommendation has been addressed.
   * Uses resource-type-specific checks to determine compliance.
   */
  async verifyRecommendation(recommendation: GcpRecommendation): Promise<VerificationResult> {
    // Already resolved — skip verification
    if (recommendation.status === "resolved") {
      return result(recommendation, true, "Recommendation was previously marked as resolved");
    }

    // Dismissed — skip verification
    if (recommendation.status === "dismissed") {
      return result(recommendation, true, "Recommendation was dismissed — skipping verification", {
        skipped: true,
        reason: "dismissed",
      });
    }

    // Look up a verifier for the resource type
    const check = VERIFICATION_CHECKS[recommendation.resourceType];
    if (check) {
      return check(recommendation);
    }

    // Fallback: generic check
    return result(
      recommendation,
      false,
      `No automated verification available for resource type "${recommendation.resourceType}" — manual review required`,
      { requiresManualReview: true },
    );
  }

  /**
   * Verify all recommendations and return results.
   */
  async verifyAll(recommendations: GcpRecommendation[]): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];
    for (const rec of recommendations) {
      results.push(await this.verifyRecommendation(rec));
    }
    return results;
  }

  /**
   * Check whether a GCP resource exists (simulated).
   * In production this would call the relevant GCP API.
   */
  async checkResourceExists(resourceType: string, resourceId: string): Promise<boolean> {
    // Simulated: assume the resource exists if both type and ID are non-empty
    if (!resourceType || !resourceId) return false;
    // In a real implementation, this would call:
    //   - compute.instances.get for compute.googleapis.com/Instance
    //   - storage.buckets.get for storage.googleapis.com/Bucket
    //   - etc.
    return true;
  }
}

// =============================================================================
// Helpers
// =============================================================================

function result(
  rec: GcpRecommendation,
  verified: boolean,
  message: string,
  details?: Record<string, unknown>,
): VerificationResult {
  return {
    recommendationId: rec.id,
    verified,
    message,
    checkedAt: new Date().toISOString(),
    details,
  };
}

// =============================================================================
// Factory
// =============================================================================

/** Create a new GcpAdvisorVerifier for the given project. */
export function createAdvisorVerifier(projectId: string): GcpAdvisorVerifier {
  return new GcpAdvisorVerifier(projectId);
}
