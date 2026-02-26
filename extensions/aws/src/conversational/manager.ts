/**
 * AWS Enhanced Conversational UX Manager
 *
 * Production-ready implementation of infrastructure context management,
 * proactive insights, natural language queries, and wizard-mode guided
 * infrastructure creation.
 */

import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeSecurityGroupsCommand, DescribeAddressesCommand, DescribeSnapshotsCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand, DescribePendingMaintenanceActionsCommand } from '@aws-sdk/client-rds';
import { LambdaClient, ListFunctionsCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { S3Client, ListBucketsCommand, GetBucketPolicyStatusCommand, GetBucketEncryptionCommand } from '@aws-sdk/client-s3';
import { CloudWatchClient, DescribeAlarmsCommand, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { IAMClient, ListUsersCommand, ListAccessKeysCommand, GetAccessKeyLastUsedCommand, GetAccountSummaryCommand } from '@aws-sdk/client-iam';
import { ResourceGroupsTaggingAPIClient, GetResourcesCommand } from '@aws-sdk/client-resource-groups-tagging-api';
import { v4 as uuidv4 } from 'uuid';

import type {
  ConversationalManager,
  ConversationalManagerConfig,
  ConversationalOperationResult,
  InfrastructureContext,
  ResourceReference,
  OperationRecord,
  ResourceFilter,
  EnvironmentType,
  TrackedResourceType,
  ParsedQuery,
  QueryResult,
  QueryIntent,
  TimeRangeType,
  ProactiveInsight,
  InsightSeverity,
  InsightCategory,
  InsightStatus,
  InsightRecommendation,
  InsightCheckConfig,
  GetInsightsOptions,
  WizardTemplate,
  WizardState,
  WizardStep,
  WizardExecutionPlan,
  PlannedResource,
  InfrastructureSummary,
  SessionSummary,
} from './types.js';

import {
  WIZARD_TEMPLATES,
  INSIGHT_CHECKS,
  QUERY_PATTERNS,
} from './types.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a successful result
 */
function success<T>(data: T, message?: string): ConversationalOperationResult<T> {
  return { success: true, data, message };
}

/**
 * Create a failure result
 */
function failure<T = void>(error: string): ConversationalOperationResult<T> {
  return { success: false, error };
}

/**
 * Detect environment from tags or name
 */
function detectEnvironment(tags?: Record<string, string>, name?: string): EnvironmentType | undefined {
  const envKeys = ['Environment', 'environment', 'Env', 'env', 'Stage', 'stage'];

  if (tags) {
    for (const key of envKeys) {
      if (tags[key]) {
        const value = tags[key].toLowerCase();
        if (['prod', 'production'].includes(value)) return 'production';
        if (['dev', 'development'].includes(value)) return 'development';
        if (['staging', 'stage'].includes(value)) return 'staging';
        if (['uat'].includes(value)) return 'uat';
        if (['test', 'testing'].includes(value)) return 'test';
        if (['sandbox'].includes(value)) return 'sandbox';
      }
    }
  }

  if (name) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('prod')) return 'production';
    if (lowerName.includes('dev')) return 'development';
    if (lowerName.includes('staging') || lowerName.includes('stage')) return 'staging';
    if (lowerName.includes('uat')) return 'uat';
    if (lowerName.includes('test')) return 'test';
    if (lowerName.includes('sandbox')) return 'sandbox';
  }

  return undefined;
}

/**
 * Convert AWS tags to Record
 */
function tagsToRecord(tags?: Array<{ Key?: string; Value?: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  if (tags) {
    for (const tag of tags) {
      if (tag.Key) {
        result[tag.Key] = tag.Value || '';
      }
    }
  }
  return result;
}

/**
 * Get time range dates
 */
function getTimeRangeDates(type: TimeRangeType): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  let start = new Date(now);

  switch (type) {
    case 'last-hour':
      start.setHours(start.getHours() - 1);
      break;
    case 'last-day':
      start.setDate(start.getDate() - 1);
      break;
    case 'last-week':
      start.setDate(start.getDate() - 7);
      break;
    case 'last-month':
      start.setMonth(start.getMonth() - 1);
      break;
    case 'last-quarter':
      start.setMonth(start.getMonth() - 3);
      break;
    case 'last-year':
      start.setFullYear(start.getFullYear() - 1);
      break;
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'this-week':
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      break;
    case 'this-month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
  }

  return { start, end };
}

/**
 * Parse natural language time expression
 */
function parseTimeExpression(text: string): TimeRangeType | undefined {
  const lower = text.toLowerCase();

  if (lower.includes('last hour') || lower.includes('past hour')) return 'last-hour';
  if (lower.includes('last 24 hours') || lower.includes('last day') || lower.includes('past day')) return 'last-day';
  if (lower.includes('last week') || lower.includes('past week') || lower.includes('last 7 days')) return 'last-week';
  if (lower.includes('last month') || lower.includes('past month') || lower.includes('last 30 days')) return 'last-month';
  if (lower.includes('last quarter') || lower.includes('last 3 months') || lower.includes('past 3 months')) return 'last-quarter';
  if (lower.includes('last year') || lower.includes('past year')) return 'last-year';
  if (lower.includes('today')) return 'today';
  if (lower.includes('yesterday')) return 'yesterday';
  if (lower.includes('this week')) return 'this-week';
  if (lower.includes('this month')) return 'this-month';

  return undefined;
}

/**
 * Parse natural language region expression
 */
function parseRegionExpression(text: string): string | undefined {
  const regionPattern = /(?:in|from|at)\s+(us-east-1|us-east-2|us-west-1|us-west-2|eu-west-1|eu-west-2|eu-west-3|eu-central-1|eu-north-1|ap-south-1|ap-southeast-1|ap-southeast-2|ap-northeast-1|ap-northeast-2|ap-northeast-3|sa-east-1|ca-central-1)/i;
  const match = text.match(regionPattern);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Parse tag filters from natural language
 */
function parseTagFilters(text: string): Record<string, string> {
  const tags: Record<string, string> = {};

  // Pattern: tagged with key=value
  const taggedWithPattern = /tagged\s+with\s+(\w+)\s*=\s*(\w+)/gi;
  let match;
  while ((match = taggedWithPattern.exec(text)) !== null) {
    tags[match[1]] = match[2];
  }

  // Pattern: tag key=value
  const tagPattern = /(?:with\s+)?tag\s+(\w+)\s*=\s*(\w+)/gi;
  while ((match = tagPattern.exec(text)) !== null) {
    tags[match[1]] = match[2];
  }

  // Pattern: Key: value or key:value
  const colonPattern = /(\w+):\s*["']?(\w+)["']?/g;
  while ((match = colonPattern.exec(text)) !== null) {
    // Avoid matching time expressions
    if (!['last', 'past', 'this'].includes(match[1].toLowerCase())) {
      tags[match[1]] = match[2];
    }
  }

  return tags;
}

/**
 * Parse resource types from natural language
 */
function parseResourceTypes(text: string): TrackedResourceType[] {
  const types: TrackedResourceType[] = [];
  const lower = text.toLowerCase();

  if (lower.includes('ec2') || lower.includes('instance') || lower.includes('server')) {
    types.push('ec2:instance');
  }
  if (lower.includes('rds') || lower.includes('database') || lower.includes('db')) {
    types.push('rds:instance');
  }
  if (lower.includes('lambda') || lower.includes('function')) {
    types.push('lambda:function');
  }
  if (lower.includes('s3') || lower.includes('bucket')) {
    types.push('s3:bucket');
  }
  if (lower.includes('vpc') || lower.includes('network')) {
    types.push('ec2:vpc');
  }
  if (lower.includes('subnet')) {
    types.push('ec2:subnet');
  }
  if (lower.includes('security group') || lower.includes('sg')) {
    types.push('ec2:security-group');
  }
  if (lower.includes('ecs') || lower.includes('container service')) {
    types.push('ecs:cluster');
    types.push('ecs:service');
  }
  if (lower.includes('eks') || lower.includes('kubernetes')) {
    types.push('eks:cluster');
  }
  if (lower.includes('load balancer') || lower.includes('elb') || lower.includes('alb')) {
    types.push('elb:load-balancer');
  }
  if (lower.includes('cloudfront') || lower.includes('cdn') || lower.includes('distribution')) {
    types.push('cloudfront:distribution');
  }
  if (lower.includes('dynamodb') || lower.includes('nosql')) {
    types.push('dynamodb:table');
  }
  if (lower.includes('sqs') || lower.includes('queue')) {
    types.push('sqs:queue');
  }
  if (lower.includes('sns') || lower.includes('topic') || lower.includes('notification')) {
    types.push('sns:topic');
  }
  if (lower.includes('api gateway') || lower.includes('rest api')) {
    types.push('apigateway:rest-api');
  }
  if (lower.includes('iam') || lower.includes('role')) {
    types.push('iam:role');
  }
  if (lower.includes('secret') || lower.includes('secrets manager')) {
    types.push('secretsmanager:secret');
  }
  if (lower.includes('kms') || lower.includes('key')) {
    types.push('kms:key');
  }
  if (lower.includes('alarm') || lower.includes('cloudwatch')) {
    types.push('cloudwatch:alarm');
  }
  if (lower.includes('route53') || lower.includes('hosted zone') || lower.includes('dns')) {
    types.push('route53:hosted-zone');
  }

  return types;
}

/**
 * Detect query intent from natural language
 */
function detectIntent(text: string): QueryIntent {
  const lower = text.toLowerCase();

  if (lower.includes('how many') || lower.includes('count') || lower.includes('total')) {
    return 'count';
  }
  if (lower.includes('compare') || lower.includes('difference') || lower.includes('versus')) {
    return 'compare';
  }
  if (lower.includes('analyze') || lower.includes('analyse') || lower.includes('breakdown')) {
    return 'analyze';
  }
  if (lower.includes('summarize') || lower.includes('summary') || lower.includes('overview')) {
    return 'summarize';
  }
  if (lower.includes('describe') || lower.includes('details') || lower.includes('info about')) {
    return 'describe';
  }
  if (lower.includes('aggregate') || lower.includes('group by') || lower.includes('grouped')) {
    return 'aggregate';
  }
  if (lower.includes('find') || lower.includes('search') || lower.includes('locate')) {
    return 'find';
  }
  if (lower.includes('filter') || lower.includes('where') || lower.includes('with')) {
    return 'filter';
  }

  return 'list';
}

/**
 * Detect environment from query
 */
function detectEnvironmentFromQuery(text: string): EnvironmentType | undefined {
  const lower = text.toLowerCase();

  if (lower.includes('production') || lower.includes('prod')) return 'production';
  if (lower.includes('development') || lower.includes('dev')) return 'development';
  if (lower.includes('staging') || lower.includes('stage')) return 'staging';
  if (lower.includes('uat')) return 'uat';
  if (lower.includes('test')) return 'test';
  if (lower.includes('sandbox')) return 'sandbox';

  return undefined;
}

// =============================================================================
// AWS Conversational UX Manager Implementation
// =============================================================================

/**
 * AWS Conversational UX Manager Implementation
 */
export class AWSConversationalManager implements ConversationalManager {
  private readonly config: ConversationalManagerConfig;
  private context: InfrastructureContext;
  private insights: Map<string, ProactiveInsight> = new Map();
  private insightChecks: Map<string, InsightCheckConfig> = new Map();
  private wizardStates: Map<string, WizardState> = new Map();

  // AWS Clients
  private ec2Client: EC2Client;
  private rdsClient: RDSClient;
  private lambdaClient: LambdaClient;
  private s3Client: S3Client;
  private cloudWatchClient: CloudWatchClient;
  private iamClient: IAMClient;
  private taggingClient: ResourceGroupsTaggingAPIClient;

  constructor(config: ConversationalManagerConfig = {}) {
    this.config = {
      defaultRegion: config.defaultRegion || 'us-east-1',
      maxRecentResources: config.maxRecentResources || 50,
      maxSessionHistory: config.maxSessionHistory || 100,
      enableProactiveInsights: config.enableProactiveInsights ?? true,
      insightCheckIntervalMinutes: config.insightCheckIntervalMinutes || 30,
      ...config,
    };

    // Initialize context
    this.context = {
      sessionId: uuidv4(),
      sessionStarted: new Date(),
      recentResources: [],
      activeRegion: this.config.defaultRegion!,
      sessionHistory: [],
      pinnedResources: [],
      activeFilters: [],
      variables: {},
      lastActivity: new Date(),
    };

    // Initialize insight checks
    for (const check of INSIGHT_CHECKS) {
      this.insightChecks.set(check.id, { ...check });
    }

    // Initialize AWS clients
    const clientConfig = {
      region: this.config.defaultRegion,
      credentials: this.config.credentials,
    };

    this.ec2Client = new EC2Client(clientConfig);
    this.rdsClient = new RDSClient(clientConfig);
    this.lambdaClient = new LambdaClient(clientConfig);
    this.s3Client = new S3Client(clientConfig);
    this.cloudWatchClient = new CloudWatchClient(clientConfig);
    this.iamClient = new IAMClient({ ...clientConfig, region: 'us-east-1' }); // IAM is global
    this.taggingClient = new ResourceGroupsTaggingAPIClient(clientConfig);
  }

  /**
   * Update AWS clients when region changes
   */
  private updateClients(region: string): void {
    const clientConfig = {
      region,
      credentials: this.config.credentials,
    };

    this.ec2Client = new EC2Client(clientConfig);
    this.rdsClient = new RDSClient(clientConfig);
    this.lambdaClient = new LambdaClient(clientConfig);
    this.s3Client = new S3Client(clientConfig);
    this.cloudWatchClient = new CloudWatchClient(clientConfig);
    this.taggingClient = new ResourceGroupsTaggingAPIClient(clientConfig);
    // IAM client stays global
  }

  // ==========================================================================
  // Context Management
  // ==========================================================================

  getContext(): InfrastructureContext {
    this.context.lastActivity = new Date();
    return { ...this.context };
  }

  setActiveRegion(region: string): void {
    this.context.activeRegion = region;
    this.context.lastActivity = new Date();
    this.updateClients(region);
  }

  setActiveAccount(accountId: string): void {
    this.context.activeAccount = accountId;
    this.context.lastActivity = new Date();
  }

  setEnvironment(environment: EnvironmentType): void {
    this.context.environment = environment;
    this.context.lastActivity = new Date();
  }

  addRecentResource(resource: ResourceReference): void {
    // Update existing or add new
    const existingIndex = this.context.recentResources.findIndex(
      r => r.id === resource.id && r.type === resource.type
    );

    if (existingIndex >= 0) {
      const existing = this.context.recentResources[existingIndex];
      existing.lastAccessed = new Date();
      existing.accessCount++;
      // Move to front
      this.context.recentResources.splice(existingIndex, 1);
      this.context.recentResources.unshift(existing);
    } else {
      resource.lastAccessed = new Date();
      resource.accessCount = 1;
      this.context.recentResources.unshift(resource);
    }

    // Trim to max
    if (this.context.recentResources.length > this.config.maxRecentResources!) {
      this.context.recentResources = this.context.recentResources.slice(0, this.config.maxRecentResources!);
    }

    this.context.lastActivity = new Date();
  }

  pinResource(resource: ResourceReference): void {
    const exists = this.context.pinnedResources.some(
      r => r.id === resource.id && r.type === resource.type
    );
    if (!exists) {
      this.context.pinnedResources.push(resource);
    }
    this.context.lastActivity = new Date();
  }

  unpinResource(resourceId: string): void {
    this.context.pinnedResources = this.context.pinnedResources.filter(r => r.id !== resourceId);
    this.context.lastActivity = new Date();
  }

  addFilter(filter: ResourceFilter): void {
    this.context.activeFilters.push(filter);
    this.context.lastActivity = new Date();
  }

  removeFilter(filterId: string): void {
    this.context.activeFilters = this.context.activeFilters.filter(f => f.id !== filterId);
    this.context.lastActivity = new Date();
  }

  clearFilters(): void {
    this.context.activeFilters = [];
    this.context.lastActivity = new Date();
  }

  setVariable(name: string, value: string): void {
    this.context.variables[name] = value;
    this.context.lastActivity = new Date();
  }

  getVariable(name: string): string | undefined {
    return this.context.variables[name];
  }

  clearSession(): void {
    this.context = {
      sessionId: uuidv4(),
      sessionStarted: new Date(),
      recentResources: [],
      activeRegion: this.config.defaultRegion!,
      sessionHistory: [],
      pinnedResources: [],
      activeFilters: [],
      variables: {},
      lastActivity: new Date(),
    };
  }

  recordOperation(operation: OperationRecord): void {
    this.context.sessionHistory.unshift(operation);

    // Trim to max
    if (this.context.sessionHistory.length > this.config.maxSessionHistory!) {
      this.context.sessionHistory = this.context.sessionHistory.slice(0, this.config.maxSessionHistory!);
    }

    // Add accessed resources to recent
    for (const resource of operation.resources) {
      this.addRecentResource(resource);
    }

    this.context.lastActivity = new Date();
  }

  // ==========================================================================
  // Natural Language Queries
  // ==========================================================================

  async parseQuery(query: string): Promise<ConversationalOperationResult<ParsedQuery>> {
    try {
      const parsed: ParsedQuery = {
        originalQuery: query,
        intent: detectIntent(query),
        resourceTypes: parseResourceTypes(query),
        filters: [],
        confidence: 0.8,
      };

      // Parse time range
      const timeRange = parseTimeExpression(query);
      if (timeRange) {
        const dates = getTimeRangeDates(timeRange);
        parsed.timeRange = {
          type: timeRange,
          start: dates.start,
          end: dates.end,
        };
      }

      // Parse region
      const region = parseRegionExpression(query);
      if (region) {
        parsed.region = region;
      }

      // Parse environment
      const environment = detectEnvironmentFromQuery(query);
      if (environment) {
        parsed.environment = environment;
      }

      // Parse tags
      const tags = parseTagFilters(query);
      if (Object.keys(tags).length > 0) {
        parsed.tags = tags;
      }

      // Build filters from parsed data
      if (parsed.region) {
        parsed.filters.push({
          id: uuidv4(),
          name: 'region',
          type: 'region',
          operator: 'equals',
          value: parsed.region,
          active: true,
        });
      }

      if (parsed.environment) {
        parsed.filters.push({
          id: uuidv4(),
          name: 'environment',
          type: 'environment',
          operator: 'equals',
          value: parsed.environment,
          active: true,
        });
      }

      if (parsed.tags) {
        for (const [key, value] of Object.entries(parsed.tags)) {
          parsed.filters.push({
            id: uuidv4(),
            name: `tag:${key}`,
            type: 'tag',
            operator: 'equals',
            value: `${key}=${value}`,
            active: true,
          });
        }
      }

      // Detect ambiguities
      if (parsed.resourceTypes.length === 0) {
        parsed.ambiguities = ['Resource type not specified. Searching all resource types.'];
        parsed.confidence = 0.6;
      }

      // Match against known patterns for better accuracy
      for (const pattern of QUERY_PATTERNS) {
        for (const p of pattern.patterns) {
          const regex = new RegExp(p, 'i');
          if (regex.test(query)) {
            parsed.intent = pattern.intent;
            if (pattern.defaultResourceTypes && parsed.resourceTypes.length === 0) {
              parsed.resourceTypes = pattern.defaultResourceTypes;
            }
            parsed.confidence = 0.9;
            break;
          }
        }
      }

      return success(parsed);
    } catch (error) {
      return failure(`Failed to parse query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async executeQuery(query: string | ParsedQuery): Promise<ConversationalOperationResult<QueryResult>> {
    const startTime = Date.now();

    try {
      // Parse if string
      let parsed: ParsedQuery;
      if (typeof query === 'string') {
        const parseResult = await this.parseQuery(query);
        if (!parseResult.success || !parseResult.data) {
          return failure(parseResult.error || 'Failed to parse query');
        }
        parsed = parseResult.data;
      } else {
        parsed = query;
      }

      // Get resources using Resource Groups Tagging API
      const resources: ResourceReference[] = [];
      const resourceTypes = parsed.resourceTypes.length > 0 ? parsed.resourceTypes : undefined;

      // Build tag filters
      const tagFilters: Array<{ Key: string; Values: string[] }> = [];
      if (parsed.tags) {
        for (const [key, value] of Object.entries(parsed.tags)) {
          tagFilters.push({ Key: key, Values: [value] });
        }
      }

      // Add environment filter as tag
      if (parsed.environment) {
        tagFilters.push({ Key: 'Environment', Values: [parsed.environment] });
      }

      // Use region from query or context
      const targetRegion = parsed.region || this.context.activeRegion;
      if (targetRegion !== this.context.activeRegion) {
        this.updateClients(targetRegion);
      }

      // Query resources using tagging API
      const tagCommand = new GetResourcesCommand({
        TagFilters: tagFilters.length > 0 ? tagFilters : undefined,
        ResourcesPerPage: 100,
      });

      const tagResponse = await this.taggingClient.send(tagCommand);

      if (tagResponse.ResourceTagMappingList) {
        for (const mapping of tagResponse.ResourceTagMappingList) {
          if (!mapping.ResourceARN) continue;

          const arn = mapping.ResourceARN;
          const resourceType = this.arnToResourceType(arn);

          // Filter by resource type if specified
          if (resourceTypes && !resourceTypes.includes(resourceType)) {
            continue;
          }

          const tags = tagsToRecord(mapping.Tags?.map(t => ({ Key: t.Key, Value: t.Value })));
          const resourceName = this.extractResourceName(arn);

          const resource: ResourceReference = {
            type: resourceType,
            id: this.extractResourceId(arn),
            name: tags['Name'] || resourceName,
            region: targetRegion,
            arn: arn,
            tags: tags,
            lastAccessed: new Date(),
            accessCount: 1,
            environment: detectEnvironment(tags, tags['Name'] || resourceName),
          };

          resources.push(resource);
        }
      }

      // Filter by time range if specified
      let filteredResources = resources;
      // Note: Time-based filtering would require checking resource creation dates,
      // which isn't available in tagging API response. This would need additional API calls.

      // Sort resources
      if (parsed.sortBy) {
        filteredResources.sort((a, b) => {
          const aVal = (a as unknown as Record<string, unknown>)[parsed.sortBy!.field];
          const bVal = (b as unknown as Record<string, unknown>)[parsed.sortBy!.field];
          const comparison = String(aVal).localeCompare(String(bVal));
          return parsed.sortBy!.order === 'asc' ? comparison : -comparison;
        });
      }

      // Apply limit
      const totalCount = filteredResources.length;
      if (parsed.limit) {
        filteredResources = filteredResources.slice(0, parsed.limit);
      }

      // Handle aggregation
      let aggregationResult;
      if (parsed.aggregation) {
        if (parsed.aggregation.type === 'count') {
          if (parsed.aggregation.groupBy) {
            const grouped: Record<string, number> = {};
            for (const r of resources) {
              const groupValue = parsed.aggregation.groupBy === 'type' ? r.type :
                parsed.aggregation.groupBy === 'region' ? r.region :
                  parsed.aggregation.groupBy === 'environment' ? (r.environment || 'unknown') :
                    'unknown';
              grouped[groupValue] = (grouped[groupValue] || 0) + 1;
            }
            aggregationResult = { value: grouped, label: `Count by ${parsed.aggregation.groupBy}` };
          } else {
            aggregationResult = { value: totalCount, label: 'Total count' };
          }
        }
      }

      // Generate summary
      let summary = '';
      if (parsed.intent === 'count') {
        summary = `Found ${totalCount} resource(s)`;
        if (parsed.resourceTypes.length > 0) {
          summary += ` of type ${parsed.resourceTypes.join(', ')}`;
        }
      } else {
        summary = `Retrieved ${filteredResources.length} of ${totalCount} resource(s)`;
      }

      if (parsed.region) {
        summary += ` in ${parsed.region}`;
      }
      if (parsed.environment) {
        summary += ` (${parsed.environment} environment)`;
      }

      // Generate suggestions
      const suggestions: string[] = [];
      if (filteredResources.length > 0) {
        suggestions.push('Describe a specific resource');
        suggestions.push('Filter by tags');
        if (!parsed.environment) {
          suggestions.push('Filter by environment (production, development, etc.)');
        }
      }
      if (totalCount > filteredResources.length) {
        suggestions.push(`Show all ${totalCount} results`);
      }

      const result: QueryResult = {
        query: parsed,
        resources: filteredResources,
        totalCount,
        aggregationResult,
        summary,
        executionTimeMs: Date.now() - startTime,
        suggestions,
      };

      return success(result);
    } catch (error) {
      return failure(`Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getSuggestions(partialQuery: string): Promise<ConversationalOperationResult<string[]>> {
    try {
      const suggestions: string[] = [];
      const lower = partialQuery.toLowerCase();

      // Match against query patterns
      for (const pattern of QUERY_PATTERNS) {
        for (const example of pattern.examples) {
          if (example.toLowerCase().includes(lower) || lower.includes(pattern.name.toLowerCase())) {
            suggestions.push(example);
          }
        }
      }

      // Add context-aware suggestions
      if (this.context.recentResources.length > 0) {
        const recentNames = this.context.recentResources.slice(0, 3).map(r => r.name);
        suggestions.push(`Show details for ${recentNames[0]}`);
      }

      if (this.context.environment) {
        suggestions.push(`Show all ${this.context.environment} resources`);
      }

      // Deduplicate and limit
      const unique = [...new Set(suggestions)].slice(0, 10);
      return success(unique);
    } catch (error) {
      return failure(`Failed to get suggestions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert ARN to resource type
   */
  private arnToResourceType(arn: string): TrackedResourceType {
    const arnParts = arn.split(':');
    if (arnParts.length < 6) return 'other';

    const service = arnParts[2];
    const resourcePart = arnParts[5] || '';

    switch (service) {
      case 'ec2':
        if (resourcePart.startsWith('instance/')) return 'ec2:instance';
        if (resourcePart.startsWith('vpc/')) return 'ec2:vpc';
        if (resourcePart.startsWith('subnet/')) return 'ec2:subnet';
        if (resourcePart.startsWith('security-group/')) return 'ec2:security-group';
        break;
      case 'rds':
        if (resourcePart.startsWith('db:')) return 'rds:instance';
        if (resourcePart.startsWith('cluster:')) return 'rds:cluster';
        break;
      case 'lambda':
        if (resourcePart.startsWith('function:')) return 'lambda:function';
        break;
      case 's3':
        return 's3:bucket';
      case 'ecs':
        if (resourcePart.includes('cluster/')) return 'ecs:cluster';
        if (resourcePart.includes('service/')) return 'ecs:service';
        break;
      case 'eks':
        return 'eks:cluster';
      case 'dynamodb':
        return 'dynamodb:table';
      case 'sqs':
        return 'sqs:queue';
      case 'sns':
        return 'sns:topic';
      case 'elasticloadbalancing':
        return 'elb:load-balancer';
      case 'cloudfront':
        return 'cloudfront:distribution';
      case 'iam':
        if (resourcePart.startsWith('role/')) return 'iam:role';
        if (resourcePart.startsWith('user/')) return 'iam:user';
        break;
      case 'kms':
        return 'kms:key';
      case 'secretsmanager':
        return 'secretsmanager:secret';
      case 'cloudwatch':
        return 'cloudwatch:alarm';
      case 'route53':
        return 'route53:hosted-zone';
      case 'apigateway':
        return 'apigateway:rest-api';
    }

    return 'other';
  }

  /**
   * Extract resource ID from ARN
   */
  private extractResourceId(arn: string): string {
    const parts = arn.split('/');
    return parts[parts.length - 1] || parts[parts.length - 2] || arn;
  }

  /**
   * Extract resource name from ARN
   */
  private extractResourceName(arn: string): string {
    const parts = arn.split(':');
    const resourcePart = parts[parts.length - 1] || '';
    const nameParts = resourcePart.split('/');
    return nameParts[nameParts.length - 1] || resourcePart;
  }

  // ==========================================================================
  // Proactive Insights
  // ==========================================================================

  async getInsights(options?: GetInsightsOptions): Promise<ConversationalOperationResult<ProactiveInsight[]>> {
    try {
      let insights = Array.from(this.insights.values());

      // Apply filters
      if (options?.category) {
        insights = insights.filter(i => i.category === options.category);
      }
      if (options?.severity) {
        insights = insights.filter(i => i.severity === options.severity);
      }
      if (options?.status) {
        insights = insights.filter(i => i.status === options.status);
      }
      if (!options?.includeDismissed) {
        insights = insights.filter(i => i.status !== 'dismissed');
      }

      // Sort by severity and date
      const severityOrder: Record<InsightSeverity, number> = {
        critical: 0, high: 1, medium: 2, low: 3, info: 4
      };
      insights.sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.detectedAt.getTime() - a.detectedAt.getTime();
      });

      // Apply limit
      if (options?.limit) {
        insights = insights.slice(0, options.limit);
      }

      return success(insights);
    } catch (error) {
      return failure(`Failed to get insights: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getInsight(insightId: string): Promise<ConversationalOperationResult<ProactiveInsight>> {
    const insight = this.insights.get(insightId);
    if (!insight) {
      return failure(`Insight not found: ${insightId}`);
    }
    return success(insight);
  }

  async acknowledgeInsight(insightId: string): Promise<ConversationalOperationResult<void>> {
    const insight = this.insights.get(insightId);
    if (!insight) {
      return failure(`Insight not found: ${insightId}`);
    }
    insight.status = 'acknowledged';
    insight.updatedAt = new Date();
    return success(undefined, 'Insight acknowledged');
  }

  async dismissInsight(insightId: string): Promise<ConversationalOperationResult<void>> {
    const insight = this.insights.get(insightId);
    if (!insight) {
      return failure(`Insight not found: ${insightId}`);
    }
    insight.status = 'dismissed';
    insight.updatedAt = new Date();
    return success(undefined, 'Insight dismissed');
  }

  async snoozeInsight(insightId: string, untilDate: Date): Promise<ConversationalOperationResult<void>> {
    const insight = this.insights.get(insightId);
    if (!insight) {
      return failure(`Insight not found: ${insightId}`);
    }
    insight.status = 'snoozed';
    insight.snoozeUntil = untilDate;
    insight.updatedAt = new Date();
    return success(undefined, `Insight snoozed until ${untilDate.toISOString()}`);
  }

  async resolveInsight(insightId: string): Promise<ConversationalOperationResult<void>> {
    const insight = this.insights.get(insightId);
    if (!insight) {
      return failure(`Insight not found: ${insightId}`);
    }
    insight.status = 'resolved';
    insight.updatedAt = new Date();
    return success(undefined, 'Insight resolved');
  }

  async runInsightChecks(checkIds?: string[]): Promise<ConversationalOperationResult<ProactiveInsight[]>> {
    const newInsights: ProactiveInsight[] = [];

    try {
      const checksToRun = checkIds
        ? checkIds.map(id => this.insightChecks.get(id)).filter(Boolean) as InsightCheckConfig[]
        : Array.from(this.insightChecks.values()).filter(c => c.enabled);

      for (const check of checksToRun) {
        try {
          const insights = await this.runSingleCheck(check);
          newInsights.push(...insights);
          check.lastChecked = new Date();
        } catch (error) {
          console.error(`Check ${check.id} failed:`, error);
        }
      }

      // Add new insights to the collection
      for (const insight of newInsights) {
        // Check for duplicate
        const existingKey = `${insight.category}-${insight.service}-${insight.affectedResources.map(r => r.id).join(',')}`;
        let isDuplicate = false;
        for (const [, existing] of this.insights) {
          const existingKeyCheck = `${existing.category}-${existing.service}-${existing.affectedResources.map(r => r.id).join(',')}`;
          if (existingKey === existingKeyCheck && existing.status !== 'resolved') {
            isDuplicate = true;
            break;
          }
        }
        if (!isDuplicate) {
          this.insights.set(insight.id, insight);
        }
      }

      return success(newInsights, `Found ${newInsights.length} new insight(s)`);
    } catch (error) {
      return failure(`Failed to run insight checks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Run a single insight check
   */
  private async runSingleCheck(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    switch (check.id) {
      case 'unused-ebs-volumes':
        insights.push(...await this.checkUnusedEBSVolumes(check));
        break;
      case 'unused-elastic-ips':
        insights.push(...await this.checkUnusedElasticIPs(check));
        break;
      case 'idle-rds-instances':
        insights.push(...await this.checkIdleRDSInstances(check));
        break;
      case 'underutilized-ec2':
        insights.push(...await this.checkUnderutilizedEC2(check));
        break;
      case 'old-snapshots':
        insights.push(...await this.checkOldSnapshots(check));
        break;
      case 'public-s3-buckets':
        insights.push(...await this.checkPublicS3Buckets(check));
        break;
      case 'open-security-groups':
        insights.push(...await this.checkOpenSecurityGroups(check));
        break;
      case 'iam-users-without-mfa':
        insights.push(...await this.checkIAMUsersWithoutMFA(check));
        break;
      case 'rds-storage-capacity':
        insights.push(...await this.checkRDSStorageCapacity(check));
        break;
      case 'single-az-databases':
        insights.push(...await this.checkSingleAZDatabases(check));
        break;
      case 'pending-maintenance':
        insights.push(...await this.checkPendingMaintenance(check));
        break;
      // Add more checks as needed
    }

    return insights;
  }

  /**
   * Check for unused EBS volumes
   */
  private async checkUnusedEBSVolumes(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.ec2Client.send(new DescribeVolumesCommand({
        Filters: [{ Name: 'status', Values: ['available'] }],
      }));

      if (response.Volumes && response.Volumes.length > 0) {
        const resources: ResourceReference[] = response.Volumes.map(vol => ({
          type: 'ec2:instance' as TrackedResourceType, // Volume would be a separate type
          id: vol.VolumeId || '',
          name: tagsToRecord(vol.Tags)['Name'] || vol.VolumeId || '',
          region: this.context.activeRegion,
          tags: tagsToRecord(vol.Tags),
          lastAccessed: new Date(),
          accessCount: 1,
          metadata: { size: vol.Size, type: vol.VolumeType },
        }));

        const totalSize = response.Volumes.reduce((sum, vol) => sum + (vol.Size || 0), 0);
        const estimatedMonthlyCost = totalSize * 0.10; // Approximate EBS gp2 cost

        insights.push({
          id: uuidv4(),
          title: `${response.Volumes.length} Unused EBS Volume(s) Found`,
          description: `Found ${response.Volumes.length} EBS volume(s) with total size of ${totalSize} GB that are not attached to any instance.`,
          category: 'cost',
          severity: response.Volumes.length > 5 ? 'high' : 'medium',
          status: 'new',
          affectedResources: resources,
          detectedAt: new Date(),
          updatedAt: new Date(),
          impact: {
            type: 'cost',
            estimatedCostImpact: estimatedMonthlyCost,
            currentValue: `${totalSize} GB`,
            unit: 'GB',
          },
          recommendations: [
            {
              id: '1',
              title: 'Delete unused volumes',
              description: 'Delete EBS volumes that are no longer needed to stop incurring storage charges.',
              priority: 1,
              effort: 'minimal',
              automatable: true,
              action: 'aws_ec2',
              actionParameters: { action: 'delete_volume' },
            },
            {
              id: '2',
              title: 'Create snapshots before deletion',
              description: 'Take snapshots of volumes before deletion if you might need the data later.',
              priority: 2,
              effort: 'low',
              automatable: true,
            },
          ],
          service: 'EC2',
          source: 'Insight Check',
        });
      }
    } catch (error) {
      console.error('Failed to check unused EBS volumes:', error);
    }

    return insights;
  }

  /**
   * Check for unused Elastic IPs
   */
  private async checkUnusedElasticIPs(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.ec2Client.send(new DescribeAddressesCommand({}));

      const unusedIPs = response.Addresses?.filter(addr => !addr.AssociationId) || [];

      if (unusedIPs.length > 0) {
        const resources: ResourceReference[] = unusedIPs.map(addr => ({
          type: 'other' as TrackedResourceType,
          id: addr.AllocationId || addr.PublicIp || '',
          name: addr.PublicIp || '',
          region: this.context.activeRegion,
          tags: tagsToRecord(addr.Tags),
          lastAccessed: new Date(),
          accessCount: 1,
        }));

        insights.push({
          id: uuidv4(),
          title: `${unusedIPs.length} Unused Elastic IP(s) Found`,
          description: `Found ${unusedIPs.length} Elastic IP address(es) that are not associated with any instance or network interface. You are charged $0.005/hour for each unused Elastic IP.`,
          category: 'cost',
          severity: unusedIPs.length > 3 ? 'medium' : 'low',
          status: 'new',
          affectedResources: resources,
          detectedAt: new Date(),
          updatedAt: new Date(),
          impact: {
            type: 'cost',
            estimatedCostImpact: unusedIPs.length * 0.005 * 24 * 30,
            currentValue: unusedIPs.length,
            unit: 'IPs',
          },
          recommendations: [
            {
              id: '1',
              title: 'Release unused Elastic IPs',
              description: 'Release Elastic IP addresses that are no longer needed.',
              priority: 1,
              effort: 'minimal',
              automatable: true,
            },
          ],
          service: 'EC2',
          source: 'Insight Check',
        });
      }
    } catch (error) {
      console.error('Failed to check unused Elastic IPs:', error);
    }

    return insights;
  }

  /**
   * Check for idle RDS instances
   */
  private async checkIdleRDSInstances(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.rdsClient.send(new DescribeDBInstancesCommand({}));
      const connectionThreshold = check.thresholds?.connectionThreshold || 5;

      for (const instance of response.DBInstances || []) {
        if (instance.DBInstanceStatus !== 'available') continue;

        // Check CloudWatch for connection metrics
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

        const metricResponse = await this.cloudWatchClient.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/RDS',
          MetricName: 'DatabaseConnections',
          Dimensions: [{ Name: 'DBInstanceIdentifier', Value: instance.DBInstanceIdentifier }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600,
          Statistics: ['Average'],
        }));

        const avgConnections = metricResponse.Datapoints?.reduce((sum, dp) => sum + (dp.Average || 0), 0) || 0;
        const dataPoints = metricResponse.Datapoints?.length || 1;
        const avgPerHour = avgConnections / dataPoints;

        if (avgPerHour < connectionThreshold) {
          insights.push({
            id: uuidv4(),
            title: `Idle RDS Instance: ${instance.DBInstanceIdentifier}`,
            description: `RDS instance ${instance.DBInstanceIdentifier} has averaged only ${avgPerHour.toFixed(1)} connections per hour over the past week.`,
            category: 'cost',
            severity: 'medium',
            status: 'new',
            affectedResources: [{
              type: 'rds:instance',
              id: instance.DBInstanceIdentifier || '',
              name: instance.DBInstanceIdentifier || '',
              region: this.context.activeRegion,
              arn: instance.DBInstanceArn,
              lastAccessed: new Date(),
              accessCount: 1,
              metadata: {
                instanceClass: instance.DBInstanceClass,
                engine: instance.Engine,
                multiAZ: instance.MultiAZ,
              },
            }],
            detectedAt: new Date(),
            updatedAt: new Date(),
            impact: {
              type: 'cost',
              currentValue: avgPerHour,
              threshold: connectionThreshold,
              unit: 'connections/hour',
            },
            recommendations: [
              {
                id: '1',
                title: 'Consider stopping or downsizing',
                description: 'If this is a development or test database, consider stopping it when not in use.',
                priority: 1,
                effort: 'low',
                automatable: true,
              },
              {
                id: '2',
                title: 'Review database usage',
                description: 'Review application logs to understand if this database is still needed.',
                priority: 2,
                effort: 'medium',
                automatable: false,
              },
            ],
            service: 'RDS',
            source: 'Insight Check',
          });
        }
      }
    } catch (error) {
      console.error('Failed to check idle RDS instances:', error);
    }

    return insights;
  }

  /**
   * Check for underutilized EC2 instances
   */
  private async checkUnderutilizedEC2(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.ec2Client.send(new DescribeInstancesCommand({
        Filters: [{ Name: 'instance-state-name', Values: ['running'] }],
      }));

      const cpuThreshold = check.thresholds?.cpuThreshold || 10;

      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          const endTime = new Date();
          const startTime = new Date(endTime.getTime() - 14 * 24 * 60 * 60 * 1000);

          const metricResponse = await this.cloudWatchClient.send(new GetMetricStatisticsCommand({
            Namespace: 'AWS/EC2',
            MetricName: 'CPUUtilization',
            Dimensions: [{ Name: 'InstanceId', Value: instance.InstanceId }],
            StartTime: startTime,
            EndTime: endTime,
            Period: 86400,
            Statistics: ['Average'],
          }));

          const avgCpu = metricResponse.Datapoints?.reduce((sum, dp) => sum + (dp.Average || 0), 0) || 0;
          const dataPoints = metricResponse.Datapoints?.length || 1;
          const avgCpuPercent = avgCpu / dataPoints;

          if (avgCpuPercent < cpuThreshold) {
            const tags = tagsToRecord(instance.Tags);

            insights.push({
              id: uuidv4(),
              title: `Underutilized EC2 Instance: ${tags['Name'] || instance.InstanceId}`,
              description: `EC2 instance ${instance.InstanceId} has averaged only ${avgCpuPercent.toFixed(1)}% CPU utilization over the past 14 days.`,
              category: 'cost',
              severity: 'medium',
              status: 'new',
              affectedResources: [{
                type: 'ec2:instance',
                id: instance.InstanceId || '',
                name: tags['Name'] || instance.InstanceId || '',
                region: this.context.activeRegion,
                tags: tags,
                lastAccessed: new Date(),
                accessCount: 1,
                environment: detectEnvironment(tags),
                metadata: { instanceType: instance.InstanceType },
              }],
              detectedAt: new Date(),
              updatedAt: new Date(),
              impact: {
                type: 'cost',
                currentValue: avgCpuPercent,
                threshold: cpuThreshold,
                unit: '% CPU',
              },
              recommendations: [
                {
                  id: '1',
                  title: 'Rightsize the instance',
                  description: 'Consider downsizing to a smaller instance type to reduce costs.',
                  priority: 1,
                  effort: 'medium',
                  automatable: true,
                },
              ],
              service: 'EC2',
              source: 'Insight Check',
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to check underutilized EC2:', error);
    }

    return insights;
  }

  /**
   * Check for old snapshots
   */
  private async checkOldSnapshots(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const daysOld = check.thresholds?.daysOld || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const response = await this.ec2Client.send(new DescribeSnapshotsCommand({
        OwnerIds: ['self'],
      }));

      const oldSnapshots = response.Snapshots?.filter(
        snap => snap.StartTime && snap.StartTime < cutoffDate
      ) || [];

      if (oldSnapshots.length > 0) {
        const totalSize = oldSnapshots.reduce((sum, snap) => sum + (snap.VolumeSize || 0), 0);

        insights.push({
          id: uuidv4(),
          title: `${oldSnapshots.length} Old EBS Snapshot(s) Found`,
          description: `Found ${oldSnapshots.length} EBS snapshot(s) older than ${daysOld} days with total size of ${totalSize} GB.`,
          category: 'cost',
          severity: oldSnapshots.length > 10 ? 'medium' : 'low',
          status: 'new',
          affectedResources: oldSnapshots.slice(0, 10).map(snap => ({
            type: 'other' as TrackedResourceType,
            id: snap.SnapshotId || '',
            name: snap.SnapshotId || '',
            region: this.context.activeRegion,
            tags: tagsToRecord(snap.Tags),
            lastAccessed: new Date(),
            accessCount: 1,
          })),
          detectedAt: new Date(),
          updatedAt: new Date(),
          impact: {
            type: 'cost',
            estimatedCostImpact: totalSize * 0.05, // Approximate snapshot storage cost
            currentValue: oldSnapshots.length,
            unit: 'snapshots',
          },
          recommendations: [
            {
              id: '1',
              title: 'Review and delete old snapshots',
              description: 'Review snapshots and delete those that are no longer needed.',
              priority: 1,
              effort: 'low',
              automatable: true,
            },
            {
              id: '2',
              title: 'Implement snapshot lifecycle policy',
              description: 'Use AWS Data Lifecycle Manager to automatically manage snapshot retention.',
              priority: 2,
              effort: 'medium',
              automatable: true,
            },
          ],
          service: 'EC2',
          source: 'Insight Check',
        });
      }
    } catch (error) {
      console.error('Failed to check old snapshots:', error);
    }

    return insights;
  }

  /**
   * Check for public S3 buckets
   */
  private async checkPublicS3Buckets(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.s3Client.send(new ListBucketsCommand({}));
      const publicBuckets: string[] = [];

      for (const bucket of response.Buckets || []) {
        if (!bucket.Name) continue;

        try {
          const policyStatus = await this.s3Client.send(new GetBucketPolicyStatusCommand({
            Bucket: bucket.Name,
          }));

          if (policyStatus.PolicyStatus?.IsPublic) {
            publicBuckets.push(bucket.Name);
          }
        } catch (error) {
          // No policy status means likely not public
        }
      }

      if (publicBuckets.length > 0) {
        insights.push({
          id: uuidv4(),
          title: `${publicBuckets.length} Public S3 Bucket(s) Found`,
          description: `Found ${publicBuckets.length} S3 bucket(s) with public access. This may expose sensitive data.`,
          category: 'security',
          severity: 'critical',
          status: 'new',
          affectedResources: publicBuckets.map(name => ({
            type: 's3:bucket',
            id: name,
            name: name,
            region: 'global',
            lastAccessed: new Date(),
            accessCount: 1,
          })),
          detectedAt: new Date(),
          updatedAt: new Date(),
          impact: {
            type: 'security',
            riskLevel: 'critical',
          },
          recommendations: [
            {
              id: '1',
              title: 'Review bucket policies',
              description: 'Review and update bucket policies to restrict public access.',
              priority: 1,
              effort: 'low',
              automatable: true,
              action: 'aws_s3',
            },
            {
              id: '2',
              title: 'Enable S3 Block Public Access',
              description: 'Enable S3 Block Public Access at the account level for additional protection.',
              priority: 2,
              effort: 'minimal',
              automatable: true,
            },
          ],
          service: 'S3',
          source: 'Insight Check',
        });
      }
    } catch (error) {
      console.error('Failed to check public S3 buckets:', error);
    }

    return insights;
  }

  /**
   * Check for overly permissive security groups
   */
private async checkOpenSecurityGroups(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
  const insights: ProactiveInsight[] = [];

  try {
    const response = await this.ec2Client.send(new DescribeSecurityGroupsCommand({}));
    const openGroups: { group: any; rules: string[] }[] = [];

      for (const sg of response.SecurityGroups || []) {
        const dangerousRules: string[] = [];

        for (const rule of sg.IpPermissions || []) {
          for (const range of rule.IpRanges || []) {
            if (range.CidrIp === '0.0.0.0/0') {
              // Check for dangerous ports
              if (rule.FromPort === 22 || rule.ToPort === 22) {
                dangerousRules.push(`SSH (22) open to 0.0.0.0/0`);
              }
              if (rule.FromPort === 3389 || rule.ToPort === 3389) {
                dangerousRules.push(`RDP (3389) open to 0.0.0.0/0`);
              }
              if (rule.FromPort === 3306 || rule.ToPort === 3306) {
                dangerousRules.push(`MySQL (3306) open to 0.0.0.0/0`);
              }
              if (rule.FromPort === 5432 || rule.ToPort === 5432) {
                dangerousRules.push(`PostgreSQL (5432) open to 0.0.0.0/0`);
              }
              if ((rule.FromPort === -1 || rule.FromPort === 0) && rule.ToPort === -1) {
                dangerousRules.push(`All traffic open to 0.0.0.0/0`);
              }
            }
          }
        }

        if (dangerousRules.length > 0) {
          openGroups.push({
            group: sg, rules: dangerousRules,
            y: undefined
          });
        }
      }

      if (openGroups.length > 0) {
        for (const { group, rules } of openGroups) {
          insights.push({
            id: uuidv4(),
            title: `Overly Permissive Security Group: ${group.GroupName}`,
            description: `Security group ${group.GroupId} (${group.GroupName}) has dangerous inbound rules: ${rules.join(', ')}`,
            category: 'security',
            severity: rules.some(r => r.includes('All traffic')) ? 'critical' : 'high',
            status: 'new',
            affectedResources: [{
              type: 'ec2:security-group',
              id: group.GroupId || '',
              name: group.GroupName || '',
              region: this.context.activeRegion,
              tags: tagsToRecord(group.Tags),
              lastAccessed: new Date(),
              accessCount: 1,
              metadata: { vpcId: group.VpcId, rules },
            }],
            detectedAt: new Date(),
            updatedAt: new Date(),
            impact: {
              type: 'security',
              riskLevel: 'high',
            },
            recommendations: [
              {
                id: '1',
                title: 'Restrict inbound rules',
                description: 'Update security group rules to allow access only from known IP addresses or security groups.',
                priority: 1,
                effort: 'low',
                automatable: true,
                action: 'aws_ec2',
              },
            ],
            service: 'EC2',
            source: 'Insight Check',
          });
        }
      }
    } catch (error) {
      console.error('Failed to check open security groups:', error);
    }

    return insights;
  }

  /**
   * Check for IAM users without MFA
   */
  private async checkIAMUsersWithoutMFA(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.iamClient.send(new ListUsersCommand({}));
      const usersWithoutMFA: string[] = [];

      for (const user of response.Users || []) {
        if (!user.UserName) continue;

        const accountSummary = await this.iamClient.send(new GetAccountSummaryCommand({}));
        const mfaDevices = accountSummary.SummaryMap?.MFADevicesInUse || 0;
        const users = accountSummary.SummaryMap?.Users || 0;

        // This is a simplified check - in production you'd check per-user MFA
        if (mfaDevices < users) {
          usersWithoutMFA.push(user.UserName);
        }
      }

      if (usersWithoutMFA.length > 0) {
        insights.push({
          id: uuidv4(),
          title: `${usersWithoutMFA.length} IAM User(s) Without MFA`,
          description: `Found ${usersWithoutMFA.length} IAM user(s) that do not have MFA enabled. This is a security risk.`,
          category: 'security',
          severity: 'high',
          status: 'new',
          affectedResources: usersWithoutMFA.map(name => ({
            type: 'iam:user',
            id: name,
            name: name,
            region: 'global',
            lastAccessed: new Date(),
            accessCount: 1,
          })),
          detectedAt: new Date(),
          updatedAt: new Date(),
          impact: {
            type: 'security',
            riskLevel: 'high',
          },
          recommendations: [
            {
              id: '1',
              title: 'Enable MFA for all users',
              description: 'Require MFA for all IAM users to improve account security.',
              priority: 1,
              effort: 'low',
              automatable: false,
              documentationUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa.html',
            },
          ],
          service: 'IAM',
          source: 'Insight Check',
        });
      }
    } catch (error) {
      console.error('Failed to check IAM users without MFA:', error);
    }

    return insights;
  }

  /**
   * Check RDS storage capacity
   */
  private async checkRDSStorageCapacity(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.rdsClient.send(new DescribeDBInstancesCommand({}));
      const usageThreshold = check.thresholds?.usageThreshold || 85;

      for (const instance of response.DBInstances || []) {
        if (!instance.DBInstanceIdentifier || instance.DBInstanceStatus !== 'available') continue;

        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

        const metricResponse = await this.cloudWatchClient.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/RDS',
          MetricName: 'FreeStorageSpace',
          Dimensions: [{ Name: 'DBInstanceIdentifier', Value: instance.DBInstanceIdentifier }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600,
          Statistics: ['Average'],
        }));

        const avgFreeSpace = metricResponse.Datapoints?.reduce((sum, dp) => sum + (dp.Average || 0), 0) || 0;
        const dataPoints = metricResponse.Datapoints?.length || 1;
        const avgFreeSpaceGB = (avgFreeSpace / dataPoints) / (1024 * 1024 * 1024);
        const allocatedStorage = instance.AllocatedStorage || 0;
        const usedPercent = allocatedStorage > 0 ? ((allocatedStorage - avgFreeSpaceGB) / allocatedStorage) * 100 : 0;

        if (usedPercent > usageThreshold) {
          insights.push({
            id: uuidv4(),
            title: `RDS Storage Running Low: ${instance.DBInstanceIdentifier}`,
            description: `RDS instance ${instance.DBInstanceIdentifier} is at ${usedPercent.toFixed(1)}% storage capacity (${avgFreeSpaceGB.toFixed(1)} GB free of ${allocatedStorage} GB).`,
            category: 'capacity',
            severity: usedPercent > 95 ? 'critical' : 'high',
            status: 'new',
            affectedResources: [{
              type: 'rds:instance',
              id: instance.DBInstanceIdentifier,
              name: instance.DBInstanceIdentifier,
              region: this.context.activeRegion,
              arn: instance.DBInstanceArn,
              lastAccessed: new Date(),
              accessCount: 1,
              metadata: {
                allocatedStorage,
                freeSpaceGB: avgFreeSpaceGB,
                usedPercent,
              },
            }],
            detectedAt: new Date(),
            updatedAt: new Date(),
            impact: {
              type: 'availability',
              currentValue: usedPercent,
              threshold: usageThreshold,
              unit: '% used',
              riskLevel: usedPercent > 95 ? 'critical' : 'high',
            },
            recommendations: [
              {
                id: '1',
                title: 'Increase storage',
                description: 'Modify the RDS instance to increase allocated storage.',
                priority: 1,
                effort: 'low',
                automatable: true,
                action: 'aws_rds',
              },
              {
                id: '2',
                title: 'Enable storage autoscaling',
                description: 'Enable storage autoscaling to automatically increase storage when needed.',
                priority: 2,
                effort: 'minimal',
                automatable: true,
              },
            ],
            service: 'RDS',
            source: 'Insight Check',
          });
        }
      }
    } catch (error) {
      console.error('Failed to check RDS storage capacity:', error);
    }

    return insights;
  }

  /**
   * Check for single-AZ databases
   */
  private async checkSingleAZDatabases(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.rdsClient.send(new DescribeDBInstancesCommand({}));
      const singleAZInstances = response.DBInstances?.filter(
        db => db.DBInstanceStatus === 'available' && !db.MultiAZ
      ) || [];

      if (singleAZInstances.length > 0) {
        for (const instance of singleAZInstances) {
          const tags = instance.TagList ? tagsToRecord(instance.TagList.map(t => ({ Key: t.Key, Value: t.Value }))) : {};
          const environment = detectEnvironment(tags, instance.DBInstanceIdentifier);

          // Only flag production databases
          if (environment === 'production' || environment === 'prod') {
            insights.push({
              id: uuidv4(),
              title: `Single-AZ Production Database: ${instance.DBInstanceIdentifier}`,
              description: `Production RDS instance ${instance.DBInstanceIdentifier} is running in a single Availability Zone, which poses a risk during AZ failures.`,
              category: 'reliability',
              severity: 'high',
              status: 'new',
              affectedResources: [{
                type: 'rds:instance',
                id: instance.DBInstanceIdentifier || '',
                name: instance.DBInstanceIdentifier || '',
                region: this.context.activeRegion,
                arn: instance.DBInstanceArn,
                lastAccessed: new Date(),
                accessCount: 1,
                environment: environment,
              }],
              detectedAt: new Date(),
              updatedAt: new Date(),
              impact: {
                type: 'availability',
                riskLevel: 'high',
              },
              recommendations: [
                {
                  id: '1',
                  title: 'Enable Multi-AZ',
                  description: 'Modify the RDS instance to enable Multi-AZ deployment for automatic failover.',
                  priority: 1,
                  effort: 'low',
                  automatable: true,
                  action: 'aws_rds',
                },
              ],
              service: 'RDS',
              source: 'Insight Check',
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to check single-AZ databases:', error);
    }

    return insights;
  }

  /**
   * Check for pending maintenance
   */
  private async checkPendingMaintenance(check: InsightCheckConfig): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    try {
      const response = await this.rdsClient.send(new DescribePendingMaintenanceActionsCommand({}));

      const pendingActions = response.PendingMaintenanceActions || [];
      if (pendingActions.length > 0) {
        for (const action of pendingActions) {
          const resourceId = action.ResourceIdentifier?.split(':').pop() || '';

          for (const detail of action.PendingMaintenanceActionDetails || []) {
            insights.push({
              id: uuidv4(),
              title: `Pending Maintenance: ${resourceId}`,
              description: `RDS resource ${resourceId} has pending maintenance: ${detail.Action}. ${detail.Description || ''}`,
              category: 'operational',
              severity: detail.ForcedApplyDate ? 'high' : 'medium',
              status: 'new',
              affectedResources: [{
                type: 'rds:instance',
                id: resourceId,
                name: resourceId,
                region: this.context.activeRegion,
                arn: action.ResourceIdentifier,
                lastAccessed: new Date(),
                accessCount: 1,
              }],
              detectedAt: new Date(),
              updatedAt: new Date(),
              impact: {
                type: 'availability',
                estimatedTimeToImpact: detail.ForcedApplyDate ? detail.ForcedApplyDate.toISOString() : undefined,
              },
              recommendations: [
                {
                  id: '1',
                  title: 'Apply maintenance during window',
                  description: 'Apply the pending maintenance during a scheduled maintenance window to minimize impact.',
                  priority: 1,
                  effort: 'low',
                  automatable: true,
                  action: 'aws_rds',
                },
              ],
              service: 'RDS',
              source: 'Insight Check',
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to check pending maintenance:', error);
    }

    return insights;
  }

  async getInsightChecks(): Promise<ConversationalOperationResult<InsightCheckConfig[]>> {
    return success(Array.from(this.insightChecks.values()));
  }

  async updateInsightCheck(checkId: string, enabled: boolean): Promise<ConversationalOperationResult<void>> {
    const check = this.insightChecks.get(checkId);
    if (!check) {
      return failure(`Insight check not found: ${checkId}`);
    }
    check.enabled = enabled;
    return success(undefined, `Insight check ${checkId} ${enabled ? 'enabled' : 'disabled'}`);
  }

  // ==========================================================================
  // Wizard Mode
  // ==========================================================================

  async getWizardTemplates(): Promise<ConversationalOperationResult<WizardTemplate[]>> {
    return success(WIZARD_TEMPLATES);
  }

  async getWizardTemplate(templateId: string): Promise<ConversationalOperationResult<WizardTemplate>> {
    const template = WIZARD_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      return failure(`Wizard template not found: ${templateId}`);
    }
    return success(template);
  }

  async startWizard(templateId: string): Promise<ConversationalOperationResult<WizardState>> {
    const template = WIZARD_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      return failure(`Wizard template not found: ${templateId}`);
    }

    const wizardId = uuidv4();
    const totalSteps = template.stepDefinitions.length;

    const steps: WizardStep[] = template.stepDefinitions.map((def, index) => ({
      ...def,
      stepNumber: index + 1,
      totalSteps,
      completed: false,
      canGoBack: index > 0,
    }));

    const state: WizardState = {
      wizardId,
      type: template.type,
      title: template.name,
      description: template.description,
      currentStepIndex: 0,
      steps,
      values: {},
      status: 'in-progress',
      startedAt: new Date(),
    };

    this.wizardStates.set(wizardId, state);
    return success(state);
  }

  async getWizardState(wizardId: string): Promise<ConversationalOperationResult<WizardState>> {
    const state = this.wizardStates.get(wizardId);
    if (!state) {
      return failure(`Wizard not found: ${wizardId}`);
    }
    return success(state);
  }

  async answerWizardStep(wizardId: string, stepId: string, value: unknown): Promise<ConversationalOperationResult<WizardState>> {
    const state = this.wizardStates.get(wizardId);
    if (!state) {
      return failure(`Wizard not found: ${wizardId}`);
    }

    const stepIndex = state.steps.findIndex(s => s.id === stepId);
    if (stepIndex < 0) {
      return failure(`Step not found: ${stepId}`);
    }

    const step = state.steps[stepIndex];
    step.currentValue = value;
    step.completed = true;
    state.values[stepId] = value;

    // Move to next step
    if (stepIndex < state.steps.length - 1) {
      state.currentStepIndex = stepIndex + 1;
    }

    // Check if wizard is complete
    if (state.steps.every(s => s.completed)) {
      // Generate execution plan if at review step
      if (step.type === 'review') {
        const planResult = await this.generateWizardPlan(wizardId);
        if (planResult.success && planResult.data) {
          state.executionPlan = planResult.data;
        }
      }
    }

    return success(state);
  }

  async goBackWizard(wizardId: string): Promise<ConversationalOperationResult<WizardState>> {
    const state = this.wizardStates.get(wizardId);
    if (!state) {
      return failure(`Wizard not found: ${wizardId}`);
    }

    if (state.currentStepIndex > 0) {
      state.currentStepIndex--;
    }

    return success(state);
  }

  async skipWizardStep(wizardId: string): Promise<ConversationalOperationResult<WizardState>> {
    const state = this.wizardStates.get(wizardId);
    if (!state) {
      return failure(`Wizard not found: ${wizardId}`);
    }

    const currentStep = state.steps[state.currentStepIndex];
    if (!currentStep.canSkip) {
      return failure('This step cannot be skipped');
    }

    currentStep.completed = true;
    currentStep.currentValue = null;

    if (state.currentStepIndex < state.steps.length - 1) {
      state.currentStepIndex++;
    }

    return success(state);
  }

  async cancelWizard(wizardId: string): Promise<ConversationalOperationResult<void>> {
    const state = this.wizardStates.get(wizardId);
    if (!state) {
      return failure(`Wizard not found: ${wizardId}`);
    }

    state.status = 'cancelled';
    return success(undefined, 'Wizard cancelled');
  }

  async generateWizardPlan(wizardId: string): Promise<ConversationalOperationResult<WizardExecutionPlan>> {
    const state = this.wizardStates.get(wizardId);
    if (!state) {
      return failure(`Wizard not found: ${wizardId}`);
    }

    const resourcesToCreate: PlannedResource[] = [];
    let estimatedMonthlyCost = 0;
    let order = 1;

    // Generate plan based on wizard type and values
    switch (state.type) {
      case 'web-application':
        // VPC if creating new
        if (state.values['network-setup'] === 'new-vpc') {
          resourcesToCreate.push({
            type: 'ec2:vpc',
            name: 'application-vpc',
            configuration: {
              cidrBlock: '10.0.0.0/16',
              enableDnsHostnames: true,
              enableDnsSupport: true,
            },
            order: order++,
          });
          resourcesToCreate.push({
            type: 'ec2:subnet',
            name: 'public-subnet-1',
            configuration: { cidrBlock: '10.0.1.0/24', public: true },
            dependencies: ['application-vpc'],
            order: order++,
          });
          resourcesToCreate.push({
            type: 'ec2:subnet',
            name: 'private-subnet-1',
            configuration: { cidrBlock: '10.0.2.0/24', public: false },
            dependencies: ['application-vpc'],
            order: order++,
          });
        }

        // EC2 instances with Auto Scaling
        const computeConfig = state.values['compute-config'] as string;
        const instanceType = computeConfig === 'custom' ? 't3.medium' : computeConfig;
        resourcesToCreate.push({
          type: 'ec2:instance',
          name: 'web-server-asg',
          configuration: {
            instanceType,
            autoScaling: state.values['scaling-config'],
          },
          estimatedMonthlyCost: 50,
          order: order++,
        });
        estimatedMonthlyCost += 50;

        // Database if selected
        if (state.values['database-config'] && state.values['database-config'] !== 'none') {
          resourcesToCreate.push({
            type: 'rds:instance',
            name: 'application-database',
            configuration: {
              engine: state.values['database-config'],
              instanceClass: 'db.t3.medium',
              allocatedStorage: 20,
            },
            estimatedMonthlyCost: 30,
            order: order++,
          });
          estimatedMonthlyCost += 30;
        }
        break;

      case 'serverless-api':
        resourcesToCreate.push({
          type: 'apigateway:rest-api',
          name: 'api-gateway',
          configuration: {
            type: state.values['api-config'],
            authentication: state.values['auth-config'],
          },
          estimatedMonthlyCost: 5,
          order: order++,
        });
        resourcesToCreate.push({
          type: 'lambda:function',
          name: 'api-handler',
          configuration: {
            runtime: state.values['runtime-config'],
            memorySize: 256,
          },
          estimatedMonthlyCost: 1,
          order: order++,
        });
        estimatedMonthlyCost += 6;
        break;

      case 'static-website':
        resourcesToCreate.push({
          type: 's3:bucket',
          name: state.values['bucket-config'] as string || 'website-bucket',
          configuration: {
            websiteConfiguration: true,
          },
          estimatedMonthlyCost: 1,
          order: order++,
        });
        if (state.values['cdn-config'] === 'enabled') {
          resourcesToCreate.push({
            type: 'cloudfront:distribution',
            name: 'website-cdn',
            configuration: {
              ssl: state.values['ssl-config'],
            },
            dependencies: ['website-bucket'],
            estimatedMonthlyCost: 10,
            order: order++,
          });
          estimatedMonthlyCost += 10;
        }
        estimatedMonthlyCost += 1;
        break;

      // Add more wizard types...
    }

    const plan: WizardExecutionPlan = {
      id: uuidv4(),
      resourcesToCreate,
      resourcesToModify: [],
      estimatedMonthlyCost,
      estimatedSetupTimeMinutes: resourcesToCreate.length * 2,
      prerequisites: ['Appropriate IAM permissions', 'AWS account access'],
      warnings: resourcesToCreate.length > 10 ? ['This plan creates many resources. Review carefully.'] : undefined,
    };

    state.executionPlan = plan;
    return success(plan);
  }

  async executeWizard(wizardId: string, dryRun = false): Promise<ConversationalOperationResult<WizardState>> {
    const state = this.wizardStates.get(wizardId);
    if (!state) {
      return failure(`Wizard not found: ${wizardId}`);
    }

    if (!state.executionPlan) {
      return failure('No execution plan generated. Please complete all wizard steps first.');
    }

    if (dryRun) {
      return success(state, 'Dry run complete. No resources were created.');
    }

    // In a real implementation, this would create the actual AWS resources
    // For now, we'll simulate the execution
    try {
      state.status = 'completed';
      state.completedAt = new Date();
      state.createdResources = state.executionPlan.resourcesToCreate.map(resource => ({
        type: resource.type,
        id: `simulated-${uuidv4().slice(0, 8)}`,
        name: resource.name,
        region: this.context.activeRegion,
        lastAccessed: new Date(),
        accessCount: 1,
      }));

      // Record the operation
      this.recordOperation({
        id: uuidv4(),
        action: `wizard:${state.type}`,
        service: 'Wizard',
        resources: state.createdResources,
        timestamp: new Date(),
        status: 'success',
        resultSummary: `Created ${state.createdResources.length} resource(s)`,
      });

      return success(state, `Wizard completed successfully. Created ${state.createdResources.length} resource(s).`);
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : 'Unknown error';
      return failure(`Wizard execution failed: ${state.error}`);
    }
  }

  // ==========================================================================
  // Summary and Reporting
  // ==========================================================================

  async getInfrastructureSummary(): Promise<ConversationalOperationResult<InfrastructureSummary>> {
    try {
      const resourceCounts: Record<TrackedResourceType, number> = {} as Record<TrackedResourceType, number>;
      const resourcesByRegion: Record<string, number> = {};
      const resourcesByEnvironment: Record<EnvironmentType, number> = {} as Record<EnvironmentType, number>;

      // Count from recent resources
      for (const resource of this.context.recentResources) {
        resourceCounts[resource.type] = (resourceCounts[resource.type] || 0) + 1;
        resourcesByRegion[resource.region] = (resourcesByRegion[resource.region] || 0) + 1;
        if (resource.environment) {
          resourcesByEnvironment[resource.environment] = (resourcesByEnvironment[resource.environment] || 0) + 1;
        }
      }

      // Get active alarms
      let activeAlarms = 0;
      try {
        const alarmsResponse = await this.cloudWatchClient.send(new DescribeAlarmsCommand({
          StateValue: 'ALARM',
        }));
        activeAlarms = alarmsResponse.MetricAlarms?.length || 0;
      } catch {
        // Ignore errors
      }

      // Get pending insights
      const pendingInsights = Array.from(this.insights.values()).filter(
        i => i.status === 'new' || i.status === 'acknowledged'
      ).length;

      // Determine overall health
      let overallHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
      const criticalInsights = Array.from(this.insights.values()).filter(
        i => i.severity === 'critical' && i.status !== 'resolved' && i.status !== 'dismissed'
      ).length;
      if (criticalInsights > 0 || activeAlarms > 5) {
        overallHealth = 'critical';
      } else if (pendingInsights > 5 || activeAlarms > 0) {
        overallHealth = 'warning';
      }

      const summary: InfrastructureSummary = {
        resourceCounts,
        resourcesByRegion,
        resourcesByEnvironment,
        activeAlarms,
        pendingInsights,
        overallHealth,
        lastUpdated: new Date(),
      };

      return success(summary);
    } catch (error) {
      return failure(`Failed to get infrastructure summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getSessionSummary(): Promise<ConversationalOperationResult<SessionSummary>> {
    const now = new Date();
    const durationMinutes = Math.floor((now.getTime() - this.context.sessionStarted.getTime()) / 60000);

    const operationsByService: Record<string, number> = {};
    let successCount = 0;

    for (const op of this.context.sessionHistory) {
      operationsByService[op.service] = (operationsByService[op.service] || 0) + 1;
      if (op.status === 'success') {
        successCount++;
      }
    }

    const successRate = this.context.sessionHistory.length > 0
      ? (successCount / this.context.sessionHistory.length) * 100
      : 100;

    const topResources = [...this.context.recentResources]
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 5);

    const summary: SessionSummary = {
      durationMinutes,
      operationCount: this.context.sessionHistory.length,
      operationsByService,
      successRate,
      resourcesAccessed: this.context.recentResources.length,
      topResources,
      recentOperations: this.context.sessionHistory.slice(0, 10),
    };

    return success(summary);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AWS Conversational UX Manager
 */
export function createConversationalManager(config?: ConversationalManagerConfig): AWSConversationalManager {
  return new AWSConversationalManager(config);
}
