/**
 * AWS IaC Manager Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createIaCManager, IaCManager } from './manager.js';
import type { InfrastructureTemplate } from './types.js';

describe('IaCManager', () => {
  let manager: IaCManager;

  beforeEach(() => {
    manager = createIaCManager({
      defaultRegion: 'us-east-1',
      includeComments: true,
    });
  });

  describe('Terraform Generation', () => {
    it('should generate basic Terraform for EC2 instance', async () => {
      const template: InfrastructureTemplate = {
        name: 'test-infrastructure',
        description: 'Test infrastructure',
        resources: [
          {
            type: 'ec2_instance',
            name: 'web-server',
            properties: {
              ami: 'ami-12345678',
              instanceType: 't3.micro',
            },
            tags: {
              Name: 'Web Server',
              Environment: 'test',
            },
          },
        ],
      };

      const result = await manager.generateTerraform(template);

      expect(result.success).toBe(true);
      expect(result.mainTf).toBeDefined();
      expect(result.mainTf).toContain('resource "aws_instance" "web_server"');
      expect(result.mainTf).toContain('ami           = "ami-12345678"');
      expect(result.mainTf).toContain('instance_type = "t3.micro"');
      expect(result.mainTf).toContain('Name = "Web Server"');
      expect(result.resourceCount).toBe(1);
    });

    it('should generate Terraform for VPC with subnets', async () => {
      const template: InfrastructureTemplate = {
        name: 'vpc-infrastructure',
        resources: [
          {
            type: 'ec2_vpc',
            name: 'main-vpc',
            properties: {
              cidrBlock: '10.0.0.0/16',
              enableDnsSupport: true,
              enableDnsHostnames: true,
            },
            tags: { Name: 'Main VPC' },
          },
          {
            type: 'ec2_subnet',
            name: 'public-subnet',
            properties: {
              vpcId: 'aws_vpc.main_vpc.id',
              cidrBlock: '10.0.1.0/24',
              availabilityZone: 'us-east-1a',
              mapPublicIpOnLaunch: true,
            },
            tags: { Name: 'Public Subnet' },
          },
        ],
      };

      const result = await manager.generateTerraform(template);

      expect(result.success).toBe(true);
      expect(result.mainTf).toContain('resource "aws_vpc" "main_vpc"');
      expect(result.mainTf).toContain('cidr_block = "10.0.0.0/16"');
      expect(result.mainTf).toContain('resource "aws_subnet" "public_subnet"');
      expect(result.resourceCount).toBe(2);
    });

    it('should generate Terraform for security group with rules', async () => {
      const template: InfrastructureTemplate = {
        name: 'security-infrastructure',
        resources: [
          {
            type: 'ec2_security_group',
            name: 'web-sg',
            properties: {
              description: 'Security group for web servers',
              vpcId: 'vpc-12345',
              ingressRules: [
                {
                  fromPort: 80,
                  toPort: 80,
                  protocol: 'tcp',
                  cidrBlocks: ['0.0.0.0/0'],
                  description: 'HTTP',
                },
                {
                  fromPort: 443,
                  toPort: 443,
                  protocol: 'tcp',
                  cidrBlocks: ['0.0.0.0/0'],
                  description: 'HTTPS',
                },
              ],
              egressRules: [
                {
                  fromPort: 0,
                  toPort: 0,
                  protocol: '-1',
                  cidrBlocks: ['0.0.0.0/0'],
                },
              ],
            },
          },
        ],
      };

      const result = await manager.generateTerraform(template);

      expect(result.success).toBe(true);
      expect(result.mainTf).toContain('resource "aws_security_group" "web_sg"');
      expect(result.mainTf).toContain('ingress {');
      expect(result.mainTf).toContain('from_port   = 80');
      expect(result.mainTf).toContain('egress {');
    });

    it('should generate Terraform for RDS instance', async () => {
      const template: InfrastructureTemplate = {
        name: 'database-infrastructure',
        resources: [
          {
            type: 'rds_instance',
            name: 'primary-db',
            properties: {
              identifier: 'primary-database',
              engine: 'postgres',
              engineVersion: '15.4',
              instanceClass: 'db.t3.micro',
              allocatedStorage: 20,
              storageType: 'gp3',
              username: 'admin',
              multiAz: true,
              storageEncrypted: true,
              deletionProtection: true,
              skipFinalSnapshot: false,
            },
            tags: { Name: 'Primary Database' },
          },
        ],
      };

      const result = await manager.generateTerraform(template);

      expect(result.success).toBe(true);
      expect(result.mainTf).toContain('resource "aws_db_instance" "primary_db"');
      expect(result.mainTf).toContain('engine         = "postgres"');
      expect(result.mainTf).toContain('instance_class = "db.t3.micro"');
      expect(result.mainTf).toContain('multi_az = true');
      expect(result.mainTf).toContain('storage_encrypted = true');
    });

    it('should generate Terraform for S3 bucket', async () => {
      const template: InfrastructureTemplate = {
        name: 's3-infrastructure',
        resources: [
          {
            type: 's3_bucket',
            name: 'app-bucket',
            properties: {
              bucketName: 'my-application-bucket',
            },
            tags: { Name: 'Application Bucket' },
          },
        ],
      };

      const result = await manager.generateTerraform(template);

      expect(result.success).toBe(true);
      expect(result.mainTf).toContain('resource "aws_s3_bucket" "app_bucket"');
      expect(result.mainTf).toContain('bucket = "my-application-bucket"');
    });

    it('should generate Terraform for Lambda function', async () => {
      const template: InfrastructureTemplate = {
        name: 'lambda-infrastructure',
        resources: [
          {
            type: 'lambda_function',
            name: 'api-handler',
            properties: {
              functionName: 'api-handler',
              runtime: 'nodejs20.x',
              handler: 'index.handler',
              role: 'arn:aws:iam::123456789012:role/lambda-role',
              memorySize: 256,
              timeout: 30,
              environment: {
                NODE_ENV: 'production',
                LOG_LEVEL: 'info',
              },
            },
            tags: { Name: 'API Handler' },
          },
        ],
      };

      const result = await manager.generateTerraform(template);

      expect(result.success).toBe(true);
      expect(result.mainTf).toContain('resource "aws_lambda_function" "api_handler"');
      expect(result.mainTf).toContain('runtime       = "nodejs20.x"');
      expect(result.mainTf).toContain('memory_size = 256');
      expect(result.mainTf).toContain('environment {');
      expect(result.mainTf).toContain('NODE_ENV = "production"');
    });

    it('should generate Terraform provider configuration', async () => {
      const template: InfrastructureTemplate = {
        name: 'test',
        resources: [],
      };

      const result = await manager.generateTerraform(template, {
        region: 'eu-west-1',
        profile: 'production',
      });

      expect(result.success).toBe(true);
      expect(result.providerTf).toContain('provider "aws"');
      expect(result.providerTf).toContain('region = "eu-west-1"');
      expect(result.providerTf).toContain('profile = "production"');
    });

    it('should generate Terraform backend configuration', async () => {
      const template: InfrastructureTemplate = {
        name: 'test',
        resources: [],
      };

      const result = await manager.generateTerraform(template, {
        backend: {
          type: 's3',
          config: {
            bucket: 'terraform-state-bucket',
            key: 'infrastructure/terraform.tfstate',
            region: 'us-east-1',
            encrypt: true,
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.backendTf).toContain('backend "s3"');
      expect(result.backendTf).toContain('bucket = "terraform-state-bucket"');
      expect(result.backendTf).toContain('encrypt = true');
    });
  });

  describe('CloudFormation Generation', () => {
    it('should generate basic CloudFormation for EC2 instance', async () => {
      const template: InfrastructureTemplate = {
        name: 'test-infrastructure',
        description: 'Test infrastructure template',
        resources: [
          {
            type: 'ec2_instance',
            name: 'WebServer',
            properties: {
              ami: 'ami-12345678',
              instanceType: 't3.micro',
            },
            tags: {
              Name: 'Web Server',
              Environment: 'test',
            },
          },
        ],
      };

      const result = await manager.generateCloudFormation(template, { format: 'yaml' });

      expect(result.success).toBe(true);
      expect(result.template).toBeDefined();
      expect(result.template).toContain('AWSTemplateFormatVersion');
      expect(result.template).toContain('AWS::EC2::Instance');
      expect(result.template).toContain('ImageId: ami-12345678');
      expect(result.template).toContain('InstanceType: t3.micro');
      expect(result.resourceCount).toBe(1);
    });

    it('should generate CloudFormation in JSON format', async () => {
      const template: InfrastructureTemplate = {
        name: 'test',
        resources: [
          {
            type: 'ec2_vpc',
            name: 'MainVPC',
            properties: {
              cidrBlock: '10.0.0.0/16',
            },
          },
        ],
      };

      const result = await manager.generateCloudFormation(template, { format: 'json' });

      expect(result.success).toBe(true);
      expect(result.template).toBeDefined();
      
      // Should be valid JSON
      const parsed = JSON.parse(result.template!);
      expect(parsed.AWSTemplateFormatVersion).toBe('2010-09-09');
      expect(parsed.Resources.MainVPC.Type).toBe('AWS::EC2::VPC');
    });

    it('should generate CloudFormation for RDS instance', async () => {
      const template: InfrastructureTemplate = {
        name: 'database',
        resources: [
          {
            type: 'rds_instance',
            name: 'Database',
            properties: {
              identifier: 'mydb',
              engine: 'mysql',
              instanceClass: 'db.t3.small',
              allocatedStorage: 50,
              username: 'admin',
            },
          },
        ],
      };

      const result = await manager.generateCloudFormation(template);

      expect(result.success).toBe(true);
      expect(result.template).toContain('AWS::RDS::DBInstance');
      expect(result.template).toContain('DBInstanceIdentifier: mydb');
      expect(result.template).toContain('Engine: mysql');
    });

    it('should generate CloudFormation with parameters', async () => {
      const template: InfrastructureTemplate = {
        name: 'parameterized',
        variables: {
          InstanceType: {
            type: 'string',
            description: 'EC2 instance type',
            default: 't3.micro',
          },
        },
        resources: [
          {
            type: 'ec2_instance',
            name: 'Server',
            properties: {
              ami: 'ami-12345',
              instanceType: '!Ref InstanceType',
            },
          },
        ],
      };

      const result = await manager.generateCloudFormation(template, {
        includeParameters: true,
      });

      expect(result.success).toBe(true);
      expect(result.templateObject?.Parameters).toBeDefined();
    });
  });

  describe('Drift Detection', () => {
    it('should return clean status when no drift detected', async () => {
      const result = await manager.detectDrift({
        region: 'us-east-1',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('clean');
      expect(result.drifts).toHaveLength(0);
    });
  });

  describe('State Export', () => {
    it('should handle export with no resources', async () => {
      const result = await manager.exportState({
        format: 'terraform',
        regions: ['us-east-1'],
      });

      expect(result.success).toBe(true);
      expect(result.resourceCount).toBe(0);
    });
  });

  describe('Plan Changes', () => {
    it('should generate plan for new resources', async () => {
      const template: InfrastructureTemplate = {
        name: 'new-infrastructure',
        resources: [
          {
            type: 'ec2_instance',
            name: 'web-server',
            properties: {
              ami: 'ami-12345',
              instanceType: 't3.micro',
            },
          },
          {
            type: 's3_bucket',
            name: 'storage-bucket',
            properties: {
              bucketName: 'my-bucket',
            },
          },
        ],
      };

      const result = await manager.planChanges(template);

      expect(result.success).toBe(true);
      expect(result.toCreate).toHaveLength(2);
      expect(result.toUpdate).toHaveLength(0);
      expect(result.toDelete).toHaveLength(0);
      expect(result.message).toContain('2 to create');
    });
  });

  describe('Helper Functions', () => {
    it('should sanitize resource names', async () => {
      const template: InfrastructureTemplate = {
        name: 'test',
        resources: [
          {
            type: 'ec2_instance',
            name: 'my-web-server-2024',
            properties: {
              ami: 'ami-12345',
              instanceType: 't3.micro',
            },
          },
        ],
      };

      const result = await manager.generateTerraform(template);

      expect(result.success).toBe(true);
      expect(result.mainTf).toContain('my_web_server_2024');
    });
  });
});

describe('createIaCManager', () => {
  it('should create manager with default config', () => {
    const manager = createIaCManager();
    expect(manager).toBeInstanceOf(IaCManager);
  });

  it('should create manager with custom config', () => {
    const manager = createIaCManager({
      defaultRegion: 'eu-west-1',
      terraformVersion: '>= 1.5',
      awsProviderVersion: '~> 5.30',
      defaultTags: {
        ManagedBy: 'Espada',
      },
    });
    expect(manager).toBeInstanceOf(IaCManager);
  });
});
