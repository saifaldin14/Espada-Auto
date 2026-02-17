/**
 * IDIO — DAG Planner & Dependency Resolver (GCP)
 *
 * Validates execution plans, resolves inter-step output references,
 * performs topological sort for execution order, and detects cycles.
 */

import type { ExecutionPlan, PlanStep, StepCondition, StepResult } from "./types.js";
import { hasStepType, getStepDefinition } from "./steps.js";

// =============================================================================
// Output Reference Parsing
// =============================================================================

const OUTPUT_REF_REGEX = /^\$step\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)$/;

/** Check if a value is a step output reference ($step.X.Y). */
export function isOutputRef(value: string): boolean {
  return OUTPUT_REF_REGEX.test(value);
}

/** Parse an output reference into its components. */
function parseOutputRef(ref: string): { sourceStepId: string; outputName: string } | null {
  const match = OUTPUT_REF_REGEX.exec(ref);
  if (!match) return null;
  return { sourceStepId: match[1], outputName: match[2] };
}

// =============================================================================
// Plan Validation
// =============================================================================

/**
 * Validate an execution plan for:
 * - Unknown step types
 * - Missing required parameters
 * - Invalid dependsOn references
 * - Invalid output references
 * - Circular dependencies
 * - Duplicate step IDs
 *
 * Returns an array of error messages. Empty array = valid plan.
 */
export function validatePlan(plan: ExecutionPlan): string[] {
  const errors: string[] = [];
  const stepIds = new Set(plan.steps.map((s) => s.id));

  // Check for duplicate step IDs
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (seen.has(step.id)) {
      errors.push(`Duplicate step ID "${step.id}"`);
    }
    seen.add(step.id);
  }

  for (const step of plan.steps) {
    // Validate step type is registered
    if (!hasStepType(step.type)) {
      errors.push(`Step "${step.id}": unknown step type "${step.type}"`);
      continue;
    }

    // Validate required parameters
    const def = getStepDefinition(step.type);
    if (def) {
      for (const param of def.requiredParams) {
        const value = step.params[param];
        if (value === undefined || value === null || value === "") {
          // Allow output references — they'll be resolved at runtime
          if (typeof value === "string" && isOutputRef(value)) continue;
          errors.push(`Step "${step.id}": missing required parameter "${param}" for type "${step.type}"`);
        }
      }
    }

    // Validate dependsOn references
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        if (!stepIds.has(depId)) {
          errors.push(`Step "${step.id}": dependsOn references unknown step "${depId}"`);
        }
        if (depId === step.id) {
          errors.push(`Step "${step.id}": step depends on itself`);
        }
      }
    }

    // Validate output references in params
    for (const [paramName, value] of Object.entries(step.params)) {
      if (typeof value !== "string" || !isOutputRef(value)) continue;
      const parsed = parseOutputRef(value);
      if (!parsed) {
        errors.push(`Step "${step.id}": invalid output reference format "${value}" in param "${paramName}"`);
        continue;
      }
      if (!stepIds.has(parsed.sourceStepId)) {
        errors.push(`Step "${step.id}": output ref "${value}" references unknown step "${parsed.sourceStepId}"`);
      }
    }

    // Validate conditions
    if (step.condition && !stepIds.has(step.condition.stepId)) {
      errors.push(`Step "${step.id}": condition references unknown step "${step.condition.stepId}"`);
    }
  }

  // Detect cycles
  const cycle = detectCycle(plan.steps);
  if (cycle) {
    errors.push(`Circular dependency detected: ${cycle.join(" → ")}`);
  }

  return errors;
}

// =============================================================================
// Topological Sort (Kahn's Algorithm)
// =============================================================================

/**
 * Topologically sort plan steps using Kahn's algorithm.
 * Returns steps in execution order. Steps with no dependencies come first.
 *
 * @throws Error if the plan has cycles.
 */
export function topologicalSort(plan: ExecutionPlan): PlanStep[] {
  const steps = plan.steps;
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  // Build adjacency list and in-degree map
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();

  for (const step of steps) {
    if (!inDegree.has(step.id)) inDegree.set(step.id, 0);
    if (!adj.has(step.id)) adj.set(step.id, new Set());
  }

  for (const step of steps) {
    const deps = new Set<string>(step.dependsOn ?? []);

    // Add implicit dependencies from output references
    for (const value of Object.values(step.params)) {
      if (typeof value !== "string" || !isOutputRef(value)) continue;
      const parsed = parseOutputRef(value);
      if (parsed && stepMap.has(parsed.sourceStepId)) {
        deps.add(parsed.sourceStepId);
      }
    }

    for (const dep of deps) {
      if (!adj.has(dep)) adj.set(dep, new Set());
      adj.get(dep)!.add(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  // BFS
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const sorted: PlanStep[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const step = stepMap.get(id);
    if (step) sorted.push(step);

    for (const neighbor of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (sorted.length < steps.length) {
    throw new Error("Cycle detected in execution plan — topological sort failed");
  }

  return sorted;
}

// =============================================================================
// Output Reference Resolution
// =============================================================================

/**
 * Resolve all $step.X.Y output references in a step's params,
 * substituting concrete values from completed step outputs.
 */
export function resolveStepParams(
  params: Record<string, unknown>,
  outputs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && isOutputRef(value)) {
      const parsed = parseOutputRef(value);
      if (parsed) {
        const stepOutputs = outputs[parsed.sourceStepId];
        if (!stepOutputs) {
          throw new Error(`Cannot resolve "${value}": step "${parsed.sourceStepId}" has no outputs yet`);
        }
        const outputVal = stepOutputs[parsed.outputName];
        if (outputVal === undefined) {
          throw new Error(`Cannot resolve "${value}": output "${parsed.outputName}" not found in step "${parsed.sourceStepId}"`);
        }
        resolved[key] = outputVal;
      } else {
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

// =============================================================================
// Condition Evaluation
// =============================================================================

/**
 * Evaluate whether a step's condition is met based on completed step results.
 */
export function evaluateCondition(
  condition: StepCondition,
  results: Map<string, StepResult>,
): boolean {
  const result = results.get(condition.stepId);
  if (!result) return false;

  switch (condition.check) {
    case "succeeded":
    case "completed":
      return result.status === "completed";
    case "failed":
      return result.status === "failed";
    case "skipped":
      return result.status === "skipped";
    default:
      return false;
  }
}

// =============================================================================
// Cycle Detection (DFS)
// =============================================================================

function detectCycle(steps: readonly PlanStep[]): string[] | null {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const step of steps) {
    color.set(step.id, WHITE);
    parent.set(step.id, null);
  }

  for (const step of steps) {
    if (color.get(step.id) === WHITE) {
      const cycle = dfs(step.id, stepMap, color, parent);
      if (cycle) return cycle;
    }
  }

  return null;
}

function dfs(
  nodeId: string,
  stepMap: Map<string, PlanStep>,
  color: Map<string, number>,
  parent: Map<string, string | null>,
): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  color.set(nodeId, GRAY);

  const step = stepMap.get(nodeId);
  const deps = new Set<string>(step?.dependsOn ?? []);

  // Include implicit deps from output refs
  if (step) {
    for (const value of Object.values(step.params)) {
      if (typeof value === "string" && isOutputRef(value)) {
        const parsed = parseOutputRef(value);
        if (parsed) deps.add(parsed.sourceStepId);
      }
    }
  }

  for (const dep of deps) {
    if (!color.has(dep)) continue;
    if (color.get(dep) === GRAY) {
      // Cycle found — reconstruct path
      const cycle = [dep, nodeId];
      let cur = nodeId;
      while (parent.get(cur) && parent.get(cur) !== dep) {
        cur = parent.get(cur)!;
        cycle.push(cur);
      }
      cycle.push(dep);
      return cycle.reverse();
    }
    if (color.get(dep) === WHITE) {
      parent.set(dep, nodeId);
      const result = dfs(dep, stepMap, color, parent);
      if (result) return result;
    }
  }

  color.set(nodeId, BLACK);
  return null;
}
