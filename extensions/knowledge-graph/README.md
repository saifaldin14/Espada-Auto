# Infrastructure Knowledge Graph

A graph-based infrastructure topology engine for Espada. Discovers cloud resources and relationships across AWS, Azure, GCP, Kubernetes, and Terraform — then provides blast-radius analysis, drift detection, cost attribution, governance workflows, temporal snapshots, and a custom query language (IQL).

## Status

> **28,000+ LOC** of source across 50 files · **14,000+ LOC** of tests across 18 files · **643+ tests passing**

| Layer | Status | Notes |
|-------|--------|-------|
| **Core types** | Production | 50 resource types, 43 relationship types, 9 node statuses |
| **SQLite storage** | Production | WAL mode, recursive CTE traversal, 15+ indexes, JSONB metadata |
| **PostgreSQL storage** | Production | JSONB queries, materialized views, schema-based multi-tenancy |
| **InMemory storage** | Production | BFS traversal, full interface parity, ideal for tests |
| **GraphEngine** | Production | Sync, blast radius, dependency chains, drift, cost, topology |
| **Graph queries** | Production | Shortest path, orphans, SPOFs (Tarjan's), clusters, critical nodes |
| **Graph export** | Production | JSON, DOT (Graphviz), Mermaid with filtering |
| **IQL query language** | Production | Lexer + parser + executor, `FIND`/`WHERE`/`CONNECTED TO`/`AT`/aggregations |
| **Governance** | Production | 7-factor risk scoring, approval workflows, audit trails |
| **Temporal** | Production | Point-in-time snapshots, time travel, diffing, evolution summaries |
| **Monitoring** | Production | CloudTrail/Azure/GCP event sources, 5 alert rules, mock mode |
| **AWS adapter** | Production | 2,096 LOC orchestrator + 10 domain modules, 50+ relationship rules, Cost Explorer, SecurityHub, CloudTrail |
| **Azure adapter** | Production | 885 LOC, ~20 relationship rules, static cost estimates |
| **GCP adapter** | Production | 861 LOC, ~20 relationship rules, static cost estimates |
| **Kubernetes adapter** | Production | 1,145 LOC, 16 kind mappings, namespace/workload/network discovery |
| **Terraform adapter** | Production | 1,207 LOC, 100+ resource type mappings, HCL state parsing |
| **Cross-cloud adapter** | Production | 487 LOC, 5 discovery rules for multi-cloud relationships |
| **Plugin wiring** | Production | Entry point, storage factory, engine init, service registration |
| **CLI commands** | Production | 12+ subcommands under `espada graph` + `espada infra` |
| **Agent tools** | Production | 20 tools (graph core, governance, temporal, IQL) |
| **Background sync** | Production | Light sync (15min) + full sync (6hr) with drift detection |
| **Gateway methods** | Production | RPC endpoints for stats, blast-radius, topology |
| **Report generation** | Production | Markdown, HTML, JSON, terminal output formats |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Plugin Entry Point                            │
│   register() · storage factory · service · gateway methods           │
├──────────┬──────────────┬──────────┬──────────────┬──────────────────┤
│   CLI    │  Agent Tools  │  Export  │   Gateway    │     Reports     │
│ graph *  │  20 tools     │ JSON/DOT │  stats/blast │  MD/HTML/JSON   │
│ infra *  │  IQL queries  │ Mermaid  │  topology    │  terminal       │
├──────────┴──────────────┴──────────┴──────────────┴──────────────────┤
│                         GraphEngine                                  │
│   sync() · blastRadius() · drift() · cost() · timeline() · …        │
├──────────────┬─────────────────────┬─────────────┬──────────────────┤
│   Adapters   │      Storage        │   Queries   │   Governance     │
│  AWS (prod)  │  SQLite (prod)      │  BFS/DFS    │  Risk scoring    │
│  Azure       │  PostgreSQL (prod)  │  SPOFs      │  Approvals       │
│  GCP         │  InMemory (test)    │  Clusters   │  Audit trails    │
│  Kubernetes  │                     │  Paths      │                  │
│  Terraform   ├─────────────────────┤  Critical   ├──────────────────┤
│  Cross-cloud │   Temporal Store    │  Orphans    │   Monitoring     │
│              │  Snapshots · Diff   │             │  Alert rules     │
│              │  Time travel · AT   │             │  Event sources   │
├──────────────┴─────────────────────┼─────────────┴──────────────────┤
│              IQL Engine            │       Cache (LRU+TTL)          │
│   Lexer → Parser → Executor       │  Category invalidation         │
│   FIND · WHERE · CONNECTED TO     │  Hit-rate stats                │
│   AT (temporal) · Aggregations     │                                │
└────────────────────────────────────┴────────────────────────────────┘
```

### AWS Adapter Module Structure

The AWS adapter is decomposed into focused domain modules:

```
src/adapters/aws/
├── index.ts           # Module re-exports
├── types.ts           # AWS-specific type definitions
├── constants.ts       # Relationship rules, cost tables, service mappings
├── utils.ts           # Field resolution, ID extraction, node matching
├── context.ts         # AwsAdapterContext interface for module delegation
├── compute.ts         # EC2 deeper: ASGs, Load Balancers, Target Groups
├── database.ts        # ElastiCache + RDS deeper discovery
├── organization.ts    # AWS Organization: accounts, OUs, SCPs
├── backup.ts          # AWS Backup vaults, plans, protected resources
├── automation.ts      # EventBridge rules, Step Functions
├── cicd.ts            # CodePipeline, CodeBuild, CodeDeploy
├── cognito.ts         # User Pools, Identity Pools, App Clients
├── enrichment.ts      # Tags, events, observability, compliance
├── cost.ts            # Forecasting, optimization, unused detection
└── security.ts        # Security posture, GuardDuty, CloudTrail
```

## Quick Start

```bash
cd extensions/knowledge-graph
pnpm install
pnpm test              # vitest — 643+ tests
```

### Programmatic Usage

```typescript
import { GraphEngine } from "@espada/knowledge-graph/engine";
import { InMemoryGraphStorage } from "@espada/knowledge-graph/storage";
import { AwsDiscoveryAdapter } from "@espada/knowledge-graph/adapters";

const storage = new InMemoryGraphStorage();
const engine = new GraphEngine({ storage });

engine.registerAdapter(new AwsDiscoveryAdapter({ accountId: "123456789" }));

// Discover resources and persist to graph
await engine.sync();

// Blast radius: "what breaks if I touch this subnet?"
const blast = await engine.getBlastRadius("aws:123:us-east-1:subnet:subnet-abc", 3);
console.log(`${blast.nodes.size} resources affected, $${blast.totalCostMonthly}/mo at risk`);

// Dependency chain: "what does this Lambda depend on?"
const deps = await engine.getDependencyChain("aws:123:us-east-1:serverless-function:my-func", "upstream");

// IQL: custom queries
const result = await engine.executeIQL('FIND compute WHERE provider = "aws" AND status = "running"');
```

### IQL (Infrastructure Query Language)

```sql
-- Find all running EC2 instances in production
FIND compute WHERE status = "running" AND tags.env = "production"

-- Find databases connected to a specific VPC
FIND database CONNECTED TO vpc WHERE nativeId = "vpc-abc123"

-- Time travel: what did the graph look like yesterday?
FIND * AT "2024-01-15T00:00:00Z"

-- Aggregations for cost analysis
FIND compute WHERE provider = "aws" | sum(costMonthly)
FIND * WHERE provider = "aws" | group_by(resourceType) | count()
```

### Graph Queries

```typescript
import { shortestPath, findOrphans, findSinglePointsOfFailure, findClusters } from "@espada/knowledge-graph/queries";

const path = await shortestPath(storage, "node-a", "node-b");
const orphans = await findOrphans(storage);
const spofs = await findSinglePointsOfFailure(storage);  // Tarjan's algorithm
const clusters = await findClusters(storage);
```

## Node ID Format

All nodes use a deterministic canonical ID:

```
{provider}:{accountId}:{region}:{resourceType}:{nativeId}
```

Examples:
- `aws:123456789:us-east-1:compute:i-abc123`
- `azure:sub-id:eastus:database:my-sql-server`
- `gcp:project-id:us-central1:serverless-function:my-func`
- `kubernetes:cluster-id:default:deployment:nginx`
- `terraform:local::compute:aws_instance.web`

## Agent Tools (20)

| Category | Tools | Count |
|----------|-------|-------|
| Graph Core | `kg_blast_radius`, `kg_dependencies`, `kg_cost`, `kg_drift`, `kg_spof_analysis`, `kg_path`, `kg_orphans`, `kg_status`, `kg_export` | 9 |
| Governance | `kg_audit_trail`, `kg_request_change`, `kg_governance_summary`, `kg_pending_approvals` | 4 |
| Temporal | `kg_time_travel`, `kg_diff`, `kg_node_history`, `kg_evolution`, `kg_snapshot`, `kg_list_snapshots` | 6 |
| IQL | `kg_query` | 1 |

## Relationship Types (43)

| Type | Example |
|------|---------|
| `runs-in` | EC2 → VPC, Lambda → Subnet |
| `contains` | VPC → Subnet, Subnet → Instance |
| `depends-on` | App → Database |
| `secured-by` | EC2 → Security Group |
| `routes-to` | ALB → Target Group |
| `triggers` | S3 Event → Lambda |
| `publishes-to` | App → SQS Queue |
| `replicates` | RDS Primary → Read Replica |
| `attached-to` | EBS Volume ↔ EC2 |
| `uses` | Lambda → IAM Role |
| `monitors` | CloudWatch → EC2 |
| `logs-to` | App → CloudWatch Logs |
| `load-balances` | ALB → Target instances |
| `backed-by` | CloudFront → S3 Origin |
| `encrypts-with` | S3 → KMS Key |
| `managed-by` | Arc machine → Azure |
| …and 27 more | See `src/types.ts` |

## Cloud Adapter Feature Matrix

| Feature | AWS | Azure | GCP | K8s | Terraform |
|---------|-----|-------|-----|-----|-----------|
| Resource discovery | ✅ | ✅ | ✅ | ✅ | ✅ |
| Relationship extraction | 50+ rules | ~20 rules | ~20 rules | 16 mappings | 100+ mappings |
| Incremental sync | ✅ CloudTrail | ❌ Full rescan | ❌ Full rescan | ❌ Full rescan | ❌ Full rescan |
| Live cost data | ✅ Cost Explorer | ❌ Static | ❌ Static | ❌ Static | ❌ Static |
| Security posture | ✅ SecurityHub + GuardDuty | ❌ | ❌ | ❌ | ❌ |
| Cost forecasting | ✅ CostManager | ❌ | ❌ | ❌ | ❌ |
| Optimization recs | ✅ Rightsizing + RI | ❌ | ❌ | ❌ | ❌ |

## File Structure

```
extensions/knowledge-graph/
├── package.json
├── tsconfig.json
├── espada.plugin.json
├── KNOWLEDGE_GRAPH_AUDIT.md    # Comprehensive audit & improvement plan
├── README.md
├── src/
│   ├── types.ts                # Core type system (50 resource types, 43 rel types)
│   ├── engine.ts               # GraphEngine orchestrator (724 LOC)
│   ├── queries.ts              # Graph algorithms (374 LOC)
│   ├── tools.ts                # 20 agent tools (1,525 LOC)
│   ├── governance.ts           # Risk scoring + approval workflows (804 LOC)
│   ├── temporal.ts             # Snapshots, time travel, diffing (684 LOC)
│   ├── monitoring.ts           # Event sources + alert rules (1,325 LOC)
│   ├── sync.ts                 # SHA-256 delta sync (307 LOC)
│   ├── cache.ts                # LRU+TTL cache (422 LOC)
│   ├── tenant.ts               # Multi-tenancy, cross-account (612 LOC)
│   ├── report.ts               # MD/HTML/JSON/terminal reports (600 LOC)
│   ├── export.ts               # JSON, DOT, Mermaid export (244 LOC)
│   ├── policy-scan-tool.ts     # Cross-extension policy bridge (407 LOC)
│   ├── cli.ts                  # `espada graph` commands (519 LOC)
│   ├── infra-cli.ts            # `espada infra` commands (1,511 LOC)
│   ├── iql/                    # Infrastructure Query Language
│   │   ├── lexer.ts            # Tokenizer (270 LOC)
│   │   ├── parser.ts           # AST builder (390 LOC)
│   │   ├── executor.ts         # Query executor (648 LOC)
│   │   └── types.ts            # IQL AST types (170 LOC)
│   ├── storage/
│   │   ├── sqlite-store.ts     # SQLite backend (1,090 LOC)
│   │   ├── postgres-store.ts   # PostgreSQL backend (1,182 LOC)
│   │   ├── memory-store.ts     # InMemory backend (600 LOC)
│   │   └── index.ts
│   ├── adapters/
│   │   ├── types.ts            # GraphDiscoveryAdapter interface
│   │   ├── aws.ts              # AWS orchestrator (2,096 LOC)
│   │   ├── aws/                # AWS domain modules (15 files)
│   │   ├── azure.ts            # Azure adapter (885 LOC)
│   │   ├── gcp.ts              # GCP adapter (861 LOC)
│   │   ├── kubernetes.ts       # Kubernetes adapter (1,145 LOC)
│   │   ├── terraform.ts        # Terraform adapter (1,207 LOC)
│   │   ├── cross-cloud.ts      # Cross-cloud relationships (487 LOC)
│   │   └── index.ts
│   └── *.test.ts               # 18 test files (14,000+ LOC, 643+ tests)
```

## Testing

```bash
pnpm test                          # All tests (643+)
pnpm test:coverage                 # With V8 coverage
pnpm test src/engine.test.ts       # Specific file
pnpm test src/iql/iql.test.ts      # IQL tests (94 tests)
pnpm test src/aws-adapter.test.ts  # AWS adapter (117 tests)
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | SQLite + PostgreSQL | SQLite for embedded/zero-ops; PostgreSQL for enterprise multi-tenancy |
| Node ID format | `provider:account:region:type:nativeId` | Deterministic, collision-free, human-readable |
| Query language | IQL (custom) | Domain-specific, supports temporal AT, graph traversal, aggregations |
| Change tracking | Append-only log | Timeline reconstruction, audit trail, drift detection |
| Edge confidence | 0.0–1.0 float | API-derived (0.95) vs inferred (0.7) vs user-defined (1.0) |
| AWS decomposition | Context-based delegation | AwsAdapterContext binds class internals; domain modules are pure functions |
| Traversal | Recursive CTE (SQLite) / BFS (InMemory) | Handles cycles, respects depth limits, tracks paths |
| SPOF detection | Tarjan's algorithm | O(V+E) articulation point detection |
| Governance | 7-factor risk scoring | Auto-approve ≤30, block ≥70, manual review in between |

## Contributing

1. Follow Espada conventions (see root `AGENTS.md`)
2. Keep files under ~500 LOC (split/refactor as needed)
3. Add tests for new functionality
4. Run `pnpm lint && pnpm build && pnpm test` before committing
