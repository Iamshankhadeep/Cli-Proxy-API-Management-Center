import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { IconChevronDown } from '@/components/ui/icons';
import type { UsageAccountTotals, UsageModelTotals } from '@/services/api/usageSummary';
import { providerLabel } from '@/features/dashboard/utils';
import { sortUsageRows, type SortDirection, type UsageSortKey } from '../logic';
import { CompactNumber, CostValue, DASH } from './UsageCells';
import styles from '../UsagePage.module.scss';

interface SortState {
  key: UsageSortKey;
  direction: SortDirection;
}

const DEFAULT_SORT: SortState = { key: 'tokens', direction: 'desc' };

function useSort() {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const toggle = (key: UsageSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'desc' }
    );
  return { sort, toggle };
}

function SortableHead({
  label,
  sortKey,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: UsageSortKey;
  sort: SortState;
  onToggle: (key: UsageSortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      alignRight
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`${styles.sortButton} ${active ? styles.sortActive : ''}`}
        onClick={() => onToggle(sortKey)}
      >
        {label}
        <IconChevronDown
          size={12}
          className={`${styles.sortIcon} ${active && sort.direction === 'asc' ? styles.sortAsc : ''}`}
        />
      </button>
    </TableHead>
  );
}

export function AccountsTable({ accounts }: { accounts: UsageAccountTotals[] }) {
  const { t } = useTranslation();
  const { sort, toggle } = useSort();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const unknownLabel = t('usage.unknown');

  const rows = useMemo(
    () => sortUsageRows(accounts, sort.key, sort.direction),
    [accounts, sort.key, sort.direction]
  );

  if (accounts.length === 0) {
    return <p className={styles.emptyNote}>{t('usage.accounts_empty')}</p>;
  }

  const rowKey = (row: UsageAccountTotals) => `${row.provider}|${row.authType}|${row.account}`;
  const toggleRow = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('usage.col_account')}</TableHead>
          <TableHead>{t('usage.col_provider')}</TableHead>
          <SortableHead
            label={t('usage.col_requests')}
            sortKey="requests"
            sort={sort}
            onToggle={toggle}
          />
          <TableHead alignRight>{t('usage.col_input')}</TableHead>
          <TableHead alignRight>{t('usage.col_output')}</TableHead>
          <TableHead alignRight>{t('usage.col_cache_read')}</TableHead>
          <SortableHead
            label={t('usage.col_total_tokens')}
            sortKey="tokens"
            sort={sort}
            onToggle={toggle}
          />
          <TableHead alignRight>{t('usage.col_images')}</TableHead>
          <SortableHead label={t('usage.col_cost')} sortKey="cost" sort={sort} onToggle={toggle} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const key = rowKey(row);
          const isOpen = expanded.has(key);
          const canExpand = row.models.length > 0;
          const models = isOpen ? sortUsageRows(row.models, sort.key, sort.direction) : [];
          return (
            <Fragment key={key}>
              <TableRow selected={isOpen}>
                <TableCell>
                  <div className={styles.accountCell}>
                    {canExpand ? (
                      <button
                        type="button"
                        className={styles.expandButton}
                        aria-expanded={isOpen}
                        aria-label={t(isOpen ? 'usage.collapse_models' : 'usage.expand_models', {
                          account: row.account || unknownLabel,
                        })}
                        onClick={() => toggleRow(key)}
                      >
                        <IconChevronDown
                          size={14}
                          className={`${styles.expandIcon} ${isOpen ? styles.expandIconOpen : ''}`}
                        />
                      </button>
                    ) : (
                      <span className={styles.expandSpacer} aria-hidden="true" />
                    )}
                    <span className={styles.accountName} title={row.account}>
                      {row.account || unknownLabel}
                    </span>
                    {row.authType && <span className={styles.tag}>{row.authType}</span>}
                  </div>
                </TableCell>
                <TableCell>{providerLabel(row.provider, unknownLabel)}</TableCell>
                <TableCell alignRight>
                  <RequestsValue requests={row.requests} failed={row.failed} />
                </TableCell>
                <TableCell alignRight>
                  <CompactNumber value={row.inputTokens} />
                </TableCell>
                <TableCell alignRight>
                  <CompactNumber value={row.outputTokens} />
                </TableCell>
                <TableCell alignRight>
                  <CompactNumber value={row.cacheReadTokens} />
                </TableCell>
                <TableCell alignRight>
                  <strong>
                    <CompactNumber value={row.totalTokens} />
                  </strong>
                </TableCell>
                <TableCell alignRight>
                  <CompactNumber value={row.images} muteZero />
                </TableCell>
                <TableCell alignRight>
                  <CostValue totals={row} />
                </TableCell>
              </TableRow>
              {models.map((model) => (
                <TableRow key={`${key}::${model.model}`} className={styles.subRow}>
                  <TableCell>
                    <div className={styles.accountCell}>
                      <span className={styles.expandSpacer} aria-hidden="true" />
                      <span className={styles.modelName}>{model.model || unknownLabel}</span>
                      {model.images > 0 && <ImageBadge count={model.images} />}
                    </div>
                  </TableCell>
                  <TableCell>
                    {providerLabel(model.provider || row.provider, unknownLabel)}
                  </TableCell>
                  <TableCell alignRight>
                    <RequestsValue requests={model.requests} failed={model.failed} />
                  </TableCell>
                  <TableCell alignRight>
                    <CompactNumber value={model.inputTokens} />
                  </TableCell>
                  <TableCell alignRight>
                    <CompactNumber value={model.outputTokens} />
                  </TableCell>
                  <TableCell alignRight>
                    <CompactNumber value={model.cacheReadTokens} />
                  </TableCell>
                  <TableCell alignRight>
                    <CompactNumber value={model.totalTokens} />
                  </TableCell>
                  <TableCell alignRight>
                    <CompactNumber value={model.images} muteZero />
                  </TableCell>
                  <TableCell alignRight>
                    <CostValue totals={model} />
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function ModelsTable({ models }: { models: UsageModelTotals[] }) {
  const { t } = useTranslation();
  const { sort, toggle } = useSort();
  const unknownLabel = t('usage.unknown');

  const rows = useMemo(
    () => sortUsageRows(models, sort.key, sort.direction),
    [models, sort.key, sort.direction]
  );

  if (models.length === 0) {
    return <p className={styles.emptyNote}>{t('usage.models_empty')}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('usage.col_model')}</TableHead>
          <TableHead>{t('usage.col_provider')}</TableHead>
          <SortableHead
            label={t('usage.col_requests')}
            sortKey="requests"
            sort={sort}
            onToggle={toggle}
          />
          <SortableHead
            label={t('usage.col_total_tokens')}
            sortKey="tokens"
            sort={sort}
            onToggle={toggle}
          />
          <TableHead alignRight>{t('usage.col_images')}</TableHead>
          <SortableHead label={t('usage.col_cost')} sortKey="cost" sort={sort} onToggle={toggle} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.provider}|${row.model}`}>
            <TableCell>
              <div className={styles.accountCell}>
                <span className={styles.modelName}>{row.model || unknownLabel}</span>
                {row.images > 0 && <ImageBadge count={row.images} />}
              </div>
            </TableCell>
            <TableCell>{row.provider ? providerLabel(row.provider, unknownLabel) : DASH}</TableCell>
            <TableCell alignRight>
              <RequestsValue requests={row.requests} failed={row.failed} />
            </TableCell>
            <TableCell alignRight>
              <CompactNumber value={row.totalTokens} />
            </TableCell>
            <TableCell alignRight>
              <CompactNumber value={row.images} muteZero />
            </TableCell>
            <TableCell alignRight>
              <CostValue totals={row} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RequestsValue({ requests, failed }: { requests: number; failed: number }) {
  const { t } = useTranslation();
  return (
    <span className={styles.requestsCell}>
      <CompactNumber value={requests} />
      {failed > 0 && (
        <span className={styles.failedNote} title={t('usage.failed_count', { count: failed })}>
          {t('usage.failed_short', { count: failed })}
        </span>
      )}
    </span>
  );
}

function ImageBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span className={styles.imageBadge} title={count.toLocaleString()}>
      {t('usage.images_badge', { count })}
    </span>
  );
}
