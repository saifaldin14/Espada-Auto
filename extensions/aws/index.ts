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
  type AWSCredentialsManager,
  type AWSContextManager,
  type AWSServiceDiscovery,
  type AWSTaggingManager,
  type AWSCloudTrailManager,
  type AWSEC2Manager,
  type AWSCLIWrapper,
} from "./src/index.js";

import {
  createRDSManager,
  type RDSManager,
} from "./src/rds/index.js";

// Global instances
let credentialsManager: AWSCredentialsManager | null = null;
let contextManager: AWSContextManager | null = null;
let serviceDiscovery: AWSServiceDiscovery | null = null;
let taggingManager: AWSTaggingManager | null = null;
let cloudTrailManager: AWSCloudTrailManager | null = null;
let ec2Manager: AWSEC2Manager | null = null;
let rdsManager: RDSManager | null = null;
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
          const limit = (params.limit as number) ?? 20;

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
    cli: cliWrapper,
  };
}
