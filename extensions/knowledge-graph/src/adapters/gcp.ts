/**
 * Infrastructure Knowledge Graph — GCP Adapter
 *
 * Maps GCP resources into the universal graph model using the Cloud Asset
 * Inventory API for bulk discovery. Supports AI workloads
 * (Vertex AI, Cloud TPU, GPU VMs).
 *
 * GCP SDK dependencies are loaded dynamically at runtime — this module
 * works with @google-cloud/asset and google-auth-library if installed.
 */

import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphRelationshipType,
  CloudProvider,
} from "../types.js";
import type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

// =============================================================================
// GCP Resource Type → Graph Type Mapping
// =============================================================================

export type GcpResourceMapping = {
  /** GCP asset type, e.g. "compute.googleapis.com/Instance". */
  gcpType: string;
  /** Mapped graph resource type. */
  graphType: GraphResourceType;
  /** Whether this is an AI/ML workload. */
  isAiWorkload?: boolean;
};

export const GCP_RESOURCE_MAPPINGS: GcpResourceMapping[] = [
  // Compute
  { gcpType: "compute.googleapis.com/Instance", graphType: "compute" },
  { gcpType: "compute.googleapis.com/InstanceGroup", graphType: "compute" },
  { gcpType: "compute.googleapis.com/InstanceGroupManager", graphType: "compute" },
  { gcpType: "compute.googleapis.com/InstanceTemplate", graphType: "compute" },

  // Containers
  { gcpType: "container.googleapis.com/Cluster", graphType: "cluster" },
  { gcpType: "container.googleapis.com/NodePool", graphType: "compute" },
  { gcpType: "run.googleapis.com/Service", graphType: "container" },

  // Serverless
  { gcpType: "cloudfunctions.googleapis.com/Function", graphType: "serverless-function" },
  { gcpType: "cloudfunctions.googleapis.com/CloudFunction", graphType: "serverless-function" },

  // Networking
  { gcpType: "compute.googleapis.com/Network", graphType: "vpc" },
  { gcpType: "compute.googleapis.com/Subnetwork", graphType: "subnet" },
  { gcpType: "compute.googleapis.com/Firewall", graphType: "security-group" },
  { gcpType: "compute.googleapis.com/ForwardingRule", graphType: "load-balancer" },
  { gcpType: "compute.googleapis.com/TargetHttpProxy", graphType: "load-balancer" },
  { gcpType: "compute.googleapis.com/TargetHttpsProxy", graphType: "load-balancer" },
  { gcpType: "compute.googleapis.com/UrlMap", graphType: "load-balancer" },
  { gcpType: "compute.googleapis.com/BackendService", graphType: "load-balancer" },
  { gcpType: "compute.googleapis.com/Address", graphType: "network" },
  { gcpType: "compute.googleapis.com/Router", graphType: "nat-gateway" },
  { gcpType: "dns.googleapis.com/ManagedZone", graphType: "dns" },

  // Database
  { gcpType: "sqladmin.googleapis.com/Instance", graphType: "database" },
  { gcpType: "spanner.googleapis.com/Instance", graphType: "database" },
  { gcpType: "bigtable.googleapis.com/Instance", graphType: "database" },
  { gcpType: "firestore.googleapis.com/Database", graphType: "database" },

  // Cache
  { gcpType: "redis.googleapis.com/Instance", graphType: "cache" },
  { gcpType: "memcache.googleapis.com/Instance", graphType: "cache" },

  // Storage
  { gcpType: "storage.googleapis.com/Bucket", graphType: "storage" },
  { gcpType: "compute.googleapis.com/Disk", graphType: "storage" },

  // Messaging
  { gcpType: "pubsub.googleapis.com/Topic", graphType: "topic" },
  { gcpType: "pubsub.googleapis.com/Subscription", graphType: "queue" },

  // Security / Identity
  { gcpType: "secretmanager.googleapis.com/Secret", graphType: "secret" },
  { gcpType: "iam.googleapis.com/ServiceAccount", graphType: "identity" },
  { gcpType: "cloudkms.googleapis.com/CryptoKey", graphType: "secret" },

  // API Gateway
  { gcpType: "apigateway.googleapis.com/Gateway", graphType: "api-gateway" },

  // CDN
  { gcpType: "compute.googleapis.com/BackendBucket", graphType: "cdn" },

  // AI / ML
  { gcpType: "aiplatform.googleapis.com/Endpoint", graphType: "custom", isAiWorkload: true },
  { gcpType: "aiplatform.googleapis.com/Model", graphType: "custom", isAiWorkload: true },
  { gcpType: "aiplatform.googleapis.com/TrainingPipeline", graphType: "custom", isAiWorkload: true },
  { gcpType: "aiplatform.googleapis.com/CustomJob", graphType: "custom", isAiWorkload: true },
  { gcpType: "notebooks.googleapis.com/Instance", graphType: "custom", isAiWorkload: true },
  { gcpType: "tpu.googleapis.com/Node", graphType: "custom", isAiWorkload: true },
];

// =============================================================================
// GCP Relationship Rules
// =============================================================================

export type GcpRelationshipRule = {
  sourceType: string;
  field: string;
  targetType: string;
  relationship: GraphRelationshipType;
  isArray: boolean;
};

export const GCP_RELATIONSHIP_RULES: GcpRelationshipRule[] = [
  // Instances → Network/Subnet
  { sourceType: "compute.googleapis.com/Instance", field: "networkInterfaces[].network", targetType: "compute.googleapis.com/Network", relationship: "runs-in", isArray: true },
  { sourceType: "compute.googleapis.com/Instance", field: "networkInterfaces[].subnetwork", targetType: "compute.googleapis.com/Subnetwork", relationship: "runs-in", isArray: true },
  { sourceType: "compute.googleapis.com/Instance", field: "disks[].source", targetType: "compute.googleapis.com/Disk", relationship: "attached-to", isArray: true },
  { sourceType: "compute.googleapis.com/Instance", field: "serviceAccounts[].email", targetType: "iam.googleapis.com/ServiceAccount", relationship: "uses", isArray: true },

  // Subnetwork → Network
  { sourceType: "compute.googleapis.com/Subnetwork", field: "network", targetType: "compute.googleapis.com/Network", relationship: "runs-in", isArray: false },

  // Firewall → Network
  { sourceType: "compute.googleapis.com/Firewall", field: "network", targetType: "compute.googleapis.com/Network", relationship: "secures", isArray: false },

  // GKE → Subnetwork
  { sourceType: "container.googleapis.com/Cluster", field: "subnetwork", targetType: "compute.googleapis.com/Subnetwork", relationship: "runs-in", isArray: false },
  { sourceType: "container.googleapis.com/Cluster", field: "network", targetType: "compute.googleapis.com/Network", relationship: "runs-in", isArray: false },

  // Cloud Functions → Network
  { sourceType: "cloudfunctions.googleapis.com/Function", field: "serviceAccountEmail", targetType: "iam.googleapis.com/ServiceAccount", relationship: "uses", isArray: false },

  // Pub/Sub Subscription → Topic
  { sourceType: "pubsub.googleapis.com/Subscription", field: "topic", targetType: "pubsub.googleapis.com/Topic", relationship: "subscribes-to", isArray: false },

  // Cloud SQL → Network
  { sourceType: "sqladmin.googleapis.com/Instance", field: "settings.ipConfiguration.privateNetwork", targetType: "compute.googleapis.com/Network", relationship: "runs-in", isArray: false },

  // Vertex AI endpoint → model
  { sourceType: "aiplatform.googleapis.com/Endpoint", field: "deployedModels[].model", targetType: "aiplatform.googleapis.com/Model", relationship: "depends-on", isArray: true },
];

// =============================================================================
// Configuration
// =============================================================================

export type GcpAdapterConfig = {
  /** GCP project ID. */
  projectId: string;
  /** Service account key file path (for authentication). */
  keyFilePath?: string;
  /** Service account key JSON (alternative to keyFilePath). */
  keyFileContents?: string;
  /**
   * Optional client factory for dependency injection / testing.
   */
  clientFactory?: GcpClientFactory;
};

export type GcpClientFactory = (
  projectId: string,
  config?: { credentials?: unknown },
) => GcpAssetClient;

/** Minimal interface for Cloud Asset Inventory results. */
export type GcpAssetClient = {
  listAssets(parent: string, assetTypes?: string[]): Promise<GcpAssetRecord[]>;
  dispose?: () => void;
};

export type GcpAssetRecord = {
  /** Full resource name: "//compute.googleapis.com/projects/proj/zones/zone/instances/name" */
  name: string;
  /** Asset type: "compute.googleapis.com/Instance" */
  assetType: string;
  /** Resource data (properties). */
  resource: {
    data: Record<string, unknown>;
    discoveryName?: string;
    parent?: string;
    location?: string;
    version?: string;
  };
  /** IAM policy (optional). */
  iamPolicy?: unknown;
};

// =============================================================================
// Node ID
// =============================================================================

export function buildGcpNodeId(
  projectId: string,
  resourceType: GraphResourceType,
  nativeId: string,
): string {
  return `gcp:${projectId}:${resourceType}:${extractGcpShortId(nativeId)}`;
}

function extractGcpShortId(fullName: string): string {
  // //compute.googleapis.com/projects/p/zones/z/instances/name → instances/name
  const parts = fullName.replace(/^\/\/[^/]+\//, "").split("/");
  return parts.slice(-2).join("/").toLowerCase();
}

// =============================================================================
// GCP Discovery Adapter
// =============================================================================

/**
 * GCP Discovery Adapter.
 *
 * Uses Cloud Asset Inventory API for efficient bulk resource discovery.
 * A single paginated call retrieves all assets in the project.
 *
 * Credential handling:
 * - Application Default Credentials (gcloud auth, GOOGLE_APPLICATION_CREDENTIALS)
 * - Service account key file
 * - Custom client factory for testing
 */
export class GcpDiscoveryAdapter implements GraphDiscoveryAdapter {
  readonly provider: CloudProvider = "gcp";
  readonly displayName = "Google Cloud Platform";

  private config: GcpAdapterConfig;
  private sdkAvailable: boolean | null = null;

  constructor(config: GcpAdapterConfig) {
    this.config = config;
  }

  supportedResourceTypes(): GraphResourceType[] {
    const types = new Set<GraphResourceType>();
    for (const mapping of GCP_RESOURCE_MAPPINGS) {
      types.add(mapping.graphType);
    }
    return [...types];
  }

  /**
   * Discover all GCP resources using Cloud Asset Inventory.
   */
  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startMs = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: DiscoveryError[] = [];

    if (!(await this.ensureSdkAvailable())) {
      return {
        provider: "gcp",
        nodes: [],
        edges: [],
        errors: [{
          resourceType: "custom",
          message: "GCP SDK (@google-cloud/asset) is not installed.",
        }],
        durationMs: Date.now() - startMs,
      };
    }

    try {
      const client = await this.createClient();
      if (!client) {
        return {
          provider: "gcp",
          nodes: [],
          edges: [],
          errors: [{ resourceType: "custom", message: "Failed to create Cloud Asset client." }],
          durationMs: Date.now() - startMs,
        };
      }

      try {
        // Determine which asset types to query
        const assetTypes = this.getAssetTypesForOptions(options);
        const parent = `projects/${this.config.projectId}`;

        const assets = await client.listAssets(parent, assetTypes);

        // Build lookup: GCP full name → node ID
        const gcpNameToNodeId = new Map<string, string>();

        for (const asset of assets) {
          if (options?.signal?.aborted) break;

          const mapping = this.resolveMapping(asset.assetType);
          if (!mapping) continue;

          const data = asset.resource.data;
          const tags = this.extractLabels(data);

          // Apply tag filter
          if (options?.tags) {
            const match = Object.entries(options.tags).every(
              ([k, v]) => tags[k] === v,
            );
            if (!match) continue;
          }

          const nodeId = buildGcpNodeId(
            this.config.projectId,
            mapping.graphType,
            asset.name,
          );
          gcpNameToNodeId.set(asset.name, nodeId);

          // Also index by selfLink for relationship resolution
          const selfLink = data["selfLink"] as string;
          if (selfLink) gcpNameToNodeId.set(selfLink, nodeId);

          const node = this.mapAssetToNode(asset, mapping, nodeId, tags);
          nodes.push(node);
        }

        // Second pass: extract relationships
        for (const asset of assets) {
          if (options?.signal?.aborted) break;

          const mapping = this.resolveMapping(asset.assetType);
          if (!mapping) continue;

          const sourceNodeId = gcpNameToNodeId.get(asset.name);
          if (!sourceNodeId) continue;

          const resourceEdges = this.extractRelationships(
            sourceNodeId,
            asset,
            gcpNameToNodeId,
          );
          edges.push(...resourceEdges);
        }
      } finally {
        client.dispose?.();
      }
    } catch (error) {
      errors.push({
        resourceType: "custom",
        message: `GCP discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const limitedNodes = options?.limit ? nodes.slice(0, options.limit) : nodes;

    return {
      provider: "gcp",
      nodes: limitedNodes,
      edges,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  supportsIncrementalSync(): boolean {
    // GCP Audit Log integration is Phase 6
    return false;
  }

  /**
   * Verify GCP credentials by listing a single asset.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.createClient();
      if (!client) return false;

      try {
        const assets = await client.listAssets(
          `projects/${this.config.projectId}`,
          ["compute.googleapis.com/Instance"],
        );
        return Array.isArray(assets);
      } finally {
        client.dispose?.();
      }
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Asset Type Filtering
  // ===========================================================================

  private getAssetTypesForOptions(options?: DiscoverOptions): string[] | undefined {
    if (!options?.resourceTypes) {
      return GCP_RESOURCE_MAPPINGS.map((m) => m.gcpType);
    }

    return options.resourceTypes.flatMap((rt) =>
      GCP_RESOURCE_MAPPINGS
        .filter((m) => m.graphType === rt)
        .map((m) => m.gcpType),
    );
  }

  // ===========================================================================
  // Resource → Node Mapping
  // ===========================================================================

  private resolveMapping(gcpType: string): GcpResourceMapping | undefined {
    return GCP_RESOURCE_MAPPINGS.find((m) => m.gcpType === gcpType);
  }

  private mapAssetToNode(
    asset: GcpAssetRecord,
    mapping: GcpResourceMapping,
    nodeId: string,
    tags: Record<string, string>,
  ): GraphNodeInput {
    const data = asset.resource.data;
    const location = this.extractLocation(asset);

    return {
      id: nodeId,
      provider: "gcp",
      resourceType: mapping.graphType,
      nativeId: asset.name,
      name: tags["name"] ?? (data["name"] as string) ?? (data["displayName"] as string) ?? extractGcpShortId(asset.name),
      region: location,
      account: this.config.projectId,
      status: this.inferStatus(data),
      tags,
      metadata: {
        ...this.extractMetadata(asset, mapping),
        ...(mapping.isAiWorkload ? { aiWorkload: true } : {}),
      },
      costMonthly: this.estimateCost(asset, mapping),
      owner: tags["owner"] ?? tags["team"] ?? null,
      createdAt: (data["creationTimestamp"] as string)
        ?? (data["createTime"] as string)
        ?? null,
    };
  }

  // ===========================================================================
  // Location Extraction
  // ===========================================================================

  private extractLocation(asset: GcpAssetRecord): string {
    // Try resource.location first
    if (asset.resource.location) return asset.resource.location;

    // Parse from name: //compute.googleapis.com/projects/p/zones/us-central1-a/instances/i
    const zoneMatch = asset.name.match(/\/zones\/([^/]+)\//);
    if (zoneMatch) {
      // Strip zone letter to get region: us-central1-a → us-central1
      return zoneMatch[1]!.replace(/-[a-z]$/, "");
    }

    const regionMatch = asset.name.match(/\/regions\/([^/]+)\//);
    if (regionMatch) return regionMatch[1]!;

    const locationMatch = asset.name.match(/\/locations\/([^/]+)\//);
    if (locationMatch) return locationMatch[1]!;

    return "global";
  }

  // ===========================================================================
  // Status Inference
  // ===========================================================================

  private inferStatus(data: Record<string, unknown>): GraphNodeInput["status"] {
    const status = (data["status"] as string)?.toUpperCase()
      ?? (data["state"] as string)?.toUpperCase();

    if (status) {
      if (status === "RUNNING" || status === "READY" || status === "ACTIVE" || status === "SERVING") return "running";
      if (status === "TERMINATED" || status === "STOPPED" || status === "SUSPENDED") return "stopped";
      if (status === "STAGING" || status === "PROVISIONING" || status === "CREATING") return "creating";
      if (status === "STOPPING" || status === "DELETING") return "deleting";
      if (status === "ERROR" || status === "FAILED") return "error";
    }

    return "running";
  }

  // ===========================================================================
  // Metadata Extraction
  // ===========================================================================

  private extractMetadata(
    asset: GcpAssetRecord,
    mapping: GcpResourceMapping,
  ): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    const data = asset.resource.data;

    switch (mapping.gcpType) {
      case "compute.googleapis.com/Instance": {
        const machineType = data["machineType"] as string;
        if (machineType) {
          // "zones/us-central1-a/machineTypes/n1-standard-4" → "n1-standard-4"
          const mt = machineType.split("/").pop() ?? machineType;
          meta["machineType"] = mt;

          // Detect GPU/AI instances
          if (/^(a2-|a3-|g2-)/.test(mt)) {
            meta["isGpuInstance"] = true;
            meta["aiWorkload"] = true;
          }
        }

        // Check attached accelerators (GPUs)
        const accelerators = data["guestAccelerators"] as unknown[];
        if (Array.isArray(accelerators) && accelerators.length > 0) {
          meta["isGpuInstance"] = true;
          meta["aiWorkload"] = true;
          meta["accelerators"] = accelerators.map((a: unknown) => {
            const acc = a as Record<string, unknown>;
            return { type: acc["acceleratorType"], count: acc["acceleratorCount"] };
          });
        }

        if (data["canIpForward"]) meta["canIpForward"] = true;
        break;
      }
      case "container.googleapis.com/Cluster": {
        if (data["currentMasterVersion"]) meta["masterVersion"] = data["currentMasterVersion"];
        if (data["currentNodeVersion"]) meta["nodeVersion"] = data["currentNodeVersion"];
        const pools = data["nodePools"] as unknown[];
        if (Array.isArray(pools)) {
          meta["nodePoolCount"] = pools.length;
          meta["totalNodes"] = pools.reduce(
            (sum: number, p: unknown) => sum + ((p as Record<string, unknown>)["initialNodeCount"] as number ?? 0),
            0,
          );
        }
        break;
      }
      case "sqladmin.googleapis.com/Instance": {
        const settings = data["settings"] as Record<string, unknown>;
        if (settings) {
          if (settings["tier"]) meta["tier"] = settings["tier"];
          if (settings["databaseVersion"]) meta["databaseVersion"] = settings["databaseVersion"];
          if (settings["dataDiskSizeGb"]) meta["diskSizeGb"] = settings["dataDiskSizeGb"];
          if (settings["availabilityType"]) meta["availabilityType"] = settings["availabilityType"];
        }
        break;
      }
      case "storage.googleapis.com/Bucket": {
        if (data["storageClass"]) meta["storageClass"] = data["storageClass"];
        if (data["iamConfiguration"]) {
          const iamConfig = data["iamConfiguration"] as Record<string, unknown>;
          const uniformAccess = iamConfig["uniformBucketLevelAccess"] as Record<string, unknown>;
          if (uniformAccess?.["enabled"] === false) meta["legacyAcl"] = true;
          const publicAccess = iamConfig["publicAccessPrevention"];
          if (publicAccess === "inherited") meta["publicAccessEnabled"] = true;
        }
        if (data["versioning"]) meta["versioning"] = data["versioning"];
        break;
      }
      case "aiplatform.googleapis.com/Endpoint": {
        const deployedModels = data["deployedModels"] as unknown[];
        if (Array.isArray(deployedModels)) {
          meta["deployedModelCount"] = deployedModels.length;
        }
        break;
      }
      case "tpu.googleapis.com/Node": {
        if (data["acceleratorType"]) meta["tpuType"] = data["acceleratorType"];
        meta["aiWorkload"] = true;
        meta["isGpuInstance"] = true;
        break;
      }
    }

    return meta;
  }

  // ===========================================================================
  // Label Extraction
  // ===========================================================================

  private extractLabels(data: Record<string, unknown>): Record<string, string> {
    const labels = data["labels"];
    if (labels && typeof labels === "object" && !Array.isArray(labels)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(labels as Record<string, unknown>)) {
        if (typeof v === "string") result[k] = v;
      }
      return result;
    }
    return {};
  }

  // ===========================================================================
  // Relationship Extraction
  // ===========================================================================

  private extractRelationships(
    sourceNodeId: string,
    asset: GcpAssetRecord,
    gcpNameToNodeId: Map<string, string>,
  ): GraphEdgeInput[] {
    const edges: GraphEdgeInput[] = [];
    const data = asset.resource.data;

    for (const rule of GCP_RELATIONSHIP_RULES) {
      if (rule.sourceType !== asset.assetType) continue;

      const values = resolveGcpField(data, rule.field);
      for (const value of values) {
        // GCP references can be selfLinks, full resource names, or short names
        const targetNodeId = this.resolveGcpReference(String(value), gcpNameToNodeId);
        if (targetNodeId && targetNodeId !== sourceNodeId) {
          edges.push({
            id: `${sourceNodeId}--${rule.relationship}--${targetNodeId}`,
            sourceNodeId,
            targetNodeId,
            relationshipType: rule.relationship,
            confidence: 0.9,
            discoveredVia: "api-field",
            metadata: { field: rule.field },
          });
        }
      }
    }

    return edges;
  }

  /**
   * Resolve a GCP resource reference to a known node ID.
   * GCP references can be selfLinks, full resource names, or partial paths.
   */
  private resolveGcpReference(
    ref: string,
    gcpNameToNodeId: Map<string, string>,
  ): string | null {
    // Try direct match (selfLink or full name)
    const direct = gcpNameToNodeId.get(ref);
    if (direct) return direct;

    // Try as a selfLink (https://...)
    if (ref.startsWith("https://")) {
      // Convert selfLink to resource name format
      const match = ref.match(/https:\/\/([^/]+)\.googleapis\.com\/(.+)/);
      if (match) {
        const fullName = `//${match[1]}.googleapis.com/${match[2]}`;
        const found = gcpNameToNodeId.get(fullName);
        if (found) return found;
      }
    }

    // Try partial match (iterate — only for small graphs)
    for (const [name, nodeId] of gcpNameToNodeId) {
      if (name.endsWith(`/${ref}`) || name.endsWith(ref)) {
        return nodeId;
      }
    }

    return null;
  }

  // ===========================================================================
  // Cost Estimation
  // ===========================================================================

  private estimateCost(
    asset: GcpAssetRecord,
    mapping: GcpResourceMapping,
  ): number | null {
    const data = asset.resource.data;

    switch (mapping.gcpType) {
      case "compute.googleapis.com/Instance": {
        const machineType = ((data["machineType"] as string) ?? "").split("/").pop() ?? "";
        return GCP_VM_COSTS[machineType.toLowerCase()] ?? null;
      }
      case "sqladmin.googleapis.com/Instance": {
        const tier = ((data["settings"] as Record<string, unknown>)?.["tier"] as string) ?? "";
        return GCP_SQL_COSTS[tier.toLowerCase()] ?? null;
      }
      case "redis.googleapis.com/Instance": {
        const memorySizeGb = (data["memorySizeGb"] as number) ?? 1;
        return memorySizeGb * 48; // ~$0.049/GB/hr for Standard tier
      }
      case "container.googleapis.com/Cluster": {
        // GKE management fee + estimated node costs
        const pools = data["nodePools"] as unknown[];
        if (Array.isArray(pools)) {
          let total = 73; // GKE management fee ~$73/mo
          for (const pool of pools) {
            const p = pool as Record<string, unknown>;
            const count = (p["initialNodeCount"] as number) ?? 1;
            const config = p["config"] as Record<string, unknown>;
            const mt = ((config?.["machineType"] as string) ?? "").toLowerCase();
            const perVm = GCP_VM_COSTS[mt];
            if (perVm) total += perVm * count;
          }
          return total;
        }
        return 73; // Control plane only
      }
      case "tpu.googleapis.com/Node": {
        const tpuType = (data["acceleratorType"] as string) ?? "";
        return GCP_TPU_COSTS[tpuType.toLowerCase()] ?? null;
      }
    }

    return null;
  }

  // ===========================================================================
  // SDK Loading
  // ===========================================================================

  private async ensureSdkAvailable(): Promise<boolean> {
    if (this.config.clientFactory) {
      this.sdkAvailable = true;
      return true;
    }

    if (this.sdkAvailable !== null) return this.sdkAvailable;

    try {
      await import("@google-cloud/asset");
      this.sdkAvailable = true;
    } catch {
      this.sdkAvailable = false;
    }

    return this.sdkAvailable;
  }

  private async createClient(): Promise<GcpAssetClient | null> {
    if (this.config.clientFactory) {
      return this.config.clientFactory(this.config.projectId);
    }

    try {
      const assetModule = await import("@google-cloud/asset");

      const clientConfig: Record<string, unknown> = {
        projectId: this.config.projectId,
      };
      if (this.config.keyFilePath) {
        clientConfig["keyFilename"] = this.config.keyFilePath;
      }
      if (this.config.keyFileContents) {
        clientConfig["credentials"] = JSON.parse(this.config.keyFileContents);
      }

      const client = new assetModule.AssetServiceClient(clientConfig as never);

      return {
        listAssets: async (parent: string, assetTypes?: string[]): Promise<GcpAssetRecord[]> => {
          const [assets] = await client.listAssets({
            parent,
            assetTypes: assetTypes ?? [],
            contentType: "RESOURCE",
          });
          return (assets as GcpAssetRecord[]) ?? [];
        },
        dispose: () => {
          client.close();
        },
      };
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Cost Tables (approximate monthly USD, on-demand)
// =============================================================================

const GCP_VM_COSTS: Record<string, number> = {
  // E2 (cost-optimized)
  "e2-micro": 6.11, "e2-small": 12.23, "e2-medium": 24.46,
  "e2-standard-2": 48.92, "e2-standard-4": 97.83, "e2-standard-8": 195.67,
  // N2 (general purpose)
  "n2-standard-2": 69.35, "n2-standard-4": 138.70, "n2-standard-8": 277.40,
  "n2-standard-16": 554.80, "n2-standard-32": 1109.60,
  // N2D
  "n2d-standard-2": 60.12, "n2d-standard-4": 120.25, "n2d-standard-8": 240.49,
  // C2 (compute optimized)
  "c2-standard-4": 152.06, "c2-standard-8": 304.12, "c2-standard-16": 608.24,
  // M2 (memory optimized)
  "m2-megamem-416": 34252.80,
  // A2 / A3 (GPU / AI)
  "a2-highgpu-1g": 2556.14, "a2-highgpu-2g": 5112.28, "a2-highgpu-4g": 10224.56, "a2-highgpu-8g": 20449.12,
  "a2-megagpu-16g": 40898.24,
  "a3-highgpu-8g": 28032.00,
  // G2 (GPU for inference)
  "g2-standard-4": 513.36, "g2-standard-8": 857.52, "g2-standard-16": 1545.84,
};

const GCP_SQL_COSTS: Record<string, number> = {
  "db-f1-micro": 8.61, "db-g1-small": 26.73,
  "db-n1-standard-1": 51.10, "db-n1-standard-2": 102.20, "db-n1-standard-4": 204.40,
  "db-n1-standard-8": 408.80, "db-n1-standard-16": 817.60,
  "db-n1-highmem-2": 131.40, "db-n1-highmem-4": 262.80, "db-n1-highmem-8": 525.60,
};

const GCP_TPU_COSTS: Record<string, number> = {
  "v2-8": 3285.00, "v2-32": 13140.00,
  "v3-8": 5840.00, "v3-32": 23360.00,
  "v4-8": 8974.80, "v4-32": 35899.20,
  "v5e-1": 1095.00, "v5e-4": 4380.00, "v5e-8": 8760.00,
  "v5p-8": 13870.80,
};

// =============================================================================
// Field Resolution Helper
// =============================================================================

function resolveGcpField(data: Record<string, unknown>, path: string): string[] {
  if (data == null || typeof data !== "object") return [];

  const parts = path.split(".");
  let current: unknown[] = [data];

  for (const part of parts) {
    const next: unknown[] = [];
    const arrayMatch = part.match(/^(.+?)\[(.*)?\]$/);

    if (arrayMatch) {
      const [, key, indexOrKey] = arrayMatch;
      for (const item of current) {
        if (item == null || typeof item !== "object") continue;
        const value = (item as Record<string, unknown>)[key!];
        if (Array.isArray(value)) {
          if (indexOrKey === "" || indexOrKey === undefined) {
            next.push(...value);
          } else {
            for (const v of value) {
              if (v && typeof v === "object" && (v as Record<string, unknown>)[indexOrKey] !== undefined) {
                next.push((v as Record<string, unknown>)[indexOrKey]);
              }
            }
          }
        }
      }
    } else {
      for (const item of current) {
        if (item == null || typeof item !== "object") continue;
        const value = (item as Record<string, unknown>)[part];
        if (value !== undefined && value !== null) {
          next.push(value);
        }
      }
    }

    current = next;
    if (current.length === 0) break;
  }

  return current
    .flat(Infinity)
    .filter((v) => v != null)
    .map((v) => String(v));
}
