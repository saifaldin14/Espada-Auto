/**
 * Analytics Step — Migrate Data Pipeline
 *
 * Migrates Glue jobs / Data Factory pipelines / Dataflow jobs to target
 * provider equivalents.
 * Handles:
 *   - Pipeline creation with schedule configuration
 *   - Source and target connection mapping
 *   - Worker type and count configuration
 *   - Tag migration
 *
 * Note: ETL scripts need manual rewrite (PySpark → Azure equivalent);
 * connection strings need updating; crawler configs not portable.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateDataPipelineHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-data-pipeline] Migrating data pipelines → ${targetProvider}`);

    const pipelines = (params.pipelines ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      schedule: string;
      sourceConnections: Array<Record<string, unknown>>;
      targetConnections: Array<Record<string, unknown>>;
      scriptLocation: string;
      workerType: string;
      numberOfWorkers: number;
      tags?: Record<string, string>;
    }>;
    const migratedPipelines: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      type: string;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { analytics?: { createDataPipeline: (pipeline: unknown) => Promise<{ id: string; arn?: string }>; deleteDataPipeline: (id: string) => Promise<void> } }
      | undefined;

    for (const pipeline of pipelines) {
      const name = String(pipeline.name ?? "");

      if (pipeline.scriptLocation && targetProvider !== "aws") {
        warnings.push(
          `Pipeline "${name}": ETL scripts need manual rewrite (PySpark → ${targetProvider} equivalent)`,
        );
      }

      if (pipeline.sourceConnections.length > 0 || pipeline.targetConnections.length > 0) {
        warnings.push(
          `Pipeline "${name}": Connection strings need updating for ${targetProvider}`,
        );
      }

      if (pipeline.type === "crawler") {
        warnings.push(
          `Pipeline "${name}": Crawler configs are not portable between providers`,
        );
      }

      if (targetAdapter?.analytics) {
        const result = await targetAdapter.analytics.createDataPipeline({
          name,
          type: pipeline.type,
          schedule: pipeline.schedule,
          sourceConnections: pipeline.sourceConnections,
          targetConnections: pipeline.targetConnections,
          scriptLocation: pipeline.scriptLocation,
          workerType: pipeline.workerType,
          numberOfWorkers: pipeline.numberOfWorkers,
          tags: pipeline.tags,
        });
        migratedPipelines.push({
          sourceId: pipeline.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          type: pipeline.type,
        });
      } else {
        migratedPipelines.push({
          sourceId: pipeline.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          type: pipeline.type,
        });
      }
    }

    log.info(`[migrate-data-pipeline] Migrated ${migratedPipelines.length} data pipelines`);

    return {
      migratedPipelines,
      pipelinesCount: migratedPipelines.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedPipelines = (outputs.migratedPipelines ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-data-pipeline] Rolling back ${migratedPipelines.length} data pipelines`);

    const targetAdapter = ctx.targetCredentials as
      | { analytics?: { deleteDataPipeline: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.analytics) {
      for (const pipeline of migratedPipelines) {
        await targetAdapter.analytics.deleteDataPipeline(pipeline.targetId);
      }
    }

    log.info("[migrate-data-pipeline] Rollback complete");
  },
};
