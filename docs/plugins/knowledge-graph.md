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

| Tool | Description |
|---|---|
| `kg_compliance` | Compliance posture analysis |
| `kg_recommendations` | AI-powered optimization recommendations |
| `kg_agents` | Multi-agent infrastructure coordination |
| `kg_ask` | Natural language infrastructure questions |
| `kg_remediation` | Automated remediation suggestions |
| `kg_supply_chain` | Software supply chain analysis |
| `kg_visualize` | Generate Mermaid topology diagrams |

### Phase 3 tools

| Tool | Description |
|---|---|
| `kg_rbac` | Role-based access control for graph operations |
| `kg_benchmark` | Performance benchmarking |
| `kg_export_extended` | Extended export (SBOM, CSV, Terraform) |

## Example conversations

> "Scan my AWS infrastructure and show me the topology"

> "What is the blast radius if vpc-abc123 goes down?"

> "Find all orphaned resources that are costing money"

> "Show me configuration drift since last week"

> "What are the single points of failure in my infrastructure?"

> "Find the shortest path between my load balancer and the database"

> "List all resources that changed in the last 24 hours"

> "Generate a Mermaid diagram of my network topology"

## Troubleshooting

**"No resources found"** — make sure your cloud credentials are
configured. Run `espada aws whoami`, `az account show`, or
`gcloud auth list` to verify authentication.

**Stale data** — run `espada infra cloud-scan` to refresh the graph
with the latest resource state.

**Large environments** — for accounts with thousands of resources,
enable incremental sync to reduce scan time after the initial
full discovery.
