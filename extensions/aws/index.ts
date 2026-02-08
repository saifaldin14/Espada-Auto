/**
 * AWS Core Services Extension - Espada Plugin Entry Point
 *
 * This is the main plugin entry point that registers AWS services
 * with the Espada ecosystem, providing CLI commands and gateway methods
 * for AWS infrastructure management.
 */

import type { EspadaPluginApi, EspadaPluginCliContext } from "espada/plugin-sdk";

// AWS-specific utilities (self-contained to avoid tsconfig issues)
import {
  formatErrorMessage,
} from "./src/retry.js";
import {
  enableAWSDiagnostics,
} from "./src/diagnostics.js";

// Theme helper for CLI output — uses LOBSTER_PALETTE tokens for consistency
const theme = {
  error: (s: string) => `\x1b[31m${s}\x1b[0m`,
  success: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  info: (s: string) => `\x1b[34m${s}\x1b[0m`,
  muted: (s: string) => `\x1b[90m${s}\x1b[0m`,
} as const;

// Store the plugin logger so the service start() can use it
let pluginLogger: EspadaPluginApi["logger"] | null = null;

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
  createCICDManager,
} from "./src/cicd/index.js";
import type { CICDManager } from "./src/cicd/types.js";

import {
  createNetworkManager,
  type NetworkManager,
} from "./src/network/index.js";

import {
  createSecurityManager,
  type SecurityManager,
} from "./src/security/index.js";

import {
  createGuardrailsManager,
  type GuardrailsManager,
} from "./src/guardrails/index.js";

import {
  createOrganizationManager,
  type OrganizationManager,
} from "./src/organization/index.js";

import {
  createBackupManager,
  type BackupManager,
} from "./src/backup/index.js";

import {
  createConversationalManager,
  type AWSConversationalManager,
} from "./src/conversational/index.js";

import type {
  OperationContext,
  ActionType,
  Environment,
  DayOfWeek,
  EnvironmentProtection,
  AuditLogEntry,
  PreOperationBackup,
  ChangeRequest,
} from "./src/guardrails/types.js";

import type {
  PolicyType,
  SCPCategory,
} from "./src/organization/types.js";
import { InfrastructureTemplate } from "./src/iac/types.js";

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
let cicdManager: CICDManager | null = null;
let networkManager: NetworkManager | null = null;
let iacManager: IaCManager | null = null;
let costManager: CostManager | null = null;
let securityManager: SecurityManager | null = null;
let guardrailsManager: GuardrailsManager | null = null;
let organizationManager: OrganizationManager | null = null;
let backupManager: BackupManager | null = null;
let conversationalManager: AWSConversationalManager | null = null;
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
      retry: {
        type: "object",
        description: "Retry configuration for AWS API calls",
        properties: {
          attempts: {
            type: "number",
            description: "Maximum number of retry attempts",
            default: 3,
          },
          minDelayMs: {
            type: "number",
            description: "Minimum delay between retries in milliseconds",
            default: 100,
          },
          maxDelayMs: {
            type: "number",
            description: "Maximum delay between retries in milliseconds",
            default: 30000,
          },
        },
      },
      diagnostics: {
        type: "object",
        description: "Diagnostic and observability settings",
        properties: {
          enabled: {
            type: "boolean",
            description: "Enable AWS API call tracing",
            default: false,
          },
          verbose: {
            type: "boolean",
            description: "Log retry attempts and detailed API info",
            default: false,
          },
        },
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
      help: "The default AWS region to use for operations (e.g., us-east-1, eu-west-1)",
      placeholder: "us-east-1",
      advanced: false,
    },
    defaultProfile: {
      label: "Default Profile",
      help: "The default AWS profile from ~/.aws/credentials to use for authentication",
      placeholder: "default",
      advanced: false,
    },
    credentialSources: {
      label: "Credential Sources",
      help: "Order of credential sources to try: profile, environment, sso, instance, container",
      placeholder: "profile, environment, sso",
      advanced: true,
    },
    "retry.attempts": {
      label: "Retry Attempts",
      help: "Maximum number of times to retry failed AWS API calls",
      advanced: true,
    },
    "retry.minDelayMs": {
      label: "Minimum Retry Delay",
      help: "Minimum delay in milliseconds between retry attempts",
      advanced: true,
    },
    "retry.maxDelayMs": {
      label: "Maximum Retry Delay",
      help: "Maximum delay in milliseconds between retry attempts",
      advanced: true,
    },
    "diagnostics.enabled": {
      label: "Enable Diagnostics",
      help: "Enable AWS API call tracing for observability (works with diagnostics-otel extension)",
      advanced: true,
    },
    "diagnostics.verbose": {
      label: "Verbose Logging",
      help: "Log detailed information about retries and API calls",
      advanced: true,
    },
    tagConfig: {
      label: "Tag Configuration",
      help: "Configure required and optional tags for all AWS resources",
      advanced: true,
    },
    "tagConfig.requiredTags": {
      label: "Required Tags",
      help: "Tag keys that must be present on all created resources",
      placeholder: "Environment, Project, Owner",
      advanced: true,
    },
    "tagConfig.optionalTags": {
      label: "Optional Tags",
      help: "Tag keys that are recommended but not required",
      placeholder: "CostCenter, Team",
      advanced: true,
    },
    defaultTags: {
      label: "Default Tags",
      help: "Tags to automatically apply to all created resources",
      advanced: true,
    },
  },
};

interface AWSPluginConfig {
  defaultRegion?: string;
  defaultProfile?: string;
  credentialSources?: string[];
  retry?: {
    attempts?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
  };
  diagnostics?: {
    enabled?: boolean;
    verbose?: boolean;
  };
  tagConfig?: {
    requiredTags?: string[];
    optionalTags?: string[];
  };
  defaultTags?: Array<{ key: string; value: string }>;
}

function getDefaultConfig(): AWSPluginConfig {
  return {
    defaultRegion: "us-east-1",
    retry: {
      attempts: 3,
      minDelayMs: 100,
      maxDelayMs: 30000,
    },
    diagnostics: {
      enabled: false,
      verbose: false,
    },
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

  register(api: EspadaPluginApi) {
    // Use the plugin's logger for consistent output
    api.logger.info("Registering AWS extension");
    pluginLogger = api.logger;

    // Get plugin configuration
    const config = (api.pluginConfig as AWSPluginConfig) ?? getDefaultConfig();

    // Configure diagnostics based on config (sync — no AWS API calls)
    if (config.diagnostics?.enabled) {
      enableAWSDiagnostics();
      api.logger.info("AWS diagnostics enabled");
    }

    // Register CLI commands
    api.registerCli(
      (ctx: EspadaPluginCliContext) => {
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
              console.error(theme.error(`Failed to list instances: ${formatErrorMessage(error)}`));
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
                console.log(theme.success(`Started instances: ${result.instanceIds.join(", ")}`));
              } else {
                console.error(theme.error(`Failed to start instances: ${result.error}`));
              }
            } catch (error) {
              console.error(theme.error(`Failed to start instances: ${formatErrorMessage(error)}`));
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
              console.error(theme.error("EC2 manager not initialized"));
              return;
            }

            try {
              const result = await ec2Manager.stopInstances(instanceIds, {
                region: options.region,
                force: options.force,
              });
              if (result.success) {
                console.log(theme.success(`Stopped instances: ${result.instanceIds.join(", ")}`));
              } else {
                console.error(theme.error(`Failed to stop instances: ${result.error}`));
              }
            } catch (error) {
              console.error(theme.error(`Failed to stop instances: ${formatErrorMessage(error)}`));
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
              console.error(theme.error("EC2 manager not initialized"));
              return;
            }

            try {
              const result = await ec2Manager.terminateInstances(instanceIds, { region: options.region });
              if (result.success) {
                console.log(theme.success(`Terminated instances: ${result.instanceIds.join(", ")}`));
              } else {
                console.error(theme.error(`Failed to terminate instances: ${result.error}`));
              }
            } catch (error) {
              console.error(theme.error(`Failed to terminate instances: ${formatErrorMessage(error)}`));
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
    api.registerGatewayMethod("aws/identity", async (opts) => {
      if (!contextManager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Context manager not initialized" });
        return;
      }
      try {
        await contextManager.initialize();
        const context = contextManager.getContext();
        opts.respond(true, { data: context });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/ec2/instances", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { region?: string; states?: string[] };
        const instances = await ec2Manager.listInstances({
          region: params.region,
          states: params.states as ("running" | "stopped" | "pending" | "terminated")[],
        });
        opts.respond(true, { data: instances });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/ec2/start", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { instanceIds: string[]; region?: string };
        const result = await ec2Manager.startInstances(params.instanceIds, { region: params.region });
        if (result.error) {
          opts.respond(false, { data: result }, { code: "EC2_ERROR", message: result.error });
        } else {
          opts.respond(true, { data: result });
        }
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/ec2/stop", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { instanceIds: string[]; region?: string; force?: boolean };
        const result = await ec2Manager.stopInstances(params.instanceIds, {
          region: params.region,
          force: params.force,
        });
        if (result.error) {
          opts.respond(false, { data: result }, { code: "EC2_ERROR", message: result.error });
        } else {
          opts.respond(true, { data: result });
        }
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/ec2/terminate", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { instanceIds: string[]; region?: string };
        const result = await ec2Manager.terminateInstances(params.instanceIds, { region: params.region });
        if (result.error) {
          opts.respond(false, { data: result }, { code: "EC2_ERROR", message: result.error });
        } else {
          opts.respond(true, { data: result });
        }
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/ec2/security-groups", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { region?: string; vpcId?: string };
        const groups = await ec2Manager.listSecurityGroups({
          region: params.region,
          filters: params.vpcId ? { "vpc-id": [params.vpcId] } : undefined,
        });
        opts.respond(true, { data: groups });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/ec2/key-pairs", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { region?: string };
        const keyPairs = await ec2Manager.listKeyPairs({ region: params.region });
        opts.respond(true, { data: keyPairs });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/asg/list", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { region?: string };
        const groups = await ec2Manager.listAutoScalingGroups({ region: params.region });
        opts.respond(true, { data: groups });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/asg/scale", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { name: string; capacity: number; region?: string };
        const result = await ec2Manager.setDesiredCapacity(params.name, params.capacity, {
          region: params.region,
        });
        if (result.error) {
          opts.respond(false, { data: result }, { code: "ASG_ERROR", message: result.error });
        } else {
          opts.respond(true, { data: result });
        }
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/elb/list", async (opts) => {
      if (!ec2Manager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EC2 manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { region?: string };
        const loadBalancers = await ec2Manager.listLoadBalancers({ region: params.region });
        opts.respond(true, { data: loadBalancers });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/services", async (opts) => {
      if (!serviceDiscovery) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Service discovery not initialized" });
        return;
      }
      try {
        const result = await serviceDiscovery.discover();
        opts.respond(true, { data: result.services });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    api.registerGatewayMethod("aws/cloudtrail/events", async (opts) => {
      if (!cloudTrailManager) {
        opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CloudTrail manager not initialized" });
        return;
      }
      try {
        const params = (opts.params ?? {}) as { region?: string; limit?: number };
        const events = await cloudTrailManager.queryEvents({
          region: params.region,
          maxResults: params.limit ?? 20,
        });
        opts.respond(true, { data: events });
      } catch (error) {
        opts.respond(false, undefined, { code: "AWS_ERROR", message: String(error) });
      }
    });

    // ========================================================================
    // Agent Tools - Allows AI agents to perform AWS operations via prompts
    // ========================================================================

    // AWS Authentication Tool
    api.registerTool(
      {
        name: "aws_authenticate",
        label: "AWS Authentication",
        description: "Authenticate with AWS using SSO (Single Sign-On) by opening a browser for login, or configure access keys.",
        parameters: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["sso", "access-keys"],
              description: "Authentication method: 'sso' for browser-based SSO login, or 'access-keys' for programmatic access",
            },
            sso_start_url: {
              type: "string",
              description: "SSO start URL (e.g., https://your-org.awsapps.com/start). Required for SSO method.",
            },
            sso_region: {
              type: "string",
              description: "AWS region where SSO is configured (e.g., us-east-1). Required for SSO method.",
            },
            session_name: {
              type: "string",
              description: "Name for the SSO session (e.g., 'my-sso'). Optional for SSO method.",
            },
            access_key_id: {
              type: "string",
              description: "AWS Access Key ID. Required for access-keys method.",
            },
            secret_access_key: {
              type: "string",
              description: "AWS Secret Access Key. Required for access-keys method.",
            },
            default_region: {
              type: "string",
              description: "Default AWS region (e.g., us-east-1). Optional.",
            },
          },
          required: ["method"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const { execSync} = await import("node:child_process");
            const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
            const { homedir } = await import("node:os");
            const { join } = await import("node:path");

            const method = params.method as string;
            const sso_start_url = params.sso_start_url as string | undefined;
            const sso_region = params.sso_region as string | undefined;
            const session_name = params.session_name as string | undefined;
            const access_key_id = params.access_key_id as string | undefined;
            const secret_access_key = params.secret_access_key as string | undefined;
            const default_region = params.default_region as string | undefined;

            const awsDir = join(homedir(), ".aws");
            if (!existsSync(awsDir)) {
              mkdirSync(awsDir, { recursive: true });
            }

            if (method === "sso") {
              // Validate SSO parameters
              if (!sso_start_url || !sso_region) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "Error: SSO authentication requires 'sso_start_url' and 'sso_region' parameters.",
                    },
                  ],
                  details: { error: "missing_sso_params" },
                };
              }

              const sessionName = session_name || "default-sso";
              const region = default_region || sso_region;

              // Create SSO configuration
              const configPath = join(awsDir, "config");
              const ssoConfig = `
[profile ${sessionName}]
sso_session = ${sessionName}
sso_account_id = 
sso_role_name = 
region = ${region}
output = json

[sso-session ${sessionName}]
sso_start_url = ${sso_start_url}
sso_region = ${sso_region}
sso_registration_scopes = sso:account:access
`;

              // Append to config file
              writeFileSync(configPath, ssoConfig, { flag: "a" });

              // Initiate SSO login (this will open a browser)
              try {
                const output = execSync(`aws sso login --profile ${sessionName}`, {
                  encoding: "utf-8",
                  stdio: "pipe",
                });

                return {
                  content: [
                    {
                      type: "text",
                      text: `✅ AWS SSO authentication initiated!\n\nA browser window should have opened for you to login.\n\nProfile: ${sessionName}\nStart URL: ${sso_start_url}\nRegion: ${sso_region}\n\nAfter logging in through the browser, you'll be able to use AWS services.\n\nOutput:\n${output}`,
                    },
                  ],
                  details: { method: "sso", profile: sessionName },
                };
              } catch (error: any) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Browser login initiated. Please check your browser to complete the AWS SSO login.\n\nProfile: ${sessionName}\nIf the browser didn't open automatically, run: aws sso login --profile ${sessionName}\n\nError details: ${error.message}`,
                    },
                  ],
                  details: { method: "sso", profile: sessionName, browserError: error.message },
                };
              }
            } else if (method === "access-keys") {
              // Validate access key parameters
              if (!access_key_id || !secret_access_key) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "Error: Access key authentication requires 'access_key_id' and 'secret_access_key' parameters.",
                    },
                  ],
                  details: { error: "missing_access_key_params" },
                };
              }

              const region = default_region || "us-east-1";

              // Create credentials file
              const credentialsPath = join(awsDir, "credentials");
              const credentialsContent = `
[default]
aws_access_key_id = ${access_key_id}
aws_secret_access_key = ${secret_access_key}
`;

              writeFileSync(credentialsPath, credentialsContent, { mode: 0o600 });

              // Create config file
              const configPath = join(awsDir, "config");
              const configContent = `
[default]
region = ${region}
output = json
`;

              writeFileSync(configPath, configContent);

              // Test the credentials
              try {
                const output = execSync("aws sts get-caller-identity", {
                  encoding: "utf-8",
                });
                const identity = JSON.parse(output);

                return {
                  content: [
                    {
                      type: "text",
                      text: `✅ AWS credentials configured successfully!\n\nAccount: ${identity.Account}\nUser/Role: ${identity.Arn}\nRegion: ${region}\n\nYou can now use AWS services through the agent.`,
                    },
                  ],
                  details: { method: "access-keys", account: identity.Account, arn: identity.Arn },
                };
              } catch (error: any) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `⚠️ Credentials saved but verification failed: ${error.message}\n\nPlease verify your access key and secret key are correct.`,
                    },
                  ],
                  details: { method: "access-keys", error: error.message },
                };
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: "Error: Invalid authentication method. Use 'sso' or 'access-keys'.",
                },
              ],
              details: { error: "invalid_method" },
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `AWS authentication error: ${error}`,
                },
              ],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_authenticate" },
    );

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
        name: "aws_lambda",
        label: "AWS Lambda Management",
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
        parameters: {
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
        name: "aws_s3",
        label: "AWS S3 Management",
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
        parameters: {
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
        async execute(_toolCallId: string, params: {
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
        async execute(_toolCallId: string, params: Record<string, unknown>) {
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

    // ========================================
    // AWS Guardrails & Approval Workflows Tool
    // ========================================
    api.registerTool(
      {
        name: "aws_guardrails",
        label: "AWS Guardrails & Approval Workflows",
        description: `Manage AWS operational safety with approval workflows, guardrails, and audit logging.

CAPABILITIES:
- Approval workflows for destructive operations
- Dry-run mode to preview changes before execution
- Environment protection rules (production safeguards)
- Rate limiting to prevent runaway automation
- Comprehensive audit logging for compliance
- Change request management with approval chains
- Policy-based guardrails for operation control
- Impact assessment before risky operations
- Pre-operation backups for safety

Use this tool to:
- Require approval before deleting production resources
- Preview infrastructure changes with dry-run
- Set up environment-specific protection rules
- Audit all AWS operations for compliance
- Manage change requests with multi-approver workflows
- Configure rate limits on automated operations
- Get impact assessments before major changes
- Create safety backups before modifications`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                // Approval workflow actions
                "create_approval_request",
                "get_approval_request",
                "list_approval_requests",
                "submit_approval_response",
                "cancel_approval_request",
                // Dry run actions
                "perform_dry_run",
                // Safety check actions
                "run_safety_checks",
                "evaluate_guardrails",
                "assess_impact",
                // Environment protection actions
                "get_environment_protection",
                "set_environment_protection",
                // Audit logging actions
                "log_action",
                "query_audit_logs",
                "get_audit_log_summary",
                // Rate limiting actions
                "check_rate_limit",
                "get_rate_limit_config",
                "set_rate_limit_config",
                // Backup actions
                "create_pre_operation_backup",
                "list_pre_operation_backups",
                // Change request actions
                "create_change_request",
                "get_change_request",
                "update_change_request_status",
                "list_change_requests",
                // Policy management actions
                "add_policy",
                "get_policy",
                "list_policies",
                "update_policy",
                "remove_policy",
                // Classification actions
                "classify_action",
                // Notification actions
                "configure_notification_channel",
                // Configuration actions
                "get_config",
                "update_config",
              ],
              description: "The guardrails operation to perform",
            },
            // Common options
            region: {
              type: "string",
              description: "AWS region (defaults to configured region)",
            },
            // Approval request options
            request_id: {
              type: "string",
              description: "Approval request ID",
            },
            operation: {
              type: "object",
              description: "Operation details for approval request",
              properties: {
                type: { type: "string" },
                resource_type: { type: "string" },
                resource_id: { type: "string" },
                parameters: { type: "object" },
              },
            },
            requester: {
              type: "string",
              description: "User ID of the requester",
            },
            reason: {
              type: "string",
              description: "Reason for the operation or approval/rejection",
            },
            urgency: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
              description: "Urgency level of the request",
            },
            required_approvers: {
              type: "number",
              description: "Number of approvals required",
            },
            approval_timeout_hours: {
              type: "number",
              description: "Hours before approval request times out",
            },
            status_filter: {
              type: "string",
              enum: ["pending", "approved", "rejected", "expired", "cancelled"],
              description: "Filter approvals by status",
            },
            // Approval response options
            approver_id: {
              type: "string",
              description: "User ID of the approver",
            },
            approved: {
              type: "boolean",
              description: "Whether to approve (true) or reject (false)",
            },
            // Dry run options
            action_type: {
              type: "string",
              description: "Type of action to dry-run",
            },
            target_resource: {
              type: "object",
              description: "Target resource for dry-run",
              properties: {
                type: { type: "string" },
                id: { type: "string" },
                region: { type: "string" },
                account: { type: "string" },
              },
            },
            operation_parameters: {
              type: "object",
              description: "Parameters for the operation",
            },
            // Environment protection options
            environment: {
              type: "string",
              enum: ["production", "staging", "development", "testing"],
              description: "Environment name",
            },
            protection_settings: {
              type: "object",
              description: "Protection settings for the environment",
              properties: {
                approval_required: { type: "boolean" },
                min_approvers: { type: "number" },
                allowed_hours: {
                  type: "object",
                  properties: {
                    start: { type: "number" },
                    end: { type: "number" },
                    timezone: { type: "string" },
                    days: { type: "array", items: { type: "number" } },
                  },
                },
                blocked_actions: { type: "array", items: { type: "string" } },
                require_change_request: { type: "boolean" },
                require_backup: { type: "boolean" },
                max_blast_radius: { type: "number" },
              },
            },
            // Audit log options
            audit_entry: {
              type: "object",
              description: "Audit log entry details",
              properties: {
                action_type: { type: "string" },
                resource_type: { type: "string" },
                resource_id: { type: "string" },
                user_id: { type: "string" },
                result: { type: "string", enum: ["success", "failure", "blocked", "dry_run"] },
                details: { type: "object" },
              },
            },
            query_filter: {
              type: "object",
              description: "Filter for audit log queries",
              properties: {
                start_time: { type: "string" },
                end_time: { type: "string" },
                user_id: { type: "string" },
                action_type: { type: "string" },
                resource_type: { type: "string" },
                result: { type: "string" },
              },
            },
            summary_period: {
              type: "string",
              enum: ["hour", "day", "week", "month"],
              description: "Period for audit summary",
            },
            // Rate limit options
            rate_limit_key: {
              type: "string",
              description: "Key for rate limiting (action type or custom key)",
            },
            rate_limit_config: {
              type: "object",
              description: "Rate limit configuration",
              properties: {
                max_requests: { type: "number" },
                window_seconds: { type: "number" },
                burst_limit: { type: "number" },
                cooldown_seconds: { type: "number" },
              },
            },
            // Backup options
            backup_type: {
              type: "string",
              enum: ["full", "incremental", "config_only"],
              description: "Type of backup to create",
            },
            // Change request options
            change_request_id: {
              type: "string",
              description: "Change request ID",
            },
            change_request: {
              type: "object",
              description: "Change request details",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                requester: { type: "string" },
                affected_resources: { type: "array", items: { type: "object" } },
                planned_changes: { type: "array", items: { type: "object" } },
                scheduled_time: { type: "string" },
                estimated_duration_minutes: { type: "number" },
                rollback_plan: { type: "string" },
              },
            },
            change_status: {
              type: "string",
              enum: ["draft", "pending_approval", "approved", "rejected", "in_progress", "completed", "rolled_back", "cancelled"],
              description: "Status for change request",
            },
            // Policy options
            policy_id: {
              type: "string",
              description: "Policy ID",
            },
            policy: {
              type: "object",
              description: "Guardrails policy definition",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                enabled: { type: "boolean" },
                priority: { type: "number" },
                conditions: { type: "array", items: { type: "object" } },
                actions: { type: "array", items: { type: "object" } },
              },
            },
            // Notification options
            channel_type: {
              type: "string",
              enum: ["sns", "slack", "email", "webhook"],
              description: "Notification channel type",
            },
            channel_config: {
              type: "object",
              description: "Notification channel configuration",
              properties: {
                topic_arn: { type: "string" },
                webhook_url: { type: "string" },
                email_addresses: { type: "array", items: { type: "string" } },
              },
            },
            // Configuration options
            config_key: {
              type: "string",
              description: "Configuration key to get or update",
            },
            config_value: {
              type: "object",
              description: "Configuration value to set",
            },
            // Pagination options
            max_results: {
              type: "number",
              description: "Maximum number of results to return",
            },
            next_token: {
              type: "string",
              description: "Token for pagination",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const action = params.action as string;
          const region = (params.region as string) || "us-east-1";

          // Initialize guardrails manager if needed
          if (!guardrailsManager) {
            guardrailsManager = createGuardrailsManager({
              defaultRegion: region,
            } as any);
          }

          try {
            switch (action) {
              // ==================
              // Approval Workflows
              // ==================
              case "create_approval_request": {
                const operation = params.operation as {
                  type: string;
                  resource_type?: string;
                  resource_id?: string;
                  parameters?: Record<string, unknown>;
                };
                if (!operation?.type) {
                  return {
                    content: [{ type: "text", text: "Error: operation.type is required" }],
                    details: { error: "missing_operation_type" },
                  };
                }
                const requester = params.requester as string;
                if (!requester) {
                  return {
                    content: [{ type: "text", text: "Error: requester is required" }],
                    details: { error: "missing_requester" },
                  };
                }

                const context: OperationContext = {
                  userId: requester,
                  userName: requester,
                  action: operation.type as ActionType,
                  service: operation.resource_type?.split(':')[0] || 'unknown',
                  resourceIds: operation.resource_id ? [operation.resource_id] : [],
                  resourceType: operation.resource_type || 'unknown',
                  region,
                  requestParams: operation.parameters,
                };
                const result = await guardrailsManager.createApprovalRequest(context, params.reason as string);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create approval request: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const req = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `✅ Approval request created successfully\n\n` +
                      `**Request ID:** ${req.id}\n` +
                      `**Operation:** ${req.operation?.type ?? 'N/A'}\n` +
                      `**Resource:** ${req.operation?.resourceType || "N/A"} - ${req.operation?.resourceId || "N/A"}\n` +
                      `**Status:** ${req.status}\n` +
                      `**Required Approvers:** ${req.requiredApprovers}\n` +
                      `**Expires:** ${req.expiresAt.toISOString()}\n\n` +
                      `The request is now pending approval.`,
                  }],
                  details: { approval_request: req },
                };
              }

              case "get_approval_request": {
                const requestId = params.request_id as string;
                if (!requestId) {
                  return {
                    content: [{ type: "text", text: "Error: request_id is required" }],
                    details: { error: "missing_request_id" },
                  };
                }

                const result = await guardrailsManager.getApprovalRequest(requestId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get approval request: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const req = result.data!;
                const approversText = req.responses.length > 0
                  ? req.responses.map(r => `  • ${r.approverId}: ${r.approved ? "✅ Approved" : "❌ Rejected"} (${r.respondedAt?.toISOString()})`).join("\n")
                  : "  (none yet)";

                return {
                  content: [{
                    type: "text",
                    text: `**Approval Request: ${req.id}**\n\n` +
                      `**Operation:** ${req.operation?.type}\n` +
                      `**Resource:** ${req.operation?.resourceType || "N/A"} - ${req.operation?.resourceId || "N/A"}\n` +
                      `**Requester:** ${req.requester}\n` +
                      `**Reason:** ${req.reason || "Not specified"}\n` +
                      `**Status:** ${req.status}\n` +
                      `**Urgency:** ${req.urgency}\n` +
                      `**Required Approvers:** ${req.requiredApprovers}\n` +
                      `**Created:** ${req.createdAt.toISOString()}\n` +
                      `**Expires:** ${req.expiresAt.toISOString()}\n\n` +
                      `**Responses:**\n${approversText}`,
                  }],
                  details: { approval_request: req },
                };
              }

              case "list_approval_requests": {
                const statusFilter = params.status_filter as "pending" | "approved" | "rejected" | "expired" | "cancelled" | undefined;
                const result = await guardrailsManager.listApprovalRequests({
                  status: statusFilter,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list approval requests: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const requests = result.data!;
                if (requests.length === 0) {
                  return {
                    content: [{ type: "text", text: `No approval requests found${statusFilter ? ` with status: ${statusFilter}` : ""}.` }],
                    details: { requests: [] },
                  };
                }

                const statusEmoji: Record<string, string> = {
                  pending: "⏳",
                  approved: "✅",
                  rejected: "❌",
                  expired: "⌛",
                  cancelled: "🚫",
                };

                return {
                  content: [{
                    type: "text",
                    text: `Found ${requests.length} approval request(s):\n\n` +
                      requests.map(r =>
                        `${statusEmoji[r.status] || "•"} **${r.id}**\n` +
                        `  Operation: ${r.operation?.type ?? "N/A"}\n` +
                        `  Requester: ${r.requester}\n` +
                        `  Status: ${r.status}\n` +
                        `  Created: ${r.createdAt.toISOString()}`
                      ).join("\n\n"),
                  }],
                  details: { requests },
                };
              }

              case "submit_approval_response": {
                const requestId = params.request_id as string;
                const approverId = params.approver_id as string;
                const approved = params.approved as boolean;

                if (!requestId || !approverId || approved === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: request_id, approver_id, and approved are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await guardrailsManager.submitApprovalResponse(requestId, {
                  approverId,
                  approverName: approverId,
                  decision: approved ? 'approved' : 'rejected',
                  reason: params.reason as string,
                  approved,
                  respondedAt: new Date(),
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to submit approval response: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const req = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `${approved ? "✅" : "❌"} Approval response submitted\n\n` +
                      `**Request ID:** ${req.id}\n` +
                      `**Your Response:** ${approved ? "Approved" : "Rejected"}\n` +
                      `**Current Status:** ${req.status}\n` +
                      `**Approvals Received:** ${req.responses.filter(r => r.approved).length}/${req.requiredApprovers}`,
                  }],
                  details: { approval_request: req },
                };
              }

              case "cancel_approval_request": {
                const requestId = params.request_id as string;
                if (!requestId) {
                  return {
                    content: [{ type: "text", text: "Error: request_id is required" }],
                    details: { error: "missing_request_id" },
                  };
                }

                const result = await guardrailsManager.cancelApprovalRequest(requestId, params.reason as string);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to cancel approval request: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `🚫 Approval request ${requestId} has been cancelled.`,
                  }],
                  details: { cancelled: true, request_id: requestId },
                };
              }

              // ========
              // Dry Run
              // ========
              case "perform_dry_run": {
                const actionType = params.action_type as string;
                const targetResource = params.target_resource as {
                  type: string;
                  id: string;
                  region?: string;
                  account?: string;
                };

                if (!actionType || !targetResource) {
                  return {
                    content: [{ type: "text", text: "Error: action_type and target_resource are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const dryRunContext: OperationContext = {
                  userId: 'system',
                  userName: 'System',
                  action: actionType as ActionType,
                  service: targetResource.type.split(':')[0] || 'unknown',
                  resourceIds: [targetResource.id],
                  resourceType: targetResource.type,
                  region: targetResource.region || region,
                  accountId: targetResource.account,
                  requestParams: params.operation_parameters as Record<string, unknown>,
                  isDryRun: true,
                };
                const result = await guardrailsManager.performDryRun(dryRunContext);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to perform dry run: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const dryRun = result.data!;
                const changesText = dryRun.plannedChanges.length > 0
                  ? dryRun.plannedChanges.map((c: any) =>
                      `• **${c.changeType}** on ${c.resourceType || c.resourceId} (${c.resourceId})\n` +
                      `  ${c.description || 'No description'}\n` +
                      `  Reversible: ${c.isReversible ? "Yes" : "No"}`
                    ).join("\n\n")
                  : "No changes planned.";

                const affectedText = dryRun.affectedResources.length > 0
                  ? dryRun.affectedResources.map((r: any) =>
                      `• ${r.resourceType || r.type}: ${r.resourceId || r.id}`
                    ).join("\n")
                  : "No resources affected.";

                const validationText = (dryRun as any).validationErrors?.length > 0
                  ? `\n\n⚠️ **Validation Errors:**\n${(dryRun as any).validationErrors.map((e: string) => `• ${e}`).join("\n")}`
                  : "";

                return {
                  content: [{
                    type: "text",
                    text: `🔍 **Dry Run Results**\n\n` +
                      `**Action:** ${actionType}\n` +
                      `**Would Succeed:** ${dryRun.wouldSucceed ? "Yes ✅" : "No ❌"}\n` +
                      `**Estimated Duration:** ${dryRun.estimatedDuration}ms\n\n` +
                      `**Planned Changes:**\n${changesText}\n\n` +
                      `**Affected Resources (${dryRun.affectedResources.length}):**\n${affectedText}` +
                      validationText,
                  }],
                  details: { dry_run_result: dryRun },
                };
              }

              // =============
              // Safety Checks
              // =============
              case "run_safety_checks": {
                const actionType = params.action_type as string;
                const targetResource = params.target_resource as {
                  type: string;
                  id: string;
                  region?: string;
                  account?: string;
                };

                if (!actionType || !targetResource) {
                  return {
                    content: [{ type: "text", text: "Error: action_type and target_resource are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const safetyContext: OperationContext = {
                  userId: 'system',
                  userName: 'System',
                  action: actionType as ActionType,
                  service: targetResource.type.split(':')[0] || 'unknown',
                  resourceIds: [targetResource.id],
                  resourceType: targetResource.type,
                  region: targetResource.region || region,
                  accountId: targetResource.account,
                  requestParams: params.operation_parameters as Record<string, unknown>,
                };
                const result = await guardrailsManager.runSafetyChecks(safetyContext);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to run safety checks: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const safetyResult = result.data!;
                const statusEmoji: Record<string, string> = {
                  pass: "✅",
                  fail: "❌",
                  warn: "⚠️",
                  skip: "⏭️",
                };

                const checksText = safetyResult.checks.map((c: any) =>
                  `${statusEmoji[c.passed ? 'pass' : 'fail']} **${c.name}**\n` +
                  `  ${c.message}\n` +
                  (c.description ? `  💡 ${c.description}` : "")
                ).join("\n\n");

                const passed = safetyResult.checks.filter((c: any) => c.passed).length;
                const failed = safetyResult.checks.filter((c: any) => !c.passed && c.isBlocking).length;
                const warned = safetyResult.checks.filter((c: any) => !c.passed && !c.isBlocking).length;

                return {
                  content: [{
                    type: "text",
                    text: `🛡️ **Safety Check Results**\n\n` +
                      `**Summary:** ${passed} passed, ${failed} failed, ${warned} warnings\n\n` +
                      checksText,
                  }],
                  details: { safety_checks: safetyResult },
                };
              }

              case "evaluate_guardrails": {
                const operation = params.operation as {
                  type: string;
                  resource_type?: string;
                  resource_id?: string;
                  parameters?: Record<string, unknown>;
                };
                const environment = params.environment as string;

                if (!operation?.type) {
                  return {
                    content: [{ type: "text", text: "Error: operation.type is required" }],
                    details: { error: "missing_operation_type" },
                  };
                }

                const evalContext: OperationContext = {
                  userId: (params.requester as string) || 'system',
                  userName: (params.requester as string) || 'System',
                  action: operation.type as ActionType,
                  service: operation.resource_type?.split(':')[0] || 'unknown',
                  resourceIds: operation.resource_id ? [operation.resource_id] : [],
                  resourceType: operation.resource_type || 'unknown',
                  region,
                  environment: (environment as Environment) || 'development',
                  requestParams: operation.parameters,
                };
                const result = await guardrailsManager.evaluateGuardrails(evalContext);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to evaluate guardrails: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const evaluation = result.data!;
                const requirementsText = [];

                if (evaluation.requiresApproval) {
                  requirementsText.push(`⚠️ **Requires Approval** (${evaluation.requiredApprovers} approver(s))`);
                }
                if (evaluation.blockedByPolicy) {
                  requirementsText.push(`🚫 **Blocked by Policy:** ${evaluation.blockingPolicies?.join(", ")}`);
                }
                if (evaluation.requiresChangeRequest) {
                  requirementsText.push(`📋 **Requires Change Request**`);
                }
                if (evaluation.requiresBackup) {
                  requirementsText.push(`💾 **Requires Pre-operation Backup**`);
                }
                if (!evaluation.withinAllowedHours) {
                  requirementsText.push(`🕐 **Outside Allowed Hours**`);
                }
                if (evaluation.rateLimited) {
                  requirementsText.push(`⏱️ **Rate Limited**`);
                }

                const warningsText = evaluation.warnings.length > 0
                  ? `\n\n**Warnings:**\n${evaluation.warnings.map(w => `• ${w}`).join("\n")}`
                  : "";

                return {
                  content: [{
                    type: "text",
                    text: `🛡️ **Guardrails Evaluation**\n\n` +
                      `**Operation:** ${operation.type}\n` +
                      `**Environment:** ${environment || "development"}\n` +
                      `**Allowed:** ${evaluation.allowed ? "Yes ✅" : "No ❌"}\n` +
                      `**Risk Level:** ${evaluation.riskLevel}\n\n` +
                      (requirementsText.length > 0 ? `**Requirements:**\n${requirementsText.join("\n")}\n` : "No special requirements.") +
                      warningsText,
                  }],
                  details: { evaluation },
                };
              }

              case "assess_impact": {
                const operation = params.operation as {
                  type: string;
                  resource_type?: string;
                  resource_id?: string;
                  parameters?: Record<string, unknown>;
                };

                if (!operation?.type) {
                  return {
                    content: [{ type: "text", text: "Error: operation.type is required" }],
                    details: { error: "missing_operation_type" },
                  };
                }

                const impactContext: OperationContext = {
                  userId: 'system',
                  userName: 'System',
                  action: operation.type as ActionType,
                  service: operation.resource_type?.split(':')[0] || 'unknown',
                  resourceIds: operation.resource_id ? [operation.resource_id] : [],
                  resourceType: operation.resource_type || 'unknown',
                  region,
                  requestParams: operation.parameters,
                };
                const result = await guardrailsManager.assessImpact(impactContext);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to assess impact: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const impact = result.data!;
                const affectedText = (impact.affectedResources?.length ?? 0) > 0
                  ? impact.affectedResources?.map((r: any) =>
                      `• ${r.resourceType || r.type}: ${r.resourceId || r.id}`
                    ).join("\n")
                  : "No resources directly affected.";

                const dependenciesText = (impact.downstreamDependencies?.length ?? 0) > 0
                  ? `\n\n**Downstream Dependencies:**\n${impact.downstreamDependencies?.map((d: any) => `• ${d}`).join("\n")}`
                  : "";

                const mitigationsText = (impact.mitigationSuggestions?.length ?? 0) > 0
                  ? `\n\n**Mitigation Suggestions:**\n${impact.mitigationSuggestions!.map((m: any) => `• ${m}`).join("\n")}`
                  : "";

                return {
                  content: [{
                    type: "text",
                    text: `📊 **Impact Assessment**\n\n` +
                      `**Blast Radius:** ${impact.blastRadius}\n` +
                      `**Severity:** ${impact.severity}\n` +
                      `**Reversible:** ${impact.reversible ? "Yes" : "No"}\n` +
                      `**Estimated Recovery Time:** ${impact.estimatedRecoveryTime}\n\n` +
                      `**Affected Resources:**\n${affectedText}` +
                      dependenciesText +
                      mitigationsText,
                  }],
                  details: { impact },
                };
              }

              // ======================
              // Environment Protection
              // ======================
              case "get_environment_protection": {
                const environment = params.environment as Environment;
                if (!environment) {
                  return {
                    content: [{ type: "text", text: "Error: environment is required" }],
                    details: { error: "missing_environment" },
                  };
                }

                const prot = guardrailsManager.getEnvironmentProtection(environment);
                if (!prot) {
                  return {
                    content: [{ type: "text", text: `No protection configured for environment: ${environment}` }],
                    details: { error: "no_protection" },
                  };
                }

                const blockedText = prot.blockedActions.length > 0
                  ? prot.blockedActions.join(", ")
                  : "None";

                const hoursText = prot.allowedTimeWindows?.[0]
                  ? `${prot.allowedTimeWindows[0].startHour}:00 - ${prot.allowedTimeWindows[0].endHour}:00 (${prot.allowedTimeWindows[0].timezone})`
                  : "Any time";

                return {
                  content: [{
                    type: "text",
                    text: `🔒 **${environment.toUpperCase()} Environment Protection**\n\n` +
                      `**Protected:** ${prot.isProtected ? "Yes" : "No"}\n` +
                      `**Protection Level:** ${prot.protectionLevel}\n` +
                      `**Approval Required Actions:** ${prot.approvalRequiredActions.join(", ") || "None"}\n` +
                      `**Blocked Actions:** ${blockedText}\n` +
                      `**Allowed Hours:** ${hoursText}\n` +
                      `**Min Approvals:** ${prot.minApprovals || 0}`,
                  }],
                  details: { protection: prot },
                };
              }

              case "set_environment_protection": {
                const environment = params.environment as Environment;
                const settings = params.protection_settings as {
                  approval_required?: boolean;
                  min_approvers?: number;
                  allowed_hours?: {
                    start: number;
                    end: number;
                    timezone: string;
                    days?: number[];
                  };
                  blocked_actions?: string[];
                  require_change_request?: boolean;
                  require_backup?: boolean;
                  max_blast_radius?: number;
                };

                if (!environment || !settings) {
                  return {
                    content: [{ type: "text", text: "Error: environment and protection_settings are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const protection: EnvironmentProtection = {
                  environment,
                  isProtected: settings.approval_required !== false,
                  protectionLevel: settings.approval_required ? 'full' : 'partial',
                  approvalRequiredActions: settings.blocked_actions as ActionType[] || [],
                  blockedActions: settings.blocked_actions as ActionType[] || [],
                  allowedTimeWindows: settings.allowed_hours ? [{
                    days: (settings.allowed_hours.days || [1, 2, 3, 4, 5]).map(d => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d] as DayOfWeek),
                    startHour: settings.allowed_hours.start,
                    endHour: settings.allowed_hours.end,
                    timezone: settings.allowed_hours.timezone,
                  }] : undefined,
                  minApprovals: settings.min_approvers,
                };

                guardrailsManager.setEnvironmentProtection(protection);

                return {
                  content: [{
                    type: "text",
                    text: `✅ Environment protection for **${environment}** has been updated.`,
                  }],
                  details: { protection },
                };
              }

              // =============
              // Audit Logging
              // =============
              case "log_action": {
                const entry = params.audit_entry as {
                  action_type: string;
                  resource_type?: string;
                  resource_id?: string;
                  user_id?: string;
                  result: "success" | "failure" | "blocked" | "dry_run";
                  details?: Record<string, unknown>;
                };

                if (!entry?.action_type || !entry?.result) {
                  return {
                    content: [{ type: "text", text: "Error: audit_entry with action_type and result is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await guardrailsManager.logAction({
                  userId: entry.user_id || "system",
                  userName: entry.user_id || "System",
                  action: entry.action_type as ActionType,
                  service: entry.resource_type?.split(':')[0] || 'unknown',
                  resourceIds: entry.resource_id ? [entry.resource_id] : [],
                  environment: 'unknown' as Environment,
                  region: region,
                  outcome: entry.result === 'dry_run' ? 'success' : entry.result as 'success' | 'failure' | 'blocked' | 'pending_approval',
                  dryRun: entry.result === 'dry_run',
                  context: entry.details,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to log action: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `📝 Action logged successfully\n\n` +
                      `**Log ID:** ${result.data!.id}\n` +
                      `**Action:** ${entry.action_type}\n` +
                      `**Result:** ${entry.result}`,
                  }],
                  details: { audit_log: result.data },
                };
              }

              case "query_audit_logs": {
                const filter = params.query_filter as {
                  start_time?: string;
                  end_time?: string;
                  user_id?: string;
                  action_type?: string;
                  resource_type?: string;
                  result?: string;
                };

                const result = await guardrailsManager.queryAuditLogs({
                  startTime: filter?.start_time ? new Date(filter.start_time) : undefined,
                  endTime: filter?.end_time ? new Date(filter.end_time) : undefined,
                  userId: filter?.user_id,
                  actions: filter?.action_type ? [filter.action_type as ActionType] : undefined,
                  services: filter?.resource_type ? [filter.resource_type.split(':')[0]] : undefined,
                  outcomes: filter?.result ? [filter.result as 'success' | 'failure' | 'blocked' | 'pending_approval'] : undefined,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to query audit logs: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const logsResult = result.data!;
                const logs = logsResult.entries || [];
                if (logs.length === 0) {
                  return {
                    content: [{ type: "text", text: "No audit logs found matching the criteria." }],
                    details: { logs: [] },
                  };
                }

                const resultEmoji: Record<string, string> = {
                  success: "✅",
                  failure: "❌",
                  blocked: "🚫",
                  pending_approval: "⏳",
                };

                const logsText = logs.slice(0, 20).map((log: AuditLogEntry) =>
                  `${resultEmoji[log.outcome] || "•"} **${log.action}** by ${log.userId}\n` +
                  `  Time: ${log.timestamp.toISOString()}\n` +
                  `  Resource: ${log.service || "N/A"} - ${log.resourceIds?.join(', ') || "N/A"}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `📋 **Audit Logs** (${logs.length} entries)\n\n${logsText}` +
                      (logs.length > 20 ? `\n\n... and ${logs.length - 20} more entries` : ""),
                  }],
                  details: { logs },
                };
              }

              case "get_audit_log_summary": {
                const period = (params.summary_period as "hour" | "day" | "week" | "month") || "day";
                const periodMs: Record<string, number> = {
                  hour: 60 * 60 * 1000,
                  day: 24 * 60 * 60 * 1000,
                  week: 7 * 24 * 60 * 60 * 1000,
                  month: 30 * 24 * 60 * 60 * 1000,
                };
                const endTime = new Date();
                const startTime = new Date(endTime.getTime() - periodMs[period]);
                const result = await guardrailsManager.getAuditLogSummary(startTime, endTime);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get audit log summary: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const summary = result.data!;
                const actionsText = Object.entries(summary.byAction)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([action, count]) => `• ${action}: ${count}`)
                  .join("\n");

                const usersText = Object.entries(summary.byUser)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([user, count]) => `• ${user}: ${count}`)
                  .join("\n");

                return {
                  content: [{
                    type: "text",
                    text: `📊 **Audit Log Summary** (past ${period})\n\n` +
                      `**Total Operations:** ${summary.totalOperations}\n` +
                      `**Successful:** ${summary.successfulOperations}\n` +
                      `**Failed:** ${summary.failedOperations}\n` +
                      `**Blocked:** ${summary.blockedOperations}\n\n` +
                      `**Top Actions:**\n${actionsText || "None"}\n\n` +
                      `**Top Users:**\n${usersText || "None"}`,
                  }],
                  details: { summary },
                };
              }

              // ============
              // Rate Limiting
              // ============
              case "check_rate_limit": {
                const key = params.rate_limit_key as string;
                if (!key) {
                  return {
                    content: [{ type: "text", text: "Error: rate_limit_key is required" }],
                    details: { error: "missing_rate_limit_key" },
                  };
                }

                const status = guardrailsManager.checkRateLimit(key, 'read' as ActionType);
                return {
                  content: [{
                    type: "text",
                    text: `⏱️ **Rate Limit Status: ${key}**\n\n` +
                      `**Rate Limited:** ${status.isRateLimited ? "Yes ❌" : "No ✅"}\n` +
                      `**Operations This Minute:** ${status.operationsThisMinute}\n` +
                      `**Operations This Hour:** ${status.operationsThisHour}\n` +
                      `**Remaining This Minute:** ${status.remainingThisMinute}\n` +
                      `**Remaining This Hour:** ${status.remainingThisHour}` +
                      (status.rateLimitReason ? `\n**Reason:** ${status.rateLimitReason}` : ""),
                  }],
                  details: { rate_limit_status: status },
                };
              }

              case "get_rate_limit_config": {
                const config = guardrailsManager.getRateLimitConfig();
                return {
                  content: [{
                    type: "text",
                    text: `⚙️ **Rate Limit Configuration**\n\n` +
                      `**Max Resources Per Operation:** ${config.maxResourcesPerOperation}\n` +
                      `**Max Operations Per Minute:** ${config.maxOperationsPerMinute}\n` +
                      `**Max Operations Per Hour:** ${config.maxOperationsPerHour}\n` +
                      `**Max Destructive Operations Per Day:** ${config.maxDestructiveOperationsPerDay}\n` +
                      `**Confirmation Threshold:** ${config.confirmationThreshold}`,
                  }],
                  details: { config },
                };
              }

              case "set_rate_limit_config": {
                const config = params.rate_limit_config as {
                  max_requests?: number;
                  max_operations_per_minute?: number;
                  max_operations_per_hour?: number;
                  max_destructive_operations_per_day?: number;
                };

                if (!config) {
                  return {
                    content: [{ type: "text", text: "Error: rate_limit_config is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                guardrailsManager.setRateLimitConfig({
                  maxResourcesPerOperation: config.max_requests,
                  maxOperationsPerMinute: config.max_operations_per_minute,
                  maxOperationsPerHour: config.max_operations_per_hour,
                  maxDestructiveOperationsPerDay: config.max_destructive_operations_per_day,
                });

                return {
                  content: [{
                    type: "text",
                    text: `✅ Rate limit configuration has been updated.`,
                  }],
                  details: { config },
                };
              }

              // =====================
              // Pre-operation Backups
              // =====================
              case "create_pre_operation_backup": {
                const targetResource = params.target_resource as {
                  type: string;
                  id: string;
                  region?: string;
                };
                const operation = params.operation as { type: string };

                if (!targetResource || !operation?.type) {
                  return {
                    content: [{ type: "text", text: "Error: target_resource and operation.type are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await guardrailsManager.createPreOperationBackup(
                  targetResource.id,
                  targetResource.type,
                  operation.type
                );

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create pre-operation backup: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const backup = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `💾 **Pre-operation Backup Created**\n\n` +
                      `**Backup ID:** ${backup.id}\n` +
                      `**Resource:** ${backup.resourceType} - ${backup.resourceId}\n` +
                      `**Type:** ${backup.backupType}\n` +
                      `**Created:** ${backup.createdAt.toISOString()}` +
                      (backup.expiresAt ? `\n**Expires:** ${backup.expiresAt.toISOString()}` : ""),
                  }],
                  details: { backup },
                };
              }

              case "list_pre_operation_backups": {
                const targetResource = params.target_resource as {
                  type?: string;
                  id?: string;
                };

                const result = await guardrailsManager.listPreOperationBackups(targetResource?.id);

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list pre-operation backups: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const backups = result.data!;
                if (backups.length === 0) {
                  return {
                    content: [{ type: "text", text: "No pre-operation backups found." }],
                    details: { backups: [] },
                  };
                }

                const backupsText = backups.map((b: PreOperationBackup) =>
                  `• **${b.id}**\n` +
                  `  Resource: ${b.resourceType} - ${b.resourceId}\n` +
                  `  Operation: ${b.triggeringOperation}\n` +
                  `  Type: ${b.backupType}\n` +
                  `  Created: ${b.createdAt.toISOString()}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `💾 **Pre-operation Backups** (${backups.length})\n\n${backupsText}`,
                  }],
                  details: { backups },
                };
              }

              // ===============
              // Change Requests
              // ===============
              case "create_change_request": {
                const cr = params.change_request as {
                  title: string;
                  description?: string;
                  requester: string;
                  affected_resources?: Array<{
                    type: string;
                    id: string;
                    region?: string;
                  }>;
                  planned_changes?: Array<{
                    change_type: string;
                    description: string;
                  }>;
                  scheduled_time?: string;
                  estimated_duration_minutes?: number;
                  rollback_plan?: string;
                };

                if (!cr?.title || !cr?.requester) {
                  return {
                    content: [{ type: "text", text: "Error: change_request with title and requester is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await guardrailsManager.createChangeRequest({
                  title: cr.title,
                  description: cr.description || '',
                  changeType: 'normal',
                  priority: 'medium',
                  requestedBy: cr.requester,
                  plannedActions: cr.planned_changes?.map((c, i) => ({
                    order: i + 1,
                    description: c.description,
                    service: 'aws',
                    actionType: c.change_type as ActionType,
                    targetResources: cr.affected_resources?.map(r => r.id) || [],
                    expectedOutcome: c.description,
                  })) || [],
                  impactAssessment: {
                    severity: 'medium',
                    affectedResourceCount: cr.affected_resources?.length || 0,
                    affectedResourceTypes: cr.affected_resources?.map(r => r.type) || [],
                    rollbackPossible: true,
                    riskFactors: [],
                    recommendations: [],
                    affectedResources: [],
                    downstreamDependencies: [],
                    mitigationSuggestions: [],
                    blastRadius: 'low',
                    reversible: true,
                    estimatedRecoveryTime: 'N/A',
                  },
                  rollbackPlan: cr.rollback_plan,
                  scheduledStart: cr.scheduled_time ? new Date(cr.scheduled_time) : undefined,
                  requester: undefined,
                  scheduledTime: undefined,
                  plannedChanges: undefined,
                  affectedResources: undefined,
                  estimatedDurationMinutes: ""
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create change request: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const request = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `📋 **Change Request Created**\n\n` +
                      `**ID:** ${request.id}\n` +
                      `**Title:** ${request.title}\n` +
                      `**Status:** ${request.status}\n` +
                      `**Requested By:** ${request.requestedBy}\n` +
                      `**Created:** ${request.createdAt.toISOString()}` +
                      (request.scheduledStart ? `\n**Scheduled:** ${request.scheduledStart.toISOString()}` : ""),
                  }],
                  details: { change_request: request },
                };
              }

              case "get_change_request": {
                const id = params.change_request_id as string;
                if (!id) {
                  return {
                    content: [{ type: "text", text: "Error: change_request_id is required" }],
                    details: { error: "missing_change_request_id" },
                  };
                }

                const result = await guardrailsManager.getChangeRequest(id);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get change request: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const cr = result.data!;
                const changesText = cr.plannedActions?.length > 0
                  ? cr.plannedActions.map((c: any) => `• ${c.actionType}: ${c.description}`).join("\n")
                  : "None specified";

                const resourcesText = cr.plannedActions?.flatMap((a: any) => a.targetResources || []).length > 0
                  ? cr.plannedActions.flatMap((a: any) => a.targetResources || []).map((r: string) => `• ${r}`).join("\n")
                  : "None specified";

                return {
                  content: [{
                    type: "text",
                    text: `📋 **Change Request: ${cr.id}**\n\n` +
                      `**Title:** ${cr.title}\n` +
                      `**Description:** ${cr.description || "N/A"}\n` +
                      `**Status:** ${cr.status}\n` +
                      `**Requested By:** ${cr.requestedBy}\n` +
                      `**Created:** ${cr.createdAt.toISOString()}\n` +
                      (cr.scheduledStart ? `**Scheduled:** ${cr.scheduledStart.toISOString()}\n` : "") +
                      `\n**Planned Actions:**\n${changesText}\n\n` +
                      `**Target Resources:**\n${resourcesText}\n\n` +
                      `**Rollback Plan:** ${cr.rollbackPlan || "Not specified"}`,
                  }],
                  details: { change_request: cr },
                };
              }

              case "update_change_request_status": {
                const id = params.change_request_id as string;
                const status = params.change_status as string;

                if (!id || !status) {
                  return {
                    content: [{ type: "text", text: "Error: change_request_id and change_status are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await guardrailsManager.updateChangeRequestStatus(
                  id,
                  status as ChangeRequest['status'],
                  params.reason as string
                );

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to update change request status: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Change request **${id}** status updated to **${status}**.`,
                  }],
                  details: { change_request: result.data },
                };
              }

              case "list_change_requests": {
                const statusFilter = params.change_status as ChangeRequest['status'] | undefined;
                const result = await guardrailsManager.listChangeRequests({
                  status: statusFilter,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list change requests: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const requests = result.data!;
                if (requests.length === 0) {
                  return {
                    content: [{ type: "text", text: `No change requests found${statusFilter ? ` with status: ${statusFilter}` : ""}.` }],
                    details: { change_requests: [] },
                  };
                }

                const statusEmoji: Record<string, string> = {
                  draft: "📝",
                  pending_review: "⏳",
                  approved: "✅",
                  in_progress: "🔄",
                  completed: "✓",
                  cancelled: "🚫",
                  failed: "❌",
                };

                const requestsText = requests.map((cr: ChangeRequest) =>
                  `${statusEmoji[cr.status] || "•"} **${cr.id}**: ${cr.title}\n` +
                  `  Status: ${cr.status} | Requested By: ${cr.requestedBy}\n` +
                  `  Created: ${cr.createdAt.toISOString()}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `📋 **Change Requests** (${requests.length})\n\n${requestsText}`,
                  }],
                  details: { change_requests: requests },
                };
              }

              // =================
              // Policy Management
              // =================
              case "add_policy": {
                const policy = params.policy as {
                  name: string;
                  description?: string;
                  enabled?: boolean;
                  priority?: number;
                  conditions?: Array<{
                    field: string;
                    operator: string;
                    value: unknown;
                  }>;
                  actions?: Array<{
                    type: string;
                    parameters?: Record<string, unknown>;
                  }>;
                };

                if (!policy?.name) {
                  return {
                    content: [{ type: "text", text: "Error: policy with name is required" }],
                    details: { error: "missing_policy_name" },
                  };
                }

                const newPolicy = guardrailsManager.addPolicy({
                  name: policy.name,
                  description: policy.description || '',
                  enabled: policy.enabled !== false,
                  priority: policy.priority || 100,
                  conditions: (policy.conditions || []) as any,
                  actions: (policy.actions || []) as any,
                  success: undefined,
                  error: undefined,
                  data: undefined
                });

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policy.name}** has been added.\n\n` +
                      `**ID:** ${newPolicy.id}\n` +
                      `**Priority:** ${newPolicy.priority}\n` +
                      `**Enabled:** ${newPolicy.enabled ? "Yes" : "No"}`,
                  }],
                  details: { policy: newPolicy },
                };
              }

              case "get_policy": {
                const policyId = params.policy_id as string;
                if (!policyId) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id is required" }],
                    details: { error: "missing_policy_id" },
                  };
                }

                const pol = guardrailsManager.getPolicy(policyId);
                if (!pol) {
                  return {
                    content: [{ type: "text", text: `Policy not found: ${policyId}` }],
                    details: { error: "policy_not_found" },
                  };
                }

                const conditionsText = pol.conditions.length > 0
                  ? pol.conditions.map((c: any) => `• ${c.type} ${c.operator} ${JSON.stringify(c.value)}`).join("\n")
                  : "None";

                const actionsText = pol.actions.length > 0
                  ? pol.actions.map((a: any) => `• ${a.type}`).join("\n")
                  : "None";

                return {
                  content: [{
                    type: "text",
                    text: `📜 **Policy: ${pol.name}**\n\n` +
                      `**ID:** ${pol.id}\n` +
                      `**Description:** ${pol.description || "N/A"}\n` +
                      `**Enabled:** ${pol.enabled ? "Yes" : "No"}\n` +
                      `**Priority:** ${pol.priority}\n\n` +
                      `**Conditions:**\n${conditionsText}\n\n` +
                      `**Actions:**\n${actionsText}`,
                  }],
                  details: { policy: pol },
                };
              }

              case "list_policies": {
                const policies = guardrailsManager.listPolicies();
                if (policies.length === 0) {
                  return {
                    content: [{ type: "text", text: "No policies configured." }],
                    details: { policies: [] },
                  };
                }

                const policiesText = policies.map((p: any) =>
                  `• **${p.name}** (${p.id})\n` +
                  `  Priority: ${p.priority} | Enabled: ${p.enabled ? "Yes" : "No"}\n` +
                  `  ${p.description || ""}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `📜 **Guardrails Policies** (${policies.length})\n\n${policiesText}`,
                  }],
                  details: { policies },
                };
              }

              case "update_policy": {
                const policyId = params.policy_id as string;
                const updates = params.policy as {
                  name?: string;
                  description?: string;
                  enabled?: boolean;
                  priority?: number;
                  conditions?: Array<{
                    field: string;
                    operator: string;
                    value: unknown;
                  }>;
                  actions?: Array<{
                    type: string;
                    parameters?: Record<string, unknown>;
                  }>;
                };

                if (!policyId || !updates) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id and policy updates are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const updatedPolicy = guardrailsManager.updatePolicy(policyId, updates as any);
                if (!updatedPolicy) {
                  return {
                    content: [{ type: "text", text: `Policy not found: ${policyId}` }],
                    details: { error: "policy_not_found" },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policyId}** has been updated.`,
                  }],
                  details: { policy: updatedPolicy },
                };
              }

              case "remove_policy": {
                const policyId = params.policy_id as string;
                if (!policyId) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id is required" }],
                    details: { error: "missing_policy_id" },
                  };
                }

                const removed = guardrailsManager.removePolicy(policyId);
                if (!removed) {
                  return {
                    content: [{ type: "text", text: `Policy not found: ${policyId}` }],
                    details: { error: "policy_not_found" },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policyId}** has been removed.`,
                  }],
                  details: { removed: true, policy_id: policyId },
                };
              }

              // ====================
              // Action Classification
              // ====================
              case "classify_action": {
                const actionType = params.action_type as string;
                if (!actionType) {
                  return {
                    content: [{ type: "text", text: "Error: action_type is required" }],
                    details: { error: "missing_action_type" },
                  };
                }

                const classification = guardrailsManager.classifyAction(actionType as ActionType, 'aws');
                return {
                  content: [{
                    type: "text",
                    text: `🏷️ **Action Classification: ${actionType}**\n\n` +
                      `**Severity:** ${classification.severity}\n` +
                      `**Destructive:** ${classification.isDestructive ? "Yes ⚠️" : "No"}\n` +
                      `**Requires Approval:** ${classification.requiresApproval ? "Yes" : "No"}\n` +
                      `**Category:** ${classification.category}`,
                  }],
                  details: { classification },
                };
              }

              // =============
              // Notifications
              // =============
              case "configure_notification_channel": {
                const channelType = params.channel_type as "sns" | "slack" | "email" | "webhook";
                const config = params.channel_config as {
                  topic_arn?: string;
                  webhook_url?: string;
                  email_addresses?: string[];
                };

                if (!channelType || !config) {
                  return {
                    content: [{ type: "text", text: "Error: channel_type and channel_config are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                guardrailsManager.configureNotificationChannel({
                  type: channelType === 'webhook' ? 'webhook' : channelType === 'email' ? 'email' : channelType === 'slack' ? 'slack' : 'sns',
                  enabled: true,
                  endpoint: config.topic_arn || config.webhook_url || config.email_addresses?.[0] || '',
                  events: ['approval_requested', 'approval_granted', 'approval_denied'],
                });

                return {
                  content: [{
                    type: "text",
                    text: `✅ Notification channel **${channelType}** has been configured.`,
                  }],
                  details: { channel_type: channelType, configured: true },
                };
              }

              // =============
              // Configuration
              // =============
              case "get_config": {
                const config = guardrailsManager.getConfig();
                return {
                  content: [{
                    type: "text",
                    text: `⚙️ **Guardrails Configuration**\n\n` +
                      `**Default Region:** ${config.defaultRegion}\n` +
                      `**Dry Run by Default:** ${config.dryRunByDefault ? "Yes" : "No"}\n` +
                      `**Require Approval for Destructive:** ${config.requireApprovalForDestructive ? "Yes" : "No"}\n` +
                      `**Audit All Operations:** ${config.auditAllOperations ? "Yes" : "No"}\n` +
                      `**Default Approval Timeout:** ${config.defaultApprovalTimeoutHours} hours\n` +
                      `**Max Blast Radius:** ${config.maxBlastRadius}`,
                  }],
                  details: { config },
                };
              }

              case "update_config": {
                const configKey = params.config_key as string;
                const configValue = params.config_value;

                if (!configKey || configValue === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: config_key and config_value are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                guardrailsManager.updateConfig({ [configKey]: configValue });

                return {
                  content: [{
                    type: "text",
                    text: `✅ Configuration **${configKey}** has been updated.`,
                  }],
                  details: { updated: true, key: configKey },
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
              content: [{ type: "text", text: `Guardrails error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_guardrails" },
    );

    // ==========================================================================
    // AWS Organization Tool - Multi-Account & Organization Management
    // ==========================================================================
    api.registerTool(
      {
        name: "aws_organizations",
        label: "AWS Organizations Management",
        description: `Multi-account and AWS Organization management tool providing:
- Organization management (view organization, roots, accounts)
- Account management (list, create, move, remove accounts)
- Organizational Unit (OU) management
- Service Control Policies (SCPs) with pre-built templates
- Cross-account operations via assume role
- Resource Access Manager (RAM) for resource sharing
- Consolidated billing insights across accounts
- Delegated administrator management
- Account invitation workflows`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "The action to perform",
              enum: [
                // Organization operations
                "get_organization",
                "get_roots",
                // Account operations
                "list_accounts",
                "get_account",
                "create_account",
                "get_create_account_status",
                "move_account",
                "remove_account",
                // OU operations
                "list_organizational_units",
                "get_organizational_unit",
                "create_organizational_unit",
                "update_organizational_unit",
                "delete_organizational_unit",
                // SCP operations
                "list_policies",
                "get_policy",
                "create_policy",
                "update_policy",
                "delete_policy",
                "attach_policy",
                "detach_policy",
                "list_policies_for_target",
                "get_policy_targets",
                "enable_policy_type",
                "disable_policy_type",
                "get_scp_templates",
                "get_scp_template",
                // Cross-account operations
                "assume_role",
                "switch_account",
                "get_current_context",
                "get_active_sessions",
                "reset_context",
                // Resource sharing (RAM)
                "create_resource_share",
                "delete_resource_share",
                "list_resource_shares",
                "add_resources_to_share",
                "remove_resources_from_share",
                "add_principals_to_share",
                "remove_principals_from_share",
                "list_shareable_resource_types",
                // Consolidated billing
                "get_consolidated_billing",
                // Delegated admin
                "list_delegated_administrators",
                "get_delegated_services",
                "register_delegated_administrator",
                "deregister_delegated_administrator",
                // Handshakes
                "list_handshakes",
                "invite_account",
                "accept_handshake",
                "decline_handshake",
                "cancel_handshake",
                // Cross-account resource discovery
                "discover_cross_account_resources",
                "get_cross_account_resource_summary",
                // Tags
                "get_resource_tags",
                "tag_resource",
                "untag_resource",
              ],
            },
            region: {
              type: "string",
              description: "AWS region (default: us-east-1)",
            },
            // Account parameters
            account_id: {
              type: "string",
              description: "AWS account ID (12-digit)",
            },
            account_name: {
              type: "string",
              description: "Account name for creation",
            },
            email: {
              type: "string",
              description: "Account email (must be unique)",
            },
            // OU parameters
            ou_id: {
              type: "string",
              description: "Organizational Unit ID",
            },
            ou_name: {
              type: "string",
              description: "Organizational Unit name",
            },
            parent_id: {
              type: "string",
              description: "Parent ID (root or OU)",
            },
            source_parent_id: {
              type: "string",
              description: "Source parent ID when moving account",
            },
            destination_parent_id: {
              type: "string",
              description: "Destination parent ID when moving account",
            },
            // Policy parameters
            policy_id: {
              type: "string",
              description: "Policy ID",
            },
            policy_name: {
              type: "string",
              description: "Policy name",
            },
            policy_description: {
              type: "string",
              description: "Policy description",
            },
            policy_content: {
              type: "object",
              description: "Policy document (SCP JSON)",
            },
            policy_type: {
              type: "string",
              description: "Policy type",
              enum: ["SERVICE_CONTROL_POLICY", "TAG_POLICY", "BACKUP_POLICY", "AISERVICES_OPT_OUT_POLICY"],
            },
            target_id: {
              type: "string",
              description: "Target ID for policy attachment (account, OU, or root)",
            },
            root_id: {
              type: "string",
              description: "Organization root ID",
            },
            template_id: {
              type: "string",
              description: "SCP template ID",
            },
            template_category: {
              type: "string",
              description: "SCP template category",
              enum: ["security", "data-protection", "cost-management", "compliance", "networking", "logging", "identity"],
            },
            // Cross-account parameters
            role_name: {
              type: "string",
              description: "IAM role name for assume role (default: OrganizationAccountAccessRole)",
            },
            role_arn: {
              type: "string",
              description: "Full IAM role ARN to assume",
            },
            session_name: {
              type: "string",
              description: "Session name for assumed role",
            },
            duration_seconds: {
              type: "number",
              description: "Session duration in seconds (900-43200)",
            },
            external_id: {
              type: "string",
              description: "External ID for assume role",
            },
            // Resource sharing parameters
            resource_share_name: {
              type: "string",
              description: "Resource share name",
            },
            resource_share_arn: {
              type: "string",
              description: "Resource share ARN",
            },
            resource_arns: {
              type: "array",
              items: { type: "string" },
              description: "Resource ARNs to share",
            },
            principals: {
              type: "array",
              items: { type: "string" },
              description: "Principal IDs (account IDs, OU ARNs, or organization ARN)",
            },
            allow_external_principals: {
              type: "boolean",
              description: "Allow principals outside organization",
            },
            resource_owner: {
              type: "string",
              description: "Resource owner filter",
              enum: ["SELF", "OTHER-ACCOUNTS"],
            },
            // Billing parameters
            start_date: {
              type: "string",
              description: "Start date for billing period (YYYY-MM-DD)",
            },
            end_date: {
              type: "string",
              description: "End date for billing period (YYYY-MM-DD)",
            },
            granularity: {
              type: "string",
              description: "Billing data granularity",
              enum: ["DAILY", "MONTHLY"],
            },
            // Delegated admin parameters
            service_principal: {
              type: "string",
              description: "AWS service principal (e.g., securityhub.amazonaws.com)",
            },
            // Handshake parameters
            handshake_id: {
              type: "string",
              description: "Handshake ID",
            },
            invite_target: {
              type: "string",
              description: "Account ID or email to invite",
            },
            invite_target_type: {
              type: "string",
              description: "Invite target type",
              enum: ["ACCOUNT", "EMAIL"],
            },
            invite_notes: {
              type: "string",
              description: "Notes to include with invitation",
            },
            // Request ID
            request_id: {
              type: "string",
              description: "Create account request ID",
            },
            // Tags
            tags: {
              type: "object",
              description: "Tags to apply (key-value pairs)",
            },
            tag_keys: {
              type: "array",
              items: { type: "string" },
              description: "Tag keys to remove",
            },
            resource_id: {
              type: "string",
              description: "Resource ID for tagging",
            },
            // Filters
            status_filter: {
              type: "string",
              description: "Account status filter",
              enum: ["ACTIVE", "SUSPENDED", "PENDING_CLOSURE"],
            },
            include_tags: {
              type: "boolean",
              description: "Include tags in response",
            },
            include_cost_data: {
              type: "boolean",
              description: "Include cost data in response",
            },
            include_accounts: {
              type: "boolean",
              description: "Include accounts in OU response",
            },
            include_content: {
              type: "boolean",
              description: "Include full policy content",
            },
            recursive: {
              type: "boolean",
              description: "Recursively list OUs",
            },
            // Pagination
            max_results: {
              type: "number",
              description: "Maximum results to return",
            },
            next_token: {
              type: "string",
              description: "Pagination token",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const action = params.action as string;
          const region = (params.region as string) || "us-east-1";

          // Initialize organization manager if needed
          if (!organizationManager) {
            organizationManager = createOrganizationManager({
              defaultRegion: region,
            });
          }

          try {
            switch (action) {
              // ==================
              // Organization Operations
              // ==================
              case "get_organization": {
                const result = await organizationManager.getOrganization();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get organization: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const org = result.data!;
                const policyTypesText = org.availablePolicyTypes
                  .map(pt => `• ${pt.type}: ${pt.status}`)
                  .join("\n");

                return {
                  content: [{
                    type: "text",
                    text: `🏢 **AWS Organization**\n\n` +
                      `**ID:** ${org.id}\n` +
                      `**ARN:** ${org.arn}\n` +
                      `**Management Account:** ${org.masterAccountId}\n` +
                      `**Management Email:** ${org.masterAccountEmail}\n` +
                      `**Feature Set:** ${org.featureSet}\n\n` +
                      `**Available Policy Types:**\n${policyTypesText}`,
                  }],
                  details: { organization: org },
                };
              }

              case "get_roots": {
                const result = await organizationManager.getRoots();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get roots: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const rootsText = result.data!.map(root =>
                  `• **${root.name}** (${root.id})\n  Policy types: ${root.policyTypes.map(pt => pt.type).join(", ") || "none"}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `🌳 **Organization Roots**\n\n${rootsText}`,
                  }],
                  details: { roots: result.data },
                };
              }

              // ==================
              // Account Operations
              // ==================
              case "list_accounts": {
                const result = await organizationManager.listAccounts({
                  status: params.status_filter as any,
                  organizationalUnitId: params.ou_id as string,
                  includeTags: params.include_tags as boolean,
                  includeCostData: params.include_cost_data as boolean,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list accounts: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const accounts = result.data!;
                if (accounts.length === 0) {
                  return {
                    content: [{ type: "text", text: "No accounts found." }],
                    details: { accounts: [] },
                  };
                }

                const accountsText = accounts.map(acc =>
                  `• **${acc.name}** (${acc.id})\n` +
                  `  Email: ${acc.email}\n` +
                  `  Status: ${acc.status} | Joined: ${acc.joinedMethod}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `👥 **AWS Accounts** (${accounts.length})\n\n${accountsText}`,
                  }],
                  details: { accounts },
                };
              }

              case "get_account": {
                const accountId = params.account_id as string;
                if (!accountId) {
                  return {
                    content: [{ type: "text", text: "Error: account_id is required" }],
                    details: { error: "missing_account_id" },
                  };
                }

                const result = await organizationManager.getAccount(accountId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get account: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const acc = result.data!;
                const tagsText = acc.tags && Object.keys(acc.tags).length > 0
                  ? Object.entries(acc.tags).map(([k, v]) => `  • ${k}: ${v}`).join("\n")
                  : "  (none)";

                return {
                  content: [{
                    type: "text",
                    text: `👤 **Account: ${acc.name}**\n\n` +
                      `**ID:** ${acc.id}\n` +
                      `**ARN:** ${acc.arn}\n` +
                      `**Email:** ${acc.email}\n` +
                      `**Status:** ${acc.status}\n` +
                      `**Joined:** ${acc.joinedTimestamp.toISOString()} (${acc.joinedMethod})\n` +
                      `**OU:** ${acc.organizationalUnitId || "Root"}\n` +
                      `**Management Account:** ${acc.isManagementAccount ? "Yes" : "No"}\n` +
                      `**Delegated Admin:** ${acc.isDelegatedAdmin ? "Yes" : "No"}\n\n` +
                      `**Tags:**\n${tagsText}`,
                  }],
                  details: { account: acc },
                };
              }

              case "create_account": {
                const accountName = params.account_name as string;
                const email = params.email as string;
                if (!accountName || !email) {
                  return {
                    content: [{ type: "text", text: "Error: account_name and email are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.createAccount({
                  accountName,
                  email,
                  roleName: params.role_name as string,
                  tags: params.tags as Record<string, string>,
                  destinationParentId: params.destination_parent_id as string,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create account: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const status = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `✅ Account creation initiated\n\n` +
                      `**Request ID:** ${status.id}\n` +
                      `**Account Name:** ${status.accountName}\n` +
                      `**State:** ${status.state}\n` +
                      `${status.accountId ? `**Account ID:** ${status.accountId}\n` : ""}` +
                      `\nUse \`get_create_account_status\` to check progress.`,
                  }],
                  details: { create_account_status: status },
                };
              }

              case "get_create_account_status": {
                const requestId = params.request_id as string;
                if (!requestId) {
                  return {
                    content: [{ type: "text", text: "Error: request_id is required" }],
                    details: { error: "missing_request_id" },
                  };
                }

                const result = await organizationManager.getCreateAccountStatus(requestId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get status: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const status = result.data!;
                const statusEmoji = status.state === "SUCCEEDED" ? "✅" : status.state === "FAILED" ? "❌" : "⏳";
                return {
                  content: [{
                    type: "text",
                    text: `${statusEmoji} **Account Creation Status**\n\n` +
                      `**Request ID:** ${status.id}\n` +
                      `**Account Name:** ${status.accountName}\n` +
                      `**State:** ${status.state}\n` +
                      `${status.accountId ? `**Account ID:** ${status.accountId}\n` : ""}` +
                      `${status.failureReason ? `**Failure Reason:** ${status.failureReason}\n` : ""}`,
                  }],
                  details: { create_account_status: status },
                };
              }

              case "move_account": {
                const accountId = params.account_id as string;
                const sourceParentId = params.source_parent_id as string;
                const destinationParentId = params.destination_parent_id as string;

                if (!accountId || !sourceParentId || !destinationParentId) {
                  return {
                    content: [{ type: "text", text: "Error: account_id, source_parent_id, and destination_parent_id are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.moveAccount({
                  accountId,
                  sourceParentId,
                  destinationParentId,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to move account: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Account **${accountId}** moved successfully from ${sourceParentId} to ${destinationParentId}`,
                  }],
                  details: { moved: true, account_id: accountId },
                };
              }

              case "remove_account": {
                const accountId = params.account_id as string;
                if (!accountId) {
                  return {
                    content: [{ type: "text", text: "Error: account_id is required" }],
                    details: { error: "missing_account_id" },
                  };
                }

                const result = await organizationManager.removeAccount(accountId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to remove account: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Account **${accountId}** removed from organization`,
                  }],
                  details: { removed: true, account_id: accountId },
                };
              }

              // ==================
              // Organizational Unit Operations
              // ==================
              case "list_organizational_units": {
                const result = await organizationManager.listOrganizationalUnits({
                  parentId: params.parent_id as string,
                  recursive: params.recursive as boolean,
                  includeAccounts: params.include_accounts as boolean,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list OUs: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const ous = result.data!;
                if (ous.length === 0) {
                  return {
                    content: [{ type: "text", text: "No organizational units found." }],
                    details: { organizational_units: [] },
                  };
                }

                const ousText = ous.map(ou =>
                  `• **${ou.name}** (${ou.id})\n` +
                  `  Parent: ${ou.parentId}` +
                  (ou.accounts ? `\n  Accounts: ${ou.accounts.length}` : "")
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `📁 **Organizational Units** (${ous.length})\n\n${ousText}`,
                  }],
                  details: { organizational_units: ous },
                };
              }

              case "get_organizational_unit": {
                const ouId = params.ou_id as string;
                if (!ouId) {
                  return {
                    content: [{ type: "text", text: "Error: ou_id is required" }],
                    details: { error: "missing_ou_id" },
                  };
                }

                const result = await organizationManager.getOrganizationalUnit(ouId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get OU: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const ou = result.data!;
                const accountsText = ou.accounts && ou.accounts.length > 0
                  ? ou.accounts.map(a => `  • ${a.name} (${a.id})`).join("\n")
                  : "  (none)";
                const childOUsText = ou.childOUs && ou.childOUs.length > 0
                  ? ou.childOUs.map(c => `  • ${c.name} (${c.id})`).join("\n")
                  : "  (none)";
                const policiesText = ou.attachedPolicies && ou.attachedPolicies.length > 0
                  ? ou.attachedPolicies.map(p => `  • ${p.policyName} (${p.policyType})`).join("\n")
                  : "  (none)";

                return {
                  content: [{
                    type: "text",
                    text: `📁 **Organizational Unit: ${ou.name}**\n\n` +
                      `**ID:** ${ou.id}\n` +
                      `**ARN:** ${ou.arn}\n` +
                      `**Parent:** ${ou.parentId}\n\n` +
                      `**Accounts:**\n${accountsText}\n\n` +
                      `**Child OUs:**\n${childOUsText}\n\n` +
                      `**Attached Policies:**\n${policiesText}`,
                  }],
                  details: { organizational_unit: ou },
                };
              }

              case "create_organizational_unit": {
                const parentId = params.parent_id as string;
                const name = params.ou_name as string;

                if (!parentId || !name) {
                  return {
                    content: [{ type: "text", text: "Error: parent_id and ou_name are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.createOrganizationalUnit({
                  parentId,
                  name,
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create OU: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Organizational Unit **${name}** created\n\n` +
                      `**ID:** ${result.data!.id}\n` +
                      `**Parent:** ${parentId}`,
                  }],
                  details: { organizational_unit: result.data },
                };
              }

              case "update_organizational_unit": {
                const ouId = params.ou_id as string;
                const name = params.ou_name as string;

                if (!ouId || !name) {
                  return {
                    content: [{ type: "text", text: "Error: ou_id and ou_name are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.updateOrganizationalUnit(ouId, name);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to update OU: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Organizational Unit updated to **${name}**`,
                  }],
                  details: { organizational_unit: result.data },
                };
              }

              case "delete_organizational_unit": {
                const ouId = params.ou_id as string;
                if (!ouId) {
                  return {
                    content: [{ type: "text", text: "Error: ou_id is required" }],
                    details: { error: "missing_ou_id" },
                  };
                }

                const result = await organizationManager.deleteOrganizationalUnit(ouId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete OU: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Organizational Unit **${ouId}** deleted`,
                  }],
                  details: { deleted: true, ou_id: ouId },
                };
              }

              // ==================
              // SCP Operations
              // ==================
              case "list_policies": {
                const result = await organizationManager.listPolicies({
                  type: params.policy_type as PolicyType,
                  includeContent: params.include_content as boolean,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list policies: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const policies = result.data!;
                if (policies.length === 0) {
                  return {
                    content: [{ type: "text", text: "No policies found." }],
                    details: { policies: [] },
                  };
                }

                const policiesText = policies.map(p =>
                  `• **${p.name}** (${p.id})\n` +
                  `  Type: ${p.type} | AWS Managed: ${p.awsManaged ? "Yes" : "No"}\n` +
                  `  ${p.description || ""}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `📜 **Policies** (${policies.length})\n\n${policiesText}`,
                  }],
                  details: { policies },
                };
              }

              case "get_policy": {
                const policyId = params.policy_id as string;
                if (!policyId) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id is required" }],
                    details: { error: "missing_policy_id" },
                  };
                }

                const result = await organizationManager.getPolicy(policyId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const policy = result.data!;
                const targetsText = policy.targets && policy.targets.length > 0
                  ? policy.targets.map(t => `  • ${t.name} (${t.type}: ${t.targetId})`).join("\n")
                  : "  (none attached)";

                return {
                  content: [{
                    type: "text",
                    text: `📜 **Policy: ${policy.name}**\n\n` +
                      `**ID:** ${policy.id}\n` +
                      `**ARN:** ${policy.arn}\n` +
                      `**Type:** ${policy.type}\n` +
                      `**AWS Managed:** ${policy.awsManaged ? "Yes" : "No"}\n` +
                      `**Description:** ${policy.description || "N/A"}\n\n` +
                      `**Targets:**\n${targetsText}\n\n` +
                      `**Content:**\n\`\`\`json\n${policy.content}\n\`\`\``,
                  }],
                  details: { policy },
                };
              }

              case "create_policy": {
                const policyName = params.policy_name as string;
                const content = params.policy_content as object;

                if (!policyName || !content) {
                  return {
                    content: [{ type: "text", text: "Error: policy_name and policy_content are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.createPolicy({
                  name: policyName,
                  description: params.policy_description as string,
                  content: JSON.stringify(content),
                  type: params.policy_type as PolicyType,
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policyName}** created\n\n` +
                      `**ID:** ${result.data!.id}\n` +
                      `**Type:** ${result.data!.type}`,
                  }],
                  details: { policy: result.data },
                };
              }

              case "update_policy": {
                const policyId = params.policy_id as string;
                if (!policyId) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id is required" }],
                    details: { error: "missing_policy_id" },
                  };
                }

                const result = await organizationManager.updatePolicy({
                  policyId,
                  name: params.policy_name as string,
                  description: params.policy_description as string,
                  content: params.policy_content ? JSON.stringify(params.policy_content) : undefined,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to update policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policyId}** updated`,
                  }],
                  details: { policy: result.data },
                };
              }

              case "delete_policy": {
                const policyId = params.policy_id as string;
                if (!policyId) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id is required" }],
                    details: { error: "missing_policy_id" },
                  };
                }

                const result = await organizationManager.deletePolicy(policyId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policyId}** deleted`,
                  }],
                  details: { deleted: true, policy_id: policyId },
                };
              }

              case "attach_policy": {
                const policyId = params.policy_id as string;
                const targetId = params.target_id as string;

                if (!policyId || !targetId) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id and target_id are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.attachPolicy(policyId, targetId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to attach policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policyId}** attached to **${targetId}**`,
                  }],
                  details: { attached: true, policy_id: policyId, target_id: targetId },
                };
              }

              case "detach_policy": {
                const policyId = params.policy_id as string;
                const targetId = params.target_id as string;

                if (!policyId || !targetId) {
                  return {
                    content: [{ type: "text", text: "Error: policy_id and target_id are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.detachPolicy(policyId, targetId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to detach policy: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy **${policyId}** detached from **${targetId}**`,
                  }],
                  details: { detached: true, policy_id: policyId, target_id: targetId },
                };
              }

              case "get_scp_templates": {
                const category = params.template_category as SCPCategory | undefined;
                const templates = organizationManager.getSCPTemplates(category);

                const templatesText = templates.map(t =>
                  `• **${t.name}** (\`${t.id}\`)\n` +
                  `  Category: ${t.category} | Risk: ${t.riskLevel}\n` +
                  `  ${t.description}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `📋 **SCP Templates** (${templates.length})${category ? ` - Category: ${category}` : ""}\n\n${templatesText}`,
                  }],
                  details: { templates },
                };
              }

              case "get_scp_template": {
                const templateId = params.template_id as string;
                if (!templateId) {
                  return {
                    content: [{ type: "text", text: "Error: template_id is required" }],
                    details: { error: "missing_template_id" },
                  };
                }

                const template = organizationManager.getSCPTemplate(templateId);
                if (!template) {
                  return {
                    content: [{ type: "text", text: `Template not found: ${templateId}` }],
                    details: { error: "template_not_found" },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `📋 **SCP Template: ${template.name}**\n\n` +
                      `**ID:** ${template.id}\n` +
                      `**Category:** ${template.category}\n` +
                      `**Risk Level:** ${template.riskLevel}\n` +
                      `**Best Practice:** ${template.bestPractice ? "Yes" : "No"}\n` +
                      `${template.cisBenchmark ? `**CIS Benchmark:** ${template.cisBenchmark}\n` : ""}` +
                      `**Description:** ${template.description}\n\n` +
                      `**Policy Document:**\n\`\`\`json\n${JSON.stringify(template.document, null, 2)}\n\`\`\``,
                  }],
                  details: { template },
                };
              }

              case "enable_policy_type": {
                const rootId = params.root_id as string;
                const policyType = params.policy_type as PolicyType;

                if (!rootId || !policyType) {
                  return {
                    content: [{ type: "text", text: "Error: root_id and policy_type are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.enablePolicyType(rootId, policyType);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to enable policy type: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy type **${policyType}** enabled for root **${rootId}**`,
                  }],
                  details: { enabled: true, root_id: rootId, policy_type: policyType },
                };
              }

              case "disable_policy_type": {
                const rootId = params.root_id as string;
                const policyType = params.policy_type as PolicyType;

                if (!rootId || !policyType) {
                  return {
                    content: [{ type: "text", text: "Error: root_id and policy_type are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.disablePolicyType(rootId, policyType);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to disable policy type: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Policy type **${policyType}** disabled for root **${rootId}**`,
                  }],
                  details: { disabled: true, root_id: rootId, policy_type: policyType },
                };
              }

              // ==================
              // Cross-Account Operations
              // ==================
              case "assume_role": {
                const accountId = params.account_id as string;
                if (!accountId && !params.role_arn) {
                  return {
                    content: [{ type: "text", text: "Error: account_id or role_arn is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.assumeRole({
                  accountId: accountId || "",
                  roleName: params.role_name as string,
                  roleArn: params.role_arn as string,
                  sessionName: params.session_name as string,
                  durationSeconds: params.duration_seconds as number,
                  externalId: params.external_id as string,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to assume role: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const creds = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `✅ Role assumed successfully\n\n` +
                      `**Account:** ${creds.accountId}\n` +
                      `**Role ARN:** ${creds.assumedRoleArn}\n` +
                      `**Session:** ${creds.sessionName}\n` +
                      `**Expires:** ${creds.expiration.toISOString()}`,
                  }],
                  details: { credentials: { ...creds, secretAccessKey: "[REDACTED]", sessionToken: "[REDACTED]" } },
                };
              }

              case "switch_account": {
                const accountId = params.account_id as string;
                if (!accountId) {
                  return {
                    content: [{ type: "text", text: "Error: account_id is required" }],
                    details: { error: "missing_account_id" },
                  };
                }

                const result = await organizationManager.switchAccount(accountId, params.role_name as string);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to switch account: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const session = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `✅ Switched to account **${session.accountName || session.accountId}**\n\n` +
                      `**Session ID:** ${session.sessionId}\n` +
                      `**Role:** ${session.roleArn}\n` +
                      `**Expires:** ${session.expirationTime.toISOString()}`,
                  }],
                  details: { session: { ...session, credentials: undefined } },
                };
              }

              case "get_current_context": {
                const context = organizationManager.getCurrentContext();
                return {
                  content: [{
                    type: "text",
                    text: `📍 **Current Context**\n\n` +
                      `**Account:** ${context.accountName || context.accountId || "Not set"}\n` +
                      `**Region:** ${context.currentRegion}\n` +
                      `**Management Account:** ${context.isManagementAccount ? "Yes" : "No"}`,
                  }],
                  details: { context },
                };
              }

              case "get_active_sessions": {
                const sessions = organizationManager.getActiveSessions();
                if (sessions.length === 0) {
                  return {
                    content: [{ type: "text", text: "No active sessions." }],
                    details: { sessions: [] },
                  };
                }

                const sessionsText = sessions.map(s =>
                  `• **${s.accountName || s.accountId}**\n` +
                  `  Session: ${s.sessionId}\n` +
                  `  Active: ${s.isActive ? "Yes" : "No (expired)"}\n` +
                  `  Expires: ${s.expirationTime.toISOString()}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `🔗 **Active Sessions** (${sessions.length})\n\n${sessionsText}`,
                  }],
                  details: { sessions: sessions.map(s => ({ ...s, credentials: undefined })) },
                };
              }

              case "reset_context": {
                organizationManager.resetContext();
                return {
                  content: [{
                    type: "text",
                    text: `✅ Context reset. All sessions cleared.`,
                  }],
                  details: { reset: true },
                };
              }

              // ==================
              // Resource Sharing (RAM) Operations
              // ==================
              case "create_resource_share": {
                const name = params.resource_share_name as string;
                if (!name) {
                  return {
                    content: [{ type: "text", text: "Error: resource_share_name is required" }],
                    details: { error: "missing_resource_share_name" },
                  };
                }

                const result = await organizationManager.createResourceShare({
                  name,
                  resourceArns: params.resource_arns as string[],
                  principals: params.principals as string[],
                  allowExternalPrincipals: params.allow_external_principals as boolean,
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create resource share: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Resource share **${name}** created\n\n` +
                      `**ARN:** ${result.data!.resourceShareArn}\n` +
                      `**Status:** ${result.data!.status}`,
                  }],
                  details: { resource_share: result.data },
                };
              }

              case "delete_resource_share": {
                const arn = params.resource_share_arn as string;
                if (!arn) {
                  return {
                    content: [{ type: "text", text: "Error: resource_share_arn is required" }],
                    details: { error: "missing_resource_share_arn" },
                  };
                }

                const result = await organizationManager.deleteResourceShare(arn);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete resource share: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Resource share deleted`,
                  }],
                  details: { deleted: true, resource_share_arn: arn },
                };
              }

              case "list_resource_shares": {
                const resourceOwner = params.resource_owner as "SELF" | "OTHER-ACCOUNTS";
                if (!resourceOwner) {
                  return {
                    content: [{ type: "text", text: "Error: resource_owner is required (SELF or OTHER-ACCOUNTS)" }],
                    details: { error: "missing_resource_owner" },
                  };
                }

                const result = await organizationManager.listResourceShares({
                  resourceOwner,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list resource shares: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const shares = result.data!;
                if (shares.length === 0) {
                  return {
                    content: [{ type: "text", text: "No resource shares found." }],
                    details: { resource_shares: [] },
                  };
                }

                const sharesText = shares.map(s =>
                  `• **${s.name}**\n` +
                  `  ARN: ${s.resourceShareArn}\n` +
                  `  Status: ${s.status} | External: ${s.allowExternalPrincipals ? "Yes" : "No"}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `🔗 **Resource Shares** (${shares.length})\n\n${sharesText}`,
                  }],
                  details: { resource_shares: shares },
                };
              }

              case "list_shareable_resource_types": {
                const result = await organizationManager.listShareableResourceTypes();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list resource types: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const types = result.data!;
                const typesText = types.map(t => `• ${t}`).join("\n");

                return {
                  content: [{
                    type: "text",
                    text: `📦 **Shareable Resource Types** (${types.length})\n\n${typesText}`,
                  }],
                  details: { resource_types: types },
                };
              }

              // ==================
              // Consolidated Billing
              // ==================
              case "get_consolidated_billing": {
                const startDateStr = params.start_date as string;
                const endDateStr = params.end_date as string;

                if (!startDateStr || !endDateStr) {
                  return {
                    content: [{ type: "text", text: "Error: start_date and end_date are required (YYYY-MM-DD)" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.getConsolidatedBilling({
                  startDate: new Date(startDateStr),
                  endDate: new Date(endDateStr),
                  granularity: params.granularity as "DAILY" | "MONTHLY",
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get billing data: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const billing = result.data!;
                const accountsText = billing.accountBreakdown.slice(0, 10).map(a =>
                  `• **${a.accountName}** (${a.accountId}): $${a.cost.toFixed(2)} (${a.percentage.toFixed(1)}%)`
                ).join("\n");

                const servicesText = billing.serviceBreakdown.slice(0, 10).map(s =>
                  `• **${s.service}**: $${s.totalCost.toFixed(2)}`
                ).join("\n");

                return {
                  content: [{
                    type: "text",
                    text: `💰 **Consolidated Billing**\n\n` +
                      `**Period:** ${billing.periodStart.toISOString().split("T")[0]} to ${billing.periodEnd.toISOString().split("T")[0]}\n` +
                      `**Total Cost:** $${billing.totalCost.toFixed(2)} ${billing.currency}\n` +
                      `**Linked Accounts:** ${billing.linkedAccountCount}\n\n` +
                      `**Top Accounts:**\n${accountsText}\n\n` +
                      `**Top Services:**\n${servicesText}`,
                  }],
                  details: { billing },
                };
              }

              // ==================
              // Delegated Administrator
              // ==================
              case "list_delegated_administrators": {
                const result = await organizationManager.listDelegatedAdministrators(
                  params.service_principal as string
                );

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list delegated admins: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const admins = result.data!;
                if (admins.length === 0) {
                  return {
                    content: [{ type: "text", text: "No delegated administrators found." }],
                    details: { delegated_administrators: [] },
                  };
                }

                const adminsText = admins.map(a =>
                  `• **${a.name}** (${a.accountId})\n` +
                  `  Service: ${a.servicePrincipal}\n` +
                  `  Enabled: ${a.delegationEnabledDate.toISOString()}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `👑 **Delegated Administrators** (${admins.length})\n\n${adminsText}`,
                  }],
                  details: { delegated_administrators: admins },
                };
              }

              case "register_delegated_administrator": {
                const accountId = params.account_id as string;
                const servicePrincipal = params.service_principal as string;

                if (!accountId || !servicePrincipal) {
                  return {
                    content: [{ type: "text", text: "Error: account_id and service_principal are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.registerDelegatedAdministrator(accountId, servicePrincipal);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to register delegated admin: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Account **${accountId}** registered as delegated administrator for **${servicePrincipal}**`,
                  }],
                  details: { registered: true, account_id: accountId, service_principal: servicePrincipal },
                };
              }

              // ==================
              // Handshakes
              // ==================
              case "list_handshakes": {
                const result = await organizationManager.listHandshakes();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list handshakes: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const handshakes = result.data!;
                if (handshakes.length === 0) {
                  return {
                    content: [{ type: "text", text: "No handshakes found." }],
                    details: { handshakes: [] },
                  };
                }

                const handshakesText = handshakes.map(h =>
                  `• **${h.id}**\n` +
                  `  Action: ${h.action} | State: ${h.state}\n` +
                  `  Expires: ${h.expirationTimestamp.toISOString()}`
                ).join("\n\n");

                return {
                  content: [{
                    type: "text",
                    text: `🤝 **Handshakes** (${handshakes.length})\n\n${handshakesText}`,
                  }],
                  details: { handshakes },
                };
              }

              case "invite_account": {
                const target = params.invite_target as string;
                const targetType = params.invite_target_type as "ACCOUNT" | "EMAIL";

                if (!target || !targetType) {
                  return {
                    content: [{ type: "text", text: "Error: invite_target and invite_target_type are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.inviteAccount({
                  target,
                  targetType,
                  notes: params.invite_notes as string,
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to invite account: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Invitation sent to **${target}**\n\n` +
                      `**Handshake ID:** ${result.data!.id}\n` +
                      `**State:** ${result.data!.state}\n` +
                      `**Expires:** ${result.data!.expirationTimestamp.toISOString()}`,
                  }],
                  details: { handshake: result.data },
                };
              }

              // ==================
              // Tags
              // ==================
              case "get_resource_tags": {
                const resourceId = params.resource_id as string;
                if (!resourceId) {
                  return {
                    content: [{ type: "text", text: "Error: resource_id is required" }],
                    details: { error: "missing_resource_id" },
                  };
                }

                const result = await organizationManager.getResourceTags(resourceId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get tags: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const tags = result.data!;
                const tagsText = Object.entries(tags).length > 0
                  ? Object.entries(tags).map(([k, v]) => `• ${k}: ${v}`).join("\n")
                  : "(no tags)";

                return {
                  content: [{
                    type: "text",
                    text: `🏷️ **Tags for ${resourceId}**\n\n${tagsText}`,
                  }],
                  details: { tags },
                };
              }

              case "tag_resource": {
                const resourceId = params.resource_id as string;
                const tags = params.tags as Record<string, string>;

                if (!resourceId || !tags) {
                  return {
                    content: [{ type: "text", text: "Error: resource_id and tags are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.tagResource(resourceId, tags);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to tag resource: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Tags applied to **${resourceId}**`,
                  }],
                  details: { tagged: true, resource_id: resourceId, tags },
                };
              }

              case "untag_resource": {
                const resourceId = params.resource_id as string;
                const tagKeys = params.tag_keys as string[];

                if (!resourceId || !tagKeys) {
                  return {
                    content: [{ type: "text", text: "Error: resource_id and tag_keys are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await organizationManager.untagResource(resourceId, tagKeys);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to untag resource: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Tags removed from **${resourceId}**`,
                  }],
                  details: { untagged: true, resource_id: resourceId, tag_keys: tagKeys },
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
              content: [{ type: "text", text: `Organization error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_organization" },
    );

    // =========================================================================
    // AWS BACKUP & DISASTER RECOVERY AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        name: "aws_backup",
        label: "AWS Backup & Disaster Recovery",
        description: `Manage AWS Backup plans, recovery points, cross-region replication, disaster recovery runbooks, and compliance reporting.

CAPABILITIES:
- Backup plan management with predefined templates (daily, weekly, monthly, compliance)
- Backup vault creation and locking for data protection
- Recovery point listing and restoration
- On-demand backup job creation
- Cross-region replication configuration
- Disaster recovery runbook generation
- Failover orchestration (with dry-run support)
- Backup compliance status and reporting
- Recovery testing and validation
- Report plan management

PREDEFINED BACKUP TEMPLATES:
- daily-35day-retention: Daily backups with 35-day retention
- weekly-90day-retention: Weekly backups with 90-day retention
- monthly-1year-retention: Monthly backups with cold storage after 90 days
- production-standard: Daily + Weekly + Monthly with enterprise retention
- compliance-hipaa: HIPAA-compliant with 7-year retention
- compliance-gdpr: GDPR-compliant with retention limits
- continuous-pit: Continuous point-in-time recovery (5 min RPO)

Use this tool to:
- Create backup plans with schedules and retention policies
- List and restore from recovery points
- Set up cross-region disaster recovery
- Generate DR runbooks with step-by-step procedures
- Execute failovers to DR region
- Check backup compliance status
- Test recovery procedures`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                // Backup Plans
                "list_backup_plans",
                "get_backup_plan",
                "create_backup_plan",
                "update_backup_plan",
                "delete_backup_plan",
                "get_backup_plan_templates",
                "get_backup_plan_template",
                "create_backup_plan_from_template",
                // Backup Selections
                "list_backup_selections",
                "create_backup_selection",
                "delete_backup_selection",
                // Backup Vaults
                "list_backup_vaults",
                "get_backup_vault",
                "create_backup_vault",
                "delete_backup_vault",
                "lock_backup_vault",
                // Recovery Points
                "list_recovery_points",
                "get_recovery_point",
                "delete_recovery_point",
                // Backup Jobs
                "list_backup_jobs",
                "get_backup_job",
                "start_backup_job",
                "stop_backup_job",
                // Restore Jobs
                "list_restore_jobs",
                "get_restore_job",
                "start_restore_job",
                // Copy Jobs (Cross-Region)
                "list_copy_jobs",
                "start_copy_job",
                // Cross-Region Replication
                "configure_replication",
                "get_replication_configuration",
                // Protected Resources
                "list_protected_resources",
                // DR Runbook
                "generate_dr_runbook",
                // Failover
                "execute_failover",
                // Compliance
                "get_backup_compliance",
                "list_frameworks",
                "create_framework",
                "delete_framework",
                // Recovery Testing
                "test_recovery",
                // Report Plans
                "list_report_plans",
                "create_report_plan",
                "delete_report_plan",
              ],
              description: "The backup operation to perform",
            },
            // Common options
            region: {
              type: "string",
              description: "AWS region (defaults to configured region)",
            },
            // Backup plan options
            backup_plan_id: {
              type: "string",
              description: "ID of the backup plan",
            },
            backup_plan_name: {
              type: "string",
              description: "Name for the backup plan",
            },
            template_id: {
              type: "string",
              description: "ID of the backup plan template to use",
            },
            rules: {
              type: "array",
              description: "Array of backup rules with schedule and lifecycle",
              items: {
                type: "object",
                properties: {
                  rule_name: { type: "string" },
                  target_vault_name: { type: "string" },
                  schedule_expression: { type: "string" },
                  start_window_minutes: { type: "number" },
                  completion_window_minutes: { type: "number" },
                  delete_after_days: { type: "number" },
                  move_to_cold_storage_after_days: { type: "number" },
                },
              },
            },
            // Backup vault options
            backup_vault_name: {
              type: "string",
              description: "Name of the backup vault",
            },
            encryption_key_arn: {
              type: "string",
              description: "KMS key ARN for vault encryption",
            },
            min_retention_days: {
              type: "number",
              description: "Minimum retention days for vault lock",
            },
            max_retention_days: {
              type: "number",
              description: "Maximum retention days for vault lock",
            },
            // Recovery point options
            recovery_point_arn: {
              type: "string",
              description: "ARN of the recovery point",
            },
            resource_arn: {
              type: "string",
              description: "ARN of the resource to backup/restore",
            },
            resource_type: {
              type: "string",
              description: "Type of resource (EC2, RDS, DynamoDB, EFS, S3)",
            },
            // Backup selection options
            selection_id: {
              type: "string",
              description: "ID of the backup selection",
            },
            selection_name: {
              type: "string",
              description: "Name for the backup selection",
            },
            iam_role_arn: {
              type: "string",
              description: "IAM role ARN for backup operations",
            },
            resources: {
              type: "array",
              items: { type: "string" },
              description: "List of resource ARNs to include",
            },
            // Backup/Restore job options
            backup_job_id: {
              type: "string",
              description: "ID of the backup job",
            },
            restore_job_id: {
              type: "string",
              description: "ID of the restore job",
            },
            restore_metadata: {
              type: "object",
              description: "Metadata for the restore operation",
            },
            // Cross-region options
            destination_region: {
              type: "string",
              description: "Destination region for cross-region copy",
            },
            destination_vault_arn: {
              type: "string",
              description: "Destination vault ARN for copy job",
            },
            create_destination_vault: {
              type: "boolean",
              description: "Whether to create the destination vault if it doesn't exist",
            },
            // DR Runbook options
            runbook_name: {
              type: "string",
              description: "Name for the DR runbook",
            },
            source_region: {
              type: "string",
              description: "Source region for DR",
            },
            dr_region: {
              type: "string",
              description: "DR region for failover",
            },
            target_rpo: {
              type: "string",
              description: "Target Recovery Point Objective (e.g., '24 hours')",
            },
            target_rto: {
              type: "string",
              description: "Target Recovery Time Objective (e.g., '4 hours')",
            },
            resource_arns: {
              type: "array",
              items: { type: "string" },
              description: "List of resource ARNs for DR runbook",
            },
            include_rollback: {
              type: "boolean",
              description: "Include rollback steps in DR runbook",
            },
            // Failover options
            dry_run: {
              type: "boolean",
              description: "Perform a dry run without making changes",
            },
            skip_health_checks: {
              type: "boolean",
              description: "Skip pre-failover health checks",
            },
            // Compliance options
            framework_name: {
              type: "string",
              description: "Name of the compliance framework",
            },
            framework_controls: {
              type: "array",
              items: { type: "string" },
              description: "Controls for the compliance framework",
            },
            // Report plan options
            report_plan_name: {
              type: "string",
              description: "Name for the report plan",
            },
            report_template: {
              type: "string",
              enum: [
                "RESOURCE_COMPLIANCE_REPORT",
                "CONTROL_COMPLIANCE_REPORT",
                "BACKUP_JOB_REPORT",
                "COPY_JOB_REPORT",
                "RESTORE_JOB_REPORT",
              ],
              description: "Type of report to generate",
            },
            s3_bucket_name: {
              type: "string",
              description: "S3 bucket for report delivery",
            },
            // Recovery test options
            test_name: {
              type: "string",
              description: "Name for the recovery test",
            },
            cleanup_after_test: {
              type: "boolean",
              description: "Clean up restored resources after test",
            },
            timeout_minutes: {
              type: "number",
              description: "Timeout for the recovery test",
            },
            // Common
            tags: {
              type: "object",
              description: "Tags to apply to resources",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const action = params.action as string;
          const region = (params.region as string) || config.defaultRegion || "us-east-1";

          // Initialize backup manager if needed
          if (!backupManager) {
            backupManager = createBackupManager({
              defaultRegion: region,
              drRegion: (params.dr_region as string) || "us-west-2",
            });
          }

          try {
            switch (action) {
              // ==================
              // Backup Plans
              // ==================
              case "list_backup_plans": {
                const result = await backupManager.listBackupPlans({
                  maxResults: params.max_results as number,
                  includeDeleted: params.include_deleted as boolean,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list backup plans: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const plans = result.data ?? [];
                if (plans.length === 0) {
                  return {
                    content: [{ type: "text", text: "No backup plans found" }],
                    details: { plans: [] },
                  };
                }

                const planList = plans.map(p => 
                  `• **${p.backupPlanName}** (${p.backupPlanId})\n  Rules: ${p.rules.length}, Created: ${p.creationDate.toISOString().split('T')[0]}`
                ).join('\n');

                return {
                  content: [{ type: "text", text: `📋 **Backup Plans** (${plans.length})\n\n${planList}` }],
                  details: { plans },
                };
              }

              case "get_backup_plan": {
                const backupPlanId = params.backup_plan_id as string;
                if (!backupPlanId) {
                  return {
                    content: [{ type: "text", text: "Error: backup_plan_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.getBackupPlan(backupPlanId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get backup plan: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const plan = result.data!;
                const rulesText = plan.rules.map(r => 
                  `  • **${r.ruleName}**: ${r.scheduleExpression ?? 'On-demand'} → ${r.targetBackupVaultName}`
                ).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `📋 **${plan.backupPlanName}**\n\n**ID:** ${plan.backupPlanId}\n**Created:** ${plan.creationDate.toISOString()}\n**Rules:**\n${rulesText}`,
                  }],
                  details: { plan },
                };
              }

              case "create_backup_plan": {
                const backupPlanName = params.backup_plan_name as string;
                const rules = params.rules as Array<{
                  rule_name: string;
                  target_vault_name: string;
                  schedule_expression?: string;
                  start_window_minutes?: number;
                  completion_window_minutes?: number;
                  delete_after_days?: number;
                  move_to_cold_storage_after_days?: number;
                }>;

                if (!backupPlanName || !rules || rules.length === 0) {
                  return {
                    content: [{ type: "text", text: "Error: backup_plan_name and at least one rule are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.createBackupPlan({
                  backupPlanName,
                  rules: rules.map(r => ({
                    ruleName: r.rule_name,
                    targetBackupVaultName: r.target_vault_name || 'Default',
                    scheduleExpression: r.schedule_expression,
                    startWindowMinutes: r.start_window_minutes,
                    completionWindowMinutes: r.completion_window_minutes,
                    lifecycle: (r.delete_after_days || r.move_to_cold_storage_after_days) ? {
                      deleteAfterDays: r.delete_after_days,
                      moveToColdStorageAfterDays: r.move_to_cold_storage_after_days,
                    } : undefined,
                  })),
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create backup plan: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Backup plan **${backupPlanName}** created\n\n**ID:** ${result.data!.backupPlanId}\n**ARN:** ${result.data!.backupPlanArn}`,
                  }],
                  details: result.data,
                };
              }

              case "delete_backup_plan": {
                const backupPlanId = params.backup_plan_id as string;
                if (!backupPlanId) {
                  return {
                    content: [{ type: "text", text: "Error: backup_plan_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.deleteBackupPlan(backupPlanId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete backup plan: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{ type: "text", text: `✅ Backup plan ${backupPlanId} deleted` }],
                  details: { deleted: true },
                };
              }

              case "get_backup_plan_templates": {
                const templates = backupManager.getBackupPlanTemplates();
                const templateList = templates.map(t => 
                  `• **${t.name}** (\`${t.id}\`)\n  ${t.description}\n  Category: ${t.category}, RPO: ${t.targetRPO}`
                ).join('\n\n');

                return {
                  content: [{
                    type: "text",
                    text: `📋 **Backup Plan Templates** (${templates.length})\n\n${templateList}`,
                  }],
                  details: { templates },
                };
              }

              case "get_backup_plan_template": {
                const templateId = params.template_id as string;
                if (!templateId) {
                  return {
                    content: [{ type: "text", text: "Error: template_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const template = backupManager.getBackupPlanTemplate(templateId);
                if (!template) {
                  return {
                    content: [{ type: "text", text: `Template "${templateId}" not found` }],
                    details: { error: "template_not_found" },
                  };
                }

                const rulesText = template.rules.map(r => 
                  `  • **${r.ruleName}**: ${r.scheduleExpression ?? 'Continuous'}\n    Retention: ${r.lifecycle?.deleteAfterDays ?? 'N/A'} days`
                ).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `📋 **${template.name}**\n\n${template.description}\n\n**Category:** ${template.category}\n**Target RPO:** ${template.targetRPO}\n\n**Rules:**\n${rulesText}`,
                  }],
                  details: { template },
                };
              }

              case "create_backup_plan_from_template": {
                const templateId = params.template_id as string;
                const backupPlanName = params.backup_plan_name as string;

                if (!templateId) {
                  return {
                    content: [{ type: "text", text: "Error: template_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.createBackupPlanFromTemplate(templateId, {
                  backupPlanName,
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create backup plan from template: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Backup plan created from template **${templateId}**\n\n**ID:** ${result.data!.backupPlanId}\n**ARN:** ${result.data!.backupPlanArn}`,
                  }],
                  details: result.data,
                };
              }

              // ==================
              // Backup Vaults
              // ==================
              case "list_backup_vaults": {
                const result = await backupManager.listBackupVaults({
                  maxResults: params.max_results as number,
                });
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list backup vaults: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const vaults = result.data ?? [];
                if (vaults.length === 0) {
                  return {
                    content: [{ type: "text", text: "No backup vaults found" }],
                    details: { vaults: [] },
                  };
                }

                const vaultList = vaults.map(v => 
                  `• **${v.backupVaultName}** ${v.locked ? '🔒' : ''}\n  Recovery Points: ${v.numberOfRecoveryPoints}`
                ).join('\n');

                return {
                  content: [{ type: "text", text: `🗄️ **Backup Vaults** (${vaults.length})\n\n${vaultList}` }],
                  details: { vaults },
                };
              }

              case "create_backup_vault": {
                const backupVaultName = params.backup_vault_name as string;
                if (!backupVaultName) {
                  return {
                    content: [{ type: "text", text: "Error: backup_vault_name is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.createBackupVault({
                  backupVaultName,
                  encryptionKeyArn: params.encryption_key_arn as string,
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create backup vault: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Backup vault **${backupVaultName}** created\n\n**ARN:** ${result.data!.backupVaultArn}`,
                  }],
                  details: result.data,
                };
              }

              case "lock_backup_vault": {
                const backupVaultName = params.backup_vault_name as string;
                const minRetentionDays = params.min_retention_days as number;

                if (!backupVaultName || !minRetentionDays) {
                  return {
                    content: [{ type: "text", text: "Error: backup_vault_name and min_retention_days are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.lockBackupVault({
                  backupVaultName,
                  minRetentionDays,
                  maxRetentionDays: params.max_retention_days as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to lock backup vault: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `🔒 Backup vault **${backupVaultName}** locked\n\nMin retention: ${minRetentionDays} days`,
                  }],
                  details: { locked: true },
                };
              }

              // ==================
              // Recovery Points
              // ==================
              case "list_recovery_points": {
                const result = await backupManager.listRecoveryPoints({
                  backupVaultName: params.backup_vault_name as string,
                  resourceArn: params.resource_arn as string,
                  resourceType: params.resource_type as string,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list recovery points: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const rps = result.data ?? [];
                if (rps.length === 0) {
                  return {
                    content: [{ type: "text", text: "No recovery points found" }],
                    details: { recovery_points: [] },
                  };
                }

                const rpList = rps.slice(0, 20).map(rp => {
                  const size = rp.backupSizeInBytes 
                    ? `${(rp.backupSizeInBytes / 1024 / 1024 / 1024).toFixed(2)} GB` 
                    : 'N/A';
                  return `• **${rp.resourceType}** - ${rp.creationDate.toISOString().split('T')[0]}\n  Status: ${rp.status}, Size: ${size}`;
                }).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `📦 **Recovery Points** (${rps.length})\n\n${rpList}${rps.length > 20 ? `\n\n... and ${rps.length - 20} more` : ''}`,
                  }],
                  details: { recovery_points: rps },
                };
              }

              // ==================
              // Backup Jobs
              // ==================
              case "start_backup_job": {
                const resourceArn = params.resource_arn as string;
                const backupVaultName = params.backup_vault_name as string;
                const iamRoleArn = params.iam_role_arn as string;

                if (!resourceArn || !backupVaultName || !iamRoleArn) {
                  return {
                    content: [{ type: "text", text: "Error: resource_arn, backup_vault_name, and iam_role_arn are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.startBackupJob({
                  resourceArn,
                  backupVaultName,
                  iamRoleArn,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to start backup job: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Backup job started\n\n**Job ID:** ${result.data!.backupJobId}\n**Recovery Point:** ${result.data!.recoveryPointArn}`,
                  }],
                  details: result.data,
                };
              }

              case "list_backup_jobs": {
                const result = await backupManager.listBackupJobs({
                  resourceArn: params.resource_arn as string,
                  backupVaultName: params.backup_vault_name as string,
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list backup jobs: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const jobs = result.data ?? [];
                if (jobs.length === 0) {
                  return {
                    content: [{ type: "text", text: "No backup jobs found" }],
                    details: { jobs: [] },
                  };
                }

                const jobList = jobs.slice(0, 15).map(j => {
                  const status = j.state === 'COMPLETED' ? '✅' : j.state === 'FAILED' ? '❌' : '⏳';
                  return `${status} **${j.resourceType}** - ${j.state}\n   ${j.creationDate.toISOString().split('T')[0]}`;
                }).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `📋 **Backup Jobs** (${jobs.length})\n\n${jobList}`,
                  }],
                  details: { jobs },
                };
              }

              // ==================
              // Restore Jobs
              // ==================
              case "start_restore_job": {
                const recoveryPointArn = params.recovery_point_arn as string;
                const resourceType = params.resource_type as string;
                const iamRoleArn = params.iam_role_arn as string;
                const metadata = params.restore_metadata as Record<string, string>;

                if (!recoveryPointArn || !resourceType || !iamRoleArn) {
                  return {
                    content: [{ type: "text", text: "Error: recovery_point_arn, resource_type, and iam_role_arn are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.startRestoreJob({
                  recoveryPointArn,
                  resourceType,
                  iamRoleArn,
                  metadata: metadata ?? {},
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to start restore job: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Restore job started\n\n**Job ID:** ${result.data!.restoreJobId}\n\nUse \`get_restore_job\` to check status.`,
                  }],
                  details: result.data,
                };
              }

              case "list_restore_jobs": {
                const result = await backupManager.listRestoreJobs({
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list restore jobs: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const jobs = result.data ?? [];
                if (jobs.length === 0) {
                  return {
                    content: [{ type: "text", text: "No restore jobs found" }],
                    details: { jobs: [] },
                  };
                }

                const jobList = jobs.slice(0, 15).map(j => {
                  const status = j.status === 'COMPLETED' ? '✅' : j.status === 'FAILED' ? '❌' : '⏳';
                  return `${status} **${j.resourceType ?? 'Unknown'}** - ${j.status}\n   ${j.creationDate.toISOString().split('T')[0]}`;
                }).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `📋 **Restore Jobs** (${jobs.length})\n\n${jobList}`,
                  }],
                  details: { jobs },
                };
              }

              // ==================
              // Cross-Region Replication
              // ==================
              case "configure_replication": {
                const sourceVaultName = params.backup_vault_name as string;
                const destinationRegion = params.destination_region as string;

                if (!sourceVaultName || !destinationRegion) {
                  return {
                    content: [{ type: "text", text: "Error: backup_vault_name and destination_region are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.configureReplication({
                  sourceVaultName,
                  destinationRegion,
                  destinationVaultName: params.destination_vault_name as string,
                  createDestinationVault: params.create_destination_vault as boolean,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to configure replication: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Cross-region replication configured\n\n**Source:** ${sourceVaultName} (${result.data!.sourceRegion})\n**Destination:** ${result.data!.destinationVaultArn}\n\n${result.message}`,
                  }],
                  details: result.data,
                };
              }

              case "start_copy_job": {
                const sourceVaultName = params.backup_vault_name as string;
                const recoveryPointArn = params.recovery_point_arn as string;
                const destinationVaultArn = params.destination_vault_arn as string;
                const iamRoleArn = params.iam_role_arn as string;

                if (!sourceVaultName || !recoveryPointArn || !destinationVaultArn || !iamRoleArn) {
                  return {
                    content: [{ type: "text", text: "Error: backup_vault_name, recovery_point_arn, destination_vault_arn, and iam_role_arn are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.startCopyJob({
                  sourceBackupVaultName: sourceVaultName,
                  recoveryPointArn,
                  destinationBackupVaultArn: destinationVaultArn,
                  iamRoleArn,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to start copy job: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Copy job started\n\n**Job ID:** ${result.data!.copyJobId}`,
                  }],
                  details: result.data,
                };
              }

              // ==================
              // DR Runbook
              // ==================
              case "generate_dr_runbook": {
                const name = params.runbook_name as string;
                const sourceRegion = params.source_region as string;
                const drRegion = params.dr_region as string;
                const targetRPO = params.target_rpo as string;
                const targetRTO = params.target_rto as string;

                if (!name || !sourceRegion || !drRegion || !targetRPO || !targetRTO) {
                  return {
                    content: [{ type: "text", text: "Error: runbook_name, source_region, dr_region, target_rpo, and target_rto are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.generateDRRunbook({
                  name,
                  sourceRegion,
                  drRegion,
                  targetRPO,
                  targetRTO,
                  resourceArns: params.resource_arns as string[],
                  includeRollback: params.include_rollback as boolean,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to generate DR runbook: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const runbook = result.data!;
                const stepsText = runbook.steps.map(s => 
                  `${s.stepNumber}. **${s.name}** (${s.type})\n   ${s.description}\n   Est: ${s.estimatedDurationMinutes} min, Automated: ${s.automated ? 'Yes' : 'No'}`
                ).join('\n\n');

                return {
                  content: [{
                    type: "text",
                    text: `📋 **DR Runbook: ${runbook.name}**\n\n**Source Region:** ${runbook.sourceRegion}\n**DR Region:** ${runbook.drRegion}\n**Target RPO:** ${runbook.targetRPO}\n**Target RTO:** ${runbook.targetRTO}\n\n## Steps\n\n${stepsText}\n\n## Pre-Conditions\n${runbook.preConditions.map(c => `• ${c.name}`).join('\n')}\n\n## Post-Conditions\n${runbook.postConditions.map(c => `• ${c.name}`).join('\n')}`,
                  }],
                  details: { runbook },
                };
              }

              // ==================
              // Failover
              // ==================
              case "execute_failover": {
                const sourceRegion = params.source_region as string;
                const targetRegion = params.dr_region as string;
                const dryRun = params.dry_run as boolean;

                if (!sourceRegion || !targetRegion) {
                  return {
                    content: [{ type: "text", text: "Error: source_region and dr_region are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.executeFailover({
                  sourceRegion,
                  targetRegion,
                  resourceArns: params.resource_arns as string[],
                  dryRun: dryRun ?? false,
                  skipHealthChecks: params.skip_health_checks as boolean,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to execute failover: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const fo = result.data!;
                const statusIcon = fo.success ? '✅' : '❌';
                const mode = dryRun ? '(DRY RUN)' : '';

                return {
                  content: [{
                    type: "text",
                    text: `${statusIcon} **Failover ${fo.status}** ${mode}\n\n**Plan ID:** ${fo.planId}\n**Duration:** ${fo.durationMinutes} minutes\n**Steps Completed:** ${fo.stepsCompleted}\n**Steps Failed:** ${fo.stepsFailed}\n**Resources:** ${fo.resourcesFailedOver.length}${fo.errors.length > 0 ? `\n\n**Errors:**\n${fo.errors.map(e => `• ${e}`).join('\n')}` : ''}`,
                  }],
                  details: { failover_result: fo },
                };
              }

              // ==================
              // Compliance
              // ==================
              case "get_backup_compliance": {
                const result = await backupManager.getBackupCompliance({
                  resourceTypes: params.resource_types as string[],
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get backup compliance: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const compliance = result.data!;
                const statusIcon = compliance.overallStatus === 'COMPLIANT' ? '✅' : '⚠️';
                const pct = compliance.resourcesEvaluated > 0 
                  ? Math.round((compliance.resourcesCompliant / compliance.resourcesEvaluated) * 100) 
                  : 0;

                const issueList = compliance.issues.slice(0, 10).map(i => 
                  `• **${i.issueType}** (${i.severity}): ${i.description}`
                ).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `${statusIcon} **Backup Compliance: ${compliance.overallStatus}**\n\n**Resources Evaluated:** ${compliance.resourcesEvaluated}\n**Compliant:** ${compliance.resourcesCompliant} (${pct}%)\n**Non-Compliant:** ${compliance.resourcesNonCompliant}\n\n**Issues (${compliance.issues.length}):**\n${issueList || 'None'}`,
                  }],
                  details: { compliance },
                };
              }

              // ==================
              // Protected Resources
              // ==================
              case "list_protected_resources": {
                const result = await backupManager.listProtectedResources({
                  maxResults: params.max_results as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list protected resources: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const resources = result.data ?? [];
                if (resources.length === 0) {
                  return {
                    content: [{ type: "text", text: "No protected resources found" }],
                    details: { resources: [] },
                  };
                }

                const resourceList = resources.slice(0, 20).map(r => {
                  const lastBackup = r.lastBackupTime 
                    ? r.lastBackupTime.toISOString().split('T')[0] 
                    : 'Never';
                  return `• **${r.resourceType}**: ${r.resourceName ?? r.resourceArn.split('/').pop()}\n  Last Backup: ${lastBackup}`;
                }).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `🛡️ **Protected Resources** (${resources.length})\n\n${resourceList}`,
                  }],
                  details: { resources },
                };
              }

              // ==================
              // Recovery Testing
              // ==================
              case "test_recovery": {
                const testName = params.test_name as string;
                const recoveryPointArn = params.recovery_point_arn as string;
                const resourceType = params.resource_type as string;
                const iamRoleArn = params.iam_role_arn as string;

                if (!testName || !recoveryPointArn || !resourceType || !iamRoleArn) {
                  return {
                    content: [{ type: "text", text: "Error: test_name, recovery_point_arn, resource_type, and iam_role_arn are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.testRecovery({
                  testName,
                  recoveryPointArn,
                  resourceType,
                  iamRoleArn,
                  restoreMetadata: params.restore_metadata as Record<string, string> ?? {},
                  cleanupAfterTest: params.cleanup_after_test as boolean,
                  timeoutMinutes: params.timeout_minutes as number,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to run recovery test: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const test = result.data!;
                const statusIcon = test.success ? '✅' : '❌';

                return {
                  content: [{
                    type: "text",
                    text: `${statusIcon} **Recovery Test: ${test.success ? 'PASSED' : 'FAILED'}**\n\n**Test ID:** ${test.testId}\n**Resource Restored:** ${test.resourceRestored ? 'Yes' : 'No'}\n**Restored ARN:** ${test.restoredResourceArn ?? 'N/A'}\n**Recovery Time:** ${test.actualRecoveryTimeMinutes} minutes\n**Validations Passed:** ${test.validationsPassed}\n**Validations Failed:** ${test.validationsFailed}\n**Cleaned Up:** ${test.cleanedUp ? 'Yes' : 'No'}${test.errors.length > 0 ? `\n\n**Errors:**\n${test.errors.map(e => `• ${e}`).join('\n')}` : ''}`,
                  }],
                  details: { test_result: test },
                };
              }

              // ==================
              // Report Plans
              // ==================
              case "list_report_plans": {
                const result = await backupManager.listReportPlans();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to list report plans: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const plans = result.data ?? [];
                if (plans.length === 0) {
                  return {
                    content: [{ type: "text", text: "No report plans found" }],
                    details: { plans: [] },
                  };
                }

                const planList = plans.map(p => 
                  `• **${p.reportPlanName}**\n  Template: ${p.reportSetting.reportTemplate}\n  Delivery: s3://${p.reportDeliveryChannel.s3BucketName}`
                ).join('\n');

                return {
                  content: [{ type: "text", text: `📊 **Report Plans** (${plans.length})\n\n${planList}` }],
                  details: { plans },
                };
              }

              case "create_report_plan": {
                const reportPlanName = params.report_plan_name as string;
                const reportTemplate = params.report_template as string;
                const s3BucketName = params.s3_bucket_name as string;

                if (!reportPlanName || !reportTemplate || !s3BucketName) {
                  return {
                    content: [{ type: "text", text: "Error: report_plan_name, report_template, and s3_bucket_name are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.createReportPlan({
                  reportPlanName,
                  reportTemplate: reportTemplate as "RESOURCE_COMPLIANCE_REPORT" | "CONTROL_COMPLIANCE_REPORT" | "BACKUP_JOB_REPORT" | "COPY_JOB_REPORT" | "RESTORE_JOB_REPORT",
                  s3BucketName,
                  tags: params.tags as Record<string, string>,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to create report plan: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `✅ Report plan **${reportPlanName}** created\n\n**ARN:** ${result.data!.reportPlanArn}`,
                  }],
                  details: result.data,
                };
              }

              case "delete_report_plan": {
                const reportPlanName = params.report_plan_name as string;
                if (!reportPlanName) {
                  return {
                    content: [{ type: "text", text: "Error: report_plan_name is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await backupManager.deleteReportPlan(reportPlanName);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to delete report plan: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                return {
                  content: [{ type: "text", text: `✅ Report plan ${reportPlanName} deleted` }],
                  details: { deleted: true },
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
              content: [{ type: "text", text: `Backup error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_backup" },
    );

    // =========================================================================
    // AWS CI/CD PIPELINE AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        name: "aws_cicd",
        label: "AWS CI/CD Pipeline Management",
        description:
          "Manage AWS CI/CD pipelines with CodePipeline, CodeBuild, and CodeDeploy. Create and manage pipelines, build projects, deployments, and blue/green deployment strategies.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "list_pipelines",
                "get_pipeline",
                "create_pipeline",
                "delete_pipeline",
                "start_pipeline",
                "stop_pipeline",
                "get_pipeline_state",
                "list_pipeline_executions",
                "get_pipeline_execution",
                "retry_stage",
                "enable_stage_transition",
                "disable_stage_transition",
                "list_build_projects",
                "get_build_project",
                "create_build_project",
                "delete_build_project",
                "start_build",
                "stop_build",
                "get_build",
                "get_build_logs",
                "list_applications",
                "get_application",
                "create_application",
                "delete_application",
                "list_deployment_groups",
                "get_deployment_group",
                "create_deployment_group",
                "create_deployment",
                "get_deployment",
                "list_deployments",
                "stop_deployment",
                "rollback_deployment",
                "list_deployment_configs",
                "get_deployment_config",
                "configure_blue_green",
                "list_templates",
                "create_from_template",
              ],
              description: "The CI/CD operation to perform",
            },
            pipelineName: {
              type: "string",
              description: "The pipeline name",
            },
            pipelineExecutionId: {
              type: "string",
              description: "The pipeline execution ID",
            },
            projectName: {
              type: "string",
              description: "The CodeBuild project name",
            },
            buildId: {
              type: "string",
              description: "The build ID",
            },
            applicationName: {
              type: "string",
              description: "The CodeDeploy application name",
            },
            deploymentGroupName: {
              type: "string",
              description: "The deployment group name",
            },
            deploymentId: {
              type: "string",
              description: "The deployment ID",
            },
            deploymentConfigName: {
              type: "string",
              description: "The deployment config name",
            },
            stageName: {
              type: "string",
              description: "The pipeline stage name",
            },
            templateId: {
              type: "string",
              description: "The pipeline template ID",
            },
            roleArn: {
              type: "string",
              description: "The IAM role ARN",
            },
            artifactBucket: {
              type: "string",
              description: "The S3 artifact bucket name",
            },
            sourceType: {
              type: "string",
              enum: ["CodeCommit", "GitHub", "GitHubEnterpriseServer", "S3", "Bitbucket", "CodeStarSourceConnection"],
              description: "The source provider type",
            },
            repositoryName: {
              type: "string",
              description: "The source repository name",
            },
            branchName: {
              type: "string",
              description: "The source branch name",
            },
            computeType: {
              type: "string",
              enum: ["BUILD_GENERAL1_SMALL", "BUILD_GENERAL1_MEDIUM", "BUILD_GENERAL1_LARGE", "BUILD_GENERAL1_2XLARGE"],
              description: "The CodeBuild compute type",
            },
            buildImage: {
              type: "string",
              description: "The CodeBuild environment image (e.g., aws/codebuild/standard:7.0)",
            },
            buildspec: {
              type: "string",
              description: "The buildspec file path or inline YAML",
            },
            computePlatform: {
              type: "string",
              enum: ["Server", "Lambda", "ECS"],
              description: "The CodeDeploy compute platform",
            },
            reason: {
              type: "string",
              description: "Reason for stopping/disabling",
            },
            parameters: {
              type: "object",
              description: "Template parameters as key-value pairs",
            },
            region: {
              type: "string",
              description: "AWS region override",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const action = params.action as string;
          if (!cicdManager) {
            return {
              content: [{ type: "text", text: "CI/CD manager not initialized. AWS services may not be started." }],
              details: { error: "not_initialized" },
            };
          }
          try {
            switch (action) {
              case "list_pipelines": {
                const result = await cicdManager.listPipelines();
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_pipeline": {
                const result = await cicdManager.getPipeline(params.pipelineName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_pipeline": {
                const result = await cicdManager.createPipeline({
                  pipelineName: params.pipelineName as string,
                  roleArn: params.roleArn as string,
                  artifactStore: { type: "S3" as const, location: params.artifactBucket as string },
                  stages: [],
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_pipeline": {
                const result = await cicdManager.deletePipeline(params.pipelineName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "start_pipeline": {
                const result = await cicdManager.startPipelineExecution({
                  pipelineName: params.pipelineName as string,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "stop_pipeline": {
                const result = await cicdManager.stopPipelineExecution({
                  pipelineName: params.pipelineName as string,
                  pipelineExecutionId: params.pipelineExecutionId as string,
                  reason: params.reason as string | undefined,
                  abandon: false,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_pipeline_state": {
                const result = await cicdManager.getPipelineState(params.pipelineName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_pipeline_executions": {
                const result = await cicdManager.listPipelineExecutions({
                  pipelineName: params.pipelineName as string,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_pipeline_execution": {
                const result = await cicdManager.getPipelineExecution(
                  params.pipelineName as string,
                  params.pipelineExecutionId as string,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "retry_stage": {
                const result = await cicdManager.retryStageExecution({
                  pipelineName: params.pipelineName as string,
                  stageName: params.stageName as string,
                  pipelineExecutionId: params.pipelineExecutionId as string,
                  retryMode: "FAILED_ACTIONS",
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "enable_stage_transition": {
                const result = await cicdManager.enableStageTransition(
                  params.pipelineName as string,
                  params.stageName as string,
                  "Inbound",
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "disable_stage_transition": {
                const result = await cicdManager.disableStageTransition(
                  params.pipelineName as string,
                  params.stageName as string,
                  "Inbound",
                  params.reason as string ?? "Disabled via Espada",
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_build_projects": {
                const result = await cicdManager.listBuildProjects();
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_build_project": {
                const result = await cicdManager.getBuildProject(params.projectName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_build_project": {
                const result = await cicdManager.createBuildProject({
                  name: params.projectName as string,
                  source: { type: ((params.sourceType as string) ?? "CODEPIPELINE") as "CODEPIPELINE", location: params.repositoryName as string },
                  environment: {
                    type: "LINUX_CONTAINER",
                    computeType: ((params.computeType as string) ?? "BUILD_GENERAL1_SMALL") as "BUILD_GENERAL1_SMALL",
                    image: (params.buildImage as string) ?? "aws/codebuild/standard:7.0",
                  },
                  serviceRole: params.roleArn as string,
                  artifacts: { type: "CODEPIPELINE" },
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_build_project": {
                const result = await cicdManager.deleteBuildProject(params.projectName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "start_build": {
                const result = await cicdManager.startBuild({
                  projectName: params.projectName as string,
                  buildspecOverride: params.buildspec as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "stop_build": {
                const result = await cicdManager.stopBuild(params.buildId as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_build": {
                const result = await cicdManager.getBuild(params.buildId as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_build_logs": {
                const result = await cicdManager.getBuildLogs(params.buildId as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_applications": {
                const result = await cicdManager.listApplications();
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_application": {
                const result = await cicdManager.getApplication(params.applicationName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_application": {
                const result = await cicdManager.createApplication({
                  applicationName: params.applicationName as string,
                  computePlatform: (params.computePlatform as "Server" | "Lambda" | "ECS") ?? "Server",
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_application": {
                const result = await cicdManager.deleteApplication(params.applicationName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_deployment_groups": {
                const result = await cicdManager.listDeploymentGroups({
                  applicationName: params.applicationName as string,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_deployment_group": {
                const result = await cicdManager.getDeploymentGroup(
                  params.applicationName as string,
                  params.deploymentGroupName as string,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_deployment": {
                const result = await cicdManager.createDeployment({
                  applicationName: params.applicationName as string,
                  deploymentGroupName: params.deploymentGroupName as string,
                  deploymentConfigName: params.deploymentConfigName as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_deployment": {
                const result = await cicdManager.getDeployment(params.deploymentId as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_deployments": {
                const result = await cicdManager.listDeployments({
                  applicationName: params.applicationName as string | undefined,
                  deploymentGroupName: params.deploymentGroupName as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "stop_deployment": {
                const result = await cicdManager.stopDeployment(params.deploymentId as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "rollback_deployment": {
                const result = await cicdManager.rollbackDeployment(params.deploymentId as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_deployment_configs": {
                const result = await cicdManager.listDeploymentConfigs();
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_deployment_config": {
                const result = await cicdManager.getDeploymentConfig(params.deploymentConfigName as string);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "configure_blue_green": {
                const result = await cicdManager.configureBlueGreenDeployment({
                  applicationName: params.applicationName as string,
                  deploymentGroupName: params.deploymentGroupName as string,
                  trafficRoutingType: "AllAtOnce",
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_templates": {
                const result = await cicdManager.getPipelineTemplates();
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_from_template": {
                const result = await cicdManager.createPipelineFromTemplate(
                  params.templateId as string,
                  params.pipelineName as string,
                  params.roleArn as string,
                  params.artifactBucket as string,
                  (params.parameters as Record<string, string>) ?? {},
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              default:
                return {
                  content: [{ type: "text", text: `Unknown CI/CD action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `CI/CD error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_cicd" },
    );

    // =========================================================================
    // AWS NETWORK AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        name: "aws_network",
        label: "AWS Network Management",
        description:
          "Manage AWS networking infrastructure. Create and manage VPCs, subnets, route tables, internet gateways, NAT gateways, VPC peering, transit gateways, network ACLs, VPC endpoints, and flow logs.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "list_vpcs",
                "create_vpc",
                "delete_vpc",
                "list_subnets",
                "create_subnet",
                "delete_subnet",
                "list_route_tables",
                "create_route_table",
                "create_route",
                "associate_route_table",
                "delete_route_table",
                "list_internet_gateways",
                "create_internet_gateway",
                "delete_internet_gateway",
                "list_nat_gateways",
                "create_nat_gateway",
                "delete_nat_gateway",
                "list_vpc_peering",
                "create_vpc_peering",
                "accept_vpc_peering",
                "delete_vpc_peering",
                "list_transit_gateways",
                "create_transit_gateway",
                "attach_vpc_to_transit_gateway",
                "delete_transit_gateway",
                "list_network_acls",
                "create_network_acl",
                "create_network_acl_entry",
                "delete_network_acl",
                "list_vpc_endpoints",
                "list_vpc_endpoint_services",
                "create_vpc_endpoint",
                "delete_vpc_endpoints",
                "list_flow_logs",
                "create_flow_log",
                "delete_flow_logs",
                "create_multi_az_vpc",
                "get_availability_zones",
              ],
              description: "The network operation to perform",
            },
            vpcId: {
              type: "string",
              description: "The VPC ID",
            },
            subnetId: {
              type: "string",
              description: "The subnet ID",
            },
            routeTableId: {
              type: "string",
              description: "The route table ID",
            },
            internetGatewayId: {
              type: "string",
              description: "The internet gateway ID",
            },
            natGatewayId: {
              type: "string",
              description: "The NAT gateway ID",
            },
            peeringConnectionId: {
              type: "string",
              description: "The VPC peering connection ID",
            },
            transitGatewayId: {
              type: "string",
              description: "The transit gateway ID",
            },
            networkAclId: {
              type: "string",
              description: "The network ACL ID",
            },
            vpcEndpointIds: {
              type: "array",
              items: { type: "string" },
              description: "Array of VPC endpoint IDs",
            },
            flowLogIds: {
              type: "array",
              items: { type: "string" },
              description: "Array of flow log IDs",
            },
            cidrBlock: {
              type: "string",
              description: "The CIDR block (e.g., 10.0.0.0/16)",
            },
            availabilityZone: {
              type: "string",
              description: "The availability zone (e.g., us-east-1a)",
            },
            name: {
              type: "string",
              description: "Resource name tag",
            },
            peerVpcId: {
              type: "string",
              description: "The peer VPC ID for peering connections",
            },
            peerAccountId: {
              type: "string",
              description: "The peer account ID for cross-account peering",
            },
            peerRegion: {
              type: "string",
              description: "The peer region for cross-region peering",
            },
            serviceName: {
              type: "string",
              description: "The VPC endpoint service name",
            },
            endpointType: {
              type: "string",
              enum: ["Interface", "Gateway", "GatewayLoadBalancer"],
              description: "The VPC endpoint type",
            },
            destinationCidrBlock: {
              type: "string",
              description: "The destination CIDR block for routes",
            },
            gatewayId: {
              type: "string",
              description: "The gateway ID for routes",
            },
            allocationId: {
              type: "string",
              description: "The Elastic IP allocation ID for NAT gateway",
            },
            enableDnsHostnames: {
              type: "boolean",
              description: "Enable DNS hostnames in VPC",
            },
            enableDnsSupport: {
              type: "boolean",
              description: "Enable DNS support in VPC",
            },
            mapPublicIpOnLaunch: {
              type: "boolean",
              description: "Map public IP on launch for subnets",
            },
            numberOfAzs: {
              type: "number",
              description: "Number of availability zones for multi-AZ VPC",
            },
            region: {
              type: "string",
              description: "AWS region override",
            },
            tags: {
              type: "object",
              description: "Resource tags as key-value pairs",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const action = params.action as string;
          if (!networkManager) {
            return {
              content: [{ type: "text", text: "Network manager not initialized. AWS services may not be started." }],
              details: { error: "not_initialized" },
            };
          }
          try {
            switch (action) {
              case "list_vpcs": {
                const result = await networkManager.listVPCs({
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_vpc": {
                const result = await networkManager.createVPC({
                  cidrBlock: params.cidrBlock as string,
                  name: params.name as string | undefined,
                  enableDnsHostnames: params.enableDnsHostnames as boolean | undefined,
                  enableDnsSupport: params.enableDnsSupport as boolean | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_vpc": {
                const result = await networkManager.deleteVPC(
                  params.vpcId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_subnets": {
                const result = await networkManager.listSubnets({
                  vpcId: params.vpcId as string | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_subnet": {
                const result = await networkManager.createSubnet({
                  vpcId: params.vpcId as string,
                  cidrBlock: params.cidrBlock as string,
                  availabilityZone: params.availabilityZone as string | undefined,
                  name: params.name as string | undefined,
                  mapPublicIpOnLaunch: params.mapPublicIpOnLaunch as boolean | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_subnet": {
                const result = await networkManager.deleteSubnet(
                  params.subnetId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_route_tables": {
                const result = await networkManager.listRouteTables({
                  vpcId: params.vpcId as string | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_route_table": {
                const result = await networkManager.createRouteTable({
                  vpcId: params.vpcId as string,
                  name: params.name as string | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_route": {
                const result = await networkManager.createRoute({
                  routeTableId: params.routeTableId as string,
                  destinationCidrBlock: params.destinationCidrBlock as string,
                  gatewayId: params.gatewayId as string | undefined,
                  natGatewayId: params.natGatewayId as string | undefined,
                  transitGatewayId: params.transitGatewayId as string | undefined,
                  vpcPeeringConnectionId: params.peeringConnectionId as string | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "associate_route_table": {
                const result = await networkManager.associateRouteTable(
                  params.routeTableId as string,
                  params.subnetId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_route_table": {
                const result = await networkManager.deleteRouteTable(
                  params.routeTableId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_internet_gateways": {
                const result = await networkManager.listInternetGateways(
                  params.vpcId as string | undefined,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_internet_gateway": {
                const result = await networkManager.createInternetGateway({
                  vpcId: params.vpcId as string | undefined,
                  name: params.name as string | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_internet_gateway": {
                const result = await networkManager.deleteInternetGateway(
                  params.internetGatewayId as string,
                  params.vpcId as string | undefined,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_nat_gateways": {
                const result = await networkManager.listNATGateways({
                  vpcId: params.vpcId as string | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_nat_gateway": {
                const result = await networkManager.createNATGateway({
                  subnetId: params.subnetId as string,
                  allocationId: params.allocationId as string | undefined,
                  name: params.name as string | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_nat_gateway": {
                const result = await networkManager.deleteNATGateway(
                  params.natGatewayId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_vpc_peering": {
                const result = await networkManager.listVPCPeering({
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_vpc_peering": {
                const result = await networkManager.createVPCPeering({
                  vpcId: params.vpcId as string,
                  peerVpcId: params.peerVpcId as string,
                  peerOwnerId: params.peerAccountId as string | undefined,
                  peerRegion: params.peerRegion as string | undefined,
                  name: params.name as string | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "accept_vpc_peering": {
                const result = await networkManager.acceptVPCPeering(
                  params.peeringConnectionId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_vpc_peering": {
                const result = await networkManager.deleteVPCPeering(
                  params.peeringConnectionId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_transit_gateways": {
                const result = await networkManager.listTransitGateways(params.region as string | undefined);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_transit_gateway": {
                const result = await networkManager.createTransitGateway({
                  name: params.name as string | undefined,
                  description: params.reason as string | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "attach_vpc_to_transit_gateway": {
                const result = await networkManager.attachVPCToTransitGateway({
                  transitGatewayId: params.transitGatewayId as string,
                  vpcId: params.vpcId as string,
                  subnetIds: (params.vpcEndpointIds as string[]) ?? [],
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_transit_gateway": {
                const result = await networkManager.deleteTransitGateway(
                  params.transitGatewayId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_network_acls": {
                const result = await networkManager.listNetworkACLs(
                  params.vpcId as string | undefined,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_network_acl": {
                const result = await networkManager.createNetworkACL({
                  vpcId: params.vpcId as string,
                  name: params.name as string | undefined,
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_network_acl": {
                const result = await networkManager.deleteNetworkACL(
                  params.networkAclId as string,
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_vpc_endpoints": {
                const result = await networkManager.listVPCEndpoints({
                  vpcId: params.vpcId as string | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_vpc_endpoint_services": {
                const result = await networkManager.listVPCEndpointServices(params.region as string | undefined);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_vpc_endpoint": {
                const result = await networkManager.createVPCEndpoint({
                  vpcId: params.vpcId as string,
                  serviceName: params.serviceName as string,
                  vpcEndpointType: (params.endpointType as "Interface" | "Gateway" | "GatewayLoadBalancer") ?? "Interface",
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_vpc_endpoints": {
                const result = await networkManager.deleteVPCEndpoints(
                  params.vpcEndpointIds as string[],
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "list_flow_logs": {
                const result = await networkManager.listFlowLogs({
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_flow_log": {
                const result = await networkManager.createFlowLog({
                  resourceId: params.vpcId as string,
                  resourceType: "VPC",
                  trafficType: "ALL",
                  logDestinationType: "cloud-watch-logs",
                  tags: params.tags as Record<string, string> | undefined,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "delete_flow_logs": {
                const result = await networkManager.deleteFlowLogs(
                  params.flowLogIds as string[],
                  params.region as string | undefined,
                );
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "create_multi_az_vpc": {
                const result = await networkManager.createMultiAZVPC({
                  cidrBlock: params.cidrBlock as string ?? "10.0.0.0/16",
                  name: params.name as string ?? "multi-az-vpc",
                  azCount: params.numberOfAzs as number ?? 2,
                  region: params.region as string | undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              case "get_availability_zones": {
                const result = await networkManager.getAvailabilityZones(params.region as string | undefined);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
              }
              default:
                return {
                  content: [{ type: "text", text: `Unknown network action: ${action}` }],
                  details: { error: "unknown_action" },
                };
            }
          } catch (error) {
            return {
              content: [{ type: "text", text: `Network error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_network" },
    );

    // =========================================================================
    // AWS CONVERSATIONAL UX AGENT TOOL
    // =========================================================================

    api.registerTool(
      {
        name: "aws_assistant",
        label: "AWS Conversational Assistant",
        description: `An intelligent AWS infrastructure assistant providing context-aware interactions, proactive insights, natural language queries, and wizard-guided infrastructure creation.

CAPABILITIES:

1. INFRASTRUCTURE CONTEXT MANAGEMENT
   - Track recently accessed resources automatically
   - Maintain session history of operations
   - Pin/unpin important resources for quick access
   - Set context variables for filtering
   - Switch between regions and environments

2. NATURAL LANGUAGE QUERIES
   - Query resources using plain English
   - "Show me all EC2 instances in production"
   - "Find resources tagged with project=alpha"
   - "What's running in us-west-2?"
   - "Count Lambda functions created this week"
   - "List unused EBS volumes"

3. PROACTIVE INSIGHTS
   - Automatic detection of cost optimization opportunities
   - Security vulnerability identification
   - Performance bottleneck alerts
   - Capacity planning warnings
   - Compliance status monitoring

   Insight Categories:
   - Cost: Unused resources, idle instances, old snapshots
   - Security: Public S3 buckets, open security groups, MFA status
   - Performance: High CPU, memory issues, throttling
   - Reliability: Single-AZ databases, missing backups
   - Operational: Pending maintenance, outdated AMIs

4. WIZARD MODE
   - Guided infrastructure creation with step-by-step flows
   - Pre-built templates for common architectures:
     • Production Web Application (VPC, ALB, EC2, RDS)
     • Serverless REST API (API Gateway, Lambda)
     • Containerized Application (ECS Fargate)
     • Static Website (S3, CloudFront)
     • VPC Network Setup
     • Database Setup (RDS/Aurora)
     • Monitoring & Alerting Setup
   - Dry-run execution for validation
   - Cost estimation before deployment
   - IaC generation (Terraform/CloudFormation)

5. SESSION SUMMARY & REPORTING
   - Infrastructure health overview
   - Session activity summary
   - Resource access patterns
   - Operation success rates

Use this tool to:
- Get intelligent assistance with AWS infrastructure
- Query resources using natural language
- Receive proactive recommendations
- Create infrastructure using guided wizards
- Track context across multiple operations`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                // Context Management
                "get_context",
                "set_region",
                "set_account",
                "set_environment",
                "add_recent_resource",
                "pin_resource",
                "unpin_resource",
                "add_filter",
                "remove_filter",
                "clear_filters",
                "set_variable",
                "get_variable",
                "clear_session",
                "record_operation",
                // Natural Language Queries
                "query",
                "parse_query",
                "get_suggestions",
                // Proactive Insights
                "get_insights",
                "get_insight",
                "acknowledge_insight",
                "dismiss_insight",
                "snooze_insight",
                "resolve_insight",
                "run_insight_checks",
                "get_insight_checks",
                "update_insight_check",
                // Wizard Mode
                "list_wizard_templates",
                "get_wizard_template",
                "start_wizard",
                "get_wizard_state",
                "answer_wizard_step",
                "go_back_wizard",
                "skip_wizard_step",
                "cancel_wizard",
                "generate_wizard_plan",
                "execute_wizard",
                // Summary & Reporting
                "get_infrastructure_summary",
                "get_session_summary",
              ],
              description: "The conversational assistant action to perform",
            },
            // Common options
            region: {
              type: "string",
              description: "AWS region for context",
            },
            // Context options
            account_id: {
              type: "string",
              description: "AWS account ID",
            },
            environment: {
              type: "string",
              enum: ["dev", "development", "staging", "uat", "production", "prod", "test", "sandbox"],
              description: "Environment type",
            },
            resource: {
              type: "object",
              description: "Resource reference object",
              properties: {
                type: { type: "string" },
                id: { type: "string" },
                name: { type: "string" },
                region: { type: "string" },
                arn: { type: "string" },
                tags: { type: "object" },
              },
            },
            resource_id: {
              type: "string",
              description: "Resource ID to unpin",
            },
            filter: {
              type: "object",
              description: "Filter to add",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
                operator: { type: "string" },
                value: { type: "string" },
                active: { type: "boolean" },
              },
            },
            filter_id: {
              type: "string",
              description: "Filter ID to remove",
            },
            variable_name: {
              type: "string",
              description: "Variable name",
            },
            variable_value: {
              type: "string",
              description: "Variable value",
            },
            operation: {
              type: "object",
              description: "Operation record",
            },
            // Query options
            query: {
              type: "string",
              description: "Natural language query",
            },
            partial_query: {
              type: "string",
              description: "Partial query for suggestions",
            },
            // Insight options
            insight_id: {
              type: "string",
              description: "Insight ID",
            },
            insight_category: {
              type: "string",
              enum: ["cost", "security", "performance", "reliability", "operational", "compliance", "capacity", "optimization"],
              description: "Filter insights by category",
            },
            insight_severity: {
              type: "string",
              enum: ["critical", "high", "medium", "low", "info"],
              description: "Filter insights by severity",
            },
            insight_status: {
              type: "string",
              enum: ["new", "acknowledged", "in-progress", "resolved", "dismissed", "snoozed"],
              description: "Filter insights by status",
            },
            snooze_until: {
              type: "string",
              description: "ISO date string for snooze until",
            },
            check_ids: {
              type: "array",
              items: { type: "string" },
              description: "Specific insight check IDs to run",
            },
            check_id: {
              type: "string",
              description: "Insight check ID to update",
            },
            check_enabled: {
              type: "boolean",
              description: "Enable or disable the insight check",
            },
            // Wizard options
            template_id: {
              type: "string",
              description: "Wizard template ID",
            },
            wizard_id: {
              type: "string",
              description: "Active wizard ID",
            },
            step_id: {
              type: "string",
              description: "Wizard step ID",
            },
            step_value: {
              description: "Value for wizard step answer",
            },
            dry_run: {
              type: "boolean",
              description: "Execute wizard in dry-run mode",
            },
            // Pagination
            limit: {
              type: "number",
              description: "Maximum results to return",
            },
            include_dismissed: {
              type: "boolean",
              description: "Include dismissed insights",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const action = params.action as string;
          const region = (params.region as string) || config.defaultRegion || "us-east-1";

          // Initialize conversational manager if needed
          if (!conversationalManager) {
            conversationalManager = createConversationalManager({
              defaultRegion: region,
            });
          }

          try {
            switch (action) {
              // ==================
              // Context Management
              // ==================
              case "get_context": {
                const context = conversationalManager.getContext();
                return {
                  content: [{
                    type: "text",
                    text: `📋 **Current Context**

**Session:** ${context.sessionId}
**Started:** ${context.sessionStarted.toISOString()}
**Region:** ${context.activeRegion}
**Account:** ${context.activeAccount || 'Not set'}
**Environment:** ${context.environment || 'Not set'}

**Recent Resources:** ${context.recentResources.length}
**Pinned Resources:** ${context.pinnedResources.length}
**Active Filters:** ${context.activeFilters.length}
**Operations:** ${context.sessionHistory.length}`,
                  }],
                  details: { context },
                };
              }

              case "set_region": {
                const newRegion = params.region as string;
                if (!newRegion) {
                  return {
                    content: [{ type: "text", text: "Error: region is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.setActiveRegion(newRegion);
                return {
                  content: [{ type: "text", text: `✅ Active region set to **${newRegion}**` }],
                  details: { region: newRegion },
                };
              }

              case "set_account": {
                const accountId = params.account_id as string;
                if (!accountId) {
                  return {
                    content: [{ type: "text", text: "Error: account_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.setActiveAccount(accountId);
                return {
                  content: [{ type: "text", text: `✅ Active account set to **${accountId}**` }],
                  details: { accountId },
                };
              }

              case "set_environment": {
                const environment = params.environment as string;
                if (!environment) {
                  return {
                    content: [{ type: "text", text: "Error: environment is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.setEnvironment(environment as "dev" | "development" | "staging" | "uat" | "production" | "prod" | "test" | "sandbox");
                return {
                  content: [{ type: "text", text: `✅ Environment set to **${environment}**` }],
                  details: { environment },
                };
              }

              case "add_recent_resource": {
                const resource = params.resource as { type: string; id: string; name: string; region: string; arn?: string; tags?: Record<string, string> };
                if (!resource?.type || !resource?.id || !resource?.name) {
                  return {
                    content: [{ type: "text", text: "Error: resource with type, id, and name is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.addRecentResource({
                  ...resource,
                  lastAccessed: new Date(),
                  accessCount: 1,
                } as { type: "ec2:instance" | "ec2:security-group" | "ec2:vpc" | "ec2:subnet" | "rds:instance" | "rds:cluster" | "lambda:function" | "s3:bucket" | "ecs:cluster" | "ecs:service" | "eks:cluster" | "dynamodb:table" | "sqs:queue" | "sns:topic" | "cloudfront:distribution" | "elb:load-balancer" | "iam:role" | "iam:user" | "kms:key" | "secretsmanager:secret" | "cloudwatch:alarm" | "route53:hosted-zone" | "apigateway:rest-api" | "other"; id: string; name: string; region: string; arn?: string; tags?: Record<string, string>; lastAccessed: Date; accessCount: number });
                return {
                  content: [{ type: "text", text: `✅ Added **${resource.name}** to recent resources` }],
                  details: { resource },
                };
              }

              case "pin_resource": {
                const resource = params.resource as { type: string; id: string; name: string; region: string; arn?: string; tags?: Record<string, string> };
                if (!resource?.type || !resource?.id || !resource?.name) {
                  return {
                    content: [{ type: "text", text: "Error: resource with type, id, and name is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.pinResource({
                  ...resource,
                  lastAccessed: new Date(),
                  accessCount: 1,
                } as { type: "ec2:instance" | "ec2:security-group" | "ec2:vpc" | "ec2:subnet" | "rds:instance" | "rds:cluster" | "lambda:function" | "s3:bucket" | "ecs:cluster" | "ecs:service" | "eks:cluster" | "dynamodb:table" | "sqs:queue" | "sns:topic" | "cloudfront:distribution" | "elb:load-balancer" | "iam:role" | "iam:user" | "kms:key" | "secretsmanager:secret" | "cloudwatch:alarm" | "route53:hosted-zone" | "apigateway:rest-api" | "other"; id: string; name: string; region: string; arn?: string; tags?: Record<string, string>; lastAccessed: Date; accessCount: number });
                return {
                  content: [{ type: "text", text: `📌 Pinned **${resource.name}**` }],
                  details: { resource },
                };
              }

              case "unpin_resource": {
                const resourceId = params.resource_id as string;
                if (!resourceId) {
                  return {
                    content: [{ type: "text", text: "Error: resource_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.unpinResource(resourceId);
                return {
                  content: [{ type: "text", text: `📌 Unpinned resource **${resourceId}**` }],
                  details: { resourceId },
                };
              }

              case "add_filter": {
                const filter = params.filter as { id: string; name: string; type: string; operator: string; value: string; active: boolean };
                if (!filter?.name || !filter?.type || !filter?.operator || filter?.value === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: filter with name, type, operator, and value is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.addFilter({
                  id: filter.id || crypto.randomUUID(),
                  name: filter.name,
                  type: filter.type as "tag" | "region" | "type" | "environment" | "account" | "name" | "created" | "custom",
                  operator: filter.operator as "equals" | "not-equals" | "contains" | "starts-with" | "ends-with" | "greater-than" | "less-than" | "in" | "not-in" | "exists" | "not-exists",
                  value: filter.value,
                  active: filter.active ?? true,
                });
                return {
                  content: [{ type: "text", text: `✅ Added filter **${filter.name}**` }],
                  details: { filter },
                };
              }

              case "remove_filter": {
                const filterId = params.filter_id as string;
                if (!filterId) {
                  return {
                    content: [{ type: "text", text: "Error: filter_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.removeFilter(filterId);
                return {
                  content: [{ type: "text", text: `✅ Removed filter **${filterId}**` }],
                  details: { filterId },
                };
              }

              case "clear_filters": {
                conversationalManager.clearFilters();
                return {
                  content: [{ type: "text", text: "✅ All filters cleared" }],
                  details: { cleared: true },
                };
              }

              case "set_variable": {
                const varName = params.variable_name as string;
                const varValue = params.variable_value as string;
                if (!varName || varValue === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: variable_name and variable_value are required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.setVariable(varName, varValue);
                return {
                  content: [{ type: "text", text: `✅ Variable **${varName}** set to "${varValue}"` }],
                  details: { name: varName, value: varValue },
                };
              }

              case "get_variable": {
                const varName = params.variable_name as string;
                if (!varName) {
                  return {
                    content: [{ type: "text", text: "Error: variable_name is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const value = conversationalManager.getVariable(varName);
                return {
                  content: [{ type: "text", text: value !== undefined ? `**${varName}** = "${value}"` : `Variable **${varName}** not found` }],
                  details: { name: varName, value },
                };
              }

              case "clear_session": {
                conversationalManager.clearSession();
                return {
                  content: [{ type: "text", text: "✅ Session cleared - new session started" }],
                  details: { cleared: true },
                };
              }

              case "record_operation": {
                const operation = params.operation as { id: string; action: string; service: string; resources: unknown[]; timestamp: string; status: string; durationMs?: number; error?: string };
                if (!operation?.action || !operation?.service) {
                  return {
                    content: [{ type: "text", text: "Error: operation with action and service is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                conversationalManager.recordOperation({
                  id: operation.id || crypto.randomUUID(),
                  action: operation.action,
                  service: operation.service,
                  resources: (operation.resources || []) as { type: "ec2:instance" | "ec2:security-group" | "ec2:vpc" | "ec2:subnet" | "rds:instance" | "rds:cluster" | "lambda:function" | "s3:bucket" | "ecs:cluster" | "ecs:service" | "eks:cluster" | "dynamodb:table" | "sqs:queue" | "sns:topic" | "cloudfront:distribution" | "elb:load-balancer" | "iam:role" | "iam:user" | "kms:key" | "secretsmanager:secret" | "cloudwatch:alarm" | "route53:hosted-zone" | "apigateway:rest-api" | "other"; id: string; name: string; region: string; lastAccessed: Date; accessCount: number }[],
                  timestamp: operation.timestamp ? new Date(operation.timestamp) : new Date(),
                  status: (operation.status || 'success') as 'success' | 'failed' | 'in-progress' | 'cancelled',
                  durationMs: operation.durationMs,
                  error: operation.error,
                });
                return {
                  content: [{ type: "text", text: `✅ Recorded operation: ${operation.action}` }],
                  details: { operation },
                };
              }

              // ==================
              // Natural Language Queries
              // ==================
              case "query": {
                const queryText = params.query as string;
                if (!queryText) {
                  return {
                    content: [{ type: "text", text: "Error: query is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.executeQuery(queryText);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Query failed: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const queryResult = result.data!;
                const resourceList = queryResult.resources.length > 0
                  ? queryResult.resources.slice(0, 20).map(r => `• **${r.name}** (${r.type}) - ${r.region}`).join('\n')
                  : 'No resources found';

                return {
                  content: [{
                    type: "text",
                    text: `🔍 **Query Results**

**Summary:** ${queryResult.summary}
**Execution Time:** ${queryResult.executionTimeMs}ms

**Resources:**
${resourceList}${queryResult.totalCount > 20 ? `\n\n_...and ${queryResult.totalCount - 20} more_` : ''}${queryResult.suggestions?.length ? `\n\n**Suggestions:**\n${queryResult.suggestions.map(s => `• ${s}`).join('\n')}` : ''}`,
                  }],
                  details: queryResult,
                };
              }

              case "parse_query": {
                const queryText = params.query as string;
                if (!queryText) {
                  return {
                    content: [{ type: "text", text: "Error: query is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.parseQuery(queryText);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Parse failed: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const parsed = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: `📝 **Parsed Query**

**Original:** "${parsed.originalQuery}"
**Intent:** ${parsed.intent}
**Confidence:** ${(parsed.confidence * 100).toFixed(0)}%
**Resource Types:** ${parsed.resourceTypes.join(', ') || 'All'}
**Filters:** ${parsed.filters.length}
**Region:** ${parsed.region || 'Default'}
**Environment:** ${parsed.environment || 'Any'}
**Time Range:** ${parsed.timeRange?.type || 'None'}${parsed.ambiguities?.length ? `\n\n**Ambiguities:**\n${parsed.ambiguities.map(a => `• ${a}`).join('\n')}` : ''}`,
                  }],
                  details: parsed,
                };
              }

              case "get_suggestions": {
                const partialQuery = params.partial_query as string || '';
                const result = await conversationalManager.getSuggestions(partialQuery);
                
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get suggestions: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const suggestions = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: suggestions.length > 0
                      ? `💡 **Query Suggestions**\n\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
                      : 'No suggestions available',
                  }],
                  details: { suggestions },
                };
              }

              // ==================
              // Proactive Insights
              // ==================
              case "get_insights": {
                const result = await conversationalManager.getInsights({
                  category: params.insight_category as "cost" | "security" | "performance" | "reliability" | "operational" | "compliance" | "capacity" | "optimization" | undefined,
                  severity: params.insight_severity as "critical" | "high" | "medium" | "low" | "info" | undefined,
                  status: params.insight_status as "new" | "acknowledged" | "in-progress" | "resolved" | "dismissed" | "snoozed" | undefined,
                  limit: params.limit as number,
                  includeDismissed: params.include_dismissed as boolean,
                });

                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get insights: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const insights = result.data!;
                if (insights.length === 0) {
                  return {
                    content: [{ type: "text", text: "✅ No insights found - your infrastructure looks healthy!" }],
                    details: { insights: [] },
                  };
                }

                const severityEmoji: Record<string, string> = {
                  critical: '🔴',
                  high: '🟠',
                  medium: '🟡',
                  low: '🟢',
                  info: 'ℹ️',
                };

                const insightList = insights.map(i => 
                  `${severityEmoji[i.severity]} **${i.title}**\n   ${i.description}\n   Category: ${i.category} | Status: ${i.status}`
                ).join('\n\n');

                return {
                  content: [{
                    type: "text",
                    text: `🔍 **Proactive Insights** (${insights.length})\n\n${insightList}`,
                  }],
                  details: { insights },
                };
              }

              case "get_insight": {
                const insightId = params.insight_id as string;
                if (!insightId) {
                  return {
                    content: [{ type: "text", text: "Error: insight_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.getInsight(insightId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get insight: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const insight = result.data!;
                const recommendations = insight.recommendations.map((r, i) => 
                  `${i + 1}. **${r.title}**\n   ${r.description}\n   Effort: ${r.effort} | Automatable: ${r.automatable ? 'Yes' : 'No'}`
                ).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `📊 **Insight Details**

**${insight.title}**
${insight.description}

**Category:** ${insight.category}
**Severity:** ${insight.severity}
**Status:** ${insight.status}
**Service:** ${insight.service}
**Detected:** ${insight.detectedAt.toISOString()}

**Affected Resources:** ${insight.affectedResources.length}
${insight.affectedResources.slice(0, 5).map(r => `• ${r.name} (${r.type})`).join('\n')}

**Recommendations:**
${recommendations}`,
                  }],
                  details: { insight },
                };
              }

              case "acknowledge_insight": {
                const insightId = params.insight_id as string;
                if (!insightId) {
                  return {
                    content: [{ type: "text", text: "Error: insight_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.acknowledgeInsight(insightId);
                return result.success
                  ? { content: [{ type: "text", text: `✅ Insight acknowledged` }], details: { acknowledged: true } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              case "dismiss_insight": {
                const insightId = params.insight_id as string;
                if (!insightId) {
                  return {
                    content: [{ type: "text", text: "Error: insight_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.dismissInsight(insightId);
                return result.success
                  ? { content: [{ type: "text", text: `✅ Insight dismissed` }], details: { dismissed: true } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              case "snooze_insight": {
                const insightId = params.insight_id as string;
                const snoozeUntil = params.snooze_until as string;
                if (!insightId || !snoozeUntil) {
                  return {
                    content: [{ type: "text", text: "Error: insight_id and snooze_until are required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.snoozeInsight(insightId, new Date(snoozeUntil));
                return result.success
                  ? { content: [{ type: "text", text: `✅ Insight snoozed until ${snoozeUntil}` }], details: { snoozed: true } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              case "resolve_insight": {
                const insightId = params.insight_id as string;
                if (!insightId) {
                  return {
                    content: [{ type: "text", text: "Error: insight_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.resolveInsight(insightId);
                return result.success
                  ? { content: [{ type: "text", text: `✅ Insight resolved` }], details: { resolved: true } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              case "run_insight_checks": {
                const checkIds = params.check_ids as string[] | undefined;
                const result = await conversationalManager.runInsightChecks(checkIds);
                
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to run checks: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const newInsights = result.data!;
                return {
                  content: [{
                    type: "text",
                    text: newInsights.length > 0
                      ? `🔍 **Insight Checks Complete**\n\nFound ${newInsights.length} new insight(s):\n${newInsights.map(i => `• ${i.severity.toUpperCase()}: ${i.title}`).join('\n')}`
                      : `✅ **Insight Checks Complete**\n\nNo new issues found.`,
                  }],
                  details: { newInsights },
                };
              }

              case "get_insight_checks": {
                const result = await conversationalManager.getInsightChecks();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get checks: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const checks = result.data!;
                const checkList = checks.map(c => 
                  `• **${c.name}** (${c.id})\n  Category: ${c.category} | Enabled: ${c.enabled ? '✓' : '✗'} | Interval: ${c.intervalMinutes}min`
                ).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `⚙️ **Insight Checks** (${checks.length})\n\n${checkList}`,
                  }],
                  details: { checks },
                };
              }

              case "update_insight_check": {
                const checkId = params.check_id as string;
                const enabled = params.check_enabled as boolean;
                if (!checkId || enabled === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: check_id and check_enabled are required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.updateInsightCheck(checkId, enabled);
                return result.success
                  ? { content: [{ type: "text", text: `✅ Check ${checkId} ${enabled ? 'enabled' : 'disabled'}` }], details: { updated: true } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              // ==================
              // Wizard Mode
              // ==================
              case "list_wizard_templates": {
                const result = await conversationalManager.getWizardTemplates();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get templates: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const templates = result.data!;
                const templateList = templates.map(t => 
                  `• **${t.name}** (\`${t.id}\`)\n  ${t.description}\n  Complexity: ${t.complexity} | Time: ~${t.estimatedTimeMinutes}min`
                ).join('\n\n');

                return {
                  content: [{
                    type: "text",
                    text: `🧙 **Available Wizard Templates** (${templates.length})\n\n${templateList}`,
                  }],
                  details: { templates },
                };
              }

              case "get_wizard_template": {
                const templateId = params.template_id as string;
                if (!templateId) {
                  return {
                    content: [{ type: "text", text: "Error: template_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.getWizardTemplate(templateId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get template: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const template = result.data!;
                const steps = template.stepDefinitions.map((s, i) => 
                  `${i + 1}. **${s.title}**: ${s.description}`
                ).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `🧙 **${template.name}**

${template.description}

**Category:** ${template.category}
**Complexity:** ${template.complexity}
**Estimated Time:** ~${template.estimatedTimeMinutes} minutes

**Steps:**
${steps}${template.prerequisites?.length ? `\n\n**Prerequisites:**\n${template.prerequisites.map(p => `• ${p}`).join('\n')}` : ''}`,
                  }],
                  details: { template },
                };
              }

              case "start_wizard": {
                const templateId = params.template_id as string;
                if (!templateId) {
                  return {
                    content: [{ type: "text", text: "Error: template_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.startWizard(templateId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to start wizard: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const state = result.data!;
                const currentStep = state.steps[state.currentStepIndex];
                const options = currentStep.options?.map((o, i) => 
                  `  ${i + 1}. **${o.label}**${o.recommended ? ' ⭐' : ''}${o.disabled ? ' (disabled)' : ''}\n     ${o.description || ''}`
                ).join('\n') || '';

                return {
                  content: [{
                    type: "text",
                    text: `🧙 **${state.title}** - Started!

**Wizard ID:** \`${state.wizardId}\`

---

**Step ${currentStep.stepNumber}/${currentStep.totalSteps}: ${currentStep.title}**

${currentStep.description}

${currentStep.type === 'choice' || currentStep.type === 'multi-select' ? `**Options:**\n${options}` : ''}
${currentStep.inputConfig ? `**Input Required:** ${currentStep.inputConfig.placeholder || 'Enter value'}` : ''}
${currentStep.helpText ? `\n💡 ${currentStep.helpText}` : ''}`,
                  }],
                  details: { state },
                };
              }

              case "get_wizard_state": {
                const wizardId = params.wizard_id as string;
                if (!wizardId) {
                  return {
                    content: [{ type: "text", text: "Error: wizard_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.getWizardState(wizardId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get wizard state: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const state = result.data!;
                const completedSteps = state.steps.filter(s => s.completed).length;
                const currentStep = state.steps[state.currentStepIndex];

                return {
                  content: [{
                    type: "text",
                    text: `🧙 **${state.title}**

**Status:** ${state.status}
**Progress:** ${completedSteps}/${state.steps.length} steps

**Current Step:** ${currentStep.title}
${currentStep.description}`,
                  }],
                  details: { state },
                };
              }

              case "answer_wizard_step": {
                const wizardId = params.wizard_id as string;
                const stepId = params.step_id as string;
                const value = params.step_value;
                if (!wizardId || !stepId || value === undefined) {
                  return {
                    content: [{ type: "text", text: "Error: wizard_id, step_id, and step_value are required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.answerWizardStep(wizardId, stepId, value);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to answer step: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const state = result.data!;
                const currentStep = state.steps[state.currentStepIndex];
                const options = currentStep.options?.map((o, i) => 
                  `  ${i + 1}. **${o.label}**${o.recommended ? ' ⭐' : ''}\n     ${o.description || ''}`
                ).join('\n') || '';

                return {
                  content: [{
                    type: "text",
                    text: `✅ Answer recorded!

---

**Step ${currentStep.stepNumber}/${currentStep.totalSteps}: ${currentStep.title}**

${currentStep.description}

${currentStep.type === 'choice' || currentStep.type === 'multi-select' ? `**Options:**\n${options}` : ''}
${currentStep.type === 'review' ? '📋 Review your configuration and generate the execution plan.' : ''}`,
                  }],
                  details: { state },
                };
              }

              case "go_back_wizard": {
                const wizardId = params.wizard_id as string;
                if (!wizardId) {
                  return {
                    content: [{ type: "text", text: "Error: wizard_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.goBackWizard(wizardId);
                return result.success
                  ? { content: [{ type: "text", text: `⬅️ Went back to step ${result.data!.currentStepIndex + 1}` }], details: { state: result.data } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              case "skip_wizard_step": {
                const wizardId = params.wizard_id as string;
                if (!wizardId) {
                  return {
                    content: [{ type: "text", text: "Error: wizard_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.skipWizardStep(wizardId);
                return result.success
                  ? { content: [{ type: "text", text: `⏭️ Skipped to step ${result.data!.currentStepIndex + 1}` }], details: { state: result.data } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              case "cancel_wizard": {
                const wizardId = params.wizard_id as string;
                if (!wizardId) {
                  return {
                    content: [{ type: "text", text: "Error: wizard_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }
                const result = await conversationalManager.cancelWizard(wizardId);
                return result.success
                  ? { content: [{ type: "text", text: `❌ Wizard cancelled` }], details: { cancelled: true } }
                  : { content: [{ type: "text", text: `Failed: ${result.error}` }], details: { error: result.error } };
              }

              case "generate_wizard_plan": {
                const wizardId = params.wizard_id as string;
                if (!wizardId) {
                  return {
                    content: [{ type: "text", text: "Error: wizard_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.generateWizardPlan(wizardId);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to generate plan: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const plan = result.data!;
                const resources = plan.resourcesToCreate.map(r => 
                  `• **${r.name}** (${r.type})${r.estimatedMonthlyCost ? ` - ~$${r.estimatedMonthlyCost}/mo` : ''}`
                ).join('\n');

                return {
                  content: [{
                    type: "text",
                    text: `📋 **Execution Plan Generated**

**Resources to Create:** ${plan.resourcesToCreate.length}
${resources}

**Estimated Monthly Cost:** $${plan.estimatedMonthlyCost?.toFixed(2) || 'N/A'}
**Estimated Setup Time:** ~${plan.estimatedSetupTimeMinutes} minutes

${plan.warnings?.length ? `⚠️ **Warnings:**\n${plan.warnings.map(w => `• ${w}`).join('\n')}` : ''}

Ready to execute? Use \`execute_wizard\` with \`dry_run: true\` to validate first.`,
                  }],
                  details: { plan },
                };
              }

              case "execute_wizard": {
                const wizardId = params.wizard_id as string;
                const dryRun = params.dry_run as boolean ?? false;
                if (!wizardId) {
                  return {
                    content: [{ type: "text", text: "Error: wizard_id is required" }],
                    details: { error: "missing_required_params" },
                  };
                }

                const result = await conversationalManager.executeWizard(wizardId, dryRun);
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to execute wizard: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const state = result.data!;
                if (dryRun) {
                  return {
                    content: [{
                      type: "text",
                      text: `🧪 **Dry Run Complete**\n\nValidation passed. Use \`execute_wizard\` without \`dry_run\` to create resources.`,
                    }],
                    details: { state, dryRun: true },
                  };
                }

                return {
                  content: [{
                    type: "text",
                    text: `🎉 **Wizard Complete!**

**Status:** ${state.status}
**Resources Created:** ${state.createdResources?.length || 0}

${state.createdResources?.map(r => `• ${r.name} (${r.id})`).join('\n') || 'No resources created'}`,
                  }],
                  details: { state },
                };
              }

              // ==================
              // Summary & Reporting
              // ==================
              case "get_infrastructure_summary": {
                const result = await conversationalManager.getInfrastructureSummary();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get summary: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const summary = result.data!;
                const healthEmoji = summary.overallHealth === 'healthy' ? '🟢' : summary.overallHealth === 'warning' ? '🟡' : '🔴';
                
                const regionBreakdown = Object.entries(summary.resourcesByRegion)
                  .map(([region, count]) => `• ${region}: ${count}`)
                  .join('\n') || 'No data';

                const typeBreakdown = Object.entries(summary.resourceCounts)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .slice(0, 10)
                  .map(([type, count]) => `• ${type}: ${count}`)
                  .join('\n') || 'No data';

                return {
                  content: [{
                    type: "text",
                    text: `📊 **Infrastructure Summary**

${healthEmoji} **Overall Health:** ${summary.overallHealth.toUpperCase()}
⏰ **Last Updated:** ${summary.lastUpdated.toISOString()}

🚨 **Active Alarms:** ${summary.activeAlarms}
💡 **Pending Insights:** ${summary.pendingInsights}

**Resources by Region:**
${regionBreakdown}

**Top Resource Types:**
${typeBreakdown}`,
                  }],
                  details: { summary },
                };
              }

              case "get_session_summary": {
                const result = await conversationalManager.getSessionSummary();
                if (!result.success) {
                  return {
                    content: [{ type: "text", text: `Failed to get session summary: ${result.error}` }],
                    details: { error: result.error },
                  };
                }

                const summary = result.data!;
                const serviceBreakdown = Object.entries(summary.operationsByService)
                  .map(([service, count]) => `• ${service}: ${count}`)
                  .join('\n') || 'No operations';

                const topResources = summary.topResources
                  .map(r => `• ${r.name} (${r.accessCount} accesses)`)
                  .join('\n') || 'No resources accessed';

                return {
                  content: [{
                    type: "text",
                    text: `📈 **Session Summary**

**Duration:** ${summary.durationMinutes} minutes
**Operations:** ${summary.operationCount}
**Success Rate:** ${summary.successRate.toFixed(1)}%
**Resources Accessed:** ${summary.resourcesAccessed}

**Operations by Service:**
${serviceBreakdown}

**Top Accessed Resources:**
${topResources}`,
                  }],
                  details: { summary },
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
              content: [{ type: "text", text: `Assistant error: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "aws_assistant" },
    );

    // Register service — manager init happens in start() (async-safe)
    api.registerService({
      id: "aws-core-services",
      async start() {
        const log = pluginLogger ?? { info: console.log, warn: console.warn, error: console.error };
        log.info("[AWS] Initializing AWS managers");

        // Initialize all managers during service start (async lifecycle)
        credentialsManager = createCredentialsManager({
          defaultProfile: config.defaultProfile,
          defaultRegion: config.defaultRegion,
        });

        cliWrapper = createCLIWrapper({
          defaultOptions: {
            profile: config.defaultProfile,
            region: config.defaultRegion,
          },
        });

        contextManager = createContextManager(credentialsManager);
        serviceDiscovery = createServiceDiscovery(credentialsManager);

        const tagConfigConverted = config.tagConfig ? {
          required: (config.tagConfig.requiredTags ?? []).map((k: string) => ({ key: k, value: "" })),
          optional: (config.tagConfig.optionalTags ?? []).map((k: string) => ({ key: k, value: "" })),
          prohibited: [] as string[],
        } : undefined;

        const defaultTagsConverted = config.defaultTags?.map((t: { key: string; value: string }) => ({
          key: t.key,
          value: t.value,
        }));

        taggingManager = createTaggingManager(
          credentialsManager,
          tagConfigConverted,
          defaultTagsConverted,
        );

        cloudTrailManager = createCloudTrailManager(
          credentialsManager,
          config.defaultRegion,
        );

        ec2Manager = createEC2Manager(
          credentialsManager,
          config.defaultRegion,
        );

        rdsManager = createRDSManager({ region: config.defaultRegion });
        lambdaManager = createLambdaManager({ region: config.defaultRegion });
        s3Manager = createS3Manager({ region: config.defaultRegion });
        cicdManager = createCICDManager({ defaultRegion: config.defaultRegion });
        networkManager = createNetworkManager({
          defaultRegion: config.defaultRegion,
          defaultTags: config.defaultTags?.reduce(
            (acc: Record<string, string>, t: { key: string; value: string }) => ({ ...acc, [t.key]: t.value }),
            {},
          ),
        });

        iacManager = createIaCManager({
          defaultRegion: config.defaultRegion,
          defaultTags: config.defaultTags?.reduce(
            (acc: Record<string, string>, t: { key: string; value: string }) => ({ ...acc, [t.key]: t.value }),
            {},
          ),
        });

        costManager = createCostManager({ defaultRegion: config.defaultRegion });

        // Optionally probe identity on start
        try {
          await contextManager.initialize();
        } catch {
          // Ignore - credentials may not be available at start
        }

        log.info("[AWS] AWS Core Services started");
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
        cicdManager = null;
        networkManager = null;
        iacManager = null;
        costManager = null;
        securityManager = null;
        guardrailsManager = null;
        organizationManager = null;
        backupManager = null;
        conversationalManager = null;
        cliWrapper = null;
        pluginLogger?.info("[AWS] AWS Core Services stopped");
      },
    });

    api.logger.info("[AWS] AWS extension registered successfully");
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
    cicd: cicdManager,
    network: networkManager,
    iac: iacManager,
    cost: costManager,
    security: securityManager,
    guardrails: guardrailsManager,
    organization: organizationManager,
    backup: backupManager,
    conversational: conversationalManager,
    cli: cliWrapper,
  };
}
