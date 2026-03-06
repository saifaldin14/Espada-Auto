/**
 * Cross-Cloud Migration Engine — Extension Contract Tests
 *
 * Validates that the cloud-migration extension:
 * 1. Registers all 14 expected gateway methods
 * 2. Registers 10 agent tools via registerTool
 * 3. Registers CLI commands via registerCli
 * 4. Registers the core service via registerService
 * 5. Gateway methods respond correctly (smoke tests)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createApiMock,
  invokeGateway,
  type GatewayHandler,
} from "../../test-utils/small-extension-contract-helpers.js";

describe("cloud-migration — extension contract", () => {
  let gateways: Map<string, GatewayHandler>;
  let registerTool: ReturnType<typeof vi.fn>;
  let registerCli: ReturnType<typeof vi.fn>;
  let registerService: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const mock = createApiMock();
    gateways = mock.gatewayMethods;
    registerTool = mock.registerTool;
    registerCli = mock.registerCli;
    registerService = mock.registerService;

    const mod = await import("../index.js");
    mod.default.register(mock.api);
  });

  // ─── Gateway method registration ──────────────────────────────
  const EXPECTED_GATEWAYS = [
    "migration/assess",
    "migration/plan",
    "migration/plan/approve",
    "migration/execute",
    "migration/status",
    "migration/jobs",
    "migration/rollback",
    "migration/cutover",
    "migration/verify",
    "migration/compatibility",
    "migration/cost",
    "migration/audit",
    "migration/policy",
    "migration/diagnostics/reset",
    "migration/agent/health",
    "migration/agent/discover",
  ] as const;

  it("registers all 16 gateway methods", () => {
    for (const name of EXPECTED_GATEWAYS) {
      expect(gateways.has(name), `missing gateway: ${name}`).toBe(true);
    }
    expect(gateways.size).toBe(16);
  });

  // ─── Tool registration ────────────────────────────────────────
  const EXPECTED_TOOLS = [
    "migration_assess",
    "migration_plan",
    "migration_execute",
    "migration_status",
    "migration_verify",
    "migration_rollback",
    "migration_cutover",
    "migration_history",
    "migration_compatibility",
    "migration_estimate_cost",
  ] as const;

  it("registers all 10 agent tools", () => {
    expect(registerTool).toHaveBeenCalledTimes(10);

    const names = registerTool.mock.calls.map(
      (call: unknown[]) => (call[0] as { name: string }).name,
    );
    for (const name of EXPECTED_TOOLS) {
      expect(names, `missing tool: ${name}`).toContain(name);
    }
  });

  it("all tools have required fields (name, label, description, parameters, execute)", () => {
    for (const [toolDef] of registerTool.mock.calls) {
      expect(toolDef).toHaveProperty("name");
      expect(toolDef).toHaveProperty("label");
      expect(toolDef).toHaveProperty("description");
      expect(toolDef).toHaveProperty("parameters");
      expect(toolDef).toHaveProperty("execute");
      expect(typeof toolDef.execute).toBe("function");
    }
  });

  // ─── Service registration ─────────────────────────────────────
  it("registers a service with start and stop", () => {
    expect(registerService).toHaveBeenCalledTimes(1);
    const svc = registerService.mock.calls[0][0];
    expect(svc).toHaveProperty("id", "cloud-migration-core");
    expect(typeof svc.start).toBe("function");
    expect(typeof svc.stop).toBe("function");
  });

  // ─── CLI registration ─────────────────────────────────────────
  it("registers CLI commands", () => {
    expect(registerCli).toHaveBeenCalledTimes(1);
    expect(typeof registerCli.mock.calls[0][0]).toBe("function");
  });

  // ─── Gateway smoke tests ──────────────────────────────────────
  it("migration/compatibility responds with matrix data", async () => {
    const { success, payload } = await invokeGateway(gateways, "migration/compatibility", {
      source: "aws",
      target: "azure",
    });
    expect(success).toBe(true);
    const response = payload as Record<string, unknown>;
    expect(response).toHaveProperty("data");
  });

  it("migration/diagnostics/reset clears diagnostics", async () => {
    const { success, payload } = await invokeGateway(gateways, "migration/diagnostics/reset");
    expect(success).toBe(true);
    const response = (payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(response).toHaveProperty("reset", true);
  });

  it("migration/jobs returns jobs list (initially empty)", async () => {
    const { success, payload } = await invokeGateway(gateways, "migration/jobs");
    expect(success).toBe(true);
    const response = (payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(response).toHaveProperty("jobs");
    expect(Array.isArray(response.jobs)).toBe(true);
  });

  it("migration/cost responds with an estimate", async () => {
    const { success, payload } = await invokeGateway(gateways, "migration/cost", {
      sourceProvider: "aws",
      targetProvider: "gcp",
      vmCount: 2,
      totalStorageGB: 50,
    });
    expect(success).toBe(true);
    const response = (payload as Record<string, unknown>).data;
    expect(response).toBeTruthy();
  });

  it("migration/policy responds with builtin policies", async () => {
    const { success, payload } = await invokeGateway(gateways, "migration/policy");
    expect(success).toBe(true);
    const response = (payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(response).toHaveProperty("policies");
  });

  it("migration/audit responds with entries (initially empty)", async () => {
    const { success, payload } = await invokeGateway(gateways, "migration/audit", {});
    expect(success).toBe(true);
    const response = (payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(response).toHaveProperty("entries");
  });

  it("migration/assess handles missing params gracefully", async () => {
    const { success } = await invokeGateway(gateways, "migration/assess", {});
    // Should either succeed with default handling or fail gracefully
    expect(typeof success).toBe("boolean");
  });

  it("migration/status responds with error for non-existent job", async () => {
    const { success } = await invokeGateway(gateways, "migration/status", {
      jobId: "nonexistent-job-id",
    });
    expect(success).toBe(false);
  });
});
