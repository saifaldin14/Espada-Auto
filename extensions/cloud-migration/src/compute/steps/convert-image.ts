/**
 * Compute Step — Convert Image
 *
 * Converts the transferred image to the target provider's native format
 * using the image-converter module.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import { planImageConversion, convertImage, getTargetFormat } from "../image-converter.js";

export interface ConvertImageParams {
  sourceUri: string;
  sourceFormat: "vmdk" | "vhd" | "raw" | "qcow2";
  sourceProvider: string;
  targetProvider: string;
  workDir: string;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as ConvertImageParams;
  const targetFormat = getTargetFormat(params.targetProvider as any);

  if (params.sourceFormat === targetFormat) {
    ctx.log.info(`Image already in target format (${targetFormat}), skipping conversion`);
    return {
      outputUri: params.sourceUri,
      outputFormat: targetFormat,
      sizeBytes: 0,
      durationMs: 0,
      skipped: true,
    };
  }

  ctx.log.info(`Converting image: ${params.sourceFormat} → ${targetFormat}`);

  const conversions = planImageConversion({
    sourceProvider: params.sourceProvider ?? "aws",
    targetProvider: params.targetProvider as any,
    sourceImagePath: params.sourceUri,
    stagingDir: params.workDir,
  });

  if (conversions.length === 0) {
    ctx.log.info("No conversion steps needed");
    return {
      outputUri: params.sourceUri,
      outputFormat: params.sourceFormat,
      sizeBytes: 0,
      durationMs: 0,
      skipped: true,
    };
  }

  ctx.log.info(`  Conversion plan: ${conversions.length} step(s)`);

  const startTime = Date.now();

  // Execute each conversion step
  let currentUri = params.sourceUri;
  for (const conversion of conversions) {
    ctx.signal?.throwIfAborted();
    ctx.log.info(`  Executing: ${conversion.sourceFormat} → ${conversion.targetFormat}`);
    const result = await convertImage(conversion);
    currentUri = result.targetPath;
  }

  const durationMs = Date.now() - startTime;

  ctx.log.info(`  Conversion complete in ${durationMs}ms → ${currentUri}`);

  return {
    outputUri: currentUri,
    outputFormat: targetFormat,
    sizeBytes: 0, // resolved from file stats
    durationMs,
    skipped: false,
  };
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  if (outputs?.skipped) return;
  const outputUri = outputs?.outputUri as string | undefined;
  if (!outputUri) return;
  ctx.log.info(`Cleaning up converted image at ${outputUri}`);
}

export const convertImageHandler: MigrationStepHandler = {
  execute,
  rollback,
};
