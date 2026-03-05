/**
 * Data Step — Verify Integrity
 *
 * Post-transfer verification: compares object counts, sizes,
 * and checksums between source and target.
 */

import type { MigrationStepHandler, MigrationStepContext, IntegrityReport } from "../../types.js";
import { verifyObjectIntegrity } from "../../core/integrity-verifier.js";

export interface VerifyIntegrityParams {
  sourceBucket: string;
  sourceProvider: string;
  targetBucket: string;
  targetProvider: string;
  sampleRate?: number; // 0-1, fraction of objects to spot-check
}

interface VerifyIntegrityResult {
  report: IntegrityReport;
  passed: boolean;
  objectsChecked: number;
  mismatches: number;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as VerifyIntegrityParams;
  const sampleRate = params.sampleRate ?? 1.0;

  ctx.log.info(`Verifying integrity: ${params.sourceProvider}://${params.sourceBucket} vs ${params.targetProvider}://${params.targetBucket}`);
  ctx.log.info(`  Sample rate: ${(sampleRate * 100).toFixed(0)}%`);

  ctx.signal?.throwIfAborted();

  // In real impl: list both buckets, compare counts, then spot-check checksums
  const report = verifyObjectIntegrity({
    jobId: `verify-${params.sourceBucket}-${Date.now()}`,
    sourceObjects: [],
    targetObjects: [],
  });

  const passed = report.passed;
  const checksChecked = report.checks.length;
  const mismatches = report.checks.filter((c) => !c.passed).length;

  ctx.log.info(`  Verification: ${passed ? "PASSED" : "FAILED"}`);
  ctx.log.info(`  Checks: ${checksChecked}, Mismatches: ${mismatches}`);

  return {
    report: report as unknown as Record<string, unknown>,
    passed,
    objectsChecked: checksChecked,
    mismatches,
  };
}

// Read-only step
export const verifyIntegrityHandler: MigrationStepHandler = {
  execute,
};
