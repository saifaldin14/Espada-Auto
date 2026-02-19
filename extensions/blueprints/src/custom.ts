/**
 * Custom Blueprint support — load, validate, and scaffold from user-defined blueprints.
 *
 * Custom blueprints live in ~/.espada/blueprints/ as YAML files.
 * They use `${{ inputs.name }}` templating (same syntax as engine.ts).
 *
 * Directory layout:
 *   ~/.espada/blueprints/
 *     my-api/
 *       blueprint.yaml     — blueprint definition
 *       templates/          — optional template files
 *         main.tf
 *         variables.tf
 *     flask-app.yaml        — single-file blueprint
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";
import type {
  Blueprint,
  BlueprintCategory,
  BlueprintParameter,
  BlueprintResource,
  CloudProvider,
} from "./types.js";

/** Default blueprints directory. */
const BLUEPRINTS_DIR = join(homedir(), ".espada", "blueprints");

// ── YAML Parsing (lightweight — no external dep) ────────────────────────────

/**
 * Minimal YAML parser for blueprint definitions.
 * Handles the subset needed: scalars, lists, maps, multiline strings.
 * For complex YAML, recommend users install a proper YAML lib.
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const match = line.match(/^(\w[\w.-]*)\s*:\s*(.*)/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    const valueStr = match[2].trim();

    if (valueStr === "" || valueStr === "|" || valueStr === ">") {
      // Block scalar or nested object/list — look at next lines
      const indent = getIndent(lines[i + 1] ?? "");
      if (indent > 0) {
        const block = collectBlock(lines, i + 1, indent);
        i = block.endIndex;

        if (valueStr === "|" || valueStr === ">") {
          result[key] = block.lines.join(valueStr === "|" ? "\n" : " ");
        } else if (block.lines[0]?.trim().startsWith("-")) {
          result[key] = parseYamlList(block.lines);
        } else {
          result[key] = parseSimpleYaml(block.lines.join("\n"));
        }
      } else {
        result[key] = "";
        i++;
      }
    } else if (valueStr.startsWith("[")) {
      // Inline list
      result[key] = parseInlineList(valueStr);
      i++;
    } else if (valueStr.startsWith("{")) {
      // Inline map
      result[key] = parseInlineMap(valueStr);
      i++;
    } else {
      result[key] = parseScalar(valueStr);
      i++;
    }
  }

  return result;
}

function getIndent(line: string): number {
  const match = line.match(/^(\s+)/);
  return match ? match[1].length : 0;
}

function collectBlock(lines: string[], start: number, minIndent: number): { lines: string[]; endIndex: number } {
  const collected: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      collected.push("");
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent < minIndent) break;
    collected.push(line.slice(minIndent));
    i++;
  }
  // Trim trailing empty lines
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
  }
  return { lines: collected, endIndex: i };
}

function parseYamlList(lines: string[]): unknown[] {
  const items: unknown[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const match = line.match(/^-\s*(.*)/);
    if (!match) {
      i++;
      continue;
    }
    const value = match[1].trim();
    if (value && !value.includes(":")) {
      items.push(parseScalar(value));
      i++;
    } else if (value.includes(":")) {
      // Inline map item: - key: value
      const mapLines = [value];
      i++;
      // Collect continued indented lines
      const baseIndent = getIndent(lines[i] ?? "");
      if (baseIndent > 0) {
        const block = collectBlock(lines, i, baseIndent);
        mapLines.push(...block.lines);
        i = block.endIndex;
      }
      items.push(parseSimpleYaml(mapLines.join("\n")));
    } else {
      // Sub-block list item
      i++;
      const baseIndent = getIndent(lines[i] ?? "");
      if (baseIndent > 0) {
        const block = collectBlock(lines, i, baseIndent);
        i = block.endIndex;
        items.push(parseSimpleYaml(block.lines.join("\n")));
      }
    }
  }
  return items;
}

function parseInlineList(value: string): unknown[] {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((s) => parseScalar(s.trim()));
}

function parseInlineMap(value: string): Record<string, unknown> {
  const inner = value.slice(1, -1).trim();
  if (!inner) return {};
  const result: Record<string, unknown> = {};
  for (const pair of inner.split(",")) {
    const [k, v] = pair.split(":").map((s) => s.trim());
    if (k && v !== undefined) result[k] = parseScalar(v);
  }
  return result;
}

function parseScalar(value: string): string | number | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  // Strip quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ── Blueprint Loading ───────────────────────────────────────────────────────────

export interface CustomBlueprintSource {
  filePath: string;
  isDirectory: boolean;
  raw: Record<string, unknown>;
}

/**
 * Ensure the blueprints directory exists.
 */
export function ensureBlueprintsDir(dir = BLUEPRINTS_DIR): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * List available custom blueprint files/directories.
 */
export function listCustomBlueprints(dir = BLUEPRINTS_DIR): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir).filter((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Directory blueprint — must have blueprint.yaml
      return existsSync(join(fullPath, "blueprint.yaml")) || existsSync(join(fullPath, "blueprint.yml"));
    }

    // File blueprint — .yaml or .yml extension
    const ext = extname(entry).toLowerCase();
    return ext === ".yaml" || ext === ".yml";
  });
}

/**
 * Load a custom blueprint from a file or directory.
 */
export function loadCustomBlueprint(nameOrPath: string, dir = BLUEPRINTS_DIR): CustomBlueprintSource {
  // Resolve path
  let fullPath: string;
  if (nameOrPath.startsWith("/") || nameOrPath.startsWith("~")) {
    fullPath = nameOrPath.replace(/^~/, homedir());
  } else {
    fullPath = join(dir, nameOrPath);
  }

  // Directory blueprint
  if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
    const yamlPath = existsSync(join(fullPath, "blueprint.yaml"))
      ? join(fullPath, "blueprint.yaml")
      : join(fullPath, "blueprint.yml");

    if (!existsSync(yamlPath)) {
      throw new Error(`No blueprint.yaml found in ${fullPath}`);
    }

    const content = readFileSync(yamlPath, "utf-8");
    return { filePath: yamlPath, isDirectory: true, raw: parseSimpleYaml(content) };
  }

  // File blueprint — try with and without extension
  const candidates = [
    fullPath,
    `${fullPath}.yaml`,
    `${fullPath}.yml`,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const content = readFileSync(candidate, "utf-8");
      return { filePath: candidate, isDirectory: false, raw: parseSimpleYaml(content) };
    }
  }

  throw new Error(`Custom blueprint not found: ${nameOrPath} (searched in ${dir})`);
}

/**
 * Convert raw YAML data into a validated Blueprint object.
 */
export function parseCustomBlueprint(source: CustomBlueprintSource): Blueprint {
  const raw = source.raw;

  const id = String(raw.id ?? basename(source.filePath, extname(source.filePath)));
  const name = String(raw.name ?? id);
  const description = String(raw.description ?? "");
  const version = String(raw.version ?? "1.0.0");
  const category = validateCategory(String(raw.category ?? "custom"));

  const providers = parseProviders(raw.providers);
  const parameters = parseParameters(raw.parameters);
  const resources = parseResources(raw.resources);
  const dependencies = parseDependencies(raw.dependencies);
  const policies = parseStringList(raw.policies);
  const tags = parseStringList(raw.tags);

  const costRange = parseCostRange(raw.estimatedCostRange ?? raw.cost_range);

  return {
    id,
    name,
    description,
    version,
    category,
    providers,
    parameters,
    resources,
    dependencies,
    policies,
    estimatedCostRange: costRange,
    tags,
  };
}

function validateCategory(cat: string): BlueprintCategory {
  const valid: BlueprintCategory[] = ["web-app", "api", "data", "container", "serverless", "static-site", "custom"];
  return valid.includes(cat as BlueprintCategory) ? (cat as BlueprintCategory) : "custom";
}

function parseProviders(raw: unknown): CloudProvider[] {
  if (!Array.isArray(raw)) return ["aws"];
  return raw.map((p) => String(p)) as CloudProvider[];
}

function parseParameters(raw: unknown): BlueprintParameter[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((p) => ({
    id: String(p.id ?? p.name ?? ""),
    name: String(p.name ?? p.id ?? ""),
    description: p.description ? String(p.description) : undefined,
    type: (String(p.type ?? "string")) as BlueprintParameter["type"],
    required: Boolean(p.required ?? false),
    default: p.default,
    options: p.options ? (p.options as string[]) : undefined,
    validation: p.validation as BlueprintParameter["validation"],
  }));
}

function parseResources(raw: unknown): BlueprintResource[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((r) => ({
    type: String(r.type ?? ""),
    name: String(r.name ?? ""),
    provider: String(r.provider ?? "aws") as CloudProvider,
    config: (r.config as Record<string, unknown>) ?? {},
  }));
}

function parseDependencies(raw: unknown): Blueprint["dependencies"] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((d) => ({
    blueprintId: String(d.blueprintId ?? d.id ?? ""),
    optional: Boolean(d.optional ?? false),
  }));
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s));
}

function parseCostRange(raw: unknown): [number, number] {
  if (Array.isArray(raw) && raw.length >= 2) {
    return [Number(raw[0]) || 0, Number(raw[1]) || 0];
  }
  return [0, 0];
}

// ── Template Files ──────────────────────────────────────────────────────────────

/**
 * Load template files from a directory blueprint's templates/ folder.
 * Returns a map of relative path → file content.
 */
export function loadTemplateFiles(blueprintDir: string): Map<string, string> {
  const templatesDir = join(blueprintDir, "templates");
  const files = new Map<string, string>();

  if (!existsSync(templatesDir)) return files;

  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        files.set(relativePath, readFileSync(fullPath, "utf-8"));
      }
    }
  }

  walk(templatesDir, "");
  return files;
}

/**
 * Render template string, replacing `${{ inputs.name }}` placeholders.
 * Same syntax as engine.ts — kept here for standalone custom blueprint use.
 */
export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\$\{\{\s*inputs\.(\w+)\s*\}\}/g, (_match, key: string) => {
    const val = params[key];
    return val != null ? String(val) : "";
  });
}

// ── Scaffold ────────────────────────────────────────────────────────────────────

export interface ScaffoldResult {
  outputDir: string;
  filesWritten: string[];
  blueprint: Blueprint;
}

/**
 * Scaffold a project from a custom blueprint.
 *
 * Renders all template files with the provided parameters and writes
 * them to the output directory.
 */
export function scaffold(
  blueprintName: string,
  outputDir: string,
  parameters: Record<string, unknown>,
  blueprintsDir = BLUEPRINTS_DIR,
): ScaffoldResult {
  const source = loadCustomBlueprint(blueprintName, blueprintsDir);
  const blueprint = parseCustomBlueprint(source);
  const resolvedParams = resolveDefaults(blueprint, parameters);

  mkdirSync(outputDir, { recursive: true });
  const filesWritten: string[] = [];

  // If directory blueprint with templates, render and write them
  if (source.isDirectory) {
    const dir = join(blueprintsDir, blueprintName);
    const templates = loadTemplateFiles(dir);

    for (const [relativePath, content] of templates) {
      const renderedPath = renderTemplate(relativePath, resolvedParams);
      const renderedContent = renderTemplate(content, resolvedParams);
      const fullPath = join(outputDir, renderedPath);

      // Ensure parent directory exists
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, renderedContent, "utf-8");
      filesWritten.push(renderedPath);
    }
  }

  // Generate resource files from blueprint resources (same as engine.ts render)
  if (blueprint.resources.length > 0) {
    const byProvider = new Map<string, BlueprintResource[]>();
    for (const r of blueprint.resources) {
      const rendered: BlueprintResource = {
        ...r,
        name: renderTemplate(r.name, resolvedParams),
        config: renderConfigObject(r.config, resolvedParams),
      };
      const list = byProvider.get(r.provider) ?? [];
      list.push(rendered);
      byProvider.set(r.provider, list);
    }

    for (const [provider, resources] of byProvider) {
      const lines: string[] = [];
      lines.push(`# ${blueprint.name} — ${provider} resources`);
      lines.push(`# Generated by Espada Custom Blueprints`);
      lines.push("");

      for (const r of resources) {
        lines.push(`resource "${r.type}" "${r.name}" {`);
        for (const [k, v] of Object.entries(r.config)) {
          lines.push(`  ${k} = ${formatValue(v)}`);
        }
        lines.push("}");
        lines.push("");
      }

      const fileName = `${provider}-resources.tf`;
      writeFileSync(join(outputDir, fileName), lines.join("\n"), "utf-8");
      filesWritten.push(fileName);
    }
  }

  return { outputDir, filesWritten, blueprint };
}

/** Fill in default values for missing parameters. */
function resolveDefaults(blueprint: Blueprint, params: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const p of blueprint.parameters) {
    resolved[p.id] = params[p.id] ?? p.default;
  }
  return resolved;
}

function renderConfigObject(config: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown> {
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

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} = ${formatValue(v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return "null";
}
