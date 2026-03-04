import { vi } from "vitest";

export type GatewayHandler = (args: {
  params?: unknown;
  respond: (success: boolean, payload: unknown) => void;
}) => Promise<void> | void;

export function createApiMock() {
  const gatewayMethods = new Map<string, GatewayHandler>();
  const registerProvider = vi.fn();
  const registerTool = vi.fn();
  const registerCli = vi.fn();
  const registerService = vi.fn();

  const api = {
    registerGatewayMethod: (name: string, handler: GatewayHandler) => {
      gatewayMethods.set(name, handler);
    },
    registerProvider,
    registerTool,
    registerCli,
    registerService,
    registerChannel: vi.fn(),
    registerHttpHandler: vi.fn(),
    resolvePath: (value: string) => value,
    pluginConfig: {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    runtime: {
      log: vi.fn(),
      tools: {
        createMemorySearchTool: vi.fn(() => ({ name: "memory_search" })),
        createMemoryGetTool: vi.fn(() => ({ name: "memory_get" })),
        registerMemoryCli: vi.fn(),
      },
    },
  };

  return {
    api,
    gatewayMethods,
    registerProvider,
    registerTool,
    registerCli,
    registerService,
  };
}

export function getRegisteredProvider(registerProvider: ReturnType<typeof vi.fn>): {
  auth?: Array<{ run: (ctx: any) => Promise<unknown> }>;
} {
  const call = registerProvider.mock.calls[0];
  if (!call || !call[0]) {
    throw new Error("Provider was not registered");
  }
  return call[0] as { auth?: Array<{ run: (ctx: any) => Promise<unknown> }> };
}

export function getRegisteredToolFactory(
  registerTool: ReturnType<typeof vi.fn>,
): (ctx: any) => unknown {
  const call = registerTool.mock.calls[0];
  if (!call || typeof call[0] !== "function") {
    throw new Error("Tool factory was not registered");
  }
  return call[0] as (ctx: any) => unknown;
}

export async function invokeGateway(
  handlers: Map<string, GatewayHandler>,
  name: string,
  params?: unknown,
): Promise<{ success: boolean; payload: unknown }> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Missing gateway method: ${name}`);

  let success = false;
  let payload: unknown;
  await handler({
    params,
    respond: (ok, data) => {
      success = ok;
      payload = data;
    },
  });

  return { success, payload };
}

export function createAuthContext() {
  return {
    isRemote: false,
    openUrl: vi.fn(async () => {}),
    runtime: {
      log: vi.fn(),
    },
    prompter: {
      progress: vi.fn(() => ({
        update: vi.fn(),
        stop: vi.fn(),
      })),
      note: vi.fn(async () => {}),
      text: vi.fn(async () => "dummy"),
    },
  };
}
