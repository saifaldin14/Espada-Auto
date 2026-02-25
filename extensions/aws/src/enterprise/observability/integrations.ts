/**
 * Third-Party Observability Integrations
 *
 * Integrations with Datadog, Splunk, New Relic, and other
 * observability platforms.
 */

import { randomUUID } from 'node:crypto';
import type {
  ObservabilityIntegrationConfig,
  DatadogIntegration,
  SplunkIntegration,
  NewRelicIntegration,
  ObservabilityProvider,
  DeploymentMetric,
  AlertIncident,
  ObservabilityResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface IntegrationStorage {
  saveIntegration(config: ObservabilityIntegrationConfig): Promise<void>;
  getIntegration(id: string): Promise<ObservabilityIntegrationConfig | null>;
  listIntegrations(tenantId: string, options?: {
    provider?: ObservabilityProvider;
    active?: boolean;
  }): Promise<ObservabilityIntegrationConfig[]>;
  deleteIntegration(id: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryIntegrationStorage implements IntegrationStorage {
  private integrations = new Map<string, ObservabilityIntegrationConfig>();

  async saveIntegration(config: ObservabilityIntegrationConfig): Promise<void> {
    this.integrations.set(config.id, config);
  }

  async getIntegration(id: string): Promise<ObservabilityIntegrationConfig | null> {
    return this.integrations.get(id) ?? null;
  }

  async listIntegrations(tenantId: string, options?: {
    provider?: ObservabilityProvider;
    active?: boolean;
  }): Promise<ObservabilityIntegrationConfig[]> {
    return Array.from(this.integrations.values())
      .filter(i => i.tenantId === tenantId)
      .filter(i => !options?.provider || i.config.provider === options.provider)
      .filter(i => options?.active === undefined || i.active === options.active);
  }

  async deleteIntegration(id: string): Promise<void> {
    this.integrations.delete(id);
  }
}

// =============================================================================
// Provider Clients
// =============================================================================

interface ProviderClient {
  testConnection(): Promise<{ success: boolean; error?: string }>;
  sendDeployment(deployment: DeploymentMetric): Promise<{ success: boolean; error?: string }>;
  sendAlert(incident: AlertIncident): Promise<{ success: boolean; error?: string }>;
}

class DatadogClient implements ProviderClient {
  constructor(private config: DatadogIntegration) {}

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    // In production, would make API call to validate credentials
    if (!this.config.apiKey) {
      return { success: false, error: 'API key not configured' };
    }
    console.debug(`[Datadog] Testing connection to ${this.config.site}`);
    return { success: true };
  }

  async sendDeployment(deployment: DeploymentMetric): Promise<{ success: boolean; error?: string }> {
    const event = {
      title: `Deployment: ${deployment.projectName} to ${deployment.environment}`,
      text: `Status: ${deployment.status}, Duration: ${deployment.durationMs}ms`,
      date_happened: Math.floor(new Date(deployment.startedAt).getTime() / 1000),
      priority: deployment.status === 'failed' ? 'normal' : 'low',
      host: deployment.region ?? 'unknown',
      tags: [
        `env:${deployment.environment}`,
        `project:${deployment.projectName}`,
        `status:${deployment.status}`,
        `service:${this.config.serviceName}`,
      ],
      alert_type: deployment.status === 'failed' ? 'error' : 'info',
      source_type_name: 'espada',
    };

    console.debug(`[Datadog] Sending deployment event:`, JSON.stringify(event, null, 2));
    return { success: true };
  }

  async sendAlert(incident: AlertIncident): Promise<{ success: boolean; error?: string }> {
    const event = {
      title: `Alert: ${incident.alertRuleName}`,
      text: `Severity: ${incident.severity}, State: ${incident.state}`,
      date_happened: Math.floor(new Date(incident.startedAt).getTime() / 1000),
      priority: incident.severity === 'critical' ? 'normal' : 'low',
      tags: [
        `severity:${incident.severity}`,
        `state:${incident.state}`,
        ...(incident.labels ? Object.entries(incident.labels).map(([k, v]) => `${k}:${v}`) : []),
      ],
      alert_type: incident.state === 'firing' ? 'error' : 'success',
      source_type_name: 'espada',
    };

    console.debug(`[Datadog] Sending alert event:`, JSON.stringify(event, null, 2));
    return { success: true };
  }
}

class SplunkClient implements ProviderClient {
  constructor(private config: SplunkIntegration) {}

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.config.hecToken) {
      return { success: false, error: 'HEC token not configured' };
    }
    console.debug(`[Splunk] Testing connection to ${this.config.hecEndpoint}`);
    return { success: true };
  }

  async sendDeployment(deployment: DeploymentMetric): Promise<{ success: boolean; error?: string }> {
    const event = {
      time: Math.floor(new Date(deployment.startedAt).getTime() / 1000),
      source: this.config.source ?? 'espada',
      sourcetype: this.config.sourceType ?? 'espada:deployment',
      index: this.config.index ?? 'main',
      event: {
        type: 'deployment',
        project: deployment.projectName,
        environment: deployment.environment,
        status: deployment.status,
        duration_ms: deployment.durationMs,
        resources_affected: deployment.resourcesAffected,
        triggered_by: deployment.triggeredBy,
        trigger_type: deployment.triggerType,
      },
    };

    console.debug(`[Splunk] Sending deployment event:`, JSON.stringify(event, null, 2));
    return { success: true };
  }

  async sendAlert(incident: AlertIncident): Promise<{ success: boolean; error?: string }> {
    const event = {
      time: Math.floor(new Date(incident.startedAt).getTime() / 1000),
      source: this.config.source ?? 'espada',
      sourcetype: this.config.sourceType ?? 'espada:alert',
      index: this.config.index ?? 'main',
      event: {
        type: 'alert',
        rule_name: incident.alertRuleName,
        severity: incident.severity,
        state: incident.state,
        trigger_value: incident.triggerValue,
        labels: incident.labels,
      },
    };

    console.debug(`[Splunk] Sending alert event:`, JSON.stringify(event, null, 2));
    return { success: true };
  }
}

class NewRelicClient implements ProviderClient {
  constructor(private config: NewRelicIntegration) {}

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.config.licenseKey) {
      return { success: false, error: 'License key not configured' };
    }
    console.debug(`[New Relic] Testing connection for account ${this.config.accountId}`);
    return { success: true };
  }

  async sendDeployment(deployment: DeploymentMetric): Promise<{ success: boolean; error?: string }> {
    const deploymentMarker = {
      deployment: {
        revision: deployment.commitSha ?? deployment.deploymentId,
        changelog: `Deployment to ${deployment.environment}`,
        description: `Status: ${deployment.status}`,
        user: deployment.triggeredBy,
        timestamp: Math.floor(new Date(deployment.startedAt).getTime() / 1000),
      },
    };

    console.debug(`[New Relic] Sending deployment marker:`, JSON.stringify(deploymentMarker, null, 2));
    return { success: true };
  }

  async sendAlert(incident: AlertIncident): Promise<{ success: boolean; error?: string }> {
    const event = {
      eventType: 'EspadaAlert',
      timestamp: new Date(incident.startedAt).getTime(),
      alertRuleName: incident.alertRuleName,
      severity: incident.severity,
      state: incident.state,
      triggerValue: incident.triggerValue,
      ...incident.labels,
    };

    console.debug(`[New Relic] Sending custom event:`, JSON.stringify(event, null, 2));
    return { success: true };
  }
}

// =============================================================================
// Integration Service
// =============================================================================

export interface IntegrationServiceConfig {
  storage?: IntegrationStorage;
}

export class ObservabilityIntegrationService {
  private storage: IntegrationStorage;
  private clients = new Map<string, ProviderClient>();

  constructor(config?: IntegrationServiceConfig) {
    this.storage = config?.storage ?? new InMemoryIntegrationStorage();
  }

  // ===========================================================================
  // Integration Management
  // ===========================================================================

  async createIntegration(
    tenantId: string,
    options: {
      name: string;
      config: DatadogIntegration | SplunkIntegration | NewRelicIntegration;
      syncDeployments?: boolean;
      syncAlerts?: boolean;
    },
  ): Promise<ObservabilityResult<ObservabilityIntegrationConfig>> {
    const now = new Date().toISOString();

    const integration: ObservabilityIntegrationConfig = {
      tenantId,
      id: randomUUID(),
      name: options.name,
      active: true,
      config: options.config,
      syncDeployments: options.syncDeployments ?? true,
      syncAlerts: options.syncAlerts ?? true,
      createdAt: now,
      updatedAt: now,
    };

    // Test connection before saving
    const client = this.createClient(integration);
    const testResult = await client.testConnection();
    if (!testResult.success) {
      return { success: false, error: `Connection test failed: ${testResult.error}`, code: 'CONNECTION_FAILED' };
    }

    await this.storage.saveIntegration(integration);
    this.clients.set(integration.id, client);

    return { success: true, data: integration };
  }

  async getIntegration(integrationId: string): Promise<ObservabilityResult<ObservabilityIntegrationConfig>> {
    const integration = await this.storage.getIntegration(integrationId);
    if (!integration) {
      return { success: false, error: 'Integration not found', code: 'INTEGRATION_NOT_FOUND' };
    }
    return { success: true, data: integration };
  }

  async listIntegrations(
    tenantId: string,
    options?: {
      provider?: ObservabilityProvider;
      active?: boolean;
    },
  ): Promise<ObservabilityResult<ObservabilityIntegrationConfig[]>> {
    const integrations = await this.storage.listIntegrations(tenantId, options);
    return { success: true, data: integrations };
  }

  async updateIntegration(
    integrationId: string,
    updates: Partial<Pick<ObservabilityIntegrationConfig, 'name' | 'active' | 'syncDeployments' | 'syncAlerts'>>,
  ): Promise<ObservabilityResult<ObservabilityIntegrationConfig>> {
    const integration = await this.storage.getIntegration(integrationId);
    if (!integration) {
      return { success: false, error: 'Integration not found', code: 'INTEGRATION_NOT_FOUND' };
    }

    const updated: ObservabilityIntegrationConfig = {
      ...integration,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveIntegration(updated);
    return { success: true, data: updated };
  }

  async deleteIntegration(integrationId: string): Promise<ObservabilityResult<void>> {
    this.clients.delete(integrationId);
    await this.storage.deleteIntegration(integrationId);
    return { success: true };
  }

  async testIntegration(integrationId: string): Promise<ObservabilityResult<{ latencyMs: number }>> {
    const integration = await this.storage.getIntegration(integrationId);
    if (!integration) {
      return { success: false, error: 'Integration not found', code: 'INTEGRATION_NOT_FOUND' };
    }

    const client = this.getOrCreateClient(integration);
    const start = Date.now();
    const result = await client.testConnection();
    const latencyMs = Date.now() - start;

    if (!result.success) {
      return { success: false, error: result.error, code: 'CONNECTION_FAILED' };
    }

    return { success: true, data: { latencyMs } };
  }

  // ===========================================================================
  // Data Sync
  // ===========================================================================

  async syncDeployment(
    tenantId: string,
    deployment: DeploymentMetric,
  ): Promise<ObservabilityResult<{ synced: string[]; failed: string[] }>> {
    const integrations = await this.storage.listIntegrations(tenantId, { active: true });
    const syncTargets = integrations.filter(i => i.syncDeployments);

    const synced: string[] = [];
    const failed: string[] = [];

    for (const integration of syncTargets) {
      const client = this.getOrCreateClient(integration);
      const result = await client.sendDeployment(deployment);

      if (result.success) {
        synced.push(integration.name);
      } else {
        failed.push(`${integration.name}: ${result.error}`);
      }
    }

    return { success: true, data: { synced, failed } };
  }

  async syncAlert(
    tenantId: string,
    incident: AlertIncident,
  ): Promise<ObservabilityResult<{ synced: string[]; failed: string[] }>> {
    const integrations = await this.storage.listIntegrations(tenantId, { active: true });
    const syncTargets = integrations.filter(i => i.syncAlerts);

    const synced: string[] = [];
    const failed: string[] = [];

    for (const integration of syncTargets) {
      const client = this.getOrCreateClient(integration);
      const result = await client.sendAlert(incident);

      if (result.success) {
        synced.push(integration.name);
      } else {
        failed.push(`${integration.name}: ${result.error}`);
      }
    }

    return { success: true, data: { synced, failed } };
  }

  // ===========================================================================
  // Provider-Specific Helpers
  // ===========================================================================

  createDatadogConfig(options: {
    apiKey: string;
    appKey?: string;
    site?: string;
    serviceName: string;
    environment?: string;
    tags?: string[];
    enableApm?: boolean;
    enableLogs?: boolean;
  }): DatadogIntegration {
    return {
      provider: 'datadog',
      apiKey: options.apiKey,
      appKey: options.appKey,
      site: options.site ?? 'datadoghq.com',
      serviceName: options.serviceName,
      environment: options.environment,
      tags: options.tags,
      enableApm: options.enableApm ?? true,
      enableLogs: options.enableLogs ?? true,
      enableInfrastructure: true,
    };
  }

  createSplunkConfig(options: {
    hecEndpoint: string;
    hecToken: string;
    index?: string;
    source?: string;
    observabilityRealm?: string;
    observabilityToken?: string;
  }): SplunkIntegration {
    return {
      provider: 'splunk',
      hecEndpoint: options.hecEndpoint,
      hecToken: options.hecToken,
      index: options.index ?? 'main',
      source: options.source ?? 'espada',
      sourceType: 'espada:event',
      enableMetrics: true,
      enableTraces: true,
      observabilityRealm: options.observabilityRealm,
      observabilityToken: options.observabilityToken,
    };
  }

  createNewRelicConfig(options: {
    licenseKey: string;
    accountId: string;
    region?: 'us' | 'eu';
    appName: string;
    insightsInsertKey?: string;
  }): NewRelicIntegration {
    return {
      provider: 'newrelic',
      licenseKey: options.licenseKey,
      insightsInsertKey: options.insightsInsertKey,
      accountId: options.accountId,
      region: options.region ?? 'us',
      appName: options.appName,
      enableDistributedTracing: true,
      enableLogsInContext: true,
      enableInfrastructure: true,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private getOrCreateClient(integration: ObservabilityIntegrationConfig): ProviderClient {
    let client = this.clients.get(integration.id);
    if (!client) {
      client = this.createClient(integration);
      this.clients.set(integration.id, client);
    }
    return client;
  }

  private createClient(integration: ObservabilityIntegrationConfig): ProviderClient {
    switch (integration.config.provider) {
      case 'datadog':
        return new DatadogClient(integration.config);
      case 'splunk':
        return new SplunkClient(integration.config);
      case 'newrelic':
        return new NewRelicClient(integration.config);
      default:
        throw new Error(`Unsupported provider: ${(integration.config as { provider: string }).provider}`);
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createObservabilityIntegrationService(
  config?: IntegrationServiceConfig,
): ObservabilityIntegrationService {
  return new ObservabilityIntegrationService(config);
}
