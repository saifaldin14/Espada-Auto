/**
 * Chargeback/Showback Service
 *
 * Manages cost allocation, cost center configuration, and generates
 * showback/chargeback reports per team, project, or cost center.
 */

import { randomUUID } from 'node:crypto';
import type {
  CostAllocation,
  CostCenterConfig,
  ShowbackReport,
  CatalogResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface ChargebackStorage {
  // Cost Centers
  saveCostCenter(costCenter: CostCenterConfig): Promise<void>;
  getCostCenter(tenantId: string, code: string): Promise<CostCenterConfig | null>;
  listCostCenters(tenantId: string, options?: {
    active?: boolean;
    parentCode?: string;
  }): Promise<CostCenterConfig[]>;
  deleteCostCenter(tenantId: string, code: string): Promise<void>;

  // Allocations
  saveAllocation(allocation: CostAllocation): Promise<void>;
  getAllocation(id: string): Promise<CostAllocation | null>;
  listAllocations(tenantId: string, options?: {
    costCenter?: string;
    teamId?: string;
    billingPeriod?: string;
    status?: CostAllocation['status'];
  }): Promise<CostAllocation[]>;
  updateAllocation(id: string, updates: Partial<CostAllocation>): Promise<void>;

  // Reports
  saveReport(report: ShowbackReport): Promise<void>;
  getReport(id: string): Promise<ShowbackReport | null>;
  listReports(tenantId: string, options?: {
    type?: ShowbackReport['type'];
    limit?: number;
  }): Promise<ShowbackReport[]>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryChargebackStorage implements ChargebackStorage {
  private costCenters = new Map<string, CostCenterConfig>();
  private allocations = new Map<string, CostAllocation>();
  private reports = new Map<string, ShowbackReport>();

  private costCenterKey(tenantId: string, code: string): string {
    return `${tenantId}:${code}`;
  }

  async saveCostCenter(costCenter: CostCenterConfig): Promise<void> {
    this.costCenters.set(this.costCenterKey(costCenter.tenantId, costCenter.code), costCenter);
  }

  async getCostCenter(tenantId: string, code: string): Promise<CostCenterConfig | null> {
    return this.costCenters.get(this.costCenterKey(tenantId, code)) ?? null;
  }

  async listCostCenters(tenantId: string, options?: {
    active?: boolean;
    parentCode?: string;
  }): Promise<CostCenterConfig[]> {
    return Array.from(this.costCenters.values())
      .filter(c => c.tenantId === tenantId)
      .filter(c => options?.active === undefined || c.active === options.active)
      .filter(c => !options?.parentCode || c.parentCode === options.parentCode)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async deleteCostCenter(tenantId: string, code: string): Promise<void> {
    this.costCenters.delete(this.costCenterKey(tenantId, code));
  }

  async saveAllocation(allocation: CostAllocation): Promise<void> {
    this.allocations.set(allocation.id, allocation);
  }

  async getAllocation(id: string): Promise<CostAllocation | null> {
    return this.allocations.get(id) ?? null;
  }

  async listAllocations(tenantId: string, options?: {
    costCenter?: string;
    teamId?: string;
    billingPeriod?: string;
    status?: CostAllocation['status'];
  }): Promise<CostAllocation[]> {
    return Array.from(this.allocations.values())
      .filter(a => a.tenantId === tenantId)
      .filter(a => !options?.costCenter || a.costCenter === options.costCenter)
      .filter(a => !options?.teamId || a.teamId === options.teamId)
      .filter(a => !options?.billingPeriod || a.billingPeriod === options.billingPeriod)
      .filter(a => !options?.status || a.status === options.status)
      .sort((a, b) => b.billingPeriod.localeCompare(a.billingPeriod));
  }

  async updateAllocation(id: string, updates: Partial<CostAllocation>): Promise<void> {
    const allocation = this.allocations.get(id);
    if (allocation) {
      this.allocations.set(id, { ...allocation, ...updates });
    }
  }

  async saveReport(report: ShowbackReport): Promise<void> {
    this.reports.set(report.id, report);
  }

  async getReport(id: string): Promise<ShowbackReport | null> {
    return this.reports.get(id) ?? null;
  }

  async listReports(tenantId: string, options?: {
    type?: ShowbackReport['type'];
    limit?: number;
  }): Promise<ShowbackReport[]> {
    let results = Array.from(this.reports.values())
      .filter(r => r.tenantId === tenantId)
      .filter(r => !options?.type || r.type === options.type)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }
}

// =============================================================================
// Chargeback Service
// =============================================================================

export interface ChargebackServiceConfig {
  storage?: ChargebackStorage;
  defaultCurrency?: string;
}

export class ChargebackService {
  private storage: ChargebackStorage;
  private defaultCurrency: string;

  constructor(config?: ChargebackServiceConfig) {
    this.storage = config?.storage ?? new InMemoryChargebackStorage();
    this.defaultCurrency = config?.defaultCurrency ?? 'USD';
  }

  // ===========================================================================
  // Cost Center Management
  // ===========================================================================

  async createCostCenter(
    options: {
      tenantId: string;
      code: string;
      name: string;
      description?: string;
      parentCode?: string;
      ownerId: string;
      ownerEmail: string;
      monthlyBudgetCents?: number;
      budgetAlertThreshold?: number;
      billingContactEmail?: string;
      glAccountCode?: string;
    },
  ): Promise<CatalogResult<CostCenterConfig>> {
    // Check for existing
    const existing = await this.storage.getCostCenter(options.tenantId, options.code);
    if (existing) {
      return { success: false, error: 'Cost center already exists', code: 'COST_CENTER_EXISTS' };
    }

    // Validate parent if specified
    if (options.parentCode) {
      const parent = await this.storage.getCostCenter(options.tenantId, options.parentCode);
      if (!parent) {
        return { success: false, error: 'Parent cost center not found', code: 'PARENT_NOT_FOUND' };
      }
    }

    const now = new Date().toISOString();

    const costCenter: CostCenterConfig = {
      code: options.code,
      tenantId: options.tenantId,
      name: options.name,
      description: options.description,
      parentCode: options.parentCode,
      ownerId: options.ownerId,
      ownerEmail: options.ownerEmail,
      monthlyBudgetCents: options.monthlyBudgetCents,
      budgetAlertThreshold: options.budgetAlertThreshold ?? 80,
      billingContactEmail: options.billingContactEmail,
      glAccountCode: options.glAccountCode,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveCostCenter(costCenter);
    return { success: true, data: costCenter };
  }

  async getCostCenter(tenantId: string, code: string): Promise<CatalogResult<CostCenterConfig>> {
    const costCenter = await this.storage.getCostCenter(tenantId, code);
    if (!costCenter) {
      return { success: false, error: 'Cost center not found', code: 'COST_CENTER_NOT_FOUND' };
    }
    return { success: true, data: costCenter };
  }

  async listCostCenters(
    tenantId: string,
    options?: {
      active?: boolean;
      parentCode?: string;
    },
  ): Promise<CatalogResult<CostCenterConfig[]>> {
    const costCenters = await this.storage.listCostCenters(tenantId, options);
    return { success: true, data: costCenters };
  }

  async updateCostCenter(
    tenantId: string,
    code: string,
    updates: Partial<Pick<CostCenterConfig, 'name' | 'description' | 'ownerId' | 'ownerEmail' |
      'monthlyBudgetCents' | 'budgetAlertThreshold' | 'billingContactEmail' | 'glAccountCode' | 'active'>>,
  ): Promise<CatalogResult<CostCenterConfig>> {
    const costCenter = await this.storage.getCostCenter(tenantId, code);
    if (!costCenter) {
      return { success: false, error: 'Cost center not found', code: 'COST_CENTER_NOT_FOUND' };
    }

    const updated: CostCenterConfig = {
      ...costCenter,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveCostCenter(updated);
    return { success: true, data: updated };
  }

  async deleteCostCenter(tenantId: string, code: string): Promise<CatalogResult<void>> {
    // Check for child cost centers
    const children = await this.storage.listCostCenters(tenantId, { parentCode: code });
    if (children.length > 0) {
      return { success: false, error: 'Cannot delete cost center with children', code: 'HAS_CHILDREN' };
    }

    await this.storage.deleteCostCenter(tenantId, code);
    return { success: true };
  }

  async getCostCenterHierarchy(tenantId: string): Promise<CatalogResult<{
    code: string;
    name: string;
    children: any[];
  }[]>> {
    const all = await this.storage.listCostCenters(tenantId, { active: true });
    
    const buildTree = (parentCode?: string): any[] => {
      return all
        .filter(c => c.parentCode === parentCode)
        .map(c => ({
          code: c.code,
          name: c.name,
          children: buildTree(c.code),
        }));
    };

    return { success: true, data: buildTree(undefined) };
  }

  // ===========================================================================
  // Cost Allocation
  // ===========================================================================

  async createAllocation(
    options: {
      tenantId: string;
      costCenter: string;
      projectCode?: string;
      teamId?: string;
      billingPeriod: string;
      resourceCosts: CostAllocation['resourceCosts'];
      adjustments?: CostAllocation['adjustments'];
      notes?: string;
    },
  ): Promise<CatalogResult<CostAllocation>> {
    // Validate cost center
    const cc = await this.storage.getCostCenter(options.tenantId, options.costCenter);
    if (!cc) {
      return { success: false, error: 'Cost center not found', code: 'COST_CENTER_NOT_FOUND' };
    }

    const totalCostCents = options.resourceCosts.reduce((sum, r) => sum + r.costCents, 0);
    const adjustmentTotal = options.adjustments?.reduce((sum, a) => sum + a.amountCents, 0) ?? 0;
    const finalAmountCents = totalCostCents + adjustmentTotal;

    const now = new Date().toISOString();

    const allocation: CostAllocation = {
      id: randomUUID(),
      tenantId: options.tenantId,
      costCenter: options.costCenter,
      projectCode: options.projectCode,
      teamId: options.teamId,
      billingPeriod: options.billingPeriod,
      resourceCosts: options.resourceCosts,
      totalCostCents,
      currency: this.defaultCurrency,
      adjustments: options.adjustments,
      finalAmountCents,
      status: 'draft',
      notes: options.notes,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveAllocation(allocation);
    return { success: true, data: allocation };
  }

  async getAllocation(allocationId: string): Promise<CatalogResult<CostAllocation>> {
    const allocation = await this.storage.getAllocation(allocationId);
    if (!allocation) {
      return { success: false, error: 'Allocation not found', code: 'ALLOCATION_NOT_FOUND' };
    }
    return { success: true, data: allocation };
  }

  async listAllocations(
    tenantId: string,
    options?: {
      costCenter?: string;
      teamId?: string;
      billingPeriod?: string;
      status?: CostAllocation['status'];
    },
  ): Promise<CatalogResult<CostAllocation[]>> {
    const allocations = await this.storage.listAllocations(tenantId, options);
    return { success: true, data: allocations };
  }

  async addResourceCost(
    allocationId: string,
    resourceCost: CostAllocation['resourceCosts'][0],
  ): Promise<CatalogResult<CostAllocation>> {
    const allocation = await this.storage.getAllocation(allocationId);
    if (!allocation) {
      return { success: false, error: 'Allocation not found', code: 'ALLOCATION_NOT_FOUND' };
    }

    if (allocation.status !== 'draft') {
      return { success: false, error: 'Cannot modify non-draft allocation', code: 'INVALID_STATUS' };
    }

    allocation.resourceCosts.push(resourceCost);
    allocation.totalCostCents = allocation.resourceCosts.reduce((sum, r) => sum + r.costCents, 0);
    allocation.finalAmountCents = allocation.totalCostCents +
      (allocation.adjustments?.reduce((sum, a) => sum + a.amountCents, 0) ?? 0);
    allocation.updatedAt = new Date().toISOString();

    await this.storage.saveAllocation(allocation);
    return { success: true, data: allocation };
  }

  async addAdjustment(
    allocationId: string,
    adjustment: NonNullable<CostAllocation['adjustments']>[0],
  ): Promise<CatalogResult<CostAllocation>> {
    const allocation = await this.storage.getAllocation(allocationId);
    if (!allocation) {
      return { success: false, error: 'Allocation not found', code: 'ALLOCATION_NOT_FOUND' };
    }

    if (allocation.status !== 'draft' && allocation.status !== 'pending_review') {
      return { success: false, error: 'Cannot add adjustment in current status', code: 'INVALID_STATUS' };
    }

    allocation.adjustments = allocation.adjustments ?? [];
    allocation.adjustments.push(adjustment);
    allocation.finalAmountCents = allocation.totalCostCents +
      allocation.adjustments.reduce((sum, a) => sum + a.amountCents, 0);
    allocation.updatedAt = new Date().toISOString();

    await this.storage.saveAllocation(allocation);
    return { success: true, data: allocation };
  }

  async submitForReview(allocationId: string): Promise<CatalogResult<CostAllocation>> {
    const allocation = await this.storage.getAllocation(allocationId);
    if (!allocation) {
      return { success: false, error: 'Allocation not found', code: 'ALLOCATION_NOT_FOUND' };
    }

    if (allocation.status !== 'draft') {
      return { success: false, error: 'Allocation not in draft status', code: 'INVALID_STATUS' };
    }

    allocation.status = 'pending_review';
    allocation.updatedAt = new Date().toISOString();
    await this.storage.saveAllocation(allocation);

    return { success: true, data: allocation };
  }

  async approveAllocation(
    allocationId: string,
    approverId: string,
  ): Promise<CatalogResult<CostAllocation>> {
    const allocation = await this.storage.getAllocation(allocationId);
    if (!allocation) {
      return { success: false, error: 'Allocation not found', code: 'ALLOCATION_NOT_FOUND' };
    }

    if (allocation.status !== 'pending_review') {
      return { success: false, error: 'Allocation not pending review', code: 'INVALID_STATUS' };
    }

    allocation.status = 'approved';
    allocation.approvedBy = approverId;
    allocation.approvedAt = new Date().toISOString();
    allocation.updatedAt = new Date().toISOString();
    await this.storage.saveAllocation(allocation);

    return { success: true, data: allocation };
  }

  async markInvoiced(allocationId: string): Promise<CatalogResult<CostAllocation>> {
    const allocation = await this.storage.getAllocation(allocationId);
    if (!allocation) {
      return { success: false, error: 'Allocation not found', code: 'ALLOCATION_NOT_FOUND' };
    }

    if (allocation.status !== 'approved') {
      return { success: false, error: 'Allocation not approved', code: 'INVALID_STATUS' };
    }

    allocation.status = 'invoiced';
    allocation.updatedAt = new Date().toISOString();
    await this.storage.saveAllocation(allocation);

    return { success: true, data: allocation };
  }

  // ===========================================================================
  // Reports
  // ===========================================================================

  async generateShowbackReport(
    tenantId: string,
    options: {
      name: string;
      periodStart: string;
      periodEnd: string;
      type: ShowbackReport['type'];
      previousPeriodStart?: string;
      previousPeriodEnd?: string;
    },
  ): Promise<CatalogResult<ShowbackReport>> {
    // Get allocations for the period
    const allocations = await this.storage.listAllocations(tenantId, {
      billingPeriod: options.periodStart.slice(0, 7), // YYYY-MM
    });

    // Calculate summary
    const totalCostCents = allocations.reduce((sum, a) => sum + a.finalAmountCents, 0);
    const costCenters = new Set(allocations.map(a => a.costCenter));
    const teams = new Set(allocations.filter(a => a.teamId).map(a => a.teamId));

    // Calculate breakdown
    let breakdown: ShowbackReport['breakdown'] = [];
    
    if (options.type === 'by_cost_center') {
      const byCostCenter = new Map<string, { cost: number; count: number }>();
      for (const a of allocations) {
        const existing = byCostCenter.get(a.costCenter) ?? { cost: 0, count: 0 };
        existing.cost += a.finalAmountCents;
        existing.count += a.resourceCosts.length;
        byCostCenter.set(a.costCenter, existing);
      }
      breakdown = Array.from(byCostCenter.entries()).map(([cc, data]) => ({
        dimension: 'cost_center',
        dimensionValue: cc,
        costCents: data.cost,
        percentOfTotal: totalCostCents > 0 ? (data.cost / totalCostCents) * 100 : 0,
        resourceCount: data.count,
      }));
    } else if (options.type === 'by_environment') {
      const byEnv = new Map<string, { cost: number; count: number }>();
      for (const a of allocations) {
        for (const r of a.resourceCosts) {
          const existing = byEnv.get(r.environment) ?? { cost: 0, count: 0 };
          existing.cost += r.costCents;
          existing.count += 1;
          byEnv.set(r.environment, existing);
        }
      }
      breakdown = Array.from(byEnv.entries()).map(([env, data]) => ({
        dimension: 'environment',
        dimensionValue: env,
        costCents: data.cost,
        percentOfTotal: totalCostCents > 0 ? (data.cost / totalCostCents) * 100 : 0,
        resourceCount: data.count,
      }));
    }

    // Top resources
    const allResources = allocations.flatMap(a => 
      a.resourceCosts.map(r => ({
        ...r,
        costCenter: a.costCenter,
      }))
    );
    const topResources = allResources
      .sort((a, b) => b.costCents - a.costCents)
      .slice(0, 10)
      .map(r => ({
        resourceId: r.resourceId,
        resourceName: r.resourceName,
        resourceType: r.resourceType,
        costCents: r.costCents,
        costCenter: r.costCenter,
      }));

    // Find top cost driver
    const topDriver = breakdown.length > 0
      ? breakdown.sort((a, b) => b.costCents - a.costCents)[0].dimensionValue
      : 'Unknown';

    // Calculate cost change (simplified)
    const costChange = {
      absoluteCents: 0,
      percentChange: 0,
      comparedTo: options.previousPeriodStart ?? 'N/A',
    };

    const report: ShowbackReport = {
      id: randomUUID(),
      tenantId,
      name: options.name,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
      generatedAt: new Date().toISOString(),
      type: options.type,
      summary: {
        totalCostCents,
        costCentersCount: costCenters.size,
        teamsCount: teams.size,
        resourcesCount: allResources.length,
        topCostDriver: topDriver,
        costChange,
      },
      breakdown: breakdown.sort((a, b) => b.costCents - a.costCents),
      topResources,
      recommendations: this.generateRecommendations(allResources),
    };

    await this.storage.saveReport(report);
    return { success: true, data: report };
  }

  async getReport(reportId: string): Promise<CatalogResult<ShowbackReport>> {
    const report = await this.storage.getReport(reportId);
    if (!report) {
      return { success: false, error: 'Report not found', code: 'REPORT_NOT_FOUND' };
    }
    return { success: true, data: report };
  }

  async listReports(
    tenantId: string,
    options?: {
      type?: ShowbackReport['type'];
      limit?: number;
    },
  ): Promise<CatalogResult<ShowbackReport[]>> {
    const reports = await this.storage.listReports(tenantId, options);
    return { success: true, data: reports };
  }

  // ===========================================================================
  // Budget Tracking
  // ===========================================================================

  async getBudgetStatus(
    tenantId: string,
    costCenterCode: string,
    billingPeriod: string,
  ): Promise<CatalogResult<{
    costCenter: string;
    budgetCents: number | null;
    spentCents: number;
    remainingCents: number | null;
    percentUsed: number | null;
    status: 'ok' | 'warning' | 'exceeded' | 'no_budget';
  }>> {
    const costCenter = await this.storage.getCostCenter(tenantId, costCenterCode);
    if (!costCenter) {
      return { success: false, error: 'Cost center not found', code: 'COST_CENTER_NOT_FOUND' };
    }

    const allocations = await this.storage.listAllocations(tenantId, {
      costCenter: costCenterCode,
      billingPeriod,
    });

    const spentCents = allocations.reduce((sum, a) => sum + a.finalAmountCents, 0);

    if (!costCenter.monthlyBudgetCents) {
      return {
        success: true,
        data: {
          costCenter: costCenterCode,
          budgetCents: null,
          spentCents,
          remainingCents: null,
          percentUsed: null,
          status: 'no_budget',
        },
      };
    }

    const remainingCents = costCenter.monthlyBudgetCents - spentCents;
    const percentUsed = (spentCents / costCenter.monthlyBudgetCents) * 100;

    let status: 'ok' | 'warning' | 'exceeded' = 'ok';
    if (percentUsed >= 100) {
      status = 'exceeded';
    } else if (percentUsed >= (costCenter.budgetAlertThreshold ?? 80)) {
      status = 'warning';
    }

    return {
      success: true,
      data: {
        costCenter: costCenterCode,
        budgetCents: costCenter.monthlyBudgetCents,
        spentCents,
        remainingCents,
        percentUsed: Math.round(percentUsed * 10) / 10,
        status,
      },
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private generateRecommendations(
    resources: Array<{ resourceType: string; resourceId: string; costCents: number }>,
  ): ShowbackReport['recommendations'] {
    const recommendations: ShowbackReport['recommendations'] = [];

    // Simple heuristic: flag high-cost resources
    const highCostResources = resources.filter(r => r.costCents > 10000_00); // > $100
    if (highCostResources.length > 0) {
      recommendations.push({
        type: 'rightsizing',
        description: 'Review high-cost resources for potential rightsizing opportunities',
        potentialSavingsCents: Math.round(highCostResources.reduce((sum, r) => sum + r.costCents, 0) * 0.2),
        resourceIds: highCostResources.map(r => r.resourceId),
      });
    }

    return recommendations;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createChargebackService(config?: ChargebackServiceConfig): ChargebackService {
  return new ChargebackService(config);
}
