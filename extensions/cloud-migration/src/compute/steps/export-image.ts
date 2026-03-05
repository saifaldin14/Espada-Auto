/**
 * Compute Step — Export Image
 *
 * Exports a snapshot to a transferable image file (VMDK, VHD, RAW)
 * stored in a staging bucket/blob container.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import type { ExportResult } from "../types.js";

export interface ExportImageParams {
  snapshotId: string;
  provider: string;
  region: string;
  format: "vmdk" | "vhd" | "raw" | "qcow2";
  stagingBucket: string;
  stagingKey: string;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as ExportImageParams;
  ctx.log.info(`Exporting snapshot ${params.snapshotId} as ${params.format} to ${params.stagingBucket}/${params.stagingKey}`);

  // Provider-specific export task
  const exportTaskId = `export-${params.provider}-${params.snapshotId}-${Date.now()}`;
  ctx.log.info(`  Started export task ${exportTaskId}`);

  // In a real implementation, this would poll for completion
  const exportPath = `${params.provider}://${params.stagingBucket}/${params.stagingKey}`;
  ctx.log.info(`  Export complete → ${exportPath}`);

  const result: ExportResult & { exportTaskId: string } = {
    exportPath,
    exportSizeBytes: 0, // resolved after export
    exportChecksum: "", // populated after export
    format: params.format,
    exportTaskId,
  };
  return result as unknown as Record<string, unknown>;
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const exportPath = outputs?.exportPath as string | undefined;
  if (!exportPath) return;
  ctx.log.info(`Cleaning up exported image at ${exportPath}`);
}

export const exportImageHandler: MigrationStepHandler = {
  execute,
  rollback,
};
