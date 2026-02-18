/**
 * DR Analysis agent tools — wired to the real analyzer engine.
 */

import { Type } from "@sinclair/typebox";
import type { DRNode, DREdge, FailureScenario } from "./types.js";
import { analyzePosture, generateRecoveryPlan, findUnprotectedCritical } from "./analyzer.js";

/** Node/edge store — populated by KG sync or `setGraphData()`. */
let cachedNodes: DRNode[] = [];
let cachedEdges: DREdge[] = [];

/** Inject graph data (used by gateway, KG bridge, or tests). */
export function setGraphData(nodes: DRNode[], edges: DREdge[]): void {
  cachedNodes = nodes;
  cachedEdges = edges;
}

export const drTools = [
  {
    name: "dr_posture",
    description:
      "Analyze overall disaster recovery posture. Scores backup coverage, replication, SPOF risks, and cross-region distribution. Returns a grade (A-F) with recommendations.",
    inputSchema: Type.Object({
      provider: Type.Optional(Type.String({ description: "Filter by cloud provider" })),
      region: Type.Optional(Type.String({ description: "Filter by region" })),
    }),
    execute: async (input: { provider?: string; region?: string }) => {
      let nodes = cachedNodes;
      const edges = cachedEdges;

      // Apply optional filters
      if (input.provider) {
        nodes = nodes.filter((n) => n.provider === input.provider);
      }
      if (input.region) {
        nodes = nodes.filter((n) => n.region === input.region);
      }

      if (nodes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "no_data",
                message:
                  "No infrastructure nodes loaded. Populate via Knowledge Graph sync or `setGraphData()`.",
                hint: "Use `espada graph dr posture` after importing infrastructure.",
              }),
            },
          ],
        };
      }

      const analysis = analyzePosture(nodes, edges);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                grade: analysis.grade,
                score: analysis.overallScore,
                singleRegionRisks: analysis.singleRegionRisks,
                unprotectedCount: analysis.unprotectedCriticalResources.length,
                recommendations: analysis.recommendations,
                recoveryTimeEstimates: analysis.recoveryTimeEstimates,
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
    name: "dr_plan",
    description:
      "Generate a recovery plan for a specific failure scenario. Scenarios: region-failure, az-failure, service-outage, data-corruption.",
    inputSchema: Type.Object({
      scenario: Type.String({
        description: "Failure scenario: region-failure, az-failure, service-outage, data-corruption",
      }),
      region: Type.Optional(Type.String({ description: "Target region for region/AZ failures" })),
    }),
    execute: async (input: { scenario: string; region?: string }) => {
      const nodes = cachedNodes;
      const edges = cachedEdges;

      if (nodes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "no_data",
                message: "No infrastructure nodes loaded. Import data first.",
              }),
            },
          ],
        };
      }

      const validScenarios: FailureScenario[] = [
        "region-failure",
        "az-failure",
        "service-outage",
        "data-corruption",
      ];
      const scenario = validScenarios.includes(input.scenario as FailureScenario)
        ? (input.scenario as FailureScenario)
        : "region-failure";

      const plan = generateRecoveryPlan(scenario, nodes, edges, input.region);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                scenario: plan.scenario,
                affectedResources: plan.affectedResources.length,
                estimatedRTO: `${plan.estimatedRTO} min`,
                estimatedRPO: `${plan.estimatedRPO} min`,
                steps: plan.recoverySteps.map((s) => ({
                  order: s.order,
                  action: s.action,
                  resource: s.resourceName,
                  duration: `${s.estimatedDuration} min`,
                  dependsOn: s.dependsOn,
                  manual: s.manual,
                })),
                dependencyGroups: plan.dependencies,
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
    name: "dr_gaps",
    description:
      "List resources lacking DR protection — no backups, no replication, no failover capability.",
    inputSchema: Type.Object({
      resourceType: Type.Optional(Type.String({ description: "Filter by resource type" })),
    }),
    execute: async (input: { resourceType?: string }) => {
      const nodes = cachedNodes;
      const edges = cachedEdges;

      if (nodes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "no_data",
                message: "No infrastructure nodes loaded. Import data first.",
              }),
            },
          ],
        };
      }

      let unprotected = findUnprotectedCritical(nodes, edges);
      if (input.resourceType) {
        unprotected = unprotected.filter((n) => n.resourceType === input.resourceType);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                totalGaps: unprotected.length,
                resources: unprotected.map((n) => ({
                  id: n.id,
                  name: n.name,
                  type: n.resourceType,
                  provider: n.provider,
                  region: n.region,
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
];
