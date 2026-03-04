import { emptyPluginConfigSchema } from "espada/plugin-sdk";

const DEFAULT_BASE_URL = "http://localhost:3000/v1";
const DEFAULT_API_KEY = "n/a";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MODEL_IDS = [
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5-mini",
  "claude-opus-4.5",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  "gemini-3-pro",
  "gemini-3-flash",
  "grok-code-fast-1",
] as const;

type CopilotProxyDiagnostics = {
  registeredAt: string;
  authAttempts: number;
  authSuccesses: number;
  authFailures: number;
  lastAuthAt: string | null;
  lastError: string | null;
  lastValidationAt: string | null;
  lastValidatedBaseUrl: string | null;
  lastValidationReachable: boolean | null;
  configuredModelCount: number;
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  let normalized = trimmed;
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (!normalized.endsWith("/v1")) normalized = `${normalized}/v1`;
  return normalized;
}

function validateBaseUrl(value: string): string | undefined {
  const normalized = normalizeBaseUrl(value);
  try {
    new URL(normalized);
  } catch {
    return "Enter a valid URL";
  }
  return undefined;
}

function parseModelIds(input: string): string[] {
  const parsed = input
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter(Boolean);
  return Array.from(new Set(parsed));
}

function buildModelDefinition(modelId: string) {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

async function validateProxyEndpoint(baseUrl: string): Promise<{ reachable: boolean; statusCode?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    return { reachable: response.ok, statusCode: response.status };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timeout);
  }
}

const copilotProxyPlugin = {
  id: "copilot-proxy",
  name: "Copilot Proxy",
  description: "Local Copilot Proxy (VS Code LM) provider plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    const diagnostics: CopilotProxyDiagnostics = {
      registeredAt: new Date().toISOString(),
      authAttempts: 0,
      authSuccesses: 0,
      authFailures: 0,
      lastAuthAt: null,
      lastError: null,
      lastValidationAt: null,
      lastValidatedBaseUrl: null,
      lastValidationReachable: null,
      configuredModelCount: 0,
    };

    api.registerProvider({
      id: "copilot-proxy",
      label: "Copilot Proxy",
      docsPath: "/providers/models",
      auth: [
        {
          id: "local",
          label: "Local proxy",
          hint: "Configure base URL + models for the Copilot Proxy server",
          kind: "custom",
          run: async (ctx) => {
            diagnostics.authAttempts += 1;
            diagnostics.lastAuthAt = new Date().toISOString();

            try {
              const baseUrlInput = await ctx.prompter.text({
                message: "Copilot Proxy base URL",
                initialValue: DEFAULT_BASE_URL,
                validate: validateBaseUrl,
              });

              const modelInput = await ctx.prompter.text({
                message: "Model IDs (comma-separated)",
                initialValue: DEFAULT_MODEL_IDS.join(", "),
                validate: (value) =>
                  parseModelIds(value).length > 0 ? undefined : "Enter at least one model id",
              });

              const baseUrl = normalizeBaseUrl(baseUrlInput);
              const modelIds = parseModelIds(modelInput);
              const defaultModelId = modelIds[0] ?? DEFAULT_MODEL_IDS[0];
              const defaultModelRef = `copilot-proxy/${defaultModelId}`;

              const validation = await validateProxyEndpoint(baseUrl);
              diagnostics.lastValidationAt = new Date().toISOString();
              diagnostics.lastValidatedBaseUrl = baseUrl;
              diagnostics.lastValidationReachable = validation.reachable;
              diagnostics.configuredModelCount = modelIds.length;

              if (!validation.reachable) {
                await ctx.prompter.note(
                  "Could not reach Copilot Proxy /models endpoint. Configuration was still saved; verify proxy is running and reachable.",
                  "Copilot Proxy validation",
                );
              }

              diagnostics.authSuccesses += 1;
              diagnostics.lastError = null;

              return {
                profiles: [
                  {
                    profileId: "copilot-proxy:local",
                    credential: {
                      type: "token",
                      provider: "copilot-proxy",
                      token: DEFAULT_API_KEY,
                    },
                  },
                ],
                configPatch: {
                  models: {
                    providers: {
                      "copilot-proxy": {
                        baseUrl,
                        apiKey: DEFAULT_API_KEY,
                        api: "openai-completions",
                        authHeader: false,
                        models: modelIds.map((modelId) => buildModelDefinition(modelId)),
                      },
                    },
                  },
                  agents: {
                    defaults: {
                      models: Object.fromEntries(
                        modelIds.map((modelId) => [`copilot-proxy/${modelId}`, {}]),
                      ),
                    },
                  },
                },
                defaultModel: defaultModelRef,
                notes: [
                  "Start the Copilot Proxy VS Code extension before using these models.",
                  "Copilot Proxy serves /v1/chat/completions; base URL must include /v1.",
                  "Model availability depends on your Copilot plan; edit models.providers.copilot-proxy if needed.",
                  validation.reachable
                    ? "Proxy endpoint validation succeeded."
                    : "Proxy endpoint validation failed (saved anyway for offline/local startup scenarios).",
                ],
              };
            } catch (err) {
              diagnostics.authFailures += 1;
              diagnostics.lastError = toErrorMessage(err);
              throw err;
            }
          },
        },
      ],
    });

    api.registerGatewayMethod("copilot-proxy/status", async ({ respond }) => {
      respond(true, {
        providerId: "copilot-proxy",
        diagnostics,
        defaults: {
          baseUrl: DEFAULT_BASE_URL,
          modelCount: DEFAULT_MODEL_IDS.length,
        },
      });
    });

    api.registerGatewayMethod("copilot-proxy/validate", async ({ params, respond }) => {
      try {
        const baseUrl = normalizeBaseUrl(String((params as { baseUrl?: string } | undefined)?.baseUrl ?? DEFAULT_BASE_URL));
        const validation = await validateProxyEndpoint(baseUrl);
        diagnostics.lastValidationAt = new Date().toISOString();
        diagnostics.lastValidatedBaseUrl = baseUrl;
        diagnostics.lastValidationReachable = validation.reachable;
        respond(true, { baseUrl, ...validation });
      } catch (err) {
        diagnostics.lastError = toErrorMessage(err);
        respond(false, { error: diagnostics.lastError });
      }
    });

    api.registerGatewayMethod("copilot-proxy/diagnostics/reset", async ({ respond }) => {
      diagnostics.authAttempts = 0;
      diagnostics.authSuccesses = 0;
      diagnostics.authFailures = 0;
      diagnostics.lastAuthAt = null;
      diagnostics.lastError = null;
      diagnostics.lastValidationAt = null;
      diagnostics.lastValidatedBaseUrl = null;
      diagnostics.lastValidationReachable = null;
      diagnostics.configuredModelCount = 0;
      respond(true, { reset: true });
    });
  },
};

export default copilotProxyPlugin;
