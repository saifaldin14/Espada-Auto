---
summary: "Alerting Integration plugin: ingest PagerDuty, OpsGenie, and CloudWatch webhooks, route alerts to channels, and view dashboards"
read_when:
  - You want to ingest alerts from PagerDuty, OpsGenie, or CloudWatch
  - You need to route alerts to Slack, Discord, Teams, or other channels
  - You are configuring or developing the Alerting Integration extension
---

# Alerting Integration (plugin)

Third-party alerting integration for Espada. Ingest webhooks from
PagerDuty, OpsGenie, and AWS CloudWatch Alarms, normalise them into a
unified alert format, route to messaging channels via configurable
rules, and monitor everything through a real-time dashboard.

Current capabilities:
- **Webhook parsing** — PagerDuty (V2 + V3), OpsGenie, CloudWatch (direct + SNS-wrapped)
- **Auto-detection** — automatically identify the alert provider from payload shape
- **Normalisation** — unified 15-field alert model across all providers
- **Routing engine** — priority-ordered rules with AND conditions (equals, contains, regex, any)
- **Channel dispatch** — Slack, Discord, Microsoft Teams, Telegram, Matrix, webhook, custom
- **Deduplication** — prevent duplicate alerts from webhook retries
- **Dashboard** — aggregated stats by provider, severity, status, and dispatch success rate

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. Webhook endpoints configured in your alerting provider(s)

## Install

```bash
espada plugins install @espada/alerting-integration
```

Restart the Gateway afterwards.

## Quick start

A typical setup flow through the agent:

```
1. Register a channel     → "Add a Slack channel called #ops-critical"
2. Create a routing rule  → "Route all critical alerts to #ops-critical"
3. Ingest webhooks        → Alerts flow in from PagerDuty/OpsGenie/CloudWatch
4. View the dashboard     → "Show me the alerting dashboard"
```

## Agent tools

The plugin registers **8 agent tools**:

| Tool | Description |
|---|---|
| `alerting_ingest` | Ingest a raw webhook payload. Auto-detects provider, parses into normalised alert, deduplicates, evaluates routing rules, and dispatches to matched channels. |
| `alerting_list_alerts` | List ingested alerts with optional filters: provider, severity, status, service, since. |
| `alerting_get_alert` | Get full details of a single alert by ID, including dispatch history. |
| `alerting_add_route` | Add a routing rule with priority, AND conditions, channel targets, optional message template, and stop-on-match. |
| `alerting_list_routes` | List all routing rules sorted by priority. |
| `alerting_remove_route` | Remove a routing rule by ID. |
| `alerting_add_channel` | Register a dispatch channel (Slack, Discord, Teams, Telegram, Matrix, webhook, or custom). |
| `alerting_dashboard` | Aggregated dashboard: alert counts by provider/severity/status, dispatch success rate, recent alerts. |

## Supported providers

### PagerDuty

Supports both V2 and V3 webhook formats. Maps urgency to severity
(`high` → `critical`, `low` → `low`) and event types to status
(`incident.triggered`, `incident.acknowledged`, `incident.resolved`).

### OpsGenie

Maps OpsGenie actions to status (`Create` → `triggered`,
`Acknowledge` → `acknowledged`, `Close` → `resolved`) and priorities
to severity (`P1` → `critical` through `P5` → `info`).

### CloudWatch Alarms

Supports direct CloudWatch payloads and SNS-wrapped messages. Maps
alarm states (`ALARM` → `triggered`, `OK` → `resolved`,
`INSUFFICIENT_DATA` → `triggered`) and infers severity from metric
names (CPU/error/5xx metrics → `high`).

## Routing rules

Routing rules control which channels receive which alerts. Rules are
evaluated in priority order (lower number = higher priority).

### Conditions

Each rule can have multiple conditions (AND logic). Supported operators:

| Operator | Description | Example |
|---|---|---|
| `equals` | Exact match | `severity equals critical` |
| `contains` | Substring match (case-insensitive) | `title contains database` |
| `regex` | Regular expression match | `service regex ^api-.*` |
| `any` | Always matches | Catch-all rules |

### Condition fields

Conditions can match against any normalised alert field:

`id`, `externalId`, `provider`, `severity`, `status`, `title`,
`description`, `service`, `environment`, `raisedAt`, `receivedAt`,
`sourceUrl`, `tags`

### Message templates

Routes support custom message templates with `{{field}}` placeholders:

```
🚨 {{title}} — {{service}} ({{environment}})
Severity: {{severity}} | Status: {{status}}
Provider: {{provider}} | Link: {{sourceUrl}}
```

If no template is specified, a rich default format with severity emojis
is used.

### Stop-on-match

Set `stopOnMatch: true` on a rule to prevent lower-priority rules from
being evaluated when this rule matches. Useful for catch-all fallback
rules.

## Channel types

| Type | Description |
|---|---|
| `slack` | Slack channel via incoming webhook |
| `discord` | Discord channel via webhook |
| `msteams` | Microsoft Teams via connector webhook |
| `telegram` | Telegram chat via bot API |
| `matrix` | Matrix room |
| `webhook` | Generic HTTP webhook |
| `custom` | Custom channel with arbitrary config |

Register a channel with provider-specific config:

```
Agent: "Add a Slack channel called #incidents with webhook URL https://hooks.slack.com/..."
```

## Deduplication

Webhook retries are automatically deduplicated. If an alert with the
same `provider` + `externalId` combination already exists, the ingest
tool returns the existing alert ID and skips re-routing. This applies
to both the agent tool and the gateway method.

## Gateway methods

| Method | Description |
|---|---|
| `alerting/ingest` | Ingest a raw webhook payload (with deduplication) |
| `alerting/routes` | List routing rules sorted by priority |
| `alerting/dashboard` | Aggregated alert dashboard |
| `alerting/alerts` | List/filter alerts |

## Normalised alert schema

Every ingested alert is normalised to this schema:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique alert ID (`alert-<uuid>`) |
| `externalId` | string | ID from the originating provider |
| `provider` | string | `pagerduty`, `opsgenie`, or `cloudwatch` |
| `severity` | string | `critical`, `high`, `medium`, `low`, `info` |
| `status` | string | `triggered`, `acknowledged`, `resolved`, `suppressed` |
| `title` | string | Human-readable one-liner |
| `description` | string | Longer description or body |
| `service` | string | Affected service or resource name |
| `environment` | string | Environment hint (production, staging, etc.) |
| `raisedAt` | string | ISO-8601 timestamp from the source |
| `receivedAt` | string | ISO-8601 timestamp of ingestion |
| `sourceUrl` | string | Link to the alert in the provider's dashboard |
| `details` | object | Provider-specific key-value details |
| `rawPayload` | unknown | Original webhook payload (for audit) |
| `tags` | string[] | Labels or tags from the provider |

## Example conversations

> "Add a Slack channel called #ops-critical"

> "Create a routing rule: route all critical PagerDuty alerts to #ops-critical"

> "Ingest this PagerDuty webhook payload"

> "List all triggered alerts from the last hour"

> "Get the details for alert alert-abc123"

> "Show me the alerting dashboard"

> "Remove the catch-all routing rule"

> "Route CloudWatch alarms with 'CPU' in the title to the #infra channel"

## Troubleshooting

**"Unable to detect alert provider"** — the auto-detection checks for
provider-specific payload shapes. Pass `provider` explicitly if
detection fails.

**"Invalid channel type"** — supported types are `slack`, `discord`,
`msteams`, `telegram`, `matrix`, `webhook`, `custom`.

**"Unknown channel IDs"** — register channels with `alerting_add_channel`
before referencing them in routing rules.

**Duplicate alerts** — this is normal. The deduplication logic returns
the existing alert on retry. Check `duplicate: true` in the response.

**No dispatches** — verify that routing rules match the alert's fields
and that the rules reference valid channel IDs. Use
`alerting_list_routes` to inspect active rules.
