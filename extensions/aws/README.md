# AWS Extension for Espada

Comprehensive AWS infrastructure management extension providing AI-powered tools for EC2, Lambda, S3, RDS, IAM, Security, Cost Management, and more.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Authentication Setup](#authentication-setup)
  - [Option 1: Browser-Based SSO Login (Recommended for Organizations)](#option-1-browser-based-sso-login-recommended-for-organizations)
  - [Option 2: Access Keys (Personal Accounts)](#option-2-access-keys-personal-accounts)
  - [Option 3: Agent-Assisted Authentication](#option-3-agent-assisted-authentication)
- [Configuration](#configuration)
- [Usage](#usage)
- [Available Tools](#available-tools)
- [Intent-Driven Infrastructure Orchestration (IDIO)](#intent-driven-infrastructure-orchestration-idio)
  - [IDIO CLI Commands](#idio-cli-commands)
  - [Available Templates](#available-templates)
  - [Intent File Format](#intent-file-format)
  - [Example Workflows](#example-workflows)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Prerequisites

1. **Node.js 22+** (use nvm to manage versions)
2. **AWS CLI v2** (for authentication)
3. **AWS Account** (personal or organization)
4. **Espada** installed and configured

## Installation

### Step 1: Install Dependencies

```bash
cd extensions/aws
pnpm install
```

The extension requires these AWS SDK packages:
- `@aws-sdk/client-ec2`
- `@aws-sdk/client-iam`
- `@aws-sdk/client-lambda`
- `@aws-sdk/client-s3`
- `@aws-sdk/client-rds`
- `@aws-sdk/client-sts`
- `@aws-sdk/client-cloudtrail`
- `@aws-sdk/client-eventbridge`
- `@aws-sdk/client-scheduler`
- And more...

### Step 2: Install AWS CLI

**macOS (Homebrew):**
```bash
brew install awscli
```

**macOS (Direct Install):**
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "/tmp/AWSCLIV2.pkg"
sudo installer -pkg /tmp/AWSCLIV2.pkg -target /
```

**Linux:**
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

Verify installation:
```bash
aws --version
```

### Step 3: Enable the Extension

```bash
cd /path/to/espada
nvm use 22
pnpm espada plugins enable aws
```

### Step 4: Configure Default Region

```bash
pnpm espada config set plugins.entries.aws.config.defaultRegion us-east-1
```

## Authentication Setup

You have three options for authenticating with AWS:

### Option 1: Browser-Based SSO Login (Recommended for Organizations)

If your organization uses AWS SSO:

1. **Get your SSO details from your AWS administrator:**
   - SSO Start URL (e.g., `https://your-org.awsapps.com/start`)
   - SSO Region (e.g., `us-east-1`)

2. **Configure SSO:**
   ```bash
   aws configure sso
   ```

3. **Answer the prompts:**
   - **SSO session name**: `my-sso` (or any name)
   - **SSO start URL**: Your organization's URL
   - **SSO Region**: Your SSO region
   - **SSO registration scopes**: Press Enter (uses default)

4. **Browser opens automatically** for you to login with your credentials

5. **Select your account and role** from the list

6. **Configure Espada to use the profile:**
   ```bash
   pnpm espada config set plugins.entries.aws.config.defaultProfile my-sso
   ```

### Option 2: Access Keys (Personal Accounts)

For personal AWS accounts:

1. **Get AWS Access Keys:**
   - Go to [AWS Console](https://console.aws.amazon.com/)
   - Click your account name (top right) → **Security Credentials**
   - Scroll to **Access keys** section
   - Click **Create access key**
   - Save the **Access Key ID** and **Secret Access Key**

2. **Configure AWS CLI:**
   ```bash
   aws configure
   ```

3. **Enter your credentials:**
   - **AWS Access Key ID**: `AKIA...`
   - **AWS Secret Access Key**: `your-secret-key`
   - **Default region name**: `us-east-1` (or your preferred region)
   - **Default output format**: `json`

4. **Verify the configuration:**
   ```bash
   aws sts get-caller-identity
   ```

   You should see your account ID and user info.

### Option 3: Agent-Assisted Authentication

Let the AI agent help you authenticate! The extension includes an `aws_authenticate` tool that can:
- Open a browser for SSO login
- Configure access keys securely
- Verify the authentication

**Example conversation:**
```
You: "Help me authenticate with AWS. I have a personal account with access keys."

Agent: [Uses aws_authenticate tool to set up your credentials]
```

**For SSO:**
```
You: "Authenticate with AWS using SSO. My start URL is https://my-org.awsapps.com/start and region is us-east-1"

Agent: [Configures SSO and opens browser for login]
```

## Configuration

The extension supports these configuration options in `~/.espada/espada.json`:

```json
{
  "plugins": {
    "entries": {
      "aws": {
        "enabled": true,
        "config": {
          "defaultRegion": "us-east-1",
          "defaultProfile": "default",
          "credentialSources": ["profile", "environment", "sso", "instance"],
          "tagConfig": {
            "requiredTags": ["Environment", "Project"],
            "optionalTags": ["Owner", "CostCenter"]
          },
          "defaultTags": [
            { "key": "ManagedBy", "value": "Espada" }
          ]
        }
      }
    }
  }
}
```

### Configuration Options

- **`defaultRegion`**: Default AWS region for operations (e.g., `us-east-1`)
- **`defaultProfile`**: AWS profile name from `~/.aws/credentials`
- **`credentialSources`**: Order of credential sources to try (profile, environment, sso, instance)
- **`tagConfig`**: Configure required and optional tags for resources
- **`defaultTags`**: Tags automatically applied to all created resources

## Usage

### Running the Agent with AWS Extension

```bash
cd /path/to/espada
nvm use 22
pnpm espada agent --to +15555550123 --message "List my EC2 instances" --local
```

Or with a specific agent:
```bash
pnpm espada agent --agent main --message "Show my AWS S3 buckets" --local
```

### With Environment Variables

```bash
AWS_PROFILE=my-sso AWS_REGION=us-west-2 pnpm espada agent --to +15555550123 --message "List RDS databases in us-west-2" --local
```

## Available Tools

The AWS extension provides 14 comprehensive tools:

### 1. **aws_authenticate**
Authenticate with AWS using SSO or access keys
- Browser-based SSO login
- Access key configuration
- Credential verification

### 2. **aws_ec2**
EC2 instance management
- List, start, stop, reboot, terminate instances
- Describe instance details
- Filter by tags, state, instance type

### 3. **aws_lambda**
Lambda function management
- List, create, update, delete functions
- Deploy code from S3 or zip
- Manage environment variables, triggers, layers
- Invoke functions synchronously/asynchronously

### 4. **aws_s3**
S3 bucket and object management
- List, create, delete buckets
- Upload, download, list objects
- Manage versioning, encryption, lifecycle policies
- Configure website hosting
- Set up event notifications

### 5. **aws_rds**
RDS database management
- List, create, modify, delete DB instances
- Start, stop, reboot databases
- Manage snapshots, backups
- Query CloudWatch metrics

### 6. **aws_security_group**
Security group management
- Create, update, delete security groups
- Manage inbound/outbound rules
- Attach to EC2 instances

### 7. **aws_cloudtrail**
CloudTrail event monitoring
- Query recent AWS API activity
- Filter by user, event name, time range
- Audit security and compliance

### 8. **aws_discover**
AWS service discovery
- Discover running services across regions
- Map dependencies
- Generate architecture diagrams

### 9. **aws_iac**
Infrastructure as Code generation
- Generate CloudFormation templates
- Generate Terraform configurations
- Create deployment plans

### 10. **aws_cost**
Cost management and optimization
- Get cost and usage reports
- Create budgets with alerts
- Cost analysis by service, region, tag
- Savings recommendations

### 11. **aws_security**
IAM and security management
- Manage IAM roles, users, policies
- Configure KMS encryption keys
- Manage Secrets Manager secrets
- Security Hub findings
- GuardDuty alerts

### 12. **aws_guardrails**
Approval workflows and audit
- Request/approve infrastructure changes
- Audit logging
- Policy enforcement
- Compliance tracking

### 13. **aws_organizations**
Multi-account management
- List accounts and OUs
- Create/move accounts
- Manage Service Control Policies (SCPs)
- Cross-account operations

### 14. **aws_backup**
Backup and disaster recovery
- Create backup plans
- Manage recovery points
- Cross-region replication
- Disaster recovery runbooks

### 15. **aws_assistant**
Conversational AWS assistant
- Natural language queries
- Context-aware interactions
- Proactive insights
- Wizard-guided resource creation

## Intent-Driven Infrastructure Orchestration (IDIO)

IDIO is a revolutionary approach to cloud infrastructure management that lets you describe **what** you want rather than **how** to build it. Simply declare your application requirements, and IDIO compiles them into a complete, policy-compliant infrastructure plan.

### Key Features

- **Declarative Intent** - Describe your needs in business terms (availability, cost, compliance)
- **Automatic Compilation** - Translates intents into optimal AWS resource configurations  
- **Policy Enforcement** - Built-in guardrails for security, compliance, and cost
- **Cost Estimation** - Get accurate cost projections before provisioning
- **Drift Detection** - Continuously monitor for configuration drift
- **Auto-Remediation** - Automatically fix drift to maintain desired state
- **Template Catalog** - Pre-built patterns for common architectures

### IDIO CLI Commands

```bash
# Initialize a sample intent file
espada aws idio init web-api ./my-app.intent.json

# Validate an intent
espada aws idio validate ./my-app.intent.json

# Estimate costs
espada aws idio cost ./my-app.intent.json

# Create an infrastructure plan
espada aws idio plan ./my-app.intent.json

# Preview what will be created (dry run)
espada aws idio execute plan-abc123 --dry-run

# Deploy infrastructure
espada aws idio execute plan-abc123

# Quick deploy (validate + plan + execute)
espada aws idio deploy ./my-app.intent.json

# Check deployment status
espada aws idio status exec-abc123

# Detect drift
espada aws idio drift exec-abc123

# Reconcile to fix drift
espada aws idio reconcile exec-abc123 --auto-remediate

# Rollback deployment
espada aws idio rollback exec-abc123
```

### Available Templates

```bash
# List all templates
espada aws idio templates

# Get template details
espada aws idio template three-tier-web
```

| Template | Description |
|----------|-------------|
| `three-tier-web` | Classic web app with load balancer, app servers, and database |
| `microservices` | Container-based microservices with service mesh |
| `serverless-api` | API Gateway + Lambda + DynamoDB |
| `data-lake` | S3-based data lake with analytics |
| `ml-platform` | SageMaker-based ML training and inference |
| `static-website` | S3 + CloudFront static site hosting |
| `event-driven` | Event-driven architecture with SQS/SNS |

### Intent File Format

An intent file describes your application requirements declaratively:

```json
{
  "name": "my-web-api",
  "description": "Production web API with high availability",
  "environment": "production",
  "availability": "99.99",
  "primaryRegion": "us-east-1",
  "additionalRegions": ["us-west-2"],
  "cost": {
    "monthlyBudgetUsd": 5000,
    "prioritizeCost": false,
    "alertThreshold": 80
  },
  "compliance": ["soc2", "gdpr"],
  "security": {
    "encryptionAtRest": true,
    "encryptionInTransit": true,
    "networkIsolation": "vpc-isolated",
    "mfaRequired": true
  },
  "tiers": [
    {
      "type": "web",
      "trafficPattern": "predictable-daily",
      "expectedRps": 10000,
      "runtime": {
        "language": "nodejs",
        "version": "20",
        "containerImage": "node:20-alpine",
        "healthCheckPath": "/health"
      },
      "scaling": {
        "min": 4,
        "max": 50,
        "targetCpuUtilization": 60
      }
    },
    {
      "type": "api",
      "trafficPattern": "predictable-daily",
      "expectedRps": 50000,
      "runtime": {
        "language": "nodejs",
        "version": "20",
        "containerImage": "node:20-alpine"
      },
      "scaling": {
        "min": 6,
        "max": 100,
        "targetCpuUtilization": 50
      },
      "dependsOn": ["web"]
    },
    {
      "type": "database",
      "trafficPattern": "steady",
      "dataSizeGb": 500,
      "scaling": {
        "min": 2,
        "max": 2
      },
      "dependsOn": ["api"]
    },
    {
      "type": "cache",
      "trafficPattern": "predictable-daily",
      "scaling": {
        "min": 2,
        "max": 6
      },
      "dependsOn": ["api"]
    }
  ],
  "disasterRecovery": {
    "rtoMinutes": 15,
    "rpoMinutes": 5,
    "crossRegionReplication": true,
    "backupRetentionDays": 30,
    "automaticFailover": true
  },
  "tags": {
    "Project": "MyWebAPI",
    "Owner": "platform-team",
    "CostCenter": "engineering"
  }
}
```

### Intent Properties Reference

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Application name (lowercase, alphanumeric with hyphens) |
| `description` | string | Human-readable description |
| `environment` | enum | `development`, `staging`, `production`, `disaster-recovery` |
| `availability` | enum | `99.9`, `99.95`, `99.99`, `99.999`, `best-effort` |
| `primaryRegion` | string | AWS region for deployment |
| `additionalRegions` | string[] | Additional regions for multi-region |
| `cost` | object | Budget constraints and optimization preferences |
| `compliance` | string[] | `hipaa`, `soc2`, `pci-dss`, `gdpr`, `iso27001`, `fedramp`, `none` |
| `security` | object | Security requirements |
| `tiers` | array | Application tier configurations |
| `disasterRecovery` | object | DR requirements (RTO, RPO, replication) |
| `tags` | object | Tags to apply to all resources |

### Tier Types

| Type | Description | Typical AWS Services |
|------|-------------|---------------------|
| `web` | Web/frontend tier | ALB, ECS/EKS, CloudFront |
| `api` | API/backend tier | ALB, ECS/EKS, API Gateway |
| `database` | Data persistence | RDS, DynamoDB, ElastiCache |
| `cache` | Caching layer | ElastiCache Redis/Memcached |
| `queue` | Message queuing | SQS, SNS, EventBridge |
| `storage` | Object storage | S3, EFS |
| `analytics` | Analytics/processing | Athena, EMR, Kinesis |

### Traffic Patterns

| Pattern | Description | Scaling Strategy |
|---------|-------------|------------------|
| `steady` | Consistent load | Conservative scaling |
| `burst` | Unpredictable spikes | Aggressive pre-warming |
| `predictable-daily` | Daily patterns | Scheduled scaling |
| `predictable-weekly` | Weekly patterns | Scheduled scaling |
| `seasonal` | Seasonal variations | Capacity reservations |
| `unpredictable` | No clear pattern | Aggressive auto-scaling |

### Example Workflows

#### Deploy a Three-Tier Web App

```bash
# 1. Generate a sample intent
espada aws idio init web-api ./webapp.intent.json

# 2. Customize the intent file (edit as needed)

# 3. Validate the intent
espada aws idio validate ./webapp.intent.json

# 4. Check estimated costs
espada aws idio cost ./webapp.intent.json

# 5. Create and review the plan
espada aws idio plan ./webapp.intent.json

# 6. Preview what will be created
espada aws idio execute plan-xxx --dry-run

# 7. Deploy!
espada aws idio execute plan-xxx
```

#### Deploy from Template

```bash
# Deploy a serverless API
espada aws idio plan template serverless-api \
  --name=my-api \
  --env=production

espada aws idio execute plan-xxx
```

#### Monitor and Maintain

```bash
# Check status
espada aws idio status exec-xxx

# Detect drift
espada aws idio drift exec-xxx

# Auto-fix drift
espada aws idio reconcile exec-xxx --auto-remediate

# Rollback if needed
espada aws idio rollback exec-xxx
```

## Examples

### Example 1: List EC2 Instances
```
You: "List all my EC2 instances"

Agent: [Uses aws_ec2 tool with action: "list"]
```

### Example 2: Create S3 Bucket
```
You: "Create an S3 bucket named 'my-app-data' in us-west-2 with versioning enabled"

Agent: [Uses aws_s3 tool to create bucket with versioning]
```

### Example 3: Deploy Lambda Function
```
You: "Deploy a Lambda function called 'process-data' with Python 3.11 runtime from my-bucket/lambda.zip"

Agent: [Uses aws_lambda tool to create and deploy the function]
```

### Example 4: Cost Analysis
```
You: "Show me my AWS costs for the last 30 days broken down by service"

Agent: [Uses aws_cost tool to generate cost report]
```

### Example 5: Security Audit
```
You: "Audit my IAM users and show who has admin access"

Agent: [Uses aws_security tool to list IAM users and policies]
```

### Example 6: Infrastructure Discovery
```
You: "Discover all my AWS resources and generate an architecture diagram"

Agent: [Uses aws_discover tool to scan and map resources]
```

## Troubleshooting

### "No API key found for provider"

**Solution:** You need to configure authentication for the agent:
```bash
# Option 1: Use environment variable (for testing)
ANTHROPIC_API_KEY="your-key" pnpm espada agent --to +15555550123 --message "test" --local

# Option 2: Configure Ollama (free local model)
cat > ~/.espada/espada.json << 'EOF'
{
  "agents": {
    "defaults": {
      "model": {
        "provider": "ollama",
        "name": "llama3.2"
      }
    }
  }
}
EOF
```

### "AWS credentials not found"

**Solution:** Run authentication setup:
```bash
aws configure
# OR for SSO:
aws configure sso
```

### "Cannot read properties of undefined (reading 'trim')"

**Issue:** Tool registration error (already fixed in this version)

**Solution:** Make sure all tools have a `name` property. This has been fixed for `aws_lambda`, `aws_s3`, and `aws_organizations` tools.

### "Module not found: @aws-sdk/client-scheduler"

**Solution:** Install missing SDK packages:
```bash
cd extensions/aws
pnpm install @aws-sdk/client-scheduler
pnpm install @aws-sdk/client-sfn
```

### Extension not loading

**Solution:** Ensure the extension is enabled:
```bash
pnpm espada plugins list
pnpm espada plugins enable aws
```

Then restart the gateway or agent.

### Region-specific issues

**Solution:** Explicitly set the region:
```bash
pnpm espada config set plugins.entries.aws.config.defaultRegion us-east-1
```

Or use environment variable:
```bash
AWS_REGION=us-west-2 pnpm espada agent --to +15555550123 --message "..." --local
```

### Permission denied errors

**Solution:** Check your IAM permissions. Ensure your user/role has the necessary permissions for the operations you're trying to perform.

```bash
# Verify your identity
aws sts get-caller-identity

# Check IAM permissions
aws iam get-user-policy --user-name YourUserName --policy-name YourPolicyName
```

## Support

For issues or questions:
1. Check this README
2. Review the [Espada documentation](https://docs.molt.bot)
3. Open an issue on GitHub
4. Contact the Espada team

## License

MIT License - See main Espada repository for details.
