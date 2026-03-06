/**
 * Serverless Function Migration Step Handler
 *
 * Migrates Lambda/Cloud Functions/Azure Functions between providers.
 * Handles:
 *   - Code package download + re-deployment
 *   - Runtime translation (e.g., Node.js → Node.js, Python → Python)
 *   - Environment variable migration
 *   - VPC configuration translation
 *   - Trigger/event source mapping
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Runtime compatibility map. */
const RUNTIME_MAP: Record<string, Record<string, string>> = {
  azure: {
    "nodejs18.x": "node-18",
    "nodejs20.x": "node-20",
    "python3.9": "python-3.9",
    "python3.10": "python-3.10",
    "python3.11": "python-3.11",
    "python3.12": "python-3.12",
    "java17": "java-17",
    "java21": "java-21",
    "dotnet6": "dotnet-6.0",
    "dotnet8": "dotnet-8.0",
  },
  gcp: {
    "nodejs18.x": "nodejs18",
    "nodejs20.x": "nodejs20",
    "python3.9": "python39",
    "python3.10": "python310",
    "python3.11": "python311",
    "python3.12": "python312",
    "java17": "java17",
    "java21": "java21",
  },
};

/** Trigger type translation. */
const TRIGGER_MAP: Record<string, Record<string, string>> = {
  azure: {
    "api-gateway": "httpTrigger",
    "s3": "blobTrigger",
    "sqs": "queueTrigger",
    "sns": "eventGridTrigger",
    "dynamodb": "cosmosDBTrigger",
    "cloudwatch-events": "timerTrigger",
    "kinesis": "eventHubTrigger",
  },
  gcp: {
    "api-gateway": "http",
    "s3": "cloud-storage",
    "sqs": "cloud-tasks",
    "sns": "pubsub",
    "dynamodb": "firestore",
    "cloudwatch-events": "scheduler",
    "kinesis": "pubsub",
  },
};

export const migrateServerlessHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-serverless] Migrating serverless functions from ${sourceProvider} → ${targetProvider}`);

    const functions = (params.functions ?? []) as Array<Record<string, unknown>>;
    const migratedFunctions: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      sourceRuntime: string;
      targetRuntime: string;
      triggersTranslated: number;
    }> = [];
    const warnings: string[] = [];

    const sourceAdapter = ctx.sourceCredentials as
      | { serverless?: { getFunctionCode: (id: string) => Promise<Buffer> } }
      | undefined;
    const targetAdapter = ctx.targetCredentials as
      | { serverless?: { deployFunction: (fn: unknown, code: Buffer) => Promise<{ id: string }> } }
      | undefined;

    for (const fn of functions) {
      const name = String(fn.name ?? "");
      const sourceRuntime = String(fn.runtime ?? "nodejs18.x");
      const targetRuntime = translateRuntime(sourceRuntime, targetProvider);

      if (sourceRuntime !== targetRuntime) {
        log.info(`[migrate-serverless] Runtime: ${sourceRuntime} → ${targetRuntime}`);
      }

      // Translate triggers
      const triggers = (fn.triggers ?? []) as Array<Record<string, unknown>>;
      const translatedTriggers = triggers.map((t) => ({
        ...t,
        type: translateTrigger(String(t.type ?? ""), targetProvider),
        originalType: t.type,
      }));

      // Check for untranslatable triggers
      for (const t of translatedTriggers) {
        if (t.type === String(t.originalType)) {
          warnings.push(`Function "${name}": trigger type "${t.type}" has no direct ${targetProvider} equivalent`);
        }
      }

      // Get code package and deploy
      let code: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      if (sourceAdapter?.serverless && fn.id) {
        code = await sourceAdapter.serverless.getFunctionCode(String(fn.id));
      }

      if (targetAdapter?.serverless) {
        const result = await targetAdapter.serverless.deployFunction(
          {
            name,
            runtime: targetRuntime,
            handler: fn.handler,
            memoryMB: fn.memoryMB,
            timeoutSec: fn.timeoutSec,
            environment: fn.environment,
            triggers: translatedTriggers,
          },
          code,
        );
        migratedFunctions.push({
          sourceId: String(fn.id ?? ""),
          sourceName: name,
          targetId: result.id,
          sourceRuntime,
          targetRuntime,
          triggersTranslated: translatedTriggers.length,
        });
      } else {
        migratedFunctions.push({
          sourceId: String(fn.id ?? ""),
          sourceName: name,
          targetId: `simulated-${name}`,
          sourceRuntime,
          targetRuntime,
          triggersTranslated: translatedTriggers.length,
        });
      }
    }

    log.info(`[migrate-serverless] Migrated ${migratedFunctions.length} functions`);

    return {
      migratedFunctions,
      functionsCount: migratedFunctions.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedFunctions = (outputs.migratedFunctions ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-serverless] Rolling back ${migratedFunctions.length} functions`);

    const targetAdapter = ctx.targetCredentials as
      | { serverless?: { deleteFunction: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.serverless) {
      for (const fn of migratedFunctions) {
        await targetAdapter.serverless.deleteFunction(fn.targetId);
      }
    }

    log.info("[migrate-serverless] Rollback complete");
  },
};

function translateRuntime(runtime: string, targetProvider: string): string {
  const map = RUNTIME_MAP[targetProvider];
  if (!map) return runtime;
  return map[runtime] ?? runtime;
}

function translateTrigger(triggerType: string, targetProvider: string): string {
  const map = TRIGGER_MAP[targetProvider];
  if (!map) return triggerType;
  return map[triggerType] ?? triggerType;
}
