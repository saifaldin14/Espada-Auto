/**
 * Pulumi → Knowledge Graph Bridge
 *
 * Converts parsed Pulumi state into Knowledge Graph nodes and edges,
 * enabling the KG to track Pulumi-managed resources with full lineage.
 *
 * Direction: Pulumi → KG (ingests Pulumi state into the graph).
 */

import type {
  ParsedPulumiResource,
  CloudProvider,
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphStorage,
} from "./types.js";

// ── Pulumi type → KG resource type mapping ──────────────────────────────────

const PULUMI_TYPE_MAP: Record<string, GraphResourceType> = {
  // AWS compute
  "aws:ec2/instance:Instance": "compute",
  "aws:ec2/launchTemplate:LaunchTemplate": "compute",
  "aws:autoscaling/group:Group": "compute",
  // AWS containers
  "aws:ecs/cluster:Cluster": "cluster",
  "aws:ecs/service:Service": "container",
  "aws:ecs/taskDefinition:TaskDefinition": "container",
  "aws:eks/cluster:Cluster": "cluster",
  "aws:eks/nodeGroup:NodeGroup": "cluster",
  // AWS serverless
  "aws:lambda/function:Function": "serverless-function",
  "aws:lambda/layerVersion:LayerVersion": "serverless-function",
  // AWS storage
  "aws:s3/bucket:Bucket": "storage",
  "aws:s3/bucketV2:BucketV2": "storage",
  "aws:s3/bucketPolicy:BucketPolicy": "storage",
  "aws:ebs/volume:Volume": "storage",
  "aws:efs/fileSystem:FileSystem": "storage",
  // AWS database
  "aws:rds/instance:Instance": "database",
  "aws:rds/cluster:Cluster": "database",
  "aws:dynamodb/table:Table": "database",
  "aws:elasticache/cluster:Cluster": "cache",
  "aws:elasticache/replicationGroup:ReplicationGroup": "cache",
  // AWS network
  "aws:ec2/vpc:Vpc": "vpc",
  "aws:ec2/subnet:Subnet": "subnet",
  "aws:ec2/securityGroup:SecurityGroup": "security-group",
  "aws:ec2/internetGateway:InternetGateway": "network",
  "aws:ec2/natGateway:NatGateway": "nat-gateway",
  "aws:ec2/routeTable:RouteTable": "network",
  "aws:route53/zone:Zone": "dns",
  "aws:route53/record:Record": "dns",
  "aws:lb/loadBalancer:LoadBalancer": "load-balancer",
  "aws:alb/loadBalancer:LoadBalancer": "load-balancer",
  "aws:lb/targetGroup:TargetGroup": "load-balancer",
  "aws:cloudfront/distribution:Distribution": "cdn",
  "aws:apigateway/restApi:RestApi": "api-gateway",
  "aws:apigatewayv2/api:Api": "api-gateway",
  // AWS IAM
  "aws:iam/role:Role": "iam-role",
  "aws:iam/policy:Policy": "policy",
  "aws:iam/user:User": "identity",
  // AWS messaging
  "aws:sqs/queue:Queue": "queue",
  "aws:sns/topic:Topic": "topic",
  "aws:kinesis/stream:Stream": "stream",
  // AWS secrets
  "aws:secretsmanager/secret:Secret": "secret",
  "aws:ssm/parameter:Parameter": "secret",
  "aws:kms/key:Key": "secret",
  "aws:acm/certificate:Certificate": "certificate",

  // Azure compute
  "azure-native:compute:VirtualMachine": "compute",
  "azure:compute/virtualMachine:VirtualMachine": "compute",
  "azure:compute/linuxVirtualMachine:LinuxVirtualMachine": "compute",
  "azure:compute/windowsVirtualMachine:WindowsVirtualMachine": "compute",
  // Azure containers
  "azure-native:containerservice:ManagedCluster": "cluster",
  "azure:containerservice/kubernetesCluster:KubernetesCluster": "cluster",
  "azure:containerinstance/group:Group": "container",
  "azure:containerregistry/registry:Registry": "container",
  // Azure serverless
  "azure:appservice/functionApp:FunctionApp": "serverless-function",
  "azure:appservice/linuxFunctionApp:LinuxFunctionApp": "serverless-function",
  // Azure storage
  "azure:storage/account:Account": "storage",
  "azure:storage/container:Container": "storage",
  "azure:compute/managedDisk:ManagedDisk": "storage",
  // Azure database
  "azure:mssql/server:Server": "database",
  "azure:mssql/database:Database": "database",
  "azure:postgresql/server:Server": "database",
  "azure:postgresql/flexibleServer:FlexibleServer": "database",
  "azure:cosmosdb/account:Account": "database",
  "azure:redis/cache:Cache": "cache",
  // Azure network
  "azure:network/virtualNetwork:VirtualNetwork": "vpc",
  "azure:network/subnet:Subnet": "subnet",
  "azure:network/networkSecurityGroup:NetworkSecurityGroup": "security-group",
  "azure:network/publicIp:PublicIp": "network",
  "azure:lb/loadBalancer:LoadBalancer": "load-balancer",
  "azure:network/applicationGateway:ApplicationGateway": "load-balancer",
  "azure:dns/zone:Zone": "dns",
  "azure:cdn/profile:Profile": "cdn",
  // Azure secrets
  "azure:keyvault/vault:Vault": "secret",
  "azure:keyvault/secret:Secret": "secret",

  // GCP compute
  "gcp:compute/instance:Instance": "compute",
  "gcp:compute/instanceGroup:InstanceGroup": "compute",
  "gcp:compute/instanceTemplate:InstanceTemplate": "compute",
  // GCP containers
  "gcp:container/cluster:Cluster": "cluster",
  "gcp:container/nodePool:NodePool": "cluster",
  // GCP serverless
  "gcp:cloudfunctions/function:Function": "serverless-function",
  "gcp:cloudfunctionsv2/function:Function": "serverless-function",
  "gcp:cloudrun/service:Service": "serverless-function",
  // GCP storage
  "gcp:storage/bucket:Bucket": "storage",
  "gcp:compute/disk:Disk": "storage",
  // GCP database
  "gcp:sql/databaseInstance:DatabaseInstance": "database",
  "gcp:spanner/instance:Instance": "database",
  "gcp:redis/instance:Instance": "cache",
  "gcp:bigtable/instance:Instance": "database",
  // GCP network
  "gcp:compute/network:Network": "vpc",
  "gcp:compute/subnetwork:Subnetwork": "subnet",
  "gcp:compute/firewall:Firewall": "security-group",
  "gcp:compute/forwardingRule:ForwardingRule": "load-balancer",
  "gcp:compute/globalForwardingRule:GlobalForwardingRule": "load-balancer",
  "gcp:dns/managedZone:ManagedZone": "dns",
  // GCP messaging
  "gcp:pubsub/topic:Topic": "topic",
  "gcp:pubsub/subscription:Subscription": "queue",
  // GCP secrets
  "gcp:secretmanager/secret:Secret": "secret",
  "gcp:kms/cryptoKey:CryptoKey": "secret",
};

/** Map a Pulumi provider prefix to a CloudProvider enum value. */
function mapProvider(provider: string): CloudProvider {
  switch (provider) {
    case "aws": return "aws";
    case "azure":
    case "azure-native": return "azure";
    case "gcp":
    case "google-native": return "gcp";
    case "kubernetes": return "kubernetes";
    default: return "custom";
  }
}

/** Map a Pulumi resource type to a GraphResourceType. */
export function pulumiTypeToGraphType(pulumiType: string): GraphResourceType {
  return PULUMI_TYPE_MAP[pulumiType] ?? "custom";
}

/**
 * Build a deterministic KG node ID from a Pulumi resource.
 * Format: `{provider}:{resourceType}:{urn}`
 */
function buildNodeId(resource: ParsedPulumiResource, provider: CloudProvider, resourceType: GraphResourceType): string {
  // Use a compact URN-derived key — strip the "urn:pulumi:" prefix for brevity
  const compactUrn = resource.urn.replace(/^urn:pulumi:/, "");
  return `${provider}:${resourceType}:${compactUrn}`;
}

/** Extract a human-readable name from a Pulumi resource. */
function extractName(resource: ParsedPulumiResource): string {
  return (resource.outputs.name as string)
    ?? (resource.outputs.displayName as string)
    ?? (resource.inputs.name as string)
    ?? resource.name;
}

/** Extract region from resource outputs/inputs. */
function extractRegion(resource: ParsedPulumiResource): string {
  return (resource.outputs.region as string)
    ?? (resource.outputs.location as string)
    ?? (resource.outputs.availabilityZone as string)
    ?? (resource.inputs.region as string)
    ?? (resource.inputs.location as string)
    ?? "global";
}

/** Extract account/project from resource outputs/inputs. */
function extractAccount(resource: ParsedPulumiResource): string {
  return (resource.outputs.accountId as string)
    ?? (resource.outputs.subscriptionId as string)
    ?? (resource.outputs.project as string)
    ?? (resource.inputs.project as string)
    ?? "default";
}

/** Extract tags from resource outputs. */
function extractTags(resource: ParsedPulumiResource): Record<string, string> {
  const rawTags = resource.outputs.tags ?? resource.inputs.tags;
  if (rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)) {
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawTags as Record<string, unknown>)) {
      tags[k] = String(v);
    }
    return tags;
  }
  return {};
}

/** Infer resource status from outputs. */
function inferStatus(resource: ParsedPulumiResource): "running" | "stopped" | "unknown" {
  const status = resource.outputs.status as string | undefined;
  const state = resource.outputs.state as string | undefined;
  const raw = status ?? state;
  if (!raw) return "running"; // present in state → exists

  const lower = raw.toLowerCase();
  if (lower === "running" || lower === "available" || lower === "active" || lower === "in-use") return "running";
  if (lower === "stopped" || lower === "deallocated" || lower === "terminated") return "stopped";
  return "unknown";
}

// ── Conversion Functions ────────────────────────────────────────────────────────

/**
 * Convert an array of ParsedPulumiResources into Knowledge Graph node inputs.
 * Nodes are tagged with `managedBy: "pulumi"` and `pulumiUrn` in metadata.
 */
export function stateToGraphNodes(resources: ParsedPulumiResource[]): GraphNodeInput[] {
  return resources
    .filter((r) => r.type !== "pulumi:providers:*") // skip provider resources
    .map((resource) => {
      const provider = mapProvider(resource.provider);
      const resourceType = pulumiTypeToGraphType(resource.type);
      const id = buildNodeId(resource, provider, resourceType);

      const node: GraphNodeInput = {
        id,
        provider,
        resourceType,
        nativeId: (resource.outputs.arn as string)
          ?? (resource.outputs.id as string)
          ?? (resource.outputs.selfLink as string)
          ?? resource.id
          ?? resource.urn,
        name: extractName(resource),
        region: extractRegion(resource),
        account: extractAccount(resource),
        status: inferStatus(resource),
        tags: extractTags(resource),
        metadata: {
          managedBy: "pulumi",
          pulumiUrn: resource.urn,
          pulumiType: resource.type,
          pulumiProvider: resource.provider,
          ...pickMetadata(resource),
        },
        costMonthly: null,
        owner: null,
        createdAt: null,
      };

      return node;
    });
}

/** Pick relevant metadata from resource outputs (skip noise fields). */
function pickMetadata(resource: ParsedPulumiResource): Record<string, unknown> {
  const skip = new Set([
    "id", "arn", "selfLink", "tags", "tagsAll",
    "accountId", "subscriptionId", "project", "projectId",
    "region", "location", "availabilityZone",
    "name", "displayName", "status", "state",
  ]);

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource.outputs)) {
    if (skip.has(key)) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) continue;
    if (Array.isArray(value) && value.length > 10) continue;
    meta[key] = value;
  }
  return meta;
}

/**
 * Convert Pulumi dependency relationships into Knowledge Graph edges.
 * Each dependency becomes a "depends-on" edge with discoveredVia "iac-parse".
 */
export function dependenciesToGraphEdges(resources: ParsedPulumiResource[]): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = [];

  // Build lookup from URN → node ID
  const urnToNodeId = new Map<string, string>();
  for (const resource of resources) {
    const provider = mapProvider(resource.provider);
    const resourceType = pulumiTypeToGraphType(resource.type);
    urnToNodeId.set(resource.urn, buildNodeId(resource, provider, resourceType));
  }

  for (const resource of resources) {
    const provider = mapProvider(resource.provider);
    const resourceType = pulumiTypeToGraphType(resource.type);
    const sourceNodeId = buildNodeId(resource, provider, resourceType);

    // Explicit dependencies
    for (const depUrn of resource.dependencies) {
      const targetNodeId = urnToNodeId.get(depUrn);
      if (!targetNodeId) continue;

      edges.push({
        id: `edge:${sourceNodeId}->depends-on->${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        relationshipType: "depends-on",
        confidence: 1.0,
        discoveredVia: "iac-parse",
        metadata: {
          pulumiSourceUrn: resource.urn,
          pulumiTargetUrn: depUrn,
        },
      });
    }

    // Parent relationship (contains edge)
    if (resource.parent) {
      const parentNodeId = urnToNodeId.get(resource.parent);
      if (parentNodeId) {
        edges.push({
          id: `edge:${parentNodeId}->contains->${sourceNodeId}`,
          sourceNodeId: parentNodeId,
          targetNodeId: sourceNodeId,
          relationshipType: "contains",
          confidence: 1.0,
          discoveredVia: "iac-parse",
          metadata: {
            pulumiParentUrn: resource.parent,
            pulumiChildUrn: resource.urn,
          },
        });
      }
    }
  }

  return edges;
}

/**
 * Sync parsed Pulumi state into the Knowledge Graph.
 * Upserts all resources as nodes and their dependencies as edges.
 */
export async function syncStateToGraph(
  storage: GraphStorage,
  resources: ParsedPulumiResource[],
): Promise<{ nodesUpserted: number; edgesUpserted: number }> {
  const nodes = stateToGraphNodes(resources);
  const edges = dependenciesToGraphEdges(resources);

  if (nodes.length > 0) await storage.upsertNodes(nodes);
  if (edges.length > 0) await storage.upsertEdges(edges);

  return { nodesUpserted: nodes.length, edgesUpserted: edges.length };
}

/**
 * Compare Knowledge Graph state with current Pulumi state.
 * Returns resources new in Pulumi, removed from Pulumi, and shared.
 */
export async function diffGraphVsState(
  storage: GraphStorage,
  resources: ParsedPulumiResource[],
): Promise<{
  newInPulumi: ParsedPulumiResource[];
  removedFromPulumi: string[];
  shared: string[];
}> {
  const pulumiNodes = stateToGraphNodes(resources);
  const pulumiNodeIds = new Set(pulumiNodes.map((n) => n.id));

  const kgNodes = await storage.queryNodes({});
  const pulumiManagedKgNodes = kgNodes.filter(
    (n) => (n.metadata as Record<string, unknown>).managedBy === "pulumi",
  );

  const kgNodeIds = new Set(pulumiManagedKgNodes.map((n) => n.id));
  const newInPulumi: ParsedPulumiResource[] = [];
  const shared: string[] = [];

  for (const resource of resources) {
    const provider = mapProvider(resource.provider);
    const resourceType = pulumiTypeToGraphType(resource.type);
    const nodeId = buildNodeId(resource, provider, resourceType);

    if (kgNodeIds.has(nodeId)) {
      shared.push(nodeId);
    } else {
      newInPulumi.push(resource);
    }
  }

  const removedFromPulumi = pulumiManagedKgNodes
    .filter((n) => !pulumiNodeIds.has(n.id))
    .map((n) => n.id);

  return { newInPulumi, removedFromPulumi, shared };
}
