/**
 * Advisor module — barrel exports
 */

export { GcpProjectAnalyzer, createProjectAnalyzer } from "./analyzer.js";
export { GcpRecommendationEngine, createRecommendationEngine } from "./engine.js";
export { GcpAdvisorPrompter, createAdvisorPrompter } from "./prompter.js";
export { GcpAdvisorVerifier, createAdvisorVerifier } from "./verifier.js";
export type {
  RecommendationCategory,
  RecommendationSeverity,
  RecommendationStatus,
  GcpRecommendation,
  ProjectAnalysis,
  ProjectFinding,
  AdvisorConfig,
  VerificationResult,
  PrompterQuestion,
  PrompterSession,
} from "./types.js";
