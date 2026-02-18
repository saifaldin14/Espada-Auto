/**
 * @espada/policy-engine — Plugin Entry Point
 *
 * Registers policy tools, CLI commands, gateway methods, and storage lifecycle.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { SQLitePolicyStorage, InMemoryPolicyStorage, createPolicyFromInput } from "./src/storage.js";
import { PolicyEvaluationEngine } from "./src/engine.js";
import { createPolicyTools } from "./src/tools.js";
import { createPolicyCli } from "./src/cli.js";
import { getLibraryPolicies, getLibraryPolicy } from "./src/library.js";
import { buildResourcePolicyInput, buildPlanPolicyInput } from "./src/integration.js";
import type { PolicyStorage, ResourceInput } from "./src/types.js";

export default {
  id: "policy-engine",
  name: "Policy Engine",
  description: "Policy-as-Code engine for evaluating and enforcing infrastructure policies",
  version: "1.0.0",

  async register(api: EspadaPluginApi) {
    const useMemory = process.env.NODE_ENV === "test" || process.env.ESPADA_TEST === "1";
    let storage: PolicyStorage;

    if (useMemory) {
      storage = new InMemoryPolicyStorage();
    } else {
      const dbPath = api.resolvePath("policies.db");
      storage = new SQLitePolicyStorage(dbPath);
    }

    const engine = new PolicyEvaluationEngine();

    // ── Tools ─────────────────────────────────────────────────────
    for (const tool of createPolicyTools(storage)) {
      api.registerTool(tool as any);
    }

    // ── CLI ───────────────────────────────────────────────────────
    api.registerCli((ctx) => createPolicyCli(storage)(ctx), {
      commands: ["policy"],
    });

    // ── Gateway Methods ───────────────────────────────────────────
    api.registerGatewayMethod("policy/evaluate", async ({ params, respond }) => {
      const { resource, environment } = params as { resource: ResourceInput; environment?: string };
      const policies = await storage.list({ enabled: true });
      const input = buildResourcePolicyInput({
        id: resource.id,
        type: resource.type,
        name: resource.name,
        provider: resource.provider,
        region: resource.region,
        tags: resource.tags,
        metadata: resource.metadata,
        environment,
      });
      const result = engine.evaluateAll(policies, input);
      respond(true, result);
    });

    api.registerGatewayMethod("policy/check-plan", async ({ params, respond }) => {
      const { creates, updates, deletes, resources, environment } = params as {
        creates: number;
        updates: number;
        deletes: number;
        resources?: ResourceInput[];
        environment?: string;
      };
      const policies = await storage.list({ enabled: true });
      const input = buildPlanPolicyInput({ creates, updates, deletes, resources, environment });
      const result = engine.evaluateAll(policies, input);
      respond(true, result);
    });

    api.registerGatewayMethod("policy/list", async ({ params, respond }) => {
      const { type, severity, enabled } = params as { type?: string; severity?: string; enabled?: boolean };
      const policies = await storage.list({ type, severity, enabled });
      respond(true, policies);
    });

    api.registerGatewayMethod("policy/save", async ({ params, respond }) => {
      const { policy } = params as { policy: Record<string, unknown> };
      const p = createPolicyFromInput(policy as any);
      await storage.save(p);
      respond(true, { id: p.id });
    });

    api.registerGatewayMethod("policy/delete", async ({ params, respond }) => {
      const { id } = params as { id: string };
      const deleted = await storage.delete(id);
      respond(true, { deleted });
    });

    api.registerGatewayMethod("policy/library", async ({ respond }) => {
      respond(true, getLibraryPolicies());
    });

    api.registerGatewayMethod("policy/library-import", async ({ params, respond }) => {
      const { templateId, customId } = params as { templateId: string; customId?: string };
      const template = getLibraryPolicy(templateId);
      if (!template) {
        respond(false, { error: `Template "${templateId}" not found` });
        return;
      }
      const input = { ...template.template };
      if (customId) input.id = customId;
      const p = createPolicyFromInput(input);
      await storage.save(p);
      respond(true, { id: p.id, name: p.name });
    });

    api.registerGatewayMethod("policy/scan", async ({ params, respond }) => {
      const { resources } = params as { resources: ResourceInput[] };
      const policies = await storage.list({ enabled: true });
      const violations = engine.scanResources(policies, resources);
      respond(true, { totalViolations: violations.length, violations });
    });

    // ── Service Lifecycle ─────────────────────────────────────────
    api.registerService({
      id: "policy-engine",
      start: async () => {
        await storage.initialize();
        api.logger.info("[policy-engine] Storage initialized");
      },
      stop: async () => {
        await storage.close();
        api.logger.info("[policy-engine] Storage closed");
      },
    });
  },
};
