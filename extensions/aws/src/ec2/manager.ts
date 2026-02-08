/**
 * AWS EC2 Management
 *
 * Comprehensive EC2 management capabilities:
 * - Instance lifecycle operations (start/stop/terminate)
 * - Instance creation with template support
 * - Security group management
 * - Key pair management
 * - Instance monitoring and metrics
 * - Auto Scaling group operations
 * - AMI management
 * - Elastic Load Balancer integration
 */

import {
  EC2Client,
  // Instance lifecycle
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
  ModifyInstanceAttributeCommand,
  // Launch templates
  CreateLaunchTemplateCommand,
  DeleteLaunchTemplateCommand,
  DescribeLaunchTemplatesCommand,
  DescribeLaunchTemplateVersionsCommand,
  CreateLaunchTemplateVersionCommand,
  ModifyLaunchTemplateCommand,
  // Security groups
  CreateSecurityGroupCommand,
  DeleteSecurityGroupCommand,
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  AuthorizeSecurityGroupEgressCommand,
  RevokeSecurityGroupIngressCommand,
  RevokeSecurityGroupEgressCommand,
  ModifySecurityGroupRulesCommand,
  // Key pairs
  CreateKeyPairCommand,
  DeleteKeyPairCommand,
  DescribeKeyPairsCommand,
  ImportKeyPairCommand,
  // AMI management
  CreateImageCommand,
  DeregisterImageCommand,
  DescribeImagesCommand,
  CopyImageCommand,
  ModifyImageAttributeCommand,
  // Monitoring
  MonitorInstancesCommand,
  UnmonitorInstancesCommand,
  // Tags
  CreateTagsCommand,
  DeleteTagsCommand,
  type Instance,
  type SecurityGroup,
  type KeyPairInfo,
  type Image,
  type LaunchTemplate,
  type LaunchTemplateVersion,
  type InstanceStateName,
  type Filter,
  type Tag,
  type IpPermission,
  _InstanceType,
  VolumeType,
} from "@aws-sdk/client-ec2";

import {
  AutoScalingClient,
  CreateAutoScalingGroupCommand,
  DeleteAutoScalingGroupCommand,
  DescribeAutoScalingGroupsCommand,
  UpdateAutoScalingGroupCommand,
  SetDesiredCapacityCommand,
  DescribeScalingActivitiesCommand,
  CreateLaunchConfigurationCommand,
  DeleteLaunchConfigurationCommand,
  DescribeLaunchConfigurationsCommand,
  AttachLoadBalancerTargetGroupsCommand,
  DetachLoadBalancerTargetGroupsCommand,
  type AutoScalingGroup,
  type LaunchConfiguration,
  type Activity,
} from "@aws-sdk/client-auto-scaling";

import {
  ElasticLoadBalancingV2Client,
  CreateLoadBalancerCommand,
  DeleteLoadBalancerCommand,
  DescribeLoadBalancersCommand,
  CreateTargetGroupCommand,
  DeleteTargetGroupCommand,
  DescribeTargetGroupsCommand,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
  DescribeTargetHealthCommand,
  CreateListenerCommand,
  DeleteListenerCommand,
  DescribeListenersCommand,
  ModifyLoadBalancerAttributesCommand,
  type LoadBalancer,
  type TargetGroup,
  type TargetHealthDescription,
  type Listener,
} from "@aws-sdk/client-elastic-load-balancing-v2";

import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  Statistic,
  type Datapoint,
} from "@aws-sdk/client-cloudwatch";

import type { AWSCredentialsManager } from "../credentials/manager.js";
import { withAWSRetry, type AWSRetryOptions } from "../retry.js";
import type {
  EC2Instance,
  EC2InstanceState,
  EC2InstanceLifecycleOptions,
  EC2CreateInstanceOptions,
  EC2LaunchTemplate,
  EC2LaunchTemplateOptions,
  EC2SecurityGroup,
  EC2SecurityGroupRule,
  EC2SecurityGroupOptions,
  EC2KeyPair,
  EC2KeyPairOptions,
  EC2AMI,
  EC2AMIOptions,
  EC2InstanceMetrics,
  EC2MetricOptions,
  AutoScalingGroupInfo,
  AutoScalingGroupOptions,
  LoadBalancerInfo,
  LoadBalancerOptions,
  TargetGroupInfo,
  TargetGroupOptions,
  EC2OperationResult,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_METRIC_PERIOD = 300; // 5 minutes
const DEFAULT_METRIC_STATISTICS = ["Average", "Maximum", "Minimum"];

// =============================================================================
// EC2 Manager
// =============================================================================

export class AWSEC2Manager {
  private credentialsManager: AWSCredentialsManager;
  private defaultRegion: string;
  private retryOptions: AWSRetryOptions;

  constructor(credentialsManager: AWSCredentialsManager, defaultRegion?: string, retryOptions?: AWSRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.defaultRegion = defaultRegion ?? "us-east-1";
    this.retryOptions = retryOptions ?? {};
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Execute an AWS API call with retry logic for transient failures
   */
  private async withRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return withAWSRetry(fn, { ...this.retryOptions, label });
  }

  private async getEC2Client(region?: string): Promise<EC2Client> {
    const credentials = await this.credentialsManager.getCredentials();
    return new EC2Client({
      region: region ?? credentials.region ?? this.defaultRegion,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }

  private async getAutoScalingClient(region?: string): Promise<AutoScalingClient> {
    const credentials = await this.credentialsManager.getCredentials();
    return new AutoScalingClient({
      region: region ?? credentials.region ?? this.defaultRegion,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }

  private async getELBClient(region?: string): Promise<ElasticLoadBalancingV2Client> {
    const credentials = await this.credentialsManager.getCredentials();
    return new ElasticLoadBalancingV2Client({
      region: region ?? credentials.region ?? this.defaultRegion,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }

  private async getCloudWatchClient(region?: string): Promise<CloudWatchClient> {
    const credentials = await this.credentialsManager.getCredentials();
    return new CloudWatchClient({
      region: region ?? credentials.region ?? this.defaultRegion,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }

  private mapInstance(instance: Instance, region: string): EC2Instance {
    return {
      instanceId: instance.InstanceId ?? "",
      instanceType: instance.InstanceType ?? "",
      state: (instance.State?.Name as EC2InstanceState) ?? "unknown",
      stateReason: instance.StateReason?.Message,
      publicIpAddress: instance.PublicIpAddress,
      privateIpAddress: instance.PrivateIpAddress,
      publicDnsName: instance.PublicDnsName,
      privateDnsName: instance.PrivateDnsName,
      vpcId: instance.VpcId,
      subnetId: instance.SubnetId,
      availabilityZone: instance.Placement?.AvailabilityZone,
      region,
      imageId: instance.ImageId ?? "",
      keyName: instance.KeyName,
      securityGroups: instance.SecurityGroups?.map((sg) => ({
        groupId: sg.GroupId ?? "",
        groupName: sg.GroupName ?? "",
      })) ?? [],
      tags: this.mapTags(instance.Tags),
      launchTime: instance.LaunchTime,
      platform: instance.Platform,
      architecture: instance.Architecture,
      rootDeviceType: instance.RootDeviceType,
      rootDeviceName: instance.RootDeviceName,
      blockDeviceMappings: instance.BlockDeviceMappings?.map((bdm) => ({
        deviceName: bdm.DeviceName ?? "",
        volumeId: bdm.Ebs?.VolumeId,
        status: bdm.Ebs?.Status,
        attachTime: bdm.Ebs?.AttachTime,
        deleteOnTermination: bdm.Ebs?.DeleteOnTermination,
      })) ?? [],
      iamInstanceProfile: instance.IamInstanceProfile ? {
        arn: instance.IamInstanceProfile.Arn ?? "",
        id: instance.IamInstanceProfile.Id ?? "",
      } : undefined,
      monitoring: instance.Monitoring?.State === "enabled",
      ebsOptimized: instance.EbsOptimized,
      enaSupport: instance.EnaSupport,
      hypervisor: instance.Hypervisor,
      cpuOptions: instance.CpuOptions ? {
        coreCount: instance.CpuOptions.CoreCount,
        threadsPerCore: instance.CpuOptions.ThreadsPerCore,
      } : undefined,
    };
  }

  private mapTags(tags?: Tag[]): Record<string, string> {
    const result: Record<string, string> = {};
    if (tags) {
      for (const tag of tags) {
        if (tag.Key && tag.Value !== undefined) {
          result[tag.Key] = tag.Value;
        }
      }
    }
    return result;
  }

  private mapSecurityGroup(sg: SecurityGroup, region: string): EC2SecurityGroup {
    return {
      groupId: sg.GroupId ?? "",
      groupName: sg.GroupName ?? "",
      description: sg.Description ?? "",
      vpcId: sg.VpcId,
      region,
      ownerId: sg.OwnerId ?? "",
      inboundRules: this.mapIpPermissions(sg.IpPermissions ?? [], "inbound"),
      outboundRules: this.mapIpPermissions(sg.IpPermissionsEgress ?? [], "outbound"),
      tags: this.mapTags(sg.Tags),
    };
  }

  private mapIpPermissions(
    permissions: IpPermission[],
    direction: "inbound" | "outbound"
  ): EC2SecurityGroupRule[] {
    const rules: EC2SecurityGroupRule[] = [];
    
    for (const perm of permissions) {
      // IPv4 ranges
      for (const range of perm.IpRanges ?? []) {
        rules.push({
          direction,
          protocol: perm.IpProtocol ?? "all",
          fromPort: perm.FromPort,
          toPort: perm.ToPort,
          cidrIpv4: range.CidrIp,
          description: range.Description,
        });
      }
      
      // IPv6 ranges
      for (const range of perm.Ipv6Ranges ?? []) {
        rules.push({
          direction,
          protocol: perm.IpProtocol ?? "all",
          fromPort: perm.FromPort,
          toPort: perm.ToPort,
          cidrIpv6: range.CidrIpv6,
          description: range.Description,
        });
      }
      
      // Security group references
      for (const sgRef of perm.UserIdGroupPairs ?? []) {
        rules.push({
          direction,
          protocol: perm.IpProtocol ?? "all",
          fromPort: perm.FromPort,
          toPort: perm.ToPort,
          referencedSecurityGroupId: sgRef.GroupId,
          description: sgRef.Description,
        });
      }
      
      // Prefix lists
      for (const pl of perm.PrefixListIds ?? []) {
        rules.push({
          direction,
          protocol: perm.IpProtocol ?? "all",
          fromPort: perm.FromPort,
          toPort: perm.ToPort,
          prefixListId: pl.PrefixListId,
          description: pl.Description,
        });
      }
    }
    
    return rules;
  }

  private mapKeyPair(kp: KeyPairInfo): EC2KeyPair {
    return {
      keyName: kp.KeyName ?? "",
      keyPairId: kp.KeyPairId ?? "",
      keyFingerprint: kp.KeyFingerprint ?? "",
      keyType: kp.KeyType,
      createTime: kp.CreateTime,
      tags: this.mapTags(kp.Tags),
    };
  }

  private mapImage(image: Image, region: string): EC2AMI {
    return {
      imageId: image.ImageId ?? "",
      name: image.Name ?? "",
      description: image.Description,
      state: image.State ?? "unknown",
      region,
      architecture: image.Architecture,
      imageType: image.ImageType,
      platform: image.Platform,
      platformDetails: image.PlatformDetails,
      rootDeviceType: image.RootDeviceType,
      rootDeviceName: image.RootDeviceName,
      virtualizationType: image.VirtualizationType,
      hypervisor: image.Hypervisor,
      ownerId: image.OwnerId ?? "",
      ownerAlias: image.ImageOwnerAlias,
      public: image.Public ?? false,
      creationDate: image.CreationDate ? new Date(image.CreationDate) : undefined,
      deprecationTime: image.DeprecationTime ? new Date(image.DeprecationTime) : undefined,
      blockDeviceMappings: image.BlockDeviceMappings?.map((bdm) => ({
        deviceName: bdm.DeviceName ?? "",
        snapshotId: bdm.Ebs?.SnapshotId,
        volumeSize: bdm.Ebs?.VolumeSize,
        volumeType: bdm.Ebs?.VolumeType,
        encrypted: bdm.Ebs?.Encrypted,
        deleteOnTermination: bdm.Ebs?.DeleteOnTermination,
      })) ?? [],
      tags: this.mapTags(image.Tags),
    };
  }

  private mapLaunchTemplate(lt: LaunchTemplate, region: string): EC2LaunchTemplate {
    return {
      launchTemplateId: lt.LaunchTemplateId ?? "",
      launchTemplateName: lt.LaunchTemplateName ?? "",
      region,
      createdBy: lt.CreatedBy,
      createTime: lt.CreateTime,
      defaultVersionNumber: lt.DefaultVersionNumber,
      latestVersionNumber: lt.LatestVersionNumber,
      tags: this.mapTags(lt.Tags),
    };
  }

  // ===========================================================================
  // Instance Lifecycle Operations
  // ===========================================================================

  /**
   * List EC2 instances
   */
  async listInstances(options: {
    instanceIds?: string[];
    filters?: Record<string, string[]>;
    states?: EC2InstanceState[];
    maxResults?: number;
    region?: string;
  } = {}): Promise<EC2Instance[]> {
    const client = await this.getEC2Client(options.region);
    const instances: EC2Instance[] = [];
    let nextToken: string | undefined;

    const filters: Filter[] = [];
    
    // Add state filter
    if (options.states && options.states.length > 0) {
      filters.push({
        Name: "instance-state-name",
        Values: options.states,
      });
    }
    
    // Add custom filters
    if (options.filters) {
      for (const [name, values] of Object.entries(options.filters)) {
        filters.push({ Name: name, Values: values });
      }
    }

    do {
      const command = new DescribeInstancesCommand({
        InstanceIds: options.instanceIds,
        Filters: filters.length > 0 ? filters : undefined,
        MaxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
        NextToken: nextToken,
      });

      const response = await this.withRetry(
        () => client.send(command),
        "DescribeInstances"
      );
      
      for (const reservation of response.Reservations ?? []) {
        for (const instance of reservation.Instances ?? []) {
          instances.push(this.mapInstance(instance, options.region ?? this.defaultRegion));
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    client.destroy();
    return instances;
  }

  /**
   * Get instance by ID
   */
  async getInstance(instanceId: string, region?: string): Promise<EC2Instance | null> {
    const instances = await this.listInstances({
      instanceIds: [instanceId],
      region,
    });
    return instances.length > 0 ? instances[0] : null;
  }

  /**
   * Start EC2 instances
   */
  async startInstances(
    instanceIds: string[],
    options: EC2InstanceLifecycleOptions = {}
  ): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(options.region);

    try {
      const command = new StartInstancesCommand({
        InstanceIds: instanceIds,
        DryRun: options.dryRun,
      });

      const response = await this.withRetry(
        () => client.send(command),
        "StartInstances"
      );
      
      const stateChanges = response.StartingInstances?.map((change) => ({
        instanceId: change.InstanceId ?? "",
        previousState: change.PreviousState?.Name as EC2InstanceState,
        currentState: change.CurrentState?.Name as EC2InstanceState,
      })) ?? [];

      // Wait for instances to be running if requested
      if (options.waitForState) {
        await this.waitForInstanceState(instanceIds, "running", options.region);
      }

      return {
        success: true,
        instanceIds,
        stateChanges,
      };
    } catch (error) {
      return {
        success: false,
        instanceIds,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Stop EC2 instances
   */
  async stopInstances(
    instanceIds: string[],
    options: EC2InstanceLifecycleOptions & { force?: boolean; hibernate?: boolean } = {}
  ): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(options.region);

    try {
      const command = new StopInstancesCommand({
        InstanceIds: instanceIds,
        DryRun: options.dryRun,
        Force: options.force,
        Hibernate: options.hibernate,
      });

      const response = await this.withRetry(
        () => client.send(command),
        "StopInstances"
      );
      
      const stateChanges = response.StoppingInstances?.map((change) => ({
        instanceId: change.InstanceId ?? "",
        previousState: change.PreviousState?.Name as EC2InstanceState,
        currentState: change.CurrentState?.Name as EC2InstanceState,
      })) ?? [];

      // Wait for instances to be stopped if requested
      if (options.waitForState) {
        await this.waitForInstanceState(instanceIds, "stopped", options.region);
      }

      return {
        success: true,
        instanceIds,
        stateChanges,
      };
    } catch (error) {
      return {
        success: false,
        instanceIds,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Reboot EC2 instances
   */
  async rebootInstances(
    instanceIds: string[],
    options: EC2InstanceLifecycleOptions = {}
  ): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(options.region);

    try {
      const command = new RebootInstancesCommand({
        InstanceIds: instanceIds,
        DryRun: options.dryRun,
      });

      await this.withRetry(() => client.send(command), 'RebootInstances');

      return {
        success: true,
        instanceIds,
      };
    } catch (error) {
      return {
        success: false,
        instanceIds,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Terminate EC2 instances
   */
  async terminateInstances(
    instanceIds: string[],
    options: EC2InstanceLifecycleOptions = {}
  ): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(options.region);

    try {
      const command = new TerminateInstancesCommand({
        InstanceIds: instanceIds,
        DryRun: options.dryRun,
      });

      const response = await this.withRetry(() => client.send(command), 'TerminateInstances');
      
      const stateChanges = response.TerminatingInstances?.map((change) => ({
        instanceId: change.InstanceId ?? "",
        previousState: change.PreviousState?.Name as EC2InstanceState,
        currentState: change.CurrentState?.Name as EC2InstanceState,
      })) ?? [];

      // Wait for instances to be terminated if requested
      if (options.waitForState) {
        await this.waitForInstanceState(instanceIds, "terminated", options.region);
      }

      return {
        success: true,
        instanceIds,
        stateChanges,
      };
    } catch (error) {
      return {
        success: false,
        instanceIds,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Wait for instance to reach a specific state
   */
  async waitForInstanceState(
    instanceIds: string[],
    targetState: EC2InstanceState,
    region?: string,
    maxAttempts = 60,
    intervalMs = 5000
  ): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const instances = await this.listInstances({
        instanceIds,
        region,
      });

      const allInState = instances.every((instance) => instance.state === targetState);
      if (allInState) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    
    return false;
  }

  /**
   * Get instance status
   */
  async getInstanceStatus(instanceIds: string[], region?: string): Promise<Array<{
    instanceId: string;
    instanceState: EC2InstanceState;
    systemStatus: string;
    instanceStatus: string;
    availabilityZone: string;
  }>> {
    const client = await this.getEC2Client(region);

    try {
      const command = new DescribeInstanceStatusCommand({
        InstanceIds: instanceIds,
        IncludeAllInstances: true,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeInstanceStatus');
      
      return response.InstanceStatuses?.map((status) => ({
        instanceId: status.InstanceId ?? "",
        instanceState: (status.InstanceState?.Name as EC2InstanceState) ?? "unknown",
        systemStatus: status.SystemStatus?.Status ?? "unknown",
        instanceStatus: status.InstanceStatus?.Status ?? "unknown",
        availabilityZone: status.AvailabilityZone ?? "",
      })) ?? [];
    } finally {
      client.destroy();
    }
  }

  // ===========================================================================
  // Instance Creation
  // ===========================================================================

  /**
   * Create EC2 instances
   */
  async createInstances(options: EC2CreateInstanceOptions): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];
      
      // Add Name tag if provided
      if (options.name) {
        tags.push({ Key: "Name", Value: options.name });
      }

      const command = new RunInstancesCommand({
        ImageId: options.imageId,
        InstanceType: options.instanceType as _InstanceType,
        MinCount: options.minCount ?? 1,
        MaxCount: options.maxCount ?? 1,
        KeyName: options.keyName,
        SecurityGroupIds: options.securityGroupIds,
        SubnetId: options.subnetId,
        IamInstanceProfile: options.iamInstanceProfile ? {
          Arn: options.iamInstanceProfile.arn,
          Name: options.iamInstanceProfile.name,
        } : undefined,
        UserData: options.userData ? Buffer.from(options.userData).toString("base64") : undefined,
        BlockDeviceMappings: options.blockDeviceMappings?.map((bdm) => ({
          DeviceName: bdm.deviceName,
          Ebs: bdm.ebs ? {
            VolumeSize: bdm.ebs.volumeSize,
            VolumeType: bdm.ebs.volumeType as VolumeType,
            DeleteOnTermination: bdm.ebs.deleteOnTermination,
            Encrypted: bdm.ebs.encrypted,
            Iops: bdm.ebs.iops,
            Throughput: bdm.ebs.throughput,
            SnapshotId: bdm.ebs.snapshotId,
            KmsKeyId: bdm.ebs.kmsKeyId,
          } : undefined,
        })),
        LaunchTemplate: options.launchTemplateId ? {
          LaunchTemplateId: options.launchTemplateId,
          Version: options.launchTemplateVersion,
        } : undefined,
        Placement: options.availabilityZone || options.tenancy ? {
          AvailabilityZone: options.availabilityZone,
          Tenancy: options.tenancy,
        } : undefined,
        EbsOptimized: options.ebsOptimized,
        Monitoring: options.monitoring ? { Enabled: true } : undefined,
        DisableApiTermination: options.disableApiTermination,
        InstanceInitiatedShutdownBehavior: options.shutdownBehavior,
        DryRun: options.dryRun,
        TagSpecifications: tags.length > 0 ? [
          {
            ResourceType: "instance",
            Tags: tags,
          },
          {
            ResourceType: "volume",
            Tags: tags,
          },
        ] : undefined,
        MetadataOptions: options.metadataOptions ? {
          HttpTokens: options.metadataOptions.httpTokens,
          HttpPutResponseHopLimit: options.metadataOptions.httpPutResponseHopLimit,
          HttpEndpoint: options.metadataOptions.httpEndpoint,
          InstanceMetadataTags: options.metadataOptions.instanceMetadataTags,
        } : undefined,
        CreditSpecification: options.creditSpecification ? {
          CpuCredits: options.creditSpecification,
        } : undefined,
        PrivateIpAddress: options.privateIpAddress,
      });

      const response = await this.withRetry(() => client.send(command), 'RunInstances');
      
      const instanceIds = response.Instances?.map((i) => i.InstanceId ?? "") ?? [];

      // Wait for instances to be running if requested
      if (options.waitForState && instanceIds.length > 0) {
        await this.waitForInstanceState(instanceIds, "running", options.region);
      }

      return {
        success: true,
        instanceIds,
        instances: response.Instances?.map((i) => this.mapInstance(i, options.region ?? this.defaultRegion)),
      };
    } catch (error) {
      return {
        success: false,
        instanceIds: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Modify instance attribute
   */
  async modifyInstanceAttribute(
    instanceId: string,
    attribute: {
      instanceType?: string;
      userData?: string;
      disableApiTermination?: boolean;
      instanceInitiatedShutdownBehavior?: "stop" | "terminate";
      ebsOptimized?: boolean;
      sourceDestCheck?: boolean;
    },
    region?: string
  ): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(region);

    try {
      const command = new ModifyInstanceAttributeCommand({
        InstanceId: instanceId,
        InstanceType: attribute.instanceType ? { Value: attribute.instanceType } : undefined,
        UserData: attribute.userData ? { Value: new TextEncoder().encode(Buffer.from(attribute.userData).toString("base64")) } : undefined,
        DisableApiTermination: attribute.disableApiTermination !== undefined ? { Value: attribute.disableApiTermination } : undefined,
        InstanceInitiatedShutdownBehavior: attribute.instanceInitiatedShutdownBehavior ? { Value: attribute.instanceInitiatedShutdownBehavior } : undefined,
        EbsOptimized: attribute.ebsOptimized !== undefined ? { Value: attribute.ebsOptimized } : undefined,
        SourceDestCheck: attribute.sourceDestCheck !== undefined ? { Value: attribute.sourceDestCheck } : undefined,
      });

      await this.withRetry(() => client.send(command), 'ModifyInstanceAttribute');

      return {
        success: true,
        instanceIds: [instanceId],
      };
    } catch (error) {
      return {
        success: false,
        instanceIds: [instanceId],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  // ===========================================================================
  // Launch Templates
  // ===========================================================================

  /**
   * List launch templates
   */
  async listLaunchTemplates(options: {
    launchTemplateIds?: string[];
    launchTemplateNames?: string[];
    maxResults?: number;
    region?: string;
  } = {}): Promise<EC2LaunchTemplate[]> {
    const client = await this.getEC2Client(options.region);
    const templates: EC2LaunchTemplate[] = [];
    let nextToken: string | undefined;

    do {
      const command = new DescribeLaunchTemplatesCommand({
        LaunchTemplateIds: options.launchTemplateIds,
        LaunchTemplateNames: options.launchTemplateNames,
        MaxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
        NextToken: nextToken,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeLaunchTemplates');
      
      for (const lt of response.LaunchTemplates ?? []) {
        templates.push(this.mapLaunchTemplate(lt, options.region ?? this.defaultRegion));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    client.destroy();
    return templates;
  }

  /**
   * Create launch template
   */
  async createLaunchTemplate(options: EC2LaunchTemplateOptions): Promise<{
    success: boolean;
    launchTemplate?: EC2LaunchTemplate;
    error?: string;
  }> {
    const client = await this.getEC2Client(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new CreateLaunchTemplateCommand({
        LaunchTemplateName: options.name,
        VersionDescription: options.versionDescription,
        LaunchTemplateData: {
          ImageId: options.imageId,
          InstanceType: options.instanceType as _InstanceType,
          KeyName: options.keyName,
          SecurityGroupIds: options.securityGroupIds,
          UserData: options.userData ? Buffer.from(options.userData).toString("base64") : undefined,
          IamInstanceProfile: options.iamInstanceProfile ? {
            Arn: options.iamInstanceProfile.arn,
            Name: options.iamInstanceProfile.name,
          } : undefined,
          BlockDeviceMappings: options.blockDeviceMappings?.map((bdm) => ({
            DeviceName: bdm.deviceName,
            Ebs: bdm.ebs ? {
              VolumeSize: bdm.ebs.volumeSize,
              VolumeType: bdm.ebs.volumeType as VolumeType,
              DeleteOnTermination: bdm.ebs.deleteOnTermination,
              Encrypted: bdm.ebs.encrypted,
              Iops: bdm.ebs.iops,
              Throughput: bdm.ebs.throughput,
            } : undefined,
          })),
          EbsOptimized: options.ebsOptimized,
          Monitoring: options.monitoring ? { Enabled: true } : undefined,
          DisableApiTermination: options.disableApiTermination,
          InstanceInitiatedShutdownBehavior: options.shutdownBehavior,
          MetadataOptions: options.metadataOptions ? {
            HttpTokens: options.metadataOptions.httpTokens,
            HttpPutResponseHopLimit: options.metadataOptions.httpPutResponseHopLimit,
            HttpEndpoint: options.metadataOptions.httpEndpoint,
            InstanceMetadataTags: options.metadataOptions.instanceMetadataTags,
          } : undefined,
          CreditSpecification: options.creditSpecification ? {
            CpuCredits: options.creditSpecification,
          } : undefined,
        },
        TagSpecifications: tags.length > 0 ? [
          {
            ResourceType: "launch-template",
            Tags: tags,
          },
        ] : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateLaunchTemplate');
      
      if (response.LaunchTemplate) {
        return {
          success: true,
          launchTemplate: this.mapLaunchTemplate(response.LaunchTemplate, options.region ?? this.defaultRegion),
        };
      }

      return {
        success: false,
        error: "Failed to create launch template",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete launch template
   */
  async deleteLaunchTemplate(
    launchTemplateId: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      await this.withRetry(() => client.send(new DeleteLaunchTemplateCommand({
        LaunchTemplateId: launchTemplateId,
      })), 'DeleteLaunchTemplate');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Get launch template versions
   */
  async getLaunchTemplateVersions(
    launchTemplateId: string,
    options: { versions?: string[]; region?: string } = {}
  ): Promise<LaunchTemplateVersion[]> {
    const client = await this.getEC2Client(options.region);
    const versions: LaunchTemplateVersion[] = [];
    let nextToken: string | undefined;

    do {
      const command = new DescribeLaunchTemplateVersionsCommand({
        LaunchTemplateId: launchTemplateId,
        Versions: options.versions,
        MaxResults: DEFAULT_MAX_RESULTS,
        NextToken: nextToken,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeLaunchTemplateVersions');
      versions.push(...(response.LaunchTemplateVersions ?? []));
      nextToken = response.NextToken;
    } while (nextToken);

    client.destroy();
    return versions;
  }

  // ===========================================================================
  // Security Groups
  // ===========================================================================

  /**
   * List security groups
   */
  async listSecurityGroups(options: {
    groupIds?: string[];
    groupNames?: string[];
    filters?: Record<string, string[]>;
    maxResults?: number;
    region?: string;
  } = {}): Promise<EC2SecurityGroup[]> {
    const client = await this.getEC2Client(options.region);
    const securityGroups: EC2SecurityGroup[] = [];
    let nextToken: string | undefined;

    const filters: Filter[] = [];
    if (options.filters) {
      for (const [name, values] of Object.entries(options.filters)) {
        filters.push({ Name: name, Values: values });
      }
    }

    do {
      const command = new DescribeSecurityGroupsCommand({
        GroupIds: options.groupIds,
        GroupNames: options.groupNames,
        Filters: filters.length > 0 ? filters : undefined,
        MaxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
        NextToken: nextToken,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeSecurityGroups');
      
      for (const sg of response.SecurityGroups ?? []) {
        securityGroups.push(this.mapSecurityGroup(sg, options.region ?? this.defaultRegion));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    client.destroy();
    return securityGroups;
  }

  /**
   * Get security group by ID
   */
  async getSecurityGroup(groupId: string, region?: string): Promise<EC2SecurityGroup | null> {
    const groups = await this.listSecurityGroups({
      groupIds: [groupId],
      region,
    });
    return groups.length > 0 ? groups[0] : null;
  }

  /**
   * Create security group
   */
  async createSecurityGroup(options: EC2SecurityGroupOptions): Promise<{
    success: boolean;
    securityGroup?: EC2SecurityGroup;
    error?: string;
  }> {
    const client = await this.getEC2Client(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const createCommand = new CreateSecurityGroupCommand({
        GroupName: options.name,
        Description: options.description,
        VpcId: options.vpcId,
        TagSpecifications: tags.length > 0 ? [
          {
            ResourceType: "security-group",
            Tags: tags,
          },
        ] : undefined,
      });

      const response = await this.withRetry(() => client.send(createCommand), 'CreateSecurityGroup');
      const groupId = response.GroupId;

      if (!groupId) {
        return {
          success: false,
          error: "Failed to create security group",
        };
      }

      // Add inbound rules
      if (options.inboundRules && options.inboundRules.length > 0) {
        await this.authorizeSecurityGroupIngress(groupId, options.inboundRules, options.region);
      }

      // Add outbound rules (note: default allows all outbound, so we might need to revoke first)
      if (options.outboundRules && options.outboundRules.length > 0) {
        await this.authorizeSecurityGroupEgress(groupId, options.outboundRules, options.region);
      }

      // Fetch and return the created security group
      const sg = await this.getSecurityGroup(groupId, options.region);
      
      return {
        success: true,
        securityGroup: sg ?? undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete security group
   */
  async deleteSecurityGroup(
    groupId: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      await this.withRetry(() => client.send(new DeleteSecurityGroupCommand({
        GroupId: groupId,
      })), 'DeleteSecurityGroup');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Authorize security group ingress
   */
  async authorizeSecurityGroupIngress(
    groupId: string,
    rules: EC2SecurityGroupRule[],
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      const ipPermissions: IpPermission[] = rules.map((rule) => ({
        IpProtocol: rule.protocol,
        FromPort: rule.fromPort,
        ToPort: rule.toPort,
        IpRanges: rule.cidrIpv4 ? [{ CidrIp: rule.cidrIpv4, Description: rule.description }] : undefined,
        Ipv6Ranges: rule.cidrIpv6 ? [{ CidrIpv6: rule.cidrIpv6, Description: rule.description }] : undefined,
        UserIdGroupPairs: rule.referencedSecurityGroupId ? [{ GroupId: rule.referencedSecurityGroupId, Description: rule.description }] : undefined,
        PrefixListIds: rule.prefixListId ? [{ PrefixListId: rule.prefixListId, Description: rule.description }] : undefined,
      }));

      await this.withRetry(() => client.send(new AuthorizeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: ipPermissions,
      })), 'AuthorizeSecurityGroupIngress');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Authorize security group egress
   */
  async authorizeSecurityGroupEgress(
    groupId: string,
    rules: EC2SecurityGroupRule[],
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      const ipPermissions: IpPermission[] = rules.map((rule) => ({
        IpProtocol: rule.protocol,
        FromPort: rule.fromPort,
        ToPort: rule.toPort,
        IpRanges: rule.cidrIpv4 ? [{ CidrIp: rule.cidrIpv4, Description: rule.description }] : undefined,
        Ipv6Ranges: rule.cidrIpv6 ? [{ CidrIpv6: rule.cidrIpv6, Description: rule.description }] : undefined,
        UserIdGroupPairs: rule.referencedSecurityGroupId ? [{ GroupId: rule.referencedSecurityGroupId, Description: rule.description }] : undefined,
        PrefixListIds: rule.prefixListId ? [{ PrefixListId: rule.prefixListId, Description: rule.description }] : undefined,
      }));

      await this.withRetry(() => client.send(new AuthorizeSecurityGroupEgressCommand({
        GroupId: groupId,
        IpPermissions: ipPermissions,
      })), 'AuthorizeSecurityGroupEgress');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Revoke security group ingress
   */
  async revokeSecurityGroupIngress(
    groupId: string,
    rules: EC2SecurityGroupRule[],
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      const ipPermissions: IpPermission[] = rules.map((rule) => ({
        IpProtocol: rule.protocol,
        FromPort: rule.fromPort,
        ToPort: rule.toPort,
        IpRanges: rule.cidrIpv4 ? [{ CidrIp: rule.cidrIpv4 }] : undefined,
        Ipv6Ranges: rule.cidrIpv6 ? [{ CidrIpv6: rule.cidrIpv6 }] : undefined,
        UserIdGroupPairs: rule.referencedSecurityGroupId ? [{ GroupId: rule.referencedSecurityGroupId }] : undefined,
        PrefixListIds: rule.prefixListId ? [{ PrefixListId: rule.prefixListId }] : undefined,
      }));

      await this.withRetry(() => client.send(new RevokeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: ipPermissions,
      })), 'RevokeSecurityGroupIngress');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Revoke security group egress
   */
  async revokeSecurityGroupEgress(
    groupId: string,
    rules: EC2SecurityGroupRule[],
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      const ipPermissions: IpPermission[] = rules.map((rule) => ({
        IpProtocol: rule.protocol,
        FromPort: rule.fromPort,
        ToPort: rule.toPort,
        IpRanges: rule.cidrIpv4 ? [{ CidrIp: rule.cidrIpv4 }] : undefined,
        Ipv6Ranges: rule.cidrIpv6 ? [{ CidrIpv6: rule.cidrIpv6 }] : undefined,
        UserIdGroupPairs: rule.referencedSecurityGroupId ? [{ GroupId: rule.referencedSecurityGroupId }] : undefined,
        PrefixListIds: rule.prefixListId ? [{ PrefixListId: rule.prefixListId }] : undefined,
      }));

      await this.withRetry(() => client.send(new RevokeSecurityGroupEgressCommand({
        GroupId: groupId,
        IpPermissions: ipPermissions,
      })), 'RevokeSecurityGroupEgress');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  // ===========================================================================
  // Key Pairs
  // ===========================================================================

  /**
   * List key pairs
   */
  async listKeyPairs(options: {
    keyNames?: string[];
    keyPairIds?: string[];
    region?: string;
  } = {}): Promise<EC2KeyPair[]> {
    const client = await this.getEC2Client(options.region);

    try {
      const command = new DescribeKeyPairsCommand({
        KeyNames: options.keyNames,
        KeyPairIds: options.keyPairIds,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeKeyPairs');
      
      return response.KeyPairs?.map((kp) => this.mapKeyPair(kp)) ?? [];
    } finally {
      client.destroy();
    }
  }

  /**
   * Create key pair
   */
  async createKeyPair(options: EC2KeyPairOptions): Promise<{
    success: boolean;
    keyPair?: EC2KeyPair;
    privateKeyMaterial?: string;
    error?: string;
  }> {
    const client = await this.getEC2Client(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new CreateKeyPairCommand({
        KeyName: options.name,
        KeyType: options.keyType ?? "rsa",
        KeyFormat: options.keyFormat ?? "pem",
        TagSpecifications: tags.length > 0 ? [
          {
            ResourceType: "key-pair",
            Tags: tags,
          },
        ] : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateKeyPair');
      
      return {
        success: true,
        keyPair: {
          keyName: response.KeyName ?? "",
          keyPairId: response.KeyPairId ?? "",
          keyFingerprint: response.KeyFingerprint ?? "",
          keyType: options.keyType ?? "rsa",
          createTime: undefined,
          tags: options.tags ?? {},
        },
        privateKeyMaterial: response.KeyMaterial,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Import key pair
   */
  async importKeyPair(
    name: string,
    publicKeyMaterial: string,
    options: { tags?: Record<string, string>; region?: string } = {}
  ): Promise<{
    success: boolean;
    keyPair?: EC2KeyPair;
    error?: string;
  }> {
    const client = await this.getEC2Client(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new ImportKeyPairCommand({
        KeyName: name,
        PublicKeyMaterial: Buffer.from(publicKeyMaterial),
        TagSpecifications: tags.length > 0 ? [
          {
            ResourceType: "key-pair",
            Tags: tags,
          },
        ] : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'ImportKeyPair');
      
      return {
        success: true,
        keyPair: {
          keyName: response.KeyName ?? "",
          keyPairId: response.KeyPairId ?? "",
          keyFingerprint: response.KeyFingerprint ?? "",
          tags: options.tags ?? {},
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete key pair
   */
  async deleteKeyPair(
    keyName: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      await this.withRetry(() => client.send(new DeleteKeyPairCommand({
        KeyName: keyName,
      })), 'DeleteKeyPair');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  // ===========================================================================
  // Monitoring & Metrics
  // ===========================================================================

  /**
   * Enable detailed monitoring
   */
  async enableMonitoring(
    instanceIds: string[],
    region?: string
  ): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(region);

    try {
      const command = new MonitorInstancesCommand({
        InstanceIds: instanceIds,
      });

      await this.withRetry(() => client.send(command), 'MonitorInstances');

      return {
        success: true,
        instanceIds,
      };
    } catch (error) {
      return {
        success: false,
        instanceIds,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Disable detailed monitoring
   */
  async disableMonitoring(
    instanceIds: string[],
    region?: string
  ): Promise<EC2OperationResult> {
    const client = await this.getEC2Client(region);

    try {
      const command = new UnmonitorInstancesCommand({
        InstanceIds: instanceIds,
      });

      await this.withRetry(() => client.send(command), 'UnmonitorInstances');

      return {
        success: true,
        instanceIds,
      };
    } catch (error) {
      return {
        success: false,
        instanceIds,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Get instance metrics
   */
  async getInstanceMetrics(
    instanceId: string,
    options: EC2MetricOptions = {}
  ): Promise<EC2InstanceMetrics> {
    const client = await this.getCloudWatchClient(options.region);
    const endTime = options.endTime ?? new Date();
    const startTime = options.startTime ?? new Date(endTime.getTime() - 3600000); // 1 hour default
    const period = options.period ?? DEFAULT_METRIC_PERIOD;
    const statistics = options.statistics ?? DEFAULT_METRIC_STATISTICS;

    const metrics: EC2InstanceMetrics = {
      instanceId,
      period,
      startTime,
      endTime,
      cpuUtilization: [],
      networkIn: [],
      networkOut: [],
      diskReadOps: [],
      diskWriteOps: [],
      diskReadBytes: [],
      diskWriteBytes: [],
      statusCheckFailed: [],
    };

    const metricNames = [
      { name: "CPUUtilization", key: "cpuUtilization" as const },
      { name: "NetworkIn", key: "networkIn" as const },
      { name: "NetworkOut", key: "networkOut" as const },
      { name: "DiskReadOps", key: "diskReadOps" as const },
      { name: "DiskWriteOps", key: "diskWriteOps" as const },
      { name: "DiskReadBytes", key: "diskReadBytes" as const },
      { name: "DiskWriteBytes", key: "diskWriteBytes" as const },
      { name: "StatusCheckFailed", key: "statusCheckFailed" as const },
    ];

    try {
      for (const metric of metricNames) {
        const command = new GetMetricStatisticsCommand({
          Namespace: "AWS/EC2",
          MetricName: metric.name,
          Dimensions: [
            {
              Name: "InstanceId",
              Value: instanceId,
            },
          ],
          StartTime: startTime,
          EndTime: endTime,
          Period: period,
          Statistics: statistics as Statistic[],
        });

        const response = await this.withRetry(() => client.send(command), 'GetMetricStatistics');
        metrics[metric.key] = response.Datapoints?.map((dp) => ({
          timestamp: dp.Timestamp ?? new Date(),
          average: dp.Average,
          maximum: dp.Maximum,
          minimum: dp.Minimum,
          sum: dp.Sum,
          sampleCount: dp.SampleCount,
          unit: dp.Unit,
        })).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()) ?? [];
      }
    } finally {
      client.destroy();
    }

    return metrics;
  }

  // ===========================================================================
  // AMI Management
  // ===========================================================================

  /**
   * List AMIs
   */
  async listAMIs(options: EC2AMIOptions = {}): Promise<EC2AMI[]> {
    const client = await this.getEC2Client(options.region);

    const filters: Filter[] = [];
    
    if (options.state) {
      filters.push({ Name: "state", Values: [options.state] });
    }
    
    if (options.architecture) {
      filters.push({ Name: "architecture", Values: [options.architecture] });
    }
    
    if (options.platform) {
      filters.push({ Name: "platform", Values: [options.platform] });
    }
    
    if (options.rootDeviceType) {
      filters.push({ Name: "root-device-type", Values: [options.rootDeviceType] });
    }
    
    if (options.virtualizationType) {
      filters.push({ Name: "virtualization-type", Values: [options.virtualizationType] });
    }
    
    if (options.filters) {
      for (const [name, values] of Object.entries(options.filters)) {
        filters.push({ Name: name, Values: values });
      }
    }

    try {
      const command = new DescribeImagesCommand({
        ImageIds: options.imageIds,
        Owners: options.owners ?? ["self"],
        ExecutableUsers: options.executableUsers,
        Filters: filters.length > 0 ? filters : undefined,
        IncludeDeprecated: options.includeDeprecated,
        MaxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeImages');
      
      return response.Images?.map((img) => this.mapImage(img, options.region ?? this.defaultRegion)) ?? [];
    } finally {
      client.destroy();
    }
  }

  /**
   * Create AMI from instance
   */
  async createAMI(
    instanceId: string,
    name: string,
    options: {
      description?: string;
      noReboot?: boolean;
      tags?: Record<string, string>;
      blockDeviceMappings?: Array<{
        deviceName: string;
        ebs?: {
          volumeSize?: number;
          volumeType?: string;
          deleteOnTermination?: boolean;
          encrypted?: boolean;
          snapshotId?: string;
        };
      }>;
      region?: string;
    } = {}
  ): Promise<{
    success: boolean;
    imageId?: string;
    error?: string;
  }> {
    const client = await this.getEC2Client(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new CreateImageCommand({
        InstanceId: instanceId,
        Name: name,
        Description: options.description,
        NoReboot: options.noReboot,
        BlockDeviceMappings: options.blockDeviceMappings?.map((bdm) => ({
          DeviceName: bdm.deviceName,
          Ebs: bdm.ebs ? {
            VolumeSize: bdm.ebs.volumeSize,
            VolumeType: bdm.ebs.volumeType as VolumeType,
            DeleteOnTermination: bdm.ebs.deleteOnTermination,
            Encrypted: bdm.ebs.encrypted,
            SnapshotId: bdm.ebs.snapshotId,
          } : undefined,
        })),
        TagSpecifications: tags.length > 0 ? [
          {
            ResourceType: "image",
            Tags: tags,
          },
          {
            ResourceType: "snapshot",
            Tags: tags,
          },
        ] : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateImage');
      
      return {
        success: true,
        imageId: response.ImageId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Deregister AMI
   */
  async deregisterAMI(
    imageId: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      await this.withRetry(() => client.send(new DeregisterImageCommand({
        ImageId: imageId,
      })), 'DeregisterImage');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Copy AMI to another region
   */
  async copyAMI(
    sourceImageId: string,
    sourceRegion: string,
    name: string,
    options: {
      description?: string;
      encrypted?: boolean;
      kmsKeyId?: string;
      destinationRegion?: string;
      tags?: Record<string, string>;
    } = {}
  ): Promise<{
    success: boolean;
    imageId?: string;
    error?: string;
  }> {
    const client = await this.getEC2Client(options.destinationRegion);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new CopyImageCommand({
        SourceImageId: sourceImageId,
        SourceRegion: sourceRegion,
        Name: name,
        Description: options.description,
        Encrypted: options.encrypted,
        KmsKeyId: options.kmsKeyId,
        TagSpecifications: tags.length > 0 ? [
          {
            ResourceType: "image",
            Tags: tags,
          },
          {
            ResourceType: "snapshot",
            Tags: tags,
          },
        ] : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CopyImage');
      
      return {
        success: true,
        imageId: response.ImageId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Modify AMI attribute
   */
  async modifyAMIAttribute(
    imageId: string,
    attribute: {
      launchPermission?: {
        add?: Array<{ userId?: string; group?: string }>;
        remove?: Array<{ userId?: string; group?: string }>;
      };
      description?: string;
    },
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      const command = new ModifyImageAttributeCommand({
        ImageId: imageId,
        LaunchPermission: attribute.launchPermission ? {
          Add: attribute.launchPermission.add?.map((p) => ({
            UserId: p.userId,
            Group: p.group as "all" | undefined,
          })),
          Remove: attribute.launchPermission.remove?.map((p) => ({
            UserId: p.userId,
            Group: p.group as "all" | undefined,
          })),
        } : undefined,
        Description: attribute.description ? { Value: attribute.description } : undefined,
      });

      await this.withRetry(() => client.send(command), 'ModifyImageAttribute');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  // ===========================================================================
  // Auto Scaling Groups
  // ===========================================================================

  /**
   * List Auto Scaling groups
   */
  async listAutoScalingGroups(options: {
    autoScalingGroupNames?: string[];
    maxRecords?: number;
    region?: string;
  } = {}): Promise<AutoScalingGroupInfo[]> {
    const client = await this.getAutoScalingClient(options.region);
    const groups: AutoScalingGroupInfo[] = [];
    let nextToken: string | undefined;

    do {
      const command = new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: options.autoScalingGroupNames,
        MaxRecords: options.maxRecords ?? DEFAULT_MAX_RESULTS,
        NextToken: nextToken,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeAutoScalingGroups');
      
      for (const asg of response.AutoScalingGroups ?? []) {
        groups.push({
          autoScalingGroupName: asg.AutoScalingGroupName ?? "",
          autoScalingGroupARN: asg.AutoScalingGroupARN ?? "",
          launchConfigurationName: asg.LaunchConfigurationName,
          launchTemplate: asg.LaunchTemplate ? {
            launchTemplateId: asg.LaunchTemplate.LaunchTemplateId,
            launchTemplateName: asg.LaunchTemplate.LaunchTemplateName,
            version: asg.LaunchTemplate.Version,
          } : undefined,
          mixedInstancesPolicy: asg.MixedInstancesPolicy ? {
            launchTemplate: asg.MixedInstancesPolicy.LaunchTemplate?.LaunchTemplateSpecification ? {
              launchTemplateId: asg.MixedInstancesPolicy.LaunchTemplate.LaunchTemplateSpecification.LaunchTemplateId,
              launchTemplateName: asg.MixedInstancesPolicy.LaunchTemplate.LaunchTemplateSpecification.LaunchTemplateName,
              version: asg.MixedInstancesPolicy.LaunchTemplate.LaunchTemplateSpecification.Version,
            } : undefined,
          } : undefined,
          minSize: asg.MinSize ?? 0,
          maxSize: asg.MaxSize ?? 0,
          desiredCapacity: asg.DesiredCapacity ?? 0,
          defaultCooldown: asg.DefaultCooldown,
          availabilityZones: asg.AvailabilityZones ?? [],
          loadBalancerNames: asg.LoadBalancerNames ?? [],
          targetGroupARNs: asg.TargetGroupARNs ?? [],
          healthCheckType: asg.HealthCheckType,
          healthCheckGracePeriod: asg.HealthCheckGracePeriod,
          instances: asg.Instances?.map((i) => ({
            instanceId: i.InstanceId ?? "",
            instanceType: i.InstanceType ?? "",
            availabilityZone: i.AvailabilityZone ?? "",
            lifecycleState: i.LifecycleState ?? "",
            healthStatus: i.HealthStatus ?? "",
            launchConfigurationName: i.LaunchConfigurationName,
            launchTemplate: i.LaunchTemplate ? {
              launchTemplateId: i.LaunchTemplate.LaunchTemplateId,
              launchTemplateName: i.LaunchTemplate.LaunchTemplateName,
              version: i.LaunchTemplate.Version,
            } : undefined,
            protectedFromScaleIn: i.ProtectedFromScaleIn,
          })) ?? [],
          createdTime: asg.CreatedTime,
          suspendedProcesses: asg.SuspendedProcesses?.map((p) => ({
            processName: p.ProcessName ?? "",
            suspensionReason: p.SuspensionReason,
          })) ?? [],
          vpcZoneIdentifier: asg.VPCZoneIdentifier,
          enabledMetrics: asg.EnabledMetrics?.map((m) => ({
            metric: m.Metric ?? "",
            granularity: m.Granularity ?? "",
          })) ?? [],
          status: asg.Status,
          tags: asg.Tags?.reduce((acc, tag) => {
            if (tag.Key) acc[tag.Key] = tag.Value ?? "";
            return acc;
          }, {} as Record<string, string>) ?? {},
          terminationPolicies: asg.TerminationPolicies ?? [],
          newInstancesProtectedFromScaleIn: asg.NewInstancesProtectedFromScaleIn,
          serviceLinkedRoleARN: asg.ServiceLinkedRoleARN,
          maxInstanceLifetime: asg.MaxInstanceLifetime,
          capacityRebalance: asg.CapacityRebalance,
        });
      }

      nextToken = response.NextToken;
    } while (nextToken);

    client.destroy();
    return groups;
  }

  /**
   * Create Auto Scaling group
   */
  async createAutoScalingGroup(options: AutoScalingGroupOptions): Promise<{
    success: boolean;
    error?: string;
  }> {
    const client = await this.getAutoScalingClient(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({
        Key,
        Value,
        PropagateAtLaunch: true,
        ResourceId: options.name,
        ResourceType: "auto-scaling-group",
      })) : [];

      const command = new CreateAutoScalingGroupCommand({
        AutoScalingGroupName: options.name,
        LaunchConfigurationName: options.launchConfigurationName,
        LaunchTemplate: options.launchTemplate ? {
          LaunchTemplateId: options.launchTemplate.launchTemplateId,
          LaunchTemplateName: options.launchTemplate.launchTemplateName,
          Version: options.launchTemplate.version,
        } : undefined,
        MinSize: options.minSize,
        MaxSize: options.maxSize,
        DesiredCapacity: options.desiredCapacity,
        DefaultCooldown: options.defaultCooldown,
        AvailabilityZones: options.availabilityZones,
        LoadBalancerNames: options.loadBalancerNames,
        TargetGroupARNs: options.targetGroupARNs,
        HealthCheckType: options.healthCheckType,
        HealthCheckGracePeriod: options.healthCheckGracePeriod,
        VPCZoneIdentifier: options.vpcZoneIdentifier,
        TerminationPolicies: options.terminationPolicies,
        NewInstancesProtectedFromScaleIn: options.newInstancesProtectedFromScaleIn,
        ServiceLinkedRoleARN: options.serviceLinkedRoleARN,
        MaxInstanceLifetime: options.maxInstanceLifetime,
        CapacityRebalance: options.capacityRebalance,
        Tags: tags.length > 0 ? tags : undefined,
      });

      await this.withRetry(() => client.send(command), 'CreateAutoScalingGroup');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Update Auto Scaling group
   */
  async updateAutoScalingGroup(
    name: string,
    updates: Partial<Omit<AutoScalingGroupOptions, "name">>,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getAutoScalingClient(region);

    try {
      const command = new UpdateAutoScalingGroupCommand({
        AutoScalingGroupName: name,
        LaunchConfigurationName: updates.launchConfigurationName,
        LaunchTemplate: updates.launchTemplate ? {
          LaunchTemplateId: updates.launchTemplate.launchTemplateId,
          LaunchTemplateName: updates.launchTemplate.launchTemplateName,
          Version: updates.launchTemplate.version,
        } : undefined,
        MinSize: updates.minSize,
        MaxSize: updates.maxSize,
        DesiredCapacity: updates.desiredCapacity,
        DefaultCooldown: updates.defaultCooldown,
        AvailabilityZones: updates.availabilityZones,
        HealthCheckType: updates.healthCheckType,
        HealthCheckGracePeriod: updates.healthCheckGracePeriod,
        VPCZoneIdentifier: updates.vpcZoneIdentifier,
        TerminationPolicies: updates.terminationPolicies,
        NewInstancesProtectedFromScaleIn: updates.newInstancesProtectedFromScaleIn,
        ServiceLinkedRoleARN: updates.serviceLinkedRoleARN,
        MaxInstanceLifetime: updates.maxInstanceLifetime,
        CapacityRebalance: updates.capacityRebalance,
      });

      await this.withRetry(() => client.send(command), 'UpdateAutoScalingGroup');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete Auto Scaling group
   */
  async deleteAutoScalingGroup(
    name: string,
    options: { forceDelete?: boolean; region?: string } = {}
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getAutoScalingClient(options.region);

    try {
      await this.withRetry(() => client.send(new DeleteAutoScalingGroupCommand({
        AutoScalingGroupName: name,
        ForceDelete: options.forceDelete,
      })), 'DeleteAutoScalingGroup');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Set desired capacity
   */
  async setDesiredCapacity(
    name: string,
    desiredCapacity: number,
    options: { honorCooldown?: boolean; region?: string } = {}
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getAutoScalingClient(options.region);

    try {
      await this.withRetry(() => client.send(new SetDesiredCapacityCommand({
        AutoScalingGroupName: name,
        DesiredCapacity: desiredCapacity,
        HonorCooldown: options.honorCooldown,
      })), 'SetDesiredCapacity');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Get scaling activities
   */
  async getScalingActivities(
    autoScalingGroupName: string,
    options: { maxRecords?: number; region?: string } = {}
  ): Promise<Array<{
    activityId: string;
    autoScalingGroupName: string;
    description: string;
    cause: string;
    startTime: Date;
    endTime?: Date;
    statusCode: string;
    statusMessage?: string;
    progress: number;
    details?: string;
  }>> {
    const client = await this.getAutoScalingClient(options.region);

    try {
      const command = new DescribeScalingActivitiesCommand({
        AutoScalingGroupName: autoScalingGroupName,
        MaxRecords: options.maxRecords ?? DEFAULT_MAX_RESULTS,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeScalingActivities');
      
      return response.Activities?.map((activity) => ({
        activityId: activity.ActivityId ?? "",
        autoScalingGroupName: activity.AutoScalingGroupName ?? "",
        description: activity.Description ?? "",
        cause: activity.Cause ?? "",
        startTime: activity.StartTime ?? new Date(),
        endTime: activity.EndTime,
        statusCode: activity.StatusCode ?? "",
        statusMessage: activity.StatusMessage,
        progress: activity.Progress ?? 0,
        details: activity.Details,
      })) ?? [];
    } finally {
      client.destroy();
    }
  }

  /**
   * Attach target groups to Auto Scaling group
   */
  async attachTargetGroups(
    autoScalingGroupName: string,
    targetGroupARNs: string[],
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getAutoScalingClient(region);

    try {
      await this.withRetry(() => client.send(new AttachLoadBalancerTargetGroupsCommand({
        AutoScalingGroupName: autoScalingGroupName,
        TargetGroupARNs: targetGroupARNs,
      })), 'AttachLoadBalancerTargetGroups');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Detach target groups from Auto Scaling group
   */
  async detachTargetGroups(
    autoScalingGroupName: string,
    targetGroupARNs: string[],
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getAutoScalingClient(region);

    try {
      await this.withRetry(() => client.send(new DetachLoadBalancerTargetGroupsCommand({
        AutoScalingGroupName: autoScalingGroupName,
        TargetGroupARNs: targetGroupARNs,
      })), 'DetachLoadBalancerTargetGroups');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  // ===========================================================================
  // Elastic Load Balancer
  // ===========================================================================

  /**
   * List load balancers
   */
  async listLoadBalancers(options: {
    loadBalancerArns?: string[];
    names?: string[];
    maxResults?: number;
    region?: string;
  } = {}): Promise<LoadBalancerInfo[]> {
    const client = await this.getELBClient(options.region);
    const loadBalancers: LoadBalancerInfo[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeLoadBalancersCommand({
        LoadBalancerArns: options.loadBalancerArns,
        Names: options.names,
        PageSize: options.maxResults ?? DEFAULT_MAX_RESULTS,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeLoadBalancers');
      
      for (const lb of response.LoadBalancers ?? []) {
        loadBalancers.push({
          loadBalancerArn: lb.LoadBalancerArn ?? "",
          loadBalancerName: lb.LoadBalancerName ?? "",
          dnsName: lb.DNSName ?? "",
          canonicalHostedZoneId: lb.CanonicalHostedZoneId,
          createdTime: lb.CreatedTime,
          scheme: lb.Scheme,
          type: lb.Type,
          state: lb.State?.Code,
          vpcId: lb.VpcId,
          availabilityZones: lb.AvailabilityZones?.map((az) => ({
            zoneName: az.ZoneName ?? "",
            subnetId: az.SubnetId,
            loadBalancerAddresses: az.LoadBalancerAddresses?.map((addr) => ({
              ipAddress: addr.IpAddress,
              allocationId: addr.AllocationId,
              privateIPv4Address: addr.PrivateIPv4Address,
            })) ?? [],
          })) ?? [],
          securityGroups: lb.SecurityGroups ?? [],
          ipAddressType: lb.IpAddressType,
        });
      }

      marker = response.NextMarker;
    } while (marker);

    client.destroy();
    return loadBalancers;
  }

  /**
   * Create load balancer
   */
  async createLoadBalancer(options: LoadBalancerOptions): Promise<{
    success: boolean;
    loadBalancer?: LoadBalancerInfo;
    error?: string;
  }> {
    const client = await this.getELBClient(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new CreateLoadBalancerCommand({
        Name: options.name,
        Subnets: options.subnets,
        SubnetMappings: options.subnetMappings?.map((sm) => ({
          SubnetId: sm.subnetId,
          AllocationId: sm.allocationId,
          PrivateIPv4Address: sm.privateIPv4Address,
          IPv6Address: sm.ipv6Address,
        })),
        SecurityGroups: options.securityGroups,
        Scheme: options.scheme,
        Type: options.type ?? "application",
        IpAddressType: options.ipAddressType,
        Tags: tags.length > 0 ? tags : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateLoadBalancer');
      
      const lb = response.LoadBalancers?.[0];
      if (lb) {
        return {
          success: true,
          loadBalancer: {
            loadBalancerArn: lb.LoadBalancerArn ?? "",
            loadBalancerName: lb.LoadBalancerName ?? "",
            dnsName: lb.DNSName ?? "",
            canonicalHostedZoneId: lb.CanonicalHostedZoneId,
            createdTime: lb.CreatedTime,
            scheme: lb.Scheme,
            type: lb.Type,
            state: lb.State?.Code,
            vpcId: lb.VpcId,
            availabilityZones: lb.AvailabilityZones?.map((az) => ({
              zoneName: az.ZoneName ?? "",
              subnetId: az.SubnetId,
              loadBalancerAddresses: az.LoadBalancerAddresses?.map((addr) => ({
                ipAddress: addr.IpAddress,
                allocationId: addr.AllocationId,
                privateIPv4Address: addr.PrivateIPv4Address,
              })) ?? [],
            })) ?? [],
            securityGroups: lb.SecurityGroups ?? [],
            ipAddressType: lb.IpAddressType,
          },
        };
      }

      return {
        success: false,
        error: "Failed to create load balancer",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete load balancer
   */
  async deleteLoadBalancer(
    loadBalancerArn: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getELBClient(region);

    try {
      await this.withRetry(() => client.send(new DeleteLoadBalancerCommand({
        LoadBalancerArn: loadBalancerArn,
      })), 'DeleteLoadBalancer');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * List target groups
   */
  async listTargetGroups(options: {
    targetGroupArns?: string[];
    names?: string[];
    loadBalancerArn?: string;
    maxResults?: number;
    region?: string;
  } = {}): Promise<TargetGroupInfo[]> {
    const client = await this.getELBClient(options.region);
    const targetGroups: TargetGroupInfo[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeTargetGroupsCommand({
        TargetGroupArns: options.targetGroupArns,
        Names: options.names,
        LoadBalancerArn: options.loadBalancerArn,
        PageSize: options.maxResults ?? DEFAULT_MAX_RESULTS,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeTargetGroups');
      
      for (const tg of response.TargetGroups ?? []) {
        targetGroups.push({
          targetGroupArn: tg.TargetGroupArn ?? "",
          targetGroupName: tg.TargetGroupName ?? "",
          protocol: tg.Protocol,
          port: tg.Port,
          vpcId: tg.VpcId,
          healthCheckProtocol: tg.HealthCheckProtocol,
          healthCheckPort: tg.HealthCheckPort,
          healthCheckEnabled: tg.HealthCheckEnabled,
          healthCheckIntervalSeconds: tg.HealthCheckIntervalSeconds,
          healthCheckTimeoutSeconds: tg.HealthCheckTimeoutSeconds,
          healthyThresholdCount: tg.HealthyThresholdCount,
          unhealthyThresholdCount: tg.UnhealthyThresholdCount,
          healthCheckPath: tg.HealthCheckPath,
          matcher: tg.Matcher ? { httpCode: tg.Matcher.HttpCode } : undefined,
          loadBalancerArns: tg.LoadBalancerArns ?? [],
          targetType: tg.TargetType,
          protocolVersion: tg.ProtocolVersion,
          ipAddressType: tg.IpAddressType,
        });
      }

      marker = response.NextMarker;
    } while (marker);

    client.destroy();
    return targetGroups;
  }

  /**
   * Create target group
   */
  async createTargetGroup(options: TargetGroupOptions): Promise<{
    success: boolean;
    targetGroup?: TargetGroupInfo;
    error?: string;
  }> {
    const client = await this.getELBClient(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new CreateTargetGroupCommand({
        Name: options.name,
        Protocol: options.protocol,
        ProtocolVersion: options.protocolVersion,
        Port: options.port,
        VpcId: options.vpcId,
        HealthCheckProtocol: options.healthCheckProtocol,
        HealthCheckPort: options.healthCheckPort,
        HealthCheckEnabled: options.healthCheckEnabled,
        HealthCheckPath: options.healthCheckPath,
        HealthCheckIntervalSeconds: options.healthCheckIntervalSeconds,
        HealthCheckTimeoutSeconds: options.healthCheckTimeoutSeconds,
        HealthyThresholdCount: options.healthyThresholdCount,
        UnhealthyThresholdCount: options.unhealthyThresholdCount,
        Matcher: options.matcher ? { HttpCode: options.matcher.httpCode } : undefined,
        TargetType: options.targetType ?? "instance",
        Tags: tags.length > 0 ? tags : undefined,
        IpAddressType: options.ipAddressType,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateTargetGroup');
      
      const tg = response.TargetGroups?.[0];
      if (tg) {
        return {
          success: true,
          targetGroup: {
            targetGroupArn: tg.TargetGroupArn ?? "",
            targetGroupName: tg.TargetGroupName ?? "",
            protocol: tg.Protocol,
            port: tg.Port,
            vpcId: tg.VpcId,
            healthCheckProtocol: tg.HealthCheckProtocol,
            healthCheckPort: tg.HealthCheckPort,
            healthCheckEnabled: tg.HealthCheckEnabled,
            healthCheckIntervalSeconds: tg.HealthCheckIntervalSeconds,
            healthCheckTimeoutSeconds: tg.HealthCheckTimeoutSeconds,
            healthyThresholdCount: tg.HealthyThresholdCount,
            unhealthyThresholdCount: tg.UnhealthyThresholdCount,
            healthCheckPath: tg.HealthCheckPath,
            matcher: tg.Matcher ? { httpCode: tg.Matcher.HttpCode } : undefined,
            loadBalancerArns: tg.LoadBalancerArns ?? [],
            targetType: tg.TargetType,
            protocolVersion: tg.ProtocolVersion,
            ipAddressType: tg.IpAddressType,
          },
        };
      }

      return {
        success: false,
        error: "Failed to create target group",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete target group
   */
  async deleteTargetGroup(
    targetGroupArn: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getELBClient(region);

    try {
      await this.withRetry(() => client.send(new DeleteTargetGroupCommand({
        TargetGroupArn: targetGroupArn,
      })), 'DeleteTargetGroup');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Register targets
   */
  async registerTargets(
    targetGroupArn: string,
    targets: Array<{ id: string; port?: number; availabilityZone?: string }>,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getELBClient(region);

    try {
      await this.withRetry(() => client.send(new RegisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: targets.map((t) => ({
          Id: t.id,
          Port: t.port,
          AvailabilityZone: t.availabilityZone,
        })),
      })), 'RegisterTargets');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Deregister targets
   */
  async deregisterTargets(
    targetGroupArn: string,
    targets: Array<{ id: string; port?: number; availabilityZone?: string }>,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getELBClient(region);

    try {
      await this.withRetry(() => client.send(new DeregisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: targets.map((t) => ({
          Id: t.id,
          Port: t.port,
          AvailabilityZone: t.availabilityZone,
        })),
      })), 'DeregisterTargets');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Get target health
   */
  async getTargetHealth(
    targetGroupArn: string,
    targets?: Array<{ id: string; port?: number; availabilityZone?: string }>,
    region?: string
  ): Promise<Array<{
    target: { id: string; port?: number; availabilityZone?: string };
    healthCheckPort?: string;
    targetHealth: {
      state: string;
      reason?: string;
      description?: string;
    };
  }>> {
    const client = await this.getELBClient(region);

    try {
      const command = new DescribeTargetHealthCommand({
        TargetGroupArn: targetGroupArn,
        Targets: targets?.map((t) => ({
          Id: t.id,
          Port: t.port,
          AvailabilityZone: t.availabilityZone,
        })),
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeTargetHealth');
      
      return response.TargetHealthDescriptions?.map((thd) => ({
        target: {
          id: thd.Target?.Id ?? "",
          port: thd.Target?.Port,
          availabilityZone: thd.Target?.AvailabilityZone,
        },
        healthCheckPort: thd.HealthCheckPort,
        targetHealth: {
          state: thd.TargetHealth?.State ?? "unknown",
          reason: thd.TargetHealth?.Reason,
          description: thd.TargetHealth?.Description,
        },
      })) ?? [];
    } finally {
      client.destroy();
    }
  }

  /**
   * Create listener
   */
  async createListener(options: {
    loadBalancerArn: string;
    protocol: "HTTP" | "HTTPS" | "TCP" | "UDP" | "TLS" | "TCP_UDP";
    port: number;
    defaultActions: Array<{
      type: "forward" | "redirect" | "fixed-response";
      targetGroupArn?: string;
      redirectConfig?: {
        protocol?: string;
        port?: string;
        host?: string;
        path?: string;
        query?: string;
        statusCode: "HTTP_301" | "HTTP_302";
      };
      fixedResponseConfig?: {
        statusCode: string;
        contentType?: string;
        messageBody?: string;
      };
    }>;
    sslPolicy?: string;
    certificates?: Array<{ certificateArn: string; isDefault?: boolean }>;
    tags?: Record<string, string>;
    region?: string;
  }): Promise<{
    success: boolean;
    listener?: {
      listenerArn: string;
      loadBalancerArn: string;
      port: number;
      protocol: string;
    };
    error?: string;
  }> {
    const client = await this.getELBClient(options.region);

    try {
      const tags = options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : [];

      const command = new CreateListenerCommand({
        LoadBalancerArn: options.loadBalancerArn,
        Protocol: options.protocol,
        Port: options.port,
        DefaultActions: options.defaultActions.map((action) => ({
          Type: action.type,
          TargetGroupArn: action.targetGroupArn,
          RedirectConfig: action.redirectConfig ? {
            Protocol: action.redirectConfig.protocol,
            Port: action.redirectConfig.port,
            Host: action.redirectConfig.host,
            Path: action.redirectConfig.path,
            Query: action.redirectConfig.query,
            StatusCode: action.redirectConfig.statusCode,
          } : undefined,
          FixedResponseConfig: action.fixedResponseConfig ? {
            StatusCode: action.fixedResponseConfig.statusCode,
            ContentType: action.fixedResponseConfig.contentType,
            MessageBody: action.fixedResponseConfig.messageBody,
          } : undefined,
        })),
        SslPolicy: options.sslPolicy,
        Certificates: options.certificates?.map((c) => ({
          CertificateArn: c.certificateArn,
          IsDefault: c.isDefault,
        })),
        Tags: tags.length > 0 ? tags : undefined,
      });

      const response = await this.withRetry(() => client.send(command), 'CreateListener');
      
      const listener = response.Listeners?.[0];
      if (listener) {
        return {
          success: true,
          listener: {
            listenerArn: listener.ListenerArn ?? "",
            loadBalancerArn: listener.LoadBalancerArn ?? "",
            port: listener.Port ?? 0,
            protocol: listener.Protocol ?? "",
          },
        };
      }

      return {
        success: false,
        error: "Failed to create listener",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Delete listener
   */
  async deleteListener(
    listenerArn: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getELBClient(region);

    try {
      await this.withRetry(() => client.send(new DeleteListenerCommand({
        ListenerArn: listenerArn,
      })), 'DeleteListener');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * List listeners
   */
  async listListeners(options: {
    loadBalancerArn?: string;
    listenerArns?: string[];
    maxResults?: number;
    region?: string;
  } = {}): Promise<Array<{
    listenerArn: string;
    loadBalancerArn: string;
    port: number;
    protocol: string;
    sslPolicy?: string;
    certificates?: Array<{ certificateArn: string; isDefault?: boolean }>;
    defaultActions: Array<{
      type: string;
      targetGroupArn?: string;
    }>;
  }>> {
    const client = await this.getELBClient(options.region);
    const listeners: Array<{
      listenerArn: string;
      loadBalancerArn: string;
      port: number;
      protocol: string;
      sslPolicy?: string;
      certificates?: Array<{ certificateArn: string; isDefault?: boolean }>;
      defaultActions: Array<{
        type: string;
        targetGroupArn?: string;
      }>;
    }> = [];
    let marker: string | undefined;

    do {
      const command = new DescribeListenersCommand({
        LoadBalancerArn: options.loadBalancerArn,
        ListenerArns: options.listenerArns,
        PageSize: options.maxResults ?? DEFAULT_MAX_RESULTS,
        Marker: marker,
      });

      const response = await this.withRetry(() => client.send(command), 'DescribeListeners');
      
      for (const l of response.Listeners ?? []) {
        listeners.push({
          listenerArn: l.ListenerArn ?? "",
          loadBalancerArn: l.LoadBalancerArn ?? "",
          port: l.Port ?? 0,
          protocol: l.Protocol ?? "",
          sslPolicy: l.SslPolicy,
          certificates: l.Certificates?.map((c) => ({
            certificateArn: c.CertificateArn ?? "",
            isDefault: c.IsDefault,
          })),
          defaultActions: l.DefaultActions?.map((a) => ({
            type: a.Type ?? "",
            targetGroupArn: a.TargetGroupArn,
          })) ?? [],
        });
      }

      marker = response.NextMarker;
    } while (marker);

    client.destroy();
    return listeners;
  }

  // ===========================================================================
  // Tags
  // ===========================================================================

  /**
   * Add tags to resources
   */
  async addTags(
    resourceIds: string[],
    tags: Record<string, string>,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      await this.withRetry(() => client.send(new CreateTagsCommand({
        Resources: resourceIds,
        Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
      })), 'CreateTags');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  /**
   * Remove tags from resources
   */
  async removeTags(
    resourceIds: string[],
    tagKeys: string[],
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getEC2Client(region);

    try {
      await this.withRetry(() => client.send(new DeleteTagsCommand({
        Resources: resourceIds,
        Tags: tagKeys.map((Key) => ({ Key })),
      })), 'DeleteTags');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.destroy();
    }
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Set default region
   */
  setDefaultRegion(region: string): void {
    this.defaultRegion = region;
  }

  /**
   * Get default region
   */
  getDefaultRegion(): string {
    return this.defaultRegion;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createEC2Manager(
  credentialsManager: AWSCredentialsManager,
  defaultRegion?: string
): AWSEC2Manager {
  return new AWSEC2Manager(credentialsManager, defaultRegion);
}
