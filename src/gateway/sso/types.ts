/**
 * Enterprise SSO/RBAC — Shared Types
 *
 * Types for OIDC/SAML-based single sign-on, session management,
 * and user identity resolution within the gateway auth flow.
 */

// =============================================================================
// SSO Configuration
// =============================================================================

/** Supported SSO identity providers. */
export type SSOProviderType = "oidc" | "saml";

/**
 * SSO configuration stored in gateway config.
 * Set via `espada config set gateway.auth.sso.*` or `espada auth sso configure`.
 */
export type SSOConfig = {
  /** SSO provider type. */
  provider: SSOProviderType;

  /** OIDC issuer URL (e.g. https://login.microsoftonline.com/{tenant}/v2.0). */
  issuerUrl: string;

  /** OAuth2 client ID registered with the IdP. */
  clientId: string;

  /** OAuth2 client secret. */
  clientSecret: string;

  /** Redirect URI for authorization code flow. */
  callbackUrl: string;

  /** OAuth2 scopes to request (default: ["openid", "profile", "email"]). */
  scopes: string[];

  /**
   * Map IdP groups/roles → Espada roles.
   * Example: `{ "Engineering": "developer", "SRE": "operator", "Platform": "admin" }`
   */
  roleMapping: Record<string, string>;

  /** Whether to allow non-SSO auth modes when SSO is configured. */
  allowFallback: boolean;
};

export const DEFAULT_SSO_CONFIG: Partial<SSOConfig> = {
  scopes: ["openid", "profile", "email"],
  roleMapping: {},
  allowFallback: true,
};

// =============================================================================
// OIDC Discovery & Tokens
// =============================================================================

/** Standard OIDC discovery document (subset of fields we use). */
export type OIDCDiscoveryDocument = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  scopes_supported: string[];
  response_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
};

/** OIDC token response from the token endpoint. */
export type OIDCTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token: string;
  scope?: string;
};

/** Decoded claims from an OIDC ID token (standard + common claims). */
export type OIDCIdTokenClaims = {
  /** Issuer. */
  iss: string;
  /** Subject (user ID at the IdP). */
  sub: string;
  /** Audience (client ID). */
  aud: string | string[];
  /** Expiration time (Unix seconds). */
  exp: number;
  /** Issued at (Unix seconds). */
  iat: number;
  /** Auth time (Unix seconds). */
  auth_time?: number;
  /** Nonce (if provided in auth request). */
  nonce?: string;
  /** Email address. */
  email?: string;
  /** Whether email is verified. */
  email_verified?: boolean;
  /** Full name. */
  name?: string;
  /** Given name. */
  given_name?: string;
  /** Family name. */
  family_name?: string;
  /** Profile picture URL. */
  picture?: string;
  /** Groups claim (common in Okta, Entra ID). */
  groups?: string[];
  /** Roles claim (common in Entra ID). */
  roles?: string[];
  /** Additional claims. */
  [key: string]: unknown;
};

// =============================================================================
// SSO Session
// =============================================================================

/**
 * An active SSO session. Created after successful OIDC/SAML authentication.
 * Stored in the session store and referenced by a session token (JWT).
 */
export type SSOSession = {
  /** Unique session ID (UUID). */
  id: string;

  /** IdP user identifier (sub claim). */
  userId: string;

  /** User email. */
  email: string;

  /** User display name. */
  name: string;

  /** Resolved Espada roles (mapped from IdP groups via roleMapping). */
  roles: string[];

  /** Raw IdP groups (before mapping). */
  idpGroups: string[];

  /** When the session was created (ISO-8601). */
  issuedAt: string;

  /** When the session expires (ISO-8601). */
  expiresAt: string;

  /** OIDC refresh token (encrypted at rest). */
  refreshToken?: string;

  /** SSO provider that issued this session. */
  provider: SSOProviderType;

  /** IP address of the authenticating client. */
  clientIp?: string;

  /** User agent of the authenticating client. */
  userAgent?: string;

  /** Last activity timestamp (ISO-8601). */
  lastActivityAt: string;
};

// =============================================================================
// SSO User (Resolved Identity)
// =============================================================================

/**
 * A resolved user identity, attached to GatewayClient after successful auth.
 * This is the "who is this person" record used for authorization decisions.
 */
export type SSOUser = {
  /** IdP user identifier. */
  id: string;

  /** User email. */
  email: string;

  /** User display name. */
  name: string;

  /** Resolved Espada roles. */
  roles: string[];

  /** IdP groups. */
  groups: string[];

  /** Whether MFA was used for this authentication. */
  mfaVerified: boolean;

  /** Last login timestamp (ISO-8601). */
  lastLogin: string;

  /** SSO provider. */
  provider: SSOProviderType;
};

// =============================================================================
// Auth Result Extension
// =============================================================================

/**
 * Extended auth result that includes SSO identity information.
 * Extends the existing GatewayAuthResult pattern.
 */
export type SSOAuthResult = {
  ok: boolean;
  method: "sso";
  user?: string;
  ssoUser?: SSOUser;
  sessionId?: string;
  reason?: string;
};

// =============================================================================
// Session Store Interface
// =============================================================================

/**
 * Persistent storage for SSO sessions.
 * Implementations: InMemorySessionStore (dev/test), FileSessionStore (production).
 */
export interface SessionStore {
  /** Save or update a session. */
  save(session: SSOSession): Promise<void>;

  /** Get a session by ID. Returns null if not found or expired. */
  get(id: string): Promise<SSOSession | null>;

  /** Delete a session (logout). */
  delete(id: string): Promise<void>;

  /** List all active (non-expired) sessions. */
  listActive(): Promise<SSOSession[]>;

  /** Get all sessions for a specific user. */
  getUserSessions(userId: string): Promise<SSOSession[]>;

  /** Delete all sessions for a specific user (force logout). */
  deleteUserSessions(userId: string): Promise<void>;

  /** Remove expired sessions. */
  prune(): Promise<number>;
}
