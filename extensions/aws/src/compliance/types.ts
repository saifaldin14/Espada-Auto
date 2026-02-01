/**
 * AWS Compliance & Governance Types
 *
 * Type definitions for AWS Config rules, compliance frameworks,
 * conformance packs, tag compliance, and compliance reporting.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Compliance operation result
 */
export interface ComplianceOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Compliance Manager configuration
 */
export interface ComplianceManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Enable automatic remediation */
  enableAutoRemediation?: boolean;
  /** Default compliance frameworks to check */
  defaultFrameworks?: ComplianceFramework[];
}

// =============================================================================
// Compliance Framework Types
// =============================================================================

/**
 * Supported compliance frameworks
 */
export type ComplianceFramework =
  | 'CIS'
  | 'CIS-1.2'
  | 'CIS-1.4'
  | 'CIS-2.0'
  | 'SOC2'
  | 'SOC2-Type1'
  | 'SOC2-Type2'
  | 'HIPAA'
  | 'PCI-DSS'
  | 'PCI-DSS-3.2.1'
  | 'PCI-DSS-4.0'
  | 'GDPR'
  | 'NIST-800-53'
  | 'NIST-CSF'
  | 'ISO-27001'
  | 'FedRAMP'
  | 'AWS-Foundational-Security'
  | 'AWS-Well-Architected'
  | 'Custom';

/**
 * Compliance framework information
 */
export interface FrameworkInfo {
  /** Framework ID */
  id: ComplianceFramework;
  /** Framework display name */
  name: string;
  /** Framework description */
  description: string;
  /** Framework version */
  version: string;
  /** Number of controls */
  controlCount: number;
  /** Categories within framework */
  categories: string[];
  /** Last updated date */
  lastUpdated: Date;
  /** Official documentation URL */
  documentationUrl?: string;
}

/**
 * Compliance control definition
 */
export interface ComplianceControl {
  /** Control ID within framework */
  controlId: string;
  /** Framework this control belongs to */
  framework: ComplianceFramework;
  /** Control title */
  title: string;
  /** Control description */
  description: string;
  /** Control category */
  category: string;
  /** Severity if violated */
  severity: ComplianceSeverity;
  /** AWS services this control applies to */
  applicableServices: string[];
  /** AWS Config rules that check this control */
  configRules: string[];
  /** Remediation guidance */
  remediationGuidance?: string;
  /** Automated remediation available */
  automatedRemediationAvailable: boolean;
  /** Documentation reference */
  documentationRef?: string;
}

// =============================================================================
// Compliance Status Types
// =============================================================================

/**
 * Compliance severity levels
 */
export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

/**
 * Compliance status
 */
export type ComplianceStatus = 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE' | 'INSUFFICIENT_DATA';

/**
 * Compliance check result
 */
export interface ComplianceCheckResult {
  /** Check ID */
  checkId: string;
  /** Framework being checked */
  framework: ComplianceFramework;
  /** Control ID */
  controlId: string;
  /** Control title */
  controlTitle: string;
  /** Compliance status */
  status: ComplianceStatus;
  /** Severity if non-compliant */
  severity: ComplianceSeverity;
  /** Affected resources */
  affectedResources: ComplianceResource[];
  /** Check timestamp */
  timestamp: Date;
  /** Detailed findings */
  findings: string[];
  /** Remediation guidance */
  remediationGuidance?: string;
  /** Auto-remediation available */
  autoRemediationAvailable: boolean;
}

/**
 * Resource compliance information
 */
export interface ComplianceResource {
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId: string;
  /** Resource ARN */
  resourceArn?: string;
  /** Resource name */
  resourceName?: string;
  /** AWS region */
  region: string;
  /** Compliance status for this resource */
  complianceStatus: ComplianceStatus;
  /** Specific violation details */
  violationDetails?: string;
}

/**
 * Overall compliance summary
 */
export interface ComplianceSummary {
  /** Framework being summarized */
  framework: ComplianceFramework;
  /** Total controls checked */
  totalControls: number;
  /** Compliant controls */
  compliantControls: number;
  /** Non-compliant controls */
  nonCompliantControls: number;
  /** Not applicable controls */
  notApplicableControls: number;
  /** Insufficient data controls */
  insufficientDataControls: number;
  /** Compliance percentage */
  compliancePercentage: number;
  /** Controls by severity */
  bySeverity: Record<ComplianceSeverity, {
    total: number;
    compliant: number;
    nonCompliant: number;
  }>;
  /** Controls by category */
  byCategory: Record<string, {
    total: number;
    compliant: number;
    nonCompliant: number;
  }>;
  /** Summary timestamp */
  timestamp: Date;
  /** Trend compared to last check */
  trend?: 'improving' | 'declining' | 'stable';
}

// =============================================================================
// AWS Config Types
// =============================================================================

/**
 * Config rule source type
 */
export type ConfigRuleSourceType = 'AWS' | 'CUSTOM_LAMBDA' | 'CUSTOM_POLICY';

/**
 * Config rule trigger type
 */
export type ConfigRuleTriggerType = 'ConfigurationItemChangeNotification' | 'OversizedConfigurationItemChangeNotification' | 'ScheduledNotification';

/**
 * Config rule compliance type
 */
export type ConfigRuleComplianceType = 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE' | 'INSUFFICIENT_DATA';

/**
 * AWS Config rule information
 */
export interface ConfigRuleInfo {
  /** Rule name */
  ruleName: string;
  /** Rule ARN */
  ruleArn: string;
  /** Rule ID */
  ruleId: string;
  /** Rule description */
  description?: string;
  /** Source type */
  sourceType: ConfigRuleSourceType;
  /** Source identifier (AWS managed rule name or Lambda ARN) */
  sourceIdentifier: string;
  /** Input parameters */
  inputParameters?: Record<string, string>;
  /** Scope (resource types) */
  scope?: {
    resourceTypes?: string[];
    tagKey?: string;
    tagValue?: string;
  };
  /** Maximum execution frequency */
  maximumExecutionFrequency?: string;
  /** Rule state */
  state: 'ACTIVE' | 'DELETING' | 'DELETING_RESULTS' | 'EVALUATING';
  /** Created by */
  createdBy?: string;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Config rule evaluation result
 */
export interface ConfigRuleEvaluation {
  /** Rule name */
  ruleName: string;
  /** Compliance type */
  complianceType: ConfigRuleComplianceType;
  /** Compliant resource count */
  compliantResourceCount: number;
  /** Non-compliant resource count */
  nonCompliantResourceCount: number;
  /** Last evaluation time */
  lastEvaluationTime?: Date;
  /** Annotation */
  annotation?: string;
}

/**
 * Config rule compliance detail
 */
export interface ConfigRuleComplianceDetail {
  /** Rule name */
  ruleName: string;
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId: string;
  /** Compliance type */
  complianceType: ConfigRuleComplianceType;
  /** Annotation */
  annotation?: string;
  /** Evaluation result timestamp */
  resultRecordedTime?: Date;
  /** Config rule invoked time */
  configRuleInvokedTime?: Date;
}

/**
 * Options for creating a Config rule
 */
export interface CreateConfigRuleOptions {
  /** Rule name */
  ruleName: string;
  /** Rule description */
  description?: string;
  /** Source type */
  sourceType: ConfigRuleSourceType;
  /** Source identifier */
  sourceIdentifier: string;
  /** Input parameters */
  inputParameters?: Record<string, string>;
  /** Resource types to evaluate */
  resourceTypes?: string[];
  /** Tag key scope */
  tagKey?: string;
  /** Tag value scope */
  tagValue?: string;
  /** Execution frequency for periodic rules */
  maximumExecutionFrequency?: 'One_Hour' | 'Three_Hours' | 'Six_Hours' | 'Twelve_Hours' | 'TwentyFour_Hours';
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Options for listing Config rules
 */
export interface ListConfigRulesOptions {
  /** Filter by rule names */
  ruleNames?: string[];
  /** Next token for pagination */
  nextToken?: string;
  /** Maximum results */
  maxResults?: number;
}

// =============================================================================
// Conformance Pack Types
// =============================================================================

/**
 * Conformance pack information
 */
export interface ConformancePackInfo {
  /** Pack name */
  packName: string;
  /** Pack ARN */
  packArn: string;
  /** Pack ID */
  packId: string;
  /** Delivery S3 bucket */
  deliveryS3Bucket?: string;
  /** Delivery S3 key prefix */
  deliveryS3KeyPrefix?: string;
  /** Template body */
  templateBody?: string;
  /** Template S3 URI */
  templateS3Uri?: string;
  /** Input parameters */
  inputParameters?: ConformancePackInputParameter[];
  /** Created by */
  createdBy?: string;
  /** Last update time */
  lastUpdateTime?: Date;
  /** Compliance status */
  complianceStatus?: 'COMPLIANT' | 'NON_COMPLIANT' | 'INSUFFICIENT_DATA';
}

/**
 * Conformance pack input parameter
 */
export interface ConformancePackInputParameter {
  /** Parameter name */
  parameterName: string;
  /** Parameter value */
  parameterValue: string;
}

/**
 * Conformance pack compliance detail
 */
export interface ConformancePackComplianceDetail {
  /** Pack name */
  packName: string;
  /** Rule name */
  ruleName: string;
  /** Compliance type */
  complianceType: ConfigRuleComplianceType;
  /** Controls evaluated */
  controlsEvaluated?: number;
  /** Controls passed */
  controlsPassed?: number;
}

/**
 * Options for creating a conformance pack
 */
export interface CreateConformancePackOptions {
  /** Pack name */
  packName: string;
  /** Template body (YAML) */
  templateBody?: string;
  /** Template S3 URI */
  templateS3Uri?: string;
  /** Delivery S3 bucket for results */
  deliveryS3Bucket?: string;
  /** Delivery S3 key prefix */
  deliveryS3KeyPrefix?: string;
  /** Input parameters */
  inputParameters?: ConformancePackInputParameter[];
}

/**
 * Options for listing conformance packs
 */
export interface ListConformancePacksOptions {
  /** Filter by pack names */
  packNames?: string[];
  /** Next token for pagination */
  nextToken?: string;
  /** Maximum results */
  maxResults?: number;
}

// =============================================================================
// Compliance Violation Types
// =============================================================================

/**
 * Compliance violation
 */
export interface ComplianceViolation {
  /** Violation ID */
  violationId: string;
  /** Framework */
  framework: ComplianceFramework;
  /** Control ID */
  controlId: string;
  /** Control title */
  controlTitle: string;
  /** Severity */
  severity: ComplianceSeverity;
  /** Resource information */
  resource: ComplianceResource;
  /** Violation description */
  description: string;
  /** Detection timestamp */
  detectedAt: Date;
  /** Last seen timestamp */
  lastSeenAt: Date;
  /** Violation status */
  status: ViolationStatus;
  /** Assigned to */
  assignedTo?: string;
  /** Due date for remediation */
  dueDate?: Date;
  /** Risk score (0-100) */
  riskScore: number;
  /** Remediation guidance */
  remediationGuidance: string;
  /** Auto-remediation available */
  autoRemediationAvailable: boolean;
  /** Remediation steps */
  remediationSteps?: RemediationStep[];
  /** Related violations */
  relatedViolations?: string[];
  /** Exception granted */
  exceptionGranted?: boolean;
  /** Exception reason */
  exceptionReason?: string;
  /** Exception expiry */
  exceptionExpiry?: Date;
}

/**
 * Violation status
 */
export type ViolationStatus = 'open' | 'in_progress' | 'remediated' | 'suppressed' | 'exception_granted';

/**
 * Remediation step
 */
export interface RemediationStep {
  /** Step number */
  step: number;
  /** Step description */
  description: string;
  /** AWS CLI command (if applicable) */
  awsCliCommand?: string;
  /** Console steps (if applicable) */
  consoleSteps?: string[];
  /** Estimated time in minutes */
  estimatedTimeMinutes?: number;
  /** Requires approval */
  requiresApproval?: boolean;
}

/**
 * Options for listing violations
 */
export interface ListViolationsOptions {
  /** Filter by framework */
  framework?: ComplianceFramework;
  /** Filter by severity */
  severity?: ComplianceSeverity;
  /** Filter by status */
  status?: ViolationStatus;
  /** Filter by resource type */
  resourceType?: string;
  /** Filter by region */
  region?: string;
  /** Include suppressed */
  includeSuppressed?: boolean;
  /** Maximum results */
  limit?: number;
  /** Sort by field */
  sortBy?: 'severity' | 'detectedAt' | 'riskScore';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

// =============================================================================
// Tag Compliance Types
// =============================================================================

/**
 * Required tag definition
 */
export interface RequiredTag {
  /** Tag key */
  key: string;
  /** Allowed values (empty = any value allowed) */
  allowedValues?: string[];
  /** Is case sensitive */
  caseSensitive?: boolean;
  /** Value pattern (regex) */
  valuePattern?: string;
  /** Description */
  description?: string;
  /** Default value if not provided */
  defaultValue?: string;
}

/**
 * Tag policy
 */
export interface TagPolicy {
  /** Policy ID */
  policyId: string;
  /** Policy name */
  name: string;
  /** Policy description */
  description: string;
  /** Required tags */
  requiredTags: RequiredTag[];
  /** Resource types this policy applies to */
  resourceTypes: string[];
  /** Enforcement mode */
  enforcementMode: TagEnforcementMode;
  /** Created at */
  createdAt: Date;
  /** Updated at */
  updatedAt: Date;
  /** Created by */
  createdBy?: string;
  /** Is active */
  isActive: boolean;
}

/**
 * Tag enforcement mode
 */
export type TagEnforcementMode = 'audit' | 'enforce' | 'remediate';

/**
 * Tag compliance result
 */
export interface TagComplianceResult {
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId: string;
  /** Resource ARN */
  resourceArn?: string;
  /** Region */
  region: string;
  /** Is compliant */
  isCompliant: boolean;
  /** Missing tags */
  missingTags: string[];
  /** Invalid tags */
  invalidTags: TagValidationError[];
  /** Current tags */
  currentTags: Record<string, string>;
  /** Check timestamp */
  checkedAt: Date;
}

/**
 * Tag validation error
 */
export interface TagValidationError {
  /** Tag key */
  key: string;
  /** Current value */
  currentValue?: string;
  /** Expected pattern or values */
  expected: string;
  /** Error message */
  message: string;
}

/**
 * Options for enforcing tags
 */
export interface EnforceTagsOptions {
  /** Tag policy to enforce */
  policyId?: string;
  /** Required tags (if no policy) */
  requiredTags?: RequiredTag[];
  /** Resource types to check */
  resourceTypes?: string[];
  /** Regions to check */
  regions?: string[];
  /** Enforcement mode */
  mode: TagEnforcementMode;
  /** Apply default values for missing tags */
  applyDefaults?: boolean;
  /** Dry run (don't actually apply changes) */
  dryRun?: boolean;
}

/**
 * Tag enforcement result
 */
export interface TagEnforcementResult {
  /** Total resources checked */
  totalChecked: number;
  /** Compliant resources */
  compliant: number;
  /** Non-compliant resources */
  nonCompliant: number;
  /** Resources remediated */
  remediated: number;
  /** Resources with errors */
  errors: number;
  /** Detailed results */
  details: TagComplianceResult[];
  /** Enforcement mode used */
  mode: TagEnforcementMode;
  /** Was dry run */
  dryRun: boolean;
  /** Timestamp */
  timestamp: Date;
}

// =============================================================================
// Remediation Types
// =============================================================================

/**
 * Remediation action type
 */
export type RemediationActionType =
  | 'AWS-DisablePublicAccessForS3Bucket'
  | 'AWS-EnableS3BucketEncryption'
  | 'AWS-EnableEbsEncryptionByDefault'
  | 'AWS-EnableVpcFlowLogs'
  | 'AWS-EnableCloudTrailLogFileValidation'
  | 'AWS-EnableRdsDbEncryption'
  | 'AWS-EnableSecurityHub'
  | 'AWS-EnableGuardDuty'
  | 'AWS-ConfigureS3BucketVersioning'
  | 'AWS-EnableIamAccessAnalyzer'
  | 'AWS-RevokeUnusedIamCredentials'
  | 'AWS-ConfigureSecurityGroupRules'
  | 'Custom';

/**
 * Remediation action configuration
 */
export interface RemediationActionConfig {
  /** Action type */
  actionType: RemediationActionType;
  /** Target type */
  targetType: 'SSM_DOCUMENT' | 'LAMBDA';
  /** Target ID (SSM document name or Lambda ARN) */
  targetId: string;
  /** Static parameters */
  staticParameters?: Record<string, string[]>;
  /** Resource parameter name */
  resourceParameter?: string;
  /** Resource parameter value */
  resourceValue?: string;
  /** Automatic remediation */
  automatic: boolean;
  /** Retry attempts */
  retryAttempts?: number;
  /** Retry wait seconds */
  retryWaitSeconds?: number;
  /** Maximum concurrent */
  maximumAutomaticAttempts?: number;
}

/**
 * Remediation execution result
 */
export interface RemediationExecutionResult {
  /** Remediation ID */
  remediationId: string;
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: string;
  /** Rule name */
  ruleName: string;
  /** Execution status */
  status: 'QUEUED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  /** Start time */
  startTime?: Date;
  /** End time */
  endTime?: Date;
  /** Failure message */
  failureMessage?: string;
  /** Step details */
  stepDetails?: RemediationStepDetail[];
}

/**
 * Remediation step detail
 */
export interface RemediationStepDetail {
  /** Step name */
  name: string;
  /** Step status */
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  /** Error message if failed */
  errorMessage?: string;
  /** Start time */
  startTime?: Date;
  /** Stop time */
  stopTime?: Date;
}

/**
 * Options for remediating a violation
 */
export interface RemediateViolationOptions {
  /** Violation ID */
  violationId: string;
  /** Remediation action type */
  actionType?: RemediationActionType;
  /** Custom parameters */
  parameters?: Record<string, string>;
  /** Dry run */
  dryRun?: boolean;
  /** Skip approval (if allowed) */
  skipApproval?: boolean;
}

// =============================================================================
// Compliance Report Types
// =============================================================================

/**
 * Compliance report format
 */
export type ReportFormat = 'json' | 'csv' | 'pdf' | 'html';

/**
 * Compliance report type
 */
export type ReportType =
  | 'executive_summary'
  | 'detailed_findings'
  | 'remediation_progress'
  | 'trend_analysis'
  | 'resource_compliance'
  | 'framework_assessment';

/**
 * Compliance report
 */
export interface ComplianceReport {
  /** Report ID */
  reportId: string;
  /** Report type */
  type: ReportType;
  /** Report title */
  title: string;
  /** Framework */
  framework: ComplianceFramework;
  /** Report period start */
  periodStart: Date;
  /** Report period end */
  periodEnd: Date;
  /** Generated at */
  generatedAt: Date;
  /** Generated by */
  generatedBy: string;
  /** Format */
  format: ReportFormat;
  /** Summary */
  summary: ComplianceReportSummary;
  /** S3 location (if stored) */
  s3Location?: string;
  /** Content (if inline) */
  content?: string;
}

/**
 * Compliance report summary
 */
export interface ComplianceReportSummary {
  /** Overall compliance score (0-100) */
  complianceScore: number;
  /** Total controls */
  totalControls: number;
  /** Compliant controls */
  compliantControls: number;
  /** Non-compliant controls */
  nonCompliantControls: number;
  /** Critical violations */
  criticalViolations: number;
  /** High violations */
  highViolations: number;
  /** Medium violations */
  mediumViolations: number;
  /** Low violations */
  lowViolations: number;
  /** Trend from previous period */
  trend?: {
    scoreChange: number;
    violationChange: number;
    direction: 'improving' | 'declining' | 'stable';
  };
  /** Top recommendations */
  topRecommendations: string[];
}

/**
 * Options for generating a compliance report
 */
export interface GenerateReportOptions {
  /** Report type */
  type: ReportType;
  /** Framework */
  framework: ComplianceFramework;
  /** Report format */
  format: ReportFormat;
  /** Period start (defaults to 30 days ago) */
  periodStart?: Date;
  /** Period end (defaults to now) */
  periodEnd?: Date;
  /** Include remediation guidance */
  includeRemediationGuidance?: boolean;
  /** Include resource details */
  includeResourceDetails?: boolean;
  /** Include trend analysis */
  includeTrendAnalysis?: boolean;
  /** S3 bucket to store report */
  s3Bucket?: string;
  /** S3 key prefix */
  s3KeyPrefix?: string;
  /** Send to email addresses */
  emailRecipients?: string[];
}

// =============================================================================
// Predefined Config Rules
// =============================================================================

/**
 * Predefined AWS Config managed rules
 */
export const AWS_MANAGED_RULES: Record<string, {
  identifier: string;
  description: string;
  frameworks: ComplianceFramework[];
  severity: ComplianceSeverity;
  resourceTypes: string[];
  parameters?: Record<string, string>;
}> = {
  // S3 Rules
  's3-bucket-public-read-prohibited': {
    identifier: 'S3_BUCKET_PUBLIC_READ_PROHIBITED',
    description: 'Checks if S3 buckets do not allow public read access',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'critical',
    resourceTypes: ['AWS::S3::Bucket'],
  },
  's3-bucket-public-write-prohibited': {
    identifier: 'S3_BUCKET_PUBLIC_WRITE_PROHIBITED',
    description: 'Checks if S3 buckets do not allow public write access',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'critical',
    resourceTypes: ['AWS::S3::Bucket'],
  },
  's3-bucket-ssl-requests-only': {
    identifier: 'S3_BUCKET_SSL_REQUESTS_ONLY',
    description: 'Checks if S3 buckets require SSL for requests',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS'],
    severity: 'high',
    resourceTypes: ['AWS::S3::Bucket'],
  },
  's3-bucket-server-side-encryption-enabled': {
    identifier: 'S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED',
    description: 'Checks if S3 buckets have server-side encryption enabled',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::S3::Bucket'],
  },
  's3-bucket-versioning-enabled': {
    identifier: 'S3_BUCKET_VERSIONING_ENABLED',
    description: 'Checks if S3 buckets have versioning enabled',
    frameworks: ['SOC2', 'AWS-Well-Architected'],
    severity: 'medium',
    resourceTypes: ['AWS::S3::Bucket'],
  },

  // IAM Rules
  'iam-root-access-key-check': {
    identifier: 'IAM_ROOT_ACCESS_KEY_CHECK',
    description: 'Checks if root account has access keys',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'critical',
    resourceTypes: ['AWS::IAM::User'],
  },
  'iam-user-mfa-enabled': {
    identifier: 'IAM_USER_MFA_ENABLED',
    description: 'Checks if IAM users have MFA enabled',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::IAM::User'],
  },
  'iam-password-policy': {
    identifier: 'IAM_PASSWORD_POLICY',
    description: 'Checks if IAM password policy meets requirements',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS'],
    severity: 'high',
    resourceTypes: ['AWS::IAM::User'],
    parameters: {
      RequireUppercaseCharacters: 'true',
      RequireLowercaseCharacters: 'true',
      RequireSymbols: 'true',
      RequireNumbers: 'true',
      MinimumPasswordLength: '14',
      PasswordReusePrevention: '24',
      MaxPasswordAge: '90',
    },
  },
  'iam-user-unused-credentials-check': {
    identifier: 'IAM_USER_UNUSED_CREDENTIALS_CHECK',
    description: 'Checks if IAM users have unused credentials',
    frameworks: ['CIS', 'SOC2', 'AWS-Foundational-Security'],
    severity: 'medium',
    resourceTypes: ['AWS::IAM::User'],
    parameters: { maxCredentialUsageAge: '90' },
  },
  'iam-policy-no-statements-with-admin-access': {
    identifier: 'IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS',
    description: 'Checks if IAM policies do not grant admin access',
    frameworks: ['CIS', 'SOC2', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::IAM::Policy'],
  },

  // EC2 Rules
  'ec2-instance-no-public-ip': {
    identifier: 'EC2_INSTANCE_NO_PUBLIC_IP',
    description: 'Checks if EC2 instances have public IPs',
    frameworks: ['CIS', 'SOC2', 'AWS-Foundational-Security'],
    severity: 'medium',
    resourceTypes: ['AWS::EC2::Instance'],
  },
  'ec2-ebs-encryption-by-default': {
    identifier: 'EC2_EBS_ENCRYPTION_BY_DEFAULT',
    description: 'Checks if EBS encryption is enabled by default',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::EC2::Instance'],
  },
  'ec2-imdsv2-check': {
    identifier: 'EC2_IMDSV2_CHECK',
    description: 'Checks if EC2 instances use IMDSv2',
    frameworks: ['CIS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::EC2::Instance'],
  },
  'restricted-ssh': {
    identifier: 'INCOMING_SSH_DISABLED',
    description: 'Checks if security groups allow unrestricted SSH',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::EC2::SecurityGroup'],
  },
  'restricted-common-ports': {
    identifier: 'RESTRICTED_INCOMING_TRAFFIC',
    description: 'Checks if security groups restrict common ports',
    frameworks: ['CIS', 'SOC2', 'PCI-DSS'],
    severity: 'high',
    resourceTypes: ['AWS::EC2::SecurityGroup'],
    parameters: { blockedPort1: '20', blockedPort2: '21', blockedPort3: '3389', blockedPort4: '3306', blockedPort5: '4333' },
  },

  // RDS Rules
  'rds-instance-public-access-check': {
    identifier: 'RDS_INSTANCE_PUBLIC_ACCESS_CHECK',
    description: 'Checks if RDS instances are publicly accessible',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'critical',
    resourceTypes: ['AWS::RDS::DBInstance'],
  },
  'rds-storage-encrypted': {
    identifier: 'RDS_STORAGE_ENCRYPTED',
    description: 'Checks if RDS storage is encrypted',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::RDS::DBInstance'],
  },
  'rds-multi-az-support': {
    identifier: 'RDS_MULTI_AZ_SUPPORT',
    description: 'Checks if RDS instances are Multi-AZ',
    frameworks: ['SOC2', 'AWS-Well-Architected'],
    severity: 'medium',
    resourceTypes: ['AWS::RDS::DBInstance'],
  },
  'db-instance-backup-enabled': {
    identifier: 'DB_INSTANCE_BACKUP_ENABLED',
    description: 'Checks if RDS automated backups are enabled',
    frameworks: ['SOC2', 'HIPAA', 'AWS-Well-Architected'],
    severity: 'medium',
    resourceTypes: ['AWS::RDS::DBInstance'],
  },

  // CloudTrail Rules
  'cloudtrail-enabled': {
    identifier: 'CLOUD_TRAIL_ENABLED',
    description: 'Checks if CloudTrail is enabled',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::CloudTrail::Trail'],
  },
  'cloudtrail-log-file-validation-enabled': {
    identifier: 'CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED',
    description: 'Checks if CloudTrail log file validation is enabled',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS'],
    severity: 'medium',
    resourceTypes: ['AWS::CloudTrail::Trail'],
  },
  'cloudtrail-encryption-enabled': {
    identifier: 'CLOUD_TRAIL_ENCRYPTION_ENABLED',
    description: 'Checks if CloudTrail logs are encrypted',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::CloudTrail::Trail'],
  },

  // VPC Rules
  'vpc-flow-logs-enabled': {
    identifier: 'VPC_FLOW_LOGS_ENABLED',
    description: 'Checks if VPC flow logs are enabled',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS', 'AWS-Foundational-Security'],
    severity: 'medium',
    resourceTypes: ['AWS::EC2::VPC'],
  },
  'vpc-default-security-group-closed': {
    identifier: 'VPC_DEFAULT_SECURITY_GROUP_CLOSED',
    description: 'Checks if default security group is closed',
    frameworks: ['CIS', 'SOC2', 'AWS-Foundational-Security'],
    severity: 'medium',
    resourceTypes: ['AWS::EC2::SecurityGroup'],
  },

  // KMS Rules
  'kms-cmk-not-scheduled-for-deletion': {
    identifier: 'KMS_CMK_NOT_SCHEDULED_FOR_DELETION',
    description: 'Checks if KMS keys are not scheduled for deletion',
    frameworks: ['SOC2', 'HIPAA', 'AWS-Foundational-Security'],
    severity: 'medium',
    resourceTypes: ['AWS::KMS::Key'],
  },
  'cmk-backing-key-rotation-enabled': {
    identifier: 'CMK_BACKING_KEY_ROTATION_ENABLED',
    description: 'Checks if KMS key rotation is enabled',
    frameworks: ['CIS', 'SOC2', 'HIPAA', 'PCI-DSS'],
    severity: 'medium',
    resourceTypes: ['AWS::KMS::Key'],
  },

  // Lambda Rules
  'lambda-function-public-access-prohibited': {
    identifier: 'LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED',
    description: 'Checks if Lambda functions are not publicly accessible',
    frameworks: ['SOC2', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: ['AWS::Lambda::Function'],
  },
  'lambda-inside-vpc': {
    identifier: 'LAMBDA_INSIDE_VPC',
    description: 'Checks if Lambda functions are in a VPC',
    frameworks: ['SOC2', 'HIPAA'],
    severity: 'medium',
    resourceTypes: ['AWS::Lambda::Function'],
  },

  // General Security Rules
  'securityhub-enabled': {
    identifier: 'SECURITYHUB_ENABLED',
    description: 'Checks if Security Hub is enabled',
    frameworks: ['AWS-Foundational-Security'],
    severity: 'medium',
    resourceTypes: [],
  },
  'guardduty-enabled-centralized': {
    identifier: 'GUARDDUTY_ENABLED_CENTRALIZED',
    description: 'Checks if GuardDuty is enabled',
    frameworks: ['CIS', 'SOC2', 'AWS-Foundational-Security'],
    severity: 'high',
    resourceTypes: [],
  },
};

// =============================================================================
// Predefined Conformance Pack Templates
// =============================================================================

/**
 * Predefined conformance pack templates
 */
export const CONFORMANCE_PACK_TEMPLATES: Record<string, {
  name: string;
  description: string;
  framework: ComplianceFramework;
  templateBody: string;
}> = {
  'cis-aws-foundations': {
    name: 'CIS AWS Foundations Benchmark',
    description: 'Conformance pack for CIS AWS Foundations Benchmark v1.4',
    framework: 'CIS',
    templateBody: `
AWSTemplateFormatVersion: '2010-09-09'
Description: CIS AWS Foundations Benchmark v1.4 Conformance Pack

Resources:
  IAMRootAccessKeyCheck:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: iam-root-access-key-check
      Source:
        Owner: AWS
        SourceIdentifier: IAM_ROOT_ACCESS_KEY_CHECK

  IAMUserMFAEnabled:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: iam-user-mfa-enabled
      Source:
        Owner: AWS
        SourceIdentifier: IAM_USER_MFA_ENABLED

  S3BucketPublicReadProhibited:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: s3-bucket-public-read-prohibited
      Source:
        Owner: AWS
        SourceIdentifier: S3_BUCKET_PUBLIC_READ_PROHIBITED

  CloudTrailEnabled:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: cloudtrail-enabled
      Source:
        Owner: AWS
        SourceIdentifier: CLOUD_TRAIL_ENABLED

  VPCFlowLogsEnabled:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: vpc-flow-logs-enabled
      Source:
        Owner: AWS
        SourceIdentifier: VPC_FLOW_LOGS_ENABLED
`.trim(),
  },
  'aws-operational-best-practices-hipaa': {
    name: 'HIPAA Operational Best Practices',
    description: 'Conformance pack for HIPAA compliance',
    framework: 'HIPAA',
    templateBody: `
AWSTemplateFormatVersion: '2010-09-09'
Description: HIPAA Operational Best Practices Conformance Pack

Resources:
  S3BucketSSLRequestsOnly:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: s3-bucket-ssl-requests-only
      Source:
        Owner: AWS
        SourceIdentifier: S3_BUCKET_SSL_REQUESTS_ONLY

  RDSStorageEncrypted:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: rds-storage-encrypted
      Source:
        Owner: AWS
        SourceIdentifier: RDS_STORAGE_ENCRYPTED

  CloudTrailEncryptionEnabled:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: cloudtrail-encryption-enabled
      Source:
        Owner: AWS
        SourceIdentifier: CLOUD_TRAIL_ENCRYPTION_ENABLED

  EBSEncryptionByDefault:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: ec2-ebs-encryption-by-default
      Source:
        Owner: AWS
        SourceIdentifier: EC2_EBS_ENCRYPTION_BY_DEFAULT
`.trim(),
  },
  'pci-dss': {
    name: 'PCI DSS Conformance Pack',
    description: 'Conformance pack for PCI DSS v3.2.1 compliance',
    framework: 'PCI-DSS',
    templateBody: `
AWSTemplateFormatVersion: '2010-09-09'
Description: PCI DSS v3.2.1 Conformance Pack

Resources:
  RestrictedSSH:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: restricted-ssh
      Source:
        Owner: AWS
        SourceIdentifier: INCOMING_SSH_DISABLED

  RDSInstancePublicAccessCheck:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: rds-instance-public-access-check
      Source:
        Owner: AWS
        SourceIdentifier: RDS_INSTANCE_PUBLIC_ACCESS_CHECK

  S3BucketServerSideEncryptionEnabled:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: s3-bucket-server-side-encryption-enabled
      Source:
        Owner: AWS
        SourceIdentifier: S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED

  IAMPasswordPolicy:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: iam-password-policy
      Source:
        Owner: AWS
        SourceIdentifier: IAM_PASSWORD_POLICY
      InputParameters:
        RequireUppercaseCharacters: 'true'
        RequireLowercaseCharacters: 'true'
        RequireSymbols: 'true'
        RequireNumbers: 'true'
        MinimumPasswordLength: '14'
`.trim(),
  },
  'soc2': {
    name: 'SOC 2 Conformance Pack',
    description: 'Conformance pack for SOC 2 Type II compliance',
    framework: 'SOC2',
    templateBody: `
AWSTemplateFormatVersion: '2010-09-09'
Description: SOC 2 Type II Conformance Pack

Resources:
  CloudTrailLogFileValidation:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: cloudtrail-log-file-validation-enabled
      Source:
        Owner: AWS
        SourceIdentifier: CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED

  GuardDutyEnabled:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: guardduty-enabled-centralized
      Source:
        Owner: AWS
        SourceIdentifier: GUARDDUTY_ENABLED_CENTRALIZED

  IAMUserUnusedCredentialsCheck:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: iam-user-unused-credentials-check
      Source:
        Owner: AWS
        SourceIdentifier: IAM_USER_UNUSED_CREDENTIALS_CHECK
      InputParameters:
        maxCredentialUsageAge: '90'

  RDSMultiAZSupport:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: rds-multi-az-support
      Source:
        Owner: AWS
        SourceIdentifier: RDS_MULTI_AZ_SUPPORT

  DBInstanceBackupEnabled:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: db-instance-backup-enabled
      Source:
        Owner: AWS
        SourceIdentifier: DB_INSTANCE_BACKUP_ENABLED
`.trim(),
  },
};

// =============================================================================
// Framework Definitions
// =============================================================================

/**
 * Framework information definitions
 */
export const FRAMEWORK_DEFINITIONS: FrameworkInfo[] = [
  {
    id: 'CIS',
    name: 'CIS AWS Foundations Benchmark',
    description: 'Center for Internet Security AWS Foundations Benchmark - a set of security best practices for AWS',
    version: '1.4.0',
    controlCount: 58,
    categories: ['Identity and Access Management', 'Logging', 'Monitoring', 'Networking', 'Storage'],
    lastUpdated: new Date('2021-05-28'),
    documentationUrl: 'https://www.cisecurity.org/benchmark/amazon_web_services',
  },
  {
    id: 'SOC2',
    name: 'SOC 2 Type II',
    description: 'Service Organization Control 2 - audit framework for service providers storing customer data',
    version: '2017',
    controlCount: 64,
    categories: ['Security', 'Availability', 'Processing Integrity', 'Confidentiality', 'Privacy'],
    lastUpdated: new Date('2017-01-01'),
    documentationUrl: 'https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/sorhome',
  },
  {
    id: 'HIPAA',
    name: 'HIPAA Security Rule',
    description: 'Health Insurance Portability and Accountability Act - protects electronic health information',
    version: '2013',
    controlCount: 54,
    categories: ['Administrative Safeguards', 'Physical Safeguards', 'Technical Safeguards'],
    lastUpdated: new Date('2013-01-25'),
    documentationUrl: 'https://www.hhs.gov/hipaa/for-professionals/security/index.html',
  },
  {
    id: 'PCI-DSS',
    name: 'PCI DSS',
    description: 'Payment Card Industry Data Security Standard - security standards for card payment processing',
    version: '4.0',
    controlCount: 78,
    categories: ['Build and Maintain Secure Network', 'Protect Cardholder Data', 'Vulnerability Management', 'Access Control', 'Monitoring and Testing', 'Information Security Policy'],
    lastUpdated: new Date('2022-03-31'),
    documentationUrl: 'https://www.pcisecuritystandards.org/document_library',
  },
  {
    id: 'GDPR',
    name: 'General Data Protection Regulation',
    description: 'EU regulation on data protection and privacy',
    version: '2016/679',
    controlCount: 42,
    categories: ['Data Protection', 'Privacy by Design', 'Data Subject Rights', 'Security', 'Breach Notification'],
    lastUpdated: new Date('2018-05-25'),
    documentationUrl: 'https://gdpr.eu/',
  },
  {
    id: 'NIST-800-53',
    name: 'NIST SP 800-53',
    description: 'Security and Privacy Controls for Information Systems and Organizations',
    version: 'Rev. 5',
    controlCount: 1189,
    categories: ['Access Control', 'Awareness and Training', 'Audit and Accountability', 'Configuration Management', 'Contingency Planning', 'Identification and Authentication', 'Incident Response', 'Maintenance', 'Media Protection', 'Physical and Environmental Protection', 'Planning', 'Program Management', 'Personnel Security', 'Risk Assessment', 'System and Services Acquisition', 'System and Communications Protection', 'System and Information Integrity', 'Supply Chain Risk Management', 'Privacy'],
    lastUpdated: new Date('2020-09-23'),
    documentationUrl: 'https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final',
  },
  {
    id: 'AWS-Foundational-Security',
    name: 'AWS Foundational Security Best Practices',
    description: 'AWS-defined best practices for foundational security',
    version: '1.0',
    controlCount: 167,
    categories: ['IAM', 'S3', 'EC2', 'RDS', 'CloudTrail', 'Lambda', 'KMS', 'VPC', 'CloudFront', 'ELB'],
    lastUpdated: new Date('2023-01-01'),
    documentationUrl: 'https://docs.aws.amazon.com/securityhub/latest/userguide/fsbp-standard.html',
  },
  {
    id: 'AWS-Well-Architected',
    name: 'AWS Well-Architected Framework',
    description: 'Best practices for building secure, high-performing, resilient, and efficient infrastructure',
    version: '2023',
    controlCount: 85,
    categories: ['Operational Excellence', 'Security', 'Reliability', 'Performance Efficiency', 'Cost Optimization', 'Sustainability'],
    lastUpdated: new Date('2023-10-01'),
    documentationUrl: 'https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html',
  },
];

// =============================================================================
// Manager Interface
// =============================================================================

/**
 * Compliance Manager interface
 */
export interface ComplianceManager {
  // Compliance Checks
  checkCompliance(framework: ComplianceFramework, options?: CheckComplianceOptions): Promise<ComplianceOperationResult<ComplianceCheckResult[]>>;
  getComplianceSummary(framework: ComplianceFramework): Promise<ComplianceOperationResult<ComplianceSummary>>;
  getFrameworks(): Promise<ComplianceOperationResult<FrameworkInfo[]>>;
  getFramework(frameworkId: ComplianceFramework): Promise<ComplianceOperationResult<FrameworkInfo>>;
  getControls(framework: ComplianceFramework): Promise<ComplianceOperationResult<ComplianceControl[]>>;

  // Violations
  listViolations(options?: ListViolationsOptions): Promise<ComplianceOperationResult<ComplianceViolation[]>>;
  getViolation(violationId: string): Promise<ComplianceOperationResult<ComplianceViolation>>;
  suppressViolation(violationId: string, reason: string, expiry?: Date): Promise<ComplianceOperationResult<void>>;
  unsuppressViolation(violationId: string): Promise<ComplianceOperationResult<void>>;

  // Config Rules
  listConfigRules(options?: ListConfigRulesOptions): Promise<ComplianceOperationResult<ConfigRuleInfo[]>>;
  getConfigRule(ruleName: string): Promise<ComplianceOperationResult<ConfigRuleInfo>>;
  createConfigRule(options: CreateConfigRuleOptions): Promise<ComplianceOperationResult<ConfigRuleInfo>>;
  deleteConfigRule(ruleName: string): Promise<ComplianceOperationResult<void>>;
  getConfigRuleCompliance(ruleName: string): Promise<ComplianceOperationResult<ConfigRuleEvaluation>>;
  getConfigRuleComplianceDetails(ruleName: string): Promise<ComplianceOperationResult<ConfigRuleComplianceDetail[]>>;
  startConfigRulesEvaluation(ruleNames: string[]): Promise<ComplianceOperationResult<void>>;

  // Conformance Packs
  listConformancePacks(options?: ListConformancePacksOptions): Promise<ComplianceOperationResult<ConformancePackInfo[]>>;
  getConformancePack(packName: string): Promise<ComplianceOperationResult<ConformancePackInfo>>;
  createConformancePack(options: CreateConformancePackOptions): Promise<ComplianceOperationResult<ConformancePackInfo>>;
  deleteConformancePack(packName: string): Promise<ComplianceOperationResult<void>>;
  getConformancePackCompliance(packName: string): Promise<ComplianceOperationResult<ConformancePackComplianceDetail[]>>;
  deployConformancePackFromTemplate(templateId: string): Promise<ComplianceOperationResult<ConformancePackInfo>>;

  // Tag Compliance
  checkTagCompliance(options: EnforceTagsOptions): Promise<ComplianceOperationResult<TagEnforcementResult>>;
  enforceTagPolicy(options: EnforceTagsOptions): Promise<ComplianceOperationResult<TagEnforcementResult>>;
  listTagPolicies(): Promise<ComplianceOperationResult<TagPolicy[]>>;
  createTagPolicy(policy: Omit<TagPolicy, 'policyId' | 'createdAt' | 'updatedAt'>): Promise<ComplianceOperationResult<TagPolicy>>;
  deleteTagPolicy(policyId: string): Promise<ComplianceOperationResult<void>>;

  // Remediation
  remediateViolation(options: RemediateViolationOptions): Promise<ComplianceOperationResult<RemediationExecutionResult>>;
  getRemediationStatus(remediationId: string): Promise<ComplianceOperationResult<RemediationExecutionResult>>;
  listRemediationActions(): Promise<ComplianceOperationResult<RemediationActionConfig[]>>;

  // Reporting
  generateReport(options: GenerateReportOptions): Promise<ComplianceOperationResult<ComplianceReport>>;
  listReports(framework?: ComplianceFramework): Promise<ComplianceOperationResult<ComplianceReport[]>>;
  getReport(reportId: string): Promise<ComplianceOperationResult<ComplianceReport>>;
}

/**
 * Options for checking compliance
 */
export interface CheckComplianceOptions {
  /** Specific control IDs to check */
  controlIds?: string[];
  /** Resource types to check */
  resourceTypes?: string[];
  /** Regions to check */
  regions?: string[];
  /** Include suppressed violations */
  includeSuppressed?: boolean;
}
