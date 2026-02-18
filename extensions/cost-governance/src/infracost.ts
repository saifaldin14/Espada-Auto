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
        provider: extractProvider(res.name ?? ""),
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

  for (const project of projects) {
    const diff = project.diff ?? {};
    for (const res of diff.resources ?? []) {
      const prevCost = parseFloat(res.monthlyCost ?? "0");
      const newCost = parseFloat(res.monthlyCost ?? "0");
      const action = inferAction(res);

      resourceChanges.push({
        name: res.name ?? "",
        resourceType: res.resourceType ?? "",
        action,
        previousMonthlyCost: prevCost,
        newMonthlyCost: newCost,
        deltaMonthlyCost: newCost - prevCost,
      });
    }

    currentMonthlyCost += parseFloat(project.pastBreakdown?.totalMonthlyCost ?? "0");
    projectedMonthlyCost += parseFloat(project.breakdown?.totalMonthlyCost ?? "0");
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

function inferAction(resource: Record<string, unknown>): ResourceCostChange["action"] {
  if (resource.metadata) {
    const calls = (resource.metadata as Record<string, unknown>).calls as string[] | undefined;
    if (calls?.includes("create")) return "create";
    if (calls?.includes("delete")) return "delete";
    if (calls?.includes("update")) return "update";
  }
  return "no-change";
}

function extractProvider(name: string): string {
  if (name.startsWith("aws_")) return "aws";
  if (name.startsWith("azurerm_")) return "azure";
  if (name.startsWith("google_")) return "gcp";
  return "unknown";
}
