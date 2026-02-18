/**
 * Blueprint & template types.
 */

export type CloudProvider = "aws" | "azure" | "gcp";

export type BlueprintCategory =
  | "web-app"
  | "api"
  | "data"
  | "container"
  | "serverless"
  | "static-site"
  | "custom";

export interface BlueprintParameter {
  id: string;
  name: string;
  description?: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  default?: unknown;
  options?: string[];
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

export interface BlueprintResource {
  type: string;
  name: string;
  provider: CloudProvider;
  config: Record<string, unknown>;
}

export interface BlueprintDependency {
  blueprintId: string;
  optional: boolean;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  version: string;
  category: BlueprintCategory;
  providers: CloudProvider[];
  parameters: BlueprintParameter[];
  resources: BlueprintResource[];
  dependencies: BlueprintDependency[];
  policies: string[];
  estimatedCostRange: [number, number];
  tags: string[];
}

export type InstanceStatus = "deploying" | "active" | "failed" | "destroying" | "destroyed";

export interface BlueprintInstance {
  id: string;
  blueprintId: string;
  name: string;
  parameters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  status: InstanceStatus;
  resources: string[];
  graphGroupId: string;
}

export interface ValidationError {
  parameterId: string;
  message: string;
}

export interface PreviewResult {
  blueprint: Blueprint;
  resolvedParameters: Record<string, unknown>;
  resources: BlueprintResource[];
  estimatedCostRange: [number, number];
  validationErrors: ValidationError[];
}

export interface RenderResult {
  files: Map<string, string>;
  resources: BlueprintResource[];
  resolvedParameters: Record<string, unknown>;
}
