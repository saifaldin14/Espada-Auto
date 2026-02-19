/**
 * Gateway methods for SSO and RBAC management.
 *
 * Methods:
 *   sso.status       — Get SSO status and active sessions
 *   sso.sessions     — List active SSO sessions
 *   sso.revoke       — Revoke an SSO session
 *   rbac.roles       — List all RBAC roles
 *   rbac.assignments — List all role assignments
 *   rbac.assign      — Assign a role to a user
 *   rbac.remove      — Remove a role from a user
 *   rbac.check       — Check if a user has a permission
 *   rbac.permissions — Resolve all permissions for a user
 */

import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const ssoRbacHandlers: GatewayRequestHandlers = {
  // ── SSO Methods ───────────────────────────────────────────────────────

  "sso.status": async ({ respond, context }) => {
    const { sessionManager, ssoConfig } = context;

    if (!sessionManager || !ssoConfig) {
      respond(true, {
        enabled: false,
        message: "SSO is not configured",
      });
      return;
    }

    const summary = await sessionManager.getSummary();
    respond(true, {
      enabled: true,
      provider: ssoConfig.provider,
      issuer: ssoConfig.issuerUrl,
      activeSessions: summary.activeSessions,
      users: summary.users,
    });
  },

  "sso.sessions": async ({ respond, context }) => {
    const { sessionManager } = context;

    if (!sessionManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "SSO is not configured"));
      return;
    }

    const summary = await sessionManager.getSummary();
    respond(true, {
      activeSessions: summary.activeSessions,
      users: summary.users,
    });
  },

  "sso.revoke": async ({ params, respond, context }) => {
    const { sessionManager } = context;

    if (!sessionManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "SSO is not configured"));
      return;
    }

    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    const userId = typeof params.userId === "string" ? params.userId : null;

    if (!sessionId && !userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionId or userId is required"),
      );
      return;
    }

    if (userId) {
      await sessionManager.endAllUserSessions(userId);
      respond(true, { message: `All sessions for user ${userId} revoked` });
    } else if (sessionId) {
      await sessionManager.endSession(sessionId);
      respond(true, { message: `Session ${sessionId} revoked` });
    }
  },

  // ── RBAC Methods ──────────────────────────────────────────────────────

  "rbac.roles": async ({ respond, context }) => {
    const { rbacManager } = context;

    if (!rbacManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "RBAC is not available"));
      return;
    }

    const roles = await rbacManager.listRoles();
    respond(true, { roles });
  },

  "rbac.assignments": async ({ respond, context }) => {
    const { rbacManager } = context;

    if (!rbacManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "RBAC is not available"));
      return;
    }

    const assignments = await rbacManager.listAssignments();
    respond(true, { assignments });
  },

  "rbac.assign": async ({ params, respond, context }) => {
    const { rbacManager } = context;

    if (!rbacManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "RBAC is not available"));
      return;
    }

    const userId = typeof params.userId === "string" ? params.userId : null;
    const userEmail = typeof params.userEmail === "string" ? params.userEmail : "";
    const roleId = typeof params.roleId === "string" ? params.roleId : null;
    const assignedBy = typeof params.assignedBy === "string" ? params.assignedBy : "gateway-api";
    const expiresAt = typeof params.expiresAt === "string" ? params.expiresAt : undefined;

    if (!userId || !roleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "userId and roleId are required"),
      );
      return;
    }

    try {
      const assignment = await rbacManager.assignRole(
        userId,
        userEmail,
        roleId,
        assignedBy,
        expiresAt,
      );
      respond(true, { assignment });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "rbac.remove": async ({ params, respond, context }) => {
    const { rbacManager } = context;

    if (!rbacManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "RBAC is not available"));
      return;
    }

    const userId = typeof params.userId === "string" ? params.userId : null;
    const roleId = typeof params.roleId === "string" ? params.roleId : null;

    if (!userId || !roleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "userId and roleId are required"),
      );
      return;
    }

    const removed = await rbacManager.removeRole(userId, roleId);
    respond(true, { removed });
  },

  "rbac.check": async ({ params, respond, context }) => {
    const { rbacManager } = context;

    if (!rbacManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "RBAC is not available"));
      return;
    }

    const userId = typeof params.userId === "string" ? params.userId : null;
    const permission = typeof params.permission === "string" ? params.permission : null;

    if (!userId || !permission) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "userId and permission are required"),
      );
      return;
    }

    // Cast to Permission type — validation happens inside checkPermission
    const result = await rbacManager.checkPermission(
      userId,
      permission as import("../rbac/types.js").Permission,
    );
    respond(true, result);
  },

  "rbac.permissions": async ({ params, respond, context }) => {
    const { rbacManager } = context;

    if (!rbacManager) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "RBAC is not available"));
      return;
    }

    const userId = typeof params.userId === "string" ? params.userId : null;

    if (!userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "userId is required"));
      return;
    }

    const permissions = await rbacManager.resolvePermissions(userId);
    respond(true, { userId, permissions });
  },
};
