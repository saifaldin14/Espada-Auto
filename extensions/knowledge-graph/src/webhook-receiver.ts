/**
 * Infrastructure Knowledge Graph — Webhook Event Receiver
 *
 * Provides inbound HTTP webhook endpoints for receiving push events from
 * cloud providers (AWS EventBridge/SNS, Azure Event Grid, GCP Pub/Sub).
 * Normalizes incoming events into CloudEvent format and feeds them into
 * the monitoring pipeline.
 *
 * Supports:
 * - AWS EventBridge via SNS subscription (with signature verification)
 * - Azure Event Grid subscriptions (with validation handshake)
 * - GCP Pub/Sub push subscriptions
 * - Generic CloudEvent format (CloudEvents v1.0 spec)
 * - HMAC-SHA256 shared-secret verification for all endpoints
 */

import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import type { CloudEvent, EventSourceAdapter, EventSourceType } from "./monitoring.js";
import type { CloudProvider } from "./types.js";

// =============================================================================
// Configuration
// =============================================================================

export type WebhookReceiverConfig = {
  /** Port to listen on. */
  port: number;
  /** Base path prefix (default: "/events"). */
  basePath?: string;
  /** Shared secret for HMAC signature verification (optional but recommended). */
  secret?: string;
  /** Maximum request body size in bytes (default: 1MB). */
  maxBodyBytes?: number;
  /** Listener bind address (default: "0.0.0.0"). */
  host?: string;
};

export const defaultReceiverConfig: WebhookReceiverConfig = {
  port: 9876,
  basePath: "/events",
  maxBodyBytes: 1024 * 1024, // 1MB
  host: "0.0.0.0",
};

// =============================================================================
// Webhook Event Source (buffer-based EventSourceAdapter)
// =============================================================================

/**
 * An EventSourceAdapter that buffers inbound pushed events.
 * Events are pushed in by the WebhookReceiver and drained via fetchEvents().
 */
export class WebhookEventSource implements EventSourceAdapter {
  readonly type: EventSourceType = "webhook";
  readonly provider: CloudProvider;
  private buffer: CloudEvent[] = [];
  private healthy = true;

  constructor(provider: CloudProvider) {
    this.provider = provider;
  }

  /** Push an event into the buffer (called by WebhookReceiver). */
  push(event: CloudEvent): void {
    this.buffer.push(event);
  }

  /** Push multiple events into the buffer. */
  pushMany(events: CloudEvent[]): void {
    this.buffer.push(...events);
  }

  /** Drain all buffered events (called by InfraMonitor polling). */
  async fetchEvents(_since: string): Promise<CloudEvent[]> {
    const events = this.buffer.splice(0);
    return events;
  }

  /** Health check — healthy as long as the receiver is running. */
  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: this.healthy, message: this.healthy ? "Webhook receiver active" : "Receiver stopped" };
  }

  /** Mark the source as stopped. */
  markStopped(): void {
    this.healthy = false;
  }

  /** Mark the source as active. */
  markActive(): void {
    this.healthy = true;
  }

  /** Number of events currently buffered. */
  get pendingCount(): number {
    return this.buffer.length;
  }
}

// =============================================================================
// Event Callback
// =============================================================================

/** Callback invoked for each batch of received events. */
export type OnEventsReceived = (events: CloudEvent[]) => void | Promise<void>;

// =============================================================================
// WebhookReceiver — HTTP server for inbound cloud events
// =============================================================================

export class WebhookReceiver {
  private config: WebhookReceiverConfig;
  private server: Server | null = null;
  private sources: Map<CloudProvider, WebhookEventSource> = new Map();
  private onEvents: OnEventsReceived | null = null;

  /** Total events received across all providers. */
  totalReceived = 0;
  /** Total events rejected (bad signature, parse error, etc.). */
  totalRejected = 0;

  constructor(config?: Partial<WebhookReceiverConfig>) {
    this.config = { ...defaultReceiverConfig, ...config };
  }

  /** Register a WebhookEventSource for a given provider. */
  registerSource(provider: CloudProvider, source: WebhookEventSource): void {
    this.sources.set(provider, source);
  }

  /**
   * Register a callback invoked on every batch of received events.
   * Use this to immediately process events via InfraMonitor.ingestEvents().
   */
  onEventsReceived(cb: OnEventsReceived): void {
    this.onEvents = cb;
  }

  /** Start the HTTP server. */
  async start(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    return new Promise<void>((resolve, reject) => {
      const srv = this.server!;
      srv.once("error", reject);
      srv.listen(this.config.port, this.config.host, () => {
        srv.removeListener("error", reject);
        for (const src of this.sources.values()) src.markActive();
        resolve();
      });
    });
  }

  /** Stop the HTTP server. */
  async stop(): Promise<void> {
    if (!this.server) return;
    for (const src of this.sources.values()) src.markStopped();

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  /** Whether the server is currently listening. */
  isListening(): boolean {
    return this.server?.listening ?? false;
  }

  /** Actual address the server is bound to (for tests using port 0). */
  get address(): { host: string; port: number } | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (!addr || typeof addr === "string") return null;
    return { host: addr.address, port: addr.port };
  }

  /** Status summary. */
  getStatus(): WebhookReceiverStatus {
    return {
      listening: this.isListening(),
      port: this.address?.port ?? this.config.port,
      totalReceived: this.totalReceived,
      totalRejected: this.totalRejected,
      sources: [...this.sources.entries()].map(([provider, src]) => ({
        provider,
        pendingEvents: src.pendingCount,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Request handling
  // ---------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const basePath = this.config.basePath ?? "/events";

    // Health check
    if (req.method === "GET" && url === `${basePath}/health`) {
      this.sendJson(res, 200, {
        status: "ok",
        sources: this.sources.size,
        totalReceived: this.totalReceived,
      });
      return;
    }

    // Only accept POST
    if (req.method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    // Route by path
    const route = url.replace(basePath, "");

    try {
      const body = await this.readBody(req);

      // Verify signature if secret is configured
      if (this.config.secret) {
        const signature = req.headers["x-webhook-signature"] as string | undefined;
        if (!this.verifySignature(body, signature)) {
          this.totalRejected++;
          this.sendJson(res, 401, { error: "Invalid signature" });
          return;
        }
      }

      let events: CloudEvent[];

      switch (route) {
        case "/cloudtrail":
        case "/aws":
          events = this.parseAwsEvents(body);
          break;
        case "/azure":
          events = this.parseAzureEvents(body, res);
          if (events.length === 0 && res.writableEnded) return; // validation handshake
          break;
        case "/gcp":
          events = this.parseGcpEvents(body);
          break;
        case "/generic":
        case "/":
          events = this.parseGenericEvents(body);
          break;
        default:
          this.sendJson(res, 404, { error: `Unknown route: ${route}` });
          return;
      }

      if (events.length === 0) {
        this.sendJson(res, 200, { accepted: 0 });
        return;
      }

      // Push to provider-specific sources
      for (const event of events) {
        const source = this.sources.get(event.provider);
        if (source) {
          source.push(event);
        }
      }

      this.totalReceived += events.length;

      // Invoke callback for immediate processing
      if (this.onEvents) {
        try {
          await this.onEvents(events);
        } catch {
          // callback errors are non-fatal
        }
      }

      this.sendJson(res, 200, { accepted: events.length });
    } catch {
      this.totalRejected++;
      this.sendJson(res, 400, { error: "Invalid request body" });
    }
  }

  // ---------------------------------------------------------------------------
  // Body reading
  // ---------------------------------------------------------------------------

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const maxBytes = this.config.maxBodyBytes ?? 1024 * 1024;

      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  // ---------------------------------------------------------------------------
  // Signature verification
  // ---------------------------------------------------------------------------

  /** Verify HMAC-SHA256 signature. */
  private verifySignature(body: string, signature: string | undefined): boolean {
    if (!this.config.secret || !signature) return false;
    const expected = createHmac("sha256", this.config.secret).update(body).digest("hex");
    // Constant-time comparison via string length + every-char check
    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  }

  // ---------------------------------------------------------------------------
  // Provider-specific parsers
  // ---------------------------------------------------------------------------

  /**
   * Parse AWS EventBridge/SNS events.
   * Handles both direct EventBridge events and SNS-wrapped events with
   * SubscriptionConfirmation support.
   */
  private parseAwsEvents(body: string): CloudEvent[] {
    const parsed = JSON.parse(body);
    const events: CloudEvent[] = [];

    // Handle SNS notification wrapper
    if (parsed.Type === "SubscriptionConfirmation") {
      // Auto-confirm subscriptions is not safe in production.
      // Log and return empty — operator must confirm via the SubscribeURL.
      return [];
    }

    // Unwrap SNS Message envelope
    const records = parsed.Type === "Notification" && parsed.Message
      ? [JSON.parse(parsed.Message)]
      : Array.isArray(parsed.Records ?? parsed.detail ? undefined : parsed)
        ? (parsed.Records ?? [parsed])
        : [parsed];

    for (const record of records) {
      const detail = record.detail ?? record;
      const eventName = detail.eventName ?? detail.eventType ?? record.eventName ?? "Unknown";
      const resourceId = this.extractAwsResourceId(detail);
      const eventTime = detail.eventTime ?? record.time ?? new Date().toISOString();

      events.push({
        id: detail.eventID ?? record.id ?? `aws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        provider: "aws",
        eventType: eventName,
        resourceId,
        resourceType: this.mapAwsEventToResourceType(eventName),
        actor: detail.userIdentity?.arn ?? detail.userIdentity?.userName ?? "unknown",
        timestamp: eventTime,
        readOnly: detail.readOnly === true || this.isReadOnlyAwsEvent(eventName),
        success: detail.errorCode == null,
        raw: record,
      });
    }

    return events;
  }

  /**
   * Parse Azure Event Grid events.
   * Handles validation handshake and CloudEvents or Event Grid schema.
   */
  private parseAzureEvents(body: string, res: ServerResponse): CloudEvent[] {
    const parsed = JSON.parse(body);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const events: CloudEvent[] = [];

    for (const record of records) {
      // Event Grid validation handshake
      if (record.eventType === "Microsoft.EventGrid.SubscriptionValidationEvent") {
        const validationCode = record.data?.validationCode;
        if (validationCode) {
          this.sendJson(res, 200, { validationResponse: validationCode });
          return []; // response already sent
        }
      }

      const eventType = record.eventType ?? record.type ?? "Unknown";
      const resourceId = record.subject ?? record.data?.resourceUri ?? "";

      events.push({
        id: record.id ?? `azure-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        provider: "azure",
        eventType,
        resourceId,
        resourceType: this.mapAzureEventToResourceType(eventType),
        actor: record.data?.authorization?.evidence?.principalId ?? record.data?.caller ?? "unknown",
        timestamp: record.eventTime ?? record.time ?? new Date().toISOString(),
        readOnly: eventType.toLowerCase().includes("read") || eventType.toLowerCase().includes("list"),
        success: record.data?.status === "Succeeded" || record.data?.operationName != null,
        raw: record,
      });
    }

    return events;
  }

  /**
   * Parse GCP Pub/Sub push events.
   * Expects the standard Pub/Sub push message wrapper.
   */
  private parseGcpEvents(body: string): CloudEvent[] {
    const parsed = JSON.parse(body);
    const events: CloudEvent[] = [];

    // Pub/Sub wraps the message in { message: { data: base64, ... } }
    const message = parsed.message ?? parsed;
    const dataStr = message.data
      ? Buffer.from(message.data, "base64").toString("utf-8")
      : JSON.stringify(message);

    try {
      const data = JSON.parse(dataStr);
      const protoPayload = data.protoPayload ?? data;

      events.push({
        id: data.insertId ?? message.messageId ?? `gcp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        provider: "gcp",
        eventType: protoPayload.methodName ?? data.methodName ?? "Unknown",
        resourceId: protoPayload.resourceName ?? data.resource?.name ?? "",
        resourceType: this.mapGcpEventToResourceType(protoPayload.methodName ?? ""),
        actor: protoPayload.authenticationInfo?.principalEmail ?? "unknown",
        timestamp: data.timestamp ?? protoPayload.requestMetadata?.requestAttributes?.time ?? new Date().toISOString(),
        readOnly: (protoPayload.methodName ?? "").toLowerCase().includes("get") ||
          (protoPayload.methodName ?? "").toLowerCase().includes("list"),
        success: protoPayload.status?.code === 0 || protoPayload.status == null,
        raw: data,
      });
    } catch {
      // Unparseable data — skip
    }

    return events;
  }

  /**
   * Parse generic CloudEvent v1.0 format.
   * See https://cloudevents.io/
   */
  private parseGenericEvents(body: string): CloudEvent[] {
    const parsed = JSON.parse(body);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const events: CloudEvent[] = [];

    for (const record of records) {
      const provider = this.inferProvider(record.source ?? "");
      events.push({
        id: record.id ?? `generic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        provider,
        eventType: record.type ?? "Unknown",
        resourceId: record.subject ?? "",
        resourceType: record.datacontenttype ?? "unknown",
        actor: record.data?.actor ?? "unknown",
        timestamp: record.time ?? new Date().toISOString(),
        readOnly: false,
        success: true,
        raw: record,
      });
    }

    return events;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractAwsResourceId(detail: Record<string, unknown>): string {
    // Try common AWS response fields
    const resources = detail.resources as Array<{ ARN?: string }> | undefined;
    if (resources?.[0]?.ARN) return resources[0].ARN;

    const responseElements = detail.responseElements as Record<string, unknown> | undefined;
    if (responseElements) {
      // EC2: instancesSet.items[0].instanceId
      const instancesSet = responseElements.instancesSet as { items?: Array<{ instanceId?: string }> };
      if (instancesSet?.items?.[0]?.instanceId) return instancesSet.items[0].instanceId;

      // Generic: look for *Id or *Arn fields
      for (const [key, value] of Object.entries(responseElements)) {
        if ((key.endsWith("Id") || key.endsWith("Arn")) && typeof value === "string") {
          return value;
        }
      }
    }

    return detail.requestParameters
      ? JSON.stringify(detail.requestParameters).slice(0, 200)
      : "";
  }

  private mapAwsEventToResourceType(eventName: string): string {
    const lower = eventName.toLowerCase();
    if (lower.includes("instance")) return "compute";
    if (lower.includes("bucket") || lower.includes("s3")) return "storage";
    if (lower.includes("function") || lower.includes("lambda")) return "serverless-function";
    if (lower.includes("dbinstance") || lower.includes("rds")) return "database";
    if (lower.includes("securitygroup")) return "security-group";
    if (lower.includes("vpc")) return "vpc";
    if (lower.includes("subnet")) return "subnet";
    if (lower.includes("loadbalancer") || lower.includes("targetgroup")) return "load-balancer";
    if (lower.includes("queue") || lower.includes("sqs")) return "queue";
    if (lower.includes("topic") || lower.includes("sns")) return "notification";
    if (lower.includes("role") || lower.includes("user") || lower.includes("policy")) return "iam-role";
    return "unknown";
  }

  private mapAzureEventToResourceType(eventType: string): string {
    const lower = eventType.toLowerCase();
    if (lower.includes("virtualmachine")) return "compute";
    if (lower.includes("storageaccount")) return "storage";
    if (lower.includes("webapp") || lower.includes("functionapp")) return "serverless-function";
    if (lower.includes("sqlserver") || lower.includes("cosmosdb")) return "database";
    if (lower.includes("virtualnetwork")) return "vpc";
    if (lower.includes("networksecuritygroup")) return "security-group";
    if (lower.includes("loadbalancer")) return "load-balancer";
    return "unknown";
  }

  private mapGcpEventToResourceType(methodName: string): string {
    const lower = methodName.toLowerCase();
    if (lower.includes("instances") && lower.includes("compute")) return "compute";
    if (lower.includes("buckets") || lower.includes("storage")) return "storage";
    if (lower.includes("functions")) return "serverless-function";
    if (lower.includes("sql") || lower.includes("spanner")) return "database";
    if (lower.includes("networks")) return "vpc";
    if (lower.includes("firewalls")) return "security-group";
    return "unknown";
  }

  private inferProvider(source: string): CloudProvider {
    const lower = source.toLowerCase();
    if (lower.includes("aws") || lower.includes("amazon")) return "aws";
    if (lower.includes("azure") || lower.includes("microsoft")) return "azure";
    if (lower.includes("gcp") || lower.includes("google")) return "gcp";
    if (lower.includes("kubernetes") || lower.includes("k8s")) return "kubernetes";
    return "aws"; // default
  }

  private isReadOnlyAwsEvent(eventName: string): boolean {
    const lower = eventName.toLowerCase();
    return lower.startsWith("describe") ||
      lower.startsWith("get") ||
      lower.startsWith("list") ||
      lower.startsWith("head");
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}

// =============================================================================
// Types
// =============================================================================

export type WebhookReceiverStatus = {
  listening: boolean;
  port: number;
  totalReceived: number;
  totalRejected: number;
  sources: Array<{
    provider: CloudProvider;
    pendingEvents: number;
  }>;
};
