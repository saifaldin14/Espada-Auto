/**
 * Reconciliation Engine - Continuous drift detection and auto-remediation
 * 
 * Monitors deployed infrastructure for configuration drift, compliance violations,
 * and cost anomalies. Automatically remediates issues when possible.
 */

import type {
  InfrastructurePlan,
  IntentExecutionResult,
  ReconciliationResult,
  ResourceDrift,
  CostAnomaly,
  RemediationAction,
  PlannedResource,
} from '../intent/types.js';
import type { PolicyEngine } from '../policy/engine.js';

export interface ReconciliationConfig {
  /** Reconciliation interval in minutes */
  intervalMinutes: number;
  /** Enable auto-remediation */
  enableAutoRemediation: boolean;
  /** Cost anomaly threshold percentage */
  costAnomalyThreshold: number;
  /** SNS topic for alerts */
  alertTopicArn?: string;
  /** Maximum auto-remediation attempts */
  maxRemediationAttempts: number;
}

export interface ReconciliationContext {
  /** Plan being monitored */
  plan: InfrastructurePlan;
  /** Execution result */
  execution: IntentExecutionResult;
  /** AWS region */
  region: string;
  /** AWS account ID */
  accountId?: string;
}

/**
 * Reconciliation Engine - Monitors and auto-remediates infrastructure
 */
export class ReconciliationEngine {
  constructor(
    private config: ReconciliationConfig,
    private policyEngine: PolicyEngine,
  ) {}

  /**
   * Perform full reconciliation check
   */
  async reconcile(context: ReconciliationContext): Promise<ReconciliationResult> {
    const timestamp = new Date().toISOString();
    
    // Drift detection
    const drifts = await this.detectDrift(context);
    
    // Compliance checks
    const complianceViolations = await this.checkCompliance(context);
    
    // Cost anomaly detection
    const costAnomalies = await this.detectCostAnomalies(context);
    
    // Generate remediation actions
    const recommendedActions = await this.generateRemediationActions(
      drifts,
      complianceViolations,
      costAnomalies,
      context,
    );
    
    // Auto-remediate if enabled
    let autoRemediationApplied = false;
    if (this.config.enableAutoRemediation) {
      autoRemediationApplied = await this.executeAutoRemediation(
        recommendedActions,
        context,
      );
    }
    
    // Send alerts if configured
    if (this.config.alertTopicArn) {
      await this.sendAlerts(
        drifts,
        complianceViolations,
        costAnomalies,
        context,
      );
    }

    return {
      id: `reconcile-${Date.now()}`,
      planId: context.plan.id,
      executionId: context.execution.executionId,
      timestamp,
      driftDetected: drifts.length > 0,
      drifts,
      complianceViolations,
      costAnomalies,
      recommendedActions,
      autoRemediationApplied,
    };
  }

  /**
   * Detect configuration drift between planned and actual state
   */
  private async detectDrift(context: ReconciliationContext): Promise<ResourceDrift[]> {
    const drifts: ResourceDrift[] = [];
    
    for (const provisionedResource of context.execution.provisionedResources) {
      const plannedResource = context.plan.resources.find(
        r => r.id === provisionedResource.plannedId
      );
      
      if (!plannedResource) continue;
      
      // Fetch actual resource configuration from AWS
      const actualConfig = await this.fetchResourceConfiguration(
        provisionedResource.awsId,
        provisionedResource.type,
        context.region,
      );
      
      if (!actualConfig) {
        // Resource was deleted outside of management
        drifts.push({
          resourceId: provisionedResource.plannedId,
          awsArn: provisionedResource.awsId,
          driftType: 'deleted',
          expected: plannedResource.properties,
          actual: {},
          differences: [],
          lastChecked: new Date().toISOString(),
        });
        continue;
      }
      
      // Compare configurations
      const differences = this.compareConfigurations(
        plannedResource.properties,
        actualConfig,
        provisionedResource.type,
      );
      
      if (differences.length > 0) {
        drifts.push({
          resourceId: provisionedResource.plannedId,
          awsArn: provisionedResource.awsId,
          driftType: 'configuration',
          expected: plannedResource.properties,
          actual: actualConfig,
          differences,
          lastChecked: new Date().toISOString(),
        });
      }
    }
    
    return drifts;
  }

  /**
   * Check compliance against current policy state
   */
  private async checkCompliance(context: ReconciliationContext): Promise<any[]> {
    const policyValidation = await this.policyEngine.validatePlan(
      context.plan.resources,
      context.plan.intent,
    );
    
    return policyValidation.violations;
  }

  /**
   * Detect cost anomalies
   */
  private async detectCostAnomalies(context: ReconciliationContext): Promise<CostAnomaly[]> {
    const anomalies: CostAnomaly[] = [];
    
    // Fetch actual costs from Cost Explorer
    const actualCosts = await this.fetchActualCosts(
      context.execution.provisionedResources.map(r => r.awsId),
      context.region,
    );
    
    // Compare against estimated costs
    for (const [resourceId, actualCost] of Object.entries(actualCosts)) {
      const plannedResource = context.plan.resources.find(r => r.id === resourceId);
      if (!plannedResource) continue;
      
      const expectedCost = plannedResource.estimatedCostUsd;
      const percentageDiff = ((actualCost - expectedCost) / expectedCost) * 100;
      
      if (Math.abs(percentageDiff) > this.config.costAnomalyThreshold) {
        anomalies.push({
          service: plannedResource.service,
          resourceId,
          type: percentageDiff > 0 ? 'spike' : 'trend',
          expectedCostUsd: expectedCost,
          actualCostUsd: actualCost,
          percentageDifference: percentageDiff,
          detectedAt: new Date().toISOString(),
          possibleCauses: this.analyzeCostAnomaly(plannedResource, actualCost, expectedCost),
        });
      }
    }
    
    return anomalies;
  }

  /**
   * Generate remediation actions
   */
  private async generateRemediationActions(
    drifts: ResourceDrift[],
    violations: any[],
    anomalies: CostAnomaly[],
    context: ReconciliationContext,
  ): Promise<RemediationAction[]> {
    const actions: RemediationAction[] = [];
    
    // Drift remediation actions
    for (const drift of drifts) {
      if (drift.driftType === 'deleted') {
        actions.push({
          id: `remediate-${drift.resourceId}-deleted`,
          type: 'recreate',
          priority: 'critical',
          description: `Recreate deleted resource ${drift.resourceId}`,
          resourceIds: [drift.resourceId],
          autoExecutable: false, // Requires approval
          estimatedImpact: 'Resource will be recreated with original configuration',
          approvalRequired: true,
        });
      } else if (drift.driftType === 'configuration') {
        const criticalDiffs = drift.differences.filter(d => d.severity === 'critical');
        if (criticalDiffs.length > 0) {
          actions.push({
            id: `remediate-${drift.resourceId}-config`,
            type: 'update',
            priority: 'high',
            description: `Update configuration for ${drift.resourceId}`,
            resourceIds: [drift.resourceId],
            autoExecutable: true,
            estimatedImpact: 'Resource configuration will be updated to match intent',
            approvalRequired: false,
          });
        }
      }
    }
    
    // Compliance violation remediation
    for (const violation of violations) {
      if (violation.autoFixable) {
        actions.push({
          id: `remediate-${violation.resourceId}-compliance`,
          type: 'update',
          priority: violation.severity === 'critical' ? 'critical' : 'high',
          description: violation.remediation || `Fix ${violation.policy} violation`,
          resourceIds: [violation.resourceId],
          autoExecutable: true,
          estimatedImpact: violation.remediation || 'Resource will be updated to comply with policy',
          approvalRequired: violation.severity === 'critical',
        });
      }
    }
    
    // Cost anomaly remediation
    for (const anomaly of anomalies) {
      if (anomaly.percentageDifference > this.config.costAnomalyThreshold * 2) {
        actions.push({
          id: `remediate-${anomaly.resourceId}-cost`,
          type: 'scale',
          priority: 'medium',
          description: `Investigate and optimize ${anomaly.service} costs`,
          resourceIds: anomaly.resourceId ? [anomaly.resourceId] : [],
          autoExecutable: false,
          estimatedImpact: `Cost is ${anomaly.percentageDifference.toFixed(1)}% higher than expected`,
          approvalRequired: true,
        });
      }
    }
    
    return actions;
  }

  /**
   * Execute auto-remediation for eligible actions
   */
  private async executeAutoRemediation(
    actions: RemediationAction[],
    context: ReconciliationContext,
  ): Promise<boolean> {
    const autoExecutableActions = actions.filter(
      a => a.autoExecutable && !a.approvalRequired
    );
    
    if (autoExecutableActions.length === 0) {
      return false;
    }
    
    let remediationApplied = false;
    
    for (const action of autoExecutableActions) {
      try {
        await this.executeRemediationAction(action, context);
        remediationApplied = true;
      } catch (error) {
        console.error(`Failed to execute remediation ${action.id}:`, error);
      }
    }
    
    return remediationApplied;
  }

  /**
   * Execute a specific remediation action
   */
  private async executeRemediationAction(
    action: RemediationAction,
    context: ReconciliationContext,
  ): Promise<void> {
    // Implementation would call appropriate AWS service managers
    // For now, this is a placeholder
    console.log(`Executing remediation action: ${action.id}`);
    
    switch (action.type) {
      case 'update':
        // Use appropriate manager to update resource
        break;
      case 'delete':
        // Use appropriate manager to delete resource
        break;
      case 'recreate':
        // Delete and recreate resource
        break;
      case 'scale':
        // Adjust scaling parameters
        break;
    }
  }

  /**
   * Fetch actual resource configuration from AWS
   */
  private async fetchResourceConfiguration(
    awsId: string,
    resourceType: string,
    region: string,
  ): Promise<Record<string, unknown> | null> {
    // Implementation would use AWS SDK to fetch resource details
    // This is a placeholder
    return {};
  }

  /**
   * Compare planned vs actual configurations
   */
  private compareConfigurations(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    resourceType: string,
  ): Array<{
    path: string;
    expectedValue: unknown;
    actualValue: unknown;
    severity: 'critical' | 'high' | 'medium' | 'low';
  }> {
    const differences = [];
    
    // Simplified comparison - production would use deep diff
    for (const [key, expectedValue] of Object.entries(expected)) {
      const actualValue = actual[key];
      
      if (JSON.stringify(expectedValue) !== JSON.stringify(actualValue)) {
        differences.push({
          path: key,
          expectedValue,
          actualValue,
          severity: this.determineDiffSeverity(key, resourceType),
        });
      }
    }
    
    return differences;
  }

  /**
   * Determine severity of a configuration difference
   */
  private determineDiffSeverity(
    propertyPath: string,
    resourceType: string,
  ): 'critical' | 'high' | 'medium' | 'low' {
    const criticalProperties = [
      'encryptionAtRest',
      'encryptionInTransit',
      'publiclyAccessible',
      'deletionProtection',
    ];
    
    if (criticalProperties.some(p => propertyPath.includes(p))) {
      return 'critical';
    }
    
    return 'medium';
  }

  /**
   * Fetch actual costs from AWS Cost Explorer
   */
  private async fetchActualCosts(
    resourceIds: string[],
    region: string,
  ): Promise<Record<string, number>> {
    // Implementation would use Cost Explorer API
    // This is a placeholder
    return {};
  }

  /**
   * Analyze possible causes of cost anomalies
   */
  private analyzeCostAnomaly(
    resource: PlannedResource,
    actualCost: number,
    expectedCost: number,
  ): string[] {
    const causes: string[] = [];
    
    if (actualCost > expectedCost * 1.5) {
      if (resource.type.includes('instance') || resource.type.includes('cluster')) {
        causes.push('Higher than expected instance utilization');
        causes.push('Additional instances may have been launched');
      }
      
      if (resource.type.includes('storage') || resource.type.includes('bucket')) {
        causes.push('Storage usage exceeded estimates');
        causes.push('Data transfer costs may be higher than expected');
      }
      
      if (resource.type.includes('database')) {
        causes.push('Database I/O operations exceeded estimates');
        causes.push('Backup storage costs may be higher');
      }
    }
    
    return causes;
  }

  /**
   * Send alerts via SNS
   */
  private async sendAlerts(
    drifts: ResourceDrift[],
    violations: any[],
    anomalies: CostAnomaly[],
    context: ReconciliationContext,
  ): Promise<void> {
    if (!this.config.alertTopicArn) return;
    
    const alertMessage = this.formatAlertMessage(drifts, violations, anomalies, context);
    
    // Implementation would use SNS SDK to publish alert
    console.log('Alert:', alertMessage);
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(
    drifts: ResourceDrift[],
    violations: any[],
    anomalies: CostAnomaly[],
    context: ReconciliationContext,
  ): string {
    const sections = [];
    
    sections.push(`Reconciliation Report for ${context.plan.intent.name}`);
    sections.push(`Plan ID: ${context.plan.id}`);
    sections.push(`Execution ID: ${context.execution.executionId}`);
    sections.push('');
    
    if (drifts.length > 0) {
      sections.push(`🔄 Configuration Drift: ${drifts.length} resource(s)`);
      for (const drift of drifts) {
        sections.push(`  - ${drift.resourceId}: ${drift.driftType}`);
      }
      sections.push('');
    }
    
    if (violations.length > 0) {
      sections.push(`⚠️  Compliance Violations: ${violations.length}`);
      for (const violation of violations) {
        sections.push(`  - ${violation.policy}: ${violation.message}`);
      }
      sections.push('');
    }
    
    if (anomalies.length > 0) {
      sections.push(`💰 Cost Anomalies: ${anomalies.length}`);
      for (const anomaly of anomalies) {
        sections.push(`  - ${anomaly.service}: ${anomaly.percentageDifference.toFixed(1)}% ${anomaly.type}`);
      }
      sections.push('');
    }
    
    return sections.join('\n');
  }
}

/**
 * Create EventBridge rule for continuous reconciliation
 */
export async function createReconciliationSchedule(
  planId: string,
  executionId: string,
  intervalMinutes: number,
  region: string,
): Promise<{
  ruleArn: string;
  targetArn: string;
}> {
  // Implementation would create EventBridge rule and Lambda target
  // This is a placeholder
  
  const ruleName = `reconcile-${planId}`;
  const scheduleExpression = `rate(${intervalMinutes} minutes)`;
  
  return {
    ruleArn: `arn:aws:events:${region}:*:rule/${ruleName}`,
    targetArn: `arn:aws:lambda:${region}:*:function/reconcile-handler`,
  };
}

/**
 * Create Step Functions state machine for reconciliation workflow
 */
export async function createReconciliationWorkflow(
  planId: string,
  config: ReconciliationConfig,
  region: string,
): Promise<{
  stateMachineArn: string;
  definition: string;
}> {
  const definition = {
    Comment: 'Infrastructure Reconciliation Workflow',
    StartAt: 'CheckDrift',
    States: {
      CheckDrift: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'drift-checker',
          Payload: {
            planId,
            'timestamp.$': '$$.State.EnteredTime',
          },
        },
        Next: 'EvaluateDrift',
      },
      EvaluateDrift: {
        Type: 'Choice',
        Choices: [
          {
            Variable: '$.driftDetected',
            BooleanEquals: true,
            Next: 'GenerateRemediationPlan',
          },
        ],
        Default: 'CheckCompliance',
      },
      GenerateRemediationPlan: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'remediation-planner',
          'Payload.$': '$',
        },
        Next: 'ApprovalRequired',
      },
      ApprovalRequired: {
        Type: 'Choice',
        Choices: [
          {
            Variable: '$.requiresApproval',
            BooleanEquals: false,
            Next: 'ExecuteRemediation',
          },
        ],
        Default: 'WaitForApproval',
      },
      WaitForApproval: {
        Type: 'Task',
        Resource: 'arn:aws:states:::sqs:sendMessage.waitForTaskToken',
        Parameters: {
          QueueUrl: 'approval-queue-url',
          MessageBody: {
            'TaskToken.$': '$$.Task.Token',
            'Plan.$': '$.remediationPlan',
          },
        },
        Next: 'ExecuteRemediation',
      },
      ExecuteRemediation: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'remediation-executor',
          'Payload.$': '$',
        },
        Next: 'CheckCompliance',
      },
      CheckCompliance: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'compliance-checker',
          'Payload.$': '$',
        },
        Next: 'CheckCostAnomalies',
      },
      CheckCostAnomalies: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'cost-anomaly-detector',
          'Payload.$': '$',
        },
        Next: 'SendReport',
      },
      SendReport: {
        Type: 'Task',
        Resource: 'arn:aws:states:::sns:publish',
        Parameters: {
          TopicArn: config.alertTopicArn,
          'Message.$': '$.reportMessage',
        },
        End: true,
      },
    },
  };
  
  return {
    stateMachineArn: `arn:aws:states:${region}:*:stateMachine:reconcile-${planId}`,
    definition: JSON.stringify(definition, null, 2),
  };
}

/**
 * Create reconciliation engine instance
 */
export function createReconciliationEngine(
  config: Partial<ReconciliationConfig>,
  policyEngine: PolicyEngine,
): ReconciliationEngine {
  const defaultConfig: ReconciliationConfig = {
    intervalMinutes: 15,
    enableAutoRemediation: false,
    costAnomalyThreshold: 20,
    maxRemediationAttempts: 3,
  };
  
  return new ReconciliationEngine({ ...defaultConfig, ...config }, policyEngine);
}
