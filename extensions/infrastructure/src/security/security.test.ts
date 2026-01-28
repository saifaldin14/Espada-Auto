/**
 * Security Module Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRiskScorer, type RiskContext } from "./risk-scoring.js";
import { InfrastructureApprovalManager, InMemoryApprovalStorage } from "./approvals.js";
import { InfrastructureAuditLogger, InMemoryAuditStorage } from "./audit-logger.js";
import { InfrastructureRollbackManager, InMemoryRollbackStorage } from "./rollback.js";
import { InfrastructureRBACManager, InMemoryRBACStorage, DEFAULT_ROLES } from "./rbac.js";
import { InfrastructureTimeWindowManager, InMemoryTimeWindowStorage } from "./time-windows.js";
import { InfrastructureBreakGlassManager, InMemoryBreakGlassStorage } from "./break-glass.js";
import { InfrastructureSecurityFacade } from "./index.js";
import type { InfrastructureCommand } from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

const mockLogger: InfrastructureLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
  setLevel: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
};

const mockCommand: InfrastructureCommand = {
  id: "test-deploy",
  name: "Test Deploy",
  description: "Test deployment command",
  category: "deployment",
  provider: "test",
  riskLevel: "medium",
  requiresApproval: false,
  parameters: [],
  execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
};

describe("Risk Scoring", () => {
  it("should assess risk based on environment", () => {
    const scorer = createRiskScorer();
    const devContext: RiskContext = { command: mockCommand, parameters: {}, environment: "development", userId: "user1" };
    const prodContext: RiskContext = { command: mockCommand, parameters: {}, environment: "production", userId: "user1" };

    const devRisk = scorer.assessRisk(devContext);
    const prodRisk = scorer.assessRisk(prodContext);

    // Production should have higher or equal risk
    expect(devRisk.overallScore).toBeLessThanOrEqual(prodRisk.overallScore);
  });

  it("should identify high-risk commands", () => {
    const scorer = createRiskScorer();
    const deleteCommand: InfrastructureCommand = { ...mockCommand, id: "delete-all", name: "Delete All", riskLevel: "critical", category: "delete" };
    const context: RiskContext = { command: deleteCommand, parameters: {}, environment: "production", userId: "user1" };

    const risk = scorer.assessRisk(context);
    expect(["high", "critical"]).toContain(risk.riskLevel);
  });

  it("should apply parameter-based risk factors", () => {
    const scorer = createRiskScorer();
    const base: RiskContext = { command: mockCommand, parameters: {}, environment: "staging", userId: "user1" };
    const withForce: RiskContext = { ...base, parameters: { force: true } };

    const baseRisk = scorer.assessRisk(base);
    const forceRisk = scorer.assessRisk(withForce);

    expect(forceRisk.warnings.length).toBeGreaterThan(0);
  });
});

describe("Approval System", () => {
  let manager: InfrastructureApprovalManager;

  beforeEach(() => {
    manager = new InfrastructureApprovalManager({ storage: new InMemoryApprovalStorage(), logger: mockLogger });
  });

  it("should create approval requests", async () => {
    const request = await manager.createApprovalRequest({
      operationId: "op-1",
      command: mockCommand,
      parameters: {},
      environment: "production",
      requesterId: "user1",
      requesterName: "Test User",
      requesterRoles: ["developer"],
      reason: "Deploy new feature",
    });

    expect(request.id).toBeDefined();
    expect(request.status).toBe("pending");
    expect(request.environment).toBe("production");
  });

  it("should process approvals", async () => {
    const request = await manager.createApprovalRequest({
      operationId: "op-2",
      command: mockCommand,
      parameters: {},
      environment: "staging",
      requesterId: "user1",
      requesterName: "Test User",
      requesterRoles: ["developer"],
      reason: "Test",
    });

    const updated = await manager.submitApproval({
      requestId: request.id,
      approverId: "approver1",
      approverName: "Approver",
      decision: "approved",
    });

    expect(updated.status).toBe("approved");
  });

  it("should handle rejections", async () => {
    const request = await manager.createApprovalRequest({
      operationId: "op-3",
      command: mockCommand,
      parameters: {},
      environment: "production",
      requesterId: "user1",
      requesterName: "Test User",
      requesterRoles: ["developer"],
      reason: "Test",
    });

    const updated = await manager.submitApproval({
      requestId: request.id,
      approverId: "approver1",
      approverName: "Approver",
      decision: "rejected",
      reason: "Not approved",
    });

    expect(updated.status).toBe("rejected");
  });
});

describe("Audit Logger", () => {
  let logger: InfrastructureAuditLogger;

  beforeEach(() => {
    logger = new InfrastructureAuditLogger({ storage: new InMemoryAuditStorage(), config: { enableRealTimeProcessing: false } });
  });

  afterEach(() => {
    logger.destroy();
  });

  it("should log command executions", async () => {
    const entry = await logger.logCommandExecution({
      operationId: "op-1",
      commandId: "test-cmd",
      commandName: "Test Command",
      parameters: { key: "value" },
      actorId: "user1",
      actorName: "Test User",
      environment: "development",
      result: "success",
    });

    expect(entry.id).toBeDefined();
    expect(entry.eventType).toBe("command_executed");
  });

  it("should sanitize sensitive parameters", async () => {
    const entry = await logger.logCommandExecution({
      operationId: "op-2",
      commandId: "test-cmd",
      commandName: "Test Command",
      parameters: { password: "secret123", apiToken: "abc", normal: "visible" },
      actorId: "user1",
      actorName: "Test User",
      environment: "development",
      result: "success",
    });

    expect(entry.parameters?.password).toBe("[REDACTED]");
    expect(entry.parameters?.apiToken).toBe("[REDACTED]");
    expect(entry.parameters?.normal).toBe("visible");
  });

  it("should log access denied events", async () => {
    const entry = await logger.logAccessDenied({
      operationId: "op-3",
      commandId: "test-cmd",
      commandName: "Test Command",
      actorId: "user1",
      actorName: "Test User",
      environment: "production",
      reason: "Insufficient permissions",
    });

    expect(entry.eventType).toBe("access_denied");
    expect(entry.result).toBe("failure");
  });
});

describe("Rollback Manager", () => {
  let manager: InfrastructureRollbackManager;

  beforeEach(() => {
    manager = new InfrastructureRollbackManager({ storage: new InMemoryRollbackStorage(), logger: mockLogger });
  });

  it("should generate rollback plans", async () => {
    const plan = await manager.generateRollbackPlan({
      operationId: "op-1",
      command: mockCommand,
      parameters: { service: "api" },
      environment: "production",
      riskLevel: "medium",
    });

    expect(plan.operationId).toBe("op-1");
    expect(plan.status).toBe("available");
  });

  it("should capture pre-operation state", async () => {
    const plan = await manager.generateRollbackPlan({
      operationId: "op-2",
      command: mockCommand,
      parameters: {},
      environment: "staging",
      riskLevel: "low",
    });

    await manager.capturePreOperationState(plan.id, { config: { replicas: 3 } });
    const snapshot = await manager.getSnapshot(plan.id);

    expect(snapshot).toBeDefined();
    expect(snapshot?.config).toEqual({ replicas: 3 });
  });

  it("should cancel pending plans", async () => {
    const plan = await manager.generateRollbackPlan({
      operationId: "op-3",
      command: mockCommand,
      parameters: {},
      environment: "staging",
      riskLevel: "low",
    });

    const cancelled = await manager.cancelPlan(plan.id);
    expect(cancelled).toBe(true);

    const updatedPlan = await manager.getPlan(plan.id);
    expect(updatedPlan?.status).toBe("expired");
  });
});

describe("RBAC Manager", () => {
  let manager: InfrastructureRBACManager;

  beforeEach(async () => {
    manager = new InfrastructureRBACManager({ storage: new InMemoryRBACStorage(), logger: mockLogger });
    await manager.initialize();
  });

  it("should initialize with default roles", async () => {
    const roles = await manager.listRoles();
    expect(roles.length).toBe(DEFAULT_ROLES.length);
  });

  it("should allow admin full access", async () => {
    await manager.createUser({ id: "admin1", name: "Admin", email: "admin@test.com", roles: ["admin"], groups: [], mfaEnabled: true });

    const check = await manager.checkPermission({
      userId: "admin1",
      permission: "infra:delete",
      environment: "production",
      riskLevel: "critical",
    });

    expect(check.allowed).toBe(true);
  });

  it("should restrict viewer to read access", async () => {
    await manager.createUser({ id: "viewer1", name: "Viewer", email: "viewer@test.com", roles: ["viewer"], groups: [], mfaEnabled: false });

    const readCheck = await manager.checkPermission({
      userId: "viewer1",
      permission: "infra:read",
      environment: "production",
      riskLevel: "minimal",
    });

    const executeCheck = await manager.checkPermission({
      userId: "viewer1",
      permission: "infra:delete",
      environment: "production",
      riskLevel: "low",
    });

    expect(readCheck.allowed).toBe(true);
    expect(executeCheck.allowed).toBe(false);
  });

  it("should allow assigning roles", async () => {
    await manager.createUser({ id: "user1", name: "User", email: "user@test.com", roles: ["viewer"], groups: [], mfaEnabled: false });
    await manager.assignRole("user1", "developer");

    const user = await manager.getUser("user1");
    expect(user?.roles).toContain("developer");
  });
});

describe("Time Window Manager", () => {
  let manager: InfrastructureTimeWindowManager;

  beforeEach(async () => {
    manager = new InfrastructureTimeWindowManager({ storage: new InMemoryTimeWindowStorage(), logger: mockLogger });
    await manager.initialize();
  });

  it("should initialize with default windows", async () => {
    const windows = await manager.listTimeWindows();
    expect(windows.length).toBeGreaterThan(0);
  });

  it("should check time windows", async () => {
    const result = await manager.checkTimeWindow({ environment: "development", riskLevel: "low" });
    expect(result).toBeDefined();
  });

  it("should create change freezes", async () => {
    const freeze = await manager.createChangeFreeze({
      name: "Holiday Freeze",
      reason: "Holiday period",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      environments: ["production"],
    });

    expect(freeze.schedule.type).toBe("blackout");
    expect(freeze.name).toBe("Holiday Freeze");
  });
});

describe("Break Glass Manager", () => {
  let manager: InfrastructureBreakGlassManager;

  beforeEach(async () => {
    manager = new InfrastructureBreakGlassManager({ storage: new InMemoryBreakGlassStorage(), logger: mockLogger });
    await manager.initialize();
  });

  afterEach(() => {
    manager.destroy();
  });

  it("should initialize with default policies", async () => {
    const policies = await manager.listPolicies();
    expect(policies.length).toBeGreaterThan(0);
  });

  it("should activate break glass sessions", async () => {
    const session = await manager.activate({
      userId: "user1",
      userName: "Test User",
      environment: "production",
      reasonCode: "incident",
      justification: "Critical production incident",
      incidentTicket: "INC-123",
    });

    expect(session.id).toBeDefined();
    expect(session.status).toBe("active");
  });

  it("should check break glass access", async () => {
    await manager.activate({
      userId: "user2",
      userName: "Test User 2",
      environment: "production",
      reasonCode: "incident",
      justification: "Critical incident",
      incidentTicket: "INC-456",
    });

    const access = await manager.checkAccess("user2", "production", "high");
    expect(access.hasAccess).toBe(true);
  });

  it("should revoke sessions", async () => {
    const session = await manager.activate({
      userId: "user3",
      userName: "Test User 3",
      environment: "production",
      reasonCode: "incident",
      justification: "Test incident",
      incidentTicket: "INC-789",
    });

    const revoked = await manager.revokeSession(session.id, "admin", "Resolved");
    expect(revoked).toBe(true);

    const access = await manager.checkAccess("user3", "production", "low");
    expect(access.hasAccess).toBe(false);
  });
});

describe("Security Facade", () => {
  let facade: InfrastructureSecurityFacade;

  beforeEach(async () => {
    facade = new InfrastructureSecurityFacade({ logger: mockLogger });
    await facade.initialize();
    await facade.rbac.createUser({ id: "dev1", name: "Developer", email: "dev@test.com", roles: ["developer"], groups: [], mfaEnabled: false });
    await facade.rbac.createUser({ id: "admin1", name: "Admin", email: "admin@test.com", roles: ["admin"], groups: [], mfaEnabled: true });
  });

  afterEach(() => {
    facade.destroy();
  });

  it("should perform comprehensive security checks", async () => {
    const result = await facade.checkOperation({
      userId: "admin1",
      userName: "Admin",
      userRoles: ["admin"],
      command: mockCommand,
      parameters: {},
      environment: "development",
    });

    expect(result.allowed).toBe(true);
    expect(result.riskAssessment).toBeDefined();
  });

  it("should deny unauthorized operations", async () => {
    await facade.rbac.createUser({ id: "viewer1", name: "Viewer", email: "v@test.com", roles: ["viewer"], groups: [], mfaEnabled: false });

    const result = await facade.checkOperation({
      userId: "viewer1",
      userName: "Viewer",
      userRoles: ["viewer"],
      command: mockCommand,
      parameters: {},
      environment: "production",
    });

    expect(result.allowed).toBe(false);
  });

  it("should grant break glass access", async () => {
    await facade.activateBreakGlass({
      userId: "dev1",
      userName: "Developer",
      environment: "production",
      reasonCode: "maintenance",
      justification: "Emergency fix needed",
    });

    const criticalCommand: InfrastructureCommand = { ...mockCommand, riskLevel: "critical" };
    const result = await facade.checkOperation({
      userId: "dev1",
      userName: "Developer",
      userRoles: ["developer"],
      command: criticalCommand,
      parameters: {},
      environment: "production",
    });

    expect(result.allowed).toBe(true);
    expect(result.reasons).toContain("Break glass access granted");
  });
});
