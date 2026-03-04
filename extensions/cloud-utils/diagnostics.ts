/**
 * Cloud Extensions — Shared Diagnostic Emitter
 *
 * Generic, provider-agnostic diagnostic event emitter for cloud API call
 * tracing and observability. Each provider (AWS, Azure, GCP) instantiates
 * a `DiagnosticEmitter<TEvent>` parameterized on its own event shape.
 *
 * This eliminates the copy-pasted enable/disable/emit/subscribe/instrument
 * boilerplate across providers while preserving full type safety.
 *
 * @module
 */

// =============================================================================
// Base Types
// =============================================================================

/** Minimum shape every diagnostic event must satisfy. */
export type BaseDiagnosticEvent = {
  type: string;
  timestamp: number;
  seq: number;
  service: string;
  operation: string;
  durationMs?: number;
  statusCode?: number;
  requestId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type DiagnosticListener<T> = (event: T) => void;

/**
 * Extract the error status code from a provider-specific error object.
 * Each provider supplies its own extractor because the SDK error shapes differ.
 */
export type ErrorStatusExtractor = (err: unknown) => number | undefined;

// =============================================================================
// DiagnosticEmitter
// =============================================================================

/**
 * A generic diagnostic event emitter parameterized on the event shape.
 *
 * @example
 * ```ts
 * // Azure usage
 * const azureDiag = new DiagnosticEmitter<AzureDiagnosticEvent>();
 * azureDiag.enable();
 * azureDiag.emit({ type: "azure.api.call", service: "compute", operation: "listVMs", ... });
 * ```
 */
export class DiagnosticEmitter<TEvent extends BaseDiagnosticEvent> {
  private _enabled = false;
  private _seq = 0;
  private readonly _listeners = new Set<DiagnosticListener<TEvent>>();

  /** Enable diagnostic event emission. */
  enable(): void {
    this._enabled = true;
  }

  /** Disable diagnostic event emission. Events are silently dropped. */
  disable(): void {
    this._enabled = false;
  }

  /** Check if diagnostics are currently enabled. */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Programmatic toggle (useful for config-driven enable/disable). */
  setEnabled(value: boolean): void {
    this._enabled = value;
  }

  /**
   * Subscribe to diagnostic events. Returns an unsubscribe function.
   */
  on(listener: DiagnosticListener<TEvent>): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Emit a diagnostic event to all subscribers.
   * Automatically enriches with `timestamp` and `seq`.
   * No-op when diagnostics are disabled.
   */
  emit(event: Omit<TEvent, "timestamp" | "seq">): void {
    if (!this._enabled) return;

    const fullEvent: TEvent = {
      ...event,
      timestamp: Date.now(),
      seq: ++this._seq,
    } as TEvent;

    for (const listener of this._listeners) {
      try {
        listener(fullEvent);
      } catch {
        // Swallow listener errors to avoid cascading failures
      }
    }
  }

  /**
   * Wrap an async function with diagnostic instrumentation.
   *
   * Emits a success event on completion, or an error event on failure.
   * When diagnostics are disabled, calls `fn()` directly (no overhead).
   *
   * @param callType  - Event type for success (e.g. "azure.api.call")
   * @param errorType - Event type for failure (e.g. "azure.api.error")
   * @param service   - Service name (e.g. "compute", "s3")
   * @param operation - Operation name (e.g. "listVMs", "putObject")
   * @param fn        - The async function to instrument
   * @param extra     - Additional provider-specific fields to merge
   * @param extractErrorStatus - Provider-specific error status extractor
   */
  async instrument<T>(
    callType: TEvent["type"],
    errorType: TEvent["type"],
    service: string,
    operation: string,
    fn: () => Promise<T>,
    extra?: Partial<Omit<TEvent, "type" | "timestamp" | "seq" | "service" | "operation" | "durationMs" | "error" | "statusCode">>,
    extractErrorStatus?: ErrorStatusExtractor,
  ): Promise<T> {
    if (!this._enabled) return fn();

    const start = Date.now();

    try {
      const result = await fn();

      this.emit({
        type: callType,
        service,
        operation,
        durationMs: Date.now() - start,
        ...extra,
      } as Omit<TEvent, "timestamp" | "seq">);

      return result;
    } catch (error) {
      const err = error as Record<string, unknown>;

      this.emit({
        type: errorType,
        service,
        operation,
        durationMs: Date.now() - start,
        statusCode: extractErrorStatus?.(error),
        error: (err.message ?? String(error)) as string,
        ...extra,
      } as Omit<TEvent, "timestamp" | "seq">);

      throw error;
    }
  }

  /** Reset all state (for tests). */
  reset(): void {
    this._enabled = false;
    this._seq = 0;
    this._listeners.clear();
  }
}
