/**
 * Azure CLI Wrapper
 *
 * Wraps the `az` CLI tool for operations not easily done via SDK.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

export type AzureCLIOptions = {
  /** Path to az CLI binary. */
  azPath?: string;
  /** Timeout in ms. */
  timeoutMs?: number;
  /** Working directory. */
  cwd?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Abort signal to cancel command execution. */
  signal?: AbortSignal;
  /** Max stdout/stderr buffer in bytes. */
  maxBufferBytes?: number;
  /** Optional command telemetry callback. */
  onTelemetry?: (event: CloudCommandTelemetry) => void;
};

export type CloudCommandTelemetry = {
  provider: "azure";
  command: string;
  commandRedacted: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
  errorType?: AzureCLIErrorType;
  retryable?: boolean;
  timestamp: string;
};

export type AzureCLIErrorType =
  | "timeout"
  | "not-found"
  | "permission"
  | "auth"
  | "rate-limit"
  | "validation"
  | "unknown";

export type AzureCLIResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  commandRedacted?: string;
  errorType?: AzureCLIErrorType;
  parsed?: unknown;
};

export type AzureCLIError = {
  message: string;
  stderr: string;
  exitCode: number;
  command: string;
};

export type AzureCLIConfig = {
  azPath: string;
  defaultArgs: string[];
  timeoutMs: number;
};

function redactArg(value: string): string {
  const lower = value.toLowerCase();
  if (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("apikey") ||
    lower.includes("api-key")
  ) {
    return "***";
  }
  return value;
}

function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const lower = arg.toLowerCase();
    if (
      lower === "--token" ||
      lower === "--password" ||
      lower === "--client-secret" ||
      lower === "--api-key"
    ) {
      redacted.push(arg);
      const next = args[i + 1];
      if (next !== undefined) {
        redacted.push("***");
        i += 1;
      }
      continue;
    }
    if (arg.includes("=")) {
      const [k, v] = arg.split("=", 2);
      redacted.push(`${k}=${redactArg(v ?? "")}`);
      continue;
    }
    redacted.push(redactArg(arg));
  }
  return redacted;
}

function classifyError(message: string, stderr: string, exitCode: number): AzureCLIErrorType {
  const haystack = `${message}\n${stderr}`.toLowerCase();
  if (haystack.includes("timeout") || haystack.includes("timed out")) return "timeout";
  if (haystack.includes("enoent") || haystack.includes("not found")) return "not-found";
  if (haystack.includes("permission denied") || exitCode === 126) return "permission";
  if (haystack.includes("unauthorized") || haystack.includes("forbidden")) return "auth";
  if (haystack.includes("throttl") || haystack.includes("rate limit")) return "rate-limit";
  if (exitCode === 1) return "validation";
  return "unknown";
}

function isRetryable(errorType: AzureCLIErrorType): boolean {
  return errorType === "timeout" || errorType === "rate-limit";
}

function emitTelemetry(
  cb: AzureCLIOptions["onTelemetry"],
  event: CloudCommandTelemetry,
): void {
  if (!cb) return;
  try {
    cb(event);
  } catch {
    // ignore telemetry sink errors
  }
}

// =============================================================================
// AzureCLIWrapper
// =============================================================================

export class AzureCLIWrapper {
  private config: AzureCLIConfig;

  constructor(options?: AzureCLIOptions) {
    this.config = {
      azPath: options?.azPath ?? "az",
      defaultArgs: ["--output", "json"],
      timeoutMs: options?.timeoutMs ?? 60_000,
    };
  }

  /**
   * Execute an az CLI command.
   */
  async execute(args: string[], overrides: Partial<AzureCLIOptions> = {}): Promise<AzureCLIResult> {
    const fullArgs = [...args, ...this.config.defaultArgs];
    const command = `${this.config.azPath} ${fullArgs.join(" ")}`;
    const commandRedacted = `${this.config.azPath} ${redactArgs(fullArgs).join(" ")}`;
    const timeout = overrides.timeoutMs ?? this.config.timeoutMs;
    const startedAt = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(this.config.azPath, fullArgs, {
        timeout,
        cwd: overrides.cwd,
        signal: overrides.signal,
        maxBuffer: overrides.maxBufferBytes ?? 50 * 1024 * 1024,
        env: { ...process.env, ...overrides.env },
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // Not JSON output, that's okay
      }

      emitTelemetry(overrides.onTelemetry, {
        provider: "azure",
        command,
        commandRedacted,
        success: true,
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });

      return { success: true, stdout, stderr, exitCode: 0, parsed, commandRedacted };
    } catch (error) {
      const err = error as { stderr?: string; code?: number; message?: string };
      const message = err.message ?? "Unknown error";
      const stderr = err.stderr ?? message;
      const exitCode = err.code ?? 1;
      const errorType = classifyError(message, stderr, exitCode);
      emitTelemetry(overrides.onTelemetry, {
        provider: "azure",
        command,
        commandRedacted,
        success: false,
        exitCode,
        durationMs: Date.now() - startedAt,
        errorType,
        retryable: isRetryable(errorType),
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        stdout: "",
        stderr,
        exitCode,
        commandRedacted,
        errorType,
      };
    }
  }

  /**
   * Check if az CLI is installed and available.
   */
  async isAvailable(): Promise<boolean> {
    const result = await this.execute(["version"]);
    return result.success;
  }

  /**
   * Get the currently logged-in account info.
   */
  async getAccount(): Promise<AzureCLIResult> {
    return this.execute(["account", "show"]);
  }

  /**
   * List subscriptions.
   */
  async listSubscriptions(): Promise<AzureCLIResult> {
    return this.execute(["account", "list"]);
  }

  /**
   * Set the active subscription.
   */
  async setSubscription(subscriptionId: string): Promise<AzureCLIResult> {
    return this.execute(["account", "set", "--subscription", subscriptionId]);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCLIWrapper(options?: AzureCLIOptions): AzureCLIWrapper {
  return new AzureCLIWrapper(options);
}
