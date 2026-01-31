/**
 * AWS Network & VPC Management Types
 *
 * Type definitions for VPC, Subnet, Route Table, NAT Gateway,
 * VPC Peering, Transit Gateway, Network ACLs, VPC Endpoints,
 * and Flow Logs operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * VPC state
 */
export type VPCState = 'pending' | 'available';

/**
 * Subnet state
 */
export type SubnetState = 'pending' | 'available';

/**
 * NAT Gateway state
 */
export type NATGatewayState = 'pending' | 'failed' | 'available' | 'deleting' | 'deleted';

/**
 * VPC Peering connection state
 */
export type PeeringState =
  | 'initiating-request'
  | 'pending-acceptance'
  | 'active'
  | 'deleted'
  | 'rejected'
  | 'failed'
  | 'expired'
  | 'provisioning'
  | 'deleting';

/**
 * Transit Gateway state
 */
export type TransitGatewayState =
  | 'pending'
  | 'available'
  | 'modifying'
  | 'deleting'
  | 'deleted';

/**
 * VPC Endpoint type
 */
export type VPCEndpointType = 'Interface' | 'Gateway' | 'GatewayLoadBalancer';

/**
 * VPC Endpoint state
 */
export type VPCEndpointState =
  | 'PendingAcceptance'
  | 'Pending'
  | 'Available'
  | 'Deleting'
  | 'Deleted'
  | 'Rejected'
  | 'Failed'
  | 'Expired';

/**
 * Network ACL rule action
 */
export type NetworkACLAction = 'allow' | 'deny';

/**
 * Flow log traffic type
 */
export type FlowLogTrafficType = 'ACCEPT' | 'REJECT' | 'ALL';

/**
 * Flow log destination type
 */
export type FlowLogDestinationType = 'cloud-watch-logs' | 's3' | 'kinesis-data-firehose';

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Network Manager configuration
 */
export interface NetworkManagerConfig {
  /** Default region for API calls */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Default tags to apply to resources */
  defaultTags?: Record<string, string>;
}

// =============================================================================
// VPC Types
// =============================================================================

/**
 * VPC information
 */
export interface VPCInfo {
  /** VPC ID */
  vpcId: string;
  /** CIDR block */
  cidrBlock: string;
  /** Secondary CIDR blocks */
  secondaryCidrBlocks?: string[];
  /** IPv6 CIDR blocks */
  ipv6CidrBlocks?: string[];
  /** VPC state */
  state: VPCState;
  /** Is default VPC */
  isDefault: boolean;
  /** DNS hostnames enabled */
  enableDnsHostnames: boolean;
  /** DNS support enabled */
  enableDnsSupport: boolean;
  /** Instance tenancy */
  instanceTenancy: string;
  /** Owner ID */
  ownerId: string;
  /** DHCP options set ID */
  dhcpOptionsId?: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a VPC
 */
export interface CreateVPCOptions {
  /** CIDR block for the VPC */
  cidrBlock: string;
  /** VPC name (applied as Name tag) */
  name?: string;
  /** Enable DNS hostnames */
  enableDnsHostnames?: boolean;
  /** Enable DNS support */
  enableDnsSupport?: boolean;
  /** Instance tenancy */
  instanceTenancy?: 'default' | 'dedicated' | 'host';
  /** Request IPv6 CIDR block */
  amazonProvidedIpv6CidrBlock?: boolean;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for listing VPCs
 */
export interface ListVPCsOptions {
  /** Filter by VPC IDs */
  vpcIds?: string[];
  /** Filter by CIDR block */
  cidrBlock?: string;
  /** Filter by state */
  state?: VPCState;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region */
  region?: string;
}

// =============================================================================
// Subnet Types
// =============================================================================

/**
 * Subnet information
 */
export interface SubnetInfo {
  /** Subnet ID */
  subnetId: string;
  /** VPC ID */
  vpcId: string;
  /** Availability Zone */
  availabilityZone: string;
  /** Availability Zone ID */
  availabilityZoneId: string;
  /** CIDR block */
  cidrBlock: string;
  /** IPv6 CIDR block */
  ipv6CidrBlock?: string;
  /** Subnet state */
  state: SubnetState;
  /** Available IP address count */
  availableIpAddressCount: number;
  /** Map public IP on launch */
  mapPublicIpOnLaunch: boolean;
  /** Default for AZ */
  defaultForAz: boolean;
  /** Owner ID */
  ownerId: string;
  /** Subnet ARN */
  arn: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a subnet
 */
export interface CreateSubnetOptions {
  /** VPC ID */
  vpcId: string;
  /** CIDR block */
  cidrBlock: string;
  /** Availability Zone */
  availabilityZone?: string;
  /** Availability Zone ID */
  availabilityZoneId?: string;
  /** Subnet name (applied as Name tag) */
  name?: string;
  /** Map public IP on launch */
  mapPublicIpOnLaunch?: boolean;
  /** IPv6 CIDR block */
  ipv6CidrBlock?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for listing subnets
 */
export interface ListSubnetsOptions {
  /** Filter by subnet IDs */
  subnetIds?: string[];
  /** Filter by VPC ID */
  vpcId?: string;
  /** Filter by availability zone */
  availabilityZone?: string;
  /** Filter by state */
  state?: SubnetState;
  /** Filter by CIDR block */
  cidrBlock?: string;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region */
  region?: string;
}

// =============================================================================
// Route Table Types
// =============================================================================

/**
 * Route entry
 */
export interface RouteEntry {
  /** Destination CIDR block */
  destinationCidrBlock?: string;
  /** Destination IPv6 CIDR block */
  destinationIpv6CidrBlock?: string;
  /** Destination prefix list ID */
  destinationPrefixListId?: string;
  /** Gateway ID (for IGW, VGW) */
  gatewayId?: string;
  /** NAT Gateway ID */
  natGatewayId?: string;
  /** Instance ID */
  instanceId?: string;
  /** Network interface ID */
  networkInterfaceId?: string;
  /** VPC Peering connection ID */
  vpcPeeringConnectionId?: string;
  /** Transit Gateway ID */
  transitGatewayId?: string;
  /** VPC Endpoint ID */
  vpcEndpointId?: string;
  /** Egress-only IGW ID */
  egressOnlyInternetGatewayId?: string;
  /** Route state */
  state: 'active' | 'blackhole';
  /** Route origin */
  origin: 'CreateRouteTable' | 'CreateRoute' | 'EnableVgwRoutePropagation';
}

/**
 * Route table association
 */
export interface RouteTableAssociation {
  /** Association ID */
  associationId: string;
  /** Route table ID */
  routeTableId: string;
  /** Subnet ID */
  subnetId?: string;
  /** Gateway ID */
  gatewayId?: string;
  /** Is main association */
  main: boolean;
  /** Association state */
  state: 'associating' | 'associated' | 'disassociating' | 'disassociated' | 'failed';
}

/**
 * Route table information
 */
export interface RouteTableInfo {
  /** Route table ID */
  routeTableId: string;
  /** VPC ID */
  vpcId: string;
  /** Routes */
  routes: RouteEntry[];
  /** Associations */
  associations: RouteTableAssociation[];
  /** Propagating VGWs */
  propagatingVgws?: string[];
  /** Owner ID */
  ownerId: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a route table
 */
export interface CreateRouteTableOptions {
  /** VPC ID */
  vpcId: string;
  /** Route table name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for creating a route
 */
export interface CreateRouteOptions {
  /** Route table ID */
  routeTableId: string;
  /** Destination CIDR block */
  destinationCidrBlock?: string;
  /** Destination IPv6 CIDR block */
  destinationIpv6CidrBlock?: string;
  /** Gateway ID (for IGW, VGW) */
  gatewayId?: string;
  /** NAT Gateway ID */
  natGatewayId?: string;
  /** Instance ID */
  instanceId?: string;
  /** Network interface ID */
  networkInterfaceId?: string;
  /** VPC Peering connection ID */
  vpcPeeringConnectionId?: string;
  /** Transit Gateway ID */
  transitGatewayId?: string;
  /** VPC Endpoint ID */
  vpcEndpointId?: string;
  /** Region */
  region?: string;
}

/**
 * Options for listing route tables
 */
export interface ListRouteTablesOptions {
  /** Filter by route table IDs */
  routeTableIds?: string[];
  /** Filter by VPC ID */
  vpcId?: string;
  /** Filter by associated subnet */
  subnetId?: string;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region */
  region?: string;
}

// =============================================================================
// Internet Gateway Types
// =============================================================================

/**
 * Internet Gateway information
 */
export interface InternetGatewayInfo {
  /** Internet Gateway ID */
  internetGatewayId: string;
  /** Attached VPCs */
  attachments: Array<{
    vpcId: string;
    state: 'attaching' | 'attached' | 'detaching' | 'detached';
  }>;
  /** Owner ID */
  ownerId: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating an Internet Gateway
 */
export interface CreateInternetGatewayOptions {
  /** Name (applied as Name tag) */
  name?: string;
  /** VPC ID to attach to */
  vpcId?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

// =============================================================================
// NAT Gateway Types
// =============================================================================

/**
 * NAT Gateway information
 */
export interface NATGatewayInfo {
  /** NAT Gateway ID */
  natGatewayId: string;
  /** VPC ID */
  vpcId: string;
  /** Subnet ID */
  subnetId: string;
  /** NAT Gateway state */
  state: NATGatewayState;
  /** Connectivity type */
  connectivityType: 'private' | 'public';
  /** Elastic IP allocation ID */
  allocationId?: string;
  /** Public IP address */
  publicIp?: string;
  /** Private IP address */
  privateIp?: string;
  /** Network interface ID */
  networkInterfaceId?: string;
  /** Creation time */
  createTime?: Date;
  /** Failure code */
  failureCode?: string;
  /** Failure message */
  failureMessage?: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a NAT Gateway
 */
export interface CreateNATGatewayOptions {
  /** Subnet ID */
  subnetId: string;
  /** Connectivity type */
  connectivityType?: 'private' | 'public';
  /** Elastic IP allocation ID (required for public NAT) */
  allocationId?: string;
  /** Name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for listing NAT Gateways
 */
export interface ListNATGatewaysOptions {
  /** Filter by NAT Gateway IDs */
  natGatewayIds?: string[];
  /** Filter by VPC ID */
  vpcId?: string;
  /** Filter by subnet ID */
  subnetId?: string;
  /** Filter by state */
  state?: NATGatewayState;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region */
  region?: string;
}

// =============================================================================
// VPC Peering Types
// =============================================================================

/**
 * VPC Peering connection information
 */
export interface VPCPeeringInfo {
  /** VPC Peering connection ID */
  vpcPeeringConnectionId: string;
  /** Requester VPC info */
  requesterVpc: {
    vpcId: string;
    cidrBlock: string;
    ownerId: string;
    region: string;
  };
  /** Accepter VPC info */
  accepterVpc: {
    vpcId: string;
    cidrBlock: string;
    ownerId: string;
    region: string;
  };
  /** Connection status */
  status: {
    code: PeeringState;
    message?: string;
  };
  /** Expiration time */
  expirationTime?: Date;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a VPC Peering connection
 */
export interface CreateVPCPeeringOptions {
  /** Requester VPC ID */
  vpcId: string;
  /** Peer VPC ID */
  peerVpcId: string;
  /** Peer owner ID (for cross-account peering) */
  peerOwnerId?: string;
  /** Peer region (for cross-region peering) */
  peerRegion?: string;
  /** Name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for listing VPC Peering connections
 */
export interface ListVPCPeeringOptions {
  /** Filter by peering connection IDs */
  peeringConnectionIds?: string[];
  /** Filter by requester VPC ID */
  requesterVpcId?: string;
  /** Filter by accepter VPC ID */
  accepterVpcId?: string;
  /** Filter by status */
  status?: PeeringState;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region */
  region?: string;
}

// =============================================================================
// Transit Gateway Types
// =============================================================================

/**
 * Transit Gateway information
 */
export interface TransitGatewayInfo {
  /** Transit Gateway ID */
  transitGatewayId: string;
  /** Transit Gateway ARN */
  arn: string;
  /** State */
  state: TransitGatewayState;
  /** Owner ID */
  ownerId: string;
  /** Description */
  description?: string;
  /** Creation time */
  creationTime?: Date;
  /** Default route table ID */
  associationDefaultRouteTableId?: string;
  /** Propagation default route table ID */
  propagationDefaultRouteTableId?: string;
  /** Amazon side ASN */
  amazonSideAsn?: number;
  /** Options */
  options?: {
    autoAcceptSharedAttachments: boolean;
    defaultRouteTableAssociation: boolean;
    defaultRouteTablePropagation: boolean;
    vpnEcmpSupport: boolean;
    dnsSupport: boolean;
    multicastSupport: boolean;
  };
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Transit Gateway attachment info
 */
export interface TransitGatewayAttachmentInfo {
  /** Attachment ID */
  transitGatewayAttachmentId: string;
  /** Transit Gateway ID */
  transitGatewayId: string;
  /** Resource type */
  resourceType: 'vpc' | 'vpn' | 'direct-connect-gateway' | 'connect' | 'peering' | 'tgw-peering';
  /** Resource ID */
  resourceId: string;
  /** Resource owner ID */
  resourceOwnerId: string;
  /** State */
  state: 'initiating' | 'initiatingRequest' | 'pendingAcceptance' | 'rollingBack' | 'pending' | 'available' | 'modifying' | 'deleting' | 'deleted' | 'failed' | 'rejected' | 'rejecting' | 'failing';
  /** Creation time */
  creationTime?: Date;
  /** Association */
  association?: {
    transitGatewayRouteTableId: string;
    state: 'associating' | 'associated' | 'disassociating' | 'disassociated';
  };
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Options for creating a Transit Gateway
 */
export interface CreateTransitGatewayOptions {
  /** Description */
  description?: string;
  /** Amazon side ASN */
  amazonSideAsn?: number;
  /** Auto accept shared attachments */
  autoAcceptSharedAttachments?: boolean;
  /** Default route table association */
  defaultRouteTableAssociation?: boolean;
  /** Default route table propagation */
  defaultRouteTablePropagation?: boolean;
  /** VPN ECMP support */
  vpnEcmpSupport?: boolean;
  /** DNS support */
  dnsSupport?: boolean;
  /** Multicast support */
  multicastSupport?: boolean;
  /** Name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for attaching VPC to Transit Gateway
 */
export interface AttachVPCToTransitGatewayOptions {
  /** Transit Gateway ID */
  transitGatewayId: string;
  /** VPC ID */
  vpcId: string;
  /** Subnet IDs */
  subnetIds: string[];
  /** Enable DNS support */
  dnsSupport?: boolean;
  /** Enable IPv6 support */
  ipv6Support?: boolean;
  /** Enable appliance mode support */
  applianceModeSupport?: boolean;
  /** Name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

// =============================================================================
// Network ACL Types
// =============================================================================

/**
 * Network ACL entry
 */
export interface NetworkACLEntry {
  /** Rule number */
  ruleNumber: number;
  /** Protocol (-1 for all) */
  protocol: string;
  /** Rule action */
  ruleAction: NetworkACLAction;
  /** Egress rule */
  egress: boolean;
  /** CIDR block */
  cidrBlock?: string;
  /** IPv6 CIDR block */
  ipv6CidrBlock?: string;
  /** Port range */
  portRange?: {
    from: number;
    to: number;
  };
  /** ICMP type and code */
  icmpTypeCode?: {
    type: number;
    code: number;
  };
}

/**
 * Network ACL association
 */
export interface NetworkACLAssociation {
  /** Association ID */
  networkAclAssociationId: string;
  /** Network ACL ID */
  networkAclId: string;
  /** Subnet ID */
  subnetId: string;
}

/**
 * Network ACL information
 */
export interface NetworkACLInfo {
  /** Network ACL ID */
  networkAclId: string;
  /** VPC ID */
  vpcId: string;
  /** Is default */
  isDefault: boolean;
  /** Entries */
  entries: NetworkACLEntry[];
  /** Associations */
  associations: NetworkACLAssociation[];
  /** Owner ID */
  ownerId: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a Network ACL
 */
export interface CreateNetworkACLOptions {
  /** VPC ID */
  vpcId: string;
  /** Name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for creating a Network ACL entry
 */
export interface CreateNetworkACLEntryOptions {
  /** Network ACL ID */
  networkAclId: string;
  /** Rule number (1-32766) */
  ruleNumber: number;
  /** Protocol number (-1 for all, 6 for TCP, 17 for UDP, 1 for ICMP) */
  protocol: string;
  /** Rule action */
  ruleAction: NetworkACLAction;
  /** Egress rule */
  egress: boolean;
  /** CIDR block */
  cidrBlock?: string;
  /** IPv6 CIDR block */
  ipv6CidrBlock?: string;
  /** From port */
  fromPort?: number;
  /** To port */
  toPort?: number;
  /** ICMP type */
  icmpType?: number;
  /** ICMP code */
  icmpCode?: number;
  /** Region */
  region?: string;
}

// =============================================================================
// VPC Endpoint Types
// =============================================================================

/**
 * VPC Endpoint information
 */
export interface VPCEndpointInfo {
  /** VPC Endpoint ID */
  vpcEndpointId: string;
  /** VPC ID */
  vpcId: string;
  /** Service name */
  serviceName: string;
  /** Endpoint type */
  vpcEndpointType: VPCEndpointType;
  /** State */
  state: VPCEndpointState;
  /** Policy document */
  policyDocument?: string;
  /** Route table IDs (for Gateway endpoints) */
  routeTableIds?: string[];
  /** Subnet IDs (for Interface endpoints) */
  subnetIds?: string[];
  /** Security group IDs (for Interface endpoints) */
  groups?: Array<{
    groupId: string;
    groupName: string;
  }>;
  /** Private DNS enabled */
  privateDnsEnabled: boolean;
  /** Network interface IDs */
  networkInterfaceIds?: string[];
  /** DNS entries */
  dnsEntries?: Array<{
    dnsName: string;
    hostedZoneId: string;
  }>;
  /** Creation timestamp */
  creationTimestamp?: Date;
  /** Owner ID */
  ownerId: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a VPC Endpoint
 */
export interface CreateVPCEndpointOptions {
  /** VPC ID */
  vpcId: string;
  /** Service name (e.g., com.amazonaws.us-east-1.s3) */
  serviceName: string;
  /** Endpoint type */
  vpcEndpointType?: VPCEndpointType;
  /** Route table IDs (for Gateway endpoints) */
  routeTableIds?: string[];
  /** Subnet IDs (for Interface endpoints) */
  subnetIds?: string[];
  /** Security group IDs (for Interface endpoints) */
  securityGroupIds?: string[];
  /** Enable private DNS */
  privateDnsEnabled?: boolean;
  /** Policy document (JSON string) */
  policyDocument?: string;
  /** Name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for listing VPC Endpoints
 */
export interface ListVPCEndpointsOptions {
  /** Filter by VPC Endpoint IDs */
  vpcEndpointIds?: string[];
  /** Filter by VPC ID */
  vpcId?: string;
  /** Filter by service name */
  serviceName?: string;
  /** Filter by state */
  state?: VPCEndpointState;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region */
  region?: string;
}

/**
 * Available VPC Endpoint service
 */
export interface VPCEndpointServiceInfo {
  /** Service name */
  serviceName: string;
  /** Service ID */
  serviceId?: string;
  /** Service type */
  serviceType: VPCEndpointType[];
  /** Availability zones */
  availabilityZones: string[];
  /** Owner */
  owner: string;
  /** Acceptance required */
  acceptanceRequired: boolean;
  /** Manages VPC endpoints */
  managesVpcEndpoints: boolean;
  /** Base endpoint DNS names */
  baseEndpointDnsNames?: string[];
  /** Private DNS name */
  privateDnsName?: string;
  /** VPC endpoint policy supported */
  vpcEndpointPolicySupported: boolean;
  /** Supported IP address types */
  supportedIpAddressTypes?: string[];
}

// =============================================================================
// Flow Logs Types
// =============================================================================

/**
 * Flow Log information
 */
export interface FlowLogInfo {
  /** Flow Log ID */
  flowLogId: string;
  /** Flow Log status */
  flowLogStatus: 'ACTIVE' | 'INACTIVE';
  /** Resource ID */
  resourceId: string;
  /** Traffic type */
  trafficType: FlowLogTrafficType;
  /** Log destination type */
  logDestinationType: FlowLogDestinationType;
  /** Log destination */
  logDestination?: string;
  /** Log group name (for CloudWatch) */
  logGroupName?: string;
  /** Deliver logs permission ARN */
  deliverLogsPermissionArn?: string;
  /** Deliver logs status */
  deliverLogsStatus?: string;
  /** Deliver logs error message */
  deliverLogsErrorMessage?: string;
  /** Log format */
  logFormat?: string;
  /** Max aggregation interval */
  maxAggregationInterval?: number;
  /** Creation time */
  creationTime?: Date;
  /** Tags */
  tags?: Record<string, string>;
  /** Region */
  region: string;
}

/**
 * Options for creating a Flow Log
 */
export interface CreateFlowLogOptions {
  /** Resource ID (VPC, Subnet, or ENI) */
  resourceId: string;
  /** Resource type */
  resourceType: 'VPC' | 'Subnet' | 'NetworkInterface';
  /** Traffic type */
  trafficType: FlowLogTrafficType;
  /** Log destination type */
  logDestinationType: FlowLogDestinationType;
  /** Log destination (S3 bucket ARN or CloudWatch log group ARN) */
  logDestination?: string;
  /** Log group name (for CloudWatch) */
  logGroupName?: string;
  /** IAM role ARN (for CloudWatch) */
  deliverLogsPermissionArn?: string;
  /** Custom log format */
  logFormat?: string;
  /** Max aggregation interval (60 or 600 seconds) */
  maxAggregationInterval?: number;
  /** Name (applied as Name tag) */
  name?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}

/**
 * Options for listing Flow Logs
 */
export interface ListFlowLogsOptions {
  /** Filter by Flow Log IDs */
  flowLogIds?: string[];
  /** Filter by resource ID */
  resourceId?: string;
  /** Filter by traffic type */
  trafficType?: FlowLogTrafficType;
  /** Filter by log destination type */
  logDestinationType?: FlowLogDestinationType;
  /** Filter by tag */
  tag?: { key: string; value: string };
  /** Region */
  region?: string;
}

// =============================================================================
// Operation Result Types
// =============================================================================

/**
 * Generic network operation result
 */
export interface NetworkOperationResult<T = unknown> {
  /** Success flag */
  success: boolean;
  /** Data */
  data?: T;
  /** Message */
  message: string;
  /** Error */
  error?: string;
  /** Warnings */
  warnings?: string[];
}

/**
 * Multi-AZ VPC creation result
 */
export interface CreateMultiAZVPCResult {
  /** VPC info */
  vpc: VPCInfo;
  /** Public subnets */
  publicSubnets: SubnetInfo[];
  /** Private subnets */
  privateSubnets: SubnetInfo[];
  /** Internet Gateway */
  internetGateway: InternetGatewayInfo;
  /** NAT Gateways (one per AZ) */
  natGateways?: NATGatewayInfo[];
  /** Public route table */
  publicRouteTable: RouteTableInfo;
  /** Private route tables (one per AZ) */
  privateRouteTables: RouteTableInfo[];
}

/**
 * Options for creating a Multi-AZ VPC
 */
export interface CreateMultiAZVPCOptions {
  /** VPC name */
  name: string;
  /** CIDR block */
  cidrBlock: string;
  /** Number of availability zones (default: 2) */
  azCount?: number;
  /** Create NAT gateways for private subnets */
  createNatGateways?: boolean;
  /** Single NAT Gateway (cost optimization) vs one per AZ */
  singleNatGateway?: boolean;
  /** Enable DNS hostnames */
  enableDnsHostnames?: boolean;
  /** Enable DNS support */
  enableDnsSupport?: boolean;
  /** Tags to apply to all resources */
  tags?: Record<string, string>;
  /** Region */
  region?: string;
}
