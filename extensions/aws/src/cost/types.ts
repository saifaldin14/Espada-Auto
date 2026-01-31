/**
 * AWS Cost Management Types
 *
 * Type definitions for Cost Explorer, Budgets, Compute Optimizer,
 * and resource scheduling operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Time granularity for cost data
 */
export type CostGranularity = 'DAILY' | 'MONTHLY' | 'HOURLY';

/**
 * Cost grouping dimensions
 */
export type CostDimension =
  | 'SERVICE'
  | 'LINKED_ACCOUNT'
  | 'REGION'
  | 'INSTANCE_TYPE'
  | 'USAGE_TYPE'
  | 'OPERATION'
  | 'PURCHASE_TYPE'
  | 'PLATFORM'
  | 'TENANCY'
  | 'RECORD_TYPE'
  | 'LEGAL_ENTITY_NAME'
  | 'INVOICING_ENTITY'
  | 'DEPLOYMENT_OPTION'
  | 'DATABASE_ENGINE'
  | 'CACHE_ENGINE'
  | 'INSTANCE_TYPE_FAMILY'
  | 'BILLING_ENTITY'
  | 'RESERVATION_ID'
  | 'SAVINGS_PLANS_TYPE'
  | 'SAVINGS_PLAN_ARN'
  | 'OPERATING_SYSTEM';

/**
 * Cost metric types
 */
export type CostMetric =
  | 'BlendedCost'
  | 'UnblendedCost'
  | 'AmortizedCost'
  | 'NetAmortizedCost'
  | 'NetUnblendedCost'
  | 'UsageQuantity'
  | 'NormalizedUsageAmount';

/**
 * Resource types for unused resource detection
 */
export type UnusedResourceType =
  | 'ebs_volume'
  | 'eip'
  | 'snapshot'
  | 'ami'
  | 'load_balancer'
  | 'nat_gateway'
  | 'rds_snapshot'
  | 'elastic_ip'
  | 'ec2_instance'
  | 'lambda_function';

/**
 * Recommendation types
 */
export type RecommendationType =
  | 'rightsizing'
  | 'reserved_instances'
  | 'savings_plans'
  | 'idle_resources'
  | 'scheduling';

/**
 * Schedule action types
 */
export type ScheduleAction = 'start' | 'stop';

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Cost Manager configuration
 */
export interface CostManagerConfig {
  /** Default region for API calls */
  defaultRegion?: string;
  /** Default cost metric to use */
  defaultMetric?: CostMetric;
  /** Default granularity for cost queries */
  defaultGranularity?: CostGranularity;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

// =============================================================================
// Cost Query Types
// =============================================================================

/**
 * Time period for cost queries
 */
export interface TimePeriod {
  /** Start date (YYYY-MM-DD) */
  start: string;
  /** End date (YYYY-MM-DD) */
  end: string;
}

/**
 * Cost filter expression
 */
export interface CostFilter {
  /** Dimension to filter on */
  dimension?: CostDimension;
  /** Values to filter by */
  values?: string[];
  /** Tag key to filter by */
  tagKey?: string;
  /** Tag values to filter by */
  tagValues?: string[];
  /** Cost category name */
  costCategory?: string;
  /** Cost category values */
  costCategoryValues?: string[];
}

/**
 * Options for getting cost summary
 */
export interface GetCostSummaryOptions {
  /** Time period for cost data */
  timePeriod: TimePeriod;
  /** Granularity of results */
  granularity?: CostGranularity;
  /** Group by dimensions */
  groupBy?: Array<{
    type: 'DIMENSION' | 'TAG' | 'COST_CATEGORY';
    key: CostDimension | string;
  }>;
  /** Filter expression */
  filter?: CostFilter;
  /** Metrics to retrieve */
  metrics?: CostMetric[];
  /** Region for the query */
  region?: string;
}

/**
 * Cost data point
 */
export interface CostDataPoint {
  /** Time period start */
  start: string;
  /** Time period end */
  end: string;
  /** Cost amount */
  amount: number;
  /** Currency */
  currency: string;
  /** Cost metric used */
  metric: CostMetric;
  /** Estimated flag */
  estimated: boolean;
}

/**
 * Grouped cost data
 */
export interface GroupedCostData {
  /** Group key (service name, account id, etc.) */
  key: string;
  /** Group type */
  type: string;
  /** Cost data points */
  costs: CostDataPoint[];
  /** Total cost for the period */
  total: number;
  /** Currency */
  currency: string;
}

/**
 * Cost summary result
 */
export interface CostSummaryResult {
  /** Total cost for the period */
  totalCost: number;
  /** Currency */
  currency: string;
  /** Time period */
  timePeriod: TimePeriod;
  /** Granularity used */
  granularity: CostGranularity;
  /** Grouped costs (if groupBy was specified) */
  groups?: GroupedCostData[];
  /** Daily/monthly breakdown */
  breakdown?: CostDataPoint[];
  /** Top services by cost */
  topServices?: Array<{
    service: string;
    cost: number;
    percentage: number;
  }>;
}

// =============================================================================
// Forecast Types
// =============================================================================

/**
 * Options for cost forecasting
 */
export interface ForecastCostOptions {
  /** Start date for forecast */
  startDate: string;
  /** End date for forecast */
  endDate: string;
  /** Granularity */
  granularity?: CostGranularity;
  /** Metric to forecast */
  metric?: CostMetric;
  /** Prediction interval level (51-99) */
  predictionIntervalLevel?: number;
  /** Filter expression */
  filter?: CostFilter;
  /** Region */
  region?: string;
}

/**
 * Cost forecast result
 */
export interface CostForecastResult {
  /** Forecasted total cost */
  forecastedTotal: number;
  /** Currency */
  currency: string;
  /** Time period */
  timePeriod: TimePeriod;
  /** Confidence interval lower bound */
  lowerBound?: number;
  /** Confidence interval upper bound */
  upperBound?: number;
  /** Prediction interval level used */
  predictionIntervalLevel: number;
  /** Daily/monthly forecast breakdown */
  breakdown?: Array<{
    start: string;
    end: string;
    meanValue: number;
    lowerBound?: number;
    upperBound?: number;
  }>;
  /** Comparison with previous period */
  comparison?: {
    previousPeriodCost: number;
    percentageChange: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
}

// =============================================================================
// Optimization Recommendation Types
// =============================================================================

/**
 * Options for getting optimization recommendations
 */
export interface GetOptimizationRecommendationsOptions {
  /** Types of recommendations to get */
  types?: RecommendationType[];
  /** Filter by service */
  service?: string;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Minimum monthly savings threshold */
  minMonthlySavings?: number;
  /** Region */
  region?: string;
}

/**
 * Rightsizing recommendation
 */
export interface RightsizingRecommendation {
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: string;
  /** Current instance type */
  currentInstanceType: string;
  /** Recommended instance type */
  recommendedInstanceType: string;
  /** Current monthly cost */
  currentMonthlyCost: number;
  /** Estimated monthly cost after change */
  estimatedMonthlyCost: number;
  /** Estimated monthly savings */
  estimatedMonthlySavings: number;
  /** Savings percentage */
  savingsPercentage: number;
  /** CPU utilization (average) */
  cpuUtilization?: number;
  /** Memory utilization (average) */
  memoryUtilization?: number;
  /** Recommendation reason */
  reason: string;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** Region */
  region: string;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Reserved Instance recommendation
 */
export interface ReservedInstanceRecommendation {
  /** Service (EC2, RDS, etc.) */
  service: string;
  /** Instance type family */
  instanceTypeFamily: string;
  /** Instance type */
  instanceType?: string;
  /** Region */
  region: string;
  /** Platform/OS */
  platform?: string;
  /** Tenancy */
  tenancy?: string;
  /** Term (1 year, 3 years) */
  term: '1_YEAR' | '3_YEAR';
  /** Payment option */
  paymentOption: 'NO_UPFRONT' | 'PARTIAL_UPFRONT' | 'ALL_UPFRONT';
  /** Recommended quantity */
  recommendedQuantity: number;
  /** Current on-demand cost */
  currentOnDemandCost: number;
  /** Estimated RI cost */
  estimatedRICost: number;
  /** Upfront cost */
  upfrontCost: number;
  /** Recurring monthly cost */
  recurringMonthlyCost: number;
  /** Estimated monthly savings */
  estimatedMonthlySavings: number;
  /** Savings percentage */
  savingsPercentage: number;
  /** Break-even months */
  breakEvenMonths: number;
}

/**
 * Savings Plan recommendation
 */
export interface SavingsPlanRecommendation {
  /** Savings Plan type */
  savingsPlanType: 'COMPUTE' | 'EC2_INSTANCE' | 'SAGEMAKER';
  /** Term */
  term: '1_YEAR' | '3_YEAR';
  /** Payment option */
  paymentOption: 'NO_UPFRONT' | 'PARTIAL_UPFRONT' | 'ALL_UPFRONT';
  /** Hourly commitment */
  hourlyCommitment: number;
  /** Upfront cost */
  upfrontCost: number;
  /** Current on-demand spend */
  currentOnDemandSpend: number;
  /** Estimated Savings Plan spend */
  estimatedSPSpend: number;
  /** Estimated monthly savings */
  estimatedMonthlySavings: number;
  /** Savings percentage */
  savingsPercentage: number;
  /** Coverage percentage */
  coveragePercentage: number;
}

/**
 * Combined optimization recommendations result
 */
export interface OptimizationRecommendationsResult {
  /** Rightsizing recommendations */
  rightsizing: RightsizingRecommendation[];
  /** Reserved Instance recommendations */
  reservedInstances: ReservedInstanceRecommendation[];
  /** Savings Plan recommendations */
  savingsPlans: SavingsPlanRecommendation[];
  /** Total potential monthly savings */
  totalPotentialMonthlySavings: number;
  /** Currency */
  currency: string;
  /** Summary by recommendation type */
  summary: {
    rightsizingCount: number;
    rightsizingSavings: number;
    reservedInstancesCount: number;
    reservedInstancesSavings: number;
    savingsPlansCount: number;
    savingsPlansSavings: number;
  };
}

// =============================================================================
// Unused Resources Types
// =============================================================================

/**
 * Options for finding unused resources
 */
export interface FindUnusedResourcesOptions {
  /** Resource types to check */
  resourceTypes?: UnusedResourceType[];
  /** Minimum age in days to consider unused */
  minAgeDays?: number;
  /** Include cost estimates */
  includeCostEstimates?: boolean;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region (or 'all' for all regions) */
  region?: string;
}

/**
 * Unused resource information
 */
export interface UnusedResource {
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: UnusedResourceType;
  /** Resource ARN */
  arn?: string;
  /** Region */
  region: string;
  /** Creation date */
  createdAt?: Date;
  /** Last used date */
  lastUsedAt?: Date;
  /** Days unused */
  daysUnused: number;
  /** Estimated monthly cost */
  estimatedMonthlyCost?: number;
  /** Size (for volumes/snapshots) */
  size?: number;
  /** Size unit */
  sizeUnit?: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Reason for being flagged */
  reason: string;
  /** Recommended action */
  recommendedAction: string;
}

/**
 * Unused resources result
 */
export interface UnusedResourcesResult {
  /** Unused resources */
  resources: UnusedResource[];
  /** Total count */
  totalCount: number;
  /** Total estimated monthly cost */
  totalEstimatedMonthlyCost: number;
  /** Currency */
  currency: string;
  /** Breakdown by resource type */
  byType: Record<UnusedResourceType, {
    count: number;
    estimatedMonthlyCost: number;
  }>;
  /** Breakdown by region */
  byRegion: Record<string, {
    count: number;
    estimatedMonthlyCost: number;
  }>;
}

// =============================================================================
// Resource Scheduling Types
// =============================================================================

/**
 * Schedule definition
 */
export interface ResourceSchedule {
  /** Schedule name */
  name: string;
  /** Description */
  description?: string;
  /** Cron expression for start */
  startCron?: string;
  /** Cron expression for stop */
  stopCron?: string;
  /** Timezone */
  timezone: string;
  /** Days of week (0-6, Sunday = 0) */
  daysOfWeek?: number[];
  /** Enabled flag */
  enabled: boolean;
}

/**
 * Options for scheduling resources
 */
export interface ScheduleResourcesOptions {
  /** Resource IDs to schedule */
  resourceIds: string[];
  /** Resource type */
  resourceType: 'ec2' | 'rds' | 'asg';
  /** Schedule to apply */
  schedule: ResourceSchedule;
  /** Tags to apply to scheduled resources */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Scheduled resource info
 */
export interface ScheduledResource {
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: string;
  /** Schedule name */
  scheduleName: string;
  /** Next start time */
  nextStartTime?: Date;
  /** Next stop time */
  nextStopTime?: Date;
  /** Current state */
  currentState: string;
  /** Estimated monthly savings */
  estimatedMonthlySavings?: number;
}

/**
 * Schedule resources result
 */
export interface ScheduleResourcesResult {
  /** Success flag */
  success: boolean;
  /** Scheduled resources */
  scheduledResources: ScheduledResource[];
  /** Failed resources */
  failedResources: Array<{
    resourceId: string;
    error: string;
  }>;
  /** Total estimated monthly savings */
  totalEstimatedMonthlySavings: number;
  /** Message */
  message: string;
}

// =============================================================================
// Budget Types
// =============================================================================

/**
 * Budget type
 */
export type BudgetType = 'COST' | 'USAGE' | 'RI_UTILIZATION' | 'RI_COVERAGE' | 'SAVINGS_PLANS_UTILIZATION' | 'SAVINGS_PLANS_COVERAGE';

/**
 * Budget time unit
 */
export type BudgetTimeUnit = 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

/**
 * Alert threshold type
 */
export type AlertThresholdType = 'PERCENTAGE' | 'ABSOLUTE_VALUE';

/**
 * Alert notification type
 */
export type AlertNotificationType = 'ACTUAL' | 'FORECASTED';

/**
 * Budget alert configuration
 */
export interface BudgetAlert {
  /** Threshold value */
  threshold: number;
  /** Threshold type */
  thresholdType: AlertThresholdType;
  /** Notification type */
  notificationType: AlertNotificationType;
  /** Comparison operator */
  comparisonOperator: 'GREATER_THAN' | 'LESS_THAN' | 'EQUAL_TO';
  /** Email addresses to notify */
  emailAddresses?: string[];
  /** SNS topic ARN */
  snsTopicArn?: string;
}

/**
 * Options for creating a budget
 */
export interface CreateBudgetOptions {
  /** Budget name */
  name: string;
  /** Budget type */
  budgetType: BudgetType;
  /** Budget limit amount */
  limitAmount: number;
  /** Currency */
  currency?: string;
  /** Time unit */
  timeUnit: BudgetTimeUnit;
  /** Start date */
  startDate?: string;
  /** End date */
  endDate?: string;
  /** Cost filters */
  costFilters?: Record<string, string[]>;
  /** Alerts */
  alerts?: BudgetAlert[];
  /** Region */
  region?: string;
}

/**
 * Budget information
 */
export interface BudgetInfo {
  /** Budget name */
  name: string;
  /** Budget type */
  budgetType: BudgetType;
  /** Budget limit */
  limitAmount: number;
  /** Currency */
  currency: string;
  /** Time unit */
  timeUnit: BudgetTimeUnit;
  /** Current spend */
  actualSpend: number;
  /** Forecasted spend */
  forecastedSpend?: number;
  /** Percentage used */
  percentageUsed: number;
  /** Start date */
  startDate?: string;
  /** End date */
  endDate?: string;
  /** Last updated */
  lastUpdated?: Date;
  /** Alerts */
  alerts: BudgetAlert[];
  /** Status */
  status: 'OK' | 'WARNING' | 'CRITICAL';
}

/**
 * Create budget result
 */
export interface CreateBudgetResult {
  /** Success flag */
  success: boolean;
  /** Budget info */
  budget?: BudgetInfo;
  /** Error message */
  error?: string;
  /** Message */
  message: string;
}

/**
 * List budgets result
 */
export interface ListBudgetsResult {
  /** Budgets */
  budgets: BudgetInfo[];
  /** Total count */
  totalCount: number;
}

// =============================================================================
// Operation Result Types
// =============================================================================

/**
 * Generic cost operation result
 */
export interface CostOperationResult<T = unknown> {
  /** Success flag */
  success: boolean;
  /** Data */
  data?: T;
  /** Message */
  message: string;
  /** Error */
  error?: string;
  /** Warnings */
  warnings?: string[];
}
