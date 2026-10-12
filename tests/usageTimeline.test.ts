import { describe, expect, test } from 'bun:test';
import { normalizeUsageTimeline } from '../src/services/api/usageTimeline';
import {
  OTHER_SERIES_KEY,
  buildTimelineView,
  busiestBucket,
  peakValue,
  stepsForWindow,
  xTickIndexes,
} from '../src/features/usage/timeline';

const model = (name: string, tokens: number, cost = 0, requests = 1) => ({
  model: name,
  provider: 'claude',
  requests,
  total_tokens: tokens,
  cost_usd: cost,
});

const start = Date.parse('2026-10-13T14:00:00+05:30');
const minute = 60_000;

const payload = (models: ReturnType<typeof model>[], points: unknown[]) => ({
  enabled: true,
  step_seconds: 60,
  start: '2026-10-13T14:00:00+05:30',
  end: '2026-10-13T14:05:00+05:30',
  retention_minutes: 10080,
  pricing: { available: true },
  totals: {},
  models,
  points,
});

describe('normalizeUsageTimeline', () => {
  test('parses times and sorts points', () => {
    const timeline = normalizeUsageTimeline(
      payload(
        [model('a', 10)],
        [
          { t: '2026-10-13T14:03:00+05:30', total_tokens: 3, models: [model('a', 3)] },
          { t: '2026-10-13T14:01:00+05:30', total_tokens: 1, models: [model('a', 1)] },
          { t: 'garbage' },
        ]
      )
    );
    expect(timeline.stepMs).toBe(minute);
    expect(timeline.start).toBe(start);
    expect(timeline.end).toBe(start + 5 * minute);
    expect(timeline.points.map((p) => p.time)).toEqual([start + minute, start + 3 * minute]);
    expect(timeline.points[0].models[0].totalTokens).toBe(1);
  });
});

describe('buildTimelineView', () => {
  const timeline = normalizeUsageTimeline(
    payload(
      [model('big', 900, 2), model('mid', 90, 1), model('small', 9), model('tiny', 1)],
      [
        {
          t: '2026-10-13T14:01:00+05:30',
          models: [model('big', 500, 1), model('small', 9), model('tiny', 1)],
        },
        { t: '2026-10-13T14:04:00+05:30', models: [model('big', 400, 1), model('mid', 90, 1)] },
      ]
    )
  );

  test('fills gaps and folds the tail into Other', () => {
    const view = buildTimelineView(timeline, 'tokens', 2);
    expect(view.buckets).toHaveLength(5);
    expect(view.series.map((s) => s.key.split('\u0000')[1] ?? s.key)).toEqual([
      'big',
      'mid',
      OTHER_SERIES_KEY,
    ]);
    expect(view.series[2].members).toEqual(['small', 'tiny']);
    expect(view.series[2].total).toBe(10);
    expect(view.buckets[1].values).toEqual([500, 0, 10]);
    expect(view.buckets[0].point).toBeNull();
    expect(view.buckets[4].values).toEqual([400, 90, 0]);
  });

  test('does not fold a single leftover model', () => {
    const view = buildTimelineView(timeline, 'tokens', 3);
    expect(view.series.map((s) => s.slot)).toEqual([1, 2, 3, 4]);
  });

  test('keeps slots by token rank when the metric changes', () => {
    const view = buildTimelineView(timeline, 'cost', 7);
    expect(view.series[0].model).toBe('big');
    expect(view.series[0].total).toBe(2);
    expect(view.buckets[4].values[1]).toBe(1);
  });

  test('peaks and busiest bucket respect visibility', () => {
    const view = buildTimelineView(timeline, 'tokens', 7);
    const all = view.series.map(() => true);
    expect(peakValue(view.buckets, all, 'stacked')).toBe(510);
    expect(peakValue(view.buckets, all, 'single')).toBe(500);
    const withoutBig = all.map((_, i) => i !== 0);
    expect(peakValue(view.buckets, withoutBig, 'stacked')).toBe(90);
    expect(busiestBucket(view.buckets, withoutBig)?.bucket.time).toBe(start + 4 * minute);
  });
});

describe('timeline helpers', () => {
  test('stepsForWindow respects the 1440-bucket cap', () => {
    expect(stepsForWindow('1h')).toEqual([1, 5, 15]);
    expect(stepsForWindow('24h')).toEqual([1, 5, 15, 60]);
    expect(stepsForWindow('7d')).toEqual([15, 60]);
  });

  test('xTickIndexes includes both ends', () => {
    expect(xTickIndexes(60, 4)).toEqual([0, 20, 39, 59]);
    expect(xTickIndexes(1, 5)).toEqual([0]);
    expect(xTickIndexes(0, 5)).toEqual([]);
  });
});
