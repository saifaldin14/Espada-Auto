# Terraform

Terraform state management integration for the Espada AI agent gateway.

## Overview

The Terraform extension provides deep Terraform integration for Espada, enabling AI-driven infrastructure management. It handles state parsing, drift detection, plan evaluation, and state locking — giving your agent full visibility and control over Terraform-managed infrastructure.

## Features

- Terraform state parsing and resource inventory
- Infrastructure drift detection and reporting
- `terraform plan` evaluation with change summarization
- `terraform apply` wrapping with approval gates
- State locking and unlock management
- Multi-workspace and multi-backend support
- Resource dependency graph visualization
- Agent-facing tools for conversational Terraform operations
- HCL configuration analysis and validation
- Import and state-move operations

## Installation

```bash
cd extensions/terraform
pnpm install
```

## Configuration

```yaml
extensions:
  terraform:
    working_dir: ./infrastructure
    backend: s3
    auto_approve: false
    lock_timeout: 300
```

Requires the [Terraform CLI](https://developer.hashicorp.com/terraform/install) installed.

## Usage

Manage Terraform infrastructure through the agent or CLI:

```bash
espada terraform state list --workspace production
espada terraform plan --workspace production
espada terraform drift detect --workspace production
espada terraform apply --workspace production --auto-approve false
```

The agent can answer questions like "what changed in the last plan?" or "detect drift in the production workspace."

## License

MIT
