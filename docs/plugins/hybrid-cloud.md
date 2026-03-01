---
summary: "Hybrid Cloud plugin: unified topology discovery across Azure Arc, AWS Outposts, GKE Enterprise fleets, and Google Distributed Cloud with blast radius analysis, fleet drift detection, and disconnected-operation assessment"
read_when:
  - You need to view hybrid or edge infrastructure topology
  - You want to discover edge sites or on-premises locations
  - You need a cross-provider Kubernetes fleet view
  - You want to analyze blast radius across cloud and edge boundaries
  - You are assessing disconnected-operation capability
  - You need fleet drift or version skew analysis
---

# Hybrid/Edge Infrastructure (plugin)

Unified topology discovery across Azure Arc, Azure Local, AWS
Outposts, GKE Enterprise fleets, and Google Distributed Cloud.
Aggregates edge sites, fleet clusters, and cloud regions into a
single hybrid topology view with connectivity status, blast-radius
analysis, fleet drift detection, and disconnected-operation
assessment.

The plugin uses a provider-adapter architecture — each cloud
provider implements a `HybridDiscoveryAdapter` that discovers
sites, fleet clusters, and hybrid resources. The
`HybridDiscoveryCoordinator` orchestrates all adapters and
optionally syncs discovered topology into the Knowledge Graph.

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. **Knowledge Graph plugin** (optional) — enables graph-backed
   neighbor queries for edge-site impact and disconnected-operation
   assessment

## Install

```bash
espada plugins install @espada/hybrid-cloud
```

Restart the Gateway afterwards.

---

## Supported providers

| Provider | ID | Infrastructure |
|---|---|---|
| AWS | `aws` | Outposts, Local Zones |
| Azure | `azure` | Azure Arc, Azure Local, HCI |
| Azure Arc | `azure-arc` | Connected machines, K8s clusters |
| GCP | `gcp` | GKE Enterprise fleets |
| Google Distributed Cloud | `gdc` | Edge appliances |
| VMware | `vmware` | vSphere on-premises |
| Nutanix | `nutanix` | HCI clusters |

---

## Configuration

Set via `pluginConfig` in your Espada configuration:

| Key | Type | Default | Description |
|---|---|---|---|
| `syncIntervalMinutes` | number | `30` | Background sync interval in minutes |
| `enabledProviders` | string[] | `["azure-arc", "aws-outposts", "gke-fleet"]` | Which provider adapters to activate |

---

## Agent tools

4 tools for querying hybrid topology, edge sites, Kubernetes fleet,
and cross-boundary blast radius through natural language:

### hybrid_topology

Show full hybrid infrastructure topology: cloud regions, edge sites,
connectivity status, and resource counts across all providers.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter by provider (`aws`, `azure`, `azure-arc`, `gcp`, `gdc`) |
| `includeResources` | boolean | No | Include fleet cluster detail (default: false) |

**Output**: Cloud region count, edge site count, fleet cluster count,
connected/disconnected site counts, and tables of regions, sites,
and optionally clusters.

### hybrid_sites

List edge and on-premises sites with status, connectivity,
capabilities, and resource counts.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter by cloud provider |
| `status` | string | No | Filter by connectivity: `connected`, `degraded`, `disconnected`, `unknown` |

**Output**: Site count, per-site details (name, provider, status,
parent region, resources, clusters, capabilities, last sync), and
status breakdown.

### hybrid_fleet

Cross-provider Kubernetes fleet view with version skew detection
and fleet consistency scoring.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | No | Filter by cloud provider |
| `fleetId` | string | No | Filter by fleet ID (GKE fleets) |

**Output**: Cluster count, fleet consistency score (0–100), version
skew warnings, and per-cluster details (name, provider, K8s version,
nodes, status, connectivity, managed by, fleet ID).

### hybrid_blast_radius

Analyze blast radius across cloud and edge boundaries. Shows what
happens if a cloud region goes down, an edge site goes offline, or
a cluster fails.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | string | Yes | Cloud region name, site ID, or cluster ID |
| `targetType` | string | Yes | `region`, `site`, or `cluster` |
| `provider` | string | No | Cloud provider (required for region targets) |

**Output varies by target type:**

- **Region**: Affected sites, affected clusters, affected resources,
  sites with disconnected-ops capability vs. sites that will fail
- **Site**: Blast radius (neighbor count), cloud dependencies,
  data flow impact (routes-to, depends-on, uses relationships)
- **Cluster**: Provider, K8s version, nodes, status, disconnected
  operation category (fully-disconnectable / partially-disconnectable
  / requires-connectivity)

---

## CLI commands

All commands live under `espada hybrid`:

```
espada hybrid
├── status                      Overview of all hybrid/edge infrastructure
├── sites                       List edge sites with connectivity status
│   --provider <provider>       Filter by cloud provider
│   --status <status>           Filter by connectivity status
├── fleet                       Cross-provider Kubernetes fleet view
│   --provider <provider>       Filter by cloud provider
│   --fleet-id <fleetId>        Filter by fleet ID
├── topology                    Full topology view
│   --format <format>           Output format: text (default) or mermaid
│   --provider <provider>       Filter by provider
├── sync                        Trigger hybrid discovery across all providers
│   --provider <provider>       Sync only a specific provider
├── blast-radius <target>       Cross-boundary blast radius analysis
│   -t, --type <type>           Target type: region, site, or cluster (default: region)
│   --provider <provider>       Cloud provider (for region targets)
└── assess                      Disconnected operation assessment + DR posture
    --dr                        Include DR posture analysis
```

### CLI examples

```bash
# Overview of all hybrid infrastructure
espada hybrid status

# List all edge sites
espada hybrid sites

# List disconnected sites only
espada hybrid sites --status disconnected

# List Azure Arc sites
espada hybrid sites --provider azure-arc

# Kubernetes fleet view
espada hybrid fleet

# Fleet view for a specific fleet
espada hybrid fleet --fleet-id projects/my-project/locations/global/memberships

# Full topology as text table
espada hybrid topology

# Topology as Mermaid diagram
espada hybrid topology --format mermaid

# Trigger a full sync
espada hybrid sync

# Sync only AWS
espada hybrid sync --provider aws

# Blast radius for a cloud region
espada hybrid blast-radius us-east-1 --provider aws

# Blast radius for an edge site
espada hybrid blast-radius site-factory-01 -t site

# Blast radius for a cluster
espada hybrid blast-radius prod-edge-cluster -t cluster

# Disconnected operation assessment
espada hybrid assess

# Assessment with DR posture analysis
espada hybrid assess --dr
```

---

## Gateway methods

3 gateway methods for programmatic access via the Gateway WebSocket API:

| Method | Parameters | Description |
|---|---|---|
| `hybrid/topology` | _(none)_ | Full topology snapshot — cloud region count, edge site count, fleet cluster count, connections, and summary. |
| `hybrid/sites` | `provider?`, `status?` | List edge sites, optionally filtered by provider or connectivity status. |
| `hybrid/fleet` | `provider?`, `fleetId?` | List fleet clusters, optionally filtered by provider or fleet ID. |

---

## Core concepts

### Edge sites

A `HybridSite` represents a physical edge or on-premises location
(warehouse, factory, branch office, data centre) where
infrastructure is deployed:

| Field | Description |
|---|---|
| `id` | Unique site identifier |
| `name` | Human-readable site name |
| `provider` | Cloud provider managing this site |
| `location` | Physical/logical location with type, coordinates, and address |
| `status` | Connectivity to parent cloud: `connected`, `degraded`, `disconnected`, `unknown` |
| `parentCloudRegion` | Cloud region this site connects to |
| `resourceCount` | Number of resources deployed at this site |
| `managedClusters` | K8s cluster node IDs at this site |
| `managedMachines` | Machine node IDs at this site |
| `capabilities` | Site capabilities (see below) |

### Site capabilities

| Capability | Description |
|---|---|
| `compute` | General compute workloads |
| `containers` | Container/Kubernetes workloads |
| `storage` | Local storage services |
| `ai-inference` | AI/ML inference at the edge |
| `disconnected-ops` | Can operate when disconnected from cloud |
| `sovereign` | Data sovereignty / air-gapped operation |

### Fleet clusters

A `FleetCluster` represents a Kubernetes cluster in a fleet — may
be cloud-hosted, on-premises, or running on edge hardware:

| Field | Description |
|---|---|
| `id` | Cluster identifier |
| `name` | Cluster name |
| `provider` | Cloud provider |
| `fleetId` | Fleet/membership ID (GKE fleets) |
| `kubernetesVersion` | K8s version |
| `nodeCount` | Number of nodes |
| `status` | `running`, `stopped`, `degraded`, `unknown` |
| `managedBy` | `gke`, `aks`, `eks`, `arc`, `self-managed` |
| `connectivity` | Connection status to management plane |

### Hybrid connections

Network links between edge sites and cloud regions:

| Field | Description |
|---|---|
| `from` | Source (site ID) |
| `to` | Target (cloud region reference) |
| `status` | Connectivity status |
| `latencyMs` | Link latency in milliseconds |
| `bandwidth` | Available bandwidth |

---

## Cross-boundary analysis

The `CrossBoundaryAnalyzer` provides 4 analysis capabilities:

### Cloud region impact

If a cloud region goes down, which edge sites lose their management
plane and which can operate disconnected?

- Sites with `disconnected-ops` capability → can continue operating
- Sites without → will fail
- Reports affected clusters, total affected resources

### Edge site impact

If an edge site goes offline, what cloud dependencies break?
Uses Knowledge Graph neighbor queries (depth 3) to find:

- Cloud dependencies (AWS, Azure, GCP managed resources)
- Data flow impact (`routes-to`, `depends-on`, `uses` relationships)
- Blast radius (total neighbor count)

### Disconnected-operation assessment

Classifies fleet clusters by their ability to operate without cloud
connectivity:

| Category | Criteria |
|---|---|
| **Fully disconnectable** | No cloud dependencies in the graph |
| **Partially disconnectable** | Cloud dependencies exist but none are critical (database, secret, identity, IAM role) |
| **Requires connectivity** | Has critical cloud dependencies or not yet in the graph |

### Fleet drift analysis

Analyzes version, policy, and configuration consistency across
fleet clusters. Produces a consistency score (0–100):

| Penalty | Deduction |
|---|---|
| Version skew (per cluster) | −10 (max −40) |
| Disconnected cluster | −10 (max −30) |
| Degraded cluster | −5 (max −20) |

Version skew is detected by finding the majority K8s version and
flagging outliers.

---

## Hybrid DR posture

The `hybrid assess --dr` command evaluates disaster recovery
posture across all hybrid infrastructure:

- **Single-region risks** — regions where all edge sites depend on
  one cloud region with no failover
- **Edge site risks** — sites without backup clusters or failover
  capability
- **RTO estimates** — 0 min for sites with disconnected-ops, 300 min
  for sites with backup clusters, null for unprotected sites

### DR scoring

| Penalty | Deduction |
|---|---|
| Region without failover | −15 |
| Site without backup or failover | −10 |
| Disconnected site | −5 |
| Degraded cluster | −5 |

---

## Knowledge Graph integration

The `HybridDiscoveryCoordinator` can sync discovered topology into
the Knowledge Graph:

- **Site nodes** — created as `edge-site` resource type
- **Cluster nodes** — created as `connected-cluster` resource type
- **Fleet nodes** — created as `fleet` resource type
- **Edges** — `connected-to` (site → cloud region),
  `member-of-fleet` (cluster → fleet)

Node IDs follow the KG convention:
`{provider}::{region}:{resourceType}:{nativeId}`

### Background sync

A background service runs every `syncIntervalMinutes` (default: 30)
and discovers all sites, clusters, and connections. Sync results
are logged with site, cluster, and connection counts.

---

## Discovery adapter interface

To add support for a new hybrid provider, implement
`HybridDiscoveryAdapter`:

```typescript
interface HybridDiscoveryAdapter {
  provider: CloudProvider;
  discoverSites(): Promise<HybridSite[]>;
  discoverFleetClusters(): Promise<FleetCluster[]>;
  discoverHybridResources(): Promise<GraphNodeInput[]>;
  healthCheck(): Promise<boolean>;
}
```

Register with the coordinator:

```typescript
coordinator.registerAdapter("vmware", myVmwareAdapter);
```

Adapter failures are non-fatal — the coordinator continues with
remaining adapters.

---

## Example conversations

> "Show me the hybrid infrastructure topology"

> "Which edge sites are disconnected?"

> "What happens if us-east-1 goes down?"

> "Show me the Kubernetes fleet across all providers"

> "Can our edge clusters operate without cloud connectivity?"

> "What's the blast radius if the factory site goes offline?"

> "Are there any K8s version skew issues in the fleet?"

> "Assess our hybrid DR posture"

---

## Troubleshooting

**No sites or clusters discovered** — no provider adapters are
registered. Check `enabledProviders` in your plugin configuration
and ensure the corresponding cloud credentials are configured.

**"Cluster not found in hybrid topology"** — the cluster ID or name
doesn't match any discovered cluster. Run `espada hybrid sync`
to refresh discovery, then retry.

**Low fleet consistency score** — clusters running different K8s
versions or in disconnected/degraded state. Use
`espada hybrid fleet` to identify version skew and connectivity
issues.

**Edge site impact returns empty** — the Knowledge Graph may not
have neighbor data for the site. Ensure the KG plugin is active
and the hybrid sync has run at least once.

**Mermaid output not rendering** — the `--format mermaid` output
is raw Mermaid graph syntax. Paste into a Mermaid-compatible
renderer (e.g. GitHub, Notion, Mermaid Live Editor).

**Background sync failures** — check the logs for
`"Hybrid sync failed"` errors. Adapter failures are isolated —
a single provider failure won't block other providers.
