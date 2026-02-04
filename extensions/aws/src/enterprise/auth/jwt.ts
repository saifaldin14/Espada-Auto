/**
 * JWT Session Management
 * 
 * Handles JWT token generation, validation, and session management
 * with support for access tokens, refresh tokens, and token rotation.
 */

import { randomUUID } from 'node:crypto';
import type {
  Session,
  AccessToken,
  RefreshToken,
  AuthUser,
  TokenResponse,
  AuthServiceConfig,
  AuthEvent,
  AuthEventType,
} from './types.js';
import type { TenantMember, TenantTier } from '../tenant/types.js';

type TenantMemberRole = TenantMember['role'];

// =============================================================================
// JWT Implementation (using jose in real implementation)
// =============================================================================

interface JWTSignOptions {
  algorithm?: string;
  expiresIn?: number;
  notBefore?: number;
  issuer?: string;
  audience?: string | string[];
  jwtId?: string;
}

interface JWTVerifyOptions {
  algorithms?: string[];
  issuer?: string;
  audience?: string | string[];
  clockTolerance?: number;
}

// Simple base64url encoding/decoding
function base64UrlEncode(data: string | Uint8Array): string {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
  return Buffer.from(str).toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

// =============================================================================
// Session Storage Interface
// =============================================================================

interface SessionStorage {
  // Sessions
  saveSession(session: Session): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  getUserSessions(tenantId: string, userId: string): Promise<Session[]>;
  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  
  // Refresh Tokens
  saveRefreshToken(tokenJti: string, sessionId: string, family: string, generation: number, expiresAt: string): Promise<void>;
  getRefreshToken(tokenJti: string): Promise<{ sessionId: string; family: string; generation: number; expiresAt: string } | null>;
  invalidateRefreshTokenFamily(family: string): Promise<void>;
  
  // Events
  saveAuthEvent(event: AuthEvent): Promise<void>;
}

// =============================================================================
// In-Memory Session Storage (for development/testing)
// =============================================================================

class InMemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, Session>();
  private refreshTokens = new Map<string, { sessionId: string; family: string; generation: number; expiresAt: string }>();
  private tokenFamilies = new Map<string, string[]>(); // family -> [tokenJtis]
  private events: AuthEvent[] = [];

  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getUserSessions(tenantId: string, userId: string): Promise<Session[]> {
    return Array.from(this.sessions.values()).filter(
      s => s.tenantId === tenantId && s.userId === userId && s.active,
    );
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, ...updates });
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async saveRefreshToken(
    tokenJti: string,
    sessionId: string,
    family: string,
    generation: number,
    expiresAt: string,
  ): Promise<void> {
    this.refreshTokens.set(tokenJti, { sessionId, family, generation, expiresAt });
    
    const familyTokens = this.tokenFamilies.get(family) ?? [];
    familyTokens.push(tokenJti);
    this.tokenFamilies.set(family, familyTokens);
  }

  async getRefreshToken(tokenJti: string): Promise<{ sessionId: string; family: string; generation: number; expiresAt: string } | null> {
    return this.refreshTokens.get(tokenJti) ?? null;
  }

  async invalidateRefreshTokenFamily(family: string): Promise<void> {
    const familyTokens = this.tokenFamilies.get(family) ?? [];
    for (const jti of familyTokens) {
      this.refreshTokens.delete(jti);
    }
    this.tokenFamilies.delete(family);
  }

  async saveAuthEvent(event: AuthEvent): Promise<void> {
    this.events.push(event);
  }
}

// =============================================================================
// JWT Manager Result Type
// =============================================================================

interface JWTResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// =============================================================================
// JWT Manager Configuration
// =============================================================================

export interface JWTManagerConfig {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenLifetime: number; // seconds (default: 900 = 15 min)
  refreshTokenLifetime: number; // seconds (default: 604800 = 7 days)
  tokenIssuer: string;
  tokenAudience: string;
  clockTolerance: number; // seconds (default: 30)
  enableTokenRotation: boolean; // Rotate refresh tokens on each use
  maxRefreshTokenReuse: number; // Max times a refresh token can be reused before rotation
}

// =============================================================================
// JWT Manager Implementation
// =============================================================================

export class JWTManager {
  private config: JWTManagerConfig;
  private storage: SessionStorage;

  constructor(config: Partial<JWTManagerConfig> & Pick<JWTManagerConfig, 'accessTokenSecret' | 'refreshTokenSecret'>, storage?: SessionStorage) {
    this.config = {
      accessTokenLifetime: 900, // 15 minutes
      refreshTokenLifetime: 604800, // 7 days
      tokenIssuer: 'idio-enterprise',
      tokenAudience: 'idio-api',
      clockTolerance: 30,
      enableTokenRotation: true,
      maxRefreshTokenReuse: 1,
      ...config,
    };
    this.storage = storage ?? new InMemorySessionStorage();
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Create a new session and generate tokens
   */
  async createSession(
    user: AuthUser,
    role: TenantMemberRole,
    tier: TenantTier,
    permissions: string[],
    teams: string[],
    request: {
      ipAddress: string;
      userAgent: string;
      deviceId?: string;
      authProvider: AuthUser['externalProvider'];
      authProviderId?: string;
      amr: string[];
    },
  ): Promise<JWTResult<{ session: Session; tokens: TokenResponse }>> {
    try {
      const now = new Date();
      const sessionId = `ses_${randomUUID()}`;
      const tokenFamily = `fam_${randomUUID()}`;

      // Create session
      const session: Session = {
        id: sessionId,
        tenantId: user.tenantId,
        userId: user.id,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.config.refreshTokenLifetime * 1000).toISOString(),
        lastActivityAt: now.toISOString(),
        authProvider: request.authProvider ?? 'password',
        authProviderId: request.authProviderId ?? '',
        authTime: now.toISOString(),
        amr: request.amr,
        active: true,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        deviceId: request.deviceId,
      };

      // Check max active sessions
      const existingSessions = await this.storage.getUserSessions(user.tenantId, user.id);
      // In real implementation, enforce max sessions limit

      // Generate tokens
      const tokens = await this.generateTokenPair(session, user, role, tier, permissions, teams, tokenFamily, 0);

      // Save session
      await this.storage.saveSession(session);

      // Log event
      await this.logEvent('session.created', user.tenantId, user.id, true, {
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        sessionId,
        provider: request.authProvider,
      });

      return {
        success: true,
        data: { session, tokens },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create session',
      };
    }
  }

  /**
   * Refresh tokens using a refresh token
   */
  async refreshTokens(
    refreshToken: string,
    user: AuthUser,
    role: TenantMemberRole,
    tier: TenantTier,
    permissions: string[],
    teams: string[],
  ): Promise<JWTResult<TokenResponse>> {
    try {
      // Verify refresh token
      const decoded = await this.verifyRefreshToken(refreshToken);
      if (!decoded.success || !decoded.data) {
        return { success: false, error: decoded.error ?? 'Invalid refresh token' };
      }

      const { jti, sid, family, generation } = decoded.data;

      // Get stored token info
      const storedToken = await this.storage.getRefreshToken(jti);
      if (!storedToken) {
        // Token not found - possible reuse attack
        // Invalidate entire family
        await this.storage.invalidateRefreshTokenFamily(family);
        await this.logEvent('token.revoked', user.tenantId, user.id, false, {
          reason: 'Possible token reuse attack',
          family,
        });
        return { success: false, error: 'Invalid refresh token' };
      }

      // Check expiration
      if (new Date(storedToken.expiresAt) < new Date()) {
        return { success: false, error: 'Refresh token expired' };
      }

      // Get session
      const session = await this.storage.getSession(storedToken.sessionId);
      if (!session || !session.active) {
        return { success: false, error: 'Session not found or inactive' };
      }

      // Check session expiration
      if (new Date(session.expiresAt) < new Date()) {
        return { success: false, error: 'Session expired' };
      }

      // Generate new token pair
      const newGeneration = this.config.enableTokenRotation ? generation + 1 : generation;
      const newFamily = this.config.enableTokenRotation ? `fam_${randomUUID()}` : family;

      const tokens = await this.generateTokenPair(
        session,
        user,
        role,
        tier,
        permissions,
        teams,
        newFamily,
        newGeneration,
      );

      // Update session activity
      await this.storage.updateSession(session.id, {
        lastActivityAt: new Date().toISOString(),
      });

      // If rotating, invalidate old family
      if (this.config.enableTokenRotation) {
        await this.storage.invalidateRefreshTokenFamily(family);
      }

      await this.logEvent('token.refreshed', user.tenantId, user.id, true, {
        sessionId: session.id,
        rotated: this.config.enableTokenRotation,
      });

      return { success: true, data: tokens };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh tokens',
      };
    }
  }

  /**
   * Revoke a session
   */
  async revokeSession(
    sessionId: string,
    revokedBy?: string,
    reason?: string,
  ): Promise<JWTResult> {
    try {
      const session = await this.storage.getSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      await this.storage.updateSession(sessionId, {
        active: false,
        revokedAt: new Date().toISOString(),
        revokedBy,
        revokeReason: reason,
      });

      // Invalidate associated refresh tokens
      if (session.refreshTokenJti) {
        const tokenInfo = await this.storage.getRefreshToken(session.refreshTokenJti);
        if (tokenInfo) {
          await this.storage.invalidateRefreshTokenFamily(tokenInfo.family);
        }
      }

      await this.logEvent('session.revoked', session.tenantId, session.userId, true, {
        sessionId,
        revokedBy,
        reason,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to revoke session',
      };
    }
  }

  /**
   * Revoke all user sessions
   */
  async revokeAllUserSessions(
    tenantId: string,
    userId: string,
    excludeSessionId?: string,
  ): Promise<JWTResult<number>> {
    try {
      const sessions = await this.storage.getUserSessions(tenantId, userId);
      let revokedCount = 0;

      for (const session of sessions) {
        if (session.id !== excludeSessionId) {
          await this.revokeSession(session.id, userId, 'User revoked all sessions');
          revokedCount++;
        }
      }

      return { success: true, data: revokedCount };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to revoke sessions',
      };
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(tenantId: string, userId: string): Promise<JWTResult<Session[]>> {
    try {
      const sessions = await this.storage.getUserSessions(tenantId, userId);
      return { success: true, data: sessions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get sessions',
      };
    }
  }

  // ===========================================================================
  // Token Generation & Verification
  // ===========================================================================

  /**
   * Generate access and refresh token pair
   */
  private async generateTokenPair(
    session: Session,
    user: AuthUser,
    role: TenantMemberRole,
    tier: TenantTier,
    permissions: string[],
    teams: string[],
    family: string,
    generation: number,
  ): Promise<TokenResponse> {
    const now = Math.floor(Date.now() / 1000);
    const accessTokenJti = `at_${randomUUID()}`;
    const refreshTokenJti = `rt_${randomUUID()}`;

    // Access token payload
    const accessPayload: AccessToken = {
      jti: accessTokenJti,
      sub: user.id,
      tid: user.tenantId,
      sid: session.id,
      iat: now,
      exp: now + this.config.accessTokenLifetime,
      nbf: now,
      iss: this.config.tokenIssuer,
      aud: this.config.tokenAudience,
      email: user.email,
      name: user.displayName,
      role,
      permissions,
      teams,
      tier,
      amr: session.amr,
      acr: session.acr,
    };

    // Refresh token payload
    const refreshPayload: RefreshToken = {
      jti: refreshTokenJti,
      sub: user.id,
      tid: user.tenantId,
      sid: session.id,
      iat: now,
      exp: now + this.config.refreshTokenLifetime,
      iss: this.config.tokenIssuer,
      aud: this.config.tokenAudience,
      family,
      generation,
    };

    // Sign tokens (simplified - use jose in production)
    const accessToken = this.signToken(accessPayload as unknown as Record<string, unknown>, this.config.accessTokenSecret);
    const refreshToken = this.signToken(refreshPayload as unknown as Record<string, unknown>, this.config.refreshTokenSecret);

    // Store refresh token info
    await this.storage.saveRefreshToken(
      refreshTokenJti,
      session.id,
      family,
      generation,
      new Date((now + this.config.refreshTokenLifetime) * 1000).toISOString(),
    );

    // Update session with token references
    await this.storage.updateSession(session.id, {
      accessTokenJti,
      refreshTokenJti,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenLifetime,
      tokenType: 'Bearer',
    };
  }

  /**
   * Verify access token
   */
  async verifyAccessToken(token: string): Promise<JWTResult<AccessToken>> {
    try {
      const decoded = this.verifyToken<AccessToken>(token, this.config.accessTokenSecret);
      if (!decoded) {
        return { success: false, error: 'Invalid token' };
      }

      // Additional validation
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp < now - this.config.clockTolerance) {
        return { success: false, error: 'Token expired' };
      }

      if (decoded.nbf > now + this.config.clockTolerance) {
        return { success: false, error: 'Token not yet valid' };
      }

      return { success: true, data: decoded };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token verification failed',
      };
    }
  }

  /**
   * Verify refresh token
   */
  private async verifyRefreshToken(token: string): Promise<JWTResult<RefreshToken & { jti: string; sid: string; family: string; generation: number }>> {
    try {
      const decoded = this.verifyToken<RefreshToken>(token, this.config.refreshTokenSecret);
      if (!decoded) {
        return { success: false, error: 'Invalid token' };
      }

      // Additional validation
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp < now - this.config.clockTolerance) {
        return { success: false, error: 'Token expired' };
      }

      return {
        success: true,
        data: {
          ...decoded,
          jti: decoded.jti,
          sid: decoded.sid,
          family: decoded.family,
          generation: decoded.generation,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token verification failed',
      };
    }
  }

  // ===========================================================================
  // Simple JWT Implementation (use jose library in production)
  // ===========================================================================

  private signToken(payload: Record<string, unknown>, secret: string): string {
    // Simple HMAC-SHA256 JWT (use jose for RS256 in production)
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const data = `${headerB64}.${payloadB64}`;
    
    // In production, use crypto.createHmac
    // For now, use a placeholder signature
    const crypto = require('node:crypto');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64url');

    return `${data}.${signature}`;
  }

  private verifyToken<T>(token: string, secret: string): T | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signature] = parts;
      const data = `${headerB64}.${payloadB64}`;

      // Verify signature
      const crypto = require('node:crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(data)
        .digest('base64url');

      if (signature !== expectedSignature) return null;

      // Decode payload
      const payload = JSON.parse(base64UrlDecode(payloadB64));
      return payload as T;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Event Logging
  // ===========================================================================

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
      sessionId: metadata?.sessionId as string,
      metadata,
      timestamp: new Date().toISOString(),
    };

    await this.storage.saveAuthEvent(event);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createJWTManager(
  config: Partial<JWTManagerConfig> & Pick<JWTManagerConfig, 'accessTokenSecret' | 'refreshTokenSecret'>,
  storage?: SessionStorage,
): JWTManager {
  return new JWTManager(config, storage);
}
