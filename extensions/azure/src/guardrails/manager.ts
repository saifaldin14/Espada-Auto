/**
 * Azure Guardrails / Governance Manager
 *
 * In-memory rule engine for operation approval, resource protection, and policy enforcement.
 * No external Azure SDK required — works locally with user-defined rules.
 */

import type {
  GuardrailRule,
  GuardrailViolation,
  OperationContext,
  ResourceProtection,
} from "./types.js";

export class AzureGuardrailsManager {
  private rules: Map<string, GuardrailRule> = new Map();
  private protections: Map<string, ResourceProtection> = new Map();

  addRule(rule: GuardrailRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  getActiveRules(): GuardrailRule[] {
    return [...this.rules.values()].filter((r) => r.enabled);
  }

  getAllRules(): GuardrailRule[] {
    return [...this.rules.values()];
  }

  validateOperation(context: OperationContext): GuardrailViolation[] {
    const violations: GuardrailViolation[] = [];
    const now = new Date();

    for (const rule of this.getActiveRules()) {
      // Check environment match
      if (rule.environments.length > 0 && !rule.environments.includes(context.environment)) {
        continue;
      }

      // Check blocked actions
      if (rule.blockedActions?.includes(context.action)) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Action "${context.action}" is blocked by rule "${rule.name}"`,
          action: context.action,
          resourceType: context.resourceType,
          resourceGroup: context.resourceGroup,
          blocked: true,
          timestamp: now.toISOString(),
        });
        continue;
      }

      // Check protected resource types
      if (rule.protectedResourceTypes?.includes(context.resourceType)) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Resource type "${context.resourceType}" is protected by rule "${rule.name}"`,
          action: context.action,
          resourceType: context.resourceType,
          resourceGroup: context.resourceGroup,
          blocked: rule.requireApproval ?? false,
          timestamp: now.toISOString(),
        });
        continue;
      }

      // Check protected resource groups
      if (rule.protectedResourceGroups?.includes(context.resourceGroup)) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Resource group "${context.resourceGroup}" is protected by rule "${rule.name}"`,
          action: context.action,
          resourceType: context.resourceType,
          resourceGroup: context.resourceGroup,
          blocked: rule.requireApproval ?? false,
          timestamp: now.toISOString(),
        });
        continue;
      }

      // Check protected tags
      if (rule.protectedTags && context.tags) {
        for (const [key, value] of Object.entries(rule.protectedTags)) {
          if (context.tags[key] === value) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.name,
              severity: rule.severity,
              message: `Resource with tag "${key}=${value}" is protected by rule "${rule.name}"`,
              action: context.action,
              resourceType: context.resourceType,
              resourceGroup: context.resourceGroup,
              blocked: rule.requireApproval ?? false,
              timestamp: now.toISOString(),
            });
          }
        }
      }

      // Check schedule
      if (rule.schedule?.activeHours) {
        const hour = now.getUTCHours();
        const startHour = parseInt(rule.schedule.activeHours.start, 10);
        const endHour = parseInt(rule.schedule.activeHours.end, 10);
        if (hour >= startHour && hour < endHour) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: `Operation blocked during active hours (${rule.schedule.activeHours.start}-${rule.schedule.activeHours.end} UTC)`,
            action: context.action,
            resourceType: context.resourceType,
            resourceGroup: context.resourceGroup,
            blocked: true,
            timestamp: now.toISOString(),
          });
        }
      }
    }

    return violations;
  }

  setProtection(protection: ResourceProtection): void {
    this.protections.set(protection.resourceId, protection);
  }

  removeProtection(resourceId: string): boolean {
    return this.protections.delete(resourceId);
  }

  checkProtection(resourceId: string): ResourceProtection | undefined {
    return this.protections.get(resourceId);
  }

  listProtections(): ResourceProtection[] {
    return [...this.protections.values()];
  }

  isOperationAllowed(context: OperationContext): boolean {
    const violations = this.validateOperation(context);
    return !violations.some((v) => v.blocked);
  }
}

export function createGuardrailsManager(): AzureGuardrailsManager {
  return new AzureGuardrailsManager();
}
