import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  gcpRequest,
  gcpList,
  gcpAggregatedList,
  shortName,
  gcpMutate,
} from "./api.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

/** Helper to build a minimal Response-like object. */
function fakeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const hdrs = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: hdrs,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ===========================================================================
// gcpRequest
// ===========================================================================

describe("gcpRequest", () => {
  it("sends a GET with bearer token by default", async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({ id: "abc" }));

    const result = await gcpRequest("https://compute.googleapis.com/v1/x", "tok123");

    expect(result).toEqual({ id: "abc" });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://compute.googleapis.com/v1/x");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok123",
      "Content-Type": "application/json",
    });
  });

  it("sends a POST with JSON body", async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({ done: true }));

    await gcpRequest("https://example.com/api", "t", {
      method: "POST",
      body: { key: "val" },
    });

    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(JSON.stringify({ key: "val" }));
  });

  it("throws GcpApiError with details on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse(
        { error: { message: "Not found", status: "NOT_FOUND" } },
        404,
      ),
    );

    await expect(gcpRequest("https://x.com/v1/y", "t")).rejects.toThrow("Not found");

    try {
      mockFetch.mockResolvedValueOnce(
        fakeResponse({ error: { message: "Bad", status: "INVALID" } }, 400),
      );
      await gcpRequest("https://x.com/v1/y", "t");
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
      expect(e.code).toBe("INVALID");
    }
  });

  it("falls back to generic message when error body is missing", async () => {
    const errRes = fakeResponse({}, 502);
    // Simulate json() rejecting (empty body)
    (errRes as any).json = () => Promise.reject(new Error("no body"));
    mockFetch.mockResolvedValueOnce(errRes);

    await expect(gcpRequest("https://x.com/v1/y", "t")).rejects.toThrow(
      "GCP API error: HTTP 502",
    );
  });

  it("returns empty object for 204 No Content", async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse(null, 204));

    const result = await gcpRequest("https://x.com/v1/y", "t");
    expect(result).toEqual({});
  });

  it("returns empty object when content-length is 0", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse(null, 200, { "content-length": "0" }),
    );

    const result = await gcpRequest("https://x.com/v1/y", "t");
    expect(result).toEqual({});
  });

  it("includes retry-after header in error when present", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse(
        { error: { message: "Rate limited", status: "RATE_LIMIT" } },
        429,
        { "retry-after": "30" },
      ),
    );

    try {
      await gcpRequest("https://x.com/v1/y", "t");
    } catch (e: any) {
      expect(e.headers).toEqual({ "retry-after": "30" });
    }
  });

  it("aborts on timeout via AbortController", async () => {
    mockFetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    await expect(
      gcpRequest("https://x.com/v1/y", "t", { timeout: 1 }),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// gcpList
// ===========================================================================

describe("gcpList", () => {
  it("returns items from a single page", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse({ things: [{ id: 1 }, { id: 2 }] }),
    );

    const items = await gcpList("https://x.com/v1/items", "t", "things");
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("paginates across multiple pages using nextPageToken", async () => {
    mockFetch
      .mockResolvedValueOnce(
        fakeResponse({ items: [{ id: 1 }], nextPageToken: "page2" }),
      )
      .mockResolvedValueOnce(
        fakeResponse({ items: [{ id: 2 }], nextPageToken: "page3" }),
      )
      .mockResolvedValueOnce(fakeResponse({ items: [{ id: 3 }] }));

    const items = await gcpList("https://x.com/v1/items", "t", "items");
    expect(items).toHaveLength(3);
    // Second call should include pageToken in URL
    const secondUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondUrl).toContain("pageToken=page2");
  });

  it("returns empty array when listKey is absent", async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({}));

    const items = await gcpList("https://x.com/v1/items", "t", "things");
    expect(items).toEqual([]);
  });

  it("respects maxPages limit", async () => {
    // Always return a nextPageToken so it would loop forever
    mockFetch.mockResolvedValue(
      fakeResponse({ items: [{ id: 1 }], nextPageToken: "more" }),
    );

    const items = await gcpList("https://x.com/v1/items", "t", "items", 2);
    expect(items).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses & separator when URL already has query params", async () => {
    mockFetch
      .mockResolvedValueOnce(
        fakeResponse({ items: [{ id: 1 }], nextPageToken: "p2" }),
      )
      .mockResolvedValueOnce(fakeResponse({ items: [{ id: 2 }] }));

    await gcpList("https://x.com/v1/items?filter=active", "t", "items");
    const secondUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondUrl).toContain("&pageToken=p2");
  });
});

// ===========================================================================
// gcpAggregatedList
// ===========================================================================

describe("gcpAggregatedList", () => {
  it("collects items from multiple scopes", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse({
        items: {
          "zones/us-central1-a": { instances: [{ name: "vm1" }] },
          "zones/us-east1-b": { instances: [{ name: "vm2" }] },
        },
      }),
    );

    const items = await gcpAggregatedList(
      "https://x.com/compute/v1/projects/p/aggregated/instances",
      "t",
      "instances",
    );
    expect(items).toEqual([{ name: "vm1" }, { name: "vm2" }]);
  });

  it("skips scopes that lack the itemKey", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse({
        items: {
          "zones/us-central1-a": { instances: [{ name: "vm1" }] },
          "zones/us-west1-b": { warning: { code: "NO_RESULTS_ON_PAGE" } },
        },
      }),
    );

    const items = await gcpAggregatedList("https://x.com/v1/agg", "t", "instances");
    expect(items).toEqual([{ name: "vm1" }]);
  });

  it("returns empty array when items is empty", async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({ items: {} }));

    const items = await gcpAggregatedList("https://x.com/v1/agg", "t", "disks");
    expect(items).toEqual([]);
  });

  it("paginates aggregated results", async () => {
    mockFetch
      .mockResolvedValueOnce(
        fakeResponse({
          items: { "zones/a": { disks: [{ name: "d1" }] } },
          nextPageToken: "p2",
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          items: { "zones/b": { disks: [{ name: "d2" }] } },
        }),
      );

    const items = await gcpAggregatedList("https://x.com/v1/agg", "t", "disks");
    expect(items).toEqual([{ name: "d1" }, { name: "d2" }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// shortName
// ===========================================================================

describe("shortName", () => {
  it("extracts last segment from a full resource path", () => {
    expect(
      shortName("projects/my-proj/zones/us-central1-a/machineTypes/n1-standard-1"),
    ).toBe("n1-standard-1");
  });

  it("returns the input when there are no slashes", () => {
    expect(shortName("simple-name")).toBe("simple-name");
  });

  it("returns empty string for empty input", () => {
    expect(shortName("")).toBe("");
  });
});

// ===========================================================================
// gcpMutate
// ===========================================================================

describe("gcpMutate", () => {
  it("returns success with operationId when name is present", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse({ name: "operation-123", status: "RUNNING" }),
    );

    const result = await gcpMutate("https://x.com/v1/res", "t", { foo: 1 });
    expect(result).toEqual({
      success: true,
      message: "Operation operation-123 initiated",
      operationId: "operation-123",
    });
    // Default method is POST
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
  });

  it("omits operationId when name is empty", async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({}));

    const result = await gcpMutate("https://x.com/v1/res", "t", {});
    expect(result).toEqual({
      success: true,
      message: "Operation initiated",
      operationId: undefined,
    });
  });

  it("supports custom HTTP method (DELETE)", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse({ name: "op-del" }),
    );

    await gcpMutate("https://x.com/v1/res", "t", null, "DELETE");
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).method).toBe("DELETE");
  });
});
