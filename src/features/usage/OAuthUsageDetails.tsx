import { useTranslation } from 'react-i18next';
import { formatCompactNumber } from '@/utils/usage';
import type { OAuthAccountUsage } from './oauthUsage';
import styles from './OAuthUsageDetails.module.scss';

export function OAuthUsageDetails({ accounts }: { accounts: OAuthAccountUsage[] }) {
  const { t } = useTranslation();
  if (!accounts.length) return null;
  const percent = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const date = (value: number) =>
    Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString() : '—';
  const windowLabel = (id: string, seconds: number) => {
    const name =
      id === 'primary'
        ? t('usage_stats.oauth_window_primary')
        : id === 'secondary'
          ? t('usage_stats.oauth_window_secondary')
          : '';
    const duration =
      seconds % 86400 === 0
        ? t('usage_stats.oauth_window_days', { days: seconds / 86400 })
        : t('usage_stats.oauth_window_hours', { hours: seconds / 3600 });
    return `${name || (['5h', '7d'].includes(id) ? '' : id)} ${duration}`.trim();
  };
  return (
    <section className={styles.section} aria-label={t('usage_stats.oauth_title')}>
      <strong>{t('usage_stats.oauth_title')}</strong>
      <details className={styles.note}>
        <summary>{t('usage_stats.oauth_estimate_help')}</summary>
        <p>{t('usage_stats.oauth_estimate_note')}</p>
      </details>
      {accounts.map((account) => (
        <div className={styles.account} key={account.id}>
          <strong>
            {account.name} <span className={styles.provider}>{account.provider}</span>
          </strong>
          <div>
            {t('usage_stats.requests_count')}: {account.requests.toLocaleString()} ·{' '}
            {t('usage_stats.tokens_count')}: {formatCompactNumber(account.tokens)}
          </div>
          <div className={styles.note}>
            {t('usage_stats.oauth_latest', { time: date(account.observedAt) })}
          </div>
          {account.windows.length ? (
            account.windows.map((window) => (
              <div key={window.id} className={styles.snapshot}>
                {windowLabel(window.id, window.windowSeconds)}: {percent(window.usedPercent)}%
                <span className={styles.note}>
                  {t('usage_stats.oauth_reset', { time: date(window.resetAt) })}
                </span>
                {window.resetAt <= Date.now() && (
                  <span className={styles.note}>{t('usage_stats.oauth_expired')}</span>
                )}
              </div>
            ))
          ) : (
            <div className={styles.note}>{t('usage_stats.oauth_no_snapshot')}</div>
          )}
          {account.history.length ? (
            account.history.map((window, index) => (
              <div className={styles.estimate} key={`${window.id}:${window.resetAt}:${index}`}>
                <div>
                  {windowLabel(window.id, window.windowSeconds)} ·{' '}
                  {t('usage_stats.oauth_reset', { time: date(window.resetAt) })}
                </div>
                <strong>
                  {t('usage_stats.oauth_estimated')}:{' '}
                  {window.estimatedPercent === null
                    ? t('usage_stats.oauth_unavailable')
                    : t('usage_stats.oauth_points', { value: percent(window.estimatedPercent) })}
                </strong>
                <span className={styles.note}>
                  {t('usage_stats.oauth_coverage', {
                    covered: window.coveredRequests,
                    total: window.totalRequests,
                  })}
                </span>
              </div>
            ))
          ) : (
            <div className={styles.note}>{t('usage_stats.oauth_no_history')}</div>
          )}
        </div>
      ))}
    </section>
  );
}
