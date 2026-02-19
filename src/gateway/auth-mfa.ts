/**
 * Gateway MFA — TOTP-based Multi-Factor Authentication
 *
 * Provides Time-based One-Time Password (TOTP, RFC 6238) generation
 * and verification for non-SSO auth modes (token/password).
 *
 * Uses HMAC-SHA1 as the default algorithm (compatible with Google
 * Authenticator, Authy, 1Password, etc.). No external library required —
 * built on Node.js `crypto` module.
 */

import { createHmac, randomBytes } from "node:crypto";

// =============================================================================
// Constants
// =============================================================================

/** Default TOTP parameters per RFC 6238. */
const TOTP_DEFAULTS = {
  /** Time step in seconds. */
  period: 30,
  /** Number of digits in the OTP. */
  digits: 6,
  /** HMAC algorithm. */
  algorithm: "sha1" as const,
  /** Clock drift tolerance: accept codes ±1 step. */
  window: 1,
} as const;

/** Base32 alphabet (RFC 4648). */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// =============================================================================
// Types
// =============================================================================

/** MFA secret enrollment result (returned during setup). */
export interface MFAEnrollment {
  /** Base32-encoded secret key. */
  secret: string;
  /** otpauth:// URI for QR code generation. */
  uri: string;
  /** Backup/recovery codes (one-time use). */
  recoveryCodes: string[];
}

/** Stored MFA configuration for a user. */
export interface MFAUserConfig {
  /** User ID. */
  userId: string;
  /** Base32-encoded TOTP secret. */
  secret: string;
  /** Whether MFA is verified and active. */
  verified: boolean;
  /** Remaining recovery codes (hashed). */
  recoveryCodes: string[];
  /** When MFA was enrolled. */
  enrolledAt: string;
  /** When MFA was last used for verification. */
  lastVerifiedAt?: string;
}

/** Result of an MFA verification attempt. */
export interface MFAVerifyResult {
  /** Whether the code was accepted. */
  valid: boolean;
  /** Whether a recovery code was used (instead of TOTP). */
  usedRecoveryCode: boolean;
  /** Reason for rejection (if invalid). */
  reason?: string;
}

// =============================================================================
// TOTP Core (RFC 6238)
// =============================================================================

/**
 * Generate a TOTP code for a given secret and time.
 */
export function generateTOTP(
  secret: string,
  time: number = Date.now(),
  options?: { period?: number; digits?: number },
): string {
  const period = options?.period ?? TOTP_DEFAULTS.period;
  const digits = options?.digits ?? TOTP_DEFAULTS.digits;

  const counter = Math.floor(time / 1000 / period);
  return generateHOTP(secret, counter, digits);
}

/**
 * Verify a TOTP code against the current time (with window tolerance).
 */
export function verifyTOTP(
  secret: string,
  code: string,
  time: number = Date.now(),
  options?: { period?: number; digits?: number; window?: number },
): boolean {
  const period = options?.period ?? TOTP_DEFAULTS.period;
  const digits = options?.digits ?? TOTP_DEFAULTS.digits;
  const window = options?.window ?? TOTP_DEFAULTS.window;

  const counter = Math.floor(time / 1000 / period);

  // Check current step and ± window steps for clock drift
  for (let i = -window; i <= window; i++) {
    const expected = generateHOTP(secret, counter + i, digits);
    if (timingSafeEqual(code, expected)) return true;
  }

  return false;
}

/**
 * Generate an HOTP code (HMAC-based One-Time Password, RFC 4226).
 */
function generateHOTP(secret: string, counter: number, digits: number): string {
  const secretBytes = base32Decode(secret);

  // Counter as 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  // HMAC-SHA1
  const hmac = createHmac("sha1", secretBytes);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = hash[hash.length - 1]! & 0x0f;
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, "0");
}

// =============================================================================
// Secret & Enrollment Management
// =============================================================================

/**
 * Generate a new TOTP secret (160-bit random, base32-encoded).
 */
export function generateSecret(bytes: number = 20): string {
  const buf = randomBytes(bytes);
  return base32Encode(buf);
}

/**
 * Generate recovery codes (8-char alphanumeric, dash-separated pairs).
 * Each code is a one-time use fallback for lost authenticator access.
 */
export function generateRecoveryCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/**
 * Build an `otpauth://` URI for QR code generation.
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 */
export function buildOTPAuthURI(
  secret: string,
  accountName: string,
  issuer: string = "Espada",
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(accountName);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: TOTP_DEFAULTS.algorithm.toUpperCase(),
    digits: String(TOTP_DEFAULTS.digits),
    period: String(TOTP_DEFAULTS.period),
  });

  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?${params.toString()}`;
}

/**
 * Enroll a user in MFA — generates secret, URI, and recovery codes.
 */
export function enrollMFA(userId: string, email: string): MFAEnrollment {
  const secret = generateSecret();
  const uri = buildOTPAuthURI(secret, email);
  const recoveryCodes = generateRecoveryCodes();

  return { secret, uri, recoveryCodes };
}

// =============================================================================
// MFA Verification
// =============================================================================

/**
 * Verify an MFA code (TOTP or recovery code) against a user's config.
 */
export function verifyMFA(config: MFAUserConfig, code: string): MFAVerifyResult {
  if (!config.verified) {
    return { valid: false, usedRecoveryCode: false, reason: "MFA not yet verified" };
  }

  // Normalize code (strip spaces and dashes)
  const normalized = code.replace(/[\s-]/g, "");

  // Try TOTP first
  if (/^\d{6}$/.test(normalized)) {
    const valid = verifyTOTP(config.secret, normalized);
    if (valid) {
      return { valid: true, usedRecoveryCode: false };
    }
  }

  // Try recovery codes
  const upperCode = normalized.toUpperCase();
  const recoveryIndex = config.recoveryCodes.findIndex((rc) => rc === upperCode);
  if (recoveryIndex !== -1) {
    // Mark recovery code as used by removing it
    config.recoveryCodes.splice(recoveryIndex, 1);
    return { valid: true, usedRecoveryCode: true };
  }

  return {
    valid: false,
    usedRecoveryCode: false,
    reason: "Invalid TOTP code or recovery code",
  };
}

/**
 * Verify the initial TOTP code during enrollment (activates MFA).
 */
export function verifyEnrollment(secret: string, code: string): boolean {
  return verifyTOTP(secret, code);
}

// =============================================================================
// Base32 Encoding/Decoding (RFC 4648)
// =============================================================================

/** Encode a buffer to base32 string. */
export function base32Encode(buffer: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

/** Decode a base32 string to Buffer. */
export function base32Decode(encoded: string): Buffer {
  const sanitized = encoded.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of sanitized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // skip invalid characters

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
