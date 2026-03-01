/**
 * Helm integration types — releases, charts, repositories, history.
 */

/* ---------- Release ---------- */

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: HelmReleaseStatus;
  chart: string;
  app_version: string;
}

export type HelmReleaseStatus =
  | "deployed"
  | "uninstalled"
  | "superseded"
  | "failed"
  | "uninstalling"
  | "pending-install"
  | "pending-upgrade"
  | "pending-rollback"
  | string;

/* ---------- Release History ---------- */

export interface HelmHistoryEntry {
  revision: number;
  updated: string;
  status: HelmReleaseStatus;
  chart: string;
  app_version: string;
  description: string;
}

/* ---------- Chart Search Result ---------- */

export interface HelmSearchResult {
  name: string;
  chart_version: string;
  app_version: string;
  description: string;
}

/* ---------- Repository ---------- */

export interface HelmRepo {
  name: string;
  url: string;
}

/* ---------- Options ---------- */

export interface HelmGlobalOptions {
  namespace?: string;
  kubeconfig?: string;
  kubeContext?: string;
}

export interface HelmInstallOptions extends HelmGlobalOptions {
  /** Path to values YAML file. */
  valuesFile?: string;
  /** Inline --set key=value pairs. */
  setValues?: Record<string, string>;
  /** Specific chart version. */
  version?: string;
  /** Wait for resources to be ready. */
  wait?: boolean;
  /** Timeout for wait (e.g. "5m0s"). */
  timeout?: string;
  /** Create namespace if it doesn't exist. */
  createNamespace?: boolean;
  /** Perform a dry run (no changes). */
  dryRun?: boolean;
  /** Generate release name automatically. */
  generateName?: boolean;
  /** Description for the release. */
  description?: string;
}

export interface HelmUpgradeOptions extends HelmInstallOptions {
  /** Install the chart if the release doesn't exist. */
  install?: boolean;
  /** Force resource updates through a replacement strategy. */
  force?: boolean;
  /** Reset values to chart defaults on upgrade. */
  resetValues?: boolean;
  /** Reuse the last release's values. */
  reuseValues?: boolean;
}

export interface HelmRollbackOptions extends HelmGlobalOptions {
  /** Wait for resources to be ready. */
  wait?: boolean;
  /** Timeout for wait (e.g. "5m0s"). */
  timeout?: string;
  /** Force resource updates. */
  force?: boolean;
}

export interface HelmUninstallOptions extends HelmGlobalOptions {
  /** Keep release history for rollback. */
  keepHistory?: boolean;
  /** Wait for deletion to complete. */
  wait?: boolean;
  /** Timeout for wait. */
  timeout?: string;
  /** Perform a dry run (no changes). */
  dryRun?: boolean;
}

export interface HelmTemplateOptions extends HelmGlobalOptions {
  /** Path to values YAML file. */
  valuesFile?: string;
  /** Inline --set key=value pairs. */
  setValues?: Record<string, string>;
  /** Specific chart version. */
  version?: string;
  /** Show only specific template files. */
  showOnly?: string[];
}

export interface HelmListOptions extends HelmGlobalOptions {
  /** List across all namespaces. */
  allNamespaces?: boolean;
  /** Filter by status. */
  filter?: string;
}
