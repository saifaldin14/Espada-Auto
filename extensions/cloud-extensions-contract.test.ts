/**
 * Cloud Infrastructure Extensions — Enterprise Contract Tests
 *
 * Validates that Kubernetes, Terraform, Pulumi extensions:
 * 1. Register the expected gateway methods (including status/reset)
 * 2. Handle errors consistently via try/catch → respond(false, { error })
 * 3. Track diagnostics counters correctly
 * 4. Shared input validation helpers work correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createApiMock,
  invokeGateway,
  type GatewayHandler,
} from "./test-utils/small-extension-contract-helpers.js";

// ─────────────────────────────────────────────────────────────────────────
// Kubernetes
// ─────────────────────────────────────────────────────────────────────────
describe("kubernetes — enterprise gateway contracts", () => {
  let gateways: Map<string, GatewayHandler>;

  beforeEach(async () => {
    vi.resetModules();
    const { api, gatewayMethods } = createApiMock();
    gateways = gatewayMethods;

    const mod = await import("./kubernetes/index.js");
    mod.default.register(api);
  });

  it("registers k8s/status and k8s/diagnostics/reset gateways", () => {
    expect(gateways.has("k8s/status")).toBe(true);
    expect(gateways.has("k8s/diagnostics/reset")).toBe(true);
  });

  it("registers all expected gateway methods", () => {
    const expected = ["k8s/resources", "k8s/namespaces", "k8s/status", "k8s/diagnostics/reset"];
    for (const name of expected) {
      expect(gateways.has(name), `missing: ${name}`).toBe(true);
    }
  });

  it("k8s/status returns operational with zero counters initially", async () => {
    const { success, payload } = await invokeGateway(gateways, "k8s/status");
    const data = payload as Record<string, unknown>;
    expect(success).toBe(true);
    expect(data.status).toBe("operational");
    expect(data.gatewayAttempts).toBe(0);
    expect(data.gatewaySuccesses).toBe(0);
    expect(data.gatewayFailures).toBe(0);
  });

  it("k8s/diagnostics/reset clears counters", async () => {
    const { success, payload } = await invokeGateway(gateways, "k8s/diagnostics/reset");
    expect(success).toBe(true);
    expect((payload as Record<string, unknown>).reset).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pulumi
// ─────────────────────────────────────────────────────────────────────────
describe("pulumi — enterprise gateway contracts", () => {
  let gateways: Map<string, GatewayHandler>;

  beforeEach(async () => {
    vi.resetModules();
    const { api, gatewayMethods } = createApiMock();
    gateways = gatewayMethods;

    const mod = await import("./pulumi/index.js");
    mod.default.register(api);
  });

  it("registers all expected gateway methods", () => {
    const expected = ["pulumi/stacks", "pulumi/state", "pulumi/status", "pulumi/diagnostics/reset"];
    for (const name of expected) {
      expect(gateways.has(name), `missing: ${name}`).toBe(true);
    }
  });

  it("pulumi/status returns operational with zero counters initially", async () => {
    const { success, payload } = await invokeGateway(gateways, "pulumi/status");
    const data = payload as Record<string, unknown>;
    expect(success).toBe(true);
    expect(data.status).toBe("operational");
    expect(data.gatewayAttempts).toBe(0);
    expect(data.gatewayFailures).toBe(0);
  });

  it("pulumi/diagnostics/reset clears counters", async () => {
    const { success, payload } = await invokeGateway(gateways, "pulumi/diagnostics/reset");
    expect(success).toBe(true);
    expect((payload as Record<string, unknown>).reset).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Terraform
// ─────────────────────────────────────────────────────────────────────────
describe("terraform — enterprise gateway contracts", () => {
  let gateways: Map<string, GatewayHandler>;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ESPADA_TEST = "1";

    const { api, gatewayMethods } = createApiMock();
    gateways = gatewayMethods;

    const mod = await import("./terraform/index.js");
    mod.default.register(api);
  });

  it("registers all expected gateway methods", () => {
    const expected = [
      "terraform/workspaces",
      "terraform/lock",
      "terraform/drift-history",
      "terraform/exec-init",
      "terraform/exec-plan",
      "terraform/exec-apply",
      "terraform/exec-destroy",
      "terraform/exec-state-list",
      "terraform/exec-state-pull",
      "terraform/exec-version",
      "terraform/status",
      "terraform/diagnostics/reset",
    ];
    for (const name of expected) {
      expect(gateways.has(name), `missing: ${name}`).toBe(true);
    }
  });

  it("terraform/status returns operational with zero counters initially", async () => {
    const { success, payload } = await invokeGateway(gateways, "terraform/status");
    const data = payload as Record<string, unknown>;
    expect(success).toBe(true);
    expect(data.status).toBe("operational");
    expect(data.gatewayAttempts).toBe(0);
    expect(data.execAttempts).toBe(0);
  });

  it("terraform/diagnostics/reset clears all counters including exec", async () => {
    const { success, payload } = await invokeGateway(gateways, "terraform/diagnostics/reset");
    expect(success).toBe(true);
    expect((payload as Record<string, unknown>).reset).toBe(true);

    // After reset, verify all counters are zero
    const { payload: statusPayload } = await invokeGateway(gateways, "terraform/status");
    const data = statusPayload as Record<string, unknown>;
    expect(data.gatewayAttempts).toBe(0);
    expect(data.execAttempts).toBe(0);
    expect(data.lastError).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Input Validation
// ─────────────────────────────────────────────────────────────────────────
describe("cloud-utils/input-validation", () => {
  let validation: typeof import("./cloud-utils/input-validation.js");

  beforeEach(async () => {
    validation = await import("./cloud-utils/input-validation.js");
  });

  describe("validateCwdPath", () => {
    it("rejects path traversal", () => {
      expect(validation.validateCwdPath("../secret").valid).toBe(false);
      expect(validation.validateCwdPath("/etc/passwd").valid).toBe(false);
      expect(validation.validateCwdPath("/proc/self").valid).toBe(false);
    });

    it("accepts normal relative paths", () => {
      expect(validation.validateCwdPath("./my-terraform").valid).toBe(true);
      expect(validation.validateCwdPath("infra/staging").valid).toBe(true);
    });

    it("rejects null bytes", () => {
      expect(validation.validateCwdPath("foo\0bar").valid).toBe(false);
    });

    it("rejects empty strings", () => {
      expect(validation.validateCwdPath("").valid).toBe(false);
    });
  });

  describe("validateK8sResourceName", () => {
    it("accepts valid names", () => {
      expect(validation.validateK8sResourceName("my-pod").valid).toBe(true);
      expect(validation.validateK8sResourceName("nginx-deployment").valid).toBe(true);
    });

    it("rejects uppercase", () => {
      expect(validation.validateK8sResourceName("MyPod").valid).toBe(false);
    });

    it("rejects names starting with hyphen", () => {
      expect(validation.validateK8sResourceName("-bad").valid).toBe(false);
    });

    it("validates namespace length <= 63", () => {
      const long = "a".repeat(64);
      expect(validation.validateK8sResourceName(long, "namespace").valid).toBe(false);
      expect(validation.validateK8sResourceName("a".repeat(63), "namespace").valid).toBe(true);
    });
  });

  describe("validateAwsProfileName", () => {
    it("accepts valid profile names", () => {
      expect(validation.validateAwsProfileName("default-sso").valid).toBe(true);
      expect(validation.validateAwsProfileName("my_profile.v2").valid).toBe(true);
    });

    it("rejects shell metacharacters", () => {
      expect(validation.validateAwsProfileName("foo; rm -rf /").valid).toBe(false);
      expect(validation.validateAwsProfileName("$(whoami)").valid).toBe(false);
      expect(validation.validateAwsProfileName("foo`cmd`").valid).toBe(false);
    });
  });

  describe("sanitizeCliArg", () => {
    it("prefixes dash-starting args to prevent flag injection", () => {
      expect(validation.sanitizeCliArg("--kubeconfig=/etc/k8s")).toBe("./--kubeconfig=/etc/k8s");
    });

    it("strips null bytes", () => {
      expect(validation.sanitizeCliArg("foo\0bar")).toBe("foobar");
    });

    it("passes normal args through", () => {
      expect(validation.sanitizeCliArg("my-deployment")).toBe("my-deployment");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Shared Circuit Breaker
// ─────────────────────────────────────────────────────────────────────────
describe("cloud-utils/circuit-breaker", () => {
  let cb: typeof import("./cloud-utils/circuit-breaker.js");

  beforeEach(async () => {
    cb = await import("./cloud-utils/circuit-breaker.js");
  });

  it("CircuitBreaker starts closed", () => {
    const breaker = new cb.CircuitBreaker("test");
    expect(breaker.state).toBe("closed");
    expect(breaker.canExecute()).toBe(true);
  });

  it("opens after failureThreshold consecutive trippable failures", () => {
    const breaker = new cb.CircuitBreaker("test", {
      failureThreshold: 3,
      shouldTrip: () => true,
    });
    for (let i = 0; i < 3; i++) breaker.recordFailure(new Error("fail"));
    expect(breaker.state).toBe("open");
    expect(breaker.canExecute()).toBe(false);
  });

  it("rejects with CircuitOpenError when open", async () => {
    const breaker = new cb.CircuitBreaker("test", {
      failureThreshold: 1,
      shouldTrip: () => true,
    });
    breaker.recordFailure(new Error("fail"));
    expect(breaker.state).toBe("open");

    await expect(breaker.execute(() => Promise.resolve("ok"))).rejects.toThrow(
      cb.CircuitOpenError,
    );
  });

  it("snapshot tracks counters correctly", () => {
    const breaker = new cb.CircuitBreaker("snap-test", {
      shouldTrip: () => true,
    });
    breaker.recordSuccess();
    breaker.recordSuccess();
    breaker.recordFailure(new Error("x"));
    const snap = breaker.snapshot();
    expect(snap.name).toBe("snap-test");
    expect(snap.totalSuccesses).toBe(2);
    expect(snap.totalFailures).toBe(1);
    expect(snap.failures).toBe(1);
  });

  it("reset clears all counters", () => {
    const breaker = new cb.CircuitBreaker("reset-test", {
      failureThreshold: 1,
      shouldTrip: () => true,
    });
    breaker.recordFailure(new Error("x"));
    expect(breaker.state).toBe("open");
    breaker.reset();
    expect(breaker.state).toBe("closed");
    expect(breaker.snapshot().totalFailures).toBe(0);
  });

  it("createProviderBreakerRegistry scopes breakers by prefix", () => {
    const reg = cb.createProviderBreakerRegistry({
      prefix: "test",
      label: "Test",
    });
    const b1 = reg.getServiceBreaker("svc1");
    const b2 = reg.getServiceBreaker("svc1", "scope-a");
    expect(b1.name).toBe("test:svc1");
    expect(b2.name).toBe("test:svc1:scope-a");
    expect(reg.isServiceAvailable("svc1")).toBe(true);
    expect(reg.getSnapshots()).toHaveLength(2);
  });

  it("createProviderBreakerRegistry healthSummary works", () => {
    const reg = cb.createProviderBreakerRegistry({
      prefix: "h",
      label: "H",
      defaultShouldTrip: () => true,
    });
    const b = reg.getServiceBreaker("svc");
    // Force open
    b.forceOpen();
    const summary = reg.getHealthSummary();
    expect(summary.hasOpenCircuits).toBe(true);
    expect(summary.open).toContain("h:svc");
    reg.resetAll();
    expect(reg.getSnapshots()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Shared Diagnostic Emitter
// ─────────────────────────────────────────────────────────────────────────
describe("cloud-utils/diagnostics", () => {
  let diag: typeof import("./cloud-utils/diagnostics.js");

  beforeEach(async () => {
    diag = await import("./cloud-utils/diagnostics.js");
  });

  it("DiagnosticEmitter does not emit when disabled", () => {
    const emitter = new diag.DiagnosticEmitter();
    const events: unknown[] = [];
    emitter.on((e) => events.push(e));
    emitter.emit({ type: "test", service: "svc", operation: "op" } as any);
    expect(events).toHaveLength(0);
  });

  it("DiagnosticEmitter emits with auto timestamp and seq", () => {
    const emitter = new diag.DiagnosticEmitter();
    emitter.enable();
    const events: any[] = [];
    emitter.on((e) => events.push(e));
    emitter.emit({ type: "test.call", service: "svc", operation: "list" } as any);
    emitter.emit({ type: "test.call", service: "svc", operation: "get" } as any);
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it("on returns unsubscribe function", () => {
    const emitter = new diag.DiagnosticEmitter();
    emitter.enable();
    const events: unknown[] = [];
    const unsub = emitter.on((e) => events.push(e));
    emitter.emit({ type: "x", service: "s", operation: "o" } as any);
    expect(events).toHaveLength(1);
    unsub();
    emitter.emit({ type: "x", service: "s", operation: "o" } as any);
    expect(events).toHaveLength(1);
  });

  it("instrument emits success and error events", async () => {
    const emitter = new diag.DiagnosticEmitter();
    emitter.enable();
    const events: any[] = [];
    emitter.on((e) => events.push(e));

    // Success case
    const result = await emitter.instrument(
      "test.call", "test.error", "svc", "list",
      async () => "ok",
    );
    expect(result).toBe("ok");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("test.call");
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);

    // Error case
    await expect(
      emitter.instrument(
        "test.call", "test.error", "svc", "fail",
        async () => { throw new Error("boom"); },
      ),
    ).rejects.toThrow("boom");
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe("test.error");
    expect(events[1].error).toBe("boom");
  });

  it("reset clears all state", () => {
    const emitter = new diag.DiagnosticEmitter();
    emitter.enable();
    expect(emitter.enabled).toBe(true);
    emitter.reset();
    expect(emitter.enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Terraform cwd validation wiring
// ─────────────────────────────────────────────────────────────────────────
describe("terraform — cwd input validation wiring", () => {
  let gateways: Map<string, GatewayHandler>;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ESPADA_TEST = "1";
    const { api, gatewayMethods } = createApiMock();
    gateways = gatewayMethods;
    const mod = await import("./terraform/index.js");
    mod.default.register(api);
  });

  it("terraform/exec-init rejects path traversal cwd", async () => {
    const { success, payload } = await invokeGateway(gateways, "terraform/exec-init", { cwd: "../etc/shadow" });
    expect(success).toBe(false);
    expect((payload as Record<string, unknown>).error).toMatch(/forbidden pattern/);
  });

  it("terraform/exec-plan rejects /proc cwd", async () => {
    const { success, payload } = await invokeGateway(gateways, "terraform/exec-plan", { cwd: "/proc/self" });
    expect(success).toBe(false);
    expect((payload as Record<string, unknown>).error).toMatch(/forbidden pattern/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// K8s namespace validation wiring
// ─────────────────────────────────────────────────────────────────────────
describe("kubernetes — namespace input validation wiring", () => {
  let gateways: Map<string, GatewayHandler>;

  beforeEach(async () => {
    vi.resetModules();
    const { api, gatewayMethods } = createApiMock();
    gateways = gatewayMethods;
    const mod = await import("./kubernetes/index.js");
    mod.default.register(api);
  });

  it("k8s/resources rejects invalid namespace names", async () => {
    const { success, payload } = await invokeGateway(gateways, "k8s/resources", {
      resource: "pods",
      namespace: "Bad-Namespace!",
    });
    expect(success).toBe(false);
    expect((payload as Record<string, unknown>).error).toMatch(/RFC 1123/);
  });
});
