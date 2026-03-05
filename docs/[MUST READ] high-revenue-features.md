# Espada — High-Revenue Feature Designs

> Five category-defining features that leverage Espada's existing primitives to capture $300M+ combined ARR potential.

**Created**: March 2026
**Status**: Detailed architectural design — ready for implementation scoping

---

## Table of Contents

1. [Agent Governance Platform (MCP Gateway)](#1-agent-governance-platform-mcp-gateway) — $100M+ ARR
2. [Infrastructure Intelligence Data Platform](#2-infrastructure-intelligence-data-platform) — $200M+ ARR
3. [FinOps Autopilot](#3-finops-autopilot) — $50–100M ARR
4. [Cross-Cloud Migration Engine](#4-cross-cloud-migration-engine) — $50M+ ARR
5. [Sovereign Cloud Orchestration](#5-sovereign-cloud-orchestration) — $30–50M ARR
6. [Implementation Roadmap](#6-implementation-roadmap)
7. [Revenue Model Summary](#7-revenue-model-summary)

---

## 1. Agent Governance Platform (MCP Gateway)

### The Opportunity

Every enterprise will deploy dozens to hundreds of AI agents interacting with production infrastructure by 2028. McKinsey reports 985% growth in agentic AI job postings (2022–2024) and $1B in agentic AI equity investment in 2024 alone. MCP (Model Context Protocol) is now under the Linux Foundation, supported by AWS, Azure, GCP, Oracle, and 6+ more cloud providers. A2A (Agent-to-Agent Protocol) launched by Google has 22K GitHub stars.

**The gap**: No governance layer exists for agent-to-infrastructure interactions. Today's IAM was built for humans and CI/CD pipelines. Agents are autonomous, composable, and operate across tool boundaries — they need a fundamentally different governance model.

**Nobody is building this.** This is a first-mover category play with zero direct competition.

### What Espada Already Has

Espada has more agent governance primitives than any platform in the market:

| Primitive | Location | Detail |
|-----------|----------|--------|
| **MCP Server** | `extensions/knowledge-graph/src/mcp/server.ts` | Full MCP server over stdio (JSON-RPC 2.0, protocol `2024-11-05`), 31 tools via `buildToolRegistry()` |
| **Tool Policy Engine** | `src/agents/pi-tools.policy.ts` | 7-layer policy resolution: global → provider → agent → agent-provider → profile → provider-profile → subagent. Glob-based allow/deny with `SandboxToolPolicy` |
| **Exec Approval System** | `src/gateway/exec-approval-manager.ts` | Full approval workflow: `allow-once` / `allow-always` / `deny` decisions, timeout, broadcast events, Discord/UI/CLI integration |
| **Agent Identity** | `src/agents/agent-scope.ts` | Per-agent config resolution, workspace isolation, session key parsing (`agent:<id>:subagent:<uuid>`), auth profiles per provider |
| **Agent Concurrency** | `src/config/agent-limits.ts` | Lane-based system (Main/Cron/Subagent/Nested), configurable `maxConcurrent` (default 4), subagent limit (default 8) |
| **Sub-Agent Policies** | `src/agents/tools/sessions-spawn-tool.ts` | No nested sub-agents, cross-agent `allowAgents[]` with glob matching, automatic tool deny list for subagents |
| **A2A Policy** | `src/agents/tools/sessions-helpers.ts` | `AgentToAgentPolicy` type with `enabled` flag, glob allow patterns, same-agent always allowed, cross-agent requires explicit config |
| **KG Governance** | `extensions/knowledge-graph/src/mcp/tool-registry.ts` | `ChangeGovernor` for change requests, `kg_request_change` tool, blast-radius analysis, SPOF detection |
| **Audit Trail** | `extensions/audit-trail/` | Every action recorded with actor, resource, timestamp, approval chain |

### What to Build

#### 1.1 MCP Proxy Gateway

The core product: every agent MCP tool call passes through Espada before reaching infrastructure.

```
┌──────────────┐     MCP/JSON-RPC      ┌─────────────────────────┐     MCP/JSON-RPC     ┌──────────────┐
│  AI Agent    │ ───────────────────►  │   Espada MCP Gateway    │ ──────────────────►  │  Cloud APIs  │
│  (Claude,    │                        │                         │                       │  (AWS, Azure │
│   GPT, etc.) │  ◄───────────────────  │  Policy · Cost · Blast  │  ◄──────────────────  │   GCP, K8s)  │
│              │     Result + Audit     │  Radius · Audit · Rate  │     Result            │              │
└──────────────┘                        └─────────────────────────┘                       └──────────────┘
                                                  │
                                                  ▼
                                        ┌─────────────────────┐
                                        │  Knowledge Graph     │
                                        │  (Blast Radius,      │
                                        │   Dependencies,      │
                                        │   Cost, Compliance)  │
                                        └─────────────────────┘
```

**Request lifecycle:**

1. **Authenticate** — Validate agent identity via JWT/API key. Extract agent ID, capability scope, and cost ceiling from claims.
2. **Policy Evaluate** — Pass the tool call through the 7-layer policy engine (`resolveEffectiveToolPolicy`). Check allow/deny at global, provider, agent, and profile levels.
3. **Blast Radius** — For mutating calls (create/update/delete), query the Knowledge Graph for downstream dependencies using `kg_blast_radius`. Compute risk score.
4. **Cost Estimate** — For provisioning calls, compute estimated cost delta using the cost-governance `PolicyEvaluationInput.cost` fields. Check against agent's cost ceiling and team budget.
5. **Approval Gate** — If risk score exceeds threshold OR cost exceeds limit, route to exec approval system (`ExecApprovalManager.create()`). Support auto-approve for low-risk, human-in-the-loop for high-risk.
6. **Execute** — Forward the tool call to the target MCP server (cloud provider).
7. **Audit** — Record full audit entry: agent ID, intent, tool call, parameters, result, policy decisions, cost impact. Link to KG node.
8. **Reconcile** — After execution, verify the actual state matches intended state via KG sync. Record drift if mismatch.

**Technical implementation:**

```typescript
// extensions/agent-governance/src/mcp-gateway/proxy.ts

interface McpProxyConfig {
  /** Upstream MCP servers to proxy to */
  upstreams: McpUpstream[];
  /** Policy evaluation timeout (ms) */
  policyTimeoutMs: number;
  /** Whether to block on blast-radius analysis for mutations */
  blastRadiusCheck: boolean;
  /** Cost estimation mode */
  costEstimation: "none" | "estimate" | "estimate-and-enforce";
  /** Approval routing */
  approvalRouting: ApprovalRoutingConfig;
}

interface McpUpstream {
  id: string;
  transport: "stdio" | "sse" | "http";
  command?: string;      // stdio: command to spawn
  url?: string;          // sse/http: endpoint URL
  toolFilter?: string[]; // glob patterns to filter exposed tools
  rateLimit?: { requestsPerMinute: number; burstSize: number };
}

interface AgentRegistration {
  agentId: string;
  displayName: string;
  owner: string;                          // team/user that owns this agent
  capabilities: string[];                 // MCP tool name patterns this agent can call
  costCeiling: { monthly: number; perAction: number; currency: string };
  allowedResourceTypes: string[];         // e.g., ["aws:ec2:*", "azure:vm:*"]
  allowedRegions: string[];               // e.g., ["us-east-1", "eu-west-1"]
  riskTolerance: "low" | "medium" | "high";
  approvalPolicy: "auto" | "human-required" | "threshold-based";
  delegationRules: DelegationRule[];      // which other agents this agent can invoke
  createdAt: string;
  lastActiveAt: string;
}
```

#### 1.2 Agent Identity Registry

A new subsystem that extends the existing `agent-scope.ts` identity model from local config to a full registry:

**Agent identity model:**
- Every agent gets a cryptographic identity (Ed25519 keypair) at registration
- Agent capabilities are declared at registration and enforced at runtime
- Agents are scoped to teams, projects, and environments
- Cost ceilings and resource limits are per-agent, not just per-user

**Agent lifecycle:**
- `register` → `activate` → `suspend` → `revoke`
- Automatic deactivation after configurable idle period
- Re-registration requires owner approval

**Cross-agent delegation:**
- Agent A can delegate to Agent B only if both agents' `delegationRules` allow it
- Delegation inherits the *most restrictive* policy of both agents (intersection, not union)
- Delegation depth is limited (default: 2 levels, matching the existing sub-agent nesting restriction)
- Delegation chain is recorded in audit trail for full accountability

**Technical approach:** Extend the existing `AgentToAgentPolicy` in `sessions-helpers.ts` (currently `enabled` + `allow[]` globs) with the full delegation model. Store registrations in the same backend as the RBAC system (file-backed for single-node, PostgreSQL for enterprise).

#### 1.3 Intent Ledger

Every agent action records **why** alongside **what**:

```typescript
interface IntentRecord {
  intentId: string;
  agentId: string;
  sessionKey: string;
  timestamp: string;
  
  /** Human-readable intent statement from the agent's reasoning */
  intent: string;                    // "Scale web tier for expected Black Friday traffic spike"
  
  /** The tool calls that implement this intent */
  actions: IntentAction[];
  
  /** Pre-action analysis */
  analysis: {
    blastRadius: BlastRadiusResult;  // from KG kg_blast_radius
    costImpact: CostDiff;           // from cost-governance policy engine
    complianceCheck: PolicyEvaluationResult;
    riskScore: number;              // 0-100
  };
  
  /** Post-action verification */
  verification: {
    stateMatchesIntent: boolean;
    driftDetected: boolean;
    actualCostDelta: number;
  };
  
  /** Approval chain */
  approvals: ExecApprovalRecord[];
  
  /** Link to KG changes caused by this intent */
  kgChangeIds: string[];
}
```

**Integration with existing audit trail:** The audit-trail extension already records `actor`, `resourceId`, `action`, `timestamp`. The intent ledger adds a layer above: one intent maps to multiple audit entries, providing the "story" of what happened and why.

**Queryable via IQL:**
```
FIND RESOURCES WHERE modified_by_agent('agent-47') AND modified_since('2026-03-01')

SUMMARIZE COUNT BY agent_id WHERE cost_impact > $500/mo
```

#### 1.4 Conflict Detection Engine

Real-time detection when multiple agents target overlapping resources:

**Conflict types:**
| Type | Example | Detection Method |
|------|---------|-----------------|
| **Direct conflict** | Two agents modify the same EC2 instance | Lock on KG node ID during intent evaluation |
| **Cascading conflict** | Agent A scales a VPC, Agent B adds a security group that assumes old VPC CIDR range | Blast-radius intersection via KG `kg_dependencies` |
| **Cost conflict** | Two agents independently provision resources that together exceed team budget | Budget aggregation via `BudgetManager.getStatus()` |
| **Policy conflict** | Agent A's action would make Agent B's pending action non-compliant | Policy re-evaluation of pending intents after each state change |

**Resolution strategy:**
1. **Optimistic locking** — First agent to reach execution phase wins; second agent's policy check detects changed state and re-evaluates
2. **Pessimistic locking** — For critical resources (production databases, VPN gateways), agents acquire a KG-level advisory lock before evaluation begins
3. **Human escalation** — For unresolvable conflicts, present both intents to a human with full context (blast radius, cost, compliance impact)

**Technical approach:** Add a `ConflictDetector` that wraps the existing `ChangeGovernor` in the KG tool registry. Before any mutation, check if any other agent has an in-flight intent targeting the same resource or its blast radius.

#### 1.5 MCP Gateway Rate Limiting & Metering

Per-agent and per-tool rate limiting with usage metering for billing:

```typescript
interface AgentUsageMeter {
  /** Track tool call usage */
  recordToolCall(agentId: string, toolName: string, costImpact: number): void;
  
  /** Get usage for billing period */
  getUsage(agentId: string, period: { start: string; end: string }): AgentUsageReport;
  
  /** Check if agent has exceeded rate limit */
  isRateLimited(agentId: string): boolean;
  
  /** Check if agent has exceeded cost ceiling */
  isCostCapped(agentId: string): boolean;
}

interface AgentUsageReport {
  agentId: string;
  period: { start: string; end: string };
  totalToolCalls: number;
  toolCallsByName: Record<string, number>;
  totalCostImpact: number;            // infrastructure cost caused by this agent
  totalGovernanceCost: number;         // cost of running governance checks
  approvalRequests: number;
  approvalsGranted: number;
  approvalsDenied: number;
  conflictsDetected: number;
  policyViolationsBlocked: number;
}
```

### Revenue Model

| Pricing Tier | Price | Includes |
|-------------|-------|---------|
| **Free** | $0/mo | 3 agents, 1,000 tool calls/mo, basic policy (allow/deny) |
| **Team** | $500/mo | 25 agents, 50,000 tool calls/mo, full policy engine, conflict detection |
| **Enterprise** | $2,000/mo + $0.01/tool call | Unlimited agents, unlimited calls, intent ledger, cost enforcement, SLA |
| **Metered** | $0.005–0.05/tool call | Per-call pricing for high-volume deployments, volume discounts at 1M+/mo |

**Revenue potential**: 10,000 enterprises × $2,000/mo base + metered overage = $240M–$400M ARR at scale. First-mover advantage in a category with zero competition.

### Extension Architecture

```
extensions/agent-governance/
├── espada.plugin.json
├── src/
│   ├── index.ts                       # register(api) → registerService + registerTool + registerGateway
│   ├── mcp-gateway/
│   │   ├── proxy.ts                   # MCP proxy: intercept → evaluate → forward → audit
│   │   ├── server.ts                  # MCP gateway server (stdio + SSE + HTTP transports)
│   │   ├── upstream-manager.ts        # Manage connections to upstream MCP servers
│   │   ├── tool-interceptor.ts        # Pre/post hooks for tool calls
│   │   └── transport/
│   │       ├── stdio.ts               # stdio transport (extend existing KG MCP server pattern)
│   │       ├── sse.ts                 # Server-Sent Events transport
│   │       └── http.ts               # HTTP Streamable transport
│   ├── registry/
│   │   ├── agent-registry.ts          # Agent identity CRUD + lifecycle management
│   │   ├── agent-crypto.ts            # Ed25519 keypair generation + verification
│   │   ├── capability-resolver.ts     # Resolve effective capabilities from agent + team + org
│   │   └── types.ts                   # AgentRegistration, AgentCapability, DelegationRule
│   ├── policy/
│   │   ├── governance-evaluator.ts    # Orchestrate policy + blast-radius + cost check
│   │   ├── cost-ceiling.ts            # Per-agent cost ceiling enforcement
│   │   ├── risk-scorer.ts             # Compute risk score from KG analysis
│   │   └── approval-router.ts         # Route to ExecApprovalManager based on risk
│   ├── conflict/
│   │   ├── conflict-detector.ts       # Real-time multi-agent conflict detection
│   │   ├── advisory-lock.ts           # KG-level resource locking
│   │   └── resolution-strategy.ts     # Optimistic/pessimistic/escalation strategies
│   ├── intent/
│   │   ├── intent-ledger.ts           # Store + query intent records
│   │   ├── intent-verifier.ts         # Post-action state verification
│   │   └── types.ts                   # IntentRecord, IntentAction, IntentVerification
│   ├── metering/
│   │   ├── usage-meter.ts             # Per-agent usage tracking
│   │   ├── rate-limiter.ts            # Token bucket rate limiter per agent/tool
│   │   ├── billing-export.ts          # Export usage reports for billing systems
│   │   └── types.ts                   # AgentUsageReport, BillingRecord
│   ├── tools/
│   │   ├── register-agent.ts          # Tool: register a new agent
│   │   ├── list-agents.ts             # Tool: list registered agents with status
│   │   ├── agent-usage.ts             # Tool: get agent usage report
│   │   ├── query-intents.ts           # Tool: search intent ledger
│   │   ├── resolve-conflict.ts        # Tool: view and resolve agent conflicts
│   │   └── governance-report.ts       # Tool: generate governance compliance report
│   ├── gateway/
│   │   ├── routes.ts                  # HTTP/WS gateway endpoints
│   │   └── dashboard-data.ts          # Real-time data for governance dashboard
│   └── cli/
│       ├── commands.ts                # CLI: espada governance agents/intents/conflicts/usage
│       └── formatters.ts              # Table/JSON output formatting
├── __tests__/
│   ├── proxy.test.ts
│   ├── agent-registry.test.ts
│   ├── governance-evaluator.test.ts
│   ├── conflict-detector.test.ts
│   ├── intent-ledger.test.ts
│   ├── usage-meter.test.ts
│   └── e2e/
│       ├── mcp-proxy.e2e.test.ts
│       └── multi-agent-conflict.e2e.test.ts
└── README.md
```

### Implementation Plan

| Phase | Deliverable | Effort | Dependencies |
|-------|------------|--------|--------------|
| **Phase 1** | MCP Proxy Gateway (stdio + SSE transport) | 3–4 weeks | Existing KG MCP server pattern |
| **Phase 2** | Agent Registry + Identity | 2–3 weeks | RBAC system, gateway auth |
| **Phase 3** | Policy integration (7-layer evaluation for MCP calls) | 2–3 weeks | Existing tool policy engine |
| **Phase 4** | Intent Ledger + Audit integration | 2–3 weeks | Audit trail extension |
| **Phase 5** | Conflict Detection Engine | 2–3 weeks | KG blast-radius analysis |
| **Phase 6** | Usage Metering + Rate Limiting | 1–2 weeks | Gateway rate limiting (roadmap #13) |
| **Total** | | **12–18 weeks** | |

---

## 2. Infrastructure Intelligence Data Platform

### The Opportunity

Infrastructure generates massive data — topology, changes, costs, compliance state, security posture, performance — siloed across dozens of tools. Datadog owns monitoring data ($3.4B FY2025 revenue). Wiz owns security graphs ($32B acquisition). Vantage owns cost data. Terraform owns state. Nobody owns the **unified model**.

Enterprises cannot answer: *"Show me all resources that changed this week, their cost impact, compliance implications, and security posture shift."*

Whoever owns the infrastructure data model owns the platform decision. This is the Databricks play — become the system of record.

**TAM**: $26.9B FinOps + $15B cloud security + nascent infra analytics = **$50B+ by 2030**.

### What Espada Already Has

Espada has more infrastructure intelligence primitives than any platform in the market:

| Primitive | Location | Detail |
|-----------|----------|--------|
| **IQL Engine** | `extensions/knowledge-graph/src/iql/` | Full lexer → parser → executor pipeline. 30 keywords. FIND/WHERE/SUMMARIZE/AT/DIFF/PATH queries. Aggregations: SUM, AVG, MIN, MAX, COUNT. Functions: `tagged()`, `drifted_since()`, `created_after()`, `has_edge()` |
| **Temporal KG** | `extensions/knowledge-graph/src/core/temporal.ts` | 686-line temporal storage. Snapshots with triggers (sync/manual/scheduled). Point-in-time queries. Node/edge version history. Snapshot diffing (added/removed/changed with field-level detail). Evolution summaries with cost trends. Retention policies (500 snapshots, 90 days default) |
| **4 Storage Backends** | `extensions/knowledge-graph/src/storage/` | InMemory, SQLite, PostgreSQL (connection pooling, GIN indexes, materialized views), SQLite-Temporal |
| **31 KG Tools** | `extensions/knowledge-graph/src/mcp/tool-registry.ts` | `kg_blast_radius`, `kg_dependencies`, `kg_cost`, `kg_drift`, `kg_spof_analysis`, `kg_path`, `kg_orphans`, `kg_audit_trail`, `kg_request_change`, governance, compliance, RBAC, benchmarks, IQL queries |
| **Multi-Cloud Adapters** | AWS (30+), Azure (80+), GCP (47 services) | Each adapter syncs resources into provider-agnostic `GraphNode` with `costMonthly`, `tags`, `metadata`, `status`, `region`, `account` |
| **Compliance Framework** | `extensions/compliance/` | SOC 2, HIPAA, PCI-DSS, GDPR, NIST 800-53, CIS controls with `evaluate(node)` functions |
| **Cost per Node** | `GraphNode.costMonthly` | Every KG node carries provider-agnostic monthly cost in USD |
| **Federation** | KG federation support | Query across multiple KG instances |

### What to Build

#### 2.1 IQL Enterprise Extensions

Extend the existing IQL engine (lexer/parser/executor) with enterprise query capabilities:

**New query types:**
```sql
-- Cross-domain joins: topology × cost × compliance × security in one query
FIND RESOURCES
WHERE provider = 'aws'
  AND cost > $1000/mo
  AND compliance('pci-dss') = false
  AND NOT tagged('owner')
  AND changed_since('2026-02-01')
ORDER BY cost DESC
LIMIT 50

-- Time-series aggregation for dashboards
SUMMARIZE SUM(cost), COUNT BY provider, region
AT RANGE '2026-01-01' TO '2026-03-01' INTERVAL 'weekly'

-- Cross-environment comparison
DIFF environment('production') WITH environment('staging')
WHERE resource_type = 'database'

-- Blast radius chain analysis
FIND DOWNSTREAM OF 'vpc-12345'
WHERE cost > $100/mo
SUMMARIZE SUM(cost), COUNT BY resource_type

-- Security posture query
FIND RESOURCES
WHERE has_edge('exposed_to_internet') = true
  AND encryption_at_rest = false
  AND compliance('hipaa') = true
ORDER BY risk_score DESC

-- Agent activity correlation
FIND RESOURCES
WHERE modified_by_agent('cost-optimizer')
  AND modified_since('2026-03-01')
SUMMARIZE SUM(cost_delta) BY agent_id
```

**New IQL keywords to add:**

| Keyword | Purpose | Implementation |
|---------|---------|----------------|
| `ORDER BY` | Sort results | Add to parser after WHERE clause, execute via `Array.sort()` |
| `AT RANGE ... TO ... INTERVAL` | Time-series queries | Iterate temporal snapshots at interval, aggregate per period |
| `DIFF environment()` | Cross-environment comparison | Filter nodes by environment tag, apply existing `diffSnapshots` logic |
| `JOIN` | Cross-dataset joins | Join KG nodes with external data (cost records, compliance results) |
| `EXPORT` | Output format control | `EXPORT AS 'csv' \| 'json' \| 'parquet'` for data pipeline integration |

**Technical approach:** The existing parser is a clean recursive descent in `parser.ts` (726 lines). Each new keyword adds a production rule. The executor (`executor.ts`) dispatches per query type. Adding `ORDER BY` is ~50 lines; `AT RANGE` leverages existing `getSnapshotAt()` in a loop; `DIFF environment()` wraps `diffSnapshots()` with a filter.

#### 2.2 Materialized Views for C-Suite Dashboards

Pre-computed dashboard datasets that update incrementally on KG sync:

```typescript
interface MaterializedView {
  id: string;
  name: string;
  query: string;                    // IQL query that populates this view
  refreshInterval: "on-sync" | "hourly" | "daily";
  lastRefreshed: string;
  schema: ViewColumn[];             // column names + types for structured access
  storage: "memory" | "sqlite" | "postgresql";
}

// Pre-built enterprise views
const ENTERPRISE_VIEWS: MaterializedView[] = [
  {
    id: "cost-by-team",
    name: "Monthly Cost by Team",
    query: `SUMMARIZE SUM(cost), COUNT BY tag('team'), provider AT RANGE NOW-30d TO NOW INTERVAL 'daily'`,
    refreshInterval: "daily",
    schema: [
      { name: "team", type: "string" },
      { name: "provider", type: "string" },
      { name: "total_cost", type: "number" },
      { name: "resource_count", type: "number" },
      { name: "date", type: "date" },
    ],
    storage: "postgresql",
  },
  {
    id: "compliance-posture",
    name: "Compliance Posture Score",
    query: `SUMMARIZE COUNT BY compliance_status('pci-dss'), compliance_status('hipaa'), compliance_status('soc2')`,
    refreshInterval: "on-sync",
    // ...
  },
  {
    id: "security-exposure",
    name: "Internet-Exposed Resources",
    query: `FIND RESOURCES WHERE has_edge('exposed_to_internet') = true ORDER BY risk_score DESC`,
    refreshInterval: "on-sync",
    // ...
  },
  {
    id: "change-velocity",
    name: "Infrastructure Change Velocity",
    query: `SUMMARIZE COUNT BY change_type AT RANGE NOW-90d TO NOW INTERVAL 'weekly'`,
    refreshInterval: "daily",
    // ...
  },
  {
    id: "agent-activity",
    name: "Agent Activity Summary",
    query: `SUMMARIZE COUNT, SUM(cost_impact) BY agent_id, action_type AT RANGE NOW-7d TO NOW INTERVAL 'daily'`,
    refreshInterval: "hourly",
    // ...
  },
];
```

#### 2.3 Cross-Cloud Cost Normalization (FOCUS v1.3)

A unified cost record format based on the FinOps Foundation FOCUS v1.3 specification:

```typescript
/**
 * FOCUS v1.3-compliant normalized cost record.
 * Maps AWS CostExplorer / Azure Cost Management / GCP Billing to a common schema.
 */
interface FocusCostRecord {
  /** Unique billing record identifier */
  billingRecordId: string;

  /** Provider: aws | azure | gcp */
  provider: string;

  /** FOCUS billing period */
  billingPeriodStart: string;
  billingPeriodEnd: string;

  /** FOCUS charge period (the actual usage window) */
  chargePeriodStart: string;
  chargePeriodEnd: string;

  /** FOCUS charge category: Usage | Purchase | Tax | Credit | Adjustment */
  chargeCategory: "Usage" | "Purchase" | "Tax" | "Credit" | "Adjustment";

  /** FOCUS charge type: OnDemand | Commitment | Spot | etc. */
  chargeType: string;

  /** FOCUS region: normalized from AWS us-east-1 / Azure eastus / GCP us-east1 */
  region: string;

  /** FOCUS service name: normalized (e.g., "Compute", "Storage", "Database") */
  serviceName: string;

  /** FOCUS service category: Compute | Storage | Networking | Database | AI/ML | Other */
  serviceCategory: string;

  /** FOCUS resource ID: normalized ARN / Azure Resource ID / GCP self-link */
  resourceId: string;

  /** FOCUS resource type: normalized (e.g., "Virtual Machine", "Object Storage") */
  resourceType: string;

  /** Cost amounts */
  billedCost: number;
  effectiveCost: number;      // After all discounts, amortization
  listCost: number;           // On-demand equivalent
  currency: string;

  /** Usage */
  usageQuantity: number;
  usageUnit: string;          // Normalized: "Hours", "GB", "Requests", etc.
  pricingQuantity: number;
  pricingUnit: string;

  /** Tags (customer-defined) */
  tags: Record<string, string>;

  /** Linked KG node ID (Espada-specific extension to FOCUS) */
  kgNodeId?: string;
}
```

**Normalization mappings:**

| FOCUS Field | AWS Source | Azure Source | GCP Source |
|-------------|-----------|-------------|-----------|
| `billedCost` | `BlendedCost` | `costInBillingCurrency` | `cost.amount` |
| `effectiveCost` | `NetAmortizedCost` | `costInBillingCurrency - discount` | `cost.amount - credits` |
| `listCost` | `UnblendedCost` (on-demand) | `paygCostInBillingCurrency` | `list_price * usage` |
| `region` | `us-east-1` | `eastus` → normalize | `us-east1` → normalize |
| `serviceName` | `AmazonEC2` → `Compute` | `Microsoft.Compute` → `Compute` | `Compute Engine` → `Compute` |
| `chargeType` | `Usage` / `RI` / `SavingsPlan` | `Usage` / `Reservation` | `OnDemand` / `CUD` |
| `resourceId` | ARN | Azure Resource ID | GCP self-link |

**Technical approach:** Build a `FocusNormalizer` per provider that wraps the existing cost managers (`CostManager` in AWS, `AzureCostManager`, `GcpCostManager/GcpBillingManager`). Store normalized records alongside KG nodes via `kgNodeId` linking. Enable IQL queries against the normalized store.

#### 2.4 Data Export & Lakehouse Integration

Push infrastructure intelligence into enterprise data warehouses:

```typescript
interface DataExportConfig {
  /** Export destination */
  destination:
    | { type: "s3"; bucket: string; prefix: string; format: "parquet" | "csv" | "json" }
    | { type: "azure-blob"; container: string; prefix: string; format: "parquet" | "csv" | "json" }
    | { type: "gcs"; bucket: string; prefix: string; format: "parquet" | "csv" | "json" }
    | { type: "snowflake"; account: string; database: string; schema: string; table: string }
    | { type: "bigquery"; project: string; dataset: string; table: string }
    | { type: "webhook"; url: string; format: "json"; batchSize: number };

  /** What to export */
  datasets: ExportDataset[];

  /** Export schedule */
  schedule: "on-change" | "hourly" | "daily" | "weekly";

  /** Incremental or full export */
  mode: "incremental" | "full";
}

type ExportDataset =
  | "topology"           // All KG nodes + edges
  | "cost"               // FOCUS-normalized cost records
  | "compliance"         // Compliance scan results
  | "changes"            // KG diffs (from temporal snapshots)
  | "agent-activity"     // Intent ledger records
  | "custom-iql";        // Custom IQL query results
```

**Partitioning strategy:** Partition by `provider/year/month/day` for timeline data. Use Parquet for analytical queries (Snowflake, BigQuery, Databricks import natively). Include schema evolution metadata for forward compatibility.

#### 2.5 Cross-Customer Benchmarking (Data Moat)

Anonymized intelligence that improves with scale:

- **Cost benchmarking**: "Your EC2 compute spend per engineer is 2.3x the median for Series B companies in your vertical"
- **Architecture benchmarking**: "85% of companies your size have migrated to managed Kubernetes; you're running self-managed EC2 clusters"
- **Compliance benchmarking**: "Your SOC 2 compliance posture is in the 60th percentile; top quartile companies fix violations within 24 hours"
- **Agent benchmarking**: "Your agents execute 3x more manual approvals than similar deployments; consider expanding auto-approve policies for low-risk actions"

**Technical approach:** Aggregate anonymized KG topology statistics (resource counts by type, cost distributions, compliance scores) across customers who opt in. Store in a central analytics database. Return benchmarks via IQL: `BENCHMARK cost BY provider WHERE industry = 'fintech' AND company_size = 'series-b'`.

### Revenue Model

| Pricing Tier | Price | Includes |
|-------------|-------|---------|
| **Open Source** | $0 | KG + IQL + Temporal + 4 storage backends (community) |
| **Pro** | $1,000/mo | 100K IQL queries/mo, 5 materialized views, CSV/JSON export |
| **Enterprise** | $5,000/mo + $0.001/query | Unlimited queries, FOCUS normalization, Parquet export, Snowflake/BigQuery push |
| **Platform** | $20,000/mo + consumption | Full data platform: benchmarking, lakehouse integration, custom materialized views, API access |

**Revenue mechanics**: Consumption-based pricing (per-query, per-resource-tracked) means revenue scales automatically with customer infrastructure growth. Infrastructure grows ~15% YoY baseline. 80%+ gross margins (IQL is CPU/memory, not GPU).

### Extension Architecture

```
extensions/infra-intelligence/
├── espada.plugin.json
├── src/
│   ├── index.ts
│   ├── iql-extensions/
│   │   ├── order-by.ts                # ORDER BY clause for IQL
│   │   ├── time-range.ts             # AT RANGE ... TO ... INTERVAL queries
│   │   ├── environment-diff.ts       # DIFF environment() support
│   │   ├── export-clause.ts          # EXPORT AS 'format' clause
│   │   └── benchmark-function.ts     # BENCHMARK keyword implementation
│   ├── materialized-views/
│   │   ├── view-manager.ts           # Create/refresh/query materialized views
│   │   ├── refresh-scheduler.ts      # Incremental refresh on KG sync events
│   │   ├── built-in-views.ts         # Pre-built enterprise views
│   │   └── types.ts
│   ├── focus/
│   │   ├── normalizer.ts             # Provider-agnostic FOCUS v1.3 normalization
│   │   ├── aws-mapper.ts             # AWS Cost Explorer → FOCUS
│   │   ├── azure-mapper.ts           # Azure Cost Management → FOCUS
│   │   ├── gcp-mapper.ts             # GCP Billing → FOCUS
│   │   ├── region-normalizer.ts      # Cross-cloud region name normalization
│   │   ├── service-taxonomy.ts       # Service name → FOCUS service category
│   │   └── types.ts                  # FocusCostRecord, FocusExportBatch
│   ├── export/
│   │   ├── export-manager.ts         # Orchestrate scheduled exports
│   │   ├── parquet-writer.ts         # Apache Parquet serialization
│   │   ├── destinations/
│   │   │   ├── s3.ts
│   │   │   ├── azure-blob.ts
│   │   │   ├── gcs.ts
│   │   │   ├── snowflake.ts
│   │   │   ├── bigquery.ts
│   │   │   └── webhook.ts
│   │   └── types.ts
│   ├── benchmarking/
│   │   ├── anonymizer.ts             # Strip PII, hash identifiers
│   │   ├── aggregator.ts             # Cross-customer statistic computation
│   │   ├── benchmark-engine.ts       # Compare customer against anonymized cohort
│   │   └── types.ts
│   ├── api/
│   │   ├── iql-endpoint.ts           # REST: POST /api/v1/iql/query
│   │   ├── views-endpoint.ts         # REST: GET/POST /api/v1/views
│   │   ├── export-endpoint.ts        # REST: POST /api/v1/export
│   │   └── benchmark-endpoint.ts     # REST: GET /api/v1/benchmark
│   ├── tools/
│   │   ├── iql-query.ts              # Tool: execute IQL query
│   │   ├── create-view.ts            # Tool: create materialized view
│   │   ├── export-data.ts            # Tool: export dataset
│   │   └── benchmark.ts              # Tool: get benchmark comparison
│   └── cli/
│       └── commands.ts               # CLI: espada intelligence query/views/export/benchmark
└── __tests__/
    ├── iql-extensions.test.ts
    ├── focus-normalizer.test.ts
    ├── materialized-views.test.ts
    ├── export-manager.test.ts
    └── benchmark-engine.test.ts
```

### Implementation Plan

| Phase | Deliverable | Effort | Dependencies |
|-------|------------|--------|--------------|
| **Phase 1** | IQL extensions (ORDER BY, time-range, environment diff) | 3–4 weeks | Existing IQL engine |
| **Phase 2** | Materialized views (5 built-in enterprise views) | 2–3 weeks | PostgreSQL backend |
| **Phase 3** | FOCUS v1.3 normalization (AWS → Azure → GCP) | 3–4 weeks | Existing cost managers |
| **Phase 4** | Data export (S3/Azure Blob/GCS + Parquet) | 2–3 weeks | FOCUS pipeline |
| **Phase 5** | Lakehouse connectors (Snowflake, BigQuery) | 2–3 weeks | Data export infrastructure |
| **Phase 6** | Benchmarking engine | 3–4 weeks | Multi-tenant architecture |
| **Total** | | **15–21 weeks** | |

---

## 3. FinOps Autopilot

### The Opportunity

The FinOps market is $14.88B (2024), projected to reach $26.91B by 2030. FOCUS v1.3 (FinOps Foundation, 95K+ members) is standardizing the data layer. Microsoft announced agentic FinOps capabilities. Every enterprise overspends on cloud by 20–35%.

**The gap**: Current FinOps tools tell you what to fix. None of them can *actually fix it*. Recommendations sit in dashboards for months. Espada's AI agents can **execute** cost optimizations autonomously, within guardrails.

This is the differentiator: **FinOps that acts, not just reports.**

### What Espada Already Has

| Primitive | Location | Detail |
|-----------|----------|--------|
| **Cost Policy Engine** | `extensions/cost-governance/src/cost-policy.ts` | 7 factory policies: cost delta deny, high-cost approval, % warn, destructive deny, new resource notify, budget utilization. Full `PolicyDefinition` → `PolicyEvaluationResult` pipeline with 14 condition types |
| **Budget Manager** | `extensions/cost-governance/src/budgets.ts` | CRUD + status tracking (ok/warning/critical/exceeded), utilization %, linear forecast, trend direction, audit trail (5000 entries) |
| **AWS Cost Manager** | `extensions/aws/src/cost/manager.ts` | 1,731 lines. Cost Explorer, Budgets, Rightsizing Recommendations, Reserved Instance Recommendations, Savings Plan Recommendations, Unused Resource Detection (10 types), Resource Scheduling |
| **Azure Cost Manager** | `extensions/azure/src/cost/manager.ts` | Cost queries, forecasts, budgets, Advisor recommendations |
| **GCP Cost/Billing** | `extensions/gcp/src/cost/`, `extensions/gcp/src/billing/` | Cost analysis, billing budgets, recommendations |
| **Infracost** | `extensions/cost-governance/src/infracost.ts` | Pre-deployment cost estimation via `infracost breakdown/diff` with provider extraction |
| **Agent Runtime** | `src/agents/` | AI agents that can reason about cost data and execute changes |
| **Exec Approvals** | `src/gateway/exec-approval-manager.ts` | Human-in-the-loop for high-cost changes |
| **KG Cost Data** | `GraphNode.costMonthly` | Every resource has provider-agnostic monthly cost |

### What to Build

#### 3.1 Autonomous Right-Sizing Engine

An AI agent that continuously monitors resource utilization and right-sizes within guardrails:

```typescript
interface RightsizingConfig {
  /** Minimum observation period before recommending (default: 14 days) */
  observationPeriodDays: number;
  
  /** CPU utilization threshold — recommend downsize below this (default: 20%) */
  cpuUnderutilizationThreshold: number;
  
  /** Memory utilization threshold (default: 20%) */
  memoryUnderutilizationThreshold: number;
  
  /** Minimum savings to trigger recommendation (default: $50/mo) */
  minimumSavingsThreshold: number;
  
  /** Auto-execute vs recommend-only */
  executionMode: "recommend" | "auto-execute-with-approval" | "auto-execute";
  
  /** Time windows for auto-execution (respect maintenance windows) */
  allowedExecutionWindows: TimeWindow[];
  
  /** Resource exclusions (glob patterns on resource IDs) */
  excludeResources: string[];
  
  /** Maximum simultaneous right-sizing operations */
  maxConcurrentOperations: number;
}

interface RightsizingRecommendation {
  resourceId: string;
  kgNodeId: string;
  provider: "aws" | "azure" | "gcp";
  resourceType: string;
  
  current: {
    instanceType: string;
    vcpus: number;
    memoryGb: number;
    monthlyCost: number;
  };
  
  recommended: {
    instanceType: string;
    vcpus: number;
    memoryGb: number;
    monthlyCost: number;
  };
  
  analysis: {
    avgCpuUtilization: number;        // over observation period
    p95CpuUtilization: number;
    avgMemoryUtilization: number;
    p95MemoryUtilization: number;
    observationDays: number;
    dataPoints: number;
  };
  
  savings: {
    monthlySavings: number;
    annualSavings: number;
    percentReduction: number;
  };
  
  risk: {
    level: "low" | "medium" | "high";
    factors: string[];                  // e.g., "production environment", "peak CPU at 85%"
    blastRadius: number;               // downstream dependent resources
    rollbackPlan: string;              // e.g., "Resize back to m5.2xlarge"
  };
  
  status: "pending" | "approved" | "executing" | "completed" | "rolled-back" | "rejected";
}
```

**Execution flow:**

```
CloudWatch/Azure Monitor/GCP Monitoring
            │
            ▼
   ┌─────────────────┐
   │ Utilization      │     14+ days of data
   │ Collector        │◄─── per resource
   └────────┬─────────┘
            │
            ▼
   ┌─────────────────┐
   │ Right-Sizing     │     Match to closest smaller
   │ Analyzer         │     instance type per provider
   └────────┬─────────┘
            │
            ▼
   ┌─────────────────┐
   │ Blast Radius     │     Query KG for downstream
   │ Check            │     dependencies + risk score
   └────────┬─────────┘
            │
            ▼
   ┌─────────────────┐
   │ Cost Policy      │     Check against team budget,
   │ Evaluation       │     cost delta policies, approval
   └────────┬─────────┘     thresholds
            │
            ▼
   ┌─────────────────┐
   │ Approval Gate    │     Auto-approve if low risk,
   │ (if required)    │     human-in-the-loop if high
   └────────┬─────────┘
            │
            ▼
   ┌─────────────────┐
   │ Execute Resize   │     Cloud SDK call with
   │ (within window)  │     retry + circuit breaker
   └────────┬─────────┘
            │
            ▼
   ┌─────────────────┐
   │ Verify + Audit   │     Health check → update KG
   │                  │     → record savings → alert
   └──────────────────┘
```

#### 3.2 Idle Resource Reaper

Extend the existing AWS `findUnusedResources()` (which already detects 10 resource types) to be autonomous:

**Existing unused resource types (AWS):** EBS volumes, EIPs, snapshots, AMIs, ALBs, NAT Gateways, RDS snapshots, EC2 instances (by CloudWatch CPU), Lambda functions.

**Extensions needed:**
- Azure equivalent: unattached disks, unused public IPs, idle App Service plans, orphaned NICs, empty resource groups
- GCP equivalent: unattached persistent disks, idle VMs, unused static IPs, orphaned snapshots
- Cross-cloud idle resource aggregation dashboard
- Automated cleanup with configurable grace period ("idle for 30 days → tag 'pending-cleanup' → idle for 7 more days → delete with snapshot backup")
- Protected resources: never auto-delete resources tagged `do-not-delete`, in production, or with downstream dependencies in KG

#### 3.3 Commitment Optimizer (RI/Savings Plans/CUDs)

Espada already has `getOptimizationRecommendations()` in the AWS cost manager with `RightsizingRecommendation`, `ReservedInstanceRecommendation`, and `SavingsPlanRecommendation` types. Extend to a unified cross-cloud commitment analysis:

```typescript
interface CommitmentAnalysis {
  provider: "aws" | "azure" | "gcp";
  
  /** Current commitment coverage */
  currentCoverage: {
    onDemandSpend: number;
    committedSpend: number;
    coveragePercent: number;
  };
  
  /** Recommended purchases */
  recommendations: CommitmentRecommendation[];
  
  /** Total savings opportunity */
  totalAnnualSavings: number;
  
  /** Cross-cloud arbitrage opportunities */
  arbitrageOpportunities: ArbitrageOpportunity[];
}

interface CommitmentRecommendation {
  type: "reserved-instance" | "savings-plan" | "committed-use-discount";
  term: "1-year" | "3-year";
  paymentOption: "no-upfront" | "partial-upfront" | "all-upfront";
  
  coverage: {
    resourceType: string;       // e.g., "m5.xlarge" or "Compute" (for flexible plans)
    region: string;
    quantity: number;
  };
  
  financials: {
    upfrontCost: number;
    monthlyCommitment: number;
    monthlySavings: number;
    annualSavings: number;
    breakEvenMonths: number;
    savingsPercent: number;     // vs on-demand
    netPresentValue: number;   // at 5% discount rate
  };
  
  risk: {
    utilizationConfidence: number;  // 0-100 based on usage stability
    migrationRisk: string;          // "This instance family has an ARM equivalent 40% cheaper"
    lockInCost: number;             // Cost of exiting early
  };
}

interface ArbitrageOpportunity {
  workload: string;
  currentProvider: string;
  currentMonthlyCost: number;
  targetProvider: string;
  targetMonthlyCost: number;
  monthlySavings: number;
  migrationComplexity: "low" | "medium" | "high";
  recommendation: string;     // "This stateless web tier could run on Azure Spot for 40% less"
}
```

#### 3.4 Budget Enforcement Autopilot

Extend the existing `BudgetManager` (which has CRUD, status tracking, linear forecast, and audit trail) with autonomous enforcement actions:

**Enforcement tiers:**

| Budget Status | Trigger | Autonomous Action |
|--------------|---------|-------------------|
| **Warning** (80%) | `budget.status = 'warning'` | Notify team via all connected channels (Slack, Teams, Discord, etc.) |
| **Critical** (90%) | `budget.status = 'critical'` | Block new resource creation for non-essential workloads. Trigger right-sizing scan. Alert budget owner. |
| **Exceeded** (100%) | `budget.status = 'exceeded'` | Notify executives. Auto-scale-down non-production. Tag all resources with `budget-exceeded`. Block all provisioning except tagged `budget-exempt`. |
| **Emergency** (120%) | `budget.status = 'emergency'` | Shutdown dev/staging environments. Create incident. Require VP approval for any new spend. |

**Showback & chargeback reports:**

```typescript
interface CostAllocationReport {
  period: { start: string; end: string };
  totalSpend: number;
  currency: string;
  
  /** Cost allocation by team (tag-based) */
  byTeam: TeamCostAllocation[];
  
  /** Cost allocation by project */
  byProject: ProjectCostAllocation[];
  
  /** Untagged spend (the "shame" metric) */
  untaggedSpend: { amount: number; percent: number; resources: string[] };
  
  /** Shared resource costs with splitting rules */
  sharedCosts: SharedCostAllocation[];
  
  /** Month-over-month trend */
  trend: { previousPeriodSpend: number; deltaPercent: number; direction: "up" | "down" | "flat" };
}
```

#### 3.5 Cost Anomaly Detection

ML-based anomaly detection on cost streams:

- Ingest FOCUS-normalized cost records daily
- Build per-service, per-team cost baselines using rolling 30-day windows
- Alert on deviations > 2 standard deviations with root-cause hypothesis (new resources? pricing change? usage spike?)
- Auto-investigate: query KG for what changed (`drifted_since()`, `created_after()`) and correlate with cost spike
- Agent-driven resolution: "Cost spike of $3,200/day detected in us-east-1 EC2. Root cause: 15 new c5.4xlarge instances created by deploy pipeline. Recommendation: convert to spot instances (80% savings) or investigate if traffic spike justifies the capacity."

### Revenue Model

| Pricing Model | Price | Why It Works |
|-------------|-------|-------------|
| **Percentage of savings** | 10–15% of realized annual savings | Zero risk for customer. Self-funding. Easy CFO approval. |
| **Per-resource** | $2–5/resource/mo (managed resources) | Scales with infrastructure. Predictable for customer. |
| **Platform fee + savings share** | $1,000/mo base + 10% of savings above base | Guaranteed revenue floor + upside. |

**Revenue example**: Customer with $500K/mo cloud spend, 25% savings = $125K/mo savings. At 10% take rate = $12,500/mo = $150K/year per customer. 1,000 customers = **$150M ARR**.

### Extension Architecture

```
extensions/finops-autopilot/
├── espada.plugin.json
├── src/
│   ├── index.ts
│   ├── rightsizing/
│   │   ├── analyzer.ts                # Cross-cloud utilization analysis
│   │   ├── instance-matcher.ts        # Map current → optimal instance types
│   │   ├── execution-engine.ts        # Orchestrate resize with rollback
│   │   ├── health-verifier.ts         # Post-resize health check
│   │   └── types.ts
│   ├── idle-resources/
│   │   ├── scanner.ts                 # Cross-cloud idle resource detection
│   │   ├── reaper.ts                  # Automated cleanup with grace period
│   │   ├── protection-rules.ts        # Never-delete rules (production, tagged, KG-critical)
│   │   └── types.ts
│   ├── commitments/
│   │   ├── coverage-analyzer.ts       # Current RI/SP/CUD coverage analysis
│   │   ├── purchase-optimizer.ts      # Optimal commitment portfolio calculation
│   │   ├── arbitrage-detector.ts      # Cross-cloud cost arbitrage opportunities
│   │   ├── break-even-calculator.ts   # NPV, break-even, risk-adjusted returns
│   │   └── types.ts
│   ├── budgets/
│   │   ├── enforcement-engine.ts      # Autonomous budget enforcement tiers
│   │   ├── showback-report.ts         # Tag-based cost allocation reports
│   │   ├── chargeback-export.ts       # Export to billing/ERP systems
│   │   └── types.ts
│   ├── anomaly/
│   │   ├── detector.ts                # Statistical anomaly detection
│   │   ├── baseline-builder.ts        # Rolling cost baselines per service/team
│   │   ├── root-cause-analyzer.ts     # KG-correlated root cause hypothesis
│   │   ├── auto-investigator.ts       # Agent-driven investigation flow
│   │   └── types.ts
│   ├── focus/
│   │   └── ...                        # (Shared with infra-intelligence, or imported)
│   ├── scheduling/
│   │   ├── scheduler.ts               # Start/stop non-production during off-hours
│   │   ├── savings-calculator.ts      # Estimate savings from scheduling
│   │   └── types.ts
│   ├── tools/
│   │   ├── rightsizing-scan.ts        # Tool: scan for rightsizing opportunities
│   │   ├── idle-scan.ts              # Tool: find idle resources
│   │   ├── commitment-analyze.ts     # Tool: analyze commitment options
│   │   ├── budget-enforce.ts         # Tool: budget status + enforcement
│   │   ├── cost-anomaly.ts           # Tool: investigate cost anomaly
│   │   ├── savings-report.ts         # Tool: generate savings report
│   │   └── schedule-resources.ts     # Tool: configure resource scheduling
│   ├── gateway/
│   │   ├── routes.ts                 # HTTP endpoints for dashboard
│   │   └── dashboard-data.ts         # Real-time savings + recommendation data
│   └── cli/
│       └── commands.ts               # CLI: espada finops scan/optimize/budget/report
└── __tests__/
    ├── rightsizing.test.ts
    ├── idle-resources.test.ts
    ├── commitment-optimizer.test.ts
    ├── budget-enforcement.test.ts
    ├── anomaly-detector.test.ts
    └── e2e/
        └── finops-autopilot.e2e.test.ts
```

### Implementation Plan

| Phase | Deliverable | Effort | Dependencies |
|-------|------------|--------|--------------|
| **Phase 1** | Cross-cloud idle resource scanner (extend AWS `findUnusedResources` to Azure + GCP) | 2–3 weeks | Existing AWS cost manager |
| **Phase 2** | Autonomous right-sizing engine (utilization → recommend → execute) | 3–4 weeks | CloudWatch/Monitor metric access |
| **Phase 3** | Budget enforcement autopilot (4-tier autonomous actions) | 2–3 weeks | Existing `BudgetManager` |
| **Phase 4** | Commitment optimizer (RI/SP/CUD unified analysis) | 2–3 weeks | Existing recommendation APIs |
| **Phase 5** | Cost anomaly detection + auto-investigation | 2–3 weeks | FOCUS normalization from Data Platform |
| **Phase 6** | Showback/chargeback reports + export | 1–2 weeks | Tag infrastructure |
| **Total** | | **12–18 weeks** | |

---

## 4. Cross-Cloud Migration Engine

### The Opportunity

The cloud migration market exceeds $15B. Every enterprise with multi-cloud deployments needs to move workloads between providers — for cost optimization, compliance, sovereignty, de-risking vendor lock-in, or M&A integration. Current migration tools (AWS Migration Hub, Azure Migrate, Google Migrate for Compute Engine) are single-vendor and don't support cross-cloud.

**The gap**: No tool supports bidirectional migration between any two clouds (or to on-premise) with integrity verification as a single AI-orchestrated workflow.

> Full architectural design available in `docs/[MUST READ] cloud-migration-architecture.md`.

### What Espada Already Has

| Primitive | Location | Detail |
|-----------|----------|--------|
| **Azure DAG Orchestrator** | `extensions/azure/src/orchestration/engine.ts` | 635-line orchestration engine with `ExecutionPlan`, topological sort, concurrency (4), step-level rollback, event lifecycle. Reusable for any multi-step pipeline. |
| **AWS IDIO** | `extensions/aws/src/idio/orchestrator.ts` | Intent → Compile → Policy → Execute → Reconcile. DynamoDB-backed state. |
| **Infrastructure Framework** | `extensions/infrastructure/src/provider.ts` | `InfrastructureProvider` interface with full lifecycle. 14 capabilities including `"migrate"`. |
| **Blueprints Engine** | `extensions/blueprints/src/engine.ts` | Cross-cloud template rendering with parameterized resources. |
| **Cloud VM Types** | AWS `EC2Instance`, Azure `VMInstance`, GCP `GcpComputeInstance` | Full VM metadata per provider. |
| **Cloud Storage Types** | AWS `S3Bucket`, Azure `StorageAccount`, GCP `GcpBucket` | Full storage metadata per provider. |
| **Cloud Network Types** | AWS `SecurityGroup`, Azure NSG types, GCP `GcpFirewallRule` | Full network/security metadata. |
| **KG + Blast Radius** | `kg_blast_radius`, `kg_dependencies`, `kg_spof_analysis` | Pre-migration impact analysis. |
| **DR Analysis** | `extensions/dr-analysis/` | Disaster recovery analysis with RTO/RPO. |
| **Circuit Breakers** | `src/infra/circuit-breaker.ts` + per-cloud breakers | Per-service circuit breakers for all 3 clouds. |

### Architecture Summary

The migration engine uses provider-agnostic normalized types as the universal interchange format:

```
                              ┌──────────────────┐
                              │   MigrationEngine │
                              │   (DAG-based)     │
                              └────────┬──────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
     ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
     │ Compute Pipeline │     │  Data Pipeline   │     │ Network Pipeline │
     │ (9 steps)        │     │  (streaming)     │     │ (best-effort)   │
     └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
              │                        │                        │
     ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
     │ Provider-Specific│     │ Provider-Specific│     │ Provider-Specific│
     │ Source Normalizer │     │ Transfer Agent   │     │ Rule Translator  │
     └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
              │                        │                        │
              ▼                        ▼                        ▼
     NormalizedVM             NormalizedBucket          NormalizedSecurityRule
     NormalizedDisk           NormalizedObject          NormalizedDNSRecord
```

### Three Migration Pipelines

#### 4.1 Compute Migration Pipeline

**9 steps with per-step rollback:**

| Step | Action | Rollback |
|------|--------|---------|
| 1. Assess | Inventory source VM: disks, network, software, dependencies | — |
| 2. Normalize | `EC2Instance` / `VMInstance` / `GcpComputeInstance` → `NormalizedVM` | — |
| 3. Compatibility | Check target supports: instance family, OS, architecture (x86/ARM) | — |
| 4. Image Export | Export disk(s) to portable format (VMDK/VHD/RAW) | Delete exported image |
| 5. Image Transfer | Upload to target cloud's image import service | Delete uploaded image |
| 6. Image Import | Import as target-native image (AMI/Managed Disk/GCE Image) | Deregister imported image |
| 7. Provision | Launch VM from imported image with equivalent specs | Terminate provisioned VM |
| 8. Verify | Health checks: SSH/RDP access, service ports, application health | — |
| 9. Cutover | DNS update, traffic switch, source VM shutdown (or keep as fallback) | Revert DNS, restart source |

**Instance type mapping:**

```typescript
interface InstanceTypeMapping {
  source: { provider: string; type: string; vcpus: number; memoryGb: number; gpuType?: string };
  target: { provider: string; type: string; vcpus: number; memoryGb: number; gpuType?: string };
  costDelta: { monthly: number; percent: number };
  compatibility: "exact" | "equivalent" | "closest" | "no-match";
  warnings: string[];   // e.g., "Target has burstable CPU; source is dedicated"
}
```

#### 4.2 Data Migration Pipeline

**Streaming transfer with integrity verification:**

| Feature | Implementation |
|---------|---------------|
| Parallel streams | 16 concurrent transfer workers (configurable) |
| Resumable | Checkpoint file with last-transferred object key + byte offset |
| Integrity | SHA-256 per-object, manifest comparison pre/post transfer |
| Metadata preservation | ACLs, content-type, custom metadata, storage tier mapping |
| Large objects | Multipart upload (5GB+ chunks), server-side copy when same region |
| Delta sync | Compare manifests, transfer only new/changed objects |

**Metadata translation matrix:**

| Feature | S3 | Azure Blob | GCS | Translatable? |
|---------|-----|-----------|-----|---------------|
| Versioning | Bucket versioning | Blob versioning | Object versioning | ✅ |
| Encryption | SSE-S3/SSE-KMS/SSE-C | SSE (Microsoft/Customer) | CMEK/CSEK | ✅ (key type maps) |
| Lifecycle | Lifecycle rules | Lifecycle management | Lifecycle rules | ✅ (tier names differ) |
| Storage tiers | Standard/IA/Glacier | Hot/Cool/Cold/Archive | Standard/Nearline/Coldline/Archive | ✅ (closest match) |
| Replication | CRR/SRR | GRS/RA-GRS/ORS | Turbo replication | ❌ Re-configure |
| Access control | ACLs + Bucket Policy | RBAC + SAS tokens | ACLs + IAM | ⚠️ Best-effort |

#### 4.3 Network Migration Pipeline

**Best-effort translation with explicit diff report:**

Security rules are *not* 1:1 translatable across clouds. The engine uses a `TranslationReport` approach:

- **`translatedRules[]`** — rules that mapped cleanly (e.g., "allow TCP 443 from 0.0.0.0/0")
- **`approximateRules[]`** — rules that required interpretation (e.g., AWS prefix lists → explicit CIDRs)
- **`untranslatable[]`** — rules with no equivalent (user must manually configure)
- **`warnings[]`** — semantic differences to review (e.g., "Azure NSGs are stateful; GCP firewall rules require explicit deny")

### Governance Integration

Three mandatory approval gates during any migration:

| Gate | When | What's Checked |
|------|------|----------------|
| **Pre-Migration** | After assessment, before any changes | Cost estimate, blast-radius analysis, compliance check, data classification |
| **Pre-Cutover** | After provisioning, before traffic switch | Health verification, integrity checksums match, rollback plan confirmed |
| **Post-Migration** | 24 hours after cutover | Full validation suite passes, no errors in monitoring, source cleanup approved |

Each gate uses the existing `ExecApprovalManager` and records decisions in the audit trail with full KG linkage.

### Implementation Plan

| Phase | Deliverable | Effort | Dependencies |
|-------|------------|--------|--------------|
| **Phase 1: Assessment** | Cross-cloud inventory, normalization types, compatibility matrix | 4–6 weeks | VM/storage types per cloud |
| **Phase 2: Data** | Object storage streaming transfer with integrity verification | 6–8 weeks | S3/Blob/GCS managers |
| **Phase 3: Compute** | VM export → transfer → import → provision pipeline | 8–12 weeks | Image import APIs per cloud |
| **Phase 4: Network** | Security rule translation with diff report | 4–6 weeks | Network types per cloud |
| **Phase 5: On-Premise** | VMware/Hyper-V ↔ Cloud migration adaptors | 12+ weeks | On-prem agent |
| **Phase 6: Database** | RDS/Azure SQL/Cloud SQL migration (schema + data) | 8–10 weeks | DMS/DMA integrations |
| **Total** | | **42–56 weeks** | |

### Revenue Model

| Pricing Model | Price | Typical Deal |
|-------------|-------|--------------|
| **Per-VM** | $500–2,000 per VM migrated | 200 VMs × $1,000 = $200K |
| **Per-TB** | $50–200 per TB transferred | 500 TB × $100 = $50K |
| **Assessment** | $10,000–50,000 per assessment | One-time, feeds into migration |
| **Enterprise license** | $100K–500K/year unlimited | Large enterprise annual contract |

---

## 5. Sovereign Cloud Orchestration

### The Opportunity

**Regulatory pressure is the forcing function** — 30+ national data sovereignty laws exist. The EU Cloud and AI Development Act will triple data center capacity in 5–7 years. Every multinational must demonstrate data residency compliance. GDPR Article 46 restricts cross-border data transfers. Brazil's LGPD, China's PIPL, Russia's data localization law, India's DPDP Act — each has unique requirements.

**The gap**: Cloud providers offer region selection but not sovereignty-aware orchestration. Terraform and Pulumi are region-agnostic. Compliance tools check *after* deployment, not *during planning*. Nobody provides pre-deployment sovereignty validation that works across multiple jurisdictions simultaneously.

**Compliance buyers have large budgets, long contracts (3–5 years), and high switching costs.** This is sticky revenue.

### What Espada Already Has

| Primitive | Location | Detail |
|-----------|----------|--------|
| **GDPR Controls** | `extensions/compliance/src/controls.ts` | Data residency compliance (check `node.region` against `approved_regions[]`), data classification tags, encryption at rest, retention policy |
| **Compliance Framework** | `extensions/compliance/` | 6 frameworks (SOC 2, HIPAA, PCI-DSS, GDPR, NIST 800-53, CIS) with `evaluate(node)` functions and remediation guidance |
| **Policy Engine** | `extensions/cost-governance/`, `extensions/policy-engine/` | Declarative policy rules with 14 condition types, severity levels, actions (deny/warn/require_approval/notify) |
| **KG Region Metadata** | `GraphNode.region`, `GraphNode.provider`, `GraphNode.account` | Every resource carries provider, region, and account for geographic analysis |
| **Hybrid-Cloud Discovery** | `extensions/hybrid-cloud/` | Multi-provider topology, `HybridSiteCapability` includes `"sovereign"` type, connectivity status, blast-radius overlay |
| **GDC Support** | `extensions/gcp/src/hybrid/gdc-discovery.ts` | Google Distributed Cloud (air-gapped / sovereign cloud) |
| **Tag Policies** | `extensions/aws/src/compliance/` | `TagPolicy` CRUD + enforcement with `enforceTagPolicy()` |
| **IQL** | KG IQL engine | `FIND RESOURCES WHERE region = 'eu-west-1'` already works |

### What to Build

#### 5.1 Sovereignty Metadata Layer

Add sovereignty context to every KG node:

```typescript
/**
 * Sovereignty metadata attached to every GraphNode.
 * Stored in GraphNode.metadata.sovereignty
 */
interface SovereigntyMetadata {
  /** Primary jurisdiction (ISO 3166-1 alpha-2 country code) */
  jurisdiction: string;                  // "DE", "US", "BR", "CN", "IN"
  
  /** All jurisdictions this resource is subject to (e.g., DE + EU) */
  applicableJurisdictions: string[];
  
  /** Data classification (determines which regulations apply) */
  dataClassification: DataClassification;
  
  /** Whether this resource stores, processes, or transits personal data */
  handlesPersonalData: boolean;
  
  /** Whether this resource has cross-border data flows */
  crossBorderFlows: CrossBorderFlow[];
  
  /** Sovereignty compliance status per framework */
  complianceStatus: Record<string, "compliant" | "non-compliant" | "not-evaluated">;
  
  /** Sovereign cloud provider type (if applicable) */
  sovereignCloudType?: "hyperscaler-region" | "sovereign-cloud" | "air-gapped" | "on-premise";
  
  /** Last evaluated timestamp */
  lastEvaluated: string;
}

interface DataClassification {
  level: "public" | "internal" | "confidential" | "restricted" | "top-secret";
  categories: DataCategory[];
  regulatoryRequirements: string[];     // ["GDPR", "HIPAA", "PIPL"]
}

type DataCategory =
  | "personal-data"            // GDPR Art. 4(1)
  | "sensitive-personal-data"  // GDPR Art. 9 (health, biometric, political, etc.)
  | "children-data"            // COPPA, GDPR Art. 8
  | "financial-data"           // PCI-DSS, SOX
  | "health-data"              // HIPAA PHI
  | "government-data"          // FedRAMP, ITAR
  | "critical-infrastructure"  // NIS2 Directive
  | "general";

interface CrossBorderFlow {
  sourceRegion: string;
  targetRegion: string;
  sourceJurisdiction: string;
  targetJurisdiction: string;
  dataTypes: DataCategory[];
  legalBasis?: string;             // "Standard Contractual Clauses", "Adequacy Decision", "Binding Corporate Rules"
  volume: "low" | "medium" | "high";
  frequency: "real-time" | "batch-daily" | "batch-weekly" | "on-demand";
}
```

#### 5.2 Regulatory Rule Engine

Encode data sovereignty laws as evaluable rules:

```typescript
interface SovereigntyRule {
  id: string;
  framework: string;                       // "GDPR", "PIPL", "LGPD", etc.
  article: string;                         // "GDPR Art. 46", "PIPL Art. 38"
  jurisdiction: string;                    // ISO country code
  
  /** What this rule checks */
  description: string;
  
  /** Conditions that trigger this rule */
  appliesWhen: RuleCondition;              // Reuse existing 14-condition system
  
  /** What the rule evaluates */
  evaluate: (context: SovereigntyEvaluationContext) => SovereigntyRuleResult;
  
  /** What to do when violated */
  remediation: string;
  
  /** Severity of violation */
  severity: "critical" | "high" | "medium" | "low";
}

interface SovereigntyEvaluationContext {
  /** The resource being evaluated */
  resource: GraphNode;
  
  /** Its sovereignty metadata */
  sovereignty: SovereigntyMetadata;
  
  /** Cross-border data flows involving this resource */
  crossBorderFlows: CrossBorderFlow[];
  
  /** Connected resources via KG edges */
  connectedResources: GraphNode[];
  
  /** The planned action (for pre-deployment checks) */
  plannedAction?: {
    type: "create" | "update" | "migrate" | "replicate";
    targetRegion?: string;
    targetProvider?: string;
  };
}
```

**Pre-built sovereignty rules:**

| Framework | Rules | Key Checks |
|-----------|-------|-----------|
| **GDPR** (EU) | 12 rules | Data residency (Art. 46), cross-border transfer legal basis (Art. 49), encryption (Art. 32), data classification (Art. 30), retention (Art. 17), DPO designation (Art. 37) |
| **PIPL** (China) | 8 rules | Data must remain in China unless Security Assessment passed (Art. 38), no transfer to foreign judicial authorities without PRC approval (Art. 41), critical infrastructure data localization (Art. 40) |
| **LGPD** (Brazil) | 6 rules | International transfer requires adequacy decision or guarantees (Art. 33), ANPD notification required (Art. 35), data localization for financial data |
| **DPDP** (India) | 5 rules | Cross-border transfer restrictions for "significant data fiduciary" (Sec. 16), government data localization |
| **Federal Cloud Act** (US) | 4 rules | US government data in US-jurisdiction regions only, FedRAMP authorization required |
| **NIS2** (EU) | 6 rules | Critical infrastructure service continuity, incident reporting (24h), supply chain security |
| **Data Localization** (Russia) | 3 rules | Personal data of Russian citizens must be stored in Russia (Federal Law 242-FZ) |
| **CCPA** (California) | 4 rules | Consumer data handling, right to delete, sale disclosure |

**Total: 48 sovereignty rules across 8 jurisdictions**, extensible via the declarative rule format.

#### 5.3 Pre-Deployment Sovereignty Validator

A gatekeeper that validates every infrastructure change against sovereignty rules **before** it reaches the cloud:

```
┌─────────────────┐     IaC Plan / API Call      ┌──────────────────────────────┐
│  terraform plan │ ────────────────────────────► │  Sovereignty Validator       │
│  pulumi preview │                               │                              │
│  agent request  │     ◄─── PASS or BLOCK ────── │  1. Classify data            │
└─────────────────┘                               │  2. Determine jurisdictions   │
                                                  │  3. Evaluate 48 rules         │
                                                  │  4. Check cross-border flows  │
                                                  │  5. Verify legal basis        │
                                                  │  6. Generate compliance cert  │
                                                  └──────────────┬───────────────┘
                                                                 │
                                                                 ▼
                                                  ┌──────────────────────────────┐
                                                  │  Knowledge Graph              │
                                                  │  (Topology + Sovereignty      │
                                                  │   Metadata + Data Flows)      │
                                                  └──────────────────────────────┘
```

**Integration points:**

1. **IaC pre-hook**: Before `terraform apply` or `pulumi up`, the sovereign validator evaluates the plan. Blocks deployment if any critical rule is violated. Warns on medium/low violations.
2. **MCP Gateway** (from Section 1): Every agent tool call that creates or migrates resources runs through sovereignty validation.
3. **Migration Engine** (from Section 4): Migration assessment step includes full sovereignty analysis of source and target locations. Data classification gates determine if data *can* leave a jurisdiction.
4. **CI/CD pipeline**: GitHub Action / GitLab CI step that runs sovereignty validation in pull requests.

#### 5.4 Cross-Border Data Flow Mapper

Visualize and audit every data flow that crosses jurisdictional boundaries:

```typescript
interface DataFlowMap {
  /** All cross-border flows discovered from KG topology */
  flows: CrossBorderFlow[];
  
  /** Flows grouped by legal basis */
  byLegalBasis: Record<string, CrossBorderFlow[]>;
  
  /** Flows that lack a legal basis (compliance risk) */
  unbacked: CrossBorderFlow[];
  
  /** Flows that violate sovereignty rules */
  violations: SovereigntyViolation[];
  
  /** Regulatory summary per jurisdiction */
  jurisdictionSummary: JurisdictionSummary[];
}

interface JurisdictionSummary {
  jurisdiction: string;
  countryName: string;
  framework: string;                    // Primary data protection law
  
  /** Resources in this jurisdiction */
  resourceCount: number;
  totalCost: number;
  
  /** Data flows in and out */
  inboundFlows: number;
  outboundFlows: number;
  
  /** Compliance status */
  compliantFlows: number;
  nonCompliantFlows: number;
  
  /** Required actions */
  requiredActions: string[];           // e.g., "File Standard Contractual Clauses for US→EU transfer"
}
```

**Discovery method:** Traverse the KG to find resource pairs that: (a) have an edge between them (e.g., "reads_from", "replicates_to", "backed_up_to"), and (b) exist in different jurisdictions. For each pair, generate a `CrossBorderFlow` record and evaluate sovereignty rules.

**Queryable via IQL:**
```sql
FIND RESOURCES
WHERE sovereignty.crossBorderFlows EXISTS
  AND sovereignty.complianceStatus('GDPR') = 'non-compliant'
ORDER BY sovereignty.jurisdiction

SUMMARIZE COUNT BY sovereignty.jurisdiction, sovereignty.complianceStatus('GDPR')
```

#### 5.5 Sovereign Cloud Provider Catalog

Extend multi-cloud support beyond the three hyperscalers to sovereign cloud providers:

| Provider | Type | Geography | Integration |
|----------|------|-----------|-------------|
| **OVHcloud** | EU sovereign | France, EU | REST API |
| **T-Systems Open Telekom Cloud** | EU sovereign (Deutsche Telekom) | Germany, EU | OpenStack-compatible API |
| **Scaleway** | EU sovereign | France, EU | REST API |
| **NTT Communications** | Asia sovereign | Japan | REST API |
| **Alibaba Cloud** | China sovereign | China, Asia | Alibaba SDK |
| **Yandex Cloud** | Russia sovereign | Russia | REST API |
| **Google Distributed Cloud** (GDC) | Air-gapped | Customer premises | Already discovered via `gdc-discovery.ts` |
| **Azure Stack Hub** | Air-gapped / Sovereign | Customer premises | Azure API surface |
| **AWS Outposts** | Dedicated | Customer premises | AWS API surface |

**Technical approach:** Each sovereign provider gets a discovery adapter (read-only initially) that populates KG nodes with `sovereignCloudType` metadata. Over time, add write capabilities for provisioning into sovereign clouds.

### Revenue Model

| Pricing Tier | Price | Includes |
|-------------|-------|---------|
| **Compliance** | $3,000/mo | 3 frameworks (GDPR + 2), pre-deployment validation, data flow mapping |
| **Enterprise** | $8,000/mo | All 8+ frameworks, sovereign provider catalog, cross-border audit reports |
| **Regulated** | $15,000/mo + per-resource | FedRAMP/ITAR/NIS2 critical infrastructure, dedicated support, custom rule authoring |

**Revenue mechanics**: Compliance is **non-optional**. Procurement cycles are 3–5 year contracts. Switching costs are extreme (re-implementing rules and re-certifying). This is the stickiest revenue on this list.

### Extension Architecture

```
extensions/sovereign-cloud/
├── espada.plugin.json
├── src/
│   ├── index.ts
│   ├── metadata/
│   │   ├── sovereignty-enricher.ts     # Auto-enrich KG nodes with sovereignty metadata
│   │   ├── jurisdiction-resolver.ts    # Region → jurisdiction mapping (cloud region → country)
│   │   ├── data-classifier.ts          # Infer data classification from resource type + tags
│   │   └── types.ts                    # SovereigntyMetadata, DataClassification, CrossBorderFlow
│   ├── rules/
│   │   ├── rule-engine.ts              # Evaluate sovereignty rules against resources
│   │   ├── rule-registry.ts            # Register and manage sovereignty rules
│   │   ├── frameworks/
│   │   │   ├── gdpr.ts                 # 12 GDPR rules
│   │   │   ├── pipl.ts                 # 8 PIPL rules (China)
│   │   │   ├── lgpd.ts                 # 6 LGPD rules (Brazil)
│   │   │   ├── dpdp.ts                 # 5 DPDP rules (India)
│   │   │   ├── federal-cloud-act.ts    # 4 US Federal Cloud Act rules
│   │   │   ├── nis2.ts                 # 6 NIS2 rules (EU critical infrastructure)
│   │   │   ├── russia-242fz.ts         # 3 Russian data localization rules
│   │   │   └── ccpa.ts                 # 4 CCPA rules (California)
│   │   └── custom-rules.ts            # User-defined sovereignty rules
│   ├── validator/
│   │   ├── pre-deployment.ts           # IaC plan validation against sovereignty rules
│   │   ├── continuous-monitor.ts       # Ongoing compliance monitoring post-deployment
│   │   ├── migration-gate.ts           # Sovereignty check for migration engine
│   │   └── types.ts
│   ├── data-flows/
│   │   ├── flow-discoverer.ts          # Traverse KG to find cross-border data flows
│   │   ├── flow-mapper.ts              # Build cross-border flow map with legal basis
│   │   ├── flow-visualizer.ts          # Generate visual flow diagram data
│   │   └── types.ts
│   ├── providers/
│   │   ├── catalog.ts                  # Sovereign cloud provider registry
│   │   ├── adapters/
│   │   │   ├── ovh.ts                  # OVHcloud discovery adapter
│   │   │   ├── open-telekom.ts         # T-Systems adapter
│   │   │   ├── scaleway.ts             # Scaleway adapter
│   │   │   ├── alibaba.ts             # Alibaba Cloud adapter
│   │   │   └── ntt.ts                 # NTT adapter
│   │   └── types.ts
│   ├── reporting/
│   │   ├── compliance-report.ts        # Per-jurisdiction compliance posture report
│   │   ├── flow-audit-report.ts        # Cross-border data flow audit (for DPA submissions)
│   │   ├── certification-evidence.ts   # Evidence packages for auditors
│   │   └── exporters/
│   │       ├── pdf.ts
│   │       ├── csv.ts
│   │       └── json.ts
│   ├── tools/
│   │   ├── sovereignty-check.ts        # Tool: evaluate resource sovereignty compliance
│   │   ├── data-flow-map.ts           # Tool: generate cross-border data flow map
│   │   ├── jurisdiction-query.ts      # Tool: query resources by jurisdiction
│   │   ├── pre-deploy-validate.ts     # Tool: validate IaC plan against sovereignty
│   │   ├── compliance-report.ts       # Tool: generate compliance report
│   │   └── flow-audit.ts             # Tool: audit cross-border data flows
│   ├── gateway/
│   │   ├── routes.ts                  # HTTP endpoints for sovereignty dashboard
│   │   └── dashboard-data.ts          # Jurisdiction map, flow visualization data
│   └── cli/
│       └── commands.ts                # CLI: espada sovereignty check/flows/report/validate
└── __tests__/
    ├── rule-engine.test.ts
    ├── gdpr-rules.test.ts
    ├── pipl-rules.test.ts
    ├── flow-discoverer.test.ts
    ├── pre-deployment.test.ts
    ├── jurisdiction-resolver.test.ts
    └── e2e/
        └── sovereignty-validation.e2e.test.ts
```

### Implementation Plan

| Phase | Deliverable | Effort | Dependencies |
|-------|------------|--------|--------------|
| **Phase 1** | Sovereignty metadata layer + auto-enrichment of KG nodes | 2–3 weeks | KG, region mappings |
| **Phase 2** | Regulatory rule engine + GDPR/CCPA rules (2 major frameworks) | 3–4 weeks | Metadata layer |
| **Phase 3** | Pre-deployment validator (IaC hook + MCP Gateway integration) | 2–3 weeks | Rule engine |
| **Phase 4** | Cross-border data flow mapper + visualization | 2–3 weeks | KG traversal |
| **Phase 5** | Additional frameworks (PIPL, LGPD, DPDP, NIS2, etc.) | 2–3 weeks | Rule engine |
| **Phase 6** | Sovereign cloud provider adapters (OVH, T-Systems, Scaleway) | 3–4 weeks | Provider APIs |
| **Total** | | **14–20 weeks** | |

---

## 6. Implementation Roadmap

### Combined Timeline

```
         Month 1-2        Month 3-4        Month 5-6        Month 7-8        Month 9-12
         ─────────        ─────────        ─────────        ─────────        ──────────
AGENT    ████████████     ████████████     ████████████
GOV.     MCP Proxy        Registry +       Conflict +
         + Transport       Intent Ledger    Metering

DATA     ████████████     ████████████     ████████████     ████████████
PLAT.    IQL Extensions   Mat. Views       FOCUS v1.3       Lakehouse +
                          + PostgreSQL      per provider     Benchmarking

FINOPS                    ████████████     ████████████     ████████████
                          Idle + Right-    Commitments +    Anomaly +
                          sizing           Budget Enforce   Chargeback

SOVER.                                    ████████████     ████████████
                                          Metadata +       Flows + More
                                          GDPR Rules +     Frameworks +
                                          Validator        Providers

MIGRAT.                                                    ████████████     ████████████
                                                           Assessment +     Compute +
                                                           Data Pipeline    Network + OnPrem
```

### Team Composition

| Role | Count | Focus |
|------|-------|-------|
| **Senior Backend (TypeScript)** | 2 | Agent governance, MCP proxy, IQL extensions |
| **Cloud Infrastructure Engineer** | 2 | FinOps engine, migration pipelines, cloud SDK integration |
| **Compliance / Security Engineer** | 1 | Sovereignty rules, FOCUS normalization, compliance reporting |
| **Full-Stack (UI)** | 1 | Dashboard views for governance, intelligence, FinOps, sovereignty |
| **QA / Test Engineer** | 1 | E2E testing, live cloud tests, chaos testing |

**Total**: 7 engineers for 12 months to deliver all 5 features.

### Dependencies Between Features

```
                    ┌───────────────────┐
                    │ Agent Governance   │
                    │ (MCP Gateway)      │
                    └────────┬──────────┘
                             │ MCP tool calls pass through governance
                             │
        ┌────────────────────┼─────────────────────┐
        │                    │                     │
        ▼                    ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌──────────────────┐
│ FinOps         │   │ Cross-Cloud   │   │ Sovereign Cloud  │
│ Autopilot      │   │ Migration     │   │ Orchestration    │
└───────┬────────┘   └───────┬───────┘   └────────┬─────────┘
        │                    │                     │
        │      FOCUS normalization shared          │
        │           IQL queries shared              │
        └───────────────┬──────────────────────────┘
                        │
                        ▼
               ┌─────────────────────┐
               │ Infrastructure      │
               │ Intelligence Data   │
               │ Platform (IQL +     │
               │ FOCUS + Temporal)   │
               └─────────────────────┘
```

The **Infrastructure Intelligence Data Platform** is the foundation. Its IQL extensions, FOCUS normalization, and materialized views are consumed by all other features. Start it first.

---

## 7. Revenue Model Summary

### Combined Revenue Potential

| Feature | Year 1 ARR | Year 3 ARR | Year 5 ARR | Pricing Model |
|---------|-----------|-----------|-----------|---------------|
| Agent Governance | $2–5M | $30–50M | $100M+ | Per-agent + per-tool-call metered |
| Data Platform | $1–3M | $20–40M | $200M+ | Per-query consumption + platform tier |
| FinOps Autopilot | $3–8M | $30–60M | $50–100M | % of savings + per-resource |
| Migration Engine | $2–5M | $15–30M | $50M+ | Per-VM + per-TB + assessment fee |
| Sovereignty | $1–3M | $10–25M | $30–50M | Per-framework compliance tier |
| **Combined** | **$9–24M** | **$105–205M** | **$430M+** | |

### Revenue Characteristics by Feature

| Feature | Sales Cycle | Contract Length | Expansion | Gross Margin |
|---------|-------------|----------------|-----------|-------------|
| Agent Governance | 1–3 months | Annual | Agents grow → revenue grows | 90%+ |
| Data Platform | 3–6 months | Annual + consumption | Infrastructure grows → queries grow | 85%+ |
| FinOps Autopilot | 1–2 months | Annual + savings share | Cloud spend grows → savings grow | 85%+ |
| Migration Engine | 2–4 months | Project-based | Recurring migration waves | 75%+ |
| Sovereignty | 3–6 months | 3–5 year | New regulations → new rules | 90%+ |

### Land-and-Expand Strategy

```
LAND:    FinOps Autopilot (fastest time-to-value, self-funding, easy CFO approval)
            │
            ▼
EXPAND:  Agent Governance (agents using FinOps tools need governance)
            │
            ▼
EXPAND:  Data Platform (customers want to query the data FinOps + governance generate)
            │
            ▼
EXPAND:  Sovereignty (compliance team sees the KG and wants sovereignty controls)
            │
            ▼
EXPAND:  Migration (cost arbitrage opportunities from FinOps trigger migration projects)
```

**FinOps is the best landing product**: Zero-risk pricing (% of savings), immediate ROI demonstration, and the CFO approves it because it literally pays for itself.

---

*Created: March 2026*
*Status: Detailed architectural design — ready for implementation scoping*
*Related: [cloud-migration-architecture.md](cloud-migration-architecture.md), [enterprise-gap-analysis.md](enterprise-gap-analysis.md), [roadmap-features.md](features/roadmap-features.md), [PLATFORM-VISION.md](../extensions/knowledge-graph/PLATFORM-VISION.md)*
