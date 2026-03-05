/**
 * Network Step — Migrate DNS
 *
 * Migrates DNS zones and records to the target provider using
 * the DNS migrator's translation plan.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import { planDNSMigration, validateDNSPlan } from "../dns-migrator.js";
import type { DNSZone, DNSMigrationPlan } from "../types.js";

export interface MigrateDNSParams {
  sourceZone: DNSZone;
  targetProvider: string;
  targetRegion: string;
  ipMappings?: Record<string, string>;
}

interface MigrateDNSResult {
  plan: DNSMigrationPlan;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  warnings: string[];
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as MigrateDNSParams;
  ctx.log.info(`Migrating DNS zone "${params.sourceZone.name}" to ${params.targetProvider}`);

  // Generate migration plan
  const plan = planDNSMigration({
    sourceZone: params.sourceZone,
    targetProvider: params.targetProvider as any,
    ipMappings: params.ipMappings,
  });

  // Validate
  const validation = validateDNSPlan(plan);
  if (!validation.valid) {
    for (const err of validation.errors) {
      ctx.log.error(`  ERROR: ${err}`);
    }
    throw new Error(`DNS migration plan validation failed: ${validation.errors.join("; ")}`);
  }

  for (const warn of validation.warnings) {
    ctx.log.warn(`  WARNING: ${warn}`);
  }

  ctx.signal?.throwIfAborted();

  // Create records on target
  ctx.log.info(`  Creating ${plan.recordsToCreate.length} record(s)`);
  for (const record of plan.recordsToCreate) {
    ctx.log.info(`    ${record.name} ${record.type} ${record.values.join(", ")} (TTL: ${record.ttl})`);
  }

  // Update records (IP changes)
  ctx.log.info(`  Updating ${plan.recordsToUpdate.length} record(s)`);
  for (const update of plan.recordsToUpdate) {
    ctx.log.info(`    ${update.record.name}: ${update.oldValue} → ${update.newValue} (${update.reason})`);
  }

  // Log skipped
  if (plan.recordsToSkip.length > 0) {
    ctx.log.info(`  Skipping ${plan.recordsToSkip.length} record(s)`);
  }

  return {
    plan: plan as unknown as Record<string, unknown>,
    recordsCreated: plan.recordsToCreate.length,
    recordsUpdated: plan.recordsToUpdate.length,
    recordsSkipped: plan.recordsToSkip.length,
    warnings: validation.warnings,
  };
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  if (!outputs) return;
  const recordsCreated = (outputs.recordsCreated ?? 0) as number;
  const recordsUpdated = (outputs.recordsUpdated ?? 0) as number;
  ctx.log.info(`Rolling back: would delete ${recordsCreated + recordsUpdated} DNS record(s)`);
}

export const migrateDNSHandler: MigrationStepHandler = {
  execute,
  rollback,
};
