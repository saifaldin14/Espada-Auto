/**
 * Custom Blueprints — Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureBlueprintsDir,
  listCustomBlueprints,
  loadCustomBlueprint,
  parseCustomBlueprint,
  loadTemplateFiles,
  renderTemplate,
  scaffold,
  type CustomBlueprintSource,
} from "./custom.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────────

let testDir: string;
let outputDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `espada-test-blueprints-${Date.now()}`);
  outputDir = join(tmpdir(), `espada-test-output-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

function writeBlueprint(name: string, content: string): void {
  writeFileSync(join(testDir, name), content, "utf-8");
}

function writeDirBlueprint(name: string, yaml: string, templates?: Record<string, string>): void {
  const dir = join(testDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "blueprint.yaml"), yaml, "utf-8");

  if (templates) {
    const templatesDir = join(dir, "templates");
    mkdirSync(templatesDir, { recursive: true });
    for (const [path, content] of Object.entries(templates)) {
      const fullPath = join(templatesDir, path);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
    }
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("ensureBlueprintsDir", () => {
  it("creates directory if it does not exist", () => {
    const dir = join(testDir, "new-blueprints");
    expect(existsSync(dir)).toBe(false);

    const result = ensureBlueprintsDir(dir);
    expect(existsSync(dir)).toBe(true);
    expect(result).toBe(dir);
  });

  it("returns existing directory without error", () => {
    const result = ensureBlueprintsDir(testDir);
    expect(result).toBe(testDir);
  });
});

describe("listCustomBlueprints", () => {
  it("returns empty array for nonexistent directory", () => {
    const result = listCustomBlueprints(join(testDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("lists .yaml files", () => {
    writeBlueprint("web-app.yaml", "id: web-app");
    writeBlueprint("api.yml", "id: api");
    writeBlueprint("readme.txt", "not a blueprint");

    const result = listCustomBlueprints(testDir);
    expect(result).toContain("web-app.yaml");
    expect(result).toContain("api.yml");
    expect(result).not.toContain("readme.txt");
  });

  it("lists directory blueprints with blueprint.yaml", () => {
    writeDirBlueprint("my-template", "id: my-template");

    const result = listCustomBlueprints(testDir);
    expect(result).toContain("my-template");
  });
});

describe("loadCustomBlueprint", () => {
  it("loads a file blueprint by name (appends .yaml)", () => {
    writeBlueprint("webapp.yaml", "id: webapp\nname: Web App");

    const source = loadCustomBlueprint("webapp", testDir);
    expect(source.isDirectory).toBe(false);
    expect(source.raw.id).toBe("webapp");
    expect(source.raw.name).toBe("Web App");
  });

  it("loads a file blueprint with explicit extension", () => {
    writeBlueprint("api.yml", "id: api\nname: API Service");

    const source = loadCustomBlueprint("api.yml", testDir);
    expect(source.raw.id).toBe("api");
  });

  it("loads a directory blueprint", () => {
    writeDirBlueprint("full-stack", "id: full-stack\nname: Full Stack");

    const source = loadCustomBlueprint("full-stack", testDir);
    expect(source.isDirectory).toBe(true);
    expect(source.raw.id).toBe("full-stack");
  });

  it("throws for nonexistent blueprint", () => {
    expect(() => loadCustomBlueprint("nonexistent", testDir)).toThrow("not found");
  });

  it("throws for directory missing blueprint.yaml", () => {
    mkdirSync(join(testDir, "empty-dir"), { recursive: true });
    expect(() => loadCustomBlueprint("empty-dir", testDir)).toThrow("No blueprint.yaml");
  });
});

describe("parseCustomBlueprint", () => {
  it("parses a minimal blueprint with defaults", () => {
    const source: CustomBlueprintSource = {
      filePath: "/test/simple.yaml",
      isDirectory: false,
      raw: { name: "Simple App" },
    };

    const bp = parseCustomBlueprint(source);
    expect(bp.name).toBe("Simple App");
    expect(bp.version).toBe("1.0.0");
    expect(bp.category).toBe("custom");
    expect(bp.providers).toEqual(["aws"]);
    expect(bp.parameters).toEqual([]);
    expect(bp.resources).toEqual([]);
    expect(bp.tags).toEqual([]);
  });

  it("parses full blueprint with all fields", () => {
    const source: CustomBlueprintSource = {
      filePath: "/test/full.yaml",
      isDirectory: false,
      raw: {
        id: "full-app",
        name: "Full App",
        description: "A comprehensive app blueprint",
        version: "2.1.0",
        category: "web-app",
        providers: ["aws", "gcp"],
        parameters: [
          { id: "region", name: "Region", type: "string", required: true, default: "us-east-1" },
          { id: "env", name: "Environment", type: "string", required: false },
        ],
        resources: [
          { type: "aws_instance", name: "web", provider: "aws", config: { instance_type: "t3.micro" } },
        ],
        dependencies: [
          { blueprintId: "networking", optional: false },
        ],
        policies: ["enforce-tags", "cost-limit"],
        tags: ["production", "web"],
        estimatedCostRange: [100, 500],
      },
    };

    const bp = parseCustomBlueprint(source);
    expect(bp.id).toBe("full-app");
    expect(bp.category).toBe("web-app");
    expect(bp.providers).toEqual(["aws", "gcp"]);
    expect(bp.parameters).toHaveLength(2);
    expect(bp.parameters[0]!.id).toBe("region");
    expect(bp.parameters[0]!.required).toBe(true);
    expect(bp.resources).toHaveLength(1);
    expect(bp.dependencies).toHaveLength(1);
    expect(bp.policies).toEqual(["enforce-tags", "cost-limit"]);
    expect(bp.tags).toEqual(["production", "web"]);
    expect(bp.estimatedCostRange).toEqual([100, 500]);
  });

  it("validates category — unknown defaults to custom", () => {
    const source: CustomBlueprintSource = {
      filePath: "/test/unknown.yaml",
      isDirectory: false,
      raw: { category: "unknown-category" },
    };

    const bp = parseCustomBlueprint(source);
    expect(bp.category).toBe("custom");
  });

  it("validates category — known categories pass through", () => {
    for (const cat of ["web-app", "api", "data", "container", "serverless", "static-site"]) {
      const source: CustomBlueprintSource = {
        filePath: "/test/cat.yaml",
        isDirectory: false,
        raw: { category: cat },
      };
      expect(parseCustomBlueprint(source).category).toBe(cat);
    }
  });

  it("uses filename as ID when no id field", () => {
    const source: CustomBlueprintSource = {
      filePath: "/blueprints/my-app.yaml",
      isDirectory: false,
      raw: { name: "My App" },
    };

    const bp = parseCustomBlueprint(source);
    expect(bp.id).toBe("my-app");
  });
});

describe("renderTemplate", () => {
  it("replaces ${{ inputs.name }} placeholders", () => {
    const result = renderTemplate("Hello, ${{ inputs.name }}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("replaces multiple placeholders", () => {
    const template = "Region: ${{ inputs.region }}, Env: ${{ inputs.env }}";
    const result = renderTemplate(template, { region: "us-east-1", env: "prod" });
    expect(result).toBe("Region: us-east-1, Env: prod");
  });

  it("replaces unknown parameters with empty string", () => {
    const result = renderTemplate("Value: ${{ inputs.missing }}", {});
    expect(result).toBe("Value: ");
  });

  it("handles no placeholders", () => {
    const result = renderTemplate("No placeholders here", { name: "test" });
    expect(result).toBe("No placeholders here");
  });

  it("handles whitespace variations in placeholder syntax", () => {
    const result = renderTemplate("${{inputs.a}} ${{  inputs.b  }}", { a: "1", b: "2" });
    expect(result).toBe("1 2");
  });
});

describe("loadTemplateFiles", () => {
  it("returns empty map when no templates/ directory", () => {
    const dir = join(testDir, "no-templates");
    mkdirSync(dir, { recursive: true });

    const files = loadTemplateFiles(dir);
    expect(files.size).toBe(0);
  });

  it("loads template files recursively", () => {
    writeDirBlueprint("bp", "id: bp", {
      "main.tf": 'resource "aws_instance" "${{ inputs.name }}" {}',
      "modules/vpc.tf": "# VPC module",
    });

    const files = loadTemplateFiles(join(testDir, "bp"));
    expect(files.size).toBe(2);
    expect(files.has("main.tf")).toBe(true);
    expect(files.has("modules/vpc.tf")).toBe(true);
    expect(files.get("main.tf")).toContain("aws_instance");
  });
});

describe("scaffold", () => {
  it("scaffolds a file blueprint with resources", () => {
    const yaml = [
      "id: simple",
      "name: Simple App",
      "category: web-app",
      "providers:",
      "  - aws",
      "parameters:",
      "  - id: name",
      "    name: Name",
      "    type: string",
      "    default: myapp",
      "resources:",
      "  - type: aws_instance",
      "    name: web",
      "    provider: aws",
      "    config:",
      "      instance_type: t3.micro",
    ].join("\n");

    writeBlueprint("simple.yaml", yaml);

    const result = scaffold("simple", outputDir, { name: "test-app" }, testDir);
    expect(result.blueprint.name).toBe("Simple App");
    expect(result.filesWritten).toContain("aws-resources.tf");
    expect(result.outputDir).toBe(outputDir);
  });

  it("scaffolds a directory blueprint with templates", () => {
    const yaml = [
      "id: fullstack",
      "name: Full Stack",
      "parameters:",
      "  - id: appName",
      "    name: App Name",
      "    type: string",
    ].join("\n");

    writeDirBlueprint("fullstack", yaml, {
      "README.md": "# ${{ inputs.appName }}",
      "src/index.ts": 'console.log("${{ inputs.appName }}")',
    });

    const result = scaffold("fullstack", outputDir, { appName: "MyProject" }, testDir);
    expect(result.filesWritten).toContain("README.md");
    expect(result.filesWritten).toContain("src/index.ts");

    // Verify template rendering
    const { readFileSync } = require("node:fs");
    const readme = readFileSync(join(outputDir, "README.md"), "utf-8");
    expect(readme).toBe("# MyProject");

    const index = readFileSync(join(outputDir, "src/index.ts"), "utf-8");
    expect(index).toContain("MyProject");
  });

  it("resolves default parameter values", () => {
    const yaml = [
      "id: defaults",
      "name: Defaults Test",
      "parameters:",
      "  - id: region",
      "    name: Region",
      "    type: string",
      "    default: us-west-2",
      "resources:",
      "  - type: aws_instance",
      "    name: ${{ inputs.region }}-server",
      "    provider: aws",
      "    config:",
      "      region: ${{ inputs.region }}",
    ].join("\n");

    writeBlueprint("defaults.yaml", yaml);

    const result = scaffold("defaults", outputDir, {}, testDir);
    const { readFileSync } = require("node:fs");
    const content = readFileSync(join(outputDir, "aws-resources.tf"), "utf-8");
    expect(content).toContain("us-west-2");
  });

  it("creates output directory recursively", () => {
    const nestedOutput = join(outputDir, "deep", "nested", "dir");
    const yaml = "id: minimal\nname: Minimal";
    writeBlueprint("minimal.yaml", yaml);

    scaffold("minimal", nestedOutput, {}, testDir);
    expect(existsSync(nestedOutput)).toBe(true);
  });
});

// ── YAML Parsing (via loadCustomBlueprint) ──────────────────────────────────────

describe("YAML parsing (via loadCustomBlueprint)", () => {
  it("parses scalar values", () => {
    writeBlueprint("scalars.yaml", [
      "name: My Blueprint",
      "version: 1.0.0",
      "count: 42",
      "enabled: true",
      "disabled: false",
      "nothing: null",
    ].join("\n"));

    const source = loadCustomBlueprint("scalars", testDir);
    expect(source.raw.name).toBe("My Blueprint");
    expect(source.raw.version).toBe("1.0.0");
    expect(source.raw.count).toBe(42);
    expect(source.raw.enabled).toBe(true);
    expect(source.raw.disabled).toBe(false);
    expect(source.raw.nothing).toBeNull();
  });

  it("parses inline lists", () => {
    writeBlueprint("inline.yaml", "tags: [web, api, prod]");

    const source = loadCustomBlueprint("inline", testDir);
    expect(source.raw.tags).toEqual(["web", "api", "prod"]);
  });

  it("parses inline maps", () => {
    writeBlueprint("map.yaml", "config: {region: us-east-1, env: prod}");

    const source = loadCustomBlueprint("map", testDir);
    expect(source.raw.config).toEqual({ region: "us-east-1", env: "prod" });
  });

  it("parses block lists", () => {
    writeBlueprint("block-list.yaml", [
      "providers:",
      "  - aws",
      "  - gcp",
      "  - azure",
    ].join("\n"));

    const source = loadCustomBlueprint("block-list", testDir);
    expect(source.raw.providers).toEqual(["aws", "gcp", "azure"]);
  });

  it("parses nested objects", () => {
    writeBlueprint("nested.yaml", [
      "config:",
      "  region: us-east-1",
      "  instance_type: t3.micro",
    ].join("\n"));

    const source = loadCustomBlueprint("nested", testDir);
    const config = source.raw.config as Record<string, unknown>;
    expect(config.region).toBe("us-east-1");
    expect(config.instance_type).toBe("t3.micro");
  });

  it("parses quoted strings", () => {
    writeBlueprint("quoted.yaml", [
      'single: \'hello world\'',
      'double: "foo bar"',
    ].join("\n"));

    const source = loadCustomBlueprint("quoted", testDir);
    expect(source.raw.single).toBe("hello world");
    expect(source.raw.double).toBe("foo bar");
  });

  it("parses float values", () => {
    writeBlueprint("float.yaml", "price: 19.99");

    const source = loadCustomBlueprint("float", testDir);
    expect(source.raw.price).toBe(19.99);
  });
});
