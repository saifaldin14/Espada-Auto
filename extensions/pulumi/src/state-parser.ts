/**
 * Pulumi state parser — parses exported Pulumi state JSON into normalized resources.
 */

import type {
  PulumiState,
  ParsedPulumiResource,
  PulumiPreviewSummary,
  PulumiPreviewStep,
  PulumiAction,
  PulumiDriftField,
  PulumiDriftedResource,
  PulumiDriftResult,
} from "./types.js";

/**
 * Extract provider name from a Pulumi resource type string.
 * e.g. "aws:s3/bucket:Bucket" → "aws"
 */
export function extractProvider(resourceType: string): string {
  const idx = resourceType.indexOf(":");
  if (idx === -1) return "unknown";
  return resourceType.slice(0, idx);
}

/**
 * Extract short resource name from a URN.
 * e.g. "urn:pulumi:prod::myproject::aws:s3/bucket:Bucket::myBucket" → "myBucket"
 */
export function extractNameFromUrn(urn: string): string {
  const parts = urn.split("::");
  return parts[parts.length - 1] ?? urn;
}

/**
 * Parse a raw Pulumi state export into normalized resources.
 */
export function parseState(state: PulumiState): ParsedPulumiResource[] {
  if (!state?.deployment?.resources) return [];

  return state.deployment.resources
    .filter((r) => r.type !== "pulumi:pulumi:Stack") // skip the stack meta-resource
    .map((r) => ({
      urn: r.urn,
      type: r.type,
      name: extractNameFromUrn(r.urn),
      provider: extractProvider(r.type),
      id: r.id,
      parent: r.parent,
      inputs: r.inputs ?? {},
      outputs: r.outputs ?? {},
      dependencies: r.dependencies ?? [],
    }));
}

/**
 * Parse raw Pulumi preview JSON output into a summary.
 */
export function parsePreview(previewJson: string): PulumiPreviewSummary {
  let data: { steps?: Array<{ op: string; urn: string; type: string; newState?: unknown; oldState?: unknown }> };
  try {
    data = JSON.parse(previewJson);
  } catch {
    return { creates: 0, updates: 0, deletes: 0, replaces: 0, sames: 0, totalChanges: 0, steps: [] };
  }

  const rawSteps = data.steps ?? [];
  const steps: PulumiPreviewStep[] = [];
  let creates = 0;
  let updates = 0;
  let deletes = 0;
  let replaces = 0;
  let sames = 0;

  for (const s of rawSteps) {
    const action = normalizeAction(s.op);
    if (action === "same") {
      sames++;
      continue;
    }

    steps.push({
      urn: s.urn,
      type: s.type,
      action,
      oldState: s.oldState as Record<string, unknown> | undefined,
      newState: s.newState as Record<string, unknown> | undefined,
    });

    switch (action) {
      case "create":
        creates++;
        break;
      case "update":
        updates++;
        break;
      case "delete":
        deletes++;
        break;
      case "replace":
        replaces++;
        break;
    }
  }

  return {
    creates,
    updates,
    deletes,
    replaces,
    sames,
    totalChanges: creates + updates + deletes + replaces,
    steps,
  };
}

function normalizeAction(op: string): PulumiAction {
  switch (op.toLowerCase()) {
    case "create":
    case "create-replacement":
      return "create";
    case "update":
      return "update";
    case "delete":
    case "delete-replaced":
      return "delete";
    case "replace":
      return "replace";
    default:
      return "same";
  }
}

/**
 * Build a dependency graph from parsed Pulumi resources.
 * Returns a Map of URN → array of dependency URNs.
 */
export function buildDependencyGraph(
  resources: ParsedPulumiResource[],
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const r of resources) {
    const deps: string[] = [...r.dependencies];
    if (r.parent) deps.push(r.parent);
    graph.set(r.urn, deps);
  }
  return graph;
}

/**
 * Detect drift between two sets of parsed resources (desired state vs live export).
 */
export function detectDrift(
  desired: ParsedPulumiResource[],
  actual: ParsedPulumiResource[],
  stackName: string,
): PulumiDriftResult {
  const actualMap = new Map(actual.map((r) => [r.urn, r]));
  const driftedResources: PulumiDriftedResource[] = [];

  for (const d of desired) {
    const a = actualMap.get(d.urn);
    if (!a) {
      // resource in desired but not actual → deleted externally
      driftedResources.push({
        urn: d.urn,
        type: d.type,
        fields: [{ field: "(resource)", expected: "exists", actual: "missing" }],
      });
      continue;
    }

    const fields = compareAttributes(d.outputs, a.outputs);
    if (fields.length > 0) {
      driftedResources.push({ urn: d.urn, type: d.type, fields });
    }
  }

  // Resources in actual but not desired → created externally
  for (const a of actual) {
    if (!desired.find((d) => d.urn === a.urn)) {
      driftedResources.push({
        urn: a.urn,
        type: a.type,
        fields: [{ field: "(resource)", expected: "missing", actual: "exists" }],
      });
    }
  }

  return {
    stackName,
    timestamp: new Date().toISOString(),
    totalResources: desired.length,
    driftedCount: driftedResources.length,
    driftedResources,
  };
}

/** Recursively compare two attribute objects and return drifted fields. */
function compareAttributes(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  prefix = "",
): PulumiDriftField[] {
  const fields: PulumiDriftField[] = [];
  const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const e = expected[key];
    const a = actual[key];

    if (e === a) continue;

    if (
      typeof e === "object" &&
      typeof a === "object" &&
      e !== null &&
      a !== null &&
      !Array.isArray(e) &&
      !Array.isArray(a)
    ) {
      fields.push(
        ...compareAttributes(
          e as Record<string, unknown>,
          a as Record<string, unknown>,
          path,
        ),
      );
    } else if (JSON.stringify(e) !== JSON.stringify(a)) {
      fields.push({ field: path, expected: e, actual: a });
    }
  }

  return fields;
}

/**
 * Get unique resource types from parsed resources.
 */
export function getResourceTypes(resources: ParsedPulumiResource[]): string[] {
  return [...new Set(resources.map((r) => r.type))];
}

/**
 * Get provider distribution from parsed resources.
 */
export function getProviderDistribution(
  resources: ParsedPulumiResource[],
): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const r of resources) {
    dist[r.provider] = (dist[r.provider] ?? 0) + 1;
  }
  return dist;
}
