/**
 * Azure Automation — Type Definitions
 */

export type AutomationAccountState = "Ok" | "Unavailable" | "Suspended";

export type AutomationAccount = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state?: AutomationAccountState;
  sku?: string;
  createdTime?: string;
  lastModifiedTime?: string;
};

export type Runbook = {
  id: string;
  name: string;
  accountName: string;
  runbookType: string;
  state?: string;
  description?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  logVerbose?: boolean;
  logProgress?: boolean;
};

export type RunbookJob = {
  id: string;
  name: string;
  runbookName: string;
  status: string;
  startTime?: string;
  endTime?: string;
  creationTime?: string;
  exception?: string;
  jobId?: string;
};

export type Schedule = {
  id: string;
  name: string;
  accountName: string;
  frequency: string;
  interval?: number;
  startTime?: string;
  nextRun?: string;
  isEnabled: boolean;
  description?: string;
};

export type AutomationVariable = {
  id: string;
  name: string;
  value?: string;
  isEncrypted: boolean;
  description?: string;
  createdTime?: string;
  lastModifiedTime?: string;
};
