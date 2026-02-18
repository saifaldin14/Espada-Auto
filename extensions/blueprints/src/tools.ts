/**
 * Blueprint agent tools.
 */

import { Type } from "@sinclair/typebox";

export const blueprintTools = [
  {
    name: "blueprint_list",
    description:
      "Browse the infrastructure blueprint catalog. Filter by category (web-app, api, data, container, serverless, static-site) or cloud provider (aws, azure, gcp).",
    inputSchema: Type.Object({
      category: Type.Optional(Type.String({ description: "Filter by category" })),
      provider: Type.Optional(Type.String({ description: "Filter by cloud provider: aws, azure, gcp" })),
      tag: Type.Optional(Type.String({ description: "Filter by tag" })),
    }),
    execute: async (input: { category?: string; provider?: string; tag?: string }) => {
      const { builtInBlueprints, filterBlueprints } = await import("./library.js");
      const results = filterBlueprints(builtInBlueprints, input);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No blueprints match the filter." }] };
      }

      const lines: string[] = [`## Blueprints (${results.length})\n`];
      for (const bp of results) {
        lines.push(
          `- **${bp.name}** (\`${bp.id}\`) — ${bp.description}  ` +
            `Cost: $${bp.estimatedCostRange[0]}–$${bp.estimatedCostRange[1]}/mo  ` +
            `Tags: ${bp.tags.join(", ")}`,
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  },

  {
    name: "blueprint_preview",
    description:
      "Preview what a blueprint would create without deploying. Shows resources, resolved parameters, estimated cost, and any validation errors.",
    inputSchema: Type.Object({
      blueprintId: Type.String({ description: "Blueprint ID from catalog" }),
      parameters: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Parameter values as key-value pairs",
        }),
      ),
    }),
    execute: async (input: { blueprintId: string; parameters?: Record<string, unknown> }) => {
      const { getBlueprintById } = await import("./library.js");
      const { preview } = await import("./engine.js");

      const bp = getBlueprintById(input.blueprintId);
      if (!bp) {
        return {
          content: [{ type: "text" as const, text: `Blueprint "${input.blueprintId}" not found.` }],
        };
      }

      const result = preview(bp, input.parameters ?? {});
      const lines: string[] = [`## Preview: ${bp.name}\n`];

      if (result.validationErrors.length > 0) {
        lines.push("### Validation Errors");
        for (const e of result.validationErrors) {
          lines.push(`- ❌ **${e.parameterId}**: ${e.message}`);
        }
        lines.push("");
      }

      lines.push("### Resources");
      for (const r of result.resources) {
        lines.push(`- \`${r.type}\` **${r.name}** (${r.provider})`);
      }

      lines.push(
        `\nEstimated cost: $${result.estimatedCostRange[0]}–$${result.estimatedCostRange[1]}/mo`,
      );

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  },

  {
    name: "blueprint_deploy",
    description:
      "Deploy an infrastructure blueprint with the given parameters. Validates parameters then creates an instance.",
    inputSchema: Type.Object({
      blueprintId: Type.String({ description: "Blueprint ID" }),
      name: Type.String({ description: "Instance name" }),
      parameters: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), { description: "Parameter values" }),
      ),
    }),
    execute: async (
      input: { blueprintId: string; name: string; parameters?: Record<string, unknown> },
      context: { instanceStore: import("./engine.js").InstanceStore },
    ) => {
      const { getBlueprintById } = await import("./library.js");
      const { validateParameters } = await import("./engine.js");

      const bp = getBlueprintById(input.blueprintId);
      if (!bp) {
        return {
          content: [{ type: "text" as const, text: `Blueprint "${input.blueprintId}" not found.` }],
        };
      }

      const errors = validateParameters(bp, input.parameters ?? {});
      if (errors.length > 0) {
        const errMsg = errors.map((e) => `${e.parameterId}: ${e.message}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `Validation failed:\n${errMsg}` }],
        };
      }

      const instance = context.instanceStore.create(bp, input.name, input.parameters ?? {});
      // In real deployment, would trigger terraform init+plan+apply here
      context.instanceStore.updateStatus(instance.id, "active");

      return {
        content: [
          {
            type: "text" as const,
            text: `Deployed "${input.name}" from ${bp.name}\nInstance ID: ${instance.id}\nStatus: active`,
          },
        ],
      };
    },
  },

  {
    name: "blueprint_status",
    description: "Check the status of deployed blueprint instances.",
    inputSchema: Type.Object({
      instanceId: Type.Optional(Type.String({ description: "Specific instance ID" })),
    }),
    execute: async (
      input: { instanceId?: string },
      context: { instanceStore: import("./engine.js").InstanceStore },
    ) => {
      if (input.instanceId) {
        const inst = context.instanceStore.get(input.instanceId);
        if (!inst) {
          return {
            content: [{ type: "text" as const, text: `Instance "${input.instanceId}" not found.` }],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Instance: ${inst.name}\nBlueprint: ${inst.blueprintId}\n` +
                `Status: ${inst.status}\nCreated: ${inst.createdAt}`,
            },
          ],
        };
      }

      const all = context.instanceStore.list();
      if (all.length === 0) {
        return { content: [{ type: "text" as const, text: "No deployed instances." }] };
      }

      const lines = ["## Deployed Instances\n"];
      for (const inst of all) {
        lines.push(`- **${inst.name}** (\`${inst.id}\`) — ${inst.status} [${inst.blueprintId}]`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  },
];
