# @infra-graph/core

**Infrastructure Knowledge Graph** — scan, query, and analyze cloud infrastructure across AWS, Azure, GCP, and Kubernetes. 30 AI-agent tools, a purpose-built query language (IQL), and an MCP server for Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

```
               ┌────────────────────────────────────────┐
               │         @infra-graph/core               │
               │                                        │
 Cloud APIs ──▶│  Adapters ──▶ Graph Engine ──▶ Tools   │──▶ Any AI Agent
 Terraform  ──▶│  (AWS/Azure/GCP/K8s/Terraform)         │    (via MCP)
               │                                        │
               │  IQL ──▶ Compliance ──▶ Cost Analysis  │──▶ CLI
               │  RBAC ──▶ Governance ──▶ Temporal      │──▶ HTTP API
               └────────────────────────────────────────┘
```

| Capability | Details |
|------------|---------|
| **Cloud Scanning** | AWS (59 resource types), Azure (57), GCP (41), Kubernetes (16), Terraform state (104 mappings) |
| **IQL Query Language** | `FIND resources WHERE type = 'ec2' AND tag.env = 'prod'` — purpose-built with full parser |
| **30 AI Tools** | Blast radius, SPOF detection, drift, cost attribution, compliance, remediation, supply chain |
| **4 Compliance Frameworks** | SOC 2, HIPAA, PCI-DSS, ISO 27001 with concrete control implementations |
| **MCP Server** | Native integration with Claude Desktop, Cursor, Windsurf, Cody, Continue |
| **Storage Backends** | In-memory, SQLite, PostgreSQL (multi-tenant), SQLite-temporal |
| **Enterprise Features** | RBAC, multi-tenancy, OPA policy engine, audit trail, federation, governance workflows |

## Quick Start

### Install

```bash
npm install -g @infra-graph/core
```

### Scan Infrastructure

```bash
# From Terraform state (no cloud credentials needed)
infra-graph infra scan --terraform ./terraform.tfstate

# From live AWS
infra-graph infra cloud-scan --aws --aws-region us-east-1 --db ./infra.db

# Multi-cloud (all at once)
infra-graph infra cloud-scan --aws --azure --gcp --db ./infra.db
```

### Query with IQL

```bash
infra-graph infra query --db ./infra.db "FIND resources WHERE type = 'ec2' AND tag.env = 'prod'"
```

### MCP Server (Claude Desktop, Cursor, etc.)

```bash
infra-graph mcp --db ./infra.db
```

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "infra-graph": {
      "command": "npx",
      "args": ["@infra-graph/core", "mcp", "--db", "~/.infra-graph/graph.db"]
    }
  }
}
```

Then ask your AI assistant: *"What's the blast radius if I delete this VPC?"*

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

## Tools Reference (30 MCP Tools)

### Core Graph
| Tool | Description |
|------|-------------|
| `kg_blast_radius` | Blast radius of changing/removing a resource |
| `kg_dependencies` | Dependency chain (upstream/downstream/both) |
| `kg_cost` | Cost attribution by resource/provider |
| `kg_drift` | Configuration drift detection |
| `kg_spof_analysis` | Single Point of Failure detection (Tarjan's) |
| `kg_path` | Shortest path between resources |
| `kg_orphans` | Orphaned/unattached resources |
| `kg_status` | Graph statistics |
| `kg_export` | Export (JSON/DOT/Mermaid) |

### Governance & Temporal
| Tool | Description |
|------|-------------|
| `kg_audit_trail` | Change audit trail |
| `kg_request_change` | Change request with risk scoring |
| `kg_governance_summary` | Governance dashboard |
| `kg_pending_approvals` | Pending approvals |
| `kg_time_travel` | View graph at any point in time |
| `kg_diff` | Snapshot diff |
| `kg_node_history` | Per-resource history |
| `kg_evolution` | Infrastructure evolution trends |
| `kg_snapshot` | Manual snapshot |
| `kg_list_snapshots` | Browse snapshots |

### Analysis
| Tool | Description |
|------|-------------|
| `kg_query` | Execute IQL queries |
| `kg_compliance` | Compliance assessment (SOC 2/HIPAA/PCI-DSS/ISO 27001) |
| `kg_recommendations` | Optimization recommendations |
| `kg_agents` | Agent activity report |
| `kg_ask` | Natural language → IQL |
| `kg_remediation` | Generate IaC patches (Terraform/CloudFormation) |
| `kg_supply_chain` | Supply chain security |
| `kg_visualize` | Graph visualization (Cytoscape/D3) |
| `kg_rbac` | RBAC policy management |
| `kg_benchmark` | Performance benchmarks (1K/10K/100K) |
| `kg_export_extended` | Extended export (YAML/CSV/OpenLineage) |

## IQL — Infrastructure Query Language

```sql
FIND resources WHERE type = 'ec2' AND tag.env = 'prod'
FIND DOWNSTREAM OF 'vpc-abc123'
FIND PATH FROM 'vpc-prod' TO 'rds-primary'
SUMMARIZE cost BY type
FIND resources DIFF WITH '2025-01-01T00:00:00Z'
FIND resources WHERE drifted_since('2025-06-01')
```

**Operators:** `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `IN`, `MATCHES`, `AND`, `OR`, `NOT`
**Functions:** `tagged()`, `drifted_since()`, `has_edge()`, `created_after()`, `created_before()`
**Aggregates:** `SUM()`, `AVG()`, `MIN()`, `MAX()`, `COUNT`

## Programmatic Usage

```typescript
import { GraphEngine } from "@infra-graph/core/engine";
import { SQLiteGraphStorage } from "@infra-graph/core/storage";
import { buildToolRegistry } from "@infra-graph/core/mcp";
import { parseIQL, executeQuery } from "@infra-graph/core/iql";

const storage = new SQLiteGraphStorage("./infra.db");
const engine = new GraphEngine(storage);

// Execute IQL query
const ast = parseIQL("FIND resources WHERE type = 'ec2'");
const results = executeQuery(ast, storage);

// Use tools programmatically
const tools = buildToolRegistry({ engine, storage });
const blast = await tools.find(t => t.name === "kg_blast_radius")!
  .execute({ resourceId: "vpc-abc123", depth: 3 });

// Build custom MCP server
import { McpServer } from "@infra-graph/core/mcp";
const server = new McpServer(tools);
```

## Contributing

1. Keep files under ~500 LOC (split/refactor as needed)
2. Add tests for new functionality
3. Run `pnpm lint && pnpm build && pnpm test` before committing
