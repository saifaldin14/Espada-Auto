/**
 * Blueprint engine — validation, rendering, preview, and deployment lifecycle.
 */

import type {
  Blueprint,
  BlueprintInstance,
  BlueprintParameter,
  BlueprintResource,
  PreviewResult,
  RenderResult,
  ValidationError,
} from "./types.js";

/**
 * Validate parameters against a blueprint's parameter schema.
 */
export function validateParameters(
  blueprint: Blueprint,
  parameters: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const param of blueprint.parameters) {
    const value = parameters[param.id] ?? param.default;

    if (param.required && value == null) {
      errors.push({ parameterId: param.id, message: `Required parameter "${param.name}" is missing` });
      continue;
    }

    if (value == null) continue;

    errors.push(...validateParameterValue(param, value));
  }

  // Check for unknown parameters
  const knownIds = new Set(blueprint.parameters.map((p) => p.id));
  for (const key of Object.keys(parameters)) {
    if (!knownIds.has(key)) {
      errors.push({ parameterId: key, message: `Unknown parameter "${key}"` });
    }
  }

  return errors;
}

/**
 * Validate a single parameter value against its schema.
 */
export function validateParameterValue(
  param: BlueprintParameter,
  value: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Type check
  switch (param.type) {
    case "string":
      if (typeof value !== "string") {
        errors.push({ parameterId: param.id, message: `Expected string, got ${typeof value}` });
        return errors;
      }
      if (param.validation?.minLength != null && value.length < param.validation.minLength) {
        errors.push({
          parameterId: param.id,
          message: `Must be at least ${param.validation.minLength} characters`,
        });
      }
      if (param.validation?.maxLength != null && value.length > param.validation.maxLength) {
        errors.push({
          parameterId: param.id,
          message: `Must be at most ${param.validation.maxLength} characters`,
        });
      }
      if (param.validation?.pattern != null && !new RegExp(param.validation.pattern).test(value)) {
        errors.push({
          parameterId: param.id,
          message: `Must match pattern: ${param.validation.pattern}`,
        });
      }
      break;

    case "number":
      if (typeof value !== "number") {
        errors.push({ parameterId: param.id, message: `Expected number, got ${typeof value}` });
        return errors;
      }
      if (param.validation?.min != null && value < param.validation.min) {
        errors.push({ parameterId: param.id, message: `Must be at least ${param.validation.min}` });
      }
      if (param.validation?.max != null && value > param.validation.max) {
        errors.push({ parameterId: param.id, message: `Must be at most ${param.validation.max}` });
      }
      break;

    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({ parameterId: param.id, message: `Expected boolean, got ${typeof value}` });
      }
      break;

    case "select":
      if (param.options && !param.options.includes(String(value))) {
        errors.push({
          parameterId: param.id,
          message: `Must be one of: ${param.options.join(", ")}`,
        });
      }
      break;
  }

  return errors;
}

/**
 * Resolve parameters — fill in defaults for missing optional params.
 */
export function resolveParameters(
  blueprint: Blueprint,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const param of blueprint.parameters) {
    resolved[param.id] = parameters[param.id] ?? param.default;
  }
  return resolved;
}

/**
 * Render template string, replacing `${{ inputs.name }}` placeholders.
 */
export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\$\{\{\s*inputs\.(\w+)\s*\}\}/g, (_match, key: string) => {
    const val = params[key];
    return val != null ? String(val) : "";
  });
}

/**
 * Render blueprint resources with resolved parameters.
 */
export function renderResources(
  resources: BlueprintResource[],
  params: Record<string, unknown>,
): BlueprintResource[] {
  return resources.map((r) => ({
    ...r,
    name: renderTemplate(r.name, params),
    config: renderConfigObject(r.config, params),
  }));
}

function renderConfigObject(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      result[key] = renderTemplate(value, params);
    } else if (value != null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = renderConfigObject(value as Record<string, unknown>, params);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Render a blueprint into output files (HCL-like config).
 */
export function render(
  blueprint: Blueprint,
  parameters: Record<string, unknown>,
): RenderResult {
  const resolved = resolveParameters(blueprint, parameters);
  const renderedResources = renderResources(blueprint.resources, resolved);
  const files = new Map<string, string>();

  // Group resources by provider
  const byProvider = new Map<string, BlueprintResource[]>();
  for (const r of renderedResources) {
    const list = byProvider.get(r.provider) ?? [];
    list.push(r);
    byProvider.set(r.provider, list);
  }

  // Generate a file per provider
  for (const [provider, resources] of byProvider) {
    const lines: string[] = [];
    lines.push(`# ${blueprint.name} — ${provider} resources`);
    lines.push(`# Generated by Espada Blueprints v${blueprint.version}`);
    lines.push("");

    for (const r of resources) {
      lines.push(`resource "${r.type}" "${r.name}" {`);
      for (const [k, v] of Object.entries(r.config)) {
        lines.push(`  ${k} = ${formatHclValue(v)}`);
      }
      lines.push("}");
      lines.push("");
    }

    files.set(`${provider}-resources.tf`, lines.join("\n"));
  }

  return { files, resources: renderedResources, resolvedParameters: resolved };
}

function formatHclValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatHclValue).join(", ")}]`;
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} = ${formatHclValue(v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return "null";
}

/**
 * Preview a blueprint — validate + render without deploying.
 */
export function preview(
  blueprint: Blueprint,
  parameters: Record<string, unknown>,
): PreviewResult {
  const validationErrors = validateParameters(blueprint, parameters);
  const resolved = resolveParameters(blueprint, parameters);
  const renderedResources = renderResources(blueprint.resources, resolved);

  return {
    blueprint,
    resolvedParameters: resolved,
    resources: renderedResources,
    estimatedCostRange: blueprint.estimatedCostRange,
    validationErrors,
  };
}

/**
 * In-memory instance store for blueprint deployments.
 */
export class InstanceStore {
  private instances = new Map<string, BlueprintInstance>();

  create(
    blueprint: Blueprint,
    name: string,
    parameters: Record<string, unknown>,
  ): BlueprintInstance {
    const instance: BlueprintInstance = {
      id: crypto.randomUUID(),
      blueprintId: blueprint.id,
      name,
      parameters,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "deploying",
      resources: [],
      graphGroupId: "",
    };
    this.instances.set(instance.id, instance);
    return instance;
  }

  get(id: string): BlueprintInstance | null {
    return this.instances.get(id) ?? null;
  }

  list(): BlueprintInstance[] {
    return [...this.instances.values()];
  }

  updateStatus(id: string, status: BlueprintInstance["status"]): BlueprintInstance | null {
    const inst = this.instances.get(id);
    if (!inst) return null;
    inst.status = status;
    inst.updatedAt = new Date().toISOString();
    return inst;
  }

  delete(id: string): boolean {
    return this.instances.delete(id);
  }
}
