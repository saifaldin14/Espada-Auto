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
    id: "test-plugin",
    name: "test-plugin",
    source: "test",
    config: {} as Record<string, unknown>,
    pluginConfig: {},
    registerGatewayMethod: (name: string, handler: GatewayHandler) => {
      gatewayMethods.set(name, handler);
    },
    registerProvider,
    registerTool,
    registerCli,
    registerService,
    registerChannel: vi.fn(),
    registerHook: vi.fn(),
    registerHttpHandler: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerCommand: vi.fn(),
    on: vi.fn(),
    resolvePath: (value: string) => value,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    runtime: {
      version: "0.0.0-test",
      config: { loadConfig: vi.fn(), writeConfigFile: vi.fn() },
      system: { enqueueSystemEvent: vi.fn(), runCommandWithTimeout: vi.fn(), formatNativeDependencyHint: vi.fn() },
      media: {
        loadWebMedia: vi.fn(),
        detectMime: vi.fn(),
        mediaKindFromMime: vi.fn(),
        isVoiceCompatibleAudio: vi.fn(),
        getImageMetadata: vi.fn(),
        resizeToJpeg: vi.fn(),
      },
      tts: { textToSpeechTelephony: vi.fn() },
      log: vi.fn(),
      tools: {
        createMemorySearchTool: vi.fn(() => ({ name: "memory_search" })),
        createMemoryGetTool: vi.fn(() => ({ name: "memory_get" })),
        registerMemoryCli: vi.fn(),
      },
      channel: {
        text: {
          chunkByNewline: vi.fn(),
          chunkMarkdownText: vi.fn(),
          chunkMarkdownTextWithMode: vi.fn(),
          chunkText: vi.fn(),
          chunkTextWithMode: vi.fn(),
          resolveChunkMode: vi.fn(),
          resolveTextChunkLimit: vi.fn(),
          hasControlCommand: vi.fn(),
          resolveMarkdownTableMode: vi.fn(),
          convertMarkdownTables: vi.fn(),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
          createReplyDispatcherWithTyping: vi.fn(),
          resolveEffectiveMessagesConfig: vi.fn(),
          resolveHumanDelayConfig: vi.fn(),
          dispatchReplyFromConfig: vi.fn(),
          finalizeInboundContext: vi.fn(),
          formatAgentEnvelope: vi.fn(),
          formatInboundEnvelope: vi.fn(),
          resolveEnvelopeFormatOptions: vi.fn(),
        },
        routing: { resolveAgentRoute: vi.fn() },
        pairing: {
          buildPairingReply: vi.fn(),
          readAllowFromStore: vi.fn(),
          upsertPairingRequest: vi.fn(),
        },
        media: { fetchRemoteMedia: vi.fn(), saveMediaBuffer: vi.fn() },
        activity: { record: vi.fn(), get: vi.fn() },
        session: {
          resolveStorePath: vi.fn(),
          readSessionUpdatedAt: vi.fn(),
          recordSessionMetaFromInbound: vi.fn(),
          recordInboundSession: vi.fn(),
          updateLastRoute: vi.fn(),
        },
      },
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- lightweight test mock

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
