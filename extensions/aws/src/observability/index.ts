/**
 * AWS Observability Module
 *
 * Provides comprehensive observability support including:
 * - CloudWatch Alarms management
 * - CloudWatch Metrics and custom metrics
 * - CloudWatch Dashboards
 * - CloudWatch Logs and Log Insights
 * - X-Ray tracing and service maps
 * - CloudWatch Synthetics (Canaries)
 * - Anomaly detection
 * - Composite alarms
 */

export { ObservabilityManager, createObservabilityManager } from './manager.js';
export type * from './types.js';
