/**
 * Policy Engine — Rule Evaluator
 *
 * Evaluates declarative policy rules against input data.
 * Supports nested field access, tag checks, logical combinators (and/or/not),
 * and resource/provider/region matching.
 */

import type {
  PolicyDefinition,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  AggregatedPolicyResult,
  RuleCondition,
  RuleResult,
  PolicyViolation,
  ResourceInput,
} from "./types.js";

/** Get a nested field value from an object by dot-separated path */
function getField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Build a flat input object for rule evaluation */
function flattenInput(input: PolicyEvaluationInput): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  if (input.resource) {
    flat.resource = input.resource;
    flat["resource.id"] = input.resource.id;
    flat["resource.type"] = input.resource.type;
    flat["resource.provider"] = input.resource.provider;
    flat["resource.region"] = input.resource.region;
    flat["resource.name"] = input.resource.name;
    flat["resource.status"] = input.resource.status;
    flat["resource.tags"] = input.resource.tags;
    flat["resource.metadata"] = input.resource.metadata;
    // Flatten tags
    for (const [k, v] of Object.entries(input.resource.tags)) {
      flat[`resource.tags.${k}`] = v;
    }
    // Flatten metadata
    for (const [k, v] of Object.entries(input.resource.metadata)) {
      flat[`resource.metadata.${k}`] = v;
    }
  }

  if (input.plan) {
    flat.plan = input.plan;
    flat["plan.totalCreates"] = input.plan.totalCreates;
    flat["plan.totalUpdates"] = input.plan.totalUpdates;
    flat["plan.totalDeletes"] = input.plan.totalDeletes;
  }

  if (input.actor) {
    flat.actor = input.actor;
    flat["actor.id"] = input.actor.id;
    flat["actor.roles"] = input.actor.roles;
  }

  if (input.environment) {
    flat.environment = input.environment;
  }

  if (input.cost) {
    flat.cost = input.cost;
    flat["cost.current"] = input.cost.current;
    flat["cost.projected"] = input.cost.projected;
    flat["cost.delta"] = input.cost.delta;
  }

  if (input.graph) {
    flat.graph = input.graph;
    flat["graph.blastRadius"] = input.graph.blastRadius;
    flat["graph.dependencyDepth"] = input.graph.dependencyDepth;
  }

  return flat;
}

/** Evaluate a single rule condition */
function evaluateCondition(condition: RuleCondition, data: Record<string, unknown>, resource?: ResourceInput): boolean {
  switch (condition.type) {
    case "field_equals":
      return getField(data, condition.field) === condition.value;
    case "field_not_equals":
      return getField(data, condition.field) !== condition.value;
    case "field_contains": {
      const val = getField(data, condition.field);
      if (typeof val === "string") return val.includes(condition.value);
      if (Array.isArray(val)) return val.includes(condition.value);
      return false;
    }
    case "field_matches": {
      const val = getField(data, condition.field);
      if (typeof val !== "string") return false;
      return new RegExp(condition.pattern).test(val);
    }
    case "field_gt": {
      const val = getField(data, condition.field);
      return typeof val === "number" && val > condition.value;
    }
    case "field_lt": {
      const val = getField(data, condition.field);
      return typeof val === "number" && val < condition.value;
    }
    case "field_exists":
      return getField(data, condition.field) !== undefined;
    case "field_not_exists":
      return getField(data, condition.field) === undefined;
    case "field_in":
      return condition.values.includes(getField(data, condition.field));
    case "field_not_in":
      return !condition.values.includes(getField(data, condition.field));
    case "tag_missing":
      return !resource?.tags || !(condition.tag in resource.tags);
    case "tag_equals":
      return resource?.tags?.[condition.tag] === condition.value;
    case "and":
      return condition.conditions.every((c) => evaluateCondition(c, data, resource));
    case "or":
      return condition.conditions.some((c) => evaluateCondition(c, data, resource));
    case "not":
      return !evaluateCondition(condition.condition, data, resource);
    case "resource_type":
      return resource?.type === condition.resourceType;
    case "provider":
      return resource?.provider === condition.provider;
    case "region":
      return resource?.region === condition.region;
    case "custom":
      // Custom evaluators would be registered externally — for now just pass
      return true;
  }
}

export class PolicyEvaluationEngine {
  /** Evaluate a single policy against input */
  evaluate(policy: PolicyDefinition, input: PolicyEvaluationInput): PolicyEvaluationResult {
    const startTime = Date.now();

    if (!policy.enabled) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        allowed: true,
        denied: false,
        warnings: [],
        denials: [],
        approvalRequired: false,
        notifications: [],
        evaluatedRules: [],
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }

    const data = flattenInput(input);
    const warnings: string[] = [];
    const denials: string[] = [];
    const notifications: string[] = [];
    let approvalRequired = false;
    const ruleResults: RuleResult[] = [];

    for (const rule of policy.rules) {
      const triggered = evaluateCondition(rule.condition, data, input.resource);

      if (triggered) {
        const result: RuleResult = {
          ruleId: rule.id,
          description: rule.description,
          passed: false,
          action: rule.action,
          message: rule.message,
        };

        switch (rule.action) {
          case "deny":
            denials.push(rule.message);
            break;
          case "warn":
            warnings.push(rule.message);
            break;
          case "require_approval":
            approvalRequired = true;
            warnings.push(`Approval required: ${rule.message}`);
            break;
          case "notify":
            notifications.push(rule.message);
            break;
        }

        ruleResults.push(result);
      } else {
        ruleResults.push({
          ruleId: rule.id,
          description: rule.description,
          passed: true,
          action: rule.action,
          message: rule.message,
        });
      }
    }

    return {
      policyId: policy.id,
      policyName: policy.name,
      allowed: denials.length === 0,
      denied: denials.length > 0,
      warnings,
      denials,
      approvalRequired,
      notifications,
      evaluatedRules: ruleResults,
      evaluatedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  /** Evaluate all policies against input, combining results (deny wins) */
  evaluateAll(policies: PolicyDefinition[], input: PolicyEvaluationInput): AggregatedPolicyResult {
    const startTime = Date.now();
    const results: PolicyEvaluationResult[] = [];
    const allWarnings: string[] = [];
    const allDenials: string[] = [];
    const allNotifications: string[] = [];
    let anyApprovalRequired = false;
    let passedCount = 0;
    let failedCount = 0;

    for (const policy of policies) {
      const result = this.evaluate(policy, input);
      results.push(result);

      allWarnings.push(...result.warnings);
      allDenials.push(...result.denials);
      allNotifications.push(...result.notifications);

      if (result.approvalRequired) anyApprovalRequired = true;
      if (result.denied) failedCount++;
      else passedCount++;
    }

    return {
      allowed: allDenials.length === 0,
      denied: allDenials.length > 0,
      warnings: allWarnings,
      denials: allDenials,
      approvalRequired: anyApprovalRequired,
      notifications: allNotifications,
      results,
      totalPolicies: policies.length,
      passedPolicies: passedCount,
      failedPolicies: failedCount,
      evaluatedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startTime,
    };
  }

  /** Scan resources against policies and return violations */
  scanResources(policies: PolicyDefinition[], resources: ResourceInput[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    for (const resource of resources) {
      const input: PolicyEvaluationInput = { resource };

      for (const policy of policies) {
        if (!policy.enabled) continue;

        // Check if policy auto-attaches to this resource via labels/patterns
        if (!this.policyApplies(policy, resource)) continue;

        const result = this.evaluate(policy, input);

        for (const ruleResult of result.evaluatedRules) {
          if (!ruleResult.passed) {
            violations.push({
              policyId: policy.id,
              policyName: policy.name,
              ruleId: ruleResult.ruleId,
              ruleDescription: ruleResult.description,
              severity: policy.severity,
              action: ruleResult.action,
              message: ruleResult.message,
              resourceId: resource.id,
              resourceType: resource.type,
              resourceName: resource.name,
              provider: resource.provider,
            });
          }
        }
      }
    }

    return violations;
  }

  /** Check if a policy should apply to a resource based on auto-attach patterns */
  private policyApplies(policy: PolicyDefinition, resource: ResourceInput): boolean {
    if (policy.autoAttachPatterns.length === 0) return true;

    for (const pattern of policy.autoAttachPatterns) {
      // Pattern formats: "provider:*", "type:ec2", "tag:environment=production", "*"
      if (pattern === "*") return true;

      const [key, value] = pattern.split(":");
      if (key === "provider" && resource.provider === value) return true;
      if (key === "type" && resource.type === value) return true;
      if (key === "region" && resource.region === value) return true;
      if (key === "tag") {
        const [tagKey, tagValue] = (value ?? "").split("=");
        if (tagValue) {
          if (resource.tags[tagKey] === tagValue) return true;
        } else {
          if (tagKey in resource.tags) return true;
        }
      }
    }

    return false;
  }
}
