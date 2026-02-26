/**
 * Azure Logic Apps — Type Definitions
 */

export type LogicAppState = "Enabled" | "Disabled" | "Deleted" | "Suspended";

export type LogicAppWorkflow = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state: LogicAppState;
  version?: string;
  accessEndpoint?: string;
  provisioningState?: string;
  createdTime?: string;
  changedTime?: string;
  sku?: string;
};

export type LogicAppRun = {
  id: string;
  name: string;
  workflowName: string;
  status: string;
  startTime?: string;
  endTime?: string;
  error?: { code: string; message: string };
  correlation?: { clientTrackingId: string };
  trigger?: { name: string; startTime?: string; endTime?: string; status?: string };
};

export type LogicAppTrigger = {
  id: string;
  name: string;
  workflowName: string;
  type: string;
  state: string;
  provisioningState?: string;
  createdTime?: string;
  changedTime?: string;
  lastExecutionTime?: string;
  nextExecutionTime?: string;
  recurrence?: { frequency: string; interval: number };
};

export type LogicAppConnector = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  iconUri?: string;
  brandColor?: string;
  capabilities?: string[];
  connectionParameters?: Record<string, unknown>;
};

export type LogicAppCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  state?: LogicAppState;
  definition?: Record<string, unknown>;
  tags?: Record<string, string>;
};
