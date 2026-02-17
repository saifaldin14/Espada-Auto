/**
 * Advisor module — barrel exports
 */

export { analyzeProject } from "./analyzer.js";
export { recommend, recommendAndPlan } from "./engine.js";
export { createPromptSession, createPromptSessionForBlueprint, resolveParams, applyAnswers } from "./prompter.js";
export { verify, formatReport } from "./verifier.js";
export type {
  DetectedLanguage,
  DetectedFramework,
  AppArchetype,
  DetectedDependency,
  DependencySignal,
  ProjectAnalysis,
  ServiceRecommendation,
  AzureServiceName,
  BlueprintMatch,
  DeployRecommendation,
  AdvisorOptions,
  RecommendationConfidence,
} from "./types.js";
export type {
  ParameterQuestion,
  PromptAnswers,
  PromptSession,
  ResolvedParams,
} from "./prompter.js";
export type {
  HealthCheck,
  HealthCheckStatus,
  VerificationReport,
  VerifyOptions,
} from "./verifier.js";
