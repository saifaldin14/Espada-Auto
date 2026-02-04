/**
 * Service Catalog Module Service
 *
 * Manages pre-approved infrastructure modules with versioning,
 * compliance requirements, and cost estimates.
 */

import { randomUUID } from 'node:crypto';
import type {
  CatalogModule,
  ModuleCategory,
  ModuleParameter,
  ModuleCompliance,
  CatalogResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface ModuleStorage {
  saveModule(module: CatalogModule): Promise<void>;
  getModule(id: string): Promise<CatalogModule | null>;
  getModuleByNameVersion(name: string, version: string, tenantId?: string): Promise<CatalogModule | null>;
  listModules(options: {
    tenantId?: string;
    category?: ModuleCategory;
    provider?: CatalogModule['provider'];
    compliance?: ModuleCompliance[];
    status?: CatalogModule['status'];
    tags?: string[];
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<CatalogModule[]>;
  listModuleVersions(name: string, tenantId?: string): Promise<CatalogModule[]>;
  deleteModule(id: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryModuleStorage implements ModuleStorage {
  private modules = new Map<string, CatalogModule>();

  async saveModule(module: CatalogModule): Promise<void> {
    this.modules.set(module.id, module);
  }

  async getModule(id: string): Promise<CatalogModule | null> {
    return this.modules.get(id) ?? null;
  }

  async getModuleByNameVersion(name: string, version: string, tenantId?: string): Promise<CatalogModule | null> {
    return Array.from(this.modules.values()).find(
      m => m.name === name && m.version === version && (!tenantId || m.tenantId === tenantId || !m.tenantId)
    ) ?? null;
  }

  async listModules(options: {
    tenantId?: string;
    category?: ModuleCategory;
    provider?: CatalogModule['provider'];
    compliance?: ModuleCompliance[];
    status?: CatalogModule['status'];
    tags?: string[];
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<CatalogModule[]> {
    let results = Array.from(this.modules.values())
      // Include global modules (no tenantId) and tenant-specific modules
      .filter(m => !options.tenantId || !m.tenantId || m.tenantId === options.tenantId)
      .filter(m => !options.category || m.category === options.category)
      .filter(m => !options.provider || m.provider === options.provider)
      .filter(m => !options.compliance?.length || options.compliance.some(c => m.compliance.includes(c)))
      .filter(m => !options.status || m.status === options.status)
      .filter(m => !options.tags?.length || options.tags.some(t => m.tags.includes(t)))
      .filter(m => {
        if (!options.search) return true;
        const searchLower = options.search.toLowerCase();
        return m.name.toLowerCase().includes(searchLower) ||
               m.description.toLowerCase().includes(searchLower);
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async listModuleVersions(name: string, tenantId?: string): Promise<CatalogModule[]> {
    return Array.from(this.modules.values())
      .filter(m => m.name === name && (!tenantId || !m.tenantId || m.tenantId === tenantId))
      .sort((a, b) => b.version.localeCompare(a.version));
  }

  async deleteModule(id: string): Promise<void> {
    this.modules.delete(id);
  }
}

// =============================================================================
// Module Service
// =============================================================================

export interface ModuleServiceConfig {
  storage?: ModuleStorage;
}

export class CatalogModuleService {
  private storage: ModuleStorage;

  constructor(config?: ModuleServiceConfig) {
    this.storage = config?.storage ?? new InMemoryModuleStorage();
  }

  // ===========================================================================
  // Module Management
  // ===========================================================================

  async createModule(
    options: {
      tenantId?: string;
      name: string;
      description: string;
      version: string;
      category: ModuleCategory;
      provider: CatalogModule['provider'];
      source: CatalogModule['source'];
      parameters?: ModuleParameter[];
      tags?: string[];
      compliance?: ModuleCompliance[];
      estimatedCost?: CatalogModule['estimatedCost'];
      estimatedDeploymentMinutes?: number;
      requiredApprovals?: CatalogModule['requiredApprovals'];
      restrictions?: CatalogModule['restrictions'];
      documentationUrl?: string;
      supportContact?: string;
      ownerId: string;
    },
  ): Promise<CatalogResult<CatalogModule>> {
    // Check for existing version
    const existing = await this.storage.getModuleByNameVersion(
      options.name,
      options.version,
      options.tenantId,
    );
    if (existing) {
      return { success: false, error: 'Module version already exists', code: 'VERSION_EXISTS' };
    }

    const now = new Date().toISOString();

    const module: CatalogModule = {
      id: randomUUID(),
      tenantId: options.tenantId,
      name: options.name,
      description: options.description,
      version: options.version,
      category: options.category,
      tags: options.tags ?? [],
      provider: options.provider,
      source: options.source,
      parameters: options.parameters ?? [],
      outputs: [],
      compliance: options.compliance ?? [],
      estimatedCost: options.estimatedCost,
      estimatedDeploymentMinutes: options.estimatedDeploymentMinutes,
      requiredApprovals: options.requiredApprovals,
      restrictions: options.restrictions,
      documentationUrl: options.documentationUrl,
      supportContact: options.supportContact,
      status: 'draft',
      ownerId: options.ownerId,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveModule(module);
    return { success: true, data: module };
  }

  async getModule(moduleId: string): Promise<CatalogResult<CatalogModule>> {
    const module = await this.storage.getModule(moduleId);
    if (!module) {
      return { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' };
    }
    return { success: true, data: module };
  }

  async getModuleByName(
    name: string,
    version?: string,
    tenantId?: string,
  ): Promise<CatalogResult<CatalogModule>> {
    if (version) {
      const module = await this.storage.getModuleByNameVersion(name, version, tenantId);
      if (!module) {
        return { success: false, error: 'Module version not found', code: 'MODULE_NOT_FOUND' };
      }
      return { success: true, data: module };
    }

    // Get latest version
    const versions = await this.storage.listModuleVersions(name, tenantId);
    const active = versions.find(m => m.status === 'active');
    if (active) {
      return { success: true, data: active };
    }

    if (versions.length > 0) {
      return { success: true, data: versions[0] };
    }

    return { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' };
  }

  async listModules(
    options?: {
      tenantId?: string;
      category?: ModuleCategory;
      provider?: CatalogModule['provider'];
      compliance?: ModuleCompliance[];
      status?: CatalogModule['status'];
      tags?: string[];
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<CatalogResult<CatalogModule[]>> {
    const modules = await this.storage.listModules(options ?? {});
    return { success: true, data: modules };
  }

  async listModuleVersions(
    name: string,
    tenantId?: string,
  ): Promise<CatalogResult<CatalogModule[]>> {
    const versions = await this.storage.listModuleVersions(name, tenantId);
    return { success: true, data: versions };
  }

  async updateModule(
    moduleId: string,
    updates: Partial<Pick<CatalogModule, 'description' | 'tags' | 'parameters' | 'outputs' |
      'compliance' | 'estimatedCost' | 'estimatedDeploymentMinutes' | 'requiredApprovals' |
      'restrictions' | 'documentationUrl' | 'supportContact' | 'status'>>,
  ): Promise<CatalogResult<CatalogModule>> {
    const module = await this.storage.getModule(moduleId);
    if (!module) {
      return { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' };
    }

    const updated: CatalogModule = {
      ...module,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveModule(updated);
    return { success: true, data: updated };
  }

  async publishModule(moduleId: string): Promise<CatalogResult<CatalogModule>> {
    const module = await this.storage.getModule(moduleId);
    if (!module) {
      return { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' };
    }

    if (module.status === 'active') {
      return { success: false, error: 'Module already active', code: 'ALREADY_ACTIVE' };
    }

    // Deprecate previous active version
    const versions = await this.storage.listModuleVersions(module.name, module.tenantId);
    for (const v of versions) {
      if (v.status === 'active' && v.id !== moduleId) {
        v.status = 'deprecated';
        v.updatedAt = new Date().toISOString();
        await this.storage.saveModule(v);
      }
    }

    module.status = 'active';
    module.updatedAt = new Date().toISOString();
    await this.storage.saveModule(module);

    return { success: true, data: module };
  }

  async deprecateModule(moduleId: string): Promise<CatalogResult<CatalogModule>> {
    const module = await this.storage.getModule(moduleId);
    if (!module) {
      return { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' };
    }

    module.status = 'deprecated';
    module.updatedAt = new Date().toISOString();
    await this.storage.saveModule(module);

    return { success: true, data: module };
  }

  async archiveModule(moduleId: string): Promise<CatalogResult<CatalogModule>> {
    const module = await this.storage.getModule(moduleId);
    if (!module) {
      return { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' };
    }

    module.status = 'archived';
    module.updatedAt = new Date().toISOString();
    await this.storage.saveModule(module);

    return { success: true, data: module };
  }

  async deleteModule(moduleId: string): Promise<CatalogResult<void>> {
    await this.storage.deleteModule(moduleId);
    return { success: true };
  }

  // ===========================================================================
  // Parameter Validation
  // ===========================================================================

  validateParameters(
    module: CatalogModule,
    values: Record<string, unknown>,
  ): { valid: boolean; errors: Array<{ parameter: string; error: string }> } {
    const errors: Array<{ parameter: string; error: string }> = [];

    for (const param of module.parameters) {
      const value = values[param.name];

      // Check required
      if (param.required && (value === undefined || value === null || value === '')) {
        errors.push({ parameter: param.name, error: 'Required parameter is missing' });
        continue;
      }

      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      switch (param.type) {
        case 'string':
        case 'secret':
          if (typeof value !== 'string') {
            errors.push({ parameter: param.name, error: 'Expected string value' });
          } else if (param.validation) {
            const regex = new RegExp(param.validation);
            if (!regex.test(value)) {
              errors.push({ parameter: param.name, error: `Value does not match pattern: ${param.validation}` });
            }
          }
          break;

        case 'number':
          if (typeof value !== 'number') {
            errors.push({ parameter: param.name, error: 'Expected number value' });
          } else {
            if (param.min !== undefined && value < param.min) {
              errors.push({ parameter: param.name, error: `Value must be >= ${param.min}` });
            }
            if (param.max !== undefined && value > param.max) {
              errors.push({ parameter: param.name, error: `Value must be <= ${param.max}` });
            }
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push({ parameter: param.name, error: 'Expected boolean value' });
          }
          break;

        case 'select':
          if (!param.options?.some(o => o.value === value)) {
            errors.push({ parameter: param.name, error: 'Invalid option selected' });
          }
          break;

        case 'multi-select':
          if (!Array.isArray(value)) {
            errors.push({ parameter: param.name, error: 'Expected array value' });
          } else {
            const validOptions = param.options?.map(o => o.value) ?? [];
            for (const v of value) {
              if (!validOptions.includes(v as string)) {
                errors.push({ parameter: param.name, error: `Invalid option: ${v}` });
              }
            }
          }
          break;
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ===========================================================================
  // Preset Modules
  // ===========================================================================

  createVPCModule(ownerId: string, tenantId?: string): Omit<CatalogModule, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      tenantId,
      name: 'aws-vpc-standard',
      description: 'Standard AWS VPC with public/private subnets, NAT gateway, and flow logs',
      version: '1.0.0',
      category: 'networking',
      tags: ['networking', 'vpc', 'foundation'],
      provider: 'aws',
      source: {
        type: 'registry',
        url: 'terraform-aws-modules/vpc/aws',
        ref: '5.0.0',
      },
      parameters: [
        {
          name: 'vpc_cidr',
          label: 'VPC CIDR Block',
          description: 'The CIDR block for the VPC',
          type: 'string',
          required: true,
          default: '10.0.0.0/16',
          validation: '^([0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2}$',
        },
        {
          name: 'availability_zones',
          label: 'Availability Zones',
          type: 'number',
          required: true,
          default: 3,
          min: 2,
          max: 6,
        },
        {
          name: 'enable_nat_gateway',
          label: 'Enable NAT Gateway',
          type: 'boolean',
          required: false,
          default: true,
        },
        {
          name: 'single_nat_gateway',
          label: 'Single NAT Gateway',
          description: 'Use a single NAT gateway for all AZs (cost savings)',
          type: 'boolean',
          required: false,
          default: false,
        },
      ],
      outputs: [
        { name: 'vpc_id', type: 'string' },
        { name: 'private_subnet_ids', type: 'list' },
        { name: 'public_subnet_ids', type: 'list' },
      ],
      compliance: ['soc2', 'hipaa'],
      estimatedCost: { minCents: 3500, maxCents: 15000, currency: 'USD' },
      estimatedDeploymentMinutes: 10,
      status: 'active',
      ownerId,
    };
  }

  createEKSModule(ownerId: string, tenantId?: string): Omit<CatalogModule, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      tenantId,
      name: 'aws-eks-cluster',
      description: 'Production-ready EKS cluster with managed node groups and add-ons',
      version: '1.0.0',
      category: 'container',
      tags: ['kubernetes', 'eks', 'container'],
      provider: 'aws',
      source: {
        type: 'registry',
        url: 'terraform-aws-modules/eks/aws',
        ref: '19.0.0',
      },
      parameters: [
        {
          name: 'cluster_name',
          label: 'Cluster Name',
          type: 'string',
          required: true,
          validation: '^[a-zA-Z][a-zA-Z0-9-]{0,99}$',
        },
        {
          name: 'kubernetes_version',
          label: 'Kubernetes Version',
          type: 'select',
          required: true,
          default: '1.28',
          options: [
            { value: '1.28', label: '1.28 (Latest)' },
            { value: '1.27', label: '1.27' },
            { value: '1.26', label: '1.26' },
          ],
        },
        {
          name: 'node_instance_type',
          label: 'Node Instance Type',
          type: 'select',
          required: true,
          default: 'm5.large',
          options: [
            { value: 't3.medium', label: 't3.medium (Dev)' },
            { value: 'm5.large', label: 'm5.large (Standard)' },
            { value: 'm5.xlarge', label: 'm5.xlarge (Large)' },
            { value: 'c5.xlarge', label: 'c5.xlarge (Compute)' },
          ],
        },
        {
          name: 'min_nodes',
          label: 'Minimum Nodes',
          type: 'number',
          required: true,
          default: 2,
          min: 1,
          max: 10,
        },
        {
          name: 'max_nodes',
          label: 'Maximum Nodes',
          type: 'number',
          required: true,
          default: 10,
          min: 1,
          max: 100,
        },
      ],
      outputs: [
        { name: 'cluster_endpoint', type: 'string' },
        { name: 'cluster_ca_certificate', type: 'string', sensitive: true },
        { name: 'node_group_arns', type: 'list' },
      ],
      compliance: ['soc2', 'hipaa', 'pci_dss'],
      estimatedCost: { minCents: 15000, maxCents: 100000, currency: 'USD' },
      estimatedDeploymentMinutes: 20,
      requiredApprovals: { roles: ['platform-admin', 'security-admin'], minApprovers: 1 },
      status: 'active',
      ownerId,
    };
  }

  createRDSModule(ownerId: string, tenantId?: string): Omit<CatalogModule, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      tenantId,
      name: 'aws-rds-postgres',
      description: 'Managed PostgreSQL database with Multi-AZ, encryption, and automated backups',
      version: '1.0.0',
      category: 'database',
      tags: ['database', 'postgres', 'rds'],
      provider: 'aws',
      source: {
        type: 'registry',
        url: 'terraform-aws-modules/rds/aws',
        ref: '6.0.0',
      },
      parameters: [
        {
          name: 'identifier',
          label: 'Database Identifier',
          type: 'string',
          required: true,
          validation: '^[a-zA-Z][a-zA-Z0-9-]{0,62}$',
        },
        {
          name: 'engine_version',
          label: 'PostgreSQL Version',
          type: 'select',
          required: true,
          default: '15',
          options: [
            { value: '15', label: 'PostgreSQL 15 (Latest)' },
            { value: '14', label: 'PostgreSQL 14' },
            { value: '13', label: 'PostgreSQL 13' },
          ],
        },
        {
          name: 'instance_class',
          label: 'Instance Class',
          type: 'select',
          required: true,
          default: 'db.t3.medium',
          options: [
            { value: 'db.t3.micro', label: 'db.t3.micro (Dev)' },
            { value: 'db.t3.medium', label: 'db.t3.medium (Standard)' },
            { value: 'db.r5.large', label: 'db.r5.large (Production)' },
            { value: 'db.r5.xlarge', label: 'db.r5.xlarge (Large)' },
          ],
        },
        {
          name: 'allocated_storage',
          label: 'Storage (GB)',
          type: 'number',
          required: true,
          default: 100,
          min: 20,
          max: 65536,
        },
        {
          name: 'multi_az',
          label: 'Multi-AZ Deployment',
          type: 'boolean',
          required: false,
          default: true,
        },
        {
          name: 'master_password',
          label: 'Master Password',
          type: 'secret',
          required: true,
          sensitive: true,
        },
      ],
      outputs: [
        { name: 'endpoint', type: 'string' },
        { name: 'port', type: 'number' },
        { name: 'database_name', type: 'string' },
      ],
      compliance: ['soc2', 'hipaa', 'pci_dss', 'gdpr'],
      estimatedCost: { minCents: 5000, maxCents: 50000, currency: 'USD' },
      estimatedDeploymentMinutes: 15,
      requiredApprovals: { roles: ['data-admin', 'security-admin'], minApprovers: 1 },
      restrictions: {
        allowedEnvironments: ['dev', 'staging', 'production'],
      },
      status: 'active',
      ownerId,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCatalogModuleService(config?: ModuleServiceConfig): CatalogModuleService {
  return new CatalogModuleService(config);
}
