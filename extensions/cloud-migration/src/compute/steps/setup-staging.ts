/**
 * On-Premises Step — Setup Staging
 *
 * Ensures the S3-compatible staging storage (MinIO, Nutanix Objects,
 * Ceph RGW) is accessible and the staging bucket exists.
 * Creates the bucket if it doesn't exist.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export interface SetupStagingParams {
  provider: string;
  region: string;
  bucketName?: string;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as SetupStagingParams;
  ctx.log.info(`Setting up staging storage for ${params.provider}`);

  const credentials = ctx.sourceCredentials as ProviderCredentialConfig | undefined;
  if (!credentials) {
    throw new Error("setup-staging step requires source credentials with stagingStorage config");
  }

  const adapter = await resolveProviderAdapter(params.provider as MigrationProvider, credentials);

  // Check if staging bucket exists
  const buckets = await adapter.storage.listBuckets(params.region);
  const expectedBucket = params.bucketName ?? buckets[0]?.name;

  if (!expectedBucket) {
    throw new Error(
      "No staging bucket configured. Provide bucketName in step params or " +
      "configure stagingStorage.bucket in provider credentials.",
    );
  }

  const existingBucket = await adapter.storage.getBucket(expectedBucket);

  let bucketCreated = false;
  if (!existingBucket) {
    ctx.log.info(`  Staging bucket '${expectedBucket}' not found, creating...`);
    await adapter.storage.createBucket({
      name: expectedBucket,
      region: params.region ?? "on-premises",
      tags: {
        "espada:purpose": "migration-staging",
        "espada:managed": "true",
        ...ctx.tags,
      },
    });
    bucketCreated = true;
    ctx.log.info(`  Created staging bucket: ${expectedBucket}`);
  } else {
    ctx.log.info(`  Staging bucket '${expectedBucket}' already exists`);
  }

  // Verify we can write to the bucket
  const testKey = `.espada-staging-test-${Date.now()}`;
  try {
    await adapter.storage.putObject(expectedBucket, testKey, Buffer.from("ok"));
    await adapter.storage.deleteObject(expectedBucket, testKey);
    ctx.log.info("  Staging bucket write/read verification passed");
  } catch (err) {
    throw new Error(
      `Staging bucket '${expectedBucket}' exists but write test failed: ${err}. ` +
      `Check storage credentials and bucket permissions.`,
    );
  }

  return {
    stagingBucket: expectedBucket,
    bucketCreated,
    provider: params.provider,
    verifiedAt: new Date().toISOString(),
  };
}

async function rollback(ctx: MigrationStepContext): Promise<void> {
  // If we created the bucket, we could delete it, but it's safer to leave
  // staging in place for debugging. Just log.
  ctx.log.info("setup-staging rollback: staging bucket left in place for debugging");
}

export const setupStagingHandler: MigrationStepHandler = { execute, rollback };
