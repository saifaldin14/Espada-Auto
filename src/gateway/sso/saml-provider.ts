/**
 * Enterprise SSO — SAML 2.0 Provider
 *
 * Implements SAML 2.0 assertion parsing, AuthnRequest generation,
 * and identity resolution for legacy enterprise IdPs. Phase 2 of
 * SSO support (OIDC is primary, SAML for legacy compliance).
 *
 * No external SAML library required — uses built-in XML parsing
 * and base64 decoding for assertion processing. For production
 * signature verification, integrate `xml-crypto` or similar.
 */

import type { SSOConfig, SSOSession, SSOUser } from "./types.js";
import { randomUUID } from "node:crypto";

// =============================================================================
// Types
// =============================================================================

/** Parsed SAML 2.0 assertion with extracted attributes. */
export interface SAMLAssertion {
  /** Issuer of the assertion (IdP entity ID). */
  issuer: string;
  /** Subject NameID (user identifier). */
  nameId: string;
  /** NameID format (e.g., email, persistent, transient). */
  nameIdFormat: string;
  /** Session index for single-logout. */
  sessionIndex?: string;
  /** Assertion conditions: not-before timestamp. */
  notBefore?: string;
  /** Assertion conditions: not-on-or-after timestamp. */
  notOnOrAfter?: string;
  /** Extracted user attributes from AttributeStatement. */
  attributes: Record<string, string[]>;
}

/** SAML AuthnRequest parameters for IdP redirect. */
export interface SAMLAuthnRequest {
  /** The full redirect URL to send the user agent to. */
  redirectUrl: string;
  /** Request ID for correlation with the response. */
  requestId: string;
  /** Base64-encoded AuthnRequest XML. */
  encodedRequest: string;
}

/** SAML metadata from the IdP. */
export interface SAMLIdPMetadata {
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  certificate?: string;
  nameIdFormat: string;
}

// =============================================================================
// SAML Provider
// =============================================================================

export class SAMLProvider {
  private config: SSOConfig;
  private metadata: SAMLIdPMetadata | null = null;

  /** Standard SAML NameID formats. */
  static readonly NAME_ID_FORMAT = {
    EMAIL: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    PERSISTENT: "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
    TRANSIENT: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
    UNSPECIFIED: "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
  } as const;

  /** Common SAML attribute names. */
  static readonly ATTRIBUTES = {
    EMAIL: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    NAME: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    GIVEN_NAME: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
    SURNAME: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
    GROUPS: "http://schemas.xmlsoap.org/claims/Group",
    ROLE: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
  } as const;

  constructor(config: SSOConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // IdP Metadata
  // ---------------------------------------------------------------------------

  /**
   * Set IdP metadata manually (from admin configuration).
   */
  setMetadata(metadata: SAMLIdPMetadata): void {
    this.metadata = metadata;
  }

  /**
   * Fetch and parse SAML IdP metadata from the issuer URL.
   * The issuer URL should point to the IdP's metadata XML endpoint.
   */
  async fetchMetadata(): Promise<SAMLIdPMetadata> {
    const response = await fetch(this.config.issuerUrl, {
      headers: { Accept: "application/xml, text/xml" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new SAMLError(
        `Failed to fetch SAML metadata from ${this.config.issuerUrl}: ${response.status}`,
      );
    }

    const xml = await response.text();
    this.metadata = this.parseMetadataXml(xml);
    return this.metadata;
  }

  /**
   * Parse IdP metadata XML and extract key fields.
   * Uses basic string matching — sufficient for standard metadata documents.
   */
  parseMetadataXml(xml: string): SAMLIdPMetadata {
    const entityId = extractXmlValue(xml, "entityID") ?? "";
    const ssoUrl =
      extractXmlAttribute(xml, "SingleSignOnService", "Location", "HTTP-Redirect") ?? "";
    const sloUrl = extractXmlAttribute(xml, "SingleLogoutService", "Location", "HTTP-Redirect");
    const certificate = extractXmlContent(xml, "X509Certificate");
    const nameIdFormat =
      extractXmlContent(xml, "NameIDFormat") ?? SAMLProvider.NAME_ID_FORMAT.EMAIL;

    return { entityId, ssoUrl, sloUrl, certificate, nameIdFormat };
  }

  // ---------------------------------------------------------------------------
  // AuthnRequest Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a SAML AuthnRequest and return the IdP redirect URL.
   * Uses HTTP-Redirect binding (GET with deflated, base64-encoded request).
   */
  generateAuthnRequest(relayState?: string): SAMLAuthnRequest {
    if (!this.metadata) {
      throw new SAMLError("IdP metadata not loaded. Call fetchMetadata() or setMetadata() first.");
    }

    const requestId = `_${randomUUID()}`;
    const issueInstant = new Date().toISOString();

    const xml = [
      '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      `  ID="${requestId}"`,
      '  Version="2.0"',
      `  IssueInstant="${issueInstant}"`,
      `  Destination="${this.metadata.ssoUrl}"`,
      `  AssertionConsumerServiceURL="${this.config.callbackUrl}"`,
      '  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">',
      `  <saml:Issuer>${this.config.clientId}</saml:Issuer>`,
      "  <samlp:NameIDPolicy",
      `    Format="${this.metadata.nameIdFormat}"`,
      '    AllowCreate="true"/>',
      "</samlp:AuthnRequest>",
    ].join("\n");

    const encodedRequest = Buffer.from(xml, "utf8").toString("base64");

    const params = new URLSearchParams({ SAMLRequest: encodedRequest });
    if (relayState) params.set("RelayState", relayState);

    const redirectUrl = `${this.metadata.ssoUrl}?${params.toString()}`;

    return { redirectUrl, requestId, encodedRequest };
  }

  // ---------------------------------------------------------------------------
  // Response / Assertion Processing
  // ---------------------------------------------------------------------------

  /**
   * Parse and validate a SAML Response (received at the ACS endpoint).
   * The response body is base64-encoded XML from the IdP POST.
   */
  parseResponse(samlResponseB64: string): SAMLAssertion {
    const xml = Buffer.from(samlResponseB64, "base64").toString("utf8");

    // Extract assertion
    const issuer = extractXmlContent(xml, "saml:Issuer") ?? extractXmlContent(xml, "Issuer") ?? "";

    const nameId = extractXmlContent(xml, "saml:NameID") ?? extractXmlContent(xml, "NameID") ?? "";

    const nameIdFormat =
      extractXmlAttribute(xml, "NameID", "Format") ?? SAMLProvider.NAME_ID_FORMAT.UNSPECIFIED;

    const sessionIndex = extractXmlAttribute(xml, "AuthnStatement", "SessionIndex");

    const notBefore = extractXmlAttribute(xml, "Conditions", "NotBefore");
    const notOnOrAfter = extractXmlAttribute(xml, "Conditions", "NotOnOrAfter");

    // Validate time conditions
    if (notOnOrAfter) {
      const expiry = new Date(notOnOrAfter).getTime();
      if (Date.now() > expiry + 60_000) {
        // 60s clock skew tolerance
        throw new SAMLError("SAML assertion has expired");
      }
    }

    if (notBefore) {
      const start = new Date(notBefore).getTime();
      if (Date.now() < start - 60_000) {
        throw new SAMLError("SAML assertion is not yet valid");
      }
    }

    const attributes = extractSamlAttributes(xml);

    return {
      issuer,
      nameId,
      nameIdFormat,
      sessionIndex,
      notBefore,
      notOnOrAfter,
      attributes,
    };
  }

  // ---------------------------------------------------------------------------
  // User Resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve an SSOUser from a parsed SAML assertion.
   * Maps IdP groups/roles to Espada roles using the configured roleMapping.
   */
  resolveUser(assertion: SAMLAssertion): SSOUser {
    const email =
      assertion.attributes[SAMLProvider.ATTRIBUTES.EMAIL]?.[0] ??
      (assertion.nameIdFormat === SAMLProvider.NAME_ID_FORMAT.EMAIL ? assertion.nameId : "");

    const name =
      assertion.attributes[SAMLProvider.ATTRIBUTES.NAME]?.[0] ??
      buildDisplayName(assertion.attributes) ??
      email ??
      assertion.nameId;

    const idpGroups = [
      ...(assertion.attributes[SAMLProvider.ATTRIBUTES.GROUPS] ?? []),
      ...(assertion.attributes[SAMLProvider.ATTRIBUTES.ROLE] ?? []),
    ];

    const resolvedRoles = this.mapGroupsToRoles(idpGroups);

    return {
      id: assertion.nameId,
      email,
      name,
      roles: resolvedRoles,
      groups: idpGroups,
      mfaVerified: false,
      lastLogin: new Date().toISOString(),
      provider: "saml",
    };
  }

  /**
   * Create an SSO session from a SAML assertion.
   */
  createSessionFromAssertion(
    assertion: SAMLAssertion,
    options?: { clientIp?: string; userAgent?: string },
  ): { session: SSOSession; user: SSOUser } {
    const user = this.resolveUser(assertion);
    const now = new Date();

    // Session expiry: use assertion NotOnOrAfter if available, else 8 hours
    const expiresAt = assertion.notOnOrAfter
      ? new Date(assertion.notOnOrAfter)
      : new Date(now.getTime() + 8 * 60 * 60 * 1000);

    const session: SSOSession = {
      id: randomUUID(),
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      idpGroups: user.groups,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      provider: "saml",
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
   * Generate a SAML LogoutRequest URL for single-logout (SLO).
   */
  generateLogoutRequest(nameId: string, sessionIndex?: string): string | null {
    if (!this.metadata?.sloUrl) return null;

    const requestId = `_${randomUUID()}`;
    const issueInstant = new Date().toISOString();

    const xml = [
      '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      `  ID="${requestId}"`,
      '  Version="2.0"',
      `  IssueInstant="${issueInstant}"`,
      `  Destination="${this.metadata.sloUrl}">`,
      `  <saml:Issuer>${this.config.clientId}</saml:Issuer>`,
      `  <saml:NameID>${nameId}</saml:NameID>`,
      sessionIndex ? `  <samlp:SessionIndex>${sessionIndex}</samlp:SessionIndex>` : "",
      "</samlp:LogoutRequest>",
    ]
      .filter(Boolean)
      .join("\n");

    const encoded = Buffer.from(xml, "utf8").toString("base64");
    return `${this.metadata.sloUrl}?SAMLRequest=${encodeURIComponent(encoded)}`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Map IdP groups to Espada roles using the configured roleMapping.
   */
  private mapGroupsToRoles(idpGroups: string[]): string[] {
    const roleMapping = this.config.roleMapping;
    const roles = new Set<string>();

    for (const group of idpGroups) {
      const mappedRole = roleMapping[group];
      if (mappedRole) roles.add(mappedRole);
    }

    if (roles.size === 0) roles.add("viewer");
    return [...roles];
  }

  /** Get the configured issuer URL. */
  getIssuerUrl(): string {
    return this.config.issuerUrl;
  }

  /** Check whether metadata has been loaded. */
  hasMetadata(): boolean {
    return this.metadata !== null;
  }

  /** Get the loaded metadata (or null). */
  getMetadata(): SAMLIdPMetadata | null {
    return this.metadata;
  }
}

// =============================================================================
// XML Helpers (lightweight — no external XML parser needed)
// =============================================================================

/** Extract the value of a named XML attribute from the first matching element. */
function extractXmlAttribute(
  xml: string,
  elementName: string,
  attributeName: string,
  bindingFilter?: string,
): string | undefined {
  // Build regex to find element with the attribute
  const pattern = bindingFilter
    ? new RegExp(`<[^>]*${elementName}[^>]*${bindingFilter}[^>]*${attributeName}="([^"]*)"`, "s")
    : new RegExp(`<[^>]*${elementName}[^>]*${attributeName}="([^"]*)"`, "s");

  const match = pattern.exec(xml);
  return match?.[1];
}

/** Extract the value attribute from a named XML element (e.g. entityID="..."). */
function extractXmlValue(xml: string, attributeName: string): string | undefined {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "s");
  const match = pattern.exec(xml);
  return match?.[1];
}

/** Extract text content between opening and closing XML tags. */
function extractXmlContent(xml: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "s");
  const match = pattern.exec(xml);
  return match?.[1]?.trim();
}

/** Extract SAML attributes from AttributeStatement. */
function extractSamlAttributes(xml: string): Record<string, string[]> {
  const attributes: Record<string, string[]> = {};

  // Match Attribute elements with Name and AttributeValue children
  const attrPattern =
    /<(?:saml:)?Attribute\s+Name="([^"]*)"[^>]*>([\s\S]*?)<\/(?:saml:)?Attribute>/g;
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrPattern.exec(xml)) !== null) {
    const name = attrMatch[1]!;
    const body = attrMatch[2]!;

    const values: string[] = [];
    const valuePattern = /<(?:saml:)?AttributeValue[^>]*>([^<]*)<\/(?:saml:)?AttributeValue>/g;
    let valueMatch: RegExpExecArray | null;

    while ((valueMatch = valuePattern.exec(body)) !== null) {
      values.push(valueMatch[1]!.trim());
    }

    attributes[name] = values;
  }

  return attributes;
}

/** Build a display name from SAML given name + surname attributes. */
function buildDisplayName(attributes: Record<string, string[]>): string | undefined {
  const givenName = attributes[SAMLProvider.ATTRIBUTES.GIVEN_NAME]?.[0];
  const surname = attributes[SAMLProvider.ATTRIBUTES.SURNAME]?.[0];

  if (givenName && surname) return `${givenName} ${surname}`;
  if (givenName) return givenName;
  return undefined;
}

// =============================================================================
// Error Type
// =============================================================================

export class SAMLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SAMLError";
  }
}
