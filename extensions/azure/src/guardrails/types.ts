/**
 * Azure Guardrails / Governance — Type Definitions
 */

export type ActionType = "create" | "delete" | "update" | "start" | "stop" | "restart" | "scale";

export type Environment = "production" | "staging" | "development" | "testing";

export type GuardrailSeverity = "critical" | "high" | "medium" | "low";

export type GuardrailRule = {
  id: string;
  name: string;
  description: string;
  severity: GuardrailSeverity;
  enabled: boolean;
  environments: Environment[];
  blockedActions?: ActionType[];
  protectedResourceTypes?: string[];
  protectedResourceGroups?: string[];
  protectedTags?: Record<string, string>;
  requireApproval?: boolean;
  schedule?: { activeHours?: { start: string; end: string }; activeDays?: string[] };
};

export type GuardrailViolation = {
  ruleId: string;
  ruleName: string;
  severity: GuardrailSeverity;
  message: string;
  action: ActionType;
  resourceType?: string;
  resourceGroup?: string;
  blocked: boolean;
  timestamp: string;
};

export type OperationContext = {
  action: ActionType;
  resourceType: string;
  resourceGroup: string;
  environment: Environment;
  tags?: Record<string, string>;
  initiator?: string;
};

export type ResourceProtection = {
  resourceId: string;
  resourceType: string;
  resourceGroup: string;
  protectionLevel: "full" | "delete-only" | "none";
  protectedBy: string[];
};
