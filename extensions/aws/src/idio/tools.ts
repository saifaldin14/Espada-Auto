/**
 * IDIO Tool Definitions
 * 
 * AI Agent tool definitions for Intent-Driven Infrastructure Orchestration.
 * These tools enable conversational infrastructure management.
 */

import type { IDIOOrchestrator, IDIOResult } from './orchestrator.js';
import type { ApplicationIntent, IntentTemplate } from '../intent/types.js';

// =============================================================================
// Tool Definition Types
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ParameterDefinition>;
    required?: string[];
  };
}

export interface ParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ParameterDefinition;
  properties?: Record<string, ParameterDefinition>;
  default?: unknown;
}

export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  errors?: string[];
}

// =============================================================================
// Tool Definitions
// =============================================================================

export const idioToolDefinitions: ToolDefinition[] = [
  // =========================================================================
  // Infrastructure Planning Tools
  // =========================================================================
  {
    name: 'idio_create_infrastructure_plan',
    description: `Create an infrastructure plan from a declarative intent specification. 
This tool compiles high-level requirements into a concrete AWS infrastructure plan with:
- Resource definitions (VPC, subnets, compute, databases, etc.)
- Cost estimates
- Policy validation
- Security compliance checks
- Dependency ordering

Use this when the user wants to:
- Deploy a new application or service
- Create infrastructure from requirements
- Get a plan for what resources will be created`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the application/infrastructure (lowercase, alphanumeric with hyphens)',
        },
        environment: {
          type: 'string',
          description: 'Target environment for deployment',
          enum: ['development', 'staging', 'production'],
        },
        type: {
          type: 'string',
          description: 'Type of application/workload',
          enum: ['web-api', 'web-app', 'worker', 'batch', 'data-pipeline', 'ml-training', 'ml-inference'],
        },
        trafficPattern: {
          type: 'string',
          description: 'Expected traffic pattern for scaling configuration',
          enum: ['steady', 'bursty', 'periodic', 'growing'],
        },
        tiers: {
          type: 'array',
          description: 'Application tiers (web, api, worker, database, cache)',
          items: {
            type: 'object',
            description: 'Application tier configuration',
            properties: {
              type: {
                type: 'string',
                description: 'The tier type',
                enum: ['web', 'api', 'database', 'cache', 'queue', 'storage', 'analytics'],
              },
              trafficPattern: {
                type: 'string',
                description: 'Expected traffic pattern',
                enum: ['steady', 'burst', 'predictable-daily', 'predictable-weekly', 'seasonal', 'unpredictable'],
              },
              runtime: {
                type: 'object',
                description: 'Runtime configuration',
                properties: {
                  language: {
                    type: 'string',
                    description: 'Programming language/runtime',
                    enum: ['nodejs', 'python', 'java', 'go', 'dotnet', 'ruby'],
                  },
                  containerImage: {
                    type: 'string',
                    description: 'Container image (if containerized)',
                  },
                },
              },
              scaling: {
                type: 'object',
                description: 'Auto-scaling configuration',
                properties: {
                  min: {
                    type: 'number',
                    description: 'Minimum number of instances',
                  },
                  max: {
                    type: 'number',
                    description: 'Maximum number of instances',
                  },
                },
              },
            },
          },
        },
        compliance: {
          type: 'array',
          description: 'Compliance frameworks to enforce',
          items: {
            type: 'string',
            description: 'Compliance framework',
            enum: ['hipaa', 'soc2', 'pci-dss', 'gdpr', 'iso27001', 'fedramp', 'none'],
          },
        },
        cost: {
          type: 'object',
          description: 'Cost constraints',
          properties: {
            monthlyBudgetUsd: {
              type: 'number',
              description: 'Maximum monthly budget in USD',
            },
            prioritizeCost: {
              type: 'boolean',
              description: 'Prioritize cost optimization over performance',
            },
            alertThreshold: {
              type: 'number',
              description: 'Alert threshold as percentage of budget',
            },
          },
        },
        availability: {
          type: 'string',
          description: 'Availability requirement',
          enum: ['99.9', '99.95', '99.99', '99.999', 'best-effort'],
        },
        primaryRegion: {
          type: 'string',
          description: 'Primary AWS region for deployment',
        },
        security: {
          type: 'object',
          description: 'Security requirements',
          properties: {
            encryptionAtRest: {
              type: 'boolean',
              description: 'Encryption at rest required',
            },
            encryptionInTransit: {
              type: 'boolean',
              description: 'Encryption in transit required',
            },
            networkIsolation: {
              type: 'string',
              description: 'Network isolation level',
              enum: ['none', 'private-subnet', 'vpc-isolated', 'airgapped'],
            },
          },
        },
      },
      required: ['name', 'environment', 'primaryRegion'],
    },
  },

  {
    name: 'idio_create_from_template',
    description: `Create infrastructure from a pre-built template.
Templates provide production-ready patterns for common architectures:
- three-tier-web-app: Classic web application with load balancer, app servers, and database
- microservices-platform: Container-based microservices with service mesh
- serverless-api: API Gateway + Lambda + DynamoDB
- data-pipeline: S3/Lambda/SQS data processing pipeline with analytics
- machine-learning-platform: SageMaker-based ML training and inference
- ecommerce-platform: High-availability e-commerce with PCI-DSS compliance
- static-website: S3 + CloudFront static site with SSL

Use this when the user wants to:
- Use a standard architecture pattern
- Quickly deploy a known configuration
- Start from a best-practice template`,
    parameters: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'ID of the template to use',
          enum: ['three-tier-web-app', 'microservices-platform', 'serverless-api', 'data-pipeline', 'machine-learning-platform', 'ecommerce-platform', 'static-website'],
        },
        parameters: {
          type: 'object',
          description: 'Template parameters (varies by template)',
          properties: {
            name: {
              type: 'string',
              description: 'Application name',
            },
            environment: {
              type: 'string',
              description: 'Target environment',
              enum: ['development', 'staging', 'production'],
            },
          },
        },
      },
      required: ['templateId', 'parameters'],
    },
  },

  {
    name: 'idio_validate_intent',
    description: `Validate an infrastructure intent without creating a plan.
Checks for:
- Syntax and structure validity
- Required field presence
- Value constraints
- Logical consistency

Use this when the user wants to:
- Check if their configuration is valid
- Debug validation errors
- Verify requirements before planning`,
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'object',
          description: 'The intent object to validate (same structure as idio_create_infrastructure_plan)',
        },
      },
      required: ['intent'],
    },
  },

  {
    name: 'idio_estimate_cost',
    description: `Estimate the cost of infrastructure defined by an intent.
Provides:
- Monthly cost estimate
- Cost breakdown by service
- Cost breakdown by tier
- Comparison with cost constraints

Use this when the user wants to:
- Know how much infrastructure will cost
- Compare costs between configurations
- Check against budget constraints`,
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'object',
          description: 'The intent object to estimate (same structure as idio_create_infrastructure_plan)',
        },
      },
      required: ['intent'],
    },
  },

  // =========================================================================
  // Execution Tools
  // =========================================================================
  {
    name: 'idio_execute_plan',
    description: `Execute an infrastructure plan to provision AWS resources.
Options:
- dryRun: Preview changes without actually creating resources
- skipApproval: Skip manual approval (for pre-approved plans)

Use this when the user wants to:
- Deploy planned infrastructure
- Preview what will be created (dry run)
- Execute an approved plan`,
    parameters: {
      type: 'object',
      properties: {
        planId: {
          type: 'string',
          description: 'ID of the plan to execute (from idio_create_infrastructure_plan)',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview changes without creating resources',
          default: false,
        },
        skipApproval: {
          type: 'boolean',
          description: 'Skip manual approval check',
          default: false,
        },
      },
      required: ['planId'],
    },
  },

  {
    name: 'idio_check_execution_status',
    description: `Check the status of an infrastructure execution.
Returns:
- Current status (pending, in-progress, completed, failed)
- Resource provisioning progress
- Any errors encountered
- Duration and metrics

Use this when the user wants to:
- Monitor deployment progress
- Check if deployment completed
- View deployment errors`,
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description: 'ID of the execution to check',
        },
      },
      required: ['executionId'],
    },
  },

  // =========================================================================
  // Drift and Reconciliation Tools
  // =========================================================================
  {
    name: 'idio_reconcile',
    description: `Reconcile infrastructure to match the desired state.
Detects and optionally fixes:
- Configuration drift
- Missing resources
- Unauthorized changes
- Compliance violations

Use this when the user wants to:
- Check for drift from desired state
- Fix configuration drift
- Ensure compliance`,
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description: 'ID of the execution to reconcile',
        },
        autoRemediate: {
          type: 'boolean',
          description: 'Automatically fix detected drift',
          default: false,
        },
      },
      required: ['executionId'],
    },
  },

  {
    name: 'idio_rollback',
    description: `Rollback an execution to undo infrastructure changes.
Safely removes or reverts resources created by an execution.
Follows reverse dependency order for clean removal.

Use this when the user wants to:
- Undo a deployment
- Clean up failed deployment
- Remove infrastructure`,
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description: 'ID of the execution to rollback',
        },
      },
      required: ['executionId'],
    },
  },

  // =========================================================================
  // Template and Discovery Tools
  // =========================================================================
  {
    name: 'idio_list_templates',
    description: `List all available infrastructure templates.
Returns template metadata including:
- ID and name
- Description
- Category
- Required parameters

Use this when the user wants to:
- Browse available templates
- Find a template for their use case
- See what's available`,
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category',
          enum: ['web', 'api', 'data', 'ml', 'security', 'all'],
        },
      },
    },
  },

  {
    name: 'idio_get_template_details',
    description: `Get detailed information about a specific template.
Returns:
- Full description
- All parameters with defaults
- Example configurations
- Best practices

Use this when the user wants to:
- Understand a template's parameters
- See example usage
- Learn about a template`,
    parameters: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'ID of the template to get details for',
        },
      },
      required: ['templateId'],
    },
  },

  {
    name: 'idio_get_plan_details',
    description: `Get detailed information about a created plan.
Returns:
- All planned resources
- Dependency graph
- Cost estimates
- Policy validation results
- Guardrail checks

Use this when the user wants to:
- Review a plan before execution
- Understand what resources will be created
- Check policy compliance`,
    parameters: {
      type: 'object',
      properties: {
        planId: {
          type: 'string',
          description: 'ID of the plan to get details for',
        },
      },
      required: ['planId'],
    },
  },
];

// =============================================================================
// Tool Handler Implementation
// =============================================================================

export class IDIOToolHandler {
  constructor(private orchestrator: IDIOOrchestrator) {}

  /**
   * Handle a tool call
   */
  async handleToolCall(toolName: string, parameters: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case 'idio_create_infrastructure_plan':
        return this.createInfrastructurePlan(parameters);

      case 'idio_create_from_template':
        return this.createFromTemplate(parameters);

      case 'idio_validate_intent':
        return this.validateIntent(parameters);

      case 'idio_estimate_cost':
        return this.estimateCost(parameters);

      case 'idio_execute_plan':
        return this.executePlan(parameters);

      case 'idio_check_execution_status':
        return this.checkExecutionStatus(parameters);

      case 'idio_reconcile':
        return this.reconcile(parameters);

      case 'idio_rollback':
        return this.rollback(parameters);

      case 'idio_list_templates':
        return this.listTemplates(parameters);

      case 'idio_get_template_details':
        return this.getTemplateDetails(parameters);

      case 'idio_get_plan_details':
        return this.getPlanDetails(parameters);

      default:
        return {
          success: false,
          message: `Unknown tool: ${toolName}`,
          errors: [`Tool '${toolName}' is not recognized`],
        };
    }
  }

  private async createInfrastructurePlan(params: Record<string, unknown>): Promise<ToolResult> {
    const intent: ApplicationIntent = {
      name: params.name as string,
      environment: params.environment as 'development' | 'staging' | 'production' | 'disaster-recovery',
      availability: (params.availability as ApplicationIntent['availability']) ?? '99.9',
      primaryRegion: (params.primaryRegion as string) ?? 'us-east-1',
      cost: (params.cost as ApplicationIntent['cost']) ?? { monthlyBudgetUsd: 1000 },
      compliance: (params.compliance as ApplicationIntent['compliance']) ?? ['none'],
      security: (params.security as ApplicationIntent['security']) ?? {
        encryptionAtRest: true,
        encryptionInTransit: true,
        networkIsolation: 'private-subnet',
      },
      tiers: (params.tiers as ApplicationIntent['tiers']) ?? [],
    };

    const result = await this.orchestrator.createPlanFromIntent(intent);
    return this.convertResult(result);
  }

  private async createFromTemplate(params: Record<string, unknown>): Promise<ToolResult> {
    const templateId = params.templateId as string;
    const parameters = (params.parameters as Record<string, unknown>) ?? {};

    const result = await this.orchestrator.createPlanFromTemplate(templateId, parameters);
    return this.convertResult(result);
  }

  private async validateIntent(params: Record<string, unknown>): Promise<ToolResult> {
    const intent = params.intent as ApplicationIntent;
    const result = await this.orchestrator.validateIntent(intent);
    return this.convertResult(result);
  }

  private async estimateCost(params: Record<string, unknown>): Promise<ToolResult> {
    const intent = params.intent as ApplicationIntent;
    const result = await this.orchestrator.estimateCost(intent);
    return this.convertResult(result);
  }

  private async executePlan(params: Record<string, unknown>): Promise<ToolResult> {
    const planId = params.planId as string;
    const options = {
      dryRun: params.dryRun as boolean | undefined,
      autoApprove: params.skipApproval as boolean | undefined,
    };

    const result = await this.orchestrator.executePlan(planId, options);
    return this.convertResult(result);
  }

  private async checkExecutionStatus(params: Record<string, unknown>): Promise<ToolResult> {
    const executionId = params.executionId as string;
    const result = await this.orchestrator.checkStatus(executionId);
    return this.convertResult(result);
  }

  private async reconcile(params: Record<string, unknown>): Promise<ToolResult> {
    const executionId = params.executionId as string;
    const autoRemediate = params.autoRemediate as boolean | undefined;
    const result = await this.orchestrator.reconcile(executionId, { autoRemediate });
    return this.convertResult(result);
  }

  private async rollback(params: Record<string, unknown>): Promise<ToolResult> {
    const executionId = params.executionId as string;
    const result = await this.orchestrator.rollback(executionId);
    return this.convertResult(result);
  }

  private listTemplates(_params: Record<string, unknown>): ToolResult {
    const result = this.orchestrator.listTemplates();
    return this.convertResult(result);
  }

  private getTemplateDetails(params: Record<string, unknown>): ToolResult {
    const templateId = params.templateId as string;
    const result = this.orchestrator.getTemplate(templateId);
    return this.convertResult(result);
  }

  private async getPlanDetails(params: Record<string, unknown>): Promise<ToolResult> {
    const planId = params.planId as string;
    const result = await this.orchestrator.getPlan(planId);
    return this.convertResult(result);
  }

  private convertResult(result: IDIOResult): ToolResult {
    return {
      success: result.success,
      message: result.message,
      data: result.data,
      errors: result.errors,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createIDIOToolHandler(orchestrator: IDIOOrchestrator): IDIOToolHandler {
  return new IDIOToolHandler(orchestrator);
}
