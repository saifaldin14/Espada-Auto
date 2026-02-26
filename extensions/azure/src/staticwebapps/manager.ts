/**
 * Azure Static Web Apps Manager
 *
 * Manages Azure Static Web Apps, custom domains, and builds
 * via @azure/arm-appservice (same SDK as Functions and Web Apps).
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  StaticWebApp,
  StaticWebAppCustomDomain,
  StaticWebAppBuild,
} from "./types.js";

export class AzureStaticWebAppsManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { WebSiteManagementClient } = await import("@azure/arm-appservice");
    return new WebSiteManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Static Web Apps
  // ---------------------------------------------------------------------------

  /** List Static Web Apps. */
  async listStaticApps(resourceGroup?: string): Promise<StaticWebApp[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const apps: StaticWebApp[] = [];
      const iter = resourceGroup
        ? client.staticSites.listStaticSitesByResourceGroup(resourceGroup)
        : client.staticSites.list();

      for await (const site of iter) {
        apps.push(this.mapStaticApp(site));
      }
      return apps;
    }, this.retryOptions);
  }

  /** Get a specific Static Web App. */
  async getStaticApp(resourceGroup: string, name: string): Promise<StaticWebApp | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const site = await client.staticSites.getStaticSite(resourceGroup, name);
        return this.mapStaticApp(site, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Static Web App. */
  async deleteStaticApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.staticSites.beginDeleteStaticSiteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Custom Domains
  // ---------------------------------------------------------------------------

  /** List custom domains for a Static Web App. */
  async listCustomDomains(resourceGroup: string, appName: string): Promise<StaticWebAppCustomDomain[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const domains: StaticWebAppCustomDomain[] = [];
      for await (const d of client.staticSites.listStaticSiteCustomDomains(resourceGroup, appName)) {
        domains.push({
          id: d.id ?? "",
          name: d.name ?? "",
          domainName: d.domainName,
          status: d.status,
          validationToken: d.validationToken,
          errorMessage: d.errorMessage,
          provisioningState: (d as unknown as { provisioningState?: string }).provisioningState,
        });
      }
      return domains;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Builds
  // ---------------------------------------------------------------------------

  /** List builds for a Static Web App. */
  async listBuilds(resourceGroup: string, appName: string): Promise<StaticWebAppBuild[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const builds: StaticWebAppBuild[] = [];
      for await (const b of client.staticSites.listStaticSiteBuilds(resourceGroup, appName)) {
        builds.push({
          id: b.id ?? "",
          name: b.name ?? "",
          buildId: b.buildId,
          hostname: b.hostname,
          status: b.status,
          sourceBranch: b.sourceBranch,
          pullRequestTitle: b.pullRequestTitle,
          createdTimeUtc: b.createdTimeUtc?.toISOString(),
          lastUpdatedOn: b.lastUpdatedOn?.toISOString(),
        });
      }
      return builds;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapStaticApp(site: unknown, rg?: string): StaticWebApp {
    const s = site as {
      id?: string; name?: string; location?: string;
      sku?: { name?: string; tier?: string };
      defaultHostname?: string;
      repositoryUrl?: string; branch?: string; provider?: string;
      buildProperties?: {
        appLocation?: string; apiLocation?: string; outputLocation?: string;
        appBuildCommand?: string; apiBuildCommand?: string;
      };
      customDomains?: string[];
      provisioningState?: string;
      tags?: Record<string, string>;
    };

    return {
      id: s.id ?? "",
      name: s.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(s.id ?? ""),
      location: s.location ?? "",
      skuName: s.sku?.name,
      skuTier: s.sku?.tier,
      defaultHostname: s.defaultHostname,
      repositoryUrl: s.repositoryUrl,
      branch: s.branch,
      provider: s.provider,
      buildProperties: s.buildProperties
        ? {
            appLocation: s.buildProperties.appLocation,
            apiLocation: s.buildProperties.apiLocation,
            outputLocation: s.buildProperties.outputLocation,
            appBuildCommand: s.buildProperties.appBuildCommand,
            apiBuildCommand: s.buildProperties.apiBuildCommand,
          }
        : undefined,
      customDomains: s.customDomains ?? [],
      provisioningState: s.provisioningState,
      tags: s.tags as Record<string, string>,
    };
  }
}

export function createStaticWebAppsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureStaticWebAppsManager {
  return new AzureStaticWebAppsManager(credentialsManager, subscriptionId, retryOptions);
}
