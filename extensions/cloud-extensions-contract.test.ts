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
