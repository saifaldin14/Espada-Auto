/**
 * AWS Cost Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CostManager, createCostManager } from './manager.js';
import type {
  GetCostSummaryOptions,
  ForecastCostOptions,
  FindUnusedResourcesOptions,
  ScheduleResourcesOptions,
  CreateBudgetOptions,
} from './types.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  GetCostAndUsageCommand: vi.fn(),
  GetCostForecastCommand: vi.fn(),
  GetRightsizingRecommendationCommand: vi.fn(),
  GetReservationPurchaseRecommendationCommand: vi.fn(),
  GetSavingsPlansPurchaseRecommendationCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-budgets', () => ({
  BudgetsClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  CreateBudgetCommand: vi.fn(),
  DescribeBudgetsCommand: vi.fn(),
  DeleteBudgetCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DescribeVolumesCommand: vi.fn(),
  DescribeAddressesCommand: vi.fn(),
  DescribeSnapshotsCommand: vi.fn(),
  DescribeImagesCommand: vi.fn(),
  DescribeInstancesCommand: vi.fn(),
  CreateTagsCommand: vi.fn(),
  StartInstancesCommand: vi.fn(),
  StopInstancesCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-rds', () => ({
  RDSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DescribeDBSnapshotsCommand: vi.fn(),
  StartDBInstanceCommand: vi.fn(),
  StopDBInstanceCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-elastic-load-balancing-v2', () => ({
  ElasticLoadBalancingV2Client: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DescribeLoadBalancersCommand: vi.fn(),
  DescribeTargetGroupsCommand: vi.fn(),
  DescribeTargetHealthCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListFunctionsCommand: vi.fn(),
  GetFunctionCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  GetMetricStatisticsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ Account: '123456789012' }),
  })),
  GetCallerIdentityCommand: vi.fn(),
}));

describe('CostManager', () => {
  let manager: CostManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createCostManager({
      defaultRegion: 'us-east-1',
      defaultMetric: 'UnblendedCost',
      defaultGranularity: 'DAILY',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createCostManager', () => {
    it('should create a CostManager instance with default config', () => {
      const mgr = createCostManager();
      expect(mgr).toBeInstanceOf(CostManager);
    });

    it('should create a CostManager instance with custom config', () => {
      const mgr = createCostManager({
        defaultRegion: 'eu-west-1',
        defaultMetric: 'BlendedCost',
        defaultGranularity: 'MONTHLY',
      });
      expect(mgr).toBeInstanceOf(CostManager);
    });
  });

  describe('getCostSummary', () => {
    it('should return cost summary for a time period', async () => {
      // Mock the Cost Explorer response
      const mockResponse = {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2024-01-01', End: '2024-01-02' },
            Total: {
              UnblendedCost: { Amount: '100.50', Unit: 'USD' },
            },
            Estimated: false,
          },
          {
            TimePeriod: { Start: '2024-01-02', End: '2024-01-03' },
            Total: {
              UnblendedCost: { Amount: '150.25', Unit: 'USD' },
            },
            Estimated: true,
          },
        ],
      };

      // Get the mocked client and set up the response
      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      const mockSend = vi.fn().mockResolvedValue(mockResponse);
      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: mockSend,
      }) as any);

      // Create a new manager with the mocked client
      const testManager = createCostManager();

      const options: GetCostSummaryOptions = {
        timePeriod: {
          start: '2024-01-01',
          end: '2024-01-03',
        },
        granularity: 'DAILY',
      };

      const result = await testManager.getCostSummary(options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.totalCost).toBe(250.75);
      expect(result.data?.currency).toBe('USD');
      expect(result.data?.breakdown).toHaveLength(2);
    });

    it('should handle grouped cost results', async () => {
      const mockResponse = {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2024-01-01', End: '2024-01-02' },
            Groups: [
              {
                Keys: ['Amazon EC2'],
                Metrics: { UnblendedCost: { Amount: '80.00', Unit: 'USD' } },
              },
              {
                Keys: ['Amazon S3'],
                Metrics: { UnblendedCost: { Amount: '20.00', Unit: 'USD' } },
              },
            ],
            Estimated: false,
          },
        ],
      };

      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue(mockResponse),
      }) as any);

      const testManager = createCostManager();

      const options: GetCostSummaryOptions = {
        timePeriod: {
          start: '2024-01-01',
          end: '2024-01-02',
        },
        groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
      };

      const result = await testManager.getCostSummary(options);

      expect(result.success).toBe(true);
      expect(result.data?.groups).toHaveLength(2);
      expect(result.data?.totalCost).toBe(100);
    });

    it('should handle errors gracefully', async () => {
      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: vi.fn().mockRejectedValue(new Error('Access denied')),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.getCostSummary({
        timePeriod: { start: '2024-01-01', end: '2024-01-02' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });

  describe('forecastCosts', () => {
    it('should return cost forecast', async () => {
      const mockForecastResponse = {
        Total: { Amount: '3000.00', Unit: 'USD' },
        ForecastResultsByTime: [
          {
            TimePeriod: { Start: '2024-02-01', End: '2024-02-02' },
            MeanValue: '100.00',
            PredictionIntervalLowerBound: '90.00',
            PredictionIntervalUpperBound: '110.00',
          },
        ],
      };

      const mockCostResponse = {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2024-01-01', End: '2024-01-31' },
            Total: { UnblendedCost: { Amount: '2500.00', Unit: 'USD' } },
          },
        ],
      };

      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      const mockSend = vi.fn()
        .mockResolvedValueOnce(mockForecastResponse)
        .mockResolvedValueOnce(mockCostResponse);

      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: mockSend,
      }) as any);

      const testManager = createCostManager();

      const options: ForecastCostOptions = {
        startDate: '2024-02-01',
        endDate: '2024-02-28',
        granularity: 'DAILY',
      };

      const result = await testManager.forecastCosts(options);

      expect(result.success).toBe(true);
      expect(result.data?.forecastedTotal).toBe(3000);
      expect(result.data?.breakdown).toHaveLength(1);
    });

    it('should handle forecast errors', async () => {
      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: vi.fn().mockRejectedValue(new Error('Insufficient data')),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.forecastCosts({
        startDate: '2024-02-01',
        endDate: '2024-02-28',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient data');
    });
  });

  describe('getOptimizationRecommendations', () => {
    it('should return optimization recommendations', async () => {
      const mockRightsizingResponse = {
        RightsizingRecommendations: [
          {
            CurrentInstance: {
              ResourceId: 'i-1234567890abcdef0',
              InstanceType: 'm5.xlarge',
              MonthlyCost: '200.00',
              ResourceUtilization: {
                EC2ResourceUtilization: {
                  MaxCpuUtilizationPercentage: '15',
                },
              },
              ResourceDetails: {
                EC2ResourceDetails: {
                  Region: 'us-east-1',
                },
              },
              Tags: [],
            },
            ModifyRecommendationDetail: {
              TargetInstances: [
                {
                  InstanceType: 'm5.large',
                  EstimatedMonthlyCost: '100.00',
                },
              ],
            },
            RightsizingType: 'MODIFY',
          },
        ],
      };

      const mockRIResponse = { Recommendations: [] };
      const mockSPResponse = { SavingsPlansPurchaseRecommendation: {} };

      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      const mockSend = vi.fn()
        .mockResolvedValueOnce(mockRightsizingResponse)
        .mockResolvedValueOnce(mockRIResponse)
        .mockResolvedValueOnce(mockSPResponse);

      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: mockSend,
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.getOptimizationRecommendations({
        types: ['rightsizing', 'reserved_instances', 'savings_plans'],
      });

      expect(result.success).toBe(true);
      expect(result.data?.rightsizing).toHaveLength(1);
      expect(result.data?.rightsizing[0].estimatedMonthlySavings).toBe(100);
    });

    it('should filter by minimum savings', async () => {
      const mockRightsizingResponse = {
        RightsizingRecommendations: [
          {
            CurrentInstance: {
              ResourceId: 'i-1234567890abcdef0',
              InstanceType: 'm5.xlarge',
              MonthlyCost: '200.00',
              ResourceUtilization: { EC2ResourceUtilization: {} },
              ResourceDetails: { EC2ResourceDetails: { Region: 'us-east-1' } },
              Tags: [],
            },
            ModifyRecommendationDetail: {
              TargetInstances: [
                { InstanceType: 'm5.large', EstimatedMonthlyCost: '195.00' },
              ],
            },
            RightsizingType: 'MODIFY',
          },
        ],
      };

      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: vi.fn()
          .mockResolvedValueOnce(mockRightsizingResponse)
          .mockResolvedValueOnce({ Recommendations: [] })
          .mockResolvedValueOnce({ SavingsPlansPurchaseRecommendation: {} }),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.getOptimizationRecommendations({
        types: ['rightsizing'],
        minMonthlySavings: 10, // $5 savings won't meet this threshold
      });

      expect(result.success).toBe(true);
      expect(result.data?.rightsizing).toHaveLength(0);
    });
  });

  describe('findUnusedResources', () => {
    it('should find unused EBS volumes', async () => {
      const mockVolumesResponse = {
        Volumes: [
          {
            VolumeId: 'vol-1234567890abcdef0',
            Size: 100,
            VolumeType: 'gp2',
            CreateTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
            Tags: [{ Key: 'Name', Value: 'test-volume' }],
          },
        ],
      };

      const { EC2Client } = await import('@aws-sdk/client-ec2');
      vi.mocked(EC2Client).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue(mockVolumesResponse),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.findUnusedResources({
        resourceTypes: ['ebs_volume'],
        minAgeDays: 30,
        region: 'us-east-1',
      });

      expect(result.success).toBe(true);
      expect(result.data?.resources).toHaveLength(1);
      expect(result.data?.resources[0].resourceType).toBe('ebs_volume');
      expect(result.data?.resources[0].estimatedMonthlyCost).toBe(10); // 100GB * $0.10
    });

    it('should find unused Elastic IPs', async () => {
      const mockAddressesResponse = {
        Addresses: [
          {
            AllocationId: 'eipalloc-1234567890abcdef0',
            PublicIp: '203.0.113.1',
            // No AssociationId means it's unattached
            Tags: [],
          },
        ],
      };

      const { EC2Client } = await import('@aws-sdk/client-ec2');
      vi.mocked(EC2Client).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue(mockAddressesResponse),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.findUnusedResources({
        resourceTypes: ['eip'],
        region: 'us-east-1',
      });

      expect(result.success).toBe(true);
      expect(result.data?.resources).toHaveLength(1);
      expect(result.data?.resources[0].resourceType).toBe('eip');
      expect(result.data?.resources[0].estimatedMonthlyCost).toBe(3.6);
    });

    it('should calculate totals by type and region', async () => {
      const mockVolumesResponse = {
        Volumes: [
          {
            VolumeId: 'vol-1',
            Size: 50,
            VolumeType: 'gp2',
            CreateTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          },
          {
            VolumeId: 'vol-2',
            Size: 100,
            VolumeType: 'gp3',
            CreateTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          },
        ],
      };

      const { EC2Client } = await import('@aws-sdk/client-ec2');
      vi.mocked(EC2Client).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue(mockVolumesResponse),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.findUnusedResources({
        resourceTypes: ['ebs_volume'],
        region: 'us-east-1',
      });

      expect(result.success).toBe(true);
      expect(result.data?.byType.ebs_volume.count).toBe(2);
      expect(result.data?.byRegion['us-east-1'].count).toBe(2);
    });
  });

  describe('scheduleResources', () => {
    it('should schedule EC2 instances', async () => {
      const mockDescribeResponse = {
        Reservations: [
          {
            Instances: [
              { InstanceId: 'i-1234567890abcdef0', State: { Name: 'running' } },
            ],
          },
        ],
      };

      const { EC2Client } = await import('@aws-sdk/client-ec2');
      vi.mocked(EC2Client).mockImplementation(() => ({
        send: vi.fn()
          .mockResolvedValueOnce({}) // CreateTagsCommand
          .mockResolvedValueOnce(mockDescribeResponse), // DescribeInstancesCommand
      }) as any);

      const testManager = createCostManager();

      const options: ScheduleResourcesOptions = {
        resourceIds: ['i-1234567890abcdef0'],
        resourceType: 'ec2',
        schedule: {
          name: 'business-hours',
          startCron: '0 8 * * 1-5',
          stopCron: '0 18 * * 1-5',
          timezone: 'America/New_York',
          enabled: true,
        },
        region: 'us-east-1',
      };

      const result = await testManager.scheduleResources(options);

      expect(result.success).toBe(true);
      expect(result.data?.scheduledResources).toHaveLength(1);
      expect(result.data?.scheduledResources[0].scheduleName).toBe('business-hours');
    });

    it('should handle scheduling failures', async () => {
      const { EC2Client } = await import('@aws-sdk/client-ec2');
      vi.mocked(EC2Client).mockImplementation(() => ({
        send: vi.fn().mockRejectedValue(new Error('Instance not found')),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.scheduleResources({
        resourceIds: ['i-nonexistent'],
        resourceType: 'ec2',
        schedule: {
          name: 'test',
          timezone: 'UTC',
          enabled: true,
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.failedResources).toHaveLength(1);
      expect(result.data?.failedResources[0].error).toBe('Instance not found');
    });
  });

  describe('executeScheduleAction', () => {
    it('should start an EC2 instance', async () => {
      const { EC2Client } = await import('@aws-sdk/client-ec2');
      vi.mocked(EC2Client).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({}),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.executeScheduleAction(
        'i-1234567890abcdef0',
        'ec2',
        'start',
        'us-east-1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('start');
      expect(result.data?.newState).toBe('pending');
    });

    it('should stop an EC2 instance', async () => {
      const { EC2Client } = await import('@aws-sdk/client-ec2');
      vi.mocked(EC2Client).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({}),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.executeScheduleAction(
        'i-1234567890abcdef0',
        'ec2',
        'stop',
        'us-east-1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('stop');
      expect(result.data?.newState).toBe('stopping');
    });

    it('should start an RDS instance', async () => {
      const { RDSClient } = await import('@aws-sdk/client-rds');
      vi.mocked(RDSClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({}),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.executeScheduleAction(
        'mydb',
        'rds',
        'start',
        'us-east-1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('start');
    });
  });

  describe('createBudget', () => {
    it('should create a budget', async () => {
      const { BudgetsClient } = await import('@aws-sdk/client-budgets');
      const { STSClient } = await import('@aws-sdk/client-sts');

      vi.mocked(STSClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({ Account: '123456789012' }),
      }) as any);

      vi.mocked(BudgetsClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({}),
      }) as any);

      const testManager = createCostManager();

      const options: CreateBudgetOptions = {
        name: 'monthly-budget',
        budgetType: 'COST',
        limitAmount: 1000,
        timeUnit: 'MONTHLY',
        alerts: [
          {
            threshold: 80,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            emailAddresses: ['admin@example.com'],
          },
        ],
      };

      const result = await testManager.createBudget(options);

      expect(result.success).toBe(true);
      expect(result.data?.budget?.name).toBe('monthly-budget');
      expect(result.data?.budget?.limitAmount).toBe(1000);
    });

    it('should handle budget creation errors', async () => {
      const { BudgetsClient } = await import('@aws-sdk/client-budgets');
      const { STSClient } = await import('@aws-sdk/client-sts');

      vi.mocked(STSClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({ Account: '123456789012' }),
      }) as any);

      vi.mocked(BudgetsClient).mockImplementation(() => ({
        send: vi.fn().mockRejectedValue(new Error('Budget already exists')),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.createBudget({
        name: 'existing-budget',
        budgetType: 'COST',
        limitAmount: 1000,
        timeUnit: 'MONTHLY',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Budget already exists');
    });
  });

  describe('listBudgets', () => {
    it('should list all budgets', async () => {
      const { BudgetsClient } = await import('@aws-sdk/client-budgets');
      const { STSClient } = await import('@aws-sdk/client-sts');

      vi.mocked(STSClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({ Account: '123456789012' }),
      }) as any);

      vi.mocked(BudgetsClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({
          Budgets: [
            {
              BudgetName: 'monthly-budget',
              BudgetType: 'COST',
              BudgetLimit: { Amount: '1000', Unit: 'USD' },
              TimeUnit: 'MONTHLY',
              CalculatedSpend: {
                ActualSpend: { Amount: '500' },
                ForecastedSpend: { Amount: '900' },
              },
            },
          ],
        }),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.listBudgets();

      expect(result.success).toBe(true);
      expect(result.data?.budgets).toHaveLength(1);
      expect(result.data?.budgets[0].percentageUsed).toBe(50);
      expect(result.data?.budgets[0].status).toBe('OK');
    });

    it('should calculate budget status correctly', async () => {
      const { BudgetsClient } = await import('@aws-sdk/client-budgets');
      const { STSClient } = await import('@aws-sdk/client-sts');

      vi.mocked(STSClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({ Account: '123456789012' }),
      }) as any);

      vi.mocked(BudgetsClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({
          Budgets: [
            {
              BudgetName: 'critical-budget',
              BudgetType: 'COST',
              BudgetLimit: { Amount: '1000', Unit: 'USD' },
              TimeUnit: 'MONTHLY',
              CalculatedSpend: { ActualSpend: { Amount: '1100' } },
            },
            {
              BudgetName: 'warning-budget',
              BudgetType: 'COST',
              BudgetLimit: { Amount: '1000', Unit: 'USD' },
              TimeUnit: 'MONTHLY',
              CalculatedSpend: { ActualSpend: { Amount: '850' } },
            },
          ],
        }),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.listBudgets();

      expect(result.success).toBe(true);
      expect(result.data?.budgets[0].status).toBe('CRITICAL');
      expect(result.data?.budgets[1].status).toBe('WARNING');
    });
  });

  describe('deleteBudget', () => {
    it('should delete a budget', async () => {
      const { BudgetsClient } = await import('@aws-sdk/client-budgets');
      const { STSClient } = await import('@aws-sdk/client-sts');

      vi.mocked(STSClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({ Account: '123456789012' }),
      }) as any);

      vi.mocked(BudgetsClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({}),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.deleteBudget('monthly-budget');

      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
    });
  });

  describe('getSavingsPlansRecommendations', () => {
    it('should return Savings Plan recommendations', async () => {
      const mockResponse = {
        SavingsPlansPurchaseRecommendation: {
          SavingsPlansPurchaseRecommendationDetails: [
            {
              HourlyCommitmentToPurchase: '10.00',
              UpfrontCost: '0.00',
              CurrentAverageHourlyOnDemandSpend: '15.00',
              EstimatedMonthlySavingsAmount: '100.00',
              EstimatedSavingsPercentage: '20',
            },
          ],
        },
      };

      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      vi.mocked(CostExplorerClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue(mockResponse),
      }) as any);

      const testManager = createCostManager();

      const result = await testManager.getSavingsPlansRecommendations({
        savingsPlansType: 'COMPUTE_SP',
        term: 'ONE_YEAR',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });
});
