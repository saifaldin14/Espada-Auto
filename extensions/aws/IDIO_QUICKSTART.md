# IDIO Quick Start Guide

## What is IDIO?

Intent-Driven Infrastructure Orchestration (IDIO) lets you deploy AWS infrastructure by describing **business requirements** instead of writing infrastructure code.

## 5-Minute Quick Start

### 1. Use a Pre-Built Template

```typescript
// List available templates
orchestrator.listTemplates();

// Use the three-tier-web-app template
orchestrator.createPlanFromTemplate('three-tier-web-app', {
  name: 'my-startup',
  environment: 'production',
  monthlyBudget: 500,
  primaryRegion: 'us-east-1',
});
```

### 2. Create Custom Intent

```typescript
const intent: ApplicationIntent = {
  name: "my-api",
  tiers: [
    { type: "api", trafficPattern: "burst" },
    { type: "database", dataSizeGb: 100 }
  ],
  environment: "production",
  availability: "99.9",
  cost: { monthlyBudgetUsd: 300 },
  compliance: ["none"],
  security: {
    encryptionAtRest: true,
    encryptionInTransit: true,
    networkIsolation: "private-subnet"
  },
  primaryRegion: "us-east-1"
};

orchestrator.createPlanFromIntent(intent);
```

### 3. Review & Execute

```typescript
// Get plan details
const plan = orchestrator.getPlan(planId);
console.log(`Cost: $${plan.data.plan.estimatedMonthlyCostUsd}/month`);
console.log(`Resources: ${plan.data.plan.resources.length}`);

// Dry run first
orchestrator.executePlan(planId, { dryRun: true });

// Execute for real
orchestrator.executePlan(planId);
```

### 4. Monitor & Reconcile

```typescript
// Check status
orchestrator.checkStatus(executionId);

// Run reconciliation
orchestrator.reconcile(executionId);
```

## Common Patterns

### High-Availability Web Application
```typescript
{
  name: "web-app",
  tiers: [
    { type: "web", scaling: { min: 3, max: 20 } },
    { type: "database" }
  ],
  environment: "production",
  availability: "99.99",
  disasterRecovery: {
    rtoMinutes: 15,
    rpoMinutes: 5,
    crossRegionReplication: true
  }
}
```

### Serverless API
```typescript
{
  name: "api",
  tiers: [
    { 
      type: "api", 
      trafficPattern: "burst",
      runtime: { language: "nodejs", version: "20" }
    }
  ],
  cost: { monthlyBudgetUsd: 50 }
}
```

### Data Pipeline
```typescript
{
  name: "analytics",
  tiers: [
    { type: "queue" },
    { type: "analytics" },
    { type: "storage", dataSizeGb: 1000 }
  ],
  environment: "production"
}
```

## Compliance Frameworks

Supported frameworks (auto-configured):
- `hipaa` - Healthcare
- `pci-dss` - Payment processing
- `soc2` - SaaS applications
- `gdpr` - EU data protection
- `iso27001` - Information security
- `fedramp` - US government

Example:
```typescript
{
  compliance: ["pci-dss", "soc2"],
  security: {
    encryptionAtRest: true,      // Enforced
    encryptionInTransit: true,   // Enforced
    networkIsolation: "vpc-isolated",  // Required
    wafEnabled: true,            // Recommended
    secretRotationEnabled: true  // Required
  }
}
```

## Traffic Patterns

Choose the right pattern for optimal cost/performance:

- `steady` - Predictable constant traffic → EC2 with reserved instances
- `burst` - Unpredictable spikes → Lambda functions
- `predictable-daily` - Office hours traffic → Scheduled scaling
- `predictable-weekly` - Weekend spikes → Predictive scaling
- `seasonal` - Holiday/event traffic → Aggressive auto-scaling
- `unpredictable` - Highly variable → Serverless architecture

## Cost Optimization Tips

1. **Set realistic budgets** - IDIO will select cost-effective options
2. **Use dev/staging for experiments** - Production defaults to reliability
3. **Enable prioritizeCost flag** - Trades performance for savings
4. **Review cost breakdown** - Identify high-cost services
5. **Consider reserved instances** - IDIO suggests RI strategies

## Policy Validation

All infrastructure is validated before deployment:

**Critical Violations** - Deployment blocked
- No encryption when required
- Public database access
- Missing security groups

**High Violations** - Approval required
- Single-AZ production resources
- Insufficient backup retention

**Medium/Low Violations** - Warnings only
- Missing resource tags
- Overly permissive security groups

## Reconciliation Schedule

Enable continuous monitoring:

```typescript
const config = {
  reconciliation: {
    intervalMinutes: 15,           // Check every 15 minutes
    enableAutoRemediation: true,   // Auto-fix drift
    costAnomalyThreshold: 20       // Alert if 20% over budget
  }
};
```

## Troubleshooting

### "Plan requires approval"
**Cause**: Production deployment or budget exceeded
**Solution**: Set `autoApprove: true` or get manual approval

### "Policy validation failed"
**Cause**: Critical compliance violation
**Solution**: Check `policyValidation.violations` and fix

### "Estimated cost exceeds budget"
**Cause**: Resources too large for budget
**Solution**: Increase budget or enable `prioritizeCost`

### "Drift detected"
**Cause**: Manual changes made outside IDIO
**Solution**: Review `drifts` and run reconciliation

## Best Practices

1. **Start with templates** - Proven patterns save time
2. **Always run dry-run first** - Preview before executing
3. **Enable reconciliation** - Catch drift early
4. **Use environment tags** - Separate dev/staging/prod
5. **Review cost estimates** - Avoid bill shock
6. **Enable compliance validation** - Security from day one
7. **Monitor execution status** - Don't assume success
8. **Keep intents version controlled** - Infrastructure as code

## Template Catalog

| Template | Use Case | Cost Range |
|----------|----------|------------|
| three-tier-web-app | Classic web application | $200-2K |
| serverless-api | Variable traffic API | $10-200 |
| ecommerce-platform | High-availability retail | $5K-20K |
| data-pipeline | Batch/stream processing | $200-5K |
| microservices-platform | Container orchestration | $1K-10K |
| machine-learning-platform | Model training/serving | $500-10K |
| static-website | Marketing/docs site | $10-200 |

## Next Steps

1. **Explore templates**: `orchestrator.listTemplates()`
2. **Test in dev**: Create a dev environment first
3. **Review generated plans**: Understand what IDIO creates
4. **Enable monitoring**: Set up reconciliation
5. **Scale up**: Move to staging, then production

## Support

- Documentation: `extensions/aws/IDIO_README.md`
- Examples: See template examples in catalog
- Policies: 14 built-in rules in policy engine
- Issues: Check policy violations and drift reports

---

**Remember**: IDIO handles the "how", you focus on the "what". Describe your business requirements, let IDIO build secure, cost-optimized infrastructure automatically.
