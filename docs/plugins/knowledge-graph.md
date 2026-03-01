---
summary: "Knowledge Graph plugin: multi-cloud infrastructure topology, blast radius analysis, drift detection, cost governance, IQL queries, temporal snapshots, MCP server, and HTTP API"
read_when:
  - You want to visualize and query your cloud infrastructure as a graph
  - You need blast radius, drift detection, or SPOF analysis
  - You need compliance auditing, cost attribution, or supply chain reports
  - You want temporal snapshots, time-travel queries, or infrastructure diffs
  - You are configuring or developing the Knowledge Graph extension
---

# Knowledge Graph (plugin)

Infrastructure intelligence for Espada. Discovers resources across AWS,
Azure, GCP, Kubernetes, and Terraform, builds a live topology graph, and
exposes 31 agent tools, 24 CLI commands, 3 gateway methods, an MCP
server, and an HTTP API for blast radius analysis, drift detection, cost
governance, compliance auditing, temporal snapshots, and natural language
infrastructure queries.

Backed by 44 test files and 1 428 tests.

Current capabilities:

- **Multi-cloud discovery** — AWS, Azure, GCP, Kubernetes, Terraform, cross-cloud relationship detection
- **Topology graph** — 40+ resource types, 40+ relationship types, 9 cloud providers (incl. hybrid: Azure Arc, GDC, VMware, Nutanix)
- **Blast radius** — impact analysis with downstream dependency tracking and cost-at-risk
- **Drift detection** — field-level configuration drift, shadow IT, zombie state
- **SPOF analysis** — single points of failure via Tarjan's algorithm with blast radius scoring
- **Cost governance** — per-resource, per-group, per-provider cost attribution and orphan detection
- **IQL queries** — Infrastructure Query Language: FIND, SUMMARIZE, PATH, AT, DIFF, WHERE
- **Natural language** — ask questions in plain English, auto-translated to IQL
- **Compliance** — SOC 2, HIPAA, PCI-DSS, ISO 27001 framework assessments
- **Governance** — change requests with risk scoring, auto/manual approval, policy violations
- **Temporal** — point-in-time snapshots, time travel, snapshot diffs, node history, evolution trends
- **Monitoring** — scheduled sync, CloudTrail/Activity Log/Audit Log event sources, 5 built-in alert rules
- **Supply chain** — container images, SBOM packages, CVE scanning
- **Remediation** — generates Terraform HCL or CloudFormation YAML patches for drift
- **Visualization** — Cytoscape.js / D3.js export with layout strategies
- **RBAC** — role-based access control (viewer / operator / admin / superadmin)
- **Multi-agent governance** — agent modelling, conflict detection, cost allocation, budget alerts
- **MCP server** — Model Context Protocol over stdio for Claude Desktop, Cursor, Windsurf, Cody, Continue
- **HTTP API** — REST endpoints for scan, query, topology, compliance, cost, drift, export
- **Standalone binary** — `infra-graph` CLI usable outside Espada

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. **Cloud credentials** for at least one provider (AWS CLI, `az` CLI, `gcloud`, kubeconfig, or Terraform state)

## Install

The Knowledge Graph plugin is **bundled** with Espada and enabled by
default. No separate installation is needed.

To verify it is active:

```bash
espada plugins list
```

If you need to enable it manually:

```bash
espada config set plugins.entries.knowledge-graph.enabled true
```

Restart the Gateway afterwards.

## Config

Configure under `plugins.entries.knowledge-graph.config`:

```bash
# Storage type (sqlite or memory)
espada config set plugins.entries.knowledge-graph.config.storage.type sqlite

# Storage path
espada config set plugins.entries.knowledge-graph.config.storage.path ~/.espada/knowledge-graph.db

# Light sync interval (minutes, default: 15)
espada config set plugins.entries.knowledge-graph.config.sync.intervalMinutes 15

# Full sync interval (hours, default: 6)
espada config set plugins.entries.knowledge-graph.config.sync.fullSyncIntervalHours 6

# Drift detection during sync (default: true)
espada config set plugins.entries.knowledge-graph.config.sync.enableDriftDetection true

# Adapters to enable (default: ["aws"])
espada config set plugins.entries.knowledge-graph.config.adapters '["aws","azure","gcp","kubernetes"]'
```

| Key | Type | Default | Description |
|---|---|---|---|
| `storage.type` | string | `sqlite` | Storage backend: `sqlite` or `memory` |
| `storage.path` | string | `~/.espada/knowledge-graph.db` | SQLite database file path |
| `sync.intervalMinutes` | number | `15` | Light sync interval for critical resource types |
| `sync.fullSyncIntervalHours` | number | `6` | Full sync interval with drift detection |
| `sync.enableDriftDetection` | boolean | `true` | Run drift detection during full sync |
| `adapters` | string[] | `["aws"]` | Cloud adapters to activate |

### Background sync

The plugin runs two background sync cycles:

1. **Light sync** — every 15 minutes (configurable). Scans critical resource
   types only (compute, database, container, cluster, load-balancer, function)
   for fast change detection.
2. **Full sync** — every 6 hours (configurable). Discovers all resource types
   and runs drift detection when enabled.

## Discovery adapters

Six adapters discover resources and relationships from different sources:

| Adapter | Provider | Discovers |
|---|---|---|
| AWS | `aws` | EC2, RDS, S3, Lambda, ECS, EKS, VPC, IAM, ELB, CloudFront, Route 53, SQS, SNS, and more |
| Azure | `azure` | VMs, App Service, AKS, SQL, Storage, VNet, Key Vault, Front Door, and more |
| GCP | `gcp` | Compute Engine, GKE, Cloud SQL, Cloud Storage, VPC, Cloud Functions, Pub/Sub, and more |
| Kubernetes | `kubernetes` | Namespaces, Deployments, StatefulSets, DaemonSets, Services, Ingress, ConfigMaps, PVs, CronJobs |
| Terraform | `terraform` | Parses `terraform.tfstate` files for any provider |
| Cross-cloud | `cross-cloud` | Detects relationships between resources across different providers (DNS → LB, peering, shared secrets) |

## CLI commands

### `espada graph` commands (13)

```bash
espada graph status                     # Graph statistics (nodes, edges, cost)
espada graph sync                       # Full discovery sync (--provider)
espada graph blast <resourceId>         # Blast radius analysis (-d depth)
espada graph deps <resourceId>          # Dependency chain (-d direction, --depth)
espada graph orphans                    # Orphan detection
espada graph spofs                      # Single points of failure
espada graph cost                       # Cost attribution (--group, --provider, --top)
espada graph drift                      # Drift detection (--provider)
espada graph path <from> <to>           # Shortest path between resources
espada graph clusters                   # Connected resource clusters
espada graph critical                   # Critical nodes (high fan-in/fan-out, --top N)
espada graph export                     # Export topology (-f json|dot|mermaid, --provider)
espada graph timeline <resourceId>      # Change timeline for a resource (--limit)
```

### `espada infra` commands (11)

```bash
espada infra scan                       # Scan Terraform state (--terraform, --db, -o format)
espada infra report                     # Generate report (--focus full|orphans|spof|cost|untagged)
espada infra drift                      # Compare Terraform state vs live AWS
espada infra cloud-scan                 # Multi-cloud discovery (--aws, --azure, --gcp, --k8s)
espada infra audit                      # Change audit trail (--initiator, --type, --since)
espada infra monitor                    # Continuous monitoring (--interval 5min|15min|hourly|daily)
espada infra timeline                   # Timeline view (--diff, --cost-trend, --node <id>)
espada infra snapshot                   # Snapshot manager (--action create|list|diff|history|evolution)
espada infra query "<IQL>"              # Execute IQL query (--db, --output, --limit)
```

#### `infra cloud-scan` options

Scans live cloud resources across multiple providers in a single command:

```bash
espada infra cloud-scan \
  --aws --aws-region us-east-1,eu-west-1 --aws-profile prod \
  --azure --azure-subscription <id> \
  --gcp --gcp-project my-project \
  --k8s --k8s-context prod-cluster --k8s-namespaces "app,data" \
  --cross-cloud \
  -o markdown --top 30
```

| Flag | Description |
|---|---|
| `--aws` | Enable AWS scanning |
| `--aws-region <regions>` | Comma-separated AWS regions |
| `--aws-profile <profile>` | AWS CLI profile |
| `--azure` | Enable Azure scanning |
| `--azure-subscription <id>` | Azure subscription ID |
| `--gcp` | Enable GCP scanning |
| `--gcp-project <id>` | GCP project ID |
| `--k8s` | Enable Kubernetes scanning |
| `--k8s-context <ctx>` | Kubernetes context |
| `--k8s-namespaces <ns>` | Comma-separated namespaces |
| `--cross-cloud` | Discover cross-cloud relationships (default: on) |
| `-o <format>` | Output: `terminal`, `markdown`, `html`, `json`, `mermaid`, `dot` |
| `--save` | Persist graph to SQLite |

#### `infra monitor` options

Continuous monitoring with alert dispatch:

```bash
espada infra monitor \
  --db infra-graph.db \
  --interval hourly \
  --aws --aws-region us-east-1 \
  --cloudtrail \
  --webhook https://hooks.slack.com/... \
  --once      # Single cycle then exit
```

Supports three cloud event sources:

| Event source | Flag | Description |
|---|---|---|
| AWS CloudTrail | `--cloudtrail` | Mutation events from CloudTrail |
| Azure Activity Log | `--activity-log` | Azure resource change events |
| GCP Audit Log | `--audit-log` | GCP Cloud Audit Log events |

Five built-in alert rules:

| Alert | Category | Severity | Triggers when |
|---|---|---|---|
| Orphan alert | `orphan` | warning | New resources with zero relationships |
| SPOF alert | `spof` | critical | Articulation points detected in topology |
| Cost anomaly | `cost-anomaly` | warning | Unexpected cost changes exceed threshold |
| Unauthorized change | `unauthorized-change` | critical | Changes by unknown or unapproved initiator |
| Disappeared | `disappeared` | warning | Resource disappears between scans |

Alert destinations: console and webhook URL.

#### IQL query examples

```bash
# Find all AWS resources
espada infra query "FIND resources WHERE provider = 'aws'"

# Find expensive resources
espada infra query "FIND resources WHERE cost > 500"

# Find resources missing the Owner tag
espada infra query "FIND resources WHERE NOT tagged('Owner')"

# Summarize cost by provider and type
espada infra query "SUMMARIZE cost BY provider, resourceType"

# Find path between resources
espada infra query "FIND PATH FROM 'aws:*:*:load-balancer:*' TO 'aws:*:*:database:*'"

# Compare infrastructure at two dates
espada infra query "FIND resources AT '2025-01-01' DIFF WITH NOW"

# Find downstream dependencies
espada infra query "FIND downstream OF 'vpc-abc123' WHERE depth <= 3"
```

IQL supports: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `IN`, `MATCHES`, `AND`, `OR`, `NOT`

Built-in functions: `tagged('key')`, `drifted_since('date')`, `has_edge('type')`,
`created_after('date')`, `created_before('date')`

Queryable fields: `provider`, `resourceType`, `region`, `account`, `status`,
`name`, `owner`, `cost`, `tag.<Key>`, `metadata.<key>`

## Agent tools (31)

### Core graph tools (9)

| Tool | Description |
|---|---|
| `kg_blast_radius` | Blast radius analysis — downstream impact with hop distances and cost at risk (max depth 8) |
| `kg_dependencies` | Upstream/downstream/both dependency chains with depth control |
| `kg_cost` | Cost attribution by resourceId, groupId, or provider. Top-20 breakdown by type |
| `kg_drift` | Drift detection — drifted nodes with field-level changes, disappeared, and new resources |
| `kg_spof_analysis` | Single points of failure via Tarjan's algorithm (articulation points) |
| `kg_path` | Shortest path (BFS) between two resources with hop-by-hop relationship display |
| `kg_orphans` | Orphan detection — resources with zero relationships and potential savings |
| `kg_status` | Graph statistics — nodes, edges, changes, groups, cost, provider/type breakdowns |
| `kg_export` | Export topology as JSON, DOT (Graphviz), or Mermaid (max 500 nodes) |

### Governance tools (4)

| Tool | Description |
|---|---|
| `kg_audit_trail` | Change audit trail with filters: initiator, type, resource, status, since, limit. Risk scores and approval status |
| `kg_request_change` | Submit infrastructure change for governance review — risk scoring, auto-approval, policy violation checks |
| `kg_governance_summary` | Governance dashboard — changes per agent, approval rates, risk distribution, policy violations |
| `kg_pending_approvals` | List pending manual approval requests |

### Temporal tools (6)

| Tool | Description |
|---|---|
| `kg_time_travel` | View the graph at a historical point in time — loads closest snapshot with full resource list |
| `kg_diff` | Compare infrastructure between two timestamps or snapshot IDs — added, removed, changed resources plus cost delta |
| `kg_node_history` | Track a specific resource across snapshots — status, cost, tags, metadata changes over time |
| `kg_evolution` | Infrastructure evolution overview — node count trends, cost trends, net changes |
| `kg_snapshot` | Take a manual snapshot with optional label (e.g. "pre-deployment") |
| `kg_list_snapshots` | Browse available snapshots — IDs, timestamps, trigger types, resource counts |

### IQL tool (1)

| Tool | Description |
|---|---|
| `kg_query` | Execute an Infrastructure Query Language query — FIND, SUMMARIZE, PATH, AT, DIFF with full WHERE clause support |

### Analysis tools (7)

#### `kg_compliance` — Compliance assessment

Evaluates infrastructure against standard compliance frameworks.

**Supported frameworks:** SOC 2, HIPAA, PCI-DSS, ISO 27001

**Controls evaluated:** encryption at rest, network isolation, logging
enabled, backup configured, monitoring active, required tags present.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `framework` | string | No | Specific framework (default: all) |
| `provider` | string | No | Filter by cloud provider |

Ask the agent:

> "Run a SOC 2 compliance check on my AWS resources"

> "Check HIPAA compliance across all providers"

---

#### `kg_recommendations` — Optimization recommendations

Analyzes infrastructure for actionable recommendations across seven areas:

1. **Unused resources** — no connections
2. **Idle resources** — running but underutilized
3. **Untagged resources** — missing required tags
4. **Reliability issues** — no backups, single points of failure
5. **Security issues** — overly permissive access, no encryption
6. **Right-sizing** — over-provisioned compute/storage
7. **Architecture issues** — anti-patterns and design problems

Includes estimated monthly savings.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter by cloud provider |

Ask the agent:

> "What optimization recommendations do you have?"

> "Find unused resources I can clean up"

---

#### `kg_agents` — Multi-agent activity report

Shows which AI agents are modifying infrastructure, detects conflicts,
and provides activity summaries.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | No | Filter to a specific agent |
| `since` | string | No | ISO 8601 timestamp |

**Conflict types:** concurrent-modify, contradictory-action, resource-contention.

Ask the agent:

> "Show me all agent activity and conflicts"

> "What has the deploy-agent been doing since last Monday?"

---

#### `kg_ask` — Natural language infrastructure queries

Ask a plain-English question. The tool translates it to IQL, executes
the query, and returns results with a confidence score.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `question` | string | **Yes** | Natural language question |

Ask the agent:

> "Show all databases"

> "How much do compute resources cost?"

> "List stopped instances in us-west-2"

---

#### `kg_remediation` — Drift remediation patches

Detects drift and generates IaC patches with dependency-aware ordering
and risk assessment.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `iacFormat` | string | No | `terraform` (default) or `cloudformation` |

Output categories: auto-remediable, manual-review, unremeditable.

Ask the agent:

> "Generate Terraform patches to fix infrastructure drift"

---

#### `kg_supply_chain` — Supply chain security

Container images, SBOM packages, and CVE scanning. Parses CycloneDX
and SPDX formats.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter by cloud provider |

Ask the agent:

> "Show me the supply chain security report"

> "Find images with critical CVEs"

---

#### `kg_visualize` — Interactive graph visualization

Exports the graph in Cytoscape.js or D3.js format with layout configuration.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `vizFormat` | string | No | `cytoscape` (default) or `d3-force` |
| `layout` | string | No | `force-directed`, `hierarchical`, `circular`, `grid`, `concentric` |
| `provider` | string | No | Filter by cloud provider |
| `highlightNodeId` | string | No | Highlight a specific node |
| `maxNodes` | number | No | Max nodes (default: 500) |

Ask the agent:

> "Visualize my infrastructure graph"

> "Generate a hierarchical visualization of my AWS resources"

### Enterprise tools (3)

| Tool | Description |
|---|---|
| `kg_rbac` | RBAC policy — view role permissions (viewer/operator/admin/superadmin), access scope |
| `kg_benchmark` | Performance benchmarks at 1K, 10K, or 100K nodes — insert throughput, query latency, traversal, algorithms |
| `kg_export_extended` | Extended export in YAML, CSV, or OpenLineage format |

### Policy scan tool (1)

| Tool | Description |
|---|---|
| `kg_policy_scan` | Scan KG nodes against registered policies — violations by severity, top violated policies. Bridges Knowledge Graph and Policy Engine extensions |

## Gateway methods (3)

| Method | Description |
|---|---|
| `knowledge-graph/stats` | Graph statistics (nodes, edges, changes, cost, last sync) |
| `knowledge-graph/blast-radius` | Blast radius by `resourceId` and `depth` |
| `knowledge-graph/topology` | Full graph topology filtered by `provider` |

## MCP server

The Knowledge Graph ships as an MCP server for use with Claude Desktop,
Cursor, Windsurf, Cody, Continue, and any MCP-compatible client. All 30+
tools are exposed over the Model Context Protocol (stdio transport).

```bash
# Start MCP server (in-memory)
infra-graph mcp

# Start MCP server with persistent storage
infra-graph mcp --db ./infra.db
```

Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "infra-graph": {
      "command": "npx",
      "args": ["@infra-graph/core", "mcp"]
    }
  }
}
```

## HTTP API server

REST API for programmatic access (SaaS mode):

```bash
infra-graph serve --port 8080 --db ./infra.db
infra-graph serve --postgres "postgresql://..." --api-key my-secret
```

| Endpoint | Method | Description |
|---|---|---|
| `/v1/scan` | POST | Trigger cloud scan |
| `/v1/query` | POST | Execute IQL query |
| `/v1/graph/topology` | GET | Full graph topology |
| `/v1/graph/stats` | GET | Graph statistics |
| `/v1/compliance/:framework` | GET | Run compliance assessment |
| `/v1/webhook` | POST | Inbound webhook for monitoring alerts |
| `/v1/cost` | GET | Cost attribution |
| `/v1/drift` | GET | Drift detection |
| `/v1/export/:format` | GET | Export topology (json/dot/mermaid) |
| `/health` | GET | Health check |

## Type system

### Resource types (40+)

Core: `compute`, `storage`, `network`, `database`, `cache`, `queue`,
`function`, `container`, `cluster`, `load-balancer`, `dns`,
`certificate`, `secret`, `policy`, `identity`, `vpc`, `subnet`,
`security-group`, `iam-role`, `nat-gateway`, `route-table`,
`internet-gateway`, `vpc-endpoint`, `transit-gateway`, `api-gateway`,
`cdn`, `topic`, `stream`, `custom`

Kubernetes: `namespace`, `deployment`, `statefulset`, `daemonset`,
`replicaset`, `ingress`, `configmap`, `persistent-volume`,
`persistent-volume-claim`, `cronjob`, `job`

Hybrid: `hybrid-machine`, `connected-cluster`, `custom-location`,
`outpost`, `edge-site`, `hci-cluster`, `fleet`

### Relationship types (40+)

Core: `runs-in`, `contains`, `secured-by`, `secures`, `routes-to`,
`receives-from`, `triggers`, `triggered-by`, `reads-from`, `writes-to`,
`stores-in`, `uses`, `used-by`, `attached-to`, `depends-on`,
`depended-on-by`, `replicates-to`, `peers-with`, `member-of`,
`load-balances`, `resolves-to`, `encrypts-with`, `authenticated-by`,
`publishes-to`, `subscribes-to`, `monitors`, `monitored-by`, `logs-to`,
`receives-logs-from`, `backed-by`, `backs`, `aliases`, `backs-up`,
`connects-via`, `exposes`, `inherits-from`, `custom`

Hybrid: `managed-by`, `hosted-on`, `member-of-fleet`, `deployed-at`,
`connected-to`

### Cloud providers (9)

`aws`, `azure`, `gcp`, `kubernetes`, `custom`, `azure-arc`, `gdc`,
`vmware`, `nutanix`

### Node ID format

Deterministic: `{provider}:{account}:{region}:{resourceType}:{nativeId}`

### Edge discovery methods

`config-scan` (confidence 1.0), `api-field` (1.0), `runtime-trace` (0.7),
`iac-parse` (1.0), `event-stream` (0.7), `manual` (0.5)

## Multi-agent governance

When multiple AI agents operate on the same infrastructure the
Knowledge Graph provides three layers of control:

### Agent modelling

Every agent is registered as a node in the graph. Actions are tracked
as edges to the resources they touch, with full audit logging.

The `kg_agents` tool returns a structured report:

| Column | Description |
|---|---|
| Agent | Agent name |
| Actions | Total actions performed |
| Resources | Unique resources touched |
| Changes | Changes initiated |
| Cost | API/action cost attributed |
| Success Rate | Percentage of successful actions |

Conflict detection identifies three types:

- **concurrent-modify** — two agents write to the same resource
- **contradictory-action** — agents perform opposing operations (e.g., one scales up, another scales down)
- **resource-contention** — agents compete for the same limited resource

### Cost allocation

Four allocation methods attribute infrastructure spend to agents:

| Method | Logic |
|---|---|
| `exclusive` | Agent is the sole writer — 100% allocated |
| `proportional` | Split by each agent's action count (default) |
| `equal-split` | Divided equally among all agents |
| `weighted` | Split by action weight |

Per-agent budgets with alert thresholds:

| Status | Meaning |
|---|---|
| `under` | Below alert threshold |
| `warning` | Above threshold, below limit |
| `over` | Exceeded monthly budget |

### Change governance

Every change is scored 0–100 across seven factors:

| Factor | Weight | Description |
|---|---|---|
| Blast radius | 25 | Transitively affected resources |
| Cost impact | 20 | Monthly cost at risk |
| Dependent count | 15 | Direct downstream dependents |
| Environment | 20 | Production gets higher risk |
| GPU/AI workload | 10 | Expensive AI resources score higher |
| Time of day | 5 | Outside business hours bump |
| Destructive action | 5 | Deletes riskier than updates |

Approval flow:

| Score | Behaviour |
|---|---|
| 0–30 | Auto-approved |
| 31–70 | Queued for human review |
| 71–100 | Blocked until manual approval |

Protected environments (`production`, `prod`) always require manual
approval regardless of risk score.

#### Governance config

| Setting | Default | Description |
|---|---|---|
| `autoApproveThreshold` | `30` | Risk score at or below is auto-approved |
| `blockThreshold` | `70` | Risk score above requires manual approval |
| `enablePolicyChecks` | `true` | Run policy pre-checks before approval |
| `allowAgentAutoApprove` | `true` | Allow auto-approval for agent changes |
| `maxAutoApproveBlastRadius` | `5` | Max blast radius for auto-approval |
| `protectedEnvironments` | `["production","prod"]` | Always require manual approval |
| `protectedResourceTypes` | `[]` | Resource types requiring manual approval |

OPA/Rego policy engine integration is supported for custom policy
evaluation.

## Standalone binary

The `infra-graph` CLI works outside Espada:

```bash
# Scan Terraform state
infra-graph scan --terraform ./terraform.tfstate

# Multi-cloud scan
infra-graph cloud-scan --aws --aws-region us-east-1

# IQL query
infra-graph query "FIND resources WHERE type = 'ec2'"

# MCP server
infra-graph mcp --db ./infra.db

# HTTP API
infra-graph serve --port 8080 --db ./infra.db
```

## Example conversations

> "Scan my AWS infrastructure and show me the topology"

> "What is the blast radius if vpc-abc123 goes down?"

> "Find all orphaned resources that are costing money"

> "Show me configuration drift since last week"

> "What are the single points of failure in my infrastructure?"

> "Find the shortest path between my load balancer and the database"

> "Create a snapshot before the deployment"

> "Compare infrastructure between yesterday and today"

> "Show me the history of rds-prod-01 across all snapshots"

> "How has my infrastructure evolved over the last 30 days?"

> "Run a SOC 2 compliance check on my AWS resources"

> "What optimization recommendations do you have?"

> "Generate Terraform patches to fix infrastructure drift"

> "Show me the supply chain security report"

> "Which agents are modifying production resources?"

> "Break down infrastructure costs per agent"

> "Show me the governance summary and any pending approvals"

> "Scan my resources against all registered policies"

> "Query: FIND resources WHERE cost > 500 AND provider = 'aws'"

> "Ask: how much do my databases cost?"

> "Visualize my infrastructure with a hierarchical layout"

> "Export the graph as YAML for compliance reporting"

> "Run performance benchmarks at 10K scale"

## Troubleshooting

**"No resources found"** — make sure your cloud credentials are
configured. Run `espada aws whoami`, `az account show`, or
`gcloud auth list` to verify authentication.

**Stale data** — run `espada infra cloud-scan` to refresh the graph
with the latest resource state.

**Large environments** — the background sync runs light syncs every
15 minutes (critical types only) and full syncs every 6 hours. Adjust
`sync.intervalMinutes` and `sync.fullSyncIntervalHours` for faster or
slower refresh.

**Agent conflicts** — if `kg_agents` reports conflicts, review which
agents have overlapping write scope and consider restricting agent
capabilities or using governance approval gates to serialize changes.

**IQL syntax errors** — use the `kg_ask` tool to phrase questions in
natural language. If you need IQL directly, queryable fields are:
`provider`, `resourceType`, `region`, `account`, `status`, `name`,
`owner`, `cost`, `tag.<Key>`, `metadata.<key>`.

**MCP not connecting** — verify `infra-graph mcp` starts cleanly.
Check the Claude Desktop config points to the correct command path.
Use `--db` for persistent state across sessions.
