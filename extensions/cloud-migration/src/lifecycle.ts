/**
 * Cross-Cloud Migration Engine — Service Lifecycle
 *
 * Registers the extension's service lifecycle (start/stop) via api.registerService().
 * On start: registers all step handlers, initializes audit logger, resets state.
 * On stop: cleans up state.
 */

import type { MigrationStepType } from "./types.js";
import { getPluginState, resetPluginState } from "./state.js";
import { registerStepHandler, transitionJobPhase } from "./core/migration-engine.js";
import { clearIdempotencyRegistry } from "./core/migration-engine.js";
import { getAuditLogger, resetAuditLogger } from "./governance/audit-logger.js";
import { resetProviderRegistry } from "./providers/registry.js";
import { resetApprovalStore } from "./governance/approval-gate-handler.js";
import { resolveExtensions, resetExtensionBridge } from "./integrations/extension-bridge.js";

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

// Reconciliation step handler (Enterprise SLA)
import { reconcileHandler } from "./data/steps/reconcile.js";

// Identity step handlers
import { extractIAMHandler } from "./identity/steps/extract-iam.js";
import { createIAMHandler } from "./identity/steps/create-iam.js";
import { migrateSecretsHandler } from "./identity/steps/migrate-secrets.js";
import { migrateKMSHandler } from "./identity/steps/migrate-kms.js";

// Container step handlers
import { migrateContainersHandler } from "./container/steps/migrate-containers.js";
import { migrateContainerRegistryHandler } from "./container/steps/migrate-container-registry.js";

// Serverless step handlers
import { migrateServerlessHandler } from "./serverless/steps/migrate-serverless.js";
import { migrateAPIGatewayHandler } from "./serverless/steps/migrate-api-gateway.js";

// Infrastructure step handlers (VPC, subnet, route-table, load-balancer)
import { createVPCHandler } from "./network/steps/create-vpc.js";
import { createSubnetHandler } from "./network/steps/create-subnet.js";
import { createRouteTableHandler } from "./network/steps/create-route-table.js";
import { createLoadBalancerHandler } from "./network/steps/create-load-balancer.js";

// Messaging step handlers
import { migrateQueuesHandler } from "./messaging/steps/migrate-queues.js";
import { migrateTopicsHandler } from "./messaging/steps/migrate-topics.js";

// Edge / CDN step handlers
import { migrateCDNHandler } from "./edge/steps/migrate-cdn.js";
import { migrateCertificatesHandler } from "./edge/steps/migrate-certificates.js";
import { migrateWAFHandler } from "./edge/steps/migrate-waf.js";

// NoSQL / Cache step handlers
import { migrateNoSQLHandler } from "./data/steps/migrate-nosql.js";
import { migrateCacheHandler } from "./data/steps/migrate-cache.js";

// Auto scaling step handler
import { migrateAutoScalingHandler } from "./compute/steps/migrate-auto-scaling.js";

// Orchestration step handlers (Step Functions / EventBridge)
import { migrateStepFunctionsHandler } from "./orchestration/steps/migrate-step-functions.js";
import { migrateEventBusHandler } from "./orchestration/steps/migrate-event-bus.js";

// File storage step handler
import { migrateFileSystemHandler } from "./data/steps/migrate-file-system.js";

// Advanced network step handlers
import { migrateTransitGatewayHandler } from "./network/steps/migrate-transit-gateway.js";
import { migrateVPNHandler } from "./network/steps/migrate-vpn.js";
import { migrateVPCEndpointHandler } from "./network/steps/migrate-vpc-endpoint.js";
import { migrateNetworkACLHandler } from "./network/steps/migrate-network-acl.js";
import { migrateListenerRulesHandler } from "./network/steps/migrate-listener-rules.js";

// Parameter store step handler
import { migrateParametersHandler } from "./identity/steps/migrate-parameters.js";

// Advanced identity step handlers
import { migrateIAMUsersHandler } from "./identity/steps/migrate-iam-users.js";
import { migrateIAMGroupsHandler } from "./identity/steps/migrate-iam-groups.js";
import { migrateIdentityProviderHandler } from "./identity/steps/migrate-identity-provider.js";

// Monitoring step handlers
import { migrateLogGroupsHandler } from "./monitoring/steps/migrate-log-groups.js";
import { migrateAlarmsHandler } from "./monitoring/steps/migrate-alarms.js";

// Analytics step handlers
import { migrateDataPipelineHandler } from "./analytics/steps/migrate-data-pipeline.js";
import { migrateStreamHandler } from "./analytics/steps/migrate-stream.js";
import { migrateGraphDatabaseHandler } from "./analytics/steps/migrate-graph-database.js";
import { migrateDataWarehouseHandler } from "./analytics/steps/migrate-data-warehouse.js";

// Bucket policies step handler
import { migrateBucketPoliciesHandler } from "./data/steps/migrate-bucket-policies.js";

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

  // Enterprise SLA pipeline
  { type: "reconcile", handler: reconcileHandler, requiresRollback: false },

  // Identity pipeline
  { type: "extract-iam", handler: extractIAMHandler, requiresRollback: false },
  { type: "create-iam", handler: createIAMHandler, requiresRollback: true },
  { type: "migrate-secrets", handler: migrateSecretsHandler, requiresRollback: true },
  { type: "migrate-kms", handler: migrateKMSHandler, requiresRollback: false },

  // Container pipeline
  { type: "migrate-containers", handler: migrateContainersHandler, requiresRollback: true },
  { type: "migrate-container-registry", handler: migrateContainerRegistryHandler, requiresRollback: false },

  // Serverless pipeline
  { type: "migrate-serverless", handler: migrateServerlessHandler, requiresRollback: true },
  { type: "migrate-api-gateway", handler: migrateAPIGatewayHandler, requiresRollback: true },

  // Infrastructure pipeline (VPC, subnets, routes, LBs)
  { type: "create-vpc", handler: createVPCHandler, requiresRollback: true },
  { type: "create-subnet", handler: createSubnetHandler, requiresRollback: true },
  { type: "create-route-table", handler: createRouteTableHandler, requiresRollback: true },
  { type: "create-load-balancer", handler: createLoadBalancerHandler, requiresRollback: true },

  // Messaging pipeline
  { type: "migrate-queues", handler: migrateQueuesHandler, requiresRollback: true },
  { type: "migrate-topics", handler: migrateTopicsHandler, requiresRollback: true },

  // Edge / CDN pipeline
  { type: "migrate-cdn", handler: migrateCDNHandler, requiresRollback: true },
  { type: "migrate-certificates", handler: migrateCertificatesHandler, requiresRollback: true },
  { type: "migrate-waf", handler: migrateWAFHandler, requiresRollback: true },

  // NoSQL / Cache pipeline
  { type: "migrate-nosql", handler: migrateNoSQLHandler, requiresRollback: false },
  { type: "migrate-cache", handler: migrateCacheHandler, requiresRollback: true },

  // Auto scaling pipeline
  { type: "migrate-auto-scaling", handler: migrateAutoScalingHandler, requiresRollback: true },

  // Orchestration pipeline (Step Functions / EventBridge)
  { type: "migrate-step-functions", handler: migrateStepFunctionsHandler, requiresRollback: true },
  { type: "migrate-event-bus", handler: migrateEventBusHandler, requiresRollback: true },

  // File storage pipeline
  { type: "migrate-file-system", handler: migrateFileSystemHandler, requiresRollback: true },

  // Advanced network pipeline
  { type: "migrate-transit-gateway", handler: migrateTransitGatewayHandler, requiresRollback: true },
  { type: "migrate-vpn-connection", handler: migrateVPNHandler, requiresRollback: true },
  { type: "migrate-vpc-endpoint", handler: migrateVPCEndpointHandler, requiresRollback: true },
  { type: "migrate-network-acl", handler: migrateNetworkACLHandler, requiresRollback: true },
  { type: "migrate-listener-rules", handler: migrateListenerRulesHandler, requiresRollback: true },

  // Parameter store pipeline
  { type: "migrate-parameters", handler: migrateParametersHandler, requiresRollback: true },

  // Advanced identity pipeline
  { type: "migrate-iam-users", handler: migrateIAMUsersHandler, requiresRollback: true },
  { type: "migrate-iam-groups", handler: migrateIAMGroupsHandler, requiresRollback: true },
  { type: "migrate-identity-provider", handler: migrateIdentityProviderHandler, requiresRollback: true },

  // Monitoring pipeline
  { type: "migrate-log-groups", handler: migrateLogGroupsHandler, requiresRollback: true },
  { type: "migrate-alarms", handler: migrateAlarmsHandler, requiresRollback: true },

  // Analytics pipeline
  { type: "migrate-data-pipeline", handler: migrateDataPipelineHandler, requiresRollback: true },
  { type: "migrate-stream", handler: migrateStreamHandler, requiresRollback: true },
  { type: "migrate-graph-database", handler: migrateGraphDatabaseHandler, requiresRollback: true },
  { type: "migrate-data-warehouse", handler: migrateDataWarehouseHandler, requiresRollback: true },

  // Storage policies pipeline
  { type: "migrate-bucket-policies", handler: migrateBucketPoliciesHandler, requiresRollback: false },
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
      clearIdempotencyRegistry();

      // 2. Register all step handlers with the engine
      for (const entry of STEP_HANDLER_REGISTRY) {
        registerStepHandler(entry.type, entry.handler, entry.requiresRollback);
      }

      const state = getPluginState();
      logger.info(
        `[cloud-migration] Registered ${state.stepHandlers.size} step handlers`,
      );

      // 3. Resolve sibling extension bridges (audit-trail, policy-engine, etc.)
      await resolveExtensions(logger);

      // 4. Initialize audit logger
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
        // Transition active jobs to failed so they don't hang in limbo
        for (const job of activeJobs) {
          try {
            transitionJobPhase(job.id, "failed", "system", "Service shutdown — job terminated");
          } catch {
            // Phase transition may not be valid (e.g., already terminal)
          }
        }
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
      clearIdempotencyRegistry();
      resetExtensionBridge();
      resetApprovalStore();

      logger.info("[cloud-migration] Migration engine service stopped");
    },
  });
}
