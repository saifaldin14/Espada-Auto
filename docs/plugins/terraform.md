---
summary: "Terraform plugin: parse state, plan summaries, drift detection, CLI execution, codify infrastructure, and import planning"
read_when:
  - You want to manage Terraform infrastructure through Espada
  - You need to run terraform commands via the agent
  - You are configuring or developing the Terraform extension
---

# Terraform (plugin)

Full Terraform lifecycle management for Espada. Parse state files,
preview plans, detect drift, execute CLI commands, generate HCL from
discovered infrastructure, and plan imports — all through natural
language or CLI commands.

Current capabilities:
- **State analysis** — parse state JSON, list resources, map dependencies
- **Plan summaries** — human-readable change previews from plan JSON
- **Drift detection** — compare expected vs actual configuration
- **CLI execution** — init, validate, plan, apply, destroy, import, state operations
- **Codify** — generate Terraform HCL from knowledge-graph nodes
- **Import planning** — generate `terraform import` commands in dependency order
- **Workspace management** — register and track multiple workspaces

## Prerequisites

1. **Node.js 22+**
2. **Terraform CLI** installed ([install guide](https://developer.hashicorp.com/terraform/install))
3. **Espada** installed and configured
4. Cloud credentials for the providers your Terraform configs use

## Install

```bash
espada plugins install @espada/terraform
```

Restart the Gateway afterwards.

For local development:

```bash
espada plugins install ./extensions/terraform
cd extensions/terraform && pnpm install
```

## Agent tools

The plugin registers **22 agent tools** across three categories:

### State & analysis tools (5)

| Tool | Description |
|---|---|
| `tf_parse_state` | Parse a Terraform state file (JSON) and return resources, dependencies, providers, and resource types |
| `tf_plan_summary` | Analyse a Terraform plan JSON and return a summary of creates, updates, deletes, and replaces |
| `tf_drift_check` | Compare expected vs actual state attributes to detect configuration drift |
| `tf_workspaces` | List all registered Terraform workspaces |
| `tf_lock_status` | Check if a Terraform state is currently locked |

### CLI execution tools (14)

These tools wrap the `terraform` binary and execute real commands in a
sandboxed shell. Destructive operations require `confirm="yes"`.

| Tool | Safety | Description |
|---|---|---|
| `tf_exec_version` | Safe | Check Terraform version and installation status |
| `tf_exec_init` | Safe | Run `terraform init` |
| `tf_exec_validate` | Read-only | Run `terraform validate` (syntax check) |
| `tf_exec_plan` | Read-only | Run `terraform plan` (dry-run preview) |
| `tf_exec_show` | Read-only | Inspect current state or a saved plan |
| `tf_exec_state_list` | Read-only | Run `terraform state list` |
| `tf_exec_state_pull` | Read-only | Run `terraform state pull` (JSON output) |
| `tf_exec_output` | Read-only | Run `terraform output` |
| `tf_exec_fmt` | Safe | Format `.tf` files |
| `tf_exec_apply` | ⚠ Destructive | Run `terraform apply` (requires `confirm="yes"`) |
| `tf_exec_destroy` | ⚠ Destructive | Run `terraform destroy` (requires `confirm="yes"`) |
| `tf_exec_import` | ⚠ Mutating | Run `terraform import` (requires `confirm="yes"`) |
| `tf_exec_state_rm` | ⚠ Destructive | Remove resource from state (requires `confirm="yes"`) |
| `tf_exec_state_mv` | ⚠ Mutating | Move resource in state (requires `confirm="yes"`) |

### Codify tools (3)

| Tool | Description |
|---|---|
| `tf_codify` | Generate Terraform HCL from knowledge-graph nodes (filter by provider, type, region, or tag) |
| `tf_codify_subgraph` | Generate HCL for a resource and its N-hop dependency neighbourhood |
| `tf_generate_imports` | Generate `terraform import` commands in topological dependency order |

## CLI commands

All commands live under `espada terraform`:

```bash
espada terraform parse <state.json>       # Parse a state file
espada terraform plan-summary <plan.json> # Summarise a plan
espada terraform deps <resource-address>  # Show resource dependencies
espada terraform workspace list           # List workspaces
espada terraform workspace add <name>     # Register a workspace
espada terraform workspace remove <name>  # Remove a workspace
espada terraform lock-status              # Check state lock
espada terraform drift-history            # View drift detection history
espada terraform codify                   # Generate HCL from graph
espada terraform import-plan              # Generate import commands
```

## Gateway methods

For programmatic access via the Gateway WebSocket API:

| Method | Description |
|---|---|
| `terraform/workspaces` | List registered workspaces |
| `terraform/lock` | Check state lock status |
| `terraform/drift-history` | View drift detection history |
| `terraform/exec-init` | Run `terraform init` |
| `terraform/exec-plan` | Run `terraform plan` |
| `terraform/exec-apply` | Run `terraform apply` |
| `terraform/exec-destroy` | Run `terraform destroy` |
| `terraform/exec-state-list` | List resources in state |
| `terraform/exec-state-pull` | Pull state as JSON |
| `terraform/exec-version` | Check Terraform version |

## Example conversations

> "Show me what resources are in my Terraform state"

> "Run terraform plan and summarise the changes"

> "Check for drift between my state and actual infrastructure"

> "Generate Terraform HCL for all my AWS EC2 instances"

> "Create import commands for the resources in my knowledge graph"

> "Apply the Terraform plan — yes, I confirm"

## Destructive operation safety

Mutating commands (`apply`, `destroy`, `import`, `state rm`, `state mv`)
require explicit confirmation via a `confirm="yes"` parameter. The agent
will prompt you before executing any infrastructure-changing operation.

## Troubleshooting

**"Terraform not installed"** — the `tf_exec_version` tool checks for
the `terraform` binary. Install it from
[developer.hashicorp.com/terraform/install](https://developer.hashicorp.com/terraform/install).

**"State is locked"** — another process holds the state lock. Use
`tf_lock_status` to inspect, then `terraform force-unlock` if needed.

**Working directory** — CLI tools run in the working directory you
specify. Pass the `directory` parameter to point at your Terraform
project root.
