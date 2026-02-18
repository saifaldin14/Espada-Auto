/**
 * @espada/vcs — Plugin Entry Point
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { createVcsTools } from "./src/tools.js";
import { createVcsCli } from "./src/cli.js";

export default {
  id: "vcs",
  name: "VCS Integration",
  description: "Version control system integration for GitHub and GitLab",
  version: "1.0.0",

  async register(api: EspadaPluginApi) {
    for (const tool of createVcsTools()) {
      api.registerTool(tool as any);
    }

    api.registerCli(createVcsCli(), { commands: ["vcs"] });

    api.registerGatewayMethod("vcs/prs", async ({ respond }) => {
      respond(true, { message: "Configure VCS provider first via espada vcs configure" });
    });

    api.registerGatewayMethod("vcs/webhook", async ({ params, respond }) => {
      const { provider, eventType, payload } = params as {
        provider: string;
        eventType: string;
        payload: Record<string, unknown>;
      };
      try {
        if (provider === "github") {
          const { parseGitHubWebhook } = await import("./src/webhook-handler.js");
          const event = parseGitHubWebhook(eventType, payload);
          respond(true, event);
        } else if (provider === "gitlab") {
          const { parseGitLabWebhook } = await import("./src/webhook-handler.js");
          const event = parseGitLabWebhook(eventType, payload);
          respond(true, event);
        } else {
          respond(false, { error: `Unknown provider: ${provider}` });
        }
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerService({
      id: "vcs",
      start: async () => {
        api.logger.info("[vcs] Plugin loaded");
      },
      stop: async () => {},
    });
  },
};
