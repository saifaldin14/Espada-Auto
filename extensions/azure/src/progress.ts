/**
 * Azure Extension — Progress Reporting
 *
 * Progress reporting utilities for long-running Azure operations.
 * Mirrors the AWS progress module pattern.
 */

// =============================================================================
// Types
// =============================================================================

export type ProgressReporter = {
  /** Set the label text. */
  setLabel: (label: string) => void;
  /** Set the completion percentage (0–100). */
  setPercent: (percent: number) => void;
  /** Increment progress by one unit. */
  tick: () => void;
  /** Mark progress as complete and clean up. */
  done: () => void;
};

export type ProgressOptions = {
  /** Show on stderr (default: true). */
  stderr?: boolean;
  /** Total units for tick-based progress. */
  total?: number;
  /** Suppress output entirely. */
  silent?: boolean;
};

// =============================================================================
// Core Progress Reporter
// =============================================================================

/**
 * Create a progress reporter for Azure operations.
 */
export function createAzureProgress(label: string, options?: ProgressOptions): ProgressReporter {
  const silent = options?.silent ?? false;
  const total = options?.total ?? 100;
  const stream = options?.stderr !== false ? process.stderr : process.stdout;
  let currentLabel = label;
  let currentPercent = 0;
  let ticks = 0;
  let isDone = false;

  function render() {
    if (silent || isDone) return;
    const pct = Math.min(100, Math.round(currentPercent));
    stream.write(`\r  ${currentLabel} [${pct}%]`);
  }

  render();

  return {
    setLabel(newLabel: string) {
      currentLabel = newLabel;
      render();
    },
    setPercent(percent: number) {
      currentPercent = percent;
      render();
    },
    tick() {
      ticks++;
      currentPercent = (ticks / total) * 100;
      render();
    },
    done() {
      if (isDone) return;
      isDone = true;
      currentPercent = 100;
      if (!silent) stream.write(`\r  ${currentLabel} [100%]\n`);
    },
  };
}

// =============================================================================
// Convenience Wrappers
// =============================================================================

/**
 * Execute a function with automatic progress reporting and cleanup.
 */
export async function withAzureProgress<T>(
  label: string,
  fn: (progress: ProgressReporter) => Promise<T>,
  options?: ProgressOptions,
): Promise<T> {
  const progress = createAzureProgress(label, options);
  try {
    const result = await fn(progress);
    progress.done();
    return result;
  } catch (error) {
    progress.done();
    throw error;
  }
}

// =============================================================================
// Service-Specific Progress Factories
// =============================================================================

/** Progress reporter for ARM template deployments. */
export function createARMDeploymentProgress(deploymentName: string): ProgressReporter {
  return createAzureProgress(`Deploying ${deploymentName}`);
}

/** Progress reporter for blob uploads. */
export function createBlobUploadProgress(blobName: string, totalBytes?: number): ProgressReporter {
  return createAzureProgress(`Uploading ${blobName}`, {
    total: totalBytes ? Math.ceil(totalBytes / 1024) : 100,
  });
}

/** Progress reporter for VM state changes. */
export function createVMStateProgress(vmName: string, targetState: string): ProgressReporter {
  return createAzureProgress(`VM ${vmName} → ${targetState}`);
}

/** Progress reporter for AKS cluster operations. */
export function createAKSClusterProgress(clusterName: string, operation: string): ProgressReporter {
  return createAzureProgress(`AKS ${operation}: ${clusterName}`);
}

// =============================================================================
// Multi-Step Progress
// =============================================================================

export type MultiStepProgress = ProgressReporter & {
  /** Advance to the next step. */
  nextStep: (label: string) => void;
};

/**
 * Create a progress reporter for multi-step operations.
 */
export function createMultiStepProgress(name: string, totalSteps: number): MultiStepProgress {
  let currentStep = 0;
  const progress = createAzureProgress(`${name}: initializing`, { total: totalSteps });

  return {
    ...progress,
    nextStep(label: string) {
      currentStep++;
      progress.setLabel(`${name}: ${label} (${currentStep}/${totalSteps})`);
      progress.setPercent((currentStep / totalSteps) * 100);
    },
  };
}

// =============================================================================
// Polling Waiter
// =============================================================================

/**
 * Wait for a condition with progress reporting, polling at intervals.
 */
export async function waitWithProgress(
  label: string,
  checkFn: () => Promise<boolean>,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
    silent?: boolean;
  },
): Promise<boolean> {
  const interval = options?.intervalMs ?? 5000;
  const timeout = options?.timeoutMs ?? 300_000;
  const progress = createAzureProgress(label, { silent: options?.silent });

  const deadline = Date.now() + timeout;
  let elapsed = 0;

  while (Date.now() < deadline) {
    const done = await checkFn();
    if (done) {
      progress.done();
      return true;
    }

    elapsed += interval;
    progress.setPercent(Math.min(95, (elapsed / timeout) * 100));
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  progress.done();
  return false;
}
