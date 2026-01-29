/**
 * Conversational AI Infrastructure Context Types
 */

import type { Environment, RiskLevel } from "../security/types.js";

// ============================================================================
// Conversation Models
// ============================================================================

export type MessageRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
};

export type ConversationContext = {
  sessionId: string;
  currentEnvironment: Environment;
  conversationHistory: ConversationMessage[];
  mentionedResources?: ResolvedResource[];
  recentOperations?: ActiveOperation[];
  availableResources?: { type: string; count: number; environments: Environment[] }[];
  infrastructureSnapshot?: InfrastructureStateSnapshot;
  pendingConfirmation?: ConfirmationRequest;
};

export type ConversationHistoryContext = {
  conversationHistory: ConversationMessage[];
  recentIntents: IntentCategory[];
  mentionedResources: ResolvedResource[];
};

export type SessionMetadata = {
  sessionId: string;
  userId?: string;
  startTime: Date;
  lastActivityTime: Date;
  environment: Environment;
};

// ============================================================================
// Intent Classification
// ============================================================================

export type IntentCategory =
  | "create" | "read" | "update" | "delete" | "scale"
  | "deploy" | "rollback" | "backup" | "restore" | "restart"
  | "monitor" | "diagnose" | "configure" | "migrate"
  | "list" | "describe" | "compare" | "search"
  | "help" | "cancel" | "confirm" | "clarify"
  | "unknown";

export type InfrastructureIntent = {
  category: IntentCategory;
  confidence: number;
  riskLevel?: RiskLevel;
  subIntent?: string;
  targetResourceType?: string;
  description?: string;
};

export type IntentClassificationResult = {
  intent: InfrastructureIntent;
  confidence: number;
  alternatives: InfrastructureIntent[];
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
};

// ============================================================================
// Parameter Extraction
// ============================================================================

export type ParameterType =
  | "string" | "number" | "boolean" | "array"
  | "resource-reference" | "time-duration" | "date-time"
  | "size" | "count" | "percentage" | "environment"
  | "region" | "tag" | "key-value";

export type ExtractedParameter = {
  name: string;
  value: unknown;
  type: ParameterType;
  confidence: number;
  sourceText: string;
  startIndex: number;
  endIndex: number;
  normalized: boolean;
  validationStatus: "valid" | "invalid" | "needs-clarification";
  validationMessage?: string;
};

export type ExtractedParameters = {
  parameters: ExtractedParameter[];
  missingRequired: string[];
  ambiguousParameters: AmbiguousParameter[];
  suggestedDefaults: SuggestedDefault[];
};

export type AmbiguousParameter = {
  name: string;
  possibleValues: unknown[];
  sourceText: string;
  clarificationQuestion: string;
};

export type SuggestedDefault = {
  name: string;
  suggestedValue: unknown;
  reason: string;
  confidence: number;
};

// ============================================================================
// Resource Resolution
// ============================================================================

export type ResourceReference = {
  rawText: string;
  referenceType: "name" | "id" | "arn" | "pronoun" | "contextual";
  resourceType?: string;
  confidence?: number;
};

export type ResolvedResource = {
  id: string;
  name: string;
  type: string;
  arn?: string;
  region?: string;
  environment: Environment;
  tags?: Record<string, string>;
  status?: string;
};

export type ResolutionContext = {
  environment?: Environment;
  previousResources?: ResolvedResource[];
  conversationHistory?: ConversationMessage[];
};

export type AmbiguousResource = {
  resource: ResolvedResource;
  similarity: number;
};

export type ResourceResolutionResult = {
  resolved: boolean;
  resource?: ResolvedResource;
  confidence: number;
  method: string;
  suggestions?: ResolvedResource[];
  ambiguousResources?: AmbiguousResource[];
  clarificationQuestion?: string;
};

// ============================================================================
// Infrastructure State
// ============================================================================

export type InfrastructureStateSnapshot = {
  timestamp: Date;
  resources: ResourceState[];
  activeOperations: ActiveOperation[];
  recentChanges: {
    resourceId: string;
    changeType: string;
    previousValue?: unknown;
    newValue?: unknown;
    timestamp: Date;
  }[];
  healthSummary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
  };
  alerts: {
    resourceId: string;
    severity: "low" | "medium" | "high" | "critical";
    message: string;
    timestamp: Date;
  }[];
};

export type ResourceState = {
  resourceId: string;
  name: string;
  resourceType: string;
  status: string;
  environment: Environment;
  region?: string;
  arn?: string;
  tags?: Record<string, string>;
  metrics?: ResourceMetrics;
  lastUpdated?: Date;
  previousStatus?: string;
};

export type ResourceMetrics = {
  cpuUtilization?: number;
  memoryUtilization?: number;
  storageUsed?: number;
  networkIn?: number;
  networkOut?: number;
  requestCount?: number;
  errorRate?: number;
  latencyMs?: number;
  timestamp?: Date;
  custom?: Record<string, number>;
};

// ============================================================================
// Active Operations
// ============================================================================

export type ActiveOperation = {
  operationId: string;
  operationType: string;
  resourceId: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "cancelled";
  startTime?: Date;
  endTime?: Date;
  progress?: OperationProgress;
  steps?: OperationStep[];
  result?: unknown;
  error?: unknown;
};

export type OperationProgress = {
  percentComplete: number;
  currentStep: number;
  totalSteps: number;
  currentStepDescription?: string;
  estimatedTimeRemaining?: number;
};

export type OperationStep = {
  stepNumber: number;
  name: string;
  description?: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
};

// ============================================================================
// Confirmation Workflows
// ============================================================================

export type ConfirmationRequest = {
  confirmationId: string;
  operationType: string;
  targetResources: ResolvedResource[];
  environment: Environment;
  impact: OperationImpact;
  riskLevel: RiskLevel;
  warningMessages: string[];
  confirmationPrompt: string;
  suggestedActions: string[];
  expiresAt: Date;
};

export type OperationImpact = {
  willCreate?: boolean;
  willModify?: boolean;
  willDelete?: boolean;
  requiresDowntime?: boolean;
  isReversible?: boolean;
  affectedResources: {
    id: string;
    name: string;
    type: string;
    currentState?: string;
    expectedState: string;
  }[];
  estimatedDuration?: string;
  estimatedCost?: {
    currency: string;
    monthly: number;
    oneTime?: number;
  };
  dependencies?: string[];
  cascadingEffects?: string[];
  reversalSteps?: string[];
};

export type ConfirmationResponse = {
  confirmed: boolean;
  reason?: string;
  respondedAt: Date;
  modifiedParameters?: Record<string, unknown>;
  deferredUntil?: Date;
};

// ============================================================================
// Error Handling
// ============================================================================

export type ErrorContext = {
  originalError: Error | string | unknown;
  errorCode?: string;
  resourceId?: string;
  operation?: string;
  timestamp?: Date;
  environment?: Environment;
  requestId?: string;
  suggestedRetry?: string;
};

export type SuggestedAction = {
  action: string;
  description: string;
  command?: string;
  priority?: number;
  isAutomatable: boolean;
  riskLevel: RiskLevel;
};

export type HumanizedError = {
  summary: string;
  explanation: string;
  severity?: "low" | "medium" | "high" | "critical";
  category?: string;
  errorCode?: string;
  suggestedActions: SuggestedAction[];
  technicalDetails?: string;
  originalError?: unknown;
  environmentContext?: string;
  relatedDocumentation?: { title: string; url: string }[];
};

// ============================================================================
// Status Updates
// ============================================================================

export type StatusUpdate = {
  operationId: string;
  status: "started" | "in-progress" | "completed" | "failed" | "cancelled";
  message: string;
  timestamp: Date;
  progress: OperationProgress;
  resourceId?: string;
  operationType: string;
  currentStep?: OperationStep;
  estimatedCompletion?: Date;
  result?: unknown;
  error?: unknown;
  duration?: number;
};

export type StatusUpdatePreferences = {
  verbosity: "minimal" | "normal" | "verbose";
  milestoneOnly?: boolean;
  updateIntervalMs?: number;
};
