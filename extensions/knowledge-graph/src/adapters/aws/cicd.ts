/**
 * AWS Adapter — CI/CD Domain Module
 *
 * Discovers CI/CD infrastructure: CodePipeline pipelines, CodeBuild
 * projects, and CodeDeploy applications via the CICDManager.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Discover CI/CD resources: CodePipeline, CodeBuild, and CodeDeploy
 * via the CICDManager from @espada/aws.
 *
 * Creates `custom` nodes for pipelines, build projects, and deploy apps.
 * Creates edges: pipeline→S3 (artifact store), pipeline→build project,
 * build project→IAM role, deploy app→instances.
 */
export async function discoverCICD(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getCICDManager();
  if (!mgr) return;

  // Discover CodePipeline pipelines
  const pipelinesResult = await (mgr as {
    listPipelines: (opts?: unknown) => Promise<{
      success: boolean;
      data?: { pipelines: Array<{ name?: string; version?: number; created?: string; updated?: string }>; nextToken?: string };
    }>;
  }).listPipelines();

  if (pipelinesResult.success && pipelinesResult.data?.pipelines) {
    for (const pipeline of pipelinesResult.data.pipelines) {
      if (!pipeline.name) continue;

      const pipelineNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        `pipeline-${pipeline.name}`,
      );

      nodes.push({
        id: pipelineNodeId,
        name: pipeline.name,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: pipeline.name,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "codepipeline",
          version: pipeline.version,
          lastUpdated: pipeline.updated,
          discoverySource: "cicd-manager",
        },
        costMonthly: 1,
        owner: null,
        createdAt: pipeline.created ?? null,
      });

      // Get pipeline details for stage/action edges
      try {
        const detailResult = await (mgr as {
          getPipeline: (name: string) => Promise<{
            success: boolean;
            data?: {
              name?: string;
              roleArn?: string;
              artifactStore?: { type?: string; location?: string };
              stages?: Array<{
                name?: string;
                actions?: Array<{
                  name?: string;
                  actionTypeId?: { category?: string; provider?: string };
                  configuration?: Record<string, string>;
                  roleArn?: string;
                }>;
              }>;
            };
          }>;
        }).getPipeline(pipeline.name);

        if (detailResult.success && detailResult.data) {
          const detail = detailResult.data;

          // Link pipeline → IAM role
          if (detail.roleArn) {
            const roleNode = findNodeByArnOrId(nodes, detail.roleArn, extractResourceId(detail.roleArn));
            if (roleNode) {
              const usesEdgeId = `${pipelineNodeId}--uses--${roleNode.id}`;
              if (!edges.some((e) => e.id === usesEdgeId)) {
                edges.push({
                  id: usesEdgeId,
                  sourceNodeId: pipelineNodeId,
                  targetNodeId: roleNode.id,
                  relationshipType: "uses",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }

          // Link pipeline → artifact store (S3)
          if (detail.artifactStore?.location) {
            const s3Node = nodes.find((n) =>
              n.resourceType === "storage" && n.name === detail.artifactStore!.location,
            );
            if (s3Node) {
              const storesInEdgeId = `${pipelineNodeId}--stores-in--${s3Node.id}`;
              if (!edges.some((e) => e.id === storesInEdgeId)) {
                edges.push({
                  id: storesInEdgeId,
                  sourceNodeId: pipelineNodeId,
                  targetNodeId: s3Node.id,
                  relationshipType: "stores-in",
                  confidence: 0.9,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }

          // Scan stages for CodeBuild/CodeDeploy/Lambda actions → edges
          if (detail.stages) {
            for (const stage of detail.stages) {
              if (!stage.actions) continue;
              for (const action of stage.actions) {
                if (!action.configuration) continue;

                // CodeBuild action → build project
                if (action.actionTypeId?.provider === "CodeBuild" && action.configuration["ProjectName"]) {
                  const buildNode = nodes.find((n) =>
                    n.metadata["resourceSubtype"] === "codebuild-project" &&
                    n.name === action.configuration!["ProjectName"],
                  );
                  if (buildNode) {
                    const depEdgeId = `${pipelineNodeId}--depends-on--${buildNode.id}`;
                    if (!edges.some((e) => e.id === depEdgeId)) {
                      edges.push({
                        id: depEdgeId,
                        sourceNodeId: pipelineNodeId,
                        targetNodeId: buildNode.id,
                        relationshipType: "depends-on",
                        confidence: 0.9,
                        discoveredVia: "config-scan",
                        metadata: { stage: stage.name },
                      });
                    }
                  }
                }

                // Lambda action → function
                if (action.actionTypeId?.provider === "Lambda" && action.configuration["FunctionName"]) {
                  const fnNode = nodes.find((n) =>
                    n.resourceType === "serverless-function" &&
                    (n.name === action.configuration!["FunctionName"] ||
                     n.nativeId.includes(action.configuration!["FunctionName"]!)),
                  );
                  if (fnNode) {
                    const triggersEdgeId = `${pipelineNodeId}--triggers--${fnNode.id}`;
                    if (!edges.some((e) => e.id === triggersEdgeId)) {
                      edges.push({
                        id: triggersEdgeId,
                        sourceNodeId: pipelineNodeId,
                        targetNodeId: fnNode.id,
                        relationshipType: "triggers",
                        confidence: 0.9,
                        discoveredVia: "config-scan",
                        metadata: { stage: stage.name },
                      });
                    }
                  }
                }
              }
            }
          }
        }
      } catch {
        // Pipeline detail is best-effort
      }
    }
  }

  // Discover CodeBuild projects
  const buildProjectsResult = await (mgr as {
    listBuildProjects: (opts?: unknown) => Promise<{
      success: boolean;
      data?: { projects: string[] };
    }>;
  }).listBuildProjects();

  if (buildProjectsResult.success && buildProjectsResult.data?.projects) {
    for (const projectName of buildProjectsResult.data.projects) {
      try {
        const projectResult = await (mgr as {
          getBuildProject: (name: string) => Promise<{
            success: boolean;
            data?: {
              name?: string;
              arn?: string;
              description?: string;
              source?: { type?: string; location?: string };
              environment?: { computeType?: string; image?: string; type?: string };
              serviceRole?: string;
              created?: string;
              lastModified?: string;
              badge?: { badgeEnabled?: boolean; badgeRequestUrl?: string };
            };
          }>;
        }).getBuildProject(projectName);

        if (!projectResult.success || !projectResult.data) continue;
        const project = projectResult.data;

        const buildNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "custom",
          `codebuild-${projectName}`,
        );

        nodes.push({
          id: buildNodeId,
          name: projectName,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: project.arn ?? projectName,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "codebuild-project",
            description: project.description,
            sourceType: project.source?.type,
            sourceLocation: project.source?.location,
            computeType: project.environment?.computeType,
            buildImage: project.environment?.image,
            discoverySource: "cicd-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: project.created ?? null,
        });

        // Link build project → IAM role
        if (project.serviceRole) {
          const roleNode = findNodeByArnOrId(nodes, project.serviceRole, extractResourceId(project.serviceRole));
          if (roleNode) {
            const usesEdgeId = `${buildNodeId}--uses--${roleNode.id}`;
            if (!edges.some((e) => e.id === usesEdgeId)) {
              edges.push({
                id: usesEdgeId,
                sourceNodeId: buildNodeId,
                targetNodeId: roleNode.id,
                relationshipType: "uses",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      } catch {
        // Individual build project is best-effort
      }
    }
  }

  // Discover CodeDeploy applications
  const deployAppsResult = await (mgr as {
    listApplications: (opts?: unknown) => Promise<{
      success: boolean;
      data?: { applications: string[] };
    }>;
  }).listApplications();

  if (deployAppsResult.success && deployAppsResult.data?.applications) {
    for (const appName of deployAppsResult.data.applications) {
      try {
        const appResult = await (mgr as {
          getApplication: (name: string) => Promise<{
            success: boolean;
            data?: {
              applicationName?: string;
              applicationId?: string;
              computePlatform?: string;
              createTime?: string;
              linkedToGitHub?: boolean;
            };
          }>;
        }).getApplication(appName);

        if (!appResult.success || !appResult.data) continue;
        const app = appResult.data;

        const deployNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "custom",
          `codedeploy-${appName}`,
        );

        nodes.push({
          id: deployNodeId,
          name: appName,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: app.applicationId ?? appName,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "codedeploy-application",
            computePlatform: app.computePlatform,
            linkedToGitHub: app.linkedToGitHub ?? false,
            discoverySource: "cicd-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: app.createTime ?? null,
        });
      } catch {
        // Individual deploy app is best-effort
      }
    }
  }
}
