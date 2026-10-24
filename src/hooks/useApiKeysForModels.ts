import { useCallback, useEffect, useRef } from 'react';
import { normalizeAccessApiKeyEntries } from '@/utils/apiKeys';
import { apiKeysApi } from '@/services/api/apiKeys';
import { useAuthStore, useConfigStore } from '@/stores';

/** Resolve active client keys for model discovery from config or the v8 API. */
export function useApiKeysForModels() {
  const apiBase = useAuthStore((state) => state.apiBase);
  const configApiKeys = useConfigStore((state) => state.config?.apiKeys);
  const configApiKeyEntries = useConfigStore((state) => state.config?.apiKeyEntries);
  const cacheRef = useRef<string[]>([]);

  useEffect(() => {
    cacheRef.current = [];
  }, [apiBase, configApiKeys, configApiKeyEntries]);

  return useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (force) {
        cacheRef.current = [];
      }
      if (cacheRef.current.length) {
        return cacheRef.current;
      }

      const configKeys = [
        ...new Set(
          normalizeAccessApiKeyEntries(configApiKeyEntries ?? configApiKeys)
            .filter((entry) => !entry.disabled)
            .sort(
              (a, b) =>
                Number(Boolean(a.allowedProviders?.length)) -
                Number(Boolean(b.allowedProviders?.length))
            )
            .map((entry) => entry.apiKey)
        ),
      ];
      if (configKeys.length) {
        cacheRef.current = configKeys;
        return configKeys;
      }

      try {
        const list = await apiKeysApi.listEntries();
        const normalized = [
          ...new Set(
            list
              .filter((entry) => !entry.disabled)
              .sort(
                (a, b) =>
                  Number(Boolean(a.allowedProviders?.length)) -
                  Number(Boolean(b.allowedProviders?.length))
              )
              .map((entry) => entry.apiKey)
          ),
        ];
        if (normalized.length) {
          cacheRef.current = normalized;
        }
        return normalized;
      } catch {
        return [];
      }
    },
    [configApiKeys, configApiKeyEntries]
  );
}
