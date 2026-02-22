# Knowledge Graph — Implementation Roadmap

> What's built, what's missing, and what to build next — ordered by impact.

---

## Current State (What's Built)

### Core Engine — ✅ Complete

| Component | File | LOC | Status |
|-----------|------|-----|--------|
| Graph Engine | `src/engine.ts` | 711 | Full sync orchestration, blast-radius analysis, dependency chains, drift detection, cost attribution, timeline queries, topology export |
| Type System | `src/types.ts` | 615 | Universal data model — 30+ resource types, 40+ relationship types, 8 node statuses, 8 change types, hybrid/edge location types |
| SQLite Storage | `src/storage/sqlite-store.ts` | 1,059 | Production-grade: WAL mode, recursive CTEs for graph traversal, JSON tag filtering, batch transactions, full CRUD, append-only changelog |
| PostgreSQL Storage | `src/storage/postgres-store.ts` | 800+ | Enterprise PostgreSQL backend: JSONB+GIN indexes, recursive CTEs, materialized views, connection pooling, schema-based tenant isolation |
| In-Memory Storage | `src/storage/memory-store.ts` | — | Test double implementing full `GraphStorage` interface |
| Query Algorithms | `src/queries.ts` | 374 | BFS shortest path, orphan detection, critical node analysis (degree + reachability), SPOF via Tarjan's algorithm, connected cluster detection |
| Export | `src/export.ts` | 291 | JSON, Graphviz DOT, and Mermaid diagram generation with cost/metadata options |
| Agent Tools (20) | `src/tools.ts` | 1,500+ | 13 core + 6 temporal + 1 IQL (`kg_query`) |
| Policy Scan Tool | `src/policy-scan-tool.ts` | 407 | Cross-extension bridge: walks KG nodes through the policy engine, reports violations by severity |
| CLI | `src/infra-cli.ts` | 1,500+ | 9+ subcommands: scan, report, drift, cloud-scan, audit, monitor, timeline, snapshot, query |
| Engine Tests | `src/engine.test.ts` | 348 | Sync, blast radius, drift, cost attribution, change tracking |
| Query Tests | `src/queries.test.ts` | — | Shortest path, orphans, SPOFs, clusters |
| Storage Tests | `src/graph-storage.test.ts` | — | SQLite storage interface compliance |
| Export Tests | `src/export.test.ts` | — | JSON/DOT/Mermaid output validation |
| Scale Tests | `src/scale.test.ts` | 600+ | Sync utils, LRU/query cache, account registry, tenant manager, cross-account discovery |

**Total: ~20,000+ LOC of working, tested code.**

### Adapter Framework — ✅ Complete

| Component | File | Status |
|-----------|------|--------|
| Adapter Interface | `src/adapters/types.ts` | `GraphDiscoveryAdapter` interface, `AdapterRegistry`, `DiscoverOptions`, `DiscoveryResult` |
| AWS Adapter | `src/adapters/aws.ts` | 1,115 LOC — Full SDK wiring, 31 relationship rules, 18 service mappings, cross-account AssumeRole, GPU/AI workload detection, cost estimation, STS health check |

### AWS Adapter — ✅ Complete

The AWS adapter has production-quality SDK wiring with full discovery:

- ✅ 31 relationship extraction rules (EC2→VPC, Lambda→SecurityGroup, RDS→Subnet, ECS→IAM, S3→Lambda triggers, etc.)
- ✅ 18 service-to-API mappings (EC2, RDS, Lambda, S3, ELBv2, SQS, SNS, ElastiCache, ECS, EKS, API Gateway, CloudFront, Route53, IAM, SecretsManager, STS, SageMaker, Bedrock)
- ✅ `discoverService()` — makes real SDK calls via dynamic imports, extracts nodes + edges
- ✅ `healthCheck()` — calls STS `GetCallerIdentity` to verify credentials
- ✅ Cross-account `assumeRole()` with STS, external ID support
- ✅ GPU/AI workload detection (p4d/p5/g5/inf2/trn1 + SageMaker/Bedrock)
- ✅ Cost estimation from resource attributes
- ✅ AWS tag extraction (both `[{Key, Value}]` and `{key: value}` formats)

### All Adapters — ✅ Complete

| Provider | Status |
|----------|--------|
| AWS | ✅ Complete — `src/adapters/aws.ts` (1,115 LOC) |
| Azure | ✅ Complete — `src/adapters/azure.ts` (883 LOC) |
| GCP | ✅ Complete — `src/adapters/gcp.ts` (862 LOC) |
| Kubernetes | ✅ Complete — `src/adapters/kubernetes.ts` (700+ LOC) |
| Terraform State | ✅ Complete — `src/adapters/terraform.ts` (1,194 LOC) |
| Cross-Cloud | ✅ Complete — `src/adapters/cross-cloud.ts` (488 LOC) |

---

## Phase 1: Make It Work (Wire Up AWS Discovery)

**Goal:** A user can run `espada kg sync` and see their real AWS infrastructure in the graph.

**Estimated effort:** 2-3 weeks

### 1.1 — Implement `AwsDiscoveryAdapter.discoverService()`

Wire up each of the 17 service mappings to real `@aws-sdk/client-*` calls. The mapping table and relationship extractor already exist — you just need the SDK calls.

**For each service:**
1. Instantiate the SDK client for the service/region
2. Call the `listMethod` from `AWS_SERVICE_MAPPINGS`
3. Extract nodes using the mapping's `responseKey`, `idField`, `nameField`, `arnField`
4. Call `extractRelationships()` with the raw response to generate edges
5. Map status from provider-specific values to `GraphNodeStatus`

**Priority order** (most relationships, most commonly used):
1. EC2 instances (compute, VPC, subnet, security groups, volumes)
2. VPCs, subnets, security groups (network backbone)
3. RDS instances (databases)
4. Lambda functions
5. S3 buckets
6. ECS services/tasks
7. Load balancers (ALB/NLB)
8. IAM roles
9. SQS queues, SNS topics
10. Route53 hosted zones
11. ElastiCache clusters
12. API Gateway REST APIs
13. CloudFront distributions
14. Secrets Manager secrets

**Key decisions:**
- Use `@aws-sdk/credential-provider-node` for the default credential chain (env vars → config files → SSO → instance metadata)
- Paginate all list calls (use `paginateDescribeInstances`, etc.)
- Respect `discoverOptions.regions` and `discoverOptions.resourceTypes` for scoping
- Run region discovery in parallel (configurable concurrency, default 3)
- Handle access-denied errors per-service gracefully (push to `errors[]`, continue)

### 1.2 — Implement `healthCheck()`

Call `STS.GetCallerIdentity()` to verify credentials are valid. Return account ID, ARN, and user ID.

### 1.3 — Add Cost Explorer Integration

Query `CostExplorer.GetCostAndUsage()` to populate `costMonthly` on each node. Group by resource ID, filter to last 30 days, normalize to monthly.

**Note:** Cost Explorer charges $0.01 per API call. Cache results per sync (don't query per-resource).

### 1.4 — Add `espada kg sync` CLI Command

Integrate with the existing CLI to expose:
```
espada kg sync                    # Sync all registered providers
espada kg sync --provider aws     # Sync AWS only
espada kg sync --region us-east-1 # Scope to region
espada kg status                  # Show graph stats
espada kg query --orphans         # Find orphaned resources
espada kg blast-radius <id>       # Blast radius for a resource
```

### 1.5 — Test With Real Infrastructure

Create a live test (`aws-adapter.live.test.ts`) that:
- Connects to a real AWS account (gated by `ESPADA_LIVE_TEST=1`)
- Syncs at least EC2 + VPC + RDS
- Verifies nodes have correct IDs, relationships exist, cost data is populated
- Verifies re-sync detects no false drift

---

## Phase 2: Azure + GCP Adapters

**Goal:** Multi-cloud graph with resources from all three major providers in the same topology.

**Estimated effort:** 3-4 weeks

### 2.1 — Azure Discovery Adapter

Create `src/adapters/azure.ts`:

| Service | SDK Package | Resources |
|---------|------------|-----------|
| Compute | `@azure/arm-compute` | VMs, VM Scale Sets, disks |
| Network | `@azure/arm-network` | VNets, subnets, NSGs, load balancers, public IPs, application gateways |
| Storage | `@azure/arm-storage` | Storage accounts, containers |
| SQL | `@azure/arm-sql` | SQL servers, databases |
| Containers | `@azure/arm-containerservice` | AKS clusters, node pools |
| Functions | `@azure/arm-appservice` | Function apps, app service plans |
| CosmosDB | `@azure/arm-cosmosdb` | CosmosDB accounts, databases |
| Key Vault | `@azure/arm-keyvault` | Vaults |
| Redis | `@azure/arm-rediscache` | Redis caches |
| DNS | `@azure/arm-dns` | DNS zones |
| CDN | `@azure/arm-cdn` | CDN profiles, endpoints |

**Relationship rules to define:**
- VM → VNet, VM → NSG, VM → disk, VM → managed identity
- AKS → VNet, AKS → node pool VMs
- Function → App Service Plan, Function → storage account
- Load balancer → backend pool → VMs
- SQL → VNet service endpoint, SQL → private endpoint

**Authentication:** Use `@azure/identity` `DefaultAzureCredential` (env vars → managed identity → Azure CLI → VS Code).

**Cost:** Use Azure Cost Management API to populate `costMonthly`.

### 2.2 — GCP Discovery Adapter

Create `src/adapters/gcp.ts`:

| Service | API | Resources |
|---------|-----|-----------|
| Compute | `compute.googleapis.com` | VMs, instance groups, disks, VPC networks, subnets, firewalls, load balancers |
| Cloud SQL | `sqladmin.googleapis.com` | SQL instances |
| Cloud Functions | `cloudfunctions.googleapis.com` | Functions |
| Cloud Run | `run.googleapis.com` | Services |
| GKE | `container.googleapis.com` | Clusters, node pools |
| Cloud Storage | `storage.googleapis.com` | Buckets |
| Pub/Sub | `pubsub.googleapis.com` | Topics, subscriptions |
| Cloud DNS | `dns.googleapis.com` | Managed zones |
| Memorystore | `redis.googleapis.com` | Redis instances |
| Secret Manager | `secretmanager.googleapis.com` | Secrets |

**Authentication:** Use Application Default Credentials (ADC) via `google-auth-library`.

**Decision — SDK vs REST:** GCP's Node.js client libraries (`@google-cloud/*`) are large and have inconsistent APIs. Consider using the discovery-based REST client (`googleapis`) for a uniform approach, or use `@google-cloud/*` per-service for better typing.

**Cost:** Use Cloud Billing Budgets API or BigQuery billing export.

### 2.3 — Cross-Cloud Relationship Rules

Some edges span providers:
- DNS (Route53/Azure DNS/Cloud DNS) → resolves-to → compute in any provider
- CDN (CloudFront/Azure CDN/Cloud CDN) → routes-to → origin in any provider
- Kubernetes (EKS/AKS/GKE) → runs-in → VPC/VNet in the same provider

Define these as adapter-agnostic rules in `src/adapters/cross-cloud.ts`.

---

## Phase 3: Kubernetes Adapter

**Goal:** Map Kubernetes resources into the graph alongside cloud resources, with edges connecting K8s objects to the underlying cloud infrastructure.

**Estimated effort:** 2 weeks

### 3.1 — K8s Discovery Adapter

Create `src/adapters/kubernetes.ts`:

**Resources:** Namespaces, Deployments, StatefulSets, DaemonSets, Services, Ingresses, ConfigMaps, Secrets, PVCs, ServiceAccounts, NetworkPolicies, CRDs

**Relationships:**
- Deployment → runs-in → Namespace
- Service → routes-to → Deployment (via label selectors)
- Ingress → routes-to → Service
- PVC → backed-by → StorageClass → backed-by → cloud storage
- ServiceAccount → uses → IAM role (via annotations: `eks.amazonaws.com/role-arn`, `azure.workload.identity/client-id`)

**Authentication:** Use kubeconfig (default context or specified).

**Cross-cloud edges:**
- EKS cluster (AWS node) ← runs-in → K8s namespace (K8s node)
- Pod with `eks.amazonaws.com/role-arn` annotation → uses → IAM role (AWS node)
- LoadBalancer Service → backed-by → NLB/ALB (AWS node)

### 3.2 — Helm Release Grouping

Auto-create groups from Helm releases (detect via `app.kubernetes.io/managed-by: Helm` label + `meta.helm.sh/release-name`).

---

## Phase 4: Terraform State Import

**Goal:** Import Terraform state files into the graph without requiring live cloud credentials.

**Estimated effort:** 1-2 weeks

### 4.1 — Terraform State Adapter

Create `src/adapters/terraform.ts`:

- Parse `terraform.tfstate` (JSON format)
- Map `resources[].type` → `GraphResourceType` (e.g., `aws_instance` → `compute`)
- Map `resources[].provider` → `CloudProvider`
- Extract relationships from:
  - `depends_on` field → `depends-on` edges
  - Attribute references (e.g., `vpc_id`, `subnet_id`) → typed edges using the same relationship rules as the cloud adapters
- Populate `nativeId` from the resource's actual cloud ID (e.g., `attributes.id`, `attributes.arn`)

**Benefit:** Users can see their infrastructure graph without granting API access — just point at a state file.

### 4.2 — Drift Detection: State vs Live

Compare Terraform state graph against live cloud graph to find:
- Resources in state but not in cloud (deleted outside Terraform)
- Resources in cloud but not in state (created outside Terraform)
- Attribute differences (drift)

This combines the existing `engine.detectDrift()` with cross-adapter comparison.

---

## Phase 5: Incremental Sync (Event-Driven)

**Goal:** Keep the graph up-to-date in real-time instead of periodic full syncs.

**Estimated effort:** 3-4 weeks

### 5.1 — AWS CloudTrail Integration

- Subscribe to CloudTrail events (via SQS queue or EventBridge)
- Map CloudTrail event names to graph operations:
  - `RunInstances` → upsert compute node
  - `TerminateInstances` → mark node disappeared
  - `CreateSecurityGroup` → upsert security-group node + edges
  - `AttachVolume` → create `attached-to` edge
- Only re-discover the specific resource that changed (not full sync)
- Set `detectedVia: "event-stream"` on changes

### 5.2 — Azure Activity Log Integration

- Subscribe to Azure Activity Log (via Event Hub or polling)
- Map operations to graph changes:
  - `Microsoft.Compute/virtualMachines/write` → upsert VM
  - `Microsoft.Compute/virtualMachines/delete` → mark disappeared
  - `Microsoft.Network/networkSecurityGroups/write` → upsert NSG + re-discover edges

### 5.3 — GCP Audit Log Integration

- Subscribe to GCP Audit Logs (via Pub/Sub sink)
- Map operations to graph changes

### 5.4 — Sync Scheduling

Add a configurable sync schedule to the gateway:
```yaml
knowledgeGraph:
  syncInterval: 6h          # Full sync every 6 hours
  incrementalSync: true      # Use event streams between full syncs
  providers:
    - aws
    - azure
  regions:
    - us-east-1
    - eu-west-1
```

---

## Phase 6: Temporal Knowledge Graph

**Goal:** Version every graph state so users can query infrastructure at any point in time.

**Estimated effort:** 4-6 weeks

### 6.1 — Schema Changes

Add temporal versioning to the storage layer:

```sql
-- Snapshot metadata
CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  provider    TEXT,
  trigger     TEXT NOT NULL,  -- 'sync', 'manual', 'scheduled'
  node_count  INTEGER,
  edge_count  INTEGER
);

-- Node history (every version of every node)
CREATE TABLE node_versions (
  node_id       TEXT NOT NULL,
  snapshot_id   TEXT NOT NULL,
  -- all node fields --
  PRIMARY KEY (node_id, snapshot_id)
);

-- Edge history
CREATE TABLE edge_versions (
  edge_id       TEXT NOT NULL,
  snapshot_id   TEXT NOT NULL,
  -- all edge fields --
  PRIMARY KEY (edge_id, snapshot_id)
);
```

### 6.2 — Time-Travel Queries

New engine methods:
```typescript
// Get graph state at a specific point in time
engine.getTopologyAt(timestamp: string): Promise<{ nodes, edges }>

// Diff two points in time
engine.diffSnapshots(from: string, to: string): Promise<{
  addedNodes, removedNodes, changedNodes,
  addedEdges, removedEdges
}>

// Get a node's full history
engine.getNodeHistory(nodeId: string): Promise<NodeVersion[]>
```

### 6.3 — New Agent Tools

- `kg_time_travel` — "Show me what my infrastructure looked like last Tuesday"
- `kg_diff` — "What changed between January 1 and today?"
- `kg_node_history` — "Show me every change to this RDS instance"

### 6.4 — Storage Considerations

Temporal data grows linearly with sync frequency × resource count. Mitigation:
- Deduplicate unchanged nodes between snapshots (store only diffs)
- Configurable retention period (default: 90 days)
- Compact old snapshots (daily → weekly → monthly)
- Consider moving from SQLite to PostgreSQL for large deployments (>50K resources)

---

## Phase 7: Infrastructure Query Language (IQL)

**Goal:** A purpose-built query language for infrastructure that's more natural than SQL and more powerful than filters.

**Estimated effort:** 6-8 weeks

### 7.1 — Language Design

```
# Find expensive, non-compliant resources
FIND resources
WHERE provider = 'aws'
  AND cost > $1000/mo
  AND NOT tagged('Environment')
  AND NOT tagged('Owner')

# Blast radius query
FIND downstream OF 'aws:123:us-east-1:vpc:vpc-abc123'
WHERE depth <= 3

# Cross-provider path
FIND PATH FROM 'aws:*:*:load-balancer:*'
           TO 'azure:*:*:database:*'

# Drift detection
FIND resources
WHERE drifted_since('2025-01-01')
  AND severity = 'high'

# Cost aggregation
SUMMARIZE cost BY provider, resourceType
WHERE region IN ('us-east-1', 'eu-west-1')

# Temporal query
FIND resources AT '2025-06-01'
WHERE status = 'running'
DIFF WITH NOW
```

### 7.2 — Implementation

1. **Parser** — PEG.js or hand-rolled recursive descent parser → AST
2. **Planner** — Transform AST into a query plan (sequence of storage calls)
3. **Executor** — Execute the plan against `GraphStorage`
4. **Agent tool** — `kg_query` that accepts IQL strings

### 7.3 — Why This Matters

IQL is the "Apache Spark" moment — a DSL that defines a new category. It's what makes the knowledge graph a *platform* instead of a *feature*.

---

## Phase 8: Scale & Production Hardening

**Goal:** Handle enterprise-scale infrastructure (100K+ resources).

**Estimated effort:** 3-4 weeks

### 8.1 — PostgreSQL Storage Backend

Implement `PostgresGraphStorage` as an alternative to SQLite for large deployments:
- Connection pooling
- Concurrent reads/writes
- JSONB for tags/metadata (indexed)
- Recursive CTEs still work (Postgres supports them natively)
- Materialized views for stats queries

### 8.2 — Sync Performance

- Batch SDK calls with parallelism controls
- Incremental sync reduces full-sync frequency
- Delta detection: hash node attributes to skip unchanged nodes
- Pagination: stream results instead of loading all into memory

### 8.3 — Graph Query Performance

- Pre-compute and cache blast radius for frequently-queried nodes
- Index high-degree nodes for faster traversal
- Add query timeouts and depth limits (already exists: `maxTraversalDepth`)
- Consider a graph database engine (e.g., embedded DuckDB with graph extensions) for complex query patterns

### 8.4 — Multi-Account / Multi-Tenant

- Support multiple AWS accounts (Organizations), Azure subscriptions, GCP projects
- Cross-account relationship discovery (assume-role chains)
- Tenant isolation for SaaS deployments

---

## Summary: Priority Order

| Phase | What | Why First | Effort | Status |
|-------|------|-----------|--------|--------|
| **1** | Wire up AWS discovery | Without data, nothing else works | 2-3 weeks | ✅ Complete |
| **2** | Azure + GCP adapters | Multi-cloud is the value prop | 3-4 weeks | ✅ Complete |
| **3** | Kubernetes adapter | Most infra runs on K8s | 2 weeks | ✅ Complete |
| **4** | Terraform state import | Low-friction onboarding (no API creds needed) | 1-2 weeks | ✅ Complete |
| **5** | Incremental sync | Real-time graph, not stale snapshots | 3-4 weeks | ✅ Complete |
| **6** | Temporal knowledge graph | Time-travel queries, diffing, audit | 4-6 weeks | ✅ Complete |
| **7** | IQL | Category-defining feature | 6-8 weeks | ✅ Complete |
| **8** | Scale + Postgres | Enterprise readiness | 3-4 weeks | ✅ Complete |

**Total estimated effort: ~24-33 weeks** (6-8 months of focused development)

**ALL 8 PHASES ARE COMPLETE.** The knowledge graph is a fully-featured, enterprise-ready infrastructure intelligence platform.

### What Was Built (Phases 1-8)

| Component | File | LOC | Description |
|-----------|------|-----|-------------|
| AWS Adapter | `src/adapters/aws.ts` | 1,115 | Full AWS discovery: EC2, VPC, RDS, Lambda, S3, ECS, ALB, IAM, SQS, SNS, etc. |
| Azure Adapter | `src/adapters/azure.ts` | 883 | Azure Resource Graph discovery: VMs, VNets, NSGs, SQL, AKS, Functions, etc. |
| GCP Adapter | `src/adapters/gcp.ts` | 862 | GCP Cloud Asset Inventory: Compute, GKE, Cloud SQL, Cloud Functions, etc. |
| Kubernetes Adapter | `src/adapters/kubernetes.ts` | 700+ | K8s discovery: Deployments, Services, Ingresses, ConfigMaps, cross-cloud annotations, Helm releases |
| Terraform Adapter | `src/adapters/terraform.ts` | 1,194 | Terraform state import: 50+ resource type mappings, drift detection |
| Cross-Cloud | `src/adapters/cross-cloud.ts` | 488 | Cross-cloud relationship discovery: DNS, IAM, networking, data flow |
| Monitoring | `src/monitoring.ts` | 1,326 | CloudTrail/Azure Activity Log/GCP Audit Log event sources, alerting, scheduling |
| Governance | `src/governance.ts` | 805 | Change governance: risk scoring, approval workflows, audit trail |
| Report | `src/report.ts` | — | Infrastructure scan reports: Markdown, HTML, JSON, terminal |
| Temporal KG | `src/temporal.ts` | 500+ | Snapshots, time-travel, diffing, evolution summary, retention |
| IQL Lexer | `src/iql/lexer.ts` | 230 | Tokenizer with $cost/mo syntax, comments, 25+ keywords |
| IQL Parser | `src/iql/parser.ts` | 310 | Recursive descent parser: FIND/SUMMARIZE/WHERE/AT/DIFF/LIMIT |
| IQL Executor | `src/iql/executor.ts` | 430 | Query execution with pre/post-filtering, PATH glob matching |
| IQL Types | `src/iql/types.ts` | 165 | AST node types and query result types |
| Agent Tools (20) | `src/tools.ts` | 1,500+ | 13 core + 6 temporal + 1 IQL (kg_query) |
| CLI | `src/infra-cli.ts` | 1,500+ | scan, report, drift, cloud-scan, audit, monitor, timeline, snapshot, query |
| PostgreSQL Storage | `src/storage/postgres-store.ts` | 800+ | Enterprise PostgreSQL backend: JSONB+GIN, recursive CTEs, materialized views, connection pooling, schema-based tenant isolation |
| Sync Performance | `src/sync.ts` | 360+ | Delta hashing (SHA-256), batch/pool concurrency, paginated discovery (AsyncGenerator), incremental sync coordinator |
| Query Cache | `src/cache.ts` | 350+ | LRU+TTL cache: blast-radius/stats/cost categories, node-aware invalidation, hit-rate monitoring |
| Multi-Tenant | `src/tenant.ts` | 500+ | Account registry, tenant lifecycle management, cross-account relationship discovery, tenant-scoped queries |
