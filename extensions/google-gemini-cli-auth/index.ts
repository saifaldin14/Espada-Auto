import { emptyPluginConfigSchema } from "espada/plugin-sdk";

import { loginGeminiCliOAuth } from "./oauth.js";

const PROVIDER_ID = "google-gemini-cli";
const PROVIDER_LABEL = "Gemini CLI OAuth";
const DEFAULT_MODEL = "google-gemini-cli/gemini-3-pro-preview";
const ENV_VARS = [
  "ESPADA_GEMINI_OAUTH_CLIENT_ID",
  "ESPADA_GEMINI_OAUTH_CLIENT_SECRET",
  "GEMINI_CLI_OAUTH_CLIENT_ID",
  "GEMINI_CLI_OAUTH_CLIENT_SECRET",
];

type GeminiCliAuthDiagnostics = {
  registeredAt: string;
  authAttempts: number;
  authSuccesses: number;
  authFailures: number;
  lastAuthAt: string | null;
  lastAuthSuccessAt: string | null;
  lastAuthenticatedEmail: string | null;
  lastProjectId: string | null;
  lastError: string | null;
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

const geminiCliPlugin = {
  id: "google-gemini-cli-auth",
  name: "Google Gemini CLI Auth",
  description: "OAuth flow for Gemini CLI (Google Code Assist)",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    const diagnostics: GeminiCliAuthDiagnostics = {
      registeredAt: new Date().toISOString(),
      authAttempts: 0,
      authSuccesses: 0,
      authFailures: 0,
      lastAuthAt: null,
      lastAuthSuccessAt: null,
      lastAuthenticatedEmail: null,
      lastProjectId: null,
      lastError: null,
    };

    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/models",
      aliases: ["gemini-cli"],
      envVars: ENV_VARS,
      auth: [
        {
          id: "oauth",
          label: "Google OAuth",
          hint: "PKCE + localhost callback",
          kind: "oauth",
          run: async (ctx) => {
            diagnostics.authAttempts += 1;
            diagnostics.lastAuthAt = new Date().toISOString();

            const spin = ctx.prompter.progress("Starting Gemini CLI OAuth…");
            try {
              const result = await loginGeminiCliOAuth({
                isRemote: ctx.isRemote,
                openUrl: ctx.openUrl,
                log: (msg) => ctx.runtime.log(msg),
                note: ctx.prompter.note,
                prompt: async (message) => String(await ctx.prompter.text({ message })),
                progress: spin,
              });

              spin.stop("Gemini CLI OAuth complete");
              diagnostics.authSuccesses += 1;
              diagnostics.lastAuthSuccessAt = new Date().toISOString();
              diagnostics.lastAuthenticatedEmail = result.email ?? null;
              diagnostics.lastProjectId = result.projectId;
              diagnostics.lastError = null;

              const profileId = `google-gemini-cli:${result.email ?? "default"}`;
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
                      email: result.email,
                      projectId: result.projectId,
                    },
                  },
                ],
                configPatch: {
                  agents: {
                    defaults: {
                      models: {
                        [DEFAULT_MODEL]: {},
                      },
                    },
                  },
                },
                defaultModel: DEFAULT_MODEL,
                notes: [
                  "If requests fail, set GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID.",
                ],
              };
            } catch (err) {
              diagnostics.authFailures += 1;
              diagnostics.lastError = toErrorMessage(err);
              spin.stop("Gemini CLI OAuth failed");
              await ctx.prompter.note(
                "Trouble with OAuth? Ensure your Google account has Gemini CLI access.",
                "OAuth help",
              );
              throw err;
            }
          },
        },
      ],
    });

    api.registerGatewayMethod("google-gemini-cli/status", async ({ respond }) => {
      respond(true, {
        providerId: PROVIDER_ID,
        diagnostics,
        defaults: {
          defaultModel: DEFAULT_MODEL,
          envVars: ENV_VARS,
        },
      });
    });

    api.registerGatewayMethod("google-gemini-cli/diagnostics/reset", async ({ respond }) => {
      diagnostics.authAttempts = 0;
      diagnostics.authSuccesses = 0;
      diagnostics.authFailures = 0;
      diagnostics.lastAuthAt = null;
      diagnostics.lastAuthSuccessAt = null;
      diagnostics.lastAuthenticatedEmail = null;
      diagnostics.lastProjectId = null;
      diagnostics.lastError = null;
      respond(true, { reset: true });
    });
  },
};

export default geminiCliPlugin;
