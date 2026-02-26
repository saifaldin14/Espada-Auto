import { describe, it, expect, vi, beforeEach } from "vitest";
import { GcpComputeManager, createComputeManager } from "./index.js";
import { gcpRequest, gcpList, gcpAggregatedList, gcpMutate } from "../api.js";

vi.mock("../api.js", () => ({
  gcpRequest: vi.fn(),
  gcpList: vi.fn(),
  gcpAggregatedList: vi.fn(),
  gcpMutate: vi.fn(),
  shortName: (s: string) => s.split("/").pop() ?? s,
}));

vi.mock("../retry.js", () => ({
  withGcpRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const PROJECT = "test-project";
const TOKEN = "tok_test";
const getToken = vi.fn(async () => TOKEN);

function makeManager() {
  return new GcpComputeManager(PROJECT, getToken);
}

/** Minimal raw instance payload as the API would return. */
function rawInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "vm-1",
    zone: "projects/test-project/zones/us-central1-a",
    machineType: "projects/test-project/zones/us-central1-a/machineTypes/n1-standard-1",
    status: "RUNNING",
    networkInterfaces: [
      {
        network: "global/networks/default",
        networkIP: "10.0.0.2",
        accessConfigs: [{ name: "External NAT", natIP: "35.1.2.3", type: "ONE_TO_ONE_NAT" }],
      },
    ],
    disks: [
      { deviceName: "boot-disk", source: "projects/test-project/zones/us-central1-a/disks/boot-disk", boot: true, autoDelete: true, diskSizeGb: 50 },
    ],
    labels: { env: "dev" },
    creationTimestamp: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function rawMachineType(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "n1-standard-1", description: "1 vCPU, 3.75 GB RAM", guestCpus: 1, memoryMb: 3840, ...overrides };
}

function rawDisk(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "disk-1",
    zone: "projects/test-project/zones/us-central1-a",
    sizeGb: 100,
    type: "projects/test-project/zones/us-central1-a/diskTypes/pd-ssd",
    status: "READY",
    sourceImage: "projects/debian-cloud/global/images/debian-11",
    ...overrides,
  };
}

const opResult = { name: "op-123", status: "RUNNING", targetLink: "" };

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// listInstances
// =============================================================================

describe("listInstances", () => {
  it("uses gcpList when a zone is specified", async () => {
    vi.mocked(gcpList).mockResolvedValue([rawInstance()]);
    const mgr = makeManager();
    const result = await mgr.listInstances({ zone: "us-central1-a" });

    expect(gcpList).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances`,
      TOKEN,
      "items",
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("vm-1");
  });

  it("uses gcpAggregatedList when no zone is given", async () => {
    vi.mocked(gcpAggregatedList).mockResolvedValue([rawInstance()]);
    const mgr = makeManager();
    const result = await mgr.listInstances();

    expect(gcpAggregatedList).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/aggregated/instances`,
      TOKEN,
      "instances",
    );
    expect(result).toHaveLength(1);
  });

  it("maps raw instance fields correctly", async () => {
    vi.mocked(gcpList).mockResolvedValue([rawInstance()]);
    const mgr = makeManager();
    const [inst] = await mgr.listInstances({ zone: "us-central1-a" });

    expect(inst).toEqual({
      name: "vm-1",
      zone: "us-central1-a",
      machineType: "n1-standard-1",
      status: "RUNNING",
      networkInterfaces: [
        {
          network: "global/networks/default",
          networkIP: "10.0.0.2",
          subnetwork: undefined,
          accessConfigs: [{ name: "External NAT", natIP: "35.1.2.3", type: "ONE_TO_ONE_NAT" }],
        },
      ],
      disks: [{ deviceName: "boot-disk", source: "projects/test-project/zones/us-central1-a/disks/boot-disk", boot: true, autoDelete: true, sizeGb: 50 }],
      labels: { env: "dev" },
      createdAt: "2025-01-01T00:00:00Z",
    });
  });

  it("returns empty array when no instances exist", async () => {
    vi.mocked(gcpList).mockResolvedValue([]);
    const mgr = makeManager();
    expect(await mgr.listInstances({ zone: "us-east1-b" })).toEqual([]);
  });
});

// =============================================================================
// getInstance
// =============================================================================

describe("getInstance", () => {
  it("returns a mapped instance", async () => {
    vi.mocked(gcpRequest).mockResolvedValue(rawInstance());
    const mgr = makeManager();
    const inst = await mgr.getInstance("us-central1-a", "vm-1");

    expect(gcpRequest).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances/vm-1`,
      TOKEN,
    );
    expect(inst.name).toBe("vm-1");
    expect(inst.zone).toBe("us-central1-a");
    expect(inst.machineType).toBe("n1-standard-1");
  });
});

// =============================================================================
// Mutation methods: start / stop / reset / delete
// =============================================================================

describe("startInstance", () => {
  it("sends POST to the start endpoint", async () => {
    vi.mocked(gcpMutate).mockResolvedValue(opResult);
    const mgr = makeManager();
    await mgr.startInstance("us-central1-a", "vm-1");

    expect(gcpMutate).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances/vm-1/start`,
      TOKEN,
      {},
      "POST",
    );
  });
});

describe("stopInstance", () => {
  it("sends POST to the stop endpoint", async () => {
    vi.mocked(gcpMutate).mockResolvedValue(opResult);
    const mgr = makeManager();
    await mgr.stopInstance("us-central1-a", "vm-1");

    expect(gcpMutate).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances/vm-1/stop`,
      TOKEN,
      {},
      "POST",
    );
  });
});

describe("resetInstance", () => {
  it("sends POST to the reset endpoint", async () => {
    vi.mocked(gcpMutate).mockResolvedValue(opResult);
    const mgr = makeManager();
    await mgr.resetInstance("us-central1-a", "vm-1");

    expect(gcpMutate).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances/vm-1/reset`,
      TOKEN,
      {},
      "POST",
    );
  });
});

describe("deleteInstance", () => {
  it("sends DELETE to the instance endpoint", async () => {
    vi.mocked(gcpMutate).mockResolvedValue(opResult);
    const mgr = makeManager();
    await mgr.deleteInstance("us-central1-a", "vm-1");

    expect(gcpMutate).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances/vm-1`,
      TOKEN,
      {},
      "DELETE",
    );
  });
});

// =============================================================================
// listMachineTypes
// =============================================================================

describe("listMachineTypes", () => {
  it("lists and maps machine types", async () => {
    vi.mocked(gcpList).mockResolvedValue([rawMachineType(), rawMachineType({ name: "e2-micro", guestCpus: 2, memoryMb: 1024 })]);
    const mgr = makeManager();
    const types = await mgr.listMachineTypes("us-central1-a");

    expect(gcpList).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/machineTypes`,
      TOKEN,
      "items",
    );
    expect(types).toHaveLength(2);
    expect(types[0]).toEqual({ name: "n1-standard-1", description: "1 vCPU, 3.75 GB RAM", guestCpus: 1, memoryMb: 3840 });
    expect(types[1].guestCpus).toBe(2);
  });
});

// =============================================================================
// listDisks
// =============================================================================

describe("listDisks", () => {
  it("uses gcpList when a zone is specified", async () => {
    vi.mocked(gcpList).mockResolvedValue([rawDisk()]);
    const mgr = makeManager();
    const disks = await mgr.listDisks({ zone: "us-central1-a" });

    expect(gcpList).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/us-central1-a/disks`,
      TOKEN,
      "items",
    );
    expect(disks).toHaveLength(1);
    expect(disks[0]).toEqual({
      name: "disk-1",
      zone: "us-central1-a",
      sizeGb: 100,
      type: "pd-ssd",
      status: "READY",
      sourceImage: "projects/debian-cloud/global/images/debian-11",
    });
  });

  it("uses gcpAggregatedList when no zone is given", async () => {
    vi.mocked(gcpAggregatedList).mockResolvedValue([rawDisk()]);
    const mgr = makeManager();
    await mgr.listDisks();

    expect(gcpAggregatedList).toHaveBeenCalledWith(
      `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/aggregated/disks`,
      TOKEN,
      "disks",
    );
  });

  it("returns empty array when no disks exist", async () => {
    vi.mocked(gcpAggregatedList).mockResolvedValue([]);
    const mgr = makeManager();
    expect(await mgr.listDisks()).toEqual([]);
  });
});

// =============================================================================
// createComputeManager factory
// =============================================================================

describe("createComputeManager", () => {
  it("returns a GcpComputeManager instance", () => {
    const mgr = createComputeManager(PROJECT, getToken);
    expect(mgr).toBeInstanceOf(GcpComputeManager);
  });

  it("accepts optional retry options", () => {
    const mgr = createComputeManager(PROJECT, getToken, { maxRetries: 5 });
    expect(mgr).toBeInstanceOf(GcpComputeManager);
  });
});
