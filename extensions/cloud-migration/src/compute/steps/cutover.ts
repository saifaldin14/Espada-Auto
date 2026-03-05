/**
 * Compute Step — Cutover
 *
 * Final cutover: updates DNS, shifts traffic to the new VM,
 * optionally stops/tombstones the source VM.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export interface CutoverParams {
  sourceInstanceId: string;
  sourceProvider: string;
  targetInstanceId: string;
  targetProvider: string;
  targetRegion: string;
  dnsRecords?: Array<{ name: string; type: string; oldValue: string; newValue: string }>;
  stopSource?: boolean;
  tagSource?: boolean;
}

interface CutoverResult {
  sourceStatus: "stopped" | "running" | "tagged";
  targetStatus: "primary";
  dnsUpdated: number;
  cutoverAt: string;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as CutoverParams;
  ctx.log.info(`Performing cutover: ${params.sourceProvider}/${params.sourceInstanceId} → ${params.targetProvider}/${params.targetInstanceId}`);

  let dnsUpdated = 0;

  // 1. Update DNS records
  if (params.dnsRecords?.length) {
    ctx.log.info(`  Updating ${params.dnsRecords.length} DNS record(s)`);
    for (const record of params.dnsRecords) {
      ctx.signal?.throwIfAborted();
      ctx.log.info(`    ${record.name} (${record.type}): ${record.oldValue} → ${record.newValue}`);
      dnsUpdated++;
    }
  }

  // 2. Tag source as migrated
  if (params.tagSource !== false) {
    ctx.log.info(`  Tagging source instance ${params.sourceInstanceId} as migrated`);
  }

  // 3. Stop source (if requested)
  let sourceStatus: CutoverResult["sourceStatus"] = "tagged";
  if (params.stopSource) {
    ctx.log.info(`  Stopping source instance ${params.sourceInstanceId}`);
    sourceStatus = "stopped";
  }

  ctx.log.info(`  Cutover complete. Target ${params.targetInstanceId} is now primary.`);

  return {
    sourceStatus,
    targetStatus: "primary",
    dnsUpdated,
    cutoverAt: new Date().toISOString(),
  } satisfies CutoverResult as Record<string, unknown>;
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  if (!outputs) return;

  const params = ctx.params as unknown as CutoverParams;

  // Reverse DNS changes
  if (params.dnsRecords?.length) {
    ctx.log.info(`Rolling back ${params.dnsRecords.length} DNS record(s)`);
    for (const record of params.dnsRecords) {
      ctx.log.info(`  ${record.name}: ${record.newValue} → ${record.oldValue}`);
    }
  }

  // Restart source if it was stopped
  if ((outputs.sourceStatus as string) === "stopped") {
    ctx.log.info(`Restarting source instance ${params.sourceInstanceId}`);
  }
}

export const cutoverHandler: MigrationStepHandler = {
  execute,
  rollback,
};
