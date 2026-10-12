import { apiClient } from './client';
import { normalizeUsageTotals, type UsageModelTotals, type UsageTotals } from './usageSummary';

const USAGE_TIMELINE_TIMEOUT_MS = 20 * 1000;

export interface UsageTimelinePoint extends UsageTotals {
  /** Bucket start, epoch milliseconds. The bucket covers [time, time + stepMs). */
  time: number;
  models: UsageModelTotals[];
}

export interface UsageTimeline {
  enabled: boolean;
  stepMs: number;
  /** Window bounds, epoch milliseconds; `end` is exclusive. */
  start: number;
  end: number;
  retentionMinutes: number;
  pricingAvailable: boolean;
  totals: UsageTotals;
  models: UsageModelTotals[];
  /** Non-empty buckets only, in time order. */
  points: UsageTimelinePoint[];
}

export interface UsageTimelineQuery {
  minutes: number;
  stepMinutes: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asTime = (value: unknown): number => {
  const parsed = Date.parse(asString(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeModel = (value: unknown): UsageModelTotals => {
  const raw = asRecord(value);
  return {
    ...normalizeUsageTotals(raw),
    model: asString(raw.model),
    provider: asString(raw.provider),
  };
};

/** Maps the backend's snake_case `/observability/usage/timeline` payload to UI types. */
export const normalizeUsageTimeline = (value: unknown): UsageTimeline => {
  const raw = asRecord(value);
  const pricing = asRecord(raw.pricing);
  const stepSeconds = Number(raw.step_seconds);
  const retention = Number(raw.retention_minutes);

  return {
    enabled: raw.enabled !== false,
    stepMs: Number.isFinite(stepSeconds) && stepSeconds > 0 ? stepSeconds * 1000 : 60_000,
    start: asTime(raw.start),
    end: asTime(raw.end),
    retentionMinutes: Number.isFinite(retention) && retention > 0 ? retention : 0,
    pricingAvailable: pricing.available === true,
    totals: normalizeUsageTotals(raw.totals),
    models: asArray(raw.models).map(normalizeModel),
    points: asArray(raw.points)
      .map((entry) => {
        const point = asRecord(entry);
        return {
          ...normalizeUsageTotals(point),
          time: asTime(point.t),
          models: asArray(point.models).map(normalizeModel),
        };
      })
      .filter((point) => point.time > 0)
      .sort((a, b) => a.time - b.time),
  };
};

export const usageTimelineApi = {
  getTimeline: async ({ minutes, stepMinutes }: UsageTimelineQuery): Promise<UsageTimeline> => {
    const data = await apiClient.get<unknown>('/observability/usage/timeline', {
      params: { minutes: String(minutes), step: String(stepMinutes) },
      timeout: USAGE_TIMELINE_TIMEOUT_MS,
    });
    return normalizeUsageTimeline(data);
  },
};
