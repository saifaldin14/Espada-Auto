/**
 * @espada/incident-view — barrel exports
 */

export type {
  CloudProvider,
  IncidentSource,
  IncidentSeverity,
  IncidentStatus,
  UnifiedIncident,
  RawIncidentInput,
  IncidentFilter,
  IncidentSummary,
  IncidentCorrelationGroup,
  CorrelationReason,
  TimelineEntry,
  IncidentTimeline,
} from "./types.js";

export {
  normalizeAwsAlarm,
  normalizeAwsInsight,
  normalizeAzureAlert,
  normalizeAzureActivityLog,
  normalizeGcpAlertPolicy,
  normalizeGcpUptimeCheck,
  normalizeK8sEvent,
  normalizeCustom,
  normalizeOne,
  normalizeBatch,
} from "./normalizers.js";

export {
  filterIncidents,
  aggregateIncidents,
  correlateIncidents,
  buildTimeline,
  triageIncidents,
} from "./manager.js";

export { createIncidentTools } from "./tools.js";
