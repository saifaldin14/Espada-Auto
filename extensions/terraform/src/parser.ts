/**
 * Terraform — State Parser & Plan Analyzer
 *
 * Parses terraform.tfstate and terraform plan JSON output.
 */

import type {
  TerraformState,
  TerraformPlan,
  ParsedResource,
  PlanSummary,
  DriftedResource,
  DriftedField,
  DriftResult,
  DriftSummary,
} from "./types.js";

/** Parse a Terraform state file JSON and extract normalized resources */
export function parseState(raw: string | TerraformState): ParsedResource[] {
  const state: TerraformState = typeof raw === "string" ? JSON.parse(raw) : raw;
  const resources: ParsedResource[] = [];

  for (const res of state.resources) {
    const providerShort = extractProviderShort(res.provider);

    for (let i = 0; i < res.instances.length; i++) {
      const instance = res.instances[i];
      const address = res.instances.length > 1 ? `${res.type}.${res.name}[${i}]` : `${res.type}.${res.name}`;

      resources.push({
        address,
        type: res.type,
        name: res.name,
        provider: res.provider,
        providerShort,
        mode: res.mode,
        attributes: instance.attributes,
        dependencies: instance.dependencies ?? [],
      });
    }
  }

  return resources;
}

/** Extract short provider name from full provider path */
function extractProviderShort(provider: string): string {
  // "registry.terraform.io/hashicorp/aws" → "aws"
  const parts = provider.split("/");
  return parts[parts.length - 1];
}

/** Parse a Terraform plan JSON and produce a summary */
export function parsePlan(raw: string | TerraformPlan): PlanSummary {
  const plan: TerraformPlan = typeof raw === "string" ? JSON.parse(raw) : raw;
  const byType: Record<string, { creates: number; updates: number; deletes: number }> = {};
  const byProvider: Record<string, number> = {};
  const affectedAddresses: string[] = [];

  let creates = 0;
  let updates = 0;
  let deletes = 0;
  let noOps = 0;

  for (const change of plan.resource_changes) {
    const actions = change.change.actions;

    if (!byType[change.type]) byType[change.type] = { creates: 0, updates: 0, deletes: 0 };
    const providerShort = extractProviderShort(change.provider_name);
    byProvider[providerShort] = (byProvider[providerShort] ?? 0) + 1;

    if (actions.includes("create") && actions.includes("delete")) {
      // Replace
      creates++;
      deletes++;
      byType[change.type].creates++;
      byType[change.type].deletes++;
      affectedAddresses.push(change.address);
    } else if (actions.includes("create")) {
      creates++;
      byType[change.type].creates++;
      affectedAddresses.push(change.address);
    } else if (actions.includes("update")) {
      updates++;
      byType[change.type].updates++;
      affectedAddresses.push(change.address);
    } else if (actions.includes("delete")) {
      deletes++;
      byType[change.type].deletes++;
      affectedAddresses.push(change.address);
    } else {
      noOps++;
    }
  }

  return {
    totalChanges: creates + updates + deletes,
    creates,
    updates,
    deletes,
    noOps,
    byType,
    byProvider,
    affectedAddresses,
    hasDestructiveChanges: deletes > 0,
  };
}

/** Compare two attribute sets and return drifted fields */
export function detectDrift(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  prefix = "",
): DriftedField[] {
  const drifted: DriftedField[] = [];

  for (const key of Object.keys(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const expVal = expected[key];
    const actVal = actual[key];

    // Skip null/undefined comparisons
    if (expVal == null && actVal == null) continue;

    if (typeof expVal === "object" && expVal !== null && typeof actVal === "object" && actVal !== null) {
      if (Array.isArray(expVal) && Array.isArray(actVal)) {
        if (JSON.stringify(expVal) !== JSON.stringify(actVal)) {
          drifted.push({ path, expectedValue: expVal, actualValue: actVal });
        }
      } else {
        drifted.push(
          ...detectDrift(
            expVal as Record<string, unknown>,
            actVal as Record<string, unknown>,
            path,
          ),
        );
      }
    } else if (expVal !== actVal) {
      drifted.push({ path, expectedValue: expVal, actualValue: actVal });
    }
  }

  // Check for keys in actual that are not in expected
  for (const key of Object.keys(actual)) {
    if (!(key in expected)) {
      const path = prefix ? `${prefix}.${key}` : key;
      drifted.push({ path, expectedValue: undefined, actualValue: actual[key] });
    }
  }

  return drifted;
}

/** Build a DriftResult from before/after states */
export function buildDriftResult(
  stateId: string,
  expectedResources: ParsedResource[],
  actualAttributes: Map<string, Record<string, unknown>>,
): DriftResult {
  const driftedResources: DriftedResource[] = [];
  const errors: { address: string; error: string }[] = [];
  const byProvider: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const resource of expectedResources) {
    if (resource.mode === "data") continue;

    const actual = actualAttributes.get(resource.address);
    if (!actual) {
      errors.push({ address: resource.address, error: "Resource not found in actual state" });
      continue;
    }

    const drifted = detectDrift(resource.attributes, actual);
    if (drifted.length > 0) {
      driftedResources.push({
        address: resource.address,
        type: resource.type,
        name: resource.name,
        provider: resource.providerShort,
        driftedFields: drifted,
      });

      byProvider[resource.providerShort] = (byProvider[resource.providerShort] ?? 0) + 1;
      byType[resource.type] = (byType[resource.type] ?? 0) + 1;
    }
  }

  const totalManaged = expectedResources.filter((r) => r.mode === "managed").length;
  const summary: DriftSummary = {
    totalDrifted: driftedResources.length,
    totalErrors: errors.length,
    totalClean: totalManaged - driftedResources.length - errors.length,
    byProvider,
    byType,
  };

  return {
    stateId,
    detectedAt: new Date().toISOString(),
    totalResources: totalManaged,
    driftedResources,
    errorResources: errors,
    summary,
  };
}

/** Get dependency graph edges from parsed resources */
export function buildDependencyGraph(resources: ParsedResource[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const r of resources) {
    for (const dep of r.dependencies) {
      edges.push({ from: r.address, to: dep });
    }
  }
  return edges;
}

/** Get all resource types present in state */
export function getResourceTypes(resources: ParsedResource[]): string[] {
  return [...new Set(resources.map((r) => r.type))];
}

/** Get provider distribution */
export function getProviderDistribution(resources: ParsedResource[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const r of resources) {
    dist[r.providerShort] = (dist[r.providerShort] ?? 0) + 1;
  }
  return dist;
}
