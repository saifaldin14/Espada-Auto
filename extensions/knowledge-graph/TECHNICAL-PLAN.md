# Espada Infrastructure Intelligence — Technical Plan

> **One-liner:** X-ray vision for your AI infrastructure — see everything, know what breaks, stop wasting money.

---

## The Problem (February 2026)

Every company went from "we're experimenting with AI" to "we have 15 agents, 4 LLM providers, GPU clusters on two clouds, 3 vector databases, and our AI infrastructure bill just hit $180K/month." When the CFO asks "what are we actually paying for and what breaks if we cut something?" — **nobody can answer.**

### Why This Is Acute Right Now

- Companies have **multiple LLM providers** (OpenAI, Anthropic, Google, self-hosted) with no unified view
- **GPU instances** are the most expensive resources most companies have ever run — teams spin them up and forget about them
- **AI agents are creating infrastructure autonomously** (Copilot for Azure, Amazon Q, internal agents) — no approval gates, no audit trail
- **Dependency chains are invisible**: if your Pinecone cluster goes down, which of your 12 agents break? Nobody knows
- **EU AI Act is enforcing** — Article 6(2) requires technical documentation of AI system infrastructure. Can't document what you can't see
- **FinOps tools** (CloudHealth, Kubecost) weren't built for AI workloads — they show instance costs but not "this $40K/month GPU cluster serves model X which powers agent Y which handles 60% of customer support"

### Competitive Landscape

| Existing Tools | What They Do | What They Miss |
|---|---|---|
| **Datadog** | Monitors runtime performance | Doesn't understand infrastructure relationships or AI workload topology |
| **CloudHealth / Spot** | Cost optimization | Doesn't understand blast radius or dependencies |
| **Terraform Cloud** | Manages IaC | Doesn't show what you *actually* have (only what's declared) |
| **Firefly / env0 / Spacelift** | IaC drift management | No relationship graph, no agent governance |

**Nobody shows:** "Here's your entire AI infrastructure as a live, queryable graph with cost attribution, blast radius, SPOF detection, and agent governance." That's a new category.

---

## What Already Exists in the Codebase

| Capability | Implementation | Location |
|---|---|---|
| Infrastructure graph data model | `GraphNode`, `GraphEdge`, 30+ resource types, 40+ relationship types | `src/types.ts` (615 LOC) |
| Graph engine with sync, blast radius, drift, cost | `GraphEngine` class, BFS hop distance, field-level diffing | `src/engine.ts` (711 LOC) |
| Persistent storage | SQLite with WAL mode, recursive CTEs, JSON tag filtering, batch transactions | `src/storage/sqlite-store.ts` (1,059 LOC) |
| Graph algorithms | Shortest path (BFS), orphan detection, SPOF detection (Tarjan's), clustering | `src/queries.ts` (374 LOC) |
| Agent tools | 9 tools: blast radius, dependencies, cost, drift, SPOF, path, orphans, status, export | `src/tools.ts` (599 LOC) |
| Export formats | JSON, Graphviz DOT, Mermaid with cost/metadata | `src/export.ts` (291 LOC) |
| AWS adapter skeleton | 31 relationship rules, 17 service mappings, ARN parser | `src/adapters/aws.ts` (494 LOC) |
| Policy scanning bridge | Cross-extension KG ↔ policy engine integration | `src/policy-scan-tool.ts` (407 LOC) |
| Infrastructure SDK | Provider lifecycle, RBAC, approval workflows, risk scoring | `extensions/infrastructure/` (18K LOC) |

**The engine is 80% built. The remaining 20% is the data pipeline feeding it.**

---

## Implementation Plan

### Phase 1: Terraform State Import (Week 1–2)

**Goal:** Parse `terraform.tfstate`, extract all resources + relationships, populate the knowledge graph. No cloud credentials needed — just a state file.

#### Tasks

1. **Terraform state parser** (`src/adapters/terraform.ts`)
   - Read `terraform.tfstate` (JSON format, v4 schema)
   - Extract `resources[]` → map to `GraphNode` (provider, type, name, attributes)
   - Extract implicit relationships from attribute references (e.g., `subnet_id`, `vpc_id`, `security_group_ids`)
   - Handle `terraform_remote_state` data sources (cross-state dependencies)
   - Parse `depends_on` explicit dependencies → `GraphEdge`

2. **Resource type mapping**
   - Map Terraform resource types (`aws_instance`, `aws_lambda_function`, etc.) to existing `GraphResourceType` enum values
   - Map attribute cross-references to `GraphRelationshipType` values
   - Extract tags, region, account from Terraform provider config + resource attributes

3. **Cost estimation from state**
   - Parse instance types, storage sizes, and known pricing dimensions from resource attributes
   - Populate `costPerHour` on `GraphNode` using a static pricing lookup table (start with AWS EC2 + RDS instance types)
   - Mark unknown costs as `null` — don't guess

4. **CLI command** (`espada infra scan`)
   ```
   espada infra scan --terraform ./terraform.tfstate
   espada infra scan --terraform ./terraform.tfstate --output mermaid
   espada infra scan --terraform ./terraform.tfstate --output json
   ```

5. **Terminal output**
   - Summary: total resources, edges, orphans, SPOFs, estimated monthly cost
   - Mermaid dependency graph (rendered in terminal or saved to file)
   - Warnings: orphaned resources, single points of failure, untagged resources

#### Definition of Done
- Parse a real-world Terraform state file (50+ resources) in < 2 seconds
- Correctly identify VPC → Subnet → Instance → Security Group dependency chains
- Detect orphaned resources (no inbound edges)
- Output a readable Mermaid graph
- Unit tests covering all resource type mappings and edge extraction

---

### Phase 2: The "Scary" Dashboard Report (Week 3–4)

**Goal:** Produce a single command that outputs a comprehensive infrastructure report — the screenshot that sells the product.

#### Output Format

```
╔══════════════════════════════════════════════════════════════╗
║                 ESPADA INFRASTRUCTURE SCAN                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Resources:     47 across 3 providers                        ║
║  Relationships: 128 dependencies mapped                      ║
║  Monthly Cost:  $23,400 (estimated)                          ║
║                                                              ║
║  ⚠ FINDINGS                                                  ║
║  ──────────                                                  ║
║  4 orphaned instances              $8,200/mo wasted          ║
║  2 single points of failure        blast radius: 12 nodes    ║
║  6 resources with no tags          ungovernable               ║
║  3 GPU instances idle > 7 days     $4,100/mo burning         ║
║                                                              ║
║  Run `espada infra report --full` for details                ║
╚══════════════════════════════════════════════════════════════╝
```

#### Tasks

1. **Report generator** (`src/report.ts`)
   - Aggregate all KG query results into a structured report object
   - Format for terminal (ANSI), JSON, Markdown, and HTML
   - Include: resource count by type/provider, cost breakdown, orphans list, SPOF list, untagged resources, top 5 most expensive resources, top 3 highest blast-radius nodes

2. **Detailed drill-down commands**
   ```
   espada infra report --full           # everything
   espada infra report --orphans        # orphaned resources with cost
   espada infra report --spof           # single points of failure + blast radius
   espada infra report --cost           # cost breakdown by service/team/tag
   espada infra report --untagged       # governance gaps
   ```

3. **Export for sharing**
   - `--output markdown` for pasting into Slack/Notion/GitHub
   - `--output html` for self-contained shareable report
   - `--output json` for pipeline integration

#### Definition of Done
- Single command produces the full report from a Terraform state file
- Report correctly calculates wasted spend on orphaned resources
- SPOF analysis includes blast radius count per critical node
- Output is visually compelling in terminal (screenshot-worthy)

---

### Phase 3: Live AWS Discovery (Month 2)

**Goal:** Wire up the existing AWS adapter skeleton to make real SDK calls. Discover what Terraform doesn't manage.

#### Tasks

1. **Implement `discoverService()`** in `src/adapters/aws.ts`
   - EC2: `DescribeInstances`, `DescribeVpcs`, `DescribeSubnets`, `DescribeSecurityGroups`
   - Lambda: `ListFunctions`, `ListEventSourceMappings`
   - ECS/EKS: `ListClusters`, `DescribeServices`, `ListNodegroups`
   - S3: `ListBuckets`, `GetBucketTagging`
   - RDS: `DescribeDBInstances`, `DescribeDBClusters`
   - SageMaker: `ListEndpoints`, `ListNotebookInstances` (AI workloads)
   - Bedrock: `ListFoundationModels`, `ListProvisionedModelThroughputs` (AI workloads)
   - Use existing 31 relationship extraction rules — they already map SDK responses to edges

2. **Credential handling**
   - Support AWS credential chain (env vars, `~/.aws/credentials`, IAM role, SSO)
   - Read-only access only — never modify infrastructure
   - Multi-account via `sts:AssumeRole` for cross-account discovery

3. **Drift detection**
   - Compare Terraform state graph vs live AWS graph
   - Use existing `detectDrift()` in `engine.ts` (field-level diffing already built)
   - Flag: resources in AWS but not in Terraform (shadow IT), resources in Terraform but not in AWS (zombie state)

4. **AI-specific resource discovery**
   - SageMaker endpoints, notebook instances, training jobs
   - Bedrock provisioned throughput, model invocation logs
   - EC2 instances with GPU (filter by instance type: `p4d`, `p5`, `g5`, `inf2`, `trn1`)
   - Map GPU instances → the models/services they host (via tags or naming conventions)

#### Definition of Done
- Discover 80%+ of common AWS resources without Terraform
- Correctly detect drift between Terraform state and live infrastructure
- Identify GPU/AI-specific workloads and their cost
- Run full discovery on a real AWS account in < 60 seconds
- `healthCheck()` returns `true` when credentials are valid

---

### Phase 4: Agent Governance Layer (Month 3)

**Goal:** When AI agents (Espada's own or third-party) attempt to modify infrastructure, route through approval gates with full audit trail.

#### Tasks

1. **Change request pipeline**
   - Intercept infrastructure modification commands before execution
   - Score change risk using existing infrastructure SDK risk scoring
   - Route high-risk changes to approval workflow (Slack/Teams/CLI notification)
   - Low-risk changes: auto-approve with audit log

2. **Risk scoring for AI-initiated changes**
   - Use KG blast radius to calculate impact score
   - Factor in: resource cost, number of dependent resources, environment (prod vs staging), time of day
   - GPU/AI workload changes get elevated risk scores (high cost, hard to recover)

3. **Audit trail**
   - Every change (approved/rejected/auto-approved) recorded in KG `changes` table (append-only, already in schema)
   - Track: who initiated (human/agent), what changed, risk score, approval status, timestamp
   - Query: "show me everything Agent X changed in prod this week"

4. **Policy engine integration**
   - Leverage existing `policy-scan-tool.ts` bridge
   - Pre-execution policy checks: "no GPU instances without cost tags", "no public S3 buckets", "no prod changes without approval"
   - Post-execution verification: re-scan KG to confirm change didn't violate policies

#### Definition of Done
- AI agent infrastructure changes routed through approval for high-risk operations
- Full audit trail queryable via KG tools
- Policy violations blocked before execution
- Dashboard showing: changes per agent, approval rate, policy violations

---

### Phase 5: Multi-Cloud (Month 4–5)

**Goal:** Extend discovery to Azure and GCP. Unified graph across all clouds.

#### Tasks

1. **Azure adapter** (`src/adapters/azure.ts`)
   - Resource Graph API for bulk discovery (much faster than per-service calls)
   - Azure OpenAI Service resources (AI workloads)
   - Map to existing `GraphResourceType` and `GraphRelationshipType`

2. **GCP adapter** (`src/adapters/gcp.ts`)
   - Cloud Asset Inventory API for bulk discovery
   - Vertex AI resources (AI workloads)
   - Map to existing types

3. **Cross-cloud relationships**
   - VPN/peering connections between clouds
   - Shared DNS, shared IAM (federated identity)
   - AI workloads that span clouds (model on AWS, inference on GCP)

4. **Unified cost view**
   - Normalize billing data across AWS/Azure/GCP
   - Attribute costs to graph nodes
   - Show total AI infrastructure cost across all clouds

---

### Phase 6: Continuous Monitoring (Month 5–6)

**Goal:** Move from point-in-time scans to continuous, real-time infrastructure intelligence.

#### Tasks

1. **Scheduled sync**
   - Periodic re-scan (configurable: every 5 min, hourly, daily)
   - Differential sync — only process changes since last scan
   - Use existing `sync()` method in engine (already does field-level diffing)

2. **Event-driven updates**
   - AWS CloudTrail → real-time infrastructure change events
   - Azure Activity Log → same
   - Terraform Cloud webhooks → plan/apply notifications

3. **Alerting**
   - New orphaned resource → Slack/Teams/email alert
   - SPOF introduced → alert with blast radius
   - Cost anomaly (> 20% increase in 24h) → alert with attribution
   - Unauthorized change (no approval record) → high-priority alert

4. **Timeline / history**
   - Use existing `getTimeline()` in engine + `changes` table
   - "Show me what changed in prod last week" → visual diff of graph
   - Rewind: "what did our infrastructure look like 30 days ago?"

---

## Go-to-Market Strategy

### Target Customer
**AI-native startups, Series A–B, spending $50–200K/month on AI infrastructure with 2–5 person infra teams.**

They're growing fast, have no visibility, and don't have a dedicated platform engineering team. They're drowning in complexity.

### The Wedge
**Free Terraform state analysis.** No credentials, no install, upload a state file and get a report. The report is the lead gen.

### Pricing
- **Free tier:** Terraform state scan, up to 50 resources, Mermaid export
- **Team ($500/mo):** Live cloud discovery, continuous monitoring, up to 500 resources
- **Business ($2,000/mo):** Multi-cloud, agent governance, audit trail, unlimited resources
- **Enterprise (custom):** SSO, RBAC, dedicated support, on-prem deployment

Pays for itself if it finds one orphaned GPU instance.

### Launch Sequence

1. **The "infrastructure horror story" tweet** — run the scan against a Terraform example, screenshot orphaned resources + wasted spend. "Just ran our infra through Espada. Found $8K/mo in orphaned GPU instances nobody knew existed."

2. **Technical blog post** — "How we built an infrastructure knowledge graph that finds your wasted GPU spend" — deep technical content, show the graph algorithms, attract infra engineers.

3. **Hacker News / Reddit /r/devops launch** — free tool, instant value, no signup wall for the basic scan.

4. **Direct outreach** — identify companies posting about AI infrastructure pain on Twitter/LinkedIn. DM with: "I built a tool that might help — can I scan your Terraform state for free?"

### Key Metric
**Time to first "holy shit" moment:** < 5 minutes from `espada infra scan --terraform` to seeing orphaned resources and wasted spend.

---

## Technical Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│                    CLI / API                          │
│         espada infra scan / report / monitor          │
├─────────────────────────────────────────────────────┤
│                  Report Generator                     │
│        Terminal / Markdown / HTML / JSON               │
├─────────────────────────────────────────────────────┤
│                  Agent Tools (9)                       │
│   blast_radius · cost · drift · spof · orphans · ...  │
├─────────────────────────────────────────────────────┤
│               Graph Engine (engine.ts)                │
│     sync · blast radius · drift · cost · timeline     │
├─────────────────────────────────────────────────────┤
│             Graph Algorithms (queries.ts)              │
│       BFS · Tarjan's SPOF · clustering · orphans      │
├─────────────────────────────────────────────────────┤
│            SQLite Storage (sqlite-store.ts)            │
│     nodes · edges · changes · groups · sync_records   │
├─────────────────────────────────────────────────────┤
│                   Data Adapters                        │
│  Terraform State │ AWS SDK │ Azure │ GCP │ CloudTrail │
└─────────────────────────────────────────────────────┘
```

---

## Milestones

| Milestone | Target | Success Metric |
|---|---|---|
| Terraform scanner ships | Week 2 | Parse 50+ resource state file in < 2s |
| First public demo | Week 4 | Screenshot-worthy report output |
| First external user | Month 2 | Someone outside the company runs a scan |
| AWS live discovery | Month 2 | Discover 80%+ of common resources |
| Agent governance MVP | Month 3 | First AI-initiated change goes through approval |
| First paying customer | Month 3–4 | $500+/mo recurring |
| Multi-cloud | Month 5 | Azure + GCP adapters functional |
| Continuous monitoring | Month 6 | Real-time alerts on infrastructure changes |
