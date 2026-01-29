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
  AWSCLIConfig,
} from "../types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 120000; // 2 minutes
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second
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
          startTime,
        );

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
          return {
            success: false,
            error: lastError,
            exitCode: 1,
            stdout: "",
            stderr: lastError.message,
            duration: Date.now() - startTime,
            command: fullCommand,
          };
        }
      }

      // Wait before retry with exponential backoff
      const delay = this.config.retryDelay * Math.pow(2, attempts - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return {
      success: false,
      error: lastError ?? {
        code: "MaxRetriesExceeded",
        message: "Maximum retry attempts exceeded",
        retryable: false,
      },
      exitCode: 1,
      stdout: "",
      stderr: lastError?.message ?? "Unknown error",
      duration: Date.now() - startTime,
      command: fullCommand,
    };
  }

  /**
   * Execute CLI command and capture output
   */
  private executeCommand<T>(
    args: string[],
    options: AWSCLIOptions,
    fullCommand: string,
    startTime: number,
  ): Promise<AWSCLIResult<T>> {
    return new Promise((resolve) => {
      const timeout = options.timeout ?? this.config.commandTimeout;
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(this.cliPath!, args, {
        env: {
          ...process.env,
          AWS_PAGER: "", // Disable pager
        },
        timeout,
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeout);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (timedOut) {
          resolve({
            success: false,
            error: {
              code: "CommandTimeout",
              message: `Command timed out after ${timeout}ms`,
              retryable: true,
            },
            exitCode: -1,
            stdout,
            stderr,
            duration,
            command: fullCommand,
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
            exitCode,
            stdout,
            stderr,
            duration,
            command: fullCommand,
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
          exitCode: -1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          command: fullCommand,
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
