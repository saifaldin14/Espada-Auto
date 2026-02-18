/**
 * Pulumi agent tools — pulumi_preview, pulumi_up, pulumi_state, pulumi_drift.
 */

import { Type } from "@sinclair/typebox";
import type { ParsedPulumiResource } from "./types.js";
import { parseState, parsePreview, detectDrift, getResourceTypes, getProviderDistribution, buildDependencyGraph } from "./state-parser.js";

export function createPulumiTools() {
  return [pulumiStateTool, pulumiPreviewTool, pulumiDriftTool, pulumiResourcesTool];
}

/* ---------- pulumi_state ---------- */

const pulumiStateTool = {
  name: "pulumi_state",
  description: "Parse a Pulumi state export JSON and return normalized resources with provider distribution.",
  inputSchema: Type.Object({
    stateJson: Type.String({ description: "Raw Pulumi stack export JSON string" }),
  }),
  execute: async (input: { stateJson: string }) => {
    try {
      const state = JSON.parse(input.stateJson);
      const resources = parseState(state);
      const types = getResourceTypes(resources);
      const providers = getProviderDistribution(resources);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { resourceCount: resources.length, resourceTypes: types, providerDistribution: providers, resources },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error parsing state: ${err}` }] };
    }
  },
};

/* ---------- pulumi_preview ---------- */

const pulumiPreviewTool = {
  name: "pulumi_preview",
  description: "Parse Pulumi preview JSON output and return a change summary.",
  inputSchema: Type.Object({
    previewJson: Type.String({ description: "Raw JSON output from `pulumi preview --json`" }),
  }),
  execute: async (input: { previewJson: string }) => {
    try {
      const summary = parsePreview(input.previewJson);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error parsing preview: ${err}` }] };
    }
  },
};

/* ---------- pulumi_drift ---------- */

const pulumiDriftTool = {
  name: "pulumi_drift",
  description: "Compare two Pulumi state exports to detect infrastructure drift.",
  inputSchema: Type.Object({
    desiredStateJson: Type.String({ description: "Desired/expected state JSON from Pulumi stack export" }),
    actualStateJson: Type.String({ description: "Actual/live state JSON from Pulumi stack export" }),
    stackName: Type.String({ description: "Name of the Pulumi stack" }),
  }),
  execute: async (input: { desiredStateJson: string; actualStateJson: string; stackName: string }) => {
    try {
      const desiredState = JSON.parse(input.desiredStateJson);
      const actualState = JSON.parse(input.actualStateJson);
      const desired = parseState(desiredState);
      const actual = parseState(actualState);
      const result = detectDrift(desired, actual, input.stackName);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error detecting drift: ${err}` }] };
    }
  },
};

/* ---------- pulumi_resources ---------- */

const pulumiResourcesTool = {
  name: "pulumi_resources",
  description: "Extract the dependency graph and resources from a Pulumi state export.",
  inputSchema: Type.Object({
    stateJson: Type.String({ description: "Raw Pulumi stack export JSON string" }),
  }),
  execute: async (input: { stateJson: string }) => {
    try {
      const state = JSON.parse(input.stateJson);
      const resources: ParsedPulumiResource[] = parseState(state);
      const graph = buildDependencyGraph(resources);
      const graphObj: Record<string, string[]> = {};
      for (const [k, v] of graph) {
        graphObj[k] = v;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { totalResources: resources.length, dependencyGraph: graphObj, resources: resources.map((r) => ({ urn: r.urn, type: r.type, name: r.name, provider: r.provider, id: r.id })) },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err}` }] };
    }
  },
};
