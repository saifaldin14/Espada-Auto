/**
 * AWS Adapter — Utility Functions
 *
 * Field path resolution, resource ID extraction, node matching,
 * and relationship reversal logic used across the adapter.
 */

import type { GraphNodeInput, GraphRelationshipType } from "../../types.js";

// =============================================================================
// Field Path Resolution
// =============================================================================

/**
 * Resolve a dot-separated field path with array notation from a raw object.
 * Returns raw (uncoerced) values — use resolveFieldPath() when you need strings.
 *
 * Supports:
 *   "VpcId"                              → [value]
 *   "SecurityGroups[].GroupId"            → [value, value]
 *   "Tags[Name]"                         → [value]
 *   "VpcConfig.SubnetIds[]"              → [value, value]
 *   "RedrivePolicy.deadLetterTargetArn"  → [value]
 */
export function resolveFieldPathRaw(obj: unknown, path: string): unknown[] {
  if (obj == null || typeof obj !== "object") return [];

  const parts = path.split(".");
  let current: unknown[] = [obj];

  for (const part of parts) {
    const next: unknown[] = [];

    // Handle array indexing: "SecurityGroups[]" or "Tags[Name]"
    const arrayMatch = part.match(/^(.+?)\[(.*)?\]$/);

    if (arrayMatch) {
      const [, key, indexOrKey] = arrayMatch;

      for (const item of current) {
        if (item == null || typeof item !== "object") continue;
        const value = (item as Record<string, unknown>)[key!];

        if (Array.isArray(value)) {
          if (indexOrKey === "" || indexOrKey === undefined) {
            // [] → flatten array elements
            next.push(...value);
          } else {
            // [Name] → find an item by tag key or use as index
            for (const v of value) {
              if (v && typeof v === "object" && "Key" in v && (v as Record<string, unknown>).Key === indexOrKey) {
                next.push((v as Record<string, unknown>).Value);
              }
            }
          }
        }
      }
    } else {
      // Simple field access
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

  return current;
}

/**
 * Resolve a dot-separated field path with array notation from a raw object.
 * Returns all leaf values as strings (flattened).
 */
export function resolveFieldPath(obj: unknown, path: string): string[] {
  return resolveFieldPathRaw(obj, path)
    .flat(Infinity)
    .filter((v) => v != null)
    .map((v) => String(v));
}

// =============================================================================
// Resource ID Extraction
// =============================================================================

/**
 * Extract the resource ID from an ARN or direct ID.
 *
 * - "arn:aws:ec2:us-east-1:123456:instance/i-abc123" → "i-abc123"
 * - "arn:aws:iam::123456:role/MyRole" → "MyRole"
 * - "sg-abc123" → "sg-abc123"
 * - "https://sqs.us-east-1.amazonaws.com/123456/my-queue" → "my-queue"
 */
export function extractResourceId(value: string): string {
  // ARN format: arn:partition:service:region:account:resource-type/resource-id
  if (value.startsWith("arn:")) {
    const parts = value.split(":");
    const resource = parts.slice(5).join(":");
    const slashIdx = resource.indexOf("/");
    return slashIdx >= 0 ? resource.slice(slashIdx + 1) : resource;
  }

  // SQS URL format
  if (value.startsWith("https://sqs.")) {
    const parts = value.split("/");
    return parts[parts.length - 1] ?? value;
  }

  // Direct ID (e.g. "vpc-abc123", "sg-abc123")
  return value;
}

// =============================================================================
// Node Matching
// =============================================================================

/**
 * Find a graph node by matching its ARN or native ID against
 * a target ARN/ID string. Used by enrichment methods.
 */
export function findNodeByArnOrId(
  nodes: GraphNodeInput[],
  arn: string,
  extractedId: string,
): GraphNodeInput | undefined {
  return nodes.find((n) =>
    n.nativeId === arn ||
    n.nativeId === extractedId ||
    arn.includes(n.nativeId) ||
    n.nativeId.includes(extractedId),
  );
}

// =============================================================================
// Relationship Reversal
// =============================================================================

/**
 * Get the reverse relationship type for bidirectional edges.
 */
export function reverseRelationship(rel: GraphRelationshipType): GraphRelationshipType {
  const reverseMap: Partial<Record<GraphRelationshipType, GraphRelationshipType>> = {
    "attached-to": "attached-to",
    "runs-in": "contains",
    "contains": "runs-in",
    "routes-to": "receives-from",
    "receives-from": "routes-to",
    "publishes-to": "subscribes-to",
    "subscribes-to": "publishes-to",
    "secured-by": "secures",
    "secures": "secured-by",
    "triggers": "triggered-by",
    "triggered-by": "triggers",
    "depends-on": "depended-on-by",
    "depended-on-by": "depends-on",
    "replicates": "replicates",
    "peers-with": "peers-with",
    "uses": "used-by",
    "used-by": "uses",
    "monitors": "monitored-by",
    "monitored-by": "monitors",
    "logs-to": "receives-logs-from",
    "receives-logs-from": "logs-to",
    "backed-by": "backs",
    "backs": "backed-by",
    "aliases": "aliases",
    "connects-via": "connects-via",
    "connected-to": "connected-to",
  };
  return reverseMap[rel] ?? rel;
}

// =============================================================================
// Node ID Construction
// =============================================================================

/**
 * Build a deterministic graph node ID from AWS resource identifiers.
 * Format: aws:<account>:<region>:<resourceType>:<nativeId>
 */
export function buildAwsNodeId(
  accountId: string,
  region: string,
  resourceType: string,
  nativeId: string,
): string {
  return `aws:${accountId}:${region}:${resourceType}:${nativeId}`;
}
