/**
 * IDIO Integration Example
 * 
 * This example demonstrates a complete workflow using the Intent-Driven
 * Infrastructure Orchestration (IDIO) system to deploy a production-ready
 * three-tier web application on AWS.
 * 
 * Run with: npx tsx examples/idio-integration.ts
 */

import { 
  createIDIOOrchestrator,
  IDIOOrchestrator,
} from '../src/idio/orchestrator.js';
import type { ApplicationIntent } from '../src/intent/types.js';

// =============================================================================
// Example Configuration
// =============================================================================

const EXAMPLE_CONFIG = {
  // Set to true to actually provision resources (requires AWS credentials)
  realProvisioning: false,
  
  // AWS region for deployment
  region: 'us-east-1',
  
  // Application name
  appName: 'idio-demo-app',
};

// =============================================================================
// Example Intent Definitions
// =============================================================================

/**
 * Example 1: Simple Development API
 * A lightweight API for development/testing
 */
const developmentApiIntent: ApplicationIntent = {
  name: `${EXAMPLE_CONFIG.appName}-dev`,
  description: 'Development API for testing',
  environment: 'development',
  availability: 'best-effort',
  primaryRegion: EXAMPLE_CONFIG.region,
  cost: {
    monthlyBudgetUsd: 100,
    prioritizeCost: true,
    alertThreshold: 80,
  },
  compliance: ['none'],
  security: {
    encryptionAtRest: true,
    encryptionInTransit: true,
    networkIsolation: 'private-subnet',
  },
  tiers: [
    {
      type: 'api',
      trafficPattern: 'burst',
      runtime: {
        language: 'nodejs',
        version: '20',
        containerImage: 'node:20-alpine',
        healthCheckPath: '/health',
      },
      scaling: {
        min: 1,
        max: 4,
        targetCpuUtilization: 70,
      },
    },
    {
      type: 'database',
      trafficPattern: 'steady',
      dataSizeGb: 10,
      scaling: {
        min: 1,
        max: 1,
      },
      dependsOn: ['api'],
    },
  ],
  tags: {
    Environment: 'development',
    Project: 'IDIO-Demo',
  },
};

/**
 * Example 2: Production Three-Tier Web Application
 * A highly available web application with caching
 */
const productionWebAppIntent: ApplicationIntent = {
  name: `${EXAMPLE_CONFIG.appName}-prod`,
  description: 'Production web application with high availability',
  environment: 'production',
  availability: '99.99',
  primaryRegion: EXAMPLE_CONFIG.region,
  additionalRegions: ['us-west-2'],
  cost: {
    monthlyBudgetUsd: 5000,
    prioritizeCost: false,
    alertThreshold: 90,
  },
  compliance: ['soc2'],
  security: {
    encryptionAtRest: true,
    encryptionInTransit: true,
    networkIsolation: 'vpc-isolated',
    mfaRequired: true,
    wafEnabled: true,
    ddosProtectionEnabled: true,
  },
  tiers: [
    {
      type: 'web',
      trafficPattern: 'predictable-daily',
      expectedRps: 5000,
      runtime: {
        language: 'nodejs',
        version: '20',
        containerImage: 'node:20-alpine',
        healthCheckPath: '/health',
        startupTimeSeconds: 30,
      },
      scaling: {
        min: 4,
        max: 20,
        targetCpuUtilization: 60,
        scaleUpCooldown: 60,
        scaleDownCooldown: 300,
      },
    },
    {
      type: 'api',
      trafficPattern: 'predictable-daily',
      expectedRps: 20000,
      runtime: {
        language: 'nodejs',
        version: '20',
        containerImage: 'node:20-alpine',
        healthCheckPath: '/api/health',
      },
      scaling: {
        min: 6,
        max: 50,
        targetCpuUtilization: 50,
      },
      dependsOn: ['web'],
    },
    {
      type: 'cache',
      trafficPattern: 'predictable-daily',
      scaling: {
        min: 2,
        max: 6,
      },
      dependsOn: ['api'],
    },
    {
      type: 'database',
      trafficPattern: 'steady',
      dataSizeGb: 500,
      scaling: {
        min: 2,
        max: 2,
      },
      dependsOn: ['api'],
    },
  ],
  disasterRecovery: {
    rtoMinutes: 15,
    rpoMinutes: 5,
    crossRegionReplication: true,
    backupRetentionDays: 30,
    automaticFailover: true,
    testingFrequency: 'monthly',
  },
  tags: {
    Environment: 'production',
    Project: 'IDIO-Demo',
    CostCenter: 'engineering',
    Owner: 'platform-team',
  },
};

/**
 * Example 3: Serverless Data Pipeline
 * An event-driven data processing pipeline
 */
const dataPipelineIntent: ApplicationIntent = {
  name: `${EXAMPLE_CONFIG.appName}-pipeline`,
  description: 'Serverless data processing pipeline',
  environment: 'production',
  availability: '99.9',
  primaryRegion: EXAMPLE_CONFIG.region,
  cost: {
    monthlyBudgetUsd: 1000,
    prioritizeCost: true,
    alertThreshold: 80,
  },
  compliance: ['none'],
  security: {
    encryptionAtRest: true,
    encryptionInTransit: true,
    networkIsolation: 'private-subnet',
  },
  tiers: [
    {
      type: 'queue',
      trafficPattern: 'burst',
      scaling: {
        min: 1,
        max: 100,
      },
    },
    {
      type: 'storage',
      trafficPattern: 'steady',
      dataSizeGb: 1000,
      scaling: {
        min: 1,
        max: 1,
      },
    },
    {
      type: 'analytics',
      trafficPattern: 'predictable-daily',
      scaling: {
        min: 1,
        max: 10,
        strategy: 'scheduled',
      },
      dependsOn: ['queue', 'storage'],
    },
  ],
  tags: {
    Environment: 'production',
    Project: 'IDIO-Demo',
    Type: 'data-pipeline',
  },
};

// =============================================================================
// Main Workflow
// =============================================================================

async function runIDIOWorkflow() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IDIO (Intent-Driven Infrastructure Orchestration) Demo');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Initialize the IDIO orchestrator
  const orchestrator = createIDIOOrchestrator({
    compiler: {},
    policyEngine: {
      enableAutoFix: true,
      failOnCritical: true,
    },
    reconciliation: {
      intervalMinutes: 30,
      enableAutoRemediation: false,
      costAnomalyThreshold: 20,
      maxRemediationAttempts: 3,
    },
  });

  // Example 1: Deploy Development API
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  Example 1: Development API                                 │');
  console.log('└─────────────────────────────────────────────────────────────┘\n');
  await demonstrateWorkflow(orchestrator, developmentApiIntent);

  // Example 2: Deploy Production Web App
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  Example 2: Production Web Application                      │');
  console.log('└─────────────────────────────────────────────────────────────┘\n');
  await demonstrateWorkflow(orchestrator, productionWebAppIntent);

  // Example 3: Deploy Data Pipeline
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  Example 3: Data Pipeline                                   │');
  console.log('└─────────────────────────────────────────────────────────────┘\n');
  await demonstrateWorkflow(orchestrator, dataPipelineIntent);

  // Demonstrate template usage
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  Available Templates                                        │');
  console.log('└─────────────────────────────────────────────────────────────┘\n');
  demonstrateTemplates(orchestrator);
}

async function demonstrateWorkflow(
  orchestrator: IDIOOrchestrator,
  intent: ApplicationIntent,
) {
  console.log(`📝 Intent: ${intent.name}`);
  console.log(`   Environment: ${intent.environment}`);
  console.log(`   Availability: ${intent.availability}`);
  console.log(`   Region: ${intent.primaryRegion}`);
  console.log(`   Tiers: ${intent.tiers.map(t => t.type).join(', ')}`);
  console.log();

  // Step 1: Validate the intent
  console.log('1️⃣  Validating intent...');
  const validationResult = await orchestrator.validateIntent(intent);
  if (validationResult.success) {
    console.log('   ✅ Intent is valid');
  } else {
    console.log('   ❌ Validation failed:', validationResult.errors?.join(', '));
    return;
  }

  // Step 2: Estimate costs
  console.log('\n2️⃣  Estimating costs...');
  const costResult = await orchestrator.estimateCost(intent);
  if (costResult.success && costResult.data) {
    const costData = costResult.data as { totalMonthlyUsd?: number };
    console.log(`   💰 Estimated monthly cost: $${costData.totalMonthlyUsd?.toFixed(2) ?? 'N/A'}`);
    console.log(`   📊 Budget: $${intent.cost.monthlyBudgetUsd}/month`);
    
    if (costData.totalMonthlyUsd && costData.totalMonthlyUsd > intent.cost.monthlyBudgetUsd) {
      console.log('   ⚠️  Warning: Estimated cost exceeds budget!');
    }
  }

  // Step 3: Create the plan
  console.log('\n3️⃣  Creating infrastructure plan...');
  const planResult = await orchestrator.createPlanFromIntent(intent);
  if (planResult.success && planResult.data) {
    const planData = planResult.data as { 
      planId?: string; 
      resourceCount?: number;
      estimatedCostUsd?: number;
    };
    console.log(`   📋 Plan ID: ${planData.planId ?? 'N/A'}`);
    console.log(`   🏗️  Resources to create: ${planData.resourceCount ?? 'N/A'}`);
    
    // Step 4: Dry run (preview)
    if (planData.planId) {
      console.log('\n4️⃣  Previewing deployment (dry run)...');
      const dryRunResult = await orchestrator.executePlan(planData.planId, { dryRun: true });
      if (dryRunResult.success) {
        console.log('   🔍 Dry run successful - resources would be created');
        const dryRunData = dryRunResult.data as { resources?: { type: string }[] };
        if (dryRunData.resources) {
          console.log(`   📦 Resource types: ${dryRunData.resources.map(r => r.type).join(', ')}`);
        }
      }

      // Step 5: Execute (only if real provisioning is enabled)
      if (EXAMPLE_CONFIG.realProvisioning) {
        console.log('\n5️⃣  Executing plan (real provisioning)...');
        const executeResult = await orchestrator.executePlan(planData.planId, { 
          dryRun: false,
          autoApprove: false,
        });
        if (executeResult.success) {
          console.log('   ✅ Deployment initiated');
          const execData = executeResult.data as { executionId?: string };
          if (execData.executionId) {
            console.log(`   🆔 Execution ID: ${execData.executionId}`);
          }
        } else {
          console.log('   ❌ Deployment failed:', executeResult.errors?.join(', '));
        }
      } else {
        console.log('\n5️⃣  Skipping real deployment (set realProvisioning=true to deploy)');
      }
    }
  } else {
    console.log('   ❌ Planning failed:', planResult.errors?.join(', '));
  }
}

function demonstrateTemplates(orchestrator: IDIOOrchestrator) {
  const templatesResult = orchestrator.listTemplates();
  
  if (templatesResult.success && templatesResult.data) {
    const data = templatesResult.data as { templates: { id: string; name: string; description: string }[] };
    console.log('Available infrastructure templates:\n');
    
    for (const template of data.templates) {
      console.log(`  📁 ${template.id}`);
      console.log(`     ${template.name}`);
      console.log(`     ${template.description}\n`);
    }
  } else {
    console.log('No templates available or failed to load templates.');
  }
}

// =============================================================================
// Run the demo
// =============================================================================

runIDIOWorkflow()
  .then(() => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Demo completed successfully!');
    console.log('═══════════════════════════════════════════════════════════════\n');
  })
  .catch((error) => {
    console.error('Demo failed:', error);
    process.exit(1);
  });
