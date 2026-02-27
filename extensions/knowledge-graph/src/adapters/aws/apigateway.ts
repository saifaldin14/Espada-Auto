/**
 * AWS Adapter — API Gateway Domain Module
 *
 * Discovers API Gateway resources: REST APIs, HTTP APIs (v2),
 * stages, integrations, and authorizers via the APIGatewayManager
 * from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Discover deeper API Gateway resources via APIGatewayManager.
 *
 * Discovers REST APIs, HTTP APIs (v2), their stages, integrations,
 * and authorizers. Creates edges linking APIs to Lambda integrations,
 * Cognito authorizers, and VPC links.
 */
export async function discoverAPIGatewayDeeper(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getAPIGatewayManager();
  if (!mgr) return;

  const m = mgr as {
    listRestApis: (limit?: number) => Promise<{
      success: boolean;
      data?: Array<{
        id?: string;
        name?: string;
        description?: string;
        createdDate?: string;
        apiKeySource?: string;
        endpointConfiguration?: { types?: string[] };
        tags?: Record<string, string>;
      }>;
    }>;
    listHttpApis: () => Promise<{
      success: boolean;
      data?: Array<{
        apiId?: string;
        name?: string;
        description?: string;
        protocolType?: string;
        apiEndpoint?: string;
        createdDate?: string;
        tags?: Record<string, string>;
      }>;
    }>;
    listRestStages: (restApiId: string) => Promise<{
      success: boolean;
      data?: Array<{
        stageName?: string;
        deploymentId?: string;
        description?: string;
        cacheClusterEnabled?: boolean;
        cacheClusterSize?: string;
        tracingEnabled?: boolean;
        createdDate?: string;
      }>;
    }>;
    listHttpStages: (apiId: string) => Promise<{
      success: boolean;
      data?: Array<{
        stageName?: string;
        deploymentId?: string;
        description?: string;
        autoDeploy?: boolean;
        defaultRouteSettings?: { throttlingBurstLimit?: number; throttlingRateLimit?: number };
        tags?: Record<string, string>;
        createdDate?: string;
      }>;
    }>;
    listHttpIntegrations: (apiId: string) => Promise<{
      success: boolean;
      data?: Array<{
        integrationId?: string;
        integrationType?: string;
        integrationUri?: string;
        integrationMethod?: string;
        connectionType?: string;
        connectionId?: string;
        payloadFormatVersion?: string;
      }>;
    }>;
    listRestAuthorizers: (restApiId: string) => Promise<{
      success: boolean;
      data?: Array<{
        id?: string;
        name?: string;
        type?: string;
        authorizerUri?: string;
        providerARNs?: string[];
      }>;
    }>;
    listHttpAuthorizers: (apiId: string) => Promise<{
      success: boolean;
      data?: Array<{
        authorizerId?: string;
        name?: string;
        authorizerType?: string;
        authorizerUri?: string;
        jwtConfiguration?: { issuer?: string; audience?: string[] };
      }>;
    }>;
  };

  // --- REST APIs ---
  try {
    const restResult = await m.listRestApis(100);
    if (restResult.success && restResult.data) {
      for (const api of restResult.data) {
        if (!api.id) continue;

        // Check if already discovered by base adapter
        const existing = nodes.find(
          (n) =>
            n.resourceType === "api-gateway" &&
            (n.nativeId === api.id || n.name === api.name),
        );

        const apiNodeId = existing?.id ?? buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "api-gateway",
          `rest-${api.id}`,
        );

        if (existing) {
          existing.metadata["apiType"] = "REST";
          existing.metadata["apiKeySource"] = api.apiKeySource;
          existing.metadata["endpointTypes"] = api.endpointConfiguration?.types;
          existing.metadata["discoverySource"] = "apigateway-manager";
        } else {
          nodes.push({
            id: apiNodeId,
            name: api.name ?? api.id,
            resourceType: "api-gateway",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: api.id,
            status: "running",
            tags: api.tags ?? {},
            metadata: {
              apiType: "REST",
              description: api.description,
              apiKeySource: api.apiKeySource,
              endpointTypes: api.endpointConfiguration?.types,
              discoverySource: "apigateway-manager",
            },
            costMonthly: 3.50, // ~$3.50/1M API calls estimate
            owner: api.tags?.["Owner"] ?? null,
            createdAt: api.createdDate ?? null,
          });
        }

        // Discover stages
        try {
          const stagesResult = await m.listRestStages(api.id);
          if (stagesResult.success && stagesResult.data) {
            for (const stage of stagesResult.data) {
              if (!stage.stageName) continue;

              const stageNodeId = buildAwsNodeId(
                ctx.accountId,
                "us-east-1",
                "custom",
                `apigw-stage-${api.id}-${stage.stageName}`,
              );

              nodes.push({
                id: stageNodeId,
                name: `${api.name ?? api.id}/${stage.stageName}`,
                resourceType: "custom",
                provider: "aws",
                region: "us-east-1",
                account: ctx.accountId,
                nativeId: `${api.id}/stages/${stage.stageName}`,
                status: "running",
                tags: {},
                metadata: {
                  resourceSubtype: "api-gateway-stage",
                  cacheClusterEnabled: stage.cacheClusterEnabled,
                  cacheClusterSize: stage.cacheClusterSize,
                  tracingEnabled: stage.tracingEnabled,
                  discoverySource: "apigateway-manager",
                },
                costMonthly: stage.cacheClusterEnabled ? 14 : 0,
                owner: null,
                createdAt: stage.createdDate ?? null,
              });

              // API → stage (contains)
              const edgeId = `${apiNodeId}--contains--${stageNodeId}`;
              if (!edges.some((e) => e.id === edgeId)) {
                edges.push({
                  id: edgeId,
                  sourceNodeId: apiNodeId,
                  targetNodeId: stageNodeId,
                  relationshipType: "contains",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }
        } catch {
          // Stage discovery is best-effort
        }

        // Discover authorizers (REST)
        try {
          const authResult = await m.listRestAuthorizers(api.id);
          if (authResult.success && authResult.data) {
            for (const auth of authResult.data) {
              if (!auth.id) continue;

              // Link to Lambda authorizer
              if (auth.authorizerUri && auth.type === "TOKEN" || auth.type === "REQUEST") {
                const lambdaArn = extractLambdaArnFromUri(auth.authorizerUri ?? "");
                if (lambdaArn) {
                  const lambdaNode = findNodeByArnOrId(nodes, lambdaArn, extractResourceId(lambdaArn));
                  if (lambdaNode) {
                    const edgeId = `${apiNodeId}--triggers--${lambdaNode.id}`;
                    if (!edges.some((e) => e.id === edgeId)) {
                      edges.push({
                        id: edgeId,
                        sourceNodeId: apiNodeId,
                        targetNodeId: lambdaNode.id,
                        relationshipType: "triggers",
                        confidence: 0.9,
                        discoveredVia: "api-field",
                        metadata: { role: "authorizer", authorizerType: auth.type },
                      });
                    }
                  }
                }
              }

              // Link to Cognito authorizer
              if (auth.providerARNs) {
                for (const providerArn of auth.providerARNs) {
                  const cognitoNode = findNodeByArnOrId(nodes, providerArn, extractResourceId(providerArn));
                  if (cognitoNode) {
                    const edgeId = `${apiNodeId}--authenticated-by--${cognitoNode.id}`;
                    if (!edges.some((e) => e.id === edgeId)) {
                      edges.push({
                        id: edgeId,
                        sourceNodeId: apiNodeId,
                        targetNodeId: cognitoNode.id,
                        relationshipType: "authenticated-by",
                        confidence: 0.9,
                        discoveredVia: "api-field",
                        metadata: {},
                      });
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Authorizer discovery is best-effort
        }
      }
    }
  } catch {
    // REST API discovery is best-effort
  }

  // --- HTTP APIs (API Gateway v2) ---
  try {
    const httpResult = await m.listHttpApis();
    if (httpResult.success && httpResult.data) {
      for (const api of httpResult.data) {
        if (!api.apiId) continue;

        const existing = nodes.find(
          (n) =>
            n.resourceType === "api-gateway" &&
            (n.nativeId === api.apiId || n.name === api.name),
        );

        const apiNodeId = existing?.id ?? buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "api-gateway",
          `http-${api.apiId}`,
        );

        if (existing) {
          existing.metadata["apiType"] = "HTTP";
          existing.metadata["protocolType"] = api.protocolType;
          existing.metadata["apiEndpoint"] = api.apiEndpoint;
          existing.metadata["discoverySource"] = "apigateway-manager";
        } else {
          nodes.push({
            id: apiNodeId,
            name: api.name ?? api.apiId,
            resourceType: "api-gateway",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: api.apiId,
            status: "running",
            tags: api.tags ?? {},
            metadata: {
              apiType: "HTTP",
              protocolType: api.protocolType,
              description: api.description,
              apiEndpoint: api.apiEndpoint,
              discoverySource: "apigateway-manager",
            },
            costMonthly: 1.00, // HTTP APIs are cheaper: ~$1/1M
            owner: api.tags?.["Owner"] ?? null,
            createdAt: api.createdDate ?? null,
          });
        }

        // Discover integrations → link to Lambda/HTTP backends
        try {
          const intResult = await m.listHttpIntegrations(api.apiId);
          if (intResult.success && intResult.data) {
            for (const integration of intResult.data) {
              if (!integration.integrationUri) continue;

              // Check if integration points to a Lambda function
              if (integration.integrationType === "AWS_PROXY" && integration.integrationUri.includes("lambda")) {
                const lambdaNode = findNodeByArnOrId(
                  nodes,
                  integration.integrationUri,
                  extractResourceId(integration.integrationUri),
                );
                if (lambdaNode) {
                  const edgeId = `${apiNodeId}--triggers--${lambdaNode.id}`;
                  if (!edges.some((e) => e.id === edgeId)) {
                    edges.push({
                      id: edgeId,
                      sourceNodeId: apiNodeId,
                      targetNodeId: lambdaNode.id,
                      relationshipType: "triggers",
                      confidence: 0.9,
                      discoveredVia: "api-field",
                      metadata: { integrationType: integration.integrationType },
                    });
                  }
                }
              }
            }
          }
        } catch {
          // Integration discovery is best-effort
        }
      }
    }
  } catch {
    // HTTP API discovery is best-effort
  }
}

/**
 * Extract a Lambda function ARN from an API Gateway authorizer URI.
 * URI format: arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{arnEncoded}/invocations
 */
function extractLambdaArnFromUri(uri: string): string | null {
  const match = /functions\/(arn:[^/]+)\/invocations/.exec(uri);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
