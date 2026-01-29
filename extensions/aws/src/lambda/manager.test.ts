/**
 * Tests for AWS Lambda Manager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LambdaManager } from './manager.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-lambda', () => {
  return {
    LambdaClient: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
    CreateFunctionCommand: vi.fn(),
    DeleteFunctionCommand: vi.fn(),
    GetFunctionCommand: vi.fn(),
    GetFunctionConfigurationCommand: vi.fn(),
    ListFunctionsCommand: vi.fn(),
    UpdateFunctionCodeCommand: vi.fn(),
    UpdateFunctionConfigurationCommand: vi.fn(),
    InvokeCommand: vi.fn(),
    PublishVersionCommand: vi.fn(),
    ListVersionsByFunctionCommand: vi.fn(),
    CreateAliasCommand: vi.fn(),
    UpdateAliasCommand: vi.fn(),
    DeleteAliasCommand: vi.fn(),
    GetAliasCommand: vi.fn(),
    ListAliasesCommand: vi.fn(),
    CreateEventSourceMappingCommand: vi.fn(),
    UpdateEventSourceMappingCommand: vi.fn(),
    DeleteEventSourceMappingCommand: vi.fn(),
    GetEventSourceMappingCommand: vi.fn(),
    ListEventSourceMappingsCommand: vi.fn(),
    AddPermissionCommand: vi.fn(),
    RemovePermissionCommand: vi.fn(),
    GetPolicyCommand: vi.fn(),
    PublishLayerVersionCommand: vi.fn(),
    DeleteLayerVersionCommand: vi.fn(),
    GetLayerVersionCommand: vi.fn(),
    ListLayersCommand: vi.fn(),
    ListLayerVersionsCommand: vi.fn(),
    PutFunctionConcurrencyCommand: vi.fn(),
    DeleteFunctionConcurrencyCommand: vi.fn(),
    GetFunctionConcurrencyCommand: vi.fn(),
    PutProvisionedConcurrencyConfigCommand: vi.fn(),
    DeleteProvisionedConcurrencyConfigCommand: vi.fn(),
    GetProvisionedConcurrencyConfigCommand: vi.fn(),
    ListProvisionedConcurrencyConfigsCommand: vi.fn(),
    CreateFunctionUrlConfigCommand: vi.fn(),
    UpdateFunctionUrlConfigCommand: vi.fn(),
    DeleteFunctionUrlConfigCommand: vi.fn(),
    GetFunctionUrlConfigCommand: vi.fn(),
    ListFunctionUrlConfigsCommand: vi.fn(),
    TagResourceCommand: vi.fn(),
    UntagResourceCommand: vi.fn(),
    ListTagsCommand: vi.fn(),
    GetAccountSettingsCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-cloudwatch', () => {
  return {
    CloudWatchClient: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
    GetMetricStatisticsCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-cloudwatch-logs', () => {
  return {
    CloudWatchLogsClient: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
    FilterLogEventsCommand: vi.fn(),
    DescribeLogStreamsCommand: vi.fn(),
    GetLogEventsCommand: vi.fn(),
  };
});

describe('LambdaManager', () => {
  let manager: LambdaManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new LambdaManager({ region: 'us-east-1' });
  });

  // ==========================================================================
  // 1. Lambda Function Deployment Tests
  // ==========================================================================

  describe('Function Deployment', () => {
    it('should list functions', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Functions: [
          {
            FunctionName: 'test-function',
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
            Runtime: 'nodejs20.x',
            Role: 'arn:aws:iam::123456789012:role/test-role',
            Handler: 'index.handler',
            CodeSize: 1024,
            Timeout: 30,
            MemorySize: 256,
            Version: '$LATEST',
          },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const functions = await manager.listFunctions();

      expect(functions).toHaveLength(1);
      expect(functions[0].functionName).toBe('test-function');
      expect(functions[0].runtime).toBe('nodejs20.x');
    });

    it('should get a function by name', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Configuration: {
          FunctionName: 'my-function',
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
          Runtime: 'python3.11',
          Role: 'arn:aws:iam::123456789012:role/role',
          Handler: 'handler.main',
          CodeSize: 2048,
          Timeout: 60,
          MemorySize: 512,
          Version: '$LATEST',
        },
        Tags: { Environment: 'prod' },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const fn = await manager.getFunction('my-function');

      expect(fn).not.toBeNull();
      expect(fn?.functionName).toBe('my-function');
      expect(fn?.runtime).toBe('python3.11');
      expect(fn?.tags?.Environment).toBe('prod');
    });

    it('should return null for non-existent function', async () => {
      const mockSend = vi.fn().mockRejectedValue({ name: 'ResourceNotFoundException' });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const fn = await manager.getFunction('nonexistent');

      expect(fn).toBeNull();
    });

    it('should create a function', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionName: 'new-function',
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:new-function',
        Runtime: 'nodejs20.x',
        Role: 'arn:aws:iam::123456789012:role/role',
        Handler: 'index.handler',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.createFunction({
        functionName: 'new-function',
        runtime: 'nodejs20.x',
        role: 'arn:aws:iam::123456789012:role/role',
        handler: 'index.handler',
        code: { s3Bucket: 'my-bucket', s3Key: 'code.zip' },
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('created');
    });

    it('should delete a function', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.deleteFunction('test-function');

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
    });

    it('should update function code', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionName: 'test-function',
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        Runtime: 'nodejs20.x',
        CodeSha256: 'abc123',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.updateFunctionCode({
        functionName: 'test-function',
        code: { s3Bucket: 'bucket', s3Key: 'new-code.zip' },
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('code updated');
    });
  });

  // ==========================================================================
  // 2. Lambda Function Configuration Management Tests
  // ==========================================================================

  describe('Function Configuration Management', () => {
    it('should get function configuration', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionName: 'config-test',
        Runtime: 'java21',
        Handler: 'com.example.Handler',
        MemorySize: 1024,
        Timeout: 120,
        Environment: { Variables: { NODE_ENV: 'production' } },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const config = await manager.getFunctionConfiguration('config-test');

      expect(config?.functionName).toBe('config-test');
      expect(config?.memorySize).toBe(1024);
      expect(config?.environment?.variables.NODE_ENV).toBe('production');
    });

    it('should update function configuration', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionName: 'config-test',
        MemorySize: 2048,
        Timeout: 300,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.updateFunctionConfiguration({
        functionName: 'config-test',
        memorySize: 2048,
        timeout: 300,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('configuration updated');
    });
  });

  // ==========================================================================
  // 3. Lambda Trigger Management Tests
  // ==========================================================================

  describe('Trigger Management', () => {
    it('should list event source mappings', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        EventSourceMappings: [
          {
            UUID: 'uuid-123',
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
            EventSourceArn: 'arn:aws:sqs:us-east-1:123456789012:queue',
            State: 'Enabled',
            BatchSize: 10,
          },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const mappings = await manager.listEventSourceMappings({ functionName: 'test' });

      expect(mappings).toHaveLength(1);
      expect(mappings[0].uuid).toBe('uuid-123');
      expect(mappings[0].state).toBe('Enabled');
    });

    it('should create event source mapping', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        UUID: 'new-uuid',
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
        EventSourceArn: 'arn:aws:sqs:us-east-1:123456789012:queue',
        State: 'Creating',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.createEventSourceMapping({
        functionName: 'test',
        eventSourceArn: 'arn:aws:sqs:us-east-1:123456789012:queue',
        batchSize: 10,
      });

      expect(result.success).toBe(true);
      expect((result.data as { uuid?: string })?.uuid).toBe('new-uuid');
    });

    it('should delete event source mapping', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.deleteEventSourceMapping('uuid-123');

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
    });

    it('should add permission to function', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Statement: '{"Sid":"api-gateway-invoke"}',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.addPermission({
        functionName: 'test',
        statementId: 'api-gateway-invoke',
        action: 'lambda:InvokeFunction',
        principal: 'apigateway.amazonaws.com',
        sourceArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/*',
      });

      expect(result.success).toBe(true);
    });

    it('should remove permission from function', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.removePermission({
        functionName: 'test',
        statementId: 'api-gateway-invoke',
      });

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 4. Lambda Environment Variable Management Tests
  // ==========================================================================

  describe('Environment Variable Management', () => {
    it('should get environment variables', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionName: 'env-test',
        Environment: {
          Variables: {
            NODE_ENV: 'production',
            API_KEY: 'secret',
          },
        },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const vars = await manager.getEnvironmentVariables('env-test');

      expect(vars).not.toBeNull();
      expect(vars?.NODE_ENV).toBe('production');
      expect(vars?.API_KEY).toBe('secret');
    });

    it('should set environment variables', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionName: 'env-test',
        Environment: {
          Variables: { NEW_VAR: 'value' },
        },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.setEnvironmentVariables('env-test', { NEW_VAR: 'value' });

      expect(result.success).toBe(true);
    });

    it('should update specific environment variables', async () => {
      // First call for get, second for update
      const mockSend = vi
        .fn()
        .mockResolvedValueOnce({
          FunctionName: 'env-test',
          Environment: { Variables: { EXISTING: 'value' } },
        })
        .mockResolvedValueOnce({
          FunctionName: 'env-test',
          Environment: { Variables: { EXISTING: 'value', NEW: 'new-value' } },
        });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.updateEnvironmentVariables('env-test', { NEW: 'new-value' });

      expect(result.success).toBe(true);
    });

    it('should remove specific environment variables', async () => {
      const mockSend = vi
        .fn()
        .mockResolvedValueOnce({
          FunctionName: 'env-test',
          Environment: { Variables: { KEEP: 'keep', REMOVE: 'remove' } },
        })
        .mockResolvedValueOnce({
          FunctionName: 'env-test',
          Environment: { Variables: { KEEP: 'keep' } },
        });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.removeEnvironmentVariables('env-test', ['REMOVE']);

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 5. Lambda Layer Management Tests
  // ==========================================================================

  describe('Layer Management', () => {
    it('should list layers', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Layers: [
          {
            LayerName: 'my-layer',
            LayerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer',
            LatestMatchingVersion: {
              LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer:1',
              Version: 1,
              Description: 'Test layer',
            },
          },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const layers = await manager.listLayers();

      expect(layers).toHaveLength(1);
      expect(layers[0].layerName).toBe('my-layer');
    });

    it('should list layer versions', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        LayerVersions: [
          {
            LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer:2',
            Version: 2,
            Description: 'Version 2',
          },
          {
            LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer:1',
            Version: 1,
            Description: 'Version 1',
          },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const versions = await manager.listLayerVersions({ layerName: 'my-layer' });

      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(2);
    });

    it('should publish layer version', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer:3',
        Version: 3,
        Description: 'New version',
        CreatedDate: '2024-01-15T00:00:00Z',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.publishLayerVersion({
        layerName: 'my-layer',
        description: 'New version',
        content: { s3Bucket: 'bucket', s3Key: 'layer.zip' },
        compatibleRuntimes: ['nodejs20.x'],
      });

      expect(result.success).toBe(true);
      expect((result.data as { version?: number })?.version).toBe(3);
    });

    it('should delete layer version', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.deleteLayerVersion('my-layer', 1);

      expect(result.success).toBe(true);
    });

    it('should add layers to function', async () => {
      const mockSend = vi
        .fn()
        .mockResolvedValueOnce({
          FunctionName: 'test-fn',
          Layers: [{ Arn: 'arn:aws:lambda:us-east-1:123456789012:layer:existing:1' }],
        })
        .mockResolvedValueOnce({
          FunctionName: 'test-fn',
          Layers: [
            { Arn: 'arn:aws:lambda:us-east-1:123456789012:layer:existing:1' },
            { Arn: 'arn:aws:lambda:us-east-1:123456789012:layer:new:1' },
          ],
        });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.addLayersToFunction('test-fn', [
        'arn:aws:lambda:us-east-1:123456789012:layer:new:1',
      ]);

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Lambda Version and Alias Management Tests
  // ==========================================================================

  describe('Version and Alias Management', () => {
    it('should publish version', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionName: 'test-fn',
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-fn:5',
        Version: '5',
        Description: 'Release v5',
        CodeSha256: 'abc123',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.publishVersion({
        functionName: 'test-fn',
        description: 'Release v5',
      });

      expect(result.success).toBe(true);
      expect((result.data as { version?: string })?.version).toBe('5');
    });

    it('should list versions', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Versions: [
          { FunctionName: 'test-fn', Version: '$LATEST' },
          { FunctionName: 'test-fn', Version: '1' },
          { FunctionName: 'test-fn', Version: '2' },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const versions = await manager.listVersions({ functionName: 'test-fn' });

      expect(versions).toHaveLength(3);
    });

    it('should create alias', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-fn:prod',
        Name: 'prod',
        FunctionVersion: '5',
        Description: 'Production alias',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.createAlias({
        functionName: 'test-fn',
        name: 'prod',
        functionVersion: '5',
        description: 'Production alias',
      });

      expect(result.success).toBe(true);
      expect((result.data as { name?: string })?.name).toBe('prod');
    });

    it('should update alias with routing config', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-fn:prod',
        Name: 'prod',
        FunctionVersion: '5',
        RoutingConfig: { AdditionalVersionWeights: { '6': 0.1 } },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.updateAlias({
        functionName: 'test-fn',
        name: 'prod',
        functionVersion: '5',
        routingConfig: { additionalVersionWeights: { '6': 0.1 } },
      });

      expect(result.success).toBe(true);
      expect((result.data as { routingConfig?: { additionalVersionWeights?: Record<string, number> } })?.routingConfig?.additionalVersionWeights).toEqual({ '6': 0.1 });
    });

    it('should delete alias', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.deleteAlias('test-fn', 'staging');

      expect(result.success).toBe(true);
    });

    it('should list aliases', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Aliases: [
          { Name: 'prod', FunctionVersion: '5' },
          { Name: 'staging', FunctionVersion: '6' },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const aliases = await manager.listAliases({ functionName: 'test-fn' });

      expect(aliases).toHaveLength(2);
      expect(aliases[0].name).toBe('prod');
    });
  });

  // ==========================================================================
  // 7. Lambda Monitoring and Logging Tests
  // ==========================================================================

  describe('Monitoring and Logging', () => {
    it('should get function metrics', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Datapoints: [
          { Sum: 100, Timestamp: new Date('2024-01-15T00:00:00Z') },
        ],
      });

      const { CloudWatchClient } = await import('@aws-sdk/client-cloudwatch');
      (CloudWatchClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const metrics = await manager.getMetrics({
        functionName: 'test-fn',
        startTime: new Date('2024-01-14T00:00:00Z'),
        endTime: new Date('2024-01-15T00:00:00Z'),
        metricNames: ['Invocations'],
      });

      expect(metrics.functionName).toBe('test-fn');
      expect(metrics.metrics).toBeDefined();
    });

    it('should get function logs', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        events: [
          { timestamp: 1705276800000, message: 'START RequestId: abc-123' },
          { timestamp: 1705276801000, message: 'END RequestId: abc-123' },
        ],
      });

      const { CloudWatchLogsClient } = await import('@aws-sdk/client-cloudwatch-logs');
      (CloudWatchLogsClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const logs = await manager.getLogs({
        functionName: 'test-fn',
        startTime: 1705190400000,
        endTime: 1705276800000,
      });

      expect(logs).toHaveLength(2);
      expect(logs[0].message).toContain('START');
    });

    it('should get recent log streams', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        logStreams: [
          {
            logStreamName: '2024/01/15/[$LATEST]abc123',
            lastEventTimestamp: 1705276800000,
          },
        ],
      });

      const { CloudWatchLogsClient } = await import('@aws-sdk/client-cloudwatch-logs');
      (CloudWatchLogsClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const streams = await manager.getRecentLogStreams('test-fn');

      expect(streams).toHaveLength(1);
      expect(streams[0].logStreamName).toContain('$LATEST');
    });
  });

  // ==========================================================================
  // 8. Lambda Cold Start Optimization Tests
  // ==========================================================================

  describe('Cold Start Optimization', () => {
    it('should set reserved concurrency', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        ReservedConcurrentExecutions: 100,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.setReservedConcurrency('test-fn', 100);

      expect(result.success).toBe(true);
      expect((result.data as { reservedConcurrentExecutions?: number })?.reservedConcurrentExecutions).toBe(100);
    });

    it('should delete reserved concurrency', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.deleteReservedConcurrency('test-fn');

      expect(result.success).toBe(true);
    });

    it('should set provisioned concurrency', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        RequestedProvisionedConcurrentExecutions: 50,
        AvailableProvisionedConcurrentExecutions: 50,
        AllocatedProvisionedConcurrentExecutions: 50,
        Status: 'READY',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.setProvisionedConcurrency({
        functionName: 'test-fn',
        qualifier: 'prod',
        provisionedConcurrentExecutions: 50,
      });

      expect(result.success).toBe(true);
      expect((result.data as { requestedProvisionedConcurrentExecutions?: number })?.requestedProvisionedConcurrentExecutions).toBe(50);
    });

    it('should delete provisioned concurrency', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.deleteProvisionedConcurrency('test-fn', 'prod');

      expect(result.success).toBe(true);
    });

    it('should list provisioned concurrency configs', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        ProvisionedConcurrencyConfigs: [
          {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-fn:prod',
            RequestedProvisionedConcurrentExecutions: 50,
            AvailableProvisionedConcurrentExecutions: 50,
            Status: 'READY',
          },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const configs = await manager.listProvisionedConcurrencyConfigs({
        functionName: 'test-fn',
      });

      expect(configs).toHaveLength(1);
      expect(configs[0].status).toBe('READY');
    });

    it('should analyze cold starts', async () => {
      const mockSend = vi
        .fn()
        .mockResolvedValueOnce({
          FunctionName: 'cold-start-test',
          MemorySize: 256,
          Runtime: 'nodejs20.x',
          CodeSize: 10 * 1024 * 1024,
          VpcConfig: { SubnetIds: [], SecurityGroupIds: [] },
          Architectures: ['x86_64'],
        })
        .mockResolvedValueOnce({
          ProvisionedConcurrencyConfigs: [],
          NextMarker: undefined,
        });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const analysis = await manager.analyzeColdStarts('cold-start-test');

      expect(analysis.functionName).toBe('cold-start-test');
      expect(analysis.recommendations.length).toBeGreaterThan(0);
      expect(analysis.optimizationScore).toBeLessThan(100);
    });

    it('should warmup function', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        StatusCode: 200,
        Payload: Buffer.from(JSON.stringify({ warmed: true })),
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.warmupFunction({
        functionName: 'test-fn',
        concurrency: 3,
      });

      expect(result.success).toBe(true);
      expect((result.data as { successCount?: number })?.successCount).toBe(3);
    });
  });

  // ==========================================================================
  // Lambda Invocation Tests
  // ==========================================================================

  describe('Lambda Invocation', () => {
    it('should invoke function synchronously', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        StatusCode: 200,
        ExecutedVersion: '5',
        Payload: Buffer.from(JSON.stringify({ result: 'success' })),
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.invoke({
        functionName: 'test-fn',
        payload: JSON.stringify({ key: 'value' }),
      });

      expect(result.statusCode).toBe(200);
      expect(result.payload).toContain('success');
    });

    it('should invoke function asynchronously', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        StatusCode: 202,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.invoke({
        functionName: 'test-fn',
        invocationType: 'Event',
      });

      expect(result.statusCode).toBe(202);
    });
  });

  // ==========================================================================
  // Lambda Function URL Tests
  // ==========================================================================

  describe('Function URLs', () => {
    it('should create function URL', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionUrl: 'https://abc123.lambda-url.us-east-1.on.aws/',
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-fn',
        AuthType: 'NONE',
        CreationTime: '2024-01-15T00:00:00Z',
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.createFunctionUrl({
        functionName: 'test-fn',
        authType: 'NONE',
      });

      expect(result.success).toBe(true);
      expect((result.data as { functionUrl?: string })?.functionUrl).toContain('lambda-url');
    });

    it('should update function URL with CORS', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionUrl: 'https://abc123.lambda-url.us-east-1.on.aws/',
        AuthType: 'NONE',
        Cors: {
          AllowOrigins: ['*'],
          AllowMethods: ['GET', 'POST'],
        },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.updateFunctionUrl({
        functionName: 'test-fn',
        cors: {
          allowOrigins: ['*'],
          allowMethods: ['GET', 'POST'],
        },
      });

      expect(result.success).toBe(true);
    });

    it('should delete function URL', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.deleteFunctionUrl('test-fn');

      expect(result.success).toBe(true);
    });

    it('should list function URLs', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        FunctionUrlConfigs: [
          {
            FunctionUrl: 'https://abc123.lambda-url.us-east-1.on.aws/',
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-fn',
            AuthType: 'NONE',
          },
        ],
        NextMarker: undefined,
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const urls = await manager.listFunctionUrls({ functionName: 'test-fn' });

      expect(urls).toHaveLength(1);
      expect(urls[0].authType).toBe('NONE');
    });
  });

  // ==========================================================================
  // Lambda Tagging Tests
  // ==========================================================================

  describe('Tagging', () => {
    it('should tag resource', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.tagResource(
        'arn:aws:lambda:us-east-1:123456789012:function:test-fn',
        { Environment: 'prod', Team: 'platform' }
      );

      expect(result.success).toBe(true);
    });

    it('should untag resource', async () => {
      const mockSend = vi.fn().mockResolvedValue({});

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const result = await manager.untagResource(
        'arn:aws:lambda:us-east-1:123456789012:function:test-fn',
        ['Environment']
      );

      expect(result.success).toBe(true);
    });

    it('should list tags', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Tags: { Environment: 'prod', Team: 'platform' },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const tags = await manager.listTags(
        'arn:aws:lambda:us-east-1:123456789012:function:test-fn'
      );

      expect(tags.Environment).toBe('prod');
      expect(tags.Team).toBe('platform');
    });
  });

  // ==========================================================================
  // Lambda Account Settings Tests
  // ==========================================================================

  describe('Account Settings', () => {
    it('should get account settings', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        AccountLimit: {
          TotalCodeSize: 80530636800,
          CodeSizeUnzipped: 262144000,
          CodeSizeZipped: 52428800,
          ConcurrentExecutions: 1000,
          UnreservedConcurrentExecutions: 900,
        },
        AccountUsage: {
          TotalCodeSize: 1234567890,
          FunctionCount: 50,
        },
      });

      const { LambdaClient } = await import('@aws-sdk/client-lambda');
      (LambdaClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      manager = new LambdaManager({ region: 'us-east-1' });
      const settings = await manager.getAccountSettings();

      expect(settings.accountLimit?.concurrentExecutions).toBe(1000);
      expect(settings.accountUsage?.functionCount).toBe(50);
    });
  });
});
