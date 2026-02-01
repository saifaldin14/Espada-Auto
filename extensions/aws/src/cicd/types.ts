/**
 * AWS CI/CD Pipeline Integration Types
 *
 * Type definitions for AWS CodePipeline, CodeBuild, CodeDeploy,
 * and related CI/CD operations for pipeline creation, build management,
 * deployment automation, and blue/green deployment orchestration.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * CI/CD operation result
 */
export interface CICDOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * CI/CD Manager configuration
 */
export interface CICDManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

// =============================================================================
// CodePipeline Types
// =============================================================================

/**
 * Pipeline status
 */
export type PipelineStatus = 
  | 'Created'
  | 'InProgress'
  | 'Stopped'
  | 'Stopping'
  | 'Succeeded'
  | 'Superseded'
  | 'Failed'
  | 'Cancelled'
  | 'Abandoned'
  | 'Unknown';

/**
 * Stage execution status
 */
export type StageStatus =
  | 'Cancelled'
  | 'InProgress'
  | 'Failed'
  | 'Stopped'
  | 'Stopping'
  | 'Succeeded'
  | 'Unknown';

/**
 * Action execution status
 */
export type ActionStatus =
  | 'InProgress'
  | 'Abandoned'
  | 'Succeeded'
  | 'Failed'
  | 'Unknown';

/**
 * Action category type
 */
export type ActionCategory =
  | 'Source'
  | 'Build'
  | 'Deploy'
  | 'Test'
  | 'Invoke'
  | 'Approval';

/**
 * Pipeline source provider type
 */
export type SourceProvider =
  | 'GitHub'
  | 'GitHubEnterpriseServer'
  | 'Bitbucket'
  | 'CodeCommit'
  | 'CodeStarSourceConnection'
  | 'ECR'
  | 'S3';

/**
 * Build provider type
 */
export type BuildProvider = 'CodeBuild' | 'Jenkins';

/**
 * Deploy provider type
 */
export type DeployProvider =
  | 'CloudFormation'
  | 'CodeDeploy'
  | 'ECS'
  | 'ElasticBeanstalk'
  | 'Lambda'
  | 'S3'
  | 'ServiceCatalog';

/**
 * Pipeline artifact store type
 */
export type ArtifactStoreType = 'S3';

/**
 * Pipeline information
 */
export interface PipelineInfo {
  pipelineName: string;
  pipelineArn?: string;
  roleArn: string;
  artifactStore: ArtifactStoreInfo;
  stages: StageInfo[];
  version: number;
  created?: Date;
  updated?: Date;
  executionMode?: 'QUEUED' | 'SUPERSEDED' | 'PARALLEL';
  pipelineType?: 'V1' | 'V2';
  variables?: PipelineVariable[];
  triggers?: PipelineTrigger[];
}

/**
 * Artifact store info
 */
export interface ArtifactStoreInfo {
  type: ArtifactStoreType;
  location: string;
  encryptionKey?: {
    id: string;
    type: 'KMS';
  };
}

/**
 * Pipeline variable
 */
export interface PipelineVariable {
  name: string;
  defaultValue?: string;
  description?: string;
}

/**
 * Pipeline trigger
 */
export interface PipelineTrigger {
  providerType: 'CodeStarSourceConnection';
  gitConfiguration: {
    sourceActionName: string;
    push?: {
      branches?: { includes?: string[]; excludes?: string[] };
      filePaths?: { includes?: string[]; excludes?: string[] };
      tags?: { includes?: string[]; excludes?: string[] };
    }[];
    pullRequest?: {
      branches?: { includes?: string[]; excludes?: string[] };
      filePaths?: { includes?: string[]; excludes?: string[] };
      events?: ('OPEN' | 'UPDATED' | 'CLOSED')[];
    }[];
  };
}

/**
 * Stage information
 */
export interface StageInfo {
  stageName: string;
  actions: ActionInfo[];
  blockers?: StageBlocker[];
}

/**
 * Stage blocker
 */
export interface StageBlocker {
  name: string;
  type: 'Schedule';
}

/**
 * Action information
 */
export interface ActionInfo {
  actionName: string;
  actionTypeId: {
    category: ActionCategory;
    owner: 'AWS' | 'ThirdParty' | 'Custom';
    provider: string;
    version: string;
  };
  runOrder?: number;
  configuration?: Record<string, string>;
  inputArtifacts?: string[];
  outputArtifacts?: string[];
  region?: string;
  namespace?: string;
  roleArn?: string;
}

/**
 * Pipeline summary (for listing)
 */
export interface PipelineSummary {
  pipelineName: string;
  version: number;
  created?: Date;
  updated?: Date;
  pipelineType?: 'V1' | 'V2';
  executionMode?: 'QUEUED' | 'SUPERSEDED' | 'PARALLEL';
}

/**
 * Pipeline execution summary
 */
export interface PipelineExecutionSummary {
  pipelineExecutionId: string;
  status: PipelineStatus;
  startTime?: Date;
  lastUpdateTime?: Date;
  sourceRevisions?: SourceRevision[];
  trigger?: {
    triggerType: string;
    triggerDetail?: string;
  };
  stopTrigger?: {
    reason?: string;
  };
}

/**
 * Source revision
 */
export interface SourceRevision {
  actionName: string;
  revisionId?: string;
  revisionSummary?: string;
  revisionUrl?: string;
}

/**
 * Detailed pipeline execution
 */
export interface PipelineExecutionDetail {
  pipelineExecutionId: string;
  pipelineName: string;
  pipelineVersion: number;
  status: PipelineStatus;
  statusSummary?: string;
  artifactRevisions?: ArtifactRevision[];
  variables?: ResolvedPipelineVariable[];
}

/**
 * Artifact revision
 */
export interface ArtifactRevision {
  name: string;
  revisionId?: string;
  revisionChangeIdentifier?: string;
  revisionSummary?: string;
  created?: Date;
  revisionUrl?: string;
}

/**
 * Resolved pipeline variable
 */
export interface ResolvedPipelineVariable {
  name: string;
  resolvedValue: string;
}

/**
 * Stage state
 */
export interface StageState {
  stageName: string;
  inboundExecution?: StageExecutionInfo;
  inboundTransitionState?: TransitionState;
  actionStates: ActionState[];
  latestExecution?: StageExecutionInfo;
}

/**
 * Stage execution info
 */
export interface StageExecutionInfo {
  pipelineExecutionId: string;
  status: StageStatus;
}

/**
 * Transition state
 */
export interface TransitionState {
  enabled: boolean;
  lastChangedBy?: string;
  lastChangedAt?: Date;
  disabledReason?: string;
}

/**
 * Action state
 */
export interface ActionState {
  actionName: string;
  currentRevision?: {
    revisionId: string;
    revisionChangeId?: string;
    created?: Date;
  };
  latestExecution?: {
    actionExecutionId: string;
    status: ActionStatus;
    summary?: string;
    lastStatusChange?: Date;
    token?: string;
    lastUpdatedBy?: string;
    externalExecutionId?: string;
    externalExecutionUrl?: string;
    percentComplete?: number;
    errorDetails?: {
      code?: string;
      message?: string;
    };
  };
  entityUrl?: string;
  revisionUrl?: string;
}

/**
 * Action execution details
 */
export interface ActionExecutionDetail {
  pipelineExecutionId: string;
  actionExecutionId: string;
  pipelineVersion: number;
  stageName: string;
  actionName: string;
  startTime?: Date;
  lastUpdateTime?: Date;
  status: ActionStatus;
  input?: {
    actionTypeId: ActionInfo['actionTypeId'];
    configuration?: Record<string, string>;
    resolvedConfiguration?: Record<string, string>;
    roleArn?: string;
    region?: string;
    inputArtifacts?: InputArtifact[];
    namespace?: string;
  };
  output?: {
    outputArtifacts?: OutputArtifact[];
    executionResult?: {
      externalExecutionId?: string;
      externalExecutionSummary?: string;
      externalExecutionUrl?: string;
    };
    outputVariables?: Record<string, string>;
  };
}

/**
 * Input artifact
 */
export interface InputArtifact {
  name: string;
  s3location?: {
    bucket: string;
    key: string;
  };
}

/**
 * Output artifact
 */
export interface OutputArtifact {
  name: string;
  s3location?: {
    bucket: string;
    key: string;
  };
}

// =============================================================================
// CodeBuild Types
// =============================================================================

/**
 * Build status
 */
export type BuildStatus =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'FAULT'
  | 'TIMED_OUT'
  | 'IN_PROGRESS'
  | 'STOPPED';

/**
 * Build phase type
 */
export type BuildPhaseType =
  | 'SUBMITTED'
  | 'QUEUED'
  | 'PROVISIONING'
  | 'DOWNLOAD_SOURCE'
  | 'INSTALL'
  | 'PRE_BUILD'
  | 'BUILD'
  | 'POST_BUILD'
  | 'UPLOAD_ARTIFACTS'
  | 'FINALIZING'
  | 'COMPLETED';

/**
 * Build phase status
 */
export type BuildPhaseStatus =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'FAULT'
  | 'TIMED_OUT'
  | 'IN_PROGRESS'
  | 'STOPPED';

/**
 * Compute type for CodeBuild
 */
export type ComputeType =
  | 'BUILD_GENERAL1_SMALL'
  | 'BUILD_GENERAL1_MEDIUM'
  | 'BUILD_GENERAL1_LARGE'
  | 'BUILD_GENERAL1_2XLARGE'
  | 'BUILD_LAMBDA_1GB'
  | 'BUILD_LAMBDA_2GB'
  | 'BUILD_LAMBDA_4GB'
  | 'BUILD_LAMBDA_8GB'
  | 'BUILD_LAMBDA_10GB';

/**
 * Environment type
 */
export type EnvironmentType =
  | 'LINUX_CONTAINER'
  | 'LINUX_GPU_CONTAINER'
  | 'ARM_CONTAINER'
  | 'WINDOWS_SERVER_2019_CONTAINER'
  | 'WINDOWS_SERVER_2022_CONTAINER'
  | 'LINUX_LAMBDA_CONTAINER'
  | 'ARM_LAMBDA_CONTAINER';

/**
 * Source type for CodeBuild
 */
export type CodeBuildSourceType =
  | 'BITBUCKET'
  | 'CODECOMMIT'
  | 'CODEPIPELINE'
  | 'GITHUB'
  | 'GITHUB_ENTERPRISE'
  | 'GITLAB'
  | 'GITLAB_SELF_MANAGED'
  | 'NO_SOURCE'
  | 'S3';

/**
 * Artifact type
 */
export type ArtifactType = 'CODEPIPELINE' | 'NO_ARTIFACTS' | 'S3';

/**
 * Build project information
 */
export interface BuildProjectInfo {
  name: string;
  arn?: string;
  description?: string;
  source: BuildSourceInfo;
  secondarySources?: BuildSourceInfo[];
  sourceVersion?: string;
  secondarySourceVersions?: SecondarySourceVersion[];
  artifacts: BuildArtifactInfo;
  secondaryArtifacts?: BuildArtifactInfo[];
  cache?: BuildCacheInfo;
  environment: BuildEnvironmentInfo;
  serviceRole: string;
  timeoutInMinutes: number;
  queuedTimeoutInMinutes?: number;
  encryptionKey?: string;
  tags?: Record<string, string>;
  created?: Date;
  lastModified?: Date;
  webhook?: WebhookInfo;
  vpcConfig?: VpcConfigInfo;
  badge?: { badgeEnabled: boolean; badgeRequestUrl?: string };
  logsConfig?: LogsConfigInfo;
  fileSystemLocations?: FileSystemLocation[];
  buildBatchConfig?: BuildBatchConfig;
  concurrentBuildLimit?: number;
  projectVisibility?: 'PUBLIC_READ' | 'PRIVATE';
  publicProjectAlias?: string;
  resourceAccessRole?: string;
}

/**
 * Build source info
 */
export interface BuildSourceInfo {
  type: CodeBuildSourceType;
  location?: string;
  gitCloneDepth?: number;
  gitSubmodulesConfig?: { fetchSubmodules: boolean };
  buildspec?: string;
  auth?: { type: 'OAUTH' | 'CODECONNECTIONS'; resource?: string };
  reportBuildStatus?: boolean;
  buildStatusConfig?: {
    context?: string;
    targetUrl?: string;
  };
  insecureSsl?: boolean;
  sourceIdentifier?: string;
}

/**
 * Secondary source version
 */
export interface SecondarySourceVersion {
  sourceIdentifier: string;
  sourceVersion: string;
}

/**
 * Build artifact info
 */
export interface BuildArtifactInfo {
  type: ArtifactType;
  location?: string;
  path?: string;
  namespaceType?: 'NONE' | 'BUILD_ID';
  name?: string;
  packaging?: 'NONE' | 'ZIP';
  overrideArtifactName?: boolean;
  encryptionDisabled?: boolean;
  artifactIdentifier?: string;
  bucketOwnerAccess?: 'NONE' | 'READ_ONLY' | 'FULL';
}

/**
 * Build cache info
 */
export interface BuildCacheInfo {
  type: 'NO_CACHE' | 'S3' | 'LOCAL';
  location?: string;
  modes?: ('LOCAL_DOCKER_LAYER_CACHE' | 'LOCAL_SOURCE_CACHE' | 'LOCAL_CUSTOM_CACHE')[];
}

/**
 * Build environment info
 */
export interface BuildEnvironmentInfo {
  type: EnvironmentType;
  image: string;
  computeType: ComputeType;
  environmentVariables?: EnvironmentVariable[];
  privilegedMode?: boolean;
  certificate?: string;
  registryCredential?: {
    credential: string;
    credentialProvider: 'SECRETS_MANAGER';
  };
  imagePullCredentialsType?: 'CODEBUILD' | 'SERVICE_ROLE';
}

/**
 * Environment variable
 */
export interface EnvironmentVariable {
  name: string;
  value: string;
  type?: 'PLAINTEXT' | 'PARAMETER_STORE' | 'SECRETS_MANAGER';
}

/**
 * Webhook info
 */
export interface WebhookInfo {
  url?: string;
  payloadUrl?: string;
  secret?: string;
  branchFilter?: string;
  filterGroups?: WebhookFilterGroup[];
  buildType?: 'BUILD' | 'BUILD_BATCH';
  lastModifiedSecret?: Date;
}

/**
 * Webhook filter group
 */
export interface WebhookFilterGroup {
  filters: WebhookFilter[];
}

/**
 * Webhook filter
 */
export interface WebhookFilter {
  type: 'EVENT' | 'BASE_REF' | 'HEAD_REF' | 'ACTOR_ACCOUNT_ID' | 'FILE_PATH' | 'COMMIT_MESSAGE';
  pattern: string;
  excludeMatchedPattern?: boolean;
}

/**
 * VPC config info
 */
export interface VpcConfigInfo {
  vpcId: string;
  subnets: string[];
  securityGroupIds: string[];
}

/**
 * Logs config info
 */
export interface LogsConfigInfo {
  cloudWatchLogs?: {
    status: 'ENABLED' | 'DISABLED';
    groupName?: string;
    streamName?: string;
  };
  s3Logs?: {
    status: 'ENABLED' | 'DISABLED';
    location?: string;
    encryptionDisabled?: boolean;
    bucketOwnerAccess?: 'NONE' | 'READ_ONLY' | 'FULL';
  };
}

/**
 * File system location
 */
export interface FileSystemLocation {
  type: 'EFS';
  location: string;
  mountPoint: string;
  identifier: string;
  mountOptions?: string;
}

/**
 * Build batch config
 */
export interface BuildBatchConfig {
  serviceRole?: string;
  combineArtifacts?: boolean;
  restrictions?: {
    maximumBuildsAllowed?: number;
    computeTypesAllowed?: string[];
  };
  timeoutInMins?: number;
  batchReportMode?: 'REPORT_INDIVIDUAL_BUILDS' | 'REPORT_AGGREGATED_BATCH';
}

/**
 * Build information
 */
export interface BuildInfo {
  id: string;
  arn?: string;
  buildNumber?: number;
  startTime?: Date;
  endTime?: Date;
  currentPhase: BuildPhaseType;
  buildStatus: BuildStatus;
  sourceVersion?: string;
  resolvedSourceVersion?: string;
  projectName: string;
  phases: BuildPhase[];
  source?: BuildSourceInfo;
  secondarySources?: BuildSourceInfo[];
  secondarySourceVersions?: SecondarySourceVersion[];
  artifacts?: BuildArtifactOutput;
  secondaryArtifacts?: BuildArtifactOutput[];
  cache?: BuildCacheInfo;
  environment: BuildEnvironmentInfo;
  serviceRole?: string;
  logs?: BuildLogs;
  timeoutInMinutes?: number;
  queuedTimeoutInMinutes?: number;
  buildComplete: boolean;
  initiator?: string;
  vpcConfig?: VpcConfigInfo;
  networkInterface?: {
    subnetId?: string;
    networkInterfaceId?: string;
  };
  encryptionKey?: string;
  exportedEnvironmentVariables?: EnvironmentVariable[];
  reportArns?: string[];
  fileSystemLocations?: FileSystemLocation[];
  debugSession?: {
    sessionEnabled?: boolean;
    sessionTarget?: string;
  };
  buildBatchArn?: string;
}

/**
 * Build phase
 */
export interface BuildPhase {
  phaseType: BuildPhaseType;
  phaseStatus?: BuildPhaseStatus;
  startTime?: Date;
  endTime?: Date;
  durationInSeconds?: number;
  contexts?: {
    statusCode?: string;
    message?: string;
  }[];
}

/**
 * Build artifact output
 */
export interface BuildArtifactOutput {
  location?: string;
  sha256sum?: string;
  md5sum?: string;
  overrideArtifactName?: boolean;
  encryptionDisabled?: boolean;
  artifactIdentifier?: string;
  bucketOwnerAccess?: 'NONE' | 'READ_ONLY' | 'FULL';
}

/**
 * Build logs
 */
export interface BuildLogs {
  groupName?: string;
  streamName?: string;
  deepLink?: string;
  s3DeepLink?: string;
  cloudWatchLogsArn?: string;
  s3LogsArn?: string;
}

/**
 * Build summary (for listing)
 */
export interface BuildSummary {
  id: string;
  arn?: string;
  buildStatus: BuildStatus;
  startTime?: Date;
  endTime?: Date;
  projectName: string;
}

// =============================================================================
// CodeDeploy Types
// =============================================================================

/**
 * Deployment status
 */
export type DeploymentStatus =
  | 'Created'
  | 'Queued'
  | 'InProgress'
  | 'Baking'
  | 'Succeeded'
  | 'Failed'
  | 'Stopped'
  | 'Ready';

/**
 * Deployment type
 */
export type DeploymentType = 'IN_PLACE' | 'BLUE_GREEN';

/**
 * Compute platform
 */
export type ComputePlatform = 'Server' | 'Lambda' | 'ECS';

/**
 * Deployment option
 */
export type DeploymentOption = 
  | 'WITH_TRAFFIC_CONTROL'
  | 'WITHOUT_TRAFFIC_CONTROL';

/**
 * Deployment ready option
 */
export type DeploymentReadyOption = 'CONTINUE_DEPLOYMENT' | 'STOP_DEPLOYMENT';

/**
 * Green fleet provisioning option
 */
export type GreenFleetProvisioningOption = 
  | 'DISCOVER_EXISTING'
  | 'COPY_AUTO_SCALING_GROUP';

/**
 * Instance action
 */
export type InstanceAction = 'TERMINATE' | 'KEEP_ALIVE';

/**
 * Traffic routing type
 */
export type TrafficRoutingType = 'TimeBasedCanary' | 'TimeBasedLinear' | 'AllAtOnce';

/**
 * CodeDeploy application info
 */
export interface ApplicationInfo {
  applicationId: string;
  applicationName: string;
  createTime?: Date;
  linkedToGitHub?: boolean;
  gitHubAccountName?: string;
  computePlatform: ComputePlatform;
}

/**
 * Deployment group info
 */
export interface DeploymentGroupInfo {
  applicationName: string;
  deploymentGroupId: string;
  deploymentGroupName: string;
  deploymentConfigName?: string;
  ec2TagFilters?: TagFilter[];
  onPremisesInstanceTagFilters?: TagFilter[];
  autoScalingGroups?: AutoScalingGroupInfo[];
  serviceRoleArn: string;
  targetRevision?: RevisionLocation;
  triggerConfigurations?: TriggerConfig[];
  alarmConfiguration?: AlarmConfiguration;
  autoRollbackConfiguration?: AutoRollbackConfiguration;
  deploymentStyle?: DeploymentStyle;
  outdatedInstancesStrategy?: 'UPDATE' | 'IGNORE';
  blueGreenDeploymentConfiguration?: BlueGreenDeploymentConfiguration;
  loadBalancerInfo?: LoadBalancerInfo;
  lastSuccessfulDeployment?: LastDeploymentInfo;
  lastAttemptedDeployment?: LastDeploymentInfo;
  ec2TagSet?: EC2TagSet;
  onPremisesTagSet?: OnPremisesTagSet;
  computePlatform: ComputePlatform;
  ecsServices?: ECSServiceInfo[];
  terminationHookEnabled?: boolean;
}

/**
 * Tag filter
 */
export interface TagFilter {
  key?: string;
  value?: string;
  type?: 'KEY_ONLY' | 'VALUE_ONLY' | 'KEY_AND_VALUE';
}

/**
 * Auto scaling group info
 */
export interface AutoScalingGroupInfo {
  name?: string;
  hook?: string;
}

/**
 * Revision location
 */
export interface RevisionLocation {
  revisionType: 'S3' | 'GitHub' | 'String' | 'AppSpecContent';
  s3Location?: {
    bucket: string;
    key: string;
    bundleType?: 'tar' | 'tgz' | 'zip' | 'YAML' | 'JSON';
    version?: string;
    eTag?: string;
  };
  gitHubLocation?: {
    repository: string;
    commitId: string;
  };
  string?: {
    content?: string;
    sha256?: string;
  };
  appSpecContent?: {
    content?: string;
    sha256?: string;
  };
}

/**
 * Trigger config
 */
export interface TriggerConfig {
  triggerName: string;
  triggerTargetArn?: string;
  triggerEvents?: (
    | 'DeploymentStart'
    | 'DeploymentSuccess'
    | 'DeploymentFailure'
    | 'DeploymentStop'
    | 'DeploymentRollback'
    | 'DeploymentReady'
    | 'InstanceStart'
    | 'InstanceSuccess'
    | 'InstanceFailure'
    | 'InstanceReady'
  )[];
}

/**
 * Alarm configuration
 */
export interface AlarmConfiguration {
  enabled: boolean;
  ignorePollAlarmFailure?: boolean;
  alarms?: { name: string }[];
}

/**
 * Auto rollback configuration
 */
export interface AutoRollbackConfiguration {
  enabled: boolean;
  events?: ('DEPLOYMENT_FAILURE' | 'DEPLOYMENT_STOP_ON_ALARM' | 'DEPLOYMENT_STOP_ON_REQUEST')[];
}

/**
 * Deployment style
 */
export interface DeploymentStyle {
  deploymentType?: DeploymentType;
  deploymentOption?: DeploymentOption;
}

/**
 * Blue/green deployment configuration
 */
export interface BlueGreenDeploymentConfiguration {
  terminateBlueInstancesOnDeploymentSuccess?: {
    action?: InstanceAction;
    terminationWaitTimeInMinutes?: number;
  };
  deploymentReadyOption?: {
    actionOnTimeout?: DeploymentReadyOption;
    waitTimeInMinutes?: number;
  };
  greenFleetProvisioningOption?: {
    action?: GreenFleetProvisioningOption;
  };
}

/**
 * Load balancer info
 */
export interface LoadBalancerInfo {
  elbInfoList?: { name: string }[];
  targetGroupInfoList?: { name: string }[];
  targetGroupPairInfoList?: TargetGroupPairInfo[];
}

/**
 * Target group pair info
 */
export interface TargetGroupPairInfo {
  targetGroups?: { name: string }[];
  prodTrafficRoute?: { listenerArns: string[] };
  testTrafficRoute?: { listenerArns: string[] };
}

/**
 * Last deployment info
 */
export interface LastDeploymentInfo {
  deploymentId?: string;
  status?: DeploymentStatus;
  endTime?: Date;
  createTime?: Date;
}

/**
 * EC2 tag set
 */
export interface EC2TagSet {
  ec2TagSetList?: TagFilter[][];
}

/**
 * On-premises tag set
 */
export interface OnPremisesTagSet {
  onPremisesTagSetList?: TagFilter[][];
}

/**
 * ECS service info
 */
export interface ECSServiceInfo {
  serviceName: string;
  clusterName: string;
}

/**
 * Deployment information
 */
export interface DeploymentInfo {
  applicationName: string;
  deploymentGroupName: string;
  deploymentConfigName?: string;
  deploymentId: string;
  previousRevision?: RevisionLocation;
  revision?: RevisionLocation;
  status: DeploymentStatus;
  errorInformation?: {
    code?: string;
    message?: string;
  };
  createTime?: Date;
  startTime?: Date;
  completeTime?: Date;
  deploymentOverview?: DeploymentOverview;
  description?: string;
  creator?: 'user' | 'autoscaling' | 'codeDeployRollback' | 'CodeDeploy' | 'CodeDeployAutoUpdate' | 'CloudFormation' | 'CloudFormationRollback';
  ignoreApplicationStopFailures?: boolean;
  autoRollbackConfiguration?: AutoRollbackConfiguration;
  updateOutdatedInstancesOnly?: boolean;
  rollbackInfo?: RollbackInfo;
  deploymentStyle?: DeploymentStyle;
  targetInstances?: TargetInstances;
  instanceTerminationWaitTimeStarted?: boolean;
  blueGreenDeploymentConfiguration?: BlueGreenDeploymentConfiguration;
  loadBalancerInfo?: LoadBalancerInfo;
  additionalDeploymentStatusInfo?: string;
  fileExistsBehavior?: 'DISALLOW' | 'OVERWRITE' | 'RETAIN';
  deploymentStatusMessages?: string[];
  computePlatform?: ComputePlatform;
  externalId?: string;
  relatedDeployments?: {
    autoUpdateOutdatedInstancesRootDeploymentId?: string;
    autoUpdateOutdatedInstancesDeploymentIds?: string[];
  };
  overrideAlarmConfiguration?: AlarmConfiguration;
}

/**
 * Deployment overview
 */
export interface DeploymentOverview {
  Pending?: number;
  InProgress?: number;
  Succeeded?: number;
  Failed?: number;
  Skipped?: number;
  Ready?: number;
}

/**
 * Rollback info
 */
export interface RollbackInfo {
  rollbackDeploymentId?: string;
  rollbackTriggeringDeploymentId?: string;
  rollbackMessage?: string;
}

/**
 * Target instances
 */
export interface TargetInstances {
  tagFilters?: TagFilter[];
  autoScalingGroups?: string[];
  ec2TagSet?: EC2TagSet;
}

/**
 * Deployment config info
 */
export interface DeploymentConfigInfo {
  deploymentConfigId: string;
  deploymentConfigName: string;
  minimumHealthyHosts?: {
    type: 'HOST_COUNT' | 'FLEET_PERCENT';
    value: number;
  };
  createTime?: Date;
  computePlatform?: ComputePlatform;
  trafficRoutingConfig?: TrafficRoutingConfig;
  zonalConfig?: {
    firstZoneMonitorDurationInSeconds?: number;
    monitorDurationInSeconds?: number;
    minimumHealthyHostsPerZone?: {
      type: 'HOST_COUNT' | 'FLEET_PERCENT';
      value: number;
    };
  };
}

/**
 * Traffic routing config
 */
export interface TrafficRoutingConfig {
  type: TrafficRoutingType;
  timeBasedCanary?: {
    canaryPercentage: number;
    canaryInterval: number;
  };
  timeBasedLinear?: {
    linearPercentage: number;
    linearInterval: number;
  };
}

// =============================================================================
// Options Types
// =============================================================================

/**
 * Options for listing pipelines
 */
export interface ListPipelinesOptions {
  maxResults?: number;
  nextToken?: string;
}

/**
 * Options for creating a pipeline
 */
export interface CreatePipelineOptions {
  pipelineName: string;
  roleArn: string;
  artifactStore: ArtifactStoreInfo;
  stages: StageInfo[];
  executionMode?: 'QUEUED' | 'SUPERSEDED' | 'PARALLEL';
  pipelineType?: 'V1' | 'V2';
  variables?: PipelineVariable[];
  triggers?: PipelineTrigger[];
  tags?: Record<string, string>;
}

/**
 * Options for updating a pipeline
 */
export interface UpdatePipelineOptions {
  pipeline: PipelineInfo;
}

/**
 * Options for listing pipeline executions
 */
export interface ListPipelineExecutionsOptions {
  pipelineName: string;
  maxResults?: number;
  nextToken?: string;
  filter?: {
    succeededInStage?: {
      stageName: string;
    };
  };
}

/**
 * Options for starting pipeline execution
 */
export interface StartPipelineExecutionOptions {
  pipelineName: string;
  clientRequestToken?: string;
  sourceRevisions?: {
    actionName: string;
    revisionType: 'COMMIT_ID' | 'IMAGE_DIGEST' | 'S3_OBJECT_VERSION_ID';
    revisionValue: string;
  }[];
  variables?: { name: string; value: string }[];
}

/**
 * Options for stopping pipeline execution
 */
export interface StopPipelineExecutionOptions {
  pipelineName: string;
  pipelineExecutionId: string;
  abandon?: boolean;
  reason?: string;
}

/**
 * Options for retrying stage execution
 */
export interface RetryStageExecutionOptions {
  pipelineName: string;
  stageName: string;
  pipelineExecutionId: string;
  retryMode: 'FAILED_ACTIONS' | 'ALL_ACTIONS';
}

/**
 * Options for listing action executions
 */
export interface ListActionExecutionsOptions {
  pipelineName: string;
  filter?: {
    pipelineExecutionId?: string;
    latestInPipelineExecution?: {
      pipelineExecutionId: string;
      startTimeRange?: 'Latest' | 'All';
    };
  };
  maxResults?: number;
  nextToken?: string;
}

/**
 * Options for listing build projects
 */
export interface ListBuildProjectsOptions {
  sortBy?: 'NAME' | 'CREATED_TIME' | 'LAST_MODIFIED_TIME';
  sortOrder?: 'ASCENDING' | 'DESCENDING';
  nextToken?: string;
}

/**
 * Options for creating a build project
 */
export interface CreateBuildProjectOptions {
  name: string;
  description?: string;
  source: BuildSourceInfo;
  secondarySources?: BuildSourceInfo[];
  sourceVersion?: string;
  secondarySourceVersions?: SecondarySourceVersion[];
  artifacts: BuildArtifactInfo;
  secondaryArtifacts?: BuildArtifactInfo[];
  cache?: BuildCacheInfo;
  environment: BuildEnvironmentInfo;
  serviceRole: string;
  timeoutInMinutes?: number;
  queuedTimeoutInMinutes?: number;
  encryptionKey?: string;
  tags?: Record<string, string>;
  vpcConfig?: VpcConfigInfo;
  badgeEnabled?: boolean;
  logsConfig?: LogsConfigInfo;
  fileSystemLocations?: FileSystemLocation[];
  buildBatchConfig?: BuildBatchConfig;
  concurrentBuildLimit?: number;
}

/**
 * Options for updating a build project
 */
export interface UpdateBuildProjectOptions extends Partial<CreateBuildProjectOptions> {
  name: string;
}

/**
 * Options for starting a build
 */
export interface StartBuildOptions {
  projectName: string;
  secondarySourcesOverride?: BuildSourceInfo[];
  secondarySourcesVersionOverride?: SecondarySourceVersion[];
  sourceVersion?: string;
  artifactsOverride?: BuildArtifactInfo;
  secondaryArtifactsOverride?: BuildArtifactInfo[];
  environmentVariablesOverride?: EnvironmentVariable[];
  sourceTypeOverride?: CodeBuildSourceType;
  sourceLocationOverride?: string;
  sourceAuthOverride?: { type: 'OAUTH' | 'CODECONNECTIONS'; resource?: string };
  gitCloneDepthOverride?: number;
  gitSubmodulesConfigOverride?: { fetchSubmodules: boolean };
  buildspecOverride?: string;
  insecureSslOverride?: boolean;
  reportBuildStatusOverride?: boolean;
  buildStatusConfigOverride?: { context?: string; targetUrl?: string };
  environmentTypeOverride?: EnvironmentType;
  imageOverride?: string;
  computeTypeOverride?: ComputeType;
  certificateOverride?: string;
  cacheOverride?: BuildCacheInfo;
  serviceRoleOverride?: string;
  privilegedModeOverride?: boolean;
  timeoutInMinutesOverride?: number;
  queuedTimeoutInMinutesOverride?: number;
  encryptionKeyOverride?: string;
  idempotencyToken?: string;
  logsConfigOverride?: LogsConfigInfo;
  registryCredentialOverride?: { credential: string; credentialProvider: 'SECRETS_MANAGER' };
  imagePullCredentialsTypeOverride?: 'CODEBUILD' | 'SERVICE_ROLE';
  debugSessionEnabled?: boolean;
  fleetOverride?: { fleetArn?: string };
}

/**
 * Options for listing builds
 */
export interface ListBuildsOptions {
  sortOrder?: 'ASCENDING' | 'DESCENDING';
  nextToken?: string;
}

/**
 * Options for listing builds for project
 */
export interface ListBuildsForProjectOptions {
  projectName: string;
  sortOrder?: 'ASCENDING' | 'DESCENDING';
  nextToken?: string;
}

/**
 * Options for listing CodeDeploy applications
 */
export interface ListApplicationsOptions {
  nextToken?: string;
}

/**
 * Options for creating a CodeDeploy application
 */
export interface CreateApplicationOptions {
  applicationName: string;
  computePlatform?: ComputePlatform;
  tags?: Record<string, string>;
}

/**
 * Options for listing deployment groups
 */
export interface ListDeploymentGroupsOptions {
  applicationName: string;
  nextToken?: string;
}

/**
 * Options for creating a deployment group
 */
export interface CreateDeploymentGroupOptions {
  applicationName: string;
  deploymentGroupName: string;
  deploymentConfigName?: string;
  ec2TagFilters?: TagFilter[];
  onPremisesInstanceTagFilters?: TagFilter[];
  autoScalingGroups?: string[];
  serviceRoleArn: string;
  triggerConfigurations?: TriggerConfig[];
  alarmConfiguration?: AlarmConfiguration;
  autoRollbackConfiguration?: AutoRollbackConfiguration;
  outdatedInstancesStrategy?: 'UPDATE' | 'IGNORE';
  deploymentStyle?: DeploymentStyle;
  blueGreenDeploymentConfiguration?: BlueGreenDeploymentConfiguration;
  loadBalancerInfo?: LoadBalancerInfo;
  ec2TagSet?: EC2TagSet;
  ecsServices?: ECSServiceInfo[];
  onPremisesTagSet?: OnPremisesTagSet;
  tags?: Record<string, string>;
  terminationHookEnabled?: boolean;
}

/**
 * Options for updating a deployment group
 */
export interface UpdateDeploymentGroupOptions extends Partial<CreateDeploymentGroupOptions> {
  applicationName: string;
  currentDeploymentGroupName: string;
  newDeploymentGroupName?: string;
}

/**
 * Options for creating a deployment
 */
export interface CreateDeploymentOptions {
  applicationName: string;
  deploymentGroupName?: string;
  revision?: RevisionLocation;
  deploymentConfigName?: string;
  description?: string;
  ignoreApplicationStopFailures?: boolean;
  targetInstances?: TargetInstances;
  autoRollbackConfiguration?: AutoRollbackConfiguration;
  updateOutdatedInstancesOnly?: boolean;
  fileExistsBehavior?: 'DISALLOW' | 'OVERWRITE' | 'RETAIN';
  overrideAlarmConfiguration?: AlarmConfiguration;
}

/**
 * Options for listing deployments
 */
export interface ListDeploymentsOptions {
  applicationName?: string;
  deploymentGroupName?: string;
  externalId?: string;
  includeOnlyStatuses?: DeploymentStatus[];
  createTimeRange?: {
    start?: Date;
    end?: Date;
  };
  nextToken?: string;
}

/**
 * Options for listing deployment configs
 */
export interface ListDeploymentConfigsOptions {
  nextToken?: string;
}

/**
 * Options for creating a deployment config
 */
export interface CreateDeploymentConfigOptions {
  deploymentConfigName: string;
  minimumHealthyHosts?: {
    type: 'HOST_COUNT' | 'FLEET_PERCENT';
    value: number;
  };
  trafficRoutingConfig?: TrafficRoutingConfig;
  computePlatform?: ComputePlatform;
  zonalConfig?: {
    firstZoneMonitorDurationInSeconds?: number;
    monitorDurationInSeconds?: number;
    minimumHealthyHostsPerZone?: {
      type: 'HOST_COUNT' | 'FLEET_PERCENT';
      value: number;
    };
  };
}

// =============================================================================
// Pipeline Templates
// =============================================================================

/**
 * Pipeline template info
 */
export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  category: 'source-to-deploy' | 'build-only' | 'deploy-only' | 'multi-stage';
  sourceProvider: SourceProvider;
  deployTarget: 'ECS' | 'EC2' | 'Lambda' | 'S3' | 'CloudFormation' | 'None';
  stages: TemplateStageInfo[];
  requiredParameters: TemplateParameter[];
  optionalParameters: TemplateParameter[];
}

/**
 * Template stage info
 */
export interface TemplateStageInfo {
  name: string;
  description: string;
  actionType: ActionCategory;
}

/**
 * Template parameter
 */
export interface TemplateParameter {
  name: string;
  description: string;
  type: 'string' | 'arn' | 'region' | 'bucket' | 'branch';
  defaultValue?: string;
}

/**
 * Blue/green deployment options
 */
export interface BlueGreenDeploymentOptions {
  applicationName: string;
  deploymentGroupName: string;
  trafficRoutingType: TrafficRoutingType;
  canaryPercentage?: number;
  canaryIntervalMinutes?: number;
  linearPercentage?: number;
  linearIntervalMinutes?: number;
  terminationWaitTimeMinutes?: number;
}

// =============================================================================
// Pipeline Template Definitions
// =============================================================================

/**
 * Predefined pipeline templates for common CI/CD patterns
 */
export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'github-codebuild-ecs',
    name: 'GitHub → CodeBuild → ECS',
    description: 'Build from GitHub and deploy to ECS Fargate',
    category: 'source-to-deploy',
    sourceProvider: 'CodeStarSourceConnection',
    deployTarget: 'ECS',
    stages: [
      { name: 'Source', description: 'Pull source from GitHub', actionType: 'Source' },
      { name: 'Build', description: 'Build Docker image with CodeBuild', actionType: 'Build' },
      { name: 'Deploy', description: 'Deploy to ECS cluster', actionType: 'Deploy' },
    ],
    requiredParameters: [
      { name: 'connectionArn', description: 'CodeStar connection ARN for GitHub', type: 'arn' },
      { name: 'repositoryId', description: 'GitHub repository (owner/repo)', type: 'string' },
      { name: 'branchName', description: 'Branch to track', type: 'branch', defaultValue: 'main' },
      { name: 'ecsClusterName', description: 'ECS cluster name', type: 'string' },
      { name: 'ecsServiceName', description: 'ECS service name', type: 'string' },
    ],
    optionalParameters: [
      { name: 'buildspecPath', description: 'Path to buildspec.yml', type: 'string', defaultValue: 'buildspec.yml' },
    ],
  },
  {
    id: 'github-codebuild-s3',
    name: 'GitHub → CodeBuild → S3',
    description: 'Build from GitHub and deploy static site to S3',
    category: 'source-to-deploy',
    sourceProvider: 'CodeStarSourceConnection',
    deployTarget: 'S3',
    stages: [
      { name: 'Source', description: 'Pull source from GitHub', actionType: 'Source' },
      { name: 'Build', description: 'Build with CodeBuild', actionType: 'Build' },
      { name: 'Deploy', description: 'Deploy to S3 bucket', actionType: 'Deploy' },
    ],
    requiredParameters: [
      { name: 'connectionArn', description: 'CodeStar connection ARN for GitHub', type: 'arn' },
      { name: 'repositoryId', description: 'GitHub repository (owner/repo)', type: 'string' },
      { name: 'branchName', description: 'Branch to track', type: 'branch', defaultValue: 'main' },
      { name: 'deployBucket', description: 'S3 bucket for deployment', type: 'bucket' },
    ],
    optionalParameters: [
      { name: 'buildspecPath', description: 'Path to buildspec.yml', type: 'string', defaultValue: 'buildspec.yml' },
      { name: 'extractArtifacts', description: 'Extract artifacts before upload', type: 'string', defaultValue: 'true' },
    ],
  },
  {
    id: 'github-codebuild-lambda',
    name: 'GitHub → CodeBuild → Lambda',
    description: 'Build from GitHub and deploy to Lambda',
    category: 'source-to-deploy',
    sourceProvider: 'CodeStarSourceConnection',
    deployTarget: 'Lambda',
    stages: [
      { name: 'Source', description: 'Pull source from GitHub', actionType: 'Source' },
      { name: 'Build', description: 'Build deployment package', actionType: 'Build' },
      { name: 'Deploy', description: 'Deploy to Lambda function', actionType: 'Deploy' },
    ],
    requiredParameters: [
      { name: 'connectionArn', description: 'CodeStar connection ARN for GitHub', type: 'arn' },
      { name: 'repositoryId', description: 'GitHub repository (owner/repo)', type: 'string' },
      { name: 'branchName', description: 'Branch to track', type: 'branch', defaultValue: 'main' },
      { name: 'functionName', description: 'Lambda function name', type: 'string' },
    ],
    optionalParameters: [
      { name: 'buildspecPath', description: 'Path to buildspec.yml', type: 'string', defaultValue: 'buildspec.yml' },
    ],
  },
  {
    id: 'github-codebuild-ec2-bluegreen',
    name: 'GitHub → CodeBuild → EC2 (Blue/Green)',
    description: 'Build from GitHub and deploy to EC2 with blue/green deployment',
    category: 'source-to-deploy',
    sourceProvider: 'CodeStarSourceConnection',
    deployTarget: 'EC2',
    stages: [
      { name: 'Source', description: 'Pull source from GitHub', actionType: 'Source' },
      { name: 'Build', description: 'Build application', actionType: 'Build' },
      { name: 'Deploy', description: 'Blue/green deploy to EC2', actionType: 'Deploy' },
    ],
    requiredParameters: [
      { name: 'connectionArn', description: 'CodeStar connection ARN for GitHub', type: 'arn' },
      { name: 'repositoryId', description: 'GitHub repository (owner/repo)', type: 'string' },
      { name: 'branchName', description: 'Branch to track', type: 'branch', defaultValue: 'main' },
      { name: 'applicationName', description: 'CodeDeploy application name', type: 'string' },
      { name: 'deploymentGroupName', description: 'CodeDeploy deployment group', type: 'string' },
    ],
    optionalParameters: [
      { name: 'buildspecPath', description: 'Path to buildspec.yml', type: 'string', defaultValue: 'buildspec.yml' },
    ],
  },
  {
    id: 'codecommit-codebuild-ecs',
    name: 'CodeCommit → CodeBuild → ECS',
    description: 'Build from CodeCommit and deploy to ECS',
    category: 'source-to-deploy',
    sourceProvider: 'CodeCommit',
    deployTarget: 'ECS',
    stages: [
      { name: 'Source', description: 'Pull source from CodeCommit', actionType: 'Source' },
      { name: 'Build', description: 'Build Docker image', actionType: 'Build' },
      { name: 'Deploy', description: 'Deploy to ECS', actionType: 'Deploy' },
    ],
    requiredParameters: [
      { name: 'repositoryName', description: 'CodeCommit repository name', type: 'string' },
      { name: 'branchName', description: 'Branch to track', type: 'branch', defaultValue: 'main' },
      { name: 'ecsClusterName', description: 'ECS cluster name', type: 'string' },
      { name: 'ecsServiceName', description: 'ECS service name', type: 'string' },
    ],
    optionalParameters: [
      { name: 'buildspecPath', description: 'Path to buildspec.yml', type: 'string', defaultValue: 'buildspec.yml' },
    ],
  },
  {
    id: 's3-cloudformation',
    name: 'S3 → CloudFormation',
    description: 'Deploy CloudFormation templates from S3',
    category: 'deploy-only',
    sourceProvider: 'S3',
    deployTarget: 'CloudFormation',
    stages: [
      { name: 'Source', description: 'Get template from S3', actionType: 'Source' },
      { name: 'Deploy', description: 'Deploy CloudFormation stack', actionType: 'Deploy' },
    ],
    requiredParameters: [
      { name: 'sourceBucket', description: 'S3 bucket with template', type: 'bucket' },
      { name: 'sourceKey', description: 'S3 key for template file', type: 'string' },
      { name: 'stackName', description: 'CloudFormation stack name', type: 'string' },
    ],
    optionalParameters: [
      { name: 'templateConfiguration', description: 'Template config file key', type: 'string' },
    ],
  },
  {
    id: 'multi-env-pipeline',
    name: 'Multi-Environment Pipeline',
    description: 'Build and deploy to dev, staging, and production with approvals',
    category: 'multi-stage',
    sourceProvider: 'CodeStarSourceConnection',
    deployTarget: 'ECS',
    stages: [
      { name: 'Source', description: 'Pull source code', actionType: 'Source' },
      { name: 'Build', description: 'Build and test', actionType: 'Build' },
      { name: 'DeployDev', description: 'Deploy to development', actionType: 'Deploy' },
      { name: 'ApproveStaging', description: 'Manual approval for staging', actionType: 'Approval' },
      { name: 'DeployStaging', description: 'Deploy to staging', actionType: 'Deploy' },
      { name: 'ApproveProduction', description: 'Manual approval for production', actionType: 'Approval' },
      { name: 'DeployProduction', description: 'Deploy to production', actionType: 'Deploy' },
    ],
    requiredParameters: [
      { name: 'connectionArn', description: 'CodeStar connection ARN', type: 'arn' },
      { name: 'repositoryId', description: 'Repository (owner/repo)', type: 'string' },
      { name: 'branchName', description: 'Branch to track', type: 'branch', defaultValue: 'main' },
      { name: 'devCluster', description: 'Dev ECS cluster', type: 'string' },
      { name: 'devService', description: 'Dev ECS service', type: 'string' },
      { name: 'stagingCluster', description: 'Staging ECS cluster', type: 'string' },
      { name: 'stagingService', description: 'Staging ECS service', type: 'string' },
      { name: 'prodCluster', description: 'Production ECS cluster', type: 'string' },
      { name: 'prodService', description: 'Production ECS service', type: 'string' },
    ],
    optionalParameters: [
      { name: 'notificationTopic', description: 'SNS topic for approvals', type: 'arn' },
    ],
  },
];

/**
 * CI/CD Manager interface
 */
export interface CICDManager {
  // Pipeline operations
  listPipelines(options?: ListPipelinesOptions): Promise<CICDOperationResult<{ pipelines: PipelineSummary[]; nextToken?: string }>>;
  getPipeline(pipelineName: string): Promise<CICDOperationResult<PipelineInfo>>;
  createPipeline(options: CreatePipelineOptions): Promise<CICDOperationResult<{ pipelineArn: string; version: number }>>;
  updatePipeline(options: UpdatePipelineOptions): Promise<CICDOperationResult<{ pipelineArn: string; version: number }>>;
  deletePipeline(pipelineName: string): Promise<CICDOperationResult<void>>;
  
  // Pipeline execution
  startPipelineExecution(options: StartPipelineExecutionOptions): Promise<CICDOperationResult<{ pipelineExecutionId: string }>>;
  stopPipelineExecution(options: StopPipelineExecutionOptions): Promise<CICDOperationResult<{ pipelineExecutionId: string }>>;
  retryStageExecution(options: RetryStageExecutionOptions): Promise<CICDOperationResult<{ pipelineExecutionId: string }>>;
  listPipelineExecutions(options: ListPipelineExecutionsOptions): Promise<CICDOperationResult<{ executions: PipelineExecutionSummary[]; nextToken?: string }>>;
  getPipelineExecution(pipelineName: string, pipelineExecutionId: string): Promise<CICDOperationResult<PipelineExecutionDetail>>;
  getPipelineState(pipelineName: string): Promise<CICDOperationResult<{ stages: StageState[]; created?: Date; updated?: Date }>>;
  
  // Action executions
  listActionExecutions(options: ListActionExecutionsOptions): Promise<CICDOperationResult<{ actionExecutions: ActionExecutionDetail[]; nextToken?: string }>>;
  
  // Stage transitions
  enableStageTransition(pipelineName: string, stageName: string, transitionType: 'Inbound' | 'Outbound'): Promise<CICDOperationResult<void>>;
  disableStageTransition(pipelineName: string, stageName: string, transitionType: 'Inbound' | 'Outbound', reason: string): Promise<CICDOperationResult<void>>;
  
  // Build projects
  listBuildProjects(options?: ListBuildProjectsOptions): Promise<CICDOperationResult<{ projects: string[]; nextToken?: string }>>;
  getBuildProject(projectName: string): Promise<CICDOperationResult<BuildProjectInfo>>;
  getBuildProjects(projectNames: string[]): Promise<CICDOperationResult<BuildProjectInfo[]>>;
  createBuildProject(options: CreateBuildProjectOptions): Promise<CICDOperationResult<BuildProjectInfo>>;
  updateBuildProject(options: UpdateBuildProjectOptions): Promise<CICDOperationResult<BuildProjectInfo>>;
  deleteBuildProject(projectName: string): Promise<CICDOperationResult<void>>;
  
  // Builds
  startBuild(options: StartBuildOptions): Promise<CICDOperationResult<BuildInfo>>;
  stopBuild(buildId: string): Promise<CICDOperationResult<BuildInfo>>;
  retryBuild(buildId: string): Promise<CICDOperationResult<BuildInfo>>;
  listBuilds(options?: ListBuildsOptions): Promise<CICDOperationResult<{ buildIds: string[]; nextToken?: string }>>;
  listBuildsForProject(options: ListBuildsForProjectOptions): Promise<CICDOperationResult<{ buildIds: string[]; nextToken?: string }>>;
  getBuild(buildId: string): Promise<CICDOperationResult<BuildInfo>>;
  getBuilds(buildIds: string[]): Promise<CICDOperationResult<BuildInfo[]>>;
  getBuildLogs(buildId: string): Promise<CICDOperationResult<{ logGroupName?: string; logStreamName?: string; deepLink?: string; logs?: string }>>;
  
  // CodeDeploy applications
  listApplications(options?: ListApplicationsOptions): Promise<CICDOperationResult<{ applications: string[]; nextToken?: string }>>;
  getApplication(applicationName: string): Promise<CICDOperationResult<ApplicationInfo>>;
  createApplication(options: CreateApplicationOptions): Promise<CICDOperationResult<{ applicationId: string }>>;
  deleteApplication(applicationName: string): Promise<CICDOperationResult<void>>;
  
  // Deployment groups
  listDeploymentGroups(options: ListDeploymentGroupsOptions): Promise<CICDOperationResult<{ deploymentGroups: string[]; nextToken?: string }>>;
  getDeploymentGroup(applicationName: string, deploymentGroupName: string): Promise<CICDOperationResult<DeploymentGroupInfo>>;
  createDeploymentGroup(options: CreateDeploymentGroupOptions): Promise<CICDOperationResult<{ deploymentGroupId: string }>>;
  updateDeploymentGroup(options: UpdateDeploymentGroupOptions): Promise<CICDOperationResult<void>>;
  deleteDeploymentGroup(applicationName: string, deploymentGroupName: string): Promise<CICDOperationResult<void>>;
  
  // Deployments
  createDeployment(options: CreateDeploymentOptions): Promise<CICDOperationResult<{ deploymentId: string }>>;
  getDeployment(deploymentId: string): Promise<CICDOperationResult<DeploymentInfo>>;
  listDeployments(options?: ListDeploymentsOptions): Promise<CICDOperationResult<{ deployments: string[]; nextToken?: string }>>;
  stopDeployment(deploymentId: string, autoRollbackEnabled?: boolean): Promise<CICDOperationResult<{ status: string; statusMessage?: string }>>;
  continueDeployment(deploymentId: string, deploymentWaitType?: 'READY_WAIT' | 'TERMINATION_WAIT'): Promise<CICDOperationResult<void>>;
  
  // Deployment configs
  listDeploymentConfigs(options?: ListDeploymentConfigsOptions): Promise<CICDOperationResult<{ deploymentConfigs: string[]; nextToken?: string }>>;
  getDeploymentConfig(deploymentConfigName: string): Promise<CICDOperationResult<DeploymentConfigInfo>>;
  createDeploymentConfig(options: CreateDeploymentConfigOptions): Promise<CICDOperationResult<{ deploymentConfigId: string }>>;
  deleteDeploymentConfig(deploymentConfigName: string): Promise<CICDOperationResult<void>>;
  
  // Blue/green deployments
  configureBlueGreenDeployment(options: BlueGreenDeploymentOptions): Promise<CICDOperationResult<void>>;
  
  // Rollback
  rollbackDeployment(deploymentId: string): Promise<CICDOperationResult<{ deploymentId: string }>>;
  
  // Templates
  getPipelineTemplates(): Promise<CICDOperationResult<PipelineTemplate[]>>;
  getPipelineTemplate(templateId: string): Promise<CICDOperationResult<PipelineTemplate>>;
  createPipelineFromTemplate(templateId: string, pipelineName: string, roleArn: string, artifactBucket: string, parameters: Record<string, string>): Promise<CICDOperationResult<{ pipelineArn: string; version: number }>>;
}
