/**
 * Helm CLI wrapper — wraps the `helm` binary for install, upgrade, uninstall,
 * list, status, rollback, repo, search, template, history, get values.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  HelmGlobalOptions,
  HelmInstallOptions,
  HelmUpgradeOptions,
  HelmRollbackOptions,
  HelmUninstallOptions,
  HelmTemplateOptions,
  HelmListOptions,
  HelmRelease,
  HelmHistoryEntry,
  HelmSearchResult,
  HelmRepo,
} from "./helm-types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/** Run a helm command and return stdout. */
async function runHelm(
  args: string[],
  options: HelmGlobalOptions = {},
): Promise<string> {
  const fullArgs = [...args];
  if (options.namespace) fullArgs.push("--namespace", options.namespace);
  if (options.kubeContext) fullArgs.push("--kube-context", options.kubeContext);
  if (options.kubeconfig) fullArgs.push("--kubeconfig", options.kubeconfig);

  const { stdout } = await execFileAsync("helm", fullArgs, {
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

/** Append common install/upgrade flags. */
function appendInstallFlags(args: string[], opts: HelmInstallOptions): void {
  if (opts.valuesFile) args.push("-f", opts.valuesFile);
  if (opts.setValues) {
    for (const [k, v] of Object.entries(opts.setValues)) {
      args.push("--set", `${k}=${v}`);
    }
  }
  if (opts.version) args.push("--version", opts.version);
  if (opts.wait) args.push("--wait");
  if (opts.timeout) args.push("--timeout", opts.timeout);
  if (opts.createNamespace) args.push("--create-namespace");
  if (opts.dryRun) args.push("--dry-run");
  if (opts.description) args.push("--description", opts.description);
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Run `helm install <release> <chart>`.
 * Returns the raw output from helm.
 */
export async function helmInstall(
  release: string,
  chart: string,
  options: HelmInstallOptions = {},
): Promise<string> {
  const args = ["install", release, chart];
  if (options.generateName) {
    // When generateName is used, release is the chart
    args.splice(1, 1); // remove release name
    args.push("--generate-name");
  }
  appendInstallFlags(args, options);
  return runHelm(args, options);
}

// ---------------------------------------------------------------------------
// Upgrade
// ---------------------------------------------------------------------------

/**
 * Run `helm upgrade <release> <chart>`.
 */
export async function helmUpgrade(
  release: string,
  chart: string,
  options: HelmUpgradeOptions = {},
): Promise<string> {
  const args = ["upgrade", release, chart];
  if (options.install) args.push("--install");
  if (options.force) args.push("--force");
  if (options.resetValues) args.push("--reset-values");
  if (options.reuseValues) args.push("--reuse-values");
  appendInstallFlags(args, options);
  return runHelm(args, options);
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

/**
 * Run `helm uninstall <release>`.
 */
export async function helmUninstall(
  release: string,
  options: HelmUninstallOptions = {},
): Promise<string> {
  const args = ["uninstall", release];
  if (options.keepHistory) args.push("--keep-history");
  if (options.wait) args.push("--wait");
  if (options.timeout) args.push("--timeout", options.timeout);
  if (options.dryRun) args.push("--dry-run");
  return runHelm(args, options);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Run `helm list -o json` and return typed releases.
 */
export async function helmList(
  options: HelmListOptions = {},
): Promise<HelmRelease[]> {
  const args = ["list", "-o", "json"];
  if (options.allNamespaces) args.push("--all-namespaces");
  if (options.filter) args.push("--filter", options.filter);
  const stdout = await runHelm(args, options);
  return JSON.parse(stdout) as HelmRelease[];
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Run `helm status <release> -o json` and return raw JSON.
 */
export async function helmStatus(
  release: string,
  options: HelmGlobalOptions = {},
): Promise<string> {
  return runHelm(["status", release, "-o", "json"], options);
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * Run `helm rollback <release> <revision>`.
 */
export async function helmRollback(
  release: string,
  revision: number,
  options: HelmRollbackOptions = {},
): Promise<string> {
  const args = ["rollback", release, String(revision)];
  if (options.wait) args.push("--wait");
  if (options.timeout) args.push("--timeout", options.timeout);
  if (options.force) args.push("--force");
  return runHelm(args, options);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Run `helm history <release> -o json` and return typed entries.
 */
export async function helmHistory(
  release: string,
  options: HelmGlobalOptions = {},
): Promise<HelmHistoryEntry[]> {
  const stdout = await runHelm(["history", release, "-o", "json"], options);
  return JSON.parse(stdout) as HelmHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Get Values
// ---------------------------------------------------------------------------

/**
 * Run `helm get values <release> -o json` and return the values object.
 */
export async function helmGetValues(
  release: string,
  options: HelmGlobalOptions & { allValues?: boolean } = {},
): Promise<Record<string, unknown>> {
  const args = ["get", "values", release, "-o", "json"];
  if (options.allValues) args.push("--all");
  const stdout = await runHelm(args, options);
  return JSON.parse(stdout) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/**
 * Run `helm template <release> <chart>` to render templates locally.
 */
export async function helmTemplate(
  release: string,
  chart: string,
  options: HelmTemplateOptions = {},
): Promise<string> {
  const args = ["template", release, chart];
  if (options.valuesFile) args.push("-f", options.valuesFile);
  if (options.setValues) {
    for (const [k, v] of Object.entries(options.setValues)) {
      args.push("--set", `${k}=${v}`);
    }
  }
  if (options.version) args.push("--version", options.version);
  if (options.showOnly) {
    for (const s of options.showOnly) {
      args.push("--show-only", s);
    }
  }
  return runHelm(args, options);
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

/**
 * Run `helm repo add <name> <url>`.
 */
export async function helmRepoAdd(
  name: string,
  url: string,
  options: { forceUpdate?: boolean } = {},
): Promise<string> {
  const args = ["repo", "add", name, url];
  if (options.forceUpdate) args.push("--force-update");
  return runHelm(args);
}

/**
 * Run `helm repo update`.
 */
export async function helmRepoUpdate(): Promise<string> {
  return runHelm(["repo", "update"]);
}

/**
 * Run `helm repo list -o json` and return typed repos.
 */
export async function helmRepoList(): Promise<HelmRepo[]> {
  const stdout = await runHelm(["repo", "list", "-o", "json"]);
  return JSON.parse(stdout) as HelmRepo[];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Run `helm search repo <keyword> -o json` and return typed results.
 */
export async function helmSearchRepo(
  keyword: string,
  options: { version?: string; versions?: boolean } = {},
): Promise<HelmSearchResult[]> {
  const args = ["search", "repo", keyword, "-o", "json"];
  if (options.version) args.push("--version", options.version);
  if (options.versions) args.push("--versions");
  const stdout = await runHelm(args);
  return JSON.parse(stdout) as HelmSearchResult[];
}
