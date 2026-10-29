import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export interface EdgeEndpointSettings {
  enabled: boolean;
  model: string;
}

export interface EdgeTranscriptionSettings extends EdgeEndpointSettings {
  maxConcurrent: number;
}

export interface EdgeSettings {
  typesafe: EdgeEndpointSettings;
  embeddings: EdgeEndpointSettings;
  transcriptions: EdgeTranscriptionSettings;
}

export interface EdgeProviders {
  typesafe: boolean;
  mistral: boolean;
  groq: boolean;
}

export interface EdgeStatus {
  version: string;
  uptimeSeconds: number;
  providers: EdgeProviders;
  persisted: boolean;
  upstream: string;
  settings: EdgeSettings;
  maxUploadMb: number;
  maxJsonMb: number;
}

const asString = (value: unknown): string => (value === undefined || value === null ? '' : String(value));
const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const asNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeEndpoint = (value: unknown, fallbackModel: string): EdgeEndpointSettings => {
  const record = isRecord(value) ? value : {};
  return {
    enabled: asBoolean(record.enabled, true),
    model: asString(record.model) || fallbackModel,
  };
};

const normalizeSettings = (value: unknown): EdgeSettings => {
  const record = isRecord(value) ? value : {};
  const transcriptions = isRecord(record.transcriptions) ? record.transcriptions : {};
  return {
    typesafe: normalizeEndpoint(record.typesafe, 'jev-latest'),
    embeddings: normalizeEndpoint(record.embeddings, 'mistral-embed'),
    transcriptions: {
      enabled: asBoolean(transcriptions.enabled, true),
      model: asString(transcriptions.model) || 'whisper-large-v3',
      maxConcurrent: asNumber(transcriptions.max_concurrent, 2),
    },
  };
};

const toWireSettings = (settings: EdgeSettings) => ({
  typesafe: { enabled: settings.typesafe.enabled, model: settings.typesafe.model.trim() },
  embeddings: { enabled: settings.embeddings.enabled, model: settings.embeddings.model.trim() },
  transcriptions: {
    enabled: settings.transcriptions.enabled,
    model: settings.transcriptions.model.trim(),
    max_concurrent: settings.transcriptions.maxConcurrent,
  },
});

export const edgeApi = {
  async getStatus(): Promise<EdgeStatus> {
    const data = await apiClient.get<unknown>('/edge-admin/status');
    const record = isRecord(data) ? data : {};
    const providers = isRecord(record.providers) ? record.providers : {};
    const limits = isRecord(record.limits) ? record.limits : {};
    return {
      version: asString(record.version),
      uptimeSeconds: asNumber(record.uptime_seconds, 0),
      providers: {
        typesafe: asBoolean(providers.typesafe, false),
        mistral: asBoolean(providers.mistral, false),
        groq: asBoolean(providers.groq, false),
      },
      persisted: asBoolean(record.persisted, false),
      upstream: asString(record.upstream),
      settings: normalizeSettings(record.settings),
      maxUploadMb: asNumber(limits.max_upload_mb, 25),
      maxJsonMb: asNumber(limits.max_json_mb, 32),
    };
  },

  async getSettings(): Promise<EdgeSettings> {
    const data = await apiClient.get<unknown>('/edge-admin/config');
    return normalizeSettings(data);
  },

  async saveSettings(settings: EdgeSettings): Promise<EdgeSettings> {
    const data = await apiClient.put<unknown>('/edge-admin/config', toWireSettings(settings));
    return normalizeSettings(data);
  },

  /** Model ids from the proxy, for dashboard suggestions. */
  async listModels(): Promise<string[]> {
    const data = await apiClient.get<unknown>('/edge-admin/models');
    const record = isRecord(data) ? data : {};
    const items = Array.isArray(record.data) ? record.data : [];
    const ids = items
      .map((item) => (isRecord(item) ? asString(item.id) : ''))
      .filter((id) => id.length > 0);
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  },
};
