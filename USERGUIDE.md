# Espada User Guide

**Version 1.0 | March 2026**

**Espada — Software Infrastructure Automation Platform**

---

# Table of Contents

1. Introduction
2. System Requirements
3. Installation
4. Quick Start
5. Architecture Overview
6. Configuration
7. Messaging Channels
8. LLM Providers
9. Core Concepts
10. Agent Workspace
11. Chat Commands
12. Tools Reference
13. Cloud Infrastructure Management
14. Infrastructure Knowledge Graph
15. Policy Engine and Compliance
16. Multi-Agent System
17. Workflow Pipelines (Lobster)
18. Voice Calls
19. Memory System
20. Browser Automation
21. Text-to-Speech
22. Automation (Cron, Webhooks, Hooks)
23. Session Management
24. Skills and EspadaHub
25. Security
26. Companion Apps and Nodes
27. Web Dashboard
28. Diagnostics and Logging
29. Deployment Platforms
30. CLI Reference
31. Troubleshooting
32. Glossary

---

# 1. Introduction

## What is Espada?

Espada is a self-hosted, local-first software infrastructure automation platform powered by conversational AI. It allows you to manage cloud infrastructure, containers, deployments, compliance, and operations through natural language commands sent via 16+ messaging channels, a built-in web dashboard, a CLI, a REST API, or companion apps on macOS, iOS, and Android.

Espada acts as a single always-on Gateway process that connects to your messaging channels and lets you manage your entire software infrastructure through conversation. Whether you want to deploy to AWS, orchestrate Kubernetes clusters, enforce compliance policies, make phone calls, run deterministic workflows, or manage multi-agent teams, you can do it all from your favorite messaging app.

## Key Capabilities

- **Cloud Infrastructure Management** — Full control of AWS, Azure, and GCP resources through natural language
- **Container Orchestration** — Deploy and manage Docker containers and Kubernetes clusters
- **Infrastructure as Code** — Execute Terraform plans, Pulumi stacks, and CloudFormation templates
- **Infrastructure Knowledge Graph** — Unified multi-cloud topology with a custom query language and 31 AI tools
- **Policy Engine and Compliance** — Six compliance frameworks with auto-remediation, OPA-style policies
- **Multi-Agent Orchestration** — Isolated agents with deterministic routing, broadcast groups, and sub-agents
- **Workflow Pipelines** — Deterministic multi-step tool sequences with approval gates
- **Voice Calls** — Real telephony via Telnyx, Twilio, and Plivo
- **Memory System** — Persistent plain-Markdown memory with vector search
- **Browser Automation** — Isolated Chrome/Brave/Edge profiles under agent control
- **Text-to-Speech** — Three providers including a free option requiring no API key
- **Automation** — Cron scheduler, webhooks, event-driven hooks, and Gmail Pub/Sub integration
- **16+ Messaging Channels** — WhatsApp, Telegram, Slack, Discord, Signal, iMessage, and more
- **14+ LLM Providers** — Anthropic, OpenAI, Google Gemini, Ollama (local), and more with automatic failover

## Who is This Guide For?

This guide is intended for:

- **DevOps engineers** who want to manage infrastructure through conversation
- **Platform engineers** building internal developer platforms
- **SREs** who want automated incident response and compliance monitoring
- **Engineering managers** who want visibility into infrastructure operations
- **Developers** who want a personal AI assistant that can execute real operations

---

# 2. System Requirements

## Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| Operating System | macOS, Linux, or Windows (via WSL2) |
| Node.js | Version 22 or later |
| Memory | 512 MB minimum; 2 GB recommended |
| Disk Space | 200 MB for installation; additional for workspaces and logs |
| Network | Internet access for LLM providers (or local Ollama) |

## Optional Components

| Component | Purpose |
|-----------|---------|
| Docker | Required for sandboxed tool execution |
| Ollama | Local LLM inference without an API key |
| Terraform CLI | Required for Terraform extension operations |
| kubectl | Required for Kubernetes extension operations |
| AWS CLI | Required for AWS extension operations |
| Azure CLI | Required for Azure extension operations |
| Google Cloud CLI | Required for GCP extension operations |
| Chrome/Brave/Edge | Required for browser automation features |
| signal-cli | Required for Signal messaging channel |
| Tailscale | Optional for secure remote access |

---

# 3. Installation

## Option 1: Quick Installer (Recommended)

The quickest way to install Espada:

```
curl -fsSL https://espada.dev/install | bash
```

This installer handles Node.js detection, PATH configuration, and permission issues automatically.

## Option 2: npm Global Install

```
npm i -g espada@latest
```

## Option 3: From Source

```
git clone https://github.com/saifaldin14/Espada-Auto.git
cd Espada-Auto
pnpm install
pnpm ui:build
pnpm build
```

When running from source, use `pnpm espada ...` instead of `espada ...` for CLI commands.

## Option 4: Docker

Use the provided Docker Compose configuration:

```
docker compose up -d
```

Persist your home directory with the `ESPADA_HOME_VOLUME` environment variable.

## Option 5: Nix

A Home Manager module is available. Set `ESPADA_NIX_MODE=1` to disable auto-install flows.

## Post-Installation

After installing, run the onboarding wizard:

```
espada onboard --install-daemon
```

This walks you through model/auth setup, workspace configuration, gateway settings, channel connections, and service installation.

To verify your installation:

```
espada doctor
```

This command checks for misconfigurations, performs config normalization, migrates legacy keys, and verifies state integrity.

## Updating

```
espada update
```

Update channels available: `stable` (latest), `beta`, `dev` (main branch). Switch channels with:

```
espada update --channel beta
```

Always run `espada doctor` after updating.

## Uninstalling

```
espada uninstall
```

This removes the installation and cleans up system services (launchd on macOS, systemd on Linux).

---

# 4. Quick Start

## 30-Second Setup

If you already have an API key in your environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`), or Ollama running locally:

```
espada quickstart
```

This auto-detects your LLM credentials, generates a gateway token, and opens a browser dashboard at `http://127.0.0.1:18789/` — you can start chatting in under 30 seconds with no channel setup needed.

## Connecting a Messaging Channel

When you are ready to extend beyond the web dashboard:

```
# Connect messaging channels (WhatsApp, Telegram, Discord, etc.)
espada configure --section channels

# Connect cloud providers (AWS, Azure, GCP)
espada configure --section cloud

# Full configuration wizard
espada onboard
```

## Verifying Your Setup

```
espada status          # Gateway + channel overview
espada health          # Health snapshot from the running gateway
espada doctor          # Check for misconfigurations
```

## Sending Your First Message

```
# WhatsApp (QR code login)
espada channels login

# Send a test message
espada message send --to +1234567890 --message "Hello from Espada"

# Talk to the agent from the CLI
espada agent --message "List my EC2 instances in us-east-1" --thinking high
```

## Using the TUI (Terminal UI)

```
espada tui
```

This opens a full terminal chat client connected to the Gateway with agent/session/model pickers and keyboard shortcuts.

---

# 5. Architecture Overview

## The Gateway

Espada's core is a **single long-lived Gateway process**. The Gateway is the control plane — a multiplexed WebSocket and HTTP server (default address `127.0.0.1:18789`) that handles sessions, channels, tools, routing, and events. One or more AI agents process your requests and execute operations.

The Gateway exposes:

- **WebSocket Control Plane** — Typed JSON protocol for clients, nodes, and automations
- **OpenAI-Compatible HTTP API** — `/v1/chat/completions` and `/v1/responses` endpoints for programmatic access
- **Tool Invocation API** — `/tools/invoke` for programmatic tool calls
- **Canvas Host** — Agent-editable HTML and A2UI surfaces (default port `18793`)
- **Hot Config Reload** — Safe changes applied live; critical changes via in-process restart

## How It Works

1. **You send a message** through any connected channel (WhatsApp, Slack, CLI, web dashboard, etc.)
2. **The Gateway routes** the message to the correct agent based on deterministic bindings
3. **The agent processes** your request using the configured LLM provider
4. **Tools are executed** (cloud operations, file operations, shell commands, etc.)
5. **The response is delivered** back through the same channel

## Extension System

Espada uses a plugin architecture. Extensions live under the `extensions/` directory as workspace packages. Each extension can register:

- **Agent Tools** — New capabilities the AI agent can use
- **Gateway RPC Methods** — Custom WebSocket endpoints
- **Gateway HTTP Handlers** — Custom REST endpoints
- **Channel Handlers** — New messaging channel integrations
- **CLI Commands** — Additional CLI subcommands
- **Background Services** — Long-running processes within the Gateway
- **Skills** — Skill directories in the plugin manifest

Plugins run in-process with the Gateway as TypeScript modules loaded at runtime.

---

# 6. Configuration

## Configuration File

Espada's configuration lives at `~/.espada/espada.json`. The file uses JSON5 format (comments and trailing commas are allowed).

### Minimal Configuration

```json
{
  "agent": {
    "model": "anthropic/claude-opus-4-5"
  }
}
```

### Interactive Configuration

```
espada configure                     # Full interactive config
espada configure --section cloud     # Cloud providers only
espada configure --section channels  # Messaging channels only
espada configure --section web       # Web search (Brave API key)
```

## Key Configuration Sections

### Agent Configuration

```json
{
  "agent": {
    "model": "anthropic/claude-sonnet-4-20250514",
    "workspace": "~/espada",
    "dmScope": "main"
  }
}
```

- **model** — The default LLM model in `provider/model` format
- **workspace** — The agent's working directory (default: `~/espada`)
- **dmScope** — Session scoping: `main` (all DMs converge), `per-peer`, or `per-channel-peer`

### Model Failover

```json
{
  "agents": {
    "defaults": {
      "model": {
        "fallbacks": [
          "anthropic/claude-sonnet-4-20250514",
          "openai/gpt-4.1",
          "google/gemini-2.5-flash-preview-04-17"
        ]
      }
    }
  }
}
```

Failover uses two stages: auth profile rotation within a provider (exponential backoff cooldowns, round-robin with OAuth-before-API-key priority), then model fallback to the next entry in the fallbacks list. Profiles are pinned per session for cache efficiency.

### Channel Configuration

Each channel has its own configuration section. See Chapter 7 for details on each channel.

### Environment Variables

Environment variable precedence:

1. Process environment
2. `.env` file in the current working directory
3. Global `.env` file
4. Config `env` block in `espada.json`
5. Shell environment import

You can use `${VAR_NAME}` substitution in configuration values.

## Hot Reload

Configuration changes are applied live when possible. Critical changes (such as model or channel changes) trigger an in-process restart via `SIGUSR1`.

---

# 7. Messaging Channels

Espada supports 16+ messaging channels as equal-class interaction surfaces. You can connect multiple channels simultaneously and route messages to different agents.

## Core Channels

### WhatsApp

WhatsApp is connected via the Baileys library using QR code pairing.

**Setup:**

```
espada channels login
```

Scan the QR code with WhatsApp on your phone. A dedicated phone number is recommended.

**Key Settings:**

- `dmPolicy` — `pairing` (default, requires approval), `allowlist`, or `open`
- Supports read receipts, group chats, and multi-account configurations
- Self-chat mode available for personal use

### Telegram

Telegram connects via the grammY library using the Bot API.

**Setup:**

1. Create a bot with BotFather on Telegram
2. Copy the bot token
3. Add the token to your configuration

**Key Features:**

- Long-polling by default; webhook mode optional
- Draft streaming — the only channel with real-time partial text updates in a draft bubble
- Custom bot commands, group activation modes, and message history context

### Discord

Discord connects via the discord.js library and Discord Gateway.

**Setup:**

1. Create a Discord application at discord.com/developers
2. Enable the **Message Content Intent**
3. Add the bot token to your configuration
4. Invite the bot to your server

**Key Features:**

- DM pairing, guild rules, and multi-account support
- Reactions and native slash commands
- Tall replies automatically split at configurable line limits (default: 17 lines)

### Slack

Slack connects via the Bolt SDK.

**Setup:**

1. Create a Slack app using the provided manifest
2. Install to your workspace
3. Configure App Token and Bot Token

**Key Features:**

- Socket mode (default) or HTTP mode
- Slash commands and message history context
- Optional User Token for expanded capabilities

### Signal

Signal connects via signal-cli using JSON-RPC and SSE.

**Setup:**

1. Install signal-cli
2. Register or link a phone number
3. Configure the connection in Espada

**Key Features:**

- DM pairing required for security
- Typing indicators and read receipts
- External daemon mode supported

### iMessage (macOS Only)

iMessage connects via the imsg library and is available only on macOS.

### WebChat

The built-in WebChat is available at the Gateway's HTTP address (`http://127.0.0.1:18789/`). No additional setup is required.

## Extension Channels

The following channels are available through extensions:

| Channel | Description |
|---------|-------------|
| Microsoft Teams | Via Bot Framework |
| Matrix | Via matrix-js-sdk |
| Google Chat | Via Chat API |
| BlueBubbles | Via BlueBubbles API |
| LINE | Via LINE Messaging API |
| Mattermost | Via Mattermost API |
| Nostr | Via Nostr Protocol |
| Twitch | Via Twitch IRC |
| Zalo | Via Zalo OA API |
| Nextcloud Talk | Via Nextcloud API |
| Tlon | Via Tlon Protocol |

## Group Chat Behavior

Groups behave consistently across all channels:

- `groupPolicy` — `open`, `disabled`, or `allowlist`
- Mention gating is enabled by default (replying to the bot counts as an implicit mention)
- Sessions are isolated per group
- Heartbeats are skipped for group sessions
- Per-group `requireMention` overrides are available

## DM Pairing

By default, unknown senders receive an 8-character pairing code. Codes expire after 1 hour with a maximum of 3 pending codes.

To approve a sender:

```
espada pairing approve <channel> <code>
```

---

# 8. LLM Providers

Espada supports 14+ LLM providers with automatic failover, auth profile rotation, and session-pinned credentials.

## Supported Providers

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

## Anthropic

Set the `ANTHROPIC_API_KEY` environment variable, or use Anthropic's setup-token auth:

```
claude setup-token
```

Supports prompt caching configuration for improved performance and reduced costs.

## OpenAI

Set the `OPENAI_API_KEY` environment variable, or use Codex subscription OAuth (PKCE flow).

## Ollama (Local Models)

Ollama provides local LLM inference with no API key required. Espada auto-discovers tool-capable Ollama models.

```
# Start Ollama (if not already running)
ollama serve

# Espada will auto-detect available models
espada models scan
```

## OpenRouter

OpenRouter provides a unified API for accessing many models through a single API key:

```
# Model format: openrouter/<provider>/<model>
espada agent --model openrouter/anthropic/claude-sonnet-4
```

## GitHub Copilot

```
espada models auth login-github-copilot
```

Supports both built-in provider mode and Copilot Proxy VS Code extension mode.

## Venice AI

Privacy-focused inference with two modes:

- **Private** — Fully ephemeral, no data retention
- **Anonymized** — Proxied to Claude/GPT/Gemini

## Failover Behavior

When an LLM request fails, Espada follows this failover sequence:

1. **Auth profile rotation** within the current provider (exponential backoff: 1 min → 5 min → 25 min → 1 hr cap)
2. **Model fallback** to the next entry in the configured fallback list

Profiles are pinned per session to maximize cache efficiency. Billing disables trigger longer backoff periods (5 hr → 24 hr).

## Custom Providers

You can add custom OpenAI-compatible endpoints in the `models.providers` configuration section.

---

# 9. Core Concepts

## Sessions

A session represents an ongoing conversation between you and an agent. Sessions are stored as JSONL transcripts.

**Session Scoping:**

- `main` — All DMs from all channels converge into a single session
- `per-peer` — Each sender gets their own session
- `per-channel-peer` — Each sender on each channel gets their own session

**Session Lifecycle:**

- Sessions can be reset with `/new` or `/reset`
- Automatic reset policies: daily at 4:00 AM plus optional idle reset
- Group sessions are identified as `agent:<agentId>:<channel>:group:<id>`

## The Agent Loop

When a message arrives, the agent loop processes it through these stages:

1. **Prompt Assembly** — System prompt, workspace files, skills, and context are combined
2. **Hook Points** — Internal and plugin hooks can intercept at various stages
3. **Streaming** — The LLM response is streamed back with block-aware chunking
4. **Tool Execution** — Any tool calls requested by the LLM are executed
5. **Compaction and Retries** — Context management and error recovery

The default agent loop timeout is 600 seconds.

## Context and Compaction

Espada automatically manages context window limits:

- **Auto-Compaction** — When the context window approaches its limit, older conversation history is automatically summarized
- **Pre-Compaction Memory Flush** — Before compaction, a silent agentic turn writes durable notes to memory
- **Manual Compaction** — Use `/compact` to trigger compaction manually, optionally with focus instructions

## Message Queue

Messages flow through: routing → session → queue → agent → outbound.

**Queue Modes:**

| Mode | Behavior |
|------|----------|
| `collect` | Default; batches rapid messages together |
| `steer` | Steers the agent with additional context |
| `followup` | Queues as a separate follow-up message |
| `steer-backlog` | Steers the current run; queues remainder |
| `interrupt` | Interrupts the current agent run |

Messages are deduplicated and debounced. Lane-aware FIFO processing uses default concurrency of 1 per session (4 for main lane, 8 for sub-agents).

## Streaming and Chunking

Espada uses **block streaming** to deliver messages progressively as the agent writes:

- Code-fence-aware chunking prevents splitting code blocks
- Paragraph boundaries are preferred break points
- Human-like pacing delays add natural timing between message blocks
- **Draft streaming** (Telegram only) provides real-time token-level updates in a draft bubble

## Thinking Levels

Control the LLM's reasoning depth per message or per session:

| Level | Description |
|-------|-------------|
| `off` | No extended thinking |
| `minimal` | Light reasoning |
| `low` | Standard reasoning |
| `medium` | Moderate depth |
| `high` | Deep reasoning |
| `xhigh` | Maximum reasoning depth |

Set with `/think <level>` in chat or as part of a message.

---

# 10. Agent Workspace

The agent uses a workspace directory (`~/espada` by default) as its working directory. Bootstrap files are injected into the agent's context at session start.

## Workspace Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Operating instructions and memory |
| `SOUL.md` | Persona definition, boundaries, and tone |
| `TOOLS.md` | User-maintained tool usage notes |
| `IDENTITY.md` | Agent name, vibe, emoji |
| `USER.md` | User profile and preferred address |
| `BOOTSTRAP.md` | One-time first-run ritual (auto-deleted after first use) |
| `HEARTBEAT.md` | Heartbeat schedule and check instructions |

## Memory Files

Memory is stored as plain Markdown:

- `memory/YYYY-MM-DD.md` — Daily logs (append-only)
- `MEMORY.md` — Curated long-term memory

## Skills

Skills are agent capabilities defined in `SKILL.md` files. They are loaded from three locations:

1. **Bundled** — Skills shipped with Espada
2. **Managed** — Installed to `~/.espada/skills/`
3. **Workspace** — Per-agent skills in `<workspace>/skills/`

## System Prompt Assembly

The system prompt is assembled per run and includes: tooling information, skills, workspace files, documentation, bootstrap files, sandbox instructions, date/time, reply tags, heartbeat instructions, runtime context, and reasoning configuration.

Prompt modes: `full` (default), `minimal` (for sub-agents), `none`.

---

# 11. Chat Commands

Send these commands in any connected messaging channel:

| Command | Description |
|---------|-------------|
| `/status` | Session status (model, tokens, compactions, costs) |
| `/new` or `/reset` | Reset the session (optionally set a new model: `/new claude-sonnet-4`) |
| `/compact` | Compact session context (optionally with focus instructions) |
| `/think <level>` | Set thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `/reasoning on\|off\|stream` | Show or hide model reasoning blocks |
| `/verbose on\|full\|off` | Toggle verbose tool logging |
| `/model` | List or switch models |
| `/tts on\|off\|always\|once` | Control text-to-speech |
| `/usage off\|tokens\|full` | Usage footer setting |
| `/exec host=... security=...` | Per-session exec defaults (host, security, approval, node) |
| `/send on\|off\|inherit` | Control message delivery for this session |
| `/subagents list\|stop\|log\|info\|send` | Manage sub-agent runs |
| `/restart` | Restart the gateway |
| `/debug` | Runtime config overrides (memory-only, not written to disk) |
| `/prose` | Trigger an OpenProse workflow |

---

# 12. Tools Reference

The agent has access to a comprehensive set of tools organized into categories.

## Core Tools

### File Operations

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `write` | Write content to a file |
| `edit` | Edit an existing file |
| `apply_patch` | Apply a patch to a file |

### Runtime

| Tool | Description |
|------|-------------|
| `exec` | Execute shell commands with configurable security, timeout, and host |
| `process` | Manage running processes |

### Browser Automation

| Tool | Description |
|------|-------------|
| `browser.open` | Open a URL in a managed browser profile |
| `browser.click` | Click on an element |
| `browser.type` | Type text into an element |
| `browser.screenshot` | Take a screenshot |
| `browser.snapshot` | Capture the page DOM |
| `browser.pdf` | Generate a PDF |

### Messaging

| Tool | Description |
|------|-------------|
| `message` | Send messages to any connected channel |
| `cron` | Manage scheduled jobs |

### Sessions

| Tool | Description |
|------|-------------|
| `sessions_spawn` | Spawn a sub-agent session |
| `sessions_status` | Check session status |
| `sessions_list` | List active sessions |

### Memory

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search over memory files |
| `memory_get` | Retrieve specific memory entries |

### Web

| Tool | Description |
|------|-------------|
| `web_search` | Search the web (via Brave Search, Perplexity, etc.) |
| `web_fetch` | Fetch a web page |

### UI

| Tool | Description |
|------|-------------|
| `canvas` | Present interactive HTML surfaces to companion apps |
| `nodes` | Interact with connected companion devices |
| `image` | Generate or process images |

### Gateway

| Tool | Description |
|------|-------------|
| `gateway` | Interact with gateway configuration and status |

## Tool Profiles

Predefined profiles control which tools are available:

| Profile | Description |
|---------|-------------|
| `minimal` | Basic file and runtime tools |
| `coding` | Development-focused tool set |
| `messaging` | Communication tools |
| `full` | All available tools |

## Tool Groups

Shorthand for groups of tools:

- `group:runtime` — Shell execution tools
- `group:fs` — File system tools
- `group:messaging` — Messaging and scheduling tools
- `group:ui` — Canvas and node tools
- `group:sessions` — Session management tools
- `group:plugins` — All plugin-provided tools

## Exec Tool Security

The `exec` tool supports configurable security levels:

- **Allowlist** — Only pre-approved commands execute without prompts
- **Safe Bins** — A set of commands known to be safe (read-only operations)
- **Approval Prompts** — Risky commands require human approval before execution

Per-session overrides: `/exec host=... security=... approval=... node=...`

---

# 13. Cloud Infrastructure Management

Espada provides comprehensive cloud infrastructure management through dedicated extensions for each major provider.

## AWS Extension

The AWS extension provides full-spectrum AWS management:

- **EC2 Management** — Start, stop, and terminate instances; manage security groups and auto-scaling
- **S3 Operations** — Bucket management, object operations, and lifecycle policies
- **Lambda** — Function deployment, invocation, and management
- **IAM and Security** — Policy management, GuardDuty integration, and compliance scanning
- **Networking** — VPC, subnets, route tables, and load balancers
- **CI/CD** — CodePipeline, CodeBuild, and deployment automation
- **Organizations** — Multi-account management and governance
- **Backup** — Automated backup plans and recovery operations
- **Cost Management** — Spending analysis, forecasting, budgets, and optimization recommendations
- **Infrastructure Catalog** — Pre-built architecture templates for common patterns
- **Enterprise Guardrails** — Approval workflows, dry-run mode, audit logging, and rate limiting

**Example Interactions:**

```
"List my EC2 instances in us-east-1"
"Create an S3 bucket named prod-assets with versioning enabled"
"Show my AWS spending for the last 30 days"
"Deploy this Lambda function to us-west-2"
```

## Azure Extension

The Azure extension provides Azure infrastructure management with a clean modular architecture:

- **Web Apps** — App Service deployment and management
- **Traffic Manager** — DNS-based traffic routing across regions
- **Deployment Strategies** — Blue-green, canary, rolling, and A/B deployments with automated rollback
- **Resource Management** — Full Azure resource lifecycle management

**Example Interactions:**

```
"Deploy my web app to Azure with blue-green deployment"
"Set up Traffic Manager for multi-region routing"
"List all Azure resources in the production resource group"
```

## GCP Extension

The GCP extension provides Google Cloud Platform resource management.

**Example Interactions:**

```
"List my GCP compute instances"
"Show GCP resource status for the production project"
```

## Kubernetes Extension

The Kubernetes extension provides full cluster orchestration with 20 agent tools:

- Resources, pods, scaling, rollouts, and logs via kubectl
- Helm chart management
- Namespace management
- Enterprise diagnostics with health tracking

**Example Interactions:**

```
"List all pods in the production namespace"
"Scale the nginx deployment to 5 replicas"
"Show the logs for the api-gateway pod"
"Roll back the last deployment"
```

## Terraform Extension

The Terraform extension provides Infrastructure as Code operations:

- `terraform init`, `plan`, `apply`, `destroy`
- State management (`state list`, `state pull`)
- Workspace management
- Drift detection and history
- Enterprise diagnostics with exec-specific tracking

**Example Interactions:**

```
"Run terraform plan in the infrastructure directory"
"Show the current terraform state"
"Apply the terraform changes with auto-approve"
```

## Pulumi Extension

The Pulumi extension provides Pulumi stack management:

- Stack listing and state inspection
- Enterprise diagnostics with health tracking

**Example Interactions:**

```
"List all Pulumi stacks"
"Show the state of the production stack"
```

## Hybrid Cloud Extension

The Hybrid Cloud extension provides unified topology discovery across Azure Arc, AWS Outposts, and GKE Enterprise with background sync and diagnostics.

---

# 14. Infrastructure Knowledge Graph

The Infrastructure Knowledge Graph extension builds a unified graph of your entire cloud infrastructure — scanning, querying, and analyzing resources across AWS, Azure, GCP, and Kubernetes.

## Key Capabilities

- **Multi-Cloud Discovery** — Five adapters (AWS with 21 sub-modules, Azure with 23, GCP, Kubernetes, Terraform) with cross-cloud relationship detection
- **IQL Query Language** — Purpose-built infrastructure query language with full lexer, parser, and executor
- **31 AI Agent Tools** — Blast radius analysis, single point of failure detection, drift detection, cost attribution, compliance checking, remediation, supply chain security, anomaly detection, and more
- **Six Compliance Frameworks** — SOC 2, HIPAA, PCI-DSS, ISO 27001, NIST 800-53, and CIS Benchmarks with 30+ controls and auto-generated remediation patches
- **MCP Server** — Expose all 31 tools to Claude Desktop, Cursor, Windsurf, or any MCP-compatible AI client
- **REST API** — 10 endpoints with Bearer auth, rate limiting, CORS, and NDJSON streaming
- **22 CLI Commands** — `espada graph` (13 commands) and `espada infra` (9 commands)
- **Enterprise Features** — RBAC (4 roles, 9 permissions), multi-tenancy (4 isolation modes), OPA policy engine (15 condition types), governance with 7-factor risk scoring
- **Temporal and Time Travel** — Point-in-time snapshots, graph diffing, evolution tracking

## IQL Query Language

IQL (Infrastructure Query Language) lets you query your infrastructure graph with SQL-like syntax:

```
FIND compute WHERE status = "running" AND tags.env = "prod"
FIND database WHERE tags.env = "prod"
FIND * AT "2024-01-15"
```

## Storage Backends

Four storage backends are supported:

| Backend | Description |
|---------|-------------|
| InMemory | Fast, ephemeral (default) |
| SQLite | WAL mode, 18 indexes, persistent |
| PostgreSQL | JSONB, GIN indexes, materialized views |
| SQLite-Temporal | SQLite with time-travel support |

## CLI Usage

```
# Scan from Terraform state
espada infra scan --terraform ./terraform.tfstate

# Live multi-cloud scan
espada infra cloud-scan --aws --azure --gcp --db ./infra.db

# Query with IQL
espada infra query --db ./infra.db "FIND database WHERE tags.env = 'prod'"

# Run compliance
espada infra compliance --db ./infra.db --framework hipaa

# Start MCP server for AI assistants
infra-graph mcp --db ./infra.db
```

---

# 15. Policy Engine and Compliance

## Policy Engine

Espada includes an OPA-style policy engine with:

- **7 Policy Types** — Resource creation, modification, deletion, access, network, compliance, and custom
- **18 Condition Types** — Matching on resource attributes, tags, regions, sizes, costs, and more
- **4 Action Levels** — `deny`, `warn`, `require_approval`, `notify`

## Compliance Frameworks

Six compliance frameworks are supported with automated scanning and remediation:

| Framework | Description |
|-----------|-------------|
| SOC 2 | Service Organization Control Type 2 |
| HIPAA | Health Insurance Portability and Accountability Act |
| PCI-DSS | Payment Card Industry Data Security Standard |
| ISO 27001/GDPR | Information Security Management / General Data Protection Regulation |
| NIST 800-53 | National Institute of Standards and Technology controls |
| CIS Benchmarks | Center for Internet Security configuration benchmarks |

Each framework includes 30+ concrete controls with auto-remediation capabilities.

## Audit Trail

Full event logging with compliance reporting and waiver management through the Audit Trail extension.

---

# 16. Multi-Agent System

Espada can run multiple isolated agents in a single Gateway process. Each agent has its own workspace, persona, memory, session store, auth profiles, and skills.

## Setting Up Multiple Agents

```
# Add a new agent
espada agents add work

# List agents and bindings
espada agents list --bindings
```

## Agent Routing

Routing is deterministic and follows a most-specific-wins rule. You can bind agents by:

- **Exact peer** — Route a specific person to a specific agent
- **Guild/team** — Route all members of a Discord server or Slack workspace
- **Account** — Route by connected account
- **Channel** — Route all traffic from a specific channel

Unmatched messages go to the default agent.

## Broadcast Groups

Multiple agents can respond to the same message simultaneously:

```json
{
  "broadcast": {
    "strategy": "parallel",
    "120363403215116621@g.us": ["code-reviewer", "security-auditor", "docs-bot"]
  }
}
```

**Strategies:**

- `parallel` — All agents process the message simultaneously
- `sequential` — Agents process one after another

Each agent maintains complete session isolation within broadcast groups.

## Sub-Agents

Spawn background worker runs from a running agent:

- Separate session, context, and token budget
- Configurable model (use a cheaper model for background work)
- Results announced back to the requester's chat channel
- Auto-archive after configurable timeout
- Control via `/subagents list|stop|log|send|info`

## Per-Agent Security

Each agent can have different security profiles:

- Full access, read-only, or Docker-isolated sandboxing
- Separate tool allow/deny policies per agent
- Independent workspace and credential isolation

---

# 17. Workflow Pipelines (Lobster)

Lobster is Espada's deterministic workflow pipeline system. It executes multi-step tool sequences without the LLM, saving tokens and improving reliability.

## Key Features

- **Deterministic Execution** — Steps run tool calls directly without LLM interpretation
- **Approval Gates** — Side-effect steps (deployments, deletions) pause for human sign-off and return a durable resume token
- **Resumable State** — Pick up exactly where you stopped without re-running earlier steps
- **Optional LLM Steps** — Include structured AI classification within otherwise deterministic flows

## How It Works

1. Define a workflow as a sequence of tool calls with parameters
2. Espada executes each step in order
3. When an approval gate is reached, execution pauses
4. A human approves or rejects the step
5. Execution resumes or aborts based on the decision

This approach is ideal for deployment pipelines, compliance workflows, and any multi-step operation where determinism and auditability are important.

---

# 18. Voice Calls

Espada supports real telephony through the Voice Call extension.

## Supported Providers

| Provider | Description |
|----------|-------------|
| Telnyx | Full call lifecycle support |
| Twilio | Full call lifecycle support |
| Plivo | Full call lifecycle support |

## Capabilities

- **Outbound and Inbound Calls** — Initiate and receive phone calls
- **Full Call Lifecycle** — State machine with voicemail detection
- **Real-Time TTS** — Text-to-speech during calls
- **Media Streaming** — Real-time audio streaming
- **Transcription** — Automatic speech-to-text
- **Provider Agnostic** — Normalized cross-provider abstraction
- **Webhook Security** — Secure webhook endpoint verification
- **Call Persistence** — Call state persists across gateway restarts

---

# 19. Memory System

Espada uses a plain Markdown memory system that is human-readable, version-controllable, and searchable.

## Memory Files

- **Daily Logs** — `memory/YYYY-MM-DD.md` — Append-only daily notes
- **Long-Term Memory** — `MEMORY.md` — Curated important information

## Pre-Compaction Flush

Before context compaction occurs, a silent agentic turn automatically writes durable notes to memory. This ensures no important information is lost during compaction.

## Vector Search

Semantic search over memory files is available via the memory plugin:

- **memory-core** — Default Markdown-based search
- **memory-lancedb** — LanceDB-backed long-term vector memory for larger deployments

Embedding providers supported: OpenAI, Google Gemini, and local models.

## Per-Agent Isolation

In a multi-agent setup, each agent has its own memory directory in its own workspace, ensuring complete isolation between agents.

---

# 20. Browser Automation

Espada can control browser instances for web automation tasks.

## Features

- **Isolated Profiles** — Separate Chrome, Brave, or Edge instances under agent control (named profiles: `espada`, `work`, `remote`)
- **Full Interaction** — Open tabs, click elements, type text, drag, take screenshots, capture DOM snapshots, generate PDFs
- **Chrome Extension Relay** — Bridge to the user's system browser via Chrome DevTools Protocol (CDP)
- **Browserless Support** — Connect to remote Browserless instances for headless operations

## Example Interactions

```
"Open example.com and take a screenshot"
"Fill out the login form with my credentials"
"Generate a PDF of the dashboard page"
"Capture a snapshot of the page DOM"
```

---

# 21. Text-to-Speech

Espada can convert replies to audio using three TTS providers.

## Providers

| Provider | Description | API Key Required |
|----------|-------------|-----------------|
| Edge TTS | Microsoft Edge voices (default) | No |
| ElevenLabs | High-quality neural voices | Yes |
| OpenAI | OpenAI TTS voices | Yes |

## Modes

| Mode | Behavior |
|------|----------|
| `off` | TTS disabled |
| `always` | Convert all replies to audio |
| `inbound` | Reply with audio only when a voice note is received |
| `tagged` | Convert only tagged/selected replies |

## Controls

- `/tts on` — Enable for the current session
- `/tts off` — Disable for the current session
- `/tts always` — Convert all replies
- `/tts once` — Convert the next reply only

## Summary Mode

For long replies, an optional LLM summarization step condenses the text before TTS conversion. Telegram receives native voice-note bubbles.

---

# 22. Automation

## Cron Scheduler

Espada includes a built-in persistent cron scheduler.

### Schedule Types

| Type | Description | Example |
|------|-------------|---------|
| `at` | One-shot at a specific time | `at: "2026-03-15T09:00:00"` |
| `every` | Recurring interval | `every: "30m"` |
| `cron` | Standard cron expression with timezone | `cron: "0 9 * * MON-FRI"` |

### Execution Styles

- **Main Session** — Job runs as a system event in the main session with heartbeat context
- **Isolated** — Job runs in a dedicated `cron:<jobId>` session with optional model/thinking overrides

### Managing Cron Jobs

```
espada cron add --name "daily-report" --every "24h" --message "Generate and send the daily infrastructure report"
espada cron list
espada cron remove <jobId>
```

Jobs persist under `~/.espada/cron/` and survive gateway restarts.

## Webhooks

HTTP endpoints that trigger agent runs from external systems.

### Endpoint Types

| Endpoint | Description |
|----------|-------------|
| `POST /hooks/wake` | Enqueue a system event for the main session |
| `POST /hooks/agent` | Isolated agent turn with delivery to a channel |
| `POST /hooks/<name>` | Custom webhook with configurable transforms |

### Authentication

Webhooks use token-based authentication. Generate a token and include it in the `Authorization` header.

### Transforms

Custom webhook transforms can be written as JavaScript or TypeScript modules to process incoming payloads before they reach the agent.

### Gmail Pub/Sub Integration

Automatically trigger agent runs when emails arrive:

```
espada webhooks gmail setup
```

This sets up Gmail → Pub/Sub → Espada webhook pipeline for real-time email processing.

## Hooks

Event-driven scripts that run inside the Gateway on agent events.

### Supported Events

| Event | Description |
|-------|-------------|
| `command:new` | Session reset triggered |
| `command:reset` | Session reset triggered |
| `command:stop` | Agent run stopped |
| `session:*` | Session lifecycle events |
| `agent:*` | Agent lifecycle events |
| `gateway:*` | Gateway lifecycle events |

### Bundled Hooks

| Hook | Description |
|------|-------------|
| `session-memory` | Saves context to memory on `/new` |
| `command-logger` | Logs commands to `~/.espada/logs/commands.log` |
| `boot-md` | Runs `BOOT.md` on gateway start |

### Custom Hooks

Create a hook with a `HOOK.md` file (YAML frontmatter and documentation) and a `handler.ts` file. Place hooks in `<workspace>/hooks/`, `~/.espada/hooks/`, or package them as npm hook packs.

## Cron vs. Heartbeat

| Feature | Heartbeat | Cron |
|---------|-----------|------|
| Timing | Periodic (naturally drifts) | Exact, cron-expression driven |
| Session | Main session | Isolated or main |
| Context | Full conversation context | Fresh context per run |
| Use Case | Routine monitoring | Precise schedules, one-shot reminders |

**Best Practice:** Use both — heartbeats for routine awareness checks, cron for precise scheduling.

---

# 23. Session Management

## Session Types

- **Main Session** — Default DM session for an agent
- **Group Session** — Per-group sessions for group chats
- **Sub-Agent Session** — Background worker sessions
- **Cron Session** — Isolated sessions for cron jobs

## Context Management

- **Auto-Compaction** — Automatically summarizes older history when context limits approach
- **Session Pruning** — Trims old tool results in-memory without rewriting JSONL history
- **Manual Compaction** — `/compact` with optional focus instructions

## Block Streaming

Progressive message delivery with intelligent chunking:

- Code-fence-aware splitting (never breaks inside a code block)
- Paragraph boundary preference
- Human-like pacing delays between blocks
- Coalescing of consecutive streamed blocks

## Typing Indicators

| Mode | Behavior |
|------|----------|
| `never` | No typing indicators |
| `instant` | Show immediately |
| `thinking` | Show while the model is reasoning |
| `message` | Show while composing the reply |

Configurable interval (default: 6 seconds).

---

# 24. Skills and EspadaHub

## What Are Skills?

Skills are modular capabilities that teach the agent how to use specific tools. Each skill is a folder containing a `SKILL.md` file with frontmatter metadata and usage instructions.

## Skill Loading

Skills are loaded from three locations (in order of precedence):

1. **Workspace** — `<workspace>/skills/` (per-agent)
2. **Managed** — `~/.espada/skills/` (shared across agents)
3. **Bundled** — Skills shipped with Espada

## Skill Gating

Skills can specify requirements in their metadata:

- `bins` — Required binaries (e.g., `terraform`, `kubectl`)
- `env` — Required environment variables
- `config` — Required configuration values
- `os` — Required operating system

Skills that do not meet requirements are automatically disabled.

## EspadaHub

EspadaHub ([espadahub.com](https://espadahub.com)) is the public skills registry for discovering, installing, updating, and syncing skills.

## Plugin Skills

Plugins can ship their own skills via the plugin manifest, making cloud-specific skills available when the corresponding extension is installed.

---

# 25. Security

Espada implements multiple layers of security to protect your infrastructure.

## Security Layers

### Layer 1: DM Pairing

Unknown senders receive an 8-character pairing code. Codes expire after 1 hour with a maximum of 3 pending approvals.

```
espada pairing approve <channel> <code>
```

### Layer 2: Allowlists

Per-channel allowlists control who can interact with the agent:

- `allowFrom` — Allowed DM senders
- `groupPolicy` — `open`, `disabled`, or `allowlist`
- `groupAllowFrom` — Allowed groups

### Layer 3: Gateway Authentication

The Gateway requires a token or password for WebSocket connections:

```
espada gateway --token <your-token>
```

### Layer 4: Sandboxing

Docker-based isolation for tool execution:

| Setting | Options |
|---------|---------|
| Mode | `off`, `non-main` (sandbox non-main agents), `all` |
| Scope | `session`, `agent`, `shared` |
| Workspace Access | `none`, `ro` (read-only), `rw` (read-write) |

Custom bind mounts and setup commands are supported.

### Layer 5: Exec Approvals

Shell command execution is gated by an allowlist/deny system:

- **Allowlist** — Pre-approved commands execute without prompts
- **Safe Bins** — Commands known to be safe (read-only operations)
- **Approval Prompts** — Risky commands require human approval

### Layer 6: Tool Policy

Global and per-agent allow/deny lists for every tool:

```json
{
  "tools": {
    "allow": ["read", "write", "exec"],
    "deny": ["gateway"]
  }
}
```

### Layer 7: Formal Verification

TLA+/TLC machine-checked security models verify critical subsystems:

- Gateway exposure model
- Node execution pipeline
- Pairing store invariants
- Ingress gating rules
- Routing isolation guarantees

Both positive (safety invariants) and negative (expected violations) models are maintained.

### Layer 8: OAuth

PKCE token exchange, multi-account profiles, per-session overrides, and automatic token refresh under file locks.

## Security CLI

```
espada pairing approve <channel> <code>    # Approve a sender
espada security audit --deep               # Full security audit
espada doctor                              # Check for misconfigurations
espada sandbox explain                     # Debug sandbox/tool policy
```

---

# 26. Companion Apps and Nodes

## What Are Nodes?

Nodes are companion devices (macOS, iOS, Android, headless) that connect to the Gateway over WebSocket with a `node` role. They extend the agent's capabilities with device-specific features.

## Companion Apps

| App | Platform | Features |
|-----|----------|----------|
| Espada.app | macOS | Menu bar gateway control, Voice Wake, WebChat |
| iOS Node | iOS | Canvas, Voice Wake, Talk Mode, camera |
| Android Node | Android | Canvas, Talk Mode, camera, screen recording |

## Node Capabilities

| Category | Capabilities |
|----------|-------------|
| Canvas | Present URLs, navigate, evaluate JS, snapshot (png/jpg), A2UI push |
| Camera | Snap photos (jpg), clip video (mp4, up to 60s) |
| Screen | Record screen (mp4, up to 60s, configurable fps) |
| Location | Get device GPS location |
| System | Execute commands on the node host (with exec approvals) |

## Managing Nodes

```
espada nodes status     # View connected nodes
espada nodes approve    # Approve a new node
```

Nodes require device pairing. Each node is identified by a device identity and keypair fingerprint.

## Remote Execution via Node Host

Run commands on a separate machine:

```
espada node run --host <gateway-host>
```

Exec approvals are enforced per node host at `~/.espada/exec-approvals.json`.

---

# 27. Web Dashboard

## Overview

The web dashboard is a Vite + Lit browser UI available at `http://<host>:18789/`.

## Features

- **Chat Interface** — Full WebChat with the agent
- **Configuration** — View and modify settings
- **Exec Approvals** — Approve or deny pending command executions
- **Logs** — View real-time gateway logs
- **Session Management** — View and manage active sessions
- **Node Management** — Monitor connected companion devices

## Accessing the Dashboard

```
espada dashboard
```

This opens a browser with the authentication token pre-filled. The token is stored in the browser's localStorage.

## Authentication

The dashboard requires authentication via token or password, configured during gateway setup.

## Bind Modes

| Mode | Description |
|------|-------------|
| `loopback` | Default; accessible only on localhost |
| `tailnet` | Accessible across your Tailscale network |
| `auto` | Automatic detection |

For non-loopback access, a gateway auth token or password is required.

---

# 28. Diagnostics and Logging

## Logging

### File Logs

Logs are written in JSONL format to `/tmp/espada/espada-YYYY-MM-DD.log`.

### Console Output

Console output is TTY-aware with color formatting and structured logging.

### Viewing Logs

```
espada logs --follow    # Tail logs in real-time
```

The Control UI also provides a Logs tab for browser-based log viewing.

### Log Levels

Configure separately for file and console:

```json
{
  "logging": {
    "level": "info",
    "consoleLevel": "warn",
    "redactSensitive": true
  }
}
```

### Sensitive Data Redaction

Enable `logging.redactSensitive` to automatically redact tool outputs. Custom redaction patterns can be specified with `redactPatterns`.

## Diagnostics Flags

Enable targeted debug logging without raising the global log level:

```json
{
  "diagnostics": {
    "flags": ["telegram.http", "gateway.routing"]
  }
}
```

Or via environment variable:

```
ESPADA_DIAGNOSTICS=telegram.http,gateway.*
```

Wildcards are supported (`*` for all diagnostic flags).

## OpenTelemetry

Espada supports OTLP/HTTP (protobuf) export for metrics, traces, and logs.

### Metrics

Counters and histograms for: `model.usage`, `webhook.*`, `message.*`, `queue.*`, `session.*`, `diagnostic.heartbeat`

### Traces

Distributed tracing spans for request flows through the gateway.

### Dashboards

Three pre-built Grafana dashboards are included with the diagnostics-otel extension.

## Circuit Breakers

Per-provider and per-channel circuit breakers protect against cascading failures:

| State | Behavior |
|-------|----------|
| Closed | Normal operation; requests flow through |
| Open | Requests are blocked; breaker tripped |
| Half-Open | Limited probe requests to test recovery |

Breakers trip on: rate limits, timeouts, auth/billing failures, and 5xx server errors.

The `/health` endpoint includes circuit breaker state. Diagnostic events fire on state transitions.

## Raw Stream Logging

For deep debugging:

```
ESPADA_RAW_STREAM=1 espada gateway
```

Writes raw LLM streams to `~/.espada/logs/raw-stream.jsonl`.

---

# 29. Deployment Platforms

Espada can be deployed on various platforms.

## Self-Hosted

### macOS

- Menu bar companion app with LaunchAgent service (`bot.molt.gateway`)
- TCC permissions required for accessibility features
- Local mode (attached to gateway) or Remote mode (SSH/Tailscale)

### Linux

- Fully supported with systemd user service
- VPS quick path: Install Node 22+ → npm install → `espada onboard --install-daemon` → SSH tunnel

### Windows

- WSL2 with Ubuntu recommended
- systemd must be enabled in WSL2
- Port forwarding via `netsh portproxy` for external access

## Cloud Hosting

| Platform | Notes |
|----------|-------|
| Fly.io | Persistent volumes, included fly.toml |
| Hetzner | Docker deployment |
| GCP Compute Engine | Standard VM deployment |
| DigitalOcean | Droplet deployment |
| Oracle Cloud | Free tier compatible |
| Raspberry Pi | ARM support |
| Render | Included render.yaml |

## Docker Deployment

```
docker compose up -d
```

Use `ESPADA_HOME_VOLUME` to persist your home directory. The included `docker-compose.yml`, `Dockerfile`, and `Dockerfile.sandbox` provide ready-to-use configurations.

## Tailscale Integration

Espada integrates with Tailscale for secure remote access:

| Mode | Description |
|------|-------------|
| `serve` | HTTPS access within your tailnet |
| `funnel` | Public access via Tailscale Funnel |
| `off` | Tailscale integration disabled |

When `allowTailscale: true`, identity headers enable tokenless authentication for tailnet users.

---

# 30. CLI Reference

The `espada` CLI provides comprehensive control of the platform.

## General Commands

| Command | Description |
|---------|-------------|
| `espada quickstart` | Auto-detect credentials and start |
| `espada onboard` | Full onboarding wizard |
| `espada configure` | Interactive configuration |
| `espada status` | Gateway and channel overview |
| `espada health` | Health snapshot (supports `--json`) |
| `espada doctor` | Diagnose and repair issues |
| `espada update` | Update to the latest version |
| `espada uninstall` | Remove Espada |

## Gateway Commands

| Command | Description |
|---------|-------------|
| `espada gateway` | Start the gateway process |
| `espada gateway --port 18789` | Start on a specific port |
| `espada dashboard` | Open the web dashboard |
| `espada logs --follow` | Tail gateway logs |

## Agent Commands

| Command | Description |
|---------|-------------|
| `espada agent --message "..."` | Send a message to the agent |
| `espada agent --thinking high` | Set thinking level |
| `espada agents add <name>` | Add a new agent |
| `espada agents list` | List all agents |
| `espada agents list --bindings` | List agents with routing bindings |

## Channel Commands

| Command | Description |
|---------|-------------|
| `espada channels login` | Connect a messaging channel |
| `espada message send --to <dest> --message "..."` | Send a message |
| `espada message poll` | Create a poll |
| `espada pairing approve <channel> <code>` | Approve a DM pairing |

## Automation Commands

| Command | Description |
|---------|-------------|
| `espada cron add` | Add a cron job |
| `espada cron list` | List cron jobs |
| `espada cron remove <id>` | Remove a cron job |
| `espada webhooks gmail setup` | Set up Gmail Pub/Sub integration |

## Infrastructure Commands

| Command | Description |
|---------|-------------|
| `espada infra scan` | Scan infrastructure |
| `espada infra cloud-scan` | Live multi-cloud scan |
| `espada infra query` | Query with IQL |
| `espada infra compliance` | Run compliance checks |
| `espada graph` | Knowledge graph commands (13 subcommands) |

## Security Commands

| Command | Description |
|---------|-------------|
| `espada security audit --deep` | Full security audit |
| `espada sandbox explain` | Debug sandbox and tool policies |
| `espada pairing approve` | Approve DM pairing codes |

## Model Commands

| Command | Description |
|---------|-------------|
| `espada models scan` | Scan available models |
| `espada models auth login-github-copilot` | GitHub Copilot device flow login |

## Node Commands

| Command | Description |
|---------|-------------|
| `espada nodes status` | View connected nodes |
| `espada nodes approve` | Approve a new node |
| `espada node run --host <host>` | Run commands on a remote node |

## Plugin Commands

| Command | Description |
|---------|-------------|
| `espada plugins list` | List installed plugins |
| `espada plugins install <name>` | Install a plugin |

## Other Commands

| Command | Description |
|---------|-------------|
| `espada tui` | Open the terminal UI chat client |
| `espada skills list` | List installed skills |

---

# 31. Troubleshooting

## Common Issues

### Gateway Fails to Start

1. Verify Node.js 22+ is installed: `node --version`
2. Check for port conflicts: `lsof -i :18789`
3. Run diagnostics: `espada doctor`
4. Check logs: `espada logs --follow`

### Channel Not Connecting

1. Verify credentials are configured: `espada configure --section channels`
2. Check channel-specific requirements (e.g., Bot Token for Discord, QR for WhatsApp)
3. Review circuit breaker state: `espada health --json`
4. Check diagnostics flags: `ESPADA_DIAGNOSTICS=<channel>.*`

### LLM Provider Errors

1. Verify API keys: check environment variables or OAuth credentials
2. Review failover configuration: ensure fallback models are configured
3. Check circuit breaker state for the provider
4. Review auth profile cooldowns in `espada health --json`

### Agent Not Responding

1. Check session status: send `/status` in chat
2. Verify the agent is running: `espada status`
3. Check for queue issues: review logs for queue-related errors
4. Try resetting the session: send `/new`

### Sandbox Issues

1. Verify Docker is running: `docker info`
2. Check sandbox configuration: `espada sandbox explain`
3. Review tool policies for denied tools
4. Check workspace access permissions

### Memory or Performance Issues

1. Check context size: send `/status` to see token usage
2. Trigger manual compaction: send `/compact`
3. Review session pruning settings
4. Check for large tool outputs in logs

## Diagnostic Tools

| Tool | Purpose |
|------|---------|
| `espada doctor` | Comprehensive health check and repair |
| `espada health --json` | Machine-readable health snapshot |
| `espada status` | Quick overview of gateway and channels |
| `espada logs --follow` | Real-time log streaming |
| `/status` (in chat) | Session-level diagnostics |
| `/debug` (in chat) | Runtime config overrides for debugging |

## Getting Help

- Documentation: Available at the web dashboard or via the docs site
- GitHub Issues: Report bugs and request features at the repository
- EspadaHub: Community skills and extensions at [espadahub.com](https://espadahub.com)

---

# 32. Glossary

| Term | Definition |
|------|-----------|
| **Agent** | An AI assistant instance with its own workspace, persona, memory, and configuration |
| **Binding** | A routing rule that maps a channel, account, group, or peer to a specific agent |
| **Bootstrap** | One-time initialization files loaded on first session start |
| **Broadcast Group** | A configuration where multiple agents respond to the same message |
| **Canvas** | An agent-editable HTML surface presented on companion devices |
| **Channel** | A messaging platform connected to Espada (WhatsApp, Slack, etc.) |
| **Compaction** | Automatic summarization of older conversation history to fit context limits |
| **Context Window** | The maximum amount of text an LLM can process in a single request |
| **Circuit Breaker** | A fault-tolerance pattern that stops requests to a failing service |
| **Cron Job** | A scheduled task that runs at specified times or intervals |
| **DM Pairing** | Security mechanism requiring approval before unknown senders can interact |
| **EspadaHub** | Public registry for discovering and installing skills |
| **Failover** | Automatic switching to a backup LLM provider when the primary fails |
| **Gateway** | The central process that manages all connections, sessions, and routing |
| **Hook** | An event-driven script that runs inside the Gateway on specific events |
| **IQL** | Infrastructure Query Language — a purpose-built query language for the knowledge graph |
| **Knowledge Graph** | A unified graph of cloud infrastructure resources and relationships |
| **Lobster** | Espada's deterministic workflow pipeline system |
| **MCP** | Model Context Protocol — a standard for exposing tools to AI assistants |
| **Node** | A companion device (macOS, iOS, Android) connected to the Gateway |
| **Plugin** | A TypeScript extension that adds capabilities to Espada |
| **Sandbox** | Docker-based isolation for tool execution |
| **Session** | An ongoing conversation between a user and an agent |
| **Skill** | A modular capability defined by a SKILL.md file |
| **Sub-Agent** | A background worker spawned by a running agent for isolated tasks |
| **Tool** | A capability the AI agent can invoke (file operations, cloud APIs, etc.) |
| **Webhook** | An HTTP endpoint that triggers agent runs from external systems |
| **Workspace** | The agent's working directory containing configuration, memory, and skills |

---

**End of User Guide**

*Espada is a proprietary product built by Saif Al-Din Ali. It incorporates foundational components from OpenClaw (MIT License, by Peter Steinberger). Espada itself — including all architecture, integrations, and original work — is Proprietary, All Rights Reserved.*
