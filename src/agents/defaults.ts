// Defaults for agent metadata when upstream does not supply them.
// Model id uses copilot-proxy as the default (VS Code LM API via Copilot Proxy extension).
export const DEFAULT_PROVIDER = "copilot-proxy";
export const DEFAULT_MODEL = "gpt-5.2";
// Context window: VS Code LM API models support ~128k tokens.
export const DEFAULT_CONTEXT_TOKENS = 128_000;
