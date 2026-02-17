/**
 * Azure Functions — Type Definitions
 */

export type FunctionRuntime = "dotnet" | "node" | "python" | "java" | "powershell" | "custom";
export type FunctionState = "Running" | "Stopped" | "Unknown";

export type AzureFunction = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  runtime: FunctionRuntime;
  runtimeVersion?: string;
  state: FunctionState;
  defaultHostName?: string;
  kind: string;
  appServicePlanId?: string;
  tags?: Record<string, string>;
  lastModified?: string;
};

export type FunctionApp = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state: string;
  defaultHostName: string;
  httpsOnly: boolean;
  runtime?: FunctionRuntime;
  functions: string[];
  tags?: Record<string, string>;
};

export type FunctionCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  runtime: FunctionRuntime;
  runtimeVersion?: string;
  planType?: "Consumption" | "Premium" | "Dedicated";
  storageAccountName: string;
  tags?: Record<string, string>;
};

export type FunctionDeployOptions = {
  functionAppName: string;
  resourceGroup: string;
  packagePath: string;
};

export type FunctionTrigger = {
  name: string;
  type: string;
  direction: "in" | "out";
  properties: Record<string, unknown>;
};

export type FunctionBinding = {
  name: string;
  type: string;
  direction: "in" | "out" | "inout";
  connection?: string;
  properties: Record<string, unknown>;
};
