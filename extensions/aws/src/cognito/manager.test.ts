/**
 * Cognito Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CognitoManager, createCognitoManager } from './manager.js';

// Mock Cognito Identity Provider Client
const mockUserPoolSend = vi.fn();
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({ send: mockUserPoolSend })),
  CreateUserPoolCommand: vi.fn((input) => ({ input, _type: 'CreateUserPoolCommand' })),
  DeleteUserPoolCommand: vi.fn((input) => ({ input, _type: 'DeleteUserPoolCommand' })),
  DescribeUserPoolCommand: vi.fn((input) => ({ input, _type: 'DescribeUserPoolCommand' })),
  ListUserPoolsCommand: vi.fn((input) => ({ input, _type: 'ListUserPoolsCommand' })),
  UpdateUserPoolCommand: vi.fn((input) => ({ input, _type: 'UpdateUserPoolCommand' })),
  CreateUserPoolClientCommand: vi.fn((input) => ({ input, _type: 'CreateUserPoolClientCommand' })),
  DeleteUserPoolClientCommand: vi.fn((input) => ({ input, _type: 'DeleteUserPoolClientCommand' })),
  DescribeUserPoolClientCommand: vi.fn((input) => ({ input, _type: 'DescribeUserPoolClientCommand' })),
  ListUserPoolClientsCommand: vi.fn((input) => ({ input, _type: 'ListUserPoolClientsCommand' })),
  UpdateUserPoolClientCommand: vi.fn((input) => ({ input, _type: 'UpdateUserPoolClientCommand' })),
  CreateGroupCommand: vi.fn((input) => ({ input, _type: 'CreateGroupCommand' })),
  DeleteGroupCommand: vi.fn((input) => ({ input, _type: 'DeleteGroupCommand' })),
  GetGroupCommand: vi.fn((input) => ({ input, _type: 'GetGroupCommand' })),
  ListGroupsCommand: vi.fn((input) => ({ input, _type: 'ListGroupsCommand' })),
  UpdateGroupCommand: vi.fn((input) => ({ input, _type: 'UpdateGroupCommand' })),
  AdminCreateUserCommand: vi.fn((input) => ({ input, _type: 'AdminCreateUserCommand' })),
  AdminDeleteUserCommand: vi.fn((input) => ({ input, _type: 'AdminDeleteUserCommand' })),
  AdminGetUserCommand: vi.fn((input) => ({ input, _type: 'AdminGetUserCommand' })),
  AdminListGroupsForUserCommand: vi.fn((input) => ({ input, _type: 'AdminListGroupsForUserCommand' })),
  AdminUpdateUserAttributesCommand: vi.fn((input) => ({ input, _type: 'AdminUpdateUserAttributesCommand' })),
  AdminDisableUserCommand: vi.fn((input) => ({ input, _type: 'AdminDisableUserCommand' })),
  AdminEnableUserCommand: vi.fn((input) => ({ input, _type: 'AdminEnableUserCommand' })),
  AdminResetUserPasswordCommand: vi.fn((input) => ({ input, _type: 'AdminResetUserPasswordCommand' })),
  AdminSetUserPasswordCommand: vi.fn((input) => ({ input, _type: 'AdminSetUserPasswordCommand' })),
  AdminAddUserToGroupCommand: vi.fn((input) => ({ input, _type: 'AdminAddUserToGroupCommand' })),
  AdminRemoveUserFromGroupCommand: vi.fn((input) => ({ input, _type: 'AdminRemoveUserFromGroupCommand' })),
  ListUsersCommand: vi.fn((input) => ({ input, _type: 'ListUsersCommand' })),
  ListUsersInGroupCommand: vi.fn((input) => ({ input, _type: 'ListUsersInGroupCommand' })),
  CreateIdentityProviderCommand: vi.fn((input) => ({ input, _type: 'CreateIdentityProviderCommand' })),
  DeleteIdentityProviderCommand: vi.fn((input) => ({ input, _type: 'DeleteIdentityProviderCommand' })),
  DescribeIdentityProviderCommand: vi.fn((input) => ({ input, _type: 'DescribeIdentityProviderCommand' })),
  ListIdentityProvidersCommand: vi.fn((input) => ({ input, _type: 'ListIdentityProvidersCommand' })),
  UpdateIdentityProviderCommand: vi.fn((input) => ({ input, _type: 'UpdateIdentityProviderCommand' })),
  CreateUserPoolDomainCommand: vi.fn((input) => ({ input, _type: 'CreateUserPoolDomainCommand' })),
  DeleteUserPoolDomainCommand: vi.fn((input) => ({ input, _type: 'DeleteUserPoolDomainCommand' })),
  DescribeUserPoolDomainCommand: vi.fn((input) => ({ input, _type: 'DescribeUserPoolDomainCommand' })),
  UpdateUserPoolDomainCommand: vi.fn((input) => ({ input, _type: 'UpdateUserPoolDomainCommand' })),
  SetUserPoolMfaConfigCommand: vi.fn((input) => ({ input, _type: 'SetUserPoolMfaConfigCommand' })),
  GetUserPoolMfaConfigCommand: vi.fn((input) => ({ input, _type: 'GetUserPoolMfaConfigCommand' })),
  CreateResourceServerCommand: vi.fn((input) => ({ input, _type: 'CreateResourceServerCommand' })),
  DeleteResourceServerCommand: vi.fn((input) => ({ input, _type: 'DeleteResourceServerCommand' })),
  DescribeResourceServerCommand: vi.fn((input) => ({ input, _type: 'DescribeResourceServerCommand' })),
  ListResourceServersCommand: vi.fn((input) => ({ input, _type: 'ListResourceServersCommand' })),
  AdminUserGlobalSignOutCommand: vi.fn((input) => ({ input, _type: 'AdminUserGlobalSignOutCommand' })),
}));

// Mock Cognito Identity Client
const mockIdentitySend = vi.fn();
vi.mock('@aws-sdk/client-cognito-identity', () => ({
  CognitoIdentityClient: vi.fn(() => ({ send: mockIdentitySend })),
  CreateIdentityPoolCommand: vi.fn((input) => ({ input, _type: 'CreateIdentityPoolCommand' })),
  DeleteIdentityPoolCommand: vi.fn((input) => ({ input, _type: 'DeleteIdentityPoolCommand' })),
  DescribeIdentityPoolCommand: vi.fn((input) => ({ input, _type: 'DescribeIdentityPoolCommand' })),
  ListIdentityPoolsCommand: vi.fn((input) => ({ input, _type: 'ListIdentityPoolsCommand' })),
  SetIdentityPoolRolesCommand: vi.fn((input) => ({ input, _type: 'SetIdentityPoolRolesCommand' })),
}));

describe('CognitoManager', () => {
  let manager: CognitoManager;

  beforeEach(() => {
    mockUserPoolSend.mockReset();
    mockIdentitySend.mockReset();
    manager = new CognitoManager({ region: 'us-east-1' });
  });

  describe('createCognitoManager', () => {
    it('should create a CognitoManager instance', () => {
      const instance = createCognitoManager({ region: 'us-west-2' });
      expect(instance).toBeInstanceOf(CognitoManager);
    });

    it('should create with default config', () => {
      const instance = createCognitoManager();
      expect(instance).toBeInstanceOf(CognitoManager);
    });
  });

  // ===========================================================================
  // User Pool Operations
  // ===========================================================================

  describe('User Pool Operations', () => {
    describe('listUserPools', () => {
      it('should list user pools', async () => {
        mockUserPoolSend
          .mockResolvedValueOnce({
            UserPools: [
              { Id: 'pool-1', Name: 'MyApp-Users', CreationDate: new Date(), LastModifiedDate: new Date(), Status: 'Enabled' },
              { Id: 'pool-2', Name: 'Admin-Pool', CreationDate: new Date(), LastModifiedDate: new Date(), Status: 'Enabled' },
            ],
          })
          .mockResolvedValueOnce({ UserPool: { Id: 'pool-1', Name: 'MyApp-Users' } })
          .mockResolvedValueOnce({ UserPool: { Id: 'pool-2', Name: 'Admin-Pool' } });

        const result = await manager.listUserPools();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it('should handle empty list', async () => {
        mockUserPoolSend.mockResolvedValueOnce({ UserPools: [] });

        const result = await manager.listUserPools();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });

    describe('createUserPool', () => {
      it('should create a user pool', async () => {
        mockUserPoolSend.mockResolvedValueOnce({
          UserPool: {
            Id: 'pool-3',
            Name: 'New-Pool',
            Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-3',
            CreationDate: new Date(),
            Status: 'Enabled',
          },
        });

        const result = await manager.createUserPool({
          poolName: 'New-Pool',
          passwordPolicy: {
            minimumLength: 12,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSymbols: true,
          },
        });
        expect(result.success).toBe(true);
      });

      it('should handle creation error', async () => {
        mockUserPoolSend.mockRejectedValueOnce(new Error('LimitExceededException'));

        const result = await manager.createUserPool({ poolName: 'Another-Pool' });
        expect(result.success).toBe(false);
      });
    });

    describe('deleteUserPool', () => {
      it('should delete a user pool', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.deleteUserPool('pool-1');
        expect(result.success).toBe(true);
      });
    });

    describe('getUserPool', () => {
      it('should get a user pool', async () => {
        mockUserPoolSend.mockImplementation((cmd: { _type?: string }) => {
          switch (cmd._type) {
            case 'DescribeUserPoolCommand':
              return Promise.resolve({
                UserPool: {
                  Id: 'pool-1',
                  Name: 'MyApp-Users',
                  Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-1',
                  CreationDate: new Date(),
                  Status: 'Enabled',
                  EstimatedNumberOfUsers: 1500,
                  MfaConfiguration: 'OPTIONAL',
                },
              });
            case 'ListUserPoolClientsCommand':
              return Promise.resolve({ UserPoolClients: [] });
            case 'ListGroupsCommand':
              return Promise.resolve({ Groups: [] });
            case 'ListIdentityProvidersCommand':
              return Promise.resolve({ Providers: [] });
            case 'ListTagsForResourceCommand':
              return Promise.resolve({ Tags: {} });
            default:
              return Promise.resolve({});
          }
        });

        const result = await manager.getUserPool('pool-1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // App Client Operations
  // ===========================================================================

  describe('App Client Operations', () => {
    describe('listAppClients', () => {
      it('should list app clients', async () => {
        mockUserPoolSend
          .mockResolvedValueOnce({
            UserPoolClients: [
              { ClientId: 'client-1', ClientName: 'WebApp', UserPoolId: 'pool-1' },
              { ClientId: 'client-2', ClientName: 'MobileApp', UserPoolId: 'pool-1' },
            ],
          })
          .mockResolvedValueOnce({ UserPoolClient: { ClientId: 'client-1', ClientName: 'WebApp', UserPoolId: 'pool-1' } })
          .mockResolvedValueOnce({ UserPoolClient: { ClientId: 'client-2', ClientName: 'MobileApp', UserPoolId: 'pool-1' } });

        const result = await manager.listAppClients('pool-1');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });

    describe('createAppClient', () => {
      it('should create an app client', async () => {
        mockUserPoolSend.mockResolvedValueOnce({
          UserPoolClient: {
            ClientId: 'client-3',
            ClientName: 'NewApp',
            UserPoolId: 'pool-1',
            CreationDate: new Date(),
          },
        });

        const result = await manager.createAppClient({
          userPoolId: 'pool-1',
          clientName: 'NewApp',
          generateSecret: false,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteAppClient', () => {
      it('should delete an app client', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.deleteAppClient('pool-1', 'client-1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // User Operations
  // ===========================================================================

  describe('User Operations', () => {
    describe('listUsers', () => {
      it('should list users in a pool', async () => {
        mockUserPoolSend.mockResolvedValueOnce({
          Users: [
            {
              Username: 'user-1',
              Attributes: [{ Name: 'email', Value: 'user1@example.com' }],
              UserCreateDate: new Date(),
              UserStatus: 'CONFIRMED',
              Enabled: true,
            },
            {
              Username: 'user-2',
              Attributes: [{ Name: 'email', Value: 'user2@example.com' }],
              UserCreateDate: new Date(),
              UserStatus: 'CONFIRMED',
              Enabled: true,
            },
          ],
        });

        const result = await manager.listUsers('pool-1');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });

    describe('createUser', () => {
      it('should create a user', async () => {
        mockUserPoolSend.mockResolvedValueOnce({
          User: {
            Username: 'new-user',
            Attributes: [{ Name: 'email', Value: 'new@example.com' }],
            UserCreateDate: new Date(),
            UserStatus: 'FORCE_CHANGE_PASSWORD',
            Enabled: true,
          },
        });

        const result = await manager.createUser({
          userPoolId: 'pool-1',
          username: 'new-user',
          userAttributes: [{ name: 'email', value: 'new@example.com' }],
          temporaryPassword: 'TempPass123!',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteUser', () => {
      it('should delete a user', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.deleteUser('pool-1', 'user-1');
        expect(result.success).toBe(true);
      });
    });

    describe('enableUser', () => {
      it('should enable a user', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.enableUser('pool-1', 'user-1');
        expect(result.success).toBe(true);
      });
    });

    describe('disableUser', () => {
      it('should disable a user', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.disableUser('pool-1', 'user-1');
        expect(result.success).toBe(true);
      });
    });

    describe('resetUserPassword', () => {
      it('should reset a user password', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.resetUserPassword('pool-1', 'user-1');
        expect(result.success).toBe(true);
      });
    });

    describe('signOutUser', () => {
      it('should sign out a user globally', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.signOutUser('pool-1', 'user-1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Group Operations
  // ===========================================================================

  describe('Group Operations', () => {
    describe('listGroups', () => {
      it('should list groups', async () => {
        mockUserPoolSend.mockResolvedValueOnce({
          Groups: [
            { GroupName: 'Admins', UserPoolId: 'pool-1', Description: 'Admin group', Precedence: 1 },
            { GroupName: 'Users', UserPoolId: 'pool-1', Description: 'Regular users', Precedence: 10 },
          ],
        });

        const result = await manager.listGroups('pool-1');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });

    describe('createGroup', () => {
      it('should create a group', async () => {
        mockUserPoolSend.mockResolvedValueOnce({
          Group: { GroupName: 'NewGroup', UserPoolId: 'pool-1' },
        });

        const result = await manager.createGroup({
          userPoolId: 'pool-1',
          groupName: 'NewGroup',
          description: 'A new group',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteGroup', () => {
      it('should delete a group', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.deleteGroup('pool-1', 'OldGroup');
        expect(result.success).toBe(true);
      });
    });

    describe('addUserToGroup', () => {
      it('should add a user to a group', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.addUserToGroup('pool-1', 'user-1', 'Admins');
        expect(result.success).toBe(true);
      });
    });

    describe('removeUserFromGroup', () => {
      it('should remove a user from a group', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.removeUserFromGroup('pool-1', 'user-1', 'Admins');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Identity Provider Operations
  // ===========================================================================

  describe('Identity Provider Operations', () => {
    describe('listIdentityProviders', () => {
      it('should list identity providers', async () => {
        mockUserPoolSend
          .mockResolvedValueOnce({
            Providers: [
              { ProviderName: 'Google', ProviderType: 'Google', CreationDate: new Date() },
              { ProviderName: 'Facebook', ProviderType: 'Facebook', CreationDate: new Date() },
            ],
          })
          .mockResolvedValueOnce({ IdentityProvider: { ProviderName: 'Google', ProviderType: 'Google' } })
          .mockResolvedValueOnce({ IdentityProvider: { ProviderName: 'Facebook', ProviderType: 'Facebook' } });

        const result = await manager.listIdentityProviders('pool-1');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });

    describe('deleteIdentityProvider', () => {
      it('should delete an identity provider', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.deleteIdentityProvider('pool-1', 'Google');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Domain Operations
  // ===========================================================================

  describe('Domain Operations', () => {
    describe('createDomain', () => {
      it('should create a domain', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.createDomain('pool-1', 'myapp');
        expect(result.success).toBe(true);
      });
    });

    describe('deleteDomain', () => {
      it('should delete a domain', async () => {
        mockUserPoolSend.mockResolvedValueOnce({});

        const result = await manager.deleteDomain('pool-1', 'myapp');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Identity Pool Operations
  // ===========================================================================

  describe('Identity Pool Operations', () => {
    describe('listIdentityPools', () => {
      it('should list identity pools', async () => {
        mockIdentitySend.mockResolvedValueOnce({
          IdentityPools: [
            { IdentityPoolId: 'id-pool-1', IdentityPoolName: 'MyApp Identity' },
          ],
        });

        const result = await manager.listIdentityPools();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });

    describe('createIdentityPool', () => {
      it('should create an identity pool', async () => {
        mockIdentitySend.mockResolvedValueOnce({
          IdentityPoolId: 'id-pool-2',
          IdentityPoolName: 'New Identity Pool',
          AllowUnauthenticatedIdentities: false,
        });

        const result = await manager.createIdentityPool({
          identityPoolName: 'New Identity Pool',
          allowUnauthenticatedIdentities: false,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteIdentityPool', () => {
      it('should delete an identity pool', async () => {
        mockIdentitySend.mockResolvedValueOnce({});

        const result = await manager.deleteIdentityPool('id-pool-1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle user pool errors gracefully', async () => {
      mockUserPoolSend.mockRejectedValueOnce(new Error('ResourceNotFoundException'));

      const result = await manager.listUserPools();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle identity pool errors gracefully', async () => {
      mockIdentitySend.mockRejectedValueOnce(new Error('NotAuthorizedException'));

      const result = await manager.listIdentityPools();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
