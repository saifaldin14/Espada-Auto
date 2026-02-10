import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all 6 AWS SDK clients
const mockSageMakerSend = vi.fn();
const mockBedrockSend = vi.fn();
const mockBedrockRuntimeSend = vi.fn();
const mockComprehendSend = vi.fn();
const mockRekognitionSend = vi.fn();
const mockTranslateSend = vi.fn();

vi.mock("@aws-sdk/client-sagemaker", () => ({
  SageMakerClient: vi.fn().mockImplementation(() => ({ send: mockSageMakerSend })),
  ListNotebookInstancesCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "ListNotebooks" })),
  DescribeNotebookInstanceCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DescribeNotebook" })),
  CreateNotebookInstanceCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "CreateNotebook" })),
  StartNotebookInstanceCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "StartNotebook" })),
  StopNotebookInstanceCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "StopNotebook" })),
  DeleteNotebookInstanceCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DeleteNotebook" })),
  ListEndpointsCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "ListEndpoints" })),
  DescribeEndpointCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DescribeEndpoint" })),
  DeleteEndpointCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DeleteEndpoint" })),
  ListModelsCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "ListModels" })),
  DescribeModelCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DescribeModel" })),
  ListTrainingJobsCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "ListTrainingJobs" })),
  DescribeTrainingJobCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DescribeTrainingJob" })),
}));

vi.mock("@aws-sdk/client-bedrock", () => ({
  BedrockClient: vi.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  ListFoundationModelsCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "ListFoundationModels" })),
  GetFoundationModelCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "GetFoundationModel" })),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: mockBedrockRuntimeSend })),
  InvokeModelCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "InvokeModel" })),
}));

vi.mock("@aws-sdk/client-comprehend", () => ({
  ComprehendClient: vi.fn().mockImplementation(() => ({ send: mockComprehendSend })),
  DetectSentimentCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectSentiment" })),
  DetectEntitiesCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectEntities" })),
  DetectKeyPhrasesCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectKeyPhrases" })),
  DetectDominantLanguageCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectDominantLanguage" })),
  DetectPiiEntitiesCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectPiiEntities" })),
}));

vi.mock("@aws-sdk/client-rekognition", () => ({
  RekognitionClient: vi.fn().mockImplementation(() => ({ send: mockRekognitionSend })),
  DetectLabelsCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectLabels" })),
  DetectFacesCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectFaces" })),
  DetectTextCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectText" })),
  RecognizeCelebritiesCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "RecognizeCelebrities" })),
  DetectModerationLabelsCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "DetectModerationLabels" })),
}));

vi.mock("@aws-sdk/client-translate", () => ({
  TranslateClient: vi.fn().mockImplementation(() => ({ send: mockTranslateSend })),
  TranslateTextCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "TranslateText" })),
  ListLanguagesCommand: vi.fn().mockImplementation((i) => ({ input: i, _t: "ListLanguages" })),
}));

vi.mock("../retry.js", () => ({
  createAWSRetryRunner: () => <T>(fn: () => Promise<T>) => fn(),
}));

import { AWSAIManager, createAWSAIManager } from "./manager.js";

// ============================================================================
// Tests
// ============================================================================

describe("AWSAIManager", () => {
  let manager: AWSAIManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AWSAIManager({ region: "us-east-1" });
  });

  describe("factory", () => {
    it("creates a manager via factory function", () => {
      const m = createAWSAIManager({ region: "us-west-2" });
      expect(m).toBeInstanceOf(AWSAIManager);
    });
  });

  // ==========================================================================
  // SageMaker — Notebook Instances
  // ==========================================================================

  describe("listNotebookInstances", () => {
    it("returns notebook instances", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        NotebookInstances: [
          {
            NotebookInstanceName: "my-notebook",
            NotebookInstanceArn: "arn:aws:sagemaker:us-east-1:123:notebook-instance/my-notebook",
            NotebookInstanceStatus: "InService",
            InstanceType: "ml.t3.medium",
            Url: "my-notebook.notebook.us-east-1.sagemaker.aws",
          },
        ],
      });

      const result = await manager.listNotebookInstances();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].name).toBe("my-notebook");
      expect(result.data![0].status).toBe("InService");
    });

    it("handles error", async () => {
      mockSageMakerSend.mockRejectedValueOnce(new Error("Access denied"));
      const result = await manager.listNotebookInstances();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Access denied");
    });
  });

  describe("describeNotebookInstance", () => {
    it("returns notebook details", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        NotebookInstanceName: "my-notebook",
        NotebookInstanceArn: "arn:...",
        NotebookInstanceStatus: "InService",
        InstanceType: "ml.t3.medium",
        RoleArn: "arn:aws:iam::role/SageMaker",
        VolumeSizeInGB: 10,
      });

      const result = await manager.describeNotebookInstance("my-notebook");
      expect(result.success).toBe(true);
      expect(result.data!.instanceType).toBe("ml.t3.medium");
      expect(result.data!.volumeSizeInGB).toBe(10);
    });
  });

  describe("createNotebookInstance", () => {
    it("creates a notebook instance", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        NotebookInstanceArn: "arn:aws:sagemaker:us-east-1:123:notebook-instance/new-nb",
      });

      const result = await manager.createNotebookInstance({
        notebookInstanceName: "new-nb",
        instanceType: "ml.t3.medium",
        roleArn: "arn:aws:iam::role/SageMaker",
        tags: { env: "dev" },
      });

      expect(result.success).toBe(true);
      expect(result.data!.arn).toContain("new-nb");
    });

    it("handles creation error", async () => {
      mockSageMakerSend.mockRejectedValueOnce(new Error("Quota exceeded"));
      const result = await manager.createNotebookInstance({
        notebookInstanceName: "fail",
        instanceType: "ml.t3.medium",
        roleArn: "arn:...",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("startNotebookInstance", () => {
    it("starts a notebook", async () => {
      mockSageMakerSend.mockResolvedValueOnce({});
      const result = await manager.startNotebookInstance("my-notebook");
      expect(result.success).toBe(true);
    });
  });

  describe("stopNotebookInstance", () => {
    it("stops a notebook", async () => {
      mockSageMakerSend.mockResolvedValueOnce({});
      const result = await manager.stopNotebookInstance("my-notebook");
      expect(result.success).toBe(true);
    });
  });

  describe("deleteNotebookInstance", () => {
    it("deletes a notebook", async () => {
      mockSageMakerSend.mockResolvedValueOnce({});
      const result = await manager.deleteNotebookInstance("my-notebook");
      expect(result.success).toBe(true);
    });

    it("handles delete error", async () => {
      mockSageMakerSend.mockRejectedValueOnce(new Error("In use"));
      const result = await manager.deleteNotebookInstance("in-use");
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // SageMaker — Endpoints
  // ==========================================================================

  describe("listEndpoints", () => {
    it("returns endpoints", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        Endpoints: [
          {
            EndpointName: "my-endpoint",
            EndpointArn: "arn:...",
            EndpointStatus: "InService",
          },
        ],
      });

      const result = await manager.listEndpoints();
      expect(result.success).toBe(true);
      expect(result.data![0].name).toBe("my-endpoint");
    });
  });

  describe("describeEndpoint", () => {
    it("returns endpoint details", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        EndpointName: "my-endpoint",
        EndpointArn: "arn:...",
        EndpointStatus: "InService",
        EndpointConfigName: "my-config",
      });

      const result = await manager.describeEndpoint("my-endpoint");
      expect(result.success).toBe(true);
      expect(result.data!.endpointConfigName).toBe("my-config");
    });
  });

  describe("deleteEndpoint", () => {
    it("deletes an endpoint", async () => {
      mockSageMakerSend.mockResolvedValueOnce({});
      const result = await manager.deleteEndpoint("my-endpoint");
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // SageMaker — Models & Training Jobs
  // ==========================================================================

  describe("listModels", () => {
    it("returns models", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        Models: [{ ModelName: "my-model", ModelArn: "arn:..." }],
      });

      const result = await manager.listModels();
      expect(result.success).toBe(true);
      expect(result.data![0].name).toBe("my-model");
    });
  });

  describe("describeModel", () => {
    it("returns model details", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        ModelName: "my-model",
        ModelArn: "arn:...",
        CreationTime: new Date("2024-01-01"),
      });

      const result = await manager.describeModel("my-model");
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("my-model");
    });
  });

  describe("listTrainingJobs", () => {
    it("returns training jobs", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        TrainingJobSummaries: [
          {
            TrainingJobName: "job-1",
            TrainingJobArn: "arn:...",
            TrainingJobStatus: "Completed",
          },
        ],
      });

      const result = await manager.listTrainingJobs();
      expect(result.success).toBe(true);
      expect(result.data![0].status).toBe("Completed");
    });
  });

  describe("describeTrainingJob", () => {
    it("returns training job details", async () => {
      mockSageMakerSend.mockResolvedValueOnce({
        TrainingJobName: "job-1",
        TrainingJobArn: "arn:...",
        TrainingJobStatus: "Failed",
        FailureReason: "OOM",
      });

      const result = await manager.describeTrainingJob("job-1");
      expect(result.success).toBe(true);
      expect(result.data!.failureReason).toBe("OOM");
    });
  });

  // ==========================================================================
  // Bedrock
  // ==========================================================================

  describe("listFoundationModels", () => {
    it("returns foundation models", async () => {
      mockBedrockSend.mockResolvedValueOnce({
        modelSummaries: [
          {
            modelId: "anthropic.claude-3-sonnet",
            modelName: "Claude 3 Sonnet",
            providerName: "Anthropic",
            inputModalities: ["TEXT"],
            outputModalities: ["TEXT"],
            responseStreamingSupported: true,
            customizationsSupported: [],
          },
        ],
      });

      const result = await manager.listFoundationModels();
      expect(result.success).toBe(true);
      expect(result.data![0].modelId).toBe("anthropic.claude-3-sonnet");
      expect(result.data![0].providerName).toBe("Anthropic");
    });

    it("filters by provider", async () => {
      mockBedrockSend.mockResolvedValueOnce({ modelSummaries: [] });
      await manager.listFoundationModels("Anthropic");

      const cmd = mockBedrockSend.mock.calls[0][0];
      expect(cmd.input.ByProvider).toBe("Anthropic");
    });
  });

  describe("getFoundationModel", () => {
    it("returns model details", async () => {
      mockBedrockSend.mockResolvedValueOnce({
        modelDetails: {
          modelId: "anthropic.claude-3-sonnet",
          modelName: "Claude 3 Sonnet",
          providerName: "Anthropic",
          inputModalities: ["TEXT"],
          outputModalities: ["TEXT"],
          responseStreamingSupported: true,
          customizationsSupported: [],
        },
      });

      const result = await manager.getFoundationModel("anthropic.claude-3-sonnet");
      expect(result.success).toBe(true);
      expect(result.data!.modelName).toBe("Claude 3 Sonnet");
    });

    it("handles missing model", async () => {
      mockBedrockSend.mockResolvedValueOnce({ modelDetails: null });
      const result = await manager.getFoundationModel("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("invokeModel", () => {
    it("invokes a model and decodes response", async () => {
      const responseBody = JSON.stringify({ completion: "Hello!" });
      mockBedrockRuntimeSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(responseBody),
        contentType: "application/json",
      });

      const result = await manager.invokeModel({
        modelId: "anthropic.claude-3-sonnet",
        body: JSON.stringify({ prompt: "Hello" }),
      });

      expect(result.success).toBe(true);
      expect(result.data!.body).toBe(responseBody);
    });

    it("handles invocation error", async () => {
      mockBedrockRuntimeSend.mockRejectedValueOnce(new Error("Throttled"));
      const result = await manager.invokeModel({
        modelId: "fail",
        body: "{}",
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Throttled");
    });
  });

  // ==========================================================================
  // Comprehend
  // ==========================================================================

  describe("detectSentiment", () => {
    it("detects sentiment", async () => {
      mockComprehendSend.mockResolvedValueOnce({
        Sentiment: "POSITIVE",
        SentimentScore: { Positive: 0.95, Negative: 0.01, Neutral: 0.03, Mixed: 0.01 },
      });

      const result = await manager.detectSentiment("I love this product!");
      expect(result.success).toBe(true);
      expect(result.data!.sentiment).toBe("POSITIVE");
      expect(result.data!.sentimentScore.positive).toBe(0.95);
    });

    it("handles error", async () => {
      mockComprehendSend.mockRejectedValueOnce(new Error("Text too long"));
      const result = await manager.detectSentiment("x".repeat(100001));
      expect(result.success).toBe(false);
    });
  });

  describe("detectEntities", () => {
    it("detects entities", async () => {
      mockComprehendSend.mockResolvedValueOnce({
        Entities: [
          { Text: "Amazon", Type: "ORGANIZATION", Score: 0.99, BeginOffset: 0, EndOffset: 6 },
          { Text: "Seattle", Type: "LOCATION", Score: 0.98, BeginOffset: 20, EndOffset: 27 },
        ],
      });

      const result = await manager.detectEntities("Amazon is based in Seattle");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].type).toBe("ORGANIZATION");
    });
  });

  describe("detectKeyPhrases", () => {
    it("detects key phrases", async () => {
      mockComprehendSend.mockResolvedValueOnce({
        KeyPhrases: [
          { Text: "cloud computing", Score: 0.99, BeginOffset: 0, EndOffset: 15 },
        ],
      });

      const result = await manager.detectKeyPhrases("cloud computing is great");
      expect(result.success).toBe(true);
      expect(result.data![0].text).toBe("cloud computing");
    });
  });

  describe("detectDominantLanguage", () => {
    it("detects languages", async () => {
      mockComprehendSend.mockResolvedValueOnce({
        Languages: [
          { LanguageCode: "en", Score: 0.99 },
          { LanguageCode: "fr", Score: 0.01 },
        ],
      });

      const result = await manager.detectDominantLanguage("Hello world");
      expect(result.success).toBe(true);
      expect(result.data![0].languageCode).toBe("en");
    });
  });

  describe("detectPiiEntities", () => {
    it("detects PII", async () => {
      mockComprehendSend.mockResolvedValueOnce({
        Entities: [
          { Type: "EMAIL", Score: 0.99, BeginOffset: 0, EndOffset: 15 },
        ],
      });

      const result = await manager.detectPiiEntities("user@example.com is my email");
      expect(result.success).toBe(true);
      expect(result.data![0].type).toBe("EMAIL");
    });
  });

  // ==========================================================================
  // Rekognition
  // ==========================================================================

  const testImage = { s3Bucket: "my-bucket", s3Key: "photo.jpg" };

  describe("detectLabels", () => {
    it("detects image labels", async () => {
      mockRekognitionSend.mockResolvedValueOnce({
        Labels: [
          { Name: "Dog", Confidence: 98.5, Parents: [{ Name: "Animal" }], Categories: [{ Name: "Animals" }] },
          { Name: "Animal", Confidence: 99.1, Parents: [], Categories: [{ Name: "Animals" }] },
        ],
      });

      const result = await manager.detectLabels(testImage);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].name).toBe("Dog");
      expect(result.data![0].parents).toContain("Animal");
    });

    it("handles error", async () => {
      mockRekognitionSend.mockRejectedValueOnce(new Error("Image too large"));
      const result = await manager.detectLabels(testImage);
      expect(result.success).toBe(false);
    });
  });

  describe("detectFaces", () => {
    it("detects faces with attributes", async () => {
      mockRekognitionSend.mockResolvedValueOnce({
        FaceDetails: [
          {
            Confidence: 99.9,
            AgeRange: { Low: 25, High: 35 },
            Gender: { Value: "Male", Confidence: 99 },
            Smile: { Value: true, Confidence: 95 },
            Eyeglasses: { Value: false, Confidence: 98 },
            Sunglasses: { Value: false, Confidence: 99 },
            Emotions: [
              { Type: "HAPPY", Confidence: 90 },
              { Type: "CALM", Confidence: 8 },
            ],
          },
        ],
      });

      const result = await manager.detectFaces(testImage);
      expect(result.success).toBe(true);
      expect(result.data![0].ageRange).toEqual({ low: 25, high: 35 });
      expect(result.data![0].emotions).toHaveLength(2);
    });
  });

  describe("detectText", () => {
    it("detects text in image", async () => {
      mockRekognitionSend.mockResolvedValueOnce({
        TextDetections: [
          { DetectedText: "STOP", Type: "WORD", Confidence: 99.5 },
        ],
      });

      const result = await manager.detectText(testImage);
      expect(result.success).toBe(true);
      expect(result.data![0].detectedText).toBe("STOP");
    });
  });

  describe("recognizeCelebrities", () => {
    it("recognizes celebrities", async () => {
      mockRekognitionSend.mockResolvedValueOnce({
        CelebrityFaces: [
          { Name: "Jeff Bezos", MatchConfidence: 99, Urls: ["imdb.com/name/nm1234"] },
        ],
      });

      const result = await manager.recognizeCelebrities(testImage);
      expect(result.success).toBe(true);
      expect(result.data![0].name).toBe("Jeff Bezos");
    });
  });

  describe("detectModerationLabels", () => {
    it("detects moderation labels", async () => {
      mockRekognitionSend.mockResolvedValueOnce({
        ModerationLabels: [
          { Name: "Violence", ParentName: "Explicit Content", Confidence: 85, TaxonomyLevel: 2 },
        ],
      });

      const result = await manager.detectModerationLabels(testImage);
      expect(result.success).toBe(true);
      expect(result.data![0].name).toBe("Violence");
      expect(result.data![0].taxonomyLevel).toBe(2);
    });
  });

  // ==========================================================================
  // Translate
  // ==========================================================================

  describe("translateText", () => {
    it("translates text", async () => {
      mockTranslateSend.mockResolvedValueOnce({
        TranslatedText: "Bonjour le monde",
        SourceLanguageCode: "en",
        TargetLanguageCode: "fr",
      });

      const result = await manager.translateText("Hello world", "en", "fr");
      expect(result.success).toBe(true);
      expect(result.data!.translatedText).toBe("Bonjour le monde");
      expect(result.data!.targetLanguageCode).toBe("fr");
    });

    it("handles translation error", async () => {
      mockTranslateSend.mockRejectedValueOnce(new Error("Unsupported language"));
      const result = await manager.translateText("Hello", "en", "xx");
      expect(result.success).toBe(false);
    });
  });

  describe("listSupportedLanguages", () => {
    it("lists supported languages", async () => {
      mockTranslateSend.mockResolvedValueOnce({
        Languages: [
          { LanguageCode: "en", LanguageName: "English" },
          { LanguageCode: "fr", LanguageName: "French" },
          { LanguageCode: "es", LanguageName: "Spanish" },
        ],
      });

      const result = await manager.listSupportedLanguages();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.data![0].languageName).toBe("English");
    });
  });
});
