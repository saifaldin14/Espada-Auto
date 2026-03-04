import { afterEach, describe, expect, it, vi } from "vitest";

import copilotProxyPlugin from "./copilot-proxy/index.js";
import googleAntigravityPlugin from "./google-antigravity-auth/index.js";
import qwenPortalPlugin from "./qwen-portal-auth/index.js";
import memoryCorePlugin from "./memory-core/index.js";
import {
  createApiMock,
  getRegisteredProvider,
  getRegisteredToolFactory,
  invokeGateway,
} from "./test-utils/small-extension-contract-helpers.js";

describe("small extension baseline contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers copilot-proxy diagnostics/status gateways", async () => {
    const { api, gatewayMethods, registerProvider } = createApiMock();
    copilotProxyPlugin.register(api as any);

    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(gatewayMethods.has("copilot-proxy/status")).toBe(true);
    expect(gatewayMethods.has("copilot-proxy/validate")).toBe(true);
    expect(gatewayMethods.has("copilot-proxy/diagnostics/reset")).toBe(true);

    const statusResult = await invokeGateway(gatewayMethods, "copilot-proxy/status");
    expect(statusResult.success).toBe(true);
    expect(statusResult.payload).toMatchObject({
      providerId: "copilot-proxy",
      diagnostics: { authAttempts: 0, authSuccesses: 0, authFailures: 0 },
    });

    const resetResult = await invokeGateway(gatewayMethods, "copilot-proxy/diagnostics/reset");
    expect(resetResult.success).toBe(true);
    expect(resetResult.payload).toEqual({ reset: true });
  });

  it("registers google-antigravity diagnostics/status gateways", async () => {
    const { api, gatewayMethods, registerProvider } = createApiMock();
    googleAntigravityPlugin.register(api as any);

    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(gatewayMethods.has("google-antigravity/status")).toBe(true);
    expect(gatewayMethods.has("google-antigravity/diagnostics/reset")).toBe(true);

    const statusResult = await invokeGateway(gatewayMethods, "google-antigravity/status");
    expect(statusResult.success).toBe(true);
    expect(statusResult.payload).toMatchObject({
      providerId: "google-antigravity",
      diagnostics: { authAttempts: 0, authSuccesses: 0, authFailures: 0 },
    });

    const resetResult = await invokeGateway(
      gatewayMethods,
      "google-antigravity/diagnostics/reset",
    );
    expect(resetResult.success).toBe(true);
    expect(resetResult.payload).toEqual({ reset: true });
  });

  it("registers qwen-portal diagnostics/status gateways", async () => {
    const { api, gatewayMethods, registerProvider } = createApiMock();
    qwenPortalPlugin.register(api as any);

    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(gatewayMethods.has("qwen-portal/status")).toBe(true);
    expect(gatewayMethods.has("qwen-portal/diagnostics/reset")).toBe(true);

    const statusResult = await invokeGateway(gatewayMethods, "qwen-portal/status");
    expect(statusResult.success).toBe(true);
    expect(statusResult.payload).toMatchObject({
      providerId: "qwen-portal",
      diagnostics: { authAttempts: 0, authSuccesses: 0, authFailures: 0 },
    });

    const resetResult = await invokeGateway(gatewayMethods, "qwen-portal/diagnostics/reset");
    expect(resetResult.success).toBe(true);
    expect(resetResult.payload).toEqual({ reset: true });
  });

  it("registers memory-core diagnostics/status gateways", async () => {
    const { api, gatewayMethods, registerTool, registerCli } = createApiMock();
    memoryCorePlugin.register(api as any);

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerCli).toHaveBeenCalledTimes(1);
    expect(gatewayMethods.has("memory-core/status")).toBe(true);
    expect(gatewayMethods.has("memory-core/diagnostics/reset")).toBe(true);

    const statusResult = await invokeGateway(gatewayMethods, "memory-core/status");
    expect(statusResult.success).toBe(true);
    expect(statusResult.payload).toMatchObject({
      extension: "memory-core",
      diagnostics: { toolFactoryRuns: 0, toolFactorySuccesses: 0, toolFactoryFailures: 0 },
    });

    const resetResult = await invokeGateway(gatewayMethods, "memory-core/diagnostics/reset");
    expect(resetResult.success).toBe(true);
    expect(resetResult.payload).toEqual({ reset: true });
  });

  it("tracks copilot-proxy auth failures when provider auth run throws", async () => {
    const { api, gatewayMethods, registerProvider } = createApiMock();
    copilotProxyPlugin.register(api as any);

    const provider = getRegisteredProvider(registerProvider);
    const runAuth = provider.auth?.[0]?.run;
    if (!runAuth) throw new Error("Missing provider auth run handler");

    await expect(
      runAuth({
        prompter: {
          text: vi.fn(async () => {
            throw new Error("prompt failed");
          }),
          note: vi.fn(),
        },
      }),
    ).rejects.toThrow("prompt failed");

    const statusResult = await invokeGateway(gatewayMethods, "copilot-proxy/status");
    expect(statusResult.success).toBe(true);
    expect(statusResult.payload).toMatchObject({
      diagnostics: {
        authAttempts: 1,
        authSuccesses: 0,
        authFailures: 1,
        lastError: "prompt failed",
      },
    });

    const resetResult = await invokeGateway(gatewayMethods, "copilot-proxy/diagnostics/reset");
    expect(resetResult.success).toBe(true);

    const resetStatus = await invokeGateway(gatewayMethods, "copilot-proxy/status");
    expect(resetStatus.payload).toMatchObject({
      diagnostics: {
        authAttempts: 0,
        authSuccesses: 0,
        authFailures: 0,
        lastError: null,
      },
    });
  });

  it("returns unreachable for copilot-proxy validation when fetch fails", async () => {
    const { api, gatewayMethods } = createApiMock();
    copilotProxyPlugin.register(api as any);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await invokeGateway(gatewayMethods, "copilot-proxy/validate", {
      baseUrl: "http://127.0.0.1:65530",
    });

    expect(result.success).toBe(true);
    expect(result.payload).toMatchObject({
      reachable: false,
    });
  });

  it("tracks memory-core tool factory failures and resets diagnostics", async () => {
    const { api, gatewayMethods, registerTool } = createApiMock();
    (api.runtime.tools.createMemorySearchTool as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("memory search init failed");
    });

    memoryCorePlugin.register(api as any);
    const toolFactory = getRegisteredToolFactory(registerTool);
    const result = toolFactory({ config: {}, sessionKey: "session-1" });
    expect(result).toBeNull();

    const statusResult = await invokeGateway(gatewayMethods, "memory-core/status");
    expect(statusResult.success).toBe(true);
    expect(statusResult.payload).toMatchObject({
      diagnostics: {
        toolFactoryRuns: 1,
        toolFactorySuccesses: 0,
        toolFactoryFailures: 1,
        toolsAvailable: false,
        lastError: "memory search init failed",
      },
    });

    const resetResult = await invokeGateway(gatewayMethods, "memory-core/diagnostics/reset");
    expect(resetResult.success).toBe(true);

    const resetStatus = await invokeGateway(gatewayMethods, "memory-core/status");
    expect(resetStatus.payload).toMatchObject({
      diagnostics: {
        toolFactoryRuns: 0,
        toolFactorySuccesses: 0,
        toolFactoryFailures: 0,
        lastError: null,
      },
    });
  });
});
