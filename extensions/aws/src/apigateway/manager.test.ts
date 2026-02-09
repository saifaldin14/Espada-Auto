/**
 * API Gateway Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayManager, createAPIGatewayManager } from './manager.js';

// Mock REST API Gateway Client
const mockRestSend = vi.fn();
vi.mock('@aws-sdk/client-api-gateway', () => ({
  APIGatewayClient: vi.fn(() => ({ send: mockRestSend })),
  CreateRestApiCommand: vi.fn((input) => ({ input, _type: 'CreateRestApiCommand' })),
  DeleteRestApiCommand: vi.fn((input) => ({ input, _type: 'DeleteRestApiCommand' })),
  GetRestApiCommand: vi.fn((input) => ({ input, _type: 'GetRestApiCommand' })),
  GetRestApisCommand: vi.fn((input) => ({ input, _type: 'GetRestApisCommand' })),
  UpdateRestApiCommand: vi.fn((input) => ({ input, _type: 'UpdateRestApiCommand' })),
  CreateResourceCommand: vi.fn((input) => ({ input, _type: 'CreateResourceCommand' })),
  DeleteResourceCommand: vi.fn((input) => ({ input, _type: 'DeleteResourceCommand' })),
  GetResourcesCommand: vi.fn((input) => ({ input, _type: 'GetResourcesCommand' })),
  PutMethodCommand: vi.fn((input) => ({ input, _type: 'PutMethodCommand' })),
  DeleteMethodCommand: vi.fn((input) => ({ input, _type: 'DeleteMethodCommand' })),
  PutIntegrationCommand: vi.fn((input) => ({ input, _type: 'PutIntegrationCommand' })),
  PutIntegrationResponseCommand: vi.fn((input) => ({ input, _type: 'PutIntegrationResponseCommand' })),
  PutMethodResponseCommand: vi.fn((input) => ({ input, _type: 'PutMethodResponseCommand' })),
  CreateDeploymentCommand: vi.fn((input) => ({ input, _type: 'CreateDeploymentCommand' })),
  GetDeploymentsCommand: vi.fn((input) => ({ input, _type: 'GetDeploymentsCommand' })),
  DeleteDeploymentCommand: vi.fn((input) => ({ input, _type: 'DeleteDeploymentCommand' })),
  CreateStageCommand: vi.fn((input) => ({ input, _type: 'CreateStageCommand' })),
  UpdateStageCommand: vi.fn((input) => ({ input, _type: 'UpdateStageCommand' })),
  DeleteStageCommand: vi.fn((input) => ({ input, _type: 'DeleteStageCommand' })),
  GetStageCommand: vi.fn((input) => ({ input, _type: 'GetStageCommand' })),
  GetStagesCommand: vi.fn((input) => ({ input, _type: 'GetStagesCommand' })),
  CreateAuthorizerCommand: vi.fn((input) => ({ input, _type: 'CreateAuthorizerCommand' })),
  DeleteAuthorizerCommand: vi.fn((input) => ({ input, _type: 'DeleteAuthorizerCommand' })),
  GetAuthorizersCommand: vi.fn((input) => ({ input, _type: 'GetAuthorizersCommand' })),
  UpdateAuthorizerCommand: vi.fn((input) => ({ input, _type: 'UpdateAuthorizerCommand' })),
  CreateUsagePlanCommand: vi.fn((input) => ({ input, _type: 'CreateUsagePlanCommand' })),
  DeleteUsagePlanCommand: vi.fn((input) => ({ input, _type: 'DeleteUsagePlanCommand' })),
  GetUsagePlansCommand: vi.fn((input) => ({ input, _type: 'GetUsagePlansCommand' })),
  UpdateUsagePlanCommand: vi.fn((input) => ({ input, _type: 'UpdateUsagePlanCommand' })),
  CreateUsagePlanKeyCommand: vi.fn((input) => ({ input, _type: 'CreateUsagePlanKeyCommand' })),
  DeleteUsagePlanKeyCommand: vi.fn((input) => ({ input, _type: 'DeleteUsagePlanKeyCommand' })),
  GetUsagePlanKeysCommand: vi.fn((input) => ({ input, _type: 'GetUsagePlanKeysCommand' })),
  CreateApiKeyCommand: vi.fn((input) => ({ input, _type: 'CreateApiKeyCommand' })),
  DeleteApiKeyCommand: vi.fn((input) => ({ input, _type: 'DeleteApiKeyCommand' })),
  GetApiKeysCommand: vi.fn((input) => ({ input, _type: 'GetApiKeysCommand' })),
  UpdateApiKeyCommand: vi.fn((input) => ({ input, _type: 'UpdateApiKeyCommand' })),
  CreateDomainNameCommand: vi.fn((input) => ({ input, _type: 'CreateDomainNameCommand' })),
  DeleteDomainNameCommand: vi.fn((input) => ({ input, _type: 'DeleteDomainNameCommand' })),
  GetDomainNamesCommand: vi.fn((input) => ({ input, _type: 'GetDomainNamesCommand' })),
  CreateBasePathMappingCommand: vi.fn((input) => ({ input, _type: 'CreateBasePathMappingCommand' })),
  DeleteBasePathMappingCommand: vi.fn((input) => ({ input, _type: 'DeleteBasePathMappingCommand' })),
  GetBasePathMappingsCommand: vi.fn((input) => ({ input, _type: 'GetBasePathMappingsCommand' })),
  ImportRestApiCommand: vi.fn((input) => ({ input, _type: 'ImportRestApiCommand' })),
  GetExportCommand: vi.fn((input) => ({ input, _type: 'GetExportCommand' })),
  FlushStageCacheCommand: vi.fn((input) => ({ input, _type: 'FlushStageCacheCommand' })),
}));

// Mock HTTP API Gateway v2 Client
const mockHttpSend = vi.fn();
vi.mock('@aws-sdk/client-apigatewayv2', () => ({
  ApiGatewayV2Client: vi.fn(() => ({ send: mockHttpSend })),
  CreateApiCommand: vi.fn((input) => ({ input, _type: 'CreateApiCommand' })),
  DeleteApiCommand: vi.fn((input) => ({ input, _type: 'DeleteApiCommand' })),
  GetApiCommand: vi.fn((input) => ({ input, _type: 'GetApiCommand' })),
  GetApisCommand: vi.fn((input) => ({ input, _type: 'GetApisCommand' })),
  UpdateApiCommand: vi.fn((input) => ({ input, _type: 'UpdateApiCommand' })),
  CreateRouteCommand: vi.fn((input) => ({ input, _type: 'CreateRouteCommand' })),
  DeleteRouteCommand: vi.fn((input) => ({ input, _type: 'DeleteRouteCommand' })),
  GetRoutesCommand: vi.fn((input) => ({ input, _type: 'GetRoutesCommand' })),
  CreateIntegrationCommand: vi.fn((input) => ({ input, _type: 'V2CreateIntegrationCommand' })),
  DeleteIntegrationCommand: vi.fn((input) => ({ input, _type: 'V2DeleteIntegrationCommand' })),
  GetIntegrationsCommand: vi.fn((input) => ({ input, _type: 'GetIntegrationsCommand' })),
  CreateStageCommand: vi.fn((input) => ({ input, _type: 'V2CreateStageCommand' })),
  DeleteStageCommand: vi.fn((input) => ({ input, _type: 'V2DeleteStageCommand' })),
  GetStageCommand: vi.fn((input) => ({ input, _type: 'V2GetStageCommand' })),
  GetStagesCommand: vi.fn((input) => ({ input, _type: 'V2GetStagesCommand' })),
  CreateDeploymentCommand: vi.fn((input) => ({ input, _type: 'V2CreateDeploymentCommand' })),
  GetDeploymentsCommand: vi.fn((input) => ({ input, _type: 'V2GetDeploymentsCommand' })),
  CreateAuthorizerCommand: vi.fn((input) => ({ input, _type: 'V2CreateAuthorizerCommand' })),
  DeleteAuthorizerCommand: vi.fn((input) => ({ input, _type: 'V2DeleteAuthorizerCommand' })),
  GetAuthorizersCommand: vi.fn((input) => ({ input, _type: 'V2GetAuthorizersCommand' })),
  CreateDomainNameCommand: vi.fn((input) => ({ input, _type: 'V2CreateDomainNameCommand' })),
  DeleteDomainNameCommand: vi.fn((input) => ({ input, _type: 'V2DeleteDomainNameCommand' })),
  GetDomainNamesCommand: vi.fn((input) => ({ input, _type: 'V2GetDomainNamesCommand' })),
  CreateApiMappingCommand: vi.fn((input) => ({ input, _type: 'CreateApiMappingCommand' })),
  DeleteApiMappingCommand: vi.fn((input) => ({ input, _type: 'DeleteApiMappingCommand' })),
  GetApiMappingsCommand: vi.fn((input) => ({ input, _type: 'GetApiMappingsCommand' })),
  ExportApiCommand: vi.fn((input) => ({ input, _type: 'ExportApiCommand' })),
  ImportApiCommand: vi.fn((input) => ({ input, _type: 'ImportApiCommand' })),
  GetTagsCommand: vi.fn((input) => ({ input, _type: 'GetTagsCommand' })),
  TagResourceCommand: vi.fn((input) => ({ input, _type: 'V2TagResourceCommand' })),
  UntagResourceCommand: vi.fn((input) => ({ input, _type: 'V2UntagResourceCommand' })),
}));

describe('APIGatewayManager', () => {
  let manager: APIGatewayManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new APIGatewayManager({ region: 'us-east-1' });
  });

  describe('createAPIGatewayManager', () => {
    it('should create an APIGatewayManager instance', () => {
      const instance = createAPIGatewayManager({ region: 'us-west-2' });
      expect(instance).toBeInstanceOf(APIGatewayManager);
    });

    it('should create with default config', () => {
      const instance = createAPIGatewayManager();
      expect(instance).toBeInstanceOf(APIGatewayManager);
    });
  });

  // ===========================================================================
  // REST API Operations
  // ===========================================================================

  describe('REST API Operations', () => {
    describe('listRestApis', () => {
      it('should list REST APIs', async () => {
        mockRestSend.mockResolvedValueOnce({
          items: [
            { id: 'api1', name: 'My API', description: 'Test API', createdDate: new Date() },
            { id: 'api2', name: 'Other API', description: 'Another', createdDate: new Date() },
          ],
        });

        const result = await manager.listRestApis();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it('should handle empty list', async () => {
        mockRestSend.mockResolvedValueOnce({ items: [] });

        const result = await manager.listRestApis();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });

    describe('getRestApi', () => {
      it('should get a REST API', async () => {
        mockRestSend.mockResolvedValueOnce({
          id: 'api1',
          name: 'My API',
          description: 'Test API',
          createdDate: new Date(),
          version: '1.0',
          endpointConfiguration: { types: ['REGIONAL'] },
        });

        const result = await manager.getRestApi('api1');
        expect(result.success).toBe(true);
        expect(result.data?.name).toBe('My API');
      });

      it('should handle not found', async () => {
        mockRestSend.mockRejectedValueOnce(new Error('NotFoundException'));

        const result = await manager.getRestApi('nonexistent');
        expect(result.success).toBe(false);
      });
    });

    describe('createRestApi', () => {
      it('should create a REST API', async () => {
        mockRestSend.mockResolvedValueOnce({
          id: 'new-api',
          name: 'New API',
          createdDate: new Date(),
        });

        const result = await manager.createRestApi({
          name: 'New API',
          description: 'A new REST API',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteRestApi', () => {
      it('should delete a REST API', async () => {
        mockRestSend.mockResolvedValueOnce({});

        const result = await manager.deleteRestApi('api1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // HTTP API Operations
  // ===========================================================================

  describe('HTTP API Operations', () => {
    describe('listHttpApis', () => {
      it('should list HTTP APIs', async () => {
        mockHttpSend.mockResolvedValueOnce({
          Items: [
            { ApiId: 'http1', Name: 'HTTP API 1', ProtocolType: 'HTTP', CreatedDate: new Date() },
          ],
        });

        const result = await manager.listHttpApis();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });

    describe('createHttpApi', () => {
      it('should create an HTTP API', async () => {
        mockHttpSend.mockResolvedValueOnce({
          ApiId: 'new-http',
          Name: 'My HTTP API',
          ProtocolType: 'HTTP',
          CreatedDate: new Date(),
          ApiEndpoint: 'https://new-http.execute-api.us-east-1.amazonaws.com',
        });

        const result = await manager.createHttpApi({
          name: 'My HTTP API',
          protocolType: 'HTTP',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteHttpApi', () => {
      it('should delete an HTTP API', async () => {
        mockHttpSend.mockResolvedValueOnce({});

        const result = await manager.deleteHttpApi('http1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Stage Operations
  // ===========================================================================

  describe('Stage Operations', () => {
    describe('listRestStages', () => {
      it('should list REST stages', async () => {
        mockRestSend.mockResolvedValueOnce({
          item: [
            { stageName: 'prod', deploymentId: 'dep1', createdDate: new Date() },
            { stageName: 'dev', deploymentId: 'dep2', createdDate: new Date() },
          ],
        });

        const result = await manager.listRestStages('api1');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });

    describe('deleteRestStage', () => {
      it('should delete a REST stage', async () => {
        mockRestSend.mockResolvedValueOnce({});

        const result = await manager.deleteRestStage('api1', 'dev');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Deployment Operations
  // ===========================================================================

  describe('Deployment Operations', () => {
    describe('createRestDeployment', () => {
      it('should create a REST deployment', async () => {
        mockRestSend.mockResolvedValueOnce({
          id: 'dep1',
          createdDate: new Date(),
          description: 'Test deployment',
        });

        const result = await manager.createRestDeployment('api1', undefined, 'Test deployment');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Authorizer Operations
  // ===========================================================================

  describe('Authorizer Operations', () => {
    describe('listRestAuthorizers', () => {
      it('should list authorizers', async () => {
        mockRestSend.mockResolvedValueOnce({
          items: [
            { id: 'auth1', name: 'Lambda Auth', type: 'TOKEN' },
          ],
        });

        const result = await manager.listRestAuthorizers('api1');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });
  });

  // ===========================================================================
  // Usage Plan & API Key Operations
  // ===========================================================================

  describe('Usage Plan Operations', () => {
    describe('listUsagePlans', () => {
      it('should list usage plans', async () => {
        mockRestSend.mockResolvedValueOnce({
          items: [
            { id: 'plan1', name: 'Basic', throttle: { rateLimit: 100, burstLimit: 50 } },
          ],
        });

        const result = await manager.listUsagePlans();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });

    describe('listApiKeys', () => {
      it('should list API keys', async () => {
        mockRestSend.mockResolvedValueOnce({
          items: [
            { id: 'key1', name: 'Test Key', enabled: true, createdDate: new Date() },
          ],
        });

        const result = await manager.listApiKeys();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      mockRestSend.mockRejectedValueOnce(new Error('AccessDeniedException'));

      const result = await manager.listRestApis();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle network errors', async () => {
      mockHttpSend.mockRejectedValueOnce(new Error('NetworkingError'));

      const result = await manager.listHttpApis();
      expect(result.success).toBe(false);
    });
  });
});
