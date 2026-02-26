/**
 * Azure Enterprise Services
 *
 * Multi-tenancy, billing/metering, auth (SAML/OIDC/SCIM),
 * collaboration (workspaces, approvals, comments, notifications),
 * and GitOps infrastructure management.
 */

import { randomUUID } from "node:crypto";
import type {
  TenantConfiguration,
  TenantPolicy,
  TenantQuota,
  TenantSwitchResult,
  BillingAccount,
  UsageRecord,
  BudgetConfig,
  CostForecast,
  AuthConfiguration,
  SamlConfiguration,
  OidcConfiguration,
  ScimConfiguration,
  Workspace,
  WorkspaceMember,
  ApprovalFlow,
  ApprovalRequest,
  CollaborationComment,
  Notification,
  GitOpsConfiguration,
  GitOpsSync,
  GitOpsHistory,
} from "./enterprise-types.js";

// =============================================================================
// Tenant Manager
// =============================================================================

export class AzureTenantManager {
  private tenants: Map<string, TenantConfiguration> = new Map();
  private activeTenantId: string;

  constructor(defaultTenantId: string) {
    this.activeTenantId = defaultTenantId;
  }

  getActiveTenant(): string {
    return this.activeTenantId;
  }

  switchTenant(tenantId: string): TenantSwitchResult | null {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;
    const previous = this.activeTenantId;
    this.activeTenantId = tenantId;
    return {
      previousTenantId: previous,
      activeTenantId: tenantId,
      subscriptions: (tenant?.subscriptions ?? []).map((s) => ({ id: s, name: s, state: "Enabled" })),
      switchedAt: new Date().toISOString(),
    };
  }

  registerTenant(config: TenantConfiguration): void {
    this.tenants.set(config.tenantId, config);
  }

  getTenantConfig(tenantId: string): TenantConfiguration | null {
    return this.tenants.get(tenantId) ?? null;
  }

  listTenants(): TenantConfiguration[] {
    return [...this.tenants.values()];
  }

  setTenantPolicy(tenantId: string, policy: TenantPolicy): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    const idx = tenant.policies.findIndex((p) => p.id === policy.id);
    if (idx >= 0) tenant.policies[idx] = policy;
    else tenant.policies.push(policy);
    return true;
  }

  getTenantQuotas(tenantId: string): TenantQuota[] {
    return this.tenants.get(tenantId)?.quotas ?? [];
  }
}

// =============================================================================
// Billing Service
// =============================================================================

export class AzureBillingService {
  private budgets: Map<string, BudgetConfig> = new Map();

  async getBillingAccount(_subscriptionId: string): Promise<BillingAccount> {
    // Simulates Azure Billing Management API call
    return {
      id: "billing-account-1",
      name: "billing-account-1",
      displayName: "Enterprise Billing Account",
      accountType: "Enterprise",
      billingProfiles: [{
        id: "profile-1",
        name: "default",
        displayName: "Default Profile",
        currency: "USD",
        invoiceSections: [{ id: "section-1", name: "default", displayName: "Default Section" }],
        spendingLimit: null,
      }],
      agreementType: "EnterpriseAgreement",
    };
  }

  async getUsageRecords(_subscriptionId: string, _startDate: string, _endDate: string): Promise<UsageRecord[]> {
    // In production, this would call Azure Cost Management API
    return [];
  }

  setBudget(name: string, config: BudgetConfig): void {
    this.budgets.set(name, config);
  }

  getBudget(name: string): BudgetConfig | null {
    return this.budgets.get(name) ?? null;
  }

  listBudgets(): BudgetConfig[] {
    return [...this.budgets.values()];
  }

  deleteBudget(name: string): boolean {
    return this.budgets.delete(name);
  }

  async getCostForecast(subscriptionId: string): Promise<CostForecast> {
    // Simulates Azure Cost Management forecast
    return {
      subscriptionId,
      currentMonthSpend: 0,
      forecastedMonthEnd: 0,
      currency: "USD",
      confidence: 0.85,
      forecastedAt: new Date().toISOString(),
    };
  }
}

// =============================================================================
// Auth Manager
// =============================================================================

export class AzureAuthManager {
  private config: AuthConfiguration = {
    mfa: { enabled: false, methods: [] },
    conditionalAccess: [],
  };

  getAuthConfig(): AuthConfiguration {
    return this.config;
  }

  configureSaml(saml: SamlConfiguration): void {
    this.config.saml = saml;
  }

  configureOidc(oidc: OidcConfiguration): void {
    this.config.oidc = oidc;
  }

  configureScim(scim: ScimConfiguration): void {
    this.config.scim = scim;
  }

  enableMfa(methods: string[]): void {
    this.config.mfa = { enabled: true, methods };
  }

  disableMfa(): void {
    this.config.mfa = { enabled: false, methods: [] };
  }

  addConditionalAccessPolicy(policy: AuthConfiguration["conditionalAccess"][0]): void {
    this.config.conditionalAccess.push(policy);
  }

  removeConditionalAccessPolicy(policyId: string): boolean {
    const before = this.config.conditionalAccess.length;
    this.config.conditionalAccess = this.config.conditionalAccess.filter((p) => p.id !== policyId);
    return this.config.conditionalAccess.length < before;
  }
}

// =============================================================================
// Collaboration Manager
// =============================================================================

export class AzureCollaborationManager {
  private workspaces: Map<string, Workspace> = new Map();
  private flows: Map<string, ApprovalFlow> = new Map();
  private requests: Map<string, ApprovalRequest> = new Map();
  private comments: Map<string, CollaborationComment[]> = new Map();
  private notifications: Map<string, Notification[]> = new Map();

  // Workspaces ---
  createWorkspace(workspace: Omit<Workspace, "id" | "createdAt">): Workspace {
    const ws: Workspace = { ...workspace, id: randomUUID(), createdAt: new Date().toISOString() };
    this.workspaces.set(ws.id, ws);
    return ws;
  }

  getWorkspace(id: string): Workspace | null {
    return this.workspaces.get(id) ?? null;
  }

  listWorkspaces(): Workspace[] {
    return [...this.workspaces.values()];
  }

  addWorkspaceMember(workspaceId: string, member: WorkspaceMember): boolean {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return false;
    ws.members.push(member);
    return true;
  }

  removeWorkspaceMember(workspaceId: string, userId: string): boolean {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return false;
    const before = ws.members.length;
    ws.members = ws.members.filter((m) => m.userId !== userId);
    return ws.members.length < before;
  }

  // Approval Flows ---
  createApprovalFlow(flow: Omit<ApprovalFlow, "id">): ApprovalFlow {
    const af: ApprovalFlow = { ...flow, id: randomUUID() };
    this.flows.set(af.id, af);
    return af;
  }

  listApprovalFlows(): ApprovalFlow[] {
    return [...this.flows.values()];
  }

  submitApprovalRequest(flowId: string, requesterId: string, action: string, resourceId: string): ApprovalRequest | null {
    const flow = this.flows.get(flowId);
    if (!flow || !flow.enabled) return null;
    const request: ApprovalRequest = {
      id: randomUUID(),
      flowId,
      requesterId,
      action,
      resourceId,
      status: "pending",
      currentStage: 0,
      approvals: [],
      createdAt: new Date().toISOString(),
    };
    this.requests.set(request.id, request);

    // Notify approvers
    const firstStage = flow.stages[0];
    if (firstStage) {
      for (const approverId of firstStage.approvers) {
        this.addNotification(approverId, {
          type: "approval",
          title: "Approval Required",
          message: `${requesterId} requests approval for ${action} on ${resourceId}`,
          resourceId,
        });
      }
    }

    return request;
  }

  processApproval(requestId: string, approverId: string, decision: "approved" | "rejected", comment?: string): ApprovalRequest | null {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "pending") return null;

    request.approvals.push({ approverId, decision, comment, decidedAt: new Date().toISOString(), stage: request.currentStage });

    if (decision === "rejected") {
      request.status = "rejected";
    } else {
      const flow = this.flows.get(request.flowId);
      if (flow) {
        const currentStage = flow.stages[request.currentStage];
        if (currentStage) {
          // Count only approvals for the current stage to prevent earlier stage approvals from carrying over
          const approvalCount = request.approvals.filter((a) => a.decision === "approved" && a.stage === request.currentStage).length;
          if (approvalCount >= currentStage.requiredApprovals) {
            request.currentStage++;
            if (request.currentStage >= flow.stages.length) {
              request.status = "approved";
            }
          }
        }
      }
    }

    return request;
  }

  getApprovalRequest(requestId: string): ApprovalRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  listApprovalRequests(status?: string): ApprovalRequest[] {
    const all = [...this.requests.values()];
    if (status) return all.filter((r) => r.status === status);
    return all;
  }

  // Comments ---
  addComment(resourceId: string, authorId: string, content: string, parentId?: string): CollaborationComment {
    const comment: CollaborationComment = {
      id: randomUUID(),
      resourceId,
      authorId,
      content,
      parentId,
      createdAt: new Date().toISOString(),
    };
    const list = this.comments.get(resourceId) ?? [];
    list.push(comment);
    this.comments.set(resourceId, list);
    return comment;
  }

  getComments(resourceId: string): CollaborationComment[] {
    return this.comments.get(resourceId) ?? [];
  }

  // Notifications ---
  addNotification(recipientId: string, opts: Omit<Notification, "id" | "recipientId" | "read" | "createdAt">): Notification {
    const notification: Notification = {
      ...opts,
      id: randomUUID(),
      recipientId,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const list = this.notifications.get(recipientId) ?? [];
    list.push(notification);
    this.notifications.set(recipientId, list);
    return notification;
  }

  getNotifications(recipientId: string, unreadOnly?: boolean): Notification[] {
    const all = this.notifications.get(recipientId) ?? [];
    if (unreadOnly) return all.filter((n) => !n.read);
    return all;
  }

  markNotificationRead(recipientId: string, notificationId: string): boolean {
    const list = this.notifications.get(recipientId);
    if (!list) return false;
    const n = list.find((n) => n.id === notificationId);
    if (!n) return false;
    n.read = true;
    return true;
  }
}

// =============================================================================
// GitOps Manager
// =============================================================================

export class AzureGitOpsManager {
  private configs: Map<string, GitOpsConfiguration> = new Map();
  private syncs: Map<string, GitOpsSync[]> = new Map();

  configureRepository(name: string, config: GitOpsConfiguration): void {
    this.configs.set(name, config);
  }

  getConfiguration(name: string): GitOpsConfiguration | null {
    return this.configs.get(name) ?? null;
  }

  listConfigurations(): Array<{ name: string; config: GitOpsConfiguration }> {
    return [...this.configs.entries()].map(([name, config]) => ({ name, config }));
  }

  removeConfiguration(name: string): boolean {
    return this.configs.delete(name);
  }

  triggerSync(name: string, revision?: string): GitOpsSync | null {
    const config = this.configs.get(name);
    if (!config) return null;

    const sync: GitOpsSync = {
      id: randomUUID(),
      status: "progressing",
      revision: revision ?? "HEAD",
      message: `Sync triggered for ${name}`,
      resources: [],
      startedAt: new Date().toISOString(),
    };

    const history = this.syncs.get(name) ?? [];
    history.push(sync);
    this.syncs.set(name, history);

    // Simulate completion
    sync.status = "synced";
    sync.completedAt = new Date().toISOString();

    return sync;
  }

  getSyncStatus(name: string): GitOpsSync | null {
    const history = this.syncs.get(name);
    if (!history?.length) return null;
    return history[history.length - 1]!;
  }

  getSyncHistory(name: string): GitOpsHistory[] {
    const history = this.syncs.get(name) ?? [];
    return history.map((s) => ({
      revision: s.revision,
      author: "system",
      message: s.message,
      deployedAt: s.startedAt,
      resources: s.resources.length,
      status: s.status,
    }));
  }
}

// =============================================================================
// Factory
// =============================================================================

export interface EnterpriseServices {
  tenantManager: AzureTenantManager;
  billingService: AzureBillingService;
  authManager: AzureAuthManager;
  collaborationManager: AzureCollaborationManager;
  gitOpsManager: AzureGitOpsManager;
}

export function createEnterpriseServices(defaultTenantId: string): EnterpriseServices {
  return {
    tenantManager: new AzureTenantManager(defaultTenantId),
    billingService: new AzureBillingService(),
    authManager: new AzureAuthManager(),
    collaborationManager: new AzureCollaborationManager(),
    gitOpsManager: new AzureGitOpsManager(),
  };
}
