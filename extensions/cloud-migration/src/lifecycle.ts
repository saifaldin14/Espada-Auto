/**
 * Cross-Cloud Migration Engine — Service Lifecycle
 *
 * Registers the extension's service lifecycle (start/stop) via api.registerService().
 * On start: registers all step handlers, initializes audit logger, resets state.
 * On stop: cleans up state.
 */

import type { MigrationStepType } from "./types.js";
import { getPluginState, resetPluginState } from "./state.js";
import { registerStepHandler } from "./core/migration-engine.js";
import { getAuditLogger, resetAuditLogger } from "./governance/audit-logger.js";
import { resetProviderRegistry } from "./providers/registry.js";

// Compute step handlers
import { snapshotSourceHandler } from "./compute/steps/snapshot-source.js";
import { exportImageHandler } from "./compute/steps/export-image.js";
import { transferImageHandler } from "./compute/steps/transfer-image.js";
import { convertImageHandler } from "./compute/steps/convert-image.js";
import { importImageHandler } from "./compute/steps/import-image.js";
import { provisionVMHandler } from "./compute/steps/provision-vm.js";
import { verifyBootHandler } from "./compute/steps/verify-boot.js";
import { cutoverHandler } from "./compute/steps/cutover.js";
import { remediateBootHandler } from "./compute/steps/remediate-boot.js";
import { decommissionSourceHandler } from "./compute/steps/decommission-source.js";
import { verifyAgentHandler } from "./compute/steps/verify-agent.js";
import { setupStagingHandler } from "./compute/steps/setup-staging.js";

// Governance step handlers
import { approvalGateHandler } from "./governance/approval-gate-handler.js";

// Data step handlers
import { inventorySourceHandler } from "./data/steps/inventory-source.js";
import { createTargetHandler } from "./data/steps/create-target.js";
import { transferObjectsHandler } from "./data/steps/transfer-objects.js";
import { verifyIntegrityHandler } from "./data/steps/verify-integrity.js";
import { syncMetadataHandler } from "./data/steps/sync-metadata.js";

// Database step handlers
import { exportDatabaseHandler } from "./data/steps/export-database.js";
import { transferDatabaseHandler } from "./data/steps/transfer-database.js";
import { importDatabaseHandler } from "./data/steps/import-database.js";
import { verifySchemaHandler } from "./data/steps/verify-schema.js";

// Network step handlers
import { mapNetworkHandler } from "./network/steps/map-network.js";
import { createSecurityRulesHandler } from "./network/steps/create-security-rules.js";
import { migrateDNSHandler } from "./network/steps/migrate-dns.js";
import { verifyConnectivityHandler } from "./network/steps/verify-connectivity.js";

/**
 * All step handlers mapped to their step type.
 * Used during service start to register every handler with the engine.
 */
const STEP_HANDLER_REGISTRY: Array<{
  type: MigrationStepType;
  handler: Parameters<typeof registerStepHandler>[1];
  requiresRollback: boolean;
}> = [
  // Compute pipeline
  { type: "snapshot-source", handler: snapshotSourceHandler, requiresRollback: true },
  { type: "export-image", handler: exportImageHandler, requiresRollback: true },
  { type: "transfer-image", handler: transferImageHandler, requiresRollback: false },
  { type: "convert-image", handler: convertImageHandler, requiresRollback: false },
  { type: "import-image", handler: importImageHandler, requiresRollback: true },
  { type: "provision-vm", handler: provisionVMHandler, requiresRollback: true },
  { type: "verify-boot", handler: verifyBootHandler, requiresRollback: false },
  { type: "cutover", handler: cutoverHandler, requiresRollback: true },
  { type: "remediate-boot", handler: remediateBootHandler, requiresRollback: false },
  { type: "decommission-source", handler: decommissionSourceHandler, requiresRollback: true },

  // On-premises pipeline
  { type: "verify-agent", handler: verifyAgentHandler, requiresRollback: false },
  { type: "setup-staging", handler: setupStagingHandler, requiresRollback: false },

  // Governance pipeline
  { type: "approval-gate", handler: approvalGateHandler, requiresRollback: false },

  // Data pipeline
  { type: "inventory-source", handler: inventorySourceHandler, requiresRollback: false },
  { type: "create-target", handler: createTargetHandler, requiresRollback: true },
  { type: "transfer-objects", handler: transferObjectsHandler, requiresRollback: false },
  { type: "verify-integrity", handler: verifyIntegrityHandler, requiresRollback: false },
  { type: "sync-metadata", handler: syncMetadataHandler, requiresRollback: false },

  // Database pipeline
  { type: "export-database", handler: exportDatabaseHandler, requiresRollback: true },
  { type: "transfer-database", handler: transferDatabaseHandler, requiresRollback: true },
  { type: "import-database", handler: importDatabaseHandler, requiresRollback: true },
  { type: "verify-schema", handler: verifySchemaHandler, requiresRollback: false },

  // Network pipeline
  { type: "map-network", handler: mapNetworkHandler, requiresRollback: false },
  { type: "create-security-rules", handler: createSecurityRulesHandler, requiresRollback: true },
  { type: "migrate-dns", handler: migrateDNSHandler, requiresRollback: true },
  { type: "verify-connectivity", handler: verifyConnectivityHandler, requiresRollback: false },
];

/**
 * Register the service lifecycle with the Espada plugin API.
 *
 * @param api - The Espada plugin API object passed during register(api).
 * @param log - Optional logger (falls back to console).
 */
export function registerLifecycle(
  api: {
    registerService: (svc: { id: string; start: () => Promise<void>; stop: () => Promise<void> }) => void;
  },
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
): void {
  const logger = log ?? { info: console.log, warn: console.warn, error: console.error };

  api.registerService({
    id: "cloud-migration-core",

    async start() {
      logger.info("[cloud-migration] Starting migration engine service");

      // 1. Reset state for a clean start
      resetPluginState();
      resetAuditLogger();
      resetProviderRegistry();

      // 2. Register all step handlers with the engine
      for (const entry of STEP_HANDLER_REGISTRY) {
        registerStepHandler(entry.type, entry.handler, entry.requiresRollback);
      }

      const state = getPluginState();
      logger.info(
        `[cloud-migration] Registered ${state.stepHandlers.size} step handlers`,
      );

      // 3. Initialize audit logger
      const auditLogger = getAuditLogger();
      auditLogger.log({
        jobId: "system",
        action: "execute",
        actor: "system",
        phase: "created",
        stepId: "lifecycle",
        details: {
          event: "service-started",
          handlerCount: state.stepHandlers.size,
          timestamp: new Date().toISOString(),
        },
      });

      logger.info("[cloud-migration] Migration engine service started");
    },

    async stop() {
      logger.info("[cloud-migration] Stopping migration engine service");

      const state = getPluginState();
      const activeJobs = [...state.jobs.values()].filter(
        (j) => j.phase === "executing" || j.phase === "verifying" || j.phase === "cutting-over",
      );

      if (activeJobs.length > 0) {
        logger.warn(
          `[cloud-migration] Stopping with ${activeJobs.length} active job(s): ${activeJobs.map((j) => j.id).join(", ")}`,
        );
      }

      // Log shutdown in audit trail
      const auditLogger = getAuditLogger();
      auditLogger.log({
        jobId: "system",
        action: "execute",
        actor: "system",
        phase: "created",
        stepId: "lifecycle",
        details: {
          event: "service-stopped",
          activeJobCount: activeJobs.length,
          diagnostics: { ...state.diagnostics },
          timestamp: new Date().toISOString(),
        },
      });

      // Reset state
      resetPluginState();
      resetProviderRegistry();

      logger.info("[cloud-migration] Migration engine service stopped");
    },
  });
}
