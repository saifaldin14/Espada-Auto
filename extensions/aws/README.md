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
