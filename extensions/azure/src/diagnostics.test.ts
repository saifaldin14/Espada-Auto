/**
 * Azure Extension — Diagnostics Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enableAzureDiagnostics,
  disableAzureDiagnostics,
  isAzureDiagnosticsEnabled,
  onAzureDiagnosticEvent,
  emitAzureDiagnosticEvent,
  instrumentedAzureCall,
  resetAzureDiagnosticsForTest,
} from "./diagnostics.js";

beforeEach(() => {
  resetAzureDiagnosticsForTest();
});

describe("enableAzureDiagnostics / disableAzureDiagnostics", () => {
  it("toggles diagnostics state", () => {
    expect(isAzureDiagnosticsEnabled()).toBe(false);
    enableAzureDiagnostics();
    expect(isAzureDiagnosticsEnabled()).toBe(true);
    disableAzureDiagnostics();
    expect(isAzureDiagnosticsEnabled()).toBe(false);
  });
});

describe("onAzureDiagnosticEvent", () => {
  it("receives emitted events when enabled", () => {
    enableAzureDiagnostics();
    const listener = vi.fn();
    onAzureDiagnosticEvent(listener);

    emitAzureDiagnosticEvent({
      type: "azure.api.call",
      service: "compute",
      operation: "listVMs",
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event.type).toBe("azure.api.call");
    expect(event.service).toBe("compute");
    expect(event.seq).toBe(1);
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it("does not emit when disabled", () => {
    const listener = vi.fn();
    onAzureDiagnosticEvent(listener);

    emitAzureDiagnosticEvent({
      type: "azure.api.call",
      service: "compute",
      operation: "listVMs",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes correctly", () => {
    enableAzureDiagnostics();
    const listener = vi.fn();
    const unsub = onAzureDiagnosticEvent(listener);

    unsub();

    emitAzureDiagnosticEvent({
      type: "azure.api.call",
      service: "compute",
      operation: "listVMs",
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("instrumentedAzureCall", () => {
  it("returns result and emits call event", async () => {
    enableAzureDiagnostics();
    const listener = vi.fn();
    onAzureDiagnosticEvent(listener);

    const result = await instrumentedAzureCall("storage", "listBlobs", async () => "data");

    expect(result).toBe("data");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].type).toBe("azure.api.call");
    expect(listener.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits error event on failure", async () => {
    enableAzureDiagnostics();
    const listener = vi.fn();
    onAzureDiagnosticEvent(listener);

    await expect(
      instrumentedAzureCall("storage", "listBlobs", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].type).toBe("azure.api.error");
    expect(listener.mock.calls[0][0].error).toBe("boom");
  });

  it("passes through without instrumentation when disabled", async () => {
    const listener = vi.fn();
    onAzureDiagnosticEvent(listener);

    const result = await instrumentedAzureCall("storage", "listBlobs", async () => "data");

    expect(result).toBe("data");
    expect(listener).not.toHaveBeenCalled();
  });
});
