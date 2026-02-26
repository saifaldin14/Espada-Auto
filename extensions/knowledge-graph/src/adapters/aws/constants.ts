/**
 * AWS Adapter — Constants & Configuration Tables
 *
 * Relationship rules, service discovery mappings, cost tables, and
 * other static data that drives the AWS discovery adapter.
 */

import type { GraphResourceType } from "../../types.js";
import type { AwsRelationshipRule, AwsServiceMapping } from "./types.js";

// =============================================================================
// AWS Relationship Extraction Mappings
// =============================================================================

/**
 * Comprehensive AWS relationship rules covering primary services.
 *
 * These rules encode the implicit relationships between AWS resources
 * that are surfaced in API responses but not in any single "relationship" API.
 */
export const AWS_RELATIONSHIP_RULES: AwsRelationshipRule[] = [
  // --- EC2 ---
  { sourceType: "compute", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "compute", field: "SubnetId", targetType: "subnet", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "compute", field: "SecurityGroups[].GroupId", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "compute", field: "IamInstanceProfile.Arn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "compute", field: "BlockDeviceMappings[].Ebs.VolumeId", targetType: "storage", relationship: "attached-to", isArray: true, bidirectional: true },

  // --- VPC ---
  { sourceType: "subnet", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "security-group", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },

  // --- RDS ---
  { sourceType: "database", field: "DBSubnetGroup.Subnets[].SubnetIdentifier", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "database", field: "VpcSecurityGroups[].VpcSecurityGroupId", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "database", field: "ReadReplicaSourceDBInstanceIdentifier", targetType: "database", relationship: "replicates", isArray: false, bidirectional: false },

  // --- Lambda ---
  { sourceType: "serverless-function", field: "VpcConfig.SubnetIds[]", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "serverless-function", field: "VpcConfig.SecurityGroupIds[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "serverless-function", field: "Role", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "serverless-function", field: "DeadLetterConfig.TargetArn", targetType: "queue", relationship: "publishes-to", isArray: false, bidirectional: false },

  // --- ALB/NLB ---
  { sourceType: "load-balancer", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "load-balancer", field: "SecurityGroups[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "load-balancer", field: "AvailabilityZones[].SubnetId", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },

  // --- S3 → Lambda triggers ---
  { sourceType: "storage", field: "NotificationConfiguration.LambdaFunctionConfigurations[].LambdaFunctionArn", targetType: "serverless-function", relationship: "triggers", isArray: true, bidirectional: false },

  // --- SQS ---
  { sourceType: "queue", field: "RedrivePolicy.deadLetterTargetArn", targetType: "queue", relationship: "publishes-to", isArray: false, bidirectional: false },

  // --- SNS -> SQS / Lambda ---
  { sourceType: "topic", field: "Subscriptions[].Endpoint", targetType: "queue", relationship: "publishes-to", isArray: true, bidirectional: false },

  // --- API Gateway ---
  { sourceType: "api-gateway", field: "Integrations[].Uri", targetType: "serverless-function", relationship: "routes-to", isArray: true, bidirectional: false },

  // --- CloudFront ---
  { sourceType: "cdn", field: "Origins[].DomainName", targetType: "storage", relationship: "routes-to", isArray: true, bidirectional: false },
  { sourceType: "cdn", field: "Origins[].DomainName", targetType: "load-balancer", relationship: "routes-to", isArray: true, bidirectional: false },

  // --- ECS ---
  { sourceType: "container", field: "networkConfiguration.awsvpcConfiguration.subnets[]", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "container", field: "networkConfiguration.awsvpcConfiguration.securityGroups[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "container", field: "taskDefinition.executionRoleArn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "container", field: "loadBalancers[].targetGroupArn", targetType: "load-balancer", relationship: "receives-from", isArray: true, bidirectional: false },

  // --- DynamoDB ---
  { sourceType: "database", field: "GlobalSecondaryIndexes[].IndexArn", targetType: "database", relationship: "replicates", isArray: true, bidirectional: false },

  // --- ElastiCache ---
  { sourceType: "cache", field: "CacheSubnetGroupName.Subnets[].SubnetIdentifier", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "cache", field: "SecurityGroups[].SecurityGroupId", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },

  // --- EKS ---
  { sourceType: "cluster", field: "resourcesVpcConfig.subnetIds[]", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "cluster", field: "resourcesVpcConfig.securityGroupIds[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "cluster", field: "roleArn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "cluster", field: "resourcesVpcConfig.vpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },

  // --- SageMaker ---
  { sourceType: "custom", field: "ProductionVariants[].ModelName", targetType: "custom", relationship: "depends-on", isArray: true, bidirectional: false },
  { sourceType: "custom", field: "RoleArn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "custom", field: "SubnetId", targetType: "subnet", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "custom", field: "SecurityGroupIds[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },

  // --- Lambda Event Source Mappings ---
  { sourceType: "serverless-function", field: "EventSourceArn", targetType: "queue", relationship: "receives-from", isArray: false, bidirectional: false },
  { sourceType: "serverless-function", field: "EventSourceArn", targetType: "stream", relationship: "receives-from", isArray: false, bidirectional: false },

  // --- Network Topology ---
  { sourceType: "route-table" as GraphResourceType, field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "route-table" as GraphResourceType, field: "Associations[].SubnetId", targetType: "subnet", relationship: "routes-to", isArray: true, bidirectional: false },
  { sourceType: "internet-gateway" as GraphResourceType, field: "Attachments[].VpcId", targetType: "vpc", relationship: "attached-to", isArray: true, bidirectional: true },
  { sourceType: "nat-gateway", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "nat-gateway", field: "SubnetId", targetType: "subnet", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "vpc-endpoint" as GraphResourceType, field: "VpcId", targetType: "vpc", relationship: "connected-to", isArray: false, bidirectional: false },
  { sourceType: "vpc-endpoint" as GraphResourceType, field: "SubnetIds[]", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "vpc-endpoint" as GraphResourceType, field: "RouteTableIds[]", targetType: "route-table" as GraphResourceType, relationship: "routes-to", isArray: true, bidirectional: false },
  { sourceType: "transit-gateway" as GraphResourceType, field: "TransitGatewayAttachments[].ResourceId", targetType: "vpc", relationship: "connects-via", isArray: true, bidirectional: true },

  // --- DynamoDB ---
  { sourceType: "database", field: "TableArn", targetType: "stream", relationship: "publishes-to", isArray: false, bidirectional: false },

  // --- Backup ---
  { sourceType: "custom", field: "BackupPlanSelections[].ResourceArn", targetType: "compute", relationship: "backs-up", isArray: true, bidirectional: false },
  { sourceType: "custom", field: "BackupPlanSelections[].ResourceArn", targetType: "database", relationship: "backs-up", isArray: true, bidirectional: false },
  { sourceType: "custom", field: "BackupPlanSelections[].ResourceArn", targetType: "storage", relationship: "backs-up", isArray: true, bidirectional: false },

  // --- Step Functions ---
  { sourceType: "custom", field: "definition.States[].Resource", targetType: "serverless-function", relationship: "triggers", isArray: true, bidirectional: false },

  // --- CI/CD Pipelines ---
  { sourceType: "custom", field: "stages[].actions[].configuration.FunctionName", targetType: "serverless-function", relationship: "triggers", isArray: true, bidirectional: false },
  { sourceType: "custom", field: "stages[].actions[].configuration.ClusterName", targetType: "cluster", relationship: "depends-on", isArray: true, bidirectional: false },
  { sourceType: "custom", field: "stages[].actions[].roleArn", targetType: "iam-role", relationship: "uses", isArray: true, bidirectional: false },

  // --- Cognito ---
  { sourceType: "identity", field: "LambdaConfig.PreSignUp", targetType: "serverless-function", relationship: "triggers", isArray: false, bidirectional: false },
  { sourceType: "identity", field: "LambdaConfig.PostConfirmation", targetType: "serverless-function", relationship: "triggers", isArray: false, bidirectional: false },
  { sourceType: "identity", field: "LambdaConfig.PreAuthentication", targetType: "serverless-function", relationship: "triggers", isArray: false, bidirectional: false },
];

// =============================================================================
// Service Discovery Configuration
// =============================================================================

export const AWS_SERVICE_MAPPINGS: AwsServiceMapping[] = [
  { graphType: "compute", awsService: "EC2", listMethod: "describeInstances", responseKey: "Reservations[].Instances[]", idField: "InstanceId", nameField: "Tags[Name]", arnField: "InstanceId", regional: true },
  { graphType: "vpc", awsService: "EC2", listMethod: "describeVpcs", responseKey: "Vpcs", idField: "VpcId", nameField: "Tags[Name]", arnField: "VpcId", regional: true },
  { graphType: "subnet", awsService: "EC2", listMethod: "describeSubnets", responseKey: "Subnets", idField: "SubnetId", nameField: "Tags[Name]", arnField: "SubnetId", regional: true },
  { graphType: "security-group", awsService: "EC2", listMethod: "describeSecurityGroups", responseKey: "SecurityGroups", idField: "GroupId", nameField: "GroupName", arnField: "GroupId", regional: true },
  { graphType: "database", awsService: "RDS", listMethod: "describeDBInstances", responseKey: "DBInstances", idField: "DBInstanceIdentifier", nameField: "DBInstanceIdentifier", arnField: "DBInstanceArn", regional: true },
  { graphType: "serverless-function", awsService: "Lambda", listMethod: "listFunctions", responseKey: "Functions", idField: "FunctionName", nameField: "FunctionName", arnField: "FunctionArn", regional: true },
  { graphType: "storage", awsService: "S3", listMethod: "listBuckets", responseKey: "Buckets", idField: "Name", nameField: "Name", arnField: "Name", regional: false },
  { graphType: "load-balancer", awsService: "ELBv2", listMethod: "describeLoadBalancers", responseKey: "LoadBalancers", idField: "LoadBalancerArn", nameField: "LoadBalancerName", arnField: "LoadBalancerArn", regional: true },
  { graphType: "queue", awsService: "SQS", listMethod: "listQueues", responseKey: "QueueUrls", idField: "QueueUrl", nameField: "QueueUrl", arnField: "QueueUrl", regional: true },
  { graphType: "topic", awsService: "SNS", listMethod: "listTopics", responseKey: "Topics", idField: "TopicArn", nameField: "TopicArn", arnField: "TopicArn", regional: true },
  { graphType: "cache", awsService: "ElastiCache", listMethod: "describeCacheClusters", responseKey: "CacheClusters", idField: "CacheClusterId", nameField: "CacheClusterId", arnField: "ARN", regional: true },
  { graphType: "container", awsService: "ECS", listMethod: "listServices", responseKey: "serviceArns", idField: "serviceArn", nameField: "serviceName", arnField: "serviceArn", regional: true },
  { graphType: "api-gateway", awsService: "APIGateway", listMethod: "getRestApis", responseKey: "items", idField: "id", nameField: "name", arnField: "id", regional: true },
  { graphType: "cdn", awsService: "CloudFront", listMethod: "listDistributions", responseKey: "DistributionList.Items", idField: "Id", nameField: "DomainName", arnField: "ARN", regional: false },
  { graphType: "dns", awsService: "Route53", listMethod: "listHostedZones", responseKey: "HostedZones", idField: "Id", nameField: "Name", arnField: "Id", regional: false },
  { graphType: "iam-role", awsService: "IAM", listMethod: "listRoles", responseKey: "Roles", idField: "RoleName", nameField: "RoleName", arnField: "Arn", regional: false },
  { graphType: "secret", awsService: "SecretsManager", listMethod: "listSecrets", responseKey: "SecretList", idField: "Name", nameField: "Name", arnField: "ARN", regional: true },
  { graphType: "cluster", awsService: "EKS", listMethod: "describeClusters", responseKey: "clusters", idField: "name", nameField: "name", arnField: "arn", regional: true },
  { graphType: "custom", awsService: "SageMaker", listMethod: "listEndpoints", responseKey: "Endpoints", idField: "EndpointName", nameField: "EndpointName", arnField: "EndpointArn", regional: true },
  { graphType: "custom", awsService: "SageMaker", listMethod: "listNotebookInstances", responseKey: "NotebookInstances", idField: "NotebookInstanceName", nameField: "NotebookInstanceName", arnField: "NotebookInstanceArn", regional: true },
  { graphType: "custom", awsService: "Bedrock", listMethod: "listProvisionedModelThroughputs", responseKey: "provisionedModelSummaries", idField: "provisionedModelName", nameField: "provisionedModelName", arnField: "provisionedModelArn", regional: true },
  { graphType: "route-table" as GraphResourceType, awsService: "EC2", listMethod: "describeRouteTables", responseKey: "RouteTables", idField: "RouteTableId", nameField: "Tags[Name]", arnField: "RouteTableId", regional: true },
  { graphType: "internet-gateway" as GraphResourceType, awsService: "EC2", listMethod: "describeInternetGateways", responseKey: "InternetGateways", idField: "InternetGatewayId", nameField: "Tags[Name]", arnField: "InternetGatewayId", regional: true },
  { graphType: "nat-gateway", awsService: "EC2", listMethod: "describeNatGateways", responseKey: "NatGateways", idField: "NatGatewayId", nameField: "Tags[Name]", arnField: "NatGatewayId", regional: true },
  { graphType: "vpc-endpoint" as GraphResourceType, awsService: "EC2", listMethod: "describeVpcEndpoints", responseKey: "VpcEndpoints", idField: "VpcEndpointId", nameField: "Tags[Name]", arnField: "VpcEndpointId", regional: true },
  { graphType: "transit-gateway" as GraphResourceType, awsService: "EC2", listMethod: "describeTransitGateways", responseKey: "TransitGateways", idField: "TransitGatewayId", nameField: "Tags[Name]", arnField: "TransitGatewayArn", regional: true },
  { graphType: "database", awsService: "DynamoDB", listMethod: "listTables", responseKey: "TableNames", idField: "TableName", nameField: "TableName", arnField: "TableArn", regional: true },
];

// =============================================================================
// Cost Tables
// =============================================================================

/** EC2 instance type → estimated monthly USD (us-east-1 on-demand). */
export const EC2_COSTS: Record<string, number> = {
  // General purpose — T family
  "t3.nano": 3.80, "t3.micro": 7.59, "t3.small": 15.18, "t3.medium": 30.37, "t3.large": 60.74, "t3.xlarge": 121.47, "t3.2xlarge": 242.94,
  "t3a.nano": 3.43, "t3a.micro": 6.86, "t3a.small": 13.72, "t3a.medium": 27.45, "t3a.large": 54.90, "t3a.xlarge": 109.79, "t3a.2xlarge": 219.58,
  "t4g.nano": 3.07, "t4g.micro": 6.13, "t4g.small": 12.26, "t4g.medium": 24.53, "t4g.large": 49.06, "t4g.xlarge": 98.11,
  // General purpose — M family
  "m5.large": 70.08, "m5.xlarge": 140.16, "m5.2xlarge": 280.32, "m5.4xlarge": 560.64, "m5.8xlarge": 1121.28, "m5.12xlarge": 1681.92,
  "m5a.large": 63.22, "m5a.xlarge": 126.44,
  "m6i.large": 69.35, "m6i.xlarge": 138.70, "m6i.2xlarge": 277.40, "m6i.4xlarge": 554.80, "m6i.8xlarge": 1109.60,
  "m6g.large": 56.21, "m6g.xlarge": 112.42, "m6g.2xlarge": 224.84,
  "m7i.large": 72.82, "m7i.xlarge": 145.64, "m7i.2xlarge": 291.28, "m7i.4xlarge": 582.56,
  "m7g.large": 59.57, "m7g.xlarge": 119.14,
  // Compute-optimized — C family
  "c5.large": 62.05, "c5.xlarge": 124.10, "c5.2xlarge": 248.20, "c5.4xlarge": 496.40, "c5.9xlarge": 1116.90,
  "c6i.large": 61.32, "c6i.xlarge": 122.64, "c6i.2xlarge": 245.28, "c6i.4xlarge": 490.56,
  "c6g.large": 49.06, "c6g.xlarge": 98.11, "c6g.2xlarge": 196.22,
  "c7g.large": 52.34, "c7g.xlarge": 104.68,
  // Memory-optimized — R family
  "r5.large": 91.98, "r5.xlarge": 183.96, "r5.2xlarge": 367.92, "r5.4xlarge": 735.84,
  "r6i.large": 91.25, "r6i.xlarge": 182.50, "r6i.2xlarge": 365.00, "r6i.4xlarge": 730.00,
  "r6g.large": 73.00, "r6g.xlarge": 146.00,
  "r7g.large": 77.38, "r7g.xlarge": 154.75,
  // Storage-optimized
  "i3.large": 114.61, "i3.xlarge": 229.22, "i3.2xlarge": 458.44,
  "d3.xlarge": 363.05, "d3.2xlarge": 726.10,
  // GPU / AI instances
  "p3.2xlarge": 2203.20, "p3.8xlarge": 8812.80, "p3.16xlarge": 17625.60,
  "p4d.24xlarge": 23689.44, "p4de.24xlarge": 28675.20,
  "p5.48xlarge": 70560.00,
  "g4dn.xlarge": 381.24, "g4dn.2xlarge": 546.36, "g4dn.4xlarge": 876.00, "g4dn.8xlarge": 1580.76, "g4dn.12xlarge": 2838.24,
  "g5.xlarge": 766.44, "g5.2xlarge": 876.00, "g5.4xlarge": 1168.08, "g5.12xlarge": 4088.88, "g5.48xlarge": 11785.92,
  "g6.xlarge": 488.76, "g6.2xlarge": 586.87, "g6.4xlarge": 878.40,
  "inf1.xlarge": 268.66, "inf1.2xlarge": 426.32, "inf1.6xlarge": 1381.08, "inf1.24xlarge": 5524.32,
  "inf2.xlarge": 546.72, "inf2.8xlarge": 1433.52, "inf2.24xlarge": 4584.48, "inf2.48xlarge": 9168.96,
  "trn1.2xlarge": 965.81, "trn1.32xlarge": 15453.00,
  "trn1n.32xlarge": 17496.00,
  "dl1.24xlarge": 9661.92,
};

/** RDS instance class → estimated monthly USD. */
export const RDS_COSTS: Record<string, number> = {
  "db.t3.micro": 11.68, "db.t3.small": 23.36, "db.t3.medium": 46.72, "db.t3.large": 93.44,
  "db.t4g.micro": 11.83, "db.t4g.small": 23.65, "db.t4g.medium": 47.30,
  "db.r5.large": 124.10, "db.r5.xlarge": 248.20, "db.r5.2xlarge": 496.40, "db.r5.4xlarge": 992.80,
  "db.r6g.large": 118.26, "db.r6g.xlarge": 236.52, "db.r6g.2xlarge": 473.04, "db.r6g.4xlarge": 946.08,
  "db.r6i.large": 124.10, "db.r6i.xlarge": 248.20, "db.r6i.2xlarge": 496.40,
  "db.r7g.large": 125.56, "db.r7g.xlarge": 251.12,
  "db.m5.large": 94.17, "db.m5.xlarge": 188.34, "db.m5.2xlarge": 376.68, "db.m5.4xlarge": 753.36,
  "db.m6g.large": 86.58, "db.m6g.xlarge": 173.16, "db.m6g.2xlarge": 346.32,
  "db.m6i.large": 94.17, "db.m6i.xlarge": 188.34,
  "db.serverless": 0.12,
};

/** ElastiCache node type → estimated monthly USD. */
export const ELASTICACHE_COSTS_AWS: Record<string, number> = {
  "cache.t3.micro": 9.50, "cache.t3.small": 19.00, "cache.t3.medium": 38.00,
  "cache.t4g.micro": 9.50, "cache.t4g.small": 19.00, "cache.t4g.medium": 38.00,
  "cache.r5.large": 120.72, "cache.r5.xlarge": 241.44, "cache.r5.2xlarge": 482.88,
  "cache.r6g.large": 115.34, "cache.r6g.xlarge": 230.69, "cache.r6g.2xlarge": 461.38,
  "cache.r7g.large": 121.91, "cache.r7g.xlarge": 243.82,
  "cache.m5.large": 109.50, "cache.m5.xlarge": 219.00, "cache.m5.2xlarge": 438.00,
  "cache.m6g.large": 104.40, "cache.m6g.xlarge": 208.80,
};

/** Static cost estimates for services not covered by instance-type lookups. */
export const STORAGE_COSTS: Record<string, number> = {
  "s3-standard": 0.02,
  "sqs": 0.01,
  "sns": 0.01,
  "api-gateway": 0.35,
  "cloudfront": 0.85,
  "route53-zone": 0.50,
  "secrets-manager": 0.40,
  "eks-cluster": 73.00,
  "ecs-fargate-task": 9.15,
};

// =============================================================================
// Cost Explorer Mapping
// =============================================================================

/**
 * Maps AWS Cost Explorer service names to graph resource types.
 * Used to distribute service-level costs to discovered nodes.
 */
export const AWS_SERVICE_TO_RESOURCE_TYPE: Record<string, GraphResourceType[]> = {
  "Amazon Elastic Compute Cloud - Compute": ["compute"],
  "EC2 - Other": ["compute", "vpc", "subnet", "security-group", "nat-gateway"],
  "Amazon Relational Database Service": ["database"],
  "AWS Lambda": ["serverless-function"],
  "Amazon Simple Storage Service": ["storage"],
  "Amazon ElastiCache": ["cache"],
  "Amazon Simple Queue Service": ["queue"],
  "Amazon Simple Notification Service (SNS)": ["topic"],
  "Amazon API Gateway": ["api-gateway"],
  "Amazon CloudFront": ["cdn"],
  "Amazon Route 53": ["dns"],
  "AWS Secrets Manager": ["secret"],
  "Amazon Elastic Container Service": ["container"],
  "Amazon Elastic Kubernetes Service": ["cluster"],
  "Amazon SageMaker": ["custom"],
  "Amazon Bedrock": ["custom"],
  "Elastic Load Balancing": ["load-balancer"],
  "AWS Identity and Access Management": ["iam-role"],
  "Amazon Virtual Private Cloud": ["vpc", "subnet", "security-group", "nat-gateway", "route-table" as GraphResourceType, "internet-gateway" as GraphResourceType, "vpc-endpoint" as GraphResourceType, "transit-gateway" as GraphResourceType],
  "Amazon DynamoDB": ["database"],
};

// =============================================================================
// SDK & Region Constants
// =============================================================================

/** Default regions to scan when region list can't be obtained dynamically. */
export const DEFAULT_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-central-1",
  "ap-southeast-1", "ap-northeast-1",
];

/**
 * Maps adapter service names to ClientPoolManager pool names.
 * Services not in this map fall back to direct SDK creation.
 */
export const AWS_SERVICE_TO_POOL_NAME: Record<string, string> = {
  EC2: "ec2",
  RDS: "rds",
  Lambda: "lambda",
  S3: "s3",
  SQS: "sqs",
  SNS: "sns",
  ElastiCache: "elasticache",
  ECS: "ecs",
  EKS: "eks",
  Route53: "route53",
  IAM: "iam",
  SecretsManager: "secretsmanager",
  STS: "sts",
  DynamoDB: "dynamodb",
  CloudFront: "cloudfront",
};

/**
 * Maps AWS service names to SDK package names.
 * Used by both client creation and command building.
 */
export const AWS_SDK_PACKAGES: Record<string, string> = {
  EC2: "@aws-sdk/client-ec2",
  RDS: "@aws-sdk/client-rds",
  Lambda: "@aws-sdk/client-lambda",
  S3: "@aws-sdk/client-s3",
  ELBv2: "@aws-sdk/client-elastic-load-balancing-v2",
  SQS: "@aws-sdk/client-sqs",
  SNS: "@aws-sdk/client-sns",
  ElastiCache: "@aws-sdk/client-elasticache",
  ECS: "@aws-sdk/client-ecs",
  EKS: "@aws-sdk/client-eks",
  APIGateway: "@aws-sdk/client-api-gateway",
  CloudFront: "@aws-sdk/client-cloudfront",
  Route53: "@aws-sdk/client-route-53",
  IAM: "@aws-sdk/client-iam",
  SecretsManager: "@aws-sdk/client-secrets-manager",
  STS: "@aws-sdk/client-sts",
  SageMaker: "@aws-sdk/client-sagemaker",
  Bedrock: "@aws-sdk/client-bedrock",
  CostExplorer: "@aws-sdk/client-cost-explorer",
  DynamoDB: "@aws-sdk/client-dynamodb",
};

// =============================================================================
// AI / GPU Detection
// =============================================================================

/** Regex matching GPU and AI-optimized EC2 instance families. */
export const GPU_INSTANCE_REGEX = /^(p[3-5]|g[4-6]|inf[12]|trn[12]|dl[12])/;

/** Known AI/ML service prefixes in ARNs. */
export const AI_SERVICE_PREFIXES = ["sagemaker", "bedrock", "comprehend", "rekognition", "textract", "forecast"];
