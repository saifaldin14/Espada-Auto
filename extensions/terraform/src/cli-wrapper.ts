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
}

/** Result from a Terraform CLI command. */
export interface TfCliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Parsed JSON output when available (plan -json, show -json, etc.). */
  json?: unknown;
}

/** Resolve the terraform binary path. */
function tfBin(opts: TfCliOptions): string {
  return opts.terraformBin ?? "terraform";
}

/** Core exec helper. */
async function run(
  args: string[],
  opts: TfCliOptions,
): Promise<TfCliResult> {
  const bin = tfBin(opts);
  const timeout = opts.timeout ?? 300_000;
  const env = { ...process.env, ...opts.env, TF_IN_AUTOMATION: "1" };

  try {
    const { stdout, stderr } = await execFile(bin, args, {
      cwd: opts.cwd,
      env,
      timeout,
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    });
    return { success: true, stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return {
      success: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? (err instanceof Error ? err.message : String(err)),
      exitCode,
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
