/**
 * On-Premises Step — Verify Agent
 *
 * Pre-flight check that validates the on-prem migration agent is
 * reachable, authenticated, and has the required capabilities for
 * the planned migration operations.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export interface VerifyAgentParams {
  provider: string;
  region: string;
  requiredCapabilities?: string[];
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as VerifyAgentParams;
  ctx.log.info(`Verifying migration agent for ${params.provider} in ${params.region}`);

  const credentials = ctx.sourceCredentials as ProviderCredentialConfig | undefined;
  if (!credentials) {
    throw new Error("verify-agent step requires source credentials with agentEndpoint");
  }

  // Resolve the on-prem adapter and run health check
  const adapter = await resolveProviderAdapter(params.provider as MigrationProvider, credentials);
  const health = await adapter.healthCheck();

  if (!health.reachable) {
    throw new Error(
      `Migration agent not reachable at ${params.provider}: ${health.error ?? "unknown error"}. ` +
      `Ensure the agent is running and network connectivity is available.`,
    );
  }

  if (!health.authenticated) {
    throw new Error(
      `Migration agent authentication failed for ${params.provider}: ${health.error ?? "check API key"}`,
    );
  }

  ctx.log.info(`  Agent reachable: ${health.reachable}, authenticated: ${health.authenticated}`);
  ctx.log.info(`  Account: ${health.accountId}, latency: ${health.latencyMs}ms`);

  // If adapter has agent client, verify capabilities
  let capabilities: string[] = [];
  if ("getAgentClient" in adapter) {
    try {
      const agent = (adapter as { getAgentClient: () => { getCapabilities: () => Promise<{ capabilities: string[] }> } }).getAgentClient();
      const caps = await agent.getCapabilities();
      capabilities = caps.capabilities ?? [];
      ctx.log.info(`  Agent capabilities: ${capabilities.join(", ") || "none reported"}`);

      // Check required capabilities
      const required = params.requiredCapabilities ?? [];
      const missing = required.filter((c) => !capabilities.includes(c));
      if (missing.length > 0) {
        throw new Error(
          `Agent is missing required capabilities: ${missing.join(", ")}. ` +
          `Update the agent to a version that supports these operations.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("missing required capabilities")) {
        throw err;
      }
      ctx.log.warn(`  Could not fetch agent capabilities: ${err}`);
    }
  }

  return {
    agentReachable: health.reachable,
    agentAuthenticated: health.authenticated,
    agentLatencyMs: health.latencyMs,
    agentAccountId: health.accountId,
    capabilities,
    verifiedAt: new Date().toISOString(),
  };
}

async function rollback(ctx: MigrationStepContext): Promise<void> {
  // No-op: verification doesn't create any resources
  ctx.log.info("verify-agent rollback: nothing to roll back");
}

export const verifyAgentHandler: MigrationStepHandler = { execute, rollback };
