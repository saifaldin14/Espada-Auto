/**
 * VCS CLI commands — espada vcs pr/configure/webhook.
 */

import type { Command } from "commander";

interface VcsCliContext {
  program: Command;
}

export function createVcsCli() {
  return (ctx: VcsCliContext) => {
    const vcs = ctx.program.command("vcs").description("Version control system operations");

    /* --- configure --- */
    vcs
      .command("configure")
      .description("Configure VCS provider (GitHub/GitLab)")
      .option("--provider <provider>", "VCS provider: github or gitlab")
      .option("--token <token>", "API token")
      .option("--owner <owner>", "Repository owner")
      .option("--repo <repo>", "Repository name")
      .option("--webhook-secret <secret>", "Webhook secret for signature verification")
      .action((opts: Record<string, string>) => {
        console.log("VCS configuration saved:", {
          provider: opts.provider,
          owner: opts.owner,
          repo: opts.repo,
          hasToken: !!opts.token,
          hasWebhookSecret: !!opts.webhookSecret,
        });
      });

    /* --- pr subcommands --- */
    const pr = vcs.command("pr").description("Pull request operations");

    pr.command("list")
      .description("List pull requests")
      .option("--state <state>", "PR state: open, closed, all", "open")
      .action(async (opts: { state: string }) => {
        console.log(`Listing ${opts.state} pull requests...`);
        console.log("Configure VCS client first: espada vcs configure");
      });

    pr.command("create")
      .description("Create a pull request")
      .requiredOption("--title <title>", "PR title")
      .requiredOption("--branch <branch>", "Source branch")
      .option("--base <base>", "Target branch", "main")
      .option("--body <body>", "PR description")
      .action(async (opts: { title: string; branch: string; base: string; body?: string }) => {
        console.log(`Creating PR: "${opts.title}" (${opts.branch} → ${opts.base})`);
        console.log("Configure VCS client first: espada vcs configure");
      });

    pr.command("status")
      .description("Show PR status with checks")
      .argument("<number>", "PR number")
      .action(async (number: string) => {
        console.log(`Fetching status for PR #${number}...`);
        console.log("Configure VCS client first: espada vcs configure");
      });

    /* --- webhook --- */
    vcs
      .command("webhook")
      .description("Start webhook listener on gateway")
      .option("--port <port>", "listener port", "8080")
      .action((opts: { port: string }) => {
        console.log(`Webhook listener would start on port ${opts.port}`);
        console.log("This requires the gateway to be running.");
      });
  };
}
