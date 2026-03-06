/**
 * Analytics Step — Migrate Stream
 *
 * Migrates Kinesis Data Streams / Firehose to target provider equivalents
 * (Azure Event Hubs / GCP Pub/Sub).
 * Handles:
 *   - Stream creation with shard/partition configuration
 *   - Retention period mapping
 *   - Consumer registration
 *   - Encryption configuration
 *   - Tag migration
 *
 * Note: Shard-to-partition mapping differs; enhanced fan-out consumers need
 * application changes; Firehose delivery streams require manual destination config.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateStreamHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-stream] Migrating streams → ${targetProvider}`);

    const streams = (params.streams ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      shardCount: number;
      retentionHours: number;
      consumers: Array<Record<string, unknown>>;
      encryption: Record<string, unknown>;
      tags?: Record<string, string>;
    }>;
    const migratedStreams: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      type: string;
      shardCount: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { analytics?: { createStream: (stream: unknown) => Promise<{ id: string; arn?: string }>; deleteStream: (id: string) => Promise<void> } }
      | undefined;

    for (const stream of streams) {
      const name = String(stream.name ?? "");

      if (stream.shardCount > 1 && targetProvider !== "aws") {
        warnings.push(
          `Stream "${name}": Shard-to-partition mapping differs between providers (${stream.shardCount} shards)`,
        );
      }

      const hasEnhancedFanOut = stream.consumers.some(
        (c) => (c as { type?: string }).type === "enhanced-fan-out",
      );
      if (hasEnhancedFanOut) {
        warnings.push(
          `Stream "${name}": Enhanced fan-out consumers need application changes for ${targetProvider}`,
        );
      }

      if (stream.type === "firehose") {
        warnings.push(
          `Stream "${name}": Firehose delivery streams require manual destination configuration in ${targetProvider}`,
        );
      }

      if (targetAdapter?.analytics) {
        const result = await targetAdapter.analytics.createStream({
          name,
          type: stream.type,
          shardCount: stream.shardCount,
          retentionHours: stream.retentionHours,
          consumers: stream.consumers,
          encryption: stream.encryption,
          tags: stream.tags,
        });
        migratedStreams.push({
          sourceId: stream.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          type: stream.type,
          shardCount: stream.shardCount,
        });
      } else {
        migratedStreams.push({
          sourceId: stream.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          type: stream.type,
          shardCount: stream.shardCount,
        });
      }
    }

    log.info(`[migrate-stream] Migrated ${migratedStreams.length} streams`);

    return {
      migratedStreams,
      streamsCount: migratedStreams.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedStreams = (outputs.migratedStreams ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-stream] Rolling back ${migratedStreams.length} streams`);

    const targetAdapter = ctx.targetCredentials as
      | { analytics?: { deleteStream: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.analytics) {
      for (const stream of migratedStreams) {
        await targetAdapter.analytics.deleteStream(stream.targetId);
      }
    }

    log.info("[migrate-stream] Rollback complete");
  },
};
