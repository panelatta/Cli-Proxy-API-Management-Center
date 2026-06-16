import type { ApiKeyEntry } from '@/types';

export const normalizeAccessApiKeyEntry = (item: unknown): ApiKeyEntry | null => {
  const record =
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : null;
  const apiKey =
    typeof item === 'string'
      ? item
      : record
        ? (record['api-key'] ?? record.apiKey ?? record.key ?? record.Key)
        : '';
  const trimmed = String(apiKey ?? '').trim();
  if (!trimmed) return null;
  const name = record ? String(record.name ?? '').trim() : '';
  return name ? { apiKey: trimmed, name } : { apiKey: trimmed };
};

export const normalizeAccessApiKeyEntries = (input: unknown): ApiKeyEntry[] => {
  const arr = Array.isArray(input) ? input : [];
  return arr.map(normalizeAccessApiKeyEntry).filter(Boolean) as ApiKeyEntry[];
};

export const serializeAccessApiKeyEntry = (entry: ApiKeyEntry) => {
  const apiKey = entry.apiKey.trim();
  const name = entry.name?.trim() ?? '';
  return {
    'api-key': apiKey,
    ...(name ? { name } : {}),
  };
};
