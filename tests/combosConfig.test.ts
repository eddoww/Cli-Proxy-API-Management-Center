import { describe, expect, test } from 'bun:test';
import {
  CAPABILITIES,
  builtinCapabilities,
  effectiveCapabilities,
  hasOverride,
  normalizeConfig,
  resetCapabilityOverride,
  stableStringify,
  toWireConfig,
  toggleCapability,
  validateCombos,
  type ComboConfig,
} from '@/features/combos/combosConfig';

const base = (): ComboConfig => ({
  enabled: true,
  defaultStrategy: 'fallback',
  combos: [{ name: 'smart', models: ['grok-4.7', 'deepseek-v4-pro'], strategy: '', description: '' }],
  capabilities: {},
});

describe('builtin capability table', () => {
  test('mirrors the plugin table', () => {
    expect(builtinCapabilities('grok-4.7')).toEqual(['vision', 'tools']);
    expect(builtinCapabilities('gpt-oss-120b')).toEqual(['tools']);
    expect(builtinCapabilities('openrouter/gemini-2.5-flash')).toEqual([
      'vision',
      'pdf',
      'audio',
      'video',
      'tools',
    ]);
    expect(builtinCapabilities('mystery-model')).toEqual([]);
  });
});

describe('capability overrides', () => {
  test('first toggle seeds from built-ins instead of replacing them', () => {
    const config = base();
    const next = toggleCapability(config, 'grok-4.7', 'pdf');
    // grok-4.7 is built-in [vision, tools]; adding pdf must keep both.
    expect(next.capabilities['grok-4.7']).toEqual(['vision', 'pdf', 'tools']);
  });

  test('toggling off removes only that capability', () => {
    const config = base();
    const next = toggleCapability(config, 'grok-4.7', 'vision');
    expect(next.capabilities['grok-4.7']).toEqual(['tools']);
  });

  test('reset returns the model to its built-in set', () => {
    const config = toggleCapability(base(), 'grok-4.7', 'audio');
    const reset = resetCapabilityOverride(config, 'grok-4.7');
    expect(hasOverride(reset, 'grok-4.7')).toBe(false);
    expect(effectiveCapabilities(reset, 'grok-4.7')).toEqual(['vision', 'tools']);
  });
});

describe('wire format', () => {
  test('sends cleared fields explicitly so merges cannot keep stale values', () => {
    const wire = toWireConfig(base());
    const combos = wire.combos as Array<Record<string, unknown>>;
    expect(combos[0]).toEqual({
      name: 'smart',
      models: ['grok-4.7', 'deepseek-v4-pro'],
      strategy: '',
      description: '',
    });
  });

  test('round-trips through normalizeConfig', () => {
    const config = base();
    const normalized = normalizeConfig(toWireConfig(config));
    expect(normalized.combos[0].name).toBe('smart');
    expect(normalized.defaultStrategy).toBe('fallback');
  });

  test('stableStringify ignores object key order', () => {
    const a = { capabilities: { 'grok-4.7': ['vision'], 'gpt-5': ['tools'] } };
    const b = { capabilities: { 'gpt-5': ['tools'], 'grok-4.7': ['vision'] } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe('validation', () => {
  test('accepts a well-formed config', () => {
    expect(validateCombos(base())).toEqual([]);
  });

  test('reports duplicates and empty members', () => {
    const config = base();
    config.combos.push({ name: 'smart', models: [], strategy: '', description: '' });
    const issues = validateCombos(config);
    expect(issues.map((issue) => issue.code)).toContain('name_duplicate');
    expect(issues.map((issue) => issue.code)).toContain('members_required');
  });

  test('rejects names with spaces or slashes', () => {
    const config = base();
    config.combos[0].name = 'bad name/one';
    expect(validateCombos(config).map((issue) => issue.code)).toContain('name_charset');
  });
});

describe('capability vocabulary', () => {
  test('normalizeConfig drops unknown capabilities', () => {
    const config = normalizeConfig({ capabilities: { 'grok-4.7': ['vision', 'telepathy'] } });
    expect(config.capabilities['grok-4.7']).toEqual(['vision']);
    expect(CAPABILITIES).toHaveLength(5);
  });
});
