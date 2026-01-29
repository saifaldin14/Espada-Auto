/**
 * Infrastructure State Context Awareness
 */

import type {
  InfrastructureStateSnapshot,
  ResourceState,
  ResourceMetrics,
  ActiveOperation,
  OperationProgress,
  ConversationContext,
  ResolvedResource,
} from "./types.js";
import type { Environment } from "../security/types.js";

export type StateProviderConfig = {
  refreshInterval: number;
  cacheEnabled: boolean;
  cacheMaxAge: number;
  maxOperationHistory: number;
  metricsRetentionPeriod: number;
  enableRealTimeUpdates: boolean;
};

export const defaultStateConfig: StateProviderConfig = {
  refreshInterval: 30000, // 30 seconds
  cacheEnabled: true,
  cacheMaxAge: 60000, // 1 minute
  maxOperationHistory: 100,
  metricsRetentionPeriod: 3600000, // 1 hour
  enableRealTimeUpdates: true,
};

export type ResourceStateFilter = {
  types?: string[];
  environments?: Environment[];
  statuses?: string[];
  tags?: Record<string, string>;
  region?: string;
};

export type StateSubscriber = {
  id: string;
  filter?: ResourceStateFilter;
  callback: (state: ResourceState[]) => void;
};

export type MetricAggregation = "avg" | "min" | "max" | "sum" | "count";

export type MetricQuery = {
  resourceId: string;
  metricName: string;
  startTime: Date;
  endTime: Date;
  aggregation: MetricAggregation;
  intervalMs?: number;
};

export class InfrastructureStateProvider {
  private config: StateProviderConfig;
  private resourceStates: Map<string, ResourceState>;
  private metricsHistory: Map<string, ResourceMetrics[]>;
  private activeOperations: Map<string, ActiveOperation>;
  private completedOperations: ActiveOperation[];
  private subscribers: StateSubscriber[];
  private lastRefresh: Date;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(config?: Partial<StateProviderConfig>) {
    this.config = { ...defaultStateConfig, ...config };
    this.resourceStates = new Map();
    this.metricsHistory = new Map();
    this.activeOperations = new Map();
    this.completedOperations = [];
    this.subscribers = [];
    this.lastRefresh = new Date();

    if (this.config.enableRealTimeUpdates) {
      this.startAutoRefresh();
    }
  }

  getSnapshot(filter?: ResourceStateFilter): InfrastructureStateSnapshot {
    const resources = this.getResourceStates(filter);
    const activeOps = Array.from(this.activeOperations.values());

    return {
      timestamp: new Date(),
      resources,
      activeOperations: activeOps,
      recentChanges: this.getRecentChanges(),
      healthSummary: this.calculateHealthSummary(resources),
      alerts: this.getActiveAlerts(resources),
    };
  }

  getResourceStates(filter?: ResourceStateFilter): ResourceState[] {
    let states = Array.from(this.resourceStates.values());

    if (filter) {
      if (filter.types?.length) {
        states = states.filter(s => filter.types!.includes(s.resourceType));
      }
      if (filter.environments?.length) {
        states = states.filter(s => filter.environments!.includes(s.environment));
      }
      if (filter.statuses?.length) {
        states = states.filter(s => filter.statuses!.includes(s.status));
      }
      if (filter.tags) {
        states = states.filter(s => {
          if (!s.tags) return false;
          return Object.entries(filter.tags!).every(([k, v]) => s.tags![k] === v);
        });
      }
      if (filter.region) {
        states = states.filter(s => s.region === filter.region);
      }
    }

    return states;
  }

  getResourceState(resourceId: string): ResourceState | undefined {
    return this.resourceStates.get(resourceId);
  }

  updateResourceState(state: ResourceState): void {
    const existing = this.resourceStates.get(state.resourceId);
    const updatedState: ResourceState = {
      ...state,
      lastUpdated: new Date(),
      previousStatus: existing?.status,
    };

    this.resourceStates.set(state.resourceId, updatedState);
    this.notifySubscribers([updatedState]);

    // Track metrics history
    if (state.metrics) {
      this.recordMetrics(state.resourceId, state.metrics);
    }
  }

  bulkUpdateResourceStates(states: ResourceState[]): void {
    const updated: ResourceState[] = [];

    for (const state of states) {
      const existing = this.resourceStates.get(state.resourceId);
      const updatedState: ResourceState = {
        ...state,
        lastUpdated: new Date(),
        previousStatus: existing?.status,
      };

      this.resourceStates.set(state.resourceId, updatedState);
      updated.push(updatedState);

      if (state.metrics) {
        this.recordMetrics(state.resourceId, state.metrics);
      }
    }

    this.notifySubscribers(updated);
  }

  removeResource(resourceId: string): boolean {
    return this.resourceStates.delete(resourceId);
  }

  // Metrics management
  recordMetrics(resourceId: string, metrics: ResourceMetrics): void {
    const history = this.metricsHistory.get(resourceId) ?? [];
    history.push({ ...metrics, timestamp: new Date() });

    // Trim old metrics
    const cutoff = Date.now() - this.config.metricsRetentionPeriod;
    const trimmed = history.filter(m => m.timestamp && m.timestamp.getTime() > cutoff);

    this.metricsHistory.set(resourceId, trimmed);
  }

  getMetricsHistory(resourceId: string): ResourceMetrics[] {
    return this.metricsHistory.get(resourceId) ?? [];
  }

  queryMetrics(query: MetricQuery): { timestamp: Date; value: number }[] {
    const history = this.metricsHistory.get(query.resourceId) ?? [];
    const filtered = history.filter(m =>
      m.timestamp &&
      m.timestamp >= query.startTime &&
      m.timestamp <= query.endTime
    );

    if (filtered.length === 0) return [];

    // Extract metric values
    const values = filtered.map(m => ({
      timestamp: m.timestamp!,
      value: this.extractMetricValue(m, query.metricName),
    })).filter(v => v.value !== undefined) as { timestamp: Date; value: number }[];

    if (!query.intervalMs) {
      return values;
    }

    // Aggregate by interval
    return this.aggregateByInterval(values, query.intervalMs, query.aggregation);
  }

  private extractMetricValue(metrics: ResourceMetrics, metricName: string): number | undefined {
    const key = metricName as keyof ResourceMetrics;
    const value = metrics[key];
    return typeof value === "number" ? value : undefined;
  }

  private aggregateByInterval(
    values: { timestamp: Date; value: number }[],
    intervalMs: number,
    aggregation: MetricAggregation
  ): { timestamp: Date; value: number }[] {
    const buckets = new Map<number, number[]>();

    for (const v of values) {
      const bucket = Math.floor(v.timestamp.getTime() / intervalMs) * intervalMs;
      const existing = buckets.get(bucket) ?? [];
      existing.push(v.value);
      buckets.set(bucket, existing);
    }

    const result: { timestamp: Date; value: number }[] = [];
    for (const [bucket, vals] of buckets) {
      result.push({
        timestamp: new Date(bucket),
        value: this.aggregate(vals, aggregation),
      });
    }

    return result.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private aggregate(values: number[], aggregation: MetricAggregation): number {
    switch (aggregation) {
      case "sum":
        return values.reduce((a, b) => a + b, 0);
      case "avg":
        return values.reduce((a, b) => a + b, 0) / values.length;
      case "min":
        return Math.min(...values);
      case "max":
        return Math.max(...values);
      case "count":
        return values.length;
    }
  }

  // Operation tracking
  registerOperation(operation: ActiveOperation): void {
    this.activeOperations.set(operation.operationId, {
      ...operation,
      startTime: operation.startTime ?? new Date(),
    });
  }

  updateOperationProgress(operationId: string, progress: Partial<OperationProgress>): void {
    const operation = this.activeOperations.get(operationId);
    if (!operation) return;

    const currentProgress = operation.progress ?? { percentComplete: 0, currentStep: 0, totalSteps: 0 };
    operation.progress = {
      percentComplete: progress.percentComplete ?? currentProgress.percentComplete,
      currentStep: progress.currentStep ?? currentProgress.currentStep,
      totalSteps: progress.totalSteps ?? currentProgress.totalSteps,
      currentStepDescription: progress.currentStepDescription ?? currentProgress.currentStepDescription,
      estimatedTimeRemaining: progress.estimatedTimeRemaining ?? currentProgress.estimatedTimeRemaining,
    };

    if (progress.currentStep !== undefined && operation.steps) {
      // Mark completed steps
      for (let i = 0; i < operation.steps.length; i++) {
        if (i < progress.currentStep) {
          operation.steps[i].status = "completed";
        } else if (i === progress.currentStep) {
          operation.steps[i].status = "in-progress";
        }
      }
    }
  }

  completeOperation(operationId: string, status: "completed" | "failed" | "cancelled", result?: unknown): void {
    const operation = this.activeOperations.get(operationId);
    if (!operation) return;

    operation.status = status;
    operation.endTime = new Date();
    operation.result = result;

    if (operation.progress) {
      operation.progress.percentComplete = status === "completed" ? 100 : operation.progress.percentComplete;
    }

    this.activeOperations.delete(operationId);
    this.completedOperations.unshift(operation);

    // Trim completed operations
    if (this.completedOperations.length > this.config.maxOperationHistory) {
      this.completedOperations = this.completedOperations.slice(0, this.config.maxOperationHistory);
    }
  }

  getActiveOperation(operationId: string): ActiveOperation | undefined {
    return this.activeOperations.get(operationId);
  }

  getActiveOperations(filter?: { resourceId?: string; type?: string }): ActiveOperation[] {
    let operations = Array.from(this.activeOperations.values());

    if (filter?.resourceId) {
      operations = operations.filter(o => o.resourceId === filter.resourceId);
    }
    if (filter?.type) {
      operations = operations.filter(o => o.operationType === filter.type);
    }

    return operations;
  }

  getOperationHistory(limit?: number): ActiveOperation[] {
    return this.completedOperations.slice(0, limit ?? this.config.maxOperationHistory);
  }

  // Subscription management
  subscribe(subscriber: StateSubscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.findIndex(s => s.id === subscriber.id);
      if (index !== -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  private notifySubscribers(updatedStates: ResourceState[]): void {
    for (const subscriber of this.subscribers) {
      const filtered = subscriber.filter
        ? this.filterStates(updatedStates, subscriber.filter)
        : updatedStates;

      if (filtered.length > 0) {
        try {
          subscriber.callback(filtered);
        } catch {
          // Ignore subscriber errors
        }
      }
    }
  }

  private filterStates(states: ResourceState[], filter: ResourceStateFilter): ResourceState[] {
    return states.filter(s => {
      if (filter.types?.length && !filter.types.includes(s.resourceType)) return false;
      if (filter.environments?.length && !filter.environments.includes(s.environment)) return false;
      if (filter.statuses?.length && !filter.statuses.includes(s.status)) return false;
      if (filter.region && s.region !== filter.region) return false;
      if (filter.tags) {
        if (!s.tags) return false;
        return Object.entries(filter.tags).every(([k, v]) => s.tags![k] === v);
      }
      return true;
    });
  }

  // Context enrichment
  enrichConversationContext(context: ConversationContext): ConversationContext {
    const snapshot = this.getSnapshot();

    return {
      ...context,
      infrastructureSnapshot: snapshot,
      recentOperations: this.getOperationHistory(10),
      availableResources: this.getResourceSummary(),
    };
  }

  getResourceSummary(): { type: string; count: number; environments: Environment[] }[] {
    const summary = new Map<string, { count: number; environments: Set<Environment> }>();

    for (const state of this.resourceStates.values()) {
      const existing = summary.get(state.resourceType) ?? { count: 0, environments: new Set() };
      existing.count++;
      existing.environments.add(state.environment);
      summary.set(state.resourceType, existing);
    }

    return Array.from(summary.entries()).map(([type, data]) => ({
      type,
      count: data.count,
      environments: Array.from(data.environments),
    }));
  }

  // Health and alerts
  private calculateHealthSummary(resources: ResourceState[]): {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
  } {
    const summary = { healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 };

    for (const resource of resources) {
      switch (resource.status) {
        case "running":
        case "active":
        case "available":
          summary.healthy++;
          break;
        case "degraded":
        case "warning":
          summary.degraded++;
          break;
        case "stopped":
        case "failed":
        case "error":
          summary.unhealthy++;
          break;
        default:
          summary.unknown++;
      }
    }

    return summary;
  }

  private getActiveAlerts(resources: ResourceState[]): {
    resourceId: string;
    severity: "low" | "medium" | "high" | "critical";
    message: string;
    timestamp: Date;
  }[] {
    const alerts: {
      resourceId: string;
      severity: "low" | "medium" | "high" | "critical";
      message: string;
      timestamp: Date;
    }[] = [];

    for (const resource of resources) {
      // Check for status-based alerts
      if (resource.status === "failed" || resource.status === "error") {
        alerts.push({
          resourceId: resource.resourceId,
          severity: "critical",
          message: `${resource.resourceType} "${resource.name}" is in ${resource.status} state`,
          timestamp: resource.lastUpdated ?? new Date(),
        });
      }

      // Check for metric-based alerts
      if (resource.metrics) {
        if (resource.metrics.cpuUtilization && resource.metrics.cpuUtilization > 90) {
          alerts.push({
            resourceId: resource.resourceId,
            severity: "high",
            message: `High CPU utilization (${resource.metrics.cpuUtilization}%) on "${resource.name}"`,
            timestamp: new Date(),
          });
        }
        if (resource.metrics.memoryUtilization && resource.metrics.memoryUtilization > 90) {
          alerts.push({
            resourceId: resource.resourceId,
            severity: "high",
            message: `High memory utilization (${resource.metrics.memoryUtilization}%) on "${resource.name}"`,
            timestamp: new Date(),
          });
        }
        if (resource.metrics.errorRate && resource.metrics.errorRate > 5) {
          alerts.push({
            resourceId: resource.resourceId,
            severity: "medium",
            message: `Elevated error rate (${resource.metrics.errorRate}%) on "${resource.name}"`,
            timestamp: new Date(),
          });
        }
      }
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  private getRecentChanges(): {
    resourceId: string;
    changeType: string;
    previousValue?: unknown;
    newValue?: unknown;
    timestamp: Date;
  }[] {
    const changes: {
      resourceId: string;
      changeType: string;
      previousValue?: unknown;
      newValue?: unknown;
      timestamp: Date;
    }[] = [];

    for (const state of this.resourceStates.values()) {
      if (state.previousStatus && state.previousStatus !== state.status) {
        changes.push({
          resourceId: state.resourceId,
          changeType: "status",
          previousValue: state.previousStatus,
          newValue: state.status,
          timestamp: state.lastUpdated ?? new Date(),
        });
      }
    }

    // Sort by timestamp, most recent first
    return changes.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 20);
  }

  // Auto-refresh
  private startAutoRefresh(): void {
    this.refreshTimer = setInterval(() => {
      this.lastRefresh = new Date();
      // In a real implementation, this would fetch fresh state from infrastructure providers
    }, this.config.refreshInterval);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  getLastRefreshTime(): Date {
    return this.lastRefresh;
  }

  // Resource lookup helpers
  findResourcesByName(name: string, fuzzy?: boolean): ResourceState[] {
    const normalizedName = name.toLowerCase();
    return Array.from(this.resourceStates.values()).filter(s => {
      const resourceName = s.name.toLowerCase();
      return fuzzy
        ? resourceName.includes(normalizedName) || normalizedName.includes(resourceName)
        : resourceName === normalizedName;
    });
  }

  findResourcesByType(type: string): ResourceState[] {
    return Array.from(this.resourceStates.values()).filter(s =>
      s.resourceType.toLowerCase() === type.toLowerCase()
    );
  }

  toResolvedResource(state: ResourceState): ResolvedResource {
    return {
      id: state.resourceId,
      name: state.name,
      type: state.resourceType,
      arn: state.arn,
      region: state.region,
      environment: state.environment,
      tags: state.tags,
      status: state.status,
    };
  }

  // Cleanup
  dispose(): void {
    this.stopAutoRefresh();
    this.subscribers = [];
    this.resourceStates.clear();
    this.metricsHistory.clear();
    this.activeOperations.clear();
    this.completedOperations = [];
  }
}

export function createStateProvider(config?: Partial<StateProviderConfig>): InfrastructureStateProvider {
  return new InfrastructureStateProvider(config);
}
