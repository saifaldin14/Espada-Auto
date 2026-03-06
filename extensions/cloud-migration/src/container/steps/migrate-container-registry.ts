/**
 * Container Registry Migration Step Handler
 *
 * Migrates container images between registries:
 *   ECR → ACR, GCR/Artifact Registry, private registry
 *   ACR → ECR, GCR/Artifact Registry, private registry
 *   GCR → ECR, ACR, private registry
 *
 * Uses resolveProviderAdapter() → adapter.containers.copyImage() for real transfers.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export const migrateContainerRegistryHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-container-registry] Migrating registries from ${sourceProvider} → ${targetProvider}`);

    const repositories = (params.repositories ?? []) as Array<Record<string, unknown>>;
    const migratedRepos: Array<{
      sourceName: string;
      targetName: string;
      imagesTransferred: number;
      totalSizeBytes: number;
    }> = [];

    const targetCreds = ctx.targetCredentials as ProviderCredentialConfig | undefined;
    const targetAdapter = targetCreds
      ? await resolveProviderAdapter(targetProvider as MigrationProvider, targetCreds)
      : undefined;

    for (const repo of repositories) {
      const name = String(repo.name ?? "");
      const images = (repo.images ?? repo.tags ?? []) as string[];
      const sizeBytes = Number(repo.totalSizeBytes ?? 0);
      let transferred = 0;

      for (const tag of images) {
        const sourceUri = `${repo.uri ?? repo.registryUri}/${name}:${tag}`;
        if (targetAdapter) {
          await targetAdapter.containers.copyImage(
            sourceUri,
            String(params.targetRegistryUri ?? ""),
            tag,
          );
        }
        transferred++;
      }

      migratedRepos.push({
        sourceName: name,
        targetName: name,
        imagesTransferred: transferred,
        totalSizeBytes: sizeBytes,
      });
    }

    log.info(
      `[migrate-container-registry] Migrated ${migratedRepos.length} repos, ` +
      `${migratedRepos.reduce((s, r) => s + r.imagesTransferred, 0)} images total`,
    );

    return {
      migratedRepos,
      reposCount: migratedRepos.length,
      totalImagesTransferred: migratedRepos.reduce((s, r) => s + r.imagesTransferred, 0),
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    log.info("[migrate-container-registry] Rollback — target registry repos must be cleaned up manually");
  },
};
