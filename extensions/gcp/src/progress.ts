/**
 * GCP Extension — Progress Reporting
 *
 * Progress reporting utilities for long-running GCP operations.
 */

// =============================================================================
// Types
// =============================================================================

export type ProgressReporter = {
  setLabel: (label: string) => void;
  setPercent: (percent: number) => void;
  tick: () => void;
  done: () => void;
};

export type ProgressOptions = {
  stderr?: boolean;
  total?: number;
  silent?: boolean;
};

// =============================================================================
// Core Progress Reporter
// =============================================================================

export function createGcpProgress(label: string, options?: ProgressOptions): ProgressReporter {
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

export async function withGcpProgress<T>(
  label: string,
  fn: (progress: ProgressReporter) => Promise<T>,
  options?: ProgressOptions,
): Promise<T> {
  const progress = createGcpProgress(label, options);
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

export function createDeploymentProgress(deploymentName: string): ProgressReporter {
  return createGcpProgress(`Deploying ${deploymentName}`);
}

export function createObjectUploadProgress(objectName: string, totalBytes?: number): ProgressReporter {
  return createGcpProgress(`Uploading ${objectName}`, {
    total: totalBytes ? Math.ceil(totalBytes / 1024) : 100,
  });
}

export function createInstanceStateProgress(instanceName: string, targetState: string): ProgressReporter {
  return createGcpProgress(`Instance ${instanceName} → ${targetState}`);
}

export function createGKEClusterProgress(clusterName: string, operation: string): ProgressReporter {
  return createGcpProgress(`GKE ${operation}: ${clusterName}`);
}

// =============================================================================
// Multi-Step Progress
// =============================================================================

export type MultiStepProgress = ProgressReporter & {
  nextStep: (label: string) => void;
};

export function createMultiStepProgress(name: string, totalSteps: number): MultiStepProgress {
  let currentStep = 0;
  const progress = createGcpProgress(`${name}: initializing`, { total: totalSteps });

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
  const progress = createGcpProgress(label, { silent: options?.silent });

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
