/**
 * AWS Extension — Circuit Breaker for Cloud API Calls
 *
 * Thin provider-specific registry layer over the shared circuit breaker.
 * Scopes breakers by AWS region.
 *
 * @module
 */

import { shouldRetryAWSError } from "./retry.js";
import {
  CircuitBreaker,
  CircuitOpenError,
  createProviderBreakerRegistry,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerSnapshot,
} from "../../cloud-utils/circuit-breaker.js";

// Re-export core types so existing consumers don't break
export {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerSnapshot,
};

// =============================================================================
// AWS-scoped registry
// =============================================================================

const registry = createProviderBreakerRegistry({
  prefix: "aws",
  label: "AWS",
  defaultShouldTrip: (err) => shouldRetryAWSError(err, 0),
});

/**
 * Get or create a circuit breaker for a specific AWS service.
 * Breaker names: `aws:<service>` or `aws:<service>:<region>`.
 */
export function getAWSServiceBreaker(service: string, region?: string): CircuitBreaker {
  return registry.getServiceBreaker(service, region);
}

/** Check if an AWS service circuit is currently allowing requests. */
export function isAWSServiceAvailable(service: string, region?: string): boolean {
  return registry.isServiceAvailable(service, region);
}

/** Execute an AWS API call with circuit breaker protection. */
export async function withAWSCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  opts?: { region?: string },
): Promise<T> {
  return registry.withCircuitBreaker(service, fn, { scope: opts?.region });
}

/** Return snapshots of all registered AWS service breakers. */
export function getAWSCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  return registry.getSnapshots();
}

/** Summary suitable for health reporting. */
export function getAWSCircuitBreakerHealthSummary() {
  return registry.getHealthSummary();
}

/** Reset all AWS service breakers (for testing). */
export function resetAllAWSBreakers(): void {
  registry.resetAll();
}
