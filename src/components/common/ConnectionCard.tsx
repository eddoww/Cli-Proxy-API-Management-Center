import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { CopyButton } from './CopyButton';
import { maskSecret } from '@/features/shared/endpointSnippets';
import styles from './ConnectionCard.module.scss';

interface ConnectionCardProps {
  baseUrl: string;
  apiKey: string;
  /** OpenAI-compatible base URL label suffix, e.g. "OpenAI-compatible". */
  note?: ReactNode;
  children?: ReactNode;
}

/** Base URL + client key, both one click away from the clipboard. */
export function ConnectionCard({ baseUrl, apiKey, note, children }: ConnectionCardProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  return (
    <Card title={t('connect.title')}>
      <p className={styles.hint}>{t('connect.intro')}</p>
      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.label}>{t('connect.base_url')}</span>
          <code className={styles.value}>{baseUrl || t('connect.unavailable')}</code>
          <CopyButton value={baseUrl} disabled={!baseUrl} />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>{t('connect.api_key')}</span>
          <code className={styles.value}>
            {apiKey ? (revealed ? apiKey : maskSecret(apiKey)) : t('connect.no_key')}
          </code>
          {apiKey ? (
            <>
              <button type="button" className={styles.reveal} onClick={() => setRevealed((v) => !v)}>
                {revealed ? t('connect.hide') : t('connect.reveal')}
              </button>
              <CopyButton value={apiKey} />
            </>
          ) : null}
        </div>
      </div>
      {note ? <p className={styles.note}>{note}</p> : null}
      {children}
    </Card>
  );
}
