/**
 * AWS Core Services Extension - Espada Plugin Entry Point
 *
 * This is the main plugin entry point that registers AWS services
 * with the Espada ecosystem, providing CLI commands and gateway methods
 * for AWS infrastructure management.
 */

// Define CLI command type
interface CliCommand {
  command(name: string): CliCommand;
  description(desc: string): CliCommand;
  option(flags: string, desc: string, defaultValue?: unknown): CliCommand;
  action(fn: (...args: unknown[]) => Promise<void>): CliCommand;
}

interface CliContext {
  program: {
    command(name: string): CliCommand;
  };
}

// Plugin API type for Espada integration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EspadaPluginApi = any;

import {
  createCredentialsManager,
  createContextManager,
  createServiceDiscovery,
  createTaggingManager,
  createCloudTrailManager,
  createEC2Manager,
  createCLIWrapper,
  createIaCManager,
  createCostManager,
  type AWSCredentialsManager,
  type AWSContextManager,
  type AWSServiceDiscovery,
  type AWSTaggingManager,
  type AWSCloudTrailManager,
  type AWSEC2Manager,
  type AWSCLIWrapper,
  type IaCManager,
  type CostManager,
  type InfrastructureTemplate,
  type AWSResourceType,
  TemplateVariable,
  TemplateOutput,
} from "./src/index.js";

import {
  createRDSManager,
  type RDSManager,
} from "./src/rds/index.js";

import {
  createLambdaManager,
  type LambdaManager,
  type LambdaRuntime,
} from "./src/lambda/index.js";

import {
  createS3Manager,
  type S3Manager,
} from "./src/s3/index.js";

import {
  createSecurityManager,
  type SecurityManager,
} from "./src/security/index.js";

// Global instances
let credentialsManager: AWSCredentialsManager | null = null;
let contextManager: AWSContextManager | null = null;
let serviceDiscovery: AWSServiceDiscovery | null = null;
let taggingManager: AWSTaggingManager | null = null;
let cloudTrailManager: AWSCloudTrailManager | null = null;
let ec2Manager: AWSEC2Manager | null = null;
let rdsManager: RDSManager | null = null;
let lambdaManager: LambdaManager | null = null;
let s3Manager: S3Manager | null = null;
let iacManager: IaCManager | null = null;
let costManager: CostManager | null = null;
let securityManager: SecurityManager | null = null;
let cliWrapper: AWSCLIWrapper | null = null;

/**
 * AWS plugin configuration schema
 */
const configSchema = {
  safeParse(value: unknown) {
    if (value === undefined || value === null) {
      return { success: true, data: getDefaultConfig() };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      return {
        success: false,
        error: { issues: [{ path: [], message: "expected config object" }] },
      };
    }
    return { success: true, data: value as AWSPluginConfig };
  },
  jsonSchema: {
    type: "object",
    properties: {
      defaultRegion: {
        type: "string",
        description: "Default AWS region",
        default: "us-east-1",
      },
      defaultProfile: {
        type: "string",
        description: "Default AWS profile name",
      },
      credentialSources: {
        type: "array",
        items: { type: "string" },
        description: "Credential sources in order of preference",
      },
      tagConfig: {
        type: "object",
        description: "Standard tag configuration",
        properties: {
          requiredTags: {
            type: "array",
            items: { type: "string" },
            description: "Tags that must be present on all resources",
          },
          optionalTags: {
            type: "array",
            items: { type: "string" },
            description: "Tags that are optional but recommended",
          },
        },
      },
      defaultTags: {
        type: "array",
        description: "Default tags to apply to all resources",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            value: { type: "string" },
          },
        },
      },
    },
  },
  uiHints: {
    defaultRegion: {
      label: "Default Region",
      help: "The default AWS region to use for operations",
      advanced: false,
    },
    defaultProfile: {
      label: "Default Profile",
      help: "The default AWS profile from ~/.aws/credentials",
      advanced: false,
    },
    credentialSources: {
      label: "Credential Sources",
      help: "Order of credential sources to try (profile, environment, sso, instance)",
      advanced: true,
    },
    tagConfig: {
      label: "Tag Configuration",
      help: "Configure required and optional tags for resources",
      advanced: true,
    },
    defaultTags: {
      label: "Default Tags",
      help: "Tags to apply to all created resources",
      advanced: true,
    },
  },
};

interface AWSPluginConfig {
  defaultRegion?: string;
  defaultProfile?: string;
  credentialSources?: string[];
  tagConfig?: {
    requiredTags?: string[];
    optionalTags?: string[];
  };
  defaultTags?: Array<{ key: string; value: string }>;
}

function getDefaultConfig(): AWSPluginConfig {
  return {
    defaultRegion: "us-east-1",
  };
}

/**
 * AWS plugin definition
 */
const plugin = {
  id: "aws",
  name: "AWS Core Services",
  description: "Comprehensive AWS infrastructure management with EC2, IAM, CloudTrail, and more",
  version: "1.0.0",
  configSchema,

  async register(api: EspadaPluginApi) {
    console.log("[AWS] Registering AWS extension");

    // Get plugin configuration
    const config = (api.pluginConfig as AWSPluginConfig) ?? getDefaultConfig();

    // Initialize credentials manager
    credentialsManager = createCredentialsManager({
      defaultProfile: config.defaultProfile,
      defaultRegion: config.defaultRegion,
    });

    // Initialize CLI wrapper
    cliWrapper = createCLIWrapper({
      defaultOptions: {
        profile: config.defaultProfile,
        region: config.defaultRegion,
      },
    });

    // Initialize context manager
    contextManager = createContextManager(credentialsManager);

    // Initialize service discovery
    serviceDiscovery = createServiceDiscovery(credentialsManager);

    // Initialize tagging manager
    const tagConfigConverted = config.tagConfig ? {
      required: (config.tagConfig.requiredTags ?? []).map(k => ({ key: k, value: "" })),
      optional: (config.tagConfig.optionalTags ?? []).map(k => ({ key: k, value: "" })),
      prohibited: [] as string[],
    } : undefined;
    
    const defaultTagsConverted = config.defaultTags?.map(t => ({
      key: t.key,
      value: t.value,
    }));
    
    taggingManager = createTaggingManager(
      credentialsManager,
      tagConfigConverted,
      defaultTagsConverted,
    );

    // Initialize CloudTrail manager
    cloudTrailManager = createCloudTrailManager(
      credentialsManager,
      config.defaultRegion,
    );

    // Initialize EC2 manager
    ec2Manager = createEC2Manager(
      credentialsManager,
      config.defaultRegion,
    );

    // Initialize RDS manager
    rdsManager = createRDSManager({
      region: config.defaultRegion,
    });

    // Initialize Lambda manager
    lambdaManager = createLambdaManager({
      region: config.defaultRegion,
    });

    // Initialize S3 manager
    s3Manager = createS3Manager({
      region: config.defaultRegion,
    });

    // Initialize IaC manager
    iacManager = createIaCManager({
      defaultRegion: config.defaultRegion,
      defaultTags: config.defaultTags?.reduce((acc, t) => ({ ...acc, [t.key]: t.value }), {}),
    });

    // Initialize Cost manager
    costManager = createCostManager({
      defaultRegion: config.defaultRegion,
    });

    // Register CLI commands
    api.registerCli(
      (ctx: CliContext) => {
        const aws = ctx.program
          .command("aws")
          .description("AWS infrastructure management");

        // EC2 commands
        const ec2Cmd = aws
          .command("ec2")
          .description("EC2 instance management");

        ec2Cmd
          .command("list")
          .description("List EC2 instances")
          .option("--region <region>", "AWS region")
          .option("--state <state>", "Filter by instance state (running, stopped, etc.)")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string; state?: string };
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const instances = await ec2Manager.listInstances({
                region: options.region,
                states: options.state ? [options.state as "running" | "stopped" | "pending" | "terminated"] : undefined,
              });

              if (instances.length === 0) {
                console.log("No EC2 instances found");
                return;
              }

              console.log("\nEC2 Instances:\n");
              for (const instance of instances) {
                const name = instance.tags?.["Name"] ?? "unnamed";
                console.log(`  ${instance.instanceId} (${name})`);
                console.log(`    Type: ${instance.instanceType}`);
                console.log(`    State: ${instance.state}`);
                console.log(`    Public IP: ${instance.publicIpAddress ?? "none"}`);
                console.log(`    Private IP: ${instance.privateIpAddress ?? "none"}`);
                console.log();
              }
            } catch (error) {
              console.error("Failed to list instances:", error);
            }
          });

        ec2Cmd
          .command("start <instanceIds...>")
          .description("Start EC2 instances")
          .option("--region <region>", "AWS region")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string };
            const instanceIds = args.slice(0, -1).flat() as string[];
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const result = await ec2Manager.startInstances(instanceIds, { region: options.region });
              if (result.success) {
                console.log(`Started instances: ${result.instanceIds.join(", ")}`);
              } else {
                console.error(`Failed to start instances: ${result.error}`);
              }
            } catch (error) {
              console.error("Failed to start instances:", error);
            }
          });

        ec2Cmd
          .command("stop <instanceIds...>")
          .description("Stop EC2 instances")
          .option("--region <region>", "AWS region")
          .option("--force", "Force stop")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string; force?: boolean };
            const instanceIds = args.slice(0, -1).flat() as string[];
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const result = await ec2Manager.stopInstances(instanceIds, {
                region: options.region,
                force: options.force,
              });
              if (result.success) {
                console.log(`Stopped instances: ${result.instanceIds.join(", ")}`);
              } else {
                console.error(`Failed to stop instances: ${result.error}`);
              }
            } catch (error) {
              console.error("Failed to stop instances:", error);
            }
          });

        ec2Cmd
          .command("terminate <instanceIds...>")
          .description("Terminate EC2 instances")
          .option("--region <region>", "AWS region")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string };
            const instanceIds = args.slice(0, -1).flat() as string[];
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const result = await ec2Manager.terminateInstances(instanceIds, { region: options.region });
              if (result.success) {
                console.log(`Terminated instances: ${result.instanceIds.join(", ")}`);
              } else {
                console.error(`Failed to terminate instances: ${result.error}`);
              }
            } catch (error) {
              console.error("Failed to terminate instances:", error);
            }
          });

        // Security Group commands
        const sgCmd = aws
          .command("sg")
          .description("Security group management");

        sgCmd
          .command("list")
          .description("List security groups")
          .option("--region <region>", "AWS region")
          .option("--vpc <vpcId>", "Filter by VPC ID")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string; vpc?: string };
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const groups = await ec2Manager.listSecurityGroups({
                region: options.region,
                filters: options.vpc ? { "vpc-id": [options.vpc] } : undefined,
              });

              if (groups.length === 0) {
                console.log("No security groups found");
                return;
              }

              console.log("\nSecurity Groups:\n");
              for (const group of groups) {
                console.log(`  ${group.groupId} (${group.groupName})`);
                console.log(`    VPC: ${group.vpcId ?? "EC2-Classic"}`);
                console.log(`    Description: ${group.description}`);
                console.log(`    Inbound Rules: ${group.inboundRules.length}`);
                console.log(`    Outbound Rules: ${group.outboundRules.length}`);
                console.log();
              }
            } catch (error) {
              console.error("Failed to list security groups:", error);
            }
          });

        // Key Pair commands
        const keyCmd = aws
          .command("keypair")
          .description("Key pair management");

        keyCmd
          .command("list")
          .description("List key pairs")
          .option("--region <region>", "AWS region")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string };
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const keyPairs = await ec2Manager.listKeyPairs({ region: options.region });

              if (keyPairs.length === 0) {
                console.log("No key pairs found");
                return;
              }

              console.log("\nKey Pairs:\n");
              for (const kp of keyPairs) {
                console.log(`  ${kp.keyName}`);
                console.log(`    ID: ${kp.keyPairId}`);
                console.log(`    Type: ${kp.keyType}`);
                console.log(`    Fingerprint: ${kp.keyFingerprint}`);
                console.log();
              }
            } catch (error) {
              console.error("Failed to list key pairs:", error);
            }
          });

        // Auto Scaling commands
        const asgCmd = aws
          .command("asg")
          .description("Auto Scaling group management");

        asgCmd
          .command("list")
          .description("List Auto Scaling groups")
          .option("--region <region>", "AWS region")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string };
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const groups = await ec2Manager.listAutoScalingGroups({ region: options.region });

              if (groups.length === 0) {
                console.log("No Auto Scaling groups found");
                return;
              }

              console.log("\nAuto Scaling Groups:\n");
              for (const group of groups) {
                console.log(`  ${group.autoScalingGroupName}`);
                console.log(`    Min/Max/Desired: ${group.minSize}/${group.maxSize}/${group.desiredCapacity}`);
                console.log(`    Instances: ${group.instances?.length ?? 0}`);
                console.log(`    Health Check: ${group.healthCheckType}`);
                console.log();
              }
            } catch (error) {
              console.error("Failed to list Auto Scaling groups:", error);
            }
          });

        asgCmd
          .command("scale <name> <capacity>")
          .description("Set desired capacity for an Auto Scaling group")
          .option("--region <region>", "AWS region")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string };
            const name = args[0] as string;
            const capacity = args[1] as string;
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const result = await ec2Manager.setDesiredCapacity(name, parseInt(capacity, 10), {
                region: options.region,
              });
              if (result.success) {
                console.log(`Set desired capacity for ${name} to ${capacity}`);
              } else {
                console.error(`Failed to set capacity: ${result.error}`);
              }
            } catch (error) {
              console.error("Failed to set desired capacity:", error);
            }
          });

        // Load Balancer commands
        const elbCmd = aws
          .command("elb")
          .description("Elastic Load Balancer management");

        elbCmd
          .command("list")
          .description("List load balancers")
          .option("--region <region>", "AWS region")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string };
            if (!ec2Manager) {
              console.error("EC2 manager not initialized");
              return;
            }

            try {
              const loadBalancers = await ec2Manager.listLoadBalancers({ region: options.region });

              if (loadBalancers.length === 0) {
                console.log("No load balancers found");
                return;
              }

              console.log("\nLoad Balancers:\n");
              for (const lb of loadBalancers) {
                console.log(`  ${lb.loadBalancerName}`);
                console.log(`    ARN: ${lb.loadBalancerArn}`);
                console.log(`    Type: ${lb.type}`);
                console.log(`    Scheme: ${lb.scheme}`);
                console.log(`    State: ${lb.state}`);
                console.log(`    DNS: ${lb.dnsName}`);
                console.log();
              }
            } catch (error) {
              console.error("Failed to list load balancers:", error);
            }
          });

        // Context/Identity commands
        aws
          .command("whoami")
          .description("Show current AWS identity")
          .action(async () => {
            if (!contextManager) {
              console.error("Context manager not initialized");
              return;
            }

            try {
              const context = contextManager.getContext();
              if (!context) {
                // Try to initialize context
                await contextManager.initialize();
                const newContext = contextManager.getContext();
                if (!newContext) {
                  console.log("No AWS context available. Check your credentials.");
                  return;
                }
                console.log("\nAWS Identity:\n");
                console.log(`  Account: ${newContext.accountId}`);
                console.log(`  Region: ${newContext.region}`);
                console.log(`  Profile: ${newContext.profile ?? "default"}`);
                return;
              }

              console.log("\nAWS Identity:\n");
              console.log(`  Account: ${context.accountId}`);
              console.log(`  Region: ${context.region}`);
              console.log(`  Profile: ${context.profile ?? "default"}`);
            } catch (error) {
              console.error("Failed to get AWS identity:", error);
            }
          });

        // Service Discovery commands
        aws
          .command("services")
          .description("List discovered AWS services")
          .option("--region <region>", "AWS region")
          .action(async (...args: unknown[]) => {
            const _options = (args[args.length - 1] ?? {}) as { region?: string };
            if (!serviceDiscovery) {
              console.error("Service discovery not initialized");
              return;
            }

            try {
              const result = await serviceDiscovery.discover();

              if (result.services.length === 0) {
                console.log("No AWS services discovered");
                return;
              }

              console.log("\nDiscovered AWS Services:\n");
              for (const service of result.services) {
                console.log(`  ${service.serviceName} (${service.serviceCode})`);
                console.log(`    Category: ${service.category}`);
                console.log(`    Regions: ${service.regions?.length ?? 0} available`);
                console.log();
              }
            } catch (error) {
              console.error("Failed to discover services:", error);
            }
          });

        // CloudTrail commands
        const trailCmd = aws
          .command("cloudtrail")
          .description("CloudTrail audit management");

        trailCmd
          .command("events")
          .description("List recent CloudTrail events")
          .option("--region <region>", "AWS region")
          .option("--limit <limit>", "Maximum number of events", "20")
          .action(async (...args: unknown[]) => {
            const options = (args[args.length - 1] ?? {}) as { region?: string; limit?: string };
            if (!cloudTrailManager) {
              console.error("CloudTrail manager not initialized");
              return;
            }

            try {
              const events = await cloudTrailManager.queryEvents({
                region: options.region,
                maxResults: parseInt(options.limit ?? "20", 10),
              });

              if (events.length === 0) {
                console.log("No CloudTrail events found");
                return;
              }

              console.log("\nCloudTrail Events:\n");
              for (const event of events.slice(0, 20)) {
                console.log(`  ${event.eventTime?.toISOString()} - ${event.eventName}`);
                console.log(`    Source: ${event.eventSource}`);
                console.log(`    User: ${event.userIdentity?.userName ?? event.userIdentity?.arn ?? "unknown"}`);
                console.log();
              }
            } catch (error) {
              console.error("Failed to list CloudTrail events:", error);
            }
          });
      },
      { commands: ["aws"] },
    );

    // Register gateway methods for programmatic access
    api.registerGatewayMethod("aws/identity", async () => {
      if (!contextManager) {
        return { success: false, error: "Context manager not initialized" };
      }
      try {
        await contextManager.initialize();
        const context = contextManager.getContext();
        return { success: true, data: context };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/ec2/instances", async (params: { region?: string; states?: string[] }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const instances = await ec2Manager.listInstances({
          region: params.region,
          states: params.states as ("running" | "stopped" | "pending" | "terminated")[],
        });
        return { success: true, data: instances };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/ec2/start", async (params: { instanceIds: string[]; region?: string }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const result = await ec2Manager.startInstances(params.instanceIds, { region: params.region });
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/ec2/stop", async (params: { instanceIds: string[]; region?: string; force?: boolean }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const result = await ec2Manager.stopInstances(params.instanceIds, {
          region: params.region,
          force: params.force,
        });
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/ec2/terminate", async (params: { instanceIds: string[]; region?: string }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const result = await ec2Manager.terminateInstances(params.instanceIds, { region: params.region });
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/ec2/security-groups", async (params: { region?: string; vpcId?: string }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const groups = await ec2Manager.listSecurityGroups({
          region: params.region,
          filters: params.vpcId ? { "vpc-id": [params.vpcId] } : undefined,
        });
        return { success: true, data: groups };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/ec2/key-pairs", async (params: { region?: string }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const keyPairs = await ec2Manager.listKeyPairs({ region: params.region });
        return { success: true, data: keyPairs };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/asg/list", async (params: { region?: string }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const groups = await ec2Manager.listAutoScalingGroups({ region: params.region });
        return { success: true, data: groups };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/asg/scale", async (params: { name: string; capacity: number; region?: string }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const result = await ec2Manager.setDesiredCapacity(params.name, params.capacity, {
          region: params.region,
        });
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/elb/list", async (params: { region?: string }) => {
      if (!ec2Manager) {
        return { success: false, error: "EC2 manager not initialized" };
      }
      try {
        const loadBalancers = await ec2Manager.listLoadBalancers({ region: params.region });
        return { success: true, data: loadBalancers };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/services", async (_params: { region?: string }) => {
      if (!serviceDiscovery) {
        return { success: false, error: "Service discovery not initialized" };
      }
      try {
        const result = await serviceDiscovery.discover();
        return { success: true, data: result.services };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    api.registerGatewayMethod("aws/cloudtrail/events", async (params: { region?: string; limit?: number }) => {
      if (!cloudTrailManager) {
        return { success: false, error: "CloudTrail manager not initialized" };
      }
      try {
        const events = await cloudTrailManager.queryEvents({
          region: params.region,
          maxResults: params.limit ?? 20,
        });
        return { success: true, data: events };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    // ========================================================================
    // Agent Tools - Allows AI agents to perform AWS operations via prompts
    // ========================================================================

    // EC2 Instance Management Tool
    api.registerTool(
      {
        name: "aws_ec2",
        label: "AWS EC2 Management",
        description:
          "Manage AWS EC2 instances. List, start, stop, reboot, or terminate instances. Use this tool to manage your cloud compute resources.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "start", "stop", "reboot", "terminate", "describe"],
              description: "Action to perform",
            },
            instanceIds: {
              type: "array",
              items: { type: "string" },
              description: "Instance IDs (required for start/stop/reboot/terminate/describe)",
            },
            region: {
              type: "string",
              description: "AWS region (optional, uses default if not specified)",
            },
            state: {
              type: "string",
              enum: ["running", "stopped", "pending", "terminated"],
              description: "Filter by state (for list action)",
            },
            force: {
              type: "boolean",
              description: "Force stop (for stop action)",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!ec2Manager) {
            return {
              content: [{ type: "text", text: "Error: EC2 manager not initialized. Check AWS credentials." }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const instanceIds = params.instanceIds as string[] | undefined;
          const region = params.region as string | undefined;
          const state = params.state as "running" | "stopped" | "pending" | "terminated" | undefined;
          const force = params.force as boolean | undefined;

          try {
            switch (action) {
              case "list": {
                const instances = await ec2Manager.listInstances({
                  region,
                  states: state ? [state] : undefined,
                });

                if (instances.length === 0) {
                  return {
                    content: [{ type: "text", text: "No EC2 instances found." }],
                    details: { count: 0, instances: [] },
                  };
                }

                const summary = instances.map(i => 
                  `• ${i.instanceId} (${i.tags?.["Name"] ?? "unnamed"}) - ${i.instanceType} - ${i.state} - ${i.publicIpAddress ?? "no public IP"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${instances.length} EC2 instances:\n\n${summary}` }],
                  details: { count: instances.length, instances },
                };
              }

              case "describe": {
                if (!instanceIds?.length) {
                  return {
                    content: [{ type: "text", text: "Error: instanceIds required for describe action" }],
                    details: { error: "missing_instance_ids" },
                  };
                }
                const instance = await ec2Manager.getInstance(instanceIds[0], region);
                if (!instance) {
                  return {
                    content: [{ type: "text", text: `Instance ${instanceIds[0]} not found` }],
                    details: { error: "not_found" },
                  };
                }
                return {
                  content: [{ type: "text", text: `Instance ${instance.instanceId}:\n• Name: ${instance.tags?.["Name"] ?? "unnamed"}\n• Type: ${instance.instanceType}\n• State: ${instance.state}\n• Public IP: ${instance.publicIpAddress ?? "none"}\n• Private IP: ${instance.privateIpAddress ?? "none"}\n• VPC: ${instance.vpcId ?? "none"}\n• Launched: ${instance.launchTime?.toISOString() ?? "unknown"}` }],
                  details: { instance },
                };
              }

              case "start": {
                if (!instanceIds?.length) {
                  return {
                    content: [{ type: "text", text: "Error: instanceIds required for start action" }],
                    details: { error: "missing_instance_ids" },
                  };
                }
                const result = await ec2Manager.startInstances(instanceIds, { region });
                return {
                  content: [{ type: "text", text: result.success ? `Started instances: ${result.instanceIds.join(", ")}` : `Failed to start: ${result.error}` }],
                  details: result,
                };
              }

              case "stop": {
                if (!instanceIds?.length) {
                  return {
                    content: [{ type: "text", text: "Error: instanceIds required for stop action" }],
                    details: { error: "missing_instance_ids" },
                  };
                }
                const result = await ec2Manager.stopInstances(instanceIds, { region, force });
                return {
                  content: [{ type: "text", text: result.success ? `Stopped instances: ${result.instanceIds.join(", ")}` : `Failed to stop: ${result.error}` }],
                  details: result,
                };
              }

              case "reboot": {
                if (!instanceIds?.length) {
                  return {
                    content: [{ type: "text", text: "Error: instanceIds required for reboot action" }],
                    details: { error: "missing_instance_ids" },
                  };
                }
                const result = await ec2Manager.rebootInstances(instanceIds, { region });
                return {
                  content: [{ type: "text", text: result.success ? `Rebooted instances: ${result.instanceIds.join(", ")}` : `Failed to reboot: ${result.error}` }],
                  details: result,
                };
              }

              case "terminate": {
                if (!instanceIds?.length) {
                  return {
                    content: [{ type: "text", text: "Error: instanceIds required for terminate action" }],
                    details: { error: "missing_instance_ids" },
                  };
                }
                const result = await ec2Manager.terminateInstances(instanceIds, { region });
                return {
                  content: [{ type: "text", text: result.success ? `Terminated instances: ${result.instanceIds.join(", ")}` : `Failed to terminate: ${result.error}` }],
                  details: result,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `AWS EC2 error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_ec2" },
    );

    // Security Group Management Tool
    api.registerTool(
      {
        name: "aws_security_group",
        label: "AWS Security Groups",
        description:
          "Manage AWS security groups. List security groups, view rules, create or delete groups, and modify inbound/outbound rules.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "describe", "create", "delete", "add_rule", "remove_rule"],
              description: "Action to perform",
            },
            groupId: {
              type: "string",
              description: "Security group ID (for describe/delete/add_rule/remove_rule)",
            },
            name: {
              type: "string",
              description: "Security group name (for create)",
            },
            description: {
              type: "string",
              description: "Security group description (for create)",
            },
            vpcId: {
              type: "string",
              description: "VPC ID (for create/list filter)",
            },
            region: {
              type: "string",
              description: "AWS region",
            },
            rule: {
              type: "object",
              description: "Rule definition for add_rule/remove_rule",
              properties: {
                direction: { type: "string", enum: ["inbound", "outbound"] },
                protocol: { type: "string" },
                fromPort: { type: "number" },
                toPort: { type: "number" },
                cidrIp: { type: "string" },
              },
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!ec2Manager) {
            return {
              content: [{ type: "text", text: "Error: EC2 manager not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const region = params.region as string | undefined;

          try {
            switch (action) {
              case "list": {
                const vpcId = params.vpcId as string | undefined;
                const groups = await ec2Manager.listSecurityGroups({
                  region,
                  filters: vpcId ? { "vpc-id": [vpcId] } : undefined,
                });

                if (groups.length === 0) {
                  return {
                    content: [{ type: "text", text: "No security groups found." }],
                    details: { count: 0, groups: [] },
                  };
                }

                const summary = groups.map(g => 
                  `• ${g.groupId} (${g.groupName}) - ${g.inboundRules.length} inbound, ${g.outboundRules.length} outbound rules`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${groups.length} security groups:\n\n${summary}` }],
                  details: { count: groups.length, groups },
                };
              }

              case "describe": {
                const groupId = params.groupId as string | undefined;
                if (!groupId) {
                  return {
                    content: [{ type: "text", text: "Error: groupId required for describe" }],
                    details: { error: "missing_group_id" },
                  };
                }
                const group = await ec2Manager.getSecurityGroup(groupId, region);
                if (!group) {
                  return {
                    content: [{ type: "text", text: `Security group ${groupId} not found` }],
                    details: { error: "not_found" },
                  };
                }

                const inboundRules = group.inboundRules.map(r => 
                  `  - ${r.protocol}:${r.fromPort}-${r.toPort} from ${r.cidrIpv4 ?? r.cidrIpv6 ?? "security group"}`
                ).join("\n");
                const outboundRules = group.outboundRules.map(r => 
                  `  - ${r.protocol}:${r.fromPort}-${r.toPort} to ${r.cidrIpv4 ?? r.cidrIpv6 ?? "security group"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Security Group ${group.groupId} (${group.groupName}):\n• VPC: ${group.vpcId ?? "EC2-Classic"}\n• Description: ${group.description}\n\nInbound Rules:\n${inboundRules || "  (none)"}\n\nOutbound Rules:\n${outboundRules || "  (none)"}` }],
                  details: { group },
                };
              }

              case "create": {
                const name = params.name as string | undefined;
                const description = params.description as string | undefined;
                const vpcId = params.vpcId as string | undefined;
                if (!name) {
                  return {
                    content: [{ type: "text", text: "Error: name required for create" }],
                    details: { error: "missing_name" },
                  };
                }
                const result = await ec2Manager.createSecurityGroup({
                  name,
                  description: description ?? `Security group: ${name}`,
                  vpcId,
                  region,
                });
                return {
                  content: [{ type: "text", text: result.success ? `Created security group: ${result.securityGroup?.groupId}` : `Failed: ${result.error}` }],
                  details: result,
                };
              }

              case "delete": {
                const groupId = params.groupId as string | undefined;
                if (!groupId) {
                  return {
                    content: [{ type: "text", text: "Error: groupId required for delete" }],
                    details: { error: "missing_group_id" },
                  };
                }
                const result = await ec2Manager.deleteSecurityGroup(groupId, region);
                return {
                  content: [{ type: "text", text: result.success ? `Deleted security group: ${groupId}` : `Failed: ${result.error}` }],
                  details: result,
                };
              }

              case "add_rule": {
                const groupId = params.groupId as string | undefined;
                const rule = params.rule as { direction?: string; protocol?: string; fromPort?: number; toPort?: number; cidrIp?: string } | undefined;
                if (!groupId || !rule) {
                  return {
                    content: [{ type: "text", text: "Error: groupId and rule required for add_rule" }],
                    details: { error: "missing_params" },
                  };
                }
                const ruleConfig = {
                  direction: (rule.direction === "outbound" ? "outbound" : "inbound") as "inbound" | "outbound",
                  protocol: rule.protocol ?? "tcp",
                  fromPort: rule.fromPort ?? 0,
                  toPort: rule.toPort ?? 65535,
                  cidrIpv4: rule.cidrIp ?? "0.0.0.0/0",
                };
                const result = await ec2Manager.authorizeSecurityGroupIngress(groupId, [ruleConfig], region);
                return {
                  content: [{ type: "text", text: result.success ? `Added rule to ${groupId}` : `Failed: ${result.error}` }],
                  details: result,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `AWS Security Group error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_security_group" },
    );

    // CloudTrail Audit Tool
    api.registerTool(
      {
        name: "aws_cloudtrail",
        label: "AWS CloudTrail",
        description:
          "Query AWS CloudTrail for audit events, security changes, and infrastructure modifications. Useful for security auditing and compliance.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["query", "security_events", "infrastructure_events", "user_events", "audit_summary"],
              description: "Type of query to perform",
            },
            username: {
              type: "string",
              description: "Filter by IAM username (for user_events)",
            },
            eventName: {
              type: "string",
              description: "Filter by event name (e.g., 'RunInstances', 'CreateBucket')",
            },
            hours: {
              type: "number",
              description: "Look back N hours (default: 24)",
            },
            limit: {
              type: "number",
              description: "Max results (default: 20)",
            },
            region: {
              type: "string",
              description: "AWS region",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!cloudTrailManager) {
            return {
              content: [{ type: "text", text: "Error: CloudTrail manager not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const region = params.region as string | undefined;
          const hours = (params.hours as number) ?? 24;
          const limit = (params.limit as number) ?? 20;
          const endTime = new Date();
          const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

          try {
            switch (action) {
              case "query": {
                const eventName = params.eventName as string | undefined;
                const events = await cloudTrailManager.queryEvents({
                  region,
                  startTime,
                  endTime,
                  eventName,
                  maxResults: limit,
                });

                if (events.length === 0) {
                  return {
                    content: [{ type: "text", text: "No CloudTrail events found." }],
                    details: { count: 0, events: [] },
                  };
                }

                const summary = events.slice(0, 10).map(e => 
                  `• ${e.eventTime?.toISOString() ?? "unknown"} - ${e.eventName} by ${e.userIdentity?.userName ?? e.userIdentity?.type ?? "unknown"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${events.length} events (showing first 10):\n\n${summary}` }],
                  details: { count: events.length, events },
                };
              }

              case "security_events": {
                const events = await cloudTrailManager.getSecurityEvents({
                  region,
                  startTime,
                  endTime,
                });

                if (events.length === 0) {
                  return {
                    content: [{ type: "text", text: "No security events found." }],
                    details: { count: 0, events: [] },
                  };
                }

                const summary = events.slice(0, 10).map(e => 
                  `• ${e.eventTime?.toISOString() ?? "unknown"} - ${e.eventName} by ${e.userIdentity?.userName ?? "unknown"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${events.length} security events:\n\n${summary}` }],
                  details: { count: events.length, events },
                };
              }

              case "infrastructure_events": {
                const events = await cloudTrailManager.getInfrastructureEvents({
                  region,
                  startTime,
                  endTime,
                });

                if (events.length === 0) {
                  return {
                    content: [{ type: "text", text: "No infrastructure events found." }],
                    details: { count: 0, events: [] },
                  };
                }

                const summary = events.slice(0, 10).map(e => 
                  `• ${e.eventTime?.toISOString() ?? "unknown"} - ${e.eventName} by ${e.userIdentity?.userName ?? "unknown"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${events.length} infrastructure events:\n\n${summary}` }],
                  details: { count: events.length, events },
                };
              }

              case "user_events": {
                const username = params.username as string | undefined;
                if (!username) {
                  return {
                    content: [{ type: "text", text: "Error: username required for user_events" }],
                    details: { error: "missing_username" },
                  };
                }
                const events = await cloudTrailManager.getEventsByUser(username, {
                  region,
                  startTime,
                  endTime,
                });

                if (events.length === 0) {
                  return {
                    content: [{ type: "text", text: `No events found for user: ${username}` }],
                    details: { count: 0, events: [] },
                  };
                }

                const summary = events.slice(0, 10).map(e => 
                  `• ${e.eventTime?.toISOString() ?? "unknown"} - ${e.eventName}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${events.length} events for ${username}:\n\n${summary}` }],
                  details: { count: events.length, events },
                };
              }

              case "audit_summary": {
                const auditSummary = await cloudTrailManager.generateAuditSummary({
                  region,
                  startTime,
                  endTime,
                });

                return {
                  content: [{ type: "text", text: `AWS Audit Summary (last ${hours} hours):\n• Total Events: ${auditSummary.totalEvents}\n• Read-Only Events: ${auditSummary.readOnlyCount}\n• Write Events: ${auditSummary.writeCount}\n• Error Events: ${auditSummary.errorCount}\n• Top Events: ${auditSummary.topEvents.slice(0, 5).map(e => `${e.name} (${e.count})`).join(", ")}\n• Top Users: ${auditSummary.topUsers.slice(0, 5).map(u => `${u.name} (${u.count})`).join(", ")}` }],
                  details: auditSummary,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `AWS CloudTrail error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_cloudtrail" },
    );

    // AWS Service Discovery Tool
    api.registerTool(
      {
        name: "aws_discover",
        label: "AWS Service Discovery",
        description:
          "Discover AWS services, regions, and resources in your account. Useful for inventory and understanding your AWS infrastructure.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["services", "regions", "resources", "ec2_instances", "vpcs"],
              description: "What to discover",
            },
            service: {
              type: "string",
              description: "Filter by service name (for resources)",
            },
            region: {
              type: "string",
              description: "AWS region",
            },
            limit: {
              type: "number",
              description: "Max results (default: 20)",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!serviceDiscovery) {
            return {
              content: [{ type: "text", text: "Error: Service discovery not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const region = params.region as string | undefined;

          try {
            switch (action) {
              case "services": {
                const result = await serviceDiscovery.discover();
                const summary = result.services.slice(0, 15).map(s => 
                  `• ${s.serviceName} - ${s.description ?? "AWS service"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Available AWS services:\n\n${summary}\n\n(${result.services.length} total services)` }],
                  details: { count: result.services.length, services: result.services },
                };
              }

              case "regions": {
                const regions = await serviceDiscovery.discoverRegions();
                const summary = regions.map(r => 
                  `• ${r.regionName} (${r.endpoint}) - ${r.available ? "available" : "not available"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `AWS regions:\n\n${summary}` }],
                  details: { count: regions.length, regions },
                };
              }

              case "resources": {
                // Combine EC2 instances and VPCs as a simple resource discovery
                const targetRegion = region ?? "us-east-1";
                const ec2Resources = await serviceDiscovery.discoverEC2Instances(targetRegion);
                const vpcResources = await serviceDiscovery.discoverVPCs(targetRegion);
                const allResources = [...ec2Resources, ...vpcResources];

                if (allResources.length === 0) {
                  return {
                    content: [{ type: "text", text: "No resources found." }],
                    details: { count: 0, resources: [] },
                  };
                }

                const summary = allResources.slice(0, 15).map(r => 
                  `• ${r.resourceType}: ${r.resourceId}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${allResources.length} resources:\n\n${summary}` }],
                  details: { count: allResources.length, resources: allResources },
                };
              }

              case "ec2_instances": {
                const instances = await serviceDiscovery.discoverEC2Instances(region ?? "us-east-1");

                if (instances.length === 0) {
                  return {
                    content: [{ type: "text", text: "No EC2 instances found." }],
                    details: { count: 0, instances: [] },
                  };
                }

                const summary = instances.slice(0, 15).map(i => 
                  `• ${i.resourceId} - ${i.metadata?.instanceType ?? "unknown"} - ${i.metadata?.state ?? "unknown"}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${instances.length} EC2 instances:\n\n${summary}` }],
                  details: { count: instances.length, instances },
                };
              }

              case "vpcs": {
                const vpcs = await serviceDiscovery.discoverVPCs(region ?? "us-east-1");

                if (vpcs.length === 0) {
                  return {
                    content: [{ type: "text", text: "No VPCs found." }],
                    details: { count: 0, vpcs: [] },
                  };
                }

                const summary = vpcs.map(v => 
                  `• ${v.resourceId} - ${v.metadata?.cidrBlock ?? "unknown"} ${v.metadata?.isDefault ? "(default)" : ""}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Found ${vpcs.length} VPCs:\n\n${summary}` }],
                  details: { count: vpcs.length, vpcs },
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `AWS Discovery error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_discover" },
    );

    // AWS RDS Management Tool
    api.registerTool(
      {
        name: "aws_rds",
        label: "AWS RDS Management",
        description:
          "Manage AWS RDS database instances. Create, modify, snapshot, monitor, and manage RDS instances, read replicas, and Multi-AZ deployments.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "list_instances",
                "get_instance",
                "create_instance",
                "modify_instance",
                "delete_instance",
                "start_instance",
                "stop_instance",
                "reboot_instance",
                "list_snapshots",
                "create_snapshot",
                "delete_snapshot",
                "restore_from_snapshot",
                "restore_point_in_time",
                "list_parameter_groups",
                "create_parameter_group",
                "modify_parameter_group",
                "delete_parameter_group",
                "get_parameters",
                "list_subnet_groups",
                "create_subnet_group",
                "modify_subnet_group",
                "delete_subnet_group",
                "get_metrics",
                "enable_performance_insights",
                "disable_performance_insights",
                "get_backup_config",
                "set_backup_config",
                "get_maintenance_config",
                "set_maintenance_config",
                "create_read_replica",
                "promote_read_replica",
                "list_read_replicas",
                "get_replica_status",
                "force_failover",
                "enable_multi_az",
                "disable_multi_az",
                "get_multi_az_status",
                "list_events",
                "list_log_files",
                "download_log_portion",
              ],
              description: "The RDS operation to perform",
            },
            dbInstanceIdentifier: {
              type: "string",
              description: "The DB instance identifier",
            },
            dbSnapshotIdentifier: {
              type: "string",
              description: "The DB snapshot identifier",
            },
            dbParameterGroupName: {
              type: "string",
              description: "The DB parameter group name",
            },
            dbSubnetGroupName: {
              type: "string",
              description: "The DB subnet group name",
            },
            dbInstanceClass: {
              type: "string",
              description: "The DB instance class (e.g., db.t3.micro)",
            },
            engine: {
              type: "string",
              enum: ["mysql", "mariadb", "postgres", "oracle-ee", "oracle-se2", "sqlserver-ee", "sqlserver-se", "sqlserver-web", "aurora-mysql", "aurora-postgresql"],
              description: "The database engine",
            },
            masterUsername: {
              type: "string",
              description: "The master username for the database",
            },
            masterUserPassword: {
              type: "string",
              description: "The master password for the database",
            },
            allocatedStorage: {
              type: "number",
              description: "The allocated storage in GB",
            },
            storageType: {
              type: "string",
              enum: ["gp2", "gp3", "io1", "io2", "standard"],
              description: "The storage type",
            },
            multiAZ: {
              type: "boolean",
              description: "Whether to enable Multi-AZ deployment",
            },
            publiclyAccessible: {
              type: "boolean",
              description: "Whether the instance is publicly accessible",
            },
            backupRetentionPeriod: {
              type: "number",
              description: "The backup retention period in days (0-35)",
            },
            preferredBackupWindow: {
              type: "string",
              description: "The preferred backup window (e.g., 05:00-06:00)",
            },
            preferredMaintenanceWindow: {
              type: "string",
              description: "The preferred maintenance window (e.g., sun:05:00-sun:06:00)",
            },
            subnetIds: {
              type: "array",
              items: { type: "string" },
              description: "Subnet IDs for subnet group",
            },
            description: {
              type: "string",
              description: "Description for parameter/subnet group",
            },
            dbParameterGroupFamily: {
              type: "string",
              description: "Parameter group family (e.g., mysql8.0, postgres14)",
            },
            parameters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parameterName: { type: "string" },
                  parameterValue: { type: "string" },
                  applyMethod: { type: "string", enum: ["immediate", "pending-reboot"] },
                },
              },
              description: "Parameters to modify",
            },
            sourceDBInstanceIdentifier: {
              type: "string",
              description: "Source DB instance for read replica or point-in-time restore",
            },
            restoreTime: {
              type: "string",
              description: "Restore time in ISO 8601 format",
            },
            useLatestRestorableTime: {
              type: "boolean",
              description: "Use the latest restorable time",
            },
            startTime: {
              type: "string",
              description: "Start time for metrics/events in ISO 8601 format",
            },
            endTime: {
              type: "string",
              description: "End time for metrics/events in ISO 8601 format",
            },
            logFileName: {
              type: "string",
              description: "Log file name to download",
            },
            skipFinalSnapshot: {
              type: "boolean",
              description: "Skip final snapshot when deleting",
            },
            finalDBSnapshotIdentifier: {
              type: "string",
              description: "Final snapshot identifier when deleting",
            },
            forceFailover: {
              type: "boolean",
              description: "Force failover during reboot",
            },
            applyImmediately: {
              type: "boolean",
              description: "Apply changes immediately vs. next maintenance window",
            },
            region: {
              type: "string",
              description: "AWS region",
            },
            tags: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Tags to apply",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!rdsManager) {
            return {
              content: [{ type: "text", text: "Error: RDS manager not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const region = params.region as string | undefined;

          try {
            switch (action) {
              // Instance operations
              case "list_instances": {
                const instances = await rdsManager.listInstances({ region });
                const summary = instances.length === 0
                  ? "No RDS instances found."
                  : instances.map(i =>
                      `• ${i.dbInstanceIdentifier} (${i.engine} ${i.engineVersion}) - ${i.status} - ${i.dbInstanceClass}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `RDS Instances:\n\n${summary}` }],
                  details: { count: instances.length, instances },
                };
              }

              case "get_instance": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const instance = await rdsManager.getInstance(id, region);
                if (!instance) {
                  return {
                    content: [{ type: "text", text: `Instance '${id}' not found` }],
                    details: { error: "not_found" },
                  };
                }

                const info = [
                  `DB Instance: ${instance.dbInstanceIdentifier}`,
                  `Engine: ${instance.engine} ${instance.engineVersion}`,
                  `Status: ${instance.status}`,
                  `Class: ${instance.dbInstanceClass}`,
                  `Storage: ${instance.allocatedStorage}GB (${instance.storageType})`,
                  `Multi-AZ: ${instance.multiAZ ? "Yes" : "No"}`,
                  instance.endpoint ? `Endpoint: ${instance.endpoint.address}:${instance.endpoint.port}` : "",
                  `Backup Retention: ${instance.backupRetentionPeriod} days`,
                ].filter(Boolean).join("\n");

                return {
                  content: [{ type: "text", text: info }],
                  details: { instance },
                };
              }

              case "create_instance": {
                const id = params.dbInstanceIdentifier as string;
                const dbClass = params.dbInstanceClass as string;
                const engine = params.engine as string;
                const username = params.masterUsername as string;
                const password = params.masterUserPassword as string;
                const storage = params.allocatedStorage as number;

                if (!id || !dbClass || !engine || !username || !password || !storage) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier, dbInstanceClass, engine, masterUsername, masterUserPassword, and allocatedStorage are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.createInstance({
                  dbInstanceIdentifier: id,
                  dbInstanceClass: dbClass,
                  engine: engine as Parameters<typeof rdsManager.createInstance>[0]["engine"],
                  masterUsername: username,
                  masterUserPassword: password,
                  allocatedStorage: storage,
                  storageType: params.storageType as "gp2" | "gp3" | "io1" | "io2" | "standard" | undefined,
                  multiAZ: params.multiAZ as boolean | undefined,
                  publiclyAccessible: params.publiclyAccessible as boolean | undefined,
                  backupRetentionPeriod: params.backupRetentionPeriod as number | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "modify_instance": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.modifyInstance({
                  dbInstanceIdentifier: id,
                  dbInstanceClass: params.dbInstanceClass as string | undefined,
                  allocatedStorage: params.allocatedStorage as number | undefined,
                  storageType: params.storageType as "gp2" | "gp3" | "io1" | "io2" | "standard" | undefined,
                  multiAZ: params.multiAZ as boolean | undefined,
                  backupRetentionPeriod: params.backupRetentionPeriod as number | undefined,
                  preferredBackupWindow: params.preferredBackupWindow as string | undefined,
                  preferredMaintenanceWindow: params.preferredMaintenanceWindow as string | undefined,
                  applyImmediately: params.applyImmediately as boolean | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_instance": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.deleteInstance(id, {
                  skipFinalSnapshot: params.skipFinalSnapshot as boolean | undefined,
                  finalDBSnapshotIdentifier: params.finalDBSnapshotIdentifier as string | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "start_instance": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.startInstance(id, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "stop_instance": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.stopInstance(id, { region });
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "reboot_instance": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.rebootInstance({
                  dbInstanceIdentifier: id,
                  forceFailover: params.forceFailover as boolean | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Snapshot operations
              case "list_snapshots": {
                const snapshots = await rdsManager.listSnapshots({
                  dbInstanceIdentifier: params.dbInstanceIdentifier as string | undefined,
                  region,
                });

                const summary = snapshots.length === 0
                  ? "No snapshots found."
                  : snapshots.map(s =>
                      `• ${s.dbSnapshotIdentifier} (${s.dbInstanceIdentifier}) - ${s.status} - ${s.snapshotType}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `RDS Snapshots:\n\n${summary}` }],
                  details: { count: snapshots.length, snapshots },
                };
              }

              case "create_snapshot": {
                const snapshotId = params.dbSnapshotIdentifier as string;
                const instanceId = params.dbInstanceIdentifier as string;
                if (!snapshotId || !instanceId) {
                  return {
                    content: [{ type: "text", text: "Error: dbSnapshotIdentifier and dbInstanceIdentifier are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.createSnapshot({
                  dbSnapshotIdentifier: snapshotId,
                  dbInstanceIdentifier: instanceId,
                  tags: params.tags as Record<string, string> | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_snapshot": {
                const snapshotId = params.dbSnapshotIdentifier as string;
                if (!snapshotId) {
                  return {
                    content: [{ type: "text", text: "Error: dbSnapshotIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.deleteSnapshot(snapshotId, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "restore_from_snapshot": {
                const instanceId = params.dbInstanceIdentifier as string;
                const snapshotId = params.dbSnapshotIdentifier as string;
                if (!instanceId || !snapshotId) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier and dbSnapshotIdentifier are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.restoreFromSnapshot({
                  dbInstanceIdentifier: instanceId,
                  dbSnapshotIdentifier: snapshotId,
                  dbInstanceClass: params.dbInstanceClass as string | undefined,
                  multiAZ: params.multiAZ as boolean | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "restore_point_in_time": {
                const targetId = params.dbInstanceIdentifier as string;
                const sourceId = params.sourceDBInstanceIdentifier as string;
                if (!targetId) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier (target) is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.restoreToPointInTime({
                  targetDBInstanceIdentifier: targetId,
                  sourceDBInstanceIdentifier: sourceId,
                  restoreTime: params.restoreTime ? new Date(params.restoreTime as string) : undefined,
                  useLatestRestorableTime: params.useLatestRestorableTime as boolean | undefined,
                  dbInstanceClass: params.dbInstanceClass as string | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Parameter group operations
              case "list_parameter_groups": {
                const groups = await rdsManager.listParameterGroups({ region });
                const summary = groups.length === 0
                  ? "No parameter groups found."
                  : groups.map(g =>
                      `• ${g.dbParameterGroupName} (${g.dbParameterGroupFamily}) - ${g.description}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `RDS Parameter Groups:\n\n${summary}` }],
                  details: { count: groups.length, groups },
                };
              }

              case "create_parameter_group": {
                const name = params.dbParameterGroupName as string;
                const family = params.dbParameterGroupFamily as string;
                const desc = params.description as string;
                if (!name || !family || !desc) {
                  return {
                    content: [{ type: "text", text: "Error: dbParameterGroupName, dbParameterGroupFamily, and description are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.createParameterGroup({
                  dbParameterGroupName: name,
                  dbParameterGroupFamily: family,
                  description: desc,
                  tags: params.tags as Record<string, string> | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "modify_parameter_group": {
                const name = params.dbParameterGroupName as string;
                const parameters = params.parameters as Array<{
                  parameterName: string;
                  parameterValue: string;
                  applyMethod?: "immediate" | "pending-reboot";
                }>;
                if (!name || !parameters || parameters.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: dbParameterGroupName and parameters are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.modifyParameterGroup({
                  dbParameterGroupName: name,
                  parameters,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_parameter_group": {
                const name = params.dbParameterGroupName as string;
                if (!name) {
                  return {
                    content: [{ type: "text", text: "Error: dbParameterGroupName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.deleteParameterGroup(name, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "get_parameters": {
                const name = params.dbParameterGroupName as string;
                if (!name) {
                  return {
                    content: [{ type: "text", text: "Error: dbParameterGroupName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const parameters = await rdsManager.getParameters({
                  dbParameterGroupName: name,
                  region,
                });

                const modifiable = parameters.filter(p => p.isModifiable && p.parameterValue);
                const summary = modifiable.length === 0
                  ? "No modifiable parameters with values found."
                  : modifiable.slice(0, 20).map(p =>
                      `• ${p.parameterName} = ${p.parameterValue}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Parameters for '${name}':\n\n${summary}\n\n(${parameters.length} total, ${modifiable.length} modifiable with values)` }],
                  details: { total: parameters.length, modifiable: modifiable.length, parameters },
                };
              }

              // Subnet group operations
              case "list_subnet_groups": {
                const groups = await rdsManager.listSubnetGroups({ region });
                const summary = groups.length === 0
                  ? "No subnet groups found."
                  : groups.map(g =>
                      `• ${g.dbSubnetGroupName} (VPC: ${g.vpcId}) - ${g.subnets.length} subnets`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `RDS Subnet Groups:\n\n${summary}` }],
                  details: { count: groups.length, groups },
                };
              }

              case "create_subnet_group": {
                const name = params.dbSubnetGroupName as string;
                const desc = params.description as string;
                const subnetIds = params.subnetIds as string[];
                if (!name || !desc || !subnetIds || subnetIds.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: dbSubnetGroupName, description, and subnetIds are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.createSubnetGroup({
                  dbSubnetGroupName: name,
                  dbSubnetGroupDescription: desc,
                  subnetIds,
                  tags: params.tags as Record<string, string> | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "modify_subnet_group": {
                const name = params.dbSubnetGroupName as string;
                const subnetIds = params.subnetIds as string[];
                if (!name || !subnetIds || subnetIds.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: dbSubnetGroupName and subnetIds are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.modifySubnetGroup({
                  dbSubnetGroupName: name,
                  subnetIds,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_subnet_group": {
                const name = params.dbSubnetGroupName as string;
                if (!name) {
                  return {
                    content: [{ type: "text", text: "Error: dbSubnetGroupName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.deleteSubnetGroup(name, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Monitoring operations
              case "get_metrics": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const endTime = params.endTime ? new Date(params.endTime as string) : new Date();
                const startTime = params.startTime ? new Date(params.startTime as string) : new Date(endTime.getTime() - 3600000);

                const metrics = await rdsManager.getInstanceMetrics({
                  dbInstanceIdentifier: id,
                  startTime,
                  endTime,
                  region,
                });

                const metricLines = Object.entries(metrics.metrics)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => `• ${k}: ${typeof v === "number" ? v.toFixed(2) : v}`)
                  .join("\n");

                return {
                  content: [{ type: "text", text: `Metrics for '${id}':\n\n${metricLines || "No metrics available"}` }],
                  details: metrics,
                };
              }

              case "enable_performance_insights": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.enablePerformanceInsights({
                  dbInstanceIdentifier: id,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "disable_performance_insights": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.disablePerformanceInsights(id, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Backup configuration
              case "get_backup_config": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const config = await rdsManager.getBackupConfiguration(id, region);
                if (!config) {
                  return {
                    content: [{ type: "text", text: `Instance '${id}' not found` }],
                    details: { error: "not_found" },
                  };
                }

                const info = [
                  `Backup Retention: ${config.backupRetentionPeriod} days`,
                  `Backup Window: ${config.preferredBackupWindow}`,
                  `Copy Tags to Snapshots: ${config.copyTagsToSnapshot ? "Yes" : "No"}`,
                  config.latestRestorableTime ? `Latest Restorable: ${config.latestRestorableTime.toISOString()}` : "",
                ].filter(Boolean).join("\n");

                return {
                  content: [{ type: "text", text: `Backup Configuration for '${id}':\n\n${info}` }],
                  details: config,
                };
              }

              case "set_backup_config": {
                const id = params.dbInstanceIdentifier as string;
                const retention = params.backupRetentionPeriod as number;
                if (!id || retention === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier and backupRetentionPeriod are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.setBackupConfiguration({
                  dbInstanceIdentifier: id,
                  backupRetentionPeriod: retention,
                  preferredBackupWindow: params.preferredBackupWindow as string | undefined,
                  applyImmediately: params.applyImmediately as boolean | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "get_maintenance_config": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const config = await rdsManager.getMaintenanceConfiguration(id, region);
                if (!config) {
                  return {
                    content: [{ type: "text", text: `Instance '${id}' not found` }],
                    details: { error: "not_found" },
                  };
                }

                const pending = config.pendingMaintenanceActions.length > 0
                  ? "\n\nPending Actions:\n" + config.pendingMaintenanceActions.map(a =>
                      `• ${a.action}: ${a.description || "No description"}`
                    ).join("\n")
                  : "";

                const info = [
                  `Maintenance Window: ${config.preferredMaintenanceWindow}`,
                  `Auto Minor Version Upgrade: ${config.autoMinorVersionUpgrade ? "Yes" : "No"}`,
                ].join("\n") + pending;

                return {
                  content: [{ type: "text", text: `Maintenance Configuration for '${id}':\n\n${info}` }],
                  details: config,
                };
              }

              case "set_maintenance_config": {
                const id = params.dbInstanceIdentifier as string;
                const window = params.preferredMaintenanceWindow as string;
                if (!id || !window) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier and preferredMaintenanceWindow are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.setMaintenanceConfiguration({
                  dbInstanceIdentifier: id,
                  preferredMaintenanceWindow: window,
                  applyImmediately: params.applyImmediately as boolean | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Read replica operations
              case "create_read_replica": {
                const id = params.dbInstanceIdentifier as string;
                const sourceId = params.sourceDBInstanceIdentifier as string;
                if (!id || !sourceId) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier (target) and sourceDBInstanceIdentifier are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.createReadReplica({
                  dbInstanceIdentifier: id,
                  sourceDBInstanceIdentifier: sourceId,
                  dbInstanceClass: params.dbInstanceClass as string | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "promote_read_replica": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.promoteReadReplica({
                  dbInstanceIdentifier: id,
                  backupRetentionPeriod: params.backupRetentionPeriod as number | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "list_read_replicas": {
                const sourceId = params.sourceDBInstanceIdentifier as string;
                if (!sourceId) {
                  return {
                    content: [{ type: "text", text: "Error: sourceDBInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const replicas = await rdsManager.listReadReplicas(sourceId, region);
                const summary = replicas.length === 0
                  ? "No read replicas found."
                  : replicas.map(r =>
                      `• ${r.dbInstanceIdentifier} - ${r.status} - ${r.dbInstanceClass}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Read Replicas for '${sourceId}':\n\n${summary}` }],
                  details: { count: replicas.length, replicas },
                };
              }

              case "get_replica_status": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const status = await rdsManager.getReplicaStatus(id, region);
                if (!status) {
                  return {
                    content: [{ type: "text", text: `Instance '${id}' not found` }],
                    details: { error: "not_found" },
                  };
                }

                const info = status.isReplica
                  ? `'${id}' is a read replica of '${status.sourceDBInstanceIdentifier}'\nStatus: ${status.status}\nMode: ${status.replicaMode || "standard"}`
                  : `'${id}' is not a read replica`;

                return {
                  content: [{ type: "text", text: info }],
                  details: status,
                };
              }

              // Multi-AZ operations
              case "force_failover": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.forceFailover(id, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "enable_multi_az": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.enableMultiAZ(id, {
                  applyImmediately: params.applyImmediately as boolean | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "disable_multi_az": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await rdsManager.disableMultiAZ(id, {
                  applyImmediately: params.applyImmediately as boolean | undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "get_multi_az_status": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const status = await rdsManager.getMultiAZStatus(id, region);
                if (!status) {
                  return {
                    content: [{ type: "text", text: `Instance '${id}' not found` }],
                    details: { error: "not_found" },
                  };
                }

                const info = status.multiAZ
                  ? `'${id}' is Multi-AZ enabled\nPrimary AZ: ${status.primaryAvailabilityZone}\nSecondary AZ: ${status.secondaryAvailabilityZone}`
                  : `'${id}' is not Multi-AZ enabled (Single-AZ)`;

                return {
                  content: [{ type: "text", text: info }],
                  details: status,
                };
              }

              // Events and logs
              case "list_events": {
                const events = await rdsManager.listEvents({
                  sourceIdentifier: params.dbInstanceIdentifier as string | undefined,
                  sourceType: params.dbInstanceIdentifier ? "db-instance" : undefined,
                  startTime: params.startTime ? new Date(params.startTime as string) : undefined,
                  endTime: params.endTime ? new Date(params.endTime as string) : undefined,
                  region,
                });

                const summary = events.length === 0
                  ? "No events found."
                  : events.slice(0, 20).map(e =>
                      `• [${e.date?.toISOString() || "unknown"}] ${e.sourceIdentifier}: ${e.message}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `RDS Events:\n\n${summary}` }],
                  details: { count: events.length, events },
                };
              }

              case "list_log_files": {
                const id = params.dbInstanceIdentifier as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const logs = await rdsManager.listLogFiles({
                  dbInstanceIdentifier: id,
                  region,
                });

                const summary = logs.length === 0
                  ? "No log files found."
                  : logs.map(l =>
                      `• ${l.logFileName} (${(l.size / 1024).toFixed(2)} KB)`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Log Files for '${id}':\n\n${summary}` }],
                  details: { count: logs.length, logs },
                };
              }

              case "download_log_portion": {
                const id = params.dbInstanceIdentifier as string;
                const logFile = params.logFileName as string;
                if (!id || !logFile) {
                  return {
                    content: [{ type: "text", text: "Error: dbInstanceIdentifier and logFileName are required" }],
                    details: { error: "missing_parameters" },
                  };
                }

                const result = await rdsManager.downloadLogFilePortion({
                  dbInstanceIdentifier: id,
                  logFileName: logFile,
                  region,
                });

                return {
                  content: [{ type: "text", text: `Log content (${result.additionalDataPending ? "partial" : "complete"}):\n\n${result.logFileData.slice(0, 4000)}${result.logFileData.length > 4000 ? "\n... (truncated)" : ""}` }],
                  details: result,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `RDS error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_rds" },
    );

    // Register Lambda agent tool
    api.registerTool(
      {
        description: `Manage AWS Lambda functions with comprehensive operations including:
- List and get Lambda functions
- Create, update, and delete functions
- Deploy function code from S3 or zip
- Manage function configuration (memory, timeout, environment)
- Manage event source mappings (triggers) for SQS, Kinesis, DynamoDB, etc.
- Add/remove permissions for API Gateway, S3, and other services
- Manage Lambda layers (create, publish, delete versions)
- Manage versions and aliases for deployment strategies
- Monitor with CloudWatch metrics and logs
- Optimize cold starts with reserved/provisioned concurrency
- Invoke functions synchronously or asynchronously
- Manage function URLs for HTTP endpoints`,
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "The Lambda operation to perform",
              enum: [
                // Function operations
                "list_functions",
                "get_function",
                "create_function",
                "update_function_code",
                "update_function_configuration",
                "delete_function",
                "invoke_function",
                // Environment variable operations
                "get_environment_variables",
                "set_environment_variables",
                "update_environment_variables",
                "remove_environment_variables",
                // Trigger/Event source operations
                "list_event_source_mappings",
                "create_event_source_mapping",
                "update_event_source_mapping",
                "delete_event_source_mapping",
                "add_permission",
                "remove_permission",
                "get_policy",
                // Layer operations
                "list_layers",
                "list_layer_versions",
                "get_layer_version",
                "publish_layer_version",
                "delete_layer_version",
                "add_layers_to_function",
                "remove_layers_from_function",
                // Version and alias operations
                "publish_version",
                "list_versions",
                "create_alias",
                "update_alias",
                "delete_alias",
                "list_aliases",
                // Monitoring operations
                "get_metrics",
                "get_logs",
                "get_recent_log_streams",
                // Cold start optimization operations
                "set_reserved_concurrency",
                "delete_reserved_concurrency",
                "get_reserved_concurrency",
                "set_provisioned_concurrency",
                "delete_provisioned_concurrency",
                "list_provisioned_concurrency_configs",
                "analyze_cold_starts",
                "warmup_function",
                // Function URL operations
                "create_function_url",
                "update_function_url",
                "delete_function_url",
                "get_function_url",
                "list_function_urls",
                // Account operations
                "get_account_settings",
              ],
            },
            // Common parameters
            functionName: {
              type: "string",
              description: "Lambda function name or ARN",
            },
            qualifier: {
              type: "string",
              description: "Function version or alias",
            },
            region: {
              type: "string",
              description: "AWS region",
            },
            // Create function parameters
            runtime: {
              type: "string",
              description: "Runtime (nodejs20.x, python3.11, java21, etc.)",
              enum: [
                "nodejs18.x", "nodejs20.x", "nodejs22.x",
                "python3.9", "python3.10", "python3.11", "python3.12", "python3.13",
                "java11", "java17", "java21",
                "dotnet6", "dotnet8",
                "ruby3.2", "ruby3.3",
                "provided.al2", "provided.al2023",
              ],
            },
            role: {
              type: "string",
              description: "IAM role ARN for the function",
            },
            handler: {
              type: "string",
              description: "Handler specification (e.g., index.handler)",
            },
            codeS3Bucket: {
              type: "string",
              description: "S3 bucket containing deployment package",
            },
            codeS3Key: {
              type: "string",
              description: "S3 key for deployment package",
            },
            description: {
              type: "string",
              description: "Function description",
            },
            timeout: {
              type: "number",
              description: "Function timeout in seconds (1-900)",
            },
            memorySize: {
              type: "number",
              description: "Memory size in MB (128-10240)",
            },
            // Environment variables
            environment: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Environment variables",
            },
            environmentKeys: {
              type: "array",
              items: { type: "string" },
              description: "Environment variable keys to remove",
            },
            // Event source mapping parameters
            uuid: {
              type: "string",
              description: "Event source mapping UUID",
            },
            eventSourceArn: {
              type: "string",
              description: "Event source ARN (SQS, Kinesis, DynamoDB, etc.)",
            },
            batchSize: {
              type: "number",
              description: "Batch size for event source mapping",
            },
            enabled: {
              type: "boolean",
              description: "Whether the event source mapping is enabled",
            },
            startingPosition: {
              type: "string",
              description: "Starting position for streams",
              enum: ["TRIM_HORIZON", "LATEST", "AT_TIMESTAMP"],
            },
            // Permission parameters
            statementId: {
              type: "string",
              description: "Statement ID for permission",
            },
            permissionAction: {
              type: "string",
              description: "Lambda action to allow (e.g., lambda:InvokeFunction)",
            },
            principal: {
              type: "string",
              description: "AWS service or account allowed to invoke",
            },
            sourceArn: {
              type: "string",
              description: "ARN of the invoking resource",
            },
            // Layer parameters
            layerName: {
              type: "string",
              description: "Lambda layer name",
            },
            layerArns: {
              type: "array",
              items: { type: "string" },
              description: "Layer ARNs to add/remove",
            },
            versionNumber: {
              type: "number",
              description: "Layer version number",
            },
            compatibleRuntimes: {
              type: "array",
              items: { type: "string" },
              description: "Compatible runtimes for layer",
            },
            // Alias parameters
            aliasName: {
              type: "string",
              description: "Alias name",
            },
            functionVersion: {
              type: "string",
              description: "Function version for alias",
            },
            routingWeight: {
              type: "number",
              description: "Traffic weight for additional version (0-1)",
            },
            additionalVersion: {
              type: "string",
              description: "Additional version for traffic splitting",
            },
            // Monitoring parameters
            startTime: {
              type: "number",
              description: "Start time (epoch milliseconds) for metrics/logs",
            },
            endTime: {
              type: "number",
              description: "End time (epoch milliseconds) for metrics/logs",
            },
            filterPattern: {
              type: "string",
              description: "CloudWatch Logs filter pattern",
            },
            limit: {
              type: "number",
              description: "Maximum number of results",
            },
            // Concurrency parameters
            reservedConcurrency: {
              type: "number",
              description: "Reserved concurrent executions",
            },
            provisionedConcurrency: {
              type: "number",
              description: "Provisioned concurrent executions",
            },
            warmupConcurrency: {
              type: "number",
              description: "Number of concurrent warmup invocations",
            },
            // Invocation parameters
            payload: {
              type: "string",
              description: "JSON payload for function invocation",
            },
            invocationType: {
              type: "string",
              description: "Invocation type",
              enum: ["RequestResponse", "Event", "DryRun"],
            },
            // Function URL parameters
            authType: {
              type: "string",
              description: "Authentication type for function URL",
              enum: ["NONE", "AWS_IAM"],
            },
            allowOrigins: {
              type: "array",
              items: { type: "string" },
              description: "CORS allowed origins",
            },
            allowMethods: {
              type: "array",
              items: { type: "string" },
              description: "CORS allowed methods",
            },
            // VPC configuration
            subnetIds: {
              type: "array",
              items: { type: "string" },
              description: "VPC subnet IDs",
            },
            securityGroupIds: {
              type: "array",
              items: { type: "string" },
              description: "VPC security group IDs",
            },
            // Architecture
            architectures: {
              type: "array",
              items: { type: "string", enum: ["x86_64", "arm64"] },
              description: "Function architectures",
            },
            // Layers for function
            layers: {
              type: "array",
              items: { type: "string" },
              description: "Layer ARNs to attach to function",
            },
            // Tags
            tags: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Tags to apply",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!lambdaManager) {
            return {
              content: [{ type: "text", text: "Error: Lambda manager not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const region = params.region as string | undefined;

          try {
            switch (action) {
              // Function operations
              case "list_functions": {
                const functions = await lambdaManager.listFunctions({ region });
                const summary = functions.length === 0
                  ? "No Lambda functions found."
                  : functions.map(f =>
                      `• ${f.functionName} (${f.runtime}) - ${f.state || 'Active'} - ${f.memorySize}MB`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Lambda Functions:\n\n${summary}` }],
                  details: { count: functions.length, functions },
                };
              }

              case "get_function": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const fn = await lambdaManager.getFunction(functionName, params.qualifier as string, region);
                if (!fn) {
                  return {
                    content: [{ type: "text", text: `Function '${functionName}' not found` }],
                    details: { error: "not_found" },
                  };
                }
                const details = [
                  `Function: ${fn.functionName}`,
                  `ARN: ${fn.functionArn}`,
                  `Runtime: ${fn.runtime}`,
                  `Handler: ${fn.handler}`,
                  `Memory: ${fn.memorySize}MB`,
                  `Timeout: ${fn.timeout}s`,
                  `State: ${fn.state || 'Active'}`,
                  `Code Size: ${Math.round(fn.codeSize / 1024)}KB`,
                  `Last Modified: ${fn.lastModified}`,
                  fn.description ? `Description: ${fn.description}` : null,
                ].filter(Boolean).join("\n");
                return {
                  content: [{ type: "text", text: details }],
                  details: { function: fn },
                };
              }

              case "create_function": {
                const functionName = params.functionName as string;
                const runtime = params.runtime as string;
                const role = params.role as string;
                const handler = params.handler as string;
                const codeS3Bucket = params.codeS3Bucket as string;
                const codeS3Key = params.codeS3Key as string;

                if (!functionName || !runtime || !role || !handler || !codeS3Bucket || !codeS3Key) {
                  return {
                    content: [{ type: "text", text: "Error: functionName, runtime, role, handler, codeS3Bucket, and codeS3Key are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.createFunction({
                  functionName,
                  runtime: runtime as Parameters<typeof lambdaManager.createFunction>[0]["runtime"],
                  role,
                  handler,
                  code: { s3Bucket: codeS3Bucket, s3Key: codeS3Key },
                  description: params.description as string,
                  timeout: params.timeout as number,
                  memorySize: params.memorySize as number,
                  environment: params.environment as Record<string, string>,
                  vpcConfig: params.subnetIds ? {
                    subnetIds: params.subnetIds as string[],
                    securityGroupIds: params.securityGroupIds as string[],
                  } : undefined,
                  layers: params.layers as string[],
                  architectures: params.architectures as Array<'x86_64' | 'arm64'>,
                  tags: params.tags as Record<string, string>,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "update_function_code": {
                const functionName = params.functionName as string;
                const codeS3Bucket = params.codeS3Bucket as string;
                const codeS3Key = params.codeS3Key as string;

                if (!functionName || !codeS3Bucket || !codeS3Key) {
                  return {
                    content: [{ type: "text", text: "Error: functionName, codeS3Bucket, and codeS3Key are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.updateFunctionCode({
                  functionName,
                  code: { s3Bucket: codeS3Bucket, s3Key: codeS3Key },
                  architectures: params.architectures as Array<'x86_64' | 'arm64'>,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "update_function_configuration": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.updateFunctionConfiguration({
                  functionName,
                  runtime: params.runtime as Parameters<typeof lambdaManager.updateFunctionConfiguration>[0]["runtime"],
                  role: params.role as string,
                  handler: params.handler as string,
                  description: params.description as string,
                  timeout: params.timeout as number,
                  memorySize: params.memorySize as number,
                  environment: params.environment as Record<string, string>,
                  vpcConfig: params.subnetIds ? {
                    subnetIds: params.subnetIds as string[],
                    securityGroupIds: params.securityGroupIds as string[],
                  } : undefined,
                  layers: params.layers as string[],
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_function": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.deleteFunction(functionName, params.qualifier as string, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "invoke_function": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.invoke({
                  functionName,
                  payload: params.payload as string,
                  invocationType: (params.invocationType as 'RequestResponse' | 'Event' | 'DryRun') || 'RequestResponse',
                  qualifier: params.qualifier as string,
                  logType: 'Tail',
                  region,
                });

                const output = [
                  `Status Code: ${result.statusCode}`,
                  result.executedVersion ? `Executed Version: ${result.executedVersion}` : null,
                  result.functionError ? `Function Error: ${result.functionError}` : null,
                  result.payload ? `Response:\n${result.payload}` : null,
                ].filter(Boolean).join("\n");

                return {
                  content: [{ type: "text", text: output }],
                  details: result,
                };
              }

              // Environment variable operations
              case "get_environment_variables": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const vars = await lambdaManager.getEnvironmentVariables(functionName, region);
                if (vars === null) {
                  return {
                    content: [{ type: "text", text: `Function '${functionName}' not found` }],
                    details: { error: "not_found" },
                  };
                }

                const summary = Object.keys(vars).length === 0
                  ? "No environment variables set."
                  : Object.entries(vars).map(([k, v]) => `• ${k}: ${v}`).join("\n");

                return {
                  content: [{ type: "text", text: `Environment Variables for ${functionName}:\n\n${summary}` }],
                  details: { variables: vars },
                };
              }

              case "set_environment_variables": {
                const functionName = params.functionName as string;
                const environment = params.environment as Record<string, string>;
                if (!functionName || !environment) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and environment are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.setEnvironmentVariables(functionName, environment, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "update_environment_variables": {
                const functionName = params.functionName as string;
                const environment = params.environment as Record<string, string>;
                if (!functionName || !environment) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and environment are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.updateEnvironmentVariables(functionName, environment, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "remove_environment_variables": {
                const functionName = params.functionName as string;
                const keys = params.environmentKeys as string[];
                if (!functionName || !keys || keys.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and environmentKeys are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.removeEnvironmentVariables(functionName, keys, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Event source mapping operations
              case "list_event_source_mappings": {
                const functionName = params.functionName as string;
                const mappings = await lambdaManager.listEventSourceMappings({
                  functionName,
                  eventSourceArn: params.eventSourceArn as string,
                  region,
                });

                const summary = mappings.length === 0
                  ? "No event source mappings found."
                  : mappings.map(m =>
                      `• ${m.uuid} - ${m.eventSourceArn || 'N/A'} - ${m.state}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Event Source Mappings:\n\n${summary}` }],
                  details: { count: mappings.length, mappings },
                };
              }

              case "create_event_source_mapping": {
                const functionName = params.functionName as string;
                const eventSourceArn = params.eventSourceArn as string;
                if (!functionName || !eventSourceArn) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and eventSourceArn are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.createEventSourceMapping({
                  functionName,
                  eventSourceArn,
                  batchSize: params.batchSize as number,
                  enabled: params.enabled as boolean,
                  startingPosition: params.startingPosition as 'TRIM_HORIZON' | 'LATEST' | 'AT_TIMESTAMP',
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "update_event_source_mapping": {
                const uuid = params.uuid as string;
                if (!uuid) {
                  return {
                    content: [{ type: "text", text: "Error: uuid is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.updateEventSourceMapping({
                  uuid,
                  functionName: params.functionName as string,
                  enabled: params.enabled as boolean,
                  batchSize: params.batchSize as number,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_event_source_mapping": {
                const uuid = params.uuid as string;
                if (!uuid) {
                  return {
                    content: [{ type: "text", text: "Error: uuid is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.deleteEventSourceMapping(uuid, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "add_permission": {
                const functionName = params.functionName as string;
                const statementId = params.statementId as string;
                const principal = params.principal as string;
                if (!functionName || !statementId || !principal) {
                  return {
                    content: [{ type: "text", text: "Error: functionName, statementId, and principal are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.addPermission({
                  functionName,
                  statementId,
                  action: (params.permissionAction as string) || 'lambda:InvokeFunction',
                  principal,
                  sourceArn: params.sourceArn as string,
                  qualifier: params.qualifier as string,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "remove_permission": {
                const functionName = params.functionName as string;
                const statementId = params.statementId as string;
                if (!functionName || !statementId) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and statementId are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.removePermission({
                  functionName,
                  statementId,
                  qualifier: params.qualifier as string,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "get_policy": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const policy = await lambdaManager.getPolicy(functionName, params.qualifier as string, region);
                if (!policy) {
                  return {
                    content: [{ type: "text", text: `No policy found for '${functionName}'` }],
                    details: { error: "not_found" },
                  };
                }

                return {
                  content: [{ type: "text", text: `Policy for ${functionName}:\n\n${policy.policy}` }],
                  details: policy,
                };
              }

              // Layer operations
              case "list_layers": {
                const layers = await lambdaManager.listLayers({
                  compatibleRuntime: params.runtime as LambdaRuntime | undefined,
                  region,
                });

                const summary = layers.length === 0
                  ? "No layers found."
                  : layers.map(l =>
                      `• ${l.layerName} - v${l.latestMatchingVersion?.version || 'N/A'}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Lambda Layers:\n\n${summary}` }],
                  details: { count: layers.length, layers },
                };
              }

              case "list_layer_versions": {
                const layerName = params.layerName as string;
                if (!layerName) {
                  return {
                    content: [{ type: "text", text: "Error: layerName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const versions = await lambdaManager.listLayerVersions({
                  layerName,
                  compatibleRuntime: params.runtime as LambdaRuntime | undefined,
                  region,
                });

                const summary = versions.length === 0
                  ? "No versions found."
                  : versions.map(v =>
                      `• Version ${v.version} - ${v.description || 'No description'}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Layer Versions for ${layerName}:\n\n${summary}` }],
                  details: { count: versions.length, versions },
                };
              }

              case "get_layer_version": {
                const layerName = params.layerName as string;
                const versionNumber = params.versionNumber as number;
                if (!layerName || versionNumber === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: layerName and versionNumber are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const version = await lambdaManager.getLayerVersion(layerName, versionNumber, region);
                if (!version) {
                  return {
                    content: [{ type: "text", text: `Layer version not found` }],
                    details: { error: "not_found" },
                  };
                }

                return {
                  content: [{ type: "text", text: `Layer: ${layerName} v${version.version}\nARN: ${version.layerVersionArn}\nDescription: ${version.description || 'N/A'}\nCreated: ${version.createdDate}` }],
                  details: { version },
                };
              }

              case "publish_layer_version": {
                const layerName = params.layerName as string;
                const codeS3Bucket = params.codeS3Bucket as string;
                const codeS3Key = params.codeS3Key as string;
                if (!layerName || !codeS3Bucket || !codeS3Key) {
                  return {
                    content: [{ type: "text", text: "Error: layerName, codeS3Bucket, and codeS3Key are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.publishLayerVersion({
                  layerName,
                  description: params.description as string,
                  content: { s3Bucket: codeS3Bucket, s3Key: codeS3Key },
                  compatibleRuntimes: params.compatibleRuntimes as Parameters<typeof lambdaManager.publishLayerVersion>[0]["compatibleRuntimes"],
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_layer_version": {
                const layerName = params.layerName as string;
                const versionNumber = params.versionNumber as number;
                if (!layerName || versionNumber === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: layerName and versionNumber are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.deleteLayerVersion(layerName, versionNumber, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "add_layers_to_function": {
                const functionName = params.functionName as string;
                const layerArns = params.layerArns as string[];
                if (!functionName || !layerArns || layerArns.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and layerArns are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.addLayersToFunction(functionName, layerArns, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "remove_layers_from_function": {
                const functionName = params.functionName as string;
                const layerArns = params.layerArns as string[];
                if (!functionName || !layerArns || layerArns.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and layerArns are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.removeLayersFromFunction(functionName, layerArns, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Version and alias operations
              case "publish_version": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.publishVersion({
                  functionName,
                  description: params.description as string,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "list_versions": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const versions = await lambdaManager.listVersions({ functionName, region });
                const summary = versions.map(v =>
                  `• Version ${v.version} - ${v.description || 'No description'}`
                ).join("\n");

                return {
                  content: [{ type: "text", text: `Versions for ${functionName}:\n\n${summary}` }],
                  details: { count: versions.length, versions },
                };
              }

              case "create_alias": {
                const functionName = params.functionName as string;
                const aliasName = params.aliasName as string;
                const functionVersion = params.functionVersion as string;
                if (!functionName || !aliasName || !functionVersion) {
                  return {
                    content: [{ type: "text", text: "Error: functionName, aliasName, and functionVersion are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const routingConfig = params.additionalVersion && params.routingWeight !== undefined
                  ? { additionalVersionWeights: { [params.additionalVersion as string]: params.routingWeight as number } }
                  : undefined;

                const result = await lambdaManager.createAlias({
                  functionName,
                  name: aliasName,
                  functionVersion,
                  description: params.description as string,
                  routingConfig,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "update_alias": {
                const functionName = params.functionName as string;
                const aliasName = params.aliasName as string;
                if (!functionName || !aliasName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and aliasName are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const routingConfig = params.additionalVersion && params.routingWeight !== undefined
                  ? { additionalVersionWeights: { [params.additionalVersion as string]: params.routingWeight as number } }
                  : undefined;

                const result = await lambdaManager.updateAlias({
                  functionName,
                  name: aliasName,
                  functionVersion: params.functionVersion as string,
                  description: params.description as string,
                  routingConfig,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_alias": {
                const functionName = params.functionName as string;
                const aliasName = params.aliasName as string;
                if (!functionName || !aliasName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and aliasName are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.deleteAlias(functionName, aliasName, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "list_aliases": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const aliases = await lambdaManager.listAliases({
                  functionName,
                  functionVersion: params.functionVersion as string,
                  region,
                });

                const summary = aliases.length === 0
                  ? "No aliases found."
                  : aliases.map(a =>
                      `• ${a.name} -> v${a.functionVersion}${a.routingConfig ? ` (traffic split)` : ''}`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Aliases for ${functionName}:\n\n${summary}` }],
                  details: { count: aliases.length, aliases },
                };
              }

              // Monitoring operations
              case "get_metrics": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const now = Date.now();
                const metrics = await lambdaManager.getMetrics({
                  functionName,
                  startTime: params.startTime ? new Date(params.startTime as number) : new Date(now - 3600000),
                  endTime: params.endTime ? new Date(params.endTime as number) : new Date(now),
                  region,
                });

                const summary = Object.entries(metrics.metrics)
                  .map(([k, v]) => `• ${k}: ${v}`)
                  .join("\n") || "No metrics available.";

                return {
                  content: [{ type: "text", text: `Metrics for ${functionName}:\n\n${summary}` }],
                  details: metrics,
                };
              }

              case "get_logs": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const now = Date.now();
                const logs = await lambdaManager.getLogs({
                  functionName,
                  startTime: params.startTime as number || (now - 3600000),
                  endTime: params.endTime as number || now,
                  filterPattern: params.filterPattern as string,
                  limit: params.limit as number || 50,
                  region,
                });

                const summary = logs.length === 0
                  ? "No logs found."
                  : logs.map(l => `[${new Date(l.timestamp || 0).toISOString()}] ${l.message}`).join("\n");

                return {
                  content: [{ type: "text", text: `Logs for ${functionName}:\n\n${summary}` }],
                  details: { count: logs.length, logs },
                };
              }

              case "get_recent_log_streams": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const streams = await lambdaManager.getRecentLogStreams(
                  functionName,
                  params.limit as number || 5,
                  region
                );

                const summary = streams.length === 0
                  ? "No log streams found."
                  : streams.map(s => `• ${s.logStreamName}`).join("\n");

                return {
                  content: [{ type: "text", text: `Recent Log Streams for ${functionName}:\n\n${summary}` }],
                  details: { count: streams.length, streams },
                };
              }

              // Cold start optimization operations
              case "set_reserved_concurrency": {
                const functionName = params.functionName as string;
                const reservedConcurrency = params.reservedConcurrency as number;
                if (!functionName || reservedConcurrency === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and reservedConcurrency are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.setReservedConcurrency(functionName, reservedConcurrency, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_reserved_concurrency": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.deleteReservedConcurrency(functionName, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "get_reserved_concurrency": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const config = await lambdaManager.getReservedConcurrency(functionName, region);
                if (!config) {
                  return {
                    content: [{ type: "text", text: `No reserved concurrency configured for '${functionName}'` }],
                    details: { error: "not_found" },
                  };
                }

                return {
                  content: [{ type: "text", text: `Reserved Concurrency for ${functionName}: ${config.reservedConcurrentExecutions}` }],
                  details: config,
                };
              }

              case "set_provisioned_concurrency": {
                const functionName = params.functionName as string;
                const qualifier = params.qualifier as string;
                const provisionedConcurrency = params.provisionedConcurrency as number;
                if (!functionName || !qualifier || provisionedConcurrency === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: functionName, qualifier, and provisionedConcurrency are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.setProvisionedConcurrency({
                  functionName,
                  qualifier,
                  provisionedConcurrentExecutions: provisionedConcurrency,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_provisioned_concurrency": {
                const functionName = params.functionName as string;
                const qualifier = params.qualifier as string;
                if (!functionName || !qualifier) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and qualifier are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.deleteProvisionedConcurrency(functionName, qualifier, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "list_provisioned_concurrency_configs": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const configs = await lambdaManager.listProvisionedConcurrencyConfigs({ functionName, region });
                const summary = configs.length === 0
                  ? "No provisioned concurrency configurations found."
                  : configs.map(c =>
                      `• ${c.qualifier}: ${c.requestedProvisionedConcurrentExecutions} requested, ${c.availableProvisionedConcurrentExecutions || 0} available (${c.status})`
                    ).join("\n");

                return {
                  content: [{ type: "text", text: `Provisioned Concurrency for ${functionName}:\n\n${summary}` }],
                  details: { count: configs.length, configs },
                };
              }

              case "analyze_cold_starts": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const analysis = await lambdaManager.analyzeColdStarts(functionName, region);
                const summary = [
                  `Cold Start Analysis for ${functionName}`,
                  `Optimization Score: ${analysis.optimizationScore}/100`,
                  "",
                  "Recommendations:",
                  ...analysis.recommendations.map(r => `• ${r}`),
                ].join("\n");

                return {
                  content: [{ type: "text", text: summary }],
                  details: analysis,
                };
              }

              case "warmup_function": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.warmupFunction({
                  functionName,
                  concurrency: params.warmupConcurrency as number || 1,
                  payload: params.payload as string,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Function URL operations
              case "create_function_url": {
                const functionName = params.functionName as string;
                const authType = params.authType as 'NONE' | 'AWS_IAM';
                if (!functionName || !authType) {
                  return {
                    content: [{ type: "text", text: "Error: functionName and authType are required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.createFunctionUrl({
                  functionName,
                  qualifier: params.qualifier as string,
                  authType,
                  cors: params.allowOrigins ? {
                    allowOrigins: params.allowOrigins as string[],
                    allowMethods: params.allowMethods as string[],
                  } : undefined,
                  region,
                });

                const urlData = result.data as { functionUrl?: string } | undefined;
                return {
                  content: [{ type: "text", text: result.message + (urlData?.functionUrl ? `\nURL: ${urlData.functionUrl}` : '') }],
                  details: result,
                };
              }

              case "update_function_url": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.updateFunctionUrl({
                  functionName,
                  qualifier: params.qualifier as string,
                  authType: params.authType as 'NONE' | 'AWS_IAM',
                  cors: params.allowOrigins ? {
                    allowOrigins: params.allowOrigins as string[],
                    allowMethods: params.allowMethods as string[],
                  } : undefined,
                  region,
                });

                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_function_url": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const result = await lambdaManager.deleteFunctionUrl(functionName, params.qualifier as string, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "get_function_url": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const url = await lambdaManager.getFunctionUrl(functionName, params.qualifier as string, region);
                if (!url) {
                  return {
                    content: [{ type: "text", text: `No function URL configured for '${functionName}'` }],
                    details: { error: "not_found" },
                  };
                }

                return {
                  content: [{ type: "text", text: `Function URL: ${url.functionUrl}\nAuth Type: ${url.authType}` }],
                  details: { url },
                };
              }

              case "list_function_urls": {
                const functionName = params.functionName as string;
                if (!functionName) {
                  return {
                    content: [{ type: "text", text: "Error: functionName is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                const urls = await lambdaManager.listFunctionUrls({ functionName, region });
                const summary = urls.length === 0
                  ? "No function URLs found."
                  : urls.map(u => `• ${u.functionUrl} (${u.authType})`).join("\n");

                return {
                  content: [{ type: "text", text: `Function URLs for ${functionName}:\n\n${summary}` }],
                  details: { count: urls.length, urls },
                };
              }

              // Account operations
              case "get_account_settings": {
                const settings = await lambdaManager.getAccountSettings(region);
                const summary = [
                  "Lambda Account Settings:",
                  "",
                  "Limits:",
                  `• Concurrent Executions: ${settings.accountLimit?.concurrentExecutions}`,
                  `• Unreserved Concurrent Executions: ${settings.accountLimit?.unreservedConcurrentExecutions}`,
                  `• Total Code Size: ${Math.round((settings.accountLimit?.totalCodeSize || 0) / 1024 / 1024 / 1024)}GB`,
                  "",
                  "Usage:",
                  `• Function Count: ${settings.accountUsage?.functionCount}`,
                  `• Total Code Size: ${Math.round((settings.accountUsage?.totalCodeSize || 0) / 1024 / 1024)}MB`,
                ].join("\n");

                return {
                  content: [{ type: "text", text: summary }],
                  details: settings,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `Lambda error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_lambda" },
    );

    // =========================================================================
    // AWS S3 AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        description: `AWS S3 bucket and object management tool. Manage S3 buckets, objects, versioning, encryption, lifecycle policies, website hosting, CloudFront distributions, replication, and event notifications.

IMPORTANT: Always specify the region parameter for operations unless using the default region.

Available actions:
- list_buckets: List all S3 buckets
- get_bucket_details: Get comprehensive bucket details including all configurations
- create_bucket: Create a new S3 bucket
- delete_bucket: Delete an empty S3 bucket
- bucket_exists: Check if a bucket exists
- list_objects: List objects in a bucket
- upload_object: Upload an object to S3
- download_object: Download an object from S3
- delete_object: Delete an object
- delete_objects: Delete multiple objects
- copy_object: Copy an object
- get_presigned_url: Generate presigned URL for upload/download
- get_versioning: Get bucket versioning status
- set_versioning: Enable or suspend versioning
- get_encryption: Get bucket encryption configuration
- set_encryption: Set bucket encryption
- get_public_access_block: Get public access block settings
- set_public_access_block: Configure public access block
- get_lifecycle: Get lifecycle configuration
- set_lifecycle: Set lifecycle rules
- delete_lifecycle: Delete lifecycle configuration
- get_website: Get website hosting configuration
- set_website: Enable static website hosting
- delete_website: Delete website configuration
- get_cors: Get CORS configuration
- set_cors: Set CORS rules
- delete_cors: Delete CORS configuration
- get_replication: Get cross-region replication configuration
- set_replication: Configure cross-region replication
- delete_replication: Delete replication configuration
- get_notifications: Get event notification configuration
- set_notifications: Configure event notifications
- list_cloudfront: List CloudFront distributions
- get_cloudfront: Get CloudFront distribution details
- create_cloudfront: Create CloudFront distribution for S3 bucket
- empty_bucket: Empty a bucket (delete all objects)
- get_bucket_tags: Get bucket tags
- set_bucket_tags: Set bucket tags
- get_bucket_policy: Get bucket policy
- set_bucket_policy: Set bucket policy`,
        inputSchema: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              description: "The S3 action to perform",
              enum: [
                "list_buckets",
                "get_bucket_details",
                "create_bucket",
                "delete_bucket",
                "bucket_exists",
                "list_objects",
                "upload_object",
                "download_object",
                "delete_object",
                "delete_objects",
                "copy_object",
                "get_presigned_url",
                "get_versioning",
                "set_versioning",
                "get_encryption",
                "set_encryption",
                "get_public_access_block",
                "set_public_access_block",
                "get_lifecycle",
                "set_lifecycle",
                "delete_lifecycle",
                "get_website",
                "set_website",
                "delete_website",
                "get_cors",
                "set_cors",
                "delete_cors",
                "get_replication",
                "set_replication",
                "delete_replication",
                "get_notifications",
                "set_notifications",
                "list_cloudfront",
                "get_cloudfront",
                "create_cloudfront",
                "empty_bucket",
                "get_bucket_tags",
                "set_bucket_tags",
                "get_bucket_policy",
                "set_bucket_policy",
              ],
            },
            region: {
              type: "string",
              description: "AWS region (e.g., us-east-1, eu-west-1)",
            },
            bucket_name: {
              type: "string",
              description: "S3 bucket name",
            },
            key: {
              type: "string",
              description: "Object key (path within the bucket)",
            },
            body: {
              type: "string",
              description: "Object content for upload",
            },
            content_type: {
              type: "string",
              description: "MIME type of the object",
            },
            prefix: {
              type: "string",
              description: "Prefix to filter objects",
            },
            max_keys: {
              type: "number",
              description: "Maximum number of objects to return",
            },
            version_id: {
              type: "string",
              description: "Object version ID",
            },
            storage_class: {
              type: "string",
              description: "Storage class (STANDARD, INTELLIGENT_TIERING, STANDARD_IA, ONEZONE_IA, GLACIER, GLACIER_IR, DEEP_ARCHIVE)",
              enum: ["STANDARD", "INTELLIGENT_TIERING", "STANDARD_IA", "ONEZONE_IA", "GLACIER", "GLACIER_IR", "DEEP_ARCHIVE"],
            },
            source_bucket: {
              type: "string",
              description: "Source bucket for copy operations",
            },
            source_key: {
              type: "string",
              description: "Source key for copy operations",
            },
            destination_bucket: {
              type: "string",
              description: "Destination bucket for copy operations",
            },
            destination_key: {
              type: "string",
              description: "Destination key for copy operations",
            },
            presigned_operation: {
              type: "string",
              description: "Operation type for presigned URL (getObject or putObject)",
              enum: ["getObject", "putObject"],
            },
            expires_in: {
              type: "number",
              description: "Presigned URL expiration time in seconds (default: 3600)",
            },
            versioning_status: {
              type: "string",
              description: "Versioning status to set",
              enum: ["Enabled", "Suspended"],
            },
            sse_algorithm: {
              type: "string",
              description: "Server-side encryption algorithm",
              enum: ["AES256", "aws:kms", "aws:kms:dsse"],
            },
            kms_key_id: {
              type: "string",
              description: "KMS key ID for encryption",
            },
            bucket_key_enabled: {
              type: "boolean",
              description: "Enable S3 Bucket Key for KMS encryption",
            },
            block_public_acls: {
              type: "boolean",
              description: "Block public ACLs",
            },
            ignore_public_acls: {
              type: "boolean",
              description: "Ignore public ACLs",
            },
            block_public_policy: {
              type: "boolean",
              description: "Block public bucket policies",
            },
            restrict_public_buckets: {
              type: "boolean",
              description: "Restrict public buckets",
            },
            lifecycle_rules: {
              type: "array",
              description: "Lifecycle rules configuration",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  status: { type: "string", enum: ["Enabled", "Disabled"] },
                  prefix: { type: "string" },
                  expiration_days: { type: "number" },
                  transition_days: { type: "number" },
                  transition_storage_class: { type: "string" },
                },
              },
            },
            index_document: {
              type: "string",
              description: "Index document suffix for website hosting (e.g., index.html)",
            },
            error_document: {
              type: "string",
              description: "Error document key for website hosting (e.g., error.html)",
            },
            cors_rules: {
              type: "array",
              description: "CORS configuration rules",
              items: {
                type: "object",
                properties: {
                  allowed_origins: { type: "array", items: { type: "string" } },
                  allowed_methods: { type: "array", items: { type: "string" } },
                  allowed_headers: { type: "array", items: { type: "string" } },
                  max_age_seconds: { type: "number" },
                },
              },
            },
            replication_role: {
              type: "string",
              description: "IAM role ARN for replication",
            },
            replication_rules: {
              type: "array",
              description: "Replication rules",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  status: { type: "string", enum: ["Enabled", "Disabled"] },
                  destination_bucket: { type: "string" },
                  priority: { type: "number" },
                },
              },
            },
            notification_lambda_arn: {
              type: "string",
              description: "Lambda function ARN for event notifications",
            },
            notification_events: {
              type: "array",
              description: "S3 events to trigger notifications",
              items: { type: "string" },
            },
            notification_prefix: {
              type: "string",
              description: "Object key prefix filter for notifications",
            },
            notification_suffix: {
              type: "string",
              description: "Object key suffix filter for notifications",
            },
            eventbridge_enabled: {
              type: "boolean",
              description: "Enable EventBridge notifications",
            },
            distribution_id: {
              type: "string",
              description: "CloudFront distribution ID",
            },
            cloudfront_comment: {
              type: "string",
              description: "Comment for CloudFront distribution",
            },
            default_root_object: {
              type: "string",
              description: "Default root object for CloudFront (e.g., index.html)",
            },
            aliases: {
              type: "array",
              description: "Custom domain aliases for CloudFront",
              items: { type: "string" },
            },
            acm_certificate_arn: {
              type: "string",
              description: "ACM certificate ARN for HTTPS",
            },
            tags: {
              type: "object",
              description: "Tags as key-value pairs",
              additionalProperties: { type: "string" },
            },
            policy: {
              type: "string",
              description: "Bucket policy JSON document",
            },
            objects_to_delete: {
              type: "array",
              description: "Array of objects to delete",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  version_id: { type: "string" },
                },
              },
            },
          },
          required: ["action"],
        },
        async execute(params: {
          action: string;
          region?: string;
          bucket_name?: string;
          key?: string;
          body?: string;
          content_type?: string;
          prefix?: string;
          max_keys?: number;
          version_id?: string;
          storage_class?: string;
          source_bucket?: string;
          source_key?: string;
          destination_bucket?: string;
          destination_key?: string;
          presigned_operation?: string;
          expires_in?: number;
          versioning_status?: string;
          sse_algorithm?: string;
          kms_key_id?: string;
          bucket_key_enabled?: boolean;
          block_public_acls?: boolean;
          ignore_public_acls?: boolean;
          block_public_policy?: boolean;
          restrict_public_buckets?: boolean;
          lifecycle_rules?: Array<{
            id?: string;
            status?: string;
            prefix?: string;
            expiration_days?: number;
            transition_days?: number;
            transition_storage_class?: string;
          }>;
          index_document?: string;
          error_document?: string;
          cors_rules?: Array<{
            allowed_origins?: string[];
            allowed_methods?: string[];
            allowed_headers?: string[];
            max_age_seconds?: number;
          }>;
          replication_role?: string;
          replication_rules?: Array<{
            id?: string;
            status?: string;
            destination_bucket?: string;
            priority?: number;
          }>;
          notification_lambda_arn?: string;
          notification_events?: string[];
          notification_prefix?: string;
          notification_suffix?: string;
          eventbridge_enabled?: boolean;
          distribution_id?: string;
          cloudfront_comment?: string;
          default_root_object?: string;
          aliases?: string[];
          acm_certificate_arn?: string;
          tags?: Record<string, string>;
          policy?: string;
          objects_to_delete?: Array<{ key: string; version_id?: string }>;
        }) {
          if (!s3Manager) {
            return {
              content: [{ type: "text", text: "S3 manager not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const { action, region, bucket_name, key } = params;

          try {
            switch (action) {
              // Bucket Operations
              case "list_buckets": {
                const buckets = await s3Manager.listBuckets(region);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Found ${buckets.length} S3 buckets:\n${buckets
                        .map((b) => `• ${b.name} (created: ${b.creationDate?.toISOString() || "unknown"})`)
                        .join("\n")}`,
                    },
                  ],
                  details: { buckets },
                };
              }

              case "bucket_exists": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const exists = await s3Manager.bucketExists(bucket_name, region);
                return {
                  content: [
                    {
                      type: "text",
                      text: exists
                        ? `Bucket '${bucket_name}' exists`
                        : `Bucket '${bucket_name}' does not exist`,
                    },
                  ],
                  details: { exists },
                };
              }

              case "get_bucket_details": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const details = await s3Manager.getBucketDetails(bucket_name, region);
                if (!details) {
                  return {
                    content: [{ type: "text", text: `Bucket '${bucket_name}' not found` }],
                    details: { error: "bucket_not_found" },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `Bucket '${bucket_name}' details:\n` +
                        `  Region: ${details.region || "unknown"}\n` +
                        `  Versioning: ${details.versioning || "not configured"}\n` +
                        `  Encryption: ${details.encryption?.rules?.[0]?.applyServerSideEncryptionByDefault?.sseAlgorithm || "not configured"}\n` +
                        `  Website: ${details.website ? "enabled" : "not configured"}\n` +
                        `  Lifecycle rules: ${details.lifecycle?.rules?.length || 0}\n` +
                        `  Tags: ${Object.keys(details.tags || {}).length}`,
                    },
                  ],
                  details,
                };
              }

              case "create_bucket": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const result = await s3Manager.createBucket({
                  bucketName: bucket_name,
                  region,
                });
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              case "delete_bucket": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const result = await s3Manager.deleteBucket(bucket_name, region);
                return {
                  content: [{ type: "text", text: result.message }],
                  details: result,
                };
              }

              // Object Operations
              case "list_objects": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const listResult = await s3Manager.listObjects({
                  bucketName: bucket_name,
                  prefix: params.prefix,
                  maxKeys: params.max_keys,
                  region,
                });
                return {
                  content: [
                    {
                      type: "text",
                      text: `Found ${listResult.objects.length} objects in '${bucket_name}'${params.prefix ? ` with prefix '${params.prefix}'` : ""}:\n` +
                        listResult.objects.slice(0, 20).map((o) => `• ${o.key} (${o.size || 0} bytes)`).join("\n") +
                        (listResult.objects.length > 20 ? `\n... and ${listResult.objects.length - 20} more` : ""),
                    },
                  ],
                  details: listResult,
                };
              }

              case "upload_object": {
                if (!bucket_name || !key) {
                  return {
                    content: [{ type: "text", text: "bucket_name and key are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const uploadResult = await s3Manager.uploadObject({
                  bucketName: bucket_name,
                  key,
                  body: params.body || "",
                  contentType: params.content_type,
                  storageClass: params.storage_class as "STANDARD" | "INTELLIGENT_TIERING" | "STANDARD_IA" | "ONEZONE_IA" | "GLACIER" | "GLACIER_IR" | "DEEP_ARCHIVE",
                  region,
                });
                return {
                  content: [{ type: "text", text: uploadResult.message }],
                  details: uploadResult,
                };
              }

              case "download_object": {
                if (!bucket_name || !key) {
                  return {
                    content: [{ type: "text", text: "bucket_name and key are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const downloadResult = await s3Manager.downloadObject({
                  bucketName: bucket_name,
                  key,
                  versionId: params.version_id,
                  region,
                });
                // Return as text if reasonable size, otherwise just metadata
                const contentStr = downloadResult.body.length < 10000
                  ? downloadResult.body.toString("utf-8")
                  : `[Binary content: ${downloadResult.body.length} bytes]`;
                return {
                  content: [
                    {
                      type: "text",
                      text: `Downloaded '${key}':\n` +
                        `Content-Type: ${downloadResult.contentType || "unknown"}\n` +
                        `Size: ${downloadResult.contentLength || downloadResult.body.length} bytes\n` +
                        `Content:\n${contentStr}`,
                    },
                  ],
                  details: {
                    contentType: downloadResult.contentType,
                    contentLength: downloadResult.contentLength,
                    eTag: downloadResult.eTag,
                    lastModified: downloadResult.lastModified,
                  },
                };
              }

              case "delete_object": {
                if (!bucket_name || !key) {
                  return {
                    content: [{ type: "text", text: "bucket_name and key are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const deleteResult = await s3Manager.deleteObject({
                  bucketName: bucket_name,
                  key,
                  versionId: params.version_id,
                  region,
                });
                return {
                  content: [{ type: "text", text: deleteResult.message }],
                  details: deleteResult,
                };
              }

              case "delete_objects": {
                if (!bucket_name || !params.objects_to_delete) {
                  return {
                    content: [{ type: "text", text: "bucket_name and objects_to_delete are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const deleteMultiResult = await s3Manager.deleteObjects({
                  bucketName: bucket_name,
                  objects: params.objects_to_delete.map((o) => ({
                    key: o.key,
                    versionId: o.version_id,
                  })),
                  region,
                });
                return {
                  content: [{ type: "text", text: deleteMultiResult.message }],
                  details: deleteMultiResult,
                };
              }

              case "copy_object": {
                if (!params.source_bucket || !params.source_key || !params.destination_bucket || !params.destination_key) {
                  return {
                    content: [{ type: "text", text: "source_bucket, source_key, destination_bucket, and destination_key are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const copyResult = await s3Manager.copyObject({
                  sourceBucket: params.source_bucket,
                  sourceKey: params.source_key,
                  destinationBucket: params.destination_bucket,
                  destinationKey: params.destination_key,
                  storageClass: params.storage_class as "STANDARD" | "INTELLIGENT_TIERING" | "STANDARD_IA" | "ONEZONE_IA" | "GLACIER" | "GLACIER_IR" | "DEEP_ARCHIVE",
                  region,
                });
                return {
                  content: [{ type: "text", text: copyResult.message }],
                  details: copyResult,
                };
              }

              case "get_presigned_url": {
                if (!bucket_name || !key || !params.presigned_operation) {
                  return {
                    content: [{ type: "text", text: "bucket_name, key, and presigned_operation are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const presignedResult = await s3Manager.getPresignedUrl({
                  bucketName: bucket_name,
                  key,
                  operation: params.presigned_operation as "getObject" | "putObject",
                  expiresIn: params.expires_in || 3600,
                  contentType: params.content_type,
                  region,
                });
                return {
                  content: [
                    {
                      type: "text",
                      text: `Presigned URL for ${params.presigned_operation} on '${key}':\n` +
                        `URL: ${presignedResult.url}\n` +
                        `Expires: ${presignedResult.expiresAt.toISOString()}`,
                    },
                  ],
                  details: presignedResult,
                };
              }

              // Versioning
              case "get_versioning": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const versioningStatus = await s3Manager.getVersioning(bucket_name, region);
                return {
                  content: [{ type: "text", text: `Versioning status for '${bucket_name}': ${versioningStatus}` }],
                  details: { status: versioningStatus },
                };
              }

              case "set_versioning": {
                if (!bucket_name || !params.versioning_status) {
                  return {
                    content: [{ type: "text", text: "bucket_name and versioning_status are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const versioningResult = await s3Manager.setVersioning({
                  bucketName: bucket_name,
                  status: params.versioning_status as "Enabled" | "Suspended",
                  region,
                });
                return {
                  content: [{ type: "text", text: versioningResult.message }],
                  details: versioningResult,
                };
              }

              // Encryption
              case "get_encryption": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const encryption = await s3Manager.getEncryption(bucket_name, region);
                if (!encryption) {
                  return {
                    content: [{ type: "text", text: `No encryption configuration for '${bucket_name}'` }],
                    details: { encryption: null },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `Encryption for '${bucket_name}':\n` +
                        encryption.rules.map((r) =>
                          `  Algorithm: ${r.applyServerSideEncryptionByDefault?.sseAlgorithm || "none"}\n` +
                          `  KMS Key: ${r.applyServerSideEncryptionByDefault?.kmsMasterKeyId || "none"}\n` +
                          `  Bucket Key: ${r.bucketKeyEnabled ? "enabled" : "disabled"}`
                        ).join("\n"),
                    },
                  ],
                  details: encryption,
                };
              }

              case "set_encryption": {
                if (!bucket_name || !params.sse_algorithm) {
                  return {
                    content: [{ type: "text", text: "bucket_name and sse_algorithm are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const encryptionResult = await s3Manager.setEncryption({
                  bucketName: bucket_name,
                  sseAlgorithm: params.sse_algorithm as "AES256" | "aws:kms" | "aws:kms:dsse",
                  kmsMasterKeyId: params.kms_key_id,
                  bucketKeyEnabled: params.bucket_key_enabled,
                  region,
                });
                return {
                  content: [{ type: "text", text: encryptionResult.message }],
                  details: encryptionResult,
                };
              }

              // Public Access Block
              case "get_public_access_block": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const publicAccess = await s3Manager.getPublicAccessBlock(bucket_name, region);
                if (!publicAccess) {
                  return {
                    content: [{ type: "text", text: `No public access block for '${bucket_name}'` }],
                    details: { publicAccessBlock: null },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `Public access block for '${bucket_name}':\n` +
                        `  Block public ACLs: ${publicAccess.blockPublicAcls}\n` +
                        `  Ignore public ACLs: ${publicAccess.ignorePublicAcls}\n` +
                        `  Block public policy: ${publicAccess.blockPublicPolicy}\n` +
                        `  Restrict public buckets: ${publicAccess.restrictPublicBuckets}`,
                    },
                  ],
                  details: publicAccess,
                };
              }

              case "set_public_access_block": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const publicAccessResult = await s3Manager.setPublicAccessBlock({
                  bucketName: bucket_name,
                  blockPublicAcls: params.block_public_acls ?? true,
                  ignorePublicAcls: params.ignore_public_acls ?? true,
                  blockPublicPolicy: params.block_public_policy ?? true,
                  restrictPublicBuckets: params.restrict_public_buckets ?? true,
                  region,
                });
                return {
                  content: [{ type: "text", text: publicAccessResult.message }],
                  details: publicAccessResult,
                };
              }

              // Lifecycle
              case "get_lifecycle": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const lifecycle = await s3Manager.getLifecycleConfiguration(bucket_name, region);
                if (!lifecycle) {
                  return {
                    content: [{ type: "text", text: `No lifecycle configuration for '${bucket_name}'` }],
                    details: { lifecycle: null },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `Lifecycle rules for '${bucket_name}':\n` +
                        lifecycle.rules.map((r) =>
                          `• ${r.id || "unnamed"} (${r.status})\n` +
                          `  Prefix: ${r.filter?.prefix || r.prefix || "*"}\n` +
                          (r.expiration ? `  Expiration: ${r.expiration.days} days\n` : "") +
                          (r.transitions?.length ? `  Transitions: ${r.transitions.map((t) => `${t.days}d → ${t.storageClass}`).join(", ")}\n` : "")
                        ).join("\n"),
                    },
                  ],
                  details: lifecycle,
                };
              }

              case "set_lifecycle": {
                if (!bucket_name || !params.lifecycle_rules) {
                  return {
                    content: [{ type: "text", text: "bucket_name and lifecycle_rules are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const lifecycleResult = await s3Manager.setLifecycleConfiguration({
                  bucketName: bucket_name,
                  rules: params.lifecycle_rules.map((r) => ({
                    id: r.id,
                    status: (r.status as "Enabled" | "Disabled") || "Enabled",
                    filter: r.prefix ? { prefix: r.prefix } : undefined,
                    expiration: r.expiration_days ? { days: r.expiration_days } : undefined,
                    transitions: r.transition_days && r.transition_storage_class
                      ? [{ days: r.transition_days, storageClass: r.transition_storage_class as "STANDARD" | "INTELLIGENT_TIERING" | "STANDARD_IA" | "ONEZONE_IA" | "GLACIER" | "GLACIER_IR" | "DEEP_ARCHIVE" }]
                      : undefined,
                  })),
                  region,
                });
                return {
                  content: [{ type: "text", text: lifecycleResult.message }],
                  details: lifecycleResult,
                };
              }

              case "delete_lifecycle": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const deleteLifecycleResult = await s3Manager.deleteLifecycleConfiguration(bucket_name, region);
                return {
                  content: [{ type: "text", text: deleteLifecycleResult.message }],
                  details: deleteLifecycleResult,
                };
              }

              // Website Hosting
              case "get_website": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const website = await s3Manager.getWebsiteConfiguration(bucket_name, region);
                if (!website) {
                  return {
                    content: [{ type: "text", text: `No website configuration for '${bucket_name}'` }],
                    details: { website: null },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `Website configuration for '${bucket_name}':\n` +
                        `  Index document: ${website.indexDocument?.suffix || "not set"}\n` +
                        `  Error document: ${website.errorDocument?.key || "not set"}\n` +
                        (website.redirectAllRequestsTo ? `  Redirect: ${website.redirectAllRequestsTo.protocol}://${website.redirectAllRequestsTo.hostName}` : ""),
                    },
                  ],
                  details: website,
                };
              }

              case "set_website": {
                if (!bucket_name || !params.index_document) {
                  return {
                    content: [{ type: "text", text: "bucket_name and index_document are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const websiteResult = await s3Manager.setWebsiteConfiguration({
                  bucketName: bucket_name,
                  indexDocument: params.index_document,
                  errorDocument: params.error_document,
                  region,
                });
                return {
                  content: [{ type: "text", text: websiteResult.message }],
                  details: websiteResult,
                };
              }

              case "delete_website": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const deleteWebsiteResult = await s3Manager.deleteWebsiteConfiguration(bucket_name, region);
                return {
                  content: [{ type: "text", text: deleteWebsiteResult.message }],
                  details: deleteWebsiteResult,
                };
              }

              // CORS
              case "get_cors": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const cors = await s3Manager.getCors(bucket_name, region);
                if (!cors) {
                  return {
                    content: [{ type: "text", text: `No CORS configuration for '${bucket_name}'` }],
                    details: { cors: null },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `CORS rules for '${bucket_name}':\n` +
                        cors.corsRules.map((r) =>
                          `• ${r.id || "unnamed"}\n` +
                          `  Origins: ${r.allowedOrigins.join(", ")}\n` +
                          `  Methods: ${r.allowedMethods.join(", ")}\n` +
                          `  Headers: ${r.allowedHeaders?.join(", ") || "*"}`
                        ).join("\n"),
                    },
                  ],
                  details: cors,
                };
              }

              case "set_cors": {
                if (!bucket_name || !params.cors_rules) {
                  return {
                    content: [{ type: "text", text: "bucket_name and cors_rules are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const corsResult = await s3Manager.setCors({
                  bucketName: bucket_name,
                  corsRules: params.cors_rules.map((r) => ({
                    allowedOrigins: r.allowed_origins || ["*"],
                    allowedMethods: (r.allowed_methods || ["GET", "HEAD"]) as Array<"GET" | "PUT" | "POST" | "DELETE" | "HEAD">,
                    allowedHeaders: r.allowed_headers,
                    maxAgeSeconds: r.max_age_seconds,
                  })),
                  region,
                });
                return {
                  content: [{ type: "text", text: corsResult.message }],
                  details: corsResult,
                };
              }

              case "delete_cors": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const deleteCorsResult = await s3Manager.deleteCors(bucket_name, region);
                return {
                  content: [{ type: "text", text: deleteCorsResult.message }],
                  details: deleteCorsResult,
                };
              }

              // Replication
              case "get_replication": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const replication = await s3Manager.getReplicationConfiguration(bucket_name, region);
                if (!replication) {
                  return {
                    content: [{ type: "text", text: `No replication configuration for '${bucket_name}'` }],
                    details: { replication: null },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `Replication for '${bucket_name}':\n` +
                        `Role: ${replication.role}\n` +
                        `Rules:\n` +
                        replication.rules.map((r) =>
                          `• ${r.id || "unnamed"} (${r.status})\n` +
                          `  Destination: ${r.destination.bucket}\n` +
                          `  Priority: ${r.priority || "not set"}`
                        ).join("\n"),
                    },
                  ],
                  details: replication,
                };
              }

              case "set_replication": {
                if (!bucket_name || !params.replication_role || !params.replication_rules) {
                  return {
                    content: [{ type: "text", text: "bucket_name, replication_role, and replication_rules are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const replicationResult = await s3Manager.setReplicationConfiguration({
                  bucketName: bucket_name,
                  role: params.replication_role,
                  rules: params.replication_rules.map((r) => ({
                    id: r.id,
                    status: (r.status as "Enabled" | "Disabled") || "Enabled",
                    priority: r.priority,
                    destination: {
                      bucket: r.destination_bucket || "",
                    },
                  })),
                  region,
                });
                return {
                  content: [{ type: "text", text: replicationResult.message }],
                  details: replicationResult,
                };
              }

              case "delete_replication": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const deleteReplicationResult = await s3Manager.deleteReplicationConfiguration(bucket_name, region);
                return {
                  content: [{ type: "text", text: deleteReplicationResult.message }],
                  details: deleteReplicationResult,
                };
              }

              // Notifications
              case "get_notifications": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const notifications = await s3Manager.getNotificationConfiguration(bucket_name, region);
                const total =
                  (notifications.topicConfigurations?.length || 0) +
                  (notifications.queueConfigurations?.length || 0) +
                  (notifications.lambdaFunctionConfigurations?.length || 0);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Notifications for '${bucket_name}':\n` +
                        `  Topic configurations: ${notifications.topicConfigurations?.length || 0}\n` +
                        `  Queue configurations: ${notifications.queueConfigurations?.length || 0}\n` +
                        `  Lambda configurations: ${notifications.lambdaFunctionConfigurations?.length || 0}\n` +
                        `  EventBridge: ${notifications.eventBridgeConfiguration ? "enabled" : "disabled"}`,
                    },
                  ],
                  details: { notifications, total },
                };
              }

              case "set_notifications": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }

                // Build filter if prefix or suffix provided
                const filter = (params.notification_prefix || params.notification_suffix)
                  ? {
                      key: {
                        filterRules: [
                          ...(params.notification_prefix ? [{ name: "prefix" as const, value: params.notification_prefix }] : []),
                          ...(params.notification_suffix ? [{ name: "suffix" as const, value: params.notification_suffix }] : []),
                        ],
                      },
                    }
                  : undefined;

                const notificationResult = await s3Manager.setNotificationConfiguration({
                  bucketName: bucket_name,
                  lambdaFunctionConfigurations: params.notification_lambda_arn
                    ? [
                        {
                          lambdaFunctionArn: params.notification_lambda_arn,
                          events: (params.notification_events || ["s3:ObjectCreated:*"]) as Array<
                            "s3:ObjectCreated:*" | "s3:ObjectCreated:Put" | "s3:ObjectCreated:Post" | "s3:ObjectCreated:Copy" | "s3:ObjectCreated:CompleteMultipartUpload" | "s3:ObjectRemoved:*" | "s3:ObjectRemoved:Delete" | "s3:ObjectRemoved:DeleteMarkerCreated"
                          >,
                          filter,
                        },
                      ]
                    : undefined,
                  eventBridgeEnabled: params.eventbridge_enabled,
                  region,
                });
                return {
                  content: [{ type: "text", text: notificationResult.message }],
                  details: notificationResult,
                };
              }

              // CloudFront
              case "list_cloudfront": {
                const distributions = await s3Manager.listCloudFrontDistributions(region);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Found ${distributions.length} CloudFront distributions:\n` +
                        distributions.map((d) =>
                          `• ${d.id}: ${d.domainName} (${d.status}, ${d.enabled ? "enabled" : "disabled"})`
                        ).join("\n"),
                    },
                  ],
                  details: { distributions },
                };
              }

              case "get_cloudfront": {
                if (!params.distribution_id) {
                  return {
                    content: [{ type: "text", text: "distribution_id is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const distribution = await s3Manager.getCloudFrontDistribution(params.distribution_id, region);
                if (!distribution) {
                  return {
                    content: [{ type: "text", text: `Distribution '${params.distribution_id}' not found` }],
                    details: { distribution: null },
                  };
                }
                return {
                  content: [
                    {
                      type: "text",
                      text: `CloudFront distribution '${distribution.id}':\n` +
                        `  Domain: ${distribution.domainName}\n` +
                        `  Status: ${distribution.status}\n` +
                        `  Enabled: ${distribution.enabled}\n` +
                        `  Comment: ${distribution.comment || "none"}\n` +
                        `  Aliases: ${distribution.aliases?.join(", ") || "none"}`,
                    },
                  ],
                  details: distribution,
                };
              }

              case "create_cloudfront": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const cloudfrontResult = await s3Manager.createCloudFrontDistribution({
                  bucketName: bucket_name,
                  comment: params.cloudfront_comment,
                  defaultRootObject: params.default_root_object,
                  aliases: params.aliases,
                  acmCertificateArn: params.acm_certificate_arn,
                  region,
                });
                return {
                  content: [{ type: "text", text: cloudfrontResult.message }],
                  details: cloudfrontResult,
                };
              }

              // Empty bucket
              case "empty_bucket": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const emptyResult = await s3Manager.emptyBucket(bucket_name, region);
                return {
                  content: [{ type: "text", text: emptyResult.message }],
                  details: emptyResult,
                };
              }

              // Tags
              case "get_bucket_tags": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const bucketTags = await s3Manager.getBucketTags(bucket_name, region);
                const tagCount = Object.keys(bucketTags).length;
                return {
                  content: [
                    {
                      type: "text",
                      text: tagCount > 0
                        ? `Tags for '${bucket_name}':\n` + Object.entries(bucketTags).map(([k, v]) => `  ${k}: ${v}`).join("\n")
                        : `No tags for '${bucket_name}'`,
                    },
                  ],
                  details: { tags: bucketTags },
                };
              }

              case "set_bucket_tags": {
                if (!bucket_name || !params.tags) {
                  return {
                    content: [{ type: "text", text: "bucket_name and tags are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const setTagsResult = await s3Manager.setBucketTags(bucket_name, params.tags, region);
                return {
                  content: [{ type: "text", text: setTagsResult.message }],
                  details: setTagsResult,
                };
              }

              // Policy
              case "get_bucket_policy": {
                if (!bucket_name) {
                  return {
                    content: [{ type: "text", text: "bucket_name is required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const bucketPolicy = await s3Manager.getBucketPolicy(bucket_name, region);
                return {
                  content: [
                    {
                      type: "text",
                      text: bucketPolicy
                        ? `Policy for '${bucket_name}':\n${bucketPolicy}`
                        : `No policy for '${bucket_name}'`,
                    },
                  ],
                  details: { policy: bucketPolicy },
                };
              }

              case "set_bucket_policy": {
                if (!bucket_name || !params.policy) {
                  return {
                    content: [{ type: "text", text: "bucket_name and policy are required" }],
                    details: { error: "missing_parameter" },
                  };
                }
                const setPolicyResult = await s3Manager.setBucketPolicy(bucket_name, params.policy, region);
                return {
                  content: [{ type: "text", text: setPolicyResult.message }],
                  details: setPolicyResult,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `S3 error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_s3" },
    );

    // =========================================================================
    // AWS IaC (Infrastructure as Code) AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        name: "aws_iac",
        label: "AWS Infrastructure as Code",
        description: `Generate and manage Infrastructure as Code (IaC) for AWS resources.

CAPABILITIES:
- Generate Terraform HCL configurations from resource definitions
- Generate CloudFormation YAML/JSON templates
- Detect drift between IaC and deployed resources
- Export existing AWS infrastructure to IaC format
- Plan infrastructure changes before applying

SUPPORTED RESOURCE TYPES:
- EC2: Instances, VPCs, Subnets, Security Groups, Key Pairs, NAT Gateways
- RDS: Database Instances, Clusters, Subnet Groups, Parameter Groups
- S3: Buckets with versioning, encryption, lifecycle policies
- Lambda: Functions with VPC config, layers, environment variables
- IAM: Roles, Policies, Instance Profiles
- Load Balancing: ALBs, Target Groups, Listeners
- Auto Scaling: Groups, Launch Templates
- Others: CloudWatch, SNS, SQS, DynamoDB, ElastiCache, KMS

Use this tool to:
- Create IaC from natural language infrastructure descriptions
- Export existing infrastructure for version control
- Ensure consistent, repeatable infrastructure deployments`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "generate_terraform",
                "generate_cloudformation",
                "detect_drift",
                "export_state",
                "plan_changes",
              ],
              description: "The IaC operation to perform",
            },
            // Template definition for generation
            template_name: {
              type: "string",
              description: "Name for the infrastructure template",
            },
            template_description: {
              type: "string",
              description: "Description of the infrastructure",
            },
            // Resource definitions
            resources: {
              type: "array",
              description: "Array of resource definitions to include in the template",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    description: "Resource type (ec2_instance, ec2_vpc, ec2_subnet, ec2_security_group, rds_instance, s3_bucket, lambda_function, iam_role, alb, asg, etc.)",
                  },
                  name: {
                    type: "string",
                    description: "Logical name for the resource",
                  },
                  properties: {
                    type: "object",
                    description: "Resource-specific properties",
                  },
                  tags: {
                    type: "object",
                    description: "Tags to apply to the resource",
                  },
                  depends_on: {
                    type: "array",
                    items: { type: "string" },
                    description: "Resource dependencies",
                  },
                },
              },
            },
            // Variables/Parameters
            variables: {
              type: "object",
              description: "Template variables/parameters",
            },
            // Outputs
            outputs: {
              type: "object",
              description: "Template outputs to export",
            },
            // Generation options
            format: {
              type: "string",
              enum: ["terraform", "cloudformation"],
              description: "IaC format to generate",
            },
            cloudformation_format: {
              type: "string",
              enum: ["yaml", "json"],
              description: "CloudFormation output format (default: yaml)",
            },
            include_comments: {
              type: "boolean",
              description: "Include comments in generated code (default: true)",
            },
            split_files: {
              type: "boolean",
              description: "Split Terraform into multiple files (default: false)",
            },
            // Terraform-specific options
            terraform_version: {
              type: "string",
              description: "Terraform version constraint (default: >= 1.0)",
            },
            aws_provider_version: {
              type: "string",
              description: "AWS provider version constraint (default: ~> 5.0)",
            },
            backend_type: {
              type: "string",
              enum: ["s3", "local", "remote"],
              description: "Terraform backend type",
            },
            backend_config: {
              type: "object",
              description: "Terraform backend configuration",
            },
            // Export/drift options
            resource_ids: {
              type: "array",
              items: { type: "string" },
              description: "Specific resource IDs to export or check for drift",
            },
            resource_types: {
              type: "array",
              items: { type: "string" },
              description: "Resource types to export or check",
            },
            iac_path: {
              type: "string",
              description: "Path to IaC files for drift detection",
            },
            // Common options
            region: {
              type: "string",
              description: "AWS region",
            },
            profile: {
              type: "string",
              description: "AWS profile",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!iacManager) {
            return {
              content: [{ type: "text", text: "Error: IaC manager not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const region = params.region as string | undefined;

          try {
            switch (action) {
              case "generate_terraform": {
                const resources = params.resources as Array<{
                  type: string;
                  name: string;
                  properties: Record<string, unknown>;
                  tags?: Record<string, string>;
                  depends_on?: string[];
                }> | undefined;

                if (!resources || resources.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: resources array is required for generate_terraform" }],
                    details: { error: "missing_resources" },
                  };
                }

                const template: InfrastructureTemplate = {
                  name: (params.template_name as string) || "generated-infrastructure",
                  description: params.template_description as string,
                  resources: resources.map(r => ({
                    type: r.type as AWSResourceType,
                    name: r.name,
                    properties: r.properties,
                    tags: r.tags,
                    dependsOn: r.depends_on,
                  })),
                  variables: params.variables as Record<string, TemplateVariable> | undefined,
                  outputs: params.outputs as Record<string, TemplateOutput> | undefined,
                };

                const result = await iacManager.generateTerraform(template, {
                  terraformVersion: params.terraform_version as string,
                  awsProviderVersion: params.aws_provider_version as string,
                  includeComments: params.include_comments as boolean ?? true,
                  splitFiles: params.split_files as boolean,
                  includeVariables: !!params.variables,
                  includeOutputs: !!params.outputs,
                  region: region,
                  profile: params.profile as string,
                  backend: params.backend_type ? {
                    type: params.backend_type as "s3" | "local" | "remote",
                    config: (params.backend_config as Record<string, unknown>) || {},
                  } : undefined,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to generate Terraform: ${result.errors?.join(", ")}` }],
                    details: result,
                  };
                }

                // Build response with all generated files
                const filesOutput = result.files
                  ? Object.entries(result.files).map(([filename, content]) => 
                      `--- ${filename} ---\n${content}`
                    ).join("\n\n")
                  : result.mainTf || "";

                return {
                  content: [{ 
                    type: "text", 
                    text: `✅ ${result.message}\n\n${filesOutput}` 
                  }],
                  details: result,
                };
              }

              case "generate_cloudformation": {
                const resources = params.resources as Array<{
                  type: string;
                  name: string;
                  properties: Record<string, unknown>;
                  tags?: Record<string, string>;
                  depends_on?: string[];
                }> | undefined;

                if (!resources || resources.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: resources array is required for generate_cloudformation" }],
                    details: { error: "missing_resources" },
                  };
                }

                const template: InfrastructureTemplate = {
                  name: (params.template_name as string) || "generated-infrastructure",
                  description: params.template_description as string,
                  resources: resources.map(r => ({
                    type: r.type as AWSResourceType,
                    name: r.name,
                    properties: r.properties,
                    tags: r.tags,
                    dependsOn: r.depends_on,
                  })),
                  variables: params.variables as Record<string, TemplateVariable> | undefined,
                  outputs: params.outputs as Record<string, TemplateOutput> | undefined,
                };

                const result = await iacManager.generateCloudFormation(template, {
                  format: (params.cloudformation_format as "yaml" | "json") || "yaml",
                  description: params.template_description as string,
                  includeComments: params.include_comments as boolean ?? true,
                  includeParameters: !!params.variables,
                  region: region,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to generate CloudFormation: ${result.errors?.join(", ")}` }],
                    details: result,
                  };
                }

                return {
                  content: [{ 
                    type: "text", 
                    text: `✅ ${result.message}\n\n${result.template}` 
                  }],
                  details: result,
                };
              }

              case "detect_drift": {
                const result = await iacManager.detectDrift({
                  resourceIds: params.resource_ids as string[],
                  resourceTypes: params.resource_types as AWSResourceType[],
                  region: region,
                  iacPath: params.iac_path as string,
                  format: params.format as "terraform" | "cloudformation",
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Drift detection failed: ${result.errors?.join(", ")}` }],
                    details: result,
                  };
                }

                const statusEmoji = result.status === "clean" ? "✅" : result.status === "drifted" ? "⚠️" : "❌";
                
                let driftSummary = `${statusEmoji} ${result.message}\n\n`;
                driftSummary += `Total Resources: ${result.totalResources}\n`;
                driftSummary += `In Sync: ${result.inSyncCount}\n`;
                driftSummary += `Drifted: ${result.driftedCount}\n`;
                driftSummary += `Deleted: ${result.deletedCount}\n`;

                if (result.drifts.length > 0) {
                  driftSummary += "\nDrifted Resources:\n";
                  for (const drift of result.drifts) {
                    driftSummary += `• ${drift.resourceId} (${drift.resourceType}): ${drift.status}\n`;
                    if (drift.changes) {
                      for (const change of drift.changes) {
                        driftSummary += `  - ${change.property}: ${change.expected} → ${change.actual}\n`;
                      }
                    }
                  }
                }

                return {
                  content: [{ type: "text", text: driftSummary }],
                  details: result,
                };
              }

              case "export_state": {
                const format = (params.format as "terraform" | "cloudformation") || "terraform";
                
                const result = await iacManager.exportState({
                  resourceIds: params.resource_ids as string[],
                  resourceTypes: params.resource_types as AWSResourceType[],
                  regions: region ? [region] : undefined,
                  format,
                  includeTags: true,
                  includeDependencies: true,
                  terraformOptions: format === "terraform" ? {
                    terraformVersion: params.terraform_version as string,
                    awsProviderVersion: params.aws_provider_version as string,
                    includeComments: params.include_comments as boolean ?? true,
                    region: region,
                  } : undefined,
                  cloudFormationOptions: format === "cloudformation" ? {
                    format: (params.cloudformation_format as "yaml" | "json") || "yaml",
                    includeComments: params.include_comments as boolean ?? true,
                    region: region,
                  } : undefined,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Export failed: ${result.errors?.join(", ")}` }],
                    details: result,
                  };
                }

                let exportOutput = `✅ ${result.message}\n\n`;
                
                if (result.iacCode) {
                  exportOutput += `Generated ${format} code:\n\n${result.iacCode}`;
                }

                if (result.importCommands && result.importCommands.length > 0) {
                  exportOutput += "\n\nTerraform Import Commands:\n";
                  exportOutput += result.importCommands.join("\n");
                }

                return {
                  content: [{ type: "text", text: exportOutput }],
                  details: result,
                };
              }

              case "plan_changes": {
                const resources = params.resources as Array<{
                  type: string;
                  name: string;
                  properties: Record<string, unknown>;
                  tags?: Record<string, string>;
                  depends_on?: string[];
                }> | undefined;

                if (!resources || resources.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: resources array is required for plan_changes" }],
                    details: { error: "missing_resources" },
                  };
                }

                const template: InfrastructureTemplate = {
                  name: (params.template_name as string) || "infrastructure-plan",
                  description: params.template_description as string,
                  resources: resources.map(r => ({
                    type: r.type as AWSResourceType,
                    name: r.name,
                    properties: r.properties,
                    tags: r.tags,
                    dependsOn: r.depends_on,
                  })),
                };

                const format = (params.format as "terraform" | "cloudformation") || "terraform";
                const result = await iacManager.planChanges(template, { format, region });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Plan failed: ${result.errors?.join(", ")}` }],
                    details: result,
                  };
                }

                let planOutput = `📋 Infrastructure Plan\n\n`;
                planOutput += `${result.message}\n\n`;
                
                if (result.toCreate.length > 0) {
                  planOutput += `➕ Resources to Create (${result.toCreate.length}):\n`;
                  for (const r of result.toCreate) {
                    planOutput += `  • ${r.logicalName} (${r.resourceType})\n`;
                  }
                }
                
                if (result.toUpdate.length > 0) {
                  planOutput += `\n🔄 Resources to Update (${result.toUpdate.length}):\n`;
                  for (const r of result.toUpdate) {
                    planOutput += `  • ${r.logicalName} (${r.resourceType})\n`;
                  }
                }
                
                if (result.toDelete.length > 0) {
                  planOutput += `\n➖ Resources to Delete (${result.toDelete.length}):\n`;
                  for (const r of result.toDelete) {
                    planOutput += `  • ${r.logicalName} (${r.resourceType})\n`;
                  }
                }

                if (result.warnings && result.warnings.length > 0) {
                  planOutput += `\n⚠️ Warnings:\n`;
                  for (const w of result.warnings) {
                    planOutput += `  • ${w}\n`;
                  }
                }

                return {
                  content: [{ type: "text", text: planOutput }],
                  details: result,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `IaC error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_iac" },
    );

    // =========================================================================
    // AWS COST MANAGEMENT AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        name: "aws_cost",
        label: "AWS Cost Management",
        description: `Analyze and optimize AWS costs with comprehensive cost management capabilities.

CAPABILITIES:
- Get cost summaries and breakdowns by service, account, region
- Forecast future AWS spending based on historical trends
- Get rightsizing, Reserved Instance, and Savings Plan recommendations
- Find unused resources (EBS volumes, Elastic IPs, snapshots, etc.)
- Schedule EC2/RDS instances for cost savings (start/stop schedules)
- Create and manage AWS budgets with alerts

Use this tool to:
- Answer questions about AWS spending ("How much did we spend on EC2 last month?")
- Identify cost optimization opportunities
- Find and eliminate waste from unused resources
- Set up automated schedules to stop non-production resources after hours
- Create budget alerts to prevent overspending`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "get_cost_summary",
                "forecast_costs",
                "get_optimization_recommendations",
                "find_unused_resources",
                "schedule_resources",
                "execute_schedule_action",
                "create_budget",
                "list_budgets",
                "delete_budget",
                "get_savings_plan_recommendations",
              ],
              description: "The cost management operation to perform",
            },
            // Time period options
            start_date: {
              type: "string",
              description: "Start date for cost query (YYYY-MM-DD format)",
            },
            end_date: {
              type: "string",
              description: "End date for cost query (YYYY-MM-DD format)",
            },
            // Cost summary options
            granularity: {
              type: "string",
              enum: ["DAILY", "MONTHLY", "HOURLY"],
              description: "Granularity for cost data (default: DAILY)",
            },
            group_by: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["DIMENSION", "TAG", "COST_CATEGORY"] },
                  key: { type: "string" },
                },
              },
              description: "Group costs by dimensions (SERVICE, REGION, LINKED_ACCOUNT, etc.) or tags",
            },
            metric: {
              type: "string",
              enum: ["BlendedCost", "UnblendedCost", "AmortizedCost", "NetAmortizedCost"],
              description: "Cost metric to use (default: UnblendedCost)",
            },
            // Filter options
            filter_dimension: {
              type: "string",
              description: "Dimension to filter by (SERVICE, REGION, LINKED_ACCOUNT, etc.)",
            },
            filter_values: {
              type: "array",
              items: { type: "string" },
              description: "Values to filter by",
            },
            // Optimization options
            recommendation_types: {
              type: "array",
              items: { type: "string", enum: ["rightsizing", "reserved_instances", "savings_plans"] },
              description: "Types of recommendations to get",
            },
            min_monthly_savings: {
              type: "number",
              description: "Minimum monthly savings threshold for recommendations",
            },
            // Unused resources options
            resource_types: {
              type: "array",
              items: {
                type: "string",
                enum: ["ebs_volume", "eip", "snapshot", "load_balancer", "ec2_instance", "lambda_function"],
              },
              description: "Resource types to check for unused resources",
            },
            min_age_days: {
              type: "number",
              description: "Minimum age in days to consider a resource unused (default: 30)",
            },
            // Scheduling options
            resource_ids: {
              type: "array",
              items: { type: "string" },
              description: "Resource IDs to schedule or act upon",
            },
            resource_type: {
              type: "string",
              enum: ["ec2", "rds", "asg"],
              description: "Type of resource for scheduling",
            },
            schedule_name: {
              type: "string",
              description: "Name for the schedule",
            },
            start_cron: {
              type: "string",
              description: "Cron expression for start time (e.g., '0 8 * * 1-5' for 8am Mon-Fri)",
            },
            stop_cron: {
              type: "string",
              description: "Cron expression for stop time (e.g., '0 18 * * 1-5' for 6pm Mon-Fri)",
            },
            timezone: {
              type: "string",
              description: "Timezone for schedule (default: UTC)",
            },
            schedule_action: {
              type: "string",
              enum: ["start", "stop"],
              description: "Action to execute immediately (for execute_schedule_action)",
            },
            // Budget options
            budget_name: {
              type: "string",
              description: "Name for the budget",
            },
            budget_type: {
              type: "string",
              enum: ["COST", "USAGE", "RI_UTILIZATION", "RI_COVERAGE", "SAVINGS_PLANS_UTILIZATION", "SAVINGS_PLANS_COVERAGE"],
              description: "Type of budget to create",
            },
            limit_amount: {
              type: "number",
              description: "Budget limit amount in dollars",
            },
            time_unit: {
              type: "string",
              enum: ["DAILY", "MONTHLY", "QUARTERLY", "ANNUALLY"],
              description: "Budget time unit",
            },
            alert_thresholds: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  threshold: { type: "number" },
                  threshold_type: { type: "string", enum: ["PERCENTAGE", "ABSOLUTE_VALUE"] },
                  notification_type: { type: "string", enum: ["ACTUAL", "FORECASTED"] },
                  email_addresses: { type: "array", items: { type: "string" } },
                },
              },
              description: "Alert configuration for budget notifications",
            },
            // Common options
            region: {
              type: "string",
              description: "AWS region (use 'all' for multi-region operations)",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!costManager) {
            return {
              content: [{ type: "text", text: "Error: Cost manager not initialized" }],
              details: { error: "not_initialized" },
            };
          }

          const action = params.action as string;
          const region = params.region as string | undefined;

          try {
            switch (action) {
              case "get_cost_summary": {
                const startDate = params.start_date as string;
                const endDate = params.end_date as string;

                if (!startDate || !endDate) {
                  // Default to last 30 days
                  const now = new Date();
                  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                  const defaultStartDate = thirtyDaysAgo.toISOString().split("T")[0];
                  const defaultEndDate = now.toISOString().split("T")[0];

                  const result = await costManager.getCostSummary({
                    timePeriod: {
                      start: startDate || defaultStartDate,
                      end: endDate || defaultEndDate,
                    },
                    granularity: (params.granularity as "DAILY" | "MONTHLY" | "HOURLY") || "DAILY",
                    groupBy: params.group_by as Array<{ type: "DIMENSION" | "TAG" | "COST_CATEGORY"; key: string }>,
                    filter: params.filter_dimension
                      ? {
                          dimension: params.filter_dimension as any,
                          values: params.filter_values as string[],
                        }
                      : undefined,
                    metrics: params.metric ? [params.metric as any] : undefined,
                    region,
                  });

                  if (!result.success) {
                    return {
                      content: [{ type: "text", text: `Failed to get cost summary: ${result.error}` }],
                      details: result,
                    };
                  }

                  let output = `💰 AWS Cost Summary\n\n`;
                  output += `📅 Period: ${result.data!.timePeriod.start} to ${result.data!.timePeriod.end}\n`;
                  output += `💵 Total Cost: $${result.data!.totalCost.toFixed(2)} ${result.data!.currency}\n\n`;

                  if (result.data!.topServices && result.data!.topServices.length > 0) {
                    output += `📊 Top Services:\n`;
                    for (const svc of result.data!.topServices.slice(0, 5)) {
                      output += `  • ${svc.service}: $${svc.cost.toFixed(2)} (${svc.percentage.toFixed(1)}%)\n`;
                    }
                  }

                  if (result.data!.groups && result.data!.groups.length > 0) {
                    output += `\n📈 Breakdown:\n`;
                    for (const group of result.data!.groups.slice(0, 10)) {
                      output += `  • ${group.key}: $${group.total.toFixed(2)}\n`;
                    }
                  }

                  return {
                    content: [{ type: "text", text: output }],
                    details: result.data,
                  };
                }

                const result = await costManager.getCostSummary({
                  timePeriod: { start: startDate, end: endDate },
                  granularity: (params.granularity as "DAILY" | "MONTHLY" | "HOURLY") || "DAILY",
                  groupBy: params.group_by as Array<{ type: "DIMENSION" | "TAG" | "COST_CATEGORY"; key: string }>,
                  filter: params.filter_dimension
                    ? {
                        dimension: params.filter_dimension as any,
                        values: params.filter_values as string[],
                      }
                    : undefined,
                  metrics: params.metric ? [params.metric as any] : undefined,
                  region,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get cost summary: ${result.error}` }],
                    details: result,
                  };
                }

                let output = `💰 AWS Cost Summary\n\n`;
                output += `📅 Period: ${result.data!.timePeriod.start} to ${result.data!.timePeriod.end}\n`;
                output += `💵 Total Cost: $${result.data!.totalCost.toFixed(2)} ${result.data!.currency}\n\n`;

                if (result.data!.topServices && result.data!.topServices.length > 0) {
                  output += `📊 Top Services:\n`;
                  for (const svc of result.data!.topServices.slice(0, 5)) {
                    output += `  • ${svc.service}: $${svc.cost.toFixed(2)} (${svc.percentage.toFixed(1)}%)\n`;
                  }
                }

                if (result.data!.groups && result.data!.groups.length > 0) {
                  output += `\n📈 Breakdown:\n`;
                  for (const group of result.data!.groups.slice(0, 10)) {
                    output += `  • ${group.key}: $${group.total.toFixed(2)}\n`;
                  }
                }

                return {
                  content: [{ type: "text", text: output }],
                  details: result.data,
                };
              }

              case "forecast_costs": {
                let startDate = params.start_date as string;
                let endDate = params.end_date as string;

                // Default forecast period: next 30 days
                if (!startDate) {
                  const now = new Date();
                  startDate = now.toISOString().split("T")[0];
                }
                if (!endDate) {
                  const now = new Date();
                  now.setDate(now.getDate() + 30);
                  endDate = now.toISOString().split("T")[0];
                }

                const result = await costManager.forecastCosts({
                  startDate,
                  endDate,
                  granularity: (params.granularity as "DAILY" | "MONTHLY") || "MONTHLY",
                  metric: params.metric as any,
                  region,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to forecast costs: ${result.error}` }],
                    details: result,
                  };
                }

                let output = `📈 AWS Cost Forecast\n\n`;
                output += `📅 Period: ${result.data!.timePeriod.start} to ${result.data!.timePeriod.end}\n`;
                output += `🔮 Forecasted Cost: $${result.data!.forecastedTotal.toFixed(2)} ${result.data!.currency}\n`;
                output += `📊 Confidence: ${result.data!.predictionIntervalLevel}%\n`;

                if (result.data!.comparison) {
                  const trend = result.data!.comparison.trend;
                  const trendEmoji = trend === "increasing" ? "📈" : trend === "decreasing" ? "📉" : "➡️";
                  output += `\n${trendEmoji} Trend: ${trend} (${result.data!.comparison.percentageChange.toFixed(1)}% vs previous period)\n`;
                  output += `   Previous period: $${result.data!.comparison.previousPeriodCost.toFixed(2)}\n`;
                }

                return {
                  content: [{ type: "text", text: output }],
                  details: result.data,
                };
              }

              case "get_optimization_recommendations": {
                const result = await costManager.getOptimizationRecommendations({
                  types: params.recommendation_types as any[],
                  minMonthlySavings: params.min_monthly_savings as number,
                  region,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get recommendations: ${result.error}` }],
                    details: result,
                  };
                }

                let output = `💡 Cost Optimization Recommendations\n\n`;
                output += `💰 Total Potential Monthly Savings: $${result.data!.totalPotentialMonthlySavings.toFixed(2)}\n\n`;

                // Rightsizing
                if (result.data!.rightsizing.length > 0) {
                  output += `📐 Rightsizing Recommendations (${result.data!.summary.rightsizingCount}):\n`;
                  output += `   Potential savings: $${result.data!.summary.rightsizingSavings.toFixed(2)}/month\n`;
                  for (const rec of result.data!.rightsizing.slice(0, 5)) {
                    output += `   • ${rec.resourceId}: ${rec.currentInstanceType} → ${rec.recommendedInstanceType}\n`;
                    output += `     Save $${rec.estimatedMonthlySavings.toFixed(2)}/month (${rec.savingsPercentage.toFixed(0)}%)\n`;
                  }
                  output += `\n`;
                }

                // Reserved Instances
                if (result.data!.reservedInstances.length > 0) {
                  output += `📋 Reserved Instance Recommendations (${result.data!.summary.reservedInstancesCount}):\n`;
                  output += `   Potential savings: $${result.data!.summary.reservedInstancesSavings.toFixed(2)}/month\n`;
                  for (const rec of result.data!.reservedInstances.slice(0, 5)) {
                    output += `   • ${rec.instanceType || rec.instanceTypeFamily} (${rec.region}): ${rec.recommendedQuantity} units\n`;
                    output += `     Save $${rec.estimatedMonthlySavings.toFixed(2)}/month (${rec.savingsPercentage.toFixed(0)}%)\n`;
                  }
                  output += `\n`;
                }

                // Savings Plans
                if (result.data!.savingsPlans.length > 0) {
                  output += `💳 Savings Plans Recommendations (${result.data!.summary.savingsPlansCount}):\n`;
                  output += `   Potential savings: $${result.data!.summary.savingsPlansSavings.toFixed(2)}/month\n`;
                  for (const rec of result.data!.savingsPlans.slice(0, 3)) {
                    output += `   • ${rec.savingsPlanType} ${rec.term}: $${rec.hourlyCommitment.toFixed(2)}/hour commitment\n`;
                    output += `     Save $${rec.estimatedMonthlySavings.toFixed(2)}/month (${rec.savingsPercentage.toFixed(0)}%)\n`;
                  }
                }

                if (result.warnings && result.warnings.length > 0) {
                  output += `\n⚠️ Warnings:\n`;
                  for (const w of result.warnings) {
                    output += `   • ${w}\n`;
                  }
                }

                return {
                  content: [{ type: "text", text: output }],
                  details: result.data,
                };
              }

              case "find_unused_resources": {
                const result = await costManager.findUnusedResources({
                  resourceTypes: params.resource_types as any[],
                  minAgeDays: params.min_age_days as number,
                  region: region || "us-east-1",
                  includeCostEstimates: true,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to find unused resources: ${result.error}` }],
                    details: result,
                  };
                }

                let output = `🗑️ Unused Resources\n\n`;
                output += `📊 Found: ${result.data!.totalCount} unused resources\n`;
                output += `💰 Estimated Monthly Cost: $${result.data!.totalEstimatedMonthlyCost.toFixed(2)}\n\n`;

                // By type
                output += `📦 By Resource Type:\n`;
                for (const [type, info] of Object.entries(result.data!.byType)) {
                  if (info.count > 0) {
                    output += `   • ${type}: ${info.count} ($${info.estimatedMonthlyCost.toFixed(2)}/month)\n`;
                  }
                }

                // Top unused resources
                if (result.data!.resources.length > 0) {
                  output += `\n🔍 Top Unused Resources:\n`;
                  for (const resource of result.data!.resources.slice(0, 10)) {
                    output += `   • ${resource.resourceId} (${resource.resourceType})\n`;
                    output += `     ${resource.reason}\n`;
                    if (resource.estimatedMonthlyCost) {
                      output += `     Cost: $${resource.estimatedMonthlyCost.toFixed(2)}/month\n`;
                    }
                    output += `     Action: ${resource.recommendedAction}\n`;
                  }
                }

                return {
                  content: [{ type: "text", text: output }],
                  details: result.data,
                };
              }

              case "schedule_resources": {
                const resourceIds = params.resource_ids as string[];
                const resourceType = params.resource_type as "ec2" | "rds" | "asg";
                const scheduleName = params.schedule_name as string;

                if (!resourceIds || resourceIds.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: resource_ids array is required" }],
                    details: { error: "missing_resource_ids" },
                  };
                }

                if (!resourceType) {
                  return {
                    content: [{ type: "text", text: "Error: resource_type is required (ec2, rds, or asg)" }],
                    details: { error: "missing_resource_type" },
                  };
                }

                if (!scheduleName) {
                  return {
                    content: [{ type: "text", text: "Error: schedule_name is required" }],
                    details: { error: "missing_schedule_name" },
                  };
                }

                const result = await costManager.scheduleResources({
                  resourceIds,
                  resourceType,
                  schedule: {
                    name: scheduleName,
                    startCron: params.start_cron as string,
                    stopCron: params.stop_cron as string,
                    timezone: (params.timezone as string) || "UTC",
                    enabled: true,
                  },
                  region,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to schedule resources: ${result.error}` }],
                    details: result,
                  };
                }

                let output = `⏰ Resource Scheduling Result\n\n`;
                output += `✅ Scheduled: ${result.data!.scheduledResources.length} resources\n`;
                output += `💰 Estimated Monthly Savings: $${result.data!.totalEstimatedMonthlySavings.toFixed(2)}\n\n`;

                for (const sr of result.data!.scheduledResources) {
                  output += `• ${sr.resourceId} (${sr.resourceType})\n`;
                  output += `  Schedule: ${sr.scheduleName}\n`;
                  if (sr.nextStartTime) {
                    output += `  Next start: ${sr.nextStartTime.toISOString()}\n`;
                  }
                  if (sr.nextStopTime) {
                    output += `  Next stop: ${sr.nextStopTime.toISOString()}\n`;
                  }
                }

                if (result.data!.failedResources.length > 0) {
                  output += `\n❌ Failed (${result.data!.failedResources.length}):\n`;
                  for (const failed of result.data!.failedResources) {
                    output += `• ${failed.resourceId}: ${failed.error}\n`;
                  }
                }

                return {
                  content: [{ type: "text", text: output }],
                  details: result.data,
                };
              }

              case "execute_schedule_action": {
                const resourceIds = params.resource_ids as string[] | undefined;
                const resourceId = resourceIds?.[0];
                const resourceType = params.resource_type as "ec2" | "rds";
                const scheduleAction = params.schedule_action as "start" | "stop";

                if (!resourceId) {
                  return {
                    content: [{ type: "text", text: "Error: resource_ids[0] is required" }],
                    details: { error: "missing_resource_id" },
                  };
                }

                if (!resourceType || !["ec2", "rds"].includes(resourceType)) {
                  return {
                    content: [{ type: "text", text: "Error: resource_type must be 'ec2' or 'rds'" }],
                    details: { error: "invalid_resource_type" },
                  };
                }

                if (!scheduleAction || !["start", "stop"].includes(scheduleAction)) {
                  return {
                    content: [{ type: "text", text: "Error: schedule_action must be 'start' or 'stop'" }],
                    details: { error: "invalid_action" },
                  };
                }

                const result = await costManager.executeScheduleAction(
                  resourceId,
                  resourceType,
                  scheduleAction,
                  region
                );

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to ${scheduleAction} resource: ${result.error}` }],
                    details: result,
                  };
                }

                const emoji = scheduleAction === "start" ? "▶️" : "⏹️";
                return {
                  content: [{
                    type: "text",
                    text: `${emoji} ${result.message}\n\nResource: ${result.data!.resourceId}\nAction: ${result.data!.action}\nNew State: ${result.data!.newState}`,
                  }],
                  details: result.data,
                };
              }

              case "create_budget": {
                const budgetName = params.budget_name as string;
                const budgetType = params.budget_type as any;
                const limitAmount = params.limit_amount as number;
                const timeUnit = params.time_unit as any;

                if (!budgetName) {
                  return {
                    content: [{ type: "text", text: "Error: budget_name is required" }],
                    details: { error: "missing_budget_name" },
                  };
                }

                if (!limitAmount) {
                  return {
                    content: [{ type: "text", text: "Error: limit_amount is required" }],
                    details: { error: "missing_limit_amount" },
                  };
                }

                const alertThresholds = params.alert_thresholds as Array<{
                  threshold: number;
                  threshold_type: string;
                  notification_type: string;
                  email_addresses?: string[];
                }>;

                const result = await costManager.createBudget({
                  name: budgetName,
                  budgetType: budgetType || "COST",
                  limitAmount,
                  timeUnit: timeUnit || "MONTHLY",
                  alerts: alertThresholds?.map(a => ({
                    threshold: a.threshold,
                    thresholdType: a.threshold_type as any,
                    notificationType: a.notification_type as any,
                    comparisonOperator: "GREATER_THAN" as const,
                    emailAddresses: a.email_addresses,
                  })),
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create budget: ${result.error}` }],
                    details: result,
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Budget Created\n\nName: ${result.data!.budget!.name}\nType: ${result.data!.budget!.budgetType}\nLimit: $${result.data!.budget!.limitAmount} ${result.data!.budget!.currency}\nTime Unit: ${result.data!.budget!.timeUnit}`,
                  }],
                  details: result.data,
                };
              }

              case "list_budgets": {
                const result = await costManager.listBudgets();

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list budgets: ${result.error}` }],
                    details: result,
                  };
                }

                let output = `📊 AWS Budgets (${result.data!.totalCount})\n\n`;

                for (const budget of result.data!.budgets) {
                  const statusEmoji = budget.status === "CRITICAL" ? "🔴" : budget.status === "WARNING" ? "🟡" : "🟢";
                  output += `${statusEmoji} ${budget.name}\n`;
                  output += `   Type: ${budget.budgetType}\n`;
                  output += `   Limit: $${budget.limitAmount} ${budget.currency} (${budget.timeUnit})\n`;
                  output += `   Spent: $${budget.actualSpend.toFixed(2)} (${budget.percentageUsed.toFixed(1)}%)\n`;
                  if (budget.forecastedSpend) {
                    output += `   Forecast: $${budget.forecastedSpend.toFixed(2)}\n`;
                  }
                  output += `\n`;
                }

                return {
                  content: [{ type: "text", text: output }],
                  details: result.data,
                };
              }

              case "delete_budget": {
                const budgetName = params.budget_name as string;

                if (!budgetName) {
                  return {
                    content: [{ type: "text", text: "Error: budget_name is required" }],
                    details: { error: "missing_budget_name" },
                  };
                }

                const result = await costManager.deleteBudget(budgetName);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete budget: ${result.error}` }],
                    details: result,
                  };
                }

                return {
                  content: [{ type: "text", text: `✅ Budget "${budgetName}" deleted successfully` }],
                  details: result.data,
                };
              }

              case "get_savings_plan_recommendations": {
                const result = await costManager.getSavingsPlansRecommendations();

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get Savings Plan recommendations: ${result.error}` }],
                    details: result,
                  };
                }

                let output = `💳 Savings Plan Recommendations\n\n`;

                if (result.data!.length === 0) {
                  output += `No Savings Plan recommendations available at this time.\n`;
                } else {
                  for (const rec of result.data!) {
                    output += `• ${rec.savingsPlanType} (${rec.term})\n`;
                    output += `  Hourly Commitment: $${rec.hourlyCommitment.toFixed(2)}\n`;
                    output += `  Estimated Monthly Savings: $${rec.estimatedMonthlySavings.toFixed(2)}\n`;
                    output += `  Savings: ${rec.savingsPercentage.toFixed(0)}%\n\n`;
                  }
                }

                return {
                  content: [{ type: "text", text: output }],
                  details: result.data,
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `Cost management error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_cost" },
    );

    // =========================================================================
    // AWS SECURITY AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        name: "aws_security",
        label: "AWS Security & IAM Management",
        description: `Manage AWS IAM roles, policies, and security services including Security Hub, GuardDuty, KMS, Secrets Manager, and Access Analyzer.

CAPABILITIES:
- IAM role and user management (create, list, delete, attach policies)
- IAM policy management with predefined templates
- Policy simulation for permission testing
- Security Hub findings and compliance standards
- GuardDuty threat detection and findings
- KMS key management with rotation
- Secrets Manager for secure credential storage
- Access Analyzer for external access findings
- Security posture overview across all services

Use this tool to:
- Create IAM roles for Lambda, EC2, ECS with best practices
- Manage IAM policies and test permissions
- View and remediate Security Hub findings
- Monitor GuardDuty threat detections
- Manage KMS encryption keys
- Store and rotate secrets securely
- Find publicly accessible resources
- Get overall security posture summary`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "list_roles",
                "get_role",
                "create_role",
                "delete_role",
                "attach_role_policy",
                "detach_role_policy",
                "list_users",
                "get_user",
                "create_user",
                "delete_user",
                "list_policies",
                "get_policy",
                "create_policy",
                "delete_policy",
                "simulate_policy",
                "get_policy_template",
                "list_security_findings",
                "update_security_findings",
                "enable_security_hub",
                "disable_security_hub",
                "list_security_standards",
                "enable_security_standard",
                "list_guardduty_findings",
                "get_guardduty_detector",
                "enable_guardduty",
                "disable_guardduty",
                "archive_guardduty_findings",
                "list_kms_keys",
                "get_kms_key",
                "create_kms_key",
                "schedule_key_deletion",
                "enable_key_rotation",
                "disable_key_rotation",
                "list_secrets",
                "get_secret",
                "get_secret_value",
                "create_secret",
                "update_secret",
                "delete_secret",
                "rotate_secret",
                "list_access_analyzers",
                "list_access_analyzer_findings",
                "create_access_analyzer",
                "delete_access_analyzer",
                "archive_access_analyzer_finding",
                "get_security_posture",
              ],
              description: "The security operation to perform",
            },
            // Common options
            region: {
              type: "string",
              description: "AWS region (defaults to configured region)",
            },
            // IAM Role options
            role_name: {
              type: "string",
              description: "Name of the IAM role",
            },
            trust_policy: {
              type: "object",
              description: "Trust policy document for the role (who can assume it)",
            },
            // IAM User options
            user_name: {
              type: "string",
              description: "Name of the IAM user",
            },
            create_access_key: {
              type: "boolean",
              description: "Whether to create an access key for the user",
            },
            create_login_profile: {
              type: "boolean",
              description: "Whether to create a login profile (console access) for the user",
            },
            // IAM Policy options
            policy_name: {
              type: "string",
              description: "Name of the IAM policy",
            },
            policy_arn: {
              type: "string",
              description: "ARN of the IAM policy",
            },
            policy_document: {
              type: "object",
              description: "IAM policy document with Version and Statement",
            },
            // Policy template options
            template: {
              type: "string",
              enum: [
                "lambda-basic",
                "lambda-vpc",
                "lambda-s3-read",
                "lambda-s3-write",
                "lambda-dynamodb",
                "lambda-sqs",
                "lambda-sns",
                "ec2-ssm",
                "ecs-task",
                "eks-node",
                "s3-read-only",
                "s3-full-access",
                "dynamodb-read-only",
                "dynamodb-full-access",
                "cloudwatch-logs",
                "xray-tracing",
                "secrets-read",
                "kms-encrypt-decrypt",
                "assume-role",
                "cross-account-access",
              ],
              description: "Predefined policy template name",
            },
            template_variables: {
              type: "object",
              description: "Variables to substitute in the policy template (e.g., BUCKET_NAME, TABLE_NAME)",
            },
            // Policy simulation options
            policy_source_arn: {
              type: "string",
              description: "ARN of the principal to simulate (user, role, group)",
            },
            action_names: {
              type: "array",
              items: { type: "string" },
              description: "Actions to simulate (e.g., s3:GetObject, ec2:DescribeInstances)",
            },
            resource_arns: {
              type: "array",
              items: { type: "string" },
              description: "Resource ARNs to test against",
            },
            // Security Hub options
            finding_ids: {
              type: "array",
              items: { type: "string" },
              description: "Security Hub finding IDs to update",
            },
            workflow_status: {
              type: "string",
              enum: ["NEW", "NOTIFIED", "RESOLVED", "SUPPRESSED"],
              description: "Workflow status to set for findings",
            },
            severities: {
              type: "array",
              items: { type: "string", enum: ["INFORMATIONAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"] },
              description: "Filter by severity levels",
            },
            standard_arn: {
              type: "string",
              description: "ARN of the security standard to enable",
            },
            // GuardDuty options
            detector_id: {
              type: "string",
              description: "GuardDuty detector ID",
            },
            guardduty_finding_ids: {
              type: "array",
              items: { type: "string" },
              description: "GuardDuty finding IDs to archive",
            },
            // KMS options
            key_id: {
              type: "string",
              description: "KMS key ID or ARN",
            },
            key_description: {
              type: "string",
              description: "Description for the KMS key",
            },
            key_usage: {
              type: "string",
              enum: ["ENCRYPT_DECRYPT", "SIGN_VERIFY", "GENERATE_VERIFY_MAC"],
              description: "KMS key usage",
            },
            enable_rotation: {
              type: "boolean",
              description: "Enable automatic key rotation",
            },
            pending_window_days: {
              type: "number",
              description: "Days before key deletion (7-30)",
            },
            // Secrets Manager options
            secret_id: {
              type: "string",
              description: "Secret ID or ARN",
            },
            secret_name: {
              type: "string",
              description: "Name for the new secret",
            },
            secret_value: {
              type: "string",
              description: "Secret value (as JSON string for structured secrets)",
            },
            kms_key_id: {
              type: "string",
              description: "KMS key ID for encrypting the secret",
            },
            rotation_lambda_arn: {
              type: "string",
              description: "ARN of Lambda function for secret rotation",
            },
            force_delete: {
              type: "boolean",
              description: "Force delete secret without recovery window",
            },
            // Access Analyzer options
            analyzer_name: {
              type: "string",
              description: "Name of the Access Analyzer",
            },
            analyzer_arn: {
              type: "string",
              description: "ARN of the Access Analyzer",
            },
            analyzer_type: {
              type: "string",
              enum: ["ACCOUNT", "ORGANIZATION"],
              description: "Type of Access Analyzer",
            },
            access_analyzer_finding_id: {
              type: "string",
              description: "Access Analyzer finding ID",
            },
            // Common options
            description: {
              type: "string",
              description: "Description for the resource",
            },
            tags: {
              type: "object",
              description: "Tags to apply to the resource",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return",
            },
          },
          required: ["action"],
        },
        async execute(params: Record<string, unknown>) {
          const action = params.action as string;
          const region = params.region as string | undefined;

          // Initialize security manager if needed
          if (!securityManager) {
            securityManager = createSecurityManager({
              defaultRegion: region || "us-east-1",
            });
          }

          try {
            switch (action) {
              // IAM Role operations
              case "list_roles": {
                const result = await securityManager.listRoles({
                  pathPrefix: params.path_prefix as string,
                  includeAttachedPolicies: true,
                  includeInlinePolicies: true,
                  maxItems: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list roles: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `Found ${result.data!.length} IAM roles:\n\n` +
                      result.data!.map(r =>
                        `• **${r.roleName}**\n  ARN: ${r.arn}\n  Created: ${r.createDate.toISOString()}\n  Attached policies: ${r.attachedPolicies.length}`
                      ).join("\n\n"),
                  }],
                  details: { roles: result.data },
                };
              }

              case "get_role": {
                const roleName = params.role_name as string;
                if (!roleName) {
                  return {
                    content: [{ type: "text", text: "role_name is required" }],
                    details: { error: "missing_role_name" },
                  };
                }
                const result = await securityManager.getRole(roleName);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get role: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const role = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `**IAM Role: ${role.roleName}**\n\n` +
                      `ARN: ${role.arn}\n` +
                      `Created: ${role.createDate.toISOString()}\n` +
                      `Max Session Duration: ${role.maxSessionDuration} seconds\n\n` +
                      `**Attached Policies (${role.attachedPolicies.length}):**\n` +
                      (role.attachedPolicies.length > 0
                        ? role.attachedPolicies.map(p => `• ${p.policyName}`).join("\n")
                        : "None") +
                      `\n\n**Inline Policies (${role.inlinePolicies.length}):**\n` +
                      (role.inlinePolicies.length > 0
                        ? role.inlinePolicies.map(p => `• ${p}`).join("\n")
                        : "None") +
                      `\n\n**Trust Policy:**\n\`\`\`json\n${role.assumeRolePolicyDocument}\n\`\`\``,
                  }],
                  details: { role },
                };
              }

              case "create_role": {
                const roleName = params.role_name as string;
                const trustPolicy = params.trust_policy as object;
                if (!roleName || !trustPolicy) {
                  return {
                    content: [{ type: "text", text: "role_name and trust_policy are required" }],
                    details: { error: "missing_params" },
                  };
                }
                const result = await securityManager.createRole({
                  roleName,
                  trustPolicy: trustPolicy as any,
                  description: params.description as string,
                  tags: params.tags as Record<string, string>,
                  managedPolicyArns: params.policy_arns as string[],
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create role: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Created IAM role **${result.data!.roleName}**\n\nARN: ${result.data!.arn}` }],
                  details: { role: result.data },
                };
              }

              case "delete_role": {
                const roleName = params.role_name as string;
                if (!roleName) {
                  return {
                    content: [{ type: "text", text: "role_name is required" }],
                    details: { error: "missing_role_name" },
                  };
                }
                const result = await securityManager.deleteRole(roleName);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete role: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Deleted IAM role **${roleName}**` }],
                  details: { deleted: roleName },
                };
              }

              case "attach_role_policy": {
                const roleName = params.role_name as string;
                const policyArn = params.policy_arn as string;
                if (!roleName || !policyArn) {
                  return {
                    content: [{ type: "text", text: "role_name and policy_arn are required" }],
                    details: { error: "missing_params" },
                  };
                }
                const result = await securityManager.attachRolePolicy(roleName, policyArn);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to attach policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Attached policy to role **${roleName}**` }],
                  details: { roleName, policyArn },
                };
              }

              case "detach_role_policy": {
                const roleName = params.role_name as string;
                const policyArn = params.policy_arn as string;
                if (!roleName || !policyArn) {
                  return {
                    content: [{ type: "text", text: "role_name and policy_arn are required" }],
                    details: { error: "missing_params" },
                  };
                }
                const result = await securityManager.detachRolePolicy(roleName, policyArn);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to detach policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Detached policy from role **${roleName}**` }],
                  details: { roleName, policyArn },
                };
              }

              // IAM User operations
              case "list_users": {
                const result = await securityManager.listUsers({
                  includeAttachedPolicies: true,
                  includeAccessKeys: true,
                  includeMFADevices: true,
                  maxItems: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list users: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `Found ${result.data!.length} IAM users:\n\n` +
                      result.data!.map(u =>
                        `• **${u.userName}**\n  MFA: ${u.mfaDevices.length > 0 ? "✅" : "❌"}\n  Access Keys: ${u.accessKeys.length}\n  Policies: ${u.attachedPolicies.length}`
                      ).join("\n\n"),
                  }],
                  details: { users: result.data },
                };
              }

              case "get_user": {
                const userName = params.user_name as string;
                if (!userName) {
                  return {
                    content: [{ type: "text", text: "user_name is required" }],
                    details: { error: "missing_user_name" },
                  };
                }
                const result = await securityManager.getUser(userName);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get user: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const user = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `**IAM User: ${user.userName}**\n\n` +
                      `ARN: ${user.arn}\n` +
                      `Created: ${user.createDate.toISOString()}\n` +
                      `MFA Enabled: ${user.mfaDevices.length > 0 ? "✅ Yes" : "❌ No"}\n` +
                      `Access Keys: ${user.accessKeys.length}\n` +
                      `Groups: ${user.groups.length > 0 ? user.groups.join(", ") : "None"}\n\n` +
                      `**Attached Policies:**\n` +
                      (user.attachedPolicies.length > 0
                        ? user.attachedPolicies.map(p => `• ${p.policyName}`).join("\n")
                        : "None"),
                  }],
                  details: { user },
                };
              }

              case "create_user": {
                const userName = params.user_name as string;
                if (!userName) {
                  return {
                    content: [{ type: "text", text: "user_name is required" }],
                    details: { error: "missing_user_name" },
                  };
                }
                const result = await securityManager.createUser({
                  userName,
                  createAccessKey: params.create_access_key as boolean,
                  createLoginProfile: params.create_login_profile as boolean,
                  tags: params.tags as Record<string, string>,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create user: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                let message = `✅ Created IAM user **${result.data!.user.userName}**\n\nARN: ${result.data!.user.arn}`;
                if (result.data!.accessKey) {
                  message += `\n\n**Access Key Created:**\nAccess Key ID: ${result.data!.accessKey.accessKeyId}\nSecret Access Key: ${result.data!.accessKey.secretAccessKey}\n\n⚠️ Save these credentials securely - the secret key won't be shown again!`;
                }
                if (result.data!.loginProfile) {
                  message += `\n\n**Console Login Created:**\nTemporary Password: ${result.data!.loginProfile.password}\nPassword Reset Required: ${result.data!.loginProfile.passwordResetRequired}`;
                }
                return {
                  content: [{ type: "text", text: message }],
                  details: { result: result.data },
                };
              }

              case "delete_user": {
                const userName = params.user_name as string;
                if (!userName) {
                  return {
                    content: [{ type: "text", text: "user_name is required" }],
                    details: { error: "missing_user_name" },
                  };
                }
                const result = await securityManager.deleteUser(userName);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete user: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Deleted IAM user **${userName}**` }],
                  details: { deleted: userName },
                };
              }

              // IAM Policy operations
              case "list_policies": {
                const result = await securityManager.listPolicies({
                  scope: "Local",
                  maxItems: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list policies: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `Found ${result.data!.length} customer-managed policies:\n\n` +
                      result.data!.map(p =>
                        `• **${p.policyName}**\n  ARN: ${p.arn}\n  Attachments: ${p.attachmentCount}`
                      ).join("\n\n"),
                  }],
                  details: { policies: result.data },
                };
              }

              case "get_policy": {
                const policyArn = params.policy_arn as string;
                if (!policyArn) {
                  return {
                    content: [{ type: "text", text: "policy_arn is required" }],
                    details: { error: "missing_policy_arn" },
                  };
                }
                const result = await securityManager.getPolicy(policyArn);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const policy = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `**IAM Policy: ${policy.policyName}**\n\n` +
                      `ARN: ${policy.arn}\n` +
                      `Attachments: ${policy.attachmentCount}\n\n` +
                      `**Policy Document:**\n\`\`\`json\n${JSON.stringify(policy.document, null, 2)}\n\`\`\``,
                  }],
                  details: { policy },
                };
              }

              case "create_policy": {
                const policyName = params.policy_name as string;
                const policyDocument = params.policy_document as object;
                if (!policyName || !policyDocument) {
                  return {
                    content: [{ type: "text", text: "policy_name and policy_document are required" }],
                    details: { error: "missing_params" },
                  };
                }
                const result = await securityManager.createPolicy({
                  policyName,
                  policyDocument: policyDocument as any,
                  description: params.description as string,
                  tags: params.tags as Record<string, string>,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Created IAM policy **${result.data!.policyName}**\n\nARN: ${result.data!.arn}` }],
                  details: { policy: result.data },
                };
              }

              case "delete_policy": {
                const policyArn = params.policy_arn as string;
                if (!policyArn) {
                  return {
                    content: [{ type: "text", text: "policy_arn is required" }],
                    details: { error: "missing_policy_arn" },
                  };
                }
                const result = await securityManager.deletePolicy(policyArn);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Deleted IAM policy` }],
                  details: { deleted: policyArn },
                };
              }

              case "get_policy_template": {
                const template = params.template as string;
                if (!template) {
                  return {
                    content: [{ type: "text", text: "template is required. Available templates: lambda-basic, lambda-vpc, lambda-s3-read, lambda-s3-write, lambda-dynamodb, lambda-sqs, lambda-sns, ec2-ssm, ecs-task, eks-node, s3-read-only, s3-full-access, dynamodb-read-only, dynamodb-full-access, cloudwatch-logs, xray-tracing, secrets-read, kms-encrypt-decrypt, assume-role, cross-account-access" }],
                    details: { error: "missing_template" },
                  };
                }
                try {
                  const variables = params.template_variables as Record<string, string>;
                  const policyDoc = securityManager.getPolicyTemplate(template as any, variables);
                  return {
                    content: [{
                      type: "text",
                      text: `**Policy Template: ${template}**\n\n\`\`\`json\n${JSON.stringify(policyDoc, null, 2)}\n\`\`\``,
                    }],
                    details: { template, policyDocument: policyDoc },
                  };
                } catch (error) {
                  return {
                    content: [{ type: "text", text: `Failed to get template: ${error}` }],
                    details: { error: String(error) },
                  };
                }
              }

              case "simulate_policy": {
                const actionNames = params.action_names as string[];
                if (!actionNames || actionNames.length === 0) {
                  return {
                    content: [{ type: "text", text: "action_names is required" }],
                    details: { error: "missing_action_names" },
                  };
                }
                const result = await securityManager.simulatePolicy({
                  policySourceArn: params.policy_source_arn as string,
                  actionNames,
                  resourceArns: params.resource_arns as string[],
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to simulate policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `**Policy Simulation Results:**\n\n` +
                      result.data!.map(r =>
                        `• **${r.evalActionName}**: ${r.evalDecision === "allowed" ? "✅ Allowed" : "❌ Denied"}`
                      ).join("\n"),
                  }],
                  details: { results: result.data },
                };
              }

              // Security Hub operations
              case "list_security_findings": {
                const result = await securityManager.listSecurityFindings({
                  region,
                  severities: params.severities as any[],
                  maxResults: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list findings: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const findings = result.data!;
                const bySeverity = {
                  CRITICAL: findings.filter(f => f.severity.label === "CRITICAL").length,
                  HIGH: findings.filter(f => f.severity.label === "HIGH").length,
                  MEDIUM: findings.filter(f => f.severity.label === "MEDIUM").length,
                  LOW: findings.filter(f => f.severity.label === "LOW").length,
                };
                return {
                  content: [{
                    type: "text",
                    text: `**Security Hub Findings Summary:**\n\n` +
                      `🔴 Critical: ${bySeverity.CRITICAL}\n` +
                      `🟠 High: ${bySeverity.HIGH}\n` +
                      `🟡 Medium: ${bySeverity.MEDIUM}\n` +
                      `🟢 Low: ${bySeverity.LOW}\n\n` +
                      `**Recent Findings:**\n\n` +
                      findings.slice(0, 10).map(f =>
                        `• **[${f.severity.label}]** ${f.title}\n  ${f.description.substring(0, 100)}...`
                      ).join("\n\n"),
                  }],
                  details: { findings, summary: bySeverity },
                };
              }

              case "enable_security_hub": {
                const result = await securityManager.enableSecurityHub(region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to enable Security Hub: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: "✅ Security Hub enabled" }],
                  details: { enabled: true },
                };
              }

              case "disable_security_hub": {
                const result = await securityManager.disableSecurityHub(region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to disable Security Hub: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: "✅ Security Hub disabled" }],
                  details: { disabled: true },
                };
              }

              case "list_security_standards": {
                const result = await securityManager.listSecurityStandards(region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list standards: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `**Security Standards:**\n\n` +
                      result.data!.map(s =>
                        `• **${s.name}** ${s.enabled ? "✅ Enabled" : "❌ Disabled"}\n  ${s.description || ""}`
                      ).join("\n\n"),
                  }],
                  details: { standards: result.data },
                };
              }

              // GuardDuty operations
              case "list_guardduty_findings": {
                const result = await securityManager.listGuardDutyFindings({
                  region,
                  maxResults: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list GuardDuty findings: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const findings = result.data!;
                const bySeverity = {
                  High: findings.filter(f => f.severityLabel === "High").length,
                  Medium: findings.filter(f => f.severityLabel === "Medium").length,
                  Low: findings.filter(f => f.severityLabel === "Low").length,
                };
                return {
                  content: [{
                    type: "text",
                    text: `**GuardDuty Findings Summary:**\n\n` +
                      `🔴 High: ${bySeverity.High}\n` +
                      `🟠 Medium: ${bySeverity.Medium}\n` +
                      `🟡 Low: ${bySeverity.Low}\n\n` +
                      `**Recent Threats:**\n\n` +
                      findings.slice(0, 10).map(f =>
                        `• **[${f.severityLabel}]** ${f.type}\n  ${f.title}\n  ${f.description.substring(0, 100)}...`
                      ).join("\n\n"),
                  }],
                  details: { findings, summary: bySeverity },
                };
              }

              case "get_guardduty_detector": {
                const result = await securityManager.getGuardDutyDetector(
                  params.detector_id as string,
                  region
                );
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get detector: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const detector = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `**GuardDuty Detector: ${detector.detectorId}**\n\n` +
                      `Status: ${detector.status === "ENABLED" ? "✅ Enabled" : "❌ Disabled"}\n` +
                      `Finding Frequency: ${detector.findingPublishingFrequency}\n\n` +
                      `**Data Sources:**\n` +
                      `• CloudTrail: ${detector.dataSources.cloudTrail.status}\n` +
                      `• DNS Logs: ${detector.dataSources.dnsLogs.status}\n` +
                      `• Flow Logs: ${detector.dataSources.flowLogs.status}\n` +
                      `• S3 Logs: ${detector.dataSources.s3Logs.status}`,
                  }],
                  details: { detector },
                };
              }

              case "enable_guardduty": {
                const result = await securityManager.enableGuardDuty(region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to enable GuardDuty: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ GuardDuty enabled with detector ID: ${result.data}` }],
                  details: { detectorId: result.data },
                };
              }

              case "disable_guardduty": {
                const detectorId = params.detector_id as string;
                if (!detectorId) {
                  return {
                    content: [{ type: "text", text: "detector_id is required" }],
                    details: { error: "missing_detector_id" },
                  };
                }
                const result = await securityManager.disableGuardDuty(detectorId, region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to disable GuardDuty: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: "✅ GuardDuty disabled" }],
                  details: { disabled: true },
                };
              }

              // KMS operations
              case "list_kms_keys": {
                const result = await securityManager.listKMSKeys({
                  region,
                  includeAliases: true,
                  includeTags: true,
                  includeRotationStatus: true,
                  keyManager: "CUSTOMER",
                  maxResults: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list KMS keys: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `Found ${result.data!.length} customer-managed KMS keys:\n\n` +
                      result.data!.map(k =>
                        `• **${k.aliases.length > 0 ? k.aliases[0] : k.keyId}**\n  State: ${k.keyState}\n  Usage: ${k.keyUsage}\n  Rotation: ${k.rotationEnabled ? "✅" : "❌"}`
                      ).join("\n\n"),
                  }],
                  details: { keys: result.data },
                };
              }

              case "create_kms_key": {
                const result = await securityManager.createKMSKey({
                  region,
                  description: params.key_description as string || params.description as string,
                  keyUsage: params.key_usage as any,
                  enableKeyRotation: params.enable_rotation as boolean,
                  tags: params.tags as Record<string, string>,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create KMS key: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Created KMS key\n\nKey ID: ${result.data!.keyId}\nARN: ${result.data!.arn}` }],
                  details: { key: result.data },
                };
              }

              case "enable_key_rotation": {
                const keyId = params.key_id as string;
                if (!keyId) {
                  return {
                    content: [{ type: "text", text: "key_id is required" }],
                    details: { error: "missing_key_id" },
                  };
                }
                const result = await securityManager.enableKeyRotation(keyId, region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to enable key rotation: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Enabled automatic rotation for KMS key ${keyId}` }],
                  details: { keyId },
                };
              }

              // Secrets Manager operations
              case "list_secrets": {
                const result = await securityManager.listSecrets({
                  region,
                  maxResults: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list secrets: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `Found ${result.data!.length} secrets:\n\n` +
                      result.data!.map(s =>
                        `• **${s.name}**\n  Rotation: ${s.rotationEnabled ? "✅ Enabled" : "❌ Disabled"}\n  Last Changed: ${s.lastChangedDate?.toISOString() || "N/A"}`
                      ).join("\n\n"),
                  }],
                  details: { secrets: result.data },
                };
              }

              case "get_secret_value": {
                const secretId = params.secret_id as string;
                if (!secretId) {
                  return {
                    content: [{ type: "text", text: "secret_id is required" }],
                    details: { error: "missing_secret_id" },
                  };
                }
                const result = await securityManager.getSecretValue(secretId, undefined, region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get secret value: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `**Secret: ${result.data!.name}**\n\nVersion: ${result.data!.versionId}\n\n**Value:**\n\`\`\`\n${result.data!.secretString || "(binary)"}\n\`\`\``,
                  }],
                  details: { secret: { ...result.data, secretString: "[REDACTED]" } },
                };
              }

              case "create_secret": {
                const secretName = params.secret_name as string;
                const secretValue = params.secret_value as string;
                if (!secretName || !secretValue) {
                  return {
                    content: [{ type: "text", text: "secret_name and secret_value are required" }],
                    details: { error: "missing_params" },
                  };
                }
                const result = await securityManager.createSecret({
                  region,
                  name: secretName,
                  secretString: secretValue,
                  description: params.description as string,
                  kmsKeyId: params.kms_key_id as string,
                  tags: params.tags as Record<string, string>,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create secret: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Created secret **${result.data!.name}**\n\nARN: ${result.data!.arn}` }],
                  details: { secret: result.data },
                };
              }

              case "rotate_secret": {
                const secretId = params.secret_id as string;
                if (!secretId) {
                  return {
                    content: [{ type: "text", text: "secret_id is required" }],
                    details: { error: "missing_secret_id" },
                  };
                }
                const result = await securityManager.rotateSecret({
                  secretId,
                  region,
                  rotationLambdaArn: params.rotation_lambda_arn as string,
                  rotateImmediately: true,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to rotate secret: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Initiated rotation for secret ${secretId}` }],
                  details: { secretId },
                };
              }

              case "delete_secret": {
                const secretId = params.secret_id as string;
                if (!secretId) {
                  return {
                    content: [{ type: "text", text: "secret_id is required" }],
                    details: { error: "missing_secret_id" },
                  };
                }
                const result = await securityManager.deleteSecret(
                  secretId,
                  params.force_delete as boolean,
                  30,
                  region
                );
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete secret: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: result.message || `✅ Deleted secret ${secretId}` }],
                  details: { deleted: secretId },
                };
              }

              // Access Analyzer operations
              case "list_access_analyzers": {
                const result = await securityManager.listAccessAnalyzers(region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list Access Analyzers: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{
                    type: "text",
                    text: `Found ${result.data!.length} Access Analyzers:\n\n` +
                      result.data!.map(a =>
                        `• **${a.analyzerName}** (${a.type})\n  Status: ${a.status}`
                      ).join("\n\n"),
                  }],
                  details: { analyzers: result.data },
                };
              }

              case "list_access_analyzer_findings": {
                const result = await securityManager.listAccessAnalyzerFindings({
                  region,
                  analyzerArn: params.analyzer_arn as string,
                  maxResults: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list findings: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const findings = result.data!;
                const publicFindings = findings.filter(f => f.isPublic);
                return {
                  content: [{
                    type: "text",
                    text: `**Access Analyzer Findings:**\n\n` +
                      `🌐 Public Resources: ${publicFindings.length}\n` +
                      `📊 Total Findings: ${findings.length}\n\n` +
                      `**Public Resources:**\n\n` +
                      publicFindings.slice(0, 10).map(f =>
                        `• **${f.resourceType}**: ${f.resource}`
                      ).join("\n"),
                  }],
                  details: { findings },
                };
              }

              case "create_access_analyzer": {
                const analyzerName = params.analyzer_name as string;
                if (!analyzerName) {
                  return {
                    content: [{ type: "text", text: "analyzer_name is required" }],
                    details: { error: "missing_analyzer_name" },
                  };
                }
                const result = await securityManager.createAccessAnalyzer({
                  region,
                  analyzerName,
                  type: (params.analyzer_type as "ACCOUNT" | "ORGANIZATION") || "ACCOUNT",
                  tags: params.tags as Record<string, string>,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create Access Analyzer: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                return {
                  content: [{ type: "text", text: `✅ Created Access Analyzer **${result.data!.analyzerName}**` }],
                  details: { analyzer: result.data },
                };
              }

              // Security Posture
              case "get_security_posture": {
                const result = await securityManager.getSecurityPosture(region);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get security posture: ${result.error}` }],
                    details: { error: result.error },
                  };
                }
                const posture = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `**Security Posture Summary**\n\n` +
                      `**IAM:**\n` +
                      `• Roles: ${posture.iamSummary.totalRoles}\n` +
                      `• Users: ${posture.iamSummary.totalUsers}\n` +
                      `• Users without MFA: ${posture.iamSummary.usersWithoutMFA > 0 ? "⚠️ " : ""}${posture.iamSummary.usersWithoutMFA}\n` +
                      `• Old Access Keys (>90 days): ${posture.iamSummary.accessKeysOlderThan90Days > 0 ? "⚠️ " : ""}${posture.iamSummary.accessKeysOlderThan90Days}\n\n` +
                      `**Security Hub:** ${posture.securityHubSummary.enabled ? "✅ Enabled" : "❌ Disabled"}\n` +
                      `• Critical: ${posture.securityHubSummary.criticalFindings > 0 ? "🔴 " : ""}${posture.securityHubSummary.criticalFindings}\n` +
                      `• High: ${posture.securityHubSummary.highFindings > 0 ? "🟠 " : ""}${posture.securityHubSummary.highFindings}\n` +
                      `• Medium: ${posture.securityHubSummary.mediumFindings}\n` +
                      `• Low: ${posture.securityHubSummary.lowFindings}\n\n` +
                      `**GuardDuty:** ${posture.guardDutySummary.enabled ? "✅ Enabled" : "❌ Disabled"}\n` +
                      `• High Severity Threats: ${posture.guardDutySummary.highSeverityFindings > 0 ? "🔴 " : ""}${posture.guardDutySummary.highSeverityFindings}\n\n` +
                      `**Access Analyzer:** ${posture.accessAnalyzerSummary.enabled ? "✅ Enabled" : "❌ Disabled"}\n` +
                      `• Public Resources: ${posture.accessAnalyzerSummary.publicResources > 0 ? "⚠️ " : ""}${posture.accessAnalyzerSummary.publicResources}\n\n` +
                      `**KMS Keys:** ${posture.kmsSummary.customerManagedKeys}\n` +
                      `• Without Rotation: ${posture.kmsSummary.keysWithoutRotation > 0 ? "⚠️ " : ""}${posture.kmsSummary.keysWithoutRotation}\n\n` +
                      `**Secrets Manager:** ${posture.secretsManagerSummary.totalSecrets}\n` +
                      `• Without Rotation: ${posture.secretsManagerSummary.secretsWithoutRotation > 0 ? "⚠️ " : ""}${posture.secretsManagerSummary.secretsWithoutRotation}`,
                  }],
                  details: { posture },
                };
              }

              default:
                return {
                  content: [{ type: "text", text: `Unknown action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `Security error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_security" },
    );

    // Register service for cleanup
    api.registerService({
      id: "aws-core-services",
      async start() {
        console.log("[AWS] AWS Core Services started");
        // Optionally initialize context on start
        if (contextManager) {
          try {
            await contextManager.initialize();
          } catch {
            // Ignore - credentials may not be available
          }
        }
      },
      async stop() {
        // Clear cached credentials
        if (credentialsManager) {
          credentialsManager.clearCache();
        }
        // Reset managers
        credentialsManager = null;
        contextManager = null;
        serviceDiscovery = null;
        taggingManager = null;
        cloudTrailManager = null;
        ec2Manager = null;
        rdsManager = null;
        lambdaManager = null;
        s3Manager = null;
        iacManager = null;
        costManager = null;
        securityManager = null;
        cliWrapper = null;
        console.log("[AWS] AWS Core Services stopped");
      },
    });

    console.log("[AWS] AWS extension registered successfully");
  },
};

export default plugin;

/**
 * Get the global AWS managers for programmatic access
 */
export function getAWSManagers() {
  return {
    credentials: credentialsManager,
    context: contextManager,
    serviceDiscovery,
    tagging: taggingManager,
    cloudTrail: cloudTrailManager,
    ec2: ec2Manager,
    rds: rdsManager,
    lambda: lambdaManager,
    s3: s3Manager,
    iac: iacManager,
    cost: costManager,
    security: securityManager,
    cli: cliWrapper,
  };
}
