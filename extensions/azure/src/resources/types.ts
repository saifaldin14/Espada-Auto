/**
 * Azure Resource Manager — Type Definitions
 */

export type ProvisioningState = "Succeeded" | "Failed" | "Canceled" | "Creating" | "Updating" | "Deleting" | "Accepted" | "Running";

export type ResourceGroup = {
  id: string;
  name: string;
  location: string;
  tags?: Record<string, string>;
  provisioningState?: string;
  managedBy?: string;
};

export type ARMDeployment = {
  id: string;
  name: string;
  resourceGroup: string;
  provisioningState: ProvisioningState;
  timestamp?: string;
  duration?: string;
  mode?: string;
  correlationId?: string;
  outputs?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type DeploymentTemplate = {
  schema: string;
  contentVersion: string;
  parameters?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  resources: Array<Record<string, unknown>>;
  outputs?: Record<string, unknown>;
};

export type DeploymentOperation = {
  id: string;
  operationId: string;
  provisioningState: string;
  targetResource?: { id: string; resourceType: string; resourceName: string };
  statusCode?: string;
  statusMessage?: string;
  timestamp?: string;
};

export type GenericResource = {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  location: string;
  tags?: Record<string, string>;
  provisioningState?: string;
  kind?: string;
  sku?: { name: string; tier?: string; capacity?: number };
};
