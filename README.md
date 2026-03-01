# ⚔️ Espada — Software Infrastructure Automation Platform

**Espada** is a software infrastructure automation platform powered by conversational AI. It manages cloud infrastructure, containers, and deployments through natural language commands sent via messaging channels.

> Automate your infrastructure through conversation — deploy to AWS, Azure, GCP, orchestrate Kubernetes, Docker, and Terraform, all from your favorite messaging app.

## What is Espada?

Espada is a local-first gateway that connects to your messaging channels and lets you manage infrastructure through natural language. The Gateway is the control plane — it handles sessions, channels, tools, and events, while an AI agent processes your requests and executes infrastructure operations.

<p align="center">
  <img src="assets/architecture-diagram.svg" alt="Espada Architecture" width="800">
</p>

## Supported Messaging Channels

| Channel | Type | Library/Protocol |
|---------|------|-----------------|
| WhatsApp | Core | Baileys |
| Telegram | Core | grammY |
| Slack | Core | Bolt |
| Discord | Core | discord.js |
| Google Chat | Core | Chat API |
| Signal | Core | signal-cli |
| iMessage | Core | imsg (macOS only) |
| WebChat | Core | Gateway WebSocket |
| Microsoft Teams | Extension | Bot Framework |
| Matrix | Extension | matrix-js-sdk |
| BlueBubbles | Extension | BlueBubbles API |
| Zalo | Extension | Zalo OA API |
| LINE | Extension | LINE Messaging API |
| Mattermost | Extension | Mattermost API |
| Nostr | Extension | Nostr Protocol |
| Twitch | Extension | Twitch IRC |

## What Can It Do?

- **Cloud Infrastructure Management** — Manage EC2 instances, S3 buckets, Lambda functions, and more across AWS, Azure, and GCP
- **Infrastructure Knowledge Graph** — Unified multi-cloud graph with IQL queries, compliance scanning, blast radius analysis, and 31 AI agent tools
- **Container Orchestration** — Deploy and manage Docker containers and Kubernetes clusters
- **Infrastructure as Code** — Execute Terraform plans and CloudFormation stacks
- **Multi-Channel Inbox** — Receive and respond across all connected messaging channels simultaneously
- **Multi-Agent Routing** — Route different channels/accounts to isolated agents with separate workspaces
- **Security & Compliance** — SOC 2, HIPAA, PCI-DSS, ISO 27001, NIST 800-53, CIS compliance frameworks with auto-remediation
- **Cost Management** — Track cloud spending, set budgets, and get optimization recommendations
- **Backup & Recovery** — Automated backup management and disaster recovery operations
- **Voice Interface** — Voice Wake and Talk Mode for hands-free infrastructure management (macOS/iOS/Android)
- **Browser Automation** — Built-in Chrome/Chromium control for web-based operations
- **Scheduled Tasks** — Cron jobs, webhooks, and Gmail Pub/Sub triggers for automation

## Project Structure

<p align="center">
  <img src="assets/project-structure-diagram.svg" alt="Project Structure" width="800">
</p>

## Extensions & Plugin System

Espada uses a plugin architecture. Extensions live under `extensions/` as workspace packages. Each extension can register:

- **Agent Tools** — New capabilities the AI agent can use
- **Gateway Methods** — Custom WebSocket RPC methods
- **Channel Handlers** — New messaging channel integrations

### AWS Extension

The AWS extension (`extensions/aws/`) provides comprehensive AWS infrastructure management:

- **EC2 Management** — Start, stop, terminate instances; manage security groups and auto-scaling
- **S3 Operations** — Bucket management, object operations, lifecycle policies
- **Lambda** — Function deployment, invocation, and management
- **IAM & Security** — Policy management, GuardDuty integration, compliance scanning
- **Networking** — VPC, subnets, route tables, load balancers
- **CI/CD** — CodePipeline, CodeBuild, deployment automation
- **Organizations** — Multi-account management and governance
- **Backup** — Automated backup plans and recovery operations
- **Cost Management** — Spending analysis and optimization
- **Infrastructure Catalog** — Pre-built architecture templates

### Infrastructure Knowledge Graph (`@infra-graph/core`)

The knowledge graph extension (`extensions/knowledge-graph/`) builds a unified graph of your entire cloud infrastructure — scanning, querying, and analyzing resources across AWS, Azure, GCP, and Kubernetes.

<p align="center">
  <img src="extensions/knowledge-graph/docs/overview.svg" alt="Infrastructure Knowledge Graph" width="800">
</p>

**Key capabilities:**

- **Multi-Cloud Discovery** — 5 adapters (AWS with 21 sub-modules, Azure with 23, GCP, Kubernetes, Terraform) plus cross-cloud relationship detection
- **IQL Query Language** — Purpose-built infrastructure query language with full lexer/parser/executor: `FIND compute WHERE status = "running" AND tags.env = "prod"`
- **31 AI Agent Tools** — Blast radius, SPOF detection, drift, cost attribution, compliance, remediation, supply chain security, anomaly detection, and more
- **6 Compliance Frameworks** — SOC 2, HIPAA, PCI-DSS, ISO 27001, NIST 800-53, CIS Benchmarks with 30+ concrete controls and auto-generated remediation patches
- **MCP Server** — Expose all 31 tools to Claude Desktop, Cursor, Windsurf, or any MCP-compatible AI client
- **REST API** — 10 endpoints with Bearer auth, rate limiting, CORS, and NDJSON streaming for large topologies
- **22 CLI Commands** — `espada graph` (13 commands) and `espada infra` (9 commands) for scanning, querying, compliance, and reporting
- **Enterprise Features** — RBAC (4 roles, 9 permissions), multi-tenancy (4 isolation modes), OPA policy engine (15 condition types), governance with 7-factor risk scoring, federation
- **Temporal & Time Travel** — Point-in-time snapshots, graph diffing, evolution tracking, temporal IQL queries (`FIND * AT "2024-01-15"`)
- **4 Storage Backends** — InMemory, SQLite (WAL, 18 indexes), PostgreSQL (JSONB, GIN, materialized views), SQLite-Temporal
- **Observability** — OTEL metrics and traces (push/pull), 3 Grafana dashboards, continuous monitoring with CloudTrail/Azure/GCP event sources
- **GitHub Action** — CI/CD compliance scanning with PR comments, threshold enforcement, and OTEL export

```bash
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

> **30,000+ LOC** · **1,422 tests** · See [`extensions/knowledge-graph/README.md`](extensions/knowledge-graph/README.md) for full documentation.

## Install

**System requirements:** Node ≥22 · macOS, Linux, or Windows (WSL2)

### Quick install (recommended)

```bash
curl -fsSL https://molt.bot/install.sh | bash
```

Windows (PowerShell):

```powershell
iwr -useb https://molt.bot/install.ps1 | iex
```

### Alternative: global install

```bash
npm install -g espada@latest
espada onboard --install-daemon
```

Other install methods: [Docker](https://docs.molt.bot/install/docker) · [Nix](https://docs.molt.bot/install/nix) · [Ansible](https://docs.molt.bot/install/ansible) · [From source](https://docs.molt.bot/install)

## Quick Start

If you already have an API key in your environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`), or Ollama running locally:

```bash
espada quickstart
```

This will auto-detect your LLM credentials, generate a gateway token, and open a browser dashboard at `http://127.0.0.1:18789/` — **chatting in under 30 seconds**, no channel setup needed.

When you're ready to extend:

```bash
# Connect messaging channels (WhatsApp, Telegram, Discord, etc.)
espada configure --section channels

# Connect cloud providers (AWS, Azure, GCP)
espada configure --section cloud

# Full configuration wizard
espada onboard
```

### Verify

```bash
espada status          # Gateway + channel overview
espada health          # Health snapshot from the running gateway
espada doctor          # Check for misconfigurations
```

### Connect a chat channel

```bash
# WhatsApp (QR code login)
espada channels login

# Send a test message
espada message send --to +1234567890 --message "Hello from Espada"

# Talk to the agent from the CLI
espada agent --message "List my EC2 instances in us-east-1" --thinking high
```

## Development

```bash
git clone https://github.com/saifaldin14/Espada-Auto.git
cd Espada-Auto

pnpm install
pnpm ui:build          # auto-installs UI deps on first run
pnpm build

# Dev loop (auto-reload)
pnpm gateway:watch

# Run tests
pnpm test

# Lint + format
pnpm lint && pnpm format
```

Run CLI commands from the repo without a global install: `pnpm espada ...`

Open the dashboard: `espada dashboard` (or browse `http://127.0.0.1:18789/`).

## Chat Commands

Send these in any connected messaging channel:

| Command | Description |
|---------|-------------|
| `/status` | Session status (model + tokens) |
| `/new` or `/reset` | Reset the session |
| `/compact` | Compact session context |
| `/think <level>` | Set thinking level (off/low/medium/high) |
| `/verbose on\|off` | Toggle verbose mode |
| `/usage off\|tokens\|full` | Usage footer setting |
| `/restart` | Restart the gateway |

## Companion Apps

| App | Platform | Features |
|-----|----------|----------|
| Espada.app | macOS | Menu bar gateway control, Voice Wake, WebChat |
| iOS Node | iOS | Canvas, Voice Wake, Talk Mode, camera |
| Android Node | Android | Canvas, Talk Mode, camera, screen recording |

## Configuration

Config lives at `~/.espada/espada.json`. The workspace (skills, prompts, memories) lives at `~/clawd`.

Minimal config:

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-5"
  }
}
```

Interactive configuration:

```bash
espada configure                  # Full interactive config
espada configure --section cloud  # Cloud providers only
espada configure --section channels  # Messaging channels only
espada configure --section web    # Web search (Brave API key)
```

## Security

- DM pairing is enabled by default — unknown senders receive a pairing code
- Approve senders: `espada pairing approve <channel> <code>`
- Security audit: `espada security audit --deep`
- Run `espada doctor` to check for security misconfigurations

## License

[MIT](LICENSE)
