import { apiClient } from './client';

const USAGE_SUMMARY_TIMEOUT_MS = 20 * 1000;

export interface UsageTotals {
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  images: number;
  costUsd: number;
  unpricedRequests: number;
}

export interface UsageModelTotals extends UsageTotals {
  model: string;
  provider: string;
}

export interface UsageAccountTotals extends UsageTotals {
  account: string;
  provider: string;
  authType: string;
  models: UsageModelTotals[];
}

export interface UsageDailyTotals extends UsageTotals {
  date: string;
}

export interface UsageSummary {
  enabled: boolean;
  since: string;
  range: { from: string; to: string };
  pricing: { source: string; available: boolean; updatedAt: string };
  totals: UsageTotals;
  accounts: UsageAccountTotals[];
  models: UsageModelTotals[];
  daily: UsageDailyTotals[];
}

export interface UsageSummaryQuery {
  from?: string;
  to?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeUsageTotals = (value: unknown): UsageTotals => {
  const raw = asRecord(value);
  return {
    requests: asNumber(raw.requests),
    failed: asNumber(raw.failed),
    inputTokens: asNumber(raw.input_tokens),
    outputTokens: asNumber(raw.output_tokens),
    reasoningTokens: asNumber(raw.reasoning_tokens),
    cacheReadTokens: asNumber(raw.cache_read_tokens),
    cacheWriteTokens: asNumber(raw.cache_write_tokens),
    totalTokens: asNumber(raw.total_tokens),
    images: asNumber(raw.images),
    costUsd: asNumber(raw.cost_usd),
    unpricedRequests: asNumber(raw.unpriced_requests),
  };
};

const normalizeModel = (value: unknown): UsageModelTotals => {
  const raw = asRecord(value);
  return {
    ...normalizeUsageTotals(raw),
    model: asString(raw.model),
    provider: asString(raw.provider),
  };
};

/** Maps the backend's snake_case `/observability/usage/summary` payload to UI types. */
export const normalizeUsageSummary = (value: unknown): UsageSummary => {
  const raw = asRecord(value);
  const range = asRecord(raw.range);
  const pricing = asRecord(raw.pricing);

  return {
    enabled: raw.enabled !== false,
    since: asString(raw.since),
    range: { from: asString(range.from), to: asString(range.to) },
    pricing: {
      source: asString(pricing.source),
      available: pricing.available === true,
      updatedAt: asString(pricing.updated_at),
    },
    totals: normalizeUsageTotals(raw.totals),
    accounts: asArray(raw.accounts).map((entry) => {
      const account = asRecord(entry);
      return {
        ...normalizeUsageTotals(account),
        account: asString(account.account),
        provider: asString(account.provider),
        authType: asString(account.auth_type),
        models: asArray(account.models).map(normalizeModel),
      };
    }),
    models: asArray(raw.models).map(normalizeModel),
    daily: asArray(raw.daily)
      .map((entry) => {
        const day = asRecord(entry);
        return { ...normalizeUsageTotals(day), date: asString(day.date) };
      })
      .filter((day) => day.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
};

export const usageSummaryApi = {
  getSummary: async (query: UsageSummaryQuery = {}): Promise<UsageSummary> => {
    const params: Record<string, string> = {};
    if (query.from) params.from = query.from;
    if (query.to) params.to = query.to;
    const data = await apiClient.get<unknown>('/observability/usage/summary', {
      params,
      timeout: USAGE_SUMMARY_TIMEOUT_MS,
    });
    return normalizeUsageSummary(data);
  },
};
