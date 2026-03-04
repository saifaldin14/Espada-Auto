/**
 * Pulumi CLI wrapper — wraps the `pulumi` CLI binary for preview, up, stack management, and state export.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PulumiStack } from "./types.js";

const execFileAsync = promisify(execFile);

export interface PulumiCliOptions {
  cwd?: string;
  stack?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBufferBytes?: number;
  onTelemetry?: (event: PulumiTelemetryEvent) => void;
}

export type CloudCliErrorType =
  | "timeout"
  | "not-found"
  | "permission"
  | "auth"
  | "rate-limit"
  | "validation"
  | "unknown";

export interface PulumiCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  commandRedacted: string;
  errorType?: CloudCliErrorType;
  retryable?: boolean;
}

export interface PulumiTelemetryEvent {
  provider: "pulumi";
  command: string;
  commandRedacted: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
  errorType?: CloudCliErrorType;
  retryable?: boolean;
  timestamp: string;
}

function classifyError(params: { message: string; stderr: string; exitCode: number }): CloudCliErrorType {
  const haystack = `${params.message}\n${params.stderr}`.toLowerCase();
  if (haystack.includes("timed out") || haystack.includes("timeout")) return "timeout";
  if (haystack.includes("enoent") || haystack.includes("not found")) return "not-found";
  if (haystack.includes("permission denied") || params.exitCode === 126) return "permission";
  if (haystack.includes("unauthorized") || haystack.includes("forbidden")) return "auth";
  if (haystack.includes("throttl") || haystack.includes("rate limit")) return "rate-limit";
  if (params.exitCode === 1) return "validation";
  return "unknown";
}

function redactArg(arg: string): string {
  const lower = arg.toLowerCase();
  if (
    lower.includes("token") ||
    lower.includes("password") ||
    lower.includes("secret") ||
    lower.includes("access-key")
  ) {
    return "***";
  }
  return arg;
}

function redactCommandArgs(args: string[]): string[] {
  return args.map((arg) => {
    if (!arg.includes("=")) return redactArg(arg);
    const [k, v] = arg.split("=", 2);
    return `${k}=${redactArg(v ?? "")}`;
  });
}

function isRetryable(errorType: CloudCliErrorType): boolean {
  return errorType === "timeout" || errorType === "rate-limit";
}

function emitTelemetry(
  cb: PulumiCliOptions["onTelemetry"],
  event: PulumiTelemetryEvent,
): void {
  if (!cb) return;
  try {
    cb(event);
  } catch {
    // ignore telemetry sink errors
  }
}

export async function pulumiRunCommand(
  args: string[],
  options: PulumiCliOptions = {},
): Promise<PulumiCommandResult> {
  const env = { ...process.env, ...options.env, PULUMI_SKIP_UPDATE_CHECK: "1" };
  const command = `pulumi ${args.join(" ")}`;
  const commandRedacted = `pulumi ${redactCommandArgs(args).join(" ")}`;
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync("pulumi", args, {
      cwd: options.cwd,
      env,
      timeout: options.timeoutMs ?? 120_000,
      signal: options.signal,
      maxBuffer: options.maxBufferBytes ?? 50 * 1024 * 1024,
    });
    emitTelemetry(options.onTelemetry, {
      provider: "pulumi",
      command,
      commandRedacted,
      success: true,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
    return {
      success: true,
      stdout,
      stderr,
      exitCode: 0,
      command,
      commandRedacted,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    const stderr = err.stderr ?? err.message ?? "Unknown error";
    const errorType = classifyError({ message: err.message ?? "", stderr, exitCode });
    const retryable = isRetryable(errorType);
    emitTelemetry(options.onTelemetry, {
      provider: "pulumi",
      command,
      commandRedacted,
      success: false,
      exitCode,
      durationMs: Date.now() - startedAt,
      errorType,
      retryable,
      timestamp: new Date().toISOString(),
    });
    return {
      success: false,
      stdout: err.stdout ?? "",
      stderr,
      exitCode,
      command,
      commandRedacted,
      errorType,
      retryable,
    };
  }
}

/** Run a pulumi CLI command and return stdout. */
async function runPulumi(
  args: string[],
  options: PulumiCliOptions = {},
): Promise<string> {
  const result = await pulumiRunCommand(args, options);
  if (!result.success) {
    throw new Error(result.stderr || `pulumi command failed (${result.errorType ?? "unknown"})`);
  }
  return result.stdout;
}

/** Run `pulumi preview --json` and return the raw JSON. */
export async function pulumiPreview(options: PulumiCliOptions = {}): Promise<string> {
  const args = ["preview", "--json"];
  if (options.stack) args.push("--stack", options.stack);
  return runPulumi(args, options);
}

/** Run `pulumi up --yes --json` and return the raw JSON. */
export async function pulumiUp(options: PulumiCliOptions = {}): Promise<string> {
  const args = ["up", "--yes", "--json"];
  if (options.stack) args.push("--stack", options.stack);
  return runPulumi(args, options);
}

/** Run `pulumi stack ls --json` and return parsed stack list. */
export async function pulumiStackList(options: PulumiCliOptions = {}): Promise<PulumiStack[]> {
  const raw = await runPulumi(["stack", "ls", "--json"], options);
  const stacks = JSON.parse(raw) as Array<{
    name: string;
    current: boolean;
    updateInProgress: boolean;
    lastUpdate?: string;
    resourceCount?: number;
    url?: string;
  }>;

  return stacks.map((s) => ({
    name: s.name,
    current: s.current,
    updateInProgress: s.updateInProgress,
    lastUpdate: s.lastUpdate,
    resourceCount: s.resourceCount,
    url: s.url,
  }));
}

/** Run `pulumi stack export` and return the raw state JSON. */
export async function pulumiStackExport(options: PulumiCliOptions = {}): Promise<string> {
  const args = ["stack", "export"];
  if (options.stack) args.push("--stack", options.stack);
  return runPulumi(args, options);
}

/** Run `pulumi stack output --json` and return outputs. */
export async function pulumiStackOutputs(
  options: PulumiCliOptions = {},
): Promise<Record<string, unknown>> {
  const args = ["stack", "output", "--json"];
  if (options.stack) args.push("--stack", options.stack);
  const raw = await runPulumi(args, options);
  return JSON.parse(raw);
}

/** Run `pulumi refresh --yes --json` (detect drift). */
export async function pulumiRefresh(options: PulumiCliOptions = {}): Promise<string> {
  const args = ["refresh", "--yes", "--json"];
  if (options.stack) args.push("--stack", options.stack);
  return runPulumi(args, options);
}
