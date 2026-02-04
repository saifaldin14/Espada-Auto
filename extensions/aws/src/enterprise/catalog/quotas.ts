/**
 * Quota Management Service
 *
 * Manages resource quotas per tenant/team with usage tracking,
 * soft/hard limits, and alerting.
 */

import { randomUUID } from 'node:crypto';
import type {
  QuotaLimit,
  QuotaUsageRecord,
  QuotaAlert,
  QuotaResource,
  CatalogResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface QuotaStorage {
  // Quotas
  saveQuota(quota: QuotaLimit): Promise<void>;
  getQuota(id: string): Promise<QuotaLimit | null>;
  getQuotaByResource(tenantId: string, resource: QuotaResource, teamId?: string): Promise<QuotaLimit | null>;
  listQuotas(tenantId: string, options?: {
    teamId?: string;
    resource?: QuotaResource;
  }): Promise<QuotaLimit[]>;
  deleteQuota(id: string): Promise<void>;

  // Usage records
  saveUsageRecord(record: QuotaUsageRecord): Promise<void>;
  listUsageRecords(quotaId: string, options?: {
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<QuotaUsageRecord[]>;

  // Alerts
  saveAlert(alert: QuotaAlert): Promise<void>;
  listAlerts(tenantId: string, options?: {
    acknowledged?: boolean;
    quotaId?: string;
  }): Promise<QuotaAlert[]>;
  updateAlert(id: string, updates: Partial<QuotaAlert>): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryQuotaStorage implements QuotaStorage {
  private quotas = new Map<string, QuotaLimit>();
  private usageRecords = new Map<string, QuotaUsageRecord[]>();
  private alerts = new Map<string, QuotaAlert>();

  async saveQuota(quota: QuotaLimit): Promise<void> {
    this.quotas.set(quota.id, quota);
  }

  async getQuota(id: string): Promise<QuotaLimit | null> {
    return this.quotas.get(id) ?? null;
  }

  async getQuotaByResource(tenantId: string, resource: QuotaResource, teamId?: string): Promise<QuotaLimit | null> {
    return Array.from(this.quotas.values()).find(
      q => q.tenantId === tenantId && q.resource === resource && q.teamId === teamId
    ) ?? null;
  }

  async listQuotas(tenantId: string, options?: {
    teamId?: string;
    resource?: QuotaResource;
  }): Promise<QuotaLimit[]> {
    return Array.from(this.quotas.values())
      .filter(q => q.tenantId === tenantId)
      .filter(q => !options?.teamId || q.teamId === options.teamId)
      .filter(q => !options?.resource || q.resource === options.resource);
  }

  async deleteQuota(id: string): Promise<void> {
    this.quotas.delete(id);
  }

  async saveUsageRecord(record: QuotaUsageRecord): Promise<void> {
    const records = this.usageRecords.get(record.quotaId) ?? [];
    records.push(record);
    this.usageRecords.set(record.quotaId, records);
  }

  async listUsageRecords(quotaId: string, options?: {
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<QuotaUsageRecord[]> {
    let records = this.usageRecords.get(quotaId) ?? [];

    if (options?.from) {
      records = records.filter(r => r.timestamp >= options.from!);
    }
    if (options?.to) {
      records = records.filter(r => r.timestamp <= options.to!);
    }

    records = records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (options?.limit) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  async saveAlert(alert: QuotaAlert): Promise<void> {
    this.alerts.set(alert.id, alert);
  }

  async listAlerts(tenantId: string, options?: {
    acknowledged?: boolean;
    quotaId?: string;
  }): Promise<QuotaAlert[]> {
    return Array.from(this.alerts.values())
      .filter(a => a.tenantId === tenantId)
      .filter(a => options?.acknowledged === undefined || a.acknowledged === options.acknowledged)
      .filter(a => !options?.quotaId || a.quotaId === options.quotaId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateAlert(id: string, updates: Partial<QuotaAlert>): Promise<void> {
    const alert = this.alerts.get(id);
    if (alert) {
      this.alerts.set(id, { ...alert, ...updates });
    }
  }
}

// =============================================================================
// Quota Service
// =============================================================================

export interface QuotaServiceConfig {
  storage?: QuotaStorage;
  onAlertTriggered?: (alert: QuotaAlert) => Promise<void>;
}

export class QuotaService {
  private storage: QuotaStorage;
  private onAlertTriggered?: (alert: QuotaAlert) => Promise<void>;

  constructor(config?: QuotaServiceConfig) {
    this.storage = config?.storage ?? new InMemoryQuotaStorage();
    this.onAlertTriggered = config?.onAlertTriggered;
  }

  // ===========================================================================
  // Quota Management
  // ===========================================================================

  async createQuota(
    options: {
      tenantId: string;
      teamId?: string;
      resource: QuotaResource;
      customResourceName?: string;
      limit: number;
      unit: string;
      period?: QuotaLimit['period'];
      alertThreshold?: number;
      enforcement?: QuotaLimit['enforcement'];
      overrideAllowed?: boolean;
      notes?: string;
    },
  ): Promise<CatalogResult<QuotaLimit>> {
    // Check for existing quota
    const existing = await this.storage.getQuotaByResource(
      options.tenantId,
      options.resource,
      options.teamId,
    );
    if (existing) {
      return { success: false, error: 'Quota already exists for this resource', code: 'QUOTA_EXISTS' };
    }

    const now = new Date().toISOString();

    const quota: QuotaLimit = {
      id: randomUUID(),
      tenantId: options.tenantId,
      teamId: options.teamId,
      resource: options.resource,
      customResourceName: options.customResourceName,
      limit: options.limit,
      currentUsage: 0,
      unit: options.unit,
      period: options.period,
      alertThreshold: options.alertThreshold ?? 80,
      enforcement: options.enforcement ?? 'soft',
      overrideAllowed: options.overrideAllowed ?? true,
      notes: options.notes,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveQuota(quota);
    return { success: true, data: quota };
  }

  async getQuota(quotaId: string): Promise<CatalogResult<QuotaLimit>> {
    const quota = await this.storage.getQuota(quotaId);
    if (!quota) {
      return { success: false, error: 'Quota not found', code: 'QUOTA_NOT_FOUND' };
    }
    return { success: true, data: quota };
  }

  async getQuotaByResource(
    tenantId: string,
    resource: QuotaResource,
    teamId?: string,
  ): Promise<CatalogResult<QuotaLimit>> {
    const quota = await this.storage.getQuotaByResource(tenantId, resource, teamId);
    if (!quota) {
      return { success: false, error: 'Quota not found', code: 'QUOTA_NOT_FOUND' };
    }
    return { success: true, data: quota };
  }

  async listQuotas(
    tenantId: string,
    options?: {
      teamId?: string;
      resource?: QuotaResource;
    },
  ): Promise<CatalogResult<QuotaLimit[]>> {
    const quotas = await this.storage.listQuotas(tenantId, options);
    return { success: true, data: quotas };
  }

  async updateQuota(
    quotaId: string,
    updates: Partial<Pick<QuotaLimit, 'limit' | 'alertThreshold' | 'enforcement' | 
      'overrideAllowed' | 'notes'>>,
  ): Promise<CatalogResult<QuotaLimit>> {
    const quota = await this.storage.getQuota(quotaId);
    if (!quota) {
      return { success: false, error: 'Quota not found', code: 'QUOTA_NOT_FOUND' };
    }

    const updated: QuotaLimit = {
      ...quota,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveQuota(updated);
    return { success: true, data: updated };
  }

  async deleteQuota(quotaId: string): Promise<CatalogResult<void>> {
    await this.storage.deleteQuota(quotaId);
    return { success: true };
  }

  // ===========================================================================
  // Usage Tracking
  // ===========================================================================

  async checkQuota(
    tenantId: string,
    resource: QuotaResource,
    requestedAmount: number,
    teamId?: string,
  ): Promise<CatalogResult<{
    allowed: boolean;
    currentUsage: number;
    limit: number;
    remaining: number;
    wouldExceed: boolean;
    enforcement: QuotaLimit['enforcement'];
  }>> {
    const quota = await this.storage.getQuotaByResource(tenantId, resource, teamId);
    
    if (!quota) {
      // No quota means unlimited
      return {
        success: true,
        data: {
          allowed: true,
          currentUsage: 0,
          limit: Infinity,
          remaining: Infinity,
          wouldExceed: false,
          enforcement: 'soft',
        },
      };
    }

    const remaining = quota.limit - quota.currentUsage;
    const wouldExceed = requestedAmount > remaining;
    const allowed = quota.enforcement === 'soft' || !wouldExceed;

    return {
      success: true,
      data: {
        allowed,
        currentUsage: quota.currentUsage,
        limit: quota.limit,
        remaining,
        wouldExceed,
        enforcement: quota.enforcement,
      },
    };
  }

  async recordUsage(
    quotaId: string,
    change: number,
    options: {
      reason: string;
      relatedEntityId?: string;
      userId?: string;
    },
  ): Promise<CatalogResult<QuotaLimit>> {
    const quota = await this.storage.getQuota(quotaId);
    if (!quota) {
      return { success: false, error: 'Quota not found', code: 'QUOTA_NOT_FOUND' };
    }

    const previousValue = quota.currentUsage;
    const newValue = Math.max(0, previousValue + change);

    // Record usage change
    const record: QuotaUsageRecord = {
      id: randomUUID(),
      quotaId,
      change,
      previousValue,
      newValue,
      reason: options.reason,
      relatedEntityId: options.relatedEntityId,
      userId: options.userId,
      timestamp: new Date().toISOString(),
    };

    await this.storage.saveUsageRecord(record);

    // Update quota
    quota.currentUsage = newValue;
    quota.updatedAt = new Date().toISOString();
    await this.storage.saveQuota(quota);

    // Check for alerts
    await this.checkAndTriggerAlert(quota);

    return { success: true, data: quota };
  }

  async incrementUsage(
    tenantId: string,
    resource: QuotaResource,
    amount: number,
    options: {
      teamId?: string;
      reason: string;
      relatedEntityId?: string;
      userId?: string;
    },
  ): Promise<CatalogResult<QuotaLimit>> {
    let quota = await this.storage.getQuotaByResource(tenantId, resource, options.teamId);
    
    if (!quota) {
      return { success: false, error: 'Quota not found', code: 'QUOTA_NOT_FOUND' };
    }

    return this.recordUsage(quota.id, amount, {
      reason: options.reason,
      relatedEntityId: options.relatedEntityId,
      userId: options.userId,
    });
  }

  async decrementUsage(
    tenantId: string,
    resource: QuotaResource,
    amount: number,
    options: {
      teamId?: string;
      reason: string;
      relatedEntityId?: string;
      userId?: string;
    },
  ): Promise<CatalogResult<QuotaLimit>> {
    let quota = await this.storage.getQuotaByResource(tenantId, resource, options.teamId);
    
    if (!quota) {
      return { success: false, error: 'Quota not found', code: 'QUOTA_NOT_FOUND' };
    }

    return this.recordUsage(quota.id, -amount, {
      reason: options.reason,
      relatedEntityId: options.relatedEntityId,
      userId: options.userId,
    });
  }

  async resetUsage(quotaId: string, reason: string): Promise<CatalogResult<QuotaLimit>> {
    const quota = await this.storage.getQuota(quotaId);
    if (!quota) {
      return { success: false, error: 'Quota not found', code: 'QUOTA_NOT_FOUND' };
    }

    return this.recordUsage(quotaId, -quota.currentUsage, { reason });
  }

  async getUsageHistory(
    quotaId: string,
    options?: {
      from?: string;
      to?: string;
      limit?: number;
    },
  ): Promise<CatalogResult<QuotaUsageRecord[]>> {
    const records = await this.storage.listUsageRecords(quotaId, options);
    return { success: true, data: records };
  }

  // ===========================================================================
  // Alerts
  // ===========================================================================

  private async checkAndTriggerAlert(quota: QuotaLimit): Promise<void> {
    if (!quota.alertThreshold) return;

    const usagePercent = (quota.currentUsage / quota.limit) * 100;
    
    if (usagePercent >= quota.alertThreshold) {
      const alert: QuotaAlert = {
        id: randomUUID(),
        quotaId: quota.id,
        tenantId: quota.tenantId,
        teamId: quota.teamId,
        resource: quota.resource,
        thresholdPercent: quota.alertThreshold,
        currentUsage: quota.currentUsage,
        limit: quota.limit,
        acknowledged: false,
        createdAt: new Date().toISOString(),
      };

      await this.storage.saveAlert(alert);

      if (this.onAlertTriggered) {
        await this.onAlertTriggered(alert);
      }
    }
  }

  async listAlerts(
    tenantId: string,
    options?: {
      acknowledged?: boolean;
      quotaId?: string;
    },
  ): Promise<CatalogResult<QuotaAlert[]>> {
    const alerts = await this.storage.listAlerts(tenantId, options);
    return { success: true, data: alerts };
  }

  async acknowledgeAlert(alertId: string): Promise<CatalogResult<void>> {
    await this.storage.updateAlert(alertId, { acknowledged: true });
    return { success: true };
  }

  // ===========================================================================
  // Summary
  // ===========================================================================

  async getQuotaSummary(
    tenantId: string,
    teamId?: string,
  ): Promise<CatalogResult<{
    quotas: Array<{
      resource: QuotaResource;
      currentUsage: number;
      limit: number;
      usagePercent: number;
      status: 'ok' | 'warning' | 'critical';
    }>;
    alertCount: number;
  }>> {
    const quotas = await this.storage.listQuotas(tenantId, { teamId });
    const alerts = await this.storage.listAlerts(tenantId, { acknowledged: false });

    const summary = quotas.map(q => {
      const usagePercent = (q.currentUsage / q.limit) * 100;
      let status: 'ok' | 'warning' | 'critical' = 'ok';
      
      if (usagePercent >= 90) {
        status = 'critical';
      } else if (usagePercent >= (q.alertThreshold ?? 80)) {
        status = 'warning';
      }

      return {
        resource: q.resource,
        currentUsage: q.currentUsage,
        limit: q.limit,
        usagePercent: Math.round(usagePercent * 10) / 10,
        status,
      };
    });

    return {
      success: true,
      data: {
        quotas: summary,
        alertCount: alerts.length,
      },
    };
  }

  // ===========================================================================
  // Preset Quotas
  // ===========================================================================

  async createDefaultQuotas(tenantId: string): Promise<CatalogResult<QuotaLimit[]>> {
    const defaultQuotas: Array<{
      resource: QuotaResource;
      limit: number;
      unit: string;
      period?: QuotaLimit['period'];
    }> = [
      { resource: 'module_instances', limit: 100, unit: 'instances' },
      { resource: 'compute_vcpu', limit: 500, unit: 'vCPUs' },
      { resource: 'compute_memory_gb', limit: 2000, unit: 'GB' },
      { resource: 'storage_gb', limit: 10000, unit: 'GB' },
      { resource: 'database_instances', limit: 20, unit: 'instances' },
      { resource: 'deployments_per_month', limit: 500, unit: 'deployments', period: 'month' },
      { resource: 'monthly_spend_cents', limit: 100000_00, unit: 'cents', period: 'month' },
    ];

    const created: QuotaLimit[] = [];

    for (const q of defaultQuotas) {
      const result = await this.createQuota({
        tenantId,
        resource: q.resource,
        limit: q.limit,
        unit: q.unit,
        period: q.period,
        enforcement: 'soft',
      });

      if (result.success && result.data) {
        created.push(result.data);
      }
    }

    return { success: true, data: created };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createQuotaService(config?: QuotaServiceConfig): QuotaService {
  return new QuotaService(config);
}
