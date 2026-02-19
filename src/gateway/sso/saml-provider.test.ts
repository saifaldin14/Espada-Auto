/**
 * SAML Provider — Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SAMLProvider,
  SAMLError,
  type SAMLAssertion,
  type SAMLIdPMetadata,
} from "./saml-provider.js";
import type { SSOConfig } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<SSOConfig> = {}): SSOConfig {
  return {
    provider: "saml",
    issuerUrl: "https://idp.example.com/saml",
    clientId: "espada-sp",
    clientSecret: "",
    callbackUrl: "https://app.example.com/acs",
    scopes: [],
    roleMapping: {
      Engineering: "developer",
      SRE: "operator",
      Platform: "admin",
    },
    allowFallback: true,
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<SAMLIdPMetadata> = {}): SAMLIdPMetadata {
  return {
    entityId: "https://idp.example.com",
    ssoUrl: "https://idp.example.com/sso",
    sloUrl: "https://idp.example.com/slo",
    certificate: "MIICxDCCA...",
    nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
    ...overrides,
  };
}

function buildSamlResponseXml(
  opts: {
    issuer?: string;
    nameId?: string;
    nameIdFormat?: string;
    sessionIndex?: string;
    notBefore?: string;
    notOnOrAfter?: string;
    attributes?: Record<string, string[]>;
  } = {},
): string {
  const issuer = opts.issuer ?? "https://idp.example.com";
  const nameId = opts.nameId ?? "user@example.com";
  const nameIdFormat = opts.nameIdFormat ?? SAMLProvider.NAME_ID_FORMAT.EMAIL;
  const sessionIndex = opts.sessionIndex ?? "_session123";
  const notBefore = opts.notBefore ?? new Date(Date.now() - 60_000).toISOString();
  const notOnOrAfter = opts.notOnOrAfter ?? new Date(Date.now() + 3600_000).toISOString();

  let attrStatements = "";
  if (opts.attributes) {
    const attrElements = Object.entries(opts.attributes)
      .map(([name, values]) => {
        const valueEls = values
          .map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`)
          .join("");
        return `<saml:Attribute Name="${name}">${valueEls}</saml:Attribute>`;
      })
      .join("");
    attrStatements = `<saml:AttributeStatement>${attrElements}</saml:AttributeStatement>`;
  }

  return [
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
    "<saml:Assertion>",
    `<saml:Issuer>${issuer}</saml:Issuer>`,
    `<saml:Subject><saml:NameID Format="${nameIdFormat}">${nameId}</saml:NameID></saml:Subject>`,
    `<saml:AuthnStatement SessionIndex="${sessionIndex}"/>`,
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"/>`,
    attrStatements,
    "</saml:Assertion>",
    "</samlp:Response>",
  ].join("\n");
}

function encodeResponse(xml: string): string {
  return Buffer.from(xml, "utf8").toString("base64");
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("SAMLProvider", () => {
  let provider: SAMLProvider;

  beforeEach(() => {
    provider = new SAMLProvider(makeConfig());
  });

  // ── Static Constants ────────────────────────────────────────────────────────

  describe("static constants", () => {
    it("exposes NAME_ID_FORMAT values", () => {
      expect(SAMLProvider.NAME_ID_FORMAT.EMAIL).toContain("emailAddress");
      expect(SAMLProvider.NAME_ID_FORMAT.PERSISTENT).toContain("persistent");
      expect(SAMLProvider.NAME_ID_FORMAT.TRANSIENT).toContain("transient");
      expect(SAMLProvider.NAME_ID_FORMAT.UNSPECIFIED).toContain("unspecified");
    });

    it("exposes ATTRIBUTES constants", () => {
      expect(SAMLProvider.ATTRIBUTES.EMAIL).toContain("emailaddress");
      expect(SAMLProvider.ATTRIBUTES.NAME).toContain("name");
      expect(SAMLProvider.ATTRIBUTES.GIVEN_NAME).toContain("givenname");
      expect(SAMLProvider.ATTRIBUTES.SURNAME).toContain("surname");
      expect(SAMLProvider.ATTRIBUTES.GROUPS).toContain("Group");
      expect(SAMLProvider.ATTRIBUTES.ROLE).toContain("role");
    });
  });

  // ── Metadata ────────────────────────────────────────────────────────────────

  describe("metadata management", () => {
    it("starts without metadata", () => {
      expect(provider.hasMetadata()).toBe(false);
      expect(provider.getMetadata()).toBeNull();
    });

    it("setMetadata stores and marks metadata present", () => {
      const meta = makeMetadata();
      provider.setMetadata(meta);
      expect(provider.hasMetadata()).toBe(true);
      expect(provider.getMetadata()).toEqual(meta);
    });

    it("getIssuerUrl returns config issuer", () => {
      expect(provider.getIssuerUrl()).toBe("https://idp.example.com/saml");
    });
  });

  describe("parseMetadataXml", () => {
    it("extracts entityId, ssoUrl, and sloUrl from metadata XML", () => {
      const xml = `
        <EntityDescriptor entityID="https://idp.example.com">
          <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
          <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/slo"/>
          <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
          <X509Certificate>MIIC...</X509Certificate>
        </EntityDescriptor>
      `;

      const meta = provider.parseMetadataXml(xml);
      expect(meta.entityId).toBe("https://idp.example.com");
      expect(meta.ssoUrl).toBe("https://idp.example.com/sso");
      expect(meta.sloUrl).toBe("https://idp.example.com/slo");
      expect(meta.certificate).toBe("MIIC...");
      expect(meta.nameIdFormat).toContain("emailAddress");
    });

    it("defaults NameIDFormat when missing", () => {
      const xml = `<EntityDescriptor entityID="test"><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sso"/></EntityDescriptor>`;
      const meta = provider.parseMetadataXml(xml);
      expect(meta.nameIdFormat).toBe(SAMLProvider.NAME_ID_FORMAT.EMAIL);
    });
  });

  // ── AuthnRequest ────────────────────────────────────────────────────────────

  describe("generateAuthnRequest", () => {
    it("throws without metadata", () => {
      expect(() => provider.generateAuthnRequest()).toThrow(SAMLError);
      expect(() => provider.generateAuthnRequest()).toThrow("metadata not loaded");
    });

    it("generates a valid AuthnRequest with redirect URL", () => {
      provider.setMetadata(makeMetadata());
      const req = provider.generateAuthnRequest();

      expect(req.requestId).toMatch(/^_/);
      expect(req.encodedRequest).toBeTruthy();
      expect(req.redirectUrl).toContain("https://idp.example.com/sso?");
      expect(req.redirectUrl).toContain("SAMLRequest=");
    });

    it("includes RelayState in redirect URL when provided", () => {
      provider.setMetadata(makeMetadata());
      const req = provider.generateAuthnRequest("/dashboard");

      expect(req.redirectUrl).toContain("RelayState=");
      expect(req.redirectUrl).toContain("%2Fdashboard");
    });

    it("encoded request decodes to valid XML", () => {
      provider.setMetadata(makeMetadata());
      const req = provider.generateAuthnRequest();
      const xml = Buffer.from(req.encodedRequest, "base64").toString("utf8");

      expect(xml).toContain("AuthnRequest");
      expect(xml).toContain("espada-sp"); // clientId/Issuer
      expect(xml).toContain("https://app.example.com/acs"); // callbackUrl
    });
  });

  // ── Response Parsing ────────────────────────────────────────────────────────

  describe("parseResponse", () => {
    it("parses a valid SAML response", () => {
      provider.setMetadata(makeMetadata());
      const xml = buildSamlResponseXml({
        attributes: {
          [SAMLProvider.ATTRIBUTES.EMAIL]: ["alice@corp.com"],
          [SAMLProvider.ATTRIBUTES.GROUPS]: ["Engineering", "SRE"],
        },
      });

      const assertion = provider.parseResponse(encodeResponse(xml));
      expect(assertion.issuer).toBe("https://idp.example.com");
      expect(assertion.nameId).toBe("user@example.com");
      expect(assertion.nameIdFormat).toContain("emailAddress");
      expect(assertion.sessionIndex).toBe("_session123");
      expect(assertion.attributes[SAMLProvider.ATTRIBUTES.EMAIL]).toEqual(["alice@corp.com"]);
      expect(assertion.attributes[SAMLProvider.ATTRIBUTES.GROUPS]).toEqual(["Engineering", "SRE"]);
    });

    it("throws for expired assertion", () => {
      const past = new Date(Date.now() - 120_000).toISOString(); // 2 min ago (beyond 60s tolerance)
      const xml = buildSamlResponseXml({ notOnOrAfter: past });

      expect(() => provider.parseResponse(encodeResponse(xml))).toThrow(SAMLError);
      expect(() => provider.parseResponse(encodeResponse(xml))).toThrow("expired");
    });

    it("throws for not-yet-valid assertion", () => {
      const future = new Date(Date.now() + 120_000).toISOString(); // 2 min from now (beyond 60s tolerance)
      const xml = buildSamlResponseXml({ notBefore: future });

      expect(() => provider.parseResponse(encodeResponse(xml))).toThrow(SAMLError);
      expect(() => provider.parseResponse(encodeResponse(xml))).toThrow("not yet valid");
    });

    it("tolerates 60s clock skew for NotOnOrAfter", () => {
      // Expired by 30 seconds — within 60s tolerance, should NOT throw
      const almost = new Date(Date.now() - 30_000).toISOString();
      const xml = buildSamlResponseXml({ notOnOrAfter: almost });

      expect(() => provider.parseResponse(encodeResponse(xml))).not.toThrow();
    });

    it("extracts SAML attributes from AttributeStatement", () => {
      const xml = buildSamlResponseXml({
        attributes: {
          [SAMLProvider.ATTRIBUTES.GIVEN_NAME]: ["Alice"],
          [SAMLProvider.ATTRIBUTES.SURNAME]: ["Smith"],
        },
      });

      const assertion = provider.parseResponse(encodeResponse(xml));
      expect(assertion.attributes[SAMLProvider.ATTRIBUTES.GIVEN_NAME]).toEqual(["Alice"]);
      expect(assertion.attributes[SAMLProvider.ATTRIBUTES.SURNAME]).toEqual(["Smith"]);
    });
  });

  // ── User Resolution ─────────────────────────────────────────────────────────

  describe("resolveUser", () => {
    it("maps email from attributes when available", () => {
      const assertion: SAMLAssertion = {
        issuer: "https://idp.example.com",
        nameId: "user123",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.PERSISTENT,
        attributes: {
          [SAMLProvider.ATTRIBUTES.EMAIL]: ["alice@corp.com"],
          [SAMLProvider.ATTRIBUTES.GROUPS]: ["Engineering"],
        },
      };

      const user = provider.resolveUser(assertion);
      expect(user.email).toBe("alice@corp.com");
      expect(user.id).toBe("user123");
      expect(user.provider).toBe("saml");
    });

    it("uses nameId as email when format is EMAIL and no email attribute", () => {
      const assertion: SAMLAssertion = {
        issuer: "https://idp.example.com",
        nameId: "alice@corp.com",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        attributes: {},
      };

      const user = provider.resolveUser(assertion);
      expect(user.email).toBe("alice@corp.com");
    });

    it("maps IdP groups to Espada roles via roleMapping", () => {
      const assertion: SAMLAssertion = {
        issuer: "https://idp.example.com",
        nameId: "user@example.com",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        attributes: {
          [SAMLProvider.ATTRIBUTES.GROUPS]: ["Engineering", "SRE"],
        },
      };

      const user = provider.resolveUser(assertion);
      expect(user.roles).toContain("developer");
      expect(user.roles).toContain("operator");
    });

    it("defaults to viewer when no groups match roleMapping", () => {
      const assertion: SAMLAssertion = {
        issuer: "https://idp.example.com",
        nameId: "user@example.com",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        attributes: {
          [SAMLProvider.ATTRIBUTES.GROUPS]: ["UnknownGroup"],
        },
      };

      const user = provider.resolveUser(assertion);
      expect(user.roles).toEqual(["viewer"]);
    });

    it("builds display name from given name + surname", () => {
      const assertion: SAMLAssertion = {
        issuer: "https://idp.example.com",
        nameId: "user@example.com",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        attributes: {
          [SAMLProvider.ATTRIBUTES.GIVEN_NAME]: ["Alice"],
          [SAMLProvider.ATTRIBUTES.SURNAME]: ["Smith"],
        },
      };

      const user = provider.resolveUser(assertion);
      expect(user.name).toBe("Alice Smith");
    });

    it("sets mfaVerified to false", () => {
      const assertion: SAMLAssertion = {
        issuer: "https://idp.example.com",
        nameId: "user@example.com",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        attributes: {},
      };

      const user = provider.resolveUser(assertion);
      expect(user.mfaVerified).toBe(false);
    });
  });

  // ── Session Creation ────────────────────────────────────────────────────────

  describe("createSessionFromAssertion", () => {
    it("creates a session and user from an assertion", () => {
      const assertion: SAMLAssertion = {
        issuer: "https://idp.example.com",
        nameId: "user@example.com",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        notOnOrAfter: new Date(Date.now() + 3600_000).toISOString(),
        attributes: {
          [SAMLProvider.ATTRIBUTES.EMAIL]: ["user@example.com"],
          [SAMLProvider.ATTRIBUTES.GROUPS]: ["Platform"],
        },
      };

      const { session, user } = provider.createSessionFromAssertion(assertion, {
        clientIp: "1.2.3.4",
        userAgent: "TestBrowser/1.0",
      });

      expect(session.id).toBeTruthy();
      expect(session.userId).toBe("user@example.com");
      expect(session.provider).toBe("saml");
      expect(session.clientIp).toBe("1.2.3.4");
      expect(session.userAgent).toBe("TestBrowser/1.0");
      expect(session.roles).toContain("admin");
      expect(user.roles).toContain("admin");
    });

    it("uses NotOnOrAfter for session expiry when available", () => {
      const future = new Date(Date.now() + 7200_000).toISOString();
      const assertion: SAMLAssertion = {
        issuer: "id",
        nameId: "user",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        notOnOrAfter: future,
        attributes: {},
      };

      const { session } = provider.createSessionFromAssertion(assertion);
      expect(session.expiresAt).toBe(future);
    });

    it("defaults to 8-hour expiry when no NotOnOrAfter", () => {
      const before = Date.now();
      const assertion: SAMLAssertion = {
        issuer: "id",
        nameId: "user",
        nameIdFormat: SAMLProvider.NAME_ID_FORMAT.EMAIL,
        attributes: {},
      };

      const { session } = provider.createSessionFromAssertion(assertion);
      const expiresMs = new Date(session.expiresAt).getTime();
      // Should be ~8 hours from now
      expect(expiresMs - before).toBeGreaterThan(7 * 60 * 60 * 1000);
      expect(expiresMs - before).toBeLessThan(9 * 60 * 60 * 1000);
    });
  });

  // ── Logout ──────────────────────────────────────────────────────────────────

  describe("generateLogoutRequest", () => {
    it("generates a logout URL when SLO URL exists", () => {
      provider.setMetadata(makeMetadata());
      const url = provider.generateLogoutRequest("user@example.com", "_session123");

      expect(url).toContain("https://idp.example.com/slo?");
      expect(url).toContain("SAMLRequest=");

      // Decode the request
      const encoded = new URL(url!).searchParams.get("SAMLRequest")!;
      const xml = Buffer.from(decodeURIComponent(encoded), "base64").toString("utf8");
      expect(xml).toContain("LogoutRequest");
      expect(xml).toContain("user@example.com");
      expect(xml).toContain("_session123");
    });

    it("returns null when no SLO URL configured", () => {
      provider.setMetadata(makeMetadata({ sloUrl: undefined }));
      const url = provider.generateLogoutRequest("user@example.com");
      expect(url).toBeNull();
    });

    it("omits SessionIndex when not provided", () => {
      provider.setMetadata(makeMetadata());
      const url = provider.generateLogoutRequest("user@example.com");
      const encoded = new URL(url!).searchParams.get("SAMLRequest")!;
      const xml = Buffer.from(decodeURIComponent(encoded), "base64").toString("utf8");
      expect(xml).not.toContain("SessionIndex");
    });
  });

  // ── SAMLError ───────────────────────────────────────────────────────────────

  describe("SAMLError", () => {
    it("has correct name and message", () => {
      const err = new SAMLError("test error");
      expect(err.name).toBe("SAMLError");
      expect(err.message).toBe("test error");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
