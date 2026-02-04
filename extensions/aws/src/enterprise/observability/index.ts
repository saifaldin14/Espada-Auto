/**
 * Observability Module Index
 *
 * Exports all observability features including OpenTelemetry integration,
 * deployment metrics, anomaly detection, alerting, and third-party integrations.
 */

// Types
export type {
  // Telemetry
  TelemetrySignalType,
  TelemetryExporterType,
  TelemetryExporterConfig,
  TracingConfig,
  MetricsConfig,
  LoggingConfig,
  TelemetryConfig,
  // Deployment Metrics
  DeploymentStatus,
  DeploymentMetric,
  DeploymentFrequencyMetric,
  LeadTimeMetric,
  MeanTimeToRecoveryMetric,
  ChangeFailureRateMetric,
  // Dashboards
  WidgetType,
  DashboardWidget,
  Dashboard,
  // Anomaly Detection
  AnomalyType,
  AnomalySeverity,
  AnomalyDetectionModel,
  DetectedAnomaly,
  // Alerting
  AlertConditionOperator,
  AlertState,
  AlertCondition,
  AlertNotificationChannel,
  AlertRule,
  AlertIncident,
  // Integrations
  ObservabilityProvider,
  DatadogIntegration,
  SplunkIntegration,
  NewRelicIntegration,
  ObservabilityIntegrationConfig,
  // Results
  ObservabilityResult,
} from './types.js';

// Telemetry Service
export {
  TelemetryService,
  createTelemetryService,
  type TelemetryStorage,
  type TelemetryServiceConfig,
} from './telemetry.js';

// Deployment Metrics Service
export {
  DeploymentMetricsService,
  createDeploymentMetricsService,
  type MetricsStorage,
  type DeploymentMetricsServiceConfig,
} from './metrics.js';

// Anomaly Detection Service
export {
  AnomalyDetectionService,
  createAnomalyDetectionService,
  type AnomalyStorage,
  type AnomalyServiceConfig,
} from './anomaly.js';

// Alerting Service
export {
  AlertingService,
  createAlertingService,
  type AlertStorage,
  type AlertServiceConfig,
  type NotificationSender,
} from './alerting.js';

// Integration Service
export {
  ObservabilityIntegrationService,
  createObservabilityIntegrationService,
  type IntegrationStorage,
  type IntegrationServiceConfig,
} from './integrations.js';

// =============================================================================
// Composite Observability Service
// =============================================================================

import { TelemetryService, createTelemetryService, type TelemetryServiceConfig } from './telemetry.js';
import { DeploymentMetricsService, createDeploymentMetricsService, type DeploymentMetricsServiceConfig } from './metrics.js';
import { AnomalyDetectionService, createAnomalyDetectionService, type AnomalyServiceConfig } from './anomaly.js';
import { AlertingService, createAlertingService, type AlertServiceConfig } from './alerting.js';
import { ObservabilityIntegrationService, createObservabilityIntegrationService, type IntegrationServiceConfig } from './integrations.js';

export interface ObservabilityConfig {
  telemetry?: TelemetryServiceConfig;
  metrics?: DeploymentMetricsServiceConfig;
  anomaly?: AnomalyServiceConfig;
  alerting?: AlertServiceConfig;
  integrations?: IntegrationServiceConfig;
}

export interface ObservabilityServices {
  telemetry: TelemetryService;
  metrics: DeploymentMetricsService;
  anomaly: AnomalyDetectionService;
  alerting: AlertingService;
  integrations: ObservabilityIntegrationService;
  shutdown: () => void;
}

/**
 * Creates all observability services with proper dependencies
 */
export function createObservabilityServices(config?: ObservabilityConfig): ObservabilityServices {
  const telemetry = createTelemetryService(config?.telemetry);
  const metrics = createDeploymentMetricsService(config?.metrics);
  const anomaly = createAnomalyDetectionService(config?.anomaly);
  const alerting = createAlertingService(config?.alerting);
  const integrations = createObservabilityIntegrationService(config?.integrations);

  return {
    telemetry,
    metrics,
    anomaly,
    alerting,
    integrations,
    shutdown: () => {
      alerting.stopAllEvaluations();
    },
  };
}
