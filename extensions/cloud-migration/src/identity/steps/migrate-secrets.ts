/**
 * Secrets Migration Step Handler
 *
 * Migrates secrets and KMS keys from source to target provider.
 * Secrets values are transferred securely in-memory, never serialized to disk.
 * KMS keys are NOT transferable (key material stays with provider) —
 * instead, we create equivalent keys and re-encrypt affected resources.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateSecretsHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-secrets] Migrating secrets from ${sourceProvider} → ${targetProvider}`);

    const sourceAdapter = ctx.sourceCredentials as
      | { secrets?: { listSecrets: () => Promise<Array<{ id: string; name: string }>>; getSecretValue: (id: string) => Promise<{ value: string }> } }
      | undefined;
    const targetAdapter = ctx.targetCredentials as
      | { secrets?: { createSecret: (s: unknown, v: string) => Promise<{ id: string }>; createKMSKey: (k: unknown) => Promise<{ id: string }> } }
      | undefined;

    const migratedSecrets: Array<{ sourceId: string; sourceName: string; targetId: string }> = [];
    const migratedKeys: Array<{ sourceId: string; targetId: string }> = [];
    const warnings: string[] = [];

    if (sourceAdapter?.secrets && targetAdapter?.secrets) {
      const secrets = await sourceAdapter.secrets.listSecrets();
      log.info(`[migrate-secrets] Found ${secrets.length} secrets to migrate`);

      for (const secret of secrets) {
        // Retrieve value in-memory (never written to disk)
        const { value } = await sourceAdapter.secrets.getSecretValue(secret.id);
        const result = await targetAdapter.secrets.createSecret(
          { name: secret.name, provider: targetProvider },
          value,
        );
        migratedSecrets.push({
          sourceId: secret.id,
          sourceName: secret.name,
          targetId: result.id,
        });
      }
    } else {
      log.info("[migrate-secrets] No secrets adapter available; cataloging secrets for manual migration");
      warnings.push("Secrets adapter not configured — secrets must be manually migrated or re-created");
    }

    // KMS keys: create equivalents (key material is NOT transferable)
    const kmsKeys = (params.kmsKeys ?? []) as Array<Record<string, unknown>>;
    if (kmsKeys.length > 0) {
      log.info(`[migrate-secrets] Creating ${kmsKeys.length} equivalent KMS keys on ${targetProvider}`);
      warnings.push(
        "KMS key material cannot be transferred between providers. New keys created; " +
        "data must be re-encrypted with target keys.",
      );

      if (targetAdapter?.secrets) {
        for (const key of kmsKeys) {
          const result = await targetAdapter.secrets.createKMSKey({
            alias: key.alias,
            keyType: key.keyType ?? "symmetric",
            usage: key.usage ?? "encrypt-decrypt",
          });
          migratedKeys.push({ sourceId: String(key.id), targetId: result.id });
        }
      }
    }

    log.info(
      `[migrate-secrets] Migrated ${migratedSecrets.length} secrets, ${migratedKeys.length} KMS keys`,
    );

    return {
      migratedSecrets,
      migratedKeys,
      secretsCount: migratedSecrets.length,
      kmsKeysCount: migratedKeys.length,
      warnings,
      requiresReEncryption: migratedKeys.length > 0,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedSecrets = (outputs.migratedSecrets ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-secrets] Rolling back ${migratedSecrets.length} secrets`);

    const targetAdapter = ctx.targetCredentials as
      | { secrets?: { deleteSecret: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.secrets) {
      for (const secret of migratedSecrets) {
        await targetAdapter.secrets.deleteSecret(secret.targetId);
      }
    }

    log.info("[migrate-secrets] Rollback complete");
  },
};
