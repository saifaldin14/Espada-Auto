/**
 * Infrastructure Catalog - Pre-validated infrastructure templates
 * 
 * Provides reusable, production-ready infrastructure patterns for common
 * application architectures.
 */

import type {
  IntentTemplate,
  ApplicationIntent,
  TemplateParameter,
  IntentTemplateExample,
} from '../intent/types.js';

/**
 * Template index for O(1) lookups
 */
const TEMPLATE_INDEX = new Map<string, IntentTemplate>();
const CATEGORY_INDEX = new Map<string, IntentTemplate[]>();

/**
 * Catalog of pre-built infrastructure templates
 */
export const INFRASTRUCTURE_CATALOG: IntentTemplate[] = [
  {
    id: 'three-tier-web-app',
    name: 'Three-Tier Web Application',
    description: 'Classic three-tier architecture with web, application, and database layers. Includes load balancing, auto-scaling, and managed database.',
    category: 'web-application',
    version: '1.0.0',
    intentTemplate: {
      tiers: [
        {
          type: 'web',
          trafficPattern: 'steady',
          scaling: {
            min: 2,
            max: 10,
            targetCpuUtilization: 70,
          },
        },
        {
          type: 'api',
          trafficPattern: 'steady',
          scaling: {
            min: 2,
            max: 10,
            targetCpuUtilization: 70,
          },
        },
        {
          type: 'database',
          trafficPattern: 'steady',
        },
      ],
      security: {
        encryptionAtRest: true,
        encryptionInTransit: true,
        networkIsolation: 'private-subnet',
      },
      compliance: ['none'],
    },
    requiredParameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Application name',
      },
      {
        name: 'environment',
        type: 'string',
        description: 'Deployment environment',
        validation: {
          allowedValues: ['development', 'staging', 'production'],
          required: true,
        },
      },
      {
        name: 'monthlyBudget',
        type: 'number',
        description: 'Monthly budget in USD',
        validation: {
          min: 100,
          required: true,
        },
      },
      {
        name: 'primaryRegion',
        type: 'string',
        description: 'AWS region for deployment',
        defaultValue: 'us-east-1',
      },
    ],
    optionalParameters: [
      {
        name: 'expectedTraffic',
        type: 'number',
        description: 'Expected requests per second',
        defaultValue: 100,
      },
      {
        name: 'databaseSize',
        type: 'number',
        description: 'Estimated database size in GB',
        defaultValue: 50,
      },
    ],
    examples: [
      {
        name: 'Small Startup MVP',
        description: 'Cost-optimized setup for startup MVP',
        parameters: {
          name: 'my-startup-app',
          environment: 'production',
          monthlyBudget: 300,
          expectedTraffic: 50,
          databaseSize: 20,
        },
        estimatedCostUsd: 280,
      },
      {
        name: 'Growing SaaS',
        description: 'Moderate traffic SaaS application',
        parameters: {
          name: 'saas-platform',
          environment: 'production',
          monthlyBudget: 1000,
          expectedTraffic: 500,
          databaseSize: 200,
        },
        estimatedCostUsd: 950,
      },
    ],
    costRangeUsd: [200, 2000],
    tags: ['web', 'database', 'auto-scaling', 'production-ready'],
  },

  {
    id: 'serverless-api',
    name: 'Serverless API',
    description: 'Cost-effective serverless API using Lambda, API Gateway, and DynamoDB. Perfect for APIs with variable traffic.',
    category: 'web-application',
    version: '1.0.0',
    intentTemplate: {
      tiers: [
        {
          type: 'api',
          trafficPattern: 'burst',
          runtime: {
            language: 'nodejs',
            version: '20',
          },
        },
        {
          type: 'database',
          trafficPattern: 'burst',
        },
      ],
      security: {
        encryptionAtRest: true,
        encryptionInTransit: true,
        networkIsolation: 'none',
      },
      compliance: ['none'],
    },
    requiredParameters: [
      {
        name: 'name',
        type: 'string',
        description: 'API name',
      },
      {
        name: 'environment',
        type: 'string',
        description: 'Deployment environment',
      },
      {
        name: 'monthlyBudget',
        type: 'number',
        description: 'Monthly budget in USD',
      },
      {
        name: 'primaryRegion',
        type: 'string',
        description: 'AWS region',
      },
    ],
    optionalParameters: [
      {
        name: 'runtime',
        type: 'string',
        description: 'Lambda runtime',
        defaultValue: 'nodejs20.x',
        validation: {
          allowedValues: ['nodejs20.x', 'python3.12', 'java21'],
        },
      },
    ],
    examples: [
      {
        name: 'Webhook Handler',
        description: 'Simple webhook processing API',
        parameters: {
          name: 'webhook-api',
          environment: 'production',
          monthlyBudget: 50,
          runtime: 'nodejs20.x',
        },
        estimatedCostUsd: 15,
      },
    ],
    costRangeUsd: [10, 200],
    tags: ['serverless', 'lambda', 'api', 'cost-optimized'],
  },

  {
    id: 'ecommerce-platform',
    name: 'High-Availability E-Commerce Platform',
    description: 'Enterprise-grade e-commerce platform with 99.99% uptime, multi-region deployment, and PCI-DSS compliance.',
    category: 'web-application',
    version: '1.0.0',
    intentTemplate: {
      tiers: [
        {
          type: 'web',
          trafficPattern: 'seasonal',
          scaling: {
            min: 10,
            max: 100,
            targetCpuUtilization: 60,
            strategy: 'predictive',
          },
        },
        {
          type: 'api',
          trafficPattern: 'seasonal',
          scaling: {
            min: 20,
            max: 200,
            targetCpuUtilization: 65,
          },
        },
        {
          type: 'database',
          trafficPattern: 'seasonal',
        },
        {
          type: 'cache',
          trafficPattern: 'seasonal',
        },
        {
          type: 'storage',
          trafficPattern: 'steady',
        },
      ],
      availability: '99.99',
      security: {
        encryptionAtRest: true,
        encryptionInTransit: true,
        networkIsolation: 'vpc-isolated',
        wafEnabled: true,
        ddosProtectionEnabled: true,
        secretRotationEnabled: true,
      },
      compliance: ['pci-dss', 'soc2'],
      disasterRecovery: {
        rtoMinutes: 15,
        rpoMinutes: 5,
        crossRegionReplication: true,
        backupRetentionDays: 30,
        automaticFailover: true,
        testingFrequency: 'monthly',
      },
    },
    requiredParameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Platform name',
      },
      {
        name: 'monthlyBudget',
        type: 'number',
        description: 'Monthly budget in USD',
        validation: {
          min: 5000,
        },
      },
      {
        name: 'primaryRegion',
        type: 'string',
        description: 'Primary AWS region',
      },
      {
        name: 'additionalRegions',
        type: 'array',
        description: 'Additional regions for multi-region deployment',
      },
    ],
    optionalParameters: [
      {
        name: 'peakTraffic',
        type: 'number',
        description: 'Peak requests per second during sales',
        defaultValue: 10000,
      },
    ],
    examples: [
      {
        name: 'Mid-Size Retailer',
        description: 'Regional e-commerce site',
        parameters: {
          name: 'retail-platform',
          monthlyBudget: 8000,
          primaryRegion: 'us-east-1',
          additionalRegions: ['us-west-2'],
          peakTraffic: 5000,
        },
        estimatedCostUsd: 7500,
      },
    ],
    costRangeUsd: [5000, 20000],
    tags: ['ecommerce', 'high-availability', 'pci-compliant', 'multi-region'],
  },

  {
    id: 'data-pipeline',
    name: 'Data Processing Pipeline',
    description: 'Batch and stream data processing pipeline with S3, Lambda, Kinesis, and Redshift/Athena.',
    category: 'data-pipeline',
    version: '1.0.0',
    intentTemplate: {
      tiers: [
        {
          type: 'queue',
          trafficPattern: 'burst',
        },
        {
          type: 'analytics',
          trafficPattern: 'predictable-daily',
        },
        {
          type: 'storage',
          trafficPattern: 'steady',
        },
      ],
      security: {
        encryptionAtRest: true,
        encryptionInTransit: true,
        networkIsolation: 'private-subnet',
      },
      compliance: ['none'],
    },
    requiredParameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Pipeline name',
      },
      {
        name: 'environment',
        type: 'string',
        description: 'Environment',
      },
      {
        name: 'monthlyBudget',
        type: 'number',
        description: 'Monthly budget in USD',
      },
      {
        name: 'primaryRegion',
        type: 'string',
        description: 'AWS region',
      },
    ],
    optionalParameters: [
      {
        name: 'dataVolume',
        type: 'number',
        description: 'Daily data volume in GB',
        defaultValue: 100,
      },
      {
        name: 'retentionDays',
        type: 'number',
        description: 'Data retention in days',
        defaultValue: 90,
      },
    ],
    examples: [
      {
        name: 'Analytics Pipeline',
        description: 'Customer analytics data pipeline',
        parameters: {
          name: 'analytics-pipeline',
          environment: 'production',
          monthlyBudget: 500,
          dataVolume: 50,
          retentionDays: 365,
        },
        estimatedCostUsd: 450,
      },
    ],
    costRangeUsd: [200, 5000],
    tags: ['data', 'analytics', 'etl', 'batch-processing'],
  },

  {
    id: 'microservices-platform',
    name: 'Microservices Platform',
    description: 'Container-based microservices platform with ECS/EKS, service mesh, and observability.',
    category: 'microservices',
    version: '1.0.0',
    intentTemplate: {
      tiers: [
        {
          type: 'api',
          trafficPattern: 'steady',
          runtime: {
            containerImage: 'your-registry/service:latest',
          },
          scaling: {
            min: 3,
            max: 30,
            targetCpuUtilization: 70,
          },
        },
        {
          type: 'database',
          trafficPattern: 'steady',
        },
        {
          type: 'cache',
          trafficPattern: 'steady',
        },
        {
          type: 'queue',
          trafficPattern: 'burst',
        },
      ],
      availability: '99.95',
      security: {
        encryptionAtRest: true,
        encryptionInTransit: true,
        networkIsolation: 'vpc-isolated',
      },
      compliance: ['soc2'],
    },
    requiredParameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Platform name',
      },
      {
        name: 'environment',
        type: 'string',
        description: 'Environment',
      },
      {
        name: 'monthlyBudget',
        type: 'number',
        description: 'Monthly budget in USD',
      },
      {
        name: 'primaryRegion',
        type: 'string',
        description: 'AWS region',
      },
    ],
    optionalParameters: [
      {
        name: 'serviceCount',
        type: 'number',
        description: 'Number of microservices',
        defaultValue: 5,
      },
      {
        name: 'useEKS',
        type: 'boolean',
        description: 'Use EKS instead of ECS',
        defaultValue: false,
      },
    ],
    examples: [
      {
        name: 'SaaS Backend',
        description: 'Multi-tenant SaaS microservices',
        parameters: {
          name: 'saas-backend',
          environment: 'production',
          monthlyBudget: 3000,
          serviceCount: 8,
          useEKS: true,
        },
        estimatedCostUsd: 2800,
      },
    ],
    costRangeUsd: [1000, 10000],
    tags: ['microservices', 'containers', 'kubernetes', 'service-mesh'],
  },

  {
    id: 'machine-learning-platform',
    name: 'Machine Learning Platform',
    description: 'ML platform with SageMaker, model serving, training pipelines, and feature store.',
    category: 'machine-learning',
    version: '1.0.0',
    intentTemplate: {
      tiers: [
        {
          type: 'api',
          trafficPattern: 'predictable-daily',
          runtime: {
            containerImage: 'your-registry/ml-api:latest',
          },
        },
        {
          type: 'storage',
          trafficPattern: 'steady',
        },
        {
          type: 'analytics',
          trafficPattern: 'predictable-daily',
        },
      ],
      security: {
        encryptionAtRest: true,
        encryptionInTransit: true,
        networkIsolation: 'vpc-isolated',
      },
      compliance: ['none'],
    },
    requiredParameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Platform name',
      },
      {
        name: 'environment',
        type: 'string',
        description: 'Environment',
      },
      {
        name: 'monthlyBudget',
        type: 'number',
        description: 'Monthly budget in USD',
        validation: {
          min: 500,
        },
      },
      {
        name: 'primaryRegion',
        type: 'string',
        description: 'AWS region',
      },
    ],
    optionalParameters: [
      {
        name: 'gpuRequired',
        type: 'boolean',
        description: 'Require GPU instances for training',
        defaultValue: false,
      },
      {
        name: 'modelSize',
        type: 'string',
        description: 'Model complexity',
        defaultValue: 'medium',
        validation: {
          allowedValues: ['small', 'medium', 'large'],
        },
      },
    ],
    examples: [
      {
        name: 'Recommendation Engine',
        description: 'Product recommendation ML system',
        parameters: {
          name: 'recommendation-ml',
          environment: 'production',
          monthlyBudget: 2000,
          gpuRequired: true,
          modelSize: 'medium',
        },
        estimatedCostUsd: 1800,
      },
    ],
    costRangeUsd: [500, 10000],
    tags: ['ml', 'sagemaker', 'gpu', 'model-serving'],
  },

  {
    id: 'static-website',
    name: 'Static Website with CDN',
    description: 'Static website hosted on S3 with CloudFront CDN, SSL certificate, and CI/CD pipeline.',
    category: 'web-application',
    version: '1.0.0',
    intentTemplate: {
      tiers: [
        {
          type: 'web',
          trafficPattern: 'steady',
        },
        {
          type: 'storage',
          trafficPattern: 'steady',
        },
      ],
      availability: '99.9',
      security: {
        encryptionAtRest: false,
        encryptionInTransit: true,
        networkIsolation: 'none',
      },
      compliance: ['none'],
    },
    requiredParameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Website name',
      },
      {
        name: 'domain',
        type: 'string',
        description: 'Custom domain name',
      },
      {
        name: 'monthlyBudget',
        type: 'number',
        description: 'Monthly budget in USD',
      },
      {
        name: 'primaryRegion',
        type: 'string',
        description: 'AWS region',
      },
    ],
    optionalParameters: [
      {
        name: 'trafficGBPerMonth',
        type: 'number',
        description: 'Expected monthly traffic in GB',
        defaultValue: 100,
      },
    ],
    examples: [
      {
        name: 'Company Website',
        description: 'Corporate marketing site',
        parameters: {
          name: 'company-website',
          domain: 'example.com',
          monthlyBudget: 50,
          trafficGBPerMonth: 50,
        },
        estimatedCostUsd: 20,
      },
    ],
    costRangeUsd: [10, 200],
    tags: ['static', 'cdn', 'cloudfront', 's3', 'website'],
  },
];

/**
 * Initialize template indices
 */
function initializeIndices(): void {
  if (TEMPLATE_INDEX.size === 0) {
    for (const template of INFRASTRUCTURE_CATALOG) {
      TEMPLATE_INDEX.set(template.id, template);
      
      const categoryTemplates = CATEGORY_INDEX.get(template.category) || [];
      categoryTemplates.push(template);
      CATEGORY_INDEX.set(template.category, categoryTemplates);
    }
  }
}

/**
 * Get template by ID with O(1) lookup
 */
export function getTemplate(templateId: string): IntentTemplate | undefined {
  initializeIndices();
  return TEMPLATE_INDEX.get(templateId);
}

/**
 * Search templates by category with O(1) lookup
 */
export function getTemplatesByCategory(category: string): IntentTemplate[] {
  initializeIndices();
  return CATEGORY_INDEX.get(category) || [];
}

/**
 * Search templates by tags
 */
export function searchTemplatesByTags(tags: string[]): IntentTemplate[] {
  return INFRASTRUCTURE_CATALOG.filter(t =>
    tags.some(tag => t.tags.includes(tag.toLowerCase()))
  );
}

/**
 * Apply template with user parameters
 */
export function applyTemplate(
  templateId: string,
  parameters: Record<string, unknown>,
): Partial<ApplicationIntent> | null {
  const template = getTemplate(templateId);
  if (!template) return null;

  // Validate required parameters
  const missingParams = template.requiredParameters.filter(
    param => !parameters[param.name]
  );
  
  if (missingParams.length > 0) {
    throw new Error(`Missing required parameters: ${missingParams.map(p => p.name).join(', ')}`);
  }

  // Build intent from template
  const intent: Partial<ApplicationIntent> = {
    ...template.intentTemplate,
    name: parameters.name as string,
    environment: parameters.environment as any,
    primaryRegion: parameters.primaryRegion as string,
    cost: {
      monthlyBudgetUsd: parameters.monthlyBudget as number,
      alertThreshold: 80,
    },
    tags: {
      Template: templateId,
      ManagedBy: 'espada-idio',
    },
  };

  // Apply optional parameters
  template.optionalParameters.forEach(param => {
    if (parameters[param.name] !== undefined) {
      // Parameter application logic would go here
      // This is simplified; real implementation would map parameters to intent fields
    }
  });

  return intent;
}

/**
 * List all available templates with metadata
 */
export function listTemplates(): Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  costRange: [number, number];
  tags: string[];
}> {
  return INFRASTRUCTURE_CATALOG.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    costRange: t.costRangeUsd,
    tags: t.tags,
  }));
}

/**
 * Get template categories
 */
export function getCategories(): string[] {
  return Array.from(new Set(INFRASTRUCTURE_CATALOG.map(t => t.category)));
}
