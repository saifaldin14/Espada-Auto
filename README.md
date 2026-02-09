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
- **Container Orchestration** — Deploy and manage Docker containers and Kubernetes clusters
- **Infrastructure as Code** — Execute Terraform plans and CloudFormation stacks
- **Multi-Channel Inbox** — Receive and respond across all connected messaging channels simultaneously
- **Multi-Agent Routing** — Route different channels/accounts to isolated agents with separate workspaces
- **Security & Compliance** — AWS GuardDuty, IAM policy management, security scanning, and guardrails
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

## Install

Runtime: **Node ≥22**

```bash
npm install -g espada@latest
espada onboard --install-daemon
```

## Quick Start

```bash
# Start the gateway
espada gateway --port 18789

# Send a message
espada message send --to +1234567890 --message "Hello from Espada"

# Talk to the agent
espada agent --message "List my EC2 instances in us-east-1" --thinking high
```

## Development

```bash
git clone https://github.com/saifaldin14/Espada-Auto.git
cd Espada-Auto

pnpm install
pnpm build

# Dev loop (auto-reload)
pnpm gateway:watch

# Run tests
pnpm test

# Lint
pnpm lint
```

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

Minimal `~/.espada/espada.json`:

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-5"
  }
}
```

## Security

- DM pairing is enabled by default — unknown senders receive a pairing code
- Approve senders: `espada pairing approve <channel> <code>`
- Run `espada doctor` to check for security misconfigurations

## License

[MIT](LICENSE)
