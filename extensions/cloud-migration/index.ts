/**
 * Cross-Cloud Migration Engine — Extension Entry Point
 *
 * Wires lifecycle, tools, gateway, and CLI into the Espada plugin system.
 * Follows the same pattern as AWS/Azure/GCP extensions:
 *   const plugin = { id, name, description, version, configSchema, register(api) { ... } };
 *   export default plugin;
 */

import { registerLifecycle } from "./src/lifecycle.js";
import { registerTools } from "./src/tools.js";
import { registerGateway } from "./src/register-gateway.js";
import { registerCli } from "./src/register-cli.js";
import { initConfig } from "./src/config.js";

// Re-export core modules for cross-extension consumption
export { getPluginState, resetPluginState, getDiagnosticsSnapshot } from "./src/state.js";
export { getJob, listJobs, createMigrationJob, transitionJobPhase } from "./src/core/migration-engine.js";
export { assessMigration, generatePlan } from "./src/core/migration-planner.js";
export { checkCompatibility, checkAllCompatibility, getFullCompatibilityMatrix } from "./src/core/compatibility-matrix.js";
export { estimateMigrationCost, estimateFromResources } from "./src/core/cost-estimator.js";
export { createIntegrityReport } from "./src/core/integrity-verifier.js";
export { evaluatePolicies, getBuiltinPolicies } from "./src/governance/policy-checker.js";
export { getAuditLogger, resetAuditLogger } from "./src/governance/audit-logger.js";
export { MigrationGraphAdapter, getMigrationGraphAdapter, pushDiscoveryToKnowledgeGraph } from "./src/graph/migration-adapter.js";
export { syncPostMigrationToKnowledgeGraph } from "./src/graph/post-migration-sync.js";
export { checkMigrationBudget } from "./src/core/cost-estimator.js";
export { resolveExtensions, getResolvedExtensions, resetExtensionBridge } from "./src/integrations/extension-bridge.js";
export { getConfig, resetConfig, initConfig } from "./src/config.js";
export { scrubCredentials, formatErrors } from "./src/validation.js";

// Re-export key types
export type {
  MigrationProvider,
  MigrationResourceType,
  MigrationDirection,
  MigrationPhase,
  MigrationJob,
  MigrationExecutionPlan,
  MigrationStep,
  MigrationStepType,
  MigrationStepHandler,
  MigrationStepContext,
  MigrationEventListener,
  NormalizedVM,
  NormalizedDisk,
  NormalizedBucket,
  NormalizedSecurityRule,
  NormalizedDNSRecord,
  CompatibilityResult,
  MigrationCostEstimate,
  IntegrityReport,
  TransferManifest,
  CloudMigrationPluginState,
  MigrationDiagnostics,
} from "./src/types.js";

/**
 * Plugin configuration schema — matches espada.plugin.json configSchema.
 */
const configSchema = {
  type: "object" as const,
  properties: {
    maxConcurrency: {
      type: "number",
      description: "Maximum concurrent orchestration steps (default: 4)",
      default: 4,
    },
    transferConcurrency: {
      type: "number",
      description: "Maximum concurrent object transfers (default: 16)",
      default: 16,
    },
    globalTimeoutMs: {
      type: "number",
      description: "Global job timeout in milliseconds (default: 4 hours)",
      default: 14_400_000,
    },
    stepTimeoutMs: {
      type: "number",
      description: "Default per-step timeout in milliseconds (default: 10 minutes)",
      default: 600_000,
    },
    autoRollback: {
      type: "boolean",
      description: "Automatically rollback on step failure (default: true)",
      default: true,
    },
    requireApproval: {
      type: "boolean",
      description: "Require explicit approval before execution (default: true)",
      default: true,
    },
    integrityVerification: {
      type: "boolean",
      description: "Enable SHA-256 integrity verification (default: true)",
      default: true,
    },
  },
};

/**
 * The plugin definition, following the Espada plugin contract.
 */
const plugin = {
  id: "cloud-migration",
  name: "Cross-Cloud Migration Engine",
  description:
    "AI-orchestrated, integrity-verified migration of compute workloads, data, and network configurations across AWS, Azure, GCP, and on-premise environments",
  version: "1.0.0",

  configSchema,

  /**
   * Register all extension capabilities with the Espada plugin API.
   *
   * @param api - The Espada plugin API object (EspadaPluginApi).
   */
  register(api: {
    registerService: (svc: { id: string; start: () => Promise<void>; stop: () => Promise<void> }) => void;
    registerTool: (tool: {
      name: string;
      label: string;
      description: string;
      parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
      execute: (_toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
    }) => void;
    registerGatewayMethod: (
      method: string,
      handler: (opts: {
        params?: unknown;
        respond: (success: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
      }) => Promise<void> | void,
    ) => void;
    registerCli: (handler: (ctx: {
      program: {
        command: (name: string) => {
          description: (d: string) => unknown;
          command: (n: string) => unknown;
          argument: (n: string, d: string) => unknown;
          option: (f: string, d: string) => unknown;
          action: (fn: (...args: unknown[]) => void | Promise<void>) => unknown;
        };
      };
    }) => void) => void;
    getConfig?: () => Record<string, unknown>;
    getLogger?: () => { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  }): void {
    const log = api.getLogger?.() ?? {
      info: console.log,
      warn: console.warn,
      error: console.error,
    };

    log.info("[cloud-migration] Registering extension");

    // 0. Read and validate configuration
    const configWarnings = initConfig(api.getConfig?.());
    for (const w of configWarnings) {
      log.warn(`[cloud-migration] Config: ${w}`);
    }

    // 1. Service lifecycle (start/stop)
    registerLifecycle(api, log);

    // 2. Agent tools (10 tools)
    registerTools(api);

    // 3. Gateway API methods (14 methods)
    registerGateway(api);

    // 4. CLI commands (12 subcommands under `espada migration`)
    registerCli(api);

    log.info("[cloud-migration] Extension registered: 10 tools, 14 gateway methods, 12 CLI commands");
  },
};

export default plugin;
