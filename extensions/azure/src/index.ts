/**
 * @espada/azure — Barrel Exports
 *
 * Re-exports all service modules for convenient single-import access.
 */

// Core utilities
export type {
  AzureRegion,
  AzureResourceType,
  AzureRetryOptions,
  AzureOperationResult,
  AzureResource,
  AzureResourceFilter,
  AzureTagSet,
  AzurePagedResult,
  AzurePluginConfig,
} from "./types.js";

export { withAzureRetry, createAzureRetryRunner, shouldRetryAzureError, formatErrorMessage } from "./retry.js";
export { emitAzureDiagnosticEvent, onAzureDiagnosticEvent, instrumentedAzureCall, enableAzureDiagnostics, disableAzureDiagnostics } from "./diagnostics.js";
export { createAzureProgress, withAzureProgress, createMultiStepProgress, waitWithProgress } from "./progress.js";

// Credentials
export { AzureCredentialsManager, createCredentialsManager, createCredentialsManagerFromConfig } from "./credentials/index.js";

// Infrastructure support
export { AzureCLIWrapper, createCLIWrapper } from "./cli/index.js";
export { AzureClientPool } from "./client-pool/index.js";
export { AzureContextManager } from "./context/index.js";
export { AzureServiceDiscovery } from "./discovery/index.js";
export { AzureTaggingManager } from "./tagging/index.js";
export { AzureActivityLogManager } from "./activitylog/index.js";

// Compute
export { AzureVMManager } from "./vms/index.js";
export { AzureFunctionsManager } from "./functions/index.js";
export { AzureContainerManager } from "./containers/index.js";

// Data
export { AzureStorageManager } from "./storage/index.js";
export { AzureSQLManager } from "./sql/index.js";
export { AzureCosmosDBManager } from "./cosmosdb/index.js";
export { AzureRedisManager } from "./redis/index.js";

// Networking
export { AzureNetworkManager } from "./network/index.js";
export { AzureDNSManager } from "./dns/index.js";
export { AzureCDNManager } from "./cdn/index.js";

// Security & Identity
export { AzureKeyVaultManager } from "./keyvault/index.js";
export { AzureIAMManager } from "./iam/index.js";
export { AzureSecurityManager } from "./security/index.js";
export { AzurePolicyManager } from "./policy/index.js";

// Operations
export { AzureMonitorManager } from "./monitor/index.js";
export { AzureCostManager } from "./cost/index.js";
export { AzureBackupManager } from "./backup/index.js";
export { AzureAutomationManager } from "./automation/index.js";

// Messaging
export { AzureServiceBusManager } from "./servicebus/index.js";
export { AzureEventGridManager } from "./eventgrid/index.js";

// AI
export { AzureAIManager } from "./ai/index.js";

// Platform
export { AzureResourceManager } from "./resources/index.js";
export { AzureSubscriptionManager } from "./subscriptions/index.js";
export { AzureLogicAppsManager } from "./logic/index.js";
export { AzureAPIManagementManager } from "./apimanagement/index.js";
export { AzureDevOpsManager, DevOpsPATManager, createPATManager } from "./devops/index.js";
export type {
  DevOpsPATScope,
  PATStorageBackend,
  StoredPAT,
  DecryptedPAT,
  PATSummary,
  PATStatus,
  PATValidationResult,
  PATManagerOptions,
  PATEvent,
  PATEventListener,
} from "./devops/index.js";

// Governance
export { AzureGuardrailsManager } from "./guardrails/index.js";
export { AzureComplianceManager } from "./compliance/index.js";

// Enterprise
export { AzureEnterpriseManager } from "./enterprise/index.js";

// Orchestration (IDIO)
export {
  Orchestrator,
  orchestrate,
  validatePlan,
  topologicalSort,
  flattenLayers,
  registerBuiltinSteps,
  registerBuiltinStepsDryRun,
  BUILTIN_STEP_DEFINITIONS,
  BUILTIN_BLUEPRINTS,
  getBlueprint,
  listBlueprints,
  registerBlueprint,
  registerStepType,
  clearStepRegistry,
  isOutputRef,
  parseOutputRef,
  resolveStepParams,
  evaluateCondition,
} from "./orchestration/index.js";
export type {
  ExecutionPlan,
  PlanStep,
  StepTypeDefinition,
  StepHandler,
  OrchestrationOptions,
  OrchestrationResult,
  OrchestrationEvent,
  Blueprint,
  StepContext,
  StepInstanceId,
  StepTypeId,
} from "./orchestration/index.js";
