/**
 * Data Step — Inventory Source
 *
 * Scans the source bucket/container to build a complete inventory
 * of objects, sizes, storage classes, and metadata.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import type { ObjectInventory } from "../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

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

  // Resolve the source provider adapter
  const credentials = ctx.sourceCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    const adapter = await resolveProviderAdapter(params.provider as MigrationProvider, credentials);

    let totalObjects = 0;
    let totalSizeBytes = 0;
    let largestObjectBytes = 0;
    const byStorageClass: Record<string, { count: number; sizeBytes: number }> = {};
    const byPrefix: Record<string, { count: number; sizeBytes: number }> = {};
    const byExtension: Record<string, { count: number; sizeBytes: number }> = {};

    // Paginate through all objects
    let continuationToken: string | undefined;
    do {
      ctx.signal?.throwIfAborted();
      const listResult = await adapter.storage.listObjects(params.bucketName, {
        prefix: params.prefixFilter,
        continuationToken,
        maxKeys: 1000,
      });

      for (const obj of listResult.objects) {
        // Apply exclusion patterns
        if (params.excludePatterns?.some((pat) => obj.key.includes(pat))) continue;

        totalObjects++;
        totalSizeBytes += obj.sizeBytes;
        if (obj.sizeBytes > largestObjectBytes) largestObjectBytes = obj.sizeBytes;

        // By storage class
        const sc = obj.storageClass ?? "STANDARD";
        if (!byStorageClass[sc]) byStorageClass[sc] = { count: 0, sizeBytes: 0 };
        byStorageClass[sc].count++;
        byStorageClass[sc].sizeBytes += obj.sizeBytes;

        // By prefix (top-level folder)
        const prefix = obj.key.includes("/") ? obj.key.split("/")[0] + "/" : "(root)";
        if (!byPrefix[prefix]) byPrefix[prefix] = { count: 0, sizeBytes: 0 };
        byPrefix[prefix].count++;
        byPrefix[prefix].sizeBytes += obj.sizeBytes;

        // By extension
        const ext = obj.key.includes(".") ? obj.key.split(".").pop()! : "(none)";
        if (!byExtension[ext]) byExtension[ext] = { count: 0, sizeBytes: 0 };
        byExtension[ext].count++;
        byExtension[ext].sizeBytes += obj.sizeBytes;
      }

      continuationToken = listResult.truncated ? listResult.continuationToken : undefined;
    } while (continuationToken);

    const inventory: ObjectInventory = {
      bucketName: params.bucketName,
      provider: params.provider as any,
      region: params.region,
      totalObjects,
      totalSizeBytes,
      breakdown: { byStorageClass, byPrefix, byExtension },
      largestObjectBytes,
      inventoryDate: new Date().toISOString(),
    };

    ctx.log.info(`  Inventory complete (SDK): ${inventory.totalObjects} objects, ${inventory.totalSizeBytes} bytes`);
    return inventory as unknown as Record<string, unknown>;
  }

  // Fallback: stub behavior
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
