# DR Analysis

Disaster recovery analysis and scoring for the Espada AI agent gateway.

## Overview

The DR Analysis extension assesses disaster recovery readiness of infrastructure managed through Espada. It analyzes recovery capabilities, scores DR posture across multiple dimensions, and integrates with the knowledge graph for topology-aware risk assessment.

## Features

- Automated DR posture analysis and scoring
- Multi-dimensional recovery assessment (RPO, RTO, backup coverage)
- Knowledge graph integration for topology-aware analysis
- Risk scoring with actionable recommendations
- CLI commands for DR reports and trend tracking
- Agent-facing tools for on-demand DR queries
- Historical DR score tracking and comparison

## Installation

```bash
cd extensions/dr-analysis
pnpm install
```

## Configuration

```yaml
extensions:
  dr-analysis:
    scoring:
      rpo_weight: 0.3
      rto_weight: 0.3
      backup_weight: 0.2
      redundancy_weight: 0.2
```

## Usage

Run a DR analysis:

```bash
espada dr-analysis run --scope production
espada dr-analysis report --format json
espada dr-analysis score --environment staging
```

## Architecture

| Module      | Purpose                                |
| ----------- | -------------------------------------- |
| `analyzer`  | Core DR analysis engine                |
| `scoring`   | Multi-dimensional scoring system       |
| `kg-bridge` | Knowledge graph integration            |
| `tools`     | Agent-facing DR tools                  |
| `cli`       | CLI commands                           |
| `types`     | Shared type definitions                |

## License

MIT
