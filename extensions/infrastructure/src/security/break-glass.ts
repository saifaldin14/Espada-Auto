/**
 * Infrastructure Emergency Break Glass Procedures
 */

import type { BreakGlassSession, BreakGlassPolicy, BreakGlassReason, Environment, RiskLevel, InfrastructurePermission } from "./types.js";
import type { InfrastructureLogger } from "../logging/logger.js";
import type { InfrastructureAuditLogger } from "./audit-logger.js";

export type BreakGlassConfig = { maxSessionDurationMinutes: number; requireJustification: boolean; notifyOnActivation: string[]; autoRevokeOnExpiry: boolean; cooldownMinutes: number; maxActiveSessions: number; };
export const defaultBreakGlassConfig: BreakGlassConfig = { maxSessionDurationMinutes: 60, requireJustification: true, notifyOnActivation: ["security-team", "sre-oncall"], autoRevokeOnExpiry: true, cooldownMinutes: 15, maxActiveSessions: 3 };

export interface BreakGlassStorage {
  save(session: BreakGlassSession): Promise<void>;
  get(id: string): Promise<BreakGlassSession | null>;
  getActiveByUser(userId: string): Promise<BreakGlassSession[]>;
  list(options?: { status?: BreakGlassSession["status"]; environment?: Environment }): Promise<BreakGlassSession[]>;
  update(id: string, updates: Partial<BreakGlassSession>): Promise<void>;
  savePolicy(policy: BreakGlassPolicy): Promise<void>;
  getPolicy(id: string): Promise<BreakGlassPolicy | null>;
  listPolicies(): Promise<BreakGlassPolicy[]>;
  saveReason(reason: BreakGlassReason): Promise<void>;
  getReason(code: string): Promise<BreakGlassReason | null>;
  listReasons(): Promise<BreakGlassReason[]>;
}

export class InMemoryBreakGlassStorage implements BreakGlassStorage {
  private sessions: Map<string, BreakGlassSession> = new Map();
  private policies: Map<string, BreakGlassPolicy> = new Map();
  private reasons: Map<string, BreakGlassReason> = new Map();

  async save(session: BreakGlassSession): Promise<void> { this.sessions.set(session.id, session); }
  async get(id: string): Promise<BreakGlassSession | null> { return this.sessions.get(id) ?? null; }
  async getActiveByUser(userId: string): Promise<BreakGlassSession[]> {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId && s.status === "active");
  }
  async list(options?: { status?: BreakGlassSession["status"]; environment?: Environment }): Promise<BreakGlassSession[]> {
    let results = Array.from(this.sessions.values());
    if (options?.status) results = results.filter(s => s.status === options.status);
    if (options?.environment) results = results.filter(s => s.environment === options.environment);
    return results;
  }
  async update(id: string, updates: Partial<BreakGlassSession>): Promise<void> {
    const session = this.sessions.get(id);
    if (session) this.sessions.set(id, { ...session, ...updates });
  }
  async savePolicy(policy: BreakGlassPolicy): Promise<void> { this.policies.set(policy.id, policy); }
  async getPolicy(id: string): Promise<BreakGlassPolicy | null> { return this.policies.get(id) ?? null; }
  async listPolicies(): Promise<BreakGlassPolicy[]> { return Array.from(this.policies.values()); }
  async saveReason(reason: BreakGlassReason): Promise<void> { this.reasons.set(reason.code, reason); }
  async getReason(code: string): Promise<BreakGlassReason | null> { return this.reasons.get(code) ?? null; }
  async listReasons(): Promise<BreakGlassReason[]> { return Array.from(this.reasons.values()); }
}

export const DEFAULT_POLICIES: BreakGlassPolicy[] = [
  {
    id: "emergency-prod",
    name: "Production Emergency",
    description: "Emergency access to production for critical incidents",
    environment: "production",
    allowedRoles: ["sre", "admin"],
    requiredApprovers: 0,
    maxDurationMinutes: 60,
    requiresJustification: true,
    requiresIncidentTicket: true,
    autoNotify: ["security-team", "sre-oncall"],
    enabled: true,
    postMortemRequired: true,
  },
  {
    id: "planned-maintenance",
    name: "Planned Maintenance",
    description: "Elevated access for planned maintenance",
    environment: "production",
    allowedRoles: ["sre", "developer", "admin"],
    requiredApprovers: 1,
    maxDurationMinutes: 240,
    requiresJustification: true,
    requiresIncidentTicket: false,
    autoNotify: ["sre-oncall"],
    enabled: true,
  },
];

export const DEFAULT_REASONS: BreakGlassReason[] = [
  { code: "incident", name: "Active Incident", description: "Responding to an active production incident", requiresIncidentTicket: true, allowedEnvironments: ["production", "staging"], maxDuration: 60 },
  { code: "security_breach", name: "Security Breach", description: "Responding to a security incident", requiresIncidentTicket: true, allowedEnvironments: ["production", "staging", "development"], maxDuration: 120 },
  { code: "data_recovery", name: "Data Recovery", description: "Emergency data recovery operation", requiresIncidentTicket: true, allowedEnvironments: ["production"], maxDuration: 180 },
  { code: "maintenance", name: "Planned Maintenance", description: "Pre-approved maintenance window", requiresIncidentTicket: false, allowedEnvironments: ["production", "staging"], maxDuration: 240 },
];

export class InfrastructureBreakGlassManager {
  private config: BreakGlassConfig;
  private storage: BreakGlassStorage;
  private logger: InfrastructureLogger;
  private auditLogger?: InfrastructureAuditLogger;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: { config?: Partial<BreakGlassConfig>; storage?: BreakGlassStorage; logger: InfrastructureLogger; auditLogger?: InfrastructureAuditLogger }) {
    this.config = { ...defaultBreakGlassConfig, ...options.config };
    this.storage = options.storage ?? new InMemoryBreakGlassStorage();
    this.logger = options.logger;
    this.auditLogger = options.auditLogger;
    if (this.config.autoRevokeOnExpiry) this.startExpiryChecker();
  }

  async initialize(): Promise<void> {
    for (const policy of DEFAULT_POLICIES) await this.storage.savePolicy(policy);
    for (const reason of DEFAULT_REASONS) await this.storage.saveReason(reason);
    this.logger.info("Break glass policies initialized");
  }

  async activate(options: { userId: string; userName: string; environment: Environment; reasonCode: string; justification: string; policyId?: string; requestedDurationMinutes?: number; incidentTicket?: string; }): Promise<BreakGlassSession> {
    if (this.config.requireJustification && !options.justification.trim()) {
      throw new Error("Justification is required");
    }

    const activeSessions = await this.storage.getActiveByUser(options.userId);
    if (activeSessions.length >= this.config.maxActiveSessions) {
      throw new Error(`Maximum ${this.config.maxActiveSessions} active sessions allowed`);
    }

    const reason = await this.storage.getReason(options.reasonCode);
    if (!reason) throw new Error(`Invalid reason code: ${options.reasonCode}`);
    if (!reason.allowedEnvironments.includes(options.environment)) throw new Error(`Reason not allowed for ${options.environment}`);
    if (reason.requiresIncidentTicket && !options.incidentTicket) throw new Error("Incident ticket required");

    const policy = options.policyId ? await this.storage.getPolicy(options.policyId) : await this.findMatchingPolicy(options.environment);
    if (!policy) throw new Error("No matching break glass policy found");
    if (!policy.enabled) throw new Error("Policy is not enabled");

    const durationMinutes = Math.min(options.requestedDurationMinutes ?? policy.maxDurationMinutes, this.config.maxSessionDurationMinutes, reason.maxDuration);

    const session: BreakGlassSession = {
      id: `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: options.userId,
      userName: options.userName,
      environment: options.environment,
      policyId: policy.id,
      status: policy.requiredApprovers === 0 ? "active" : "pending",
      reason: { code: options.reasonCode, justification: options.justification, incidentTicket: options.incidentTicket },
      scope: {},
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + durationMinutes * 60 * 1000),
      operationsPerformed: [],
      postMortemRequired: policy.postMortemRequired ?? false,
      grantedPermissions: this.buildGrantedPermissions(policy),
    };

    await this.storage.save(session);
    this.logger.warn("Break glass session activated", { sessionId: session.id, userId: session.userId, environment: session.environment, reasonCode: options.reasonCode });

    if (this.auditLogger) {
      await this.auditLogger.logBreakGlassEvent({
        eventType: "break_glass_activated",
        actorId: session.userId,
        actorName: session.userName ?? session.userId,
        environment: session.environment,
        sessionId: session.id,
        reason: options.justification,
        metadata: { policyId: policy.id, expiresAt: session.expiresAt, reasonCode: options.reasonCode },
      });
    }

    return session;
  }

  async revokeSession(sessionId: string, revokedBy: string, reason?: string): Promise<boolean> {
    const session = await this.storage.get(sessionId);
    if (!session || session.status !== "active") return false;

    await this.storage.update(sessionId, { status: "revoked", revokedAt: new Date(), revokedBy, revokeReason: reason });
    this.logger.warn("Break glass session revoked", { sessionId, revokedBy, reason });

    if (this.auditLogger) {
      await this.auditLogger.logBreakGlassEvent({
        eventType: "break_glass_deactivated",
        actorId: revokedBy,
        actorName: revokedBy,
        environment: session.environment,
        sessionId: sessionId,
        reason: reason ?? "Manual revocation",
      });
    }

    return true;
  }

  async recordOperation(sessionId: string, operation: { type: string; resource: string; details?: Record<string, unknown> }): Promise<void> {
    const session = await this.storage.get(sessionId);
    if (!session || session.status !== "active") throw new Error("No active session");

    session.operationsPerformed.push({ ...operation, timestamp: new Date() });
    await this.storage.update(sessionId, { operationsPerformed: session.operationsPerformed });
  }

  async checkAccess(userId: string, environment: Environment, _riskLevel: RiskLevel): Promise<{ hasAccess: boolean; session?: BreakGlassSession; reason: string }> {
    const sessions = await this.storage.getActiveByUser(userId);
    const validSession = sessions.find(s => {
      if (s.environment !== environment) return false;
      if (s.expiresAt && new Date() > s.expiresAt) return false;
      return true;
    });

    if (!validSession) return { hasAccess: false, reason: "No active break glass session" };
    return { hasAccess: true, session: validSession, reason: "Break glass access granted" };
  }

  async getSession(id: string): Promise<BreakGlassSession | null> { return this.storage.get(id); }
  async listSessions(options?: { status?: BreakGlassSession["status"]; environment?: Environment }): Promise<BreakGlassSession[]> { return this.storage.list(options); }
  async listPolicies(): Promise<BreakGlassPolicy[]> { return this.storage.listPolicies(); }
  async listReasons(): Promise<BreakGlassReason[]> { return this.storage.listReasons(); }

  destroy(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = null;
  }

  private async findMatchingPolicy(environment: Environment): Promise<BreakGlassPolicy | null> {
    const policies = await this.storage.listPolicies();
    return policies.find(p => p.enabled && p.environment === environment) ?? null;
  }

  private buildGrantedPermissions(_policy: BreakGlassPolicy): InfrastructurePermission[] {
    return ["infra:read", "infra:update", "infra:scale", "infra:restore", "infra:network"];
  }

  private startExpiryChecker(): void {
    this.expiryTimer = setInterval(async () => {
      const active = await this.storage.list({ status: "active" });
      const now = new Date();
      for (const session of active) {
        if (session.expiresAt && now > session.expiresAt) {
          await this.storage.update(session.id, { status: "expired" });
          this.logger.info("Break glass session expired", { sessionId: session.id });
        }
      }
    }, 60000);
  }
}

export function createBreakGlassManager(options: { config?: Partial<BreakGlassConfig>; storage?: BreakGlassStorage; logger: InfrastructureLogger; auditLogger?: InfrastructureAuditLogger }): InfrastructureBreakGlassManager {
  return new InfrastructureBreakGlassManager(options);
}
