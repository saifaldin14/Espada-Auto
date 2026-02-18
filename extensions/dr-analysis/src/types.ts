/**
 * Disaster Recovery Analysis types.
 */

export type CloudProvider = "aws" | "azure" | "gcp";

export type RiskLevel = "critical" | "high" | "medium" | "low";
export type DRGrade = "A" | "B" | "C" | "D" | "F";
export type BackupStrategy = "none" | "snapshot" | "replication" | "multi-region";
export type ReplicationStatus = "none" | "async" | "sync" | "active-active";
export type FailureScenario = "region-failure" | "az-failure" | "service-outage" | "data-corruption";

/** Simplified graph node for DR analysis input. */
export interface DRNode {
  id: string;
  name: string;
  provider: CloudProvider;
  resourceType: string;
  region: string;
  status: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  costMonthly: number | null;
}

/** Simplified graph edge for DR analysis input. */
export interface DREdge {
  sourceId: string;
  targetId: string;
  relationshipType: string;
}

export interface SingleRegionRisk {
  region: string;
  provider: CloudProvider;
  criticalResources: number;
  totalResources: number;
  hasFailover: boolean;
  riskLevel: RiskLevel;
}

export interface RecoveryRequirement {
  nodeId: string;
  rpo: number | null;
  rto: number | null;
  backupStrategy: BackupStrategy;
  replicationStatus: ReplicationStatus;
  failoverCapable: boolean;
}

export interface RecoveryStep {
  order: number;
  action: string;
  resourceId: string;
  resourceName: string;
  estimatedDuration: number;
  dependsOn: number[];
  manual: boolean;
}

export interface RecoveryPlan {
  scenario: FailureScenario;
  affectedResources: DRNode[];
  recoverySteps: RecoveryStep[];
  estimatedRTO: number;
  estimatedRPO: number;
  dependencies: string[][];
}

export interface DRRecommendation {
  severity: RiskLevel;
  category: "backup" | "replication" | "failover" | "redundancy" | "monitoring";
  description: string;
  affectedResources: string[];
  estimatedCost: number | null;
  effort: "low" | "medium" | "high";
}

export interface DRAnalysis {
  overallScore: number;
  grade: DRGrade;
  singleRegionRisks: SingleRegionRisk[];
  unprotectedCriticalResources: DRNode[];
  recoveryTimeEstimates: Record<string, number>;
  recommendations: DRRecommendation[];
}

/** Scoring weights for DR posture. */
export interface DRScoringWeights {
  backupCoverage: number;
  replicationBreadth: number;
  spofCount: number;
  crossRegionDistribution: number;
  recoveryPlanExistence: number;
}

export const DEFAULT_WEIGHTS: DRScoringWeights = {
  backupCoverage: 0.25,
  replicationBreadth: 0.25,
  spofCount: 0.2,
  crossRegionDistribution: 0.15,
  recoveryPlanExistence: 0.15,
};
