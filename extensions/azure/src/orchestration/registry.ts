/**
 * IDIO — Step Registry
 *
 * Central registry for step type definitions and their handlers.
 * Steps are the atomic units of work in an orchestration plan.
 */

import type {
  StepTypeId,
  StepTypeDefinition,
  StepHandler,
  StepCategory,
} from "./types.js";

// =============================================================================
// Registry
// =============================================================================

const stepDefinitions = new Map<StepTypeId, StepTypeDefinition>();
const stepHandlers = new Map<StepTypeId, StepHandler>();

/**
 * Register a step type definition and its handler.
 */
export function registerStepType(definition: StepTypeDefinition, handler: StepHandler): void {
  if (stepDefinitions.has(definition.id)) {
    throw new Error(`Step type "${definition.id}" is already registered`);
  }
  stepDefinitions.set(definition.id, definition);
  stepHandlers.set(definition.id, handler);
}

/**
 * Get a step type definition by ID.
 */
export function getStepDefinition(id: StepTypeId): StepTypeDefinition | undefined {
  return stepDefinitions.get(id);
}

/**
 * Get a step handler by type ID.
 */
export function getStepHandler(id: StepTypeId): StepHandler | undefined {
  return stepHandlers.get(id);
}

/**
 * List all registered step type definitions.
 */
export function listStepTypes(): StepTypeDefinition[] {
  return [...stepDefinitions.values()];
}

/**
 * List step types filtered by category.
 */
export function listStepTypesByCategory(category: StepCategory): StepTypeDefinition[] {
  return [...stepDefinitions.values()].filter((d) => d.category === category);
}

/**
 * Check whether a step type is registered.
 */
export function hasStepType(id: StepTypeId): boolean {
  return stepDefinitions.has(id);
}

/**
 * Remove a step type (useful for testing).
 */
export function unregisterStepType(id: StepTypeId): boolean {
  stepHandlers.delete(id);
  return stepDefinitions.delete(id);
}

/**
 * Clear all registrations (useful for testing).
 */
export function clearStepRegistry(): void {
  stepDefinitions.clear();
  stepHandlers.clear();
}
