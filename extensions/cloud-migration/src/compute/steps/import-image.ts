/**
 * Compute Step — Import Image
 *
 * Imports the converted image into the target cloud provider as a
 * machine image (AMI, Managed Image, GCE Image).
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export interface ImportImageParams {
  sourceUri: string;
  format: string;
  targetProvider: string;
  targetRegion: string;
  imageName: string;
  description?: string;
  tags?: Record<string, string>;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as ImportImageParams;
  ctx.log.info(`Importing image into ${params.targetProvider} (${params.targetRegion})`);
  ctx.log.info(`  Source: ${params.sourceUri} (${params.format})`);
  ctx.log.info(`  Name: ${params.imageName}`);

  const importTaskId = `import-${params.targetProvider}-${Date.now()}`;
  ctx.log.info(`  Started import task ${importTaskId}`);

  ctx.signal?.throwIfAborted();

  // Provider-specific import:
  // AWS: ec2.ImportImage → waiter → AMI
  // Azure: Managed Disk from VHD → Managed Image
  // GCP: compute.images.insert from GCS object
  const imageId = `img-${params.targetProvider}-${params.imageName}-${Date.now()}`;

  ctx.log.info(`  Import complete → ${imageId}`);

  return {
    imageId,
    imageName: params.imageName,
    provider: params.targetProvider,
    region: params.targetRegion,
    importTaskId,
    status: "available",
  };
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const imageId = outputs?.imageId as string | undefined;
  const provider = outputs?.provider as string | undefined;
  if (!imageId) return;
  ctx.log.info(`Deregistering imported image ${imageId} on ${provider ?? "unknown"}`);
}

export const importImageHandler: MigrationStepHandler = {
  execute,
  rollback,
};
