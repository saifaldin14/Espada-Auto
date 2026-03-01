---
summary: "Diagnostics OpenTelemetry plugin: exports Espada metrics, traces, and logs to any OTLP-compatible collector (Grafana, Datadog, Honeycomb, Jaeger, etc.)"
read_when:
  - You want to export Espada telemetry to an OpenTelemetry collector
  - You need metrics, traces, or logs for Espada in Grafana, Datadog, Honeycomb, or Jaeger
  - You are setting up observability for your Espada deployment
  - You want to monitor token usage, costs, webhook latency, or queue depth
---

# Diagnostics OpenTelemetry (plugin)

Exports Espada's internal diagnostics events as OpenTelemetry metrics,
traces, and logs to any OTLP-compatible collector. Supports HTTP/protobuf
transport to backends such as Grafana Cloud, Datadog, Honeycomb, Jaeger,
and self-hosted OpenTelemetry Collectors.

The plugin subscribes to Espada's diagnostic event bus and translates
12 event types into structured OTel signals — counters, histograms,
spans, and log records.

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. **An OTLP-compatible collector** — any endpoint accepting
   `http/protobuf` (e.g. Grafana Alloy, OpenTelemetry Collector,
   Datadog Agent, Honeycomb)

## Install

```bash
espada plugins install @espada/diagnostics-otel
```

Restart the Gateway afterwards.

---

## Configuration

Enable the exporter in the Espada diagnostics config:

```yaml
diagnostics:
  enabled: true
  otel:
    enabled: true
    endpoint: "http://otel-collector:4318"
    protocol: "http/protobuf"
    serviceName: "espada"
    traces: true
    metrics: true
    logs: true                     # opt-in, disabled by default
    sampleRate: 1.0                # 0.0–1.0 (trace sampling ratio)
    flushIntervalMs: 5000          # metric/log export interval
    headers:                       # optional auth headers
      Authorization: "Bearer <token>"
```

| Key | Type | Default | Description |
|---|---|---|---|
| `diagnostics.enabled` | boolean | `false` | Master switch for diagnostics |
| `diagnostics.otel.enabled` | boolean | `false` | Enable OTel export |
| `diagnostics.otel.endpoint` | string | — | OTLP collector endpoint (or `OTEL_EXPORTER_OTLP_ENDPOINT` env var) |
| `diagnostics.otel.protocol` | string | `http/protobuf` | Transport protocol (only `http/protobuf` supported) |
| `diagnostics.otel.serviceName` | string | `espada` | OTel service name (or `OTEL_SERVICE_NAME` env var) |
| `diagnostics.otel.traces` | boolean | `true` | Export distributed traces |
| `diagnostics.otel.metrics` | boolean | `true` | Export metrics |
| `diagnostics.otel.logs` | boolean | `false` | Export log records (opt-in) |
| `diagnostics.otel.sampleRate` | number | `1.0` | Trace sampling ratio (0.0–1.0) |
| `diagnostics.otel.flushIntervalMs` | number | — | Export interval for metrics and logs (minimum 1000ms) |
| `diagnostics.otel.headers` | object | — | HTTP headers sent with every export request (e.g. auth tokens) |

### Endpoint resolution

The plugin auto-appends signal paths if the endpoint doesn't already
contain `/v1/`:

| Signal | Resolved URL |
|---|---|
| Traces | `{endpoint}/v1/traces` |
| Metrics | `{endpoint}/v1/metrics` |
| Logs | `{endpoint}/v1/logs` |

---

## Exported metrics

17 metrics covering model usage, costs, webhooks, message processing,
queue behavior, and session health:

### Token & cost metrics

| Metric | Type | Unit | Description |
|---|---|---|---|
| `espada.tokens` | Counter | 1 | Token usage by type (`input`, `output`, `cache_read`, `cache_write`, `prompt`, `total`) |
| `espada.cost.usd` | Counter | 1 | Estimated model cost in USD |
| `espada.run.duration_ms` | Histogram | ms | Agent run duration |
| `espada.context.tokens` | Histogram | 1 | Context window size (`limit`) and usage (`used`) |

### Webhook metrics

| Metric | Type | Unit | Description |
|---|---|---|---|
| `espada.webhook.received` | Counter | 1 | Webhook requests received |
| `espada.webhook.error` | Counter | 1 | Webhook processing errors |
| `espada.webhook.duration_ms` | Histogram | ms | Webhook processing duration |

### Message processing metrics

| Metric | Type | Unit | Description |
|---|---|---|---|
| `espada.message.queued` | Counter | 1 | Messages queued for processing |
| `espada.message.processed` | Counter | 1 | Messages processed by outcome |
| `espada.message.duration_ms` | Histogram | ms | Message processing duration |

### Queue metrics

| Metric | Type | Unit | Description |
|---|---|---|---|
| `espada.queue.depth` | Histogram | 1 | Queue depth on enqueue/dequeue |
| `espada.queue.wait_ms` | Histogram | ms | Queue wait time before execution |
| `espada.queue.lane.enqueue` | Counter | 1 | Lane enqueue events |
| `espada.queue.lane.dequeue` | Counter | 1 | Lane dequeue events |

### Session metrics

| Metric | Type | Unit | Description |
|---|---|---|---|
| `espada.session.state` | Counter | 1 | Session state transitions |
| `espada.session.stuck` | Counter | 1 | Sessions stuck in processing |
| `espada.session.stuck_age_ms` | Histogram | ms | Age of stuck sessions |

### Run metrics

| Metric | Type | Unit | Description |
|---|---|---|---|
| `espada.run.attempt` | Counter | 1 | Run attempts (with attempt number) |

---

## Exported traces (spans)

When traces are enabled, the following spans are created from
diagnostic events:

| Span name | Source event | Key attributes |
|---|---|---|
| `espada.model.usage` | `model.usage` | provider, model, channel, session, token counts |
| `espada.webhook.processed` | `webhook.processed` | channel, webhook type, chatId |
| `espada.webhook.error` | `webhook.error` | channel, webhook type, error message (ERROR status) |
| `espada.message.processed` | `message.processed` | channel, outcome, session, chatId, messageId |
| `espada.session.stuck` | `session.stuck` | session, state, queue depth, age (ERROR status) |

Spans include duration when available, using back-calculated start
times. Error spans are marked with `SpanStatusCode.ERROR`.

### Trace sampling

Configure `sampleRate` (0.0–1.0) to control trace volume. Uses
`ParentBasedSampler` with `TraceIdRatioBasedSampler` — child spans
inherit the parent's sampling decision.

---

## Exported logs

When `logs: true` is set, all Espada log output is forwarded as OTel
log records via `BatchLogRecordProcessor`.

Each log record includes:

| Attribute | Description |
|---|---|
| `espada.log.level` | Log level name (TRACE, DEBUG, INFO, WARN, ERROR, FATAL) |
| `espada.logger` | Logger name |
| `espada.logger.parents` | Parent logger chain (dot-separated) |
| `espada.{key}` | Structured bindings from log context |
| `code.filepath` | Source file path |
| `code.lineno` | Source line number |
| `code.function` | Source function name |
| `espada.code.location` | Full file path with line number |

Severity mapping:

| Log level | OTel severity number |
|---|---|
| TRACE | 1 |
| DEBUG | 5 |
| INFO | 9 |
| WARN | 13 |
| ERROR | 17 |
| FATAL | 21 |

---

## Diagnostic event types

12 event types from Espada's diagnostic event bus are processed:

| Event type | Signals produced |
|---|---|
| `model.usage` | Counters (tokens, cost), histogram (duration, context), span |
| `webhook.received` | Counter |
| `webhook.processed` | Histogram (duration), span |
| `webhook.error` | Counter, error span |
| `message.queued` | Counter, histogram (queue depth) |
| `message.processed` | Counter, histogram (duration), span |
| `queue.lane.enqueue` | Counter, histogram (queue depth) |
| `queue.lane.dequeue` | Counter, histogram (queue depth, wait time) |
| `session.state` | Counter |
| `session.stuck` | Counter, histogram (stuck age), error span |
| `run.attempt` | Counter |
| `diagnostic.heartbeat` | Histogram (queue depth) |

---

## Common metric attributes

Most metrics include these attributes for filtering and grouping:

| Attribute | Description |
|---|---|
| `espada.channel` | Channel name (e.g. `telegram`, `slack`, `discord`) |
| `espada.provider` | LLM provider (e.g. `openai`, `anthropic`) |
| `espada.model` | Model name |
| `espada.sessionKey` | Session key |
| `espada.sessionId` | Session ID |
| `espada.token` | Token type for token counters |
| `espada.outcome` | Message processing outcome |
| `espada.lane` | Queue lane name |
| `espada.state` | Session state |

---

## Backend setup examples

### Grafana Cloud (OTLP)

```yaml
diagnostics:
  enabled: true
  otel:
    enabled: true
    endpoint: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp"
    headers:
      Authorization: "Basic <base64-encoded-instance-id:token>"
    traces: true
    metrics: true
    logs: true
```

### Self-hosted OpenTelemetry Collector

```yaml
diagnostics:
  enabled: true
  otel:
    enabled: true
    endpoint: "http://otel-collector:4318"
    traces: true
    metrics: true
    logs: false
```

### Honeycomb

```yaml
diagnostics:
  enabled: true
  otel:
    enabled: true
    endpoint: "https://api.honeycomb.io"
    headers:
      x-honeycomb-team: "<your-api-key>"
    traces: true
    metrics: true
```

---

## Troubleshooting

**No data appearing in collector** — verify `diagnostics.enabled` and
`diagnostics.otel.enabled` are both `true`. Check that the endpoint is
reachable from the Espada host.

**"unsupported protocol" warning** — only `http/protobuf` is supported.
gRPC transport is not available.

**High cardinality** — metrics are scoped by channel, provider, and
model. If you have many models or channels, consider using trace
sampling (`sampleRate < 1.0`) and disabling logs export.

**Logs not appearing** — log export is opt-in. Set `logs: true`
explicitly in the OTel config.

**Missing spans** — traces are enabled by default but require the
diagnostic events to include duration data. Ensure the source events
emit `durationMs`.

**Flush interval** — the minimum export interval is 1000ms. Values
below 1000 are clamped to 1000.
