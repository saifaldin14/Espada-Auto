/**
 * Security Module - Main Exports
 */

export * from "./types.js";
export * from "./risk-scoring.js";
export * from "./approvals.js";
export * from "./audit-logger.js";
export * from "./rollback.js";
export * from "./rbac.js";
export * from "./time-windows.js";
export * from "./break-glass.js";

import type { Environment, RiskLevel, RiskAssessment } from "./types.js";
import type { InfrastructureCommand } from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";
import { createRiskScorer, type RiskScoringConfig, type RiskContext } from "./risk-scoring.js";
import { createApprovalManager, type ApprovalSystemConfig, type ApprovalStorage, type InfrastructureApprovalManager } from "./approvals.js";
import { createAuditLogger, type AuditConfig, type AuditStorage, type InfrastructureAuditLogger } from "./audit-logger.js";
import { createRollbackManager, type RollbackConfig, type RollbackStorage, type InfrastructureRollbackManager } from "./rollback.js";
import { createRBACManager, type RBACConfig, type RBACStorage, type InfrastructureRBACManager } from "./rbac.js";
import { createTimeWindowManager, type TimeWindowConfig, type TimeWindowStorage, type InfrastructureTimeWindowManager } from "./time-windows.js";
import { createBreakGlassManager, type BreakGlassConfig, type BreakGlassStorage, type InfrastructureBreakGlassManager } from "./break-glass.js";

export interface SecurityFacadeConfig {
  riskScoring?: Partial<RiskScoringConfig>;
  approvals?: Partial<ApprovalSystemConfig>;
  audit?: Partial<AuditConfig>;
  rollback?: Partial<RollbackConfig>;
  rbac?: Partial<RBACConfig>;
  timeWindows?: Partial<TimeWindowConfig>;
  breakGlass?: Partial<BreakGlassConfig>;
}

export interface SecurityFacadeStorage {
  approvals?: ApprovalStorage;
  audit?: AuditStorage;
  rollback?: RollbackStorage;
  rbac?: RBACStorage;
  timeWindows?: TimeWindowStorage;
  breakGlass?: BreakGlassStorage;
}

export interface SecurityCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
  riskAssessment: RiskAssessment;
  approvalId?: string;
}

/**
 * Unified security facade for infrastructure operations
 */
export class InfrastructureSecurityFacade {
  private logger: InfrastructureLogger;
  private riskScorer: ReturnType<typeof createRiskScorer>;
  private approvalManager: InfrastructureApprovalManager;
  private auditLogger: InfrastructureAuditLogger;
  private rollbackManager: InfrastructureRollbackManager;
  private rbacManager: InfrastructureRBACManager;
  private timeWindowManager: InfrastructureTimeWindowManager;
  private breakGlassManager: InfrastructureBreakGlassManager;
  private initialized = false;

  constructor(options: { config?: SecurityFacadeConfig; storage?: SecurityFacadeStorage; logger: InfrastructureLogger }) {
    this.logger = options.logger;
    this.riskScorer = createRiskScorer(options.config?.riskScoring);
    this.auditLogger = createAuditLogger({ config: options.config?.audit, storage: options.storage?.audit });
    this.approvalManager = createApprovalManager({ config: options.config?.approvals, storage: options.storage?.approvals, logger: options.logger });
    this.rollbackManager = createRollbackManager({ config: options.config?.rollback, storage: options.storage?.rollback, logger: options.logger });
    this.rbacManager = createRBACManager({ config: options.config?.rbac, storage: options.storage?.rbac, logger: options.logger });
    this.timeWindowManager = createTimeWindowManager({ config: options.config?.timeWindows, storage: options.storage?.timeWindows, logger: options.logger });
    this.breakGlassManager = createBreakGlassManager({ config: options.config?.breakGlass, storage: options.storage?.breakGlass, logger: options.logger, auditLogger: this.auditLogger });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rbacManager.initialize();
    await this.timeWindowManager.initialize();
    await this.breakGlassManager.initialize();
    this.initialized = true;
    this.logger.info("Security facade initialized");
  }

  async checkOperation(options: {
    userId: string;
    userName: string;
    userRoles: string[];
    command: InfrastructureCommand;
    parameters: Record<string, unknown>;
    environment: Environment;
    resourceIds?: string[];
  }): Promise<SecurityCheckResult> {
    const reasons: string[] = [];

    // 1. Assess risk
    const riskContext: RiskContext = {
      command: options.command,
      parameters: options.parameters,
      environment: options.environment,
      userId: options.userId,
      resourceIds: options.resourceIds,
    };
    const riskAssessment = this.riskScorer.assessRisk(riskContext);

    // 2. Check break glass access first (emergency bypass)
    const breakGlassAccess = await this.breakGlassManager.checkAccess(options.userId, options.environment, riskAssessment.riskLevel);
    if (breakGlassAccess.hasAccess) {
      this.logger.warn("Break glass access used", { userId: options.userId, sessionId: breakGlassAccess.session?.id });
      return { allowed: true, requiresApproval: false, reasons: ["Break glass access granted"], riskAssessment };
    }

    // 3. Check RBAC permissions
    const permissionCheck = await this.rbacManager.checkPermission({
      userId: options.userId,
      permission: "infra:update",
      environment: options.environment,
      riskLevel: riskAssessment.riskLevel,
    });

    if (!permissionCheck.allowed) {
      reasons.push(`RBAC: ${permissionCheck.reason ?? "Permission denied"}`);
      await this.auditLogger.logAccessDenied({
        operationId: `op-${Date.now()}`,
        commandId: options.command.id,
        commandName: options.command.name,
        actorId: options.userId,
        actorName: options.userName,
        environment: options.environment,
        reason: permissionCheck.reason ?? "Permission denied",
      });
      return { allowed: false, requiresApproval: false, reasons, riskAssessment };
    }

    // 4. Check time windows
    const timeWindowCheck = await this.timeWindowManager.checkTimeWindow({
      environment: options.environment,
      riskLevel: riskAssessment.riskLevel,
    });

    if (!timeWindowCheck.allowed) {
      reasons.push(`Time window: ${timeWindowCheck.reason ?? "Outside allowed window"}`);
      return { allowed: false, requiresApproval: false, reasons, riskAssessment };
    }

    // 5. Determine if approval is required
    const requiresApproval = permissionCheck.requiresApproval || riskAssessment.riskLevel === "high" || riskAssessment.riskLevel === "critical";

    return { allowed: true, requiresApproval, reasons: reasons.length > 0 ? reasons : ["All checks passed"], riskAssessment };
  }

  async createApprovalRequest(options: {
    operationId: string;
    command: InfrastructureCommand;
    parameters: Record<string, unknown>;
    environment: Environment;
    requesterId: string;
    requesterName: string;
    requesterRoles: string[];
    reason: string;
    resourceIds?: string[];
  }) {
    return this.approvalManager.createApprovalRequest(options);
  }

  async submitApproval(options: { requestId: string; approverId: string; approverName: string; decision: "approved" | "rejected"; reason?: string }) {
    return this.approvalManager.submitApproval(options);
  }

  async logCommandExecution(options: {
    operationId: string;
    commandId: string;
    commandName: string;
    parameters: Record<string, unknown>;
    actorId: string;
    actorName: string;
    environment: Environment;
    result: "success" | "failure";
    errorMessage?: string;
    durationMs?: number;
  }) {
    return this.auditLogger.logCommandExecution(options);
  }

  async generateRollbackPlan(options: {
    operationId: string;
    command: InfrastructureCommand;
    parameters: Record<string, unknown>;
    environment: Environment;
    riskLevel: RiskLevel;
  }) {
    return this.rollbackManager.generateRollbackPlan(options);
  }

  async activateBreakGlass(options: {
    userId: string;
    userName: string;
    environment: Environment;
    reasonCode: string;
    justification: string;
  }) {
    return this.breakGlassManager.activate(options);
  }

  // Expose managers for advanced use cases
  get approval() { return this.approvalManager; }
  get audit() { return this.auditLogger; }
  get rollback() { return this.rollbackManager; }
  get rbac() { return this.rbacManager; }
  get timeWindow() { return this.timeWindowManager; }
  get breakGlass() { return this.breakGlassManager; }

  destroy(): void {
    this.auditLogger.destroy();
    this.breakGlassManager.destroy();
  }
}

export function createSecurityFacade(options: { config?: SecurityFacadeConfig; storage?: SecurityFacadeStorage; logger: InfrastructureLogger }): InfrastructureSecurityFacade {
  return new InfrastructureSecurityFacade(options);
}
