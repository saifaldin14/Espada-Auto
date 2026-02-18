/**
 * Kubernetes CLI commands — espada k8s apply/get/diff/resources.
 */

import type { Command } from "commander";

interface K8sCliContext {
  program: Command;
}

export function createK8sCli() {
  return (ctx: K8sCliContext) => {
    const k8s = ctx.program.command("k8s").description("Kubernetes infrastructure operations");

    k8s
      .command("get")
      .description("Get Kubernetes resources")
      .argument("<resource>", "resource type (pods, deployments, etc.)")
      .argument("[name]", "specific resource name")
      .option("-n, --namespace <ns>", "Kubernetes namespace")
      .option("-A, --all-namespaces", "all namespaces")
      .action(async (resource: string, name: string | undefined, opts: { namespace?: string; allNamespaces?: boolean }) => {
        const { kubectlGet } = await import("./cli-wrapper.js");
        const { parseManifestJson, parseResources } = await import("./manifest-parser.js");
        try {
          const json = await kubectlGet(resource, {
            name,
            namespace: opts.namespace,
            allNamespaces: opts.allNamespaces,
          });
          const manifest = parseManifestJson(json);
          const parsed = parseResources(manifest.resources);

          console.log(`\n${parsed.length} ${resource} found:\n`);
          for (const r of parsed) {
            const ns = r.namespace !== "default" ? ` [${r.namespace}]` : "";
            console.log(`  ${r.kind}/${r.name}${ns}`);
          }
        } catch (err) {
          console.error("Failed:", err);
        }
      });

    k8s
      .command("diff")
      .description("Show differences between manifest and cluster state")
      .argument("<file>", "path to YAML manifest")
      .option("-n, --namespace <ns>", "Kubernetes namespace")
      .action(async (file: string, opts: { namespace?: string }) => {
        const { kubectlDiff } = await import("./cli-wrapper.js");
        try {
          const diff = await kubectlDiff(file, { namespace: opts.namespace });
          if (diff.trim()) {
            console.log("\nDifferences found:\n");
            console.log(diff);
          } else {
            console.log("\nNo differences — cluster matches manifest.");
          }
        } catch (err) {
          console.error("Failed:", err);
        }
      });

    k8s
      .command("apply")
      .description("Apply a manifest to the cluster")
      .argument("<file>", "path to YAML manifest")
      .option("-n, --namespace <ns>", "Kubernetes namespace")
      .option("--dry-run", "perform a server-side dry run")
      .action(async (file: string, opts: { namespace?: string; dryRun?: boolean }) => {
        if (opts.dryRun) {
          const { kubectlApplyDryRun } = await import("./cli-wrapper.js");
          try {
            const result = await kubectlApplyDryRun(file, { namespace: opts.namespace });
            console.log("Dry run result:\n", result);
          } catch (err) {
            console.error("Dry run failed:", err);
          }
        } else {
          const { kubectlApply } = await import("./cli-wrapper.js");
          try {
            const result = await kubectlApply(file, { namespace: opts.namespace });
            console.log("Applied:\n", result);
          } catch (err) {
            console.error("Apply failed:", err);
          }
        }
      });

    k8s
      .command("resources")
      .description("Parse and display K8s resources from JSON input")
      .argument("<file>", "path to JSON file (kubectl get -o json output)")
      .action(async (file: string) => {
        const { readFile } = await import("node:fs/promises");
        const { parseManifestJson, parseResources, getResourceKinds, getNamespaceDistribution } = await import("./manifest-parser.js");
        try {
          const json = await readFile(file, "utf-8");
          const manifest = parseManifestJson(json);
          const parsed = parseResources(manifest.resources);
          const kinds = getResourceKinds(parsed);
          const ns = getNamespaceDistribution(parsed);

          console.log(`\n${parsed.length} resources parsed`);
          console.log(`Kinds: ${kinds.join(", ")}`);
          console.log("Namespaces:");
          for (const [name, count] of Object.entries(ns)) {
            console.log(`  ${name}: ${count}`);
          }
        } catch (err) {
          console.error("Failed:", err);
        }
      });
  };
}
