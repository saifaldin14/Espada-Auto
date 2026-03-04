/**
 * AWS Extension — Diagnostics
 *
 * Event emitter for AWS API call tracing and observability.
 * Built on the shared DiagnosticEmitter from cloud-utils.
 */

import { DiagnosticEmitter, type BaseDiagnosticEvent } from "../../cloud-utils/diagnostics.js";
import { formatErrorMessage, extractErrorCode } from "./retry.js";

// =============================================================================
// Types
// =============================================================================

/** AWS API call diagnostic event */
export type AWSApiCallEvent = BaseDiagnosticEvent & {
  type: "aws.api.call";
  region?: string;
  success: true;
  requestId?: string;
  httpStatusCode?: number;
};

/** AWS API error diagnostic event */
export type AWSApiErrorEvent = BaseDiagnosticEvent & {
  type: "aws.api.error";
  region?: string;
  success: false;
  error: string;
  errorCode?: string;
  httpStatusCode?: number;
  retryable?: boolean;
};

/** AWS credential refresh diagnostic event */
export type AWSCredentialRefreshEvent = BaseDiagnosticEvent & {
  type: "aws.credential.refresh";
  source: string;
  profile?: string;
  region?: string;
  success: boolean;
  error?: string;
};

/** AWS resource change diagnostic event */
export type AWSResourceChangeEvent = BaseDiagnosticEvent & {
  type: "aws.resource.change";
  operation: "create" | "update" | "delete";
  resourceType: string;
  resourceId?: string;
  region?: string;
  success: boolean;
  error?: string;
};

/** Combined AWS diagnostic event type */
export type AWSApiEvent =
  | AWSApiCallEvent
  | AWSApiErrorEvent
  | AWSCredentialRefreshEvent
  | AWSResourceChangeEvent;

/** Event input without auto-generated fields (timestamp and seq) */
export type AWSApiCallEventInput = Omit<AWSApiCallEvent, "timestamp" | "seq">;
export type AWSApiErrorEventInput = Omit<AWSApiErrorEvent, "timestamp" | "seq">;
export type AWSCredentialRefreshEventInput = Omit<AWSCredentialRefreshEvent, "timestamp" | "seq">;
export type AWSResourceChangeEventInput = Omit<AWSResourceChangeEvent, "timestamp" | "seq">;

export type AWSApiEventInput =
  | AWSApiCallEventInput
  | AWSApiErrorEventInput
  | AWSCredentialRefreshEventInput
  | AWSResourceChangeEventInput;

// =============================================================================
// Singleton emitter
// =============================================================================

const emitter = new DiagnosticEmitter<AWSApiEvent>();

/** Enable AWS diagnostics */
export function enableAWSDiagnostics(): void { emitter.enable(); }

/** Disable AWS diagnostics */
export function disableAWSDiagnostics(): void { emitter.disable(); }

/** Check if AWS diagnostics are enabled */
export function isAWSDiagnosticsEnabled(): boolean { return emitter.enabled; }

/** Set diagnostics enabled state */
export function setAWSDiagnosticsEnabled(enabled: boolean): void { emitter.setEnabled(enabled); }

/** Emit an AWS diagnostic event */
export function emitAWSDiagnosticEvent(event: AWSApiEventInput): void {
  emitter.emit(event);
}

/** Subscribe to AWS diagnostic events */
export function onAWSDiagnosticEvent(listener: (event: AWSApiEvent) => void): () => void {
  return emitter.on(listener);
}

// =============================================================================
// Instrumentation
// =============================================================================

const extractAWSErrorStatus = (err: unknown): number | undefined => {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
};

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

    emitAWSDiagnosticEvent({
      type: "aws.api.call",
      service,
      operation,
      region: options?.region,
      durationMs,
      success: true,
      requestId: metadata?.requestId,
      httpStatusCode: metadata?.httpStatusCode,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;

    emitAWSDiagnosticEvent({
      type: "aws.api.error",
      service,
      operation,
      region: options?.region,
      durationMs,
      success: false,
      error: formatErrorMessage(err),
      errorCode: extractErrorCode(err),
      httpStatusCode: extractAWSErrorStatus(err),
      retryable: isRetryableError(err),
    });

    throw err;
  }
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
    service: "sts",
    operation: "credential-refresh",
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
  if (!emitter.enabled) return client;

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

/** Reset diagnostic state for testing */
export function resetAWSDiagnosticsForTest(): void {
  emitter.reset();
}
