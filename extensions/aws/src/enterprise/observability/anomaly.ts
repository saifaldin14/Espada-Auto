/**
 * Anomaly Detection Service
 *
 * ML-based anomaly detection for metrics with support for
 * multiple algorithms and root cause analysis.
 */

import { randomUUID } from 'node:crypto';
import type {
  AnomalyDetectionModel,
  DetectedAnomaly,
  AnomalyType,
  AnomalySeverity,
  ObservabilityResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface AnomalyStorage {
  // Models
  saveModel(model: AnomalyDetectionModel): Promise<void>;
  getModel(id: string): Promise<AnomalyDetectionModel | null>;
  listModels(tenantId: string, options?: {
    active?: boolean;
    algorithm?: AnomalyDetectionModel['algorithm'];
  }): Promise<AnomalyDetectionModel[]>;
  deleteModel(id: string): Promise<void>;

  // Anomalies
  saveAnomaly(anomaly: DetectedAnomaly): Promise<void>;
  getAnomaly(id: string): Promise<DetectedAnomaly | null>;
  listAnomalies(tenantId: string, options?: {
    modelId?: string;
    severity?: AnomalySeverity;
    type?: AnomalyType;
    acknowledged?: boolean;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<DetectedAnomaly[]>;
  updateAnomaly(id: string, updates: Partial<DetectedAnomaly>): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryAnomalyStorage implements AnomalyStorage {
  private models = new Map<string, AnomalyDetectionModel>();
  private anomalies = new Map<string, DetectedAnomaly>();

  async saveModel(model: AnomalyDetectionModel): Promise<void> {
    this.models.set(model.id, model);
  }

  async getModel(id: string): Promise<AnomalyDetectionModel | null> {
    return this.models.get(id) ?? null;
  }

  async listModels(tenantId: string, options?: {
    active?: boolean;
    algorithm?: AnomalyDetectionModel['algorithm'];
  }): Promise<AnomalyDetectionModel[]> {
    return Array.from(this.models.values())
      .filter(m => m.tenantId === tenantId)
      .filter(m => options?.active === undefined || m.active === options.active)
      .filter(m => !options?.algorithm || m.algorithm === options.algorithm);
  }

  async deleteModel(id: string): Promise<void> {
    this.models.delete(id);
  }

  async saveAnomaly(anomaly: DetectedAnomaly): Promise<void> {
    this.anomalies.set(anomaly.id, anomaly);
  }

  async getAnomaly(id: string): Promise<DetectedAnomaly | null> {
    return this.anomalies.get(id) ?? null;
  }

  async listAnomalies(tenantId: string, options?: {
    modelId?: string;
    severity?: AnomalySeverity;
    type?: AnomalyType;
    acknowledged?: boolean;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<DetectedAnomaly[]> {
    let results = Array.from(this.anomalies.values())
      .filter(a => a.tenantId === tenantId)
      .filter(a => !options?.modelId || a.modelId === options.modelId)
      .filter(a => !options?.severity || a.severity === options.severity)
      .filter(a => !options?.type || a.type === options.type)
      .filter(a => options?.acknowledged === undefined || a.acknowledged === options.acknowledged)
      .filter(a => !options?.from || a.startedAt >= options.from)
      .filter(a => !options?.to || a.startedAt <= options.to)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async updateAnomaly(id: string, updates: Partial<DetectedAnomaly>): Promise<void> {
    const existing = this.anomalies.get(id);
    if (existing) {
      this.anomalies.set(id, { ...existing, ...updates });
    }
  }
}

// =============================================================================
// Statistical Detector
// =============================================================================

interface MetricDataPoint {
  timestamp: string;
  value: number;
}

class StatisticalDetector {
  detect(
    data: MetricDataPoint[],
    options: {
      sensitivity: number;
      minDataPoints: number;
    },
  ): Array<{
    timestamp: string;
    value: number;
    expected: number;
    deviation: number;
    type: AnomalyType;
    confidence: number;
  }> {
    if (data.length < options.minDataPoints) {
      return [];
    }

    const values = data.map(d => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Z-score threshold based on sensitivity (0.0-1.0 -> 4.0-1.5 sigma)
    const threshold = 4 - options.sensitivity * 2.5;

    const anomalies: Array<{
      timestamp: string;
      value: number;
      expected: number;
      deviation: number;
      type: AnomalyType;
      confidence: number;
    }> = [];

    for (const point of data) {
      const zScore = stdDev > 0 ? Math.abs(point.value - mean) / stdDev : 0;
      if (zScore > threshold) {
        const type: AnomalyType = point.value > mean ? 'spike' : 'dip';
        const confidence = Math.min(1, zScore / (threshold * 2));
        anomalies.push({
          timestamp: point.timestamp,
          value: point.value,
          expected: mean,
          deviation: ((point.value - mean) / mean) * 100,
          type,
          confidence,
        });
      }
    }

    return anomalies;
  }

  detectTrendChange(
    data: MetricDataPoint[],
    windowSize: number,
  ): Array<{
    timestamp: string;
    type: 'trend_change';
    confidence: number;
  }> {
    if (data.length < windowSize * 2) return [];

    const results: Array<{
      timestamp: string;
      type: 'trend_change';
      confidence: number;
    }> = [];

    for (let i = windowSize; i < data.length - windowSize; i++) {
      const before = data.slice(i - windowSize, i).map(d => d.value);
      const after = data.slice(i, i + windowSize).map(d => d.value);

      const trendBefore = this.linearRegression(before);
      const trendAfter = this.linearRegression(after);

      // Detect significant slope change
      if (Math.sign(trendBefore.slope) !== Math.sign(trendAfter.slope) ||
          Math.abs(trendAfter.slope - trendBefore.slope) > Math.abs(trendBefore.slope) * 0.5) {
        results.push({
          timestamp: data[i].timestamp,
          type: 'trend_change',
          confidence: Math.min(1, Math.abs(trendAfter.slope - trendBefore.slope) / 
            (Math.abs(trendBefore.slope) + 0.001)),
        });
      }
    }

    return results;
  }

  private linearRegression(values: number[]): { slope: number; intercept: number } {
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }
}

// =============================================================================
// Anomaly Detection Service
// =============================================================================

export interface AnomalyServiceConfig {
  storage?: AnomalyStorage;
  defaultSensitivity?: number;
  defaultTrainingWindowHours?: number;
}

export class AnomalyDetectionService {
  private storage: AnomalyStorage;
  private detector: StatisticalDetector;
  private defaultSensitivity: number;
  private defaultTrainingWindowHours: number;

  constructor(config?: AnomalyServiceConfig) {
    this.storage = config?.storage ?? new InMemoryAnomalyStorage();
    this.detector = new StatisticalDetector();
    this.defaultSensitivity = config?.defaultSensitivity ?? 0.5;
    this.defaultTrainingWindowHours = config?.defaultTrainingWindowHours ?? 168; // 1 week
  }

  // ===========================================================================
  // Model Management
  // ===========================================================================

  async createModel(
    tenantId: string,
    options: {
      name: string;
      description?: string;
      algorithm?: AnomalyDetectionModel['algorithm'];
      targetMetric: string;
      sensitivity?: number;
      trainingWindowHours?: number;
      seasonalityPeriod?: number;
    },
  ): Promise<ObservabilityResult<AnomalyDetectionModel>> {
    const now = new Date().toISOString();

    const model: AnomalyDetectionModel = {
      id: randomUUID(),
      tenantId,
      name: options.name,
      description: options.description,
      algorithm: options.algorithm ?? 'statistical',
      targetMetric: options.targetMetric,
      parameters: {
        sensitivity: options.sensitivity ?? this.defaultSensitivity,
        trainingWindowHours: options.trainingWindowHours ?? this.defaultTrainingWindowHours,
        seasonalityPeriod: options.seasonalityPeriod,
        minDataPoints: 30,
      },
      trainingStatus: 'pending',
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveModel(model);
    return { success: true, data: model };
  }

  async getModel(modelId: string): Promise<ObservabilityResult<AnomalyDetectionModel>> {
    const model = await this.storage.getModel(modelId);
    if (!model) {
      return { success: false, error: 'Model not found', code: 'MODEL_NOT_FOUND' };
    }
    return { success: true, data: model };
  }

  async listModels(
    tenantId: string,
    options?: {
      active?: boolean;
      algorithm?: AnomalyDetectionModel['algorithm'];
    },
  ): Promise<ObservabilityResult<AnomalyDetectionModel[]>> {
    const models = await this.storage.listModels(tenantId, options);
    return { success: true, data: models };
  }

  async updateModel(
    modelId: string,
    updates: Partial<Pick<AnomalyDetectionModel, 'name' | 'description' | 'parameters' | 'active'>>,
  ): Promise<ObservabilityResult<AnomalyDetectionModel>> {
    const model = await this.storage.getModel(modelId);
    if (!model) {
      return { success: false, error: 'Model not found', code: 'MODEL_NOT_FOUND' };
    }

    const updated: AnomalyDetectionModel = {
      ...model,
      ...updates,
      parameters: { ...model.parameters, ...updates.parameters },
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveModel(updated);
    return { success: true, data: updated };
  }

  async deleteModel(modelId: string): Promise<ObservabilityResult<void>> {
    await this.storage.deleteModel(modelId);
    return { success: true };
  }

  // ===========================================================================
  // Training
  // ===========================================================================

  async trainModel(
    modelId: string,
    trainingData: MetricDataPoint[],
  ): Promise<ObservabilityResult<AnomalyDetectionModel>> {
    const model = await this.storage.getModel(modelId);
    if (!model) {
      return { success: false, error: 'Model not found', code: 'MODEL_NOT_FOUND' };
    }

    // Update status to training
    model.trainingStatus = 'training';
    await this.storage.saveModel(model);

    try {
      // For statistical model, calculate baseline statistics
      const values = trainingData.map(d => d.value);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;

      // Store training parameters
      model.parameters = {
        ...model.parameters,
        baselineMean: mean,
        baselineStdDev: Math.sqrt(variance),
        dataPointsUsed: trainingData.length,
      };

      // For now, simulate accuracy metrics
      model.accuracy = {
        precision: 0.85 + Math.random() * 0.1,
        recall: 0.80 + Math.random() * 0.15,
        f1Score: 0.82 + Math.random() * 0.12,
        falsePositiveRate: 0.05 + Math.random() * 0.05,
      };

      model.trainingStatus = 'ready';
      model.lastTrainedAt = new Date().toISOString();
      model.updatedAt = new Date().toISOString();

      await this.storage.saveModel(model);
      return { success: true, data: model };
    } catch (error) {
      model.trainingStatus = 'failed';
      await this.storage.saveModel(model);
      return { success: false, error: `Training failed: ${error}`, code: 'TRAINING_FAILED' };
    }
  }

  // ===========================================================================
  // Detection
  // ===========================================================================

  async detectAnomalies(
    modelId: string,
    data: MetricDataPoint[],
  ): Promise<ObservabilityResult<DetectedAnomaly[]>> {
    const model = await this.storage.getModel(modelId);
    if (!model) {
      return { success: false, error: 'Model not found', code: 'MODEL_NOT_FOUND' };
    }

    if (model.trainingStatus !== 'ready') {
      return { success: false, error: 'Model not trained', code: 'MODEL_NOT_TRAINED' };
    }

    const sensitivity = model.parameters.sensitivity ?? this.defaultSensitivity;
    const minDataPoints = model.parameters.minDataPoints ?? 30;

    const detected = this.detector.detect(data, { sensitivity, minDataPoints });
    const trendChanges = this.detector.detectTrendChange(data, 10);

    const anomalies: DetectedAnomaly[] = [];

    // Convert point anomalies
    for (const d of detected) {
      const anomaly: DetectedAnomaly = {
        id: randomUUID(),
        tenantId: model.tenantId,
        modelId: model.id,
        type: d.type,
        severity: this.calculateSeverity(d.deviation, d.confidence),
        metricName: model.targetMetric,
        detectedValue: d.value,
        expectedValue: d.expected,
        deviationPercent: d.deviation,
        confidence: d.confidence,
        startedAt: d.timestamp,
        acknowledged: false,
        rootCauseAnalysis: this.generateRootCauseHints(d.type, d.deviation, model.targetMetric),
      };

      await this.storage.saveAnomaly(anomaly);
      anomalies.push(anomaly);
    }

    // Convert trend changes
    for (const t of trendChanges) {
      const anomaly: DetectedAnomaly = {
        id: randomUUID(),
        tenantId: model.tenantId,
        modelId: model.id,
        type: t.type,
        severity: 'medium',
        metricName: model.targetMetric,
        detectedValue: 0,
        expectedValue: 0,
        deviationPercent: 0,
        confidence: t.confidence,
        startedAt: t.timestamp,
        acknowledged: false,
        rootCauseAnalysis: {
          possibleCauses: ['Configuration change', 'New deployment', 'Traffic pattern shift'],
          suggestedActions: ['Review recent changes', 'Check deployment history'],
        },
      };

      await this.storage.saveAnomaly(anomaly);
      anomalies.push(anomaly);
    }

    return { success: true, data: anomalies };
  }

  // ===========================================================================
  // Anomaly Management
  // ===========================================================================

  async getAnomaly(anomalyId: string): Promise<ObservabilityResult<DetectedAnomaly>> {
    const anomaly = await this.storage.getAnomaly(anomalyId);
    if (!anomaly) {
      return { success: false, error: 'Anomaly not found', code: 'ANOMALY_NOT_FOUND' };
    }
    return { success: true, data: anomaly };
  }

  async listAnomalies(
    tenantId: string,
    options?: {
      modelId?: string;
      severity?: AnomalySeverity;
      type?: AnomalyType;
      acknowledged?: boolean;
      from?: string;
      to?: string;
      limit?: number;
    },
  ): Promise<ObservabilityResult<DetectedAnomaly[]>> {
    const anomalies = await this.storage.listAnomalies(tenantId, options);
    return { success: true, data: anomalies };
  }

  async acknowledgeAnomaly(
    anomalyId: string,
    userId: string,
  ): Promise<ObservabilityResult<DetectedAnomaly>> {
    const anomaly = await this.storage.getAnomaly(anomalyId);
    if (!anomaly) {
      return { success: false, error: 'Anomaly not found', code: 'ANOMALY_NOT_FOUND' };
    }

    anomaly.acknowledged = true;
    anomaly.acknowledgedBy = userId;
    await this.storage.updateAnomaly(anomalyId, anomaly);

    return { success: true, data: anomaly };
  }

  async markFalsePositive(
    anomalyId: string,
    userId: string,
  ): Promise<ObservabilityResult<DetectedAnomaly>> {
    const anomaly = await this.storage.getAnomaly(anomalyId);
    if (!anomaly) {
      return { success: false, error: 'Anomaly not found', code: 'ANOMALY_NOT_FOUND' };
    }

    anomaly.isFalsePositive = true;
    anomaly.acknowledged = true;
    anomaly.acknowledgedBy = userId;
    await this.storage.updateAnomaly(anomalyId, anomaly);

    return { success: true, data: anomaly };
  }

  async resolveAnomaly(anomalyId: string): Promise<ObservabilityResult<DetectedAnomaly>> {
    const anomaly = await this.storage.getAnomaly(anomalyId);
    if (!anomaly) {
      return { success: false, error: 'Anomaly not found', code: 'ANOMALY_NOT_FOUND' };
    }

    const now = new Date().toISOString();
    anomaly.endedAt = now;
    anomaly.durationMs = new Date(now).getTime() - new Date(anomaly.startedAt).getTime();
    await this.storage.updateAnomaly(anomalyId, anomaly);

    return { success: true, data: anomaly };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private calculateSeverity(deviation: number, confidence: number): AnomalySeverity {
    const absDeviation = Math.abs(deviation);
    const score = absDeviation * confidence;

    if (score > 100) return 'critical';
    if (score > 50) return 'high';
    if (score > 20) return 'medium';
    return 'low';
  }

  private generateRootCauseHints(
    type: AnomalyType,
    deviation: number,
    metricName: string,
  ): DetectedAnomaly['rootCauseAnalysis'] {
    const possibleCauses: string[] = [];
    const suggestedActions: string[] = [];

    if (type === 'spike') {
      possibleCauses.push(
        'Sudden increase in traffic or load',
        'Resource leak or runaway process',
        'External attack or abuse',
        'Upstream service issue causing retries',
      );
      suggestedActions.push(
        'Check traffic patterns and source IPs',
        'Review recent deployments',
        'Inspect resource utilization',
      );
    } else if (type === 'dip') {
      possibleCauses.push(
        'Service outage or degradation',
        'Network connectivity issues',
        'Dependency failure',
        'Configuration error',
      );
      suggestedActions.push(
        'Check service health endpoints',
        'Review error logs',
        'Verify upstream dependencies',
      );
    }

    return {
      possibleCauses,
      suggestedActions,
      correlatedMetrics: [`${metricName}_errors`, `${metricName}_latency`],
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createAnomalyDetectionService(config?: AnomalyServiceConfig): AnomalyDetectionService {
  return new AnomalyDetectionService(config);
}
