/**
 * Gateway MFA — Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  generateTOTP,
  verifyTOTP,
  generateSecret,
  generateRecoveryCodes,
  buildOTPAuthURI,
  enrollMFA,
  verifyMFA,
  verifyEnrollment,
  base32Encode,
  base32Decode,
  type MFAUserConfig,
} from "./auth-mfa.js";

// ── Base32 ──────────────────────────────────────────────────────────────────────

describe("base32Encode / base32Decode", () => {
  it("round-trips arbitrary data", () => {
    const original = Buffer.from("Hello, World!");
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded.toString()).toBe("Hello, World!");
  });

  it("round-trips single byte", () => {
    const original = Buffer.from([0x42]);
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded[0]).toBe(0x42);
  });

  it("round-trips empty buffer", () => {
    const encoded = base32Encode(Buffer.alloc(0));
    expect(encoded).toBe("");
    const decoded = base32Decode(encoded);
    expect(decoded.length).toBe(0);
  });

  it("produces only valid base32 characters", () => {
    const encoded = base32Encode(Buffer.from("test payload"));
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
  });

  it("decodes ignoring trailing padding", () => {
    const original = Buffer.from("abc");
    const encoded = base32Encode(original) + "===";
    const decoded = base32Decode(encoded);
    expect(decoded.toString()).toBe("abc");
  });
});

// ── TOTP ────────────────────────────────────────────────────────────────────────

describe("generateTOTP", () => {
  it("returns a 6-digit string by default", () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("returns same code for same time step", () => {
    const secret = generateSecret();
    const time = 1700000000_000; // fixed timestamp
    const code1 = generateTOTP(secret, time);
    const code2 = generateTOTP(secret, time);
    expect(code1).toBe(code2);
  });

  it("returns different code for different time steps", () => {
    const secret = generateSecret();
    const code1 = generateTOTP(secret, 1700000000_000);
    const code2 = generateTOTP(secret, 1700000060_000); // +60s = different step
    expect(code1).not.toBe(code2);
  });

  it("respects custom digit count", () => {
    const secret = generateSecret();
    const code = generateTOTP(secret, Date.now(), { digits: 8 });
    expect(code).toMatch(/^\d{8}$/);
  });
});

describe("verifyTOTP", () => {
  it("accepts the correct code for current time", () => {
    const secret = generateSecret();
    const time = Date.now();
    const code = generateTOTP(secret, time);
    expect(verifyTOTP(secret, code, time)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, "000000")).toBe(false);
  });

  it("accepts codes within the default ±1 window", () => {
    const secret = generateSecret();
    const time = 1700000000_000;
    // Code from next step (30s later)
    const futureCode = generateTOTP(secret, time + 30_000);
    expect(verifyTOTP(secret, futureCode, time)).toBe(true);

    // Code from previous step (30s earlier)
    const pastCode = generateTOTP(secret, time - 30_000);
    expect(verifyTOTP(secret, pastCode, time)).toBe(true);
  });

  it("rejects codes outside the window", () => {
    const secret = generateSecret();
    const time = 1700000000_000;
    // Code from 3 steps away (90s)
    const farCode = generateTOTP(secret, time + 90_000);
    expect(verifyTOTP(secret, farCode, time)).toBe(false);
  });
});

// ── Secret & Enrollment ─────────────────────────────────────────────────────────

describe("generateSecret", () => {
  it("returns a non-empty base32 string", () => {
    const secret = generateSecret();
    expect(secret.length).toBeGreaterThan(0);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it("generates different secrets each call", () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(s1).not.toBe(s2);
  });

  it("respects custom byte count", () => {
    const small = generateSecret(10);
    const large = generateSecret(32);
    // Base32: 10 bytes → 16 chars, 32 bytes → ~52 chars
    expect(large.length).toBeGreaterThan(small.length);
  });
});

describe("generateRecoveryCodes", () => {
  it("generates the default count of 8 codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
  });

  it("generates requested number of codes", () => {
    const codes = generateRecoveryCodes(4);
    expect(codes).toHaveLength(4);
  });

  it("codes follow XXXXX-XXXXX format", () => {
    const codes = generateRecoveryCodes();
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
  });

  it("codes are unique", () => {
    const codes = generateRecoveryCodes(20);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

describe("buildOTPAuthURI", () => {
  it("produces otpauth:// URI", () => {
    const uri = buildOTPAuthURI("JBSWY3DPEHPK3PXP", "user@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
  });

  it("includes secret, issuer, algorithm, digits, period", () => {
    const uri = buildOTPAuthURI("MYSECRET", "test@example.com", "Espada");
    expect(uri).toContain("secret=MYSECRET");
    expect(uri).toContain("issuer=Espada");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("encodes account name and issuer in path", () => {
    const uri = buildOTPAuthURI("SECRET", "alice@corp.com", "My App");
    expect(uri).toContain("My%20App");
    expect(uri).toContain("alice%40corp.com");
  });
});

describe("enrollMFA", () => {
  it("returns secret, URI, and recovery codes", () => {
    const enrollment = enrollMFA("user-1", "alice@example.com");

    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrollment.uri).toContain("otpauth://totp/");
    expect(enrollment.uri).toContain("alice%40example.com");
    expect(enrollment.recoveryCodes).toHaveLength(8);
  });
});

// ── MFA Verification ────────────────────────────────────────────────────────────

describe("verifyMFA", () => {
  function makeUserConfig(overrides: Partial<MFAUserConfig> = {}): MFAUserConfig {
    const secret = generateSecret();
    return {
      userId: "user-1",
      secret,
      verified: true,
      recoveryCodes: ["AAAA1BBBBB", "CCCCCDDDDD"],
      enrolledAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("accepts valid TOTP code", () => {
    const config = makeUserConfig();
    const code = generateTOTP(config.secret);
    const result = verifyMFA(config, code);

    expect(result.valid).toBe(true);
    expect(result.usedRecoveryCode).toBe(false);
  });

  it("rejects invalid TOTP code", () => {
    const config = makeUserConfig();
    const result = verifyMFA(config, "000000");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid");
  });

  it("accepts valid recovery code and removes it", () => {
    const config = makeUserConfig();
    const result = verifyMFA(config, "AAAA1-BBBBB");

    expect(result.valid).toBe(true);
    expect(result.usedRecoveryCode).toBe(true);
    expect(config.recoveryCodes).not.toContain("AAAA1BBBBB");
    expect(config.recoveryCodes).toHaveLength(1);
  });

  it("normalizes recovery codes (strips dashes and spaces)", () => {
    const config = makeUserConfig({ recoveryCodes: ["AAAA1BBBBB"] });
    const result = verifyMFA(config, "AAAA1-BBBBB");
    // The normalized code "AAAA1BBBBB" should match the stored one
    expect(result.valid).toBe(true);
    expect(result.usedRecoveryCode).toBe(true);
  });

  it("rejects if MFA not yet verified", () => {
    const config = makeUserConfig({ verified: false });
    const code = generateTOTP(config.secret);
    const result = verifyMFA(config, code);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not yet verified");
  });
});

describe("verifyEnrollment", () => {
  it("returns true for valid code during enrollment", () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(verifyEnrollment(secret, code)).toBe(true);
  });

  it("returns false for invalid code", () => {
    const secret = generateSecret();
    expect(verifyEnrollment(secret, "999999")).toBe(false);
  });
});
