---
summary: "DR Analysis plugin: disaster recovery posture scoring, recovery plan generation, gap detection, and Knowledge Graph integration for AWS/Azure/GCP infrastructure"
read_when:
  - You want to assess your disaster recovery posture
  - You need to generate a recovery plan for a failure scenario
  - You want to find resources lacking DR protection
  - You are planning multi-region failover strategies
  - You need RTO/RPO estimates for your infrastructure
---

# Disaster Recovery Analysis (plugin)

Automated disaster recovery posture assessment for cloud
infrastructure. Analyzes knowledge-graph topology to score backup
coverage, replication breadth, single-point-of-failure risks, and
cross-region distribution. Generates recovery plans for failure
scenarios with step-by-step procedures and RTO/RPO estimates.

The plugin integrates with the Knowledge Graph to evaluate live
infrastructure data — every resource node and its relationships
(backups, replicas, failover targets) are analyzed to produce a
scored DR posture with actionable recommendations.

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. **Knowledge Graph plugin** — provides the infrastructure topology
   that DR analysis evaluates

## Install

```bash
espada plugins install @espada/dr-analysis
```

Restart the Gateway afterwards.

---

## Supported providers

| Provider | ID |
|---|---|
| AWS | `aws` |
| Azure | `azure` |
| GCP | `gcp` |

Resources from other providers (e.g. `kubernetes`, `custom`) are
filtered out during Knowledge Graph sync.

---

## Agent tools

3 tools for assessing DR posture, generating recovery plans, and
finding protection gaps through natural language:

### dr_posture

Analyze overall disaster recovery posture. Scores backup coverage,
replication, SPOF risks, and cross-region distribution. Returns a
grade (A–F) with recommendations.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter by cloud provider (`aws`, `azure`, `gcp`) |
| `region` | string | No | Filter by region |

**Output**: Grade (A–F), score (0–100), single-region risks,
unprotected critical resource count, recommendations with severity
and effort, recovery time estimates per resource.

### dr_plan

Generate a recovery plan for a specific failure scenario with
step-by-step procedures, dependency ordering, and RTO/RPO estimates.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scenario` | string | Yes | `region-failure`, `az-failure`, `service-outage`, or `data-corruption` |
| `region` | string | No | Target region for region/AZ failures |

**Output**: Affected resource count, estimated RTO and RPO in minutes,
ordered recovery steps (action, resource, duration, dependencies,
manual/auto), and dependency groups.

### dr_gaps

List resources lacking DR protection — no backups, no replication,
no failover capability.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `resourceType` | string | No | Filter by resource type (e.g. `database`, `storage`) |

**Output**: Total gap count and list of unprotected resources with ID,
name, type, provider, and region.

---

## CLI commands

All commands live under `espada dr`:

```
espada dr
├── posture                     Analyze DR posture and get score/grade
│   --provider <p>              Filter by cloud provider
│   --region <r>                Filter by region
├── plan                        Generate recovery plan
│   --scenario <s>              Scenario (required): region-failure,
│                               az-failure, service-outage, data-corruption
│   --region <r>                Target region
└── gaps                        List resources lacking DR protection
    --type <t>                  Filter by resource type
```

### CLI examples

```bash
# Analyze overall DR posture
espada dr posture

# Analyze DR posture for AWS only
espada dr posture --provider aws

# Analyze DR posture for a specific region
espada dr posture --region us-east-1

# Generate a recovery plan for a region failure
espada dr plan --scenario region-failure --region us-east-1

# Generate a plan for data corruption
espada dr plan --scenario data-corruption

# List all unprotected resources
espada dr gaps

# List unprotected databases only
espada dr gaps --type database
```

---

## Gateway methods

1 gateway method for programmatic access via the Gateway WebSocket API:

| Method | Parameters | Description |
|---|---|---|
| `dr/analysis` | `provider?`, `region?` | Run a full DR analysis synced from the Knowledge Graph. Returns grade, score, risks, recommendations, and recovery time estimates. |

Response statuses:
- `ok` — analysis complete with results
- `no_kg` — Knowledge Graph data not loaded
- `no_data` — no infrastructure nodes match the filters
- `error` — analysis failed

---

## Scoring

DR posture is scored 0–100 using five weighted dimensions:

| Dimension | Weight | What it measures |
|---|---|---|
| **Backup coverage** | 25% | Percentage of critical resources with backup edges |
| **Replication breadth** | 25% | Percentage of critical resources with replication edges |
| **SPOF count** | 20% | Penalizes unprotected critical resources (single points of failure) |
| **Cross-region distribution** | 15% | Penalizes single-region deployments with high-risk regions |
| **Recovery plan existence** | 15% | Percentage of resources with failover or replication edges |

$$
\text{Score} = \sum_{i} w_i \times s_i
$$

where $w_i$ is the dimension weight and $s_i$ is the dimension score (0–100).

### Grades

| Score | Grade |
|---|---|
| 90–100 | A |
| 80–89 | B |
| 70–79 | C |
| 60–69 | D |
| Below 60 | F |

---

## Critical resource types

7 resource types are considered critical and require DR protection:

`database`, `storage`, `queue`, `stream`, `cache`, `cluster`, `compute`

Resources of these types without backup or replication edges are
flagged as unprotected.

---

## Failure scenarios

4 failure scenarios are supported for recovery plan generation:

| Scenario | Affected resources |
|---|---|
| `region-failure` | All resources in the target region (or all if no region specified) |
| `az-failure` | Approximately 1/3 of resources in the target region |
| `service-outage` | All critical resource types (database, storage, queue, etc.) |
| `data-corruption` | Database and storage resources only |

---

## Recovery plans

Recovery plans include ordered steps with dependency tracking:

| Field | Description |
|---|---|
| `scenario` | The failure scenario being addressed |
| `affectedResources` | Resources impacted by the failure |
| `recoverySteps[]` | Ordered recovery actions |
| `estimatedRTO` | Maximum recovery time across all steps (minutes) |
| `estimatedRPO` | Maximum data loss window across all resources (minutes) |
| `dependencies` | Steps grouped by dependency level for parallel execution |

### Recovery step ordering

Steps are ordered by resource criticality:

1. Databases (restore from backup/replica)
2. Storage (restore from backup)
3. Cache (rebuild cluster)
4. Queues (recreate message queue)
5. Compute (launch replacement instances)
6. Clusters (rebuild container cluster — **manual**)

### RTO estimates

Base RTO varies by resource type and backup strategy:

| Resource type | No backup | Snapshot | Replication | Multi-region |
|---|---|---|---|---|
| Database | 180 min | 60 min | 30 min | 12 min |
| Storage | 90 min | 30 min | 15 min | 6 min |
| Compute | 45 min | 15 min | 8 min | 3 min |
| Cache | 30 min | 10 min | 5 min | 2 min |
| Queue | 60 min | 20 min | 10 min | 4 min |
| Cluster | 135 min | 45 min | 23 min | 9 min |

### RPO estimates

RPO depends on replication status:

| Replication | RPO |
|---|---|
| Active-active | 0 min |
| Synchronous | 1 min |
| Asynchronous | 15 min |
| None | 1,440 min (24 hours) |

---

## Graph relationships

The analyzer inspects these edge relationship types:

| Category | Relationship types | Purpose |
|---|---|---|
| **Backup** | `backs-up`, `backed-by` | Identifies resources with backups |
| **Replication** | `replicates-to`, `replicates` | Identifies replicated resources |
| **Failover** | `fails-over-to` | Identifies failover targets |
| **Monitoring** | `monitors`, `monitored-by` | Identifies monitored resources |

---

## Recommendations

The analyzer generates prioritized recommendations in 5 categories:

| Category | Severity | Trigger |
|---|---|---|
| **backup** | Critical | Critical resource with no backup or replication |
| **failover** | Critical | Region with critical resources and no failover |
| **monitoring** | High | Critical resources lacking monitoring edges |
| **replication** | Medium | Resources with backup but no replication |
| **redundancy** | Low | Non-critical resources in single-region deployments |

Each recommendation includes:
- **severity** — `critical`, `high`, `medium`, or `low`
- **category** — backup, replication, failover, redundancy, monitoring
- **description** — what needs to be fixed
- **affectedResources** — list of resource IDs
- **estimatedCost** — approximate monthly cost to remediate (USD)
- **effort** — `low`, `medium`, or `high`

---

## Knowledge Graph bridge

The extension integrates with the Knowledge Graph via
`KnowledgeGraphBridge`:

- **Automatic sync** — on service start, the bridge resolves the KG
  engine and performs an initial sync
- **Periodic refresh** — re-syncs from the Knowledge Graph every
  30 minutes
- **Provider filtering** — only AWS, Azure, and GCP nodes are
  imported; Kubernetes and custom providers are filtered out
- **Push API** — external callers can inject data via `setGraphData()`

---

## Example conversations

> "What's our disaster recovery posture?"

> "Show me the DR score for our AWS infrastructure"

> "Generate a recovery plan for a region failure in us-east-1"

> "Which resources don't have DR protection?"

> "What would happen if us-west-2 went down?"

> "Show me unprotected databases"

> "What's our estimated RTO for a data corruption scenario?"

> "How can we improve our DR score?"

---

## Troubleshooting

**"No infrastructure nodes loaded"** — the Knowledge Graph is empty
or the knowledge-graph plugin is not active. Populate the graph via
AWS, Azure, or GCP infrastructure scans first.

**Low scores on first analysis** — scores depend on backup, replication,
and failover relationships in the Knowledge Graph. If these edges
haven't been discovered yet, scores will be artificially low.

**"Knowledge Graph not available"** — the KG plugin must be installed
and started before the DR analysis service. The bridge resolves the
KG engine at service start time.

**Filtered resources** — only `aws`, `azure`, and `gcp` providers are
analyzed. Resources from `kubernetes` or `custom` providers are
excluded from DR scoring.

**Recovery plan shows all steps as manual** — cluster-type resources
are marked as manual recovery steps. Other resource types are
marked as automated.
