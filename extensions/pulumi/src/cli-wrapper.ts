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
}

/** Run a pulumi CLI command and return stdout. */
async function runPulumi(
  args: string[],
  options: PulumiCliOptions = {},
): Promise<string> {
  const env = { ...process.env, ...options.env, PULUMI_SKIP_UPDATE_CHECK: "1" };
  const { stdout } = await execFileAsync("pulumi", args, {
    cwd: options.cwd,
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
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
