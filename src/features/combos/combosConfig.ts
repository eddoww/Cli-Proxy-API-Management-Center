import type { PluginConfigObject } from '@/types';
import { isRecord } from '@/utils/helpers';

export const STRATEGY_FALLBACK = 'fallback';
export const STRATEGY_ROUND_ROBIN = 'round-robin';

export const CAPABILITIES = ['vision', 'audio', 'video', 'pdf', 'tools'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface Combo {
  name: string;
  models: string[];
  strategy: string;
  description: string;
}

export interface ComboConfig {
  enabled: boolean;
  defaultStrategy: string;
  combos: Combo[];
  /** Explicit per-model overrides. A model without an entry uses its built-in set. */
  capabilities: Record<string, Capability[]>;
}

export type ValidationIssue =
  | { code: 'name_required' }
  | { code: 'name_charset'; name: string }
  | { code: 'name_duplicate'; name: string }
  | { code: 'members_required'; name: string }
  | { code: 'member_empty'; name: string };

const asString = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);

/**
 * Mirror of the plugin's built-in capability table (catalog.go). Shown as the
 * baseline in the editor so toggling a chip never silently drops a capability.
 */
const BUILTIN_PREFIXES: ReadonlyArray<{ prefix: string; caps: readonly Capability[] }> = [
  { prefix: 'claude', caps: ['vision', 'pdf', 'tools'] },
  { prefix: 'gpt-5', caps: ['vision', 'pdf', 'tools'] },
  { prefix: 'gpt-4', caps: ['vision', 'pdf', 'tools'] },
  { prefix: 'gpt-oss', caps: ['tools'] },
  { prefix: 'gpt-3', caps: ['tools'] },
  { prefix: 'o1', caps: ['vision', 'pdf', 'tools'] },
  { prefix: 'o3', caps: ['vision', 'pdf', 'tools'] },
  { prefix: 'o4', caps: ['vision', 'pdf', 'tools'] },
  { prefix: 'gemini', caps: ['vision', 'pdf', 'audio', 'video', 'tools'] },
  { prefix: 'grok-4', caps: ['vision', 'tools'] },
  { prefix: 'grok-3', caps: ['vision', 'tools'] },
  { prefix: 'grok-2', caps: ['tools'] },
  { prefix: 'kimi', caps: ['vision', 'tools'] },
  { prefix: 'qwen-vl', caps: ['vision', 'pdf', 'tools'] },
  { prefix: 'glm-4v', caps: ['vision', 'tools'] },
  { prefix: 'deepseek', caps: ['tools'] },
  { prefix: 'mistral', caps: ['tools'] },
  { prefix: 'codestral', caps: ['tools'] },
  { prefix: 'llama', caps: ['tools'] },
  { prefix: 'qwen', caps: ['tools'] },
];

const bareModel = (model: string): string => {
  const lower = model.toLowerCase().trim();
  const slash = lower.lastIndexOf('/');
  return slash >= 0 ? lower.slice(slash + 1) : lower;
};

export const builtinCapabilities = (model: string): Capability[] => {
  const bare = bareModel(model);
  const hit = BUILTIN_PREFIXES.find((entry) => bare.startsWith(entry.prefix));
  return hit ? [...hit.caps] : [];
};

export const hasOverride = (config: ComboConfig, model: string): boolean =>
  Object.prototype.hasOwnProperty.call(config.capabilities, model);

export const effectiveCapabilities = (config: ComboConfig, model: string): Capability[] =>
  hasOverride(config, model) ? config.capabilities[model] : builtinCapabilities(model);

/**
 * Toggling seeds the override from the built-in set first, so the result is a
 * delta over the visible baseline rather than a replacement of it.
 */
export const toggleCapability = (config: ComboConfig, model: string, capability: Capability): ComboConfig => {
  const next = new Set(effectiveCapabilities(config, model));
  if (next.has(capability)) next.delete(capability);
  else next.add(capability);
  return {
    ...config,
    capabilities: {
      ...config.capabilities,
      [model]: CAPABILITIES.filter((entry) => next.has(entry)),
    },
  };
};

export const resetCapabilityOverride = (config: ComboConfig, model: string): ComboConfig => {
  const capabilities = { ...config.capabilities };
  delete capabilities[model];
  return { ...config, capabilities };
};

export const normalizeConfig = (raw: PluginConfigObject): ComboConfig => {
  const combos = Array.isArray(raw.combos)
    ? raw.combos.map((value): Combo => {
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
      })
    : [];
  const capabilities: Record<string, Capability[]> = {};
  if (isRecord(raw.capabilities)) {
    for (const [model, caps] of Object.entries(raw.capabilities)) {
      if (!Array.isArray(caps)) continue;
      const filtered = caps
        .map((cap) => asString(cap).toLowerCase())
        .filter((cap): cap is Capability => (CAPABILITIES as readonly string[]).includes(cap));
      capabilities[model] = filtered;
    }
  }
  return {
    enabled: raw.enabled !== false,
    defaultStrategy: asString(raw.default_strategy) || STRATEGY_FALLBACK,
    combos,
    capabilities,
  };
};

/**
 * Send every field explicitly: the management API merges plugin objects, so an
 * omitted field would silently keep its previous value.
 */
export const toWireConfig = (config: ComboConfig): PluginConfigObject => ({
  enabled: config.enabled,
  default_strategy: config.defaultStrategy,
  combos: config.combos.map((combo) => ({
    name: combo.name.trim(),
    models: combo.models.map((model) => model.trim()).filter(Boolean),
    strategy: combo.strategy,
    description: combo.description.trim(),
  })),
  capabilities: config.capabilities,
});

export const validateCombos = (config: ComboConfig): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const combo of config.combos) {
    const name = combo.name.trim();
    if (!name) {
      issues.push({ code: 'name_required' });
      continue;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) issues.push({ code: 'name_charset', name });
    if (seen.has(name)) issues.push({ code: 'name_duplicate', name });
    seen.add(name);
    if (combo.models.length === 0) issues.push({ code: 'members_required', name });
    if (combo.models.some((model) => !model.trim())) issues.push({ code: 'member_empty', name });
  }
  return issues;
};

/** Deterministic JSON so key order never produces a false "unsaved" state. */
export const stableStringify = (value: unknown): string => {
  const sortValue = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortValue);
    if (isRecord(input)) {
      return Object.keys(input)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortValue(input[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(sortValue(value));
};
