# Cross-Cloud Migration Engine — System Design

> **Module:** `extensions/cloud-migration/`
> **Version:** 1.1.0
> **Platform:** Espada (extensible AI-agent runtime)
> **Codebase:** ~14,200 LOC across 59 implementation files, 16 test files (262 tests)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Supported Migration Directions](#3-supported-migration-directions)
4. [Type System & Data Model](#4-type-system--data-model)
5. [Core Orchestration Engine](#5-core-orchestration-engine)
6. [Migration Pipelines](#6-migration-pipelines)
7. [Provider Adapter Layer](#7-provider-adapter-layer)
8. [Object Transfer Engine](#8-object-transfer-engine)
9. [Database Migration](#9-database-migration)
10. [Governance & Compliance](#10-governance--compliance)
11. [Graph & Dependency Analysis](#11-graph--dependency-analysis)
12. [Integrity Verification](#12-integrity-verification)
13. [Cost Estimation](#13-cost-estimation)
14. [Compatibility Matrix](#14-compatibility-matrix)
15. [Extension Interface](#15-extension-interface)
16. [State Management & Lifecycle](#16-state-management--lifecycle)
17. [Data Flow Walkthrough](#17-data-flow-walkthrough)
18. [Current Implementation Status](#18-current-implementation-status)
19. [Known Gaps & Future Work](#19-known-gaps--future-work)

---

## 1. Executive Summary

The Cross-Cloud Migration Engine is an Espada extension that provides a **DAG-based orchestration framework** for migrating virtual machines, object storage, databases, DNS records, and network security rules between AWS, Azure, GCP, and on-premises environments.

The engine follows a **pipeline architecture** with 4 independent pipelines (compute, data, network, governance) decomposed into 24 step types. Each step is a pluggable handler registered at service startup. Steps are wired into directed acyclic graphs (DAGs) by the migration planner, then executed with concurrency control, topological ordering, output chaining, timeout enforcement, and automatic reverse-order rollback on failure.

A **provider adapter layer** abstracts the 3 major cloud providers behind a unified interface (`CloudProviderAdapter`) with sub-adapters for compute, storage, DNS, and network operations. The adapters delegate to the existing Espada cloud extensions (`extensions/aws/`, `extensions/azure/`, `extensions/gcp/`) which contain real SDK integrations.

### Key Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Pipeline separation** | Compute, data, network, and governance are independent pipelines with explicit dependencies |
| **DAG orchestration** | Steps declare `dependsOn` edges; engine sorts topologically and executes in parallel layers |
| **Provider abstraction** | `CloudProviderAdapter` interface decouples step handlers from SDK specifics |
| **Graceful degradation** | Every step handler falls back to stub behavior when credentials are unavailable |
| **Cryptographic auditability** | Hash-chained audit log (SHA-256) with genesis anchoring |
| **Policy-gated execution** | Configurable policy engine with blockers and approval gates |
| **Normalized resource model** | All resources (VMs, buckets, DNS records, security rules) normalized to provider-agnostic types |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Espada Platform                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Agent    │  │ Gateway  │  │ CLI      │  │ Knowledge Graph    │  │
│  │ Tools(10)│  │ API (14) │  │ Cmds(12) │  │ Adapter            │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬───────────┘  │
│       │              │              │                 │              │
│  ┌────▼──────────────▼──────────────▼─────────────────▼───────────┐ │
│  │                Migration Engine (Core)                         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │ │
│  │  │  Planner │  │  DAG     │  │ Cost     │  │ Compatibility │  │ │
│  │  │          │  │ Executor │  │ Estimator│  │ Matrix (84)   │  │ │
│  │  └────┬─────┘  └────┬─────┘  └──────────┘  └──────────────┘  │ │
│  │       │              │                                         │ │
│  │  ┌────▼──────────────▼────────────────────────────────────┐   │ │
│  │  │              Step Handler Registry                     │   │ │
│  │  │  21 registered handlers (8 compute + 5 data + 4 db + 4 net) │ │
│  │  └──┬──────────────┬──────────────┬───────────────────────┘   │ │
│  │     │              │              │                            │ │
│  │  ┌──▼────┐   ┌─────▼────┐  ┌─────▼─────┐  ┌──────────────┐  │ │
│  │  │Compute│   │  Data    │  │  Network  │  │  Governance  │  │ │
│  │  │Pipe(8)│   │ Pipe (5) │  │ Pipe  (4) │  │  (Audit,     │  │ │
│  │  │       │   │          │  │           │  │   Policy,     │  │ │
│  │  │       │   │          │  │           │  │   Approval,   │  │ │
│  │  │       │   │          │  │           │  │   Rollback)   │  │ │
│  │  └──┬────┘   └────┬─────┘  └─────┬─────┘  └──────────────┘  │ │
│  │     │              │              │                            │ │
│  └─────┼──────────────┼──────────────┼────────────────────────────┘ │
│        │              │              │                               │
│  ┌─────▼──────────────▼──────────────▼────────────────────────────┐ │
│  │                Provider Adapter Layer                          │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────┐             │ │
│  │  │   AWS    │  │    Azure     │  │     GCP      │             │ │
│  │  │ Adapter  │  │   Adapter    │  │   Adapter    │             │ │
│  │  │ (843 L)  │  │   (970 L)    │  │  (1021 L)    │             │ │
│  │  └────┬─────┘  └──────┬───────┘  └──────┬───────┘             │ │
│  │       │                │                  │                     │ │
│  └───────┼────────────────┼──────────────────┼─────────────────────┘ │
│          │                │                  │                       │
│  ┌───────▼────┐  ┌───────▼───────┐  ┌───────▼──────┐               │
│  │ ext/aws    │  │  ext/azure    │  │  ext/gcp     │               │
│  │ EC2, S3,   │  │  VM, Storage, │  │  Compute,    │               │
│  │ Route53,   │  │  DNS, Network │  │  Storage,    │               │
│  │ VPC Mgrs   │  │  Managers     │  │  DNS, Net    │               │
│  │ (@aws-sdk) │  │ (@azure/*)    │  │  (REST API)  │               │
│  └────────────┘  └───────────────┘  └──────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

### Module Decomposition

| Module | Path | Files | LOC | Purpose |
|--------|------|-------|-----|---------|
| **Core** | `src/core/` | 5 | ~2,458 | DAG engine, planner, cost estimator, compatibility, integrity |
| **Compute** | `src/compute/` | 11 | ~1,968 | VM migration pipeline steps + normalizer + remediation |
| **Data** | `src/data/` | 9 | ~1,635 | Object storage + database migration + transfer engine |
| **Network** | `src/network/` | 6 | ~1,104 | VPC mapping, security rule translation, DNS migration |
| **Providers** | `src/providers/` | 5 | ~3,503 | Adapter layer wrapping cloud SDK managers |
| **Governance** | `src/governance/` | 4 | ~857 | Audit, policy, approval gates, rollback coordination |
| **Graph** | `src/graph/` | 3 | ~676 | Dependency analysis, knowledge graph integration, lineage |
| **Interface** | `src/` (root) | 7 | ~3,024 | Types, state, lifecycle, tools, gateway, CLI, entry point |
| **Tests** | `__tests__/` | 14 | ~3,200 | Unit + integration tests |

---

## 3. Supported Migration Directions

The engine supports **12 cloud-to-cloud directions** across 3 major providers plus 6 on-premises directions (type-defined, adapter pending):

```
        ┌────────────┐
        │    AWS     │
        └──┬───┬──┬──┘
     ╱     │   │  │     ╲
    ╱      │   │  │      ╲
   ▼       │   │  │       ▼
┌──────┐   │   │  │    ┌──────┐
│Azure │◄──┘   │  └───►│ GCP  │
└──┬───┘       │       └──┬───┘
   │           │          │
   └───────────┼──────────┘
               │
         ┌─────▼─────┐
         │On-Premises │  (types defined,
         │ VMware     │   adapter not yet
         │ KVM        │   implemented)
         │ Hyper-V    │
         │ Nutanix    │
         └────────────┘
```

### Migration Matrix by Resource Type

| Direction | VMs | Object Storage | DNS | Security Rules | Databases |
|-----------|-----|---------------|-----|----------------|-----------|
| AWS → GCP | ✅ Real SDK | ✅ Real SDK | ✅ Real SDK | ✅ Real SDK | ⚠️ Schema only |
| AWS → Azure | ✅ Real SDK | ⚠️ Azure blob stubs | ✅ Real SDK | ✅ Real SDK | ⚠️ Schema only |
| GCP → AWS | ✅ Real SDK | ✅ Real SDK | ✅ Real SDK | ✅ Real SDK | ⚠️ Schema only |
| GCP → Azure | ✅ Real SDK | ⚠️ Azure blob stubs | ✅ Real SDK | ✅ Real SDK | ⚠️ Schema only |
| Azure → AWS | ⚠️ Partial | ⚠️ Azure blob stubs | ✅ Real SDK | ✅ Real SDK | ⚠️ Schema only |
| Azure → GCP | ⚠️ Partial | ⚠️ Azure blob stubs | ✅ Real SDK | ✅ Real SDK | ⚠️ Schema only |
| Cloud → On-Prem | ❌ Not implemented | ❌ | ❌ | ❌ | ❌ |
| On-Prem → Cloud | ❌ Not implemented | ❌ | ❌ | ❌ | ❌ |

**Legend:** ✅ Real SDK calls via provider adapter | ⚠️ Partially implemented or stubbed | ❌ Not yet implemented

---

## 4. Type System & Data Model

### Provider & Resource Types

```typescript
type MigrationProvider = "aws" | "azure" | "gcp" | "on-premises" | "vmware" | "nutanix";
type MigrationResourceType = "vm" | "disk" | "object-storage" | "database"
                            | "dns" | "security-rules" | "load-balancer";
```

### Migration Job Lifecycle (State Machine)

```
  created ──► assessing ──► planning ──► awaiting-approval ──► executing
                                                                   │
                             ┌─────────────────────────────────────┘
                             ▼
                         verifying ──► cutting-over ──► completed
                             │              │
                             ▼              ▼
                        rolling-back   rolling-back
                             │
                             ▼
                           failed
```

All phases can also transition directly to `failed`. Phase transitions are validated against a `MIGRATION_PHASE_TRANSITIONS` allowlist — invalid transitions throw.

### Normalized Resource Model

All cloud resources are normalized to provider-agnostic types before migration planning:

```typescript
// Virtual Machines
type NormalizedVM = {
  id: string; name: string;
  provider: MigrationProvider; region: string; zone?: string;
  cpuCores: number; memoryGB: number;
  osType: "linux" | "windows" | "unknown";
  architecture: "x86_64" | "arm64";
  disks: NormalizedDisk[];
  networkInterfaces: NormalizedNetworkInterface[];
  tags: Record<string, string>;
};

// Object Storage
type NormalizedBucket = {
  id: string; name: string;
  provider: MigrationProvider; region: string;
  objectCount: number; totalSizeBytes: number;
  versioning: boolean;
  encryption: BucketEncryption;
  lifecycleRules: LifecycleRule[];
  tags: Record<string, string>;
};

// Security Rules (provider-agnostic)
type NormalizedSecurityRule = {
  id: string; name: string;
  direction: "inbound" | "outbound";
  action: "allow" | "deny";
  protocol: "tcp" | "udp" | "icmp" | "*";
  portRange: { from: number; to: number };
  source: SecurityEndpoint;      // { type: "cidr"|"security-group"|"tag"|"any", value }
  destination: SecurityEndpoint;
  priority: number;
};

// DNS Records
type NormalizedDNSRecord = {
  name: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "PTR";
  ttl: number;
  values: string[];
};
```

### Image Format Matrix

| Source | → AWS | → Azure | → GCP | → On-Prem |
|--------|-------|---------|-------|-----------|
| **AWS** | — | VHD | RAW | VMDK |
| **Azure** | RAW | — | RAW | VMDK |
| **GCP** | RAW | VHD | — | VMDK |
| **On-Prem** | RAW | VHD | RAW | — |

Intermediate format is always RAW. Conversion is handled by the `convert-image` step using `qemu-img`.

### Storage Class Mapping

```
AWS STANDARD         ↔  Azure Hot       ↔  GCP STANDARD
AWS STANDARD_IA      ↔  Azure Cool      ↔  GCP NEARLINE
AWS GLACIER          ↔  Azure Archive   ↔  GCP COLDLINE
AWS GLACIER_DEEP     ↔  Azure Archive   ↔  GCP ARCHIVE
AWS INTELLIGENT_TIER ↔  Azure Hot       ↔  GCP STANDARD
```

---

## 5. Core Orchestration Engine

**File:** `src/core/migration-engine.ts` (687 lines)

The engine is the central coordinator. It owns job lifecycle, step handler registration, DAG execution, output resolution, and rollback orchestration.

### Step Handler Registration

```typescript
registerStepHandler(
  type: MigrationStepType,
  handler: MigrationStepHandler,
  requiresRollback: boolean
): void
```

At service startup (`lifecycle.ts`), all 17 step handlers are registered. Handlers that create mutable cloud resources (`snapshot-source`, `export-image`, `import-image`, `provision-vm`, `cutover`, `create-target`, `create-security-rules`, `migrate-dns`) **must** provide a `rollback()` function — the engine enforces this at registration time.

### DAG Execution Flow

```
                   ┌────────────────────────────────┐
                   │  executePlan(plan, options)     │
                   └───────────┬────────────────────┘
                               │
                   ┌───────────▼────────────────────┐
                   │  topologicalSort(plan.steps)    │
                   │  → Step[][] (parallel layers)   │
                   └───────────┬────────────────────┘
                               │
              ┌────────────────▼────────────────────────┐
              │  For each layer:                        │
              │    For each chunk (maxConcurrency = 4): │
              │      Promise.allSettled(chunk)          │
              │        │                                │
              │  ┌─────▼────────────────────────┐      │
              │  │  resolveOutputRefs(params)    │      │
              │  │  → Replace ${step.outputs.X}  │      │
              │  │    with resolved values        │      │
              │  └─────┬────────────────────────┘      │
              │        │                                │
              │  ┌─────▼────────────────────────┐      │
              │  │  executeStep(step, handler)   │      │
              │  │  → Promise.race([exec, timeout])│    │
              │  └─────┬────────────────────────┘      │
              │        │                                │
              │  ┌─────▼────────────────────────┐      │
              │  │  Store outputs in             │      │
              │  │  execState.resolvedOutputs    │      │
              │  └──────────────────────────────┘      │
              └─────────────────────────────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Any step failed?    │
                    │  + failFast=true?    │
                    └──┬───────────┬───────┘
                   Yes │           │ No
                ┌──────▼──────┐   │
                │ autoRollback│   │
                │ = true?     │   │
                └──┬──────────┘   │
                   │              │
            ┌──────▼──────────┐   │
            │ rollbackSteps() │   │
            │ (reverse topo   │   │
            │  order)         │   │
            └─────────────────┘   │
                                  ▼
                          Return result
```

### Topological Sort

Uses **Kahn's algorithm**:
1. Build in-degree map and adjacency list from `step.dependsOn` edges
2. Seed queue with zero-dependency nodes
3. Peel off layer by layer — each layer contains steps that can execute in parallel
4. Detect cycles (if processed count ≠ total count, throw `DAG cycle detected`)

Returns `MigrationStep[][]` — an array of parallel-executable layers.

### Output Resolution (Cross-Step Data Flow)

Steps can reference outputs of predecessor steps via `${stepId}.outputs.propertyName`:

```typescript
// Example: transfer-image step references the export-image output
{
  type: "transfer-image",
  params: {
    exportPath: "${export-image-vm1.outputs.exportPath}",
    format: "${export-image-vm1.outputs.format}",
  },
  dependsOn: ["export-image-vm1"],
}
```

Before execution, `resolveOutputRefs()` walks the params tree and replaces all `${...}` references with concrete values from `execState.resolvedOutputs`.

### Rollback Strategy

On failure with `autoRollback: true` (default):
1. Collect all **completed** steps
2. Sort them in **reverse topological order**
3. For each step with a rollback handler, call `handler.rollback(ctx, previousOutputs)`
4. Individual rollback failures are logged but do not abort other rollbacks
5. Final result includes `rollbackResults` with per-step success/failure

### Configuration Options

```typescript
interface MigrationOrchestrationOptions {
  maxConcurrency: number;    // Default: 4
  failFast: boolean;         // Default: true
  dryRun: boolean;           // Default: false
  autoRollback: boolean;     // Default: true
  sourceCredentials?: ProviderCredentialConfig;
  targetCredentials?: ProviderCredentialConfig;
  signal?: AbortSignal;
}
```

---

## 6. Migration Pipelines

**File:** `src/core/migration-planner.ts` (694 lines)

The planner decomposes a migration request into 4 parallel pipelines, each producing a chain of steps with explicit dependencies.

### 6.1 Compute Pipeline (Per VM — 8 Steps)

```
snapshot-source ──► export-image ──► transfer-image ──► convert-image
                                                             │
                                                             ▼
                                                        import-image
                                                             │
                                                             ▼
                                                        remediate-boot
                                                             │
                                                             ▼
                                                         provision-vm
                                                             │
                                                             ▼
                                                         verify-boot
```

| Step | Purpose | Rollback |
|------|---------|----------|
| `snapshot-source` | Create disk snapshots of source VM volumes | Delete snapshots |
| `export-image` | Export snapshot to provider's staging storage (S3/Blob/GCS) | Delete staging object |
| `transfer-image` | Download from source storage, upload to target storage | — |
| `convert-image` | Convert image format (raw↔vhd↔vmdk) via `qemu-img` | — |
| `import-image` | Register image on target provider (AMI/Managed Disk/Image) | Deregister image |
| `remediate-boot` | Apply boot fixes for target hypervisor (drivers, GRUB, fstab) | — |
| `provision-vm` | Launch new VM from imported image on target | Terminate instance |
| `verify-boot` | Poll instance status, verify OS boot and agent health | — |

### 6.2 Data Pipeline (Per Bucket — 5 Steps)

```
inventory-source ──► create-target ──► transfer-objects ──► verify-integrity ──► sync-metadata
```

| Step | Purpose | Rollback |
|------|---------|----------|
| `inventory-source` | Paginate source objects, build inventory (by class/prefix/ext) | — |
| `create-target` | Create target bucket with matching config (class, versioning, tags) | Delete bucket |
| `transfer-objects` | Parallel object transfer via transfer engine | — |
| `verify-integrity` | Compare source vs target (count, size, checksums) | — |
| `sync-metadata` | Apply versioning, tags, lifecycle rules to target | — |

### 6.3 Network Pipeline (4 Steps)

```
map-network ──► create-security-rules
                        │
                        ▼
                   migrate-dns ──► verify-connectivity
```

| Step | Purpose | Rollback |
|------|---------|----------|
| `map-network` | Discover VPCs, subnets, route tables from source | — |
| `create-security-rules` | Translate and create security groups/NSGs on target | Delete created groups |
| `migrate-dns` | Create DNS zones and records on target provider | Delete zone |
| `verify-connectivity` | Check instance reachability, DNS resolution, port access | — |

### 6.4 Cross-Cutting: Cutover

The `cutover` step depends on **all** verify steps across all pipelines. It performs:
1. Update DNS records to point to target instances
2. Optionally stop source instances
3. Return final cutover status with timestamp

### 6.5 Database Pipeline (Defined, Not Yet Registered)

4 step types are defined in the type system but do **not** have registered handlers:

```
export-database ──► transfer-database ──► import-database ──► verify-schema
```

The schema comparison and dump command generation modules exist (`pg-migrator.ts`, `mysql-migrator.ts`, `schema-comparator.ts`) but step handler wiring is pending.

---

## 7. Provider Adapter Layer

**Files:** `src/providers/types.ts` (503 lines), `src/providers/registry.ts` (166 lines), `src/providers/{aws,azure,gcp}-adapter.ts` (~2,834 lines combined)

### Interface Hierarchy

```typescript
interface CloudProviderAdapter {
  readonly provider: MigrationProvider;
  readonly compute: ComputeAdapter;   // 12 methods
  readonly storage: StorageAdapter;   // 11 methods
  readonly dns: DNSAdapter;           // 7 methods
  readonly network: NetworkAdapter;   // 7 methods
  healthCheck(): Promise<ProviderHealthResult>;
}
```

### Sub-Adapter Method Summary

```
ComputeAdapter (12 methods)
├── listVMs(region, opts?)
├── getVM(vmId, region)
├── createSnapshot(params)        → SnapshotOutput
├── deleteSnapshot(id, region)
├── exportImage(params)           → ExportImageOutput
├── importImage(params)           → ImportImageOutput
├── deleteImage(id, region)
├── provisionVM(params)           → ProvisionVMOutput
├── getInstanceStatus(id, region) → InstanceStatusOutput
├── stopInstance(id, region)
└── terminateInstance(id, region)

StorageAdapter (11 methods)
├── listBuckets(region?)
├── getBucket(name)
├── createBucket(params)          → CreateBucketOutput
├── deleteBucket(name, region?)
├── listObjects(bucket, opts?)    → ListObjectsOutput
├── getObjectUrl(bucket, key)
├── getObject(bucket, key)        → ObjectDataOutput
├── putObject(bucket, key, data)  → PutObjectOutput
├── deleteObject(bucket, key)
├── setBucketVersioning(bucket, enabled)
└── setBucketTags(bucket, tags)

DNSAdapter (7 methods)
├── listZones()
├── getZone(id)
├── createZone(params)            → DNSZoneInfo
├── deleteZone(id)
├── listRecords(zoneId)
├── createRecord(zoneId, record)
├── updateRecord(zoneId, record)
└── deleteRecord(zoneId, name, type)

NetworkAdapter (7 methods)
├── listVPCs(region?)
├── listSubnets(vpcId?, region?)
├── listSecurityGroups(region?)
├── createSecurityGroup(params)   → SecurityGroupInfo
├── deleteSecurityGroup(id)
├── addSecurityRules(groupId, rules)
└── listLoadBalancers(region?)
```

### Provider Registry

```
ProviderRegistry (Singleton)
├── resolveAdapter(provider, credentials) → CloudProviderAdapter
│   Caches by (provider, credential-hash)
│   Lazy-imports provider-specific adapter module
├── isSupported(provider) → boolean
│   true for aws, azure, gcp
│   false for on-premises, vmware, nutanix
├── clear()
└── size → number
```

### Adapter Credential Flow

```
Step Handler
    │
    ├── ctx.sourceCredentials / ctx.targetCredentials
    │
    ▼
resolveProviderAdapter(provider, credentials)
    │
    ├── ProviderRegistry.resolveAdapter()
    │       │
    │       ├── Cache hit? → return cached adapter
    │       │
    │       ├── aws: import("./aws-adapter.js")
    │       │       └── createAWSAdapter(config)
    │       │             └── AWSProviderAdapter
    │       │                   ├── lazy getEC2Manager()     → EC2Manager from ext/aws
    │       │                   ├── lazy getS3Manager()      → S3Manager from ext/aws
    │       │                   ├── lazy getRoute53Manager() → Route53Manager from ext/aws
    │       │                   └── lazy getCredentialsManager()
    │       │
    │       ├── azure: import("./azure-adapter.js")
    │       │       └── createAzureAdapter(config)
    │       │             └── AzureProviderAdapter
    │       │                   ├── lazy getVMManager()      → AzureVMManager from ext/azure
    │       │                   ├── lazy getStorageManager() → AzureStorageManager from ext/azure
    │       │                   ├── lazy getDNSManager()     → AzureDNSManager from ext/azure
    │       │                   └── lazy getCredentialsManager()
    │       │
    │       └── gcp: import("./gcp-adapter.js")
    │               └── createGCPAdapter(config)
    │                     └── GCPProviderAdapter
    │                           ├── lazy getComputeManager()  → GcpComputeManager from ext/gcp
    │                           ├── lazy getStorageManager()  → GcpStorageManager from ext/gcp
    │                           ├── lazy getDNSManager()      → GcpDNSManager from ext/gcp
    │                           └── lazy getCredentialsManager()
    │
    └── adapter.compute.* / adapter.storage.* / adapter.dns.* / adapter.network.*
```

### Dual-Path Execution Pattern

Every step handler implements a dual-path pattern for graceful degradation:

```typescript
async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const credentials = ctx.sourceCredentials as ProviderCredentialConfig | undefined;

  if (credentials) {
    // REAL PATH: Resolve adapter, call cloud SDK
    const adapter = await resolveProviderAdapter(provider, credentials);
    const result = await adapter.compute.createSnapshot(params);
    return result;
  }

  // FALLBACK PATH: Return stub data (for tests, dry runs, offline scenarios)
  return { snapshotId: `snap-stub-${Date.now()}`, ... };
}
```

This ensures all 217 tests pass without cloud credentials while enabling real SDK operations in production.

---

## 8. Object Transfer Engine

**File:** `src/data/transfer-engine.ts` (373 lines)

The transfer engine handles bulk object migration between storage providers with concurrency control and retry logic.

### Architecture

```
createObjectTransfer(config, options)
    │
    ├── options.sourceAdapter && options.targetAdapter?
    │       │
    │       ├── Yes → startRealTransfer()
    │       │         │
    │       │         ├── Phase 1: Inventory
    │       │         │   paginate listObjects() on source
    │       │         │   apply excludePatterns
    │       │         │
    │       │         ├── Phase 2: Transfer (batched)
    │       │         │   for each batch (concurrency = N):
    │       │         │     Promise.allSettled(batch.map(obj =>
    │       │         │       source.getObject(bucket, key)       // Download
    │       │         │       → target.putObject(bucket, key, data) // Upload
    │       │         │       retry up to maxRetries (exp backoff)
    │       │         │     ))
    │       │         │
    │       │         └── Phase 3: Verify
    │       │             build TransferManifest + IntegrityReport
    │       │
    │       └── No → startStubTransfer()
    │                 (empty results for offline/test mode)
    │
    └── Returns { taskId, start(), getProgress() }
```

### Transfer Configuration

```typescript
interface ObjectTransferConfig {
  sourceBucket: string;         targetBucket: string;
  sourceProvider: string;       targetProvider: string;
  sourceRegion: string;         targetRegion: string;
  concurrency: number;          // Parallel transfers (default: 16)
  chunkSizeMB: number;          // Unused currently (no multi-part)
  prefixFilter?: string;        // Only transfer matching prefix
  excludePatterns?: string[];   // Skip matching keys
  storageClassMapping?: Record<string, string>;
  metadataPreserve: boolean;
  aclPreserve: boolean;
  encryptionConfig?: { sourceKmsKeyId?: string; targetKmsKeyId?: string };
}
```

### Transfer Progress Tracking

```typescript
interface ObjectTransferProgress {
  status: "inventorying" | "transferring" | "verifying" | "complete" | "failed";
  objectsTotal: number;
  objectsTransferred: number;
  objectsFailed: number;
  bytesTotal: number;
  bytesTransferred: number;
  errors: Array<{ key: string; error: string }>;
}
```

### Utility Functions

- **`getStorageClassMappings(sourceProvider, targetProvider, classes[])`** — Batch-maps storage classes between providers using the `STORAGE_CLASS_MAP` table
- **`estimateTransferTime(totalBytes, objectCount, bandwidthMbps)`** — Estimates transfer duration based on bandwidth and per-object overhead (50ms), identifies bottleneck as `"bandwidth"` or `"object-count"`

---

## 9. Database Migration

**Files:** `src/data/database/{pg-migrator,mysql-migrator,schema-comparator}.ts` (~621 lines)

### Schema Comparison (Fully Implemented)

`compareSchemas(source, target)` performs structural diff:
- Added/removed tables
- Added/removed/type-changed columns
- Row count variance per table
- Cross-engine type mapping (23 PG→MySQL mappings, 16 MySQL→PG mappings)

### Command Generation (Fully Implemented)

| Function | Output |
|----------|--------|
| `buildPgDumpCommand(conn, opts)` | `pg_dump` CLI string with format, parallel, table filters, SSL |
| `buildPgRestoreCommand(conn, opts)` | `pg_restore` CLI string |
| `buildMySQLDumpCommand(conn, opts)` | `mysqldump` CLI string with triggers, routines, events |
| `buildMySQLImportCommand(conn, path)` | `mysql < dump.sql` CLI string |
| `generateReplicationSetup()` | SQL for PostgreSQL logical replication (`CREATE PUBLICATION/SUBSCRIPTION`) |
| `generateMySQLReplicationSetup()` | SQL for MySQL GTID-based replication |

### Type Mapping Tables

```
PostgreSQL → MySQL                    MySQL → PostgreSQL
─────────────────                    ──────────────────
boolean    → TINYINT(1)              TINYINT    → smallint
jsonb      → JSON                    MEDIUMTEXT → text
uuid       → CHAR(36)               DATETIME   → timestamp
serial     → INT AUTO_INCREMENT      ENUM(...)  → text
text[]     → JSON                    SET(...)   → text[]
interval   → VARCHAR(255)           DOUBLE     → double precision
cidr       → VARCHAR(43)            BLOB       → bytea
```

### Current Limitation

Schema extraction (`extractPostgresSchema`, `extractMySQLSchema`) and actual migration execution (`migratePostgres`, `migrateMySQL`) are **stubbed** — they return empty results. No database driver packages (`pg`, `mysql2`) are dependencies. Step handlers for the 4 database pipeline types are not yet registered.

---

## 10. Governance & Compliance

### 10.1 Cryptographic Audit Logger

**File:** `src/governance/audit-logger.ts` (202 lines)

Every migration action produces a **hash-chained audit entry**:

```
┌─────────────────────────────────────────────────────┐
│  Entry N                                            │
│  ┌─────────────────────────────────────────────┐    │
│  │ hash: SHA-256(content + previousHash)       │    │
│  │ previousHash: Entry[N-1].hash               │    │
│  │ jobId, action, actor, phase, stepId, details│    │
│  │ timestamp                                    │    │
│  └─────────────────────────────────────────────┘    │
│           │                                         │
│           ▼                                         │
│  Entry N-1                                          │
│  ┌─────────────────────────────────────────────┐    │
│  │ hash: SHA-256(content + previousHash)       │    │
│  │ previousHash: Entry[N-2].hash               │    │
│  └─────────────────────────────────────────────┘    │
│           │                                         │
│          ···                                        │
│           │                                         │
│  Entry 0 (genesis)                                  │
│  ┌─────────────────────────────────────────────┐    │
│  │ previousHash: "genesis"                     │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

`verify()` walks the chain and validates every link — any tampering breaks the hash chain.

### 10.2 Policy Engine

**File:** `src/governance/policy-checker.ts` (235 lines)

6 built-in policies:

| Policy | Level | Rule |
|--------|-------|------|
| `require-encryption` | Block | All data at rest must be encrypted |
| `require-tags` | Warning | `owner` + `environment` tags required on all resources |
| `cost-limit` | Block | Estimated cost must not exceed $50,000 |
| `no-public-ingress` | Error | High-sensitivity VMs must have no `0.0.0.0/0` ingress rules |
| `region-restriction` | Block | Target region must be US or EU |
| `max-concurrent-vms` | Warning | Maximum 20 VMs per migration plan |

Custom policies can be added via `createPolicy()` at runtime.

### 10.3 Approval Gates

**File:** `src/governance/approval-gate.ts` (154 lines)

Automatic approval requirement triggers:

| Trigger | Threshold |
|---------|-----------|
| Step type | `cutover`, `provision-vm`, `import-image`, `create-target-bucket` always require approval |
| Phase gate | `executing` and `cutting-over` phases require approval |
| Cost threshold | Estimated cost > $1,000 |
| Data threshold | Total data > 100 GB |
| Timeout | 1 hour (configurable) |

Risk level assessment: `low` (< $1K, < 100GB, < 5 VMs), `medium`, `high`, `critical` (> $50K or production flag).

### 10.4 Rollback Manager

**File:** `src/governance/rollback-manager.ts` (266 lines)

- Maintains a per-job **LIFO stack** of completed steps
- `generateRollbackPlan()` produces a reverse-order plan, skipping steps without rollback handlers
- `executeRollback()` pops the stack and calls each handler's `rollback(ctx, outputs)` in reverse sequence
- Risk assessment: `high` if cutover was completed, `medium` if provision/import completed
- Rollback results are logged to the audit chain

---

## 11. Graph & Dependency Analysis

**Files:** `src/graph/{dependency-analyzer,migration-adapter,post-migration-sync}.ts` (~676 lines)

### Dependency Graph

Resources are modeled as a directed graph with typed edges:

```typescript
type EdgeType = "depends-on" | "communicates-with" | "stores-data-in"
              | "routes-to" | "secured-by";
```

### Migration Wave Planning

`generateMigrationWaves(graph)` converts topological layers into ordered waves:

```
Wave 1 (Infrastructure): DNS, Security Groups, Load Balancers
    │
Wave 2 (Data): Object Storage, Databases
    │
Wave 3 (Compute): VMs that depend on Wave 2 resources
    │
Wave 4 (Verification): Connectivity checks, integrity verification
    │
Wave 5 (Cutover): DNS switch, source decommission
```

Each wave has a risk level based on resource composition (databases/LBs → high risk).

### Blast Radius Analysis

`computeBlastRadius(resourceId)` performs BFS along reverse dependency edges to determine:
- Direct dependents (1 hop)
- Transitive dependents (all hops)
- Total affected resource count
- Whether the resource is on a critical path

### Knowledge Graph Integration

The `MigrationGraphAdapter` implements Espada's `GraphDiscoveryAdapter` interface, enabling migration resources to appear in the platform-wide knowledge graph. Resources are indexed by type (`vm`, `bucket`, `security-group`, `migration-job`, `migration-step`) with edges representing cloud relationships.

### Post-Migration Lineage

`generatePostMigrationUpdates()` creates:
- New nodes for target resources
- `migrated-to` edges from source → target
- Deprecation markers on source resources
- Lineage reports aggregated by resource type and timeline

---

## 12. Integrity Verification

**File:** `src/core/integrity-verifier.ts` (319 lines)

Three verification levels:

### Object-Level Verification
```
verifyObjectIntegrity({ sourceObjects, targetObjects })
├── Object count match
├── Total size match
├── Per-object SHA-256 checksum comparison
└── Missing/extra object detection
```

### Volume-Level Verification
```
verifyVolumeIntegrity({ sourceVolume, targetVolume })
├── Image SHA-256 hash match
├── Image size match
└── Boot sector verification
```

### Schema-Level Verification
```
verifySchemaIntegrity({ sourceSchema, targetSchema })
├── Table count match
├── Per-table row count comparison
├── Schema DDL diff
└── Missing/extra table detection
```

All checks update the global diagnostics counters (`integrityChecksPassed`, `integrityChecksFailed`).

---

## 13. Cost Estimation

**File:** `src/core/cost-estimator.ts` (315 lines)

### Cost Categories

```
Total Cost = Egress + Compute + Storage + API Calls + Conversion
```

| Category | Formula | Sample Rates |
|----------|---------|--------------|
| **Data Egress** | source_GB × rate_per_GB | AWS: $0.09, Azure: $0.087, GCP: $0.12 |
| **Compute** | target_vCPUs × rate_per_vCPU_month | AWS: $36.50, Azure: $35.04, GCP: $33.80 |
| **Storage** | target_GB × rate_per_GB_month | AWS: $0.023, Azure: $0.018, GCP: $0.020 |
| **API Calls** | (LIST + GET + PUT ops) × $0.005/1K | Per-object operations |
| **Conversion** | disk_GB / 100 × $0.20/hr | Image format conversion sandbox cost |

### Duration Estimation

```
estimated_duration = 1 hr base
                   + 30 min per 100 GB data
                   + 5 min per VM
```

### Confidence Levels

- **High:** Simple migration (few VMs, small data, same region pair)
- **Medium:** Moderate complexity
- **Low:** Large-scale or cross-region with many unknowns

---

## 14. Compatibility Matrix

**File:** `src/core/compatibility-matrix.ts` (443 lines)

**84 rules** covering all provider-pair × resource-type combinations.

### Key Warnings by Direction

| Direction | Key Warnings |
|-----------|-------------|
| AWS → Azure | `VM_DRIVER_SWAP` (Hyper-V drivers needed), `ACL_MISMATCH` (IAM→RBAC) |
| AWS → GCP | `DISK_FORMAT` (raw needed), `SG_STATEFUL` (stateless firewall rules) |
| Azure → AWS | `ASG_EXPAND` (NSG→SG decomposition), `ENCRYPTION_REKEY` |
| Azure → GCP | `TAGS_TO_SG` (NSG→firewall rule mapping) |
| GCP → AWS | `AGENT_REQUIRED` (GCP guest agent → SSM agent) |
| GCP → Azure | `LB_FEATURE_DIFF` (backend service → backend pool) |
| Cloud → On-Prem | `AGENT_REQUIRED`, requires migration agent on-prem |
| On-Prem → Cloud | `VM_DRIVER_SWAP`, format conversion required |
| Same provider | **Blocked** (`SAME_PROVIDER`) |

### API

```typescript
checkCompatibility(source, target, resourceType)  → CompatibilityResult
checkAllCompatibility(source, target)              → CompatibilityResult[]
getFullCompatibilityMatrix()                       → CompatibilityMatrixEntry[]
getCompatibilitySummary(source, target)             → { compatible, warningCount, blockerCount }
```

---

## 15. Extension Interface

### Agent Tools (10)

| Tool | Purpose |
|------|---------|
| `migration_assess` | Compatibility, cost, and dependency assessment |
| `migration_plan` | Generate a full execution plan |
| `migration_execute` | Execute an approved plan |
| `migration_status` | Query job status and progress |
| `migration_verify` | Run integrity verification |
| `migration_rollback` | Rollback a failed/in-progress migration |
| `migration_cutover` | Perform final DNS/LB cutover |
| `migration_history` | List past migration jobs |
| `migration_compatibility` | Query the compatibility matrix |
| `migration_estimate_cost` | Estimate cost without generating a plan |

### Gateway API (14 Methods)

```
POST  migration/assess            ← Run assessment
POST  migration/plan              ← Generate plan
POST  migration/plan/approve      ← Approve a pending plan
POST  migration/execute           ← Execute plan
GET   migration/status            ← Job status
GET   migration/jobs              ← List all jobs
POST  migration/rollback          ← Rollback job
POST  migration/cutover           ← Cutover
POST  migration/verify            ← Verify integrity
GET   migration/compatibility     ← Query compatibility
POST  migration/cost              ← Cost estimate
GET   migration/audit             ← Audit log entries
GET   migration/policy            ← Policy evaluation
POST  migration/diagnostics/reset ← Reset diagnostics
```

### CLI Commands (12)

```
espada migration assess         espada migration rollback
espada migration plan           espada migration verify
espada migration execute        espada migration cutover
espada migration status         espada migration compatibility
espada migration list           espada migration cost
espada migration audit          espada migration diagnostics
```

---

## 16. State Management & Lifecycle

### Plugin State (Singleton)

```typescript
interface CloudMigrationPluginState {
  jobs: Map<string, MigrationJob>;
  activeJobCount: number;
  diagnostics: MigrationDiagnostics;
  stepHandlers: Map<MigrationStepType, MigrationStepHandler>;
  eventListeners: Set<MigrationEventListener>;
}
```

### Diagnostics (16 Counters)

```typescript
interface MigrationDiagnostics {
  jobsCreated: number;       jobsCompleted: number;
  jobsFailed: number;        jobsRolledBack: number;
  stepsExecuted: number;     stepsSucceeded: number;
  stepsFailed: number;       integrityChecks: number;
  integrityPassed: number;   integrityFailed: number;
  totalBytesTransferred: number;
  gatewayAttempts: number;   gatewaySuccesses: number;
  gatewayFailures: number;   lastError: string | null;
}
```

### Service Lifecycle

```
Service Start
├── resetPluginState()
├── resetAuditLogger()
├── resetProviderRegistry()
├── Register 17 step handlers (8 compute + 5 data + 4 network)
├── Log startup to audit chain
└── Ready for migration requests

Service Stop
├── Warn if active jobs exist
├── Log shutdown + diagnostics to audit chain
├── resetPluginState()
└── resetProviderRegistry()
```

---

## 17. Data Flow Walkthrough

### Example: Migrate 2 VMs + 1 Bucket from AWS to GCP

**Phase 1: Assessment**
```
User: "migration_assess --source aws/us-east-1 --target gcp/us-central1
       --vms i-abc,i-def --buckets my-data"

Engine:
1. checkAllCompatibility("aws", "gcp")
   → 7 results, 0 blockers, 3 warnings (DISK_FORMAT, SG_STATEFUL, AGENT_REQUIRED)
2. estimateMigrationCost(VMs, buckets, "aws" → "gcp")
   → { egress: $11.25, compute: $67.60, storage: $2.50, api: $0.05, total: $81.40 }
3. evaluateRiskLevel()
   → medium (2 VMs, 125 GB data)
4. Return assessment { feasible: true, warnings: 3, blockers: 0 }
```

**Phase 2: Planning**
```
Engine generates 19-step DAG:

  VM Pipeline (vm-abc):     VM Pipeline (vm-def):     Data Pipeline:
  snap-abc                  snap-def                  inventory-my-data
  │                         │                         │
  export-abc                export-def                create-tgt-my-data
  │                         │                         │
  transfer-abc              transfer-def              transfer-my-data
  │                         │                         │
  convert-abc               convert-def               verify-my-data
  │                         │                         │
  import-abc                import-def                sync-meta-my-data
  │                         │
  provision-abc             provision-def
  │                         │
  verify-abc                verify-def

  Network Pipeline:
  map-network → create-sg-rules → migrate-dns → verify-conn

  Cutover (depends on verify-abc, verify-def, verify-my-data, verify-conn):
  cutover-final
```

**Phase 3: Execution (with credentials)**
```
Layer 0: [snap-abc, snap-def, inventory-my-data, map-network]  (parallel)
Layer 1: [export-abc, export-def, create-tgt-my-data, create-sg-rules]
Layer 2: [transfer-abc, transfer-def, transfer-my-data, migrate-dns]
Layer 3: [convert-abc, convert-def, verify-my-data, verify-conn]
Layer 4: [import-abc, import-def, sync-meta-my-data]
Layer 5: [provision-abc, provision-def]
Layer 6: [verify-abc, verify-def]
Layer 7: [cutover-final]

Each step:
1. Resolve output refs from predecessors
2. Resolve provider adapter from registry
3. Call real SDK method (e.g., adapter.compute.createSnapshot)
4. Store outputs for downstream steps
5. Log to audit chain
```

**Phase 4: Failure & Rollback**
```
If provision-def fails at Layer 5:
1. Mark provision-def as FAILED
2. failFast=true → skip remaining layers
3. autoRollback=true → begin rollback
4. Reverse topological order of completed steps:
   import-def.rollback()     → delete GCP image
   import-abc.rollback()     → delete GCP image
   create-tgt.rollback()     → delete GCS bucket
   create-sg-rules.rollback() → delete firewall rules
   migrate-dns.rollback()    → delete DNS zone
   snap-def.rollback()       → delete AWS snapshot
   snap-abc.rollback()       → delete AWS snapshot
5. Job phase → rolled-back
```

---

## 18. Current Implementation Status

### Implementation Summary

| Component | Status | Detail |
|-----------|--------|--------|
| **Type system** | ✅ Complete | 829 lines, 24 step types, 6 providers, 7 resource types |
| **DAG engine** | ✅ Complete | Topological sort, parallel layers, output resolution, rollback |
| **Migration planner** | ✅ Complete | 4 pipeline generators, risk assessment, plan serialization |
| **AWS adapter** | ✅ ~80% real | All sub-adapters delegate to real `@aws-sdk` managers |
| **GCP adapter** | ✅ ~75% real | Direct REST API calls with OAuth tokens |
| **Azure adapter** | ✅ ~80% real | Compute/DNS/network real; blob data plane fully implemented via `@azure/storage-blob` |
| **Transfer engine** | ✅ Production | Basic engine + streaming engine with resume, delta sync, bandwidth throttling |
| **Integrity verifier** | ✅ Complete | 3 verification levels with checksum comparison |
| **Cost estimator** | ✅ Complete | 5 cost categories, duration estimation |
| **Compatibility matrix** | ✅ Complete | 84 rules, all provider pairs |
| **Audit logger** | ✅ Complete | SHA-256 hash-chained with chain verification |
| **Policy engine** | ✅ Complete | 6 built-in policies, custom policy support |
| **Approval gates** | ✅ Complete | Step/phase/cost/data threshold triggers |
| **Rollback manager** | ✅ Complete | Reverse-order execution with risk assessment |
| **Graph integration** | ✅ Complete | Dependency analysis, wave planning, blast radius, lineage |
| **Step handlers** | ✅ 21/21 wired | Dual-path (real SDK + stub fallback); 8 compute + 5 data + 4 database + 4 network |
| **DB schema tools** | ⚠️ Partial | Command generation real; execution stubbed |
| **DB step handlers** | ✅ Complete | 4 handlers (export, transfer, import, verify-schema) registered and tested |
| **Streaming engine** | ✅ Complete | Resumable checkpoint, delta sync, multi-part upload threshold, bandwidth throttling |
| **On-prem adapter** | ❌ Missing | Types + VMware adapter exist; no registry support |
| **Tests** | ✅ 262 passing | 16 test files; all stub/fallback paths; mock adapter integration tests |

### Test Coverage

| Test File | Tests | Coverage Area |
|-----------|-------|---------------|
| `migration-engine.test.ts` | 22 | DAG execution, topological sort, rollback |
| `governance.test.ts` | 32 | Audit chain, policy, approval, rollback manager |
| `provider-registry.test.ts` | 30 | Registry, adapter wiring, step handler fallbacks |
| `streaming-transfer.test.ts` | 25 | Streaming engine, delta sync, resume, retry, abort |
| `database-steps.test.ts` | 20 | Export/transfer/import/verify-schema handlers |
| `graph.test.ts` | 16 | Dependency analysis, waves, blast radius |
| `integrity-verifier.test.ts` | 15 | Object/volume/schema verification |
| `schema-comparator.test.ts` | 14 | PG↔MySQL schema diff, type mapping |
| `extension-contract.test.ts` | 13 | Gateway methods, tools, CLI registration |
| `cost-estimator.test.ts` | 13 | Cost estimation formulas |
| `types-and-state.test.ts` | 17 | Type guards, state management |
| `compatibility-matrix.test.ts` | 10 | Compatibility rules |
| `data-normalizer.test.ts` | 10 | Bucket normalization |
| `network.test.ts` | 10 | Rule translation, DNS migration |
| `migration-planner.test.ts` | 10 | Plan generation, assessment |
| `compute-normalizer.test.ts` | 5 | VM normalization |

---

## 19. Known Gaps & Future Work

### Resolved Since v1.0

| Gap | Resolution |
|-----|-----------|
| **Azure blob-level storage** | ✅ All 7 stub methods replaced with real `@azure/storage-blob` implementations (BlobServiceClient, SAS URLs, metadata sanitization) |
| **Database step handlers** | ✅ 4 handlers created and registered: `export-database`, `transfer-database`, `import-database`, `verify-schema` |
| **Streaming transfers** | ✅ Streaming transfer engine with concurrent batching, excludes in-memory bottleneck for production datasets |
| **Multi-part upload threshold** | ✅ Streaming engine detects large objects and routes through multi-part path |
| **Resumable transfers** | ✅ Checkpoint serialization/deserialization with `completedKeys` set for resume from last progress |
| **Delta/incremental sync** | ✅ ETag-based comparison between source and target inventories; skip unchanged objects |
| **Bandwidth throttling** | ✅ Configurable rate limiter in streaming engine (`bandwidthLimitBytesPerSec`) |

### Remaining Critical Gaps

| Gap | Impact | Effort |
|-----|--------|--------|
| **On-premises adapter** | Registry throws for `on-premises`/`vmware`/`nutanix`. Types and VMware adapter file exist but aren't wired. | High — needs vSphere API, agent binary, discovery flow |
| **Database execution** | `migratePostgres()` and `migrateMySQL()` return hardcoded zeros. No `pg` or `mysql2` driver dependency. | High — add driver deps, implement actual dump/restore |
| **Native multi-part upload APIs** | Current multi-part uses single `putObject`; should use S3 `CreateMultipartUpload`/`UploadPart`/`CompleteMultipartUpload`, Azure staged blocks, GCS resumable uploads. | Medium — requires provider-specific StorageAdapter extensions |

### Enhancement Opportunities

| Enhancement | Description |
|-------------|-------------|
| **Server-side copy** | Use S3-to-S3 Copy, GCS Transfer Service, AzCopy for same-provider optimization |
| **Container migration** | ECS→GKE, AKS container service migration |
| **Serverless migration** | Lambda→Cloud Functions, Azure Functions migration |
| **IAM/RBAC migration** | Translate IAM policies between cloud-native RBAC systems |
| **KMS key migration** | Cross-provider encryption key rotation and re-encryption |
| **Application discovery** | Agent-based dependency mapping for on-prem environments |
| **Migration wave orchestration** | Group dependent resources into ordered waves with inter-wave gates |
| **Cutover dry-run** | Simulate DNS/LB cutover without committing |
| **Cloud integration tests** | Mock-based tests that verify adapter → SDK delegation chains |
| **Stream-based object piping** | Replace Buffer-based getObject/putObject with Node.js Readable/Writable streams for true back-pressure |
