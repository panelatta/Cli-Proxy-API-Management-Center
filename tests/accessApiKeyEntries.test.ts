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

test('client keys can be disabled and re-enabled without losing their settings', () => {
  const original = parseYaml(fixture);
  const entries = runVisualConfig(fixture).visualValues.apiKeyEntries;
  const disabled = runVisualConfig(fixture, [
    { apiKeyEntries: entries.map((entry) => ({ ...entry, disabled: true })) },
  ]);
  expect(disabled.visualDirty).toBe(true);
  const pausedYaml = disabled.applyVisualChangesToYaml(fixture);
  expect(parseYaml(pausedYaml).access['api-keys']).toEqual([
    { ...original.access['api-keys'][0], disabled: true },
  ]);
  expect(normalizeConfigResponse(parseYaml(pausedYaml)).apiKeyEntries?.[0]?.disabled).toBe(true);
  const enabled = runVisualConfig(pausedYaml, [
    { apiKeyEntries: entries.map((entry) => ({ ...entry, disabled: false })) },
  ]);
  expect(parseYaml(enabled.applyVisualChangesToYaml(pausedYaml))).toEqual(original);
});

test('editing other client keys preserves a disabled key without optional metadata', () => {
  const yaml = 'access:\n  api-keys:\n    - api-key: paused\n      disabled: true\n    - active\n';
  const config = runVisualConfig(yaml, [{ apiKeysText: 'paused\nreplacement' }]);
  expect(parseYaml(config.applyVisualChangesToYaml(yaml)).access['api-keys']).toEqual([
    { 'api-key': 'paused', disabled: true },
    'replacement',
  ]);
});

test('product permissions survive YAML edits, disabling, rotation, and reordering', () => {
  const yaml = `access:
  api-keys:
    - api-key: claude-client
      allowed-providers: [claude]
    - open-client
`;
  const baseline = runVisualConfig(yaml).visualValues.apiKeyEntries;
  expect(baseline[0].allowedProviders).toEqual(['claude']);
  const config = runVisualConfig(yaml, [
    {
      apiKeysText: 'open-client\nrotated-client',
      apiKeyEntries: [baseline[1], { ...baseline[0], apiKey: 'rotated-client', disabled: true }],
    },
  ]);
  const output = parseYaml(config.applyVisualChangesToYaml(yaml));
  expect(output.access['api-keys']).toEqual([
    'open-client',
    { 'api-key': 'rotated-client', disabled: true, 'allowed-providers': ['claude'] },
  ]);
  const unrestricted = runVisualConfig(yaml, [
    {
      apiKeyEntries: baseline.map((entry) => ({ ...entry, allowedProviders: undefined })),
    },
  ]);
  expect(parseYaml(unrestricted.applyVisualChangesToYaml(yaml)).access['api-keys']).toEqual([
    'claude-client',
    'open-client',
  ]);
});
