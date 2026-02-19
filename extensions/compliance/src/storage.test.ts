/**
 * Compliance Report Storage — Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryReportStore } from "./storage.js";
import type { ComplianceReport, FrameworkId } from "./types.js";

function makeReport(overrides: Partial<ComplianceReport> = {}): ComplianceReport {
  return {
    framework: "soc2" as FrameworkId,
    frameworkVersion: "2024.1",
    generatedAt: new Date().toISOString(),
    scope: "all",
    score: 85,
    totalControls: 20,
    passedControls: 17,
    failedControls: 3,
    waivedControls: 0,
    notApplicable: 0,
    violations: [
      {
        controlId: "soc2-001",
        controlTitle: "Encryption at rest",
        framework: "soc2",
        resourceNodeId: "aws:123:us-east-1:storage:s3.bucket1",
        resourceName: "bucket1",
        resourceType: "storage",
        severity: "high",
        description: "S3 bucket not encrypted",
        remediation: "Enable SSE-S3 encryption",
        status: "open",
        detectedAt: new Date().toISOString(),
      },
    ],
    byCategory: { encryption: { passed: 4, failed: 1, total: 5 } },
    bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    ...overrides,
  };
}

describe("InMemoryReportStore", () => {
  let store: InMemoryReportStore;

  beforeEach(() => {
    store = new InMemoryReportStore();
  });

  it("saves and retrieves a report", () => {
    const report = makeReport();
    const id = store.save(report);

    expect(id).toBeTruthy();
    const stored = store.get(id);
    expect(stored).not.toBeNull();
    expect(stored!.report.score).toBe(85);
    expect(stored!.report.framework).toBe("soc2");
  });

  it("returns null for unknown ID", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  it("lists reports most-recent first", () => {
    store.save(makeReport({ score: 70, generatedAt: "2024-01-01T00:00:00Z" }));
    store.save(makeReport({ score: 80, generatedAt: "2024-02-01T00:00:00Z" }));
    store.save(makeReport({ score: 90, generatedAt: "2024-03-01T00:00:00Z" }));

    const all = store.list();
    expect(all).toHaveLength(3);
    // Most recent first
    expect(all[0].report.score).toBe(90);
    expect(all[2].report.score).toBe(70);
  });

  it("filters by framework", () => {
    store.save(makeReport({ framework: "soc2" }));
    store.save(makeReport({ framework: "hipaa" }));
    store.save(makeReport({ framework: "soc2" }));

    const soc2 = store.list("soc2");
    expect(soc2).toHaveLength(2);
    expect(soc2.every((r) => r.report.framework === "soc2")).toBe(true);
  });

  it("limits results", () => {
    for (let i = 0; i < 10; i++) {
      store.save(makeReport({ score: 50 + i }));
    }
    const limited = store.list(undefined, 3);
    expect(limited).toHaveLength(3);
  });

  it("deletes a report", () => {
    const id = store.save(makeReport());
    expect(store.count()).toBe(1);

    const deleted = store.delete(id);
    expect(deleted).toBe(true);
    expect(store.count()).toBe(0);
    expect(store.get(id)).toBeNull();
  });

  it("returns false when deleting non-existent report", () => {
    expect(store.delete("nope")).toBe(false);
  });

  it("generates trend data oldest-first", () => {
    store.save(makeReport({ framework: "cis", score: 60, generatedAt: "2024-01-01T00:00:00Z" }));
    store.save(makeReport({ framework: "cis", score: 75, generatedAt: "2024-02-01T00:00:00Z" }));
    store.save(makeReport({ framework: "cis", score: 90, generatedAt: "2024-03-01T00:00:00Z" }));

    const trend = store.getTrend("cis");
    expect(trend).toHaveLength(3);
    // Trend should be oldest first
    expect(trend[0].score).toBe(60);
    expect(trend[2].score).toBe(90);
  });

  it("trend counts only open violations", () => {
    const report = makeReport({
      violations: [
        { ...makeReport().violations[0], status: "open" },
        { ...makeReport().violations[0], status: "waived" },
      ],
    });
    store.save(report);

    const trend = store.getTrend("soc2");
    expect(trend[0].violations).toBe(1); // only open, not waived
  });

  it("counts total reports", () => {
    expect(store.count()).toBe(0);
    store.save(makeReport());
    store.save(makeReport());
    expect(store.count()).toBe(2);
  });
});
