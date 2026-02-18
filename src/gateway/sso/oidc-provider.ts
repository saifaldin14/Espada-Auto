/**
 * Enterprise SSO — OIDC Provider
 *
 * Implements OpenID Connect discovery, authorization code flow,
 * token exchange, and ID token validation. Supports Okta, Microsoft
 * Entra ID, Google Workspace, Auth0, and any standards-compliant IdP.
 *
 * No external OIDC library required — uses native fetch + jose-style
 * JWT decoding (base64url parsing of unsigned token for claims).
 * For production JWKS verification, integrate `jose` or similar.
 */

import type {
  SSOConfig,
  OIDCDiscoveryDocument,
  OIDCTokenResponse,
  OIDCIdTokenClaims,
  SSOSession,
  SSOUser,
} from "./types.js";
import { randomUUID } from "node:crypto";

// =============================================================================
// OIDC Provider
// =============================================================================

export class OIDCProvider {
  private config: SSOConfig;
  private discoveryDoc: OIDCDiscoveryDocument | null = null;
  private discoveryFetchedAt = 0;

  /** Cache discovery documents for 1 hour. */
  private static readonly DISCOVERY_TTL_MS = 60 * 60 * 1000;

  constructor(config: SSOConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /**
   * Fetch the OIDC discovery document from the issuer's well-known endpoint.
   * Results are cached for 1 hour to avoid repeated network calls.
   */
  async discover(): Promise<OIDCDiscoveryDocument> {
    const now = Date.now();
    if (this.discoveryDoc && now - this.discoveryFetchedAt < OIDCProvider.DISCOVERY_TTL_MS) {
      return this.discoveryDoc;
    }

    const wellKnownUrl = `${this.config.issuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`;

    const response = await fetch(wellKnownUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new OIDCError(
        `Failed to fetch OIDC discovery document from ${wellKnownUrl}: ${response.status} ${response.statusText}`,
      );
    }

    this.discoveryDoc = (await response.json()) as OIDCDiscoveryDocument;
    this.discoveryFetchedAt = now;
    return this.discoveryDoc;
  }

  // ---------------------------------------------------------------------------
  // Authorization URL
  // ---------------------------------------------------------------------------

  /**
   * Build the authorization URL for the browser redirect.
   * The user agent navigates here to begin the OIDC auth code flow.
   */
  async getAuthorizationUrl(state: string, nonce: string): Promise<string> {
    const doc = await this.discover();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      scope: this.config.scopes.join(" "),
      state,
      nonce,
    });

    return `${doc.authorization_endpoint}?${params.toString()}`;
  }

  // ---------------------------------------------------------------------------
  // Token Exchange
  // ---------------------------------------------------------------------------

  /**
   * Exchange an authorization code for tokens (access, refresh, id_token).
   * Called from the `/auth/callback` HTTP handler after the IdP redirects.
   */
  async exchangeCode(code: string): Promise<OIDCTokenResponse> {
    const doc = await this.discover();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.callbackUrl,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new OIDCError(
        `Token exchange failed: ${response.status} ${response.statusText}. ${errorBody}`,
      );
    }

    return (await response.json()) as OIDCTokenResponse;
  }

  // ---------------------------------------------------------------------------
  // Token Refresh
  // ---------------------------------------------------------------------------

  /**
   * Refresh an access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<OIDCTokenResponse> {
    const doc = await this.discover();

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new OIDCError(`Token refresh failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as OIDCTokenResponse;
  }

  // ---------------------------------------------------------------------------
  // ID Token Decoding & Validation
  // ---------------------------------------------------------------------------

  /**
   * Decode and validate an OIDC ID token.
   *
   * Performs structural validation (3-part JWT, valid JSON payload),
   * issuer/audience/expiration checks. For production deployments
   * with external traffic, add JWKS signature verification.
   */
  decodeIdToken(idToken: string): OIDCIdTokenClaims {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      throw new OIDCError("Invalid ID token: expected 3 JWT parts");
    }

    const payloadB64 = parts[1]!;
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");

    let claims: OIDCIdTokenClaims;
    try {
      claims = JSON.parse(payloadJson) as OIDCIdTokenClaims;
    } catch {
      throw new OIDCError("Invalid ID token: payload is not valid JSON");
    }

    // Validate issuer
    const expectedIssuer = this.config.issuerUrl.replace(/\/+$/, "");
    const tokenIssuer = (claims.iss ?? "").replace(/\/+$/, "");
    if (tokenIssuer !== expectedIssuer) {
      throw new OIDCError(
        `ID token issuer mismatch: expected "${expectedIssuer}", got "${tokenIssuer}"`,
      );
    }

    // Validate audience
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.config.clientId)) {
      throw new OIDCError(
        `ID token audience mismatch: expected "${this.config.clientId}", got "${aud.join(", ")}"`,
      );
    }

    // Validate expiration (with 60s clock skew tolerance)
    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp + 60 < nowSec) {
      throw new OIDCError("ID token has expired");
    }

    return claims;
  }

  // ---------------------------------------------------------------------------
  // User Resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve an SSOUser from ID token claims.
   * Maps IdP groups to Espada roles using the configured roleMapping.
   */
  resolveUser(claims: OIDCIdTokenClaims): SSOUser {
    const idpGroups = claims.groups ?? claims.roles ?? [];
    const resolvedRoles = this.mapGroupsToRoles(idpGroups);

    return {
      id: claims.sub,
      email: claims.email ?? "",
      name: claims.name ?? claims.email ?? claims.sub,
      roles: resolvedRoles,
      groups: idpGroups,
      mfaVerified: false,
      lastLogin: new Date().toISOString(),
      provider: "oidc",
    };
  }

  /**
   * Create an SSO session from a token response.
   * Decodes the ID token, resolves user identity, and builds a session.
   */
  createSessionFromTokens(
    tokenResponse: OIDCTokenResponse,
    options?: { clientIp?: string; userAgent?: string },
  ): { session: SSOSession; user: SSOUser } {
    const claims = this.decodeIdToken(tokenResponse.id_token);
    const user = this.resolveUser(claims);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenResponse.expires_in * 1000);

    const session: SSOSession = {
      id: randomUUID(),
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      idpGroups: user.groups,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      refreshToken: tokenResponse.refresh_token,
      provider: "oidc",
      clientIp: options?.clientIp,
      userAgent: options?.userAgent,
      lastActivityAt: now.toISOString(),
    };

    return { session, user };
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  /**
   * Get the IdP logout URL (if the provider supports end_session_endpoint).
   */
  async getLogoutUrl(idTokenHint?: string, postLogoutRedirectUri?: string): Promise<string | null> {
    const doc = await this.discover();
    if (!doc.end_session_endpoint) return null;

    const params = new URLSearchParams();
    if (idTokenHint) params.set("id_token_hint", idTokenHint);
    if (postLogoutRedirectUri) params.set("post_logout_redirect_uri", postLogoutRedirectUri);
    params.set("client_id", this.config.clientId);

    return `${doc.end_session_endpoint}?${params.toString()}`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Map IdP groups to Espada roles using the configured roleMapping.
   * If no mapping matches, assign "viewer" as default role.
   */
  private mapGroupsToRoles(idpGroups: string[]): string[] {
    const roleMapping = this.config.roleMapping;
    const roles = new Set<string>();

    for (const group of idpGroups) {
      const mappedRole = roleMapping[group];
      if (mappedRole) {
        roles.add(mappedRole);
      }
    }

    // Default to viewer if no roles matched
    if (roles.size === 0) {
      roles.add("viewer");
    }

    return [...roles];
  }

  /** Get the configured issuer URL. */
  getIssuerUrl(): string {
    return this.config.issuerUrl;
  }

  /** Clear the cached discovery document (for testing). */
  clearCache(): void {
    this.discoveryDoc = null;
    this.discoveryFetchedAt = 0;
  }
}

// =============================================================================
// Error Type
// =============================================================================

export class OIDCError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OIDCError";
  }
}
