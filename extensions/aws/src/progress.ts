/**
 * AWS Progress Utilities
 *
 * Wrappers for long-running AWS operations with progress reporting.
 * Provides spinners and progress bars for CloudFormation, S3 uploads, EC2 transitions, etc.
 *
 * This module is self-contained to avoid tsconfig rootDir issues.
 */

/**
 * Progress reporter interface
 */
export type ProgressReporter = {
  setLabel: (label: string) => void;
  setPercent: (percent: number) => void;
  tick: (delta?: number) => void;
  done: () => void;
};

/**
 * Progress options for AWS operations
 */
export type AWSProgressOptions = {
  label: string;
  enabled?: boolean;
  total?: number;
  indeterminate?: boolean;
};

/**
 * No-op progress reporter for when progress is disabled
 */
const noopReporter: ProgressReporter = {
  setLabel: () => {},
  setPercent: () => {},
  tick: () => {},
  done: () => {},
};

/**
 * Simple console-based progress reporter
 */
function createSimpleProgress(options: AWSProgressOptions): ProgressReporter {
  if (options.enabled === false) return noopReporter;

  let label = options.label;
  let percent = 0;
  let done = false;

  const render = () => {
    if (done) return;
    const suffix = options.indeterminate ? "..." : ` ${Math.round(percent)}%`;
    process.stderr.write(`\r${label}${suffix}  `);
  };

  render();

  return {
    setLabel: (newLabel: string) => {
      label = newLabel;
      render();
    },
    setPercent: (newPercent: number) => {
      percent = newPercent;
      render();
    },
    tick: (delta = 1) => {
      if (options.total) {
        percent = Math.min(100, percent + (delta / options.total) * 100);
        render();
      }
    },
    done: () => {
      done = true;
      process.stderr.write("\r" + " ".repeat(label.length + 20) + "\r");
    },
  };
}

/**
 * Create a progress reporter for an AWS operation
 */
export function createAWSProgress(options: AWSProgressOptions): ProgressReporter {
  return createSimpleProgress({
    ...options,
    indeterminate: options.indeterminate ?? true,
  });
}

/**
 * Execute an AWS operation with progress reporting
 *
 * @example
 * ```typescript
 * const result = await withAWSProgress(
 *   "Deploying CloudFormation stack",
 *   async (progress) => {
 *     progress.setLabel("Creating resources...");
 *     // ... do work
 *     progress.setLabel("Waiting for completion...");
 *     // ... wait
 *     return result;
 *   }
 * );
 * ```
 */
export async function withAWSProgress<T>(
  label: string,
  fn: (progress: ProgressReporter) => Promise<T>,
  options?: Omit<AWSProgressOptions, "label">,
): Promise<T> {
  const progress = createAWSProgress({ label, ...options });
  try {
    return await fn(progress);
  } finally {
    progress.done();
  }
}

/**
 * Progress reporter for CloudFormation stack operations
 */
export function createCloudFormationProgress(stackName: string): ProgressReporter {
  return createAWSProgress({
    label: `CloudFormation: ${stackName}`,
  });
}

/**
 * Progress reporter for S3 upload operations
 */
export function createS3UploadProgress(bucketName: string, keyOrCount: string | number): ProgressReporter {
  const label = typeof keyOrCount === "number"
    ? `Uploading ${keyOrCount} objects to s3://${bucketName}`
    : `Uploading to s3://${bucketName}/${keyOrCount}`;

  return createAWSProgress({
    label,
    indeterminate: typeof keyOrCount === "string",
    total: typeof keyOrCount === "number" ? keyOrCount : undefined,
  });
}

/**
 * Progress reporter for S3 download operations
 */
export function createS3DownloadProgress(bucketName: string, keyOrCount: string | number): ProgressReporter {
  const label = typeof keyOrCount === "number"
    ? `Downloading ${keyOrCount} objects from s3://${bucketName}`
    : `Downloading from s3://${bucketName}/${keyOrCount}`;

  return createAWSProgress({
    label,
    indeterminate: typeof keyOrCount === "string",
    total: typeof keyOrCount === "number" ? keyOrCount : undefined,
  });
}

/**
 * Progress reporter for EC2 instance state transitions
 */
export function createEC2StateProgress(instanceId: string, targetState: string): ProgressReporter {
  return createAWSProgress({
    label: `EC2 ${instanceId}: transitioning to ${targetState}`,
  });
}

/**
 * Progress reporter for Lambda deployment
 */
export function createLambdaDeployProgress(functionName: string): ProgressReporter {
  return createAWSProgress({
    label: `Deploying Lambda: ${functionName}`,
  });
}

/**
 * Progress reporter for RDS instance operations
 */
export function createRDSProgress(instanceId: string, operation: string): ProgressReporter {
  return createAWSProgress({
    label: `RDS ${instanceId}: ${operation}`,
  });
}

/**
 * Progress reporter for ECS/EKS deployment
 */
export function createContainerDeployProgress(
  service: string,
  cluster: string,
): ProgressReporter {
  return createAWSProgress({
    label: `Deploying ${service} to ${cluster}`,
  });
}

/**
 * Progress reporter for multi-step AWS operations
 */
export function createMultiStepProgress(
  operationName: string,
  totalSteps: number,
): ProgressReporter & { nextStep: (label: string) => void } {
  let currentStep = 0;

  const progress = createAWSProgress({
    label: `${operationName}: Step 0/${totalSteps}`,
    indeterminate: false,
    total: totalSteps,
  });

  return {
    ...progress,
    nextStep(stepLabel: string) {
      currentStep += 1;
      progress.setLabel(`${operationName}: ${stepLabel} (${currentStep}/${totalSteps})`);
      progress.setPercent((currentStep / totalSteps) * 100);
    },
  };
}

/**
 * Wait for an AWS resource with progress reporting
 *
 * @example
 * ```typescript
 * await waitWithProgress(
 *   "Waiting for instance to start",
 *   async () => {
 *     const result = await ec2.describeInstances({ InstanceIds: [instanceId] });
 *     return result.Reservations?.[0]?.Instances?.[0]?.State?.Name === "running";
 *   },
 *   { pollIntervalMs: 5000, maxWaitMs: 300000 }
 * );
 * ```
 */
export async function waitWithProgress(
  label: string,
  checkFn: () => Promise<boolean>,
  options?: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    enabled?: boolean;
  },
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? 5000;
  const maxWaitMs = options?.maxWaitMs ?? 300000;
  const startTime = Date.now();

  const progress = createAWSProgress({ label, enabled: options?.enabled });

  try {
    while (Date.now() - startTime < maxWaitMs) {
      if (await checkFn()) {
        return;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      progress.setLabel(`${label} (${elapsed}s)`);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Timed out after ${maxWaitMs / 1000}s: ${label}`);
  } finally {
    progress.done();
  }
}
