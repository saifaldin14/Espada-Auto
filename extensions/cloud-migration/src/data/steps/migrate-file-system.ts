/**
 * Data Step — Migrate File System
 *
 * Migrates shared file systems to the target provider
 * (EFS → Azure Files / GCP Filestore).
 * Handles:
 *   - Target file system creation
 *   - Mount target provisioning
 *   - File synchronization
 *   - Tag migration
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Performance mode mapping across providers. */
const PERFORMANCE_MODE_MAP: Record<string, Record<string, string>> = {
  azure: {
    generalPurpose: "Transaction",
    maxIO: "Transaction", // No direct equivalent — warning emitted
  },
  gcp: {
    generalPurpose: "BASIC_HDD",
    maxIO: "BASIC_SSD", // Approximate — no direct equivalent
  },
};

/** Throughput mode mapping. */
const THROUGHPUT_MODE_MAP: Record<string, Record<string, string>> = {
  azure: {
    bursting: "bursting",
    provisioned: "provisioned",
    elastic: "provisioned",
  },
  gcp: {
    bursting: "STANDARD",
    provisioned: "PREMIUM",
    elastic: "PREMIUM",
  },
};

export const migrateFileSystemHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-file-system] Migrating file systems → ${targetProvider}`);

    const fileSystems = (params.fileSystems ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      sizeGB: number;
      throughputMode: string;
      performanceMode: string;
      encrypted: boolean;
      mountTargets: Array<{ subnetId: string; securityGroups?: string[] }>;
      accessPoints: Array<{ path: string; posixUser?: Record<string, unknown> }>;
      region: string;
      tags?: Record<string, string>;
    }>;

    const migratedFileSystems: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetType: string;
      sizeGB: number;
      mountTargetsCreated: number;
      filesSynced: boolean;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          fileStorage?: {
            createFileSystem: (fs: unknown) => Promise<{ id: string }>;
            createMountTargets: (fsId: string, targets: unknown[]) => Promise<{ count: number }>;
            syncFiles: (sourceId: string, targetId: string) => Promise<{ objectCount: number }>;
            deleteFileSystem: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const fs of fileSystems) {
      const name = String(fs.name ?? "");
      const performanceMode = String(fs.performanceMode ?? "generalPurpose");
      const throughputMode = String(fs.throughputMode ?? "bursting");
      const targetPerformance = translatePerformanceMode(performanceMode, targetProvider);
      const targetThroughput = translateThroughputMode(throughputMode, targetProvider);

      if (performanceMode === "maxIO") {
        warnings.push(
          `File system "${name}": "maxIO" performance mode has no direct equivalent in ${targetProvider}; ` +
            `mapped to "${targetPerformance}" — verify performance requirements`,
        );
      }

      if (fs.accessPoints && fs.accessPoints.length > 0) {
        warnings.push(
          `File system "${name}": ${fs.accessPoints.length} access point(s) need manual re-mapping on ${targetProvider}`,
        );
      }

      if (targetAdapter?.fileStorage) {
        const result = await targetAdapter.fileStorage.createFileSystem({
          name,
          type: fs.type,
          sizeGB: fs.sizeGB,
          performanceMode: targetPerformance,
          throughputMode: targetThroughput,
          encrypted: fs.encrypted,
          region: fs.region,
          tags: fs.tags,
        });

        const mountResult = await targetAdapter.fileStorage.createMountTargets(
          result.id,
          fs.mountTargets ?? [],
        );

        const syncResult = await targetAdapter.fileStorage.syncFiles(fs.id, result.id);

        migratedFileSystems.push({
          sourceId: fs.id,
          sourceName: name,
          targetId: result.id,
          targetType: targetPerformance,
          sizeGB: fs.sizeGB,
          mountTargetsCreated: mountResult.count,
          filesSynced: true,
        });

        log.info(
          `[migrate-file-system] "${name}": created target FS ${result.id}, ` +
            `${mountResult.count} mount target(s), ${syncResult.objectCount} files synced`,
        );
      } else {
        migratedFileSystems.push({
          sourceId: fs.id,
          sourceName: name,
          targetId: `simulated-fs-${name}`,
          targetType: targetPerformance,
          sizeGB: fs.sizeGB,
          mountTargetsCreated: fs.mountTargets?.length ?? 0,
          filesSynced: false,
        });
      }
    }

    log.info(`[migrate-file-system] Migrated ${migratedFileSystems.length} file system(s)`);

    return {
      migratedFileSystems,
      fileSystemsCount: migratedFileSystems.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedFileSystems = (outputs.migratedFileSystems ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-file-system] Rolling back ${migratedFileSystems.length} file system(s)`);

    const targetAdapter = ctx.targetCredentials as
      | { fileStorage?: { deleteFileSystem: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.fileStorage) {
      for (const fs of migratedFileSystems) {
        await targetAdapter.fileStorage.deleteFileSystem(fs.targetId);
      }
    }

    log.info("[migrate-file-system] Rollback complete");
  },
};

function translatePerformanceMode(mode: string, targetProvider: string): string {
  const map = PERFORMANCE_MODE_MAP[targetProvider];
  if (!map) return mode;
  return map[mode] ?? mode;
}

function translateThroughputMode(mode: string, targetProvider: string): string {
  const map = THROUGHPUT_MODE_MAP[targetProvider];
  if (!map) return mode;
  return map[mode] ?? mode;
}
