/**
 * Compliance — Report Storage
 *
 * Stores compliance scan reports with timestamps for trend analysis.
 * Uses a JSON file at `~/.espada/compliance-reports.json` for persistence.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ComplianceReport, ComplianceTrend, FrameworkId } from "./types.js";

/** A stored report with a unique ID. */
export interface StoredReport {
  id: string;
  report: ComplianceReport;
  storedAt: string;
}

/** Interface for report storage backends. */
export interface ReportStore {
  /** Save a report and return its ID. */
  save(report: ComplianceReport): string;
  /** List reports, optionally filtered by framework. */
  list(framework?: FrameworkId, limit?: number): StoredReport[];
  /** Get a specific report by ID. */
  get(id: string): StoredReport | null;
  /** Delete a report by ID. */
  delete(id: string): boolean;
  /** Get trend data for a framework. */
  getTrend(framework: FrameworkId, limit?: number): ComplianceTrend[];
  /** Total stored reports. */
  count(): number;
}

/**
 * File-based report store persisted at `~/.espada/compliance-reports.json`.
 */
export class FileReportStore implements ReportStore {
  private reports: StoredReport[] = [];
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), ".espada", "compliance-reports.json");
    this.load();
  }

  save(report: ComplianceReport): string {
    const id = `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored: StoredReport = {
      id,
      report,
      storedAt: new Date().toISOString(),
    };
    this.reports.push(stored);
    this.persist();
    return id;
  }

  list(framework?: FrameworkId, limit?: number): StoredReport[] {
    let filtered = this.reports;
    if (framework) {
      filtered = filtered.filter((r) => r.report.framework === framework);
    }
    // Most recent first
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.storedAt).getTime() - new Date(a.storedAt).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  get(id: string): StoredReport | null {
    return this.reports.find((r) => r.id === id) ?? null;
  }

  delete(id: string): boolean {
    const idx = this.reports.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.reports.splice(idx, 1);
    this.persist();
    return true;
  }

  getTrend(framework: FrameworkId, limit = 30): ComplianceTrend[] {
    const reports = this.list(framework, limit);
    return reports
      .reverse() // oldest first for trend display
      .map((r) => ({
        date: r.report.generatedAt,
        score: r.report.score,
        violations: r.report.violations.filter((v) => v.status === "open").length,
      }));
  }

  count(): number {
    return this.reports.length;
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        this.reports = JSON.parse(raw);
      }
    } catch {
      this.reports = [];
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.reports, null, 2));
    } catch {
      // Silently fail on write errors (read-only fs, permissions, etc.)
    }
  }
}

/**
 * In-memory report store for tests.
 */
export class InMemoryReportStore implements ReportStore {
  private reports: StoredReport[] = [];

  save(report: ComplianceReport): string {
    const id = `cr-${this.reports.length + 1}`;
    this.reports.push({ id, report, storedAt: new Date().toISOString() });
    return id;
  }

  list(framework?: FrameworkId, limit?: number): StoredReport[] {
    let filtered = this.reports;
    if (framework) {
      filtered = filtered.filter((r) => r.report.framework === framework);
    }
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.storedAt).getTime() - new Date(a.storedAt).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  get(id: string): StoredReport | null {
    return this.reports.find((r) => r.id === id) ?? null;
  }

  delete(id: string): boolean {
    const idx = this.reports.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.reports.splice(idx, 1);
    return true;
  }

  getTrend(framework: FrameworkId, limit = 30): ComplianceTrend[] {
    const reports = this.list(framework, limit);
    return reports.reverse().map((r) => ({
      date: r.report.generatedAt,
      score: r.report.score,
      violations: r.report.violations.filter((v) => v.status === "open").length,
    }));
  }

  count(): number {
    return this.reports.length;
  }
}
