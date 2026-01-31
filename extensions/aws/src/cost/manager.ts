/**
 * AWS Cost Manager
 *
 * Provides cost analysis, forecasting, optimization recommendations,
 * unused resource detection, resource scheduling, and budget management.
 */

import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
  GetRightsizingRecommendationCommand,
  GetReservationPurchaseRecommendationCommand,
  GetSavingsPlansPurchaseRecommendationCommand,
  type Expression,
  type GroupDefinition,
  type GetCostAndUsageCommandInput,
  type GetCostForecastCommandInput,
  type GetRightsizingRecommendationCommandInput,
  type GetReservationPurchaseRecommendationCommandInput,
  type GetSavingsPlansPurchaseRecommendationCommandInput,
} from '@aws-sdk/client-cost-explorer';

import {
  BudgetsClient,
  CreateBudgetCommand,
  DescribeBudgetsCommand,
  DeleteBudgetCommand,
  type Budget,
  type NotificationWithSubscribers,
  type CreateBudgetCommandInput,
} from '@aws-sdk/client-budgets';

import {
  EC2Client,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
  DescribeSnapshotsCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  CreateTagsCommand,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';

import {
  RDSClient,
  DescribeDBSnapshotsCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
} from '@aws-sdk/client-rds';

import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';

import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
} from '@aws-sdk/client-lambda';

import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';

import {
  STSClient,
  GetCallerIdentityCommand,
} from '@aws-sdk/client-sts';

import type {
  CostManagerConfig,
  GetCostSummaryOptions,
  CostSummaryResult,
  CostDataPoint,
  GroupedCostData,
  ForecastCostOptions,
  CostForecastResult,
  GetOptimizationRecommendationsOptions,
  OptimizationRecommendationsResult,
  RightsizingRecommendation,
  ReservedInstanceRecommendation,
  SavingsPlanRecommendation,
  FindUnusedResourcesOptions,
  UnusedResourcesResult,
  UnusedResource,
  UnusedResourceType,
  ScheduleResourcesOptions,
  ScheduleResourcesResult,
  ScheduledResource,
  CreateBudgetOptions,
  CreateBudgetResult,
  BudgetInfo,
  ListBudgetsResult,
  CostMetric,
  CostGranularity,
  CostOperationResult,
} from './types.js';

/**
 * Creates a CostManager instance
 */
export function createCostManager(config: CostManagerConfig = {}): CostManager {
  return new CostManager(config);
}

/**
 * CostManager class for AWS cost operations
 */
export class CostManager {
  private config: CostManagerConfig;
  private costExplorerClient: CostExplorerClient;
  private budgetsClient: BudgetsClient;
  private stsClient: STSClient;
  private accountId?: string;

  constructor(config: CostManagerConfig = {}) {
    this.config = {
      defaultRegion: config.defaultRegion || 'us-east-1',
      defaultMetric: config.defaultMetric || 'UnblendedCost',
      defaultGranularity: config.defaultGranularity || 'DAILY',
      credentials: config.credentials,
    };

    const clientConfig = {
      region: this.config.defaultRegion,
      credentials: this.config.credentials,
    };

    // Cost Explorer is only available in us-east-1
    this.costExplorerClient = new CostExplorerClient({
      ...clientConfig,
      region: 'us-east-1',
    });

    this.budgetsClient = new BudgetsClient({
      ...clientConfig,
      region: 'us-east-1', // Budgets is also us-east-1 only
    });

    this.stsClient = new STSClient(clientConfig);
  }

  /**
   * Get the AWS account ID
   */
  private async getAccountId(): Promise<string> {
    if (this.accountId) {
      return this.accountId;
    }

    const response = await this.stsClient.send(new GetCallerIdentityCommand({}));
    this.accountId = response.Account!;
    return this.accountId;
  }

  /**
   * Create an EC2 client for a specific region
   */
  private createEC2Client(region: string): EC2Client {
    return new EC2Client({
      region,
      credentials: this.config.credentials,
    });
  }

  /**
   * Create an RDS client for a specific region
   */
  private createRDSClient(region: string): RDSClient {
    return new RDSClient({
      region,
      credentials: this.config.credentials,
    });
  }

  /**
   * Create an ELBv2 client for a specific region
   */
  private createELBClient(region: string): ElasticLoadBalancingV2Client {
    return new ElasticLoadBalancingV2Client({
      region,
      credentials: this.config.credentials,
    });
  }

  /**
   * Create a Lambda client for a specific region
   */
  private createLambdaClient(region: string): LambdaClient {
    return new LambdaClient({
      region,
      credentials: this.config.credentials,
    });
  }

  /**
   * Create a CloudWatch client for a specific region
   */
  private createCloudWatchClient(region: string): CloudWatchClient {
    return new CloudWatchClient({
      region,
      credentials: this.config.credentials,
    });
  }

  // =============================================================================
  // Cost Summary
  // =============================================================================

  /**
   * Get cost summary for a time period
   */
  async getCostSummary(options: GetCostSummaryOptions): Promise<CostOperationResult<CostSummaryResult>> {
    try {
      const granularity = options.granularity || this.config.defaultGranularity!;
      const metrics = options.metrics || [this.config.defaultMetric!];

      const input: GetCostAndUsageCommandInput = {
        TimePeriod: {
          Start: options.timePeriod.start,
          End: options.timePeriod.end,
        },
        Granularity: granularity,
        Metrics: metrics,
      };

      // Add grouping if specified
      if (options.groupBy && options.groupBy.length > 0) {
        input.GroupBy = options.groupBy.map((group): GroupDefinition => ({
          Type: group.type,
          Key: group.key,
        }));
      }

      // Add filter if specified
      if (options.filter) {
        input.Filter = this.buildFilterExpression(options.filter);
      }

      const response = await this.costExplorerClient.send(new GetCostAndUsageCommand(input));

      // Process results
      const metric = metrics[0];
      let totalCost = 0;
      const breakdown: CostDataPoint[] = [];
      const groups: GroupedCostData[] = [];
      const serviceMap = new Map<string, number>();

      for (const result of response.ResultsByTime || []) {
        const start = result.TimePeriod?.Start || '';
        const end = result.TimePeriod?.End || '';
        const estimated = result.Estimated || false;

        if (result.Groups && result.Groups.length > 0) {
          // Grouped results
          for (const group of result.Groups) {
            const key = group.Keys?.[0] || 'Unknown';
            const amount = parseFloat(group.Metrics?.[metric]?.Amount || '0');
            totalCost += amount;

            // Track services
            if (options.groupBy?.[0]?.key === 'SERVICE') {
              serviceMap.set(key, (serviceMap.get(key) || 0) + amount);
            }

            // Find or create group entry
            let groupEntry = groups.find(g => g.key === key);
            if (!groupEntry) {
              groupEntry = {
                key,
                type: options.groupBy?.[0]?.key || 'Unknown',
                costs: [],
                total: 0,
                currency: 'USD',
              };
              groups.push(groupEntry);
            }

            groupEntry.costs.push({
              start,
              end,
              amount,
              currency: 'USD',
              metric: metric as CostMetric,
              estimated,
            });
            groupEntry.total += amount;
          }
        } else if (result.Total) {
          // Non-grouped results
          const amount = parseFloat(result.Total[metric]?.Amount || '0');
          totalCost += amount;

          breakdown.push({
            start,
            end,
            amount,
            currency: 'USD',
            metric: metric as CostMetric,
            estimated,
          });
        }
      }

      // Calculate top services
      const topServices = Array.from(serviceMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([service, cost]) => ({
          service,
          cost,
          percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
        }));

      const result: CostSummaryResult = {
        totalCost,
        currency: 'USD',
        timePeriod: options.timePeriod,
        granularity,
        groups: groups.length > 0 ? groups : undefined,
        breakdown: breakdown.length > 0 ? breakdown : undefined,
        topServices: topServices.length > 0 ? topServices : undefined,
      };

      return {
        success: true,
        data: result,
        message: `Cost summary retrieved: $${totalCost.toFixed(2)} USD`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to retrieve cost summary',
        error: errorMessage,
      };
    }
  }

  // =============================================================================
  // Cost Forecasting
  // =============================================================================

  /**
   * Forecast future costs
   */
  async forecastCosts(options: ForecastCostOptions): Promise<CostOperationResult<CostForecastResult>> {
    try {
      const metric = options.metric || this.config.defaultMetric!;
      const granularity = options.granularity || this.config.defaultGranularity!;
      const predictionIntervalLevel = options.predictionIntervalLevel || 80;

      // Map our metric names to AWS SDK Metric enum values
      const metricMap: Record<string, string> = {
        'BlendedCost': 'BLENDED_COST',
        'UnblendedCost': 'UNBLENDED_COST',
        'AmortizedCost': 'AMORTIZED_COST',
        'NetAmortizedCost': 'NET_AMORTIZED_COST',
        'NetUnblendedCost': 'NET_UNBLENDED_COST',
        'UsageQuantity': 'USAGE_QUANTITY',
        'NormalizedUsageAmount': 'NORMALIZED_USAGE_AMOUNT',
      };

      const input: GetCostForecastCommandInput = {
        TimePeriod: {
          Start: options.startDate,
          End: options.endDate,
        },
        Metric: (metricMap[metric] || 'UNBLENDED_COST') as GetCostForecastCommandInput['Metric'],
        Granularity: granularity,
        PredictionIntervalLevel: predictionIntervalLevel,
      };

      if (options.filter) {
        input.Filter = this.buildFilterExpression(options.filter);
      }

      const response = await this.costExplorerClient.send(new GetCostForecastCommand(input));

      // Process forecast results
      const forecastedTotal = parseFloat(response.Total?.Amount || '0');
      const breakdown = (response.ForecastResultsByTime || []).map(result => ({
        start: result.TimePeriod?.Start || '',
        end: result.TimePeriod?.End || '',
        meanValue: parseFloat(result.MeanValue || '0'),
        lowerBound: result.PredictionIntervalLowerBound
          ? parseFloat(result.PredictionIntervalLowerBound)
          : undefined,
        upperBound: result.PredictionIntervalUpperBound
          ? parseFloat(result.PredictionIntervalUpperBound)
          : undefined,
      }));

      // Get previous period for comparison
      const startDate = new Date(options.startDate);
      const endDate = new Date(options.endDate);
      const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const prevStartDate = new Date(startDate);
      prevStartDate.setDate(prevStartDate.getDate() - periodDays);
      const prevEndDate = new Date(startDate);
      prevEndDate.setDate(prevEndDate.getDate() - 1);

      let comparison: CostForecastResult['comparison'];

      try {
        const prevCostResult = await this.getCostSummary({
          timePeriod: {
            start: prevStartDate.toISOString().split('T')[0],
            end: prevEndDate.toISOString().split('T')[0],
          },
          metrics: [metric as CostMetric],
        });

        if (prevCostResult.success && prevCostResult.data) {
          const previousPeriodCost = prevCostResult.data.totalCost;
          const percentageChange = previousPeriodCost > 0
            ? ((forecastedTotal - previousPeriodCost) / previousPeriodCost) * 100
            : 0;

          comparison = {
            previousPeriodCost,
            percentageChange,
            trend: percentageChange > 5 ? 'increasing' :
                   percentageChange < -5 ? 'decreasing' : 'stable',
          };
        }
      } catch {
        // Comparison is optional, continue without it
      }

      const result: CostForecastResult = {
        forecastedTotal,
        currency: 'USD',
        timePeriod: {
          start: options.startDate,
          end: options.endDate,
        },
        predictionIntervalLevel,
        breakdown: breakdown.length > 0 ? breakdown : undefined,
        comparison,
      };

      return {
        success: true,
        data: result,
        message: `Cost forecast: $${forecastedTotal.toFixed(2)} USD for the period`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to forecast costs',
        error: errorMessage,
      };
    }
  }

  // =============================================================================
  // Optimization Recommendations
  // =============================================================================

  /**
   * Get optimization recommendations
   */
  async getOptimizationRecommendations(
    options: GetOptimizationRecommendationsOptions = {}
  ): Promise<CostOperationResult<OptimizationRecommendationsResult>> {
    try {
      const types = options.types || ['rightsizing', 'reserved_instances', 'savings_plans'];
      const rightsizing: RightsizingRecommendation[] = [];
      const reservedInstances: ReservedInstanceRecommendation[] = [];
      const savingsPlans: SavingsPlanRecommendation[] = [];
      const warnings: string[] = [];

      // Get rightsizing recommendations
      if (types.includes('rightsizing')) {
        try {
          const rsResult = await this.getRightsizingRecommendations(options);
          rightsizing.push(...rsResult);
        } catch (error) {
          warnings.push(`Rightsizing: ${error instanceof Error ? error.message : 'Failed to fetch'}`);
        }
      }

      // Get Reserved Instance recommendations
      if (types.includes('reserved_instances')) {
        try {
          const riResult = await this.getReservedInstanceRecommendations(options);
          reservedInstances.push(...riResult);
        } catch (error) {
          warnings.push(`Reserved Instances: ${error instanceof Error ? error.message : 'Failed to fetch'}`);
        }
      }

      // Get Savings Plan recommendations
      if (types.includes('savings_plans')) {
        try {
          const spResult = await this.getSavingsPlanRecommendations(options);
          savingsPlans.push(...spResult);
        } catch (error) {
          warnings.push(`Savings Plans: ${error instanceof Error ? error.message : 'Failed to fetch'}`);
        }
      }

      // Calculate totals
      const rightsizingSavings = rightsizing.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0);
      const riSavings = reservedInstances.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0);
      const spSavings = savingsPlans.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0);

      const result: OptimizationRecommendationsResult = {
        rightsizing,
        reservedInstances,
        savingsPlans,
        totalPotentialMonthlySavings: rightsizingSavings + riSavings + spSavings,
        currency: 'USD',
        summary: {
          rightsizingCount: rightsizing.length,
          rightsizingSavings,
          reservedInstancesCount: reservedInstances.length,
          reservedInstancesSavings: riSavings,
          savingsPlansCount: savingsPlans.length,
          savingsPlansSavings: spSavings,
        },
      };

      return {
        success: true,
        data: result,
        message: `Found ${rightsizing.length + reservedInstances.length + savingsPlans.length} recommendations with potential savings of $${result.totalPotentialMonthlySavings.toFixed(2)}/month`,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to get optimization recommendations',
        error: errorMessage,
      };
    }
  }

  /**
   * Get rightsizing recommendations
   */
  private async getRightsizingRecommendations(
    options: GetOptimizationRecommendationsOptions
  ): Promise<RightsizingRecommendation[]> {
    const input: GetRightsizingRecommendationCommandInput = {
      Service: options.service || 'AmazonEC2',
      Configuration: {
        RecommendationTarget: 'SAME_INSTANCE_FAMILY',
        BenefitsConsidered: true,
      },
    };

    const response = await this.costExplorerClient.send(
      new GetRightsizingRecommendationCommand(input)
    );

    const recommendations: RightsizingRecommendation[] = [];

    for (const rec of response.RightsizingRecommendations || []) {
      if (!rec.CurrentInstance || !rec.ModifyRecommendationDetail) continue;

      const currentInstance = rec.CurrentInstance;
      const modifyDetail = rec.ModifyRecommendationDetail;
      const targetInstance = modifyDetail.TargetInstances?.[0];

      if (!targetInstance) continue;

      const currentMonthlyCost = parseFloat(
        currentInstance.MonthlyCost || '0'
      );
      const estimatedMonthlyCost = parseFloat(
        targetInstance.EstimatedMonthlyCost || '0'
      );
      const savings = currentMonthlyCost - estimatedMonthlyCost;

      // Apply minimum savings filter
      if (options.minMonthlySavings && savings < options.minMonthlySavings) {
        continue;
      }

      // Extract instance types from ResourceDetails
      const currentInstanceType = currentInstance.ResourceDetails?.EC2ResourceDetails?.InstanceType || 'Unknown';
      const recommendedInstanceType = targetInstance.ResourceDetails?.EC2ResourceDetails?.InstanceType || 'Unknown';

      recommendations.push({
        resourceId: currentInstance.ResourceId || 'Unknown',
        resourceType: 'EC2',
        currentInstanceType,
        recommendedInstanceType,
        currentMonthlyCost,
        estimatedMonthlyCost,
        estimatedMonthlySavings: savings,
        savingsPercentage: currentMonthlyCost > 0 ? (savings / currentMonthlyCost) * 100 : 0,
        cpuUtilization: currentInstance.ResourceUtilization?.EC2ResourceUtilization
          ? parseFloat(currentInstance.ResourceUtilization.EC2ResourceUtilization.MaxCpuUtilizationPercentage || '0')
          : undefined,
        memoryUtilization: currentInstance.ResourceUtilization?.EC2ResourceUtilization
          ? parseFloat(currentInstance.ResourceUtilization.EC2ResourceUtilization.MaxMemoryUtilizationPercentage || '0')
          : undefined,
        reason: `Instance is ${rec.RightsizingType?.toLowerCase() || 'underutilized'}`,
        riskLevel: this.assessRightsizingRisk(
          parseFloat(currentInstance.ResourceUtilization?.EC2ResourceUtilization?.MaxCpuUtilizationPercentage || '50')
        ),
        region: currentInstance.ResourceDetails?.EC2ResourceDetails?.Region || 'Unknown',
        tags: this.parseTags(currentInstance.Tags || []),
      });
    }

    return recommendations;
  }

  /**
   * Get Reserved Instance recommendations
   */
  private async getReservedInstanceRecommendations(
    options: GetOptimizationRecommendationsOptions
  ): Promise<ReservedInstanceRecommendation[]> {
    const input: GetReservationPurchaseRecommendationCommandInput = {
      Service: options.service || 'Amazon Elastic Compute Cloud - Compute',
      LookbackPeriodInDays: 'SIXTY_DAYS',
      TermInYears: 'ONE_YEAR',
      PaymentOption: 'NO_UPFRONT',
    };

    const response = await this.costExplorerClient.send(
      new GetReservationPurchaseRecommendationCommand(input)
    );

    const recommendations: ReservedInstanceRecommendation[] = [];

    for (const rec of response.Recommendations || []) {
      for (const detail of rec.RecommendationDetails || []) {
        const currentOnDemandCost = parseFloat(
          detail.AverageNormalizedUnitsUsedPerHour || '0'
        ) * 730; // Approximate monthly hours
        const estimatedRICost = parseFloat(
          detail.EstimatedMonthlyOnDemandCost || '0'
        );
        const savings = parseFloat(
          detail.EstimatedMonthlySavingsAmount || '0'
        );

        if (options.minMonthlySavings && savings < options.minMonthlySavings) {
          continue;
        }

        const instanceDetails = detail.InstanceDetails?.EC2InstanceDetails;

        recommendations.push({
          service: 'EC2',
          instanceTypeFamily: instanceDetails?.Family || 'Unknown',
          instanceType: instanceDetails?.InstanceType,
          region: instanceDetails?.Region || 'Unknown',
          platform: instanceDetails?.Platform,
          tenancy: instanceDetails?.Tenancy,
          term: '1_YEAR',
          paymentOption: 'NO_UPFRONT',
          recommendedQuantity: parseInt(detail.RecommendedNumberOfInstancesToPurchase || '1', 10),
          currentOnDemandCost,
          estimatedRICost,
          upfrontCost: parseFloat(detail.UpfrontCost || '0'),
          recurringMonthlyCost: parseFloat(detail.RecurringStandardMonthlyCost || '0'),
          estimatedMonthlySavings: savings,
          savingsPercentage: parseFloat(detail.EstimatedMonthlySavingsPercentage || '0'),
          breakEvenMonths: detail.UpfrontCost && savings > 0
            ? Math.ceil(parseFloat(detail.UpfrontCost) / savings)
            : 0,
        });
      }
    }

    return recommendations;
  }

  /**
   * Get Savings Plan recommendations
   */
  private async getSavingsPlanRecommendations(
    options: GetOptimizationRecommendationsOptions
  ): Promise<SavingsPlanRecommendation[]> {
    const input: GetSavingsPlansPurchaseRecommendationCommandInput = {
      SavingsPlansType: 'COMPUTE_SP',
      LookbackPeriodInDays: 'SIXTY_DAYS',
      TermInYears: 'ONE_YEAR',
      PaymentOption: 'NO_UPFRONT',
    };

    const response = await this.costExplorerClient.send(
      new GetSavingsPlansPurchaseRecommendationCommand(input)
    );

    const recommendations: SavingsPlanRecommendation[] = [];
    const recDetails = response.SavingsPlansPurchaseRecommendation?.SavingsPlansPurchaseRecommendationDetails;

    for (const detail of recDetails || []) {
      const savings = parseFloat(detail.EstimatedMonthlySavingsAmount || '0');

      if (options.minMonthlySavings && savings < options.minMonthlySavings) {
        continue;
      }

      recommendations.push({
        savingsPlanType: 'COMPUTE',
        term: '1_YEAR',
        paymentOption: 'NO_UPFRONT',
        hourlyCommitment: parseFloat(detail.HourlyCommitmentToPurchase || '0'),
        upfrontCost: parseFloat(detail.UpfrontCost || '0'),
        currentOnDemandSpend: parseFloat(detail.CurrentAverageHourlyOnDemandSpend || '0') * 730,
        estimatedSPSpend: parseFloat(detail.EstimatedAverageUtilization || '0'),
        estimatedMonthlySavings: savings,
        savingsPercentage: parseFloat(detail.EstimatedSavingsPercentage || '0'),
        coveragePercentage: parseFloat(detail.EstimatedOnDemandCostWithCurrentCommitment || '0'),
      });
    }

    return recommendations;
  }

  // =============================================================================
  // Unused Resources
  // =============================================================================

  /**
   * Find unused resources
   */
  async findUnusedResources(
    options: FindUnusedResourcesOptions = {}
  ): Promise<CostOperationResult<UnusedResourcesResult>> {
    try {
      const resourceTypes = options.resourceTypes || [
        'ebs_volume',
        'eip',
        'snapshot',
        'load_balancer',
      ];
      const region = options.region || this.config.defaultRegion!;
      const minAgeDays = options.minAgeDays || 30;
      const resources: UnusedResource[] = [];
      const warnings: string[] = [];

      const regions = region === 'all'
        ? await this.getActiveRegions()
        : [region];

      for (const r of regions) {
        // Find unused EBS volumes
        if (resourceTypes.includes('ebs_volume')) {
          try {
            const volumes = await this.findUnusedVolumes(r, minAgeDays);
            resources.push(...volumes);
          } catch (error) {
            warnings.push(`EBS volumes in ${r}: ${error instanceof Error ? error.message : 'Failed'}`);
          }
        }

        // Find unused Elastic IPs
        if (resourceTypes.includes('eip') || resourceTypes.includes('elastic_ip')) {
          try {
            const eips = await this.findUnusedElasticIPs(r);
            resources.push(...eips);
          } catch (error) {
            warnings.push(`Elastic IPs in ${r}: ${error instanceof Error ? error.message : 'Failed'}`);
          }
        }

        // Find unused snapshots
        if (resourceTypes.includes('snapshot')) {
          try {
            const snapshots = await this.findUnusedSnapshots(r, minAgeDays);
            resources.push(...snapshots);
          } catch (error) {
            warnings.push(`Snapshots in ${r}: ${error instanceof Error ? error.message : 'Failed'}`);
          }
        }

        // Find unused load balancers
        if (resourceTypes.includes('load_balancer')) {
          try {
            const lbs = await this.findUnusedLoadBalancers(r);
            resources.push(...lbs);
          } catch (error) {
            warnings.push(`Load balancers in ${r}: ${error instanceof Error ? error.message : 'Failed'}`);
          }
        }

        // Find idle EC2 instances
        if (resourceTypes.includes('ec2_instance')) {
          try {
            const instances = await this.findIdleEC2Instances(r, minAgeDays);
            resources.push(...instances);
          } catch (error) {
            warnings.push(`EC2 instances in ${r}: ${error instanceof Error ? error.message : 'Failed'}`);
          }
        }

        // Find unused Lambda functions
        if (resourceTypes.includes('lambda_function')) {
          try {
            const functions = await this.findUnusedLambdaFunctions(r, minAgeDays);
            resources.push(...functions);
          } catch (error) {
            warnings.push(`Lambda functions in ${r}: ${error instanceof Error ? error.message : 'Failed'}`);
          }
        }
      }

      // Filter by tag if specified
      let filteredResources = resources;
      if (options.tag) {
        filteredResources = resources.filter(r =>
          r.tags && r.tags[options.tag!.key] === options.tag!.value
        );
      }

      // Calculate totals and breakdowns
      const totalEstimatedMonthlyCost = filteredResources.reduce(
        (sum, r) => sum + (r.estimatedMonthlyCost || 0),
        0
      );

      const byType: UnusedResourcesResult['byType'] = {} as UnusedResourcesResult['byType'];
      const byRegion: UnusedResourcesResult['byRegion'] = {};

      for (const resource of filteredResources) {
        // By type
        if (!byType[resource.resourceType]) {
          byType[resource.resourceType] = { count: 0, estimatedMonthlyCost: 0 };
        }
        byType[resource.resourceType].count++;
        byType[resource.resourceType].estimatedMonthlyCost += resource.estimatedMonthlyCost || 0;

        // By region
        if (!byRegion[resource.region]) {
          byRegion[resource.region] = { count: 0, estimatedMonthlyCost: 0 };
        }
        byRegion[resource.region].count++;
        byRegion[resource.region].estimatedMonthlyCost += resource.estimatedMonthlyCost || 0;
      }

      const result: UnusedResourcesResult = {
        resources: filteredResources,
        totalCount: filteredResources.length,
        totalEstimatedMonthlyCost,
        currency: 'USD',
        byType,
        byRegion,
      };

      return {
        success: true,
        data: result,
        message: `Found ${filteredResources.length} unused resources with estimated cost of $${totalEstimatedMonthlyCost.toFixed(2)}/month`,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to find unused resources',
        error: errorMessage,
      };
    }
  }

  /**
   * Find unused EBS volumes
   */
  private async findUnusedVolumes(region: string, minAgeDays: number): Promise<UnusedResource[]> {
    const ec2 = this.createEC2Client(region);
    const response = await ec2.send(new DescribeVolumesCommand({
      Filters: [{ Name: 'status', Values: ['available'] }],
    }));

    const resources: UnusedResource[] = [];
    const now = new Date();

    for (const volume of response.Volumes || []) {
      const createdAt = volume.CreateTime ? new Date(volume.CreateTime) : undefined;
      const daysUnused = createdAt
        ? Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      if (daysUnused < minAgeDays) continue;

      // Estimate monthly cost (approximate based on volume type and size)
      const sizeGB = volume.Size || 0;
      let pricePerGBMonth = 0.10; // Default gp2 price
      switch (volume.VolumeType) {
        case 'gp3':
          pricePerGBMonth = 0.08;
          break;
        case 'io1':
        case 'io2':
          pricePerGBMonth = 0.125;
          break;
        case 'st1':
          pricePerGBMonth = 0.045;
          break;
        case 'sc1':
          pricePerGBMonth = 0.025;
          break;
      }

      resources.push({
        resourceId: volume.VolumeId || 'Unknown',
        resourceType: 'ebs_volume',
        arn: `arn:aws:ec2:${region}::volume/${volume.VolumeId}`,
        region,
        createdAt,
        daysUnused,
        estimatedMonthlyCost: sizeGB * pricePerGBMonth,
        size: sizeGB,
        sizeUnit: 'GB',
        tags: this.ec2TagsToRecord(volume.Tags),
        reason: 'Volume is not attached to any instance',
        recommendedAction: 'Delete or attach to an instance',
      });
    }

    return resources;
  }

  /**
   * Find unused Elastic IPs
   */
  private async findUnusedElasticIPs(region: string): Promise<UnusedResource[]> {
    const ec2 = this.createEC2Client(region);
    const response = await ec2.send(new DescribeAddressesCommand({}));

    const resources: UnusedResource[] = [];

    for (const address of response.Addresses || []) {
      // An EIP is unused if it's not associated with an instance or network interface
      if (address.AssociationId) continue;

      resources.push({
        resourceId: address.AllocationId || address.PublicIp || 'Unknown',
        resourceType: 'eip',
        region,
        daysUnused: 0, // EIPs don't have creation time
        estimatedMonthlyCost: 3.60, // ~$0.005/hour for unattached EIP
        tags: this.ec2TagsToRecord(address.Tags),
        reason: 'Elastic IP is not associated with any resource',
        recommendedAction: 'Associate with a resource or release',
      });
    }

    return resources;
  }

  /**
   * Find unused snapshots
   */
  private async findUnusedSnapshots(region: string, minAgeDays: number): Promise<UnusedResource[]> {
    const ec2 = this.createEC2Client(region);
    const accountId = await this.getAccountId();

    const response = await ec2.send(new DescribeSnapshotsCommand({
      OwnerIds: [accountId],
    }));

    // Get all AMIs to check which snapshots are used
    const amisResponse = await ec2.send(new DescribeImagesCommand({
      Owners: ['self'],
    }));

    const usedSnapshotIds = new Set<string>();
    for (const ami of amisResponse.Images || []) {
      for (const mapping of ami.BlockDeviceMappings || []) {
        if (mapping.Ebs?.SnapshotId) {
          usedSnapshotIds.add(mapping.Ebs.SnapshotId);
        }
      }
    }

    const resources: UnusedResource[] = [];
    const now = new Date();

    for (const snapshot of response.Snapshots || []) {
      if (!snapshot.SnapshotId || usedSnapshotIds.has(snapshot.SnapshotId)) continue;

      const createdAt = snapshot.StartTime ? new Date(snapshot.StartTime) : undefined;
      const daysUnused = createdAt
        ? Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      if (daysUnused < minAgeDays) continue;

      const sizeGB = snapshot.VolumeSize || 0;

      resources.push({
        resourceId: snapshot.SnapshotId,
        resourceType: 'snapshot',
        arn: `arn:aws:ec2:${region}::snapshot/${snapshot.SnapshotId}`,
        region,
        createdAt,
        daysUnused,
        estimatedMonthlyCost: sizeGB * 0.05, // $0.05/GB-month for snapshots
        size: sizeGB,
        sizeUnit: 'GB',
        tags: this.ec2TagsToRecord(snapshot.Tags),
        reason: 'Snapshot is not used by any AMI',
        recommendedAction: 'Delete if no longer needed',
      });
    }

    return resources;
  }

  /**
   * Find unused load balancers
   */
  private async findUnusedLoadBalancers(region: string): Promise<UnusedResource[]> {
    const elb = this.createELBClient(region);
    const lbResponse = await elb.send(new DescribeLoadBalancersCommand({}));

    const resources: UnusedResource[] = [];

    for (const lb of lbResponse.LoadBalancers || []) {
      // Get target groups for this LB
      const tgResponse = await elb.send(new DescribeTargetGroupsCommand({
        LoadBalancerArn: lb.LoadBalancerArn,
      }));

      let hasHealthyTargets = false;

      for (const tg of tgResponse.TargetGroups || []) {
        const healthResponse = await elb.send(new DescribeTargetHealthCommand({
          TargetGroupArn: tg.TargetGroupArn,
        }));

        if (healthResponse.TargetHealthDescriptions?.some(
          h => h.TargetHealth?.State === 'healthy'
        )) {
          hasHealthyTargets = true;
          break;
        }
      }

      if (hasHealthyTargets) continue;

      // Estimate cost based on LB type
      let estimatedMonthlyCost = 16.43; // ALB base cost
      if (lb.Type === 'network') {
        estimatedMonthlyCost = 22.58; // NLB base cost
      }

      const createdAt = lb.CreatedTime ? new Date(lb.CreatedTime) : undefined;
      const now = new Date();
      const daysUnused = createdAt
        ? Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      resources.push({
        resourceId: lb.LoadBalancerName || 'Unknown',
        resourceType: 'load_balancer',
        arn: lb.LoadBalancerArn,
        region,
        createdAt,
        daysUnused,
        estimatedMonthlyCost,
        tags: undefined, // Would need separate call to get tags
        reason: 'Load balancer has no healthy targets',
        recommendedAction: 'Add healthy targets or delete',
      });
    }

    return resources;
  }

  /**
   * Find idle EC2 instances
   */
  private async findIdleEC2Instances(region: string, minAgeDays: number): Promise<UnusedResource[]> {
    const ec2 = this.createEC2Client(region);
    const cw = this.createCloudWatchClient(region);

    const response = await ec2.send(new DescribeInstancesCommand({
      Filters: [{ Name: 'instance-state-name', Values: ['running'] }],
    }));

    const resources: UnusedResource[] = [];
    const now = new Date();
    const checkPeriod = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days

    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        if (!instance.InstanceId) continue;

        // Get CPU utilization
        const metricsResponse = await cw.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'CPUUtilization',
          Dimensions: [{ Name: 'InstanceId', Value: instance.InstanceId }],
          StartTime: checkPeriod,
          EndTime: now,
          Period: 3600,
          Statistics: ['Average'],
        }));

        const avgCpu = metricsResponse.Datapoints?.length
          ? metricsResponse.Datapoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) / metricsResponse.Datapoints.length
          : 100;

        // Consider idle if average CPU < 5%
        if (avgCpu >= 5) continue;

        const launchTime = instance.LaunchTime ? new Date(instance.LaunchTime) : undefined;
        const daysRunning = launchTime
          ? Math.floor((now.getTime() - launchTime.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        if (daysRunning < minAgeDays) continue;

        resources.push({
          resourceId: instance.InstanceId,
          resourceType: 'ec2_instance',
          arn: `arn:aws:ec2:${region}::instance/${instance.InstanceId}`,
          region,
          createdAt: launchTime,
          daysUnused: daysRunning,
          tags: this.ec2TagsToRecord(instance.Tags),
          reason: `Instance has average CPU utilization of ${avgCpu.toFixed(1)}%`,
          recommendedAction: 'Stop or terminate if not needed, or rightsize',
        });
      }
    }

    return resources;
  }

  /**
   * Find unused Lambda functions
   */
  private async findUnusedLambdaFunctions(region: string, minAgeDays: number): Promise<UnusedResource[]> {
    const lambda = this.createLambdaClient(region);
    const cw = this.createCloudWatchClient(region);

    const response = await lambda.send(new ListFunctionsCommand({}));

    const resources: UnusedResource[] = [];
    const now = new Date();
    const checkPeriod = new Date(now.getTime() - minAgeDays * 24 * 60 * 60 * 1000);

    for (const fn of response.Functions || []) {
      if (!fn.FunctionName) continue;

      // Get invocation count
      const metricsResponse = await cw.send(new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: 'Invocations',
        Dimensions: [{ Name: 'FunctionName', Value: fn.FunctionName }],
        StartTime: checkPeriod,
        EndTime: now,
        Period: 86400, // Daily
        Statistics: ['Sum'],
      }));

      const totalInvocations = metricsResponse.Datapoints?.reduce(
        (sum, dp) => sum + (dp.Sum || 0),
        0
      ) || 0;

      // Consider unused if no invocations in the period
      if (totalInvocations > 0) continue;

      const lastModified = fn.LastModified
        ? new Date(fn.LastModified)
        : undefined;
      const daysUnused = lastModified
        ? Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24))
        : minAgeDays;

      resources.push({
        resourceId: fn.FunctionName,
        resourceType: 'lambda_function',
        arn: fn.FunctionArn,
        region,
        createdAt: lastModified,
        lastUsedAt: undefined,
        daysUnused,
        estimatedMonthlyCost: 0, // Lambda doesn't cost if not invoked
        tags: undefined, // Would need GetFunction call
        reason: `No invocations in the last ${minAgeDays} days`,
        recommendedAction: 'Delete if no longer needed',
      });
    }

    return resources;
  }

  // =============================================================================
  // Resource Scheduling
  // =============================================================================

  /**
   * Schedule resources to start/stop at specific times
   */
  async scheduleResources(
    options: ScheduleResourcesOptions
  ): Promise<CostOperationResult<ScheduleResourcesResult>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const scheduledResources: ScheduledResource[] = [];
      const failedResources: Array<{ resourceId: string; error: string }> = [];

      // Tag resources with schedule information
      const scheduleTag = `espada-schedule:${options.schedule.name}`;
      const scheduleTags = {
        'espada:schedule': options.schedule.name,
        'espada:schedule-start': options.schedule.startCron || '',
        'espada:schedule-stop': options.schedule.stopCron || '',
        'espada:schedule-timezone': options.schedule.timezone,
        'espada:schedule-enabled': options.schedule.enabled ? 'true' : 'false',
        ...options.tags,
      };

      switch (options.resourceType) {
        case 'ec2': {
          const ec2 = this.createEC2Client(region);

          for (const resourceId of options.resourceIds) {
            try {
              // Apply schedule tags
              await ec2.send(new CreateTagsCommand({
                Resources: [resourceId],
                Tags: Object.entries(scheduleTags).map(([Key, Value]) => ({ Key, Value })),
              }));

              // Get instance state
              const describeResponse = await ec2.send(new DescribeInstancesCommand({
                InstanceIds: [resourceId],
              }));

              const instance = describeResponse.Reservations?.[0]?.Instances?.[0];
              const currentState = instance?.State?.Name || 'unknown';

              scheduledResources.push({
                resourceId,
                resourceType: 'ec2',
                scheduleName: options.schedule.name,
                currentState,
                nextStartTime: options.schedule.startCron
                  ? this.getNextCronTime(options.schedule.startCron, options.schedule.timezone)
                  : undefined,
                nextStopTime: options.schedule.stopCron
                  ? this.getNextCronTime(options.schedule.stopCron, options.schedule.timezone)
                  : undefined,
                estimatedMonthlySavings: this.estimateScheduleSavings(options.schedule),
              });
            } catch (error) {
              failedResources.push({
                resourceId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
          break;
        }

        case 'rds': {
          const rds = this.createRDSClient(region);

          for (const resourceId of options.resourceIds) {
            try {
              // RDS uses resource tags differently
              // For now, we'll track the schedule in our system
              scheduledResources.push({
                resourceId,
                resourceType: 'rds',
                scheduleName: options.schedule.name,
                currentState: 'unknown',
                nextStartTime: options.schedule.startCron
                  ? this.getNextCronTime(options.schedule.startCron, options.schedule.timezone)
                  : undefined,
                nextStopTime: options.schedule.stopCron
                  ? this.getNextCronTime(options.schedule.stopCron, options.schedule.timezone)
                  : undefined,
                estimatedMonthlySavings: this.estimateScheduleSavings(options.schedule),
              });
            } catch (error) {
              failedResources.push({
                resourceId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
          break;
        }

        default:
          return {
            success: false,
            message: `Unsupported resource type: ${options.resourceType}`,
            error: 'Only EC2 and RDS resources are supported for scheduling',
          };
      }

      const totalEstimatedMonthlySavings = scheduledResources.reduce(
        (sum, r) => sum + (r.estimatedMonthlySavings || 0),
        0
      );

      const result: ScheduleResourcesResult = {
        success: failedResources.length === 0,
        scheduledResources,
        failedResources,
        totalEstimatedMonthlySavings,
        message: `Scheduled ${scheduledResources.length} resources, ${failedResources.length} failed`,
      };

      return {
        success: true,
        data: result,
        message: result.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to schedule resources',
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a scheduled action (start/stop) immediately
   */
  async executeScheduleAction(
    resourceId: string,
    resourceType: 'ec2' | 'rds',
    action: 'start' | 'stop',
    region?: string
  ): Promise<CostOperationResult<{ resourceId: string; action: string; newState: string }>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;

      switch (resourceType) {
        case 'ec2': {
          const ec2 = this.createEC2Client(targetRegion);

          if (action === 'start') {
            await ec2.send(new StartInstancesCommand({ InstanceIds: [resourceId] }));
          } else {
            await ec2.send(new StopInstancesCommand({ InstanceIds: [resourceId] }));
          }

          return {
            success: true,
            data: {
              resourceId,
              action,
              newState: action === 'start' ? 'pending' : 'stopping',
            },
            message: `EC2 instance ${resourceId} is ${action === 'start' ? 'starting' : 'stopping'}`,
          };
        }

        case 'rds': {
          const rds = this.createRDSClient(targetRegion);

          if (action === 'start') {
            await rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: resourceId }));
          } else {
            await rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: resourceId }));
          }

          return {
            success: true,
            data: {
              resourceId,
              action,
              newState: action === 'start' ? 'starting' : 'stopping',
            },
            message: `RDS instance ${resourceId} is ${action === 'start' ? 'starting' : 'stopping'}`,
          };
        }

        default:
          return {
            success: false,
            message: `Unsupported resource type: ${resourceType}`,
            error: 'Only EC2 and RDS resources are supported',
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to ${action} resource`,
        error: errorMessage,
      };
    }
  }

  // =============================================================================
  // Budget Management
  // =============================================================================

  /**
   * Create a budget
   */
  async createBudget(options: CreateBudgetOptions): Promise<CostOperationResult<CreateBudgetResult>> {
    try {
      const accountId = await this.getAccountId();

      const notifications: NotificationWithSubscribers[] = (options.alerts || []).map(alert => ({
        Notification: {
          NotificationType: alert.notificationType,
          ComparisonOperator: alert.comparisonOperator,
          Threshold: alert.threshold,
          ThresholdType: alert.thresholdType,
        },
        Subscribers: [
          ...(alert.emailAddresses || []).map(email => ({
            SubscriptionType: 'EMAIL' as const,
            Address: email,
          })),
          ...(alert.snsTopicArn ? [{
            SubscriptionType: 'SNS' as const,
            Address: alert.snsTopicArn,
          }] : []),
        ],
      }));

      const budget: Budget = {
        BudgetName: options.name,
        BudgetType: options.budgetType,
        BudgetLimit: {
          Amount: options.limitAmount.toString(),
          Unit: options.currency || 'USD',
        },
        TimeUnit: options.timeUnit,
        CostFilters: options.costFilters,
      };

      if (options.startDate) {
        budget.TimePeriod = {
          Start: new Date(options.startDate),
          End: options.endDate ? new Date(options.endDate) : undefined,
        };
      }

      const input: CreateBudgetCommandInput = {
        AccountId: accountId,
        Budget: budget,
        NotificationsWithSubscribers: notifications.length > 0 ? notifications : undefined,
      };

      await this.budgetsClient.send(new CreateBudgetCommand(input));

      const result: CreateBudgetResult = {
        success: true,
        budget: {
          name: options.name,
          budgetType: options.budgetType,
          limitAmount: options.limitAmount,
          currency: options.currency || 'USD',
          timeUnit: options.timeUnit,
          actualSpend: 0,
          percentageUsed: 0,
          startDate: options.startDate,
          endDate: options.endDate,
          alerts: options.alerts || [],
          status: 'OK',
        },
        message: `Budget "${options.name}" created successfully`,
      };

      return {
        success: true,
        data: result,
        message: result.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to create budget',
        error: errorMessage,
      };
    }
  }

  /**
   * List all budgets
   */
  async listBudgets(): Promise<CostOperationResult<ListBudgetsResult>> {
    try {
      const accountId = await this.getAccountId();

      const response = await this.budgetsClient.send(new DescribeBudgetsCommand({
        AccountId: accountId,
      }));

      const budgets: BudgetInfo[] = (response.Budgets || []).map(budget => {
        const limitAmount = parseFloat(budget.BudgetLimit?.Amount || '0');
        const actualSpend = parseFloat(budget.CalculatedSpend?.ActualSpend?.Amount || '0');
        const forecastedSpend = budget.CalculatedSpend?.ForecastedSpend?.Amount
          ? parseFloat(budget.CalculatedSpend.ForecastedSpend.Amount)
          : undefined;
        const percentageUsed = limitAmount > 0 ? (actualSpend / limitAmount) * 100 : 0;

        return {
          name: budget.BudgetName || 'Unknown',
          budgetType: budget.BudgetType as BudgetInfo['budgetType'],
          limitAmount,
          currency: budget.BudgetLimit?.Unit || 'USD',
          timeUnit: budget.TimeUnit as BudgetInfo['timeUnit'],
          actualSpend,
          forecastedSpend,
          percentageUsed,
          startDate: budget.TimePeriod?.Start?.toISOString().split('T')[0],
          endDate: budget.TimePeriod?.End?.toISOString().split('T')[0],
          lastUpdated: budget.LastUpdatedTime,
          alerts: [], // Would need separate call to get notifications
          status: percentageUsed >= 100 ? 'CRITICAL' :
                  percentageUsed >= 80 ? 'WARNING' : 'OK',
        };
      });

      return {
        success: true,
        data: {
          budgets,
          totalCount: budgets.length,
        },
        message: `Found ${budgets.length} budgets`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to list budgets',
        error: errorMessage,
      };
    }
  }

  /**
   * Delete a budget
   */
  async deleteBudget(budgetName: string): Promise<CostOperationResult<{ deleted: boolean }>> {
    try {
      const accountId = await this.getAccountId();

      await this.budgetsClient.send(new DeleteBudgetCommand({
        AccountId: accountId,
        BudgetName: budgetName,
      }));

      return {
        success: true,
        data: { deleted: true },
        message: `Budget "${budgetName}" deleted successfully`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to delete budget "${budgetName}"`,
        error: errorMessage,
      };
    }
  }

  // =============================================================================
  // Savings Plans
  // =============================================================================

  /**
   * Get Savings Plan recommendations
   */
  async getSavingsPlansRecommendations(
    options: {
      savingsPlansType?: 'COMPUTE_SP' | 'EC2_INSTANCE_SP' | 'SAGEMAKER_SP';
      term?: 'ONE_YEAR' | 'THREE_YEARS';
      paymentOption?: 'NO_UPFRONT' | 'PARTIAL_UPFRONT' | 'ALL_UPFRONT';
      lookbackPeriod?: 'SEVEN_DAYS' | 'THIRTY_DAYS' | 'SIXTY_DAYS';
    } = {}
  ): Promise<CostOperationResult<SavingsPlanRecommendation[]>> {
    try {
      const input: GetSavingsPlansPurchaseRecommendationCommandInput = {
        SavingsPlansType: options.savingsPlansType || 'COMPUTE_SP',
        TermInYears: options.term || 'ONE_YEAR',
        PaymentOption: options.paymentOption || 'NO_UPFRONT',
        LookbackPeriodInDays: options.lookbackPeriod || 'SIXTY_DAYS',
      };

      const response = await this.costExplorerClient.send(
        new GetSavingsPlansPurchaseRecommendationCommand(input)
      );

      const recommendations = await this.getSavingsPlanRecommendations({});

      return {
        success: true,
        data: recommendations,
        message: `Found ${recommendations.length} Savings Plan recommendations`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to get Savings Plan recommendations',
        error: errorMessage,
      };
    }
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  /**
   * Build a filter expression from CostFilter
   */
  private buildFilterExpression(filter: GetCostSummaryOptions['filter']): Expression | undefined {
    if (!filter) return undefined;

    if (filter.dimension && filter.values && filter.values.length > 0) {
      return {
        Dimensions: {
          Key: filter.dimension,
          Values: filter.values,
        },
      };
    }

    if (filter.tagKey && filter.tagValues && filter.tagValues.length > 0) {
      return {
        Tags: {
          Key: filter.tagKey,
          Values: filter.tagValues,
        },
      };
    }

    if (filter.costCategory && filter.costCategoryValues && filter.costCategoryValues.length > 0) {
      return {
        CostCategories: {
          Key: filter.costCategory,
          Values: filter.costCategoryValues,
        },
      };
    }

    return undefined;
  }

  /**
   * Parse AWS tags to record
   */
  private parseTags(tags: Array<{ Key?: string; Value?: string }>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const tag of tags) {
      if (tag.Key) {
        result[tag.Key] = tag.Value || '';
      }
    }
    return result;
  }

  /**
   * Convert EC2 tags to record
   */
  private ec2TagsToRecord(tags?: Array<{ Key?: string; Value?: string }>): Record<string, string> | undefined {
    if (!tags || tags.length === 0) return undefined;
    return this.parseTags(tags);
  }

  /**
   * Assess risk level for rightsizing recommendation
   */
  private assessRightsizingRisk(cpuUtilization: number): 'low' | 'medium' | 'high' {
    if (cpuUtilization < 10) return 'low';
    if (cpuUtilization < 30) return 'medium';
    return 'high';
  }

  /**
   * Get active regions
   */
  private async getActiveRegions(): Promise<string[]> {
    // Return common regions; could be enhanced to detect from usage
    return [
      'us-east-1',
      'us-east-2',
      'us-west-1',
      'us-west-2',
      'eu-west-1',
      'eu-central-1',
      'ap-southeast-1',
      'ap-northeast-1',
    ];
  }

  /**
   * Get next cron execution time (simplified)
   */
  private getNextCronTime(cronExpression: string, timezone: string): Date {
    // Simplified implementation - in production, use a proper cron parser
    const now = new Date();
    // Add 1 day as a simple approximation
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }

  /**
   * Estimate monthly savings from a schedule
   */
  private estimateScheduleSavings(schedule: ScheduleResourcesOptions['schedule']): number {
    // Estimate based on hours not running
    // Assume average EC2 cost of $0.10/hour
    if (!schedule.stopCron || !schedule.startCron) return 0;

    // Simple estimation: assume 12 hours off per day, 5 days per week
    const hoursOffPerMonth = 12 * 5 * 4; // 240 hours
    return hoursOffPerMonth * 0.10; // ~$24/month per instance
  }
}
