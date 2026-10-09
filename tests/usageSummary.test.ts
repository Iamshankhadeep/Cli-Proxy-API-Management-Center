import { describe, expect, test } from 'bun:test';
import { normalizeUsageSummary } from '../src/services/api/usageSummary';
import {
  costState,
  formatUsd,
  rangeToQuery,
  sortUsageRows,
  toLocalDateKey,
} from '../src/features/usage/logic';

const totals = (overrides: Record<string, number> = {}) => ({
  requests: 3,
  failed: 1,
  input_tokens: 100,
  output_tokens: 50,
  reasoning_tokens: 0,
  cache_read_tokens: 10,
  cache_write_tokens: 0,
  total_tokens: 160,
  images: 0,
  cost_usd: 0.0123,
  unpriced_requests: 0,
  ...overrides,
});

describe('normalizeUsageSummary', () => {
  test('maps snake_case fields and sorts daily rows by date', () => {
    const summary = normalizeUsageSummary({
      enabled: false,
      since: '2026-10-01T00:00:00Z',
      range: { from: '2026-10-01', to: '2026-10-09' },
      pricing: { source: 'litellm', available: true, updated_at: '2026-10-09T12:00:00Z' },
      totals: totals(),
      accounts: [
        {
          account: 'me@example.com',
          provider: 'claude',
          auth_type: 'oauth',
          ...totals(),
          models: [{ model: 'claude-opus-5', ...totals() }],
        },
      ],
      models: [{ model: 'gpt-image-2', provider: 'codex', ...totals({ images: 4 }) }],
      daily: [
        { date: '2026-10-09', ...totals() },
        { date: '2026-10-08', ...totals() },
      ],
    });

    expect(summary.enabled).toBe(false);
    expect(summary.pricing).toEqual({
      source: 'litellm',
      available: true,
      updatedAt: '2026-10-09T12:00:00Z',
    });
    expect(summary.totals.cacheReadTokens).toBe(10);
    expect(summary.accounts[0].authType).toBe('oauth');
    expect(summary.accounts[0].models[0].model).toBe('claude-opus-5');
    expect(summary.models[0].images).toBe(4);
    expect(summary.daily.map((day) => day.date)).toEqual(['2026-10-08', '2026-10-09']);
  });

  test('tolerates an empty or malformed payload', () => {
    const summary = normalizeUsageSummary(null);
    expect(summary.enabled).toBe(true);
    expect(summary.totals.totalTokens).toBe(0);
    expect(summary.accounts).toEqual([]);
    expect(summary.daily).toEqual([]);
  });
});

describe('usage logic', () => {
  test('range presets use inclusive local dates', () => {
    const now = new Date(2026, 9, 9, 0, 30);
    expect(rangeToQuery('today', now)).toEqual({ from: '2026-10-09', to: '2026-10-09' });
    expect(rangeToQuery('7d', now)).toEqual({ from: '2026-10-03', to: '2026-10-09' });
    expect(rangeToQuery('30d', now)).toEqual({ from: '2026-09-10', to: '2026-10-09' });
    expect(rangeToQuery('all', now)).toEqual({});
    expect(toLocalDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('formats cost with 4 decimals below $1 and 2 above', () => {
    expect(formatUsd(0, 'en-US')).toBe('$0.00');
    expect(formatUsd(0.01234, 'en-US')).toBe('$0.0123');
    expect(formatUsd(12.345, 'en-US')).toBe('$12.35');
  });

  test('classifies pricing coverage', () => {
    expect(costState({ requests: 5, unpricedRequests: 0 })).toBe('priced');
    expect(costState({ requests: 5, unpricedRequests: 2 })).toBe('partial');
    expect(costState({ requests: 5, unpricedRequests: 5 })).toBe('unpriced');
  });

  test('sorts rows by the selected metric', () => {
    const rows = [
      {
        id: 'a',
        ...normalizeUsageSummary({ totals: totals({ total_tokens: 5, cost_usd: 9 }) }).totals,
      },
      {
        id: 'b',
        ...normalizeUsageSummary({ totals: totals({ total_tokens: 50, cost_usd: 1 }) }).totals,
      },
    ];
    expect(sortUsageRows(rows, 'tokens', 'desc').map((row) => row.id)).toEqual(['b', 'a']);
    expect(sortUsageRows(rows, 'cost', 'desc').map((row) => row.id)).toEqual(['a', 'b']);
    expect(sortUsageRows(rows, 'cost', 'asc').map((row) => row.id)).toEqual(['b', 'a']);
  });
});
