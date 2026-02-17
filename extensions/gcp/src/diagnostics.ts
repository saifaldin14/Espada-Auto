/**
 * GCP Extension — Diagnostics
 *
 * Event emitter for GCP API call tracing and observability.
 */

// =============================================================================
// Types
// =============================================================================

export type GcpDiagnosticEventType =
  | "gcp.api.call"
  | "gcp.api.error"
  | "gcp.credential.refresh"
  | "gcp.resource.change";

export type GcpDiagnosticEvent = {
  type: GcpDiagnosticEventType;
  timestamp: number;
  seq: number;
  service: string;
  operation: string;
  durationMs?: number;
  project?: string;
  region?: string;
  zone?: string;
  statusCode?: number;
  requestId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type GcpDiagnosticListener = (event: GcpDiagnosticEvent) => void;

// =============================================================================
// Global State
// =============================================================================

let diagnosticsEnabled = false;
let seq = 0;
const listeners = new Set<GcpDiagnosticListener>();

// =============================================================================
// Public API
// =============================================================================

/** Enable GCP diagnostics tracing. */
export function enableGcpDiagnostics(): void {
  diagnosticsEnabled = true;
}

/** Disable GCP diagnostics tracing. */
export function disableGcpDiagnostics(): void {
  diagnosticsEnabled = false;
}

/** Check if diagnostics are enabled. */
export function isGcpDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled;
}

/** Subscribe to diagnostic events. Returns an unsubscribe function. */
export function onGcpDiagnosticEvent(listener: GcpDiagnosticListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Emit a diagnostic event to all subscribers. */
export function emitGcpDiagnosticEvent(event: Omit<GcpDiagnosticEvent, "timestamp" | "seq">): void {
  if (!diagnosticsEnabled) return;

  const fullEvent: GcpDiagnosticEvent = {
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
 * Wrap a GCP API call with diagnostic instrumentation.
 */
export async function instrumentedGcpCall<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>,
  options?: {
    project?: string;
    region?: string;
    zone?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<T> {
  if (!diagnosticsEnabled) return fn();

  const start = Date.now();

  try {
    const result = await fn();

    emitGcpDiagnosticEvent({
      type: "gcp.api.call",
      service,
      operation,
      durationMs: Date.now() - start,
      project: options?.project,
      region: options?.region,
      zone: options?.zone,
      metadata: options?.metadata,
    });

    return result;
  } catch (error) {
    const err = error as Record<string, unknown>;

    emitGcpDiagnosticEvent({
      type: "gcp.api.error",
      service,
      operation,
      durationMs: Date.now() - start,
      statusCode: (err.statusCode ?? err.status ?? err.code) as number | undefined,
      error: (err.message ?? String(error)) as string,
      project: options?.project,
      region: options?.region,
      zone: options?.zone,
      metadata: options?.metadata,
    });

    throw error;
  }
}

/**
 * Reset diagnostics state for tests.
 */
export function resetGcpDiagnosticsForTest(): void {
  diagnosticsEnabled = false;
  seq = 0;
  listeners.clear();
}
