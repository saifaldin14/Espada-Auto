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
}

/** Run a kubectl command and return stdout. */
async function runKubectl(
  args: string[],
  options: KubectlOptions = {},
): Promise<string> {
  const fullArgs = [...args];
  if (options.namespace) fullArgs.push("-n", options.namespace);
  if (options.context) fullArgs.push("--context", options.context);
  if (options.kubeconfig) fullArgs.push("--kubeconfig", options.kubeconfig);

  const env = { ...process.env, ...options.env };
  const { stdout } = await execFileAsync("kubectl", fullArgs, {
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
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
  try {
    return await runKubectl(["diff", "-f", filePath], options);
  } catch (err: unknown) {
    // kubectl diff exits 1 when there are differences — capture stdout
    if (typeof err === "object" && err !== null && "stdout" in err) {
      return (err as { stdout: string }).stdout;
    }
    throw err;
  }
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
