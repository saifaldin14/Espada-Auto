/**
 * AWS Adapter — Backup Domain Module
 *
 * Discovers AWS Backup resources: plans, vaults, and protected resources
 * via the BackupManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Discover AWS Backup resources: plans, vaults, and protected resources.
 *
 * Creates `custom` nodes for backup plans and vaults, then creates
 * `backs-up` edges from plans to protected resources and `stores-in`
 * edges from recovery points to vaults.
 */
export async function discoverBackupResources(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getBackupManager();
  if (!mgr) return;

  // Discover backup vaults
  const vaultsResult = await (mgr as {
    listBackupVaults: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        BackupVaultName?: string;
        BackupVaultArn?: string;
        CreationDate?: string;
        EncryptionKeyArn?: string;
        NumberOfRecoveryPoints?: number;
        Locked?: boolean;
      }>;
    }>;
  }).listBackupVaults();

  const vaultNodes: GraphNodeInput[] = [];
  if (vaultsResult.success && vaultsResult.data) {
    for (const vault of vaultsResult.data) {
      if (!vault.BackupVaultName) continue;

      const vaultNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        vault.BackupVaultName,
      );

      const vaultNode: GraphNodeInput = {
        id: vaultNodeId,
        name: vault.BackupVaultName,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: vault.BackupVaultArn ?? vault.BackupVaultName,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "backup-vault",
          recoveryPoints: vault.NumberOfRecoveryPoints ?? 0,
          encrypted: !!vault.EncryptionKeyArn,
          locked: vault.Locked ?? false,
          creationDate: vault.CreationDate,
          discoverySource: "backup-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: vault.CreationDate ?? null,
      };

      vaultNodes.push(vaultNode);
      nodes.push(vaultNode);
    }
  }

  // Discover backup plans
  const plansResult = await (mgr as {
    listBackupPlans: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        BackupPlanId?: string;
        BackupPlanName?: string;
        BackupPlanArn?: string;
        CreationDate?: string;
        LastExecutionDate?: string;
        VersionId?: string;
      }>;
    }>;
  }).listBackupPlans();

  if (plansResult.success && plansResult.data) {
    for (const plan of plansResult.data) {
      if (!plan.BackupPlanId) continue;

      const planNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        plan.BackupPlanId,
      );

      nodes.push({
        id: planNodeId,
        name: plan.BackupPlanName ?? plan.BackupPlanId,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: plan.BackupPlanArn ?? plan.BackupPlanId,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "backup-plan",
          lastExecution: plan.LastExecutionDate,
          versionId: plan.VersionId,
          creationDate: plan.CreationDate,
          discoverySource: "backup-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: plan.CreationDate ?? null,
      });

      // Discover selections for this plan → `stores-in` edges to vaults
      try {
        const selectionsResult = await (mgr as {
          listBackupSelections: (planId: string) => Promise<{
            success: boolean;
            data?: Array<{
              SelectionId?: string;
              SelectionName?: string;
              IamRoleArn?: string;
            }>;
          }>;
        }).listBackupSelections(plan.BackupPlanId);

        if (selectionsResult.success && selectionsResult.data) {
          for (const selection of selectionsResult.data) {
            if (!selection.SelectionId) continue;

            // Link plan to default vault (first vault) via stores-in
            if (vaultNodes.length > 0) {
              const storesInEdgeId = `${planNodeId}--stores-in--${vaultNodes[0]!.id}`;
              if (!edges.some((e) => e.id === storesInEdgeId)) {
                edges.push({
                  id: storesInEdgeId,
                  sourceNodeId: planNodeId,
                  targetNodeId: vaultNodes[0]!.id,
                  relationshipType: "stores-in",
                  confidence: 0.8,
                  discoveredVia: "api-field",
                  metadata: { selectionName: selection.SelectionName },
                });
              }
            }
          }
        }
      } catch {
        // Selection resolution is best-effort
      }
    }
  }

  // Discover protected resources → link to existing nodes
  const protectedResult = await (mgr as {
    listProtectedResources: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        ResourceArn?: string;
        ResourceType?: string;
        LastBackupTime?: string;
      }>;
    }>;
  }).listProtectedResources();

  if (protectedResult.success && protectedResult.data) {
    for (const pr of protectedResult.data) {
      if (!pr.ResourceArn) continue;

      const targetNode = findNodeByArnOrId(nodes, pr.ResourceArn, extractResourceId(pr.ResourceArn));
      if (!targetNode) continue;

      // Stamp backup metadata on the protected resource
      targetNode.metadata["lastBackup"] = pr.LastBackupTime;
      targetNode.metadata["backupProtected"] = true;
      targetNode.metadata["backupResourceType"] = pr.ResourceType;

      // Find the most recently created backup plan and create backs-up edge
      const planNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "backup-plan");
      if (planNodes.length > 0) {
        const planNode = planNodes[0]!;
        const backsUpEdgeId = `${planNode.id}--backs-up--${targetNode.id}`;
        if (!edges.some((e) => e.id === backsUpEdgeId)) {
          edges.push({
            id: backsUpEdgeId,
            sourceNodeId: planNode.id,
            targetNodeId: targetNode.id,
            relationshipType: "backs-up",
            confidence: 0.9,
            discoveredVia: "api-field",
            metadata: { resourceType: pr.ResourceType },
          });
        }
      }
    }
  }
}
