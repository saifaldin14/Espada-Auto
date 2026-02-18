/**
 * @espada/enterprise-auth — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { SQLiteAuthStorage, InMemoryAuthStorage } from "./src/storage.js";
import { RbacEngine } from "./src/rbac.js";
import { createAuthTools } from "./src/tools.js";
import { createAuthCli } from "./src/cli.js";
import type { AuthStorage } from "./src/types.js";

export default {
  id: "enterprise-auth",
  name: "Enterprise Auth",
  register(api: EspadaPluginApi) {
    const useMemory = process.env.NODE_ENV === "test" || process.env.ESPADA_TEST === "1";
    let storage: AuthStorage;

    if (useMemory) {
      storage = new InMemoryAuthStorage();
    } else {
      const dbPath = api.resolvePath("enterprise-auth.db");
      storage = new SQLiteAuthStorage(dbPath);
    }

    const rbac = new RbacEngine(storage);

    // Tools
    for (const tool of createAuthTools(storage)) {
      api.registerTool(tool as any);
    }

    // CLI
    api.registerCli((ctx) => createAuthCli(storage)(ctx.program), { commands: ["auth"] });

    // Gateway methods
    api.registerGatewayMethod("auth/check",
      async ({ params, respond }) => {
        const { userId, permissions } = params as { userId: string; permissions: string[] };
        const user = await storage.getUser(userId);
        if (!user) { respond(false, { error: "User not found" }); return; }
        const result = await rbac.authorize(user, permissions as any);
        respond(true, result);
      },
    );

    api.registerGatewayMethod("auth/roles",
      async ({ respond }) => {
        respond(true, await storage.listRoles());
      },
    );

    api.registerGatewayMethod("auth/users",
      async ({ params, respond }) => {
        const { role } = params as { role?: string };
        respond(true, await storage.listUsers({ role }));
      },
    );

    api.registerGatewayMethod("auth/sso/providers",
      async ({ respond }) => {
        respond(true, await storage.listOidcProviders());
      },
    );

    // Service lifecycle
    api.registerService({
      id: "enterprise-auth",
      start: async () => {
        await storage.initialize();
        await rbac.initializeBuiltInRoles();
        api.logger?.info("[enterprise-auth] Initialized with built-in roles");
      },
      stop: async () => {
        await storage.close();
      },
    });
  },
};
