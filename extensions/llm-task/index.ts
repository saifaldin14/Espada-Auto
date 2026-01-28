import type { EspadaPluginApi } from "../../src/plugins/types.js";

import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: EspadaPluginApi) {
  api.registerTool(createLlmTaskTool(api), { optional: true });
}
