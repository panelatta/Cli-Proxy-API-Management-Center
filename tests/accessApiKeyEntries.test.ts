import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';
import { normalizeConfigResponse } from '../src/services/api/transformers';

const fixture = `access:
  api-keys:
    - api-key: fixture-client
      name: Laptop
      force-model: pinned-model
api-keys:
  codex:
    - name: upstream
      base-url: https://example.test
      keys: [{api-key: fixture-upstream}]
`;

test('v8 config exposes client names to usage statistics', () => {
  const config = normalizeConfigResponse(parseYaml(fixture));
  expect(config.apiKeys).toEqual(['fixture-client']);
  expect(config.apiKeyEntries).toEqual([
    { apiKey: 'fixture-client', name: 'Laptop', forceModel: 'pinned-model' },
  ]);
});

test('editing a client name preserves its model policy and upstream groups', () => {
  const baseline = runVisualConfig(fixture);
  expect(baseline.visualValues.apiKeysText).toBe('fixture-client');
  const entries = baseline.visualValues.apiKeyEntries.map((entry) => ({
    ...entry,
    name: 'Desktop',
  }));
  const config = runVisualConfig(fixture, [{ apiKeyEntries: entries }]);
  expect(config.visualDirty).toBe(true);
  const output = parseYaml(config.applyVisualChangesToYaml(fixture));
  expect(output.access['api-keys']).toEqual([
    { 'api-key': 'fixture-client', name: 'Desktop', 'force-model': 'pinned-model' },
  ]);
  expect(output['api-keys']).toEqual(parseYaml(fixture)['api-keys']);
});
