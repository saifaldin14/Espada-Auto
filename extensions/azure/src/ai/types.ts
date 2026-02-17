/**
 * Azure AI / Cognitive Services — Type Definitions
 */

export type CognitiveServicesKind =
  | "OpenAI"
  | "CognitiveServices"
  | "ComputerVision"
  | "TextAnalytics"
  | "SpeechServices"
  | "FormRecognizer"
  | "ContentSafety"
  | "CustomVision.Training"
  | "CustomVision.Prediction";

export type CognitiveServicesAccount = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  kind: CognitiveServicesKind;
  sku?: string;
  endpoint?: string;
  provisioningState?: string;
  capabilities?: string[];
  customSubDomainName?: string;
};

export type CognitiveServicesDeployment = {
  id: string;
  name: string;
  accountName: string;
  model: { name: string; version: string; format?: string };
  sku?: { name: string; capacity: number };
  provisioningState?: string;
  rateLimits?: Array<{ key: string; renewalPeriod: number; count: number }>;
};

export type AIModel = {
  name: string;
  format: string;
  version: string;
  capabilities?: Record<string, string>;
  deprecation?: { fineTune?: string; inference?: string };
  lifecycleStatus?: string;
  maxCapacity?: number;
};

export type OpenAIDeployment = CognitiveServicesDeployment & {
  modelName: string;
  modelVersion: string;
};
