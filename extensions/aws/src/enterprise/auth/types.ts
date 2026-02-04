/**
 * Enterprise Authentication Types
 * 
 * Defines types for enterprise authentication including:
 * - SAML 2.0 SSO
 * - OIDC/OAuth 2.0
 * - JWT Session Management
 * - Multi-factor Authentication
 * - API Keys
 */

import type { TenantMember, TenantTier } from '../tenant/types.js';

export type TenantMemberRole = TenantMember['role'];

// =============================================================================
// Authentication Provider Types
// =============================================================================

export type AuthProviderType = 'password' | 'saml' | 'oidc' | 'google' | 'github' | 'microsoft' | 'okta';

export interface AuthProvider {
  id: string;
  tenantId: string;
  type: AuthProviderType;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  domains: string[]; // Email domains that use this provider
  config: AuthProviderConfig;
  createdAt: string;
  updatedAt: string;
}

export type AuthProviderConfig = 
  | SAMLProviderConfig 
  | OIDCProviderConfig 
  | PasswordProviderConfig;

// =============================================================================
// SAML 2.0 Configuration
// =============================================================================

export interface SAMLProviderConfig {
  type: 'saml';
  
  // IdP Configuration
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl?: string; // Single logout URL
  idpCertificate: string; // X.509 certificate
  
  // SP Configuration (auto-generated or custom)
  spEntityId: string;
  spAcsUrl: string; // Assertion Consumer Service URL
  spSloUrl?: string;
  
  // Attribute Mapping
  attributeMapping: SAMLAttributeMapping;
  
  // Options
  signAuthnRequests: boolean;
  wantAssertionsSigned: boolean;
  wantMessagesSigned: boolean;
  signatureAlgorithm: 'sha256' | 'sha512';
  digestAlgorithm: 'sha256' | 'sha512';
  
  // Advanced
  allowIdpInitiatedSso: boolean;
  forceAuthn: boolean;
  passiveAuthn: boolean;
  authnContext?: string; // e.g., 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'
}

export interface SAMLAttributeMapping {
  // Required attributes
  email: string; // e.g., 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
  
  // Optional attributes
  firstName?: string;
  lastName?: string;
  displayName?: string;
  groups?: string;
  role?: string;
  department?: string;
  employeeId?: string;
  phoneNumber?: string;
  profilePicture?: string;
  
  // Custom attributes
  custom?: Record<string, string>;
}

export interface SAMLAssertion {
  id: string;
  issuer: string;
  subject: string;
  nameId: string;
  nameIdFormat: string;
  sessionIndex: string;
  authnInstant: string;
  authnContext: string;
  attributes: Record<string, string | string[]>;
  notBefore: string;
  notOnOrAfter: string;
  audience: string;
}

// =============================================================================
// OIDC/OAuth 2.0 Configuration
// =============================================================================

export interface OIDCProviderConfig {
  type: 'oidc';
  
  // OIDC Provider Settings
  issuer: string; // e.g., 'https://auth.example.com'
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  jwksUri: string;
  endSessionEndpoint?: string;
  
  // Client Credentials
  clientId: string;
  clientSecret: string; // Encrypted
  
  // Scopes
  scopes: string[]; // e.g., ['openid', 'profile', 'email', 'groups']
  
  // Claim Mapping
  claimMapping: OIDCClaimMapping;
  
  // Options
  responseType: 'code' | 'code id_token' | 'id_token';
  responseMode?: 'query' | 'fragment' | 'form_post';
  pkceEnabled: boolean;
  
  // Token Settings
  accessTokenLifetime: number; // seconds
  refreshTokenLifetime: number;
  idTokenSignedResponseAlg: string; // e.g., 'RS256'
}

export interface OIDCClaimMapping {
  email: string;
  emailVerified?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  nickname?: string;
  picture?: string;
  locale?: string;
  groups?: string;
  roles?: string;
  custom?: Record<string, string>;
}

export interface OIDCTokenSet {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
  idToken?: string;
  scope: string;
}

export interface OIDCUserInfo {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  locale?: string;
  [key: string]: unknown;
}

// =============================================================================
// Password Provider Configuration
// =============================================================================

export interface PasswordProviderConfig {
  type: 'password';
  
  // Password Policy
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  maxConsecutiveChars: number;
  preventCommonPasswords: boolean;
  preventUserInfoInPassword: boolean;
  passwordExpiryDays: number; // 0 = never
  passwordHistoryCount: number; // Prevent reuse of last N passwords
  
  // Lockout Policy
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
  lockoutResetMinutes: number;
  
  // Account Recovery
  allowPasswordReset: boolean;
  passwordResetTokenExpiry: number; // minutes
  requireEmailVerification: boolean;
}

// =============================================================================
// Session & Token Types
// =============================================================================

export interface Session {
  id: string;
  tenantId: string;
  userId: string;
  
  // Session Info
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
  
  // Authentication Info
  authProvider: AuthProviderType;
  authProviderId: string;
  authTime: string;
  amr: string[]; // Authentication Methods References (e.g., ['pwd', 'mfa'])
  acr?: string; // Authentication Context Class Reference
  
  // Session State
  active: boolean;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  
  // Device/Client Info
  ipAddress: string;
  userAgent: string;
  deviceId?: string;
  deviceFingerprint?: string;
  location?: SessionLocation;
  
  // Token References
  accessTokenJti?: string;
  refreshTokenJti?: string;
}

export interface SessionLocation {
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

export interface AccessToken {
  jti: string; // Unique token identifier
  sub: string; // Subject (user ID)
  tid: string; // Tenant ID
  sid: string; // Session ID
  iat: number; // Issued at
  exp: number; // Expiration
  nbf: number; // Not before
  iss: string; // Issuer
  aud: string | string[]; // Audience
  
  // Custom Claims
  email: string;
  name?: string;
  role: TenantMemberRole;
  permissions: string[];
  teams: string[];
  tier: TenantTier;
  
  // Auth Context
  amr: string[];
  acr?: string;
  azp?: string; // Authorized party (client ID)
}

export interface RefreshToken {
  jti: string;
  sub: string;
  tid: string;
  sid: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  
  // Rotation tracking
  family: string; // Token family for rotation detection
  generation: number;
}

// =============================================================================
// Multi-Factor Authentication (MFA)
// =============================================================================

export type MFAType = 'totp' | 'sms' | 'email' | 'webauthn' | 'recovery_codes';

export interface MFAConfig {
  tenantId: string;
  userId: string;
  
  // Enabled factors
  enabledFactors: MFAFactor[];
  
  // Policy
  required: boolean;
  rememberDeviceDays: number; // 0 = never remember
  allowedFactors: MFAType[];
  preferredFactor?: MFAType;
  
  createdAt: string;
  updatedAt: string;
}

export interface MFAFactor {
  id: string;
  type: MFAType;
  name: string;
  enabled: boolean;
  verified: boolean;
  verifiedAt?: string;
  lastUsedAt?: string;
  
  // Factor-specific data (encrypted)
  data: MFAFactorData;
}

export type MFAFactorData =
  | TOTPFactorData
  | SMSFactorData
  | EmailFactorData
  | WebAuthnFactorData
  | RecoveryCodesFactorData;

export interface TOTPFactorData {
  type: 'totp';
  secret: string; // Encrypted
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: 6 | 8;
  period: number; // Usually 30 seconds
}

export interface SMSFactorData {
  type: 'sms';
  phoneNumber: string; // E.164 format
  verified: boolean;
}

export interface EmailFactorData {
  type: 'email';
  email: string;
  verified: boolean;
}

export interface WebAuthnFactorData {
  type: 'webauthn';
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  aaguid?: string;
  attestationFormat?: string;
}

export type AuthenticatorTransport = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid';

export interface RecoveryCodesFactorData {
  type: 'recovery_codes';
  codes: RecoveryCode[];
  generatedAt: string;
}

export interface RecoveryCode {
  code: string; // Hashed
  usedAt?: string;
}

export interface MFAChallenge {
  id: string;
  tenantId: string;
  userId: string;
  factorId: string;
  factorType: MFAType;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  verified: boolean;
  verifiedAt?: string;
}

// =============================================================================
// API Keys
// =============================================================================

export interface APIKey {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  description?: string;
  
  // Key Material (prefix shown, rest hashed)
  keyPrefix: string; // e.g., 'idio_sk_'
  keyHash: string;
  
  // Permissions
  permissions: string[];
  scopes: string[];
  
  // Rate Limits
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  
  // Restrictions
  ipAllowlist?: string[];
  allowedOrigins?: string[];
  expiresAt?: string;
  
  // Metadata
  createdAt: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  revokedAt?: string;
  revokedBy?: string;
}

// =============================================================================
// User Types
// =============================================================================

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  emailVerified: boolean;
  
  // Profile
  firstName?: string;
  lastName?: string;
  displayName?: string;
  avatarUrl?: string;
  locale?: string;
  timezone?: string;
  
  // Authentication
  passwordHash?: string;
  passwordChangedAt?: string;
  passwordHistory?: string[]; // Hashed
  
  // MFA
  mfaEnabled: boolean;
  mfaConfig?: MFAConfig;
  
  // Status
  status: 'active' | 'inactive' | 'suspended' | 'pending';
  suspendedAt?: string;
  suspendedReason?: string;
  
  // External Identity
  externalId?: string; // From IdP
  externalProvider?: AuthProviderType;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastLoginIp?: string;
  
  // Security
  failedLoginAttempts: number;
  lockedUntil?: string;
}

// =============================================================================
// Authentication Events
// =============================================================================

export type AuthEventType =
  | 'login.success'
  | 'login.failure'
  | 'logout'
  | 'session.created'
  | 'session.revoked'
  | 'token.issued'
  | 'token.refreshed'
  | 'token.revoked'
  | 'password.changed'
  | 'password.reset.requested'
  | 'password.reset.completed'
  | 'mfa.enabled'
  | 'mfa.disabled'
  | 'mfa.challenge.success'
  | 'mfa.challenge.failure'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'provider.created'
  | 'provider.updated'
  | 'provider.deleted';

export interface AuthEvent {
  id: string;
  tenantId: string;
  userId?: string;
  type: AuthEventType;
  success: boolean;
  
  // Context
  ipAddress: string;
  userAgent: string;
  sessionId?: string;
  
  // Details
  provider?: AuthProviderType;
  reason?: string;
  metadata?: Record<string, unknown>;
  
  timestamp: string;
}

// =============================================================================
// Service Configuration
// =============================================================================

export interface AuthServiceConfig {
  // Token Settings
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenLifetime: number; // seconds (default: 15 minutes)
  refreshTokenLifetime: number; // seconds (default: 7 days)
  tokenIssuer: string;
  tokenAudience: string;
  
  // Session Settings
  sessionLifetime: number; // seconds
  maxActiveSessions: number;
  extendSessionOnActivity: boolean;
  
  // Security Settings
  requireSecureCookies: boolean;
  cookieDomain?: string;
  sameSite: 'strict' | 'lax' | 'none';
  
  // SAML Settings
  samlSpEntityId: string;
  samlSpCertificate: string;
  samlSpPrivateKey: string;
  samlCallbackUrl: string;
  
  // OIDC Settings
  oidcCallbackUrl: string;
  
  // MFA Settings
  mfaTotpIssuer: string;
  mfaChallengeLifetime: number; // seconds
  mfaMaxAttempts: number;
  
  // Password Settings
  bcryptRounds: number;
  
  // Rate Limiting
  loginRateLimit: {
    maxAttempts: number;
    windowMs: number;
    blockDurationMs: number;
  };
}

// =============================================================================
// Authentication Requests/Responses
// =============================================================================

export interface LoginRequest {
  email: string;
  password?: string;
  mfaCode?: string;
  rememberMe?: boolean;
  deviceId?: string;
}

export interface LoginResponse {
  success: boolean;
  requiresMfa?: boolean;
  mfaChallenge?: {
    challengeId: string;
    factorType: MFAType;
    factorHint?: string;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: 'Bearer';
  };
  user?: {
    id: string;
    email: string;
    name?: string;
    role: TenantMemberRole;
  };
  error?: string;
}

export interface SAMLLoginRequest {
  providerId: string;
  relayState?: string;
}

export interface SAMLCallbackRequest {
  SAMLResponse: string;
  RelayState?: string;
}

export interface OIDCLoginRequest {
  providerId: string;
  state?: string;
  nonce?: string;
}

export interface OIDCCallbackRequest {
  code: string;
  state: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

// =============================================================================
// Permission System
// =============================================================================

export interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string; // e.g., 'deployment', 'environment', 'api_key'
  action: 'create' | 'read' | 'update' | 'delete' | 'execute' | '*';
}

export interface PermissionPolicy {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  statements: PolicyStatement[];
  createdAt: string;
  updatedAt: string;
}

export interface PolicyStatement {
  effect: 'allow' | 'deny';
  resources: string[]; // e.g., ['deployment:*', 'environment:production']
  actions: string[]; // e.g., ['read', 'execute']
  conditions?: PolicyCondition[];
}

export interface PolicyCondition {
  type: 'ip' | 'time' | 'mfa' | 'tag' | 'attribute';
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'contains' | 'starts_with';
  key: string;
  value: string | string[] | boolean | number;
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_PASSWORD_POLICY: PasswordProviderConfig = {
  type: 'password',
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  maxConsecutiveChars: 3,
  preventCommonPasswords: true,
  preventUserInfoInPassword: true,
  passwordExpiryDays: 90,
  passwordHistoryCount: 5,
  maxFailedAttempts: 5,
  lockoutDurationMinutes: 30,
  lockoutResetMinutes: 15,
  allowPasswordReset: true,
  passwordResetTokenExpiry: 60,
  requireEmailVerification: true,
};

export const ROLE_PERMISSIONS: Record<TenantMemberRole, string[]> = {
  owner: ['*:*'], // Full access
  admin: [
    'tenant:read', 'tenant:update',
    'member:*', 'team:*', 'project:*',
    'deployment:*', 'environment:*',
    'api_key:*', 'audit:read',
    'billing:read',
  ],
  member: [
    'tenant:read',
    'deployment:create', 'deployment:read', 'deployment:update', 'deployment:execute',
    'environment:read',
    'api_key:create', 'api_key:read', 'api_key:delete',
  ],
  viewer: [
    'tenant:read',
    'deployment:read',
    'environment:read',
  ],
  billing: [
    'tenant:read',
    'billing:*',
    'subscription:*',
  ],
};

export const MFA_REQUIRED_TIERS: TenantTier[] = ['enterprise'];

export const TOKEN_ALGORITHMS = {
  access: 'RS256',
  refresh: 'HS512',
  apiKey: 'HS256',
} as const;
