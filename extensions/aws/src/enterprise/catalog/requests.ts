/**
 * Provisioning Request Service
 *
 * Manages infrastructure provisioning requests with approval workflows,
 * status tracking, and integration with the module catalog.
 */

import { randomUUID } from 'node:crypto';
import type {
  ProvisioningRequest,
  ApprovalRecord,
  ApprovalPolicy,
  ApprovalDecision,
  RequestStatus,
  CatalogModule,
  CatalogResult,
} from './types.js';
import { CatalogModuleService } from './modules.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface RequestStorage {
  // Requests
  saveRequest(request: ProvisioningRequest): Promise<void>;
  getRequest(id: string): Promise<ProvisioningRequest | null>;
  listRequests(options: {
    tenantId: string;
    requesterId?: string;
    moduleId?: string;
    status?: RequestStatus | RequestStatus[];
    environment?: string;
    costCenter?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<ProvisioningRequest[]>;
  deleteRequest(id: string): Promise<void>;

  // Policies
  savePolicy(policy: ApprovalPolicy): Promise<void>;
  getPolicy(id: string): Promise<ApprovalPolicy | null>;
  listPolicies(tenantId: string, options?: { active?: boolean }): Promise<ApprovalPolicy[]>;
  deletePolicy(id: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryRequestStorage implements RequestStorage {
  private requests = new Map<string, ProvisioningRequest>();
  private policies = new Map<string, ApprovalPolicy>();

  async saveRequest(request: ProvisioningRequest): Promise<void> {
    this.requests.set(request.id, request);
  }

  async getRequest(id: string): Promise<ProvisioningRequest | null> {
    return this.requests.get(id) ?? null;
  }

  async listRequests(options: {
    tenantId: string;
    requesterId?: string;
    moduleId?: string;
    status?: RequestStatus | RequestStatus[];
    environment?: string;
    costCenter?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<ProvisioningRequest[]> {
    const statuses = options.status
      ? Array.isArray(options.status) ? options.status : [options.status]
      : undefined;

    let results = Array.from(this.requests.values())
      .filter(r => r.tenantId === options.tenantId)
      .filter(r => !options.requesterId || r.requesterId === options.requesterId)
      .filter(r => !options.moduleId || r.moduleId === options.moduleId)
      .filter(r => !statuses || statuses.includes(r.status))
      .filter(r => !options.environment || r.environment === options.environment)
      .filter(r => !options.costCenter || r.costCenter === options.costCenter)
      .filter(r => !options.from || r.createdAt >= options.from)
      .filter(r => !options.to || r.createdAt <= options.to)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async deleteRequest(id: string): Promise<void> {
    this.requests.delete(id);
  }

  async savePolicy(policy: ApprovalPolicy): Promise<void> {
    this.policies.set(policy.id, policy);
  }

  async getPolicy(id: string): Promise<ApprovalPolicy | null> {
    return this.policies.get(id) ?? null;
  }

  async listPolicies(tenantId: string, options?: { active?: boolean }): Promise<ApprovalPolicy[]> {
    return Array.from(this.policies.values())
      .filter(p => p.tenantId === tenantId)
      .filter(p => options?.active === undefined || p.active === options.active)
      .sort((a, b) => b.priority - a.priority);
  }

  async deletePolicy(id: string): Promise<void> {
    this.policies.delete(id);
  }
}

// =============================================================================
// Request Service
// =============================================================================

export interface RequestServiceConfig {
  storage?: RequestStorage;
  moduleService?: CatalogModuleService;
  notifyApprovers?: (request: ProvisioningRequest, approvers: string[]) => Promise<void>;
  notifyRequester?: (request: ProvisioningRequest, message: string) => Promise<void>;
}

export class ProvisioningRequestService {
  private storage: RequestStorage;
  private moduleService?: CatalogModuleService;
  private notifyApprovers?: (request: ProvisioningRequest, approvers: string[]) => Promise<void>;
  private notifyRequester?: (request: ProvisioningRequest, message: string) => Promise<void>;

  constructor(config?: RequestServiceConfig) {
    this.storage = config?.storage ?? new InMemoryRequestStorage();
    this.moduleService = config?.moduleService;
    this.notifyApprovers = config?.notifyApprovers;
    this.notifyRequester = config?.notifyRequester;
  }

  // ===========================================================================
  // Request Management
  // ===========================================================================

  async createRequest(
    options: {
      tenantId: string;
      requesterId: string;
      requesterEmail: string;
      moduleId: string;
      name: string;
      description?: string;
      environment: string;
      region?: string;
      parameters: Record<string, unknown>;
      costCenter: string;
      projectCode?: string;
      priority?: ProvisioningRequest['priority'];
      requestedBy?: string;
      tags?: Record<string, string>;
    },
  ): Promise<CatalogResult<ProvisioningRequest>> {
    // Get module details
    let module: CatalogModule | undefined;
    if (this.moduleService) {
      const moduleResult = await this.moduleService.getModule(options.moduleId);
      if (!moduleResult.success || !moduleResult.data) {
        return { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' };
      }
      module = moduleResult.data;

      // Validate parameters
      const validation = this.moduleService.validateParameters(module, options.parameters);
      if (!validation.valid) {
        const errorMsg = validation.errors.map(e => `${e.parameter}: ${e.error}`).join('; ');
        return { success: false, error: `Parameter validation failed: ${errorMsg}`, code: 'VALIDATION_FAILED' };
      }

      // Check restrictions
      if (module.restrictions?.allowedEnvironments?.length) {
        if (!module.restrictions.allowedEnvironments.includes(options.environment)) {
          return {
            success: false,
            error: `Environment '${options.environment}' not allowed for this module`,
            code: 'ENVIRONMENT_NOT_ALLOWED',
          };
        }
      }
    }

    // Determine required approvals
    const policies = await this.storage.listPolicies(options.tenantId, { active: true });
    const applicablePolicy = this.findApplicablePolicy(policies, {
      moduleId: options.moduleId,
      category: module?.category,
      environment: options.environment,
      compliance: module?.compliance,
    });

    const requiredApprovals = applicablePolicy?.approvers.minApprovals ??
      module?.requiredApprovals?.minApprovers ?? 1;

    // Check for auto-approval
    const autoApprove = this.checkAutoApproval(applicablePolicy, {
      environment: options.environment,
      estimatedCost: module?.estimatedCost?.maxCents,
    });

    const now = new Date().toISOString();

    const request: ProvisioningRequest = {
      id: randomUUID(),
      tenantId: options.tenantId,
      requesterId: options.requesterId,
      requesterEmail: options.requesterEmail,
      moduleId: options.moduleId,
      moduleName: module?.name ?? 'Unknown',
      moduleVersion: module?.version ?? 'Unknown',
      name: options.name,
      description: options.description,
      environment: options.environment,
      region: options.region,
      parameters: options.parameters,
      costCenter: options.costCenter,
      projectCode: options.projectCode,
      status: autoApprove ? 'approved' : 'pending_approval',
      priority: options.priority ?? 'normal',
      requestedBy: options.requestedBy,
      approvals: autoApprove
        ? [{
            approverId: 'system',
            approverEmail: 'system@auto-approval',
            approverRole: 'auto-approval',
            decision: 'approved',
            comments: 'Auto-approved per policy',
            decidedAt: now,
          }]
        : [],
      requiredApprovals,
      tags: options.tags,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveRequest(request);

    // Notify approvers if pending
    if (!autoApprove && applicablePolicy && this.notifyApprovers) {
      const approverIds = applicablePolicy.approvers.userIds ?? [];
      if (approverIds.length > 0) {
        await this.notifyApprovers(request, approverIds);
      }
    }

    return { success: true, data: request };
  }

  async getRequest(requestId: string): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }
    return { success: true, data: request };
  }

  async listRequests(
    tenantId: string,
    options?: {
      requesterId?: string;
      moduleId?: string;
      status?: RequestStatus | RequestStatus[];
      environment?: string;
      costCenter?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<CatalogResult<ProvisioningRequest[]>> {
    const requests = await this.storage.listRequests({ tenantId, ...options });
    return { success: true, data: requests };
  }

  async updateRequest(
    requestId: string,
    updates: Partial<Pick<ProvisioningRequest, 'name' | 'description' | 'parameters' | 
      'priority' | 'requestedBy' | 'tags'>>,
  ): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }

    if (request.status !== 'draft' && request.status !== 'pending_approval') {
      return { success: false, error: 'Cannot update request in current status', code: 'INVALID_STATUS' };
    }

    const updated: ProvisioningRequest = {
      ...request,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveRequest(updated);
    return { success: true, data: updated };
  }

  async cancelRequest(requestId: string): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }

    if (!['draft', 'pending_approval'].includes(request.status)) {
      return { success: false, error: 'Cannot cancel request in current status', code: 'INVALID_STATUS' };
    }

    request.status = 'decommissioned';
    request.updatedAt = new Date().toISOString();
    await this.storage.saveRequest(request);

    return { success: true, data: request };
  }

  // ===========================================================================
  // Approval Workflow
  // ===========================================================================

  async submitForApproval(requestId: string): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }

    if (request.status !== 'draft') {
      return { success: false, error: 'Request is not in draft status', code: 'INVALID_STATUS' };
    }

    request.status = 'pending_approval';
    request.updatedAt = new Date().toISOString();
    await this.storage.saveRequest(request);

    return { success: true, data: request };
  }

  async recordApproval(
    requestId: string,
    approval: {
      approverId: string;
      approverEmail: string;
      approverRole: string;
      decision: ApprovalDecision;
      comments?: string;
    },
  ): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }

    if (request.status !== 'pending_approval') {
      return { success: false, error: 'Request is not pending approval', code: 'INVALID_STATUS' };
    }

    // Check if already approved/rejected by this user
    if (request.approvals.some(a => a.approverId === approval.approverId)) {
      return { success: false, error: 'Already provided approval decision', code: 'ALREADY_DECIDED' };
    }

    const approvalRecord: ApprovalRecord = {
      ...approval,
      decidedAt: new Date().toISOString(),
    };

    request.approvals.push(approvalRecord);
    request.updatedAt = new Date().toISOString();

    // Check if rejected
    if (approval.decision === 'rejected') {
      request.status = 'rejected';
      if (this.notifyRequester) {
        await this.notifyRequester(request, `Your request was rejected: ${approval.comments ?? 'No reason provided'}`);
      }
    }
    // Check if enough approvals
    else if (approval.decision === 'approved') {
      const approvalCount = request.approvals.filter(a => a.decision === 'approved').length;
      if (approvalCount >= request.requiredApprovals) {
        request.status = 'approved';
        if (this.notifyRequester) {
          await this.notifyRequester(request, 'Your request has been approved and is ready for provisioning');
        }
      }
    }
    // Needs more info
    else if (approval.decision === 'needs_info') {
      if (this.notifyRequester) {
        await this.notifyRequester(request, `More information requested: ${approval.comments ?? ''}`);
      }
    }

    await this.storage.saveRequest(request);
    return { success: true, data: request };
  }

  async getPendingApprovals(
    tenantId: string,
    approverId: string,
    approverRoles: string[],
  ): Promise<CatalogResult<ProvisioningRequest[]>> {
    const allPending = await this.storage.listRequests({
      tenantId,
      status: 'pending_approval',
    });

    // Filter to requests this approver can approve
    const policies = await this.storage.listPolicies(tenantId, { active: true });
    
    const canApprove = allPending.filter(request => {
      // Already approved by this user?
      if (request.approvals.some(a => a.approverId === approverId)) {
        return false;
      }

      // Check if any policy allows this approver
      for (const policy of policies) {
        if (policy.approvers.userIds?.includes(approverId)) {
          return true;
        }
        if (policy.approvers.roles.some(r => approverRoles.includes(r))) {
          return true;
        }
      }

      return false;
    });

    return { success: true, data: canApprove };
  }

  // ===========================================================================
  // Provisioning Status
  // ===========================================================================

  async startProvisioning(
    requestId: string,
    deploymentId: string,
  ): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }

    if (request.status !== 'approved') {
      return { success: false, error: 'Request is not approved', code: 'INVALID_STATUS' };
    }

    request.status = 'provisioning';
    request.provisioning = {
      startedAt: new Date().toISOString(),
      deploymentId,
    };
    request.updatedAt = new Date().toISOString();

    await this.storage.saveRequest(request);
    return { success: true, data: request };
  }

  async completeProvisioning(
    requestId: string,
    outputs: Record<string, unknown>,
  ): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }

    if (request.status !== 'provisioning') {
      return { success: false, error: 'Request is not provisioning', code: 'INVALID_STATUS' };
    }

    request.status = 'provisioned';
    request.provisioning = {
      ...request.provisioning,
      completedAt: new Date().toISOString(),
      outputs,
    };
    request.updatedAt = new Date().toISOString();

    await this.storage.saveRequest(request);

    if (this.notifyRequester) {
      await this.notifyRequester(request, 'Your infrastructure has been successfully provisioned');
    }

    return { success: true, data: request };
  }

  async failProvisioning(
    requestId: string,
    errorMessage: string,
  ): Promise<CatalogResult<ProvisioningRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
    }

    if (request.status !== 'provisioning') {
      return { success: false, error: 'Request is not provisioning', code: 'INVALID_STATUS' };
    }

    request.status = 'failed';
    request.provisioning = {
      ...request.provisioning,
      completedAt: new Date().toISOString(),
      errorMessage,
    };
    request.updatedAt = new Date().toISOString();

    await this.storage.saveRequest(request);

    if (this.notifyRequester) {
      await this.notifyRequester(request, `Provisioning failed: ${errorMessage}`);
    }

    return { success: true, data: request };
  }

  // ===========================================================================
  // Policy Management
  // ===========================================================================

  async createPolicy(
    options: {
      tenantId: string;
      name: string;
      description?: string;
      conditions: ApprovalPolicy['conditions'];
      approvers: ApprovalPolicy['approvers'];
      autoApproval?: ApprovalPolicy['autoApproval'];
      escalation?: ApprovalPolicy['escalation'];
      priority?: number;
    },
  ): Promise<CatalogResult<ApprovalPolicy>> {
    const now = new Date().toISOString();

    const policy: ApprovalPolicy = {
      id: randomUUID(),
      tenantId: options.tenantId,
      name: options.name,
      description: options.description,
      conditions: options.conditions,
      approvers: options.approvers,
      autoApproval: options.autoApproval,
      escalation: options.escalation,
      priority: options.priority ?? 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.savePolicy(policy);
    return { success: true, data: policy };
  }

  async getPolicy(policyId: string): Promise<CatalogResult<ApprovalPolicy>> {
    const policy = await this.storage.getPolicy(policyId);
    if (!policy) {
      return { success: false, error: 'Policy not found', code: 'POLICY_NOT_FOUND' };
    }
    return { success: true, data: policy };
  }

  async listPolicies(
    tenantId: string,
    options?: { active?: boolean },
  ): Promise<CatalogResult<ApprovalPolicy[]>> {
    const policies = await this.storage.listPolicies(tenantId, options);
    return { success: true, data: policies };
  }

  async updatePolicy(
    policyId: string,
    updates: Partial<Pick<ApprovalPolicy, 'name' | 'description' | 'conditions' | 
      'approvers' | 'autoApproval' | 'escalation' | 'priority' | 'active'>>,
  ): Promise<CatalogResult<ApprovalPolicy>> {
    const policy = await this.storage.getPolicy(policyId);
    if (!policy) {
      return { success: false, error: 'Policy not found', code: 'POLICY_NOT_FOUND' };
    }

    const updated: ApprovalPolicy = {
      ...policy,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.savePolicy(updated);
    return { success: true, data: updated };
  }

  async deletePolicy(policyId: string): Promise<CatalogResult<void>> {
    await this.storage.deletePolicy(policyId);
    return { success: true };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private findApplicablePolicy(
    policies: ApprovalPolicy[],
    context: {
      moduleId: string;
      category?: string;
      environment: string;
      compliance?: string[];
    },
  ): ApprovalPolicy | undefined {
    for (const policy of policies) {
      const c = policy.conditions;

      // Check module ID match
      if (c.moduleIds?.length && !c.moduleIds.includes(context.moduleId)) {
        continue;
      }

      // Check category match
      if (c.categories?.length && context.category && !c.categories.includes(context.category as any)) {
        continue;
      }

      // Check environment match
      if (c.environments?.length && !c.environments.includes(context.environment)) {
        continue;
      }

      // Check compliance match
      if (c.compliance?.length && context.compliance) {
        const hasMatch = c.compliance.some(comp => context.compliance!.includes(comp));
        if (!hasMatch) continue;
      }

      return policy;
    }

    return undefined;
  }

  private checkAutoApproval(
    policy: ApprovalPolicy | undefined,
    context: { environment: string; estimatedCost?: number },
  ): boolean {
    if (!policy?.autoApproval) {
      return false;
    }

    const aa = policy.autoApproval;

    // Check environment
    if (aa.environments?.length && !aa.environments.includes(context.environment)) {
      return false;
    }

    // Check cost threshold
    if (aa.maxCostCents !== undefined && context.estimatedCost !== undefined) {
      if (context.estimatedCost > aa.maxCostCents) {
        return false;
      }
    }

    return true;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createProvisioningRequestService(config?: RequestServiceConfig): ProvisioningRequestService {
  return new ProvisioningRequestService(config);
}
