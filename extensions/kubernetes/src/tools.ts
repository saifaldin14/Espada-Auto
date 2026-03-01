/**
 * Kubernetes agent tools — k8s_apply, k8s_get, k8s_diff, k8s_resources.
 */

import { Type } from "@sinclair/typebox";
import { parseManifestJson, parseResources, getResourceKinds, getNamespaceDistribution, buildResourceGraph, getEdgesByType } from "./manifest-parser.js";

export function createK8sTools() {
  return [k8sResourcesTool, k8sGetTool, k8sDiffTool, k8sApplyTool, k8sDeleteTool, k8sLogsTool, k8sScaleTool, k8sRolloutTool];
}

/* ---------- k8s_resources ---------- */

const k8sResourcesTool = {
  name: "k8s_resources",
  description: "Parse Kubernetes resource JSON (from `kubectl get -o json`) and return normalized resources with relationships.",
  inputSchema: Type.Object({
    resourceJson: Type.String({ description: "JSON output from `kubectl get <resource> -o json`" }),
  }),
  execute: async (input: { resourceJson: string }) => {
    try {
      const manifest = parseManifestJson(input.resourceJson);
      const parsed = parseResources(manifest.resources);
      const kinds = getResourceKinds(parsed);
      const namespaces = getNamespaceDistribution(parsed);
      const graph = buildResourceGraph(parsed);
      const edges = getEdgesByType(parsed);

      const graphObj: Record<string, unknown> = {};
      for (const [k, v] of graph) {
        graphObj[k] = v;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                resourceCount: parsed.length,
                kinds,
                namespaceDistribution: namespaces,
                relationships: edges,
                resources: parsed.map((r) => ({
                  kind: r.kind,
                  name: r.name,
                  namespace: r.namespace,
                  labels: r.labels,
                  relationCount: r.relations.length,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error parsing resources: ${err}` }] };
    }
  },
};

/* ---------- k8s_get ---------- */

const k8sGetTool = {
  name: "k8s_get",
  description: "Run `kubectl get` for a resource type and return parsed results. Requires kubectl to be configured.",
  inputSchema: Type.Object({
    resource: Type.String({ description: "Resource type, e.g. pods, deployments, services" }),
    name: Type.Optional(Type.String({ description: "Specific resource name" })),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    allNamespaces: Type.Optional(Type.Boolean({ description: "Fetch across all namespaces" })),
  }),
  execute: async (input: { resource: string; name?: string; namespace?: string; allNamespaces?: boolean }) => {
    try {
      const { kubectlGet } = await import("./cli-wrapper.js");
      const json = await kubectlGet(input.resource, {
        name: input.name,
        namespace: input.namespace,
        allNamespaces: input.allNamespaces,
      });
      const manifest = parseManifestJson(json);
      const parsed = parseResources(manifest.resources);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: parsed.length,
                resources: parsed.map((r) => ({
                  kind: r.kind,
                  name: r.name,
                  namespace: r.namespace,
                  labels: r.labels,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `kubectl get failed: ${err}` }] };
    }
  },
};

/* ---------- k8s_diff ---------- */

const k8sDiffTool = {
  name: "k8s_diff",
  description: "Run `kubectl diff` against a manifest file to see what would change.",
  inputSchema: Type.Object({
    filePath: Type.String({ description: "Path to YAML manifest file" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
  }),
  execute: async (input: { filePath: string; namespace?: string }) => {
    try {
      const { kubectlDiff } = await import("./cli-wrapper.js");
      const diff = await kubectlDiff(input.filePath, { namespace: input.namespace });
      const hasDiff = diff.trim().length > 0;

      return {
        content: [
          {
            type: "text" as const,
            text: hasDiff
              ? `Differences found:\n\n${diff}`
              : "No differences found — cluster state matches manifest.",
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `kubectl diff failed: ${err}` }] };
    }
  },
};

/* ---------- k8s_apply ---------- */

const k8sApplyTool = {
  name: "k8s_apply",
  description: "Run `kubectl apply` to apply a manifest to the cluster. Use with caution — this modifies live infrastructure.",
  inputSchema: Type.Object({
    filePath: Type.String({ description: "Path to YAML manifest file" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    dryRun: Type.Optional(Type.Boolean({ description: "If true, perform a server-side dry run" })),
  }),
  execute: async (input: { filePath: string; namespace?: string; dryRun?: boolean }) => {
    try {
      if (input.dryRun) {
        const { kubectlApplyDryRun } = await import("./cli-wrapper.js");
        const result = await kubectlApplyDryRun(input.filePath, { namespace: input.namespace });
        return {
          content: [{ type: "text" as const, text: `Dry run result:\n${result}` }],
        };
      }

      const { kubectlApply } = await import("./cli-wrapper.js");
      const result = await kubectlApply(input.filePath, { namespace: input.namespace });
      return {
        content: [{ type: "text" as const, text: `Applied successfully:\n${result}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `kubectl apply failed: ${err}` }] };
    }
  },
};

/* ---------- k8s_delete ---------- */

const k8sDeleteTool = {
  name: "k8s_delete",
  description: "Run `kubectl delete` to remove a resource from the cluster. Use with caution — this permanently deletes live resources.",
  inputSchema: Type.Object({
    resource: Type.String({ description: "Resource type, e.g. pod, deployment, service, configmap" }),
    name: Type.String({ description: "Name of the resource to delete" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    force: Type.Optional(Type.Boolean({ description: "Force deletion (immediate, no graceful shutdown)" })),
    gracePeriod: Type.Optional(Type.Number({ description: "Grace period in seconds before force-killing (0 = immediate)" })),
  }),
  execute: async (input: { resource: string; name: string; namespace?: string; force?: boolean; gracePeriod?: number }) => {
    try {
      const { kubectlDelete } = await import("./cli-wrapper.js");
      const result = await kubectlDelete(input.resource, input.name, {
        namespace: input.namespace,
        force: input.force,
        gracePeriod: input.gracePeriod,
      });
      return {
        content: [{ type: "text" as const, text: `Deleted successfully:\n${result}` }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `kubectl delete failed: ${err}` }] };
    }
  },
};

/* ---------- k8s_logs ---------- */

const k8sLogsTool = {
  name: "k8s_logs",
  description: "Run `kubectl logs` to retrieve container logs from a pod. Essential for debugging and incident triage.",
  inputSchema: Type.Object({
    pod: Type.String({ description: "Pod name" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    container: Type.Optional(Type.String({ description: "Container name (required for multi-container pods)" })),
    previous: Type.Optional(Type.Boolean({ description: "Show logs from the previously terminated container" })),
    tail: Type.Optional(Type.Number({ description: "Number of most recent log lines to return (default: 1000)" })),
    since: Type.Optional(Type.String({ description: "Show logs newer than a relative duration, e.g. 5m, 1h, 2h30m" })),
    sinceTime: Type.Optional(Type.String({ description: "Show logs after an RFC3339 timestamp, e.g. 2024-01-15T10:00:00Z" })),
    timestamps: Type.Optional(Type.Boolean({ description: "Include timestamps on each log line" })),
  }),
  execute: async (input: {
    pod: string;
    namespace?: string;
    container?: string;
    previous?: boolean;
    tail?: number;
    since?: string;
    sinceTime?: string;
    timestamps?: boolean;
  }) => {
    try {
      const { kubectlLogs } = await import("./cli-wrapper.js");
      const logs = await kubectlLogs(input.pod, {
        namespace: input.namespace,
        container: input.container,
        previous: input.previous,
        tail: input.tail ?? 1000,
        since: input.since,
        sinceTime: input.sinceTime,
        timestamps: input.timestamps,
      });

      const lineCount = logs.split("\n").filter((l) => l.length > 0).length;
      return {
        content: [
          {
            type: "text" as const,
            text: `Logs from pod ${input.pod}${input.container ? ` (container: ${input.container})` : ""}${input.previous ? " [previous instance]" : ""} — ${lineCount} line(s):\n\n${logs}`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `kubectl logs failed: ${err}` }] };
    }
  },
};

/* ---------- k8s_scale ---------- */

const k8sScaleTool = {
  name: "k8s_scale",
  description: "Run `kubectl scale` to change the replica count of a deployment, statefulset, or replicaset.",
  inputSchema: Type.Object({
    resource: Type.String({ description: "Resource type, e.g. deployment, statefulset, replicaset" }),
    name: Type.String({ description: "Resource name" }),
    replicas: Type.Number({ description: "Target replica count" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
  }),
  execute: async (input: { resource: string; name: string; replicas: number; namespace?: string }) => {
    try {
      const { kubectlScale } = await import("./cli-wrapper.js");
      const result = await kubectlScale(input.resource, input.name, input.replicas, {
        namespace: input.namespace,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Scaled ${input.resource}/${input.name} to ${input.replicas} replica(s):\n${result}`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `kubectl scale failed: ${err}` }] };
    }
  },
};

/* ---------- k8s_rollout ---------- */

const k8sRolloutTool = {
  name: "k8s_rollout",
  description:
    "Manage Kubernetes rollouts — restart a deployment, undo/rollback to a previous revision, check rollout status, or view rollout history.",
  inputSchema: Type.Object({
    action: Type.Union(
      [
        Type.Literal("restart"),
        Type.Literal("undo"),
        Type.Literal("status"),
        Type.Literal("history"),
      ],
      { description: "Rollout action: restart, undo, status, or history" },
    ),
    resource: Type.String({ description: "Resource type, e.g. deployment, statefulset, daemonset" }),
    name: Type.String({ description: "Resource name" }),
    namespace: Type.Optional(Type.String({ description: "Kubernetes namespace" })),
    toRevision: Type.Optional(Type.Number({ description: "Revision number to roll back to (for undo action)" })),
    revision: Type.Optional(Type.Number({ description: "Specific revision to inspect (for history action)" })),
  }),
  execute: async (input: {
    action: "restart" | "undo" | "status" | "history";
    resource: string;
    name: string;
    namespace?: string;
    toRevision?: number;
    revision?: number;
  }) => {
    try {
      const opts = { namespace: input.namespace };

      switch (input.action) {
        case "restart": {
          const { kubectlRolloutRestart } = await import("./cli-wrapper.js");
          const result = await kubectlRolloutRestart(input.resource, input.name, opts);
          return {
            content: [{ type: "text" as const, text: `Rollout restart initiated:\n${result}` }],
          };
        }
        case "undo": {
          const { kubectlRolloutUndo } = await import("./cli-wrapper.js");
          const result = await kubectlRolloutUndo(input.resource, input.name, {
            ...opts,
            toRevision: input.toRevision,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: input.toRevision
                  ? `Rolled back to revision ${input.toRevision}:\n${result}`
                  : `Rolled back to previous revision:\n${result}`,
              },
            ],
          };
        }
        case "status": {
          const { kubectlRolloutStatus } = await import("./cli-wrapper.js");
          const result = await kubectlRolloutStatus(input.resource, input.name, opts);
          return {
            content: [{ type: "text" as const, text: `Rollout status:\n${result}` }],
          };
        }
        case "history": {
          const { kubectlRolloutHistory } = await import("./cli-wrapper.js");
          const result = await kubectlRolloutHistory(input.resource, input.name, {
            ...opts,
            revision: input.revision,
          });
          return {
            content: [{ type: "text" as const, text: `Rollout history:\n${result}` }],
          };
        }
        default:
          return { content: [{ type: "text" as const, text: `Unknown rollout action: ${input.action}` }] };
      }
    } catch (err) {
      return { content: [{ type: "text" as const, text: `kubectl rollout failed: ${err}` }] };
    }
  },
};
