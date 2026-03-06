/**
 * Cross-Cloud Migration Engine — Cost Estimator
 *
 * Estimates migration costs based on:
 * - Egress charges from source provider
 * - Data transfer costs
 * - Target infrastructure costs (projected monthly)
 * - Conversion/processing costs
 */

import type {
  MigrationProvider,
  MigrationResourceType,
  MigrationCostEstimate,
  CostLineItem,
  NormalizedVM,
  NormalizedBucket,
} from "../types.js";
import { getResolvedExtensions } from "../integrations/extension-bridge.js";

// =============================================================================
// Pricing Data (simplified per-GB rates)
// =============================================================================

/** Egress cost per GB from each provider. */
const EGRESS_RATES: Record<string, number> = {
  aws: 0.09,      // $0.09/GB after first 1GB
  azure: 0.087,   // $0.087/GB (5GB–10TB tier)
  gcp: 0.12,      // $0.12/GB (1-10TB tier, premium)
  "on-premises": 0.0, // No egress charge from on-prem
  vmware: 0.0,
  nutanix: 0.0,
};

/** Ingress is free for all major clouds. */
const INGRESS_RATES: Record<string, number> = {
  aws: 0.0,
  azure: 0.0,
  gcp: 0.0,
  "on-premises": 0.0,
  vmware: 0.0,
  nutanix: 0.0,
};

/** Approximate monthly compute cost per vCPU-hour for target provider. */
const COMPUTE_RATES_PER_VCPU_MONTH: Record<string, number> = {
  aws: 36.5,     // ~$0.05/hr × 730hrs
  azure: 35.04,  // ~$0.048/hr × 730hrs
  gcp: 33.80,    // ~$0.0463/hr × 730hrs
  "on-premises": 10.0, // Amortized on-prem cost estimate
  vmware: 10.0,
  nutanix: 10.0,
};

/** Approximate monthly storage cost per GB. */
const STORAGE_RATES_PER_GB_MONTH: Record<string, number> = {
  aws: 0.023,    // S3 Standard
  azure: 0.018,  // Blob Hot tier
  gcp: 0.020,    // Standard storage
  "on-premises": 0.005,
  vmware: 0.005,
  nutanix: 0.005,
};

/** API call costs per 1000 operations. */
const API_COST_PER_1000: Record<string, number> = {
  aws: 0.005,
  azure: 0.004,
  gcp: 0.005,
  "on-premises": 0.0,
  vmware: 0.0,
  nutanix: 0.0,
};

// =============================================================================
// Cost Estimation Functions
// =============================================================================

/**
 * Estimate egress cost for transferring data out of a provider.
 */
export function estimateEgressCost(
  sourceProvider: MigrationProvider,
  dataSizeGB: number,
): CostLineItem {
  const rate = EGRESS_RATES[sourceProvider] ?? 0.09;
  const amount = dataSizeGB * rate;
  return {
    category: "egress",
    description: `Data egress from ${sourceProvider} (${dataSizeGB.toFixed(1)} GB × $${rate}/GB)`,
    amount,
    unit: "USD",
    quantity: dataSizeGB,
  };
}

/**
 * Estimate target infrastructure monthly cost for VMs.
 */
export function estimateComputeCost(
  targetProvider: MigrationProvider,
  vms: Array<{ cpuCores: number; memoryGB: number }>,
): CostLineItem {
  const ratePerVCPU = COMPUTE_RATES_PER_VCPU_MONTH[targetProvider] ?? 36.5;
  let totalVCPUs = 0;
  for (const vm of vms) {
    totalVCPUs += vm.cpuCores;
  }
  const monthlyAmount = totalVCPUs * ratePerVCPU;
  return {
    category: "compute",
    description: `Target compute on ${targetProvider} (${totalVCPUs} vCPUs × $${ratePerVCPU}/vCPU/month)`,
    amount: monthlyAmount,
    unit: "USD/month",
    quantity: totalVCPUs,
  };
}

/**
 * Estimate target storage monthly cost.
 */
export function estimateStorageCost(
  targetProvider: MigrationProvider,
  storageSizeGB: number,
): CostLineItem {
  const rate = STORAGE_RATES_PER_GB_MONTH[targetProvider] ?? 0.023;
  const monthlyAmount = storageSizeGB * rate;
  return {
    category: "storage",
    description: `Target storage on ${targetProvider} (${storageSizeGB.toFixed(1)} GB × $${rate}/GB/month)`,
    amount: monthlyAmount,
    unit: "USD/month",
    quantity: storageSizeGB,
  };
}

/**
 * Estimate API call costs for object transfer.
 */
export function estimateApiCost(
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
  objectCount: number,
): CostLineItem {
  const sourceRate = API_COST_PER_1000[sourceProvider] ?? 0.005;
  const targetRate = API_COST_PER_1000[targetProvider] ?? 0.005;
  // LIST + GET on source, PUT on target
  const sourceCalls = objectCount * 2;
  const targetCalls = objectCount;
  const amount = (sourceCalls / 1000) * sourceRate + (targetCalls / 1000) * targetRate;
  return {
    category: "api-calls",
    description: `API calls (${objectCount} objects: LIST+GET on ${sourceProvider}, PUT on ${targetProvider})`,
    amount,
    unit: "USD",
    quantity: objectCount,
  };
}

/**
 * Estimate image conversion cost (compute time for qemu-img).
 */
export function estimateConversionCost(diskSizeGB: number): CostLineItem {
  // Rough estimate: conversion takes ~1 min per 100GB on a 4-core sandbox
  const hours = (diskSizeGB / 100) * (1 / 60);
  const sandboxCostPerHour = 0.20; // Estimated sandbox compute cost
  const amount = hours * sandboxCostPerHour;
  return {
    category: "conversion",
    description: `Image format conversion (${diskSizeGB} GB, est. ${(hours * 60).toFixed(1)} min)`,
    amount,
    unit: "USD",
    quantity: diskSizeGB,
  };
}

// =============================================================================
// Full Estimation
// =============================================================================

/**
 * Produce a full cost estimate for a migration.
 */
export function estimateMigrationCost(params: {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  resourceTypes: MigrationResourceType[];
  dataSizeGB: number;
  objectCount?: number;
  vms?: Array<{ cpuCores: number; memoryGB: number }>;
  diskSizeGB?: number;
  jobId?: string;
}): MigrationCostEstimate {
  const {
    sourceProvider,
    targetProvider,
    resourceTypes,
    dataSizeGB,
    objectCount = 0,
    vms = [],
    diskSizeGB = 0,
    jobId,
  } = params;

  const breakdown: CostLineItem[] = [];

  // Egress
  const egressCost = estimateEgressCost(sourceProvider, dataSizeGB);
  breakdown.push(egressCost);

  // Transfer (ingress is free, but bandwidth throttle has no cost; use zero line)
  const transferCost: CostLineItem = {
    category: "transfer",
    description: "Data ingress to target (free for cloud providers)",
    amount: dataSizeGB * (INGRESS_RATES[targetProvider] ?? 0),
    unit: "USD",
    quantity: dataSizeGB,
  };
  breakdown.push(transferCost);

  // Conversion cost (if VM/disk migration)
  let conversionCost: CostLineItem = { category: "conversion", description: "No conversion needed", amount: 0, unit: "USD", quantity: 0 };
  if (resourceTypes.includes("vm") || resourceTypes.includes("disk")) {
    conversionCost = estimateConversionCost(diskSizeGB || dataSizeGB);
    breakdown.push(conversionCost);
  }

  // Target infra
  let targetInfraCost: CostLineItem = { category: "target-infra", description: "No target infra costs", amount: 0, unit: "USD/month", quantity: 0 };
  if (vms.length > 0) {
    const computeItem = estimateComputeCost(targetProvider, vms);
    breakdown.push(computeItem);
    targetInfraCost = computeItem;
  }

  if (dataSizeGB > 0) {
    const storageItem = estimateStorageCost(targetProvider, dataSizeGB);
    breakdown.push(storageItem);
    if (targetInfraCost.amount === 0) {
      targetInfraCost = storageItem;
    } else {
      targetInfraCost = {
        ...targetInfraCost,
        amount: targetInfraCost.amount + storageItem.amount,
        description: `${targetInfraCost.description} + ${storageItem.description}`,
      };
    }
  }

  // API calls
  if (objectCount > 0) {
    const apiItem = estimateApiCost(sourceProvider, targetProvider, objectCount);
    breakdown.push(apiItem);
  }

  // Total one-time cost
  const oneTimeCost = breakdown
    .filter((item) => !item.unit.includes("month"))
    .reduce((sum, item) => sum + item.amount, 0);

  // Estimated duration (rough): 1 hour base + 30 min per 100GB + 5 min per VM
  const durationHours = 1 + (dataSizeGB / 100) * 0.5 + vms.length * (5 / 60);

  // Confidence based on data availability
  let confidenceLevel: "low" | "medium" | "high" = "high";
  if (dataSizeGB === 0 && vms.length === 0) confidenceLevel = "low";
  else if (objectCount === 0 && dataSizeGB > 100) confidenceLevel = "medium";

  return {
    jobId,
    sourceProvider,
    targetProvider,
    egressCost,
    transferCost,
    targetInfraCost,
    conversionCost,
    totalEstimatedCost: oneTimeCost,
    currency: "USD",
    breakdown,
    estimatedDurationHours: Math.round(durationHours * 10) / 10,
    confidenceLevel,
  };
}

/**
 * Quick cost estimate from normalized resources.
 */
export function estimateFromResources(params: {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  vms?: NormalizedVM[];
  buckets?: NormalizedBucket[];
  diskSizeGB?: number;
}): MigrationCostEstimate {
  const { sourceProvider, targetProvider, vms = [], buckets = [], diskSizeGB = 0 } = params;

  const vmSpecs = vms.map((vm) => ({ cpuCores: vm.cpuCores, memoryGB: vm.memoryGB }));
  const totalDiskGB = vms.reduce((sum, vm) => sum + vm.disks.reduce((s, d) => s + d.sizeGB, 0), 0) + diskSizeGB;
  const totalObjectStorage = buckets.reduce((sum, b) => sum + b.totalSizeBytes / (1024 ** 3), 0);
  const totalObjectCount = buckets.reduce((sum, b) => sum + b.objectCount, 0);

  const resourceTypes: MigrationResourceType[] = [];
  if (vms.length > 0) resourceTypes.push("vm");
  if (buckets.length > 0) resourceTypes.push("object-storage");
  if (totalDiskGB > 0) resourceTypes.push("disk");

  return estimateMigrationCost({
    sourceProvider,
    targetProvider,
    resourceTypes,
    dataSizeGB: totalObjectStorage + totalDiskGB,
    objectCount: totalObjectCount,
    vms: vmSpecs,
    diskSizeGB: totalDiskGB,
  });
}

// =============================================================================
// Budget Integration (via cost-governance extension bridge)
// =============================================================================

export interface BudgetCheckResult {
  withinBudget: boolean;
  budgetId?: string;
  budgetName?: string;
  monthlyLimit?: number;
  currentSpend?: number;
  projectedSpend?: number;
  utilization?: number;
  warning?: string;
}

/**
 * Check whether a migration's estimated cost fits within the org's budget.
 * Queries the cost-governance extension (if available) for a matching budget.
 *
 * @param estimatedCostUSD - The estimated one-time migration cost.
 * @param scope - Budget scope to check against (default: "project").
 * @param scopeId - Scope identifier (e.g. project name, team name).
 * @returns Budget check result, or { withinBudget: true } if cost-governance is unavailable.
 */
export function checkMigrationBudget(
  estimatedCostUSD: number,
  scope: string = "project",
  scopeId: string = "cloud-migration",
): BudgetCheckResult {
  try {
    const ext = getResolvedExtensions();
    if (!ext?.budgetManager) {
      return { withinBudget: true, warning: "cost-governance extension not available — budget check skipped" };
    }

    const budget = ext.budgetManager.findBudget(scope, scopeId);
    if (!budget) {
      return { withinBudget: true, warning: `No budget found for scope=${scope}, scopeId=${scopeId}` };
    }

    const projectedSpend = budget.currentSpend + estimatedCostUSD;
    const utilization = budget.monthlyLimit > 0
      ? Math.round((projectedSpend / budget.monthlyLimit) * 100)
      : 0;

    const withinBudget = projectedSpend <= budget.monthlyLimit;

    return {
      withinBudget,
      budgetId: budget.id,
      monthlyLimit: budget.monthlyLimit,
      currentSpend: budget.currentSpend,
      projectedSpend,
      utilization,
      warning: withinBudget
        ? utilization > 80 ? `Budget utilization at ${utilization}% after migration` : undefined
        : `Migration would exceed budget: projected $${projectedSpend.toLocaleString()} vs limit $${budget.monthlyLimit.toLocaleString()}`,
    };
  } catch {
    // Graceful degradation
    return { withinBudget: true, warning: "Budget check failed — cost-governance error" };
  }
}
