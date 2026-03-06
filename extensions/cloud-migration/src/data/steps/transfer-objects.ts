/**
 * Data Step — Transfer Objects
 *
 * Performs the actual object transfer using the transfer engine
 * with multi-part parallel streaming and per-chunk verification.
 *
 * When `streaming` mode is requested (or for large datasets), delegates
 * to the streaming transfer engine which supports:
 * - Resumable transfers (checkpoint-based)
 * - Delta/incremental sync (ETag-based skip)
 * - Bandwidth throttling
 *
 * Falls back to the basic in-memory transfer engine for simple cases.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import type { ObjectTransferResult } from "../types.js";
import { createObjectTransfer } from "../transfer-engine.js";
import { createStreamingTransfer } from "../streaming-transfer-engine.js";
import type { TransferCheckpoint } from "../streaming-transfer-engine.js";
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
  /** Use the streaming transfer engine (recommended for production). */
  useStreaming?: boolean;
  /** Enable delta sync — skip unchanged objects. */
  enableDeltaSync?: boolean;
  /** Enable resumable transfers. */
  enableResume?: boolean;
  /** Resume from a previous checkpoint. */
  checkpoint?: TransferCheckpoint;
  /** Bandwidth limit in bytes/sec (0 = unlimited). */
  bandwidthLimitBytesPerSec?: number;
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

  const transferConfig = {
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
  };

  let result: ObjectTransferResult;

  if (params.useStreaming) {
    // Streaming engine — supports resume, delta sync, bandwidth throttling
    ctx.log.info("  Mode: STREAMING (resumable, delta-aware)");

    const streamingTask = createStreamingTransfer(transferConfig, {
      sourceAdapter,
      targetAdapter,
      concurrency: params.concurrency ?? 16,
      enableDeltaSync: params.enableDeltaSync ?? false,
      enableResume: params.enableResume ?? false,
      checkpoint: params.checkpoint,
      bandwidthLimitBytesPerSec: params.bandwidthLimitBytesPerSec ?? 0,
    });

    ctx.log.info(`  Streaming task: ${streamingTask.taskId}`);
    result = await streamingTask.start(ctx.signal);

    // If resume is enabled, attach checkpoint to the result for persistence
    if (params.enableResume) {
      const checkpoint = streamingTask.getCheckpoint();
      if (checkpoint) {
        (result as any).checkpoint = checkpoint;
      }
    }
  } else {
    // Basic transfer engine
    ctx.log.info("  Mode: BASIC (in-memory)");

    const transfer = createObjectTransfer(transferConfig, {
      sourceAdapter,
      targetAdapter,
    });

    ctx.log.info(`  Transfer task: ${transfer.taskId}`);
    result = await transfer.start(ctx.signal);
  }

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
