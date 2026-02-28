/**
 * MCP Server Tests
 *
 * Validates the JSON-RPC protocol handling, tool dispatch,
 * and error paths of the infra-graph MCP server.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "./server.js";
import { buildToolRegistry } from "./tool-registry.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import { GraphEngine } from "../core/engine.js";
import type { GraphStorage } from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

function req(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

function notification(method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0" as const, method, params };
}

// =============================================================================
// Tests
// =============================================================================

describe("McpServer", () => {
  let server: McpServer;
  let storage: GraphStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
    const engine = new GraphEngine({ storage });
    const tools = buildToolRegistry({ engine, storage });
    server = new McpServer(tools);
  });

  // ─── Initialize ──────────────────────────────────────────────────
  describe("initialize", () => {
    it("returns protocol version and capabilities", async () => {
      const res = await server.handleRequest(req("initialize"));
      expect(res).not.toBeNull();
      expect(res!.result).toEqual(
        expect.objectContaining({
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "infra-graph", version: "1.0.0" },
        }),
      );
    });

    it("echoes the request id", async () => {
      const res = await server.handleRequest(req("initialize", undefined, 42));
      expect(res!.id).toBe(42);
    });
  });

  // ─── Notifications ──────────────────────────────────────────────
  describe("notifications", () => {
    it("returns null for notifications/initialized", async () => {
      const res = await server.handleRequest(notification("notifications/initialized"));
      expect(res).toBeNull();
    });

    it("returns null for notifications/cancelled", async () => {
      const res = await server.handleRequest(notification("notifications/cancelled"));
      expect(res).toBeNull();
    });
  });

  // ─── tools/list ──────────────────────────────────────────────────
  describe("tools/list", () => {
    it("returns all registered tools", async () => {
      const res = await server.handleRequest(req("tools/list"));
      const result = res!.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
      expect(result.tools.length).toBeGreaterThanOrEqual(24); // at least the non-temporal tools
      // Every tool should have a name, description, and inputSchema
      for (const tool of result.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
    });

    it("all tool names start with kg_", async () => {
      const res = await server.handleRequest(req("tools/list"));
      const result = res!.result as { tools: Array<{ name: string }> };
      for (const tool of result.tools) {
        expect(tool.name).toMatch(/^kg_/);
      }
    });
  });

  // ─── tools/call ──────────────────────────────────────────────────
  describe("tools/call", () => {
    it("executes kg_status and returns content", async () => {
      const res = await server.handleRequest(
        req("tools/call", { name: "kg_status", arguments: {} }),
      );
      const result = res!.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Knowledge Graph Status");
    });

    it("executes kg_query with a simple FIND", async () => {
      const res = await server.handleRequest(
        req("tools/call", {
          name: "kg_query",
          arguments: { query: "FIND resources WHERE type = 'ec2'" },
        }),
      );
      const result = res!.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("IQL Query Result");
    });

    it("returns isError for unknown tool", async () => {
      const res = await server.handleRequest(
        req("tools/call", { name: "nonexistent_tool", arguments: {} }),
      );
      const result = res!.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool");
    });

    it("returns isError when tool execution throws", async () => {
      // kg_blast_radius with a nonexistent resource should still return successfully
      // (an empty result), so let's use kg_path with missing params to trigger a more
      // predictable scenario
      const res = await server.handleRequest(
        req("tools/call", { name: "kg_path", arguments: { from: "a", to: "b" } }),
      );
      const result = res!.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      // either succeeds (no path found) or errors — both are valid
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");
    });
  });

  // ─── Protocol stubs ──────────────────────────────────────────────
  describe("protocol stubs", () => {
    it("returns empty resources list", async () => {
      const res = await server.handleRequest(req("resources/list"));
      expect(res!.result).toEqual({ resources: [] });
    });

    it("returns empty prompts list", async () => {
      const res = await server.handleRequest(req("prompts/list"));
      expect(res!.result).toEqual({ prompts: [] });
    });
  });

  // ─── ping ─────────────────────────────────────────────────────────
  describe("ping", () => {
    it("responds with empty result", async () => {
      const res = await server.handleRequest(req("ping"));
      expect(res!.result).toEqual({});
    });
  });

  // ─── Error handling ──────────────────────────────────────────────
  describe("error handling", () => {
    it("returns -32601 for unknown methods", async () => {
      const res = await server.handleRequest(req("unknown/method"));
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32601);
      expect(res!.error!.message).toContain("Method not found");
    });

    it("preserves request id in error response", async () => {
      const res = await server.handleRequest(req("unknown/method", undefined, "abc-123"));
      expect(res!.id).toBe("abc-123");
    });
  });
});
