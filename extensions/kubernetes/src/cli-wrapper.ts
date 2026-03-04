/**
 * kubectl CLI wrapper — wraps the `kubectl` binary for apply, get, diff, describe, rollout.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface KubectlOptions {
  namespace?: string;
  context?: string;
  kubeconfig?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBufferBytes?: number;
  onTelemetry?: (event: KubectlTelemetryEvent) => void;
}

export type CloudCliErrorType =
  | "timeout"
  | "not-found"
  | "permission"
  | "auth"
  | "rate-limit"
  | "validation"
  | "unknown";

export interface KubectlCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  commandRedacted: string;
  errorType?: CloudCliErrorType;
  retryable?: boolean;
  outputTruncated?: boolean;
}

export interface KubectlTelemetryEvent {
  provider: "kubernetes";
  command: string;
  commandRedacted: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
  errorType?: CloudCliErrorType;
  retryable?: boolean;
  outputTruncated?: boolean;
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

function isRetryable(errorType: CloudCliErrorType): boolean {
  return errorType === "timeout" || errorType === "rate-limit";
}

function emitTelemetry(
  cb: KubectlOptions["onTelemetry"],
  event: KubectlTelemetryEvent,
): void {
  if (!cb) return;
  try {
    cb(event);
  } catch {
    // ignore telemetry sink errors
  }
}

function redactArg(arg: string): string {
  const lower = arg.toLowerCase();
  if (
    lower.includes("token") ||
    lower.includes("password") ||
    lower.includes("secret") ||
    lower.includes("client-key")
  ) {
    return "***";
  }
  return arg;
}

function redactCommandArgs(args: string[]): string[] {
  const redacted: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const lower = arg.toLowerCase();
    if (lower === "--token" || lower === "--password") {
      redacted.push(arg);
      if (args[i + 1] !== undefined) {
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

function buildKubectlArgs(args: string[], options: KubectlOptions): string[] {
  const fullArgs = [...args];
  if (options.namespace) fullArgs.push("-n", options.namespace);
  if (options.context) fullArgs.push("--context", options.context);
  if (options.kubeconfig) fullArgs.push("--kubeconfig", options.kubeconfig);
  return fullArgs;
}

export async function kubectlRunCommand(
  args: string[],
  options: KubectlOptions = {},
): Promise<KubectlCommandResult> {
  const fullArgs = buildKubectlArgs(args, options);
  const env = { ...process.env, ...options.env };
  const command = `kubectl ${fullArgs.join(" ")}`;
  const commandRedacted = `kubectl ${redactCommandArgs(fullArgs).join(" ")}`;
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync("kubectl", fullArgs, {
      env,
      timeout: options.timeoutMs ?? 120_000,
      signal: options.signal,
      maxBuffer: options.maxBufferBytes ?? 50 * 1024 * 1024,
    });
    emitTelemetry(options.onTelemetry, {
      provider: "kubernetes",
      command,
      commandRedacted,
      success: true,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      outputTruncated: false,
    });
    return {
      success: true,
      stdout,
      stderr,
      exitCode: 0,
      command,
      commandRedacted,
      outputTruncated: false,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    const stderr = err.stderr ?? err.message ?? "Unknown error";
    const errorType = classifyError({ message: err.message ?? "", stderr, exitCode });
    const retryable = isRetryable(errorType);
    emitTelemetry(options.onTelemetry, {
      provider: "kubernetes",
      command,
      commandRedacted,
      success: false,
      exitCode,
      durationMs: Date.now() - startedAt,
      errorType,
      retryable,
      timestamp: new Date().toISOString(),
      outputTruncated: false,
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
      outputTruncated: false,
    };
  }
}

/** Run a kubectl command and return stdout. */
async function runKubectl(
  args: string[],
  options: KubectlOptions = {},
): Promise<string> {
  const result = await kubectlRunCommand(args, options);
  if (!result.success) {
    throw new Error(result.stderr || `kubectl command failed (${result.errorType ?? "unknown"})`);
  }
  return result.stdout;
}

/** Run `kubectl apply -f <file> --dry-run=server -o json`. */
export async function kubectlApplyDryRun(
  filePath: string,
  options: KubectlOptions = {},
): Promise<string> {
  return runKubectl(["apply", "-f", filePath, "--dry-run=server", "-o", "json"], options);
}

/** Run `kubectl apply -f <file>`. */
export async function kubectlApply(
  filePath: string,
  options: KubectlOptions = {},
): Promise<string> {
  return runKubectl(["apply", "-f", filePath], options);
}

/** Run `kubectl get <resource> -o json`. */
export async function kubectlGet(
  resource: string,
  options: KubectlOptions & { name?: string; allNamespaces?: boolean } = {},
): Promise<string> {
  const args = ["get", resource, "-o", "json"];
  if (options.name) args.splice(2, 0, options.name);
  if (options.allNamespaces) args.push("--all-namespaces");
  return runKubectl(args, options);
}

/** Run `kubectl diff -f <file>`. Returns diff text (empty string = no changes, exit code 1 = diff found). */
export async function kubectlDiff(
  filePath: string,
  options: KubectlOptions = {},
): Promise<string> {
  const result = await kubectlRunCommand(["diff", "-f", filePath], options);
  if (result.success) return result.stdout;
  // kubectl diff exits 1 when there are differences
  if (result.exitCode === 1 && result.stdout.trim().length > 0) return result.stdout;
  throw new Error(result.stderr || "kubectl diff failed");
}

/** Run `kubectl describe <resource> <name>`. */
export async function kubectlDescribe(
  resource: string,
  name: string,
  options: KubectlOptions = {},
): Promise<string> {
  return runKubectl(["describe", resource, name], options);
}

/** Run `kubectl rollout status <resource>/<name>`. */
export async function kubectlRolloutStatus(
  resource: string,
  name: string,
  options: KubectlOptions = {},
): Promise<string> {
  return runKubectl(["rollout", "status", `${resource}/${name}`], options);
}

/** Run `kubectl get namespaces -o json`. */
export async function kubectlGetNamespaces(options: KubectlOptions = {}): Promise<string> {
  return runKubectl(["get", "namespaces", "-o", "json"], options);
}

/** Run `kubectl delete <resource> <name>`. */
export async function kubectlDelete(
  resource: string,
  name: string,
  options: KubectlOptions & { force?: boolean; gracePeriod?: number } = {},
): Promise<string> {
  const args = ["delete", resource, name];
  if (options.force) args.push("--force");
  if (options.gracePeriod !== undefined) args.push(`--grace-period=${options.gracePeriod}`);
  return runKubectl(args, options);
}

/** Run `kubectl logs <pod>`. */
export async function kubectlLogs(
  pod: string,
  options: KubectlOptions & {
    container?: string;
    previous?: boolean;
    tail?: number;
    since?: string;
    sinceTime?: string;
    timestamps?: boolean;
  } = {},
): Promise<string> {
  const args = ["logs", pod];
  if (options.container) args.push("-c", options.container);
  if (options.previous) args.push("--previous");
  if (options.tail !== undefined) args.push(`--tail=${options.tail}`);
  if (options.since) args.push(`--since=${options.since}`);
  if (options.sinceTime) args.push(`--since-time=${options.sinceTime}`);
  if (options.timestamps) args.push("--timestamps");
  return runKubectl(args, options);
}

/** Run `kubectl scale <resource>/<name> --replicas=<count>`. */
export async function kubectlScale(
  resource: string,
  name: string,
  replicas: number,
  options: KubectlOptions = {},
): Promise<string> {
  return runKubectl(["scale", `${resource}/${name}`, `--replicas=${replicas}`], options);
}

/** Run `kubectl rollout restart <resource>/<name>`. */
export async function kubectlRolloutRestart(
  resource: string,
  name: string,
  options: KubectlOptions = {},
): Promise<string> {
  return runKubectl(["rollout", "restart", `${resource}/${name}`], options);
}

/** Run `kubectl rollout undo <resource>/<name>`. */
export async function kubectlRolloutUndo(
  resource: string,
  name: string,
  options: KubectlOptions & { toRevision?: number } = {},
): Promise<string> {
  const args = ["rollout", "undo", `${resource}/${name}`];
  if (options.toRevision !== undefined) args.push(`--to-revision=${options.toRevision}`);
  return runKubectl(args, options);
}

/** Run `kubectl rollout history <resource>/<name>`. */
export async function kubectlRolloutHistory(
  resource: string,
  name: string,
  options: KubectlOptions & { revision?: number } = {},
): Promise<string> {
  const args = ["rollout", "history", `${resource}/${name}`];
  if (options.revision !== undefined) args.push(`--revision=${options.revision}`);
  return runKubectl(args, options);
}
