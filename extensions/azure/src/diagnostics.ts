/**
 * Azure Extension — Diagnostics
 *
 * Event emitter for Azure API call tracing and observability.
 * Mirrors the AWS diagnostics module pattern.
 */

// =============================================================================
// Types
// =============================================================================

export type AzureDiagnosticEventType =
  | "azure.api.call"
  | "azure.api.error"
  | "azure.credential.refresh"
  | "azure.resource.change";

export type AzureDiagnosticEvent = {
  type: AzureDiagnosticEventType;
  timestamp: number;
  seq: number;
  service: string;
  operation: string;
  durationMs?: number;
  subscriptionId?: string;
  resourceGroup?: string;
  region?: string;
  statusCode?: number;
  requestId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type AzureDiagnosticListener = (event: AzureDiagnosticEvent) => void;

// =============================================================================
// Global State
// =============================================================================

let diagnosticsEnabled = false;
let seq = 0;
const listeners = new Set<AzureDiagnosticListener>();

// =============================================================================
// Public API
// =============================================================================

/** Enable Azure diagnostics tracing. */
export function enableAzureDiagnostics(): void {
  diagnosticsEnabled = true;
}

/** Disable Azure diagnostics tracing. */
export function disableAzureDiagnostics(): void {
  diagnosticsEnabled = false;
}

/** Check if diagnostics are enabled. */
export function isAzureDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled;
}

/** Subscribe to diagnostic events. Returns an unsubscribe function. */
export function onAzureDiagnosticEvent(listener: AzureDiagnosticListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Emit a diagnostic event to all subscribers. */
export function emitAzureDiagnosticEvent(event: Omit<AzureDiagnosticEvent, "timestamp" | "seq">): void {
  if (!diagnosticsEnabled) return;

  const fullEvent: AzureDiagnosticEvent = {
    ...event,
    timestamp: Date.now(),
    seq: ++seq,
  };

  for (const listener of listeners) {
    try {
      listener(fullEvent);
    } catch {
      // Swallow listener errors to avoid cascading failures
    }
  }
}

/**
 * Wrap an Azure API call with diagnostic instrumentation.
 */
export async function instrumentedAzureCall<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>,
  options?: {
    subscriptionId?: string;
    resourceGroup?: string;
    region?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<T> {
  if (!diagnosticsEnabled) return fn();

  const start = Date.now();

  try {
    const result = await fn();

    emitAzureDiagnosticEvent({
      type: "azure.api.call",
      service,
      operation,
      durationMs: Date.now() - start,
      subscriptionId: options?.subscriptionId,
      resourceGroup: options?.resourceGroup,
      region: options?.region,
      metadata: options?.metadata,
    });

    return result;
  } catch (error) {
    const err = error as Record<string, unknown>;

    emitAzureDiagnosticEvent({
      type: "azure.api.error",
      service,
      operation,
      durationMs: Date.now() - start,
      statusCode: (err.statusCode ?? err.status) as number | undefined,
      error: (err.message ?? String(error)) as string,
      subscriptionId: options?.subscriptionId,
      resourceGroup: options?.resourceGroup,
      region: options?.region,
      metadata: options?.metadata,
    });

    throw error;
  }
}

/**
 * Reset diagnostics state for tests.
 */
export function resetAzureDiagnosticsForTest(): void {
  diagnosticsEnabled = false;
  seq = 0;
  listeners.clear();
}
