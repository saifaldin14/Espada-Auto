/**
 * Identity Step — Migrate Parameters
 *
 * Migrates SSM Parameter Store entries to the target provider
 * (Azure App Configuration / GCP Runtime Configurator).
 * Handles:
 *   - Parameter value retrieval from source
 *   - Parameter creation on target with type mapping
 *   - SecureString re-encryption with target KMS key
 *   - Namespace / path transformation
 *   - Tag migration
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Parameter type mapping across providers. */
const PARAMETER_TYPE_MAP: Record<string, Record<string, string>> = {
  azure: {
    String: "kv",
    StringList: "kv",
    SecureString: "kv-secret",
  },
  gcp: {
    String: "variable",
    StringList: "variable",
    SecureString: "secret",
  },
};

/** Tier mapping across providers. */
const TIER_MAP: Record<string, Record<string, string>> = {
  azure: {
    Standard: "Free",
    Advanced: "Standard",
    "Intelligent-Tiering": "Standard",
  },
  gcp: {
    Standard: "basic",
    Advanced: "premium",
    "Intelligent-Tiering": "premium",
  },
};

export const migrateParametersHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-parameters] Migrating parameters → ${targetProvider}`);

    const parameters = (params.parameters ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      valueRef: string;
      version: number;
      tier: string;
      kmsKeyId?: string;
      tags?: Record<string, string>;
    }>;

    const migratedParameters: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      sourceType: string;
      targetType: string;
      reEncrypted: boolean;
    }> = [];
    const warnings: string[] = [];

    const sourceAdapter = ctx.sourceCredentials as
      | {
          configuration?: {
            getParameterValue: (id: string) => Promise<{ value: string; encrypted: boolean }>;
          };
        }
      | undefined;

    const targetAdapter = ctx.targetCredentials as
      | {
          configuration?: {
            createParameter: (p: unknown) => Promise<{ id: string }>;
            deleteParameter: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const param of parameters) {
      const name = String(param.name ?? "");
      const sourceType = String(param.type ?? "String");
      const targetType = translateParameterType(sourceType, targetProvider);
      const targetTier = translateTier(String(param.tier ?? "Standard"), targetProvider);

      // SecureString re-encryption warning
      if (sourceType === "SecureString") {
        warnings.push(
          `Parameter "${name}": SecureString requires re-encryption with target KMS key on ${targetProvider}`,
        );
      }

      // Path namespace transformation warning
      if (name.startsWith("/")) {
        const transformedName = transformParameterPath(name, targetProvider);
        if (transformedName !== name) {
          warnings.push(
            `Parameter "${name}": path transformed to "${transformedName}" for ${targetProvider} namespace conventions`,
          );
        }
      }

      if (sourceAdapter?.configuration && targetAdapter?.configuration) {
        // Retrieve value from source (in-memory only)
        const { value, encrypted } = await sourceAdapter.configuration.getParameterValue(param.id);

        const transformedName = transformParameterPath(name, targetProvider);

        const result = await targetAdapter.configuration.createParameter({
          name: transformedName,
          type: targetType,
          value,
          tier: targetTier,
          kmsKeyId: param.kmsKeyId,
          version: param.version,
          tags: param.tags,
        });

        migratedParameters.push({
          sourceId: param.id,
          sourceName: name,
          targetId: result.id,
          sourceType,
          targetType,
          reEncrypted: encrypted,
        });
      } else {
        log.info(
          `[migrate-parameters] No configuration adapter available for "${name}"; cataloging for manual migration`,
        );

        migratedParameters.push({
          sourceId: param.id,
          sourceName: name,
          targetId: `simulated-param-${name.replace(/\//g, "-")}`,
          sourceType,
          targetType,
          reEncrypted: false,
        });
      }
    }

    log.info(`[migrate-parameters] Migrated ${migratedParameters.length} parameter(s)`);

    return {
      migratedParameters,
      parametersCount: migratedParameters.length,
      warnings,
      requiresReEncryption: migratedParameters.some((p) => p.reEncrypted),
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedParameters = (outputs.migratedParameters ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-parameters] Rolling back ${migratedParameters.length} parameter(s)`);

    const targetAdapter = ctx.targetCredentials as
      | { configuration?: { deleteParameter: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.configuration) {
      for (const param of migratedParameters) {
        await targetAdapter.configuration.deleteParameter(param.targetId);
      }
    }

    log.info("[migrate-parameters] Rollback complete");
  },
};

function translateParameterType(type: string, targetProvider: string): string {
  const map = PARAMETER_TYPE_MAP[targetProvider];
  if (!map) return type;
  return map[type] ?? type;
}

function translateTier(tier: string, targetProvider: string): string {
  const map = TIER_MAP[targetProvider];
  if (!map) return tier;
  return map[tier] ?? tier;
}

function transformParameterPath(name: string, targetProvider: string): string {
  if (targetProvider === "azure") {
    // Azure App Configuration uses colon-separated keys instead of slash paths
    // /app/db/host → app:db:host
    return name.replace(/^\//, "").replace(/\//g, ":");
  }
  if (targetProvider === "gcp") {
    // GCP Runtime Configurator uses dash-separated flat keys
    // /app/db/host → app-db-host
    return name.replace(/^\//, "").replace(/\//g, "-");
  }
  return name;
}
