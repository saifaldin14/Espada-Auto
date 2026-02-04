/**
 * Deployment Metrics Service
 *
 * Tracks deployment metrics, DORA metrics (deployment frequency, lead time,
 * MTTR, change failure rate), and provides analytics dashboards.
 */

import { randomUUID } from 'node:crypto';
import type {
  DeploymentMetric,
  DeploymentFrequencyMetric,
  LeadTimeMetric,
  MeanTimeToRecoveryMetric,
  ChangeFailureRateMetric,
  DeploymentStatus,
  Dashboard,
  DashboardWidget,
  ObservabilityResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface MetricsStorage {
  // Deployment metrics
  saveDeploymentMetric(metric: DeploymentMetric): Promise<void>;
  getDeploymentMetric(id: string): Promise<DeploymentMetric | null>;
  listDeploymentMetrics(options: {
    tenantId: string;
    projectName?: string;
    environment?: string;
    status?: DeploymentStatus;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<DeploymentMetric[]>;
  updateDeploymentMetric(id: string, updates: Partial<DeploymentMetric>): Promise<void>;

  // Dashboards
  saveDashboard(dashboard: Dashboard): Promise<void>;
  getDashboard(id: string): Promise<Dashboard | null>;
  listDashboards(tenantId: string, options?: {
    ownerId?: string;
    visibility?: Dashboard['visibility'];
    tags?: string[];
  }): Promise<Dashboard[]>;
  deleteDashboard(id: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryMetricsStorage implements MetricsStorage {
  private deploymentMetrics = new Map<string, DeploymentMetric>();
  private dashboards = new Map<string, Dashboard>();

  async saveDeploymentMetric(metric: DeploymentMetric): Promise<void> {
    this.deploymentMetrics.set(metric.id, metric);
  }

  async getDeploymentMetric(id: string): Promise<DeploymentMetric | null> {
    return this.deploymentMetrics.get(id) ?? null;
  }

  async listDeploymentMetrics(options: {
    tenantId: string;
    projectName?: string;
    environment?: string;
    status?: DeploymentStatus;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<DeploymentMetric[]> {
    let results = Array.from(this.deploymentMetrics.values())
      .filter(m => m.tenantId === options.tenantId)
      .filter(m => !options.projectName || m.projectName === options.projectName)
      .filter(m => !options.environment || m.environment === options.environment)
      .filter(m => !options.status || m.status === options.status)
      .filter(m => !options.from || m.startedAt >= options.from)
      .filter(m => !options.to || m.startedAt <= options.to)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async updateDeploymentMetric(id: string, updates: Partial<DeploymentMetric>): Promise<void> {
    const existing = this.deploymentMetrics.get(id);
    if (existing) {
      this.deploymentMetrics.set(id, { ...existing, ...updates });
    }
  }

  async saveDashboard(dashboard: Dashboard): Promise<void> {
    this.dashboards.set(dashboard.id, dashboard);
  }

  async getDashboard(id: string): Promise<Dashboard | null> {
    return this.dashboards.get(id) ?? null;
  }

  async listDashboards(tenantId: string, options?: {
    ownerId?: string;
    visibility?: Dashboard['visibility'];
    tags?: string[];
  }): Promise<Dashboard[]> {
    return Array.from(this.dashboards.values())
      .filter(d => d.tenantId === tenantId)
      .filter(d => !options?.ownerId || d.ownerId === options.ownerId)
      .filter(d => !options?.visibility || d.visibility === options.visibility)
      .filter(d => !options?.tags?.length || options.tags.some(t => d.tags.includes(t)));
  }

  async deleteDashboard(id: string): Promise<void> {
    this.dashboards.delete(id);
  }
}

// =============================================================================
// Metrics Service
// =============================================================================

export interface DeploymentMetricsServiceConfig {
  storage?: MetricsStorage;
}

export class DeploymentMetricsService {
  private storage: MetricsStorage;

  constructor(config?: DeploymentMetricsServiceConfig) {
    this.storage = config?.storage ?? new InMemoryMetricsStorage();
  }

  // ===========================================================================
  // Deployment Tracking
  // ===========================================================================

  async recordDeploymentStart(
    tenantId: string,
    options: {
      deploymentId: string;
      projectName: string;
      environment: string;
      region?: string;
      triggeredBy: string;
      triggerType: DeploymentMetric['triggerType'];
      commitSha?: string;
      branch?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ObservabilityResult<DeploymentMetric>> {
    const metric: DeploymentMetric = {
      id: randomUUID(),
      tenantId,
      deploymentId: options.deploymentId,
      projectName: options.projectName,
      environment: options.environment,
      region: options.region,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      triggeredBy: options.triggeredBy,
      triggerType: options.triggerType,
      resourcesAffected: 0,
      resourcesChanged: 0,
      resourcesCreated: 0,
      resourcesDeleted: 0,
      commitSha: options.commitSha,
      branch: options.branch,
      metadata: options.metadata,
    };

    await this.storage.saveDeploymentMetric(metric);
    return { success: true, data: metric };
  }

  async recordDeploymentComplete(
    metricId: string,
    options: {
      status: DeploymentStatus;
      resourcesAffected?: number;
      resourcesChanged?: number;
      resourcesCreated?: number;
      resourcesDeleted?: number;
      errorMessage?: string;
    },
  ): Promise<ObservabilityResult<DeploymentMetric>> {
    const metric = await this.storage.getDeploymentMetric(metricId);
    if (!metric) {
      return { success: false, error: 'Metric not found', code: 'METRIC_NOT_FOUND' };
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(metric.startedAt).getTime();

    const updates: Partial<DeploymentMetric> = {
      status: options.status,
      completedAt,
      durationMs,
      resourcesAffected: options.resourcesAffected ?? metric.resourcesAffected,
      resourcesChanged: options.resourcesChanged ?? metric.resourcesChanged,
      resourcesCreated: options.resourcesCreated ?? metric.resourcesCreated,
      resourcesDeleted: options.resourcesDeleted ?? metric.resourcesDeleted,
      errorMessage: options.errorMessage,
    };

    await this.storage.updateDeploymentMetric(metricId, updates);
    return { success: true, data: { ...metric, ...updates } };
  }

  async getDeployment(metricId: string): Promise<ObservabilityResult<DeploymentMetric>> {
    const metric = await this.storage.getDeploymentMetric(metricId);
    if (!metric) {
      return { success: false, error: 'Metric not found', code: 'METRIC_NOT_FOUND' };
    }
    return { success: true, data: metric };
  }

  async listDeployments(
    tenantId: string,
    options?: {
      projectName?: string;
      environment?: string;
      status?: DeploymentStatus;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ObservabilityResult<DeploymentMetric[]>> {
    const metrics = await this.storage.listDeploymentMetrics({
      tenantId,
      ...options,
    });
    return { success: true, data: metrics };
  }

  // ===========================================================================
  // DORA Metrics
  // ===========================================================================

  async getDeploymentFrequency(
    tenantId: string,
    options: {
      from: string;
      to: string;
      granularity?: 'hour' | 'day' | 'week' | 'month';
      projectName?: string;
      environment?: string;
    },
  ): Promise<ObservabilityResult<DeploymentFrequencyMetric[]>> {
    const metrics = await this.storage.listDeploymentMetrics({
      tenantId,
      projectName: options.projectName,
      environment: options.environment,
      from: options.from,
      to: options.to,
    });

    const granularity = options.granularity ?? 'day';
    const buckets = new Map<string, DeploymentMetric[]>();

    // Group by time period
    for (const m of metrics) {
      const period = this.getPeriodKey(m.startedAt, granularity);
      const existing = buckets.get(period) ?? [];
      existing.push(m);
      buckets.set(period, existing);
    }

    // Calculate metrics per period
    const results: DeploymentFrequencyMetric[] = [];
    for (const [period, deployments] of buckets) {
      const successful = deployments.filter(d => d.status === 'succeeded').length;
      const failed = deployments.filter(d => d.status === 'failed').length;
      const durations = deployments
        .filter(d => d.durationMs != null)
        .map(d => d.durationMs!);

      results.push({
        period,
        granularity,
        totalDeployments: deployments.length,
        successfulDeployments: successful,
        failedDeployments: failed,
        successRate: deployments.length > 0 ? successful / deployments.length : 0,
        avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        p50DurationMs: this.percentile(durations, 50),
        p95DurationMs: this.percentile(durations, 95),
        p99DurationMs: this.percentile(durations, 99),
        byEnvironment: this.groupByEnvironment(deployments),
      });
    }

    return { success: true, data: results.sort((a, b) => a.period.localeCompare(b.period)) };
  }

  async getChangeFailureRate(
    tenantId: string,
    options: {
      from: string;
      to: string;
      projectName?: string;
    },
  ): Promise<ObservabilityResult<ChangeFailureRateMetric>> {
    const metrics = await this.storage.listDeploymentMetrics({
      tenantId,
      projectName: options.projectName,
      from: options.from,
      to: options.to,
    });

    const total = metrics.length;
    const failed = metrics.filter(m => m.status === 'failed' || m.status === 'rolled_back').length;

    const byType: Record<string, { total: number; failed: number; rate: number }> = {};
    for (const m of metrics) {
      if (!byType[m.triggerType]) {
        byType[m.triggerType] = { total: 0, failed: 0, rate: 0 };
      }
      byType[m.triggerType].total++;
      if (m.status === 'failed' || m.status === 'rolled_back') {
        byType[m.triggerType].failed++;
      }
    }

    for (const type of Object.keys(byType)) {
      byType[type].rate = byType[type].total > 0 ? byType[type].failed / byType[type].total : 0;
    }

    return {
      success: true,
      data: {
        period: `${options.from}/${options.to}`,
        totalChanges: total,
        failedChanges: failed,
        failureRate: total > 0 ? failed / total : 0,
        byType,
      },
    };
  }

  async recordLeadTime(
    deploymentMetricId: string,
    options: {
      commitToDeployMs: number;
      prMergeToDeployMs?: number;
      buildTimeMs?: number;
      testTimeMs?: number;
      approvalWaitMs?: number;
    },
  ): Promise<ObservabilityResult<LeadTimeMetric>> {
    const metric = await this.storage.getDeploymentMetric(deploymentMetricId);
    if (!metric) {
      return { success: false, error: 'Deployment metric not found', code: 'METRIC_NOT_FOUND' };
    }

    const leadTime: LeadTimeMetric = {
      deploymentId: metric.deploymentId,
      commitToDeployMs: options.commitToDeployMs,
      prMergeToDeployMs: options.prMergeToDeployMs,
      buildTimeMs: options.buildTimeMs,
      testTimeMs: options.testTimeMs,
      approvalWaitMs: options.approvalWaitMs,
      totalLeadTimeMs:
        options.commitToDeployMs +
        (options.buildTimeMs ?? 0) +
        (options.testTimeMs ?? 0) +
        (options.approvalWaitMs ?? 0),
    };

    // Store lead time in metadata
    await this.storage.updateDeploymentMetric(deploymentMetricId, {
      metadata: { ...metric.metadata, leadTime },
    });

    return { success: true, data: leadTime };
  }

  async recordMTTR(
    tenantId: string,
    options: {
      incidentId: string;
      failedDeploymentId: string;
      recoveryDeploymentId: string;
      timeToDetectMs: number;
      timeToRecoverMs: number;
      recoveryMethod: 'rollback' | 'fix_forward' | 'manual';
    },
  ): Promise<ObservabilityResult<MeanTimeToRecoveryMetric>> {
    const mttr: MeanTimeToRecoveryMetric = {
      incidentId: options.incidentId,
      failedDeploymentId: options.failedDeploymentId,
      recoveryDeploymentId: options.recoveryDeploymentId,
      timeToDetectMs: options.timeToDetectMs,
      timeToRecoverMs: options.timeToRecoverMs,
      totalMttrMs: options.timeToDetectMs + options.timeToRecoverMs,
      recoveryMethod: options.recoveryMethod,
    };

    return { success: true, data: mttr };
  }

  // ===========================================================================
  // Dashboards
  // ===========================================================================

  async createDashboard(
    tenantId: string,
    options: {
      name: string;
      description?: string;
      ownerId: string;
      visibility?: Dashboard['visibility'];
      tags?: string[];
      widgets?: DashboardWidget[];
      defaultTimeRange?: string;
      refreshInterval?: number;
    },
  ): Promise<ObservabilityResult<Dashboard>> {
    const now = new Date().toISOString();

    const dashboard: Dashboard = {
      id: randomUUID(),
      tenantId,
      name: options.name,
      description: options.description,
      ownerId: options.ownerId,
      visibility: options.visibility ?? 'private',
      tags: options.tags ?? [],
      widgets: options.widgets ?? [],
      defaultTimeRange: options.defaultTimeRange ?? '24h',
      refreshInterval: options.refreshInterval,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveDashboard(dashboard);
    return { success: true, data: dashboard };
  }

  async getDashboard(dashboardId: string): Promise<ObservabilityResult<Dashboard>> {
    const dashboard = await this.storage.getDashboard(dashboardId);
    if (!dashboard) {
      return { success: false, error: 'Dashboard not found', code: 'DASHBOARD_NOT_FOUND' };
    }
    return { success: true, data: dashboard };
  }

  async listDashboards(
    tenantId: string,
    options?: {
      ownerId?: string;
      visibility?: Dashboard['visibility'];
      tags?: string[];
    },
  ): Promise<ObservabilityResult<Dashboard[]>> {
    const dashboards = await this.storage.listDashboards(tenantId, options);
    return { success: true, data: dashboards };
  }

  async updateDashboard(
    dashboardId: string,
    updates: Partial<Omit<Dashboard, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ObservabilityResult<Dashboard>> {
    const existing = await this.storage.getDashboard(dashboardId);
    if (!existing) {
      return { success: false, error: 'Dashboard not found', code: 'DASHBOARD_NOT_FOUND' };
    }

    const updated: Dashboard = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveDashboard(updated);
    return { success: true, data: updated };
  }

  async addWidget(
    dashboardId: string,
    widget: Omit<DashboardWidget, 'id'>,
  ): Promise<ObservabilityResult<Dashboard>> {
    const existing = await this.storage.getDashboard(dashboardId);
    if (!existing) {
      return { success: false, error: 'Dashboard not found', code: 'DASHBOARD_NOT_FOUND' };
    }

    const newWidget: DashboardWidget = {
      ...widget,
      id: randomUUID(),
    };

    existing.widgets.push(newWidget);
    existing.updatedAt = new Date().toISOString();

    await this.storage.saveDashboard(existing);
    return { success: true, data: existing };
  }

  async removeWidget(dashboardId: string, widgetId: string): Promise<ObservabilityResult<Dashboard>> {
    const existing = await this.storage.getDashboard(dashboardId);
    if (!existing) {
      return { success: false, error: 'Dashboard not found', code: 'DASHBOARD_NOT_FOUND' };
    }

    existing.widgets = existing.widgets.filter(w => w.id !== widgetId);
    existing.updatedAt = new Date().toISOString();

    await this.storage.saveDashboard(existing);
    return { success: true, data: existing };
  }

  async deleteDashboard(dashboardId: string): Promise<ObservabilityResult<void>> {
    await this.storage.deleteDashboard(dashboardId);
    return { success: true };
  }

  // ===========================================================================
  // Preset Dashboards
  // ===========================================================================

  createDORADashboard(tenantId: string, ownerId: string): Dashboard {
    return {
      id: randomUUID(),
      tenantId,
      name: 'DORA Metrics Dashboard',
      description: 'Key DevOps Research and Assessment (DORA) metrics',
      ownerId,
      visibility: 'organization',
      tags: ['dora', 'metrics', 'devops'],
      widgets: [
        {
          id: randomUUID(),
          type: 'stat',
          title: 'Deployment Frequency',
          gridPosition: { x: 0, y: 0, width: 3, height: 2 },
          query: { metric: 'deployment_frequency', aggregation: 'count' },
        },
        {
          id: randomUUID(),
          type: 'stat',
          title: 'Lead Time for Changes',
          gridPosition: { x: 3, y: 0, width: 3, height: 2 },
          query: { metric: 'lead_time_ms', aggregation: 'avg' },
          options: { unit: 'ms' },
        },
        {
          id: randomUUID(),
          type: 'gauge',
          title: 'Change Failure Rate',
          gridPosition: { x: 6, y: 0, width: 3, height: 2 },
          query: { metric: 'change_failure_rate' },
          options: {
            unit: '%',
            thresholds: [
              { value: 15, color: 'green' },
              { value: 30, color: 'yellow' },
              { value: 100, color: 'red' },
            ],
          },
        },
        {
          id: randomUUID(),
          type: 'stat',
          title: 'Mean Time to Recovery',
          gridPosition: { x: 9, y: 0, width: 3, height: 2 },
          query: { metric: 'mttr_ms', aggregation: 'avg' },
          options: { unit: 'ms' },
        },
        {
          id: randomUUID(),
          type: 'line_chart',
          title: 'Deployment Frequency Trend',
          gridPosition: { x: 0, y: 2, width: 6, height: 4 },
          query: { metric: 'deployments', aggregation: 'count', groupBy: ['environment'] },
          options: { legend: true },
        },
        {
          id: randomUUID(),
          type: 'bar_chart',
          title: 'Deployments by Environment',
          gridPosition: { x: 6, y: 2, width: 6, height: 4 },
          query: { metric: 'deployments', aggregation: 'count', groupBy: ['environment'] },
          options: { stacked: true },
        },
        {
          id: randomUUID(),
          type: 'deployment_timeline',
          title: 'Recent Deployments',
          gridPosition: { x: 0, y: 6, width: 12, height: 4 },
          query: { metric: 'deployments' },
        },
      ],
      defaultTimeRange: '7d',
      refreshInterval: 300,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private getPeriodKey(timestamp: string, granularity: 'hour' | 'day' | 'week' | 'month'): string {
    const date = new Date(timestamp);
    switch (granularity) {
      case 'hour':
        return `${date.toISOString().slice(0, 13)}:00`;
      case 'day':
        return date.toISOString().slice(0, 10);
      case 'week': {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return weekStart.toISOString().slice(0, 10);
      }
      case 'month':
        return date.toISOString().slice(0, 7);
    }
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private groupByEnvironment(
    deployments: DeploymentMetric[],
  ): Record<string, { total: number; success: number; failed: number }> {
    const result: Record<string, { total: number; success: number; failed: number }> = {};
    for (const d of deployments) {
      if (!result[d.environment]) {
        result[d.environment] = { total: 0, success: 0, failed: 0 };
      }
      result[d.environment].total++;
      if (d.status === 'succeeded') {
        result[d.environment].success++;
      } else if (d.status === 'failed') {
        result[d.environment].failed++;
      }
    }
    return result;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createDeploymentMetricsService(config?: DeploymentMetricsServiceConfig): DeploymentMetricsService {
  return new DeploymentMetricsService(config);
}
