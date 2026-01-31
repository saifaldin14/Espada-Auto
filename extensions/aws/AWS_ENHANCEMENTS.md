# AWS Extension: Production-Grade Enhancement Roadmap

> **Value Proposition**: Enable companies to automate their infrastructure setup through conversational infrastructure management.

## Current State Summary

The AWS extension provides comprehensive infrastructure management through:

### Current Services
| Service | Capabilities |
|---------|-------------|
| **EC2** | Instance lifecycle, security groups, key pairs, ASGs, ELBs |
| **RDS** | Full database management (instances, snapshots, replicas, Multi-AZ) |
| **Lambda** | Functions, layers, aliases, concurrency, function URLs |
| **S3** | Buckets, objects, versioning, encryption, lifecycle, CloudFront |
| **CloudTrail** | Audit logging and security events |
| **Service Discovery** | Resource enumeration and tagging |
| **IaC** | Terraform/CloudFormation generation (✅ Implemented) |
| **Cost Management** | Cost analysis, optimization, budgets (✅ Implemented) |
| **Network/VPC** | VPCs, subnets, route tables, NAT, endpoints (✅ Implemented) |
| **Security/IAM** | IAM, Security Hub, GuardDuty, KMS, Secrets Manager (✅ Implemented) |

### Current Interfaces
- **CLI commands**: `espada aws ...`
- **Gateway methods**: Programmatic API access
- **Agent Tools**: AI-driven conversational access (`aws_ec2`, `aws_rds`, `aws_lambda`, `aws_s3`, `aws_iac`, `aws_cost`, `aws_network`, `aws_security`)

---

## Enhancement Categories

### 1. Infrastructure as Code (IaC) Integration ✅ IMPLEMENTED

**Status**: ✅ **IMPLEMENTED** - Full IaC manager with Terraform and CloudFormation generation

**Implemented Capabilities**:
- ✅ Generate Terraform configurations from resource definitions
- ✅ Generate CloudFormation YAML/JSON templates  
- ✅ Drift detection framework (ready for AWS integration)
- ✅ Plan infrastructure changes preview
- ✅ State export framework (ready for AWS integration)

**New Tool**: `aws_iac`

| Action | Description | Status |
|--------|-------------|--------|
| `generate_terraform` | Generate Terraform HCL from resource definitions | ✅ Implemented |
| `generate_cloudformation` | Generate CloudFormation YAML/JSON templates | ✅ Implemented |
| `detect_drift` | Compare deployed infrastructure with IaC definitions | ✅ Framework Ready |
| `plan_changes` | Preview infrastructure changes before applying | ✅ Implemented |
| `export_state` | Export current infrastructure to IaC format | ✅ Framework Ready |

**Supported Resource Types**:
- EC2: Instances, VPCs, Subnets, Security Groups, Key Pairs, NAT Gateways, EIPs
- RDS: Database Instances, Clusters, Subnet Groups, Parameter Groups
- S3: Buckets with versioning, encryption, lifecycle policies
- Lambda: Functions with VPC config, layers, environment variables
- IAM: Roles, Policies, Instance Profiles
- Load Balancing: ALBs, Target Groups, Listeners
- Auto Scaling: Groups, Launch Templates
- Others: CloudWatch, SNS, SQS, DynamoDB, ElastiCache, KMS

**Example Conversations**:
```
User: "Create a Terraform config for a 3-tier web application with ALB, 
       2 EC2 instances in an ASG, and an RDS PostgreSQL database"

User: "Export my current VPC setup to CloudFormation"

User: "Check if there's any drift between my Terraform state and AWS"
```

**Implementation Files**:
- `src/iac/types.ts` - Type definitions for IaC operations
- `src/iac/manager.ts` - IaC manager with Terraform/CloudFormation generation
- `src/iac/manager.test.ts` - Comprehensive test suite (18 tests)
- `index.ts` - `aws_iac` tool registration

---

### 2. Cost Management & Optimization ✅ IMPLEMENTED

**Current Gap**: ~~No cost visibility or optimization recommendations~~ **RESOLVED**

**Implemented Capabilities**:
- ✅ Cost Explorer integration for spend analysis
- ✅ Right-sizing recommendations (EC2, RDS instances)
- ✅ Reserved instance and Savings Plan recommendations
- ✅ Resource scheduling (stop dev resources at night)
- ✅ Unused resource detection (EBS volumes, EIPs, snapshots, load balancers, Lambda functions)
- ✅ Budget creation and management with alerts
- ✅ Cost forecasting with comparison to previous periods

**New Tool**: `aws_cost`

| Action | Description |
|--------|-------------|
| `get_cost_summary` | Get cost breakdown by service, tag, or account |
| `forecast_costs` | Predict future costs based on current usage |
| `get_optimization_recommendations` | Right-sizing, RI, and Savings Plans recommendations |
| `find_unused_resources` | Detect orphaned EBS, EIPs, snapshots, idle instances |
| `schedule_resources` | Schedule start/stop for dev resources (EC2/RDS) |
| `execute_schedule_action` | Immediately start/stop scheduled resources |
| `create_budget` | Create cost budget with alerts |
| `list_budgets` | List all budgets with status |
| `delete_budget` | Delete a budget |
| `get_savings_plan_recommendations` | Recommend Savings Plans or RIs |

**Example Conversations**:
```
User: "What's my AWS spend this month by service?"

User: "Find all unused resources that are costing me money"

User: "Schedule all dev instances to stop at 6 PM and start at 8 AM"

User: "How much could I save with Reserved Instances?"
```

**Implementation Files**:
- `src/cost/types.ts` - Comprehensive type definitions for cost operations
- `src/cost/manager.ts` - CostManager class with full AWS Cost Explorer/Budgets integration
- `src/cost/manager.test.ts` - Comprehensive test suite (23 tests)
- `src/cost/index.ts` - Module exports
- `index.ts` - `aws_cost` tool registration with 10 actions
- `package.json` - Added @aws-sdk/client-cost-explorer and @aws-sdk/client-budgets dependencies

---

### 3. Network & VPC Management ✅ IMPLEMENTED

**Status**: ✅ **IMPLEMENTED** - Full VPC, subnet, route table, NAT gateway, and endpoint management

**Implemented Capabilities**:
- ✅ VPC creation and management with DNS support
- ✅ Subnet orchestration across AZs (public/private)
- ✅ Route tables and route management
- ✅ NAT gateway creation and management
- ✅ Internet gateway management
- ✅ Network ACLs with rule management
- ✅ VPC Flow logs configuration
- ✅ VPC endpoints for AWS services
- ✅ Security group management with rule updates
- ✅ Elastic IP management

**New Tool**: `aws_network`

| Action | Description | Status |
|--------|-------------|--------|
| `list_vpcs` | List all VPCs with details | ✅ Implemented |
| `get_vpc` | Get detailed VPC information | ✅ Implemented |
| `create_vpc` | Create VPC with CIDR block and DNS options | ✅ Implemented |
| `delete_vpc` | Delete a VPC | ✅ Implemented |
| `list_subnets` | List subnets with AZ/VPC details | ✅ Implemented |
| `create_subnet` | Create subnet in specified AZ | ✅ Implemented |
| `delete_subnet` | Delete a subnet | ✅ Implemented |
| `list_route_tables` | List route tables and entries | ✅ Implemented |
| `create_route_table` | Create route table | ✅ Implemented |
| `create_route` | Add route to route table | ✅ Implemented |
| `delete_route` | Remove route from route table | ✅ Implemented |
| `list_internet_gateways` | List internet gateways | ✅ Implemented |
| `create_internet_gateway` | Create and attach IGW | ✅ Implemented |
| `list_nat_gateways` | List NAT gateways | ✅ Implemented |
| `create_nat_gateway` | Create NAT gateway with EIP | ✅ Implemented |
| `delete_nat_gateway` | Delete NAT gateway | ✅ Implemented |
| `list_network_acls` | List NACLs with rules | ✅ Implemented |
| `create_nacl_entry` | Add NACL rule | ✅ Implemented |
| `delete_nacl_entry` | Remove NACL rule | ✅ Implemented |
| `list_vpc_endpoints` | List VPC endpoints | ✅ Implemented |
| `create_vpc_endpoint` | Create VPC endpoint | ✅ Implemented |
| `configure_flow_logs` | Enable VPC flow logs | ✅ Implemented |
| `list_security_groups` | List security groups | ✅ Implemented |
| `create_security_group` | Create security group | ✅ Implemented |
| `authorize_security_group` | Add inbound/outbound rules | ✅ Implemented |
| `revoke_security_group` | Remove security group rules | ✅ Implemented |
| `list_elastic_ips` | List Elastic IPs | ✅ Implemented |
| `allocate_elastic_ip` | Allocate new EIP | ✅ Implemented |
| `associate_elastic_ip` | Associate EIP with instance/NAT | ✅ Implemented |
| `release_elastic_ip` | Release EIP | ✅ Implemented |

**Example Conversations**:
```
User: "Create a VPC with public and private subnets across 3 AZs"

User: "Set up NAT gateway for my private subnets"

User: "Show me all route tables in my main VPC"

User: "Create a VPC endpoint for S3"
```

**Implementation Files**:
- `src/network/types.ts` - Comprehensive type definitions for all network resources
- `src/network/manager.ts` - NetworkManager class with full EC2 VPC API integration
- `src/network/manager.test.ts` - Comprehensive test suite (49 tests)
- `src/network/index.ts` - Module exports
- `index.ts` - `aws_network` tool registration with 30 actions

---

### 4. IAM & Security Hardening ✅ IMPLEMENTED

**Status**: ✅ **IMPLEMENTED** - Full IAM, Security Hub, GuardDuty, KMS, Secrets Manager, and Access Analyzer integration

**Implemented Capabilities**:
- ✅ IAM role management (create, list, delete, attach/detach policies)
- ✅ IAM user management with access keys and login profiles
- ✅ IAM policy management with 20 predefined templates
- ✅ Policy simulation for permission testing
- ✅ Security Hub findings and compliance standards
- ✅ GuardDuty threat detection and findings
- ✅ KMS key management with rotation
- ✅ Secrets Manager for secure credential storage and rotation
- ✅ Access Analyzer for finding publicly accessible resources
- ✅ Unified security posture dashboard

**New Tool**: `aws_security`

| Action | Description | Status |
|--------|-------------|--------|
| `list_roles` | List IAM roles with attached policies | ✅ Implemented |
| `get_role` | Get detailed role information | ✅ Implemented |
| `create_role` | Create IAM role with trust policy | ✅ Implemented |
| `delete_role` | Delete IAM role | ✅ Implemented |
| `attach_role_policy` | Attach policy to role | ✅ Implemented |
| `detach_role_policy` | Detach policy from role | ✅ Implemented |
| `list_users` | List IAM users with MFA status | ✅ Implemented |
| `get_user` | Get detailed user information | ✅ Implemented |
| `create_user` | Create IAM user with optional access key | ✅ Implemented |
| `delete_user` | Delete IAM user | ✅ Implemented |
| `list_policies` | List customer-managed policies | ✅ Implemented |
| `get_policy` | Get policy with document | ✅ Implemented |
| `create_policy` | Create custom IAM policy | ✅ Implemented |
| `delete_policy` | Delete IAM policy | ✅ Implemented |
| `simulate_policy` | Test policy permissions | ✅ Implemented |
| `get_policy_template` | Get predefined policy template | ✅ Implemented |
| `list_security_findings` | Security Hub findings | ✅ Implemented |
| `enable_security_hub` | Enable Security Hub | ✅ Implemented |
| `disable_security_hub` | Disable Security Hub | ✅ Implemented |
| `list_security_standards` | List compliance standards | ✅ Implemented |
| `list_guardduty_findings` | GuardDuty threat detections | ✅ Implemented |
| `get_guardduty_detector` | Get detector status | ✅ Implemented |
| `enable_guardduty` | Enable GuardDuty | ✅ Implemented |
| `disable_guardduty` | Disable GuardDuty | ✅ Implemented |
| `list_kms_keys` | List KMS keys | ✅ Implemented |
| `create_kms_key` | Create KMS key | ✅ Implemented |
| `enable_key_rotation` | Enable automatic rotation | ✅ Implemented |
| `list_secrets` | List Secrets Manager secrets | ✅ Implemented |
| `get_secret_value` | Retrieve secret value | ✅ Implemented |
| `create_secret` | Create new secret | ✅ Implemented |
| `rotate_secret` | Rotate secret | ✅ Implemented |
| `delete_secret` | Delete secret | ✅ Implemented |
| `list_access_analyzers` | List Access Analyzers | ✅ Implemented |
| `list_access_analyzer_findings` | Public access findings | ✅ Implemented |
| `create_access_analyzer` | Create Access Analyzer | ✅ Implemented |
| `get_security_posture` | Overall security summary | ✅ Implemented |

**Predefined Policy Templates (20 templates)**:
- Lambda: `lambda-basic`, `lambda-vpc`, `lambda-s3-read`, `lambda-s3-write`, `lambda-dynamodb`, `lambda-sqs`, `lambda-sns`
- EC2/ECS/EKS: `ec2-ssm`, `ecs-task`, `eks-node`
- Storage: `s3-read-only`, `s3-full-access`, `dynamodb-read-only`, `dynamodb-full-access`
- Monitoring: `cloudwatch-logs`, `xray-tracing`
- Security: `secrets-read`, `kms-encrypt-decrypt`
- Cross-account: `assume-role`, `cross-account-access`

**Example Conversations**:
```
User: "Create an IAM role for Lambda to access S3 and DynamoDB"

User: "Show me any Security Hub findings with critical severity"

User: "What threats has GuardDuty detected?"

User: "Create a secret for my database credentials and enable rotation"

User: "Give me an overview of my security posture"
```

**Implementation Files**:
- `src/security/types.ts` - Comprehensive type definitions (~900 lines)
- `src/security/manager.ts` - SecurityManager class with 6 AWS SDK clients (~2900 lines)
- `src/security/manager.test.ts` - Comprehensive test suite (44 tests)
- `src/security/index.ts` - Module exports
- `src/index.ts` - Updated with security module exports
- `index.ts` - `aws_security` tool registration with 36 actions
- `package.json` - Added 5 AWS SDK dependencies

---

### 5. Approval Workflows & Guardrails

**Current Gap**: No production safety controls for destructive operations

**Proposed Capabilities**:
- Approval workflows for destructive operations (terminate, delete)
- Dry-run mode for all mutating operations
- Environment tagging (dev/staging/prod) with different permission levels
- Change request integration (ServiceNow, Jira)
- Audit logging for all conversational infrastructure changes
- Rate limiting for bulk operations

**Configuration Schema**:
```typescript
interface ApprovalConfig {
  // Require approval for destructive actions
  requireApproval: boolean;
  
  // List of approvers (email/Slack/Teams)
  approvers: string[];
  
  // Environments requiring approval
  protectedEnvironments: ['production', 'staging'];
  
  // Actions requiring approval
  destructiveActions: ['terminate', 'delete', 'modify'];
  
  // Approval timeout
  timeoutMinutes: number;
  
  // Integration with ticketing systems
  ticketingIntegration?: {
    system: 'jira' | 'servicenow' | 'pagerduty';
    createTicket: boolean;
    requiredFields: string[];
  };
}
```

**Production Safety Checks**:
```typescript
interface ProductionSafetyChecks {
  // Prevent accidental production changes
  confirmProductionChanges: boolean;
  
  // Rate limiting for bulk operations
  maxResourcesPerOperation: number;
  
  // Automatic backup before destructive changes
  createBackupBeforeDelete: boolean;
  
  // Dependency checking
  checkDependenciesBeforeDelete: boolean;
  
  // Time-based restrictions
  preventChangesOutsideWindow: {
    enabled: boolean;
    allowedHours: [9, 17]; // 9 AM - 5 PM
    allowedDays: ['mon', 'tue', 'wed', 'thu', 'fri'];
  };
}
```

**Example Conversations**:
```
User: "Terminate the production web servers"
Bot:  "⚠️ This is a destructive action on production resources.
       Approval required from: ops-team@company.com
       Waiting for approval... (timeout: 30 minutes)"

User: "Delete all untagged EC2 instances"
Bot:  "🔍 Dry-run mode: Found 15 untagged instances.
       This would delete: i-abc123, i-def456, ...
       Type 'confirm' to proceed."
```

---

### 6. Multi-Account & Organization Support

**Current Gap**: Single account operations only

**Proposed Capabilities**:
- Cross-account operations via assume role
- Organization-wide resource visibility
- Consolidated billing insights
- Service Control Policy (SCP) management
- Account creation workflows
- Resource sharing across accounts

**New Tool**: `aws_organization`

| Action | Description |
|--------|-------------|
| `list_accounts` | List all accounts in organization |
| `switch_account` | Switch context to different account |
| `get_org_resources` | List resources across all accounts |
| `create_account` | Create new account in organization |
| `manage_scps` | View/modify Service Control Policies |
| `get_consolidated_billing` | Organization-wide cost breakdown |
| `share_resource` | Share resources via RAM |

**Example Conversations**:
```
User: "Show me all EC2 instances across all accounts"

User: "Switch to the production account"

User: "Create a new account for the data science team"

User: "What's the total AWS spend across all accounts?"
```

---

### 7. Container Services (ECS/EKS)

**Current Gap**: No container orchestration support

**Proposed Capabilities**:
- ECS cluster, service, and task management
- EKS cluster operations
- ECR registry management
- Fargate task scaling
- Container insights metrics
- Service mesh (App Mesh) integration

**New Tool**: `aws_containers`

| Action | Description |
|--------|-------------|
| `list_clusters` | List ECS/EKS clusters |
| `create_ecs_cluster` | Create ECS cluster |
| `create_eks_cluster` | Create EKS cluster |
| `deploy_service` | Deploy or update ECS service |
| `scale_tasks` | Scale ECS tasks up/down |
| `list_tasks` | List running tasks |
| `get_task_logs` | Get container logs |
| `push_image` | Push image to ECR |
| `list_images` | List ECR images |
| `update_service` | Rolling update of service |
| `rollback_service` | Rollback to previous task definition |

**Example Conversations**:
```
User: "Create an ECS cluster with Fargate capacity"

User: "Deploy my-api:latest to the production cluster"

User: "Scale the web service to 5 tasks"

User: "Show me logs from the payment-service containers"

User: "Rollback the API service to the previous version"
```

---

### 8. Enhanced Observability Stack

**Current Gap**: CloudWatch exists but with limited capabilities

**Proposed Enhancements**:
- CloudWatch Alarms management
- Custom metric creation
- Dashboard generation from descriptions
- X-Ray tracing integration
- Log Insights query execution
- Anomaly detection setup
- Synthetic monitoring (Synthetics)

**Enhanced Tool**: `aws_monitoring`

| Action | Description |
|--------|-------------|
| `create_alarm` | Create CloudWatch alarm |
| `list_alarms` | List alarms with states |
| `query_logs` | Run Log Insights query |
| `create_dashboard` | Generate dashboard from description |
| `get_traces` | Get X-Ray traces |
| `setup_anomaly_detection` | Configure anomaly detection |
| `create_canary` | Create synthetic monitoring canary |
| `get_service_map` | Get X-Ray service map |
| `create_metric` | Create custom metric |

**Example Conversations**:
```
User: "Create an alarm when CPU exceeds 80% for 5 minutes"

User: "Show me all ERROR logs from the API in the last hour"

User: "Create a dashboard showing EC2 CPU, RDS connections, and Lambda errors"

User: "Set up anomaly detection for my API latency"

User: "Trace the request that had ID abc-123"
```

---

### 9. Disaster Recovery & Backup

**Current Gap**: No backup orchestration capabilities

**Proposed Capabilities**:
- AWS Backup plan management
- Cross-region replication automation
- Recovery point verification
- DR runbook generation
- Failover orchestration
- Backup compliance reporting

**New Tool**: `aws_backup`

| Action | Description |
|--------|-------------|
| `create_backup_plan` | Create backup plan with schedule |
| `list_recovery_points` | List available recovery points |
| `restore_resource` | Restore from backup |
| `test_recovery` | Test backup restoration |
| `configure_replication` | Set up cross-region replication |
| `get_backup_compliance` | Check backup compliance status |
| `create_dr_runbook` | Generate DR runbook |
| `failover` | Execute failover to DR region |

**Example Conversations**:
```
User: "Create a backup plan for all production databases - daily backups, 
       30 day retention"

User: "Show me all recovery points for the orders database"

User: "Test restoring yesterday's backup to a new RDS instance"

User: "Set up cross-region replication to us-west-2"

User: "Execute failover to the DR region"
```

---

### 10. CI/CD Pipeline Integration

**Current Gap**: No CodePipeline/CodeBuild management

**Proposed Capabilities**:
- Pipeline creation and management
- Build project configuration
- Deployment automation
- Blue/green deployment orchestration
- Pipeline execution and monitoring

**New Tool**: `aws_cicd`

| Action | Description |
|--------|-------------|
| `create_pipeline` | Create CodePipeline |
| `list_pipelines` | List all pipelines |
| `trigger_build` | Start CodeBuild build |
| `get_build_logs` | Get build logs |
| `deploy_application` | Deploy via CodeDeploy |
| `rollback_deployment` | Rollback deployment |
| `configure_blue_green` | Set up blue/green deployment |
| `get_pipeline_status` | Get pipeline execution status |

**Example Conversations**:
```
User: "Create a pipeline that builds from GitHub, runs tests, 
       and deploys to ECS"

User: "Show me the status of the production pipeline"

User: "Trigger a build for the main branch"

User: "Rollback the last deployment"
```

---

### 11. Enhanced Conversational UX

**Current Gaps**:
- No context retention between tool calls
- No infrastructure state summary
- No proactive recommendations

**Proposed Enhancements**:

#### Infrastructure Context Manager
```typescript
interface InfrastructureContext {
  // Recently accessed resources
  recentResources: Resource[];
  
  // Current working environment
  environment: 'dev' | 'staging' | 'production';
  
  // Active region
  activeRegion: string;
  
  // Current account
  activeAccount: string;
  
  // Session history
  sessionHistory: Operation[];
}
```

#### Proactive Insights
- "Your RDS instance is nearing storage capacity (85% used)"
- "3 EC2 instances have been running for 30+ days without patches"
- "You have 5 unattached EBS volumes costing $50/month"
- "Your Lambda function cold starts have increased 40% this week"

#### Natural Language Query
```
User: "Show me all resources tagged with project=alpha"

User: "What's running in production right now?"

User: "Find all resources created in the last 24 hours"

User: "Which instances are in the private subnet?"
```

#### Wizard Mode
Multi-step guided infrastructure creation:
```
User: "Help me set up a production-ready web application"

Bot:  "I'll guide you through setting up a production web application.
       
       Step 1/6: Network Setup
       Do you want to create a new VPC or use an existing one?
       
       1. Create new VPC (recommended)
       2. Use existing VPC
       3. Skip network setup"
```

---

### 12. Compliance & Governance

**Current Gap**: No compliance framework support

**Proposed Capabilities**:
- AWS Config rule management
- Compliance status checks (CIS, SOC2, HIPAA, PCI-DSS)
- Tag compliance enforcement
- Resource policy validation
- Conformance pack deployment
- Compliance reporting

**New Tool**: `aws_compliance`

| Action | Description |
|--------|-------------|
| `check_compliance` | Run compliance check against framework |
| `list_violations` | List compliance violations |
| `create_config_rule` | Create AWS Config rule |
| `apply_conformance_pack` | Deploy conformance pack |
| `enforce_tags` | Enforce tagging policy |
| `generate_compliance_report` | Generate compliance report |
| `remediate_violation` | Auto-remediate violation |

**Example Conversations**:
```
User: "Check my infrastructure against CIS benchmarks"

User: "Show me all compliance violations"

User: "Enforce that all resources must have Owner and Environment tags"

User: "Generate a SOC2 compliance report"
```

---

### 13. Event-Driven Automation

**Current Gap**: No EventBridge integration

**Proposed Capabilities**:
- EventBridge rule creation
- Event pattern builder
- Step Functions workflow creation
- Automated remediation setup
- Event replay and archive

**New Tool**: `aws_automation`

| Action | Description |
|--------|-------------|
| `create_event_rule` | Create EventBridge rule |
| `build_workflow` | Create Step Functions workflow |
| `setup_remediation` | Configure auto-remediation |
| `list_event_rules` | List EventBridge rules |
| `replay_events` | Replay archived events |
| `create_schedule` | Create scheduled automation |

**Example Conversations**:
```
User: "When an EC2 instance stops, send a Slack notification"

User: "Create a workflow that provisions a new developer environment"

User: "Auto-remediate any S3 bucket that becomes public"

User: "Schedule a Lambda to run every day at midnight"
```

---

### 14. Additional Database Services

**Current Gap**: Only RDS supported

**Proposed Additions**:

#### DynamoDB Tool: `aws_dynamodb`
| Action | Description |
|--------|-------------|
| `list_tables` | List DynamoDB tables |
| `create_table` | Create table with schema |
| `query_table` | Query table data |
| `update_capacity` | Modify read/write capacity |
| `enable_streams` | Enable DynamoDB Streams |
| `create_backup` | Create on-demand backup |
| `enable_pitr` | Enable point-in-time recovery |
| `create_global_table` | Create global table |

#### ElastiCache Tool: `aws_elasticache`
| Action | Description |
|--------|-------------|
| `list_clusters` | List Redis/Memcached clusters |
| `create_cluster` | Create cache cluster |
| `modify_cluster` | Modify cluster configuration |
| `create_snapshot` | Create cluster snapshot |
| `failover` | Initiate failover |
| `scale_cluster` | Scale cluster nodes |

**Example Conversations**:
```
User: "Create a DynamoDB table for user sessions with on-demand capacity"

User: "Create a Redis cluster with 2 replicas for caching"

User: "Enable point-in-time recovery on the orders table"
```

---

### 15. AI/ML Services Integration

**Current Gap**: No SageMaker or AI service support

**Proposed Capabilities**:
- SageMaker notebook management
- Model training and deployment
- Bedrock model access
- Rekognition, Comprehend, Translate operations

**New Tool**: `aws_ai`

| Action | Description |
|--------|-------------|
| `list_notebooks` | List SageMaker notebooks |
| `create_notebook` | Create SageMaker notebook |
| `deploy_model` | Deploy ML model to endpoint |
| `list_endpoints` | List SageMaker endpoints |
| `invoke_bedrock` | Invoke Bedrock foundation model |
| `analyze_text` | Comprehend text analysis |
| `analyze_image` | Rekognition image analysis |

---

## Implementation Priority Matrix

| Priority | Enhancement | Business Impact | Technical Effort | Dependencies |
|----------|-------------|-----------------|------------------|--------------|
| **P0** | Approval Workflows & Guardrails | Critical - Safety | Medium | None |
| **P0** | IAM & Security | Critical - Enterprise | Medium | None |
| **P1** | VPC/Network Management | High - Complete story | High | None |
| **P1** | Cost Management | High - Business value | Medium | None |
| **P1** | ECS/EKS Containers | High - Modern workloads | High | VPC |
| **P2** | IaC Generation | Medium - DevOps | High | All services |
| **P2** | Multi-Account Support | Medium - Enterprise | Medium | IAM |
| **P2** | Compliance Tooling | Medium - Governance | Medium | IAM |
| **P2** | Enhanced Observability | Medium - Operations | Medium | None |
| **P3** | CI/CD Integration | Medium - Developer UX | Medium | Containers |
| **P3** | DR & Backup | Medium - Resilience | Medium | RDS, EC2 |
| **P3** | Event Automation | Low - Advanced | Medium | Lambda |
| **P3** | DynamoDB/ElastiCache | Low - Database expansion | Medium | VPC |
| **P4** | AI/ML Services | Low - Specialized | High | S3 |

---

## Architecture Recommendations

### 1. Modular Service Architecture
```
extensions/aws/
├── src/
│   ├── core/
│   │   ├── client-pool/      # SDK client management
│   │   ├── credentials/      # Credential handling
│   │   ├── context/          # Account/region context
│   │   └── safety/           # Guardrails & approvals
│   ├── services/
│   │   ├── ec2/
│   │   ├── rds/
│   │   ├── lambda/
│   │   ├── s3/
│   │   ├── vpc/              # NEW
│   │   ├── iam/              # NEW
│   │   ├── ecs/              # NEW
│   │   ├── eks/              # NEW
│   │   ├── cost/             # NEW
│   │   └── ...
│   ├── tools/                # Agent tool definitions
│   └── workflows/            # Multi-step operations
```

### 2. Operation Registry
```typescript
interface OperationMetadata {
  name: string;
  service: string;
  type: 'read' | 'write' | 'delete';
  destructive: boolean;
  requiresApproval: boolean;
  estimatedDuration: number;
  costImpact: 'none' | 'low' | 'medium' | 'high';
  rollbackSupported: boolean;
}

const operationRegistry = new Map<string, OperationMetadata>();
```

### 3. Context Propagation
```typescript
interface OperationContext {
  correlationId: string;
  userId: string;
  accountId: string;
  region: string;
  environment: string;
  approvalStatus?: ApprovalStatus;
  parentOperation?: string;
}
```

### 4. Retry & Circuit Breaker
```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}
```

### 5. Structured Logging
```typescript
interface AuditLog {
  timestamp: Date;
  correlationId: string;
  userId: string;
  operation: string;
  service: string;
  resourceIds: string[];
  inputParams: Record<string, unknown>;
  result: 'success' | 'failure' | 'pending_approval';
  error?: string;
  durationMs: number;
  metadata: Record<string, unknown>;
}
```

### 6. Metrics Emission
```typescript
interface OperationMetrics {
  operationName: string;
  service: string;
  latencyMs: number;
  success: boolean;
  errorType?: string;
  resourceCount: number;
  region: string;
  accountId: string;
}
```

---

## Success Metrics

### Adoption Metrics
- Number of infrastructure operations performed via conversation
- User retention and repeat usage
- Time saved vs. console/CLI operations

### Quality Metrics
- Operation success rate
- Mean time to complete infrastructure changes
- Error rate and types
- Approval workflow completion rate

### Safety Metrics
- Number of prevented destructive operations
- Compliance violation detection rate
- Security incident prevention

### Business Metrics
- Cost optimization savings identified
- Infrastructure provisioning time reduction
- Incident response time improvement

---

## Next Steps

1. **Immediate (Sprint 1-2)**
   - Implement approval workflows for destructive operations
   - Add dry-run mode to all mutating operations
   - Implement basic IAM role/policy management

2. **Short-term (Sprint 3-4)**
   - VPC and network management
   - Cost Explorer integration
   - ECS cluster management

3. **Medium-term (Sprint 5-8)**
   - Full container orchestration (ECS/EKS)
   - IaC generation (Terraform)
   - Multi-account support
   - Compliance tooling

4. **Long-term (Sprint 9+)**
   - CI/CD pipeline integration
   - Advanced automation (EventBridge, Step Functions)
   - AI/ML service integration
   - Full DR orchestration
