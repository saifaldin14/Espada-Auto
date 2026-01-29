/**
 * AWS EC2 Manager - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AWSEC2Manager, createEC2Manager } from "./manager.js";
import { AWSCredentialsManager } from "../credentials/manager.js";

// Mock credentials manager
const mockCredentialsManager = {
  getCredentials: vi.fn().mockResolvedValue({
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      source: "profile",
    },
    profile: "default",
    region: "us-east-1",
    accountId: "123456789012",
  }),
} as unknown as AWSCredentialsManager;

// Mock EC2 client
vi.mock("@aws-sdk/client-ec2", () => {
  const mockEC2Send = vi.fn().mockImplementation((command) => {
    const commandName = command._commandName || "";
    
    // DescribeInstances
    if (commandName === "DescribeInstancesCommand") {
      return Promise.resolve({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: "i-1234567890abcdef0",
                InstanceType: "t3.micro",
                State: { Name: "running", Code: 16 },
                PublicIpAddress: "54.123.45.67",
                PrivateIpAddress: "10.0.1.10",
                VpcId: "vpc-12345678",
                SubnetId: "subnet-12345678",
                ImageId: "ami-12345678",
                KeyName: "my-key",
                SecurityGroups: [
                  { GroupId: "sg-12345678", GroupName: "web-sg" },
                ],
                Tags: [
                  { Key: "Name", Value: "test-instance" },
                  { Key: "Environment", Value: "production" },
                ],
                LaunchTime: new Date("2024-01-01T00:00:00Z"),
                Placement: { AvailabilityZone: "us-east-1a" },
              },
            ],
          },
        ],
      });
    }
    
    // StartInstances
    if (commandName === "StartInstancesCommand") {
      return Promise.resolve({
        StartingInstances: [
          {
            InstanceId: "i-1234567890abcdef0",
            PreviousState: { Name: "stopped" },
            CurrentState: { Name: "pending" },
          },
        ],
      });
    }
    
    // StopInstances
    if (commandName === "StopInstancesCommand") {
      return Promise.resolve({
        StoppingInstances: [
          {
            InstanceId: "i-1234567890abcdef0",
            PreviousState: { Name: "running" },
            CurrentState: { Name: "stopping" },
          },
        ],
      });
    }
    
    // TerminateInstances
    if (commandName === "TerminateInstancesCommand") {
      return Promise.resolve({
        TerminatingInstances: [
          {
            InstanceId: "i-1234567890abcdef0",
            PreviousState: { Name: "running" },
            CurrentState: { Name: "shutting-down" },
          },
        ],
      });
    }
    
    // RunInstances
    if (commandName === "RunInstancesCommand") {
      return Promise.resolve({
        Instances: [
          {
            InstanceId: "i-newinstance1234567",
            InstanceType: "t3.micro",
            State: { Name: "pending" },
            ImageId: "ami-12345678",
          },
        ],
      });
    }
    
    // DescribeSecurityGroups
    if (commandName === "DescribeSecurityGroupsCommand") {
      return Promise.resolve({
        SecurityGroups: [
          {
            GroupId: "sg-12345678",
            GroupName: "web-sg",
            Description: "Web server security group",
            VpcId: "vpc-12345678",
            OwnerId: "123456789012",
            IpPermissions: [
              {
                IpProtocol: "tcp",
                FromPort: 80,
                ToPort: 80,
                IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "HTTP" }],
              },
              {
                IpProtocol: "tcp",
                FromPort: 443,
                ToPort: 443,
                IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "HTTPS" }],
              },
            ],
            IpPermissionsEgress: [
              {
                IpProtocol: "-1",
                IpRanges: [{ CidrIp: "0.0.0.0/0" }],
              },
            ],
            Tags: [{ Key: "Name", Value: "web-sg" }],
          },
        ],
      });
    }
    
    // CreateSecurityGroup
    if (commandName === "CreateSecurityGroupCommand") {
      return Promise.resolve({
        GroupId: "sg-newgroup12345678",
      });
    }
    
    // DescribeKeyPairs
    if (commandName === "DescribeKeyPairsCommand") {
      return Promise.resolve({
        KeyPairs: [
          {
            KeyName: "my-key",
            KeyPairId: "key-1234567890abcdef0",
            KeyFingerprint: "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99",
            KeyType: "rsa",
            CreateTime: new Date("2024-01-01T00:00:00Z"),
            Tags: [{ Key: "Name", Value: "my-key" }],
          },
        ],
      });
    }
    
    // CreateKeyPair
    if (commandName === "CreateKeyPairCommand") {
      return Promise.resolve({
        KeyName: "new-key",
        KeyPairId: "key-newkey1234567890",
        KeyFingerprint: "11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00",
        KeyType: "rsa",
        KeyMaterial: "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
      });
    }
    
    // DescribeImages
    if (commandName === "DescribeImagesCommand") {
      return Promise.resolve({
        Images: [
          {
            ImageId: "ami-12345678",
            Name: "test-ami",
            Description: "Test AMI",
            State: "available",
            Architecture: "x86_64",
            ImageType: "machine",
            RootDeviceType: "ebs",
            VirtualizationType: "hvm",
            OwnerId: "123456789012",
            Public: false,
            CreationDate: "2024-01-01T00:00:00.000Z",
            Tags: [{ Key: "Name", Value: "test-ami" }],
          },
        ],
      });
    }
    
    // CreateImage
    if (commandName === "CreateImageCommand") {
      return Promise.resolve({
        ImageId: "ami-newami123456789",
      });
    }
    
    // DescribeLaunchTemplates
    if (commandName === "DescribeLaunchTemplatesCommand") {
      return Promise.resolve({
        LaunchTemplates: [
          {
            LaunchTemplateId: "lt-1234567890abcdef0",
            LaunchTemplateName: "my-template",
            CreateTime: new Date("2024-01-01T00:00:00Z"),
            CreatedBy: "arn:aws:iam::123456789012:user/admin",
            DefaultVersionNumber: 1,
            LatestVersionNumber: 2,
            Tags: [{ Key: "Name", Value: "my-template" }],
          },
        ],
      });
    }
    
    // CreateLaunchTemplate
    if (commandName === "CreateLaunchTemplateCommand") {
      return Promise.resolve({
        LaunchTemplate: {
          LaunchTemplateId: "lt-newtemplate1234567",
          LaunchTemplateName: "new-template",
          CreateTime: new Date(),
          DefaultVersionNumber: 1,
          LatestVersionNumber: 1,
        },
      });
    }
    
    // Default responses
    return Promise.resolve({});
  });

  const MockEC2Client = class {
    send = mockEC2Send;
    destroy = vi.fn();
    constructor(public config: unknown) {}
  };

  const createCommand = (name: string) => vi.fn().mockImplementation((input) => ({ ...input, _commandName: name }));

  return {
    EC2Client: MockEC2Client,
    RunInstancesCommand: createCommand("RunInstancesCommand"),
    StartInstancesCommand: createCommand("StartInstancesCommand"),
    StopInstancesCommand: createCommand("StopInstancesCommand"),
    RebootInstancesCommand: createCommand("RebootInstancesCommand"),
    TerminateInstancesCommand: createCommand("TerminateInstancesCommand"),
    DescribeInstancesCommand: createCommand("DescribeInstancesCommand"),
    DescribeInstanceStatusCommand: createCommand("DescribeInstanceStatusCommand"),
    ModifyInstanceAttributeCommand: createCommand("ModifyInstanceAttributeCommand"),
    CreateLaunchTemplateCommand: createCommand("CreateLaunchTemplateCommand"),
    DeleteLaunchTemplateCommand: createCommand("DeleteLaunchTemplateCommand"),
    DescribeLaunchTemplatesCommand: createCommand("DescribeLaunchTemplatesCommand"),
    DescribeLaunchTemplateVersionsCommand: createCommand("DescribeLaunchTemplateVersionsCommand"),
    CreateLaunchTemplateVersionCommand: createCommand("CreateLaunchTemplateVersionCommand"),
    ModifyLaunchTemplateCommand: createCommand("ModifyLaunchTemplateCommand"),
    CreateSecurityGroupCommand: createCommand("CreateSecurityGroupCommand"),
    DeleteSecurityGroupCommand: createCommand("DeleteSecurityGroupCommand"),
    DescribeSecurityGroupsCommand: createCommand("DescribeSecurityGroupsCommand"),
    AuthorizeSecurityGroupIngressCommand: createCommand("AuthorizeSecurityGroupIngressCommand"),
    AuthorizeSecurityGroupEgressCommand: createCommand("AuthorizeSecurityGroupEgressCommand"),
    RevokeSecurityGroupIngressCommand: createCommand("RevokeSecurityGroupIngressCommand"),
    RevokeSecurityGroupEgressCommand: createCommand("RevokeSecurityGroupEgressCommand"),
    ModifySecurityGroupRulesCommand: createCommand("ModifySecurityGroupRulesCommand"),
    CreateKeyPairCommand: createCommand("CreateKeyPairCommand"),
    DeleteKeyPairCommand: createCommand("DeleteKeyPairCommand"),
    DescribeKeyPairsCommand: createCommand("DescribeKeyPairsCommand"),
    ImportKeyPairCommand: createCommand("ImportKeyPairCommand"),
    CreateImageCommand: createCommand("CreateImageCommand"),
    DeregisterImageCommand: createCommand("DeregisterImageCommand"),
    DescribeImagesCommand: createCommand("DescribeImagesCommand"),
    CopyImageCommand: createCommand("CopyImageCommand"),
    ModifyImageAttributeCommand: createCommand("ModifyImageAttributeCommand"),
    MonitorInstancesCommand: createCommand("MonitorInstancesCommand"),
    UnmonitorInstancesCommand: createCommand("UnmonitorInstancesCommand"),
    CreateTagsCommand: createCommand("CreateTagsCommand"),
    DeleteTagsCommand: createCommand("DeleteTagsCommand"),
  };
});

// Mock Auto Scaling client
vi.mock("@aws-sdk/client-auto-scaling", () => {
  const mockAutoScalingSend = vi.fn().mockImplementation((command) => {
    const commandName = command._commandName || "";
    
    if (commandName === "DescribeAutoScalingGroupsCommand") {
      return Promise.resolve({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: "test-asg",
            AutoScalingGroupARN: "arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:test-asg",
            LaunchTemplate: {
              LaunchTemplateId: "lt-1234567890abcdef0",
              LaunchTemplateName: "my-template",
              Version: "$Latest",
            },
            MinSize: 1,
            MaxSize: 5,
            DesiredCapacity: 2,
            AvailabilityZones: ["us-east-1a", "us-east-1b"],
            TargetGroupARNs: ["arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890123456"],
            HealthCheckType: "ELB",
            HealthCheckGracePeriod: 300,
            Instances: [
              {
                InstanceId: "i-1234567890abcdef0",
                InstanceType: "t3.micro",
                AvailabilityZone: "us-east-1a",
                LifecycleState: "InService",
                HealthStatus: "Healthy",
              },
            ],
            CreatedTime: new Date("2024-01-01T00:00:00Z"),
            VPCZoneIdentifier: "subnet-12345678,subnet-87654321",
            Tags: [{ Key: "Name", Value: "test-asg", PropagateAtLaunch: true }],
          },
        ],
      });
    }
    
    if (commandName === "DescribeScalingActivitiesCommand") {
      return Promise.resolve({
        Activities: [
          {
            ActivityId: "activity-123",
            AutoScalingGroupName: "test-asg",
            Description: "Launching a new instance",
            Cause: "Manual scale-out",
            StartTime: new Date("2024-01-15T10:00:00Z"),
            EndTime: new Date("2024-01-15T10:05:00Z"),
            StatusCode: "Successful",
            Progress: 100,
          },
        ],
      });
    }
    
    return Promise.resolve({});
  });

  const MockAutoScalingClient = class {
    send = mockAutoScalingSend;
    destroy = vi.fn();
    constructor(public config: unknown) {}
  };

  const createCommand = (name: string) => vi.fn().mockImplementation((input) => ({ ...input, _commandName: name }));

  return {
    AutoScalingClient: MockAutoScalingClient,
    CreateAutoScalingGroupCommand: createCommand("CreateAutoScalingGroupCommand"),
    DeleteAutoScalingGroupCommand: createCommand("DeleteAutoScalingGroupCommand"),
    DescribeAutoScalingGroupsCommand: createCommand("DescribeAutoScalingGroupsCommand"),
    UpdateAutoScalingGroupCommand: createCommand("UpdateAutoScalingGroupCommand"),
    SetDesiredCapacityCommand: createCommand("SetDesiredCapacityCommand"),
    DescribeScalingActivitiesCommand: createCommand("DescribeScalingActivitiesCommand"),
    CreateLaunchConfigurationCommand: createCommand("CreateLaunchConfigurationCommand"),
    DeleteLaunchConfigurationCommand: createCommand("DeleteLaunchConfigurationCommand"),
    DescribeLaunchConfigurationsCommand: createCommand("DescribeLaunchConfigurationsCommand"),
    AttachLoadBalancerTargetGroupsCommand: createCommand("AttachLoadBalancerTargetGroupsCommand"),
    DetachLoadBalancerTargetGroupsCommand: createCommand("DetachLoadBalancerTargetGroupsCommand"),
  };
});

// Mock ELB v2 client
vi.mock("@aws-sdk/client-elastic-load-balancing-v2", () => {
  const mockELBSend = vi.fn().mockImplementation((command) => {
    const commandName = command._commandName || "";
    
    if (commandName === "DescribeLoadBalancersCommand") {
      return Promise.resolve({
        LoadBalancers: [
          {
            LoadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/1234567890123456",
            LoadBalancerName: "my-alb",
            DNSName: "my-alb-1234567890.us-east-1.elb.amazonaws.com",
            CanonicalHostedZoneId: "Z35SXDOTRQ7X7K",
            CreatedTime: new Date("2024-01-01T00:00:00Z"),
            Scheme: "internet-facing",
            Type: "application",
            State: { Code: "active" },
            VpcId: "vpc-12345678",
            AvailabilityZones: [
              { ZoneName: "us-east-1a", SubnetId: "subnet-12345678" },
              { ZoneName: "us-east-1b", SubnetId: "subnet-87654321" },
            ],
            SecurityGroups: ["sg-12345678"],
            IpAddressType: "ipv4",
          },
        ],
      });
    }
    
    if (commandName === "DescribeTargetGroupsCommand") {
      return Promise.resolve({
        TargetGroups: [
          {
            TargetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890123456",
            TargetGroupName: "my-tg",
            Protocol: "HTTP",
            Port: 80,
            VpcId: "vpc-12345678",
            HealthCheckProtocol: "HTTP",
            HealthCheckPort: "traffic-port",
            HealthCheckEnabled: true,
            HealthCheckIntervalSeconds: 30,
            HealthCheckTimeoutSeconds: 5,
            HealthyThresholdCount: 5,
            UnhealthyThresholdCount: 2,
            HealthCheckPath: "/health",
            Matcher: { HttpCode: "200" },
            TargetType: "instance",
          },
        ],
      });
    }
    
    if (commandName === "DescribeTargetHealthCommand") {
      return Promise.resolve({
        TargetHealthDescriptions: [
          {
            Target: { Id: "i-1234567890abcdef0", Port: 80 },
            HealthCheckPort: "80",
            TargetHealth: { State: "healthy" },
          },
        ],
      });
    }
    
    if (commandName === "CreateLoadBalancerCommand") {
      return Promise.resolve({
        LoadBalancers: [
          {
            LoadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/new-alb/1234567890123456",
            LoadBalancerName: "new-alb",
            DNSName: "new-alb-1234567890.us-east-1.elb.amazonaws.com",
            Type: "application",
            State: { Code: "provisioning" },
          },
        ],
      });
    }
    
    if (commandName === "CreateTargetGroupCommand") {
      return Promise.resolve({
        TargetGroups: [
          {
            TargetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/new-tg/1234567890123456",
            TargetGroupName: "new-tg",
            Protocol: "HTTP",
            Port: 80,
            TargetType: "instance",
          },
        ],
      });
    }
    
    if (commandName === "DescribeListenersCommand") {
      return Promise.resolve({
        Listeners: [
          {
            ListenerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/1234567890123456/1234567890123456",
            LoadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/1234567890123456",
            Port: 80,
            Protocol: "HTTP",
            DefaultActions: [{ Type: "forward", TargetGroupArn: "arn:aws:elasticloadbalancing:..." }],
          },
        ],
      });
    }
    
    if (commandName === "CreateListenerCommand") {
      return Promise.resolve({
        Listeners: [
          {
            ListenerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/1234567890123456/new-listener",
            LoadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/1234567890123456",
            Port: 443,
            Protocol: "HTTPS",
          },
        ],
      });
    }
    
    return Promise.resolve({});
  });

  const MockELBClient = class {
    send = mockELBSend;
    destroy = vi.fn();
    constructor(public config: unknown) {}
  };

  const createCommand = (name: string) => vi.fn().mockImplementation((input) => ({ ...input, _commandName: name }));

  return {
    ElasticLoadBalancingV2Client: MockELBClient,
    CreateLoadBalancerCommand: createCommand("CreateLoadBalancerCommand"),
    DeleteLoadBalancerCommand: createCommand("DeleteLoadBalancerCommand"),
    DescribeLoadBalancersCommand: createCommand("DescribeLoadBalancersCommand"),
    CreateTargetGroupCommand: createCommand("CreateTargetGroupCommand"),
    DeleteTargetGroupCommand: createCommand("DeleteTargetGroupCommand"),
    DescribeTargetGroupsCommand: createCommand("DescribeTargetGroupsCommand"),
    RegisterTargetsCommand: createCommand("RegisterTargetsCommand"),
    DeregisterTargetsCommand: createCommand("DeregisterTargetsCommand"),
    DescribeTargetHealthCommand: createCommand("DescribeTargetHealthCommand"),
    CreateListenerCommand: createCommand("CreateListenerCommand"),
    DeleteListenerCommand: createCommand("DeleteListenerCommand"),
    DescribeListenersCommand: createCommand("DescribeListenersCommand"),
    ModifyLoadBalancerAttributesCommand: createCommand("ModifyLoadBalancerAttributesCommand"),
  };
});

// Mock CloudWatch client
vi.mock("@aws-sdk/client-cloudwatch", () => {
  const mockCloudWatchSend = vi.fn().mockImplementation(() => {
    return Promise.resolve({
      Datapoints: [
        {
          Timestamp: new Date("2024-01-15T10:00:00Z"),
          Average: 45.5,
          Maximum: 78.2,
          Minimum: 12.3,
          Sum: 455.0,
          SampleCount: 10,
          Unit: "Percent",
        },
        {
          Timestamp: new Date("2024-01-15T10:05:00Z"),
          Average: 52.1,
          Maximum: 85.0,
          Minimum: 15.5,
          Sum: 521.0,
          SampleCount: 10,
          Unit: "Percent",
        },
      ],
    });
  });

  const MockCloudWatchClient = class {
    send = mockCloudWatchSend;
    destroy = vi.fn();
    constructor(public config: unknown) {}
  };

  const createCommand = (name: string) => vi.fn().mockImplementation((input) => ({ ...input, _commandName: name }));

  return {
    CloudWatchClient: MockCloudWatchClient,
    GetMetricStatisticsCommand: createCommand("GetMetricStatisticsCommand"),
  };
});

describe("AWSEC2Manager", () => {
  let manager: AWSEC2Manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AWSEC2Manager(mockCredentialsManager);
  });

  describe("constructor", () => {
    it("should create with credentials manager", () => {
      const m = new AWSEC2Manager(mockCredentialsManager);
      expect(m).toBeInstanceOf(AWSEC2Manager);
    });

    it("should accept default region", () => {
      const m = new AWSEC2Manager(mockCredentialsManager, "eu-west-1");
      expect(m.getDefaultRegion()).toBe("eu-west-1");
    });

    it("should use us-east-1 as default region when not provided", () => {
      expect(manager.getDefaultRegion()).toBe("us-east-1");
    });
  });

  describe("instance lifecycle", () => {
    describe("listInstances", () => {
      it("should list instances", async () => {
        const instances = await manager.listInstances();
        expect(instances).toBeInstanceOf(Array);
        expect(instances.length).toBeGreaterThan(0);
      });

      it("should return instance with correct properties", async () => {
        const instances = await manager.listInstances();
        const instance = instances[0];
        expect(instance.instanceId).toBe("i-1234567890abcdef0");
        expect(instance.instanceType).toBe("t3.micro");
        expect(instance.state).toBe("running");
      });

      it("should filter by instance IDs", async () => {
        const instances = await manager.listInstances({
          instanceIds: ["i-1234567890abcdef0"],
        });
        expect(instances.length).toBeGreaterThan(0);
      });

      it("should filter by state", async () => {
        const instances = await manager.listInstances({
          states: ["running"],
        });
        expect(instances).toBeInstanceOf(Array);
      });

      it("should accept custom region", async () => {
        const instances = await manager.listInstances({
          region: "eu-west-1",
        });
        expect(instances).toBeInstanceOf(Array);
      });
    });

    describe("getInstance", () => {
      it("should get instance by ID", async () => {
        const instance = await manager.getInstance("i-1234567890abcdef0");
        expect(instance).not.toBeNull();
        expect(instance?.instanceId).toBe("i-1234567890abcdef0");
      });
    });

    describe("startInstances", () => {
      it("should start instances", async () => {
        const result = await manager.startInstances(["i-1234567890abcdef0"]);
        expect(result.success).toBe(true);
        expect(result.instanceIds).toContain("i-1234567890abcdef0");
      });

      it("should return state changes", async () => {
        const result = await manager.startInstances(["i-1234567890abcdef0"]);
        expect(result.stateChanges).toBeDefined();
        expect(result.stateChanges?.length).toBeGreaterThan(0);
      });
    });

    describe("stopInstances", () => {
      it("should stop instances", async () => {
        const result = await manager.stopInstances(["i-1234567890abcdef0"]);
        expect(result.success).toBe(true);
        expect(result.instanceIds).toContain("i-1234567890abcdef0");
      });

      it("should accept force option", async () => {
        const result = await manager.stopInstances(["i-1234567890abcdef0"], { force: true });
        expect(result.success).toBe(true);
      });
    });

    describe("terminateInstances", () => {
      it("should terminate instances", async () => {
        const result = await manager.terminateInstances(["i-1234567890abcdef0"]);
        expect(result.success).toBe(true);
        expect(result.instanceIds).toContain("i-1234567890abcdef0");
      });
    });

    describe("rebootInstances", () => {
      it("should reboot instances", async () => {
        const result = await manager.rebootInstances(["i-1234567890abcdef0"]);
        expect(result.success).toBe(true);
      });
    });
  });

  describe("instance creation", () => {
    describe("createInstances", () => {
      it("should create instances", async () => {
        const result = await manager.createInstances({
          imageId: "ami-12345678",
          instanceType: "t3.micro",
        });
        expect(result.success).toBe(true);
        expect(result.instanceIds.length).toBeGreaterThan(0);
      });

      it("should accept name tag", async () => {
        const result = await manager.createInstances({
          imageId: "ami-12345678",
          instanceType: "t3.micro",
          name: "my-instance",
        });
        expect(result.success).toBe(true);
      });

      it("should accept security groups", async () => {
        const result = await manager.createInstances({
          imageId: "ami-12345678",
          instanceType: "t3.micro",
          securityGroupIds: ["sg-12345678"],
        });
        expect(result.success).toBe(true);
      });

      it("should accept user data", async () => {
        const result = await manager.createInstances({
          imageId: "ami-12345678",
          instanceType: "t3.micro",
          userData: "#!/bin/bash\necho hello",
        });
        expect(result.success).toBe(true);
      });

      it("should accept launch template", async () => {
        const result = await manager.createInstances({
          imageId: "ami-12345678",
          instanceType: "t3.micro",
          launchTemplateId: "lt-1234567890abcdef0",
        });
        expect(result.success).toBe(true);
      });
    });
  });

  describe("launch templates", () => {
    describe("listLaunchTemplates", () => {
      it("should list launch templates", async () => {
        const templates = await manager.listLaunchTemplates();
        expect(templates).toBeInstanceOf(Array);
      });
    });

    describe("createLaunchTemplate", () => {
      it("should create launch template", async () => {
        const result = await manager.createLaunchTemplate({
          name: "new-template",
          imageId: "ami-12345678",
          instanceType: "t3.micro",
        });
        expect(result.success).toBe(true);
        expect(result.launchTemplate).toBeDefined();
      });
    });

    describe("deleteLaunchTemplate", () => {
      it("should delete launch template", async () => {
        const result = await manager.deleteLaunchTemplate("lt-1234567890abcdef0");
        expect(result.success).toBe(true);
      });
    });
  });

  describe("security groups", () => {
    describe("listSecurityGroups", () => {
      it("should list security groups", async () => {
        const groups = await manager.listSecurityGroups();
        expect(groups).toBeInstanceOf(Array);
        expect(groups.length).toBeGreaterThan(0);
      });

      it("should return security group with correct properties", async () => {
        const groups = await manager.listSecurityGroups();
        const group = groups[0];
        expect(group.groupId).toBe("sg-12345678");
        expect(group.groupName).toBe("web-sg");
        expect(group.inboundRules).toBeInstanceOf(Array);
        expect(group.outboundRules).toBeInstanceOf(Array);
      });
    });

    describe("getSecurityGroup", () => {
      it("should get security group by ID", async () => {
        const group = await manager.getSecurityGroup("sg-12345678");
        expect(group).not.toBeNull();
        expect(group?.groupId).toBe("sg-12345678");
      });
    });

    describe("createSecurityGroup", () => {
      it("should create security group", async () => {
        const result = await manager.createSecurityGroup({
          name: "new-sg",
          description: "New security group",
          vpcId: "vpc-12345678",
        });
        expect(result.success).toBe(true);
      });

      it("should accept inbound rules", async () => {
        const result = await manager.createSecurityGroup({
          name: "new-sg",
          description: "New security group",
          vpcId: "vpc-12345678",
          inboundRules: [
            {
              direction: "inbound",
              protocol: "tcp",
              fromPort: 22,
              toPort: 22,
              cidrIpv4: "0.0.0.0/0",
              description: "SSH",
            },
          ],
        });
        expect(result.success).toBe(true);
      });
    });

    describe("deleteSecurityGroup", () => {
      it("should delete security group", async () => {
        const result = await manager.deleteSecurityGroup("sg-12345678");
        expect(result.success).toBe(true);
      });
    });

    describe("authorizeSecurityGroupIngress", () => {
      it("should authorize inbound rules", async () => {
        const result = await manager.authorizeSecurityGroupIngress(
          "sg-12345678",
          [
            {
              direction: "inbound",
              protocol: "tcp",
              fromPort: 443,
              toPort: 443,
              cidrIpv4: "0.0.0.0/0",
            },
          ]
        );
        expect(result.success).toBe(true);
      });
    });

    describe("revokeSecurityGroupIngress", () => {
      it("should revoke inbound rules", async () => {
        const result = await manager.revokeSecurityGroupIngress(
          "sg-12345678",
          [
            {
              direction: "inbound",
              protocol: "tcp",
              fromPort: 80,
              toPort: 80,
              cidrIpv4: "0.0.0.0/0",
            },
          ]
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe("key pairs", () => {
    describe("listKeyPairs", () => {
      it("should list key pairs", async () => {
        const keyPairs = await manager.listKeyPairs();
        expect(keyPairs).toBeInstanceOf(Array);
        expect(keyPairs.length).toBeGreaterThan(0);
      });

      it("should return key pair with correct properties", async () => {
        const keyPairs = await manager.listKeyPairs();
        const keyPair = keyPairs[0];
        expect(keyPair.keyName).toBe("my-key");
        expect(keyPair.keyPairId).toBeDefined();
        expect(keyPair.keyFingerprint).toBeDefined();
      });
    });

    describe("createKeyPair", () => {
      it("should create key pair", async () => {
        const result = await manager.createKeyPair({
          name: "new-key",
        });
        expect(result.success).toBe(true);
        expect(result.keyPair).toBeDefined();
        expect(result.privateKeyMaterial).toBeDefined();
      });

      it("should accept key type", async () => {
        const result = await manager.createKeyPair({
          name: "new-key",
          keyType: "ed25519",
        });
        expect(result.success).toBe(true);
      });
    });

    describe("deleteKeyPair", () => {
      it("should delete key pair", async () => {
        const result = await manager.deleteKeyPair("my-key");
        expect(result.success).toBe(true);
      });
    });
  });

  describe("AMI management", () => {
    describe("listAMIs", () => {
      it("should list AMIs", async () => {
        const amis = await manager.listAMIs();
        expect(amis).toBeInstanceOf(Array);
      });

      it("should return AMI with correct properties", async () => {
        const amis = await manager.listAMIs();
        const ami = amis[0];
        expect(ami.imageId).toBe("ami-12345678");
        expect(ami.name).toBe("test-ami");
        expect(ami.state).toBe("available");
      });

      it("should filter by owners", async () => {
        const amis = await manager.listAMIs({
          owners: ["self"],
        });
        expect(amis).toBeInstanceOf(Array);
      });
    });

    describe("createAMI", () => {
      it("should create AMI from instance", async () => {
        const result = await manager.createAMI(
          "i-1234567890abcdef0",
          "my-ami"
        );
        expect(result.success).toBe(true);
        expect(result.imageId).toBeDefined();
      });

      it("should accept description", async () => {
        const result = await manager.createAMI(
          "i-1234567890abcdef0",
          "my-ami",
          { description: "My AMI description" }
        );
        expect(result.success).toBe(true);
      });

      it("should accept noReboot option", async () => {
        const result = await manager.createAMI(
          "i-1234567890abcdef0",
          "my-ami",
          { noReboot: true }
        );
        expect(result.success).toBe(true);
      });
    });

    describe("deregisterAMI", () => {
      it("should deregister AMI", async () => {
        const result = await manager.deregisterAMI("ami-12345678");
        expect(result.success).toBe(true);
      });
    });
  });

  describe("monitoring", () => {
    describe("enableMonitoring", () => {
      it("should enable detailed monitoring", async () => {
        const result = await manager.enableMonitoring(["i-1234567890abcdef0"]);
        expect(result.success).toBe(true);
      });
    });

    describe("disableMonitoring", () => {
      it("should disable detailed monitoring", async () => {
        const result = await manager.disableMonitoring(["i-1234567890abcdef0"]);
        expect(result.success).toBe(true);
      });
    });

    describe("getInstanceMetrics", () => {
      it("should get instance metrics", async () => {
        const metrics = await manager.getInstanceMetrics("i-1234567890abcdef0");
        expect(metrics.instanceId).toBe("i-1234567890abcdef0");
        expect(metrics.cpuUtilization).toBeInstanceOf(Array);
        expect(metrics.networkIn).toBeInstanceOf(Array);
        expect(metrics.networkOut).toBeInstanceOf(Array);
      });

      it("should accept time range options", async () => {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 3600000);
        const metrics = await manager.getInstanceMetrics("i-1234567890abcdef0", {
          startTime,
          endTime,
          period: 60,
        });
        expect(metrics).toBeDefined();
      });
    });
  });

  describe("auto scaling groups", () => {
    describe("listAutoScalingGroups", () => {
      it("should list auto scaling groups", async () => {
        const groups = await manager.listAutoScalingGroups();
        expect(groups).toBeInstanceOf(Array);
        expect(groups.length).toBeGreaterThan(0);
      });

      it("should return ASG with correct properties", async () => {
        const groups = await manager.listAutoScalingGroups();
        const group = groups[0];
        expect(group.autoScalingGroupName).toBe("test-asg");
        expect(group.minSize).toBe(1);
        expect(group.maxSize).toBe(5);
        expect(group.desiredCapacity).toBe(2);
      });
    });

    describe("createAutoScalingGroup", () => {
      it("should create auto scaling group", async () => {
        const result = await manager.createAutoScalingGroup({
          name: "new-asg",
          minSize: 1,
          maxSize: 5,
          desiredCapacity: 2,
          launchTemplate: {
            launchTemplateId: "lt-1234567890abcdef0",
            version: "$Latest",
          },
          availabilityZones: ["us-east-1a", "us-east-1b"],
        });
        expect(result.success).toBe(true);
      });
    });

    describe("updateAutoScalingGroup", () => {
      it("should update auto scaling group", async () => {
        const result = await manager.updateAutoScalingGroup("test-asg", {
          minSize: 2,
          maxSize: 10,
        });
        expect(result.success).toBe(true);
      });
    });

    describe("deleteAutoScalingGroup", () => {
      it("should delete auto scaling group", async () => {
        const result = await manager.deleteAutoScalingGroup("test-asg");
        expect(result.success).toBe(true);
      });

      it("should accept force delete option", async () => {
        const result = await manager.deleteAutoScalingGroup("test-asg", {
          forceDelete: true,
        });
        expect(result.success).toBe(true);
      });
    });

    describe("setDesiredCapacity", () => {
      it("should set desired capacity", async () => {
        const result = await manager.setDesiredCapacity("test-asg", 3);
        expect(result.success).toBe(true);
      });
    });

    describe("getScalingActivities", () => {
      it("should get scaling activities", async () => {
        const activities = await manager.getScalingActivities("test-asg");
        expect(activities).toBeInstanceOf(Array);
        expect(activities.length).toBeGreaterThan(0);
      });
    });
  });

  describe("load balancers", () => {
    describe("listLoadBalancers", () => {
      it("should list load balancers", async () => {
        const loadBalancers = await manager.listLoadBalancers();
        expect(loadBalancers).toBeInstanceOf(Array);
        expect(loadBalancers.length).toBeGreaterThan(0);
      });

      it("should return load balancer with correct properties", async () => {
        const loadBalancers = await manager.listLoadBalancers();
        const lb = loadBalancers[0];
        expect(lb.loadBalancerName).toBe("my-alb");
        expect(lb.type).toBe("application");
        expect(lb.scheme).toBe("internet-facing");
      });
    });

    describe("createLoadBalancer", () => {
      it("should create load balancer", async () => {
        const result = await manager.createLoadBalancer({
          name: "new-alb",
          subnets: ["subnet-12345678", "subnet-87654321"],
          securityGroups: ["sg-12345678"],
          scheme: "internet-facing",
          type: "application",
        });
        expect(result.success).toBe(true);
        expect(result.loadBalancer).toBeDefined();
      });
    });

    describe("deleteLoadBalancer", () => {
      it("should delete load balancer", async () => {
        const result = await manager.deleteLoadBalancer(
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/1234567890123456"
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe("target groups", () => {
    describe("listTargetGroups", () => {
      it("should list target groups", async () => {
        const targetGroups = await manager.listTargetGroups();
        expect(targetGroups).toBeInstanceOf(Array);
        expect(targetGroups.length).toBeGreaterThan(0);
      });

      it("should return target group with correct properties", async () => {
        const targetGroups = await manager.listTargetGroups();
        const tg = targetGroups[0];
        expect(tg.targetGroupName).toBe("my-tg");
        expect(tg.protocol).toBe("HTTP");
        expect(tg.port).toBe(80);
      });
    });

    describe("createTargetGroup", () => {
      it("should create target group", async () => {
        const result = await manager.createTargetGroup({
          name: "new-tg",
          protocol: "HTTP",
          port: 80,
          vpcId: "vpc-12345678",
          targetType: "instance",
        });
        expect(result.success).toBe(true);
        expect(result.targetGroup).toBeDefined();
      });
    });

    describe("deleteTargetGroup", () => {
      it("should delete target group", async () => {
        const result = await manager.deleteTargetGroup(
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890123456"
        );
        expect(result.success).toBe(true);
      });
    });

    describe("registerTargets", () => {
      it("should register targets", async () => {
        const result = await manager.registerTargets(
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890123456",
          [{ id: "i-1234567890abcdef0", port: 80 }]
        );
        expect(result.success).toBe(true);
      });
    });

    describe("deregisterTargets", () => {
      it("should deregister targets", async () => {
        const result = await manager.deregisterTargets(
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890123456",
          [{ id: "i-1234567890abcdef0" }]
        );
        expect(result.success).toBe(true);
      });
    });

    describe("getTargetHealth", () => {
      it("should get target health", async () => {
        const health = await manager.getTargetHealth(
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890123456"
        );
        expect(health).toBeInstanceOf(Array);
        expect(health.length).toBeGreaterThan(0);
        expect(health[0].targetHealth.state).toBe("healthy");
      });
    });
  });

  describe("listeners", () => {
    describe("listListeners", () => {
      it("should list listeners", async () => {
        const listeners = await manager.listListeners({
          loadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/1234567890123456",
        });
        expect(listeners).toBeInstanceOf(Array);
      });
    });

    describe("createListener", () => {
      it("should create listener", async () => {
        const result = await manager.createListener({
          loadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/1234567890123456",
          protocol: "HTTP",
          port: 80,
          defaultActions: [
            {
              type: "forward",
              targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890123456",
            },
          ],
        });
        expect(result.success).toBe(true);
        expect(result.listener).toBeDefined();
      });
    });

    describe("deleteListener", () => {
      it("should delete listener", async () => {
        const result = await manager.deleteListener(
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/1234567890123456/1234567890123456"
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe("tags", () => {
    describe("addTags", () => {
      it("should add tags to resources", async () => {
        const result = await manager.addTags(
          ["i-1234567890abcdef0"],
          { Environment: "production", Project: "MyProject" }
        );
        expect(result.success).toBe(true);
      });
    });

    describe("removeTags", () => {
      it("should remove tags from resources", async () => {
        const result = await manager.removeTags(
          ["i-1234567890abcdef0"],
          ["TempTag"]
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe("utility", () => {
    describe("setDefaultRegion", () => {
      it("should set default region", () => {
        manager.setDefaultRegion("eu-west-1");
        expect(manager.getDefaultRegion()).toBe("eu-west-1");
      });
    });

    describe("getDefaultRegion", () => {
      it("should get default region", () => {
        expect(manager.getDefaultRegion()).toBe("us-east-1");
      });
    });
  });
});

describe("createEC2Manager", () => {
  it("should create an EC2 manager instance", () => {
    const manager = createEC2Manager(mockCredentialsManager);
    expect(manager).toBeInstanceOf(AWSEC2Manager);
  });

  it("should pass default region to the manager", () => {
    const manager = createEC2Manager(mockCredentialsManager, "eu-west-1");
    expect(manager.getDefaultRegion()).toBe("eu-west-1");
  });
});
