/**
 * Terraform — Agent Tools
 *
 * 5 tools: tf_parse_state, tf_plan_summary, tf_drift_check, tf_workspaces, tf_lock_status
 */

import { Type } from "@sinclair/typebox";
import type { TerraformStorage } from "./types.js";
import { parseState, parsePlan, detectDrift, getResourceTypes, getProviderDistribution, buildDependencyGraph } from "./parser.js";

export function createTerraformTools(storage: TerraformStorage) {
  return [
    {
      name: "tf_parse_state",
      description:
        "Parse a Terraform state file (JSON) and return resources, dependencies, providers, and resource types.",
      inputSchema: Type.Object({
        stateJson: Type.String({ description: "Terraform state file contents as JSON string" }),
      }),
      execute: async (input: { stateJson: string }) => {
        const resources = parseState(input.stateJson);
        const types = getResourceTypes(resources);
        const providers = getProviderDistribution(resources);
        const deps = buildDependencyGraph(resources);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalResources: resources.length,
                  managed: resources.filter((r) => r.mode === "managed").length,
                  data: resources.filter((r) => r.mode === "data").length,
                  resourceTypes: types,
                  providers,
                  dependencies: deps.length,
                  resources: resources.map((r) => ({
                    address: r.address,
                    type: r.type,
                    provider: r.providerShort,
                    dependencyCount: r.dependencies.length,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
    {
      name: "tf_plan_summary",
      description: "Analyze a Terraform plan JSON and return a summary of changes.",
      inputSchema: Type.Object({
        planJson: Type.String({ description: "Terraform plan JSON output (from terraform show -json)" }),
      }),
      execute: async (input: { planJson: string }) => {
        const summary = parsePlan(input.planJson);
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      },
    },
    {
      name: "tf_drift_check",
      description: "Compare expected state attributes with actual attributes to detect configuration drift.",
      inputSchema: Type.Object({
        expectedJson: Type.String({ description: "Expected Terraform state JSON" }),
        actualJson: Type.String({ description: "Actual/current Terraform state JSON" }),
        stateId: Type.Optional(Type.String({ description: "State identifier for tracking" })),
      }),
      execute: async (input: { expectedJson: string; actualJson: string; stateId?: string }) => {
        const expected = parseState(input.expectedJson);
        const actual = parseState(input.actualJson);

        const actualMap = new Map<string, Record<string, unknown>>();
        for (const r of actual) {
          actualMap.set(r.address, r.attributes);
        }

        const drifted = [];
        for (const r of expected) {
          if (r.mode === "data") continue;
          const actualAttrs = actualMap.get(r.address);
          if (!actualAttrs) {
            drifted.push({ address: r.address, type: r.type, status: "missing", fields: [] });
            continue;
          }
          const fields = detectDrift(r.attributes, actualAttrs);
          if (fields.length > 0) {
            drifted.push({ address: r.address, type: r.type, status: "drifted", fields });
          }
        }

        // Store result
        if (input.stateId) {
          await storage.saveDriftResult({
            stateId: input.stateId,
            detectedAt: new Date().toISOString(),
            totalResources: expected.filter((r) => r.mode === "managed").length,
            driftedResources: drifted.map((d) => ({
              address: d.address,
              type: d.type,
              name: d.address.split(".").pop() ?? "",
              provider: expected.find((r) => r.address === d.address)?.providerShort ?? "unknown",
              driftedFields: d.fields,
            })),
            errorResources: [],
            summary: {
              totalDrifted: drifted.length,
              totalErrors: 0,
              totalClean: expected.filter((r) => r.mode === "managed").length - drifted.length,
              byProvider: {},
              byType: {},
            },
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalResources: expected.filter((r) => r.mode === "managed").length,
                  driftedCount: drifted.length,
                  drifted,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
    {
      name: "tf_workspaces",
      description: "List all registered Terraform workspaces.",
      inputSchema: Type.Object({}),
      execute: async () => {
        const workspaces = await storage.listWorkspaces();
        return { content: [{ type: "text" as const, text: JSON.stringify(workspaces, null, 2) }] };
      },
    },
    {
      name: "tf_lock_status",
      description: "Check if a Terraform state is currently locked.",
      inputSchema: Type.Object({
        stateId: Type.String({ description: "State/workspace ID to check" }),
      }),
      execute: async (input: { stateId: string }) => {
        const lock = await storage.getLock(input.stateId);
        return {
          content: [
            {
              type: "text" as const,
              text: lock
                ? JSON.stringify({ locked: true, ...lock }, null, 2)
                : JSON.stringify({ locked: false }, null, 2),
            },
          ],
        };
      },
    },
  ];
}
