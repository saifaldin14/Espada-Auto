/**
 * Pulumi extension types — stacks, resources, state, outputs.
 */

/* ---------- Resource / State ---------- */

export type PulumiResourceType = string; // e.g. "aws:s3/bucket:Bucket"

export interface PulumiResource {
  urn: string;
  type: PulumiResourceType;
  custom: boolean;
  id?: string;
  parent?: string;
  provider?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  dependencies?: string[];
}

export interface PulumiState {
  version: number;
  deployment: {
    manifest: {
      time: string;
      magic: string;
      version: string;
    };
    resources: PulumiResource[];
  };
}

/* ---------- Stack ---------- */

export interface PulumiStack {
  name: string;
  current: boolean;
  updateInProgress: boolean;
  lastUpdate?: string;
  resourceCount?: number;
  url?: string;
}

export interface PulumiOutput {
  name: string;
  value: unknown;
  secret: boolean;
}

/* ---------- Parsed / Normalized ---------- */

export interface ParsedPulumiResource {
  urn: string;
  type: string;
  name: string;
  provider: string;
  id?: string;
  parent?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  dependencies: string[];
}

/* ---------- Preview / Up ---------- */

export type PulumiAction = "create" | "update" | "delete" | "replace" | "same";

export interface PulumiPreviewStep {
  urn: string;
  type: string;
  action: PulumiAction;
  oldState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
}

export interface PulumiPreviewSummary {
  creates: number;
  updates: number;
  deletes: number;
  replaces: number;
  sames: number;
  totalChanges: number;
  steps: PulumiPreviewStep[];
}

/* ---------- Drift ---------- */

export interface PulumiDriftField {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface PulumiDriftedResource {
  urn: string;
  type: string;
  fields: PulumiDriftField[];
}

export interface PulumiDriftResult {
  stackName: string;
  timestamp: string;
  totalResources: number;
  driftedCount: number;
  driftedResources: PulumiDriftedResource[];
}
