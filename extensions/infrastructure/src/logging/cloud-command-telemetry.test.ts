import { describe, expect, it, vi } from "vitest";

import {
  createCloudCommandTelemetrySink,
  normalizeCloudCommandTelemetry,
} from "./cloud-command-telemetry.js";

describe("cloud-command telemetry", () => {
  it("normalizes defaults safely", () => {
    const event = normalizeCloudCommandTelemetry(
      {
        provider: "aws",
        command: "aws sts get-caller-identity",
        success: true,
      },
      () => new Date("2026-03-03T00:00:00.000Z"),
    );

    expect(event.kind).toBe("cloud-command");
    expect(event.version).toBe(1);
    expect(event.commandRedacted).toBe("aws sts get-caller-identity");
    expect(event.exitCode).toBe(0);
    expect(event.durationMs).toBe(0);
    expect(event.timestamp).toBe("2026-03-03T00:00:00.000Z");
  });

  it("aggregates provider metrics and summary", () => {
    const sink = createCloudCommandTelemetrySink();

    sink.handle({
      provider: "aws",
      command: "aws ec2 describe-instances",
      commandRedacted: "aws ec2 describe-instances",
      success: true,
      durationMs: 100,
    });
    sink.handle({
      provider: "azure",
      command: "az group list",
      commandRedacted: "az group list",
      success: false,
      exitCode: 1,
      durationMs: 200,
      retryable: true,
      errorType: "rate-limit",
    });
    sink.handle({
      provider: "terraform",
      command: "terraform plan",
      commandRedacted: "terraform plan",
      success: false,
      exitCode: 1,
      durationMs: 300,
      retryable: false,
      errorType: "validation",
    });

    const summary = sink.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.success).toBe(1);
    expect(summary.failed).toBe(2);
    expect(summary.retryableFailures).toBe(1);
    expect(summary.providerCounts.aws).toBe(1);
    expect(summary.providerCounts.azure).toBe(1);
    expect(summary.providerCounts.terraform).toBe(1);
    expect(summary.avgDurationMs).toBeCloseTo(200);
  });

  it("honors maxBufferSize and preserves newest events", () => {
    const sink = createCloudCommandTelemetrySink({ maxBufferSize: 2 });

    sink.handle({ provider: "kubernetes", command: "kubectl get pods", success: true });
    sink.handle({ provider: "pulumi", command: "pulumi preview --json", success: true });
    sink.handle({ provider: "aws", command: "aws s3 ls", success: true });

    const buffer = sink.getBuffer();
    expect(buffer).toHaveLength(2);
    expect(buffer[0]?.provider).toBe("pulumi");
    expect(buffer[1]?.provider).toBe("aws");
  });

  it("supports sampling and downstream forwarding", () => {
    const onEvent = vi.fn();
    const sink = createCloudCommandTelemetrySink({
      sampleRate: 0.5,
      random: () => 0.4,
      onEvent,
    });

    sink.handle({
      provider: "aws",
      command: "aws sts get-caller-identity",
      commandRedacted: "aws sts get-caller-identity",
      success: true,
      durationMs: 12,
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cloud-command",
        provider: "aws",
        durationMs: 12,
      }),
    );
  });

  it("drops events that fail sampling", () => {
    const sink = createCloudCommandTelemetrySink({
      sampleRate: 0.5,
      random: () => 0.9,
    });

    sink.handle({
      provider: "aws",
      command: "aws sts get-caller-identity",
      success: true,
    });

    expect(sink.getSummary().total).toBe(0);
    expect(sink.getBuffer()).toHaveLength(0);
  });
});
