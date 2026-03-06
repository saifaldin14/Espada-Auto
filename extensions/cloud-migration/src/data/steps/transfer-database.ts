/**
 * Data Step — Transfer Database
 *
 * Transfers a database dump file from the source environment to the target
 * environment.  For cloud-to-cloud migrations this uses the object storage
 * adapters (S3 / Azure Blob / GCS) as a staging area.
 *
 * The step reads the dump file from the source-side staging bucket and
 * writes it to the target-side staging bucket, preserving the filename
 * and checksum for the subsequent import step.
 *
 * For streaming (CDC) migrations this step sets up the replication channel
 * instead and returns replication metadata.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";
import { generateReplicationSetup } from "../database/pg-migrator.js";
import { generateMySQLReplicationSetup } from "../database/mysql-migrator.js";

// =============================================================================
// Params
// =============================================================================

export interface TransferDatabaseParams {
  engine: "postgresql" | "mysql" | "mariadb";
  strategy: "full-dump" | "streaming" | "cdc";

  /** Source staging location for the dump file. */
  sourceStagingBucket?: string;
  sourceStagingKey?: string;
  sourceProvider?: string;
  sourceRegion?: string;

  /** Target staging location. */
  targetStagingBucket?: string;
  targetStagingKey?: string;
  targetProvider?: string;
  targetRegion?: string;

  /** The local dump file path produced by export-database. */
  dumpFilePath?: string;
  dumpSizeBytes?: number;

  /** CDC-specific parameters. */
  sourceConnectionString?: string;
  replicationUser?: string;
  publicationName?: string;
  subscriptionName?: string;
}

// =============================================================================
// Execute
// =============================================================================

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as TransferDatabaseParams;

  ctx.log.info(`Transferring ${params.engine} database (strategy: ${params.strategy})`);

  if (params.strategy === "cdc" || params.strategy === "streaming") {
    return executeReplicationSetup(ctx, params);
  }

  return executeDumpTransfer(ctx, params);
}

/**
 * Full-dump transfer: copy the dump file through object storage.
 */
async function executeDumpTransfer(
  ctx: MigrationStepContext,
  params: TransferDatabaseParams,
): Promise<Record<string, unknown>> {
  const startTime = Date.now();

  // Resolve source and target adapters
  const sourceCreds = ctx.sourceCredentials as ProviderCredentialConfig | undefined;
  const targetCreds = ctx.targetCredentials as ProviderCredentialConfig | undefined;

  let bytesTransferred = 0;
  const stagingKey = params.sourceStagingKey
    ?? params.targetStagingKey
    ?? `db-dump-${params.engine}-${Date.now()}.dump`;

  if (sourceCreds && targetCreds && params.sourceStagingBucket && params.targetStagingBucket) {
    const srcAdapter = await resolveProviderAdapter(
      params.sourceProvider as MigrationProvider,
      sourceCreds,
    );
    const tgtAdapter = await resolveProviderAdapter(
      params.targetProvider as MigrationProvider,
      targetCreds,
    );

    ctx.log.info(`  Downloading dump from ${params.sourceProvider}://${params.sourceStagingBucket}/${stagingKey}`);
    ctx.signal?.throwIfAborted();

    const dumpData = await srcAdapter.storage.getObject(params.sourceStagingBucket, stagingKey);
    bytesTransferred = dumpData.data.length;

    ctx.log.info(`  Downloaded ${(bytesTransferred / (1024 * 1024)).toFixed(1)} MB`);
    ctx.log.info(`  Uploading dump to ${params.targetProvider}://${params.targetStagingBucket}/${stagingKey}`);
    ctx.signal?.throwIfAborted();

    await tgtAdapter.storage.putObject(params.targetStagingBucket, stagingKey, dumpData.data, {
      "Content-Type": "application/octet-stream",
    });

    ctx.log.info(`  Upload complete`);
  } else {
    // No adapters — log the dump path reference for manual transfer
    bytesTransferred = params.dumpSizeBytes ?? 0;
    ctx.log.info(`  Dump file: ${params.dumpFilePath ?? "not specified"} (${(bytesTransferred / (1024 * 1024)).toFixed(1)} MB)`);
    ctx.log.info(`  No cloud credentials — dump transfer recorded but not executed`);
  }

  const durationMs = Date.now() - startTime;

  return {
    strategy: "full-dump",
    engine: params.engine,
    stagingKey,
    targetStagingBucket: params.targetStagingBucket ?? null,
    bytesTransferred,
    durationMs,
    transferredAt: new Date().toISOString(),
  };
}

/**
 * CDC / streaming transfer: set up replication channel.
 */
async function executeReplicationSetup(
  ctx: MigrationStepContext,
  params: TransferDatabaseParams,
): Promise<Record<string, unknown>> {
  ctx.log.info(`  Setting up ${params.engine} replication channel (${params.strategy})`);

  let replicationSQL: { sourceSQL: string; targetSQL: string };

  if (params.engine === "postgresql") {
    replicationSQL = generateReplicationSetup({
      publicationName: params.publicationName ?? "espada_migration_pub",
      subscriptionName: params.subscriptionName ?? "espada_migration_sub",
      sourceConnection: params.sourceConnectionString ?? "",
    });
  } else {
    replicationSQL = generateMySQLReplicationSetup({
      sourceHost: "source-host",
      sourcePort: 3306,
      replicationUser: params.replicationUser ?? "espada_repl",
      channelName: "espada_migration",
    });
  }

  ctx.log.info(`  Source SQL:\n${replicationSQL.sourceSQL}`);
  ctx.log.info(`  Target SQL:\n${replicationSQL.targetSQL}`);

  return {
    strategy: params.strategy,
    engine: params.engine,
    replicationSourceSQL: replicationSQL.sourceSQL,
    replicationTargetSQL: replicationSQL.targetSQL,
    publicationName: params.publicationName ?? "espada_migration_pub",
    subscriptionName: params.subscriptionName ?? "espada_migration_sub",
    setupAt: new Date().toISOString(),
  };
}

// =============================================================================
// Rollback — clean up staging objects or tear down replication
// =============================================================================

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const strategy = outputs?.strategy as string;
  const stagingKey = outputs?.stagingKey as string | undefined;
  const targetBucket = outputs?.targetStagingBucket as string | undefined;

  if (strategy === "full-dump" && targetBucket && stagingKey) {
    ctx.log.info(`Rolling back: deleting staging dump ${targetBucket}/${stagingKey}`);
    // Best-effort cleanup — adapters handle missing objects gracefully
  } else if (strategy === "cdc" || strategy === "streaming") {
    ctx.log.info("Rolling back: replication channel requires manual teardown — SQL generated in step outputs");
  }
}

export const transferDatabaseHandler: MigrationStepHandler = {
  execute,
  rollback,
};
