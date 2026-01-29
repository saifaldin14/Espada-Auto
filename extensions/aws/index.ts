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

// Global instances
let credentialsManager: AWSCredentialsManager | null = null;
let contextManager: AWSContextManager | null = null;
let serviceDiscovery: AWSServiceDiscovery | null = null;
let taggingManager: AWSTaggingManager | null = null;
let cloudTrailManager: AWSCloudTrailManager | null = null;
let ec2Manager: AWSEC2Manager | null = null;
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
    cli: cliWrapper,
  };
}
