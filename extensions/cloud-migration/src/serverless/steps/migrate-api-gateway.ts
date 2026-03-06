/**
 * API Gateway Migration Step Handler
 *
 * Migrates API Gateway configurations between providers:
 *   AWS API Gateway → Azure API Management / GCP API Gateway
 *   Translates routes, integrations, authorizers, and stages.
 *
 * Uses resolveProviderAdapter() → adapter.serverless.createAPIGateway() for real calls.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import type { NormalizedAPIGateway } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export const migrateAPIGatewayHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-api-gateway] Migrating API Gateways from ${sourceProvider} → ${targetProvider}`);

    const gateways = (params.gateways ?? []) as Array<Record<string, unknown>>;
    const migratedGateways: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetEndpoint: string;
      routesMigrated: number;
    }> = [];
    const warnings: string[] = [];

    const targetCreds = ctx.targetCredentials as ProviderCredentialConfig | undefined;
    const targetAdapter = targetCreds
      ? await resolveProviderAdapter(targetProvider as MigrationProvider, targetCreds)
      : undefined;

    for (const gw of gateways) {
      const name = String(gw.name ?? "");
      const routes = (gw.routes ?? []) as Array<Record<string, unknown>>;
      const type = String(gw.type ?? "rest") as "rest" | "http" | "websocket";

      const translatedRoutes = routes.map((r) => ({
        ...r,
        integration: translateIntegration(String(r.integration ?? ""), targetProvider),
        authType: translateAuthType(String(r.authType ?? ""), targetProvider),
      }));

      if (type === "websocket" && targetProvider !== "aws") {
        warnings.push(
          `API Gateway "${name}": WebSocket APIs have limited compatibility with ${targetProvider}`,
        );
      }

      if (targetAdapter) {
        const normalizedGW: NormalizedAPIGateway = {
          id: String(gw.id ?? ""),
          name,
          provider: targetProvider,
          type,
          endpoint: "",
          routes: translatedRoutes as NormalizedAPIGateway["routes"],
          stages: (gw.stages ?? []) as NormalizedAPIGateway["stages"],
          tags: (gw.tags ?? {}) as Record<string, string>,
        };

        const result = await targetAdapter.serverless.createAPIGateway(normalizedGW);
        migratedGateways.push({
          sourceId: String(gw.id ?? ""),
          sourceName: name,
          targetId: result.id,
          targetEndpoint: result.endpoint,
          routesMigrated: translatedRoutes.length,
        });
      } else {
        migratedGateways.push({
          sourceId: String(gw.id ?? ""),
          sourceName: name,
          targetId: `simulated-${name}`,
          targetEndpoint: `https://${name}.${targetProvider}-api.example.com`,
          routesMigrated: translatedRoutes.length,
        });
      }
    }

    log.info(`[migrate-api-gateway] Migrated ${migratedGateways.length} gateways`);

    return {
      migratedGateways,
      gatewaysCount: migratedGateways.length,
      warnings,
      targetProvider,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const targetProvider = (outputs.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const migratedGateways = (outputs.migratedGateways ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-api-gateway] Rolling back ${migratedGateways.length} API Gateways`);

    const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
    if (credentials) {
      const adapter = await resolveProviderAdapter(targetProvider as MigrationProvider, credentials);
      for (const gw of migratedGateways) {
        await adapter.serverless.deleteAPIGateway(gw.targetId).catch(() => {});
      }
    }

    log.info("[migrate-api-gateway] Rollback complete");
  },
};

function translateIntegration(integration: string, targetProvider: string): string {
  if (integration.startsWith("arn:aws:lambda")) {
    switch (targetProvider) {
      case "azure": return integration.replace(/arn:aws:lambda.*/, "azure-function-ref");
      case "gcp": return integration.replace(/arn:aws:lambda.*/, "cloud-function-ref");
      default: return integration;
    }
  }
  return integration;
}

function translateAuthType(authType: string, targetProvider: string): string {
  const AUTH_MAP: Record<string, Record<string, string>> = {
    azure: {
      "AWS_IAM": "azure-ad",
      "COGNITO_USER_POOLS": "azure-ad-b2c",
      "CUSTOM": "custom",
    },
    gcp: {
      "AWS_IAM": "google-iam",
      "COGNITO_USER_POOLS": "firebase-auth",
      "CUSTOM": "custom",
    },
  };
  return AUTH_MAP[targetProvider]?.[authType] ?? authType;
}
