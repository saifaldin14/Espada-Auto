/**
 * Policy Engine — Built-in Policy Library
 *
 * Pre-built policy templates covering common cloud governance patterns.
 */

import type { PolicyDefinitionInput } from "./types.js";

export interface LibraryPolicy {
  id: string;
  name: string;
  description: string;
  category: string;
  template: PolicyDefinitionInput;
}

export const POLICY_LIBRARY: LibraryPolicy[] = [
  // ── Security ──────────────────────────────────────────────────
  {
    id: "deny-public-s3",
    name: "Deny Public S3 Buckets",
    description: "Block creation of S3 buckets with public access enabled",
    category: "security",
    template: {
      name: "Deny Public S3 Buckets",
      description: "Prevents creation of publicly-accessible S3 buckets",
      type: "plan",
      severity: "critical",
      autoAttachPatterns: ["type:aws_s3_bucket"],
      rules: [
        {
          id: "no-public-acl",
          description: "Block public ACLs on S3 buckets",
          condition: {
            type: "or",
            conditions: [
              { type: "field_equals", field: "resource.metadata.acl", value: "public-read" },
              { type: "field_equals", field: "resource.metadata.acl", value: "public-read-write" },
            ],
          },
          action: "deny",
          message: "S3 buckets must not have public ACLs. Use bucket policies or CloudFront for controlled access.",
        },
        {
          id: "no-public-block-disabled",
          description: "Ensure public access block is enabled",
          condition: {
            type: "field_equals",
            field: "resource.metadata.block_public_access",
            value: false,
          },
          action: "deny",
          message: "S3 bucket public access block must be enabled.",
        },
      ],
    },
  },
  {
    id: "require-encryption",
    name: "Require Encryption at Rest",
    description: "Ensure all storage resources have encryption enabled",
    category: "security",
    template: {
      name: "Require Encryption at Rest",
      description: "Enforces encryption on storage and database resources",
      type: "plan",
      severity: "high",
      autoAttachPatterns: ["type:aws_s3_bucket", "type:aws_ebs_volume", "type:aws_rds_instance"],
      rules: [
        {
          id: "encryption-enabled",
          description: "Storage must have encryption enabled",
          condition: {
            type: "and",
            conditions: [
              { type: "field_not_exists", field: "resource.metadata.encryption" },
              { type: "field_not_exists", field: "resource.metadata.encrypted" },
            ],
          },
          action: "deny",
          message: "All storage resources must have encryption enabled at rest.",
        },
      ],
    },
  },

  // ── Tagging ───────────────────────────────────────────────────
  {
    id: "require-tags",
    name: "Require Resource Tags",
    description: "Ensure all resources have required tags (environment, owner, team)",
    category: "governance",
    template: {
      name: "Require Resource Tags",
      description: "Enforces mandatory tagging for cost allocation and governance",
      type: "plan",
      severity: "high",
      autoAttachPatterns: ["*"],
      rules: [
        {
          id: "tag-environment",
          description: "Require environment tag",
          condition: { type: "tag_missing", tag: "environment" },
          action: "deny",
          message: 'All resources must have an "environment" tag.',
        },
        {
          id: "tag-owner",
          description: "Require owner tag",
          condition: { type: "tag_missing", tag: "owner" },
          action: "deny",
          message: 'All resources must have an "owner" tag.',
        },
        {
          id: "tag-team",
          description: "Require team tag",
          condition: { type: "tag_missing", tag: "team" },
          action: "warn",
          message: 'Resources should have a "team" tag for cost allocation.',
        },
      ],
    },
  },
  {
    id: "deny-untagged",
    name: "Deny Untagged Resources",
    description: "Block resources that have zero tags",
    category: "governance",
    template: {
      name: "Deny Untagged Resources",
      description: "Prevents creation of resources with no tags at all",
      type: "plan",
      severity: "medium",
      autoAttachPatterns: ["*"],
      rules: [
        {
          id: "has-any-tags",
          description: "Resource must have at least one tag",
          condition: { type: "field_equals", field: "resource.tags", value: {} },
          action: "deny",
          message: "Resources must have at least one tag. Add environment, owner, or team tags.",
        },
      ],
    },
  },

  // ── Cost ──────────────────────────────────────────────────────
  {
    id: "cost-threshold",
    name: "Cost Change Threshold",
    description: "Require approval for changes exceeding a cost threshold",
    category: "cost",
    template: {
      name: "Cost Change Threshold",
      description: "Requires approval when projected cost increases exceed $500/month",
      type: "cost",
      severity: "high",
      autoAttachPatterns: ["*"],
      rules: [
        {
          id: "cost-increase-warn",
          description: "Warn on moderate cost increase",
          condition: { type: "field_gt", field: "cost.delta", value: 100 },
          action: "warn",
          message: "This change increases monthly cost by more than $100.",
        },
        {
          id: "cost-increase-approval",
          description: "Require approval for large cost increases",
          condition: { type: "field_gt", field: "cost.delta", value: 500 },
          action: "require_approval",
          message: "Cost increase exceeds $500/month — requires manager approval.",
        },
      ],
    },
  },

  // ── Operations ────────────────────────────────────────────────
  {
    id: "block-prod-deletes",
    name: "Block Production Deletions",
    description: "Prevent resource deletions in production environments",
    category: "operations",
    template: {
      name: "Block Production Deletions",
      description: "Blocks destructive operations in production",
      type: "plan",
      severity: "critical",
      autoAttachPatterns: ["tag:environment=production"],
      rules: [
        {
          id: "no-prod-delete",
          description: "Block deletes in production",
          condition: {
            type: "and",
            conditions: [
              { type: "tag_equals", tag: "environment", value: "production" },
              { type: "field_gt", field: "plan.totalDeletes", value: 0 },
            ],
          },
          action: "deny",
          message: "Deleting resources in production is not allowed without an approved change request.",
        },
        {
          id: "limit-prod-changes",
          description: "Large production changes need approval",
          condition: {
            type: "and",
            conditions: [
              { type: "tag_equals", tag: "environment", value: "production" },
              { type: "field_gt", field: "plan.totalUpdates", value: 10 },
            ],
          },
          action: "require_approval",
          message: "Updating more than 10 production resources requires approval.",
        },
      ],
    },
  },
  {
    id: "restrict-instance-types",
    name: "Restrict Instance Types",
    description: "Limit compute instances to approved types to control cost and complexity",
    category: "cost",
    template: {
      name: "Restrict Instance Types",
      description: "Ensures only approved instance types are used",
      type: "plan",
      severity: "medium",
      autoAttachPatterns: ["type:aws_instance", "type:aws_launch_template"],
      rules: [
        {
          id: "allowed-instance-types",
          description: "Only use approved instance types",
          condition: {
            type: "field_not_in",
            field: "resource.metadata.instance_type",
            values: [
              "t3.micro",
              "t3.small",
              "t3.medium",
              "t3.large",
              "m5.large",
              "m5.xlarge",
              "m5.2xlarge",
              "c5.large",
              "c5.xlarge",
              "r5.large",
              "r5.xlarge",
            ],
          },
          action: "warn",
          message: "Instance type is not in the approved list. Please use t3/m5/c5/r5 families.",
        },
      ],
    },
  },

  // ── Blast Radius ──────────────────────────────────────────────
  {
    id: "blast-radius-limit",
    name: "Blast Radius Limit",
    description: "Limit changes that affect too many dependent resources",
    category: "operations",
    template: {
      name: "Blast Radius Limit",
      description: "Prevents changes with excessive blast radius",
      type: "plan",
      severity: "high",
      autoAttachPatterns: ["*"],
      rules: [
        {
          id: "blast-radius-warn",
          description: "Warn on high blast radius",
          condition: { type: "field_gt", field: "graph.blastRadius", value: 10 },
          action: "warn",
          message: "Change has a blast radius of more than 10 resources.",
        },
        {
          id: "blast-radius-deny",
          description: "Deny excessive blast radius",
          condition: { type: "field_gt", field: "graph.blastRadius", value: 50 },
          action: "deny",
          message: "Change affects more than 50 resources. Break into smaller incremental changes.",
        },
      ],
    },
  },
];

/** Get all available library policies */
export function getLibraryPolicies(): LibraryPolicy[] {
  return POLICY_LIBRARY;
}

/** Get library policies filtered by category */
export function getLibraryByCategory(category: string): LibraryPolicy[] {
  return POLICY_LIBRARY.filter((p) => p.category === category);
}

/** Get a specific library policy by ID */
export function getLibraryPolicy(id: string): LibraryPolicy | undefined {
  return POLICY_LIBRARY.find((p) => p.id === id);
}

/** Get all unique categories */
export function getLibraryCategories(): string[] {
  return [...new Set(POLICY_LIBRARY.map((p) => p.category))];
}
