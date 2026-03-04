/**
 * Cross-provider cloud command telemetry normalization and in-memory sink.
 */

export type CloudCommandProvider =
  | "aws"
  | "azure"
  | "terraform"
  | "kubernetes"
  | "pulumi";

export type CloudCommandErrorType =
  | "timeout"
  | "not-found"
  | "permission"
  | "auth"
  | "rate-limit"
  | "validation"
  | "unknown";

export interface CloudCommandTelemetryInput {
  provider: CloudCommandProvider;
  command: string;
  commandRedacted?: string;
  success: boolean;
  exitCode?: number;
  durationMs?: number;
  errorType?: CloudCommandErrorType;
  retryable?: boolean;
  outputTruncated?: boolean;
  attempt?: number;
  maxAttempts?: number;
  timestamp?: string;
}

export interface NormalizedCloudCommandTelemetryEvent {
  kind: "cloud-command";
  version: 1;
  provider: CloudCommandProvider;
  command: string;
  commandRedacted: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
  errorType?: CloudCommandErrorType;
  retryable: boolean;
  outputTruncated: boolean;
  attempt?: number;
  maxAttempts?: number;
  timestamp: string;
}

export interface CloudCommandTelemetrySummary {
  total: number;
  success: number;
  failed: number;
  retryableFailures: number;
  providerCounts: Record<CloudCommandProvider, number>;
  avgDurationMs: number;
}

export interface CloudCommandTelemetrySinkOptions {
  maxBufferSize?: number;
  sampleRate?: number;
  onEvent?: (event: NormalizedCloudCommandTelemetryEvent) => void;
  now?: () => Date;
  random?: () => number;
}

export interface CloudCommandTelemetrySink {
  handle: (event: CloudCommandTelemetryInput) => void;
  getBuffer: () => NormalizedCloudCommandTelemetryEvent[];
  getSummary: () => CloudCommandTelemetrySummary;
  clear: () => void;
}

function defaultProviderCounts(): Record<CloudCommandProvider, number> {
  return {
    aws: 0,
    azure: 0,
    terraform: 0,
    kubernetes: 0,
    pulumi: 0,
  };
}

export function normalizeCloudCommandTelemetry(
  event: CloudCommandTelemetryInput,
  now: () => Date = () => new Date(),
): NormalizedCloudCommandTelemetryEvent {
  return {
    kind: "cloud-command",
    version: 1,
    provider: event.provider,
    command: event.command,
    commandRedacted: event.commandRedacted ?? event.command,
    success: event.success,
    exitCode: event.exitCode ?? (event.success ? 0 : 1),
    durationMs: event.durationMs ?? 0,
    errorType: event.errorType,
    retryable: event.retryable ?? false,
    outputTruncated: event.outputTruncated ?? false,
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    timestamp: event.timestamp ?? now().toISOString(),
  };
}

export function createCloudCommandTelemetrySink(
  options: CloudCommandTelemetrySinkOptions = {},
): CloudCommandTelemetrySink {
  const maxBufferSize = options.maxBufferSize ?? 500;
  const sampleRate = options.sampleRate ?? 1;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;

  const buffer: NormalizedCloudCommandTelemetryEvent[] = [];
  const providerCounts = defaultProviderCounts();

  let total = 0;
  let success = 0;
  let failed = 0;
  let retryableFailures = 0;
  let durationSumMs = 0;

  const handle = (input: CloudCommandTelemetryInput): void => {
    if (sampleRate < 1 && random() > sampleRate) {
      return;
    }

    const event = normalizeCloudCommandTelemetry(input, now);

    total += 1;
    durationSumMs += event.durationMs;
    providerCounts[event.provider] += 1;

    if (event.success) {
      success += 1;
    } else {
      failed += 1;
      if (event.retryable) retryableFailures += 1;
    }

    buffer.push(event);
    if (buffer.length > maxBufferSize) {
      buffer.splice(0, buffer.length - maxBufferSize);
    }

    if (options.onEvent) {
      try {
        options.onEvent(event);
      } catch {
        // Ignore sink consumer errors
      }
    }
  };

  const getBuffer = (): NormalizedCloudCommandTelemetryEvent[] => [...buffer];

  const getSummary = (): CloudCommandTelemetrySummary => ({
    total,
    success,
    failed,
    retryableFailures,
    providerCounts: { ...providerCounts },
    avgDurationMs: total > 0 ? durationSumMs / total : 0,
  });

  const clear = (): void => {
    buffer.length = 0;
    total = 0;
    success = 0;
    failed = 0;
    retryableFailures = 0;
    durationSumMs = 0;
    const defaults = defaultProviderCounts();
    providerCounts.aws = defaults.aws;
    providerCounts.azure = defaults.azure;
    providerCounts.terraform = defaults.terraform;
    providerCounts.kubernetes = defaults.kubernetes;
    providerCounts.pulumi = defaults.pulumi;
  };

  return {
    handle,
    getBuffer,
    getSummary,
    clear,
  };
}
