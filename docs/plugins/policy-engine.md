---
summary: Policy-as-Code engine for evaluating and enforcing infrastructure policies — declarative rules, built-in library, resource scanning, plan checks, and SQLite persistence.
read_when:
  - creating or managing infrastructure policies
  - evaluating resources or IaC plans against compliance rules
  - scanning for policy violations across resources
  - importing policies from the built-in library
  - integrating policy checks into deployment pipelines
---

# Policy Engine

The **Policy Engine** extension (`@espada/policy-engine`) provides a
Policy-as-Code framework for evaluating and enforcing infrastructure policies.
Policies are expressed as declarative rules with field comparisons, tag checks,
and logical combinators (and/or/not). The engine evaluates resources and IaC
plans against those rules, producing allow/deny decisions, warnings, approval
requirements, and violation reports.

> **Plugin ID:** `policy-engine` · **Version:** 1.0.0 · **2 test files, 80 test cases**

---

## Prerequisites

| Requirement | Purpose |
|---|---|
| Espada instance | Core runtime |
| Node.js ≥ 18 | Extension host |
| `better-sqlite3` | Persistent policy storage (bundled) |

---

## Install

```yaml
# espada.yaml
extensions:
  policy-engine:
    enabled: true
```

Storage is automatic — a SQLite database (`policies.db`) is created in the
plugin state directory. In test environments (`NODE_ENV=test` or
`ESPADA_TEST=1`) an in-memory store is used instead.

---

## Policy model

### Policy definition

```ts
{
  id: string;             // Unique identifier
  name: string;           // Human-readable name
  description: string;    // What this policy enforces
  type: PolicyType;       // plan | access | approval | notification | drift | cost | deployment
  enabled: boolean;       // Active or disabled
  severity: PolicySeverity; // critical | high | medium | low | info
  labels: string[];       // Organisational labels
  autoAttachPatterns: string[];  // Resource matching patterns
  rules: PolicyRule[];    // Declarative rule definitions
  createdAt: string;      // ISO timestamp
  updatedAt: string;      // ISO timestamp
}
```

### Policy types

| Type | Purpose |
|---|---|
| `plan` | Evaluate IaC plans before apply |
| `access` | Control who can perform operations |
| `approval` | Require human approval for actions |
| `notification` | Trigger alerts without blocking |
| `drift` | Detect configuration drift |
| `cost` | Enforce cost guardrails |
| `deployment` | Gate deployment operations |

### Auto-attach patterns

Policies can target resources automatically via patterns:

| Pattern | Matches |
|---|---|
| `*` | All resources |
| `provider:aws` | All AWS resources |
| `type:aws_s3_bucket` | Specific resource type |
| `region:us-east-1` | Specific region |
| `tag:environment=production` | Resources with a specific tag value |
| `tag:team` | Resources that have the tag (any value) |

---

## Rule conditions

Rules use a declarative condition system with 18 condition types:

### Field conditions

| Condition | Description |
|---|---|
| `field_equals` | Field equals a value |
| `field_not_equals` | Field does not equal a value |
| `field_contains` | String/array contains a value |
| `field_matches` | String matches a regex pattern |
| `field_gt` | Numeric field greater than |
| `field_lt` | Numeric field less than |
| `field_exists` | Field is present |
| `field_not_exists` | Field is absent |
| `field_in` | Field value in a list |
| `field_not_in` | Field value not in a list |

### Tag conditions

| Condition | Description |
|---|---|
| `tag_missing` | Resource is missing a specific tag |
| `tag_equals` | Resource tag equals a value |

### Logical combinators

| Condition | Description |
|---|---|
| `and` | All child conditions must be true |
| `or` | Any child condition must be true |
| `not` | Negate a child condition |

### Context conditions

| Condition | Description |
|---|---|
| `resource_type` | Match on resource type |
| `provider` | Match on cloud provider |
| `region` | Match on region |
| `custom` | Custom evaluator (extensible) |

### Rule actions

Each rule specifies an action when its condition triggers:

| Action | Behaviour |
|---|---|
| `deny` | Block the operation |
| `warn` | Allow but emit a warning |
| `require_approval` | Allow pending human approval |
| `notify` | Allow and send a notification |

### Evaluation input fields

Rules can reference any of these dot-path fields:

```
resource.id, resource.type, resource.provider, resource.region,
resource.name, resource.status, resource.tags.*, resource.metadata.*

plan.totalCreates, plan.totalUpdates, plan.totalDeletes

actor.id, actor.roles

environment

cost.current, cost.projected, cost.delta

graph.blastRadius, graph.dependencyDepth
```

---

## Agent tools

| # | Tool | Description |
|---|---|---|
| 1 | `policy_evaluate` | Evaluate a single resource against all enabled policies. Returns allow/deny, warnings, violations. |
| 2 | `policy_list` | List policies with optional filters by type, severity, or enabled status. |
| 3 | `policy_check_plan` | Evaluate an IaC plan (creates/updates/deletes) against policies. Also evaluates per-resource if resources are provided. |
| 4 | `policy_violations` | Scan an array of resources against all policies and return all violations, optionally filtered by minimum severity. |

### `policy_evaluate`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `resourceId` | string | yes | Resource ID |
| `resourceType` | string | yes | Resource type (e.g. `aws_s3_bucket`) |
| `provider` | string | yes | Cloud provider |
| `region` | string | no | Region |
| `tags` | Record | no | Resource tags |
| `metadata` | Record | no | Resource metadata |
| `environment` | string | no | Environment name |

### `policy_list`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string | no | Filter by policy type |
| `severity` | string | no | Filter by severity |
| `enabled` | boolean | no | Filter by enabled status |

### `policy_check_plan`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `creates` | number | yes | Resources to create |
| `updates` | number | yes | Resources to update |
| `deletes` | number | yes | Resources to delete |
| `environment` | string | no | Target environment |
| `resources` | ResourceInput[] | no | Affected resources for per-resource evaluation |

### `policy_violations`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `resources` | ResourceInput[] | yes | Resources to scan |
| `severity` | string | no | Minimum severity filter |

---

## CLI commands

All commands live under `espada policy`:

| Command | Description |
|---|---|
| `policy list` | List policies. Flags: `--type`, `--severity`, `--enabled`, `--disabled`, `--json` |
| `policy add <file>` | Import a policy from a JSON file |
| `policy remove <id>` | Delete a policy by ID |
| `policy show <id>` | Show full policy definition as JSON |
| `policy test <policyId> <inputFile>` | Test a single policy against sample input JSON |
| `policy evaluate` | Evaluate a resource against all policies. Flags: `--id`, `--type`, `--provider`, `--region`, `--env`, `--tag key=value`, `--json` |
| `policy scan <file>` | Scan resources from a JSON file. Flags: `--severity`, `--json` |
| `policy library` | Browse built-in policy templates. Flags: `--category`, `--json` |
| `policy library-import <templateId>` | Import a library template. Flag: `--id` to override policy ID |

---

## Gateway methods

| Method | Parameters | Description |
|---|---|---|
| `policy/evaluate` | `resource`, `environment?` | Evaluate a resource against enabled policies |
| `policy/check-plan` | `creates`, `updates`, `deletes`, `resources?`, `environment?` | Evaluate an IaC plan |
| `policy/list` | `type?`, `severity?`, `enabled?` | List policies with filters |
| `policy/save` | `policy` | Create or update a policy |
| `policy/delete` | `id` | Delete a policy |
| `policy/library` | — | List all built-in templates |
| `policy/library-import` | `templateId`, `customId?` | Import a library template |
| `policy/scan` | `resources` | Scan resources and return violations |

---

## Built-in policy library

The engine ships with 8 ready-to-use templates across 4 categories:

### Security

| Template | Severity | Description |
|---|---|---|
| `deny-public-s3` | critical | Block S3 buckets with public ACLs or disabled public-access block |
| `require-encryption` | high | Require encryption-at-rest on S3, EBS, and RDS resources |

### Governance

| Template | Severity | Description |
|---|---|---|
| `require-tags` | high | Require `environment` and `owner` tags on all resources; warn on missing `team` |
| `deny-untagged` | medium | Block resources with zero tags |

### Cost

| Template | Severity | Description |
|---|---|---|
| `cost-threshold` | high | Warn on >$100/mo increase, require approval on >$500/mo |
| `restrict-instance-types` | medium | Warn on non-approved EC2 instance types (t3/m5/c5/r5 families) |

### Operations

| Template | Severity | Description |
|---|---|---|
| `block-prod-deletes` | critical | Deny production deletions; require approval for >10 production updates |
| `blast-radius-limit` | high | Warn on blast radius >10; deny on >50 |

Import a template:
```bash
espada policy library-import deny-public-s3
```

---

## Integration bridges

Helper functions convert data from other subsystems into policy evaluation
inputs:

| Function | Source |
|---|---|
| `buildPlanPolicyInput(opts)` | Terraform/IaC plan summary |
| `buildResourcePolicyInput(opts)` | Resource discovery results |
| `buildDriftPolicyInput(opts)` | Drift detection results (adds `drifted`, `driftedFields` metadata) |
| `buildCostPolicyInput(opts)` | Cost estimation data (computes delta) |
| `buildAccessPolicyInput(opts)` | Access control checks (adds `requestedOperation` metadata) |

---

## Storage

| Backend | When used | Characteristics |
|---|---|---|
| `SQLitePolicyStorage` | Production | WAL mode, indexed by type/enabled/severity, persistent to `policies.db` |
| `InMemoryPolicyStorage` | Tests | Fast, ephemeral, no dependencies |

Both implement the `PolicyStorage` interface:

```ts
interface PolicyStorage {
  initialize(): Promise<void>;
  save(policy: PolicyDefinition): Promise<void>;
  getById(id: string): Promise<PolicyDefinition | null>;
  list(filter?: { type?; enabled?; severity? }): Promise<PolicyDefinition[]>;
  delete(id: string): Promise<boolean>;
  close(): Promise<void>;
}
```

---

## Evaluation engine

`PolicyEvaluationEngine` provides three evaluation modes:

| Method | Description |
|---|---|
| `evaluate(policy, input)` | Evaluate a single policy → `PolicyEvaluationResult` |
| `evaluateAll(policies, input)` | Evaluate all policies → `AggregatedPolicyResult` (deny wins) |
| `scanResources(policies, resources)` | Scan resources → `PolicyViolation[]` |

The aggregated result includes:

- `allowed` / `denied` — overall verdict (any denial → denied)
- `warnings`, `denials`, `notifications` — collected messages
- `approvalRequired` — true if any rule requires approval
- `passedPolicies` / `failedPolicies` / `totalPolicies` — counts
- `totalDurationMs` — evaluation time

---

## Example conversations

**Evaluate a resource**
```
You: Check if my S3 bucket meets policy
Espada: I evaluated bucket "data-lake-prod" against 3 enabled policies:
        ✗ Deny Public S3 Buckets — S3 buckets must not have public ACLs
        ⚠ Require Resource Tags — Resources should have a "team" tag
        Result: DENIED (1 denial, 1 warning)
```

**Scan for violations**
```
You: Scan all our AWS resources for policy violations
Espada: Scanned 47 resources against 5 policies:
        🔴 3 critical — Public S3 buckets found
        🟠 7 high — Missing encryption or required tags
        🟡 4 medium — Non-approved instance types
        Total: 14 violations across 11 resources
```

**Import library template**
```
You: Import the cost threshold policy
Espada: Imported "Cost Change Threshold" with ID: cost-threshold
        It warns on cost increases > $100/mo and requires approval > $500/mo.
```

**Check an IaC plan**
```
You: Check our Terraform plan — 5 creates, 3 updates, 2 deletes in production
Espada: Plan evaluation: DENIED
        ✗ Block Production Deletions — Deleting resources in production is
          not allowed without an approved change request.
        1/4 policies failed.
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Storage not initialized" | The service hasn't started yet. Ensure the `policy-engine` service runs before evaluating. Check `api.logger` for init errors. |
| Policy not matching resources | Verify `autoAttachPatterns` — an empty array matches nothing during `scanResources`. Use `"*"` to match all resources. |
| SQLite errors on startup | Ensure the state directory is writable. Check disk space and file permissions on `policies.db`. |
| Library template not found | Run `espada policy library` to see available template IDs. IDs are case-sensitive. |
| Rules not triggering | Check that the field path in conditions matches the flattened input (e.g. `resource.metadata.acl`, not just `acl`). Use `policy test` to debug with sample JSON. |
| Denials in evaluation but plan allowed | Each policy is evaluated independently. Per-resource denials only appear if `resources` are passed to `policy_check_plan`. |
