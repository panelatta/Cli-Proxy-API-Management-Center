import { normalizeAccessApiKeyEntries, serializeAccessApiKeyEntry } from '@/utils/apiKeys';
/** Client access keys are a direct config list, not upstream provider groups. */
import { apiClient } from './client';
import { getConfigValue, guardConfigConnection } from './configValue';

const PATH = '/config/access/api-keys';

const assertIndex = (keys: unknown[], index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
    throw new RangeError('API key index out of range');
  }
};

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const data = await getConfigValue<unknown>(PATH, []);
    return normalizeAccessApiKeyEntries(data).map((entry) => entry.apiKey);
  },

  async listEntries() {
    return normalizeAccessApiKeyEntries(await getConfigValue<unknown>(PATH, []));
  },

  replace: (keys: string[]) => apiClient.put(PATH, keys),

  async update(index: number, value: string) {
    const assertConnection = guardConfigConnection();
    const keys = await apiKeysApi.listEntries();
    assertConnection();
    assertIndex(keys, index);
    keys[index] = { ...keys[index], apiKey: value };
    return apiClient.put(
      PATH,
      keys.map((entry) =>
        entry.name || entry.forceModel || entry.disabled
          ? serializeAccessApiKeyEntry(entry)
          : entry.apiKey
      )
    );
  },

  async delete(index: number) {
    const assertConnection = guardConfigConnection();
    const keys = await apiKeysApi.listEntries();
    assertConnection();
    assertIndex(keys, index);
    keys.splice(index, 1);
    return apiClient.put(
      PATH,
      keys.map((entry) =>
        entry.name || entry.forceModel || entry.disabled
          ? serializeAccessApiKeyEntry(entry)
          : entry.apiKey
      )
    );
  },
};
