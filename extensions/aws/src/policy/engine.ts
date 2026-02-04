/**
 * Policy Engine - OPA-style policy validation for infrastructure intents
 * 
 * Validates infrastructure plans against compliance frameworks, security policies,
 * and organizational best practices before provisioning.
 */

import type {
  ApplicationIntent,
  PlannedResource,
  PolicyViolation,
  PolicyWarning,
  ComplianceFramework,
} from '../intent/types.js';

export interface PolicyRule {
  /** Rule identifier */
  id: string;
  /** Rule name */
  name: string;
  /** Description */
  description: string;
  /** Severity if violated */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Compliance frameworks this rule applies to */
  frameworks: ComplianceFramework[];
  /** Resource types this rule applies to */
  resourceTypes: string[];
  /** Evaluation function */
  evaluate: (resource: PlannedResource, intent: ApplicationIntent) => PolicyEvaluationResult;
  /** Auto-fix function (optional) */
  autoFix?: (resource: PlannedResource) => PlannedResource;
}

export interface PolicyEvaluationResult {
  /** Whether the rule passed */
  passed: boolean;
  /** Violation message (if failed) */
  message?: string;
  /** Remediation suggestion */
  remediation?: string;
  /** Can be automatically fixed */
  autoFixable: boolean;
}

export interface PolicyEngineConfig {
  /** Enable auto-fix for violations */
  enableAutoFix: boolean;
  /** Fail on critical violations */
  failOnCritical: boolean;
  /** Additional custom rules */
  customRules?: PolicyRule[];
}

/**
 * Policy Engine - Validates infrastructure against policies
 */
export class PolicyEngine {
  private rules: PolicyRule[];

  constructor(private config: PolicyEngineConfig) {
    this.rules = [...BUILT_IN_POLICY_RULES, ...(config.customRules || [])];
  }

  /**
   * Validate infrastructure plan against all applicable policies
   */
  async validatePlan(
    resources: PlannedResource[],
    intent: ApplicationIntent,
  ): Promise<{ passed: boolean; violations: PolicyViolation[]; warnings: PolicyWarning[]; policiesEvaluated: string[] }> {
    const violations: PolicyViolation[] = [];
    const warnings: PolicyWarning[] = [];
    const policiesEvaluated = new Set<string>();

    for (const resource of resources) {
      const applicableRules = this.getApplicableRules(resource, intent);
      
      for (const rule of applicableRules) {
        policiesEvaluated.add(rule.id);
        const result = rule.evaluate(resource, intent);
        
        if (!result.passed) {
          this.categorizeViolation(result, rule, resource, violations, warnings);
        }
      }
    }

    // Auto-fix violations if enabled
    if (this.config.enableAutoFix) {
      await this.applyAutoFixes(resources, violations);
    }

    const passed = violations.length === 0 || 
      (violations.every(v => v.severity !== 'critical') && !this.config.failOnCritical);

    return {
      passed,
      violations,
      warnings,
      policiesEvaluated: Array.from(policiesEvaluated),
    };
  }

  /**
   * Categorize policy violation into warning or violation based on severity
   */
  private categorizeViolation(
    result: PolicyEvaluationResult,
    rule: PolicyRule,
    resource: PlannedResource,
    violations: PolicyViolation[],
    warnings: PolicyWarning[],
  ): void {
    const isLowSeverity = rule.severity === 'low' || rule.severity === 'medium';
    
    if (isLowSeverity) {
      warnings.push({
        message: result.message || `Policy ${rule.name} violated`,
        resourceId: resource.id,
        recommendation: result.remediation,
      });
    } else {
      violations.push({
        severity: rule.severity,
        policy: rule.id,
        resourceId: resource.id,
        message: result.message || `Policy ${rule.name} violated`,
        remediation: result.remediation,
        autoFixable: result.autoFixable && rule.autoFix !== undefined,
      });
    }
  }

  /**
   * Get rules applicable to a specific resource and intent
   */
  private getApplicableRules(resource: PlannedResource, intent: ApplicationIntent): PolicyRule[] {
    return this.rules.filter(rule => {
      // Check if rule applies to this resource type
      if (rule.resourceTypes.length > 0 && !rule.resourceTypes.includes(resource.type)) {
        return false;
      }
      
      // Check if rule applies to compliance frameworks
      if (rule.frameworks.length > 0) {
        const hasApplicableFramework = intent.compliance.some(framework =>
          rule.frameworks.includes(framework)
        );
        if (!hasApplicableFramework && !rule.frameworks.includes('none')) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * Apply auto-fixes to violations
   */
  private async applyAutoFixes(
    resources: PlannedResource[],
    violations: PolicyViolation[],
  ): Promise<void> {
    for (const violation of violations) {
      if (!violation.autoFixable) continue;
      
      const rule = this.rules.find(r => r.id === violation.policy);
      if (!rule?.autoFix) continue;
      
      const resourceIndex = resources.findIndex(r => r.id === violation.resourceId);
      if (resourceIndex === -1) continue;
      
      try {
        resources[resourceIndex] = rule.autoFix(resources[resourceIndex]);
        violation.autoFixable = false; // Mark as fixed
      } catch (error) {
        console.error(`Failed to auto-fix ${violation.policy}:`, error);
      }
    }
  }

  /**
   * Validate a single resource against policies
   */
  async validateResource(
    resource: PlannedResource,
    intent: ApplicationIntent,
  ): Promise<PolicyEvaluationResult[]> {
    const applicableRules = this.getApplicableRules(resource, intent);
    return applicableRules.map(rule => rule.evaluate(resource, intent));
  }

  /**
   * Add custom policy rule
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove policy rule by ID
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }
}

/**
 * Built-in policy rules
 */
const BUILT_IN_POLICY_RULES: PolicyRule[] = [
  // Encryption at rest
  {
    id: 'encryption-at-rest',
    name: 'Encryption at Rest Required',
    description: 'All data stores must have encryption at rest enabled',
    severity: 'critical',
    frameworks: ['hipaa', 'pci-dss', 'soc2', 'gdpr', 'iso27001', 'fedramp'],
    resourceTypes: ['rds_instance', 's3_bucket', 'ebs_volume', 'dynamodb_table'],
    evaluate: (resource, intent) => {
      if (!intent.security.encryptionAtRest) {
        return { passed: true, autoFixable: false };
      }
      
      const encrypted = 
        resource.properties.storageEncrypted === true ||
        resource.properties.encryption !== 'none' ||
        resource.properties.encrypted === true;
      
      return {
        passed: encrypted,
        message: `${resource.type} ${resource.id} does not have encryption at rest enabled`,
        remediation: 'Enable encryption at rest for all data stores',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      if (resource.type === 'rds_instance') {
        resource.properties.storageEncrypted = true;
      } else if (resource.type === 's3_bucket') {
        resource.properties.encryption = 'AES256';
      } else if (resource.type === 'ebs_volume') {
        resource.properties.encrypted = true;
      }
      return resource;
    },
  },

  // Encryption in transit
  {
    id: 'encryption-in-transit',
    name: 'Encryption in Transit Required',
    description: 'All network communication must be encrypted',
    severity: 'high',
    frameworks: ['hipaa', 'pci-dss', 'soc2', 'gdpr', 'fedramp'],
    resourceTypes: ['application_load_balancer', 'elasticache_cluster', 'rds_instance'],
    evaluate: (resource, intent) => {
      if (!intent.security.encryptionInTransit) {
        return { passed: true, autoFixable: false };
      }
      
      let encrypted = false;
      
      if (resource.type === 'application_load_balancer') {
        encrypted = Array.isArray(resource.properties.listeners) 
          && (resource.properties.listeners as any[]).some((l: any) => l.protocol === 'HTTPS');
      } else if (resource.type === 'elasticache_cluster') {
        encrypted = resource.properties.transitEncryptionEnabled === true;
      } else if (resource.type === 'rds_instance') {
        encrypted = resource.properties.enableIAMDatabaseAuthentication === true;
      }
      
      return {
        passed: encrypted,
        message: `${resource.type} ${resource.id} does not have encryption in transit enabled`,
        remediation: 'Enable TLS/SSL for all network connections',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      if (resource.type === 'elasticache_cluster') {
        resource.properties.transitEncryptionEnabled = true;
      } else if (resource.type === 'rds_instance') {
        resource.properties.enableIAMDatabaseAuthentication = true;
      }
      return resource;
    },
  },

  // Multi-AZ for high availability
  {
    id: 'multi-az-required',
    name: 'Multi-AZ Required for Production',
    description: 'Production databases must use Multi-AZ deployment',
    severity: 'high',
    frameworks: ['none'],
    resourceTypes: ['rds_instance'],
    evaluate: (resource, intent) => {
      if (intent.environment !== 'production') {
        return { passed: true, autoFixable: false };
      }
      
      if (intent.availability < '99.95') {
        return { passed: true, autoFixable: false };
      }
      
      const multiAz = resource.properties.multiAz === true;
      
      return {
        passed: multiAz,
        message: `Production RDS instance ${resource.id} is not Multi-AZ`,
        remediation: 'Enable Multi-AZ for high availability',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      resource.properties.multiAz = true;
      return resource;
    },
  },

  // Backup retention
  {
    id: 'backup-retention',
    name: 'Backup Retention Required',
    description: 'All databases must have automated backups configured',
    severity: 'high',
    frameworks: ['soc2', 'hipaa', 'iso27001'],
    resourceTypes: ['rds_instance'],
    evaluate: (resource, intent) => {
      const retentionPeriod = resource.properties.backupRetentionPeriod as number;
      const minRetention = intent.disasterRecovery?.backupRetentionDays || 7;
      
      const passed = retentionPeriod >= minRetention;
      
      return {
        passed,
        message: `RDS instance ${resource.id} backup retention (${retentionPeriod} days) is less than required (${minRetention} days)`,
        remediation: `Set backup retention period to at least ${minRetention} days`,
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      const minRetention = 7;
      resource.properties.backupRetentionPeriod = Math.max(
        resource.properties.backupRetentionPeriod as number || 0,
        minRetention
      );
      return resource;
    },
  },

  // Public access restrictions
  {
    id: 'no-public-databases',
    name: 'No Public Database Access',
    description: 'Databases must not be publicly accessible',
    severity: 'critical',
    frameworks: ['hipaa', 'pci-dss', 'soc2', 'gdpr', 'iso27001'],
    resourceTypes: ['rds_instance'],
    evaluate: (resource) => {
      const publiclyAccessible = resource.properties.publiclyAccessible === true;
      
      return {
        passed: !publiclyAccessible,
        message: `RDS instance ${resource.id} is publicly accessible`,
        remediation: 'Disable public accessibility for databases',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      resource.properties.publiclyAccessible = false;
      return resource;
    },
  },

  // Deletion protection for production
  {
    id: 'deletion-protection',
    name: 'Deletion Protection Required',
    description: 'Production resources must have deletion protection enabled',
    severity: 'medium',
    frameworks: ['none'],
    resourceTypes: ['rds_instance'],
    evaluate: (resource, intent) => {
      if (intent.environment !== 'production') {
        return { passed: true, autoFixable: false };
      }
      
      const protected_ = resource.properties.deletionProtection === true;
      
      return {
        passed: protected_,
        message: `Production RDS instance ${resource.id} does not have deletion protection`,
        remediation: 'Enable deletion protection for production databases',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      resource.properties.deletionProtection = true;
      return resource;
    },
  },

  // VPC requirements
  {
    id: 'vpc-required',
    name: 'VPC Isolation Required',
    description: 'Resources must be deployed within a VPC',
    severity: 'high',
    frameworks: ['pci-dss', 'hipaa', 'fedramp'],
    resourceTypes: ['ec2_instance', 'rds_instance', 'elasticache_cluster'],
    evaluate: (resource, intent) => {
      if (intent.security.networkIsolation === 'none') {
        return { passed: true, autoFixable: false };
      }
      
      const hasVpc = resource.properties.vpcId || resource.properties.subnetIds;
      
      return {
        passed: !!hasVpc,
        message: `${resource.type} ${resource.id} is not deployed in a VPC`,
        remediation: 'Deploy all resources within a VPC',
        autoFixable: false,
      };
    },
  },

  // Logging requirements
  {
    id: 'cloudwatch-logs-enabled',
    name: 'CloudWatch Logs Required',
    description: 'Audit logging must be enabled for compliance',
    severity: 'medium',
    frameworks: ['soc2', 'pci-dss', 'hipaa', 'iso27001'],
    resourceTypes: ['rds_instance', 'lambda_function'],
    evaluate: (resource) => {
      const logsEnabled = 
        (Array.isArray(resource.properties.enabledCloudwatchLogsExports) 
          && resource.properties.enabledCloudwatchLogsExports.length > 0) ||
        resource.properties.cloudwatchLogsRetentionInDays !== undefined;
      
      return {
        passed: !!logsEnabled,
        message: `${resource.type} ${resource.id} does not have CloudWatch Logs enabled`,
        remediation: 'Enable CloudWatch Logs for audit trails',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      if (resource.type === 'rds_instance') {
        resource.properties.enabledCloudwatchLogsExports = ['error', 'general', 'slowquery'];
      } else if (resource.type === 'lambda_function') {
        resource.properties.cloudwatchLogsRetentionInDays = 30;
      }
      return resource;
    },
  },

  // S3 versioning for compliance
  {
    id: 's3-versioning-required',
    name: 'S3 Versioning Required',
    description: 'S3 buckets must have versioning enabled for data protection',
    severity: 'medium',
    frameworks: ['soc2', 'iso27001'],
    resourceTypes: ['s3_bucket'],
    evaluate: (resource, intent) => {
      if (!intent.disasterRecovery) {
        return { passed: true, autoFixable: false };
      }
      
      const versioningEnabled = resource.properties.versioning === true;
      
      return {
        passed: versioningEnabled,
        message: `S3 bucket ${resource.id} does not have versioning enabled`,
        remediation: 'Enable versioning for data protection and compliance',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      resource.properties.versioning = true;
      return resource;
    },
  },

  // S3 public access block
  {
    id: 's3-block-public-access',
    name: 'S3 Block Public Access',
    description: 'S3 buckets must block public access unless explicitly allowed',
    severity: 'critical',
    frameworks: ['hipaa', 'pci-dss', 'soc2', 'gdpr'],
    resourceTypes: ['s3_bucket'],
    evaluate: (resource) => {
      const blockPublicAccess = resource.properties.blockPublicAccess !== false;
      
      return {
        passed: blockPublicAccess,
        message: `S3 bucket ${resource.id} allows public access`,
        remediation: 'Enable S3 Block Public Access settings',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      resource.properties.blockPublicAccess = true;
      return resource;
    },
  },

  // IAM least privilege
  {
    id: 'iam-least-privilege',
    name: 'IAM Least Privilege',
    description: 'IAM roles should follow least privilege principle',
    severity: 'medium',
    frameworks: ['soc2', 'pci-dss', 'hipaa', 'iso27001', 'fedramp'],
    resourceTypes: ['iam_role', 'iam_policy'],
    evaluate: (resource) => {
      const policies = resource.properties.managedPolicies as string[] || [];
      const hasAdminPolicy = policies.some(p => 
        p.includes('AdministratorAccess') || p.includes('PowerUserAccess')
      );
      
      return {
        passed: !hasAdminPolicy,
        message: `IAM role ${resource.id} has overly permissive policies`,
        remediation: 'Follow least privilege principle for IAM roles',
        autoFixable: false,
      };
    },
  },

  // Security group egress restrictions
  {
    id: 'security-group-egress',
    name: 'Security Group Egress Restrictions',
    description: 'Security groups should have restricted egress rules',
    severity: 'low',
    frameworks: ['pci-dss', 'fedramp'],
    resourceTypes: ['security_group'],
    evaluate: (resource) => {
      const egressRules = resource.properties.egressRules as any[] || [];
      const allowsAllEgress = egressRules.some(rule => 
        rule.cidr === '0.0.0.0/0' && rule.protocol === '-1'
      );
      
      return {
        passed: !allowsAllEgress,
        message: `Security group ${resource.id} allows all outbound traffic`,
        remediation: 'Restrict egress rules to only required destinations',
        autoFixable: false,
      };
    },
  },

  // Resource tagging
  {
    id: 'required-tags',
    name: 'Required Tags',
    description: 'Resources must have required tags for governance',
    severity: 'low',
    frameworks: ['none'],
    resourceTypes: [],
    evaluate: (resource, intent) => {
      const requiredTags = ['Environment', 'Owner', 'CostCenter'];
      const resourceTags = resource.tags || {};
      
      const missingTags = requiredTags.filter(tag => !resourceTags[tag]);
      
      return {
        passed: missingTags.length === 0,
        message: `Resource ${resource.id} is missing required tags: ${missingTags.join(', ')}`,
        remediation: 'Add all required tags to resources',
        autoFixable: true,
      };
    },
    autoFix: (resource) => {
      resource.tags = resource.tags || {};
      if (!resource.tags.Environment) resource.tags.Environment = 'unknown';
      if (!resource.tags.Owner) resource.tags.Owner = 'unassigned';
      if (!resource.tags.CostCenter) resource.tags.CostCenter = 'unassigned';
      return resource;
    },
  },
];

/**
 * Create a policy engine instance
 */
export function createPolicyEngine(config?: Partial<PolicyEngineConfig>): PolicyEngine {
  const defaultConfig: PolicyEngineConfig = {
    enableAutoFix: false,
    failOnCritical: true,
    customRules: [],
  };
  
  return new PolicyEngine({ ...defaultConfig, ...config });
}

/**
 * Common compliance framework policy sets
 */
export const COMPLIANCE_POLICY_SETS = {
  hipaa: [
    'encryption-at-rest',
    'encryption-in-transit',
    'no-public-databases',
    'backup-retention',
    'cloudwatch-logs-enabled',
    'vpc-required',
  ],
  
  'pci-dss': [
    'encryption-at-rest',
    'encryption-in-transit',
    'no-public-databases',
    'vpc-required',
    'cloudwatch-logs-enabled',
    'security-group-egress',
  ],
  
  soc2: [
    'encryption-at-rest',
    'encryption-in-transit',
    'backup-retention',
    'cloudwatch-logs-enabled',
    's3-versioning-required',
    'iam-least-privilege',
  ],
  
  gdpr: [
    'encryption-at-rest',
    'encryption-in-transit',
    'no-public-databases',
    's3-block-public-access',
  ],
} as const;
