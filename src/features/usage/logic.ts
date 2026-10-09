import type { UsageSummaryQuery, UsageTotals } from '@/services/api/usageSummary';

export const USAGE_RANGES = ['today', '7d', '30d', 'all'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const isUsageRange = (value: unknown): value is UsageRange =>
  typeof value === 'string' && (USAGE_RANGES as readonly string[]).includes(value);

const pad2 = (value: number) => String(value).padStart(2, '0');

/** Local-time calendar date as YYYY-MM-DD (not UTC). */
export const toLocalDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const RANGE_DAYS: Record<Exclude<UsageRange, 'all'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
};

/** Range preset → inclusive local-date query. `all` omits both bounds. */
export function rangeToQuery(range: UsageRange, now: Date = new Date()): UsageSummaryQuery {
  if (range === 'all') return {};
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  return { from: toLocalDateKey(start), to: toLocalDateKey(now) };
}

/** `$` with 2 decimals at ≥ $1, 4 decimals below (so small API-equivalent costs stay visible). */
export function formatUsd(value: number, locale?: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  const digits = safe !== 0 && Math.abs(safe) < 1 ? 4 : 2;
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe);
}

/** Exact USD value for hover titles. */
export function formatUsdExact(value: number, locale?: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(safe);
}

export type CostState = 'priced' | 'partial' | 'unpriced';

/** Whether a row's cost covers all, some, or none of its requests. */
export function costState(totals: Pick<UsageTotals, 'requests' | 'unpricedRequests'>): CostState {
  if (totals.unpricedRequests <= 0) return 'priced';
  if (totals.unpricedRequests >= totals.requests) return 'unpriced';
  return 'partial';
}

export type UsageSortKey = 'tokens' | 'cost' | 'requests';
export type SortDirection = 'asc' | 'desc';

const SORT_VALUE: Record<UsageSortKey, (row: UsageTotals) => number> = {
  tokens: (row) => row.totalTokens,
  cost: (row) => row.costUsd,
  requests: (row) => row.requests,
};

export function sortUsageRows<T extends UsageTotals>(
  rows: readonly T[],
  key: UsageSortKey,
  direction: SortDirection
): T[] {
  const read = SORT_VALUE[key];
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => (read(a) - read(b)) * sign);
}
