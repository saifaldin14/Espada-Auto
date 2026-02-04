/**
 * Alerting Service
 *
 * Custom alerting rules with support for threshold-based,
 * anomaly-based, and composite alerts with multiple notification channels.
 */

import { randomUUID } from 'node:crypto';
import type {
  AlertRule,
  AlertCondition,
  AlertNotificationChannel,
  AlertIncident,
  AlertState,
  AnomalySeverity,
  ObservabilityResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface AlertStorage {
  // Rules
  saveRule(rule: AlertRule): Promise<void>;
  getRule(id: string): Promise<AlertRule | null>;
  listRules(tenantId: string, options?: {
    enabled?: boolean;
    severity?: AnomalySeverity;
  }): Promise<AlertRule[]>;
  deleteRule(id: string): Promise<void>;

  // Incidents
  saveIncident(incident: AlertIncident): Promise<void>;
  getIncident(id: string): Promise<AlertIncident | null>;
  listIncidents(tenantId: string, options?: {
    ruleId?: string;
    state?: AlertIncident['state'];
    severity?: AnomalySeverity;
    acknowledged?: boolean;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AlertIncident[]>;
  updateIncident(id: string, updates: Partial<AlertIncident>): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryAlertStorage implements AlertStorage {
  private rules = new Map<string, AlertRule>();
  private incidents = new Map<string, AlertIncident>();

  async saveRule(rule: AlertRule): Promise<void> {
    this.rules.set(rule.id, rule);
  }

  async getRule(id: string): Promise<AlertRule | null> {
    return this.rules.get(id) ?? null;
  }

  async listRules(tenantId: string, options?: {
    enabled?: boolean;
    severity?: AnomalySeverity;
  }): Promise<AlertRule[]> {
    return Array.from(this.rules.values())
      .filter(r => r.tenantId === tenantId)
      .filter(r => options?.enabled === undefined || r.enabled === options.enabled)
      .filter(r => !options?.severity || r.severity === options.severity);
  }

  async deleteRule(id: string): Promise<void> {
    this.rules.delete(id);
  }

  async saveIncident(incident: AlertIncident): Promise<void> {
    this.incidents.set(incident.id, incident);
  }

  async getIncident(id: string): Promise<AlertIncident | null> {
    return this.incidents.get(id) ?? null;
  }

  async listIncidents(tenantId: string, options?: {
    ruleId?: string;
    state?: AlertIncident['state'];
    severity?: AnomalySeverity;
    acknowledged?: boolean;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AlertIncident[]> {
    let results = Array.from(this.incidents.values())
      .filter(i => i.tenantId === tenantId)
      .filter(i => !options?.ruleId || i.alertRuleId === options.ruleId)
      .filter(i => !options?.state || i.state === options.state)
      .filter(i => !options?.severity || i.severity === options.severity)
      .filter(i => options?.acknowledged === undefined || i.acknowledged === options.acknowledged)
      .filter(i => !options?.from || i.startedAt >= options.from)
      .filter(i => !options?.to || i.startedAt <= options.to)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async updateIncident(id: string, updates: Partial<AlertIncident>): Promise<void> {
    const existing = this.incidents.get(id);
    if (existing) {
      this.incidents.set(id, { ...existing, ...updates });
    }
  }
}

// =============================================================================
// Notification Sender
// =============================================================================

export interface NotificationSender {
  send(channel: AlertNotificationChannel, incident: AlertIncident, rule: AlertRule): Promise<{
    success: boolean;
    error?: string;
  }>;
}

class DefaultNotificationSender implements NotificationSender {
  async send(
    channel: AlertNotificationChannel,
    incident: AlertIncident,
    rule: AlertRule,
  ): Promise<{ success: boolean; error?: string }> {
    // In production, this would integrate with actual notification providers
    const message = this.formatMessage(channel, incident, rule);
    
    switch (channel.type) {
      case 'email':
        console.log(`[Alert Email] To: ${channel.config.emails?.join(', ')}\n${message}`);
        break;
      case 'slack':
        console.log(`[Alert Slack] Channel: ${channel.config.slackChannel}\n${message}`);
        break;
      case 'pagerduty':
        console.log(`[Alert PagerDuty] Service: ${channel.config.pagerdutyServiceId}\n${message}`);
        break;
      case 'opsgenie':
        console.log(`[Alert OpsGenie]\n${message}`);
        break;
      case 'webhook':
        console.log(`[Alert Webhook] URL: ${channel.config.webhookUrl}\n${message}`);
        break;
      case 'teams':
        console.log(`[Alert Teams]\n${message}`);
        break;
      case 'sns':
        console.log(`[Alert SNS] Topic: ${channel.config.snsTopicArn}\n${message}`);
        break;
    }

    return { success: true };
  }

  private formatMessage(
    channel: AlertNotificationChannel,
    incident: AlertIncident,
    rule: AlertRule,
  ): string {
    if (channel.messageTemplate) {
      return channel.messageTemplate
        .replace('{{rule_name}}', rule.name)
        .replace('{{severity}}', incident.severity)
        .replace('{{state}}', incident.state)
        .replace('{{value}}', String(incident.triggerValue ?? 'N/A'))
        .replace('{{started_at}}', incident.startedAt);
    }

    return `Alert: ${rule.name}\nSeverity: ${incident.severity}\nState: ${incident.state}\nStarted: ${incident.startedAt}`;
  }
}

// =============================================================================
// Alerting Service
// =============================================================================

export interface AlertServiceConfig {
  storage?: AlertStorage;
  notificationSender?: NotificationSender;
  defaultEvaluationInterval?: number;
}

export class AlertingService {
  private storage: AlertStorage;
  private notificationSender: NotificationSender;
  private defaultEvaluationInterval: number;
  private evaluationIntervals = new Map<string, NodeJS.Timeout>();

  constructor(config?: AlertServiceConfig) {
    this.storage = config?.storage ?? new InMemoryAlertStorage();
    this.notificationSender = config?.notificationSender ?? new DefaultNotificationSender();
    this.defaultEvaluationInterval = config?.defaultEvaluationInterval ?? 60;
  }

  // ===========================================================================
  // Rule Management
  // ===========================================================================

  async createRule(
    tenantId: string,
    options: {
      name: string;
      description?: string;
      severity: AnomalySeverity;
      condition: AlertCondition;
      notifications: AlertNotificationChannel[];
      labels?: Record<string, string>;
      annotations?: Record<string, string>;
      evaluationInterval?: number;
    },
  ): Promise<ObservabilityResult<AlertRule>> {
    const now = new Date().toISOString();

    const rule: AlertRule = {
      id: randomUUID(),
      tenantId,
      name: options.name,
      description: options.description,
      severity: options.severity,
      condition: options.condition,
      notifications: options.notifications,
      labels: options.labels,
      annotations: options.annotations,
      evaluationInterval: options.evaluationInterval ?? this.defaultEvaluationInterval,
      enabled: true,
      currentState: 'ok',
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveRule(rule);
    return { success: true, data: rule };
  }

  async getRule(ruleId: string): Promise<ObservabilityResult<AlertRule>> {
    const rule = await this.storage.getRule(ruleId);
    if (!rule) {
      return { success: false, error: 'Rule not found', code: 'RULE_NOT_FOUND' };
    }
    return { success: true, data: rule };
  }

  async listRules(
    tenantId: string,
    options?: {
      enabled?: boolean;
      severity?: AnomalySeverity;
    },
  ): Promise<ObservabilityResult<AlertRule[]>> {
    const rules = await this.storage.listRules(tenantId, options);
    return { success: true, data: rules };
  }

  async updateRule(
    ruleId: string,
    updates: Partial<Pick<AlertRule, 'name' | 'description' | 'severity' | 'condition' | 
      'notifications' | 'labels' | 'annotations' | 'evaluationInterval' | 'enabled'>>,
  ): Promise<ObservabilityResult<AlertRule>> {
    const rule = await this.storage.getRule(ruleId);
    if (!rule) {
      return { success: false, error: 'Rule not found', code: 'RULE_NOT_FOUND' };
    }

    const updated: AlertRule = {
      ...rule,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveRule(updated);
    return { success: true, data: updated };
  }

  async deleteRule(ruleId: string): Promise<ObservabilityResult<void>> {
    this.stopEvaluation(ruleId);
    await this.storage.deleteRule(ruleId);
    return { success: true };
  }

  async muteRule(ruleId: string, untilTime: string): Promise<ObservabilityResult<AlertRule>> {
    const rule = await this.storage.getRule(ruleId);
    if (!rule) {
      return { success: false, error: 'Rule not found', code: 'RULE_NOT_FOUND' };
    }

    rule.mutedUntil = untilTime;
    rule.updatedAt = new Date().toISOString();
    await this.storage.saveRule(rule);

    return { success: true, data: rule };
  }

  async unmuteRule(ruleId: string): Promise<ObservabilityResult<AlertRule>> {
    const rule = await this.storage.getRule(ruleId);
    if (!rule) {
      return { success: false, error: 'Rule not found', code: 'RULE_NOT_FOUND' };
    }

    rule.mutedUntil = undefined;
    rule.updatedAt = new Date().toISOString();
    await this.storage.saveRule(rule);

    return { success: true, data: rule };
  }

  // ===========================================================================
  // Alert Evaluation
  // ===========================================================================

  async evaluateRule(
    ruleId: string,
    currentValue: number,
  ): Promise<ObservabilityResult<{ state: AlertState; incident?: AlertIncident }>> {
    const rule = await this.storage.getRule(ruleId);
    if (!rule) {
      return { success: false, error: 'Rule not found', code: 'RULE_NOT_FOUND' };
    }

    // Check if muted
    if (rule.mutedUntil && new Date(rule.mutedUntil) > new Date()) {
      return { success: true, data: { state: rule.currentState } };
    }

    const conditionMet = this.evaluateCondition(rule.condition, currentValue);
    const now = new Date().toISOString();
    const previousState = rule.currentState;
    let newState: AlertState = conditionMet ? 'alerting' : 'ok';

    // Handle pending state for duration-based alerts
    if (conditionMet && rule.condition.forDuration && previousState === 'ok') {
      newState = 'pending';
    } else if (conditionMet && previousState === 'pending' && rule.condition.forDuration) {
      // Check if we've been pending long enough
      const pendingSince = rule.lastStateChangeAt ? new Date(rule.lastStateChangeAt) : new Date();
      const pendingMs = new Date().getTime() - pendingSince.getTime();
      if (pendingMs < rule.condition.forDuration * 1000) {
        newState = 'pending';
      }
    }

    // Update rule state
    if (newState !== previousState) {
      rule.currentState = newState;
      rule.lastStateChangeAt = now;
    }
    rule.lastEvaluatedAt = now;
    await this.storage.saveRule(rule);

    // Create or resolve incident
    let incident: AlertIncident | undefined;

    if (newState === 'alerting' && previousState !== 'alerting') {
      // Create new incident
      incident = {
        id: randomUUID(),
        tenantId: rule.tenantId,
        alertRuleId: rule.id,
        alertRuleName: rule.name,
        severity: rule.severity,
        state: 'firing',
        startedAt: now,
        triggerValue: currentValue,
        labels: rule.labels,
        notificationsSent: [],
        acknowledged: false,
      };

      await this.storage.saveIncident(incident);

      // Send notifications
      await this.sendNotifications(rule, incident, newState);
    } else if (newState === 'ok' && previousState === 'alerting') {
      // Find and resolve active incident
      const incidents = await this.storage.listIncidents(rule.tenantId, {
        ruleId: rule.id,
        state: 'firing',
        limit: 1,
      });

      if (incidents.length > 0) {
        incident = incidents[0];
        incident.state = 'resolved';
        incident.resolvedAt = now;
        incident.durationMs = new Date(now).getTime() - new Date(incident.startedAt).getTime();
        await this.storage.updateIncident(incident.id, incident);

        // Send resolution notifications
        await this.sendNotifications(rule, incident, newState);
      }
    }

    return { success: true, data: { state: newState, incident } };
  }

  private evaluateCondition(condition: AlertCondition, value: number): boolean {
    if (condition.type === 'threshold' && condition.threshold !== undefined) {
      switch (condition.operator) {
        case 'gt': return value > condition.threshold;
        case 'gte': return value >= condition.threshold;
        case 'lt': return value < condition.threshold;
        case 'lte': return value <= condition.threshold;
        case 'eq': return value === condition.threshold;
        case 'neq': return value !== condition.threshold;
        default: return false;
      }
    }

    if (condition.type === 'rate_of_change' && condition.rateOfChangePercent !== undefined) {
      // Would need historical data to properly evaluate
      return Math.abs(value) > condition.rateOfChangePercent;
    }

    if (condition.type === 'composite' && condition.children) {
      const results = condition.children.map(c => this.evaluateCondition(c, value));
      return condition.logic === 'and'
        ? results.every(r => r)
        : results.some(r => r);
    }

    return false;
  }

  private async sendNotifications(
    rule: AlertRule,
    incident: AlertIncident,
    state: AlertState,
  ): Promise<void> {
    for (const channel of rule.notifications) {
      if (!channel.sendOn.includes(state)) {
        continue;
      }

      const result = await this.notificationSender.send(channel, incident, rule);
      incident.notificationsSent.push({
        channel: channel.type,
        sentAt: new Date().toISOString(),
        success: result.success,
        error: result.error,
      });
    }

    await this.storage.updateIncident(incident.id, {
      notificationsSent: incident.notificationsSent,
    });
  }

  // ===========================================================================
  // Evaluation Loop
  // ===========================================================================

  startEvaluation(
    ruleId: string,
    getMetricValue: () => Promise<number>,
  ): void {
    this.stopEvaluation(ruleId);

    const evaluate = async () => {
      const rule = await this.storage.getRule(ruleId);
      if (!rule || !rule.enabled) {
        this.stopEvaluation(ruleId);
        return;
      }

      try {
        const value = await getMetricValue();
        await this.evaluateRule(ruleId, value);
      } catch (error) {
        console.error(`Error evaluating rule ${ruleId}:`, error);
      }
    };

    // Run immediately
    void evaluate();

    // Then schedule periodic evaluation
    this.storage.getRule(ruleId).then(rule => {
      if (rule) {
        const interval = setInterval(evaluate, rule.evaluationInterval * 1000);
        this.evaluationIntervals.set(ruleId, interval);
      }
    });
  }

  stopEvaluation(ruleId: string): void {
    const interval = this.evaluationIntervals.get(ruleId);
    if (interval) {
      clearInterval(interval);
      this.evaluationIntervals.delete(ruleId);
    }
  }

  stopAllEvaluations(): void {
    for (const [ruleId] of this.evaluationIntervals) {
      this.stopEvaluation(ruleId);
    }
  }

  // ===========================================================================
  // Incident Management
  // ===========================================================================

  async getIncident(incidentId: string): Promise<ObservabilityResult<AlertIncident>> {
    const incident = await this.storage.getIncident(incidentId);
    if (!incident) {
      return { success: false, error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' };
    }
    return { success: true, data: incident };
  }

  async listIncidents(
    tenantId: string,
    options?: {
      ruleId?: string;
      state?: AlertIncident['state'];
      severity?: AnomalySeverity;
      acknowledged?: boolean;
      from?: string;
      to?: string;
      limit?: number;
    },
  ): Promise<ObservabilityResult<AlertIncident[]>> {
    const incidents = await this.storage.listIncidents(tenantId, options);
    return { success: true, data: incidents };
  }

  async acknowledgeIncident(
    incidentId: string,
    userId: string,
    notes?: string,
  ): Promise<ObservabilityResult<AlertIncident>> {
    const incident = await this.storage.getIncident(incidentId);
    if (!incident) {
      return { success: false, error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' };
    }

    incident.acknowledged = true;
    incident.acknowledgedBy = userId;
    incident.acknowledgedAt = new Date().toISOString();
    if (notes) {
      incident.notes = notes;
    }

    await this.storage.updateIncident(incidentId, incident);
    return { success: true, data: incident };
  }

  async addIncidentNote(
    incidentId: string,
    note: string,
  ): Promise<ObservabilityResult<AlertIncident>> {
    const incident = await this.storage.getIncident(incidentId);
    if (!incident) {
      return { success: false, error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' };
    }

    incident.notes = incident.notes ? `${incident.notes}\n\n${note}` : note;
    await this.storage.updateIncident(incidentId, incident);

    return { success: true, data: incident };
  }

  // ===========================================================================
  // Preset Rules
  // ===========================================================================

  createHighErrorRateRule(
    tenantId: string,
    threshold: number = 5,
    notifications: AlertNotificationChannel[],
  ): Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      tenantId,
      name: 'High Error Rate',
      description: 'Alerts when error rate exceeds threshold',
      severity: 'high',
      condition: {
        type: 'threshold',
        metric: 'error_rate_percent',
        operator: 'gt',
        threshold,
        forDuration: 300, // 5 minutes
        aggregation: 'avg',
      },
      notifications,
      labels: { category: 'reliability' },
      evaluationInterval: 60,
      enabled: true,
      currentState: 'ok',
    };
  }

  createHighLatencyRule(
    tenantId: string,
    thresholdMs: number = 1000,
    notifications: AlertNotificationChannel[],
  ): Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      tenantId,
      name: 'High Latency',
      description: 'Alerts when P95 latency exceeds threshold',
      severity: 'medium',
      condition: {
        type: 'threshold',
        metric: 'latency_p95_ms',
        operator: 'gt',
        threshold: thresholdMs,
        forDuration: 180, // 3 minutes
        aggregation: 'avg',
      },
      notifications,
      labels: { category: 'performance' },
      evaluationInterval: 60,
      enabled: true,
      currentState: 'ok',
    };
  }

  createDeploymentFailureRule(
    tenantId: string,
    notifications: AlertNotificationChannel[],
  ): Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      tenantId,
      name: 'Deployment Failure',
      description: 'Alerts on any deployment failure',
      severity: 'critical',
      condition: {
        type: 'threshold',
        metric: 'deployment_failed',
        operator: 'eq',
        threshold: 1,
      },
      notifications,
      labels: { category: 'deployment' },
      evaluationInterval: 30,
      enabled: true,
      currentState: 'ok',
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createAlertingService(config?: AlertServiceConfig): AlertingService {
  return new AlertingService(config);
}
