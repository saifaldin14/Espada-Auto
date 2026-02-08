import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enableAWSDiagnostics,
  disableAWSDiagnostics,
  isAWSDiagnosticsEnabled,
  setAWSDiagnosticsEnabled,
  emitAWSDiagnosticEvent,
  onAWSDiagnosticEvent,
  instrumentedAWSCall,
  emitCredentialRefreshEvent,
  emitResourceChangeEvent,
  resetAWSDiagnosticsForTest,
} from "./diagnostics.js";

describe("AWS Diagnostics", () => {
  beforeEach(() => {
    resetAWSDiagnosticsForTest();
  });

  afterEach(() => {
    resetAWSDiagnosticsForTest();
  });

  describe("enableAWSDiagnostics / disableAWSDiagnostics", () => {
    it("should enable diagnostics", () => {
      expect(isAWSDiagnosticsEnabled()).toBe(false);
      enableAWSDiagnostics();
      expect(isAWSDiagnosticsEnabled()).toBe(true);
    });

    it("should disable diagnostics", () => {
      enableAWSDiagnostics();
      expect(isAWSDiagnosticsEnabled()).toBe(true);
      disableAWSDiagnostics();
      expect(isAWSDiagnosticsEnabled()).toBe(false);
    });
  });

  describe("setAWSDiagnosticsEnabled", () => {
    it("should set diagnostics state", () => {
      setAWSDiagnosticsEnabled(true);
      expect(isAWSDiagnosticsEnabled()).toBe(true);
      setAWSDiagnosticsEnabled(false);
      expect(isAWSDiagnosticsEnabled()).toBe(false);
    });
  });

  describe("emitAWSDiagnosticEvent", () => {
    it("should not emit when diagnostics disabled", () => {
      const listener = vi.fn();
      onAWSDiagnosticEvent(listener);

      emitAWSDiagnosticEvent({
        type: "aws.api.call",
        service: "ec2",
        operation: "DescribeInstances",
        durationMs: 100,
        success: true,
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it("should emit when diagnostics enabled", () => {
      enableAWSDiagnostics();
      const listener = vi.fn();
      onAWSDiagnosticEvent(listener);

      emitAWSDiagnosticEvent({
        type: "aws.api.call",
        service: "ec2",
        operation: "DescribeInstances",
        durationMs: 100,
        success: true,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "aws.api.call",
          service: "ec2",
          operation: "DescribeInstances",
          durationMs: 100,
          success: true,
          ts: expect.any(Number),
          seq: expect.any(Number),
        })
      );
    });

    it("should increment sequence number", () => {
      enableAWSDiagnostics();
      const events: any[] = [];
      onAWSDiagnosticEvent((event) => events.push(event));

      emitAWSDiagnosticEvent({
        type: "aws.api.call",
        service: "ec2",
        operation: "Op1",
        durationMs: 100,
        success: true,
      });

      emitAWSDiagnosticEvent({
        type: "aws.api.call",
        service: "ec2",
        operation: "Op2",
        durationMs: 100,
        success: true,
      });

      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
    });
  });

  describe("onAWSDiagnosticEvent", () => {
    it("should return unsubscribe function", () => {
      enableAWSDiagnostics();
      const listener = vi.fn();
      const unsubscribe = onAWSDiagnosticEvent(listener);

      emitAWSDiagnosticEvent({
        type: "aws.api.call",
        service: "ec2",
        operation: "Op1",
        durationMs: 100,
        success: true,
      });

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      emitAWSDiagnosticEvent({
        type: "aws.api.call",
        service: "ec2",
        operation: "Op2",
        durationMs: 100,
        success: true,
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("instrumentedAWSCall", () => {
    it("should emit success event", async () => {
      enableAWSDiagnostics();
      const listener = vi.fn();
      onAWSDiagnosticEvent(listener);

      const result = await instrumentedAWSCall(
        "ec2",
        "DescribeInstances",
        async () => ({ Reservations: [] }),
        { region: "us-east-1" }
      );

      expect(result).toEqual({ Reservations: [] });
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "aws.api.call",
          service: "ec2",
          operation: "DescribeInstances",
          region: "us-east-1",
          success: true,
        })
      );
    });

    it("should emit error event on failure", async () => {
      enableAWSDiagnostics();
      const listener = vi.fn();
      onAWSDiagnosticEvent(listener);

      const error = new Error("Access denied");
      (error as any).name = "AccessDeniedException";
      (error as any).code = "AccessDeniedException";

      await expect(
        instrumentedAWSCall(
          "ec2",
          "DescribeInstances",
          async () => {
            throw error;
          },
          { region: "us-east-1" }
        )
      ).rejects.toThrow("Access denied");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "aws.api.error",
          service: "ec2",
          operation: "DescribeInstances",
          region: "us-east-1",
          success: false,
          error: "Access denied",
          errorCode: "AccessDeniedException",
        })
      );
    });

    it("should extract metadata from AWS SDK response", async () => {
      enableAWSDiagnostics();
      const listener = vi.fn();
      onAWSDiagnosticEvent(listener);

      await instrumentedAWSCall("ec2", "DescribeInstances", async () => ({
        $metadata: {
          requestId: "abc123",
          httpStatusCode: 200,
        },
        Reservations: [],
      }));

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "aws.api.call",
          requestId: "abc123",
          httpStatusCode: 200,
        })
      );
    });
  });

  describe("emitCredentialRefreshEvent", () => {
    it("should emit credential refresh event", () => {
      enableAWSDiagnostics();
      const listener = vi.fn();
      onAWSDiagnosticEvent(listener);

      emitCredentialRefreshEvent({
        source: "sso",
        profile: "prod",
        region: "us-east-1",
        durationMs: 500,
        success: true,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "aws.credential.refresh",
          source: "sso",
          profile: "prod",
          success: true,
        })
      );
    });
  });

  describe("emitResourceChangeEvent", () => {
    it("should emit resource change event", () => {
      enableAWSDiagnostics();
      const listener = vi.fn();
      onAWSDiagnosticEvent(listener);

      emitResourceChangeEvent({
        service: "ec2",
        operation: "create",
        resourceType: "instance",
        resourceId: "i-1234567890abcdef0",
        region: "us-east-1",
        durationMs: 5000,
        success: true,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "aws.resource.change",
          service: "ec2",
          operation: "create",
          resourceType: "instance",
          resourceId: "i-1234567890abcdef0",
        })
      );
    });
  });
});
