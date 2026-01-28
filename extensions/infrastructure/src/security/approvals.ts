/**
 * Infrastructure Approval System
 */

import type { ApprovalRequest, ApprovalStatus, ApprovalChainStep, ApprovalDecision, EscalationPolicy, Environment, RiskLevel, ApprovalCondition } from "./types.js";
import type { InfrastructureCommand } from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";
import { createRiskScorer, type RiskContext } from "./risk-scoring.js";

export type ApprovalChainStepTemplate = { approverRole: string; requiredApprovals: number; timeoutMinutes?: number; escalationPolicy?: EscalationPolicy; };
export type ApprovalChainTemplate = { id: string; name: string; description: string; environments: Environment[]; minRiskLevel: RiskLevel; steps: ApprovalChainStepTemplate[]; expirationMinutes: number; allowParallelApprovals: boolean; };

export type ApprovalSystemConfig = {
  defaultExpirationMinutes: number;
  allowSelfApproval: boolean;
  maxChainLength: number;
  enableAutoEscalation: boolean;
  chainTemplates: ApprovalChainTemplate[];
};

export const defaultApprovalConfig: ApprovalSystemConfig = {
  defaultExpirationMinutes: 60,
  allowSelfApproval: false,
  maxChainLength: 5,
  enableAutoEscalation: true,
  chainTemplates: [
    { id: "dev-minimal", name: "Dev Minimal", description: "Minimal approval for dev", environments: ["development"], minRiskLevel: "minimal", steps: [], expirationMinutes: 30, allowParallelApprovals: true },
    { id: "staging-standard", name: "Staging Standard", description: "Standard staging approval", environments: ["staging"], minRiskLevel: "low", steps: [{ approverRole: "team-lead", requiredApprovals: 1 }], expirationMinutes: 60, allowParallelApprovals: false },
    { id: "prod-standard", name: "Prod Standard", description: "Production approval", environments: ["production"], minRiskLevel: "medium", steps: [{ approverRole: "team-lead", requiredApprovals: 1 }, { approverRole: "sre", requiredApprovals: 1 }], expirationMinutes: 120, allowParallelApprovals: false },
    { id: "prod-high-risk", name: "Prod High Risk", description: "High risk production", environments: ["production"], minRiskLevel: "high", steps: [{ approverRole: "sre", requiredApprovals: 2 }, { approverRole: "engineering-manager", requiredApprovals: 1 }], expirationMinutes: 240, allowParallelApprovals: false },
  ],
};

export interface ApprovalStorage {
  save(request: ApprovalRequest): Promise<void>;
  get(id: string): Promise<ApprovalRequest | null>;
  list(options?: { status?: ApprovalStatus; environment?: Environment; requesterId?: string }): Promise<ApprovalRequest[]>;
  delete(id: string): Promise<void>;
}

export class InMemoryApprovalStorage implements ApprovalStorage {
  private requests: Map<string, ApprovalRequest> = new Map();
  async save(request: ApprovalRequest): Promise<void> { this.requests.set(request.id, request); }
  async get(id: string): Promise<ApprovalRequest | null> { return this.requests.get(id) ?? null; }
  async list(options?: { status?: ApprovalStatus; environment?: Environment; requesterId?: string }): Promise<ApprovalRequest[]> {
    let results = Array.from(this.requests.values());
    if (options?.status) results = results.filter(r => r.status === options.status);
    if (options?.environment) results = results.filter(r => r.environment === options.environment);
    if (options?.requesterId) results = results.filter(r => r.requesterId === options.requesterId);
    return results;
  }
  async delete(id: string): Promise<void> { this.requests.delete(id); }
}

export class InfrastructureApprovalManager {
  private config: ApprovalSystemConfig;
  private storage: ApprovalStorage;
  private logger: InfrastructureLogger;
  private riskScorer = createRiskScorer();

  constructor(options: { config?: Partial<ApprovalSystemConfig>; storage?: ApprovalStorage; logger: InfrastructureLogger }) {
    this.config = { ...defaultApprovalConfig, ...options.config };
    this.storage = options.storage ?? new InMemoryApprovalStorage();
    this.logger = options.logger;
  }

  async createApprovalRequest(options: { operationId: string; command: InfrastructureCommand; parameters: Record<string, unknown>; environment: Environment; requesterId: string; requesterName: string; requesterRoles: string[]; reason: string; resourceIds?: string[]; metadata?: Record<string, unknown>; }): Promise<ApprovalRequest> {
    const riskContext: RiskContext = { command: options.command, parameters: options.parameters, environment: options.environment, userId: options.requesterId, resourceIds: options.resourceIds };
    const riskAssessment = this.riskScorer.assessRisk(riskContext);
    const template = this.findTemplate(options.environment, riskAssessment.riskLevel);
    const approvalChain = this.buildChain(template);
    const expirationMinutes = template?.expirationMinutes ?? this.config.defaultExpirationMinutes;

    const request: ApprovalRequest = {
      id: `apr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationId: options.operationId,
      commandId: options.command.id,
      commandName: options.command.name,
      parameters: options.parameters,
      environment: options.environment,
      riskLevel: riskAssessment.riskLevel,
      riskScore: riskAssessment.overallScore,
      requesterId: options.requesterId,
      requesterName: options.requesterName,
      requesterRoles: options.requesterRoles,
      reason: options.reason,
      status: "pending",
      approvalChain,
      currentStep: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + expirationMinutes * 60 * 1000),
      metadata: { ...options.metadata, riskAssessment, templateId: template?.id },
    };

    await this.storage.save(request);
    this.logger.info("Approval request created", { requestId: request.id, environment: request.environment, riskLevel: request.riskLevel });
    return request;
  }

  async submitApproval(options: { requestId: string; approverId: string; approverName: string; decision: "approved" | "rejected"; reason?: string; conditions?: ApprovalCondition[]; }): Promise<ApprovalRequest> {
    const request = await this.storage.get(options.requestId);
    if (!request) throw new Error(`Request not found: ${options.requestId}`);
    if (request.status !== "pending") throw new Error(`Request is ${request.status}`);

    const currentStep = request.approvalChain[request.currentStep];
    if (!currentStep) {
      request.status = options.decision === "approved" ? "approved" : "rejected";
    } else {
      const decision: ApprovalDecision = { approverId: options.approverId, approverName: options.approverName, decision: options.decision, reason: options.reason, timestamp: new Date(), conditions: options.conditions };
      currentStep.approvals.push(decision);

      if (options.decision === "rejected") {
        request.status = "rejected";
        currentStep.status = "rejected";
      } else if (currentStep.approvals.filter(a => a.decision === "approved").length >= currentStep.requiredApprovals) {
        currentStep.status = "approved";
        if (request.currentStep >= request.approvalChain.length - 1) {
          request.status = "approved";
        } else {
          request.currentStep++;
        }
      }
    }

    await this.storage.save(request);
    this.logger.info("Approval submitted", { requestId: request.id, decision: options.decision, status: request.status });
    return request;
  }

  async getRequest(id: string): Promise<ApprovalRequest | null> { return this.storage.get(id); }
  async listRequests(options?: { status?: ApprovalStatus; environment?: Environment }): Promise<ApprovalRequest[]> { return this.storage.list(options); }
  async cancelRequest(id: string, cancelledBy: string): Promise<{ success: boolean }> {
    const request = await this.storage.get(id);
    if (!request) return { success: false };
    request.status = "cancelled";
    request.metadata = { ...request.metadata, cancelledBy, cancelledAt: new Date() };
    await this.storage.save(request);
    return { success: true };
  }

  private findTemplate(env: Environment, level: RiskLevel): ApprovalChainTemplate | undefined {
    const levels: RiskLevel[] = ["critical", "high", "medium", "low", "minimal"];
    return this.config.chainTemplates.find(t => t.environments.includes(env) && levels.indexOf(level) <= levels.indexOf(t.minRiskLevel));
  }

  private buildChain(template?: ApprovalChainTemplate): ApprovalChainStep[] {
    if (!template) return [];
    return template.steps.map((s, i) => ({ stepNumber: i, approverRole: s.approverRole, requiredApprovals: s.requiredApprovals, approvals: [], status: "pending" as ApprovalStatus, escalationPolicy: s.escalationPolicy }));
  }
}

export function createApprovalManager(options: { config?: Partial<ApprovalSystemConfig>; storage?: ApprovalStorage; logger: InfrastructureLogger }): InfrastructureApprovalManager {
  return new InfrastructureApprovalManager(options);
}
