/**
 * GCP Extension — Circuit Breaker for Cloud API Calls
 *
 * Thin provider-specific registry layer over the shared circuit breaker.
 * Scopes breakers by GCP projectId.
 *
 * @module
 */

import { shouldRetryGcpError } from "./retry.js";
import {
  CircuitBreaker,
  CircuitOpenError,
  createProviderBreakerRegistry,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerSnapshot,
} from "../../cloud-utils/circuit-breaker.js";

export {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerSnapshot,
};

// =============================================================================
// GCP-scoped registry
// =============================================================================

const registry = createProviderBreakerRegistry({
  prefix: "gcp",
  label: "GCP",
  defaultShouldTrip: shouldRetryGcpError,
});

/**
 * Get or create a circuit breaker for a specific GCP service.
 * Breaker names: `gcp:<service>` or `gcp:<service>:<projectId>`.
 */
export function getGcpServiceBreaker(service: string, projectId?: string): CircuitBreaker {
  return registry.getServiceBreaker(service, projectId);
}

export function isGcpServiceAvailable(service: string, projectId?: string): boolean {
  return registry.isServiceAvailable(service, projectId);
}

export async function withGcpCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  opts?: { projectId?: string },
): Promise<T> {
  return registry.withCircuitBreaker(service, fn, { scope: opts?.projectId });
}

export function getGcpCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  return registry.getSnapshots();
}

export function getGcpCircuitBreakerHealthSummary() {
  return registry.getHealthSummary();
}

export function resetAllGcpBreakers(): void {
  registry.resetAll();
}
