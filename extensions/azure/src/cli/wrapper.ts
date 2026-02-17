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
};

export type AzureCLIResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
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
  async execute(args: string[]): Promise<AzureCLIResult> {
    const fullArgs = [...args, ...this.config.defaultArgs];

    try {
      const { stdout, stderr } = await execFileAsync(this.config.azPath, fullArgs, {
        timeout: this.config.timeoutMs,
        cwd: undefined,
        env: process.env,
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // Not JSON output, that's okay
      }

      return { success: true, stdout, stderr, exitCode: 0, parsed };
    } catch (error) {
      const err = error as { stderr?: string; code?: number; message?: string };
      return {
        success: false,
        stdout: "",
        stderr: err.stderr ?? err.message ?? "Unknown error",
        exitCode: err.code ?? 1,
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
