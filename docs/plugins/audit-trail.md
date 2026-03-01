---
summary: "Audit Trail plugin: enterprise-grade audit logging with persistent SQLite storage, buffered writes, sensitive field redaction, and queryable history"
read_when:
  - You want audit logging for Espada operations
  - You need to track who did what, when, and to which resources
  - You want compliance-ready audit event export (JSON/CSV)
  - You are configuring or developing the audit trail extension
---

# Audit Trail (plugin)

Enterprise-grade audit logging for Espada. Every operation — tool
invocations, commands, authentication events, resource changes, policy
evaluations, Terraform runs, and more — is captured as a structured
audit event with actor, resource, severity, and result metadata.

Events are stored in a persistent SQLite database (or in-memory for
testing), with buffered writes, automatic sensitive field redaction,
retention-based pruning, and full query/export capabilities.

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured

## Install

```bash
espada plugins install @espada/audit-trail
```

Restart the Gateway afterwards.

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `storage.type` | string | `sqlite` | Storage backend: `sqlite` or `memory` |
| `storage.path` | string | `~/.espada/audit.db` | SQLite database file path |
| `retentionDays` | number | `90` | Days to keep events before auto-pruning |
| `flushIntervalMs` | number | `1000` | Buffer flush interval (ms) |
| `maxBufferSize` | number | `100` | Max buffered events before forced flush |

---

## Event model

Every audit event captures:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique event ID (UUID) |
| `timestamp` | string | ISO-8601 timestamp |
| `eventType` | string | Category of event (see below) |
| `severity` | string | `info`, `warn`, `error`, or `critical` |
| `actor` | object | Who performed the action (id, name, roles, IP, channel, agentId) |
| `operation` | string | What was done (e.g. `tool:aws_ec2`, `auth:login`) |
| `resource` | object | Target resource (type, id, provider) — optional |
| `parameters` | object | Operation parameters (sensitive fields auto-redacted) |
| `result` | string | `success`, `failure`, `pending`, or `denied` |
| `correlationId` | string | Links related events across a workflow |
| `sessionId` | string | Associates events to a session |
| `durationMs` | number | Operation duration in milliseconds |
| `metadata` | object | Additional context (sensitive fields auto-redacted) |

### Event types

25 event types covering all Espada operations:

| Category | Event types |
|---|---|
| **Operations** | `command_executed`, `tool_invoked` |
| **Auth** | `auth_login`, `auth_logout`, `auth_failed` |
| **Resources** | `resource_created`, `resource_updated`, `resource_deleted` |
| **Policy & Approval** | `policy_evaluated`, `approval_requested`, `approval_granted`, `approval_denied` |
| **State & Config** | `state_changed`, `config_changed` |
| **Security** | `alert_triggered`, `break_glass_activated`, `drift_detected` |
| **RBAC** | `role_assigned`, `role_removed` |
| **Governance** | `policy_created`, `policy_deleted`, `compliance_scanned` |
| **Infrastructure** | `blueprint_deployed`, `terraform_plan`, `terraform_apply` |

### Sensitive field redaction

Parameters and metadata are automatically scanned for sensitive keys.
Matching values are replaced with `[REDACTED]` before storage.

Default sensitive field patterns: `password`, `secret`, `token`,
`apiKey`, `api_key`, `accessKey`, `access_key`, `secretKey`,
`secret_key`, `privateKey`, `private_key`, `credential`,
`authorization`.

---

## Agent tools

3 tools for querying, exploring, and summarizing audit events through
natural language.

| Tool | Description |
|---|---|
| `audit_query` | Search audit events by time range, event type, actor, resource, severity, result, or operation. Supports pagination with `limit`. |
| `audit_timeline` | Show the chronological audit trail for a specific resource — what has happened to this resource over time. |
| `audit_summary` | Get an aggregated summary for a time period (1h, 24h, 7d, 30d or custom range) — event counts by type, severity, result, top actors, and top resources. |

### audit_query parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `startDate` | string | No | ISO-8601 start date |
| `endDate` | string | No | ISO-8601 end date |
| `eventType` | string | No | Filter by event type |
| `actorId` | string | No | Filter by actor ID |
| `resourceType` | string | No | Filter by resource type |
| `severity` | string | No | `info`, `warn`, `error`, or `critical` |
| `result` | string | No | `success`, `failure`, `pending`, or `denied` |
| `operation` | string | No | Search by operation name (partial match) |
| `limit` | number | No | Max results (default 25) |

### audit_timeline parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `resourceId` | string | Yes | The resource ID to get the timeline for |
| `limit` | number | No | Max events (default 25) |

### audit_summary parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `period` | string | No | `1h`, `24h`, `7d`, or `30d` (default `24h`) |
| `startDate` | string | No | Custom ISO-8601 start (overrides period) |
| `endDate` | string | No | Custom ISO-8601 end (overrides period) |

---

## CLI commands

All commands live under `espada audit`:

```
espada audit
├── list [options]        List recent audit events
│   --since <date>        Start date (ISO-8601 or relative: 24h, 7d, 30m)
│   --until <date>        End date (ISO-8601)
│   --type <type>         Filter by event type
│   --actor <id>          Filter by actor ID
│   --resource <type>     Filter by resource type
│   --severity <level>    Filter by severity
│   --result <result>     Filter by result
│   -n, --limit <n>       Max results (default 25)
├── show <eventId>        Show full details of a specific event
├── summary [options]     Aggregated activity summary
│   --period <period>     Time period: 1h, 24h, 7d, 30d (default 24h)
│   --since <date>        Custom start date (overrides period)
│   --until <date>        Custom end date
├── export [options]      Export events for compliance
│   --format <format>     json or csv (default json)
│   --since <date>        Start date
│   --until <date>        End date
│   --type <type>         Filter by event type
│   -n, --limit <n>       Max results (default 1000)
├── count                 Show total number of stored events
├── retention [days]      Set retention period in days
└── prune                 Remove events older than retention period
```

### CLI examples

```bash
# List recent events
espada audit list

# List auth failures in the last 7 days
espada audit list --type auth_failed --since 7d

# Show full details of an event
espada audit show abc12345-...

# Get a 24-hour summary
espada audit summary

# Get a 30-day summary
espada audit summary --period 30d

# Export last 7 days as CSV for compliance
espada audit export --format csv --since 7d > audit-report.csv

# Export as JSON (for piping to jq or other tools)
espada audit export --since 24h | jq '.[] | select(.severity == "critical")'

# Check how many events are stored
espada audit count

# Prune old events
espada audit prune
```

---

## Gateway methods

4 gateway methods for programmatic access via the Gateway WebSocket API:

| Method | Parameters | Description |
|---|---|---|
| `audit/query` | `startDate`, `endDate`, `eventTypes`, `actorIds`, `resourceTypes`, `severity`, `result`, `operation`, `limit`, `offset` | Query audit events with filters |
| `audit/timeline` | `resourceId`, `limit` | Get chronological event timeline for a resource |
| `audit/summary` | `startDate`, `endDate` | Get aggregated summary for a time range |
| `audit/export` | `format` (json/csv), plus all query filter params | Export events for compliance |

---

## Programmatic API

The `AuditLogger` class is available to other extensions via the service
registry. It provides convenience methods for common event types:

| Method | Description |
|---|---|
| `log(input)` | Log any audit event |
| `logToolInvocation(actor, toolName, params, result, durationMs?, correlationId?)` | Log a tool invocation |
| `logCommand(actor, command, params, result, durationMs?)` | Log a command execution |
| `logAuth(actor, action, method, severity?)` | Log login, logout, or failed auth |
| `logResourceChange(actor, action, resource, details?, correlationId?)` | Log resource creation, update, or deletion |
| `logPolicyEvaluation(actor, policyId, resource, result, details?)` | Log a policy evaluation |
| `logConfigChange(actor, key, previousValue, newValue)` | Log a configuration change |
| `logTerraform(actor, action, details, result, durationMs?)` | Log a Terraform plan or apply |
| `query(filter)` | Query events with filters |
| `getById(id)` | Get a specific event by ID |
| `getTimeline(resourceId, limit?)` | Get resource event timeline |
| `getActorActivity(actorId, limit?)` | Get all actions by an actor |
| `getSummary(startDate, endDate)` | Aggregated summary for a time range |
| `exportEvents(filter)` | Export events as JSON string |
| `exportCSV(filter)` | Export events as CSV string |
| `prune()` | Remove events older than retention period |

---

## Storage backends

| Backend | Use case | Persistence | Performance |
|---|---|---|---|
| **SQLite** (default) | Production | Persistent file at `~/.espada/audit.db` | Optimised with indexes, buffered writes |
| **In-memory** | Testing, CI/CD | Session only | Fastest, no disk I/O |

The SQLite backend uses buffered writes (configurable via
`flushIntervalMs` and `maxBufferSize`) to minimise I/O overhead.
Events are flushed automatically on query to ensure consistency.

---

## Example conversations

> "Show me all audit events from the last 24 hours"

> "Who made changes to the production database yesterday?"

> "Show the audit timeline for resource vpc-12345"

> "Give me an audit summary for the last 7 days"

> "List all failed authentication attempts"

> "What Terraform applies happened this week?"

> "Show all critical severity events"

> "Export the last 30 days of audit events as CSV"

## Troubleshooting

**"No audit events found"** — events are buffered. If querying
immediately after an operation, the buffer may not have flushed yet.
Events flush every 1 second by default or when the buffer reaches 100
events.

**SQLite file permissions** — ensure the process has write access to the
configured storage path (default `~/.espada/audit.db`).

**Large database** — if the audit database grows large, adjust
`retentionDays` (default 90) and run `espada audit prune` to clean up
old events.

**Missing events from other extensions** — other extensions must
integrate with the audit logger via the programmatic API. The audit
trail extension does not automatically capture events from extensions
that don't emit them.
