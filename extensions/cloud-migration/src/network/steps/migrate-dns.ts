/**
 * Network Step — Migrate DNS
 *
 * Migrates DNS zones and records to the target provider using
 * the DNS migrator's translation plan.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { planDNSMigration, validateDNSPlan } from "../dns-migrator.js";
import type { DNSZone, DNSMigrationPlan } from "../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

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
  targetZoneId?: string;
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

  let targetZoneId: string | undefined;

  // Resolve the target provider adapter for real DNS operations
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);

    // Create the target DNS zone
    const zone = await adapter.dns.createZone({
      name: params.sourceZone.name,
      type: params.sourceZone.type,
    });
    targetZoneId = zone.id;
    ctx.log.info(`  Created DNS zone "${zone.name}" (${zone.id}) via SDK`);

    // Create records
    let recordsCreated = 0;
    ctx.log.info(`  Creating ${plan.recordsToCreate.length} record(s)`);
    for (const record of plan.recordsToCreate) {
      ctx.signal?.throwIfAborted();
      try {
        await adapter.dns.createRecord(zone.id, record);
        ctx.log.info(`    ${record.name} ${record.type} ${record.values.join(", ")} (TTL: ${record.ttl}) ✓`);
        recordsCreated++;
      } catch (err) {
        ctx.log.info(`    ${record.name} creation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Update records (IP changes)
    let recordsUpdated = 0;
    ctx.log.info(`  Updating ${plan.recordsToUpdate.length} record(s)`);
    for (const update of plan.recordsToUpdate) {
      ctx.signal?.throwIfAborted();
      try {
        await adapter.dns.updateRecord(zone.id, update.record);
        ctx.log.info(`    ${update.record.name}: ${update.oldValue} → ${update.newValue} ✓`);
        recordsUpdated++;
      } catch (err) {
        ctx.log.info(`    ${update.record.name} update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (plan.recordsToSkip.length > 0) {
      ctx.log.info(`  Skipping ${plan.recordsToSkip.length} record(s)`);
    }

    return {
      plan: plan as unknown as Record<string, unknown>,
      recordsCreated,
      recordsUpdated,
      recordsSkipped: plan.recordsToSkip.length,
      warnings: validation.warnings,
      targetZoneId,
    };
  }

  // Fallback: stub behavior (log planned operations)
  ctx.log.info(`  Creating ${plan.recordsToCreate.length} record(s)`);
  for (const record of plan.recordsToCreate) {
    ctx.log.info(`    ${record.name} ${record.type} ${record.values.join(", ")} (TTL: ${record.ttl})`);
  }

  ctx.log.info(`  Updating ${plan.recordsToUpdate.length} record(s)`);
  for (const update of plan.recordsToUpdate) {
    ctx.log.info(`    ${update.record.name}: ${update.oldValue} → ${update.newValue} (${update.reason})`);
  }

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
  const targetZoneId = outputs.targetZoneId as string | undefined;

  const params = ctx.params as unknown as MigrateDNSParams;
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;

  if (credentials && targetZoneId) {
    try {
      const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
      await adapter.dns.deleteZone(targetZoneId);
      ctx.log.info(`Deleted DNS zone ${targetZoneId} (${recordsCreated + recordsUpdated} records) via SDK`);
      return;
    } catch (err) {
      ctx.log.info(`Rollback via SDK failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Rolling back: would delete ${recordsCreated + recordsUpdated} DNS record(s)`);
}

export const migrateDNSHandler: MigrationStepHandler = {
  execute,
  rollback,
};
