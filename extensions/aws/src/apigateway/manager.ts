/**
 * API Gateway Manager - REST and WebSocket API Management
 * 
 * Comprehensive API Gateway operations with:
 * - REST API lifecycle (create, update, delete, deploy)
 * - HTTP API (API Gateway v2) support
 * - WebSocket API support
 * - Stage management and deployments
 * - Custom domains and certificates
 * - Usage plans and API keys
 * - Request/response transformations
 * - Authorizers (Lambda, Cognito, IAM)
 * - OpenAPI/Swagger import/export
 */

import {
  APIGatewayClient,
  CreateRestApiCommand,
  DeleteRestApiCommand,
  GetRestApiCommand,
  GetRestApisCommand,
  UpdateRestApiCommand,
  CreateResourceCommand,
  DeleteResourceCommand,
  GetResourcesCommand,
  PutMethodCommand,
  DeleteMethodCommand,
  PutIntegrationCommand,
  PutIntegrationResponseCommand,
  PutMethodResponseCommand,
  CreateDeploymentCommand,
  GetDeploymentsCommand,
  DeleteDeploymentCommand,
  CreateStageCommand,
  UpdateStageCommand,
  DeleteStageCommand,
  GetStageCommand,
  GetStagesCommand,
  CreateAuthorizerCommand,
  DeleteAuthorizerCommand,
  GetAuthorizersCommand,
  UpdateAuthorizerCommand,
  CreateUsagePlanCommand,
  DeleteUsagePlanCommand,
  GetUsagePlansCommand,
  UpdateUsagePlanCommand,
  CreateUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
  GetUsagePlanKeysCommand,
  CreateApiKeyCommand,
  DeleteApiKeyCommand,
  GetApiKeysCommand,
  UpdateApiKeyCommand,
  CreateDomainNameCommand,
  DeleteDomainNameCommand,
  GetDomainNamesCommand,
  CreateBasePathMappingCommand,
  DeleteBasePathMappingCommand,
  GetBasePathMappingsCommand,
  ImportRestApiCommand,
  GetExportCommand,
  PutGatewayResponseCommand,
  GetGatewayResponsesCommand,
  CreateRequestValidatorCommand,
  DeleteRequestValidatorCommand,
  GetRequestValidatorsCommand,
  TagResourceCommand,
  UntagResourceCommand,
  GetTagsCommand,
  FlushStageCacheCommand,
  FlushStageAuthorizersCacheCommand,
  type RestApi,
  type Resource,
  type Method,
  type Stage,
  type Deployment,
  type Authorizer,
  type UsagePlan,
  type ApiKey,
  type DomainName,
  type BasePathMapping,
} from '@aws-sdk/client-api-gateway';

import {
  ApiGatewayV2Client,
  CreateApiCommand as CreateApiV2Command,
  DeleteApiCommand as DeleteApiV2Command,
  GetApiCommand as GetApiV2Command,
  GetApisCommand as GetApisV2Command,
  UpdateApiCommand as UpdateApiV2Command,
  CreateRouteCommand,
  DeleteRouteCommand,
  GetRoutesCommand,
  UpdateRouteCommand,
  CreateIntegrationCommand,
  DeleteIntegrationCommand,
  GetIntegrationsCommand,
  UpdateIntegrationCommand,
  CreateStageCommand as CreateStageV2Command,
  DeleteStageCommand as DeleteStageV2Command,
  GetStageCommand as GetStageV2Command,
  GetStagesCommand as GetStagesV2Command,
  UpdateStageCommand as UpdateStageV2Command,
  CreateAuthorizerCommand as CreateAuthorizerV2Command,
  DeleteAuthorizerCommand as DeleteAuthorizerV2Command,
  GetAuthorizersCommand as GetAuthorizersV2Command,
  UpdateAuthorizerCommand as UpdateAuthorizerV2Command,
  CreateDomainNameCommand as CreateDomainNameV2Command,
  DeleteDomainNameCommand as DeleteDomainNameV2Command,
  GetDomainNamesCommand as GetDomainNamesV2Command,
  CreateApiMappingCommand,
  DeleteApiMappingCommand,
  GetApiMappingsCommand,
  CreateDeploymentCommand as CreateDeploymentV2Command,
  GetDeploymentsCommand as GetDeploymentsV2Command,
  ExportApiCommand,
  ImportApiCommand,
  ReimportApiCommand,
  type Api,
  type Route,
  type Integration,
  type Stage as StageV2,
  type Authorizer as AuthorizerV2,
  type DomainName as DomainNameV2,
  type ApiMapping,
} from '@aws-sdk/client-apigatewayv2';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface APIGatewayManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
  defaultTags?: Record<string, string>;
}

export type APIType = 'REST' | 'HTTP' | 'WEBSOCKET';

export interface CreateRESTApiConfig {
  name: string;
  description?: string;
  endpointType?: 'EDGE' | 'REGIONAL' | 'PRIVATE';
  vpcEndpointIds?: string[];
  binaryMediaTypes?: string[];
  minimumCompressionSize?: number;
  apiKeySource?: 'HEADER' | 'AUTHORIZER';
  disableExecuteApiEndpoint?: boolean;
  tags?: Record<string, string>;
}

export interface CreateHTTPApiConfig {
  name: string;
  description?: string;
  protocolType: 'HTTP' | 'WEBSOCKET';
  corsConfiguration?: {
    allowCredentials?: boolean;
    allowHeaders?: string[];
    allowMethods?: string[];
    allowOrigins?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
  };
  routeSelectionExpression?: string;
  version?: string;
  tags?: Record<string, string>;
  disableExecuteApiEndpoint?: boolean;
}

export interface ResourceConfig {
  restApiId: string;
  parentId: string;
  pathPart: string;
}

export interface MethodConfig {
  restApiId: string;
  resourceId: string;
  httpMethod: string;
  authorizationType: 'NONE' | 'AWS_IAM' | 'CUSTOM' | 'COGNITO_USER_POOLS';
  authorizerId?: string;
  apiKeyRequired?: boolean;
  operationName?: string;
  requestParameters?: Record<string, boolean>;
  requestModels?: Record<string, string>;
  requestValidatorId?: string;
}

export interface IntegrationConfig {
  restApiId: string;
  resourceId: string;
  httpMethod: string;
  type: 'AWS' | 'AWS_PROXY' | 'HTTP' | 'HTTP_PROXY' | 'MOCK';
  integrationHttpMethod?: string;
  uri?: string;
  connectionType?: 'INTERNET' | 'VPC_LINK';
  connectionId?: string;
  credentials?: string;
  requestParameters?: Record<string, string>;
  requestTemplates?: Record<string, string>;
  passthroughBehavior?: 'WHEN_NO_MATCH' | 'WHEN_NO_TEMPLATES' | 'NEVER';
  contentHandling?: 'CONVERT_TO_BINARY' | 'CONVERT_TO_TEXT';
  timeoutInMillis?: number;
  cacheNamespace?: string;
  cacheKeyParameters?: string[];
}

export interface RouteConfig {
  apiId: string;
  routeKey: string;
  target?: string;
  authorizationType?: 'NONE' | 'AWS_IAM' | 'CUSTOM' | 'JWT';
  authorizerId?: string;
  apiKeyRequired?: boolean;
  operationName?: string;
  modelSelectionExpression?: string;
  requestModels?: Record<string, string>;
  requestParameters?: Record<string, { Required: boolean }>;
}

export interface HTTPIntegrationConfig {
  apiId: string;
  integrationType: 'AWS_PROXY' | 'HTTP_PROXY' | 'MOCK';
  integrationUri?: string;
  integrationMethod?: string;
  connectionType?: 'INTERNET' | 'VPC_LINK';
  connectionId?: string;
  payloadFormatVersion?: '1.0' | '2.0';
  timeoutInMillis?: number;
  description?: string;
}

export interface StageConfig {
  restApiId?: string;
  apiId?: string;
  stageName: string;
  deploymentId?: string;
  description?: string;
  cacheClusterEnabled?: boolean;
  cacheClusterSize?: '0.5' | '1.6' | '6.1' | '13.5' | '28.4' | '58.2' | '118' | '237';
  variables?: Record<string, string>;
  throttling?: {
    burstLimit?: number;
    rateLimit?: number;
  };
  accessLogSettings?: {
    destinationArn: string;
    format: string;
  };
  tracingEnabled?: boolean;
  tags?: Record<string, string>;
  autoDeploy?: boolean;
}

export interface AuthorizerConfig {
  restApiId?: string;
  apiId?: string;
  name: string;
  type: 'TOKEN' | 'REQUEST' | 'COGNITO_USER_POOLS' | 'JWT';
  authorizerUri?: string;
  authorizerCredentials?: string;
  identitySource?: string | string[];
  identityValidationExpression?: string;
  authorizerResultTtlInSeconds?: number;
  providerArns?: string[];
  jwtConfiguration?: {
    audience?: string[];
    issuer?: string;
  };
}

export interface UsagePlanConfig {
  name: string;
  description?: string;
  apiStages?: { apiId: string; stage: string; throttle?: Record<string, { burstLimit?: number; rateLimit?: number }> }[];
  quota?: {
    limit: number;
    offset?: number;
    period: 'DAY' | 'WEEK' | 'MONTH';
  };
  throttle?: {
    burstLimit?: number;
    rateLimit?: number;
  };
  tags?: Record<string, string>;
}

export interface ApiKeyConfig {
  name: string;
  description?: string;
  enabled?: boolean;
  value?: string;
  stageKeys?: { restApiId: string; stageName: string }[];
  tags?: Record<string, string>;
}

export interface DomainConfig {
  domainName: string;
  certificateArn?: string;
  regionalCertificateArn?: string;
  endpointType?: 'EDGE' | 'REGIONAL';
  securityPolicy?: 'TLS_1_0' | 'TLS_1_2';
  mutualTlsAuthentication?: {
    truststoreUri: string;
    truststoreVersion?: string;
  };
  tags?: Record<string, string>;
}

export interface BasePathMappingConfig {
  domainName: string;
  restApiId?: string;
  apiId?: string;
  basePath?: string;
  stage?: string;
}

export interface OpenApiImportConfig {
  body: string;
  failOnWarnings?: boolean;
  parameters?: Record<string, string>;
  basePath?: string;
}

export interface ApiMetrics {
  apiId: string;
  apiName: string;
  apiType: APIType;
  protocol?: string;
  endpointType?: string;
  createdDate?: Date;
  stages: string[];
  routes?: number;
  resources?: number;
  methods?: number;
  authorizers?: number;
  deployments?: number;
  tags: Record<string, string>;
}

export interface APIGatewayOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// API Gateway Manager Implementation
// ============================================================================

export class APIGatewayManager {
  private restClient: APIGatewayClient;
  private httpClient: ApiGatewayV2Client;
  private config: APIGatewayManagerConfig;

  constructor(config: APIGatewayManagerConfig = {}) {
    this.config = config;
    
    this.restClient = new APIGatewayClient({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });

    this.httpClient = new ApiGatewayV2Client({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });
  }

  // ==========================================================================
  // REST API Operations
  // ==========================================================================

  /**
   * Create a new REST API
   */
  async createRestApi(config: CreateRESTApiConfig): Promise<APIGatewayOperationResult<RestApi>> {
    try {
      const response = await this.restClient.send(new CreateRestApiCommand({
        name: config.name,
        description: config.description,
        endpointConfiguration: config.endpointType ? {
          types: [config.endpointType],
          vpcEndpointIds: config.vpcEndpointIds,
        } : undefined,
        binaryMediaTypes: config.binaryMediaTypes,
        minimumCompressionSize: config.minimumCompressionSize,
        apiKeySource: config.apiKeySource,
        disableExecuteApiEndpoint: config.disableExecuteApiEndpoint,
        tags: { ...this.config.defaultTags, ...config.tags },
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get REST API details
   */
  async getRestApi(restApiId: string): Promise<APIGatewayOperationResult<RestApi>> {
    try {
      const response = await this.restClient.send(new GetRestApiCommand({
        restApiId,
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all REST APIs
   */
  async listRestApis(limit?: number): Promise<APIGatewayOperationResult<RestApi[]>> {
    try {
      const apis: RestApi[] = [];
      let position: string | undefined;

      do {
        const response = await this.restClient.send(new GetRestApisCommand({
          position,
          limit: limit ? Math.min(limit - apis.length, 500) : 500,
        }));

        apis.push(...(response.items ?? []));
        position = response.position;

        if (limit && apis.length >= limit) break;
      } while (position);

      return { success: true, data: apis };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a REST API
   */
  async deleteRestApi(restApiId: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.restClient.send(new DeleteRestApiCommand({
        restApiId,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Import REST API from OpenAPI/Swagger
   */
  async importRestApi(config: OpenApiImportConfig): Promise<APIGatewayOperationResult<RestApi>> {
    try {
      const response = await this.restClient.send(new ImportRestApiCommand({
        body: Buffer.from(config.body),
        failOnWarnings: config.failOnWarnings,
        parameters: config.parameters,
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Export REST API to OpenAPI/Swagger
   */
  async exportRestApi(
    restApiId: string,
    stageName: string,
    exportType: 'oas30' | 'swagger' = 'oas30',
    format: 'application/json' | 'application/yaml' = 'application/json'
  ): Promise<APIGatewayOperationResult<string>> {
    try {
      const response = await this.restClient.send(new GetExportCommand({
        restApiId,
        stageName,
        exportType,
        accepts: format,
      }));

      const body = response.body ? new TextDecoder().decode(response.body) : '';
      return { success: true, data: body };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // HTTP API (v2) Operations
  // ==========================================================================

  /**
   * Create a new HTTP API
   */
  async createHttpApi(config: CreateHTTPApiConfig): Promise<APIGatewayOperationResult<Api>> {
    try {
      const response = await this.httpClient.send(new CreateApiV2Command({
        Name: config.name,
        Description: config.description,
        ProtocolType: config.protocolType,
        CorsConfiguration: config.corsConfiguration ? {
          AllowCredentials: config.corsConfiguration.allowCredentials,
          AllowHeaders: config.corsConfiguration.allowHeaders,
          AllowMethods: config.corsConfiguration.allowMethods,
          AllowOrigins: config.corsConfiguration.allowOrigins,
          ExposeHeaders: config.corsConfiguration.exposeHeaders,
          MaxAge: config.corsConfiguration.maxAge,
        } : undefined,
        RouteSelectionExpression: config.routeSelectionExpression ?? '$request.method $request.path',
        Version: config.version,
        Tags: { ...this.config.defaultTags, ...config.tags },
        DisableExecuteApiEndpoint: config.disableExecuteApiEndpoint,
      }));

      return { success: true, data: response as Api };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get HTTP API details
   */
  async getHttpApi(apiId: string): Promise<APIGatewayOperationResult<Api>> {
    try {
      const response = await this.httpClient.send(new GetApiV2Command({
        ApiId: apiId,
      }));

      return { success: true, data: response as Api };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all HTTP/WebSocket APIs
   */
  async listHttpApis(): Promise<APIGatewayOperationResult<Api[]>> {
    try {
      const apis: Api[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.httpClient.send(new GetApisV2Command({
          NextToken: nextToken,
        }));

        apis.push(...(response.Items ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: apis };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an HTTP API
   */
  async deleteHttpApi(apiId: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.httpClient.send(new DeleteApiV2Command({
        ApiId: apiId,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Import HTTP API from OpenAPI
   */
  async importHttpApi(
    body: string,
    basePath?: string,
    failOnWarnings?: boolean
  ): Promise<APIGatewayOperationResult<Api>> {
    try {
      const response = await this.httpClient.send(new ImportApiCommand({
        Body: body,
        Basepath: basePath,
        FailOnWarnings: failOnWarnings,
      }));

      return { success: true, data: response as Api };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Export HTTP API to OpenAPI
   */
  async exportHttpApi(
    apiId: string,
    stageName?: string,
    exportVersion: '1.0' = '1.0',
    outputType: 'JSON' | 'YAML' = 'JSON'
  ): Promise<APIGatewayOperationResult<string>> {
    try {
      const response = await this.httpClient.send(new ExportApiCommand({
        ApiId: apiId,
        StageName: stageName,
        Specification: 'OAS30',
        ExportVersion: exportVersion,
        OutputType: outputType,
      }));

      const body = response.body ? new TextDecoder().decode(response.body) : '';
      return { success: true, data: body };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Resource Operations (REST API)
  // ==========================================================================

  /**
   * Create a resource (path) in a REST API
   */
  async createResource(config: ResourceConfig): Promise<APIGatewayOperationResult<Resource>> {
    try {
      const response = await this.restClient.send(new CreateResourceCommand({
        restApiId: config.restApiId,
        parentId: config.parentId,
        pathPart: config.pathPart,
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List resources in a REST API
   */
  async listResources(restApiId: string): Promise<APIGatewayOperationResult<Resource[]>> {
    try {
      const resources: Resource[] = [];
      let position: string | undefined;

      do {
        const response = await this.restClient.send(new GetResourcesCommand({
          restApiId,
          position,
          limit: 500,
        }));

        resources.push(...(response.items ?? []));
        position = response.position;
      } while (position);

      return { success: true, data: resources };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a resource
   */
  async deleteResource(restApiId: string, resourceId: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.restClient.send(new DeleteResourceCommand({
        restApiId,
        resourceId,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Method Operations (REST API)
  // ==========================================================================

  /**
   * Create a method on a resource
   */
  async createMethod(config: MethodConfig): Promise<APIGatewayOperationResult<Method>> {
    try {
      const response = await this.restClient.send(new PutMethodCommand({
        restApiId: config.restApiId,
        resourceId: config.resourceId,
        httpMethod: config.httpMethod,
        authorizationType: config.authorizationType,
        authorizerId: config.authorizerId,
        apiKeyRequired: config.apiKeyRequired,
        operationName: config.operationName,
        requestParameters: config.requestParameters,
        requestModels: config.requestModels,
        requestValidatorId: config.requestValidatorId,
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a method
   */
  async deleteMethod(restApiId: string, resourceId: string, httpMethod: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.restClient.send(new DeleteMethodCommand({
        restApiId,
        resourceId,
        httpMethod,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Integration Operations (REST API)
  // ==========================================================================

  /**
   * Create an integration for a method
   */
  async createIntegration(config: IntegrationConfig): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.restClient.send(new PutIntegrationCommand({
        restApiId: config.restApiId,
        resourceId: config.resourceId,
        httpMethod: config.httpMethod,
        type: config.type,
        integrationHttpMethod: config.integrationHttpMethod,
        uri: config.uri,
        connectionType: config.connectionType,
        connectionId: config.connectionId,
        credentials: config.credentials,
        requestParameters: config.requestParameters,
        requestTemplates: config.requestTemplates,
        passthroughBehavior: config.passthroughBehavior,
        contentHandling: config.contentHandling,
        timeoutInMillis: config.timeoutInMillis,
        cacheNamespace: config.cacheNamespace,
        cacheKeyParameters: config.cacheKeyParameters,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create Lambda proxy integration (common pattern)
   */
  async createLambdaProxyIntegration(
    restApiId: string,
    resourceId: string,
    httpMethod: string,
    lambdaArn: string,
    credentials?: string
  ): Promise<APIGatewayOperationResult<void>> {
    const region = this.config.region ?? 'us-east-1';
    const uri = `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`;

    return this.createIntegration({
      restApiId,
      resourceId,
      httpMethod,
      type: 'AWS_PROXY',
      integrationHttpMethod: 'POST',
      uri,
      credentials,
    });
  }

  // ==========================================================================
  // Route Operations (HTTP API)
  // ==========================================================================

  /**
   * Create a route in an HTTP API
   */
  async createRoute(config: RouteConfig): Promise<APIGatewayOperationResult<Route>> {
    try {
      const response = await this.httpClient.send(new CreateRouteCommand({
        ApiId: config.apiId,
        RouteKey: config.routeKey,
        Target: config.target,
        AuthorizationType: config.authorizationType ?? 'NONE',
        AuthorizerId: config.authorizerId,
        ApiKeyRequired: config.apiKeyRequired,
        OperationName: config.operationName,
        ModelSelectionExpression: config.modelSelectionExpression,
        RequestModels: config.requestModels,
        RequestParameters: config.requestParameters,
      }));

      return { success: true, data: response as Route };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List routes in an HTTP API
   */
  async listRoutes(apiId: string): Promise<APIGatewayOperationResult<Route[]>> {
    try {
      const routes: Route[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.httpClient.send(new GetRoutesCommand({
          ApiId: apiId,
          NextToken: nextToken,
        }));

        routes.push(...(response.Items ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: routes };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a route
   */
  async deleteRoute(apiId: string, routeId: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.httpClient.send(new DeleteRouteCommand({
        ApiId: apiId,
        RouteId: routeId,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // HTTP API Integration Operations
  // ==========================================================================

  /**
   * Create an integration for an HTTP API
   */
  async createHttpIntegration(config: HTTPIntegrationConfig): Promise<APIGatewayOperationResult<Integration>> {
    try {
      const response = await this.httpClient.send(new CreateIntegrationCommand({
        ApiId: config.apiId,
        IntegrationType: config.integrationType,
        IntegrationUri: config.integrationUri,
        IntegrationMethod: config.integrationMethod,
        ConnectionType: config.connectionType,
        ConnectionId: config.connectionId,
        PayloadFormatVersion: config.payloadFormatVersion ?? '2.0',
        TimeoutInMillis: config.timeoutInMillis ?? 30000,
        Description: config.description,
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create Lambda proxy integration for HTTP API
   */
  async createHttpLambdaIntegration(
    apiId: string,
    lambdaArn: string,
    payloadFormatVersion: '1.0' | '2.0' = '2.0'
  ): Promise<APIGatewayOperationResult<Integration>> {
    return this.createHttpIntegration({
      apiId,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaArn,
      payloadFormatVersion,
    });
  }

  /**
   * List integrations for an HTTP API
   */
  async listHttpIntegrations(apiId: string): Promise<APIGatewayOperationResult<Integration[]>> {
    try {
      const integrations: Integration[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.httpClient.send(new GetIntegrationsCommand({
          ApiId: apiId,
          NextToken: nextToken,
        }));

        integrations.push(...(response.Items ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: integrations };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Stage Operations
  // ==========================================================================

  /**
   * Create a stage for REST API
   */
  async createRestStage(config: StageConfig): Promise<APIGatewayOperationResult<Stage>> {
    try {
      if (!config.restApiId) {
        return { success: false, error: 'restApiId is required for REST API stage' };
      }

      const response = await this.restClient.send(new CreateStageCommand({
        restApiId: config.restApiId,
        stageName: config.stageName,
        deploymentId: config.deploymentId,
        description: config.description,
        cacheClusterEnabled: config.cacheClusterEnabled,
        cacheClusterSize: config.cacheClusterSize,
        variables: config.variables,
        tracingEnabled: config.tracingEnabled,
        tags: { ...this.config.defaultTags, ...config.tags },
      }));

      const stage: Stage = {
        deploymentId: response.deploymentId,
        clientCertificateId: response.clientCertificateId,
        stageName: response.stageName ?? config.stageName,
        description: response.description,
        cacheClusterEnabled: response.cacheClusterEnabled,
        cacheClusterSize: response.cacheClusterSize,
        cacheClusterStatus: response.cacheClusterStatus,
        methodSettings: response.methodSettings,
        variables: response.variables,
        documentationVersion: response.documentationVersion,
        accessLogSettings: response.accessLogSettings,
        canarySettings: response.canarySettings,
        tracingEnabled: response.tracingEnabled,
        webAclArn: response.webAclArn,
        tags: response.tags,
        createdDate: response.createdDate,
        lastUpdatedDate: response.lastUpdatedDate,
      };

      return { success: true, data: stage };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a stage for HTTP API
   */
  async createHttpStage(config: StageConfig): Promise<APIGatewayOperationResult<StageV2>> {
    try {
      if (!config.apiId) {
        return { success: false, error: 'apiId is required for HTTP API stage' };
      }

      const response = await this.httpClient.send(new CreateStageV2Command({
        ApiId: config.apiId,
        StageName: config.stageName,
        DeploymentId: config.deploymentId,
        Description: config.description,
        StageVariables: config.variables,
        DefaultRouteSettings: config.throttling ? {
          ThrottlingBurstLimit: config.throttling.burstLimit,
          ThrottlingRateLimit: config.throttling.rateLimit,
        } : undefined,
        AccessLogSettings: config.accessLogSettings ? {
          DestinationArn: config.accessLogSettings.destinationArn,
          Format: config.accessLogSettings.format,
        } : undefined,
        AutoDeploy: config.autoDeploy,
        Tags: { ...this.config.defaultTags, ...config.tags },
      }));

      const stage: StageV2 = {
        StageName: response.StageName ?? config.stageName,
        ApiGatewayManaged: response.ApiGatewayManaged,
        AutoDeploy: response.AutoDeploy,
        ClientCertificateId: response.ClientCertificateId,
        CreatedDate: response.CreatedDate,
        DefaultRouteSettings: response.DefaultRouteSettings,
        DeploymentId: response.DeploymentId,
        Description: response.Description,
        LastDeploymentStatusMessage: response.LastDeploymentStatusMessage,
        LastUpdatedDate: response.LastUpdatedDate,
        RouteSettings: response.RouteSettings,
        StageVariables: response.StageVariables,
        Tags: response.Tags,
      };

      return { success: true, data: stage };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List stages for REST API
   */
  async listRestStages(restApiId: string): Promise<APIGatewayOperationResult<Stage[]>> {
    try {
      const response = await this.restClient.send(new GetStagesCommand({
        restApiId,
      }));

      return { success: true, data: response.item ?? [] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List stages for HTTP API
   */
  async listHttpStages(apiId: string): Promise<APIGatewayOperationResult<StageV2[]>> {
    try {
      const stages: StageV2[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.httpClient.send(new GetStagesV2Command({
          ApiId: apiId,
          NextToken: nextToken,
        }));

        stages.push(...(response.Items ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: stages };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a REST API stage
   */
  async deleteRestStage(restApiId: string, stageName: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.restClient.send(new DeleteStageCommand({
        restApiId,
        stageName,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an HTTP API stage
   */
  async deleteHttpStage(apiId: string, stageName: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.httpClient.send(new DeleteStageV2Command({
        ApiId: apiId,
        StageName: stageName,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Deployment Operations
  // ==========================================================================

  /**
   * Create a deployment for REST API
   */
  async createRestDeployment(
    restApiId: string,
    stageName?: string,
    description?: string
  ): Promise<APIGatewayOperationResult<Deployment>> {
    try {
      const response = await this.restClient.send(new CreateDeploymentCommand({
        restApiId,
        stageName,
        description,
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a deployment for HTTP API
   */
  async createHttpDeployment(
    apiId: string,
    stageName?: string,
    description?: string
  ): Promise<APIGatewayOperationResult<{ deploymentId: string }>> {
    try {
      const response = await this.httpClient.send(new CreateDeploymentV2Command({
        ApiId: apiId,
        StageName: stageName,
        Description: description,
      }));

      return { success: true, data: { deploymentId: response.DeploymentId! } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Authorizer Operations
  // ==========================================================================

  /**
   * Create an authorizer for REST API
   */
  async createRestAuthorizer(config: AuthorizerConfig): Promise<APIGatewayOperationResult<Authorizer>> {
    try {
      if (!config.restApiId) {
        return { success: false, error: 'restApiId is required for REST API authorizer' };
      }

      const response = await this.restClient.send(new CreateAuthorizerCommand({
        restApiId: config.restApiId,
        name: config.name,
        type: config.type as 'TOKEN' | 'REQUEST' | 'COGNITO_USER_POOLS',
        authorizerUri: config.authorizerUri,
        authorizerCredentials: config.authorizerCredentials,
        identitySource: typeof config.identitySource === 'string' ? config.identitySource : config.identitySource?.join(','),
        identityValidationExpression: config.identityValidationExpression,
        authorizerResultTtlInSeconds: config.authorizerResultTtlInSeconds,
        providerARNs: config.providerArns,
      }));

      const authorizer: Authorizer = {
        id: response.id,
        name: response.name ?? config.name,
        type: response.type,
        providerARNs: response.providerARNs,
        authType: response.authType,
        authorizerUri: response.authorizerUri,
        authorizerCredentials: response.authorizerCredentials,
        identitySource: response.identitySource,
        identityValidationExpression: response.identityValidationExpression,
        authorizerResultTtlInSeconds: response.authorizerResultTtlInSeconds,
      };

      return { success: true, data: authorizer };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create an authorizer for HTTP API
   */
  async createHttpAuthorizer(config: AuthorizerConfig): Promise<APIGatewayOperationResult<AuthorizerV2>> {
    try {
      if (!config.apiId) {
        return { success: false, error: 'apiId is required for HTTP API authorizer' };
      }

      const response = await this.httpClient.send(new CreateAuthorizerV2Command({
        ApiId: config.apiId,
        Name: config.name,
        AuthorizerType: config.type as 'REQUEST' | 'JWT',
        AuthorizerUri: config.authorizerUri,
        AuthorizerCredentialsArn: config.authorizerCredentials,
        IdentitySource: Array.isArray(config.identitySource) ? config.identitySource : config.identitySource ? [config.identitySource] : undefined,
        AuthorizerResultTtlInSeconds: config.authorizerResultTtlInSeconds,
        JwtConfiguration: config.jwtConfiguration ? {
          Audience: config.jwtConfiguration.audience,
          Issuer: config.jwtConfiguration.issuer,
        } : undefined,
      }));

      const authorizer: AuthorizerV2 = {
        AuthorizerId: response.AuthorizerId,
        AuthorizerType: response.AuthorizerType,
        AuthorizerCredentialsArn: response.AuthorizerCredentialsArn,
        AuthorizerUri: response.AuthorizerUri,
        AuthorizerResultTtlInSeconds: response.AuthorizerResultTtlInSeconds,
        IdentitySource: response.IdentitySource,
        IdentityValidationExpression: response.IdentityValidationExpression,
        JwtConfiguration: response.JwtConfiguration,
        Name: response.Name ?? config.name,
      };

      return { success: true, data: authorizer };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List authorizers for REST API
   */
  async listRestAuthorizers(restApiId: string): Promise<APIGatewayOperationResult<Authorizer[]>> {
    try {
      const response = await this.restClient.send(new GetAuthorizersCommand({
        restApiId,
      }));

      return { success: true, data: response.items ?? [] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List authorizers for HTTP API
   */
  async listHttpAuthorizers(apiId: string): Promise<APIGatewayOperationResult<AuthorizerV2[]>> {
    try {
      const authorizers: AuthorizerV2[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.httpClient.send(new GetAuthorizersV2Command({
          ApiId: apiId,
          NextToken: nextToken,
        }));

        authorizers.push(...(response.Items ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: authorizers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Usage Plan & API Key Operations (REST API only)
  // ==========================================================================

  /**
   * Create a usage plan
   */
  async createUsagePlan(config: UsagePlanConfig): Promise<APIGatewayOperationResult<UsagePlan>> {
    try {
      const response = await this.restClient.send(new CreateUsagePlanCommand({
        name: config.name,
        description: config.description,
        apiStages: config.apiStages?.map(s => ({
          apiId: s.apiId,
          stage: s.stage,
          throttle: s.throttle ? Object.fromEntries(
            Object.entries(s.throttle).map(([key, value]) => [
              key,
              { burstLimit: value.burstLimit, rateLimit: value.rateLimit },
            ])
          ) : undefined,
        })),
        quota: config.quota ? {
          limit: config.quota.limit,
          offset: config.quota.offset,
          period: config.quota.period,
        } : undefined,
        throttle: config.throttle ? {
          burstLimit: config.throttle.burstLimit,
          rateLimit: config.throttle.rateLimit,
        } : undefined,
        tags: { ...this.config.defaultTags, ...config.tags },
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List usage plans
   */
  async listUsagePlans(): Promise<APIGatewayOperationResult<UsagePlan[]>> {
    try {
      const usagePlans: UsagePlan[] = [];
      let position: string | undefined;

      do {
        const response = await this.restClient.send(new GetUsagePlansCommand({
          position,
        }));

        usagePlans.push(...(response.items ?? []));
        position = response.position;
      } while (position);

      return { success: true, data: usagePlans };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create an API key
   */
  async createApiKey(config: ApiKeyConfig): Promise<APIGatewayOperationResult<ApiKey>> {
    try {
      const response = await this.restClient.send(new CreateApiKeyCommand({
        name: config.name,
        description: config.description,
        enabled: config.enabled ?? true,
        value: config.value,
        stageKeys: config.stageKeys?.map(sk => ({
          restApiId: sk.restApiId,
          stageName: sk.stageName,
        })),
        tags: { ...this.config.defaultTags, ...config.tags },
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List API keys
   */
  async listApiKeys(includeValues?: boolean): Promise<APIGatewayOperationResult<ApiKey[]>> {
    try {
      const apiKeys: ApiKey[] = [];
      let position: string | undefined;

      do {
        const response = await this.restClient.send(new GetApiKeysCommand({
          position,
          includeValues,
        }));

        apiKeys.push(...(response.items ?? []));
        position = response.position;
      } while (position);

      return { success: true, data: apiKeys };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add API key to usage plan
   */
  async addApiKeyToUsagePlan(usagePlanId: string, keyId: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.restClient.send(new CreateUsagePlanKeyCommand({
        usagePlanId,
        keyId,
        keyType: 'API_KEY',
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Custom Domain Operations
  // ==========================================================================

  /**
   * Create a custom domain for REST API
   */
  async createRestDomain(config: DomainConfig): Promise<APIGatewayOperationResult<DomainName>> {
    try {
      const response = await this.restClient.send(new CreateDomainNameCommand({
        domainName: config.domainName,
        certificateArn: config.endpointType === 'EDGE' ? config.certificateArn : undefined,
        regionalCertificateArn: config.endpointType === 'REGIONAL' ? config.regionalCertificateArn : undefined,
        endpointConfiguration: config.endpointType ? {
          types: [config.endpointType],
        } : undefined,
        securityPolicy: config.securityPolicy,
        mutualTlsAuthentication: config.mutualTlsAuthentication ? {
          truststoreUri: config.mutualTlsAuthentication.truststoreUri,
          truststoreVersion: config.mutualTlsAuthentication.truststoreVersion,
        } : undefined,
        tags: { ...this.config.defaultTags, ...config.tags },
      }));

      const domainName: DomainName = {
        domainName: response.domainName ?? config.domainName,
        certificateName: response.certificateName,
        certificateArn: response.certificateArn,
        certificateUploadDate: response.certificateUploadDate,
        regionalDomainName: response.regionalDomainName,
        regionalHostedZoneId: response.regionalHostedZoneId,
        regionalCertificateName: response.regionalCertificateName,
        regionalCertificateArn: response.regionalCertificateArn,
        distributionDomainName: response.distributionDomainName,
        distributionHostedZoneId: response.distributionHostedZoneId,
        endpointConfiguration: response.endpointConfiguration,
        domainNameStatus: response.domainNameStatus,
        domainNameStatusMessage: response.domainNameStatusMessage,
        securityPolicy: response.securityPolicy,
        tags: response.tags,
        mutualTlsAuthentication: response.mutualTlsAuthentication,
        ownershipVerificationCertificateArn: response.ownershipVerificationCertificateArn,
      };

      return { success: true, data: domainName };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a custom domain for HTTP API
   */
  async createHttpDomain(config: DomainConfig): Promise<APIGatewayOperationResult<DomainNameV2>> {
    try {
      const response = await this.httpClient.send(new CreateDomainNameV2Command({
        DomainName: config.domainName,
        DomainNameConfigurations: [{
          CertificateArn: config.regionalCertificateArn ?? config.certificateArn,
          EndpointType: 'REGIONAL',
          SecurityPolicy: config.securityPolicy ?? 'TLS_1_2',
        }],
        MutualTlsAuthentication: config.mutualTlsAuthentication ? {
          TruststoreUri: config.mutualTlsAuthentication.truststoreUri,
          TruststoreVersion: config.mutualTlsAuthentication.truststoreVersion,
        } : undefined,
        Tags: { ...this.config.defaultTags, ...config.tags },
      }));

      const domainName: DomainNameV2 = {
        DomainName: response.DomainName ?? config.domainName,
        ApiMappingSelectionExpression: response.ApiMappingSelectionExpression,
        DomainNameConfigurations: response.DomainNameConfigurations,
        MutualTlsAuthentication: response.MutualTlsAuthentication,
        Tags: response.Tags,
      };

      return { success: true, data: domainName };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a base path mapping (REST API)
   */
  async createBasePathMapping(config: BasePathMappingConfig): Promise<APIGatewayOperationResult<BasePathMapping>> {
    try {
      if (!config.restApiId) {
        return { success: false, error: 'restApiId is required for base path mapping' };
      }

      const response = await this.restClient.send(new CreateBasePathMappingCommand({
        domainName: config.domainName,
        restApiId: config.restApiId,
        basePath: config.basePath,
        stage: config.stage,
      }));

      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create an API mapping (HTTP API)
   */
  async createApiMapping(config: BasePathMappingConfig): Promise<APIGatewayOperationResult<ApiMapping>> {
    try {
      if (!config.apiId) {
        return { success: false, error: 'apiId is required for API mapping' };
      }

      const response = await this.httpClient.send(new CreateApiMappingCommand({
        DomainName: config.domainName,
        ApiId: config.apiId,
        ApiMappingKey: config.basePath,
        Stage: config.stage ?? '$default',
      }));

      const apiMapping: ApiMapping = {
        ApiId: response.ApiId!,
        ApiMappingId: response.ApiMappingId,
        ApiMappingKey: response.ApiMappingKey,
        Stage: response.Stage,
      };

      return { success: true, data: apiMapping };
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
   * Get API metrics summary
   */
  async getApiMetrics(apiId: string, apiType: APIType): Promise<APIGatewayOperationResult<ApiMetrics>> {
    try {
      if (apiType === 'REST') {
        const [apiResult, resourcesResult, stagesResult, authorizersResult, deploymentsResult] = await Promise.all([
          this.getRestApi(apiId),
          this.listResources(apiId),
          this.listRestStages(apiId),
          this.listRestAuthorizers(apiId),
          this.restClient.send(new GetDeploymentsCommand({ restApiId: apiId })),
        ]);

        if (!apiResult.success || !apiResult.data) {
          return { success: false, error: apiResult.error ?? 'Failed to get API' };
        }

        const api = apiResult.data;
        const resources = resourcesResult.data ?? [];
        const methodCount = resources.reduce((count, r) => count + Object.keys(r.resourceMethods ?? {}).length, 0);

        const tags: Record<string, string> = {};
        if (api.tags) {
          for (const [key, value] of Object.entries(api.tags)) {
            tags[key] = value ?? '';
          }
        }

        return {
          success: true,
          data: {
            apiId: api.id!,
            apiName: api.name!,
            apiType: 'REST',
            endpointType: api.endpointConfiguration?.types?.[0],
            createdDate: api.createdDate,
            stages: (stagesResult.data ?? []).map(s => s.stageName!),
            resources: resources.length,
            methods: methodCount,
            authorizers: (authorizersResult.data ?? []).length,
            deployments: (deploymentsResult.items ?? []).length,
            tags,
          },
        };
      } else {
        const [apiResult, routesResult, stagesResult, authorizersResult, deploymentsResult] = await Promise.all([
          this.getHttpApi(apiId),
          this.listRoutes(apiId),
          this.listHttpStages(apiId),
          this.listHttpAuthorizers(apiId),
          this.httpClient.send(new GetDeploymentsV2Command({ ApiId: apiId })),
        ]);

        if (!apiResult.success || !apiResult.data) {
          return { success: false, error: apiResult.error ?? 'Failed to get API' };
        }

        const api = apiResult.data;

        return {
          success: true,
          data: {
            apiId: api.ApiId!,
            apiName: api.Name!,
            apiType: api.ProtocolType === 'WEBSOCKET' ? 'WEBSOCKET' : 'HTTP',
            protocol: api.ProtocolType,
            createdDate: api.CreatedDate,
            stages: (stagesResult.data ?? []).map(s => s.StageName!),
            routes: (routesResult.data ?? []).length,
            authorizers: (authorizersResult.data ?? []).length,
            deployments: (deploymentsResult.Items ?? []).length,
            tags: api.Tags ?? {},
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get invoke URL for an API stage
   */
  getInvokeUrl(apiId: string, stageName: string, apiType: APIType = 'REST'): string {
    const region = this.config.region ?? 'us-east-1';
    
    if (apiType === 'REST') {
      return `https://${apiId}.execute-api.${region}.amazonaws.com/${stageName}`;
    } else {
      if (stageName === '$default') {
        return `https://${apiId}.execute-api.${region}.amazonaws.com`;
      }
      return `https://${apiId}.execute-api.${region}.amazonaws.com/${stageName}`;
    }
  }

  /**
   * Flush stage cache (REST API)
   */
  async flushStageCache(restApiId: string, stageName: string): Promise<APIGatewayOperationResult<void>> {
    try {
      await this.restClient.send(new FlushStageCacheCommand({
        restApiId,
        stageName,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createAPIGatewayManager(config?: APIGatewayManagerConfig): APIGatewayManager {
  return new APIGatewayManager(config);
}

// ============================================================================
// Tool Definitions for Agent Integration
// ============================================================================

export const apiGatewayToolDefinitions = {
  apigw_create_rest_api: {
    name: 'apigw_create_rest_api',
    description: 'Create a new REST API in API Gateway',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the API' },
        description: { type: 'string', description: 'Description of the API' },
        endpointType: { type: 'string', enum: ['EDGE', 'REGIONAL', 'PRIVATE'], description: 'Endpoint type' },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  apigw_create_http_api: {
    name: 'apigw_create_http_api',
    description: 'Create a new HTTP API (API Gateway v2) with optional CORS configuration',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the API' },
        description: { type: 'string', description: 'Description of the API' },
        corsEnabled: { type: 'boolean', description: 'Enable CORS with permissive defaults' },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  apigw_list_apis: {
    name: 'apigw_list_apis',
    description: 'List all APIs (REST, HTTP, and WebSocket)',
    parameters: {
      type: 'object',
      properties: {
        apiType: { type: 'string', enum: ['REST', 'HTTP', 'ALL'], description: 'Filter by API type' },
      },
    },
  },
  apigw_create_lambda_integration: {
    name: 'apigw_create_lambda_integration',
    description: 'Create a Lambda proxy integration for an API',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'API ID' },
        apiType: { type: 'string', enum: ['REST', 'HTTP'], description: 'API type' },
        lambdaArn: { type: 'string', description: 'ARN of the Lambda function' },
        routeKey: { type: 'string', description: 'Route key (e.g., "GET /items" or "$default")' },
      },
      required: ['apiId', 'apiType', 'lambdaArn'],
    },
  },
  apigw_deploy: {
    name: 'apigw_deploy',
    description: 'Deploy an API to a stage',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'API ID' },
        apiType: { type: 'string', enum: ['REST', 'HTTP'], description: 'API type' },
        stageName: { type: 'string', description: 'Stage name (e.g., "prod", "dev")' },
        description: { type: 'string', description: 'Deployment description' },
      },
      required: ['apiId', 'apiType', 'stageName'],
    },
  },
  apigw_create_authorizer: {
    name: 'apigw_create_authorizer',
    description: 'Create an authorizer for an API',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'API ID' },
        apiType: { type: 'string', enum: ['REST', 'HTTP'], description: 'API type' },
        name: { type: 'string', description: 'Authorizer name' },
        type: { type: 'string', enum: ['TOKEN', 'REQUEST', 'COGNITO_USER_POOLS', 'JWT'], description: 'Authorizer type' },
        lambdaArn: { type: 'string', description: 'Lambda authorizer ARN (for TOKEN/REQUEST)' },
        cognitoUserPoolArns: { type: 'array', items: { type: 'string' }, description: 'Cognito user pool ARNs' },
        jwtIssuer: { type: 'string', description: 'JWT issuer URL (for JWT type)' },
        jwtAudience: { type: 'array', items: { type: 'string' }, description: 'JWT audience (for JWT type)' },
      },
      required: ['apiId', 'apiType', 'name', 'type'],
    },
  },
  apigw_import_openapi: {
    name: 'apigw_import_openapi',
    description: 'Import an API from OpenAPI/Swagger specification',
    parameters: {
      type: 'object',
      properties: {
        apiType: { type: 'string', enum: ['REST', 'HTTP'], description: 'API type to create' },
        specification: { type: 'string', description: 'OpenAPI specification (JSON or YAML string)' },
        failOnWarnings: { type: 'boolean', description: 'Fail import on warnings' },
      },
      required: ['apiType', 'specification'],
    },
  },
  apigw_export_openapi: {
    name: 'apigw_export_openapi',
    description: 'Export an API to OpenAPI specification',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'API ID' },
        apiType: { type: 'string', enum: ['REST', 'HTTP'], description: 'API type' },
        stageName: { type: 'string', description: 'Stage name to export' },
        format: { type: 'string', enum: ['json', 'yaml'], description: 'Output format' },
      },
      required: ['apiId', 'apiType'],
    },
  },
};
