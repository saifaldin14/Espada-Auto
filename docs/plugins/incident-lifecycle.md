---
summary: "Incident Lifecycle plugin: structured incident management with phase-driven state machine, classification, triage, remediation, rollback, and post-mortem"
read_when:
  - You want structured incident management with Espada
  - You need automated classification, remediation, or post-mortem generation
  - You are configuring or developing the Incident Lifecycle extension
---

# Incident Lifecycle (plugin)

Structured incident lifecycle management for Espada. Tracks incidents
through a seven-phase state machine — from detection through
classification, triage, remediation, rollback, post-mortem, and
closure — with automated severity classification, cross-cloud
remediation strategies, and post-mortem report generation.

Current capabilities:
- **State machine** — enforced phase transitions with audit trail
- **Classification** — auto-detect category, severity, and blast radius
- **Triage** — priority assignment, owner, escalation, time estimates
- **Remediation** — 9 strategy types with dry-run support
- **Rollback** — 7 rollback strategies for failed remediations
- **Post-mortem** — automated timeline, root cause, impact, action items
- **Dashboard** — filter by phase, cloud, severity; MTTR and success rates

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured

## Install

```bash
espada plugins install @espada/incident-lifecycle
```

Restart the Gateway afterwards.

## Lifecycle phases

Incidents progress through a strict state machine:

```
detected → classified → triaged → remediating → rolling-back → post-mortem → closed
```

| Phase | Description |
|---|---|
| `detected` | Initial state — incident has been identified |
| `classified` | Category, severity, and blast radius determined |
| `triaged` | Priority, owner, and escalation assigned |
| `remediating` | Active remediation in progress |
| `rolling-back` | Remediation failed; rollback underway |
| `post-mortem` | Incident resolved; post-mortem review generated |
| `closed` | Lifecycle complete |

Only valid transitions are allowed. For example, you cannot jump from
`detected` directly to `remediating` — classification and triage must
happen first.

## Agent tools

The plugin registers **8 agent tools**:

| Tool | Description |
|---|---|
| `lifecycle_create` | Create a new lifecycle instance. Starts at the `detected` phase. Accepts title, description, cloud provider, region, resource, and raw alert data. |
| `lifecycle_classify` | Classify a detected incident: auto-detects category from 10 types, assigns severity, estimates blast radius. Transitions `detected → classified`. |
| `lifecycle_triage` | Triage a classified incident: assign priority (P1–P5), owner, escalation chain, and estimated remediation time. Transitions `classified → triaged`. |
| `lifecycle_remediate` | Plan and execute remediation with auto-detected strategy. Supports `dryRun` mode. Transitions `triaged → remediating`. |
| `lifecycle_rollback` | Plan rollback for a failed remediation. Auto-selects rollback strategy. Transitions `remediating → rolling-back`. |
| `lifecycle_postmortem` | Generate a post-mortem report: timeline, root cause analysis, impact assessment, and action items. Transitions to `post-mortem`. |
| `lifecycle_close` | Close an incident lifecycle. Transitions `post-mortem → closed` or `triaged → closed`. |
| `lifecycle_dashboard` | View dashboard with filters by phase, cloud, severity. Shows MTTR, remediation success rate, and phase distributions. |

## Incident categories

Classification auto-detects from 10 incident categories:

| Category | Examples |
|---|---|
| `compute` | EC2 instance failures, pod crashes, VM stops |
| `network` | VPC issues, DNS failures, load balancer errors |
| `storage` | S3 access errors, disk full, volume detach |
| `database` | RDS failures, connection pool exhaustion |
| `security` | Unauthorised access, IAM policy violations |
| `deployment` | Failed deployments, rollback triggers |
| `scaling` | Auto-scaling failures, capacity limits |
| `certificate` | TLS/SSL certificate expiry or errors |
| `dns` | DNS resolution failures |
| `custom` | Other incident types |

## Remediation strategies

The `lifecycle_remediate` tool auto-selects from 9 remediation
strategies based on the incident's cloud provider and category:

| Strategy | Cloud | Description |
|---|---|---|
| `aws-reconciliation` | AWS | Reconcile AWS resource state |
| `k8s-rollout-restart` | K8s | Restart Kubernetes deployment rollout |
| `k8s-scale` | K8s | Scale Kubernetes workload replicas |
| `helm-rollback` | K8s | Roll back a Helm release to a previous revision |
| `azure-slot-swap` | Azure | Swap Azure deployment slots |
| `azure-traffic-shift` | Azure | Shift Azure Traffic Manager weights |
| `terraform-apply` | Any | Apply Terraform configuration |
| `custom-runbook` | Any | Execute a custom runbook |
| `manual` | Any | Manual remediation steps |

Each strategy generates concrete remediation steps. Use `dryRun: true`
to preview what would happen without executing.

## Rollback strategies

If remediation fails, `lifecycle_rollback` selects from 7 rollback
strategies:

`k8s-rollout-undo`, `helm-rollback`, `azure-slot-swap`,
`azure-traffic-shift`, `terraform-apply`, `custom-runbook`, `manual`

## Gateway methods

| Method | Description |
|---|---|
| `lifecycle/create` | Create a new lifecycle instance |
| `lifecycle/classify` | Classify a detected incident |
| `lifecycle/dashboard` | View lifecycle dashboard |
| `lifecycle/remediate` | Execute remediation |
| `lifecycle/postmortem` | Generate post-mortem report |

## Example conversations

> "Create an incident for the database connection pool exhaustion on RDS in us-east-1"

> "Classify this incident — what category and severity is it?"

> "Triage the incident: assign it P1, owner=alice, escalate to the database team"

> "Remediate the incident — do a dry run first"

> "The remediation failed. Roll back."

> "Generate a post-mortem for incident INC-001"

> "Show me the incident lifecycle dashboard filtered by critical severity"

## Post-mortem reports

The `lifecycle_postmortem` tool generates structured reports containing:

- **Timeline** — chronological record of all phase transitions
- **Root cause analysis** — identified root cause and contributing factors
- **Impact assessment** — affected services, users, and duration
- **Remediation review** — what was attempted, what worked, what failed
- **Action items** — concrete follow-up tasks with owners and deadlines

## Dashboard metrics

The `lifecycle_dashboard` aggregates:

| Metric | Description |
|---|---|
| Total incidents | Count by phase, cloud, and severity |
| MTTR | Mean Time To Remediate across closed incidents |
| Remediation success rate | Percentage of successful remediations |
| Phase distribution | How many incidents are in each phase |
| Recent incidents | Last 10 incidents with current phase |

## Troubleshooting

**"Invalid phase transition"** — incidents must follow the state machine
order. Check the current phase with `lifecycle_dashboard` and apply the
correct next action.

**"Incident not found"** — verify the incident ID. Use
`lifecycle_dashboard` to list all tracked incidents.

**Dry-run mode** — always use `dryRun: true` on `lifecycle_remediate`
first to preview remediation steps before executing.
