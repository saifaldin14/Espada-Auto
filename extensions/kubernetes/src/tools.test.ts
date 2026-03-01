/**
 * Kubernetes agent tools — Unit Tests
 *
 * Tests the execute() paths of k8s_delete, k8s_logs, k8s_scale, k8s_rollout.
 * Mocks the CLI wrapper imports so no real kubectl binary is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createK8sTools } from "./tools.js";

/* ---------- mock setup ---------- */

const mockDelete = vi.fn(async () => 'deployment.apps "web" deleted');
const mockLogs = vi.fn(async () => "2024-01-15T10:00:00Z Starting server\n2024-01-15T10:00:01Z Listening on :8080\n");
const mockScale = vi.fn(async () => 'deployment.apps/web scaled');
const mockRolloutRestart = vi.fn(async () => 'deployment.apps/web restarted');
const mockRolloutUndo = vi.fn(async () => 'deployment.apps/web rolled back');
const mockRolloutStatus = vi.fn(async () => 'deployment "web" successfully rolled out');
const mockRolloutHistory = vi.fn(async () => "REVISION  CHANGE-CAUSE\n1         <none>\n2         kubectl apply");

vi.mock("./cli-wrapper.js", () => ({
  kubectlDelete: mockDelete,
  kubectlLogs: mockLogs,
  kubectlScale: mockScale,
  kubectlRolloutRestart: mockRolloutRestart,
  kubectlRolloutUndo: mockRolloutUndo,
  kubectlRolloutStatus: mockRolloutStatus,
  kubectlRolloutHistory: mockRolloutHistory,
}));

/* ---------- helpers ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolDef = { name: string; description: string; inputSchema: unknown; execute: (input: any) => Promise<{ content: { type: string; text: string }[] }> };

function getTool(name: string): ToolDef {
  const tools = createK8sTools() as ToolDef[];
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found. Available: ${tools.map((t) => t.name).join(", ")}`);
  return tool;
}

function extractText(result: { content: { type: string; text: string }[] }): string {
  return result.content[0]!.text;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ================================================================
   k8s_delete
   ================================================================ */

describe("k8s_delete tool", () => {
  it("calls kubectlDelete with correct args", async () => {
    const tool = getTool("k8s_delete");
    const result = await tool.execute({ resource: "deployment", name: "web" });
    expect(mockDelete).toHaveBeenCalledWith("deployment", "web", {
      namespace: undefined,
      force: undefined,
      gracePeriod: undefined,
    });
    expect(extractText(result)).toContain("Deleted successfully");
    expect(extractText(result)).toContain("web");
  });

  it("passes namespace, force, gracePeriod", async () => {
    const tool = getTool("k8s_delete");
    await tool.execute({
      resource: "pod",
      name: "stuck",
      namespace: "prod",
      force: true,
      gracePeriod: 0,
    });
    expect(mockDelete).toHaveBeenCalledWith("pod", "stuck", {
      namespace: "prod",
      force: true,
      gracePeriod: 0,
    });
  });

  it("returns error text on failure", async () => {
    mockDelete.mockRejectedValueOnce(new Error("not found"));
    const tool = getTool("k8s_delete");
    const result = await tool.execute({ resource: "pod", name: "ghost" });
    expect(extractText(result)).toContain("kubectl delete failed");
    expect(extractText(result)).toContain("not found");
  });
});

/* ================================================================
   k8s_logs
   ================================================================ */

describe("k8s_logs tool", () => {
  it("calls kubectlLogs with pod name", async () => {
    const tool = getTool("k8s_logs");
    const result = await tool.execute({ pod: "web-abc-123" });
    expect(mockLogs).toHaveBeenCalledWith("web-abc-123", expect.objectContaining({}));
    expect(extractText(result)).toContain("Logs from pod web-abc-123");
    expect(extractText(result)).toContain("2 line(s)");
  });

  it("passes all optional params", async () => {
    const tool = getTool("k8s_logs");
    await tool.execute({
      pod: "web-abc",
      namespace: "prod",
      container: "sidecar",
      previous: true,
      tail: 50,
      since: "5m",
      timestamps: true,
    });
    expect(mockLogs).toHaveBeenCalledWith("web-abc", {
      namespace: "prod",
      container: "sidecar",
      previous: true,
      tail: 50,
      since: "5m",
      sinceTime: undefined,
      timestamps: true,
    });
  });

  it("defaults tail to 1000 when not specified", async () => {
    const tool = getTool("k8s_logs");
    await tool.execute({ pod: "web-abc" });
    expect(mockLogs).toHaveBeenCalledWith("web-abc", expect.objectContaining({ tail: 1000 }));
  });

  it("shows container name in output when specified", async () => {
    const tool = getTool("k8s_logs");
    const result = await tool.execute({ pod: "web-abc", container: "nginx" });
    expect(extractText(result)).toContain("(container: nginx)");
  });

  it("shows [previous instance] when previous=true", async () => {
    const tool = getTool("k8s_logs");
    const result = await tool.execute({ pod: "web-abc", previous: true });
    expect(extractText(result)).toContain("[previous instance]");
  });

  it("returns error text on failure", async () => {
    mockLogs.mockRejectedValueOnce(new Error("pod not found"));
    const tool = getTool("k8s_logs");
    const result = await tool.execute({ pod: "ghost" });
    expect(extractText(result)).toContain("kubectl logs failed");
  });
});

/* ================================================================
   k8s_scale
   ================================================================ */

describe("k8s_scale tool", () => {
  it("calls kubectlScale with correct args", async () => {
    const tool = getTool("k8s_scale");
    const result = await tool.execute({ resource: "deployment", name: "web", replicas: 5 });
    expect(mockScale).toHaveBeenCalledWith("deployment", "web", 5, { namespace: undefined });
    expect(extractText(result)).toContain("Scaled deployment/web to 5 replica(s)");
  });

  it("scales to zero", async () => {
    const tool = getTool("k8s_scale");
    const result = await tool.execute({ resource: "deployment", name: "web", replicas: 0 });
    expect(mockScale).toHaveBeenCalledWith("deployment", "web", 0, { namespace: undefined });
    expect(extractText(result)).toContain("0 replica(s)");
  });

  it("passes namespace", async () => {
    const tool = getTool("k8s_scale");
    await tool.execute({ resource: "statefulset", name: "db", replicas: 3, namespace: "prod" });
    expect(mockScale).toHaveBeenCalledWith("statefulset", "db", 3, { namespace: "prod" });
  });

  it("returns error text on failure", async () => {
    mockScale.mockRejectedValueOnce(new Error("permission denied"));
    const tool = getTool("k8s_scale");
    const result = await tool.execute({ resource: "deployment", name: "web", replicas: 2 });
    expect(extractText(result)).toContain("kubectl scale failed");
  });
});

/* ================================================================
   k8s_rollout
   ================================================================ */

describe("k8s_rollout tool", () => {
  describe("restart action", () => {
    it("calls kubectlRolloutRestart", async () => {
      const tool = getTool("k8s_rollout");
      const result = await tool.execute({ action: "restart", resource: "deployment", name: "web" });
      expect(mockRolloutRestart).toHaveBeenCalledWith("deployment", "web", { namespace: undefined });
      expect(extractText(result)).toContain("Rollout restart initiated");
    });
  });

  describe("undo action", () => {
    it("calls kubectlRolloutUndo (previous revision)", async () => {
      const tool = getTool("k8s_rollout");
      const result = await tool.execute({ action: "undo", resource: "deployment", name: "web" });
      expect(mockRolloutUndo).toHaveBeenCalledWith("deployment", "web", {
        namespace: undefined,
        toRevision: undefined,
      });
      expect(extractText(result)).toContain("Rolled back to previous revision");
    });

    it("calls kubectlRolloutUndo with specific revision", async () => {
      const tool = getTool("k8s_rollout");
      const result = await tool.execute({ action: "undo", resource: "deployment", name: "web", toRevision: 3 });
      expect(mockRolloutUndo).toHaveBeenCalledWith("deployment", "web", {
        namespace: undefined,
        toRevision: 3,
      });
      expect(extractText(result)).toContain("Rolled back to revision 3");
    });
  });

  describe("status action", () => {
    it("calls kubectlRolloutStatus", async () => {
      const tool = getTool("k8s_rollout");
      const result = await tool.execute({ action: "status", resource: "deployment", name: "web" });
      expect(mockRolloutStatus).toHaveBeenCalledWith("deployment", "web", { namespace: undefined });
      expect(extractText(result)).toContain("Rollout status");
      expect(extractText(result)).toContain("successfully rolled out");
    });
  });

  describe("history action", () => {
    it("calls kubectlRolloutHistory", async () => {
      const tool = getTool("k8s_rollout");
      const result = await tool.execute({ action: "history", resource: "deployment", name: "web" });
      expect(mockRolloutHistory).toHaveBeenCalledWith("deployment", "web", {
        namespace: undefined,
        revision: undefined,
      });
      expect(extractText(result)).toContain("Rollout history");
      expect(extractText(result)).toContain("REVISION");
    });

    it("passes specific revision", async () => {
      const tool = getTool("k8s_rollout");
      await tool.execute({ action: "history", resource: "deployment", name: "web", revision: 2 });
      expect(mockRolloutHistory).toHaveBeenCalledWith("deployment", "web", {
        namespace: undefined,
        revision: 2,
      });
    });
  });

  describe("error handling", () => {
    it("returns error text on restart failure", async () => {
      mockRolloutRestart.mockRejectedValueOnce(new Error("timeout"));
      const tool = getTool("k8s_rollout");
      const result = await tool.execute({ action: "restart", resource: "deployment", name: "web" });
      expect(extractText(result)).toContain("kubectl rollout failed");
    });

    it("returns message for unknown action", async () => {
      const tool = getTool("k8s_rollout");
      const result = await tool.execute({ action: "bogus", resource: "deployment", name: "web" });
      expect(extractText(result)).toContain("Unknown rollout action");
    });
  });

  describe("namespace pass-through", () => {
    it("passes namespace on all actions", async () => {
      const tool = getTool("k8s_rollout");

      await tool.execute({ action: "restart", resource: "deployment", name: "web", namespace: "prod" });
      expect(mockRolloutRestart).toHaveBeenCalledWith("deployment", "web", { namespace: "prod" });

      await tool.execute({ action: "status", resource: "deployment", name: "web", namespace: "staging" });
      expect(mockRolloutStatus).toHaveBeenCalledWith("deployment", "web", { namespace: "staging" });
    });
  });
});

/* ================================================================
   createK8sTools — registration completeness
   ================================================================ */

describe("createK8sTools", () => {
  it("returns exactly 8 tools", () => {
    const tools = createK8sTools() as ToolDef[];
    expect(tools).toHaveLength(8);
  });

  it("all tools have k8s_ prefix", () => {
    const tools = createK8sTools() as ToolDef[];
    for (const tool of tools) {
      expect(tool.name).toMatch(/^k8s_/);
    }
  });

  it("all tools have name, description, inputSchema, execute", () => {
    const tools = createK8sTools() as ToolDef[];
    for (const tool of tools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool).toHaveProperty("execute");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("contains the expected tool names", () => {
    const tools = createK8sTools() as ToolDef[];
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "k8s_resources",
      "k8s_get",
      "k8s_diff",
      "k8s_apply",
      "k8s_delete",
      "k8s_logs",
      "k8s_scale",
      "k8s_rollout",
    ]);
  });
});
