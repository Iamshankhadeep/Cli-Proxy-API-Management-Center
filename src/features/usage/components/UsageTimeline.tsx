/**
 * Activity timeline: per-model usage in 1/5/15/60-minute buckets over a rolling window, from
 * `GET /v8/management/observability/usage/timeline`. The backend keeps minute buckets for 7 days.
 *
 * Contracts:
 * - Windows end at the server's current minute; the panel refetches every 30s while visible.
 * - `refreshKey` changes when the page-level refresh runs.
 * - Hiding a series removes it from scales and totals but keeps every other series' color.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInterval } from '@/hooks/useInterval';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { apiClient, usageTimelineApi, type UsageTimeline as TimelineData } from '@/services/api';
import { useAuthStore } from '@/stores';
import { formatCompactNumber } from '@/utils/format';
import { formatUsd } from '../logic';
import {
  DEFAULT_STEP,
  TIMELINE_METRICS,
  TIMELINE_VIEWS,
  TIMELINE_WINDOWS,
  WINDOW_MINUTES,
  buildTimelineView,
  busiestBucket,
  isTimelineWindow,
  seriesColor,
  seriesLabel,
  stepsForWindow,
  type TimelineMetric,
  type TimelineView,
  type TimelineWindow,
} from '../timeline';
import { TimelineChart } from './TimelineChart';
import pageStyles from '../UsagePage.module.scss';
import styles from './UsageTimeline.module.scss';

const AUTO_REFRESH_MS = 30 * 1000;

const STEP_LABEL: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 60: '1h' };

interface UsageTimelineProps {
  refreshKey: number;
}

export function UsageTimeline({ refreshKey }: UsageTimelineProps) {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);

  const [storedWindow, setTimeWindow] = useLocalStorage<string>('usage.timeline.window', '1h');
  const timeWindow: TimelineWindow = isTimelineWindow(storedWindow) ? storedWindow : '1h';
  const [stepByWindow, setStepByWindow] = useState<Partial<Record<TimelineWindow, number>>>({});
  const allowedSteps = stepsForWindow(timeWindow);
  const requestedStep = stepByWindow[timeWindow] ?? DEFAULT_STEP[timeWindow];
  const step = allowedSteps.includes(requestedStep) ? requestedStep : DEFAULT_STEP[timeWindow];

  const [storedMetric, setMetric] = useLocalStorage<string>('usage.timeline.metric', 'tokens');
  const metric: TimelineMetric = (TIMELINE_METRICS as readonly string[]).includes(storedMetric)
    ? (storedMetric as TimelineMetric)
    : 'tokens';
  const [storedView, setView] = useLocalStorage<string>('usage.timeline.view', 'stacked');
  const view: TimelineView = (TIMELINE_VIEWS as readonly string[]).includes(storedView)
    ? (storedView as TimelineView)
    : 'stacked';

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const requestId = ++requestRef.current;
      if (connectionStatus !== 'connected') return;
      const revision = apiClient.getConnectionRevision();
      const isCurrent = () =>
        requestId === requestRef.current && revision === apiClient.getConnectionRevision();
      if (!quiet) setLoading(true);
      try {
        const next = await usageTimelineApi.getTimeline({
          minutes: WINDOW_MINUTES[timeWindow],
          stepMinutes: step,
        });
        if (!isCurrent()) return;
        setData(next);
        setError('');
      } catch (err: unknown) {
        if (!isCurrent()) return;
        setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [connectionStatus, step, t, timeWindow]
  );

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setData(null);
  }, [apiBase]);

  useInterval(() => {
    if (document.visibilityState === 'visible') void load(true);
  }, AUTO_REFRESH_MS);

  const model = useMemo(() => (data ? buildTimelineView(data, metric) : null), [data, metric]);
  const visible = useMemo(
    () => (model ? model.series.map((entry) => !hidden.has(entry.key)) : []),
    [hidden, model]
  );

  const formatValue = (value: number) =>
    metric === 'cost' ? formatUsd(value, i18n.language) : formatCompactNumber(value);
  const timeFormat = new Intl.DateTimeFormat(i18n.language, {
    weekday: timeWindow === '7d' ? 'short' : undefined,
    hour: '2-digit',
    minute: '2-digit',
  });

  const toggleSeries = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const busiest = model ? busiestBucket(model.buckets, visible) : null;
  const visibleTotal = model
    ? model.series.reduce((sum, entry, index) => (visible[index] ? sum + entry.total : sum), 0)
    : 0;
  const activeBuckets = model ? model.buckets.filter((bucket) => bucket.point).length : 0;
  const otherLabel = t('usage.timeline_other');
  const metricUnavailable = metric === 'cost' && data !== null && !data.pricingAvailable;

  return (
    <section className={`${pageStyles.panel} ${styles.timeline}`}>
      <header className={pageStyles.panelHead}>
        <div className={pageStyles.panelCopy}>
          <h2 className={pageStyles.panelTitle}>{t('usage.timeline_title')}</h2>
          <p className={pageStyles.panelDescription}>
            {t('usage.timeline_description', {
              days: data ? Math.round(data.retentionMinutes / 1440) : 7,
            })}
          </p>
        </div>
        <div className={pageStyles.segmented} role="group" aria-label={t('usage.timeline_view')}>
          {TIMELINE_VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${pageStyles.segment} ${view === value ? pageStyles.segmentActive : ''}`}
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              {t(`usage.timeline_view_${value}`)}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={pageStyles.segmented} role="group" aria-label={t('usage.timeline_window')}>
          {TIMELINE_WINDOWS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${pageStyles.segment} ${timeWindow === value ? pageStyles.segmentActive : ''}`}
              aria-pressed={timeWindow === value}
              onClick={() => setTimeWindow(value)}
            >
              {t(`usage.timeline_window_${value}`)}
            </button>
          ))}
        </div>
        <div className={pageStyles.segmented} role="group" aria-label={t('usage.timeline_step')}>
          {allowedSteps.map((value) => (
            <button
              key={value}
              type="button"
              className={`${pageStyles.segment} ${step === value ? pageStyles.segmentActive : ''}`}
              aria-pressed={step === value}
              title={t('usage.timeline_step_hint', { step: STEP_LABEL[value] })}
              onClick={() => setStepByWindow((current) => ({ ...current, [timeWindow]: value }))}
            >
              {STEP_LABEL[value]}
            </button>
          ))}
        </div>
        <div className={pageStyles.segmented} role="group" aria-label={t('usage.chart_metric')}>
          {TIMELINE_METRICS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${pageStyles.segment} ${metric === value ? pageStyles.segmentActive : ''}`}
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
            >
              {t(`usage.timeline_metric_${value}`)}
            </button>
          ))}
        </div>
        {loading && <span className={styles.loading}>{t('common.loading')}</span>}
      </div>

      {error && (
        <div className={pageStyles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {metricUnavailable && <p className={styles.note}>{t('usage.pricing_unavailable')}</p>}

      {model && (
        <>
          <dl className={styles.stats}>
            <div>
              <dt>{t('usage.timeline_total')}</dt>
              <dd>{formatValue(visibleTotal)}</dd>
            </div>
            <div>
              <dt>{t('usage.timeline_busiest', { step: STEP_LABEL[step] })}</dt>
              <dd>
                {busiest
                  ? t('usage.timeline_busiest_value', {
                      value: formatValue(busiest.value),
                      time: timeFormat.format(busiest.bucket.time),
                    })
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('usage.timeline_active', { step: STEP_LABEL[step] })}</dt>
              <dd>
                {activeBuckets.toLocaleString(i18n.language)} / {model.buckets.length}
              </dd>
            </div>
          </dl>

          {model.series.length > 0 && (
            <ul className={styles.legend} aria-label={t('usage.timeline_legend')}>
              {model.series.map((entry, index) => {
                const label = seriesLabel(entry, otherLabel);
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      className={`${styles.legendItem} ${visible[index] ? '' : styles.legendHidden}`}
                      aria-pressed={visible[index]}
                      title={
                        entry.members.length > 0
                          ? entry.members.join(', ')
                          : `${entry.provider} · ${entry.model}`
                      }
                      onClick={() => toggleSeries(entry.key)}
                    >
                      <i className={styles.swatch} style={{ background: seriesColor(entry) }} />
                      <span className={styles.legendName}>{label}</span>
                      <span className={styles.legendValue}>{formatValue(entry.total)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <TimelineChart
            model={model}
            view={view}
            metric={metric}
            visible={visible}
            windowMs={WINDOW_MINUTES[timeWindow] * 60 * 1000}
          />
        </>
      )}
    </section>
  );
}
