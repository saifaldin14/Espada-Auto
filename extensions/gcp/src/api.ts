/**
 * GCP Extension — REST API Request Helpers
 *
 * Shared utilities for making authenticated requests to GCP REST APIs.
 * Uses native `fetch()` with Bearer token auth — no SDK needed.
 */

// =============================================================================
// Types
// =============================================================================

/** Error shape returned by GCP REST APIs. */
export type GcpApiError = Error & {
  statusCode: number;
  code: string;
  headers?: Record<string, string>;
};

/** Options for a GCP API request. */
export type GcpRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};

// =============================================================================
// Core Request
// =============================================================================

/**
 * Make an authenticated request to a GCP REST API endpoint.
 *
 * @param url   - Full REST API URL.
 * @param token - OAuth2 access token (Bearer).
 * @param opts  - Optional method, body, extra headers.
 * @returns Parsed JSON response body.
 */
export async function gcpRequest<T = Record<string, unknown>>(
  url: string,
  token: string,
  opts?: GcpRequestOptions,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = opts?.timeout ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...opts?.headers,
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const errObj = errBody.error as Record<string, unknown> | undefined;
      const message = (errObj?.message ?? `GCP API error: HTTP ${res.status}`) as string;
      const code = ((errObj?.status ?? errObj?.code ?? "") as string).toString();
      const error = new Error(message) as GcpApiError;
      error.statusCode = res.status;
      error.code = code;
      // Extract retry-after header for retry logic
      const retryAfter = res.headers.get("retry-after");
      if (retryAfter) {
        (error as unknown as Record<string, unknown>).headers = { "retry-after": retryAfter };
      }
      throw error;
    }

    // 204 No Content or empty body
    if (res.status === 204) return {} as T;
    const contentLength = res.headers.get("content-length");
    if (contentLength === "0") return {} as T;

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Paginated List
// =============================================================================

/**
 * Fetch all pages of a GCP list API, accumulating items under `listKey`.
 *
 * Handles GCP-style pagination via `nextPageToken` / `pageToken` query params.
 *
 * @param url     - Base REST API URL (without pageToken).
 * @param token   - OAuth2 access token.
 * @param listKey - JSON key containing the array of items (e.g. "instances", "clusters").
 * @param maxPages - Safety limit on pages (default 50).
 * @returns Flat array of all items across pages.
 */
export async function gcpList<T = Record<string, unknown>>(
  url: string,
  token: string,
  listKey: string,
  maxPages = 50,
): Promise<T[]> {
  const results: T[] = [];
  let pageToken: string | undefined;
  let page = 0;

  do {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl = pageToken
      ? `${url}${separator}pageToken=${encodeURIComponent(pageToken)}`
      : url;

    const data = await gcpRequest<Record<string, unknown>>(pageUrl, token);
    const items = (data[listKey] ?? []) as T[];
    results.push(...items);
    pageToken = data.nextPageToken as string | undefined;
    page++;
  } while (pageToken && page < maxPages);

  return results;
}

// =============================================================================
// Aggregated List (Compute-style)
// =============================================================================

/**
 * Fetch all items from a Compute Engine aggregated list endpoint.
 *
 * Aggregated list responses group items by scope (zone/region), e.g.:
 * `{ items: { "zones/us-central1-a": { instances: [...] } } }`
 *
 * @param url     - Aggregated list URL.
 * @param token   - OAuth2 access token.
 * @param itemKey - Key within each scope object (e.g. "instances", "disks").
 * @returns Flat array of all items across all scopes.
 */
export async function gcpAggregatedList<T = Record<string, unknown>>(
  url: string,
  token: string,
  itemKey: string,
): Promise<T[]> {
  const results: T[] = [];
  let pageToken: string | undefined;

  do {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl = pageToken
      ? `${url}${separator}pageToken=${encodeURIComponent(pageToken)}`
      : url;

    const data = await gcpRequest<Record<string, unknown>>(pageUrl, token);
    const scopes = (data.items ?? {}) as Record<string, Record<string, unknown>>;

    for (const scope of Object.values(scopes)) {
      const items = (scope[itemKey] ?? []) as T[];
      results.push(...items);
    }

    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);

  return results;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract the short name from a GCP resource self-link or full path.
 * e.g. "projects/my-proj/zones/us-central1-a/machineTypes/n1-standard-1" → "n1-standard-1"
 */
export function shortName(fullPath: string): string {
  return fullPath.split("/").pop() ?? fullPath;
}

/**
 * Build a POST request for a GCP mutation endpoint and return a
 * standardised operation result.
 */
export async function gcpMutate(
  url: string,
  token: string,
  body: unknown,
  method = "POST",
): Promise<{ success: boolean; message: string; operationId?: string }> {
  const data = await gcpRequest<Record<string, unknown>>(url, token, { method, body });
  const opName = (data.name ?? "") as string;
  return {
    success: true,
    message: opName ? `Operation ${opName} initiated` : "Operation initiated",
    operationId: opName || undefined,
  };
}
