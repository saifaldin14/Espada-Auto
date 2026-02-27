/**
 * AWS Adapter — Organization Domain Module
 *
 * Discovers AWS Organization structure: accounts, OUs, and SCPs
 * via the OrganizationManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId } from "./utils.js";

/**
 * Discover AWS Organization structure: accounts, OUs, and SCPs.
 *
 * Creates `identity` nodes for accounts, `custom` nodes for OUs,
 * and `policy` nodes for SCPs. Links them with `contains`, `member-of`,
 * and `secured-by` edges.
 */
export async function discoverOrganization(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getOrganizationManager();
  if (!mgr) return;

  // Discover accounts
  const accountsResult = await (mgr as {
    listAccounts: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        Id?: string;
        Name?: string;
        Email?: string;
        Status?: string;
        Arn?: string;
        JoinedMethod?: string;
        JoinedTimestamp?: string;
      }>;
    }>;
  }).listAccounts();

  if (accountsResult.success && accountsResult.data) {
    for (const account of accountsResult.data) {
      if (!account.Id) continue;

      const nodeId = buildAwsNodeId(
        ctx.accountId,
        "global",
        "identity",
        account.Id,
      );

      nodes.push({
        id: nodeId,
        name: account.Name ?? account.Id,
        resourceType: "identity",
        provider: "aws",
        region: "global",
        account: ctx.accountId,
        nativeId: account.Arn ?? account.Id,
        status: account.Status === "ACTIVE" ? "running" : "stopped",
        tags: {},
        metadata: {
          email: account.Email,
          joinedMethod: account.JoinedMethod,
          joinedTimestamp: account.JoinedTimestamp,
          resourceSubtype: "aws-account",
          discoverySource: "organization-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: account.JoinedTimestamp ?? null,
      });
    }
  }

  // Discover organizational units
  const ousResult = await (mgr as {
    listOrganizationalUnits: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        Id?: string;
        Name?: string;
        Arn?: string;
      }>;
    }>;
  }).listOrganizationalUnits();

  if (ousResult.success && ousResult.data) {
    for (const ou of ousResult.data) {
      if (!ou.Id) continue;

      const ouNodeId = buildAwsNodeId(
        ctx.accountId,
        "global",
        "custom",
        ou.Id,
      );

      nodes.push({
        id: ouNodeId,
        name: ou.Name ?? ou.Id,
        resourceType: "custom",
        provider: "aws",
        region: "global",
        account: ctx.accountId,
        nativeId: ou.Arn ?? ou.Id,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "organizational-unit",
          discoverySource: "organization-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: null,
      });

      // Link accounts to their OU
      const accountNodes = nodes.filter((n) =>
        n.metadata["resourceSubtype"] === "aws-account",
      );
      for (const accNode of accountNodes) {
        const containsEdgeId = `${ouNodeId}--contains--${accNode.id}`;
        if (!edges.some((e) => e.id === containsEdgeId)) {
          edges.push({
            id: containsEdgeId,
            sourceNodeId: ouNodeId,
            targetNodeId: accNode.id,
            relationshipType: "contains",
            confidence: 0.8,
            discoveredVia: "api-field",
            metadata: {},
          });
        }
      }
    }
  }

  // Discover SCPs (Service Control Policies)
  const policiesResult = await (mgr as {
    listPolicies: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        Id?: string;
        Name?: string;
        Description?: string;
        Arn?: string;
        Type?: string;
        AwsManaged?: boolean;
      }>;
    }>;
  }).listPolicies();

  if (policiesResult.success && policiesResult.data) {
    for (const policy of policiesResult.data) {
      if (!policy.Id) continue;

      const policyNodeId = buildAwsNodeId(
        ctx.accountId,
        "global",
        "policy",
        policy.Id,
      );

      nodes.push({
        id: policyNodeId,
        name: policy.Name ?? policy.Id,
        resourceType: "policy",
        provider: "aws",
        region: "global",
        account: ctx.accountId,
        nativeId: policy.Arn ?? policy.Id,
        status: "running",
        tags: {},
        metadata: {
          description: policy.Description,
          policyType: policy.Type,
          awsManaged: policy.AwsManaged ?? false,
          resourceSubtype: "service-control-policy",
          discoverySource: "organization-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: null,
      });

      // Get policy targets → `secured-by` edges
      try {
        const targetsResult = await (mgr as {
          getPolicyTargets: (policyId: string) => Promise<{
            success: boolean;
            data?: Array<{
              TargetId?: string;
              Arn?: string;
              Name?: string;
              Type?: string;
            }>;
          }>;
        }).getPolicyTargets(policy.Id);

        if (targetsResult.success && targetsResult.data) {
          for (const target of targetsResult.data) {
            if (!target.TargetId) continue;

            const targetNode = nodes.find((n) =>
              n.nativeId.includes(target.TargetId!) ||
              n.metadata["resourceSubtype"] === "aws-account" && n.nativeId.includes(target.TargetId!),
            );
            if (!targetNode) continue;

            const securedByEdgeId = `${targetNode.id}--secured-by--${policyNodeId}`;
            if (!edges.some((e) => e.id === securedByEdgeId)) {
              edges.push({
                id: securedByEdgeId,
                sourceNodeId: targetNode.id,
                targetNodeId: policyNodeId,
                relationshipType: "secured-by",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: { targetType: target.Type },
              });
            }
          }
        }
      } catch {
        // Policy target resolution is best-effort
      }
    }
  }
}
