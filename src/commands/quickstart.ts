/**
 * Zero-friction quickstart command.
 *
 * `espada quickstart` auto-detects credentials from environment variables,
 * writes a minimal config, starts the gateway, and opens the dashboard —
 * all without a single prompt. Users can chat immediately in the browser
 * and configure channels/extensions later via `espada configure`.
 *
 * Friction reduction heuristics:
 * 1. Scan env vars for any configured LLM provider (Anthropic, OpenAI, etc.)
 * 2. Probe for local Ollama (fallback: no API key needed)
 * 3. Auto-select the best available model
 * 4. Configure gateway on loopback with auto-generated token
 * 5. Skip channels entirely (WebChat works out-of-the-box)
 * 6. Open the Control UI dashboard in the browser
 *
 * After first chat, guide users to progressive setup:
 *   espada configure --section channels   # add WhatsApp/Telegram/etc.
 *   espada configure --section cloud      # connect AWS/Azure/GCP
 */

import crypto from "node:crypto";

import { ensureAuthProfileStore, type AuthProfileStore } from "../agents/auth-profiles.js";
import { resolveEnvApiKey } from "../agents/model-auth.js";
import type { EspadaConfig } from "../config/config.js";
import {
  DEFAULT_GATEWAY_PORT,
  readConfigFileSnapshot,
  resolveGatewayPort,
  writeConfigFile,
} from "../config/config.js";
import { logConfigUpdated } from "../config/logging.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import {
  applyWizardMetadata,
  DEFAULT_WORKSPACE,
  ensureWorkspaceAndSessions,
  openUrlInBackground,
  openUrl,
  resolveControlUiLinks,
} from "./onboard-helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuickstartOptions = {
  /** Skip opening the dashboard in a browser. */
  skipOpen?: boolean;
  /** Explicit workspace directory (default: ~/espada). */
  workspace?: string;
  /** Explicit gateway port (default: 18789). */
  port?: number;
  /** Output JSON summary instead of human-friendly text. */
  json?: boolean;
};

type DetectedProvider = {
  id: string;
  label: string;
  envVar: string;
  apiKey: string;
  defaultModel: string;
};

// ---------------------------------------------------------------------------
// Provider auto-detection
// ---------------------------------------------------------------------------

/**
 * Ordered list of providers to probe. First match wins.
 * Order reflects model quality + popularity as a reasonable default.
 */
const PROVIDER_PROBE_ORDER: Array<{
  id: string;
  label: string;
  defaultModel: string;
}> = [
  { id: "anthropic", label: "Anthropic", defaultModel: "anthropic/claude-sonnet-4-20250514" },
  { id: "openai", label: "OpenAI", defaultModel: "openai/gpt-4.1" },
  { id: "google", label: "Google Gemini", defaultModel: "google/gemini-2.5-flash-preview-04-17" },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "openrouter/anthropic/claude-sonnet-4-20250514",
  },
  { id: "groq", label: "Groq", defaultModel: "groq/llama-3.3-70b-versatile" },
  { id: "xai", label: "xAI", defaultModel: "xai/grok-3-mini" },
  { id: "mistral", label: "Mistral", defaultModel: "mistral/mistral-large-latest" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek/deepseek-chat" },
  { id: "cerebras", label: "Cerebras", defaultModel: "cerebras/llama-3.3-70b" },
  { id: "venice", label: "Venice AI", defaultModel: "venice/llama-3.3-70b" },
  { id: "minimax", label: "MiniMax", defaultModel: "minimax/MiniMax-M1" },
  { id: "moonshot", label: "Moonshot AI", defaultModel: "moonshot/kimi-k2-0905-preview" },
];

function detectProviderFromEnv(): DetectedProvider | null {
  for (const probe of PROVIDER_PROBE_ORDER) {
    const result = resolveEnvApiKey(probe.id);
    if (result) {
      return {
        id: probe.id,
        label: probe.label,
        envVar: result.source.replace(/^(?:env|shell env): /, ""),
        apiKey: result.apiKey,
        defaultModel: probe.defaultModel,
      };
    }
  }
  return null;
}

/**
 * Check if Ollama is running locally (no API key needed).
 */
async function probeOllama(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Try to find GitHub Copilot credentials from auth profiles or env.
 */
function detectCopilotAuth(authStore: AuthProfileStore): DetectedProvider | null {
  const envToken =
    process.env.COPILOT_GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim();

  if (envToken) {
    return {
      id: "github-copilot",
      label: "GitHub Copilot",
      envVar: "GH_TOKEN",
      apiKey: envToken,
      defaultModel: "github-copilot/claude-sonnet-4",
    };
  }

  const profiles = Object.entries(authStore.profiles || {}).filter(
    ([, p]) => p?.provider === "github-copilot",
  );
  if (profiles.length > 0) {
    return {
      id: "github-copilot",
      label: "GitHub Copilot",
      envVar: "auth-profile",
      apiKey: "",
      defaultModel: "github-copilot/claude-sonnet-4",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function quickstartCommand(
  opts: QuickstartOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  const baseConfig: EspadaConfig = snapshot.valid ? snapshot.config : {};

  // If already configured, just print the dashboard URL and exit.
  if (snapshot.exists && snapshot.valid && baseConfig.gateway?.mode === "local") {
    const port = resolveGatewayPort(baseConfig);
    const links = resolveControlUiLinks({ port, bind: "loopback" });
    if (opts.json) {
      runtime.log(
        JSON.stringify({
          status: "already-configured",
          dashboardUrl: links.httpUrl,
          hint: "Run `espada onboard` to reconfigure, or `espada configure` to update settings.",
        }),
      );
    } else {
      runtime.log("Already configured.");
      runtime.log(`Dashboard: ${links.httpUrl}`);
      runtime.log("");
      runtime.log("Next steps:");
      runtime.log("  espada configure --section channels   # Connect WhatsApp, Telegram, etc.");
      runtime.log("  espada configure --section cloud       # Connect AWS, Azure, GCP");
      runtime.log("  espada onboard                         # Full reconfiguration wizard");
    }
    if (!opts.skipOpen) {
      (await openUrlInBackground(links.httpUrl)) || (await openUrl(links.httpUrl));
    }
    return;
  }

  // ---- Step 1: Auto-detect LLM provider ----
  runtime.log("Scanning for API keys...");

  const authStore = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
  const detected = detectProviderFromEnv() ?? detectCopilotAuth(authStore);

  const ollamaAvailable = !detected ? await probeOllama() : false;

  if (!detected && !ollamaAvailable) {
    runtime.error(
      [
        "No LLM provider detected.",
        "",
        "Set one of these environment variables, then re-run:",
        "  export ANTHROPIC_API_KEY=sk-ant-...      # Anthropic (recommended)",
        "  export OPENAI_API_KEY=sk-...              # OpenAI",
        "  export GEMINI_API_KEY=...                 # Google Gemini",
        "  export OPENROUTER_API_KEY=...             # OpenRouter",
        "",
        "Or run Ollama locally:  ollama serve",
        "",
        "Or use the full wizard:  espada onboard",
      ].join("\n"),
    );
    runtime.exit(1);
    return;
  }

  // ---- Step 2: Build minimal config ----
  const workspaceDir = resolveUserPath(opts.workspace ?? DEFAULT_WORKSPACE);
  const port = opts.port ?? resolveGatewayPort(baseConfig) ?? DEFAULT_GATEWAY_PORT;
  const gatewayToken = baseConfig.gateway?.auth?.token ?? crypto.randomBytes(24).toString("hex");

  const providerLabel = detected?.label ?? "Ollama (local)";
  const defaultModel = detected?.defaultModel ?? "ollama/llama3.2";

  runtime.log(`Found: ${providerLabel}`);
  runtime.log(`Model: ${defaultModel}`);
  runtime.log("");

  let nextConfig: EspadaConfig = {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
        model: {
          primary: defaultModel,
        },
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
      port,
      bind: "loopback",
      auth: {
        ...baseConfig.gateway?.auth,
        mode: "token",
        token: gatewayToken,
      },
    },
  };

  // API keys are resolved at runtime via env vars (resolveEnvApiKey),
  // so we don't need to store them in the config file.

  nextConfig = applyWizardMetadata(nextConfig, { command: "quickstart", mode: "local" });

  // ---- Step 3: Write config & bootstrap workspace ----
  await writeConfigFile(nextConfig);
  logConfigUpdated(runtime);

  await ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  // ---- Step 4: Report success ----
  const links = resolveControlUiLinks({ port, bind: "loopback" });

  if (opts.json) {
    runtime.log(
      JSON.stringify({
        status: "configured",
        provider: detected?.id ?? "ollama",
        model: defaultModel,
        dashboardUrl: links.httpUrl,
        gatewayPort: port,
      }),
    );
  } else {
    runtime.log("Ready! Start the gateway and open the dashboard:");
    runtime.log("");
    runtime.log(`  espada gateway run          # Start the gateway`);
    runtime.log(`  espada dashboard            # Open the chat UI`);
    runtime.log("");
    runtime.log(`  Dashboard: ${links.httpUrl}`);
    runtime.log("");
    runtime.log("When you're ready for more:");
    runtime.log("  espada configure --section channels   # Connect WhatsApp, Telegram, etc.");
    runtime.log("  espada configure --section cloud       # Connect AWS, Azure, GCP");
    runtime.log("  espada onboard                         # Full configuration wizard");
  }

  // ---- Step 5: Open dashboard (optional) ----
  if (!opts.skipOpen) {
    (await openUrlInBackground(links.httpUrl)) || (await openUrl(links.httpUrl));
  }
}
