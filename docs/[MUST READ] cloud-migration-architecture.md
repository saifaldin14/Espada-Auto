# Cross-Cloud Migration Engine — Architectural Design

> **Capability**: AI-orchestrated, integrity-verified migration of compute workloads (VMs), data (object storage, block volumes, databases), and network configurations across AWS, Azure, GCP, and on-premise environments.
>
> **Design Date**: March 2026

---

## Table of Contents

1. [Vision & Scope](#1-vision--scope)
2. [Extension Structure](#2-extension-structure)
3. [Core Type System](#3-core-type-system)
4. [Migration Engine Architecture](#4-migration-engine-architecture)
5. [Compute Migration Pipeline](#5-compute-migration-pipeline)
6. [Data Migration Pipeline](#6-data-migration-pipeline)
7. [Network Migration Pipeline](#7-network-migration-pipeline)
8. [Knowledge Graph Integration](#8-knowledge-graph-integration)
9. [Governance & Safety](#9-governance--safety)
10. [Agent Tools](#10-agent-tools)
11. [Gateway API Methods](#11-gateway-api-methods)
12. [CLI Commands](#12-cli-commands)
13. [Cross-Provider Credential Flow](#13-cross-provider-credential-flow)
14. [Resilience Patterns](#14-resilience-patterns)
15. [Verification Strategy](#15-verification-strategy)
16. [Implementation Phases](#16-implementation-phases)
17. [Key Design Decisions](#17-key-design-decisions)

---

## 1. Vision & Scope

### Goal

Enable AI-orchestrated, integrity-verified migration of compute workloads, data, and network configurations across AWS ↔ Azure ↔ GCP ↔ on-premise environments — integrated natively into Espada's extension architecture.

### Design Principles

| Principle | Description |
|---|---|
| **Extension-native** | Follows the `espada.plugin.json` + `register(api)` + `api.registerService/Tool/Gateway/CLI` contract exactly as AWS/Azure/GCP extensions do |
| **Orchestration-first** | Reuses the proven DAG-based `ExecutionPlan` pattern from Azure orchestration (topological sort, concurrency layers, auto-rollback, event lifecycle) |
| **Graph-aware** | Leverages the Knowledge Graph for dependency discovery, blast-radius analysis, and post-migration verification |
| **Human-in-the-loop** | Integrates with the existing `ExecApprovalManager` for mandatory approval gates before destructive operations |
| **Integrity-verified** | SHA-256 checksums at every transfer boundary — "verified" not "lossless" |

### Migration Directions (12 Paths)

```
     ┌─────────┐
     │   AWS   │ ◄──────────────────────────────┐
     └────┬────┘                                 │
          │ ↕                                    │ ↕
     ┌────┴────┐         ┌───────────┐     ┌────┴────┐
     │  Azure  │ ◄─────► │  On-Prem  │ ◄─► │   GCP   │
     └─────────┘         └───────────┘     └─────────┘
```

All 12 directional paths (A→B for each pair) are supported. On-premise includes VMware, KVM, Hyper-V, and Nutanix.

---

## 2. Extension Structure

```
extensions/cloud-migration/
├── espada.plugin.json                # Plugin manifest
├── index.ts                          # register(api) → wires lifecycle, tools, gateway, CLI
├── src/
│   ├── types.ts                      # All migration domain types
│   ├── lifecycle.ts                  # registerService({ start(), stop() })
│   ├── state.ts                      # CloudMigrationPluginState (shared manager refs)
│   │
│   ├── core/
│   │   ├── migration-engine.ts       # Top-level orchestrator (wraps Azure Orchestrator pattern)
│   │   ├── migration-planner.ts      # Assessment → ExecutionPlan generation
│   │   ├── compatibility-matrix.ts   # Source×Target×ResourceType compatibility rules
│   │   ├── cost-estimator.ts         # Egress + target infra cost projection
│   │   └── integrity-verifier.ts     # SHA-256 checksums, row counts, schema diffs
│   │
│   ├── compute/
│   │   ├── types.ts                  # NormalizedVM, NormalizedDisk, ImageFormat
│   │   ├── normalizer.ts            # EC2Instance|VMInstance|GcpComputeInstance → NormalizedVM
│   │   ├── image-converter.ts       # AMI↔VHD↔VMDK↔raw via qemu-img
│   │   ├── boot-remediator.ts       # cloud-init injection, driver swap, grub fix
│   │   ├── steps/                   # Orchestration step handlers
│   │   │   ├── snapshot-source.ts       # StepHandler: snapshot source VM
│   │   │   ├── export-image.ts          # StepHandler: export to staging bucket
│   │   │   ├── transfer-image.ts        # StepHandler: cross-cloud transfer
│   │   │   ├── convert-image.ts         # StepHandler: format conversion
│   │   │   ├── import-image.ts          # StepHandler: import at target cloud
│   │   │   ├── provision-vm.ts          # StepHandler: create target VM from image
│   │   │   ├── verify-boot.ts           # StepHandler: health-check the target VM
│   │   │   └── cutover.ts              # StepHandler: DNS/LB switch + source decommission
│   │   └── on-prem/
│   │       ├── agent-protocol.ts        # Protocol for on-prem migration agent
│   │       └── vmware-adapter.ts        # VMware/KVM/Hyper-V discovery + export
│   │
│   ├── data/
│   │   ├── types.ts                  # NormalizedBucket, NormalizedObject, TransferManifest
│   │   ├── normalizer.ts            # S3Bucket|StorageAccount|GcpBucket → NormalizedBucket
│   │   ├── transfer-engine.ts       # Multi-part parallel transfer with checksum
│   │   ├── steps/
│   │   │   ├── inventory-source.ts      # StepHandler: enumerate source objects/blobs
│   │   │   ├── create-target.ts         # StepHandler: create target bucket/container
│   │   │   ├── transfer-objects.ts      # StepHandler: parallel chunked transfer
│   │   │   ├── verify-integrity.ts      # StepHandler: SHA-256 per-object verification
│   │   │   └── sync-metadata.ts         # StepHandler: ACLs, lifecycle, tags, encryption
│   │   └── database/
│   │       ├── pg-migrator.ts           # PostgreSQL: pg_dump → transfer → pg_restore
│   │       ├── mysql-migrator.ts        # MySQL: mysqldump → transfer → import
│   │       └── schema-comparator.ts     # Post-migration schema + row count validation
│   │
│   ├── network/
│   │   ├── types.ts                  # NormalizedSecurityRule, NormalizedDNSRecord
│   │   ├── normalizer.ts            # SecurityGroup|NSG|GcpFirewall → NormalizedSecurityRule
│   │   ├── rule-translator.ts       # Best-effort rule translation with diff report
│   │   ├── dns-migrator.ts          # Route53/AzureDNS/CloudDNS record migration
│   │   └── steps/
│   │       ├── map-network.ts           # StepHandler: discover network topology
│   │       ├── create-security-rules.ts # StepHandler: create equivalent rules at target
│   │       ├── migrate-dns.ts           # StepHandler: DNS cutover with TTL management
│   │       └── verify-connectivity.ts   # StepHandler: post-migration connectivity test
│   │
│   ├── graph/
│   │   ├── dependency-analyzer.ts    # KG query: "what else must move with this resource?"
│   │   ├── migration-adapter.ts      # GraphDiscoveryAdapter for migration state
│   │   └── post-migration-sync.ts    # Update KG nodes with new provider/region/IDs
│   │
│   ├── governance/
│   │   ├── approval-gate.ts          # Integration with ExecApprovalManager
│   │   ├── policy-checker.ts         # Pre-migration policy validation (OPA)
│   │   ├── audit-logger.ts           # Structured audit log for every migration action
│   │   └── rollback-manager.ts       # Orchestrated rollback: reverse every completed step
│   │
│   ├── tools.ts                      # registerTool() — agent-facing tools
│   ├── register-gateway.ts           # registerGateway() — API methods
│   └── register-cli.ts              # registerCli() — CLI commands
│
└── __tests__/
    ├── migration-engine.test.ts
    ├── planner.test.ts
    ├── compute-normalizer.test.ts
    ├── data-transfer.test.ts
    ├── network-translator.test.ts
    ├── integrity-verifier.test.ts
    ├── compatibility-matrix.test.ts
    └── e2e/
        ├── aws-to-azure.e2e.test.ts
        ├── azure-to-gcp.e2e.test.ts
        └── data-migration.e2e.test.ts
```

---

## 3. Core Type System

### Migration Job Lifecycle

State machine modeled after `LifecyclePhase` from the incident-lifecycle extension:

```
created → assessing → planning → awaiting-approval → executing → verifying → cutting-over → completed
                                                        │                        │
                                                   rolling-back            rolled-back
                                                        │
                                                      failed
```

### Key Domain Types

| Type | Purpose | Pattern Source |
|---|---|---|
| `MigrationProvider` | `"aws" \| "azure" \| "gcp" \| "on-premises" \| "vmware" \| "nutanix"` | `CloudProvider` from hybrid-cloud |
| `MigrationResourceType` | `"vm" \| "disk" \| "object-storage" \| "database" \| "dns" \| "security-rules" \| "load-balancer"` | `InfrastructureResourceType` from infrastructure framework |
| `MigrationPhase` | State machine phases (above) | `LifecyclePhase` from incident-lifecycle |
| `NormalizedVM` | Provider-agnostic VM representation | Union of `EC2Instance \| VMInstance \| GcpComputeInstance` fields |
| `NormalizedDisk` | Provider-agnostic disk/volume | Common fields from block device mappings |
| `NormalizedBucket` | Provider-agnostic object storage | `S3Bucket \| StorageAccount \| GcpBucket` fields |
| `NormalizedSecurityRule` | Provider-agnostic firewall rule | SecurityGroup/NSG/GcpFirewall fields |
| `MigrationJob` | Top-level job record | Follows `LifecycleIncident` pattern |
| `MigrationExecutionPlan` | DAG of steps | Extends `ExecutionPlan` from Azure orchestration |
| `MigrationStep` | Individual step in the DAG | Extends `PlanStep` with migration-specific fields |
| `IntegrityReport` | Per-resource checksum verification | SHA-256 + metadata comparison |
| `CompatibilityResult` | Can resource X migrate from A→B? | With warnings, blockers, workarounds |
| `MigrationCostEstimate` | Egress + target infra costs | Extends cost-governance patterns |

### NormalizedVM Field Mapping

| Field | AWS Source | Azure Source | GCP Source |
|---|---|---|---|
| `id` | `instanceId` | `id` | `name` (zone-scoped) |
| `name` | `tags.Name` | `name` | `name` |
| `provider` | `"aws"` | `"azure"` | `"gcp"` |
| `region` | `region` | `location` | extracted from `zone` |
| `cpuCores` | `cpuOptions.coreCount` | parsed from `vmSize` | parsed from `machineType` |
| `memoryGB` | looked up from `instanceType` | parsed from `vmSize` | parsed from `machineType` |
| `osType` | `platform` | `osType` | metadata or disk labels |
| `disks` | `blockDeviceMappings` | Azure disk API | `disks` |
| `networkInterfaces` | inferred from SG/VPC | `networkInterfaces` | `networkInterfaces` |
| `tags` | `tags` | `tags` | `labels` |

---

## 4. Migration Engine Architecture

### Data Flow

```
User/Agent Intent
       │
       ▼
┌──────────────────┐
│ Migration Planner │ ◄── Knowledge Graph (dependency discovery)
│                    │ ◄── Compatibility Matrix
│                    │ ◄── Cost Estimator
└────────┬─────────┘
         │ MigrationExecutionPlan (DAG of MigrationSteps)
         ▼
┌──────────────────┐
│ Approval Gate     │ ◄── ExecApprovalManager (human-in-the-loop)
│                    │ ◄── Policy Checker (OPA)
└────────┬─────────┘
         │ Approved plan
         ▼
┌──────────────────┐
│ Migration Engine  │ ◄── Orchestrator (topological sort, concurrency, rollback)
│                    │ ◄── Step Handlers (actual cloud SDK calls)
│                    │ ◄── Circuit Breakers (per-provider, per-service)
│                    │ ◄── Integrity Verifier (SHA-256 at every boundary)
└────────┬─────────┘
         │ MigrationResult
         ▼
┌──────────────────┐
│ Post-Migration    │ ◄── Knowledge Graph update (new nodes, retired old)
│                    │ ◄── DNS cutover
│                    │ ◄── Audit log
└──────────────────┘
```

### Migration Planner

The planner queries the Knowledge Graph to build a complete migration plan:

1. **Resolve source resource** — look up the resource in KG by ID or name
2. **Discover dependencies** — use `getNeighbors(nodeId, depth=3, "both")` to find attached volumes, security groups, DNS records, load balancers, IAM roles
3. **Check compatibility** — for each resource, query the `CompatibilityMatrix` for `(sourceProvider, targetProvider, resourceType)` → returns `{ compatible, warnings[], blockers[], workarounds[] }`
4. **Generate DAG** — produce an `ExecutionPlan` with steps wired by `dependsOn` relationships

   Example for VM migration:

   ```
   [snapshot-source] → [export-image] → [transfer-image] → [convert-image] → [import-image] → [provision-vm] → [verify-boot] → [cutover]
                                                                                                       ↑
   [map-network] → [create-security-rules] ────────────────────────────────────────────────────────────┘
   ```

5. **Estimate costs** — egress from source provider + compute/storage costs at target
6. **Return plan** — with step-by-step breakdown, estimated duration, cost, and risk assessment

### Step Handler Contract

Each step implements the `StepHandler` interface from Azure orchestration:

```typescript
type StepHandler = {
  execute: (ctx: StepContext) => Promise<Record<string, unknown>>;
  rollback?: (ctx: StepContext, outputs: Record<string, unknown>) => Promise<void>;
};
```

**Every step that mutates infrastructure MUST have a `rollback` handler.** This is enforced at registration time in the step registry.

Step outputs are wired as inputs using the `${stepId}.outputs.${name}` reference pattern:
- `snapshot-source` outputs `{ snapshotId: "snap-abc123" }`
- `export-image` receives it as `params.snapshotId = "${snapshot-source}.outputs.snapshotId"`

### Integrity Verification

The `IntegrityVerifier` operates at three levels:

| Level | What | How |
|---|---|---|
| **Object-level** | Each transferred file/object | SHA-256 checksum computed at source, verified at target |
| **Volume-level** | Block volume content | SHA-256 of raw disk image before and after conversion |
| **Schema-level** | Database migrations | Table count, row count, schema DDL comparison, sample-row spot-checks |

Verification runs as a dedicated orchestration step after every transfer step. If verification fails, the engine triggers rollback automatically (following the `autoRollback: true` pattern from Azure orchestration).

---

## 5. Compute Migration Pipeline

### VM Migration Steps (AWS → Azure Example)

| Step | StepHandler | Source SDK | Target SDK | Rollback |
|---|---|---|---|---|
| 1. Snapshot source | `snapshot-source` | `CreateSnapshot` (EC2) | — | `DeleteSnapshot` |
| 2. Export to S3 | `export-image` | `CreateStoreImageTask` / `ExportImage` | — | Delete S3 export object |
| 3. Transfer to Azure Blob | `transfer-image` | S3 `GetObject` stream | `BlockBlobClient.uploadStream` | Delete target blob |
| 4. Convert format | `convert-image` | — | `qemu-img convert -f raw -O vhd` (sandboxed) | Delete converted file |
| 5. Import as Azure disk | `import-image` | — | Managed Disk from VHD URL | Delete managed disk |
| 6. Remediate boot | `boot-remediator` | — | Inject `waagent`, fix grub, remove AWS drivers | — (idempotent) |
| 7. Provision VM | `provision-vm` | — | `AzureVMManager.createVM()` | `AzureVMManager.deleteVM()` |
| 8. Verify boot | `verify-boot` | — | SSH/RDP health check, cloud-init completion | — (read-only) |
| 9. Network cutover | `cutover` | DNS TTL→60s, wait, switch | Update A/CNAME records | Revert DNS records |

### Image Format Matrix

| Source | Intermediate | Target AWS | Target Azure | Target GCP | Target On-Prem |
|---|---|---|---|---|---|
| AWS AMI | RAW (S3 export) | — | VHD | VMDK/RAW | VMDK/QCOW2 |
| Azure VHD | RAW (Blob download) | RAW (S3 import) | — | VMDK/RAW | VMDK/QCOW2 |
| GCP Disk | RAW (GCS export) | RAW (S3 import) | VHD | — | VMDK/QCOW2 |
| On-Prem VMware | VMDK → RAW | RAW (S3 import) | VHD | RAW | — |

Format conversion uses `qemu-img` executed in Espada's Docker sandbox (leveraging the existing sandboxed bash tool execution). The conversion step includes integrity verification (source checksum vs post-conversion checksum of the raw content).

### Boot Remediation

After format conversion, VMs often need driver and init-system adjustments to boot on the target cloud:

| Target | Remediation Steps |
|---|---|
| **AWS** | Install `cloud-init`, AWS EC2 drivers (ena, nvme), remove Azure/GCP agents, fix grub for Xen/Nitro |
| **Azure** | Install `walinuxagent`, Hyper-V drivers (hv_vmbus, hv_storvsc, hv_netvsc), remove AWS/GCP agents |
| **GCP** | Install `google-guest-agent`, `google-compute-engine-oslogin`, virtio drivers, remove AWS/Azure agents |
| **On-Prem** | Install appropriate hypervisor tools (VMware Tools, qemu-guest-agent), remove all cloud agents |

---

## 6. Data Migration Pipeline

### Object Storage Migration (S3 → GCS Example)

| Step | What | Parallelism |
|---|---|---|
| 1. Inventory source | List all objects with sizes, checksums, metadata | Single (paginated) |
| 2. Create target | Create GCS bucket with equivalent settings | Single |
| 3. Transfer objects | Parallel chunked transfer via streaming | Up to `maxConcurrency` (default 16) |
| 4. Verify integrity | SHA-256 per-object, total object count | Parallel |
| 5. Sync metadata | Labels, lifecycle rules, CORS, encryption | Single |

### Transfer Engine Design

| Feature | Implementation |
|---|---|
| **Streaming** | Objects streamed source→target without landing on local disk (unless > 5GB multipart) |
| **Chunking** | Objects > 100MB use multipart upload (S3 multipart, Azure block list, GCS resumable) |
| **Parallelism** | Configurable concurrency (default 16 parallel transfers) |
| **Resume** | Transfer manifest tracks `{ objectKey, sourceChecksum, status }`. Retries only pending/failed objects |
| **Bandwidth throttling** | Optional rate limit (bytes/sec) to avoid saturating network |

### Metadata Translation Matrix

| Feature | S3 | Azure Blob | GCS | Translatable? |
|---|---|---|---|---|
| Object metadata | Custom headers | Custom metadata | Custom metadata | ✅ Yes |
| Lifecycle rules | S3 lifecycle | Azure lifecycle mgmt | GCS lifecycle | ✅ Yes (structure differs) |
| Versioning | Bucket versioning | Blob versioning | Object versioning | ✅ Yes |
| Encryption | SSE-S3/SSE-KMS | Azure SSE/CMK | Google-managed/CMEK | ⚠️ Config only (keys don't transfer) |
| ACLs | S3 ACL/Bucket Policy | Container ACL/RBAC | IAM/ACL | ⚠️ Warning: semantic mismatch |
| Replication | CRR/SRR | GRS/RA-GRS/ORS | Turbo replication | ❌ Not translatable (re-configure) |
| Object Lock | Governance/Compliance | Immutability policy | Retention policy | ⚠️ Partial |

### Database Migration

| Database | Export Method | Transfer | Import Method | Verification |
|---|---|---|---|---|
| **PostgreSQL** | `pg_dump --format=custom` | Streaming via staging bucket | `pg_restore` | Row count, schema diff, sample checksums |
| **MySQL** | `mysqldump --single-transaction` | Streaming via staging bucket | `mysql < dump.sql` | Row count, schema diff, sample checksums |
| **Near-zero downtime** | Logical replication / CDC setup → sync → brief cutover | Streaming | Apply slot / binlog | Replication lag < threshold |

---

## 7. Network Migration Pipeline

### NormalizedSecurityRule (Canonical Form)

| Field | Description |
|---|---|
| `direction` | `"inbound" \| "outbound"` |
| `action` | `"allow" \| "deny"` |
| `protocol` | `"tcp" \| "udp" \| "icmp" \| "*"` |
| `portRange` | `{ from: number, to: number }` |
| `source` | `{ type: "cidr" \| "security-group" \| "tag" \| "service-tag", value: string }` |
| `destination` | Same as source |
| `priority` | `number` (normalized to 100–4096 range) |

### Translation Challenges

| Source Concept | Translatable? | Strategy |
|---|---|---|
| AWS Security Group (stateful) → Azure NSG (stateful) | ✅ Yes | Direct mapping |
| AWS Security Group → GCP Firewall (stateful) | ⚠️ Partial | GCP uses network tags not SG references |
| AWS SG self-referencing → Azure/GCP | ⚠️ Warning | Requires CIDR approximation or target SG ID |
| Azure ASG (Application Security Group) → AWS/GCP | ❌ No direct equivalent | Expand to CIDR |
| GCP network tags → AWS/Azure | ❌ No direct equivalent | Map to SG membership |
| AWS prefix lists → Azure/GCP | ⚠️ Partial | Expand to CIDR ranges |

### TranslationReport Output

The `rule-translator.ts` produces a `TranslationReport` with:

- **`translatedRules[]`** — rules that mapped cleanly
- **`warnings[]`** — rules that required approximation
- **`untranslatable[]`** — rules that have no equivalent (user must manually configure)
- **`semanticDiff`** — side-by-side comparison of effective policy

---

## 8. Knowledge Graph Integration

### Pre-Migration (Dependency Analysis)

- Queries `kg_blast_radius` for the source resource
- Uses `kg_dependencies` to find all resources that must co-migrate
- Uses `kg_path` to trace data flow paths that cross migration boundaries
- Feeds results into the `MigrationPlanner` to generate a complete plan

### During Migration (State Tracking)

- Registers a `MigrationGraphAdapter` (implementing `GraphDiscoveryAdapter`) that exposes migration jobs as graph nodes
- Migration jobs connect to both source and target resource nodes via `"migrating-from"` / `"migrating-to"` edges
- Step progress is reflected in node metadata

### Post-Migration (Graph Update)

- **Source resource node**: status → `"decommissioned"` or `"migrated"`, metadata gains `migratedTo: <targetId>`
- **Target resource node**: created with full metadata, linked to original via `"migrated-from"` edge
- **Cross-cloud edges**: updated to reflect new topology
- **Incremental sync**: triggers KG sync to update dependency graph

---

## 9. Governance & Safety

### Approval Gates

Integrating with the existing `ExecApprovalManager`:

| Gate | When | Required For |
|---|---|---|
| **Plan approval** | After plan generation, before execution | All migrations |
| **Cutover approval** | After target verified, before DNS/LB switch | Production workloads |
| **Decommission approval** | After successful cutover + soak period | Source resource deletion |

### Policy Checks (OPA Integration)

| Policy | Description |
|---|---|
| `migration.source.region.allowed` | Can resources leave this region? |
| `migration.target.provider.allowed` | Is the target provider approved? |
| `migration.cost.max` | Maximum allowed migration cost |
| `migration.window.allowed` | Must migration happen in a maintenance window? |
| `migration.data.classification` | Can data with this classification level leave this cloud? |

### Audit Logging

Structured, cryptographically chained, every action:

```typescript
type MigrationAuditEntry = {
  timestamp: string;
  jobId: string;
  stepId: string;
  action: "plan" | "approve" | "execute" | "verify" | "rollback" | "cutover" | "decommission";
  actor: string;          // user or agent ID
  provider: MigrationProvider;
  resourceId: string;
  outcome: "success" | "failure" | "skipped";
  details: Record<string, unknown>;
  integrityHash: string;  // SHA-256 chain linking to previous entry
};
```

---

## 10. Agent Tools

Registered via `api.registerTool()` following the existing naming convention (`<domain>_<action>`):

| Tool | Purpose | Parameters |
|---|---|---|
| `migration_assess` | Compatibility/cost/dependency assessment | `{ sourceResourceId, targetProvider, targetRegion }` |
| `migration_plan` | Generate a full migration ExecutionPlan | `{ sourceResourceIds[], targetProvider, targetRegion, options }` |
| `migration_execute` | Execute an approved plan | `{ planId }` |
| `migration_status` | Get current status of a migration job | `{ jobId }` |
| `migration_verify` | Run integrity verification on a completed migration | `{ jobId }` |
| `migration_rollback` | Rollback a failed or in-progress migration | `{ jobId }` |
| `migration_cutover` | Execute DNS/LB cutover for a verified migration | `{ jobId }` |
| `migration_history` | List past migrations with outcomes | `{ limit?, provider?, status? }` |
| `migration_compatibility` | Query the compatibility matrix | `{ sourceProvider, targetProvider, resourceType }` |
| `migration_estimate_cost` | Estimate migration cost without creating a plan | `{ sourceResourceIds[], targetProvider, targetRegion }` |

---

## 11. Gateway API Methods

Registered via `api.registerGateway()`:

| Method | Purpose |
|---|---|
| `migration/assess` | REST-accessible assessment |
| `migration/plan` | Plan creation |
| `migration/plan/approve` | Submit approval for a plan |
| `migration/execute` | Start execution |
| `migration/status` | Job status by ID |
| `migration/jobs` | List all jobs (filterable) |
| `migration/rollback` | Trigger rollback |
| `migration/cutover` | Trigger cutover |
| `migration/verify` | Run verification |
| `migration/compatibility` | Query compatibility matrix |
| `migration/diagnostics/reset` | Reset diagnostics counters (required by extension contract) |
| `migration/status` (operational) | Extension health status (required by extension contract) |

---

## 12. CLI Commands

| Command | Description |
|---|---|
| `espada migration assess <resourceId> --to <provider> --region <region>` | Run assessment |
| `espada migration plan <resourceId> --to <provider> --region <region>` | Generate plan |
| `espada migration execute <planId> [--dry-run]` | Execute plan |
| `espada migration status <jobId>` | Check status |
| `espada migration list [--status <status>]` | List jobs |
| `espada migration rollback <jobId>` | Rollback |
| `espada migration verify <jobId>` | Verify integrity |
| `espada migration cutover <jobId>` | DNS/LB cutover |
| `espada migration compatibility` | Show full compatibility matrix |

---

## 13. Cross-Provider Credential Flow

The migration engine needs credentials for **both** source and target providers simultaneously:

```
MigrationEngine
  ├── sourceCredentials: AwsCredentialsManager | AzureCredentialsManager | GcpCredentials
  └── targetCredentials: AwsCredentialsManager | AzureCredentialsManager | GcpCredentials
```

These are obtained from the respective cloud extension's `PluginState` via Espada's cross-extension service registry. The migration extension declares dependencies on `aws`, `azure`, and `gcp` in `espada.plugin.json`.

For on-premises targets, a new `OnPremCredentials` type wraps SSH keys or VMware vCenter credentials.

---

## 14. Resilience Patterns

| Pattern | Implementation |
|---|---|
| **Circuit breakers** | `createProviderBreakerRegistry({ prefix: "migration" })` with per-service scoping (e.g., `migration:aws:s3`, `migration:azure:blob`) |
| **Retry** | Provider-specific: `withRetry` (AWS), `withAzureRetry`, `withGcpRetry` — reused from existing extensions |
| **Idempotency** | Every step stores its output in the migration job record. Re-execution skips completed steps (resume semantics) |
| **Timeouts** | Per-step timeout (default 10 min for transfers, 2 min for API calls), global job timeout (configurable, default 4 hours) |
| **Transfer resume** | Object transfer manifest tracks per-object status. Partial transfers resume from last verified object |
| **Rollback** | Auto-rollback in reverse topological order (from Azure orchestration pattern). Every mutating step has a `rollback()` handler |
| **Concurrency** | `maxConcurrency: 4` for orchestration steps (from Azure defaults), `maxConcurrency: 16` for object transfers |

---

## 15. Verification Strategy

| Test Type | What | Files |
|---|---|---|
| **Unit** | Normalizers, compatibility matrix, rule translator, cost estimator, integrity verifier | `__tests__/*.test.ts` |
| **Integration** | Step handlers against mock cloud APIs | `__tests__/steps/*.test.ts` |
| **E2E** | Full migration flows across real cloud accounts | `__tests__/e2e/*.e2e.test.ts` |
| **Contract** | Validates extension conforms to `cloud-extensions-contract` | `cloud-extensions-contract.test.ts` (extend existing) |
| **Integrity** | Verify checksums survive format conversion, transfer, import | `__tests__/integrity-verifier.test.ts` |
| **Fuzz** | Random resource configs through normalizer + translator | `__tests__/fuzz/*.fuzz.test.ts` |

---

## 16. Implementation Phases

```
Phase 1 — Assessment (4–6 weeks)
  ├── migration_assess, migration_compatibility, migration_estimate_cost
  ├── KG integration for dependency analysis
  ├── Compatibility matrix (all 12 directions × all resource types)
  └── Cost estimation engine

Phase 2 — Data Migration (6–8 weeks)
  ├── Object storage transfer engine (S3 ↔ Blob ↔ GCS)
  ├── Integrity verifier (SHA-256 per-object)
  ├── Transfer resume support
  ├── Metadata translation
  └── CLI + gateway + agent tools for data migration

Phase 3 — VM Migration (8–12 weeks)
  ├── Image export/convert/import pipeline
  ├── Compute normalizer (EC2/VM/GCE → NormalizedVM)
  ├── Boot remediator (driver/agent injection)
  ├── Sandbox integration for qemu-img
  └── End-to-end VM migration with rollback

Phase 4 — Network Migration (4–6 weeks)
  ├── Security rule translator (SG/NSG/Firewall → NormalizedSecurityRule)
  ├── DNS migrator (Route53/AzureDNS/CloudDNS)
  ├── Cutover orchestration (TTL management, LB re-pointing)
  └── Post-migration connectivity verification

Phase 5 — On-Premises (12+ weeks)
  ├── On-prem agent (discovery + export from VMware/KVM/Hyper-V)
  ├── Streaming block-level replication for near-zero downtime
  ├── VPN/direct-connect automation for the transfer path
  └── On-prem → cloud and cloud → on-prem flows

Phase 6 — Database Migration (8–10 weeks)
  ├── PostgreSQL migrator (pg_dump → transfer → pg_restore)
  ├── MySQL migrator (mysqldump → transfer → import)
  ├── Schema comparator (post-migration validation)
  └── CDC-based near-zero-downtime migration
```

### Phase Dependencies

```
Phase 1 (Assessment)
    │
    ├──► Phase 2 (Data) ──────► Phase 6 (Database)
    │        │
    │        ▼
    ├──► Phase 3 (VM) ────────► Phase 5 (On-Prem)
    │
    └──► Phase 4 (Network)
```

---

## 17. Key Design Decisions

| Decision | Chose | Over | Rationale |
|---|---|---|---|
| Orchestration model | Reuse Azure `Orchestrator` DAG pattern | Custom state machine | Battle-tested in codebase, supports rollback, concurrency, events |
| Image conversion | `qemu-img` in Docker sandbox | Cloud-native import/export only | Universal format support, works for on-prem, avoids vendor lock-in |
| Transfer method | Streaming (source→target, no local disk) | Download-then-upload | Avoids requiring disk space equal to dataset size on the control plane |
| Integrity model | "Verified" (SHA-256 per-resource) | "Lossless" (bit-perfect guarantee) | Honest framing; lossless is unprovable for semantic translations (IAM, network rules) |
| Credential model | Reuse existing extension credential managers | Separate credential store | Less duplication, leverages existing auth profiles and rotation |
| Approval model | Mandatory `ExecApprovalManager` gates | Optional approvals | Enterprise requirement — destructive cross-cloud operations must be gated |
| Network rules | Best-effort + explicit diff report | Reject if not 1:1 translatable | Practical — perfect translation is impossible, transparency is better than rejection |
| State storage | In-memory + file (matches current gateway pattern) | Database-backed | Ship faster; upgrade to persistent storage when gateway persistence gap is addressed |
| On-prem support | Phase 5 (deferred) | Phase 1 | On-prem requires agent infrastructure; cloud-to-cloud delivers value sooner |
