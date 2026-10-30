import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiKeysApi } from '@/services/api';
import { useAuthStore } from '@/stores';

export interface ClientAccess {
  /** OpenAI-compatible base, e.g. http://host/v1 */
  baseUrl: string;
  /** First client access key configured on the proxy. */
  apiKey: string;
  loading: boolean;
  error: string;
}

/** Connection details an application needs to talk to this proxy. */
export function useClientAccess(): ClientAccess {
  const apiBase = useAuthStore((state) => state.apiBase);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const baseUrl = useMemo(() => {
    const trimmed = (apiBase || '').replace(/\/+$/, '');
    if (!trimmed) return '';
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
  }, [apiBase]);

  const load = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const keys = await apiKeysApi.list();
      setApiKey(keys[0] ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  return { baseUrl, apiKey, loading, error };
}
