/**
 * Infrastructure Operation Confirmation Workflows
 */

import type {
  ConfirmationRequest,
  ConfirmationResponse,
  OperationImpact,
  ResolvedResource,
  InfrastructureIntent,
  IntentCategory,
} from "./types.js";
import type { Environment, RiskLevel } from "../security/types.js";

export type ConfirmationConfig = {
  requireConfirmationForHighRisk: boolean;
  requireConfirmationForProduction: boolean;
  autoApproveReadOnly: boolean;
  confirmationTimeout: number;
  maxRetries: number;
  verboseImpactAnalysis: boolean;
};

export const defaultConfirmationConfig: ConfirmationConfig = {
  requireConfirmationForHighRisk: true,
  requireConfirmationForProduction: true,
  autoApproveReadOnly: true,
  confirmationTimeout: 300000, // 5 minutes
  maxRetries: 3,
  verboseImpactAnalysis: true,
};

// Operations that are read-only and don't need confirmation
const READ_ONLY_INTENTS: IntentCategory[] = [
  "read",
  "list",
  "describe",
  "search",
  "compare",
  "monitor",
  "help",
  "clarify",
];

// High-risk operations that always need confirmation
const HIGH_RISK_INTENTS: IntentCategory[] = [
  "delete",
  "migrate",
  "rollback",
  "restore",
];

// Operation impacts by intent type
const INTENT_IMPACTS: Partial<Record<IntentCategory, Partial<OperationImpact>>> = {
  create: {
    willCreate: true,
    estimatedCost: { currency: "USD", monthly: 0 },
  },
  delete: {
    willDelete: true,
    isReversible: false,
    requiresDowntime: false,
  },
  update: {
    willModify: true,
    isReversible: true,
    requiresDowntime: false,
  },
  scale: {
    willModify: true,
    isReversible: true,
    requiresDowntime: false,
  },
  deploy: {
    willModify: true,
    isReversible: true,
    requiresDowntime: false,
  },
  rollback: {
    willModify: true,
    isReversible: true,
    requiresDowntime: true,
  },
  backup: {
    willCreate: true,
    isReversible: true,
  },
  restore: {
    willModify: true,
    requiresDowntime: true,
    isReversible: false,
  },
  migrate: {
    willModify: true,
    willCreate: true,
    requiresDowntime: true,
    isReversible: false,
  },
  configure: {
    willModify: true,
    isReversible: true,
    requiresDowntime: false,
  },
};

export type PendingConfirmation = {
  id: string;
  request: ConfirmationRequest;
  createdAt: Date;
  expiresAt: Date;
  retryCount: number;
};

export type ConfirmationHandler = (request: ConfirmationRequest) => Promise<ConfirmationResponse>;

export class InfrastructureConfirmationWorkflow {
  private config: ConfirmationConfig;
  private pendingConfirmations: Map<string, PendingConfirmation>;
  private confirmationHandler?: ConfirmationHandler;

  constructor(config?: Partial<ConfirmationConfig>) {
    this.config = { ...defaultConfirmationConfig, ...config };
    this.pendingConfirmations = new Map();
  }

  setConfirmationHandler(handler: ConfirmationHandler): void {
    this.confirmationHandler = handler;
  }

  getConfirmationHandler(): ConfirmationHandler | undefined {
    return this.confirmationHandler;
  }

  async requestConfirmation(
    intent: InfrastructureIntent,
    resources: ResolvedResource[],
    environment: Environment
  ): Promise<ConfirmationRequest | null> {
    // Check if confirmation is needed
    if (!this.needsConfirmation(intent, environment)) {
      return null;
    }

    const impact = this.analyzeImpact(intent, resources, environment);
    const riskLevel = this.calculateRiskLevel(intent, resources, environment);

    const request: ConfirmationRequest = {
      confirmationId: this.generateConfirmationId(),
      operationType: intent.category,
      targetResources: resources,
      environment,
      impact,
      riskLevel,
      warningMessages: this.generateWarnings(intent, resources, environment),
      confirmationPrompt: this.generateConfirmationPrompt(intent, resources, environment, impact),
      suggestedActions: this.generateSuggestedActions(intent, riskLevel),
      expiresAt: new Date(Date.now() + this.config.confirmationTimeout),
    };

    // Store pending confirmation
    this.pendingConfirmations.set(request.confirmationId, {
      id: request.confirmationId,
      request,
      createdAt: new Date(),
      expiresAt: request.expiresAt,
      retryCount: 0,
    });

    return request;
  }

  async processConfirmation(confirmationId: string, response: ConfirmationResponse): Promise<{
    approved: boolean;
    canProceed: boolean;
    reason?: string;
    modifiedParameters?: Record<string, unknown>;
  }> {
    const pending = this.pendingConfirmations.get(confirmationId);

    if (!pending) {
      return {
        approved: false,
        canProceed: false,
        reason: "Confirmation not found or expired",
      };
    }

    // Check expiration
    if (new Date() > pending.expiresAt) {
      this.pendingConfirmations.delete(confirmationId);
      return {
        approved: false,
        canProceed: false,
        reason: "Confirmation has expired",
      };
    }

    // Process the response
    this.pendingConfirmations.delete(confirmationId);

    if (response.confirmed) {
      return {
        approved: true,
        canProceed: true,
        modifiedParameters: response.modifiedParameters,
      };
    }

    if (response.deferredUntil) {
      // Reschedule the confirmation
      return {
        approved: false,
        canProceed: false,
        reason: `Operation deferred until ${response.deferredUntil.toISOString()}`,
      };
    }

    return {
      approved: false,
      canProceed: false,
      reason: response.reason ?? "Operation was not confirmed",
    };
  }

  needsConfirmation(intent: InfrastructureIntent, environment: Environment): boolean {
    // Auto-approve read-only operations if configured
    if (this.config.autoApproveReadOnly && READ_ONLY_INTENTS.includes(intent.category)) {
      return false;
    }

    // Always require confirmation for high-risk operations
    if (this.config.requireConfirmationForHighRisk && HIGH_RISK_INTENTS.includes(intent.category)) {
      return true;
    }

    // Require confirmation for production
    if (this.config.requireConfirmationForProduction && environment === "production") {
      return true;
    }

    // Check intent risk level
    if (intent.riskLevel === "critical" || intent.riskLevel === "high") {
      return true;
    }

    return false;
  }

  analyzeImpact(
    intent: InfrastructureIntent,
    resources: ResolvedResource[],
    environment: Environment
  ): OperationImpact {
    const baseImpact = INTENT_IMPACTS[intent.category] ?? {};

    // Calculate affected resources
    const affectedResources = resources.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      currentState: r.status,
      expectedState: this.predictState(intent.category, r.status),
    }));

    // Estimate cost impact
    const estimatedCost = this.estimateCostImpact(intent, resources, environment);

    // Identify dependencies
    const dependencies = this.identifyDependencies(resources);

    // Check for cascading effects
    const cascadingEffects = this.identifyCascadingEffects(intent, resources);

    return {
      ...baseImpact,
      affectedResources,
      estimatedDuration: this.estimateDuration(intent, resources),
      estimatedCost,
      dependencies,
      cascadingEffects,
      isReversible: baseImpact.isReversible ?? true,
      reversalSteps: baseImpact.isReversible === false ? undefined : this.generateReversalSteps(intent, resources),
    };
  }

  private predictState(intentCategory: IntentCategory, currentState?: string): string {
    const stateMap: Partial<Record<IntentCategory, string>> = {
      create: "running",
      delete: "deleted",
      scale: "running",
      deploy: "running",
      rollback: "running",
      backup: currentState ?? "running",
      restore: "running",
      migrate: "running",
      configure: currentState ?? "running",
    };
    return stateMap[intentCategory] ?? currentState ?? "unknown";
  }

  private estimateDuration(intent: InfrastructureIntent, resources: ResolvedResource[]): string {
    const baseDurations: Partial<Record<IntentCategory, number>> = {
      create: 60,
      delete: 30,
      update: 60,
      scale: 120,
      deploy: 180,
      rollback: 120,
      backup: 300,
      restore: 600,
      migrate: 1800,
      configure: 30,
    };

    const baseSeconds = baseDurations[intent.category] ?? 60;
    const totalSeconds = baseSeconds * Math.max(1, resources.length);

    if (totalSeconds < 60) return `${totalSeconds} seconds`;
    if (totalSeconds < 3600) return `${Math.ceil(totalSeconds / 60)} minutes`;
    return `${Math.ceil(totalSeconds / 3600)} hours`;
  }

  private estimateCostImpact(
    intent: InfrastructureIntent,
    resources: ResolvedResource[],
    environment: Environment
  ): { currency: string; monthly: number; oneTime?: number } | undefined {
    // Simplified cost estimation - in production, this would use actual pricing APIs
    const environmentMultiplier = environment === "production" ? 1.5 : 1;

    if (intent.category === "create") {
      return {
        currency: "USD",
        monthly: resources.length * 50 * environmentMultiplier,
      };
    }

    if (intent.category === "scale") {
      return {
        currency: "USD",
        monthly: resources.length * 25 * environmentMultiplier,
      };
    }

    if (intent.category === "delete") {
      return {
        currency: "USD",
        monthly: -resources.length * 50 * environmentMultiplier,
      };
    }

    return undefined;
  }

  private identifyDependencies(resources: ResolvedResource[]): string[] {
    // In a real implementation, this would query actual dependency graphs
    const dependencies: string[] = [];

    for (const resource of resources) {
      switch (resource.type) {
        case "database":
          dependencies.push(`Applications connected to ${resource.name}`);
          break;
        case "loadbalancer":
          dependencies.push(`Backend services behind ${resource.name}`);
          break;
        case "network":
          dependencies.push(`Resources in ${resource.name}`);
          break;
      }
    }

    return dependencies;
  }

  private identifyCascadingEffects(intent: InfrastructureIntent, resources: ResolvedResource[]): string[] {
    const effects: string[] = [];

    if (intent.category === "delete") {
      for (const resource of resources) {
        if (resource.type === "database") {
          effects.push("All data in the database will be permanently lost");
        }
        if (resource.type === "storage") {
          effects.push("All objects in the storage will be permanently deleted");
        }
      }
    }

    if (intent.category === "scale" && resources.some(r => r.type === "database")) {
      effects.push("Database connections may be briefly interrupted during scaling");
    }

    if (intent.category === "migrate") {
      effects.push("Service may be unavailable during migration");
      effects.push("DNS propagation may take up to 48 hours");
    }

    return effects;
  }

  private generateReversalSteps(intent: InfrastructureIntent, resources: ResolvedResource[]): string[] {
    switch (intent.category) {
      case "create":
        return resources.map(r => `Delete ${r.type} "${r.name}"`);
      case "scale":
        return ["Scale back to previous capacity using: scale <resource> to <original-count>"];
      case "deploy":
        return ["Rollback to previous version using: rollback <service> to <previous-version>"];
      case "configure":
        return ["Restore previous configuration from backup"];
      default:
        return [];
    }
  }

  calculateRiskLevel(
    intent: InfrastructureIntent,
    resources: ResolvedResource[],
    environment: Environment
  ): RiskLevel {
    let risk: RiskLevel = "low";

    // Base risk from intent
    if (HIGH_RISK_INTENTS.includes(intent.category)) {
      risk = "high";
    } else if (intent.category === "update" || intent.category === "scale" || intent.category === "deploy") {
      risk = "medium";
    }

    // Elevate risk for production
    if (environment === "production") {
      if (risk === "low") risk = "medium";
      else if (risk === "medium") risk = "high";
      else if (risk === "high") risk = "critical";
    }

    // Elevate risk for multiple resources
    if (resources.length > 5) {
      if (risk === "low") risk = "medium";
      else if (risk === "medium") risk = "high";
    }

    // Elevate risk for critical resource types
    const criticalTypes = ["database", "network", "secrets"];
    if (resources.some(r => criticalTypes.includes(r.type))) {
      if (risk === "low") risk = "medium";
      else if (risk === "medium") risk = "high";
    }

    return risk;
  }

  private generateWarnings(
    intent: InfrastructureIntent,
    resources: ResolvedResource[],
    environment: Environment
  ): string[] {
    const warnings: string[] = [];

    if (environment === "production") {
      warnings.push("⚠️ This operation targets PRODUCTION resources");
    }

    if (intent.category === "delete") {
      warnings.push("⚠️ This operation is IRREVERSIBLE");
      if (resources.some(r => r.type === "database")) {
        warnings.push("⚠️ All database data will be permanently lost");
      }
    }

    if (resources.length > 3) {
      warnings.push(`⚠️ This operation affects ${resources.length} resources`);
    }

    if (intent.category === "migrate") {
      warnings.push("⚠️ Migration may cause service downtime");
    }

    if (intent.category === "rollback") {
      warnings.push("⚠️ Rollback will revert all changes since the target version");
    }

    return warnings;
  }

  private generateConfirmationPrompt(
    intent: InfrastructureIntent,
    resources: ResolvedResource[],
    environment: Environment,
    impact: OperationImpact
  ): string {
    const resourceList = resources.map(r => `"${r.name}" (${r.type})`).join(", ");
    const envLabel = environment.toUpperCase();

    let prompt = `You are about to ${intent.category} ${resources.length === 1 ? "the following resource" : `${resources.length} resources`} in ${envLabel}:\n`;
    prompt += `• ${resourceList}\n\n`;

    if (impact.estimatedDuration) {
      prompt += `Estimated duration: ${impact.estimatedDuration}\n`;
    }

    if (impact.estimatedCost) {
      const costChange = impact.estimatedCost.monthly >= 0 ? "+" : "";
      prompt += `Cost impact: ${costChange}$${Math.abs(impact.estimatedCost.monthly)}/month\n`;
    }

    if (impact.cascadingEffects && impact.cascadingEffects.length > 0) {
      prompt += `\nCascading effects:\n`;
      impact.cascadingEffects.forEach((e: string) => {
        prompt += `• ${e}\n`;
      });
    }

    prompt += `\nDo you want to proceed?`;

    return prompt;
  }

  private generateSuggestedActions(intent: InfrastructureIntent, riskLevel: RiskLevel): string[] {
    const actions: string[] = [];

    if (riskLevel === "high" || riskLevel === "critical") {
      actions.push("Run with --dry-run first to preview changes");
      actions.push("Create a backup before proceeding");
    }

    if (intent.category === "delete") {
      actions.push("Verify there are no dependent resources");
      actions.push("Consider disabling instead of deleting");
    }

    if (intent.category === "migrate") {
      actions.push("Test migration in a non-production environment first");
      actions.push("Schedule migration during low-traffic period");
    }

    return actions;
  }

  private generateConfirmationId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `confirm-${timestamp}-${random}`;
  }

  getPendingConfirmation(confirmationId: string): PendingConfirmation | undefined {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (pending && new Date() > pending.expiresAt) {
      this.pendingConfirmations.delete(confirmationId);
      return undefined;
    }
    return pending;
  }

  getAllPendingConfirmations(): PendingConfirmation[] {
    const now = new Date();
    const pending: PendingConfirmation[] = [];

    for (const [id, confirmation] of this.pendingConfirmations) {
      if (now > confirmation.expiresAt) {
        this.pendingConfirmations.delete(id);
      } else {
        pending.push(confirmation);
      }
    }

    return pending;
  }

  cancelConfirmation(confirmationId: string): boolean {
    return this.pendingConfirmations.delete(confirmationId);
  }

  clearExpiredConfirmations(): number {
    const now = new Date();
    let cleared = 0;

    for (const [id, confirmation] of this.pendingConfirmations) {
      if (now > confirmation.expiresAt) {
        this.pendingConfirmations.delete(id);
        cleared++;
      }
    }

    return cleared;
  }
}

export function createConfirmationWorkflow(config?: Partial<ConfirmationConfig>): InfrastructureConfirmationWorkflow {
  return new InfrastructureConfirmationWorkflow(config);
}

export function needsConfirmation(
  intent: InfrastructureIntent,
  environment: Environment,
  config?: Partial<ConfirmationConfig>
): boolean {
  return createConfirmationWorkflow(config).needsConfirmation(intent, environment);
}

export function analyzeOperationImpact(
  intent: InfrastructureIntent,
  resources: ResolvedResource[],
  environment: Environment,
  config?: Partial<ConfirmationConfig>
): OperationImpact {
  return createConfirmationWorkflow(config).analyzeImpact(intent, resources, environment);
}
