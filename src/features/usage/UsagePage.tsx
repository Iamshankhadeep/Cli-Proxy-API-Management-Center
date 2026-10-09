/**
 * Token usage page: per-account / per-model token, image and API-equivalent cost totals from
 * `GET /v8/management/observability/usage/summary`.
 *
 * Contracts:
 * - Date presets are computed in browser local time and sent as inclusive `from`/`to` dates;
 *   "All time" omits both.
 * - A request-id guard plus the client's connection revision drop stale responses after a
 *   range switch or connection change.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconRefreshCw } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient, usageSummaryApi, type UsageSummary } from '@/services/api';
import { useAuthStore } from '@/stores';
import { formatCompactNumber, formatDateTimeValue, formatDateValue } from '@/utils/format';
import { DailyUsageChart, type DailyChartMetric } from './components/DailyUsageChart';
import { AccountsTable, ModelsTable } from './components/UsageTables';
import { DASH } from './components/UsageCells';
import { USAGE_RANGES, formatUsd, formatUsdExact, rangeToQuery, type UsageRange } from './logic';
import styles from './UsagePage.module.scss';

const RANGE_LABEL_KEYS: Record<UsageRange, string> = {
  today: 'usage.range_today',
  '7d': 'usage.range_7d',
  '30d': 'usage.range_30d',
  all: 'usage.range_all',
};

export function UsagePage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);

  const [range, setRange] = useState<UsageRange>('7d');
  const [chartMetric, setChartMetric] = useState<DailyChartMetric>('tokens');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (connectionStatus !== 'connected') {
      setLoading(false);
      return;
    }
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      requestId === requestRef.current && revision === apiClient.getConnectionRevision();

    setLoading(true);
    setError('');
    try {
      const data = await usageSummaryApi.getSummary(rangeToQuery(range));
      if (!isCurrent()) return;
      setSummary(data);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus, range, t]);

  useHeaderRefresh(load);

  useEffect(() => {
    void load();
  }, [load]);

  // A different backend must not show the previous connection's numbers.
  useEffect(() => {
    setSummary(null);
  }, [apiBase]);

  const totals = summary?.totals;
  const pricingAvailable = summary?.pricing.available ?? false;
  const sinceLabel = summary?.since ? formatDateValue(summary.since, i18n.language) : '';
  const pricingUpdated = summary?.pricing.updatedAt
    ? formatDateTimeValue(summary.pricing.updatedAt, i18n.language)
    : '';

  const kpis = totals
    ? [
        {
          key: 'tokens',
          label: t('usage.kpi_tokens'),
          value: formatCompactNumber(totals.totalTokens),
          exact: totals.totalTokens.toLocaleString(),
          hint: t('usage.kpi_tokens_hint', {
            input: formatCompactNumber(totals.inputTokens),
            output: formatCompactNumber(totals.outputTokens),
            cache: formatCompactNumber(totals.cacheReadTokens),
          }),
          accent: 'var(--viz-success)',
        },
        {
          key: 'cost',
          label: t('usage.kpi_cost'),
          value: pricingAvailable ? formatUsd(totals.costUsd, i18n.language) : DASH,
          exact: pricingAvailable
            ? `${formatUsdExact(totals.costUsd, i18n.language)} · ${t('usage.kpi_cost_note')}`
            : t('usage.pricing_unavailable'),
          hint: pricingAvailable ? t('usage.kpi_cost_note') : t('usage.pricing_unavailable'),
          extra:
            pricingAvailable && totals.unpricedRequests > 0
              ? t('usage.unpriced_partial_hint', { count: totals.unpricedRequests })
              : '',
          accent: 'var(--amber-color)',
        },
        {
          key: 'requests',
          label: t('usage.kpi_requests'),
          value: formatCompactNumber(totals.requests),
          exact: totals.requests.toLocaleString(),
          hint: t('usage.failed_count', { count: totals.failed }),
          accent: totals.failed > 0 ? 'var(--viz-failure)' : 'var(--border-hover)',
        },
        {
          key: 'images',
          label: t('usage.kpi_images'),
          value: formatCompactNumber(totals.images),
          exact: totals.images.toLocaleString(),
          hint: t('usage.kpi_images_hint'),
          accent: 'var(--border-hover)',
        },
      ]
    : [];

  const showSkeleton = loading && !summary;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{t('usage.title')}</h1>
          <p className={styles.meta}>
            <span>{t(RANGE_LABEL_KEYS[range])}</span>
            {sinceLabel && (
              <>
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
                <span>{t('usage.since', { date: sinceLabel })}</span>
              </>
            )}
            {summary?.pricing.source && (
              <>
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
                <span
                  title={
                    pricingUpdated
                      ? t('usage.pricing_updated', { date: pricingUpdated })
                      : undefined
                  }
                >
                  {t('usage.pricing_source', { source: summary.pricing.source })}
                </span>
              </>
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.segmented} role="group" aria-label={t('usage.range_label')}>
            {USAGE_RANGES.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.segment} ${range === value ? styles.segmentActive : ''}`}
                aria-pressed={range === value}
                onClick={() => setRange(value)}
              >
                {t(RANGE_LABEL_KEYS[value])}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void load()}
            disabled={loading || connectionStatus !== 'connected'}
          >
            <IconRefreshCw size={14} className={loading ? styles.spinning : undefined} />
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {summary && !summary.enabled && (
        <div className={styles.warningBanner} role="status">
          <span>{t('usage.disabled_banner')}</span>
          <Link to="/config" className={styles.bannerLink}>
            {t('usage.disabled_banner_link')}
          </Link>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {showSkeleton ? (
        <div className={styles.kpiRow} aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={118} rounded={14} />
          ))}
        </div>
      ) : (
        kpis.length > 0 && (
          <section className={styles.kpiRow} aria-label={t('usage.kpi_aria')}>
            {kpis.map((kpi) => (
              <article
                key={kpi.key}
                className={styles.kpiTile}
                style={{ '--tile-accent': kpi.accent } as CSSProperties}
              >
                <span className={styles.kpiLabel}>{kpi.label}</span>
                <strong className={styles.kpiValue} title={kpi.exact}>
                  {kpi.value}
                </strong>
                <span className={styles.kpiHint}>{kpi.hint}</span>
                {kpi.extra && <span className={styles.kpiExtra}>{kpi.extra}</span>}
              </article>
            ))}
          </section>
        )
      )}

      {summary && (
        <>
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{t('usage.daily_title')}</h2>
              <div className={styles.segmented} role="group" aria-label={t('usage.chart_metric')}>
                {(['tokens', 'cost'] as const).map((metric) => (
                  <button
                    key={metric}
                    type="button"
                    className={`${styles.segment} ${chartMetric === metric ? styles.segmentActive : ''}`}
                    aria-pressed={chartMetric === metric}
                    onClick={() => setChartMetric(metric)}
                  >
                    {t(metric === 'tokens' ? 'usage.chart_tokens' : 'usage.chart_cost')}
                  </button>
                ))}
              </div>
            </header>
            <DailyUsageChart daily={summary.daily} metric={chartMetric} />
          </section>

          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <div className={styles.panelCopy}>
                <h2 className={styles.panelTitle}>{t('usage.accounts_title')}</h2>
                <p className={styles.panelDescription}>{t('usage.accounts_description')}</p>
              </div>
            </header>
            <AccountsTable accounts={summary.accounts} />
          </section>

          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <div className={styles.panelCopy}>
                <h2 className={styles.panelTitle}>{t('usage.models_title')}</h2>
                <p className={styles.panelDescription}>{t('usage.models_description')}</p>
              </div>
            </header>
            <ModelsTable models={summary.models} />
          </section>

          {totals && totals.unpricedRequests > 0 && (
            <p className={styles.footnote}>
              {t('usage.unpriced_footnote', { count: totals.unpricedRequests })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
