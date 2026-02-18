/**
 * Cost Governance extension — Infracost integration, budgets, and forecasting.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { costTools } from "./src/tools.js";
import { registerCostCli } from "./src/cli.js";
import { BudgetManager } from "./src/budgets.js";

export default {
  id: "cost-governance",
  name: "Cost Governance",
  register(api: EspadaPluginApi) {
    const budgetManager = new BudgetManager();

    // Register tools with budget context
    for (const tool of costTools) {
      const originalExecute = tool.execute;
      api.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: (input: Record<string, unknown>) =>
          (originalExecute as Function)(input, { budgetManager }),
      } as any);
    }

    // CLI
    api.registerCli((ctx) => registerCostCli(ctx.program), {
      commands: ["cost"],
    });

    // Gateway methods
    api.registerGatewayMethod(
      "cost/budgets",
      async ({ respond }) => {
        const statuses = budgetManager.getAllStatuses();
        respond(true, { budgets: statuses });
      },
    );

    api.registerGatewayMethod(
      "cost/budget/set",
      async ({ params, respond }) => {
        const { name, scope, scopeId, monthlyLimit, warningThreshold, criticalThreshold } =
          params as Record<string, unknown>;
        if (!name || !scope || !scopeId || !monthlyLimit) {
          respond(false, { error: "name, scope, scopeId, and monthlyLimit are required" });
          return;
        }
        const budget = budgetManager.setBudget({
          name: name as string,
          scope: scope as "team" | "project" | "environment" | "global",
          scopeId: scopeId as string,
          monthlyLimit: monthlyLimit as number,
          warningThreshold: (warningThreshold as number) ?? 80,
          criticalThreshold: (criticalThreshold as number) ?? 100,
        });
        respond(true, { budget });
      },
    );

    api.registerGatewayMethod(
      "cost/budget/spend",
      async ({ params, respond }) => {
        const { id, currentSpend } = params as { id?: string; currentSpend?: number };
        if (!id || currentSpend == null) {
          respond(false, { error: "id and currentSpend are required" });
          return;
        }
        const updated = budgetManager.updateSpend(id, currentSpend);
        if (!updated) {
          respond(false, { error: "Budget not found" });
          return;
        }
        respond(true, { budget: updated, status: budgetManager.getStatus(updated) });
      },
    );

    // Service lifecycle
    api.registerService({
      id: "cost-governance",
      start: async () => {
        api.logger?.info("Cost governance service started");
      },
      stop: async () => {
        api.logger?.info("Cost governance service stopped");
      },
    });
  },
};
