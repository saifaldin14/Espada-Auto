/**
 * Data Step — Transfer Objects
 *
 * Performs the actual object transfer using the transfer engine
 * with multi-part parallel streaming and per-chunk verification.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import type { ObjectTransferResult } from "../types.js";
import { createObjectTransfer } from "../transfer-engine.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export interface TransferObjectsParams {
  sourceBucket: string;
  sourceProvider: string;
  sourceRegion: string;
  targetBucket: string;
  targetProvider: string;
  targetRegion: string;
  concurrency?: number;
  chunkSizeMB?: number;
  prefixFilter?: string;
  excludePatterns?: string[];
  storageClassMapping?: Record<string, string>;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as TransferObjectsParams;

  ctx.log.info(`Transferring objects: ${params.sourceProvider}://${params.sourceBucket} → ${params.targetProvider}://${params.targetBucket}`);
  ctx.log.info(`  Concurrency: ${params.concurrency ?? 16}, chunk size: ${params.chunkSizeMB ?? 64}MB`);

  // Resolve source and target adapters
  const sourceCreds = ctx.sourceCredentials as ProviderCredentialConfig | undefined;
  const targetCreds = ctx.targetCredentials as ProviderCredentialConfig | undefined;

  let sourceAdapter;
  let targetAdapter;

  if (sourceCreds) {
    sourceAdapter = await resolveProviderAdapter(params.sourceProvider as MigrationProvider, sourceCreds);
  }
  if (targetCreds) {
    targetAdapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, targetCreds);
  }

  const transfer = createObjectTransfer(
    {
      sourceBucket: params.sourceBucket,
      sourceProvider: params.sourceProvider as any,
      sourceRegion: params.sourceRegion,
      targetBucket: params.targetBucket,
      targetProvider: params.targetProvider as any,
      targetRegion: params.targetRegion,
      concurrency: params.concurrency ?? 16,
      chunkSizeMB: params.chunkSizeMB ?? 64,
      prefixFilter: params.prefixFilter,
      excludePatterns: params.excludePatterns,
      storageClassMapping: params.storageClassMapping,
      metadataPreserve: true,
      aclPreserve: false,
    },
    {
      sourceAdapter: sourceAdapter,
      targetAdapter: targetAdapter,
    },
  );

  ctx.log.info(`  Transfer task: ${transfer.taskId}`);

  const result = await transfer.start(ctx.signal);

  ctx.log.info(`  Transfer complete: ${result.objectsTransferred} objects, ${result.bytesTransferred} bytes in ${result.durationMs}ms`);

  if (result.objectsFailed > 0) {
    ctx.log.info(`  WARNING: ${result.objectsFailed} objects failed to transfer`);
  }

  return result as unknown as Record<string, unknown>;
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  if (!outputs) return;
  const objectsTransferred = outputs.objectsTransferred as number | undefined;
  const targetBucket = outputs.targetBucket as string | undefined;
  ctx.log.info(`Rolling back: would need to delete ${objectsTransferred ?? 0} objects from ${targetBucket}`);
}

export const transferObjectsHandler: MigrationStepHandler = {
  execute,
  rollback,
};
