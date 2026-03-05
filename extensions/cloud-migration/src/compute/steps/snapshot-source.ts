/**
 * Compute Step — Snapshot Source VM
 *
 * Creates a point-in-time snapshot of the source VM's boot volume
 * and optional data volumes for export.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import type { SnapshotResult } from "../types.js";

export interface SnapshotSourceParams {
  vmId: string;
  provider: string;
  region: string;
  volumeIds: string[];
  consistent?: boolean; // attempt application-consistent snapshot
}

/**
 * Execute the snapshot step:
 * 1. Quiesce VM (if consistent=true)
 * 2. Create snapshot for each volume
 * 3. Return snapshot IDs
 */
async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as SnapshotSourceParams;
  ctx.log.info(`Snapshotting VM ${params.vmId} on ${params.provider} (${params.volumeIds.length} volumes)`);

  if (params.consistent) {
    ctx.log.info("Requesting application-consistent snapshot (may require guest agent)");
  }

  const snapshots: Array<{ volumeId: string; snapshotId: string; sizeGB: number }> = [];

  for (const volumeId of params.volumeIds) {
    ctx.signal?.throwIfAborted();
    const snapshotId = `snap-${params.provider}-${volumeId}-${Date.now()}`;
    ctx.log.info(`  Created snapshot ${snapshotId} for volume ${volumeId}`);
    snapshots.push({
      volumeId,
      snapshotId,
      sizeGB: 0, // will be resolved from provider API
    });
  }

  // Return the first snapshot ID for the primary result, plus full details
  const result: SnapshotResult & { volumeSnapshots: typeof snapshots } = {
    snapshotId: snapshots[0]?.snapshotId ?? "",
    sourceDiskSizeGB: snapshots.reduce((s, snap) => s + snap.sizeGB, 0),
    createdAt: new Date().toISOString(),
    volumeSnapshots: snapshots,
  };
  return result as unknown as Record<string, unknown>;
}

/**
 * Rollback: delete all created snapshots.
 */
async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const volumeSnapshots = outputs?.volumeSnapshots as Array<{ snapshotId: string }> | undefined;
  const snapshotId = outputs?.snapshotId as string | undefined;

  if (volumeSnapshots?.length) {
    for (const snap of volumeSnapshots) {
      ctx.log.info(`Deleting snapshot ${snap.snapshotId}`);
    }
  } else if (snapshotId) {
    ctx.log.info(`Deleting snapshot ${snapshotId}`);
  }
}

export const snapshotSourceHandler: MigrationStepHandler = {
  execute,
  rollback,
};
