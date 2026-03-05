/**
 * Compute Pipeline — Types
 *
 * Extended types for compute VM migration.
 */

export { type NormalizedVM, type NormalizedDisk, type ImageFormat, type ImageConversion, IMAGE_FORMAT_MATRIX } from "../types.js";

/** Boot remediation recipe for a target provider. */
export type BootRemediationRecipe = {
  targetProvider: string;
  installPackages: string[];
  removePackages: string[];
  enableServices: string[];
  disableServices: string[];
  kernelModules: string[];
  grubFixes: string[];
  description: string;
};

/** Snapshot metadata returned from source provider. */
export type SnapshotResult = {
  snapshotId: string;
  sourceDiskSizeGB: number;
  sourceChecksum?: string;
  createdAt: string;
};

/** Export result from staging bucket. */
export type ExportResult = {
  exportPath: string;
  exportSizeBytes: number;
  exportChecksum: string;
  format: string;
};

/** VM health check result. */
export type BootVerificationResult = {
  vmId: string;
  reachable: boolean;
  sshReady?: boolean;
  rdpReady?: boolean;
  cloudInitComplete?: boolean;
  services: Array<{ name: string; running: boolean }>;
  elapsedMs: number;
};
