/**
 * Azure IaC Types
 *
 * Types for Infrastructure-as-Code generation (Terraform, Bicep, ARM templates).
 */

export type IaCFormat = "terraform" | "bicep" | "arm";

export interface IaCGenerationOptions {
  format: IaCFormat;
  resourceGroupName?: string;
  region?: string;
  includeProvider?: boolean;
  includeVariables?: boolean;
  includeOutputs?: boolean;
  moduleName?: string;
}

export interface IaCGenerationResult {
  format: IaCFormat;
  content: string;
  fileName: string;
  resourceCount: number;
  warnings: string[];
}

export interface ResourceDefinition {
  type: string;
  name: string;
  resourceGroup: string;
  region: string;
  properties: Record<string, unknown>;
  dependsOn: string[];
  tags: Record<string, string>;
}

export interface DriftDetectionResult {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  driftDetected: boolean;
  changes: DriftChange[];
  lastChecked: string;
}

export interface DriftChange {
  property: string;
  expectedValue: unknown;
  actualValue: unknown;
  severity: "low" | "medium" | "high";
}

export interface IaCStateExport {
  format: IaCFormat;
  resources: Array<{
    type: string;
    name: string;
    properties: Record<string, unknown>;
  }>;
  exportedAt: string;
}
