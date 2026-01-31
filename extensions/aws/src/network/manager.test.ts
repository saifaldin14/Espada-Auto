/**
 * NetworkManager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNetworkManager, NetworkManager } from './manager.js';

// Global mock send function
const mockSend = vi.fn();

// Mock AWS SDK
vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: vi.fn(() => ({ send: mockSend })),
  CreateVpcCommand: vi.fn(),
  DeleteVpcCommand: vi.fn(),
  DescribeVpcsCommand: vi.fn(),
  ModifyVpcAttributeCommand: vi.fn(),
  CreateSubnetCommand: vi.fn(),
  DeleteSubnetCommand: vi.fn(),
  DescribeSubnetsCommand: vi.fn(),
  ModifySubnetAttributeCommand: vi.fn(),
  CreateRouteTableCommand: vi.fn(),
  DeleteRouteTableCommand: vi.fn(),
  DescribeRouteTablesCommand: vi.fn(),
  CreateRouteCommand: vi.fn(),
  DeleteRouteCommand: vi.fn(),
  AssociateRouteTableCommand: vi.fn(),
  DisassociateRouteTableCommand: vi.fn(),
  CreateInternetGatewayCommand: vi.fn(),
  DeleteInternetGatewayCommand: vi.fn(),
  DescribeInternetGatewaysCommand: vi.fn(),
  AttachInternetGatewayCommand: vi.fn(),
  DetachInternetGatewayCommand: vi.fn(),
  CreateNatGatewayCommand: vi.fn(),
  DeleteNatGatewayCommand: vi.fn(),
  DescribeNatGatewaysCommand: vi.fn(),
  AllocateAddressCommand: vi.fn(),
  ReleaseAddressCommand: vi.fn(),
  DescribeAddressesCommand: vi.fn(),
  CreateVpcPeeringConnectionCommand: vi.fn(),
  DeleteVpcPeeringConnectionCommand: vi.fn(),
  DescribeVpcPeeringConnectionsCommand: vi.fn(),
  AcceptVpcPeeringConnectionCommand: vi.fn(),
  CreateTransitGatewayCommand: vi.fn(),
  DeleteTransitGatewayCommand: vi.fn(),
  DescribeTransitGatewaysCommand: vi.fn(),
  CreateTransitGatewayVpcAttachmentCommand: vi.fn(),
  DeleteTransitGatewayVpcAttachmentCommand: vi.fn(),
  DescribeTransitGatewayVpcAttachmentsCommand: vi.fn(),
  CreateNetworkAclCommand: vi.fn(),
  DeleteNetworkAclCommand: vi.fn(),
  DescribeNetworkAclsCommand: vi.fn(),
  CreateNetworkAclEntryCommand: vi.fn(),
  DeleteNetworkAclEntryCommand: vi.fn(),
  ReplaceNetworkAclAssociationCommand: vi.fn(),
  CreateVpcEndpointCommand: vi.fn(),
  DeleteVpcEndpointsCommand: vi.fn(),
  DescribeVpcEndpointsCommand: vi.fn(),
  DescribeVpcEndpointServicesCommand: vi.fn(),
  ModifyVpcEndpointCommand: vi.fn(),
  CreateFlowLogsCommand: vi.fn(),
  DeleteFlowLogsCommand: vi.fn(),
  DescribeFlowLogsCommand: vi.fn(),
  CreateTagsCommand: vi.fn(),
  DescribeAvailabilityZonesCommand: vi.fn(),
}));

describe('NetworkManager', () => {
  let manager: NetworkManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    manager = createNetworkManager({ defaultRegion: 'us-east-1' });
  });

  describe('createNetworkManager', () => {
    it('should create a NetworkManager instance', () => {
      const mgr = createNetworkManager();
      expect(mgr).toBeInstanceOf(NetworkManager);
    });

    it('should accept configuration options', () => {
      const mgr = createNetworkManager({
        defaultRegion: 'eu-west-1',
        defaultTags: { Environment: 'test' },
      });
      expect(mgr).toBeInstanceOf(NetworkManager);
    });
  });

  describe('VPC Operations', () => {
    describe('listVPCs', () => {
      it('should list VPCs successfully', async () => {
        mockSend.mockResolvedValueOnce({
          Vpcs: [
            {
              VpcId: 'vpc-123',
              CidrBlock: '10.0.0.0/16',
              State: 'available',
              IsDefault: false,
              InstanceTenancy: 'default',
              OwnerId: '123456789012',
              Tags: [{ Key: 'Name', Value: 'test-vpc' }],
            },
          ],
        });

        const result = await manager.listVPCs();

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].vpcId).toBe('vpc-123');
        expect(result.data![0].cidrBlock).toBe('10.0.0.0/16');
      });

      it('should filter VPCs by CIDR block', async () => {
        mockSend.mockResolvedValueOnce({ Vpcs: [] });

        await manager.listVPCs({ cidrBlock: '10.0.0.0/16' });

        expect(mockSend).toHaveBeenCalled();
      });

      it('should handle API errors', async () => {
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        const result = await manager.listVPCs();

        expect(result.success).toBe(false);
        expect(result.error).toContain('Access Denied');
      });
    });

    describe('createVPC', () => {
      it('should create a VPC successfully', async () => {
        mockSend.mockResolvedValueOnce({
          Vpc: {
            VpcId: 'vpc-new',
            CidrBlock: '10.0.0.0/16',
            State: 'pending',
            InstanceTenancy: 'default',
            OwnerId: '123456789012',
            Tags: [{ Key: 'Name', Value: 'new-vpc' }],
          },
        });

        const result = await manager.createVPC({
          cidrBlock: '10.0.0.0/16',
          name: 'new-vpc',
        });

        expect(result.success).toBe(true);
        expect(result.data!.vpcId).toBe('vpc-new');
      });

      it('should enable DNS hostnames when requested', async () => {
        mockSend
          .mockResolvedValueOnce({
            Vpc: {
              VpcId: 'vpc-dns',
              CidrBlock: '10.0.0.0/16',
              State: 'available',
              InstanceTenancy: 'default',
              OwnerId: '123456789012',
            },
          })
          .mockResolvedValueOnce({}) // ModifyVpcAttribute for DNS hostnames
          .mockResolvedValueOnce({}); // ModifyVpcAttribute for DNS support

        const result = await manager.createVPC({
          cidrBlock: '10.0.0.0/16',
          enableDnsHostnames: true,
          enableDnsSupport: true,
        });

        expect(result.success).toBe(true);
        expect(result.data!.enableDnsHostnames).toBe(true);
      });
    });

    describe('deleteVPC', () => {
      it('should delete a VPC successfully', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteVPC('vpc-123');

        expect(result.success).toBe(true);
        expect(result.message).toContain('vpc-123');
      });
    });
  });

  describe('Subnet Operations', () => {
    describe('listSubnets', () => {
      it('should list subnets successfully', async () => {
        mockSend.mockResolvedValueOnce({
          Subnets: [
            {
              SubnetId: 'subnet-123',
              VpcId: 'vpc-123',
              CidrBlock: '10.0.1.0/24',
              AvailabilityZone: 'us-east-1a',
              AvailabilityZoneId: 'use1-az1',
              State: 'available',
              AvailableIpAddressCount: 251,
              MapPublicIpOnLaunch: true,
              DefaultForAz: false,
              OwnerId: '123456789012',
              SubnetArn: 'arn:aws:ec2:us-east-1:123456789012:subnet/subnet-123',
            },
          ],
        });

        const result = await manager.listSubnets({ vpcId: 'vpc-123' });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].subnetId).toBe('subnet-123');
      });

      it('should filter by availability zone', async () => {
        mockSend.mockResolvedValueOnce({ Subnets: [] });

        await manager.listSubnets({ availabilityZone: 'us-east-1a' });

        expect(mockSend).toHaveBeenCalled();
      });
    });

    describe('createSubnet', () => {
      it('should create a subnet successfully', async () => {
        mockSend.mockResolvedValueOnce({
          Subnet: {
            SubnetId: 'subnet-new',
            VpcId: 'vpc-123',
            CidrBlock: '10.0.2.0/24',
            AvailabilityZone: 'us-east-1b',
            AvailabilityZoneId: 'use1-az2',
            State: 'pending',
            AvailableIpAddressCount: 251,
            OwnerId: '123456789012',
            SubnetArn: 'arn:aws:ec2:us-east-1:123456789012:subnet/subnet-new',
          },
        });

        const result = await manager.createSubnet({
          vpcId: 'vpc-123',
          cidrBlock: '10.0.2.0/24',
          availabilityZone: 'us-east-1b',
          name: 'new-subnet',
        });

        expect(result.success).toBe(true);
        expect(result.data!.subnetId).toBe('subnet-new');
      });

      it('should enable public IP mapping when requested', async () => {
        mockSend
          .mockResolvedValueOnce({
            Subnet: {
              SubnetId: 'subnet-public',
              VpcId: 'vpc-123',
              CidrBlock: '10.0.0.0/24',
              AvailabilityZone: 'us-east-1a',
              AvailabilityZoneId: 'use1-az1',
              State: 'available',
              OwnerId: '123456789012',
              SubnetArn: 'arn:aws:ec2:us-east-1:123456789012:subnet/subnet-public',
            },
          })
          .mockResolvedValueOnce({}); // ModifySubnetAttribute

        const result = await manager.createSubnet({
          vpcId: 'vpc-123',
          cidrBlock: '10.0.0.0/24',
          availabilityZone: 'us-east-1a',
          mapPublicIpOnLaunch: true,
        });

        expect(result.success).toBe(true);
        expect(result.data!.mapPublicIpOnLaunch).toBe(true);
      });
    });

    describe('deleteSubnet', () => {
      it('should delete a subnet successfully', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteSubnet('subnet-123');

        expect(result.success).toBe(true);
      });
    });
  });

  describe('Route Table Operations', () => {
    describe('listRouteTables', () => {
      it('should list route tables successfully', async () => {
        mockSend.mockResolvedValueOnce({
          RouteTables: [
            {
              RouteTableId: 'rtb-123',
              VpcId: 'vpc-123',
              Routes: [
                {
                  DestinationCidrBlock: '10.0.0.0/16',
                  GatewayId: 'local',
                  State: 'active',
                  Origin: 'CreateRouteTable',
                },
              ],
              Associations: [],
              OwnerId: '123456789012',
            },
          ],
        });

        const result = await manager.listRouteTables({ vpcId: 'vpc-123' });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].routes).toHaveLength(1);
      });
    });

    describe('createRouteTable', () => {
      it('should create a route table successfully', async () => {
        mockSend.mockResolvedValueOnce({
          RouteTable: {
            RouteTableId: 'rtb-new',
            VpcId: 'vpc-123',
            Routes: [],
            OwnerId: '123456789012',
          },
        });

        const result = await manager.createRouteTable({
          vpcId: 'vpc-123',
          name: 'new-rt',
        });

        expect(result.success).toBe(true);
        expect(result.data!.routeTableId).toBe('rtb-new');
      });
    });

    describe('createRoute', () => {
      it('should create a route successfully', async () => {
        mockSend.mockResolvedValueOnce({ Return: true });

        const result = await manager.createRoute({
          routeTableId: 'rtb-123',
          destinationCidrBlock: '0.0.0.0/0',
          gatewayId: 'igw-123',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('associateRouteTable', () => {
      it('should associate route table with subnet', async () => {
        mockSend.mockResolvedValueOnce({
          AssociationId: 'rtbassoc-123',
        });

        const result = await manager.associateRouteTable('rtb-123', 'subnet-123');

        expect(result.success).toBe(true);
        expect(result.data!.associationId).toBe('rtbassoc-123');
      });
    });
  });

  describe('Internet Gateway Operations', () => {
    describe('listInternetGateways', () => {
      it('should list Internet Gateways successfully', async () => {
        mockSend.mockResolvedValueOnce({
          InternetGateways: [
            {
              InternetGatewayId: 'igw-123',
              Attachments: [{ VpcId: 'vpc-123', State: 'attached' }],
              OwnerId: '123456789012',
            },
          ],
        });

        const result = await manager.listInternetGateways('vpc-123');

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].attachments[0].vpcId).toBe('vpc-123');
      });
    });

    describe('createInternetGateway', () => {
      it('should create and attach Internet Gateway', async () => {
        mockSend
          .mockResolvedValueOnce({
            InternetGateway: {
              InternetGatewayId: 'igw-new',
              OwnerId: '123456789012',
            },
          })
          .mockResolvedValueOnce({}); // AttachInternetGateway

        const result = await manager.createInternetGateway({
          vpcId: 'vpc-123',
          name: 'new-igw',
        });

        expect(result.success).toBe(true);
        expect(result.data!.internetGatewayId).toBe('igw-new');
        expect(result.data!.attachments).toHaveLength(1);
      });
    });

    describe('deleteInternetGateway', () => {
      it('should detach and delete Internet Gateway', async () => {
        mockSend
          .mockResolvedValueOnce({}) // DetachInternetGateway
          .mockResolvedValueOnce({}); // DeleteInternetGateway

        const result = await manager.deleteInternetGateway('igw-123', 'vpc-123');

        expect(result.success).toBe(true);
      });
    });
  });

  describe('NAT Gateway Operations', () => {
    describe('listNATGateways', () => {
      it('should list NAT Gateways successfully', async () => {
        mockSend.mockResolvedValueOnce({
          NatGateways: [
            {
              NatGatewayId: 'nat-123',
              VpcId: 'vpc-123',
              SubnetId: 'subnet-123',
              State: 'available',
              ConnectivityType: 'public',
              NatGatewayAddresses: [
                {
                  AllocationId: 'eipalloc-123',
                  PublicIp: '54.1.2.3',
                  PrivateIp: '10.0.1.5',
                },
              ],
            },
          ],
        });

        const result = await manager.listNATGateways({ vpcId: 'vpc-123' });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].publicIp).toBe('54.1.2.3');
      });
    });

    describe('createNATGateway', () => {
      it('should create NAT Gateway with new EIP', async () => {
        mockSend
          .mockResolvedValueOnce({ AllocationId: 'eipalloc-new' }) // AllocateAddress
          .mockResolvedValueOnce({
            NatGateway: {
              NatGatewayId: 'nat-new',
              VpcId: 'vpc-123',
              SubnetId: 'subnet-123',
              State: 'pending',
              ConnectivityType: 'public',
            },
          });

        const result = await manager.createNATGateway({
          subnetId: 'subnet-123',
          name: 'new-nat',
        });

        expect(result.success).toBe(true);
        expect(result.data!.natGatewayId).toBe('nat-new');
      });

      it('should create private NAT Gateway without EIP', async () => {
        mockSend.mockResolvedValueOnce({
          NatGateway: {
            NatGatewayId: 'nat-private',
            VpcId: 'vpc-123',
            SubnetId: 'subnet-123',
            State: 'pending',
            ConnectivityType: 'private',
          },
        });

        const result = await manager.createNATGateway({
          subnetId: 'subnet-123',
          connectivityType: 'private',
        });

        expect(result.success).toBe(true);
        expect(result.data!.connectivityType).toBe('private');
      });
    });

    describe('deleteNATGateway', () => {
      it('should delete NAT Gateway', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteNATGateway('nat-123');

        expect(result.success).toBe(true);
      });
    });
  });

  describe('VPC Peering Operations', () => {
    describe('listVPCPeering', () => {
      it('should list VPC Peering connections', async () => {
        mockSend.mockResolvedValueOnce({
          VpcPeeringConnections: [
            {
              VpcPeeringConnectionId: 'pcx-123',
              RequesterVpcInfo: {
                VpcId: 'vpc-123',
                CidrBlock: '10.0.0.0/16',
                OwnerId: '123456789012',
                Region: 'us-east-1',
              },
              AccepterVpcInfo: {
                VpcId: 'vpc-456',
                CidrBlock: '10.1.0.0/16',
                OwnerId: '123456789012',
                Region: 'us-east-1',
              },
              Status: { Code: 'active', Message: 'Active' },
            },
          ],
        });

        const result = await manager.listVPCPeering();

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].status.code).toBe('active');
      });
    });

    describe('createVPCPeering', () => {
      it('should create VPC Peering connection', async () => {
        mockSend.mockResolvedValueOnce({
          VpcPeeringConnection: {
            VpcPeeringConnectionId: 'pcx-new',
            RequesterVpcInfo: { VpcId: 'vpc-123', OwnerId: '123456789012' },
            AccepterVpcInfo: { VpcId: 'vpc-456', OwnerId: '123456789012' },
            Status: { Code: 'pending-acceptance' },
          },
        });

        const result = await manager.createVPCPeering({
          vpcId: 'vpc-123',
          peerVpcId: 'vpc-456',
          name: 'dev-to-prod',
        });

        expect(result.success).toBe(true);
        expect(result.data!.vpcPeeringConnectionId).toBe('pcx-new');
      });
    });

    describe('acceptVPCPeering', () => {
      it('should accept VPC Peering connection', async () => {
        mockSend.mockResolvedValueOnce({
          VpcPeeringConnection: {
            VpcPeeringConnectionId: 'pcx-123',
            RequesterVpcInfo: {
              VpcId: 'vpc-123',
              CidrBlock: '10.0.0.0/16',
              OwnerId: '123456789012',
            },
            AccepterVpcInfo: {
              VpcId: 'vpc-456',
              CidrBlock: '10.1.0.0/16',
              OwnerId: '123456789012',
            },
            Status: { Code: 'active' },
          },
        });

        const result = await manager.acceptVPCPeering('pcx-123');

        expect(result.success).toBe(true);
        expect(result.data!.status.code).toBe('active');
      });
    });
  });

  describe('Transit Gateway Operations', () => {
    describe('listTransitGateways', () => {
      it('should list Transit Gateways', async () => {
        mockSend.mockResolvedValueOnce({
          TransitGateways: [
            {
              TransitGatewayId: 'tgw-123',
              TransitGatewayArn: 'arn:aws:ec2:us-east-1:123456789012:transit-gateway/tgw-123',
              State: 'available',
              OwnerId: '123456789012',
              Description: 'Main transit gateway',
              Options: {
                AutoAcceptSharedAttachments: 'enable',
                DefaultRouteTableAssociation: 'enable',
                DefaultRouteTablePropagation: 'enable',
                DnsSupport: 'enable',
              },
            },
          ],
        });

        const result = await manager.listTransitGateways();

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].options?.autoAcceptSharedAttachments).toBe(true);
      });
    });

    describe('createTransitGateway', () => {
      it('should create Transit Gateway', async () => {
        mockSend.mockResolvedValueOnce({
          TransitGateway: {
            TransitGatewayId: 'tgw-new',
            TransitGatewayArn: 'arn:aws:ec2:us-east-1:123456789012:transit-gateway/tgw-new',
            State: 'pending',
            OwnerId: '123456789012',
            Description: 'New TGW',
          },
        });

        const result = await manager.createTransitGateway({
          description: 'New TGW',
          name: 'main-tgw',
        });

        expect(result.success).toBe(true);
        expect(result.data!.transitGatewayId).toBe('tgw-new');
      });
    });

    describe('attachVPCToTransitGateway', () => {
      it('should attach VPC to Transit Gateway', async () => {
        mockSend.mockResolvedValueOnce({
          TransitGatewayVpcAttachment: {
            TransitGatewayAttachmentId: 'tgw-attach-123',
            TransitGatewayId: 'tgw-123',
            VpcId: 'vpc-123',
            VpcOwnerId: '123456789012',
            State: 'pending',
          },
        });

        const result = await manager.attachVPCToTransitGateway({
          transitGatewayId: 'tgw-123',
          vpcId: 'vpc-123',
          subnetIds: ['subnet-1', 'subnet-2'],
        });

        expect(result.success).toBe(true);
        expect(result.data!.transitGatewayAttachmentId).toBe('tgw-attach-123');
      });
    });
  });

  describe('Network ACL Operations', () => {
    describe('listNetworkACLs', () => {
      it('should list Network ACLs', async () => {
        mockSend.mockResolvedValueOnce({
          NetworkAcls: [
            {
              NetworkAclId: 'acl-123',
              VpcId: 'vpc-123',
              IsDefault: true,
              Entries: [
                {
                  RuleNumber: 100,
                  Protocol: '-1',
                  RuleAction: 'allow',
                  Egress: false,
                  CidrBlock: '0.0.0.0/0',
                },
              ],
              Associations: [],
              OwnerId: '123456789012',
            },
          ],
        });

        const result = await manager.listNetworkACLs('vpc-123');

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].isDefault).toBe(true);
      });
    });

    describe('createNetworkACL', () => {
      it('should create Network ACL', async () => {
        mockSend.mockResolvedValueOnce({
          NetworkAcl: {
            NetworkAclId: 'acl-new',
            VpcId: 'vpc-123',
            IsDefault: false,
            Entries: [
              { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: false },
              { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: true },
            ],
            OwnerId: '123456789012',
          },
        });

        const result = await manager.createNetworkACL({
          vpcId: 'vpc-123',
          name: 'custom-acl',
        });

        expect(result.success).toBe(true);
        expect(result.data!.networkAclId).toBe('acl-new');
      });
    });

    describe('createNetworkACLEntry', () => {
      it('should create Network ACL entry', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.createNetworkACLEntry({
          networkAclId: 'acl-123',
          ruleNumber: 100,
          protocol: '6', // TCP
          ruleAction: 'allow',
          egress: false,
          cidrBlock: '10.0.0.0/8',
          fromPort: 443,
          toPort: 443,
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe('VPC Endpoint Operations', () => {
    describe('listVPCEndpoints', () => {
      it('should list VPC Endpoints', async () => {
        mockSend.mockResolvedValueOnce({
          VpcEndpoints: [
            {
              VpcEndpointId: 'vpce-123',
              VpcId: 'vpc-123',
              ServiceName: 'com.amazonaws.us-east-1.s3',
              VpcEndpointType: 'Gateway',
              State: 'available',
              RouteTableIds: ['rtb-123'],
              PrivateDnsEnabled: false,
              OwnerId: '123456789012',
            },
          ],
        });

        const result = await manager.listVPCEndpoints({ vpcId: 'vpc-123' });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].serviceName).toContain('s3');
      });
    });

    describe('listVPCEndpointServices', () => {
      it('should list available endpoint services', async () => {
        mockSend.mockResolvedValueOnce({
          ServiceDetails: [
            {
              ServiceName: 'com.amazonaws.us-east-1.s3',
              ServiceId: 'vpce-svc-s3',
              ServiceType: [{ ServiceType: 'Gateway' }],
              AvailabilityZones: ['us-east-1a', 'us-east-1b'],
              Owner: 'amazon',
              AcceptanceRequired: false,
              VpcEndpointPolicySupported: true,
            },
          ],
        });

        const result = await manager.listVPCEndpointServices();

        expect(result.success).toBe(true);
        expect(result.data![0].serviceType).toContain('Gateway');
      });
    });

    describe('createVPCEndpoint', () => {
      it('should create Gateway endpoint', async () => {
        mockSend.mockResolvedValueOnce({
          VpcEndpoint: {
            VpcEndpointId: 'vpce-new',
            VpcId: 'vpc-123',
            ServiceName: 'com.amazonaws.us-east-1.s3',
            VpcEndpointType: 'Gateway',
            State: 'available',
            RouteTableIds: ['rtb-123'],
            OwnerId: '123456789012',
          },
        });

        const result = await manager.createVPCEndpoint({
          vpcId: 'vpc-123',
          serviceName: 'com.amazonaws.us-east-1.s3',
          vpcEndpointType: 'Gateway',
          routeTableIds: ['rtb-123'],
        });

        expect(result.success).toBe(true);
        expect(result.data!.vpcEndpointType).toBe('Gateway');
      });

      it('should create Interface endpoint', async () => {
        mockSend.mockResolvedValueOnce({
          VpcEndpoint: {
            VpcEndpointId: 'vpce-interface',
            VpcId: 'vpc-123',
            ServiceName: 'com.amazonaws.us-east-1.secretsmanager',
            VpcEndpointType: 'Interface',
            State: 'pending',
            SubnetIds: ['subnet-123'],
            PrivateDnsEnabled: true,
            OwnerId: '123456789012',
          },
        });

        const result = await manager.createVPCEndpoint({
          vpcId: 'vpc-123',
          serviceName: 'com.amazonaws.us-east-1.secretsmanager',
          vpcEndpointType: 'Interface',
          subnetIds: ['subnet-123'],
          privateDnsEnabled: true,
        });

        expect(result.success).toBe(true);
        expect(result.data!.privateDnsEnabled).toBe(true);
      });
    });

    describe('deleteVPCEndpoints', () => {
      it('should delete VPC Endpoints', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteVPCEndpoints(['vpce-123', 'vpce-456']);

        expect(result.success).toBe(true);
        expect(result.message).toContain('2');
      });
    });
  });

  describe('Flow Log Operations', () => {
    describe('listFlowLogs', () => {
      it('should list Flow Logs', async () => {
        mockSend.mockResolvedValueOnce({
          FlowLogs: [
            {
              FlowLogId: 'fl-123',
              FlowLogStatus: 'ACTIVE',
              ResourceId: 'vpc-123',
              TrafficType: 'ALL',
              LogDestinationType: 'cloud-watch-logs',
              LogGroupName: '/aws/vpc/flow-logs',
            },
          ],
        });

        const result = await manager.listFlowLogs({ resourceId: 'vpc-123' });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data![0].trafficType).toBe('ALL');
      });
    });

    describe('createFlowLog', () => {
      it('should create Flow Log to CloudWatch', async () => {
        mockSend.mockResolvedValueOnce({
          FlowLogIds: ['fl-new'],
        });

        const result = await manager.createFlowLog({
          resourceId: 'vpc-123',
          resourceType: 'VPC',
          trafficType: 'ALL',
          logDestinationType: 'cloud-watch-logs',
          logGroupName: '/aws/vpc/flow-logs',
          deliverLogsPermissionArn: 'arn:aws:iam::123456789012:role/flow-logs-role',
        });

        expect(result.success).toBe(true);
        expect(result.data!.flowLogId).toBe('fl-new');
      });

      it('should create Flow Log to S3', async () => {
        mockSend.mockResolvedValueOnce({
          FlowLogIds: ['fl-s3'],
        });

        const result = await manager.createFlowLog({
          resourceId: 'vpc-123',
          resourceType: 'VPC',
          trafficType: 'REJECT',
          logDestinationType: 's3',
          logDestination: 'arn:aws:s3:::my-flow-logs-bucket/vpc-logs/',
        });

        expect(result.success).toBe(true);
        expect(result.data!.logDestinationType).toBe('s3');
      });

      it('should handle flow log creation failure', async () => {
        mockSend.mockResolvedValueOnce({
          FlowLogIds: [],
          Unsuccessful: [
            {
              Error: { Code: 'InvalidParameter', Message: 'Invalid log group' },
            },
          ],
        });

        const result = await manager.createFlowLog({
          resourceId: 'vpc-123',
          resourceType: 'VPC',
          trafficType: 'ALL',
          logDestinationType: 'cloud-watch-logs',
          logGroupName: '/invalid/group',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid log group');
      });
    });

    describe('deleteFlowLogs', () => {
      it('should delete Flow Logs', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteFlowLogs(['fl-123']);

        expect(result.success).toBe(true);
      });
    });
  });

  describe('Multi-AZ VPC Creation', () => {
    describe('createMultiAZVPC', () => {
      it('should handle VPC creation failure gracefully', async () => {
        // Mock getting AZs success
        mockSend.mockResolvedValueOnce({
          AvailabilityZones: [
            { ZoneName: 'us-east-1a', State: 'available' },
            { ZoneName: 'us-east-1b', State: 'available' },
          ],
        });
        // Mock VPC creation failure
        mockSend.mockResolvedValueOnce({
          Vpc: null,
        });

        const result = await manager.createMultiAZVPC({
          cidrBlock: '10.0.0.0/16',
          name: 'test-vpc',
          azCount: 2,
        });

        // Should fail gracefully when VPC creation fails
        expect(result.success).toBe(false);
      });

      it('should warn when fewer AZs available than requested', async () => {
        // Mock only 1 AZ available when 2 requested
        mockSend.mockResolvedValueOnce({
          AvailabilityZones: [
            { ZoneName: 'us-east-1a', State: 'available' },
          ],
        });
        // Mock VPC creation
        mockSend.mockResolvedValueOnce({
          Vpc: {
            VpcId: 'vpc-test',
            CidrBlock: '10.0.0.0/16',
            State: 'available',
            InstanceTenancy: 'default',
            OwnerId: '123456789012',
          },
        });
        // Mock DNS attribute updates
        mockSend.mockResolvedValueOnce({});
        mockSend.mockResolvedValueOnce({});
        // Mock IGW creation
        mockSend.mockResolvedValueOnce({
          InternetGateway: { InternetGatewayId: 'igw-test', OwnerId: '123456789012' },
        });
        mockSend.mockResolvedValueOnce({});
        // Mock route table
        mockSend.mockResolvedValueOnce({
          RouteTable: { RouteTableId: 'rtb-test', VpcId: 'vpc-test', Routes: [], OwnerId: '123456789012' },
        });
        mockSend.mockResolvedValueOnce({ Return: true });
        // Mock public subnet
        mockSend.mockResolvedValueOnce({
          Subnet: {
            SubnetId: 'subnet-pub',
            VpcId: 'vpc-test',
            CidrBlock: '10.0.0.0/24',
            AvailabilityZone: 'us-east-1a',
            AvailabilityZoneId: 'use1-az1',
            State: 'available',
            OwnerId: '123456789012',
            SubnetArn: 'arn',
          },
        });
        mockSend.mockResolvedValueOnce({});
        mockSend.mockResolvedValueOnce({ AssociationId: 'assoc-1' });
        // Mock private subnet
        mockSend.mockResolvedValueOnce({
          Subnet: {
            SubnetId: 'subnet-priv',
            VpcId: 'vpc-test',
            CidrBlock: '10.0.1.0/24',
            AvailabilityZone: 'us-east-1a',
            AvailabilityZoneId: 'use1-az1',
            State: 'available',
            OwnerId: '123456789012',
            SubnetArn: 'arn',
          },
        });
        // Mock private route table
        mockSend.mockResolvedValueOnce({
          RouteTable: { RouteTableId: 'rtb-priv', VpcId: 'vpc-test', Routes: [], OwnerId: '123456789012' },
        });
        mockSend.mockResolvedValueOnce({ AssociationId: 'assoc-priv' });

        const result = await manager.createMultiAZVPC({
          cidrBlock: '10.0.0.0/16',
          name: 'test-vpc',
          azCount: 2,
          createNatGateways: false,
        });

        expect(result.success).toBe(true);
        expect(result.warnings).toBeDefined();
        expect(result.warnings).toContain('Only 1 AZs available, requested 2');
      });
    });

    describe('getAvailabilityZones', () => {
      it('should return availability zones', async () => {
        mockSend.mockResolvedValueOnce({
          AvailabilityZones: [
            { ZoneName: 'us-east-1a', State: 'available' },
            { ZoneName: 'us-east-1b', State: 'available' },
            { ZoneName: 'us-east-1c', State: 'available' },
          ],
        });

        const result = await manager.getAvailabilityZones();

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(3);
        expect(result.data).toContain('us-east-1a');
      });

      it('should handle API errors', async () => {
        mockSend.mockRejectedValueOnce(new Error('API error'));

        const result = await manager.getAvailabilityZones();

        expect(result.success).toBe(false);
        expect(result.error).toContain('API error');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await manager.listVPCs();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });

    it('should handle non-Error throws', async () => {
      mockSend.mockRejectedValueOnce('string error');

      const result = await manager.listVPCs();

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });
});
