/**
 * Compliance — Waiver Management
 *
 * Stores waivers in memory (test) or a JSON file (~/.espada/compliance-waivers.json).
 * Provides time-limited waivers with approval tracking.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ComplianceWaiver } from "./types.js";
import type { WaiverLookup } from "./evaluator.js";

// ---------------------------------------------------------------------------
// WaiverStore interface + InMemory implementation
// ---------------------------------------------------------------------------
export interface WaiverStore extends WaiverLookup {
  add(waiver: ComplianceWaiver): void;
  remove(waiverId: string): boolean;
  get(waiverId: string): ComplianceWaiver | undefined;
  list(): ComplianceWaiver[];
  listActive(): ComplianceWaiver[];
  isWaived(controlId: string, resourceId: string): boolean;
}

export class InMemoryWaiverStore implements WaiverStore {
  private waivers: ComplianceWaiver[] = [];

  add(waiver: ComplianceWaiver): void {
    // Remove existing waiver for same control+resource if present
    this.waivers = this.waivers.filter(
      (w) => !(w.controlId === waiver.controlId && w.resourceId === waiver.resourceId),
    );
    this.waivers.push(waiver);
  }

  remove(waiverId: string): boolean {
    const before = this.waivers.length;
    this.waivers = this.waivers.filter((w) => w.id !== waiverId);
    return this.waivers.length < before;
  }

  get(waiverId: string): ComplianceWaiver | undefined {
    return this.waivers.find((w) => w.id === waiverId);
  }

  list(): ComplianceWaiver[] {
    return [...this.waivers];
  }

  listActive(): ComplianceWaiver[] {
    const now = new Date().toISOString();
    return this.waivers.filter((w) => w.expiresAt > now);
  }

  isWaived(controlId: string, resourceId: string): boolean {
    const now = new Date().toISOString();
    return this.waivers.some(
      (w) => w.controlId === controlId && w.resourceId === resourceId && w.expiresAt > now,
    );
  }
}

// ---------------------------------------------------------------------------
// File-backed WaiverStore — persists to ~/.espada/compliance-waivers.json
// ---------------------------------------------------------------------------
export class FileWaiverStore implements WaiverStore {
  private inner = new InMemoryWaiverStore();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), ".espada", "compliance-waivers.json");
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const arr: ComplianceWaiver[] = JSON.parse(raw);
        for (const w of arr) this.inner.add(w);
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  private save(): void {
    try {
      const dir = this.filePath.replace(/[/\\][^/\\]+$/, "");
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.inner.list(), null, 2));
    } catch {
      // Best-effort persist
    }
  }

  add(waiver: ComplianceWaiver): void {
    this.inner.add(waiver);
    this.save();
  }

  remove(waiverId: string): boolean {
    const ok = this.inner.remove(waiverId);
    if (ok) this.save();
    return ok;
  }

  get(waiverId: string): ComplianceWaiver | undefined {
    return this.inner.get(waiverId);
  }

  list(): ComplianceWaiver[] {
    return this.inner.list();
  }

  listActive(): ComplianceWaiver[] {
    return this.inner.listActive();
  }

  isWaived(controlId: string, resourceId: string): boolean {
    return this.inner.isWaived(controlId, resourceId);
  }
}

// ---------------------------------------------------------------------------
// Waiver ID generator
// ---------------------------------------------------------------------------
let waiverSeq = 0;
export function generateWaiverId(): string {
  return `waiver-${Date.now()}-${++waiverSeq}`;
}

// ---------------------------------------------------------------------------
// Create waiver helper
// ---------------------------------------------------------------------------
export function createWaiver(opts: {
  controlId: string;
  resourceId: string;
  reason: string;
  approvedBy: string;
  expiresInDays?: number;
}): ComplianceWaiver {
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + (opts.expiresInDays ?? 90));

  return {
    id: generateWaiverId(),
    controlId: opts.controlId,
    resourceId: opts.resourceId,
    reason: opts.reason,
    approvedBy: opts.approvedBy,
    approvedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}
