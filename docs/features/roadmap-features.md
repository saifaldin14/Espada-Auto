# Espada — Product Capabilities & Roadmap Features

## Overview

Espada is an AI-native infrastructure control plane. It combines a conversational AI agent runtime, a multi-cloud infrastructure management layer, a real-time knowledge graph, and a governance framework into a single self-hosted platform.

This document describes Espada's core capabilities, planned features, and how they work together to solve real operational problems for engineering teams managing cloud infrastructure.

---

## Core Platform Capabilities

### AI Agent Runtime

Espada's foundation is a production-grade AI agent runtime that manages the full lifecycle of AI-powered infrastructure operations.

**What it does:**

- Orchestrates 14+ LLM providers (Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, xAI, Mistral, DeepSeek, and more) with automatic failover and auth profile rotation
- Runs sessions with context window management, compaction, and persistence
- Enforces tool policies — controls which tools agents can invoke, with per-agent allowlists and deny rules
- Manages concurrency via lane-based execution, preventing conflicting operations from running simultaneously
- Supports multi-agent orchestration with sub-agent spawning, lifecycle events, and cross-agent communication
- Sandboxes agent execution in Docker containers with configurable isolation

**Why it matters:**

AI agents that operate infrastructure must be reliable, auditable, and controllable. Espada's runtime ensures that every agent action is policy-checked, logged, and recoverable — whether the agent is responding to a Slack message or executing a scheduled cron workflow.

---

### Infrastructure Knowledge Graph

Espada maintains a live graph of your entire cloud infrastructure — every resource, every relationship, every cost — with a custom query language and time-travel capabilities.

**What it does:**

- **Live cloud sync** — Adapters for AWS (30+ services), Azure (80+ services), GCP, Kubernetes, and Terraform continuously discover resources and ingest them as graph nodes with edges representing dependencies (e.g., EC2 instance → security group → VPC → subnet)
- **IQL (Infrastructure Query Language)** — A purpose-built query language for infrastructure queries:
  ```
  FIND compute WHERE provider = "aws" AND cost > 100 AND tagged("env", "production")
  FIND downstream FROM "vpc-0abc123" WHERE type = "database"
  SUMMARIZE cost BY provider, resourceType
  FIND PATH FROM "api-gateway-prod" TO "rds-primary"
  ```
- **Temporal snapshots** — Point-in-time snapshots of the entire graph state with diffing. Answer questions like "what changed in our infrastructure between last Tuesday and today?"
- **Drift detection** — Compares desired state (Terraform/Pulumi) against actual state (live cloud) and surfaces divergences
- **Blast radius analysis** — Before any change executes, traverse the dependency graph to identify everything downstream that could be affected
- **Cost attribution** — Every node carries cost data. Aggregate by team, service, environment, or any tag dimension
- **Federation** — Merge graphs across multiple Espada instances or extension namespaces with configurable conflict resolution
- **4 storage backends** — SQLite (default), SQLite with temporal extensions, PostgreSQL (production), and in-memory (testing)

**Why it matters:**

Most teams manage infrastructure through disconnected tools — the AWS console, Terraform state files, Kubernetes dashboards, cost reports. Espada unifies all of this into a single queryable graph. When an engineer asks "what depends on this database?" the answer is immediate, complete, and includes cross-cloud dependencies.

---

### Multi-Cloud Infrastructure Management

Espada manages cloud resources across AWS, Azure, and GCP through deep, service-level integrations — not thin API wrappers.

**AWS — 30+ Service Domains (117K lines)**

Full lifecycle management for: EC2, RDS, Lambda, S3, DynamoDB, ECS/EKS, API Gateway, CloudTrail, Cognito, SNS, SQS, Route53, ElastiCache, CloudFront, IAM, VPC, Security Groups, NAT Gateways, Load Balancers, Auto Scaling, Backup, Cost Explorer, Organizations, and more.

Each service domain includes:
- Resource discovery and inventory
- Create / update / delete operations
- Configuration validation and guardrails
- Cost estimation
- Compliance checks against SOC2, HIPAA, PCI-DSS, GDPR, CIS, and NIST 800-53

**Azure — 80+ Service Domains (37K lines)**

Covers: Virtual Machines, App Service, Functions, AKS, Cosmos DB, SQL Database, Storage, Key Vault, Application Gateway, Front Door, CDN, Event Grid, Event Hubs, Service Bus, Logic Apps, Data Factory, Synapse, Purview, Digital Twins, Spring Apps, Static Web Apps, SignalR, Notification Hubs, Redis Cache, Traffic Manager, Bastion, Firewall, DNS, Monitor, DevOps (with PAT management), and more.

Includes an orchestration engine with blueprints, step execution, and a reconciliation engine for desired-state convergence.

**GCP — 47 Service Domains (10K lines)**

Covers: Compute Engine, GKE, Cloud Functions, Cloud Run, App Engine, Cloud SQL, Firestore, BigQuery, Pub/Sub, Cloud Storage, Cloud DNS, Cloud CDN, IAM, KMS, Secret Manager, Cloud Scheduler, Cloud Tasks, Redis, Monitoring, Logging, and more.

**Why it matters:**

Most companies are multi-cloud, even if they don't plan to be. Espada provides a single interface to manage resources across all three major providers with consistent governance, cost tracking, and policy enforcement.

---

### Intent Compiler & Execution Engine

Espada translates high-level goals into executable infrastructure plans.

**What it does:**

- **Intent compilation** — Transforms natural language or structured intents (e.g., "deploy a 3-tier web application with a PostgreSQL database, auto-scaling, and CDN") into a complete infrastructure plan with resource specifications, dependency ordering, cost estimates, and security group configurations
- **Execution engine** — Provisions real infrastructure using AWS SDK calls (not Terraform under the hood). Manages VPCs, subnets, security groups, RDS instances, ECS clusters, load balancers, auto-scaling groups, and more
- **Dependency ordering** — Resources are created in the correct sequence based on their dependency graph. A subnet is created before the instance that runs in it
- **Rollback** — If any step fails, the engine rolls back previously created resources in reverse dependency order
- **Cost estimation** — Before execution, the compiler estimates monthly costs using pluggable pricing providers or built-in static price tables
- **Guardrails** — Policy checks run before execution to prevent non-compliant resources from being created

**Why it matters:**

Infrastructure provisioning today requires writing Terraform, clicking through consoles, or reading documentation. Espada lets an engineer say "I need a staging environment for our API" and get a reviewed, costed, policy-checked infrastructure plan that executes with one approval click.

---

### Infrastructure as Code Bridges

Espada integrates bidirectionally with existing IaC tools.

**Terraform**
- **Import:** Parse Terraform state files and convert resources into knowledge graph nodes with full lineage
- **Export:** Generate HCL code from knowledge graph state (codify existing infrastructure into Terraform)
- **State management:** Read, inspect, and manage Terraform state and backend configurations
- **Plan analysis:** Parse and evaluate Terraform plan outputs before applying

**Pulumi**
- State parsing and graph bridge for Pulumi-managed resources
- CLI wrapper for programmatic Pulumi operations

**Kubernetes**
- Manifest parsing and graph integration
- Helm chart management (install, upgrade, rollback, template rendering)
- CLI wrapper with namespace-aware operations

**Why it matters:**

Teams don't adopt new tools by throwing away existing ones. Espada works *with* Terraform and Kubernetes, not instead of them. Import existing infrastructure into the knowledge graph, apply governance policies, and optionally generate IaC code from discovered resources.

---

### Governance & Policy Enforcement

Espada enforces policy at the point of execution — not after the fact.

**Change Governance**
- Every infrastructure change (human or AI-initiated) is captured as a structured change request
- Risk scoring uses blast radius, cost impact, dependent resource count, environment classification (prod vs. staging), GPU/AI workload flags, and time-of-day
- Low-risk changes are auto-approved; high-risk changes require human approval via any connected messaging channel
- Full append-only audit trail of every request, approval, rejection, and execution

**Policy Engine**
- 7 policy types: plan, access, approval, notification, drift, cost, deployment
- 20+ built-in policy templates (deny-public-s3, require-encryption, require-tags, cost-threshold, block-prod-deletes)
- Composable rule conditions with nested AND/OR/NOT logic
- 4 agent tools: evaluate policies, list policies, check plans, query violations

**OPA/Rego Integration**
- Evaluate change requests against Open Policy Agent policies
- Remote OPA server support (HTTP REST API)
- Local Rego bundle evaluation for offline/embedded use
- Violations mapped to severity levels with deny/warn/require_approval/notify actions

**Compliance Framework**
- 6 built-in frameworks: SOC2, CIS, HIPAA, PCI-DSS, GDPR, NIST 800-53
- Controls for encryption, access logging, public access prevention, backup, tagging, MFA
- Compliance scanning with scored results, violation tracking, and waiver management
- Per-resource compliance reports

**Exec Approvals**
- Fine-grained shell command approval system for AI agents
- Deny/allowlist/full modes with per-agent policies
- Pattern-based allowlists with audit logging
- Unix domain socket-based approval forwarding

**Why it matters:**

Letting AI agents operate infrastructure without governance is reckless. Letting them operate with after-the-fact auditing is insufficient. Espada puts policy enforcement *in the execution path* — a non-compliant change is blocked before it happens, not flagged after it breaks something.

---

### Enterprise Security

**Authentication**
- SSO via OpenID Connect (Okta, Microsoft Entra ID, Google Workspace, Auth0, any standards-compliant IdP)
- SAML 2.0 support
- Multi-factor authentication (MFA)
- Device pairing with authentication tokens

**Authorization (RBAC)**
- 60+ fine-grained permissions across 10 domains (operator, policy, audit, graph, terraform, compliance, blueprints, VCS, cost, config)
- Built-in roles with custom role support
- File-backed persistent storage for production, in-memory for testing
- Role assignment management with IdP group mapping

**Security Auditing**
- Comprehensive security scanner with attack surface analysis
- Exposure matrix assessment
- Hooks hardening checks
- Model hygiene validation
- Secrets-in-config detection
- Filesystem permission scanning
- Gateway deep probe

**Network Security**
- SSRF protection with DNS-level blocking of private IPs, IPv4-mapped IPv6, and cloud metadata endpoints
- TLS with certificate fingerprinting
- WebSocket authentication and session management

---

### Operational Infrastructure

**Gateway Server**
- Single always-on process with multiplexed WebSocket + HTTP on `127.0.0.1:18789`
- OpenAI-compatible API (`/v1/chat/completions`, `/v1/responses`)
- Hot configuration reload (safe changes live, critical changes via in-process restart)
- Node mesh networking for distributed deployments
- Tailscale network exposure support

**Memory System**
- SQLite-backed vector search with sqlite-vec
- Hybrid BM25 + vector retrieval for semantic search
- Embedding batching across OpenAI and Gemini providers
- Session transcript indexing with file watching
- Chunk overlap management and embedding cache

**Cron & Automation**
- Scheduled agent jobs with cron expressions
- Webhook-triggered workflows
- Event-driven hooks with Gmail integration
- Isolated agent execution for scheduled tasks

**Browser Automation**
- CDP (Chrome DevTools Protocol) integration
- Playwright-based automation with AI module
- Chrome profile management and extension relay
- Screenshot capture and tab management

**16+ Messaging Channels**
- WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, WebChat, Microsoft Teams, Matrix, BlueBubbles, Zalo, LINE, Mattermost, Nostr, Twitch

---

## Planned Features

### 1. Live Infrastructure Dashboard

A real-time visual interface for monitoring and operating cloud infrastructure.

**Capabilities:**
- **Cloud spend overview** — Total spend across AWS/Azure/GCP with trend lines, month-over-month comparison, and budget tracking
- **Infrastructure topology map** — Interactive visualization of the knowledge graph, showing resource relationships, dependency paths, and blast radius zones
- **Alert feed** — Live stream of drift detections, cost anomalies, policy violations, and security findings
- **Approval queue** — Pending change requests from AI agents and automated workflows, with one-click approve/reject
- **Change timeline** — Chronological view of all infrastructure modifications with who/what initiated them, risk scores, and outcomes
- **Cost forecasting** — Forward-looking cost projections using linear regression, Holt-Winters seasonal decomposition, EWMA, and ensemble model selection

**Technical approach:** The knowledge graph, audit trail, and cost forecasting engine provide the data layer. The dashboard is a web application served from the gateway's existing HTTP server, consuming data via the internal API and WebSocket event stream.

---

### 2. Drift Detection & Auto-Remediation

Automated detection and correction of infrastructure configuration drift.

**Capabilities:**
- **Continuous drift monitoring** — Compare live cloud state against desired state (Terraform state, Pulumi state, or knowledge graph baseline) on a configurable schedule
- **Drift classification** — Categorize drift by severity (critical: security group opened to 0.0.0.0/0, low: tag mismatch), affected resource type, and blast radius
- **Remediation plan generation** — When drift is detected, the intent compiler generates a remediation plan that restores the resource to its desired state
- **Governed execution** — Remediation plans route through the standard governance pipeline: risk scoring, policy checks, approval gates (auto-approve low-risk, require human approval for high-risk)
- **Drift history** — Temporal snapshots track when drift occurred, what changed, and whether it was remediated, rolled back, or accepted

**Technical approach:** The knowledge graph's existing drift detection compares node properties against their last-synced state. The remediation loop connects drift findings → intent compiler (generate fix) → governance (approve) → execution engine (apply) → knowledge graph (verify).

---

### 3. Cost Optimization Autopilot

Automated identification and execution of cloud cost savings.

**Capabilities:**
- **Idle resource detection** — Identify compute instances, databases, load balancers, and other resources with sustained low utilization using CloudWatch (AWS), Azure Monitor, and GCP Monitoring metrics
- **Right-sizing recommendations** — Analyze utilization patterns and recommend cheaper instance types that match actual workload requirements, with projected monthly savings
- **Reserved instance / savings plan analysis** — Compare on-demand spend against reserved pricing and recommend commitment purchases based on usage stability
- **Scheduled scaling** — Identify resources that can be scaled down during off-hours (nights, weekends) and generate scaling schedules
- **One-click optimization** — Each recommendation generates an executable plan that routes through governance approval and executes via the standard infrastructure management pipeline
- **Savings tracking** — After optimization, track actual vs. projected savings with monthly reports

**Technical approach:** The knowledge graph already carries cost data on every node. Add utilization metric ingestion (CloudWatch `GetMetricData`, Azure Monitor Metrics API, GCP Monitoring API), right-sizing logic comparing utilization against instance family capabilities, and recommendation generation via the intent compiler.

---

### 4. EU AI Act Governance Module

Runtime compliance enforcement for the EU Artificial Intelligence Act (Regulation 2024/1689).

**Context:** The EU AI Act enters enforcement for high-risk AI systems and deployer obligations in August 2026. Organizations that deploy AI systems — including AI agents that operate infrastructure — face penalties of up to €35M or 7% of global turnover for non-compliance. Most mid-market companies have no compliance tooling for this regulation.

**Capabilities:**

- **AI System Registry** — Register every AI system (LLM endpoints, agent workflows, automated decision pipelines) as a classified node in the knowledge graph. Each system is assigned a risk tier (unacceptable, high, limited, minimal) per Article 6 and Annex III
- **FRIA (Fundamental Rights Impact Assessment)** — A guided workflow for conducting Fundamental Rights Impact Assessments as required by Article 27 for high-risk AI deployers. Uses a state machine (similar to the existing incident lifecycle) with phases: scoping → data collection → rights analysis → mitigation planning → review → documentation → approval
- **AI-Specific Policy Rules** — Extend the policy engine with AI Act-specific rules:
  - `require-risk-classification` — Block deployment of AI systems without a risk tier classification
  - `block-unclassified-ai-deployment` — Prevent unregistered AI systems from executing infrastructure operations
  - `require-human-review-high-risk` — Mandate human oversight for decisions made by high-risk AI systems
  - `require-fria-before-deployment` — Ensure FRIA completion before deploying high-risk AI systems
  - `ai-transparency-disclosure` — Require documentation of AI system capabilities and limitations
- **AI Decision Audit Trail** — Extend the audit trail with AI-specific event types:
  - `ai.system.registered` — New AI system added to the registry
  - `ai.risk.classified` — Risk tier assigned or changed
  - `ai.decision.logged` — AI agent decision captured with model inputs, outputs, confidence scores, and reasoning
  - `ai.fria.initiated` / `ai.fria.completed` — FRIA lifecycle events
  - `ai.human.override` — Human overrode an AI decision
  - `ai.model.invoked` — LLM call logged with provider, model, token usage, and latency
- **Article-to-Feature Mapping** — Documented mapping of each relevant AI Act article to the Espada feature that addresses it:
  - Article 9 (Risk Management) → Risk scoring in governance layer + knowledge graph risk classification
  - Article 11 (Technical Documentation) → Auto-generated from knowledge graph AI system nodes
  - Article 12 (Record-Keeping) → Audit trail with AI-specific event types
  - Article 13 (Transparency) → AI system registry with capability documentation
  - Article 14 (Human Oversight) → Approval gates for high-risk AI decisions
  - Article 26 (Deployer Obligations) → FRIA workflow + AI policy enforcement
  - Article 27 (FRIA) → Guided FRIA state machine

**Technical approach:** Espada already governs its own AI agent operations — every tool invocation, model call, and infrastructure change is policy-checked and audited. The AI Act module extends this existing governance to explicitly satisfy regulatory requirements, using the same compliance framework (add `EU-AI-ACT` as a 7th framework), policy engine (add AI-specific rule conditions), and audit trail (add AI-specific event types) that already handle SOC2, HIPAA, and other frameworks.

---

### 5. API-First Architecture & Embeddable SDK

A clean public API and TypeScript SDK for programmatic access and third-party integration.

**Capabilities:**

- **REST API** — Documented HTTP endpoints for all major operations:
  - `/api/v1/graph` — Query, sync, and manage the knowledge graph
  - `/api/v1/governance` — Submit change requests, check approval status, query audit trail
  - `/api/v1/policies` — Manage and evaluate policies
  - `/api/v1/compliance` — Run compliance scans, generate reports
  - `/api/v1/costs` — Query cost data, run forecasts, get optimization recommendations
  - `/api/v1/agents` — Manage agent sessions, invoke tools, check status
- **TypeScript SDK** — A typed client library for embedding Espada capabilities into other applications:
  ```typescript
  import { EspadaClient } from '@espada/sdk';

  const espada = new EspadaClient({ endpoint: 'https://...', apiKey: '...' });

  // Query infrastructure
  const nodes = await espada.graph.query('FIND compute WHERE cost > 100');

  // Evaluate a change against policies
  const result = await espada.governance.evaluate({
    action: 'create',
    resourceType: 'database',
    provider: 'aws',
    metadata: { instanceType: 'db.r6g.xlarge', multiAz: true }
  });

  // Get cost forecast
  const forecast = await espada.costs.forecast({ horizon: '90d', groupBy: 'provider' });
  ```
- **Webhook events** — Subscribe to real-time events (drift detected, approval requested, compliance violation, cost anomaly) via configurable webhook endpoints
- **API key management** — Scoped API keys with RBAC permission integration

**Technical approach:** The internal APIs for graph queries, governance, policy evaluation, and cost analysis already exist. The SDK wraps these in a clean public interface with OpenAPI documentation, authentication middleware, and rate limiting.

---

### 6. Multi-Tenant Architecture

Support for managing multiple isolated customer environments from a single Espada deployment.

**Capabilities:**

- **Tenant isolation** — Each tenant gets an isolated knowledge graph, policy set, audit trail, and configuration. No cross-tenant data leakage
- **Tenant-aware storage routing** — Queries and writes are automatically scoped to the authenticated tenant's data partition
- **Per-tenant RBAC** — Role definitions and assignments are tenant-scoped. A tenant admin can manage their own roles without affecting other tenants
- **Tenant provisioning API** — Programmatic tenant creation, configuration, and teardown
- **Resource quotas** — Per-tenant limits on graph nodes, API calls, agent sessions, and storage

**Technical approach:** The knowledge graph's federation layer already supports namespace isolation and peer-scoped queries. RBAC already uses scoped role definitions. The primary work is adding tenant context to the storage layer, authentication pipeline, and API routing.

---

### 7. OpenTelemetry Integration

Bidirectional integration with the OpenTelemetry ecosystem for observability interoperability.

**Capabilities:**

- **Metric ingestion** — Pull CPU, memory, network, and disk metrics from existing observability stacks (via OTLP receiver) and correlate them with knowledge graph nodes. Every compute instance, database, and container in the graph gets live utilization data
- **Event export** — Push Espada events (governance decisions, drift alerts, cost anomalies, compliance violations, agent actions) as OTLP signals into existing monitoring tools (Datadog, Grafana, New Relic, Elastic)
- **Trace correlation** — Link infrastructure changes to application traces. When an AI agent scales a service, the trace context propagates through the change request, execution, and verification
- **Custom metrics** — Expose Espada operational metrics (graph sync duration, policy evaluation latency, agent session count, approval queue depth) as OTLP metrics for monitoring Espada itself

**Technical approach:** The `diagnostics-otel` extension provides the foundation. Extend it with an OTLP receiver for metric ingestion, correlation logic mapping OTLP resource attributes to knowledge graph node IDs, and an OTLP exporter for Espada's internal event stream.

---

---

## Strategic Defensibility — The Data Moat

Code can be replicated. In an era of AI-assisted development, any feature set can be rebuilt in weeks. Espada's long-term defensibility comes not from code, but from **accumulated operational data** that compounds over time and cannot be copied.

The core insight: every hour Espada runs in a customer environment, it becomes harder to replace — not because of switching costs, but because the platform accumulates institutional knowledge that no competitor starts with.

### Defensibility Layer 1 — Operational Data Flywheel

Every action Espada takes generates feedback:

- An AI agent recommends a right-sizing change → the customer approves or rejects → Espada learns which recommendations are trusted
- A drift remediation executes → the outcome succeeds or fails → Espada calibrates blast-radius scoring
- A cost forecast predicts next month's spend → actual spend arrives → the forecasting model self-corrects
- A policy blocks a deployment → the operator overrides or accepts → Espada learns which policies are noise vs. signal

After 6 months of operation, Espada's recommendations are tuned to that customer's actual decision patterns. A competitor starting from zero has none of this history.

### Defensibility Layer 2 — Customer Infrastructure State

The knowledge graph accumulates months of temporal snapshots — every resource, relationship, cost, and configuration change over time. This historical state enables:

- "What did our infrastructure look like 3 months ago?"
- "When did this security group get opened, and who approved it?"
- "Show me the cost trend for our production databases over the last quarter"

This data is unique to each customer and cannot be replicated by a new tool.

### Defensibility Layer 3 — Policy & Governance Corpus

Every customer builds a body of governance knowledge inside Espada:

- Custom OPA/Rego policies encoding organizational rules
- Approval patterns showing who approves what and under which conditions
- Compliance scan history with waiver justifications
- Risk scoring calibrations tuned to the organization's actual risk tolerance

This corpus represents months of security and compliance team labor. Migrating away means rebuilding all of it.

### Defensibility Layer 4 — Integration Mesh

Espada correlates data across systems that don't natively talk to each other:

- Cloud provider APIs + Terraform state + Kubernetes manifests + cost data + compliance frameworks + OTel metrics
- Cross-cloud dependency graphs that no single-cloud tool can provide
- Alert correlation connecting infrastructure drift to cost anomalies to compliance violations

The value compounds with each integration added. A customer running Espada across AWS + Azure + Terraform + Kubernetes has a unified operational picture that would take months to reconstruct elsewhere.

### Defensibility Layer 5 — Domain-Specific AI Models

As operational data accumulates, Espada trains increasingly accurate models:

- **Cost forecasting** — Ensemble models (Holt-Winters, EWMA, linear regression) calibrated on actual spend patterns
- **Risk scoring** — Blast-radius weights tuned to real incident correlation
- **Anomaly detection** — Baselines built from months of normal operational behavior
- **Recommendation confidence** — Approval/rejection patterns that teach the system which suggestions to surface confidently vs. flag for review

These models improve with every week of operation and cannot be replicated without the underlying data.

### Defensibility Layer 6 — Certifications & Compliance Attestations

Regulatory certifications create hard barriers to entry:

- **SOC 2 Type II** — 12-month audit cycle, $50K-$150K cost, demonstrates operational maturity
- **ISO 27001 / ISO 42001** — Information security and AI management system certification
- **EU AI Act Conformity Assessment** — When enforcement begins August 2026, certified compliance becomes a procurement requirement
- **FedRAMP** — Required for U.S. federal government customers, 12-18 month authorization process

Each certification is a moat that takes a competitor 12+ months and significant capital to cross.

### The Flywheel in Practice

```
   Customer deploys Espada
           │
           ▼
   Infrastructure discovered,
   graph populated, baselines set
           │
           ▼
   AI agents make recommendations
   (right-sizing, drift fixes, policy suggestions)
           │
           ▼
   Customer approves/rejects/modifies
           │
           ▼
   Feedback loops calibrate models
   (cost forecasts, risk scores, recommendation confidence)
           │
           ▼
   Recommendations get better over time
           │
           ▼
   Customer relies on Espada more
   (more integrations, more policies, more history)
           │
           ▼
   Switching cost increases organically
   (not through lock-in, but through accumulated value)
```

**Bottom line:** Stop thinking about what features to build. Start thinking about what data to accumulate. The features are the delivery mechanism; the data is the product.

---

### 8. Operational Feedback Loops

Systematic capture and utilization of human decisions to improve AI agent recommendations over time.

**Capabilities:**

- **Decision tracking** — Every approval, rejection, modification, and override of an AI recommendation is stored with context (who, when, why, what the recommendation was, what the alternative chosen was)
- **Recommendation scoring** — Track acceptance rate per recommendation type, per resource type, per environment. Surface only high-confidence recommendations by default; flag low-confidence suggestions for review
- **Model calibration pipeline** — Periodically retrain cost forecasting, risk scoring, and anomaly detection models using accumulated operational data. Compare model predictions against actual outcomes and adjust weights
- **Policy suggestion engine** — Analyze patterns in manual approvals and rejections to suggest new policy rules. If an operator consistently rejects public S3 bucket creations, suggest codifying that as a policy
- **Feedback dashboard** — Visualize recommendation accuracy over time, model drift, and calibration status

**Technical approach:** Extend the audit trail to capture structured decision metadata (not just "approved" but "approved with modification: changed instance type from r6g.xlarge to r6g.large"). Add a calibration service that reads decision history, computes acceptance rates, and adjusts recommendation confidence thresholds. Feed cost forecast actuals back into the ensemble model selection.

---

### 9. Infrastructure Intelligence Reports

Automated periodic reports that synthesize operational data into actionable intelligence — demonstrating accumulated platform value.

**Capabilities:**

- **Weekly operational digest** — Auto-generated summary: infrastructure changes made, drift detected and remediated, cost savings realized, policy violations caught, compliance posture score
- **Monthly cost intelligence** — Forecast accuracy report (predicted vs. actual), savings achieved through right-sizing and scheduling, cost trend analysis with anomaly callouts, reserved instance utilization
- **Quarterly governance review** — Policy effectiveness metrics (how many violations caught, false positive rate), approval workflow efficiency, compliance framework coverage gaps, risk score distribution
- **Custom report builder** — IQL-powered report templates that query the knowledge graph and temporal snapshots to answer ad-hoc questions
- **Report delivery** — Push reports to connected messaging channels (Slack, Teams, email) or expose via API

**Technical approach:** Leverage the knowledge graph's temporal snapshots, audit trail, and cost forecasting engine to aggregate and summarize operational data. Reports are generated by scheduled agent jobs using existing cron infrastructure.

---

### 10. Cross-Environment Correlation Engine

Connect signals across infrastructure layers that are invisible in siloed tools.

**Capabilities:**

- **Change-to-incident correlation** — When an incident occurs, automatically surface recent infrastructure changes (within configurable time window) that may have caused it, ranked by blast-radius overlap
- **Cost-to-performance correlation** — Link cost anomalies to utilization changes. If spend spikes, identify which resources scaled and whether performance metrics justified it
- **Drift-to-compliance mapping** — When drift is detected, automatically evaluate whether the drifted state violates any compliance framework and escalate accordingly
- **Cross-cloud dependency impact** — When an AWS resource changes, trace the impact through Kubernetes workloads, Azure integrations, and Terraform state to surface the full blast radius across providers
- **Anomaly clustering** — Group correlated anomalies (cost spike + drift + compliance violation on related resources) into a single investigation context rather than separate alerts

**Technical approach:** The knowledge graph already maintains cross-cloud dependency edges. Add a correlation service that subscribes to the event stream (drift, cost, compliance, change events) and joins them by resource ID, time window, and dependency path. Surface correlated findings as unified investigation contexts in the approval queue and dashboard.

---

### 11. Certification Readiness Toolkit

Tooling that accelerates SOC 2, ISO 27001, ISO 42001, and EU AI Act certification processes.

**Capabilities:**

- **Evidence collection automation** — Automatically gather and package audit evidence from the audit trail, compliance scans, policy configurations, and governance records. Map evidence to specific control requirements
- **Control gap analysis** — Compare current Espada configuration and operational data against certification requirements. Identify gaps with remediation guidance
- **Continuous compliance monitoring** — Real-time compliance posture scoring against each target certification. Alert when operational changes would break compliance
- **Audit-ready exports** — Generate formatted evidence packages (PDF, CSV, JSON) organized by certification framework and control family, ready for auditor submission
- **Certification timeline tracker** — Project management view tracking progress toward each certification with milestone tracking and dependency mapping

**Technical approach:** Extend the existing compliance framework (currently SOC2, CIS, HIPAA, PCI-DSS, GDPR, NIST 800-53) with certification-specific control mappings. The audit trail and policy engine already capture the operational evidence; this feature packages it for external consumption.

---

## Enterprise Scalability — Current Assessment & Requirements

An honest assessment of what is enterprise-ready today and what must be built to serve organizations with 500+ engineers managing 10,000+ cloud resources.

### What's Enterprise-Ready Today

| Component | Status | Evidence |
|-----------|--------|----------|
| Knowledge graph (PostgreSQL backend) | **Production-grade** | Connection pooling (`pg.Pool`, max 20), schema-based isolation, GIN indexes on JSONB, materialized views, cursor-based pagination, batch upserts, schema versioning |
| RBAC permission model | **Production-grade** | 41 fine-grained permissions across 10 domains, built-in roles (admin/operator/developer/viewer/auditor), SSO group-to-role mapping |
| OpenTelemetry observability | **Production-grade** | Full traces, metrics (tokens, cost, run duration, queue depth), and structured logs via OTLP exporters |
| Cloud provider client pools | **Production-grade** | AWS and Azure SDK client managers with LRU eviction and per-service connection limits |
| Retry & backoff infrastructure | **Production-grade** | Configurable exponential backoff with jitter, used across LLM calls, webhook delivery, and channel APIs |
| Graceful shutdown | **Production-grade** | Comprehensive teardown: stops Bonjour, Tailscale, canvas, channels, plugins, cron, heartbeat; drains connections; broadcasts restart timing |
| Batch sync processing | **Production-grade** | Configurable concurrency (default 5) and batch size (default 100) with pooled execution |
| Agent runtime governance | **Production-grade** | Lane-based concurrency control, exec approvals, tool policies, per-agent allowlists, sandboxed execution |

### Critical Gaps

#### Gap 1 — Single-Node Architecture

The gateway is a single-process system. A lockfile mechanism actively prevents running a second instance. All state — command queues, WebSocket connections, agent runs, health cache, cron jobs — lives in-process memory. There is no message bus, no shared session store, and no distributed cron coordination.

**Impact:** Cannot serve 500 concurrent users. The Node.js event loop saturates under concurrent agent runs + WebSocket connections + LLM API calls. The command queue's main lane defaults to `maxConcurrent = 1`.

#### Gap 2 — No Multi-Tenancy

No tenant isolation exists. No tenant ID on any storage model, no request-scoped tenant context, no data partitioning. RBAC storage is a flat JSON file written synchronously. Two teams sharing one gateway see each other's data.

**Impact:** Cannot serve multiple teams or customers from a single deployment. Blocks SaaS and managed service models.

#### Gap 3 — Unsigned Session Tokens

SSO session tokens are plain `base64url(JSON)` with no HMAC signature. The codebase contains an explicit comment acknowledging this: *"For production, use HMAC-SHA256 signed JWTs."* This is not yet implemented.

**Impact:** Token forgery is trivial for anyone who can intercept a session token. Blocks any security audit or enterprise procurement.

### Significant Gaps

| Gap | Detail | Impact |
|-----|--------|--------|
| SQLite-only for non-KG storage | Audit trail, policy engine, memory, and enterprise-auth use synchronous SQLite with single-writer locks | Write contention at 100+ concurrent users |
| No gateway rate limiting | No per-user or per-IP throttling on WebSocket or HTTP endpoints | DoS vulnerability; any client can flood the gateway |
| No circuit breakers | Only exists in the Nostr extension; not present for LLM API calls, webhook delivery, or cloud provider calls | Cascading failures when upstream services degrade |
| No persistent job queue | Command queue is in-memory; process crash loses queued tasks; no dead letter queue or priority | Unreliable background processing |
| No connection limits | WebSocket server accepts unlimited connections; no admission control under memory pressure | Resource exhaustion under burst traffic |

### What Would Break First (500 users, 10K+ resources)

1. **Node.js event loop** — 500 WebSocket connections + concurrent agent runs + LLM calls + tool execution on a single thread
2. **SQLite write contention** — Audit events from 500 users hitting WAL-mode SQLite through synchronous `better-sqlite3`
3. **No admission control** — Burst connections exhaust memory and file descriptors with no rejection mechanism

---

### 12. Signed Session Tokens & Token Security

Replace unsigned base64 session tokens with cryptographically signed JWTs.

**Capabilities:**

- **HMAC-SHA256 signed JWTs** — Every session token is signed with a configurable secret key. Tokens include `iat`, `exp`, `sub` (user ID), `roles`, and `tenant` claims
- **Token rotation** — Configurable token expiry with automatic refresh. Short-lived access tokens (15 min) + long-lived refresh tokens (7 days)
- **Token revocation** — Server-side revocation list for immediate session invalidation without waiting for token expiry
- **Signing key rotation** — Support for multiple active signing keys with graceful key rollover (old tokens remain valid until expiry while new tokens use the new key)

**Technical approach:** Replace the `base64url(JSON)` token generation in `session-store.ts` with `jose` or `jsonwebtoken` library. Add signing key configuration to the gateway config. Validate signature on every request in the auth middleware.

**Effort:** 1-2 days

---

### 13. Gateway Rate Limiting & Admission Control

Protect the gateway from overload and abuse with connection and request throttling.

**Capabilities:**

- **Per-IP rate limiting** — Configurable request-per-second limits on HTTP and WebSocket endpoints with `429 Too Many Requests` responses
- **Per-user rate limiting** — Authenticated users get separate rate limit buckets. Higher limits for admin roles
- **Connection cap** — Maximum concurrent WebSocket connections (global and per-IP). New connections rejected with `503 Service Unavailable` when at capacity
- **Memory-based backpressure** — Monitor `process.memoryUsage()` and reject new requests when heap usage exceeds configurable threshold (e.g., 80% of `max-old-space-size`)
- **Request size enforcement** — Existing `MAX_PAYLOAD_BYTES` (512KB) already handles frame limits; add HTTP body size limits for REST endpoints
- **Slow client eviction** — Extend existing `MAX_BUFFERED_BYTES` drop behavior with configurable eviction after sustained slowness

**Technical approach:** Add a rate limiter middleware (token bucket or sliding window) to the gateway HTTP server. Use an in-memory `Map<string, { count, window }>` for single-node; replaceable with Redis backend when horizontal scaling is added. Add connection counter to the WebSocket `upgrade` handler.

**Effort:** 2-3 days

---

### 14. Horizontally Scalable Gateway

Replace the single-process gateway architecture with a cluster-aware design that supports multiple instances.

**Capabilities:**

- **Redis-backed coordination** — Shared state for session store, rate limit counters, cron lock coordination, and pub/sub event distribution across gateway instances
- **Gateway lock replacement** — Replace the filesystem lockfile with a Redis-based distributed lock. Multiple instances register as peers with TTL-based heartbeats
- **Pub/sub event fan-out** — Agent lifecycle events, governance decisions, and broadcast messages distributed via Redis pub/sub to all connected gateway instances. Every WebSocket client receives events regardless of which instance they're connected to
- **Sticky sessions with failover** — Agent runs are pinned to the instance that started them, with session handoff if that instance goes down
- **Distributed cron** — Cron jobs acquire a distributed lock before execution; only one instance runs each scheduled job
- **Health-aware load balancing** — Each instance exposes health status. Load balancer configuration included for Nginx, HAProxy, and cloud provider ALBs

**Technical approach:** Add Redis as an optional dependency (existing single-node mode continues to work without Redis). Replace module-level `Map`s with Redis-backed equivalents behind a storage interface. Replace the `GatewayLockError` lockfile with a Redis `SET NX EX` distributed lock. Add Redis pub/sub adapter for the existing event broadcast system.

**Effort:** 2-3 weeks

---

### 15. PostgreSQL Storage for All Subsystems

Extend the knowledge graph's PostgreSQL storage pattern to audit trail, policy engine, memory, and enterprise auth.

**Capabilities:**

- **Audit trail on PostgreSQL** — Replace SQLite-only audit store with a PostgreSQL backend using the same interface. Connection pooling, concurrent writes from multiple gateway instances, indexed queries on event type/timestamp/actor/resource
- **Policy engine on PostgreSQL** — Policy definitions and evaluation results stored in PostgreSQL with transactional updates and concurrent read access
- **Memory system on PostgreSQL** — Replace `node:sqlite` + `sqlite-vec` with `pgvector` for vector similarity search. PostgreSQL's full-text search replaces BM25 for hybrid retrieval
- **Enterprise auth on PostgreSQL** — Sessions, API keys, MFA state, and RBAC role assignments in PostgreSQL with row-level security for tenant isolation
- **Unified migration framework** — Single migration runner (Knex or Drizzle) managing schema versions across all subsystems. Forward-only migrations with dry-run support

**Technical approach:** Follow the knowledge graph's existing pattern: define a storage interface, implement a PostgreSQL backend alongside the existing SQLite backend, select backend via configuration. The knowledge graph's `PostgresGraphStorage` provides the template for connection pooling, schema versioning, and batch operations.

**Effort:** 2-3 weeks

---

### 16. Multi-Tenant Data Isolation

Add tenant context to every storage layer and API endpoint for secure multi-team and multi-customer operation.

**Capabilities:**

- **Tenant-scoped storage** — Every database table includes a `tenant_id` column. All queries are automatically scoped to the authenticated tenant. Cross-tenant queries are impossible without explicit admin override
- **Request-scoped tenant context** — Authentication middleware extracts tenant identity from JWT claims and attaches it to the request context. Every downstream operation inherits the tenant scope
- **Tenant provisioning API** — Create, configure, suspend, and delete tenants. Each tenant gets isolated knowledge graph namespace, policy set, audit trail, and agent configuration
- **Per-tenant resource quotas** — Configurable limits on graph nodes, API requests per minute, concurrent agent sessions, storage size, and cloud provider credentials per tenant
- **Per-tenant RBAC** — Role definitions and assignments are tenant-scoped. A tenant admin manages their own users and roles without visibility into other tenants
- **Tenant-aware event routing** — WebSocket broadcasts, webhook deliveries, and notification events are filtered by tenant. No cross-tenant event leakage

**Technical approach:** The knowledge graph's PostgreSQL backend already supports `config.schema` for schema-based isolation — this pattern extends to all subsystems. Add `tenantId` to the auth middleware context, propagate through service layer calls, enforce at the storage layer. The existing RBAC permission model supports scoping; add tenant as a scope dimension.

**Effort:** 2-3 weeks

---

### 17. Circuit Breakers & Resilience Patterns ✅ Implemented

> **Status:** Completed — March 2026

Protect the platform from cascading failures when upstream services degrade.

**Capabilities:**

- **LLM provider circuit breakers** — Track error rates and latency per LLM provider. When a provider exceeds failure thresholds, circuit opens and traffic fails over to the next provider immediately (instead of waiting for timeout). Half-open state probes with single requests before restoring traffic
- **Cloud provider circuit breakers** — Per-service circuit breakers for AWS, Azure, and GCP API calls. Prevents a single degraded service (e.g., AWS EC2 API throttling) from blocking operations against healthy services
- **Webhook delivery circuit breakers** — Track delivery failures per webhook endpoint. After configurable failures, stop delivery attempts and queue events for retry when the circuit closes
- **Bulkhead isolation** — Separate thread pools (via worker threads or connection pools) for LLM calls, cloud API calls, and internal operations. A slow LLM provider cannot starve cloud sync operations
- **Timeout budgets** — Configurable per-operation timeouts with cascading deadline propagation. If a governance check has 5 seconds remaining when it calls OPA, the OPA call inherits the remaining budget
- **Health-aware routing** — Gateway health checks include circuit breaker state. Load balancers can route away from instances with open circuits

**Technical approach:** Implement a generic `CircuitBreaker<T>` class with configurable failure threshold, reset timeout, and half-open probe count. Wrap existing LLM provider calls (`pi-embedded-runner`), cloud provider managers, and webhook delivery in circuit breaker instances. Expose circuit state via health endpoint and OTel metrics.

**Effort:** 1-2 weeks

**Implementation summary:**

| Component | Files | Details |
|-----------|-------|---------|
| Core `CircuitBreaker<T>` | `src/infra/circuit-breaker.ts` | Generic class with closed/open/half-open states, configurable thresholds, registry, health summaries |
| LLM provider integration | `src/agents/pi-embedded-runner/circuit-breaker-llm.ts` | Wraps LLM streamFn calls with per-provider circuit breakers |
| Channel delivery integration | `src/infra/outbound/circuit-breaker-channel.ts` | Circuit breakers for webhook/channel delivery endpoints |
| AWS circuit breakers | `extensions/aws/src/circuit-breaker.ts` | Per-service breakers for all 30+ AWS service managers |
| Azure circuit breakers | `extensions/azure/src/circuit-breaker.ts` | Per-service breakers for all 80+ Azure service managers |
| GCP circuit breakers | `extensions/gcp/src/circuit-breaker.ts` | Per-service breakers for all GCP service managers |
| Bulkhead isolation | `src/infra/bulkhead.ts` | Concurrency-limited partitions for LLM, cloud, and internal ops; per-extension semaphores in retry modules |
| Timeout budgets | `src/infra/timeout-budget.ts` | Cascading deadline propagation with abort signal integration |
| Health endpoint | `src/commands/health.ts` | Aggregates core + cloud circuit breaker and bulkhead state |
| Diagnostics | `src/commands/circuit-breaker-diagnostics.ts` | CLI diagnostics for circuit breaker inspection |
| Tests | 166 tests across 6 test files | 91 core + 75 extension tests, all passing |

---

## Enterprise Readiness Roadmap

Prioritized implementation order with cumulative effect:

| Phase | Features | Effort | Cumulative Result |
|-------|----------|--------|-------------------|
| **Phase 0: Security** | #12 Signed tokens, #13 Rate limiting | 1 week | Passes basic security review |
| **Phase 1: Foundation** | #15 PostgreSQL everywhere, #17 Circuit breakers | 3-4 weeks | Handles 100+ concurrent users reliably |
| **Phase 2: Scale** | #14 Horizontal gateway, distributed cron | 2-3 weeks | Handles 500+ users, HA deployment |
| **Phase 3: Isolation** | #16 Multi-tenant isolation | 2-3 weeks | Multiple teams/customers on one deployment |
| **Phase 4: Product** | #1 Dashboard, #2 Drift remediation, #3 Cost autopilot | 3-4 weeks | Visible, sellable product surface |
| **Phase 5: Differentiation** | #4 EU AI Act, #8 Feedback loops, #10 Correlation engine | 4-5 weeks | Defensible competitive position |
| **Phase 6: Market** | #5 API/SDK, #9 Intelligence reports, #11 Certification toolkit | 3-4 weeks | Platform ecosystem and compliance readiness |

**Total estimated timeline:** 16-24 weeks (4-6 months) from current state to full enterprise readiness.

**Minimum viable enterprise:** Phases 0-1 (4-5 weeks) — signed tokens, rate limiting, PostgreSQL storage, circuit breakers. This handles a mid-market customer with 50-100 engineers.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Espada Gateway                               │
│  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ WebSocket  │  │ HTTP API │  │ OpenAI    │  │ Dashboard        │  │
│  │ Control    │  │ REST +   │  │ Compatible│  │ (Live Infra      │  │
│  │ Plane      │  │ SDK      │  │ API       │  │  Monitoring)     │  │
│  └─────┬──────┘  └────┬─────┘  └─────┬─────┘  └───────┬──────────┘  │
│        │              │              │                │              │
│  ┌─────▼──────────────▼──────────────▼────────────────▼───────────┐  │
│  │                    Agent Runtime Engine                         │  │
│  │  Sessions · Failover · Sandbox · Tools · Concurrency · Memory  │  │
│  └─────┬──────────────────────────────────────────────────────────┘  │
│        │                                                             │
│  ┌─────▼──────────────────────────────────────────────────────────┐  │
│  │                    Governance Layer                             │  │
│  │  Risk Scoring · Policy Engine · OPA/Rego · Approval Gates      │  │
│  │  Exec Approvals · Compliance · EU AI Act · Audit Trail         │  │
│  └─────┬──────────────────────────────────────────────────────────┘  │
│        │                                                             │
│  ┌─────▼──────────────────────────────────────────────────────────┐  │
│  │                 Infrastructure Knowledge Graph                 │  │
│  │  IQL · Temporal · Federation · Cost Forecast · Drift Detection │  │
│  │  Blast Radius · Cloud Adapters · OTel Correlation              │  │
│  └─────┬──────────────────────────────────────────────────────────┘  │
│        │                                                             │
│  ┌─────▼──────────────────────────────────────────────────────────┐  │
│  │              Cloud Infrastructure Management                   │  │
│  │  ┌─────┐  ┌───────┐  ┌─────┐  ┌───────────┐  ┌────────────┐  │  │
│  │  │ AWS │  │ Azure │  │ GCP │  │ Terraform │  │ Kubernetes │  │  │
│  │  │ 30+ │  │  80+  │  │ 47  │  │  + Pulumi │  │  + Helm    │  │  │
│  │  └─────┘  └───────┘  └─────┘  └───────────┘  └────────────┘  │  │
│  │  Intent Compiler · Execution Engine · Rollback · Cost Estimate │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                     Data Moat Layer                            │  │
│  │  Feedback Loops · Decision History · Model Calibration         │  │
│  │  Temporal State · Policy Corpus · Correlation Engine           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                  Scalability Layer                              │  │
│  │  Redis Coordination · Distributed Cron · Pub/Sub Fan-out      │  │
│  │  Rate Limiting · Circuit Breakers · Admission Control         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Enterprise Security                         │  │
│  │  SSO (OIDC/SAML) · MFA · RBAC (60+ perms) · Security Audit   │  │
│  │  Signed JWTs · SSRF Protection · TLS · Device Pairing         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                Certification & Compliance                      │  │
│  │  SOC 2 · ISO 27001 · ISO 42001 · EU AI Act · FedRAMP          │  │
│  │  Evidence Automation · Control Gap Analysis · Audit Export     │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Deployment

Espada is self-hosted and local-first. Deployment options:

- **Local** — Single binary, runs on macOS or Linux
- **Docker** — `docker-compose.yml` included
- **Cloud platforms** — Fly.io, Render, Railway, Northflank configurations included
- **VPS** — Any Linux server with Node.js 22+
- **Enterprise** — Multi-instance deployment with Redis coordination, PostgreSQL storage, and load balancer (planned)

No data leaves your infrastructure. All LLM calls, cloud API interactions, and knowledge graph data remain under your control.

---

## External Dependencies (Enterprise Configuration)

| Dependency | Purpose | Required? |
|------------|---------|----------|
| **Node.js 22+** | Runtime | Yes |
| **PostgreSQL 15+** | Knowledge graph, audit trail, policy, memory, auth storage | Recommended (SQLite default) |
| **Redis 7+** | Session store, rate limiting, distributed locks, pub/sub, cron coordination | Required for multi-instance |
| **Docker** | Agent sandboxing, deployment | Optional |
| **OPA (Open Policy Agent)** | Advanced policy evaluation with Rego | Optional |
| **OTLP-compatible collector** | Observability (Datadog, Grafana, New Relic, etc.) | Optional |
