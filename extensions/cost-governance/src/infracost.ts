/**
 * Infracost CLI wrapper — wraps `infracost` for cost breakdown and diff.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CostBreakdown, CostDiff, ResourceCost, ResourceCostChange } from "./types.js";

const execFileAsync = promisify(execFile);

export interface InfracostOptions {
  cwd?: string;
  apiKey?: string;
}

/** Run an infracost CLI command and return stdout. */
async function runInfracost(args: string[], options: InfracostOptions = {}): Promise<string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (options.apiKey) env.INFRACOST_API_KEY = options.apiKey;

  const { stdout } = await execFileAsync("infracost", args, {
    cwd: options.cwd,
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

/** Run `infracost breakdown --path <planFile> --format json`. */
export async function infracostBreakdown(
  planFile: string,
  options: InfracostOptions = {},
): Promise<CostBreakdown> {
  const raw = await runInfracost(
    ["breakdown", "--path", planFile, "--format", "json"],
    options,
  );
  return parseBreakdownJson(raw);
}

/** Run `infracost diff --path <planFile> --format json`. */
export async function infracostDiff(
  planFile: string,
  options: InfracostOptions = {},
): Promise<CostDiff> {
  const raw = await runInfracost(
    ["diff", "--path", planFile, "--format", "json"],
    options,
  );
  return parseDiffJson(raw);
}

/**
 * Parse Infracost breakdown JSON output into CostBreakdown.
 */
export function parseBreakdownJson(json: string): CostBreakdown {
  const data = JSON.parse(json);
  const projects = data.projects ?? [];
  const resources: ResourceCost[] = [];
  let totalMonthlyCost = 0;
  let totalHourlyCost = 0;

  for (const project of projects) {
    const breakdown = project.breakdown ?? {};
    for (const res of breakdown.resources ?? []) {
      const monthlyCost = parseFloat(res.monthlyCost ?? "0");
      const hourlyCost = parseFloat(res.hourlyCost ?? "0");

      resources.push({
        name: res.name ?? "",
        resourceType: res.resourceType ?? "",
        provider: extractProvider(res.name ?? "", res.resourceType ?? ""),
        monthlyCost,
        hourlyCost,
        subResources: (res.subresources ?? []).map((s: Record<string, unknown>) => ({
          name: s.name as string,
          monthlyCost: parseFloat((s.monthlyCost as string) ?? "0"),
          hourlyCost: parseFloat((s.hourlyCost as string) ?? "0"),
          unit: (s.unit as string) ?? "",
          quantity: (s.monthlyQuantity as number) ?? 0,
          unitPrice: parseFloat((s.price as string) ?? "0"),
        })),
      });

      totalMonthlyCost += monthlyCost;
      totalHourlyCost += hourlyCost;
    }
  }

  return {
    totalMonthlyCost,
    totalHourlyCost,
    resources,
    currency: data.currency ?? "USD",
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Parse Infracost diff JSON output into CostDiff.
 */
export function parseDiffJson(json: string): CostDiff {
  const data = JSON.parse(json);
  const projects = data.projects ?? [];
  const resourceChanges: ResourceCostChange[] = [];
  let currentMonthlyCost = 0;
  let projectedMonthlyCost = 0;
  let hasProjectTotals = false;

  for (const project of projects) {
    const diff = project.diff ?? {};
    const previousByName = new Map<string, number>();
    for (const prev of project.pastBreakdown?.resources ?? []) {
      const name = String(prev.name ?? "");
      if (!name) continue;
      previousByName.set(name, parseFloat(prev.monthlyCost ?? "0"));
    }
    for (const res of diff.resources ?? []) {
      const resourceName = String(res.name ?? "");
      const prevCost = previousByName.get(resourceName) ?? 0;
      const newCost = parseFloat(res.monthlyCost ?? "0");
      const action = inferAction(res, prevCost, newCost);

      resourceChanges.push({
        name: resourceName,
        resourceType: res.resourceType ?? "",
        action,
        previousMonthlyCost: prevCost,
        newMonthlyCost: newCost,
        deltaMonthlyCost: newCost - prevCost,
      });
    }

    const pastTotal = parseFloat(project.pastBreakdown?.totalMonthlyCost ?? "NaN");
    const projectedTotal = parseFloat(project.breakdown?.totalMonthlyCost ?? "NaN");
    if (Number.isFinite(pastTotal) || Number.isFinite(projectedTotal)) {
      hasProjectTotals = true;
      currentMonthlyCost += Number.isFinite(pastTotal) ? pastTotal : 0;
      projectedMonthlyCost += Number.isFinite(projectedTotal) ? projectedTotal : 0;
    }
  }

  if (!hasProjectTotals) {
    projectedMonthlyCost = parseFloat(data.totalMonthlyCost ?? "0");
    const reportedDelta = parseFloat(data.diffTotalMonthlyCost ?? "NaN");
    if (Number.isFinite(reportedDelta)) {
      currentMonthlyCost = projectedMonthlyCost - reportedDelta;
    }
  }

  const delta = projectedMonthlyCost - currentMonthlyCost;
  const deltaPercent = currentMonthlyCost > 0 ? (delta / currentMonthlyCost) * 100 : 0;

  return {
    currentMonthlyCost,
    projectedMonthlyCost,
    deltaMonthlyCost: delta,
    deltaPercent,
    resourceChanges,
    currency: data.currency ?? "USD",
    generatedAt: new Date().toISOString(),
  };
}

function inferAction(
  resource: Record<string, unknown>,
  previousMonthlyCost: number,
  newMonthlyCost: number,
): ResourceCostChange["action"] {
  if (resource.metadata) {
    const calls = (resource.metadata as Record<string, unknown>).calls as string[] | undefined;
    if (calls?.includes("create")) return "create";
    if (calls?.includes("delete")) return "delete";
    if (calls?.includes("update")) return "update";
  }
  if (previousMonthlyCost <= 0 && newMonthlyCost > 0) return "create";
  if (previousMonthlyCost > 0 && newMonthlyCost <= 0) return "delete";
  if (previousMonthlyCost !== newMonthlyCost) return "update";
  return "no-change";
}

function extractProvider(name: string, resourceType?: string): string {
  const haystack = `${name} ${resourceType ?? ""}`.toLowerCase();
  if (haystack.includes("aws_")) return "aws";
  if (haystack.includes("azurerm_")) return "azurerm";
  if (haystack.includes("google_")) return "google";
  return "unknown";
}
