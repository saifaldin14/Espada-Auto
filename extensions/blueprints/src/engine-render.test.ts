/**
 * Engine render tests — HCL output formatting, multi-provider generation,
 * nested config rendering, and environment-aware blueprints.
 */

import { describe, expect, it } from "vitest";
import {
  render,
  renderResources,
  renderTemplate,
  preview,
  resolveParameters,
} from "./engine.js";
import { getBlueprintById, builtInBlueprints } from "./library.js";
import type { Blueprint, BlueprintResource } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeBp = (overrides?: Partial<Blueprint>): Blueprint => ({
  id: "render-test",
  name: "Render Test",
  description: "Test blueprint for render coverage",
  version: "2.0.0",
  category: "web-app",
  providers: ["aws"],
  parameters: [
    { id: "name", name: "Name", type: "string", required: true },
    { id: "env", name: "Env", type: "select", required: false, default: "staging", options: ["dev", "staging", "prod"] },
    { id: "replicas", name: "Replicas", type: "number", required: false, default: 1 },
    { id: "enable_cdn", name: "CDN", type: "boolean", required: false, default: false },
  ],
  resources: [],
  dependencies: [],
  policies: [],
  estimatedCostRange: [5, 100],
  tags: ["test"],
  ...overrides,
});

// ---------------------------------------------------------------------------
// HCL value formatting via render output
// ---------------------------------------------------------------------------
describe("render — HCL value formatting", () => {
  it("formats string config values with quotes", () => {
    const bp = makeBp({
      resources: [
        { type: "aws_instance", name: "web", provider: "aws", config: { ami: "ami-12345" } },
      ],
    });
    const { files } = render(bp, { name: "app" });
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain('ami = "ami-12345"');
  });

  it("formats numeric config values without quotes", () => {
    const bp = makeBp({
      resources: [
        { type: "aws_instance", name: "web", provider: "aws", config: { memory_size: 512 } },
      ],
    });
    const { files } = render(bp, { name: "app" });
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("memory_size = 512");
  });

  it("formats boolean config values", () => {
    const bp = makeBp({
      resources: [
        { type: "aws_s3_bucket", name: "bucket", provider: "aws", config: { versioning: true } },
      ],
    });
    const { files } = render(bp, { name: "app" });
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("versioning = true");
  });

  it("formats array config values", () => {
    const bp = makeBp({
      resources: [
        { type: "aws_security_group", name: "sg", provider: "aws", config: { ingress_ports: [80, 443] } },
      ],
    });
    const { files } = render(bp, { name: "app" });
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("ingress_ports = [80, 443]");
  });

  it("formats nested object config values", () => {
    const bp = makeBp({
      resources: [
        { type: "aws_s3_bucket", name: "site", provider: "aws", config: { website: { index_document: "index.html", error_document: "error.html" } } },
      ],
    });
    const { files } = render(bp, { name: "app" });
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("website = {");
    expect(hcl).toContain("index_document");
  });

  it("formats null config values", () => {
    const bp = makeBp({
      resources: [
        { type: "aws_instance", name: "x", provider: "aws", config: { optional_field: null } },
      ],
    });
    const { files } = render(bp, { name: "app" });
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("optional_field = null");
  });
});

// ---------------------------------------------------------------------------
// Multi-provider rendering
// ---------------------------------------------------------------------------
describe("render — multi-provider output", () => {
  it("creates one file per provider", () => {
    const bp = makeBp({
      providers: ["aws", "gcp", "azure"],
      resources: [
        { type: "aws_instance", name: "web", provider: "aws", config: {} },
        { type: "google_compute_instance", name: "api", provider: "gcp", config: {} },
        { type: "azurerm_linux_virtual_machine", name: "worker", provider: "azure", config: {} },
      ],
    });
    const { files } = render(bp, { name: "x" });
    expect(files.size).toBe(3);
    expect(files.has("aws-resources.tf")).toBe(true);
    expect(files.has("gcp-resources.tf")).toBe(true);
    expect(files.has("azure-resources.tf")).toBe(true);
  });

  it("includes version header in each file", () => {
    const bp = makeBp({
      version: "3.1.0",
      resources: [
        { type: "aws_instance", name: "web", provider: "aws", config: {} },
      ],
    });
    const { files } = render(bp, { name: "x" });
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("Generated by Espada Blueprints v3.1.0");
  });

  it("groups multiple resources of same provider in one file", () => {
    const bp = makeBp({
      resources: [
        { type: "aws_instance", name: "web-${{ inputs.name }}", provider: "aws", config: {} },
        { type: "aws_s3_bucket", name: "data-${{ inputs.name }}", provider: "aws", config: {} },
      ],
    });
    const { files } = render(bp, { name: "myapp" });
    expect(files.size).toBe(1);
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("web-myapp");
    expect(hcl).toContain("data-myapp");
  });
});

// ---------------------------------------------------------------------------
// Template rendering with environment-like parameters
// ---------------------------------------------------------------------------
describe("renderResources — templated config", () => {
  it("renders templates deeply in config objects", () => {
    const resources: BlueprintResource[] = [
      {
        type: "aws_instance",
        name: "${{ inputs.name }}-${{ inputs.env }}",
        provider: "aws",
        config: {
          tags: { Name: "${{ inputs.name }}", Environment: "${{ inputs.env }}" },
        },
      },
    ];
    const result = renderResources(resources, { name: "api", env: "prod" });
    expect(result[0]!.name).toBe("api-prod");
    const tags = result[0]!.config.tags as Record<string, string>;
    expect(tags.Name).toBe("api");
    expect(tags.Environment).toBe("prod");
  });

  it("leaves non-string config values untouched", () => {
    const resources: BlueprintResource[] = [
      { type: "aws_instance", name: "web", provider: "aws", config: { count: 3, enabled: true, ports: [80, 443] } },
    ];
    const result = renderResources(resources, {});
    expect(result[0]!.config.count).toBe(3);
    expect(result[0]!.config.enabled).toBe(true);
    expect(result[0]!.config.ports).toEqual([80, 443]);
  });
});

// ---------------------------------------------------------------------------
// Built-in library rendering end-to-end
// ---------------------------------------------------------------------------
describe("built-in blueprint rendering", () => {
  it("renders three-tier-web-app-aws with valid HCL", () => {
    const bp = getBlueprintById("three-tier-web-app-aws")!;
    const { files, resources } = render(bp, { name: "shop", region: "us-east-1" });
    expect(files.has("aws-resources.tf")).toBe(true);
    expect(resources.length).toBe(3);
    const hcl = files.get("aws-resources.tf")!;
    expect(hcl).toContain("shop-alb");
    expect(hcl).toContain("shop-web");
    expect(hcl).toContain("shop-db");
  });

  it("renders serverless-api-gcp with valid HCL", () => {
    const bp = getBlueprintById("serverless-api-gcp")!;
    const { files } = render(bp, { name: "svc", runtime: "python3.11" });
    const hcl = files.get("gcp-resources.tf")!;
    expect(hcl).toContain("svc-fn");
    expect(hcl).toContain("google_cloudfunctions_function");
  });

  it("preview of every built-in blueprint succeeds with minimal params", () => {
    for (const bp of builtInBlueprints) {
      const params: Record<string, unknown> = { name: "test" };
      if (bp.parameters.some((p) => p.id === "runtime")) params.runtime = "nodejs18.x";
      const result = preview(bp, params);
      expect(result.blueprint.id).toBe(bp.id);
      expect(result.estimatedCostRange).toHaveLength(2);
    }
  });
});
