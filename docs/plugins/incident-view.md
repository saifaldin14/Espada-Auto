---
summary: "Incident View plugin: normalise alerts from AWS, Azure, GCP, and Kubernetes into a unified view with correlation, triage, and timeline"
read_when:
  - You want a unified view of incidents across cloud providers
  - You need to correlate related alerts from different sources
  - You are configuring or developing the Incident View extension
---

# Incident View (plugin)

Cross-cloud unified incident view for Espada. Normalises raw alerts from
AWS CloudWatch, Azure Monitor, GCP Cloud Monitoring, and Kubernetes
Events into a single format, then provides correlation, triage
prioritisation, timeline construction, and filtering.

Current capabilities:
- **Normalisation** — 8 source-specific normalisers across 4 cloud providers
- **Correlation** — group related incidents by temporal proximity, shared resource, region, or cascade
- **Triage** — priority-ordered incident queue (severity → status → recency)
- **Timeline** — chronological state-change history
- **Summary** — dashboard-style aggregation by status, severity, cloud, and source
- **Filtering** — query by cloud, source, severity, status, date range, resource, or free text

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. Cloud credentials for the providers you want to ingest alerts from

## Install

```bash
espada plugins install @espada/incident-view
```

Restart the Gateway afterwards.

## Agent tools

The plugin registers **6 agent tools**:

| Tool | Description |
|---|---|
| `incident_normalize` | Normalise raw cloud alerts into a unified incident format. Supports AWS CloudWatch Alarms, AWS X-Ray Insights, Azure Monitor Alerts, Azure Activity Logs, GCP Alert Policies, GCP Uptime Checks, Kubernetes Events, and custom sources. |
| `incident_summary` | Dashboard-style summary: totals by status, severity, cloud provider, source type, plus MTTR calculation |
| `incident_correlate` | Identify groups of related incidents using five correlation strategies |
| `incident_triage` | Return incidents sorted by triage priority (severity → status → recency) |
| `incident_timeline` | Build a chronological timeline of incident state changes |
| `incident_filter` | Filter incidents by cloud, source, severity, status, date range, resource, or free-text search |

## Supported sources

The normalisation engine handles 8 source types:

| Source | Cloud | Normaliser |
|---|---|---|
| CloudWatch Alarm | AWS | `normalizeAwsAlarm` |
| X-Ray Insight | AWS | `normalizeAwsInsight` |
| Azure Monitor Alert | Azure | `normalizeAzureAlert` |
| Azure Activity Log | Azure | `normalizeAzureActivityLog` |
| GCP Alert Policy | GCP | `normalizeGcpAlertPolicy` |
| GCP Uptime Check | GCP | `normalizeGcpUptimeCheck` |
| Kubernetes Event | K8s | `normalizeK8sEvent` |
| Custom | Any | `normalizeCustom` |

Each normaliser maps provider-specific fields (severity names, status
labels, timestamps, resource identifiers) into the unified
`UnifiedIncident` schema.

## Correlation strategies

`incident_correlate` groups incidents using five strategies:

| Strategy | Description |
|---|---|
| `temporal-proximity` | Incidents occurring within a configurable time window |
| `shared-resource` | Incidents referencing the same resource identifier |
| `shared-region` | Incidents in the same cloud region |
| `cross-cloud-resource` | Related resources across different cloud providers |
| `cascade` | Incident sequences that suggest cascading failures |

## Gateway methods

| Method | Description |
|---|---|
| `incident/normalize` | Normalise raw incident data |
| `incident/summary` | Aggregated incident summary |
| `incident/correlate` | Correlate related incidents |

## Example conversations

> "Normalise these CloudWatch alarms and Azure alerts into a unified view"

> "Show me a summary of all incidents in the last 24 hours"

> "Correlate related incidents — are any of these alerts connected?"

> "Triage the open incidents by priority"

> "Build a timeline of the database outage"

> "Filter incidents for the us-east-1 region with critical severity"

## Unified incident schema

Every normalised incident contains:

| Field | Description |
|---|---|
| `id` | Unique incident ID (UUID-based) |
| `cloud` | Source cloud provider (`aws`, `azure`, `gcp`, `k8s`, `custom`) |
| `source` | Source type (e.g. `cloudwatch-alarm`, `azure-alert`) |
| `severity` | Normalised severity (`critical`, `high`, `medium`, `low`, `info`) |
| `status` | Normalised status (`open`, `acknowledged`, `resolved`, `suppressed`) |
| `title` | Human-readable summary |
| `description` | Detailed description |
| `resource` | Affected resource identifier |
| `region` | Cloud region |
| `raisedAt` | ISO-8601 timestamp from the source |
| `receivedAt` | ISO-8601 timestamp of ingestion |
| `raw` | Original payload for audit |

## Troubleshooting

**Unrecognised source type** — pass the `source` field explicitly when
normalising. Supported values: `cloudwatch-alarm`, `xray-insight`,
`azure-alert`, `azure-activity-log`, `gcp-alert-policy`,
`gcp-uptime-check`, `k8s-event`, `custom`.

**Missing fields in normalised output** — the normaliser uses sensible
defaults for missing fields. Check the raw payload for provider-specific
field names.
