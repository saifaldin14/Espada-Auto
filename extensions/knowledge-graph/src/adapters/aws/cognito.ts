/**
 * AWS Adapter — Cognito Domain Module
 *
 * Discovers Cognito resources: User Pools, Identity Pools, and App Clients
 * via the CognitoManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Discover Cognito resources: User Pools, Identity Pools, and App Clients
 * via the CognitoManager from @espada/aws.
 *
 * Creates `identity` nodes for user pools and identity pools, links
 * app clients as sub-resources, and creates edges to Lambda triggers.
 */
export async function discoverCognito(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getCognitoManager();
  if (!mgr) return;

  // Discover User Pools
  const userPoolsResult = await (mgr as {
    listUserPools: (maxResults?: number) => Promise<{
      success: boolean;
      data?: Array<{
        Id?: string;
        Name?: string;
        Status?: string;
        CreationDate?: Date | string;
        LastModifiedDate?: Date | string;
        LambdaConfig?: Record<string, string>;
      }>;
    }>;
  }).listUserPools(50);

  if (userPoolsResult.success && userPoolsResult.data) {
    for (const pool of userPoolsResult.data) {
      if (!pool.Id) continue;

      const poolNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "identity",
        `userpool-${pool.Id}`,
      );

      const createdAt = pool.CreationDate instanceof Date
        ? pool.CreationDate.toISOString()
        : pool.CreationDate ?? null;

      nodes.push({
        id: poolNodeId,
        name: pool.Name ?? pool.Id,
        resourceType: "identity",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: pool.Id,
        status: pool.Status === "Enabled" || !pool.Status ? "running" : "stopped",
        tags: {},
        metadata: {
          resourceSubtype: "cognito-user-pool",
          hasLambdaTriggers: pool.LambdaConfig ? Object.keys(pool.LambdaConfig).length > 0 : false,
          discoverySource: "cognito-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt,
      });

      // Link user pool → Lambda triggers
      if (pool.LambdaConfig) {
        for (const [triggerName, lambdaArn] of Object.entries(pool.LambdaConfig)) {
          if (!lambdaArn) continue;
          const fnNode = findNodeByArnOrId(nodes, lambdaArn, extractResourceId(lambdaArn));
          if (!fnNode) continue;

          const triggersEdgeId = `${poolNodeId}--triggers--${fnNode.id}`;
          if (!edges.some((e) => e.id === triggersEdgeId)) {
            edges.push({
              id: triggersEdgeId,
              sourceNodeId: poolNodeId,
              targetNodeId: fnNode.id,
              relationshipType: "triggers",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: { triggerType: triggerName },
            });
          }
        }
      }

      // Discover app clients for this user pool
      try {
        const clientsResult = await (mgr as {
          listAppClients: (userPoolId: string) => Promise<{
            success: boolean;
            data?: Array<{
              ClientId?: string;
              ClientName?: string;
              UserPoolId?: string;
            }>;
          }>;
        }).listAppClients(pool.Id);

        if (clientsResult.success && clientsResult.data) {
          for (const client of clientsResult.data) {
            if (!client.ClientId) continue;

            const clientNodeId = buildAwsNodeId(
              ctx.accountId,
              "us-east-1",
              "custom",
              `cognito-client-${client.ClientId}`,
            );

            nodes.push({
              id: clientNodeId,
              name: client.ClientName ?? client.ClientId,
              resourceType: "custom",
              provider: "aws",
              region: "us-east-1",
              account: ctx.accountId,
              nativeId: client.ClientId,
              status: "running",
              tags: {},
              metadata: {
                resourceSubtype: "cognito-app-client",
                userPoolId: pool.Id,
                discoverySource: "cognito-manager",
              },
              costMonthly: 0,
              owner: null,
              createdAt: null,
            });

            // Link app client → user pool (member-of)
            const memberEdgeId = `${clientNodeId}--member-of--${poolNodeId}`;
            if (!edges.some((e) => e.id === memberEdgeId)) {
              edges.push({
                id: memberEdgeId,
                sourceNodeId: clientNodeId,
                targetNodeId: poolNodeId,
                relationshipType: "member-of",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      } catch {
        // App client discovery is best-effort
      }
    }
  }

  // Discover Identity Pools
  const identityPoolsResult = await (mgr as {
    listIdentityPools: (maxResults?: number) => Promise<{
      success: boolean;
      data?: Array<{
        IdentityPoolId?: string;
        IdentityPoolName?: string;
      }>;
    }>;
  }).listIdentityPools(50);

  if (identityPoolsResult.success && identityPoolsResult.data) {
    for (const idPool of identityPoolsResult.data) {
      if (!idPool.IdentityPoolId) continue;

      const idPoolNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "identity",
        `idpool-${idPool.IdentityPoolId}`,
      );

      nodes.push({
        id: idPoolNodeId,
        name: idPool.IdentityPoolName ?? idPool.IdentityPoolId,
        resourceType: "identity",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: idPool.IdentityPoolId,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "cognito-identity-pool",
          discoverySource: "cognito-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: null,
      });
    }
  }
}
