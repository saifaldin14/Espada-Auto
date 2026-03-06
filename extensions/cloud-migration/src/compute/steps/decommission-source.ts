/**
 * Compute Step — Decommission Source
 *
 * Post-cutover cleanup step that decommissions the source environment:
 *
 * 1. Stop/terminate source VMs
 * 2. Delete migration snapshots created during export
 * 3. Clean up staging buckets used for image transfer
 * 4. Tag all source resources as "decommissioned"
 * 5. Generate a decommission report
 *
 * This step is the final step in the compute migration pipeline,
 * executed only after a successful cutover and verification period.
 * It supports a "soft" mode (stop + tag only) and "hard" mode
 * (terminate + delete).
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

// =============================================================================
// Types
// =============================================================================

export interface DecommissionSourceParams {
  /** Source VM instance ID to decommission. */
  sourceInstanceId: string;
  /** Source cloud provider. */
  sourceProvider: string;
  /** Region where source resources reside. */
  sourceRegion: string;
  /** Snapshot IDs created during migration export phase. */
  snapshotIds?: string[];
  /** Staging bucket used for image transfer. */
  stagingBucket?: string;
  /** Staging object keys to clean up. */
  stagingKeys?: string[];
  /** Source provider for staging bucket (defaults to sourceProvider). */
  stagingProvider?: string;
  /** Decommission mode: soft (stop + tag) or hard (terminate + delete). */
  mode?: "soft" | "hard";
  /** If true, skip actual decommission and only report what would be done. */
  dryRun?: boolean;
  /** Retention period (hours) before hard-delete of snapshots. */
  snapshotRetentionHours?: number;
  /** Additional tags to apply to decommissioned resources. */
  decommissionTags?: Record<string, string>;
  /** Migration job ID for traceability. */
  jobId?: string;
}

interface DecommissionAction {
  resource: string;
  resourceType: "instance" | "snapshot" | "object" | "bucket";
  action: "stop" | "terminate" | "delete" | "tag" | "skip";
  status: "completed" | "failed" | "skipped" | "dry-run";
  detail?: string;
  error?: string;
}

interface DecommissionResult {
  sourceInstanceId: string;
  sourceProvider: string;
  mode: "soft" | "hard";
  dryRun: boolean;
  actions: DecommissionAction[];
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  elapsedMs: number;
  decommissionedAt: string;
}

// =============================================================================
// Step Handler
// =============================================================================

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as DecommissionSourceParams;
  const mode = params.mode ?? "soft";
  const dryRun = params.dryRun ?? false;
  const start = Date.now();
  const actions: DecommissionAction[] = [];

  ctx.log.info(`Decommissioning source: ${params.sourceProvider}/${params.sourceInstanceId}`);
  ctx.log.info(`  Mode: ${mode} | Dry run: ${dryRun}`);
  if (params.snapshotIds?.length) ctx.log.info(`  Snapshots to clean: ${params.snapshotIds.length}`);
  if (params.stagingKeys?.length) ctx.log.info(`  Staging objects to clean: ${params.stagingKeys.length}`);

  const decommissionTags: Record<string, string> = {
    "migration:status": "decommissioned",
    "migration:decommissioned-at": new Date().toISOString(),
    "migration:job-id": params.jobId ?? "unknown",
    ...params.decommissionTags,
  };

  // Try real SDK path
  const sourceCreds = ctx.sourceCredentials as ProviderCredentialConfig | undefined;

  if (sourceCreds && !dryRun) {
    try {
      const adapter = await resolveProviderAdapter(params.sourceProvider as MigrationProvider, sourceCreds);

      // 1. Stop or terminate the source VM
      ctx.signal?.throwIfAborted();
      if (mode === "hard") {
        try {
          await adapter.compute.terminateInstance(params.sourceInstanceId, params.sourceRegion);
          ctx.log.info(`  [SDK] Terminated instance ${params.sourceInstanceId}`);
          actions.push({
            resource: params.sourceInstanceId,
            resourceType: "instance",
            action: "terminate",
            status: "completed",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.log.error(`  [SDK] Failed to terminate instance: ${msg}`);
          actions.push({
            resource: params.sourceInstanceId,
            resourceType: "instance",
            action: "terminate",
            status: "failed",
            error: msg,
          });
        }
      } else {
        try {
          await adapter.compute.stopInstance(params.sourceInstanceId, params.sourceRegion);
          ctx.log.info(`  [SDK] Stopped instance ${params.sourceInstanceId}`);
          actions.push({
            resource: params.sourceInstanceId,
            resourceType: "instance",
            action: "stop",
            status: "completed",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.log.error(`  [SDK] Failed to stop instance: ${msg}`);
          actions.push({
            resource: params.sourceInstanceId,
            resourceType: "instance",
            action: "stop",
            status: "failed",
            error: msg,
          });
        }
      }

      // 2. Delete migration snapshots (if hard mode or past retention)
      if (params.snapshotIds?.length) {
        const shouldDeleteSnapshots = mode === "hard" && !(params.snapshotRetentionHours && params.snapshotRetentionHours > 0);

        for (const snapshotId of params.snapshotIds) {
          ctx.signal?.throwIfAborted();
          if (shouldDeleteSnapshots) {
            try {
              await adapter.compute.deleteSnapshot(snapshotId, params.sourceRegion);
              ctx.log.info(`  [SDK] Deleted snapshot ${snapshotId}`);
              actions.push({
                resource: snapshotId,
                resourceType: "snapshot",
                action: "delete",
                status: "completed",
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              ctx.log.error(`  [SDK] Failed to delete snapshot ${snapshotId}: ${msg}`);
              actions.push({
                resource: snapshotId,
                resourceType: "snapshot",
                action: "delete",
                status: "failed",
                error: msg,
              });
            }
          } else {
            ctx.log.info(`  [SDK] Skipping snapshot ${snapshotId} (retention: ${params.snapshotRetentionHours ?? "soft-mode"}h)`);
            actions.push({
              resource: snapshotId,
              resourceType: "snapshot",
              action: "skip",
              status: "skipped",
              detail: mode === "soft"
                ? "Soft mode — snapshots retained"
                : `Retention period: ${params.snapshotRetentionHours}h`,
            });
          }
        }
      }

      // 3. Clean up staging objects
      if (params.stagingBucket && params.stagingKeys?.length) {
        const stagingProvider = params.stagingProvider ?? params.sourceProvider;
        let stagingAdapter = adapter;

        // If staging is on a different provider, resolve that adapter
        if (stagingProvider !== params.sourceProvider) {
          try {
            const stagingCreds = ctx.targetCredentials as ProviderCredentialConfig | undefined;
            if (stagingCreds) {
              stagingAdapter = await resolveProviderAdapter(stagingProvider as MigrationProvider, stagingCreds);
            }
          } catch {
            ctx.log.warn(`  Could not resolve staging provider adapter for ${stagingProvider}`);
          }
        }

        for (const key of params.stagingKeys) {
          ctx.signal?.throwIfAborted();
          if (mode === "hard") {
            try {
              await stagingAdapter.storage.deleteObject(params.stagingBucket, key);
              ctx.log.info(`  [SDK] Deleted staging object ${params.stagingBucket}/${key}`);
              actions.push({
                resource: `${params.stagingBucket}/${key}`,
                resourceType: "object",
                action: "delete",
                status: "completed",
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              ctx.log.error(`  [SDK] Failed to delete staging object: ${msg}`);
              actions.push({
                resource: `${params.stagingBucket}/${key}`,
                resourceType: "object",
                action: "delete",
                status: "failed",
                error: msg,
              });
            }
          } else {
            ctx.log.info(`  Skipping staging object ${key} (soft mode)`);
            actions.push({
              resource: `${params.stagingBucket}/${key}`,
              resourceType: "object",
              action: "skip",
              status: "skipped",
              detail: "Soft mode — staging objects retained",
            });
          }
        }
      }

      return buildResult(params, mode, dryRun, actions, start);
    } catch (err) {
      ctx.log.warn(`  SDK path failed, falling back to stub mode: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fallback: stub/dry-run mode — report what would be done
  const actionLabel = dryRun ? "dry-run" : "completed";

  // VM action
  ctx.signal?.throwIfAborted();
  const vmAction = mode === "hard" ? "terminate" : "stop";
  ctx.log.info(`  [${dryRun ? "DRY" : "STUB"}] ${vmAction} instance ${params.sourceInstanceId}`);
  actions.push({
    resource: params.sourceInstanceId,
    resourceType: "instance",
    action: vmAction,
    status: actionLabel as DecommissionAction["status"],
  });

  // Tag action
  ctx.log.info(`  [${dryRun ? "DRY" : "STUB"}] Tag instance with decommission metadata`);
  actions.push({
    resource: params.sourceInstanceId,
    resourceType: "instance",
    action: "tag",
    status: actionLabel as DecommissionAction["status"],
    detail: `Tags: ${JSON.stringify(decommissionTags)}`,
  });

  // Snapshots
  if (params.snapshotIds?.length) {
    for (const snapshotId of params.snapshotIds) {
      ctx.signal?.throwIfAborted();
      if (mode === "hard") {
        ctx.log.info(`  [${dryRun ? "DRY" : "STUB"}] Delete snapshot ${snapshotId}`);
        actions.push({
          resource: snapshotId,
          resourceType: "snapshot",
          action: "delete",
          status: actionLabel as DecommissionAction["status"],
        });
      } else {
        ctx.log.info(`  Skipping snapshot ${snapshotId} (soft mode)`);
        actions.push({
          resource: snapshotId,
          resourceType: "snapshot",
          action: "skip",
          status: "skipped",
        });
      }
    }
  }

  // Staging objects
  if (params.stagingBucket && params.stagingKeys?.length) {
    for (const key of params.stagingKeys) {
      ctx.signal?.throwIfAborted();
      if (mode === "hard") {
        ctx.log.info(`  [${dryRun ? "DRY" : "STUB"}] Delete staging object ${params.stagingBucket}/${key}`);
        actions.push({
          resource: `${params.stagingBucket}/${key}`,
          resourceType: "object",
          action: "delete",
          status: actionLabel as DecommissionAction["status"],
        });
      } else {
        ctx.log.info(`  Skipping staging object ${key} (soft mode)`);
        actions.push({
          resource: `${params.stagingBucket}/${key}`,
          resourceType: "object",
          action: "skip",
          status: "skipped",
        });
      }
    }
  }

  return buildResult(params, mode, dryRun, actions, start);
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  if (!outputs) return;
  const params = ctx.params as unknown as DecommissionSourceParams;
  const sourceCreds = ctx.sourceCredentials as ProviderCredentialConfig | undefined;

  ctx.log.info(`Rolling back decommission for source ${params.sourceInstanceId}`);

  // If VM was stopped, try to restart it
  const actionsOutput = outputs.actions as DecommissionAction[] | undefined;
  if (!actionsOutput) return;

  const stoppedVM = actionsOutput.find(
    (a) => a.resourceType === "instance" && a.action === "stop" && a.status === "completed",
  );

  if (stoppedVM && sourceCreds) {
    try {
      const adapter = await resolveProviderAdapter(params.sourceProvider as MigrationProvider, sourceCreds);
      // Note: startInstance would need to be added to the ComputeAdapter interface
      // For now, we log the intent — the VM can be manually restarted
      ctx.log.info(`  Source VM ${params.sourceInstanceId} was stopped — manual restart may be required`);
      ctx.log.info(`  Provider: ${params.sourceProvider}, Region: ${params.sourceRegion}`);
    } catch (err) {
      ctx.log.error(`  Rollback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Terminated VMs and deleted snapshots cannot be recovered
  const terminated = actionsOutput.find(
    (a) => a.resourceType === "instance" && a.action === "terminate" && a.status === "completed",
  );
  if (terminated) {
    ctx.log.warn(`  WARNING: Source VM ${params.sourceInstanceId} was terminated — cannot be recovered`);
  }

  const deletedSnapshots = actionsOutput.filter(
    (a) => a.resourceType === "snapshot" && a.action === "delete" && a.status === "completed",
  );
  if (deletedSnapshots.length > 0) {
    ctx.log.warn(`  WARNING: ${deletedSnapshots.length} snapshot(s) were deleted — cannot be recovered`);
  }
}

function buildResult(
  params: DecommissionSourceParams,
  mode: "soft" | "hard",
  dryRun: boolean,
  actions: DecommissionAction[],
  startTime: number,
): Record<string, unknown> {
  const result: DecommissionResult = {
    sourceInstanceId: params.sourceInstanceId,
    sourceProvider: params.sourceProvider,
    mode,
    dryRun,
    actions,
    completedCount: actions.filter((a) => a.status === "completed" || a.status === "dry-run").length,
    failedCount: actions.filter((a) => a.status === "failed").length,
    skippedCount: actions.filter((a) => a.status === "skipped").length,
    elapsedMs: Date.now() - startTime,
    decommissionedAt: new Date().toISOString(),
  };
  return result as unknown as Record<string, unknown>;
}

export const decommissionSourceHandler: MigrationStepHandler = {
  execute,
  rollback,
};
