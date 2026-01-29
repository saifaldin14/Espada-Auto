/**
 * AWS EC2 Management Module
 *
 * Exports EC2 management capabilities including:
 * - Instance lifecycle operations
 * - Security group management
 * - Key pair management
 * - AMI management
 * - Auto Scaling groups
 * - Load balancers
 */

export { AWSEC2Manager, createEC2Manager } from "./manager.js";

export type {
  // Instance types
  EC2Instance,
  EC2InstanceState,
  EC2InstanceLifecycleOptions,
  EC2CreateInstanceOptions,
  EC2OperationResult,

  // Launch template types
  EC2LaunchTemplate,
  EC2LaunchTemplateOptions,

  // Security group types
  EC2SecurityGroup,
  EC2SecurityGroupRule,
  EC2SecurityGroupOptions,

  // Key pair types
  EC2KeyPair,
  EC2KeyPairOptions,

  // AMI types
  EC2AMI,
  EC2AMIOptions,

  // Metrics types
  EC2InstanceMetrics,
  EC2MetricOptions,
  MetricDatapoint,

  // Auto Scaling types
  AutoScalingGroupInfo,
  AutoScalingGroupOptions,

  // Load balancer types
  LoadBalancerInfo,
  LoadBalancerOptions,
  TargetGroupInfo,
  TargetGroupOptions,
} from "./types.js";
