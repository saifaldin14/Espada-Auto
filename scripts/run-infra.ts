#!/usr/bin/env npx tsx
/**
 * Standalone runner for `espada infra` CLI commands.
 * Usage: npx tsx scripts/run-infra.ts cloud-scan --aws --aws-region us-east-1 --db ~/.espada/knowledge-graph.db
 */
import { Command } from "commander";
import { registerInfraCli } from "../extensions/knowledge-graph/src/cli/infra-cli.js";

const program = new Command("espada");
const ctx = {
  program,
  logger: {
    info: (msg: string) => console.error(msg),
    warn: (msg: string) => console.error(msg),
    error: (msg: string) => console.error(msg),
  },
};
registerInfraCli(ctx);
program.parse(["node", "espada", "infra", ...process.argv.slice(2)]);
