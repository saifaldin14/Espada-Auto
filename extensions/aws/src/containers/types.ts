/**
 * AWS Container Services Types
 *
 * Type definitions for ECS (Elastic Container Service), EKS (Elastic Kubernetes Service),
 * and ECR (Elastic Container Registry) operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Container operation result
 */
export interface ContainerOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Container Manager configuration
 */
export interface ContainerManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

/**
 * Container status types
 */
export type ContainerStatus =
  | 'RUNNING'
  | 'PENDING'
  | 'STOPPED'
  | 'DRAINING'
  | 'PROVISIONING'
  | 'DEPROVISIONING'
  | 'ACTIVE'
  | 'INACTIVE';

/**
 * Launch type for ECS tasks
 */
export type LaunchType = 'EC2' | 'FARGATE' | 'EXTERNAL';

/**
 * Scheduling strategy for ECS services
 */
export type SchedulingStrategy = 'REPLICA' | 'DAEMON';

/**
 * Deployment controller type
 */
export type DeploymentControllerType = 'ECS' | 'CODE_DEPLOY' | 'EXTERNAL';

// =============================================================================
// ECS Cluster Types
// =============================================================================

/**
 * ECS cluster information
 */
export interface ECSClusterInfo {
  clusterName: string;
  clusterArn: string;
  status: string;
  registeredContainerInstancesCount: number;
  runningTasksCount: number;
  pendingTasksCount: number;
  activeServicesCount: number;
  capacityProviders: string[];
  defaultCapacityProviderStrategy: CapacityProviderStrategyItem[];
  settings: ClusterSetting[];
  tags: Record<string, string>;
  configuration?: ClusterConfiguration;
  statistics: ClusterStatistic[];
}

/**
 * Capacity provider strategy item
 */
export interface CapacityProviderStrategyItem {
  capacityProvider: string;
  weight: number;
  base: number;
}

/**
 * Cluster setting
 */
export interface ClusterSetting {
  name: string;
  value: string;
}

/**
 * Cluster configuration
 */
export interface ClusterConfiguration {
  executeCommandConfiguration?: {
    kmsKeyId?: string;
    logging?: 'NONE' | 'DEFAULT' | 'OVERRIDE';
    logConfiguration?: {
      cloudWatchLogGroupName?: string;
      cloudWatchEncryptionEnabled?: boolean;
      s3BucketName?: string;
      s3EncryptionEnabled?: boolean;
      s3KeyPrefix?: string;
    };
  };
}

/**
 * Cluster statistic
 */
export interface ClusterStatistic {
  name: string;
  value: string;
}

/**
 * Options for listing ECS clusters
 */
export interface ListECSClustersOptions {
  maxResults?: number;
  includeDetails?: boolean;
}

/**
 * Options for creating an ECS cluster
 */
export interface CreateECSClusterOptions {
  clusterName: string;
  capacityProviders?: string[];
  defaultCapacityProviderStrategy?: CapacityProviderStrategyItem[];
  settings?: ClusterSetting[];
  configuration?: ClusterConfiguration;
  tags?: Record<string, string>;
  serviceConnectDefaults?: {
    namespace: string;
  };
}

// =============================================================================
// ECS Service Types
// =============================================================================

/**
 * ECS service information
 */
export interface ECSServiceInfo {
  serviceName: string;
  serviceArn: string;
  clusterArn: string;
  status: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  launchType?: LaunchType;
  capacityProviderStrategy?: CapacityProviderStrategyItem[];
  platformVersion?: string;
  platformFamily?: string;
  taskDefinition: string;
  deploymentConfiguration?: DeploymentConfiguration;
  deployments: Deployment[];
  roleArn?: string;
  events: ServiceEvent[];
  createdAt?: Date;
  createdBy?: string;
  enableECSManagedTags: boolean;
  propagateTags?: 'TASK_DEFINITION' | 'SERVICE' | 'NONE';
  enableExecuteCommand: boolean;
  healthCheckGracePeriodSeconds?: number;
  schedulingStrategy: SchedulingStrategy;
  deploymentController: {
    type: DeploymentControllerType;
  };
  networkConfiguration?: NetworkConfiguration;
  loadBalancers: LoadBalancerConfig[];
  serviceRegistries: ServiceRegistry[];
  tags: Record<string, string>;
}

/**
 * Deployment configuration
 */
export interface DeploymentConfiguration {
  deploymentCircuitBreaker?: {
    enable: boolean;
    rollback: boolean;
  };
  maximumPercent?: number;
  minimumHealthyPercent?: number;
  alarms?: {
    alarmNames: string[];
    enable: boolean;
    rollback: boolean;
  };
}

/**
 * Deployment information
 */
export interface Deployment {
  id: string;
  status: string;
  taskDefinition: string;
  desiredCount: number;
  pendingCount: number;
  runningCount: number;
  failedTasks: number;
  createdAt?: Date;
  updatedAt?: Date;
  capacityProviderStrategy?: CapacityProviderStrategyItem[];
  launchType?: LaunchType;
  platformVersion?: string;
  platformFamily?: string;
  networkConfiguration?: NetworkConfiguration;
  rolloutState?: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS';
  rolloutStateReason?: string;
}

/**
 * Service event
 */
export interface ServiceEvent {
  id?: string;
  createdAt?: Date;
  message?: string;
}

/**
 * Network configuration for tasks
 */
export interface NetworkConfiguration {
  awsvpcConfiguration?: {
    subnets: string[];
    securityGroups?: string[];
    assignPublicIp?: 'ENABLED' | 'DISABLED';
  };
}

/**
 * Load balancer configuration
 */
export interface LoadBalancerConfig {
  targetGroupArn?: string;
  loadBalancerName?: string;
  containerName: string;
  containerPort: number;
}

/**
 * Service registry for service discovery
 */
export interface ServiceRegistry {
  registryArn?: string;
  port?: number;
  containerName?: string;
  containerPort?: number;
}

/**
 * Options for listing ECS services
 */
export interface ListECSServicesOptions {
  cluster: string;
  maxResults?: number;
  launchType?: LaunchType;
  schedulingStrategy?: SchedulingStrategy;
  includeDetails?: boolean;
}

/**
 * Options for creating an ECS service
 */
export interface CreateECSServiceOptions {
  cluster: string;
  serviceName: string;
  taskDefinition: string;
  desiredCount: number;
  launchType?: LaunchType;
  capacityProviderStrategy?: CapacityProviderStrategyItem[];
  platformVersion?: string;
  deploymentConfiguration?: DeploymentConfiguration;
  networkConfiguration?: NetworkConfiguration;
  loadBalancers?: LoadBalancerConfig[];
  serviceRegistries?: ServiceRegistry[];
  healthCheckGracePeriodSeconds?: number;
  schedulingStrategy?: SchedulingStrategy;
  deploymentController?: {
    type: DeploymentControllerType;
  };
  enableECSManagedTags?: boolean;
  propagateTags?: 'TASK_DEFINITION' | 'SERVICE' | 'NONE';
  enableExecuteCommand?: boolean;
  tags?: Record<string, string>;
}

/**
 * Options for updating an ECS service
 */
export interface UpdateECSServiceOptions {
  cluster: string;
  service: string;
  desiredCount?: number;
  taskDefinition?: string;
  capacityProviderStrategy?: CapacityProviderStrategyItem[];
  deploymentConfiguration?: DeploymentConfiguration;
  networkConfiguration?: NetworkConfiguration;
  platformVersion?: string;
  forceNewDeployment?: boolean;
  healthCheckGracePeriodSeconds?: number;
  enableExecuteCommand?: boolean;
  enableECSManagedTags?: boolean;
  propagateTags?: 'TASK_DEFINITION' | 'SERVICE' | 'NONE';
  loadBalancers?: LoadBalancerConfig[];
  serviceRegistries?: ServiceRegistry[];
}

/**
 * Options for scaling an ECS service
 */
export interface ScaleECSServiceOptions {
  cluster: string;
  service: string;
  desiredCount: number;
}

// =============================================================================
// ECS Task Types
// =============================================================================

/**
 * ECS task information
 */
export interface ECSTaskInfo {
  taskArn: string;
  taskDefinitionArn: string;
  clusterArn: string;
  containerInstanceArn?: string;
  lastStatus: string;
  desiredStatus: string;
  cpu?: string;
  memory?: string;
  launchType?: LaunchType;
  capacityProviderName?: string;
  platformVersion?: string;
  platformFamily?: string;
  connectivity?: 'CONNECTED' | 'DISCONNECTED';
  connectivityAt?: Date;
  pullStartedAt?: Date;
  pullStoppedAt?: Date;
  executionStoppedAt?: Date;
  createdAt?: Date;
  startedAt?: Date;
  startedBy?: string;
  stoppingAt?: Date;
  stoppedAt?: Date;
  stoppedReason?: string;
  stopCode?: string;
  group?: string;
  version: number;
  containers: ContainerInfo[];
  attachments: TaskAttachment[];
  healthStatus?: 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';
  availabilityZone?: string;
  enableExecuteCommand: boolean;
  tags: Record<string, string>;
  ephemeralStorage?: {
    sizeInGiB: number;
  };
}

/**
 * Container information within a task
 */
export interface ContainerInfo {
  containerArn?: string;
  taskArn?: string;
  name: string;
  image?: string;
  imageDigest?: string;
  runtimeId?: string;
  lastStatus?: string;
  exitCode?: number;
  reason?: string;
  healthStatus?: 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';
  cpu?: string;
  memory?: string;
  memoryReservation?: string;
  gpuIds?: string[];
  networkBindings?: NetworkBinding[];
  networkInterfaces?: NetworkInterface[];
  managedAgents?: ManagedAgent[];
}

/**
 * Network binding
 */
export interface NetworkBinding {
  bindIP?: string;
  containerPort?: number;
  hostPort?: number;
  protocol?: 'tcp' | 'udp';
  containerPortRange?: string;
  hostPortRange?: string;
}

/**
 * Network interface
 */
export interface NetworkInterface {
  attachmentId?: string;
  privateIpv4Address?: string;
  ipv6Address?: string;
}

/**
 * Managed agent
 */
export interface ManagedAgent {
  lastStartedAt?: Date;
  name?: string;
  reason?: string;
  lastStatus?: string;
}

/**
 * Task attachment
 */
export interface TaskAttachment {
  id?: string;
  type?: string;
  status?: string;
  details?: { name?: string; value?: string }[];
}

/**
 * Options for listing ECS tasks
 */
export interface ListECSTasksOptions {
  cluster: string;
  serviceName?: string;
  containerInstance?: string;
  family?: string;
  startedBy?: string;
  desiredStatus?: 'RUNNING' | 'PENDING' | 'STOPPED';
  launchType?: LaunchType;
  maxResults?: number;
  includeDetails?: boolean;
}

/**
 * Options for running a new ECS task
 */
export interface RunECSTaskOptions {
  cluster: string;
  taskDefinition: string;
  count?: number;
  launchType?: LaunchType;
  capacityProviderStrategy?: CapacityProviderStrategyItem[];
  platformVersion?: string;
  networkConfiguration?: NetworkConfiguration;
  overrides?: TaskOverride;
  group?: string;
  startedBy?: string;
  enableECSManagedTags?: boolean;
  propagateTags?: 'TASK_DEFINITION' | 'NONE';
  referenceId?: string;
  enableExecuteCommand?: boolean;
  tags?: Record<string, string>;
}

/**
 * Task override for customizing task execution
 */
export interface TaskOverride {
  containerOverrides?: ContainerOverride[];
  cpu?: string;
  memory?: string;
  taskRoleArn?: string;
  executionRoleArn?: string;
  inferenceAcceleratorOverrides?: {
    deviceName?: string;
    deviceType?: string;
  }[];
  ephemeralStorage?: {
    sizeInGiB: number;
  };
}

/**
 * Container override
 */
export interface ContainerOverride {
  name: string;
  command?: string[];
  environment?: { name: string; value: string }[];
  environmentFiles?: { value: string; type: 's3' }[];
  cpu?: number;
  memory?: number;
  memoryReservation?: number;
  resourceRequirements?: { value: string; type: 'GPU' | 'InferenceAccelerator' }[];
}

// =============================================================================
// ECS Task Definition Types
// =============================================================================

/**
 * Task definition information
 */
export interface TaskDefinitionInfo {
  taskDefinitionArn: string;
  family: string;
  revision: number;
  status: 'ACTIVE' | 'INACTIVE' | 'DELETE_IN_PROGRESS';
  containerDefinitions: ContainerDefinition[];
  taskRoleArn?: string;
  executionRoleArn?: string;
  networkMode?: 'bridge' | 'host' | 'awsvpc' | 'none';
  volumes?: Volume[];
  placementConstraints?: PlacementConstraint[];
  requiresCompatibilities?: ('EC2' | 'FARGATE' | 'EXTERNAL')[];
  cpu?: string;
  memory?: string;
  inferenceAccelerators?: InferenceAccelerator[];
  pidMode?: 'host' | 'task';
  ipcMode?: 'host' | 'task' | 'none';
  proxyConfiguration?: ProxyConfiguration;
  registeredAt?: Date;
  deregisteredAt?: Date;
  registeredBy?: string;
  ephemeralStorage?: {
    sizeInGiB: number;
  };
  runtimePlatform?: {
    cpuArchitecture?: 'X86_64' | 'ARM64';
    operatingSystemFamily?: string;
  };
  tags: Record<string, string>;
}

/**
 * Container definition in a task definition
 */
export interface ContainerDefinition {
  name: string;
  image: string;
  repositoryCredentials?: {
    credentialsParameter: string;
  };
  cpu?: number;
  memory?: number;
  memoryReservation?: number;
  links?: string[];
  portMappings?: PortMapping[];
  essential?: boolean;
  entryPoint?: string[];
  command?: string[];
  environment?: { name: string; value: string }[];
  environmentFiles?: { value: string; type: 's3' }[];
  mountPoints?: MountPoint[];
  volumesFrom?: VolumeFrom[];
  linuxParameters?: LinuxParameters;
  secrets?: Secret[];
  dependsOn?: ContainerDependency[];
  startTimeout?: number;
  stopTimeout?: number;
  hostname?: string;
  user?: string;
  workingDirectory?: string;
  disableNetworking?: boolean;
  privileged?: boolean;
  readonlyRootFilesystem?: boolean;
  dnsServers?: string[];
  dnsSearchDomains?: string[];
  extraHosts?: { hostname: string; ipAddress: string }[];
  dockerSecurityOptions?: string[];
  interactive?: boolean;
  pseudoTerminal?: boolean;
  dockerLabels?: Record<string, string>;
  ulimits?: Ulimit[];
  logConfiguration?: LogConfiguration;
  healthCheck?: HealthCheck;
  systemControls?: { namespace: string; value: string }[];
  resourceRequirements?: { value: string; type: 'GPU' | 'InferenceAccelerator' }[];
  firelensConfiguration?: FirelensConfiguration;
}

/**
 * Port mapping
 */
export interface PortMapping {
  containerPort: number;
  hostPort?: number;
  protocol?: 'tcp' | 'udp';
  name?: string;
  appProtocol?: 'http' | 'http2' | 'grpc';
  containerPortRange?: string;
}

/**
 * Mount point
 */
export interface MountPoint {
  sourceVolume: string;
  containerPath: string;
  readOnly?: boolean;
}

/**
 * Volume from
 */
export interface VolumeFrom {
  sourceContainer: string;
  readOnly?: boolean;
}

/**
 * Linux parameters
 */
export interface LinuxParameters {
  capabilities?: {
    add?: string[];
    drop?: string[];
  };
  devices?: {
    hostPath: string;
    containerPath?: string;
    permissions?: ('read' | 'write' | 'mknod')[];
  }[];
  initProcessEnabled?: boolean;
  sharedMemorySize?: number;
  tmpfs?: {
    containerPath: string;
    size: number;
    mountOptions?: string[];
  }[];
  maxSwap?: number;
  swappiness?: number;
}

/**
 * Secret
 */
export interface Secret {
  name: string;
  valueFrom: string;
}

/**
 * Container dependency
 */
export interface ContainerDependency {
  containerName: string;
  condition: 'START' | 'COMPLETE' | 'SUCCESS' | 'HEALTHY';
}

/**
 * Ulimit
 */
export interface Ulimit {
  name: string;
  softLimit: number;
  hardLimit: number;
}

/**
 * Log configuration
 */
export interface LogConfiguration {
  logDriver: 'json-file' | 'syslog' | 'journald' | 'gelf' | 'fluentd' | 'awslogs' | 'splunk' | 'awsfirelens';
  options?: Record<string, string>;
  secretOptions?: Secret[];
}

/**
 * Health check
 */
export interface HealthCheck {
  command: string[];
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
}

/**
 * Firelens configuration
 */
export interface FirelensConfiguration {
  type: 'fluentd' | 'fluentbit';
  options?: Record<string, string>;
}

/**
 * Volume
 */
export interface Volume {
  name: string;
  host?: {
    sourcePath?: string;
  };
  dockerVolumeConfiguration?: {
    scope?: 'task' | 'shared';
    autoprovision?: boolean;
    driver?: string;
    driverOpts?: Record<string, string>;
    labels?: Record<string, string>;
  };
  efsVolumeConfiguration?: {
    fileSystemId: string;
    rootDirectory?: string;
    transitEncryption?: 'ENABLED' | 'DISABLED';
    transitEncryptionPort?: number;
    authorizationConfig?: {
      accessPointId?: string;
      iam?: 'ENABLED' | 'DISABLED';
    };
  };
  fsxWindowsFileServerVolumeConfiguration?: {
    fileSystemId: string;
    rootDirectory: string;
    authorizationConfig: {
      credentialsParameter: string;
      domain: string;
    };
  };
}

/**
 * Placement constraint
 */
export interface PlacementConstraint {
  type: 'distinctInstance' | 'memberOf';
  expression?: string;
}

/**
 * Inference accelerator
 */
export interface InferenceAccelerator {
  deviceName: string;
  deviceType: string;
}

/**
 * Proxy configuration
 */
export interface ProxyConfiguration {
  type?: 'APPMESH';
  containerName: string;
  properties?: { name: string; value: string }[];
}

/**
 * Options for listing task definitions
 */
export interface ListTaskDefinitionsOptions {
  familyPrefix?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  sort?: 'ASC' | 'DESC';
  maxResults?: number;
}

/**
 * Options for registering a task definition
 */
export interface RegisterTaskDefinitionOptions {
  family: string;
  containerDefinitions: ContainerDefinition[];
  taskRoleArn?: string;
  executionRoleArn?: string;
  networkMode?: 'bridge' | 'host' | 'awsvpc' | 'none';
  volumes?: Volume[];
  placementConstraints?: PlacementConstraint[];
  requiresCompatibilities?: ('EC2' | 'FARGATE' | 'EXTERNAL')[];
  cpu?: string;
  memory?: string;
  inferenceAccelerators?: InferenceAccelerator[];
  pidMode?: 'host' | 'task';
  ipcMode?: 'host' | 'task' | 'none';
  proxyConfiguration?: ProxyConfiguration;
  ephemeralStorage?: {
    sizeInGiB: number;
  };
  runtimePlatform?: {
    cpuArchitecture?: 'X86_64' | 'ARM64';
    operatingSystemFamily?: string;
  };
  tags?: Record<string, string>;
}

// =============================================================================
// ECS Container Instance Types
// =============================================================================

/**
 * Container instance information
 */
export interface ContainerInstanceInfo {
  containerInstanceArn: string;
  ec2InstanceId?: string;
  capacityProviderName?: string;
  version: number;
  status: string;
  statusReason?: string;
  agentConnected: boolean;
  runningTasksCount: number;
  pendingTasksCount: number;
  agentUpdateStatus?: string;
  registeredResources: Resource[];
  remainingResources: Resource[];
  registeredAt?: Date;
  attachments: TaskAttachment[];
  tags: Record<string, string>;
  healthStatus?: {
    overallStatus?: string;
    details?: { type?: string; status?: string; lastUpdated?: Date; lastStatusChange?: Date }[];
  };
}

/**
 * Resource
 */
export interface Resource {
  name?: string;
  type?: string;
  doubleValue?: number;
  longValue?: number;
  integerValue?: number;
  stringSetValue?: string[];
}

/**
 * Options for listing container instances
 */
export interface ListContainerInstancesOptions {
  cluster: string;
  filter?: string;
  status?: 'ACTIVE' | 'DRAINING' | 'REGISTERING' | 'DEREGISTERING' | 'REGISTRATION_FAILED';
  maxResults?: number;
  includeDetails?: boolean;
}

// =============================================================================
// EKS Cluster Types
// =============================================================================

/**
 * EKS cluster information
 */
export interface EKSClusterInfo {
  name: string;
  arn: string;
  createdAt?: Date;
  version: string;
  endpoint?: string;
  roleArn: string;
  resourcesVpcConfig: EKSVpcConfig;
  kubernetesNetworkConfig?: KubernetesNetworkConfig;
  logging?: EKSLogging;
  identity?: EKSIdentity;
  status: EKSClusterStatus;
  certificateAuthority?: {
    data?: string;
  };
  clientRequestToken?: string;
  platformVersion?: string;
  tags: Record<string, string>;
  encryptionConfig?: EncryptionConfig[];
  connectorConfig?: ConnectorConfig;
  health?: {
    issues?: { code?: string; message?: string; resourceIds?: string[] }[];
  };
  outpostConfig?: OutpostConfig;
  accessConfig?: AccessConfig;
}

/**
 * EKS cluster status
 */
export type EKSClusterStatus =
  | 'CREATING'
  | 'ACTIVE'
  | 'DELETING'
  | 'FAILED'
  | 'UPDATING'
  | 'PENDING';

/**
 * EKS VPC configuration
 */
export interface EKSVpcConfig {
  subnetIds: string[];
  securityGroupIds?: string[];
  clusterSecurityGroupId?: string;
  vpcId?: string;
  endpointPublicAccess?: boolean;
  endpointPrivateAccess?: boolean;
  publicAccessCidrs?: string[];
}

/**
 * Kubernetes network configuration
 */
export interface KubernetesNetworkConfig {
  serviceIpv4Cidr?: string;
  serviceIpv6Cidr?: string;
  ipFamily?: 'ipv4' | 'ipv6';
}

/**
 * EKS logging configuration
 */
export interface EKSLogging {
  clusterLogging?: {
    types?: ('api' | 'audit' | 'authenticator' | 'controllerManager' | 'scheduler')[];
    enabled?: boolean;
  }[];
}

/**
 * EKS identity configuration
 */
export interface EKSIdentity {
  oidc?: {
    issuer?: string;
  };
}

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  resources?: string[];
  provider?: {
    keyArn?: string;
  };
}

/**
 * Connector configuration
 */
export interface ConnectorConfig {
  activationId?: string;
  activationCode?: string;
  activationExpiry?: Date;
  provider?: string;
  roleArn?: string;
}

/**
 * Outpost configuration
 */
export interface OutpostConfig {
  outpostArns: string[];
  controlPlaneInstanceType?: string;
  controlPlanePlacement?: {
    groupName?: string;
  };
}

/**
 * Access configuration
 */
export interface AccessConfig {
  bootstrapClusterCreatorAdminPermissions?: boolean;
  authenticationMode?: 'CONFIG_MAP' | 'API' | 'API_AND_CONFIG_MAP';
}

/**
 * Options for listing EKS clusters
 */
export interface ListEKSClustersOptions {
  maxResults?: number;
  include?: ('all' | string)[];
  includeDetails?: boolean;
}

/**
 * Options for creating an EKS cluster
 */
export interface CreateEKSClusterOptions {
  name: string;
  roleArn: string;
  resourcesVpcConfig: {
    subnetIds: string[];
    securityGroupIds?: string[];
    endpointPublicAccess?: boolean;
    endpointPrivateAccess?: boolean;
    publicAccessCidrs?: string[];
  };
  version?: string;
  kubernetesNetworkConfig?: KubernetesNetworkConfig;
  logging?: EKSLogging;
  encryptionConfig?: EncryptionConfig[];
  outpostConfig?: OutpostConfig;
  accessConfig?: AccessConfig;
  tags?: Record<string, string>;
}

/**
 * Options for updating an EKS cluster
 */
export interface UpdateEKSClusterOptions {
  name: string;
  resourcesVpcConfig?: {
    endpointPublicAccess?: boolean;
    endpointPrivateAccess?: boolean;
    publicAccessCidrs?: string[];
  };
  logging?: EKSLogging;
  accessConfig?: AccessConfig;
}

// =============================================================================
// EKS Node Group Types
// =============================================================================

/**
 * EKS node group information
 */
export interface EKSNodeGroupInfo {
  nodegroupName: string;
  nodegroupArn: string;
  clusterName: string;
  version?: string;
  releaseVersion?: string;
  createdAt?: Date;
  modifiedAt?: Date;
  status: EKSNodeGroupStatus;
  capacityType?: 'ON_DEMAND' | 'SPOT';
  scalingConfig?: {
    minSize?: number;
    maxSize?: number;
    desiredSize?: number;
  };
  instanceTypes?: string[];
  subnets: string[];
  remoteAccess?: {
    ec2SshKey?: string;
    sourceSecurityGroups?: string[];
  };
  amiType?: string;
  nodeRole: string;
  labels?: Record<string, string>;
  taints?: NodeGroupTaint[];
  resources?: {
    autoScalingGroups?: { name?: string }[];
    remoteAccessSecurityGroup?: string;
  };
  diskSize?: number;
  health?: {
    issues?: { code?: string; message?: string; resourceIds?: string[] }[];
  };
  updateConfig?: {
    maxUnavailable?: number;
    maxUnavailablePercentage?: number;
  };
  launchTemplate?: {
    name?: string;
    version?: string;
    id?: string;
  };
  tags: Record<string, string>;
}

/**
 * EKS node group status
 */
export type EKSNodeGroupStatus =
  | 'CREATING'
  | 'ACTIVE'
  | 'UPDATING'
  | 'DELETING'
  | 'CREATE_FAILED'
  | 'DELETE_FAILED'
  | 'DEGRADED';

/**
 * Node group taint
 */
export interface NodeGroupTaint {
  key?: string;
  value?: string;
  effect?: 'NO_SCHEDULE' | 'NO_EXECUTE' | 'PREFER_NO_SCHEDULE';
}

/**
 * Options for listing EKS node groups
 */
export interface ListEKSNodeGroupsOptions {
  clusterName: string;
  maxResults?: number;
  includeDetails?: boolean;
}

/**
 * Options for creating an EKS node group
 */
export interface CreateEKSNodeGroupOptions {
  clusterName: string;
  nodegroupName: string;
  nodeRole: string;
  subnets: string[];
  scalingConfig?: {
    minSize?: number;
    maxSize?: number;
    desiredSize?: number;
  };
  diskSize?: number;
  instanceTypes?: string[];
  amiType?: string;
  remoteAccess?: {
    ec2SshKey?: string;
    sourceSecurityGroups?: string[];
  };
  labels?: Record<string, string>;
  taints?: NodeGroupTaint[];
  capacityType?: 'ON_DEMAND' | 'SPOT';
  updateConfig?: {
    maxUnavailable?: number;
    maxUnavailablePercentage?: number;
  };
  launchTemplate?: {
    name?: string;
    version?: string;
    id?: string;
  };
  version?: string;
  releaseVersion?: string;
  tags?: Record<string, string>;
}

/**
 * Options for updating an EKS node group
 */
export interface UpdateEKSNodeGroupOptions {
  clusterName: string;
  nodegroupName: string;
  scalingConfig?: {
    minSize?: number;
    maxSize?: number;
    desiredSize?: number;
  };
  updateConfig?: {
    maxUnavailable?: number;
    maxUnavailablePercentage?: number;
  };
  labels?: {
    addOrUpdateLabels?: Record<string, string>;
    removeLabels?: string[];
  };
  taints?: {
    addOrUpdateTaints?: NodeGroupTaint[];
    removeTaints?: NodeGroupTaint[];
  };
}

// =============================================================================
// EKS Fargate Profile Types
// =============================================================================

/**
 * EKS Fargate profile information
 */
export interface EKSFargateProfileInfo {
  fargateProfileName: string;
  fargateProfileArn: string;
  clusterName: string;
  createdAt?: Date;
  podExecutionRoleArn: string;
  subnets: string[];
  selectors: FargateProfileSelector[];
  status: EKSFargateProfileStatus;
  tags: Record<string, string>;
}

/**
 * EKS Fargate profile status
 */
export type EKSFargateProfileStatus =
  | 'CREATING'
  | 'ACTIVE'
  | 'DELETING'
  | 'CREATE_FAILED'
  | 'DELETE_FAILED';

/**
 * Fargate profile selector
 */
export interface FargateProfileSelector {
  namespace?: string;
  labels?: Record<string, string>;
}

/**
 * Options for listing EKS Fargate profiles
 */
export interface ListEKSFargateProfilesOptions {
  clusterName: string;
  maxResults?: number;
  includeDetails?: boolean;
}

/**
 * Options for creating an EKS Fargate profile
 */
export interface CreateEKSFargateProfileOptions {
  clusterName: string;
  fargateProfileName: string;
  podExecutionRoleArn: string;
  subnets?: string[];
  selectors: FargateProfileSelector[];
  tags?: Record<string, string>;
}

// =============================================================================
// ECR Repository Types
// =============================================================================

/**
 * ECR repository information
 */
export interface ECRRepositoryInfo {
  repositoryArn: string;
  registryId: string;
  repositoryName: string;
  repositoryUri: string;
  createdAt?: Date;
  imageTagMutability: 'MUTABLE' | 'IMMUTABLE';
  imageScanningConfiguration?: {
    scanOnPush: boolean;
  };
  encryptionConfiguration?: {
    encryptionType: 'AES256' | 'KMS';
    kmsKey?: string;
  };
  tags: Record<string, string>;
}

/**
 * ECR image information
 */
export interface ECRImageInfo {
  registryId?: string;
  repositoryName: string;
  imageDigest?: string;
  imageTags?: string[];
  imageSizeInBytes?: number;
  imagePushedAt?: Date;
  imageScanStatus?: {
    status?: 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' | 'UNSUPPORTED_IMAGE' | 'ACTIVE' | 'PENDING' | 'SCAN_ELIGIBILITY_EXPIRED' | 'FINDINGS_UNAVAILABLE';
    description?: string;
  };
  imageScanFindingsSummary?: {
    imageScanCompletedAt?: Date;
    vulnerabilitySourceUpdatedAt?: Date;
    findingSeverityCounts?: Record<string, number>;
  };
  imageManifestMediaType?: string;
  artifactMediaType?: string;
  lastRecordedPullTime?: Date;
}

/**
 * ECR image scan findings
 */
export interface ECRImageScanFindings {
  imageScanCompletedAt?: Date;
  vulnerabilitySourceUpdatedAt?: Date;
  findingSeverityCounts?: Record<string, number>;
  findings?: ECRImageScanFinding[];
  enhancedFindings?: ECREnhancedFinding[];
}

/**
 * ECR image scan finding
 */
export interface ECRImageScanFinding {
  name?: string;
  description?: string;
  uri?: string;
  severity?: 'INFORMATIONAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNDEFINED';
  attributes?: { key?: string; value?: string }[];
}

/**
 * ECR enhanced finding
 */
export interface ECREnhancedFinding {
  awsAccountId?: string;
  description?: string;
  findingArn?: string;
  firstObservedAt?: Date;
  lastObservedAt?: Date;
  packageVulnerabilityDetails?: {
    cvss?: { baseScore?: number; scoringVector?: string; source?: string; version?: string }[];
    referenceUrls?: string[];
    relatedVulnerabilities?: string[];
    source?: string;
    sourceUrl?: string;
    vendorCreatedAt?: Date;
    vendorSeverity?: string;
    vendorUpdatedAt?: Date;
    vulnerabilityId?: string;
    vulnerablePackages?: {
      arch?: string;
      epoch?: number;
      filePath?: string;
      fixedInVersion?: string;
      name?: string;
      packageManager?: string;
      release?: string;
      remediation?: string;
      sourceLayerHash?: string;
      version?: string;
    }[];
  };
  remediation?: {
    recommendation?: {
      text?: string;
      url?: string;
    };
  };
  resources?: {
    details?: {
      awsEcrContainerImage?: {
        architecture?: string;
        author?: string;
        imageHash?: string;
        imageTags?: string[];
        platform?: string;
        pushedAt?: Date;
        registry?: string;
        repositoryName?: string;
      };
    };
    id?: string;
    tags?: Record<string, string>;
    type?: string;
  }[];
  score?: number;
  scoreDetails?: {
    cvss?: {
      adjustments?: { metric?: string; reason?: string }[];
      score?: number;
      scoreSource?: string;
      scoringVector?: string;
      version?: string;
    };
  };
  severity?: string;
  status?: string;
  title?: string;
  type?: string;
  updatedAt?: Date;
}

/**
 * Options for listing ECR repositories
 */
export interface ListECRRepositoriesOptions {
  repositoryNames?: string[];
  registryId?: string;
  maxResults?: number;
}

/**
 * Options for creating an ECR repository
 */
export interface CreateECRRepositoryOptions {
  repositoryName: string;
  imageTagMutability?: 'MUTABLE' | 'IMMUTABLE';
  imageScanningConfiguration?: {
    scanOnPush: boolean;
  };
  encryptionConfiguration?: {
    encryptionType: 'AES256' | 'KMS';
    kmsKey?: string;
  };
  tags?: Record<string, string>;
}

/**
 * Options for listing ECR images
 */
export interface ListECRImagesOptions {
  repositoryName: string;
  registryId?: string;
  imageIds?: { imageDigest?: string; imageTag?: string }[];
  filter?: {
    tagStatus?: 'TAGGED' | 'UNTAGGED' | 'ANY';
  };
  maxResults?: number;
}

/**
 * Options for getting ECR image scan findings
 */
export interface GetECRImageScanFindingsOptions {
  repositoryName: string;
  imageId: { imageDigest?: string; imageTag?: string };
  registryId?: string;
  maxResults?: number;
}

// =============================================================================
// ECR Lifecycle Policy Types
// =============================================================================

/**
 * ECR lifecycle policy
 */
export interface ECRLifecyclePolicy {
  registryId?: string;
  repositoryName: string;
  lifecyclePolicyText: string;
  lastEvaluatedAt?: Date;
}

/**
 * Lifecycle policy rule
 */
export interface LifecyclePolicyRule {
  rulePriority: number;
  description?: string;
  selection: {
    tagStatus: 'tagged' | 'untagged' | 'any';
    tagPrefixList?: string[];
    tagPatternList?: string[];
    countType: 'imageCountMoreThan' | 'sinceImagePushed';
    countUnit?: 'days';
    countNumber: number;
  };
  action: {
    type: 'expire';
  };
}

/**
 * Options for setting ECR lifecycle policy
 */
export interface SetECRLifecyclePolicyOptions {
  repositoryName: string;
  lifecyclePolicyText: string;
  registryId?: string;
}

// =============================================================================
// Container Logs Types
// =============================================================================

/**
 * Container log options
 */
export interface GetContainerLogsOptions {
  cluster: string;
  taskId: string;
  containerName: string;
  logGroupName?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  filterPattern?: string;
}

/**
 * Container log entry
 */
export interface ContainerLogEntry {
  timestamp?: Date;
  message: string;
  ingestionTime?: Date;
  logStreamName?: string;
}

// =============================================================================
// Service Auto Scaling Types
// =============================================================================

/**
 * Scalable target
 */
export interface ScalableTargetInfo {
  resourceId: string;
  serviceNamespace: string;
  scalableDimension: string;
  minCapacity: number;
  maxCapacity: number;
  roleArn?: string;
  creationTime?: Date;
  suspendedState?: {
    dynamicScalingInSuspended?: boolean;
    dynamicScalingOutSuspended?: boolean;
    scheduledScalingSuspended?: boolean;
  };
}

/**
 * Scaling policy
 */
export interface ScalingPolicyInfo {
  policyArn: string;
  policyName: string;
  serviceNamespace: string;
  resourceId: string;
  scalableDimension: string;
  policyType: 'StepScaling' | 'TargetTrackingScaling';
  stepScalingPolicyConfiguration?: {
    adjustmentType?: 'ChangeInCapacity' | 'PercentChangeInCapacity' | 'ExactCapacity';
    stepAdjustments?: {
      metricIntervalLowerBound?: number;
      metricIntervalUpperBound?: number;
      scalingAdjustment: number;
    }[];
    minAdjustmentMagnitude?: number;
    cooldown?: number;
    metricAggregationType?: 'Average' | 'Minimum' | 'Maximum';
  };
  targetTrackingScalingPolicyConfiguration?: {
    targetValue: number;
    predefinedMetricSpecification?: {
      predefinedMetricType: string;
      resourceLabel?: string;
    };
    customizedMetricSpecification?: {
      metricName?: string;
      namespace?: string;
      dimensions?: { name: string; value: string }[];
      statistic?: 'Average' | 'Minimum' | 'Maximum' | 'SampleCount' | 'Sum';
      unit?: string;
      metrics?: {
        id: string;
        expression?: string;
        metricStat?: {
          metric: {
            metricName: string;
            namespace: string;
            dimensions?: { name: string; value: string }[];
          };
          stat: string;
          unit?: string;
        };
        label?: string;
        returnData?: boolean;
      }[];
    };
    scaleOutCooldown?: number;
    scaleInCooldown?: number;
    disableScaleIn?: boolean;
  };
  alarms?: {
    alarmName: string;
    alarmArn: string;
  }[];
  creationTime?: Date;
}

/**
 * Options for registering a scalable target
 */
export interface RegisterScalableTargetOptions {
  serviceNamespace: 'ecs';
  resourceId: string; // e.g., service/cluster-name/service-name
  scalableDimension: 'ecs:service:DesiredCount';
  minCapacity?: number;
  maxCapacity?: number;
  roleArn?: string;
  suspendedState?: {
    dynamicScalingInSuspended?: boolean;
    dynamicScalingOutSuspended?: boolean;
    scheduledScalingSuspended?: boolean;
  };
}

/**
 * Options for creating a scaling policy
 */
export interface PutScalingPolicyOptions {
  policyName: string;
  serviceNamespace: 'ecs';
  resourceId: string;
  scalableDimension: 'ecs:service:DesiredCount';
  policyType: 'StepScaling' | 'TargetTrackingScaling';
  stepScalingPolicyConfiguration?: {
    adjustmentType?: 'ChangeInCapacity' | 'PercentChangeInCapacity' | 'ExactCapacity';
    stepAdjustments?: {
      metricIntervalLowerBound?: number;
      metricIntervalUpperBound?: number;
      scalingAdjustment: number;
    }[];
    minAdjustmentMagnitude?: number;
    cooldown?: number;
    metricAggregationType?: 'Average' | 'Minimum' | 'Maximum';
  };
  targetTrackingScalingPolicyConfiguration?: {
    targetValue: number;
    predefinedMetricSpecification?: {
      predefinedMetricType: 'ECSServiceAverageCPUUtilization' | 'ECSServiceAverageMemoryUtilization' | 'ALBRequestCountPerTarget';
      resourceLabel?: string;
    };
    scaleOutCooldown?: number;
    scaleInCooldown?: number;
    disableScaleIn?: boolean;
  };
}

// =============================================================================
// Rollback Types
// =============================================================================

/**
 * Rollback options
 */
export interface RollbackServiceOptions {
  cluster: string;
  service: string;
  taskDefinition?: string; // If not provided, rolls back to previous revision
  reason?: string;
}

/**
 * Rollback result
 */
export interface RollbackResult {
  service: string;
  previousTaskDefinition: string;
  newTaskDefinition: string;
  rollbackInitiated: boolean;
}

// =============================================================================
// Container Insights Types
// =============================================================================

/**
 * Container insights metrics
 */
export interface ContainerInsightsMetrics {
  clusterName: string;
  serviceName?: string;
  taskId?: string;
  metrics: {
    cpuUtilization?: number;
    memoryUtilization?: number;
    networkRxBytes?: number;
    networkTxBytes?: number;
    storageReadBytes?: number;
    storageWriteBytes?: number;
    runningTaskCount?: number;
    pendingTaskCount?: number;
    desiredTaskCount?: number;
  };
  timestamp: Date;
}

/**
 * Options for getting container insights metrics
 */
export interface GetContainerInsightsOptions {
  cluster: string;
  serviceName?: string;
  taskId?: string;
  startTime?: Date;
  endTime?: Date;
  period?: number;
  statistics?: ('Average' | 'Sum' | 'Minimum' | 'Maximum' | 'SampleCount')[];
}
