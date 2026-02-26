# Knowledge Graph — Comprehensive Audit & Improvement Plan

> Goal: Transform the Knowledge Graph extension from a strong foundation into a world-class infrastructure intelligence platform.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Feature Inventory](#current-feature-inventory)
3. [Architecture Assessment](#architecture-assessment)
4. [Critical Issues](#critical-issues)
5. [Improvement Areas](#improvement-areas)
   - [P0 — Must Fix (Quality/Correctness)](#p0--must-fix-qualitycorrectness)
   - [P1 — High Impact (Feature Gaps)](#p1--high-impact-feature-gaps)
   - [P2 — Competitive Edge (Differentiation)](#p2--competitive-edge-differentiation)
   - [P3 — Polish (World-Class UX)](#p3--polish-world-class-ux)
6. [Detailed Recommendations](#detailed-recommendations)
7. [Priority Roadmap](#priority-roadmap)
8. [Effort Estimates](#effort-estimates)

---

## Executive Summary

The Knowledge Graph extension (`@espada/knowledge-graph`) is a substantial piece of engineering: **25,277 LOC of source code** and **11,932 LOC of tests** across 36 source files and 16 test files. All 8 planned development phases are marked complete in the ROADMAP. The core architecture is sound — adapter pattern for multi-cloud discovery, pluggable storage backends, a custom query language (IQL), temporal snapshots, governance workflows, and 20 agent tools.

**However**, there is a significant gap between "all phases complete" and "world-class." The audit reveals:

- **Documentation is stale** — README says Azure/GCP "Not started" despite both being fully implemented
- **The AWS adapter at 5,344 LOC is a maintenance hazard** — 7.5x larger than the next biggest adapter
- **Critical storage backends are untested** — SQLite and PostgreSQL have zero integration tests through the test suite
- **Feature parity gaps across clouds** — incremental sync, cost estimation, and monitoring event sources only work for AWS
- **Temporal storage is ephemeral** — all snapshots are in-memory only, lost on restart
- **No real-time event streaming** — sync is pull-based on a timer; no webhook/EventBridge/pub-sub push
- **No graph visualization** — the most powerful feature (seeing your infrastructure) has no visual output beyond text-based Mermaid/DOT
- **No RBAC on graph queries** — any user with access can query the entire graph
- **No performance benchmarks** — unknown scaling characteristics for large graphs (10K+ nodes)
- **IQL is powerful but incomplete** — no aggregation functions, no JOIN-like capabilities, no subqueries

**Verdict:** The foundation is excellent. To reach world-class, the focus should shift from adding features to **hardening what exists** (testing, documentation, performance) and then **filling the gaps that competitors would exploit** (visualization, real-time sync, cross-cloud parity, persistent temporal storage).

---

## Current Feature Inventory

### Core Engine (src/engine.ts — 724 LOC)

| Feature | Status | Quality |
|---------|--------|---------|
| Sync pipeline (discover → upsert → edges → stale detection → changelog) | ✅ Complete | Good — multi-adapter orchestration |
| Blast radius analysis (BFS with hop distances) | ✅ Complete | Good — returns affected nodes with distance |
| Dependency chain (upstream/downstream) | ✅ Complete | Good |
| Drift detection (compare without persisting) | ✅ Complete | Good — field-level diffing |
| Cost attribution (by type, provider, node) | ✅ Complete | Partial — static for non-AWS |
| Timeline queries | ✅ Complete | Good |
| Topology export | ✅ Complete | Good |

### Type System (src/types.ts — 640 LOC)

| Feature | Count | Notes |
|---------|-------|-------|
| Resource types | 80+ | Covers all major AWS/Azure/GCP/K8s/Terraform resource categories |
| Relationship types | 40+ | Network, compute, storage, IAM, data flow, monitoring |
| Node statuses | 8 | active, stopped, terminated, degraded, creating, updating, deleting, unknown |
| Change types | 8 | created, updated, deleted, status_change, tag_change, relationship_added, relationship_removed, drift_detected |
| GraphStorage interface methods | 18 | Full CRUD + traversal + filtering + stats |

### Storage Backends

| Backend | File | LOC | Production Ready? | Tested? |
|---------|------|-----|-------------------|---------|
| In-Memory | `src/storage/memory-store.ts` | ~600 | Test only | ✅ Yes (primary test backend) |
| SQLite | `src/storage/sqlite-store.ts` | ~1,090 | ✅ Yes (WAL, indexes, CTEs) | ⚠️ No integration tests |
| PostgreSQL | `src/storage/postgres-store.ts` | ~1,182 | ✅ Yes (JSONB, materialized views, connection pooling) | ❌ No tests at all |

### Cloud Adapters

| Provider | File | LOC | Incremental Sync? | Live Cost Data? | Relationship Rules |
|----------|------|-----|--------------------|-----------------|-------------------|
| AWS | `src/adapters/aws.ts` | 5,344 | ✅ CloudTrail-based | ✅ Cost Explorer | 50+ |
| Azure | `src/adapters/azure.ts` | ~886 | ❌ Full rescan only | ❌ Static estimates | ~20 |
| GCP | `src/adapters/gcp.ts` | ~862 | ❌ Full rescan only | ❌ Static estimates | ~20 |
| Kubernetes | `src/adapters/kubernetes.ts` | ~1,146 | ❌ Full rescan only | ❌ Static estimates | 16 kind mappings |
| Terraform | `src/adapters/terraform.ts` | ~1,208 | ❌ Full rescan only | ❌ Static estimates | 100+ type mappings |
| Cross-Cloud | `src/adapters/cross-cloud.ts` | ~490 | N/A | N/A | 5 discovery rules |

### Agent Tools (src/tools.ts — 1,525 LOC)

| Category | Tools | Count |
|----------|-------|-------|
| Graph Core | `kg_blast_radius`, `kg_dependencies`, `kg_cost`, `kg_drift`, `kg_spof_analysis`, `kg_path`, `kg_orphans`, `kg_status`, `kg_export` | 9 |
| Governance | `kg_audit_trail`, `kg_request_change`, `kg_governance_summary`, `kg_pending_approvals` | 4 |
| Temporal | `kg_time_travel`, `kg_diff`, `kg_node_history`, `kg_evolution`, `kg_snapshot`, `kg_list_snapshots` | 6 |
| IQL | `kg_query` | 1 |
| **Total** | | **20** |

### Query Algorithms (src/queries.ts — 374 LOC)

| Algorithm | Implementation | Complexity |
|-----------|---------------|------------|
| Shortest Path | BFS | O(V + E) |
| Orphan Detection | Filter nodes with no edges | O(V + E) |
| Critical Nodes | Degree centrality + BFS reachability | O(V × (V + E)) |
| Single Points of Failure | Tarjan's articulation points | O(V + E) |
| Connected Components | BFS clustering | O(V + E) |

### Additional Modules

| Module | File | LOC | Purpose |
|--------|------|-----|---------|
| Governance | `src/governance.ts` | 804 | 7-factor risk scoring, auto-approve ≤30 / block ≥70 |
| Temporal | `src/temporal.ts` | 684 | Snapshots (500 max, 90-day retention), time travel, diffing |
| Monitoring | `src/monitoring.ts` | 1,325 | CloudTrail/Azure/GCP event sources, 5 alert rules |
| Sync | `src/sync.ts` | ~307 | SHA-256 delta hashing, incremental sync |
| Cache | `src/cache.ts` | ~422 | LRU+TTL, category invalidation, hit-rate stats |
| Tenant | `src/tenant.ts` | ~612 | Multi-tenancy, cross-account discovery |
| Report | `src/report.ts` | ~600 | Markdown/HTML/JSON/terminal reports |
| Export | `src/export.ts` | ~244 | JSON, DOT, Mermaid |
| Policy Scan | `src/policy-scan-tool.ts` | ~407 | Cross-extension bridge to policy engine |
| CLI (graph) | `src/cli.ts` | 519 | 12 graph subcommands |
| CLI (infra) | `src/infra-cli.ts` | 1,511 | scan/report/drift/cloud-scan/audit/monitor/timeline/snapshot/query |
| IQL | `src/iql/` | ~1,478 | Lexer (270) + Parser (390) + Executor (648) + Types (170) |

### Test Coverage

| Test File | LOC | Coverage Area |
|-----------|-----|---------------|
| `aws-adapter.test.ts` | 3,459 | AWS adapter (100+ tests) |
| `scale.test.ts` | 1,022 | Sync utils, LRU cache, tenant manager |
| `terraform-adapter.test.ts` | 967 | Terraform state parsing |
| `kubernetes-adapter.test.ts` | 837 | K8s discovery |
| `monitoring.test.ts` | 780 | Alert rules, event processing |
| `iql.test.ts` | 755 | Query language (50 tests) |
| `temporal.test.ts` | 646 | Snapshots, time travel, diffing |
| `governance.test.ts` | 626 | Risk scoring, approval workflows |
| `gcp-adapter.test.ts` | 462 | GCP discovery |
| `graph-storage.test.ts` | 416 | Storage interface (InMemory only) |
| `cross-cloud.test.ts` | 411 | Cross-cloud relationships |
| `azure-adapter.test.ts` | 355 | Azure discovery |
| `engine.test.ts` | 347 | Engine operations |
| `report.test.ts` | 296 | Report generation |
| `export.test.ts` | 282 | Export formats |
| `queries.test.ts` | 271 | Graph algorithms |
| **Total** | **11,932** | |

---

## Architecture Assessment

### Strengths

1. **Clean adapter pattern** — `GraphDiscoveryAdapter` interface with per-cloud implementations. Adding a new cloud provider is straightforward.
2. **Pluggable storage** — `GraphStorage` interface with 3 implementations (InMemory, SQLite, PostgreSQL). Easy to add new backends.
3. **Custom query language (IQL)** — Proper lexer → parser → executor pipeline for domain-specific queries. This is a moat.
4. **Temporal capabilities** — Point-in-time queries, snapshot diffing, evolution summaries. Rare in infrastructure tools.
5. **Governance built-in** — Risk scoring with 7 factors, approval workflows, audit trails. Most competitors bolt this on later.
6. **Graph algorithms** — Tarjan's for SPOFs, BFS for blast radius, connected components. Theoretically sound.
7. **Comprehensive type system** — 80+ resource types, 40+ relationship types, strict TypeScript interfaces throughout.
8. **DI-friendly testing** — Storage interface injected, adapters mockable, no hard-coded cloud clients.

### Weaknesses

1. **AWS adapter is a monolith** — 5,344 LOC in a single file. Unmaintainable, un-reviewable, and impossible to test in isolation by service.
2. **Documentation drift** — README says Azure/GCP "Not started" and AWS is "Skeleton." Both are false. Erodes trust.
3. **No persistent temporal storage** — `InMemoryTemporalStorage` is the only implementation. Snapshots vanish on restart.
4. **Test suite has blind spots** — SQLite and PostgreSQL storage backends are untested through the standard test suite.
5. **Pull-only sync model** — No event-driven discovery. 15-minute light sync means up to 15 minutes of stale data.
6. **No access control** — Any authenticated user can query the full graph. No per-team, per-environment, or RBAC filtering.
7. **Scalability is unproven** — No benchmarks, no pagination for large result sets, graph algorithms are naive BFS.

---

## Critical Issues

### Issue 1: Outdated README (Trust Killer)

The [README.md](README.md) status table says:

```
| AWS adapter     | Skeleton    | ...                          |
| Azure/GCP       | Not started | Provider-agnostic core ready  |
| Semantic search | Not started | See Phase 5 below             |
| Scheduled sync  | Not started | See Phase 6 below             |
```

**Reality:** AWS adapter is 5,344 LOC with 50+ relationship rules. Azure (886 LOC), GCP (862 LOC), K8s (1,146 LOC), Terraform (1,208 LOC) are all fully implemented. Background sync runs on 15-min/6-hr intervals. This is actively misleading.

**Fix:** Rewrite README to reflect actual state. Update architecture diagram. Remove false "Not started" labels.

### Issue 2: AWS Adapter Size (5,344 LOC)

A single file with 5,344 lines containing 26 service mappings, 50+ relationship rules, 19 lazy-loaded AWS managers, 14 post-discovery enrichment phases, Cost Explorer integration, SecurityHub + GuardDuty, X-Ray + CloudWatch integration.

**Problems:**
- Cannot be code-reviewed meaningfully
- git blame/bisect is painful
- Adding a new AWS service requires understanding the entire file
- Testing requires `(adapter as any)` private method access (3,459 LOC test file)

**Fix:** Split into `src/adapters/aws/` directory with per-domain modules (compute.ts, networking.ts, database.ts, security.ts, etc.).

### Issue 3: Untested Storage Backends

`graph-storage.test.ts` (416 LOC) runs `runStorageTests()` only against `InMemoryGraphStorage`. The SQLite and PostgreSQL backends—which are the actual production backends—have zero integration test coverage.

**Problems:**
- SQLite WAL mode, recursive CTEs, JSON1 extension usage are untested
- PostgreSQL JSONB queries, materialized views, schema-based multi-tenancy are untested
- Any regression in SQL queries goes undetected until production

**Fix:** Run `runStorageTests()` against SQLite (using a temp file) and PostgreSQL (using testcontainers or a CI service).

### Issue 4: CrossAccountRelType Stubs

In `src/tenant.ts`, the `CrossAccountRelType` switch statement has stubbed cases:

```typescript
default: break; // 3 relationship types not handled
```

**Fix:** Implement the remaining cross-account relationship type mappings.

---

## Improvement Areas

### P0 — Must Fix (Quality/Correctness)

| # | Area | Problem | Fix | Effort |
|---|------|---------|-----|--------|
| 1 | **README rewrite** | Completely outdated status table, architecture diagram, and feature list | Rewrite to reflect actual state (25K+ LOC, all adapters complete, IQL, governance, temporal, monitoring) | 1 day |
| 2 | **SQLite integration tests** | Zero tests for production storage backend | Run `runStorageTests()` against SQLite via temp DB file | 1–2 days |
| 3 | **PostgreSQL integration tests** | Zero tests for enterprise storage backend | Run `runStorageTests()` against PostgreSQL via testcontainers | 2–3 days |
| 4 | **AWS adapter decomposition** | 5,344 LOC monolith | Split into `src/adapters/aws/` with per-service modules (compute, networking, database, serverless, security, ai-ml, storage, messaging) | 3–5 days |
| 5 | **Fix CrossAccountRelType stubs** | Incomplete cross-account relationship handling | Implement remaining relationship type mappings in `tenant.ts` | 0.5 day |
| 6 | **AWS adapter test refactor** | 3,459 LOC test file accesses private methods via `(adapter as any)` | Expose testable interfaces or use service-level modules after decomposition | 2–3 days |
| 7 | **IQL temporal AT end-to-end test** | Temporal AT queries lack integration testing | Add tests that create snapshots, execute IQL AT queries, verify results | 1 day |

### P1 — High Impact (Feature Gaps)

| # | Area | Current State | Target State | Effort |
|---|------|---------------|--------------|--------|
| 8 | **Persistent temporal storage** | `InMemoryTemporalStorage` only — snapshots lost on restart | SQLite/PostgreSQL temporal backend with migration support | 3–5 days |
| 9 | **Azure/GCP incremental sync** | Full rescan every 15 min | Azure Activity Log + GCP Cloud Audit Logs for delta-based sync | 3–5 days each |
| 10 | **Azure/GCP live cost data** | Static cost estimates | Azure Cost Management API + GCP Cloud Billing API integration | 3–5 days each |
| 11 | **Real-time event streaming** | Pull-only on timer (15min/6hr) | Webhook receivers + EventBridge/CloudWatch Events/Azure Event Grid push | 5–8 days |
| 12 | **Graph pagination** | All results returned in memory | Cursor-based pagination for `getNodes()`, `getEdges()`, `getChanges()` | 3–4 days | ✅ Done |
| 13 | **K8s Watch API integration** | Full rescan only | Use K8s Watch API for streaming updates to Deployments, Services, Pods | 2–3 days |
| 14 | **IQL aggregation functions** | Only `count()` built-in | Add `sum()`, `avg()`, `min()`, `max()`, `group_by()` for cost analysis queries | 3–5 days | ✅ Done |
| 15 | **Monitoring mock mode** | Event sources require real cloud clients | Built-in mock event generators for local dev/testing | 2 days | ✅ Done |

### P2 — Competitive Edge (Differentiation)

| # | Area | What It Is | Why It Matters | Effort |
|---|------|-----------|----------------|--------|
| 16 | **Graph visualization UI** | Interactive web-based graph viewer (D3.js/Cytoscape.js) | Infrastructure topology is inherently visual. Text-only output limits adoption. Every competitor with traction (Wiz, Firefly, Datadog) has a graph UI. | 2–3 weeks |
| 17 | **Compliance framework mapping** | Map resources to SOC2, HIPAA, PCI-DSS, ISO 27001, EU AI Act controls | Enterprises choose tools that accelerate compliance. Cross-reference KG nodes with control frameworks for audit readiness. | 1–2 weeks |
| 18 | **Resource recommendation engine** | Automated right-sizing, unused resource detection, cost optimization suggestions | The graph has the data — cost, utilization (via CloudWatch/Azure Monitor), relationships. Generate actionable recommendations. | 2–3 weeks |
| 19 | **Agent action modeling** | Add AI agent nodes + action edges to the graph | The PLATFORM-VISION identifies "Agent Economy Governance" as Problem #1. Model which agents touch which resources, conflict detection, cost attribution per agent. | 1–2 weeks |
| 20 | **Natural language queries** | Allow `"Show me all expensive resources in production"` → IQL translation | LLM-based NL→IQL compiler. Makes the graph accessible to non-technical stakeholders (CFO, compliance). | 1 week |
| 21 | **Drift auto-remediation** | Detect drift → suggest/apply Terraform/CloudFormation fix | Move from "detect drift" to "fix drift." Generate and optionally apply IaC patches. | 2–3 weeks |
| 22 | **Supply chain graph** | Model software dependencies (SBOM) as graph nodes | Connect container images → packages → CVEs → infrastructure nodes. Cross-reference with vulnerability scanners. | 2 weeks |

### P3 — Polish (World-Class UX)

| # | Area | What It Is | Effort |
|---|------|-----------|--------|
| 23 | **RBAC for graph queries** | Per-team, per-environment, per-provider access control on graph data | 1–2 weeks |
| 24 | **Performance benchmarks** | Automated benchmarks at 1K, 10K, 100K node scales. Track regression. | 3–5 days |
| 25 | **SQLite encryption-at-rest** | Use SQLCipher or similar for encrypted graph storage | 2–3 days |
| 26 | **API versioning** | Versioned public API surface for tools and storage interface | 2–3 days |
| 27 | **Observability/metrics** | Track engine operations (sync time, query latency, cache hit rate) via OpenTelemetry | 3–5 days |
| 28 | **IQL subqueries and JOINs** | `FIND instances WHERE vpc IN (FIND vpcs WHERE tag.env = 'prod')` | 1–2 weeks |
| 29 | **Multi-format graph export** | Add YAML, CSV, and OpenLineage format support | 2–3 days |
| 30 | **Interactive CLI explorer** | TUI-based graph navigator with fuzzy search and interactive blast radius | 1–2 weeks |
| 31 | **Webhook notifications** | Push alerts to Slack/Teams/PagerDuty/OpsGenie when graph changes are detected | 3–5 days |
| 32 | **Graph diffing reports** | Scheduled weekly/monthly infrastructure change reports (email/Slack) | 3–5 days |

---

## Detailed Recommendations

### 1. AWS Adapter Decomposition (P0)

The current `src/adapters/aws.ts` at 5,344 LOC is the single biggest maintenance risk. Proposed structure:

```
src/adapters/aws/
├── index.ts              # AwsDiscoveryAdapter orchestrator (~200 LOC)
├── types.ts              # AWS-specific types
├── client-factory.ts     # SDK client instantiation + credential resolution
├── relationship-rules.ts # 50+ relationship extraction rules
├── compute.ts            # EC2, Auto Scaling, ECS, EKS
├── networking.ts         # VPC, Subnets, Security Groups, ELB, Route53, CloudFront
├── database.ts           # RDS, DynamoDB, ElastiCache
├── serverless.ts         # Lambda, API Gateway, Step Functions
├── storage.ts            # S3, EFS, EBS
├── security.ts           # IAM, SecretsManager, SecurityHub, GuardDuty
├── ai-ml.ts              # SageMaker, Bedrock, GPU detection
├── messaging.ts          # SQS, SNS, EventBridge
├── cost.ts               # Cost Explorer integration
├── monitoring.ts         # CloudWatch, X-Ray
└── enrichment.ts         # Post-discovery enrichment phases
```

Each module exports a `discover*()` function and a `extract*Relationships()` function. The orchestrator calls them in sequence.

### 2. Persistent Temporal Storage (P1)

Current `InMemoryTemporalStorage` is a critical gap. Two paths:

**Option A — SQLite-backed temporal (recommended)**
- Add `snapshots` and `snapshot_nodes`/`snapshot_edges` tables to `sqlite-store.ts`
- Leverage existing WAL mode and transaction support
- Query with `WHERE snapshot_timestamp <= ?` for point-in-time queries
- Add migration from in-memory to persistent on upgrade

**Option B — Separate temporal database**
- Append-only event log (similar to event sourcing)
- Reconstruct any point-in-time from event replay
- Better for audit/compliance but higher complexity

### 3. Graph Visualization (P2)

No infrastructure graph tool achieves world-class status without visualization. Options:

**Recommended: Embedded web viewer**
- Use Cytoscape.js (MIT, 10K+ GitHub stars, designed for graph visualization)
- Serve from the Espada web provider or as standalone HTML export
- Features: zoom/pan, node grouping by VPC/region/provider, edge labels, cost heatmap, blast radius highlighting
- Start with a read-only viewer, then add interactive features

**Alternative: Terminal-based (lower effort)**
- Enhance Mermaid export with clickable links
- Add `espada graph view` that opens a browser with the pre-rendered graph

### 4. Cross-Cloud Feature Parity Matrix (P1)

Current state reveals significant AWS bias:

| Capability | AWS | Azure | GCP | K8s | Terraform |
|-----------|-----|-------|-----|-----|-----------|
| Full discovery | ✅ | ✅ | ✅ | ✅ | ✅ |
| Incremental sync | ✅ | ❌ | ❌ | ❌ | ❌ |
| Live cost data | ✅ | ❌ | ❌ | ❌ | ❌ |
| Event monitoring | ✅ | ⚠️ Partial | ⚠️ Partial | ❌ | ❌ |
| Relationship rules | 50+ | ~20 | ~20 | 16 | 100+ |
| Cross-account | ✅ | ❌ | ❌ | ❌ | ❌ |
| GPU/AI detection | ✅ | ❌ | ❌ | ❌ | ❌ |

**Priority for parity:** Azure incremental sync (Activity Log) → GCP incremental sync (Audit Logs) → K8s Watch API → Azure Cost Management API → GCP Billing API.

### 5. IQL Enhancement Path (P1/P2)

IQL is a genuine competitive moat. Current limitations and proposed enhancements:

| Current | Missing | Proposed |
|---------|---------|----------|
| `FIND nodes WHERE ...` | No aggregation beyond `count()` | `SUMMARIZE sum(cost) BY provider, type` |
| `AT "2024-01-15"` | No range queries | `BETWEEN "2024-01-01" AND "2024-01-31"` |
| `DIFF "t1" AND "t2"` | No join-like capability | `FIND nodes WHERE vpc IN (FIND vpcs WHERE tag.env = 'prod')` |
| Glob patterns (`*web*`) | No regex support | `WHERE name MATCHES /^web-\d+$/` |
| `LIMIT n` | No offset/pagination | `LIMIT 50 OFFSET 100` |
| Built-in functions (5) | No custom functions | User-defined functions via plugin API |

### 6. Performance & Scale Strategy (P3)

For world-class status at enterprise scale (10K–100K+ nodes):

1. **Benchmark suite** — Measure sync time, query latency, memory usage at 1K/10K/100K node scales
2. **Lazy edge loading** — Don't load all edges into memory for every query
3. **Query result streaming** — Return results as async iterators, not arrays
4. **Index optimization** — Add composite indexes for common query patterns (provider+type, tags, cost ranges)
5. **Parallel adapter discovery** — Run AWS/Azure/GCP adapters concurrently (currently sequential)
6. **Graph partitioning** — Shard by provider/region for horizontal scaling at extreme scale

---

## Priority Roadmap

### Sprint 1 (Week 1–2): Hardening

- [ ] Rewrite README to reflect actual state
- [ ] Add SQLite integration tests
- [ ] Add PostgreSQL integration tests (testcontainers)
- [ ] Fix CrossAccountRelType stubs in tenant.ts
- [ ] Add IQL temporal AT end-to-end tests

### Sprint 2 (Week 3–5): AWS Adapter Decomposition

- [ ] Split `aws.ts` into per-service modules under `src/adapters/aws/`
- [ ] Refactor `aws-adapter.test.ts` to test service modules individually
- [ ] Eliminate `(adapter as any)` private method access in tests

### Sprint 3 (Week 6–8): Persistent Temporal + Feature Parity

- [ ] Implement SQLite-backed temporal storage
- [ ] Add Azure incremental sync (Activity Log)
- [ ] Add GCP incremental sync (Audit Logs)
- [ ] Add K8s Watch API integration

### Sprint 4 (Week 9–11): Cost Parity + Visualization

- [ ] Integrate Azure Cost Management API
- [ ] Integrate GCP Cloud Billing API
- [ ] Build graph visualization web viewer (Cytoscape.js)
- [ ] Add cost heatmap overlay

### Sprint 5 (Week 12–14): Intelligence Layer

- [ ] IQL aggregation functions (sum, avg, min, max, group_by)
- [ ] Compliance framework mapping (SOC2, HIPAA, PCI-DSS)
- [ ] Resource recommendation engine (right-sizing, unused detection)
- [ ] Performance benchmark suite

### Sprint 6 (Week 15–17): Real-Time + Governance

- [ ] Webhook receivers for event-driven sync
- [ ] Agent action modeling (agent nodes + action edges)
- [ ] RBAC for graph queries
- [ ] Natural language → IQL translator

### Sprint 7 (Week 18–20): Polish

- [ ] Interactive CLI graph explorer (TUI)
- [ ] Webhook notifications (Slack/Teams/PagerDuty)
- [ ] Scheduled infrastructure change reports
- [ ] API versioning
- [ ] OpenTelemetry observability
- [ ] SQLite encryption-at-rest

---

## Effort Estimates

| Priority | Items | Total Effort | Impact |
|----------|-------|-------------|--------|
| **P0 — Must Fix** | 7 items | ~2–3 weeks | Correctness, maintainability, developer trust |
| **P1 — High Impact** | 8 items | ~5–7 weeks | Feature parity, production readiness, data reliability |
| **P2 — Competitive Edge** | 7 items | ~10–14 weeks | Market differentiation, category creation |
| **P3 — Polish** | 10 items | ~6–8 weeks | Enterprise readiness, world-class UX |
| **Total** | **32 items** | **~23–32 weeks** | Foundation → World-class infrastructure intelligence platform |

---

## Competitive Positioning After Improvements

| Capability | Espada (Current) | Espada (Post-Audit) | Wiz | Datadog | Firefly |
|-----------|-----------------|--------------------|----|---------|---------|
| Multi-cloud graph | ✅ | ✅ | Cloud security only | Monitoring only | IaC only |
| Infrastructure query language | ✅ IQL | ✅ Enhanced IQL | ❌ | ❌ | ❌ |
| Temporal graph (time travel) | ⚠️ In-memory | ✅ Persistent | ❌ | ❌ | ❌ |
| Blast radius analysis | ✅ | ✅ | ❌ | ❌ | ✅ |
| SPOF detection | ✅ | ✅ | ❌ | ❌ | ❌ |
| Cost attribution | ⚠️ AWS only | ✅ Multi-cloud | ❌ | ✅ | ✅ |
| Drift detection | ✅ | ✅ + auto-remediation | ❌ | ❌ | ✅ |
| Agent governance | ⚠️ Basic | ✅ Full agent graph | ❌ | ❌ | ❌ |
| Graph visualization | ❌ | ✅ Interactive | ✅ | ✅ | ✅ |
| Compliance mapping | ❌ | ✅ Multi-framework | ✅ | ❌ | ❌ |
| Real-time sync | ❌ | ✅ Event-driven | ✅ | ✅ | ⚠️ |
| Custom query language | ✅ | ✅ Enhanced | ❌ | ✅ DQL | ❌ |

**After completing this audit's recommendations, Espada's Knowledge Graph would be the only tool that combines multi-cloud topology + temporal intelligence + a custom query language + agent governance + compliance mapping in a single graph.** That's a defensible category.

---

*Generated from a full code audit of `extensions/knowledge-graph/` — 25,277 LOC source, 11,932 LOC tests, 36 source files, 16 test files.*
