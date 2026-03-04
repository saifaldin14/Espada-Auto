/**
 * GCP Discovery Manager
 *
 * Uses Cloud Asset Inventory to discover, search, and audit all
 * resources across a GCP project or organization.
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type AssetType =
  | "compute.googleapis.com/Instance"
  | "compute.googleapis.com/Disk"
  | "compute.googleapis.com/Network"
  | "storage.googleapis.com/Bucket"
  | "sqladmin.googleapis.com/Instance"
  | "container.googleapis.com/Cluster"
  | "cloudfunctions.googleapis.com/Function"
  | "run.googleapis.com/Service"
  | "iam.googleapis.com/ServiceAccount"
  | string;

export type DiscoveredAsset = {
  name: string;
  assetType: string;
  project: string;
  displayName: string;
  location: string;
  labels: Record<string, string>;
  networkTags: string[];
  createTime: string;
  updateTime: string;
  state: string;
  parentFullResourceName: string;
  additionalAttributes: Record<string, unknown>;
};

export type AssetSearchOptions = {
  query?: string;
  assetTypes?: string[];
  pageSize?: number;
  orderBy?: string;
};

export type IamPolicyAsset = {
  resource: string;
  assetType: string;
  policy: {
    bindings: Array<{
      role: string;
      members: string[];
      condition?: { title: string; expression: string };
    }>;
  };
};

export type ResourceRelationship = {
  source: string;
  sourceType: string;
  target: string;
  targetType: string;
  relationship: string;
};

export type DiscoverySummary = {
  totalAssets: number;
  byType: Record<string, number>;
  byLocation: Record<string, number>;
  unlabeled: number;
  staleAssets: number;
  timestamp: string;
};

export type AssetHistoryEntry = {
  asset: DiscoveredAsset;
  changeTime: string;
  changeType: "CREATE" | "UPDATE" | "DELETE";
};

export type AssetHistoryOptions = {
  assetNames: string[];
  contentType?: "RESOURCE" | "IAM_POLICY" | "ORG_POLICY" | "ACCESS_POLICY";
  startTime: string;
  endTime?: string;
};

// =============================================================================
// Manager
// =============================================================================

const ASSET_BASE = "https://cloudasset.googleapis.com/v1";

export class GcpDiscoveryManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "discovery",
      projectId: this.projectId,
    };
  }

  async searchResources(opts: AssetSearchOptions = {}): Promise<DiscoveredAsset[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const params = new URLSearchParams();
      if (opts.query) params.set("query", opts.query);
      if (opts.assetTypes?.length) {
        for (const t of opts.assetTypes) params.append("assetTypes", t);
      }
      if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
      if (opts.orderBy) params.set("orderBy", opts.orderBy);
      const url = `${ASSET_BASE}/projects/${this.projectId}:searchAllResources?${params}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "results");
      return items.map((r) => this.mapAsset(r));
    }, this.retryOptions);
  }

  async searchIamPolicies(query?: string): Promise<IamPolicyAsset[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const params = query ? `?query=${encodeURIComponent(query)}` : "";
      const url = `${ASSET_BASE}/projects/${this.projectId}:searchAllIamPolicies${params}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "results");
      return items.map((r) => ({
        resource: String(r.resource ?? ""),
        assetType: String(r.assetType ?? ""),
        policy: {
          bindings: ((r.policy as Record<string, unknown>)?.bindings as Array<Record<string, unknown>> ?? []).map((b) => ({
            role: String(b.role ?? ""),
            members: (b.members ?? []) as string[],
            condition: b.condition
              ? {
                  title: String((b.condition as Record<string, unknown>).title ?? ""),
                  expression: String((b.condition as Record<string, unknown>).expression ?? ""),
                }
              : undefined,
          })),
        },
      }));
    }, this.retryOptions);
  }

  async listAssets(assetTypes?: string[]): Promise<DiscoveredAsset[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const params = new URLSearchParams({ contentType: "RESOURCE" });
      if (assetTypes?.length) {
        for (const t of assetTypes) params.append("assetTypes", t);
      }
      const url = `${ASSET_BASE}/projects/${this.projectId}/assets?${params}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "assets");
      return items.map((a) => {
        const resource = (a.resource ?? {}) as Record<string, unknown>;
        const data = (resource.data ?? {}) as Record<string, unknown>;
        return {
          name: String(a.name ?? ""),
          assetType: String(a.assetType ?? ""),
          project: this.projectId,
          displayName: String(data.name ?? data.displayName ?? ""),
          location: String(data.location ?? data.zone ?? data.region ?? "global"),
          labels: (data.labels as Record<string, string>) ?? {},
          networkTags: ((data.tags as Record<string, unknown>)?.items ?? data.networkTags ?? []) as string[],
          createTime: String(data.creationTimestamp ?? data.createTime ?? ""),
          updateTime: String(a.updateTime ?? ""),
          state: String(data.status ?? data.state ?? "UNKNOWN"),
          parentFullResourceName: String(a.parentFullResourceName ?? ""),
          additionalAttributes: data,
        } satisfies DiscoveredAsset;
      });
    }, this.retryOptions);
  }

  async getAssetHistory(opts: AssetHistoryOptions): Promise<AssetHistoryEntry[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const params = new URLSearchParams({
        contentType: opts.contentType ?? "RESOURCE",
        readTimeWindow_startTime: opts.startTime,
      });
      if (opts.endTime) params.set("readTimeWindow_endTime", opts.endTime);
      for (const name of opts.assetNames) params.append("assetNames", name);
      const url = `${ASSET_BASE}/projects/${this.projectId}:batchGetAssetsHistory?${params}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      const assets = (raw.assets ?? []) as Array<Record<string, unknown>>;
      const entries: AssetHistoryEntry[] = [];
      for (const a of assets) {
        const windows = (a.windows ?? []) as Array<Record<string, unknown>>;
        for (const w of windows) {
          const resource = (w.asset as Record<string, unknown>) ?? {};
          entries.push({
            asset: this.mapAsset(resource),
            changeTime: String(w.startTime ?? (w.window as Record<string, unknown>)?.startTime ?? ""),
            changeType: (resource.deleted ? "DELETE" : "UPDATE") as AssetHistoryEntry["changeType"],
          });
        }
      }
      return entries;
    }, this.retryOptions);
  }

  async getDiscoverySummary(assetTypes?: string[]): Promise<DiscoverySummary> {
    const assets = await this.listAssets(assetTypes);
    const byType: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    let unlabeled = 0;
    const staleThreshold = Date.now() - 90 * 24 * 60 * 60 * 1000;
    let staleAssets = 0;

    for (const asset of assets) {
      byType[asset.assetType] = (byType[asset.assetType] ?? 0) + 1;
      byLocation[asset.location] = (byLocation[asset.location] ?? 0) + 1;
      if (Object.keys(asset.labels).length === 0) unlabeled++;
      const updateMs = asset.updateTime ? new Date(asset.updateTime).getTime() : 0;
      if (updateMs > 0 && updateMs < staleThreshold) staleAssets++;
    }

    return {
      totalAssets: assets.length,
      byType,
      byLocation,
      unlabeled,
      staleAssets,
      timestamp: new Date().toISOString(),
    };
  }

  async findRelationships(assetName: string, relationshipTypes?: string[]): Promise<ResourceRelationship[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const types = relationshipTypes ?? [
        "INSTANCE_TO_INSTANCEGROUP",
        "INSTANCE_TO_NETWORK",
        "INSTANCE_TO_SUBNETWORK",
        "INSTANCE_TO_DISK",
        "DISK_TO_IMAGE",
        "NETWORK_TO_SUBNETWORK",
        "CLUSTER_TO_NODEPOOL",
      ];
      const params = new URLSearchParams({ contentType: "RELATIONSHIP" });
      for (const t of types) params.append("relationshipTypes", t);
      params.append("assetNames", assetName);
      const url = `${ASSET_BASE}/projects/${this.projectId}/assets?${params}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "assets");
      const relationships: ResourceRelationship[] = [];
      for (const item of items) {
        const rels = (item.relatedAssets ?? {}) as Record<string, unknown>;
        const relAssets = (rels.assets ?? []) as Array<Record<string, unknown>>;
        for (const rel of relAssets) {
          relationships.push({
            source: String(item.name ?? ""),
            sourceType: String(item.assetType ?? ""),
            target: String(rel.asset ?? ""),
            targetType: String(rel.assetType ?? ""),
            relationship: String(rels.relationshipType ?? "RELATED"),
          });
        }
      }
      return relationships;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mapAsset(raw: Record<string, unknown>): DiscoveredAsset {
    return {
      name: String(raw.name ?? ""),
      assetType: String(raw.assetType ?? ""),
      project: String(raw.project ?? this.projectId),
      displayName: String(raw.displayName ?? raw.name ?? ""),
      location: String(raw.location ?? "global"),
      labels: (raw.labels as Record<string, string>) ?? {},
      networkTags: (raw.networkTags ?? []) as string[],
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      state: String(raw.state ?? "UNKNOWN"),
      parentFullResourceName: String(raw.parentFullResourceName ?? ""),
      additionalAttributes: (raw.additionalAttributes ?? {}) as Record<string, unknown>,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createDiscoveryManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpDiscoveryManager {
  return new GcpDiscoveryManager(projectId, getAccessToken, retryOptions);
}
