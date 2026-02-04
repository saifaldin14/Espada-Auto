/**
 * AWS Extension - Enterprise Services Index
 * 
 * Exports all enterprise-grade AWS service managers
 */

// Core Infrastructure Services (Existing)
// EC2, VPC, IAM, S3, CloudFormation - see existing managers

// Database Services
export * from './dynamodb/manager.js';

// API & Networking Services
export * from './apigateway/manager.js';
export * from './route53/manager.js';

// Messaging Services
export * from './sqs/manager.js';
export * from './sns/manager.js';

// Authentication & Identity Services
export * from './cognito/manager.js';

// Intent-Driven Infrastructure Orchestration (IDIO) System
export * from './intent/types.js';
export * from './intent/schema.js';
export * from './intent/compiler.js';
export * from './policy/engine.js';
export * from './catalog/templates.js';
export * from './reconciliation/engine.js';
export * from './idio/orchestrator.js';

// Re-export tool definitions for agent integration
export { dynamoDBToolDefinitions } from './dynamodb/manager.js';
export { apiGatewayToolDefinitions } from './apigateway/manager.js';
export { sqsToolDefinitions } from './sqs/manager.js';
export { route53ToolDefinitions } from './route53/manager.js';
export { snsToolDefinitions } from './sns/manager.js';
export { cognitoToolDefinitions } from './cognito/manager.js';

// Aggregate all tool definitions
import { dynamoDBToolDefinitions } from './dynamodb/manager.js';
import { apiGatewayToolDefinitions } from './apigateway/manager.js';
import { sqsToolDefinitions } from './sqs/manager.js';
import { route53ToolDefinitions } from './route53/manager.js';
import { snsToolDefinitions } from './sns/manager.js';
import { cognitoToolDefinitions } from './cognito/manager.js';

export const enterpriseToolDefinitions = {
  ...dynamoDBToolDefinitions,
  ...apiGatewayToolDefinitions,
  ...sqsToolDefinitions,
  ...route53ToolDefinitions,
  ...snsToolDefinitions,
  ...cognitoToolDefinitions,
};

// Service manager factory for unified access
export interface AWSServiceManagers {
  dynamodb: typeof import('./dynamodb/manager.js');
  apigateway: typeof import('./apigateway/manager.js');
  sqs: typeof import('./sqs/manager.js');
  route53: typeof import('./route53/manager.js');
  sns: typeof import('./sns/manager.js');
  cognito: typeof import('./cognito/manager.js');
}
