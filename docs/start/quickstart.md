---
summary: "Quickstart: from zero to chatting in under 30 seconds (auto-detect credentials, no channel setup)"
read_when:
  - You want the absolute fastest path to a working Espada setup
  - You already have an API key in your environment or Ollama running locally
  - You want to skip channel configuration and chat in the browser immediately
---

# Quickstart

Goal: **zero to first chat in under 30 seconds** — no channel setup, no wizard, no prompts.

`espada quickstart` auto-detects your LLM credentials, writes a minimal config, and opens a browser dashboard where you can chat immediately.

## Prerequisites

- **Node ≥22** installed ([install guide](/install))
- **One of these** available:
  - An LLM API key in your environment (see [Supported providers](#supported-providers))
  - [Ollama](https://ollama.ai) running locally (no API key needed)

## Run it

```bash
# Install Espada (if not already installed)
curl -fsSL https://molt.bot/install.sh | bash

# Auto-detect credentials and open the dashboard
espada quickstart
```

That's it. The dashboard opens at `http://127.0.0.1:18789/` and you can start chatting.

### What `espada quickstart` does

1. **Scans environment variables** for any configured LLM provider API key
2. **Probes for local Ollama** if no API key is found (fallback — no key needed)
3. **Auto-selects the best available model** based on provider priority
4. **Generates a gateway token** and writes a minimal config to `~/.espada/espada.json`
5. **Bootstraps the workspace** at `~/espada` (skills, prompts, memories)
6. **Opens the Control UI dashboard** in your browser — chat immediately via WebChat

No channel setup is required. WebChat works out of the box through the dashboard.

## Supported providers

`espada quickstart` checks for these environment variables in order. The first match wins:

| Provider | Environment Variable | Default Model |
|----------|---------------------|---------------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash-preview-04-17` |
| OpenRouter | `OPENROUTER_API_KEY` | `claude-sonnet-4-20250514` |
| Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| xAI | `XAI_API_KEY` | `grok-3-mini` |
| Mistral | `MISTRAL_API_KEY` | `mistral-large-latest` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| Cerebras | `CEREBRAS_API_KEY` | `llama-3.3-70b` |
| Venice AI | `VENICE_API_KEY` | `llama-3.3-70b` |
| MiniMax | `MINIMAX_API_KEY` | `MiniMax-M1` |
| Moonshot AI | `MOONSHOT_API_KEY` | `kimi-k2-0905-preview` |
| GitHub Copilot | `GH_TOKEN` / `GITHUB_TOKEN` | `claude-sonnet-4` |
| Ollama (local) | *(none — auto-detected)* | `llama3.2` |

### Example

```bash
# Set your preferred provider
export ANTHROPIC_API_KEY=sk-ant-...

# Run quickstart
espada quickstart
```

## Options

```bash
espada quickstart [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--workspace <dir>` | Agent workspace directory | `~/espada` |
| `--port <port>` | Gateway port | `18789` |
| `--skip-open` | Don't open the dashboard in the browser | `false` |
| `--json` | Output JSON summary instead of human-friendly text | `false` |

## After quickstart

Once you're chatting, extend your setup progressively:

```bash
# Connect messaging channels (WhatsApp, Telegram, Discord, etc.)
espada configure --section channels

# Connect cloud providers for infrastructure management
espada configure --section cloud

# Add web search capabilities
espada configure --section web

# Full configuration wizard
espada onboard
```

### Verify your setup

```bash
espada status          # Gateway + channel overview
espada health          # Health snapshot from the running gateway
espada doctor          # Check for misconfigurations
```

### Start managing infrastructure

Once connected to a cloud provider, you can manage infrastructure through natural language:

```bash
# From the CLI
espada agent --message "List my EC2 instances in us-east-1" --thinking high

# Or just type in the dashboard / any connected messaging channel:
# "Show me all S3 buckets with public access"
# "Deploy a new Lambda function from ./handler.js"
# "What's my current AWS spending this month?"
```

## Quickstart vs Onboard

| | `espada quickstart` | `espada onboard` |
|---|---|---|
| **Speed** | ~5 seconds, zero prompts | Interactive wizard, ~2 minutes |
| **Channel setup** | Skipped (WebChat only) | WhatsApp, Telegram, Discord, etc. |
| **Cloud providers** | Skipped | AWS, Azure, GCP configuration |
| **Daemon install** | Skipped | Optional background service |
| **Auth method** | Auto-detect from env vars | OAuth, API keys, CLI credentials |
| **Best for** | Quick evaluation, dev/test | Production setup |

## Troubleshooting

### "No LLM provider detected"

Set at least one provider API key in your environment:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or start Ollama:
ollama serve
```

Then re-run `espada quickstart`.

### Already configured

If you've already run quickstart or onboard, the command will detect the existing config and just open the dashboard. To reconfigure:

```bash
espada configure      # Update specific settings
espada onboard        # Full reconfiguration wizard
```

### Port already in use

The gateway defaults to port `18789`. If it's taken:

```bash
espada quickstart --port 18800
```

## Next steps

- [Getting Started](/start/getting-started) — Full step-by-step setup guide
- [Configuration](/gateway/configuration) — Detailed config reference
- [Channels](/channels) — Connect messaging platforms
- [Tools](/tools) — Available agent tools
- [Security](/security) — Security hardening
