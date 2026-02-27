/**
 * Tests for the webhook event receiver.
 *
 * Validates HTTP routing, provider-specific parsing, signature verification,
 * Event Grid validation handshake, WebhookEventSource buffering, and
 * integration with InfraMonitor.ingestEvents().
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WebhookReceiver,
  WebhookEventSource,
} from "./webhook-receiver.js";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make an HTTP request to the receiver. */
async function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

async function get(
  port: number,
  path: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ---------------------------------------------------------------------------
// WebhookEventSource
// ---------------------------------------------------------------------------

describe("WebhookEventSource", () => {
  it("buffers and drains events", async () => {
    const source = new WebhookEventSource("aws");
    expect(source.type).toBe("webhook");
    expect(source.provider).toBe("aws");
    expect(source.pendingCount).toBe(0);

    source.push({
      id: "e1",
      provider: "aws",
      eventType: "RunInstances",
      resourceId: "i-abc",
      resourceType: "compute",
      actor: "user1",
      timestamp: "2024-01-01T00:00:00Z",
      readOnly: false,
      success: true,
      raw: {},
    });

    expect(source.pendingCount).toBe(1);

    const events = await source.fetchEvents("2024-01-01T00:00:00Z");
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("e1");

    // Buffer should be drained
    expect(source.pendingCount).toBe(0);
    const empty = await source.fetchEvents("2024-01-01T00:00:00Z");
    expect(empty).toHaveLength(0);
  });

  it("pushMany adds multiple events", async () => {
    const source = new WebhookEventSource("azure");
    source.pushMany([
      { id: "e1", provider: "azure", eventType: "Create", resourceId: "r1", resourceType: "compute", actor: "u1", timestamp: "2024-01-01T00:00:00Z", readOnly: false, success: true, raw: {} },
      { id: "e2", provider: "azure", eventType: "Delete", resourceId: "r2", resourceType: "storage", actor: "u2", timestamp: "2024-01-01T00:00:00Z", readOnly: false, success: true, raw: {} },
    ]);
    expect(source.pendingCount).toBe(2);
    const events = await source.fetchEvents("2024-01-01T00:00:00Z");
    expect(events).toHaveLength(2);
  });

  it("health check reflects active/stopped state", async () => {
    const source = new WebhookEventSource("gcp");
    let health = await source.healthCheck();
    expect(health.ok).toBe(true);

    source.markStopped();
    health = await source.healthCheck();
    expect(health.ok).toBe(false);

    source.markActive();
    health = await source.healthCheck();
    expect(health.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WebhookReceiver
// ---------------------------------------------------------------------------

describe("WebhookReceiver", () => {
  let receiver: WebhookReceiver;
  let port: number;
  let awsSource: WebhookEventSource;
  let azureSource: WebhookEventSource;
  let gcpSource: WebhookEventSource;

  beforeEach(async () => {
    awsSource = new WebhookEventSource("aws");
    azureSource = new WebhookEventSource("azure");
    gcpSource = new WebhookEventSource("gcp");

    receiver = new WebhookReceiver({ port: 0, basePath: "/events" });
    receiver.registerSource("aws", awsSource);
    receiver.registerSource("azure", azureSource);
    receiver.registerSource("gcp", gcpSource);

    await receiver.start();
    port = receiver.address!.port;
  });

  afterEach(async () => {
    await receiver.stop();
  });

  // -------------------------------------------------------------------------
  // Basic routing
  // -------------------------------------------------------------------------

  it("returns 405 for non-POST requests to event routes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/events/aws`, { method: "PUT" });
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown routes", async () => {
    const { status, data } = await post(port, "/events/unknown-provider", {});
    expect(status).toBe(404);
    expect(data.error).toContain("Unknown route");
  });

  it("returns health check", async () => {
    const { status, data } = await get(port, "/events/health");
    expect(status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.sources).toBe(3);
  });

  it("reports status correctly", () => {
    const status = receiver.getStatus();
    expect(status.listening).toBe(true);
    expect(status.totalReceived).toBe(0);
    expect(status.totalRejected).toBe(0);
    expect(status.sources).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // AWS events
  // -------------------------------------------------------------------------

  describe("AWS /events/aws", () => {
    it("parses a direct EventBridge event", async () => {
      const event = {
        id: "eb-1",
        detail: {
          eventName: "RunInstances",
          eventID: "ct-123",
          eventTime: "2024-06-01T12:00:00Z",
          userIdentity: { arn: "arn:aws:iam::123:user/admin" },
          responseElements: {
            instancesSet: { items: [{ instanceId: "i-abc123" }] },
          },
        },
      };

      const { status, data } = await post(port, "/events/aws", event);
      expect(status).toBe(200);
      expect(data.accepted).toBe(1);
      expect(awsSource.pendingCount).toBe(1);

      const events = await awsSource.fetchEvents("");
      expect(events[0].eventType).toBe("RunInstances");
      expect(events[0].resourceId).toBe("i-abc123");
      expect(events[0].actor).toContain("admin");
    });

    it("parses CloudTrail event with resources ARN", async () => {
      const event = {
        detail: {
          eventName: "DeleteBucket",
          eventID: "ct-456",
          eventTime: "2024-06-01T13:00:00Z",
          userIdentity: { userName: "ops-user" },
          resources: [{ ARN: "arn:aws:s3:::my-bucket" }],
        },
      };

      const { status } = await post(port, "/events/cloudtrail", event);
      expect(status).toBe(200);

      const events = await awsSource.fetchEvents("");
      expect(events[0].resourceId).toBe("arn:aws:s3:::my-bucket");
      expect(events[0].resourceType).toBe("storage");
    });

    it("marks read-only events correctly", async () => {
      const event = {
        detail: {
          eventName: "DescribeInstances",
          eventID: "ct-789",
          readOnly: true,
          userIdentity: { arn: "arn:aws:iam::123:role/reader" },
        },
      };

      const { status, data } = await post(port, "/events/aws", event);
      expect(status).toBe(200);
      expect(data.accepted).toBe(1);

      const events = await awsSource.fetchEvents("");
      expect(events[0].readOnly).toBe(true);
    });

    it("ignores SNS SubscriptionConfirmation", async () => {
      const payload = {
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&...",
      };

      const { status, data } = await post(port, "/events/aws", payload);
      expect(status).toBe(200);
      expect(data.accepted).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Azure events
  // -------------------------------------------------------------------------

  describe("Azure /events/azure", () => {
    it("parses Event Grid events", async () => {
      const event = [
        {
          id: "az-1",
          eventType: "Microsoft.Compute.VirtualMachines.Write",
          subject: "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
          eventTime: "2024-06-01T14:00:00Z",
          data: {
            authorization: { evidence: { principalId: "user@contoso.com" } },
            status: "Succeeded",
          },
        },
      ];

      const { status, data } = await post(port, "/events/azure", event);
      expect(status).toBe(200);
      expect(data.accepted).toBe(1);

      const events = await azureSource.fetchEvents("");
      expect(events[0].eventType).toContain("VirtualMachines");
      expect(events[0].resourceType).toBe("compute");
    });

    it("handles Event Grid validation handshake", async () => {
      const validationEvent = [
        {
          eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
          data: { validationCode: "test-validation-code" },
        },
      ];

      const { status, data } = await post(port, "/events/azure", validationEvent);
      expect(status).toBe(200);
      expect(data.validationResponse).toBe("test-validation-code");
      expect(azureSource.pendingCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GCP events
  // -------------------------------------------------------------------------

  describe("GCP /events/gcp", () => {
    it("parses Pub/Sub push with base64 data", async () => {
      const auditLog = {
        insertId: "gcp-1",
        timestamp: "2024-06-01T15:00:00Z",
        protoPayload: {
          methodName: "v1.compute.instances.insert",
          resourceName: "projects/my-proj/zones/us-central1-a/instances/vm-1",
          authenticationInfo: { principalEmail: "dev@my-proj.iam.gserviceaccount.com" },
          status: { code: 0 },
        },
      };

      const pubsubMessage = {
        message: {
          data: Buffer.from(JSON.stringify(auditLog)).toString("base64"),
          messageId: "msg-1",
        },
      };

      const { status, data } = await post(port, "/events/gcp", pubsubMessage);
      expect(status).toBe(200);
      expect(data.accepted).toBe(1);

      const events = await gcpSource.fetchEvents("");
      expect(events[0].eventType).toBe("v1.compute.instances.insert");
      expect(events[0].resourceType).toBe("compute");
      expect(events[0].actor).toContain("dev@");
    });
  });

  // -------------------------------------------------------------------------
  // Generic CloudEvent
  // -------------------------------------------------------------------------

  describe("Generic /events/generic", () => {
    it("parses CloudEvent v1.0 format", async () => {
      const cloudEvent = {
        specversion: "1.0",
        id: "gen-1",
        source: "aws.ec2",
        type: "com.aws.ec2.instance.start",
        subject: "i-abc123",
        time: "2024-06-01T16:00:00Z",
        data: { actor: "admin" },
      };

      const { status, data } = await post(port, "/events/generic", cloudEvent);
      expect(status).toBe(200);
      expect(data.accepted).toBe(1);

      const events = await awsSource.fetchEvents("");
      expect(events[0].provider).toBe("aws");
      expect(events[0].resourceId).toBe("i-abc123");
    });

    it("also accepts POST to /events/", async () => {
      const cloudEvent = {
        id: "gen-2",
        source: "azure.vm",
        type: "vm.created",
        subject: "vm-1",
      };

      const { status, data } = await post(port, "/events/", cloudEvent);
      expect(status).toBe(200);
      expect(data.accepted).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Signature verification
  // -------------------------------------------------------------------------

  describe("Signature verification", () => {
    let secureReceiver: WebhookReceiver;
    let securePort: number;
    const SECRET = "test-secret-key";

    beforeEach(async () => {
      secureReceiver = new WebhookReceiver({
        port: 0,
        basePath: "/events",
        secret: SECRET,
      });
      const src = new WebhookEventSource("aws");
      secureReceiver.registerSource("aws", src);
      await secureReceiver.start();
      securePort = secureReceiver.address!.port;
    });

    afterEach(async () => {
      await secureReceiver.stop();
    });

    it("rejects missing signature", async () => {
      const { status, data } = await post(securePort, "/events/aws", { detail: { eventName: "Test" } });
      expect(status).toBe(401);
      expect(data.error).toContain("signature");
    });

    it("rejects invalid signature", async () => {
      const { status } = await post(
        securePort,
        "/events/aws",
        { detail: { eventName: "Test" } },
        { "x-webhook-signature": "bad-signature" },
      );
      expect(status).toBe(401);
    });

    it("accepts valid HMAC-SHA256 signature", async () => {
      const body = JSON.stringify({ detail: { eventName: "RunInstances", eventID: "ct-sig" } });
      const signature = sign(body, SECRET);

      const res = await fetch(`http://127.0.0.1:${securePort}/events/aws`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": signature,
        },
        body,
      });

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Callback integration
  // -------------------------------------------------------------------------

  describe("onEventsReceived callback", () => {
    it("invokes callback with parsed events", async () => {
      const received: unknown[] = [];
      receiver.onEventsReceived((events) => {
        received.push(...events);
      });

      await post(port, "/events/aws", {
        detail: { eventName: "CreateBucket", eventID: "cb-1", userIdentity: { arn: "admin" } },
      });

      expect(received).toHaveLength(1);
    });

    it("callback errors don't break event acceptance", async () => {
      receiver.onEventsReceived(() => {
        throw new Error("Boom");
      });

      const { status, data } = await post(port, "/events/aws", {
        detail: { eventName: "DeleteBucket", eventID: "cb-2", userIdentity: { arn: "admin" } },
      });

      expect(status).toBe(200);
      expect(data.accepted).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe("Lifecycle", () => {
    it("start is idempotent", async () => {
      await receiver.start(); // already started in beforeEach
      expect(receiver.isListening()).toBe(true);
    });

    it("stop is idempotent", async () => {
      await receiver.stop();
      await receiver.stop(); // should not throw
      expect(receiver.isListening()).toBe(false);
    });

    it("tracks totalReceived and totalRejected", async () => {
      await post(port, "/events/aws", { detail: { eventName: "Test", eventID: "t1" } });
      await post(port, "/events/aws", { detail: { eventName: "Test2", eventID: "t2" } });

      expect(receiver.totalReceived).toBe(2);
      expect(receiver.totalRejected).toBe(0);
    });
  });
});
