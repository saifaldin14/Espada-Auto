/**
 * KMS Key Migration Step Handler
 *
 * Handles KMS key migration between providers. Since key material cannot
 * be transferred, this step:
 *   1. Extracts key metadata and policies from source
 *   2. Creates equivalent keys on target
 *   3. Maps source key IDs → target key IDs for re-encryption
 *   4. Outputs a re-encryption manifest
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateKMSHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-kms] Migrating KMS key configurations from ${sourceProvider} → ${targetProvider}`);

    const keyMapping: Array<{
      sourceKeyId: string;
      sourceAlias: string;
      targetKeyId: string;
      targetAlias: string;
      requiresReEncryption: boolean;
    }> = [];

    const sourceAdapter = ctx.sourceCredentials as
      | { secrets?: { listKMSKeys: () => Promise<Array<{ id: string; alias?: string; keyType: string; usage: string; policy?: Record<string, unknown> }>> } }
      | undefined;
    const targetAdapter = ctx.targetCredentials as
      | { secrets?: { createKMSKey: (k: unknown) => Promise<{ id: string; arn?: string }> } }
      | undefined;

    if (sourceAdapter?.secrets) {
      const keys = await sourceAdapter.secrets.listKMSKeys();
      log.info(`[migrate-kms] Found ${keys.length} KMS keys on ${sourceProvider}`);

      for (const key of keys) {
        if (targetAdapter?.secrets) {
          const targetKey = await targetAdapter.secrets.createKMSKey({
            alias: key.alias,
            keyType: key.keyType,
            usage: key.usage,
            policy: key.policy,
          });
          keyMapping.push({
            sourceKeyId: key.id,
            sourceAlias: key.alias ?? "",
            targetKeyId: targetKey.id,
            targetAlias: key.alias ?? "",
            requiresReEncryption: true,
          });
        } else {
          keyMapping.push({
            sourceKeyId: key.id,
            sourceAlias: key.alias ?? "",
            targetKeyId: `pending-${key.id}`,
            targetAlias: key.alias ?? "",
            requiresReEncryption: true,
          });
        }
      }
    } else {
      log.info("[migrate-kms] No secrets adapter; key metadata cataloged for manual migration");
    }

    log.info(`[migrate-kms] Created ${keyMapping.length} equivalent keys on ${targetProvider}`);

    return {
      keyMapping,
      keysCreated: keyMapping.length,
      requiresReEncryption: keyMapping.some((k) => k.requiresReEncryption),
      reEncryptionManifest: keyMapping.map((k) => ({
        from: k.sourceKeyId,
        to: k.targetKeyId,
      })),
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    log.info("[migrate-kms] KMS key rollback — keys are not deleted automatically for safety");
    log.warn("[migrate-kms] Manual cleanup of target KMS keys may be required");
  },
};
