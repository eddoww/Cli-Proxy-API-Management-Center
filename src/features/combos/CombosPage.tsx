import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConnectionCard } from '@/components/common/ConnectionCard';
import { CopyButton } from '@/components/common/CopyButton';
import { Snippet } from '@/components/common/Snippet';
import { useClientAccess } from '@/features/shared/useClientAccess';
import { chatCurl, chatRequestBody } from '@/features/shared/endpointSnippets';
import { pluginsApi, edgeApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import type { PluginListEntry } from '@/types';
import {
  CAPABILITIES,
  STRATEGY_FALLBACK,
  STRATEGY_ROUND_ROBIN,
  effectiveCapabilities,
  hasOverride,
  normalizeConfig,
  resetCapabilityOverride,
  stableStringify,
  toWireConfig,
  toggleCapability,
  validateCombos,
  type Capability,
  type Combo,
  type ComboConfig,
  type ValidationIssue,
} from './combosConfig';
import styles from './CombosPage.module.scss';

const PLUGIN_ID = 'combo-router';

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
  const access = useClientAccess();
  const [tests, setTests] = useState<Record<string, { state: 'idle' | 'running' | 'ok' | 'error'; message: string }>>({});

  const connected = connectionStatus === 'connected';
  const dirty = useMemo(
    () => (config ? stableStringify(toWireConfig(config)) !== savedSnapshot : false),
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
      setPlugin(plugins.plugins.find((item) => item.id === PLUGIN_ID) ?? null);
      const normalized = normalizeConfig(pluginConfig);
      setConfig(normalized);
      setSavedSnapshot(stableStringify(toWireConfig(normalized)));
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
      return { ...current, combos: current.combos.map((combo, i) => (i === index ? { ...combo, ...patch } : combo)) };
    });
  };

  const addCombo = () => {
    const name = newComboName.trim();
    if (!name || !config) return;
    if (config.combos.some((combo) => combo.name.trim() === name)) {
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
      return {
        ...current,
        combos: current.combos.map((item, i) =>
          i === index ? { ...item, models: [...item.models, value] } : item
        ),
      };
    });
  };

  const removeMember = (comboIndex: number, modelIndex: number) => {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        combos: current.combos.map((combo, i) =>
          i === comboIndex ? { ...combo, models: combo.models.filter((_, m) => m !== modelIndex) } : combo
        ),
      };
    });
  };

  const moveMember = (comboIndex: number, modelIndex: number, delta: number) => {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        combos: current.combos.map((combo, i) => {
          if (i !== comboIndex) return combo;
          const target = modelIndex + delta;
          if (target < 0 || target >= combo.models.length) return combo;
          const next = [...combo.models];
          const [moved] = next.splice(modelIndex, 1);
          next.splice(target, 0, moved);
          return { ...combo, models: next };
        }),
      };
    });
  };

  const onToggleCapability = (model: string, capability: Capability) => {
    setConfig((current) => (current ? toggleCapability(current, model, capability) : current));
  };

  const onResetCapabilities = (model: string) => {
    setConfig((current) => (current ? resetCapabilityOverride(current, model) : current));
  };

  const issueMessage = (issue: ValidationIssue): string => {
    switch (issue.code) {
      case 'name_required':
        return t('combos.error_name_required');
      case 'name_charset':
        return t('combos.error_name_charset', { name: issue.name });
      case 'name_duplicate':
        return t('combos.error_name_duplicate', { name: issue.name });
      case 'members_required':
        return t('combos.error_members_required', { name: issue.name });
      default:
        return t('combos.error_member_empty', { name: issue.name });
    }
  };

  const runTest = async (comboName: string) => {
    if (!access.baseUrl || !access.apiKey) return;
    setTests((current) => ({ ...current, [comboName]: { state: 'running', message: '' } }));
    const started = performance.now();
    try {
      const response = await fetch(`${access.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access.apiKey}`,
        },
        body: JSON.stringify(chatRequestBody(comboName)),
      });
      const payload = (await response.json().catch(() => null)) as
        | { model?: string; error?: { message?: string } }
        | null;
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
      }
      const elapsed = Math.round(performance.now() - started);
      setTests((current) => ({
        ...current,
        [comboName]: { state: 'ok', message: t('connect.test_ok', { model: payload?.model ?? comboName, ms: elapsed }) },
      }));
    } catch (err) {
      setTests((current) => ({
        ...current,
        [comboName]: { state: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    }
  };

  const save = async () => {
    if (!config) return;
    const issues = validateCombos(config);
    if (issues.length > 0) {
      showNotification(issueMessage(issues[0]), 'error');
      return;
    }
    setSaving(true);
    try {
      const wire = toWireConfig(config);
      await pluginsApi.patchConfig(PLUGIN_ID, wire);
      setSavedSnapshot(stableStringify(wire));
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

  const pluginMissing = !plugin || !plugin.registered;
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
        {pluginMissing ? <div className={styles.warning}>{t('combos.plugin_missing')}</div> : null}
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

      <ConnectionCard
        baseUrl={access.baseUrl}
        apiKey={access.apiKey}
        note={t('connect.combos_note')}
      />

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
          {/* Keyed by position: combos are never reordered here, and keying by
              name would remount the card (and drop input focus) on each edit. */}
          {config?.combos.map((combo, index) => (
            <div className={styles.combo} key={index}>
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
              <div className={styles.connectRow}>
                <span className={styles.connectLabel}>{t('connect.use_it')}</span>
                <code className={styles.connectModel}>{combo.name || t('combos.name')}</code>
                <CopyButton value={combo.name} label={t('connect.copy_model')} />
                <Snippet
                  className={styles.snippetInline}
                  label={t('connect.curl_label')}
                  code={chatCurl(access.baseUrl, access.apiKey, combo.name)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void runTest(combo.name)}
                  loading={tests[combo.name]?.state === 'running'}
                  disabled={!access.apiKey || !combo.name}
                >
                  {t('connect.test')}
                </Button>
                {tests[combo.name] && tests[combo.name].state !== 'running' ? (
                  <span
                    className={
                      tests[combo.name].state === 'ok' ? styles.testOk : styles.testFail
                    }
                  >
                    {tests[combo.name].message}
                  </span>
                ) : null}
              </div>
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

      {usedModels.length > 0 && config ? (
        <Card title={t('combos.capabilities_title')}>
          <p className={styles.hint}>{t('combos.capabilities_hint')}</p>
          <div className={styles.capList}>
            {usedModels.map((model) => {
              const overridden = hasOverride(config, model);
              const active = effectiveCapabilities(config, model);
              return (
                <div className={styles.capRow} key={model}>
                  <code>{model}</code>
                  <span className={overridden ? styles.capCustom : styles.capBuiltin}>
                    {overridden ? t('combos.cap_override') : t('combos.cap_builtin')}
                  </span>
                  <div className={styles.caps}>
                    {CAPABILITIES.map((capability) => {
                      const on = active.includes(capability);
                      return (
                        <button
                          type="button"
                          key={capability}
                          className={on ? styles.capActive : styles.cap}
                          onClick={() => onToggleCapability(model, capability)}
                          aria-pressed={on}
                        >
                          {t(`combos.cap_${capability}`)}
                        </button>
                      );
                    })}
                  </div>
                  {overridden ? (
                    <Button variant="ghost" size="sm" onClick={() => onResetCapabilities(model)}>
                      {t('combos.cap_reset')}
                    </Button>
                  ) : null}
                </div>
              );
            })}
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
