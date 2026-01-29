/**
 * AWS EC2 Management Types
 *
 * Type definitions for EC2 management operations including:
 * - Instance lifecycle and creation
 * - Security groups
 * - Key pairs
 * - AMIs
 * - Monitoring and metrics
 * - Auto Scaling groups
 * - Load balancers
 */

// =============================================================================
// Instance Types
// =============================================================================

/**
 * EC2 instance state
 */
export type EC2InstanceState =
  | "pending"
  | "running"
  | "shutting-down"
  | "terminated"
  | "stopping"
  | "stopped"
  | "unknown";

/**
 * EC2 instance information
 */
export type EC2Instance = {
  instanceId: string;
  instanceType: string;
  state: EC2InstanceState;
  stateReason?: string;
  publicIpAddress?: string;
  privateIpAddress?: string;
  publicDnsName?: string;
  privateDnsName?: string;
  vpcId?: string;
  subnetId?: string;
  availabilityZone?: string;
  region: string;
  imageId: string;
  keyName?: string;
  securityGroups: Array<{
    groupId: string;
    groupName: string;
  }>;
  tags: Record<string, string>;
  launchTime?: Date;
  platform?: string;
  architecture?: string;
  rootDeviceType?: string;
  rootDeviceName?: string;
  blockDeviceMappings: Array<{
    deviceName: string;
    volumeId?: string;
    status?: string;
    attachTime?: Date;
    deleteOnTermination?: boolean;
  }>;
  iamInstanceProfile?: {
    arn: string;
    id: string;
  };
  monitoring?: boolean;
  ebsOptimized?: boolean;
  enaSupport?: boolean;
  hypervisor?: string;
  cpuOptions?: {
    coreCount?: number;
    threadsPerCore?: number;
  };
};

/**
 * EC2 instance lifecycle operation options
 */
export type EC2InstanceLifecycleOptions = {
  region?: string;
  dryRun?: boolean;
  waitForState?: boolean;
};

/**
 * EC2 instance creation options
 */
export type EC2CreateInstanceOptions = {
  imageId: string;
  instanceType: string;
  name?: string;
  minCount?: number;
  maxCount?: number;
  keyName?: string;
  securityGroupIds?: string[];
  subnetId?: string;
  availabilityZone?: string;
  tenancy?: "default" | "dedicated" | "host";
  iamInstanceProfile?: {
    arn?: string;
    name?: string;
  };
  userData?: string;
  blockDeviceMappings?: Array<{
    deviceName: string;
    ebs?: {
      volumeSize?: number;
      volumeType?: string;
      deleteOnTermination?: boolean;
      encrypted?: boolean;
      iops?: number;
      throughput?: number;
      snapshotId?: string;
      kmsKeyId?: string;
    };
  }>;
  launchTemplateId?: string;
  launchTemplateVersion?: string;
  ebsOptimized?: boolean;
  monitoring?: boolean;
  disableApiTermination?: boolean;
  shutdownBehavior?: "stop" | "terminate";
  metadataOptions?: {
    httpTokens?: "optional" | "required";
    httpPutResponseHopLimit?: number;
    httpEndpoint?: "enabled" | "disabled";
    instanceMetadataTags?: "enabled" | "disabled";
  };
  creditSpecification?: "standard" | "unlimited";
  privateIpAddress?: string;
  tags?: Record<string, string>;
  region?: string;
  dryRun?: boolean;
  waitForState?: boolean;
};

/**
 * EC2 operation result
 */
export type EC2OperationResult = {
  success: boolean;
  instanceIds: string[];
  instances?: EC2Instance[];
  stateChanges?: Array<{
    instanceId: string;
    previousState?: EC2InstanceState;
    currentState?: EC2InstanceState;
  }>;
  error?: string;
};

// =============================================================================
// Launch Template Types
// =============================================================================

/**
 * EC2 launch template information
 */
export type EC2LaunchTemplate = {
  launchTemplateId: string;
  launchTemplateName: string;
  region: string;
  createdBy?: string;
  createTime?: Date;
  defaultVersionNumber?: number;
  latestVersionNumber?: number;
  tags: Record<string, string>;
};

/**
 * EC2 launch template creation options
 */
export type EC2LaunchTemplateOptions = {
  name: string;
  versionDescription?: string;
  imageId?: string;
  instanceType?: string;
  keyName?: string;
  securityGroupIds?: string[];
  userData?: string;
  iamInstanceProfile?: {
    arn?: string;
    name?: string;
  };
  blockDeviceMappings?: Array<{
    deviceName: string;
    ebs?: {
      volumeSize?: number;
      volumeType?: string;
      deleteOnTermination?: boolean;
      encrypted?: boolean;
      iops?: number;
      throughput?: number;
    };
  }>;
  ebsOptimized?: boolean;
  monitoring?: boolean;
  disableApiTermination?: boolean;
  shutdownBehavior?: "stop" | "terminate";
  metadataOptions?: {
    httpTokens?: "optional" | "required";
    httpPutResponseHopLimit?: number;
    httpEndpoint?: "enabled" | "disabled";
    instanceMetadataTags?: "enabled" | "disabled";
  };
  creditSpecification?: "standard" | "unlimited";
  tags?: Record<string, string>;
  region?: string;
};

// =============================================================================
// Security Group Types
// =============================================================================

/**
 * EC2 security group information
 */
export type EC2SecurityGroup = {
  groupId: string;
  groupName: string;
  description: string;
  vpcId?: string;
  region: string;
  ownerId: string;
  inboundRules: EC2SecurityGroupRule[];
  outboundRules: EC2SecurityGroupRule[];
  tags: Record<string, string>;
};

/**
 * EC2 security group rule
 */
export type EC2SecurityGroupRule = {
  direction: "inbound" | "outbound";
  protocol: string;
  fromPort?: number;
  toPort?: number;
  cidrIpv4?: string;
  cidrIpv6?: string;
  referencedSecurityGroupId?: string;
  prefixListId?: string;
  description?: string;
};

/**
 * EC2 security group creation options
 */
export type EC2SecurityGroupOptions = {
  name: string;
  description: string;
  vpcId?: string;
  inboundRules?: EC2SecurityGroupRule[];
  outboundRules?: EC2SecurityGroupRule[];
  tags?: Record<string, string>;
  region?: string;
};

// =============================================================================
// Key Pair Types
// =============================================================================

/**
 * EC2 key pair information
 */
export type EC2KeyPair = {
  keyName: string;
  keyPairId: string;
  keyFingerprint: string;
  keyType?: string;
  createTime?: Date;
  tags: Record<string, string>;
};

/**
 * EC2 key pair creation options
 */
export type EC2KeyPairOptions = {
  name: string;
  keyType?: "rsa" | "ed25519";
  keyFormat?: "pem" | "ppk";
  tags?: Record<string, string>;
  region?: string;
};

// =============================================================================
// AMI Types
// =============================================================================

/**
 * EC2 AMI information
 */
export type EC2AMI = {
  imageId: string;
  name: string;
  description?: string;
  state: string;
  region: string;
  architecture?: string;
  imageType?: string;
  platform?: string;
  platformDetails?: string;
  rootDeviceType?: string;
  rootDeviceName?: string;
  virtualizationType?: string;
  hypervisor?: string;
  ownerId: string;
  ownerAlias?: string;
  public: boolean;
  creationDate?: Date;
  deprecationTime?: Date;
  blockDeviceMappings: Array<{
    deviceName: string;
    snapshotId?: string;
    volumeSize?: number;
    volumeType?: string;
    encrypted?: boolean;
    deleteOnTermination?: boolean;
  }>;
  tags: Record<string, string>;
};

/**
 * EC2 AMI list options
 */
export type EC2AMIOptions = {
  imageIds?: string[];
  owners?: string[];
  executableUsers?: string[];
  state?: "available" | "pending" | "failed";
  architecture?: string;
  platform?: string;
  rootDeviceType?: "ebs" | "instance-store";
  virtualizationType?: "hvm" | "paravirtual";
  includeDeprecated?: boolean;
  filters?: Record<string, string[]>;
  maxResults?: number;
  region?: string;
};

// =============================================================================
// Monitoring & Metrics Types
// =============================================================================

/**
 * EC2 instance metrics
 */
export type EC2InstanceMetrics = {
  instanceId: string;
  period: number;
  startTime: Date;
  endTime: Date;
  cpuUtilization: MetricDatapoint[];
  networkIn: MetricDatapoint[];
  networkOut: MetricDatapoint[];
  diskReadOps: MetricDatapoint[];
  diskWriteOps: MetricDatapoint[];
  diskReadBytes: MetricDatapoint[];
  diskWriteBytes: MetricDatapoint[];
  statusCheckFailed: MetricDatapoint[];
};

/**
 * Metric datapoint
 */
export type MetricDatapoint = {
  timestamp: Date;
  average?: number;
  maximum?: number;
  minimum?: number;
  sum?: number;
  sampleCount?: number;
  unit?: string;
};

/**
 * EC2 metric options
 */
export type EC2MetricOptions = {
  startTime?: Date;
  endTime?: Date;
  period?: number;
  statistics?: string[];
  region?: string;
};

// =============================================================================
// Auto Scaling Types
// =============================================================================

/**
 * Auto Scaling group information
 */
export type AutoScalingGroupInfo = {
  autoScalingGroupName: string;
  autoScalingGroupARN: string;
  launchConfigurationName?: string;
  launchTemplate?: {
    launchTemplateId?: string;
    launchTemplateName?: string;
    version?: string;
  };
  mixedInstancesPolicy?: {
    launchTemplate?: {
      launchTemplateId?: string;
      launchTemplateName?: string;
      version?: string;
    };
  };
  minSize: number;
  maxSize: number;
  desiredCapacity: number;
  defaultCooldown?: number;
  availabilityZones: string[];
  loadBalancerNames: string[];
  targetGroupARNs: string[];
  healthCheckType?: string;
  healthCheckGracePeriod?: number;
  instances: Array<{
    instanceId: string;
    instanceType: string;
    availabilityZone: string;
    lifecycleState: string;
    healthStatus: string;
    launchConfigurationName?: string;
    launchTemplate?: {
      launchTemplateId?: string;
      launchTemplateName?: string;
      version?: string;
    };
    protectedFromScaleIn?: boolean;
  }>;
  createdTime?: Date;
  suspendedProcesses: Array<{
    processName: string;
    suspensionReason?: string;
  }>;
  vpcZoneIdentifier?: string;
  enabledMetrics: Array<{
    metric: string;
    granularity: string;
  }>;
  status?: string;
  tags: Record<string, string>;
  terminationPolicies: string[];
  newInstancesProtectedFromScaleIn?: boolean;
  serviceLinkedRoleARN?: string;
  maxInstanceLifetime?: number;
  capacityRebalance?: boolean;
};

/**
 * Auto Scaling group creation options
 */
export type AutoScalingGroupOptions = {
  name: string;
  launchConfigurationName?: string;
  launchTemplate?: {
    launchTemplateId?: string;
    launchTemplateName?: string;
    version?: string;
  };
  minSize: number;
  maxSize: number;
  desiredCapacity?: number;
  defaultCooldown?: number;
  availabilityZones?: string[];
  loadBalancerNames?: string[];
  targetGroupARNs?: string[];
  healthCheckType?: "EC2" | "ELB";
  healthCheckGracePeriod?: number;
  vpcZoneIdentifier?: string;
  terminationPolicies?: string[];
  newInstancesProtectedFromScaleIn?: boolean;
  serviceLinkedRoleARN?: string;
  maxInstanceLifetime?: number;
  capacityRebalance?: boolean;
  tags?: Record<string, string>;
  region?: string;
};

// =============================================================================
// Load Balancer Types
// =============================================================================

/**
 * Load balancer information
 */
export type LoadBalancerInfo = {
  loadBalancerArn: string;
  loadBalancerName: string;
  dnsName: string;
  canonicalHostedZoneId?: string;
  createdTime?: Date;
  scheme?: string;
  type?: string;
  state?: string;
  vpcId?: string;
  availabilityZones: Array<{
    zoneName: string;
    subnetId?: string;
    loadBalancerAddresses: Array<{
      ipAddress?: string;
      allocationId?: string;
      privateIPv4Address?: string;
    }>;
  }>;
  securityGroups: string[];
  ipAddressType?: string;
};

/**
 * Load balancer creation options
 */
export type LoadBalancerOptions = {
  name: string;
  subnets?: string[];
  subnetMappings?: Array<{
    subnetId: string;
    allocationId?: string;
    privateIPv4Address?: string;
    ipv6Address?: string;
  }>;
  securityGroups?: string[];
  scheme?: "internet-facing" | "internal";
  type?: "application" | "network" | "gateway";
  ipAddressType?: "ipv4" | "dualstack";
  tags?: Record<string, string>;
  region?: string;
};

/**
 * Target group information
 */
export type TargetGroupInfo = {
  targetGroupArn: string;
  targetGroupName: string;
  protocol?: string;
  port?: number;
  vpcId?: string;
  healthCheckProtocol?: string;
  healthCheckPort?: string;
  healthCheckEnabled?: boolean;
  healthCheckIntervalSeconds?: number;
  healthCheckTimeoutSeconds?: number;
  healthyThresholdCount?: number;
  unhealthyThresholdCount?: number;
  healthCheckPath?: string;
  matcher?: {
    httpCode?: string;
  };
  loadBalancerArns: string[];
  targetType?: string;
  protocolVersion?: string;
  ipAddressType?: string;
};

/**
 * Target group creation options
 */
export type TargetGroupOptions = {
  name: string;
  protocol?: "HTTP" | "HTTPS" | "TCP" | "TCP_UDP" | "UDP" | "TLS";
  protocolVersion?: "HTTP1" | "HTTP2" | "GRPC";
  port?: number;
  vpcId?: string;
  healthCheckProtocol?: "HTTP" | "HTTPS" | "TCP";
  healthCheckPort?: string;
  healthCheckEnabled?: boolean;
  healthCheckPath?: string;
  healthCheckIntervalSeconds?: number;
  healthCheckTimeoutSeconds?: number;
  healthyThresholdCount?: number;
  unhealthyThresholdCount?: number;
  matcher?: {
    httpCode?: string;
  };
  targetType?: "instance" | "ip" | "lambda" | "alb";
  ipAddressType?: "ipv4" | "ipv6";
  tags?: Record<string, string>;
  region?: string;
};
