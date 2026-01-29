/**
 * Conversational AI Infrastructure Context - Main Module
 */

// Re-export all types
export type {
  // Conversation models
  ConversationMessage,
  ConversationContext,
  SessionMetadata,
  MessageRole,
  ConversationHistoryContext,
  
  // Intent classification
  IntentCategory,
  InfrastructureIntent,
  IntentClassificationResult,
  
  // Parameter extraction
  ExtractedParameter,
  ExtractedParameters,
  ParameterType,
  AmbiguousParameter,
  SuggestedDefault,
  
  // Resource resolution
  ResourceReference,
  ResolvedResource,
  ResourceResolutionResult,
  AmbiguousResource,
  ResolutionContext,
  
  // State awareness
  InfrastructureStateSnapshot,
  ResourceState,
  ResourceMetrics,
  ActiveOperation,
  OperationProgress,
  OperationStep,
  
  // Confirmation workflows
  ConfirmationRequest,
  ConfirmationResponse,
  OperationImpact,
  
  // Error handling
  ErrorContext,
  HumanizedError,
  SuggestedAction,
  
  // Status updates
  StatusUpdate,
  StatusUpdatePreferences,
} from "./types.js";

// Re-export intent classifier
export {
  InfrastructureIntentClassifier,
  createIntentClassifier,
  classifyIntent,
  type IntentClassifierConfig,
  type IntentPattern,
} from "./intent-classifier.js";

// Re-export parameter extractor
export {
  InfrastructureParameterExtractor,
  createParameterExtractor,
  extractParameters,
  type ParameterExtractionConfig,
  type ParameterPattern,
} from "./parameter-extractor.js";

// Re-export resource resolver
export {
  InfrastructureResourceResolver,
  createResourceResolver,
  resolveResource,
  type ResourceResolverConfig,
  type ResourcePattern,
} from "./resource-resolver.js";

// Re-export state context
export {
  InfrastructureStateProvider,
  createStateProvider,
  type StateProviderConfig,
  type ResourceStateFilter,
  type StateSubscriber,
  type MetricAggregation,
  type MetricQuery,
} from "./state-context.js";

// Re-export confirmation workflow
export {
  InfrastructureConfirmationWorkflow,
  createConfirmationWorkflow,
  needsConfirmation,
  analyzeOperationImpact,
  type ConfirmationConfig,
  type PendingConfirmation,
  type ConfirmationHandler,
} from "./confirmation-workflow.js";

// Re-export error humanizer
export {
  InfrastructureErrorHumanizer,
  createErrorHumanizer,
  humanizeError,
  formatError,
  type ErrorHumanizerConfig,
  type ErrorPattern,
} from "./error-humanizer.js";

// Re-export status updater
export {
  InfrastructureStatusUpdater,
  createStatusUpdater,
  createOperationSteps,
  createTrackedOperation,
  type StatusUpdateConfig,
  type StatusSubscriber as StatusUpdateSubscriber,
  type OperationTracking,
} from "./status-updater.js";

import type {
  ConversationMessage,
  ConversationContext,
  InfrastructureIntent,
  ExtractedParameters,
  ResolvedResource,
  InfrastructureStateSnapshot,
  ConfirmationRequest,
  HumanizedError,
  StatusUpdate,
  ResourceReference,
  ErrorContext,
  ActiveOperation,
  OperationProgress,
  IntentClassificationResult,
} from "./types.js";
import { InfrastructureIntentClassifier, type IntentClassifierConfig } from "./intent-classifier.js";
import { InfrastructureParameterExtractor, type ParameterExtractionConfig } from "./parameter-extractor.js";
import { InfrastructureResourceResolver, type ResourceResolverConfig } from "./resource-resolver.js";
import { InfrastructureStateProvider, type StateProviderConfig } from "./state-context.js";
import { InfrastructureConfirmationWorkflow, type ConfirmationConfig } from "./confirmation-workflow.js";
import { InfrastructureErrorHumanizer, type ErrorHumanizerConfig } from "./error-humanizer.js";
import { InfrastructureStatusUpdater, type StatusUpdateConfig } from "./status-updater.js";
import type { Environment } from "../security/types.js";

/**
 * Configuration for the conversation manager
 */
export type ConversationManagerConfig = {
  intentClassifier?: Partial<IntentClassifierConfig>;
  parameterExtractor?: Partial<ParameterExtractionConfig>;
  resourceResolver?: Partial<ResourceResolverConfig>;
  stateProvider?: Partial<StateProviderConfig>;
  confirmation?: Partial<ConfirmationConfig>;
  errorHumanizer?: Partial<ErrorHumanizerConfig>;
  statusUpdater?: Partial<StatusUpdateConfig>;
  defaultEnvironment: Environment;
};

export const defaultConversationConfig: ConversationManagerConfig = {
  defaultEnvironment: "development",
};

/**
 * Result from processing a user message
 */
export type ProcessedMessage = {
  intent: InfrastructureIntent;
  parameters: ExtractedParameters;
  resources: ResolvedResource[];
  requiresConfirmation: boolean;
  confirmationRequest?: ConfirmationRequest;
  ambiguities: {
    type: "intent" | "parameter" | "resource";
    message: string;
  }[];
  suggestedResponse?: string;
};

/**
 * Main conversation manager that orchestrates all components
 */
export class InfrastructureConversationManager {
  private config: ConversationManagerConfig;
  private intentClassifier: InfrastructureIntentClassifier;
  private parameterExtractor: InfrastructureParameterExtractor;
  private resourceResolver: InfrastructureResourceResolver;
  private stateProvider: InfrastructureStateProvider;
  private confirmationWorkflow: InfrastructureConfirmationWorkflow;
  private errorHumanizer: InfrastructureErrorHumanizer;
  private statusUpdater: InfrastructureStatusUpdater;
  private conversationHistory: ConversationMessage[];
  private currentContext: ConversationContext;

  constructor(config?: Partial<ConversationManagerConfig>) {
    this.config = { ...defaultConversationConfig, ...config };

    // Initialize all components
    this.intentClassifier = new InfrastructureIntentClassifier(this.config.intentClassifier);
    this.parameterExtractor = new InfrastructureParameterExtractor(this.config.parameterExtractor);
    this.resourceResolver = new InfrastructureResourceResolver(this.config.resourceResolver);
    this.stateProvider = new InfrastructureStateProvider(this.config.stateProvider);
    this.confirmationWorkflow = new InfrastructureConfirmationWorkflow(this.config.confirmation);
    this.errorHumanizer = new InfrastructureErrorHumanizer(this.config.errorHumanizer);
    this.statusUpdater = new InfrastructureStatusUpdater(this.config.statusUpdater);

    this.conversationHistory = [];
    this.currentContext = this.createInitialContext();
  }

  /**
   * Process a user message and return structured understanding
   */
  async processMessage(message: string, environment?: Environment): Promise<ProcessedMessage> {
    const env = environment ?? this.config.defaultEnvironment;

    // Add message to history
    const userMessage: ConversationMessage = {
      id: this.generateMessageId(),
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    this.conversationHistory.push(userMessage);

    // Update context
    this.currentContext = this.stateProvider.enrichConversationContext({
      ...this.currentContext,
      currentEnvironment: env,
      conversationHistory: this.conversationHistory.slice(-10),
    });

    // Classify intent
    const intentResult = this.intentClassifier.classify(message, this.currentContext);
    const intent = intentResult.intent;

    // Extract parameters
    const parameters = this.parameterExtractor.extract(message, intent.category);

    // Resolve resources
    const resources = await this.resolveResourceReferences(message, parameters);

    // Track ambiguities
    const ambiguities = this.collectAmbiguities(intentResult, parameters);

    // Check if confirmation is needed
    const requiresConfirmation = this.confirmationWorkflow.needsConfirmation(intent, env);
    let confirmationRequest: ConfirmationRequest | undefined;

    if (requiresConfirmation && resources.length > 0) {
      const maybeRequest = await this.confirmationWorkflow.requestConfirmation(intent, resources, env);
      confirmationRequest = maybeRequest ?? undefined;
      if (confirmationRequest) {
        // Store in context
        this.currentContext.pendingConfirmation = confirmationRequest;
      }
    }

    // Generate suggested response if there are ambiguities
    const suggestedResponse = ambiguities.length > 0
      ? this.generateClarificationResponse(ambiguities)
      : undefined;

    // Update context with resolved resources
    this.currentContext.mentionedResources = [
      ...(this.currentContext.mentionedResources ?? []),
      ...resources,
    ].slice(-10);

    return {
      intent,
      parameters,
      resources,
      requiresConfirmation: confirmationRequest !== undefined,
      confirmationRequest: confirmationRequest ?? undefined,
      ambiguities,
      suggestedResponse,
    };
  }

  /**
   * Handle a confirmation response
   */
  async handleConfirmation(confirmationId: string, confirmed: boolean, reason?: string): Promise<{
    approved: boolean;
    canProceed: boolean;
    message: string;
  }> {
    const result = await this.confirmationWorkflow.processConfirmation(confirmationId, {
      confirmed,
      reason,
      respondedAt: new Date(),
    });

    // Clear pending confirmation from context
    if (this.currentContext.pendingConfirmation?.confirmationId === confirmationId) {
      this.currentContext.pendingConfirmation = undefined;
    }

    return {
      approved: result.approved,
      canProceed: result.canProceed,
      message: result.reason ?? (result.approved ? "Operation approved" : "Operation declined"),
    };
  }

  /**
   * Humanize an error for user display
   */
  humanizeError(error: Error | unknown, context?: Partial<ErrorContext>): HumanizedError {
    const errorContext: ErrorContext = {
      originalError: error,
      timestamp: new Date(),
      environment: this.config.defaultEnvironment,
      ...context,
    };

    return this.errorHumanizer.humanize(errorContext);
  }

  /**
   * Format an error for display
   */
  formatError(error: Error | unknown, context?: Partial<ErrorContext>): string {
    const humanized = this.humanizeError(error, context);
    return this.errorHumanizer.formatForDisplay(humanized);
  }

  /**
   * Track an operation and get status updates
   */
  trackOperation(operation: ActiveOperation): void {
    this.statusUpdater.trackOperation(operation);
  }

  /**
   * Update operation progress
   */
  updateOperationProgress(operationId: string, progress: Partial<OperationProgress>): void {
    this.statusUpdater.updateProgress(operationId, progress);
  }

  /**
   * Complete an operation
   */
  completeOperation(operationId: string, status: "completed" | "failed" | "cancelled", result?: unknown): void {
    this.statusUpdater.completeOperation(operationId, status, result);
  }

  /**
   * Subscribe to status updates
   */
  subscribeToStatusUpdates(callback: (update: StatusUpdate) => void): () => void {
    return this.statusUpdater.subscribe({
      id: this.generateMessageId(),
      callback,
      preferences: { verbosity: "normal" },
    });
  }

  /**
   * Get current operation statuses
   */
  getActiveOperations(): StatusUpdate[] {
    return this.statusUpdater.getAllActiveOperations();
  }

  /**
   * Get infrastructure state snapshot
   */
  getStateSnapshot(): InfrastructureStateSnapshot {
    return this.stateProvider.getSnapshot();
  }

  /**
   * Get conversation context
   */
  getContext(): ConversationContext {
    return this.currentContext;
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.currentContext = this.createInitialContext();
  }

  // Private helpers
  private createInitialContext(): ConversationContext {
    return {
      sessionId: this.generateSessionId(),
      currentEnvironment: this.config.defaultEnvironment,
      conversationHistory: [],
      mentionedResources: [],
    };
  }

  private async resolveResourceReferences(_message: string, parameters: ExtractedParameters): Promise<ResolvedResource[]> {
    const resources: ResolvedResource[] = [];

    // Extract resource references from parameters
    const resourceParams = parameters.parameters.filter(p =>
      p.name === "resourceName" || p.name === "resourceId"
    );

    for (const param of resourceParams) {
      const reference: ResourceReference = {
        rawText: String(param.value),
        referenceType: param.name === "resourceId" ? "id" : "name",
      };

      const result = this.resourceResolver.resolve(reference, {
        environment: this.currentContext.currentEnvironment,
        previousResources: this.currentContext.mentionedResources,
      });

      if (result.resolved && result.resource) {
        resources.push(result.resource);
      }
    }

    return resources;
  }

  private collectAmbiguities(
    intentResult: IntentClassificationResult,
    parameters: ExtractedParameters
  ): { type: "intent" | "parameter" | "resource"; message: string }[] {
    const ambiguities: { type: "intent" | "parameter" | "resource"; message: string }[] = [];

    // Intent ambiguities
    if (intentResult.clarificationNeeded && intentResult.clarificationQuestion) {
      ambiguities.push({
        type: "intent",
        message: intentResult.clarificationQuestion,
      });
    }

    // Parameter ambiguities
    for (const ambiguous of parameters.ambiguousParameters) {
      ambiguities.push({
        type: "parameter",
        message: ambiguous.clarificationQuestion,
      });
    }

    // Missing required parameters
    if (parameters.missingRequired.length > 0) {
      ambiguities.push({
        type: "parameter",
        message: `Missing required parameters: ${parameters.missingRequired.join(", ")}`,
      });
    }

    return ambiguities;
  }

  private generateClarificationResponse(ambiguities: { type: string; message: string }[]): string {
    if (ambiguities.length === 1) {
      return ambiguities[0].message;
    }

    return "I need some clarification:\n" + ambiguities.map((a, i) => `${i + 1}. ${a.message}`).join("\n");
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.stateProvider.dispose();
    this.statusUpdater.dispose();
  }
}

/**
 * Create a new conversation manager
 */
export function createConversationManager(config?: Partial<ConversationManagerConfig>): InfrastructureConversationManager {
  return new InfrastructureConversationManager(config);
}
