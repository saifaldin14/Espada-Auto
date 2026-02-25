# Compliance

Compliance framework extension for the Espada AI agent gateway.

## Overview

The Compliance extension provides a structured compliance evaluation framework for infrastructure managed through Espada. It supports defining controls, evaluating resources against compliance standards, generating reports, and managing waivers — enabling governance workflows directly from your AI agent.

## Features

- Compliance control definitions with severity levels
- Automated resource evaluation against control sets
- Detailed compliance reporting with pass/fail breakdowns
- Waiver management for acknowledged exceptions
- Persistent storage for evaluation history and audit trails
- CLI commands for compliance operations
- Agent-facing tools for on-demand compliance checks
- Support for custom and industry-standard control frameworks

## Installation

```bash
cd extensions/compliance
pnpm install
```

## Configuration

```yaml
extensions:
  compliance:
    controls_path: ~/.espada/compliance/controls
    storage:
      backend: sqlite
      path: ~/.espada/compliance.db
```

## Usage

Run a compliance evaluation:

```bash
espada compliance evaluate --framework cis-aws --scope production
espada compliance report --format html --output compliance-report.html
```

Manage waivers:

```bash
espada compliance waiver add --control CIS-2.1 --reason "Mitigated by compensating control" --expires 2026-06-01
espada compliance waiver list
```

## Architecture

| Module      | Purpose                                |
| ----------- | -------------------------------------- |
| `controls`  | Control definitions and loading        |
| `evaluator` | Resource evaluation engine             |
| `reporter`  | Report generation (JSON, HTML, etc.)   |
| `waivers`   | Waiver lifecycle management            |
| `storage`   | Persistent evaluation storage          |
| `tools`     | Agent-facing compliance tools          |
| `cli`       | CLI commands                           |
| `types`     | Shared type definitions                |

## License

MIT
