/**
 * Pure helpers for the copy-paste connection panels. Kept free of React so the
 * exact strings shown to the user can be unit tested.
 */

export const OPENAI_BASE = (apiBase: string): string => {
  const trimmed = (apiBase || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
};

export const maskSecret = (secret: string): string => {
  const value = (secret || '').trim();
  if (!value) return '';
  if (value.length <= 10) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
};

const authHeader = (apiKey: string): string =>
  apiKey ? `  -H "Authorization: Bearer ${apiKey}" \\\n` : '';

export const chatCurl = (baseUrl: string, apiKey: string, model: string): string =>
  `curl ${baseUrl}/chat/completions \\\n` +
  authHeader(apiKey) +
  `  -H "Content-Type: application/json" \\\n` +
  `  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello!"}]}'`;

export const systemOneCurl = (baseUrl: string, apiKey: string, model: string): string =>
  `curl ${baseUrl}/systemone \\\n` +
  authHeader(apiKey) +
  `  -H "Content-Type: application/json" \\\n` +
  `  -d '{"model":"${model}","state":{"ticket":"The login page returns 500 since the upgrade."},` +
  `"questions":{"is_bug":{"type":"noul","instructions":"Is this a bug report?"}}}'`;

export const embeddingsCurl = (baseUrl: string, apiKey: string, model: string): string =>
  `curl ${baseUrl}/embeddings \\\n` +
  authHeader(apiKey) +
  `  -H "Content-Type: application/json" \\\n` +
  `  -d '{"model":"${model}","input":["hello world"]}'`;

export const transcriptionsCurl = (baseUrl: string, apiKey: string, model: string): string =>
  `curl ${baseUrl}/audio/transcriptions \\\n` +
  authHeader(apiKey) +
  `  -F file=@audio.mp3 \\\n` +
  `  -F model=${model}`;

export const chatRequestBody = (model: string) => ({
  model,
  messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
  max_tokens: 16,
});

export const systemOneRequestBody = (model: string) => ({
  model,
  state: { ticket: 'The login page returns 500 since the upgrade.' },
  questions: {
    is_bug: { type: 'noul', instructions: 'Is this a bug report?' },
  },
});

export const embeddingsRequestBody = (model: string) => ({
  model,
  input: ['connection test'],
});
