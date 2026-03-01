// ─── Barrel exports ───────────────────────────────────────────────────
export * from "./types.js";
export {
  createLifecycleIncident,
  classifyIncident,
  triageIncident,
  transitionPhase,
  filterLifecycles,
  buildDashboard,
  sortByPriority,
  resetIdCounter,
} from "./state-machine.js";
export type { TransitionResult, TransitionError, TransitionSuccess } from "./state-machine.js";
export {
  planRemediation,
  executeRemediation,
  simulateRemediation,
  detectStrategy,
  resetPlanCounter,
} from "./remediation.js";
export type { StepExecutor } from "./remediation.js";
export {
  planRollback,
  executeRollback,
  detectRollbackStrategy,
  resetRollbackCounter,
} from "./rollback.js";
export type { RollbackStepExecutor } from "./rollback.js";
export {
  generatePostMortem,
  closeLifecycle,
  reconstructTimeline,
  analyzeRootCause,
  assessImpact,
  reviewRemediation,
  generateActionItems,
  resetPmCounter,
  resetActionCounter,
} from "./post-mortem.js";
export { createLifecycleTools, getStore, clearStore } from "./tools.js";
