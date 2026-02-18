# Espada Enterprise Competitive Feature Roadmap

> **Goal**: Close enterprise gaps (policy, SSO, audit) while doubling down on what makes Espada unique (AI-native, conversational, Knowledge Graph, local-first, multi-channel). Beat Spacelift, Env0, Firefly, and Resourcely by moving toward them fast with governance features while they try to slowly bolt AI onto their dashboard-first platforms.

## Overview

11 features across 3 priority tiers, building on extensive existing infrastructure. The codebase already has significant foundations:

- **AWS extension**: `PolicyEngine`, `IaCManager`, `ComplianceManager`, `CostManager`, `GuardrailsManager`
- **Infrastructure extension**: Full security facade with RBAC, approvals, audit logging, risk scoring, break-glass
- **Knowledge Graph**: Topology backbone with blast radius, SPOF detection, drift, cost attribution
- **Core**: Tool policy engine, exec approvals, diagnostic events

Most features are about wiring these existing pieces together, filling gaps, and exposing them through tools/CLI/gateway.

## Estimated Scope

| Feature | New Extension | Files | LOC (est.) | Tests (est.) |
|---------|:---:|:---:|:---:|:---:|
| 1. Policy Engine (OPA/Rego) | `extensions/policy-engine/` | ~12 | ~2500 | 40+ |
| 2. Enterprise SSO/RBAC | core `src/gateway/` | ~10 | ~2000 | 30+ |
| 3. Terraform State Management | `extensions/terraform/` | ~10 | ~2200 | 35+ |
| 4. Persistent Audit Trail | core `src/audit/` | ~8 | ~1500 | 25+ |
| 5. Multi-IaC Support | `extensions/pulumi/`, `extensions/kubernetes/` | ~16 | ~3000 | 40+ |
| 6. VCS Integration (GitHub/GitLab) | `extensions/vcs/` | ~10 | ~2000 | 25+ |
| 7. Cost Estimation (Infracost) | `extensions/cost-governance/` | ~8 | ~1500 | 20+ |
| 8. Infrastructure Blueprints | `extensions/blueprints/` | ~10 | ~2000 | 25+ |
| 9. Disaster Recovery Analysis | in `extensions/knowledge-graph/` | ~4 | ~800 | 20+ |
| 10. IaC Generation from Existing Resources | in `extensions/terraform/` | ~4 | ~1000 | 25+ |
| 11. Compliance Framework Mapping | `extensions/compliance/` | ~8 | ~1800 | 30+ |
| **Total** | | **~100 files** | **~20,300 LOC** | **315+ tests** |

## Dependency Order

Features should be built in this order due to inter-dependencies:

```
Phase 1 (foundations):  4. Audit Trail → 1. Policy Engine → 2. SSO/RBAC
Phase 2 (IaC layer):    3. Terraform State → 5. Multi-IaC → 10. IaC Generation
Phase 3 (workflows):    6. VCS Integration → 7. Cost Estimation → 8. Blueprints
Phase 4 (analysis):     9. DR Analysis → 11. Compliance Mapping
```

Audit Trail first because every subsequent feature needs to log to it. Policy Engine depends on audit for logging evaluations. SSO/RBAC depends on audit for login tracking. Terraform depends on policy for plan evaluation. VCS depends on Terraform for plan-on-PR.

---

## TIER P0 — Enterprise Must-Haves

These are the features that enterprise buyers literally cannot purchase without. Closing these gaps removes the #1 objection from every sales conversation.

---

### Feature 1: Policy-as-Code Engine (OPA/Rego)

**Priority**: P0 — single biggest competitive gap  
**Competitive reference**: Spacelift (10 policy types, full Rego workbench, policy library), Env0 (OPA-based policies)  
**Extension**: `extensions/policy-engine/`

#### What Exists

- **AWS `PolicyEngine`** at `extensions/aws/src/policy/engine.ts` (675 LOC) — OPA-*style* TypeScript evaluation with built-in rules, compliance framework scoping (CIS, SOC2, HIPAA, PCI-DSS), per-resource evaluation, auto-fix capability
- **Infrastructure `GuardrailsManager`** at `extensions/infrastructure/src/security/` — approval workflows, dry-run, safety checks, impact assessment, environment protection, rate limiting
- **Core tool policy** at `src/agents/tool-policy.ts` — allow/deny pattern matching for tools
- **Core exec approvals** at `src/infra/exec-approvals.ts` (1268 LOC) — file-based approval framework with hash-based optimistic concurrency
- **None of these use real OPA/Rego** — all custom TypeScript

#### What to Build

A shared extension that embeds a real OPA/Rego evaluator via WASM (in-process, no external server — preserves local-first), integrates with the Knowledge Graph for topology-aware policies, and exposes unified policy management.

#### Steps

1. **Create extension scaffold** — `extensions/policy-engine/` with standard structure (`index.ts`, `espada.plugin.json`, `src/`, `vitest.config.ts`)

2. **Add `@open-policy-agent/opa-wasm`** as dependency — runs Rego policies in-process without requiring an external OPA server

3. **Define core types** in `src/types.ts`:
   ```typescript
   type PolicyDefinition = {
     id: string;
     name: string;
     type: PolicyType;
     body: string; // Rego source
     labels: string[];
     autoAttachPatterns: string[]; // glob patterns for auto-attach
     space: string;
   };

   type PolicyType =
     | "plan"        // evaluate before terraform apply
     | "access"      // control who can access what
     | "approval"    // determine approval requirements
     | "notification"// route alerts
     | "drift"       // respond to drift events
     | "cost"        // cost governance
     | "deployment"; // deployment guardrails

   type PolicyEvaluationInput = {
     resource?: GraphNode;
     plan?: TerraformPlan;
     actor?: { id: string; roles: string[]; groups: string[] };
     environment?: string;
     graph?: { neighbors: GraphNode[]; blastRadius: number };
     cost?: { current: number; projected: number; delta: number };
   };

   type PolicyEvaluationResult = {
     allowed: boolean;
     denied: boolean;
     warnings: string[];
     denials: string[];
     flags: string[];
     metadata: Record<string, unknown>;
   };
   ```
   - `PolicyStorage` interface with `InMemoryPolicyStorage` and `SQLitePolicyStorage` implementations

4. **Build `src/engine.ts`** — `PolicyEvaluationEngine`:
   - `loadPolicy(rego: string)` → compile to WASM, cache compiled module
   - `evaluate(policy, input)` → run WASM module, return decision
   - `evaluateAll(policies[], input)` → combine results (deny wins over allow)
   - `validatePolicy(rego)` → syntax check before saving
   - Policy hot-reload on file change

5. **Build `src/integration.ts`** — bridges to other Espada systems:
   - `buildPlanPolicyInput(graphNodes, plannedChanges)` — for pre-apply checks
   - `buildDriftPolicyInput(driftResult)` — for drift response policies
   - `buildCostPolicyInput(costAttribution)` — for cost governance
   - `buildAccessPolicyInput(user, resource, operation)` — for RBAC augmentation

6. **Build `src/library.ts`** — built-in policy templates (like Spacelift's policy library):
   - "Deny public S3 buckets"
   - "Require tags on all resources"
   - "Block production deletions outside maintenance windows"
   - "Cost threshold alerts"
   - "Require encryption at rest"
   - "Deny untagged resources"
   - "Restrict instance types to approved list"

7. **Build `src/tools.ts`** — 4 agent tools:
   - `policy_evaluate` — evaluate a policy against current graph state
   - `policy_list` — list active policies with types and attachment status
   - `policy_check_plan` — pre-flight check for planned infrastructure changes
   - `policy_violations` — scan entire graph for policy violations

8. **Build `src/cli.ts`** — `espada policy` subcommands:
   - `policy list` — list all policies
   - `policy add <file.rego>` — add a new policy
   - `policy remove <id>` — remove a policy
   - `policy test <file.rego>` — run Rego unit tests
   - `policy evaluate <policy-id> --input <json>` — evaluate with custom input
   - `policy scan` — scan all graph resources against all policies
   - `policy library` — show built-in templates
   - `policy library import <template-name>` — import a built-in template

9. **Register 3 gateway methods**: `policy/list`, `policy/evaluate`, `policy/violations`

10. **Wire into Knowledge Graph** — add a `kg_policy_scan` tool that walks the graph, evaluates applicable policies per node, returns violations grouped by severity

11. **Wire into Lobster workflows** — policies auto-evaluate at approval gates; `status: "needs_approval"` when policy requires human review

12. **Write tests** — unit tests for WASM engine, integration tests for Rego evaluation, policy library validation tests. **Target: 40+ tests**

#### Key Design Decisions

- **OPA WASM (in-process)** rather than requiring an external OPA server — keeps local-first architecture intact while providing full Rego compatibility
- **Policy storage in SQLite** (at `~/.espada/policies.db`) for persistence across sessions
- **Auto-attach via labels** (Spacelift pattern) — policies with `autoattach:<label>` apply to all resources with matching tags

---

### Feature 2: Enterprise SSO/RBAC

**Priority**: P0 — no enterprise deploys without this  
**Competitive reference**: Spacelift (Okta, OneLogin, Entra, GitLab OIDC, AWS IAM, FedRAMP), Env0 (SOC2, SSO)  
**Location**: Core `src/gateway/`

#### What Exists

- **Gateway auth** at `src/gateway/auth.ts` (253 LOC) — token-based, password, Tailscale SSO, device tokens
- **Infrastructure RBAC** at `extensions/infrastructure/src/security/rbac.ts` (197 LOC) — full `InfrastructureRBACManager` with roles (admin, sre, developer, viewer), permission checking — **in-memory only, not wired to gateway**
- **Device auth** at `src/gateway/device-auth.ts` — mobile/node client auth with signed timestamps
- **Provider-specific OAuth** — OpenAI Codex, GitHub Copilot, Chutes (for model auth, not user auth)
- **No SSO/SAML/OIDC** in core, no unified user management

#### What to Build

Extend core gateway auth with OIDC/SAML support and unify the RBAC system from the infrastructure extension into the core gateway.

#### Steps

1. **Add OIDC support** to `src/gateway/auth.ts`:
   - New auth mode: `"oidc"` alongside existing `"token"` and `"password"`
   - Config keys: `gateway.auth.oidc.issuerUrl`, `gateway.auth.oidc.clientId`, `gateway.auth.oidc.clientSecret`, `gateway.auth.oidc.callbackUrl`, `gateway.auth.oidc.scopes`
   - Use `openid-client` npm package for OIDC discovery, token exchange, token validation
   - Tested providers: Okta, Microsoft Entra ID, Google Workspace, Auth0

2. **Create `src/gateway/sso/` directory**:
   - `oidc-provider.ts` — OIDC discovery (`.well-known/openid-configuration`), authorization code flow, token validation (JWT verify with JWKS), token refresh
   - `saml-provider.ts` — SAML 2.0 assertion parsing (phase 2 — for legacy enterprise)
   - `session-store.ts` — SSO session management with JWT-based session tokens, configurable expiry, refresh token rotation
   - `types.ts`:
     ```typescript
     type SSOConfig = {
       provider: "oidc" | "saml";
       issuerUrl: string;
       clientId: string;
       clientSecret: string;
       callbackUrl: string;
       scopes: string[];
       roleMapping: Record<string, string>; // IdP group → Espada role
     };

     type SSOSession = {
       id: string;
       userId: string;
       email: string;
       name: string;
       roles: string[];
       groups: string[];
       idpGroups: string[];
       issuedAt: number;
       expiresAt: number;
       refreshToken?: string;
     };

     type SSOUser = {
       id: string;
       email: string;
       name: string;
       roles: string[];
       groups: string[];
       mfaEnabled: boolean;
       lastLogin: number;
       provider: string;
     };
     ```

3. **Promote RBAC from infrastructure extension to core**:
   - Move role/permission types to `src/gateway/rbac/types.ts`
   - Create `src/gateway/rbac/manager.ts` — `GatewayRBACManager` (evolved from `InfrastructureRBACManager`)
   - Default roles:
     | Role | Permissions |
     |------|------------|
     | `admin` | Everything |
     | `operator` | Read, write, approve, manage policies |
     | `developer` | Read, write (non-prod only) |
     | `viewer` | Read-only |
     | `auditor` | Read + audit trail access |
   - Permission scopes aligned with existing gateway scopes (`operator.admin`, `operator.read`, `operator.write`) plus new: `policy.manage`, `audit.read`, `graph.admin`, `terraform.apply`, `compliance.manage`
   - Store role assignments in `~/.espada/rbac.json` (file-based, like exec-approvals)

4. **Wire SSO identity → RBAC roles**:
   - Map OIDC claims/groups to Espada roles via config:
     ```yaml
     gateway.auth.oidc.roleMapping:
       Engineering: developer
       SRE: operator
       Platform: admin
       Security: auditor
     ```
   - Support group-based auto-assignment

5. **Add MFA support**:
   - TOTP-based MFA for non-SSO auth modes (token/password)
   - `src/gateway/auth-mfa.ts` — TOTP generation/verification using `otpauth` npm package
   - Config: `gateway.auth.mfa.required` (boolean)

6. **Build CLI commands**:
   - `espada auth sso configure` — interactive SSO setup wizard
   - `espada auth sso test` — test SSO connection and token exchange
   - `espada roles list` — show all roles with permissions
   - `espada roles assign <user> <role>` — assign role to user
   - `espada roles remove <user> <role>` — remove role from user
   - `espada users list` — show users with roles, last login, MFA status

7. **Add gateway methods**: `auth/sso-init`, `auth/sso-callback`, `rbac/list-roles`, `rbac/assign`, `rbac/check`

8. **Update `authorizeGatewayConnect()`** in `src/gateway/auth.ts` to chain:
   ```
   token → password → Tailscale → OIDC → SAML → device-token
   ```
   Attach resolved `SSOUser` + roles to `GatewayClient` for downstream permission checks

9. **Write tests** — OIDC mock provider tests, role evaluation tests, permission checks, session lifecycle. **Target: 30+ tests**

#### Key Design Decisions

- **OIDC-first** (not SAML-first) — OIDC is simpler, more modern, covers Okta/Entra/Google; SAML is phase 2
- **JWT session tokens** — stateless verification, no session database needed
- **Role mapping via config** — simple IdP group → Espada role mapping, no custom claim parsing needed

---

### Feature 3: Terraform State Management

**Priority**: P0 — table stakes for IaC platforms  
**Competitive reference**: Spacelift (native state backend, state locking, external state access), Env0 (state management)  
**Extension**: `extensions/terraform/`

#### What Exists

- **AWS `IaCManager`** at `extensions/aws/src/iac/manager.ts` (1343 LOC) — generates HCL and CloudFormation, simulates plan/apply, detects drift. **Doesn't parse `.tfstate` or manage state backends**
- **AWS IaC types** at `extensions/aws/src/iac/types.ts` (810 LOC) — `IaCFormat`, `DriftStatus`, `TerraformGenerationOptions`, `TerraformGenerationResult`
- **Knowledge Graph** tracks resources independently of Terraform state
- **Core exec system** can shell out to `terraform` CLI but no wrapper exists

#### What to Build

A new extension wrapping the real Terraform CLI, managing state backends, parsing state files, and bridging state data into the Knowledge Graph.

#### Steps

1. **Create `extensions/terraform/`** with standard plugin structure

2. **Define types** in `src/types.ts`:
   ```typescript
   type TerraformState = {
     version: number;
     terraform_version: string;
     serial: number;
     lineage: string;
     outputs: Record<string, TerraformOutput>;
     resources: TerraformResource[];
   };

   type TerraformResource = {
     module?: string;
     mode: "managed" | "data";
     type: string;       // e.g., "aws_instance"
     name: string;       // e.g., "web_server"
     provider: string;   // e.g., "provider[\"registry.terraform.io/hashicorp/aws\"]"
     instances: TerraformInstance[];
   };

   type TerraformInstance = {
     schema_version: number;
     attributes: Record<string, unknown>;
     dependencies: string[];
     private?: string;
   };

   type TerraformWorkspace = {
     name: string;
     state: TerraformState;
     variables: Record<string, unknown>;
     backendConfig: StateBackendConfig;
   };

   type TerraformPlan = {
     format_version: string;
     resource_changes: ResourceChange[];
     output_changes: Record<string, OutputChange>;
     prior_state: TerraformState;
   };

   type ResourceChange = {
     address: string;
     module_address?: string;
     type: string;
     name: string;
     change: {
       actions: ("create" | "read" | "update" | "delete" | "no-op")[];
       before: Record<string, unknown> | null;
       after: Record<string, unknown> | null;
     };
   };

   type StateBackendConfig = {
     type: "local" | "s3" | "azurerm" | "gcs" | "http" | "consul";
     config: Record<string, unknown>;
   };
   ```

3. **Build `src/cli-wrapper.ts`** — safe Terraform CLI execution:
   - `init(workingDir, backendConfig)` — `terraform init`
   - `plan(workingDir, options)` → `terraform plan -json -out=plan.tfplan` → parse JSON output
   - `apply(workingDir, options)` → `terraform apply -json plan.tfplan` → parse output
   - `show(workingDir)` → `terraform show -json` → parse state
   - `stateList(workingDir)` → `terraform state list` → resource addresses
   - `statePull()` → `terraform state pull` → raw state JSON
   - `statePush(state)` → `terraform state push` → upload state
   - `import(address, id)` → `terraform import address id`
   - `destroy(workingDir, targets?)` → `terraform destroy -target=...`
   - All commands run in Docker sandbox when `sandboxed: true` (security)
   - Timeout enforcement, output size limits, error parsing

4. **Build `src/state-manager.ts`** — `TerraformStateManager`:
   - `parseState(stateJson)` → typed `TerraformState`
   - `diffStates(before, after)` → resource-level diff (added, removed, changed attributes)
   - `stateToGraphNodes(state)` → convert Terraform resources to `GraphNodeInput[]` for Knowledge Graph ingestion
   - `lockState(workspace)` / `unlockState(workspace)` — state locking (DynamoDB for S3 backend, blob lease for AzureRM)
   - `listWorkspaces()`, `selectWorkspace(name)`

5. **Build `src/graph-bridge.ts`** — Knowledge Graph integration:
   - `syncStateToGraph(state, graphEngine)` — parse state → upsert nodes/edges → mark disappeared resources
   - `diffGraphVsState(graphEngine, state)` → compare KG topology view vs Terraform state → surface discrepancies
   - Edge discovery method: `"terraform-state"` (already partially defined in KG types)
   - Tag nodes with `managedBy: "terraform"` and `tfAddress: "aws_instance.web_server"` in metadata

6. **Build `src/backend-configs.ts`** — backend configuration helpers:
   - S3: `{ bucket, key, region, dynamodb_table, encrypt: true }`
   - AzureRM: `{ storage_account_name, container_name, key }`
   - GCS: `{ bucket, prefix }`
   - Generate `backend.tf` HCL block from config

7. **Build 6 agent tools** in `src/tools.ts`:
   - `tf_plan` — run terraform plan, show human-readable changes summary
   - `tf_apply` — apply changes (with approval gate via Lobster)
   - `tf_state_list` — list resources currently in state
   - `tf_state_show` — show detailed state for a specific resource
   - `tf_import` — import existing resource into state
   - `tf_drift` — compare state vs live infrastructure

8. **Build CLI commands** (`espada terraform`):
   - `terraform init`, `terraform plan`, `terraform apply`
   - `terraform state list`, `terraform state show <address>`, `terraform state pull`
   - `terraform import <address> <id>`
   - `terraform workspaces` — list/select workspaces
   - `terraform drift` — detect state vs live drift

9. **Register gateway methods**: `terraform/plan`, `terraform/state`, `terraform/drift`

10. **Write tests** — state parsing, graph bridge, CLI wrapper mocking, diff logic. **Target: 35+ tests**

#### Key Design Decisions

- **Wrap the real `terraform` CLI** rather than reimplementing — ensures compatibility with all providers, modules, state formats, and future Terraform versions
- **Run in Docker sandbox** for security isolation
- **Graph bridge is additive** — Terraform-managed resources get extra metadata in the Knowledge Graph, not a separate data store

---

### Feature 4: Persistent Audit Trail

**Priority**: P0 — foundation for all other features  
**Competitive reference**: Spacelift (full audit trail, GraphQL-queryable), Env0 (enterprise audit)  
**Location**: Core `src/audit/`

#### What Exists

- **Infrastructure `AuditLogger`** at `extensions/infrastructure/src/security/audit-logger.ts` (254 LOC) — buffered writes, correlation IDs, session IDs, sensitive field redaction, configurable flush intervals. **In-memory storage only**
- **Infrastructure audit types** at `extensions/infrastructure/src/security/types.ts` — `AuditLogEntry`, `AuditLogQuery`, `AuditEventType`, `AuditSeverity`
- **Core `SecurityAuditReport`** at `src/security/audit.ts` (933 LOC) — point-in-time security scans (checklist), **not a runtime activity trail**
- **Core diagnostics** at `src/logging/diagnostic.ts` — runtime event tracking (webhook counts, session state, queue depth)
- **AWS CloudTrail** at `extensions/aws/src/cloudtrail/manager.ts` (700 LOC) — CloudTrail event querying
- **Knowledge Graph `GraphChange`** — append-only changelog for node/edge lifecycle

#### What to Build

Promote the infrastructure extension's audit logger to a core system with persistent SQLite storage, feed it from all subsystems, and expose via CLI/tools/gateway.

#### Steps

1. **Create `src/audit/` directory** in core:
   - `src/audit/types.ts` — unified `AuditEvent` type:
     ```typescript
     type AuditEvent = {
       id: string;
       timestamp: string; // ISO-8601
       eventType: AuditEventType;
       severity: "info" | "warn" | "error" | "critical";
       actor: {
         id: string;
         name: string;
         roles: string[];
         ip?: string;
         channel?: string; // which messaging channel
         agentId?: string;
       };
       operation: string;
       resource?: {
         type: string;
         id: string;
         provider?: string;
       };
       parameters?: Record<string, unknown>; // redacted
       result: "success" | "failure" | "pending" | "denied";
       correlationId?: string;
       sessionId?: string;
       durationMs?: number;
       metadata?: Record<string, unknown>;
     };

     type AuditEventType =
       | "command_executed"
       | "tool_invoked"
       | "policy_evaluated"
       | "approval_requested"
       | "approval_granted"
       | "approval_denied"
       | "state_changed"
       | "config_changed"
       | "auth_login"
       | "auth_logout"
       | "auth_failed"
       | "resource_created"
       | "resource_updated"
       | "resource_deleted"
       | "drift_detected"
       | "alert_triggered"
       | "break_glass_activated"
       | "role_assigned"
       | "role_removed"
       | "policy_created"
       | "policy_deleted"
       | "compliance_scanned"
       | "blueprint_deployed"
       | "terraform_plan"
       | "terraform_apply";

     type AuditQuery = {
       startDate?: string;
       endDate?: string;
       eventTypes?: AuditEventType[];
       actorIds?: string[];
       resourceTypes?: string[];
       severity?: string[];
       result?: string[];
       limit?: number;
       offset?: number;
     };
     ```
   - `AuditStorage` interface

2. **Build `src/audit/sqlite-store.ts`** — persistent SQLite storage:
   - Store at `~/.espada/audit.db`
   - Table: `audit_events` with indexes on `timestamp`, `event_type`, `actor_id`, `resource_id`, `correlation_id`
   - WAL mode for concurrent reads during writes
   - Automatic retention-based pruning (configurable, default 90 days)
   - Vacuum on startup if > 30 days since last vacuum

3. **Build `src/audit/logger.ts`** — `AuditLogger` singleton:
   - `log(event)` — buffered write with configurable flush interval (default 1s, max buffer 100 events)
   - `query(filter)` → `AuditEvent[]` with pagination
   - `getTimeline(resourceId)` → chronological events for a resource
   - `getActorActivity(actorId)` → all actions by an actor
   - `getSummary(timeRange)` → aggregated stats:
     ```typescript
     type AuditSummary = {
       totalEvents: number;
       byType: Record<AuditEventType, number>;
       byResult: Record<string, number>;
       topActors: { id: string; name: string; count: number }[];
       topResources: { id: string; type: string; count: number }[];
       bySeverity: Record<string, number>;
     };
     ```
   - Sensitive field redaction (passwords, tokens, secrets → `"[REDACTED]"`)
   - Correlation ID propagation for tracing operations across subsystems

4. **Wire audit logging into core subsystems**:
   - **Gateway requests**: wrapper around `handleGatewayRequest()` — log every method call with actor, method, params (redacted), result, duration
   - **Tool execution**: wrap tool `execute()` — log every tool invocation with params and outcome
   - **Exec approvals**: log approval decisions (approved/denied/expired)
   - **Config changes**: log `espada config set` operations with before/after values
   - **Auth events**: log login/logout/failed attempts with method and actor
   - **Channel messages**: log message receipt/send (content redacted, only metadata)

5. **Wire into extensions** (extensions write events via `api.registerService()` or direct import):
   - Knowledge Graph: feed `GraphChange` events into audit trail with correlation IDs
   - Policy engine: log every policy evaluation with input/result
   - Terraform: log plan/apply/import operations with resource addresses
   - AWS/Azure/GCP: bridge existing audit subsystems (CloudTrail, Activity Log)

6. **Build 3 agent tools** in `src/audit/tools.ts`:
   - `audit_query` — search audit events by filters (time range, type, actor, resource)
   - `audit_timeline` — resource-specific audit timeline (what has happened to resource X)
   - `audit_summary` — aggregated activity summary for time period

7. **Build CLI commands** (`espada audit`):
   - `audit list` — list recent events (with `--since`, `--until`, `--type`, `--actor`, `--resource`, `--severity`)
   - `audit show <event-id>` — show full event details
   - `audit summary` — summary for last 24h/7d/30d
   - `audit export --format <json|csv> --since <date>` — export for compliance
   - `audit retention set <days>` — configure retention period

8. **Register gateway methods**: `audit/query`, `audit/timeline`, `audit/summary`, `audit/export`

9. **Write tests** — storage CRUD, querying with filters, redaction, retention pruning, buffered writes, correlation tracking. **Target: 25+ tests**

#### Key Design Decisions

- **SQLite-based** (like Knowledge Graph) — keeps local-first, no external service
- **Retention-based pruning** — automatic cleanup keeps DB size manageable
- **Buffered writes** — prevents audit logging from slowing down hot paths
- **Redaction by default** — sensitive fields auto-detected and masked

---

## TIER P1 — Competitive Parity

These features bring Espada to parity with what competitors offer, eliminating "but Spacelift has X" objections.

---

### Feature 5: Multi-IaC Support

**Priority**: P1  
**Competitive reference**: Spacelift (Terraform, Terragrunt, Pulumi, CloudFormation, Kubernetes, Ansible)  
**Extensions**: `extensions/pulumi/`, `extensions/kubernetes/`

#### What Exists

- AWS `IaCManager` supports `terraform` and `cloudformation` formats
- Knowledge Graph `EdgeDiscoveryMethod` includes `"iac-parse"`
- No Pulumi, Kubernetes manifest, or Ansible integration

#### Steps

1. **Extend `extensions/terraform/` for Terragrunt**:
   - `src/terragrunt.ts` — parse `terragrunt.hcl`, resolve `include`/`dependency` blocks
   - Wrap `terragrunt run-all plan/apply` for multi-module orchestration
   - Map Terragrunt dependency graph to Knowledge Graph edges

2. **Create `extensions/pulumi/` plugin**:
   - `src/types.ts` — `PulumiStack`, `PulumiResource`, `PulumiState`, `PulumiOutput`
   - `src/cli-wrapper.ts` — wrap `pulumi` CLI (`preview`, `up`, `stack ls`, `stack export`)
   - `src/state-parser.ts` — parse Pulumi state JSON to `GraphNodeInput[]`
   - `src/tools.ts` — 4 tools: `pulumi_preview`, `pulumi_up`, `pulumi_state`, `pulumi_drift`
   - `src/cli.ts` — `espada pulumi preview/up/state/drift`

3. **Create `extensions/kubernetes/` plugin**:
   - `src/types.ts` — `K8sResource`, `K8sManifest`, `K8sCluster`, `K8sNamespace`
   - `src/cli-wrapper.ts` — wrap `kubectl` CLI (`apply`, `get`, `diff`, `describe`, `rollout`)
   - `src/manifest-parser.ts` — parse YAML manifests → `GraphNodeInput[]`
   - `src/graph-bridge.ts` — K8s resources as graph nodes:
     - Node types: `pod`, `service`, `deployment`, `statefulset`, `ingress`, `configmap`, `secret`, `namespace`, `pvc`
     - Edge types: `service → deployment` (`routes-to`), `deployment → pod` (`manages`), `pod → pvc` (`uses`), `ingress → service` (`routes-to`)
   - `src/tools.ts` — 4 tools: `k8s_apply`, `k8s_get`, `k8s_diff`, `k8s_resources`
   - `src/cli.ts` — `espada k8s apply/get/diff/resources`

4. **Ansible (phase 2, lower priority)**:
   - Parse playbook YAML for inventory → graph nodes
   - Wrap `ansible-playbook` for execution

5. **Add `managedBy` metadata** to `GraphNode` — track which IaC tool manages each resource (`terraform`, `pulumi`, `kubernetes`, `cloudformation`, `manual`)

6. **Build unified `espada iac status`** — shows resource count per IaC tool:
   ```
   IaC Coverage:
     Terraform:      142 resources (68%)
     Kubernetes:      45 resources (22%)
     Pulumi:          12 resources (6%)
     Unmanaged:        8 resources (4%)
   ```

7. **Write tests per extension. Target: 20+ tests per extension (40+ total)**

---

### Feature 6: VCS Integration (GitHub/GitLab)

**Priority**: P1  
**Competitive reference**: Spacelift (PR previews, auto-deploy on merge, push policies), Env0 (Git-based workflows)  
**Extension**: `extensions/vcs/`

#### What Exists

- No GitHub API client (no Octokit), no PR automation, no VCS webhooks
- CI/CD is AWS CodePipeline only at `extensions/aws/src/cicd/`
- `scripts/committer` is a git helper but not programmatic
- Channel `webhookPath`/`webhookUrl` exists for messaging, not VCS

#### Steps

1. **Create `extensions/vcs/`** with standard plugin structure

2. **Add dependencies**: `octokit` (GitHub), `@gitbeaker/rest` (GitLab)

3. **Define types** in `src/types.ts`:
   ```typescript
   type VCSProvider = "github" | "gitlab" | "bitbucket";

   type PullRequest = {
     number: number;
     title: string;
     body: string;
     author: string;
     branch: string;
     base: string;
     state: "open" | "closed" | "merged";
     changedFiles: string[];
     checks: CheckRun[];
   };

   type WebhookEvent =
     | { type: "push"; ref: string; commits: Commit[] }
     | { type: "pull_request"; action: "opened" | "updated" | "merged" | "closed"; pr: PullRequest }
     | { type: "comment"; prNumber: number; body: string; author: string };

   type VCSConfig = {
     provider: VCSProvider;
     token: string;
     owner: string;
     repo: string;
     webhookSecret?: string;
   };
   ```

4. **Build `src/github.ts`** — GitHub API client:
   - `createPR(title, body, branch, base)` → PR number
   - `commentOnPR(prNumber, body)` → post plan output as comment
   - `addReview(prNumber, body, event)` → approve/request changes
   - `getChangedFiles(prNumber)` → list of changed file paths
   - `createCheckRun(sha, name, status, output)` → CI check
   - `setStatus(sha, state, context, description, targetUrl)` → commit status

5. **Build `src/gitlab.ts`** — equivalent GitLab client via `@gitbeaker/rest`

6. **Build `src/webhook-handler.ts`** — receive VCS webhook events via `api.registerHttpRoute()`:
   - **On PR opened/updated** with `.tf` files → auto-run `terraform plan` → post plan output as PR comment
   - **On PR merged** → auto-run `terraform apply` (if policy allows auto-apply)
   - **On push to main** → trigger drift detection via Knowledge Graph
   - Webhook signature verification (HMAC-SHA256 for GitHub, token for GitLab)

7. **Build `src/plan-formatter.ts`** — format Terraform plan as PR comment:
   ```markdown
   ## Terraform Plan
   | Action | Resource | Type |
   |--------|----------|------|
   | + Create | aws_instance.web | aws_instance |
   | ~ Update | aws_s3_bucket.data | aws_s3_bucket |
   | - Destroy | aws_iam_role.old | aws_iam_role |

   **Summary**: 1 to create, 1 to update, 1 to destroy
   **Estimated cost change**: +$45.20/month

   ✅ Policy check: PASSED (3 policies evaluated)
   ```

8. **Build 4 agent tools**:
   - `vcs_create_pr` — create a PR with IaC changes
   - `vcs_pr_status` — get PR status, checks, reviews
   - `vcs_comment` — comment on a PR
   - `vcs_review` — approve/request changes on PR

9. **Build CLI commands** (`espada vcs`):
   - `vcs configure` — set up GitHub/GitLab token + webhook
   - `vcs pr list` — list open PRs
   - `vcs pr create --title <title> --branch <branch>` — create PR
   - `vcs pr status <number>` — show PR status with checks
   - `vcs webhook start` — start webhook listener on gateway

10. **Wire into policy engine** — evaluate plan policies before commenting "approved" on PRs

11. **Write tests** — API mocking with `msw`, webhook parsing, plan formatting, signature verification. **Target: 25+ tests**

---

### Feature 7: Cost Estimation (Pre-Apply, Infracost)

**Priority**: P1  
**Competitive reference**: Spacelift (Infracost integration, cost diff per run), Env0 (cost governance, FinOps)  
**Extension**: `extensions/cost-governance/`

#### What Exists

- Knowledge Graph: per-node `costMonthly` and `CostAttribution` type
- AWS `CostManager` at `extensions/aws/src/cost/manager.ts` (1731 LOC) — AWS Cost Explorer, Budgets, Compute Optimizer
- AWS templates have `costRangeUsd` per tier
- No Infracost integration, no pre-apply cost diff

#### Steps

1. **Create `extensions/cost-governance/`** plugin

2. **Build `src/infracost.ts`** — wrap `infracost` CLI:
   - `breakdown(planFile)` → cost breakdown per resource
   - `diff(planFile, stateFile)` → cost delta (before vs after)
   - `output(format)` → JSON/table/HTML output
   - Auto-detect Infracost API key from env or config

3. **Define types** in `src/types.ts`:
   ```typescript
   type CostBreakdown = {
     totalMonthlyCost: number;
     totalHourlyCost: number;
     resources: ResourceCost[];
     currency: string;
   };

   type CostDiff = {
     currentMonthlyCost: number;
     projectedMonthlyCost: number;
     deltaMonthlyCost: number;
     deltaPercent: number;
     resourceChanges: ResourceCostChange[];
   };

   type Budget = {
     id: string;
     name: string;
     scope: "team" | "project" | "environment" | "global";
     scopeId: string;
     monthlyLimit: number;
     warningThreshold: number; // percentage (e.g., 80)
     criticalThreshold: number; // percentage (e.g., 100)
     currentSpend: number;
     currency: string;
   };
   ```

4. **Build `src/budgets.ts`** — `BudgetManager`:
   - Define budgets per team/project/environment with monthly thresholds
   - Alert when projected cost exceeds budget (warning at 80%, critical at 100%)
   - Store in `~/.espada/budgets.json`
   - Integrate with Knowledge Graph `CostAttribution` for actual spend tracking

5. **Build `src/cost-policy.ts`** — cost-specific Rego policies:
   - "Deny changes that increase monthly cost by >$X"
   - "Require approval for resources costing >$Y/month"
   - "Alert when team budget utilization exceeds threshold"

6. **Wire into other features**:
   - **Terraform extension**: auto-run Infracost on every `tf_plan`, include cost diff in output
   - **VCS extension**: include cost diff in PR comments
   - **Knowledge Graph**: update node `costMonthly` from Infracost data

7. **Build 3 agent tools**:
   - `cost_estimate` — estimate cost of planned changes (requires plan file)
   - `cost_budget_status` — show budget vs actual for all scopes
   - `cost_forecast` — project future costs based on trends (linear extrapolation from KG cost history)

8. **Build CLI commands**:
   - `espada cost estimate <plan-file>` — show cost breakdown
   - `espada cost budget list` — list all budgets with current status
   - `espada cost budget set --scope <scope> --limit <amount>` — create/update budget
   - `espada cost budget status` — show utilization
   - `espada cost forecast --months <n>` — project future costs

9. **Write tests** — Infracost output parsing, budget threshold logic, cost policy evaluation. **Target: 20+ tests**

---

### Feature 8: Infrastructure Blueprints/Templates

**Priority**: P1  
**Competitive reference**: Spacelift (Blueprints with CEL templating), Env0 (template catalog for self-service)  
**Extension**: `extensions/blueprints/`

#### What Exists

- **AWS `INFRASTRUCTURE_CATALOG`** at `extensions/aws/src/catalog/templates.ts` (979 LOC) — 6 `IntentTemplate` objects (Three-Tier Web App, Serverless API, Data Analytics, Container Microservices, CI/CD, Static Website)
- **Azure/GCP `Blueprint`** types in their orchestration modules
- **All provider-specific, not unified**: no cross-provider template system

#### Steps

1. **Create `extensions/blueprints/`** plugin

2. **Define types** in `src/types.ts`:
   ```typescript
   type Blueprint = {
     id: string;
     name: string;
     description: string;
     version: string;
     category: "web-app" | "api" | "data" | "container" | "serverless" | "static-site" | "custom";
     providers: CloudProvider[];
     parameters: BlueprintParameter[];
     resources: BlueprintResource[];
     dependencies: BlueprintDependency[];
     policies: string[]; // policy IDs to auto-attach
     estimatedCostRange: [number, number]; // monthly USD
     tags: string[];
   };

   type BlueprintParameter = {
     id: string;
     name: string;
     description?: string;
     type: "string" | "number" | "boolean" | "select";
     required: boolean;
     default?: unknown;
     options?: string[]; // for select type
     validation?: {
       pattern?: string;
       min?: number;
       max?: number;
       minLength?: number;
       maxLength?: number;
     };
   };

   type BlueprintInstance = {
     id: string;
     blueprintId: string;
     name: string;
     parameters: Record<string, unknown>;
     createdAt: string;
     status: "deploying" | "active" | "failed" | "destroying" | "destroyed";
     resources: string[]; // GraphNode IDs
     graphGroupId: string; // linked KG group
   };
   ```

3. **Build `src/engine.ts`** — `BlueprintEngine`:
   - `render(blueprint, parameters)` → resolve templates, generate Terraform HCL files
   - `validate(blueprint, parameters)` → check required params, run validation rules
   - `preview(blueprint, parameters)` → dry-run: list resources, estimated cost
   - `deploy(blueprint, parameters)` → render + terraform init + plan + apply (with Lobster approval gate)
   - `destroy(instanceId)` → tear down deployed blueprint
   - `status(instanceId)` → current state of deployed instance

4. **Build `src/library.ts`** — built-in cross-provider blueprints:
   | Blueprint | AWS | Azure | GCP |
   |-----------|-----|-------|-----|
   | Three-Tier Web App | EC2+ALB+RDS | VM+AppGW+SQL | GCE+LB+CloudSQL |
   | Serverless API | Lambda+APIGW+DynamoDB | Functions+APIM+CosmosDB | CloudRun+APIGW+Firestore |
   | Container Cluster | EKS+ECR | AKS+ACR | GKE+Artifact Registry |
   | Static Website + CDN | S3+CloudFront | Storage+CDN | GCS+Cloud CDN |
   | Data Pipeline | Kinesis+Lambda+S3 | EventGrid+Functions+Storage | Pub/Sub+Functions+GCS |

5. **Build `src/custom.ts`** — user-defined blueprints:
   - Load from `~/.espada/blueprints/` directory
   - YAML format with `${{ inputs.name }}` templating
   - Scaffold command to create new blueprint YAML

6. **Build 4 agent tools**:
   - `blueprint_list` — browse catalog with category/provider filters
   - `blueprint_preview` — preview what a blueprint would create
   - `blueprint_deploy` — deploy a blueprint with parameters
   - `blueprint_status` — check deployed instances

7. **Build CLI commands** (`espada blueprint`):
   - `blueprint list` — list catalog
   - `blueprint show <id>` — show details with parameters
   - `blueprint preview <id> --params key=value` — dry-run preview
   - `blueprint deploy <id> --params key=value` — deploy
   - `blueprint destroy <instance-id>` — tear down
   - `blueprint create` — scaffold custom blueprint YAML
   - `blueprint instances` — list deployed instances

8. **Wire deployed blueprint resources** into Knowledge Graph as a `GraphGroup` with `groupType: "stack"`

9. **Write tests** — rendering, validation, parameter resolution, preview. **Target: 25+ tests**

---

## TIER P2 — Differentiation Amplifiers

These features deepen Espada's unique advantages and create capabilities that competitors would take years to replicate.

---

### Feature 9: Disaster Recovery Analysis

**Priority**: P2  
**Competitive reference**: Firefly (CRPM, cross-region failover, infrastructure rebuilding, DORA/SOC2/ISO compliance)  
**Location**: Enhancement to `extensions/knowledge-graph/`

#### What Exists

- Knowledge Graph: blast radius, dependency chains (BFS), SPOF detection (Tarjan's), clustering (connected components)
- Node metadata: `status`, `region`, `tags`, `costMonthly`
- Relationship types include `"depends-on"`, `"runs-in"`, `"routes-to"`, `"stores-in"`
- AWS `BackupManager` at `extensions/aws/src/backup/`
- No cross-region failover analysis, no recovery planning

#### Steps

1. **Add DR types** to `extensions/knowledge-graph/src/types.ts`:
   ```typescript
   type DRAnalysis = {
     overallScore: number; // 0-100
     grade: "A" | "B" | "C" | "D" | "F";
     singleRegionRisks: SingleRegionRisk[];
     unprotectedCriticalResources: GraphNode[];
     recoveryTimeEstimates: Map<string, number>; // nodeId → estimated RTO in minutes
     recommendations: DRRecommendation[];
   };

   type SingleRegionRisk = {
     region: string;
     provider: CloudProvider;
     criticalResources: number;
     totalResources: number;
     hasFailover: boolean;
     riskLevel: "critical" | "high" | "medium" | "low";
   };

   type RecoveryRequirement = {
     nodeId: string;
     rpo: number | null; // Recovery Point Objective in minutes
     rto: number | null; // Recovery Time Objective in minutes
     backupStrategy: "none" | "snapshot" | "replication" | "multi-region";
     replicationStatus: "none" | "async" | "sync" | "active-active";
     failoverCapable: boolean;
   };

   type RecoveryPlan = {
     scenario: string;
     affectedResources: GraphNode[];
     recoverySteps: RecoveryStep[];
     estimatedRTO: number; // minutes
     estimatedRPO: number; // minutes
     dependencies: string[][]; // ordered groups of parallel recovery steps
   };

   type RecoveryStep = {
     order: number;
     action: string;
     resource: GraphNode;
     estimatedDuration: number; // minutes
     dependsOn: number[]; // step orders
     manual: boolean;
   };

   type DRRecommendation = {
     severity: "critical" | "high" | "medium" | "low";
     category: "backup" | "replication" | "failover" | "redundancy" | "monitoring";
     description: string;
     affectedResources: string[];
     estimatedCost: number | null; // monthly USD to implement
     effort: "low" | "medium" | "high";
   };
   ```

2. **Build `src/dr-analysis.ts`** — `DisasterRecoveryAnalyzer`:
   - `analyzePosture(filter?)` → scan graph for DR weaknesses:
     - Single-region critical resources (no cross-region replication edges)
     - Resources without backup edges
     - Critical path resources (SPOF) with no failover
     - Data stores without replication
     - Load balancers pointing to single AZ
   - `generateRecoveryPlan(failureScenario)` → ordered recovery steps based on dependency graph:
     - Scenarios: `region-failure`, `az-failure`, `service-outage`, `data-corruption`
     - Use topological sort on dependency graph to determine recovery order
   - `estimateRecoveryTime(nodeId)` → RTO estimate based on dependency depth + resource type
   - `findRegionDependencies()` → group resources by region, identify cross-region gaps

3. **Build `src/dr-scoring.ts`** — DR posture scoring:
   - Weighted factors:
     | Factor | Weight |
     |--------|--------|
     | Backup coverage | 0.25 |
     | Replication breadth | 0.25 |
     | SPOF count | 0.20 |
     | Cross-region distribution | 0.15 |
     | Recovery plan existence | 0.15 |
   - Output: score 0–100, grade A–F, critical findings list

4. **Add new relationship types** to `GraphRelationshipType`:
   - `"replicates-to"` — data replication edge
   - `"backs-up-to"` — backup relationship
   - `"fails-over-to"` — failover target
   - `"restores-from"` — restore source

5. **Build 3 agent tools**:
   - `kg_dr_posture` — overall DR analysis with score, grade, recommendations
   - `kg_dr_plan` — generate recovery plan for a specific failure scenario
   - `kg_dr_gaps` — list resources lacking DR protection

6. **Build CLI commands**: `espada graph dr posture`, `espada graph dr plan --scenario <...>`, `espada graph dr gaps`

7. **Register gateway method**: `knowledge-graph/dr-analysis`

8. **Write tests** — posture scoring, recovery plan generation, region dependency analysis, RTO estimation. **Target: 20+ tests**

---

### Feature 10: IaC Generation from Existing Resources

**Priority**: P2  
**Competitive reference**: Firefly ("codify" — scan cloud → generate Terraform)  
**Location**: Enhancement to `extensions/terraform/`

#### What Exists

- AWS `IaCManager.generateTerraform()` at `extensions/aws/src/iac/manager.ts` — generates HCL from `InfrastructureTemplate` objects
- Knowledge Graph tracks all discovered resources with full metadata
- **Bridge between KG resources and HCL generation is missing**

#### Steps

1. **Build `src/codify.ts`** in `extensions/terraform/`:
   - `codifyFromGraph(graphEngine, filter)` → query graph nodes by filter → generate Terraform for each resource
   - `codifySubgraph(graphEngine, nodeId, depth)` → codify a resource and all its dependencies to specified depth
   - `generateImportCommands(resources)` → `terraform import <address> <id>` commands
   - `generateProviderBlocks(resources)` → auto-generate `provider {}` blocks from discovered providers/regions
   - `generateOutputBlocks(resources)` → common outputs (IDs, ARNs, endpoints)

2. **Build `src/hcl-generator.ts`** — resource-type-specific HCL generators:
   - Map `GraphResourceType` → HCL `resource` blocks with attributes from `GraphNode.metadata`
   - Handle references: `data` sources for external refs, direct references for same-state resources
   - Generate `variable` blocks for parameterizable values (region, instance type, etc.)
   - Resource type coverage:
     | Graph Type | Terraform Type | Key Attributes |
     |-----------|----------------|----------------|
     | `compute-instance` | `aws_instance` / `azurerm_virtual_machine` / `google_compute_instance` | ami, instance_type, subnet, security_groups |
     | `database` | `aws_db_instance` / `azurerm_postgresql_server` / `google_sql_database_instance` | engine, storage, multi_az |
     | `storage-bucket` | `aws_s3_bucket` / `azurerm_storage_account` / `google_storage_bucket` | versioning, encryption, lifecycle |
     | `load-balancer` | `aws_lb` / `azurerm_lb` / `google_compute_forwarding_rule` | type, listeners, targets |
     | `serverless-function` | `aws_lambda_function` / `azurerm_function_app` / `google_cloudfunctions_function` | runtime, memory, handler |
     | ... | ... | ... |

3. **Build `src/import-plan.ts`** — `TerraformImportPlanner`:
   - Analyze graph subgraph for import ordering (dependencies first)
   - Generate `import {}` blocks (Terraform 1.5+ syntax)
   - Validate imports against provider schema
   - Generate a sequential import script for older Terraform versions

4. **Add 3 agent tools**:
   - `tf_codify` — generate Terraform from graph resources (by filter)
   - `tf_codify_subgraph` — codify a resource and all N-hop dependencies
   - `tf_generate_imports` — generate import commands/blocks

5. **Add CLI commands**:
   - `espada terraform codify --filter <provider/type/tag>` — generate HCL files
   - `espada terraform codify --resource <nodeId> --depth <n>` — codify subgraph
   - `espada terraform import-plan --filter <...>` — generate import plan

6. **Write tests** — HCL generation per resource type, import ordering, provider block generation, reference handling. **Target: 25+ tests**

---

### Feature 11: Compliance Framework Mapping

**Priority**: P2  
**Competitive reference**: Env0 (compliance governance), Firefly (DORA/SOC2/ISO compliance), Spacelift (FedRAMP)  
**Extension**: `extensions/compliance/`

#### What Exists

- **AWS `ComplianceManager`** at `extensions/aws/src/compliance/types.ts` (1498 LOC) — 20+ `ComplianceFramework` variants (CIS 1.2-3.0, SOC2, HIPAA, PCI-DSS, GDPR, NIST 800-53, FedRAMP, ISO-27001, AWS Well-Architected, AWS Foundational)
- **AWS `PolicyEngine`** has compliance framework scoping in rules
- **None of this is connected to the Knowledge Graph** — compliance is AWS-specific, not topology-aware

#### Steps

1. **Create `extensions/compliance/`** plugin

2. **Define types** in `src/types.ts`:
   ```typescript
   type ComplianceFramework = {
     id: string;
     name: string;
     version: string;
     description: string;
     controls: ComplianceControl[];
     categories: string[];
   };

   type ComplianceControl = {
     id: string;
     title: string;
     description: string;
     category: string;
     severity: "critical" | "high" | "medium" | "low" | "info";
     applicableResourceTypes: GraphResourceType[];
     evaluationLogic: ControlEvaluator; // function or Rego policy ID
     remediation: string;
     references: string[]; // documentation URLs
   };

   type ComplianceViolation = {
     controlId: string;
     controlTitle: string;
     framework: string;
     resourceNodeId: string;
     resourceName: string;
     resourceType: string;
     severity: string;
     description: string;
     remediation: string;
     status: "open" | "remediated" | "waived" | "accepted";
     detectedAt: string;
     waiverInfo?: ComplianceWaiver;
   };

   type ComplianceReport = {
     framework: string;
     frameworkVersion: string;
     generatedAt: string;
     scope: string; // filter description
     score: number; // percentage passed
     totalControls: number;
     passedControls: number;
     failedControls: number;
     waivedControls: number;
     notApplicable: number;
     violations: ComplianceViolation[];
     byCategory: Record<string, { passed: number; failed: number; total: number }>;
     bySeverity: Record<string, number>;
     trend?: ComplianceTrend[];
   };

   type ComplianceWaiver = {
     id: string;
     controlId: string;
     resourceId: string;
     reason: string;
     approvedBy: string;
     approvedAt: string;
     expiresAt: string;
   };

   type ComplianceTrend = {
     date: string;
     score: number;
     violations: number;
   };
   ```

3. **Build `src/evaluator.ts`** — `ComplianceEvaluator`:
   - `evaluate(framework, graphNodes[])` → walk nodes, apply control rules per resource type, aggregate results
   - `evaluateControl(control, node)` → check node metadata/tags/config against control requirements
   - Built-in control implementations per framework:
     | Framework | Key Controls |
     |-----------|-------------|
     | **SOC2** | Encryption at rest, access logging, backup coverage, change tracking, MFA |
     | **CIS Benchmarks** | Public access checks, MFA, key rotation, unused resources, default VPC |
     | **HIPAA** | Data encryption, audit logging, access controls, BAA coverage |
     | **PCI-DSS** | Network segmentation, encryption, monitoring, access restriction |
     | **GDPR** | Data residency (region checks), data classification tags, retention policies |
     | **NIST 800-53** | Access control, audit, config management, incident response, system integrity |

4. **Build `src/reporter.ts`** — `ComplianceReporter`:
   - `generateReport(framework, evaluationResult)` → structured `ComplianceReport`
   - `exportReport(format)` → JSON, Markdown, PDF-ready HTML
   - `compareReports(before, after)` → compliance trend over time
   - `mapToGraph(violations)` → annotate Knowledge Graph nodes with compliance status in metadata

5. **Build `src/waivers.ts`** — waiver management:
   - Store in `~/.espada/compliance-waivers.json`
   - Time-limited waivers with approval tracking
   - Audit trail integration (log waiver creation/expiry)

6. **Build 4 agent tools**:
   - `compliance_scan` — run full compliance scan against a framework
   - `compliance_report` — generate formatted compliance report
   - `compliance_violations` — list open violations with remediation guidance
   - `compliance_waiver` — request/grant/list waivers

7. **Build CLI commands** (`espada compliance`):
   - `compliance scan --framework <soc2|cis|hipaa|pci|gdpr|nist>` — run scan
   - `compliance report --framework <...> --format <json|md>` — generate report
   - `compliance violations list` — list open violations
   - `compliance waiver add --control <id> --resource <id> --reason <text> --expires <date>` — add waiver
   - `compliance waiver list` — list active waivers
   - `compliance waiver remove <id>` — remove waiver
   - `compliance trend` — show compliance score over time

8. **Register gateway methods**: `compliance/scan`, `compliance/report`, `compliance/violations`

9. **Wire into other systems**:
   - **Policy engine**: compliance controls expressible as Rego policies
   - **Audit trail**: log compliance scans, violation detection, waiver decisions
   - **VCS integration**: compliance report as PR check

10. **Write tests** — control evaluation per resource type, scoring, waiver logic, report generation, trend comparison. **Target: 30+ tests**

---

## Cross-Cutting Concerns

### Shared Patterns

Every feature follows these established codebase patterns:

- **Plugin registration**: via `api.registerTool()`, `api.registerCli()`, `api.registerGatewayMethod()`, `api.registerService()`
- **Tool schemas**: TypeBox (`@sinclair/typebox`) — no `Type.Union`, use `stringEnum`/`optionalStringEnum` from `espada/plugin-sdk`
- **Gateway methods**: `respond(ok, payload)` pattern, never return from handler
- **CLI**: Commander-based, lazy-loaded subcommands
- **Storage**: SQLite for complex data (`better-sqlite3`, WAL mode), JSON files for config — both stored under `~/.espada/`
- **Testing**: Vitest, colocated `*.test.ts` files, V8 coverage
- **Naming**: `espada` for CLI/paths/config, Espada for product/docs

### Verification Checklist (Per Feature)

- [ ] `pnpm build` — passes with 0 type errors
- [ ] `pnpm test` — all tests pass (extension-specific + full suite)
- [ ] `pnpm lint` — no lint violations
- [ ] CLI commands work end-to-end
- [ ] Agent tools appear in tool list and execute correctly
- [ ] Gateway methods respond via WebSocket RPC
- [ ] Audit events emitted for all operations
- [ ] README updated with new capabilities

### File Size Guidelines

- Keep files under ~500 LOC when feasible (per AGENTS.md)
- Split large modules: e.g., `engine.ts` + `engine-utils.ts`, `types.ts` + `types-policy.ts`
- Extract shared helpers rather than duplicating

---

## Competitive Positioning Summary

After implementing all 11 features:

| Capability | Spacelift | Env0 | Firefly | Espada |
|---|:---:|:---:|:---:|:---:|
| AI-Native Architecture | Bolt-on (Intent) | Bolt-on | Bolt-on (Thinkerbell) | **Core** |
| Multi-Channel (22+) | Slack/Teams only | None | None | **Yes** |
| Knowledge Graph | No | No | No | **Yes** |
| Policy-as-Code (OPA/Rego) | Yes | Yes | Partial | **Yes** (Feature 1) |
| SSO/RBAC | Yes | Yes | Yes | **Yes** (Feature 2) |
| Terraform State Management | Yes | Yes | Partial | **Yes** (Feature 3) |
| Audit Trail | Yes | Yes | Partial | **Yes** (Feature 4) |
| Multi-IaC | 6 tools | TF+CF | TF | **4 tools** (Feature 5) |
| VCS Integration (PR workflow) | Deep | Deep | Partial | **Yes** (Feature 6) |
| Cost Governance (Infracost) | Yes | Deep | No | **Yes** (Feature 7) |
| Blueprints/Templates | Yes | Yes | Yes | **Yes** (Feature 8) |
| Disaster Recovery | Partial | No | **Deep (CRPM)** | **Yes** (Feature 9) |
| IaC Generation ("Codify") | No | Partial | **Yes** | **Yes** (Feature 10) |
| Compliance Mapping | FedRAMP | SOC2 | DORA/SOC2/ISO | **6 frameworks** (Feature 11) |
| Voice Interface | No | No | No | **Yes** |
| Local-First | Self-hosted option | No | No | **Yes** |
| Plugin Ecosystem (34+ exts) | Limited plugins | No | OSS tools | **Yes** |
| Mobile/Desktop Apps | Web only | Web only | Web only | **macOS/iOS/Android** |

**The result**: Espada matches or exceeds every competitor on their core strengths while maintaining unique AI-native, multi-channel, local-first advantages that would take them years to replicate.
