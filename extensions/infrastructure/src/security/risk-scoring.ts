/**
 * Infrastructure Risk Scoring System
 */

import type { Environment, OperationCategory, RiskLevel, RiskFactor, RiskAssessment, RiskMitigation } from "./types.js";
import type { InfrastructureCommand } from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

export type RiskScoringConfig = {
  weights: { environment: number; operationType: number; resourceCount: number; resourceCriticality: number; timeOfDay: number; userHistory: number; recentChanges: number; rollbackAvailability: number; };
  thresholds: { critical: number; high: number; medium: number; low: number; };
  environmentMultipliers: Record<Environment, number>;
  operationBaseScores: Record<OperationCategory, number>;
  criticalResourcePatterns: string[];
  highRiskHours: { start: number; end: number }[];
};

export const defaultRiskScoringConfig: RiskScoringConfig = {
  weights: { environment: 0.25, operationType: 0.20, resourceCount: 0.10, resourceCriticality: 0.15, timeOfDay: 0.05, userHistory: 0.10, recentChanges: 0.10, rollbackAvailability: 0.05 },
  thresholds: { critical: 80, high: 60, medium: 40, low: 20 },
  environmentMultipliers: { production: 2.0, "disaster-recovery": 1.8, staging: 1.2, development: 0.5 },
  operationBaseScores: { delete: 90, security: 85, network: 80, migrate: 75, access: 70, scale: 50, update: 45, restore: 40, backup: 30, create: 35, cost: 25, audit: 10 },
  criticalResourcePatterns: ["*-prod-*", "*-production-*", "*-database-*", "*-db-*", "*-auth-*"],
  highRiskHours: [{ start: 17, end: 9 }, { start: 0, end: 6 }],
};

export type UserOperationHistory = { totalOperations: number; successfulOperations: number; failedOperations: number; rolledBackOperations: number; lastOperationDate?: Date; averageOperationsPerDay: number; };

export type RiskContext = {
  command: InfrastructureCommand;
  parameters: Record<string, unknown>;
  environment: Environment;
  userId: string;
  resourceIds?: string[];
  resourceNames?: string[];
  userOperationHistory?: UserOperationHistory;
  recentChangeCount?: number;
  hasRollbackPlan?: boolean;
  customFactors?: RiskFactor[];
};

export class InfrastructureRiskScorer {
  private config: RiskScoringConfig;
  private logger: InfrastructureLogger;

  constructor(config?: Partial<RiskScoringConfig>, logger?: InfrastructureLogger) {
    this.config = { ...defaultRiskScoringConfig, ...config };
    this.logger = logger ?? (console as unknown as InfrastructureLogger);
  }

  assessRisk(context: RiskContext): RiskAssessment {
    const factors: RiskFactor[] = [];
    const mitigations: RiskMitigation[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    factors.push(this.assessEnvironmentRisk(context));
    factors.push(this.assessOperationTypeRisk(context));
    factors.push(this.assessResourceCountRisk(context));
    factors.push(this.assessResourceCriticalityRisk(context));
    factors.push(this.assessTimeOfDayRisk());

    if (context.customFactors) factors.push(...context.customFactors);

    let overallScore = 0, totalWeight = 0;
    for (const factor of factors) {
      overallScore += factor.score * factor.weight;
      totalWeight += factor.weight;
    }
    overallScore = Math.min(100, Math.max(0, (overallScore / totalWeight) * 100));

    const riskLevel = this.determineRiskLevel(overallScore);
    this.generateWarnings(context, factors, riskLevel, warnings);
    this.generateRecommendations(context, riskLevel, recommendations);

    const { requiresApproval, approvalLevel } = this.determineApprovalRequirements(riskLevel, context.environment);

    this.logger.debug?.("Risk assessment completed", { commandId: context.command.id, score: Math.round(overallScore), level: riskLevel });

    return { commandId: context.command.id, environment: context.environment, overallScore: Math.round(overallScore), riskLevel, factors, mitigations, requiresApproval, approvalLevel, warnings, recommendations };
  }

  private assessEnvironmentRisk(context: RiskContext): RiskFactor {
    const multiplier = this.config.environmentMultipliers[context.environment];
    return { name: "environment", weight: this.config.weights.environment, score: Math.min(100, 50 * multiplier), description: `Environment '${context.environment}'` };
  }

  private assessOperationTypeRisk(context: RiskContext): RiskFactor {
    const category = context.command.category as OperationCategory;
    let score = this.config.operationBaseScores[category] ?? 50;
    if (context.command.dangerous) score = Math.min(100, score * 1.5);
    return { name: "operationType", weight: this.config.weights.operationType, score, description: `Operation category '${category}'` };
  }

  private assessResourceCountRisk(context: RiskContext): RiskFactor {
    const count = context.resourceIds?.length ?? 1;
    const score = count >= 100 ? 100 : count >= 50 ? 80 : count >= 20 ? 60 : count >= 10 ? 40 : count >= 5 ? 20 : 10;
    return { name: "resourceCount", weight: this.config.weights.resourceCount, score, description: `${count} resource(s)` };
  }

  private assessResourceCriticalityRisk(context: RiskContext): RiskFactor {
    const names = context.resourceNames ?? context.resourceIds ?? [];
    const hasCritical = names.some(n => this.config.criticalResourcePatterns.some(p => this.matchPattern(n, p)));
    return { name: "resourceCriticality", weight: this.config.weights.resourceCriticality, score: hasCritical ? 90 : 30, description: hasCritical ? "Critical resources" : "Non-critical" };
  }

  private assessTimeOfDayRisk(): RiskFactor {
    const hour = new Date().getUTCHours();
    const isHighRisk = this.config.highRiskHours.some(r => r.start > r.end ? hour >= r.start || hour < r.end : hour >= r.start && hour < r.end);
    return { name: "timeOfDay", weight: this.config.weights.timeOfDay, score: isHighRisk ? 70 : 20, description: isHighRisk ? "High-risk hours" : "Normal hours" };
  }

  private determineRiskLevel(score: number): RiskLevel {
    const t = this.config.thresholds;
    if (score >= t.critical) return "critical";
    if (score >= t.high) return "high";
    if (score >= t.medium) return "medium";
    if (score >= t.low) return "low";
    return "minimal";
  }

  private generateWarnings(context: RiskContext, factors: RiskFactor[], level: RiskLevel, warnings: string[]): void {
    if (level === "critical" || level === "high") warnings.push(`High risk operation in ${context.environment}`);
    if (context.command.dangerous) warnings.push("This operation is marked as dangerous");
    factors.filter(f => f.score > 70).forEach(f => warnings.push(`High ${f.name} risk factor`));
  }

  private generateRecommendations(context: RiskContext, level: RiskLevel, recommendations: string[]): void {
    if (level === "critical" || level === "high") {
      recommendations.push("Consider running in staging first");
      recommendations.push("Ensure rollback plan is ready");
      recommendations.push("Have on-call team available");
    }
    if (context.environment === "production") recommendations.push("Consider off-peak hours");
  }

  private determineApprovalRequirements(level: RiskLevel, env: Environment): { requiresApproval: boolean; approvalLevel: RiskLevel } {
    if (env === "production" && (level === "critical" || level === "high" || level === "medium")) return { requiresApproval: true, approvalLevel: level };
    if (env === "staging" && (level === "critical" || level === "high")) return { requiresApproval: true, approvalLevel: level };
    return { requiresApproval: false, approvalLevel: level };
  }

  private matchPattern(text: string, pattern: string): boolean {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$", "i");
    return regex.test(text);
  }
}

export function createRiskScorer(config?: Partial<RiskScoringConfig>, logger?: InfrastructureLogger): InfrastructureRiskScorer {
  return new InfrastructureRiskScorer(config, logger);
}

export function assessCommandRisk(command: InfrastructureCommand, environment: Environment, options?: { parameters?: Record<string, unknown>; resourceIds?: string[]; userId?: string; }): RiskAssessment {
  return createRiskScorer().assessRisk({ command, parameters: options?.parameters ?? {}, environment, userId: options?.userId ?? "unknown", resourceIds: options?.resourceIds });
}
