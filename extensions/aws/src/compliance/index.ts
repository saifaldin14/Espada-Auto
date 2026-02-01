/**
 * AWS Compliance & Governance Module
 *
 * Provides comprehensive compliance management including:
 * - AWS Config rule management
 * - Compliance framework checks (CIS, SOC2, HIPAA, PCI-DSS, etc.)
 * - Conformance pack deployment
 * - Tag compliance enforcement
 * - Violation tracking and remediation
 * - Compliance reporting
 */

export * from './types.js';
export * from './manager.js';

import { AWSComplianceManager } from './manager.js';
export default AWSComplianceManager;
