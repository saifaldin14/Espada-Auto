/**
 * Enterprise SSO/RBAC — CLI Commands
 *
 * `espada auth sso` and `espada roles` subcommands for configuring
 * SSO, managing role assignments, and viewing user identity.
 */

import type { Command } from "commander";
import type { GatewayRBACManager } from "../rbac/manager.js";
import type { SessionManager } from "./session-store.js";
import type { OIDCProvider } from "./oidc-provider.js";

export type SSOCliContext = {
  program: Command;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

/**
 * Register `espada auth sso` CLI subcommands.
 */
export function registerSSOCli(
  ctx: SSOCliContext,
  provider: OIDCProvider | null,
  sessionManager: SessionManager,
): void {
  // Find or create the `auth` command group
  let auth = ctx.program.commands.find((c) => c.name() === "auth");
  if (!auth) {
    auth = ctx.program.command("auth").description("Authentication management");
  }

  const sso = auth.command("sso").description("SSO configuration and management");

  // ─── auth sso status ────────────────────────────────────────────────────
  sso
    .command("status")
    .description("Show current SSO configuration status")
    .action(async () => {
      if (!provider) {
        ctx.logger.info("SSO is not configured.");
        ctx.logger.info("Run 'espada auth sso configure' to set up SSO.");
        return;
      }

      ctx.logger.info("SSO Status: Configured");
      ctx.logger.info(`  Provider: OIDC`);
      ctx.logger.info(`  Issuer:   ${provider.getIssuerUrl()}`);

      try {
        const doc = await provider.discover();
        ctx.logger.info(`  Discovery: OK`);
        ctx.logger.info(`  Authorization: ${doc.authorization_endpoint}`);
        ctx.logger.info(`  Token:         ${doc.token_endpoint}`);
        ctx.logger.info(`  UserInfo:      ${doc.userinfo_endpoint}`);
      } catch (err) {
        ctx.logger.error(`  Discovery: FAILED — ${err}`);
      }
    });

  // ─── auth sso test ──────────────────────────────────────────────────────
  sso
    .command("test")
    .description("Test SSO connectivity by fetching the OIDC discovery document")
    .action(async () => {
      if (!provider) {
        ctx.logger.error("SSO is not configured. Run 'espada auth sso configure' first.");
        return;
      }

      ctx.logger.info("Testing OIDC connectivity...");
      try {
        const doc = await provider.discover();
        ctx.logger.info("OIDC Discovery: OK");
        ctx.logger.info(`  Issuer:                ${doc.issuer}`);
        ctx.logger.info(`  Scopes supported:      ${doc.scopes_supported.join(", ")}`);
        ctx.logger.info(`  Response types:        ${doc.response_types_supported.join(", ")}`);
        ctx.logger.info(
          `  Signing algorithms:    ${doc.id_token_signing_alg_values_supported.join(", ")}`,
        );
        if (doc.end_session_endpoint) {
          ctx.logger.info(`  Logout endpoint:       ${doc.end_session_endpoint}`);
        }
        ctx.logger.info("\nSSO connection test passed.");
      } catch (err) {
        ctx.logger.error(`SSO connection test failed: ${err}`);
      }
    });

  // ─── auth sso sessions ─────────────────────────────────────────────────
  sso
    .command("sessions")
    .description("List active SSO sessions")
    .action(async () => {
      const summary = await sessionManager.getSummary();

      if (summary.activeSessions === 0) {
        ctx.logger.info("No active SSO sessions.");
        return;
      }

      ctx.logger.info(`Active SSO Sessions: ${summary.activeSessions}\n`);
      ctx.logger.info("| User                          | Sessions | Last Activity       |");
      ctx.logger.info("|-------------------------------|----------|---------------------|");

      for (const user of summary.users) {
        const email = user.email.padEnd(29);
        const count = String(user.sessionCount).padEnd(8);
        const lastAct = user.lastActivity.slice(0, 19);
        ctx.logger.info(`| ${email} | ${count} | ${lastAct} |`);
      }
    });

  // ─── auth sso logout ───────────────────────────────────────────────────
  sso
    .command("logout")
    .description("End an SSO session or all sessions for a user")
    .option("--session <id>", "Specific session ID to end")
    .option("--user <userId>", "End all sessions for a user ID")
    .option("--all", "End all active sessions")
    .action(async (opts) => {
      if (opts.session) {
        await sessionManager.endSession(opts.session);
        ctx.logger.info(`Session ${opts.session} ended.`);
      } else if (opts.user) {
        await sessionManager.endAllUserSessions(opts.user);
        ctx.logger.info(`All sessions for user ${opts.user} ended.`);
      } else if (opts.all) {
        const summary = await sessionManager.getSummary();
        for (const user of summary.users) {
          await sessionManager.endAllUserSessions(user.userId);
        }
        ctx.logger.info(`All ${summary.activeSessions} session(s) ended.`);
      } else {
        ctx.logger.error("Specify --session, --user, or --all.");
      }
    });
}

/**
 * Register `espada roles` CLI subcommands.
 */
export function registerRBACCli(ctx: SSOCliContext, rbacManager: GatewayRBACManager): void {
  const roles = ctx.program.command("roles").description("Role-Based Access Control management");

  // ─── roles list ─────────────────────────────────────────────────────────
  roles
    .command("list")
    .description("List all available roles and their permissions")
    .option("--verbose", "Show permission details")
    .action(async (opts) => {
      const allRoles = await rbacManager.listRoles();

      ctx.logger.info("Available Roles:\n");
      ctx.logger.info("| Role         | Name            | Built-in | Permissions |");
      ctx.logger.info("|--------------|-----------------|----------|-------------|");

      for (const role of allRoles) {
        const id = role.id.padEnd(12);
        const name = role.name.padEnd(15);
        const builtIn = (role.builtIn ? "yes" : "no").padEnd(8);
        const permCount = String(role.permissions.length).padEnd(11);
        ctx.logger.info(`| ${id} | ${name} | ${builtIn} | ${permCount} |`);
      }

      if (opts.verbose) {
        ctx.logger.info("\nRole Details:\n");
        for (const role of allRoles) {
          ctx.logger.info(`${role.id} — ${role.description}`);
          if (role.environments) {
            ctx.logger.info(`  Environments: ${role.environments.join(", ")}`);
          }
          ctx.logger.info(`  Permissions: ${role.permissions.join(", ")}`);
          ctx.logger.info("");
        }
      }
    });

  // ─── roles assign ──────────────────────────────────────────────────────
  roles
    .command("assign")
    .description("Assign a role to a user")
    .argument("<userId>", "User ID (SSO subject or local ID)")
    .argument("<roleId>", "Role to assign (admin, operator, developer, viewer, auditor)")
    .option("--email <email>", "User email (for display)", "")
    .option("--expires <date>", "Expiry date (ISO-8601)")
    .action(async (userId: string, roleId: string, opts) => {
      try {
        const assignment = await rbacManager.assignRole(
          userId,
          opts.email || userId,
          roleId,
          "cli",
          opts.expires,
        );
        ctx.logger.info(`Role "${roleId}" assigned to ${userId}`);
        ctx.logger.info(`  Assigned at: ${assignment.assignedAt}`);
        if (assignment.expiresAt) {
          ctx.logger.info(`  Expires at:  ${assignment.expiresAt}`);
        }
      } catch (err) {
        ctx.logger.error(`Failed to assign role: ${err}`);
      }
    });

  // ─── roles remove ──────────────────────────────────────────────────────
  roles
    .command("remove")
    .description("Remove a role from a user")
    .argument("<userId>", "User ID")
    .argument("<roleId>", "Role to remove")
    .action(async (userId: string, roleId: string) => {
      const removed = await rbacManager.removeRole(userId, roleId);
      if (removed) {
        ctx.logger.info(`Role "${roleId}" removed from ${userId}`);
      } else {
        ctx.logger.warn(`No assignment found for ${userId} with role "${roleId}"`);
      }
    });

  // ─── roles check ───────────────────────────────────────────────────────
  roles
    .command("check")
    .description("Check if a user has a specific permission")
    .argument("<userId>", "User ID")
    .argument("<permission>", "Permission to check (e.g. terraform.apply)")
    .action(async (userId: string, permission: string) => {
      const result = await rbacManager.checkPermission(userId, permission as any);

      if (result.allowed) {
        ctx.logger.info(
          `ALLOWED — ${permission} granted to ${userId} via role(s): ${result.grantedBy.join(", ")}`,
        );
      } else {
        ctx.logger.info(`DENIED — ${result.reason}`);
      }
    });

  // ─── roles users ───────────────────────────────────────────────────────
  roles
    .command("users")
    .description("List users with their role assignments")
    .action(async () => {
      const summary = await rbacManager.getUserSummary();

      if (summary.length === 0) {
        ctx.logger.info("No role assignments found.");
        return;
      }

      ctx.logger.info("Users with Role Assignments:\n");
      ctx.logger.info("| User                          | Roles                    | Permissions |");
      ctx.logger.info("|-------------------------------|--------------------------|-------------|");

      for (const user of summary) {
        const email = user.userEmail.padEnd(29);
        const userRoles = user.roles.join(", ").padEnd(24);
        const perms = String(user.permissions).padEnd(11);
        ctx.logger.info(`| ${email} | ${userRoles} | ${perms} |`);
      }
    });

  // ─── roles assignments ────────────────────────────────────────────────
  roles
    .command("assignments")
    .description("List all role assignments with details")
    .action(async () => {
      const assignments = await rbacManager.listAssignments();

      if (assignments.length === 0) {
        ctx.logger.info("No role assignments found.");
        return;
      }

      ctx.logger.info("Role Assignments:\n");
      for (const a of assignments) {
        ctx.logger.info(`  ${a.userEmail || a.userId}`);
        ctx.logger.info(`    Role:        ${a.roleId}`);
        ctx.logger.info(`    Assigned by: ${a.assignedBy}`);
        ctx.logger.info(`    Assigned at: ${a.assignedAt}`);
        if (a.expiresAt) {
          const expired = new Date(a.expiresAt) < new Date();
          ctx.logger.info(`    Expires at:  ${a.expiresAt}${expired ? " (EXPIRED)" : ""}`);
        }
        ctx.logger.info("");
      }
    });
}
