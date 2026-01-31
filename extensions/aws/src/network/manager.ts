/**
 * AWS Network Manager
 *
 * Provides VPC, Subnet, Route Table, NAT Gateway, VPC Peering,
 * Transit Gateway, Network ACL, VPC Endpoint, and Flow Log management.
 */

import {
  EC2Client,
  CreateVpcCommand,
  DeleteVpcCommand,
  DescribeVpcsCommand,
  ModifyVpcAttributeCommand,
  CreateSubnetCommand,
  DeleteSubnetCommand,
  DescribeSubnetsCommand,
  ModifySubnetAttributeCommand,
  CreateRouteTableCommand,
  DeleteRouteTableCommand,
  DescribeRouteTablesCommand,
  CreateRouteCommand,
  AssociateRouteTableCommand,
  CreateInternetGatewayCommand,
  DeleteInternetGatewayCommand,
  DescribeInternetGatewaysCommand,
  AttachInternetGatewayCommand,
  DetachInternetGatewayCommand,
  CreateNatGatewayCommand,
  DeleteNatGatewayCommand,
  DescribeNatGatewaysCommand,
  AllocateAddressCommand,
  CreateVpcPeeringConnectionCommand,
  DeleteVpcPeeringConnectionCommand,
  DescribeVpcPeeringConnectionsCommand,
  AcceptVpcPeeringConnectionCommand,
  CreateTransitGatewayCommand,
  DeleteTransitGatewayCommand,
  DescribeTransitGatewaysCommand,
  CreateTransitGatewayVpcAttachmentCommand,
  CreateNetworkAclCommand,
  DeleteNetworkAclCommand,
  DescribeNetworkAclsCommand,
  CreateNetworkAclEntryCommand,
  CreateVpcEndpointCommand,
  DeleteVpcEndpointsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcEndpointServicesCommand,
  CreateFlowLogsCommand,
  DeleteFlowLogsCommand,
  DescribeFlowLogsCommand,
  DescribeAvailabilityZonesCommand,
  type Tag,
  type Filter,
} from '@aws-sdk/client-ec2';

import type {
  NetworkManagerConfig,
  VPCInfo,
  CreateVPCOptions,
  ListVPCsOptions,
  SubnetInfo,
  CreateSubnetOptions,
  ListSubnetsOptions,
  RouteTableInfo,
  RouteEntry,
  RouteTableAssociation,
  CreateRouteTableOptions,
  CreateRouteOptions,
  ListRouteTablesOptions,
  InternetGatewayInfo,
  CreateInternetGatewayOptions,
  NATGatewayInfo,
  CreateNATGatewayOptions,
  ListNATGatewaysOptions,
  VPCPeeringInfo,
  CreateVPCPeeringOptions,
  ListVPCPeeringOptions,
  TransitGatewayInfo,
  TransitGatewayAttachmentInfo,
  CreateTransitGatewayOptions,
  AttachVPCToTransitGatewayOptions,
  NetworkACLInfo,
  NetworkACLEntry,
  CreateNetworkACLOptions,
  CreateNetworkACLEntryOptions,
  VPCEndpointInfo,
  VPCEndpointServiceInfo,
  CreateVPCEndpointOptions,
  ListVPCEndpointsOptions,
  FlowLogInfo,
  CreateFlowLogOptions,
  ListFlowLogsOptions,
  NetworkOperationResult,
  CreateMultiAZVPCOptions,
  CreateMultiAZVPCResult,
} from './types.js';

/**
 * Creates a NetworkManager instance
 */
export function createNetworkManager(config: NetworkManagerConfig = {}): NetworkManager {
  return new NetworkManager(config);
}

/**
 * NetworkManager class for AWS VPC and networking operations
 */
export class NetworkManager {
  private config: NetworkManagerConfig;

  constructor(config: NetworkManagerConfig = {}) {
    this.config = {
      defaultRegion: config.defaultRegion || 'us-east-1',
      credentials: config.credentials,
      defaultTags: config.defaultTags || {},
    };
  }

  /**
   * Create an EC2 client for a specific region
   */
  private createClient(region?: string): EC2Client {
    return new EC2Client({
      region: region || this.config.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  /**
   * Convert tags record to AWS Tag array
   */
  private toAWSTags(tags?: Record<string, string>, name?: string): Tag[] {
    const allTags: Tag[] = [];

    // Add default tags
    if (this.config.defaultTags) {
      for (const [Key, Value] of Object.entries(this.config.defaultTags)) {
        allTags.push({ Key, Value });
      }
    }

    // Add custom tags
    if (tags) {
      for (const [Key, Value] of Object.entries(tags)) {
        allTags.push({ Key, Value });
      }
    }

    // Add name tag
    if (name) {
      allTags.push({ Key: 'Name', Value: name });
    }

    return allTags;
  }

  /**
   * Convert AWS tags to record
   */
  private fromAWSTags(tags?: Tag[]): Record<string, string> | undefined {
    if (!tags || tags.length === 0) return undefined;
    const result: Record<string, string> = {};
    for (const tag of tags) {
      if (tag.Key) {
        result[tag.Key] = tag.Value || '';
      }
    }
    return result;
  }

  /**
   * Build filters array
   */
  private buildFilters(filters: Record<string, string | string[] | undefined>): Filter[] {
    const result: Filter[] = [];
    for (const [Name, value] of Object.entries(filters)) {
      if (value !== undefined) {
        result.push({
          Name,
          Values: Array.isArray(value) ? value : [value],
        });
      }
    }
    return result;
  }

  // =============================================================================
  // VPC Operations
  // =============================================================================

  /**
   * List VPCs
   */
  async listVPCs(options: ListVPCsOptions = {}): Promise<NetworkOperationResult<VPCInfo[]>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const filters: Filter[] = [];
      if (options.cidrBlock) {
        filters.push({ Name: 'cidr-block-association.cidr-block', Values: [options.cidrBlock] });
      }
      if (options.state) {
        filters.push({ Name: 'state', Values: [options.state] });
      }
      if (options.tag) {
        filters.push({ Name: `tag:${options.tag.key}`, Values: [options.tag.value] });
      }

      const response = await client.send(new DescribeVpcsCommand({
        VpcIds: options.vpcIds,
        Filters: filters.length > 0 ? filters : undefined,
      }));

      const vpcs: VPCInfo[] = (response.Vpcs || []).map(vpc => ({
        vpcId: vpc.VpcId!,
        cidrBlock: vpc.CidrBlock!,
        secondaryCidrBlocks: vpc.CidrBlockAssociationSet
          ?.filter(a => a.CidrBlockState?.State === 'associated' && a.CidrBlock !== vpc.CidrBlock)
          .map(a => a.CidrBlock!),
        ipv6CidrBlocks: vpc.Ipv6CidrBlockAssociationSet
          ?.filter(a => a.Ipv6CidrBlockState?.State === 'associated')
          .map(a => a.Ipv6CidrBlock!),
        state: vpc.State as VPCInfo['state'],
        isDefault: vpc.IsDefault || false,
        enableDnsHostnames: false, // Need separate DescribeVpcAttribute call
        enableDnsSupport: true, // Default
        instanceTenancy: vpc.InstanceTenancy || 'default',
        ownerId: vpc.OwnerId!,
        dhcpOptionsId: vpc.DhcpOptionsId,
        tags: this.fromAWSTags(vpc.Tags),
        region,
      }));

      return {
        success: true,
        data: vpcs,
        message: `Found ${vpcs.length} VPCs`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list VPCs',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a VPC
   */
  async createVPC(options: CreateVPCOptions): Promise<NetworkOperationResult<VPCInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateVpcCommand({
        CidrBlock: options.cidrBlock,
        InstanceTenancy: options.instanceTenancy,
        AmazonProvidedIpv6CidrBlock: options.amazonProvidedIpv6CidrBlock,
        TagSpecifications: [{
          ResourceType: 'vpc',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const vpc = response.Vpc!;

      // Modify DNS attributes if specified
      if (options.enableDnsHostnames !== undefined) {
        await client.send(new ModifyVpcAttributeCommand({
          VpcId: vpc.VpcId,
          EnableDnsHostnames: { Value: options.enableDnsHostnames },
        }));
      }

      if (options.enableDnsSupport !== undefined) {
        await client.send(new ModifyVpcAttributeCommand({
          VpcId: vpc.VpcId,
          EnableDnsSupport: { Value: options.enableDnsSupport },
        }));
      }

      const vpcInfo: VPCInfo = {
        vpcId: vpc.VpcId!,
        cidrBlock: vpc.CidrBlock!,
        state: vpc.State as VPCInfo['state'],
        isDefault: false,
        enableDnsHostnames: options.enableDnsHostnames ?? false,
        enableDnsSupport: options.enableDnsSupport ?? true,
        instanceTenancy: vpc.InstanceTenancy || 'default',
        ownerId: vpc.OwnerId!,
        tags: this.fromAWSTags(vpc.Tags),
        region,
      };

      return {
        success: true,
        data: vpcInfo,
        message: `VPC ${vpc.VpcId} created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create VPC',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a VPC
   */
  async deleteVPC(vpcId: string, region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteVpcCommand({ VpcId: vpcId }));

      return {
        success: true,
        message: `VPC ${vpcId} deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete VPC ${vpcId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // Subnet Operations
  // =============================================================================

  /**
   * List subnets
   */
  async listSubnets(options: ListSubnetsOptions = {}): Promise<NetworkOperationResult<SubnetInfo[]>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const filters: Filter[] = [];
      if (options.vpcId) {
        filters.push({ Name: 'vpc-id', Values: [options.vpcId] });
      }
      if (options.availabilityZone) {
        filters.push({ Name: 'availability-zone', Values: [options.availabilityZone] });
      }
      if (options.state) {
        filters.push({ Name: 'state', Values: [options.state] });
      }
      if (options.cidrBlock) {
        filters.push({ Name: 'cidr-block', Values: [options.cidrBlock] });
      }
      if (options.tag) {
        filters.push({ Name: `tag:${options.tag.key}`, Values: [options.tag.value] });
      }

      const response = await client.send(new DescribeSubnetsCommand({
        SubnetIds: options.subnetIds,
        Filters: filters.length > 0 ? filters : undefined,
      }));

      const subnets: SubnetInfo[] = (response.Subnets || []).map(subnet => ({
        subnetId: subnet.SubnetId!,
        vpcId: subnet.VpcId!,
        availabilityZone: subnet.AvailabilityZone!,
        availabilityZoneId: subnet.AvailabilityZoneId!,
        cidrBlock: subnet.CidrBlock!,
        ipv6CidrBlock: subnet.Ipv6CidrBlockAssociationSet?.[0]?.Ipv6CidrBlock,
        state: subnet.State as SubnetInfo['state'],
        availableIpAddressCount: subnet.AvailableIpAddressCount || 0,
        mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch || false,
        defaultForAz: subnet.DefaultForAz || false,
        ownerId: subnet.OwnerId!,
        arn: subnet.SubnetArn!,
        tags: this.fromAWSTags(subnet.Tags),
        region,
      }));

      return {
        success: true,
        data: subnets,
        message: `Found ${subnets.length} subnets`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list subnets',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a subnet
   */
  async createSubnet(options: CreateSubnetOptions): Promise<NetworkOperationResult<SubnetInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateSubnetCommand({
        VpcId: options.vpcId,
        CidrBlock: options.cidrBlock,
        AvailabilityZone: options.availabilityZone,
        AvailabilityZoneId: options.availabilityZoneId,
        Ipv6CidrBlock: options.ipv6CidrBlock,
        TagSpecifications: [{
          ResourceType: 'subnet',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const subnet = response.Subnet!;

      // Modify public IP mapping if specified
      if (options.mapPublicIpOnLaunch !== undefined) {
        await client.send(new ModifySubnetAttributeCommand({
          SubnetId: subnet.SubnetId,
          MapPublicIpOnLaunch: { Value: options.mapPublicIpOnLaunch },
        }));
      }

      const subnetInfo: SubnetInfo = {
        subnetId: subnet.SubnetId!,
        vpcId: subnet.VpcId!,
        availabilityZone: subnet.AvailabilityZone!,
        availabilityZoneId: subnet.AvailabilityZoneId!,
        cidrBlock: subnet.CidrBlock!,
        state: subnet.State as SubnetInfo['state'],
        availableIpAddressCount: subnet.AvailableIpAddressCount || 0,
        mapPublicIpOnLaunch: options.mapPublicIpOnLaunch ?? false,
        defaultForAz: false,
        ownerId: subnet.OwnerId!,
        arn: subnet.SubnetArn!,
        tags: this.fromAWSTags(subnet.Tags),
        region,
      };

      return {
        success: true,
        data: subnetInfo,
        message: `Subnet ${subnet.SubnetId} created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create subnet',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a subnet
   */
  async deleteSubnet(subnetId: string, region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteSubnetCommand({ SubnetId: subnetId }));

      return {
        success: true,
        message: `Subnet ${subnetId} deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete subnet ${subnetId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // Route Table Operations
  // =============================================================================

  /**
   * List route tables
   */
  async listRouteTables(options: ListRouteTablesOptions = {}): Promise<NetworkOperationResult<RouteTableInfo[]>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const filters: Filter[] = [];
      if (options.vpcId) {
        filters.push({ Name: 'vpc-id', Values: [options.vpcId] });
      }
      if (options.subnetId) {
        filters.push({ Name: 'association.subnet-id', Values: [options.subnetId] });
      }
      if (options.tag) {
        filters.push({ Name: `tag:${options.tag.key}`, Values: [options.tag.value] });
      }

      const response = await client.send(new DescribeRouteTablesCommand({
        RouteTableIds: options.routeTableIds,
        Filters: filters.length > 0 ? filters : undefined,
      }));

      const routeTables: RouteTableInfo[] = (response.RouteTables || []).map(rt => ({
        routeTableId: rt.RouteTableId!,
        vpcId: rt.VpcId!,
        routes: (rt.Routes || []).map(route => ({
          destinationCidrBlock: route.DestinationCidrBlock,
          destinationIpv6CidrBlock: route.DestinationIpv6CidrBlock,
          destinationPrefixListId: route.DestinationPrefixListId,
          gatewayId: route.GatewayId,
          natGatewayId: route.NatGatewayId,
          instanceId: route.InstanceId,
          networkInterfaceId: route.NetworkInterfaceId,
          vpcPeeringConnectionId: route.VpcPeeringConnectionId,
          transitGatewayId: route.TransitGatewayId,
          egressOnlyInternetGatewayId: route.EgressOnlyInternetGatewayId,
          state: route.State as RouteEntry['state'],
          origin: route.Origin as RouteEntry['origin'],
        })),
        associations: (rt.Associations || []).map(assoc => ({
          associationId: assoc.RouteTableAssociationId!,
          routeTableId: assoc.RouteTableId!,
          subnetId: assoc.SubnetId,
          gatewayId: assoc.GatewayId,
          main: assoc.Main || false,
          state: assoc.AssociationState?.State as RouteTableAssociation['state'],
        })),
        propagatingVgws: rt.PropagatingVgws?.map(v => v.GatewayId!),
        ownerId: rt.OwnerId!,
        tags: this.fromAWSTags(rt.Tags),
        region,
      }));

      return {
        success: true,
        data: routeTables,
        message: `Found ${routeTables.length} route tables`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list route tables',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a route table
   */
  async createRouteTable(options: CreateRouteTableOptions): Promise<NetworkOperationResult<RouteTableInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateRouteTableCommand({
        VpcId: options.vpcId,
        TagSpecifications: [{
          ResourceType: 'route-table',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const rt = response.RouteTable!;

      const routeTableInfo: RouteTableInfo = {
        routeTableId: rt.RouteTableId!,
        vpcId: rt.VpcId!,
        routes: (rt.Routes || []).map(route => ({
          destinationCidrBlock: route.DestinationCidrBlock,
          state: route.State as RouteEntry['state'],
          origin: route.Origin as RouteEntry['origin'],
        })),
        associations: [],
        ownerId: rt.OwnerId!,
        tags: this.fromAWSTags(rt.Tags),
        region,
      };

      return {
        success: true,
        data: routeTableInfo,
        message: `Route table ${rt.RouteTableId} created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create route table',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a route in a route table
   */
  async createRoute(options: CreateRouteOptions): Promise<NetworkOperationResult<void>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      await client.send(new CreateRouteCommand({
        RouteTableId: options.routeTableId,
        DestinationCidrBlock: options.destinationCidrBlock,
        DestinationIpv6CidrBlock: options.destinationIpv6CidrBlock,
        GatewayId: options.gatewayId,
        NatGatewayId: options.natGatewayId,
        InstanceId: options.instanceId,
        NetworkInterfaceId: options.networkInterfaceId,
        VpcPeeringConnectionId: options.vpcPeeringConnectionId,
        TransitGatewayId: options.transitGatewayId,
        VpcEndpointId: options.vpcEndpointId,
      }));

      return {
        success: true,
        message: `Route created in ${options.routeTableId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create route',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Associate route table with subnet
   */
  async associateRouteTable(
    routeTableId: string,
    subnetId: string,
    region?: string
  ): Promise<NetworkOperationResult<{ associationId: string }>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      const response = await client.send(new AssociateRouteTableCommand({
        RouteTableId: routeTableId,
        SubnetId: subnetId,
      }));

      return {
        success: true,
        data: { associationId: response.AssociationId! },
        message: `Route table ${routeTableId} associated with subnet ${subnetId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to associate route table',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a route table
   */
  async deleteRouteTable(routeTableId: string, region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteRouteTableCommand({ RouteTableId: routeTableId }));

      return {
        success: true,
        message: `Route table ${routeTableId} deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete route table ${routeTableId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // Internet Gateway Operations
  // =============================================================================

  /**
   * List Internet Gateways
   */
  async listInternetGateways(
    vpcId?: string,
    region?: string
  ): Promise<NetworkOperationResult<InternetGatewayInfo[]>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      const filters: Filter[] = [];
      if (vpcId) {
        filters.push({ Name: 'attachment.vpc-id', Values: [vpcId] });
      }

      const response = await client.send(new DescribeInternetGatewaysCommand({
        Filters: filters.length > 0 ? filters : undefined,
      }));

      const igws: InternetGatewayInfo[] = (response.InternetGateways || []).map(igw => ({
        internetGatewayId: igw.InternetGatewayId!,
        attachments: (igw.Attachments || []).map(a => ({
          vpcId: a.VpcId!,
          state: a.State as InternetGatewayInfo['attachments'][0]['state'],
        })),
        ownerId: igw.OwnerId!,
        tags: this.fromAWSTags(igw.Tags),
        region: targetRegion,
      }));

      return {
        success: true,
        data: igws,
        message: `Found ${igws.length} Internet Gateways`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list Internet Gateways',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create an Internet Gateway
   */
  async createInternetGateway(
    options: CreateInternetGatewayOptions = {}
  ): Promise<NetworkOperationResult<InternetGatewayInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateInternetGatewayCommand({
        TagSpecifications: [{
          ResourceType: 'internet-gateway',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const igw = response.InternetGateway!;

      // Attach to VPC if specified
      if (options.vpcId) {
        await client.send(new AttachInternetGatewayCommand({
          InternetGatewayId: igw.InternetGatewayId,
          VpcId: options.vpcId,
        }));
      }

      const igwInfo: InternetGatewayInfo = {
        internetGatewayId: igw.InternetGatewayId!,
        attachments: options.vpcId ? [{ vpcId: options.vpcId, state: 'attached' }] : [],
        ownerId: igw.OwnerId!,
        tags: this.fromAWSTags(igw.Tags),
        region,
      };

      return {
        success: true,
        data: igwInfo,
        message: `Internet Gateway ${igw.InternetGatewayId} created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create Internet Gateway',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an Internet Gateway
   */
  async deleteInternetGateway(
    internetGatewayId: string,
    vpcId?: string,
    region?: string
  ): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      // Detach from VPC first if attached
      if (vpcId) {
        await client.send(new DetachInternetGatewayCommand({
          InternetGatewayId: internetGatewayId,
          VpcId: vpcId,
        }));
      }

      await client.send(new DeleteInternetGatewayCommand({
        InternetGatewayId: internetGatewayId,
      }));

      return {
        success: true,
        message: `Internet Gateway ${internetGatewayId} deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete Internet Gateway ${internetGatewayId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // NAT Gateway Operations
  // =============================================================================

  /**
   * List NAT Gateways
   */
  async listNATGateways(options: ListNATGatewaysOptions = {}): Promise<NetworkOperationResult<NATGatewayInfo[]>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const filters: Filter[] = [];
      if (options.vpcId) {
        filters.push({ Name: 'vpc-id', Values: [options.vpcId] });
      }
      if (options.subnetId) {
        filters.push({ Name: 'subnet-id', Values: [options.subnetId] });
      }
      if (options.state) {
        filters.push({ Name: 'state', Values: [options.state] });
      }
      if (options.tag) {
        filters.push({ Name: `tag:${options.tag.key}`, Values: [options.tag.value] });
      }

      const response = await client.send(new DescribeNatGatewaysCommand({
        NatGatewayIds: options.natGatewayIds,
        Filter: filters.length > 0 ? filters : undefined,
      }));

      const natGateways: NATGatewayInfo[] = (response.NatGateways || []).map(nat => ({
        natGatewayId: nat.NatGatewayId!,
        vpcId: nat.VpcId!,
        subnetId: nat.SubnetId!,
        state: nat.State as NATGatewayInfo['state'],
        connectivityType: nat.ConnectivityType as NATGatewayInfo['connectivityType'],
        allocationId: nat.NatGatewayAddresses?.[0]?.AllocationId,
        publicIp: nat.NatGatewayAddresses?.[0]?.PublicIp,
        privateIp: nat.NatGatewayAddresses?.[0]?.PrivateIp,
        networkInterfaceId: nat.NatGatewayAddresses?.[0]?.NetworkInterfaceId,
        createTime: nat.CreateTime,
        failureCode: nat.FailureCode,
        failureMessage: nat.FailureMessage,
        tags: this.fromAWSTags(nat.Tags),
        region,
      }));

      return {
        success: true,
        data: natGateways,
        message: `Found ${natGateways.length} NAT Gateways`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list NAT Gateways',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a NAT Gateway
   */
  async createNATGateway(options: CreateNATGatewayOptions): Promise<NetworkOperationResult<NATGatewayInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      let allocationId = options.allocationId;

      // Allocate EIP if public and no allocation ID provided
      if (options.connectivityType !== 'private' && !allocationId) {
        const eipResponse = await client.send(new AllocateAddressCommand({
          Domain: 'vpc',
          TagSpecifications: [{
            ResourceType: 'elastic-ip',
            Tags: this.toAWSTags(options.tags, options.name ? `${options.name}-eip` : undefined),
          }],
        }));
        allocationId = eipResponse.AllocationId;
      }

      const response = await client.send(new CreateNatGatewayCommand({
        SubnetId: options.subnetId,
        ConnectivityType: options.connectivityType || 'public',
        AllocationId: allocationId,
        TagSpecifications: [{
          ResourceType: 'natgateway',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const nat = response.NatGateway!;

      const natInfo: NATGatewayInfo = {
        natGatewayId: nat.NatGatewayId!,
        vpcId: nat.VpcId!,
        subnetId: nat.SubnetId!,
        state: nat.State as NATGatewayInfo['state'],
        connectivityType: (nat.ConnectivityType as NATGatewayInfo['connectivityType']) || 'public',
        allocationId: nat.NatGatewayAddresses?.[0]?.AllocationId,
        publicIp: nat.NatGatewayAddresses?.[0]?.PublicIp,
        privateIp: nat.NatGatewayAddresses?.[0]?.PrivateIp,
        createTime: nat.CreateTime,
        tags: this.fromAWSTags(nat.Tags),
        region,
      };

      return {
        success: true,
        data: natInfo,
        message: `NAT Gateway ${nat.NatGatewayId} created (state: ${nat.State})`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create NAT Gateway',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a NAT Gateway
   */
  async deleteNATGateway(natGatewayId: string, region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteNatGatewayCommand({ NatGatewayId: natGatewayId }));

      return {
        success: true,
        message: `NAT Gateway ${natGatewayId} deletion initiated`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete NAT Gateway ${natGatewayId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // VPC Peering Operations
  // =============================================================================

  /**
   * List VPC Peering connections
   */
  async listVPCPeering(options: ListVPCPeeringOptions = {}): Promise<NetworkOperationResult<VPCPeeringInfo[]>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const filters: Filter[] = [];
      if (options.requesterVpcId) {
        filters.push({ Name: 'requester-vpc-info.vpc-id', Values: [options.requesterVpcId] });
      }
      if (options.accepterVpcId) {
        filters.push({ Name: 'accepter-vpc-info.vpc-id', Values: [options.accepterVpcId] });
      }
      if (options.status) {
        filters.push({ Name: 'status-code', Values: [options.status] });
      }
      if (options.tag) {
        filters.push({ Name: `tag:${options.tag.key}`, Values: [options.tag.value] });
      }

      const response = await client.send(new DescribeVpcPeeringConnectionsCommand({
        VpcPeeringConnectionIds: options.peeringConnectionIds,
        Filters: filters.length > 0 ? filters : undefined,
      }));

      const peerings: VPCPeeringInfo[] = (response.VpcPeeringConnections || []).map(pcx => ({
        vpcPeeringConnectionId: pcx.VpcPeeringConnectionId!,
        requesterVpc: {
          vpcId: pcx.RequesterVpcInfo?.VpcId || '',
          cidrBlock: pcx.RequesterVpcInfo?.CidrBlock || '',
          ownerId: pcx.RequesterVpcInfo?.OwnerId || '',
          region: pcx.RequesterVpcInfo?.Region || region,
        },
        accepterVpc: {
          vpcId: pcx.AccepterVpcInfo?.VpcId || '',
          cidrBlock: pcx.AccepterVpcInfo?.CidrBlock || '',
          ownerId: pcx.AccepterVpcInfo?.OwnerId || '',
          region: pcx.AccepterVpcInfo?.Region || region,
        },
        status: {
          code: pcx.Status?.Code as VPCPeeringInfo['status']['code'],
          message: pcx.Status?.Message,
        },
        expirationTime: pcx.ExpirationTime,
        tags: this.fromAWSTags(pcx.Tags),
        region,
      }));

      return {
        success: true,
        data: peerings,
        message: `Found ${peerings.length} VPC Peering connections`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list VPC Peering connections',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a VPC Peering connection
   */
  async createVPCPeering(options: CreateVPCPeeringOptions): Promise<NetworkOperationResult<VPCPeeringInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateVpcPeeringConnectionCommand({
        VpcId: options.vpcId,
        PeerVpcId: options.peerVpcId,
        PeerOwnerId: options.peerOwnerId,
        PeerRegion: options.peerRegion,
        TagSpecifications: [{
          ResourceType: 'vpc-peering-connection',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const pcx = response.VpcPeeringConnection!;

      const peeringInfo: VPCPeeringInfo = {
        vpcPeeringConnectionId: pcx.VpcPeeringConnectionId!,
        requesterVpc: {
          vpcId: pcx.RequesterVpcInfo?.VpcId || '',
          cidrBlock: pcx.RequesterVpcInfo?.CidrBlock || '',
          ownerId: pcx.RequesterVpcInfo?.OwnerId || '',
          region: pcx.RequesterVpcInfo?.Region || region,
        },
        accepterVpc: {
          vpcId: pcx.AccepterVpcInfo?.VpcId || '',
          cidrBlock: pcx.AccepterVpcInfo?.CidrBlock || '',
          ownerId: pcx.AccepterVpcInfo?.OwnerId || '',
          region: pcx.AccepterVpcInfo?.Region || options.peerRegion || region,
        },
        status: {
          code: pcx.Status?.Code as VPCPeeringInfo['status']['code'],
          message: pcx.Status?.Message,
        },
        tags: this.fromAWSTags(pcx.Tags),
        region,
      };

      return {
        success: true,
        data: peeringInfo,
        message: `VPC Peering connection ${pcx.VpcPeeringConnectionId} created (status: ${pcx.Status?.Code})`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create VPC Peering connection',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Accept a VPC Peering connection
   */
  async acceptVPCPeering(
    peeringConnectionId: string,
    region?: string
  ): Promise<NetworkOperationResult<VPCPeeringInfo>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      const response = await client.send(new AcceptVpcPeeringConnectionCommand({
        VpcPeeringConnectionId: peeringConnectionId,
      }));

      const pcx = response.VpcPeeringConnection!;

      const peeringInfo: VPCPeeringInfo = {
        vpcPeeringConnectionId: pcx.VpcPeeringConnectionId!,
        requesterVpc: {
          vpcId: pcx.RequesterVpcInfo?.VpcId || '',
          cidrBlock: pcx.RequesterVpcInfo?.CidrBlock || '',
          ownerId: pcx.RequesterVpcInfo?.OwnerId || '',
          region: pcx.RequesterVpcInfo?.Region || targetRegion,
        },
        accepterVpc: {
          vpcId: pcx.AccepterVpcInfo?.VpcId || '',
          cidrBlock: pcx.AccepterVpcInfo?.CidrBlock || '',
          ownerId: pcx.AccepterVpcInfo?.OwnerId || '',
          region: pcx.AccepterVpcInfo?.Region || targetRegion,
        },
        status: {
          code: pcx.Status?.Code as VPCPeeringInfo['status']['code'],
          message: pcx.Status?.Message,
        },
        tags: this.fromAWSTags(pcx.Tags),
        region: targetRegion,
      };

      return {
        success: true,
        data: peeringInfo,
        message: `VPC Peering connection ${peeringConnectionId} accepted`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to accept VPC Peering connection ${peeringConnectionId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a VPC Peering connection
   */
  async deleteVPCPeering(peeringConnectionId: string, region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteVpcPeeringConnectionCommand({
        VpcPeeringConnectionId: peeringConnectionId,
      }));

      return {
        success: true,
        message: `VPC Peering connection ${peeringConnectionId} deleted`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete VPC Peering connection ${peeringConnectionId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // Transit Gateway Operations
  // =============================================================================

  /**
   * List Transit Gateways
   */
  async listTransitGateways(region?: string): Promise<NetworkOperationResult<TransitGatewayInfo[]>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      const response = await client.send(new DescribeTransitGatewaysCommand({}));

      const tgws: TransitGatewayInfo[] = (response.TransitGateways || []).map(tgw => ({
        transitGatewayId: tgw.TransitGatewayId!,
        arn: tgw.TransitGatewayArn!,
        state: tgw.State as TransitGatewayInfo['state'],
        ownerId: tgw.OwnerId!,
        description: tgw.Description,
        creationTime: tgw.CreationTime,
        associationDefaultRouteTableId: tgw.Options?.AssociationDefaultRouteTableId,
        propagationDefaultRouteTableId: tgw.Options?.PropagationDefaultRouteTableId,
        amazonSideAsn: tgw.Options?.AmazonSideAsn,
        options: tgw.Options ? {
          autoAcceptSharedAttachments: tgw.Options.AutoAcceptSharedAttachments === 'enable',
          defaultRouteTableAssociation: tgw.Options.DefaultRouteTableAssociation === 'enable',
          defaultRouteTablePropagation: tgw.Options.DefaultRouteTablePropagation === 'enable',
          vpnEcmpSupport: tgw.Options.VpnEcmpSupport === 'enable',
          dnsSupport: tgw.Options.DnsSupport === 'enable',
          multicastSupport: tgw.Options.MulticastSupport === 'enable',
        } : undefined,
        tags: this.fromAWSTags(tgw.Tags),
        region: targetRegion,
      }));

      return {
        success: true,
        data: tgws,
        message: `Found ${tgws.length} Transit Gateways`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list Transit Gateways',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a Transit Gateway
   */
  async createTransitGateway(
    options: CreateTransitGatewayOptions = {}
  ): Promise<NetworkOperationResult<TransitGatewayInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateTransitGatewayCommand({
        Description: options.description,
        Options: {
          AmazonSideAsn: options.amazonSideAsn,
          AutoAcceptSharedAttachments: options.autoAcceptSharedAttachments ? 'enable' : 'disable',
          DefaultRouteTableAssociation: options.defaultRouteTableAssociation !== false ? 'enable' : 'disable',
          DefaultRouteTablePropagation: options.defaultRouteTablePropagation !== false ? 'enable' : 'disable',
          VpnEcmpSupport: options.vpnEcmpSupport !== false ? 'enable' : 'disable',
          DnsSupport: options.dnsSupport !== false ? 'enable' : 'disable',
          MulticastSupport: options.multicastSupport ? 'enable' : 'disable',
        },
        TagSpecifications: [{
          ResourceType: 'transit-gateway',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const tgw = response.TransitGateway!;

      const tgwInfo: TransitGatewayInfo = {
        transitGatewayId: tgw.TransitGatewayId!,
        arn: tgw.TransitGatewayArn!,
        state: tgw.State as TransitGatewayInfo['state'],
        ownerId: tgw.OwnerId!,
        description: tgw.Description,
        creationTime: tgw.CreationTime,
        tags: this.fromAWSTags(tgw.Tags),
        region,
      };

      return {
        success: true,
        data: tgwInfo,
        message: `Transit Gateway ${tgw.TransitGatewayId} created (state: ${tgw.State})`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create Transit Gateway',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Attach VPC to Transit Gateway
   */
  async attachVPCToTransitGateway(
    options: AttachVPCToTransitGatewayOptions
  ): Promise<NetworkOperationResult<TransitGatewayAttachmentInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateTransitGatewayVpcAttachmentCommand({
        TransitGatewayId: options.transitGatewayId,
        VpcId: options.vpcId,
        SubnetIds: options.subnetIds,
        Options: {
          DnsSupport: options.dnsSupport !== false ? 'enable' : 'disable',
          Ipv6Support: options.ipv6Support ? 'enable' : 'disable',
          ApplianceModeSupport: options.applianceModeSupport ? 'enable' : 'disable',
        },
        TagSpecifications: [{
          ResourceType: 'transit-gateway-attachment',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const attachment = response.TransitGatewayVpcAttachment!;

      const attachmentInfo: TransitGatewayAttachmentInfo = {
        transitGatewayAttachmentId: attachment.TransitGatewayAttachmentId!,
        transitGatewayId: attachment.TransitGatewayId!,
        resourceType: 'vpc',
        resourceId: attachment.VpcId!,
        resourceOwnerId: attachment.VpcOwnerId!,
        state: attachment.State as TransitGatewayAttachmentInfo['state'],
        creationTime: attachment.CreationTime,
        tags: this.fromAWSTags(attachment.Tags),
      };

      return {
        success: true,
        data: attachmentInfo,
        message: `VPC ${options.vpcId} attached to Transit Gateway ${options.transitGatewayId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to attach VPC to Transit Gateway',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a Transit Gateway
   */
  async deleteTransitGateway(transitGatewayId: string, region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteTransitGatewayCommand({
        TransitGatewayId: transitGatewayId,
      }));

      return {
        success: true,
        message: `Transit Gateway ${transitGatewayId} deletion initiated`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete Transit Gateway ${transitGatewayId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // Network ACL Operations
  // =============================================================================

  /**
   * List Network ACLs
   */
  async listNetworkACLs(vpcId?: string, region?: string): Promise<NetworkOperationResult<NetworkACLInfo[]>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      const filters: Filter[] = [];
      if (vpcId) {
        filters.push({ Name: 'vpc-id', Values: [vpcId] });
      }

      const response = await client.send(new DescribeNetworkAclsCommand({
        Filters: filters.length > 0 ? filters : undefined,
      }));

      const nacls: NetworkACLInfo[] = (response.NetworkAcls || []).map(nacl => ({
        networkAclId: nacl.NetworkAclId!,
        vpcId: nacl.VpcId!,
        isDefault: nacl.IsDefault || false,
        entries: (nacl.Entries || []).map(entry => ({
          ruleNumber: entry.RuleNumber!,
          protocol: entry.Protocol!,
          ruleAction: entry.RuleAction as NetworkACLEntry['ruleAction'],
          egress: entry.Egress || false,
          cidrBlock: entry.CidrBlock,
          ipv6CidrBlock: entry.Ipv6CidrBlock,
          portRange: entry.PortRange ? {
            from: entry.PortRange.From!,
            to: entry.PortRange.To!,
          } : undefined,
          icmpTypeCode: entry.IcmpTypeCode ? {
            type: entry.IcmpTypeCode.Type!,
            code: entry.IcmpTypeCode.Code!,
          } : undefined,
        })),
        associations: (nacl.Associations || []).map(assoc => ({
          networkAclAssociationId: assoc.NetworkAclAssociationId!,
          networkAclId: assoc.NetworkAclId!,
          subnetId: assoc.SubnetId!,
        })),
        ownerId: nacl.OwnerId!,
        tags: this.fromAWSTags(nacl.Tags),
        region: targetRegion,
      }));

      return {
        success: true,
        data: nacls,
        message: `Found ${nacls.length} Network ACLs`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list Network ACLs',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a Network ACL
   */
  async createNetworkACL(options: CreateNetworkACLOptions): Promise<NetworkOperationResult<NetworkACLInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateNetworkAclCommand({
        VpcId: options.vpcId,
        TagSpecifications: [{
          ResourceType: 'network-acl',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const nacl = response.NetworkAcl!;

      const naclInfo: NetworkACLInfo = {
        networkAclId: nacl.NetworkAclId!,
        vpcId: nacl.VpcId!,
        isDefault: false,
        entries: (nacl.Entries || []).map(entry => ({
          ruleNumber: entry.RuleNumber!,
          protocol: entry.Protocol!,
          ruleAction: entry.RuleAction as NetworkACLEntry['ruleAction'],
          egress: entry.Egress || false,
          cidrBlock: entry.CidrBlock,
        })),
        associations: [],
        ownerId: nacl.OwnerId!,
        tags: this.fromAWSTags(nacl.Tags),
        region,
      };

      return {
        success: true,
        data: naclInfo,
        message: `Network ACL ${nacl.NetworkAclId} created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create Network ACL',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a Network ACL entry (rule)
   */
  async createNetworkACLEntry(options: CreateNetworkACLEntryOptions): Promise<NetworkOperationResult<void>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      await client.send(new CreateNetworkAclEntryCommand({
        NetworkAclId: options.networkAclId,
        RuleNumber: options.ruleNumber,
        Protocol: options.protocol,
        RuleAction: options.ruleAction,
        Egress: options.egress,
        CidrBlock: options.cidrBlock,
        Ipv6CidrBlock: options.ipv6CidrBlock,
        PortRange: options.fromPort !== undefined ? {
          From: options.fromPort,
          To: options.toPort ?? options.fromPort,
        } : undefined,
        IcmpTypeCode: options.icmpType !== undefined ? {
          Type: options.icmpType,
          Code: options.icmpCode ?? -1,
        } : undefined,
      }));

      return {
        success: true,
        message: `Network ACL entry created (rule ${options.ruleNumber})`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create Network ACL entry',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a Network ACL
   */
  async deleteNetworkACL(networkAclId: string, region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteNetworkAclCommand({ NetworkAclId: networkAclId }));

      return {
        success: true,
        message: `Network ACL ${networkAclId} deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete Network ACL ${networkAclId}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // VPC Endpoint Operations
  // =============================================================================

  /**
   * List VPC Endpoints
   */
  async listVPCEndpoints(options: ListVPCEndpointsOptions = {}): Promise<NetworkOperationResult<VPCEndpointInfo[]>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const filters: Filter[] = [];
      if (options.vpcId) {
        filters.push({ Name: 'vpc-id', Values: [options.vpcId] });
      }
      if (options.serviceName) {
        filters.push({ Name: 'service-name', Values: [options.serviceName] });
      }
      if (options.state) {
        filters.push({ Name: 'vpc-endpoint-state', Values: [options.state] });
      }
      if (options.tag) {
        filters.push({ Name: `tag:${options.tag.key}`, Values: [options.tag.value] });
      }

      const response = await client.send(new DescribeVpcEndpointsCommand({
        VpcEndpointIds: options.vpcEndpointIds,
        Filters: filters.length > 0 ? filters : undefined,
      }));

      const endpoints: VPCEndpointInfo[] = (response.VpcEndpoints || []).map(ep => ({
        vpcEndpointId: ep.VpcEndpointId!,
        vpcId: ep.VpcId!,
        serviceName: ep.ServiceName!,
        vpcEndpointType: ep.VpcEndpointType as VPCEndpointInfo['vpcEndpointType'],
        state: ep.State as VPCEndpointInfo['state'],
        policyDocument: ep.PolicyDocument,
        routeTableIds: ep.RouteTableIds,
        subnetIds: ep.SubnetIds,
        groups: ep.Groups?.map(g => ({
          groupId: g.GroupId!,
          groupName: g.GroupName!,
        })),
        privateDnsEnabled: ep.PrivateDnsEnabled || false,
        networkInterfaceIds: ep.NetworkInterfaceIds,
        dnsEntries: ep.DnsEntries?.map(d => ({
          dnsName: d.DnsName!,
          hostedZoneId: d.HostedZoneId!,
        })),
        creationTimestamp: ep.CreationTimestamp,
        ownerId: ep.OwnerId!,
        tags: this.fromAWSTags(ep.Tags),
        region,
      }));

      return {
        success: true,
        data: endpoints,
        message: `Found ${endpoints.length} VPC Endpoints`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list VPC Endpoints',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List available VPC Endpoint services
   */
  async listVPCEndpointServices(region?: string): Promise<NetworkOperationResult<VPCEndpointServiceInfo[]>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      const response = await client.send(new DescribeVpcEndpointServicesCommand({}));

      const services: VPCEndpointServiceInfo[] = (response.ServiceDetails || []).map(svc => ({
        serviceName: svc.ServiceName!,
        serviceId: svc.ServiceId,
        serviceType: svc.ServiceType?.map(t => t.ServiceType as VPCEndpointServiceInfo['serviceType'][0]) || [],
        availabilityZones: svc.AvailabilityZones || [],
        owner: svc.Owner!,
        acceptanceRequired: svc.AcceptanceRequired || false,
        managesVpcEndpoints: svc.ManagesVpcEndpoints || false,
        baseEndpointDnsNames: svc.BaseEndpointDnsNames,
        privateDnsName: svc.PrivateDnsName,
        vpcEndpointPolicySupported: svc.VpcEndpointPolicySupported || false,
        supportedIpAddressTypes: svc.SupportedIpAddressTypes,
      }));

      return {
        success: true,
        data: services,
        message: `Found ${services.length} VPC Endpoint services`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list VPC Endpoint services',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a VPC Endpoint
   */
  async createVPCEndpoint(options: CreateVPCEndpointOptions): Promise<NetworkOperationResult<VPCEndpointInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateVpcEndpointCommand({
        VpcId: options.vpcId,
        ServiceName: options.serviceName,
        VpcEndpointType: options.vpcEndpointType,
        RouteTableIds: options.routeTableIds,
        SubnetIds: options.subnetIds,
        SecurityGroupIds: options.securityGroupIds,
        PrivateDnsEnabled: options.privateDnsEnabled,
        PolicyDocument: options.policyDocument,
        TagSpecifications: [{
          ResourceType: 'vpc-endpoint',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const ep = response.VpcEndpoint!;

      const endpointInfo: VPCEndpointInfo = {
        vpcEndpointId: ep.VpcEndpointId!,
        vpcId: ep.VpcId!,
        serviceName: ep.ServiceName!,
        vpcEndpointType: ep.VpcEndpointType as VPCEndpointInfo['vpcEndpointType'],
        state: ep.State as VPCEndpointInfo['state'],
        policyDocument: ep.PolicyDocument,
        routeTableIds: ep.RouteTableIds,
        subnetIds: ep.SubnetIds,
        privateDnsEnabled: ep.PrivateDnsEnabled || false,
        creationTimestamp: ep.CreationTimestamp,
        ownerId: ep.OwnerId!,
        tags: this.fromAWSTags(ep.Tags),
        region,
      };

      return {
        success: true,
        data: endpointInfo,
        message: `VPC Endpoint ${ep.VpcEndpointId} created for ${options.serviceName}`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create VPC Endpoint',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete VPC Endpoints
   */
  async deleteVPCEndpoints(vpcEndpointIds: string[], region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteVpcEndpointsCommand({
        VpcEndpointIds: vpcEndpointIds,
      }));

      return {
        success: true,
        message: `Deleted ${vpcEndpointIds.length} VPC Endpoint(s)`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to delete VPC Endpoints',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // Flow Logs Operations
  // =============================================================================

  /**
   * List Flow Logs
   */
  async listFlowLogs(options: ListFlowLogsOptions = {}): Promise<NetworkOperationResult<FlowLogInfo[]>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const filters: Filter[] = [];
      if (options.resourceId) {
        filters.push({ Name: 'resource-id', Values: [options.resourceId] });
      }
      if (options.trafficType) {
        filters.push({ Name: 'traffic-type', Values: [options.trafficType] });
      }
      if (options.logDestinationType) {
        filters.push({ Name: 'log-destination-type', Values: [options.logDestinationType] });
      }
      if (options.tag) {
        filters.push({ Name: `tag:${options.tag.key}`, Values: [options.tag.value] });
      }

      const response = await client.send(new DescribeFlowLogsCommand({
        FlowLogIds: options.flowLogIds,
        Filter: filters.length > 0 ? filters : undefined,
      }));

      const flowLogs: FlowLogInfo[] = (response.FlowLogs || []).map(fl => ({
        flowLogId: fl.FlowLogId!,
        flowLogStatus: fl.FlowLogStatus as FlowLogInfo['flowLogStatus'],
        resourceId: fl.ResourceId!,
        trafficType: fl.TrafficType as FlowLogInfo['trafficType'],
        logDestinationType: fl.LogDestinationType as FlowLogInfo['logDestinationType'],
        logDestination: fl.LogDestination,
        logGroupName: fl.LogGroupName,
        deliverLogsPermissionArn: fl.DeliverLogsPermissionArn,
        deliverLogsStatus: fl.DeliverLogsStatus,
        deliverLogsErrorMessage: fl.DeliverLogsErrorMessage,
        logFormat: fl.LogFormat,
        maxAggregationInterval: fl.MaxAggregationInterval,
        creationTime: fl.CreationTime,
        tags: this.fromAWSTags(fl.Tags),
        region,
      }));

      return {
        success: true,
        data: flowLogs,
        message: `Found ${flowLogs.length} Flow Logs`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list Flow Logs',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a Flow Log
   */
  async createFlowLog(options: CreateFlowLogOptions): Promise<NetworkOperationResult<FlowLogInfo>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);

      const response = await client.send(new CreateFlowLogsCommand({
        ResourceIds: [options.resourceId],
        ResourceType: options.resourceType,
        TrafficType: options.trafficType,
        LogDestinationType: options.logDestinationType,
        LogDestination: options.logDestination,
        LogGroupName: options.logGroupName,
        DeliverLogsPermissionArn: options.deliverLogsPermissionArn,
        LogFormat: options.logFormat,
        MaxAggregationInterval: options.maxAggregationInterval,
        TagSpecifications: [{
          ResourceType: 'vpc-flow-log',
          Tags: this.toAWSTags(options.tags, options.name),
        }],
      }));

      const flowLogId = response.FlowLogIds?.[0];

      if (!flowLogId || response.Unsuccessful?.length) {
        return {
          success: false,
          message: 'Failed to create Flow Log',
          error: response.Unsuccessful?.[0]?.Error?.Message || 'Unknown error',
        };
      }

      const flowLogInfo: FlowLogInfo = {
        flowLogId,
        flowLogStatus: 'ACTIVE',
        resourceId: options.resourceId,
        trafficType: options.trafficType,
        logDestinationType: options.logDestinationType,
        logDestination: options.logDestination,
        logGroupName: options.logGroupName,
        deliverLogsPermissionArn: options.deliverLogsPermissionArn,
        logFormat: options.logFormat,
        maxAggregationInterval: options.maxAggregationInterval,
        region,
      };

      return {
        success: true,
        data: flowLogInfo,
        message: `Flow Log ${flowLogId} created for ${options.resourceId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create Flow Log',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete Flow Logs
   */
  async deleteFlowLogs(flowLogIds: string[], region?: string): Promise<NetworkOperationResult<void>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      await client.send(new DeleteFlowLogsCommand({
        FlowLogIds: flowLogIds,
      }));

      return {
        success: true,
        message: `Deleted ${flowLogIds.length} Flow Log(s)`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to delete Flow Logs',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================================================
  // High-Level Operations
  // =============================================================================

  /**
   * Create a multi-AZ VPC with public and private subnets
   */
  async createMultiAZVPC(
    options: CreateMultiAZVPCOptions
  ): Promise<NetworkOperationResult<CreateMultiAZVPCResult>> {
    try {
      const region = options.region || this.config.defaultRegion!;
      const client = this.createClient(region);
      const azCount = options.azCount || 2;
      const warnings: string[] = [];

      // Get available AZs
      const azResponse = await client.send(new DescribeAvailabilityZonesCommand({
        Filters: [{ Name: 'state', Values: ['available'] }],
      }));
      const availableAZs = (azResponse.AvailabilityZones || [])
        .map(az => az.ZoneName!)
        .slice(0, azCount);

      if (availableAZs.length < azCount) {
        warnings.push(`Only ${availableAZs.length} AZs available, requested ${azCount}`);
      }

      // Create VPC
      const vpcResult = await this.createVPC({
        cidrBlock: options.cidrBlock,
        name: options.name,
        enableDnsHostnames: options.enableDnsHostnames ?? true,
        enableDnsSupport: options.enableDnsSupport ?? true,
        tags: options.tags,
        region,
      });

      if (!vpcResult.success || !vpcResult.data) {
        return {
          success: false,
          message: `Failed to create VPC: ${vpcResult.error}`,
          error: vpcResult.error,
        };
      }

      const vpc = vpcResult.data;

      // Calculate subnet CIDRs
      const cidrParts = options.cidrBlock.split('/');
      const baseCidr = cidrParts[0];
      const baseOctets = baseCidr.split('.').map(Number);
      
      // Create Internet Gateway
      const igwResult = await this.createInternetGateway({
        name: `${options.name}-igw`,
        vpcId: vpc.vpcId,
        tags: options.tags,
        region,
      });

      if (!igwResult.success || !igwResult.data) {
        return {
          success: false,
          message: `Failed to create Internet Gateway: ${igwResult.error}`,
          error: igwResult.error,
        };
      }

      const igw = igwResult.data;

      // Create public route table
      const publicRtResult = await this.createRouteTable({
        vpcId: vpc.vpcId,
        name: `${options.name}-public-rt`,
        tags: options.tags,
        region,
      });

      if (!publicRtResult.success || !publicRtResult.data) {
        return {
          success: false,
          message: `Failed to create public route table: ${publicRtResult.error}`,
          error: publicRtResult.error,
        };
      }

      // Add route to Internet Gateway
      await this.createRoute({
        routeTableId: publicRtResult.data.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        gatewayId: igw.internetGatewayId,
        region,
      });

      const publicSubnets: SubnetInfo[] = [];
      const privateSubnets: SubnetInfo[] = [];
      const natGateways: NATGatewayInfo[] = [];
      const privateRouteTables: RouteTableInfo[] = [];

      // Create subnets in each AZ
      for (let i = 0; i < availableAZs.length; i++) {
        const az = availableAZs[i];
        const publicSubnetCidr = `${baseOctets[0]}.${baseOctets[1]}.${i * 2}.0/24`;
        const privateSubnetCidr = `${baseOctets[0]}.${baseOctets[1]}.${i * 2 + 1}.0/24`;

        // Create public subnet
        const publicSubnetResult = await this.createSubnet({
          vpcId: vpc.vpcId,
          cidrBlock: publicSubnetCidr,
          availabilityZone: az,
          name: `${options.name}-public-${az}`,
          mapPublicIpOnLaunch: true,
          tags: { ...options.tags, Tier: 'Public' },
          region,
        });

        if (publicSubnetResult.success && publicSubnetResult.data) {
          publicSubnets.push(publicSubnetResult.data);
          // Associate with public route table
          await this.associateRouteTable(
            publicRtResult.data.routeTableId,
            publicSubnetResult.data.subnetId,
            region
          );
        }

        // Create private subnet
        const privateSubnetResult = await this.createSubnet({
          vpcId: vpc.vpcId,
          cidrBlock: privateSubnetCidr,
          availabilityZone: az,
          name: `${options.name}-private-${az}`,
          mapPublicIpOnLaunch: false,
          tags: { ...options.tags, Tier: 'Private' },
          region,
        });

        if (privateSubnetResult.success && privateSubnetResult.data) {
          privateSubnets.push(privateSubnetResult.data);

          // Create NAT Gateway if requested
          if (options.createNatGateways && (i === 0 || !options.singleNatGateway)) {
            const natResult = await this.createNATGateway({
              subnetId: publicSubnets[options.singleNatGateway ? 0 : i].subnetId,
              name: `${options.name}-nat-${az}`,
              tags: options.tags,
              region,
            });

            if (natResult.success && natResult.data) {
              natGateways.push(natResult.data);
            }
          }

          // Create private route table
          const privateRtResult = await this.createRouteTable({
            vpcId: vpc.vpcId,
            name: `${options.name}-private-rt-${az}`,
            tags: options.tags,
            region,
          });

          if (privateRtResult.success && privateRtResult.data) {
            privateRouteTables.push(privateRtResult.data);

            // Associate with private subnet
            await this.associateRouteTable(
              privateRtResult.data.routeTableId,
              privateSubnetResult.data.subnetId,
              region
            );

            // Add route to NAT Gateway if available
            const natToUse = options.singleNatGateway ? natGateways[0] : natGateways[i];
            if (natToUse) {
              await this.createRoute({
                routeTableId: privateRtResult.data.routeTableId,
                destinationCidrBlock: '0.0.0.0/0',
                natGatewayId: natToUse.natGatewayId,
                region,
              });
            }
          }
        }
      }

      const result: CreateMultiAZVPCResult = {
        vpc,
        publicSubnets,
        privateSubnets,
        internetGateway: igw,
        natGateways: natGateways.length > 0 ? natGateways : undefined,
        publicRouteTable: publicRtResult.data,
        privateRouteTables,
      };

      return {
        success: true,
        data: result,
        message: `Multi-AZ VPC "${options.name}" created with ${publicSubnets.length} public and ${privateSubnets.length} private subnets`,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create Multi-AZ VPC',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get availability zones for a region
   */
  async getAvailabilityZones(region?: string): Promise<NetworkOperationResult<string[]>> {
    try {
      const targetRegion = region || this.config.defaultRegion!;
      const client = this.createClient(targetRegion);

      const response = await client.send(new DescribeAvailabilityZonesCommand({
        Filters: [{ Name: 'state', Values: ['available'] }],
      }));

      const azs = (response.AvailabilityZones || []).map(az => az.ZoneName!);

      return {
        success: true,
        data: azs,
        message: `Found ${azs.length} availability zones in ${targetRegion}`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get availability zones',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
