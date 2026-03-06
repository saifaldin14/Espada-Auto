/**
 * Governance — Audit Logger
 *
 * Produces cryptographically chained audit log entries for every
 * migration action. Each entry includes a SHA-256 hash of the
 * previous entry, forming a tamper-evident chain.
 */

import { createHash } from "node:crypto";
import { getResolvedExtensions } from "../integrations/extension-bridge.js";

// =============================================================================
// Types
// =============================================================================

export interface AuditEntry {
  id: string;
  timestamp: string;
  jobId: string;
  action: string;
  actor: string;
  phase: string;
  stepId?: string;
  details: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface AuditChain {
  entries: AuditEntry[];
  head: string; // hash of the latest entry
  length: number;
  verified: boolean;
}

// =============================================================================
// Audit Logger
// =============================================================================

export class MigrationAuditLogger {
  private entries: AuditEntry[] = [];
  private headHash: string = "genesis";

  /** Maximum number of entries retained in memory. Oldest entries are trimmed. */
  static readonly MAX_ENTRIES = 50_000;

  /**
   * Log a new audit entry.
   */
  log(params: {
    jobId: string;
    action: string;
    actor?: string;
    phase: string;
    stepId?: string;
    details?: Record<string, unknown>;
  }): AuditEntry {
    const entry: Omit<AuditEntry, "hash"> = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      jobId: params.jobId,
      action: params.action,
      actor: params.actor ?? "system",
      phase: params.phase,
      stepId: params.stepId,
      details: params.details ?? {},
      previousHash: this.headHash,
    };

    const hash = this.computeHash(entry);
    const fullEntry: AuditEntry = { ...entry, hash };

    this.entries.push(fullEntry);
    this.headHash = hash;

    // Trim oldest entries when over the cap (keep last MAX_ENTRIES)
    if (this.entries.length > MigrationAuditLogger.MAX_ENTRIES) {
      const excess = this.entries.length - MigrationAuditLogger.MAX_ENTRIES;
      this.entries.splice(0, excess);
    }

    // Bridge: also emit to the audit-trail extension (if available)
    this.emitToAuditTrail(fullEntry);

    return fullEntry;
  }

  /**
   * Emit an audit entry to the audit-trail sibling extension.
   * Degrades gracefully if audit-trail is not resolved.
   */
  private emitToAuditTrail(entry: AuditEntry): void {
    try {
      const ext = getResolvedExtensions();
      if (!ext?.auditLogger) return;

      ext.auditLogger.log({
        eventType: "state_changed",
        severity: entry.action === "error" ? "error" : "info",
        actor: { id: entry.actor, name: entry.actor, roles: ["migration-engine"] },
        operation: `migration:${entry.action}`,
        resource: entry.stepId
          ? { type: "migration-step", id: entry.stepId, provider: "cloud-migration" }
          : { type: "migration-job", id: entry.jobId, provider: "cloud-migration" },
        parameters: entry.details,
        result: entry.action === "error" ? "failure" : "success",
        correlationId: entry.jobId,
        metadata: {
          phase: entry.phase,
          migrationAuditHash: entry.hash,
          previousHash: entry.previousHash,
        },
      });
    } catch {
      // Graceful degradation — audit-trail extension may not be available
    }
  }

  /**
   * Verify the integrity of the audit chain.
   */
  verify(): { valid: boolean; brokenAt?: number; reason?: string } {
    if (this.entries.length === 0) {
      return { valid: true };
    }

    // First entry should reference "genesis"
    if (this.entries[0].previousHash !== "genesis") {
      return { valid: false, brokenAt: 0, reason: "First entry does not reference genesis" };
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      // Verify hash
      const expectedHash = this.computeHash({
        id: entry.id,
        timestamp: entry.timestamp,
        jobId: entry.jobId,
        action: entry.action,
        actor: entry.actor,
        phase: entry.phase,
        stepId: entry.stepId,
        details: entry.details,
        previousHash: entry.previousHash,
      });

      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i, reason: `Hash mismatch at entry ${i}` };
      }

      // Verify chain linkage (except first entry)
      if (i > 0 && entry.previousHash !== this.entries[i - 1].hash) {
        return { valid: false, brokenAt: i, reason: `Chain break at entry ${i}` };
      }
    }

    return { valid: true };
  }

  /**
   * Get the full audit chain.
   */
  getChain(): AuditChain {
    const verification = this.verify();
    return {
      entries: [...this.entries],
      head: this.headHash,
      length: this.entries.length,
      verified: verification.valid,
    };
  }

  /**
   * Get entries for a specific job.
   */
  getJobEntries(jobId: string): AuditEntry[] {
    return this.entries.filter((e) => e.jobId === jobId);
  }

  /**
   * Get entries for a specific step.
   */
  getStepEntries(stepId: string): AuditEntry[] {
    return this.entries.filter((e) => e.stepId === stepId);
  }

  /**
   * Export the audit chain as JSON.
   */
  export(): string {
    return JSON.stringify(this.getChain(), null, 2);
  }

  /**
   * Get the total number of entries.
   */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Reset the logger (for testing).
   */
  reset(): void {
    this.entries = [];
    this.headHash = "genesis";
  }

  // =============================================================================
  // Private
  // =============================================================================

  private computeHash(entry: Omit<AuditEntry, "hash">): string {
    const payload = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp,
      jobId: entry.jobId,
      action: entry.action,
      actor: entry.actor,
      phase: entry.phase,
      stepId: entry.stepId,
      details: entry.details,
      previousHash: entry.previousHash,
    });

    return createHash("sha256").update(payload).digest("hex");
  }
}

/**
 * Singleton audit logger instance.
 */
let _auditLogger: MigrationAuditLogger | null = null;

export function getAuditLogger(): MigrationAuditLogger {
  if (!_auditLogger) {
    _auditLogger = new MigrationAuditLogger();
  }
  return _auditLogger;
}

export function resetAuditLogger(): void {
  _auditLogger?.reset();
  _auditLogger = null;
}
