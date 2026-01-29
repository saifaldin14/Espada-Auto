/**
 * Utility: Which command finder
 *
 * Cross-platform utility to find executables in PATH
 */

import { access, constants } from "node:fs/promises";
import { join } from "node:path";

/**
 * Find an executable in PATH
 */
export async function which(command: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  const pathSeparator = process.platform === "win32" ? ";" : ":";
  const paths = pathEnv.split(pathSeparator);
  
  // On Windows, also check common extensions
  const extensions = process.platform === "win32"
    ? ["", ".exe", ".cmd", ".bat", ".com"]
    : [""];

  for (const dir of paths) {
    for (const ext of extensions) {
      const fullPath = join(dir, command + ext);
      try {
        await access(fullPath, constants.X_OK);
        return fullPath;
      } catch {
        // File not found or not executable, continue
      }
    }
  }

  return null;
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  const path = await which(command);
  return path !== null;
}
