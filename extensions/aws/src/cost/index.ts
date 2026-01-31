/**
 * AWS Cost Management Module
 *
 * Exports for cost analysis, forecasting, optimization recommendations,
 * unused resource detection, resource scheduling, and budget management.
 */

export { CostManager, createCostManager } from './manager.js';

export type {
  // Configuration
  CostManagerConfig,

  // Common Types
  CostGranularity,
  CostDimension,
  CostMetric,
  UnusedResourceType,
  RecommendationType,
  ScheduleAction,

  // Time Period
  TimePeriod,

  // Cost Summary
  CostFilter,
  GetCostSummaryOptions,
  CostSummaryResult,
  CostDataPoint,
  GroupedCostData,

  // Forecasting
  ForecastCostOptions,
  CostForecastResult,

  // Optimization
  GetOptimizationRecommendationsOptions,
  OptimizationRecommendationsResult,
  RightsizingRecommendation,
  ReservedInstanceRecommendation,
  SavingsPlanRecommendation,

  // Unused Resources
  FindUnusedResourcesOptions,
  UnusedResourcesResult,
  UnusedResource,

  // Resource Scheduling
  ResourceSchedule,
  ScheduleResourcesOptions,
  ScheduleResourcesResult,
  ScheduledResource,

  // Budget Management
  BudgetType,
  BudgetTimeUnit,
  AlertThresholdType,
  AlertNotificationType,
  BudgetAlert,
  CreateBudgetOptions,
  CreateBudgetResult,
  BudgetInfo,
  ListBudgetsResult,

  // Generic Result
  CostOperationResult,
} from './types.js';
