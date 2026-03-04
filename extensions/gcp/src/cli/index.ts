/**
 * GCP CLI Manager
 *
 * Provides a typed wrapper around the `gcloud` CLI for operations
 * that are more convenient via CLI than REST API, such as
 * authentication flows, project configuration, and quick queries.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

export type CliExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: unknown;
};

export type GcloudConfig = {
  project: string;
  account: string;
  region: string;
  zone: string;
  properties: Record<string, Record<string, string>>;
};

export type GcloudComponent = {
  id: string;
  name: string;
  state: "Installed" | "Not Installed" | "Update Available";
  currentVersion?: string;
  latestVersion?: string;
};

export type CliExecOptions = {
  project?: string;
  format?: "json" | "text" | "yaml" | "csv" | "table";
  quiet?: boolean;
  timeout?: number;
  env?: Record<string, string>;
};

// =============================================================================
// Manager
// =============================================================================

export class GcpCliManager {
  private projectId: string;
  private gcloudPath: string;

  constructor(projectId: string, gcloudPath?: string) {
    this.projectId = projectId;
    this.gcloudPath = gcloudPath ?? "gcloud";
  }

  // ---------------------------------------------------------------------------
  // Core execution
  // ---------------------------------------------------------------------------

  async exec(args: string[], opts: CliExecOptions = {}): Promise<CliExecResult> {
    const fullArgs = [...args];
    const project = opts.project ?? this.projectId;
    if (project && !args.includes("--project")) {
      fullArgs.push("--project", project);
    }
    const format = opts.format ?? "json";
    if (!args.includes("--format")) {
      fullArgs.push("--format", format);
    }
    if (opts.quiet && !args.includes("--quiet")) {
      fullArgs.push("--quiet");
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.gcloudPath, fullArgs, {
        timeout: opts.timeout ?? 60_000,
        env: { ...process.env, ...opts.env },
        maxBuffer: 10 * 1024 * 1024,
      });

      let parsed: unknown;
      if (format === "json" && stdout.trim()) {
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // Not valid JSON — return raw
        }
      }

      return { stdout, stderr, exitCode: 0, parsed };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: execErr.stdout ?? "",
        stderr: execErr.stderr ?? String(err),
        exitCode: execErr.code ?? 1,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  async getConfig(): Promise<GcloudConfig> {
    const result = await this.exec(["config", "list"], { format: "json" });
    const config = (result.parsed ?? {}) as Record<string, Record<string, string>>;
    const core = config.core ?? {};
    const compute = config.compute ?? {};

    return {
      project: core.project ?? this.projectId,
      account: core.account ?? "",
      region: compute.region ?? "",
      zone: compute.zone ?? "",
      properties: config,
    };
  }

  async setProject(projectId: string): Promise<CliExecResult> {
    return this.exec(["config", "set", "project", projectId], { format: "text", project: "" });
  }

  async setRegion(region: string): Promise<CliExecResult> {
    return this.exec(["config", "set", "compute/region", region], { format: "text" });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async getActiveAccount(): Promise<string> {
    const result = await this.exec(["auth", "list", "--filter=status:ACTIVE"], { format: "json" });
    const accounts = (result.parsed ?? []) as Array<Record<string, string>>;
    return accounts[0]?.account ?? "";
  }

  async getAccessToken(): Promise<string> {
    const result = await this.exec(["auth", "print-access-token"], { format: "text" });
    return result.stdout.trim();
  }

  async listAuthAccounts(): Promise<Array<{ account: string; status: string }>> {
    const result = await this.exec(["auth", "list"], { format: "json" });
    return (result.parsed ?? []) as Array<{ account: string; status: string }>;
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async listProjects(): Promise<Array<Record<string, unknown>>> {
    const result = await this.exec(["projects", "list"], { format: "json", project: "" });
    return (result.parsed ?? []) as Array<Record<string, unknown>>;
  }

  async describeProject(projectId?: string): Promise<Record<string, unknown>> {
    const id = projectId ?? this.projectId;
    const result = await this.exec(["projects", "describe", id], { format: "json", project: "" });
    return (result.parsed ?? {}) as Record<string, unknown>;
  }

  // ---------------------------------------------------------------------------
  // Services / APIs
  // ---------------------------------------------------------------------------

  async listEnabledServices(): Promise<string[]> {
    const result = await this.exec(["services", "list", "--enabled"], { format: "json" });
    const services = (result.parsed ?? []) as Array<Record<string, unknown>>;
    return services.map((s) => String((s.config as Record<string, unknown>)?.name ?? s.name ?? ""));
  }

  async enableService(serviceName: string): Promise<CliExecResult> {
    return this.exec(["services", "enable", serviceName], { quiet: true });
  }

  async disableService(serviceName: string, force?: boolean): Promise<CliExecResult> {
    const args = ["services", "disable", serviceName];
    if (force) args.push("--force");
    return this.exec(args, { quiet: true });
  }

  // ---------------------------------------------------------------------------
  // Components
  // ---------------------------------------------------------------------------

  async listComponents(): Promise<GcloudComponent[]> {
    const result = await this.exec(["components", "list"], { format: "json", project: "" });
    const components = (result.parsed ?? []) as Array<Record<string, unknown>>;
    return components.map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? ""),
      state: ((c.state as Record<string, unknown>)?.name ?? c.current_version_string ? "Installed" : "Not Installed") as GcloudComponent["state"],
      currentVersion: c.current_version_string ? String(c.current_version_string) : undefined,
      latestVersion: c.latest_version_string ? String(c.latest_version_string) : undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // Quick queries — convenience wrappers
  // ---------------------------------------------------------------------------

  async listInstances(zone?: string): Promise<Array<Record<string, unknown>>> {
    const args = ["compute", "instances", "list"];
    if (zone) args.push("--zones", zone);
    const result = await this.exec(args, { format: "json" });
    return (result.parsed ?? []) as Array<Record<string, unknown>>;
  }

  async listBuckets(): Promise<Array<Record<string, unknown>>> {
    const result = await this.exec(["storage", "buckets", "list"], { format: "json" });
    return (result.parsed ?? []) as Array<Record<string, unknown>>;
  }

  async listClusters(region?: string): Promise<Array<Record<string, unknown>>> {
    const args = ["container", "clusters", "list"];
    if (region) args.push("--region", region);
    const result = await this.exec(args, { format: "json" });
    return (result.parsed ?? []) as Array<Record<string, unknown>>;
  }

  async listCloudRunServices(region?: string): Promise<Array<Record<string, unknown>>> {
    const args = ["run", "services", "list"];
    if (region) args.push("--region", region);
    const result = await this.exec(args, { format: "json" });
    return (result.parsed ?? []) as Array<Record<string, unknown>>;
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  async version(): Promise<string> {
    const result = await this.exec(["version"], { format: "text", project: "" });
    return result.stdout.trim();
  }

  async checkInstallation(): Promise<{ installed: boolean; version?: string; path: string }> {
    try {
      const ver = await this.version();
      return { installed: true, version: ver.split("\n")[0], path: this.gcloudPath };
    } catch {
      return { installed: false, path: this.gcloudPath };
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCliManager(
  projectId: string,
  gcloudPath?: string,
): GcpCliManager {
  return new GcpCliManager(projectId, gcloudPath);
}
