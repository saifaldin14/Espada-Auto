/**
 * Intent-Driven Infrastructure Orchestration (IDIO) Types
 * 
 * Declarative infrastructure intent specifications that describe
 * business requirements rather than implementation details.
 */

export type ComplianceFramework = 
  | 'hipaa'
  | 'soc2'
  | 'pci-dss'
  | 'gdpr'
  | 'iso27001'
  | 'fedramp'
  | 'none';

export type ApplicationTier = 
  | 'web'
  | 'api'
  | 'database'
  | 'cache'
  | 'queue'
  | 'storage'
  | 'analytics';

export type TrafficPattern = 
  | 'steady'
  | 'burst'
  | 'predictable-daily'
  | 'predictable-weekly'
  | 'seasonal'
  | 'unpredictable';

export type Environment = 
  | 'development'
  | 'staging'
  | 'production'
  | 'disaster-recovery';

export type AvailabilityRequirement = 
  | '99.9'   // Three nines
  | '99.95'  // Three and a half nines
  | '99.99'  // Four nines
  | '99.999' // Five nines
  | 'best-effort';

export interface CostConstraint {
  /** Maximum monthly budget in USD */
  monthlyBudgetUsd: number;
  /** Prioritize cost optimization over performance */
  prioritizeCost?: boolean;
  /** Alert threshold (percentage of budget) */
  alertThreshold?: number;
  /** Maximum hourly spend rate in USD */
  maxHourlyRate?: number;
  /** Reserved instance strategy */
  reservationStrategy?: 'none' | 'conservative' | 'aggressive';
}

export interface DisasterRecoveryRequirement {
  /** Recovery Time Objective in minutes */
  rtoMinutes: number;
  /** Recovery Point Objective in minutes */
  rpoMinutes: number;
  /** Enable cross-region replication */
  crossRegionReplication: boolean;
  /** Backup retention in days */
  backupRetentionDays: number;
  /** Automated failover enabled */
  automaticFailover?: boolean;
  /** DR testing frequency */
  testingFrequency?: 'weekly' | 'monthly' | 'quarterly';
}

export interface ScalingRequirement {
  /** Minimum capacity */
  min: number;
  /** Maximum capacity */
  max: number;
  /** Target CPU utilization percentage */
  targetCpuUtilization?: number;
  /** Target request count per target */
  targetRequestCount?: number;
  /** Scale-up cooldown in seconds */
  scaleUpCooldown?: number;
  /** Scale-down cooldown in seconds */
  scaleDownCooldown?: number;
  /** Scaling strategy */
  strategy?: 'reactive' | 'predictive' | 'scheduled';
}

export interface SecurityRequirement {
  /** Encryption at rest required */
  encryptionAtRest: boolean;
  /** Encryption in transit required */
  encryptionInTransit: boolean;
  /** Network isolation level */
  networkIsolation: 'none' | 'private-subnet' | 'vpc-isolated' | 'airgapped';
  /** MFA required for admin access */
  mfaRequired?: boolean;
  /** Allowed ingress CIDR blocks */
  allowedIngressCidrs?: string[];
  /** WAF protection enabled */
  wafEnabled?: boolean;
  /** DDoS protection enabled */
  ddosProtectionEnabled?: boolean;
  /** Secret rotation enabled */
  secretRotationEnabled?: boolean;
}

export interface ApplicationIntent {
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** Application tiers to provision */
  tiers: ApplicationTierIntent[];
  /** Target environment */
  environment: Environment;
  /** Availability requirement */
  availability: AvailabilityRequirement;
  /** Cost constraints */
  cost: CostConstraint;
  /** Compliance requirements */
  compliance: ComplianceFramework[];
  /** Security requirements */
  security: SecurityRequirement;
  /** Disaster recovery requirements */
  disasterRecovery?: DisasterRecoveryRequirement;
  /** Tags to apply to all resources */
  tags?: Record<string, string>;
  /** Primary AWS region */
  primaryRegion: string;
  /** Additional regions for multi-region deployment */
  additionalRegions?: string[];
}

export interface ApplicationTierIntent {
  /** Tier type */
  type: ApplicationTier;
  /** Expected traffic pattern */
  trafficPattern: TrafficPattern;
  /** Expected requests per second */
  expectedRps?: number;
  /** Data size estimate in GB */
  dataSizeGb?: number;
  /** Scaling requirements */
  scaling?: ScalingRequirement;
  /** Runtime configuration */
  runtime?: RuntimeConfiguration;
  /** Dependencies on other tiers */
  dependsOn?: string[];
  /** Custom configuration */
  customConfig?: Record<string, unknown>;
}

export interface RuntimeConfiguration {
  /** Programming language/runtime */
  language?: 'nodejs' | 'python' | 'java' | 'go' | 'dotnet' | 'ruby';
  /** Runtime version */
  version?: string;
  /** Container image (if containerized) */
  containerImage?: string;
  /** Entry point */
  entryPoint?: string;
  /** Environment variables */
  environmentVariables?: Record<string, string>;
  /** Health check path */
  healthCheckPath?: string;
  /** Startup time in seconds */
  startupTimeSeconds?: number;
}

export interface InfrastructurePlan {
  /** Unique plan identifier */
  id: string;
  /** Source intent */
  intent: ApplicationIntent;
  /** Generated resources */
  resources: PlannedResource[];
  /** Estimated monthly cost in USD */
  estimatedMonthlyCostUsd: number;
  /** Cost breakdown by service */
  costBreakdown: CostBreakdownItem[];
  /** Policy validation results */
  policyValidation: PolicyValidationResult;
  /** Guardrail checks */
  guardrailChecks: GuardrailCheckResult[];
  /** Generated IaC code */
  iacCode?: GeneratedIaC;
  /** Execution order */
  executionOrder: string[][];
  /** Rollback plan */
  rollbackPlan?: RollbackPlan;
  /** Created timestamp */
  createdAt: string;
}

export interface PlannedResource {
  /** Unique resource identifier */
  id: string;
  /** Resource type (e.g., 'ec2_instance', 'rds_instance') */
  type: string;
  /** AWS service name */
  service: string;
  /** Resource properties */
  properties: Record<string, unknown>;
  /** Dependencies on other resources */
  dependencies: string[];
  /** Estimated monthly cost */
  estimatedCostUsd: number;
  /** Region */
  region: string;
  /** Tags */
  tags: Record<string, string>;
  /** Justification for this resource choice */
  rationale?: string;
}

export interface CostBreakdownItem {
  /** Service name */
  service: string;
  /** Resource type */
  resourceType: string;
  /** Estimated monthly cost */
  monthlyCostUsd: number;
  /** Cost drivers */
  drivers: string[];
  /** Optimization suggestions */
  optimizations?: string[];
}

export interface PolicyValidationResult {
  /** Overall validation status */
  passed: boolean;
  /** Policy violations */
  violations: PolicyViolation[];
  /** Warnings */
  warnings: PolicyWarning[];
  /** Policies evaluated */
  policiesEvaluated: string[];
}

export interface PolicyViolation {
  /** Severity level */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Policy name */
  policy: string;
  /** Resource affected */
  resourceId: string;
  /** Violation message */
  message: string;
  /** Remediation suggestion */
  remediation?: string;
  /** Can auto-fix */
  autoFixable: boolean;
}

export interface PolicyWarning {
  /** Warning message */
  message: string;
  /** Resource affected */
  resourceId?: string;
  /** Best practice recommendation */
  recommendation?: string;
}

export interface GuardrailCheckResult {
  /** Check name */
  check: string;
  /** Check passed */
  passed: boolean;
  /** Message */
  message: string;
  /** Required approval level */
  approvalLevel?: 'none' | 'team-lead' | 'architect' | 'security-team';
}

export interface GeneratedIaC {
  /** Terraform HCL code */
  terraform?: string;
  /** CloudFormation YAML */
  cloudformation?: string;
  /** CDK TypeScript code */
  cdk?: string;
}

export interface RollbackPlan {
  /** Rollback steps */
  steps: RollbackStep[];
  /** Backup identifiers */
  backupIds: string[];
  /** Estimated rollback time in minutes */
  estimatedTimeMinutes: number;
}

export interface RollbackStep {
  /** Step order */
  order: number;
  /** Action to perform */
  action: string;
  /** Resources affected */
  resourceIds: string[];
  /** Command to execute */
  command?: string;
}

export interface IntentExecutionResult {
  /** Execution ID */
  executionId: string;
  /** Plan that was executed */
  planId: string;
  /** Execution status */
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'rolled-back';
  /** Provisioned resources */
  provisionedResources: ProvisionedResource[];
  /** Execution errors */
  errors: ExecutionError[];
  /** Start time */
  startedAt: string;
  /** Completion time */
  completedAt?: string;
  /** Actual monthly cost (after deployment) */
  actualMonthlyCostUsd?: number;
  /** Rollback triggered */
  rollbackTriggered: boolean;
}

export interface ProvisionedResource {
  /** Planned resource ID */
  plannedId: string;
  /** AWS resource ID/ARN */
  awsId: string;
  /** Resource type */
  type: string;
  /** Provisioning status */
  status: 'creating' | 'available' | 'failed';
  /** Region */
  region: string;
  /** Endpoints/URLs */
  endpoints?: string[];
}

export interface ExecutionError {
  /** Error phase */
  phase: 'validation' | 'provisioning' | 'configuration' | 'verification';
  /** Resource that failed */
  resourceId?: string;
  /** Error message */
  message: string;
  /** Error code */
  code?: string;
  /** Timestamp */
  timestamp: string;
}

export interface IntentTemplate {
  /** Template identifier */
  id: string;
  /** Template name */
  name: string;
  /** Description */
  description: string;
  /** Category */
  category: 'web-application' | 'data-pipeline' | 'microservices' | 'machine-learning' | 'iot' | 'custom';
  /** Template version */
  version: string;
  /** Base intent structure */
  intentTemplate: Partial<ApplicationIntent>;
  /** Required parameters */
  requiredParameters: TemplateParameter[];
  /** Optional parameters */
  optionalParameters: TemplateParameter[];
  /** Example configurations */
  examples?: IntentTemplateExample[];
  /** Estimated cost range */
  costRangeUsd: [number, number];
  /** Tags */
  tags: string[];
}

export interface TemplateParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Description */
  description: string;
  /** Default value */
  defaultValue?: unknown;
  /** Validation rules */
  validation?: ParameterValidation;
}

export interface ParameterValidation {
  /** Minimum value (numbers) */
  min?: number;
  /** Maximum value (numbers) */
  max?: number;
  /** Pattern (strings) */
  pattern?: string;
  /** Allowed values (enums) */
  allowedValues?: unknown[];
  /** Required flag */
  required?: boolean;
}

export interface IntentTemplateExample {
  /** Example name */
  name: string;
  /** Description */
  description: string;
  /** Parameter values */
  parameters: Record<string, unknown>;
  /** Estimated monthly cost */
  estimatedCostUsd: number;
}

export interface ReconciliationResult {
  /** Reconciliation ID */
  id: string;
  /** Plan being reconciled */
  planId: string;
  /** Execution being monitored */
  executionId: string;
  /** Timestamp */
  timestamp: string;
  /** Drift detected */
  driftDetected: boolean;
  /** Drift details */
  drifts: ResourceDrift[];
  /** Compliance violations detected */
  complianceViolations: PolicyViolation[];
  /** Cost anomalies detected */
  costAnomalies: CostAnomaly[];
  /** Recommended actions */
  recommendedActions: RemediationAction[];
  /** Auto-remediation applied */
  autoRemediationApplied: boolean;
}

export interface ResourceDrift {
  /** Resource identifier */
  resourceId: string;
  /** AWS resource ARN */
  awsArn: string;
  /** Drift type */
  driftType: 'configuration' | 'state' | 'deleted' | 'unmanaged';
  /** Expected configuration */
  expected: Record<string, unknown>;
  /** Actual configuration */
  actual: Record<string, unknown>;
  /** Differences */
  differences: ConfigurationDifference[];
  /** Last checked */
  lastChecked: string;
}

export interface ConfigurationDifference {
  /** Property path */
  path: string;
  /** Expected value */
  expectedValue: unknown;
  /** Actual value */
  actualValue: unknown;
  /** Difference severity */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface CostAnomaly {
  /** Service affected */
  service: string;
  /** Resource identifier */
  resourceId?: string;
  /** Anomaly type */
  type: 'spike' | 'trend' | 'unexpected';
  /** Expected cost */
  expectedCostUsd: number;
  /** Actual cost */
  actualCostUsd: number;
  /** Percentage difference */
  percentageDifference: number;
  /** Detection timestamp */
  detectedAt: string;
  /** Possible causes */
  possibleCauses: string[];
}

export interface RemediationAction {
  /** Action ID */
  id: string;
  /** Action type */
  type: 'update' | 'delete' | 'recreate' | 'alert' | 'scale';
  /** Priority */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Description */
  description: string;
  /** Resources affected */
  resourceIds: string[];
  /** Auto-executable */
  autoExecutable: boolean;
  /** Estimated impact */
  estimatedImpact: string;
  /** Approval required */
  approvalRequired: boolean;
}
