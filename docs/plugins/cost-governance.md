---
summary: "Cost Governance plugin: Infracost integration, budget management with threshold alerts, linear cost forecasting, and pre-built cost policy rules"
read_when:
  - You want to estimate infrastructure costs before deploying
  - You need to manage cloud spending budgets with alerts
  - You want to forecast future infrastructure costs
  - You need cost-based policy rules to gate infrastructure changes
  - You are integrating Infracost with Espada
---

# Cost Governance (plugin)

Cost visibility, budgeting, forecasting, and policy enforcement for
cloud infrastructure. Integrates with [Infracost](https://www.infracost.io/)
for real-time cost estimation from Terraform plans, provides budget
management with threshold alerts, linear cost forecasting, and
pre-built policy rules that gate infrastructure changes based on
spend thresholds.

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. **Infracost CLI** — installed and configured with an API key
   (`INFRACOST_API_KEY` environment variable) for cost estimation

## Install

```bash
espada plugins install @espada/cost-governance
```

Restart the Gateway afterwards.

---

## Agent tools

3 tools for estimating costs, checking budgets, and forecasting spend
through natural language:

### cost_estimate

Estimate infrastructure costs using Infracost. Provide a Terraform plan
or directory path to get a cost breakdown.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `directory` | string | Yes | Path to Terraform/IaC directory |
| `format` | string | No | `summary` or `detailed` (default: `summary`) |

**Output**: Total monthly and hourly cost, resource count. In `detailed`
mode, per-resource breakdown with sub-resource line items.

### cost_budget_status

Check budget status and utilization. Shows all budgets or filters by
scope.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | string | No | Filter by scope: `team`, `project`, `environment`, or `global` |
| `scopeId` | string | No | Scope identifier to filter by |

**Output**: Budget health status (ok/warning/critical/exceeded), current
spend vs limit, utilization percentage.

### cost_forecast

Forecast future infrastructure costs using linear extrapolation from
historical spending data.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `dataPoints` | array | Yes | Historical cost data points (at least 2). Each: `{ date: "YYYY-MM-DD", amount: number }` |
| `monthsAhead` | number | No | Months to forecast (default: 3) |

**Output**: Trend direction (increasing/stable/decreasing), current vs
projected cost, monthly projection table.

---

## CLI commands

All commands live under `espada cost`:

```
espada cost
├── estimate <directory>          Estimate costs via Infracost
│   --detailed                    Show per-resource breakdown
├── budget
│   ├── list                      List all budgets and their status
│   ├── set                       Create or update a budget
│   │   --name <name>             Budget name (required)
│   │   --scope <scope>           team, project, environment, global (required)
│   │   --scope-id <id>           Scope identifier (required)
│   │   --limit <amount>          Monthly spending limit (required)
│   │   --warning <pct>           Warning threshold % (default: 80)
│   │   --critical <pct>          Critical threshold % (default: 100)
│   └── status <scope> <scopeId>  Check a specific budget status
└── forecast                      Forecast future costs
    --months <n>                  Months ahead (default: 3)
```

### CLI examples

```bash
# Estimate costs for a Terraform directory
espada cost estimate ./infra/terraform

# Estimate with per-resource breakdown
espada cost estimate ./infra/terraform --detailed

# Create a budget for the platform team
espada cost budget set \
  --name "Platform Team" \
  --scope team \
  --scope-id platform \
  --limit 10000 \
  --warning 80 \
  --critical 95

# List all budgets
espada cost budget list

# Check budget status for a specific project
espada cost budget status project my-app

# Forecast costs 6 months ahead
espada cost forecast --months 6
```

---

## Gateway methods

3 gateway methods for programmatic access via the Gateway WebSocket API:

| Method | Parameters | Description |
|---|---|---|
| `cost/budgets` | — | List all budgets with status and utilization |
| `cost/budget/set` | `name`, `scope`, `scopeId`, `monthlyLimit`, `warningThreshold?`, `criticalThreshold?` | Create or update a budget |
| `cost/budget/spend` | `id`, `currentSpend` | Update current spend for a budget and get status |

---

## Budget management

Budgets track spending against limits with configurable alert
thresholds. Each budget has:

| Field | Type | Description |
|---|---|---|
| `id` | string | Auto-generated UUID |
| `name` | string | Human-readable name |
| `scope` | string | `team`, `project`, `environment`, or `global` |
| `scopeId` | string | Scope identifier (e.g. team name, project ID) |
| `monthlyLimit` | number | Monthly spending limit |
| `warningThreshold` | number | Warning at this utilization % (default: 80) |
| `criticalThreshold` | number | Critical at this utilization % (default: 100) |
| `currentSpend` | number | Current month spend |
| `currency` | string | Currency code (default: `USD`) |

### Budget statuses

| Status | Condition | Icon |
|---|---|---|
| **ok** | Utilization below warning threshold | ✅ |
| **warning** | Utilization at or above warning threshold | ⚠️ |
| **critical** | Utilization at or above critical threshold | 🔴 |
| **exceeded** | Utilization at or above 100% | 🚨 |

$$
\text{Utilization} = \frac{\text{Current Spend}}{\text{Monthly Limit}} \times 100
$$

Storage: budgets persist to `~/.espada/budgets.json`.

---

## Cost forecasting

Linear regression forecasting extrapolates future costs from historical
data points. Requires at least 2 data points.

Trend classification:
- **Increasing** — projected cost more than 5% above current
- **Stable** — projected cost within ±5% of current
- **Decreasing** — projected cost more than 5% below current

---

## Infracost integration

The extension wraps the Infracost CLI for two operations:

| Operation | CLI command | Description |
|---|---|---|
| **Breakdown** | `infracost breakdown --path <dir> --format json` | Full cost breakdown of current infrastructure |
| **Diff** | `infracost diff --path <dir> --format json` | Cost change between current and planned state |

Both operations parse the Infracost JSON output into structured types:

### CostBreakdown

| Field | Description |
|---|---|
| `totalMonthlyCost` | Aggregate monthly cost |
| `totalHourlyCost` | Aggregate hourly cost |
| `resources[]` | Per-resource costs (name, type, provider, monthly/hourly, sub-resources) |
| `currency` | Currency code |

### CostDiff

| Field | Description |
|---|---|
| `currentMonthlyCost` | Current monthly cost |
| `projectedMonthlyCost` | Projected monthly cost after changes |
| `deltaMonthlyCost` | Absolute cost change |
| `deltaPercent` | Percentage cost change |
| `resourceChanges[]` | Per-resource changes (create/update/delete/no-change with before/after costs) |

Provider detection: resource names starting with `aws_` → AWS,
`azurerm_` → Azure, `google_` → GCP.

---

## Cost policy rules

6 pre-built policy definitions that integrate with the Policy Engine
to gate infrastructure changes based on cost:

| Policy | Type | Default threshold | Action |
|---|---|---|---|
| **Cost delta limit** | `cost-delta-limit` | $500/mo increase | Deny |
| **High cost approval** | `high-cost-approval` | $200/mo projected | Require approval |
| **Cost percentage warning** | `cost-percent-warn` | 25% increase | Warn |
| **Destructive high-cost deny** | `destructive-high-cost` | $1,000/mo resource | Deny deletes |
| **New resource notification** | `new-resource-notify` | Any new resource | Notify |
| **Budget utilization** | `budget-utilization` | Configurable budget | Warn at 80%, deny at 100% |

### Policy factory functions

Each policy is created via a factory function with configurable
thresholds:

```typescript
// Deny changes that increase monthly cost by more than $500
createCostDeltaPolicy(500);

// Require approval for resources costing more than $200/mo
createHighCostApprovalPolicy(200);

// Warn when cost increase exceeds 25%
createCostPercentageWarnPolicy(25);

// Deny destructive changes on resources costing more than $1000/mo
createDestructiveHighCostPolicy(1000);

// Notify on any new resource creation
createNewResourceNotifyPolicy();

// Warn at 80% and deny at 100% of a $10,000/mo budget
createBudgetUtilizationPolicy(10000, 80, 100);
```

### Default policy library

`getDefaultCostPolicies()` returns a sensible starter set:
- Deny cost increases > $500/mo
- Require approval for resources > $200/mo
- Warn on increases > 25%
- Deny destructive changes on resources > $1,000/mo
- Notify on new resource creation

### Policy condition fields

Cost policies evaluate against these condition fields:

| Field | Description |
|---|---|
| `cost.current` | Current monthly cost |
| `cost.projected` | Projected monthly cost after changes |
| `cost.delta` | Cost change amount |
| `plan.totalCreates` | Number of resources being created |
| `plan.totalUpdates` | Number of resources being updated |
| `plan.totalDeletes` | Number of resources being deleted |

Policy actions: `deny` (block the change), `warn` (allow with warning),
`require_approval` (block until approved), `notify` (allow and alert).

---

## Example conversations

> "How much will this Terraform plan cost?"

> "Show me our budget status for all teams"

> "Is the platform team over budget?"

> "Forecast our infrastructure costs for the next 6 months"

> "Estimate the cost of deploying the new staging environment"

> "What's the monthly cost breakdown for our production infrastructure?"

> "Set a $5,000 monthly budget for the data team"

> "Show me a detailed cost estimate with per-resource breakdown"

---

## Troubleshooting

**"infracost: command not found"** — install the Infracost CLI:
`brew install infracost` (macOS) or see
[infracost.io/docs](https://www.infracost.io/docs/) for other platforms.
Set the `INFRACOST_API_KEY` environment variable.

**"No budgets found"** — budgets must be created first via
`espada cost budget set` or the `cost/budget/set` gateway method.

**Forecast returns empty** — at least 2 historical data points are
required for linear regression.

**Budget file location** — budgets persist at `~/.espada/budgets.json`.
Back up this file before migrations.

**Cost policies not enforcing** — cost policies integrate with the
Policy Engine extension. Ensure the policy-engine plugin is installed
and the cost policies are registered.
