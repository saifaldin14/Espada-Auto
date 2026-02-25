# Pulumi

Pulumi integration for the Espada AI agent gateway.

## Overview

The Pulumi extension integrates Pulumi infrastructure-as-code with the Espada gateway. It provides state parsing, preview/up command wrapping, drift detection, and agent-facing tools — enabling AI-driven infrastructure management using Pulumi stacks.

## Features

- Pulumi state parsing and resource inventory
- `pulumi preview` and `pulumi up` command wrapping
- Infrastructure drift detection and reporting
- Stack management (list, select, create, destroy)
- Resource dependency graph visualization
- Agent-facing tools for conversational Pulumi operations
- Support for multiple Pulumi backends (local, S3, Pulumi Cloud)

## Installation

```bash
cd extensions/pulumi
pnpm install
```

## Configuration

```yaml
extensions:
  pulumi:
    backend: file://~/.pulumi
    default_stack: dev
```

Requires the [Pulumi CLI](https://www.pulumi.com/docs/install/) installed.

## Usage

Manage Pulumi stacks through the agent or CLI:

```bash
espada pulumi stacks list
espada pulumi preview --stack production
espada pulumi drift detect --stack production
```

The agent can answer questions like "what resources are in the production stack?" or "preview changes before deploying."

## License

MIT
