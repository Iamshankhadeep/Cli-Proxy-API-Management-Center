import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageDailyTotals } from '@/services/api/usageSummary';
import { formatCompactNumber } from '@/utils/format';
import { niceCeil } from '@/features/dashboard/utils';
import { formatUsd } from '../logic';
import styles from './DailyUsageChart.module.scss';

export type DailyChartMetric = 'tokens' | 'cost';

const TICK_COUNT = 5;

interface DailyUsageChartProps {
  daily: UsageDailyTotals[];
  metric: DailyChartMetric;
}

/** MM-DD keeps axis labels short; the tooltip carries the full date. */
const shortDate = (date: string) => (date.length >= 10 ? date.slice(5) : date);

export function DailyUsageChart({ daily, metric }: DailyUsageChartProps) {
  const { t, i18n } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const valueOf = (day: UsageDailyTotals) => (metric === 'cost' ? day.costUsd : day.totalTokens);
  const formatTick = (value: number) =>
    metric === 'cost' ? formatUsd(value, i18n.language) : formatCompactNumber(value);

  const peak = daily.reduce((max, day) => Math.max(max, valueOf(day)), 0);
  const scaleMax = peak > 0 ? niceCeil(peak) : 1;

  const ticks = Array.from({ length: TICK_COUNT }, (_, index) => {
    const ratio = 1 - index / (TICK_COUNT - 1);
    return { ratio, value: scaleMax * ratio };
  });

  const xTicks = useMemo(() => {
    if (daily.length === 0) return [];
    const positions = [0, Math.floor((daily.length - 1) / 2), daily.length - 1];
    return Array.from(new Set(positions)).map((index) => ({
      index,
      label: shortDate(daily[index].date),
    }));
  }, [daily]);

  if (daily.length === 0) {
    return <p className={styles.empty}>{t('usage.chart_empty')}</p>;
  }

  const totalValue = daily.reduce((sum, day) => sum + valueOf(day), 0);
  const summary = t('usage.chart_summary', {
    days: daily.length,
    total: metric === 'cost' ? formatUsd(totalValue, i18n.language) : totalValue.toLocaleString(),
  });
  const active = activeIndex === null ? null : daily[activeIndex];

  return (
    <figure className={styles.chart}>
      <div className={styles.plot}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.ratio}
              className={styles.yTick}
              style={{ top: `${(1 - tick.ratio) * 100}%` }}
            >
              {formatTick(tick.value)}
            </span>
          ))}
        </div>

        <div className={styles.canvas}>
          <div className={styles.gridlines} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.ratio}
                className={styles.gridline}
                style={{ top: `${(1 - tick.ratio) * 100}%` }}
              />
            ))}
          </div>

          <div
            className={styles.columns}
            role="img"
            aria-label={summary}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {daily.map((day, index) => {
              const value = valueOf(day);
              return (
                <div
                  key={day.date}
                  className={`${styles.column} ${activeIndex === index ? styles.columnActive : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => setActiveIndex((current) => (current === index ? null : index))}
                >
                  {value > 0 ? (
                    <span
                      className={`${styles.bar} ${metric === 'cost' ? styles.barCost : ''}`}
                      style={{ height: `${Math.max(1, (value / scaleMax) * 100)}%` }}
                    />
                  ) : (
                    <span className={styles.idleTick} />
                  )}
                </div>
              );
            })}
          </div>

          {active && activeIndex !== null && (
            <div
              className={styles.tooltip}
              role="status"
              style={{
                left: `${((activeIndex + 0.5) / daily.length) * 100}%`,
                transform:
                  activeIndex < daily.length * 0.2
                    ? 'translateX(-10%)'
                    : activeIndex > daily.length * 0.8
                      ? 'translateX(-90%)'
                      : 'translateX(-50%)',
              }}
            >
              <span className={styles.tooltipDate}>{active.date}</span>
              <span className={styles.tooltipRow}>
                {t('usage.col_total_tokens')}
                <b>{active.totalTokens.toLocaleString()}</b>
              </span>
              <span className={styles.tooltipRow}>
                {t('usage.col_cost')}
                <b>{formatUsd(active.costUsd, i18n.language)}</b>
              </span>
              <span className={styles.tooltipRow}>
                {t('usage.col_requests')}
                <b>{active.requests.toLocaleString()}</b>
              </span>
              {active.images > 0 && (
                <span className={styles.tooltipRow}>
                  {t('usage.col_images')}
                  <b>{active.images.toLocaleString()}</b>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        {xTicks.map((tick) => (
          <span
            key={tick.index}
            className={styles.xTick}
            style={{ left: `${((tick.index + 0.5) / daily.length) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
