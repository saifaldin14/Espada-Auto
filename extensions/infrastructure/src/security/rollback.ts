/**
 * Infrastructure Rollback System
 */

import type { RollbackPlan, RollbackStep, RiskLevel, Environment } from "./types.js";
import type { InfrastructureCommand } from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

export type CommandRollbackMapping = { commandId: string; rollbackCommandId?: string; rollbackStrategy: "reverse-command" | "restore-snapshot" | "manual" | "no-rollback"; estimatedDurationMs: number; requiresApproval: boolean; };
export type RollbackConfig = { maxRollbackAgeMinutes: number; enableAutoRollback: boolean; snapshotRetentionMinutes: number; commandMappings: CommandRollbackMapping[]; defaultStrategy: "manual" | "no-rollback"; };

export const defaultRollbackConfig: RollbackConfig = {
  maxRollbackAgeMinutes: 60,
  enableAutoRollback: false,
  snapshotRetentionMinutes: 120,
  defaultStrategy: "manual",
  commandMappings: [
    { commandId: "create-resource", rollbackCommandId: "delete-resource", rollbackStrategy: "reverse-command", estimatedDurationMs: 5000, requiresApproval: false },
    { commandId: "update-config", rollbackStrategy: "restore-snapshot", estimatedDurationMs: 3000, requiresApproval: true },
    { commandId: "deploy-service", rollbackCommandId: "rollback-deploy", rollbackStrategy: "reverse-command", estimatedDurationMs: 30000, requiresApproval: true },
    { commandId: "delete-resource", rollbackStrategy: "no-rollback", estimatedDurationMs: 0, requiresApproval: false },
  ],
};

export interface RollbackStorage {
  savePlan(plan: RollbackPlan): Promise<void>;
  getPlan(id: string): Promise<RollbackPlan | null>;
  updatePlan(id: string, updates: Partial<RollbackPlan>): Promise<void>;
  listPlans(options?: { environment?: Environment; status?: RollbackPlan["status"] }): Promise<RollbackPlan[]>;
  saveSnapshot(planId: string, snapshot: Record<string, unknown>): Promise<void>;
  getSnapshot(planId: string): Promise<Record<string, unknown> | null>;
}

export class InMemoryRollbackStorage implements RollbackStorage {
  private plans: Map<string, RollbackPlan> = new Map();
  private snapshots: Map<string, Record<string, unknown>> = new Map();

  async savePlan(plan: RollbackPlan): Promise<void> { this.plans.set(plan.id, plan); }
  async getPlan(id: string): Promise<RollbackPlan | null> { return this.plans.get(id) ?? null; }
  async updatePlan(id: string, updates: Partial<RollbackPlan>): Promise<void> {
    const plan = this.plans.get(id);
    if (plan) this.plans.set(id, { ...plan, ...updates });
  }
  async listPlans(options?: { environment?: Environment; status?: RollbackPlan["status"] }): Promise<RollbackPlan[]> {
    let results = Array.from(this.plans.values());
    if (options?.environment) results = results.filter(p => p.environment === options.environment);
    if (options?.status) results = results.filter(p => p.status === options.status);
    return results;
  }
  async saveSnapshot(planId: string, snapshot: Record<string, unknown>): Promise<void> { this.snapshots.set(planId, snapshot); }
  async getSnapshot(planId: string): Promise<Record<string, unknown> | null> { return this.snapshots.get(planId) ?? null; }
}

export class InfrastructureRollbackManager {
  private config: RollbackConfig;
  private storage: RollbackStorage;
  private logger: InfrastructureLogger;

  constructor(options: { config?: Partial<RollbackConfig>; storage?: RollbackStorage; logger: InfrastructureLogger }) {
    this.config = { ...defaultRollbackConfig, ...options.config };
    this.storage = options.storage ?? new InMemoryRollbackStorage();
    this.logger = options.logger;
  }

  async generateRollbackPlan(options: { operationId: string; command: InfrastructureCommand; parameters: Record<string, unknown>; environment: Environment; riskLevel: RiskLevel; resourceIds?: string[]; createdBy?: string; }): Promise<RollbackPlan> {
    const mapping = this.config.commandMappings.find(m => m.commandId === options.command.id);
    const steps = this.buildSteps(options, mapping);

    const plan: RollbackPlan = {
      id: `rbk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationId: options.operationId,
      commandId: options.command.id,
      commandName: options.command.name,
      environment: options.environment,
      createdBy: options.createdBy,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.maxRollbackAgeMinutes * 60 * 1000),
      status: "available",
      steps,
      preRollbackState: {},
      estimatedDuration: mapping?.estimatedDurationMs ?? 0,
      riskLevel: options.riskLevel,
      requiresApproval: mapping?.requiresApproval ?? false,
      metadata: { strategy: mapping?.rollbackStrategy ?? this.config.defaultStrategy },
    };

    await this.storage.savePlan(plan);
    this.logger.info("Rollback plan created", { planId: plan.id, operationId: plan.operationId });
    return plan;
  }

  async capturePreOperationState(planId: string, state: Record<string, unknown>): Promise<void> {
    const plan = await this.storage.getPlan(planId);
    if (plan) {
      await this.storage.updatePlan(planId, { preRollbackState: state });
      await this.storage.saveSnapshot(planId, { ...state, capturedAt: new Date() });
      this.logger.debug("Pre-operation state captured", { planId });
    }
  }

  async executeRollback(planId: string, executor: (step: RollbackStep) => Promise<{ success: boolean; error?: string; output?: unknown }>): Promise<{ success: boolean; completedSteps: number; errors: string[] }> {
    const plan = await this.storage.getPlan(planId);
    if (!plan) throw new Error(`No rollback plan found: ${planId}`);
    if (plan.status !== "available") throw new Error(`Rollback cannot be executed: ${plan.status}`);
    if (new Date() > plan.expiresAt) throw new Error("Rollback plan expired");

    await this.storage.updatePlan(planId, { status: "executing" });

    const errors: string[] = [];
    let completedSteps = 0;

    for (const step of plan.steps) {
      step.status = "executing";
      step.startedAt = new Date();

      const result = await executor(step);
      step.completedAt = new Date();
      step.output = result.output;

      if (result.success) {
        step.status = "completed";
        completedSteps++;
      } else {
        step.status = "failed";
        step.error = result.error;
        errors.push(`Step ${step.stepNumber}: ${result.error}`);
        break;
      }
    }

    const finalStatus = completedSteps === plan.steps.length ? "completed" : "failed";
    await this.storage.updatePlan(planId, { status: finalStatus, steps: plan.steps });
    this.logger.info("Rollback executed", { planId, success: finalStatus === "completed", completedSteps });

    return { success: finalStatus === "completed", completedSteps, errors };
  }

  async getPlan(id: string): Promise<RollbackPlan | null> { return this.storage.getPlan(id); }
  async getSnapshot(planId: string): Promise<Record<string, unknown> | null> { return this.storage.getSnapshot(planId); }
  async cancelPlan(id: string): Promise<boolean> {
    const plan = await this.storage.getPlan(id);
    if (!plan || plan.status !== "available") return false;
    await this.storage.updatePlan(id, { status: "expired" });
    return true;
  }

  private buildSteps(options: { command: InfrastructureCommand; parameters: Record<string, unknown>; resourceIds?: string[] }, mapping?: CommandRollbackMapping): RollbackStep[] {
    if (!mapping || mapping.rollbackStrategy === "no-rollback") return [];

    const step: RollbackStep = {
      stepNumber: 0,
      description: `Rollback ${options.command.name}`,
      command: mapping.rollbackCommandId ?? "manual-rollback",
      parameters: { ...options.parameters, _rollback: true },
      resourceIds: options.resourceIds ?? [],
      timeout: mapping.estimatedDurationMs,
      status: "pending",
      canRetry: true,
    };

    return [step];
  }
}

export function createRollbackManager(options: { config?: Partial<RollbackConfig>; storage?: RollbackStorage; logger: InfrastructureLogger }): InfrastructureRollbackManager {
  return new InfrastructureRollbackManager(options);
}
