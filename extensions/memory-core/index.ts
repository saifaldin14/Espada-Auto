import type { EspadaPluginApi } from "espada/plugin-sdk";
import { emptyPluginConfigSchema } from "espada/plugin-sdk";

type MemoryCoreDiagnostics = {
  registeredAt: string;
  toolFactoryRuns: number;
  toolFactorySuccesses: number;
  toolFactoryFailures: number;
  lastToolFactoryAt: string | null;
  lastError: string | null;
  cliRegistered: boolean;
  toolsAvailable: boolean;
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

const memoryCorePlugin = {
  id: "memory-core",
  name: "Memory (Core)",
  description: "File-backed memory search tools and CLI",
  kind: "memory",
  configSchema: emptyPluginConfigSchema(),
  register(api: EspadaPluginApi) {
    const diagnostics: MemoryCoreDiagnostics = {
      registeredAt: new Date().toISOString(),
      toolFactoryRuns: 0,
      toolFactorySuccesses: 0,
      toolFactoryFailures: 0,
      lastToolFactoryAt: null,
      lastError: null,
      cliRegistered: false,
      toolsAvailable: false,
    };

    api.registerTool(
      (ctx) => {
        diagnostics.toolFactoryRuns += 1;
        diagnostics.lastToolFactoryAt = new Date().toISOString();
        try {
          const memorySearchTool = api.runtime.tools.createMemorySearchTool({
            config: ctx.config,
            agentSessionKey: ctx.sessionKey,
          });
          const memoryGetTool = api.runtime.tools.createMemoryGetTool({
            config: ctx.config,
            agentSessionKey: ctx.sessionKey,
          });
          if (!memorySearchTool || !memoryGetTool) {
            diagnostics.toolsAvailable = false;
            diagnostics.toolFactoryFailures += 1;
            return null;
          }
          diagnostics.toolsAvailable = true;
          diagnostics.toolFactorySuccesses += 1;
          diagnostics.lastError = null;
          return [memorySearchTool, memoryGetTool];
        } catch (err) {
          diagnostics.toolsAvailable = false;
          diagnostics.toolFactoryFailures += 1;
          diagnostics.lastError = toErrorMessage(err);
          return null;
        }
      },
      { names: ["memory_search", "memory_get"] },
    );

    api.registerCli(
      ({ program }) => {
        api.runtime.tools.registerMemoryCli(program);
        diagnostics.cliRegistered = true;
      },
      { commands: ["memory"] },
    );

    api.registerGatewayMethod("memory-core/status", async ({ respond }) => {
      respond(true, {
        extension: "memory-core",
        diagnostics,
      });
    });

    api.registerGatewayMethod("memory-core/diagnostics/reset", async ({ respond }) => {
      diagnostics.toolFactoryRuns = 0;
      diagnostics.toolFactorySuccesses = 0;
      diagnostics.toolFactoryFailures = 0;
      diagnostics.lastToolFactoryAt = null;
      diagnostics.lastError = null;
      diagnostics.toolsAvailable = false;
      diagnostics.cliRegistered = false;
      respond(true, { reset: true });
    });
  },
};

export default memoryCorePlugin;
