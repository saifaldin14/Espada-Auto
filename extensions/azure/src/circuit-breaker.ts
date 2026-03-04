/**
 * Azure Extension — Circuit Breaker for Cloud API Calls
 *
 * Thin provider-specific registry layer over the shared circuit breaker.
 * Scopes breakers by Azure subscriptionId.
 *
 * @module
 */

import { shouldRetryAzureError } from "./retry.js";
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
// Azure-scoped registry
// =============================================================================

const registry = createProviderBreakerRegistry({
  prefix: "azure",
  label: "Azure",
  defaultShouldTrip: shouldRetryAzureError,
});

/**
 * Get or create a circuit breaker for a specific Azure service.
 * Breaker names: `azure:<service>` or `azure:<service>:<subscriptionId>`.
 */
export function getAzureServiceBreaker(service: string, subscriptionId?: string): CircuitBreaker {
  return registry.getServiceBreaker(service, subscriptionId);
}

export function isAzureServiceAvailable(service: string, subscriptionId?: string): boolean {
  return registry.isServiceAvailable(service, subscriptionId);
}

export async function withAzureCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  opts?: { subscriptionId?: string },
): Promise<T> {
  return registry.withCircuitBreaker(service, fn, { scope: opts?.subscriptionId });
}

export function getAzureCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  return registry.getSnapshots();
}

export function getAzureCircuitBreakerHealthSummary() {
  return registry.getHealthSummary();
}

export function resetAllAzureBreakers(): void {
  registry.resetAll();
}
