/**
 * Azure Static Web Apps — Type Definitions
 */

// ============================================================================
// Static Web Apps
// ============================================================================

export type StaticWebApp = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  skuName?: string;
  skuTier?: string;
  defaultHostname?: string;
  repositoryUrl?: string;
  branch?: string;
  provider?: string;
  buildProperties?: StaticWebAppBuildProperties;
  customDomains?: string[];
  provisioningState?: string;
  tags?: Record<string, string>;
};

export type StaticWebAppBuildProperties = {
  appLocation?: string;
  apiLocation?: string;
  outputLocation?: string;
  appBuildCommand?: string;
  apiBuildCommand?: string;
};

// ============================================================================
// Static Web App Custom Domains
// ============================================================================

export type StaticWebAppCustomDomain = {
  id: string;
  name: string;
  domainName?: string;
  status?: string;
  validationToken?: string;
  errorMessage?: string;
  provisioningState?: string;
};

// ============================================================================
// Static Web App Builds
// ============================================================================

export type StaticWebAppBuild = {
  id: string;
  name: string;
  buildId?: string;
  hostname?: string;
  status?: string;
  sourceBranch?: string;
  pullRequestTitle?: string;
  createdTimeUtc?: string;
  lastUpdatedOn?: string;
};

// ============================================================================
// Static Web App Functions
// ============================================================================

export type StaticWebAppFunction = {
  id: string;
  name: string;
  functionName?: string;
  triggerType?: string;
};
