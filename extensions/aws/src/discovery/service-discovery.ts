/**
 * AWS Service Discovery
 *
 * Provides service and resource discovery capabilities:
 * - Service metadata enumeration
 * - Resource discovery across regions
 * - Service quotas lookup
 * - Multi-region resource scanning
 */

import { EC2Client, DescribeRegionsCommand, DescribeInstancesCommand, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { ResourceGroupsTaggingAPIClient, GetResourcesCommand, type ResourceTagMapping } from "@aws-sdk/client-resource-groups-tagging-api";
import type { AWSCredentialsManager } from "../credentials/manager.js";
import type { AWSClientPoolManager } from "../client-pool/manager.js";
import type {
  AWSServiceName,
  AWSServiceCategory,
  AWSServiceMetadata,
  AWSServiceQuota,
  AWSResource,
  AWSRegionInfo,
  AWSAccountInfo,
  ResourceEnumerationOptions,
  ServiceDiscoveryResult,
  AWSCredentials,
} from "../types.js";

// =============================================================================
// Service Catalog
// =============================================================================

const AWS_SERVICE_CATALOG: Record<AWSServiceName, Omit<AWSServiceMetadata, "regions" | "endpoints">> = {
  ec2: {
    serviceName: "Amazon Elastic Compute Cloud",
    serviceCode: "ec2",
    category: "compute",
    description: "Scalable virtual servers in the cloud",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/ec2/pricing/" },
  },
  s3: {
    serviceName: "Amazon Simple Storage Service",
    serviceCode: "s3",
    category: "storage",
    description: "Scalable object storage",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/s3/pricing/" },
  },
  iam: {
    serviceName: "AWS Identity and Access Management",
    serviceCode: "iam",
    category: "security",
    description: "Manage access to AWS services and resources",
    globalService: true,
    pricing: { freeTier: true },
  },
  sts: {
    serviceName: "AWS Security Token Service",
    serviceCode: "sts",
    category: "security",
    description: "Temporary security credentials",
    globalService: false,
  },
  lambda: {
    serviceName: "AWS Lambda",
    serviceCode: "lambda",
    category: "serverless",
    description: "Run code without provisioning servers",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/lambda/pricing/" },
  },
  dynamodb: {
    serviceName: "Amazon DynamoDB",
    serviceCode: "dynamodb",
    category: "database",
    description: "Fast and flexible NoSQL database",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/dynamodb/pricing/" },
  },
  rds: {
    serviceName: "Amazon Relational Database Service",
    serviceCode: "rds",
    category: "database",
    description: "Managed relational database service",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/rds/pricing/" },
  },
  cloudformation: {
    serviceName: "AWS CloudFormation",
    serviceCode: "cloudformation",
    category: "management",
    description: "Infrastructure as code",
    globalService: false,
    pricing: { freeTier: true },
  },
  cloudwatch: {
    serviceName: "Amazon CloudWatch",
    serviceCode: "cloudwatch",
    category: "management",
    description: "Monitoring and observability service",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/cloudwatch/pricing/" },
  },
  cloudtrail: {
    serviceName: "AWS CloudTrail",
    serviceCode: "cloudtrail",
    category: "management",
    description: "Track user activity and API usage",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/cloudtrail/pricing/" },
  },
  sns: {
    serviceName: "Amazon Simple Notification Service",
    serviceCode: "sns",
    category: "application-integration",
    description: "Pub/sub messaging and mobile notifications",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/sns/pricing/" },
  },
  sqs: {
    serviceName: "Amazon Simple Queue Service",
    serviceCode: "sqs",
    category: "application-integration",
    description: "Managed message queues",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/sqs/pricing/" },
  },
  ecs: {
    serviceName: "Amazon Elastic Container Service",
    serviceCode: "ecs",
    category: "containers",
    description: "Run containerized applications",
    globalService: false,
    pricing: { freeTier: false, pricingUrl: "https://aws.amazon.com/ecs/pricing/" },
  },
  eks: {
    serviceName: "Amazon Elastic Kubernetes Service",
    serviceCode: "eks",
    category: "containers",
    description: "Managed Kubernetes service",
    globalService: false,
    pricing: { freeTier: false, pricingUrl: "https://aws.amazon.com/eks/pricing/" },
  },
  ecr: {
    serviceName: "Amazon Elastic Container Registry",
    serviceCode: "ecr",
    category: "containers",
    description: "Container image registry",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/ecr/pricing/" },
  },
  secretsmanager: {
    serviceName: "AWS Secrets Manager",
    serviceCode: "secretsmanager",
    category: "security",
    description: "Manage and retrieve secrets",
    globalService: false,
    pricing: { freeTier: false, pricingUrl: "https://aws.amazon.com/secrets-manager/pricing/" },
  },
  ssm: {
    serviceName: "AWS Systems Manager",
    serviceCode: "ssm",
    category: "management",
    description: "Operational insights and actions",
    globalService: false,
    pricing: { freeTier: true },
  },
  kms: {
    serviceName: "AWS Key Management Service",
    serviceCode: "kms",
    category: "security",
    description: "Create and manage encryption keys",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/kms/pricing/" },
  },
  route53: {
    serviceName: "Amazon Route 53",
    serviceCode: "route53",
    category: "networking",
    description: "Scalable DNS and domain registration",
    globalService: true,
    pricing: { freeTier: false, pricingUrl: "https://aws.amazon.com/route53/pricing/" },
  },
  elasticache: {
    serviceName: "Amazon ElastiCache",
    serviceCode: "elasticache",
    category: "database",
    description: "In-memory caching service",
    globalService: false,
    pricing: { freeTier: true, pricingUrl: "https://aws.amazon.com/elasticache/pricing/" },
  },
  organizations: {
    serviceName: "AWS Organizations",
    serviceCode: "organizations",
    category: "management",
    description: "Centrally manage multiple AWS accounts",
    globalService: true,
    pricing: { freeTier: true },
  },
  resourcegroupstaggingapi: {
    serviceName: "AWS Resource Groups Tagging API",
    serviceCode: "resourcegroupstaggingapi",
    category: "management",
    description: "Tag and group AWS resources",
    globalService: false,
    pricing: { freeTier: true },
  },
};

// Resource type to service mapping
const RESOURCE_TYPE_SERVICE_MAP: Record<string, AWSServiceName> = {
  "ec2:instance": "ec2",
  "ec2:vpc": "ec2",
  "ec2:subnet": "ec2",
  "ec2:security-group": "ec2",
  "ec2:volume": "ec2",
  "ec2:snapshot": "ec2",
  "s3:bucket": "s3",
  "lambda:function": "lambda",
  "dynamodb:table": "dynamodb",
  "rds:db": "rds",
  "rds:cluster": "rds",
  "ecs:cluster": "ecs",
  "ecs:service": "ecs",
  "ecs:task-definition": "ecs",
  "eks:cluster": "eks",
  "secretsmanager:secret": "secretsmanager",
  "kms:key": "kms",
  "sns:topic": "sns",
  "sqs:queue": "sqs",
};

// =============================================================================
// Service Discovery
// =============================================================================

export class AWSServiceDiscovery {
  private credentialsManager: AWSCredentialsManager;
  private clientPool?: AWSClientPoolManager;
  private regionCache: AWSRegionInfo[] = [];
  private accountInfo: AWSAccountInfo | null = null;

  constructor(
    credentialsManager: AWSCredentialsManager,
    clientPool?: AWSClientPoolManager,
  ) {
    this.credentialsManager = credentialsManager;
    this.clientPool = clientPool;
  }

  /**
   * Discover all available services and regions
   */
  async discover(): Promise<ServiceDiscoveryResult> {
    const credentials = await this.credentialsManager.getCredentials();
    
    // Get available regions
    const regions = await this.discoverRegions(credentials.credentials, credentials.region);
    this.regionCache = regions;

    // Build service metadata with region info
    const services = this.getServiceCatalog(regions);

    // Get account info
    const accountInfo: AWSAccountInfo = {
      accountId: credentials.accountId ?? "unknown",
    };
    this.accountInfo = accountInfo;

    return {
      services,
      availableRegions: regions,
      accountInfo,
      discoveredAt: new Date(),
    };
  }

  /**
   * Discover available AWS regions
   */
  async discoverRegions(
    credentials?: AWSCredentials,
    defaultRegion?: string,
  ): Promise<AWSRegionInfo[]> {
    // Get credentials if not provided
    let creds = credentials;
    let region = defaultRegion ?? "us-east-1";
    
    if (!creds) {
      try {
        const result = await this.credentialsManager.getCredentials();
        creds = result.credentials;
        region = result.region ?? region;
      } catch {
        // Return default regions if credentials unavailable
        return this.getDefaultRegions();
      }
    }

    const client = new EC2Client({
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });

    try {
      const response = await client.send(new DescribeRegionsCommand({
        AllRegions: true,
      }));

      const regions = (response.Regions ?? []).map((r) => ({
        regionName: r.RegionName!,
        endpoint: r.Endpoint!,
        optInStatus: r.OptInStatus as AWSRegionInfo["optInStatus"],
        available: r.OptInStatus !== "not-opted-in",
      }));
      
      this.regionCache = regions;
      return regions;
    } catch {
      // Return default regions
      return this.getDefaultRegions();
    }
  }

  /**
   * Get default regions when AWS is unavailable
   */
  private getDefaultRegions(): AWSRegionInfo[] {
    return [
      { regionName: "us-east-1", endpoint: "ec2.us-east-1.amazonaws.com", available: true },
      { regionName: "us-east-2", endpoint: "ec2.us-east-2.amazonaws.com", available: true },
      { regionName: "us-west-1", endpoint: "ec2.us-west-1.amazonaws.com", available: true },
      { regionName: "us-west-2", endpoint: "ec2.us-west-2.amazonaws.com", available: true },
      { regionName: "eu-west-1", endpoint: "ec2.eu-west-1.amazonaws.com", available: true },
      { regionName: "eu-west-2", endpoint: "ec2.eu-west-2.amazonaws.com", available: true },
      { regionName: "eu-central-1", endpoint: "ec2.eu-central-1.amazonaws.com", available: true },
      { regionName: "ap-northeast-1", endpoint: "ec2.ap-northeast-1.amazonaws.com", available: true },
      { regionName: "ap-southeast-1", endpoint: "ec2.ap-southeast-1.amazonaws.com", available: true },
      { regionName: "ap-southeast-2", endpoint: "ec2.ap-southeast-2.amazonaws.com", available: true },
    ];
  }

  /**
   * Get service metadata catalog
   */
  getServiceCatalog(regions?: AWSRegionInfo[]): AWSServiceMetadata[] {
    // Use provided regions, cached regions, or default regions
    const regionList = regions ?? this.regionCache;
    const availableRegions = regionList.length > 0 
      ? regionList.filter((r) => r.available).map((r) => r.regionName)
      : ["us-east-1", "us-east-2", "us-west-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-northeast-1", "ap-southeast-1"];

    return Object.entries(AWS_SERVICE_CATALOG).map(([_, metadata]) => ({
      ...metadata,
      regions: metadata.globalService ? ["us-east-1"] : availableRegions,
      endpoints: this.buildServiceEndpoints(metadata.serviceCode, availableRegions, metadata.globalService),
    }));
  }

  /**
   * Build service endpoints for regions
   */
  private buildServiceEndpoints(
    serviceCode: string,
    regions: string[],
    globalService: boolean,
  ): Record<string, string> {
    const endpoints: Record<string, string> = {};
    const targetRegions = globalService ? ["us-east-1"] : regions;

    for (const region of targetRegions) {
      endpoints[region] = `${serviceCode}.${region}.amazonaws.com`;
    }

    return endpoints;
  }

  /**
   * Get service metadata by name
   */
  getServiceMetadata(service: AWSServiceName): AWSServiceMetadata | null {
    const metadata = AWS_SERVICE_CATALOG[service];
    if (!metadata) return null;

    const regions = this.regionCache.filter((r) => r.available).map((r) => r.regionName);

    return {
      ...metadata,
      regions: metadata.globalService ? ["us-east-1"] : regions,
      endpoints: this.buildServiceEndpoints(metadata.serviceCode, regions, metadata.globalService),
    };
  }

  /**
   * Get services by category
   */
  getServicesByCategory(category: AWSServiceCategory): AWSServiceMetadata[] {
    const regions = this.regionCache.filter((r) => r.available).map((r) => r.regionName);

    return Object.entries(AWS_SERVICE_CATALOG)
      .filter(([_, metadata]) => metadata.category === category)
      .map(([_, metadata]) => ({
        ...metadata,
        regions: metadata.globalService ? ["us-east-1"] : regions,
        endpoints: this.buildServiceEndpoints(metadata.serviceCode, regions, metadata.globalService),
      }));
  }

  /**
   * Enumerate resources across services and regions
   */
  async enumerateResources(
    options: ResourceEnumerationOptions = {},
  ): Promise<AWSResource[]> {
    const credentials = await this.credentialsManager.getCredentials();
    const resources: AWSResource[] = [];

    const targetRegions = options.regions ?? 
      this.regionCache.filter((r) => r.available).map((r) => r.regionName);

    // Use Resource Groups Tagging API for broad resource discovery
    for (const region of targetRegions) {
      try {
        const regionResources = await this.discoverResourcesInRegion(
          credentials.credentials,
          region,
          credentials.accountId ?? "unknown",
          options,
        );
        resources.push(...regionResources);
      } catch {
        // Skip regions with errors
        continue;
      }

      // Check if we've hit max results
      if (options.maxResults && resources.length >= options.maxResults) {
        break;
      }
    }

    return options.maxResults ? resources.slice(0, options.maxResults) : resources;
  }

  /**
   * Discover resources in a specific region
   */
  private async discoverResourcesInRegion(
    credentials: AWSCredentials,
    region: string,
    accountId: string,
    options: ResourceEnumerationOptions,
  ): Promise<AWSResource[]> {
    const client = new ResourceGroupsTaggingAPIClient({
      region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    const resources: AWSResource[] = [];
    let paginationToken: string | undefined;

    do {
      const response = await client.send(new GetResourcesCommand({
        PaginationToken: paginationToken,
        ResourceTypeFilters: options.resourceTypes,
        TagFilters: options.tags
          ? Object.entries(options.tags).map(([key, value]) => ({
              Key: key,
              Values: [value],
            }))
          : undefined,
        ResourcesPerPage: 100,
      }));

      for (const mapping of response.ResourceTagMappingList ?? []) {
        const resource = this.parseResourceMapping(mapping, region, accountId);
        if (resource) {
          resources.push(resource);
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return resources;
  }

  /**
   * Parse a resource tag mapping into our resource format
   */
  private parseResourceMapping(
    mapping: ResourceTagMapping,
    region: string,
    accountId: string,
  ): AWSResource | null {
    if (!mapping.ResourceARN) return null;

    const arnParts = this.parseArn(mapping.ResourceARN);
    if (!arnParts) return null;

    const tags: Record<string, string> = {};
    for (const tag of mapping.Tags ?? []) {
      if (tag.Key && tag.Value !== undefined) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      resourceArn: mapping.ResourceARN,
      resourceType: arnParts.resourceType,
      service: arnParts.service,
      region: arnParts.region || region,
      accountId: arnParts.accountId || accountId,
      resourceId: arnParts.resourceId,
      resourceName: tags.Name,
      tags,
    };
  }

  /**
   * Parse an ARN into components
   */
  private parseArn(arn: string): {
    partition: string;
    service: string;
    region: string;
    accountId: string;
    resourceType: string;
    resourceId: string;
  } | null {
    // ARN format: arn:partition:service:region:account-id:resource-type/resource-id
    const match = arn.match(
      /^arn:([^:]+):([^:]+):([^:]*):([^:]*):(.+)$/,
    );

    if (!match) return null;

    const [, partition, service, region, accountId, resource] = match;
    
    // Parse resource part (can be type/id, type:id, or just id)
    let resourceType = service;
    let resourceId = resource;

    if (resource.includes("/")) {
      const [type, ...idParts] = resource.split("/");
      resourceType = `${service}:${type}`;
      resourceId = idParts.join("/");
    } else if (resource.includes(":")) {
      const [type, ...idParts] = resource.split(":");
      resourceType = `${service}:${type}`;
      resourceId = idParts.join(":");
    }

    return {
      partition,
      service,
      region,
      accountId,
      resourceType,
      resourceId,
    };
  }

  /**
   * Discover EC2 instances in a region
   */
  async discoverEC2Instances(
    region: string,
    filters?: Record<string, string[]>,
  ): Promise<AWSResource[]> {
    const credentials = await this.credentialsManager.getCredentials();
    
    const client = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    const ec2Filters = filters
      ? Object.entries(filters).map(([name, values]) => ({ Name: name, Values: values }))
      : undefined;

    const response = await client.send(new DescribeInstancesCommand({
      Filters: ec2Filters,
    }));

    const resources: AWSResource[] = [];

    for (const reservation of response.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        const tags: Record<string, string> = {};
        for (const tag of instance.Tags ?? []) {
          if (tag.Key && tag.Value !== undefined) {
            tags[tag.Key] = tag.Value;
          }
        }

        resources.push({
          resourceArn: `arn:aws:ec2:${region}:${credentials.accountId}:instance/${instance.InstanceId}`,
          resourceType: "ec2:instance",
          service: "ec2",
          region,
          accountId: credentials.accountId ?? "unknown",
          resourceId: instance.InstanceId ?? "",
          resourceName: tags.Name,
          tags,
          state: instance.State?.Name,
          createdAt: instance.LaunchTime,
          metadata: {
            instanceType: instance.InstanceType,
            privateIpAddress: instance.PrivateIpAddress,
            publicIpAddress: instance.PublicIpAddress,
            vpcId: instance.VpcId,
            subnetId: instance.SubnetId,
          },
        });
      }
    }

    return resources;
  }

  /**
   * Discover VPCs in a region
   */
  async discoverVPCs(region: string): Promise<AWSResource[]> {
    const credentials = await this.credentialsManager.getCredentials();
    
    const client = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    const response = await client.send(new DescribeVpcsCommand({}));

    const resources: AWSResource[] = [];

    for (const vpc of response.Vpcs ?? []) {
      const tags: Record<string, string> = {};
      for (const tag of vpc.Tags ?? []) {
        if (tag.Key && tag.Value !== undefined) {
          tags[tag.Key] = tag.Value;
        }
      }

      resources.push({
        resourceArn: `arn:aws:ec2:${region}:${credentials.accountId}:vpc/${vpc.VpcId}`,
        resourceType: "ec2:vpc",
        service: "ec2",
        region,
        accountId: credentials.accountId ?? "unknown",
        resourceId: vpc.VpcId ?? "",
        resourceName: tags.Name,
        tags,
        state: vpc.State,
        metadata: {
          cidrBlock: vpc.CidrBlock,
          isDefault: vpc.IsDefault,
          dhcpOptionsId: vpc.DhcpOptionsId,
        },
      });
    }

    return resources;
  }

  /**
   * Get cached regions
   */
  getCachedRegions(): AWSRegionInfo[] {
    return [...this.regionCache];
  }

  /**
   * Get cached account info
   */
  getCachedAccountInfo(): AWSAccountInfo | null {
    return this.accountInfo;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AWS service discovery instance
 */
export function createServiceDiscovery(
  credentialsManager: AWSCredentialsManager,
  clientPool?: AWSClientPoolManager,
): AWSServiceDiscovery {
  return new AWSServiceDiscovery(credentialsManager, clientPool);
}
