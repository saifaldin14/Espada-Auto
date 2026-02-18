import { describe, expect, it } from "vitest";
import {
  parseState,
  parsePreview,
  detectDrift,
  buildDependencyGraph,
  extractProvider,
  extractNameFromUrn,
  getResourceTypes,
  getProviderDistribution,
} from "./state-parser.js";
import type { PulumiState, ParsedPulumiResource } from "./types.js";

/* ---------- helpers ---------- */

function makeState(resources: PulumiState["deployment"]["resources"] = []): PulumiState {
  return {
    version: 3,
    deployment: {
      manifest: { time: "2024-01-01T00:00:00Z", magic: "", version: "3.0.0" },
      resources,
    },
  };
}

/* ================================================================
   extractProvider / extractNameFromUrn
   ================================================================ */

describe("extractProvider", () => {
  it("extracts aws from aws:s3/bucket:Bucket", () => {
    expect(extractProvider("aws:s3/bucket:Bucket")).toBe("aws");
  });

  it("extracts azure-native from azure-native:storage:StorageAccount", () => {
    expect(extractProvider("azure-native:storage:StorageAccount")).toBe("azure-native");
  });

  it("returns unknown for malformed type", () => {
    expect(extractProvider("noColonHere")).toBe("unknown");
  });
});

describe("extractNameFromUrn", () => {
  it("extracts name from full URN", () => {
    expect(extractNameFromUrn("urn:pulumi:prod::myproject::aws:s3/bucket:Bucket::myBucket")).toBe("myBucket");
  });

  it("returns the string if no :: separators", () => {
    expect(extractNameFromUrn("simple")).toBe("simple");
  });
});

/* ================================================================
   parseState
   ================================================================ */

describe("parseState", () => {
  it("returns empty array for empty state", () => {
    expect(parseState(makeState())).toEqual([]);
  });

  it("skips pulumi:pulumi:Stack meta-resource", () => {
    const state = makeState([
      { urn: "urn:pulumi:dev::proj::pulumi:pulumi:Stack::proj-dev", type: "pulumi:pulumi:Stack", custom: false, inputs: {}, outputs: {} },
    ]);
    expect(parseState(state)).toHaveLength(0);
  });

  it("parses a single AWS resource", () => {
    const state = makeState([
      {
        urn: "urn:pulumi:prod::proj::aws:s3/bucket:Bucket::logs",
        type: "aws:s3/bucket:Bucket",
        custom: true,
        id: "my-logs-bucket",
        inputs: { bucket: "my-logs-bucket" },
        outputs: { bucket: "my-logs-bucket", arn: "arn:aws:s3:::my-logs-bucket" },
      },
    ]);

    const resources = parseState(state);
    expect(resources).toHaveLength(1);
    expect(resources[0]!.type).toBe("aws:s3/bucket:Bucket");
    expect(resources[0]!.provider).toBe("aws");
    expect(resources[0]!.name).toBe("logs");
    expect(resources[0]!.id).toBe("my-logs-bucket");
  });

  it("handles resources with dependencies", () => {
    const state = makeState([
      {
        urn: "urn:pulumi:prod::proj::aws:ec2/instance:Instance::web",
        type: "aws:ec2/instance:Instance",
        custom: true,
        id: "i-123",
        inputs: {},
        outputs: {},
        dependencies: ["urn:pulumi:prod::proj::aws:ec2/securityGroup:SecurityGroup::sg"],
      },
    ]);

    const resources = parseState(state);
    expect(resources[0]!.dependencies).toContain("urn:pulumi:prod::proj::aws:ec2/securityGroup:SecurityGroup::sg");
  });

  it("handles resources with parent", () => {
    const state = makeState([
      {
        urn: "urn:pulumi:prod::proj::custom:Component$aws:s3/bucket:Bucket::child",
        type: "aws:s3/bucket:Bucket",
        custom: true,
        parent: "urn:pulumi:prod::proj::custom:Component::parent",
        inputs: {},
        outputs: {},
      },
    ]);

    const resources = parseState(state);
    expect(resources[0]!.parent).toBe("urn:pulumi:prod::proj::custom:Component::parent");
  });

  it("parses multiple resources from different providers", () => {
    const state = makeState([
      { urn: "urn:pulumi:dev::p::aws:s3/bucket:Bucket::b", type: "aws:s3/bucket:Bucket", custom: true, inputs: {}, outputs: {} },
      { urn: "urn:pulumi:dev::p::gcp:storage/bucket:Bucket::g", type: "gcp:storage/bucket:Bucket", custom: true, inputs: {}, outputs: {} },
    ]);

    const resources = parseState(state);
    expect(resources).toHaveLength(2);
    expect(resources[0]!.provider).toBe("aws");
    expect(resources[1]!.provider).toBe("gcp");
  });
});

/* ================================================================
   parsePreview
   ================================================================ */

describe("parsePreview", () => {
  it("handles empty / malformed JSON gracefully", () => {
    const summary = parsePreview("{}");
    expect(summary.totalChanges).toBe(0);
  });

  it("handles invalid JSON gracefully", () => {
    const summary = parsePreview("not json");
    expect(summary.totalChanges).toBe(0);
  });

  it("counts create steps", () => {
    const json = JSON.stringify({
      steps: [
        { op: "create", urn: "urn:1", type: "aws:s3/bucket:Bucket" },
        { op: "create", urn: "urn:2", type: "aws:iam/role:Role" },
      ],
    });
    const summary = parsePreview(json);
    expect(summary.creates).toBe(2);
    expect(summary.totalChanges).toBe(2);
  });

  it("counts update steps", () => {
    const json = JSON.stringify({
      steps: [{ op: "update", urn: "urn:1", type: "aws:s3/bucket:Bucket" }],
    });
    expect(parsePreview(json).updates).toBe(1);
  });

  it("counts delete steps", () => {
    const json = JSON.stringify({
      steps: [{ op: "delete", urn: "urn:1", type: "aws:s3/bucket:Bucket" }],
    });
    expect(parsePreview(json).deletes).toBe(1);
  });

  it("counts replace steps", () => {
    const json = JSON.stringify({
      steps: [{ op: "replace", urn: "urn:1", type: "aws:ec2/instance:Instance" }],
    });
    expect(parsePreview(json).replaces).toBe(1);
  });

  it("skips same operations from totalChanges", () => {
    const json = JSON.stringify({
      steps: [
        { op: "same", urn: "urn:1", type: "aws:s3/bucket:Bucket" },
        { op: "create", urn: "urn:2", type: "aws:iam/role:Role" },
      ],
    });
    const summary = parsePreview(json);
    expect(summary.sames).toBe(1);
    expect(summary.totalChanges).toBe(1);
  });
});

/* ================================================================
   detectDrift
   ================================================================ */

describe("detectDrift", () => {
  const makeResource = (urn: string, outputs: Record<string, unknown> = {}): ParsedPulumiResource => ({
    urn,
    type: "aws:s3/bucket:Bucket",
    name: "test",
    provider: "aws",
    inputs: {},
    outputs,
    dependencies: [],
  });

  it("returns zero drift for identical resources", () => {
    const desired = [makeResource("urn:1", { acl: "private" })];
    const actual = [makeResource("urn:1", { acl: "private" })];
    const result = detectDrift(desired, actual, "dev");
    expect(result.driftedCount).toBe(0);
  });

  it("detects changed output field", () => {
    const desired = [makeResource("urn:1", { acl: "private" })];
    const actual = [makeResource("urn:1", { acl: "public-read" })];
    const result = detectDrift(desired, actual, "dev");
    expect(result.driftedCount).toBe(1);
    expect(result.driftedResources[0]!.fields[0]!.field).toBe("acl");
  });

  it("detects missing resource in actual (deleted externally)", () => {
    const desired = [makeResource("urn:1")];
    const result = detectDrift(desired, [], "dev");
    expect(result.driftedCount).toBe(1);
    expect(result.driftedResources[0]!.fields[0]!.actual).toBe("missing");
  });

  it("detects extra resource in actual (created externally)", () => {
    const result = detectDrift([], [makeResource("urn:new")], "dev");
    expect(result.driftedCount).toBe(1);
    expect(result.driftedResources[0]!.fields[0]!.expected).toBe("missing");
  });

  it("detects nested object changes", () => {
    const desired = [makeResource("urn:1", { config: { key: "a" } })];
    const actual = [makeResource("urn:1", { config: { key: "b" } })];
    const result = detectDrift(desired, actual, "dev");
    expect(result.driftedCount).toBe(1);
  });
});

/* ================================================================
   buildDependencyGraph
   ================================================================ */

describe("buildDependencyGraph", () => {
  it("returns empty graph for no resources", () => {
    expect(buildDependencyGraph([]).size).toBe(0);
  });

  it("includes dependency edges", () => {
    const resources: ParsedPulumiResource[] = [
      { urn: "urn:a", type: "aws:s3/bucket:Bucket", name: "a", provider: "aws", inputs: {}, outputs: {}, dependencies: ["urn:b"] },
      { urn: "urn:b", type: "aws:iam/role:Role", name: "b", provider: "aws", inputs: {}, outputs: {}, dependencies: [] },
    ];
    const graph = buildDependencyGraph(resources);
    expect(graph.get("urn:a")).toContain("urn:b");
    expect(graph.get("urn:b")).toEqual([]);
  });

  it("includes parent as dependency", () => {
    const resources: ParsedPulumiResource[] = [
      { urn: "urn:child", type: "aws:s3/bucket:Bucket", name: "child", provider: "aws", parent: "urn:parent", inputs: {}, outputs: {}, dependencies: [] },
    ];
    const graph = buildDependencyGraph(resources);
    expect(graph.get("urn:child")).toContain("urn:parent");
  });
});

/* ================================================================
   getResourceTypes / getProviderDistribution
   ================================================================ */

describe("utility helpers", () => {
  const resources: ParsedPulumiResource[] = [
    { urn: "urn:1", type: "aws:s3/bucket:Bucket", name: "a", provider: "aws", inputs: {}, outputs: {}, dependencies: [] },
    { urn: "urn:2", type: "aws:ec2/instance:Instance", name: "b", provider: "aws", inputs: {}, outputs: {}, dependencies: [] },
    { urn: "urn:3", type: "gcp:storage/bucket:Bucket", name: "c", provider: "gcp", inputs: {}, outputs: {}, dependencies: [] },
  ];

  it("getResourceTypes returns unique types", () => {
    const types = getResourceTypes(resources);
    expect(types).toHaveLength(3);
    expect(types).toContain("aws:s3/bucket:Bucket");
    expect(types).toContain("gcp:storage/bucket:Bucket");
  });

  it("getProviderDistribution counts correctly", () => {
    const dist = getProviderDistribution(resources);
    expect(dist.aws).toBe(2);
    expect(dist.gcp).toBe(1);
  });
});
