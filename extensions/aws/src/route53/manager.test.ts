/**
 * Route53 Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route53Manager, createRoute53Manager } from './manager.js';

// Mock Route 53 Client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-route-53', () => ({
  Route53Client: vi.fn(() => ({ send: mockSend })),
  CreateHostedZoneCommand: vi.fn((input) => ({ input, _type: 'CreateHostedZoneCommand' })),
  DeleteHostedZoneCommand: vi.fn((input) => ({ input, _type: 'DeleteHostedZoneCommand' })),
  GetHostedZoneCommand: vi.fn((input) => ({ input, _type: 'GetHostedZoneCommand' })),
  ListHostedZonesCommand: vi.fn((input) => ({ input, _type: 'ListHostedZonesCommand' })),
  ListHostedZonesByNameCommand: vi.fn((input) => ({ input, _type: 'ListHostedZonesByNameCommand' })),
  UpdateHostedZoneCommentCommand: vi.fn((input) => ({ input, _type: 'UpdateHostedZoneCommentCommand' })),
  CreateVPCAssociationAuthorizationCommand: vi.fn((input) => ({ input, _type: 'CreateVPCAssociationAuthorizationCommand' })),
  DeleteVPCAssociationAuthorizationCommand: vi.fn((input) => ({ input, _type: 'DeleteVPCAssociationAuthorizationCommand' })),
  AssociateVPCWithHostedZoneCommand: vi.fn((input) => ({ input, _type: 'AssociateVPCWithHostedZoneCommand' })),
  DisassociateVPCFromHostedZoneCommand: vi.fn((input) => ({ input, _type: 'DisassociateVPCFromHostedZoneCommand' })),
  ListVPCAssociationAuthorizationsCommand: vi.fn((input) => ({ input, _type: 'ListVPCAssociationAuthorizationsCommand' })),
  ChangeResourceRecordSetsCommand: vi.fn((input) => ({ input, _type: 'ChangeResourceRecordSetsCommand' })),
  ListResourceRecordSetsCommand: vi.fn((input) => ({ input, _type: 'ListResourceRecordSetsCommand' })),
  GetChangeCommand: vi.fn((input) => ({ input, _type: 'GetChangeCommand' })),
  CreateHealthCheckCommand: vi.fn((input) => ({ input, _type: 'CreateHealthCheckCommand' })),
  DeleteHealthCheckCommand: vi.fn((input) => ({ input, _type: 'DeleteHealthCheckCommand' })),
  GetHealthCheckCommand: vi.fn((input) => ({ input, _type: 'GetHealthCheckCommand' })),
  ListHealthChecksCommand: vi.fn((input) => ({ input, _type: 'ListHealthChecksCommand' })),
  UpdateHealthCheckCommand: vi.fn((input) => ({ input, _type: 'UpdateHealthCheckCommand' })),
  GetHealthCheckStatusCommand: vi.fn((input) => ({ input, _type: 'GetHealthCheckStatusCommand' })),
  CreateTrafficPolicyCommand: vi.fn((input) => ({ input, _type: 'CreateTrafficPolicyCommand' })),
  DeleteTrafficPolicyCommand: vi.fn((input) => ({ input, _type: 'DeleteTrafficPolicyCommand' })),
  GetTrafficPolicyCommand: vi.fn((input) => ({ input, _type: 'GetTrafficPolicyCommand' })),
  ListTrafficPoliciesCommand: vi.fn((input) => ({ input, _type: 'ListTrafficPoliciesCommand' })),
  CreateTrafficPolicyInstanceCommand: vi.fn((input) => ({ input, _type: 'CreateTrafficPolicyInstanceCommand' })),
  DeleteTrafficPolicyInstanceCommand: vi.fn((input) => ({ input, _type: 'DeleteTrafficPolicyInstanceCommand' })),
  ListTrafficPolicyInstancesCommand: vi.fn((input) => ({ input, _type: 'ListTrafficPolicyInstancesCommand' })),
  CreateReusableDelegationSetCommand: vi.fn((input) => ({ input, _type: 'CreateReusableDelegationSetCommand' })),
  DeleteReusableDelegationSetCommand: vi.fn((input) => ({ input, _type: 'DeleteReusableDelegationSetCommand' })),
  GetReusableDelegationSetCommand: vi.fn((input) => ({ input, _type: 'GetReusableDelegationSetCommand' })),
  ListReusableDelegationSetsCommand: vi.fn((input) => ({ input, _type: 'ListReusableDelegationSetsCommand' })),
  CreateQueryLoggingConfigCommand: vi.fn((input) => ({ input, _type: 'CreateQueryLoggingConfigCommand' })),
  DeleteQueryLoggingConfigCommand: vi.fn((input) => ({ input, _type: 'DeleteQueryLoggingConfigCommand' })),
  GetQueryLoggingConfigCommand: vi.fn((input) => ({ input, _type: 'GetQueryLoggingConfigCommand' })),
  ListQueryLoggingConfigsCommand: vi.fn((input) => ({ input, _type: 'ListQueryLoggingConfigsCommand' })),
  EnableHostedZoneDNSSECCommand: vi.fn((input) => ({ input, _type: 'EnableHostedZoneDNSSECCommand' })),
  DisableHostedZoneDNSSECCommand: vi.fn((input) => ({ input, _type: 'DisableHostedZoneDNSSECCommand' })),
  GetDNSSECCommand: vi.fn((input) => ({ input, _type: 'GetDNSSECCommand' })),
  CreateKeySigningKeyCommand: vi.fn((input) => ({ input, _type: 'CreateKeySigningKeyCommand' })),
  DeleteKeySigningKeyCommand: vi.fn((input) => ({ input, _type: 'DeleteKeySigningKeyCommand' })),
  ActivateKeySigningKeyCommand: vi.fn((input) => ({ input, _type: 'ActivateKeySigningKeyCommand' })),
  DeactivateKeySigningKeyCommand: vi.fn((input) => ({ input, _type: 'DeactivateKeySigningKeyCommand' })),
  ChangeTagsForResourceCommand: vi.fn((input) => ({ input, _type: 'ChangeTagsForResourceCommand' })),
  ListTagsForResourceCommand: vi.fn((input) => ({ input, _type: 'ListTagsForResourceCommand' })),
  TestDNSAnswerCommand: vi.fn((input) => ({ input, _type: 'TestDNSAnswerCommand' })),
  GetHostedZoneCountCommand: vi.fn((input) => ({ input, _type: 'GetHostedZoneCountCommand' })),
  GetHealthCheckCountCommand: vi.fn((input) => ({ input, _type: 'GetHealthCheckCountCommand' })),
}));

describe('Route53Manager', () => {
  let manager: Route53Manager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Route 53 is global — always uses us-east-1
    manager = new Route53Manager();
  });

  describe('createRoute53Manager', () => {
    it('should create a Route53Manager instance', () => {
      const instance = createRoute53Manager();
      expect(instance).toBeInstanceOf(Route53Manager);
    });

    it('should create with config', () => {
      const instance = createRoute53Manager({ region: 'us-west-2' });
      expect(instance).toBeInstanceOf(Route53Manager);
    });
  });

  // ===========================================================================
  // Hosted Zone Operations
  // ===========================================================================

  describe('Hosted Zone Operations', () => {
    describe('listHostedZones', () => {
      it('should list hosted zones', async () => {
        mockSend.mockResolvedValueOnce({
          HostedZones: [
            {
              Id: '/hostedzone/Z1',
              Name: 'example.com.',
              CallerReference: 'ref-1',
              Config: { Comment: 'Main zone', PrivateZone: false },
              ResourceRecordSetCount: 10,
            },
            {
              Id: '/hostedzone/Z2',
              Name: 'internal.example.com.',
              CallerReference: 'ref-2',
              Config: { Comment: 'Private zone', PrivateZone: true },
              ResourceRecordSetCount: 5,
            },
          ],
        });

        const result = await manager.listHostedZones();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it('should handle empty list', async () => {
        mockSend.mockResolvedValueOnce({ HostedZones: [] });

        const result = await manager.listHostedZones();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });

    describe('createHostedZone', () => {
      it('should create a public hosted zone', async () => {
        mockSend.mockResolvedValueOnce({
          HostedZone: {
            Id: '/hostedzone/Z3',
            Name: 'new-zone.com.',
            CallerReference: 'ref-3',
            Config: { Comment: 'New zone' },
          },
          DelegationSet: {
            NameServers: ['ns-1.awsdns-01.com', 'ns-2.awsdns-02.net'],
          },
          ChangeInfo: { Id: '/change/C1', Status: 'PENDING' },
        });

        const result = await manager.createHostedZone({
          name: 'new-zone.com',
          comment: 'New zone',
        });
        expect(result.success).toBe(true);
      });

      it('should handle creation error', async () => {
        mockSend.mockRejectedValueOnce(new Error('HostedZoneAlreadyExists'));

        const result = await manager.createHostedZone({ name: 'existing.com' });
        expect(result.success).toBe(false);
      });
    });

    describe('deleteHostedZone', () => {
      it('should delete a hosted zone', async () => {
        mockSend.mockResolvedValueOnce({
          ChangeInfo: { Id: '/change/C2', Status: 'PENDING' },
        });

        const result = await manager.deleteHostedZone('Z1');
        expect(result.success).toBe(true);
      });
    });

    describe('getHostedZone', () => {
      it('should get a hosted zone', async () => {
        mockSend
          .mockResolvedValueOnce({
            HostedZone: {
              Id: '/hostedzone/Z1',
              Name: 'example.com.',
              Config: { PrivateZone: false },
              ResourceRecordSetCount: 10,
            },
            DelegationSet: { NameServers: ['ns-1.awsdns-01.com'] },
          })
          .mockResolvedValueOnce({ ResourceTagSet: { Tags: [] } })
          .mockRejectedValueOnce(new Error('not supported'))
          .mockResolvedValueOnce({ QueryLoggingConfigs: [] });

        const result = await manager.getHostedZone('Z1');
        expect(result.success).toBe(true);
      });
    });

    describe('findHostedZoneByName', () => {
      it('should find a hosted zone by domain name', async () => {
        mockSend.mockResolvedValueOnce({
          HostedZones: [
            { Id: '/hostedzone/Z1', Name: 'example.com.', Config: { PrivateZone: false } },
          ],
        });

        const result = await manager.findHostedZoneByName('example.com');
        expect(result.success).toBe(true);
      });
    });

    describe('updateHostedZoneComment', () => {
      it('should update hosted zone comment', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.updateHostedZoneComment('Z1', 'Updated comment');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Record Operations
  // ===========================================================================

  describe('Record Operations', () => {
    describe('listRecords', () => {
      it('should list records for a hosted zone', async () => {
        mockSend.mockResolvedValueOnce({
          ResourceRecordSets: [
            { Name: 'example.com.', Type: 'A', TTL: 300, ResourceRecords: [{ Value: '1.2.3.4' }] },
            { Name: 'www.example.com.', Type: 'CNAME', TTL: 300, ResourceRecords: [{ Value: 'example.com' }] },
          ],
        });

        const result = await manager.listRecords('Z1');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });

    describe('upsertRecord', () => {
      it('should upsert a DNS record', async () => {
        mockSend.mockResolvedValueOnce({
          ChangeInfo: { Id: '/change/C3', Status: 'PENDING' },
        });

        const result = await manager.upsertRecord({
          hostedZoneId: 'Z1',
          name: 'api.example.com',
          type: 'A',
          ttl: 300,
          values: ['5.6.7.8'],
        });
        expect(result.success).toBe(true);
      });
    });

    describe('createRecord', () => {
      it('should create a DNS record', async () => {
        mockSend.mockResolvedValueOnce({
          ChangeInfo: { Id: '/change/C4', Status: 'PENDING' },
        });

        const result = await manager.createRecord({
          hostedZoneId: 'Z1',
          name: 'new.example.com',
          type: 'CNAME',
          ttl: 3600,
          values: ['target.example.com'],
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteRecord', () => {
      it('should delete a DNS record', async () => {
        mockSend.mockResolvedValueOnce({
          ChangeInfo: { Id: '/change/C5', Status: 'PENDING' },
        });

        const result = await manager.deleteRecord({
          hostedZoneId: 'Z1',
          name: 'old.example.com',
          type: 'A',
          ttl: 300,
          values: ['1.1.1.1'],
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Health Check Operations
  // ===========================================================================

  describe('Health Check Operations', () => {
    describe('listHealthChecks', () => {
      it('should list health checks', async () => {
        mockSend.mockResolvedValueOnce({
          HealthChecks: [
            {
              Id: 'hc-1',
              CallerReference: 'ref-1',
              HealthCheckConfig: { Type: 'HTTP', FullyQualifiedDomainName: 'example.com', Port: 80 },
              HealthCheckVersion: 1,
            },
          ],
        });

        const result = await manager.listHealthChecks();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });

    describe('createHealthCheck', () => {
      it('should create a health check', async () => {
        mockSend.mockResolvedValueOnce({
          HealthCheck: {
            Id: 'hc-2',
            CallerReference: 'ref-2',
            HealthCheckConfig: { Type: 'HTTPS', FullyQualifiedDomainName: 'api.example.com', Port: 443 },
          },
        });

        const result = await manager.createHealthCheck({
          type: 'HTTPS',
          fqdn: 'api.example.com',
          port: 443,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteHealthCheck', () => {
      it('should delete a health check', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteHealthCheck('hc-1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // DNSSEC Operations
  // ===========================================================================

  describe('DNSSEC Operations', () => {
    describe('enableDNSSEC', () => {
      it('should enable DNSSEC', async () => {
        mockSend.mockResolvedValueOnce({
          ChangeInfo: { Id: '/change/C6', Status: 'PENDING' },
        });

        const result = await manager.enableDNSSEC('Z1');
        expect(result.success).toBe(true);
      });
    });

    describe('disableDNSSEC', () => {
      it('should disable DNSSEC', async () => {
        mockSend.mockResolvedValueOnce({
          ChangeInfo: { Id: '/change/C7', Status: 'PENDING' },
        });

        const result = await manager.disableDNSSEC('Z1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Tagging Operations
  // ===========================================================================

  describe('Tagging Operations', () => {
    describe('tagHostedZone', () => {
      it('should tag a hosted zone', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.tagHostedZone('Z1', { env: 'production' });
        expect(result.success).toBe(true);
      });
    });

    describe('tagHealthCheck', () => {
      it('should tag a health check', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.tagHealthCheck('hc-1', { env: 'staging' });
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle AWS errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

      const result = await manager.listHostedZones();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
