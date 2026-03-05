/**
 * Data Step — Inventory Source
 *
 * Scans the source bucket/container to build a complete inventory
 * of objects, sizes, storage classes, and metadata.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import type { ObjectInventory } from "../types.js";

export interface InventorySourceParams {
  bucketName: string;
  provider: string;
  region: string;
  prefixFilter?: string;
  excludePatterns?: string[];
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as InventorySourceParams;
  ctx.log.info(`Inventorying bucket ${params.bucketName} on ${params.provider}`);

  if (params.prefixFilter) {
    ctx.log.info(`  Prefix filter: ${params.prefixFilter}`);
  }
  if (params.excludePatterns?.length) {
    ctx.log.info(`  Exclude patterns: ${params.excludePatterns.join(", ")}`);
  }

  ctx.signal?.throwIfAborted();

  // In real implementation: paginate through all objects
  // collecting size, storage class, prefix distribution
  const inventory: ObjectInventory = {
    bucketName: params.bucketName,
    provider: params.provider as any,
    region: params.region,
    totalObjects: 0,
    totalSizeBytes: 0,
    breakdown: {
      byStorageClass: {},
      byPrefix: {},
      byExtension: {},
    },
    largestObjectBytes: 0,
    inventoryDate: new Date().toISOString(),
  };

  ctx.log.info(`  Inventory complete: ${inventory.totalObjects} objects, ${inventory.totalSizeBytes} bytes`);
  return inventory as unknown as Record<string, unknown>;
}

// Read-only step — no rollback needed
export const inventorySourceHandler: MigrationStepHandler = {
  execute,
};
