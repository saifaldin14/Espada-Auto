/**
 * TimeoutBudget — Cascading deadline propagation for hierarchical operations.
 *
 * The codebase has a multi-tier timeout chain:
 *   Gateway (resolveAgentTimeoutMs) → Embedded Runner → Tool Calls
 *
 * Each tier currently sets its own independent `setTimeout`, with no shared
 * deadline.  `TimeoutBudget` fixes this by carrying a single absolute deadline
 * through all layers. Child budgets inherit the parent's remaining time, and
 * can optionally impose a tighter cap (e.g. per-tool timeout ≤ run remaining).
 *
 * Usage:
 *   const budget = new TimeoutBudget(60_000);          // top-level: 60 s
 *   const childBudget = budget.child(10_000);           // tool: min(10 s, remaining)
 *   const toolSignal  = childBudget.signal;             // fires on child OR parent timeout
 *   if (budget.isExpired()) throw new BudgetExhaustedError(...);
 *
 * @module
 */

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when an operation exceeds its timeout budget.
 */
export class BudgetExhaustedError extends Error {
  override readonly name = "BudgetExhaustedError";

  constructor(
    /** Label identifying the operation that exhausted its budget. */
    public readonly operationLabel: string,
    /** Total budget in milliseconds. */
    public readonly totalMs: number,
    /** Elapsed milliseconds when the budget was exhausted. */
    public readonly elapsedMs: number,
  ) {
    super(
      `Timeout budget exhausted for "${operationLabel}": ` +
        `${elapsedMs}ms elapsed of ${totalMs}ms budget`,
    );
  }
}

// =============================================================================
// TimeoutBudget
// =============================================================================

export class TimeoutBudget {
  /** Absolute epoch time (ms) when this budget expires. */
  readonly deadlineMs: number;

  /** Original budget duration in ms. */
  readonly totalMs: number;

  /** Monotonic start time (for elapsed computation). */
  private readonly startMs: number;

  /** AbortController whose signal fires at the deadline. */
  private readonly ac: AbortController;

  /** Timer handle; cleared on explicit dispose. */
  private timerId: ReturnType<typeof setTimeout> | undefined;

  /** Whether this budget has been disposed. */
  private disposed = false;

  /**
   * Create a new top-level budget.
   *
   * @param totalMs   Budget duration in milliseconds.
   * @param options   Optional parent signal and label.
   */
  constructor(
    totalMs: number,
    options?: {
      /** Label used in error messages. */
      label?: string;
      /** Optional parent signal — if the parent aborts, so does this budget. */
      parentSignal?: AbortSignal;
      /**
       * Absolute deadline override.  When provided, `totalMs` is still recorded
       * but the timer is set based on `deadlineMs`.  Used internally by `child()`.
       */
      deadlineMs?: number;
    },
  ) {
    this.totalMs = totalMs;
    this.startMs = Date.now();
    this.deadlineMs = options?.deadlineMs ?? this.startMs + totalMs;

    this.ac = new AbortController();

    // If the parent signal already aborted, immediately abort.
    if (options?.parentSignal?.aborted) {
      this.ac.abort(options.parentSignal.reason);
      return;
    }

    // Forward parent abort → this budget.
    if (options?.parentSignal) {
      const onParentAbort = () => {
        if (!this.ac.signal.aborted) {
          this.ac.abort(options.parentSignal!.reason);
        }
        this.clearTimer();
      };
      options.parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    // Schedule our own timeout.
    const delay = Math.max(0, this.deadlineMs - Date.now());
    this.timerId = setTimeout(() => {
      if (!this.ac.signal.aborted) {
        this.ac.abort(
          new BudgetExhaustedError(
            options?.label ?? "timeout-budget",
            totalMs,
            Date.now() - this.startMs,
          ),
        );
      }
    }, delay);

    // Don't hold the event loop open for this timer.
    if (typeof this.timerId === "object" && "unref" in this.timerId) {
      this.timerId.unref();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Milliseconds remaining until the deadline.
   * Returns `0` when the budget is expired.
   */
  remainingMs(): number {
    return Math.max(0, this.deadlineMs - Date.now());
  }

  /**
   * Whether the budget has expired (deadline has passed or signal was aborted).
   */
  isExpired(): boolean {
    return this.remainingMs() === 0 || this.ac.signal.aborted;
  }

  /**
   * Elapsed milliseconds since budget creation.
   */
  elapsedMs(): number {
    return Date.now() - this.startMs;
  }

  /**
   * AbortSignal that fires when the budget expires **or** when the parent
   * signal aborts — whichever comes first.
   */
  get signal(): AbortSignal {
    return this.ac.signal;
  }

  /**
   * Derive a child budget.
   *
   * The child's deadline is `min(this.remainingMs(), maxMs)`, ensuring that
   * a child can never outlive its parent.
   *
   * @param maxMs   Maximum duration for the child.  If omitted, the child
   *                inherits the parent's full remaining time.
   * @param label   Label for error messages.
   * @returns       A new `TimeoutBudget` linked to this parent.
   */
  child(maxMs?: number, label?: string): TimeoutBudget {
    const remaining = this.remainingMs();
    const childDuration = maxMs !== undefined ? Math.min(maxMs, remaining) : remaining;
    const childDeadline = Date.now() + childDuration;

    return new TimeoutBudget(childDuration, {
      label,
      parentSignal: this.ac.signal,
      deadlineMs: childDeadline,
    });
  }

  /**
   * Execute a function within this budget.
   *
   * If the budget expires before `fn` resolves, the returned promise rejects
   * with `BudgetExhaustedError`.  The budget's `signal` can be passed to `fn`
   * for cooperative cancellation.
   *
   * @param fn      Function to execute.
   * @param label   Operation label for error messages.
   */
  async execute<T>(fn: (signal: AbortSignal) => Promise<T>, label?: string): Promise<T> {
    if (this.isExpired()) {
      throw new BudgetExhaustedError(label ?? "timeout-budget", this.totalMs, this.elapsedMs());
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const onAbort = () => {
        if (!settled) {
          settled = true;
          const reason = this.ac.signal.reason;
          reject(
            reason instanceof BudgetExhaustedError
              ? reason
              : new BudgetExhaustedError(label ?? "timeout-budget", this.totalMs, this.elapsedMs()),
          );
        }
      };

      // If signal already aborted (race), reject immediately.
      if (this.ac.signal.aborted) {
        onAbort();
        return;
      }

      this.ac.signal.addEventListener("abort", onAbort, { once: true });

      fn(this.ac.signal).then(
        (result) => {
          if (!settled) {
            settled = true;
            this.ac.signal.removeEventListener("abort", onAbort);
            resolve(result);
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            this.ac.signal.removeEventListener("abort", onAbort);
            reject(err);
          }
        },
      );
    });
  }

  /**
   * Dispose the budget, clearing its internal timer.
   * Safe to call multiple times.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.clearTimer();
    }
  }

  /** @internal */
  private clearTimer(): void {
    if (this.timerId !== undefined) {
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }
}

// =============================================================================
// Helper: create a budget from resolveAgentTimeoutMs output
// =============================================================================

/**
 * Convenience factory: create a `TimeoutBudget` from values produced by
 * `resolveAgentTimeoutMs`.
 *
 * @param timeoutMs   Overall timeout in ms (from `resolveAgentTimeoutMs`).
 * @param parentSignal  Optional parent abort signal (e.g. from gateway RPC).
 * @param label        Budget label for error messages.
 */
export function createRunBudget(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  label = "run",
): TimeoutBudget {
  return new TimeoutBudget(timeoutMs, { label, parentSignal });
}
