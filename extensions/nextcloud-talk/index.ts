import type { EspadaPluginApi } from "espada/plugin-sdk";
import { emptyPluginConfigSchema } from "espada/plugin-sdk";

import { nextcloudTalkPlugin } from "./src/channel.js";
import { setNextcloudTalkRuntime } from "./src/runtime.js";

const plugin = {
  id: "nextcloud-talk",
  name: "Nextcloud Talk",
  description: "Nextcloud Talk channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: EspadaPluginApi) {
    setNextcloudTalkRuntime(api.runtime);
    api.registerChannel({ plugin: nextcloudTalkPlugin });
  },
};

export default plugin;
