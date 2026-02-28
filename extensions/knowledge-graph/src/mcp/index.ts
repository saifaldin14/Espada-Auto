/**
 * MCP module — standalone tool registry + MCP server.
 */
export { buildToolRegistry, type ToolDefinition, type ToolResult, type ToolRegistryDeps } from "./tool-registry.js";
export { McpServer, startStdioServer } from "./server.js";
