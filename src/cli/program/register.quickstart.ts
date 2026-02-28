import type { Command } from "commander";

import { quickstartCommand } from "../../commands/quickstart.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerQuickstartCommand(program: Command) {
  program
    .command("quickstart")
    .description("Zero-config setup — auto-detects credentials and opens the dashboard")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/start/getting-started", "docs.molt.bot/start/getting-started")}\n`,
    )
    .option("--workspace <dir>", "Agent workspace directory (default: ~/clawd)")
    .option("--port <port>", "Gateway port (default: 18789)")
    .option("--skip-open", "Don't open the dashboard in the browser")
    .option("--json", "Output JSON summary instead of human-friendly text")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await quickstartCommand(
          {
            workspace: opts.workspace as string | undefined,
            port: opts.port ? Number.parseInt(opts.port as string, 10) : undefined,
            skipOpen: Boolean(opts.skipOpen),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });
}
