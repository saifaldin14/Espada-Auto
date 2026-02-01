/**
 * AWS Enhanced Conversational UX Types
 *
 * Type definitions for infrastructure context management, proactive insights,
 * natural language queries, and wizard-mode guided infrastructure creation.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Conversational UX operation result
 */
export interface ConversationalOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Conversational UX Manager configuration
 */
export interface ConversationalManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Maximum recent resources to track */
  maxRecentResources?: number;
  /** Maximum session history items */
  maxSessionHistory?: number;
  /** Enable proactive insights */
  enableProactiveInsights?: boolean;
  /** Insight check interval in minutes */
  insightCheckIntervalMinutes?: number;
}

// =============================================================================
// Infrastructure Context Types
// =============================================================================

/**
 * Environment type
 */
export type EnvironmentType = 'dev' | 'development' | 'staging' | 'uat' | 'production' | 'prod' | 'test' | 'sandbox';

/**
 * Resource type for tracking
 */
export type TrackedResourceType =
  | 'ec2:instance'
  | 'ec2:security-group'
  | 'ec2:vpc'
  | 'ec2:subnet'
  | 'rds:instance'
  | 'rds:cluster'
  | 'lambda:function'
  | 's3:bucket'
  | 'ecs:cluster'
  | 'ecs:service'
  | 'eks:cluster'
  | 'dynamodb:table'
  | 'sqs:queue'
  | 'sns:topic'
  | 'cloudfront:distribution'
  | 'elb:load-balancer'
  | 'iam:role'
  | 'iam:user'
  | 'kms:key'
  | 'secretsmanager:secret'
  | 'cloudwatch:alarm'
  | 'route53:hosted-zone'
  | 'apigateway:rest-api'
  | 'other';

/**
 * Resource reference for context tracking
 */
export interface ResourceReference {
  /** Resource type */
  type: TrackedResourceType;
  /** Resource ID or ARN */
  id: string;
  /** Resource name (display) */
  name: string;
  /** AWS region */
  region: string;
  /** AWS account ID */
  accountId?: string;
  /** Resource ARN if available */
  arn?: string;
  /** Resource tags */
  tags?: Record<string, string>;
  /** Last accessed timestamp */
  lastAccessed: Date;
  /** Access count in session */
  accessCount: number;
  /** Environment (inferred from tags or name) */
  environment?: EnvironmentType;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Operation record for session history
 */
export interface OperationRecord {
  /** Unique operation ID */
  id: string;
  /** Operation type/action */
  action: string;
  /** Service name */
  service: string;
  /** Target resources */
  resources: ResourceReference[];
  /** Operation timestamp */
  timestamp: Date;
  /** Operation status */
  status: 'success' | 'failed' | 'in-progress' | 'cancelled';
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error message if failed */
  error?: string;
  /** Operation parameters (sanitized) */
  parameters?: Record<string, unknown>;
  /** Result summary */
  resultSummary?: string;
}

/**
 * Infrastructure context state
 */
export interface InfrastructureContext {
  /** Session ID */
  sessionId: string;
  /** Session start time */
  sessionStarted: Date;
  /** Recently accessed resources */
  recentResources: ResourceReference[];
  /** Current working environment */
  environment?: EnvironmentType;
  /** Active AWS region */
  activeRegion: string;
  /** Current AWS account ID */
  activeAccount?: string;
  /** Session operation history */
  sessionHistory: OperationRecord[];
  /** Pinned/favorite resources */
  pinnedResources: ResourceReference[];
  /** Active filters */
  activeFilters: ResourceFilter[];
  /** Context variables (user-defined) */
  variables: Record<string, string>;
  /** Last activity timestamp */
  lastActivity: Date;
}

/**
 * Resource filter for queries
 */
export interface ResourceFilter {
  /** Filter ID */
  id: string;
  /** Filter name */
  name: string;
  /** Filter type */
  type: 'tag' | 'region' | 'type' | 'environment' | 'account' | 'name' | 'created' | 'custom';
  /** Filter operator */
  operator: 'equals' | 'not-equals' | 'contains' | 'starts-with' | 'ends-with' | 'greater-than' | 'less-than' | 'in' | 'not-in' | 'exists' | 'not-exists';
  /** Filter value(s) */
  value: string | string[] | number | Date;
  /** Is filter active */
  active: boolean;
}

// =============================================================================
// Proactive Insights Types
// =============================================================================

/**
 * Insight severity level
 */
export type InsightSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Insight category
 */
export type InsightCategory =
  | 'cost'
  | 'security'
  | 'performance'
  | 'reliability'
  | 'operational'
  | 'compliance'
  | 'capacity'
  | 'optimization';

/**
 * Insight status
 */
export type InsightStatus = 'new' | 'acknowledged' | 'in-progress' | 'resolved' | 'dismissed' | 'snoozed';

/**
 * Proactive insight
 */
export interface ProactiveInsight {
  /** Unique insight ID */
  id: string;
  /** Insight title */
  title: string;
  /** Detailed description */
  description: string;
  /** Insight category */
  category: InsightCategory;
  /** Severity level */
  severity: InsightSeverity;
  /** Current status */
  status: InsightStatus;
  /** Affected resources */
  affectedResources: ResourceReference[];
  /** Detected timestamp */
  detectedAt: Date;
  /** Last updated timestamp */
  updatedAt: Date;
  /** Estimated impact (cost, performance, etc.) */
  impact?: InsightImpact;
  /** Recommended actions */
  recommendations: InsightRecommendation[];
  /** Related AWS service */
  service: string;
  /** Source of insight (CloudWatch, Cost Explorer, etc.) */
  source: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Snooze until (if snoozed) */
  snoozeUntil?: Date;
}

/**
 * Insight impact assessment
 */
export interface InsightImpact {
  /** Impact type */
  type: 'cost' | 'performance' | 'security' | 'availability' | 'compliance';
  /** Current value/state */
  currentValue?: string | number;
  /** Threshold or expected value */
  threshold?: string | number;
  /** Unit of measurement */
  unit?: string;
  /** Estimated cost impact (USD) */
  estimatedCostImpact?: number;
  /** Estimated time to impact */
  estimatedTimeToImpact?: string;
  /** Risk level */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Insight recommendation
 */
export interface InsightRecommendation {
  /** Recommendation ID */
  id: string;
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Priority (1 = highest) */
  priority: number;
  /** Estimated effort */
  effort: 'minimal' | 'low' | 'medium' | 'high';
  /** Can be automated */
  automatable: boolean;
  /** Action to take (tool action name) */
  action?: string;
  /** Action parameters */
  actionParameters?: Record<string, unknown>;
  /** Documentation link */
  documentationUrl?: string;
}

/**
 * Insight check configuration
 */
export interface InsightCheckConfig {
  /** Check ID */
  id: string;
  /** Check name */
  name: string;
  /** Check category */
  category: InsightCategory;
  /** Is check enabled */
  enabled: boolean;
  /** Check interval in minutes */
  intervalMinutes: number;
  /** Last check timestamp */
  lastChecked?: Date;
  /** Check thresholds */
  thresholds?: Record<string, number>;
}

// =============================================================================
// Natural Language Query Types
// =============================================================================

/**
 * Query intent
 */
export type QueryIntent =
  | 'list'
  | 'find'
  | 'count'
  | 'describe'
  | 'compare'
  | 'analyze'
  | 'summarize'
  | 'filter'
  | 'aggregate';

/**
 * Time range type
 */
export type TimeRangeType =
  | 'last-hour'
  | 'last-day'
  | 'last-week'
  | 'last-month'
  | 'last-quarter'
  | 'last-year'
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'this-month'
  | 'custom';

/**
 * Parsed natural language query
 */
export interface ParsedQuery {
  /** Original query string */
  originalQuery: string;
  /** Detected intent */
  intent: QueryIntent;
  /** Target resource types */
  resourceTypes: TrackedResourceType[];
  /** Extracted filters */
  filters: ResourceFilter[];
  /** Time range if specified */
  timeRange?: {
    type: TimeRangeType;
    start?: Date;
    end?: Date;
  };
  /** Region filter */
  region?: string;
  /** Environment filter */
  environment?: EnvironmentType;
  /** Tag filters */
  tags?: Record<string, string>;
  /** Sort criteria */
  sortBy?: {
    field: string;
    order: 'asc' | 'desc';
  };
  /** Limit results */
  limit?: number;
  /** Aggregation if requested */
  aggregation?: {
    type: 'count' | 'sum' | 'avg' | 'min' | 'max';
    field?: string;
    groupBy?: string;
  };
  /** Confidence score (0-1) */
  confidence: number;
  /** Ambiguous parts that need clarification */
  ambiguities?: string[];
}

/**
 * Query result
 */
export interface QueryResult {
  /** Query that was executed */
  query: ParsedQuery;
  /** Result resources */
  resources: ResourceReference[];
  /** Total count (before limit) */
  totalCount: number;
  /** Aggregation result if requested */
  aggregationResult?: {
    value: number | Record<string, number>;
    label: string;
  };
  /** Summary text */
  summary: string;
  /** Execution time in ms */
  executionTimeMs: number;
  /** Suggestions for follow-up queries */
  suggestions?: string[];
}

/**
 * Query pattern for NLP matching
 */
export interface QueryPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Regex or keyword patterns */
  patterns: string[];
  /** Extracted intent */
  intent: QueryIntent;
  /** Default resource types */
  defaultResourceTypes?: TrackedResourceType[];
  /** Examples */
  examples: string[];
}

// =============================================================================
// Wizard Mode Types
// =============================================================================

/**
 * Wizard type
 */
export type WizardType =
  | 'web-application'
  | 'api-backend'
  | 'data-pipeline'
  | 'static-website'
  | 'containerized-app'
  | 'serverless-api'
  | 'database-setup'
  | 'vpc-network'
  | 'monitoring-setup'
  | 'ci-cd-pipeline'
  | 'disaster-recovery'
  | 'security-hardening'
  | 'cost-optimization'
  | 'custom';

/**
 * Wizard step type
 */
export type WizardStepType =
  | 'choice'
  | 'input'
  | 'multi-select'
  | 'confirmation'
  | 'review'
  | 'execution'
  | 'completion';

/**
 * Wizard step option
 */
export interface WizardStepOption {
  /** Option ID */
  id: string;
  /** Display label */
  label: string;
  /** Description */
  description?: string;
  /** Is recommended */
  recommended?: boolean;
  /** Is disabled */
  disabled?: boolean;
  /** Reason if disabled */
  disabledReason?: string;
  /** Additional value/metadata */
  value?: unknown;
}

/**
 * Wizard step
 */
export interface WizardStep {
  /** Step ID */
  id: string;
  /** Step number */
  stepNumber: number;
  /** Total steps */
  totalSteps: number;
  /** Step title */
  title: string;
  /** Step description */
  description: string;
  /** Step type */
  type: WizardStepType;
  /** Available options (for choice/multi-select) */
  options?: WizardStepOption[];
  /** Input configuration (for input type) */
  inputConfig?: {
    placeholder?: string;
    validation?: string;
    defaultValue?: string;
    required?: boolean;
    type?: 'text' | 'number' | 'cidr' | 'arn' | 'region' | 'instance-type';
  };
  /** Current value/selection */
  currentValue?: unknown;
  /** Is step completed */
  completed: boolean;
  /** Can go back */
  canGoBack: boolean;
  /** Can skip */
  canSkip: boolean;
  /** Help text */
  helpText?: string;
  /** Documentation link */
  documentationUrl?: string;
  /** Estimated time for this step */
  estimatedTimeMinutes?: number;
}

/**
 * Wizard execution plan
 */
export interface WizardExecutionPlan {
  /** Plan ID */
  id: string;
  /** Resources to create */
  resourcesToCreate: PlannedResource[];
  /** Resources to modify */
  resourcesToModify: PlannedResource[];
  /** Estimated total cost (monthly) */
  estimatedMonthlyCost?: number;
  /** Estimated setup time */
  estimatedSetupTimeMinutes?: number;
  /** Prerequisites */
  prerequisites?: string[];
  /** Warnings */
  warnings?: string[];
  /** Generated IaC (Terraform/CloudFormation) */
  generatedIaC?: {
    format: 'terraform' | 'cloudformation';
    content: string;
  };
}

/**
 * Planned resource for execution
 */
export interface PlannedResource {
  /** Resource type */
  type: TrackedResourceType;
  /** Resource name */
  name: string;
  /** Resource configuration */
  configuration: Record<string, unknown>;
  /** Dependencies (other resource names) */
  dependencies?: string[];
  /** Estimated cost (monthly) */
  estimatedMonthlyCost?: number;
  /** Order of creation */
  order: number;
}

/**
 * Wizard state
 */
export interface WizardState {
  /** Wizard ID */
  wizardId: string;
  /** Wizard type */
  type: WizardType;
  /** Wizard title */
  title: string;
  /** Wizard description */
  description: string;
  /** Current step index */
  currentStepIndex: number;
  /** All steps */
  steps: WizardStep[];
  /** Collected values */
  values: Record<string, unknown>;
  /** Execution plan (generated at review step) */
  executionPlan?: WizardExecutionPlan;
  /** Wizard status */
  status: 'in-progress' | 'completed' | 'cancelled' | 'failed';
  /** Started at */
  startedAt: Date;
  /** Completed at */
  completedAt?: Date;
  /** Created resources */
  createdResources?: ResourceReference[];
  /** Error if failed */
  error?: string;
}

/**
 * Wizard template
 */
export interface WizardTemplate {
  /** Template ID */
  id: string;
  /** Wizard type */
  type: WizardType;
  /** Template name */
  name: string;
  /** Template description */
  description: string;
  /** Category */
  category: 'compute' | 'network' | 'database' | 'storage' | 'serverless' | 'devops' | 'security' | 'monitoring';
  /** Complexity level */
  complexity: 'beginner' | 'intermediate' | 'advanced';
  /** Estimated setup time */
  estimatedTimeMinutes: number;
  /** Prerequisites */
  prerequisites?: string[];
  /** Step definitions */
  stepDefinitions: Omit<WizardStep, 'stepNumber' | 'totalSteps' | 'completed' | 'currentValue' | 'canGoBack'>[];
  /** Tags */
  tags?: string[];
  /** Use cases */
  useCases?: string[];
}

// =============================================================================
// Predefined Wizard Templates
// =============================================================================

/**
 * Predefined wizard templates for common infrastructure patterns
 */
export const WIZARD_TEMPLATES: WizardTemplate[] = [
  {
    id: 'production-web-app',
    type: 'web-application',
    name: 'Production Web Application',
    description: 'Set up a production-ready web application with VPC, ALB, Auto Scaling, and RDS',
    category: 'compute',
    complexity: 'intermediate',
    estimatedTimeMinutes: 30,
    prerequisites: ['AWS account with appropriate permissions', 'Domain name (optional)'],
    tags: ['web', 'ec2', 'alb', 'rds', 'auto-scaling'],
    useCases: ['E-commerce websites', 'Content management systems', 'Web portals'],
    stepDefinitions: [
      {
        id: 'network-setup',
        title: 'Network Setup',
        description: 'Configure the VPC and networking for your application',
        type: 'choice',
        options: [
          { id: 'new-vpc', label: 'Create new VPC', description: '3-tier architecture with public/private subnets', recommended: true },
          { id: 'existing-vpc', label: 'Use existing VPC', description: 'Select from your existing VPCs' },
          { id: 'default-vpc', label: 'Use default VPC', description: 'Quick setup using the default VPC' },
        ],
        canSkip: false,
        helpText: 'A new VPC is recommended for production workloads to ensure isolation and security.',
      },
      {
        id: 'compute-config',
        title: 'Compute Configuration',
        description: 'Configure your EC2 instances and Auto Scaling',
        type: 'choice',
        options: [
          { id: 'small', label: 'Small (t3.small)', description: '2 vCPU, 2 GB RAM - Good for low traffic', value: 't3.small' },
          { id: 'medium', label: 'Medium (t3.medium)', description: '2 vCPU, 4 GB RAM - Moderate traffic', value: 't3.medium', recommended: true },
          { id: 'large', label: 'Large (t3.large)', description: '2 vCPU, 8 GB RAM - High traffic', value: 't3.large' },
          { id: 'custom', label: 'Custom', description: 'Specify your own instance type', value: 'custom' },
        ],
        canSkip: false,
      },
      {
        id: 'scaling-config',
        title: 'Auto Scaling',
        description: 'Configure automatic scaling for your application',
        type: 'choice',
        options: [
          { id: 'fixed', label: 'Fixed capacity', description: 'Run a fixed number of instances', value: { min: 2, max: 2, desired: 2 } },
          { id: 'dynamic-low', label: 'Dynamic (Low)', description: '1-4 instances based on CPU', value: { min: 1, max: 4, desired: 2 }, recommended: true },
          { id: 'dynamic-high', label: 'Dynamic (High)', description: '2-10 instances based on CPU', value: { min: 2, max: 10, desired: 4 } },
        ],
        canSkip: false,
      },
      {
        id: 'database-config',
        title: 'Database Configuration',
        description: 'Set up your database tier',
        type: 'choice',
        options: [
          { id: 'rds-postgres', label: 'PostgreSQL (RDS)', description: 'Managed PostgreSQL database', recommended: true },
          { id: 'rds-mysql', label: 'MySQL (RDS)', description: 'Managed MySQL database' },
          { id: 'aurora-postgres', label: 'Aurora PostgreSQL', description: 'High-performance Aurora' },
          { id: 'none', label: 'No database', description: 'Skip database setup' },
        ],
        canSkip: true,
      },
      {
        id: 'security-config',
        title: 'Security Configuration',
        description: 'Configure security settings',
        type: 'multi-select',
        options: [
          { id: 'ssl', label: 'Enable SSL/TLS', description: 'HTTPS for all traffic', recommended: true },
          { id: 'waf', label: 'Enable WAF', description: 'Web Application Firewall protection' },
          { id: 'guardduty', label: 'Enable GuardDuty', description: 'Threat detection' },
          { id: 'encryption', label: 'Encrypt at rest', description: 'KMS encryption for all data', recommended: true },
        ],
        canSkip: false,
      },
      {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review your configuration before creating resources',
        type: 'review',
        canSkip: false,
      },
    ],
  },
  {
    id: 'serverless-api',
    type: 'serverless-api',
    name: 'Serverless REST API',
    description: 'Create a serverless API using API Gateway and Lambda',
    category: 'serverless',
    complexity: 'beginner',
    estimatedTimeMinutes: 15,
    tags: ['api', 'lambda', 'api-gateway', 'serverless'],
    useCases: ['REST APIs', 'Microservices', 'Webhooks'],
    stepDefinitions: [
      {
        id: 'api-config',
        title: 'API Configuration',
        description: 'Configure your API Gateway',
        type: 'choice',
        options: [
          { id: 'rest', label: 'REST API', description: 'Full-featured REST API with request validation', recommended: true },
          { id: 'http', label: 'HTTP API', description: 'Lower latency, lower cost' },
        ],
        canSkip: false,
      },
      {
        id: 'runtime-config',
        title: 'Lambda Runtime',
        description: 'Select the runtime for your Lambda functions',
        type: 'choice',
        options: [
          { id: 'nodejs20', label: 'Node.js 20.x', value: 'nodejs20.x', recommended: true },
          { id: 'python312', label: 'Python 3.12', value: 'python3.12' },
          { id: 'java21', label: 'Java 21', value: 'java21' },
          { id: 'go', label: 'Go 1.x', value: 'go1.x' },
        ],
        canSkip: false,
      },
      {
        id: 'auth-config',
        title: 'Authentication',
        description: 'Configure API authentication',
        type: 'choice',
        options: [
          { id: 'cognito', label: 'Amazon Cognito', description: 'User pools with OAuth 2.0', recommended: true },
          { id: 'api-key', label: 'API Key', description: 'Simple API key authentication' },
          { id: 'iam', label: 'IAM Authentication', description: 'AWS IAM-based auth' },
          { id: 'none', label: 'No authentication', description: 'Public API' },
        ],
        canSkip: false,
      },
      {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review your API configuration',
        type: 'review',
        canSkip: false,
      },
    ],
  },
  {
    id: 'containerized-app',
    type: 'containerized-app',
    name: 'Containerized Application (ECS)',
    description: 'Deploy a containerized application on ECS Fargate',
    category: 'compute',
    complexity: 'intermediate',
    estimatedTimeMinutes: 25,
    prerequisites: ['Docker image in ECR or Docker Hub'],
    tags: ['containers', 'ecs', 'fargate', 'docker'],
    useCases: ['Microservices', 'Containerized applications', 'Docker workloads'],
    stepDefinitions: [
      {
        id: 'cluster-config',
        title: 'ECS Cluster',
        description: 'Configure your ECS cluster',
        type: 'choice',
        options: [
          { id: 'new-cluster', label: 'Create new cluster', description: 'New ECS cluster with Fargate', recommended: true },
          { id: 'existing-cluster', label: 'Use existing cluster', description: 'Deploy to an existing cluster' },
        ],
        canSkip: false,
      },
      {
        id: 'capacity-config',
        title: 'Capacity Provider',
        description: 'Select the capacity provider strategy',
        type: 'choice',
        options: [
          { id: 'fargate', label: 'Fargate', description: 'Serverless containers', recommended: true },
          { id: 'fargate-spot', label: 'Fargate Spot', description: 'Lower cost with interruptions' },
          { id: 'ec2', label: 'EC2', description: 'Self-managed EC2 instances' },
        ],
        canSkip: false,
      },
      {
        id: 'task-config',
        title: 'Task Configuration',
        description: 'Configure your task resources',
        type: 'choice',
        options: [
          { id: 'small', label: 'Small (0.25 vCPU, 512MB)', value: { cpu: '256', memory: '512' } },
          { id: 'medium', label: 'Medium (0.5 vCPU, 1GB)', value: { cpu: '512', memory: '1024' }, recommended: true },
          { id: 'large', label: 'Large (1 vCPU, 2GB)', value: { cpu: '1024', memory: '2048' } },
          { id: 'xlarge', label: 'X-Large (2 vCPU, 4GB)', value: { cpu: '2048', memory: '4096' } },
        ],
        canSkip: false,
      },
      {
        id: 'scaling-config',
        title: 'Service Auto Scaling',
        description: 'Configure automatic scaling',
        type: 'choice',
        options: [
          { id: 'disabled', label: 'Disabled', description: 'Fixed number of tasks' },
          { id: 'cpu-based', label: 'CPU-based', description: 'Scale based on CPU utilization', recommended: true },
          { id: 'request-based', label: 'Request-based', description: 'Scale based on request count' },
        ],
        canSkip: true,
      },
      {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review your ECS configuration',
        type: 'review',
        canSkip: false,
      },
    ],
  },
  {
    id: 'static-website',
    type: 'static-website',
    name: 'Static Website (S3 + CloudFront)',
    description: 'Host a static website with S3 and CloudFront CDN',
    category: 'storage',
    complexity: 'beginner',
    estimatedTimeMinutes: 10,
    tags: ['static', 's3', 'cloudfront', 'cdn', 'website'],
    useCases: ['Landing pages', 'Documentation sites', 'Single-page applications'],
    stepDefinitions: [
      {
        id: 'bucket-config',
        title: 'S3 Bucket',
        description: 'Configure the S3 bucket for your website',
        type: 'input',
        inputConfig: {
          placeholder: 'my-website-bucket',
          validation: '^[a-z0-9][a-z0-9.-]*[a-z0-9]$',
          required: true,
          type: 'text',
        },
        canSkip: false,
        helpText: 'Bucket names must be globally unique and contain only lowercase letters, numbers, and hyphens.',
      },
      {
        id: 'cdn-config',
        title: 'CloudFront CDN',
        description: 'Configure CloudFront distribution',
        type: 'choice',
        options: [
          { id: 'enabled', label: 'Enable CloudFront', description: 'Global CDN with edge caching', recommended: true },
          { id: 'disabled', label: 'S3 only', description: 'Direct S3 hosting without CDN' },
        ],
        canSkip: false,
      },
      {
        id: 'ssl-config',
        title: 'SSL Certificate',
        description: 'Configure HTTPS for your website',
        type: 'choice',
        options: [
          { id: 'acm', label: 'ACM Certificate', description: 'Free SSL certificate from ACM', recommended: true },
          { id: 'custom', label: 'Custom certificate', description: 'Import your own certificate' },
          { id: 'none', label: 'No HTTPS', description: 'HTTP only (not recommended)' },
        ],
        canSkip: false,
      },
      {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review your website configuration',
        type: 'review',
        canSkip: false,
      },
    ],
  },
  {
    id: 'vpc-network',
    type: 'vpc-network',
    name: 'VPC Network Setup',
    description: 'Create a production VPC with public and private subnets',
    category: 'network',
    complexity: 'intermediate',
    estimatedTimeMinutes: 15,
    tags: ['vpc', 'network', 'subnets', 'nat-gateway'],
    useCases: ['Network foundation', 'Multi-tier architecture', 'Isolated environments'],
    stepDefinitions: [
      {
        id: 'cidr-config',
        title: 'VPC CIDR Block',
        description: 'Configure the VPC IP address range',
        type: 'choice',
        options: [
          { id: 'small', label: '/24 (256 IPs)', description: 'Small VPC for testing', value: '10.0.0.0/24' },
          { id: 'medium', label: '/20 (4,096 IPs)', description: 'Medium VPC for most workloads', value: '10.0.0.0/20', recommended: true },
          { id: 'large', label: '/16 (65,536 IPs)', description: 'Large VPC for enterprise', value: '10.0.0.0/16' },
          { id: 'custom', label: 'Custom CIDR', description: 'Specify your own CIDR block' },
        ],
        canSkip: false,
      },
      {
        id: 'az-config',
        title: 'Availability Zones',
        description: 'Select the number of availability zones',
        type: 'choice',
        options: [
          { id: '2', label: '2 AZs', description: 'Good for most workloads', value: 2 },
          { id: '3', label: '3 AZs', description: 'Higher availability', value: 3, recommended: true },
        ],
        canSkip: false,
      },
      {
        id: 'nat-config',
        title: 'NAT Gateway',
        description: 'Configure NAT gateway for private subnets',
        type: 'choice',
        options: [
          { id: 'single', label: 'Single NAT Gateway', description: 'Cost-effective, single point of failure', value: 'single' },
          { id: 'per-az', label: 'NAT per AZ', description: 'High availability', value: 'per-az', recommended: true },
          { id: 'none', label: 'No NAT Gateway', description: 'Private subnets without internet access' },
        ],
        canSkip: false,
      },
      {
        id: 'endpoints-config',
        title: 'VPC Endpoints',
        description: 'Configure VPC endpoints for AWS services',
        type: 'multi-select',
        options: [
          { id: 's3', label: 'S3 Gateway Endpoint', description: 'Free endpoint for S3', recommended: true },
          { id: 'dynamodb', label: 'DynamoDB Gateway Endpoint', description: 'Free endpoint for DynamoDB' },
          { id: 'ecr', label: 'ECR Interface Endpoints', description: 'For container workloads' },
          { id: 'secretsmanager', label: 'Secrets Manager Endpoint', description: 'For secrets access' },
        ],
        canSkip: true,
      },
      {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review your VPC configuration',
        type: 'review',
        canSkip: false,
      },
    ],
  },
  {
    id: 'monitoring-setup',
    type: 'monitoring-setup',
    name: 'Monitoring & Alerting Setup',
    description: 'Set up comprehensive monitoring with CloudWatch dashboards and alarms',
    category: 'monitoring',
    complexity: 'beginner',
    estimatedTimeMinutes: 15,
    tags: ['monitoring', 'cloudwatch', 'alarms', 'dashboards'],
    useCases: ['Application monitoring', 'Infrastructure monitoring', 'Alerting'],
    stepDefinitions: [
      {
        id: 'resource-selection',
        title: 'Resources to Monitor',
        description: 'Select the resource types to monitor',
        type: 'multi-select',
        options: [
          { id: 'ec2', label: 'EC2 Instances', description: 'CPU, memory, disk, network', recommended: true },
          { id: 'rds', label: 'RDS Databases', description: 'Connections, storage, CPU', recommended: true },
          { id: 'lambda', label: 'Lambda Functions', description: 'Invocations, errors, duration' },
          { id: 'ecs', label: 'ECS Services', description: 'CPU, memory, task count' },
          { id: 'alb', label: 'Load Balancers', description: 'Requests, latency, errors' },
        ],
        canSkip: false,
      },
      {
        id: 'alarm-config',
        title: 'Alarm Configuration',
        description: 'Configure alarm thresholds',
        type: 'choice',
        options: [
          { id: 'conservative', label: 'Conservative', description: 'Higher thresholds, fewer alerts' },
          { id: 'balanced', label: 'Balanced', description: 'Standard thresholds', recommended: true },
          { id: 'aggressive', label: 'Aggressive', description: 'Lower thresholds, more alerts' },
        ],
        canSkip: false,
      },
      {
        id: 'notification-config',
        title: 'Notifications',
        description: 'Configure alert notifications',
        type: 'multi-select',
        options: [
          { id: 'email', label: 'Email', description: 'Send alerts via email', recommended: true },
          { id: 'sns', label: 'SNS Topic', description: 'Publish to SNS topic' },
          { id: 'slack', label: 'Slack', description: 'Send to Slack channel' },
          { id: 'pagerduty', label: 'PagerDuty', description: 'PagerDuty integration' },
        ],
        canSkip: false,
      },
      {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review your monitoring configuration',
        type: 'review',
        canSkip: false,
      },
    ],
  },
  {
    id: 'database-setup',
    type: 'database-setup',
    name: 'Database Setup',
    description: 'Set up a managed database with RDS or Aurora',
    category: 'database',
    complexity: 'beginner',
    estimatedTimeMinutes: 15,
    tags: ['database', 'rds', 'aurora', 'postgresql', 'mysql'],
    useCases: ['Application databases', 'Data storage', 'Relational data'],
    stepDefinitions: [
      {
        id: 'engine-config',
        title: 'Database Engine',
        description: 'Select your database engine',
        type: 'choice',
        options: [
          { id: 'postgres', label: 'PostgreSQL', description: 'Open-source, feature-rich', recommended: true },
          { id: 'mysql', label: 'MySQL', description: 'Popular open-source database' },
          { id: 'aurora-postgres', label: 'Aurora PostgreSQL', description: 'High-performance Aurora' },
          { id: 'aurora-mysql', label: 'Aurora MySQL', description: 'High-performance Aurora' },
        ],
        canSkip: false,
      },
      {
        id: 'size-config',
        title: 'Instance Size',
        description: 'Select the database instance size',
        type: 'choice',
        options: [
          { id: 'small', label: 'db.t3.small', description: '2 vCPU, 2 GB RAM', value: 'db.t3.small' },
          { id: 'medium', label: 'db.t3.medium', description: '2 vCPU, 4 GB RAM', value: 'db.t3.medium', recommended: true },
          { id: 'large', label: 'db.r5.large', description: '2 vCPU, 16 GB RAM', value: 'db.r5.large' },
        ],
        canSkip: false,
      },
      {
        id: 'ha-config',
        title: 'High Availability',
        description: 'Configure high availability options',
        type: 'choice',
        options: [
          { id: 'single', label: 'Single AZ', description: 'Lower cost, no failover' },
          { id: 'multi-az', label: 'Multi-AZ', description: 'Automatic failover', recommended: true },
          { id: 'read-replica', label: 'Multi-AZ + Read Replica', description: 'HA with read scaling' },
        ],
        canSkip: false,
      },
      {
        id: 'backup-config',
        title: 'Backup Configuration',
        description: 'Configure automated backups',
        type: 'choice',
        options: [
          { id: '7days', label: '7 days retention', description: 'Standard backup window', value: 7 },
          { id: '14days', label: '14 days retention', description: 'Extended retention', value: 14, recommended: true },
          { id: '35days', label: '35 days retention', description: 'Maximum retention', value: 35 },
        ],
        canSkip: false,
      },
      {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review your database configuration',
        type: 'review',
        canSkip: false,
      },
    ],
  },
];

// =============================================================================
// Predefined Insight Checks
// =============================================================================

/**
 * Predefined insight checks for proactive monitoring
 */
export const INSIGHT_CHECKS: InsightCheckConfig[] = [
  // Cost insights
  {
    id: 'unused-ebs-volumes',
    name: 'Unused EBS Volumes',
    category: 'cost',
    enabled: true,
    intervalMinutes: 60,
    thresholds: { daysUnattached: 7 },
  },
  {
    id: 'unused-elastic-ips',
    name: 'Unused Elastic IPs',
    category: 'cost',
    enabled: true,
    intervalMinutes: 60,
  },
  {
    id: 'idle-rds-instances',
    name: 'Idle RDS Instances',
    category: 'cost',
    enabled: true,
    intervalMinutes: 360,
    thresholds: { connectionThreshold: 5, daysIdle: 7 },
  },
  {
    id: 'underutilized-ec2',
    name: 'Underutilized EC2 Instances',
    category: 'cost',
    enabled: true,
    intervalMinutes: 360,
    thresholds: { cpuThreshold: 10, daysUnderutilized: 14 },
  },
  {
    id: 'old-snapshots',
    name: 'Old EBS Snapshots',
    category: 'cost',
    enabled: true,
    intervalMinutes: 1440,
    thresholds: { daysOld: 90 },
  },
  {
    id: 'unattached-load-balancers',
    name: 'Unattached Load Balancers',
    category: 'cost',
    enabled: true,
    intervalMinutes: 360,
  },

  // Security insights
  {
    id: 'public-s3-buckets',
    name: 'Public S3 Buckets',
    category: 'security',
    enabled: true,
    intervalMinutes: 60,
  },
  {
    id: 'open-security-groups',
    name: 'Overly Permissive Security Groups',
    category: 'security',
    enabled: true,
    intervalMinutes: 60,
  },
  {
    id: 'root-access-keys',
    name: 'Root Account Access Keys',
    category: 'security',
    enabled: true,
    intervalMinutes: 1440,
  },
  {
    id: 'iam-users-without-mfa',
    name: 'IAM Users Without MFA',
    category: 'security',
    enabled: true,
    intervalMinutes: 1440,
  },
  {
    id: 'old-access-keys',
    name: 'Old IAM Access Keys',
    category: 'security',
    enabled: true,
    intervalMinutes: 1440,
    thresholds: { daysOld: 90 },
  },
  {
    id: 'unencrypted-volumes',
    name: 'Unencrypted EBS Volumes',
    category: 'security',
    enabled: true,
    intervalMinutes: 1440,
  },

  // Performance insights
  {
    id: 'high-cpu-instances',
    name: 'High CPU Utilization',
    category: 'performance',
    enabled: true,
    intervalMinutes: 15,
    thresholds: { cpuThreshold: 80, durationMinutes: 30 },
  },
  {
    id: 'high-memory-instances',
    name: 'High Memory Utilization',
    category: 'performance',
    enabled: true,
    intervalMinutes: 15,
    thresholds: { memoryThreshold: 85 },
  },
  {
    id: 'lambda-throttling',
    name: 'Lambda Function Throttling',
    category: 'performance',
    enabled: true,
    intervalMinutes: 15,
  },
  {
    id: 'lambda-errors',
    name: 'Lambda Function Errors',
    category: 'performance',
    enabled: true,
    intervalMinutes: 15,
    thresholds: { errorRateThreshold: 5 },
  },
  {
    id: 'rds-storage-capacity',
    name: 'RDS Storage Capacity',
    category: 'capacity',
    enabled: true,
    intervalMinutes: 60,
    thresholds: { usageThreshold: 85 },
  },

  // Reliability insights
  {
    id: 'single-az-databases',
    name: 'Single-AZ RDS Databases',
    category: 'reliability',
    enabled: true,
    intervalMinutes: 1440,
  },
  {
    id: 'no-backup-databases',
    name: 'RDS Without Automated Backups',
    category: 'reliability',
    enabled: true,
    intervalMinutes: 1440,
  },
  {
    id: 'expired-certificates',
    name: 'Expiring SSL Certificates',
    category: 'reliability',
    enabled: true,
    intervalMinutes: 1440,
    thresholds: { daysUntilExpiry: 30 },
  },

  // Operational insights
  {
    id: 'pending-maintenance',
    name: 'Pending Maintenance Windows',
    category: 'operational',
    enabled: true,
    intervalMinutes: 1440,
  },
  {
    id: 'outdated-amis',
    name: 'Outdated EC2 AMIs',
    category: 'operational',
    enabled: true,
    intervalMinutes: 1440,
    thresholds: { daysOld: 180 },
  },
];

// =============================================================================
// Query Patterns
// =============================================================================

/**
 * Predefined query patterns for natural language processing
 */
export const QUERY_PATTERNS: QueryPattern[] = [
  // List queries
  {
    id: 'list-all-resources',
    name: 'List all resources',
    patterns: ['show me all', 'list all', 'what.*resources', 'show.*everything'],
    intent: 'list',
    examples: ['Show me all resources', 'List all my AWS resources', 'What resources do I have?'],
  },
  {
    id: 'list-by-type',
    name: 'List by resource type',
    patterns: ['list.*instances', 'show.*buckets', 'list.*functions', 'show.*databases'],
    intent: 'list',
    examples: ['List all EC2 instances', 'Show me my S3 buckets', 'List Lambda functions'],
  },
  {
    id: 'list-by-tag',
    name: 'List by tag',
    patterns: ['tagged with', 'with tag', 'where tag', 'resources.*tag'],
    intent: 'filter',
    examples: ['Show resources tagged with project=alpha', 'List instances with Environment=production'],
  },

  // Find queries
  {
    id: 'find-by-name',
    name: 'Find by name',
    patterns: ['find.*named', 'search.*called', 'where.*name'],
    intent: 'find',
    examples: ['Find the instance named web-server', 'Search for bucket called logs'],
  },
  {
    id: 'find-created-recently',
    name: 'Find recently created',
    patterns: ['created.*last', 'new.*resources', 'recently created', 'created today'],
    intent: 'find',
    examples: ['Find resources created in the last 24 hours', 'Show recently created instances'],
  },

  // Count queries
  {
    id: 'count-resources',
    name: 'Count resources',
    patterns: ['how many', 'count.*resources', 'total number'],
    intent: 'count',
    examples: ['How many EC2 instances do I have?', 'Count running Lambda functions'],
  },

  // Environment queries
  {
    id: 'production-resources',
    name: 'Production resources',
    patterns: ['production', 'in prod', 'prod.*resources'],
    intent: 'filter',
    defaultResourceTypes: ['ec2:instance', 'rds:instance', 'lambda:function'],
    examples: ["What's running in production?", 'Show production instances'],
  },
  {
    id: 'development-resources',
    name: 'Development resources',
    patterns: ['development', 'in dev', 'dev.*resources', 'sandbox'],
    intent: 'filter',
    examples: ['Show development resources', 'List dev instances'],
  },

  // Region queries
  {
    id: 'resources-in-region',
    name: 'Resources in region',
    patterns: ['in us-east-1', 'in eu-west-1', 'in.*region'],
    intent: 'filter',
    examples: ['Show resources in us-east-1', 'List instances in eu-west-1'],
  },

  // Cost queries
  {
    id: 'expensive-resources',
    name: 'Expensive resources',
    patterns: ['most expensive', 'highest cost', 'costing.*most'],
    intent: 'analyze',
    examples: ['What are my most expensive resources?', 'Show highest cost instances'],
  },
  {
    id: 'unused-resources',
    name: 'Unused resources',
    patterns: ['unused', 'idle', 'not being used', 'orphaned'],
    intent: 'find',
    examples: ['Find unused resources', 'Show idle instances', 'List orphaned volumes'],
  },

  // Status queries
  {
    id: 'running-resources',
    name: 'Running resources',
    patterns: ['running', 'active', 'online'],
    intent: 'filter',
    examples: ['Show running instances', 'List active services'],
  },
  {
    id: 'stopped-resources',
    name: 'Stopped resources',
    patterns: ['stopped', 'inactive', 'offline'],
    intent: 'filter',
    examples: ['Show stopped instances', 'List inactive resources'],
  },

  // Network queries
  {
    id: 'resources-in-vpc',
    name: 'Resources in VPC',
    patterns: ['in vpc', 'in.*subnet', 'private subnet', 'public subnet'],
    intent: 'filter',
    examples: ['Show resources in the main VPC', 'List instances in private subnets'],
  },
];

// =============================================================================
// Manager Interface
// =============================================================================

/**
 * Conversational UX Manager interface
 */
export interface ConversationalManager {
  // Context management
  getContext(): InfrastructureContext;
  setActiveRegion(region: string): void;
  setActiveAccount(accountId: string): void;
  setEnvironment(environment: EnvironmentType): void;
  addRecentResource(resource: ResourceReference): void;
  pinResource(resource: ResourceReference): void;
  unpinResource(resourceId: string): void;
  addFilter(filter: ResourceFilter): void;
  removeFilter(filterId: string): void;
  clearFilters(): void;
  setVariable(name: string, value: string): void;
  getVariable(name: string): string | undefined;
  clearSession(): void;
  recordOperation(operation: OperationRecord): void;

  // Natural language queries
  parseQuery(query: string): Promise<ConversationalOperationResult<ParsedQuery>>;
  executeQuery(query: string | ParsedQuery): Promise<ConversationalOperationResult<QueryResult>>;
  getSuggestions(partialQuery: string): Promise<ConversationalOperationResult<string[]>>;

  // Proactive insights
  getInsights(options?: GetInsightsOptions): Promise<ConversationalOperationResult<ProactiveInsight[]>>;
  getInsight(insightId: string): Promise<ConversationalOperationResult<ProactiveInsight>>;
  acknowledgeInsight(insightId: string): Promise<ConversationalOperationResult<void>>;
  dismissInsight(insightId: string): Promise<ConversationalOperationResult<void>>;
  snoozeInsight(insightId: string, untilDate: Date): Promise<ConversationalOperationResult<void>>;
  resolveInsight(insightId: string): Promise<ConversationalOperationResult<void>>;
  runInsightChecks(checkIds?: string[]): Promise<ConversationalOperationResult<ProactiveInsight[]>>;
  getInsightChecks(): Promise<ConversationalOperationResult<InsightCheckConfig[]>>;
  updateInsightCheck(checkId: string, enabled: boolean): Promise<ConversationalOperationResult<void>>;

  // Wizard mode
  getWizardTemplates(): Promise<ConversationalOperationResult<WizardTemplate[]>>;
  getWizardTemplate(templateId: string): Promise<ConversationalOperationResult<WizardTemplate>>;
  startWizard(templateId: string): Promise<ConversationalOperationResult<WizardState>>;
  getWizardState(wizardId: string): Promise<ConversationalOperationResult<WizardState>>;
  answerWizardStep(wizardId: string, stepId: string, value: unknown): Promise<ConversationalOperationResult<WizardState>>;
  goBackWizard(wizardId: string): Promise<ConversationalOperationResult<WizardState>>;
  skipWizardStep(wizardId: string): Promise<ConversationalOperationResult<WizardState>>;
  cancelWizard(wizardId: string): Promise<ConversationalOperationResult<void>>;
  generateWizardPlan(wizardId: string): Promise<ConversationalOperationResult<WizardExecutionPlan>>;
  executeWizard(wizardId: string, dryRun?: boolean): Promise<ConversationalOperationResult<WizardState>>;

  // Summary and reporting
  getInfrastructureSummary(): Promise<ConversationalOperationResult<InfrastructureSummary>>;
  getSessionSummary(): Promise<ConversationalOperationResult<SessionSummary>>;
}

/**
 * Options for getting insights
 */
export interface GetInsightsOptions {
  /** Filter by category */
  category?: InsightCategory;
  /** Filter by severity */
  severity?: InsightSeverity;
  /** Filter by status */
  status?: InsightStatus;
  /** Maximum results */
  limit?: number;
  /** Include dismissed */
  includeDismissed?: boolean;
}

/**
 * Infrastructure summary
 */
export interface InfrastructureSummary {
  /** Total resource count by type */
  resourceCounts: Record<TrackedResourceType, number>;
  /** Resources by region */
  resourcesByRegion: Record<string, number>;
  /** Resources by environment */
  resourcesByEnvironment: Record<EnvironmentType, number>;
  /** Active alarms */
  activeAlarms: number;
  /** Pending insights */
  pendingInsights: number;
  /** Estimated monthly cost */
  estimatedMonthlyCost?: number;
  /** Health status */
  overallHealth: 'healthy' | 'warning' | 'critical';
  /** Last updated */
  lastUpdated: Date;
}

/**
 * Session summary
 */
export interface SessionSummary {
  /** Session duration */
  durationMinutes: number;
  /** Operations performed */
  operationCount: number;
  /** Operations by service */
  operationsByService: Record<string, number>;
  /** Success rate */
  successRate: number;
  /** Resources accessed */
  resourcesAccessed: number;
  /** Most accessed resources */
  topResources: ResourceReference[];
  /** Recent operations */
  recentOperations: OperationRecord[];
}
