/**
 * API 密钥管理
 */

import type { ApiKeyEntry } from '@/types';
import { normalizeAccessApiKeyEntries, serializeAccessApiKeyEntry } from '@/utils/apiKeys';
import { apiClient } from './client';

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys ?? data['api-key-entries'] ?? data.apiKeyEntries;
    return normalizeAccessApiKeyEntries(keys).map((entry) => entry.apiKey);
  },

  async listEntries(): Promise<ApiKeyEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-key-entries');
    const entries = data['api-key-entries'] ?? data.apiKeyEntries ?? data.items ?? data;
    return normalizeAccessApiKeyEntries(entries);
  },

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),

  replaceEntries: (entries: ApiKeyEntry[]) =>
    apiClient.put('/api-key-entries', entries.map(serializeAccessApiKeyEntry)),

  updateEntry: (index: number, value: ApiKeyEntry) =>
    apiClient.patch('/api-key-entries', {
      index,
      value: serializeAccessApiKeyEntry(value),
    }),

  addEntry: (value: ApiKeyEntry) =>
    apiClient.patch('/api-key-entries', {
      new: serializeAccessApiKeyEntry(value),
    }),

  deleteEntry: (index: number) => apiClient.delete(`/api-key-entries?index=${index}`),
};
