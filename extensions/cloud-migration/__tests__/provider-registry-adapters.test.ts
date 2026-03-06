/**
 * Cross-Cloud Migration Engine — Provider Registry Tests
 *
 * Tests the provider registry:
 * - isSupported for all 6 providers
 * - resolveAdapter returning correct adapter type
 * - Adapter caching (same credentials → same instance)
 * - Clear / reset behaviour
 * - Credential key generation
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  getProviderRegistry,
  resetProviderRegistry,
  resolveProviderAdapter,
} from "../src/providers/registry.js";

import type {
  AWSCredentialConfig,
  AzureCredentialConfig,
  GCPCredentialConfig,
  VMwareCredentialConfig,
  NutanixCredentialConfig,
  OnPremCredentialConfig,
} from "../src/providers/types.js";

// =============================================================================
// Fixtures
// =============================================================================

const awsCreds: AWSCredentialConfig = {
  provider: "aws",
  region: "us-east-1",
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
};

const azureCreds: AzureCredentialConfig = {
  provider: "azure",
  subscriptionId: "sub-1",
  tenantId: "tenant-1",
  clientId: "client-1",
  clientSecret: "secret",
};

const gcpCreds: GCPCredentialConfig = {
  provider: "gcp",
  projectId: "my-project",
  keyFilePath: "/path/to/key.json",
};

const vmwareCreds: VMwareCredentialConfig = {
  provider: "vmware",
  vcenterHost: "vcenter.local",
  username: "admin",
  authType: "password",
  password: "pass",
  datacenter: "dc-1",
};

const nutanixCreds: NutanixCredentialConfig = {
  provider: "nutanix",
  prismHost: "prism.local",
  username: "admin",
  authType: "password",
  password: "pass",
  clusterUuid: "cluster-1",
};

const onPremCreds: OnPremCredentialConfig = {
  provider: "on-premises",
  platform: "kvm",
  agentEndpoint: {
    host: "10.0.0.1",
    port: 8443,
    apiKey: "key-1",
    protocol: "https",
  },
  stagingStorage: {
    endpoint: "http://minio.local:9000",
    accessKeyId: "minio",
    secretAccessKey: "minio123",
    bucket: "staging",
  },
};

// =============================================================================
// Tests
// =============================================================================

describe("providers/registry — isSupported", () => {
  beforeEach(() => { resetProviderRegistry(); });

  it("supports AWS", () => {
    expect(getProviderRegistry().isSupported("aws")).toBe(true);
  });

  it("supports Azure", () => {
    expect(getProviderRegistry().isSupported("azure")).toBe(true);
  });

  it("supports GCP", () => {
    expect(getProviderRegistry().isSupported("gcp")).toBe(true);
  });

  it("supports VMware", () => {
    expect(getProviderRegistry().isSupported("vmware")).toBe(true);
  });

  it("supports Nutanix", () => {
    expect(getProviderRegistry().isSupported("nutanix")).toBe(true);
  });

  it("supports on-premises", () => {
    expect(getProviderRegistry().isSupported("on-premises")).toBe(true);
  });

  it("rejects unknown provider", () => {
    expect(getProviderRegistry().isSupported("alien-cloud" as any)).toBe(false);
  });
});

describe("providers/registry — resolveAdapter", () => {
  beforeEach(() => { resetProviderRegistry(); });

  it("resolves AWS adapter", async () => {
    const adapter = await resolveProviderAdapter("aws", awsCreds);
    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
    expect(adapter.storage).toBeDefined();
    expect(adapter.healthCheck).toBeDefined();
  });

  it("resolves Azure adapter", async () => {
    const adapter = await resolveProviderAdapter("azure", azureCreds);
    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
    expect(adapter.storage).toBeDefined();
  });

  it("resolves GCP adapter", async () => {
    const adapter = await resolveProviderAdapter("gcp", gcpCreds);
    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
  });

  it("resolves VMware adapter", async () => {
    const adapter = await resolveProviderAdapter("vmware", vmwareCreds);
    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
    expect(adapter.storage).toBeDefined();
    expect(adapter.dns).toBeDefined();
    expect(adapter.network).toBeDefined();
  });

  it("resolves Nutanix adapter", async () => {
    const adapter = await resolveProviderAdapter("nutanix", nutanixCreds);
    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
    expect(adapter.storage).toBeDefined();
  });

  it("resolves on-premises adapter", async () => {
    const adapter = await resolveProviderAdapter("on-premises", onPremCreds);
    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
    expect(adapter.storage).toBeDefined();
  });

  it("throws for unknown provider", async () => {
    await expect(
      resolveProviderAdapter("alien-cloud" as any, {} as any),
    ).rejects.toThrow("Unknown migration provider");
  });
});

describe("providers/registry — caching", () => {
  beforeEach(() => { resetProviderRegistry(); });

  it("caches and returns same instance for same credentials", async () => {
    const adapter1 = await resolveProviderAdapter("aws", awsCreds);
    const adapter2 = await resolveProviderAdapter("aws", awsCreds);
    expect(adapter1).toBe(adapter2);
    expect(getProviderRegistry().size).toBe(1);
  });

  it("creates separate instances for different credentials", async () => {
    const creds1: AWSCredentialConfig = { ...awsCreds, region: "us-east-1" };
    const creds2: AWSCredentialConfig = { ...awsCreds, region: "eu-west-1" };

    const adapter1 = await resolveProviderAdapter("aws", creds1);
    const adapter2 = await resolveProviderAdapter("aws", creds2);

    expect(adapter1).not.toBe(adapter2);
    expect(getProviderRegistry().size).toBe(2);
  });

  it("creates separate instances for different providers", async () => {
    await resolveProviderAdapter("aws", awsCreds);
    await resolveProviderAdapter("azure", azureCreds);
    await resolveProviderAdapter("gcp", gcpCreds);
    await resolveProviderAdapter("vmware", vmwareCreds);
    await resolveProviderAdapter("nutanix", nutanixCreds);
    await resolveProviderAdapter("on-premises", onPremCreds);

    expect(getProviderRegistry().size).toBe(6);
  });
});

describe("providers/registry — clear and reset", () => {
  beforeEach(() => { resetProviderRegistry(); });

  it("clear removes all cached adapters", async () => {
    await resolveProviderAdapter("aws", awsCreds);
    await resolveProviderAdapter("azure", azureCreds);

    expect(getProviderRegistry().size).toBe(2);
    getProviderRegistry().clear();
    expect(getProviderRegistry().size).toBe(0);
  });

  it("resetProviderRegistry creates a fresh registry", async () => {
    await resolveProviderAdapter("aws", awsCreds);
    expect(getProviderRegistry().size).toBe(1);

    resetProviderRegistry();

    // After reset, size is 0 (new registry)
    expect(getProviderRegistry().size).toBe(0);
  });
});

describe("providers/registry — adapter contracts", () => {
  beforeEach(() => { resetProviderRegistry(); });

  it("VMware adapter has correct sub-adapter shapes", async () => {
    const adapter = await resolveProviderAdapter("vmware", vmwareCreds);

    // compute
    expect(typeof adapter.compute.listVMs).toBe("function");
    expect(typeof adapter.compute.getVM).toBe("function");
    expect(typeof adapter.compute.createSnapshot).toBe("function");
    expect(typeof adapter.compute.exportImage).toBe("function");
    expect(typeof adapter.compute.importImage).toBe("function");

    // storage
    expect(typeof adapter.storage.listBuckets).toBe("function");
    expect(typeof adapter.storage.createBucket).toBe("function");
    expect(typeof adapter.storage.listObjects).toBe("function");

    // dns
    expect(typeof adapter.dns.listZones).toBe("function");
    expect(typeof adapter.dns.listRecords).toBe("function");

    // network
    expect(typeof adapter.network.listVPCs).toBe("function");
    expect(typeof adapter.network.listSecurityGroups).toBe("function");
  });

  it("Nutanix adapter has correct sub-adapter shapes", async () => {
    const adapter = await resolveProviderAdapter("nutanix", nutanixCreds);

    expect(typeof adapter.compute.listVMs).toBe("function");
    expect(typeof adapter.compute.getVM).toBe("function");
    expect(typeof adapter.storage.listBuckets).toBe("function");
    expect(typeof adapter.dns.listZones).toBe("function");
    expect(typeof adapter.network.listVPCs).toBe("function");
  });

  it("on-premises adapter has correct sub-adapter shapes", async () => {
    const adapter = await resolveProviderAdapter("on-premises", onPremCreds);

    expect(typeof adapter.compute.listVMs).toBe("function");
    expect(typeof adapter.compute.getVM).toBe("function");
    expect(typeof adapter.storage.listBuckets).toBe("function");
    expect(typeof adapter.dns.listZones).toBe("function");
    expect(typeof adapter.network.listVPCs).toBe("function");
  });

  it("all adapters expose a healthCheck function", async () => {
    const providers = [
      { p: "aws" as const, c: awsCreds },
      { p: "azure" as const, c: azureCreds },
      { p: "gcp" as const, c: gcpCreds },
      { p: "vmware" as const, c: vmwareCreds },
      { p: "nutanix" as const, c: nutanixCreds },
      { p: "on-premises" as const, c: onPremCreds },
    ];

    for (const { p, c } of providers) {
      const adapter = await resolveProviderAdapter(p, c);
      expect(typeof adapter.healthCheck).toBe("function");
    }
  });
});
