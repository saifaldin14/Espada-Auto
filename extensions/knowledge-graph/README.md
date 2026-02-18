# Infrastructure Knowledge Graph

A graph-based infrastructure topology engine for Espada. Discovers cloud resources and their relationships, stores them in a queryable graph, and provides blast-radius analysis, drift detection, cost attribution, and structural queries (shortest path, SPOFs, critical paths).

## Status

| Layer | Status | Notes |
|-------|--------|-------|
| **Core types** | Production | 450+ lines, 24 resource types, 24 relationship types |
| **SQLite storage** | Production | Schema v1, recursive CTE traversal, WAL mode, 15+ indexes |
| **InMemory storage** | Production | BFS traversal, full interface parity, ideal for tests |
| **GraphEngine** | Production | Sync, blast radius, dependency chains, drift, cost, topology |
| **Graph queries** | Production | Shortest path, orphans, SPOFs (Tarjan's), clusters, critical nodes |
| **Graph export** | Production | JSON, DOT (Graphviz), Mermaid formats with filtering |
| **Plugin wiring** | Production | Entry point with storage factory, engine init, service registration |
| **CLI commands** | Production | 12 subcommands under `espada graph` (status, sync, blast, deps, etc.) |
| **Agent tools** | Production | 9 tools (blast radius, deps, cost, drift, SPOF, path, orphans, status, export) |
| **Background sync** | Production | Light sync (15min) + full sync (6hr) with drift detection |
| **Gateway methods** | Production | RPC endpoints for stats, blast-radius, topology |
| **AWS adapter** | Skeleton | 31 relationship rules, 17 service mappings, utility functions production-ready |
| **Azure/GCP adapters** | Not started | Provider-agnostic core is ready |
| **Semantic search** | Not started | See Phase 5 below |
| **Scheduled sync** | Not started | See Phase 6 below |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Plugin Entry Point                       │
│  register() · storage factory · service · gateway methods     │
├──────────┬────────────────────────┬──────────┬────────────────┤
│   CLI    │      Agent Tools       │  Export  │    Gateway     │
│ 12 cmds  │  9 tools (blast, deps  │ JSON/DOT │  stats/blast/  │
│ graph *  │  cost, drift, SPOF...) │ Mermaid  │  topology RPC  │
├──────────┴────────────────────────┴──────────┴────────────────┤
│                       GraphEngine                             │
│  sync() · blastRadius() · drift() · cost() · timeline() · …  │
├──────────────┬─────────────────────┬──────────────────────────┤
│   Adapters   │      Storage        │    Queries               │
│  AWS (skel)  │  SQLite (prod)      │  shortestPath            │
│  Azure (-)   │  InMemory (prod)    │  findOrphans             │
│  GCP (-)     │                     │  findSPOFs               │
│  K8s (-)     │                     │  findClusters            │
│              │                     │  criticalNodes           │
└──────────────┴─────────────────────┴──────────────────────────┘
```

## Quick Start (Development)

```bash
cd extensions/knowledge-graph
pnpm install
pnpm test              # vitest
```

### Programmatic Usage

```typescript
import { GraphEngine } from "@espada/knowledge-graph/engine";
import { InMemoryGraphStorage } from "@espada/knowledge-graph/storage";
import { AwsDiscoveryAdapter } from "@espada/knowledge-graph/adapters";

const storage = new InMemoryGraphStorage();
const engine = new GraphEngine({ storage });

// Register an adapter (once SDK wiring is complete)
engine.registerAdapter(new AwsDiscoveryAdapter({ accountId: "123456789" }));

// Sync discovers resources and persists to graph
await engine.sync();

// Blast radius: "what breaks if I touch this subnet?"
const blast = await engine.getBlastRadius("aws:123:us-east-1:subnet:subnet-abc", 3);
console.log(`${blast.nodes.size} resources affected, $${blast.totalCostMonthly}/mo at risk`);

// Dependency chain: "what does this Lambda depend on?"
const deps = await engine.getDependencyChain("aws:123:us-east-1:serverless-function:my-func", "upstream");

// Cost attribution: total spend for a service group
const cost = await engine.getGroupCost("group-id");
console.log(`${cost.label}: $${cost.totalMonthly}/mo`);
```

### Graph Queries

```typescript
import { shortestPath, findOrphans, findSinglePointsOfFailure, findClusters } from "@espada/knowledge-graph/queries";

// Shortest path between any two resources
const path = await shortestPath(storage, "node-a", "node-b");

// Find unconnected resources (cleanup candidates)
const orphans = await findOrphans(storage);

// Find single points of failure (Tarjan's algorithm)
const spofs = await findSinglePointsOfFailure(storage);

// Find connected clusters
const clusters = await findClusters(storage);
```

## File Structure

```
extensions/knowledge-graph/
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript config
├── espada.plugin.json        # Espada plugin registration
├── README.md                 # This file
├── src/
│   ├── types.ts              # Core type system (GraphNode, GraphEdge, etc.)
│   ├── engine.ts             # GraphEngine orchestrator
│   ├── queries.ts            # Graph algorithms
│   ├── storage/
│   │   ├── sqlite-store.ts   # SQLite implementation (better-sqlite3)
│   │   ├── memory-store.ts   # InMemory implementation
│   │   └── index.ts
│   ├── adapters/
│   │   ├── types.ts          # GraphDiscoveryAdapter interface
│   │   ├── aws.ts            # AWS adapter (skeleton + relationship rules)
│   │   └── index.ts
│   ├── graph-storage.test.ts # Storage contract tests
│   ├── engine.test.ts        # Engine tests
│   ├── queries.test.ts       # Query algorithm tests
│   └── aws-adapter.test.ts   # AWS utility function tests
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

## Relationship Types

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
| ...and 12 more | See `types.ts` |

---

## Deferred Phases — Implementation Guide

The following phases are designed and documented but not yet implemented. Each section describes exactly what to build and how it integrates with the production-ready core.

### Phase 4: Integration Wiring ✅ COMPLETE

**Goal**: Connect the graph engine to Espada's plugin system.

All Phase 4 components are implemented and tested (94 tests passing):

#### 4a. Extension Entry Point (`index.ts`) ✅

- Plugin registration with `register(api)` lifecycle
- Storage factory (SQLite/InMemory based on config)
- GraphEngine initialization with configurable `maxTraversalDepth` and drift detection
- Configurable sync intervals and adapter selection

#### 4b. Confirmation Workflow Integration — Deferred

Not yet implemented. Wire blast radius into `@espada/infrastructure` confirmation system when that extension matures.

#### 4c. CLI Commands (`src/cli.ts`) ✅

12 subcommands under `espada graph`:

| Command | Description |
|---------|-------------|
| `espada graph status` | Show graph statistics |
| `espada graph sync` | Run full discovery sync |
| `espada graph blast <resource>` | Show blast radius |
| `espada graph deps <resource>` | Show dependency chain |
| `espada graph orphans` | List unconnected resources |
| `espada graph spofs` | List single points of failure |
| `espada graph cost` | Cost attribution breakdown |
| `espada graph drift` | Detect configuration drift |
| `espada graph path <from> <to>` | Shortest path between resources |
| `espada graph clusters` | Find connected resource clusters |
| `espada graph critical` | Find critical nodes (high fan-in/out) |
| `espada graph export` | Export topology as JSON/DOT/Mermaid |
| `espada graph timeline <resource>` | Show change timeline |

#### 4d. Agent Tools (`src/tools.ts`) ✅

9 tools registered via `registerGraphTools()`:

| Tool | Description |
|------|-------------|
| `kg_blast_radius` | Blast radius analysis with hop distances and cost-at-risk |
| `kg_dependencies` | Upstream/downstream dependency chains |
| `kg_cost` | Cost attribution by resource, group, or provider |
| `kg_drift` | Drift detection (drifted, disappeared, new resources) |
| `kg_spof_analysis` | Single points of failure via Tarjan's algorithm |
| `kg_path` | Shortest path between two resources |
| `kg_orphans` | Unconnected resource detection |
| `kg_status` | Graph statistics and health |
| `kg_export` | Export topology in JSON/DOT/Mermaid format |

#### 4e. Graph Export (`src/export.ts`) ✅

Export infrastructure topology in three formats:
- **JSON**: Full graph data for programmatic analysis
- **DOT**: Graphviz format for visualization
- **Mermaid**: Markdown-embeddable diagrams for docs

Supports filtering by `NodeFilter`, cost inclusion, and `maxNodes` safety limit.

#### 4f. Background Sync Service ✅

Registered via `api.registerService()`:
- Light sync every 15 min (critical resource types only)
- Full sync every 6 hours with automatic drift detection
- Configurable intervals via plugin config

#### 4g. Gateway RPC Methods ✅

Three RPC endpoints via `api.registerGatewayMethod()`:
- `knowledge-graph/stats` — graph statistics
- `knowledge-graph/blast-radius` — blast radius query
- `knowledge-graph/topology` — topology summary

### Phase 5: Semantic Search Layer

**Goal**: Enable natural-language queries over the graph using LanceDB.

#### Integration Points

Espada already has `extensions/memory-lancedb` for vector storage. The knowledge graph can reuse this pattern:

1. On every sync, embed node metadata (name, tags, type, region, relationships) into vectors
2. Store vectors in a LanceDB table alongside the node ID
3. Add a `search(query: string)` method to GraphEngine that:
   - Embeds the query
   - Finds nearest neighbor nodes in LanceDB
   - Returns the nodes with their graph context (edges, groups)

Example queries this enables:
- "Show me all databases in production"
- "What resources are in the payment service?"
- "Find Lambda functions connected to SQS"

#### Implementation Sketch

```typescript
// src/semantic.ts
import { LanceDB } from "lancedb";

export class GraphSemanticIndex {
  constructor(private db: LanceDB, private storage: GraphStorage) {}
  
  async indexNode(node: GraphNode): Promise<void> {
    const text = `${node.name} ${node.resourceType} ${node.provider} ${node.region} ${Object.entries(node.tags).map(([k,v]) => `${k}=${v}`).join(" ")}`;
    const embedding = await embed(text);
    await this.db.upsert("graph_nodes", { id: node.id, vector: embedding, text });
  }
  
  async search(query: string, limit = 10): Promise<GraphNode[]> {
    const embedding = await embed(query);
    const results = await this.db.search("graph_nodes", embedding, limit);
    return Promise.all(results.map(r => this.storage.getNode(r.id)));
  }
}
```

### Phase 6: Scheduled Sync & Event-Driven Updates

**Goal**: Keep the graph continuously up-to-date.

#### 6a. Scheduled Full Sync

Use the existing Espada scheduling infrastructure (if available) or implement a simple interval:

```typescript
// In plugin setup
const LIGHT_SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes
const FULL_SYNC_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

setInterval(() => engine.sync({ discoverOptions: { resourceTypes: criticalTypes } }), LIGHT_SYNC_INTERVAL);
setInterval(() => engine.sync(), FULL_SYNC_INTERVAL);
```

#### 6b. CloudTrail Event Subscription

For near-real-time updates, subscribe to CloudTrail events:

1. Set up an SQS queue subscribed to CloudTrail events
2. Poll the queue for resource change events
3. Map CloudTrail event names to graph operations:
   - `RunInstances` → upsert compute node
   - `TerminateInstances` → mark node disappeared
   - `CreateSecurityGroup` → upsert security-group node
   - `AuthorizeSecurityGroupIngress` → upsert edge

This requires the adapter's `supportsIncrementalSync()` to return `true` and implementing an `onEvent(event)` method.

### Phase 7: Full AWS Adapter Implementation

**Goal**: Wire up actual AWS SDK calls for all 17 service mappings.

The skeleton in `src/adapters/aws.ts` provides:
- `AWS_SERVICE_MAPPINGS`: maps each resource type to its SDK client and methods
- `AWS_RELATIONSHIP_RULES`: 31 rules for extracting edges from API responses
- `resolveFieldPath()`: production-ready field path resolver
- `extractResourceId()`: ARN/URL parser
- `extractRelationships()`: applies rules to raw API responses

#### Per-Service Implementation Pattern

For each service mapping, implement the `discoverService()` method body:

```typescript
private async discoverService(mapping: AwsServiceMapping, region: string): Promise<...> {
  const client = new SDK[mapping.awsService]Client({ region });
  const response = await client[mapping.listMethod]({});
  const items = resolveFieldPath(response, mapping.responseKey);
  
  const nodes: GraphNodeInput[] = [];
  const edges: GraphEdgeInput[] = [];
  
  for (const item of items) {
    const nativeId = resolveFieldPath(item, mapping.idField)[0];
    const name = resolveFieldPath(item, mapping.nameField)[0] ?? nativeId;
    const nodeId = buildAwsNodeId(this.config.accountId, region, mapping.graphType, nativeId);
    
    nodes.push({
      id: nodeId,
      name,
      provider: "aws",
      accountId: this.config.accountId,
      region,
      resourceType: mapping.graphType,
      nativeId,
      status: mapAwsStatus(item),
      tags: extractTags(item),
      metadata: item,
      costMonthly: null, // Phase 7b: Cost Explorer integration
      owner: null,
    });
    
    // Extract relationships using the production-ready rules engine
    edges.push(...this.extractRelationships(nodeId, mapping.graphType, item, this.config.accountId, region));
  }
  
  return { discoveredNodes: nodes, discoveredEdges: edges };
}
```

#### Priority Order for Service Implementation

1. **VPC, Subnet, Security Group** — foundational networking (most edges reference these)
2. **EC2** — highest relationship density
3. **RDS** — critical data tier
4. **Lambda** — serverless with many triggers/dependencies
5. **ALB/NLB** — routing layer
6. **S3** — storage with event triggers
7. **SQS, SNS** — messaging
8. **ECS** — container workloads
9. **API Gateway, CloudFront** — edge layer
10. **IAM Roles** — security relationships
11. **Route53, SecretsManager, ElastiCache, DynamoDB** — supporting services

#### Cost Explorer Integration

Add `costMonthly` to nodes by querying AWS Cost Explorer:

```typescript
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";

async function getResourceCosts(accountId: string, region: string): Promise<Map<string, number>> {
  const client = new CostExplorerClient({ region: "us-east-1" }); // Cost Explorer is global
  const response = await client.send(new GetCostAndUsageCommand({
    TimePeriod: { Start: thirtyDaysAgo(), End: today() },
    Granularity: "MONTHLY",
    GroupBy: [{ Type: "DIMENSION", Key: "RESOURCE_ID" }],
    Metrics: ["UnblendedCost"],
  }));
  // Map resource IDs to monthly costs
}
```

### Future: Azure & GCP Adapters

The adapter interface is provider-agnostic. To add Azure:

1. Create `src/adapters/azure.ts`
2. Implement `GraphDiscoveryAdapter` using `@azure/arm-*` SDK clients
3. Define `AZURE_RELATIONSHIP_RULES` (similar pattern to AWS)
4. Register in plugin setup

Key Azure resources to map:
- Virtual Networks → VPCs
- NSGs → Security Groups
- App Services → Compute
- Azure SQL → Database
- Functions → Serverless
- Storage Accounts → Storage

## Testing

```bash
# Unit tests (InMemory storage)
pnpm test

# With coverage
pnpm test:coverage

# Specific test file
pnpm test src/engine.test.ts
```

The test suite covers:
- Storage contract (node CRUD, edge CRUD, traversal, groups, stats)
- Engine (sync with mock adapter, blast radius, dependency chains, cost attribution, topology)
- Queries (shortest path, orphans, critical nodes, SPOFs, clusters)
- AWS utilities (field path resolution, ARN parsing, relationship extraction)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | SQLite (better-sqlite3) | Embedded, zero-ops, recursive CTEs for graph traversal, WAL for concurrent reads |
| In-memory option | Yes | Fast tests, small deployments, same interface |
| Node ID format | `provider:account:region:type:nativeId` | Deterministic, avoids UUID collisions, human-readable |
| Change tracking | Append-only log | Enables timeline reconstruction, audit trail, drift detection |
| Edge confidence | 0.0–1.0 float | API-derived edges (0.95) vs inferred edges (0.7) vs user-defined (1.0) |
| Traversal | Recursive CTE (SQLite) / BFS (InMemory) | Handles cycles, respects depth limits, tracks paths |
| SPOF detection | Tarjan's algorithm | O(V+E) articulation point detection, handles disconnected components |

## Contributing

1. Follow existing Espada conventions (see root `AGENTS.md`)
2. Keep files under ~500 LOC
3. Add tests for new functionality
4. Run `pnpm lint && pnpm build && pnpm test` before committing
