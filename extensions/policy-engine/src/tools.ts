/**
 * Policy Engine — Agent Tools
 *
 * 4 tools: policy_evaluate, policy_list, policy_check_plan, policy_violations
 */

import { Type } from "@sinclair/typebox";
import type { PolicyStorage, PolicyEvaluationInput, ResourceInput } from "./types.js";
import { PolicyEvaluationEngine } from "./engine.js";
import { buildPlanPolicyInput, buildResourcePolicyInput } from "./integration.js";

export function createPolicyTools(storage: PolicyStorage) {
  const engine = new PolicyEvaluationEngine();

  return [
    {
      name: "policy_evaluate",
      description: "Evaluate a resource against all applicable policies. Returns allow/deny, warnings, and violations.",
      inputSchema: Type.Object({
        resourceId: Type.String({ description: "Resource ID to evaluate" }),
        resourceType: Type.String({ description: "Resource type (e.g. aws_s3_bucket)" }),
        provider: Type.String({ description: "Cloud provider (aws, azure, gcp)" }),
        region: Type.Optional(Type.String({ description: "Resource region" })),
        tags: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Resource tags" })),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Resource metadata" })),
        environment: Type.Optional(Type.String({ description: "Environment name" })),
      }),
      execute: async (input: {
        resourceId: string;
        resourceType: string;
        provider: string;
        region?: string;
        tags?: Record<string, string>;
        metadata?: Record<string, unknown>;
        environment?: string;
      }) => {
        const policies = await storage.list({ enabled: true });
        const evalInput = buildResourcePolicyInput({
          id: input.resourceId,
          type: input.resourceType,
          provider: input.provider,
          region: input.region,
          tags: input.tags,
          metadata: input.metadata,
          environment: input.environment,
        });
        const result = engine.evaluateAll(policies, evalInput);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "policy_list",
      description: "List all policies with optional filtering by type, severity, or enabled status.",
      inputSchema: Type.Object({
        type: Type.Optional(Type.String({ description: "Filter by policy type (plan, access, cost, etc.)" })),
        severity: Type.Optional(Type.String({ description: "Filter by severity (low, medium, high, critical)" })),
        enabled: Type.Optional(Type.Boolean({ description: "Filter by enabled status" })),
      }),
      execute: async (input: { type?: string; severity?: string; enabled?: boolean }) => {
        const policies = await storage.list(input);
        const summary = policies.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          severity: p.severity,
          enabled: p.enabled,
          ruleCount: p.rules.length,
          labels: p.labels,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      },
    },
    {
      name: "policy_check_plan",
      description: "Evaluate a Terraform/IaC plan against applicable policies. Returns allow/deny with violations.",
      inputSchema: Type.Object({
        creates: Type.Number({ description: "Number of resources to create" }),
        updates: Type.Number({ description: "Number of resources to update" }),
        deletes: Type.Number({ description: "Number of resources to delete" }),
        environment: Type.Optional(Type.String({ description: "Target environment" })),
        resources: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.String(),
              type: Type.String(),
              name: Type.String(),
              provider: Type.String(),
              region: Type.String(),
              status: Type.String(),
              tags: Type.Record(Type.String(), Type.String()),
              metadata: Type.Record(Type.String(), Type.Unknown()),
            }),
            { description: "Resources affected by the plan" },
          ),
        ),
      }),
      execute: async (input: {
        creates: number;
        updates: number;
        deletes: number;
        environment?: string;
        resources?: ResourceInput[];
      }) => {
        const policies = await storage.list({ enabled: true });
        const evalInput = buildPlanPolicyInput({
          creates: input.creates,
          updates: input.updates,
          deletes: input.deletes,
          resources: input.resources,
          environment: input.environment,
        });
        const result = engine.evaluateAll(policies, evalInput);

        // Also evaluate per-resource if resources are provided
        const resourceResults = [];
        if (input.resources) {
          for (const r of input.resources) {
            const rInput: PolicyEvaluationInput = { resource: r, environment: input.environment };
            const rResult = engine.evaluateAll(policies, rInput);
            if (rResult.denied || rResult.warnings.length > 0) {
              resourceResults.push({ resourceId: r.id, resourceType: r.type, ...rResult });
            }
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ planResult: result, resourceResults }, null, 2),
            },
          ],
        };
      },
    },
    {
      name: "policy_violations",
      description: "Scan all known resources against policies and return all violations.",
      inputSchema: Type.Object({
        resources: Type.Array(
          Type.Object({
            id: Type.String(),
            type: Type.String(),
            name: Type.String(),
            provider: Type.String(),
            region: Type.String(),
            status: Type.String(),
            tags: Type.Record(Type.String(), Type.String()),
            metadata: Type.Record(Type.String(), Type.Unknown()),
          }),
          { description: "Resources to scan" },
        ),
        severity: Type.Optional(Type.String({ description: "Filter violations by minimum severity" })),
      }),
      execute: async (input: { resources: ResourceInput[]; severity?: string }) => {
        const policies = await storage.list({ enabled: true });
        let violations = engine.scanResources(policies, input.resources);

        if (input.severity) {
          const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
          const minSeverity = severityOrder[input.severity as keyof typeof severityOrder] ?? 0;
          violations = violations.filter((v) => {
            const vSev = severityOrder[v.severity as keyof typeof severityOrder] ?? 0;
            return vSev >= minSeverity;
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalViolations: violations.length,
                  bySeverity: {
                    critical: violations.filter((v) => v.severity === "critical").length,
                    high: violations.filter((v) => v.severity === "high").length,
                    medium: violations.filter((v) => v.severity === "medium").length,
                    low: violations.filter((v) => v.severity === "low").length,
                  },
                  violations,
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
}
