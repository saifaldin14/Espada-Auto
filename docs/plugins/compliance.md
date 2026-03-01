---
summary: "Compliance Mapping plugin: scan infrastructure against SOC 2, CIS, HIPAA, PCI-DSS, GDPR, and NIST 800-53 frameworks with built-in controls, waiver management, and trend tracking"
read_when:
  - You want to run compliance scans against industry frameworks
  - You need to check SOC 2, HIPAA, PCI-DSS, CIS, GDPR, or NIST 800-53 compliance
  - You want compliance reports with violation details and remediation guidance
  - You need to manage compliance waivers
  - You are tracking compliance score trends over time
---

# Compliance Mapping (plugin)

Automated compliance scanning for cloud infrastructure. Evaluates
knowledge-graph nodes against six industry frameworks, detects
violations, generates scored reports with remediation guidance, and
tracks compliance trends over time.

The plugin evaluates live infrastructure data from the knowledge graph —
every resource node (compute, storage, database, network, identity,
etc.) is checked against framework-specific controls that inspect
metadata, tags, and configuration fields.

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. **Knowledge Graph plugin** — provides the resource nodes that
   compliance controls evaluate

## Install

```bash
espada plugins install @espada/compliance
```

Restart the Gateway afterwards.

---

## Supported frameworks

6 industry-standard compliance frameworks with built-in controls:

| Framework | ID | Version | Controls | Categories |
|---|---|---|---|---|
| **SOC 2 Type II** | `soc2` | 2017 | 6 | Data Protection, Access Control, Change Management, Logging & Monitoring |
| **CIS Benchmarks** | `cis` | 3.0 | 6 | Network Security, Key Management, Asset Management, Logging & Monitoring, Data Protection, Access Control |
| **HIPAA** | `hipaa` | 2013 | 5 | Data Protection, Access Control, Logging & Monitoring |
| **PCI-DSS** | `pci-dss` | 4.0 | 5 | Network Security, Access Control, Application Security, Data Protection, Logging & Monitoring |
| **GDPR** | `gdpr` | 2018 | 4 | Data Residency, Data Governance, Data Protection |
| **NIST 800-53** | `nist-800-53` | Rev. 5 | 7 | Access Control, Data Protection, Logging & Monitoring, Configuration Management, Monitoring, Incident Response |

### Built-in controls

Each control evaluates resource node metadata and tags. Examples:

| Control | Severity | Applicable to | Checks |
|---|---|---|---|
| Encryption at rest | High | storage, database, cache, queue | `encrypted`, `encryption_enabled`, or `kms_key_id` metadata |
| No public access | Critical | storage, database, compute, cache, queue, cluster | `public_access` and `publicly_accessible` must be false |
| Access logging enabled | Medium | storage, database, compute, load-balancer, gateway | `logging_enabled` or `access_logging` metadata |
| Backup enabled | High | database, storage, compute | `backup_enabled` or `backup_retention` metadata |
| Encryption in transit | Critical | database, storage, compute, load-balancer, gateway, cache | `ssl_enabled`, `tls_enabled`, or `encryption_in_transit` |
| Network segmentation | Critical | vpc, subnet, network, firewall, security-group | `segmented` or `network_policy` metadata |
| MFA / strong auth | Critical | identity, gateway, compute | `mfa_enabled` or `mfa_required` metadata |
| Key rotation | Medium | secret, database, storage | `key_rotation` or `rotation_period` metadata |
| Data residency | Critical | database, storage, compute, cache, queue | Region matches `approved_regions` list |
| Data classification tags | High | database, storage, queue | `data_classification` tag present |
| Retention policy | Medium | database, storage, queue | `retention_days` or `retention_policy` metadata |
| Required tags | Low | compute, storage, database, cache, queue, cluster, function, network, vpc, subnet, load-balancer | `owner` and `environment` tags present |
| System monitoring | Medium | compute, database, cluster, load-balancer | `monitoring_enabled` or `monitoring_agent` metadata |
| Web application firewall | High | load-balancer, gateway, cdn | `waf_enabled` metadata |

### Applicable resource types

22 resource types are supported: `compute`, `storage`, `database`,
`network`, `function`, `serverless-function`, `cache`, `queue`,
`cluster`, `container`, `cdn`, `dns`, `load-balancer`, `firewall`,
`gateway`, `secret`, `identity`, `logging`, `monitoring`, `vpc`,
`subnet`, `security-group`.

---

## Agent tools

4 tools for scanning, reporting, and managing compliance through
natural language:

### compliance_scan

Run a full compliance scan against a framework. Returns a scored
summary with pass/fail/waived/N/A counts and open violation count.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `framework` | string | Yes | Framework ID: `soc2`, `cis`, `hipaa`, `pci-dss`, `gdpr`, `nist-800-53` |
| `scope` | string | No | Scope description for report labeling |

**Output**: Score percentage with pass/fail/waived/N/A table and open
violation count with critical count.

### compliance_report

Generate a detailed compliance report in Markdown format with category
breakdowns, severity distribution, and per-violation remediation.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `framework` | string | Yes | Framework ID |
| `scope` | string | No | Scope description |

**Output**: Full Markdown report with summary table, by-category
breakdown, violations by severity, and per-violation detail (resource,
severity, status, description, remediation).

### compliance_violations

List open compliance violations with remediation guidance.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `framework` | string | Yes | Framework ID |
| `severity` | string | No | Filter: `critical`, `high`, `medium`, `low`, `info` |
| `status` | string | No | Filter: `open`, `waived`, `remediated`, `accepted` (default: `open`) |

**Output**: List of violations with control title, control ID, severity,
resource name and type, and remediation instructions.

### compliance_waiver

Add, list, or remove compliance waivers. Waivers mark a
control+resource pair as temporarily accepted.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | Yes | `add`, `list`, or `remove` |
| `controlId` | string | For add | Control ID to waive |
| `resourceId` | string | For add | Resource node ID |
| `reason` | string | For add | Reason for the waiver |
| `approvedBy` | string | No | Approver name (default: `system`) |
| `expiresInDays` | number | No | Days until expiry (default: 90) |
| `waiverId` | string | For remove | Waiver ID to remove |

---

## CLI commands

All commands live under `espada compliance`:

```
espada compliance
├── scan                          Run compliance scan
│   --framework <id>              Framework ID (required)
│   --json                        Output as JSON
├── report                        Generate formatted report
│   --framework <id>              Framework ID (required)
│   --format <fmt>                md or json (default: md)
├── violations
│   └── list                      List open violations
│       --framework <id>          Framework ID (required)
│       --severity <level>        Filter by severity
│       --type <resourceType>     Filter by resource type
├── waiver
│   ├── add                       Add a compliance waiver
│   │   --control <id>            Control ID (required)
│   │   --resource <id>           Resource node ID (required)
│   │   --reason <text>           Reason (required)
│   │   --approved-by <name>      Approver (default: operator)
│   │   --expires <days>          Days until expiry (default: 90)
│   ├── list                      List active waivers
│   └── remove <id>               Remove a waiver by ID
├── trend                         Show compliance score trend
│   --framework <id>              Framework ID (required)
│   --limit <n>                   Data points (default: 20)
│   --json                        Output as JSON
└── history                       List stored reports
    --framework <id>              Filter by framework
    --limit <n>                   Max reports (default: 10)
```

### CLI examples

```bash
# Run SOC 2 compliance scan
espada compliance scan --framework soc2

# Run HIPAA scan with JSON output
espada compliance scan --framework hipaa --json

# Generate a PCI-DSS Markdown report
espada compliance report --framework pci-dss

# List critical GDPR violations
espada compliance violations list --framework gdpr --severity critical

# List all open CIS violations for compute resources
espada compliance violations list --framework cis --type compute

# Add a waiver for a specific control on a resource
espada compliance waiver add \
  --control soc2-CC6.1 \
  --resource node-abc123 \
  --reason "Encryption upgrade scheduled for Q2" \
  --approved-by "security-team" \
  --expires 30

# List active waivers
espada compliance waiver list

# Remove a waiver
espada compliance waiver remove waiver-1234567890

# Show NIST 800-53 compliance trend (ASCII chart)
espada compliance trend --framework nist-800-53

# Show scan history filtered by framework
espada compliance history --framework soc2 --limit 5
```

---

## Gateway methods

3 gateway methods for programmatic access via the Gateway WebSocket API:

| Method | Parameters | Description |
|---|---|---|
| `compliance/scan` | `framework` | Run a full compliance scan and return the scored report |
| `compliance/report` | `framework` | Generate a Markdown report and return both markdown text and structured report |
| `compliance/violations` | `framework`, `status?`, `severity?` | List filtered violations |

---

## Scoring

Compliance scores are calculated as:

$$
\text{Score} = \frac{\text{Passed} + \text{Waived}}{\text{Passed} + \text{Failed} + \text{Waived}} \times 100
$$

Controls where no applicable resources exist are marked **N/A** and
excluded from the score. Waived controls count as passing for score
purposes.

Scores map to letter grades:

| Score | Grade |
|---|---|
| 90–100% | A |
| 80–89% | B |
| 70–79% | C |
| 60–69% | D |
| Below 60% | F |

---

## Waivers

Waivers let you temporarily accept a violation for a specific
control+resource pair. Each waiver tracks:

| Field | Description |
|---|---|
| `id` | Auto-generated waiver ID |
| `controlId` | The control being waived (e.g. `soc2-CC6.1`) |
| `resourceId` | The resource node ID |
| `reason` | Business justification |
| `approvedBy` | Who approved the waiver |
| `approvedAt` | ISO-8601 approval timestamp |
| `expiresAt` | ISO-8601 expiry timestamp (default: 90 days) |

Waived violations appear in reports with `⏸️ waived` status rather than
`open`. Expired waivers are automatically ignored — the violation
reverts to `open` status.

Storage: waivers are persisted to `~/.espada/compliance-waivers.json`.

---

## Report storage & trends

Scan reports are automatically saved for trend analysis. Storage is
persisted to `~/.espada/compliance-reports.json`.

The `trend` CLI command displays an ASCII chart showing score
progression over time with violation counts. Use this to track whether
compliance posture is improving, declining, or stable.

The `history` CLI command lists all stored reports with framework, score,
open violation count, and timestamp.

---

## Violation model

Each violation captures:

| Field | Description |
|---|---|
| `controlId` | Framework-specific control ID (e.g. `hipaa-164.312-a1`) |
| `controlTitle` | Human-readable control name |
| `framework` | Framework the violation belongs to |
| `resourceNodeId` | Knowledge graph node ID of the offending resource |
| `resourceName` | Human-readable resource name |
| `resourceType` | Resource type (e.g. `database`, `storage`) |
| `severity` | `critical`, `high`, `medium`, `low`, or `info` |
| `description` | What the control checks for |
| `remediation` | Step-by-step fix instructions |
| `status` | `open`, `waived`, `remediated`, or `accepted` |
| `detectedAt` | ISO-8601 detection timestamp |

---

## Example conversations

> "Run a SOC 2 compliance scan"

> "Show me all critical HIPAA violations"

> "Generate a PCI-DSS compliance report"

> "Are we GDPR compliant? Check our infrastructure"

> "Add a waiver for the encryption control on the prod database — we're upgrading next month"

> "What's our NIST 800-53 compliance trend over the last 10 scans?"

> "List all open violations across CIS benchmarks"

> "Show violations for storage resources under SOC 2"

---

## Troubleshooting

**"No graph nodes available"** — the knowledge graph is empty or the
knowledge-graph plugin is not installed. Populate the graph with
infrastructure data first (e.g. via AWS, Azure, or Kubernetes scans).

**Low scores on first scan** — this is expected. Many controls check for
metadata fields (encryption, logging, backup) that may not be populated
in the knowledge graph yet. As more infrastructure data flows in,
scores reflect the true posture.

**Waivers not taking effect** — ensure the `controlId` exactly matches
the framework-prefixed ID (e.g. `soc2-CC6.1`, not just `CC6.1`) and
the `resourceId` matches the knowledge graph node ID.

**Trend command shows no data** — reports are stored when running
`compliance scan` via the CLI. Run a few scans first to build trend
data.

**Report storage location** — reports are stored at
`~/.espada/compliance-reports.json` and waivers at
`~/.espada/compliance-waivers.json`. Both can be backed up or migrated.
