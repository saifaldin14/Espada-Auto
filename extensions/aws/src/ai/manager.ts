/**
 * AWS AI/ML Services Manager
 *
 * Unified interface for AWS AI/ML services:
 * - SageMaker: notebook instances, models, endpoints, training jobs
 * - Bedrock: foundation model listing and invocation
 * - Comprehend: sentiment, entities, key phrases, PII, language detection
 * - Rekognition: image labels, faces, text, moderation, celebrities
 * - Translate: text translation, language listing
 */

import {
  type AWSRetryOptions,
  createAWSRetryRunner,
} from "../retry.js";

import {
  SageMakerClient,
  ListNotebookInstancesCommand,
  DescribeNotebookInstanceCommand,
  CreateNotebookInstanceCommand,
  StartNotebookInstanceCommand,
  StopNotebookInstanceCommand,
  DeleteNotebookInstanceCommand,
  ListEndpointsCommand,
  DescribeEndpointCommand,
  DeleteEndpointCommand,
  ListModelsCommand,
  DescribeModelCommand,
  ListTrainingJobsCommand,
  DescribeTrainingJobCommand,
  type _InstanceType,
} from "@aws-sdk/client-sagemaker";

import {
  BedrockClient,
  ListFoundationModelsCommand,
  GetFoundationModelCommand,
} from "@aws-sdk/client-bedrock";

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

import {
  ComprehendClient,
  DetectSentimentCommand,
  DetectEntitiesCommand,
  DetectKeyPhrasesCommand,
  DetectDominantLanguageCommand,
  DetectPiiEntitiesCommand,
  type LanguageCode,
} from "@aws-sdk/client-comprehend";

import {
  RekognitionClient,
  DetectLabelsCommand,
  DetectFacesCommand,
  DetectTextCommand,
  RecognizeCelebritiesCommand,
  DetectModerationLabelsCommand,
} from "@aws-sdk/client-rekognition";

import {
  TranslateClient,
  TranslateTextCommand,
  ListLanguagesCommand,
} from "@aws-sdk/client-translate";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface AWSAIManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
}

export interface AIOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// -- SageMaker types --

export interface NotebookInstanceInfo {
  name: string;
  arn: string;
  status: string;
  instanceType: string;
  url?: string;
  creationTime?: Date;
  lastModifiedTime?: Date;
  roleArn?: string;
  directInternetAccess?: string;
  volumeSizeInGB?: number;
}

export interface EndpointInfo {
  name: string;
  arn: string;
  status: string;
  creationTime?: Date;
  lastModifiedTime?: Date;
  endpointConfigName?: string;
}

export interface ModelInfo {
  name: string;
  arn: string;
  creationTime?: Date;
}

export interface TrainingJobInfo {
  name: string;
  arn: string;
  status: string;
  creationTime?: Date;
  lastModifiedTime?: Date;
  trainingEndTime?: Date;
  failureReason?: string;
}

export interface CreateNotebookOptions {
  notebookInstanceName: string;
  instanceType: string;
  roleArn: string;
  directInternetAccess?: "Enabled" | "Disabled";
  volumeSizeInGB?: number;
  subnetId?: string;
  securityGroupIds?: string[];
  tags?: Record<string, string>;
}

// -- Bedrock types --

export interface FoundationModelInfo {
  modelId: string;
  modelName: string;
  providerName: string;
  inputModalities: string[];
  outputModalities: string[];
  responseStreamingSupported: boolean;
  customizationsSupported: string[];
  modelLifecycleStatus?: string;
}

export interface InvokeModelOptions {
  modelId: string;
  body: string;
  contentType?: string;
  accept?: string;
}

export interface InvokeModelResult {
  body: string;
  contentType: string;
}

// -- Comprehend types --

export interface SentimentResult {
  sentiment: string;
  sentimentScore: {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
  };
}

export interface EntityResult {
  text: string;
  type: string;
  score: number;
  beginOffset: number;
  endOffset: number;
}

export interface KeyPhraseResult {
  text: string;
  score: number;
  beginOffset: number;
  endOffset: number;
}

export interface LanguageResult {
  languageCode: string;
  score: number;
}

export interface PiiEntityResult {
  type: string;
  score: number;
  beginOffset: number;
  endOffset: number;
}

// -- Rekognition types --

export interface ImageSource {
  s3Bucket: string;
  s3Key: string;
}

export interface ImageLabelResult {
  name: string;
  confidence: number;
  parents: string[];
  categories: string[];
}

export interface FaceResult {
  confidence: number;
  ageRange?: { low: number; high: number };
  gender?: { value: string; confidence: number };
  smile?: { value: boolean; confidence: number };
  eyeglasses?: { value: boolean; confidence: number };
  sunglasses?: { value: boolean; confidence: number };
  emotions: Array<{ type: string; confidence: number }>;
}

export interface TextDetectionResult {
  detectedText: string;
  type: string;
  confidence: number;
}

export interface CelebrityResult {
  name: string;
  matchConfidence: number;
  urls: string[];
}

export interface ModerationLabelResult {
  name: string;
  parentName: string;
  confidence: number;
  taxonomyLevel: number;
}

// -- Translate types --

export interface TranslationResult {
  translatedText: string;
  sourceLanguageCode: string;
  targetLanguageCode: string;
}

export interface SupportedLanguage {
  languageCode: string;
  languageName: string;
}

// ============================================================================
// AWS AI Manager
// ============================================================================

export class AWSAIManager {
  private sagemakerClient: SageMakerClient;
  private bedrockClient: BedrockClient;
  private bedrockRuntimeClient: BedrockRuntimeClient;
  private comprehendClient: ComprehendClient;
  private rekognitionClient: RekognitionClient;
  private translateClient: TranslateClient;
  private retry: <T>(fn: () => Promise<T>, label?: string) => Promise<T>;

  constructor(
    config: AWSAIManagerConfig = {},
    retryOptions: AWSRetryOptions = {},
  ) {
    const clientConfig = {
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    };

    this.sagemakerClient = new SageMakerClient(clientConfig);
    this.bedrockClient = new BedrockClient(clientConfig);
    this.bedrockRuntimeClient = new BedrockRuntimeClient(clientConfig);
    this.comprehendClient = new ComprehendClient(clientConfig);
    this.rekognitionClient = new RekognitionClient(clientConfig);
    this.translateClient = new TranslateClient(clientConfig);
    this.retry = createAWSRetryRunner(retryOptions);
  }

  // ==========================================================================
  // SageMaker — Notebook Instances
  // ==========================================================================

  async listNotebookInstances(
    maxResults?: number,
  ): Promise<AIOperationResult<NotebookInstanceInfo[]>> {
    try {
      const response = await this.retry(
        () => this.sagemakerClient.send(new ListNotebookInstancesCommand({
          MaxResults: maxResults ?? 100,
        })),
        "ListNotebookInstances",
      );

      const notebooks: NotebookInstanceInfo[] = (response.NotebookInstances ?? []).map((n) => ({
        name: n.NotebookInstanceName ?? "",
        arn: n.NotebookInstanceArn ?? "",
        status: n.NotebookInstanceStatus ?? "",
        instanceType: n.InstanceType ?? "",
        url: n.Url,
        creationTime: n.CreationTime,
        lastModifiedTime: n.LastModifiedTime,
      }));

      return { success: true, data: notebooks };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async describeNotebookInstance(
    name: string,
  ): Promise<AIOperationResult<NotebookInstanceInfo>> {
    try {
      const r = await this.retry(
        () => this.sagemakerClient.send(new DescribeNotebookInstanceCommand({
          NotebookInstanceName: name,
        })),
        "DescribeNotebookInstance",
      );

      return {
        success: true,
        data: {
          name: r.NotebookInstanceName ?? name,
          arn: r.NotebookInstanceArn ?? "",
          status: r.NotebookInstanceStatus ?? "",
          instanceType: r.InstanceType ?? "",
          url: r.Url,
          creationTime: r.CreationTime,
          lastModifiedTime: r.LastModifiedTime,
          roleArn: r.RoleArn,
          directInternetAccess: r.DirectInternetAccess,
          volumeSizeInGB: r.VolumeSizeInGB,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async createNotebookInstance(
    options: CreateNotebookOptions,
  ): Promise<AIOperationResult<{ arn: string }>> {
    try {
      const tags = options.tags
        ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value }))
        : undefined;

      const r = await this.retry(
        () => this.sagemakerClient.send(new CreateNotebookInstanceCommand({
          NotebookInstanceName: options.notebookInstanceName,
          InstanceType: options.instanceType as _InstanceType,
          RoleArn: options.roleArn,
          DirectInternetAccess: options.directInternetAccess ?? "Enabled",
          VolumeSizeInGB: options.volumeSizeInGB ?? 5,
          SubnetId: options.subnetId,
          SecurityGroupIds: options.securityGroupIds,
          Tags: tags,
        })),
        "CreateNotebookInstance",
      );

      return { success: true, data: { arn: r.NotebookInstanceArn ?? "" } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async startNotebookInstance(name: string): Promise<AIOperationResult<void>> {
    try {
      await this.retry(
        () => this.sagemakerClient.send(new StartNotebookInstanceCommand({
          NotebookInstanceName: name,
        })),
        "StartNotebookInstance",
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async stopNotebookInstance(name: string): Promise<AIOperationResult<void>> {
    try {
      await this.retry(
        () => this.sagemakerClient.send(new StopNotebookInstanceCommand({
          NotebookInstanceName: name,
        })),
        "StopNotebookInstance",
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteNotebookInstance(name: string): Promise<AIOperationResult<void>> {
    try {
      await this.retry(
        () => this.sagemakerClient.send(new DeleteNotebookInstanceCommand({
          NotebookInstanceName: name,
        })),
        "DeleteNotebookInstance",
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // SageMaker — Endpoints
  // ==========================================================================

  async listEndpoints(
    maxResults?: number,
  ): Promise<AIOperationResult<EndpointInfo[]>> {
    try {
      const response = await this.retry(
        () => this.sagemakerClient.send(new ListEndpointsCommand({
          MaxResults: maxResults ?? 100,
        })),
        "ListEndpoints",
      );

      const endpoints: EndpointInfo[] = (response.Endpoints ?? []).map((e) => ({
        name: e.EndpointName ?? "",
        arn: e.EndpointArn ?? "",
        status: e.EndpointStatus ?? "",
        creationTime: e.CreationTime,
        lastModifiedTime: e.LastModifiedTime,
      }));

      return { success: true, data: endpoints };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async describeEndpoint(
    name: string,
  ): Promise<AIOperationResult<EndpointInfo>> {
    try {
      const r = await this.retry(
        () => this.sagemakerClient.send(new DescribeEndpointCommand({
          EndpointName: name,
        })),
        "DescribeEndpoint",
      );

      return {
        success: true,
        data: {
          name: r.EndpointName ?? name,
          arn: r.EndpointArn ?? "",
          status: r.EndpointStatus ?? "",
          creationTime: r.CreationTime,
          lastModifiedTime: r.LastModifiedTime,
          endpointConfigName: r.EndpointConfigName,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteEndpoint(name: string): Promise<AIOperationResult<void>> {
    try {
      await this.retry(
        () => this.sagemakerClient.send(new DeleteEndpointCommand({
          EndpointName: name,
        })),
        "DeleteEndpoint",
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // SageMaker — Models
  // ==========================================================================

  async listModels(
    maxResults?: number,
  ): Promise<AIOperationResult<ModelInfo[]>> {
    try {
      const response = await this.retry(
        () => this.sagemakerClient.send(new ListModelsCommand({
          MaxResults: maxResults ?? 100,
        })),
        "ListModels",
      );

      const models: ModelInfo[] = (response.Models ?? []).map((m) => ({
        name: m.ModelName ?? "",
        arn: m.ModelArn ?? "",
        creationTime: m.CreationTime,
      }));

      return { success: true, data: models };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async describeModel(
    name: string,
  ): Promise<AIOperationResult<ModelInfo>> {
    try {
      const r = await this.retry(
        () => this.sagemakerClient.send(new DescribeModelCommand({
          ModelName: name,
        })),
        "DescribeModel",
      );

      return {
        success: true,
        data: {
          name: r.ModelName ?? name,
          arn: r.ModelArn ?? "",
          creationTime: r.CreationTime,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // SageMaker — Training Jobs
  // ==========================================================================

  async listTrainingJobs(
    maxResults?: number,
  ): Promise<AIOperationResult<TrainingJobInfo[]>> {
    try {
      const response = await this.retry(
        () => this.sagemakerClient.send(new ListTrainingJobsCommand({
          MaxResults: maxResults ?? 100,
        })),
        "ListTrainingJobs",
      );

      const jobs: TrainingJobInfo[] = (response.TrainingJobSummaries ?? []).map((j) => ({
        name: j.TrainingJobName ?? "",
        arn: j.TrainingJobArn ?? "",
        status: j.TrainingJobStatus ?? "",
        creationTime: j.CreationTime,
        lastModifiedTime: j.LastModifiedTime,
        trainingEndTime: j.TrainingEndTime,
      }));

      return { success: true, data: jobs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async describeTrainingJob(
    name: string,
  ): Promise<AIOperationResult<TrainingJobInfo>> {
    try {
      const r = await this.retry(
        () => this.sagemakerClient.send(new DescribeTrainingJobCommand({
          TrainingJobName: name,
        })),
        "DescribeTrainingJob",
      );

      return {
        success: true,
        data: {
          name: r.TrainingJobName ?? name,
          arn: r.TrainingJobArn ?? "",
          status: r.TrainingJobStatus ?? "",
          creationTime: r.CreationTime,
          lastModifiedTime: r.LastModifiedTime,
          trainingEndTime: r.TrainingEndTime,
          failureReason: r.FailureReason,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // Bedrock — Foundation Models
  // ==========================================================================

  async listFoundationModels(
    providerFilter?: string,
  ): Promise<AIOperationResult<FoundationModelInfo[]>> {
    try {
      const response = await this.retry(
        () => this.bedrockClient.send(new ListFoundationModelsCommand({
          ...(providerFilter ? { byProvider: providerFilter } : {}),
        })),
        "ListFoundationModels",
      );

      const models: FoundationModelInfo[] = (response.modelSummaries ?? []).map((m) => ({
        modelId: m.modelId ?? "",
        modelName: m.modelName ?? "",
        providerName: m.providerName ?? "",
        inputModalities: m.inputModalities ?? [],
        outputModalities: m.outputModalities ?? [],
        responseStreamingSupported: m.responseStreamingSupported ?? false,
        customizationsSupported: m.customizationsSupported ?? [],
        modelLifecycleStatus: m.modelLifecycle?.status,
      }));

      return { success: true, data: models };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getFoundationModel(
    modelId: string,
  ): Promise<AIOperationResult<FoundationModelInfo>> {
    try {
      const r = await this.retry(
        () => this.bedrockClient.send(new GetFoundationModelCommand({
          modelIdentifier: modelId,
        })),
        "GetFoundationModel",
      );

      const m = r.modelDetails;
      if (!m) {
        return { success: false, error: `Model '${modelId}' not found` };
      }

      return {
        success: true,
        data: {
          modelId: m.modelId ?? modelId,
          modelName: m.modelName ?? "",
          providerName: m.providerName ?? "",
          inputModalities: m.inputModalities ?? [],
          outputModalities: m.outputModalities ?? [],
          responseStreamingSupported: m.responseStreamingSupported ?? false,
          customizationsSupported: m.customizationsSupported ?? [],
          modelLifecycleStatus: m.modelLifecycle?.status,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // Bedrock — Model Invocation
  // ==========================================================================

  async invokeModel(
    options: InvokeModelOptions,
  ): Promise<AIOperationResult<InvokeModelResult>> {
    try {
      const response = await this.retry(
        () => this.bedrockRuntimeClient.send(new InvokeModelCommand({
          modelId: options.modelId,
          body: new TextEncoder().encode(options.body),
          contentType: options.contentType ?? "application/json",
          accept: options.accept ?? "application/json",
        })),
        "InvokeModel",
      );

      const bodyStr = new TextDecoder().decode(response.body);

      return {
        success: true,
        data: {
          body: bodyStr,
          contentType: response.contentType ?? "application/json",
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // Comprehend — Text Analysis
  // ==========================================================================

  async detectSentiment(
    text: string,
    languageCode: string = "en",
  ): Promise<AIOperationResult<SentimentResult>> {
    try {
      const r = await this.retry(
        () => this.comprehendClient.send(new DetectSentimentCommand({
          Text: text,
          LanguageCode: languageCode as LanguageCode,
        })),
        "DetectSentiment",
      );

      return {
        success: true,
        data: {
          sentiment: r.Sentiment ?? "UNKNOWN",
          sentimentScore: {
            positive: r.SentimentScore?.Positive ?? 0,
            negative: r.SentimentScore?.Negative ?? 0,
            neutral: r.SentimentScore?.Neutral ?? 0,
            mixed: r.SentimentScore?.Mixed ?? 0,
          },
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async detectEntities(
    text: string,
    languageCode: string = "en",
  ): Promise<AIOperationResult<EntityResult[]>> {
    try {
      const r = await this.retry(
        () => this.comprehendClient.send(new DetectEntitiesCommand({
          Text: text,
          LanguageCode: languageCode as LanguageCode,
        })),
        "DetectEntities",
      );

      const entities: EntityResult[] = (r.Entities ?? []).map((e) => ({
        text: e.Text ?? "",
        type: e.Type ?? "",
        score: e.Score ?? 0,
        beginOffset: e.BeginOffset ?? 0,
        endOffset: e.EndOffset ?? 0,
      }));

      return { success: true, data: entities };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async detectKeyPhrases(
    text: string,
    languageCode: string = "en",
  ): Promise<AIOperationResult<KeyPhraseResult[]>> {
    try {
      const r = await this.retry(
        () => this.comprehendClient.send(new DetectKeyPhrasesCommand({
          Text: text,
          LanguageCode: languageCode as LanguageCode,
        })),
        "DetectKeyPhrases",
      );

      const phrases: KeyPhraseResult[] = (r.KeyPhrases ?? []).map((p) => ({
        text: p.Text ?? "",
        score: p.Score ?? 0,
        beginOffset: p.BeginOffset ?? 0,
        endOffset: p.EndOffset ?? 0,
      }));

      return { success: true, data: phrases };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async detectDominantLanguage(
    text: string,
  ): Promise<AIOperationResult<LanguageResult[]>> {
    try {
      const r = await this.retry(
        () => this.comprehendClient.send(new DetectDominantLanguageCommand({
          Text: text,
        })),
        "DetectDominantLanguage",
      );

      const languages: LanguageResult[] = (r.Languages ?? []).map((l) => ({
        languageCode: l.LanguageCode ?? "",
        score: l.Score ?? 0,
      }));

      return { success: true, data: languages };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async detectPiiEntities(
    text: string,
    languageCode: string = "en",
  ): Promise<AIOperationResult<PiiEntityResult[]>> {
    try {
      const r = await this.retry(
        () => this.comprehendClient.send(new DetectPiiEntitiesCommand({
          Text: text,
          LanguageCode: languageCode as LanguageCode,
        })),
        "DetectPiiEntities",
      );

      const entities: PiiEntityResult[] = (r.Entities ?? []).map((e) => ({
        type: e.Type ?? "",
        score: e.Score ?? 0,
        beginOffset: e.BeginOffset ?? 0,
        endOffset: e.EndOffset ?? 0,
      }));

      return { success: true, data: entities };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // Rekognition — Image Analysis
  // ==========================================================================

  async detectLabels(
    image: ImageSource,
    maxLabels?: number,
    minConfidence?: number,
  ): Promise<AIOperationResult<ImageLabelResult[]>> {
    try {
      const r = await this.retry(
        () => this.rekognitionClient.send(new DetectLabelsCommand({
          Image: { S3Object: { Bucket: image.s3Bucket, Name: image.s3Key } },
          MaxLabels: maxLabels ?? 20,
          MinConfidence: minConfidence ?? 70,
        })),
        "DetectLabels",
      );

      const labels: ImageLabelResult[] = (r.Labels ?? []).map((l) => ({
        name: l.Name ?? "",
        confidence: l.Confidence ?? 0,
        parents: (l.Parents ?? []).map((p) => p.Name ?? ""),
        categories: (l.Categories ?? []).map((c) => c.Name ?? ""),
      }));

      return { success: true, data: labels };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async detectFaces(
    image: ImageSource,
  ): Promise<AIOperationResult<FaceResult[]>> {
    try {
      const r = await this.retry(
        () => this.rekognitionClient.send(new DetectFacesCommand({
          Image: { S3Object: { Bucket: image.s3Bucket, Name: image.s3Key } },
          Attributes: ["ALL"],
        })),
        "DetectFaces",
      );

      const faces: FaceResult[] = (r.FaceDetails ?? []).map((f) => ({
        confidence: f.Confidence ?? 0,
        ageRange: f.AgeRange ? { low: f.AgeRange.Low ?? 0, high: f.AgeRange.High ?? 0 } : undefined,
        gender: f.Gender ? { value: f.Gender.Value ?? "", confidence: f.Gender.Confidence ?? 0 } : undefined,
        smile: f.Smile ? { value: f.Smile.Value ?? false, confidence: f.Smile.Confidence ?? 0 } : undefined,
        eyeglasses: f.Eyeglasses ? { value: f.Eyeglasses.Value ?? false, confidence: f.Eyeglasses.Confidence ?? 0 } : undefined,
        sunglasses: f.Sunglasses ? { value: f.Sunglasses.Value ?? false, confidence: f.Sunglasses.Confidence ?? 0 } : undefined,
        emotions: (f.Emotions ?? []).map((e) => ({
          type: e.Type ?? "",
          confidence: e.Confidence ?? 0,
        })),
      }));

      return { success: true, data: faces };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async detectText(
    image: ImageSource,
  ): Promise<AIOperationResult<TextDetectionResult[]>> {
    try {
      const r = await this.retry(
        () => this.rekognitionClient.send(new DetectTextCommand({
          Image: { S3Object: { Bucket: image.s3Bucket, Name: image.s3Key } },
        })),
        "DetectText",
      );

      const detections: TextDetectionResult[] = (r.TextDetections ?? []).map((t) => ({
        detectedText: t.DetectedText ?? "",
        type: t.Type ?? "",
        confidence: t.Confidence ?? 0,
      }));

      return { success: true, data: detections };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async recognizeCelebrities(
    image: ImageSource,
  ): Promise<AIOperationResult<CelebrityResult[]>> {
    try {
      const r = await this.retry(
        () => this.rekognitionClient.send(new RecognizeCelebritiesCommand({
          Image: { S3Object: { Bucket: image.s3Bucket, Name: image.s3Key } },
        })),
        "RecognizeCelebrities",
      );

      const celebrities: CelebrityResult[] = (r.CelebrityFaces ?? []).map((c) => ({
        name: c.Name ?? "",
        matchConfidence: c.MatchConfidence ?? 0,
        urls: c.Urls ?? [],
      }));

      return { success: true, data: celebrities };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async detectModerationLabels(
    image: ImageSource,
    minConfidence?: number,
  ): Promise<AIOperationResult<ModerationLabelResult[]>> {
    try {
      const r = await this.retry(
        () => this.rekognitionClient.send(new DetectModerationLabelsCommand({
          Image: { S3Object: { Bucket: image.s3Bucket, Name: image.s3Key } },
          MinConfidence: minConfidence ?? 50,
        })),
        "DetectModerationLabels",
      );

      const labels: ModerationLabelResult[] = (r.ModerationLabels ?? []).map((l) => ({
        name: l.Name ?? "",
        parentName: l.ParentName ?? "",
        confidence: l.Confidence ?? 0,
        taxonomyLevel: l.TaxonomyLevel ?? 0,
      }));

      return { success: true, data: labels };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // Translate
  // ==========================================================================

  async translateText(
    text: string,
    sourceLanguageCode: string,
    targetLanguageCode: string,
  ): Promise<AIOperationResult<TranslationResult>> {
    try {
      const r = await this.retry(
        () => this.translateClient.send(new TranslateTextCommand({
          Text: text,
          SourceLanguageCode: sourceLanguageCode,
          TargetLanguageCode: targetLanguageCode,
        })),
        "TranslateText",
      );

      return {
        success: true,
        data: {
          translatedText: r.TranslatedText ?? "",
          sourceLanguageCode: r.SourceLanguageCode ?? sourceLanguageCode,
          targetLanguageCode: r.TargetLanguageCode ?? targetLanguageCode,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listSupportedLanguages(): Promise<AIOperationResult<SupportedLanguage[]>> {
    try {
      const r = await this.retry(
        () => this.translateClient.send(new ListLanguagesCommand({})),
        "ListLanguages",
      );

      const languages: SupportedLanguage[] = (r.Languages ?? []).map((l) => ({
        languageCode: l.LanguageCode ?? "",
        languageName: l.LanguageName ?? "",
      }));

      return { success: true, data: languages };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAWSAIManager(
  config: AWSAIManagerConfig = {},
  retryOptions: AWSRetryOptions = {},
): AWSAIManager {
  return new AWSAIManager(config, retryOptions);
}
