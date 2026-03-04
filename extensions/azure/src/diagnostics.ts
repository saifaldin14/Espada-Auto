/**
 * Azure Extension — Diagnostics
 *
 * Event emitter for Azure API call tracing and observability.
 * Built on the shared DiagnosticEmitter from cloud-utils.
 */

import { DiagnosticEmitter, type BaseDiagnosticEvent } from "../../cloud-utils/diagnostics.js";

// =============================================================================
// Types
// =============================================================================

export type AzureDiagnosticEventType =
  | "azure.api.call"
  | "azure.api.error"
  | "azure.credential.refresh"
  | "azure.resource.change";

export type AzureDiagnosticEvent = BaseDiagnosticEvent & {
  type: AzureDiagnosticEventType;
  subscriptionId?: string;
  resourceGroup?: string;
  region?: string;
};

export type AzureDiagnosticListener = (event: AzureDiagnosticEvent) => void;

// =============================================================================
// Singleton emitter
// =============================================================================

const emitter = new DiagnosticEmitter<AzureDiagnosticEvent>();

/** Enable Azure diagnostics tracing. */
export function enableAzureDiagnostics(): void { emitter.enable(); }

/** Disable Azure diagnostics tracing. */
export function disableAzureDiagnostics(): void { emitter.disable(); }

/** Check if diagnostics are enabled. */
export function isAzureDiagnosticsEnabled(): boolean { return emitter.enabled; }

/** Subscribe to diagnostic events. Returns an unsubscribe function. */
export function onAzureDiagnosticEvent(listener: AzureDiagnosticListener): () => void {
  return emitter.on(listener);
}

/** Emit a diagnostic event to all subscribers. */
export function emitAzureDiagnosticEvent(event: Omit<AzureDiagnosticEvent, "timestamp" | "seq">): void {
  emitter.emit(event);
}

const extractAzureErrorStatus = (err: unknown): number | undefined => {
  const e = err as Record<string, unknown>;
  return (e.statusCode ?? e.status) as number | undefined;
};

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
  return emitter.instrument(
    "azure.api.call",
    "azure.api.error",
    service,
    operation,
    fn,
    {
      subscriptionId: options?.subscriptionId,
      resourceGroup: options?.resourceGroup,
      region: options?.region,
      metadata: options?.metadata,
    },
    extractAzureErrorStatus,
  );
}

/** Reset diagnostics state for tests. */
export function resetAzureDiagnosticsForTest(): void {
  emitter.reset();
}
