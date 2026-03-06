/**
 * Analytics Step — Migrate Data Warehouse
 *
 * Migrates Redshift / Synapse / BigQuery including cluster configuration
 * AND optional data export/import.
 * Handles:
 *   - Data warehouse cluster provisioning
 *   - Node type and count mapping
 *   - Encryption configuration
 *   - Database schema migration
 *   - Optional data transfer via export/import
 *   - Tag migration
 *
 * Note: Redshift-specific SQL extensions need manual migration;
 * distribution/sort keys have no direct equivalent in BigQuery;
 * node type mapping is approximate.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateDataWarehouseHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const transferData = (params.transferData ?? false) as boolean;

    log.info(`[migrate-data-warehouse] Migrating data warehouses → ${targetProvider} (transferData=${transferData})`);

    const dataWarehouses = (params.dataWarehouses ?? []) as Array<{
      id: string;
      name: string;
      engine: string;
      nodeType: string;
      nodeCount: number;
      storageGB: number;
      encrypted: boolean;
      databases: string[];
      tags?: Record<string, string>;
    }>;
    const migratedWarehouses: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      engine: string;
      dataTransferred: boolean;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          analytics?: {
            createDataWarehouse: (dw: unknown) => Promise<{ id: string; arn?: string }>;
            exportWarehouseData: (id: string) => Promise<{ exportUri: string }>;
            importWarehouseData: (id: string, exportUri: string) => Promise<void>;
            deleteDataWarehouse: (id: string) => Promise<void>;
          };
        }
      | undefined;

    const sourceAdapter = ctx.sourceCredentials as
      | { analytics?: { exportWarehouseData: (id: string) => Promise<{ exportUri: string }> } }
      | undefined;

    for (const dw of dataWarehouses) {
      const name = String(dw.name ?? "");

      if (dw.engine === "redshift" && targetProvider !== "aws") {
        warnings.push(
          `Data warehouse "${name}": Redshift-specific SQL extensions need manual migration`,
        );
      }

      if (targetProvider === "gcp") {
        warnings.push(
          `Data warehouse "${name}": Distribution/sort keys have no direct equivalent in BigQuery`,
        );
      }

      warnings.push(
        `Data warehouse "${name}": Node type mapping is approximate ("${dw.nodeType}" × ${dw.nodeCount})`,
      );

      if (targetAdapter?.analytics) {
        const result = await targetAdapter.analytics.createDataWarehouse({
          name,
          engine: dw.engine,
          nodeType: dw.nodeType,
          nodeCount: dw.nodeCount,
          storageGB: dw.storageGB,
          encrypted: dw.encrypted,
          databases: dw.databases,
          tags: dw.tags,
        });

        let dataTransferred = false;

        if (transferData && sourceAdapter?.analytics) {
          const exportResult = await sourceAdapter.analytics.exportWarehouseData(dw.id);
          await targetAdapter.analytics.importWarehouseData(result.id, exportResult.exportUri);
          dataTransferred = true;
        } else if (transferData) {
          warnings.push(
            `Data warehouse "${name}": Data transfer requested but source adapter not available — skipping data transfer`,
          );
        }

        migratedWarehouses.push({
          sourceId: dw.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          engine: dw.engine,
          dataTransferred,
        });
      } else {
        migratedWarehouses.push({
          sourceId: dw.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          engine: dw.engine,
          dataTransferred: false,
        });
      }
    }

    log.info(`[migrate-data-warehouse] Migrated ${migratedWarehouses.length} data warehouses`);

    return {
      migratedWarehouses,
      warehousesCount: migratedWarehouses.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedWarehouses = (outputs.migratedWarehouses ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-data-warehouse] Rolling back ${migratedWarehouses.length} data warehouses`);

    const targetAdapter = ctx.targetCredentials as
      | { analytics?: { deleteDataWarehouse: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.analytics) {
      for (const dw of migratedWarehouses) {
        await targetAdapter.analytics.deleteDataWarehouse(dw.targetId);
      }
    }

    log.info("[migrate-data-warehouse] Rollback complete");
  },
};
