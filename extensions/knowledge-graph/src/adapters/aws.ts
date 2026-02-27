/**
 * Infrastructure Knowledge Graph — AWS Adapter
 *
 * Maps AWS resource API responses into the universal graph model.
 * Discovers resources via the AWS SDK, extracts relationships using
 * rule-based field mappings, and supports multi-region + cross-account
 * discovery through standard credential chains.
 *
 * Deep integration with `@espada/aws` extension:
 * - **CredentialsManager** — Unified credential resolution (env, profile,
 *   SSO, instance metadata, assumed roles) replaces manual fromIni/STS code.
 * - **ClientPoolManager** — Connection pooling with LRU eviction and TTL
 *   replaces per-call client creation for supported services.
 * - **ServiceDiscovery** — Region enumeration replaces manual EC2
 *   DescribeRegions calls.
 * - **CostManager** — Cost Explorer queries, forecasting, optimization
 *   recommendations, and unused resource detection.
 * - **CloudTrailManager** — Incremental sync via infrastructure change events.
 * - **SecurityManager** — Security posture enrichment for discovered nodes.
 * - Static pricing tables remain as fallback when CE is unavailable.
 *
 * All @espada/aws managers are lazy-loaded at runtime — the adapter works
 * standalone (with direct AWS SDK dynamic imports) when the extension
 * package is unavailable. When `clientFactory` is provided (tests),
 * all manager delegation is bypassed.
 *
 * Module decomposition:
 *   aws/types.ts      — Type definitions
 *   aws/constants.ts  — Static data (rules, mappings, cost tables)
 *   aws/utils.ts      — Utility functions (field resolution, ID extraction)
 */

import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  CloudProvider,
} from "../types.js";
import type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

// Re-export types from decomposed modules for backward compatibility
export type {
  AwsRelationshipRule,
  AwsServiceMapping,
  AwsAdapterConfig,
  AwsManagerOverrides,
  AwsClientFactory,
  AwsClient,
  AwsForecastResult,
  AwsOptimizationResult,
  AwsUnusedResourcesResult,
  AwsChangeEvent,
  AwsIncrementalChanges,
  AwsSecurityPosture,
} from "./aws/types.js";

// Import types for internal use
import type {
  AwsServiceMapping,
  AwsAdapterConfig,
  AwsClient,
  AwsForecastResult,
  AwsOptimizationResult,
  AwsUnusedResourcesResult,
  AwsIncrementalChanges,
  AwsSecurityPosture,
} from "./aws/types.js";

// Re-export constants from decomposed modules
export {
  AWS_RELATIONSHIP_RULES,
  AWS_SERVICE_MAPPINGS,
  EC2_COSTS,
  RDS_COSTS,
  ELASTICACHE_COSTS_AWS,
  STORAGE_COSTS,
  AWS_SERVICE_TO_RESOURCE_TYPE,
  DEFAULT_REGIONS,
  AWS_SERVICE_TO_POOL_NAME,
  AWS_SDK_PACKAGES,
  GPU_INSTANCE_REGEX,
  AI_SERVICE_PREFIXES,
} from "./aws/constants.js";

// Import constants for internal use
import {
  AWS_RELATIONSHIP_RULES,
  AWS_SERVICE_MAPPINGS,
  EC2_COSTS,
  RDS_COSTS,
  ELASTICACHE_COSTS_AWS,
  STORAGE_COSTS,
  AWS_SERVICE_TO_RESOURCE_TYPE,
  DEFAULT_REGIONS,
  AWS_SERVICE_TO_POOL_NAME,
  AWS_SDK_PACKAGES,
  GPU_INSTANCE_REGEX,
  AI_SERVICE_PREFIXES,
} from "./aws/constants.js";

// Re-export utilities from decomposed modules
export {
  resolveFieldPathRaw,
  resolveFieldPath,
  extractResourceId,
  buildAwsNodeId,
} from "./aws/utils.js";

// Import utilities for internal use
import {
  resolveFieldPathRaw,
  resolveFieldPath,
  extractResourceId,
  reverseRelationship,
  buildAwsNodeId,
} from "./aws/utils.js";

// Domain module functions — extracted from this monolith for maintainability.
// Each module receives an AwsAdapterContext and operates on nodes/edges arrays.
import * as computeModule from "./aws/compute.js";
import * as databaseModule from "./aws/database.js";
import * as organizationModule from "./aws/organization.js";
import * as backupModule from "./aws/backup.js";
import * as automationModule from "./aws/automation.js";
import * as cicdModule from "./aws/cicd.js";
import * as cognitoModule from "./aws/cognito.js";
import * as enrichmentModule from "./aws/enrichment.js";
import * as costModule from "./aws/cost.js";
import * as securityModule from "./aws/security.js";
import type { AwsAdapterContext } from "./aws/context.js";

/**
 * AWS Discovery Adapter.
 *
 * Discovers AWS resources and their relationships. Uses AWS_RELATIONSHIP_RULES
 * to infer edges from API response fields. Supports:
 *
 * - Standard AWS credential chain (env vars, ~/.aws/credentials, IAM role, SSO)
 * - Cross-account discovery via STS AssumeRole
 * - Multi-region parallel discovery
 * - GPU/AI workload detection and tagging
 * - Dynamic AWS SDK loading (optional dependency)
 */
export class AwsDiscoveryAdapter implements GraphDiscoveryAdapter {
  readonly provider: CloudProvider = "aws";
  readonly displayName = "Amazon Web Services";

  private config: AwsAdapterConfig;
  /**
   * Cached credentials from AssumeRole (if cross-account is configured).
   * Null means "use default credential chain".
   */
  private assumedCredentials: unknown | null = null;
  private sdkAvailable: boolean | null = null;

  // ---- @espada/aws lazy-loaded manager instances ----
  // `undefined` = not yet initialized. `null` = unavailable.
  private _credentialsManager: unknown | undefined = undefined;
  private _clientPoolManager: unknown | undefined = undefined;
  private _discoveryManager: unknown | undefined = undefined;
  private _costManager: unknown | undefined = undefined;
  private _cloudTrailManager: unknown | undefined = undefined;
  private _securityManager: unknown | undefined = undefined;
  private _taggingManager: unknown | undefined = undefined;
  private _lambdaManager: unknown | undefined = undefined;
  private _observabilityManager: unknown | undefined = undefined;
  private _s3Manager: unknown | undefined = undefined;
  private _elastiCacheManager: unknown | undefined = undefined;
  private _organizationManager: unknown | undefined = undefined;
  private _backupManager: unknown | undefined = undefined;
  private _complianceManager: unknown | undefined = undefined;
  private _automationManager: unknown | undefined = undefined;
  private _ec2Manager: unknown | undefined = undefined;
  private _rdsManager: unknown | undefined = undefined;
  private _cicdManager: unknown | undefined = undefined;
  private _cognitoManager: unknown | undefined = undefined;

  constructor(config: AwsAdapterConfig) {
    this.config = config;
  }

  supportedResourceTypes(): GraphResourceType[] {
    return AWS_SERVICE_MAPPINGS.map((m) => m.graphType);
  }

  /**
   * Discover all AWS resources and relationships.
   *
   * For each service mapping:
   *   1. Create an SDK client for the region
   *   2. Call the list/describe method
   *   3. Extract nodes from the response
   *   4. Apply AWS_RELATIONSHIP_RULES to infer edges
   */
  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startMs = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: DiscoveryError[] = [];

    // Ensure SDK is available
    if (!(await this.ensureSdkAvailable())) {
      return {
        provider: "aws",
        nodes: [],
        edges: [],
        errors: [{
          resourceType: "custom",
          message: "AWS SDK (@aws-sdk/client-ec2, etc.) is not installed. Install AWS SDK v3 packages to enable live discovery.",
        }],
        durationMs: Date.now() - startMs,
      };
    }

    // Resolve credentials for cross-account if needed
    if (this.config.assumeRoleArn && !this.assumedCredentials) {
      try {
        this.assumedCredentials = await this.resolveAssumeRole(this.config.assumeRoleArn, this.config.externalId);
      } catch (error) {
        return {
          provider: "aws",
          nodes: [],
          edges: [],
          errors: [{
            resourceType: "custom",
            message: `Failed to assume role ${this.config.assumeRoleArn}: ${error instanceof Error ? error.message : String(error)}`,
          }],
          durationMs: Date.now() - startMs,
        };
      }
    }

    // Filter service mappings by requested resource types
    const mappings = options?.resourceTypes
      ? AWS_SERVICE_MAPPINGS.filter((m) => options.resourceTypes!.includes(m.graphType))
      : AWS_SERVICE_MAPPINGS;

    // Determine target regions (ServiceDiscovery → EC2 fallback → defaults)
    const regions = options?.regions ?? this.config.regions ?? await this.resolveRegions();

    for (const region of regions) {
      for (const mapping of mappings) {
        if (!mapping.regional && region !== regions[0]) continue; // Global resources: discover once

        // Respect abort signal
        if (options?.signal?.aborted) break;

        try {
          const { discoveredNodes, discoveredEdges } = await this.discoverService(
            mapping,
            region,
            options,
          );
          nodes.push(...discoveredNodes);
          edges.push(...discoveredEdges);
        } catch (error) {
          errors.push({
            resourceType: mapping.graphType,
            region,
            message: error instanceof Error ? error.message : String(error),
            code: (error as { code?: string })?.code,
          });
        }
      }
    }

    // Enrich nodes with real cost data from AWS Cost Explorer.
    // Falls back to static pricing tables when CE is unavailable.
    const enableCE = this.config.enableCostExplorer !== false;
    if (enableCE && nodes.length > 0) {
      try {
        await this.enrichWithCostExplorer(nodes, errors);
      } catch {
        // Cost enrichment is best-effort; don't fail the whole discovery
      }
    }

    // Static fallback: fill in any nodes still missing cost estimates
    for (const node of nodes) {
      if (node.costMonthly == null) {
        const fallback = this.estimateCostStatic(node.resourceType, node.metadata);
        if (fallback != null) {
          node.costMonthly = fallback;
          node.metadata["costSource"] = "static-estimate";
        }
      }
    }

    // Enrich nodes with tags from TaggingManager (@espada/aws).
    // Fills in missing tags, owner, and adds tag-based metadata.
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.enrichWithTags(nodes);
      } catch {
        // Tag enrichment is best-effort
      }
    }

    // Enrich with event-driven edges (Lambda event source mappings, SNS subscriptions, SQS DLQ).
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.enrichWithEventSources(nodes, edges);
      } catch {
        // Event source enrichment is best-effort
      }
    }

    // Enrich with observability data (X-Ray service map edges, alarm metadata).
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.enrichWithObservability(nodes, edges);
      } catch {
        // Observability enrichment is best-effort
      }
    }

    // Enrich with deeper service-specific metadata (S3, containers).
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.enrichWithDeeperDiscovery(nodes, edges);
      } catch {
        // Deeper discovery enrichment is best-effort
      }
    }

    // Discover ElastiCache resources via ElastiCacheManager (@espada/aws).
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.discoverElastiCache(nodes, edges);
      } catch {
        // ElastiCache discovery is best-effort
      }
    }

    // Discover Organization structure (accounts, OUs, SCPs) via OrganizationManager.
    if (!this.config.clientFactory) {
      try {
        await this.discoverOrganization(nodes, edges);
      } catch {
        // Organization discovery is best-effort
      }
    }

    // Discover Backup plans, vaults, and protected resources via BackupManager.
    if (!this.config.clientFactory) {
      try {
        await this.discoverBackupResources(nodes, edges);
      } catch {
        // Backup discovery is best-effort
      }
    }

    // Enrich nodes with compliance posture from ComplianceManager.
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.enrichWithCompliance(nodes);
      } catch {
        // Compliance enrichment is best-effort
      }
    }

    // Discover Automation resources (EventBridge rules, Step Functions).
    if (!this.config.clientFactory) {
      try {
        await this.discoverAutomation(nodes, edges);
      } catch {
        // Automation discovery is best-effort
      }
    }

    // Discover deeper EC2 resources (ASGs, LBs, target groups) via EC2Manager.
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.discoverEC2Deeper(nodes, edges);
      } catch {
        // EC2 deeper discovery is best-effort
      }
    }

    // Discover deeper RDS resources (read replicas, snapshots, parameter groups) via RDSManager.
    if (!this.config.clientFactory && nodes.length > 0) {
      try {
        await this.discoverRDSDeeper(nodes, edges);
      } catch {
        // RDS deeper discovery is best-effort
      }
    }

    // Discover CI/CD pipelines, build projects, and deploy apps via CICDManager.
    if (!this.config.clientFactory) {
      try {
        await this.discoverCICD(nodes, edges);
      } catch {
        // CI/CD discovery is best-effort
      }
    }

    // Discover Cognito user pools, identity pools, and app clients via CognitoManager.
    if (!this.config.clientFactory) {
      try {
        await this.discoverCognito(nodes, edges);
      } catch {
        // Cognito discovery is best-effort
      }
    }

    // Apply limit
    const limitedNodes = options?.limit ? nodes.slice(0, options.limit) : nodes;

    return {
      provider: "aws",
      nodes: limitedNodes,
      edges,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Discover a single AWS service in a single region.
   *
   * Creates an SDK client, calls the list method, extracts nodes and edges.
   */
  private async discoverService(
    mapping: AwsServiceMapping,
    region: string,
    _options?: DiscoverOptions,
  ): Promise<{ discoveredNodes: GraphNodeInput[]; discoveredEdges: GraphEdgeInput[] }> {
    const discoveredNodes: GraphNodeInput[] = [];
    const discoveredEdges: GraphEdgeInput[] = [];

    const client = await this.createClient(mapping.awsService, region);
    if (!client) {
      return { discoveredNodes, discoveredEdges };
    }

    try {
      // Build and send the list/describe command
      const command = await this.buildCommand(mapping.awsService, mapping.listMethod);
      if (!command) {
        return { discoveredNodes, discoveredEdges };
      }

      const response = await client.send(command) as Record<string, unknown>;

      // Extract raw resource items from the response
      const items = this.extractResponseItems(response, mapping.responseKey);

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const rawItem = item as Record<string, unknown>;

        // Extract resource identifiers
        const nativeId = this.extractField(rawItem, mapping.idField);
        if (!nativeId) continue;

        const name = this.extractField(rawItem, mapping.nameField) ?? nativeId;
        const arn = this.extractField(rawItem, mapping.arnField);

        // Detect GPU/AI workload
        const instanceType = (rawItem["InstanceType"] ?? rawItem["instanceType"]) as string | undefined;
        const isGpu = instanceType ? GPU_INSTANCE_REGEX.test(instanceType) : false;
        const isAiService = arn ? AI_SERVICE_PREFIXES.some((p) => arn.includes(`:${p}:`)) : false;

        // Extract tags from AWS Tag format: [{Key, Value}] or {key: value}
        const tags = this.extractAwsTags(rawItem);

        const nodeId = buildAwsNodeId(this.config.accountId, region, mapping.graphType, nativeId);

        const node: GraphNodeInput = {
          id: nodeId,
          provider: "aws",
          resourceType: mapping.graphType,
          nativeId,
          name: tags["Name"] ?? name,
          region: mapping.regional ? region : "global",
          account: this.config.accountId,
          status: this.inferStatus(rawItem),
          tags,
          metadata: {
            ...this.extractServiceMetadata(mapping.graphType, rawItem),
            ...(isGpu ? { isGpuInstance: true, aiWorkload: true } : {}),
            ...(isAiService ? { aiWorkload: true } : {}),
          },
          costMonthly: this.estimateCost(mapping.graphType, rawItem),
          owner: tags["Owner"] ?? tags["owner"] ?? tags["Team"] ?? tags["team"] ?? null,
          createdAt: (rawItem["LaunchTime"] ?? rawItem["CreatedTime"] ?? rawItem["CreationDate"] ?? rawItem["CreateDate"]) as string | null,
        };

        discoveredNodes.push(node);

        // Extract relationship edges
        const nodeEdges = this.extractRelationships(
          nodeId,
          mapping.graphType,
          rawItem,
          this.config.accountId,
          region,
        );
        discoveredEdges.push(...nodeEdges);
      }
    } finally {
      client.destroy?.();
    }

    return { discoveredNodes, discoveredEdges };
  }

  /**
   * Apply relationship rules to extract edges from a raw API response.
   *
   * Uses AWS_RELATIONSHIP_RULES to map source resource fields to graph edges.
   */
  extractRelationships(
    sourceNodeId: string,
    sourceType: GraphResourceType,
    rawResponse: Record<string, unknown>,
    accountId: string,
    region: string,
  ): GraphEdgeInput[] {
    const edges: GraphEdgeInput[] = [];
    const rules = AWS_RELATIONSHIP_RULES.filter((r) => r.sourceType === sourceType);

    for (const rule of rules) {
      const values = resolveFieldPath(rawResponse, rule.field);
      if (!values || values.length === 0) continue;

      for (const value of values) {
        if (!value) continue;
        const targetNativeId = extractResourceId(String(value));
        const targetNodeId = buildAwsNodeId(accountId, region, rule.targetType, targetNativeId);
        const edgeId = `${sourceNodeId}--${rule.relationship}--${targetNodeId}`;

        edges.push({
          id: edgeId,
          sourceNodeId,
          targetNodeId,
          relationshipType: rule.relationship,
          confidence: 0.95, // API-derived relationships are high confidence
          discoveredVia: "api-field",
          metadata: { field: rule.field },
        });

        if (rule.bidirectional) {
          const reverseRelation = reverseRelationship(rule.relationship);
          edges.push({
            id: `${targetNodeId}--${reverseRelation}--${sourceNodeId}`,
            sourceNodeId: targetNodeId,
            targetNodeId: sourceNodeId,
            relationshipType: reverseRelation,
            confidence: 0.95,
            discoveredVia: "api-field",
            metadata: { field: rule.field, inferred: true },
          });
        }
      }
    }

    return edges;
  }

  supportsIncrementalSync(): boolean {
    // Incremental sync is supported via CloudTrail when @espada/aws is available.
    // The adapter checks at runtime via getIncrementalChanges().
    return !this.config.clientFactory;
  }

  /**
   * Verify AWS credentials by calling STS GetCallerIdentity.
   * Delegates to CredentialsManager when available, falls back to direct STS.
   */
  async healthCheck(): Promise<boolean> {
    // Try CredentialsManager first (richer, validates + caches)
    if (!this.config.clientFactory) {
      const cm = await this.getCredentialsManager();
      if (cm) {
        try {
          const result = await (cm as { healthCheck: (p?: string) => Promise<{ ok: boolean }> }).healthCheck(this.config.profile);
          return result.ok;
        } catch {
          // Fall through to direct STS
        }
      }
    }

    // Direct STS fallback
    try {
      const client = await this.createClient("STS", "us-east-1");
      if (!client) return false;

      try {
        const command = await this.buildCommand("STS", "getCallerIdentity");
        if (!command) return false;

        const response = await client.send(command) as Record<string, unknown>;
        return typeof response["Account"] === "string";
      } finally {
        client.destroy?.();
      }
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // AWS SDK Dynamic Loading
  // ===========================================================================

  /**
   * Check if the AWS SDK v3 is available.
   * Uses dynamic import to avoid hard dependency.
   */
  private async ensureSdkAvailable(): Promise<boolean> {
    if (this.config.clientFactory) {
      this.sdkAvailable = true;
      return true;
    }

    if (this.sdkAvailable !== null) return this.sdkAvailable;

    try {
      await import("@aws-sdk/client-sts");
      this.sdkAvailable = true;
    } catch {
      this.sdkAvailable = false;
    }

    return this.sdkAvailable;
  }

  /**
   * Create an AWS SDK client for the given service and region.
   *
   * Resolution order:
   * 1. `clientFactory` (test injection) — bypasses everything.
   * 2. `AWSClientPoolManager` from @espada/aws — connection pooling + TTL.
   * 3. Direct dynamic import fallback — per-call client creation.
   */
  private async createClient(service: string, region: string): Promise<AwsClient | null> {
    const credentials = this.assumedCredentials ?? undefined;

    // 1. Test injection
    if (this.config.clientFactory) {
      return this.config.clientFactory(service, region, { credentials });
    }

    // 2. Try ClientPoolManager for supported services
    const poolServiceName = AWS_SERVICE_TO_POOL_NAME[service];
    if (poolServiceName) {
      const pool = await this.getClientPoolManager();
      if (pool) {
        try {
          const creds = await this.resolveCredentials();
          if (creds) {
            const poolClient = await (pool as {
              getClient: <T>(s: string, r: string, c: unknown, p?: string) => Promise<T>;
            }).getClient(poolServiceName, region, creds, this.config.profile);
            // Pool-managed clients should NOT be destroyed by the caller
            return { send: (cmd: unknown) => (poolClient as { send: (c: unknown) => Promise<unknown> }).send(cmd) };
          }
        } catch {
          // Fall through to manual creation
        }
      }
    }

    // 3. Direct dynamic import fallback
    try {
      const clientConfig: Record<string, unknown> = { region };
      if (this.config.profile) {
        const { fromIni } = await import("@aws-sdk/credential-provider-ini");
        clientConfig["credentials"] = fromIni({ profile: this.config.profile });
      }
      if (credentials) {
        clientConfig["credentials"] = credentials;
      }

      const packageName = AWS_SDK_PACKAGES[service];
      if (!packageName) return null;

      const module = await import(packageName);

      // SDK v3 client class name follows pattern: {Service}Client
      const clientClassName = `${service}Client`;
      const ClientClass = module[clientClassName];
      if (!ClientClass) return null;

      return new ClientClass(clientConfig) as AwsClient;
    } catch {
      return null;
    }
  }

  /**
   * Build a command object for the given service method.
   * SDK v3 uses command classes like DescribeInstancesCommand.
   */
  private async buildCommand(service: string, method: string): Promise<unknown | null> {
    if (this.config.clientFactory) {
      // With a custom factory, return the method name as the "command"
      // The factory's client.send() is responsible for interpreting it.
      return { __method: method };
    }

    try {
      const packageName = AWS_SDK_PACKAGES[service];
      if (!packageName) return null;

      const module = await import(packageName);

      // Convert camelCase method to PascalCase command class
      // e.g. "describeInstances" → "DescribeInstancesCommand"
      const commandName = method.charAt(0).toUpperCase() + method.slice(1) + "Command";
      const CommandClass = module[commandName];
      if (!CommandClass) return null;

      return new CommandClass({});
    } catch {
      return null;
    }
  }

  /**
   * Assume an IAM role for cross-account discovery.
   * Delegates to CredentialsManager when available, falls back to direct STS.
   */
  private async resolveAssumeRole(roleArn: string, externalId?: string): Promise<unknown> {
    // Try CredentialsManager first
    if (!this.config.clientFactory) {
      const cm = await this.getCredentialsManager();
      if (cm) {
        try {
          const creds = await (cm as {
            assumeRole: (arn: string, opts?: Record<string, unknown>) => Promise<unknown>;
          }).assumeRole(roleArn, {
            sessionName: `espada-kg-discovery-${Date.now()}`,
            duration: 3600,
            ...(externalId ? { externalId } : {}),
          });
          return creds;
        } catch {
          // Fall through to direct STS
        }
      }
    }

    // Direct STS fallback
    const client = await this.createClient("STS", "us-east-1");
    if (!client) {
      throw new Error("STS client unavailable — cannot assume role");
    }

    try {
      const params = {
        RoleArn: roleArn,
        RoleSessionName: `espada-kg-discovery-${Date.now()}`,
        DurationSeconds: 3600,
        ...(externalId ? { ExternalId: externalId } : {}),
      };

      const module = await import("@aws-sdk/client-sts");
      const command = new module.AssumeRoleCommand(params);
      const response = await client.send(command) as Record<string, unknown>;
      const creds = response["Credentials"] as Record<string, unknown>;

      if (!creds) throw new Error("AssumeRole response missing Credentials");

      return {
        accessKeyId: creds["AccessKeyId"],
        secretAccessKey: creds["SecretAccessKey"],
        sessionToken: creds["SessionToken"],
        expiration: creds["Expiration"],
      };
    } finally {
      client.destroy?.();
    }
  }

  /**
   * Resolve current credentials via CredentialsManager.
   * Returns null if the manager is unavailable.
   */
  private async resolveCredentials(): Promise<unknown | null> {
    if (this.assumedCredentials) return this.assumedCredentials;

    const cm = await this.getCredentialsManager();
    if (!cm) return null;

    try {
      const result = await (cm as {
        getCredentials: (profile?: string) => Promise<{ credentials: unknown }>;
      }).getCredentials(this.config.profile);
      return result.credentials;
    } catch {
      return null;
    }
  }

  /**
   * Get list of enabled regions for the account.
   *
   * Resolution order:
   * 1. ServiceDiscovery from @espada/aws (cached, comprehensive).
   * 2. Direct EC2 DescribeRegions call.
   * 3. Hardcoded defaults.
   */
  private async resolveRegions(): Promise<string[]> {
    // 1. Try ServiceDiscovery
    if (!this.config.clientFactory) {
      const sd = await this.getServiceDiscovery();
      if (sd) {
        try {
          const regions = await (sd as {
            discoverRegions: () => Promise<Array<{ regionName: string; available: boolean }>>;
          }).discoverRegions();
          const enabled = regions.filter((r) => r.available).map((r) => r.regionName);
          if (enabled.length > 0) return enabled;
        } catch {
          // Fall through
        }
      }
    }

    // 2. Direct EC2 DescribeRegions fallback
    try {
      const client = await this.createClient("EC2", "us-east-1");
      if (!client) return DEFAULT_REGIONS;

      try {
        const command = await this.buildCommand("EC2", "describeRegions");
        if (!command) return DEFAULT_REGIONS;

        const response = await client.send(command) as Record<string, unknown>;
        const regions = response["Regions"] as Array<Record<string, unknown>> | undefined;
        if (regions && regions.length > 0) {
          return regions
            .filter((r) => r["OptInStatus"] !== "not-opted-in")
            .map((r) => r["RegionName"] as string)
            .filter(Boolean);
        }
      } finally {
        client.destroy?.();
      }
    } catch {
      // Fall through to defaults
    }

    return DEFAULT_REGIONS;
  }

  // ===========================================================================
  // Response Parsing Helpers
  // ===========================================================================

  /**
   * Extract items from an API response using a dot/bracket path.
   * Handles nested paths like "Reservations[].Instances[]".
   */
  private extractResponseItems(response: Record<string, unknown>, responseKey: string): unknown[] {
    return resolveFieldPathRaw(response, responseKey).flat();
  }

  /**
   * Extract a single field value from a raw item.
   * Handles dot paths and Tag lookups like "Tags[Name]".
   */
  private extractField(item: Record<string, unknown>, field: string): string | null {
    // Direct field
    if (!field.includes("[") && !field.includes(".")) {
      const value = item[field];
      return typeof value === "string" ? value : null;
    }

    // Use field path resolver
    const values = resolveFieldPath(item, field);
    return values[0] ?? null;
  }

  /**
   * Extract tags from AWS SDK response format.
   * AWS uses [{Key, Value}] arrays; some services use flat {key: value}.
   */
  private extractAwsTags(item: Record<string, unknown>): Record<string, string> {
    const tags: Record<string, string> = {};

    // [{Key, Value}] format (most services)
    const tagArray = item["Tags"] ?? item["tags"] ?? item["TagList"];
    if (Array.isArray(tagArray)) {
      for (const tag of tagArray) {
        if (tag && typeof tag === "object") {
          const key = (tag as Record<string, unknown>)["Key"] ?? (tag as Record<string, unknown>)["key"];
          const value = (tag as Record<string, unknown>)["Value"] ?? (tag as Record<string, unknown>)["value"];
          if (typeof key === "string" && typeof value === "string") {
            tags[key] = value;
          }
        }
      }
    }

    // Flat {key: value} format (some services)
    const flatTags = item["TagSet"] ?? item["tags"];
    if (flatTags && typeof flatTags === "object" && !Array.isArray(flatTags)) {
      for (const [k, v] of Object.entries(flatTags as Record<string, unknown>)) {
        if (typeof v === "string") tags[k] = v;
      }
    }

    return tags;
  }

  /**
   * Infer resource status from raw API response.
   */
  private inferStatus(item: Record<string, unknown>): GraphNodeInput["status"] {
    const stateField =
      (item["State"] as Record<string, unknown>)?.["Name"] ??
      item["Status"] ??
      item["State"] ??
      item["DBInstanceStatus"] ??
      item["HealthStatus"];

    if (typeof stateField === "string") {
      const s = stateField.toLowerCase();
      if (s === "running" || s === "available" || s === "active" || s === "in-service" || s === "enabled") return "running";
      if (s === "stopped" || s === "inactive") return "stopped";
      if (s === "pending" || s === "starting" || s === "creating" || s === "modifying") return "pending";
      if (s === "terminating" || s === "shutting-down" || s === "deleting") return "deleting";
      if (s === "terminated" || s === "deleted") return "deleted";
      if (s === "error" || s === "failed" || s === "unhealthy") return "error";
    }

    return "running";
  }

  /**
   * Extract service-specific metadata from raw API response.
   */
  private extractServiceMetadata(resourceType: GraphResourceType, item: Record<string, unknown>): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    switch (resourceType) {
      case "compute": {
        const instanceType = item["InstanceType"] as string;
        if (instanceType) {
          meta["instanceType"] = instanceType;
          if (GPU_INSTANCE_REGEX.test(instanceType)) {
            meta["isGpuInstance"] = true;
            meta["aiWorkload"] = true;
          }
        }
        if (item["ImageId"]) meta["ami"] = item["ImageId"];
        if (item["PublicIpAddress"]) meta["publicIp"] = item["PublicIpAddress"];
        if (item["PrivateIpAddress"]) meta["privateIp"] = item["PrivateIpAddress"];
        if (item["Platform"]) meta["platform"] = item["Platform"];
        const placement = item["Placement"] as Record<string, unknown> | undefined;
        if (placement?.["AvailabilityZone"]) meta["availabilityZone"] = placement["AvailabilityZone"];
        break;
      }
      case "database": {
        if (item["Engine"]) meta["engine"] = item["Engine"];
        if (item["EngineVersion"]) meta["engineVersion"] = item["EngineVersion"];
        if (item["DBInstanceClass"]) meta["instanceClass"] = item["DBInstanceClass"];
        if (item["MultiAZ"]) meta["multiAz"] = item["MultiAZ"];
        if (item["AllocatedStorage"]) meta["allocatedStorage"] = item["AllocatedStorage"];
        if (item["StorageEncrypted"]) meta["encrypted"] = item["StorageEncrypted"];
        break;
      }
      case "serverless-function": {
        if (item["Runtime"]) meta["runtime"] = item["Runtime"];
        if (item["MemorySize"]) meta["memorySize"] = item["MemorySize"];
        if (item["Timeout"]) meta["timeout"] = item["Timeout"];
        if (item["Handler"]) meta["handler"] = item["Handler"];
        if (item["CodeSize"]) meta["codeSize"] = item["CodeSize"];
        if (item["Architectures"]) meta["architectures"] = item["Architectures"];
        break;
      }
      case "storage": {
        if (item["CreationDate"]) meta["created"] = item["CreationDate"];
        break;
      }
      case "load-balancer": {
        if (item["Type"]) meta["lbType"] = item["Type"];
        if (item["Scheme"]) meta["scheme"] = item["Scheme"];
        if (item["DNSName"]) meta["dnsName"] = item["DNSName"];
        break;
      }
      case "cluster": {
        if (item["Version"]) meta["version"] = item["Version"];
        if (item["PlatformVersion"]) meta["platformVersion"] = item["PlatformVersion"];
        if (item["Status"]) meta["clusterStatus"] = item["Status"];
        break;
      }
      case "vpc": {
        if (item["CidrBlock"]) meta["cidrBlock"] = item["CidrBlock"];
        if (item["IsDefault"]) meta["isDefault"] = item["IsDefault"];
        break;
      }
      case "subnet": {
        if (item["CidrBlock"]) meta["cidrBlock"] = item["CidrBlock"];
        if (item["AvailabilityZone"]) meta["availabilityZone"] = item["AvailabilityZone"];
        if (item["MapPublicIpOnLaunch"]) meta["publicSubnet"] = item["MapPublicIpOnLaunch"];
        break;
      }
    }

    return meta;
  }

  /**
   * Rough cost estimation from resource attributes (inline, during discovery).
   * Used as the primary estimate; Cost Explorer enrichment overrides later.
   */
  private estimateCost(resourceType: GraphResourceType, item: Record<string, unknown>): number | null {
    switch (resourceType) {
      case "compute": {
        const instanceType = item["InstanceType"] as string;
        return instanceType ? (EC2_COSTS[instanceType] ?? null) : null;
      }
      case "database": {
        const instanceClass = item["DBInstanceClass"] as string;
        return instanceClass ? (RDS_COSTS[instanceClass] ?? null) : null;
      }
      case "cache": {
        const nodeType = item["CacheNodeType"] as string;
        return nodeType ? (ELASTICACHE_COSTS_AWS[nodeType] ?? null) : null;
      }
      case "load-balancer":
        return 16.20; // Base ALB cost
      case "nat-gateway":
        return 32.40;
    }

    return null;
  }

  /**
   * Static cost estimation fallback using resource metadata.
   * Called for nodes that Cost Explorer didn't cover (or when CE is unavailable).
   * Uses service-specific heuristics based on configuration attributes.
   */
  private estimateCostStatic(
    resourceType: GraphResourceType,
    metadata: Record<string, unknown>,
  ): number | null {
    switch (resourceType) {
      case "serverless-function": {
        // Lambda: estimate based on memory allocation and assumed invocations.
        // Free tier: 1M requests + 400K GB-seconds/month. Beyond that:
        // $0.20/1M requests + $0.0000166667/GB-second.
        // Conservative estimate: 100K invocations/month, 200ms avg duration.
        const memoryMb = (metadata["memorySize"] as number) ?? 128;
        const assumedInvocations = 100_000;
        const avgDurationMs = 200;
        const gbSeconds = (memoryMb / 1024) * (avgDurationMs / 1000) * assumedInvocations;
        const computeCost = Math.max(0, gbSeconds - 400_000) * 0.0000166667;
        const requestCost = Math.max(0, assumedInvocations - 1_000_000) * 0.0000002;
        const total = computeCost + requestCost;
        // Return small estimated cost even in free tier to show activity
        return total < 0.01 ? 0.01 : Math.round(total * 100) / 100;
      }

      case "storage": {
        // S3: estimate based on storage class. Assume modest bucket size.
        // Standard: $0.023/GB. Typical small bucket: ~1 GB = ~$0.02/mo.
        // We can't see bucket size from listBuckets, so use a conservative floor.
        return STORAGE_COSTS["s3-standard"];
      }

      case "queue": {
        // SQS: $0.40/1M requests after free tier (1M free).
        // Assume modest usage: 500K messages/month → free tier → $0.00.
        return STORAGE_COSTS["sqs"];
      }

      case "topic": {
        // SNS: $0.50/1M publishes. Assume modest usage.
        return STORAGE_COSTS["sns"];
      }

      case "api-gateway": {
        // API Gateway: $3.50/1M REST API calls. Assume 100K calls/month.
        return STORAGE_COSTS["api-gateway"];
      }

      case "cdn": {
        // CloudFront: varies by traffic. Base monthly cost for a distribution.
        return STORAGE_COSTS["cloudfront"];
      }

      case "dns": {
        // Route 53: $0.50/hosted zone + $0.40/1M queries.
        return STORAGE_COSTS["route53-zone"];
      }

      case "secret": {
        // Secrets Manager: $0.40/secret/month + $0.05/10K API calls.
        return STORAGE_COSTS["secrets-manager"];
      }

      case "cluster": {
        // EKS: $0.10/hour = $73/month for the control plane.
        return STORAGE_COSTS["eks-cluster"];
      }

      case "container": {
        // ECS service: cost depends on underlying compute (Fargate/EC2).
        // Fargate base estimate: 0.5 vCPU, 1GB = ~$18/month.
        return STORAGE_COSTS["ecs-fargate-task"];
      }

      case "cache": {
        // ElastiCache: depends on node type. cache.t3.micro ~$12/mo,
        // cache.r6g.large ~$130/mo. Use a conservative small-instance estimate.
        return 15;
      }

      case "identity":
      case "custom":
        // Identity (org accounts) and custom resources: no direct AWS cost.
        return 0;

      case "iam-role":
      case "security-group":
      case "vpc":
      case "subnet":
      case "policy":
      case "route-table":
      case "internet-gateway":
      case "vpc-endpoint":
      case "transit-gateway":
        // Free-tier / no-cost resources. Mark as $0 explicitly.
        return 0;

      default:
        return null;
    }
  }

  // ===========================================================================
  // @espada/aws Manager Lazy-Loading
  // ===========================================================================

  /**
   * Lazily get or create an AWSCredentialsManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getCredentialsManager(): Promise<unknown | null> {
    if (this._credentialsManager !== undefined) return this._credentialsManager as unknown | null;

    if (this.config.managers?.credentials) {
      this._credentialsManager = this.config.managers.credentials;
      return this._credentialsManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/credentials");
      const cm = mod.createCredentialsManager({
        defaultProfile: this.config.profile,
        defaultRegion: "us-east-1",
      });
      await (cm as { initialize: () => Promise<void> }).initialize();
      this._credentialsManager = cm;
      return cm;
    } catch {
      this._credentialsManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an AWSClientPoolManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getClientPoolManager(): Promise<unknown | null> {
    if (this._clientPoolManager !== undefined) return this._clientPoolManager as unknown | null;

    if (this.config.managers?.clientPool) {
      this._clientPoolManager = this.config.managers.clientPool;
      return this._clientPoolManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/client-pool");
      const pool = mod.createClientPool({
        maxClientsPerService: 5,
        maxTotalClients: 50,
        clientTTL: 3600000,
        defaultRegion: "us-east-1",
      });

      // Initialize pool with credentials if available
      const creds = await this.resolveCredentials();
      if (creds) {
        await (pool as { initialize: (c: unknown) => Promise<void> }).initialize(creds);
      }

      this._clientPoolManager = pool;
      return pool;
    } catch {
      this._clientPoolManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an AWSServiceDiscovery from @espada/aws.
   * Returns null if the extension or CredentialsManager is unavailable.
   */
  private async getServiceDiscovery(): Promise<unknown | null> {
    if (this._discoveryManager !== undefined) return this._discoveryManager as unknown | null;

    if (this.config.managers?.discovery) {
      this._discoveryManager = this.config.managers.discovery;
      return this._discoveryManager as unknown;
    }

    try {
      const cm = await this.getCredentialsManager();
      if (!cm) { this._discoveryManager = null; return null; }

      const pool = await this.getClientPoolManager();
      const mod = await import("@espada/aws/discovery");
      // eslint-disable-next-line -- dynamic import loses type info; runtime validated
      this._discoveryManager = mod.createServiceDiscovery(cm as never, (pool ?? undefined) as never);
      return this._discoveryManager as unknown;
    } catch {
      this._discoveryManager = null;
      return null;
    }
  }

  /**
   * Get or lazily create a CostManager instance from `@espada/aws`.
   *
   * Returns null if the aws extension package is not available (e.g. standalone
   * deployment without the workspace). In that case the static pricing
   * tables are used as fallback.
   */
  private async getCostManagerInstance(): Promise<unknown | null> {
    if (this._costManager !== undefined) return this._costManager as unknown | null;

    if (this.config.managers?.cost) {
      this._costManager = this.config.managers.cost;
      return this._costManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/cost");
      const config: Record<string, unknown> = { defaultRegion: "us-east-1" };

      // Forward credentials when explicitly available
      if (this.assumedCredentials) {
        const creds = this.assumedCredentials as Record<string, unknown>;
        config["credentials"] = {
          accessKeyId: creds["accessKeyId"],
          secretAccessKey: creds["secretAccessKey"],
          sessionToken: creds["sessionToken"],
        };
      } else if (this.config.profile) {
        try {
          const { fromIni } = await import("@aws-sdk/credential-provider-ini");
          const resolved = await fromIni({ profile: this.config.profile })();
          config["credentials"] = {
            accessKeyId: resolved.accessKeyId,
            secretAccessKey: resolved.secretAccessKey,
            sessionToken: resolved.sessionToken,
          };
        } catch {
          // profile resolution failed — let CostManager try default chain
        }
      }

      this._costManager = mod.createCostManager(config);
      return this._costManager as unknown;
    } catch {
      this._costManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a CloudTrailManager from @espada/aws.
   * Returns null if the extension or CredentialsManager is unavailable.
   */
  private async getCloudTrailManager(): Promise<unknown | null> {
    if (this._cloudTrailManager !== undefined) return this._cloudTrailManager as unknown | null;

    if (this.config.managers?.cloudtrail) {
      this._cloudTrailManager = this.config.managers.cloudtrail;
      return this._cloudTrailManager as unknown;
    }

    try {
      const cm = await this.getCredentialsManager();
      if (!cm) { this._cloudTrailManager = null; return null; }

      const mod = await import("@espada/aws/cloudtrail");
      // eslint-disable-next-line -- dynamic import loses type info; runtime validated
      this._cloudTrailManager = mod.createCloudTrailManager(cm as never, "us-east-1");
      return this._cloudTrailManager as unknown;
    } catch {
      this._cloudTrailManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a SecurityManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getSecurityManager(): Promise<unknown | null> {
    if (this._securityManager !== undefined) return this._securityManager as unknown | null;

    if (this.config.managers?.security) {
      this._securityManager = this.config.managers.security;
      return this._securityManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/security");
      const config: Record<string, unknown> = { defaultRegion: "us-east-1" };

      // Forward credentials
      if (this.assumedCredentials) {
        const creds = this.assumedCredentials as Record<string, unknown>;
        config["credentials"] = {
          accessKeyId: creds["accessKeyId"],
          secretAccessKey: creds["secretAccessKey"],
          sessionToken: creds["sessionToken"],
        };
      }

      this._securityManager = mod.createSecurityManager(config);
      return this._securityManager as unknown;
    } catch {
      this._securityManager = null;
      return null;
    }
  }

  // ===========================================================================
  // @espada/aws Extended Manager Lazy-Loading
  // ===========================================================================

  /**
   * Lazily get or create a TaggingManager from @espada/aws.
   * Returns null if the extension or CredentialsManager is unavailable.
   */
  private async getTaggingManager(): Promise<unknown | null> {
    if (this._taggingManager !== undefined) return this._taggingManager as unknown | null;

    if (this.config.managers?.tagging) {
      this._taggingManager = this.config.managers.tagging;
      return this._taggingManager as unknown;
    }

    try {
      const cm = await this.getCredentialsManager();
      if (!cm) { this._taggingManager = null; return null; }

      const mod = await import("@espada/aws/tagging");
      this._taggingManager = mod.createTaggingManager(cm as never);
      return this._taggingManager as unknown;
    } catch {
      this._taggingManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a LambdaManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getLambdaManager(): Promise<unknown | null> {
    if (this._lambdaManager !== undefined) return this._lambdaManager as unknown | null;

    if (this.config.managers?.lambda) {
      this._lambdaManager = this.config.managers.lambda;
      return this._lambdaManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/lambda");
      const config = this.buildManagerConfig();
      this._lambdaManager = new mod.LambdaManager(config);
      return this._lambdaManager as unknown;
    } catch {
      this._lambdaManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an ObservabilityManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getObservabilityManager(): Promise<unknown | null> {
    if (this._observabilityManager !== undefined) return this._observabilityManager as unknown | null;

    if (this.config.managers?.observability) {
      this._observabilityManager = this.config.managers.observability;
      return this._observabilityManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/observability");
      const config = this.buildManagerConfig();
      this._observabilityManager = new mod.ObservabilityManager(config);
      return this._observabilityManager as unknown;
    } catch {
      this._observabilityManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an S3Manager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getS3Manager(): Promise<unknown | null> {
    if (this._s3Manager !== undefined) return this._s3Manager as unknown | null;

    if (this.config.managers?.s3) {
      this._s3Manager = this.config.managers.s3;
      return this._s3Manager as unknown;
    }

    try {
      const mod = await import("@espada/aws/s3");
      const config = this.buildManagerConfig();
      this._s3Manager = new mod.S3Manager(config);
      return this._s3Manager as unknown;
    } catch {
      this._s3Manager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an ElastiCacheManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getElastiCacheManager(): Promise<unknown | null> {
    if (this._elastiCacheManager !== undefined) return this._elastiCacheManager as unknown | null;

    if (this.config.managers?.elasticache) {
      this._elastiCacheManager = this.config.managers.elasticache;
      return this._elastiCacheManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/elasticache");
      const config = this.buildManagerConfig();
      this._elastiCacheManager = mod.createElastiCacheManager({
        region: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._elastiCacheManager as unknown;
    } catch {
      this._elastiCacheManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an OrganizationManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getOrganizationManager(): Promise<unknown | null> {
    if (this._organizationManager !== undefined) return this._organizationManager as unknown | null;

    if (this.config.managers?.organization) {
      this._organizationManager = this.config.managers.organization;
      return this._organizationManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/organization");
      const config = this.buildManagerConfig();
      this._organizationManager = mod.createOrganizationManager({
        defaultRegion: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._organizationManager as unknown;
    } catch {
      this._organizationManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a BackupManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getBackupManager(): Promise<unknown | null> {
    if (this._backupManager !== undefined) return this._backupManager as unknown | null;

    if (this.config.managers?.backup) {
      this._backupManager = this.config.managers.backup;
      return this._backupManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/backup");
      const config = this.buildManagerConfig();
      this._backupManager = mod.createBackupManager({
        defaultRegion: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._backupManager as unknown;
    } catch {
      this._backupManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a ComplianceManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getComplianceManager(): Promise<unknown | null> {
    if (this._complianceManager !== undefined) return this._complianceManager as unknown | null;

    if (this.config.managers?.compliance) {
      this._complianceManager = this.config.managers.compliance;
      return this._complianceManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/compliance");
      const config = this.buildManagerConfig();
      this._complianceManager = new mod.AWSComplianceManager({
        defaultRegion: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._complianceManager as unknown;
    } catch {
      this._complianceManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an AutomationManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getAutomationManager(): Promise<unknown | null> {
    if (this._automationManager !== undefined) return this._automationManager as unknown | null;

    if (this.config.managers?.automation) {
      this._automationManager = this.config.managers.automation;
      return this._automationManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/automation");
      const config = this.buildManagerConfig();
      this._automationManager = new mod.AWSAutomationManager({
        defaultRegion: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._automationManager as unknown;
    } catch {
      this._automationManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an AWSEC2Manager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getEC2Manager(): Promise<unknown | null> {
    if (this._ec2Manager !== undefined) return this._ec2Manager as unknown | null;

    if (this.config.managers?.ec2 !== undefined) {
      this._ec2Manager = this.config.managers.ec2;
      return this._ec2Manager as unknown | null;
    }

    try {
      const mod = await import("@espada/aws/ec2");
      const creds = await this.getCredentialsManager();
      if (!creds) { this._ec2Manager = null; return null; }
      this._ec2Manager = mod.createEC2Manager(creds as any, "us-east-1");
      return this._ec2Manager as unknown;
    } catch {
      this._ec2Manager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an RDSManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getRDSManager(): Promise<unknown | null> {
    if (this._rdsManager !== undefined) return this._rdsManager as unknown | null;

    if (this.config.managers?.rds !== undefined) {
      this._rdsManager = this.config.managers.rds;
      return this._rdsManager as unknown | null;
    }

    try {
      const mod = await import("@espada/aws/rds");
      const config = this.buildManagerConfig();
      this._rdsManager = mod.createRDSManager({
        region: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._rdsManager as unknown;
    } catch {
      this._rdsManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a CICDManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getCICDManager(): Promise<unknown | null> {
    if (this._cicdManager !== undefined) return this._cicdManager as unknown | null;

    if (this.config.managers?.cicd !== undefined) {
      this._cicdManager = this.config.managers.cicd;
      return this._cicdManager as unknown | null;
    }

    try {
      const mod = await import("@espada/aws/cicd");
      const config = this.buildManagerConfig();
      this._cicdManager = mod.createCICDManager({
        defaultRegion: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._cicdManager as unknown;
    } catch {
      this._cicdManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a CognitoManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getCognitoManager(): Promise<unknown | null> {
    if (this._cognitoManager !== undefined) return this._cognitoManager as unknown | null;

    if (this.config.managers?.cognito !== undefined) {
      this._cognitoManager = this.config.managers.cognito;
      return this._cognitoManager as unknown | null;
    }

    try {
      const mod = await import("@espada/aws/cognito");
      const config = this.buildManagerConfig();
      this._cognitoManager = mod.createCognitoManager({
        region: (config["defaultRegion"] as string) ?? "us-east-1",
        credentials: config["credentials"] as { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined,
      });
      return this._cognitoManager as unknown;
    } catch {
      this._cognitoManager = null;
      return null;
    }
  }

  /**
   * Build a standard config object for @espada/aws managers that take
   * `{ region?, credentials? }` style configuration.
   */
  private buildManagerConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = { defaultRegion: "us-east-1" };
    if (this.assumedCredentials) {
      const creds = this.assumedCredentials as Record<string, unknown>;
      config["credentials"] = {
        accessKeyId: creds["accessKeyId"],
        secretAccessKey: creds["secretAccessKey"],
        sessionToken: creds["sessionToken"],
      };
    }
    return config;
  }

  // ===========================================================================
  // Domain Module Context
  // ===========================================================================

  /**
   * Build the adapter context object for domain module delegation.
   * Binds private class methods into the AwsAdapterContext interface so
   * extracted domain modules can access SDK clients, managers, and config.
   */
  private _getContext(): AwsAdapterContext {
    return {
      accountId: this.config.accountId,
      config: this.config,
      createClient: (s, r) => this.createClient(s, r),
      buildCommand: (s, m) => this.buildCommand(s, m),
      estimateCostStatic: (rt, meta) => this.estimateCostStatic(rt, meta),
      getEC2Manager: () => this.getEC2Manager(),
      getRDSManager: () => this.getRDSManager(),
      getElastiCacheManager: () => this.getElastiCacheManager(),
      getOrganizationManager: () => this.getOrganizationManager(),
      getBackupManager: () => this.getBackupManager(),
      getComplianceManager: () => this.getComplianceManager(),
      getAutomationManager: () => this.getAutomationManager(),
      getCICDManager: () => this.getCICDManager(),
      getCognitoManager: () => this.getCognitoManager(),
      getTaggingManager: () => this.getTaggingManager(),
      getLambdaManager: () => this.getLambdaManager(),
      getObservabilityManager: () => this.getObservabilityManager(),
      getS3Manager: () => this.getS3Manager(),
      getSecurityManager: () => this.getSecurityManager(),
      getCostManagerInstance: () => this.getCostManagerInstance(),
      getCloudTrailManager: () => this.getCloudTrailManager(),
    };
  }

  // ===========================================================================
  // Post-Discovery Enrichment — Delegated to Domain Modules
  // ===========================================================================

  /** Enrich discovered nodes with tags from TaggingManager. */
  private async enrichWithTags(nodes: GraphNodeInput[]): Promise<void> {
    return enrichmentModule.enrichWithTags(this._getContext(), nodes);
  }

  /** Enrich with event-driven edges from Lambda, SNS, and SQS. */
  private async enrichWithEventSources(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return enrichmentModule.enrichWithEventSources(this._getContext(), nodes, edges);
  }

  /** Enrich with X-Ray service map traces and CloudWatch alarm metadata. */
  private async enrichWithObservability(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return enrichmentModule.enrichWithObservability(this._getContext(), nodes, edges);
  }

  /** Enrich with deeper S3, Route53, and API Gateway metadata. */
  private async enrichWithDeeperDiscovery(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return enrichmentModule.enrichWithDeeperDiscovery(this._getContext(), nodes, edges);
  }

  /** Enrich nodes with AWS Config compliance data. */
  private async enrichWithCompliance(nodes: GraphNodeInput[]): Promise<void> {
    return enrichmentModule.enrichWithCompliance(this._getContext(), nodes);
  }

  // ===========================================================================
  // Extended Discovery — Delegated to Domain Modules
  // ===========================================================================

  /** Discover ElastiCache replication groups and standalone clusters. */
  private async discoverElastiCache(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return databaseModule.discoverElastiCache(this._getContext(), nodes, edges);
  }

  /** Discover AWS Organization structure: accounts, OUs, and SCPs. */
  private async discoverOrganization(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return organizationModule.discoverOrganization(this._getContext(), nodes, edges);
  }

  /** Discover AWS Backup vaults, plans, and protected resources. */
  private async discoverBackupResources(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return backupModule.discoverBackupResources(this._getContext(), nodes, edges);
  }

  /** Discover EventBridge rules + targets and Step Functions state machines. */
  private async discoverAutomation(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return automationModule.discoverAutomation(this._getContext(), nodes, edges);
  }

  /** Deeper EC2 discovery: Auto Scaling Groups, Load Balancers, Target Groups. */
  private async discoverEC2Deeper(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return computeModule.discoverEC2Deeper(this._getContext(), nodes, edges);
  }

  /** Deeper RDS discovery: read replicas, snapshots, subnet groups. */
  private async discoverRDSDeeper(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return databaseModule.discoverRDSDeeper(this._getContext(), nodes, edges);
  }

  /** Discover CI/CD pipelines: CodePipeline, CodeBuild, CodeDeploy. */
  private async discoverCICD(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return cicdModule.discoverCICD(this._getContext(), nodes, edges);
  }

  /** Discover Cognito User Pools, Identity Pools, and App Clients. */
  private async discoverCognito(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    return cognitoModule.discoverCognito(this._getContext(), nodes, edges);
  }

  // ===========================================================================
  // Cost Explorer — Inline (queryServiceCosts/queryResourceCosts are spied
  // on by tests, so they must remain as class methods).
  // Forecasting, optimization, and unused-resource detection are delegated
  // to the cost domain module.
  // ===========================================================================

  /**
   * Enrich nodes with Cost Explorer data: per-service and per-resource costs.
   * Sets `metadata.costSource = "cost-explorer"` on enriched nodes.
   */
  async enrichWithCostExplorer(
    nodes: GraphNodeInput[],
    errors: DiscoveryError[],
  ): Promise<void> {
    const lookbackDays = this.config.costLookbackDays ?? 30;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const formatDate = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const timePeriod = {
      Start: formatDate(startDate),
      End: formatDate(endDate),
    };

    try {
      const serviceCosts = await this.queryServiceCosts(timePeriod, lookbackDays);
      if (!serviceCosts || serviceCosts.size === 0) return;

      const resourceCosts = await this.queryResourceCosts(timePeriod, lookbackDays);

      if (resourceCosts && resourceCosts.size > 0) {
        this.applyResourceCosts(nodes, resourceCosts);
      }

      this.distributeServiceCosts(nodes, serviceCosts);
    } catch (error) {
      errors.push({
        resourceType: "custom",
        message: `Cost Explorer enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
        code: (error as { code?: string })?.code,
      });
    }
  }

  /** Query Cost Explorer for per-service monthly costs via CostManager. */
  private async queryServiceCosts(
    timePeriod: { Start: string; End: string },
    lookbackDays: number,
  ): Promise<Map<string, number> | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const result = await (cm as { getCostSummary: (opts: unknown) => Promise<{ success: boolean; data?: { groups?: Array<{ key: string; total: number }> } }> }).getCostSummary({
        timePeriod: { start: timePeriod.Start, end: timePeriod.End },
        granularity: "MONTHLY",
        groupBy: [{ type: "DIMENSION", key: "SERVICE" }],
        metrics: ["UnblendedCost"],
      });

      if (!result.success || !result.data?.groups) return null;

      const serviceCosts = new Map<string, number>();
      for (const group of result.data.groups) {
        if (group.total > 0) {
          serviceCosts.set(group.key, group.total);
        }
      }

      if (lookbackDays > 30) {
        const factor = 30 / lookbackDays;
        for (const [k, v] of serviceCosts.entries()) {
          serviceCosts.set(k, Math.round(v * factor * 100) / 100);
        }
      }

      return serviceCosts.size > 0 ? serviceCosts : null;
    } catch {
      return null;
    }
  }

  /** Query Cost Explorer for resource-level costs (14-day daily, extrapolated to monthly). */
  private async queryResourceCosts(
    _timePeriod: { Start: string; End: string },
    _lookbackDays: number,
  ): Promise<Map<string, number> | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);
      const formatDate = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const result = await (cm as { getCostSummary: (opts: unknown) => Promise<{ success: boolean; data?: { groups?: Array<{ key: string; total: number }> } }> }).getCostSummary({
        timePeriod: { start: formatDate(startDate), end: formatDate(endDate) },
        granularity: "DAILY",
        groupBy: [{ type: "DIMENSION", key: "RESOURCE" }],
        metrics: ["UnblendedCost"],
        filter: {
          dimension: "SERVICE",
          values: [
            "Amazon Elastic Compute Cloud - Compute",
            "Amazon Relational Database Service",
            "AWS Lambda",
            "Amazon Simple Storage Service",
            "Amazon ElastiCache",
            "Amazon Elastic Container Service",
            "Amazon Elastic Kubernetes Service",
            "Amazon SageMaker",
          ],
        },
      });

      if (!result.success || !result.data?.groups) return null;

      const resourceCosts = new Map<string, number>();
      for (const group of result.data.groups) {
        if (group.total > 0) {
          resourceCosts.set(group.key, group.total);
        }
      }

      const factor = 30 / 14;
      for (const [k, v] of resourceCosts.entries()) {
        resourceCosts.set(k, Math.round(v * factor * 100) / 100);
      }

      return resourceCosts.size > 0 ? resourceCosts : null;
    } catch {
      return null;
    }
  }

  /** Apply resource-level Cost Explorer data to matching nodes by ARN/ID. */
  private applyResourceCosts(
    nodes: GraphNodeInput[],
    resourceCosts: Map<string, number>,
  ): void {
    for (const node of nodes) {
      for (const [arn, cost] of resourceCosts.entries()) {
        if (
          arn.includes(node.nativeId) ||
          (node.metadata["arn"] && arn === node.metadata["arn"]) ||
          arn.endsWith(`/${node.nativeId}`) ||
          arn.endsWith(`:${node.nativeId}`)
        ) {
          node.costMonthly = cost;
          node.metadata["costSource"] = "cost-explorer";
          node.metadata["costArn"] = arn;
          break;
        }
      }
    }
  }

  /** Distribute service-level costs to uncosted nodes, weighted by static estimates. */
  private distributeServiceCosts(
    nodes: GraphNodeInput[],
    serviceCosts: Map<string, number>,
  ): void {
    for (const [awsService, totalCost] of serviceCosts.entries()) {
      const resourceTypes = AWS_SERVICE_TO_RESOURCE_TYPE[awsService];
      if (!resourceTypes) continue;

      const uncostdNodes = nodes.filter(
        (n) =>
          resourceTypes.includes(n.resourceType) &&
          n.metadata["costSource"] !== "cost-explorer",
      );
      if (uncostdNodes.length === 0) continue;

      const totalStaticWeight = uncostdNodes.reduce(
        (sum, n) => sum + (n.costMonthly ?? 1),
        0,
      );

      for (const node of uncostdNodes) {
        const weight = (node.costMonthly ?? 1) / totalStaticWeight;
        node.costMonthly = Math.round(totalCost * weight * 100) / 100;
        node.metadata["costSource"] = "cost-explorer-distributed";
      }
    }
  }

  /** Forecast future AWS costs using CostManager. */
  async forecastCosts(options?: {
    days?: number;
    granularity?: string;
  }): Promise<AwsForecastResult | null> {
    return costModule.forecastCosts(this._getContext(), options);
  }

  /** Get optimization recommendations (rightsizing, RIs, savings plans). */
  async getOptimizationRecommendations(): Promise<AwsOptimizationResult | null> {
    return costModule.getOptimizationRecommendations(this._getContext());
  }

  /** Detect unused AWS resources (idle EBS, unused EIPs, cold Lambdas, etc.). */
  async findUnusedResources(): Promise<AwsUnusedResourcesResult | null> {
    return costModule.findUnusedResources(this._getContext());
  }

  // ===========================================================================
  // Security & CloudTrail — Delegated to Domain Modules
  // ===========================================================================

  /** Get incremental infrastructure changes since a given time via CloudTrail. */
  async getIncrementalChanges(since: Date): Promise<AwsIncrementalChanges | null> {
    return securityModule.getIncrementalChanges(this._getContext(), since);
  }

  /** Get security posture summary via SecurityManager. */
  async getSecurityPosture(): Promise<AwsSecurityPosture | null> {
    return securityModule.getSecurityPosture(this._getContext());
  }

  /** Enrich discovered nodes with security metadata from SecurityManager. */
  async enrichWithSecurity(nodes: GraphNodeInput[]): Promise<void> {
    return securityModule.enrichWithSecurity(this._getContext(), nodes);
  }


  /**
   * Clean up resources held by lazy-loaded managers.
   * Call when the adapter is no longer needed.
   */
  async dispose(): Promise<void> {
    if (this._clientPoolManager && typeof this._clientPoolManager === "object") {
      try {
        await (this._clientPoolManager as { destroy?: () => void }).destroy?.();
      } catch {
        // Ignore cleanup errors
      }
    }
    this._credentialsManager = undefined;
    this._clientPoolManager = undefined;
    this._discoveryManager = undefined;
    this._costManager = undefined;
    this._cloudTrailManager = undefined;
    this._securityManager = undefined;
    this._taggingManager = undefined;
    this._lambdaManager = undefined;
    this._observabilityManager = undefined;
    this._s3Manager = undefined;
    this._elastiCacheManager = undefined;
    this._organizationManager = undefined;
    this._backupManager = undefined;
    this._complianceManager = undefined;
    this._automationManager = undefined;
    this._ec2Manager = undefined;
    this._rdsManager = undefined;
    this._cicdManager = undefined;
    this._cognitoManager = undefined;
  }
}
