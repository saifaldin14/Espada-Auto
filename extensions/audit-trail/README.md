# Audit Trail

Comprehensive audit logging extension for the Espada AI agent gateway.

## Overview

The Audit Trail extension provides structured audit logging for all agent interactions, tool invocations, and administrative actions within Espada. It supports pluggable storage backends including in-memory (for development) and SQLite (for production), enabling full traceability and compliance readiness.

## Features

- Structured audit event logging for agent actions and tool calls
- SQLite-backed persistent storage for production deployments
- In-memory store for development and testing
- CLI commands for querying and exporting audit logs
- Configurable retention policies and log rotation
- Tool integration for agent-accessible audit queries
- Typed event schema with timestamps, actors, and outcomes

## Installation

```bash
cd extensions/audit-trail
pnpm install
```

## Configuration

Configure the storage backend in your Espada configuration:

```yaml
extensions:
  audit-trail:
    backend: sqlite          # or "memory"
    sqlite:
      path: ~/.espada/audit.db
    retention:
      days: 90
```

## Usage

Enable the extension in your Espada configuration. Once active, all agent interactions are automatically logged.

Query audit logs via CLI:

```bash
espada audit-trail search --actor user@example.com --since 2025-01-01
espada audit-trail export --format json --output audit-export.json
```

## Architecture

| Module         | Purpose                            |
| -------------- | ---------------------------------- |
| `logger`       | Core audit event emitter           |
| `memory-store` | In-memory backend (dev/testing)    |
| `sqlite-store` | SQLite persistent backend          |
| `tools`        | Agent-facing audit query tools     |
| `cli`          | CLI commands for log management    |
| `types`        | Shared type definitions            |

## License

MIT
