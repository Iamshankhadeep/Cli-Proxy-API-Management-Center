import { useTranslation } from 'react-i18next';
import type { UsageTotals } from '@/services/api/usageSummary';
import { formatCompactNumber } from '@/utils/format';
import { costState, formatUsd, formatUsdExact } from '../logic';
import styles from '../UsagePage.module.scss';

export const DASH = '—';

/** Compact count (1.2M) with the exact value on hover. */
export function CompactNumber({ value, muteZero = false }: { value: number; muteZero?: boolean }) {
  if (muteZero && value === 0) {
    return <span className={styles.muted}>{DASH}</span>;
  }
  return (
    <span className={styles.num} title={value.toLocaleString()}>
      {formatCompactNumber(value)}
    </span>
  );
}

/**
 * Cost with pricing coverage: fully unpriced rows render "—", partially priced rows get an
 * asterisk; the hover title explains which.
 */
export function CostValue({
  totals,
}: {
  totals: Pick<UsageTotals, 'costUsd' | 'requests' | 'unpricedRequests'>;
}) {
  const { t, i18n } = useTranslation();
  const state = costState(totals);

  if (state === 'unpriced') {
    return (
      <span className={styles.muted} title={t('usage.unpriced_all_hint')}>
        {DASH}
      </span>
    );
  }

  const exact = formatUsdExact(totals.costUsd, i18n.language);
  if (state === 'partial') {
    return (
      <span
        className={styles.num}
        title={`${exact} · ${t('usage.unpriced_partial_hint', { count: totals.unpricedRequests })}`}
      >
        {formatUsd(totals.costUsd, i18n.language)}
        <sup className={styles.partialMark} aria-hidden="true">
          *
        </sup>
      </span>
    );
  }

  return (
    <span className={styles.num} title={exact}>
      {formatUsd(totals.costUsd, i18n.language)}
    </span>
  );
}
