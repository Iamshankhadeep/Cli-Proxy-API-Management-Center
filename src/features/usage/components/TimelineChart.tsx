import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCompactNumber } from '@/utils/format';
import { niceCeil } from '@/features/dashboard/utils';
import {
  peakValue,
  seriesColor,
  seriesLabel,
  xTickIndexes,
  type TimelineBucket,
  type TimelineMetric,
  type TimelineView,
  type TimelineViewModel,
} from '../timeline';
import { formatUsd } from '../logic';
import styles from './TimelineChart.module.scss';

const PLOT_HEIGHT = 240;
const Y_AXIS_WIDTH = 56;
const X_AXIS_HEIGHT = 22;
const TOP_PAD = 8;
const Y_TICKS = 5;
const HEAT_ROW = 22;
const HEAT_ROW_GAP = 2;
const HEAT_LABEL_WIDTH = 168;

interface TimelineChartProps {
  model: TimelineViewModel;
  view: TimelineView;
  metric: TimelineMetric;
  visible: readonly boolean[];
  /** Window length; picks date-aware axis labels past one day. */
  windowMs: number;
}

/** Path for a bar whose top corners are rounded (data end) and bottom sits on the baseline. */
function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${x + w - radius}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

export function TimelineChart({ model, view, metric, visible, windowMs }: TimelineChartProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { buckets, series, stepMs } = model;
  const count = buckets.length;
  const locale = i18n.language;
  const otherLabel = t('usage.timeline_other');

  const formatValue = (value: number, compact = true) => {
    if (metric === 'cost') return formatUsd(value, locale);
    return compact ? formatCompactNumber(value) : Math.round(value).toLocaleString(locale);
  };

  const multiDay = windowMs > 24 * 60 * 60 * 1000;
  const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const dayTimeFormat = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const axisLabel = (time: number) => (multiDay ? dayTimeFormat : timeFormat).format(time);
  const rangeLabel = (time: number) => {
    const startLabel = multiDay ? dayTimeFormat.format(time) : timeFormat.format(time);
    return `${startLabel} – ${timeFormat.format(time + stepMs)}`;
  };

  const isHeatmap = view === 'heatmap';
  const visibleRows = series
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => visible[index]);

  const plotLeft = isHeatmap ? HEAT_LABEL_WIDTH : Y_AXIS_WIDTH;
  const plotWidth = Math.max(0, width - plotLeft);
  const plotHeight = isHeatmap
    ? Math.max(1, visibleRows.length) * (HEAT_ROW + HEAT_ROW_GAP)
    : PLOT_HEIGHT;
  const svgHeight = TOP_PAD + plotHeight + X_AXIS_HEIGHT;
  const slot = count > 0 ? plotWidth / count : 0;
  const barGap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
  const barWidth = Math.max(0.5, slot - barGap);

  const peak = peakValue(buckets, visible, view === 'stacked' ? 'stacked' : 'single');
  const scaleMax = peak > 0 ? niceCeil(peak) : 1;
  const yOf = (value: number) => TOP_PAD + plotHeight - (value / scaleMax) * plotHeight;
  const xCenter = (index: number) => plotLeft + (index + 0.5) * slot;

  const handlePointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - plotLeft;
    if (x < 0 || slot <= 0) {
      setActive(null);
      return;
    }
    setActive(Math.min(count - 1, Math.floor(x / slot)));
  };

  const xTicks = xTickIndexes(count, Math.max(2, Math.floor(plotWidth / (multiDay ? 120 : 84))));
  const totalVisible = buckets.reduce(
    (sum, bucket) => sum + bucket.values.reduce((s, v, i) => (visible[i] ? s + v : s), 0),
    0
  );
  const summary = t('usage.timeline_chart_summary', {
    buckets: count,
    total: formatValue(totalVisible, false),
  });

  const renderStacked = () =>
    buckets.map((bucket, bucketIndex) => {
      let base = 0;
      const segments = visibleRows.filter(({ index }) => bucket.values[index] > 0);
      return segments.map(({ entry, index }, segmentIndex) => {
        const value = bucket.values[index];
        const y = yOf(base + value);
        const h = Math.max(1, yOf(base) - y);
        base += value;
        const x = plotLeft + bucketIndex * slot + barGap / 2;
        const isTop = segmentIndex === segments.length - 1;
        const stroke = barWidth >= 4 ? 'var(--chart-surface)' : 'none';
        return isTop && barWidth >= 6 ? (
          <path
            key={`${bucket.time}-${entry.key}`}
            d={roundedTopRect(x, y, barWidth, h, 3)}
            fill={seriesColor(entry)}
            stroke={stroke}
            strokeWidth={1}
          />
        ) : (
          <rect
            key={`${bucket.time}-${entry.key}`}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            fill={seriesColor(entry)}
            stroke={stroke}
            strokeWidth={1}
          />
        );
      });
    });

  // Reverse so the top-ranked models paint last and stay on top where lines overlap.
  const renderLines = () =>
    [...visibleRows]
      .reverse()
      .map(({ entry, index }) => (
        <polyline
          key={entry.key}
          points={buckets
            .map((bucket, i) => `${xCenter(i)},${yOf(bucket.values[index])}`)
            .join(' ')}
          fill="none"
          stroke={seriesColor(entry)}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ));

  const heatMax = peakValue(buckets, visible, 'single');
  const heatFill = (value: number) => {
    // sqrt keeps quiet minutes visible next to a burst; 12% floor separates "some" from "none".
    const share = Math.max(0.12, Math.sqrt(value / heatMax));
    return `color-mix(in oklab, var(--heat-high) ${Math.round(share * 100)}%, var(--heat-low))`;
  };

  const renderHeatmap = () =>
    visibleRows.map(({ entry, index }, row) => {
      const y = TOP_PAD + row * (HEAT_ROW + HEAT_ROW_GAP);
      return (
        <g key={entry.key}>
          <rect
            x={plotLeft}
            y={y}
            width={plotWidth}
            height={HEAT_ROW}
            rx={3}
            fill="var(--heat-track)"
          />
          {buckets.map((bucket, i) =>
            bucket.values[index] > 0 ? (
              <rect
                key={bucket.time}
                x={plotLeft + i * slot + (slot >= 4 ? 0.5 : 0)}
                y={y}
                width={Math.max(0.75, slot - (slot >= 4 ? 1 : 0))}
                height={HEAT_ROW}
                rx={slot >= 8 ? 2 : 0}
                style={{ fill: heatFill(bucket.values[index]) }}
              />
            ) : null
          )}
        </g>
      );
    });

  const activeBucket: TimelineBucket | null = active === null ? null : (buckets[active] ?? null);
  const tooltipRows = activeBucket
    ? visibleRows
        .map(({ entry, index }) => ({ entry, value: activeBucket.values[index] }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
    : [];
  const tooltipTotal = tooltipRows.reduce((sum, row) => sum + row.value, 0);

  if (count === 0) {
    return <p className={styles.empty}>{t('usage.timeline_empty')}</p>;
  }

  return (
    <div ref={containerRef} className={styles.chart}>
      {width > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={svgHeight}
          role="img"
          aria-label={summary}
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={() => setActive(null)}
        >
          {!isHeatmap &&
            Array.from({ length: Y_TICKS }, (_, i) => {
              const value = (scaleMax * i) / (Y_TICKS - 1);
              const y = yOf(value);
              return (
                <g key={i}>
                  <line
                    x1={plotLeft}
                    x2={width}
                    y1={y}
                    y2={y}
                    className={i === 0 ? styles.baseline : styles.gridline}
                  />
                  <text x={plotLeft - 8} y={y} className={styles.yTick}>
                    {formatValue(value)}
                  </text>
                </g>
              );
            })}

          {isHeatmap &&
            visibleRows.map(({ entry }, row) => {
              const y = TOP_PAD + row * (HEAT_ROW + HEAT_ROW_GAP) + HEAT_ROW / 2;
              return (
                <g key={entry.key}>
                  <rect x={0} y={y - 4} width={8} height={8} rx={2} fill={seriesColor(entry)} />
                  <text x={14} y={y} className={styles.rowLabel}>
                    <title>{seriesLabel(entry, otherLabel)}</title>
                    {truncate(seriesLabel(entry, otherLabel), 22)}
                  </text>
                </g>
              );
            })}

          {activeBucket && (
            <rect
              x={plotLeft + (active ?? 0) * slot}
              y={TOP_PAD}
              width={Math.max(1, slot)}
              height={plotHeight}
              className={styles.hoverBand}
            />
          )}

          {view === 'stacked' && renderStacked()}
          {view === 'lines' && renderLines()}
          {isHeatmap && renderHeatmap()}

          {view === 'lines' &&
            activeBucket &&
            active !== null &&
            visibleRows
              .filter(({ index }) => activeBucket.values[index] > 0)
              .map(({ entry, index }) => (
                <circle
                  key={entry.key}
                  cx={xCenter(active)}
                  cy={yOf(activeBucket.values[index])}
                  r={4}
                  fill={seriesColor(entry)}
                  stroke="var(--chart-surface)"
                  strokeWidth={2}
                />
              ))}

          {xTicks.map((index) => (
            <text
              key={index}
              x={Math.min(Math.max(xCenter(index), plotLeft + 20), width - 20)}
              y={TOP_PAD + plotHeight + 15}
              className={styles.xTick}
            >
              {axisLabel(buckets[index].time)}
            </text>
          ))}
        </svg>
      )}

      {activeBucket && active !== null && (
        <div
          className={styles.tooltip}
          role="status"
          style={{
            left: xCenter(active),
            transform:
              xCenter(active) < width * 0.3 ? 'translateX(12px)' : 'translateX(calc(-100% - 12px))',
          }}
        >
          <span className={styles.tooltipTitle}>{rangeLabel(activeBucket.time)}</span>
          {tooltipRows.length === 0 ? (
            <span className={styles.tooltipMuted}>{t('usage.timeline_idle')}</span>
          ) : (
            <>
              {tooltipRows.map(({ entry, value }) => (
                <span key={entry.key} className={styles.tooltipRow}>
                  <i className={styles.swatch} style={{ background: seriesColor(entry) }} />
                  <span className={styles.tooltipName}>{seriesLabel(entry, otherLabel)}</span>
                  <b>{formatValue(value, false)}</b>
                </span>
              ))}
              {tooltipRows.length > 1 && (
                <span className={`${styles.tooltipRow} ${styles.tooltipTotal}`}>
                  <span className={styles.tooltipName}>{t('usage.timeline_total')}</span>
                  <b>{formatValue(tooltipTotal, false)}</b>
                </span>
              )}
            </>
          )}
          {activeBucket.point && (
            <span className={styles.tooltipFoot}>
              {t('usage.timeline_bucket_detail', {
                input: formatCompactNumber(activeBucket.point.inputTokens),
                output: formatCompactNumber(activeBucket.point.outputTokens),
                cache: formatCompactNumber(activeBucket.point.cacheReadTokens),
                requests: activeBucket.point.requests.toLocaleString(locale),
              })}
            </span>
          )}
        </div>
      )}

      {isHeatmap && (
        <div className={styles.heatLegend} aria-hidden="true">
          <span>{t('usage.timeline_less')}</span>
          <i className={styles.heatScale} />
          <span>{t('usage.timeline_more')}</span>
        </div>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
