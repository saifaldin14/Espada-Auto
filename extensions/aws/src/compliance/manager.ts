/**
 * AWS Compliance & Governance Manager
 *
 * Comprehensive compliance management including AWS Config rules,
 * conformance packs, tag compliance, violation tracking, and reporting.
 */

import {
  ConfigServiceClient,
  DescribeConfigRulesCommand,
  DescribeComplianceByConfigRuleCommand,
  DescribeConformancePacksCommand,
  DescribeConformancePackComplianceCommand,
  PutConfigRuleCommand,
  DeleteConfigRuleCommand,
  PutConformancePackCommand,
  DeleteConformancePackCommand,
  GetComplianceDetailsByConfigRuleCommand,
  StartConfigRulesEvaluationCommand,
  DescribeRemediationExecutionStatusCommand,
  StartRemediationExecutionCommand,
  type ConfigRule,
  type ConformancePackDetail,
  type ComplianceByConfigRule,
  type EvaluationResult,
  type RemediationExecutionStatus,
  type ResourceType,
} from '@aws-sdk/client-config-service';

import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  TagResourcesCommand,
  type ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';

import {
  SecurityHubClient,
  GetFindingsCommand,
  BatchUpdateFindingsCommand,
  type AwsSecurityFinding,
} from '@aws-sdk/client-securityhub';

import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import { v4 as uuidv4 } from 'uuid';

import {
  type ComplianceManager,
  type ComplianceManagerConfig,
  type ComplianceOperationResult,
  type ComplianceFramework,
  type FrameworkInfo,
  type ComplianceControl,
  type ComplianceCheckResult,
  type ComplianceSummary,
  type ComplianceResource,
  type ComplianceSeverity,
  type ComplianceStatus,
  type ComplianceViolation,
  type ViolationStatus,
  type ListViolationsOptions,
  type ConfigRuleInfo,
  type ConfigRuleEvaluation,
  type ConfigRuleComplianceDetail,
  type CreateConfigRuleOptions,
  type ListConfigRulesOptions,
  type ConformancePackInfo,
  type ConformancePackComplianceDetail,
  type CreateConformancePackOptions,
  type ListConformancePacksOptions,
  type TagPolicy,
  type TagComplianceResult,
  type TagEnforcementResult,
  type EnforceTagsOptions,
  type RemediationActionConfig,
  type RemediationExecutionResult,
  type RemediateViolationOptions,
  type ComplianceReport,
  type ComplianceReportSummary,
  type GenerateReportOptions,
  type CheckComplianceOptions,
  AWS_MANAGED_RULES,
  CONFORMANCE_PACK_TEMPLATES,
  FRAMEWORK_DEFINITIONS,
} from './types.js';

/**
 * AWS Compliance Manager implementation
 */
export class AWSComplianceManager implements ComplianceManager {
  private configClient: ConfigServiceClient;
  private taggingClient: ResourceGroupsTaggingAPIClient;
  private securityHubClient: SecurityHubClient;
  private s3Client: S3Client;
  private config: ComplianceManagerConfig;

  // In-memory storage for demo/testing
  private violations: Map<string, ComplianceViolation> = new Map();
  private tagPolicies: Map<string, TagPolicy> = new Map();
  private reports: Map<string, ComplianceReport> = new Map();
  private remediations: Map<string, RemediationExecutionResult> = new Map();

  constructor(config: ComplianceManagerConfig = {}) {
    this.config = config;

    const clientConfig = {
      region: config.defaultRegion || 'us-east-1',
      ...(config.credentials && { credentials: config.credentials }),
    };

    this.configClient = new ConfigServiceClient(clientConfig);
    this.taggingClient = new ResourceGroupsTaggingAPIClient(clientConfig);
    this.securityHubClient = new SecurityHubClient(clientConfig);
    this.s3Client = new S3Client(clientConfig);
  }

  // =============================================================================
  // Compliance Checks
  // =============================================================================

  /**
   * Check compliance against a framework
   */
  async checkCompliance(
    framework: ComplianceFramework,
    options: CheckComplianceOptions = {}
  ): Promise<ComplianceOperationResult<ComplianceCheckResult[]>> {
    try {
      const results: ComplianceCheckResult[] = [];

      // Get rules associated with this framework
      const frameworkRules = Object.entries(AWS_MANAGED_RULES).filter(
        ([, rule]) => rule.frameworks.includes(framework)
      );

      // Get compliance status from AWS Config
      const configCompliance = await this.getConfigComplianceByFramework(framework);

      // Get Security Hub findings if available
      const securityHubFindings = await this.getSecurityHubFindings(framework);

      // Combine results
      for (const [ruleKey, ruleInfo] of frameworkRules) {
        const configResult = configCompliance.find(c => c.ConfigRuleName === ruleKey);
        const secHubFindings = securityHubFindings.filter(f =>
          f.GeneratorId?.includes(ruleInfo.identifier) ||
          f.Title?.toLowerCase().includes(ruleKey.replace(/-/g, ' '))
        );

        const affectedResources: ComplianceResource[] = [];

        // Add resources from Security Hub findings
        for (const finding of secHubFindings) {
          for (const resource of finding.Resources || []) {
            affectedResources.push({
              resourceType: resource.Type || 'Unknown',
              resourceId: resource.Id || 'Unknown',
              resourceArn: resource.Id,
              region: finding.Region || this.config.defaultRegion || 'us-east-1',
              complianceStatus: this.mapSecurityHubStatus(finding.Compliance?.Status),
              violationDetails: finding.Description,
            });
          }
        }

        // Determine overall status
        let status: ComplianceStatus = 'COMPLIANT';
        if (configResult?.Compliance?.ComplianceType === 'NON_COMPLIANT' || secHubFindings.some(f => f.Compliance?.Status === 'FAILED')) {
          status = 'NON_COMPLIANT';
        } else if (!configResult && secHubFindings.length === 0) {
          status = 'INSUFFICIENT_DATA';
        }

        const checkResult: ComplianceCheckResult = {
          checkId: uuidv4(),
          framework,
          controlId: ruleKey,
          controlTitle: ruleInfo.description,
          status,
          severity: ruleInfo.severity,
          affectedResources,
          timestamp: new Date(),
          findings: secHubFindings.map(f => f.Description || f.Title || 'No description'),
          remediationGuidance: this.getRemediationGuidance(ruleKey),
          autoRemediationAvailable: this.hasAutoRemediation(ruleKey),
        };

        results.push(checkResult);

        // Track violations
        if (status === 'NON_COMPLIANT') {
          for (const resource of affectedResources) {
            const violation = this.createViolation(framework, ruleKey, ruleInfo, resource);
            this.violations.set(violation.violationId, violation);
          }
        }
      }

      // Filter by options
      let filteredResults = results;
      if (options.controlIds?.length) {
        filteredResults = filteredResults.filter(r => options.controlIds!.includes(r.controlId));
      }
      if (options.resourceTypes?.length) {
        filteredResults = filteredResults.filter(r =>
          r.affectedResources.some(ar => options.resourceTypes!.includes(ar.resourceType))
        );
      }

      return {
        success: true,
        data: filteredResults,
        message: `Checked ${filteredResults.length} controls for ${framework}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to check compliance: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get compliance summary for a framework
   */
  async getComplianceSummary(framework: ComplianceFramework): Promise<ComplianceOperationResult<ComplianceSummary>> {
    try {
      const checkResults = await this.checkCompliance(framework);
      if (!checkResults.success || !checkResults.data) {
        return { success: false, error: checkResults.error || 'Failed to get compliance data' };
      }

      const results = checkResults.data;
      const totalControls = results.length;
      const compliantControls = results.filter(r => r.status === 'COMPLIANT').length;
      const nonCompliantControls = results.filter(r => r.status === 'NON_COMPLIANT').length;
      const notApplicableControls = results.filter(r => r.status === 'NOT_APPLICABLE').length;
      const insufficientDataControls = results.filter(r => r.status === 'INSUFFICIENT_DATA').length;

      // Calculate by severity
      const bySeverity: Record<ComplianceSeverity, { total: number; compliant: number; nonCompliant: number }> = {
        critical: { total: 0, compliant: 0, nonCompliant: 0 },
        high: { total: 0, compliant: 0, nonCompliant: 0 },
        medium: { total: 0, compliant: 0, nonCompliant: 0 },
        low: { total: 0, compliant: 0, nonCompliant: 0 },
        informational: { total: 0, compliant: 0, nonCompliant: 0 },
      };

      const byCategory: Record<string, { total: number; compliant: number; nonCompliant: number }> = {};

      for (const result of results) {
        bySeverity[result.severity].total++;
        if (result.status === 'COMPLIANT') {
          bySeverity[result.severity].compliant++;
        } else if (result.status === 'NON_COMPLIANT') {
          bySeverity[result.severity].nonCompliant++;
        }

        // Categorize by resource type for category breakdown
        for (const resource of result.affectedResources) {
          const category = this.getResourceCategory(resource.resourceType);
          if (!byCategory[category]) {
            byCategory[category] = { total: 0, compliant: 0, nonCompliant: 0 };
          }
          byCategory[category].total++;
          if (result.status === 'COMPLIANT') {
            byCategory[category].compliant++;
          } else if (result.status === 'NON_COMPLIANT') {
            byCategory[category].nonCompliant++;
          }
        }
      }

      const summary: ComplianceSummary = {
        framework,
        totalControls,
        compliantControls,
        nonCompliantControls,
        notApplicableControls,
        insufficientDataControls,
        compliancePercentage: totalControls > 0
          ? Math.round((compliantControls / (totalControls - notApplicableControls - insufficientDataControls)) * 100)
          : 0,
        bySeverity,
        byCategory,
        timestamp: new Date(),
        trend: 'stable', // Would need historical data for actual trend
      };

      return { success: true, data: summary };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get compliance summary: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get available frameworks
   */
  async getFrameworks(): Promise<ComplianceOperationResult<FrameworkInfo[]>> {
    return { success: true, data: FRAMEWORK_DEFINITIONS };
  }

  /**
   * Get framework details
   */
  async getFramework(frameworkId: ComplianceFramework): Promise<ComplianceOperationResult<FrameworkInfo>> {
    const framework = FRAMEWORK_DEFINITIONS.find(f => f.id === frameworkId);
    if (!framework) {
      return { success: false, error: `Framework ${frameworkId} not found` };
    }
    return { success: true, data: framework };
  }

  /**
   * Get controls for a framework
   */
  async getControls(framework: ComplianceFramework): Promise<ComplianceOperationResult<ComplianceControl[]>> {
    const controls: ComplianceControl[] = [];

    for (const [ruleKey, ruleInfo] of Object.entries(AWS_MANAGED_RULES)) {
      if (ruleInfo.frameworks.includes(framework)) {
        controls.push({
          controlId: ruleKey,
          framework,
          title: ruleKey.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: ruleInfo.description,
          category: this.getRuleCategory(ruleKey),
          severity: ruleInfo.severity,
          applicableServices: ruleInfo.resourceTypes.map(rt => rt.replace('AWS::', '').split('::')[0]),
          configRules: [ruleInfo.identifier],
          remediationGuidance: this.getRemediationGuidance(ruleKey),
          automatedRemediationAvailable: this.hasAutoRemediation(ruleKey),
        });
      }
    }

    return { success: true, data: controls };
  }

  // =============================================================================
  // Violations Management
  // =============================================================================

  /**
   * List compliance violations
   */
  async listViolations(options: ListViolationsOptions = {}): Promise<ComplianceOperationResult<ComplianceViolation[]>> {
    try {
      let violations = Array.from(this.violations.values());

      // Apply filters
      if (options.framework) {
        violations = violations.filter(v => v.framework === options.framework);
      }
      if (options.severity) {
        violations = violations.filter(v => v.severity === options.severity);
      }
      if (options.status) {
        violations = violations.filter(v => v.status === options.status);
      }
      if (options.resourceType) {
        violations = violations.filter(v => v.resource.resourceType === options.resourceType);
      }
      if (options.region) {
        violations = violations.filter(v => v.resource.region === options.region);
      }
      if (!options.includeSuppressed) {
        violations = violations.filter(v => v.status !== 'suppressed' && !v.exceptionGranted);
      }

      // Sort
      if (options.sortBy) {
        violations.sort((a, b) => {
          let comparison = 0;
          switch (options.sortBy) {
            case 'severity':
              comparison = this.severityToNumber(b.severity) - this.severityToNumber(a.severity);
              break;
            case 'detectedAt':
              comparison = b.detectedAt.getTime() - a.detectedAt.getTime();
              break;
            case 'riskScore':
              comparison = b.riskScore - a.riskScore;
              break;
          }
          return options.sortOrder === 'asc' ? -comparison : comparison;
        });
      }

      // Limit
      if (options.limit) {
        violations = violations.slice(0, options.limit);
      }

      return { success: true, data: violations };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list violations: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get violation details
   */
  async getViolation(violationId: string): Promise<ComplianceOperationResult<ComplianceViolation>> {
    const violation = this.violations.get(violationId);
    if (!violation) {
      return { success: false, error: `Violation ${violationId} not found` };
    }
    return { success: true, data: violation };
  }

  /**
   * Suppress a violation
   */
  async suppressViolation(
    violationId: string,
    reason: string,
    expiry?: Date
  ): Promise<ComplianceOperationResult<void>> {
    const violation = this.violations.get(violationId);
    if (!violation) {
      return { success: false, error: `Violation ${violationId} not found` };
    }

    violation.status = 'suppressed';
    violation.exceptionGranted = true;
    violation.exceptionReason = reason;
    violation.exceptionExpiry = expiry;

    return { success: true, message: `Violation ${violationId} suppressed` };
  }

  /**
   * Unsuppress a violation
   */
  async unsuppressViolation(violationId: string): Promise<ComplianceOperationResult<void>> {
    const violation = this.violations.get(violationId);
    if (!violation) {
      return { success: false, error: `Violation ${violationId} not found` };
    }

    violation.status = 'open';
    violation.exceptionGranted = false;
    violation.exceptionReason = undefined;
    violation.exceptionExpiry = undefined;

    return { success: true, message: `Violation ${violationId} unsuppressed` };
  }

  // =============================================================================
  // AWS Config Rules
  // =============================================================================

  /**
   * List Config rules
   */
  async listConfigRules(options: ListConfigRulesOptions = {}): Promise<ComplianceOperationResult<ConfigRuleInfo[]>> {
    try {
      const command = new DescribeConfigRulesCommand({
        ConfigRuleNames: options.ruleNames,
        NextToken: options.nextToken,
      });

      const response = await this.configClient.send(command);
      const rules: ConfigRuleInfo[] = (response.ConfigRules || []).map(rule => this.mapConfigRule(rule));

      return { success: true, data: rules };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list Config rules: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get Config rule details
   */
  async getConfigRule(ruleName: string): Promise<ComplianceOperationResult<ConfigRuleInfo>> {
    try {
      const command = new DescribeConfigRulesCommand({
        ConfigRuleNames: [ruleName],
      });

      const response = await this.configClient.send(command);
      if (!response.ConfigRules?.length) {
        return { success: false, error: `Config rule ${ruleName} not found` };
      }

      return { success: true, data: this.mapConfigRule(response.ConfigRules[0]) };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get Config rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a Config rule
   */
  async createConfigRule(options: CreateConfigRuleOptions): Promise<ComplianceOperationResult<ConfigRuleInfo>> {
    try {
      const command = new PutConfigRuleCommand({
        ConfigRule: {
          ConfigRuleName: options.ruleName,
          Description: options.description,
          Source: {
            Owner: options.sourceType === 'AWS' ? 'AWS' : 'CUSTOM_LAMBDA',
            SourceIdentifier: options.sourceIdentifier,
          },
          InputParameters: options.inputParameters ? JSON.stringify(options.inputParameters) : undefined,
          Scope: {
            ComplianceResourceTypes: options.resourceTypes,
            TagKey: options.tagKey,
            TagValue: options.tagValue,
          },
          MaximumExecutionFrequency: options.maximumExecutionFrequency,
        },
        Tags: options.tags
          ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value }))
          : undefined,
      });

      await this.configClient.send(command);

      // Fetch the created rule
      return this.getConfigRule(options.ruleName);
    } catch (error) {
      return {
        success: false,
        error: `Failed to create Config rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete a Config rule
   */
  async deleteConfigRule(ruleName: string): Promise<ComplianceOperationResult<void>> {
    try {
      const command = new DeleteConfigRuleCommand({
        ConfigRuleName: ruleName,
      });

      await this.configClient.send(command);
      return { success: true, message: `Config rule ${ruleName} deleted` };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete Config rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get Config rule compliance
   */
  async getConfigRuleCompliance(ruleName: string): Promise<ComplianceOperationResult<ConfigRuleEvaluation>> {
    try {
      const command = new DescribeComplianceByConfigRuleCommand({
        ConfigRuleNames: [ruleName],
      });

      const response = await this.configClient.send(command);
      const compliance = response.ComplianceByConfigRules?.[0];

      if (!compliance) {
        return { success: false, error: `No compliance data for rule ${ruleName}` };
      }

      const evaluation: ConfigRuleEvaluation = {
        ruleName,
        complianceType: (compliance.Compliance?.ComplianceType as ConfigRuleEvaluation['complianceType']) || 'INSUFFICIENT_DATA',
        compliantResourceCount: compliance.Compliance?.ComplianceContributorCount?.CappedCount || 0,
        nonCompliantResourceCount: compliance.Compliance?.ComplianceContributorCount?.CappedCount || 0,
      };

      return { success: true, data: evaluation };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get Config rule compliance: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get detailed compliance results for a Config rule
   */
  async getConfigRuleComplianceDetails(ruleName: string): Promise<ComplianceOperationResult<ConfigRuleComplianceDetail[]>> {
    try {
      const command = new GetComplianceDetailsByConfigRuleCommand({
        ConfigRuleName: ruleName,
      });

      const response = await this.configClient.send(command);
      const details: ConfigRuleComplianceDetail[] = (response.EvaluationResults || []).map(
        (result: EvaluationResult) => ({
          ruleName,
          resourceType: result.EvaluationResultIdentifier?.EvaluationResultQualifier?.ResourceType || 'Unknown',
          resourceId: result.EvaluationResultIdentifier?.EvaluationResultQualifier?.ResourceId || 'Unknown',
          complianceType: (result.ComplianceType as ConfigRuleComplianceDetail['complianceType']) || 'INSUFFICIENT_DATA',
          annotation: result.Annotation,
          resultRecordedTime: result.ResultRecordedTime,
          configRuleInvokedTime: result.ConfigRuleInvokedTime,
        })
      );

      return { success: true, data: details };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get compliance details: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Start evaluation for Config rules
   */
  async startConfigRulesEvaluation(ruleNames: string[]): Promise<ComplianceOperationResult<void>> {
    try {
      const command = new StartConfigRulesEvaluationCommand({
        ConfigRuleNames: ruleNames,
      });

      await this.configClient.send(command);
      return { success: true, message: `Started evaluation for ${ruleNames.length} rules` };
    } catch (error) {
      return {
        success: false,
        error: `Failed to start evaluation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Conformance Packs
  // =============================================================================

  /**
   * List conformance packs
   */
  async listConformancePacks(
    options: ListConformancePacksOptions = {}
  ): Promise<ComplianceOperationResult<ConformancePackInfo[]>> {
    try {
      const command = new DescribeConformancePacksCommand({
        ConformancePackNames: options.packNames,
        NextToken: options.nextToken,
        Limit: options.maxResults,
      });

      const response = await this.configClient.send(command);
      const packs: ConformancePackInfo[] = (response.ConformancePackDetails || []).map(
        (pack: ConformancePackDetail) => ({
          packName: pack.ConformancePackName || 'Unknown',
          packArn: pack.ConformancePackArn || '',
          packId: pack.ConformancePackId || '',
          deliveryS3Bucket: pack.DeliveryS3Bucket,
          deliveryS3KeyPrefix: pack.DeliveryS3KeyPrefix,
          templateS3Uri: pack.TemplateSSMDocumentDetails ? undefined : undefined,
          inputParameters: pack.ConformancePackInputParameters?.map(p => ({
            parameterName: p.ParameterName || '',
            parameterValue: p.ParameterValue || '',
          })),
          createdBy: pack.CreatedBy,
          lastUpdateTime: pack.LastUpdateRequestedTime,
        })
      );

      return { success: true, data: packs };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list conformance packs: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get conformance pack details
   */
  async getConformancePack(packName: string): Promise<ComplianceOperationResult<ConformancePackInfo>> {
    try {
      const command = new DescribeConformancePacksCommand({
        ConformancePackNames: [packName],
      });

      const response = await this.configClient.send(command);
      if (!response.ConformancePackDetails?.length) {
        return { success: false, error: `Conformance pack ${packName} not found` };
      }

      const pack = response.ConformancePackDetails[0];
      return {
        success: true,
        data: {
          packName: pack.ConformancePackName || 'Unknown',
          packArn: pack.ConformancePackArn || '',
          packId: pack.ConformancePackId || '',
          deliveryS3Bucket: pack.DeliveryS3Bucket,
          deliveryS3KeyPrefix: pack.DeliveryS3KeyPrefix,
          inputParameters: pack.ConformancePackInputParameters?.map(p => ({
            parameterName: p.ParameterName || '',
            parameterValue: p.ParameterValue || '',
          })),
          createdBy: pack.CreatedBy,
          lastUpdateTime: pack.LastUpdateRequestedTime,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get conformance pack: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a conformance pack
   */
  async createConformancePack(
    options: CreateConformancePackOptions
  ): Promise<ComplianceOperationResult<ConformancePackInfo>> {
    try {
      const command = new PutConformancePackCommand({
        ConformancePackName: options.packName,
        TemplateBody: options.templateBody,
        TemplateS3Uri: options.templateS3Uri,
        DeliveryS3Bucket: options.deliveryS3Bucket,
        DeliveryS3KeyPrefix: options.deliveryS3KeyPrefix,
        ConformancePackInputParameters: options.inputParameters?.map(p => ({
          ParameterName: p.parameterName,
          ParameterValue: p.parameterValue,
        })),
      });

      await this.configClient.send(command);
      return this.getConformancePack(options.packName);
    } catch (error) {
      return {
        success: false,
        error: `Failed to create conformance pack: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete a conformance pack
   */
  async deleteConformancePack(packName: string): Promise<ComplianceOperationResult<void>> {
    try {
      const command = new DeleteConformancePackCommand({
        ConformancePackName: packName,
      });

      await this.configClient.send(command);
      return { success: true, message: `Conformance pack ${packName} deleted` };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete conformance pack: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get conformance pack compliance
   */
  async getConformancePackCompliance(
    packName: string
  ): Promise<ComplianceOperationResult<ConformancePackComplianceDetail[]>> {
    try {
      const command = new DescribeConformancePackComplianceCommand({
        ConformancePackName: packName,
      });

      const response = await this.configClient.send(command);
      const details: ConformancePackComplianceDetail[] = (response.ConformancePackRuleComplianceList || []).map(
        rule => ({
          packName,
          ruleName: rule.ConfigRuleName || 'Unknown',
          complianceType: (rule.ComplianceType as ConformancePackComplianceDetail['complianceType']) || 'INSUFFICIENT_DATA',
        })
      );

      return { success: true, data: details };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get conformance pack compliance: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Deploy a conformance pack from template
   */
  async deployConformancePackFromTemplate(
    templateId: string
  ): Promise<ComplianceOperationResult<ConformancePackInfo>> {
    const template = CONFORMANCE_PACK_TEMPLATES[templateId];
    if (!template) {
      return { success: false, error: `Template ${templateId} not found. Available: ${Object.keys(CONFORMANCE_PACK_TEMPLATES).join(', ')}` };
    }

    return this.createConformancePack({
      packName: `${templateId}-${Date.now()}`,
      templateBody: template.templateBody,
    });
  }

  // =============================================================================
  // Tag Compliance
  // =============================================================================

  /**
   * Check tag compliance
   */
  async checkTagCompliance(options: EnforceTagsOptions): Promise<ComplianceOperationResult<TagEnforcementResult>> {
    try {
      // Get tag policy if specified
      let requiredTags = options.requiredTags || [];
      if (options.policyId) {
        const policy = this.tagPolicies.get(options.policyId);
        if (!policy) {
          return { success: false, error: `Tag policy ${options.policyId} not found` };
        }
        requiredTags = policy.requiredTags;
      }

      if (!requiredTags.length) {
        return { success: false, error: 'No required tags specified' };
      }

      // Get resources
      const command = new GetResourcesCommand({
        ResourceTypeFilters: options.resourceTypes,
      });

      const response = await this.taggingClient.send(command);
      const resources = response.ResourceTagMappingList || [];

      const details: TagComplianceResult[] = [];
      let compliant = 0;
      let nonCompliant = 0;
      let remediated = 0;
      let errors = 0;

      for (const resource of resources) {
        const result = this.checkResourceTags(resource, requiredTags);
        details.push(result);

        if (result.isCompliant) {
          compliant++;
        } else {
          nonCompliant++;

          // Remediate if mode allows
          if (options.mode === 'remediate' && !options.dryRun) {
            const remediationResult = await this.remediateResourceTags(resource, requiredTags, options);
            if (remediationResult.success) {
              remediated++;
            } else {
              errors++;
            }
          }
        }
      }

      return {
        success: true,
        data: {
          totalChecked: resources.length,
          compliant,
          nonCompliant,
          remediated,
          errors,
          details,
          mode: options.mode,
          dryRun: options.dryRun || false,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to check tag compliance: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Enforce tag policy
   */
  async enforceTagPolicy(options: EnforceTagsOptions): Promise<ComplianceOperationResult<TagEnforcementResult>> {
    return this.checkTagCompliance({ ...options, mode: 'remediate' });
  }

  /**
   * List tag policies
   */
  async listTagPolicies(): Promise<ComplianceOperationResult<TagPolicy[]>> {
    return { success: true, data: Array.from(this.tagPolicies.values()) };
  }

  /**
   * Create a tag policy
   */
  async createTagPolicy(
    policy: Omit<TagPolicy, 'policyId' | 'createdAt' | 'updatedAt'>
  ): Promise<ComplianceOperationResult<TagPolicy>> {
    const newPolicy: TagPolicy = {
      ...policy,
      policyId: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tagPolicies.set(newPolicy.policyId, newPolicy);
    return { success: true, data: newPolicy };
  }

  /**
   * Delete a tag policy
   */
  async deleteTagPolicy(policyId: string): Promise<ComplianceOperationResult<void>> {
    if (!this.tagPolicies.has(policyId)) {
      return { success: false, error: `Tag policy ${policyId} not found` };
    }
    this.tagPolicies.delete(policyId);
    return { success: true, message: `Tag policy ${policyId} deleted` };
  }

  // =============================================================================
  // Remediation
  // =============================================================================

  /**
   * Remediate a violation
   */
  async remediateViolation(
    options: RemediateViolationOptions
  ): Promise<ComplianceOperationResult<RemediationExecutionResult>> {
    try {
      const violation = this.violations.get(options.violationId);
      if (!violation) {
        return { success: false, error: `Violation ${options.violationId} not found` };
      }

      if (!violation.autoRemediationAvailable && !options.actionType) {
        return { success: false, error: 'No automated remediation available for this violation' };
      }

      // Get the remediation action
      const actionType = options.actionType || this.getDefaultRemediationAction(violation.controlId);
      if (!actionType) {
        return { success: false, error: 'No remediation action available' };
      }

      const remediationId = uuidv4();

      if (options.dryRun) {
        return {
          success: true,
          data: {
            remediationId,
            resourceId: violation.resource.resourceId,
            resourceType: violation.resource.resourceType,
            ruleName: violation.controlId,
            status: 'QUEUED',
            stepDetails: violation.remediationSteps?.map(step => ({
              name: step.description,
              status: 'PENDING',
            })),
          },
          message: 'Dry run - no changes made',
        };
      }

      // Execute remediation using AWS Config
      const command = new StartRemediationExecutionCommand({
        ConfigRuleName: violation.controlId,
        ResourceKeys: [
          {
            resourceType: violation.resource.resourceType as ResourceType,
            resourceId: violation.resource.resourceId,
          },
        ],
      });

      await this.configClient.send(command);

      const result: RemediationExecutionResult = {
        remediationId,
        resourceId: violation.resource.resourceId,
        resourceType: violation.resource.resourceType,
        ruleName: violation.controlId,
        status: 'IN_PROGRESS',
        startTime: new Date(),
      };

      this.remediations.set(remediationId, result);
      violation.status = 'in_progress';

      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remediate violation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get remediation status
   */
  async getRemediationStatus(remediationId: string): Promise<ComplianceOperationResult<RemediationExecutionResult>> {
    try {
      const cached = this.remediations.get(remediationId);
      if (!cached) {
        return { success: false, error: `Remediation ${remediationId} not found` };
      }

      // Check AWS Config for status
      const command = new DescribeRemediationExecutionStatusCommand({
        ConfigRuleName: cached.ruleName,
        ResourceKeys: [
          {
            resourceType: cached.resourceType as ResourceType,
            resourceId: cached.resourceId,
          },
        ],
      });

      const response = await this.configClient.send(command);
      const status = response.RemediationExecutionStatuses?.[0];

      if (status) {
        cached.status = this.mapRemediationStatus(status.State);
        cached.endTime = status.LastUpdatedTime;
        cached.stepDetails = status.StepDetails?.map(step => ({
          name: step.Name || 'Unknown',
          status: this.mapStepStatus(step.State),
          errorMessage: step.ErrorMessage,
          startTime: step.StartTime,
          stopTime: step.StopTime,
        }));
      }

      return { success: true, data: cached };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get remediation status: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * List available remediation actions
   */
  async listRemediationActions(): Promise<ComplianceOperationResult<RemediationActionConfig[]>> {
    const actions: RemediationActionConfig[] = [
      {
        actionType: 'AWS-DisablePublicAccessForS3Bucket',
        targetType: 'SSM_DOCUMENT',
        targetId: 'AWS-DisablePublicAccessForS3Bucket',
        automatic: true,
        retryAttempts: 5,
      },
      {
        actionType: 'AWS-EnableS3BucketEncryption',
        targetType: 'SSM_DOCUMENT',
        targetId: 'AWS-EnableS3BucketEncryption',
        automatic: true,
        retryAttempts: 5,
      },
      {
        actionType: 'AWS-EnableEbsEncryptionByDefault',
        targetType: 'SSM_DOCUMENT',
        targetId: 'AWS-EnableEbsEncryptionByDefault',
        automatic: true,
        retryAttempts: 5,
      },
      {
        actionType: 'AWS-EnableVpcFlowLogs',
        targetType: 'SSM_DOCUMENT',
        targetId: 'AWS-EnableVpcFlowLogs',
        automatic: false,
        retryAttempts: 5,
      },
      {
        actionType: 'AWS-EnableCloudTrailLogFileValidation',
        targetType: 'SSM_DOCUMENT',
        targetId: 'AWS-EnableCloudTrailLogFileValidation',
        automatic: true,
        retryAttempts: 5,
      },
      {
        actionType: 'AWS-ConfigureSecurityGroupRules',
        targetType: 'SSM_DOCUMENT',
        targetId: 'AWS-ConfigureSecurityGroupRules',
        automatic: false,
        retryAttempts: 5,
      },
    ];

    return { success: true, data: actions };
  }

  // =============================================================================
  // Reporting
  // =============================================================================

  /**
   * Generate a compliance report
   */
  async generateReport(options: GenerateReportOptions): Promise<ComplianceOperationResult<ComplianceReport>> {
    try {
      const periodStart = options.periodStart || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const periodEnd = options.periodEnd || new Date();

      // Get compliance data
      const summaryResult = await this.getComplianceSummary(options.framework);
      if (!summaryResult.success || !summaryResult.data) {
        return { success: false, error: 'Failed to get compliance summary for report' };
      }

      const summary = summaryResult.data;

      // Get violations
      const violationsResult = await this.listViolations({
        framework: options.framework,
        sortBy: 'severity',
      });
      const violations = violationsResult.data || [];

      // Calculate report summary
      const reportSummary: ComplianceReportSummary = {
        complianceScore: summary.compliancePercentage,
        totalControls: summary.totalControls,
        compliantControls: summary.compliantControls,
        nonCompliantControls: summary.nonCompliantControls,
        criticalViolations: violations.filter(v => v.severity === 'critical').length,
        highViolations: violations.filter(v => v.severity === 'high').length,
        mediumViolations: violations.filter(v => v.severity === 'medium').length,
        lowViolations: violations.filter(v => v.severity === 'low').length,
        topRecommendations: this.generateTopRecommendations(violations),
      };

      // Generate content based on format
      let content = '';
      switch (options.format) {
        case 'json':
          content = this.generateJsonReport(options, summary, violations, reportSummary);
          break;
        case 'csv':
          content = this.generateCsvReport(options, summary, violations);
          break;
        case 'html':
          content = this.generateHtmlReport(options, summary, violations, reportSummary);
          break;
        default:
          content = this.generateJsonReport(options, summary, violations, reportSummary);
      }

      const report: ComplianceReport = {
        reportId: uuidv4(),
        type: options.type,
        title: this.generateReportTitle(options),
        framework: options.framework,
        periodStart,
        periodEnd,
        generatedAt: new Date(),
        generatedBy: 'AWS Compliance Manager',
        format: options.format,
        summary: reportSummary,
        content,
      };

      // Store report in S3 if requested
      if (options.s3Bucket) {
        const s3Key = `${options.s3KeyPrefix || 'compliance-reports'}/${report.reportId}.${options.format}`;
        await this.s3Client.send(new PutObjectCommand({
          Bucket: options.s3Bucket,
          Key: s3Key,
          Body: content,
          ContentType: this.getContentType(options.format),
        }));
        report.s3Location = `s3://${options.s3Bucket}/${s3Key}`;
      }

      this.reports.set(report.reportId, report);

      return { success: true, data: report };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate report: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * List reports
   */
  async listReports(framework?: ComplianceFramework): Promise<ComplianceOperationResult<ComplianceReport[]>> {
    let reports = Array.from(this.reports.values());
    if (framework) {
      reports = reports.filter(r => r.framework === framework);
    }
    return { success: true, data: reports };
  }

  /**
   * Get a specific report
   */
  async getReport(reportId: string): Promise<ComplianceOperationResult<ComplianceReport>> {
    const report = this.reports.get(reportId);
    if (!report) {
      return { success: false, error: `Report ${reportId} not found` };
    }
    return { success: true, data: report };
  }

  // =============================================================================
  // Private Helper Methods
  // =============================================================================

  private async getConfigComplianceByFramework(framework: ComplianceFramework): Promise<ComplianceByConfigRule[]> {
    try {
      const command = new DescribeComplianceByConfigRuleCommand({});
      const response = await this.configClient.send(command);
      return response.ComplianceByConfigRules || [];
    } catch {
      return [];
    }
  }

  private async getSecurityHubFindings(framework: ComplianceFramework): Promise<AwsSecurityFinding[]> {
    try {
      const standardsArn = this.getSecurityHubStandardArn(framework);
      if (!standardsArn) return [];

      const command = new GetFindingsCommand({
        Filters: {
          GeneratorId: [{ Value: standardsArn, Comparison: 'PREFIX' }],
          RecordState: [{ Value: 'ACTIVE', Comparison: 'EQUALS' }],
        },
        MaxResults: 100,
      });

      const response = await this.securityHubClient.send(command);
      return response.Findings || [];
    } catch {
      return [];
    }
  }

  private getSecurityHubStandardArn(framework: ComplianceFramework): string | null {
    const mapping: Partial<Record<ComplianceFramework, string>> = {
      'CIS': 'arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark',
      'AWS-Foundational-Security': 'arn:aws:securityhub:::standards/aws-foundational-security-best-practices',
      'PCI-DSS': 'arn:aws:securityhub:::standards/pci-dss',
    };
    return mapping[framework] || null;
  }

  private mapSecurityHubStatus(status?: string): ComplianceStatus {
    switch (status) {
      case 'PASSED': return 'COMPLIANT';
      case 'FAILED': return 'NON_COMPLIANT';
      case 'NOT_AVAILABLE': return 'NOT_APPLICABLE';
      default: return 'INSUFFICIENT_DATA';
    }
  }

  private mapConfigRule(rule: ConfigRule): ConfigRuleInfo {
    return {
      ruleName: rule.ConfigRuleName || 'Unknown',
      ruleArn: rule.ConfigRuleArn || '',
      ruleId: rule.ConfigRuleId || '',
      description: rule.Description,
      sourceType: (rule.Source?.Owner as ConfigRuleInfo['sourceType']) || 'AWS',
      sourceIdentifier: rule.Source?.SourceIdentifier || '',
      inputParameters: rule.InputParameters ? JSON.parse(rule.InputParameters) : undefined,
      scope: rule.Scope ? {
        resourceTypes: rule.Scope.ComplianceResourceTypes,
        tagKey: rule.Scope.TagKey,
        tagValue: rule.Scope.TagValue,
      } : undefined,
      maximumExecutionFrequency: rule.MaximumExecutionFrequency,
      state: (rule.ConfigRuleState as ConfigRuleInfo['state']) || 'ACTIVE',
      createdBy: rule.CreatedBy,
    };
  }

  private createViolation(
    framework: ComplianceFramework,
    ruleKey: string,
    ruleInfo: typeof AWS_MANAGED_RULES[string],
    resource: ComplianceResource
  ): ComplianceViolation {
    return {
      violationId: uuidv4(),
      framework,
      controlId: ruleKey,
      controlTitle: ruleInfo.description,
      severity: ruleInfo.severity,
      resource,
      description: `Resource ${resource.resourceId} is not compliant with ${ruleKey}`,
      detectedAt: new Date(),
      lastSeenAt: new Date(),
      status: 'open',
      riskScore: this.calculateRiskScore(ruleInfo.severity),
      remediationGuidance: this.getRemediationGuidance(ruleKey),
      autoRemediationAvailable: this.hasAutoRemediation(ruleKey),
      remediationSteps: this.getRemediationSteps(ruleKey),
    };
  }

  private getRemediationGuidance(ruleKey: string): string {
    const guidance: Record<string, string> = {
      's3-bucket-public-read-prohibited': 'Remove public read access from the S3 bucket by updating the bucket policy or ACL.',
      's3-bucket-public-write-prohibited': 'Remove public write access from the S3 bucket by updating the bucket policy or ACL.',
      's3-bucket-ssl-requests-only': 'Add a bucket policy requiring SSL for all requests.',
      's3-bucket-server-side-encryption-enabled': 'Enable default encryption on the S3 bucket using SSE-S3 or SSE-KMS.',
      'iam-root-access-key-check': 'Delete the root account access keys and use IAM users with appropriate permissions instead.',
      'iam-user-mfa-enabled': 'Enable MFA for the IAM user using a virtual or hardware MFA device.',
      'ec2-ebs-encryption-by-default': 'Enable EBS encryption by default in the EC2 settings.',
      'rds-instance-public-access-check': 'Modify the RDS instance to disable public accessibility.',
      'rds-storage-encrypted': 'Create an encrypted snapshot and restore to a new encrypted instance.',
      'cloudtrail-enabled': 'Create a CloudTrail trail that logs management events to an S3 bucket.',
      'vpc-flow-logs-enabled': 'Enable VPC Flow Logs for the VPC to an S3 bucket or CloudWatch Logs.',
      'restricted-ssh': 'Update security group rules to restrict SSH access to specific IP ranges.',
    };
    return guidance[ruleKey] || 'Review AWS documentation for remediation guidance.';
  }

  private hasAutoRemediation(ruleKey: string): boolean {
    const autoRemediatable = [
      's3-bucket-public-read-prohibited',
      's3-bucket-public-write-prohibited',
      's3-bucket-server-side-encryption-enabled',
      's3-bucket-versioning-enabled',
      'ec2-ebs-encryption-by-default',
      'cloudtrail-log-file-validation-enabled',
    ];
    return autoRemediatable.includes(ruleKey);
  }

  private getRemediationSteps(ruleKey: string): Array<{ step: number; description: string; awsCliCommand?: string; estimatedTimeMinutes?: number }> {
    const steps: Record<string, Array<{ step: number; description: string; awsCliCommand?: string; estimatedTimeMinutes?: number }>> = {
      's3-bucket-public-read-prohibited': [
        { step: 1, description: 'Review current bucket policy', awsCliCommand: 'aws s3api get-bucket-policy --bucket BUCKET_NAME', estimatedTimeMinutes: 1 },
        { step: 2, description: 'Block public access', awsCliCommand: 'aws s3api put-public-access-block --bucket BUCKET_NAME --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"', estimatedTimeMinutes: 1 },
        { step: 3, description: 'Verify the change', awsCliCommand: 'aws s3api get-public-access-block --bucket BUCKET_NAME', estimatedTimeMinutes: 1 },
      ],
      'iam-user-mfa-enabled': [
        { step: 1, description: 'Navigate to IAM console and select the user', estimatedTimeMinutes: 2 },
        { step: 2, description: 'Click on Security credentials tab', estimatedTimeMinutes: 1 },
        { step: 3, description: 'Enable MFA device (virtual or hardware)', estimatedTimeMinutes: 5 },
        { step: 4, description: 'Complete MFA setup with two consecutive codes', estimatedTimeMinutes: 2 },
      ],
      'rds-storage-encrypted': [
        { step: 1, description: 'Create a snapshot of the unencrypted RDS instance', awsCliCommand: 'aws rds create-db-snapshot --db-instance-identifier INSTANCE_ID --db-snapshot-identifier SNAPSHOT_ID', estimatedTimeMinutes: 10 },
        { step: 2, description: 'Copy the snapshot with encryption enabled', awsCliCommand: 'aws rds copy-db-snapshot --source-db-snapshot-identifier SNAPSHOT_ID --target-db-snapshot-identifier ENCRYPTED_SNAPSHOT_ID --kms-key-id KMS_KEY_ID', estimatedTimeMinutes: 15 },
        { step: 3, description: 'Restore from encrypted snapshot', awsCliCommand: 'aws rds restore-db-instance-from-db-snapshot --db-instance-identifier NEW_INSTANCE_ID --db-snapshot-identifier ENCRYPTED_SNAPSHOT_ID', estimatedTimeMinutes: 20 },
        { step: 4, description: 'Update application connection strings', estimatedTimeMinutes: 5 },
        { step: 5, description: 'Delete old unencrypted instance', awsCliCommand: 'aws rds delete-db-instance --db-instance-identifier OLD_INSTANCE_ID --skip-final-snapshot', estimatedTimeMinutes: 5 },
      ],
    };
    return steps[ruleKey] || [{ step: 1, description: 'Review AWS documentation for manual remediation steps', estimatedTimeMinutes: 30 }];
  }

  private getDefaultRemediationAction(controlId: string): string | null {
    const mapping: Record<string, string> = {
      's3-bucket-public-read-prohibited': 'AWS-DisablePublicAccessForS3Bucket',
      's3-bucket-public-write-prohibited': 'AWS-DisablePublicAccessForS3Bucket',
      's3-bucket-server-side-encryption-enabled': 'AWS-EnableS3BucketEncryption',
      'ec2-ebs-encryption-by-default': 'AWS-EnableEbsEncryptionByDefault',
      'vpc-flow-logs-enabled': 'AWS-EnableVpcFlowLogs',
      'cloudtrail-log-file-validation-enabled': 'AWS-EnableCloudTrailLogFileValidation',
    };
    return mapping[controlId] || null;
  }

  private getRuleCategory(ruleKey: string): string {
    if (ruleKey.startsWith('s3-')) return 'Storage';
    if (ruleKey.startsWith('iam-')) return 'Identity and Access Management';
    if (ruleKey.startsWith('ec2-') || ruleKey.startsWith('restricted-')) return 'Compute';
    if (ruleKey.startsWith('rds-') || ruleKey.startsWith('db-')) return 'Database';
    if (ruleKey.startsWith('cloudtrail-')) return 'Logging';
    if (ruleKey.startsWith('vpc-')) return 'Networking';
    if (ruleKey.startsWith('kms-') || ruleKey.startsWith('cmk-')) return 'Encryption';
    if (ruleKey.startsWith('lambda-')) return 'Serverless';
    if (ruleKey.startsWith('securityhub-') || ruleKey.startsWith('guardduty-')) return 'Security Services';
    return 'General';
  }

  private getResourceCategory(resourceType: string): string {
    if (resourceType.includes('S3')) return 'Storage';
    if (resourceType.includes('IAM')) return 'Identity';
    if (resourceType.includes('EC2') || resourceType.includes('SecurityGroup')) return 'Compute';
    if (resourceType.includes('RDS') || resourceType.includes('DB')) return 'Database';
    if (resourceType.includes('CloudTrail')) return 'Logging';
    if (resourceType.includes('VPC')) return 'Networking';
    if (resourceType.includes('KMS')) return 'Encryption';
    if (resourceType.includes('Lambda')) return 'Serverless';
    return 'Other';
  }

  private severityToNumber(severity: ComplianceSeverity): number {
    const map: Record<ComplianceSeverity, number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      informational: 1,
    };
    return map[severity];
  }

  private calculateRiskScore(severity: ComplianceSeverity): number {
    const baseScore: Record<ComplianceSeverity, number> = {
      critical: 90,
      high: 70,
      medium: 50,
      low: 30,
      informational: 10,
    };
    // Add some variance
    return baseScore[severity] + Math.floor(Math.random() * 10);
  }

  private checkResourceTags(
    resource: ResourceTagMapping,
    requiredTags: Array<{ key: string; allowedValues?: string[]; valuePattern?: string }>
  ): TagComplianceResult {
    const currentTags: Record<string, string> = {};
    for (const tag of resource.Tags || []) {
      if (tag.Key && tag.Value) {
        currentTags[tag.Key] = tag.Value;
      }
    }

    const missingTags: string[] = [];
    const invalidTags: Array<{ key: string; currentValue?: string; expected: string; message: string }> = [];

    for (const required of requiredTags) {
      const currentValue = currentTags[required.key];

      if (!currentValue) {
        missingTags.push(required.key);
      } else if (required.allowedValues?.length && !required.allowedValues.includes(currentValue)) {
        invalidTags.push({
          key: required.key,
          currentValue,
          expected: `One of: ${required.allowedValues.join(', ')}`,
          message: `Value '${currentValue}' is not in allowed values`,
        });
      } else if (required.valuePattern) {
        const regex = new RegExp(required.valuePattern);
        if (!regex.test(currentValue)) {
          invalidTags.push({
            key: required.key,
            currentValue,
            expected: `Pattern: ${required.valuePattern}`,
            message: `Value '${currentValue}' does not match pattern`,
          });
        }
      }
    }

    // Extract region from ARN
    const arnParts = resource.ResourceARN?.split(':') || [];
    const region = arnParts[3] || this.config.defaultRegion || 'us-east-1';
    const resourceType = arnParts[2] || 'Unknown';

    return {
      resourceType,
      resourceId: resource.ResourceARN || 'Unknown',
      resourceArn: resource.ResourceARN,
      region,
      isCompliant: missingTags.length === 0 && invalidTags.length === 0,
      missingTags,
      invalidTags,
      currentTags,
      checkedAt: new Date(),
    };
  }

  private async remediateResourceTags(
    resource: ResourceTagMapping,
    requiredTags: Array<{ key: string; defaultValue?: string }>,
    options: EnforceTagsOptions
  ): Promise<{ success: boolean; error?: string }> {
    if (!resource.ResourceARN) {
      return { success: false, error: 'Resource ARN is required' };
    }

    try {
      const currentTags: Record<string, string> = {};
      for (const tag of resource.Tags || []) {
        if (tag.Key && tag.Value) {
          currentTags[tag.Key] = tag.Value;
        }
      }

      const tagsToAdd: Record<string, string> = {};
      for (const required of requiredTags) {
        if (!currentTags[required.key] && required.defaultValue && options.applyDefaults) {
          tagsToAdd[required.key] = required.defaultValue;
        }
      }

      if (Object.keys(tagsToAdd).length > 0) {
        const command = new TagResourcesCommand({
          ResourceARNList: [resource.ResourceARN],
          Tags: tagsToAdd,
        });
        await this.taggingClient.send(command);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private mapRemediationStatus(state?: string): RemediationExecutionResult['status'] {
    switch (state) {
      case 'QUEUED': return 'QUEUED';
      case 'IN_PROGRESS': return 'IN_PROGRESS';
      case 'SUCCEEDED': return 'SUCCEEDED';
      case 'FAILED': return 'FAILED';
      default: return 'QUEUED';
    }
  }

  private mapStepStatus(state?: string): 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' {
    switch (state) {
      case 'PENDING': return 'PENDING';
      case 'IN_PROGRESS': return 'IN_PROGRESS';
      case 'SUCCEEDED': return 'SUCCEEDED';
      case 'FAILED': return 'FAILED';
      case 'SKIPPED': return 'SKIPPED';
      default: return 'PENDING';
    }
  }

  private generateTopRecommendations(violations: ComplianceViolation[]): string[] {
    const recommendations: string[] = [];

    // Group by severity
    const critical = violations.filter(v => v.severity === 'critical');
    const high = violations.filter(v => v.severity === 'high');

    if (critical.length > 0) {
      recommendations.push(`Address ${critical.length} critical violations immediately - these pose significant security risks.`);
    }

    if (high.length > 0) {
      recommendations.push(`Review and remediate ${high.length} high severity findings within the next sprint.`);
    }

    // Common patterns
    const s3Public = violations.filter(v => v.controlId.includes('public'));
    if (s3Public.length > 0) {
      recommendations.push('Enable S3 Block Public Access at the account level to prevent future public bucket configurations.');
    }

    const encryption = violations.filter(v => v.controlId.includes('encrypt'));
    if (encryption.length > 0) {
      recommendations.push('Enable encryption by default for EBS volumes and S3 buckets.');
    }

    const mfa = violations.filter(v => v.controlId.includes('mfa'));
    if (mfa.length > 0) {
      recommendations.push('Enforce MFA for all IAM users, especially those with console access.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue monitoring compliance status and address any new findings promptly.');
    }

    return recommendations.slice(0, 5);
  }

  private generateReportTitle(options: GenerateReportOptions): string {
    const frameworkName = FRAMEWORK_DEFINITIONS.find(f => f.id === options.framework)?.name || options.framework;
    const typeNames: Record<string, string> = {
      executive_summary: 'Executive Summary',
      detailed_findings: 'Detailed Findings Report',
      remediation_progress: 'Remediation Progress Report',
      trend_analysis: 'Compliance Trend Analysis',
      resource_compliance: 'Resource Compliance Report',
      framework_assessment: 'Framework Assessment',
    };
    return `${frameworkName} - ${typeNames[options.type] || options.type}`;
  }

  private generateJsonReport(
    options: GenerateReportOptions,
    summary: ComplianceSummary,
    violations: ComplianceViolation[],
    reportSummary: ComplianceReportSummary
  ): string {
    return JSON.stringify({
      metadata: {
        framework: options.framework,
        type: options.type,
        generatedAt: new Date().toISOString(),
        periodStart: options.periodStart?.toISOString(),
        periodEnd: options.periodEnd?.toISOString(),
      },
      summary: reportSummary,
      complianceDetails: summary,
      violations: options.includeResourceDetails ? violations : violations.map(v => ({
        violationId: v.violationId,
        controlId: v.controlId,
        severity: v.severity,
        status: v.status,
      })),
    }, null, 2);
  }

  private generateCsvReport(
    _options: GenerateReportOptions,
    _summary: ComplianceSummary,
    violations: ComplianceViolation[]
  ): string {
    const headers = ['Violation ID', 'Control ID', 'Severity', 'Status', 'Resource Type', 'Resource ID', 'Region', 'Detected At'];
    const rows = violations.map(v => [
      v.violationId,
      v.controlId,
      v.severity,
      v.status,
      v.resource.resourceType,
      v.resource.resourceId,
      v.resource.region,
      v.detectedAt.toISOString(),
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  private generateHtmlReport(
    options: GenerateReportOptions,
    summary: ComplianceSummary,
    violations: ComplianceViolation[],
    reportSummary: ComplianceReportSummary
  ): string {
    const frameworkInfo = FRAMEWORK_DEFINITIONS.find(f => f.id === options.framework);

    return `<!DOCTYPE html>
<html>
<head>
  <title>${this.generateReportTitle(options)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #232f3e; border-bottom: 3px solid #ff9900; padding-bottom: 10px; }
    h2 { color: #232f3e; margin-top: 30px; }
    .summary-card { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .score { font-size: 48px; font-weight: bold; color: ${reportSummary.complianceScore >= 80 ? '#2e7d32' : reportSummary.complianceScore >= 60 ? '#f57c00' : '#c62828'}; }
    .metric { display: inline-block; margin: 10px 20px 10px 0; }
    .metric-value { font-size: 24px; font-weight: bold; }
    .metric-label { color: #666; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background: #232f3e; color: white; }
    tr:nth-child(even) { background: #f9f9f9; }
    .severity-critical { color: #c62828; font-weight: bold; }
    .severity-high { color: #f57c00; font-weight: bold; }
    .severity-medium { color: #fbc02d; }
    .severity-low { color: #2e7d32; }
    .recommendations { background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .recommendations li { margin: 8px 0; }
  </style>
</head>
<body>
  <h1>${this.generateReportTitle(options)}</h1>
  <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  <p><strong>Framework:</strong> ${frameworkInfo?.name || options.framework} (${frameworkInfo?.version || 'N/A'})</p>

  <div class="summary-card">
    <h2>Compliance Score</h2>
    <div class="score">${reportSummary.complianceScore}%</div>
    <div class="metric">
      <div class="metric-value">${summary.totalControls}</div>
      <div class="metric-label">Total Controls</div>
    </div>
    <div class="metric">
      <div class="metric-value" style="color: #2e7d32;">${summary.compliantControls}</div>
      <div class="metric-label">Compliant</div>
    </div>
    <div class="metric">
      <div class="metric-value" style="color: #c62828;">${summary.nonCompliantControls}</div>
      <div class="metric-label">Non-Compliant</div>
    </div>
  </div>

  <h2>Violations by Severity</h2>
  <table>
    <tr>
      <th>Severity</th>
      <th>Count</th>
    </tr>
    <tr><td class="severity-critical">Critical</td><td>${reportSummary.criticalViolations}</td></tr>
    <tr><td class="severity-high">High</td><td>${reportSummary.highViolations}</td></tr>
    <tr><td class="severity-medium">Medium</td><td>${reportSummary.mediumViolations}</td></tr>
    <tr><td class="severity-low">Low</td><td>${reportSummary.lowViolations}</td></tr>
  </table>

  <div class="recommendations">
    <h2>Top Recommendations</h2>
    <ul>
      ${reportSummary.topRecommendations.map(r => `<li>${r}</li>`).join('\n      ')}
    </ul>
  </div>

  ${options.includeResourceDetails ? `
  <h2>Violation Details</h2>
  <table>
    <tr>
      <th>Control</th>
      <th>Severity</th>
      <th>Resource</th>
      <th>Status</th>
    </tr>
    ${violations.slice(0, 50).map(v => `
    <tr>
      <td>${v.controlId}</td>
      <td class="severity-${v.severity}">${v.severity}</td>
      <td>${v.resource.resourceType}: ${v.resource.resourceId}</td>
      <td>${v.status}</td>
    </tr>`).join('')}
  </table>
  ${violations.length > 50 ? `<p><em>Showing 50 of ${violations.length} violations</em></p>` : ''}
  ` : ''}

</body>
</html>`;
  }

  private getContentType(format: string): string {
    switch (format) {
      case 'json': return 'application/json';
      case 'csv': return 'text/csv';
      case 'html': return 'text/html';
      case 'pdf': return 'application/pdf';
      default: return 'text/plain';
    }
  }
}

// =============================================================================
// Export
// =============================================================================

export { AWSComplianceManager as default };
