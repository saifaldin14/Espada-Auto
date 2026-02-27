/**
 * AWS Adapter — Automation Domain Module
 *
 * Discovers EventBridge rules, targets, and Step Functions state machines
 * via the AutomationManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Discover automation resources: EventBridge rules and Step Functions.
 *
 * Creates nodes for EventBridge rules and Step Functions state machines.
 * Creates `triggers` edges from rules to target Lambda/SQS/SNS/StepFn.
 */
export async function discoverAutomation(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getAutomationManager();
  if (!mgr) return;

  // Discover EventBridge rules
  const rulesResult = await (mgr as {
    listEventRules: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        Name?: string;
        Arn?: string;
        Description?: string;
        State?: string;
        EventBusName?: string;
        ScheduleExpression?: string;
        EventPattern?: string;
      }>;
    }>;
  }).listEventRules();

  if (rulesResult.success && rulesResult.data) {
    for (const rule of rulesResult.data) {
      if (!rule.Name) continue;

      const ruleNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        `eventbridge-rule-${rule.Name}`,
      );

      nodes.push({
        id: ruleNodeId,
        name: rule.Name,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: rule.Arn ?? rule.Name,
        status: rule.State === "ENABLED" ? "running" : "stopped",
        tags: {},
        metadata: {
          resourceSubtype: "eventbridge-rule",
          eventBus: rule.EventBusName ?? "default",
          description: rule.Description,
          scheduleExpression: rule.ScheduleExpression,
          hasEventPattern: !!rule.EventPattern,
          discoverySource: "automation-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: null,
      });

      // Get targets for this rule → `triggers` edges
      try {
        const targetsResult = await (mgr as {
          listTargets: (ruleName: string, eventBusName?: string) => Promise<{
            success: boolean;
            data?: Array<{
              Id?: string;
              Arn?: string;
              RoleArn?: string;
              Input?: string;
            }>;
          }>;
        }).listTargets(rule.Name, rule.EventBusName);

        if (targetsResult.success && targetsResult.data) {
          for (const target of targetsResult.data) {
            if (!target.Arn) continue;

            const targetNode = findNodeByArnOrId(
              nodes,
              target.Arn,
              extractResourceId(target.Arn),
            );
            if (!targetNode) continue;

            const triggersEdgeId = `${ruleNodeId}--triggers--${targetNode.id}`;
            if (!edges.some((e) => e.id === triggersEdgeId)) {
              edges.push({
                id: triggersEdgeId,
                sourceNodeId: ruleNodeId,
                targetNodeId: targetNode.id,
                relationshipType: "triggers",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: { targetId: target.Id },
              });
            }
          }
        }
      } catch {
        // Target resolution is best-effort
      }
    }
  }

  // Discover Step Functions state machines
  const sfResult = await (mgr as {
    listStateMachines: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        stateMachineArn?: string;
        name?: string;
        type?: string;
        creationDate?: string;
      }>;
    }>;
  }).listStateMachines();

  if (sfResult.success && sfResult.data) {
    for (const sm of sfResult.data) {
      if (!sm.name) continue;

      const smNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        `stepfn-${sm.name}`,
      );

      nodes.push({
        id: smNodeId,
        name: sm.name,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: sm.stateMachineArn ?? sm.name,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "step-function",
          type: sm.type,
          creationDate: sm.creationDate,
          discoverySource: "automation-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: sm.creationDate ?? null,
      });

      // Get state machine definition to find service integrations
      if (sm.stateMachineArn) {
        try {
          const smDetail = await (mgr as {
            getStateMachine: (arn: string) => Promise<{
              success: boolean;
              data?: {
                definition?: string;
                roleArn?: string;
                loggingConfiguration?: unknown;
              };
            }>;
          }).getStateMachine(sm.stateMachineArn);

          if (smDetail.success && smDetail.data?.definition) {
            // Parse the ASL definition for Lambda/service invocations
            try {
              const def = JSON.parse(smDetail.data.definition) as {
                States?: Record<string, { Resource?: string; Type?: string }>;
              };
              if (def.States) {
                for (const state of Object.values(def.States)) {
                  if (!state.Resource) continue;

                  // Match Lambda ARNs or service integration patterns
                  const targetNode = findNodeByArnOrId(
                    nodes,
                    state.Resource,
                    extractResourceId(state.Resource),
                  );
                  if (!targetNode) continue;

                  const depEdgeId = `${smNodeId}--depends-on--${targetNode.id}`;
                  if (!edges.some((e) => e.id === depEdgeId)) {
                    edges.push({
                      id: depEdgeId,
                      sourceNodeId: smNodeId,
                      targetNodeId: targetNode.id,
                      relationshipType: "depends-on",
                      confidence: 0.9,
                      discoveredVia: "config-scan",
                      metadata: { stateType: state.Type },
                    });
                  }
                }
              }
            } catch {
              // ASL parse failure is non-fatal
            }
          }

          // Link state machine to its IAM role
          if (smDetail.data?.roleArn) {
            const roleNode = findNodeByArnOrId(
              nodes,
              smDetail.data.roleArn,
              extractResourceId(smDetail.data.roleArn),
            );
            if (roleNode) {
              const usesEdgeId = `${smNodeId}--uses--${roleNode.id}`;
              if (!edges.some((e) => e.id === usesEdgeId)) {
                edges.push({
                  id: usesEdgeId,
                  sourceNodeId: smNodeId,
                  targetNodeId: roleNode.id,
                  relationshipType: "uses",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }
        } catch {
          // State machine detail resolution is best-effort
        }
      }
    }
  }
}
