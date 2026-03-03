/**
 * Bulkhead — Concurrency isolation for different workload types.
 *
 * Prevents one category of operations (e.g. slow LLM calls) from exhausting
 * all available capacity and starving other operations (e.g. fast cloud API
 * calls or internal commands).
 *
 * Implementation: Promise-based counting semaphore on the main event loop.
 * No worker threads are used — everything runs cooperatively on a single
 * thread, so the semaphore guarantees at most `maxConcurrency` promises are
 * executing for each bulkhead partition.
 *
 * Usage:
 *   const llmBulkhead = new Bulkhead("llm", { maxConcurrency: 8 });
 *   const result = await llmBulkhead.execute(() => callLLM(prompt));
 *
 *   // Or with a queue limit:
 *   const apiBulkhead = new Bulkhead("cloud-api", { maxConcurrency: 20, maxQueue: 100 });
 *
 * @module
 */

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when the bulkhead's queue is full and cannot accept more work.
 */
export class BulkheadRejectedError extends Error {
  override readonly name = "BulkheadRejectedError";

  constructor(
    /** Bulkhead partition name. */
    public readonly partition: string,
    /** Maximum queue size. */
    public readonly maxQueue: number,
    /** Current active count at rejection time. */
    public readonly activeCount: number,
  ) {
    super(
      `Bulkhead "${partition}" rejected: queue full ` +
        `(maxQueue=${maxQueue}, active=${activeCount})`,
    );
  }
}

// =============================================================================
// Types
// =============================================================================

export type BulkheadConfig = {
  /**
   * Maximum concurrent operations allowed.
   * Once this limit is reached, additional calls are queued.
   * @default 10
   */
  maxConcurrency?: number;

  /**
   * Maximum number of pending operations in the queue.
   * When the queue is full, new calls are immediately rejected with
   * `BulkheadRejectedError`.
   * Set to `0` for unlimited queue (not recommended for production).
   * @default 100
   */
  maxQueue?: number;

  /**
   * Maximum time (ms) an operation can wait in the queue before being rejected.
   * Set to `0` for no queue timeout.
   * @default 0  (no queue timeout)
   */
  queueTimeoutMs?: number;
};

export type BulkheadSnapshot = {
  /** Bulkhead partition name. */
  name: string;
  /** Maximum concurrent operations. */
  maxConcurrency: number;
  /** Maximum queue depth. */
  maxQueue: number;
  /** Currently executing operations. */
  activeCount: number;
  /** Currently queued (waiting) operations. */
  queuedCount: number;
  /** Total operations completed since creation. */
  completedCount: number;
  /** Total operations rejected since creation. */
  rejectedCount: number;
};

// =============================================================================
// Bulkhead
// =============================================================================

type QueueEntry = {
  resolve: () => void;
  reject: (reason: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class Bulkhead {
  readonly name: string;
  private readonly maxConcurrency: number;
  private readonly maxQueue: number;
  private readonly queueTimeoutMs: number;

  private activeCount = 0;
  private completedCount = 0;
  private rejectedCount = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(name: string, config?: BulkheadConfig) {
    this.name = name;
    this.maxConcurrency = Math.max(1, config?.maxConcurrency ?? 10);
    this.maxQueue = Math.max(0, config?.maxQueue ?? 100);
    this.queueTimeoutMs = Math.max(0, config?.queueTimeoutMs ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Execute a function within this bulkhead.
   *
   * - If capacity is available, starts immediately.
   * - If at max concurrency, queues the call.
   * - If the queue is full, rejects with `BulkheadRejectedError`.
   *
   * @param fn      The (sync or async) operation to execute.
   * @param signal  Optional abort signal to cancel queued operations.
   * @returns       The result of `fn`.
   */
  async execute<T>(fn: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      this.rejectedCount++;
      throw new BulkheadRejectedError(this.name, this.maxQueue, this.activeCount);
    }

    // Fast path: capacity available → run immediately.
    if (this.activeCount < this.maxConcurrency) {
      return this.run(fn);
    }

    // Check queue limit.
    if (this.maxQueue > 0 && this.queue.length >= this.maxQueue) {
      this.rejectedCount++;
      throw new BulkheadRejectedError(this.name, this.maxQueue, this.activeCount);
    }

    // Wait for a slot.
    await this.enqueue(signal);

    return this.run(fn);
  }

  /**
   * Current snapshot of this bulkhead's state.
   */
  snapshot(): BulkheadSnapshot {
    return {
      name: this.name,
      maxConcurrency: this.maxConcurrency,
      maxQueue: this.maxQueue,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      completedCount: this.completedCount,
      rejectedCount: this.rejectedCount,
    };
  }

  /**
   * Number of currently executing operations.
   */
  get active(): number {
    return this.activeCount;
  }

  /**
   * Number of currently queued operations.
   */
  get queued(): number {
    return this.queue.length;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async run<T>(fn: () => T | Promise<T>): Promise<T> {
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      this.completedCount++;
      this.dequeue();
    }
  }

  private enqueue(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject };

      // Optional queue timeout.
      if (this.queueTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.removeFromQueue(entry);
          this.rejectedCount++;
          reject(new BulkheadRejectedError(this.name, this.maxQueue, this.activeCount));
        }, this.queueTimeoutMs);
      }

      // Abort signal cancellation.
      if (signal) {
        const onAbort = () => {
          this.removeFromQueue(entry);
          if (entry.timer) clearTimeout(entry.timer);
          this.rejectedCount++;
          reject(new BulkheadRejectedError(this.name, this.maxQueue, this.activeCount));
        };
        if (signal.aborted) {
          this.rejectedCount++;
          reject(new BulkheadRejectedError(this.name, this.maxQueue, this.activeCount));
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.queue.push(entry);
    });
  }

  private dequeue(): void {
    if (this.queue.length === 0) return;
    const next = this.queue.shift()!;
    if (next.timer) clearTimeout(next.timer);
    next.resolve();
  }

  private removeFromQueue(entry: QueueEntry): void {
    const idx = this.queue.indexOf(entry);
    if (idx !== -1) this.queue.splice(idx, 1);
  }
}

// =============================================================================
// BulkheadRegistry — Named partitions
// =============================================================================

/**
 * Registry of named bulkhead partitions.
 *
 * Pre-defined partitions isolate different workload types:
 * - `llm`       — LLM provider calls (chat completions, embeddings)
 * - `cloud-api` — Cloud provider API calls (AWS, Azure, GCP)
 * - `tools`     — Agent tool executions
 * - `internal`  — Internal operations (session I/O, diagnostics)
 *
 * Custom partitions can be created on the fly via `get()`.
 */
export class BulkheadRegistry {
  private readonly partitions = new Map<string, Bulkhead>();
  private readonly defaults: Required<BulkheadConfig>;

  constructor(defaults?: BulkheadConfig) {
    this.defaults = {
      maxConcurrency: defaults?.maxConcurrency ?? 10,
      maxQueue: defaults?.maxQueue ?? 100,
      queueTimeoutMs: defaults?.queueTimeoutMs ?? 0,
    };
  }

  /**
   * Get or create a named bulkhead partition.
   */
  get(name: string, config?: BulkheadConfig): Bulkhead {
    let bh = this.partitions.get(name);
    if (!bh) {
      bh = new Bulkhead(name, config ?? this.defaults);
      this.partitions.set(name, bh);
    }
    return bh;
  }

  /**
   * Check if a named partition exists.
   */
  has(name: string): boolean {
    return this.partitions.has(name);
  }

  /**
   * Remove a named partition (cancels no in-flight work).
   */
  delete(name: string): boolean {
    return this.partitions.delete(name);
  }

  /**
   * Snapshot of all partitions.
   */
  snapshots(): BulkheadSnapshot[] {
    return Array.from(this.partitions.values()).map((bh) => bh.snapshot());
  }

  /**
   * Number of registered partitions.
   */
  get size(): number {
    return this.partitions.size;
  }
}

// =============================================================================
// Global singleton
// =============================================================================

/**
 * Global bulkhead registry with pre-configured partitions.
 *
 * Default concurrency limits:
 * - `llm`:       8 concurrent (LLM calls are slow & expensive)
 * - `cloud-api`: 20 concurrent (cloud API calls are moderately fast)
 * - `tools`:     15 concurrent (tool executions vary widely)
 * - `internal`:  50 concurrent (fast internal operations)
 */
export const bulkheadRegistry = new BulkheadRegistry();

// Pre-register standard partitions with tuned defaults.
bulkheadRegistry.get("llm", { maxConcurrency: 8, maxQueue: 50 });
bulkheadRegistry.get("cloud-api", { maxConcurrency: 20, maxQueue: 200 });
bulkheadRegistry.get("tools", { maxConcurrency: 15, maxQueue: 100 });
bulkheadRegistry.get("internal", { maxConcurrency: 50, maxQueue: 500 });
