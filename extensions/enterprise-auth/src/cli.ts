/**
 * Enterprise Auth — CLI Commands
 *
 * Commands: auth roles, users, apikeys, sso
 */

import type { Command } from "commander";
import type { AuthStorage, Permission } from "./types.js";
import { RbacEngine, generateApiKey } from "./rbac.js";

export function createAuthCli(storage: AuthStorage) {
  return (program: Command) => {
    const auth = program.command("auth").description("Enterprise authentication and authorization");

    // ── Roles ────────────────────────────────────────────────────
    const roles = auth.command("roles").description("Manage RBAC roles");

    roles
      .command("list")
      .description("List all roles")
      .option("--json", "Output as JSON")
      .action(async (opts: { json?: boolean }) => {
        const allRoles = await storage.listRoles();
        if (opts.json) { console.log(JSON.stringify(allRoles, null, 2)); return; }
        console.log(`\nRoles (${allRoles.length}):\n`);
        for (const r of allRoles) {
          const badge = r.builtIn ? "🔒" : "📝";
          console.log(`  ${badge} ${r.name} [${r.id}]`);
          console.log(`    ${r.description}`);
          console.log(`    permissions: ${r.permissions.length}`);
          console.log();
        }
      });

    roles
      .command("show")
      .description("Show role details")
      .argument("<id>", "Role ID")
      .action(async (id: string) => {
        const role = await storage.getRole(id);
        if (!role) { console.error(`Role ${id} not found`); return; }
        console.log(JSON.stringify(role, null, 2));
      });

    roles
      .command("create")
      .description("Create a custom role")
      .requiredOption("--name <name>", "Role name")
      .requiredOption("--permissions <perms...>", "Permissions")
      .option("--description <desc>", "Description")
      .action(async (opts: { name: string; permissions: string[]; description?: string }) => {
        const now = new Date().toISOString();
        const role = {
          id: opts.name.toLowerCase().replace(/\s+/g, "-"),
          name: opts.name,
          description: opts.description ?? "",
          permissions: opts.permissions as Permission[],
          builtIn: false,
          createdAt: now,
          updatedAt: now,
        };
        await storage.saveRole(role);
        console.log(`Role "${role.name}" created with ID: ${role.id}`);
      });

    roles
      .command("delete")
      .description("Delete a custom role")
      .argument("<id>", "Role ID")
      .action(async (id: string) => {
        const deleted = await storage.deleteRole(id);
        console.log(deleted ? `Role ${id} deleted.` : `Role ${id} not found or is built-in.`);
      });

    // ── Users ────────────────────────────────────────────────────
    const users = auth.command("users").description("Manage users");

    users
      .command("list")
      .description("List all users")
      .option("--role <role>", "Filter by role")
      .option("--json", "Output as JSON")
      .action(async (opts: { role?: string; json?: boolean }) => {
        const allUsers = await storage.listUsers({ role: opts.role });
        if (opts.json) { console.log(JSON.stringify(allUsers, null, 2)); return; }
        console.log(`\nUsers (${allUsers.length}):\n`);
        for (const u of allUsers) {
          const status = u.disabled ? "🔴" : "🟢";
          console.log(`  ${status} ${u.name} <${u.email}> [${u.id}]`);
          console.log(`    roles: ${u.roles.join(", ") || "none"}`);
          if (u.ssoProviderId) console.log(`    sso: ${u.ssoProviderId}`);
          if (u.mfaEnabled) console.log(`    mfa: enabled`);
          console.log();
        }
      });

    users
      .command("create")
      .description("Create a user")
      .requiredOption("--email <email>", "Email address")
      .requiredOption("--name <name>", "Full name")
      .option("--roles <roles...>", "Role IDs")
      .action(async (opts: { email: string; name: string; roles?: string[] }) => {
        const now = new Date().toISOString();
        const user = {
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          email: opts.email,
          name: opts.name,
          roles: opts.roles ?? ["viewer"],
          mfaEnabled: false,
          disabled: false,
          createdAt: now,
          updatedAt: now,
        };
        await storage.saveUser(user);
        console.log(`User "${user.name}" created with ID: ${user.id}`);
      });

    users
      .command("assign-role")
      .description("Assign a role to a user")
      .argument("<userId>", "User ID")
      .argument("<roleId>", "Role ID")
      .action(async (userId: string, roleId: string) => {
        const user = await storage.getUser(userId);
        if (!user) { console.error("User not found"); return; }
        const role = await storage.getRole(roleId);
        if (!role) { console.error("Role not found"); return; }
        if (!user.roles.includes(roleId)) {
          user.roles.push(roleId);
          user.updatedAt = new Date().toISOString();
          await storage.saveUser(user);
        }
        console.log(`Role "${role.name}" assigned to ${user.name}`);
      });

    users
      .command("check")
      .description("Check user permissions")
      .argument("<userId>", "User ID")
      .argument("<permissions...>", "Permissions to check")
      .action(async (userId: string, permissions: string[]) => {
        const user = await storage.getUser(userId);
        if (!user) { console.error("User not found"); return; }
        const rbac = new RbacEngine(storage);
        const result = await rbac.authorize(user, permissions as Permission[]);
        console.log(`\n${result.allowed ? "✓ ALLOWED" : "✗ DENIED"}`);
        if (!result.allowed) {
          console.log(`Missing: ${result.missingPermissions.join(", ")}`);
        }
      });

    // ── API Keys ────────────────────────────────────────────────
    const apikeys = auth.command("apikeys").description("Manage API keys");

    apikeys
      .command("create")
      .description("Create an API key")
      .requiredOption("--user <userId>", "User ID")
      .requiredOption("--name <name>", "Key name")
      .option("--permissions <perms...>", "Permissions")
      .option("--expires <days>", "Expiration in days", parseInt)
      .action(async (opts: { user: string; name: string; permissions?: string[]; expires?: number }) => {
        const user = await storage.getUser(opts.user);
        if (!user) { console.error("User not found"); return; }

        const { key, prefix, hash } = generateApiKey();
        const now = new Date();
        const apiKey = {
          id: `apikey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: opts.name,
          keyHash: hash,
          keyPrefix: prefix,
          userId: opts.user,
          permissions: (opts.permissions ?? ["infra.read"]) as Permission[],
          expiresAt: opts.expires ? new Date(now.getTime() + opts.expires * 86400000).toISOString() : undefined,
          disabled: false,
          createdAt: now.toISOString(),
        };
        await storage.saveApiKey(apiKey);

        console.log(`\nAPI Key created:`);
        console.log(`  ID: ${apiKey.id}`);
        console.log(`  Key: ${key}`);
        console.log(`\n  ⚠ Save this key now — it will not be shown again.`);
      });

    apikeys
      .command("list")
      .description("List API keys for a user")
      .argument("<userId>", "User ID")
      .action(async (userId: string) => {
        const keys = await storage.listApiKeys(userId);
        if (keys.length === 0) { console.log("No API keys found."); return; }
        console.log(`\nAPI Keys (${keys.length}):\n`);
        for (const k of keys) {
          const status = k.disabled ? "🔴" : "🟢";
          console.log(`  ${status} ${k.name} [${k.keyPrefix}...] - ${k.id}`);
          console.log(`    permissions: ${k.permissions.join(", ")}`);
          if (k.expiresAt) console.log(`    expires: ${k.expiresAt}`);
          console.log();
        }
      });

    apikeys
      .command("revoke")
      .description("Revoke an API key")
      .argument("<id>", "API key ID")
      .action(async (id: string) => {
        const deleted = await storage.deleteApiKey(id);
        console.log(deleted ? `API key ${id} revoked.` : `API key ${id} not found.`);
      });

    // ── SSO ─────────────────────────────────────────────────────
    const sso = auth.command("sso").description("Manage OIDC SSO providers");

    sso
      .command("list")
      .description("List OIDC providers")
      .action(async () => {
        const providers = await storage.listOidcProviders();
        if (providers.length === 0) { console.log("No SSO providers configured."); return; }
        for (const p of providers) {
          const status = p.enabled ? "🟢" : "🔴";
          console.log(`  ${status} ${p.name} [${p.id}] — ${p.issuerUrl}`);
        }
      });

    sso
      .command("add")
      .description("Add an OIDC provider from JSON file")
      .argument("<file>", "Path to provider config JSON")
      .action(async (file: string) => {
        const fs = await import("node:fs");
        const config = JSON.parse(fs.readFileSync(file, "utf-8"));
        const now = new Date().toISOString();
        const provider = {
          id: config.id ?? `oidc-${Date.now()}`,
          name: config.name,
          issuerUrl: config.issuerUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          scopes: config.scopes ?? ["openid", "profile", "email"],
          callbackUrl: config.callbackUrl,
          roleMappings: config.roleMappings ?? [],
          enabled: config.enabled ?? true,
          createdAt: now,
          updatedAt: now,
        };
        await storage.saveOidcProvider(provider);
        console.log(`OIDC provider "${provider.name}" added with ID: ${provider.id}`);
      });

    sso
      .command("remove")
      .description("Remove an OIDC provider")
      .argument("<id>", "Provider ID")
      .action(async (id: string) => {
        const deleted = await storage.deleteOidcProvider(id);
        console.log(deleted ? `Provider ${id} removed.` : `Provider ${id} not found.`);
      });
  };
}
