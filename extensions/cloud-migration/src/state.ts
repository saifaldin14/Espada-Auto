/**
 * Cross-Cloud Migration Engine — Shared Plugin State
 *
 * Follows the PluginState pattern from cloud extensions.
 * Provides a mutable singleton for the extension lifetime.
 */

import {
  type CloudMigrationPluginState,
  type MigrationDiagnostics,
  createInitialPluginState,
  createEmptyDiagnostics,
} from "./types.js";

let state: CloudMigrationPluginState = createInitialPluginState();

/** Get the current shared plugin state. */
export function getPluginState(): CloudMigrationPluginState {
  return state;
}

/** Reset state — used during tests and service restart. */
export function resetPluginState(): void {
  state = createInitialPluginState();
}

/** Reset only diagnostics counters. */
export function resetDiagnostics(): void {
  state.diagnostics = createEmptyDiagnostics();
}

/** Get a read-only snapshot of diagnostics. */
export function getDiagnosticsSnapshot(): Readonly<MigrationDiagnostics> {
  return { ...state.diagnostics };
}
