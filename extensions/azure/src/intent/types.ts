/**
 * Azure Intent System — Type Definitions
 *
 * Declarative intent specification for Azure infrastructure.
 * Users describe what they want; the compiler turns it into an ExecutionPlan.
 */

// =============================================================================
// Application Intent (Declarative Specification)
// =============================================================================

/** The top-level declarative specification of desired infrastructure. */
export type ApplicationIntent = {
  /** Human-readable name for this application. */
  name: string;
  /** Description of the application's purpose. */
  description?: string;
  /** Application tiers (e.g. web, api, data, worker). */
  tiers: ApplicationTierIntent[];
  /** Target environment. */
  environment: IntentEnvironment;
  /** Target Azure region. */
  region: string;
  /** Availability requirements. */
  availability?: AvailabilityRequirement;
  /** Cost constraints. */
  cost?: CostConstraint;
  /** Compliance frameworks to follow. */
  compliance?: ComplianceFramework[];
  /** Security requirements. */
  security?: SecurityRequirement;
  /** Disaster recovery requirements. */
  disasterRecovery?: DisasterRecoveryRequirement;
  /** Tags to apply to all resources. */
  tags?: Record<string, string>;
};

/** A single tier of the application (e.g. frontend, backend, database). */
export type ApplicationTierIntent = {
  /** Tier name. */
  name: string;
  /** Tier type. */
  type: "web" | "api" | "worker" | "data" | "cache" | "queue" | "storage" | "ai";
  /** Compute configuration. */
  compute?: ComputeIntent;
  /** Data store configuration. */
  dataStore?: DataStoreIntent;
  /** Networking requirements. */
  networking?: NetworkingIntent;
  /** Dependencies on other tiers. */
  dependsOn?: string[];
  /** Scaling configuration. */
  scaling?: ScalingIntent;
};

export type IntentEnvironment = "development" | "staging" | "production" | "testing";

export type AvailabilityRequirement = {
  /** Target SLA (e.g. "99.9%", "99.99%"). */
  sla?: string;
  /** Whether zone redundancy is required. */
  zoneRedundant?: boolean;
  /** Whether geo-replication is needed. */
  geoReplication?: boolean;
};

export type CostConstraint = {
  /** Maximum monthly budget in USD. */
  maxMonthlyCostUsd?: number;
  /** Cost optimization priority. */
  priority?: "minimize" | "balanced" | "performance";
};

export type ComplianceFramework = "hipaa" | "pci-dss" | "gdpr" | "soc2" | "iso27001" | "fedramp";

export type SecurityRequirement = {
  /** Whether to enable encryption at rest. */
  encryptionAtRest?: boolean;
  /** Whether to enable encryption in transit. */
  encryptionInTransit?: boolean;
  /** Whether to use private endpoints. */
  privateEndpoints?: boolean;
  /** Whether to enable managed identity. */
  managedIdentity?: boolean;
  /** IP restrictions. */
  ipRestrictions?: string[];
  /** Enable WAF. */
  waf?: boolean;
};

export type DisasterRecoveryRequirement = {
  /** Recovery Time Objective in minutes. */
  rtoMinutes?: number;
  /** Recovery Point Objective in minutes. */
  rpoMinutes?: number;
  /** Secondary region for DR. */
  secondaryRegion?: string;
};

export type ComputeIntent = {
  /** Runtime platform. */
  platform: "app-service" | "container-app" | "functions" | "vm" | "aks" | "spring-apps";
  /** Runtime stack (e.g. "node18", "dotnet8", "python3.12"). */
  runtime?: string;
  /** Instance size tier. */
  size?: "small" | "medium" | "large" | "xlarge";
  /** Number of instances. */
  instanceCount?: number;
  /** Expected requests per second. */
  expectedRps?: number;
};

export type DataStoreIntent = {
  /** Database engine. */
  engine: "sql-server" | "postgresql" | "mysql" | "cosmosdb" | "redis" | "storage-blob" | "storage-table";
  /** Storage size in GB. */
  sizeGb?: number;
  /** Performance tier. */
  tier?: "basic" | "standard" | "premium";
  /** Whether backups are required. */
  backups?: boolean;
  /** Backup retention in days. */
  backupRetentionDays?: number;
};

export type NetworkingIntent = {
  /** Whether to create a dedicated VNet. */
  vnet?: boolean;
  /** Whether to expose publicly. */
  publicAccess?: boolean;
  /** Custom domain. */
  customDomain?: string;
  /** Whether to enable CDN. */
  cdn?: boolean;
  /** Whether to enable SSL/TLS. */
  ssl?: boolean;
};

export type ScalingIntent = {
  /** Minimum instances. */
  minInstances?: number;
  /** Maximum instances. */
  maxInstances?: number;
  /** CPU threshold for scale-out (percentage). */
  cpuThreshold?: number;
  /** Memory threshold for scale-out (percentage). */
  memoryThreshold?: number;
};

// =============================================================================
// Infrastructure Plan (Compiled Output)
// =============================================================================

/** A compiled infrastructure plan ready for execution. */
export type InfrastructurePlan = {
  /** Unique plan ID. */
  id: string;
  /** The original intent this was compiled from. */
  intent: ApplicationIntent;
  /** Planned Azure resources. */
  resources: PlannedResource[];
  /** Estimated monthly cost in USD. */
  estimatedMonthlyCostUsd: number;
  /** Cost breakdown by resource. */
  costBreakdown: CostBreakdownItem[];
  /** Policy validation results. */
  policyValidation: PolicyValidationResult;
  /** Guardrail check results. */
  guardrailChecks: GuardrailCheckResult[];
  /** Generated IaC (if requested). */
  generatedIaC?: GeneratedIaC;
  /** Execution order (layers of parallel resource groups). */
  executionOrder: string[][];
  /** Rollback plan. */
  rollbackPlan: RollbackPlan;
  /** Timestamp. */
  createdAt: string;
};

/** A resource that will be created. */
export type PlannedResource = {
  /** Unique resource ID within the plan. */
  id: string;
  /** Azure resource type (ARM). */
  type: string;
  /** Resource name. */
  name: string;
  /** Azure region. */
  region: string;
  /** Resource group. */
  resourceGroup: string;
  /** Configuration properties. */
  properties: Record<string, unknown>;
  /** Dependencies on other planned resources. */
  dependsOn: string[];
  /** Tier this resource belongs to. */
  tier: string;
  /** Estimated monthly cost. */
  estimatedMonthlyCostUsd: number;
  /** Tags. */
  tags: Record<string, string>;
};

export type CostBreakdownItem = {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  monthlyCostUsd: number;
  pricingTier: string;
};

export type PolicyValidationResult = {
  passed: boolean;
  violations: PolicyViolation[];
  warnings: string[];
};

export type PolicyViolation = {
  policyId: string;
  policyName: string;
  resourceId: string;
  severity: "high" | "medium" | "low";
  message: string;
  remediation?: string;
};

export type GuardrailCheckResult = {
  checkName: string;
  passed: boolean;
  message: string;
  category: "security" | "cost" | "compliance" | "naming" | "tagging";
};

export type GeneratedIaC = {
  format: "terraform" | "bicep" | "arm";
  files: Record<string, string>;
};

export type RollbackPlan = {
  steps: RollbackStep[];
  estimatedDurationMs: number;
};

export type RollbackStep = {
  resourceId: string;
  action: "delete" | "restore" | "reconfigure";
  order: number;
};

// =============================================================================
// Intent Execution
// =============================================================================

/** Result from executing a compiled plan. */
export type IntentExecutionResult = {
  /** Plan ID. */
  planId: string;
  /** Execution status. */
  status: "succeeded" | "failed" | "partial" | "rolled-back";
  /** Provisioned resources. */
  provisionedResources: ProvisionedResource[];
  /** Errors encountered. */
  errors: ExecutionError[];
  /** Actual cost incurred (if available). */
  actualCostUsd?: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Timestamp. */
  completedAt: string;
};

export type ProvisionedResource = {
  /** Planned resource ID. */
  planResourceId: string;
  /** Actual Azure resource ID (ARM). */
  azureResourceId: string;
  /** Resource type. */
  type: string;
  /** Resource name. */
  name: string;
  /** Provisioning state. */
  provisioningState: string;
  /** Endpoints/URLs. */
  endpoints?: Record<string, string>;
};

export type ExecutionError = {
  resourceId: string;
  phase: "create" | "configure" | "validate" | "rollback";
  message: string;
  code?: string;
  retryable: boolean;
};

// =============================================================================
// Compiler Configuration
// =============================================================================

export type IntentCompilerConfig = {
  /** Default Azure region. */
  defaultRegion: string;
  /** Default resource group naming pattern. */
  resourceGroupPattern?: string;
  /** Default tags to apply. */
  defaultTags?: Record<string, string>;
  /** Whether to generate IaC alongside the plan. */
  generateIaC?: boolean;
  /** IaC format preference. */
  iacFormat?: "terraform" | "bicep" | "arm";
  /** Cost estimation enabled. */
  enableCostEstimation?: boolean;
  /** Policy validation enabled. */
  enablePolicyValidation?: boolean;
};
