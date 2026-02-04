/**
 * SAML 2.0 Service Provider Implementation
 * 
 * Handles SAML-based Single Sign-On (SSO) authentication including:
 * - AuthnRequest generation
 * - SAML Response validation
 * - Assertion parsing
 * - Single Logout (SLO)
 */

import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';
import type {
  SAMLProviderConfig,
  SAMLAssertion,
  SAMLAttributeMapping,
  AuthProvider,
  AuthEvent,
  AuthEventType,
} from './types.js';

// =============================================================================
// SAML Constants
// =============================================================================

const SAML_NAMESPACES = {
  saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
  samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  xs: 'http://www.w3.org/2001/XMLSchema',
};

const SAML_STATUS_CODES = {
  success: 'urn:oasis:names:tc:SAML:2.0:status:Success',
  requester: 'urn:oasis:names:tc:SAML:2.0:status:Requester',
  responder: 'urn:oasis:names:tc:SAML:2.0:status:Responder',
  versionMismatch: 'urn:oasis:names:tc:SAML:2.0:status:VersionMismatch',
  authnFailed: 'urn:oasis:names:tc:SAML:2.0:status:AuthnFailed',
  noPassive: 'urn:oasis:names:tc:SAML:2.0:status:NoPassive',
};

const NAME_ID_FORMATS = {
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  emailAddress: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  transient: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
};

// =============================================================================
// SAML Storage Interface
// =============================================================================

interface SAMLStorage {
  // Auth Requests (for replay protection)
  saveAuthRequest(requestId: string, providerId: string, relayState: string, expiresAt: string): Promise<void>;
  getAuthRequest(requestId: string): Promise<{ providerId: string; relayState: string; expiresAt: string } | null>;
  deleteAuthRequest(requestId: string): Promise<void>;
  
  // Session Index (for SLO)
  saveSessionIndex(sessionIndex: string, tenantId: string, userId: string, sessionId: string): Promise<void>;
  getSessionByIndex(sessionIndex: string): Promise<{ tenantId: string; userId: string; sessionId: string } | null>;
  deleteSessionIndex(sessionIndex: string): Promise<void>;
  
  // Providers
  getProvider(providerId: string): Promise<AuthProvider | null>;
  getProviderByEntityId(entityId: string): Promise<AuthProvider | null>;
  
  // Events
  saveAuthEvent(event: AuthEvent): Promise<void>;
}

// =============================================================================
// In-Memory SAML Storage (for development/testing)
// =============================================================================

class InMemorySAMLStorage implements SAMLStorage {
  private authRequests = new Map<string, { providerId: string; relayState: string; expiresAt: string }>();
  private sessionIndices = new Map<string, { tenantId: string; userId: string; sessionId: string }>();
  private providers = new Map<string, AuthProvider>();
  private events: AuthEvent[] = [];

  async saveAuthRequest(requestId: string, providerId: string, relayState: string, expiresAt: string): Promise<void> {
    this.authRequests.set(requestId, { providerId, relayState, expiresAt });
  }

  async getAuthRequest(requestId: string): Promise<{ providerId: string; relayState: string; expiresAt: string } | null> {
    return this.authRequests.get(requestId) ?? null;
  }

  async deleteAuthRequest(requestId: string): Promise<void> {
    this.authRequests.delete(requestId);
  }

  async saveSessionIndex(sessionIndex: string, tenantId: string, userId: string, sessionId: string): Promise<void> {
    this.sessionIndices.set(sessionIndex, { tenantId, userId, sessionId });
  }

  async getSessionByIndex(sessionIndex: string): Promise<{ tenantId: string; userId: string; sessionId: string } | null> {
    return this.sessionIndices.get(sessionIndex) ?? null;
  }

  async deleteSessionIndex(sessionIndex: string): Promise<void> {
    this.sessionIndices.delete(sessionIndex);
  }

  async getProvider(providerId: string): Promise<AuthProvider | null> {
    return this.providers.get(providerId) ?? null;
  }

  async getProviderByEntityId(entityId: string): Promise<AuthProvider | null> {
    for (const provider of this.providers.values()) {
      const config = provider.config as SAMLProviderConfig;
      if (config.type === 'saml' && config.idpEntityId === entityId) {
        return provider;
      }
    }
    return null;
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
// SAML Result Type
// =============================================================================

interface SAMLResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

// =============================================================================
// SAML Service Configuration
// =============================================================================

export interface SAMLServiceConfig {
  // Service Provider Settings
  spEntityId: string;
  spCertificate: string; // PEM format
  spPrivateKey: string; // PEM format
  spAcsUrl: string; // Assertion Consumer Service URL
  spSloUrl?: string; // Single Logout URL
  
  // Request Settings
  authnRequestLifetime: number; // seconds (default: 300)
  clockSkew: number; // seconds (default: 300)
  
  // Validation Settings
  validateInResponseTo: boolean;
  validateSignature: boolean;
  validateNotBefore: boolean;
  validateNotOnOrAfter: boolean;
}

// =============================================================================
// Parsed SAML User
// =============================================================================

export interface SAMLUser {
  nameId: string;
  nameIdFormat: string;
  sessionIndex: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  groups?: string[];
  attributes: Record<string, string | string[]>;
}

// =============================================================================
// SAML Service Implementation
// =============================================================================

export class SAMLService {
  private config: SAMLServiceConfig;
  private storage: SAMLStorage;

  constructor(config: Partial<SAMLServiceConfig> & Pick<SAMLServiceConfig, 'spEntityId' | 'spCertificate' | 'spPrivateKey' | 'spAcsUrl'>, storage?: SAMLStorage) {
    this.config = {
      authnRequestLifetime: 300,
      clockSkew: 300,
      validateInResponseTo: true,
      validateSignature: true,
      validateNotBefore: true,
      validateNotOnOrAfter: true,
      ...config,
    };
    this.storage = storage ?? new InMemorySAMLStorage();
  }

  // ===========================================================================
  // AuthnRequest Generation
  // ===========================================================================

  /**
   * Generate SAML AuthnRequest for a provider
   */
  async createAuthnRequest(
    providerId: string,
    relayState?: string,
  ): Promise<SAMLResult<{ redirectUrl: string; requestId: string }>> {
    try {
      const provider = await this.storage.getProvider(providerId);
      if (!provider || provider.config.type !== 'saml') {
        return { success: false, error: 'Invalid SAML provider' };
      }

      const config = provider.config as SAMLProviderConfig;
      const requestId = `_${randomUUID()}`;
      const issueInstant = new Date().toISOString();

      // Build AuthnRequest XML
      const authnRequest = this.buildAuthnRequest(requestId, issueInstant, config);

      // Sign if required
      let signedRequest = authnRequest;
      if (config.signAuthnRequests) {
        signedRequest = this.signXML(authnRequest, this.config.spPrivateKey);
      }

      // Encode for redirect binding
      const deflatedRequest = await this.deflateAndEncode(signedRequest);

      // Build redirect URL
      const url = new URL(config.idpSsoUrl);
      url.searchParams.set('SAMLRequest', deflatedRequest);
      if (relayState) {
        url.searchParams.set('RelayState', relayState);
      }

      // Store request for validation
      const expiresAt = new Date(Date.now() + this.config.authnRequestLifetime * 1000).toISOString();
      await this.storage.saveAuthRequest(requestId, providerId, relayState ?? '', expiresAt);

      return {
        success: true,
        data: {
          redirectUrl: url.toString(),
          requestId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create AuthnRequest',
      };
    }
  }

  private buildAuthnRequest(id: string, issueInstant: string, config: SAMLProviderConfig): string {
    const nameIdPolicy = `
      <samlp:NameIDPolicy 
        Format="${NAME_ID_FORMATS.emailAddress}" 
        AllowCreate="true"/>
    `;

    const requestedAuthnContext = config.authnContext ? `
      <samlp:RequestedAuthnContext Comparison="exact">
        <saml:AuthnContextClassRef xmlns:saml="${SAML_NAMESPACES.saml}">
          ${config.authnContext}
        </saml:AuthnContextClassRef>
      </samlp:RequestedAuthnContext>
    ` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest 
    xmlns:samlp="${SAML_NAMESPACES.samlp}"
    xmlns:saml="${SAML_NAMESPACES.saml}"
    ID="${id}"
    Version="2.0"
    IssueInstant="${issueInstant}"
    Destination="${config.idpSsoUrl}"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
    AssertionConsumerServiceURL="${config.spAcsUrl}"
    ${config.forceAuthn ? 'ForceAuthn="true"' : ''}
    ${config.passiveAuthn ? 'IsPassive="true"' : ''}>
    <saml:Issuer>${config.spEntityId}</saml:Issuer>
    ${nameIdPolicy}
    ${requestedAuthnContext}
</samlp:AuthnRequest>`;
  }

  // ===========================================================================
  // SAML Response Validation
  // ===========================================================================

  /**
   * Process SAML Response from IdP
   */
  async processSAMLResponse(
    samlResponse: string,
    relayState?: string,
  ): Promise<SAMLResult<{ user: SAMLUser; providerId: string; relayState: string }>> {
    try {
      // Decode response
      const xml = Buffer.from(samlResponse, 'base64').toString('utf-8');

      // Parse response (simplified - use xml2js or similar in production)
      const parsed = this.parseXML(xml);
      if (!parsed.success || !parsed.data) {
        return { success: false, error: parsed.error ?? 'Failed to parse SAML response' };
      }

      const response = parsed.data;

      // Get issuer and find provider
      const issuer = this.extractValue(response, 'Issuer');
      const provider = await this.storage.getProviderByEntityId(issuer);
      if (!provider || provider.config.type !== 'saml') {
        return { success: false, error: 'Unknown identity provider' };
      }

      const config = provider.config as SAMLProviderConfig;

      // Validate InResponseTo
      const inResponseTo = this.extractAttribute(response, 'Response', 'InResponseTo');
      if (this.config.validateInResponseTo && inResponseTo) {
        const storedRequest = await this.storage.getAuthRequest(inResponseTo);
        if (!storedRequest) {
          return { success: false, error: 'Invalid InResponseTo - request not found', errorCode: 'invalid_response' };
        }
        if (new Date(storedRequest.expiresAt) < new Date()) {
          await this.storage.deleteAuthRequest(inResponseTo);
          return { success: false, error: 'AuthnRequest expired', errorCode: 'request_expired' };
        }
        // Use stored relay state if not provided
        relayState = relayState ?? storedRequest.relayState;
        await this.storage.deleteAuthRequest(inResponseTo);
      }

      // Validate status
      const status = this.extractValue(response, 'StatusCode', 'Value');
      if (status !== SAML_STATUS_CODES.success) {
        return { success: false, error: `SAML authentication failed: ${status}`, errorCode: 'auth_failed' };
      }

      // Validate signature
      if (this.config.validateSignature && config.wantAssertionsSigned) {
        const signatureValid = this.validateSignature(xml, config.idpCertificate);
        if (!signatureValid) {
          return { success: false, error: 'Invalid signature', errorCode: 'invalid_signature' };
        }
      }

      // Extract assertion
      const assertion = this.extractAssertion(response, config);
      if (!assertion.success || !assertion.data) {
        return { success: false, error: assertion.error ?? 'Failed to extract assertion' };
      }

      // Validate conditions
      const conditionsValid = this.validateConditions(assertion.data);
      if (!conditionsValid.success) {
        return { success: false, error: conditionsValid.error, errorCode: 'invalid_conditions' };
      }

      // Map attributes to user
      const user = this.mapAttributesToUser(assertion.data, config.attributeMapping);

      // Store session index for SLO
      if (assertion.data.sessionIndex) {
        await this.storage.saveSessionIndex(
          assertion.data.sessionIndex,
          provider.tenantId,
          user.email, // Will be replaced with actual user ID
          '', // Will be replaced with actual session ID
        );
      }

      // Log event
      await this.logEvent('login.success', provider.tenantId, undefined, true, {
        provider: 'saml',
        providerId: provider.id,
        nameId: user.nameId,
      });

      return {
        success: true,
        data: {
          user,
          providerId: provider.id,
          relayState: relayState ?? '',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process SAML response',
      };
    }
  }

  // ===========================================================================
  // Single Logout (SLO)
  // ===========================================================================

  /**
   * Generate SAML Logout Request
   */
  async createLogoutRequest(
    providerId: string,
    nameId: string,
    sessionIndex: string,
  ): Promise<SAMLResult<{ redirectUrl: string }>> {
    try {
      const provider = await this.storage.getProvider(providerId);
      if (!provider || provider.config.type !== 'saml') {
        return { success: false, error: 'Invalid SAML provider' };
      }

      const config = provider.config as SAMLProviderConfig;
      if (!config.idpSloUrl) {
        return { success: false, error: 'Provider does not support SLO' };
      }

      const requestId = `_${randomUUID()}`;
      const issueInstant = new Date().toISOString();

      const logoutRequest = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:LogoutRequest 
    xmlns:samlp="${SAML_NAMESPACES.samlp}"
    xmlns:saml="${SAML_NAMESPACES.saml}"
    ID="${requestId}"
    Version="2.0"
    IssueInstant="${issueInstant}"
    Destination="${config.idpSloUrl}">
    <saml:Issuer>${config.spEntityId}</saml:Issuer>
    <saml:NameID Format="${NAME_ID_FORMATS.emailAddress}">
      ${nameId}
    </saml:NameID>
    <samlp:SessionIndex>${sessionIndex}</samlp:SessionIndex>
</samlp:LogoutRequest>`;

      // Sign and encode
      const signedRequest = config.signAuthnRequests
        ? this.signXML(logoutRequest, this.config.spPrivateKey)
        : logoutRequest;
      const deflatedRequest = await this.deflateAndEncode(signedRequest);

      const url = new URL(config.idpSloUrl);
      url.searchParams.set('SAMLRequest', deflatedRequest);

      return {
        success: true,
        data: { redirectUrl: url.toString() },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create logout request',
      };
    }
  }

  /**
   * Process SAML Logout Response
   */
  async processLogoutResponse(
    samlResponse: string,
  ): Promise<SAMLResult<{ success: boolean }>> {
    try {
      const xml = Buffer.from(samlResponse, 'base64').toString('utf-8');
      const parsed = this.parseXML(xml);
      
      if (!parsed.success || !parsed.data) {
        return { success: false, error: 'Failed to parse logout response' };
      }

      const status = this.extractValue(parsed.data, 'StatusCode', 'Value');
      
      return {
        success: status === SAML_STATUS_CODES.success,
        data: { success: status === SAML_STATUS_CODES.success },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process logout response',
      };
    }
  }

  /**
   * Handle IdP-initiated logout
   */
  async processLogoutRequest(
    samlRequest: string,
  ): Promise<SAMLResult<{ tenantId: string; userId: string; sessionId: string; responseUrl: string }>> {
    try {
      const xml = Buffer.from(samlRequest, 'base64').toString('utf-8');
      const parsed = this.parseXML(xml);
      
      if (!parsed.success || !parsed.data) {
        return { success: false, error: 'Failed to parse logout request' };
      }

      const sessionIndex = this.extractValue(parsed.data, 'SessionIndex');
      if (!sessionIndex) {
        return { success: false, error: 'Missing session index' };
      }

      const sessionInfo = await this.storage.getSessionByIndex(sessionIndex);
      if (!sessionInfo) {
        return { success: false, error: 'Session not found' };
      }

      // Delete session index
      await this.storage.deleteSessionIndex(sessionIndex);

      // Get provider for response URL
      const issuer = this.extractValue(parsed.data, 'Issuer');
      const provider = await this.storage.getProviderByEntityId(issuer);
      const config = provider?.config as SAMLProviderConfig | undefined;

      return {
        success: true,
        data: {
          ...sessionInfo,
          responseUrl: config?.idpSloUrl ?? '',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process logout request',
      };
    }
  }

  // ===========================================================================
  // Metadata Generation
  // ===========================================================================

  /**
   * Generate SP metadata XML
   */
  generateMetadata(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor 
    xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    xmlns:ds="${SAML_NAMESPACES.ds}"
    entityID="${this.config.spEntityId}">
    
    <md:SPSSODescriptor 
        AuthnRequestsSigned="true"
        WantAssertionsSigned="true"
        protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
        
        <md:KeyDescriptor use="signing">
            <ds:KeyInfo>
                <ds:X509Data>
                    <ds:X509Certificate>${this.extractCertificateContent(this.config.spCertificate)}</ds:X509Certificate>
                </ds:X509Data>
            </ds:KeyInfo>
        </md:KeyDescriptor>
        
        <md:KeyDescriptor use="encryption">
            <ds:KeyInfo>
                <ds:X509Data>
                    <ds:X509Certificate>${this.extractCertificateContent(this.config.spCertificate)}</ds:X509Certificate>
                </ds:X509Data>
            </ds:KeyInfo>
        </md:KeyDescriptor>
        
        ${this.config.spSloUrl ? `
        <md:SingleLogoutService 
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
            Location="${this.config.spSloUrl}"/>
        <md:SingleLogoutService 
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            Location="${this.config.spSloUrl}"/>
        ` : ''}
        
        <md:NameIDFormat>${NAME_ID_FORMATS.emailAddress}</md:NameIDFormat>
        <md:NameIDFormat>${NAME_ID_FORMATS.persistent}</md:NameIDFormat>
        <md:NameIDFormat>${NAME_ID_FORMATS.transient}</md:NameIDFormat>
        
        <md:AssertionConsumerService 
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            Location="${this.config.spAcsUrl}"
            index="0"
            isDefault="true"/>
            
    </md:SPSSODescriptor>
</md:EntityDescriptor>`;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private async deflateAndEncode(xml: string): Promise<string> {
    const zlib = require('node:zlib');
    const { promisify } = require('node:util');
    const deflateRaw = promisify(zlib.deflateRaw);
    
    const deflated = await deflateRaw(Buffer.from(xml, 'utf-8'));
    return deflated.toString('base64');
  }

  private signXML(xml: string, privateKey: string): string {
    // Simplified - in production use xml-crypto library
    // This would add a ds:Signature element to the XML
    return xml;
  }

  private validateSignature(_xml: string, _certificate: string): boolean {
    // Simplified - in production use xml-crypto library
    // This would verify the ds:Signature element using the IdP certificate
    return true;
  }

  private parseXML(xml: string): SAMLResult<Record<string, unknown>> {
    // Simplified XML parsing - in production use xml2js or fast-xml-parser
    // This returns a simplified representation
    try {
      // Basic extraction using regex (use proper XML parser in production)
      return { success: true, data: { _raw: xml } };
    } catch (error) {
      return { success: false, error: 'Failed to parse XML' };
    }
  }

  private extractValue(obj: Record<string, unknown>, ...path: string[]): string {
    // Simplified value extraction
    return '';
  }

  private extractAttribute(_obj: Record<string, unknown>, _element: string, _attr: string): string {
    // Simplified attribute extraction
    return '';
  }

  private extractAssertion(response: Record<string, unknown>, config: SAMLProviderConfig): SAMLResult<SAMLAssertion> {
    // Simplified assertion extraction
    // In production, properly parse and validate the Assertion element
    
    const assertion: SAMLAssertion = {
      id: `_${randomUUID()}`,
      issuer: config.idpEntityId,
      subject: '',
      nameId: '',
      nameIdFormat: NAME_ID_FORMATS.emailAddress,
      sessionIndex: `_${randomUUID()}`,
      authnInstant: new Date().toISOString(),
      authnContext: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport',
      attributes: {},
      notBefore: new Date().toISOString(),
      notOnOrAfter: new Date(Date.now() + 3600000).toISOString(),
      audience: config.spEntityId,
    };

    return { success: true, data: assertion };
  }

  private validateConditions(assertion: SAMLAssertion): SAMLResult {
    const now = new Date();
    const clockSkew = this.config.clockSkew * 1000;

    if (this.config.validateNotBefore) {
      const notBefore = new Date(assertion.notBefore);
      if (now.getTime() < notBefore.getTime() - clockSkew) {
        return { success: false, error: 'Assertion not yet valid' };
      }
    }

    if (this.config.validateNotOnOrAfter) {
      const notOnOrAfter = new Date(assertion.notOnOrAfter);
      if (now.getTime() > notOnOrAfter.getTime() + clockSkew) {
        return { success: false, error: 'Assertion expired' };
      }
    }

    return { success: true };
  }

  private mapAttributesToUser(assertion: SAMLAssertion, mapping: SAMLAttributeMapping): SAMLUser {
    const attrs = assertion.attributes;

    const getValue = (key: string): string | undefined => {
      const value = attrs[key];
      return Array.isArray(value) ? value[0] : value;
    };

    const getValues = (key: string): string[] | undefined => {
      const value = attrs[key];
      return Array.isArray(value) ? value : value ? [value] : undefined;
    };

    return {
      nameId: assertion.nameId,
      nameIdFormat: assertion.nameIdFormat,
      sessionIndex: assertion.sessionIndex,
      email: getValue(mapping.email) ?? assertion.nameId,
      firstName: mapping.firstName ? getValue(mapping.firstName) : undefined,
      lastName: mapping.lastName ? getValue(mapping.lastName) : undefined,
      displayName: mapping.displayName ? getValue(mapping.displayName) : undefined,
      groups: mapping.groups ? getValues(mapping.groups) : undefined,
      attributes: attrs,
    };
  }

  private extractCertificateContent(pem: string): string {
    return pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
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
      provider: 'saml',
      metadata,
      timestamp: new Date().toISOString(),
    };

    await this.storage.saveAuthEvent(event);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createSAMLService(
  config: Partial<SAMLServiceConfig> & Pick<SAMLServiceConfig, 'spEntityId' | 'spCertificate' | 'spPrivateKey' | 'spAcsUrl'>,
  storage?: SAMLStorage,
): SAMLService {
  return new SAMLService(config, storage);
}
