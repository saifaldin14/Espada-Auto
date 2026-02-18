/**
 * Compliance Mapping — Plugin Entry Point
 *
 * Registers 4 agent tools, CLI commands, and 3 gateway methods.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import type { ControlEvalNode, FrameworkId } from "./src/types.js";
import { InMemoryWaiverStore } from "./src/waivers.js";
import { createComplianceTools } from "./src/tools.js";
import { createComplianceCli } from "./src/cli.js";
import { evaluate } from "./src/evaluator.js";
import { generateReport, exportMarkdown, filterViolations } from "./src/reporter.js";

export default {
  id: "compliance",
  name: "Compliance Mapping",
  register(api: EspadaPluginApi) {
    const waiverStore = new InMemoryWaiverStore();

    // Graph node accessor — injected via context by knowledge-graph plugin
    const getNodes = (): ControlEvalNode[] => {
      const ctx = api.pluginConfig as Record<string, unknown> | undefined;
      if (ctx && Array.isArray(ctx.graphNodes)) return ctx.graphNodes as ControlEvalNode[];
      return [];
    };

    // ── Agent tools ─────────────────────────────────────────────
    const tools = createComplianceTools(getNodes, waiverStore);
    for (const tool of tools) {
      api.registerTool(tool as any);
    }

    // ── CLI ─────────────────────────────────────────────────────
    api.registerCli((ctx) => createComplianceCli(getNodes, waiverStore)(ctx.program), {
      commands: ["compliance"],
    });

    // ── Gateway methods ─────────────────────────────────────────

    // compliance/scan — run scan
    api.registerGatewayMethod(
      "compliance/scan",
      async ({ params, respond }) => {
        const framework = (params as Record<string, string>).framework;
        const nodes = getNodes();
        if (nodes.length === 0) {
          respond(false, { error: "No graph nodes available" });
          return;
        }
        const result = evaluate(framework as FrameworkId, nodes, waiverStore);
        const report = generateReport(result);
        respond(true, report);
      },
    );

    // compliance/report — generate markdown report
    api.registerGatewayMethod(
      "compliance/report",
      async ({ params, respond }) => {
        const framework = (params as Record<string, string>).framework;
        const nodes = getNodes();
        const result = evaluate(framework as FrameworkId, nodes, waiverStore);
        const report = generateReport(result);
        const md = exportMarkdown(report);
        respond(true, { markdown: md, report });
      },
    );

    // compliance/violations — list violations
    api.registerGatewayMethod(
      "compliance/violations",
      async ({ params, respond }) => {
        const p = params as Record<string, string>;
        const nodes = getNodes();
        const result = evaluate(p.framework as FrameworkId, nodes, waiverStore);
        const filtered = filterViolations(result.violations, {
          status: p.status,
          severity: p.severity,
        });
        respond(true, { violations: filtered, total: filtered.length });
      },
    );

    // ── Service lifecycle ───────────────────────────────────────
    api.registerService({
      id: "compliance",
      start: async () => {},
      stop: async () => {},
    });
  },
};
