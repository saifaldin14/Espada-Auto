/**
 * Policy Engine — Integration bridges
 *
 * Converts data from other subsystems into PolicyEvaluationInput payloads.
 */

import type { PolicyEvaluationInput, ResourceInput, PlanInput, ActorInput, GraphContextInput, CostInput } from "./types.js";

/** Build a PolicyEvaluationInput from a Terraform plan summary */
export function buildPlanPolicyInput(opts: {
  creates: number;
  updates: number;
  deletes: number;
  resources?: ResourceInput[];
  actor?: ActorInput;
  environment?: string;
}): PolicyEvaluationInput {
  const plan: PlanInput = {
    totalCreates: opts.creates,
    totalUpdates: opts.updates,
    totalDeletes: opts.deletes,
    resources: opts.resources ?? [],
  };
  return {
    plan,
    actor: opts.actor,
    environment: opts.environment,
  };
}

/** Build a PolicyEvaluationInput from a resource discovery result */
export function buildResourcePolicyInput(opts: {
  id: string;
  type: string;
  name?: string;
  provider: string;
  region?: string;
  status?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
  actor?: ActorInput;
  environment?: string;
  graph?: GraphContextInput;
}): PolicyEvaluationInput {
  const resource: ResourceInput = {
    id: opts.id,
    type: opts.type,
    name: opts.name ?? opts.id,
    provider: opts.provider,
    region: opts.region ?? "unknown",
    status: opts.status ?? "active",
    tags: opts.tags ?? {},
    metadata: opts.metadata ?? {},
  };
  return {
    resource,
    actor: opts.actor,
    environment: opts.environment,
    graph: opts.graph,
  };
}

/** Build a PolicyEvaluationInput from a drift detection result */
export function buildDriftPolicyInput(opts: {
  resource: ResourceInput;
  driftedFields: string[];
  actor?: ActorInput;
  graph?: GraphContextInput;
}): PolicyEvaluationInput {
  return {
    resource: {
      ...opts.resource,
      metadata: {
        ...opts.resource.metadata,
        drifted: true,
        driftedFields: opts.driftedFields,
        driftFieldCount: opts.driftedFields.length,
      },
    },
    actor: opts.actor,
    graph: opts.graph,
  };
}

/** Build a PolicyEvaluationInput from cost estimation data */
export function buildCostPolicyInput(opts: {
  current: number;
  projected: number;
  resource?: ResourceInput;
  actor?: ActorInput;
  environment?: string;
}): PolicyEvaluationInput {
  const cost: CostInput = {
    current: opts.current,
    projected: opts.projected,
    delta: opts.projected - opts.current,
    currency: "USD",
  };
  return {
    cost,
    resource: opts.resource,
    actor: opts.actor,
    environment: opts.environment,
  };
}

/** Build a PolicyEvaluationInput for access control evaluation */
export function buildAccessPolicyInput(opts: {
  actor: ActorInput;
  targetResource: ResourceInput;
  operation: string;
  environment?: string;
}): PolicyEvaluationInput {
  return {
    resource: {
      ...opts.targetResource,
      metadata: {
        ...opts.targetResource.metadata,
        requestedOperation: opts.operation,
      },
    },
    actor: opts.actor,
    environment: opts.environment,
  };
}
