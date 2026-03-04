/**
 * GCP Extension — Diagnostics
 *
 * Event emitter for GCP API call tracing and observability.
 * Built on the shared DiagnosticEmitter from cloud-utils.
 */

import { DiagnosticEmitter, type BaseDiagnosticEvent } from "../../cloud-utils/diagnostics.js";

// =============================================================================
// Types
// =============================================================================

export type GcpDiagnosticEventType =
  | "gcp.api.call"
  | "gcp.api.error"
  | "gcp.credential.refresh"
  | "gcp.resource.change";

export type GcpDiagnosticEvent = BaseDiagnosticEvent & {
  type: GcpDiagnosticEventType;
  project?: string;
  region?: string;
  zone?: string;
};

export type GcpDiagnosticListener = (event: GcpDiagnosticEvent) => void;

// =============================================================================
// Singleton emitter
// =============================================================================

const emitter = new DiagnosticEmitter<GcpDiagnosticEvent>();

/** Enable GCP diagnostics tracing. */
export function enableGcpDiagnostics(): void { emitter.enable(); }

/** Disable GCP diagnostics tracing. */
export function disableGcpDiagnostics(): void { emitter.disable(); }

/** Check if diagnostics are enabled. */
export function isGcpDiagnosticsEnabled(): boolean { return emitter.enabled; }

/** Subscribe to diagnostic events. Returns an unsubscribe function. */
export function onGcpDiagnosticEvent(listener: GcpDiagnosticListener): () => void {
  return emitter.on(listener);
}

/** Emit a diagnostic event to all subscribers. */
export function emitGcpDiagnosticEvent(event: Omit<GcpDiagnosticEvent, "timestamp" | "seq">): void {
  emitter.emit(event);
}

const extractGcpErrorStatus = (err: unknown): number | undefined => {
  const e = err as Record<string, unknown>;
  return (e.statusCode ?? e.status ?? e.code) as number | undefined;
};

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
  return emitter.instrument(
    "gcp.api.call",
    "gcp.api.error",
    service,
    operation,
    fn,
    {
      project: options?.project,
      region: options?.region,
      zone: options?.zone,
      metadata: options?.metadata,
    },
    extractGcpErrorStatus,
  );
}

/** Reset diagnostics state for tests. */
export function resetGcpDiagnosticsForTest(): void {
  emitter.reset();
}
