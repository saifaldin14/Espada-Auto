/**
 * AWS IaC (Infrastructure as Code) Types
 * 
 * Type definitions for Terraform and CloudFormation generation,
 * drift detection, and IaC management operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Supported IaC formats
 */
export type IaCFormat = 'terraform' | 'cloudformation';

/**
 * IaC output format for CloudFormation
 */
export type CloudFormationOutputFormat = 'yaml' | 'json';

/**
 * Resource type mappings for IaC generation
 */
export type AWSResourceType =
  | 'ec2_instance'
  | 'ec2_security_group'
  | 'ec2_key_pair'
  | 'ec2_vpc'
  | 'ec2_subnet'
  | 'ec2_internet_gateway'
  | 'ec2_nat_gateway'
  | 'ec2_route_table'
  | 'ec2_eip'
  | 'rds_instance'
  | 'rds_cluster'
  | 'rds_subnet_group'
  | 'rds_parameter_group'
  | 's3_bucket'
  | 's3_bucket_policy'
  | 'lambda_function'
  | 'lambda_layer'
  | 'iam_role'
  | 'iam_policy'
  | 'iam_instance_profile'
  | 'alb'
  | 'alb_target_group'
  | 'alb_listener'
  | 'asg'
  | 'launch_template'
  | 'cloudwatch_alarm'
  | 'cloudwatch_log_group'
  | 'sns_topic'
  | 'sqs_queue'
  | 'dynamodb_table'
  | 'elasticache_cluster'
  | 'kms_key';

/**
 * Drift status for resources
 */
export type DriftStatus = 'in_sync' | 'drifted' | 'deleted' | 'not_checked' | 'unknown';

/**
 * Change action types
 */
export type ChangeAction = 'create' | 'update' | 'delete' | 'replace' | 'no_change';

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * IaC Manager configuration
 */
export interface IaCManagerConfig {
  /** Default output format for CloudFormation */
  defaultCloudFormationFormat?: CloudFormationOutputFormat;
  /** Default Terraform version */
  terraformVersion?: string;
  /** Default AWS provider version for Terraform */
  awsProviderVersion?: string;
  /** Include comments in generated code */
  includeComments?: boolean;
  /** Default region for resources */
  defaultRegion?: string;
  /** Default tags to apply to all resources */
  defaultTags?: Record<string, string>;
}

// =============================================================================
// Resource Definition Types
// =============================================================================

/**
 * Base resource definition for IaC generation
 */
export interface IaCResourceDefinition {
  /** Resource type */
  type: AWSResourceType;
  /** Logical name/identifier */
  name: string;
  /** Resource properties */
  properties: Record<string, unknown>;
  /** Resource tags */
  tags?: Record<string, string>;
  /** Dependencies on other resources */
  dependsOn?: string[];
  /** AWS region (if different from default) */
  region?: string;
}

/**
 * EC2 Instance resource definition
 */
export interface EC2InstanceDefinition extends IaCResourceDefinition {
  type: 'ec2_instance';
  properties: {
    instanceType: string;
    ami: string;
    subnetId?: string;
    securityGroupIds?: string[];
    keyName?: string;
    iamInstanceProfile?: string;
    userData?: string;
    ebsOptimized?: boolean;
    monitoring?: boolean;
    rootBlockDevice?: {
      volumeSize: number;
      volumeType: string;
      encrypted?: boolean;
      deleteOnTermination?: boolean;
    };
    additionalBlockDevices?: Array<{
      deviceName: string;
      volumeSize: number;
      volumeType: string;
      encrypted?: boolean;
    }>;
  };
}

/**
 * VPC resource definition
 */
export interface VPCDefinition extends IaCResourceDefinition {
  type: 'ec2_vpc';
  properties: {
    cidrBlock: string;
    enableDnsSupport?: boolean;
    enableDnsHostnames?: boolean;
    instanceTenancy?: 'default' | 'dedicated';
  };
}

/**
 * Subnet resource definition
 */
export interface SubnetDefinition extends IaCResourceDefinition {
  type: 'ec2_subnet';
  properties: {
    vpcId: string;
    cidrBlock: string;
    availabilityZone?: string;
    mapPublicIpOnLaunch?: boolean;
  };
}

/**
 * Security Group resource definition
 */
export interface SecurityGroupDefinition extends IaCResourceDefinition {
  type: 'ec2_security_group';
  properties: {
    vpcId?: string;
    description: string;
    ingressRules?: Array<{
      fromPort: number;
      toPort: number;
      protocol: string;
      cidrBlocks?: string[];
      securityGroups?: string[];
      description?: string;
    }>;
    egressRules?: Array<{
      fromPort: number;
      toPort: number;
      protocol: string;
      cidrBlocks?: string[];
      securityGroups?: string[];
      description?: string;
    }>;
  };
}

/**
 * RDS Instance resource definition
 */
export interface RDSInstanceDefinition extends IaCResourceDefinition {
  type: 'rds_instance';
  properties: {
    identifier: string;
    engine: string;
    engineVersion?: string;
    instanceClass: string;
    allocatedStorage: number;
    storageType?: string;
    username: string;
    password?: string;
    dbName?: string;
    multiAz?: boolean;
    publiclyAccessible?: boolean;
    subnetGroupName?: string;
    securityGroupIds?: string[];
    parameterGroupName?: string;
    backupRetentionPeriod?: number;
    backupWindow?: string;
    maintenanceWindow?: string;
    skipFinalSnapshot?: boolean;
    deletionProtection?: boolean;
    storageEncrypted?: boolean;
    kmsKeyId?: string;
  };
}

/**
 * S3 Bucket resource definition
 */
export interface S3BucketDefinition extends IaCResourceDefinition {
  type: 's3_bucket';
  properties: {
    bucketName?: string;
    acl?: string;
    versioning?: boolean;
    encryption?: {
      sseAlgorithm: string;
      kmsKeyId?: string;
    };
    lifecycleRules?: Array<{
      id: string;
      enabled: boolean;
      prefix?: string;
      expirationDays?: number;
      transitions?: Array<{
        days: number;
        storageClass: string;
      }>;
    }>;
    corsRules?: Array<{
      allowedOrigins: string[];
      allowedMethods: string[];
      allowedHeaders?: string[];
      maxAgeSeconds?: number;
    }>;
    websiteConfiguration?: {
      indexDocument: string;
      errorDocument?: string;
    };
    publicAccessBlock?: {
      blockPublicAcls: boolean;
      blockPublicPolicy: boolean;
      ignorePublicAcls: boolean;
      restrictPublicBuckets: boolean;
    };
  };
}

/**
 * Lambda Function resource definition
 */
export interface LambdaFunctionDefinition extends IaCResourceDefinition {
  type: 'lambda_function';
  properties: {
    functionName: string;
    runtime: string;
    handler: string;
    role: string;
    s3Bucket?: string;
    s3Key?: string;
    filename?: string;
    memorySize?: number;
    timeout?: number;
    environment?: Record<string, string>;
    vpcConfig?: {
      subnetIds: string[];
      securityGroupIds: string[];
    };
    layers?: string[];
    reservedConcurrentExecutions?: number;
    tracingConfig?: {
      mode: 'Active' | 'PassThrough';
    };
  };
}

/**
 * IAM Role resource definition
 */
export interface IAMRoleDefinition extends IaCResourceDefinition {
  type: 'iam_role';
  properties: {
    name: string;
    assumeRolePolicy: string | object;
    description?: string;
    path?: string;
    maxSessionDuration?: number;
    managedPolicyArns?: string[];
    inlinePolicies?: Array<{
      name: string;
      policy: string | object;
    }>;
  };
}

/**
 * ALB resource definition
 */
export interface ALBDefinition extends IaCResourceDefinition {
  type: 'alb';
  properties: {
    name: string;
    internal?: boolean;
    loadBalancerType?: 'application' | 'network';
    securityGroups?: string[];
    subnets: string[];
    enableDeletionProtection?: boolean;
    idleTimeout?: number;
    accessLogs?: {
      bucket: string;
      prefix?: string;
      enabled: boolean;
    };
  };
}

/**
 * Auto Scaling Group resource definition
 */
export interface ASGDefinition extends IaCResourceDefinition {
  type: 'asg';
  properties: {
    name: string;
    minSize: number;
    maxSize: number;
    desiredCapacity: number;
    launchTemplate?: {
      id: string;
      version: string;
    };
    launchConfigurationName?: string;
    vpcZoneIdentifier: string[];
    targetGroupArns?: string[];
    healthCheckType?: 'EC2' | 'ELB';
    healthCheckGracePeriod?: number;
    terminationPolicies?: string[];
    enabledMetrics?: string[];
  };
}

// =============================================================================
// Template Types
// =============================================================================

/**
 * Infrastructure template specification
 */
export interface InfrastructureTemplate {
  /** Template name */
  name: string;
  /** Template description */
  description?: string;
  /** Template version */
  version?: string;
  /** Resources to create */
  resources: IaCResourceDefinition[];
  /** Template variables/parameters */
  variables?: Record<string, TemplateVariable>;
  /** Output values */
  outputs?: Record<string, TemplateOutput>;
  /** Provider configuration */
  provider?: {
    region: string;
    profile?: string;
  };
}

/**
 * Template variable definition
 */
export interface TemplateVariable {
  /** Variable type */
  type: 'string' | 'number' | 'boolean' | 'list' | 'map';
  /** Description */
  description?: string;
  /** Default value */
  default?: unknown;
  /** Whether the variable is required */
  required?: boolean;
  /** Validation rules */
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    allowedValues?: unknown[];
  };
}

/**
 * Template output definition
 */
export interface TemplateOutput {
  /** Output value expression */
  value: string;
  /** Description */
  description?: string;
  /** Whether to export the value */
  export?: boolean;
  /** Sensitive value (should be masked) */
  sensitive?: boolean;
}

// =============================================================================
// Generation Options
// =============================================================================

/**
 * Terraform generation options
 */
export interface TerraformGenerationOptions {
  /** Terraform version constraint */
  terraformVersion?: string;
  /** AWS provider version constraint */
  awsProviderVersion?: string;
  /** Backend configuration */
  backend?: {
    type: 's3' | 'local' | 'remote';
    config: Record<string, unknown>;
  };
  /** Include variable definitions file */
  includeVariables?: boolean;
  /** Include outputs file */
  includeOutputs?: boolean;
  /** Split into multiple files */
  splitFiles?: boolean;
  /** Format output (terraform fmt) */
  formatOutput?: boolean;
  /** Include comments */
  includeComments?: boolean;
  /** AWS region */
  region?: string;
  /** AWS profile */
  profile?: string;
}

/**
 * CloudFormation generation options
 */
export interface CloudFormationGenerationOptions {
  /** Output format */
  format?: CloudFormationOutputFormat;
  /** Template description */
  description?: string;
  /** AWS template format version */
  templateFormatVersion?: string;
  /** Include parameter definitions */
  includeParameters?: boolean;
  /** Include condition definitions */
  includeConditions?: boolean;
  /** Include mappings */
  includeMappings?: boolean;
  /** Stack name */
  stackName?: string;
  /** Include comments (YAML only) */
  includeComments?: boolean;
  /** AWS region */
  region?: string;
}

// =============================================================================
// Generation Result Types
// =============================================================================

/**
 * Generated Terraform code result
 */
export interface TerraformGenerationResult {
  /** Whether generation was successful */
  success: boolean;
  /** Main Terraform configuration */
  mainTf?: string;
  /** Variables file content */
  variablesTf?: string;
  /** Outputs file content */
  outputsTf?: string;
  /** Provider configuration */
  providerTf?: string;
  /** Backend configuration */
  backendTf?: string;
  /** Terraform.tfvars content */
  tfvars?: string;
  /** All files as a map */
  files?: Record<string, string>;
  /** Generation warnings */
  warnings?: string[];
  /** Generation errors */
  errors?: string[];
  /** Resource count */
  resourceCount?: number;
  /** Message */
  message: string;
}

/**
 * Generated CloudFormation template result
 */
export interface CloudFormationGenerationResult {
  /** Whether generation was successful */
  success: boolean;
  /** Generated template content */
  template?: string;
  /** Template as parsed object */
  templateObject?: Record<string, unknown>;
  /** Generation warnings */
  warnings?: string[];
  /** Generation errors */
  errors?: string[];
  /** Resource count */
  resourceCount?: number;
  /** Message */
  message: string;
}

// =============================================================================
// Drift Detection Types
// =============================================================================

/**
 * Drift detection options
 */
export interface DriftDetectionOptions {
  /** Resources to check (empty = all) */
  resourceIds?: string[];
  /** Resource types to check */
  resourceTypes?: AWSResourceType[];
  /** Region to check */
  region?: string;
  /** IaC file/directory path */
  iacPath?: string;
  /** IaC format */
  format?: IaCFormat;
  /** Include deleted resources */
  includeDeleted?: boolean;
}

/**
 * Single resource drift result
 */
export interface ResourceDrift {
  /** Resource identifier */
  resourceId: string;
  /** Resource type */
  resourceType: AWSResourceType;
  /** Logical name in IaC */
  logicalName?: string;
  /** Drift status */
  status: DriftStatus;
  /** Expected (IaC) properties */
  expected?: Record<string, unknown>;
  /** Actual (AWS) properties */
  actual?: Record<string, unknown>;
  /** Changed properties */
  changes?: Array<{
    property: string;
    expected: unknown;
    actual: unknown;
    changeType: 'added' | 'removed' | 'modified';
  }>;
  /** AWS region */
  region?: string;
}

/**
 * Drift detection result
 */
export interface DriftDetectionResult {
  /** Whether detection was successful */
  success: boolean;
  /** Timestamp of detection */
  timestamp: Date;
  /** Overall drift status */
  status: 'clean' | 'drifted' | 'error';
  /** Total resources checked */
  totalResources: number;
  /** Resources in sync */
  inSyncCount: number;
  /** Resources drifted */
  driftedCount: number;
  /** Resources deleted */
  deletedCount: number;
  /** Individual resource drifts */
  drifts: ResourceDrift[];
  /** Detection errors */
  errors?: string[];
  /** Message */
  message: string;
}

// =============================================================================
// State Export Types
// =============================================================================

/**
 * State export options
 */
export interface StateExportOptions {
  /** Resources to export (empty = all discovered) */
  resourceIds?: string[];
  /** Resource types to export */
  resourceTypes?: AWSResourceType[];
  /** Region(s) to export from */
  regions?: string[];
  /** Output format */
  format: IaCFormat;
  /** Include resource tags */
  includeTags?: boolean;
  /** Include dependencies */
  includeDependencies?: boolean;
  /** Terraform-specific options */
  terraformOptions?: TerraformGenerationOptions;
  /** CloudFormation-specific options */
  cloudFormationOptions?: CloudFormationGenerationOptions;
}

/**
 * Discovered AWS resource for export
 */
export interface DiscoveredResource {
  /** AWS resource ID */
  resourceId: string;
  /** AWS ARN */
  arn?: string;
  /** Resource type */
  resourceType: AWSResourceType;
  /** Resource properties */
  properties: Record<string, unknown>;
  /** Resource tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
  /** Dependencies */
  dependencies?: string[];
}

/**
 * State export result
 */
export interface StateExportResult {
  /** Whether export was successful */
  success: boolean;
  /** Exported resources count */
  resourceCount: number;
  /** Discovered resources */
  resources?: DiscoveredResource[];
  /** Generated IaC code */
  iacCode?: string;
  /** Multiple files (if split) */
  files?: Record<string, string>;
  /** Import commands (for Terraform) */
  importCommands?: string[];
  /** Export warnings */
  warnings?: string[];
  /** Export errors */
  errors?: string[];
  /** Message */
  message: string;
}

// =============================================================================
// Plan & Apply Types
// =============================================================================

/**
 * Change plan for a resource
 */
export interface ResourceChange {
  /** Resource identifier */
  resourceId?: string;
  /** Resource type */
  resourceType: AWSResourceType;
  /** Logical name */
  logicalName: string;
  /** Change action */
  action: ChangeAction;
  /** Properties being changed */
  changes?: Array<{
    property: string;
    before?: unknown;
    after?: unknown;
  }>;
  /** Requires replacement */
  requiresReplacement?: boolean;
}

/**
 * Infrastructure change plan
 */
export interface InfrastructurePlan {
  /** Whether plan was successful */
  success: boolean;
  /** Plan timestamp */
  timestamp: Date;
  /** Resources to create */
  toCreate: ResourceChange[];
  /** Resources to update */
  toUpdate: ResourceChange[];
  /** Resources to delete */
  toDelete: ResourceChange[];
  /** Resources unchanged */
  unchanged: number;
  /** Total resources in plan */
  totalResources: number;
  /** Estimated cost impact */
  estimatedCostImpact?: {
    monthlyCost: number;
    currency: string;
    breakdown?: Array<{
      resource: string;
      cost: number;
    }>;
  };
  /** Plan warnings */
  warnings?: string[];
  /** Plan errors */
  errors?: string[];
  /** Raw plan output */
  rawOutput?: string;
  /** Message */
  message: string;
}

/**
 * Apply options
 */
export interface ApplyOptions {
  /** Auto-approve changes */
  autoApprove?: boolean;
  /** Target specific resources */
  targets?: string[];
  /** Parallelism */
  parallelism?: number;
  /** Refresh state before apply */
  refresh?: boolean;
  /** Region */
  region?: string;
}

/**
 * Apply result
 */
export interface ApplyResult {
  /** Whether apply was successful */
  success: boolean;
  /** Apply timestamp */
  timestamp: Date;
  /** Resources created */
  created: number;
  /** Resources updated */
  updated: number;
  /** Resources deleted */
  deleted: number;
  /** Resources failed */
  failed: number;
  /** Individual resource results */
  resourceResults?: Array<{
    logicalName: string;
    resourceId?: string;
    action: ChangeAction;
    success: boolean;
    error?: string;
  }>;
  /** Outputs */
  outputs?: Record<string, unknown>;
  /** Apply errors */
  errors?: string[];
  /** Message */
  message: string;
}

// =============================================================================
// IaC Operation Result Type
// =============================================================================

/**
 * Generic IaC operation result
 */
export interface IaCOperationResult<T = unknown> {
  /** Whether operation was successful */
  success: boolean;
  /** Operation data */
  data?: T;
  /** Operation message */
  message: string;
  /** Warnings */
  warnings?: string[];
  /** Errors */
  errors?: string[];
}
