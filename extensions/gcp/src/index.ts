/**
 * @espada/gcp — Barrel Exports
 *
 * Re-exports core utility modules for convenient single-import access.
 */

// Core types
export type {
  GcpRetryOptions,
  GcpRegion,
} from "./types.js";

// Retry utilities
export { withGcpRetry, createGcpRetryRunner, shouldRetryGcpError, formatErrorMessage } from "./retry.js";

// Circuit breaker utilities
export {
  getGcpServiceBreaker,
  isGcpServiceAvailable,
  withGcpCircuitBreaker,
  getGcpCircuitBreakerSnapshots,
  getGcpCircuitBreakerHealthSummary,
  resetAllGcpBreakers,
  CircuitOpenError as GcpCircuitOpenError,
  type CircuitState as GcpCircuitState,
  type CircuitBreakerConfig as GcpCircuitBreakerConfig,
  type CircuitBreakerSnapshot as GcpCircuitBreakerSnapshot,
} from "./circuit-breaker.js";

// Diagnostics
export { emitGcpDiagnosticEvent, onGcpDiagnosticEvent, enableGcpDiagnostics, disableGcpDiagnostics } from "./diagnostics.js";

// Progress
export { createGcpProgress, createMultiStepProgress } from "./progress.js";
