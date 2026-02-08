/**
 * AWS Diagnostic Events
 *
 * Instrumentation helpers for AWS API call tracing.
 * Enables observability via the diagnostics-otel extension.
 *
 * This module is self-contained to avoid tsconfig rootDir issues.
 */

import { formatErrorMessage, extractErrorCode } from "./retry.js";

/**
 * AWS API call diagnostic event
 */
export type AWSApiCallEvent = {
  type: "aws.api.call";
  ts: number;
  seq: number;
  service: string;
  operation: string;
  region?: string;
  durationMs: number;
  success: true;
  requestId?: string;
  httpStatusCode?: number;
};

/**
 * AWS API error diagnostic event
 */
export type AWSApiErrorEvent = {
  type: "aws.api.error";
  ts: number;
  seq: number;
  service: string;
  operation: string;
  region?: string;
  durationMs: number;
  success: false;
  error: string;
  errorCode?: string;
  httpStatusCode?: number;
  retryable?: boolean;
};

/**
 * AWS credential refresh diagnostic event
 */
export type AWSCredentialRefreshEvent = {
  type: "aws.credential.refresh";
  ts: number;
  seq: number;
  source: string;
  profile?: string;
  region?: string;
  durationMs: number;
  success: boolean;
  error?: string;
};

/**
 * AWS resource change diagnostic event
 */
export type AWSResourceChangeEvent = {
  type: "aws.resource.change";
  ts: number;
  seq: number;
  service: string;
  operation: "create" | "update" | "delete";
  resourceType: string;
  resourceId?: string;
  region?: string;
  durationMs: number;
  success: boolean;
  error?: string;
};

/**
 * Combined AWS diagnostic event type
 */
export type AWSApiEvent =
  | AWSApiCallEvent
  | AWSApiErrorEvent
  | AWSCredentialRefreshEvent
  | AWSResourceChangeEvent;

/**
 * Event input without auto-generated fields (ts and seq)
 */
export type AWSApiCallEventInput = Omit<AWSApiCallEvent, "ts" | "seq">;
export type AWSApiErrorEventInput = Omit<AWSApiErrorEvent, "ts" | "seq">;
export type AWSCredentialRefreshEventInput = Omit<AWSCredentialRefreshEvent, "ts" | "seq">;
export type AWSResourceChangeEventInput = Omit<AWSResourceChangeEvent, "ts" | "seq">;

export type AWSApiEventInput =
  | AWSApiCallEventInput
  | AWSApiErrorEventInput
  | AWSCredentialRefreshEventInput
  | AWSResourceChangeEventInput;

/**
 * Diagnostic event listener type
 */
type DiagnosticEventListener = (event: AWSApiEvent) => void;

/**
 * Registered listeners for AWS diagnostic events
 */
const listeners = new Set<DiagnosticEventListener>();

/**
 * Sequence counter for events
 */
let seq = 0;

/**
 * Whether AWS diagnostics are enabled
 */
let diagnosticsEnabled = false;

/**
 * Enable AWS diagnostics
 */
export function enableAWSDiagnostics(): void {
  diagnosticsEnabled = true;
}

/**
 * Disable AWS diagnostics
 */
export function disableAWSDiagnostics(): void {
  diagnosticsEnabled = false;
}

/**
 * Check if AWS diagnostics are enabled
 */
export function isAWSDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled;
}

/**
 * Set diagnostics enabled state
 */
export function setAWSDiagnosticsEnabled(enabled: boolean): void {
  diagnosticsEnabled = enabled;
}

/**
 * Emit an AWS diagnostic event
 */
export function emitAWSDiagnosticEvent(event: AWSApiEventInput): void {
  if (!diagnosticsEnabled) return;

  const enriched = {
    ...event,
    seq: ++seq,
    ts: Date.now(),
  } as AWSApiEvent;

  listeners.forEach((listener) => {
    try {
      listener(enriched);
    } catch {
      // Ignore listener failures
    }
  });
}

/**
 * Subscribe to AWS diagnostic events
 */
export function onAWSDiagnosticEvent(listener: DiagnosticEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Instrumented AWS API call wrapper
 *
 * @example
 * ```typescript
 * const result = await instrumentedAWSCall(
 *   "ec2",
 *   "DescribeInstances",
 *   () => ec2Client.send(new DescribeInstancesCommand({})),
 *   { region: "us-east-1" }
 * );
 * ```
 */
export async function instrumentedAWSCall<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>,
  options?: {
    region?: string;
  },
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;

    // Extract metadata from AWS SDK v3 response
    const metadata = (result as { $metadata?: { requestId?: string; httpStatusCode?: number } })?.$metadata;
    const requestId = metadata?.requestId;
    const httpStatusCode = metadata?.httpStatusCode;

    emitAWSDiagnosticEvent({
      type: "aws.api.call",
      service,
      operation,
      region: options?.region,
      durationMs,
      success: true,
      requestId,
      httpStatusCode,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorCode = extractErrorCode(err);
    const httpStatusCode = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

    emitAWSDiagnosticEvent({
      type: "aws.api.error",
      service,
      operation,
      region: options?.region,
      durationMs,
      success: false,
      error: formatErrorMessage(err),
      errorCode,
      httpStatusCode,
      retryable: isRetryableError(err),
    });

    throw err;
  }
}

/**
 * Check if error is retryable
 */
function isRetryableError(err: unknown): boolean {
  const code = extractErrorCode(err);
  if (!code) return false;

  const retryableCodes = new Set([
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailable",
    "InternalError",
  ]);

  return retryableCodes.has(code);
}

/**
 * Emit a credential refresh event
 */
export function emitCredentialRefreshEvent(params: {
  source: string;
  profile?: string;
  region?: string;
  durationMs: number;
  success: boolean;
  error?: string;
}): void {
  emitAWSDiagnosticEvent({
    type: "aws.credential.refresh",
    ...params,
  });
}

/**
 * Emit a resource change event
 */
export function emitResourceChangeEvent(params: {
  service: string;
  operation: "create" | "update" | "delete";
  resourceType: string;
  resourceId?: string;
  region?: string;
  durationMs: number;
  success: boolean;
  error?: string;
}): void {
  emitAWSDiagnosticEvent({
    type: "aws.resource.change",
    ...params,
  });
}

/**
 * Create an instrumented AWS client wrapper
 *
 * @example
 * ```typescript
 * const instrumented = createInstrumentedClient("ec2", ec2Client, { region: "us-east-1" });
 * const result = await instrumented.send(new DescribeInstancesCommand({}));
 * ```
 */
export function createInstrumentedClient<T extends { send: (command: unknown) => Promise<unknown> }>(
  service: string,
  client: T,
  options?: { region?: string },
): T {
  if (!diagnosticsEnabled) return client;

  return new Proxy(client, {
    get(target, prop) {
      if (prop === "send") {
        return async (command: unknown) => {
          const operation = (command as { constructor?: { name?: string } })?.constructor?.name?.replace("Command", "") ?? "Unknown";
          return instrumentedAWSCall(service, operation, () => target.send(command), options);
        };
      }
      return (target as Record<string | symbol, unknown>)[prop];
    },
  }) as T;
}

/**
 * Reset diagnostic state for testing
 */
export function resetAWSDiagnosticsForTest(): void {
  seq = 0;
  listeners.clear();
  diagnosticsEnabled = false;
}
