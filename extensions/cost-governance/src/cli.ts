/**
 * Cost governance CLI commands.
 */

import type { Command } from "commander";

export function registerCostCli(program: Command): void {
  const cost = program.command("cost").description("Cost governance and budgeting");

  cost
    .command("estimate")
    .description("Estimate infrastructure costs via Infracost")
    .argument("<directory>", "Path to IaC directory")
    .option("--detailed", "Show per-resource breakdown")
    .action(async (directory: string, opts: { detailed?: boolean }) => {
      const { infracostBreakdown } = await import("./infracost.js");
      const breakdown = await infracostBreakdown(directory);

      console.log(`\nTotal monthly: ${breakdown.currency} ${breakdown.totalMonthlyCost.toFixed(2)}`);
      console.log(`Total hourly:  ${breakdown.currency} ${breakdown.totalHourlyCost.toFixed(4)}`);
      console.log(`Resources:     ${breakdown.resources.length}\n`);

      if (opts.detailed) {
        for (const r of breakdown.resources) {
          console.log(`  ${r.name} (${r.resourceType}): ${r.monthlyCost.toFixed(2)}/mo [${r.provider}]`);
          for (const sub of r.subResources ?? []) {
            console.log(`    - ${sub.name}: ${sub.monthlyCost.toFixed(2)}/mo`);
          }
        }
      }
    });

  const budget = cost.command("budget").description("Manage cost budgets");

  budget
    .command("list")
    .description("List all budgets and their status")
    .action(async () => {
      const { BudgetManager } = await import("./budgets.js");
      const mgr = new BudgetManager();
      // In real usage, load from storage; here just show empty state
      const statuses = mgr.getAllStatuses();
      if (statuses.length === 0) {
        console.log("No budgets configured.");
        return;
      }
      for (const s of statuses) {
        console.log(
          `[${s.status.toUpperCase()}] ${s.name} (${s.scope}/${s.scopeId}): ` +
            `${s.currency} ${s.currentSpend.toFixed(2)}/${s.monthlyLimit.toFixed(2)} ` +
            `(${s.utilization.toFixed(1)}%)`,
        );
      }
    });

  budget
    .command("set")
    .description("Create or update a budget")
    .requiredOption("--name <name>", "Budget name")
    .requiredOption("--scope <scope>", "Scope: team, project, environment, global")
    .requiredOption("--scope-id <id>", "Scope identifier")
    .requiredOption("--limit <amount>", "Monthly spending limit", parseFloat)
    .option("--warning <pct>", "Warning threshold percentage", parseFloat, 80)
    .option("--critical <pct>", "Critical threshold percentage", parseFloat, 100)
    .action(
      async (opts: {
        name: string;
        scope: string;
        scopeId: string;
        limit: number;
        warning: number;
        critical: number;
      }) => {
        const { BudgetManager } = await import("./budgets.js");
        const mgr = new BudgetManager();
        const budget = mgr.setBudget({
          name: opts.name,
          scope: opts.scope as "team" | "project" | "environment" | "global",
          scopeId: opts.scopeId,
          monthlyLimit: opts.limit,
          warningThreshold: opts.warning,
          criticalThreshold: opts.critical,
        });
        console.log(`Budget "${budget.name}" set: ${budget.currency} ${budget.monthlyLimit}/mo`);
      },
    );

  budget
    .command("status")
    .description("Check a specific budget status")
    .argument("<scope>", "Budget scope")
    .argument("<scope-id>", "Scope identifier")
    .action(async (scope: string, scopeId: string) => {
      const { BudgetManager } = await import("./budgets.js");
      const mgr = new BudgetManager();
      const b = mgr.findBudget(scope as "team" | "project" | "environment" | "global", scopeId);
      if (!b) {
        console.log(`No budget found for ${scope}/${scopeId}`);
        return;
      }
      const status = mgr.getStatus(b);
      const { getUtilization } = await import("./budgets.js");
      const util = getUtilization(b);
      console.log(`Budget: ${b.name}`);
      console.log(`Status: ${status.toUpperCase()}`);
      console.log(`Spend:  ${b.currency} ${b.currentSpend.toFixed(2)} / ${b.monthlyLimit.toFixed(2)}`);
      console.log(`Usage:  ${util.toFixed(1)}%`);
    });

  cost
    .command("forecast")
    .description("Forecast future costs from historical data")
    .option("--months <n>", "Months ahead to forecast", parseFloat, 3)
    .action(async (opts: { months: number }) => {
      console.log(`Forecast for ${opts.months} months ahead (provide data via tool or API)`);
    });
}
