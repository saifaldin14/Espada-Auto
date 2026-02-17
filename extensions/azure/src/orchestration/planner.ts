/**
 * IDIO — DAG Planner & Dependency Resolver
 *
 * Validates execution plans, resolves inter-step references, performs
 * topological sort for execution order, and detects cycles.
 */

import type {
  ExecutionPlan,
  PlanStep,
  PlanValidation,
  PlanValidationIssue,
  StepOutputRef,
  StepCondition,
  StepInstanceId,
} from "./types.js";
import { getStepDefinition, hasStepType } from "./registry.js";

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
 * - Unreachable steps
 * - Invalid conditions
 *
 * Returns { valid, issues[] } — safe to execute when valid === true.
 */
export function validatePlan(plan: ExecutionPlan): PlanValidation {
  const issues: PlanValidationIssue[] = [];
  const stepIds = new Set(plan.steps.map((s) => s.id));
  const stepMap = new Map(plan.steps.map((s) => [s.id, s]));

  // 1. Each step must reference a known step type
  for (const step of plan.steps) {
    if (!hasStepType(step.type)) {
      issues.push({ severity: "error", stepId: step.id, code: "UNKNOWN_STEP_TYPE", message: `Unknown step type "${step.type}"` });
      continue; // skip param checks for unknown types
    }

    // 2. Validate required parameters
    const def = getStepDefinition(step.type)!;
    for (const paramDef of def.parameters) {
      if (!paramDef.required) continue;
      const value = step.params[paramDef.name];
      if (value === undefined || value === null || value === "") {
        // Allow values from output refs — we'll check those separately
        if (typeof value === "string" && isOutputRef(value)) continue;
        issues.push({
          severity: "error",
          stepId: step.id,
          code: "MISSING_PARAM",
          message: `Missing required parameter "${paramDef.name}" for step type "${step.type}"`,
        });
      }
    }
  }

  // 3. Validate dependsOn references
  for (const step of plan.steps) {
    if (!step.dependsOn) continue;
    for (const depId of step.dependsOn) {
      if (!stepIds.has(depId as StepInstanceId)) {
        issues.push({
          severity: "error",
          stepId: step.id,
          code: "INVALID_DEP",
          message: `dependsOn refers to unknown step "${depId}"`,
        });
      }
      if (depId === step.id) {
        issues.push({
          severity: "error",
          stepId: step.id,
          code: "SELF_DEP",
          message: `Step depends on itself`,
        });
      }
    }
  }

  // 4. Validate output references in params
  for (const step of plan.steps) {
    for (const [paramName, value] of Object.entries(step.params)) {
      if (typeof value !== "string" || !isOutputRef(value)) continue;
      const parsed = parseOutputRef(value);
      if (!parsed) {
        issues.push({ severity: "error", stepId: step.id, code: "INVALID_OUTPUT_REF", message: `Invalid output reference format "${value}" in param "${paramName}"` });
        continue;
      }
      const { sourceStepId, outputName } = parsed;
      if (!stepIds.has(sourceStepId as StepInstanceId)) {
        issues.push({ severity: "error", stepId: step.id, code: "UNKNOWN_OUTPUT_STEP", message: `Output ref "${value}" refers to unknown step "${sourceStepId}"` });
        continue;
      }
      // Ensure the source step is a dependency (direct or transitive)
      if (!isTransitiveDependency(step.id, sourceStepId, stepMap)) {
        issues.push({
          severity: "warning",
          stepId: step.id,
          code: "UNDECLARED_DEP",
          message: `Output ref "${value}" references step "${sourceStepId}" which is not a dependency — may cause runtime ordering issues`,
        });
      }
      // Validate the output exists on the step type
      const sourceStep = stepMap.get(sourceStepId as StepInstanceId);
      if (sourceStep && hasStepType(sourceStep.type)) {
        const sourceDef = getStepDefinition(sourceStep.type)!;
        const outputExists = sourceDef.outputs.some((o) => o.name === outputName);
        if (!outputExists) {
          issues.push({
            severity: "error",
            stepId: step.id,
            code: "INVALID_OUTPUT_NAME",
            message: `Output ref "${value}": step type "${sourceStep.type}" has no output named "${outputName}"`,
          });
        }
      }
    }
  }

  // 5. Validate conditions
  for (const step of plan.steps) {
    if (!step.condition) continue;
    validateCondition(step.condition, step.id, stepIds, issues);
  }

  // 6. Detect cycles
  const cycle = detectCycle(plan.steps);
  if (cycle) {
    issues.push({
      severity: "error",
      code: "CYCLE",
      message: `Circular dependency detected: ${cycle.join(" → ")}`,
    });
  }

  // 7. Check for duplicate step IDs
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (seen.has(step.id)) {
      issues.push({ severity: "error", stepId: step.id, code: "DUPLICATE_ID", message: `Duplicate step ID "${step.id}"` });
    }
    seen.add(step.id);
  }

  return {
    valid: issues.every((i) => i.severity !== "error"),
    issues,
  };
}

// =============================================================================
// Topological Sort
// =============================================================================

/**
 * Topological sort of plan steps (Kahn's algorithm).
 * Returns execution layers: steps in the same layer can run concurrently.
 *
 * @throws Error if the plan has cycles (should be caught by validatePlan first).
 */
export function topologicalSort(steps: readonly PlanStep[]): PlanStep[][] {
  // Build adjacency + in-degree
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  const stepMap = new Map<string, PlanStep>();

  for (const step of steps) {
    stepMap.set(step.id, step);
    if (!inDegree.has(step.id)) inDegree.set(step.id, 0);
    if (!adj.has(step.id)) adj.set(step.id, new Set());
  }

  // Also track implicit dependencies from output refs
  for (const step of steps) {
    const deps = new Set<string>(step.dependsOn ?? []);
    // Add implicit deps from output references
    for (const value of Object.values(step.params)) {
      if (typeof value !== "string" || !isOutputRef(value)) continue;
      const parsed = parseOutputRef(value);
      if (parsed) deps.add(parsed.sourceStepId);
    }
    for (const dep of deps) {
      if (!adj.has(dep)) adj.set(dep, new Set());
      adj.get(dep)!.add(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  // Kahn's layered BFS
  const layers: PlanStep[][] = [];
  let queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let processed = 0;

  while (queue.length > 0) {
    const layer = queue.map((id) => stepMap.get(id)!).filter(Boolean);
    layers.push(layer);
    processed += queue.length;

    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const neighbor of adj.get(id) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
  }

  if (processed < steps.length) {
    throw new Error("Cycle detected in execution plan — topological sort failed");
  }

  return layers;
}

/**
 * Flatten topological layers into a single ordered list.
 */
export function flattenLayers(layers: PlanStep[][]): PlanStep[] {
  return layers.flat();
}

// =============================================================================
// Output Reference Resolution
// =============================================================================

const OUTPUT_REF_REGEX = /^([a-zA-Z0-9_-]+)\.outputs\.([a-zA-Z0-9_]+)$/;

/** Check if a value is a step output reference. */
export function isOutputRef(value: string): value is StepOutputRef {
  return OUTPUT_REF_REGEX.test(value);
}

/** Parse an output reference into its components. */
export function parseOutputRef(ref: string): { sourceStepId: string; outputName: string } | null {
  const match = OUTPUT_REF_REGEX.exec(ref);
  if (!match) return null;
  return { sourceStepId: match[1], outputName: match[2] };
}

/**
 * Resolve all output references in a step's params, substituting
 * concrete values from already-completed step outputs.
 */
export function resolveStepParams(
  step: PlanStep,
  resolvedOutputs: Map<string, Record<string, unknown>>,
  globalParams: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(step.params)) {
    if (typeof value === "string" && isOutputRef(value)) {
      const parsed = parseOutputRef(value);
      if (parsed) {
        const stepOutputs = resolvedOutputs.get(parsed.sourceStepId);
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
    } else if (typeof value === "string" && value.startsWith("$global.")) {
      // Support $global.paramName references
      const globalKey = value.slice("$global.".length);
      resolved[key] = globalParams[globalKey] ?? value;
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
 * Evaluate whether a step condition is met given current step states and outputs.
 */
export function evaluateCondition(
  condition: StepCondition,
  stepStates: Map<string, { status: string }>,
  resolvedOutputs: Map<string, Record<string, unknown>>,
): boolean {
  switch (condition.check) {
    case "succeeded":
      return stepStates.get(condition.stepId)?.status === "succeeded";

    case "failed":
      return stepStates.get(condition.stepId)?.status === "failed";

    case "output-equals": {
      const outputs = resolvedOutputs.get(condition.stepId);
      if (!outputs || !condition.outputName) return false;
      return outputs[condition.outputName] === condition.expectedValue;
    }

    case "output-truthy": {
      const outputs = resolvedOutputs.get(condition.stepId);
      if (!outputs || !condition.outputName) return false;
      return Boolean(outputs[condition.outputName]);
    }

    default:
      return true;
  }
}

// =============================================================================
// Helpers
// =============================================================================

function validateCondition(
  condition: StepCondition,
  stepId: string,
  validStepIds: Set<string>,
  issues: PlanValidationIssue[],
) {
  if (!validStepIds.has(condition.stepId as StepInstanceId)) {
    issues.push({
      severity: "error",
      stepId: stepId as StepInstanceId,
      code: "INVALID_CONDITION_STEP",
      message: `Condition references unknown step "${condition.stepId}"`,
    });
  }
}

/**
 * Check if `sourceStepId` is a transitive dependency of `stepId`.
 */
function isTransitiveDependency(
  stepId: string,
  sourceStepId: string,
  stepMap: Map<StepInstanceId, PlanStep>,
): boolean {
  const visited = new Set<string>();
  const queue = [stepId];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const step = stepMap.get(current as StepInstanceId);
    if (!step?.dependsOn) continue;
    for (const dep of step.dependsOn) {
      if (dep === sourceStepId) return true;
      queue.push(dep);
    }
  }

  return false;
}

/**
 * Detect cycles in the dependency graph using DFS.
 * Returns the cycle path if found, or null.
 */
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
    if (!color.has(dep)) continue; // unknown step, validation handles it
    if (color.get(dep) === GRAY) {
      // Found cycle — reconstruct path
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
      const cycle = dfs(dep, stepMap, color, parent);
      if (cycle) return cycle;
    }
  }

  color.set(nodeId, BLACK);
  return null;
}
