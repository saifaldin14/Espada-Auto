---
summary: "Knowledge Graph plugin: multi-cloud infrastructure topology, blast radius analysis, drift detection, cost governance, and IQL queries"
read_when:
  - You want to visualize and query your cloud infrastructure as a graph
  - You need blast radius, drift detection, or SPOF analysis
  - You are configuring or developing the Knowledge Graph extension
---

# Knowledge Graph (plugin)

Infrastructure intelligence for Espada. Discovers resources across AWS,
Azure, GCP, Kubernetes, and Terraform, builds a live topology graph, and
exposes 30 agent tools plus 10 CLI commands for blast radius analysis,
drift detection, cost governance, compliance auditing, and natural
language infrastructure queries.

Current capabilities:
- **Multi-cloud discovery** — AWS, Azure, GCP, Kubernetes, Terraform, cross-cloud
- **Topology graph** — 50 resource types, 43 relationship types, 9 node statuses
- **Blast radius** — impact analysis for any node with downstream dependency tracking
- **Drift detection** — detect configuration drift between scans
- **SPOF analysis** — single points of failure with blast radius scoring
- **Cost governance** — estimated monthly costs and orphaned resource detection
- **IQL queries** — Infrastructure Query Language for graph traversal
- **Compliance** — audit trails, change approvals, governance workflows
- **Temporal** — time travel, snapshots, diff between points in time
- **Visualization** — Mermaid diagrams and extended export formats

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
# Set storage path
espada config set plugins.entries.knowledge-graph.config.storagePath ~/.espada/knowledge-graph.db

# Enable incremental sync
espada config set plugins.entries.knowledge-graph.config.enableIncrementalSync true
```

| Key | Type | Default | Description |
|---|---|---|---|
| `storagePath` | string | `~/.espada/knowledge-graph.db` | SQLite database file path |
| `enableIncrementalSync` | boolean | `false` | Use incremental sync (only changed resources) |

## CLI commands

All commands live under `espada infra`:

```bash
espada infra cloud-scan             # Discover cloud resources and build the graph
espada infra scan                   # Scan local/Terraform infrastructure
espada infra report                 # Full infrastructure report
espada infra report --focus cost    # Cost breakdown by resource type
espada infra report --focus orphans # Orphaned resources (no dependencies)
espada infra report --focus spof    # Single points of failure
espada infra drift                  # Detect configuration drift between scans
espada infra audit                  # Governance audit trail
espada infra monitor                # Continuous monitoring mode
espada infra timeline               # Resource change timeline
espada infra snapshot               # Take a point-in-time snapshot
espada infra query "<IQL>"          # Run an Infrastructure Query Language query
```

### IQL query examples

```bash
# Find all storage resources
espada infra query "FIND RESOURCES WHERE resourceType = 'storage'"

# Find downstream dependencies of a VPC
espada infra query "FIND DOWNSTREAM OF 'vpc-abc123'"

# Find resources by cloud provider
espada infra query "FIND RESOURCES WHERE cloud = 'aws'"

# Find resources by status
espada infra query "FIND RESOURCES WHERE status = 'active'"
```

## Agent tools

The plugin registers 30 agent tools across six categories:

### Core graph tools

| Tool | Description |
|---|---|
| `kg_blast_radius` | Compute blast radius for a node (downstream impact) |
| `kg_dependencies` | List upstream/downstream dependencies |
| `kg_cost` | Estimated monthly cost breakdown |
| `kg_drift` | Detect configuration drift between scans |
| `kg_spof_analysis` | Find single points of failure |
| `kg_path` | Find shortest path between two nodes |
| `kg_orphans` | Find orphaned resources with no relationships |
| `kg_status` | Graph summary (node/edge counts, last sync) |
| `kg_export` | Export graph in JSON or DOT format |

### Governance tools

| Tool | Description |
|---|---|
| `kg_audit_trail` | Query the change audit trail |
| `kg_request_change` | Submit a change request for approval |
| `kg_governance_summary` | Governance posture overview |
| `kg_pending_approvals` | List pending change approvals |

### Temporal tools

| Tool | Description |
|---|---|
| `kg_time_travel` | View graph state at a past point in time |
| `kg_diff` | Diff graph between two timestamps |
| `kg_node_history` | Full history of a specific node |
| `kg_evolution` | How the graph evolved over a time range |
| `kg_snapshot` | Take a named point-in-time snapshot |
| `kg_list_snapshots` | List available snapshots |

### Query tools

| Tool | Description |
|---|---|
| `kg_query` | Run an IQL (Infrastructure Query Language) query |

### Phase 2 tools

#### `kg_compliance` — Compliance posture analysis

Evaluates infrastructure against standard compliance frameworks and
returns pass/fail for each control with remediation guidance.

**Supported frameworks:** `soc2`, `hipaa`, `pci-dss`, `iso-27001`

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `framework` | string | No | Specific framework to evaluate (default: all) |
| `provider` | string | No | Filter to a cloud provider: `aws`, `azure`, `gcp`, `k8s`, `custom` |

**Controls evaluated:** encryption at rest, network isolation, logging
enabled, backup configured, monitoring active, required tags present.

Ask the agent:

> "Run a SOC2 compliance check on my AWS resources"

> "Check HIPAA compliance across all providers"

> "Show me which resources fail PCI-DSS controls"

---

#### `kg_recommendations` — Optimization recommendations

Analyzes the infrastructure graph to surface actionable recommendations
across seven detection strategies.

**Detection strategies:**
1. **Unused resources** — resources with no connections
2. **Idle resources** — running but underutilized
3. **Untagged resources** — missing required tags
4. **Reliability issues** — single points of failure, no backups
5. **Security issues** — overly permissive access, no encryption
6. **Right-sizing** — over-provisioned compute/storage
7. **Architecture issues** — anti-patterns and design problems

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter to a cloud provider |

The report includes estimated monthly savings for cost-related
recommendations.

Ask the agent:

> "What optimization recommendations do you have?"

> "Show me recommendations for my AWS resources"

> "Find unused resources I can clean up"

---

#### `kg_agents` — Multi-agent activity report

Shows which AI agents are operating on your infrastructure, what they
are doing, and whether they conflict with each other.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | No | Filter to a specific agent ID |
| `since` | string | No | ISO 8601 timestamp to filter recent activity |

**Report includes:**
- Per-agent summary: actions, resources touched, changes, cost, success rate
- Conflict detection: concurrent-modify, contradictory-action, resource-contention

Ask the agent:

> "Show me all agent activity"

> "What has the deploy-agent been doing since last Monday?"

> "Are any agents conflicting on the same resources?"

---

#### `kg_ask` — Natural language infrastructure questions

Ask a plain-English question about your infrastructure. The tool
translates it to IQL (Infrastructure Query Language), executes the
query, and returns results in a table.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `question` | string | **Yes** | Natural language question about infrastructure |

The translator understands resource types (databases, servers, buckets,
etc.), providers (AWS, Azure, GCP), statuses (running, stopped, active),
regions, environments, and cost qualifiers.

Ask the agent:

> "Show all databases"

> "What depends on my load balancer?"

> "How much do compute resources cost?"

> "List stopped instances in us-west-2"

> "Find all storage in production"

If the question cannot be translated, the tool suggests example queries
to guide you.

---

#### `kg_remediation` — Drift remediation patches

Detects configuration drift and generates IaC patches to fix it.
Supports Terraform HCL and CloudFormation YAML output with
dependency-aware ordering and risk assessment per patch.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `iacFormat` | string | No | `terraform` (default) or `cloudformation` |

**Output includes:**
- Auto-remediable patches (safe to apply directly)
- Manual review patches (need human verification)
- Unremeditable drift (requires architectural changes)
- Dependency warnings (patches that must be applied in order)

Ask the agent:

> "Generate Terraform patches to fix infrastructure drift"

> "Show me CloudFormation remediation for any drifted resources"

> "What drift exists and how do I fix it?"

---

#### `kg_supply_chain` — Software supply chain security

Generates a supply chain security report covering container images,
packages (SBOM), and known vulnerabilities (CVEs) across your
infrastructure. Parses CycloneDX and SPDX formats.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter to a cloud provider |

**Report includes:**
- Total container images, packages, and vulnerabilities
- Critical vulnerability count and details
- Image-to-infrastructure linkage (which resources run which images)
- CVE lookup by image

Ask the agent:

> "Show me the supply chain security report"

> "What container vulnerabilities exist in my AWS infrastructure?"

> "Find images with critical CVEs"

---

#### `kg_visualize` — Interactive graph visualization

Exports the infrastructure graph in a visualization-ready format for
Cytoscape.js or D3.js rendering. Returns JSON data with nodes, edges,
styling, and layout configuration.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `vizFormat` | string | No | `cytoscape` (default) or `d3-force` |
| `layout` | string | No | Layout strategy: `force-directed` (default), `hierarchical`, `circular`, `grid`, `concentric` |
| `provider` | string | No | Filter to a cloud provider |
| `highlightNodeId` | string | No | Highlight a specific node and its neighborhood |
| `maxNodes` | number | No | Maximum nodes to include (default: 500) |

The export includes cost data, metadata, and provider-based grouping.

Ask the agent:

> "Visualize my infrastructure graph"

> "Generate a hierarchical visualization of my AWS resources"

> "Show me a D3 force graph highlighting vpc-abc123"

> "Export a Cytoscape graph of just my GCP resources, max 200 nodes"

### Phase 3 tools

| Tool | Description |
|---|---|
| `kg_rbac` | Role-based access control for graph operations |
| `kg_benchmark` | Performance benchmarking |
| `kg_export_extended` | Extended export (SBOM, CSV, Terraform) |

## Multi-agent governance

When multiple AI agents operate on the same infrastructure, the
Knowledge Graph provides three layers of control: **agent modeling**
(who touches what), **cost allocation** (who spends what), and
**change governance** (who is allowed to do what).

### Agent modeling

Every agent is registered as a node in the graph. Actions are tracked
as edges to the resources they touch, with full audit logging.

Ask the agent:

> "Which agents are modifying my infrastructure?"

> "Show me agent activity for the last 7 days"

> "Are any agents conflicting on the same resources?"

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

The cost engine attributes infrastructure spend to individual agents
using four allocation methods:

| Method | Logic |
|---|---|
| `exclusive` | Agent is the sole writer — 100% of the resource cost is allocated |
| `proportional` | Cost split by each agent's action count (default) |
| `equal-split` | Cost divided equally among all agents touching the resource |
| `weighted` | Cost split by action weight |

Ask the agent:

> "Break down infrastructure costs per agent"

> "Which agent is spending the most?"

> "Show me each agent's top resources by cost"

The cost report includes per-agent summaries:

| Column | Description |
|---|---|
| Agent | Agent name |
| Infra Cost | Monthly infrastructure cost attributed |
| Action Cost | API/action cost incurred |
| Total | Combined cost |
| Resources | Number of resources allocated |
| Cost/Action | Cost efficiency metric |

#### Agent budgets

Set per-agent monthly spending limits. A budget alert fires when an
agent crosses the threshold (default: 80% utilization):

| Status | Meaning |
|---|---|
| `under` | Below alert threshold |
| `warning` | Above threshold, below limit |
| `over` | Exceeded monthly budget |

### Change governance

The governance layer intercepts infrastructure changes, scores risk,
and gates high-risk operations behind human approval.

#### Risk scoring

Every change is scored 0–100 across seven factors:

| Factor | Weight | Description |
|---|---|---|
| Blast radius | 25 | Number of transitively affected resources |
| Cost impact | 20 | Monthly cost at risk ($) |
| Dependent count | 15 | Direct downstream dependents |
| Environment | 20 | Production gets higher risk |
| GPU/AI workload | 10 | Expensive AI resources score higher |
| Time of day | 5 | Outside business hours gets a bump |
| Destructive action | 5 | Deletes are riskier than updates |

#### Approval flow

Changes are auto-approved, blocked, or queued based on risk score
thresholds:

| Score | Default behavior |
|---|---|
| 0–30 | Auto-approved |
| 31–70 | Queued for review (configurable) |
| 71–100 | Blocked until manual approval |

Protected environments (`production`, `prod`) always require manual
approval regardless of risk score.

#### CLI commands for governance

```bash
# View the full audit trail
espada infra audit

# Filter to agent-initiated changes
espada infra audit --type agent

# Filter to a specific agent
espada infra audit --initiator "deploy-agent"

# Filter by time range
espada infra audit --since 2025-02-01T00:00:00Z --until 2025-02-28T23:59:59Z

# Filter by change type
espada infra audit --change-type node-updated

# Output as JSON for programmatic use
espada infra audit --type agent --output json

# Limit results
espada infra audit --limit 100
```

#### Agent tool commands for governance

Ask the agent any of these:

```text
"Show me the audit trail for agent-initiated changes"
→ uses kg_audit_trail with initiatorType=agent

"Show all pending approval requests"
→ uses kg_pending_approvals

"Give me a governance summary for the last 30 days"
→ uses kg_governance_summary with since=<30 days ago>

"Submit a change request to scale my RDS instance"
→ uses kg_request_change with action=scale

"Who changed the production database this week?"
→ uses kg_audit_trail with targetResourceId=<db-id>
```

#### Governance config

The governor is configured with these defaults:

| Setting | Default | Description |
|---|---|---|
| `autoApproveThreshold` | `30` | Risk score at or below this is auto-approved |
| `blockThreshold` | `70` | Risk score above this requires manual approval |
| `enablePolicyChecks` | `true` | Run policy pre-checks before approval |
| `allowAgentAutoApprove` | `true` | Allow auto-approval for agent-initiated changes |
| `maxAutoApproveBlastRadius` | `5` | Max blast radius (node count) for auto-approval |
| `protectedEnvironments` | `["production", "prod"]` | Environments that always require manual approval |
| `protectedResourceTypes` | `[]` | Resource types that always require manual approval |

OPA/Rego policy engine integration is supported for custom policy
evaluation, with configurable fail-open or fail-closed behavior.

### End-to-end multi-agent workflow

Here is a typical workflow for a company running multiple agents:

```bash
# 1. Discover infrastructure
espada infra cloud-scan

# 2. Check which agents are active and what they're touching
#    (ask the agent)
> "Show me all agent activity and conflicts"

# 3. Review cost allocation per agent
> "Break down infrastructure costs by agent"

# 4. Check governance posture
> "Show me the governance summary for this month"

# 5. Review pending approvals
> "List all pending approval requests"

# 6. Audit agent-specific changes
espada infra audit --type agent --since 2025-02-01T00:00:00Z

# 7. Find single points of failure in the topology
espada infra report --focus spof

# 8. Export for compliance reporting
> "Export the audit trail as JSON"
```

## Example conversations

> "Scan my AWS infrastructure and show me the topology"

> "What is the blast radius if vpc-abc123 goes down?"

> "Find all orphaned resources that are costing money"

> "Show me configuration drift since last week"

> "What are the single points of failure in my infrastructure?"

> "Find the shortest path between my load balancer and the database"

> "List all resources that changed in the last 24 hours"

> "Generate a Mermaid diagram of my network topology"

> "Which agents are modifying production resources?"

> "Break down infrastructure costs per agent"

> "Show me the governance summary and any pending approvals"

> "Submit a change request to delete the orphaned S3 buckets"

## Troubleshooting

**"No resources found"** — make sure your cloud credentials are
configured. Run `espada aws whoami`, `az account show`, or
`gcloud auth list` to verify authentication.

**Stale data** — run `espada infra cloud-scan` to refresh the graph
with the latest resource state.

**Large environments** — for accounts with thousands of resources,
enable incremental sync to reduce scan time after the initial
full discovery.

**Agent conflicts** — if `kg_agents` reports conflicts, review
which agents have overlapping write scope and consider restricting
agent capabilities or using governance approval gates to serialize
their changes.
