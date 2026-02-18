/**
 * Enterprise SSO/RBAC — Agent Tools
 *
 * Agent tools for querying SSO sessions, checking permissions,
 * and managing role assignments through the AI agent interface.
 */

import { Type } from "@sinclair/typebox";
import type { GatewayRBACManager } from "../rbac/manager.js";
import type { SessionManager } from "./session-store.js";
import type { Permission } from "../rbac/types.js";

/** Tool definition matching the registerTool pattern. */
type ToolDef = {
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
  }>;
};

/**
 * Create SSO/RBAC agent tools for registration via `api.registerTool()`.
 */
export function createSSOTools(
  rbacManager: GatewayRBACManager,
  sessionManager: SessionManager,
): ToolDef[] {
  return [
    // ─── rbac_check_permission ───────────────────────────────────────────
    {
      name: "rbac_check_permission",
      label: "Check Permission",
      description:
        "Check if a user has a specific RBAC permission. Returns whether the " +
        "permission is allowed and which role(s) grant it. Use to verify access " +
        "before performing sensitive operations.",
      parameters: Type.Object({
        userId: Type.String({ description: "User ID to check" }),
        permission: Type.String({
          description:
            "Permission to check (e.g. terraform.apply, policy.manage, audit.export, " +
            "compliance.scan, graph.admin, operator.write)",
        }),
      }),
      async execute(_toolCallId, params) {
        const { userId, permission } = params as { userId: string; permission: string };
        const result = await rbacManager.checkPermission(userId, permission as Permission);

        const lines: string[] = [];
        if (result.allowed) {
          lines.push(`## Permission Check: ALLOWED`);
          lines.push("");
          lines.push(`**User:** ${userId}`);
          lines.push(`**Permission:** ${permission}`);
          lines.push(`**Granted by:** ${result.grantedBy.join(", ")}`);
        } else {
          lines.push(`## Permission Check: DENIED`);
          lines.push("");
          lines.push(`**User:** ${userId}`);
          lines.push(`**Permission:** ${permission}`);
          lines.push(`**Reason:** ${result.reason}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { userId, permission, ...result },
        };
      },
    },

    // ─── rbac_list_roles ─────────────────────────────────────────────────
    {
      name: "rbac_list_roles",
      label: "List Roles",
      description:
        "List all available RBAC roles with their permissions. Shows built-in " +
        "and custom roles, permission counts, and environment restrictions.",
      parameters: Type.Object({
        verbose: Type.Optional(
          Type.Boolean({ description: "Include full permission list per role" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { verbose } = params as { verbose?: boolean };
        const roles = await rbacManager.listRoles();

        const lines = [
          "## Available Roles",
          "",
          "| Role | Name | Type | Permissions | Environments |",
          "|------|------|------|-------------|--------------|",
        ];

        for (const role of roles) {
          const envs = role.environments?.join(", ") ?? "all";
          lines.push(
            `| ${role.id} | ${role.name} | ${role.builtIn ? "built-in" : "custom"} | ${role.permissions.length} | ${envs} |`,
          );
        }

        if (verbose) {
          lines.push("");
          lines.push("### Permission Details");
          for (const role of roles) {
            lines.push("");
            lines.push(`**${role.id}** — ${role.description}`);
            lines.push(`Permissions: ${role.permissions.join(", ")}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { roleCount: roles.length, roles: roles.map((r) => r.id) },
        };
      },
    },

    // ─── rbac_user_permissions ───────────────────────────────────────────
    {
      name: "rbac_user_permissions",
      label: "User Permissions",
      description:
        "Show all effective permissions for a user. Resolves all assigned roles " +
        "and returns the complete permission set. Useful for auditing user access.",
      parameters: Type.Object({
        userId: Type.String({ description: "User ID to look up" }),
      }),
      async execute(_toolCallId, params) {
        const { userId } = params as { userId: string };
        const roles = await rbacManager.getUserRoles(userId);
        const permissions = await rbacManager.resolvePermissions(userId);

        const lines = [
          `## User Permissions: ${userId}`,
          "",
          `**Assigned roles:** ${roles.map((r) => r.id).join(", ") || "none"}`,
          `**Effective permissions:** ${permissions.length}`,
          "",
        ];

        if (permissions.length > 0) {
          // Group permissions by domain
          const grouped = new Map<string, string[]>();
          for (const perm of permissions) {
            const [domain] = perm.split(".");
            if (!grouped.has(domain!)) grouped.set(domain!, []);
            grouped.get(domain!)!.push(perm);
          }

          for (const [domain, perms] of grouped) {
            lines.push(`**${domain}:** ${perms.join(", ")}`);
          }
        } else {
          lines.push("_No permissions assigned._");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            userId,
            roles: roles.map((r) => r.id),
            permissionCount: permissions.length,
            permissions,
          },
        };
      },
    },

    // ─── sso_sessions ────────────────────────────────────────────────────
    {
      name: "sso_sessions",
      label: "SSO Sessions",
      description:
        "List active SSO sessions with user information. Shows session count, " +
        "user emails, and last activity timestamps.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const summary = await sessionManager.getSummary();

        const lines = [
          "## Active SSO Sessions",
          "",
          `**Total active sessions:** ${summary.activeSessions}`,
          "",
        ];

        if (summary.users.length > 0) {
          lines.push("| User | Sessions | Last Activity |");
          lines.push("|------|----------|---------------|");

          for (const user of summary.users) {
            lines.push(
              `| ${user.email} | ${user.sessionCount} | ${user.lastActivity.slice(0, 19)} |`,
            );
          }
        } else {
          lines.push("_No active sessions._");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: summary,
        };
      },
    },
  ];
}
