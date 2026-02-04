/**
 * Amazon Cognito Manager - User Authentication & Identity
 * 
 * Comprehensive Cognito operations with:
 * - User Pool management
 * - Identity Pool management
 * - User operations (create, update, delete, groups)
 * - App client configuration
 * - Custom authentication flows
 * - MFA configuration
 * - Social identity providers
 * - Custom domains
 * - Lambda triggers
 */

import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  DeleteUserPoolCommand,
  DescribeUserPoolCommand,
  ListUserPoolsCommand,
  UpdateUserPoolCommand,
  CreateUserPoolClientCommand,
  DeleteUserPoolClientCommand,
  DescribeUserPoolClientCommand,
  ListUserPoolClientsCommand,
  UpdateUserPoolClientCommand,
  CreateGroupCommand,
  DeleteGroupCommand,
  GetGroupCommand,
  ListGroupsCommand,
  UpdateGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminResetUserPasswordCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
  CreateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
  DescribeIdentityProviderCommand,
  ListIdentityProvidersCommand,
  UpdateIdentityProviderCommand,
  CreateUserPoolDomainCommand,
  DeleteUserPoolDomainCommand,
  DescribeUserPoolDomainCommand,
  UpdateUserPoolDomainCommand,
  SetUserPoolMfaConfigCommand,
  GetUserPoolMfaConfigCommand,
  CreateResourceServerCommand,
  DeleteResourceServerCommand,
  DescribeResourceServerCommand,
  ListResourceServersCommand,
  UpdateResourceServerCommand,
  AdminSetUserMFAPreferenceCommand,
  AdminUserGlobalSignOutCommand,
  AddCustomAttributesCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
  type UserPoolType,
  type UserPoolClientType,
  type GroupType,
  type UserType,
  type IdentityProviderType,
  type DomainDescriptionType,
  type ResourceServerType,
  type SchemaAttributeType,
  type LambdaConfigType,
  type UserPoolMfaType,
  type MFAOptionType,
  type VerificationMessageTemplateType,
  type AdminCreateUserConfigType,
  type DeviceConfigurationType,
  type EmailConfigurationType,
  type SmsConfigurationType,
  type UserPoolAddOnsType,
  type AccountRecoverySettingType,
  type UsernameConfigurationType,
} from '@aws-sdk/client-cognito-identity-provider';

import {
  CognitoIdentityClient,
  CreateIdentityPoolCommand,
  DeleteIdentityPoolCommand,
  DescribeIdentityPoolCommand,
  ListIdentityPoolsCommand,
  UpdateIdentityPoolCommand,
  SetIdentityPoolRolesCommand,
  GetIdentityPoolRolesCommand,
  type IdentityPoolShortDescription,
  type CognitoIdentityProvider as IdentityPoolCognitoProvider,
} from '@aws-sdk/client-cognito-identity';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CognitoManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
  defaultTags?: Record<string, string>;
}

export interface CreateUserPoolConfig {
  poolName: string;
  /** Username attributes */
  usernameAttributes?: ('email' | 'phone_number')[];
  /** Alias attributes */
  aliasAttributes?: ('email' | 'phone_number' | 'preferred_username')[];
  /** Auto-verified attributes */
  autoVerifiedAttributes?: ('email' | 'phone_number')[];
  /** Password policy */
  passwordPolicy?: {
    minimumLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumbers?: boolean;
    requireSymbols?: boolean;
    temporaryPasswordValidityDays?: number;
  };
  /** MFA configuration */
  mfaConfiguration?: 'OFF' | 'ON' | 'OPTIONAL';
  /** Software token MFA */
  softwareTokenMfaEnabled?: boolean;
  /** SMS MFA */
  smsMfaEnabled?: boolean;
  /** Email configuration */
  emailConfiguration?: {
    sourceArn?: string;
    replyToEmailAddress?: string;
    emailSendingAccount?: 'COGNITO_DEFAULT' | 'DEVELOPER';
    from?: string;
    configurationSet?: string;
  };
  /** SMS configuration */
  smsConfiguration?: {
    snsCallerArn: string;
    externalId?: string;
    snsRegion?: string;
  };
  /** Account recovery options */
  accountRecoverySetting?: {
    recoveryMechanisms: { priority: number; name: 'verified_email' | 'verified_phone_number' | 'admin_only' }[];
  };
  /** User attribute schema */
  schema?: {
    name: string;
    attributeDataType: 'String' | 'Number' | 'DateTime' | 'Boolean';
    mutable?: boolean;
    required?: boolean;
    stringConstraints?: {
      minLength?: number;
      maxLength?: number;
    };
    numberConstraints?: {
      minValue?: number;
      maxValue?: number;
    };
  }[];
  /** Lambda triggers */
  lambdaConfig?: {
    preSignUp?: string;
    customMessage?: string;
    postConfirmation?: string;
    preAuthentication?: string;
    postAuthentication?: string;
    defineAuthChallenge?: string;
    createAuthChallenge?: string;
    verifyAuthChallengeResponse?: string;
    preTokenGeneration?: string;
    userMigration?: string;
    customSMSSender?: { lambdaArn: string; lambdaVersion: string };
    customEmailSender?: { lambdaArn: string; lambdaVersion: string };
    kmsKeyId?: string;
  };
  /** Advanced security */
  userPoolAddOns?: {
    advancedSecurityMode: 'OFF' | 'AUDIT' | 'ENFORCED';
  };
  /** Case sensitivity */
  usernameConfiguration?: {
    caseSensitive: boolean;
  };
  /** Deletion protection */
  deletionProtection?: 'ACTIVE' | 'INACTIVE';
  tags?: Record<string, string>;
}

export interface CreateAppClientConfig {
  userPoolId: string;
  clientName: string;
  generateSecret?: boolean;
  refreshTokenValidity?: number; // days
  accessTokenValidity?: number; // hours
  idTokenValidity?: number; // hours
  tokenValidityUnits?: {
    refreshToken?: 'seconds' | 'minutes' | 'hours' | 'days';
    accessToken?: 'seconds' | 'minutes' | 'hours' | 'days';
    idToken?: 'seconds' | 'minutes' | 'hours' | 'days';
  };
  /** Supported auth flows */
  explicitAuthFlows?: (
    | 'ALLOW_ADMIN_USER_PASSWORD_AUTH'
    | 'ALLOW_CUSTOM_AUTH'
    | 'ALLOW_USER_PASSWORD_AUTH'
    | 'ALLOW_USER_SRP_AUTH'
    | 'ALLOW_REFRESH_TOKEN_AUTH'
  )[];
  /** OAuth configuration */
  supportedIdentityProviders?: string[];
  callbackURLs?: string[];
  logoutURLs?: string[];
  defaultRedirectURI?: string;
  allowedOAuthFlows?: ('code' | 'implicit' | 'client_credentials')[];
  allowedOAuthScopes?: string[];
  allowedOAuthFlowsUserPoolClient?: boolean;
  /** Security settings */
  preventUserExistenceErrors?: 'LEGACY' | 'ENABLED';
  enableTokenRevocation?: boolean;
  enablePropagateAdditionalUserContextData?: boolean;
  authSessionValidity?: number; // minutes, 3-15
  /** Read/Write attributes */
  readAttributes?: string[];
  writeAttributes?: string[];
}

export interface CreateGroupConfig {
  userPoolId: string;
  groupName: string;
  description?: string;
  precedence?: number;
  roleArn?: string;
}

export interface CreateUserConfig {
  userPoolId: string;
  username: string;
  temporaryPassword?: string;
  userAttributes?: { name: string; value: string }[];
  messageAction?: 'RESEND' | 'SUPPRESS';
  forceAliasCreation?: boolean;
  desiredDeliveryMediums?: ('SMS' | 'EMAIL')[];
}

export interface CreateIdentityProviderConfig {
  userPoolId: string;
  providerName: string;
  providerType: 'SAML' | 'Facebook' | 'Google' | 'LoginWithAmazon' | 'SignInWithApple' | 'OIDC';
  providerDetails: Record<string, string>;
  attributeMapping?: Record<string, string>;
  idpIdentifiers?: string[];
}

export interface CreateIdentityPoolConfig {
  identityPoolName: string;
  allowUnauthenticatedIdentities?: boolean;
  allowClassicFlow?: boolean;
  cognitoIdentityProviders?: {
    providerName: string; // e.g., cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx
    clientId: string;
    serverSideTokenCheck?: boolean;
  }[];
  supportedLoginProviders?: Record<string, string>;
  samlProviderARNs?: string[];
  openIdConnectProviderARNs?: string[];
  identityPoolTags?: Record<string, string>;
}

export interface IdentityPoolRolesConfig {
  identityPoolId: string;
  authenticatedRoleArn: string;
  unauthenticatedRoleArn?: string;
  roleMappings?: Record<string, {
    type: 'Token' | 'Rules';
    ambiguousRoleResolution?: 'AuthenticatedRole' | 'Deny';
    rulesConfiguration?: {
      rules: {
        claim: string;
        matchType: 'Equals' | 'Contains' | 'StartsWith' | 'NotEqual';
        value: string;
        roleARN: string;
      }[];
    };
  }>;
}

export interface UserPoolMetrics {
  userPoolId: string;
  userPoolName: string;
  status: string;
  creationDate: Date;
  lastModifiedDate: Date;
  estimatedNumberOfUsers: number;
  mfaConfiguration: string;
  usernameAttributes?: string[];
  autoVerifiedAttributes?: string[];
  emailConfigurationFailure?: string;
  smsConfigurationFailure?: string;
  domain?: string;
  customDomain?: string;
  lambdaTriggers: string[];
  appClientCount: number;
  groupCount: number;
  identityProviderCount: number;
  tags: Record<string, string>;
}

export interface CognitoOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Cognito Manager Implementation
// ============================================================================

export class CognitoManager {
  private userPoolClient: CognitoIdentityProviderClient;
  private identityClient: CognitoIdentityClient;
  private config: CognitoManagerConfig;

  constructor(config: CognitoManagerConfig = {}) {
    this.config = config;
    
    this.userPoolClient = new CognitoIdentityProviderClient({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });

    this.identityClient = new CognitoIdentityClient({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });
  }

  // ==========================================================================
  // User Pool Operations
  // ==========================================================================

  /**
   * Create a new user pool
   */
  async createUserPool(config: CreateUserPoolConfig): Promise<CognitoOperationResult<UserPoolType>> {
    try {
      const lambdaConfig: LambdaConfigType | undefined = config.lambdaConfig ? {
        PreSignUp: config.lambdaConfig.preSignUp,
        CustomMessage: config.lambdaConfig.customMessage,
        PostConfirmation: config.lambdaConfig.postConfirmation,
        PreAuthentication: config.lambdaConfig.preAuthentication,
        PostAuthentication: config.lambdaConfig.postAuthentication,
        DefineAuthChallenge: config.lambdaConfig.defineAuthChallenge,
        CreateAuthChallenge: config.lambdaConfig.createAuthChallenge,
        VerifyAuthChallengeResponse: config.lambdaConfig.verifyAuthChallengeResponse,
        PreTokenGeneration: config.lambdaConfig.preTokenGeneration,
        UserMigration: config.lambdaConfig.userMigration,
        CustomSMSSender: config.lambdaConfig.customSMSSender ? {
          LambdaArn: config.lambdaConfig.customSMSSender.lambdaArn,
          LambdaVersion: config.lambdaConfig.customSMSSender.lambdaVersion as 'V1_0',
        } : undefined,
        CustomEmailSender: config.lambdaConfig.customEmailSender ? {
          LambdaArn: config.lambdaConfig.customEmailSender.lambdaArn,
          LambdaVersion: config.lambdaConfig.customEmailSender.lambdaVersion as 'V1_0',
        } : undefined,
        KMSKeyID: config.lambdaConfig.kmsKeyId,
      } : undefined;

      const schema: SchemaAttributeType[] | undefined = config.schema?.map(attr => ({
        Name: attr.name,
        AttributeDataType: attr.attributeDataType,
        Mutable: attr.mutable,
        Required: attr.required,
        StringAttributeConstraints: attr.stringConstraints ? {
          MinLength: attr.stringConstraints.minLength?.toString(),
          MaxLength: attr.stringConstraints.maxLength?.toString(),
        } : undefined,
        NumberAttributeConstraints: attr.numberConstraints ? {
          MinValue: attr.numberConstraints.minValue?.toString(),
          MaxValue: attr.numberConstraints.maxValue?.toString(),
        } : undefined,
      }));

      const response = await this.userPoolClient.send(new CreateUserPoolCommand({
        PoolName: config.poolName,
        UsernameAttributes: config.usernameAttributes,
        AliasAttributes: config.aliasAttributes,
        AutoVerifiedAttributes: config.autoVerifiedAttributes,
        Policies: config.passwordPolicy ? {
          PasswordPolicy: {
            MinimumLength: config.passwordPolicy.minimumLength,
            RequireUppercase: config.passwordPolicy.requireUppercase,
            RequireLowercase: config.passwordPolicy.requireLowercase,
            RequireNumbers: config.passwordPolicy.requireNumbers,
            RequireSymbols: config.passwordPolicy.requireSymbols,
            TemporaryPasswordValidityDays: config.passwordPolicy.temporaryPasswordValidityDays,
          },
        } : undefined,
        MfaConfiguration: config.mfaConfiguration,
        EmailConfiguration: config.emailConfiguration ? {
          SourceArn: config.emailConfiguration.sourceArn,
          ReplyToEmailAddress: config.emailConfiguration.replyToEmailAddress,
          EmailSendingAccount: config.emailConfiguration.emailSendingAccount,
          From: config.emailConfiguration.from,
          ConfigurationSet: config.emailConfiguration.configurationSet,
        } : undefined,
        SmsConfiguration: config.smsConfiguration ? {
          SnsCallerArn: config.smsConfiguration.snsCallerArn,
          ExternalId: config.smsConfiguration.externalId,
          SnsRegion: config.smsConfiguration.snsRegion,
        } : undefined,
        AccountRecoverySetting: config.accountRecoverySetting ? {
          RecoveryMechanisms: config.accountRecoverySetting.recoveryMechanisms.map(rm => ({
            Priority: rm.priority,
            Name: rm.name,
          })),
        } : undefined,
        Schema: schema,
        LambdaConfig: lambdaConfig,
        UserPoolAddOns: config.userPoolAddOns ? {
          AdvancedSecurityMode: config.userPoolAddOns.advancedSecurityMode,
        } : undefined,
        UsernameConfiguration: config.usernameConfiguration ? {
          CaseSensitive: config.usernameConfiguration.caseSensitive,
        } : undefined,
        DeletionProtection: config.deletionProtection,
        UserPoolTags: { ...this.config.defaultTags, ...config.tags },
      }));

      // Configure MFA if specified
      if (config.mfaConfiguration && config.mfaConfiguration !== 'OFF') {
        await this.userPoolClient.send(new SetUserPoolMfaConfigCommand({
          UserPoolId: response.UserPool?.Id,
          MfaConfiguration: config.mfaConfiguration,
          SoftwareTokenMfaConfiguration: config.softwareTokenMfaEnabled ? {
            Enabled: true,
          } : undefined,
          SmsMfaConfiguration: config.smsMfaEnabled && config.smsConfiguration ? {
            SmsAuthenticationMessage: 'Your verification code is {####}',
            SmsConfiguration: {
              SnsCallerArn: config.smsConfiguration.snsCallerArn,
              ExternalId: config.smsConfiguration.externalId,
              SnsRegion: config.smsConfiguration.snsRegion,
            },
          } : undefined,
        }));
      }

      return { success: true, data: response.UserPool };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a user pool
   */
  async deleteUserPool(userPoolId: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new DeleteUserPoolCommand({
        UserPoolId: userPoolId,
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
   * Get user pool details
   */
  async getUserPool(userPoolId: string): Promise<CognitoOperationResult<UserPoolMetrics>> {
    try {
      const [poolResponse, clientsResponse, groupsResponse, providersResponse, tagsResponse] = await Promise.all([
        this.userPoolClient.send(new DescribeUserPoolCommand({ UserPoolId: userPoolId })),
        this.userPoolClient.send(new ListUserPoolClientsCommand({ UserPoolId: userPoolId, MaxResults: 60 })),
        this.userPoolClient.send(new ListGroupsCommand({ UserPoolId: userPoolId })),
        this.userPoolClient.send(new ListIdentityProvidersCommand({ UserPoolId: userPoolId })),
        this.userPoolClient.send(new ListTagsForResourceCommand({ ResourceArn: `arn:aws:cognito-idp:${this.config.region}:*:userpool/${userPoolId}` })).catch(() => ({ Tags: {} })),
      ]);

      const pool = poolResponse.UserPool!;
      const lambdaTriggers: string[] = [];
      if (pool.LambdaConfig) {
        if (pool.LambdaConfig.PreSignUp) lambdaTriggers.push('PreSignUp');
        if (pool.LambdaConfig.CustomMessage) lambdaTriggers.push('CustomMessage');
        if (pool.LambdaConfig.PostConfirmation) lambdaTriggers.push('PostConfirmation');
        if (pool.LambdaConfig.PreAuthentication) lambdaTriggers.push('PreAuthentication');
        if (pool.LambdaConfig.PostAuthentication) lambdaTriggers.push('PostAuthentication');
        if (pool.LambdaConfig.DefineAuthChallenge) lambdaTriggers.push('DefineAuthChallenge');
        if (pool.LambdaConfig.CreateAuthChallenge) lambdaTriggers.push('CreateAuthChallenge');
        if (pool.LambdaConfig.VerifyAuthChallengeResponse) lambdaTriggers.push('VerifyAuthChallengeResponse');
        if (pool.LambdaConfig.PreTokenGeneration) lambdaTriggers.push('PreTokenGeneration');
        if (pool.LambdaConfig.UserMigration) lambdaTriggers.push('UserMigration');
      }

      const metrics: UserPoolMetrics = {
        userPoolId: pool.Id!,
        userPoolName: pool.Name!,
        status: pool.Status ?? 'ACTIVE',
        creationDate: pool.CreationDate!,
        lastModifiedDate: pool.LastModifiedDate!,
        estimatedNumberOfUsers: pool.EstimatedNumberOfUsers ?? 0,
        mfaConfiguration: pool.MfaConfiguration ?? 'OFF',
        usernameAttributes: pool.UsernameAttributes,
        autoVerifiedAttributes: pool.AutoVerifiedAttributes,
        emailConfigurationFailure: pool.EmailConfigurationFailure,
        smsConfigurationFailure: pool.SmsConfigurationFailure,
        domain: pool.Domain,
        customDomain: pool.CustomDomain,
        lambdaTriggers,
        appClientCount: clientsResponse.UserPoolClients?.length ?? 0,
        groupCount: groupsResponse.Groups?.length ?? 0,
        identityProviderCount: providersResponse.Providers?.length ?? 0,
        tags: tagsResponse.Tags ?? {},
      };

      return { success: true, data: metrics };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all user pools
   */
  async listUserPools(maxResults?: number): Promise<CognitoOperationResult<UserPoolType[]>> {
    try {
      const pools: UserPoolType[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.userPoolClient.send(new ListUserPoolsCommand({
          MaxResults: maxResults ? Math.min(maxResults - pools.length, 60) : 60,
          NextToken: nextToken,
        }));

        // Get full details for each pool
        for (const pool of response.UserPools ?? []) {
          const details = await this.userPoolClient.send(new DescribeUserPoolCommand({
            UserPoolId: pool.Id,
          }));
          if (details.UserPool) {
            pools.push(details.UserPool);
          }
        }

        nextToken = response.NextToken;

        if (maxResults && pools.length >= maxResults) break;
      } while (nextToken);

      return { success: true, data: pools };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // App Client Operations
  // ==========================================================================

  /**
   * Create an app client
   */
  async createAppClient(config: CreateAppClientConfig): Promise<CognitoOperationResult<UserPoolClientType>> {
    try {
      const response = await this.userPoolClient.send(new CreateUserPoolClientCommand({
        UserPoolId: config.userPoolId,
        ClientName: config.clientName,
        GenerateSecret: config.generateSecret,
        RefreshTokenValidity: config.refreshTokenValidity,
        AccessTokenValidity: config.accessTokenValidity,
        IdTokenValidity: config.idTokenValidity,
        TokenValidityUnits: config.tokenValidityUnits ? {
          RefreshToken: config.tokenValidityUnits.refreshToken,
          AccessToken: config.tokenValidityUnits.accessToken,
          IdToken: config.tokenValidityUnits.idToken,
        } : undefined,
        ExplicitAuthFlows: config.explicitAuthFlows,
        SupportedIdentityProviders: config.supportedIdentityProviders,
        CallbackURLs: config.callbackURLs,
        LogoutURLs: config.logoutURLs,
        DefaultRedirectURI: config.defaultRedirectURI,
        AllowedOAuthFlows: config.allowedOAuthFlows,
        AllowedOAuthScopes: config.allowedOAuthScopes,
        AllowedOAuthFlowsUserPoolClient: config.allowedOAuthFlowsUserPoolClient,
        PreventUserExistenceErrors: config.preventUserExistenceErrors,
        EnableTokenRevocation: config.enableTokenRevocation,
        EnablePropagateAdditionalUserContextData: config.enablePropagateAdditionalUserContextData,
        AuthSessionValidity: config.authSessionValidity,
        ReadAttributes: config.readAttributes,
        WriteAttributes: config.writeAttributes,
      }));

      return { success: true, data: response.UserPoolClient };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an app client
   */
  async deleteAppClient(userPoolId: string, clientId: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new DeleteUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
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
   * List app clients
   */
  async listAppClients(userPoolId: string): Promise<CognitoOperationResult<UserPoolClientType[]>> {
    try {
      const clients: UserPoolClientType[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.userPoolClient.send(new ListUserPoolClientsCommand({
          UserPoolId: userPoolId,
          MaxResults: 60,
          NextToken: nextToken,
        }));

        // Get full details for each client
        for (const client of response.UserPoolClients ?? []) {
          const details = await this.userPoolClient.send(new DescribeUserPoolClientCommand({
            UserPoolId: userPoolId,
            ClientId: client.ClientId,
          }));
          if (details.UserPoolClient) {
            clients.push(details.UserPoolClient);
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: clients };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // User Operations
  // ==========================================================================

  /**
   * Create a user (admin)
   */
  async createUser(config: CreateUserConfig): Promise<CognitoOperationResult<UserType>> {
    try {
      const response = await this.userPoolClient.send(new AdminCreateUserCommand({
        UserPoolId: config.userPoolId,
        Username: config.username,
        TemporaryPassword: config.temporaryPassword,
        UserAttributes: config.userAttributes?.map(attr => ({
          Name: attr.name,
          Value: attr.value,
        })),
        MessageAction: config.messageAction,
        ForceAliasCreation: config.forceAliasCreation,
        DesiredDeliveryMediums: config.desiredDeliveryMediums,
      }));

      return { success: true, data: response.User };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a user (admin)
   */
  async deleteUser(userPoolId: string, username: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: username,
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
   * Get user details (admin)
   */
  async getUser(userPoolId: string, username: string): Promise<CognitoOperationResult<{
    username: string;
    attributes: Record<string, string>;
    userCreateDate: Date;
    userLastModifiedDate: Date;
    enabled: boolean;
    userStatus: string;
    mfaOptions?: MFAOptionType[];
  }>> {
    try {
      const response = await this.userPoolClient.send(new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }));

      const attributes: Record<string, string> = {};
      for (const attr of response.UserAttributes ?? []) {
        if (attr.Name && attr.Value) {
          attributes[attr.Name] = attr.Value;
        }
      }

      return {
        success: true,
        data: {
          username: response.Username!,
          attributes,
          userCreateDate: response.UserCreateDate!,
          userLastModifiedDate: response.UserLastModifiedDate!,
          enabled: response.Enabled ?? true,
          userStatus: response.UserStatus ?? 'UNKNOWN',
          mfaOptions: response.MFAOptions,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List users
   */
  async listUsers(
    userPoolId: string,
    options?: {
      filter?: string;
      limit?: number;
      attributesToGet?: string[];
    }
  ): Promise<CognitoOperationResult<UserType[]>> {
    try {
      const users: UserType[] = [];
      let paginationToken: string | undefined;

      do {
        const response = await this.userPoolClient.send(new ListUsersCommand({
          UserPoolId: userPoolId,
          Filter: options?.filter,
          Limit: options?.limit ? Math.min(options.limit - users.length, 60) : 60,
          AttributesToGet: options?.attributesToGet,
          PaginationToken: paginationToken,
        }));

        users.push(...(response.Users ?? []));
        paginationToken = response.PaginationToken;

        if (options?.limit && users.length >= options.limit) break;
      } while (paginationToken);

      return { success: true, data: users };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update user attributes (admin)
   */
  async updateUserAttributes(
    userPoolId: string,
    username: string,
    attributes: { name: string; value: string }[]
  ): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: attributes.map(attr => ({
          Name: attr.name,
          Value: attr.value,
        })),
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
   * Enable a user (admin)
   */
  async enableUser(userPoolId: string, username: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminEnableUserCommand({
        UserPoolId: userPoolId,
        Username: username,
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
   * Disable a user (admin)
   */
  async disableUser(userPoolId: string, username: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminDisableUserCommand({
        UserPoolId: userPoolId,
        Username: username,
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
   * Reset user password (admin)
   */
  async resetUserPassword(userPoolId: string, username: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminResetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
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
   * Set user password (admin)
   */
  async setUserPassword(
    userPoolId: string,
    username: string,
    password: string,
    permanent: boolean = true
  ): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
        Password: password,
        Permanent: permanent,
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
   * Sign out user globally (admin)
   */
  async signOutUser(userPoolId: string, username: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminUserGlobalSignOutCommand({
        UserPoolId: userPoolId,
        Username: username,
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
  // Group Operations
  // ==========================================================================

  /**
   * Create a group
   */
  async createGroup(config: CreateGroupConfig): Promise<CognitoOperationResult<GroupType>> {
    try {
      const response = await this.userPoolClient.send(new CreateGroupCommand({
        UserPoolId: config.userPoolId,
        GroupName: config.groupName,
        Description: config.description,
        Precedence: config.precedence,
        RoleArn: config.roleArn,
      }));

      return { success: true, data: response.Group };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a group
   */
  async deleteGroup(userPoolId: string, groupName: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new DeleteGroupCommand({
        UserPoolId: userPoolId,
        GroupName: groupName,
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
   * List groups
   */
  async listGroups(userPoolId: string): Promise<CognitoOperationResult<GroupType[]>> {
    try {
      const groups: GroupType[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.userPoolClient.send(new ListGroupsCommand({
          UserPoolId: userPoolId,
          Limit: 60,
          NextToken: nextToken,
        }));

        groups.push(...(response.Groups ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: groups };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add user to group
   */
  async addUserToGroup(userPoolId: string, username: string, groupName: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: groupName,
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
   * Remove user from group
   */
  async removeUserFromGroup(userPoolId: string, username: string, groupName: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: groupName,
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
   * List users in a group
   */
  async listUsersInGroup(userPoolId: string, groupName: string): Promise<CognitoOperationResult<UserType[]>> {
    try {
      const users: UserType[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.userPoolClient.send(new ListUsersInGroupCommand({
          UserPoolId: userPoolId,
          GroupName: groupName,
          Limit: 60,
          NextToken: nextToken,
        }));

        users.push(...(response.Users ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: users };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List groups for a user
   */
  async listGroupsForUser(userPoolId: string, username: string): Promise<CognitoOperationResult<GroupType[]>> {
    try {
      const groups: GroupType[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.userPoolClient.send(new AdminListGroupsForUserCommand({
          UserPoolId: userPoolId,
          Username: username,
          Limit: 60,
          NextToken: nextToken,
        }));

        groups.push(...(response.Groups ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: groups };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Identity Provider Operations
  // ==========================================================================

  /**
   * Create an identity provider
   */
  async createIdentityProvider(config: CreateIdentityProviderConfig): Promise<CognitoOperationResult<IdentityProviderType>> {
    try {
      const response = await this.userPoolClient.send(new CreateIdentityProviderCommand({
        UserPoolId: config.userPoolId,
        ProviderName: config.providerName,
        ProviderType: config.providerType,
        ProviderDetails: config.providerDetails,
        AttributeMapping: config.attributeMapping,
        IdpIdentifiers: config.idpIdentifiers,
      }));

      return { success: true, data: response.IdentityProvider };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an identity provider
   */
  async deleteIdentityProvider(userPoolId: string, providerName: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new DeleteIdentityProviderCommand({
        UserPoolId: userPoolId,
        ProviderName: providerName,
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
   * List identity providers
   */
  async listIdentityProviders(userPoolId: string): Promise<CognitoOperationResult<IdentityProviderType[]>> {
    try {
      const providers: IdentityProviderType[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.userPoolClient.send(new ListIdentityProvidersCommand({
          UserPoolId: userPoolId,
          MaxResults: 60,
          NextToken: nextToken,
        }));

        // Get full details for each provider
        for (const provider of response.Providers ?? []) {
          const details = await this.userPoolClient.send(new DescribeIdentityProviderCommand({
            UserPoolId: userPoolId,
            ProviderName: provider.ProviderName,
          }));
          if (details.IdentityProvider) {
            providers.push(details.IdentityProvider);
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: providers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Domain Operations
  // ==========================================================================

  /**
   * Create a user pool domain
   */
  async createDomain(
    userPoolId: string,
    domain: string,
    customDomainConfig?: { certificateArn: string }
  ): Promise<CognitoOperationResult<{ cloudFrontDomain?: string }>> {
    try {
      const response = await this.userPoolClient.send(new CreateUserPoolDomainCommand({
        UserPoolId: userPoolId,
        Domain: domain,
        CustomDomainConfig: customDomainConfig ? {
          CertificateArn: customDomainConfig.certificateArn,
        } : undefined,
      }));

      return {
        success: true,
        data: { cloudFrontDomain: response.CloudFrontDomain },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a user pool domain
   */
  async deleteDomain(userPoolId: string, domain: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.userPoolClient.send(new DeleteUserPoolDomainCommand({
        UserPoolId: userPoolId,
        Domain: domain,
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
   * Get domain details
   */
  async getDomain(domain: string): Promise<CognitoOperationResult<DomainDescriptionType>> {
    try {
      const response = await this.userPoolClient.send(new DescribeUserPoolDomainCommand({
        Domain: domain,
      }));

      return { success: true, data: response.DomainDescription };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Identity Pool Operations
  // ==========================================================================

  /**
   * Create an identity pool
   */
  async createIdentityPool(config: CreateIdentityPoolConfig): Promise<CognitoOperationResult<{
    identityPoolId: string;
    identityPoolName: string;
  }>> {
    try {
      const response = await this.identityClient.send(new CreateIdentityPoolCommand({
        IdentityPoolName: config.identityPoolName,
        AllowUnauthenticatedIdentities: config.allowUnauthenticatedIdentities ?? false,
        AllowClassicFlow: config.allowClassicFlow,
        CognitoIdentityProviders: config.cognitoIdentityProviders?.map(p => ({
          ProviderName: p.providerName,
          ClientId: p.clientId,
          ServerSideTokenCheck: p.serverSideTokenCheck,
        })),
        SupportedLoginProviders: config.supportedLoginProviders,
        SamlProviderARNs: config.samlProviderARNs,
        OpenIdConnectProviderARNs: config.openIdConnectProviderARNs,
        IdentityPoolTags: { ...this.config.defaultTags, ...config.identityPoolTags },
      }));

      return {
        success: true,
        data: {
          identityPoolId: response.IdentityPoolId!,
          identityPoolName: response.IdentityPoolName!,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an identity pool
   */
  async deleteIdentityPool(identityPoolId: string): Promise<CognitoOperationResult<void>> {
    try {
      await this.identityClient.send(new DeleteIdentityPoolCommand({
        IdentityPoolId: identityPoolId,
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
   * List identity pools
   */
  async listIdentityPools(maxResults?: number): Promise<CognitoOperationResult<IdentityPoolShortDescription[]>> {
    try {
      const pools: IdentityPoolShortDescription[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.identityClient.send(new ListIdentityPoolsCommand({
          MaxResults: maxResults ? Math.min(maxResults - pools.length, 60) : 60,
          NextToken: nextToken,
        }));

        pools.push(...(response.IdentityPools ?? []));
        nextToken = response.NextToken;

        if (maxResults && pools.length >= maxResults) break;
      } while (nextToken);

      return { success: true, data: pools };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Set identity pool roles
   */
  async setIdentityPoolRoles(config: IdentityPoolRolesConfig): Promise<CognitoOperationResult<void>> {
    try {
      await this.identityClient.send(new SetIdentityPoolRolesCommand({
        IdentityPoolId: config.identityPoolId,
        Roles: {
          authenticated: config.authenticatedRoleArn,
          ...(config.unauthenticatedRoleArn && { unauthenticated: config.unauthenticatedRoleArn }),
        },
        RoleMappings: config.roleMappings ? Object.fromEntries(
          Object.entries(config.roleMappings).map(([key, value]) => [
            key,
            {
              Type: value.type,
              AmbiguousRoleResolution: value.ambiguousRoleResolution,
              RulesConfiguration: value.rulesConfiguration ? {
                Rules: value.rulesConfiguration.rules.map(rule => ({
                  Claim: rule.claim,
                  MatchType: rule.matchType,
                  Value: rule.value,
                  RoleARN: rule.roleARN,
                })),
              } : undefined,
            },
          ])
        ) : undefined,
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

export function createCognitoManager(config?: CognitoManagerConfig): CognitoManager {
  return new CognitoManager(config);
}

// ============================================================================
// Tool Definitions for Agent Integration
// ============================================================================

export const cognitoToolDefinitions = {
  cognito_create_user_pool: {
    name: 'cognito_create_user_pool',
    description: 'Create a new Cognito User Pool for user authentication',
    parameters: {
      type: 'object',
      properties: {
        poolName: { type: 'string', description: 'Name of the user pool' },
        usernameAttributes: { type: 'array', items: { type: 'string', enum: ['email', 'phone_number'] }, description: 'Attributes for username' },
        autoVerifiedAttributes: { type: 'array', items: { type: 'string', enum: ['email', 'phone_number'] }, description: 'Auto-verified attributes' },
        mfaConfiguration: { type: 'string', enum: ['OFF', 'ON', 'OPTIONAL'], description: 'MFA configuration' },
        passwordMinLength: { type: 'number', description: 'Minimum password length' },
        passwordRequireUppercase: { type: 'boolean', description: 'Require uppercase letters' },
        passwordRequireNumbers: { type: 'boolean', description: 'Require numbers' },
        passwordRequireSymbols: { type: 'boolean', description: 'Require symbols' },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['poolName'],
    },
  },
  cognito_list_user_pools: {
    name: 'cognito_list_user_pools',
    description: 'List all Cognito User Pools',
    parameters: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Maximum number of pools to return' },
      },
    },
  },
  cognito_create_app_client: {
    name: 'cognito_create_app_client',
    description: 'Create an app client for a Cognito User Pool',
    parameters: {
      type: 'object',
      properties: {
        userPoolId: { type: 'string', description: 'User Pool ID' },
        clientName: { type: 'string', description: 'Name of the app client' },
        generateSecret: { type: 'boolean', description: 'Generate a client secret' },
        callbackURLs: { type: 'array', items: { type: 'string' }, description: 'OAuth callback URLs' },
        logoutURLs: { type: 'array', items: { type: 'string' }, description: 'OAuth logout URLs' },
        allowedOAuthFlows: { type: 'array', items: { type: 'string', enum: ['code', 'implicit', 'client_credentials'] }, description: 'Allowed OAuth flows' },
        allowedOAuthScopes: { type: 'array', items: { type: 'string' }, description: 'Allowed OAuth scopes' },
      },
      required: ['userPoolId', 'clientName'],
    },
  },
  cognito_create_user: {
    name: 'cognito_create_user',
    description: 'Create a new user in a Cognito User Pool',
    parameters: {
      type: 'object',
      properties: {
        userPoolId: { type: 'string', description: 'User Pool ID' },
        username: { type: 'string', description: 'Username' },
        email: { type: 'string', description: 'Email address' },
        temporaryPassword: { type: 'string', description: 'Temporary password' },
        sendInvitation: { type: 'boolean', description: 'Send invitation email/SMS' },
      },
      required: ['userPoolId', 'username'],
    },
  },
  cognito_list_users: {
    name: 'cognito_list_users',
    description: 'List users in a Cognito User Pool',
    parameters: {
      type: 'object',
      properties: {
        userPoolId: { type: 'string', description: 'User Pool ID' },
        filter: { type: 'string', description: 'Filter expression (e.g., "email ^= \"test\"")' },
        limit: { type: 'number', description: 'Maximum number of users to return' },
      },
      required: ['userPoolId'],
    },
  },
  cognito_create_group: {
    name: 'cognito_create_group',
    description: 'Create a group in a Cognito User Pool',
    parameters: {
      type: 'object',
      properties: {
        userPoolId: { type: 'string', description: 'User Pool ID' },
        groupName: { type: 'string', description: 'Name of the group' },
        description: { type: 'string', description: 'Group description' },
        precedence: { type: 'number', description: 'Group precedence (lower = higher priority)' },
        roleArn: { type: 'string', description: 'IAM role ARN for the group' },
      },
      required: ['userPoolId', 'groupName'],
    },
  },
  cognito_add_user_to_group: {
    name: 'cognito_add_user_to_group',
    description: 'Add a user to a group',
    parameters: {
      type: 'object',
      properties: {
        userPoolId: { type: 'string', description: 'User Pool ID' },
        username: { type: 'string', description: 'Username' },
        groupName: { type: 'string', description: 'Group name' },
      },
      required: ['userPoolId', 'username', 'groupName'],
    },
  },
  cognito_configure_identity_provider: {
    name: 'cognito_configure_identity_provider',
    description: 'Configure a social identity provider (Google, Facebook, Apple, etc.)',
    parameters: {
      type: 'object',
      properties: {
        userPoolId: { type: 'string', description: 'User Pool ID' },
        providerName: { type: 'string', description: 'Provider name' },
        providerType: { type: 'string', enum: ['Google', 'Facebook', 'LoginWithAmazon', 'SignInWithApple', 'OIDC', 'SAML'], description: 'Provider type' },
        clientId: { type: 'string', description: 'OAuth client ID' },
        clientSecret: { type: 'string', description: 'OAuth client secret' },
        authorizeScopes: { type: 'string', description: 'OAuth scopes' },
      },
      required: ['userPoolId', 'providerName', 'providerType'],
    },
  },
  cognito_create_domain: {
    name: 'cognito_create_domain',
    description: 'Create a domain for hosted UI',
    parameters: {
      type: 'object',
      properties: {
        userPoolId: { type: 'string', description: 'User Pool ID' },
        domain: { type: 'string', description: 'Domain prefix (or full custom domain)' },
        certificateArn: { type: 'string', description: 'ACM certificate ARN (for custom domains)' },
      },
      required: ['userPoolId', 'domain'],
    },
  },
  cognito_create_identity_pool: {
    name: 'cognito_create_identity_pool',
    description: 'Create a Cognito Identity Pool for federated identities',
    parameters: {
      type: 'object',
      properties: {
        identityPoolName: { type: 'string', description: 'Name of the identity pool' },
        allowUnauthenticated: { type: 'boolean', description: 'Allow unauthenticated identities' },
        userPoolId: { type: 'string', description: 'Associated User Pool ID' },
        userPoolClientId: { type: 'string', description: 'Associated User Pool Client ID' },
      },
      required: ['identityPoolName'],
    },
  },
};
