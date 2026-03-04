import { emptyPluginConfigSchema } from "espada/plugin-sdk";

import { loginQwenPortalOAuth } from "./oauth.js";

const PROVIDER_ID = "qwen-portal";
const PROVIDER_LABEL = "Qwen";
const DEFAULT_MODEL = "qwen-portal/coder-model";
const DEFAULT_BASE_URL = "https://portal.qwen.ai/v1";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 8192;
const OAUTH_PLACEHOLDER = "qwen-oauth";

type QwenPortalDiagnostics = {
  registeredAt: string;
  authAttempts: number;
  authSuccesses: number;
  authFailures: number;
  lastAuthAt: string | null;
  lastAuthSuccessAt: string | null;
  lastTokenExpiry: number | null;
  lastBaseUrl: string | null;
  lastError: string | null;
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

function normalizeBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.endsWith("/v1") ? withProtocol : `${withProtocol.replace(/\/+$/, "")}/v1`;
}

function buildModelDefinition(params: { id: string; name: string; input: Array<"text" | "image"> }) {
  return {
    id: params.id,
    name: params.name,
    reasoning: false,
    input: params.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

const qwenPortalPlugin = {
  id: "qwen-portal-auth",
  name: "Qwen OAuth",
  description: "OAuth flow for Qwen (free-tier) models",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    const diagnostics: QwenPortalDiagnostics = {
      registeredAt: new Date().toISOString(),
      authAttempts: 0,
      authSuccesses: 0,
      authFailures: 0,
      lastAuthAt: null,
      lastAuthSuccessAt: null,
      lastTokenExpiry: null,
      lastBaseUrl: null,
      lastError: null,
    };

    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/qwen",
      aliases: ["qwen"],
      auth: [
        {
          id: "device",
          label: "Qwen OAuth",
          hint: "Device code login",
          kind: "device_code",
          run: async (ctx) => {
            diagnostics.authAttempts += 1;
            diagnostics.lastAuthAt = new Date().toISOString();

            const progress = ctx.prompter.progress("Starting Qwen OAuth…");
            try {
              const result = await loginQwenPortalOAuth({
                openUrl: ctx.openUrl,
                note: ctx.prompter.note,
                progress,
              });

              progress.stop("Qwen OAuth complete");

              const profileId = `${PROVIDER_ID}:default`;
              const baseUrl = normalizeBaseUrl(result.resourceUrl);
              diagnostics.authSuccesses += 1;
              diagnostics.lastAuthSuccessAt = new Date().toISOString();
              diagnostics.lastTokenExpiry = result.expires;
              diagnostics.lastBaseUrl = baseUrl;
              diagnostics.lastError = null;

              return {
                profiles: [
                  {
                    profileId,
                    credential: {
                      type: "oauth",
                      provider: PROVIDER_ID,
                      access: result.access,
                      refresh: result.refresh,
                      expires: result.expires,
                    },
                  },
                ],
                configPatch: {
                  models: {
                    providers: {
                      [PROVIDER_ID]: {
                        baseUrl,
                        apiKey: OAUTH_PLACEHOLDER,
                        api: "openai-completions",
                        models: [
                          buildModelDefinition({
                            id: "coder-model",
                            name: "Qwen Coder",
                            input: ["text"],
                          }),
                          buildModelDefinition({
                            id: "vision-model",
                            name: "Qwen Vision",
                            input: ["text", "image"],
                          }),
                        ],
                      },
                    },
                  },
                  agents: {
                    defaults: {
                      models: {
                        "qwen-portal/coder-model": { alias: "qwen" },
                        "qwen-portal/vision-model": {},
                      },
                    },
                  },
                },
                defaultModel: DEFAULT_MODEL,
                notes: [
                  "Qwen OAuth tokens auto-refresh. Re-run login if refresh fails or access is revoked.",
                  `Base URL defaults to ${DEFAULT_BASE_URL}. Override models.providers.${PROVIDER_ID}.baseUrl if needed.`,
                ],
              };
            } catch (err) {
              diagnostics.authFailures += 1;
              diagnostics.lastError = toErrorMessage(err);
              progress.stop("Qwen OAuth failed");
              await ctx.prompter.note(
                "If OAuth fails, verify your Qwen account has portal access and try again.",
                "Qwen OAuth",
              );
              throw err;
            }
          },
        },
      ],
    });

    api.registerGatewayMethod("qwen-portal/status", async ({ respond }) => {
      respond(true, {
        providerId: PROVIDER_ID,
        diagnostics,
        defaults: {
          baseUrl: DEFAULT_BASE_URL,
          defaultModel: DEFAULT_MODEL,
        },
      });
    });

    api.registerGatewayMethod("qwen-portal/diagnostics/reset", async ({ respond }) => {
      diagnostics.authAttempts = 0;
      diagnostics.authSuccesses = 0;
      diagnostics.authFailures = 0;
      diagnostics.lastAuthAt = null;
      diagnostics.lastAuthSuccessAt = null;
      diagnostics.lastTokenExpiry = null;
      diagnostics.lastBaseUrl = null;
      diagnostics.lastError = null;
      respond(true, { reset: true });
    });
  },
};

export default qwenPortalPlugin;
