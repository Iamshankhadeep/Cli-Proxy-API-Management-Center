import type { UsageModelTotals, UsageTotals } from '@/services/api/usageSummary';
import type { UsageTimeline, UsageTimelinePoint } from '@/services/api/usageTimeline';

export const TIMELINE_WINDOWS = ['1h', '6h', '24h', '7d'] as const;
export type TimelineWindow = (typeof TIMELINE_WINDOWS)[number];

export const WINDOW_MINUTES: Record<TimelineWindow, number> = {
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10080,
};

/** Default bucket per window: ~60–170 buckets, so bars stay readable. */
export const DEFAULT_STEP: Record<TimelineWindow, number> = {
  '1h': 1,
  '6h': 5,
  '24h': 15,
  '7d': 60,
};

export const TIMELINE_STEPS = [1, 5, 15, 60] as const;

/** Mirrors the backend cap (`usagestats.TimelineMaxPoints`). */
export const TIMELINE_MAX_POINTS = 1440;

export const isTimelineWindow = (value: unknown): value is TimelineWindow =>
  typeof value === 'string' && (TIMELINE_WINDOWS as readonly string[]).includes(value);

/** Steps the backend accepts for a window: finer than the window, at most 1440 buckets. */
export const stepsForWindow = (window: TimelineWindow): number[] =>
  TIMELINE_STEPS.filter(
    (step) => step < WINDOW_MINUTES[window] && WINDOW_MINUTES[window] / step <= TIMELINE_MAX_POINTS
  );

export const TIMELINE_METRICS = ['tokens', 'cost', 'requests'] as const;
export type TimelineMetric = (typeof TIMELINE_METRICS)[number];

export const TIMELINE_VIEWS = ['stacked', 'lines', 'heatmap'] as const;
export type TimelineView = (typeof TIMELINE_VIEWS)[number];

export const metricValue = (totals: UsageTotals, metric: TimelineMetric): number =>
  metric === 'cost' ? totals.costUsd : metric === 'requests' ? totals.requests : totals.totalTokens;

/**
 * Colored categorical slots before the tail folds into "Other". An eighth model keeps its own
 * slot (8) rather than becoming a one-member "Other".
 */
export const MAX_NAMED_SERIES = 7;
export const OTHER_SERIES_KEY = '__other__';

export interface TimelineSeries {
  key: string;
  model: string;
  provider: string;
  /** 1-based categorical slot, or null for the neutral "Other" series. */
  slot: number | null;
  /** Window total for the active metric. */
  total: number;
  /** Models folded into "Other" (empty for named series). */
  members: string[];
}

/** CSS color for a series; slots map to `--series-N` in UsageTimeline.module.scss. */
export const seriesColor = (series: Pick<TimelineSeries, 'slot'>) =>
  series.slot === null ? 'var(--series-other)' : `var(--series-${series.slot})`;

export const seriesLabel = (series: TimelineSeries, otherLabel: string) =>
  series.slot === null ? otherLabel : series.model;

export interface TimelineBucket {
  time: number;
  /** Per-series metric value, aligned with `TimelineView.series`. */
  values: number[];
  /** Raw point, or null when the bucket had no usage. */
  point: UsageTimelinePoint | null;
}

export interface TimelineViewModel {
  series: TimelineSeries[];
  buckets: TimelineBucket[];
  stepMs: number;
}

const modelKey = (model: Pick<UsageModelTotals, 'model' | 'provider'>) =>
  `${model.provider}\u0000${model.model}`;

/**
 * Builds dense, gap-filled buckets for the window and assigns colors. Slots follow window token
 * rank, not the active metric, so switching metric or hiding a series never repaints the others.
 */
export function buildTimelineView(
  timeline: UsageTimeline,
  metric: TimelineMetric,
  maxNamed: number = MAX_NAMED_SERIES
): TimelineViewModel {
  const ranked = [...timeline.models].sort(
    (a, b) =>
      b.totalTokens - a.totalTokens || b.requests - a.requests || a.model.localeCompare(b.model)
  );
  // Only fold when it saves at least two rows; "Other" holding one model just hides its name.
  const namedCount = ranked.length > maxNamed + 1 ? maxNamed : ranked.length;

  const series: TimelineSeries[] = ranked.slice(0, namedCount).map((model, index) => ({
    key: modelKey(model),
    model: model.model,
    provider: model.provider,
    slot: index + 1,
    total: metricValue(model, metric),
    members: [],
  }));
  const folded = ranked.slice(namedCount);
  if (folded.length > 0) {
    series.push({
      key: OTHER_SERIES_KEY,
      model: '',
      provider: '',
      slot: null,
      total: folded.reduce((sum, model) => sum + metricValue(model, metric), 0),
      members: folded.map((model) => model.model),
    });
  }

  const indexByKey = new Map(series.map((entry, index) => [entry.key, index]));
  const otherIndex = indexByKey.get(OTHER_SERIES_KEY);
  const pointByTime = new Map(timeline.points.map((point) => [point.time, point]));

  const buckets: TimelineBucket[] = [];
  const { start, end, stepMs } = timeline;
  if (stepMs > 0 && end > start) {
    for (let time = start; time < end; time += stepMs) {
      const point = pointByTime.get(time) ?? null;
      const values = new Array<number>(series.length).fill(0);
      point?.models.forEach((model) => {
        const index = indexByKey.get(modelKey(model)) ?? otherIndex;
        if (index !== undefined) values[index] += metricValue(model, metric);
      });
      buckets.push({ time, values, point });
    }
  }

  return { series, buckets, stepMs };
}

/** Largest bucket value: the stacked sum, or the single tallest series. */
export function peakValue(
  buckets: readonly TimelineBucket[],
  visible: readonly boolean[],
  mode: 'stacked' | 'single'
): number {
  let peak = 0;
  for (const bucket of buckets) {
    let sum = 0;
    bucket.values.forEach((value, index) => {
      if (!visible[index]) return;
      if (mode === 'stacked') sum += value;
      else peak = Math.max(peak, value);
    });
    peak = Math.max(peak, sum);
  }
  return peak;
}

/** Busiest bucket by the visible series' combined value, or null when the window is idle. */
export function busiestBucket(
  buckets: readonly TimelineBucket[],
  visible: readonly boolean[]
): { bucket: TimelineBucket; value: number } | null {
  let best: { bucket: TimelineBucket; value: number } | null = null;
  for (const bucket of buckets) {
    const value = bucket.values.reduce((sum, v, index) => (visible[index] ? sum + v : sum), 0);
    if (value > 0 && (!best || value > best.value)) best = { bucket, value };
  }
  return best;
}

/** Evenly spaced bucket indexes for x-axis labels, always including both ends. */
export function xTickIndexes(count: number, maxTicks: number): number[] {
  if (count <= 0) return [];
  if (count === 1 || maxTicks <= 1) return [0];
  const ticks = Math.min(count, maxTicks);
  const out = new Set<number>();
  for (let i = 0; i < ticks; i += 1) {
    out.add(Math.round((i * (count - 1)) / (ticks - 1)));
  }
  return [...out];
}
