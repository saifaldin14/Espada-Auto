/**
 * Infrastructure Knowledge Graph — Cross-Cloud Relationship Discovery
 *
 * Discovers relationships between resources across different cloud providers:
 * - VPN / peering connections (AWS ↔ Azure ↔ GCP)
 * - Shared DNS (Route 53 ↔ Cloud DNS ↔ Azure DNS)
 * - Federated identity (IAM role ↔ Service Account ↔ Managed Identity)
 * - AI workloads spanning clouds (model training on one, inference on another)
 *
 * Runs as a post-discovery pass after individual provider adapters have
 * populated the graph with nodes and intra-cloud edges.
 */

import type {
  GraphNode,
  GraphEdgeInput,
  GraphRelationshipType,
  CloudProvider,
  GraphStorage,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

export type CrossCloudMatch = {
  sourceNodeId: string;
  targetNodeId: string;
  relationship: GraphRelationshipType;
  confidence: number;
  reason: string;
};

export type CrossCloudResult = {
  edges: GraphEdgeInput[];
  matches: CrossCloudMatch[];
  durationMs: number;
};

/**
 * A rule that detects cross-cloud relationships by examining node pairs
 * from different providers.
 */
export type CrossCloudRule = {
  id: string;
  name: string;
  description: string;
  /**
   * Which provider pairs this rule applies to.
   * `["aws", "azure"]` means it looks at AWS nodes vs Azure nodes (in either direction).
   */
  providerPairs: [CloudProvider, CloudProvider][];
  /**
   * Check a pair of nodes from different providers for a relationship.
   * Return a match if one exists, null otherwise.
   */
  match(a: GraphNode, b: GraphNode): CrossCloudMatch | null;
};

// =============================================================================
// Built-in Cross-Cloud Rules
// =============================================================================

/**
 * VPN / Peering — two VPCs / VNets in different clouds whose CIDR ranges
 * fall in known private ranges and appear to be linked (same tags / naming
 * convention, or metadata references).
 */
const vpnPeeringRule: CrossCloudRule = {
  id: "cross-cloud-vpn-peering",
  name: "VPN / Peering",
  description: "Detects VPN or peering connections between cloud networks",
  providerPairs: [["aws", "azure"], ["aws", "gcp"], ["azure", "gcp"]],

  match(a, b) {
    const networkTypes = new Set(["vpc", "network", "subnet"]);
    if (
      !networkTypes.has(a.resourceType) ||
      !networkTypes.has(b.resourceType)
    )
      return null;

    // Look for naming conventions that suggest peering
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aTags = Object.values(a.tags).join(" ").toLowerCase();
    const bTags = Object.values(b.tags).join(" ").toLowerCase();

    // Check if they reference each other by provider or name
    const aRefersToB =
      aName.includes(b.provider) ||
      aTags.includes(b.provider) ||
      aTags.includes(bName) ||
      (a.metadata["peeringConnections"] as string)?.includes(b.provider);

    const bRefersToA =
      bName.includes(a.provider) ||
      bTags.includes(a.provider) ||
      bTags.includes(aName) ||
      (b.metadata["peeringConnections"] as string)?.includes(a.provider);

    if (aRefersToB || bRefersToA) {
      return {
        sourceNodeId: a.id,
        targetNodeId: b.id,
        relationship: "peers-with",
        confidence: aRefersToB && bRefersToA ? 0.85 : 0.6,
        reason: `Network peering detected between ${a.provider} and ${b.provider}`,
      };
    }

    // CIDR overlap heuristic — if both have CIDRs in the same /16, they might be peered
    const aCidr = (a.metadata["cidrBlock"] ?? a.metadata["addressPrefix"]) as string;
    const bCidr = (b.metadata["cidrBlock"] ?? b.metadata["addressPrefix"]) as string;

    if (aCidr && bCidr) {
      const aPrefix = aCidr.split(".").slice(0, 2).join(".");
      const bPrefix = bCidr.split(".").slice(0, 2).join(".");
      if (aPrefix === bPrefix) {
        return {
          sourceNodeId: a.id,
          targetNodeId: b.id,
          relationship: "peers-with",
          confidence: 0.5,
          reason: `Networks share CIDR range prefix (${aPrefix}.x.x) — possible peering`,
        };
      }
    }

    return null;
  },
};

/**
 * Shared DNS — DNS zones/records in different clouds that resolve to
 * resources in the other cloud (e.g. Route 53 CNAME → Azure LB).
 */
const sharedDnsRule: CrossCloudRule = {
  id: "cross-cloud-shared-dns",
  name: "Shared DNS",
  description: "Detects DNS records/zones that resolve across cloud boundaries",
  providerPairs: [["aws", "azure"], ["aws", "gcp"], ["azure", "gcp"]],

  match(a, b) {
    // One should be DNS, the other should be the target
    const [dns, target] = a.resourceType === "dns" ? [a, b] : b.resourceType === "dns" ? [b, a] : [null, null];
    if (!dns || !target) return null;
    if (dns.provider === target.provider) return null;

    const dnsName = dns.name.toLowerCase();
    const targetName = target.name.toLowerCase();
    const dnsMeta = JSON.stringify(dns.metadata).toLowerCase();

    // Check if DNS zone/record references the target resource
    if (
      dnsMeta.includes(target.nativeId.toLowerCase()) ||
      dnsMeta.includes(targetName) ||
      dnsName.includes(targetName)
    ) {
      return {
        sourceNodeId: dns.id,
        targetNodeId: target.id,
        relationship: "resolves-to",
        confidence: 0.75,
        reason: `DNS record in ${dns.provider} resolves to resource in ${target.provider}`,
      };
    }

    return null;
  },
};

/**
 * Federated Identity — IAM roles, service accounts, and managed identities
 * that trust each other across clouds.
 */
const federatedIdentityRule: CrossCloudRule = {
  id: "cross-cloud-federated-identity",
  name: "Federated Identity",
  description: "Detects identity federation between cloud providers",
  providerPairs: [["aws", "azure"], ["aws", "gcp"], ["azure", "gcp"]],

  match(a, b) {
    const identityTypes = new Set(["identity", "iam-role"]);
    if (!identityTypes.has(a.resourceType) && !identityTypes.has(b.resourceType)) return null;
    if (a.provider === b.provider) return null;

    const aMeta = JSON.stringify(a.metadata).toLowerCase();
    const bMeta = JSON.stringify(b.metadata).toLowerCase();

    // AWS → GCP: trust policy references accounts.google.com
    // AWS → Azure: trust policy references sts.windows.net
    // GCP → AWS: workload identity federation references aws
    const aRefersToB =
      aMeta.includes(b.provider) ||
      (b.provider === "gcp" && aMeta.includes("accounts.google.com")) ||
      (b.provider === "azure" && aMeta.includes("sts.windows.net")) ||
      (b.provider === "aws" && aMeta.includes("amazonaws.com"));

    const bRefersToA =
      bMeta.includes(a.provider) ||
      (a.provider === "gcp" && bMeta.includes("accounts.google.com")) ||
      (a.provider === "azure" && bMeta.includes("sts.windows.net")) ||
      (a.provider === "aws" && bMeta.includes("amazonaws.com"));

    if (aRefersToB || bRefersToA) {
      return {
        sourceNodeId: a.id,
        targetNodeId: b.id,
        relationship: "authenticated-by",
        confidence: 0.7,
        reason: `Identity federation between ${a.provider} and ${b.provider}`,
      };
    }

    return null;
  },
};

/**
 * AI Workloads — model training on one cloud, inference/serving on another.
 * Detects by matching model names, endpoints, and AI-related metadata.
 */
const crossCloudAiRule: CrossCloudRule = {
  id: "cross-cloud-ai-workload",
  name: "Cross-Cloud AI",
  description: "Detects AI workloads that span multiple clouds",
  providerPairs: [["aws", "azure"], ["aws", "gcp"], ["azure", "gcp"]],

  match(a, b) {
    const aIsAi = a.metadata["aiWorkload"] === true || a.metadata["isAiWorkload"] === true;
    const bIsAi = b.metadata["aiWorkload"] === true || b.metadata["isAiWorkload"] === true;

    if (!aIsAi && !bIsAi) return null;
    if (a.provider === b.provider) return null;

    // Both are AI workloads — look for model name / endpoint matching
    if (aIsAi && bIsAi) {
      const aModelName = getModelIdentifier(a);
      const bModelName = getModelIdentifier(b);

      if (aModelName && bModelName && aModelName === bModelName) {
        return {
          sourceNodeId: a.id,
          targetNodeId: b.id,
          relationship: "depends-on",
          confidence: 0.8,
          reason: `AI workload "${aModelName}" spans ${a.provider} and ${b.provider}`,
        };
      }

      // Same owner/team with AI workloads — potential cross-cloud AI pipeline
      if (a.owner && a.owner === b.owner) {
        return {
          sourceNodeId: a.id,
          targetNodeId: b.id,
          relationship: "depends-on",
          confidence: 0.5,
          reason: `AI workloads in ${a.provider} and ${b.provider} share owner "${a.owner}"`,
        };
      }
    }

    // One is AI and references the other cloud in metadata
    if (aIsAi || bIsAi) {
      const ai = aIsAi ? a : b;
      const other = aIsAi ? b : a;
      const aiMeta = JSON.stringify(ai.metadata).toLowerCase();

      if (aiMeta.includes(other.nativeId.toLowerCase()) || aiMeta.includes(other.name.toLowerCase())) {
        return {
          sourceNodeId: ai.id,
          targetNodeId: other.id,
          relationship: "depends-on",
          confidence: 0.7,
          reason: `AI workload in ${ai.provider} references resource in ${other.provider}`,
        };
      }
    }

    return null;
  },
};

/**
 * Shared Storage — S3/GCS/Azure Blob references from another cloud.
 * Common in data lake architectures and ML pipelines.
 */
const sharedStorageRule: CrossCloudRule = {
  id: "cross-cloud-shared-storage",
  name: "Shared Storage",
  description: "Detects cross-cloud storage references (data lakes, ML pipelines)",
  providerPairs: [["aws", "azure"], ["aws", "gcp"], ["azure", "gcp"]],

  match(a, b) {
    if (a.provider === b.provider) return null;

    const [storage, consumer] = a.resourceType === "storage" ? [a, b] : b.resourceType === "storage" ? [b, a] : [null, null];
    if (!storage || !consumer) return null;

    const consumerMeta = JSON.stringify(consumer.metadata).toLowerCase();
    const storageName = storage.name.toLowerCase();
    const storageNativeId = storage.nativeId.toLowerCase();

    // Check if the consumer references the storage resource
    if (
      consumerMeta.includes(storageName) ||
      consumerMeta.includes(storageNativeId) ||
      // S3 bucket pattern
      consumerMeta.includes(`s3://${storageName}`) ||
      // GCS bucket pattern
      consumerMeta.includes(`gs://${storageName}`) ||
      // Azure blob pattern
      consumerMeta.includes(`${storageName}.blob.core.windows.net`)
    ) {
      return {
        sourceNodeId: consumer.id,
        targetNodeId: storage.id,
        relationship: "reads-from",
        confidence: 0.7,
        reason: `Resource in ${consumer.provider} references storage in ${storage.provider}`,
      };
    }

    return null;
  },
};

// =============================================================================
// All Built-In Rules
// =============================================================================

export const CROSS_CLOUD_RULES: CrossCloudRule[] = [
  vpnPeeringRule,
  sharedDnsRule,
  federatedIdentityRule,
  crossCloudAiRule,
  sharedStorageRule,
];

// =============================================================================
// Cross-Cloud Discovery Engine
// =============================================================================

/**
 * Discover cross-cloud relationships by running rules against nodes
 * from different providers.
 *
 * Call this after all individual provider syncs are complete.
 */
export async function discoverCrossCloudRelationships(
  storage: GraphStorage,
  rules: CrossCloudRule[] = CROSS_CLOUD_RULES,
): Promise<CrossCloudResult> {
  const startMs = Date.now();
  const edges: GraphEdgeInput[] = [];
  const matches: CrossCloudMatch[] = [];

  // Get all providers that have nodes in the graph
  const allNodes = await storage.queryNodes({});
  const nodesByProvider = groupByProvider(allNodes);

  const providers = [...nodesByProvider.keys()];
  if (providers.length < 2) {
    // Need at least 2 providers for cross-cloud analysis
    return { edges: [], matches: [], durationMs: Date.now() - startMs };
  }

  // For each rule, check applicable provider pairs
  for (const rule of rules) {
    for (const [provA, provB] of rule.providerPairs) {
      const nodesA = nodesByProvider.get(provA);
      const nodesB = nodesByProvider.get(provB);
      if (!nodesA || !nodesB) continue;

      // Compare each pair — O(n*m) but typically < 1000 nodes per provider
      for (const a of nodesA) {
        for (const b of nodesB) {
          const result = rule.match(a, b);
          if (result) {
            // Deduplicate — avoid adding both A→B and B→A for symmetric relationships
            const edgeId = `cross-cloud:${rule.id}:${result.sourceNodeId}--${result.targetNodeId}`;
            const reverseId = `cross-cloud:${rule.id}:${result.targetNodeId}--${result.sourceNodeId}`;

            if (
              !edges.some((e) => e.id === edgeId || e.id === reverseId)
            ) {
              edges.push({
                id: edgeId,
                sourceNodeId: result.sourceNodeId,
                targetNodeId: result.targetNodeId,
                relationshipType: result.relationship,
                confidence: result.confidence,
                discoveredVia: "config-scan",
                metadata: {
                  crossCloud: true,
                  rule: rule.id,
                  reason: result.reason,
                },
              });
              matches.push(result);
            }
          }
        }
      }
    }
  }

  return {
    edges,
    matches,
    durationMs: Date.now() - startMs,
  };
}

/**
 * Get a summary of cross-cloud relationships currently in the graph.
 */
export async function getCrossCloudSummary(
  storage: GraphStorage,
): Promise<{
  totalCrossCloudEdges: number;
  byRelationship: Record<string, number>;
  byProviderPair: Record<string, number>;
  aiWorkloadConnections: number;
}> {
  const allEdges = await storage.queryEdges({});
  const allNodes = await storage.queryNodes({});

  const nodeMap = new Map<string, GraphNode>(allNodes.map((n: GraphNode) => [n.id, n]));
  let totalCrossCloudEdges = 0;
  const byRelationship: Record<string, number> = {};
  const byProviderPair: Record<string, number> = {};
  let aiWorkloadConnections = 0;

  for (const edge of allEdges) {
    const source = nodeMap.get(edge.sourceNodeId);
    const target = nodeMap.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (source.provider === target.provider) continue;

    totalCrossCloudEdges++;
    byRelationship[edge.relationshipType] = (byRelationship[edge.relationshipType] ?? 0) + 1;

    const pair = [source.provider, target.provider].sort().join("↔");
    byProviderPair[pair] = (byProviderPair[pair] ?? 0) + 1;

    if (
      source.metadata["aiWorkload"] === true ||
      target.metadata["aiWorkload"] === true
    ) {
      aiWorkloadConnections++;
    }
  }

  return {
    totalCrossCloudEdges,
    byRelationship,
    byProviderPair,
    aiWorkloadConnections,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function groupByProvider(nodes: GraphNode[]): Map<CloudProvider, GraphNode[]> {
  const map = new Map<CloudProvider, GraphNode[]>();
  for (const node of nodes) {
    const list = map.get(node.provider) ?? [];
    list.push(node);
    map.set(node.provider, list);
  }
  return map;
}

function getModelIdentifier(node: GraphNode): string | null {
  const meta = node.metadata;
  return (
    (meta["modelName"] as string) ??
    (meta["modelId"] as string) ??
    (meta["model"] as string) ??
    (meta["endpointName"] as string) ??
    null
  );
}
