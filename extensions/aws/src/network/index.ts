/**
 * Network Module Exports
 */

export { createNetworkManager, NetworkManager } from './manager.js';

export type {
  // Manager config
  NetworkManagerConfig,
  NetworkOperationResult,

  // VPC
  VPCInfo,
  CreateVPCOptions,
  ListVPCsOptions,

  // Subnet
  SubnetInfo,
  CreateSubnetOptions,
  ListSubnetsOptions,

  // Route Table
  RouteTableInfo,
  RouteEntry,
  RouteTableAssociation,
  CreateRouteTableOptions,
  CreateRouteOptions,
  ListRouteTablesOptions,

  // Internet Gateway
  InternetGatewayInfo,
  CreateInternetGatewayOptions,

  // NAT Gateway
  NATGatewayInfo,
  CreateNATGatewayOptions,
  ListNATGatewaysOptions,

  // VPC Peering
  VPCPeeringInfo,
  CreateVPCPeeringOptions,
  ListVPCPeeringOptions,

  // Transit Gateway
  TransitGatewayInfo,
  TransitGatewayAttachmentInfo,
  CreateTransitGatewayOptions,
  AttachVPCToTransitGatewayOptions,

  // Network ACL
  NetworkACLInfo,
  NetworkACLEntry,
  NetworkACLAssociation,
  CreateNetworkACLOptions,
  CreateNetworkACLEntryOptions,

  // VPC Endpoint
  VPCEndpointInfo,
  VPCEndpointServiceInfo,
  CreateVPCEndpointOptions,
  ListVPCEndpointsOptions,

  // Flow Logs
  FlowLogInfo,
  CreateFlowLogOptions,
  ListFlowLogsOptions,

  // Multi-AZ VPC
  CreateMultiAZVPCOptions,
  CreateMultiAZVPCResult,
} from './types.js';
