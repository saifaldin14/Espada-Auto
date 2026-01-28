import type { EspadaPluginApi } from "espada/plugin-sdk";
import { emptyPluginConfigSchema } from "espada/plugin-sdk";

import { matrixPlugin } from "./src/channel.js";
import { setMatrixRuntime } from "./src/runtime.js";

const plugin = {
  id: "matrix",
  name: "Matrix",
  description: "Matrix channel plugin (matrix-js-sdk)",
  configSchema: emptyPluginConfigSchema(),
  register(api: EspadaPluginApi) {
    setMatrixRuntime(api.runtime);
    api.registerChannel({ plugin: matrixPlugin });
  },
};

export default plugin;
