# Hybrid/Edge Infrastructure Support Plan

> **Goal**: Make Espada the only infrastructure automation platform with a topology-aware Knowledge Graph that spans cloud, edge, and on-premises — covering Azure Local, Azure Arc, AWS Outposts, Google Distributed Cloud, and GKE Enterprise fleets in a single unified graph.

## Why This Matters

### Market Opportunity

- **Hybrid cloud market**: ~$100B+ by 2026, growing 17% CAGR
- **Edge computing market**: ~$60B by 2026, driven by IoT, 5G, and AI inference at the edge
- **Azure Arc**: 33,000+ customers (2025)
- **AWS Outposts**: deployed at thousands of customer sites across 100+ countries
- **GDC**: available in 25 countries, focused on regulated industries and sovereign cloud

### Competitive Gap — Completely Uncontested

| Capability | Spacelift | Env0 | Firefly | Espada (after this) |
|---|:---:|:---:|:---:|:---:|
| Hybrid/edge topology graph | No | No | No | **Yes** |
| Azure Arc / Azure Local discovery | No | No | No | **Yes** |
| AWS Outposts discovery | No | No | No | **Yes** |
| GKE Enterprise fleet management | No | No | No | **Yes** |
| Cross-boundary blast radius | No | No | No | **Yes** |
| Disconnected operation assessment | No | No | No | **Yes** |
| Edge site → cloud dependency mapping | No | No | No | **Yes** |

Spacelift and Env0 support hybrid *indirectly* through Terraform providers — they manage IaC stacks, not infrastructure topology. Firefly has a "Cloud Map" but doesn't cover Azure Local, GDC, or Outposts. Nobody builds a Knowledge Graph that spans cloud + edge + on-prem with blast-radius analysis across boundaries.

---

## Platform Research Summary

### Key Technical Insight

Azure Local and AWS Outposts use the **same APIs** as their parent clouds. This means integration is largely additive — new resource types and discovery calls, not new API clients.

| Platform | Parent Cloud | Same API? | Disconnected Mode | Effort |
|----------|:---:|:---:|:---:|:---:|
| **Azure Local** (fka Azure Stack HCI) | Azure | Yes (ARM via Arc) | Preview | Low |
| **Azure Arc** | Azure | Yes (ARM) | No | Low |
| **AWS Outposts** (Racks + Servers) | AWS | Yes (same AWS APIs) | No | Low–Medium |
| **GDC Connected** | GCP | Partially (GKE API) | No | Medium |
| **GDC Air-Gapped** | GCP | Mirror APIs, local endpoints | Yes (fully isolated) | High (deferred) |
| **GKE Enterprise / Fleets** | GCP | Yes (GCP APIs) | No | Low–Medium |
| **VMware VCF** | None (via Azure Arc) | Via Arc: ARM | Yes | Via Arc: Low |
| **Nutanix** | None (via Azure Arc) | Via Arc: ARM | Yes | Via Arc: Low |

### Platform Details

#### Azure Local (formerly Azure Stack HCI)

Runs VMs, containers, and select Azure services on customer-owned hardware on-premises. Managed through Azure Resource Manager (ARM) via Azure Arc — resources appear in the Azure portal as native ARM resources.

- **Workloads**: VMs (Azure Marketplace), AKS on Azure Local, Azure Virtual Desktop, Azure IoT Operations
- **Hardware**: Validated solutions from Dell, HPE, Lenovo, etc.
- **Sovereign Private Cloud**: Azure Local + Microsoft 365 Local for data residency
- **Pricing**: Azure subscription-based, pay per core activated

**ARM resource types**:
- `Microsoft.AzureStackHCI/clusters` — the HCI cluster itself
- `Microsoft.AzureStackHCI/virtualMachines` — VMs running on the cluster
- `Microsoft.AzureStackHCI/virtualNetworks` — virtual networking
- `Microsoft.AzureStackHCI/storageContainers` — storage

#### Azure Arc

Management plane that extends Azure to any infrastructure. Projects non-Azure resources into Azure Resource Manager.

**ARM resource types**:
- `Microsoft.HybridCompute/machines` — Arc-enabled servers (any Windows/Linux machine)
- `Microsoft.Kubernetes/connectedClusters` — Arc-enabled Kubernetes (any conformant K8s)
- `Microsoft.ExtendedLocation/customLocations` — deploy Azure services to Arc-connected clusters
- `Microsoft.ConnectedVMwarevSphere/*` — lifecycle management of vCenter VMs via Azure
- `Microsoft.ScVmm/*` — System Center VM management via Azure

Arc is not a separate platform — it's a unification layer. Any Azure SDK call that works against ARM can discover+manage Arc resources. **Free control plane.**

#### AWS Outposts

AWS infrastructure delivered as physical hardware to customer data centers.

- **Outposts Racks** (42U): EC2, ECS, EKS, EBS, S3, RDS, ElastiCache, EMR, ALB
- **Outposts Servers** (1U/2U): EC2, ECS, IoT Greengrass (edge/retail/branch)
- **Key insight**: Uses the **exact same AWS APIs** — an EC2 instance on an Outpost is managed with `ec2.amazonaws.com`
- Resources have `OutpostArn` field; S3 on Outposts uses `s3-outposts` API
- Espada's AWS extension already partially models `OutpostConfig` (EKS), `SubnetOutpost` (RDS), `OUTPOSTS` storage class (S3)

**Outposts-specific API**: `outposts.amazonaws.com` for site/rack discovery (`ListOutposts`, `ListSites`, `GetOutpost`)

#### Google Distributed Cloud (GDC)

Google's fully managed infrastructure for data centers and edge.

- **GDC Connected**: Managed GKE on 1U ruggedized servers, maintains Google Cloud connectivity. For retail/manufacturing/telco. Starting at $415/node/month.
- **GDC Air-Gapped**: Full isolation, no internet required. For defense/intelligence/sovereign. Runs GKE Enterprise, Vertex AI (Gemini on-premises), BigQuery. Has its own management console. FIPS 140-2 certified. DoD IL6 authorized.

**API surface**:
- Connected: Uses GKE API + some standard GCP APIs with local endpoint
- Air-gapped: **Own local API endpoints** mirroring Google Cloud APIs (NOT reachable via `googleapis.com`) — **deferred to phase 2**

#### GKE Enterprise (formerly Anthos)

Anthos has been folded into GKE as fleet management features.

- **GKE Autopilot**: Fully managed node infrastructure
- **Fleet management**: Multi-cluster management across cloud and on-prem
- **Attached clusters**: Register any K8s cluster (EKS, AKS, on-prem) for unified management
- **Config Sync**: GitOps across clusters
- **Policy Controller**: OPA-based policy enforcement

**APIs**:
- `container.googleapis.com` — GKE cluster management
- `gkehub.googleapis.com` — Fleet/membership management
- `gkemulticloud.googleapis.com` — GKE clusters on AWS/Azure
- `anthosconfigmanagement.googleapis.com` — Config Sync

---

## Architecture

### Approach

Shared `extensions/hybrid-cloud/` extension for cross-provider abstractions (edge site model, fleet management, location-aware graph types), with provider-specific discovery code in existing `extensions/azure/`, `extensions/aws/`, and `extensions/gcp/` extensions where SDK clients already live.

### Directory Structure

```
extensions/hybrid-cloud/                  ← NEW extension: shared types, unified tools/CLI
  ├── index.ts                            ← Plugin registration
  ├── espada.plugin.json                  ← Plugin manifest
  ├── package.json
  ├── tsconfig.json
  ├── vitest.config.ts
  └── src/
      ├── types.ts                        ← HybridSite, Fleet, ConnectedCluster, Location
      ├── graph-model.ts                  ← Knowledge Graph type extensions
      ├── discovery-coordinator.ts        ← Orchestrate multi-provider hybrid discovery
      ├── cross-boundary-analysis.ts      ← Cross cloud/edge blast radius, DR, connectivity
      ├── tools.ts                        ← 4 unified hybrid/edge agent tools
      └── cli.ts                          ← `espada hybrid` subcommands

extensions/azure/src/hybrid/              ← NEW subdirectory in existing Azure extension
  ├── arc-discovery.ts                    ← Arc servers, K8s, VMware discovery via ARM
  ├── local-discovery.ts                  ← Azure Local / HCI cluster discovery via ARM
  └── types.ts                            ← Azure-specific hybrid resource types

extensions/aws/src/hybrid/                ← NEW subdirectory in existing AWS extension
  ├── outposts-discovery.ts               ← Outpost site/rack/server discovery
  └── types.ts                            ← Outposts-specific types

extensions/gcp/src/hybrid/               ← NEW subdirectory in existing GCP extension
  ├── gdc-discovery.ts                    ← GDC connected cluster discovery
  ├── fleet-discovery.ts                  ← GKE Enterprise fleet/membership discovery
  └── types.ts                            ← GDC/fleet-specific types
```

---

## Implementation Plan

### Dependency Order

```
Step 1 (foundation):  Knowledge Graph type extensions
Step 2 (shared):      extensions/hybrid-cloud/ shared types + coordinator
Step 3 (parallel):    Azure hybrid | AWS hybrid | GCP hybrid (all 3 simultaneously)
Step 4 (analysis):    Cross-boundary analysis tools
Step 5 (testing):     Integration tests across all providers
```

All of this comes **after P0 features** (Audit Trail → Policy Engine → SSO/RBAC) since hybrid resources should emit audit events and be governed by policies.

---

### Step 1: Extend Knowledge Graph Model

**Location**: `extensions/knowledge-graph/src/types.ts`  
**Estimated changes**: ~200 LOC

#### New `CloudProvider` Values

```typescript
type CloudProvider =
  | "aws"
  | "azure"
  | "gcp"
  | "kubernetes"
  | "custom"
  // Hybrid/edge additions:
  | "azure-arc"       // Arc-managed non-Azure resources
  | "gdc"             // Google Distributed Cloud
  | "vmware"          // VMware vSphere (via Arc or native)
  | "nutanix";        // Nutanix (future)
```

#### New `GraphResourceType` Values

```typescript
// Hybrid-specific resource types:
| "hybrid-machine"      // Arc server, physical machine
| "connected-cluster"   // Arc/GKE attached Kubernetes cluster
| "custom-location"     // Azure custom location (deploy target)
| "outpost"             // AWS Outpost site (rack or server)
| "edge-site"           // Physical location abstraction
| "hci-cluster"         // Azure Local / HCI cluster
| "fleet"               // GKE Enterprise fleet
```

#### New `GraphRelationshipType` Values

```typescript
// Hybrid-specific relationship types:
| "managed-by"          // Arc resource → Azure control plane
| "hosted-on"           // VM → physical hardware / edge site
| "member-of-fleet"     // K8s cluster → GKE fleet
| "deployed-at"         // Resource → physical location
| "connected-to"        // Edge site → cloud region (network link)
```

#### New `GraphNodeLocation` Type

Generalizes "region" to include physical sites:

```typescript
type GraphNodeLocationType =
  | "cloud-region"      // Standard cloud region (us-east-1, westus2, us-central1)
  | "availability-zone" // AZ within a region
  | "edge-site"         // Customer edge location (retail store, factory, branch)
  | "on-premises"       // Customer data center
  | "custom-location";  // Azure custom location

type GraphNodeLocation = {
  type: GraphNodeLocationType;
  name: string;                 // Human-readable (e.g., "Seattle Warehouse 3")
  provider: CloudProvider;
  region?: string;              // Cloud region (for cloud-region type)
  parentRegion?: string;        // Parent cloud region this edge site connects to
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  address?: {
    city?: string;
    state?: string;
    country: string;
    postalCode?: string;
  };
  connectivityStatus?: ConnectivityStatus;
};

type ConnectivityStatus =
  | "connected"        // Full connectivity to cloud control plane
  | "degraded"         // Partial connectivity (some services impaired)
  | "disconnected"     // No connectivity (air-gapped or network failure)
  | "unknown";         // Status not determined
```

#### Node ID Format

The existing format `{provider}:{account}:{region}:{resourceType}:{nativeId}` still works — "region" generalizes to "location":

```
azure-arc:sub-123:contoso-dc-01:hybrid-machine:server-42
azure:sub-123:contoso-edge-01:hci-cluster:cluster-1
aws:123456789:outpost-site-seattle:outpost:op-abc123
gcp:project-x:fleet-production:fleet:fleet-001
```

#### Tests

10 tests: type validation, location serialization, new node/edge creation with hybrid types.

---

### Step 2: Create `extensions/hybrid-cloud/` Extension

**Files**: 8  
**Estimated LOC**: ~1,200

#### `src/types.ts` — Shared Hybrid Types (~200 LOC)

```typescript
type HybridSite = {
  id: string;
  name: string;
  provider: CloudProvider;
  location: GraphNodeLocation;
  status: ConnectivityStatus;
  parentCloudRegion: string;
  resourceCount: number;
  managedClusters: string[];     // node IDs of K8s clusters at this site
  managedMachines: string[];     // node IDs of machines at this site
  capabilities: HybridSiteCapability[];
  lastSyncAt: string;
  metadata: Record<string, unknown>;
};

type HybridSiteCapability =
  | "compute"           // Can run VMs
  | "containers"        // Can run containers/K8s
  | "storage"           // Has local storage
  | "ai-inference"      // Can run AI models locally
  | "disconnected-ops"  // Can operate without cloud connectivity
  | "sovereign";        // Meets sovereign cloud requirements

type FleetCluster = {
  id: string;
  name: string;
  provider: CloudProvider;
  fleetId?: string;             // GKE fleet, null for non-fleet clusters
  location: GraphNodeLocation;
  kubernetesVersion: string;
  nodeCount: number;
  status: "running" | "stopped" | "degraded" | "unknown";
  managedBy: "gke" | "aks" | "eks" | "arc" | "self-managed";
  connectivity: ConnectivityStatus;
  workloadCount?: number;
  lastHeartbeat?: string;
};

type HybridTopology = {
  cloudRegions: {
    provider: CloudProvider;
    region: string;
    resourceCount: number;
    edgeSites: HybridSite[];
  }[];
  edgeSites: HybridSite[];
  fleetClusters: FleetCluster[];
  connections: HybridConnection[];
  summary: {
    totalCloudResources: number;
    totalEdgeResources: number;
    totalSites: number;
    totalClusters: number;
    connectedSites: number;
    disconnectedSites: number;
  };
};

type HybridConnection = {
  from: string;  // node ID (edge site or cloud region)
  to: string;    // node ID (cloud region or edge site)
  status: ConnectivityStatus;
  latencyMs?: number;
  bandwidth?: string;
};

type HybridDiscoveryAdapter = {
  provider: CloudProvider;
  discoverSites(): Promise<HybridSite[]>;
  discoverFleetClusters(): Promise<FleetCluster[]>;
  discoverHybridResources(): Promise<GraphNodeInput[]>;
  healthCheck(): Promise<boolean>;
};
```

#### `src/graph-model.ts` — Graph Extensions (~150 LOC)

Helper functions for creating hybrid-specific graph nodes and edges:

- `createEdgeSiteNode(site: HybridSite): GraphNodeInput` — standard node with `location` metadata
- `createFleetNode(fleet): GraphNodeInput` — fleet group node
- `createClusterNode(cluster: FleetCluster): GraphNodeInput` — K8s cluster with fleet membership
- `createHybridEdge(from, to, relationship): GraphEdgeInput` — typed edge
- `mapSiteToGraphGroup(site): GraphGroup` — create KG group for physical site
- `inferConnectivity(site, graphEngine): ConnectivityStatus` — check if management-plane edges are healthy

#### `src/discovery-coordinator.ts` — Multi-Provider Orchestration (~250 LOC)

```typescript
class HybridDiscoveryCoordinator {
  private adapters: Map<CloudProvider, HybridDiscoveryAdapter>;

  // Register provider-specific adapters (called during plugin init)
  registerAdapter(provider: CloudProvider, adapter: HybridDiscoveryAdapter): void;

  // Full discovery across all registered providers
  async discoverAll(): Promise<HybridTopology>;

  // Discover edge sites only
  async discoverEdgeSites(): Promise<HybridSite[]>;

  // Discover Kubernetes fleet across all providers
  async discoverFleet(): Promise<FleetCluster[]>;

  // Sync hybrid topology into Knowledge Graph
  async syncToGraph(graphEngine: GraphEngine): Promise<{
    sitesDiscovered: number;
    clustersDiscovered: number;
    resourcesDiscovered: number;
    edgesCreated: number;
  }>;

  // Reconcile — mark disappeared resources, update connectivity status
  async reconcile(graphEngine: GraphEngine): Promise<void>;
}
```

#### `src/cross-boundary-analysis.ts` — Killer Differentiator (~250 LOC)

Analysis that spans the cloud/edge boundary — **nothing else on the market does this**:

```typescript
class CrossBoundaryAnalyzer {
  constructor(private graphEngine: GraphEngine);

  // If a cloud region goes down, which edge sites lose management plane?
  async cloudRegionImpact(region: string, provider: CloudProvider): Promise<{
    affectedSites: HybridSite[];
    affectedClusters: FleetCluster[];
    affectedResources: number;
    canOperateDisconnected: HybridSite[]; // sites that support disconnected ops
    willFail: HybridSite[];              // sites that cannot operate without cloud
  }>;

  // If an edge site goes offline, what cloud dependencies break?
  async edgeSiteImpact(siteId: string): Promise<{
    cloudDependencies: GraphNode[];      // cloud resources that this site feeds/uses
    dataFlowImpact: string[];            // descriptions of impacted data flows
    blastRadius: number;                 // total affected resources
  }>;

  // Which edge workloads depend on cloud services?
  async disconnectedOperationAssessment(): Promise<{
    fullyDisconnectable: FleetCluster[]; // can run without any cloud connectivity
    partiallyDisconnectable: {
      cluster: FleetCluster;
      cloudDependencies: GraphNode[];    // what breaks without cloud
    }[];
    requiresConnectivity: FleetCluster[]; // cannot function without cloud
  }>;

  // Fleet consistency — are all clusters running same versions/policies?
  async fleetDriftAnalysis(): Promise<{
    clusterCount: number;
    versionSkew: { cluster: string; version: string }[];
    policyDrift: { cluster: string; missingPolicies: string[] }[];
    configDrift: { cluster: string; diffs: string[] }[];
    score: number; // 0-100, 100 = perfectly consistent
  }>;

  // Hybrid DR posture — extends the DR analysis feature (Feature 9 in roadmap)
  async hybridDRPosture(): Promise<{
    overallScore: number;
    singleRegionRisks: {
      region: string;
      edgeSites: number;
      canFailover: boolean;
    }[];
    edgeSiteRisks: {
      site: string;
      hasBackup: boolean;
      hasFailover: boolean;
      rto: number | null;
    }[];
    recommendations: string[];
  }>;
}
```

#### `src/tools.ts` — 4 Agent Tools (~200 LOC)

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `hybrid_topology` | Show full hybrid topology: cloud regions + edge sites + connectivity | `{ provider?: string, includeResources?: boolean }` | Topology tree with resource counts and connectivity status |
| `hybrid_sites` | List edge/on-prem sites with status, resources, connectivity | `{ provider?: string, status?: ConnectivityStatus }` | Site list with location, resource count, last sync |
| `hybrid_fleet` | Show all Kubernetes clusters across all providers/locations | `{ provider?: string, fleetId?: string }` | Cluster list with versions, node counts, fleet membership |
| `hybrid_blast_radius` | Blast radius across cloud/edge boundary | `{ target: string, targetType: "region" \| "site" \| "cluster" }` | Impact analysis: affected sites, clusters, resources, disconnected-ops capable |

#### `src/cli.ts` — CLI Subcommands (~200 LOC)

```
espada hybrid status            Overview of all hybrid/edge infrastructure
espada hybrid sites             List edge sites with connectivity status
espada hybrid fleet             Cross-provider Kubernetes fleet view
espada hybrid topology          Full topology (text table or --format mermaid)
espada hybrid sync              Trigger hybrid discovery across all providers
espada hybrid blast-radius      Cross-boundary blast radius analysis
espada hybrid assess            Disconnected operation assessment
```

#### `index.ts` — Plugin Registration (~50 LOC)

- Register 4 tools
- Register `espada hybrid` CLI subcommand (7 subcommands)
- Register 3 gateway methods: `hybrid/topology`, `hybrid/sites`, `hybrid/fleet`
- Register `HybridDiscoveryCoordinator` as a background service (sync every 30 min)

#### Tests

25 tests: topology construction, coordinator orchestration, cross-boundary blast radius, fleet drift, disconnected ops assessment.

---

### Step 3A: Azure Hybrid Discovery

**Location**: `extensions/azure/src/hybrid/`  
**Files**: 3  
**Estimated LOC**: ~800

#### Dependencies (Azure ARM SDK packages)

```
@azure/arm-hybridcompute        ← Arc-enabled servers
@azure/arm-connectedk8s         ← Arc-enabled Kubernetes
@azure/arm-azurestackhci        ← Azure Local / HCI clusters
@azure/arm-extendedlocation     ← Custom locations
@azure/arm-connectedvmware      ← Arc-enabled VMware vSphere
```

All use the existing Azure `DefaultAzureCredential` authentication already in the Azure extension.

#### `types.ts` — Azure Hybrid Types (~100 LOC)

```typescript
type AzureArcServer = {
  id: string;                      // ARM resource ID
  name: string;
  resourceGroup: string;
  location: string;                // Azure region managing this resource
  osType: "Windows" | "Linux";
  osName?: string;
  osVersion?: string;
  status: "Connected" | "Disconnected" | "Error" | "Expired";
  agentVersion?: string;
  machineFqdn?: string;
  privateLinkScopeId?: string;
  lastStatusChange?: string;
  vmId?: string;                   // If this is a VM
  tags: Record<string, string>;
};

type AzureLocalCluster = {
  id: string;                      // ARM resource ID
  name: string;
  resourceGroup: string;
  location: string;
  status: "Running" | "InProgress" | "Degraded" | "Failed" | "NotYetRegistered";
  cloudManagementEndpoint?: string;
  desiredProperties?: {
    diagnosticLevel?: string;
    windowsServerSubscription?: string;
  };
  reportedProperties?: {
    clusterName?: string;
    clusterId?: string;
    clusterVersion?: string;
    nodeCount?: number;
    lastUpdated?: string;
  };
  tags: Record<string, string>;
};

type AzureArcKubernetesCluster = {
  id: string;                      // ARM resource ID
  name: string;
  resourceGroup: string;
  location: string;
  distribution: string;            // e.g., "AKS", "generic", "k3s", "rancher_rke2"
  kubernetesVersion: string;
  totalNodeCount: number;
  agentPublicKeyCertificate?: string;
  connectivityStatus: "Connected" | "Connecting" | "Offline" | "Expired";
  lastConnectivityTime?: string;
  tags: Record<string, string>;
};

type AzureCustomLocation = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  hostResourceId: string;          // Arc cluster this runs on
  namespace: string;
  displayName: string;
  hostType: "Kubernetes";
  authentication?: {
    type: string;
    value: string;
  };
};
```

#### `arc-discovery.ts` — Arc Resource Discovery (~350 LOC)

```typescript
class AzureArcDiscoveryAdapter implements HybridDiscoveryAdapter {
  provider = "azure-arc" as const;

  constructor(
    private credential: DefaultAzureCredential,
    private subscriptionId: string
  );

  // Discover all Arc-enabled servers
  async discoverArcServers(): Promise<AzureArcServer[]>;
  // Uses: HybridComputeManagementClient.machines.listBySubscription()

  // Discover all Arc-enabled Kubernetes clusters
  async discoverArcKubernetes(): Promise<AzureArcKubernetesCluster[]>;
  // Uses: ConnectedKubernetesClient.connectedCluster.listBySubscription()

  // Discover all custom locations
  async discoverCustomLocations(): Promise<AzureCustomLocation[]>;
  // Uses: CustomLocationsManagementClient.customLocations.listBySubscription()

  // Discover Arc-enabled VMware vSphere resources
  async discoverArcVMware(): Promise<{ vCenters: any[]; vms: any[] }>;
  // Uses: AzureArcVMwareManagementClient.vCenters.list()

  // Map to Knowledge Graph nodes
  async discoverHybridResources(): Promise<GraphNodeInput[]>;
  // Combines all discoveries, maps to graph node format

  // Map to edge sites
  async discoverSites(): Promise<HybridSite[]>;
  // Groups Arc resources by location, infers physical sites

  // Map Kubernetes clusters for fleet view
  async discoverFleetClusters(): Promise<FleetCluster[]>;
  // Maps Arc K8s clusters to unified FleetCluster type

  async healthCheck(): Promise<boolean>;
  // Tests ARM API connectivity
}
```

**Graph node mapping**:

| ARM Resource | KG Resource Type | KG Provider | Edges Created |
|---|---|---|---|
| `Microsoft.HybridCompute/machines` | `hybrid-machine` | `azure-arc` | `managed-by` → Azure subscription |
| `Microsoft.Kubernetes/connectedClusters` | `connected-cluster` | `azure-arc` | `managed-by` → Azure subscription |
| `Microsoft.ExtendedLocation/customLocations` | `custom-location` | `azure-arc` | `deployed-at` → edge site, `hosted-on` → Arc cluster |
| `Microsoft.ConnectedVMwarevSphere/virtualMachines` | `compute-instance` | `vmware` | `managed-by` → Azure Arc, `runs-in` → vCenter |

#### `local-discovery.ts` — Azure Local / HCI Discovery (~300 LOC)

```typescript
class AzureLocalDiscoveryAdapter implements HybridDiscoveryAdapter {
  provider = "azure" as const;

  constructor(
    private credential: DefaultAzureCredential,
    private subscriptionId: string
  );

  // Discover Azure Local (HCI) clusters
  async discoverHCIClusters(): Promise<AzureLocalCluster[]>;
  // Uses: AzureStackHCIClient.clusters.listBySubscription()

  // Discover VMs running on Azure Local
  async discoverHCIVirtualMachines(clusterId: string): Promise<any[]>;
  // Uses: AzureStackHCIClient.virtualMachineInstances.list()

  // Discover virtual networks on Azure Local
  async discoverHCINetworks(clusterId: string): Promise<any[]>;

  // Discover storage containers on Azure Local
  async discoverHCIStorage(clusterId: string): Promise<any[]>;

  // Map to Knowledge Graph nodes
  async discoverHybridResources(): Promise<GraphNodeInput[]>;

  // Map HCI clusters to edge sites
  async discoverSites(): Promise<HybridSite[]>;

  // Map AKS on Azure Local to fleet clusters
  async discoverFleetClusters(): Promise<FleetCluster[]>;

  async healthCheck(): Promise<boolean>;
}
```

**Graph node mapping**:

| ARM Resource | KG Resource Type | Edges Created |
|---|---|---|
| `Microsoft.AzureStackHCI/clusters` | `hci-cluster` | `deployed-at` → edge site, `connected-to` → Azure region |
| `Microsoft.AzureStackHCI/virtualMachines` | `compute-instance` | `runs-in` → HCI cluster |
| `Microsoft.AzureStackHCI/virtualNetworks` | `virtual-network` | `runs-in` → HCI cluster |
| `Microsoft.AzureStackHCI/storageContainers` | `storage-bucket` | `runs-in` → HCI cluster |

#### Tests

20 tests: ARM API response mocking, node mapping, edge creation, site inference from Arc metadata, connectivity status mapping.

---

### Step 3B: AWS Hybrid Discovery (Parallel with 3A)

**Location**: `extensions/aws/src/hybrid/`  
**Files**: 2  
**Estimated LOC**: ~500

#### Dependencies

```
@aws-sdk/client-outposts         ← Outpost site/rack discovery (new)
```

Existing AWS SDK clients (`@aws-sdk/client-ec2`, etc.) already handle Outpost-hosted resources via the `OutpostArn` field.

#### `types.ts` — Outposts Types (~80 LOC)

```typescript
type AwsOutpost = {
  outpostId: string;
  outpostArn: string;
  ownerId: string;
  name: string;
  description?: string;
  siteId: string;
  availabilityZone: string;
  availabilityZoneId: string;
  lifeCycleStatus: "CREATE_IN_PROGRESS" | "ACTIVE" | "RETIRING" | "RETIRED";
  tags: Record<string, string>;
};

type AwsOutpostSite = {
  siteId: string;
  accountId: string;
  name: string;
  description?: string;
  operatingAddress?: {
    addressLine1?: string;
    city?: string;
    stateOrRegion?: string;
    countryCode?: string;
    postalCode?: string;
  };
  rackPhysicalProperties?: {
    powerDrawKva?: number;
    powerPhase?: string;
    powerConnector?: string;
    fiberOpticCableType?: string;
    opticalStandard?: string;
    maximumSupportedWeightLbs?: number;
    uplinkSpeed?: string;
  };
  tags: Record<string, string>;
};

type AwsOutpostResource = {
  resourceId: string;
  resourceType: "ec2" | "ebs" | "s3" | "rds" | "eks" | "ecs" | "elb";
  outpostArn: string;
  siteId: string;
  nativeResourceId: string; // e.g., EC2 instance ID
};
```

#### `outposts-discovery.ts` — Outposts Discovery (~400 LOC)

```typescript
class AwsOutpostsDiscoveryAdapter implements HybridDiscoveryAdapter {
  provider = "aws" as const;

  constructor(private config: { region: string; credentials: any });

  // Discover all Outpost sites (physical locations)
  async discoverSites(): Promise<HybridSite[]>;
  // Uses: OutpostsClient.listSites() → map to HybridSite with address/coordinates

  // Discover all Outpost racks/servers
  async discoverOutposts(): Promise<AwsOutpost[]>;
  // Uses: OutpostsClient.listOutposts()

  // Discover resources hosted on Outposts
  async discoverOutpostResources(outpostArn: string): Promise<AwsOutpostResource[]>;
  // Uses: EC2.describeInstances with OutpostArn filter
  //       S3Control.listAccessPointsForObjectLambda for S3 Outposts
  //       EKS.listClusters filtering by outpostConfig
  //       RDS.describeDBInstances filtering by outpost subnet

  // Tag existing AWS resources with Outpost location
  async annotateOutpostResources(graphEngine: GraphEngine): Promise<number>;
  // Walk existing graph nodes, check for OutpostArn in metadata, add "deployed-at" edges

  // Map to Knowledge Graph nodes
  async discoverHybridResources(): Promise<GraphNodeInput[]>;

  // Map EKS on Outposts to fleet clusters
  async discoverFleetClusters(): Promise<FleetCluster[]>;

  async healthCheck(): Promise<boolean>;
}
```

**Graph node mapping**:

| AWS Resource | KG Resource Type | Edges Created |
|---|---|---|
| Outpost site | `edge-site` | `connected-to` → parent AZ/region |
| Outpost rack/server | `outpost` | `deployed-at` → edge site |
| EC2 on Outpost | `compute-instance` | `hosted-on` → Outpost |
| EKS on Outpost | `kubernetes-cluster` | `hosted-on` → Outpost |
| S3 on Outpost | `storage-bucket` | `hosted-on` → Outpost |
| RDS on Outpost | `database` | `hosted-on` → Outpost |

**Built on existing code**: The AWS extension already models `OutpostConfig` in `extensions/aws/src/containers/types.ts`, `SubnetOutpost` in RDS types, and `OUTPOSTS` as an S3 storage class. This adapter connects those scattered references into a unified view.

#### Tests

15 tests: Outpost site mapping, resource annotation, edge creation, fleet cluster mapping from EKS Outpost config.

---

### Step 3C: GCP Hybrid Discovery (Parallel with 3A and 3B)

**Location**: `extensions/gcp/src/hybrid/`  
**Files**: 3  
**Estimated LOC**: ~700

#### Dependencies

```
@google-cloud/gke-hub             ← Fleet/membership management (new)
```

Existing `@google-cloud/container` handles GKE cluster details.

#### `types.ts` — GCP Hybrid Types (~100 LOC)

```typescript
type GKEFleet = {
  name: string;                    // projects/*/locations/*/fleets/*
  displayName?: string;
  createTime: string;
  updateTime: string;
  state: {
    code: "OK" | "WARNING" | "ERROR";
  };
};

type GKEFleetMembership = {
  name: string;                    // projects/*/locations/*/memberships/*
  endpoint: {
    gkeCluster?: {
      resourceLink: string;        // GKE cluster resource path
      clusterMissing: boolean;
    };
    onPremCluster?: {
      resourceLink: string;
      clusterMissing: boolean;
      adminCluster: boolean;
    };
    multiCloudCluster?: {
      resourceLink: string;
      clusterMissing: boolean;
    };
    kubernetesMetadata?: {
      kubernetesApiServerVersion: string;
      nodeCount: number;
      vcpuCount: number;
      memoryMb: number;
      updateTime: string;
    };
  };
  state: {
    code: "READY" | "CREATING" | "DELETING" | "UPDATING" | "SERVICE_UPDATING";
  };
  authority?: {
    issuer: string;
  };
  labels: Record<string, string>;
  createTime: string;
  updateTime: string;
};

type GDCNode = {
  name: string;
  location: string;               // Physical location identifier
  type: "connected" | "air-gapped";
  status: "RUNNING" | "PROVISIONING" | "STOPPED" | "ERROR";
  hardwareInfo?: {
    model: string;
    serialNumber: string;
  };
  kubernetesVersion: string;
};
```

#### `fleet-discovery.ts` — GKE Enterprise Fleet Discovery (~300 LOC)

```typescript
class GKEFleetDiscoveryAdapter implements HybridDiscoveryAdapter {
  provider = "gcp" as const;

  constructor(private config: { projectId: string; credentials: any });

  // Discover all fleets in the project
  async discoverFleets(): Promise<GKEFleet[]>;
  // Uses: GkeHubClient.listFleets()

  // Discover all fleet memberships (clusters registered to fleet)
  async discoverMemberships(fleetName?: string): Promise<GKEFleetMembership[]>;
  // Uses: GkeHubClient.listMemberships()
  // Includes GKE clusters, attached clusters (EKS/AKS), on-prem clusters

  // Discover multi-cloud GKE clusters (GKE on AWS/Azure)
  async discoverMultiCloudClusters(): Promise<FleetCluster[]>;
  // Uses: gkemulticloud.googleapis.com

  // Map memberships to unified fleet clusters
  async discoverFleetClusters(): Promise<FleetCluster[]>;
  // Classifies each membership: gke, attached, on-prem, multi-cloud

  // Map fleets to edge sites (on-prem memberships → infer site)
  async discoverSites(): Promise<HybridSite[]>;

  // Map to Knowledge Graph nodes
  async discoverHybridResources(): Promise<GraphNodeInput[]>;

  async healthCheck(): Promise<boolean>;
}
```

#### `gdc-discovery.ts` — Google Distributed Cloud Discovery (~250 LOC)

```typescript
class GDCDiscoveryAdapter implements HybridDiscoveryAdapter {
  provider = "gdc" as const;

  constructor(private config: {
    projectId: string;
    credentials: any;
    // For connected mode: uses standard googleapis.com
    // For air-gapped mode (phase 2): localApiEndpoint: string
  });

  // Discover GDC connected nodes
  async discoverGDCNodes(): Promise<GDCNode[]>;
  // Uses fleet membership API — GDC connected nodes appear as fleet members

  // Map GDC nodes to edge sites
  async discoverSites(): Promise<HybridSite[]>;

  // Map GDC clusters to fleet clusters
  async discoverFleetClusters(): Promise<FleetCluster[]>;

  // Map to Knowledge Graph nodes
  async discoverHybridResources(): Promise<GraphNodeInput[]>;

  async healthCheck(): Promise<boolean>;
}

// Phase 2: Air-gapped GDC adapter
// class GDCAirGappedDiscoveryAdapter implements HybridDiscoveryAdapter {
//   constructor(private config: {
//     localApiEndpoint: string;  // e.g., https://gdc-control-plane.internal
//     localCredentials: any;      // Local IAM, not Google Cloud IAM
//   });
//   // Uses mirrored GCP APIs at local endpoint
// }
```

**Graph node mapping**:

| GCP Resource | KG Resource Type | Edges Created |
|---|---|---|
| GKE Fleet | `fleet` | — (group node) |
| Fleet membership (GKE) | `kubernetes-cluster` | `member-of-fleet` → fleet |
| Fleet membership (attached EKS/AKS) | `connected-cluster` | `member-of-fleet` → fleet, `managed-by` → GCP |
| Fleet membership (on-prem) | `connected-cluster` | `member-of-fleet` → fleet, `deployed-at` → edge site |
| GDC connected node | `edge-site` | `connected-to` → GCP region |
| Multi-cloud GKE (on AWS) | `kubernetes-cluster` | `managed-by` → GCP, `runs-in` → AWS region |
| Multi-cloud GKE (on Azure) | `kubernetes-cluster` | `managed-by` → GCP, `runs-in` → Azure region |

#### Tests

15 tests: fleet membership parsing, cluster classification, multi-cloud mapping, GDC node discovery.

---

### Step 4: Cross-Boundary Analysis Tools

**Location**: `extensions/hybrid-cloud/src/cross-boundary-analysis.ts`  
**Estimated LOC**: ~400 (included in Step 2 estimate)

This is where Espada's unique value becomes undeniable. These are queries that **no other product can answer**:

#### Analysis Capabilities

**1. Cloud Region Impact** — "If `us-east-1` goes down, what happens to my edge sites?"
```
Input:  { region: "us-east-1", provider: "aws" }
Output: 3 Outpost sites lose management plane
        2 sites can operate in disconnected mode (EKS local)
        1 site will fail (depends on cloud-hosted RDS)
        47 edge resources affected
```

**2. Edge Site Impact** — "If the Seattle warehouse goes offline, what cloud services break?"
```
Input:  { siteId: "aws:123:outpost-seattle:edge-site:site-123" }
Output: IoT data pipeline loses 2 source endpoints
        3 Lambda functions process data from this site
        CloudWatch dashboards will show gaps
        Blast radius: 12 cloud resources affected
```

**3. Disconnected Operation Assessment** — "Which workloads survive without cloud?"
```
Output: Fully disconnectable:     4 clusters (local storage, no cloud deps)
        Partially disconnectable: 2 clusters (lose monitoring, keep workloads)
        Requires connectivity:    1 cluster (depends on cloud DB)
```

**4. Fleet Drift** — "Are all my clusters consistent?"
```
Output: 7 clusters in fleet
        Version skew: cluster-3 running 1.27, rest on 1.29
        Policy drift: cluster-5 missing "deny-privileged-pods" policy
        Config drift: cluster-2 has different resource quotas
        Fleet consistency score: 72/100
```

**5. Hybrid DR Posture** — "How resilient is my hybrid infrastructure?"
```
Output: Overall score: 61/100 (Grade: C)
        Single-region risks:
          us-east-1: 3 edge sites, NO failover region (CRITICAL)
          westus2: 1 Azure Local cluster, failover to eastus2 (OK)
        Edge site risks:
          Seattle warehouse: no backup cluster (HIGH)
          Tokyo factory: active-active with Osaka (OK)
        Recommendations:
          - Add multi-region for us-east-1 Outpost management
          - Deploy backup HCI node at Seattle warehouse
```

---

### Step 5: Integration Tests

**Estimated tests**: 85+ total across all components

| Component | Tests | Focus |
|---|:---:|---|
| KG type extensions | 10 | New node/edge/location types, serialization |
| `extensions/hybrid-cloud/` | 25 | Topology construction, coordinator, cross-boundary analysis |
| Azure hybrid discovery | 20 | ARM API mocking, node mapping, Arc/HCI resource types |
| AWS hybrid discovery | 15 | Outpost site mapping, resource annotation, fleet clusters |
| GCP hybrid discovery | 15 | Fleet membership parsing, multi-cloud mapping, GDC nodes |

---

## Scope Summary

| Component | Files | LOC (est.) | Tests |
|---|:---:|:---:|:---:|
| Knowledge Graph type extensions | 1 | ~200 | 10 |
| `extensions/hybrid-cloud/` (new) | 8 | ~1,200 | 25 |
| `extensions/azure/src/hybrid/` (new) | 3 | ~800 | 20 |
| `extensions/aws/src/hybrid/` (new) | 2 | ~500 | 15 |
| `extensions/gcp/src/hybrid/` (new) | 3 | ~700 | 15 |
| **Total** | **17 files** | **~3,400 LOC** | **85+ tests** |

---

## Phasing

### Phase 1: Core (ship first)
- Knowledge Graph type extensions
- `extensions/hybrid-cloud/` shared types + coordinator + tools + CLI
- Azure Arc + Azure Local discovery (highest leverage — same ARM SDK)
- AWS Outposts discovery (partially done already)
- GKE Enterprise fleet discovery

### Phase 2: Advanced (fast follow)
- Cross-boundary blast radius analysis
- Disconnected operation assessment
- Fleet drift analysis
- Hybrid DR posture (integrates with Feature 9 from enterprise roadmap)
- GDC connected discovery
- Arc-enabled VMware vSphere discovery (VMware coverage via Azure Arc)

### Phase 3: Air-Gapped (customer-driven)
- GDC air-gapped adapter (local API endpoints, local IAM)
- Nutanix adapter (Prism Central REST API)
- Native VMware adapter (vSphere REST API, for customers not using Azure Arc)
- Edge-specific policy types (e.g., "deny if site is disconnected")

---

## Verification Checklist

- [ ] `pnpm build` — 0 type errors across all touched extensions
- [ ] `pnpm test` — all 85+ new tests pass
- [ ] `pnpm lint` — no violations
- [ ] `espada hybrid status` shows cloud regions + edge sites from all 3 providers
- [ ] `espada hybrid fleet` shows Kubernetes clusters across Azure Arc, AWS Outposts, GKE Enterprise
- [ ] `espada hybrid topology` renders unified view (text + Mermaid export)
- [ ] `espada hybrid blast-radius --target us-east-1 --type region` returns cross-boundary impact
- [ ] Knowledge Graph queries traverse cloud/edge boundaries correctly
- [ ] Audit events emitted for all hybrid discovery operations
- [ ] Policy engine can evaluate policies on hybrid resources

---

## Why No Competitor Can Copy This Quickly

1. **Spacelift/Env0** are IaC stack managers — they don't have a resource topology graph. Building one is a ground-up effort (6–12 months minimum).
2. **Firefly** has a "Cloud Map" but it's flat resource inventory, not a typed Knowledge Graph with algorithms (Tarjan's, BFS blast radius, connected components).
3. **None of them** model physical locations, connectivity status, or disconnected operations.
4. **The cross-boundary analysis** (cloud region → edge site blast radius) requires both the graph AND the hybrid discovery — neither alone is sufficient.

Espada would be **the only platform** where an SRE can ask: *"If Azure's West US 2 region goes down, which of my factory floor HCI clusters lose their management plane, and which ones can keep running?"* — and get an answer in seconds via Slack, Terminal, or Voice.
