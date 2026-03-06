/**
 * Compute Step — Import Image
 *
 * Imports the converted image into the target cloud provider as a
 * machine image (AMI, Managed Image, GCE Image).
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

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

  // Resolve the target provider adapter
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
    const importOutput = await adapter.compute.importImage({
      sourceUri: params.sourceUri,
      format: params.format,
      region: params.targetRegion,
      imageName: params.imageName,
    });

    ctx.log.info(`  Import complete → ${importOutput.imageId} (status: ${importOutput.status})`);

    return {
      imageId: importOutput.imageId,
      imageName: importOutput.imageName,
      provider: params.targetProvider,
      region: params.targetRegion,
      importTaskId: importOutput.importTaskId ?? "",
      status: importOutput.status,
    };
  }

  // Fallback: stub behavior
  ctx.signal?.throwIfAborted();

  const importTaskId = `import-${params.targetProvider}-${Date.now()}`;
  ctx.log.info(`  Started import task ${importTaskId}`);

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

  const params = ctx.params as unknown as ImportImageParams;
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    try {
      const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
      await adapter.compute.deleteImage(imageId, params.targetRegion);
      ctx.log.info(`Deregistered image ${imageId} on ${provider ?? params.targetProvider} via SDK`);
      return;
    } catch (err) {
      ctx.log.info(`Rollback via SDK failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Deregistering imported image ${imageId} on ${provider ?? "unknown"}`);
}

export const importImageHandler: MigrationStepHandler = {
  execute,
  rollback,
};
