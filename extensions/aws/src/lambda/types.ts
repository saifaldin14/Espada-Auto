/**
 * AWS Lambda Types
 * Comprehensive type definitions for Lambda operations
 */

// ============================================================================
// Core Lambda Types
// ============================================================================

export interface LambdaClientConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export interface LambdaOperationResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

// ============================================================================
// Lambda Function Types
// ============================================================================

export interface LambdaFunction {
  functionName: string;
  functionArn: string;
  runtime: LambdaRuntime;
  role: string;
  handler: string;
  codeSize: number;
  description?: string;
  timeout: number;
  memorySize: number;
  lastModified: string;
  codeSha256: string;
  version: string;
  environment?: {
    variables: Record<string, string>;
  };
  tracingConfig?: {
    mode: 'Active' | 'PassThrough';
  };
  revisionId?: string;
  layers?: Array<{
    arn: string;
    codeSize: number;
    signingProfileVersionArn?: string;
    signingJobArn?: string;
  }>;
  state?: 'Pending' | 'Active' | 'Inactive' | 'Failed';
  stateReason?: string;
  stateReasonCode?: string;
  lastUpdateStatus?: 'Successful' | 'Failed' | 'InProgress';
  lastUpdateStatusReason?: string;
  lastUpdateStatusReasonCode?: string;
  fileSystemConfigs?: Array<{
    arn: string;
    localMountPath: string;
  }>;
  packageType: 'Zip' | 'Image';
  imageConfigResponse?: {
    imageConfig?: {
      entryPoint?: string[];
      command?: string[];
      workingDirectory?: string;
    };
    error?: {
      errorCode?: string;
      message?: string;
    };
  };
  signingProfileVersionArn?: string;
  signingJobArn?: string;
  architectures: LambdaArchitecture[];
  ephemeralStorage?: {
    size: number;
  };
  snapStart?: {
    applyOn: 'PublishedVersions' | 'None';
    optimizationStatus?: 'On' | 'Off';
  };
  runtimeVersionConfig?: {
    runtimeVersionArn?: string;
    error?: {
      errorCode?: string;
      message?: string;
    };
  };
  loggingConfig?: {
    logFormat?: 'JSON' | 'Text';
    applicationLogLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
    systemLogLevel?: 'DEBUG' | 'INFO' | 'WARN';
    logGroup?: string;
  };
  vpcConfig?: {
    subnetIds: string[];
    securityGroupIds: string[];
    vpcId?: string;
    ipv6AllowedForDualStack?: boolean;
  };
  deadLetterConfig?: {
    targetArn?: string;
  };
  kmsKeyArn?: string;
  masterArn?: string;
  tags: Record<string, string>;
}

export type LambdaRuntime =
  | 'nodejs18.x'
  | 'nodejs20.x'
  | 'nodejs22.x'
  | 'python3.9'
  | 'python3.10'
  | 'python3.11'
  | 'python3.12'
  | 'python3.13'
  | 'java11'
  | 'java17'
  | 'java21'
  | 'dotnet6'
  | 'dotnet8'
  | 'ruby3.2'
  | 'ruby3.3'
  | 'provided.al2'
  | 'provided.al2023';

export type LambdaArchitecture = 'x86_64' | 'arm64';

// ============================================================================
// Lambda Deployment Types
// ============================================================================

export interface LambdaCreateFunctionOptions {
  functionName: string;
  runtime: LambdaRuntime;
  role: string;
  handler: string;
  code: LambdaCodeSource;
  description?: string;
  timeout?: number;
  memorySize?: number;
  publish?: boolean;
  environment?: Record<string, string>;
  vpcConfig?: {
    subnetIds: string[];
    securityGroupIds: string[];
    ipv6AllowedForDualStack?: boolean;
  };
  deadLetterConfig?: {
    targetArn: string;
  };
  tracingConfig?: {
    mode: 'Active' | 'PassThrough';
  };
  layers?: string[];
  fileSystemConfigs?: Array<{
    arn: string;
    localMountPath: string;
  }>;
  kmsKeyArn?: string;
  architectures?: LambdaArchitecture[];
  ephemeralStorage?: {
    size: number;
  };
  snapStart?: {
    applyOn: 'PublishedVersions' | 'None';
  };
  loggingConfig?: {
    logFormat?: 'JSON' | 'Text';
    applicationLogLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
    systemLogLevel?: 'DEBUG' | 'INFO' | 'WARN';
    logGroup?: string;
  };
  tags?: Record<string, string>;
  region?: string;
}

export interface LambdaCodeSource {
  zipFile?: Buffer | Uint8Array;
  s3Bucket?: string;
  s3Key?: string;
  s3ObjectVersion?: string;
  imageUri?: string;
}

export interface LambdaUpdateCodeOptions {
  functionName: string;
  code: LambdaCodeSource;
  publish?: boolean;
  dryRun?: boolean;
  revisionId?: string;
  architectures?: LambdaArchitecture[];
  region?: string;
}

export interface LambdaUpdateConfigOptions {
  functionName: string;
  role?: string;
  handler?: string;
  description?: string;
  timeout?: number;
  memorySize?: number;
  vpcConfig?: {
    subnetIds: string[];
    securityGroupIds: string[];
    ipv6AllowedForDualStack?: boolean;
  };
  environment?: Record<string, string>;
  runtime?: LambdaRuntime;
  deadLetterConfig?: {
    targetArn?: string;
  };
  kmsKeyArn?: string;
  tracingConfig?: {
    mode: 'Active' | 'PassThrough';
  };
  revisionId?: string;
  layers?: string[];
  fileSystemConfigs?: Array<{
    arn: string;
    localMountPath: string;
  }>;
  ephemeralStorage?: {
    size: number;
  };
  snapStart?: {
    applyOn: 'PublishedVersions' | 'None';
  };
  loggingConfig?: {
    logFormat?: 'JSON' | 'Text';
    applicationLogLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
    systemLogLevel?: 'DEBUG' | 'INFO' | 'WARN';
    logGroup?: string;
  };
  region?: string;
}

// ============================================================================
// Lambda Trigger/Event Source Types
// ============================================================================

export interface LambdaEventSourceMapping {
  uuid: string;
  functionArn?: string;
  batchSize?: number;
  maximumBatchingWindowInSeconds?: number;
  parallelizationFactor?: number;
  eventSourceArn?: string;
  filterCriteria?: {
    filters: Array<{
      pattern?: string;
    }>;
  };
  functionResponseTypes?: Array<'ReportBatchItemFailures'>;
  startingPosition?: 'TRIM_HORIZON' | 'LATEST' | 'AT_TIMESTAMP';
  startingPositionTimestamp?: Date;
  lastModified?: Date;
  lastProcessingResult?: string;
  state?: string;
  stateTransitionReason?: string;
  destinationConfig?: {
    onSuccess?: { destination?: string };
    onFailure?: { destination?: string };
  };
  topics?: string[];
  queues?: string[];
  sourceAccessConfigurations?: Array<{
    type?: string;
    uri?: string;
  }>;
  selfManagedEventSource?: {
    endpoints?: Record<string, string[]>;
  };
  maximumRecordAgeInSeconds?: number;
  bisectBatchOnFunctionError?: boolean;
  maximumRetryAttempts?: number;
  tumblingWindowInSeconds?: number;
  selfManagedKafkaEventSourceConfig?: {
    consumerGroupId?: string;
  };
  amazonManagedKafkaEventSourceConfig?: {
    consumerGroupId?: string;
  };
  scalingConfig?: {
    maximumConcurrency?: number;
  };
  documentDBEventSourceConfig?: {
    databaseName?: string;
    collectionName?: string;
    fullDocument?: 'UpdateLookup' | 'Default';
  };
}

export interface LambdaCreateEventSourceMappingOptions {
  functionName: string;
  eventSourceArn?: string;
  batchSize?: number;
  maximumBatchingWindowInSeconds?: number;
  parallelizationFactor?: number;
  startingPosition?: 'TRIM_HORIZON' | 'LATEST' | 'AT_TIMESTAMP';
  startingPositionTimestamp?: Date;
  enabled?: boolean;
  filterCriteria?: {
    filters: Array<{ pattern: string }>;
  };
  functionResponseTypes?: Array<'ReportBatchItemFailures'>;
  destinationConfig?: {
    onSuccess?: { destination: string };
    onFailure?: { destination: string };
  };
  maximumRecordAgeInSeconds?: number;
  bisectBatchOnFunctionError?: boolean;
  maximumRetryAttempts?: number;
  tumblingWindowInSeconds?: number;
  topics?: string[];
  queues?: string[];
  sourceAccessConfigurations?: Array<{
    type: string;
    uri: string;
  }>;
  selfManagedEventSource?: {
    endpoints: Record<string, string[]>;
  };
  scalingConfig?: {
    maximumConcurrency?: number;
  };
  region?: string;
}

export interface LambdaPermission {
  sid: string;
  effect: 'Allow' | 'Deny';
  principal: string;
  action: string;
  resource?: string;
  condition?: Record<string, Record<string, string>>;
}

export interface LambdaAddPermissionOptions {
  functionName: string;
  statementId: string;
  action: string;
  principal: string;
  sourceArn?: string;
  sourceAccount?: string;
  eventSourceToken?: string;
  qualifier?: string;
  revisionId?: string;
  principalOrgID?: string;
  functionUrlAuthType?: 'NONE' | 'AWS_IAM';
  region?: string;
}

// ============================================================================
// Lambda Layer Types
// ============================================================================

export interface LambdaLayer {
  layerName: string;
  layerArn: string;
  latestMatchingVersion?: {
    layerVersionArn: string;
    version: number;
    description?: string;
    createdDate?: string;
    compatibleRuntimes?: LambdaRuntime[];
    licenseInfo?: string;
    compatibleArchitectures?: LambdaArchitecture[];
  };
}

export interface LambdaLayerVersion {
  layerVersionArn: string;
  version: number;
  description?: string;
  createdDate?: string;
  compatibleRuntimes?: LambdaRuntime[];
  licenseInfo?: string;
  compatibleArchitectures?: LambdaArchitecture[];
  content?: {
    location?: string;
    codeSha256?: string;
    codeSize?: number;
    signingProfileVersionArn?: string;
    signingJobArn?: string;
  };
}

export interface LambdaPublishLayerVersionOptions {
  layerName: string;
  description?: string;
  content: {
    s3Bucket?: string;
    s3Key?: string;
    s3ObjectVersion?: string;
    zipFile?: Buffer | Uint8Array;
  };
  compatibleRuntimes?: LambdaRuntime[];
  licenseInfo?: string;
  compatibleArchitectures?: LambdaArchitecture[];
  region?: string;
}

// ============================================================================
// Lambda Version and Alias Types
// ============================================================================

export interface LambdaVersion {
  functionName?: string;
  functionArn?: string;
  version: string;
  description?: string;
  codeSha256?: string;
  revisionId?: string;
}

export interface LambdaAlias {
  aliasArn: string;
  name: string;
  functionVersion: string;
  description?: string;
  routingConfig?: {
    additionalVersionWeights: Record<string, number>;
  };
  revisionId?: string;
}

export interface LambdaPublishVersionOptions {
  functionName: string;
  codeSha256?: string;
  description?: string;
  revisionId?: string;
  region?: string;
}

export interface LambdaCreateAliasOptions {
  functionName: string;
  name: string;
  functionVersion: string;
  description?: string;
  routingConfig?: {
    additionalVersionWeights: Record<string, number>;
  };
  region?: string;
}

export interface LambdaUpdateAliasOptions {
  functionName: string;
  name: string;
  functionVersion?: string;
  description?: string;
  routingConfig?: {
    additionalVersionWeights: Record<string, number>;
  };
  revisionId?: string;
  region?: string;
}

// ============================================================================
// Lambda Monitoring Types
// ============================================================================

export interface LambdaMetrics {
  functionName: string;
  timestamp: Date;
  metrics: {
    invocations?: number;
    errors?: number;
    throttles?: number;
    duration?: number;
    concurrentExecutions?: number;
    provisionedConcurrencyInvocations?: number;
    provisionedConcurrencySpilloverInvocations?: number;
    unreservedConcurrentExecutions?: number;
    iteratorAge?: number;
    deadLetterErrors?: number;
    destinationDeliveryFailures?: number;
    asyncEventsReceived?: number;
    asyncEventAge?: number;
    asyncEventsDropped?: number;
  };
}

export interface LambdaGetMetricsOptions {
  functionName: string;
  metricNames?: string[];
  startTime: Date;
  endTime: Date;
  period?: number;
  statistics?: Array<'Average' | 'Sum' | 'Minimum' | 'Maximum' | 'SampleCount'>;
  region?: string;
}

export interface LambdaLogEvent {
  timestamp?: number;
  message?: string;
  ingestionTime?: number;
}

export interface LambdaGetLogsOptions {
  functionName: string;
  startTime?: number;
  endTime?: number;
  filterPattern?: string;
  limit?: number;
  region?: string;
}

// ============================================================================
// Lambda Invocation Types
// ============================================================================

export interface LambdaInvokeOptions {
  functionName: string;
  payload?: string | Buffer | Uint8Array;
  invocationType?: 'RequestResponse' | 'Event' | 'DryRun';
  logType?: 'None' | 'Tail';
  clientContext?: string;
  qualifier?: string;
  region?: string;
}

export interface LambdaInvokeResult {
  statusCode: number;
  executedVersion?: string;
  functionError?: string;
  logResult?: string;
  payload?: string;
}

// ============================================================================
// Lambda Concurrency Types
// ============================================================================

export interface LambdaConcurrencyConfig {
  functionName: string;
  reservedConcurrentExecutions?: number;
}

export interface LambdaProvisionedConcurrencyConfig {
  functionName: string;
  qualifier: string;
  requestedProvisionedConcurrentExecutions: number;
  availableProvisionedConcurrentExecutions?: number;
  allocatedProvisionedConcurrentExecutions?: number;
  status?: 'IN_PROGRESS' | 'READY' | 'FAILED';
  statusReason?: string;
  lastModified?: string;
}

export interface LambdaSetProvisionedConcurrencyOptions {
  functionName: string;
  qualifier: string;
  provisionedConcurrentExecutions: number;
  region?: string;
}

// ============================================================================
// Lambda Function URL Types
// ============================================================================

export interface LambdaFunctionUrl {
  functionUrl: string;
  functionArn: string;
  authType: 'NONE' | 'AWS_IAM';
  cors?: {
    allowCredentials?: boolean;
    allowHeaders?: string[];
    allowMethods?: string[];
    allowOrigins?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
  };
  creationTime?: string;
  lastModifiedTime?: string;
  invokeMode?: 'BUFFERED' | 'RESPONSE_STREAM';
}

export interface LambdaCreateFunctionUrlOptions {
  functionName: string;
  qualifier?: string;
  authType: 'NONE' | 'AWS_IAM';
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
}

// ============================================================================
// Lambda Cold Start Optimization Types
// ============================================================================

export interface LambdaColdStartAnalysis {
  functionName: string;
  averageInitDuration?: number;
  averageDuration?: number;
  coldStartPercentage?: number;
  recommendations: string[];
  optimizationScore: number;
}

export interface LambdaWarmupOptions {
  functionName: string;
  concurrency?: number;
  payload?: string;
  region?: string;
}

// ============================================================================
// Lambda Code Signing Types
// ============================================================================

export interface LambdaCodeSigningConfig {
  codeSigningConfigId: string;
  codeSigningConfigArn: string;
  description?: string;
  allowedPublishers: {
    signingProfileVersionArns: string[];
  };
  codeSigningPolicies: {
    untrustedArtifactOnDeployment: 'Warn' | 'Enforce';
  };
  lastModified?: string;
}

// ============================================================================
// Lambda Reserved Concurrency Types
// ============================================================================

export interface LambdaAccountSettings {
  accountLimit?: {
    totalCodeSize?: number;
    codeSizeUnzipped?: number;
    codeSizeZipped?: number;
    concurrentExecutions?: number;
    unreservedConcurrentExecutions?: number;
  };
  accountUsage?: {
    totalCodeSize?: number;
    functionCount?: number;
  };
}
