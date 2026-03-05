/**
 * Global accessor for the enterprise secrets manager.
 *
 * Follows the same pattern as `setGatewayRateLimitStore` / `setGatewayTaskQueue`:
 * a module-level singleton that can be set during enterprise bootstrap and
 * queried from anywhere in the process (e.g. provider key resolution).
 *
 */

import type { SecretsManager } from "./secrets/index.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("enterprise").child("secrets-accessor");

/** Timeout in ms for individual secrets lookups. */
const SECRETS_TIMEOUT_MS = 250;

let _secretsManager: SecretsManager | null = null;

/** Wrap a promise with a timeout — resolves to null on deadline. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log.warn("secrets lookup timed out", { timeoutMs: ms });
      resolve(null);
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Set the enterprise secrets manager (called during gateway startup). */
export function setGatewaySecretsManager(mgr: SecretsManager): void {
  _secretsManager = mgr;
}

/** Get the enterprise secrets manager, or null if not configured. */
export function getGatewaySecretsManager(): SecretsManager | null {
  return _secretsManager;
}

/**
 * Attempt to resolve a provider API key from the enterprise secrets manager.
 * Returns null if secrets manager is not configured or the key is not found.
 */
export async function resolveProviderKeyFromSecrets(
  provider: string,
): Promise<{ apiKey: string; source: string } | null> {
  if (!_secretsManager) return null;

  // Try provider-specific key name patterns
  const candidates = [
    `provider/${provider}/api-key`,
    `provider/${provider}/apiKey`,
    `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`,
  ];

  for (const key of candidates) {
    try {
      const secret = await withTimeout(_secretsManager.get(key), SECRETS_TIMEOUT_MS);
      if (secret?.value) {
        log.debug("provider key resolved from secrets", { provider, key });
        return { apiKey: secret.value, source: `secrets:${key}` };
      }
    } catch (err) {
      log.warn("secrets lookup failed", { provider, key, error: String(err) });
    }
  }

  return null;
}
