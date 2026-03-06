/**
 * Identity Step — Migrate Identity Provider
 *
 * Migrates identity providers (Cognito User Pools / SAML / OIDC) to target
 * provider equivalents (Azure AD B2C / Firebase Auth / GCP Identity Platform).
 * Handles:
 *   - Identity provider configuration migration
 *   - Client ID mapping
 *   - User attribute schema migration
 *   - MFA configuration
 *   - Custom domain configuration
 *   - Tag migration
 *
 * Note: User passwords cannot be migrated (require reset flow); Lambda triggers
 * need re-implementation; custom domains need DNS re-pointing.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateIdentityProviderHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-identity-provider] Migrating identity providers → ${targetProvider}`);

    const identityProviders = (params.identityProviders ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      metadataUrl: string;
      clientIds: string[];
      userCount: number;
      userAttributes: string[];
      mfaConfig: Record<string, unknown>;
      customDomain?: string;
      triggers?: Record<string, unknown>;
      tags?: Record<string, string>;
    }>;
    const migratedProviders: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      type: string;
      userCount: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { iam?: { createIdentityProvider: (idp: unknown) => Promise<{ id: string; arn?: string }>; deleteIdentityProvider: (id: string) => Promise<void> } }
      | undefined;

    for (const idp of identityProviders) {
      const name = String(idp.name ?? "");

      if (idp.userCount > 0) {
        warnings.push(
          `Identity provider "${name}": User passwords cannot be migrated — users will require a password reset flow`,
        );
      }

      if (idp.triggers && Object.keys(idp.triggers).length > 0) {
        warnings.push(
          `Identity provider "${name}": Lambda triggers need re-implementation for ${targetProvider}`,
        );
      }

      if (idp.customDomain) {
        warnings.push(
          `Identity provider "${name}": Custom domain "${idp.customDomain}" needs DNS re-pointing`,
        );
      }

      if (targetAdapter?.iam) {
        const result = await targetAdapter.iam.createIdentityProvider({
          name,
          type: idp.type,
          metadataUrl: idp.metadataUrl,
          clientIds: idp.clientIds,
          userAttributes: idp.userAttributes,
          mfaConfig: idp.mfaConfig,
          customDomain: idp.customDomain,
          tags: idp.tags,
        });
        migratedProviders.push({
          sourceId: idp.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          type: idp.type,
          userCount: idp.userCount,
        });
      } else {
        migratedProviders.push({
          sourceId: idp.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          type: idp.type,
          userCount: idp.userCount,
        });
      }
    }

    log.info(`[migrate-identity-provider] Migrated ${migratedProviders.length} identity providers`);

    return {
      migratedProviders,
      providersCount: migratedProviders.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedProviders = (outputs.migratedProviders ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-identity-provider] Rolling back ${migratedProviders.length} identity providers`);

    const targetAdapter = ctx.targetCredentials as
      | { iam?: { deleteIdentityProvider: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.iam) {
      for (const idp of migratedProviders) {
        await targetAdapter.iam.deleteIdentityProvider(idp.targetId);
      }
    }

    log.info("[migrate-identity-provider] Rollback complete");
  },
};
