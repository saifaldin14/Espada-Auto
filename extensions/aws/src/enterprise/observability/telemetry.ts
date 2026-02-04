/**
 * OpenTelemetry Service
 *
 * Manages OpenTelemetry configuration, exporters, and telemetry data
 * collection for traces, metrics, and logs.
 */

import { randomUUID } from 'node:crypto';
import type {
  TelemetryConfig,
  TracingConfig,
  MetricsConfig,
  LoggingConfig,
  TelemetryExporterConfig,
  ObservabilityResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface TelemetryStorage {
  // Configuration
  saveConfig(config: TelemetryConfig): Promise<void>;
  getConfig(tenantId: string, name?: string): Promise<TelemetryConfig | null>;
  listConfigs(tenantId: string): Promise<TelemetryConfig[]>;
  deleteConfig(tenantId: string, name: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryTelemetryStorage implements TelemetryStorage {
  private configs = new Map<string, TelemetryConfig>();

  private key(tenantId: string, name: string): string {
    return `${tenantId}:${name}`;
  }

  async saveConfig(config: TelemetryConfig): Promise<void> {
    this.configs.set(this.key(config.tenantId, config.name), config);
  }

  async getConfig(tenantId: string, name = 'default'): Promise<TelemetryConfig | null> {
    return this.configs.get(this.key(tenantId, name)) ?? null;
  }

  async listConfigs(tenantId: string): Promise<TelemetryConfig[]> {
    return Array.from(this.configs.values()).filter(c => c.tenantId === tenantId);
  }

  async deleteConfig(tenantId: string, name: string): Promise<void> {
    this.configs.delete(this.key(tenantId, name));
  }
}

// =============================================================================
// Telemetry Service
// =============================================================================

export interface TelemetryServiceConfig {
  storage?: TelemetryStorage;
  defaultServiceName?: string;
  defaultSampleRate?: number;
}

export class TelemetryService {
  private storage: TelemetryStorage;
  private defaultServiceName: string;
  private defaultSampleRate: number;

  constructor(config?: TelemetryServiceConfig) {
    this.storage = config?.storage ?? new InMemoryTelemetryStorage();
    this.defaultServiceName = config?.defaultServiceName ?? 'espada-infrastructure';
    this.defaultSampleRate = config?.defaultSampleRate ?? 0.1;
  }

  // ===========================================================================
  // Configuration Management
  // ===========================================================================

  async createConfig(
    tenantId: string,
    options: {
      name?: string;
      tracing?: Partial<TracingConfig>;
      metrics?: Partial<MetricsConfig>;
      logging?: Partial<LoggingConfig>;
    },
  ): Promise<ObservabilityResult<TelemetryConfig>> {
    const now = new Date().toISOString();
    const name = options.name ?? 'default';

    const config: TelemetryConfig = {
      tenantId,
      name,
      tracing: options.tracing
        ? {
            enabled: options.tracing.enabled ?? true,
            serviceName: options.tracing.serviceName ?? this.defaultServiceName,
            serviceVersion: options.tracing.serviceVersion,
            environment: options.tracing.environment,
            sampleRate: options.tracing.sampleRate ?? this.defaultSampleRate,
            exporters: options.tracing.exporters ?? [],
            propagators: options.tracing.propagators ?? ['tracecontext', 'baggage'],
            resourceAttributes: options.tracing.resourceAttributes,
            instrumentation: options.tracing.instrumentation ?? {
              http: true,
              grpc: true,
              aws: true,
              database: true,
            },
          }
        : undefined,
      metrics: options.metrics
        ? {
            enabled: options.metrics.enabled ?? true,
            serviceName: options.metrics.serviceName ?? this.defaultServiceName,
            exporters: options.metrics.exporters ?? [],
            collectionIntervalMs: options.metrics.collectionIntervalMs ?? 60000,
            resourceAttributes: options.metrics.resourceAttributes,
            metricsPrefix: options.metrics.metricsPrefix ?? 'espada',
            runtimeMetrics: options.metrics.runtimeMetrics ?? true,
            hostMetrics: options.metrics.hostMetrics ?? true,
          }
        : undefined,
      logging: options.logging
        ? {
            enabled: options.logging.enabled ?? true,
            serviceName: options.logging.serviceName ?? this.defaultServiceName,
            exporters: options.logging.exporters ?? [],
            minLevel: options.logging.minLevel ?? 'info',
            includeTraceContext: options.logging.includeTraceContext ?? true,
            resourceAttributes: options.logging.resourceAttributes,
            structuredFormat: options.logging.structuredFormat ?? 'json',
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveConfig(config);
    return { success: true, data: config };
  }

  async getConfig(tenantId: string, name?: string): Promise<ObservabilityResult<TelemetryConfig>> {
    const config = await this.storage.getConfig(tenantId, name);
    if (!config) {
      return { success: false, error: 'Configuration not found', code: 'CONFIG_NOT_FOUND' };
    }
    return { success: true, data: config };
  }

  async listConfigs(tenantId: string): Promise<ObservabilityResult<TelemetryConfig[]>> {
    const configs = await this.storage.listConfigs(tenantId);
    return { success: true, data: configs };
  }

  async updateConfig(
    tenantId: string,
    name: string,
    updates: {
      tracing?: Partial<TracingConfig>;
      metrics?: Partial<MetricsConfig>;
      logging?: Partial<LoggingConfig>;
    },
  ): Promise<ObservabilityResult<TelemetryConfig>> {
    const existing = await this.storage.getConfig(tenantId, name);
    if (!existing) {
      return { success: false, error: 'Configuration not found', code: 'CONFIG_NOT_FOUND' };
    }

    const updated: TelemetryConfig = {
      ...existing,
      tracing: updates.tracing
        ? { ...existing.tracing, ...updates.tracing } as TracingConfig
        : existing.tracing,
      metrics: updates.metrics
        ? { ...existing.metrics, ...updates.metrics } as MetricsConfig
        : existing.metrics,
      logging: updates.logging
        ? { ...existing.logging, ...updates.logging } as LoggingConfig
        : existing.logging,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveConfig(updated);
    return { success: true, data: updated };
  }

  async deleteConfig(tenantId: string, name: string): Promise<ObservabilityResult<void>> {
    await this.storage.deleteConfig(tenantId, name);
    return { success: true };
  }

  // ===========================================================================
  // Exporter Management
  // ===========================================================================

  async addExporter(
    tenantId: string,
    configName: string,
    signal: 'tracing' | 'metrics' | 'logging',
    exporter: TelemetryExporterConfig,
  ): Promise<ObservabilityResult<TelemetryConfig>> {
    const existing = await this.storage.getConfig(tenantId, configName);
    if (!existing) {
      return { success: false, error: 'Configuration not found', code: 'CONFIG_NOT_FOUND' };
    }

    const signalConfig = existing[signal];
    if (!signalConfig) {
      return { success: false, error: `Signal ${signal} not configured`, code: 'SIGNAL_NOT_CONFIGURED' };
    }

    signalConfig.exporters.push(exporter);
    existing.updatedAt = new Date().toISOString();

    await this.storage.saveConfig(existing);
    return { success: true, data: existing };
  }

  async removeExporter(
    tenantId: string,
    configName: string,
    signal: 'tracing' | 'metrics' | 'logging',
    exporterType: string,
  ): Promise<ObservabilityResult<TelemetryConfig>> {
    const existing = await this.storage.getConfig(tenantId, configName);
    if (!existing) {
      return { success: false, error: 'Configuration not found', code: 'CONFIG_NOT_FOUND' };
    }

    const signalConfig = existing[signal];
    if (!signalConfig) {
      return { success: false, error: `Signal ${signal} not configured`, code: 'SIGNAL_NOT_CONFIGURED' };
    }

    signalConfig.exporters = signalConfig.exporters.filter(e => e.type !== exporterType);
    existing.updatedAt = new Date().toISOString();

    await this.storage.saveConfig(existing);
    return { success: true, data: existing };
  }

  // ===========================================================================
  // SDK Configuration Generation
  // ===========================================================================

  generateOtelEnvVars(config: TelemetryConfig): Record<string, string> {
    const envVars: Record<string, string> = {};

    if (config.tracing?.enabled) {
      envVars.OTEL_SERVICE_NAME = config.tracing.serviceName;
      if (config.tracing.serviceVersion) {
        envVars.OTEL_SERVICE_VERSION = config.tracing.serviceVersion;
      }
      if (config.tracing.environment) {
        envVars.OTEL_RESOURCE_ATTRIBUTES = `deployment.environment=${config.tracing.environment}`;
      }
      envVars.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio';
      envVars.OTEL_TRACES_SAMPLER_ARG = String(config.tracing.sampleRate);

      const traceExporter = config.tracing.exporters[0];
      if (traceExporter) {
        envVars.OTEL_TRACES_EXPORTER = this.getExporterName(traceExporter.type);
        if (traceExporter.endpoint) {
          envVars.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = traceExporter.endpoint;
        }
        if (traceExporter.headers) {
          envVars.OTEL_EXPORTER_OTLP_TRACES_HEADERS = Object.entries(traceExporter.headers)
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        }
      }

      if (config.tracing.propagators) {
        envVars.OTEL_PROPAGATORS = config.tracing.propagators.join(',');
      }
    }

    if (config.metrics?.enabled) {
      const metricsExporter = config.metrics.exporters[0];
      if (metricsExporter) {
        envVars.OTEL_METRICS_EXPORTER = this.getExporterName(metricsExporter.type);
        if (metricsExporter.endpoint) {
          envVars.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = metricsExporter.endpoint;
        }
      }
      envVars.OTEL_METRIC_EXPORT_INTERVAL = String(config.metrics.collectionIntervalMs);
    }

    if (config.logging?.enabled) {
      const logsExporter = config.logging.exporters[0];
      if (logsExporter) {
        envVars.OTEL_LOGS_EXPORTER = this.getExporterName(logsExporter.type);
        if (logsExporter.endpoint) {
          envVars.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = logsExporter.endpoint;
        }
      }
    }

    return envVars;
  }

  private getExporterName(type: TelemetryExporterConfig['type']): string {
    const mapping: Record<string, string> = {
      otlp: 'otlp',
      'otlp-http': 'otlp',
      'otlp-grpc': 'otlp',
      jaeger: 'jaeger',
      zipkin: 'zipkin',
      prometheus: 'prometheus',
      console: 'console',
      datadog: 'otlp',
      splunk: 'otlp',
      newrelic: 'otlp',
    };
    return mapping[type] ?? 'otlp';
  }

  generateCollectorConfig(config: TelemetryConfig): object {
    const receivers: Record<string, unknown> = {
      otlp: {
        protocols: {
          grpc: { endpoint: '0.0.0.0:4317' },
          http: { endpoint: '0.0.0.0:4318' },
        },
      },
    };

    const processors: Record<string, unknown> = {
      batch: {
        timeout: '5s',
        send_batch_size: 1000,
      },
      memory_limiter: {
        check_interval: '1s',
        limit_mib: 2000,
        spike_limit_mib: 400,
      },
    };

    const exporters: Record<string, unknown> = {};
    const pipelines: Record<string, unknown> = {};

    // Add trace exporters and pipeline
    if (config.tracing?.enabled) {
      const traceExporterNames: string[] = [];
      for (const exp of config.tracing.exporters) {
        const name = `${exp.type}_traces`;
        exporters[name] = this.buildExporterConfig(exp);
        traceExporterNames.push(name);
      }
      if (traceExporterNames.length > 0) {
        pipelines['traces'] = {
          receivers: ['otlp'],
          processors: ['memory_limiter', 'batch'],
          exporters: traceExporterNames,
        };
      }
    }

    // Add metrics exporters and pipeline
    if (config.metrics?.enabled) {
      const metricsExporterNames: string[] = [];
      for (const exp of config.metrics.exporters) {
        const name = `${exp.type}_metrics`;
        exporters[name] = this.buildExporterConfig(exp);
        metricsExporterNames.push(name);
      }
      if (metricsExporterNames.length > 0) {
        pipelines['metrics'] = {
          receivers: ['otlp'],
          processors: ['memory_limiter', 'batch'],
          exporters: metricsExporterNames,
        };
      }
    }

    // Add logs exporters and pipeline
    if (config.logging?.enabled) {
      const logsExporterNames: string[] = [];
      for (const exp of config.logging.exporters) {
        const name = `${exp.type}_logs`;
        exporters[name] = this.buildExporterConfig(exp);
        logsExporterNames.push(name);
      }
      if (logsExporterNames.length > 0) {
        pipelines['logs'] = {
          receivers: ['otlp'],
          processors: ['memory_limiter', 'batch'],
          exporters: logsExporterNames,
        };
      }
    }

    return {
      receivers,
      processors,
      exporters,
      service: { pipelines },
    };
  }

  private buildExporterConfig(exp: TelemetryExporterConfig): object {
    const base: Record<string, unknown> = {};

    if (exp.endpoint) {
      base.endpoint = exp.endpoint;
    }
    if (exp.headers) {
      base.headers = exp.headers;
    }
    if (exp.tls) {
      base.tls = {
        insecure: exp.tls.insecure,
        cert_file: exp.tls.certFile,
        key_file: exp.tls.keyFile,
        ca_file: exp.tls.caFile,
      };
    }
    if (exp.compression) {
      base.compression = 'gzip';
    }
    if (exp.timeoutMs) {
      base.timeout = `${exp.timeoutMs}ms`;
    }

    return base;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTelemetryService(config?: TelemetryServiceConfig): TelemetryService {
  return new TelemetryService(config);
}
