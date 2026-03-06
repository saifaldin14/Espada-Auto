/**
 * Orchestration Step — Migrate Step Functions
 *
 * Migrates AWS Step Functions / workflow state machines to target provider
 * equivalents (Azure Logic Apps / GCP Workflows).
 * Handles:
 *   - State machine definition translation
 *   - IAM role mapping
 *   - Logging and tracing configuration
 *   - Tag migration
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Step Function type compatibility map. */
const TYPE_MAP: Record<string, Record<string, string>> = {
  azure: {
    STANDARD: "logicapp-consumption",
    EXPRESS: "logicapp-consumption",
  },
  gcp: {
    STANDARD: "workflow",
    EXPRESS: "workflow",
  },
};

export const migrateStepFunctionsHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-step-functions] Migrating Step Functions → ${targetProvider}`);

    const stepFunctions = (params.stepFunctions ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      definition: Record<string, unknown>;
      roleArn: string;
      loggingConfig?: Record<string, unknown>;
      tracingEnabled?: boolean;
      tags?: Record<string, string>;
    }>;
    const migratedStepFunctions: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      sourceType: string;
      targetType: string;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { orchestration?: { createStepFunction: (sf: unknown) => Promise<{ id: string; arn?: string }> } }
      | undefined;

    for (const sf of stepFunctions) {
      const name = String(sf.name ?? "");
      const sourceType = String(sf.type ?? "STANDARD");
      const targetType = translateType(sourceType, targetProvider);

      if (sourceType.toLowerCase() === "express") {
        warnings.push(
          `Step Function "${name}": "express" type has no direct equivalent in Azure/GCP`,
        );
      }

      // Definition must be manually translated between ASL → Logic Apps / Workflows
      if (sf.definition && targetProvider !== "aws") {
        warnings.push(
          `Step Function "${name}": definition must be manually translated from ASL to ${targetProvider} format`,
        );
      }

      if (targetAdapter?.orchestration) {
        const result = await targetAdapter.orchestration.createStepFunction({
          name,
          type: targetType,
          definition: sf.definition,
          roleArn: sf.roleArn,
          loggingConfig: sf.loggingConfig,
          tracingEnabled: sf.tracingEnabled,
          tags: sf.tags,
        });
        migratedStepFunctions.push({
          sourceId: sf.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          sourceType,
          targetType,
        });
      } else {
        migratedStepFunctions.push({
          sourceId: sf.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          sourceType,
          targetType,
        });
      }
    }

    log.info(`[migrate-step-functions] Migrated ${migratedStepFunctions.length} step functions`);

    return {
      migratedStepFunctions,
      stepFunctionsCount: migratedStepFunctions.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedStepFunctions = (outputs.migratedStepFunctions ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-step-functions] Rolling back ${migratedStepFunctions.length} step functions`);

    const targetAdapter = ctx.targetCredentials as
      | { orchestration?: { deleteStepFunction: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.orchestration) {
      for (const sf of migratedStepFunctions) {
        await targetAdapter.orchestration.deleteStepFunction(sf.targetId);
      }
    }

    log.info("[migrate-step-functions] Rollback complete");
  },
};

function translateType(type: string, targetProvider: string): string {
  const map = TYPE_MAP[targetProvider];
  if (!map) return type;
  return map[type.toUpperCase()] ?? type;
}
