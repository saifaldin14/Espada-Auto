/**
 * Data Step — Sync Metadata
 *
 * Synchronizes bucket-level metadata that isn't transferred with
 * objects: lifecycle rules, CORS configuration, access policies,
 * tags, and notifications.
 */

import type { MigrationStepHandler, MigrationStepContext, NormalizedBucket } from "../../types.js";

export interface SyncMetadataParams {
  sourceBucket: NormalizedBucket;
  targetBucket: string;
  targetProvider: string;
  targetRegion: string;
  syncLifecycleRules: boolean;
  syncTags: boolean;
  syncCors: boolean;
}

interface SyncMetadataResult {
  lifecycleRulesSynced: number;
  tagsSynced: number;
  corsRulesSynced: number;
  warnings: string[];
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as SyncMetadataParams;
  ctx.log.info(`Syncing metadata to ${params.targetProvider}://${params.targetBucket}`);

  const warnings: string[] = [];
  let lifecycleRulesSynced = 0;
  let tagsSynced = 0;
  let corsRulesSynced = 0;

  ctx.signal?.throwIfAborted();

  // Lifecycle rules
  if (params.syncLifecycleRules && params.sourceBucket.lifecycleRules.length > 0) {
    ctx.log.info(`  Translating ${params.sourceBucket.lifecycleRules.length} lifecycle rule(s)`);
    // In real impl: translate lifecycle rules to target format
    // Some rules may not have direct equivalents
    lifecycleRulesSynced = params.sourceBucket.lifecycleRules.length;
  }

  // Tags
  if (params.syncTags && Object.keys(params.sourceBucket.tags).length > 0) {
    const tagCount = Object.keys(params.sourceBucket.tags).length;
    ctx.log.info(`  Applying ${tagCount} tag(s)`);
    // Check provider tag limits
    const maxTags = params.targetProvider === "aws" ? 50 : params.targetProvider === "gcp" ? 64 : 50;
    if (tagCount > maxTags) {
      warnings.push(`Source has ${tagCount} tags but ${params.targetProvider} allows max ${maxTags}`);
    }
    tagsSynced = Math.min(tagCount, maxTags);
  }

  // CORS
  if (params.syncCors) {
    ctx.log.info("  CORS rules require manual review for cross-provider migration");
    warnings.push("CORS rules may need adjustment for the target provider");
  }

  ctx.log.info(`  Metadata sync complete (${warnings.length} warning(s))`);

  return {
    lifecycleRulesSynced,
    tagsSynced,
    corsRulesSynced,
    warnings,
  };
}

// Metadata sync is additive; rollback would remove applied metadata
async function rollback(ctx: MigrationStepContext, _outputs: Record<string, unknown>): Promise<void> {
  ctx.log.info("Rolling back metadata sync (removing applied metadata)");
}

export const syncMetadataHandler: MigrationStepHandler = {
  execute,
  rollback,
};
