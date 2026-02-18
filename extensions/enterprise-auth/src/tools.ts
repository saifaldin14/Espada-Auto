/**
 * Enterprise Auth — Agent Tools
 *
 * 4 tools: auth_check_permission, auth_list_roles, auth_user_info, auth_api_key_create
 */

import { Type } from "@sinclair/typebox";
import type { AuthStorage, Permission } from "./types.js";
import { RbacEngine, generateApiKey } from "./rbac.js";

export function createAuthTools(storage: AuthStorage) {
  const rbac = new RbacEngine(storage);

  return [
    {
      name: "auth_check_permission",
      description: "Check if a user has the required permissions.",
      inputSchema: Type.Object({
        userId: Type.String({ description: "User ID to check" }),
        permissions: Type.Array(Type.String(), { description: "Permissions to check" }),
      }),
      execute: async (input: { userId: string; permissions: string[] }) => {
        const user = await storage.getUser(input.userId);
        if (!user) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "User not found" }) }] };
        }
        const result = await rbac.authorize(user, input.permissions as Permission[]);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "auth_list_roles",
      description: "List all available roles with their permissions.",
      inputSchema: Type.Object({}),
      execute: async () => {
        const roles = await storage.listRoles();
        const summary = roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          permissionCount: r.permissions.length,
          builtIn: r.builtIn,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      },
    },
    {
      name: "auth_user_info",
      description: "Get user information including roles and permissions.",
      inputSchema: Type.Object({
        userId: Type.Optional(Type.String({ description: "User ID" })),
        email: Type.Optional(Type.String({ description: "User email" })),
      }),
      execute: async (input: { userId?: string; email?: string }) => {
        let user = input.userId ? await storage.getUser(input.userId) : null;
        if (!user && input.email) user = await storage.getUserByEmail(input.email);

        if (!user) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "User not found" }) }] };
        }

        const permissions = await rbac.getUserPermissions(user);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: user.id,
                  email: user.email,
                  name: user.name,
                  roles: user.roles,
                  permissions: [...permissions],
                  mfaEnabled: user.mfaEnabled,
                  disabled: user.disabled,
                  lastLoginAt: user.lastLoginAt,
                  ssoProvider: user.ssoProviderId,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
    {
      name: "auth_api_key_create",
      description: "Create a new API key for a user. Returns the key (shown once only).",
      inputSchema: Type.Object({
        userId: Type.String({ description: "User ID to create key for" }),
        name: Type.String({ description: "Descriptive name for the API key" }),
        permissions: Type.Array(Type.String(), { description: "Permissions for the key" }),
        expiresInDays: Type.Optional(Type.Number({ description: "Key expiration in days" })),
      }),
      execute: async (input: { userId: string; name: string; permissions: string[]; expiresInDays?: number }) => {
        const user = await storage.getUser(input.userId);
        if (!user) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "User not found" }) }] };
        }

        const { key, prefix, hash } = generateApiKey();
        const now = new Date();
        const apiKey = {
          id: `apikey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: input.name,
          keyHash: hash,
          keyPrefix: prefix,
          userId: input.userId,
          permissions: input.permissions as Permission[],
          expiresAt: input.expiresInDays
            ? new Date(now.getTime() + input.expiresInDays * 86400000).toISOString()
            : undefined,
          disabled: false,
          createdAt: now.toISOString(),
        };

        await storage.saveApiKey(apiKey);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: apiKey.id,
                  name: apiKey.name,
                  key,
                  prefix,
                  expiresAt: apiKey.expiresAt,
                  message: "Save this key now — it will not be shown again.",
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
  ];
}
