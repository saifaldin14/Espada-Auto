/**
 * Kubernetes agent tools — k8s_apply, k8s_get, k8s_diff, k8s_resources.
 */

import { Type } from "@sinclair/typebox";
import { parseManifestJson, parseResources, getResourceKinds, getNamespaceDistribution, buildResourceGraph, getEdgesByType } from "./manifest-parser.js";

export function createK8sTools() {
  return [k8sResourcesTool, k8sGetTool, k8sDiffTool, k8sApplyTool];
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
