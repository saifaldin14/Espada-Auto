/**
 * Advisor module — barrel exports
 */

export { analyzeProject } from "./analyzer.js";
export { recommend, recommendAndPlan } from "./engine.js";
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
