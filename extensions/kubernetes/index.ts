/**
 * @espada/kubernetes — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createK8sTools } from "./src/tools.js";
import { createK8sCli } from "./src/cli.js";

export default {
  id: "kubernetes",
  name: "Kubernetes Management",
  register(api: EspadaPluginApi) {
    for (const tool of createK8sTools()) {
      api.registerTool(tool as any);
    }

    api.registerCli((ctx) => createK8sCli()(ctx), { commands: ["k8s"] });

    api.registerGatewayMethod("k8s/resources", async ({ params, respond }) => {
      const { kubectlGet } = await import("./src/cli-wrapper.js");
      const { parseManifestJson, parseResources } = await import("./src/manifest-parser.js");
      const p = params as { resource: string; namespace?: string };
      try {
        const json = await kubectlGet(p.resource, { namespace: p.namespace });
        const manifest = parseManifestJson(json);
        const parsed = parseResources(manifest.resources);
        respond(true, { count: parsed.length, resources: parsed });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("k8s/namespaces", async ({ respond }) => {
      const { kubectlGetNamespaces } = await import("./src/cli-wrapper.js");
      const { parseManifestJson, parseResources } = await import("./src/manifest-parser.js");
      try {
        const json = await kubectlGetNamespaces();
        const manifest = parseManifestJson(json);
        const parsed = parseResources(manifest.resources);
        respond(true, parsed.map((r) => ({ name: r.name, labels: r.labels })));
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerService({
      id: "kubernetes",
      start: async () => {
        api.logger?.info("[kubernetes] Plugin loaded");
      },
      stop: async () => {},
    });
  },
};
