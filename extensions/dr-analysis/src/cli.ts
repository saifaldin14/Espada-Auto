/**
 * DR Analysis CLI commands — wired to Knowledge Graph bridge.
 */

import type { Command } from "commander";
import type { KnowledgeGraphBridge } from "./kg-bridge.js";
import type { FailureScenario } from "./types.js";

export function registerDRCli(program: Command, bridge?: KnowledgeGraphBridge | null): void {
  const dr = program
    .command("dr")
    .description("Disaster recovery analysis");

  dr.command("posture")
    .description("Analyze DR posture and get a score/grade")
    .option("--provider <p>", "Filter by cloud provider")
    .option("--region <r>", "Filter by region")
    .action(async (opts: { provider?: string; region?: string }) => {
      console.log("DR Posture Analysis");
      console.log(`Provider: ${opts.provider ?? "all"}, Region: ${opts.region ?? "all"}`);

      if (!bridge) {
        console.log("Knowledge Graph not available. Enable the knowledge-graph plugin for live analysis.");
        return;
      }

      try {
        const sync = await bridge.sync({ provider: opts.provider, region: opts.region });
        console.log(`Synced ${sync.nodeCount} nodes, ${sync.edgeCount} edges from Knowledge Graph`);

        const analysis = bridge.analyzePosture();
        if (!analysis) {
          console.log("No infrastructure data found matching filters.");
          return;
        }

        console.log(`\nGrade: ${analysis.grade} (Score: ${analysis.overallScore}/100)`);
        console.log(`Single-region risks: ${analysis.singleRegionRisks.length}`);
        console.log(`Unprotected critical resources: ${analysis.unprotectedCriticalResources.length}`);
        if (analysis.recommendations.length > 0) {
          console.log("\nTop recommendations:");
          for (const rec of analysis.recommendations.slice(0, 5)) {
            console.log(`  [${rec.severity}] ${rec.description}`);
          }
        }
      } catch (err) {
        console.error(`Analysis failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  dr.command("plan")
    .description("Generate recovery plan for a failure scenario")
    .requiredOption("--scenario <s>", "Scenario: region-failure, az-failure, service-outage, data-corruption")
    .option("--region <r>", "Target region")
    .action(async (opts: { scenario: string; region?: string }) => {
      console.log(`Recovery Plan: ${opts.scenario}`);
      if (opts.region) console.log(`Region: ${opts.region}`);

      if (!bridge) {
        console.log("Knowledge Graph not available. Enable the knowledge-graph plugin for plan generation.");
        return;
      }

      try {
        await bridge.sync({ region: opts.region });
        const validScenarios: FailureScenario[] = [
          "region-failure", "az-failure", "service-outage", "data-corruption",
        ];
        const scenario = validScenarios.includes(opts.scenario as FailureScenario)
          ? (opts.scenario as FailureScenario)
          : "region-failure";

        const plan = bridge.generatePlan(scenario, opts.region);
        if (!plan) {
          console.log("No infrastructure data found.");
          return;
        }

        console.log(`\nAffected resources: ${plan.affectedResources.length}`);
        console.log(`Estimated RTO: ${plan.estimatedRTO} min`);
        console.log(`Estimated RPO: ${plan.estimatedRPO} min`);
        console.log(`Recovery steps: ${plan.recoverySteps.length}`);
        for (const step of plan.recoverySteps) {
          const marker = step.manual ? "[MANUAL]" : "[AUTO]";
          console.log(`  ${step.order}. ${marker} ${step.action} — ${step.resourceName} (${step.estimatedDuration} min)`);
        }
      } catch (err) {
        console.error(`Plan generation failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  dr.command("gaps")
    .description("List resources lacking DR protection")
    .option("--type <t>", "Filter by resource type")
    .action(async (opts: { type?: string }) => {
      console.log("DR Protection Gaps");
      if (opts.type) console.log(`Type filter: ${opts.type}`);

      if (!bridge) {
        console.log("Knowledge Graph not available. Enable the knowledge-graph plugin to identify gaps.");
        return;
      }

      try {
        await bridge.sync();
        const gaps = bridge.findGaps(opts.type);

        if (gaps.length === 0) {
          console.log("\nNo unprotected resources found. ✓");
          return;
        }

        console.log(`\n${gaps.length} unprotected resource(s):`);
        for (const g of gaps) {
          console.log(`  • ${g.name} (${g.provider}/${g.region}) — ${g.resourceType}`);
        }
      } catch (err) {
        console.error(`Gap analysis failed: ${err instanceof Error ? err.message : err}`);
      }
    });
}
