/**
 * Service Catalog Module Index
 *
 * Exports all service catalog features including pre-approved modules,
 * request/approval workflows, quota management, and chargeback/showback.
 */

// Types
export type {
  // Modules
  ModuleCategory,
  ModuleCompliance,
  ModuleParameter,
  ModuleOutput,
  CatalogModule,
  // Requests
  RequestStatus,
  ApprovalDecision,
  ProvisioningRequest,
  ApprovalRecord,
  ApprovalPolicy,
  // Quotas
  QuotaResource,
  QuotaLimit,
  QuotaUsageRecord,
  QuotaAlert,
  // Chargeback
  CostAllocation,
  CostCenterConfig,
  ShowbackReport,
  // Results
  CatalogResult,
} from './types.js';

// Module Service
export {
  CatalogModuleService,
  createCatalogModuleService,
  type ModuleStorage,
  type ModuleServiceConfig,
} from './modules.js';

// Request Service
export {
  ProvisioningRequestService,
  createProvisioningRequestService,
  type RequestStorage,
  type RequestServiceConfig,
} from './requests.js';

// Quota Service
export {
  QuotaService,
  createQuotaService,
  type QuotaStorage,
  type QuotaServiceConfig,
} from './quotas.js';

// Chargeback Service
export {
  ChargebackService,
  createChargebackService,
  type ChargebackStorage,
  type ChargebackServiceConfig,
} from './chargeback.js';

// =============================================================================
// Composite Service Catalog Service
// =============================================================================

import { CatalogModuleService, createCatalogModuleService, type ModuleServiceConfig } from './modules.js';
import { ProvisioningRequestService, createProvisioningRequestService, type RequestServiceConfig } from './requests.js';
import { QuotaService, createQuotaService, type QuotaServiceConfig } from './quotas.js';
import { ChargebackService, createChargebackService, type ChargebackServiceConfig } from './chargeback.js';

export interface ServiceCatalogConfig {
  modules?: ModuleServiceConfig;
  requests?: Omit<RequestServiceConfig, 'moduleService'>;
  quotas?: QuotaServiceConfig;
  chargeback?: ChargebackServiceConfig;
}

export interface ServiceCatalogServices {
  modules: CatalogModuleService;
  requests: ProvisioningRequestService;
  quotas: QuotaService;
  chargeback: ChargebackService;
}

/**
 * Creates all service catalog services with proper dependencies
 */
export function createServiceCatalogServices(config?: ServiceCatalogConfig): ServiceCatalogServices {
  const modules = createCatalogModuleService(config?.modules);
  const requests = createProvisioningRequestService({
    ...config?.requests,
    moduleService: modules,
  });
  const quotas = createQuotaService(config?.quotas);
  const chargeback = createChargebackService(config?.chargeback);

  return {
    modules,
    requests,
    quotas,
    chargeback,
  };
}
