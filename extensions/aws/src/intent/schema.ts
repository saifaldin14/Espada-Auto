/**
 * JSON Schema definitions for Intent-Driven Infrastructure Orchestration
 * 
 * These schemas validate intent specifications and provide TypeBox/JSON Schema
 * definitions for agent tool parameters.
 */

import { Type, type Static } from '@sinclair/typebox';
import { Check } from '@sinclair/typebox/value';
import { Errors } from '@sinclair/typebox/errors';

// Compliance Frameworks
export const ComplianceFrameworkSchema = Type.Union([
  Type.Literal('hipaa'),
  Type.Literal('soc2'),
  Type.Literal('pci-dss'),
  Type.Literal('gdpr'),
  Type.Literal('iso27001'),
  Type.Literal('fedramp'),
  Type.Literal('none'),
]);

// Application Tiers
export const ApplicationTierSchema = Type.Union([
  Type.Literal('web'),
  Type.Literal('api'),
  Type.Literal('database'),
  Type.Literal('cache'),
  Type.Literal('queue'),
  Type.Literal('storage'),
  Type.Literal('analytics'),
]);

// Traffic Patterns
export const TrafficPatternSchema = Type.Union([
  Type.Literal('steady'),
  Type.Literal('burst'),
  Type.Literal('predictable-daily'),
  Type.Literal('predictable-weekly'),
  Type.Literal('seasonal'),
  Type.Literal('unpredictable'),
]);

// Environments
export const EnvironmentSchema = Type.Union([
  Type.Literal('development'),
  Type.Literal('staging'),
  Type.Literal('production'),
  Type.Literal('disaster-recovery'),
]);

// Availability Requirements
export const AvailabilityRequirementSchema = Type.Union([
  Type.Literal('99.9'),
  Type.Literal('99.95'),
  Type.Literal('99.99'),
  Type.Literal('99.999'),
  Type.Literal('best-effort'),
]);

// Cost Constraint Schema
export const CostConstraintSchema = Type.Object({
  monthlyBudgetUsd: Type.Number({ minimum: 0, description: 'Maximum monthly budget in USD' }),
  prioritizeCost: Type.Optional(Type.Boolean({ description: 'Prioritize cost optimization over performance' })),
  alertThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 100, description: 'Alert threshold percentage' })),
  maxHourlyRate: Type.Optional(Type.Number({ minimum: 0, description: 'Maximum hourly spend rate in USD' })),
  reservationStrategy: Type.Optional(Type.Union([
    Type.Literal('none'),
    Type.Literal('conservative'),
    Type.Literal('aggressive'),
  ])),
});

// Disaster Recovery Schema
export const DisasterRecoveryRequirementSchema = Type.Object({
  rtoMinutes: Type.Number({ minimum: 0, description: 'Recovery Time Objective in minutes' }),
  rpoMinutes: Type.Number({ minimum: 0, description: 'Recovery Point Objective in minutes' }),
  crossRegionReplication: Type.Boolean({ description: 'Enable cross-region replication' }),
  backupRetentionDays: Type.Number({ minimum: 1, description: 'Backup retention in days' }),
  automaticFailover: Type.Optional(Type.Boolean()),
  testingFrequency: Type.Optional(Type.Union([
    Type.Literal('weekly'),
    Type.Literal('monthly'),
    Type.Literal('quarterly'),
  ])),
});

// Scaling Requirement Schema
export const ScalingRequirementSchema = Type.Object({
  min: Type.Number({ minimum: 1, description: 'Minimum capacity' }),
  max: Type.Number({ minimum: 1, description: 'Maximum capacity' }),
  targetCpuUtilization: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  targetRequestCount: Type.Optional(Type.Number({ minimum: 1 })),
  scaleUpCooldown: Type.Optional(Type.Number({ minimum: 0 })),
  scaleDownCooldown: Type.Optional(Type.Number({ minimum: 0 })),
  strategy: Type.Optional(Type.Union([
    Type.Literal('reactive'),
    Type.Literal('predictive'),
    Type.Literal('scheduled'),
  ])),
});

// Security Requirement Schema
export const SecurityRequirementSchema = Type.Object({
  encryptionAtRest: Type.Boolean(),
  encryptionInTransit: Type.Boolean(),
  networkIsolation: Type.Union([
    Type.Literal('none'),
    Type.Literal('private-subnet'),
    Type.Literal('vpc-isolated'),
    Type.Literal('airgapped'),
  ]),
  mfaRequired: Type.Optional(Type.Boolean()),
  allowedIngressCidrs: Type.Optional(Type.Array(Type.String())),
  wafEnabled: Type.Optional(Type.Boolean()),
  ddosProtectionEnabled: Type.Optional(Type.Boolean()),
  secretRotationEnabled: Type.Optional(Type.Boolean()),
});

// Runtime Configuration Schema
export const RuntimeConfigurationSchema = Type.Object({
  language: Type.Optional(Type.Union([
    Type.Literal('nodejs'),
    Type.Literal('python'),
    Type.Literal('java'),
    Type.Literal('go'),
    Type.Literal('dotnet'),
    Type.Literal('ruby'),
  ])),
  version: Type.Optional(Type.String()),
  containerImage: Type.Optional(Type.String()),
  entryPoint: Type.Optional(Type.String()),
  environmentVariables: Type.Optional(Type.Record(Type.String(), Type.String())),
  healthCheckPath: Type.Optional(Type.String()),
  startupTimeSeconds: Type.Optional(Type.Number({ minimum: 0 })),
});

// Application Tier Intent Schema
export const ApplicationTierIntentSchema = Type.Object({
  type: ApplicationTierSchema,
  trafficPattern: TrafficPatternSchema,
  expectedRps: Type.Optional(Type.Number({ minimum: 0 })),
  dataSizeGb: Type.Optional(Type.Number({ minimum: 0 })),
  scaling: Type.Optional(ScalingRequirementSchema),
  runtime: Type.Optional(RuntimeConfigurationSchema),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  customConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

// Application Intent Schema (Main)
export const ApplicationIntentSchema = Type.Object({
  name: Type.String({ minLength: 1, description: 'Application name' }),
  description: Type.Optional(Type.String()),
  tiers: Type.Array(ApplicationTierIntentSchema, { minItems: 1 }),
  environment: EnvironmentSchema,
  availability: AvailabilityRequirementSchema,
  cost: CostConstraintSchema,
  compliance: Type.Array(ComplianceFrameworkSchema),
  security: SecurityRequirementSchema,
  disasterRecovery: Type.Optional(DisasterRecoveryRequirementSchema),
  tags: Type.Optional(Type.Record(Type.String(), Type.String())),
  primaryRegion: Type.String({ minLength: 1, description: 'Primary AWS region' }),
  additionalRegions: Type.Optional(Type.Array(Type.String())),
});

export type ApplicationIntentSchemaType = Static<typeof ApplicationIntentSchema>;

// Agent Tool Schema for Intent Provisioning
export const IntentProvisionToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('create-from-intent'),
    Type.Literal('create-from-template'),
    Type.Literal('validate-intent'),
    Type.Literal('estimate-cost'),
    Type.Literal('execute-plan'),
    Type.Literal('check-status'),
    Type.Literal('rollback'),
  ], { description: 'Action to perform' }),
  
  // For create-from-intent
  intent: Type.Optional(ApplicationIntentSchema),
  
  // For create-from-template
  templateId: Type.Optional(Type.String({ description: 'Template identifier' })),
  templateParameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  
  // For validate-intent, estimate-cost
  intentJson: Type.Optional(Type.String({ description: 'JSON string of intent' })),
  
  // For execute-plan, check-status, rollback
  planId: Type.Optional(Type.String({ description: 'Infrastructure plan ID' })),
  executionId: Type.Optional(Type.String({ description: 'Execution ID' })),
  
  // Common options
  dryRun: Type.Optional(Type.Boolean({ description: 'Simulate without executing' })),
  autoApprove: Type.Optional(Type.Boolean({ description: 'Skip approval workflow' })),
  region: Type.Optional(Type.String({ description: 'Override primary region' })),
});

export type IntentProvisionToolSchemaType = Static<typeof IntentProvisionToolSchema>;

// Reconciliation Tool Schema
export const ReconciliationToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('check-drift'),
    Type.Literal('check-compliance'),
    Type.Literal('check-cost-anomalies'),
    Type.Literal('remediate'),
    Type.Literal('generate-report'),
  ]),
  planId: Type.Optional(Type.String()),
  executionId: Type.Optional(Type.String()),
  autoRemediate: Type.Optional(Type.Boolean()),
  reportFormat: Type.Optional(Type.Union([
    Type.Literal('json'),
    Type.Literal('markdown'),
    Type.Literal('html'),
  ])),
});

// Template Management Tool Schema
export const TemplateToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('list-templates'),
    Type.Literal('get-template'),
    Type.Literal('create-template'),
    Type.Literal('validate-parameters'),
  ]),
  templateId: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  templateDefinition: Type.Optional(Type.Unknown()),
});

/**
 * Validates an application intent against the TypeBox schema.
 *
 * Uses compiled TypeBox validation so that values like
 * `availability: "banana"` are properly rejected.
 */
export function validateIntent(intent: unknown): { 
  valid: boolean; 
  errors?: string[]; 
  intent?: ApplicationIntentSchemaType;
} {
  try {
    if (!intent || typeof intent !== 'object') {
      return { valid: false, errors: ['Intent must be an object'] };
    }

    if (Check(ApplicationIntentSchema, intent)) {
      return { valid: true, intent: intent as ApplicationIntentSchemaType };
    }

    // Collect detailed errors from the TypeBox schema
    const errors: string[] = [];
    for (const error of Errors(ApplicationIntentSchema, intent)) {
      const path = error.path || '(root)';
      errors.push(`${path}: ${error.message}`);
    }

    return { valid: false, errors: errors.length > 0 ? errors : ['Intent does not match schema'] };
  } catch (error) {
    return { 
      valid: false, 
      errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`] 
    };
  }
}

/**
 * Example intent specifications
 */
export const EXAMPLE_INTENTS = {
  simpleWebApp: {
    name: 'Simple Web Application',
    description: 'Basic three-tier web application',
    tiers: [
      {
        type: 'web',
        trafficPattern: 'steady',
        expectedRps: 100,
        scaling: { min: 2, max: 10, targetCpuUtilization: 70 },
        runtime: {
          language: 'nodejs',
          version: '20',
          healthCheckPath: '/health',
        },
      },
      {
        type: 'database',
        trafficPattern: 'steady',
        dataSizeGb: 50,
        dependsOn: [],
      },
    ],
    environment: 'production',
    availability: '99.9',
    cost: {
      monthlyBudgetUsd: 500,
      alertThreshold: 80,
    },
    compliance: ['none'],
    security: {
      encryptionAtRest: true,
      encryptionInTransit: true,
      networkIsolation: 'private-subnet',
    },
    primaryRegion: 'us-east-1',
  },
  
  highAvailabilityApp: {
    name: 'High Availability E-Commerce Platform',
    description: 'Mission-critical e-commerce platform with 99.99% uptime',
    tiers: [
      {
        type: 'web',
        trafficPattern: 'seasonal',
        expectedRps: 5000,
        scaling: { min: 10, max: 100, targetCpuUtilization: 60, strategy: 'predictive' },
      },
      {
        type: 'api',
        trafficPattern: 'seasonal',
        expectedRps: 10000,
        scaling: { min: 20, max: 200, targetCpuUtilization: 65 },
      },
      {
        type: 'database',
        trafficPattern: 'seasonal',
        dataSizeGb: 500,
      },
      {
        type: 'cache',
        trafficPattern: 'seasonal',
      },
    ],
    environment: 'production',
    availability: '99.99',
    cost: {
      monthlyBudgetUsd: 10000,
      alertThreshold: 90,
      reservationStrategy: 'aggressive',
    },
    compliance: ['pci-dss', 'soc2'],
    security: {
      encryptionAtRest: true,
      encryptionInTransit: true,
      networkIsolation: 'vpc-isolated',
      wafEnabled: true,
      ddosProtectionEnabled: true,
      secretRotationEnabled: true,
    },
    disasterRecovery: {
      rtoMinutes: 15,
      rpoMinutes: 5,
      crossRegionReplication: true,
      backupRetentionDays: 30,
      automaticFailover: true,
      testingFrequency: 'monthly',
    },
    primaryRegion: 'us-east-1',
    additionalRegions: ['us-west-2', 'eu-west-1'],
  },
} as const;
