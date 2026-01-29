/**
 * Infrastructure Operation Status Updates
 */

import type {
  StatusUpdate,
  StatusUpdatePreferences,
  ActiveOperation,
  OperationProgress,
  OperationStep,
} from "./types.js";

export type StatusUpdateConfig = {
  defaultUpdateInterval: number;
  minUpdateInterval: number;
  maxUpdateInterval: number;
  enableProgressEstimation: boolean;
  verboseMode: boolean;
  includeTimestamps: boolean;
};

export const defaultStatusConfig: StatusUpdateConfig = {
  defaultUpdateInterval: 5000, // 5 seconds
  minUpdateInterval: 1000, // 1 second
  maxUpdateInterval: 60000, // 1 minute
  enableProgressEstimation: true,
  verboseMode: false,
  includeTimestamps: true,
};

export type StatusSubscriber = {
  id: string;
  operationId?: string;
  callback: (update: StatusUpdate) => void;
  preferences: StatusUpdatePreferences;
};

export type OperationTracking = {
  operation: ActiveOperation;
  startTime: Date;
  lastUpdate: Date;
  updateCount: number;
  subscribers: Set<string>;
  estimatedCompletion?: Date;
  progressHistory: { timestamp: Date; percent: number }[];
};

export class InfrastructureStatusUpdater {
  private config: StatusUpdateConfig;
  private trackedOperations: Map<string, OperationTracking>;
  private subscribers: Map<string, StatusSubscriber>;
  private updateTimers: Map<string, ReturnType<typeof setInterval>>;

  constructor(config?: Partial<StatusUpdateConfig>) {
    this.config = { ...defaultStatusConfig, ...config };
    this.trackedOperations = new Map();
    this.subscribers = new Map();
    this.updateTimers = new Map();
  }

  trackOperation(operation: ActiveOperation): void {
    const tracking: OperationTracking = {
      operation: {
        ...operation,
        startTime: operation.startTime ?? new Date(),
        progress: operation.progress ?? { percentComplete: 0, currentStep: 0, totalSteps: 0 },
      },
      startTime: new Date(),
      lastUpdate: new Date(),
      updateCount: 0,
      subscribers: new Set(),
      progressHistory: [{ timestamp: new Date(), percent: 0 }],
    };

    this.trackedOperations.set(operation.operationId, tracking);

    // Notify subscribers of new operation
    this.broadcastUpdate({
      operationId: operation.operationId,
      status: "started",
      message: `Operation started: ${operation.operationType}`,
      timestamp: new Date(),
      progress: tracking.operation.progress!,
      resourceId: operation.resourceId,
      operationType: operation.operationType,
    });

    // Start update timer
    this.startUpdateTimer(operation.operationId);
  }

  updateProgress(operationId: string, progress: Partial<OperationProgress>): void {
    const tracking = this.trackedOperations.get(operationId);
    if (!tracking) return;

    // Update operation progress
    tracking.operation.progress = {
      ...tracking.operation.progress!,
      ...progress,
    };
    tracking.lastUpdate = new Date();
    tracking.updateCount++;

    // Track progress history for estimation
    if (progress.percentComplete !== undefined) {
      tracking.progressHistory.push({
        timestamp: new Date(),
        percent: progress.percentComplete,
      });

      // Update estimated completion
      if (this.config.enableProgressEstimation) {
        tracking.estimatedCompletion = this.estimateCompletion(tracking);
      }
    }

    // Update step statuses if applicable
    if (progress.currentStep !== undefined && tracking.operation.steps) {
      this.updateStepStatuses(tracking.operation.steps, progress.currentStep);
    }

    // Broadcast update
    this.broadcastUpdate({
      operationId,
      status: "in-progress",
      message: this.generateProgressMessage(tracking),
      timestamp: new Date(),
      progress: tracking.operation.progress!,
      resourceId: tracking.operation.resourceId,
      operationType: tracking.operation.operationType,
      currentStep: this.getCurrentStep(tracking),
      estimatedCompletion: tracking.estimatedCompletion,
    });
  }

  completeOperation(operationId: string, status: "completed" | "failed" | "cancelled", result?: unknown): void {
    const tracking = this.trackedOperations.get(operationId);
    if (!tracking) return;

    // Stop update timer
    this.stopUpdateTimer(operationId);

    // Update operation
    tracking.operation.status = status;
    tracking.operation.endTime = new Date();
    tracking.operation.result = result;
    if (tracking.operation.progress) {
      tracking.operation.progress.percentComplete = status === "completed" ? 100 : tracking.operation.progress.percentComplete;
    }

    // Generate final message
    const message = this.generateCompletionMessage(tracking, status);

    // Broadcast final update
    this.broadcastUpdate({
      operationId,
      status,
      message,
      timestamp: new Date(),
      progress: tracking.operation.progress ?? { percentComplete: 0, currentStep: 0, totalSteps: 0 },
      resourceId: tracking.operation.resourceId,
      operationType: tracking.operation.operationType,
      result: status === "completed" ? result : undefined,
      error: status === "failed" ? result : undefined,
      duration: this.calculateDuration(tracking),
    });

    // Clean up
    this.trackedOperations.delete(operationId);
  }

  subscribe(subscriber: StatusSubscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber);

    // Register with specific operation if specified
    if (subscriber.operationId) {
      const tracking = this.trackedOperations.get(subscriber.operationId);
      if (tracking) {
        tracking.subscribers.add(subscriber.id);
      }
    }

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(subscriber.id);
      if (subscriber.operationId) {
        const tracking = this.trackedOperations.get(subscriber.operationId);
        if (tracking) {
          tracking.subscribers.delete(subscriber.id);
        }
      }
    };
  }

  private broadcastUpdate(update: StatusUpdate): void {
    for (const [, subscriber] of this.subscribers) {
      // Check if subscriber is interested in this update
      if (subscriber.operationId && subscriber.operationId !== update.operationId) {
        continue;
      }

      // Apply subscriber preferences
      const shouldSend = this.shouldSendUpdate(update, subscriber.preferences);
      if (shouldSend) {
        try {
          subscriber.callback(this.formatUpdate(update, subscriber.preferences));
        } catch {
          // Ignore callback errors
        }
      }
    }
  }

  private shouldSendUpdate(update: StatusUpdate, preferences: StatusUpdatePreferences): boolean {
    // Always send completion updates
    if (update.status === "completed" || update.status === "failed" || update.status === "cancelled") {
      return true;
    }

    // Check if this milestone is significant enough
    if (preferences.milestoneOnly) {
      const progress = update.progress.percentComplete;
      const milestones = [0, 25, 50, 75, 100];
      if (!milestones.some(m => Math.abs(progress - m) < 5)) {
        return false;
      }
    }

    return true;
  }

  private formatUpdate(update: StatusUpdate, preferences: StatusUpdatePreferences): StatusUpdate {
    const formatted = { ...update };

    // Apply verbosity settings
    if (preferences.verbosity === "minimal") {
      formatted.message = this.generateMinimalMessage(update);
    } else if (preferences.verbosity === "verbose") {
      formatted.message = this.generateVerboseMessage(update);
    }

    return formatted;
  }

  private generateMinimalMessage(update: StatusUpdate): string {
    const percent = update.progress.percentComplete;
    return `${update.operationType}: ${percent}%`;
  }

  private generateVerboseMessage(update: StatusUpdate): string {
    let message = `[${update.timestamp.toISOString()}] `;
    message += `Operation: ${update.operationType} (${update.operationId})\n`;
    message += `Status: ${update.status}\n`;
    message += `Progress: ${update.progress.percentComplete}%`;

    if (update.currentStep) {
      message += `\nCurrent Step: ${update.currentStep.name}`;
    }
    if (update.estimatedCompletion) {
      message += `\nETA: ${update.estimatedCompletion.toISOString()}`;
    }
    if (update.error) {
      message += `\nError: ${update.error}`;
    }

    return message;
  }

  private generateProgressMessage(tracking: OperationTracking): string {
    const progress = tracking.operation.progress!;
    const percent = progress.percentComplete;
    const currentStep = tracking.operation.steps?.[progress.currentStep];

    let message = `${tracking.operation.operationType}: ${percent}% complete`;

    if (currentStep) {
      message += ` - ${currentStep.name}`;
    }

    if (tracking.estimatedCompletion) {
      const remaining = this.formatTimeRemaining(tracking.estimatedCompletion);
      message += ` (${remaining} remaining)`;
    }

    return message;
  }

  private generateCompletionMessage(tracking: OperationTracking, status: string): string {
    const duration = this.formatDuration(this.calculateDuration(tracking));

    switch (status) {
      case "completed":
        return `✅ ${tracking.operation.operationType} completed successfully in ${duration}`;
      case "failed":
        return `❌ ${tracking.operation.operationType} failed after ${duration}`;
      case "cancelled":
        return `🚫 ${tracking.operation.operationType} was cancelled after ${duration}`;
      default:
        return `${tracking.operation.operationType} ${status}`;
    }
  }

  private updateStepStatuses(steps: OperationStep[], currentStep: number): void {
    for (let i = 0; i < steps.length; i++) {
      if (i < currentStep) {
        steps[i].status = "completed";
        steps[i].completedAt = steps[i].completedAt ?? new Date();
      } else if (i === currentStep) {
        steps[i].status = "in-progress";
        steps[i].startedAt = steps[i].startedAt ?? new Date();
      } else {
        steps[i].status = "pending";
      }
    }
  }

  private getCurrentStep(tracking: OperationTracking): OperationStep | undefined {
    const progress = tracking.operation.progress;
    if (!progress || !tracking.operation.steps) return undefined;
    return tracking.operation.steps[progress.currentStep];
  }

  private estimateCompletion(tracking: OperationTracking): Date | undefined {
    const history = tracking.progressHistory;
    if (history.length < 2) return undefined;

    // Calculate average progress rate
    const recent = history.slice(-5);
    if (recent.length < 2) return undefined;

    const firstPoint = recent[0];
    const lastPoint = recent[recent.length - 1];

    const timeDiff = lastPoint.timestamp.getTime() - firstPoint.timestamp.getTime();
    const progressDiff = lastPoint.percent - firstPoint.percent;

    if (progressDiff <= 0) return undefined;

    const rate = progressDiff / timeDiff; // percent per ms
    const remaining = 100 - lastPoint.percent;
    const estimatedMs = remaining / rate;

    return new Date(Date.now() + estimatedMs);
  }

  private calculateDuration(tracking: OperationTracking): number {
    const endTime = tracking.operation.endTime ?? new Date();
    return endTime.getTime() - tracking.startTime.getTime();
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  private formatTimeRemaining(estimatedCompletion: Date): string {
    const remaining = estimatedCompletion.getTime() - Date.now();
    if (remaining < 0) return "any moment";
    return this.formatDuration(remaining);
  }

  private startUpdateTimer(operationId: string): void {
    const timer = setInterval(() => {
      this.sendPeriodicUpdate(operationId);
    }, this.config.defaultUpdateInterval);

    this.updateTimers.set(operationId, timer);
  }

  private stopUpdateTimer(operationId: string): void {
    const timer = this.updateTimers.get(operationId);
    if (timer) {
      clearInterval(timer);
      this.updateTimers.delete(operationId);
    }
  }

  private sendPeriodicUpdate(operationId: string): void {
    const tracking = this.trackedOperations.get(operationId);
    if (!tracking) {
      this.stopUpdateTimer(operationId);
      return;
    }

    // Only send if there are subscribers
    if (this.subscribers.size === 0) return;

    // Generate heartbeat update
    this.broadcastUpdate({
      operationId,
      status: "in-progress",
      message: this.generateProgressMessage(tracking),
      timestamp: new Date(),
      progress: tracking.operation.progress!,
      resourceId: tracking.operation.resourceId,
      operationType: tracking.operation.operationType,
      currentStep: this.getCurrentStep(tracking),
      estimatedCompletion: tracking.estimatedCompletion,
    });
  }

  // Utility methods
  getOperationStatus(operationId: string): StatusUpdate | undefined {
    const tracking = this.trackedOperations.get(operationId);
    if (!tracking) return undefined;

    return {
      operationId,
      status: tracking.operation.status as StatusUpdate["status"],
      message: this.generateProgressMessage(tracking),
      timestamp: new Date(),
      progress: tracking.operation.progress!,
      resourceId: tracking.operation.resourceId,
      operationType: tracking.operation.operationType,
      currentStep: this.getCurrentStep(tracking),
      estimatedCompletion: tracking.estimatedCompletion,
      duration: this.calculateDuration(tracking),
    };
  }

  getAllActiveOperations(): StatusUpdate[] {
    const updates: StatusUpdate[] = [];

    for (const [operationId] of this.trackedOperations) {
      const status = this.getOperationStatus(operationId);
      if (status) updates.push(status);
    }

    return updates;
  }

  formatStatusForDisplay(update: StatusUpdate): string {
    let output = "";

    // Status icon
    const statusIcons: Record<string, string> = {
      started: "🚀",
      "in-progress": "⏳",
      completed: "✅",
      failed: "❌",
      cancelled: "🚫",
    };
    output += `${statusIcons[update.status] ?? "❓"} `;

    // Operation info
    output += `${update.operationType}`;
    if (update.resourceId) {
      output += ` on ${update.resourceId}`;
    }
    output += "\n";

    // Progress bar
    const progressBar = this.generateProgressBar(update.progress.percentComplete);
    output += `${progressBar} ${update.progress.percentComplete}%\n`;

    // Current step
    if (update.currentStep) {
      output += `📍 ${update.currentStep.name}`;
      if (update.currentStep.description) {
        output += `: ${update.currentStep.description}`;
      }
      output += "\n";
    }

    // Time info
    if (update.estimatedCompletion) {
      output += `⏱️ ETA: ${this.formatTimeRemaining(update.estimatedCompletion)}\n`;
    }
    if (update.duration) {
      output += `⌛ Duration: ${this.formatDuration(update.duration)}\n`;
    }

    // Error info
    if (update.error) {
      output += `⚠️ Error: ${update.error}\n`;
    }

    return output.trim();
  }

  private generateProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
  }

  // Cleanup
  dispose(): void {
    for (const [operationId] of this.updateTimers) {
      this.stopUpdateTimer(operationId);
    }
    this.trackedOperations.clear();
    this.subscribers.clear();
  }
}

export function createStatusUpdater(config?: Partial<StatusUpdateConfig>): InfrastructureStatusUpdater {
  return new InfrastructureStatusUpdater(config);
}

// Helper to create operation steps
export function createOperationSteps(stepNames: string[]): OperationStep[] {
  return stepNames.map((name, index) => ({
    stepNumber: index + 1,
    name,
    status: index === 0 ? "pending" : "pending",
  }));
}

// Helper to create a tracked operation
export function createTrackedOperation(
  operationType: string,
  resourceId: string,
  steps?: string[]
): ActiveOperation {
  const operationId = `op-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  return {
    operationId,
    operationType,
    resourceId,
    status: "in-progress",
    startTime: new Date(),
    steps: steps ? createOperationSteps(steps) : undefined,
    progress: {
      percentComplete: 0,
      currentStep: 0,
      totalSteps: steps?.length ?? 0,
    },
  };
}
