/**
 * Advisor — Interactive Prompter
 *
 * Question-based advisor that collects answers about a GCP project's
 * architecture and practices, then generates targeted recommendations
 * based on the responses.
 */

import { randomUUID } from "node:crypto";
import type {
  PrompterSession,
  PrompterQuestion,
  RecommendationCategory,
  GcpRecommendation,
} from "./types.js";

// =============================================================================
// Question Banks (per category)
// =============================================================================

const COST_QUESTIONS: PrompterQuestion[] = [
  {
    id: "cud",
    question: "Are you using committed use discounts (CUDs) for stable workloads?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "idle-vms",
    question: "Do you have development or test VMs running 24/7?",
    type: "confirm",
    defaultValue: true,
  },
  {
    id: "storage-classes",
    question: "Are you using appropriate storage classes (Nearline/Coldline/Archive) for infrequently accessed data?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "preemptible",
    question: "Are you using preemptible or Spot VMs for fault-tolerant batch workloads?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "billing-alerts",
    question: "Do you have billing alerts and budgets configured?",
    type: "confirm",
    defaultValue: false,
  },
];

const SECURITY_QUESTIONS: PrompterQuestion[] = [
  {
    id: "key-rotation",
    question: "Do you rotate service account keys at least every 90 days?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "vpc-sc",
    question: "Is VPC Service Controls enabled for sensitive projects?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "audit-logs",
    question: "Are Cloud Audit Logs configured for DATA_READ and DATA_WRITE?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "org-policy",
    question: "Are organization policy constraints enforced (e.g. domain-restricted sharing)?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "cmek",
    question: "Are you using Customer-Managed Encryption Keys (CMEK) for sensitive data?",
    type: "confirm",
    defaultValue: false,
  },
];

const PERFORMANCE_QUESTIONS: PrompterQuestion[] = [
  {
    id: "right-sizing",
    question: "Are your Compute Engine instances right-sized based on utilization metrics?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "cloud-cdn",
    question: "Is Cloud CDN enabled for serving static content?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "regional-resources",
    question: "Are you using regional vs multi-regional resources based on latency needs?",
    type: "select",
    choices: ["Regional only", "Multi-regional", "Mix of both", "Not sure"],
    defaultValue: "Not sure",
  },
  {
    id: "disk-type",
    question: "What disk types are used for latency-sensitive workloads?",
    type: "select",
    choices: ["pd-standard (HDD)", "pd-balanced", "pd-ssd", "local-ssd", "Not sure"],
    defaultValue: "Not sure",
  },
];

const RELIABILITY_QUESTIONS: PrompterQuestion[] = [
  {
    id: "multi-zone",
    question: "Do you have multi-zone deployments for production workloads?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "backups",
    question: "Are automated backups configured for databases and critical data?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "monitoring-alerts",
    question: "Is Cloud Monitoring alerting configured for key SLIs (latency, errors, saturation)?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "load-balancing",
    question: "Are you using Cloud Load Balancing for high-availability services?",
    type: "confirm",
    defaultValue: false,
  },
];

const OPERATIONAL_QUESTIONS: PrompterQuestion[] = [
  {
    id: "iac",
    question: "Is Infrastructure as Code (Terraform, Deployment Manager, Pulumi) used?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "labels",
    question: "Are labels consistently applied across all resources?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "cicd",
    question: "Is CI/CD configured (Cloud Build, GitHub Actions, etc.)?",
    type: "confirm",
    defaultValue: false,
  },
  {
    id: "logging",
    question: "Are structured logs and log-based metrics configured in Cloud Logging?",
    type: "confirm",
    defaultValue: false,
  },
];

const QUESTION_BANKS: Record<RecommendationCategory, PrompterQuestion[]> = {
  cost: COST_QUESTIONS,
  security: SECURITY_QUESTIONS,
  performance: PERFORMANCE_QUESTIONS,
  reliability: RELIABILITY_QUESTIONS,
  "operational-excellence": OPERATIONAL_QUESTIONS,
};

// =============================================================================
// GcpAdvisorPrompter
// =============================================================================

export class GcpAdvisorPrompter {
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /** Create a new interactive session for the given category. */
  createSession(category: RecommendationCategory): PrompterSession {
    const questions = QUESTION_BANKS[category] ?? [];
    return {
      id: randomUUID(),
      category,
      questions: questions.map((q) => ({ ...q })),
      answers: {},
      recommendations: [],
    };
  }

  /** Record an answer to a specific question and return the updated session. */
  answerQuestion(session: PrompterSession, questionId: string, answer: unknown): PrompterSession {
    const question = session.questions.find((q) => q.id === questionId);
    if (!question) return session;

    return {
      ...session,
      answers: { ...session.answers, [questionId]: answer },
    };
  }

  /** Generate recommendations based on the collected answers. */
  generateSessionRecommendations(session: PrompterSession): GcpRecommendation[] {
    const recs: GcpRecommendation[] = [];
    const { answers, category } = session;
    const now = new Date().toISOString();

    const generators: Record<RecommendationCategory, () => void> = {
      cost: () => {
        if (answers["cud"] === false) {
          recs.push(this.makeRec(category, "high", "Enable committed use discounts for stable workloads",
            "Purchase 1-year or 3-year CUDs for predictable Compute Engine and Cloud SQL usage to save 37–57%.",
            "compute.googleapis.com/Commitment", now));
        }
        if (answers["idle-vms"] === true) {
          recs.push(this.makeRec(category, "medium", "Schedule non-production VMs to stop outside business hours",
            "Use instance schedules or Cloud Scheduler with Cloud Functions to auto-stop dev/test VMs, reducing costs up to 65%.",
            "compute.googleapis.com/Instance", now));
        }
        if (answers["storage-classes"] === false) {
          recs.push(this.makeRec(category, "medium", "Optimize storage class usage with lifecycle rules",
            "Configure lifecycle rules to transition data older than 30 days to Nearline, 90 days to Coldline, and 365 days to Archive.",
            "storage.googleapis.com/Bucket", now));
        }
        if (answers["preemptible"] === false) {
          recs.push(this.makeRec(category, "low", "Use Spot VMs for fault-tolerant batch jobs",
            "Spot VMs cost 60–91% less than regular instances — ideal for batch processing, CI builds, and data pipelines.",
            "compute.googleapis.com/Instance", now));
        }
        if (answers["billing-alerts"] === false) {
          recs.push(this.makeRec(category, "medium", "Set up billing budgets and alerts",
            "Create budget alerts at 50%, 80%, and 100% of expected monthly spend to avoid surprise charges.",
            "billingbudgets.googleapis.com/Budget", now));
        }
      },
      security: () => {
        if (answers["key-rotation"] === false) {
          recs.push(this.makeRec(category, "high", "Implement service account key rotation",
            "Rotate keys every 90 days or migrate to Workload Identity Federation to eliminate user-managed keys.",
            "iam.googleapis.com/ServiceAccountKey", now));
        }
        if (answers["vpc-sc"] === false) {
          recs.push(this.makeRec(category, "high", "Enable VPC Service Controls for sensitive projects",
            "VPC-SC creates a security perimeter around GCP services to prevent data exfiltration.",
            "accesscontextmanager.googleapis.com/ServicePerimeter", now));
        }
        if (answers["audit-logs"] === false) {
          recs.push(this.makeRec(category, "high", "Configure Cloud Audit Logs for data access",
            "Enable DATA_READ and DATA_WRITE audit log types on all critical services for compliance and forensics.",
            "logging.googleapis.com/AuditConfig", now));
        }
        if (answers["org-policy"] === false) {
          recs.push(this.makeRec(category, "medium", "Enforce organization policy constraints",
            "Enable constraints like domain-restricted sharing, disable external IP on VMs, and enforce uniform bucket access.",
            "orgpolicy.googleapis.com/Policy", now));
        }
        if (answers["cmek"] === false) {
          recs.push(this.makeRec(category, "medium", "Use CMEK for sensitive data stores",
            "Configure Cloud KMS keys for BigQuery, Cloud SQL, GCS, and Pub/Sub to meet encryption compliance requirements.",
            "cloudkms.googleapis.com/CryptoKey", now));
        }
      },
      performance: () => {
        if (answers["right-sizing"] === false) {
          recs.push(this.makeRec(category, "medium", "Right-size Compute Engine instances",
            "Use the Recommender API or Cloud Console recommendations to identify oversized or underutilized VMs.",
            "compute.googleapis.com/Instance", now));
        }
        if (answers["cloud-cdn"] === false) {
          recs.push(this.makeRec(category, "low", "Enable Cloud CDN for static content delivery",
            "Cloud CDN caches static assets at Google edge locations, reducing latency and backend load.",
            "compute.googleapis.com/BackendService", now));
        }
        if (answers["disk-type"] === "pd-standard (HDD)") {
          recs.push(this.makeRec(category, "medium", "Upgrade latency-sensitive disks to pd-ssd or pd-balanced",
            "pd-standard disks have higher I/O latency; pd-balanced offers a cost-effective middle ground.",
            "compute.googleapis.com/Disk", now));
        }
      },
      reliability: () => {
        if (answers["multi-zone"] === false) {
          recs.push(this.makeRec(category, "high", "Deploy production workloads across multiple zones",
            "Use regional MIGs, multi-zone GKE clusters, or Cloud SQL HA to survive single-zone outages.",
            "compute.googleapis.com/InstanceGroupManager", now));
        }
        if (answers["backups"] === false) {
          recs.push(this.makeRec(category, "high", "Enable automated backups for databases",
            "Configure automated backups for Cloud SQL, Firestore exports, and GCS versioning for data protection.",
            "sqladmin.googleapis.com/Instance", now));
        }
        if (answers["monitoring-alerts"] === false) {
          recs.push(this.makeRec(category, "medium", "Configure Cloud Monitoring alerting policies",
            "Create alerting policies for key SLIs: error rate, latency, CPU/memory saturation, and disk usage.",
            "monitoring.googleapis.com/AlertPolicy", now));
        }
        if (answers["load-balancing"] === false) {
          recs.push(this.makeRec(category, "medium", "Enable Cloud Load Balancing for production services",
            "Use global HTTP(S) Load Balancing for web services or internal TCP/UDP LB for backend services.",
            "compute.googleapis.com/UrlMap", now));
        }
      },
      "operational-excellence": () => {
        if (answers["iac"] === false) {
          recs.push(this.makeRec(category, "medium", "Adopt Infrastructure as Code",
            "Use Terraform or Pulumi to manage GCP resources declaratively for repeatability and auditability.",
            "deploymentmanager.googleapis.com/Deployment", now));
        }
        if (answers["labels"] === false) {
          recs.push(this.makeRec(category, "low", "Enforce consistent resource labeling",
            "Define a labeling taxonomy (env, team, cost-center, app) and enforce via organization policy.",
            "cloudresourcemanager.googleapis.com/Project", now));
        }
        if (answers["cicd"] === false) {
          recs.push(this.makeRec(category, "medium", "Set up CI/CD pipelines",
            "Configure Cloud Build triggers or GitHub Actions for automated testing, building, and deployment.",
            "cloudbuild.googleapis.com/Trigger", now));
        }
        if (answers["logging"] === false) {
          recs.push(this.makeRec(category, "low", "Configure structured logging and log-based metrics",
            "Use structured JSON logs, create log-based metrics for key events, and set up log sinks for long-term retention.",
            "logging.googleapis.com/LogMetric", now));
        }
      },
    };

    generators[category]();

    session.recommendations = recs;
    session.completedAt = now;

    return recs;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private makeRec(
    category: RecommendationCategory,
    severity: GcpRecommendation["severity"],
    title: string,
    remediation: string,
    resourceType: string,
    createdAt: string,
  ): GcpRecommendation {
    return {
      id: randomUUID(),
      category,
      severity,
      status: "active",
      title,
      description: `[${this.projectId}] ${title}`,
      impact: `Affects ${category} posture of the project`,
      resourceType,
      remediation,
      createdAt,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/** Create a new GcpAdvisorPrompter for the given project. */
export function createAdvisorPrompter(projectId: string): GcpAdvisorPrompter {
  return new GcpAdvisorPrompter(projectId);
}
