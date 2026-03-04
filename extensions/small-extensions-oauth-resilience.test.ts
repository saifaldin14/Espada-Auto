import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApiMock,
  createAuthContext,
  getRegisteredProvider,
  invokeGateway,
} from "./test-utils/small-extension-contract-helpers.js";

describe("small extension oauth resilience contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unmock("./google-gemini-cli-auth/oauth.js");
    vi.unmock("./qwen-portal-auth/oauth.js");
  });

  it("tracks google-antigravity auth failures and reset behavior", async () => {
    const pluginModule = await import("./google-antigravity-auth/index.js");
    const plugin = pluginModule.default;
    const { api, gatewayMethods, registerProvider } = createApiMock();
    plugin.register(api as any);

    const provider = getRegisteredProvider(registerProvider);
    const runAuth = provider.auth?.[0]?.run;
    if (!runAuth) throw new Error("Missing provider auth run handler");

    const ctx = createAuthContext();
    ctx.isRemote = true;
    (ctx.prompter.text as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("prompt failed"));

    await expect(runAuth(ctx)).rejects.toThrow("prompt failed");

    const status = await invokeGateway(gatewayMethods, "google-antigravity/status");
    expect(status.success).toBe(true);
    expect(status.payload).toMatchObject({
      diagnostics: {
        authAttempts: 1,
        authSuccesses: 0,
        authFailures: 1,
        lastError: "prompt failed",
      },
    });

    const reset = await invokeGateway(gatewayMethods, "google-antigravity/diagnostics/reset");
    expect(reset.success).toBe(true);

    const statusAfterReset = await invokeGateway(gatewayMethods, "google-antigravity/status");
    expect(statusAfterReset.payload).toMatchObject({
      diagnostics: {
        authAttempts: 0,
        authSuccesses: 0,
        authFailures: 0,
        lastError: null,
      },
    });
  });

  it("tracks qwen-portal auth failures and reset behavior", async () => {
    vi.doMock("./qwen-portal-auth/oauth.js", () => ({
      loginQwenPortalOAuth: vi.fn(async () => {
        throw new Error("qwen oauth failed");
      }),
    }));

    const pluginModule = await import("./qwen-portal-auth/index.js");
    const plugin = pluginModule.default;
    const { api, gatewayMethods, registerProvider } = createApiMock();
    plugin.register(api as any);

    const provider = getRegisteredProvider(registerProvider);
    const runAuth = provider.auth?.[0]?.run;
    if (!runAuth) throw new Error("Missing provider auth run handler");

    await expect(runAuth(createAuthContext())).rejects.toThrow("qwen oauth failed");

    const status = await invokeGateway(gatewayMethods, "qwen-portal/status");
    expect(status.success).toBe(true);
    expect(status.payload).toMatchObject({
      diagnostics: {
        authAttempts: 1,
        authSuccesses: 0,
        authFailures: 1,
        lastError: "qwen oauth failed",
      },
    });

    const reset = await invokeGateway(gatewayMethods, "qwen-portal/diagnostics/reset");
    expect(reset.success).toBe(true);

    const statusAfterReset = await invokeGateway(gatewayMethods, "qwen-portal/status");
    expect(statusAfterReset.payload).toMatchObject({
      diagnostics: {
        authAttempts: 0,
        authSuccesses: 0,
        authFailures: 0,
        lastError: null,
      },
    });
  });

  it("tracks google-antigravity auth success metadata and diagnostics", async () => {
    const pluginModule = await import("./google-antigravity-auth/index.js");
    const plugin = pluginModule.default;
    const { api, gatewayMethods, registerProvider } = createApiMock();
    plugin.register(api as any);

    const provider = getRegisteredProvider(registerProvider);
    const runAuth = provider.auth?.[0]?.run;
    if (!runAuth) throw new Error("Missing provider auth run handler");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
        } as Response;
      }

      if (url.includes("googleapis.com/oauth2/v1/userinfo")) {
        return {
          ok: true,
          json: async () => ({ email: "user@example.com" }),
        } as Response;
      }

      if (url.includes("v1internal:loadCodeAssist")) {
        return {
          ok: true,
          json: async () => ({ cloudaicompanionProject: "test-project" }),
        } as Response;
      }

      return {
        ok: false,
        text: async () => "unexpected",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    let authUrl = "";
    const ctx = createAuthContext();
    ctx.isRemote = true;
    (ctx.prompter.note as ReturnType<typeof vi.fn>).mockImplementation(async (message: string) => {
      const match = message.match(/Auth URL:\s*(\S+)/);
      authUrl = match?.[1] ?? "";
    });
    (ctx.prompter.text as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const state = new URL(authUrl).searchParams.get("state") ?? "";
      return `http://localhost:51121/oauth-callback?code=sample-code&state=${state}`;
    });

    const result = await runAuth(ctx);
    expect(result).toMatchObject({
      defaultModel: "google-antigravity/claude-opus-4-5-thinking",
      profiles: [
        {
          profileId: "google-antigravity:user@example.com",
          credential: {
            provider: "google-antigravity",
            email: "user@example.com",
            projectId: "test-project",
          },
        },
      ],
    });

    const status = await invokeGateway(gatewayMethods, "google-antigravity/status");
    expect(status.success).toBe(true);
    expect(status.payload).toMatchObject({
      diagnostics: {
        authAttempts: 1,
        authSuccesses: 1,
        authFailures: 0,
        lastAuthenticatedEmail: "user@example.com",
        lastProjectId: "test-project",
        lastError: null,
      },
    });
  });

  it("tracks qwen-portal auth success metadata and diagnostics", async () => {
    vi.doMock("./qwen-portal-auth/oauth.js", () => ({
      loginQwenPortalOAuth: vi.fn(async () => ({
        access: "access-token",
        refresh: "refresh-token",
        expires: 1730000000000,
        resourceUrl: "https://portal.qwen.ai/v1",
      })),
    }));

    const pluginModule = await import("./qwen-portal-auth/index.js");
    const plugin = pluginModule.default;
    const { api, gatewayMethods, registerProvider } = createApiMock();
    plugin.register(api as any);

    const provider = getRegisteredProvider(registerProvider);
    const runAuth = provider.auth?.[0]?.run;
    if (!runAuth) throw new Error("Missing provider auth run handler");

    const result = await runAuth(createAuthContext());
    expect(result).toMatchObject({
      defaultModel: "qwen-portal/coder-model",
      profiles: [
        {
          profileId: "qwen-portal:default",
          credential: {
            provider: "qwen-portal",
            access: "access-token",
            refresh: "refresh-token",
          },
        },
      ],
    });

    const status = await invokeGateway(gatewayMethods, "qwen-portal/status");
    expect(status.success).toBe(true);
    expect(status.payload).toMatchObject({
      diagnostics: {
        authAttempts: 1,
        authSuccesses: 1,
        authFailures: 0,
        lastBaseUrl: "https://portal.qwen.ai/v1",
        lastTokenExpiry: 1730000000000,
        lastError: null,
      },
    });
  });

  it("tracks google-gemini-cli auth failures and reset behavior", async () => {
    vi.doMock("./google-gemini-cli-auth/oauth.js", () => ({
      loginGeminiCliOAuth: vi.fn(async () => {
        throw new Error("gemini oauth failed");
      }),
    }));

    const pluginModule = await import("./google-gemini-cli-auth/index.js");
    const plugin = pluginModule.default;
    const { api, gatewayMethods, registerProvider } = createApiMock();
    plugin.register(api as any);

    const provider = getRegisteredProvider(registerProvider);
    const runAuth = provider.auth?.[0]?.run;
    if (!runAuth) throw new Error("Missing provider auth run handler");

    await expect(runAuth(createAuthContext())).rejects.toThrow("gemini oauth failed");

    const status = await invokeGateway(gatewayMethods, "google-gemini-cli/status");
    expect(status.success).toBe(true);
    expect(status.payload).toMatchObject({
      providerId: "google-gemini-cli",
      diagnostics: {
        authAttempts: 1,
        authSuccesses: 0,
        authFailures: 1,
        lastError: "gemini oauth failed",
      },
    });

    const reset = await invokeGateway(gatewayMethods, "google-gemini-cli/diagnostics/reset");
    expect(reset.success).toBe(true);

    const statusAfterReset = await invokeGateway(gatewayMethods, "google-gemini-cli/status");
    expect(statusAfterReset.payload).toMatchObject({
      diagnostics: {
        authAttempts: 0,
        authSuccesses: 0,
        authFailures: 0,
        lastError: null,
      },
    });
  });

  it("tracks google-gemini-cli auth success metadata and diagnostics", async () => {
    vi.doMock("./google-gemini-cli-auth/oauth.js", () => ({
      loginGeminiCliOAuth: vi.fn(async () => ({
        access: "gemini-access-token",
        refresh: "gemini-refresh-token",
        expires: 1731000000000,
        email: "gemini@example.com",
        projectId: "gemini-project",
      })),
    }));

    const pluginModule = await import("./google-gemini-cli-auth/index.js");
    const plugin = pluginModule.default;
    const { api, gatewayMethods, registerProvider } = createApiMock();
    plugin.register(api as any);

    const provider = getRegisteredProvider(registerProvider);
    const runAuth = provider.auth?.[0]?.run;
    if (!runAuth) throw new Error("Missing provider auth run handler");

    const result = await runAuth(createAuthContext());
    expect(result).toMatchObject({
      defaultModel: "google-gemini-cli/gemini-3-pro-preview",
      profiles: [
        {
          profileId: "google-gemini-cli:gemini@example.com",
          credential: {
            provider: "google-gemini-cli",
            access: "gemini-access-token",
            refresh: "gemini-refresh-token",
            email: "gemini@example.com",
            projectId: "gemini-project",
          },
        },
      ],
    });

    const status = await invokeGateway(gatewayMethods, "google-gemini-cli/status");
    expect(status.success).toBe(true);
    expect(status.payload).toMatchObject({
      providerId: "google-gemini-cli",
      diagnostics: {
        authAttempts: 1,
        authSuccesses: 1,
        authFailures: 0,
        lastAuthenticatedEmail: "gemini@example.com",
        lastProjectId: "gemini-project",
        lastError: null,
      },
      defaults: {
        defaultModel: "google-gemini-cli/gemini-3-pro-preview",
      },
    });
  });
});
