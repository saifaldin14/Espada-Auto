/**
 * Enterprise SSO — Module Index
 *
 * Re-exports the SSO subsystem for integration into the gateway.
 * Provides a factory function to create the complete SSO stack.
 */

export { OIDCProvider, OIDCError } from "./oidc-provider.js";
export {
  SessionManager,
  InMemorySessionStore,
  FileSessionStore,
  createSessionToken,
  decodeSessionToken,
} from "./session-store.js";
export type {
  SSOConfig,
  SSOSession,
  SSOUser,
  SSOAuthResult,
  SSOProviderType,
  SessionStore,
  OIDCDiscoveryDocument,
  OIDCTokenResponse,
  OIDCIdTokenClaims,
} from "./types.js";
export { DEFAULT_SSO_CONFIG } from "./types.js";
