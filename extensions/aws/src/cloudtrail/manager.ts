/**
 * AWS CloudTrail Integration
 *
 * Provides CloudTrail audit capabilities:
 * - Event querying and filtering
 * - Trail management
 * - Audit event parsing
 * - Infrastructure change tracking
 */

import {
  CloudTrailClient,
  LookupEventsCommand,
  DescribeTrailsCommand,
  GetTrailStatusCommand,
  GetEventSelectorsCommand,
  type LookupAttribute,
  type Event as CloudTrailSDKEvent,
} from "@aws-sdk/client-cloudtrail";
import type { AWSCredentialsManager } from "../credentials/manager.js";
import type {
  CloudTrailEvent,
  CloudTrailUserIdentity,
  CloudTrailQueryOptions,
  CloudTrailTrailInfo,
  CloudTrailAuditSummary,
} from "../types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS_LIMIT = 50; // CloudTrail API limit per request

const INFRASTRUCTURE_EVENT_NAMES = new Set([
  // EC2
  "RunInstances",
  "TerminateInstances",
  "StopInstances",
  "StartInstances",
  "CreateSecurityGroup",
  "DeleteSecurityGroup",
  "AuthorizeSecurityGroupIngress",
  "AuthorizeSecurityGroupEgress",
  "RevokeSecurityGroupIngress",
  "RevokeSecurityGroupEgress",
  "CreateVpc",
  "DeleteVpc",
  "CreateSubnet",
  "DeleteSubnet",
  "CreateInternetGateway",
  "DeleteInternetGateway",
  "AttachInternetGateway",
  "DetachInternetGateway",
  "CreateNatGateway",
  "DeleteNatGateway",
  "CreateRouteTable",
  "DeleteRouteTable",
  "CreateRoute",
  "DeleteRoute",
  "ModifyInstanceAttribute",
  "CreateVolume",
  "DeleteVolume",
  "AttachVolume",
  "DetachVolume",
  "CreateSnapshot",
  "DeleteSnapshot",
  "CreateImage",
  "DeregisterImage",
  "CreateKeyPair",
  "DeleteKeyPair",

  // IAM
  "CreateUser",
  "DeleteUser",
  "CreateRole",
  "DeleteRole",
  "CreatePolicy",
  "DeletePolicy",
  "AttachUserPolicy",
  "DetachUserPolicy",
  "AttachRolePolicy",
  "DetachRolePolicy",
  "CreateAccessKey",
  "DeleteAccessKey",
  "UpdateAccessKey",
  "PutUserPolicy",
  "DeleteUserPolicy",
  "PutRolePolicy",
  "DeleteRolePolicy",
  "CreateGroup",
  "DeleteGroup",
  "AddUserToGroup",
  "RemoveUserFromGroup",
  "UpdateAssumeRolePolicy",

  // S3
  "CreateBucket",
  "DeleteBucket",
  "PutBucketPolicy",
  "DeleteBucketPolicy",
  "PutBucketAcl",
  "PutBucketVersioning",
  "PutBucketEncryption",
  "DeleteBucketEncryption",
  "PutBucketPublicAccessBlock",
  "DeleteBucketPublicAccessBlock",
  "PutBucketLogging",

  // RDS
  "CreateDBInstance",
  "DeleteDBInstance",
  "ModifyDBInstance",
  "CreateDBCluster",
  "DeleteDBCluster",
  "ModifyDBCluster",
  "CreateDBSnapshot",
  "DeleteDBSnapshot",
  "CreateDBSubnetGroup",
  "DeleteDBSubnetGroup",
  "CreateDBParameterGroup",
  "DeleteDBParameterGroup",

  // Lambda
  "CreateFunction",
  "DeleteFunction",
  "UpdateFunctionCode",
  "UpdateFunctionConfiguration",
  "AddPermission",
  "RemovePermission",
  "CreateEventSourceMapping",
  "DeleteEventSourceMapping",

  // CloudFormation
  "CreateStack",
  "DeleteStack",
  "UpdateStack",
  "CreateChangeSet",
  "DeleteChangeSet",
  "ExecuteChangeSet",

  // ECS
  "CreateCluster",
  "DeleteCluster",
  "CreateService",
  "DeleteService",
  "UpdateService",
  "RegisterTaskDefinition",
  "DeregisterTaskDefinition",

  // EKS
  "CreateCluster",
  "DeleteCluster",
  "CreateNodegroup",
  "DeleteNodegroup",
  "UpdateClusterConfig",
  "UpdateNodegroupConfig",

  // KMS
  "CreateKey",
  "ScheduleKeyDeletion",
  "CancelKeyDeletion",
  "EnableKey",
  "DisableKey",
  "CreateAlias",
  "DeleteAlias",
  "PutKeyPolicy",

  // Secrets Manager
  "CreateSecret",
  "DeleteSecret",
  "PutSecretValue",
  "UpdateSecret",
  "RestoreSecret",

  // SQS
  "CreateQueue",
  "DeleteQueue",
  "SetQueueAttributes",

  // SNS
  "CreateTopic",
  "DeleteTopic",
  "SetTopicAttributes",
  "Subscribe",
  "Unsubscribe",

  // DynamoDB
  "CreateTable",
  "DeleteTable",
  "UpdateTable",
  "CreateGlobalTable",
  "UpdateGlobalTable",

  // API Gateway
  "CreateRestApi",
  "DeleteRestApi",
  "CreateStage",
  "DeleteStage",
  "CreateDeployment",
  "DeleteDeployment",

  // ElastiCache
  "CreateCacheCluster",
  "DeleteCacheCluster",
  "ModifyCacheCluster",
  "CreateReplicationGroup",
  "DeleteReplicationGroup",
  "ModifyReplicationGroup",
]);

const SECURITY_EVENT_NAMES = new Set([
  // Console & API access
  "ConsoleLogin",
  "GetSessionToken",
  "AssumeRole",
  "AssumeRoleWithSAML",
  "AssumeRoleWithWebIdentity",
  "GetFederationToken",

  // IAM changes
  "CreateUser",
  "DeleteUser",
  "CreateRole",
  "DeleteRole",
  "CreatePolicy",
  "DeletePolicy",
  "AttachUserPolicy",
  "DetachUserPolicy",
  "AttachRolePolicy",
  "DetachRolePolicy",
  "CreateAccessKey",
  "DeleteAccessKey",
  "UpdateAccessKey",
  "DeactivateMFADevice",
  "DeleteVirtualMFADevice",
  "UpdateLoginProfile",
  "CreateLoginProfile",
  "DeleteLoginProfile",
  "ChangePassword",

  // Security groups
  "AuthorizeSecurityGroupIngress",
  "AuthorizeSecurityGroupEgress",
  "RevokeSecurityGroupIngress",
  "RevokeSecurityGroupEgress",
  "CreateSecurityGroup",
  "DeleteSecurityGroup",

  // Network ACLs
  "CreateNetworkAclEntry",
  "DeleteNetworkAclEntry",
  "ReplaceNetworkAclEntry",

  // Encryption
  "DisableKey",
  "ScheduleKeyDeletion",
  "PutKeyPolicy",
  "DeleteBucketEncryption",
  "PutBucketAcl",
  "PutBucketPolicy",
  "DeleteBucketPolicy",
  "PutBucketPublicAccessBlock",
  "DeleteBucketPublicAccessBlock",

  // Secrets
  "DeleteSecret",
  "PutSecretValue",
  "GetSecretValue",

  // CloudTrail itself
  "StopLogging",
  "DeleteTrail",
  "UpdateTrail",
  "PutEventSelectors",
]);

// =============================================================================
// CloudTrail Manager
// =============================================================================

export class AWSCloudTrailManager {
  private credentialsManager: AWSCredentialsManager;
  private defaultRegion: string;

  constructor(credentialsManager: AWSCredentialsManager, defaultRegion?: string) {
    this.credentialsManager = credentialsManager;
    this.defaultRegion = defaultRegion ?? "us-east-1";
  }

  /**
   * Query CloudTrail events
   */
  async queryEvents(options: CloudTrailQueryOptions = {}): Promise<CloudTrailEvent[]> {
    const credentials = await this.credentialsManager.getCredentials();
    const region = options.region ?? credentials.region ?? this.defaultRegion;

    const client = new CloudTrailClient({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    const events: CloudTrailEvent[] = [];
    let nextToken: string | undefined;
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

    do {
      // Build lookup attributes
      const lookupAttributes: LookupAttribute[] = [];
      
      if (options.eventName) {
        lookupAttributes.push({
          AttributeKey: "EventName",
          AttributeValue: options.eventName,
        });
      }
      
      if (options.eventSource) {
        lookupAttributes.push({
          AttributeKey: "EventSource",
          AttributeValue: options.eventSource,
        });
      }
      
      if (options.username) {
        lookupAttributes.push({
          AttributeKey: "Username",
          AttributeValue: options.username,
        });
      }
      
      if (options.resourceType) {
        lookupAttributes.push({
          AttributeKey: "ResourceType",
          AttributeValue: options.resourceType,
        });
      }
      
      if (options.resourceName) {
        lookupAttributes.push({
          AttributeKey: "ResourceName",
          AttributeValue: options.resourceName,
        });
      }

      if (options.eventId) {
        lookupAttributes.push({
          AttributeKey: "EventId",
          AttributeValue: options.eventId,
        });
      }

      const response = await client.send(new LookupEventsCommand({
        StartTime: options.startTime,
        EndTime: options.endTime,
        LookupAttributes: lookupAttributes.length > 0 ? lookupAttributes : undefined,
        MaxResults: Math.min(MAX_RESULTS_LIMIT, maxResults - events.length),
        NextToken: nextToken,
      }));

      for (const event of response.Events ?? []) {
        const parsed = this.parseEvent(event);
        if (parsed) {
          // Apply additional filters
          if (options.readOnly !== undefined && parsed.readOnly !== options.readOnly) {
            continue;
          }
          events.push(parsed);
        }
      }

      nextToken = response.NextToken;
    } while (nextToken && events.length < maxResults);

    return events;
  }

  /**
   * Get infrastructure change events
   */
  async getInfrastructureEvents(options: Omit<CloudTrailQueryOptions, "eventName"> = {}): Promise<CloudTrailEvent[]> {
    const events = await this.queryEvents({
      ...options,
      maxResults: options.maxResults ?? 200,
    });

    return events.filter((e) => INFRASTRUCTURE_EVENT_NAMES.has(e.eventName));
  }

  /**
   * Get security-related events
   */
  async getSecurityEvents(options: Omit<CloudTrailQueryOptions, "eventName"> = {}): Promise<CloudTrailEvent[]> {
    const events = await this.queryEvents({
      ...options,
      maxResults: options.maxResults ?? 200,
    });

    return events.filter((e) => SECURITY_EVENT_NAMES.has(e.eventName));
  }

  /**
   * Get events by user
   */
  async getEventsByUser(
    username: string,
    options: Omit<CloudTrailQueryOptions, "username"> = {},
  ): Promise<CloudTrailEvent[]> {
    return this.queryEvents({
      ...options,
      username,
    });
  }

  /**
   * Get events for a specific resource
   */
  async getResourceEvents(
    resourceArn: string,
    options: Omit<CloudTrailQueryOptions, "resourceName"> = {},
  ): Promise<CloudTrailEvent[]> {
    // Parse ARN to get resource name
    const arnParts = resourceArn.split(":");
    const resourcePart = arnParts[arnParts.length - 1];
    const resourceName = resourcePart.includes("/")
      ? resourcePart.split("/").pop()!
      : resourcePart;

    return this.queryEvents({
      ...options,
      resourceName,
    });
  }

  /**
   * Get failed events (access denied, etc.)
   */
  async getFailedEvents(options: CloudTrailQueryOptions = {}): Promise<CloudTrailEvent[]> {
    const events = await this.queryEvents(options);
    return events.filter((e) => e.errorCode !== undefined);
  }

  /**
   * Get trail information
   */
  async getTrails(region?: string): Promise<CloudTrailTrailInfo[]> {
    const credentials = await this.credentialsManager.getCredentials();
    const targetRegion = region ?? credentials.region ?? this.defaultRegion;

    const client = new CloudTrailClient({
      region: targetRegion,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    const response = await client.send(new DescribeTrailsCommand({}));
    const trails: CloudTrailTrailInfo[] = [];

    for (const trail of response.trailList ?? []) {
      // Get trail status
      let isLogging = false;
      let latestDeliveryTime: Date | undefined;
      
      try {
        const statusResponse = await client.send(new GetTrailStatusCommand({
          Name: trail.Name,
        }));
        isLogging = statusResponse.IsLogging ?? false;
        latestDeliveryTime = statusResponse.LatestDeliveryTime;
      } catch {
        // Status unavailable
      }

      // Get event selectors
      let hasDataEvents = false;
      let hasManagementEvents = true;
      
      try {
        const selectorsResponse = await client.send(new GetEventSelectorsCommand({
          TrailName: trail.Name,
        }));
        for (const selector of selectorsResponse.EventSelectors ?? []) {
          if (selector.DataResources && selector.DataResources.length > 0) {
            hasDataEvents = true;
          }
          if (selector.IncludeManagementEvents !== undefined) {
            hasManagementEvents = selector.IncludeManagementEvents;
          }
        }
      } catch {
        // Selectors unavailable
      }

      trails.push({
        name: trail.Name ?? "unknown",
        arn: trail.TrailARN,
        homeRegion: trail.HomeRegion,
        s3BucketName: trail.S3BucketName,
        s3KeyPrefix: trail.S3KeyPrefix,
        isMultiRegion: trail.IsMultiRegionTrail ?? false,
        isOrganizationTrail: trail.IsOrganizationTrail ?? false,
        includeGlobalServiceEvents: trail.IncludeGlobalServiceEvents ?? false,
        hasLogFileValidation: trail.LogFileValidationEnabled ?? false,
        isLogging,
        latestDeliveryTime,
        hasDataEvents,
        hasManagementEvents,
        cloudWatchLogsLogGroupArn: trail.CloudWatchLogsLogGroupArn,
        cloudWatchLogsRoleArn: trail.CloudWatchLogsRoleArn,
        kmsKeyId: trail.KmsKeyId,
      });
    }

    return trails;
  }

  /**
   * Generate audit summary
   */
  async generateAuditSummary(options: CloudTrailQueryOptions = {}): Promise<CloudTrailAuditSummary> {
    const events = await this.queryEvents({
      ...options,
      maxResults: options.maxResults ?? 500,
    });

    // Count events by type
    const eventCounts = new Map<string, number>();
    const userCounts = new Map<string, number>();
    const serviceCounts = new Map<string, number>();
    const errorCounts = new Map<string, number>();
    const regionCounts = new Map<string, number>();

    let readOnlyCount = 0;
    let writeCount = 0;
    let errorCount = 0;
    let infrastructureChangeCount = 0;
    let securityEventCount = 0;

    for (const event of events) {
      // Event counts
      eventCounts.set(event.eventName, (eventCounts.get(event.eventName) ?? 0) + 1);

      // User counts
      const user = event.userIdentity.userName ?? event.userIdentity.principalId ?? "unknown";
      userCounts.set(user, (userCounts.get(user) ?? 0) + 1);

      // Service counts
      const service = event.eventSource.replace(".amazonaws.com", "");
      serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);

      // Region counts
      regionCounts.set(event.awsRegion, (regionCounts.get(event.awsRegion) ?? 0) + 1);

      // Read/write
      if (event.readOnly) {
        readOnlyCount++;
      } else {
        writeCount++;
      }

      // Errors
      if (event.errorCode) {
        errorCount++;
        errorCounts.set(event.errorCode, (errorCounts.get(event.errorCode) ?? 0) + 1);
      }

      // Infrastructure changes
      if (INFRASTRUCTURE_EVENT_NAMES.has(event.eventName)) {
        infrastructureChangeCount++;
      }

      // Security events
      if (SECURITY_EVENT_NAMES.has(event.eventName)) {
        securityEventCount++;
      }
    }

    // Sort and get top items
    const sortByCount = <K>(map: Map<K, number>, limit: number): Array<{ name: K; count: number }> =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([name, count]) => ({ name, count }));

    return {
      totalEvents: events.length,
      timeRange: {
        start: events.length > 0 ? events[events.length - 1].eventTime : new Date(),
        end: events.length > 0 ? events[0].eventTime : new Date(),
      },
      readOnlyCount,
      writeCount,
      errorCount,
      infrastructureChangeCount,
      securityEventCount,
      topEvents: sortByCount(eventCounts, 10) as Array<{ name: string; count: number }>,
      topUsers: sortByCount(userCounts, 10) as Array<{ name: string; count: number }>,
      topServices: sortByCount(serviceCounts, 10) as Array<{ name: string; count: number }>,
      topErrors: sortByCount(errorCounts, 5) as Array<{ name: string; count: number }>,
      topRegions: sortByCount(regionCounts, 5) as Array<{ name: string; count: number }>,
    };
  }

  /**
   * Parse a CloudTrail event from the SDK response
   */
  private parseEvent(event: CloudTrailSDKEvent): CloudTrailEvent | null {
    if (!event.EventId || !event.EventName || !event.EventTime || !event.EventSource) {
      return null;
    }

    // Parse CloudTrailEvent from the raw JSON if available
    let cloudTrailEventData: Record<string, unknown> = {};
    if (event.CloudTrailEvent) {
      try {
        cloudTrailEventData = JSON.parse(event.CloudTrailEvent);
      } catch {
        // Ignore parse errors
      }
    }

    // Parse user identity
    const rawUserIdentity = cloudTrailEventData.userIdentity as Record<string, unknown> | undefined;
    const userIdentity: CloudTrailUserIdentity = {
      type: (rawUserIdentity?.type as string) ?? "Unknown",
      principalId: (rawUserIdentity?.principalId as string) ?? event.Username,
      arn: rawUserIdentity?.arn as string | undefined,
      accountId: rawUserIdentity?.accountId as string | undefined,
      userName: event.Username ?? (rawUserIdentity?.userName as string | undefined),
      invokedBy: rawUserIdentity?.invokedBy as string | undefined,
    };

    // Parse session context if present
    const sessionContext = rawUserIdentity?.sessionContext as Record<string, unknown> | undefined;
    if (sessionContext) {
      userIdentity.sessionContext = {
        attributes: sessionContext.attributes as Record<string, unknown> | undefined,
        sessionIssuer: sessionContext.sessionIssuer as Record<string, unknown> | undefined,
      };
    }

    // Parse resources
    const resources = (event.Resources ?? []).map((r) => ({
      resourceType: r.ResourceType,
      resourceName: r.ResourceName,
    }));

    return {
      eventId: event.EventId,
      eventName: event.EventName,
      eventTime: event.EventTime,
      eventSource: event.EventSource,
      awsRegion: (cloudTrailEventData.awsRegion as string) ?? "unknown",
      sourceIPAddress: cloudTrailEventData.sourceIPAddress as string | undefined,
      userAgent: cloudTrailEventData.userAgent as string | undefined,
      userIdentity,
      resources,
      requestParameters: cloudTrailEventData.requestParameters as Record<string, unknown> | undefined,
      responseElements: cloudTrailEventData.responseElements as Record<string, unknown> | undefined,
      errorCode: cloudTrailEventData.errorCode as string | undefined,
      errorMessage: cloudTrailEventData.errorMessage as string | undefined,
      readOnly: cloudTrailEventData.readOnly as boolean | undefined,
      eventType: cloudTrailEventData.eventType as string | undefined,
      managementEvent: cloudTrailEventData.managementEvent as boolean | undefined,
      recipientAccountId: cloudTrailEventData.recipientAccountId as string | undefined,
      sharedEventId: cloudTrailEventData.sharedEventID as string | undefined,
      vpcEndpointId: cloudTrailEventData.vpcEndpointId as string | undefined,
    };
  }

  /**
   * Set default region
   */
  setDefaultRegion(region: string): void {
    this.defaultRegion = region;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AWS CloudTrail manager
 */
export function createCloudTrailManager(
  credentialsManager: AWSCredentialsManager,
  defaultRegion?: string,
): AWSCloudTrailManager {
  return new AWSCloudTrailManager(credentialsManager, defaultRegion);
}
