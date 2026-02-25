# Cost Governance

Cost estimation, budget management, and FinOps governance for Espada.

## Overview

The Cost Governance extension brings financial accountability to infrastructure managed through the Espada gateway. It integrates with Infracost for cost estimation, provides budget tracking and alerting, and enforces FinOps governance policies to prevent cost overruns before they happen.

## Features

- Infrastructure cost estimation via Infracost integration
- Budget definition and tracking per project or environment
- Cost threshold alerts and policy enforcement
- FinOps governance rules with approval workflows
- Historical cost trend analysis and reporting
- Agent-facing tools for cost queries and budget checks
- Pre-deployment cost impact analysis

## Installation

```bash
cd extensions/cost-governance
pnpm install
```

## Configuration

```yaml
extensions:
  cost-governance:
    infracost:
      api_key: your-infracost-api-key
    budgets:
      - name: production
        monthly_limit: 5000
        alert_threshold: 0.8
```

## Usage

Estimate costs for a planned change:

```bash
espada cost estimate --path ./infrastructure
espada cost budget status --project production
```

The agent can also check costs before applying infrastructure changes, blocking deployments that exceed budget thresholds.

## License

MIT
