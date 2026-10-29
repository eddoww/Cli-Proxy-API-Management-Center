import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { pluginsApi, edgeApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type { PluginConfigObject, PluginListEntry } from '@/types';
import styles from './CombosPage.module.scss';

const PLUGIN_ID = 'combo-router';
const STRATEGY_FALLBACK = 'fallback';
const STRATEGY_ROUND_ROBIN = 'round-robin';
const CAPABILITIES = ['vision', 'audio', 'video', 'pdf', 'tools'] as const;
type Capability = (typeof CAPABILITIES)[number];

interface Combo {
  name: string;
  models: string[];
  strategy: string;
  description: string;
}

interface ComboConfig {
  enabled: boolean;
  defaultStrategy: string;
  combos: Combo[];
  capabilities: Record<string, string[]>;
}

const asString = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

const normalizeCombo = (value: unknown): Combo => {
  const record = isRecord(value) ? value : {};
  const models = Array.isArray(record.models)
    ? record.models.map((item) => asString(item)).filter((item) => item.trim().length > 0)
    : [];
  return {
    name: asString(record.name),
    models,
    strategy: asString(record.strategy),
    description: asString(record.description),
  };
};

const normalizeConfig = (raw: PluginConfigObject): ComboConfig => {
  const combos = Array.isArray(raw.combos) ? raw.combos.map(normalizeCombo) : [];
  const capabilities: Record<string, string[]> = {};
  if (isRecord(raw.capabilities)) {
    for (const [model, caps] of Object.entries(raw.capabilities)) {
      if (Array.isArray(caps)) {
        capabilities[model] = caps.map((cap) => asString(cap)).filter(Boolean);
      }
    }
  }
  return {
    enabled: raw.enabled !== false,
    defaultStrategy: asString(raw.default_strategy) || STRATEGY_FALLBACK,
    combos,
    capabilities,
  };
};

const toWireConfig = (config: ComboConfig): PluginConfigObject => ({
  enabled: config.enabled,
  default_strategy: config.defaultStrategy,
  // Send every field explicitly: the management API merges objects, so omitting
  // a cleared field would silently keep its previous value.
  combos: config.combos.map((combo) => ({
    name: combo.name.trim(),
    models: combo.models.map((model) => model.trim()).filter(Boolean),
    strategy: combo.strategy,
    description: combo.description.trim(),
  })),
  capabilities: config.capabilities,
});

export function CombosPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification } = useNotificationStore();

  const [config, setConfig] = useState<ComboConfig | null>(null);
  const [plugin, setPlugin] = useState<PluginListEntry | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newComboName, setNewComboName] = useState('');

  const connected = connectionStatus === 'connected';
  const dirty = useMemo(
    () => (config ? JSON.stringify(toWireConfig(config)) !== savedSnapshot : false),
    [config, savedSnapshot]
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
      const [plugins, pluginConfig] = await Promise.all([
        pluginsApi.list(),
        pluginsApi.getConfig(PLUGIN_ID),
      ]);
      const entry = plugins.plugins.find((item) => item.id === PLUGIN_ID) ?? null;
      setPlugin(entry);
      const normalized = normalizeConfig(pluginConfig);
      setConfig(normalized);
      setSavedSnapshot(JSON.stringify(toWireConfig(normalized)));
      try {
        setModels(await edgeApi.listModels());
      } catch {
        setModels([]);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('combos.load_failed')));
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateCombo = (index: number, patch: Partial<Combo>) => {
    setConfig((current) => {
      if (!current) return current;
      const combos = current.combos.map((combo, i) => (i === index ? { ...combo, ...patch } : combo));
      return { ...current, combos };
    });
  };

  const addCombo = () => {
    const name = newComboName.trim();
    if (!name || !config) return;
    if (config.combos.some((combo) => combo.name === name)) {
      showNotification(t('combos.name_exists'), 'error');
      return;
    }
    setConfig({
      ...config,
      combos: [...config.combos, { name, models: [], strategy: '', description: '' }],
    });
    setNewComboName('');
  };

  const removeCombo = (index: number) => {
    setConfig((current) =>
      current ? { ...current, combos: current.combos.filter((_, i) => i !== index) } : current
    );
  };

  const addMember = (index: number, model: string) => {
    const value = model.trim();
    if (!value) return;
    setConfig((current) => {
      if (!current) return current;
      const combo = current.combos[index];
      if (!combo || combo.models.includes(value)) return current;
      const combos = current.combos.map((item, i) =>
        i === index ? { ...item, models: [...item.models, value] } : item
      );
      return { ...current, combos };
    });
  };

  const removeMember = (comboIndex: number, modelIndex: number) => {
    setConfig((current) => {
      if (!current) return current;
      const combos = current.combos.map((combo, i) =>
        i === comboIndex ? { ...combo, models: combo.models.filter((_, m) => m !== modelIndex) } : combo
      );
      return { ...current, combos };
    });
  };

  const moveMember = (comboIndex: number, modelIndex: number, delta: number) => {
    setConfig((current) => {
      if (!current) return current;
      const combos = current.combos.map((combo, i) => {
        if (i !== comboIndex) return combo;
        const target = modelIndex + delta;
        if (target < 0 || target >= combo.models.length) return combo;
        const next = [...combo.models];
        const [moved] = next.splice(modelIndex, 1);
        next.splice(target, 0, moved);
        return { ...combo, models: next };
      });
      return { ...current, combos };
    });
  };

  const toggleCapability = (model: string, capability: Capability) => {
    setConfig((current) => {
      if (!current) return current;
      const existing = new Set(current.capabilities[model] ?? []);
      if (existing.has(capability)) existing.delete(capability);
      else existing.add(capability);
      const capabilities = { ...current.capabilities };
      if (existing.size === 0) delete capabilities[model];
      else capabilities[model] = Array.from(existing);
      return { ...current, capabilities };
    });
  };

  const validate = (): string => {
    if (!config) return '';
    const seen = new Set<string>();
    for (const combo of config.combos) {
      const name = combo.name.trim();
      if (!name) return t('combos.error_name_required');
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) return t('combos.error_name_charset', { name });
      if (seen.has(name)) return t('combos.error_name_duplicate', { name });
      seen.add(name);
      if (combo.models.length === 0) return t('combos.error_members_required', { name });
      if (combo.models.some((model) => !model.trim())) return t('combos.error_member_empty', { name });
    }
    return '';
  };

  const save = async () => {
    if (!config) return;
    const validationError = validate();
    if (validationError) {
      showNotification(validationError, 'error');
      return;
    }
    setSaving(true);
    try {
      await pluginsApi.patchConfig(PLUGIN_ID, toWireConfig(config));
      setSavedSnapshot(JSON.stringify(toWireConfig(config)));
      showNotification(t('combos.saved'), 'success');
      await load();
    } catch (err: unknown) {
      showNotification(getErrorMessage(err, t('combos.save_failed')), 'error');
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

  if (error) {
    return (
      <div className={styles.stateShell}>
        <EmptyState title={t('combos.unavailable')} description={error} />
      </div>
    );
  }

  const usedModels = Array.from(new Set(config?.combos.flatMap((combo) => combo.models) ?? [])).sort();

  return (
    <div className={styles.page}>
      <Card
        title={t('combos.title')}
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
        <p className={styles.hint}>{t('combos.intro')}</p>
        {plugin && !plugin.registered ? (
          <div className={styles.warning}>{t('combos.plugin_missing')}</div>
        ) : null}
        <div className={styles.row}>
          <ToggleSwitch
            checked={config?.enabled ?? true}
            onChange={(enabled) => setConfig((current) => (current ? { ...current, enabled } : current))}
            label={t('combos.enabled')}
          />
          <label className={styles.field}>
            <span>{t('combos.default_strategy')}</span>
            <Select
              value={config?.defaultStrategy ?? STRATEGY_FALLBACK}
              options={[
                { value: STRATEGY_FALLBACK, label: t('combos.strategy_fallback') },
                { value: STRATEGY_ROUND_ROBIN, label: t('combos.strategy_round_robin') },
              ]}
              onChange={(value) =>
                setConfig((current) => (current ? { ...current, defaultStrategy: value } : current))
              }
              size="sm"
            />
          </label>
        </div>
        <datalist id="combo-model-options">
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </Card>

      <Card
        title={t('combos.list_title', { count: config?.combos.length ?? 0 })}
        extra={
          <div className={styles.addCombo}>
            <Input
              value={newComboName}
              placeholder={t('combos.new_name_placeholder')}
              onChange={(event) => setNewComboName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addCombo();
              }}
            />
            <Button variant="secondary" onClick={addCombo} disabled={!newComboName.trim()}>
              {t('combos.add')}
            </Button>
          </div>
        }
      >
        {config && config.combos.length === 0 ? (
          <EmptyState title={t('combos.empty_title')} description={t('combos.empty_description')} />
        ) : null}
        <div className={styles.comboList}>
          {config?.combos.map((combo, index) => (
            <div className={styles.combo} key={`${combo.name}-${index}`}>
              <div className={styles.comboHead}>
                <Input
                  value={combo.name}
                  aria-label={t('combos.name')}
                  onChange={(event) => updateCombo(index, { name: event.target.value })}
                />
                <Select
                  value={combo.strategy}
                  options={[
                    { value: '', label: t('combos.strategy_inherit') },
                    { value: STRATEGY_FALLBACK, label: t('combos.strategy_fallback') },
                    { value: STRATEGY_ROUND_ROBIN, label: t('combos.strategy_round_robin') },
                  ]}
                  onChange={(value) => updateCombo(index, { strategy: value })}
                  size="sm"
                />
                <Button variant="secondary" onClick={() => removeCombo(index)}>
                  {t('combos.remove')}
                </Button>
              </div>
              <Input
                value={combo.description}
                placeholder={t('combos.description_placeholder')}
                onChange={(event) => updateCombo(index, { description: event.target.value })}
              />
              <div className={styles.members}>
                {combo.models.map((model, modelIndex) => (
                  <div className={styles.member} key={`${model}-${modelIndex}`}>
                    <span className={styles.memberOrder}>{modelIndex + 1}</span>
                    <code className={styles.memberName}>{model}</code>
                    <Button
                      variant="ghost"
                      aria-label={t('combos.move_up')}
                      onClick={() => moveMember(index, modelIndex, -1)}
                      disabled={modelIndex === 0}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={t('combos.move_down')}
                      onClick={() => moveMember(index, modelIndex, 1)}
                      disabled={modelIndex === combo.models.length - 1}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={t('combos.remove_member')}
                      onClick={() => removeMember(index, modelIndex)}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                <MemberAdder onAdd={(model) => addMember(index, model)} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {usedModels.length > 0 ? (
        <Card title={t('combos.capabilities_title')} extra={null}>
          <p className={styles.hint}>{t('combos.capabilities_hint')}</p>
          <div className={styles.capList}>
            {usedModels.map((model) => (
              <div className={styles.capRow} key={model}>
                <code>{model}</code>
                <div className={styles.caps}>
                  {CAPABILITIES.map((capability) => {
                    const active = (config?.capabilities[model] ?? []).includes(capability);
                    return (
                      <button
                        type="button"
                        key={capability}
                        className={active ? styles.capActive : styles.cap}
                        onClick={() => toggleCapability(model, capability)}
                        aria-pressed={active}
                      >
                        {t(`combos.cap_${capability}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function MemberAdder({ onAdd }: { onAdd: (model: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value.trim()) return;
    onAdd(value);
    setValue('');
  };
  return (
    <div className={styles.memberAdd}>
      <Input
        list="combo-model-options"
        value={value}
        placeholder={t('combos.add_member_placeholder')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />
      <Button variant="secondary" onClick={submit} disabled={!value.trim()}>
        {t('combos.add_member')}
      </Button>
    </div>
  );
}
