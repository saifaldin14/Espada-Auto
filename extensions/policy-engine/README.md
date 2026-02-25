# Policy Engine

Policy enforcement engine for the Espada AI agent gateway.

## Overview

The Policy Engine extension provides a rule-based policy enforcement system for infrastructure managed through Espada. Define policies using a declarative rule library, evaluate resources against policy sets, and enforce governance guardrails — ensuring infrastructure changes comply with organizational standards.

## Features

- Declarative policy rule definitions with conditions and actions
- Built-in policy library covering common governance patterns
- Real-time policy evaluation against infrastructure changes
- Pre-deployment policy gates (block, warn, or allow)
- Policy exception and override management
- Persistent storage for policy state and evaluation history
- CLI commands for policy management and testing
- Agent-facing tools for policy queries and enforcement
- Integration with compliance and audit-trail extensions

## Installation

```bash
cd extensions/policy-engine
pnpm install
```

## Configuration

```yaml
extensions:
  policy-engine:
    library_path: ~/.espada/policies
    enforcement: strict   # strict | advisory
    storage:
      backend: sqlite
      path: ~/.espada/policies.db
```

## Usage

Manage and evaluate policies:

```bash
espada policy list
espada policy evaluate --scope production --format json
espada policy test --rule no-public-s3 --resource s3://my-bucket
```

## Architecture

| Module        | Purpose                              |
| ------------- | ------------------------------------ |
| `engine`      | Core policy evaluation engine        |
| `library`     | Built-in policy rule catalog         |
| `integration` | Cross-extension integrations         |
| `storage`     | Persistent policy state storage      |
| `tools`       | Agent-facing policy tools            |
| `cli`         | CLI commands                         |
| `types`       | Shared type definitions              |

## License

MIT
