/**
 * Helm agent tools — install, upgrade, uninstall, list, status, rollback,
 * history, get-values, template, repo-add, repo-update, search.
 */

import { Type } from "@sinclair/typebox";

export function createHelmTools() {
  return [
    helmInstallTool,
    helmUpgradeTool,
    helmUninstallTool,
    helmListTool,
    helmStatusTool,
    helmRollbackTool,
    helmHistoryTool,
    helmGetValuesTool,
    helmTemplateTool,
    helmRepoAddTool,
    helmRepoUpdateTool,
    helmSearchTool,
  ];
}

/* ---------- helm_install ---------- */

const helmInstallTool = {
  name: "helm_install",
  description:
    "Install a Helm chart as a new release. Supports custom values, version pinning, namespace creation, and dry-run mode.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name" }),
    chart: Type.String({ description: "Chart reference (e.g. bitnami/nginx, ./my-chart, oci://...)" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace to install into" })),
    valuesFile: Type.Optional(Type.String({ description: "Path to values YAML file" })),
    setValues: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Inline key=value overrides (e.g. { \"replicaCount\": \"3\" })",
      }),
    ),
    version: Type.Optional(Type.String({ description: "Specific chart version to install" })),
    wait: Type.Optional(Type.Boolean({ description: "Wait for all resources to be ready" })),
    timeout: Type.Optional(Type.String({ description: "Timeout for --wait (e.g. \"5m0s\")" })),
    createNamespace: Type.Optional(Type.Boolean({ description: "Create the namespace if it doesn't exist" })),
    dryRun: Type.Optional(Type.Boolean({ description: "Simulate installation without making changes" })),
    generateName: Type.Optional(Type.Boolean({ description: "Auto-generate a release name" })),
    description: Type.Optional(Type.String({ description: "Human-readable description for the release" })),
  }),
  execute: async (input: {
    release: string;
    chart: string;
    namespace?: string;
    valuesFile?: string;
    setValues?: Record<string, string>;
    version?: string;
    wait?: boolean;
    timeout?: string;
    createNamespace?: boolean;
    dryRun?: boolean;
    generateName?: boolean;
    description?: string;
  }) => {
    try {
      const { helmInstall } = await import("./helm-wrapper.js");
      const result = await helmInstall(input.release, input.chart, {
        namespace: input.namespace,
        valuesFile: input.valuesFile,
        setValues: input.setValues,
        version: input.version,
        wait: input.wait,
        timeout: input.timeout,
        createNamespace: input.createNamespace,
        dryRun: input.dryRun,
        generateName: input.generateName,
        description: input.description,
      });
      return {
        content: [{ type: "text" as const, text: `Helm install succeeded:\n${result}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm install failed: ${err}` }] };
    }
  },
};

/* ---------- helm_upgrade ---------- */

const helmUpgradeTool = {
  name: "helm_upgrade",
  description:
    "Upgrade an existing Helm release to a new chart version or values. Supports --install to create if missing.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name" }),
    chart: Type.String({ description: "Chart reference" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    install: Type.Optional(Type.Boolean({ description: "Install the chart if the release doesn't exist (--install)" })),
    force: Type.Optional(Type.Boolean({ description: "Force resource updates through a replacement strategy" })),
    resetValues: Type.Optional(Type.Boolean({ description: "Reset values to chart defaults on upgrade" })),
    reuseValues: Type.Optional(Type.Boolean({ description: "Reuse the last release's values" })),
    valuesFile: Type.Optional(Type.String({ description: "Path to values YAML file" })),
    setValues: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Inline key=value overrides",
      }),
    ),
    version: Type.Optional(Type.String({ description: "Specific chart version" })),
    wait: Type.Optional(Type.Boolean({ description: "Wait for resources to be ready" })),
    timeout: Type.Optional(Type.String({ description: "Timeout for --wait" })),
    createNamespace: Type.Optional(Type.Boolean({ description: "Create the namespace if it doesn't exist" })),
    dryRun: Type.Optional(Type.Boolean({ description: "Simulate upgrade without making changes" })),
    description: Type.Optional(Type.String({ description: "Description for the release" })),
  }),
  execute: async (input: {
    release: string;
    chart: string;
    namespace?: string;
    install?: boolean;
    force?: boolean;
    resetValues?: boolean;
    reuseValues?: boolean;
    valuesFile?: string;
    setValues?: Record<string, string>;
    version?: string;
    wait?: boolean;
    timeout?: string;
    createNamespace?: boolean;
    dryRun?: boolean;
    description?: string;
  }) => {
    try {
      const { helmUpgrade } = await import("./helm-wrapper.js");
      const result = await helmUpgrade(input.release, input.chart, {
        namespace: input.namespace,
        install: input.install,
        force: input.force,
        resetValues: input.resetValues,
        reuseValues: input.reuseValues,
        valuesFile: input.valuesFile,
        setValues: input.setValues,
        version: input.version,
        wait: input.wait,
        timeout: input.timeout,
        createNamespace: input.createNamespace,
        dryRun: input.dryRun,
        description: input.description,
      });
      return {
        content: [{ type: "text" as const, text: `Helm upgrade succeeded:\n${result}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm upgrade failed: ${err}` }] };
    }
  },
};

/* ---------- helm_uninstall ---------- */

const helmUninstallTool = {
  name: "helm_uninstall",
  description:
    "Uninstall a Helm release. Use with caution — this removes all resources managed by the release.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name to uninstall" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    keepHistory: Type.Optional(Type.Boolean({ description: "Keep release history for potential rollback" })),
    wait: Type.Optional(Type.Boolean({ description: "Wait for deletion to complete" })),
    timeout: Type.Optional(Type.String({ description: "Timeout for --wait" })),
    dryRun: Type.Optional(Type.Boolean({ description: "Simulate uninstall without making changes" })),
  }),
  execute: async (input: {
    release: string;
    namespace?: string;
    keepHistory?: boolean;
    wait?: boolean;
    timeout?: string;
    dryRun?: boolean;
  }) => {
    try {
      const { helmUninstall } = await import("./helm-wrapper.js");
      const result = await helmUninstall(input.release, {
        namespace: input.namespace,
        keepHistory: input.keepHistory,
        wait: input.wait,
        timeout: input.timeout,
        dryRun: input.dryRun,
      });
      return {
        content: [{ type: "text" as const, text: `Helm uninstall succeeded:\n${result}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm uninstall failed: ${err}` }] };
    }
  },
};

/* ---------- helm_list ---------- */

const helmListTool = {
  name: "helm_list",
  description: "List all Helm releases, optionally filtered by namespace or name pattern.",
  inputSchema: Type.Object({
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    allNamespaces: Type.Optional(Type.Boolean({ description: "List releases across all namespaces" })),
    filter: Type.Optional(Type.String({ description: "Regex filter for release names" })),
  }),
  execute: async (input: {
    namespace?: string;
    allNamespaces?: boolean;
    filter?: string;
  }) => {
    try {
      const { helmList } = await import("./helm-wrapper.js");
      const releases = await helmList({
        namespace: input.namespace,
        allNamespaces: input.allNamespaces,
        filter: input.filter,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: releases.length, releases },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm list failed: ${err}` }] };
    }
  },
};

/* ---------- helm_status ---------- */

const helmStatusTool = {
  name: "helm_status",
  description: "Show the status of a Helm release including revision, chart, and resource state.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
  }),
  execute: async (input: { release: string; namespace?: string }) => {
    try {
      const { helmStatus } = await import("./helm-wrapper.js");
      const result = await helmStatus(input.release, {
        namespace: input.namespace,
      });
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm status failed: ${err}` }] };
    }
  },
};

/* ---------- helm_rollback ---------- */

const helmRollbackTool = {
  name: "helm_rollback",
  description:
    "Roll back a Helm release to a previous revision. Use helm_history to find available revisions.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name" }),
    revision: Type.Number({ description: "Revision number to roll back to" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    wait: Type.Optional(Type.Boolean({ description: "Wait for resources to be ready" })),
    timeout: Type.Optional(Type.String({ description: "Timeout for --wait" })),
    force: Type.Optional(Type.Boolean({ description: "Force resource updates" })),
  }),
  execute: async (input: {
    release: string;
    revision: number;
    namespace?: string;
    wait?: boolean;
    timeout?: string;
    force?: boolean;
  }) => {
    try {
      const { helmRollback } = await import("./helm-wrapper.js");
      const result = await helmRollback(input.release, input.revision, {
        namespace: input.namespace,
        wait: input.wait,
        timeout: input.timeout,
        force: input.force,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Rolled back ${input.release} to revision ${input.revision}:\n${result}`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm rollback failed: ${err}` }] };
    }
  },
};

/* ---------- helm_history ---------- */

const helmHistoryTool = {
  name: "helm_history",
  description: "Show the revision history of a Helm release.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
  }),
  execute: async (input: { release: string; namespace?: string }) => {
    try {
      const { helmHistory } = await import("./helm-wrapper.js");
      const entries = await helmHistory(input.release, {
        namespace: input.namespace,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { release: input.release, revisions: entries.length, history: entries },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm history failed: ${err}` }] };
    }
  },
};

/* ---------- helm_get_values ---------- */

const helmGetValuesTool = {
  name: "helm_get_values",
  description: "Get the values currently applied to a Helm release.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    allValues: Type.Optional(Type.Boolean({ description: "Include computed (default) values in addition to user-supplied ones" })),
  }),
  execute: async (input: { release: string; namespace?: string; allValues?: boolean }) => {
    try {
      const { helmGetValues } = await import("./helm-wrapper.js");
      const values = await helmGetValues(input.release, {
        namespace: input.namespace,
        allValues: input.allValues,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(values, null, 2),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm get values failed: ${err}` }] };
    }
  },
};

/* ---------- helm_template ---------- */

const helmTemplateTool = {
  name: "helm_template",
  description:
    "Render Helm chart templates locally without installing. Useful for reviewing generated manifests before deployment.",
  inputSchema: Type.Object({
    release: Type.String({ description: "Release name (used in rendered output)" }),
    chart: Type.String({ description: "Chart reference" }),
    namespace: Type.Optional(Type.String({ description: "Namespace for rendered metadata" })),
    valuesFile: Type.Optional(Type.String({ description: "Path to values YAML file" })),
    setValues: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Inline key=value overrides",
      }),
    ),
    version: Type.Optional(Type.String({ description: "Specific chart version" })),
    showOnly: Type.Optional(
      Type.Array(Type.String(), { description: "Only show specific template files (e.g. [\"templates/deployment.yaml\"])" }),
    ),
  }),
  execute: async (input: {
    release: string;
    chart: string;
    namespace?: string;
    valuesFile?: string;
    setValues?: Record<string, string>;
    version?: string;
    showOnly?: string[];
  }) => {
    try {
      const { helmTemplate } = await import("./helm-wrapper.js");
      const result = await helmTemplate(input.release, input.chart, {
        namespace: input.namespace,
        valuesFile: input.valuesFile,
        setValues: input.setValues,
        version: input.version,
        showOnly: input.showOnly,
      });
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm template failed: ${err}` }] };
    }
  },
};

/* ---------- helm_repo_add ---------- */

const helmRepoAddTool = {
  name: "helm_repo_add",
  description: "Add a Helm chart repository by name and URL.",
  inputSchema: Type.Object({
    name: Type.String({ description: "Repository name (e.g. bitnami)" }),
    url: Type.String({ description: "Repository URL (e.g. https://charts.bitnami.com/bitnami)" }),
    forceUpdate: Type.Optional(Type.Boolean({ description: "Replace existing repo entry if it already exists" })),
  }),
  execute: async (input: { name: string; url: string; forceUpdate?: boolean }) => {
    try {
      const { helmRepoAdd } = await import("./helm-wrapper.js");
      const result = await helmRepoAdd(input.name, input.url, {
        forceUpdate: input.forceUpdate,
      });
      return {
        content: [{ type: "text" as const, text: `Repo added:\n${result}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm repo add failed: ${err}` }] };
    }
  },
};

/* ---------- helm_repo_update ---------- */

const helmRepoUpdateTool = {
  name: "helm_repo_update",
  description: "Update all configured Helm chart repositories to fetch the latest chart listings.",
  inputSchema: Type.Object({}),
  execute: async () => {
    try {
      const { helmRepoUpdate } = await import("./helm-wrapper.js");
      const result = await helmRepoUpdate();
      return {
        content: [{ type: "text" as const, text: `Repo update succeeded:\n${result}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm repo update failed: ${err}` }] };
    }
  },
};

/* ---------- helm_search ---------- */

const helmSearchTool = {
  name: "helm_search",
  description:
    "Search Helm chart repositories for charts matching a keyword. Requires repos to be added first with helm_repo_add.",
  inputSchema: Type.Object({
    keyword: Type.String({ description: "Search keyword (e.g. nginx, postgres)" }),
    version: Type.Optional(Type.String({ description: "Specific chart version constraint (e.g. \">1.0.0\")" })),
    versions: Type.Optional(Type.Boolean({ description: "Show all available versions, not just the latest" })),
  }),
  execute: async (input: { keyword: string; version?: string; versions?: boolean }) => {
    try {
      const { helmSearchRepo } = await import("./helm-wrapper.js");
      const results = await helmSearchRepo(input.keyword, {
        version: input.version,
        versions: input.versions,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: results.length, charts: results },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Helm search failed: ${err}` }] };
    }
  },
};
