/**
 * Tenant Manager
 * 
 * High-level tenant management with business logic, quota enforcement,
 * and integration with billing and authentication systems.
 */

import { randomUUID } from 'node:crypto';
import { TenantStore, createTenantStore, type TenantStoreConfig } from './store.js';
import type {
  Tenant,
  TenantStatus,
  TenantTier,
  TenantMember,
  TenantInvitation,
  TenantTeam,
  TenantProject,
  TenantQuotas,
  TenantFeatures,
  MemberRole,
  UsageSummary,
  TenantAuditLog,
  TenantEvent,
  TenantEventType,
} from './types.js';
import { TIER_QUOTAS, TIER_FEATURES } from './types.js';

// =============================================================================
// Manager Configuration
// =============================================================================

export interface TenantManagerConfig extends TenantStoreConfig {
  /** Event handler for tenant events */
  onEvent?: (event: TenantEvent) => Promise<void>;
  /** Enable strict quota enforcement */
  strictQuotaEnforcement?: boolean;
  /** Default trial duration in days */
  defaultTrialDays?: number;
}

export interface ManagerResult<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

// =============================================================================
// Tenant Context
// =============================================================================

/**
 * Context object for tenant-scoped operations.
 * Passed to all operations to ensure tenant isolation.
 */
export interface TenantContext {
  /** Tenant ID */
  tenantId: string;
  /** User ID performing the operation */
  userId: string;
  /** User email */
  userEmail: string;
  /** User's role in tenant */
  role: MemberRole;
  /** User's permissions */
  permissions: string[];
  /** Request metadata */
  request?: {
    method: string;
    path: string;
    ip: string;
    userAgent: string;
  };
}

// =============================================================================
// Tenant Manager Implementation
// =============================================================================

export class TenantManager {
  private store: TenantStore;
  private config: Required<TenantManagerConfig>;
  private initialized = false;

  constructor(config: TenantManagerConfig = {}) {
    this.config = {
      region: config.region ?? 'us-east-1',
      tablePrefix: config.tablePrefix ?? 'idio-enterprise',
      credentials: config.credentials as any,
      autoCreateTables: config.autoCreateTables ?? true,
      onEvent: config.onEvent ?? (async () => {}),
      strictQuotaEnforcement: config.strictQuotaEnforcement ?? true,
      defaultTrialDays: config.defaultTrialDays ?? 14,
    };

    this.store = createTenantStore({
      region: this.config.region,
      tablePrefix: this.config.tablePrefix,
      credentials: this.config.credentials,
      autoCreateTables: this.config.autoCreateTables,
    });
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async initialize(): Promise<ManagerResult> {
    if (this.initialized) {
      return { success: true, message: 'Already initialized' };
    }

    const result = await this.store.initialize();
    if (result.success) {
      this.initialized = true;
    }
    return result;
  }

  // ===========================================================================
  // Tenant Lifecycle
  // ===========================================================================

  /**
   * Create a new tenant with initial owner
   */
  async createTenant(input: {
    name: string;
    slug: string;
    email: string;
    tier?: TenantTier;
    organization?: string;
    primaryRegion?: string;
    ownerUserId: string;
    ownerName: string;
  }): Promise<ManagerResult<{ tenant: Tenant; owner: TenantMember }>> {
    try {
      // Validate slug is unique
      const existingResult = await this.store.getTenantBySlug(input.slug);
      if (existingResult.success) {
        return { success: false, message: 'Tenant slug already exists' };
      }

      // Create tenant
      const tenantResult = await this.store.createTenant({
        name: input.name,
        slug: input.slug,
        email: input.email,
        tier: input.tier,
        organization: input.organization,
        primaryRegion: input.primaryRegion,
      });

      if (!tenantResult.success || !tenantResult.data) {
        return tenantResult as any;
      }

      const tenant = tenantResult.data;

      // Add owner as first member
      const memberResult = await this.store.addMember({
        tenantId: tenant.id,
        userId: input.ownerUserId,
        email: input.email,
        name: input.ownerName,
        role: 'owner',
      });

      if (!memberResult.success || !memberResult.data) {
        // Rollback tenant creation
        await this.store.deleteTenant(tenant.id, true);
        return {
          success: false,
          message: 'Failed to add owner',
          errors: memberResult.errors,
        };
      }

      // Emit event
      await this.emitEvent('tenant.created', tenant.id, input.ownerUserId, {
        tenantName: tenant.name,
        tier: tenant.tier,
      });

      return {
        success: true,
        data: {
          tenant,
          owner: memberResult.data,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create tenant',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Get tenant by ID
   */
  async getTenant(tenantId: string): Promise<ManagerResult<Tenant>> {
    return this.store.getTenant(tenantId);
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug: string): Promise<ManagerResult<Tenant>> {
    return this.store.getTenantBySlug(slug);
  }

  /**
   * Suspend a tenant
   */
  async suspendTenant(
    ctx: TenantContext,
    reason: string,
  ): Promise<ManagerResult<Tenant>> {
    this.requireRole(ctx, ['owner', 'admin']);

    const result = await this.store.updateTenantStatus(ctx.tenantId, 'suspended');
    
    if (result.success) {
      await this.emitEvent('tenant.suspended', ctx.tenantId, ctx.userId, { reason });
      await this.auditLog(ctx, 'tenant.suspend', 'tenant', ctx.tenantId, 'success');
    }

    return result;
  }

  /**
   * Reactivate a suspended tenant
   */
  async reactivateTenant(
    ctx: TenantContext,
  ): Promise<ManagerResult<Tenant>> {
    this.requireRole(ctx, ['owner', 'admin']);

    const result = await this.store.updateTenantStatus(ctx.tenantId, 'active');
    
    if (result.success) {
      await this.emitEvent('tenant.reactivated', ctx.tenantId, ctx.userId, {});
      await this.auditLog(ctx, 'tenant.reactivate', 'tenant', ctx.tenantId, 'success');
    }

    return result;
  }

  /**
   * Delete a tenant (soft delete by default)
   */
  async deleteTenant(
    ctx: TenantContext,
    hard = false,
  ): Promise<ManagerResult> {
    this.requireRole(ctx, ['owner']);

    const result = await this.store.deleteTenant(ctx.tenantId, hard);
    
    if (result.success) {
      await this.emitEvent('tenant.deleted', ctx.tenantId, ctx.userId, { hard });
      await this.auditLog(ctx, 'tenant.delete', 'tenant', ctx.tenantId, 'success');
    }

    return result;
  }

  // ===========================================================================
  // Subscription Management
  // ===========================================================================

  /**
   * Upgrade tenant to a new tier
   */
  async upgradeTier(
    ctx: TenantContext,
    newTier: TenantTier,
  ): Promise<ManagerResult<Tenant>> {
    this.requireRole(ctx, ['owner', 'billing']);

    const tenantResult = await this.store.getTenant(ctx.tenantId);
    if (!tenantResult.success || !tenantResult.data) {
      return { success: false, message: 'Tenant not found' };
    }

    const currentTier = tenantResult.data.tier;
    const tierOrder: TenantTier[] = ['free', 'starter', 'team', 'business', 'enterprise'];
    
    if (tierOrder.indexOf(newTier) <= tierOrder.indexOf(currentTier)) {
      return { success: false, message: 'Can only upgrade to a higher tier' };
    }

    const result = await this.store.upgradeTenant(ctx.tenantId, newTier);
    
    if (result.success) {
      await this.emitEvent('subscription.updated', ctx.tenantId, ctx.userId, {
        previousTier: currentTier,
        newTier,
      });
      await this.auditLog(ctx, 'subscription.upgrade', 'tenant', ctx.tenantId, 'success', {
        before: { tier: currentTier },
        after: { tier: newTier },
      });
    }

    return result;
  }

  /**
   * Start trial for a tenant
   */
  async startTrial(
    ctx: TenantContext,
    tier: TenantTier,
    durationDays?: number,
  ): Promise<ManagerResult<Tenant>> {
    this.requireRole(ctx, ['owner', 'billing']);

    const trialEndDate = new Date(
      Date.now() + (durationDays ?? this.config.defaultTrialDays) * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = await this.store.updateTenant(ctx.tenantId, {
      status: 'trial',
      tier,
      quotas: TIER_QUOTAS[tier],
      features: TIER_FEATURES[tier],
      billing: {
        billingEmail: '',
        hasPaymentMethod: false,
        currency: 'USD',
        trialEndDate,
      },
    });

    if (result.success) {
      await this.emitEvent('subscription.created', ctx.tenantId, ctx.userId, {
        tier,
        trial: true,
        trialEndDate,
      });
    }

    return result;
  }

  // ===========================================================================
  // Member Management
  // ===========================================================================

  /**
   * Invite a new member to the tenant
   */
  async inviteMember(
    ctx: TenantContext,
    input: {
      email: string;
      role: MemberRole;
      teams?: string[];
    },
  ): Promise<ManagerResult<TenantInvitation & { token: string }>> {
    this.requireRole(ctx, ['owner', 'admin']);

    // Check quota
    const quotaCheck = await this.checkQuota(ctx.tenantId, 'maxUsers');
    if (!quotaCheck.allowed) {
      return { success: false, message: quotaCheck.message };
    }

    // Check if user is already a member
    const existingMembers = await this.store.getMemberByEmail(input.email);
    if (existingMembers.success && existingMembers.data) {
      const alreadyMember = existingMembers.data.find(m => m.tenantId === ctx.tenantId);
      if (alreadyMember) {
        return { success: false, message: 'User is already a member' };
      }
    }

    const result = await this.store.createInvitation({
      tenantId: ctx.tenantId,
      email: input.email,
      role: input.role,
      invitedBy: ctx.userId,
      teams: input.teams,
    });

    if (result.success) {
      await this.emitEvent('member.invited', ctx.tenantId, ctx.userId, {
        email: input.email,
        role: input.role,
      });
      await this.auditLog(ctx, 'member.invite', 'invitation', result.data?.id, 'success');
    }

    return result;
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(
    tenantId: string,
    invitationId: string,
    token: string,
    userId: string,
    userName: string,
  ): Promise<ManagerResult<TenantMember>> {
    const result = await this.store.acceptInvitation(
      tenantId,
      invitationId,
      token,
      userId,
      userName,
    );

    if (result.success && result.data) {
      await this.emitEvent('member.joined', tenantId, userId, {
        email: result.data.email,
        role: result.data.role,
      });
    }

    return result;
  }

  /**
   * Remove a member from the tenant
   */
  async removeMember(
    ctx: TenantContext,
    userId: string,
  ): Promise<ManagerResult> {
    this.requireRole(ctx, ['owner', 'admin']);

    // Cannot remove yourself
    if (userId === ctx.userId) {
      return { success: false, message: 'Cannot remove yourself' };
    }

    // Cannot remove owner
    const memberResult = await this.store.getMember(ctx.tenantId, userId);
    if (memberResult.success && memberResult.data?.role === 'owner') {
      return { success: false, message: 'Cannot remove tenant owner' };
    }

    const result = await this.store.removeMember(ctx.tenantId, userId);

    if (result.success) {
      await this.emitEvent('member.removed', ctx.tenantId, ctx.userId, {
        removedUserId: userId,
      });
      await this.auditLog(ctx, 'member.remove', 'member', userId, 'success');
    }

    return result;
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    ctx: TenantContext,
    userId: string,
    newRole: MemberRole,
  ): Promise<ManagerResult<TenantMember>> {
    this.requireRole(ctx, ['owner', 'admin']);

    // Cannot change owner role
    const memberResult = await this.store.getMember(ctx.tenantId, userId);
    if (!memberResult.success || !memberResult.data) {
      return { success: false, message: 'Member not found' };
    }

    if (memberResult.data.role === 'owner') {
      return { success: false, message: 'Cannot change owner role' };
    }

    // Only owner can promote to admin
    if (newRole === 'admin' && ctx.role !== 'owner') {
      return { success: false, message: 'Only owner can promote to admin' };
    }

    const result = await this.store.updateMember(ctx.tenantId, userId, { role: newRole });

    if (result.success) {
      await this.emitEvent('member.role_changed', ctx.tenantId, ctx.userId, {
        userId,
        previousRole: memberResult.data.role,
        newRole,
      });
      await this.auditLog(ctx, 'member.role_change', 'member', userId, 'success', {
        before: { role: memberResult.data.role },
        after: { role: newRole },
      });
    }

    return result;
  }

  /**
   * List all members
   */
  async listMembers(ctx: TenantContext): Promise<ManagerResult<TenantMember[]>> {
    return this.store.listMembers(ctx.tenantId);
  }

  /**
   * Get tenants for a user
   */
  async getUserTenants(userId: string): Promise<ManagerResult<TenantMember[]>> {
    return this.store.getUserTenants(userId);
  }

  // ===========================================================================
  // Team Management
  // ===========================================================================

  /**
   * Create a new team
   */
  async createTeam(
    ctx: TenantContext,
    input: {
      name: string;
      description?: string;
      members?: string[];
      leads?: string[];
      allowedEnvironments?: string[];
      costCenter?: string;
    },
  ): Promise<ManagerResult<TenantTeam>> {
    this.requireRole(ctx, ['owner', 'admin']);

    const result = await this.store.createTeam({
      tenantId: ctx.tenantId,
      ...input,
    });

    if (result.success) {
      await this.emitEvent('team.created', ctx.tenantId, ctx.userId, {
        teamId: result.data?.id,
        teamName: input.name,
      });
      await this.auditLog(ctx, 'team.create', 'team', result.data?.id, 'success');
    }

    return result;
  }

  /**
   * List all teams
   */
  async listTeams(ctx: TenantContext): Promise<ManagerResult<TenantTeam[]>> {
    return this.store.listTeams(ctx.tenantId);
  }

  // ===========================================================================
  // Quota Management
  // ===========================================================================

  /**
   * Check if a quota allows an operation
   */
  async checkQuota(
    tenantId: string,
    quotaKey: keyof TenantQuotas,
    additionalUsage = 1,
  ): Promise<{ allowed: boolean; current: number; limit: number; message?: string }> {
    const tenantResult = await this.store.getTenant(tenantId);
    if (!tenantResult.success || !tenantResult.data) {
      return { allowed: false, current: 0, limit: 0, message: 'Tenant not found' };
    }

    const tenant = tenantResult.data;
    const limit = tenant.quotas[quotaKey] as number;

    // -1 means unlimited
    if (limit === -1) {
      return { allowed: true, current: 0, limit: -1 };
    }

    // Get current usage based on quota type
    let current = 0;
    switch (quotaKey) {
      case 'maxUsers': {
        const membersResult = await this.store.listMembers(tenantId);
        current = membersResult.data?.length ?? 0;
        break;
      }
      // Note: maxTeams quota check removed - not a valid TenantQuotas key
      // Add other quota checks here if needed based on actual TenantQuotas definition
      // Add other quota checks as needed
      default:
        current = 0;
    }

    const allowed = current + additionalUsage <= limit;

    return {
      allowed,
      current,
      limit,
      message: allowed ? undefined : `Quota exceeded: ${quotaKey} (${current}/${limit})`,
    };
  }

  /**
   * Check if a feature is enabled for a tenant
   */
  async checkFeature(
    tenantId: string,
    feature: keyof TenantFeatures,
  ): Promise<{ enabled: boolean; tier: TenantTier }> {
    const tenantResult = await this.store.getTenant(tenantId);
    if (!tenantResult.success || !tenantResult.data) {
      return { enabled: false, tier: 'free' };
    }

    return {
      enabled: tenantResult.data.features[feature] ?? false,
      tier: tenantResult.data.tier,
    };
  }

  // ===========================================================================
  // Usage & Billing
  // ===========================================================================

  /**
   * Record usage for billing
   */
  async recordUsage(
    ctx: TenantContext,
    type: string,
    quantity: number,
    unit: string,
    metadata?: Record<string, unknown>,
  ): Promise<ManagerResult> {
    return this.store.recordUsage({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      type,
      quantity,
      unit,
      metadata,
    });
  }

  /**
   * Get usage summary for billing period
   */
  async getUsageSummary(
    ctx: TenantContext,
    billingPeriod?: string,
  ): Promise<ManagerResult<UsageSummary>> {
    const period = billingPeriod ?? this.getCurrentBillingPeriod();
    return this.store.getUsageSummary(ctx.tenantId, period);
  }

  private getCurrentBillingPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // ===========================================================================
  // Audit & Compliance
  // ===========================================================================

  /**
   * Query audit logs
   */
  async queryAuditLogs(
    ctx: TenantContext,
    options: {
      startTime?: string;
      endTime?: string;
      userId?: string;
      action?: string;
      resourceType?: string;
      limit?: number;
    } = {},
  ): Promise<ManagerResult<TenantAuditLog[]>> {
    return this.store.queryAuditLogs(ctx.tenantId, options);
  }

  // ===========================================================================
  // Context Helpers
  // ===========================================================================

  /**
   * Create a tenant context from a session
   */
  async createContext(
    tenantId: string,
    userId: string,
    request?: TenantContext['request'],
  ): Promise<ManagerResult<TenantContext>> {
    const memberResult = await this.store.getMember(tenantId, userId);
    if (!memberResult.success || !memberResult.data) {
      return { success: false, message: 'User is not a member of this tenant' };
    }

    const member = memberResult.data;

    // Check tenant status
    const tenantResult = await this.store.getTenant(tenantId);
    if (!tenantResult.success || !tenantResult.data) {
      return { success: false, message: 'Tenant not found' };
    }

    if (tenantResult.data.status === 'suspended') {
      return { success: false, message: 'Tenant is suspended' };
    }

    if (tenantResult.data.status === 'deleted') {
      return { success: false, message: 'Tenant has been deleted' };
    }

    const ctx: TenantContext = {
      tenantId,
      userId,
      userEmail: member.email,
      role: member.role,
      permissions: member.permissions ?? this.getDefaultPermissions(member.role),
      request,
    };

    // Update last active
    await this.store.updateMember(tenantId, userId, {
      lastActiveAt: new Date().toISOString(),
    });

    return { success: true, data: ctx };
  }

  private getDefaultPermissions(role: MemberRole): string[] {
    const permissions: Record<MemberRole, string[]> = {
      owner: ['*'],
      admin: ['tenant:read', 'tenant:update', 'member:*', 'team:*', 'project:*', 'deployment:*'],
      member: ['tenant:read', 'team:read', 'project:*', 'deployment:*'],
      viewer: ['tenant:read', 'team:read', 'project:read', 'deployment:read'],
      billing: ['tenant:read', 'billing:*'],
    };
    return permissions[role] ?? [];
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private requireRole(ctx: TenantContext, allowedRoles: MemberRole[]): void {
    if (!allowedRoles.includes(ctx.role)) {
      throw new Error(`Insufficient permissions. Required: ${allowedRoles.join(' or ')}`);
    }
  }

  private async emitEvent(
    type: TenantEventType,
    tenantId: string,
    userId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const event: TenantEvent = {
      id: `evt_${randomUUID()}`,
      type,
      tenantId,
      userId,
      data,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    try {
      await this.config.onEvent(event);
    } catch (error) {
      console.error('Failed to emit event:', error);
    }
  }

  private async auditLog(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string | undefined,
    result: 'success' | 'failure' | 'denied',
    changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.store.logAuditEvent({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      action,
      resourceType,
      resourceId,
      request: ctx.request,
      changes,
      result,
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createTenantManager(config?: TenantManagerConfig): TenantManager {
  return new TenantManager(config);
}
