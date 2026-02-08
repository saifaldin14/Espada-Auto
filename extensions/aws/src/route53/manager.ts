/**
 * Amazon Route 53 Manager - DNS Management
 * 
 * Comprehensive Route 53 operations with:
 * - Hosted zone management (public and private)
 * - DNS record operations (A, AAAA, CNAME, MX, TXT, etc.)
 * - Health checks and failover routing
 * - Traffic policies and routing policies
 * - Domain registration (optional)
 * - DNSSEC configuration
 * - Query logging
 * - Alias records for AWS resources
 */

import { withAWSRetry, type AWSRetryOptions } from '../retry.js';

import {
  Route53Client,
  CreateHostedZoneCommand,
  DeleteHostedZoneCommand,
  GetHostedZoneCommand,
  ListHostedZonesCommand,
  ListHostedZonesByNameCommand,
  UpdateHostedZoneCommentCommand,
  CreateVPCAssociationAuthorizationCommand,
  DeleteVPCAssociationAuthorizationCommand,
  AssociateVPCWithHostedZoneCommand,
  DisassociateVPCFromHostedZoneCommand,
  ListVPCAssociationAuthorizationsCommand,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
  GetChangeCommand,
  CreateHealthCheckCommand,
  DeleteHealthCheckCommand,
  GetHealthCheckCommand,
  ListHealthChecksCommand,
  UpdateHealthCheckCommand,
  GetHealthCheckStatusCommand,
  CreateTrafficPolicyCommand,
  DeleteTrafficPolicyCommand,
  GetTrafficPolicyCommand,
  ListTrafficPoliciesCommand,
  CreateTrafficPolicyInstanceCommand,
  DeleteTrafficPolicyInstanceCommand,
  ListTrafficPolicyInstancesCommand,
  CreateReusableDelegationSetCommand,
  DeleteReusableDelegationSetCommand,
  GetReusableDelegationSetCommand,
  ListReusableDelegationSetsCommand,
  CreateQueryLoggingConfigCommand,
  DeleteQueryLoggingConfigCommand,
  GetQueryLoggingConfigCommand,
  ListQueryLoggingConfigsCommand,
  EnableHostedZoneDNSSECCommand,
  DisableHostedZoneDNSSECCommand,
  GetDNSSECCommand,
  CreateKeySigningKeyCommand,
  DeleteKeySigningKeyCommand,
  ActivateKeySigningKeyCommand,
  DeactivateKeySigningKeyCommand,
  ListTagsForResourceCommand,
  ChangeTagsForResourceCommand,
  TestDNSAnswerCommand,
  GetHostedZoneCountCommand,
  GetHealthCheckCountCommand,
  type HostedZone,
  type ResourceRecordSet,
  type HealthCheck,
  type TrafficPolicy,
  type TrafficPolicyInstance,
  type DelegationSet,
  type QueryLoggingConfig,
  type Change,
  type ResourceRecord,
  type AliasTarget,
  type GeoLocation,
  type CidrRoutingConfig,
  type HealthCheckConfig,
  type Tag,
  ChangeAction,
  RRType,
  HealthCheckType,
  ResourceRecordSetFailover,
  ResourceRecordSetRegion,
  VPCRegion,
} from '@aws-sdk/client-route-53';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Route53ManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
  defaultTags?: Record<string, string>;
}

export type RecordType = 'A' | 'AAAA' | 'CAA' | 'CNAME' | 'DS' | 'MX' | 'NAPTR' | 'NS' | 'PTR' | 'SOA' | 'SPF' | 'SRV' | 'TXT';

export interface CreateHostedZoneConfig {
  name: string;
  comment?: string;
  privateZone?: boolean;
  vpcId?: string;
  vpcRegion?: string;
  delegationSetId?: string;
  tags?: Record<string, string>;
}

export interface RecordConfig {
  hostedZoneId: string;
  name: string;
  type: RecordType;
  ttl?: number;
  values?: string[];
  /** Alias target for AWS resources */
  aliasTarget?: {
    hostedZoneId: string;
    dnsName: string;
    evaluateTargetHealth?: boolean;
  };
  /** Health check ID for failover */
  healthCheckId?: string;
  /** Set ID for weighted/latency/failover/geolocation routing */
  setIdentifier?: string;
  /** Weight for weighted routing (0-255) */
  weight?: number;
  /** Region for latency routing */
  region?: string;
  /** Failover type */
  failover?: 'PRIMARY' | 'SECONDARY';
  /** Geolocation routing */
  geoLocation?: {
    continentCode?: string;
    countryCode?: string;
    subdivisionCode?: string;
  };
  /** Multi-value answer routing */
  multiValueAnswer?: boolean;
  /** CIDR routing */
  cidrRoutingConfig?: {
    collectionId: string;
    locationName: string;
  };
}

export interface CreateHealthCheckConfig {
  name?: string;
  type: 'HTTP' | 'HTTPS' | 'HTTP_STR_MATCH' | 'HTTPS_STR_MATCH' | 'TCP' | 'CLOUDWATCH_METRIC' | 'CALCULATED' | 'RECOVERY_CONTROL';
  /** For HTTP/HTTPS/TCP checks */
  ipAddress?: string;
  fqdn?: string;
  port?: number;
  resourcePath?: string;
  searchString?: string;
  requestInterval?: number; // 10 or 30 seconds
  failureThreshold?: number; // 1-10
  /** For calculated health checks */
  childHealthChecks?: string[];
  healthThreshold?: number;
  /** For CloudWatch metric checks */
  cloudWatchAlarmConfig?: {
    alarmName: string;
    region: string;
  };
  /** Enable latency measurement */
  measureLatency?: boolean;
  /** Invert health check status */
  inverted?: boolean;
  /** Disable health check */
  disabled?: boolean;
  /** Enable SNI for HTTPS */
  enableSNI?: boolean;
  /** Regions to check from */
  regions?: string[];
  /** Insufficient data handling */
  insufficientDataHealthStatus?: 'Healthy' | 'Unhealthy' | 'LastKnownStatus';
  tags?: Record<string, string>;
}

export interface TrafficPolicyConfig {
  name: string;
  document: string; // JSON policy document
  comment?: string;
}

export interface TrafficPolicyInstanceConfig {
  hostedZoneId: string;
  name: string;
  trafficPolicyId: string;
  trafficPolicyVersion: number;
  ttl: number;
}

export interface QueryLoggingConfigInput {
  hostedZoneId: string;
  cloudWatchLogsLogGroupArn: string;
}

export interface HostedZoneMetrics {
  hostedZoneId: string;
  name: string;
  recordCount: number;
  comment?: string;
  privateZone: boolean;
  linkedVpcs?: { vpcId: string; vpcRegion: string }[];
  nameServers?: string[];
  dnssecStatus?: string;
  queryLoggingEnabled: boolean;
  tags: Record<string, string>;
}

export interface Route53OperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  changeId?: string;
}

// ============================================================================
// Route 53 Manager Implementation
// ============================================================================

export class Route53Manager {
  private client: Route53Client;
  private config: Route53ManagerConfig;
  private retryOptions: AWSRetryOptions;

  constructor(config: Route53ManagerConfig = {}, retryOptions: AWSRetryOptions = {}) {
    this.config = config;
    this.retryOptions = retryOptions;
    
    // Route 53 is a global service, always use us-east-1
    this.client = new Route53Client({
      region: 'us-east-1',
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });
  }

  // --------------------------------------------------------------------------
  // Retry Helper
  // --------------------------------------------------------------------------

  private async withRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return withAWSRetry(fn, {
      ...this.retryOptions,
      label: label || this.retryOptions.label,
    });
  }

  // ==========================================================================
  // Hosted Zone Operations
  // ==========================================================================

  /**
   * Create a new hosted zone
   */
  async createHostedZone(config: CreateHostedZoneConfig): Promise<Route53OperationResult<HostedZone>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new CreateHostedZoneCommand({
          Name: config.name,
          CallerReference: `${config.name}-${Date.now()}`,
          HostedZoneConfig: {
            Comment: config.comment,
            PrivateZone: config.privateZone ?? false,
          },
          VPC: config.privateZone && config.vpcId ? {
            VPCId: config.vpcId,
            VPCRegion: config.vpcRegion as VPCRegion | undefined,
          } : undefined,
          DelegationSetId: config.delegationSetId,
        })),
        'CreateHostedZone'
      );

      // Add tags if specified
      if (config.tags && Object.keys(config.tags).length > 0 && response.HostedZone?.Id) {
        const zoneId = response.HostedZone.Id.replace('/hostedzone/', '');
        await this.tagHostedZone(zoneId, config.tags);
      }

      return {
        success: true,
        data: response.HostedZone,
        changeId: response.ChangeInfo?.Id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a hosted zone
   */
  async deleteHostedZone(hostedZoneId: string): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      await this.withRetry(() => this.client.send(new DeleteHostedZoneCommand({
        Id: zoneId,
      })), 'DeleteHostedZone');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get hosted zone details
   */
  async getHostedZone(hostedZoneId: string): Promise<Route53OperationResult<HostedZoneMetrics>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      const [zoneResponse, tagsResponse, dnssecResponse, loggingResponse] = await Promise.all([
        this.withRetry(() => this.client.send(new GetHostedZoneCommand({ Id: zoneId })), 'GetHostedZone'),
        this.withRetry(() => this.client.send(new ListTagsForResourceCommand({
          ResourceType: 'hostedzone',
          ResourceId: zoneId,
        })), 'ListTagsForResource'),
        this.withRetry(() => this.client.send(new GetDNSSECCommand({ HostedZoneId: zoneId })), 'GetDNSSEC').catch(() => null),
        this.withRetry(() => this.client.send(new ListQueryLoggingConfigsCommand({ HostedZoneId: zoneId })), 'ListQueryLoggingConfigs').catch(() => null),
      ]);

      const zone = zoneResponse.HostedZone!;
      const tags: Record<string, string> = {};
      for (const tag of tagsResponse.ResourceTagSet?.Tags ?? []) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }

      const metrics: HostedZoneMetrics = {
        hostedZoneId: zone.Id!.replace('/hostedzone/', ''),
        name: zone.Name!,
        recordCount: zone.ResourceRecordSetCount ?? 0,
        comment: zone.Config?.Comment,
        privateZone: zone.Config?.PrivateZone ?? false,
        linkedVpcs: zoneResponse.VPCs?.map(vpc => ({
          vpcId: vpc.VPCId!,
          vpcRegion: vpc.VPCRegion!,
        })),
        nameServers: zoneResponse.DelegationSet?.NameServers,
        dnssecStatus: dnssecResponse?.Status?.ServeSignature,
        queryLoggingEnabled: (loggingResponse?.QueryLoggingConfigs?.length ?? 0) > 0,
        tags,
      };

      return { success: true, data: metrics };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all hosted zones
   */
  async listHostedZones(maxItems?: number): Promise<Route53OperationResult<HostedZone[]>> {
    try {
      const zones: HostedZone[] = [];
      let marker: string | undefined;

      do {
        const response = await this.withRetry(() => this.client.send(new ListHostedZonesCommand({
          Marker: marker,
          MaxItems: maxItems ? Math.min(maxItems - zones.length, 100) : 100,
        })), 'ListHostedZones');

        zones.push(...(response.HostedZones ?? []));
        marker = response.NextMarker;

        if (maxItems && zones.length >= maxItems) break;
      } while (marker);

      return { success: true, data: zones };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find hosted zone by domain name
   */
  async findHostedZoneByName(domainName: string): Promise<Route53OperationResult<HostedZone | undefined>> {
    try {
      // Ensure domain ends with a dot
      const normalizedName = domainName.endsWith('.') ? domainName : `${domainName}.`;
      
      const response = await this.withRetry(() => this.client.send(new ListHostedZonesByNameCommand({
        DNSName: normalizedName,
        MaxItems: 1,
      })), 'ListHostedZonesByName');

      const zone = response.HostedZones?.find(z => z.Name === normalizedName);
      return { success: true, data: zone };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update hosted zone comment
   */
  async updateHostedZoneComment(hostedZoneId: string, comment: string): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      await this.withRetry(() => this.client.send(new UpdateHostedZoneCommentCommand({
        Id: zoneId,
        Comment: comment,
      })), 'UpdateHostedZoneComment');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Record Operations
  // ==========================================================================

  /**
   * Create or update a DNS record
   */
  async upsertRecord(config: RecordConfig): Promise<Route53OperationResult<void>> {
    return this.changeRecord('UPSERT', config);
  }

  /**
   * Create a DNS record
   */
  async createRecord(config: RecordConfig): Promise<Route53OperationResult<void>> {
    return this.changeRecord('CREATE', config);
  }

  /**
   * Delete a DNS record
   */
  async deleteRecord(config: RecordConfig): Promise<Route53OperationResult<void>> {
    return this.changeRecord('DELETE', config);
  }

  /**
   * Internal method to change a record
   */
  private async changeRecord(action: 'CREATE' | 'DELETE' | 'UPSERT', config: RecordConfig): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = config.hostedZoneId.replace('/hostedzone/', '');
      
      // Ensure record name ends with a dot
      const recordName = config.name.endsWith('.') ? config.name : `${config.name}.`;

      const resourceRecordSet: ResourceRecordSet = {
        Name: recordName,
        Type: config.type as RRType,
      };

      if (config.aliasTarget) {
        resourceRecordSet.AliasTarget = {
          HostedZoneId: config.aliasTarget.hostedZoneId,
          DNSName: config.aliasTarget.dnsName,
          EvaluateTargetHealth: config.aliasTarget.evaluateTargetHealth ?? false,
        };
      } else {
        resourceRecordSet.TTL = config.ttl ?? 300;
        resourceRecordSet.ResourceRecords = config.values?.map(value => ({ Value: value }));
      }

      if (config.healthCheckId) {
        resourceRecordSet.HealthCheckId = config.healthCheckId;
      }

      if (config.setIdentifier) {
        resourceRecordSet.SetIdentifier = config.setIdentifier;
      }

      if (config.weight !== undefined) {
        resourceRecordSet.Weight = config.weight;
      }

      if (config.region) {
        resourceRecordSet.Region = config.region as ResourceRecordSetRegion;
      }

      if (config.failover) {
        resourceRecordSet.Failover = config.failover as ResourceRecordSetFailover;
      }

      if (config.geoLocation) {
        resourceRecordSet.GeoLocation = {
          ContinentCode: config.geoLocation.continentCode,
          CountryCode: config.geoLocation.countryCode,
          SubdivisionCode: config.geoLocation.subdivisionCode,
        };
      }

      if (config.multiValueAnswer) {
        resourceRecordSet.MultiValueAnswer = true;
      }

      if (config.cidrRoutingConfig) {
        resourceRecordSet.CidrRoutingConfig = {
          CollectionId: config.cidrRoutingConfig.collectionId,
          LocationName: config.cidrRoutingConfig.locationName,
        };
      }

      const response = await this.withRetry(() => this.client.send(new ChangeResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        ChangeBatch: {
          Changes: [{
            Action: action as ChangeAction,
            ResourceRecordSet: resourceRecordSet,
          }],
        },
      })), 'ChangeResourceRecordSets');

      return {
        success: true,
        changeId: response.ChangeInfo?.Id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Batch change multiple records
   */
  async batchChangeRecords(
    hostedZoneId: string,
    changes: { action: 'CREATE' | 'DELETE' | 'UPSERT'; record: RecordConfig }[],
    comment?: string
  ): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      const changeBatch: Change[] = changes.map(change => {
        const recordName = change.record.name.endsWith('.') ? change.record.name : `${change.record.name}.`;
        
        const resourceRecordSet: ResourceRecordSet = {
          Name: recordName,
          Type: change.record.type as RRType,
        };

        if (change.record.aliasTarget) {
          resourceRecordSet.AliasTarget = {
            HostedZoneId: change.record.aliasTarget.hostedZoneId,
            DNSName: change.record.aliasTarget.dnsName,
            EvaluateTargetHealth: change.record.aliasTarget.evaluateTargetHealth ?? false,
          };
        } else {
          resourceRecordSet.TTL = change.record.ttl ?? 300;
          resourceRecordSet.ResourceRecords = change.record.values?.map(value => ({ Value: value }));
        }

        // Add routing policy fields if present
        if (change.record.setIdentifier) resourceRecordSet.SetIdentifier = change.record.setIdentifier;
        if (change.record.weight !== undefined) resourceRecordSet.Weight = change.record.weight;
        if (change.record.region) resourceRecordSet.Region = change.record.region as ResourceRecordSetRegion;
        if (change.record.failover) resourceRecordSet.Failover = change.record.failover as ResourceRecordSetFailover;
        if (change.record.healthCheckId) resourceRecordSet.HealthCheckId = change.record.healthCheckId;

        return {
          Action: change.action as ChangeAction,
          ResourceRecordSet: resourceRecordSet,
        };
      });

      const response = await this.withRetry(() => this.client.send(new ChangeResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        ChangeBatch: {
          Comment: comment,
          Changes: changeBatch,
        },
      })), 'ChangeResourceRecordSets');

      return {
        success: true,
        changeId: response.ChangeInfo?.Id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List DNS records in a hosted zone
   */
  async listRecords(
    hostedZoneId: string,
    options?: {
      type?: RecordType;
      name?: string;
      maxItems?: number;
    }
  ): Promise<Route53OperationResult<ResourceRecordSet[]>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      const records: ResourceRecordSet[] = [];
      let startRecordName: string | undefined = options?.name;
      let startRecordType: RRType | undefined = options?.type as RRType | undefined;

      do {
        const response = await this.withRetry(() => this.client.send(new ListResourceRecordSetsCommand({
          HostedZoneId: zoneId,
          StartRecordName: startRecordName,
          StartRecordType: startRecordType,
          MaxItems: options?.maxItems ? Math.min(options.maxItems - records.length, 300) : 300,
        })), 'ListResourceRecordSets');

        records.push(...(response.ResourceRecordSets ?? []));
        
        if (response.IsTruncated) {
          startRecordName = response.NextRecordName;
          startRecordType = response.NextRecordType;
        } else {
          break;
        }

        if (options?.maxItems && records.length >= options.maxItems) break;
      } while (true);

      return { success: true, data: records };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get a specific record
   */
  async getRecord(
    hostedZoneId: string,
    name: string,
    type: RecordType,
    setIdentifier?: string
  ): Promise<Route53OperationResult<ResourceRecordSet | undefined>> {
    try {
      const result = await this.listRecords(hostedZoneId, { name, type, maxItems: 10 });
      
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const normalizedName = name.endsWith('.') ? name : `${name}.`;
      const record = result.data?.find(r => 
        r.Name === normalizedName && 
        r.Type === type &&
        (!setIdentifier || r.SetIdentifier === setIdentifier)
      );

      return { success: true, data: record };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Health Check Operations
  // ==========================================================================

  /**
   * Create a health check
   */
  async createHealthCheck(config: CreateHealthCheckConfig): Promise<Route53OperationResult<HealthCheck>> {
    try {
      const healthCheckConfig: HealthCheckConfig = {
        Type: config.type as HealthCheckType,
        IPAddress: config.ipAddress,
        FullyQualifiedDomainName: config.fqdn,
        Port: config.port,
        ResourcePath: config.resourcePath,
        SearchString: config.searchString,
        RequestInterval: config.requestInterval ?? 30,
        FailureThreshold: config.failureThreshold ?? 3,
        MeasureLatency: config.measureLatency,
        Inverted: config.inverted,
        Disabled: config.disabled,
        EnableSNI: config.enableSNI,
        Regions: config.regions,
        InsufficientDataHealthStatus: config.insufficientDataHealthStatus,
        ChildHealthChecks: config.childHealthChecks,
        HealthThreshold: config.healthThreshold,
      } as any;

      if (config.cloudWatchAlarmConfig) {
        (healthCheckConfig as any).AlarmIdentifier = {
          Name: config.cloudWatchAlarmConfig.alarmName,
          Region: config.cloudWatchAlarmConfig.region,
        };
      }

      const response = await this.withRetry(() => this.client.send(new CreateHealthCheckCommand({
        CallerReference: `healthcheck-${Date.now()}`,
        HealthCheckConfig: healthCheckConfig as any,
      })), 'CreateHealthCheck');

      // Add tags if specified
      if (config.tags && Object.keys(config.tags).length > 0 && response.HealthCheck?.Id) {
        await this.tagHealthCheck(response.HealthCheck.Id, config.tags);
      }

      // Add name tag if specified
      if (config.name && response.HealthCheck?.Id) {
        await this.tagHealthCheck(response.HealthCheck.Id, { Name: config.name });
      }

      return { success: true, data: response.HealthCheck };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a health check
   */
  async deleteHealthCheck(healthCheckId: string): Promise<Route53OperationResult<void>> {
    try {
      await this.withRetry(() => this.client.send(new DeleteHealthCheckCommand({
        HealthCheckId: healthCheckId,
      })), 'DeleteHealthCheck');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get health check details
   */
  async getHealthCheck(healthCheckId: string): Promise<Route53OperationResult<HealthCheck>> {
    try {
      const response = await this.withRetry(() => this.client.send(new GetHealthCheckCommand({
        HealthCheckId: healthCheckId,
      })), 'GetHealthCheck');

      return { success: true, data: response.HealthCheck };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all health checks
   */
  async listHealthChecks(maxItems?: number): Promise<Route53OperationResult<HealthCheck[]>> {
    try {
      const healthChecks: HealthCheck[] = [];
      let marker: string | undefined;

      do {
        const response = await this.withRetry(() => this.client.send(new ListHealthChecksCommand({
          Marker: marker,
          MaxItems: maxItems ? Math.min(maxItems - healthChecks.length, 100) : 100,
        })), 'ListHealthChecks');

        healthChecks.push(...(response.HealthChecks ?? []));
        marker = response.NextMarker;

        if (maxItems && healthChecks.length >= maxItems) break;
      } while (marker);

      return { success: true, data: healthChecks };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get health check status
   */
  async getHealthCheckStatus(healthCheckId: string): Promise<Route53OperationResult<{
    healthCheckId: string;
    observations: { region: string; ipAddress: string; status: string }[];
  }>> {
    try {
      const response = await this.withRetry(() => this.client.send(new GetHealthCheckStatusCommand({
        HealthCheckId: healthCheckId,
      })), 'GetHealthCheckStatus');

      return {
        success: true,
        data: {
          healthCheckId,
          observations: (response.HealthCheckObservations ?? []).map(obs => ({
            region: obs.Region ?? 'unknown',
            ipAddress: obs.IPAddress ?? 'unknown',
            status: obs.StatusReport?.Status ?? 'unknown',
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // VPC Association Operations
  // ==========================================================================

  /**
   * Associate a VPC with a private hosted zone
   */
  async associateVPCWithHostedZone(
    hostedZoneId: string,
    vpcId: string,
    vpcRegion: string
  ): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      await this.withRetry(() => this.client.send(new AssociateVPCWithHostedZoneCommand({
        HostedZoneId: zoneId,
        VPC: {
          VPCId: vpcId,
          VPCRegion: vpcRegion as VPCRegion,
        },
      })), 'AssociateVPCWithHostedZone');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disassociate a VPC from a private hosted zone
   */
  async disassociateVPCFromHostedZone(
    hostedZoneId: string,
    vpcId: string,
    vpcRegion: string
  ): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      await this.withRetry(() => this.client.send(new DisassociateVPCFromHostedZoneCommand({
        HostedZoneId: zoneId,
        VPC: {
          VPCId: vpcId,
          VPCRegion: vpcRegion as VPCRegion,
        },
      })), 'DisassociateVPCFromHostedZone');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Query Logging Operations
  // ==========================================================================

  /**
   * Enable query logging for a hosted zone
   */
  async enableQueryLogging(
    hostedZoneId: string,
    cloudWatchLogsLogGroupArn: string
  ): Promise<Route53OperationResult<QueryLoggingConfig>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      const response = await this.withRetry(() => this.client.send(new CreateQueryLoggingConfigCommand({
        HostedZoneId: zoneId,
        CloudWatchLogsLogGroupArn: cloudWatchLogsLogGroupArn,
      })), 'CreateQueryLoggingConfig');

      return { success: true, data: response.QueryLoggingConfig };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disable query logging for a hosted zone
   */
  async disableQueryLogging(queryLoggingConfigId: string): Promise<Route53OperationResult<void>> {
    try {
      await this.withRetry(() => this.client.send(new DeleteQueryLoggingConfigCommand({
        Id: queryLoggingConfigId,
      })), 'DeleteQueryLoggingConfig');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // DNSSEC Operations
  // ==========================================================================

  /**
   * Enable DNSSEC for a hosted zone
   */
  async enableDNSSEC(hostedZoneId: string): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      await this.withRetry(() => this.client.send(new EnableHostedZoneDNSSECCommand({
        HostedZoneId: zoneId,
      })), 'EnableHostedZoneDNSSEC');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disable DNSSEC for a hosted zone
   */
  async disableDNSSEC(hostedZoneId: string): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      await this.withRetry(() => this.client.send(new DisableHostedZoneDNSSECCommand({
        HostedZoneId: zoneId,
      })), 'DisableHostedZoneDNSSEC');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Tag Operations
  // ==========================================================================

  /**
   * Tag a hosted zone
   */
  async tagHostedZone(hostedZoneId: string, tags: Record<string, string>): Promise<Route53OperationResult<void>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      await this.withRetry(() => this.client.send(new ChangeTagsForResourceCommand({
        ResourceType: 'hostedzone',
        ResourceId: zoneId,
        AddTags: Object.entries({ ...this.config.defaultTags, ...tags }).map(([Key, Value]) => ({ Key, Value })),
      })), 'ChangeTagsForResource');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Tag a health check
   */
  async tagHealthCheck(healthCheckId: string, tags: Record<string, string>): Promise<Route53OperationResult<void>> {
    try {
      await this.withRetry(() => this.client.send(new ChangeTagsForResourceCommand({
        ResourceType: 'healthcheck',
        ResourceId: healthCheckId,
        AddTags: Object.entries({ ...this.config.defaultTags, ...tags }).map(([Key, Value]) => ({ Key, Value })),
      })), 'ChangeTagsForResource');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Wait for a change to complete
   */
  async waitForChange(changeId: string, timeoutMs: number = 120000): Promise<Route53OperationResult<void>> {
    const startTime = Date.now();
    const id = changeId.replace('/change/', '');

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await this.withRetry(() => this.client.send(new GetChangeCommand({
          Id: id,
        })), 'GetChange');

        if (response.ChangeInfo?.Status === 'INSYNC') {
          return { success: true };
        }

        // Wait 5 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      success: false,
      error: `Timeout waiting for change ${changeId} to complete`,
    };
  }

  /**
   * Test DNS answer
   */
  async testDNSAnswer(
    hostedZoneId: string,
    recordName: string,
    recordType: RecordType,
    resolverIP?: string
  ): Promise<Route53OperationResult<{
    nameserver: string;
    recordName: string;
    recordType: string;
    recordData: string[];
    protocol: string;
    responseCode: string;
  }>> {
    try {
      const zoneId = hostedZoneId.replace('/hostedzone/', '');
      
      const response = await this.withRetry(() => this.client.send(new TestDNSAnswerCommand({
        HostedZoneId: zoneId,
        RecordName: recordName,
        RecordType: recordType as RRType,
        ResolverIP: resolverIP,
      })), 'TestDNSAnswer');

      return {
        success: true,
        data: {
          nameserver: response.Nameserver ?? '',
          recordName: response.RecordName ?? '',
          recordType: response.RecordType ?? '',
          recordData: response.RecordData ?? [],
          protocol: response.Protocol ?? '',
          responseCode: response.ResponseCode ?? '',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get account limits
   */
  async getAccountLimits(): Promise<Route53OperationResult<{
    hostedZoneCount: number;
    healthCheckCount: number;
  }>> {
    try {
      const [zonesResponse, healthChecksResponse] = await Promise.all([
        this.withRetry(() => this.client.send(new GetHostedZoneCountCommand({})), 'GetHostedZoneCount'),
        this.withRetry(() => this.client.send(new GetHealthCheckCountCommand({})), 'GetHealthCheckCount'),
      ]);

      return {
        success: true,
        data: {
          hostedZoneCount: Number(zonesResponse.HostedZoneCount ?? 0),
          healthCheckCount: Number(healthChecksResponse.HealthCheckCount ?? 0),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create alias record for common AWS resources
   */
  async createAliasRecord(
    hostedZoneId: string,
    recordName: string,
    target: {
      type: 'cloudfront' | 'elb' | 'alb' | 'nlb' | 'api-gateway' | 's3-website' | 'elastic-beanstalk';
      dnsName: string;
      hostedZoneId?: string;
      region?: string;
    },
    recordType: 'A' | 'AAAA' = 'A'
  ): Promise<Route53OperationResult<void>> {
    // Get the correct hosted zone ID for the target type
    let targetHostedZoneId = target.hostedZoneId;

    if (!targetHostedZoneId) {
      // Common hosted zone IDs for AWS services
      switch (target.type) {
        case 'cloudfront':
          targetHostedZoneId = 'Z2FDTNDATAQYW2'; // CloudFront global
          break;
        case 's3-website':
          // S3 website hosted zone IDs vary by region
          const s3HostedZones: Record<string, string> = {
            'us-east-1': 'Z3AQBSTGFYJSTF',
            'us-west-2': 'Z3BJ6K6RIION7M',
            'eu-west-1': 'Z1BKCTXD74EZPE',
            // Add more as needed
          };
          targetHostedZoneId = s3HostedZones[target.region ?? 'us-east-1'] ?? 'Z3AQBSTGFYJSTF';
          break;
        case 'api-gateway':
          // API Gateway hosted zone IDs vary by region
          const apiGwHostedZones: Record<string, string> = {
            'us-east-1': 'Z1UJRXOUMOOFQ8',
            'us-west-2': 'Z2OJLYMUO9EFXC',
            'eu-west-1': 'ZLY8HYME6SFDD',
            // Add more as needed
          };
          targetHostedZoneId = apiGwHostedZones[target.region ?? 'us-east-1'] ?? 'Z1UJRXOUMOOFQ8';
          break;
        default:
          return {
            success: false,
            error: `Hosted zone ID required for ${target.type}. Please provide target.hostedZoneId.`,
          };
      }
    }

    return this.upsertRecord({
      hostedZoneId,
      name: recordName,
      type: recordType,
      aliasTarget: {
        hostedZoneId: targetHostedZoneId,
        dnsName: target.dnsName,
        evaluateTargetHealth: target.type !== 'cloudfront' && target.type !== 's3-website',
      },
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createRoute53Manager(config?: Route53ManagerConfig): Route53Manager {
  return new Route53Manager(config);
}

// ============================================================================
// Tool Definitions for Agent Integration
// ============================================================================

export const route53ToolDefinitions = {
  route53_create_hosted_zone: {
    name: 'route53_create_hosted_zone',
    description: 'Create a new Route 53 hosted zone for DNS management',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Domain name (e.g., example.com)' },
        comment: { type: 'string', description: 'Description of the hosted zone' },
        privateZone: { type: 'boolean', description: 'Create as private zone for VPC' },
        vpcId: { type: 'string', description: 'VPC ID (required for private zones)' },
        vpcRegion: { type: 'string', description: 'VPC region (required for private zones)' },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  route53_list_hosted_zones: {
    name: 'route53_list_hosted_zones',
    description: 'List all Route 53 hosted zones',
    parameters: {
      type: 'object',
      properties: {
        maxItems: { type: 'number', description: 'Maximum number of zones to return' },
      },
    },
  },
  route53_upsert_record: {
    name: 'route53_upsert_record',
    description: 'Create or update a DNS record in a hosted zone',
    parameters: {
      type: 'object',
      properties: {
        hostedZoneId: { type: 'string', description: 'Hosted zone ID' },
        name: { type: 'string', description: 'Record name (e.g., www.example.com)' },
        type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV', 'CAA'], description: 'Record type' },
        ttl: { type: 'number', description: 'TTL in seconds' },
        values: { type: 'array', items: { type: 'string' }, description: 'Record values' },
      },
      required: ['hostedZoneId', 'name', 'type', 'values'],
    },
  },
  route53_delete_record: {
    name: 'route53_delete_record',
    description: 'Delete a DNS record from a hosted zone',
    parameters: {
      type: 'object',
      properties: {
        hostedZoneId: { type: 'string', description: 'Hosted zone ID' },
        name: { type: 'string', description: 'Record name' },
        type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV', 'CAA'], description: 'Record type' },
        values: { type: 'array', items: { type: 'string' }, description: 'Record values (must match existing record)' },
        ttl: { type: 'number', description: 'TTL (must match existing record)' },
      },
      required: ['hostedZoneId', 'name', 'type'],
    },
  },
  route53_list_records: {
    name: 'route53_list_records',
    description: 'List DNS records in a hosted zone',
    parameters: {
      type: 'object',
      properties: {
        hostedZoneId: { type: 'string', description: 'Hosted zone ID' },
        type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV', 'CAA'], description: 'Filter by record type' },
        maxItems: { type: 'number', description: 'Maximum number of records to return' },
      },
      required: ['hostedZoneId'],
    },
  },
  route53_create_health_check: {
    name: 'route53_create_health_check',
    description: 'Create a health check for failover routing',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Health check name (tag)' },
        type: { type: 'string', enum: ['HTTP', 'HTTPS', 'HTTP_STR_MATCH', 'HTTPS_STR_MATCH', 'TCP'], description: 'Health check type' },
        fqdn: { type: 'string', description: 'Fully qualified domain name to check' },
        ipAddress: { type: 'string', description: 'IP address to check' },
        port: { type: 'number', description: 'Port to check' },
        resourcePath: { type: 'string', description: 'Resource path for HTTP checks' },
        searchString: { type: 'string', description: 'String to search for in response (for STR_MATCH types)' },
        failureThreshold: { type: 'number', description: 'Number of failures before unhealthy (1-10)' },
      },
      required: ['type'],
    },
  },
  route53_create_alias_record: {
    name: 'route53_create_alias_record',
    description: 'Create an alias record pointing to an AWS resource (CloudFront, ELB, S3, API Gateway)',
    parameters: {
      type: 'object',
      properties: {
        hostedZoneId: { type: 'string', description: 'Hosted zone ID' },
        recordName: { type: 'string', description: 'Record name (e.g., www.example.com)' },
        targetType: { type: 'string', enum: ['cloudfront', 'elb', 'alb', 'nlb', 'api-gateway', 's3-website'], description: 'Type of AWS resource' },
        targetDnsName: { type: 'string', description: 'DNS name of the target resource' },
        targetHostedZoneId: { type: 'string', description: 'Hosted zone ID of the target (auto-detected for some types)' },
        region: { type: 'string', description: 'AWS region (required for some target types)' },
      },
      required: ['hostedZoneId', 'recordName', 'targetType', 'targetDnsName'],
    },
  },
  route53_test_dns: {
    name: 'route53_test_dns',
    description: 'Test DNS resolution for a record',
    parameters: {
      type: 'object',
      properties: {
        hostedZoneId: { type: 'string', description: 'Hosted zone ID' },
        recordName: { type: 'string', description: 'Record name to test' },
        recordType: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT'], description: 'Record type' },
      },
      required: ['hostedZoneId', 'recordName', 'recordType'],
    },
  },
};
