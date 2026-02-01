/**
 * AWS Container Services Module
 *
 * Provides comprehensive container orchestration support including:
 * - ECS (Elastic Container Service) clusters, services, and tasks
 * - EKS (Elastic Kubernetes Service) clusters and node groups
 * - ECR (Elastic Container Registry) repository management
 * - Container scaling and deployment operations
 * - Container insights and logging
 */

export { ContainerManager, createContainerManager } from './manager.js';
export type * from './types.js';
