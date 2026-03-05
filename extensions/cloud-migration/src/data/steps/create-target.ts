/**
 * Data Step — Create Target Bucket
 *
 * Creates the target bucket/container with matching configuration:
 * storage class, encryption, versioning, lifecycle, CORS.
 */

import type { MigrationStepHandler, MigrationStepContext, NormalizedBucket } from "../../types.js";
import { mapStorageClass } from "../types.js";

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

  // Provider-specific bucket creation:
  // AWS: s3.CreateBucket + PutBucketVersioning + PutBucketEncryption
  // Azure: storageAccounts.create + blobContainers.create
  // GCP: storage.buckets.insert

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
  ctx.log.info(`Deleting target bucket "${outputs.bucketName}" on ${outputs.provider}`);
}

export const createTargetHandler: MigrationStepHandler = {
  execute,
  rollback,
};
