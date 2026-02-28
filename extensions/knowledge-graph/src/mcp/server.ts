#!/usr/bin/env node
/**
 * infra-graph MCP Server
 *
 * Exposes all 30 Infrastructure Knowledge Graph tools over the
 * Model Context Protocol (stdio transport). Works with Claude Desktop,
 * Cursor, Windsurf, Cody, Continue, and any MCP-compatible client.
 *
 * Usage:
 *   infra-graph mcp                          # stdio (default)
 *   infra-graph mcp --db ./infra.db          # persistent SQLite
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "infra-graph": {
 *         "command": "npx",
 *         "args": ["@infra-graph/core", "mcp"]
 *       }
 *     }
 *   }
 */

import { createInterface } from "node:readline";
import { GraphEngine } from "../core/engine.js";
import { SQLiteGraphStorage } from "../storage/index.js";
import { InMemoryGraphStorage } from "../storage/index.js";
import { SQLiteTemporalStorage } from "../storage/index.js";
import { buildToolRegistry, type ToolDefinition } from "./tool-registry.js";
import type { GraphStorage } from "../types.js";

// =============================================================================
// MCP Protocol Types (subset — just what we need for stdio transport)
// =============================================================================

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

// =============================================================================
// Server Implementation
// =============================================================================

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "infra-graph";
const SERVER_VERSION = "1.0.0";

export class McpServer {
  private tools: ToolDefinition[];
  private toolMap: Map<string, ToolDefinition>;

  constructor(tools: ToolDefinition[]) {
    this.tools = tools;
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
  }

  /**
   * Handle a JSON-RPC request. Returns null for notifications (no response expected).
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    try {
      switch (request.method) {
        case "initialize":
          return this.respond(request.id!, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
          });

        // ── Notifications (no response) ──────────────────────────────
        case "notifications/initialized":
        case "notifications/cancelled":
          return null;

        case "tools/list":
          return this.respond(request.id!, {
            tools: this.tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.parameters,
            })),
          });

        case "tools/call": {
          const toolName = (request.params as { name?: string })?.name;
          const args = (request.params as { arguments?: Record<string, unknown> })?.arguments ?? {};

          const tool = toolName ? this.toolMap.get(toolName) : undefined;
          if (!tool) {
            return this.respond(request.id!, {
              content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
              isError: true,
            });
          }

          try {
            const result = await tool.execute(args);
            return this.respond(request.id!, {
              content: result.content,
              isError: false,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return this.respond(request.id!, {
              content: [{ type: "text", text: `Tool error: ${message}` }],
              isError: true,
            });
          }
        }

        // ── Protocol stubs (we don't expose resources or prompts) ────
        case "resources/list":
          return this.respond(request.id!, { resources: [] });

        case "prompts/list":
          return this.respond(request.id!, { prompts: [] });

        case "ping":
          return this.respond(request.id!, {});

        default:
          return {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32603, message: `Internal error: ${message}` },
      };
    }
  }

  private respond(id: number | string, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }
}

// =============================================================================
// Stdio Transport
// =============================================================================

export async function startStdioServer(opts: { db?: string } = {}): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[infra-graph] ${msg}\n`);

  // Initialize storage + engine
  let storage: GraphStorage;
  if (opts.db) {
    storage = new SQLiteGraphStorage(opts.db);
  } else {
    storage = new InMemoryGraphStorage();
  }

  try {
    await storage.initialize();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Fatal: storage initialization failed — ${message}`);
    process.exit(1);
  }

  const engine = new GraphEngine({ storage });

  // Build temporal storage if SQLite — open a shared db connection
  let temporal: SQLiteTemporalStorage | undefined;
  let sqliteDb: import("better-sqlite3").Database | undefined;
  if (opts.db) {
    try {
      const Database = (await import("better-sqlite3")).default;
      sqliteDb = new Database(opts.db);
      temporal = new SQLiteTemporalStorage(storage, sqliteDb);
      await temporal.initializeTemporal();
    } catch {
      // better-sqlite3 not available — temporal features disabled
      log("Temporal storage unavailable (better-sqlite3 not installed)");
    }
  }

  // Build tool registry + MCP server
  const tools = buildToolRegistry({ engine, storage, temporal });
  const server = new McpServer(tools);

  // Read JSON-RPC messages from stdin (newline-delimited)
  const rl = createInterface({ input: process.stdin, terminal: false });

  const write = (msg: JsonRpcResponse) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  // ── Graceful shutdown ──────────────────────────────────────────────
  const shutdown = () => {
    log("Shutting down…");
    rl.close();
    if (sqliteDb) {
      try { sqliteDb.close(); } catch { /* already closed */ }
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log(`MCP server starting (${tools.length} tools, db: ${opts.db ?? "in-memory"})`);

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }

    const response = await server.handleRequest(request);
    if (response) write(response);
  }

  log("stdin closed, shutting down");
  shutdown();
}
