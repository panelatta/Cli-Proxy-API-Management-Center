import { afterEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useApiKeysForModels } from '../src/hooks/useApiKeysForModels';
import { useConfigStore } from '../src/stores/useConfigStore';
import { apiKeysApi } from '../src/services/api/apiKeys';

const originalConfig = useConfigStore.getInitialState().config;
let restoreSpy: (() => void) | undefined;
afterEach(() => {
  restoreSpy?.();
  restoreSpy = undefined;
  useConfigStore.getInitialState().config = originalConfig;
});

function resolveModelsKeys() {
  let resolve: ReturnType<typeof useApiKeysForModels> | undefined;
  function Harness() {
    resolve = useApiKeysForModels();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  if (!resolve) throw new Error('Model key resolver did not render');
  return resolve();
}

test('model discovery skips the disabled first key in cached configuration', async () => {
  // React's server renderer reads Zustand's initial snapshot.
  useConfigStore.getInitialState().config = {
    apiKeys: ['paused-client', 'active-client', 'active-client'],
    apiKeyEntries: [
      { apiKey: 'paused-client', disabled: true },
      { apiKey: 'active-client' },
      { apiKey: 'active-client' },
    ],
  };
  const spy = spyOn(apiKeysApi, 'listEntries');
  restoreSpy = () => spy.mockRestore();
  expect(await resolveModelsKeys()).toEqual(['active-client']);
  expect(spy).not.toHaveBeenCalled();
});

test('model discovery filters disabled keys when fetching entries from the server', async () => {
  useConfigStore.getInitialState().config = null;
  const spy = spyOn(apiKeysApi, 'listEntries').mockResolvedValue([
    { apiKey: 'paused-client', disabled: true },
    { apiKey: 'active-client' },
  ]);
  restoreSpy = () => spy.mockRestore();
  expect(await resolveModelsKeys()).toEqual(['active-client']);
});
