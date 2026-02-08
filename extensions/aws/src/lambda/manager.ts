/**
 * AWS Lambda Manager
 * Comprehensive Lambda operations implementation
 */

import {
  LambdaClient,
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  ListFunctionsCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  InvokeCommand,
  PublishVersionCommand,
  ListVersionsByFunctionCommand,
  CreateAliasCommand,
  UpdateAliasCommand,
  DeleteAliasCommand,
  GetAliasCommand,
  ListAliasesCommand,
  CreateEventSourceMappingCommand,
  UpdateEventSourceMappingCommand,
  DeleteEventSourceMappingCommand,
  GetEventSourceMappingCommand,
  ListEventSourceMappingsCommand,
  AddPermissionCommand,
  RemovePermissionCommand,
  GetPolicyCommand,
  PublishLayerVersionCommand,
  DeleteLayerVersionCommand,
  GetLayerVersionCommand,
  ListLayersCommand,
  ListLayerVersionsCommand,
  PutFunctionConcurrencyCommand,
  DeleteFunctionConcurrencyCommand,
  GetFunctionConcurrencyCommand,
  PutProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  GetProvisionedConcurrencyConfigCommand,
  ListProvisionedConcurrencyConfigsCommand,
  CreateFunctionUrlConfigCommand,
  UpdateFunctionUrlConfigCommand,
  DeleteFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand,
  ListFunctionUrlConfigsCommand,
  TagResourceCommand,
  UntagResourceCommand,
  ListTagsCommand,
  GetAccountSettingsCommand,
  type FunctionConfiguration,
  type AliasConfiguration,
  type EventSourceMappingConfiguration,
  type LayersListItem,
  type LayerVersionsListItem,
  type FunctionUrlConfig,
  type ProvisionedConcurrencyConfigListItem,
  type SourceAccessType,
} from '@aws-sdk/client-lambda';

import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  type Datapoint,
} from '@aws-sdk/client-cloudwatch';

import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

import type {
  LambdaClientConfig,
  LambdaOperationResult,
  LambdaFunction,
  LambdaCreateFunctionOptions,
  LambdaUpdateCodeOptions,
  LambdaUpdateConfigOptions,
  LambdaEventSourceMapping,
  LambdaCreateEventSourceMappingOptions,
  LambdaAddPermissionOptions,
  LambdaLayer,
  LambdaLayerVersion,
  LambdaPublishLayerVersionOptions,
  LambdaVersion,
  LambdaAlias,
  LambdaPublishVersionOptions,
  LambdaCreateAliasOptions,
  LambdaUpdateAliasOptions,
  LambdaMetrics,
  LambdaGetMetricsOptions,
  LambdaLogEvent,
  LambdaGetLogsOptions,
  LambdaInvokeOptions,
  LambdaInvokeResult,
  LambdaConcurrencyConfig,
  LambdaProvisionedConcurrencyConfig,
  LambdaSetProvisionedConcurrencyOptions,
  LambdaFunctionUrl,
  LambdaCreateFunctionUrlOptions,
  LambdaColdStartAnalysis,
  LambdaWarmupOptions,
  LambdaAccountSettings,
  LambdaRuntime,
  LambdaArchitecture,
} from './types.js';

import { withAWSRetry, type AWSRetryOptions } from '../retry.js';

// ============================================================================
// Lambda Manager Class
// ============================================================================

export class LambdaManager {
  private config: LambdaClientConfig;
  private defaultRegion: string;
  private retryOptions: AWSRetryOptions;

  constructor(config: LambdaClientConfig = {}, retryOptions?: AWSRetryOptions) {
    this.config = config;
    this.defaultRegion = config.region || process.env.AWS_REGION || 'us-east-1';
    this.retryOptions = retryOptions ?? {};
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Execute an AWS API call with retry logic for transient failures
   */
  private async withRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return withAWSRetry(fn, { ...this.retryOptions, label });
  }

  // --------------------------------------------------------------------------
  // Client Factory Methods
  // --------------------------------------------------------------------------

  private getLambdaClient(region?: string): LambdaClient {
    return new LambdaClient({
      region: region || this.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  private getCloudWatchClient(region?: string): CloudWatchClient {
    return new CloudWatchClient({
      region: region || this.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  private getCloudWatchLogsClient(region?: string): CloudWatchLogsClient {
    return new CloudWatchLogsClient({
      region: region || this.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private mapFunctionConfiguration(config: FunctionConfiguration): LambdaFunction {
    return {
      functionName: config.FunctionName || '',
      functionArn: config.FunctionArn || '',
      runtime: (config.Runtime as LambdaRuntime) || 'nodejs20.x',
      role: config.Role || '',
      handler: config.Handler || '',
      codeSize: config.CodeSize || 0,
      description: config.Description,
      timeout: config.Timeout || 3,
      memorySize: config.MemorySize || 128,
      lastModified: config.LastModified || '',
      codeSha256: config.CodeSha256 || '',
      version: config.Version || '$LATEST',
      environment: config.Environment
        ? { variables: config.Environment.Variables || {} }
        : undefined,
      tracingConfig: config.TracingConfig
        ? { mode: config.TracingConfig.Mode as 'Active' | 'PassThrough' }
        : undefined,
      revisionId: config.RevisionId,
      layers: config.Layers?.map((l) => ({
        arn: l.Arn || '',
        codeSize: l.CodeSize || 0,
        signingProfileVersionArn: l.SigningProfileVersionArn,
        signingJobArn: l.SigningJobArn,
      })),
      state: config.State as LambdaFunction['state'],
      stateReason: config.StateReason,
      stateReasonCode: config.StateReasonCode,
      lastUpdateStatus: config.LastUpdateStatus as LambdaFunction['lastUpdateStatus'],
      lastUpdateStatusReason: config.LastUpdateStatusReason,
      lastUpdateStatusReasonCode: config.LastUpdateStatusReasonCode,
      fileSystemConfigs: config.FileSystemConfigs?.map((f) => ({
        arn: f.Arn || '',
        localMountPath: f.LocalMountPath || '',
      })),
      packageType: (config.PackageType as 'Zip' | 'Image') || 'Zip',
      imageConfigResponse: config.ImageConfigResponse
        ? {
            imageConfig: config.ImageConfigResponse.ImageConfig
              ? {
                  entryPoint: config.ImageConfigResponse.ImageConfig.EntryPoint,
                  command: config.ImageConfigResponse.ImageConfig.Command,
                  workingDirectory: config.ImageConfigResponse.ImageConfig.WorkingDirectory,
                }
              : undefined,
            error: config.ImageConfigResponse.Error
              ? {
                  errorCode: config.ImageConfigResponse.Error.ErrorCode,
                  message: config.ImageConfigResponse.Error.Message,
                }
              : undefined,
          }
        : undefined,
      signingProfileVersionArn: config.SigningProfileVersionArn,
      signingJobArn: config.SigningJobArn,
      architectures: (config.Architectures as LambdaArchitecture[]) || ['x86_64'],
      ephemeralStorage: config.EphemeralStorage
        ? { size: config.EphemeralStorage.Size || 512 }
        : undefined,
      snapStart: config.SnapStart
        ? {
            applyOn: config.SnapStart.ApplyOn as 'PublishedVersions' | 'None',
            optimizationStatus: config.SnapStart.OptimizationStatus as 'On' | 'Off' | undefined,
          }
        : undefined,
      runtimeVersionConfig: config.RuntimeVersionConfig
        ? {
            runtimeVersionArn: config.RuntimeVersionConfig.RuntimeVersionArn,
            error: config.RuntimeVersionConfig.Error
              ? {
                  errorCode: config.RuntimeVersionConfig.Error.ErrorCode,
                  message: config.RuntimeVersionConfig.Error.Message,
                }
              : undefined,
          }
        : undefined,
      loggingConfig: config.LoggingConfig
        ? {
            logFormat: config.LoggingConfig.LogFormat as 'JSON' | 'Text' | undefined,
            applicationLogLevel: config.LoggingConfig.ApplicationLogLevel as LambdaFunction['loggingConfig'] extends { applicationLogLevel?: infer T } ? T : never,
            systemLogLevel: config.LoggingConfig.SystemLogLevel as 'DEBUG' | 'INFO' | 'WARN' | undefined,
            logGroup: config.LoggingConfig.LogGroup,
          }
        : undefined,
      vpcConfig: config.VpcConfig
        ? {
            subnetIds: config.VpcConfig.SubnetIds || [],
            securityGroupIds: config.VpcConfig.SecurityGroupIds || [],
            vpcId: config.VpcConfig.VpcId,
            ipv6AllowedForDualStack: config.VpcConfig.Ipv6AllowedForDualStack,
          }
        : undefined,
      deadLetterConfig: config.DeadLetterConfig
        ? { targetArn: config.DeadLetterConfig.TargetArn }
        : undefined,
      kmsKeyArn: config.KMSKeyArn,
      masterArn: config.MasterArn,
      tags: {},
    };
  }

  private mapEventSourceMapping(mapping: EventSourceMappingConfiguration): LambdaEventSourceMapping {
    return {
      uuid: mapping.UUID || '',
      functionArn: mapping.FunctionArn,
      batchSize: mapping.BatchSize,
      maximumBatchingWindowInSeconds: mapping.MaximumBatchingWindowInSeconds,
      parallelizationFactor: mapping.ParallelizationFactor,
      eventSourceArn: mapping.EventSourceArn,
      filterCriteria: mapping.FilterCriteria
        ? {
            filters: (mapping.FilterCriteria.Filters || []).map((f) => ({
              pattern: f.Pattern,
            })),
          }
        : undefined,
      functionResponseTypes: mapping.FunctionResponseTypes as Array<'ReportBatchItemFailures'>,
      startingPosition: mapping.StartingPosition as 'TRIM_HORIZON' | 'LATEST' | 'AT_TIMESTAMP' | undefined,
      startingPositionTimestamp: mapping.StartingPositionTimestamp,
      lastModified: mapping.LastModified,
      lastProcessingResult: mapping.LastProcessingResult,
      state: mapping.State,
      stateTransitionReason: mapping.StateTransitionReason,
      destinationConfig: mapping.DestinationConfig
        ? {
            onSuccess: mapping.DestinationConfig.OnSuccess
              ? { destination: mapping.DestinationConfig.OnSuccess.Destination }
              : undefined,
            onFailure: mapping.DestinationConfig.OnFailure
              ? { destination: mapping.DestinationConfig.OnFailure.Destination }
              : undefined,
          }
        : undefined,
      topics: mapping.Topics,
      queues: mapping.Queues,
      sourceAccessConfigurations: mapping.SourceAccessConfigurations?.map((s) => ({
        type: s.Type,
        uri: s.URI,
      })),
      selfManagedEventSource: mapping.SelfManagedEventSource
        ? { endpoints: mapping.SelfManagedEventSource.Endpoints as Record<string, string[]> }
        : undefined,
      maximumRecordAgeInSeconds: mapping.MaximumRecordAgeInSeconds,
      bisectBatchOnFunctionError: mapping.BisectBatchOnFunctionError,
      maximumRetryAttempts: mapping.MaximumRetryAttempts,
      tumblingWindowInSeconds: mapping.TumblingWindowInSeconds,
      selfManagedKafkaEventSourceConfig: mapping.SelfManagedKafkaEventSourceConfig
        ? { consumerGroupId: mapping.SelfManagedKafkaEventSourceConfig.ConsumerGroupId }
        : undefined,
      amazonManagedKafkaEventSourceConfig: mapping.AmazonManagedKafkaEventSourceConfig
        ? { consumerGroupId: mapping.AmazonManagedKafkaEventSourceConfig.ConsumerGroupId }
        : undefined,
      scalingConfig: mapping.ScalingConfig
        ? { maximumConcurrency: mapping.ScalingConfig.MaximumConcurrency }
        : undefined,
      documentDBEventSourceConfig: mapping.DocumentDBEventSourceConfig
        ? {
            databaseName: mapping.DocumentDBEventSourceConfig.DatabaseName,
            collectionName: mapping.DocumentDBEventSourceConfig.CollectionName,
            fullDocument: mapping.DocumentDBEventSourceConfig.FullDocument as 'UpdateLookup' | 'Default' | undefined,
          }
        : undefined,
    };
  }

  private mapAlias(alias: AliasConfiguration): LambdaAlias {
    return {
      aliasArn: alias.AliasArn || '',
      name: alias.Name || '',
      functionVersion: alias.FunctionVersion || '',
      description: alias.Description,
      routingConfig: alias.RoutingConfig
        ? {
            additionalVersionWeights: alias.RoutingConfig.AdditionalVersionWeights || {},
          }
        : undefined,
      revisionId: alias.RevisionId,
    };
  }

  private mapLayer(layer: LayersListItem): LambdaLayer {
    return {
      layerName: layer.LayerName || '',
      layerArn: layer.LayerArn || '',
      latestMatchingVersion: layer.LatestMatchingVersion
        ? {
            layerVersionArn: layer.LatestMatchingVersion.LayerVersionArn || '',
            version: layer.LatestMatchingVersion.Version || 0,
            description: layer.LatestMatchingVersion.Description,
            createdDate: layer.LatestMatchingVersion.CreatedDate,
            compatibleRuntimes: layer.LatestMatchingVersion.CompatibleRuntimes as LambdaRuntime[],
            licenseInfo: layer.LatestMatchingVersion.LicenseInfo,
            compatibleArchitectures: layer.LatestMatchingVersion.CompatibleArchitectures as LambdaArchitecture[],
          }
        : undefined,
    };
  }

  private mapLayerVersion(version: LayerVersionsListItem): LambdaLayerVersion {
    return {
      layerVersionArn: version.LayerVersionArn || '',
      version: version.Version || 0,
      description: version.Description,
      createdDate: version.CreatedDate,
      compatibleRuntimes: version.CompatibleRuntimes as LambdaRuntime[],
      licenseInfo: version.LicenseInfo,
      compatibleArchitectures: version.CompatibleArchitectures as LambdaArchitecture[],
    };
  }

  private mapFunctionUrl(url: FunctionUrlConfig): LambdaFunctionUrl {
    return {
      functionUrl: url.FunctionUrl || '',
      functionArn: url.FunctionArn || '',
      authType: (url.AuthType as 'NONE' | 'AWS_IAM') || 'AWS_IAM',
      cors: url.Cors
        ? {
            allowCredentials: url.Cors.AllowCredentials,
            allowHeaders: url.Cors.AllowHeaders,
            allowMethods: url.Cors.AllowMethods,
            allowOrigins: url.Cors.AllowOrigins,
            exposeHeaders: url.Cors.ExposeHeaders,
            maxAge: url.Cors.MaxAge,
          }
        : undefined,
      creationTime: url.CreationTime,
      lastModifiedTime: url.LastModifiedTime,
      invokeMode: url.InvokeMode as 'BUFFERED' | 'RESPONSE_STREAM' | undefined,
    };
  }

  private mapProvisionedConcurrencyConfig(
    config: ProvisionedConcurrencyConfigListItem,
    functionName: string
  ): LambdaProvisionedConcurrencyConfig {
    return {
      functionName,
      qualifier: config.FunctionArn?.split(':').pop() || '',
      requestedProvisionedConcurrentExecutions: config.RequestedProvisionedConcurrentExecutions || 0,
      availableProvisionedConcurrentExecutions: config.AvailableProvisionedConcurrentExecutions,
      allocatedProvisionedConcurrentExecutions: config.AllocatedProvisionedConcurrentExecutions,
      status: config.Status as 'IN_PROGRESS' | 'READY' | 'FAILED' | undefined,
      statusReason: config.StatusReason,
      lastModified: config.LastModified,
    };
  }

  // ==========================================================================
  // 1. Lambda Function Deployment
  // ==========================================================================

  /**
   * List Lambda functions
   */
  async listFunctions(options: {
    masterRegion?: string;
    functionVersion?: 'ALL';
    maxItems?: number;
    region?: string;
  } = {}): Promise<LambdaFunction[]> {
    const client = this.getLambdaClient(options.region);
    const functions: LambdaFunction[] = [];
    let marker: string | undefined;

    do {
      const command = new ListFunctionsCommand({
        MasterRegion: options.masterRegion,
        FunctionVersion: options.functionVersion,
        MaxItems: options.maxItems || 50,
        Marker: marker,
      });

      const response = await this.withRetry(
        () => client.send(command),
        'ListFunctions'
      );

      if (response.Functions) {
        for (const fn of response.Functions) {
          functions.push(this.mapFunctionConfiguration(fn));
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return functions;
  }

  /**
   * Get a specific Lambda function
   */
  async getFunction(
    functionName: string,
    qualifier?: string,
    region?: string
  ): Promise<LambdaFunction | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetFunctionCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      const response = await this.withRetry(
        () => client.send(command),
        'GetFunction'
      );

      if (response.Configuration) {
        const fn = this.mapFunctionConfiguration(response.Configuration);
        // Get tags separately
        if (response.Tags) {
          fn.tags = response.Tags;
        }
        return fn;
      }

      return null;
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new Lambda function
   */
  async createFunction(options: LambdaCreateFunctionOptions): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new CreateFunctionCommand({
        FunctionName: options.functionName,
        Runtime: options.runtime,
        Role: options.role,
        Handler: options.handler,
        Code: {
          ZipFile: options.code.zipFile,
          S3Bucket: options.code.s3Bucket,
          S3Key: options.code.s3Key,
          S3ObjectVersion: options.code.s3ObjectVersion,
          ImageUri: options.code.imageUri,
        },
        Description: options.description,
        Timeout: options.timeout || 3,
        MemorySize: options.memorySize || 128,
        Publish: options.publish,
        Environment: options.environment
          ? { Variables: options.environment }
          : undefined,
        VpcConfig: options.vpcConfig
          ? {
              SubnetIds: options.vpcConfig.subnetIds,
              SecurityGroupIds: options.vpcConfig.securityGroupIds,
              Ipv6AllowedForDualStack: options.vpcConfig.ipv6AllowedForDualStack,
            }
          : undefined,
        DeadLetterConfig: options.deadLetterConfig
          ? { TargetArn: options.deadLetterConfig.targetArn }
          : undefined,
        TracingConfig: options.tracingConfig
          ? { Mode: options.tracingConfig.mode }
          : undefined,
        Layers: options.layers,
        FileSystemConfigs: options.fileSystemConfigs?.map((f) => ({
          Arn: f.arn,
          LocalMountPath: f.localMountPath,
        })),
        KMSKeyArn: options.kmsKeyArn,
        Architectures: options.architectures,
        EphemeralStorage: options.ephemeralStorage
          ? { Size: options.ephemeralStorage.size }
          : undefined,
        SnapStart: options.snapStart
          ? { ApplyOn: options.snapStart.applyOn }
          : undefined,
        LoggingConfig: options.loggingConfig
          ? {
              LogFormat: options.loggingConfig.logFormat,
              ApplicationLogLevel: options.loggingConfig.applicationLogLevel,
              SystemLogLevel: options.loggingConfig.systemLogLevel,
              LogGroup: options.loggingConfig.logGroup,
            }
          : undefined,
        Tags: options.tags,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateFunction');
      const fn = response.FunctionArn
        ? this.mapFunctionConfiguration(response)
        : null;

      return {
        success: true,
        message: `Lambda function '${options.functionName}' created`,
        data: fn,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create Lambda function '${options.functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete a Lambda function
   */
  async deleteFunction(
    functionName: string,
    qualifier?: string,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new DeleteFunctionCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      await this.withRetry(() => client.send(command), 'DeleteFunction');

      return {
        success: true,
        message: `Lambda function '${functionName}' deleted`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete Lambda function '${functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Update Lambda function code
   */
  async updateFunctionCode(options: LambdaUpdateCodeOptions): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new UpdateFunctionCodeCommand({
        FunctionName: options.functionName,
        ZipFile: options.code.zipFile,
        S3Bucket: options.code.s3Bucket,
        S3Key: options.code.s3Key,
        S3ObjectVersion: options.code.s3ObjectVersion,
        ImageUri: options.code.imageUri,
        Publish: options.publish,
        DryRun: options.dryRun,
        RevisionId: options.revisionId,
        Architectures: options.architectures,
      });

      const response = await this.withRetry(() => client.send(command), 'UpdateFunctionCode');
      const fn = this.mapFunctionConfiguration(response);

      return {
        success: true,
        message: `Lambda function '${options.functionName}' code updated`,
        data: fn,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to update Lambda function '${options.functionName}' code`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 2. Lambda Function Configuration Management
  // ==========================================================================

  /**
   * Get Lambda function configuration
   */
  async getFunctionConfiguration(
    functionName: string,
    qualifier?: string,
    region?: string
  ): Promise<LambdaFunction | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetFunctionConfigurationCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      const response = await this.withRetry(() => client.send(command), 'GetFunctionConfiguration');
      return this.mapFunctionConfiguration(response);
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update Lambda function configuration
   */
  async updateFunctionConfiguration(
    options: LambdaUpdateConfigOptions
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new UpdateFunctionConfigurationCommand({
        FunctionName: options.functionName,
        Role: options.role,
        Handler: options.handler,
        Description: options.description,
        Timeout: options.timeout,
        MemorySize: options.memorySize,
        VpcConfig: options.vpcConfig
          ? {
              SubnetIds: options.vpcConfig.subnetIds,
              SecurityGroupIds: options.vpcConfig.securityGroupIds,
              Ipv6AllowedForDualStack: options.vpcConfig.ipv6AllowedForDualStack,
            }
          : undefined,
        Environment: options.environment
          ? { Variables: options.environment }
          : undefined,
        Runtime: options.runtime,
        DeadLetterConfig: options.deadLetterConfig
          ? { TargetArn: options.deadLetterConfig.targetArn }
          : undefined,
        KMSKeyArn: options.kmsKeyArn,
        TracingConfig: options.tracingConfig
          ? { Mode: options.tracingConfig.mode }
          : undefined,
        RevisionId: options.revisionId,
        Layers: options.layers,
        FileSystemConfigs: options.fileSystemConfigs?.map((f) => ({
          Arn: f.arn,
          LocalMountPath: f.localMountPath,
        })),
        EphemeralStorage: options.ephemeralStorage
          ? { Size: options.ephemeralStorage.size }
          : undefined,
        SnapStart: options.snapStart
          ? { ApplyOn: options.snapStart.applyOn }
          : undefined,
        LoggingConfig: options.loggingConfig
          ? {
              LogFormat: options.loggingConfig.logFormat,
              ApplicationLogLevel: options.loggingConfig.applicationLogLevel,
              SystemLogLevel: options.loggingConfig.systemLogLevel,
              LogGroup: options.loggingConfig.logGroup,
            }
          : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'UpdateFunctionConfiguration');
      const fn = this.mapFunctionConfiguration(response);

      return {
        success: true,
        message: `Lambda function '${options.functionName}' configuration updated`,
        data: fn,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to update Lambda function '${options.functionName}' configuration`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 3. Lambda Trigger Management (Event Source Mappings)
  // ==========================================================================

  /**
   * List event source mappings for a function
   */
  async listEventSourceMappings(options: {
    functionName?: string;
    eventSourceArn?: string;
    maxItems?: number;
    region?: string;
  } = {}): Promise<LambdaEventSourceMapping[]> {
    const client = this.getLambdaClient(options.region);
    const mappings: LambdaEventSourceMapping[] = [];
    let marker: string | undefined;

    do {
      const command = new ListEventSourceMappingsCommand({
        FunctionName: options.functionName,
        EventSourceArn: options.eventSourceArn,
        MaxItems: options.maxItems || 100,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'ListEventSourceMappings');

      if (response.EventSourceMappings) {
        for (const mapping of response.EventSourceMappings) {
          mappings.push(this.mapEventSourceMapping(mapping));
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return mappings;
  }

  /**
   * Get a specific event source mapping
   */
  async getEventSourceMapping(
    uuid: string,
    region?: string
  ): Promise<LambdaEventSourceMapping | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetEventSourceMappingCommand({
        UUID: uuid,
      });

      const response = await this.withRetry(() => client.send(command), 'GetEventSourceMapping');
      return this.mapEventSourceMapping(response);
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create an event source mapping
   */
  async createEventSourceMapping(
    options: LambdaCreateEventSourceMappingOptions
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new CreateEventSourceMappingCommand({
        FunctionName: options.functionName,
        EventSourceArn: options.eventSourceArn,
        BatchSize: options.batchSize,
        MaximumBatchingWindowInSeconds: options.maximumBatchingWindowInSeconds,
        ParallelizationFactor: options.parallelizationFactor,
        StartingPosition: options.startingPosition,
        StartingPositionTimestamp: options.startingPositionTimestamp,
        Enabled: options.enabled ?? true,
        FilterCriteria: options.filterCriteria
          ? {
              Filters: options.filterCriteria.filters.map((f) => ({
                Pattern: f.pattern,
              })),
            }
          : undefined,
        FunctionResponseTypes: options.functionResponseTypes,
        DestinationConfig: options.destinationConfig
          ? {
              OnSuccess: options.destinationConfig.onSuccess
                ? { Destination: options.destinationConfig.onSuccess.destination }
                : undefined,
              OnFailure: options.destinationConfig.onFailure
                ? { Destination: options.destinationConfig.onFailure.destination }
                : undefined,
            }
          : undefined,
        MaximumRecordAgeInSeconds: options.maximumRecordAgeInSeconds,
        BisectBatchOnFunctionError: options.bisectBatchOnFunctionError,
        MaximumRetryAttempts: options.maximumRetryAttempts,
        TumblingWindowInSeconds: options.tumblingWindowInSeconds,
        Topics: options.topics,
        Queues: options.queues,
        SourceAccessConfigurations: options.sourceAccessConfigurations?.map((s) => ({
          Type: s.type as SourceAccessType,
          URI: s.uri,
        })),
        SelfManagedEventSource: options.selfManagedEventSource
          ? { Endpoints: options.selfManagedEventSource.endpoints }
          : undefined,
        ScalingConfig: options.scalingConfig
          ? { MaximumConcurrency: options.scalingConfig.maximumConcurrency }
          : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateEventSourceMapping');
      const mapping = this.mapEventSourceMapping(response);

      return {
        success: true,
        message: `Event source mapping created for '${options.functionName}'`,
        data: mapping,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create event source mapping for '${options.functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Update an event source mapping
   */
  async updateEventSourceMapping(options: {
    uuid: string;
    functionName?: string;
    enabled?: boolean;
    batchSize?: number;
    maximumBatchingWindowInSeconds?: number;
    filterCriteria?: { filters: Array<{ pattern: string }> };
    destinationConfig?: {
      onSuccess?: { destination: string };
      onFailure?: { destination: string };
    };
    maximumRecordAgeInSeconds?: number;
    bisectBatchOnFunctionError?: boolean;
    maximumRetryAttempts?: number;
    parallelizationFactor?: number;
    scalingConfig?: { maximumConcurrency?: number };
    region?: string;
  }): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new UpdateEventSourceMappingCommand({
        UUID: options.uuid,
        FunctionName: options.functionName,
        Enabled: options.enabled,
        BatchSize: options.batchSize,
        MaximumBatchingWindowInSeconds: options.maximumBatchingWindowInSeconds,
        FilterCriteria: options.filterCriteria
          ? {
              Filters: options.filterCriteria.filters.map((f) => ({
                Pattern: f.pattern,
              })),
            }
          : undefined,
        DestinationConfig: options.destinationConfig
          ? {
              OnSuccess: options.destinationConfig.onSuccess
                ? { Destination: options.destinationConfig.onSuccess.destination }
                : undefined,
              OnFailure: options.destinationConfig.onFailure
                ? { Destination: options.destinationConfig.onFailure.destination }
                : undefined,
            }
          : undefined,
        MaximumRecordAgeInSeconds: options.maximumRecordAgeInSeconds,
        BisectBatchOnFunctionError: options.bisectBatchOnFunctionError,
        MaximumRetryAttempts: options.maximumRetryAttempts,
        ParallelizationFactor: options.parallelizationFactor,
        ScalingConfig: options.scalingConfig
          ? { MaximumConcurrency: options.scalingConfig.maximumConcurrency }
          : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'UpdateEventSourceMapping');
      const mapping = this.mapEventSourceMapping(response);

      return {
        success: true,
        message: `Event source mapping '${options.uuid}' updated`,
        data: mapping,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to update event source mapping '${options.uuid}'`,
        error: message,
      };
    }
  }

  /**
   * Delete an event source mapping
   */
  async deleteEventSourceMapping(
    uuid: string,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new DeleteEventSourceMappingCommand({
        UUID: uuid,
      });

      await this.withRetry(() => client.send(command), 'DeleteEventSourceMapping');

      return {
        success: true,
        message: `Event source mapping '${uuid}' deleted`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete event source mapping '${uuid}'`,
        error: message,
      };
    }
  }

  /**
   * Add permission for a trigger (e.g., API Gateway, S3)
   */
  async addPermission(options: LambdaAddPermissionOptions): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new AddPermissionCommand({
        FunctionName: options.functionName,
        StatementId: options.statementId,
        Action: options.action,
        Principal: options.principal,
        SourceArn: options.sourceArn,
        SourceAccount: options.sourceAccount,
        EventSourceToken: options.eventSourceToken,
        Qualifier: options.qualifier,
        RevisionId: options.revisionId,
        PrincipalOrgID: options.principalOrgID,
        FunctionUrlAuthType: options.functionUrlAuthType,
      });

      const response = await this.withRetry(() => client.send(command), 'AddPermission');

      return {
        success: true,
        message: `Permission '${options.statementId}' added to '${options.functionName}'`,
        data: { statement: response.Statement },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to add permission to '${options.functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Remove a permission from a function
   */
  async removePermission(options: {
    functionName: string;
    statementId: string;
    qualifier?: string;
    revisionId?: string;
    region?: string;
  }): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new RemovePermissionCommand({
        FunctionName: options.functionName,
        StatementId: options.statementId,
        Qualifier: options.qualifier,
        RevisionId: options.revisionId,
      });

      await this.withRetry(() => client.send(command), 'RemovePermission');

      return {
        success: true,
        message: `Permission '${options.statementId}' removed from '${options.functionName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to remove permission from '${options.functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Get function policy (permissions)
   */
  async getPolicy(
    functionName: string,
    qualifier?: string,
    region?: string
  ): Promise<{ policy: string; revisionId?: string } | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetPolicyCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      const response = await this.withRetry(() => client.send(command), 'GetPolicy');

      return {
        policy: response.Policy || '',
        revisionId: response.RevisionId,
      };
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  // ==========================================================================
  // 4. Lambda Environment Variable Management
  // ==========================================================================

  /**
   * Get environment variables for a function
   */
  async getEnvironmentVariables(
    functionName: string,
    region?: string
  ): Promise<Record<string, string> | null> {
    const fn = await this.getFunctionConfiguration(functionName, undefined, region);
    if (!fn) return null;
    return fn.environment?.variables || {};
  }

  /**
   * Set environment variables for a function
   */
  async setEnvironmentVariables(
    functionName: string,
    variables: Record<string, string>,
    region?: string
  ): Promise<LambdaOperationResult> {
    return this.updateFunctionConfiguration({
      functionName,
      environment: variables,
      region,
    });
  }

  /**
   * Add or update specific environment variables
   */
  async updateEnvironmentVariables(
    functionName: string,
    updates: Record<string, string>,
    region?: string
  ): Promise<LambdaOperationResult> {
    const existing = await this.getEnvironmentVariables(functionName, region);
    if (existing === null) {
      return {
        success: false,
        message: `Function '${functionName}' not found`,
        error: 'not_found',
      };
    }

    const merged = { ...existing, ...updates };
    return this.setEnvironmentVariables(functionName, merged, region);
  }

  /**
   * Remove specific environment variables
   */
  async removeEnvironmentVariables(
    functionName: string,
    keys: string[],
    region?: string
  ): Promise<LambdaOperationResult> {
    const existing = await this.getEnvironmentVariables(functionName, region);
    if (existing === null) {
      return {
        success: false,
        message: `Function '${functionName}' not found`,
        error: 'not_found',
      };
    }

    const filtered = { ...existing };
    for (const key of keys) {
      delete filtered[key];
    }

    return this.setEnvironmentVariables(functionName, filtered, region);
  }

  // ==========================================================================
  // 5. Lambda Layer Management
  // ==========================================================================

  /**
   * List Lambda layers
   */
  async listLayers(options: {
    compatibleRuntime?: LambdaRuntime;
    compatibleArchitecture?: LambdaArchitecture;
    maxItems?: number;
    region?: string;
  } = {}): Promise<LambdaLayer[]> {
    const client = this.getLambdaClient(options.region);
    const layers: LambdaLayer[] = [];
    let marker: string | undefined;

    do {
      const command = new ListLayersCommand({
        CompatibleRuntime: options.compatibleRuntime,
        CompatibleArchitecture: options.compatibleArchitecture,
        MaxItems: options.maxItems || 50,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'ListLayers');

      if (response.Layers) {
        for (const layer of response.Layers) {
          layers.push(this.mapLayer(layer));
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return layers;
  }

  /**
   * List layer versions
   */
  async listLayerVersions(options: {
    layerName: string;
    compatibleRuntime?: LambdaRuntime;
    compatibleArchitecture?: LambdaArchitecture;
    maxItems?: number;
    region?: string;
  }): Promise<LambdaLayerVersion[]> {
    const client = this.getLambdaClient(options.region);
    const versions: LambdaLayerVersion[] = [];
    let marker: string | undefined;

    do {
      const command = new ListLayerVersionsCommand({
        LayerName: options.layerName,
        CompatibleRuntime: options.compatibleRuntime,
        CompatibleArchitecture: options.compatibleArchitecture,
        MaxItems: options.maxItems || 50,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'ListLayerVersions');

      if (response.LayerVersions) {
        for (const version of response.LayerVersions) {
          versions.push(this.mapLayerVersion(version));
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return versions;
  }

  /**
   * Get a specific layer version
   */
  async getLayerVersion(
    layerName: string,
    versionNumber: number,
    region?: string
  ): Promise<LambdaLayerVersion | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetLayerVersionCommand({
        LayerName: layerName,
        VersionNumber: versionNumber,
      });

      const response = await this.withRetry(() => client.send(command), 'GetLayerVersion');

      return {
        layerVersionArn: response.LayerVersionArn || '',
        version: response.Version || 0,
        description: response.Description,
        createdDate: response.CreatedDate,
        compatibleRuntimes: response.CompatibleRuntimes as LambdaRuntime[],
        licenseInfo: response.LicenseInfo,
        compatibleArchitectures: response.CompatibleArchitectures as LambdaArchitecture[],
        content: response.Content
          ? {
              location: response.Content.Location,
              codeSha256: response.Content.CodeSha256,
              codeSize: response.Content.CodeSize,
              signingProfileVersionArn: response.Content.SigningProfileVersionArn,
              signingJobArn: response.Content.SigningJobArn,
            }
          : undefined,
      };
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Publish a new layer version
   */
  async publishLayerVersion(
    options: LambdaPublishLayerVersionOptions
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new PublishLayerVersionCommand({
        LayerName: options.layerName,
        Description: options.description,
        Content: {
          S3Bucket: options.content.s3Bucket,
          S3Key: options.content.s3Key,
          S3ObjectVersion: options.content.s3ObjectVersion,
          ZipFile: options.content.zipFile,
        },
        CompatibleRuntimes: options.compatibleRuntimes,
        LicenseInfo: options.licenseInfo,
        CompatibleArchitectures: options.compatibleArchitectures,
      });

      const response = await this.withRetry(() => client.send(command), 'PublishLayerVersion');

      return {
        success: true,
        message: `Layer version ${response.Version} published for '${options.layerName}'`,
        data: {
          layerVersionArn: response.LayerVersionArn,
          version: response.Version,
          description: response.Description,
          createdDate: response.CreatedDate,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to publish layer version for '${options.layerName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete a layer version
   */
  async deleteLayerVersion(
    layerName: string,
    versionNumber: number,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new DeleteLayerVersionCommand({
        LayerName: layerName,
        VersionNumber: versionNumber,
      });

      await this.withRetry(() => client.send(command), 'DeleteLayerVersion');

      return {
        success: true,
        message: `Layer version ${versionNumber} deleted from '${layerName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete layer version ${versionNumber} from '${layerName}'`,
        error: message,
      };
    }
  }

  /**
   * Add layers to a function
   */
  async addLayersToFunction(
    functionName: string,
    layerArns: string[],
    region?: string
  ): Promise<LambdaOperationResult> {
    const fn = await this.getFunctionConfiguration(functionName, undefined, region);
    if (!fn) {
      return {
        success: false,
        message: `Function '${functionName}' not found`,
        error: 'not_found',
      };
    }

    const existingLayers = fn.layers?.map((l) => l.arn) || [];
    const allLayers = [...new Set([...existingLayers, ...layerArns])];

    return this.updateFunctionConfiguration({
      functionName,
      layers: allLayers,
      region,
    });
  }

  /**
   * Remove layers from a function
   */
  async removeLayersFromFunction(
    functionName: string,
    layerArns: string[],
    region?: string
  ): Promise<LambdaOperationResult> {
    const fn = await this.getFunctionConfiguration(functionName, undefined, region);
    if (!fn) {
      return {
        success: false,
        message: `Function '${functionName}' not found`,
        error: 'not_found',
      };
    }

    const existingLayers = fn.layers?.map((l) => l.arn) || [];
    const filteredLayers = existingLayers.filter((l) => !layerArns.includes(l));

    return this.updateFunctionConfiguration({
      functionName,
      layers: filteredLayers,
      region,
    });
  }

  // ==========================================================================
  // 6. Lambda Version and Alias Management
  // ==========================================================================

  /**
   * Publish a new function version
   */
  async publishVersion(options: LambdaPublishVersionOptions): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new PublishVersionCommand({
        FunctionName: options.functionName,
        CodeSha256: options.codeSha256,
        Description: options.description,
        RevisionId: options.revisionId,
      });

      const response = await this.withRetry(() => client.send(command), 'PublishVersion');

      return {
        success: true,
        message: `Version ${response.Version} published for '${options.functionName}'`,
        data: {
          functionName: response.FunctionName,
          functionArn: response.FunctionArn,
          version: response.Version,
          description: response.Description,
          codeSha256: response.CodeSha256,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to publish version for '${options.functionName}'`,
        error: message,
      };
    }
  }

  /**
   * List function versions
   */
  async listVersions(options: {
    functionName: string;
    maxItems?: number;
    region?: string;
  }): Promise<LambdaVersion[]> {
    const client = this.getLambdaClient(options.region);
    const versions: LambdaVersion[] = [];
    let marker: string | undefined;

    do {
      const command = new ListVersionsByFunctionCommand({
        FunctionName: options.functionName,
        MaxItems: options.maxItems || 50,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'ListVersionsByFunction');

      if (response.Versions) {
        for (const v of response.Versions) {
          versions.push({
            functionName: v.FunctionName,
            functionArn: v.FunctionArn,
            version: v.Version || '',
            description: v.Description,
            codeSha256: v.CodeSha256,
            revisionId: v.RevisionId,
          });
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return versions;
  }

  /**
   * Create an alias for a function version
   */
  async createAlias(options: LambdaCreateAliasOptions): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new CreateAliasCommand({
        FunctionName: options.functionName,
        Name: options.name,
        FunctionVersion: options.functionVersion,
        Description: options.description,
        RoutingConfig: options.routingConfig
          ? { AdditionalVersionWeights: options.routingConfig.additionalVersionWeights }
          : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateAlias');
      const alias = this.mapAlias(response);

      return {
        success: true,
        message: `Alias '${options.name}' created for '${options.functionName}'`,
        data: alias,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create alias '${options.name}'`,
        error: message,
      };
    }
  }

  /**
   * Update an alias
   */
  async updateAlias(options: LambdaUpdateAliasOptions): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new UpdateAliasCommand({
        FunctionName: options.functionName,
        Name: options.name,
        FunctionVersion: options.functionVersion,
        Description: options.description,
        RoutingConfig: options.routingConfig
          ? { AdditionalVersionWeights: options.routingConfig.additionalVersionWeights }
          : undefined,
        RevisionId: options.revisionId,
      });

      const response = await this.withRetry(() => client.send(command), 'UpdateAlias');
      const alias = this.mapAlias(response);

      return {
        success: true,
        message: `Alias '${options.name}' updated`,
        data: alias,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to update alias '${options.name}'`,
        error: message,
      };
    }
  }

  /**
   * Delete an alias
   */
  async deleteAlias(
    functionName: string,
    name: string,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new DeleteAliasCommand({
        FunctionName: functionName,
        Name: name,
      });

      await this.withRetry(() => client.send(command), 'DeleteAlias');

      return {
        success: true,
        message: `Alias '${name}' deleted from '${functionName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete alias '${name}'`,
        error: message,
      };
    }
  }

  /**
   * Get an alias
   */
  async getAlias(
    functionName: string,
    name: string,
    region?: string
  ): Promise<LambdaAlias | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetAliasCommand({
        FunctionName: functionName,
        Name: name,
      });

      const response = await this.withRetry(() => client.send(command), 'GetAlias');
      return this.mapAlias(response);
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List aliases for a function
   */
  async listAliases(options: {
    functionName: string;
    functionVersion?: string;
    maxItems?: number;
    region?: string;
  }): Promise<LambdaAlias[]> {
    const client = this.getLambdaClient(options.region);
    const aliases: LambdaAlias[] = [];
    let marker: string | undefined;

    do {
      const command = new ListAliasesCommand({
        FunctionName: options.functionName,
        FunctionVersion: options.functionVersion,
        MaxItems: options.maxItems || 50,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'ListAliases');

      if (response.Aliases) {
        for (const alias of response.Aliases) {
          aliases.push(this.mapAlias(alias));
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return aliases;
  }

  // ==========================================================================
  // 7. Lambda Monitoring and Logging
  // ==========================================================================

  /**
   * Get CloudWatch metrics for a Lambda function
   */
  async getMetrics(options: LambdaGetMetricsOptions): Promise<LambdaMetrics> {
    const client = this.getCloudWatchClient(options.region);

    const defaultMetrics = [
      'Invocations',
      'Errors',
      'Throttles',
      'Duration',
      'ConcurrentExecutions',
      'UnreservedConcurrentExecutions',
    ];

    const metricNames = options.metricNames || defaultMetrics;
    const statistics = options.statistics || ['Sum', 'Average'];
    const period = options.period || 300;

    const metrics: LambdaMetrics = {
      functionName: options.functionName,
      timestamp: new Date(),
      metrics: {},
    };

    const metricPromises = metricNames.map(async (metricName) => {
      const command = new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: metricName,
        Dimensions: [
          {
            Name: 'FunctionName',
            Value: options.functionName,
          },
        ],
        StartTime: options.startTime,
        EndTime: options.endTime,
        Period: period,
        Statistics: statistics,
      });

      try {
        const response = await this.withRetry(() => client.send(command), 'GetMetricStatistics');
        return { metricName, datapoints: response.Datapoints || [] };
      } catch {
        return { metricName, datapoints: [] };
      }
    });

    const results = await Promise.all(metricPromises);

    for (const { metricName, datapoints } of results) {
      if (datapoints.length > 0) {
        const latestDatapoint = datapoints.sort(
          (a: Datapoint, b: Datapoint) =>
            (b.Timestamp?.getTime() || 0) - (a.Timestamp?.getTime() || 0)
        )[0];
        const value = latestDatapoint.Sum ?? latestDatapoint.Average ?? 0;

        const metricKey = metricName.charAt(0).toLowerCase() + metricName.slice(1);
        (metrics.metrics as Record<string, number>)[metricKey] = value;
      }
    }

    return metrics;
  }

  /**
   * Get CloudWatch logs for a Lambda function
   */
  async getLogs(options: LambdaGetLogsOptions): Promise<LambdaLogEvent[]> {
    const client = this.getCloudWatchLogsClient(options.region);
    const logGroupName = `/aws/lambda/${options.functionName}`;

    try {
      const command = new FilterLogEventsCommand({
        logGroupName,
        startTime: options.startTime,
        endTime: options.endTime,
        filterPattern: options.filterPattern,
        limit: options.limit || 100,
      });

      const response = await this.withRetry(() => client.send(command), 'FilterLogEvents');

      return (response.events || []).map((event) => ({
        timestamp: event.timestamp,
        message: event.message,
        ingestionTime: event.ingestionTime,
      }));
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get recent log streams for a function
   */
  async getRecentLogStreams(
    functionName: string,
    limit: number = 5,
    region?: string
  ): Promise<Array<{
    logStreamName: string;
    creationTime?: number;
    lastEventTimestamp?: number;
    lastIngestionTime?: number;
  }>> {
    const client = this.getCloudWatchLogsClient(region);
    const logGroupName = `/aws/lambda/${functionName}`;

    try {
      const command = new DescribeLogStreamsCommand({
        logGroupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeLogStreams');

      return (response.logStreams || []).map((stream) => ({
        logStreamName: stream.logStreamName || '',
        creationTime: stream.creationTime,
        lastEventTimestamp: stream.lastEventTimestamp,
        lastIngestionTime: stream.lastIngestionTime,
      }));
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get log events from a specific stream
   */
  async getLogStreamEvents(options: {
    functionName: string;
    logStreamName: string;
    startTime?: number;
    endTime?: number;
    startFromHead?: boolean;
    limit?: number;
    region?: string;
  }): Promise<LambdaLogEvent[]> {
    const client = this.getCloudWatchLogsClient(options.region);
    const logGroupName = `/aws/lambda/${options.functionName}`;

    try {
      const command = new GetLogEventsCommand({
        logGroupName,
        logStreamName: options.logStreamName,
        startTime: options.startTime,
        endTime: options.endTime,
        startFromHead: options.startFromHead,
        limit: options.limit || 100,
      });

      const response = await this.withRetry(() => client.send(command), 'GetLogEvents');

      return (response.events || []).map((event) => ({
        timestamp: event.timestamp,
        message: event.message,
        ingestionTime: event.ingestionTime,
      }));
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return [];
      }
      throw error;
    }
  }

  // ==========================================================================
  // 8. Lambda Cold Start Optimization
  // ==========================================================================

  /**
   * Set reserved concurrency for a function
   */
  async setReservedConcurrency(
    functionName: string,
    reservedConcurrentExecutions: number,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new PutFunctionConcurrencyCommand({
        FunctionName: functionName,
        ReservedConcurrentExecutions: reservedConcurrentExecutions,
      });

      const response = await this.withRetry(() => client.send(command), 'PutFunctionConcurrency');

      return {
        success: true,
        message: `Reserved concurrency set to ${reservedConcurrentExecutions} for '${functionName}'`,
        data: {
          reservedConcurrentExecutions: response.ReservedConcurrentExecutions,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set reserved concurrency for '${functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete reserved concurrency for a function
   */
  async deleteReservedConcurrency(
    functionName: string,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new DeleteFunctionConcurrencyCommand({
        FunctionName: functionName,
      });

      await this.withRetry(() => client.send(command), 'DeleteFunctionConcurrency');

      return {
        success: true,
        message: `Reserved concurrency removed from '${functionName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete reserved concurrency for '${functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Get reserved concurrency for a function
   */
  async getReservedConcurrency(
    functionName: string,
    region?: string
  ): Promise<LambdaConcurrencyConfig | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetFunctionConcurrencyCommand({
        FunctionName: functionName,
      });

      const response = await this.withRetry(() => client.send(command), 'GetFunctionConcurrency');

      return {
        functionName,
        reservedConcurrentExecutions: response.ReservedConcurrentExecutions,
      };
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set provisioned concurrency for a function version/alias
   */
  async setProvisionedConcurrency(
    options: LambdaSetProvisionedConcurrencyOptions
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new PutProvisionedConcurrencyConfigCommand({
        FunctionName: options.functionName,
        Qualifier: options.qualifier,
        ProvisionedConcurrentExecutions: options.provisionedConcurrentExecutions,
      });

      const response = await this.withRetry(() => client.send(command), 'PutProvisionedConcurrencyConfig');

      return {
        success: true,
        message: `Provisioned concurrency set to ${options.provisionedConcurrentExecutions} for '${options.functionName}:${options.qualifier}'`,
        data: {
          requestedProvisionedConcurrentExecutions:
            response.RequestedProvisionedConcurrentExecutions,
          availableProvisionedConcurrentExecutions:
            response.AvailableProvisionedConcurrentExecutions,
          allocatedProvisionedConcurrentExecutions:
            response.AllocatedProvisionedConcurrentExecutions,
          status: response.Status,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set provisioned concurrency for '${options.functionName}:${options.qualifier}'`,
        error: message,
      };
    }
  }

  /**
   * Delete provisioned concurrency for a function version/alias
   */
  async deleteProvisionedConcurrency(
    functionName: string,
    qualifier: string,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new DeleteProvisionedConcurrencyConfigCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      await this.withRetry(() => client.send(command), 'DeleteProvisionedConcurrencyConfig');

      return {
        success: true,
        message: `Provisioned concurrency removed from '${functionName}:${qualifier}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete provisioned concurrency for '${functionName}:${qualifier}'`,
        error: message,
      };
    }
  }

  /**
   * Get provisioned concurrency configuration
   */
  async getProvisionedConcurrency(
    functionName: string,
    qualifier: string,
    region?: string
  ): Promise<LambdaProvisionedConcurrencyConfig | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetProvisionedConcurrencyConfigCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      const response = await this.withRetry(() => client.send(command), 'GetProvisionedConcurrencyConfig');

      return {
        functionName,
        qualifier,
        requestedProvisionedConcurrentExecutions:
          response.RequestedProvisionedConcurrentExecutions || 0,
        availableProvisionedConcurrentExecutions:
          response.AvailableProvisionedConcurrentExecutions,
        allocatedProvisionedConcurrentExecutions:
          response.AllocatedProvisionedConcurrentExecutions,
        status: response.Status as 'IN_PROGRESS' | 'READY' | 'FAILED' | undefined,
        statusReason: response.StatusReason,
        lastModified: response.LastModified,
      };
    } catch (error) {
      if ((error as Error).name === 'ProvisionedConcurrencyConfigNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List provisioned concurrency configurations for a function
   */
  async listProvisionedConcurrencyConfigs(options: {
    functionName: string;
    maxItems?: number;
    region?: string;
  }): Promise<LambdaProvisionedConcurrencyConfig[]> {
    const client = this.getLambdaClient(options.region);
    const configs: LambdaProvisionedConcurrencyConfig[] = [];
    let marker: string | undefined;

    do {
      const command = new ListProvisionedConcurrencyConfigsCommand({
        FunctionName: options.functionName,
        MaxItems: options.maxItems || 50,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'ListProvisionedConcurrencyConfigs');

      if (response.ProvisionedConcurrencyConfigs) {
        for (const config of response.ProvisionedConcurrencyConfigs) {
          configs.push(this.mapProvisionedConcurrencyConfig(config, options.functionName));
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return configs;
  }

  /**
   * Analyze cold start patterns and provide recommendations
   */
  async analyzeColdStarts(
    functionName: string,
    region?: string
  ): Promise<LambdaColdStartAnalysis> {
    const fn = await this.getFunctionConfiguration(functionName, undefined, region);
    if (!fn) {
      return {
        functionName,
        recommendations: ['Function not found'],
        optimizationScore: 0,
      };
    }

    const recommendations: string[] = [];
    let score = 100;

    // Check memory size
    if (fn.memorySize < 512) {
      recommendations.push(
        'Consider increasing memory size to at least 512MB for faster cold starts'
      );
      score -= 10;
    }

    // Check VPC configuration
    if (fn.vpcConfig && fn.vpcConfig.subnetIds.length > 0) {
      recommendations.push(
        'VPC-enabled functions have longer cold starts. Consider using VPC endpoints or removing VPC if not needed'
      );
      score -= 15;
    }

    // Check runtime
    const fastRuntimes = ['nodejs20.x', 'nodejs22.x', 'python3.11', 'python3.12'];
    if (!fastRuntimes.includes(fn.runtime)) {
      recommendations.push(
        'Consider using a newer runtime version for faster cold starts'
      );
      score -= 10;
    }

    // Check package size
    if (fn.codeSize > 50 * 1024 * 1024) {
      recommendations.push(
        'Large deployment package detected. Consider using Lambda layers or reducing dependencies'
      );
      score -= 20;
    }

    // Check provisioned concurrency
    const provisionedConfigs = await this.listProvisionedConcurrencyConfigs({
      functionName,
      region,
    });
    if (provisionedConfigs.length === 0) {
      recommendations.push(
        'Consider using provisioned concurrency for latency-sensitive workloads'
      );
      score -= 5;
    }

    // Check SnapStart
    if (fn.runtime.startsWith('java') && (!fn.snapStart || fn.snapStart.applyOn === 'None')) {
      recommendations.push(
        'Enable SnapStart for Java functions to reduce cold starts by up to 90%'
      );
      score -= 15;
    }

    // Check layers
    if (fn.layers && fn.layers.length > 3) {
      recommendations.push(
        'Too many layers can increase cold start time. Consider consolidating layers'
      );
      score -= 5;
    }

    // Check architecture
    if (!fn.architectures.includes('arm64')) {
      recommendations.push(
        'Consider using ARM64 architecture for better price-performance and potentially faster cold starts'
      );
      score -= 5;
    }

    if (recommendations.length === 0) {
      recommendations.push('Function is well-optimized for cold starts');
    }

    return {
      functionName,
      recommendations,
      optimizationScore: Math.max(0, score),
    };
  }

  /**
   * Warm up a function by invoking it
   */
  async warmupFunction(options: LambdaWarmupOptions): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);
    const concurrency = options.concurrency || 1;
    const payload = options.payload || JSON.stringify({ warmup: true });

    try {
      const invocations = Array(concurrency)
        .fill(null)
        .map(async () => {
          const command = new InvokeCommand({
            FunctionName: options.functionName,
            InvocationType: 'RequestResponse',
            Payload: Buffer.from(payload),
          });

          return this.withRetry(() => client.send(command), 'Invoke');
        });

      const results = await Promise.all(invocations);
      const successCount = results.filter((r) => r.StatusCode === 200).length;

      return {
        success: successCount === concurrency,
        message: `Warmed up '${options.functionName}' with ${successCount}/${concurrency} successful invocations`,
        data: {
          successCount,
          totalInvocations: concurrency,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to warm up '${options.functionName}'`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // Lambda Invocation
  // ==========================================================================

  /**
   * Invoke a Lambda function
   */
  async invoke(options: LambdaInvokeOptions): Promise<LambdaInvokeResult> {
    const client = this.getLambdaClient(options.region);

    const command = new InvokeCommand({
      FunctionName: options.functionName,
      Payload: options.payload
        ? typeof options.payload === 'string'
          ? Buffer.from(options.payload)
          : options.payload
        : undefined,
      InvocationType: options.invocationType || 'RequestResponse',
      LogType: options.logType,
      ClientContext: options.clientContext,
      Qualifier: options.qualifier,
    });

    const response = await this.withRetry(() => client.send(command), 'Invoke');

    return {
      statusCode: response.StatusCode || 0,
      executedVersion: response.ExecutedVersion,
      functionError: response.FunctionError,
      logResult: response.LogResult
        ? Buffer.from(response.LogResult, 'base64').toString()
        : undefined,
      payload: response.Payload
        ? Buffer.from(response.Payload).toString()
        : undefined,
    };
  }

  // ==========================================================================
  // Lambda Function URLs
  // ==========================================================================

  /**
   * Create a function URL
   */
  async createFunctionUrl(
    options: LambdaCreateFunctionUrlOptions
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new CreateFunctionUrlConfigCommand({
        FunctionName: options.functionName,
        Qualifier: options.qualifier,
        AuthType: options.authType,
        Cors: options.cors
          ? {
              AllowCredentials: options.cors.allowCredentials,
              AllowHeaders: options.cors.allowHeaders,
              AllowMethods: options.cors.allowMethods,
              AllowOrigins: options.cors.allowOrigins,
              ExposeHeaders: options.cors.exposeHeaders,
              MaxAge: options.cors.maxAge,
            }
          : undefined,
        InvokeMode: options.invokeMode,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateFunctionUrlConfig');

      return {
        success: true,
        message: `Function URL created for '${options.functionName}'`,
        data: {
          functionUrl: response.FunctionUrl,
          functionArn: response.FunctionArn,
          authType: response.AuthType,
          creationTime: response.CreationTime,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create function URL for '${options.functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Update a function URL
   */
  async updateFunctionUrl(options: {
    functionName: string;
    qualifier?: string;
    authType?: 'NONE' | 'AWS_IAM';
    cors?: {
      allowCredentials?: boolean;
      allowHeaders?: string[];
      allowMethods?: string[];
      allowOrigins?: string[];
      exposeHeaders?: string[];
      maxAge?: number;
    };
    invokeMode?: 'BUFFERED' | 'RESPONSE_STREAM';
    region?: string;
  }): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(options.region);

    try {
      const command = new UpdateFunctionUrlConfigCommand({
        FunctionName: options.functionName,
        Qualifier: options.qualifier,
        AuthType: options.authType,
        Cors: options.cors
          ? {
              AllowCredentials: options.cors.allowCredentials,
              AllowHeaders: options.cors.allowHeaders,
              AllowMethods: options.cors.allowMethods,
              AllowOrigins: options.cors.allowOrigins,
              ExposeHeaders: options.cors.exposeHeaders,
              MaxAge: options.cors.maxAge,
            }
          : undefined,
        InvokeMode: options.invokeMode,
      });

      const response = await this.withRetry(() => client.send(command), 'UpdateFunctionUrlConfig');

      return {
        success: true,
        message: `Function URL updated for '${options.functionName}'`,
        data: {
          functionUrl: response.FunctionUrl,
          functionArn: response.FunctionArn,
          authType: response.AuthType,
          lastModifiedTime: response.LastModifiedTime,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to update function URL for '${options.functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete a function URL
   */
  async deleteFunctionUrl(
    functionName: string,
    qualifier?: string,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new DeleteFunctionUrlConfigCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      await this.withRetry(() => client.send(command), 'DeleteFunctionUrlConfig');

      return {
        success: true,
        message: `Function URL deleted for '${functionName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete function URL for '${functionName}'`,
        error: message,
      };
    }
  }

  /**
   * Get function URL configuration
   */
  async getFunctionUrl(
    functionName: string,
    qualifier?: string,
    region?: string
  ): Promise<LambdaFunctionUrl | null> {
    const client = this.getLambdaClient(region);

    try {
      const command = new GetFunctionUrlConfigCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      });

      const response = await this.withRetry(() => client.send(command), 'GetFunctionUrlConfig');
      return this.mapFunctionUrl(response);
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List function URLs for a function
   */
  async listFunctionUrls(options: {
    functionName: string;
    maxItems?: number;
    region?: string;
  }): Promise<LambdaFunctionUrl[]> {
    const client = this.getLambdaClient(options.region);
    const urls: LambdaFunctionUrl[] = [];
    let marker: string | undefined;

    do {
      const command = new ListFunctionUrlConfigsCommand({
        FunctionName: options.functionName,
        MaxItems: options.maxItems || 50,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'ListFunctionUrlConfigs');

      if (response.FunctionUrlConfigs) {
        for (const url of response.FunctionUrlConfigs) {
          urls.push(this.mapFunctionUrl(url));
        }
      }

      marker = response.NextMarker;
    } while (marker);

    return urls;
  }

  // ==========================================================================
  // Lambda Tagging
  // ==========================================================================

  /**
   * Tag a Lambda resource
   */
  async tagResource(
    resourceArn: string,
    tags: Record<string, string>,
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new TagResourceCommand({
        Resource: resourceArn,
        Tags: tags,
      });

      await this.withRetry(() => client.send(command), 'TagResource');

      return {
        success: true,
        message: `Tags added to resource`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to tag resource`,
        error: message,
      };
    }
  }

  /**
   * Remove tags from a Lambda resource
   */
  async untagResource(
    resourceArn: string,
    tagKeys: string[],
    region?: string
  ): Promise<LambdaOperationResult> {
    const client = this.getLambdaClient(region);

    try {
      const command = new UntagResourceCommand({
        Resource: resourceArn,
        TagKeys: tagKeys,
      });

      await this.withRetry(() => client.send(command), 'UntagResource');

      return {
        success: true,
        message: `Tags removed from resource`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to untag resource`,
        error: message,
      };
    }
  }

  /**
   * List tags for a Lambda resource
   */
  async listTags(
    resourceArn: string,
    region?: string
  ): Promise<Record<string, string>> {
    const client = this.getLambdaClient(region);

    const command = new ListTagsCommand({
      Resource: resourceArn,
    });

    const response = await this.withRetry(() => client.send(command), 'ListTags');
    return response.Tags || {};
  }

  // ==========================================================================
  // Lambda Account Settings
  // ==========================================================================

  /**
   * Get Lambda account settings
   */
  async getAccountSettings(region?: string): Promise<LambdaAccountSettings> {
    const client = this.getLambdaClient(region);

    const command = new GetAccountSettingsCommand({});
    const response = await this.withRetry(() => client.send(command), 'GetAccountSettings');

    return {
      accountLimit: response.AccountLimit
        ? {
            totalCodeSize: response.AccountLimit.TotalCodeSize,
            codeSizeUnzipped: response.AccountLimit.CodeSizeUnzipped,
            codeSizeZipped: response.AccountLimit.CodeSizeZipped,
            concurrentExecutions: response.AccountLimit.ConcurrentExecutions,
            unreservedConcurrentExecutions:
              response.AccountLimit.UnreservedConcurrentExecutions,
          }
        : undefined,
      accountUsage: response.AccountUsage
        ? {
            totalCodeSize: response.AccountUsage.TotalCodeSize,
            functionCount: response.AccountUsage.FunctionCount,
          }
        : undefined,
    };
  }
}

// Export singleton factory
export function createLambdaManager(config?: LambdaClientConfig): LambdaManager {
  return new LambdaManager(config);
}
