/**
 * GCP Conversational Manager
 *
 * Provides a conversational interaction layer that ties together
 * intent classification, context tracking, and GCP resource
 * operations into a coherent multi-turn dialogue experience.
 */

// =============================================================================
// Types
// =============================================================================

export type MessageRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type ConversationTurn = {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  intent?: {
    category: string;
    action: string;
    confidence: number;
  };
  executedAction?: {
    service: string;
    operation: string;
    success: boolean;
    duration: number;
  };
};

export type ConversationState = "idle" | "awaiting-confirmation" | "executing" | "awaiting-input" | "error";

export type ConfirmationRequest = {
  action: string;
  description: string;
  impact: string;
  destructive: boolean;
  resourceName?: string;
};

export type Suggestion = {
  text: string;
  description: string;
  category: string;
};

export type ConversationSession = {
  id: string;
  startedAt: string;
  lastActivityAt: string;
  state: ConversationState;
  turns: ConversationTurn[];
  pendingConfirmation?: ConfirmationRequest;
  context: Record<string, unknown>;
};

export type ConversationConfig = {
  maxTurns: number;
  maxHistoryLength: number;
  confirmDestructive: boolean;
  systemPrompt?: string;
  suggestions: boolean;
  /**
   * Optional callback invoked for non-destructive messages after intent
   * classification. Return a `ConversationResponse` to override the
   * default echo reply, or `undefined` to use the default.
   */
  onExecute?: (
    content: string,
    session: ConversationSession,
  ) => ConversationResponse | Promise<ConversationResponse> | undefined | Promise<undefined>;
};

export type ConversationResponse = {
  message: string;
  state: ConversationState;
  confirmation?: ConfirmationRequest;
  suggestions?: Suggestion[];
  data?: unknown;
};

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_CONFIG: ConversationConfig = {
  maxTurns: 100,
  maxHistoryLength: 50,
  confirmDestructive: true,
  suggestions: true,
};

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { text: "List my VMs", description: "Show all Compute Engine instances", category: "compute" },
  { text: "Check my costs", description: "View current billing information", category: "billing" },
  { text: "Show security findings", description: "List Security Command Center findings", category: "security" },
  { text: "List my buckets", description: "Show all Cloud Storage buckets", category: "storage" },
  { text: "Show GKE clusters", description: "List Kubernetes Engine clusters", category: "containers" },
  { text: "Deploy to Cloud Run", description: "Deploy a container to Cloud Run", category: "serverless" },
];

const DESTRUCTIVE_ACTIONS = new Set(["delete", "remove", "destroy", "terminate", "stop", "disable"]);

// =============================================================================
// Manager
// =============================================================================

export class GcpConversationalManager {
  private config: ConversationConfig;
  private sessions: Map<string, ConversationSession> = new Map();
  private activeSessionId: string | null = null;

  constructor(config?: Partial<ConversationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  startSession(context?: Record<string, unknown>): ConversationSession {
    const session: ConversationSession = {
      id: this.generateId(),
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      state: "idle",
      turns: [],
      context: context ?? {},
    };
    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    return session;
  }

  getSession(sessionId?: string): ConversationSession | undefined {
    const id = sessionId ?? this.activeSessionId;
    return id ? this.sessions.get(id) : undefined;
  }

  getActiveSession(): ConversationSession | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  endSession(sessionId?: string): boolean {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return false;
    if (id === this.activeSessionId) this.activeSessionId = null;
    return this.sessions.delete(id);
  }

  listSessions(): ConversationSession[] {
    return Array.from(this.sessions.values());
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  processUserMessage(content: string, sessionId?: string): ConversationResponse | Promise<ConversationResponse> {
    const session = this.getSession(sessionId);
    if (!session) {
      return { message: "No active session. Start a new session first.", state: "error" };
    }

    session.lastActivityAt = new Date().toISOString();

    const userMsg: ConversationMessage = {
      id: this.generateId(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    // Handle pending confirmation
    if (session.state === "awaiting-confirmation" && session.pendingConfirmation) {
      return this.handleConfirmation(session, userMsg, content);
    }

    // Detect if destructive
    const lowerContent = content.toLowerCase();
    const isDestructive = Array.from(DESTRUCTIVE_ACTIONS).some((a) => lowerContent.includes(a));

    if (isDestructive && this.config.confirmDestructive) {
      const confirmation: ConfirmationRequest = {
        action: this.extractAction(lowerContent),
        description: `You asked to: "${content}"`,
        impact: "This action may modify or delete resources and cannot be undone.",
        destructive: true,
        resourceName: this.extractResourceName(content),
      };

      session.state = "awaiting-confirmation";
      session.pendingConfirmation = confirmation;

      const assistantMsg: ConversationMessage = {
        id: this.generateId(),
        role: "assistant",
        content: `⚠️ This is a destructive action. ${confirmation.description}\n\nPlease confirm by saying "yes" or "confirm", or "no" to cancel.`,
        timestamp: new Date().toISOString(),
      };

      session.turns.push({
        userMessage: userMsg,
        assistantMessage: assistantMsg,
      });

      this.trimHistory(session);

      return {
        message: assistantMsg.content,
        state: "awaiting-confirmation",
        confirmation,
      };
    }

    // Dispatch through onExecute callback if provided
    if (this.config.onExecute) {
      const startTime = Date.now();
      const callbackResult = this.config.onExecute(content, session);

      const finalise = (result: ConversationResponse | undefined): ConversationResponse => {
        if (result) {
          const assistantMsg: ConversationMessage = {
            id: this.generateId(),
            role: "assistant",
            content: result.message,
            timestamp: new Date().toISOString(),
          };
          session.turns.push({
            userMessage: userMsg,
            assistantMessage: assistantMsg,
            executedAction: {
              service: "dispatched",
              operation: content,
              success: result.state !== "error",
              duration: Date.now() - startTime,
            },
          });
          session.state = result.state;
          this.trimHistory(session);
          return result;
        }
        return this.buildDefaultReply(session, userMsg, content);
      };

      // Support both sync and async callbacks
      if (callbackResult && typeof (callbackResult as Promise<unknown>).then === "function") {
        return (callbackResult as Promise<ConversationResponse | undefined>).then(finalise);
      }
      return finalise(callbackResult as ConversationResponse | undefined);
    }

    // Default reply when no onExecute callback is wired
    return this.buildDefaultReply(session, userMsg, content);
  }

  private buildDefaultReply(
    session: ConversationSession,
    userMsg: ConversationMessage,
    content: string,
  ): ConversationResponse {
    const assistantMsg: ConversationMessage = {
      id: this.generateId(),
      role: "assistant",
      content: `Received: "${content}". No execution handler is configured — wire an onExecute callback to dispatch GCP operations.`,
      timestamp: new Date().toISOString(),
    };

    session.turns.push({
      userMessage: userMsg,
      assistantMessage: assistantMsg,
    });

    session.state = "idle";
    this.trimHistory(session);

    const response: ConversationResponse = {
      message: assistantMsg.content,
      state: "idle",
    };

    if (this.config.suggestions) {
      response.suggestions = this.getSuggestions(content);
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // Confirmation handling
  // ---------------------------------------------------------------------------

  private handleConfirmation(
    session: ConversationSession,
    userMsg: ConversationMessage,
    content: string,
  ): ConversationResponse {
    const lower = content.toLowerCase().trim();
    const confirmed = ["yes", "y", "confirm", "ok", "proceed", "go ahead"].includes(lower);
    const denied = ["no", "n", "cancel", "abort", "stop", "nevermind"].includes(lower);

    const pendingAction = session.pendingConfirmation!;
    session.pendingConfirmation = undefined;

    if (confirmed) {
      session.state = "executing";
      const assistantMsg: ConversationMessage = {
        id: this.generateId(),
        role: "assistant",
        content: `Confirmed. Proceeding with: ${pendingAction.action}`,
        timestamp: new Date().toISOString(),
      };
      session.turns.push({
        userMessage: userMsg,
        assistantMessage: assistantMsg,
      });
      session.state = "idle";
      return { message: assistantMsg.content, state: "idle" };
    }

    if (denied) {
      session.state = "idle";
      const assistantMsg: ConversationMessage = {
        id: this.generateId(),
        role: "assistant",
        content: "Action cancelled. What else can I help with?",
        timestamp: new Date().toISOString(),
      };
      session.turns.push({
        userMessage: userMsg,
        assistantMessage: assistantMsg,
      });
      return {
        message: assistantMsg.content,
        state: "idle",
        suggestions: this.config.suggestions ? DEFAULT_SUGGESTIONS.slice(0, 3) : undefined,
      };
    }

    // Ambiguous response
    session.state = "awaiting-confirmation";
    session.pendingConfirmation = pendingAction;
    const assistantMsg: ConversationMessage = {
      id: this.generateId(),
      role: "assistant",
      content: "I didn't understand. Please say \"yes\" to confirm or \"no\" to cancel.",
      timestamp: new Date().toISOString(),
    };
    session.turns.push({
      userMessage: userMsg,
      assistantMessage: assistantMsg,
    });
    return { message: assistantMsg.content, state: "awaiting-confirmation", confirmation: pendingAction };
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  setContext(key: string, value: unknown, sessionId?: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.context[key] = value;
    }
  }

  getContext(key: string, sessionId?: string): unknown {
    const session = this.getSession(sessionId);
    return session?.context[key];
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  getHistory(sessionId?: string, limit?: number): ConversationTurn[] {
    const session = this.getSession(sessionId);
    if (!session) return [];
    const turns = [...session.turns];
    return limit ? turns.slice(-limit) : turns;
  }

  clearHistory(sessionId?: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.turns = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Suggestions
  // ---------------------------------------------------------------------------

  getSuggestions(lastInput?: string): Suggestion[] {
    if (!lastInput) return DEFAULT_SUGGESTIONS.slice(0, 4);

    const lower = lastInput.toLowerCase();
    const contextual = DEFAULT_SUGGESTIONS.filter(
      (s) => !lower.includes(s.category),
    );
    return contextual.slice(0, 3);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  exportSession(sessionId?: string): string | undefined {
    const session = this.getSession(sessionId);
    return session ? JSON.stringify(session) : undefined;
  }

  importSession(json: string): ConversationSession {
    const session = JSON.parse(json) as ConversationSession;
    this.sessions.set(session.id, session);
    return session;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private trimHistory(session: ConversationSession): void {
    if (session.turns.length > this.config.maxHistoryLength) {
      session.turns = session.turns.slice(-this.config.maxHistoryLength);
    }
  }

  private extractAction(lowerContent: string): string {
    for (const action of DESTRUCTIVE_ACTIONS) {
      if (lowerContent.includes(action)) return action;
    }
    return "unknown";
  }

  private extractResourceName(content: string): string | undefined {
    const match = /(?:named?|called)\s+["']?(\S+)["']?/i.exec(content);
    return match?.[1];
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createConversationalManager(
  config?: Partial<ConversationConfig>,
): GcpConversationalManager {
  return new GcpConversationalManager(config);
}
