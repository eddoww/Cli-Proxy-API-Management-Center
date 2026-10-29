import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  edgeApi,
  type EdgeEndpointSettings,
  type EdgeSettings,
  type EdgeStatus,
  type EdgeTranscriptionSettings,
} from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import styles from './EdgePage.module.scss';

interface EndpointMeta {
  key: 'typesafe' | 'embeddings' | 'transcriptions';
  provider: 'typesafe' | 'mistral' | 'groq';
  modelHint: string;
}

const ENDPOINTS: EndpointMeta[] = [
  { key: 'typesafe', provider: 'typesafe', modelHint: 'jev-latest' },
  { key: 'embeddings', provider: 'mistral', modelHint: 'mistral-embed' },
  { key: 'transcriptions', provider: 'groq', modelHint: 'whisper-large-v3' },
];

export function EdgePage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification } = useNotificationStore();

  const [status, setStatus] = useState<EdgeStatus | null>(null);
  const [settings, setSettings] = useState<EdgeSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const connected = connectionStatus === 'connected';
  const dirty = useMemo(
    () => (settings ? JSON.stringify(settings) !== saved : false),
    [settings, saved]
  );

  const load = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      setError(t('notification.connection_required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await edgeApi.getStatus();
      setStatus(next);
      setSettings(next.settings);
      setSaved(JSON.stringify(next.settings));
      try {
        setModels(await edgeApi.listModels());
      } catch {
        setModels([]);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('edge.load_failed')));
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateEndpoint = (key: 'typesafe' | 'embeddings', patch: Partial<EdgeEndpointSettings>) => {
    setSettings((current) => {
      if (!current) return current;
      return { ...current, [key]: { ...current[key], ...patch } };
    });
  };

  const updateTranscriptions = (patch: Partial<EdgeTranscriptionSettings>) => {
    setSettings((current) => {
      if (!current) return current;
      return { ...current, transcriptions: { ...current.transcriptions, ...patch } };
    });
  };

  const save = async () => {
    if (!settings) return;
    const emptyModel = ENDPOINTS.find((endpoint) => !settings[endpoint.key].model.trim());
    if (emptyModel) {
      showNotification(t('edge.error_model_required'), 'error');
      return;
    }
    if (settings.transcriptions.maxConcurrent < 1 || settings.transcriptions.maxConcurrent > 16) {
      showNotification(t('edge.error_concurrency'), 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await edgeApi.saveSettings(settings);
      setSettings(next);
      setSaved(JSON.stringify(next));
      showNotification(t('edge.saved'), 'success');
      setStatus(await edgeApi.getStatus());
    } catch (err: unknown) {
      showNotification(getErrorMessage(err, t('edge.save_failed')), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.stateShell}>
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className={styles.stateShell}>
        <EmptyState title={t('edge.unavailable')} description={error || t('edge.load_failed')} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Card
        title={t('edge.title')}
        extra={
          <div className={styles.headerActions}>
            {dirty ? <span className={styles.dirty}>{t('combos.unsaved')}</span> : null}
            <Button variant="secondary" onClick={() => void load()} disabled={saving}>
              {t('combos.reload')}
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
              {t('combos.save')}
            </Button>
          </div>
        }
      >
        <p className={styles.hint}>{t('edge.intro')}</p>
        <div className={styles.meta}>
          <span>{t('edge.version', { version: status?.version ?? '—' })}</span>
          <span>{t('edge.upstream', { upstream: status?.upstream ?? '—' })}</span>
          <span>
            {status?.persisted ? t('edge.persisted') : t('edge.not_persisted')}
          </span>
        </div>
        {!status?.persisted ? <div className={styles.warning}>{t('edge.persist_warning')}</div> : null}
        <datalist id="edge-model-options">
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </Card>

      {ENDPOINTS.map((endpoint) => {
        const configured = status?.providers[endpoint.provider] ?? false;
        const value = settings[endpoint.key];
        return (
          <Card
            key={endpoint.key}
            title={t(`edge.${endpoint.key}_title`)}
            extra={
              <span className={configured ? styles.badgeOk : styles.badgeWarn}>
                {configured ? t('edge.provider_ready') : t('edge.provider_missing')}
              </span>
            }
          >
            <p className={styles.hint}>{t(`edge.${endpoint.key}_description`)}</p>
            <div className={styles.row}>
              <ToggleSwitch
                checked={value.enabled}
                onChange={(enabled) =>
                  endpoint.key === 'transcriptions'
                    ? updateTranscriptions({ enabled })
                    : updateEndpoint(endpoint.key, { enabled })
                }
                label={t('edge.enabled')}
                disabled={!configured}
              />
              <label className={styles.field}>
                <span>{t('edge.model')}</span>
                <Input
                  list="edge-model-options"
                  value={value.model}
                  placeholder={endpoint.modelHint}
                  onChange={(event) =>
                    endpoint.key === 'transcriptions'
                      ? updateTranscriptions({ model: event.target.value })
                      : updateEndpoint(endpoint.key, { model: event.target.value })
                  }
                  disabled={!configured}
                />
              </label>
              {endpoint.key === 'transcriptions' ? (
                <label className={styles.field}>
                  <span>{t('edge.max_concurrent')}</span>
                  <Input
                    type="number"
                    min={1}
                    max={16}
                    value={settings.transcriptions.maxConcurrent}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      updateTranscriptions({ maxConcurrent: Number.isFinite(parsed) ? parsed : 1 });
                    }}
                    disabled={!configured}
                  />
                </label>
              ) : null}
            </div>
          </Card>
        );
      })}

      <Card title={t('edge.limits_title')}>
        <ul className={styles.limits}>
          <li>{t('edge.limit_upload', { size: status?.maxUploadMb ?? 25 })}</li>
          <li>{t('edge.limit_json', { size: status?.maxJsonMb ?? 32 })}</li>
          <li>{t('edge.limit_uptime', { seconds: status?.uptimeSeconds ?? 0 })}</li>
        </ul>
      </Card>
    </div>
  );
}
