/**
 * Compute Pipeline — Image Converter
 *
 * Converts disk images between formats using qemu-img.
 * Operates in Espada's Docker sandbox for isolation.
 *
 * Supported conversions: AMI↔VHD↔VMDK↔RAW↔QCOW2
 */

import type { ImageFormat, ImageConversion } from "../types.js";
import { sha256 } from "../core/integrity-verifier.js";

// =============================================================================
// Format Extension Mapping
// =============================================================================

const FORMAT_EXTENSIONS: Record<ImageFormat, string> = {
  raw: ".raw",
  vhd: ".vhd",
  vhdx: ".vhdx",
  vmdk: ".vmdk",
  qcow2: ".qcow2",
  ami: ".raw", // AMI exported as raw
};

// =============================================================================
// Conversion Commands
// =============================================================================

/**
 * Generate the qemu-img convert command for a format conversion.
 * Intended to run inside a sandboxed Docker container.
 */
export function buildConversionCommand(conversion: ImageConversion): string {
  const { sourceFormat, targetFormat, sourcePath, targetPath } = conversion;

  // qemu-img uses specific format names
  const qemuFormats: Record<ImageFormat, string> = {
    raw: "raw",
    vhd: "vpc",      // qemu-img calls VHD "vpc"
    vhdx: "vhdx",
    vmdk: "vmdk",
    qcow2: "qcow2",
    ami: "raw",       // AMI exports are raw
  };

  const srcFmt = qemuFormats[sourceFormat];
  const tgtFmt = qemuFormats[targetFormat];

  return `qemu-img convert -f ${srcFmt} -O ${tgtFmt} -p "${sourcePath}" "${targetPath}"`;
}

/**
 * Determine the target image format for a given target provider.
 */
export function getTargetFormat(targetProvider: string): ImageFormat {
  switch (targetProvider) {
    case "aws":
      return "raw";
    case "azure":
      return "vhd";
    case "gcp":
      return "raw";
    case "on-premises":
    case "vmware":
      return "vmdk";
    case "nutanix":
      return "qcow2";
    default:
      return "raw";
  }
}

/**
 * Determine the intermediate format when exporting from a source provider.
 */
export function getIntermediateFormat(sourceProvider: string): ImageFormat {
  // All providers export to RAW as the intermediate format
  return "raw";
}

/**
 * Get the file extension for a format.
 */
export function getFormatExtension(format: ImageFormat): string {
  return FORMAT_EXTENSIONS[format];
}

/**
 * Check if a format conversion is needed.
 */
export function needsConversion(sourceFormat: ImageFormat, targetFormat: ImageFormat): boolean {
  return sourceFormat !== targetFormat;
}

/**
 * Create a conversion plan for migrating an image between providers.
 */
export function planImageConversion(params: {
  sourceProvider: string;
  targetProvider: string;
  sourceImagePath: string;
  stagingDir: string;
}): ImageConversion[] {
  const { sourceProvider, targetProvider, sourceImagePath, stagingDir } = params;
  const conversions: ImageConversion[] = [];

  const intermediateFormat = getIntermediateFormat(sourceProvider);
  const targetFormat = getTargetFormat(targetProvider);

  // If source is already in target format, no conversion needed
  if (intermediateFormat === targetFormat) {
    return conversions;
  }

  // Single conversion: intermediate → target
  conversions.push({
    sourceFormat: intermediateFormat,
    targetFormat,
    sourcePath: sourceImagePath,
    targetPath: `${stagingDir}/converted${getFormatExtension(targetFormat)}`,
  });

  return conversions;
}

/**
 * Validate that a conversion path is supported.
 */
export function isConversionSupported(from: ImageFormat, to: ImageFormat): boolean {
  // qemu-img supports all conversions between these formats
  const SUPPORTED: ImageFormat[] = ["raw", "vhd", "vhdx", "vmdk", "qcow2"];
  return SUPPORTED.includes(from) && SUPPORTED.includes(to);
}

/**
 * Simulate image conversion for testing.
 * In production, this would execute qemu-img in a sandbox.
 */
export async function convertImage(
  conversion: ImageConversion,
  onProgress?: (percent: number) => void,
): Promise<{ targetPath: string; targetChecksum: string; durationMs: number }> {
  const startMs = Date.now();

  // In real implementation, this would:
  // 1. Validate source file exists
  // 2. Run qemu-img in Docker sandbox
  // 3. Compute checksums before/after
  // 4. Verify output

  // Simulate progress
  if (onProgress) {
    for (let i = 0; i <= 100; i += 25) {
      onProgress(i);
    }
  }

  const targetChecksum = sha256(Buffer.from(`converted:${conversion.sourcePath}:${conversion.targetFormat}`));
  const durationMs = Date.now() - startMs;

  return {
    targetPath: conversion.targetPath,
    targetChecksum,
    durationMs,
  };
}
