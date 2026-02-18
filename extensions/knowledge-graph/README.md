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
| **AWS adapter** | Skeleton | 31 relationship rules, 17 service mappings, utility functions production-ready |
| **Azure/GCP adapters** | Not started | Provider-agnostic core is ready |
| **Plugin wiring** | Not started | Needs `index.ts` entry point registration |
| **CLI commands** | Not started | See Phase 4 below |
| **Agent tools** | Not started | See Phase 4 below |
| **Semantic search** | Not started | See Phase 5 below |
| **Scheduled sync** | Not started | See Phase 6 below |

## Architecture

```
┌────────────────────────────────────────────────────┐
│                    GraphEngine                      │
│  sync() · blastRadius() · drift() · cost() · ...   │
├──────────────┬─────────────────────┬────────────────┤
│   Adapters   │      Storage        │    Queries      │
│  AWS (skel)  │  SQLite (prod)      │  shortestPath   │
│  Azure (-)   │  InMemory (prod)    │  findOrphans    │
│  GCP (-)     │                     │  findSPOFs      │
│  K8s (-)     │                     │  findClusters   │
│              │                     │  criticalNodes  │
└──────────────┴─────────────────────┴────────────────┘
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

### Phase 4: Integration Wiring

**Goal**: Connect the graph engine to Espada's existing infrastructure framework.

#### 4a. Extension Entry Point (`index.ts` + `index.ts` root)

Create the plugin registration that initializes storage and engine:

```typescript
// index.ts (root)
import { definePlugin } from "espada/plugin-sdk";
import { GraphEngine } from "./src/engine.js";
import { SQLiteGraphStorage } from "./src/storage/sqlite-store.js";

export default definePlugin({
  name: "knowledge-graph",
  async setup(ctx) {
    const config = ctx.config.get("knowledge-graph");
    const storagePath = config?.storagePath ?? "~/.espada/knowledge-graph.db";
    
    const storage = new SQLiteGraphStorage(storagePath);
    const engine = new GraphEngine({ storage });
    
    // Register adapters based on config
    // Register CLI commands
    // Register agent tools
    
    ctx.provide("knowledge-graph", engine);
  },
});
```

#### 4b. Confirmation Workflow Integration

Wire blast radius into the existing `@espada/infrastructure` confirmation system:

```typescript
// In extensions/infrastructure/src/confirmation/
// Modify enrichConfirmation() to call:
const blastRadius = await knowledgeGraph.getBlastRadius(resourceId, 3);
confirmation.blastRadius = {
  affectedResources: blastRadius.nodes.size,
  hopDistribution: Object.fromEntries(blastRadius.hops),
  costAtRisk: blastRadius.totalCostMonthly,
};
```

The infrastructure extension already has:
- Risk scoring (`src/risk/risk-scorer.ts`) — add blast radius as a risk factor
- Approval chains (`src/approval/`) — escalate when blast radius exceeds threshold
- Audit logging (`src/audit/`) — log graph queries for compliance

#### 4c. CLI Commands

Add to the Espada CLI:

| Command | Description |
|---------|-------------|
| `espada graph sync` | Run full discovery sync |
| `espada graph status` | Show graph statistics |
| `espada graph blast <resource>` | Show blast radius |
| `espada graph deps <resource>` | Show dependency chain |
| `espada graph orphans` | List unconnected resources |
| `espada graph spofs` | List single points of failure |
| `espada graph cost [--group <id>]` | Cost attribution |
| `espada graph drift` | Detect configuration drift |
| `espada graph path <from> <to>` | Shortest path between resources |
| `espada graph export` | Export topology as JSON/DOT/Mermaid |

Follow existing CLI patterns in `src/commands/`. Use `src/cli/progress.ts` for progress bars and `src/terminal/table.ts` for output tables.

#### 4d. Agent Tools

Register as Espada agent tools so the AI agent can query the graph:

```typescript
const tools = [
  {
    name: "infrastructure_blast_radius",
    description: "Analyze the blast radius of changing a cloud resource",
    parameters: { resourceId: "string", depth: "number?" },
    handler: async ({ resourceId, depth }) => engine.getBlastRadius(resourceId, depth),
  },
  {
    name: "infrastructure_dependencies",
    description: "Find upstream or downstream dependencies of a resource",
    parameters: { resourceId: "string", direction: "upstream|downstream" },
    handler: async ({ resourceId, direction }) => engine.getDependencyChain(resourceId, direction),
  },
  {
    name: "infrastructure_spof_analysis",
    description: "Find single points of failure in the infrastructure",
    handler: async () => findSinglePointsOfFailure(storage),
  },
  {
    name: "infrastructure_cost",
    description: "Get cost attribution for a resource or group",
    parameters: { resourceId: "string?", groupId: "string?", includeDownstream: "boolean?" },
    handler: async (params) => { ... },
  },
];
```

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
