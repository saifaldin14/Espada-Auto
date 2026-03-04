/**
 * Terraform CLI wrapper — executes real `terraform` commands via child_process.
 *
 * All commands run in a specified working directory. Supports:
 * - init, validate, plan, apply, destroy, show, import
 * - state (list, pull, rm, mv)
 * - output, fmt, version
 *
 * Returns structured results with stdout/stderr and parsed JSON where available.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** Options for Terraform CLI invocations. */
export interface TfCliOptions {
  /** Working directory containing .tf files. */
  cwd: string;
  /** Path to terraform binary (default: "terraform"). */
  terraformBin?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Timeout in ms (default: 300_000 = 5 min). */
  timeout?: number;
  /** Abort signal to cancel command execution. */
  signal?: AbortSignal;
  /** Max stdout/stderr buffer in bytes (default: 50MB). */
  maxBufferBytes?: number;
  /** Optional command telemetry callback. */
  onTelemetry?: (event: TfCliTelemetryEvent) => void;
}

export interface TfCliTelemetryEvent {
  provider: "terraform";
  command: string;
  commandRedacted: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
  errorType?: TfCliErrorType;
  retryable?: boolean;
  timestamp: string;
}

export type TfCliErrorType =
  | "timeout"
  | "not-found"
  | "permission"
  | "auth"
  | "rate-limit"
  | "validation"
  | "unknown";

export interface TfCliError {
  type: TfCliErrorType;
  message: string;
  retryable: boolean;
}

/** Result from a Terraform CLI command. */
export interface TfCliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Redacted command string for safe diagnostics. */
  commandRedacted?: string;
  /** Structured CLI error classification (when success=false). */
  error?: TfCliError;
  /** Parsed JSON output when available (plan -json, show -json, etc.). */
  json?: unknown;
}

/** Resolve the terraform binary path. */
function tfBin(opts: TfCliOptions): string {
  return opts.terraformBin ?? "terraform";
}

function redactSensitiveToken(value: string): string {
  if (!value) return value;
  const lower = value.toLowerCase();
  if (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("api_key") ||
    lower.includes("access_key") ||
    lower.includes("client_secret")
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
      lower === "-var" ||
      lower === "--var" ||
      lower === "-var-file" ||
      lower.startsWith("-var=") ||
      lower.startsWith("--var=")
    ) {
      if (arg.includes("=")) {
        const [k, v] = arg.split("=", 2);
        redacted.push(`${k}=${redactSensitiveToken(v ?? "")}`);
      } else {
        redacted.push(arg);
        const next = args[i + 1];
        if (next !== undefined) {
          redacted.push(redactSensitiveToken(next));
          i += 1;
        }
      }
      continue;
    }
    redacted.push(redactSensitiveToken(arg));
  }
  return redacted;
}

function redactText(value: string): string {
  return value.replace(
    /(token|secret|password|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[=:]\s*([^\s,;]+)/gi,
    "$1=***",
  );
}

function classifyCliError(input: {
  message: string;
  stderr: string;
  exitCode: number;
}): TfCliError {
  const haystack = `${input.message}\n${input.stderr}`.toLowerCase();
  if (haystack.includes("timed out") || haystack.includes("timeout")) {
    return { type: "timeout", message: input.message, retryable: true };
  }
  if (haystack.includes("enoent") || haystack.includes("not found")) {
    return { type: "not-found", message: input.message, retryable: false };
  }
  if (haystack.includes("permission denied") || input.exitCode === 126) {
    return { type: "permission", message: input.message, retryable: false };
  }
  if (
    haystack.includes("invalid token") ||
    haystack.includes("unauthorized") ||
    haystack.includes("forbidden")
  ) {
    return { type: "auth", message: input.message, retryable: false };
  }
  if (
    haystack.includes("rate limit") ||
    haystack.includes("throttl") ||
    haystack.includes("too many requests")
  ) {
    return { type: "rate-limit", message: input.message, retryable: true };
  }
  if (input.exitCode === 1) {
    return { type: "validation", message: input.message, retryable: false };
  }
  return { type: "unknown", message: input.message, retryable: false };
}

function emitTelemetry(
  cb: TfCliOptions["onTelemetry"],
  event: TfCliTelemetryEvent,
): void {
  if (!cb) return;
  try {
    cb(event);
  } catch {
    // ignore telemetry sink errors
  }
}

/** Core exec helper. */
async function run(
  args: string[],
  opts: TfCliOptions,
): Promise<TfCliResult> {
  const bin = tfBin(opts);
  const timeout = opts.timeout ?? 300_000;
  const env = { ...process.env, ...opts.env, TF_IN_AUTOMATION: "1" };
  const command = `${bin} ${args.join(" ")}`;
  const commandRedacted = `${bin} ${redactArgs(args).join(" ")}`;
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFile(bin, args, {
      cwd: opts.cwd,
      env,
      timeout,
      signal: opts.signal,
      maxBuffer: opts.maxBufferBytes ?? 50 * 1024 * 1024, // 50 MB
    });
    emitTelemetry(opts.onTelemetry, {
      provider: "terraform",
      command,
      commandRedacted,
      success: true,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
    return { success: true, stdout, stderr, exitCode: 0, commandRedacted };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    const message = err instanceof Error ? err.message : String(err);
    const stderr = redactText(e.stderr ?? message);
    const cliError = classifyCliError({ message, stderr, exitCode });
    emitTelemetry(opts.onTelemetry, {
      provider: "terraform",
      command,
      commandRedacted,
      success: false,
      exitCode,
      durationMs: Date.now() - startedAt,
      errorType: cliError.type,
      retryable: cliError.retryable,
      timestamp: new Date().toISOString(),
    });
    return {
      success: false,
      stdout: redactText(e.stdout ?? ""),
      stderr,
      exitCode,
      commandRedacted,
      error: cliError,
    };
  }
}

// ─── Individual Commands ────────────────────────────────────────

/** `terraform init` — initialize providers and modules. */
export async function tfInit(
  opts: TfCliOptions,
  flags?: { upgrade?: boolean; reconfigure?: boolean; backendConfig?: string[] },
): Promise<TfCliResult> {
  const args = ["init", "-input=false", "-no-color"];
  if (flags?.upgrade) args.push("-upgrade");
  if (flags?.reconfigure) args.push("-reconfigure");
  for (const bc of flags?.backendConfig ?? []) args.push(`-backend-config=${bc}`);
  return run(args, opts);
}

/** `terraform validate` — check configuration syntax. */
export async function tfValidate(opts: TfCliOptions): Promise<TfCliResult> {
  const result = await run(["validate", "-json", "-no-color"], opts);
  if (result.stdout) {
    try {
      result.json = JSON.parse(result.stdout);
    } catch { /* not JSON */ }
  }
  return result;
}

/** `terraform plan` — generate an execution plan. */
export async function tfPlan(
  opts: TfCliOptions,
  flags?: { destroy?: boolean; target?: string[]; varFile?: string; out?: string },
): Promise<TfCliResult> {
  const args = ["plan", "-input=false", "-no-color"];
  if (flags?.destroy) args.push("-destroy");
  for (const t of flags?.target ?? []) args.push(`-target=${t}`);
  if (flags?.varFile) args.push(`-var-file=${flags.varFile}`);
  if (flags?.out) args.push(`-out=${flags.out}`);
  return run(args, opts);
}

/** `terraform plan -json` — generate plan with JSON output. */
export async function tfPlanJson(
  opts: TfCliOptions,
  flags?: { destroy?: boolean; target?: string[]; varFile?: string },
): Promise<TfCliResult> {
  // First produce a binary plan file, then show it as JSON
  const planFile = ".espada-plan.tfplan";
  const planResult = await tfPlan(opts, { ...flags, out: planFile });
  if (!planResult.success) return planResult;

  const showResult = await tfShow(opts, { planFile, json: true });
  // Clean up plan file
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(`${opts.cwd}/${planFile}`);
  } catch { /* best effort */ }
  return showResult;
}

/** `terraform apply` — apply changes. */
export async function tfApply(
  opts: TfCliOptions,
  flags?: { autoApprove?: boolean; planFile?: string; target?: string[]; varFile?: string },
): Promise<TfCliResult> {
  const args = ["apply", "-input=false", "-no-color"];
  if (flags?.autoApprove !== false) args.push("-auto-approve");
  for (const t of flags?.target ?? []) args.push(`-target=${t}`);
  if (flags?.varFile) args.push(`-var-file=${flags.varFile}`);
  if (flags?.planFile) args.push(flags.planFile);
  return run(args, opts);
}

/** `terraform destroy` — destroy all resources. */
export async function tfDestroy(
  opts: TfCliOptions,
  flags?: { autoApprove?: boolean; target?: string[]; varFile?: string },
): Promise<TfCliResult> {
  const args = ["destroy", "-input=false", "-no-color"];
  if (flags?.autoApprove !== false) args.push("-auto-approve");
  for (const t of flags?.target ?? []) args.push(`-target=${t}`);
  if (flags?.varFile) args.push(`-var-file=${flags.varFile}`);
  return run(args, opts);
}

/** `terraform show` — show state or plan in JSON format. */
export async function tfShow(
  opts: TfCliOptions,
  flags?: { planFile?: string; json?: boolean },
): Promise<TfCliResult> {
  const args = ["show", "-no-color"];
  if (flags?.json) args.push("-json");
  if (flags?.planFile) args.push(flags.planFile);
  const result = await run(args, opts);
  if (flags?.json && result.stdout) {
    try {
      result.json = JSON.parse(result.stdout);
    } catch { /* not JSON */ }
  }
  return result;
}

/** `terraform import` — import existing infrastructure. */
export async function tfImport(
  opts: TfCliOptions,
  address: string,
  id: string,
): Promise<TfCliResult> {
  return run(["import", "-no-color", "-input=false", address, id], opts);
}

/** `terraform state list` — list resources in state. */
export async function tfStateList(opts: TfCliOptions): Promise<TfCliResult> {
  const result = await run(["state", "list"], opts);
  return result;
}

/** `terraform state pull` — pull remote state as JSON. */
export async function tfStatePull(opts: TfCliOptions): Promise<TfCliResult> {
  const result = await run(["state", "pull"], opts);
  if (result.stdout) {
    try {
      result.json = JSON.parse(result.stdout);
    } catch { /* not JSON */ }
  }
  return result;
}

/** `terraform state rm` — remove a resource from state. */
export async function tfStateRm(
  opts: TfCliOptions,
  address: string,
): Promise<TfCliResult> {
  return run(["state", "rm", address], opts);
}

/** `terraform state mv` — move a resource in state. */
export async function tfStateMv(
  opts: TfCliOptions,
  source: string,
  destination: string,
): Promise<TfCliResult> {
  return run(["state", "mv", source, destination], opts);
}

/** `terraform output` — read outputs. */
export async function tfOutput(
  opts: TfCliOptions,
  flags?: { json?: boolean; name?: string },
): Promise<TfCliResult> {
  const args = ["output", "-no-color"];
  if (flags?.json) args.push("-json");
  if (flags?.name) args.push(flags.name);
  const result = await run(args, opts);
  if (flags?.json && result.stdout) {
    try {
      result.json = JSON.parse(result.stdout);
    } catch { /* not JSON */ }
  }
  return result;
}

/** `terraform fmt` — format .tf files. */
export async function tfFmt(
  opts: TfCliOptions,
  flags?: { check?: boolean; recursive?: boolean },
): Promise<TfCliResult> {
  const args = ["fmt", "-no-color"];
  if (flags?.check) args.push("-check");
  if (flags?.recursive) args.push("-recursive");
  return run(args, opts);
}

/** `terraform version` — get version info. */
export async function tfVersion(opts: TfCliOptions): Promise<TfCliResult> {
  const result = await run(["version", "-json"], opts);
  if (result.stdout) {
    try {
      result.json = JSON.parse(result.stdout);
    } catch { /* not JSON */ }
  }
  return result;
}

/** Check if terraform is installed and accessible. */
export async function isTerraformInstalled(
  terraformBin?: string,
): Promise<{ installed: boolean; version?: string }> {
  try {
    const result = await tfVersion({ cwd: ".", terraformBin });
    if (!result.success) return { installed: false };
    const json = result.json as { terraform_version?: string } | undefined;
    return { installed: true, version: json?.terraform_version ?? result.stdout.trim() };
  } catch {
    return { installed: false };
  }
}
