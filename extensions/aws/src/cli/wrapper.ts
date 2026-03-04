/**
 * AWS CLI Wrapper
 *
 * Provides a robust wrapper around the AWS CLI with:
 * - Automatic retry with exponential backoff
 * - Error parsing and classification
 * - Output parsing for JSON/YAML/text
 * - Profile and region management
 * - Dry-run support
 */

import { spawn } from "node:child_process";
import { which } from "../utils/which.js";
import type {
  AWSCLIOptions,
  AWSCLIResult,
  AWSCLIError,
  AWSCLIErrorType,
  AWSCommandTelemetryEvent,
  AWSCLIConfig,
} from "../types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 120000; // 2 minutes
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024; // 8MB
const RETRYABLE_ERROR_CODES = [
  "Throttling",
  "ThrottlingException",
  "RequestThrottled",
  "RequestThrottledException",
  "ProvisionedThroughputExceededException",
  "TransactionConflictException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "InternalError",
  "InternalServiceError",
  "RequestLimitExceeded",
  "TooManyRequestsException",
  "BandwidthLimitExceeded",
  "RequestTimeout",
  "RequestTimeoutException",
  "IDPCommunicationError",
  "EC2ThrottledException",
];

// =============================================================================
// Error Parser
// =============================================================================

function parseAWSError(stderr: string, stdout: string): AWSCLIError | null {
  // Try to parse JSON error from stdout or stderr
  const errorSources = [stderr, stdout];
  
  for (const source of errorSources) {
    if (!source) continue;
    
    // Try JSON parsing first
    try {
      const parsed = JSON.parse(source);
      if (parsed.Error || parsed.error || parsed.__type) {
        const error = parsed.Error ?? parsed.error ?? parsed;
        return {
          code: error.Code ?? error.code ?? parsed.__type?.split("#")[1] ?? "UnknownError",
          message: error.Message ?? error.message ?? "Unknown error",
          requestId: parsed.RequestId ?? parsed.requestId,
          service: error.Service ?? error.service,
          operation: error.Operation ?? error.operation,
          retryable: isRetryableError(error.Code ?? error.code ?? parsed.__type),
          statusCode: parsed.statusCode,
        };
      }
    } catch {
      // Not JSON, continue to regex parsing
    }

    // Try to parse common error formats
    const errorMatch = source.match(
      /An error occurred \((\w+)\) when calling the (\w+) operation(?:\s*\(reached max retries: (\d+)\))?: (.+)/i,
    );
    if (errorMatch) {
      return {
        code: errorMatch[1],
        message: errorMatch[4],
        operation: errorMatch[2],
        retryable: isRetryableError(errorMatch[1]),
      };
    }

    // Try to parse access denied errors
    const accessDeniedMatch = source.match(
      /(?:Access Denied|AccessDenied|UnauthorizedAccess|Forbidden)/i,
    );
    if (accessDeniedMatch) {
      return {
        code: "AccessDenied",
        message: source.trim(),
        retryable: false,
        statusCode: 403,
      };
    }

    // Try to parse credential errors
    const credentialMatch = source.match(
      /(?:Unable to locate credentials|The security token included in the request is invalid|ExpiredToken|InvalidClientTokenId)/i,
    );
    if (credentialMatch) {
      return {
        code: "CredentialError",
        message: source.trim(),
        retryable: false,
        statusCode: 401,
      };
    }
  }

  // Generic error if we have stderr content
  if (stderr && stderr.trim()) {
    return {
      code: "UnknownError",
      message: stderr.trim(),
      retryable: false,
    };
  }

  return null;
}

function isRetryableError(code: string | undefined): boolean {
  if (!code) return false;
  return RETRYABLE_ERROR_CODES.some(
    (retryableCode) => code.includes(retryableCode) || retryableCode.includes(code),
  );
}

function classifyErrorType(params: {
  error?: AWSCLIError | null;
  stderr: string;
  timedOut?: boolean;
  aborted?: boolean;
}): AWSCLIErrorType {
  if (params.timedOut) return "timeout";
  if (params.aborted) return "timeout";
  const code = params.error?.code?.toLowerCase() ?? "";
  const message = `${params.error?.message ?? ""}\n${params.stderr}`.toLowerCase();
  if (code.includes("timeout") || message.includes("timed out") || message.includes("timeout")) {
    return "timeout";
  }
  if (code.includes("spawn") || message.includes("enoent") || message.includes("not found")) {
    return "not-found";
  }
  if (message.includes("permission denied")) return "permission";
  if (code.includes("accessdenied") || code.includes("credential") || message.includes("unauthorized")) {
    return "auth";
  }
  if (params.error?.retryable || message.includes("throttl") || message.includes("rate limit")) {
    return "rate-limit";
  }
  if (message.includes("validation") || message.includes("invalid")) return "validation";
  return "unknown";
}

function redactCommandToken(token: string): string {
  const lower = token.toLowerCase();
  if (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("access-key") ||
    lower.includes("session-token") ||
    lower.includes("client-secret")
  ) {
    return "***";
  }
  return token;
}

function redactCommandArgs(args: string[]): string[] {
  const redacted: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const lower = arg.toLowerCase();
    if (
      lower === "--access-key" ||
      lower === "--secret-key" ||
      lower === "--session-token" ||
      lower === "--token" ||
      lower === "--password"
    ) {
      redacted.push(arg);
      if (args[i + 1] !== undefined) {
        redacted.push("***");
        i += 1;
      }
      continue;
    }
    if (arg.includes("=")) {
      const [k, v] = arg.split("=", 2);
      redacted.push(`${k}=${redactCommandToken(v ?? "")}`);
      continue;
    }
    redacted.push(redactCommandToken(arg));
  }
  return redacted;
}

function emitTelemetry(
  cb: AWSCLIOptions["onTelemetry"],
  event: AWSCommandTelemetryEvent,
): void {
  if (!cb) return;
  try {
    cb(event);
  } catch {
    // ignore telemetry sink errors
  }
}

// =============================================================================
// Output Parser
// =============================================================================

function parseOutput<T>(
  stdout: string,
  format: "json" | "yaml" | "text" | "table",
): T | undefined {
  if (!stdout || !stdout.trim()) return undefined;

  switch (format) {
    case "json":
      try {
        return JSON.parse(stdout) as T;
      } catch {
        return undefined;
      }

    case "yaml":
      // Basic YAML parsing - for complex cases, use a proper YAML parser
      try {
        // Simple YAML to JSON conversion for basic structures
        const lines = stdout.split("\n");
        const result: Record<string, unknown> = {};
        let currentKey = "";
        let currentValue: string[] = [];

        for (const line of lines) {
          if (line.match(/^\s*-/)) {
            // List item
            if (!Array.isArray(result[currentKey])) {
              result[currentKey] = [];
            }
            (result[currentKey] as string[]).push(line.replace(/^\s*-\s*/, "").trim());
          } else if (line.includes(":")) {
            if (currentKey && currentValue.length > 0) {
              result[currentKey] = currentValue.join("\n");
            }
            const [key, ...valueParts] = line.split(":");
            currentKey = key.trim();
            const value = valueParts.join(":").trim();
            if (value) {
              result[currentKey] = value;
              currentValue = [];
            } else {
              currentValue = [];
            }
          } else if (line.trim()) {
            currentValue.push(line.trim());
          }
        }

        if (currentKey && currentValue.length > 0) {
          result[currentKey] = currentValue.join("\n");
        }

        return result as T;
      } catch {
        return undefined;
      }

    case "text":
    case "table":
      // Return as raw string for text/table formats
      return stdout as T;

    default:
      return stdout as T;
  }
}

// =============================================================================
// AWS CLI Wrapper
// =============================================================================

export class AWSCLIWrapper {
  private config: Required<AWSCLIConfig>;
  private cliPath: string | null = null;

  constructor(config: AWSCLIConfig = {}) {
    this.config = {
      cliPath: config.cliPath ?? "",
      defaultOptions: config.defaultOptions ?? {},
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
      commandTimeout: config.commandTimeout ?? DEFAULT_TIMEOUT,
    };
  }

  /**
   * Initialize the CLI wrapper by finding the AWS CLI
   */
  async initialize(): Promise<void> {
    if (this.config.cliPath) {
      this.cliPath = this.config.cliPath;
      return;
    }

    // Find AWS CLI in PATH
    this.cliPath = await which("aws");
    
    if (!this.cliPath) {
      throw new Error(
        "AWS CLI not found. Please install the AWS CLI or specify the path in config.",
      );
    }
  }

  /**
   * Execute an AWS CLI command
   */
  async execute<T = unknown>(
    service: string,
    command: string,
    args: Record<string, unknown> = {},
    options: AWSCLIOptions = {},
  ): Promise<AWSCLIResult<T>> {
    if (!this.cliPath) {
      await this.initialize();
    }

    const mergedOptions = { ...this.config.defaultOptions, ...options };
    const startTime = Date.now();
    
    // Build command arguments
    const cliArgs = this.buildArgs(service, command, args, mergedOptions);
    const fullCommand = `aws ${cliArgs.join(" ")}`;
    const redactedCommand = `aws ${redactCommandArgs(cliArgs).join(" ")}`;

    let lastError: AWSCLIError | null = null;
    let attempts = 0;
    const maxAttempts = mergedOptions.retries ?? this.config.maxRetries;

    while (attempts <= maxAttempts) {
      attempts++;

      try {
        const result = await this.executeCommand<T>(
          cliArgs,
          mergedOptions,
          fullCommand,
          redactedCommand,
          startTime,
        );

        emitTelemetry(mergedOptions.onTelemetry, {
          provider: "aws",
          command: fullCommand,
          commandRedacted: redactedCommand,
          success: result.success,
          exitCode: result.exitCode,
          durationMs: result.duration,
          errorType: result.errorType,
          retryable: result.error?.retryable,
          outputTruncated: result.outputTruncated,
          attempt: attempts,
          maxAttempts,
          timestamp: new Date().toISOString(),
        });

        if (result.success || !result.error?.retryable || attempts > maxAttempts) {
          return result;
        }

        lastError = result.error;
      } catch (error) {
        lastError = {
          code: "ExecutionError",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        };
        
        if (attempts > maxAttempts) {
          const errorType = classifyErrorType({ error: lastError, stderr: lastError.message });
          emitTelemetry(mergedOptions.onTelemetry, {
            provider: "aws",
            command: fullCommand,
            commandRedacted: redactedCommand,
            success: false,
            exitCode: 1,
            durationMs: Date.now() - startTime,
            errorType,
            retryable: lastError.retryable,
            attempt: attempts,
            maxAttempts,
            timestamp: new Date().toISOString(),
          });
          return {
            success: false,
            error: lastError,
            errorType,
            exitCode: 1,
            stdout: "",
            stderr: lastError.message,
            duration: Date.now() - startTime,
            command: fullCommand,
            commandRedacted: redactedCommand,
          };
        }
      }

      // Wait before retry with exponential backoff
      const delay = this.config.retryDelay * Math.pow(2, attempts - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const fallbackErrorType = classifyErrorType({ error: lastError, stderr: lastError?.message ?? "" });
    emitTelemetry(mergedOptions.onTelemetry, {
      provider: "aws",
      command: fullCommand,
      commandRedacted: redactedCommand,
      success: false,
      exitCode: 1,
      durationMs: Date.now() - startTime,
      errorType: fallbackErrorType,
      retryable: lastError?.retryable,
      attempt: attempts,
      maxAttempts,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: lastError ?? {
        code: "MaxRetriesExceeded",
        message: "Maximum retry attempts exceeded",
        retryable: false,
      },
      errorType: fallbackErrorType,
      exitCode: 1,
      stdout: "",
      stderr: lastError?.message ?? "Unknown error",
      duration: Date.now() - startTime,
      command: fullCommand,
      commandRedacted: redactedCommand,
    };
  }

  /**
   * Execute CLI command and capture output
   */
  private executeCommand<T>(
    args: string[],
    options: AWSCLIOptions,
    fullCommand: string,
    redactedCommand: string,
    startTime: number,
  ): Promise<AWSCLIResult<T>> {
    return new Promise((resolve) => {
      const timeout = options.timeout ?? this.config.commandTimeout;
      const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;
      let outputTruncated = false;

      const child = spawn(this.cliPath!, args, {
        env: {
          ...process.env,
          AWS_PAGER: "", // Disable pager
        },
        signal: options.signal,
        timeout,
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeout);

      const appendLimited = (current: string, chunk: string): string => {
        if (outputTruncated) return current;
        const next = current + chunk;
        if (Buffer.byteLength(next, "utf8") > maxOutputBytes) {
          outputTruncated = true;
          return next.slice(0, maxOutputBytes);
        }
        return next;
      };

      if (options.signal) {
        if (options.signal.aborted) {
          aborted = true;
          child.kill("SIGTERM");
        } else {
          options.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              child.kill("SIGTERM");
            },
            { once: true },
          );
        }
      }

      child.stdout.on("data", (data) => {
        stdout = appendLimited(stdout, data.toString());
      });

      child.stderr.on("data", (data) => {
        stderr = appendLimited(stderr, data.toString());
      });

      child.on("close", (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (timedOut) {
          const error: AWSCLIError = {
            code: "CommandTimeout",
            message: `Command timed out after ${timeout}ms`,
            retryable: true,
          };
          resolve({
            success: false,
            error,
            errorType: classifyErrorType({ error, stderr, timedOut: true }),
            exitCode: -1,
            stdout,
            stderr,
            duration,
            command: fullCommand,
            commandRedacted: redactedCommand,
            outputTruncated,
          });
          return;
        }

        if (aborted) {
          const error: AWSCLIError = {
            code: "CommandAborted",
            message: "Command aborted",
            retryable: false,
          };
          resolve({
            success: false,
            error,
            errorType: classifyErrorType({ error, stderr, aborted: true }),
            exitCode: -1,
            stdout,
            stderr,
            duration,
            command: fullCommand,
            commandRedacted: redactedCommand,
            outputTruncated,
          });
          return;
        }

        const exitCode = code ?? 0;
        const success = exitCode === 0;
        const outputFormat = options.output ?? "json";

        if (success) {
          const data = parseOutput<T>(stdout, outputFormat);
          resolve({
            success: true,
            data,
            exitCode,
            stdout,
            stderr,
            duration,
            command: fullCommand,
            commandRedacted: redactedCommand,
            outputTruncated,
          });
        } else {
          const error = parseAWSError(stderr, stdout);
          resolve({
            success: false,
            error: error ?? {
              code: "UnknownError",
              message: stderr || "Command failed with no error message",
              retryable: false,
            },
            errorType: classifyErrorType({ error, stderr }),
            exitCode,
            stdout,
            stderr,
            duration,
            command: fullCommand,
            commandRedacted: redactedCommand,
            outputTruncated,
          });
        }
      });

      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: {
            code: "SpawnError",
            message: error.message,
            retryable: false,
          },
          errorType: classifyErrorType({ stderr, error: {
            code: "SpawnError",
            message: error.message,
            retryable: false,
          } }),
          exitCode: -1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          command: fullCommand,
          commandRedacted: redactedCommand,
          outputTruncated,
        });
      });
    });
  }

  /**
   * Build CLI arguments from options
   */
  private buildArgs(
    service: string,
    command: string,
    args: Record<string, unknown>,
    options: AWSCLIOptions,
  ): string[] {
    const cliArgs: string[] = [service, command];

    // Add options
    if (options.profile) {
      cliArgs.push("--profile", options.profile);
    }
    if (options.region) {
      cliArgs.push("--region", options.region);
    }
    if (options.output) {
      cliArgs.push("--output", options.output);
    }
    if (options.debug) {
      cliArgs.push("--debug");
    }
    if (options.dryRun) {
      cliArgs.push("--dry-run");
    }
    if (options.noVerifySSL) {
      cliArgs.push("--no-verify-ssl");
    }
    if (options.endpointUrl) {
      cliArgs.push("--endpoint-url", options.endpointUrl);
    }

    // Add command arguments
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;

      const argName = `--${this.toKebabCase(key)}`;

      if (typeof value === "boolean") {
        if (value) {
          cliArgs.push(argName);
        } else {
          cliArgs.push(`--no-${this.toKebabCase(key)}`);
        }
      } else if (Array.isArray(value)) {
        cliArgs.push(argName, ...value.map(String));
      } else if (typeof value === "object") {
        cliArgs.push(argName, JSON.stringify(value));
      } else {
        cliArgs.push(argName, String(value));
      }
    }

    return cliArgs;
  }

  /**
   * Convert camelCase to kebab-case
   */
  private toKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  }

  /**
   * Get AWS CLI version
   */
  async getVersion(): Promise<string> {
    const result = await this.execute<string>("--version", "", {}, { output: "text" });
    if (result.success && result.stdout) {
      const match = result.stdout.match(/aws-cli\/(\S+)/);
      return match ? match[1] : "unknown";
    }
    return "unknown";
  }

  /**
   * Check if AWS CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.initialize();
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AWS CLI wrapper
 */
export function createCLIWrapper(config?: AWSCLIConfig): AWSCLIWrapper {
  return new AWSCLIWrapper(config);
}
