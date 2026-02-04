/**
 * OIDC (OpenID Connect) Service
 * 
 * Implements OpenID Connect authentication including:
 * - Authorization Code Flow with PKCE
 * - Token exchange
 * - UserInfo retrieval
 * - Token refresh
 * - Session management
 */

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type {
  OIDCProviderConfig,
  OIDCTokenSet,
  OIDCUserInfo,
  OIDCClaimMapping,
  AuthProvider,
  AuthEvent,
  AuthEventType,
} from './types.js';

// =============================================================================
// OIDC Constants
// =============================================================================

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

// =============================================================================
// OIDC Storage Interface
// =============================================================================

interface OIDCStorage {
  // Authorization State
  saveAuthState(state: string, providerId: string, nonce: string, codeVerifier: string, redirectUri: string, expiresAt: string): Promise<void>;
  getAuthState(state: string): Promise<{ providerId: string; nonce: string; codeVerifier: string; redirectUri: string; expiresAt: string } | null>;
  deleteAuthState(state: string): Promise<void>;
  
  // Tokens (for session management)
  saveTokens(tenantId: string, userId: string, tokens: OIDCTokenSet, providerId: string): Promise<void>;
  getTokens(tenantId: string, userId: string, providerId: string): Promise<OIDCTokenSet | null>;
  deleteTokens(tenantId: string, userId: string, providerId: string): Promise<void>;
  
  // Providers
  getProvider(providerId: string): Promise<AuthProvider | null>;
  
  // Events
  saveAuthEvent(event: AuthEvent): Promise<void>;
}

// =============================================================================
// In-Memory OIDC Storage (for development/testing)
// =============================================================================

class InMemoryOIDCStorage implements OIDCStorage {
  private authStates = new Map<string, { providerId: string; nonce: string; codeVerifier: string; redirectUri: string; expiresAt: string }>();
  private tokens = new Map<string, OIDCTokenSet>();
  private providers = new Map<string, AuthProvider>();
  private events: AuthEvent[] = [];

  async saveAuthState(state: string, providerId: string, nonce: string, codeVerifier: string, redirectUri: string, expiresAt: string): Promise<void> {
    this.authStates.set(state, { providerId, nonce, codeVerifier, redirectUri, expiresAt });
  }

  async getAuthState(state: string): Promise<{ providerId: string; nonce: string; codeVerifier: string; redirectUri: string; expiresAt: string } | null> {
    return this.authStates.get(state) ?? null;
  }

  async deleteAuthState(state: string): Promise<void> {
    this.authStates.delete(state);
  }

  async saveTokens(tenantId: string, userId: string, tokens: OIDCTokenSet, providerId: string): Promise<void> {
    this.tokens.set(`${tenantId}:${userId}:${providerId}`, tokens);
  }

  async getTokens(tenantId: string, userId: string, providerId: string): Promise<OIDCTokenSet | null> {
    return this.tokens.get(`${tenantId}:${userId}:${providerId}`) ?? null;
  }

  async deleteTokens(tenantId: string, userId: string, providerId: string): Promise<void> {
    this.tokens.delete(`${tenantId}:${userId}:${providerId}`);
  }

  async getProvider(providerId: string): Promise<AuthProvider | null> {
    return this.providers.get(providerId) ?? null;
  }

  async saveAuthEvent(event: AuthEvent): Promise<void> {
    this.events.push(event);
  }

  // Helper for testing
  addProvider(provider: AuthProvider): void {
    this.providers.set(provider.id, provider);
  }
}

// =============================================================================
// OIDC Result Type
// =============================================================================

interface OIDCResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorDescription?: string;
}

// =============================================================================
// OIDC Service Configuration
// =============================================================================

export interface OIDCServiceConfig {
  // Callback Settings
  defaultRedirectUri: string;
  
  // State Settings
  stateLifetime: number; // seconds (default: 600)
  
  // Token Settings
  clockSkew: number; // seconds (default: 300)
  
  // PKCE Settings
  usePKCE: boolean; // default: true
  
  // HTTP Client Settings (for token/userinfo endpoints)
  httpTimeout: number; // ms (default: 10000)
}

// =============================================================================
// Parsed OIDC User
// =============================================================================

export interface OIDCUser {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  locale?: string;
  groups?: string[];
  claims: Record<string, unknown>;
}

// =============================================================================
// OIDC Service Implementation
// =============================================================================

export class OIDCService {
  private config: OIDCServiceConfig;
  private storage: OIDCStorage;

  constructor(config: Partial<OIDCServiceConfig> & Pick<OIDCServiceConfig, 'defaultRedirectUri'>, storage?: OIDCStorage) {
    this.config = {
      stateLifetime: 600,
      clockSkew: 300,
      usePKCE: true,
      httpTimeout: 10000,
      ...config,
    };
    this.storage = storage ?? new InMemoryOIDCStorage();
  }

  // ===========================================================================
  // Authorization
  // ===========================================================================

  /**
   * Generate OIDC authorization URL
   */
  async createAuthorizationUrl(
    providerId: string,
    options?: {
      redirectUri?: string;
      scopes?: string[];
      prompt?: 'none' | 'login' | 'consent' | 'select_account';
      loginHint?: string;
      acrValues?: string;
    },
  ): Promise<OIDCResult<{ authorizationUrl: string; state: string }>> {
    try {
      const provider = await this.storage.getProvider(providerId);
      if (!provider || provider.config.type !== 'oidc') {
        return { success: false, error: 'Invalid OIDC provider' };
      }

      const config = provider.config as OIDCProviderConfig;
      
      // Generate state and nonce
      const state = this.generateRandomString(32);
      const nonce = this.generateRandomString(32);
      
      // Generate PKCE code verifier and challenge
      let codeVerifier = '';
      let codeChallenge = '';
      if (this.config.usePKCE && config.pkceEnabled) {
        codeVerifier = this.generateRandomString(64);
        codeChallenge = this.generateCodeChallenge(codeVerifier);
      }

      const redirectUri = options?.redirectUri ?? this.config.defaultRedirectUri;
      const scopes = options?.scopes ?? config.scopes ?? DEFAULT_SCOPES;

      // Build authorization URL
      const url = new URL(config.authorizationEndpoint);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('response_type', config.responseType);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', scopes.join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      
      if (config.responseMode) {
        url.searchParams.set('response_mode', config.responseMode);
      }
      
      if (codeChallenge) {
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
      }
      
      if (options?.prompt) {
        url.searchParams.set('prompt', options.prompt);
      }
      
      if (options?.loginHint) {
        url.searchParams.set('login_hint', options.loginHint);
      }
      
      if (options?.acrValues) {
        url.searchParams.set('acr_values', options.acrValues);
      }

      // Store state
      const expiresAt = new Date(Date.now() + this.config.stateLifetime * 1000).toISOString();
      await this.storage.saveAuthState(state, providerId, nonce, codeVerifier, redirectUri, expiresAt);

      return {
        success: true,
        data: {
          authorizationUrl: url.toString(),
          state,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create authorization URL',
      };
    }
  }

  // ===========================================================================
  // Token Exchange
  // ===========================================================================

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(
    code: string,
    state: string,
  ): Promise<OIDCResult<{ tokens: OIDCTokenSet; user: OIDCUser; providerId: string }>> {
    try {
      // Get and validate state
      const storedState = await this.storage.getAuthState(state);
      if (!storedState) {
        return { success: false, error: 'Invalid state', errorDescription: 'State not found or expired' };
      }

      if (new Date(storedState.expiresAt) < new Date()) {
        await this.storage.deleteAuthState(state);
        return { success: false, error: 'State expired' };
      }

      const { providerId, nonce, codeVerifier, redirectUri } = storedState;
      await this.storage.deleteAuthState(state);

      // Get provider
      const provider = await this.storage.getProvider(providerId);
      if (!provider || provider.config.type !== 'oidc') {
        return { success: false, error: 'Invalid OIDC provider' };
      }

      const config = provider.config as OIDCProviderConfig;

      // Exchange code for tokens
      const tokenParams = new URLSearchParams();
      tokenParams.set('grant_type', 'authorization_code');
      tokenParams.set('code', code);
      tokenParams.set('redirect_uri', redirectUri);
      tokenParams.set('client_id', config.clientId);
      tokenParams.set('client_secret', config.clientSecret);
      
      if (codeVerifier) {
        tokenParams.set('code_verifier', codeVerifier);
      }

      const tokenResponse = await this.httpPost(config.tokenEndpoint, tokenParams);
      if (!tokenResponse.success || !tokenResponse.data) {
        return {
          success: false,
          error: tokenResponse.error ?? 'Token exchange failed',
          errorDescription: tokenResponse.errorDescription,
        };
      }

      const tokens: OIDCTokenSet = {
        accessToken: tokenResponse.data.access_token as string,
        tokenType: (tokenResponse.data.token_type as string | undefined) ?? 'Bearer',
        expiresIn: (tokenResponse.data.expires_in as number | undefined) ?? config.accessTokenLifetime,
        refreshToken: tokenResponse.data.refresh_token as string | undefined,
        idToken: tokenResponse.data.id_token as string | undefined,
        scope: (tokenResponse.data.scope as string | undefined) ?? config.scopes.join(' '),
      };

      // Validate ID token
      if (tokens.idToken) {
        const idTokenValid = await this.validateIdToken(tokens.idToken, config, nonce);
        if (!idTokenValid.success) {
          return { success: false, error: idTokenValid.error };
        }
      }

      // Get user info
      const userInfo = await this.getUserInfo(tokens.accessToken, config);
      if (!userInfo.success || !userInfo.data) {
        return { success: false, error: userInfo.error ?? 'Failed to get user info' };
      }

      // Map to user
      const user = this.mapClaimsToUser(userInfo.data, config.claimMapping);

      // Log event
      await this.logEvent('login.success', provider.tenantId, undefined, true, {
        provider: 'oidc',
        providerId,
        sub: user.sub,
      });

      return {
        success: true,
        data: {
          tokens,
          user,
          providerId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to exchange code',
      };
    }
  }

  // ===========================================================================
  // Token Refresh
  // ===========================================================================

  /**
   * Refresh tokens using refresh token
   */
  async refreshTokens(
    providerId: string,
    refreshToken: string,
  ): Promise<OIDCResult<OIDCTokenSet>> {
    try {
      const provider = await this.storage.getProvider(providerId);
      if (!provider || provider.config.type !== 'oidc') {
        return { success: false, error: 'Invalid OIDC provider' };
      }

      const config = provider.config as OIDCProviderConfig;

      const tokenParams = new URLSearchParams();
      tokenParams.set('grant_type', 'refresh_token');
      tokenParams.set('refresh_token', refreshToken);
      tokenParams.set('client_id', config.clientId);
      tokenParams.set('client_secret', config.clientSecret);

      const tokenResponse = await this.httpPost(config.tokenEndpoint, tokenParams);
      if (!tokenResponse.success || !tokenResponse.data) {
        return {
          success: false,
          error: tokenResponse.error ?? 'Token refresh failed',
          errorDescription: tokenResponse.errorDescription,
        };
      }

      const tokens: OIDCTokenSet = {
        accessToken: tokenResponse.data.access_token as string,
        tokenType: (tokenResponse.data.token_type as string | undefined) ?? 'Bearer',
        expiresIn: (tokenResponse.data.expires_in as number | undefined) ?? config.accessTokenLifetime,
        refreshToken: (tokenResponse.data.refresh_token as string | undefined) ?? refreshToken,
        idToken: tokenResponse.data.id_token as string | undefined,
        scope: (tokenResponse.data.scope as string | undefined) ?? config.scopes.join(' '),
      };

      await this.logEvent('token.refreshed', provider.tenantId, undefined, true, {
        provider: 'oidc',
        providerId,
      });

      return { success: true, data: tokens };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh tokens',
      };
    }
  }

  // ===========================================================================
  // User Info
  // ===========================================================================

  /**
   * Get user info from OIDC provider
   */
  async getUserInfo(
    accessToken: string,
    config: OIDCProviderConfig,
  ): Promise<OIDCResult<OIDCUserInfo>> {
    try {
      const response = await this.httpGet(config.userInfoEndpoint, accessToken);
      if (!response.success || !response.data) {
        return { success: false, error: response.error ?? 'Failed to get user info' };
      }

      return { success: true, data: response.data as OIDCUserInfo };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get user info',
      };
    }
  }

  // ===========================================================================
  // Logout
  // ===========================================================================

  /**
   * Generate end session URL for logout
   */
  async createLogoutUrl(
    providerId: string,
    idToken?: string,
    postLogoutRedirectUri?: string,
  ): Promise<OIDCResult<{ logoutUrl: string }>> {
    try {
      const provider = await this.storage.getProvider(providerId);
      if (!provider || provider.config.type !== 'oidc') {
        return { success: false, error: 'Invalid OIDC provider' };
      }

      const config = provider.config as OIDCProviderConfig;
      if (!config.endSessionEndpoint) {
        return { success: false, error: 'Provider does not support logout' };
      }

      const url = new URL(config.endSessionEndpoint);
      
      if (idToken) {
        url.searchParams.set('id_token_hint', idToken);
      }
      
      if (postLogoutRedirectUri) {
        url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      }

      return { success: true, data: { logoutUrl: url.toString() } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create logout URL',
      };
    }
  }

  // ===========================================================================
  // Provider Discovery
  // ===========================================================================

  /**
   * Discover OIDC provider configuration from issuer URL
   */
  async discoverProvider(issuerUrl: string): Promise<OIDCResult<Partial<OIDCProviderConfig>>> {
    try {
      const wellKnownUrl = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const response = await this.httpGet(wellKnownUrl);
      
      if (!response.success || !response.data) {
        return { success: false, error: 'Failed to discover OIDC configuration' };
      }

      const data = response.data as Record<string, unknown>;

      const config: Partial<OIDCProviderConfig> = {
        type: 'oidc',
        issuer: data.issuer as string,
        authorizationEndpoint: data.authorization_endpoint as string,
        tokenEndpoint: data.token_endpoint as string,
        userInfoEndpoint: data.userinfo_endpoint as string,
        jwksUri: data.jwks_uri as string,
        endSessionEndpoint: data.end_session_endpoint as string | undefined,
        scopes: (data.scopes_supported as string[])?.filter(s => 
          ['openid', 'profile', 'email', 'groups'].includes(s)
        ) ?? DEFAULT_SCOPES,
      };

      return { success: true, data: config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to discover provider',
      };
    }
  }

  // ===========================================================================
  // Token Validation
  // ===========================================================================

  private async validateIdToken(
    idToken: string,
    config: OIDCProviderConfig,
    expectedNonce: string,
  ): Promise<OIDCResult> {
    try {
      // Decode JWT (simplified - use jose for proper validation)
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        return { success: false, error: 'Invalid ID token format' };
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

      // Validate issuer
      if (payload.iss !== config.issuer) {
        return { success: false, error: 'Invalid issuer' };
      }

      // Validate audience
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(config.clientId)) {
        return { success: false, error: 'Invalid audience' };
      }

      // Validate nonce
      if (payload.nonce !== expectedNonce) {
        return { success: false, error: 'Invalid nonce' };
      }

      // Validate expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now - this.config.clockSkew) {
        return { success: false, error: 'ID token expired' };
      }

      // Validate iat
      if (payload.iat > now + this.config.clockSkew) {
        return { success: false, error: 'ID token issued in the future' };
      }

      // In production, also verify signature using JWKS
      // const jwks = await this.fetchJWKS(config.jwksUri);
      // const verified = await jose.jwtVerify(idToken, jwks, { issuer: config.issuer });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'ID token validation failed',
      };
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private generateRandomString(length: number): string {
    return randomBytes(length).toString('base64url').slice(0, length);
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private mapClaimsToUser(userInfo: OIDCUserInfo, mapping: OIDCClaimMapping): OIDCUser {
    const getClaim = (key: string): unknown => {
      const mappedKey = mapping[key as keyof OIDCClaimMapping] as string | undefined;
      return mappedKey ? userInfo[mappedKey] : userInfo[key];
    };

    return {
      sub: userInfo.sub,
      email: (getClaim('email') as string) ?? userInfo.email ?? '',
      emailVerified: (getClaim('emailVerified') as boolean) ?? userInfo.emailVerified ?? false,
      name: getClaim('name') as string | undefined,
      givenName: getClaim('givenName') as string | undefined,
      familyName: getClaim('familyName') as string | undefined,
      picture: getClaim('picture') as string | undefined,
      locale: getClaim('locale') as string | undefined,
      groups: getClaim('groups') as string[] | undefined,
      claims: userInfo as Record<string, unknown>,
    };
  }

  private async httpPost(
    url: string,
    body: URLSearchParams,
  ): Promise<OIDCResult<Record<string, unknown>>> {
    try {
      // In production, use proper HTTP client
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.config.httpTimeout),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error ?? 'Request failed',
          errorDescription: data.error_description,
        };
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'HTTP request failed',
      };
    }
  }

  private async httpGet(
    url: string,
    accessToken?: string,
  ): Promise<OIDCResult<Record<string, unknown>>> {
    try {
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.config.httpTimeout),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error ?? 'Request failed',
          errorDescription: data.error_description,
        };
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'HTTP request failed',
      };
    }
  }

  private async logEvent(
    type: AuthEventType,
    tenantId: string,
    userId: string | undefined,
    success: boolean,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const event: AuthEvent = {
      id: `evt_${randomUUID()}`,
      tenantId,
      userId,
      type,
      success,
      ipAddress: (metadata?.ipAddress as string) ?? 'unknown',
      userAgent: (metadata?.userAgent as string) ?? 'unknown',
      provider: 'oidc',
      metadata,
      timestamp: new Date().toISOString(),
    };

    await this.storage.saveAuthEvent(event);
  }
}

// =============================================================================
// Pre-configured OIDC Providers
// =============================================================================

export const WELL_KNOWN_PROVIDERS = {
  google: {
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    endSessionEndpoint: undefined,
    scopes: ['openid', 'profile', 'email'],
  },
  microsoft: {
    issuer: 'https://login.microsoftonline.com/{tenantId}/v2.0',
    authorizationEndpoint: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
    userInfoEndpoint: 'https://graph.microsoft.com/oidc/userinfo',
    jwksUri: 'https://login.microsoftonline.com/{tenantId}/discovery/v2.0/keys',
    endSessionEndpoint: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/logout',
    scopes: ['openid', 'profile', 'email', 'User.Read'],
  },
  okta: {
    issuer: 'https://{domain}.okta.com/oauth2/default',
    authorizationEndpoint: 'https://{domain}.okta.com/oauth2/default/v1/authorize',
    tokenEndpoint: 'https://{domain}.okta.com/oauth2/default/v1/token',
    userInfoEndpoint: 'https://{domain}.okta.com/oauth2/default/v1/userinfo',
    jwksUri: 'https://{domain}.okta.com/oauth2/default/v1/keys',
    endSessionEndpoint: 'https://{domain}.okta.com/oauth2/default/v1/logout',
    scopes: ['openid', 'profile', 'email', 'groups'],
  },
  auth0: {
    issuer: 'https://{domain}.auth0.com/',
    authorizationEndpoint: 'https://{domain}.auth0.com/authorize',
    tokenEndpoint: 'https://{domain}.auth0.com/oauth/token',
    userInfoEndpoint: 'https://{domain}.auth0.com/userinfo',
    jwksUri: 'https://{domain}.auth0.com/.well-known/jwks.json',
    endSessionEndpoint: 'https://{domain}.auth0.com/v2/logout',
    scopes: ['openid', 'profile', 'email'],
  },
};

// =============================================================================
// Factory Function
// =============================================================================

export function createOIDCService(
  config: Partial<OIDCServiceConfig> & Pick<OIDCServiceConfig, 'defaultRedirectUri'>,
  storage?: OIDCStorage,
): OIDCService {
  return new OIDCService(config, storage);
}
