import { describe, expect, test } from 'bun:test';
import {
  OPENAI_BASE,
  chatCurl,
  chatRequestBody,
  embeddingsCurl,
  maskSecret,
  systemOneCurl,
  transcriptionsCurl,
} from '@/features/shared/endpointSnippets';

describe('connection helpers', () => {
  test('builds the OpenAI base exactly once', () => {
    expect(OPENAI_BASE('http://host:8317')).toBe('http://host:8317/v1');
    expect(OPENAI_BASE('http://host:8317/')).toBe('http://host:8317/v1');
    expect(OPENAI_BASE('http://host:8317/v1')).toBe('http://host:8317/v1');
    expect(OPENAI_BASE('')).toBe('');
  });

  test('masks keys without exposing the middle', () => {
    const masked = maskSecret('sk-cpa-abcdefghijklmnop');
    expect(masked.startsWith('sk-cpa')).toBe(true);
    expect(masked).toContain('…');
    expect(masked).not.toContain('defghijklm');
    expect(maskSecret('short')).toBe('sh…rt');
    expect(maskSecret('')).toBe('');
  });

  test('chat curl carries url, key and model', () => {
    const snippet = chatCurl('http://host/v1', 'sk-test', 'smart');
    expect(snippet).toContain('http://host/v1/chat/completions');
    expect(snippet).toContain('Bearer sk-test');
    expect(snippet).toContain('"model":"smart"');
  });

  test('curl omits the auth header when no key is configured', () => {
    expect(chatCurl('http://host/v1', '', 'smart')).not.toContain('Authorization');
  });

  test('edge snippets target their own paths', () => {
    expect(systemOneCurl('http://h/v1', 'k', 'jev-latest')).toContain('/v1/systemone');
    expect(systemOneCurl('http://h/v1', 'k', 'jev-latest')).toContain('"type":"noul"');
    expect(embeddingsCurl('http://h/v1', 'k', 'mistral-embed')).toContain('/v1/embeddings');
    expect(transcriptionsCurl('http://h/v1', 'k', 'whisper-large-v3')).toContain('-F file=@audio.mp3');
  });

  test('test bodies are minimal', () => {
    expect(chatRequestBody('smart').max_tokens).toBeLessThanOrEqual(16);
    expect(chatRequestBody('smart').model).toBe('smart');
  });
});
