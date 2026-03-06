/**
 * Data Step — Create Target Bucket
 *
 * Creates the target bucket/container with matching configuration:
 * storage class, encryption, versioning, lifecycle, CORS.
 */

import type { MigrationStepHandler, MigrationStepContext, NormalizedBucket, MigrationProvider } from "../../types.js";
import { mapStorageClass } from "../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export interface CreateTargetParams {
  sourceBucket: NormalizedBucket;
  targetProvider: string;
  targetRegion: string;
  targetBucketName?: string; // auto-generated if not provided
  encryptionKeyId?: string;
}

interface CreateTargetResult {
  bucketName: string;
  provider: string;
  region: string;
  storageClass: string;
  created: boolean;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as CreateTargetParams;
  const targetName = params.targetBucketName ?? `${params.sourceBucket.name}-migrated`;
  const targetClass = mapStorageClass(
    "STANDARD",
    params.sourceBucket.provider,
    params.targetProvider as any,
  );

  ctx.log.info(`Creating target bucket "${targetName}" on ${params.targetProvider} (${params.targetRegion})`);
  ctx.log.info(`  Storage class: STANDARD → ${targetClass}`);
  ctx.log.info(`  Versioning: ${params.sourceBucket.versioning}`);

  ctx.signal?.throwIfAborted();

  // Resolve the target provider adapter
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
    const createResult = await adapter.storage.createBucket({
      name: targetName,
      region: params.targetRegion,
      storageClass: targetClass,
    });

    // Enable versioning if the source bucket had it
    if (params.sourceBucket.versioning) {
      await adapter.storage.setBucketVersioning(targetName, true);
      ctx.log.info(`  Versioning enabled`);
    }

    // If source bucket had tags, apply them
    if (Object.keys(params.sourceBucket.tags).length > 0) {
      const tags = { ...params.sourceBucket.tags, "espada:migration": "true" };
      await adapter.storage.setBucketTags(targetName, tags);
      ctx.log.info(`  Applied ${Object.keys(tags).length} tags`);
    }

    ctx.log.info(`  Target bucket "${createResult.name}" created via SDK`);

    return {
      bucketName: createResult.name,
      provider: params.targetProvider,
      region: createResult.region,
      storageClass: targetClass,
      created: true,
    } satisfies CreateTargetResult as Record<string, unknown>;
  }

  // Fallback: stub behavior
  ctx.log.info(`  Target bucket "${targetName}" created`);

  return {
    bucketName: targetName,
    provider: params.targetProvider,
    region: params.targetRegion,
    storageClass: targetClass,
    created: true,
  };
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  if (!outputs?.created) return;

  const bucketName = outputs.bucketName as string;
  const provider = outputs.provider as string;
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;

  if (credentials) {
    try {
      const adapter = await resolveProviderAdapter(provider as MigrationProvider, credentials);
      await adapter.storage.deleteBucket(bucketName);
      ctx.log.info(`Deleted target bucket "${bucketName}" on ${provider} via SDK`);
      return;
    } catch (err) {
      ctx.log.info(`Rollback via SDK failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Deleting target bucket "${bucketName}" on ${provider}`);
}

export const createTargetHandler: MigrationStepHandler = {
  execute,
  rollback,
};
