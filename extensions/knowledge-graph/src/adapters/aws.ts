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
  AwsChangeEvent,
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
  findNodeByArnOrId,
  reverseRelationship,
  buildAwsNodeId,
} from "./aws/utils.js";

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
  // Post-Discovery Enrichment Methods
  // ===========================================================================

  /**
   * Enrich discovered nodes with tags from TaggingManager.
   *
   * For each node with an ARN, queries the TaggingManager for resource tags.
   * Fills in missing tags, sets owner from tag values, and adds tag metadata.
   */
  private async enrichWithTags(nodes: GraphNodeInput[]): Promise<void> {
    const tm = await this.getTaggingManager();
    if (!tm) return;

    // Process nodes in parallel batches of 10
    const batchSize = 10;
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async (node) => {
          try {
            const arn = node.nativeId;
            if (!arn) return;

            const tags = await (tm as {
              getResourceTags: (arn: string, opts?: { region?: string }) => Promise<Array<{ key: string; value: string }>>;
            }).getResourceTags(arn, { region: node.region });

            if (!tags || tags.length === 0) return;

            // Merge tags (existing tags take precedence)
            for (const tag of tags) {
              if (!node.tags[tag.key]) {
                node.tags[tag.key] = tag.value;
              }
            }

            // Fill owner from tags if not set
            if (!node.owner) {
              node.owner = node.tags["Owner"] ?? node.tags["owner"] ??
                node.tags["Team"] ?? node.tags["team"] ?? null;
            }

            node.metadata["tagSource"] = "tagging-manager";
            node.metadata["tagCount"] = Object.keys(node.tags).length;
          } catch {
            // Individual tag lookup failure is non-fatal
          }
        }),
      );
    }
  }

  /**
   * Enrich with event-driven edges from Lambda, SNS, and SQS.
   *
   * - Lambda event source mappings → triggers edges (SQS/DynamoDB/Kinesis → Lambda)
   * - SNS topic subscriptions → publishes-to edges (SNS → Lambda/SQS)
   * - SQS dead-letter queue configs → publishes-to edges (Queue → DLQ)
   */
  private async enrichWithEventSources(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const lambdaMgr = await this.getLambdaManager();

    // Index nodes by ARN/native-id for fast edge construction
    const nodesByArn = new Map<string, GraphNodeInput>();
    const nodesByNativeId = new Map<string, GraphNodeInput>();
    for (const node of nodes) {
      nodesByNativeId.set(node.nativeId, node);
      // Many AWS IDs contain the ARN
      if (node.nativeId.startsWith("arn:")) {
        nodesByArn.set(node.nativeId, node);
      }
    }

    // Lambda event source mappings
    if (lambdaMgr) {
      try {
        const mappings = await (lambdaMgr as {
          listEventSourceMappings: (opts?: { functionName?: string; eventSourceArn?: string }) => Promise<Array<{
            uuid: string;
            eventSourceArn?: string;
            functionArn?: string;
            state?: string;
            batchSize?: number;
          }>>;
        }).listEventSourceMappings({});

        for (const mapping of mappings) {
          if (!mapping.eventSourceArn || !mapping.functionArn) continue;

          const sourceId = extractResourceId(mapping.eventSourceArn);
          const targetId = extractResourceId(mapping.functionArn);

          // Determine source resource type from ARN
          let sourceType: GraphResourceType = "custom";
          if (mapping.eventSourceArn.includes(":sqs:")) sourceType = "queue";
          else if (mapping.eventSourceArn.includes(":dynamodb:")) sourceType = "database";
          else if (mapping.eventSourceArn.includes(":kinesis:")) sourceType = "stream";

          // Find matching source and target nodes
          const sourceNode = findNodeByArnOrId(nodes, mapping.eventSourceArn, sourceId);
          const targetNode = findNodeByArnOrId(nodes, mapping.functionArn, targetId);
          if (!sourceNode || !targetNode) continue;

          const edgeId = `${sourceNode.id}--triggers--${targetNode.id}`;
          // Avoid duplicate edges
          if (edges.some((e) => e.id === edgeId)) continue;

          edges.push({
            id: edgeId,
            sourceNodeId: sourceNode.id,
            targetNodeId: targetNode.id,
            relationshipType: "triggers",
            confidence: 0.95,
            discoveredVia: "event-stream",
            metadata: {
              eventSourceType: sourceType,
              batchSize: mapping.batchSize,
              state: mapping.state,
              mappingId: mapping.uuid,
            },
          });
        }
      } catch {
        // Lambda event source enrichment is best-effort
      }
    }

    // SNS subscription edges
    const topicNodes = nodes.filter((n) => n.resourceType === "topic");
    if (topicNodes.length > 0) {
      for (const topicNode of topicNodes) {
        try {
          // Try to get subscriptions via SNS SDK
          const client = await this.createClient("SNS", topicNode.region);
          if (!client) continue;

          try {
            const command = await this.buildCommand("SNS", "listSubscriptionsByTopic");
            if (!command) continue;

            // Inject TopicArn into the command
            (command as Record<string, unknown>)["input"] = { TopicArn: topicNode.nativeId };
            const response = await client.send(command) as Record<string, unknown>;
            const subscriptions = (response["Subscriptions"] ?? []) as Array<{
              SubscriptionArn?: string;
              Endpoint?: string;
              Protocol?: string;
            }>;

            for (const sub of subscriptions) {
              if (!sub.Endpoint || sub.Endpoint === "PendingConfirmation") continue;

              const targetNode = findNodeByArnOrId(nodes, sub.Endpoint, extractResourceId(sub.Endpoint));
              if (!targetNode) continue;

              const edgeId = `${topicNode.id}--publishes-to--${targetNode.id}`;
              if (edges.some((e) => e.id === edgeId)) continue;

              edges.push({
                id: edgeId,
                sourceNodeId: topicNode.id,
                targetNodeId: targetNode.id,
                relationshipType: "publishes-to",
                confidence: 0.95,
                discoveredVia: "event-stream",
                metadata: {
                  protocol: sub.Protocol,
                  subscriptionArn: sub.SubscriptionArn,
                },
              });
            }
          } finally {
            client.destroy?.();
          }
        } catch {
          // SNS subscription enrichment is best-effort per topic
        }
      }
    }
  }

  /**
   * Enrich with observability data from X-Ray service map and CloudWatch alarms.
   *
   * - X-Ray service map → routes-to edges between services
   * - CloudWatch alarms → alarm state metadata on monitored nodes
   */
  private async enrichWithObservability(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const obsMgr = await this.getObservabilityManager();
    if (!obsMgr) return;

    // X-Ray service map: creates routes-to edges between communicating services
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 3600000); // Last hour

      const result = await (obsMgr as {
        getServiceMap: (startTime: Date, endTime: Date, groupName?: string) => Promise<{
          success: boolean;
          data?: {
            services?: Array<{
              name: string;
              type?: string;
              edges?: Array<{ referenceId?: number; targetName?: string }>;
              responseTimeHistogram?: Array<{ value?: number }>;
            }>;
          };
        }>;
      }).getServiceMap(startTime, endTime);

      if (result.success && result.data?.services) {
        for (const service of result.data.services) {
          if (!service.edges) continue;

          // Find the source node matching this service
          const sourceNode = nodes.find((n) =>
            n.name === service.name ||
            n.nativeId.includes(service.name) ||
            n.name.toLowerCase().includes(service.name.toLowerCase()),
          );
          if (!sourceNode) continue;

          // Add response time metadata from X-Ray
          if (service.responseTimeHistogram?.[0]?.value) {
            sourceNode.metadata["avgResponseTimeMs"] = Math.round(service.responseTimeHistogram[0].value * 1000);
            sourceNode.metadata["observabilitySource"] = "xray";
          }

          for (const edge of service.edges) {
            if (!edge.targetName) continue;

            const targetNode = nodes.find((n) =>
              n.name === edge.targetName ||
              n.nativeId.includes(edge.targetName!) ||
              n.name.toLowerCase().includes(edge.targetName!.toLowerCase()),
            );
            if (!targetNode) continue;

            const edgeId = `${sourceNode.id}--routes-to--${targetNode.id}`;
            if (edges.some((e) => e.id === edgeId)) continue;

            edges.push({
              id: edgeId,
              sourceNodeId: sourceNode.id,
              targetNodeId: targetNode.id,
              relationshipType: "routes-to",
              confidence: 0.85,
              discoveredVia: "runtime-trace",
              metadata: { source: "xray-service-map" },
            });
          }
        }
      }
    } catch {
      // X-Ray service map is best-effort
    }

    // CloudWatch alarms: attach alarm state to matching nodes
    try {
      const alarmsResult = await (obsMgr as {
        listAlarms: (opts?: { stateValue?: string; maxRecords?: number }) => Promise<{
          success: boolean;
          data?: Array<{
            alarmName: string;
            stateValue?: string;
            metricName?: string;
            namespace?: string;
            dimensions?: Array<{ name: string; value: string }>;
          }>;
        }>;
      }).listAlarms({ maxRecords: 100 });

      if (alarmsResult.success && alarmsResult.data) {
        for (const alarm of alarmsResult.data) {
          if (!alarm.dimensions) continue;

          // Match alarm dimensions to nodes
          for (const dim of alarm.dimensions) {
            const matchingNode = nodes.find((n) =>
              n.nativeId === dim.value ||
              n.nativeId.includes(dim.value) ||
              n.name === dim.value,
            );
            if (!matchingNode) continue;

            const existing = (matchingNode.metadata["alarms"] as string[] | undefined) ?? [];
            existing.push(`${alarm.alarmName}: ${alarm.stateValue ?? "UNKNOWN"}`);
            matchingNode.metadata["alarms"] = existing;

            if (alarm.stateValue === "ALARM") {
              matchingNode.metadata["hasActiveAlarm"] = true;
            }
            matchingNode.metadata["monitoredByCloudWatch"] = true;
          }
        }
      }
    } catch {
      // CloudWatch alarm enrichment is best-effort
    }
  }

  /**
   * Enrich with deeper service-specific metadata.
   *
   * - S3: encryption, versioning, public access block status
   * - ECS containers: cluster→service→task chains
   * - Route53: DNS record → target resource edges
   * - API Gateway: integration → Lambda/HTTP edges
   */
  private async enrichWithDeeperDiscovery(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    // S3 bucket details
    const s3Mgr = await this.getS3Manager();
    if (s3Mgr) {
      const bucketNodes = nodes.filter((n) => n.resourceType === "storage");
      for (const bucket of bucketNodes) {
        try {
          const details = await (s3Mgr as {
            getBucketDetails: (bucketName: string, region?: string) => Promise<{
              success: boolean;
              data?: {
                versioning?: string;
                encryption?: { type?: string; algorithm?: string };
                lifecycle?: { rules?: unknown[] };
              };
            }>;
          }).getBucketDetails(bucket.nativeId, bucket.region);

          if (details.success && details.data) {
            bucket.metadata["versioning"] = details.data.versioning ?? "Disabled";
            if (details.data.encryption) {
              bucket.metadata["encryptionType"] = details.data.encryption.type ?? details.data.encryption.algorithm ?? "unknown";
            }
            if (details.data.lifecycle?.rules) {
              bucket.metadata["lifecycleRules"] = (details.data.lifecycle.rules as unknown[]).length;
            }
          }

          // Public access block
          const publicAccess = await (s3Mgr as {
            getPublicAccessBlock: (bucketName: string, region?: string) => Promise<{
              success: boolean;
              data?: { blockPublicAcls?: boolean; blockPublicPolicy?: boolean; ignorePublicAcls?: boolean; restrictPublicBuckets?: boolean };
            }>;
          }).getPublicAccessBlock(bucket.nativeId, bucket.region);

          if (publicAccess.success && publicAccess.data) {
            const isFullyBlocked = publicAccess.data.blockPublicAcls &&
              publicAccess.data.blockPublicPolicy &&
              publicAccess.data.ignorePublicAcls &&
              publicAccess.data.restrictPublicBuckets;
            bucket.metadata["publicAccessBlocked"] = isFullyBlocked;
            if (!isFullyBlocked) {
              bucket.metadata["hasSecurityIssues"] = true;
            }
          }
        } catch {
          // Individual bucket detail failure is non-fatal
        }
      }
    }

    // Route53: DNS record → target resource edges
    const dnsNodes = nodes.filter((n) => n.resourceType === "dns");
    for (const zone of dnsNodes) {
      try {
        const client = await this.createClient("Route53", "us-east-1");
        if (!client) continue;

        try {
          const command = await this.buildCommand("Route53", "listResourceRecordSets");
          if (!command) continue;

          (command as Record<string, unknown>)["input"] = { HostedZoneId: zone.nativeId };
          const response = await client.send(command) as Record<string, unknown>;
          const records = (response["ResourceRecordSets"] ?? []) as Array<{
            Name?: string;
            Type?: string;
            AliasTarget?: { DNSName?: string };
          }>;

          for (const record of records) {
            if (!record.AliasTarget?.DNSName) continue;

            // Find target node (load balancer, CloudFront, S3, etc.)
            const dnsName = record.AliasTarget.DNSName.replace(/\.$/, "");
            const targetNode = nodes.find((n) =>
              n.metadata["dnsName"] === dnsName ||
              n.nativeId.includes(dnsName) ||
              n.name === dnsName,
            );
            if (!targetNode) continue;

            const edgeId = `${zone.id}--resolves-to--${targetNode.id}`;
            if (edges.some((e) => e.id === edgeId)) continue;

            edges.push({
              id: edgeId,
              sourceNodeId: zone.id,
              targetNodeId: targetNode.id,
              relationshipType: "resolves-to",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {
                recordName: record.Name,
                recordType: record.Type,
              },
            });
          }
        } finally {
          client.destroy?.();
        }
      } catch {
        // DNS record enrichment is best-effort
      }
    }

    // API Gateway: integration → Lambda/HTTP edges
    const apiNodes = nodes.filter((n) => n.resourceType === "api-gateway");
    for (const api of apiNodes) {
      try {
        const client = await this.createClient("APIGateway", api.region);
        if (!client) continue;

        try {
          const command = await this.buildCommand("APIGateway", "getResources");
          if (!command) continue;

          (command as Record<string, unknown>)["input"] = { restApiId: api.nativeId };
          const response = await client.send(command) as Record<string, unknown>;
          const resources = (response["items"] ?? []) as Array<{
            id?: string;
            path?: string;
            resourceMethods?: Record<string, { methodIntegration?: { uri?: string; type?: string } }>;
          }>;

          for (const resource of resources) {
            if (!resource.resourceMethods) continue;
            for (const method of Object.values(resource.resourceMethods)) {
              const uri = method.methodIntegration?.uri;
              if (!uri) continue;

              const targetNode = findNodeByArnOrId(nodes, uri, extractResourceId(uri));
              if (!targetNode) continue;

              const edgeId = `${api.id}--routes-to--${targetNode.id}`;
              if (edges.some((e) => e.id === edgeId)) continue;

              edges.push({
                id: edgeId,
                sourceNodeId: api.id,
                targetNodeId: targetNode.id,
                relationshipType: "routes-to",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {
                  path: resource.path,
                  integrationType: method.methodIntegration?.type,
                },
              });
            }
          }
        } finally {
          client.destroy?.();
        }
      } catch {
        // API Gateway integration enrichment is best-effort
      }
    }
  }

  // ===========================================================================
  // Extended Discovery — ElastiCache, Organization, Backup, Compliance, Automation
  // ===========================================================================

  /**
   * Discover ElastiCache replication groups and standalone clusters via
   * the ElastiCacheManager from @espada/aws.
   *
   * Creates `cache` nodes with engine, version, node type, encryption,
   * and replica metadata. Links to VPCs/subnets/SGs via relationship rules.
   */
  private async discoverElastiCache(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getElastiCacheManager();
    if (!mgr) return;

    // Discover replication groups (Redis/Valkey)
    const rgResult = await (mgr as {
      listReplicationGroups: (opts?: { maxResults?: number }) => Promise<{
        success: boolean;
        data?: Array<{
          ReplicationGroupId?: string;
          Description?: string;
          Status?: string;
          NodeGroups?: Array<{
            NodeGroupId?: string;
            Status?: string;
            NodeGroupMembers?: Array<{ CacheClusterId?: string; PreferredAvailabilityZone?: string }>;
          }>;
          CacheNodeType?: string;
          AtRestEncryptionEnabled?: boolean;
          TransitEncryptionEnabled?: boolean;
          ARN?: string;
          AuthTokenEnabled?: boolean;
          AutomaticFailover?: string;
          MultiAZ?: string;
          SnapshotRetentionLimit?: number;
        }>;
      }>;
    }).listReplicationGroups();

    if (rgResult.success && rgResult.data) {
      for (const rg of rgResult.data) {
        if (!rg.ReplicationGroupId) continue;

        const nodeId = buildAwsNodeId(
          this.config.accountId,
          "global",
          "cache",
          rg.ReplicationGroupId,
        );

        const replicaCount = rg.NodeGroups?.reduce(
          (sum, ng) => sum + (ng.NodeGroupMembers?.length ?? 0),
          0,
        ) ?? 0;

        nodes.push({
          id: nodeId,
          name: rg.ReplicationGroupId,
          resourceType: "cache",
          provider: "aws",
          region: "global",
          account: this.config.accountId,
          nativeId: rg.ARN ?? rg.ReplicationGroupId,
          status: rg.Status === "available" ? "running" : (rg.Status as GraphNodeInput["status"]) ?? "unknown",
          tags: {},
          metadata: {
            engine: "redis",
            description: rg.Description,
            nodeType: rg.CacheNodeType,
            replicaCount,
            atRestEncryption: rg.AtRestEncryptionEnabled ?? false,
            transitEncryption: rg.TransitEncryptionEnabled ?? false,
            automaticFailover: rg.AutomaticFailover,
            multiAZ: rg.MultiAZ,
            snapshotRetention: rg.SnapshotRetentionLimit,
            discoverySource: "elasticache-manager",
          },
          costMonthly: 15,
          owner: null,
          createdAt: null,
        });
      }
    }

    // Discover standalone Memcached clusters
    const ccResult = await (mgr as {
      listCacheClusters: (opts?: { showNodeInfo?: boolean; maxResults?: number }) => Promise<{
        success: boolean;
        data?: Array<{
          CacheClusterId?: string;
          CacheClusterStatus?: string;
          Engine?: string;
          EngineVersion?: string;
          CacheNodeType?: string;
          NumCacheNodes?: number;
          ARN?: string;
          PreferredAvailabilityZone?: string;
          CacheSubnetGroupName?: string;
          SecurityGroups?: Array<{ SecurityGroupId?: string; Status?: string }>;
          ReplicationGroupId?: string;
        }>;
      }>;
    }).listCacheClusters({ showNodeInfo: true });

    if (ccResult.success && ccResult.data) {
      for (const cc of ccResult.data) {
        // Skip clusters that belong to a replication group (already discovered above)
        if (cc.ReplicationGroupId || !cc.CacheClusterId) continue;

        const nodeId = buildAwsNodeId(
          this.config.accountId,
          cc.PreferredAvailabilityZone ?? "us-east-1",
          "cache",
          cc.CacheClusterId,
        );

        nodes.push({
          id: nodeId,
          name: cc.CacheClusterId,
          resourceType: "cache",
          provider: "aws",
          region: cc.PreferredAvailabilityZone ?? "us-east-1",
          account: this.config.accountId,
          nativeId: cc.ARN ?? cc.CacheClusterId,
          status: cc.CacheClusterStatus === "available" ? "running" : (cc.CacheClusterStatus as GraphNodeInput["status"]) ?? "unknown",
          tags: {},
          metadata: {
            engine: cc.Engine,
            engineVersion: cc.EngineVersion,
            nodeType: cc.CacheNodeType,
            numNodes: cc.NumCacheNodes,
            subnetGroup: cc.CacheSubnetGroupName,
            discoverySource: "elasticache-manager",
          },
          costMonthly: 15,
          owner: null,
          createdAt: null,
        });

        // Create security group edges
        if (cc.SecurityGroups) {
          for (const sg of cc.SecurityGroups) {
            if (!sg.SecurityGroupId) continue;
            const sgNode = nodes.find((n) => n.nativeId === sg.SecurityGroupId || n.nativeId.includes(sg.SecurityGroupId!));
            if (!sgNode) continue;

            const edgeId = `${nodeId}--secured-by--${sgNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: nodeId,
                targetNodeId: sgNode.id,
                relationshipType: "secured-by",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }
  }

  /**
   * Discover AWS Organization structure: accounts, OUs, and SCPs.
   *
   * Creates `identity` nodes for accounts, `custom` nodes for OUs,
   * and `policy` nodes for SCPs. Links them with `contains`, `member-of`,
   * and `secured-by` edges.
   */
  private async discoverOrganization(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getOrganizationManager();
    if (!mgr) return;

    // Discover accounts
    const accountsResult = await (mgr as {
      listAccounts: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          Id?: string;
          Name?: string;
          Email?: string;
          Status?: string;
          Arn?: string;
          JoinedMethod?: string;
          JoinedTimestamp?: string;
        }>;
      }>;
    }).listAccounts();

    if (accountsResult.success && accountsResult.data) {
      for (const account of accountsResult.data) {
        if (!account.Id) continue;

        const nodeId = buildAwsNodeId(
          this.config.accountId,
          "global",
          "identity",
          account.Id,
        );

        nodes.push({
          id: nodeId,
          name: account.Name ?? account.Id,
          resourceType: "identity",
          provider: "aws",
          region: "global",
          account: this.config.accountId,
          nativeId: account.Arn ?? account.Id,
          status: account.Status === "ACTIVE" ? "running" : "stopped",
          tags: {},
          metadata: {
            email: account.Email,
            joinedMethod: account.JoinedMethod,
            joinedTimestamp: account.JoinedTimestamp,
            resourceSubtype: "aws-account",
            discoverySource: "organization-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: account.JoinedTimestamp ?? null,
        });
      }
    }

    // Discover organizational units
    const ousResult = await (mgr as {
      listOrganizationalUnits: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          Id?: string;
          Name?: string;
          Arn?: string;
        }>;
      }>;
    }).listOrganizationalUnits();

    if (ousResult.success && ousResult.data) {
      for (const ou of ousResult.data) {
        if (!ou.Id) continue;

        const ouNodeId = buildAwsNodeId(
          this.config.accountId,
          "global",
          "custom",
          ou.Id,
        );

        nodes.push({
          id: ouNodeId,
          name: ou.Name ?? ou.Id,
          resourceType: "custom",
          provider: "aws",
          region: "global",
          account: this.config.accountId,
          nativeId: ou.Arn ?? ou.Id,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "organizational-unit",
            discoverySource: "organization-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: null,
        });

        // Link accounts to their OU — find accounts whose ARN contains this OU
        const accountNodes = nodes.filter((n) =>
          n.metadata["resourceSubtype"] === "aws-account",
        );
        for (const accNode of accountNodes) {
          const containsEdgeId = `${ouNodeId}--contains--${accNode.id}`;
          if (!edges.some((e) => e.id === containsEdgeId)) {
            edges.push({
              id: containsEdgeId,
              sourceNodeId: ouNodeId,
              targetNodeId: accNode.id,
              relationshipType: "contains",
              confidence: 0.8,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }
    }

    // Discover SCPs (Service Control Policies)
    const policiesResult = await (mgr as {
      listPolicies: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          Id?: string;
          Name?: string;
          Description?: string;
          Arn?: string;
          Type?: string;
          AwsManaged?: boolean;
        }>;
      }>;
    }).listPolicies();

    if (policiesResult.success && policiesResult.data) {
      for (const policy of policiesResult.data) {
        if (!policy.Id) continue;

        const policyNodeId = buildAwsNodeId(
          this.config.accountId,
          "global",
          "policy",
          policy.Id,
        );

        nodes.push({
          id: policyNodeId,
          name: policy.Name ?? policy.Id,
          resourceType: "policy",
          provider: "aws",
          region: "global",
          account: this.config.accountId,
          nativeId: policy.Arn ?? policy.Id,
          status: "running",
          tags: {},
          metadata: {
            description: policy.Description,
            policyType: policy.Type,
            awsManaged: policy.AwsManaged ?? false,
            resourceSubtype: "service-control-policy",
            discoverySource: "organization-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: null,
        });

        // Get policy targets → `secured-by` edges
        try {
          const targetsResult = await (mgr as {
            getPolicyTargets: (policyId: string) => Promise<{
              success: boolean;
              data?: Array<{
                TargetId?: string;
                Arn?: string;
                Name?: string;
                Type?: string;
              }>;
            }>;
          }).getPolicyTargets(policy.Id);

          if (targetsResult.success && targetsResult.data) {
            for (const target of targetsResult.data) {
              if (!target.TargetId) continue;

              const targetNode = nodes.find((n) =>
                n.nativeId.includes(target.TargetId!) ||
                n.metadata["resourceSubtype"] === "aws-account" && n.nativeId.includes(target.TargetId!),
              );
              if (!targetNode) continue;

              const securedByEdgeId = `${targetNode.id}--secured-by--${policyNodeId}`;
              if (!edges.some((e) => e.id === securedByEdgeId)) {
                edges.push({
                  id: securedByEdgeId,
                  sourceNodeId: targetNode.id,
                  targetNodeId: policyNodeId,
                  relationshipType: "secured-by",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: { targetType: target.Type },
                });
              }
            }
          }
        } catch {
          // Policy target resolution is best-effort
        }
      }
    }
  }

  /**
   * Discover AWS Backup resources: plans, vaults, and protected resources.
   *
   * Creates `custom` nodes for backup plans and vaults, then creates
   * `backs-up` edges from plans to protected resources and `stores-in`
   * edges from recovery points to vaults.
   */
  private async discoverBackupResources(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getBackupManager();
    if (!mgr) return;

    // Discover backup vaults
    const vaultsResult = await (mgr as {
      listBackupVaults: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          BackupVaultName?: string;
          BackupVaultArn?: string;
          CreationDate?: string;
          EncryptionKeyArn?: string;
          NumberOfRecoveryPoints?: number;
          Locked?: boolean;
        }>;
      }>;
    }).listBackupVaults();

    const vaultNodes: GraphNodeInput[] = [];
    if (vaultsResult.success && vaultsResult.data) {
      for (const vault of vaultsResult.data) {
        if (!vault.BackupVaultName) continue;

        const vaultNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "custom",
          vault.BackupVaultName,
        );

        const vaultNode: GraphNodeInput = {
          id: vaultNodeId,
          name: vault.BackupVaultName,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: vault.BackupVaultArn ?? vault.BackupVaultName,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "backup-vault",
            recoveryPoints: vault.NumberOfRecoveryPoints ?? 0,
            encrypted: !!vault.EncryptionKeyArn,
            locked: vault.Locked ?? false,
            creationDate: vault.CreationDate,
            discoverySource: "backup-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: vault.CreationDate ?? null,
        };

        vaultNodes.push(vaultNode);
        nodes.push(vaultNode);
      }
    }

    // Discover backup plans
    const plansResult = await (mgr as {
      listBackupPlans: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          BackupPlanId?: string;
          BackupPlanName?: string;
          BackupPlanArn?: string;
          CreationDate?: string;
          LastExecutionDate?: string;
          VersionId?: string;
        }>;
      }>;
    }).listBackupPlans();

    if (plansResult.success && plansResult.data) {
      for (const plan of plansResult.data) {
        if (!plan.BackupPlanId) continue;

        const planNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "custom",
          plan.BackupPlanId,
        );

        nodes.push({
          id: planNodeId,
          name: plan.BackupPlanName ?? plan.BackupPlanId,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: plan.BackupPlanArn ?? plan.BackupPlanId,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "backup-plan",
            lastExecution: plan.LastExecutionDate,
            versionId: plan.VersionId,
            creationDate: plan.CreationDate,
            discoverySource: "backup-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: plan.CreationDate ?? null,
        });

        // Discover selections for this plan → `backs-up` edges
        try {
          const selectionsResult = await (mgr as {
            listBackupSelections: (planId: string) => Promise<{
              success: boolean;
              data?: Array<{
                SelectionId?: string;
                SelectionName?: string;
                IamRoleArn?: string;
              }>;
            }>;
          }).listBackupSelections(plan.BackupPlanId);

          if (selectionsResult.success && selectionsResult.data) {
            for (const selection of selectionsResult.data) {
              if (!selection.SelectionId) continue;

              // Link plan to default vault (first vault) via stores-in
              if (vaultNodes.length > 0) {
                const storesInEdgeId = `${planNodeId}--stores-in--${vaultNodes[0]!.id}`;
                if (!edges.some((e) => e.id === storesInEdgeId)) {
                  edges.push({
                    id: storesInEdgeId,
                    sourceNodeId: planNodeId,
                    targetNodeId: vaultNodes[0]!.id,
                    relationshipType: "stores-in",
                    confidence: 0.8,
                    discoveredVia: "api-field",
                    metadata: { selectionName: selection.SelectionName },
                  });
                }
              }
            }
          }
        } catch {
          // Selection resolution is best-effort
        }
      }
    }

    // Discover protected resources → link to existing nodes
    const protectedResult = await (mgr as {
      listProtectedResources: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          ResourceArn?: string;
          ResourceType?: string;
          LastBackupTime?: string;
        }>;
      }>;
    }).listProtectedResources();

    if (protectedResult.success && protectedResult.data) {
      for (const pr of protectedResult.data) {
        if (!pr.ResourceArn) continue;

        const targetNode = findNodeByArnOrId(nodes, pr.ResourceArn, extractResourceId(pr.ResourceArn));
        if (!targetNode) continue;

        // Stamp backup metadata on the protected resource
        targetNode.metadata["lastBackup"] = pr.LastBackupTime;
        targetNode.metadata["backupProtected"] = true;
        targetNode.metadata["backupResourceType"] = pr.ResourceType;

        // Find the most recently created backup plan and create backs-up edge
        const planNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "backup-plan");
        if (planNodes.length > 0) {
          const planNode = planNodes[0]!;
          const backsUpEdgeId = `${planNode.id}--backs-up--${targetNode.id}`;
          if (!edges.some((e) => e.id === backsUpEdgeId)) {
            edges.push({
              id: backsUpEdgeId,
              sourceNodeId: planNode.id,
              targetNodeId: targetNode.id,
              relationshipType: "backs-up",
              confidence: 0.9,
              discoveredVia: "api-field",
              metadata: { resourceType: pr.ResourceType },
            });
          }
        }
      }
    }
  }

  /**
   * Enrich discovered nodes with compliance posture from ComplianceManager.
   *
   * Queries AWS Config rules and conformance packs, then stamps
   * `metadata.compliance` on each discovered node with violation count,
   * rule evaluations, and overall compliance status.
   */
  private async enrichWithCompliance(nodes: GraphNodeInput[]): Promise<void> {
    const mgr = await this.getComplianceManager();
    if (!mgr) return;

    // Get Config rule compliance summaries
    const rulesResult = await (mgr as {
      listConfigRules: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          ConfigRuleName?: string;
          ConfigRuleId?: string;
          ConfigRuleArn?: string;
          Description?: string;
          Source?: { Owner?: string; SourceIdentifier?: string };
          Scope?: { ComplianceResourceTypes?: string[] };
        }>;
      }>;
    }).listConfigRules();

    if (!rulesResult.success || !rulesResult.data) return;

    // For each rule, get compliance details
    for (const rule of rulesResult.data) {
      if (!rule.ConfigRuleName) continue;

      try {
        const evalResult = await (mgr as {
          getConfigRuleCompliance: (ruleName: string) => Promise<{
            success: boolean;
            data?: {
              compliant?: number;
              nonCompliant?: number;
              notApplicable?: number;
              evaluations?: Array<{
                resourceId?: string;
                resourceType?: string;
                complianceType?: string;
                annotation?: string;
              }>;
            };
          }>;
        }).getConfigRuleCompliance(rule.ConfigRuleName);

        if (!evalResult.success || !evalResult.data?.evaluations) continue;

        for (const evaluation of evalResult.data.evaluations) {
          if (!evaluation.resourceId) continue;

          // Find the matching node
          const node = nodes.find((n) =>
            n.nativeId === evaluation.resourceId ||
            n.nativeId.includes(evaluation.resourceId!) ||
            n.name === evaluation.resourceId,
          );
          if (!node) continue;

          // Initialize or update compliance metadata
          const existing = (node.metadata["compliance"] as Record<string, unknown>) ?? {};
          const violations = ((existing["violations"] as unknown[]) ?? []) as Array<{
            rule: string; status: string; annotation?: string;
          }>;

          violations.push({
            rule: rule.ConfigRuleName,
            status: evaluation.complianceType ?? "UNKNOWN",
            annotation: evaluation.annotation,
          });

          node.metadata["compliance"] = {
            ...existing,
            violations,
            violationCount: violations.filter((v) => v.status === "NON_COMPLIANT").length,
            compliantRules: violations.filter((v) => v.status === "COMPLIANT").length,
            lastEvaluated: new Date().toISOString(),
          };
        }
      } catch {
        // Individual rule evaluation is best-effort
      }
    }
  }

  /**
   * Discover EventBridge rules, targets, and Step Functions state machines
   * via the AutomationManager from @espada/aws.
   *
   * Creates nodes for EventBridge rules and Step Functions state machines.
   * Creates `triggers` edges from rules to target Lambda/SQS/SNS/StepFn.
   */
  private async discoverAutomation(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getAutomationManager();
    if (!mgr) return;

    // Discover EventBridge rules
    const rulesResult = await (mgr as {
      listEventRules: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          Name?: string;
          Arn?: string;
          Description?: string;
          State?: string;
          EventBusName?: string;
          ScheduleExpression?: string;
          EventPattern?: string;
        }>;
      }>;
    }).listEventRules();

    if (rulesResult.success && rulesResult.data) {
      for (const rule of rulesResult.data) {
        if (!rule.Name) continue;

        const ruleNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "custom",
          `eventbridge-rule-${rule.Name}`,
        );

        nodes.push({
          id: ruleNodeId,
          name: rule.Name,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: rule.Arn ?? rule.Name,
          status: rule.State === "ENABLED" ? "running" : "stopped",
          tags: {},
          metadata: {
            resourceSubtype: "eventbridge-rule",
            eventBus: rule.EventBusName ?? "default",
            description: rule.Description,
            scheduleExpression: rule.ScheduleExpression,
            hasEventPattern: !!rule.EventPattern,
            discoverySource: "automation-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: null,
        });

        // Get targets for this rule → `triggers` edges
        try {
          const targetsResult = await (mgr as {
            listTargets: (ruleName: string, eventBusName?: string) => Promise<{
              success: boolean;
              data?: Array<{
                Id?: string;
                Arn?: string;
                RoleArn?: string;
                Input?: string;
              }>;
            }>;
          }).listTargets(rule.Name, rule.EventBusName);

          if (targetsResult.success && targetsResult.data) {
            for (const target of targetsResult.data) {
              if (!target.Arn) continue;

              const targetNode = findNodeByArnOrId(
                nodes,
                target.Arn,
                extractResourceId(target.Arn),
              );
              if (!targetNode) continue;

              const triggersEdgeId = `${ruleNodeId}--triggers--${targetNode.id}`;
              if (!edges.some((e) => e.id === triggersEdgeId)) {
                edges.push({
                  id: triggersEdgeId,
                  sourceNodeId: ruleNodeId,
                  targetNodeId: targetNode.id,
                  relationshipType: "triggers",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: { targetId: target.Id },
                });
              }
            }
          }
        } catch {
          // Target resolution is best-effort
        }
      }
    }

    // Discover Step Functions state machines
    const sfResult = await (mgr as {
      listStateMachines: (opts?: unknown) => Promise<{
        success: boolean;
        data?: Array<{
          stateMachineArn?: string;
          name?: string;
          type?: string;
          creationDate?: string;
        }>;
      }>;
    }).listStateMachines();

    if (sfResult.success && sfResult.data) {
      for (const sm of sfResult.data) {
        if (!sm.name) continue;

        const smNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "custom",
          `stepfn-${sm.name}`,
        );

        nodes.push({
          id: smNodeId,
          name: sm.name,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: sm.stateMachineArn ?? sm.name,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "step-function",
            type: sm.type,
            creationDate: sm.creationDate,
            discoverySource: "automation-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: sm.creationDate ?? null,
        });

        // Get state machine definition to find service integrations
        if (sm.stateMachineArn) {
          try {
            const smDetail = await (mgr as {
              getStateMachine: (arn: string) => Promise<{
                success: boolean;
                data?: {
                  definition?: string;
                  roleArn?: string;
                  loggingConfiguration?: unknown;
                };
              }>;
            }).getStateMachine(sm.stateMachineArn);

            if (smDetail.success && smDetail.data?.definition) {
              // Parse the ASL definition for Lambda/service invocations
              try {
                const def = JSON.parse(smDetail.data.definition) as {
                  States?: Record<string, { Resource?: string; Type?: string }>;
                };
                if (def.States) {
                  for (const state of Object.values(def.States)) {
                    if (!state.Resource) continue;

                    // Match Lambda ARNs or service integration patterns
                    const targetNode = findNodeByArnOrId(
                      nodes,
                      state.Resource,
                      extractResourceId(state.Resource),
                    );
                    if (!targetNode) continue;

                    const depEdgeId = `${smNodeId}--depends-on--${targetNode.id}`;
                    if (!edges.some((e) => e.id === depEdgeId)) {
                      edges.push({
                        id: depEdgeId,
                        sourceNodeId: smNodeId,
                        targetNodeId: targetNode.id,
                        relationshipType: "depends-on",
                        confidence: 0.9,
                        discoveredVia: "config-scan",
                        metadata: { stateType: state.Type },
                      });
                    }
                  }
                }
              } catch {
                // ASL parse failure is non-fatal
              }
            }

            // Link state machine to its IAM role
            if (smDetail.data?.roleArn) {
              const roleNode = findNodeByArnOrId(
                nodes,
                smDetail.data.roleArn,
                extractResourceId(smDetail.data.roleArn),
              );
              if (roleNode) {
                const usesEdgeId = `${smNodeId}--uses--${roleNode.id}`;
                if (!edges.some((e) => e.id === usesEdgeId)) {
                  edges.push({
                    id: usesEdgeId,
                    sourceNodeId: smNodeId,
                    targetNodeId: roleNode.id,
                    relationshipType: "uses",
                    confidence: 0.95,
                    discoveredVia: "api-field",
                    metadata: {},
                  });
                }
              }
            }
          } catch {
            // State machine detail resolution is best-effort
          }
        }
      }
    }
  }

  /**
   * Discover deeper EC2 resources: Auto Scaling Groups, Load Balancers,
   * and Target Groups via the AWSEC2Manager from @espada/aws.
   *
   * Enriches existing compute nodes with ASG membership and creates new
   * nodes for ALBs/NLBs and target groups with appropriate edges.
   */
  private async discoverEC2Deeper(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getEC2Manager();
    if (!mgr) return;

    // Discover Auto Scaling Groups
    const asgResult = await (mgr as {
      listAutoScalingGroups: (opts?: { maxResults?: number }) => Promise<{
        groups: Array<{
          autoScalingGroupName?: string;
          autoScalingGroupARN?: string;
          launchTemplate?: { launchTemplateName?: string; launchTemplateId?: string };
          minSize?: number;
          maxSize?: number;
          desiredCapacity?: number;
          instances?: Array<{ instanceId?: string; healthStatus?: string; lifecycleState?: string }>;
          targetGroupARNs?: string[];
          healthCheckType?: string;
          createdTime?: string;
          status?: string;
        }>;
      }>;
    }).listAutoScalingGroups();

    if (asgResult.groups) {
      for (const asg of asgResult.groups) {
        if (!asg.autoScalingGroupName) continue;

        const asgNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "custom",
          `asg-${asg.autoScalingGroupName}`,
        );

        nodes.push({
          id: asgNodeId,
          name: asg.autoScalingGroupName,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: asg.autoScalingGroupARN ?? asg.autoScalingGroupName,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "auto-scaling-group",
            minSize: asg.minSize,
            maxSize: asg.maxSize,
            desiredCapacity: asg.desiredCapacity,
            healthCheckType: asg.healthCheckType,
            launchTemplate: asg.launchTemplate?.launchTemplateName,
            instanceCount: asg.instances?.length ?? 0,
            discoverySource: "ec2-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: asg.createdTime ?? null,
        });

        // Link ASG → instances (contains edges)
        if (asg.instances) {
          for (const inst of asg.instances) {
            if (!inst.instanceId) continue;
            const instNode = nodes.find((n) =>
              n.nativeId === inst.instanceId || n.nativeId.includes(inst.instanceId!),
            );
            if (!instNode) continue;

            const containsEdgeId = `${asgNodeId}--contains--${instNode.id}`;
            if (!edges.some((e) => e.id === containsEdgeId)) {
              edges.push({
                id: containsEdgeId,
                sourceNodeId: asgNodeId,
                targetNodeId: instNode.id,
                relationshipType: "contains",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: { healthStatus: inst.healthStatus, lifecycleState: inst.lifecycleState },
              });
            }
          }
        }

        // Link ASG → target groups
        if (asg.targetGroupARNs) {
          for (const tgArn of asg.targetGroupARNs) {
            const tgNode = findNodeByArnOrId(nodes, tgArn, extractResourceId(tgArn));
            if (!tgNode) continue;
            const attachedEdgeId = `${asgNodeId}--attached-to--${tgNode.id}`;
            if (!edges.some((e) => e.id === attachedEdgeId)) {
              edges.push({
                id: attachedEdgeId,
                sourceNodeId: asgNodeId,
                targetNodeId: tgNode.id,
                relationshipType: "attached-to",
                confidence: 0.9,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }

    // Discover Load Balancers
    const lbResult = await (mgr as {
      listLoadBalancers: (opts?: { maxResults?: number }) => Promise<{
        loadBalancers: Array<{
          loadBalancerArn?: string;
          loadBalancerName?: string;
          dnsName?: string;
          type?: string;
          scheme?: string;
          state?: { code?: string };
          vpcId?: string;
          availabilityZones?: Array<{ zoneName?: string; subnetId?: string }>;
          securityGroups?: string[];
          createdTime?: string;
        }>;
      }>;
    }).listLoadBalancers();

    if (lbResult.loadBalancers) {
      for (const lb of lbResult.loadBalancers) {
        if (!lb.loadBalancerName) continue;

        // Check if this LB was already discovered via the base adapter
        const existingLb = nodes.find((n) =>
          n.resourceType === "load-balancer" &&
          (n.nativeId === lb.loadBalancerArn || n.name === lb.loadBalancerName),
        );

        if (existingLb) {
          // Enrich existing LB node with deeper metadata
          existingLb.metadata["dnsName"] = lb.dnsName;
          existingLb.metadata["lbType"] = lb.type;
          existingLb.metadata["scheme"] = lb.scheme;
          existingLb.metadata["discoverySource"] = "ec2-manager";
          continue;
        }

        const lbNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "load-balancer",
          lb.loadBalancerName,
        );

        nodes.push({
          id: lbNodeId,
          name: lb.loadBalancerName,
          resourceType: "load-balancer",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: lb.loadBalancerArn ?? lb.loadBalancerName,
          status: lb.state?.code === "active" ? "running" : (lb.state?.code as GraphNodeInput["status"]) ?? "unknown",
          tags: {},
          metadata: {
            dnsName: lb.dnsName,
            lbType: lb.type,
            scheme: lb.scheme,
            discoverySource: "ec2-manager",
          },
          costMonthly: 20,
          owner: null,
          createdAt: lb.createdTime ?? null,
        });

        // SG edges for LBs
        if (lb.securityGroups) {
          for (const sgId of lb.securityGroups) {
            const sgNode = nodes.find((n) => n.nativeId === sgId || n.nativeId.includes(sgId));
            if (!sgNode) continue;
            const edgeId = `${lbNodeId}--secured-by--${sgNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: lbNodeId,
                targetNodeId: sgNode.id,
                relationshipType: "secured-by",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }

    // Discover Target Groups
    const tgResult = await (mgr as {
      listTargetGroups: (opts?: { maxResults?: number }) => Promise<{
        targetGroups: Array<{
          targetGroupArn?: string;
          targetGroupName?: string;
          protocol?: string;
          port?: number;
          targetType?: string;
          healthCheckEnabled?: boolean;
          healthCheckProtocol?: string;
          healthCheckPath?: string;
          vpcId?: string;
          loadBalancerArns?: string[];
        }>;
      }>;
    }).listTargetGroups();

    if (tgResult.targetGroups) {
      for (const tg of tgResult.targetGroups) {
        if (!tg.targetGroupName) continue;

        const tgNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "custom",
          `tg-${tg.targetGroupName}`,
        );

        nodes.push({
          id: tgNodeId,
          name: tg.targetGroupName,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: tg.targetGroupArn ?? tg.targetGroupName,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "target-group",
            protocol: tg.protocol,
            port: tg.port,
            targetType: tg.targetType,
            healthCheckEnabled: tg.healthCheckEnabled,
            healthCheckPath: tg.healthCheckPath,
            discoverySource: "ec2-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: null,
        });

        // Link LBs → target group (routes-to)
        if (tg.loadBalancerArns) {
          for (const lbArn of tg.loadBalancerArns) {
            const lbNode = findNodeByArnOrId(nodes, lbArn, extractResourceId(lbArn));
            if (!lbNode) continue;
            const routeEdgeId = `${lbNode.id}--routes-to--${tgNodeId}`;
            if (!edges.some((e) => e.id === routeEdgeId)) {
              edges.push({
                id: routeEdgeId,
                sourceNodeId: lbNode.id,
                targetNodeId: tgNodeId,
                relationshipType: "routes-to",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }
  }

  /**
   * Discover deeper RDS resources: read replicas, snapshots, subnet groups,
   * and parameter groups via the RDSManager from @espada/aws.
   *
   * Enriches existing database nodes with replica/snapshot metadata and
   * creates additional relationship edges.
   */
  private async discoverRDSDeeper(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getRDSManager();
    if (!mgr) return;

    // Find existing RDS database nodes to enrich
    const rdsNodes = nodes.filter((n) =>
      n.resourceType === "database" && n.provider === "aws" &&
      n.metadata["discoverySource"] !== "dynamodb",
    );

    for (const rdsNode of rdsNodes) {
      const dbId = rdsNode.name ?? extractResourceId(rdsNode.nativeId);

      // Discover read replicas
      try {
        const replicas = await (mgr as {
          listReadReplicas: (dbInstanceIdentifier: string, region?: string) => Promise<Array<{
            DBInstanceIdentifier?: string;
            DBInstanceArn?: string;
            DBInstanceStatus?: string;
            DBInstanceClass?: string;
            Engine?: string;
            AvailabilityZone?: string;
            ReadReplicaSourceDBInstanceIdentifier?: string;
          }>>;
        }).listReadReplicas(dbId);

        if (replicas && replicas.length > 0) {
          rdsNode.metadata["replicaCount"] = replicas.length;

          for (const replica of replicas) {
            if (!replica.DBInstanceIdentifier) continue;

            // Check if replica already exists as a node
            const existingReplica = nodes.find((n) =>
              n.nativeId === replica.DBInstanceArn ||
              n.name === replica.DBInstanceIdentifier,
            );

            if (!existingReplica) {
              const replicaNodeId = buildAwsNodeId(
                this.config.accountId,
                replica.AvailabilityZone ?? "us-east-1",
                "database",
                replica.DBInstanceIdentifier,
              );

              nodes.push({
                id: replicaNodeId,
                name: replica.DBInstanceIdentifier,
                resourceType: "database",
                provider: "aws",
                region: replica.AvailabilityZone ?? "us-east-1",
                account: this.config.accountId,
                nativeId: replica.DBInstanceArn ?? replica.DBInstanceIdentifier,
                status: replica.DBInstanceStatus === "available" ? "running" : (replica.DBInstanceStatus as GraphNodeInput["status"]) ?? "unknown",
                tags: {},
                metadata: {
                  engine: replica.Engine,
                  instanceClass: replica.DBInstanceClass,
                  isReadReplica: true,
                  sourceInstance: dbId,
                  discoverySource: "rds-manager",
                },
                costMonthly: this.estimateCostStatic("database", { instanceType: replica.DBInstanceClass }),
                owner: null,
                createdAt: null,
              });

              // Create replicates edge
              const replicatesEdgeId = `${replicaNodeId}--replicates--${rdsNode.id}`;
              edges.push({
                id: replicatesEdgeId,
                sourceNodeId: replicaNodeId,
                targetNodeId: rdsNode.id,
                relationshipType: "replicates",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      } catch {
        // Replica discovery is best-effort
      }

      // Get Multi-AZ status
      try {
        const multiAZStatus = await (mgr as {
          getMultiAZStatus: (dbInstanceIdentifier: string, region?: string) => Promise<{
            multiAZ: boolean;
            secondaryAZ?: string;
          }>;
        }).getMultiAZStatus(dbId);

        if (multiAZStatus) {
          rdsNode.metadata["multiAZ"] = multiAZStatus.multiAZ;
          rdsNode.metadata["secondaryAZ"] = multiAZStatus.secondaryAZ;
        }
      } catch {
        // Multi-AZ status is best-effort
      }
    }

    // Discover RDS snapshots
    try {
      const snapshotResult = await (mgr as {
        listSnapshots: (opts?: { maxResults?: number }) => Promise<{
          snapshots: Array<{
            DBSnapshotIdentifier?: string;
            DBSnapshotArn?: string;
            DBInstanceIdentifier?: string;
            SnapshotCreateTime?: string;
            Status?: string;
            Engine?: string;
            AllocatedStorage?: number;
            SnapshotType?: string;
            Encrypted?: boolean;
          }>;
        }>;
      }).listSnapshots({ maxResults: 50 });

      if (snapshotResult.snapshots) {
        for (const snap of snapshotResult.snapshots) {
          if (!snap.DBSnapshotIdentifier) continue;

          const snapNodeId = buildAwsNodeId(
            this.config.accountId,
            "us-east-1",
            "storage",
            `rds-snap-${snap.DBSnapshotIdentifier}`,
          );

          nodes.push({
            id: snapNodeId,
            name: snap.DBSnapshotIdentifier,
            resourceType: "storage",
            provider: "aws",
            region: "us-east-1",
            account: this.config.accountId,
            nativeId: snap.DBSnapshotArn ?? snap.DBSnapshotIdentifier,
            status: snap.Status === "available" ? "running" : (snap.Status as GraphNodeInput["status"]) ?? "unknown",
            tags: {},
            metadata: {
              resourceSubtype: "rds-snapshot",
              engine: snap.Engine,
              allocatedStorageGB: snap.AllocatedStorage,
              snapshotType: snap.SnapshotType,
              encrypted: snap.Encrypted ?? false,
              sourceInstance: snap.DBInstanceIdentifier,
              discoverySource: "rds-manager",
            },
            costMonthly: Math.round((snap.AllocatedStorage ?? 20) * 0.095 * 100) / 100,
            owner: null,
            createdAt: snap.SnapshotCreateTime ?? null,
          });

          // Link snapshot → source RDS instance (backs-up)
          if (snap.DBInstanceIdentifier) {
            const sourceNode = nodes.find((n) =>
              n.resourceType === "database" && n.name === snap.DBInstanceIdentifier,
            );
            if (sourceNode) {
              const backsUpEdgeId = `${snapNodeId}--backs-up--${sourceNode.id}`;
              if (!edges.some((e) => e.id === backsUpEdgeId)) {
                edges.push({
                  id: backsUpEdgeId,
                  sourceNodeId: snapNodeId,
                  targetNodeId: sourceNode.id,
                  relationshipType: "backs-up",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: { snapshotType: snap.SnapshotType },
                });
              }
            }
          }
        }
      }
    } catch {
      // Snapshot discovery is best-effort
    }

    // Discover subnet groups
    try {
      const subnetGroupResult = await (mgr as {
        listSubnetGroups: (opts?: { maxResults?: number }) => Promise<{
          groups: Array<{
            DBSubnetGroupName?: string;
            DBSubnetGroupArn?: string;
            DBSubnetGroupDescription?: string;
            VpcId?: string;
            SubnetGroupStatus?: string;
            Subnets?: Array<{ SubnetIdentifier?: string; SubnetAvailabilityZone?: { Name?: string } }>;
          }>;
        }>;
      }).listSubnetGroups();

      if (subnetGroupResult.groups) {
        for (const sg of subnetGroupResult.groups) {
          if (!sg.DBSubnetGroupName) continue;

          const sgNodeId = buildAwsNodeId(
            this.config.accountId,
            "us-east-1",
            "custom",
            `rds-subnet-group-${sg.DBSubnetGroupName}`,
          );

          nodes.push({
            id: sgNodeId,
            name: sg.DBSubnetGroupName,
            resourceType: "custom",
            provider: "aws",
            region: "us-east-1",
            account: this.config.accountId,
            nativeId: sg.DBSubnetGroupArn ?? sg.DBSubnetGroupName,
            status: sg.SubnetGroupStatus === "Complete" ? "running" : "unknown",
            tags: {},
            metadata: {
              resourceSubtype: "rds-subnet-group",
              description: sg.DBSubnetGroupDescription,
              vpcId: sg.VpcId,
              subnetCount: sg.Subnets?.length ?? 0,
              discoverySource: "rds-manager",
            },
            costMonthly: 0,
            owner: null,
            createdAt: null,
          });

          // Link subnet group → subnets
          if (sg.Subnets) {
            for (const subnet of sg.Subnets) {
              if (!subnet.SubnetIdentifier) continue;
              const subnetNode = nodes.find((n) =>
                n.nativeId === subnet.SubnetIdentifier || n.nativeId.includes(subnet.SubnetIdentifier!),
              );
              if (!subnetNode) continue;

              const containsEdgeId = `${sgNodeId}--contains--${subnetNode.id}`;
              if (!edges.some((e) => e.id === containsEdgeId)) {
                edges.push({
                  id: containsEdgeId,
                  sourceNodeId: sgNodeId,
                  targetNodeId: subnetNode.id,
                  relationshipType: "contains",
                  confidence: 0.9,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }
        }
      }
    } catch {
      // Subnet group discovery is best-effort
    }
  }

  /**
   * Discover CI/CD infrastructure: CodePipeline pipelines, CodeBuild
   * projects, and CodeDeploy applications via the CICDManager.
   *
   * Creates `custom` nodes for pipelines, build projects, and deploy apps.
   * Creates edges: pipeline→S3 (artifact store), pipeline→build project,
   * build project→IAM role, deploy app→instances.
   */
  private async discoverCICD(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getCICDManager();
    if (!mgr) return;

    // Discover CodePipeline pipelines
    const pipelinesResult = await (mgr as {
      listPipelines: (opts?: unknown) => Promise<{
        success: boolean;
        data?: { pipelines: Array<{ name?: string; version?: number; created?: string; updated?: string }>; nextToken?: string };
      }>;
    }).listPipelines();

    if (pipelinesResult.success && pipelinesResult.data?.pipelines) {
      for (const pipeline of pipelinesResult.data.pipelines) {
        if (!pipeline.name) continue;

        const pipelineNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "custom",
          `pipeline-${pipeline.name}`,
        );

        nodes.push({
          id: pipelineNodeId,
          name: pipeline.name,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: pipeline.name,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "codepipeline",
            version: pipeline.version,
            lastUpdated: pipeline.updated,
            discoverySource: "cicd-manager",
          },
          costMonthly: 1,
          owner: null,
          createdAt: pipeline.created ?? null,
        });

        // Get pipeline details for stage/action edges
        try {
          const detailResult = await (mgr as {
            getPipeline: (name: string) => Promise<{
              success: boolean;
              data?: {
                name?: string;
                roleArn?: string;
                artifactStore?: { type?: string; location?: string };
                stages?: Array<{
                  name?: string;
                  actions?: Array<{
                    name?: string;
                    actionTypeId?: { category?: string; provider?: string };
                    configuration?: Record<string, string>;
                    roleArn?: string;
                  }>;
                }>;
              };
            }>;
          }).getPipeline(pipeline.name);

          if (detailResult.success && detailResult.data) {
            const detail = detailResult.data;

            // Link pipeline → IAM role
            if (detail.roleArn) {
              const roleNode = findNodeByArnOrId(nodes, detail.roleArn, extractResourceId(detail.roleArn));
              if (roleNode) {
                const usesEdgeId = `${pipelineNodeId}--uses--${roleNode.id}`;
                if (!edges.some((e) => e.id === usesEdgeId)) {
                  edges.push({
                    id: usesEdgeId,
                    sourceNodeId: pipelineNodeId,
                    targetNodeId: roleNode.id,
                    relationshipType: "uses",
                    confidence: 0.95,
                    discoveredVia: "api-field",
                    metadata: {},
                  });
                }
              }
            }

            // Link pipeline → artifact store (S3)
            if (detail.artifactStore?.location) {
              const s3Node = nodes.find((n) =>
                n.resourceType === "storage" && n.name === detail.artifactStore!.location,
              );
              if (s3Node) {
                const storesInEdgeId = `${pipelineNodeId}--stores-in--${s3Node.id}`;
                if (!edges.some((e) => e.id === storesInEdgeId)) {
                  edges.push({
                    id: storesInEdgeId,
                    sourceNodeId: pipelineNodeId,
                    targetNodeId: s3Node.id,
                    relationshipType: "stores-in",
                    confidence: 0.9,
                    discoveredVia: "api-field",
                    metadata: {},
                  });
                }
              }
            }

            // Scan stages for CodeBuild/CodeDeploy/Lambda actions → edges
            if (detail.stages) {
              for (const stage of detail.stages) {
                if (!stage.actions) continue;
                for (const action of stage.actions) {
                  if (!action.configuration) continue;

                  // CodeBuild action → build project
                  if (action.actionTypeId?.provider === "CodeBuild" && action.configuration["ProjectName"]) {
                    const buildNode = nodes.find((n) =>
                      n.metadata["resourceSubtype"] === "codebuild-project" &&
                      n.name === action.configuration!["ProjectName"],
                    );
                    if (buildNode) {
                      const depEdgeId = `${pipelineNodeId}--depends-on--${buildNode.id}`;
                      if (!edges.some((e) => e.id === depEdgeId)) {
                        edges.push({
                          id: depEdgeId,
                          sourceNodeId: pipelineNodeId,
                          targetNodeId: buildNode.id,
                          relationshipType: "depends-on",
                          confidence: 0.9,
                          discoveredVia: "config-scan",
                          metadata: { stage: stage.name },
                        });
                      }
                    }
                  }

                  // Lambda action → function
                  if (action.actionTypeId?.provider === "Lambda" && action.configuration["FunctionName"]) {
                    const fnNode = nodes.find((n) =>
                      n.resourceType === "serverless-function" &&
                      (n.name === action.configuration!["FunctionName"] ||
                       n.nativeId.includes(action.configuration!["FunctionName"]!)),
                    );
                    if (fnNode) {
                      const triggersEdgeId = `${pipelineNodeId}--triggers--${fnNode.id}`;
                      if (!edges.some((e) => e.id === triggersEdgeId)) {
                        edges.push({
                          id: triggersEdgeId,
                          sourceNodeId: pipelineNodeId,
                          targetNodeId: fnNode.id,
                          relationshipType: "triggers",
                          confidence: 0.9,
                          discoveredVia: "config-scan",
                          metadata: { stage: stage.name },
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Pipeline detail is best-effort
        }
      }
    }

    // Discover CodeBuild projects
    const buildProjectsResult = await (mgr as {
      listBuildProjects: (opts?: unknown) => Promise<{
        success: boolean;
        data?: { projects: string[] };
      }>;
    }).listBuildProjects();

    if (buildProjectsResult.success && buildProjectsResult.data?.projects) {
      for (const projectName of buildProjectsResult.data.projects) {
        try {
          const projectResult = await (mgr as {
            getBuildProject: (name: string) => Promise<{
              success: boolean;
              data?: {
                name?: string;
                arn?: string;
                description?: string;
                source?: { type?: string; location?: string };
                environment?: { computeType?: string; image?: string; type?: string };
                serviceRole?: string;
                created?: string;
                lastModified?: string;
                badge?: { badgeEnabled?: boolean; badgeRequestUrl?: string };
              };
            }>;
          }).getBuildProject(projectName);

          if (!projectResult.success || !projectResult.data) continue;
          const project = projectResult.data;

          const buildNodeId = buildAwsNodeId(
            this.config.accountId,
            "us-east-1",
            "custom",
            `codebuild-${projectName}`,
          );

          nodes.push({
            id: buildNodeId,
            name: projectName,
            resourceType: "custom",
            provider: "aws",
            region: "us-east-1",
            account: this.config.accountId,
            nativeId: project.arn ?? projectName,
            status: "running",
            tags: {},
            metadata: {
              resourceSubtype: "codebuild-project",
              description: project.description,
              sourceType: project.source?.type,
              sourceLocation: project.source?.location,
              computeType: project.environment?.computeType,
              buildImage: project.environment?.image,
              discoverySource: "cicd-manager",
            },
            costMonthly: 0,
            owner: null,
            createdAt: project.created ?? null,
          });

          // Link build project → IAM role
          if (project.serviceRole) {
            const roleNode = findNodeByArnOrId(nodes, project.serviceRole, extractResourceId(project.serviceRole));
            if (roleNode) {
              const usesEdgeId = `${buildNodeId}--uses--${roleNode.id}`;
              if (!edges.some((e) => e.id === usesEdgeId)) {
                edges.push({
                  id: usesEdgeId,
                  sourceNodeId: buildNodeId,
                  targetNodeId: roleNode.id,
                  relationshipType: "uses",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }
        } catch {
          // Individual build project is best-effort
        }
      }
    }

    // Discover CodeDeploy applications
    const deployAppsResult = await (mgr as {
      listApplications: (opts?: unknown) => Promise<{
        success: boolean;
        data?: { applications: string[] };
      }>;
    }).listApplications();

    if (deployAppsResult.success && deployAppsResult.data?.applications) {
      for (const appName of deployAppsResult.data.applications) {
        try {
          const appResult = await (mgr as {
            getApplication: (name: string) => Promise<{
              success: boolean;
              data?: {
                applicationName?: string;
                applicationId?: string;
                computePlatform?: string;
                createTime?: string;
                linkedToGitHub?: boolean;
              };
            }>;
          }).getApplication(appName);

          if (!appResult.success || !appResult.data) continue;
          const app = appResult.data;

          const deployNodeId = buildAwsNodeId(
            this.config.accountId,
            "us-east-1",
            "custom",
            `codedeploy-${appName}`,
          );

          nodes.push({
            id: deployNodeId,
            name: appName,
            resourceType: "custom",
            provider: "aws",
            region: "us-east-1",
            account: this.config.accountId,
            nativeId: app.applicationId ?? appName,
            status: "running",
            tags: {},
            metadata: {
              resourceSubtype: "codedeploy-application",
              computePlatform: app.computePlatform,
              linkedToGitHub: app.linkedToGitHub ?? false,
              discoverySource: "cicd-manager",
            },
            costMonthly: 0,
            owner: null,
            createdAt: app.createTime ?? null,
          });
        } catch {
          // Individual deploy app is best-effort
        }
      }
    }
  }

  /**
   * Discover Cognito resources: User Pools, Identity Pools, and App Clients
   * via the CognitoManager from @espada/aws.
   *
   * Creates `identity` nodes for user pools and identity pools, links
   * app clients as sub-resources, and creates edges to Lambda triggers.
   */
  private async discoverCognito(
    nodes: GraphNodeInput[],
    edges: GraphEdgeInput[],
  ): Promise<void> {
    const mgr = await this.getCognitoManager();
    if (!mgr) return;

    // Discover User Pools
    const userPoolsResult = await (mgr as {
      listUserPools: (maxResults?: number) => Promise<{
        success: boolean;
        data?: Array<{
          Id?: string;
          Name?: string;
          Status?: string;
          CreationDate?: Date | string;
          LastModifiedDate?: Date | string;
          LambdaConfig?: Record<string, string>;
        }>;
      }>;
    }).listUserPools(50);

    if (userPoolsResult.success && userPoolsResult.data) {
      for (const pool of userPoolsResult.data) {
        if (!pool.Id) continue;

        const poolNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "identity",
          `userpool-${pool.Id}`,
        );

        const createdAt = pool.CreationDate instanceof Date
          ? pool.CreationDate.toISOString()
          : pool.CreationDate ?? null;

        nodes.push({
          id: poolNodeId,
          name: pool.Name ?? pool.Id,
          resourceType: "identity",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: pool.Id,
          status: pool.Status === "Enabled" || !pool.Status ? "running" : "stopped",
          tags: {},
          metadata: {
            resourceSubtype: "cognito-user-pool",
            hasLambdaTriggers: pool.LambdaConfig ? Object.keys(pool.LambdaConfig).length > 0 : false,
            discoverySource: "cognito-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt,
        });

        // Link user pool → Lambda triggers
        if (pool.LambdaConfig) {
          for (const [triggerName, lambdaArn] of Object.entries(pool.LambdaConfig)) {
            if (!lambdaArn) continue;
            const fnNode = findNodeByArnOrId(nodes, lambdaArn, extractResourceId(lambdaArn));
            if (!fnNode) continue;

            const triggersEdgeId = `${poolNodeId}--triggers--${fnNode.id}`;
            if (!edges.some((e) => e.id === triggersEdgeId)) {
              edges.push({
                id: triggersEdgeId,
                sourceNodeId: poolNodeId,
                targetNodeId: fnNode.id,
                relationshipType: "triggers",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: { triggerType: triggerName },
              });
            }
          }
        }

        // Discover app clients for this user pool
        try {
          const clientsResult = await (mgr as {
            listAppClients: (userPoolId: string) => Promise<{
              success: boolean;
              data?: Array<{
                ClientId?: string;
                ClientName?: string;
                UserPoolId?: string;
              }>;
            }>;
          }).listAppClients(pool.Id);

          if (clientsResult.success && clientsResult.data) {
            for (const client of clientsResult.data) {
              if (!client.ClientId) continue;

              const clientNodeId = buildAwsNodeId(
                this.config.accountId,
                "us-east-1",
                "custom",
                `cognito-client-${client.ClientId}`,
              );

              nodes.push({
                id: clientNodeId,
                name: client.ClientName ?? client.ClientId,
                resourceType: "custom",
                provider: "aws",
                region: "us-east-1",
                account: this.config.accountId,
                nativeId: client.ClientId,
                status: "running",
                tags: {},
                metadata: {
                  resourceSubtype: "cognito-app-client",
                  userPoolId: pool.Id,
                  discoverySource: "cognito-manager",
                },
                costMonthly: 0,
                owner: null,
                createdAt: null,
              });

              // Link app client → user pool (member-of)
              const memberEdgeId = `${clientNodeId}--member-of--${poolNodeId}`;
              if (!edges.some((e) => e.id === memberEdgeId)) {
                edges.push({
                  id: memberEdgeId,
                  sourceNodeId: clientNodeId,
                  targetNodeId: poolNodeId,
                  relationshipType: "member-of",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }
        } catch {
          // App client discovery is best-effort
        }
      }
    }

    // Discover Identity Pools
    const identityPoolsResult = await (mgr as {
      listIdentityPools: (maxResults?: number) => Promise<{
        success: boolean;
        data?: Array<{
          IdentityPoolId?: string;
          IdentityPoolName?: string;
        }>;
      }>;
    }).listIdentityPools(50);

    if (identityPoolsResult.success && identityPoolsResult.data) {
      for (const idPool of identityPoolsResult.data) {
        if (!idPool.IdentityPoolId) continue;

        const idPoolNodeId = buildAwsNodeId(
          this.config.accountId,
          "us-east-1",
          "identity",
          `idpool-${idPool.IdentityPoolId}`,
        );

        nodes.push({
          id: idPoolNodeId,
          name: idPool.IdentityPoolName ?? idPool.IdentityPoolId,
          resourceType: "identity",
          provider: "aws",
          region: "us-east-1",
          account: this.config.accountId,
          nativeId: idPool.IdentityPoolId,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "cognito-identity-pool",
            discoverySource: "cognito-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: null,
        });
      }
    }
  }

  /**
   * Enrich discovered nodes with real cost data from AWS Cost Explorer.
   *
   * Delegates to the `@espada/aws` CostManager for CE queries, then
   * applies KG-specific distribution logic to map costs to graph nodes.
   *
   * Strategy:
   * 1. Query `GetCostAndUsage` grouped by SERVICE for the last N days.
   * 2. Map AWS service names to graph resource types.
   * 3. Distribute per-service costs proportionally across discovered nodes
   *    of that type (weighted by static estimates when available).
   * 4. For services with resource-level granularity (EC2, RDS, Lambda),
   *    also query `GetCostAndUsage` with RESOURCE dimension.
   *
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
      // Step 1: Get per-service cost totals (delegates to CostManager)
      const serviceCosts = await this.queryServiceCosts(timePeriod, lookbackDays);
      if (!serviceCosts || serviceCosts.size === 0) return;

      // Step 2: Try resource-level cost data for supported services
      const resourceCosts = await this.queryResourceCosts(timePeriod, lookbackDays);

      // Step 3: Match resource-level costs to nodes by ARN/ID
      if (resourceCosts && resourceCosts.size > 0) {
        this.applyResourceCosts(nodes, resourceCosts);
      }

      // Step 4: Distribute remaining service-level costs to uncosted nodes
      this.distributeServiceCosts(nodes, serviceCosts);
    } catch (error) {
      errors.push({
        resourceType: "custom",
        message: `Cost Explorer enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
        code: (error as { code?: string })?.code,
      });
    }
  }

  /**
   * Query AWS Cost Explorer for per-service monthly costs.
   * Delegates to `@espada/aws` CostManager.getCostSummary().
   *
   * Returns a map of AWS service name → monthly cost in USD.
   */
  private async queryServiceCosts(
    timePeriod: { Start: string; End: string },
    lookbackDays: number,
  ): Promise<Map<string, number> | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      // Use CostManager.getCostSummary() grouped by SERVICE
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

      // Normalize to monthly if lookback > 30 days
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

  /**
   * Query Cost Explorer for resource-level costs via CostManager.
   * Uses DAILY granularity over the last 14 days, then extrapolates to monthly.
   *
   * Returns a map of resource ARN/ID → monthly cost in USD.
   */
  private async queryResourceCosts(
    _timePeriod: { Start: string; End: string },
    _lookbackDays: number,
  ): Promise<Map<string, number> | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      // Resource-level data requires DAILY granularity and max 14 days
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

      // Extrapolate 14 days to monthly (×30/14)
      const factor = 30 / 14;
      for (const [k, v] of resourceCosts.entries()) {
        resourceCosts.set(k, Math.round(v * factor * 100) / 100);
      }

      return resourceCosts.size > 0 ? resourceCosts : null;
    } catch {
      return null;
    }
  }

  /**
   * Apply resource-level Cost Explorer data to matching nodes.
   * Matches by ARN substring or native resource ID.
   */
  private applyResourceCosts(
    nodes: GraphNodeInput[],
    resourceCosts: Map<string, number>,
  ): void {
    for (const node of nodes) {
      for (const [arn, cost] of resourceCosts.entries()) {
        // Match by nativeId (contained in the ARN) or by full ARN match
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

  /**
   * Distribute service-level costs from Cost Explorer to discovered nodes
   * that don't already have resource-level cost data.
   *
   * Strategy: for each AWS service bucket, find matching uncosted nodes
   * and divide the service cost among them (weighted by static estimate
   * if available, otherwise equal split).
   */
  private distributeServiceCosts(
    nodes: GraphNodeInput[],
    serviceCosts: Map<string, number>,
  ): void {
    for (const [awsService, totalCost] of serviceCosts.entries()) {
      const resourceTypes = AWS_SERVICE_TO_RESOURCE_TYPE[awsService];
      if (!resourceTypes) continue;

      // Find nodes of this resource type that don't have CE cost yet
      const uncostdNodes = nodes.filter(
        (n) =>
          resourceTypes.includes(n.resourceType) &&
          n.metadata["costSource"] !== "cost-explorer",
      );
      if (uncostdNodes.length === 0) continue;

      // Weighted distribution: use existing static estimates as weights
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

  // ===========================================================================
  // Extended Capabilities — via @espada/aws
  // ===========================================================================

  /**
   * Forecast future AWS costs using CostManager.forecastCosts().
   *
   * Returns a forecast result or null if the CostManager is unavailable
   * or the forecast fails. This is a new capability enabled by the
   * @espada/aws integration.
   */
  async forecastCosts(options?: {
    /** Forecast horizon in days (default: 30). */
    days?: number;
    /** Granularity: "MONTHLY" | "DAILY" (default: "MONTHLY"). */
    granularity?: string;
  }): Promise<AwsForecastResult | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const days = options?.days ?? 30;
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
      const formatDate = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const result = await (cm as {
        forecastCosts: (opts: unknown) => Promise<{
          success: boolean;
          data?: {
            totalForecastedCost: number;
            forecastPeriods?: Array<{ start: string; end: string; amount: number }>;
            currency?: string;
            confidenceLevel?: number;
          };
          error?: string;
        }>;
      }).forecastCosts({
        timePeriod: { start: formatDate(startDate), end: formatDate(endDate) },
        granularity: options?.granularity ?? "MONTHLY",
        metric: "UNBLENDED_COST",
      });

      if (!result.success || !result.data) return null;

      return {
        totalForecastedCost: result.data.totalForecastedCost,
        forecastPeriods: result.data.forecastPeriods ?? [],
        currency: result.data.currency ?? "USD",
        confidenceLevel: result.data.confidenceLevel,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get optimization recommendations via CostManager.
   *
   * Covers rightsizing, reserved instance, and savings plan opportunities.
   * Returns null if the CostManager is unavailable.
   */
  async getOptimizationRecommendations(): Promise<AwsOptimizationResult | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const result = await (cm as {
        getOptimizationRecommendations: (opts?: unknown) => Promise<{
          success: boolean;
          data?: {
            rightsizing?: Array<{ instanceId: string; currentType: string; recommendedType: string; estimatedSavings: number }>;
            reservedInstances?: Array<{ service: string; recommendedCount: number; estimatedSavings: number }>;
            savingsPlans?: Array<{ type: string; commitment: number; estimatedSavings: number }>;
            totalEstimatedSavings?: number;
          };
          error?: string;
        }>;
      }).getOptimizationRecommendations();

      if (!result.success || !result.data) return null;

      return {
        rightsizing: result.data.rightsizing ?? [],
        reservedInstances: result.data.reservedInstances ?? [],
        savingsPlans: result.data.savingsPlans ?? [],
        totalEstimatedSavings: result.data.totalEstimatedSavings ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Detect unused AWS resources via CostManager.findUnusedResources().
   *
   * Identifies idle EBS volumes, unused EIPs, stale snapshots, cold Lambda
   * functions, idle instances, and unused load balancers.
   */
  async findUnusedResources(): Promise<AwsUnusedResourcesResult | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const result = await (cm as {
        findUnusedResources: (opts?: unknown) => Promise<{
          success: boolean;
          data?: {
            resources: Array<{
              resourceId: string;
              resourceType: string;
              reason: string;
              estimatedMonthlyCost: number;
              region?: string;
              lastUsed?: string;
            }>;
            totalWastedCost: number;
          };
          error?: string;
        }>;
      }).findUnusedResources();

      if (!result.success || !result.data) return null;

      return {
        resources: result.data.resources,
        totalWastedCost: result.data.totalWastedCost,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get incremental infrastructure changes since a given time via CloudTrail.
   *
   * Returns changed resources as partial graph updates: creates, modifies,
   * and deletes detected from CloudTrail infrastructure events.
   */
  async getIncrementalChanges(since: Date): Promise<AwsIncrementalChanges | null> {
    if (this.config.clientFactory) return null; // Not available in test mode

    const ct = await this.getCloudTrailManager();
    if (!ct) return null;

    try {
      const events = await (ct as {
        getInfrastructureEvents: (opts?: { startTime?: Date; endTime?: Date; maxResults?: number }) => Promise<Array<{
          eventId: string;
          eventName: string;
          eventTime: Date;
          eventSource: string;
          awsRegion: string;
          userIdentity: { type?: string; userName?: string; arn?: string };
          requestParameters?: Record<string, unknown>;
          responseElements?: Record<string, unknown>;
          errorCode?: string;
          resources?: Array<{ resourceType?: string; resourceName?: string }>;
        }>>;
      }).getInfrastructureEvents({
        startTime: since,
        endTime: new Date(),
        maxResults: 500,
      });

      const creates: AwsChangeEvent[] = [];
      const modifies: AwsChangeEvent[] = [];
      const deletes: AwsChangeEvent[] = [];

      for (const event of events) {
        if (event.errorCode) continue; // Skip failed actions

        const changeEvent: AwsChangeEvent = {
          eventId: event.eventId,
          eventName: event.eventName,
          eventTime: event.eventTime instanceof Date ? event.eventTime.toISOString() : String(event.eventTime),
          region: event.awsRegion,
          service: event.eventSource.replace(".amazonaws.com", ""),
          actor: event.userIdentity?.userName ?? event.userIdentity?.arn ?? "unknown",
          resources: event.resources?.map((r) => ({
            type: r.resourceType ?? "unknown",
            id: r.resourceName ?? "unknown",
          })) ?? [],
        };

        const name = event.eventName.toLowerCase();
        if (name.startsWith("create") || name.startsWith("run") || name.startsWith("launch")) {
          creates.push(changeEvent);
        } else if (name.startsWith("delete") || name.startsWith("terminate") || name.startsWith("remove")) {
          deletes.push(changeEvent);
        } else if (name.startsWith("modify") || name.startsWith("update") || name.startsWith("put") || name.startsWith("attach") || name.startsWith("detach")) {
          modifies.push(changeEvent);
        }
      }

      return { creates, modifies, deletes, since: since.toISOString(), until: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  /**
   * Get security posture summary via SecurityManager.
   *
   * Collects IAM findings, Security Hub results, GuardDuty alerts, and
   * access analyzer findings. Returns null if SecurityManager is unavailable.
   */
  async getSecurityPosture(): Promise<AwsSecurityPosture | null> {
    if (this.config.clientFactory) return null; // Not available in test mode

    const sm = await this.getSecurityManager();
    if (!sm) return null;

    try {
      // Collect IAM roles for policy analysis
      const rolesResult = await (sm as {
        listRoles: (opts?: unknown) => Promise<{ success: boolean; data?: { roles: Array<{ roleName: string; arn: string; createDate?: string }> } }>;
      }).listRoles();

      // Collect security findings if Security Hub is enabled
      let securityFindings: Array<{ title: string; severity: string; resourceId?: string }> = [];
      try {
        const findingsResult = await (sm as {
          listSecurityFindings: (opts?: unknown) => Promise<{
            success: boolean;
            data?: { findings: Array<{ title: string; severity: string; resources?: Array<{ id?: string }> }> };
          }>;
        }).listSecurityFindings({ maxResults: 100 });

        if (findingsResult.success && findingsResult.data?.findings) {
          securityFindings = findingsResult.data.findings.map((f) => ({
            title: f.title,
            severity: f.severity,
            resourceId: f.resources?.[0]?.id,
          }));
        }
      } catch {
        // Security Hub might not be enabled — non-fatal
      }

      // Collect GuardDuty findings
      let guardDutyFindings: Array<{ title: string; severity: string; type?: string }> = [];
      try {
        const gdResult = await (sm as {
          listGuardDutyFindings: (opts?: unknown) => Promise<{
            success: boolean;
            data?: { findings: Array<{ title: string; severity: string; type?: string }> };
          }>;
        }).listGuardDutyFindings({ maxResults: 50 });

        if (gdResult.success && gdResult.data?.findings) {
          guardDutyFindings = gdResult.data.findings.map((f) => ({
            title: f.title,
            severity: f.severity,
            type: f.type,
          }));
        }
      } catch {
        // GuardDuty might not be enabled — non-fatal
      }

      return {
        iamRoles: rolesResult.success ? (rolesResult.data?.roles.length ?? 0) : 0,
        securityFindings,
        guardDutyFindings,
        scannedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Enrich discovered nodes with security metadata from SecurityManager.
   * Attaches findings to matching nodes by resource ARN/ID.
   */
  async enrichWithSecurity(nodes: GraphNodeInput[]): Promise<void> {
    const posture = await this.getSecurityPosture();
    if (!posture) return;

    // Attach security findings to matching nodes
    for (const finding of posture.securityFindings) {
      if (!finding.resourceId) continue;
      for (const node of nodes) {
        if (
          finding.resourceId.includes(node.nativeId) ||
          node.nativeId.includes(finding.resourceId)
        ) {
          const existing = (node.metadata["securityFindings"] as string[] | undefined) ?? [];
          existing.push(`[${finding.severity}] ${finding.title}`);
          node.metadata["securityFindings"] = existing;
          node.metadata["hasSecurityIssues"] = true;
        }
      }
    }
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
