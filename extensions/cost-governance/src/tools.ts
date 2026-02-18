/**
 * Cost governance tools — cost estimation, budget status, forecasting.
 */

import { Type } from "@sinclair/typebox";

export const costTools = [
  {
    name: "cost_estimate",
    description:
      "Estimate the cost of infrastructure changes using Infracost. Provide a Terraform plan or directory path to get a cost breakdown.",
    inputSchema: Type.Object({
      directory: Type.String({ description: "Path to Terraform/IaC directory" }),
      format: Type.Optional(
        Type.String({ description: "Output format: summary or detailed. Default: summary" }),
      ),
    }),
    execute: async (input: { directory: string; format?: string }) => {
      // Delegate to infracost wrapper at runtime
      const { infracostBreakdown } = await import("./infracost.js");
      const breakdown = await infracostBreakdown(input.directory);

      const lines: string[] = [];
      lines.push(`## Cost Estimate`);
      lines.push(`Total monthly: ${breakdown.currency} ${breakdown.totalMonthlyCost.toFixed(2)}`);
      lines.push(`Total hourly:  ${breakdown.currency} ${breakdown.totalHourlyCost.toFixed(4)}`);
      lines.push(`Resources:     ${breakdown.resources.length}`);

      if (input.format === "detailed") {
        lines.push("");
        for (const r of breakdown.resources) {
          lines.push(
            `- **${r.name}** (${r.resourceType}): ${r.monthlyCost.toFixed(2)}/mo [${r.provider}]`,
          );
          for (const sub of r.subResources ?? []) {
            lines.push(`  - ${sub.name}: ${sub.monthlyCost.toFixed(2)}/mo`);
          }
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  },

  {
    name: "cost_budget_status",
    description:
      "Check budget status and utilization. Shows all budgets or a specific scope. Returns budget health, current spend, and threshold alerts.",
    inputSchema: Type.Object({
      scope: Type.Optional(
        Type.String({ description: "Filter by scope: team, project, environment, or global" }),
      ),
      scopeId: Type.Optional(Type.String({ description: "Scope identifier to filter by" })),
    }),
    execute: async (
      input: { scope?: string; scopeId?: string },
      context: { budgetManager: import("./budgets.js").BudgetManager },
    ) => {
      let statuses = context.budgetManager.getAllStatuses();

      if (input.scope) {
        statuses = statuses.filter((s) => s.scope === input.scope);
      }
      if (input.scopeId) {
        statuses = statuses.filter((s) => s.scopeId === input.scopeId);
      }

      if (statuses.length === 0) {
        return { content: [{ type: "text" as const, text: "No budgets found." }] };
      }

      const lines: string[] = ["## Budget Status\n"];
      for (const s of statuses) {
        const icon =
          s.status === "ok"
            ? "✅"
            : s.status === "warning"
              ? "⚠️"
              : s.status === "critical"
                ? "🔴"
                : "🚨";
        lines.push(`${icon} **${s.name}** (${s.scope}/${s.scopeId})`);
        lines.push(
          `   Spend: ${s.currency} ${s.currentSpend.toFixed(2)} / ${s.monthlyLimit.toFixed(2)} (${s.utilization.toFixed(1)}%)`,
        );
        lines.push(`   Status: ${s.status.toUpperCase()}`);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  },

  {
    name: "cost_forecast",
    description:
      "Forecast future infrastructure costs using linear extrapolation from historical spending data.",
    inputSchema: Type.Object({
      monthsAhead: Type.Optional(
        Type.Number({ description: "Number of months to forecast. Default: 3" }),
      ),
      dataPoints: Type.Array(
        Type.Object({
          date: Type.String({ description: "Date in YYYY-MM-DD format" }),
          amount: Type.Number({ description: "Cost amount for that period" }),
        }),
        { description: "Historical cost data points (at least 2 required)" },
      ),
    }),
    execute: async (input: {
      monthsAhead?: number;
      dataPoints: Array<{ date: string; amount: number }>;
    }) => {
      const { linearForecast, getTrendDirection } = await import("./budgets.js");

      const months = input.monthsAhead ?? 3;
      const projected = linearForecast(input.dataPoints, months);

      if (projected.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "Need at least 2 data points for forecasting." },
          ],
        };
      }

      const currentAmount = input.dataPoints[input.dataPoints.length - 1]!.amount;
      const lastProjected = projected[projected.length - 1]!.amount;
      const trend = getTrendDirection(currentAmount, lastProjected);

      const lines: string[] = ["## Cost Forecast\n"];
      lines.push(`Trend: **${trend}**`);
      lines.push(`Current: ${currentAmount.toFixed(2)}`);
      lines.push(`Projected (${months}mo): ${lastProjected.toFixed(2)}`);
      lines.push("");
      lines.push("| Month | Projected Cost |");
      lines.push("|-------|---------------|");
      for (const p of projected) {
        lines.push(`| ${p.date} | ${p.amount.toFixed(2)} |`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  },
];
