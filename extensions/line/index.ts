import type { EspadaPluginApi } from "espada/plugin-sdk";
import { emptyPluginConfigSchema } from "espada/plugin-sdk";

import { linePlugin } from "./src/channel.js";
import { registerLineCardCommand } from "./src/card-command.js";
import { setLineRuntime } from "./src/runtime.js";

const plugin = {
  id: "line",
  name: "LINE",
  description: "LINE Messaging API channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: EspadaPluginApi) {
    setLineRuntime(api.runtime);
    api.registerChannel({ plugin: linePlugin });
    registerLineCardCommand(api);
  },
};

export default plugin;
