/**
 * Enterprise RBAC — Module Index
 *
 * Re-exports the RBAC subsystem for integration into the gateway.
 */

export { GatewayRBACManager, InMemoryRBACStorage, FileRBACStorage } from "./manager.js";
export type {
  Permission,
  BuiltInRole,
  RoleDefinition,
  RoleAssignment,
  RBACStorage,
  PermissionCheckResult,
} from "./types.js";
export { BUILT_IN_ROLES } from "./types.js";
